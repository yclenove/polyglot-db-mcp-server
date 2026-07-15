import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
  type ResultSetHeader,
} from 'mysql2/promise';
import type { FieldPacket, Query as MysqlQuery } from 'mysql2';
import type { ConnectionSpec } from '../../core/types.js';
import type { SqlDriver, SqlExecuteResult, SqlExecutionMode } from '../../core/types.js';
import { checkDangerousOperation, isReadOnlyQuery } from '../../core/sql-guards.js';
import { auditLog } from '../../core/audit.js';
import { globalLimits } from '../../core/config.js';
import { sleep, withTimeout } from './timeout.js';

const RETRIABLE = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
]);

export function requiresTextProtocol(sql: string): boolean {
  return /^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE|CALL)\b/i.test(sql);
}

export function buildMysqlPoolConfig(spec: ConnectionSpec): mysql.PoolOptions {
  if (spec.url) {
    return {
      uri: spec.url,
      connectionLimit: 10,
      connectTimeout: 60000,
      enableKeepAlive: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    };
  }
  return {
    host: spec.host ?? 'localhost',
    port: spec.port ?? 3306,
    user: spec.user ?? 'root',
    password: spec.password ?? '',
    database: spec.database,
    connectionLimit: 10,
    connectTimeout: 60000,
    enableKeepAlive: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
}

interface MysqlCoreConnection {
  query(options: { sql: string; timeout?: number }, values?: unknown[]): MysqlQuery;
}

async function streamLimitedQuery(
  core: MysqlCoreConnection,
  sql: string,
  params: unknown[] | undefined,
  maxRows: number,
  queryTimeoutMs: number,
): Promise<{ rows: RowDataPacket[]; fields: FieldPacket[]; observedRows: number }> {
  return new Promise((resolve, reject) => {
    const rows: RowDataPacket[] = [];
    let fields: FieldPacket[] = [];
    let observedRows = 0;
    let settled = false;
    const finish = (
      error?: unknown,
      value?: { rows: RowDataPacket[]; fields: FieldPacket[]; observedRows: number },
    ): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value!);
    };

    const query = core.query(
      {
        sql,
        ...(queryTimeoutMs > 0 ? { timeout: queryTimeoutMs } : {}),
      },
      params,
    );
    query.on('fields', (value) => {
      if (Array.isArray(value) && fields.length === 0) fields = value;
    });
    query.on('result', (row) => {
      observedRows++;
      if (rows.length < Math.max(1, maxRows) + 1) rows.push(row as RowDataPacket);
    });
    query.on('error', (error) => finish(error));
    query.on('end', () => finish(undefined, { rows, fields, observedRows }));
  });
}

async function executeLimitedRead(
  connection: PoolConnection,
  sql: string,
  params: unknown[] | undefined,
  maxRows: number,
  queryTimeoutMs: number,
  executionStartedAt: number,
): Promise<SqlExecuteResult> {
  const fetchLimit = Math.max(1, maxRows) + 1;
  await connection.query(`SET SESSION sql_select_limit = ${fetchLimit}`);
  try {
    const core = (connection as unknown as { connection: MysqlCoreConnection }).connection;
    const streamed = await streamLimitedQuery(core, sql, params, maxRows, queryTimeoutMs);
    const executionTime = Date.now() - executionStartedAt;
    const truncated = streamed.observedRows > maxRows;
    return {
      success: true,
      data: streamed.rows.slice(0, maxRows),
      totalRows: streamed.observedRows,
      totalRowsExact: !truncated,
      truncated,
      fields: streamed.fields.map((field) => ({
        name: field.name,
        dataTypeID: field.columnType,
      })),
      executionTime,
    };
  } finally {
    try {
      await connection.query('SET SESSION sql_select_limit = DEFAULT');
    } catch {
      connection.destroy();
    }
  }
}

export async function createMysqlDriver(spec: ConnectionSpec): Promise<SqlDriver> {
  const pool: Pool = mysql.createPool(buildMysqlPoolConfig(spec));
  const engine = 'mysql' as const;

  async function beginTransaction(): Promise<import('../../core/types.js').SqlTransaction> {
    const conn = await pool.getConnection();
    await conn.beginTransaction();

    async function executeInner(
      sql: string,
      params: unknown[] | undefined,
      mode: SqlExecutionMode,
      maxRows: number,
      queryTimeoutMs: number,
      maxSqlLength: number,
    ): Promise<SqlExecuteResult> {
      const start = Date.now();
      if (sql.length > maxSqlLength) {
        return { success: false, error: `SQL 超过长度限制（${maxSqlLength}）` };
      }
      if (mode === 'readonly' && !isReadOnlyQuery(sql, 'mysql')) {
        return { success: false, error: '只读模式仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN' };
      }
      if (mode === 'readwrite') {
        const d = checkDangerousOperation(sql, 'mysql');
        if (d) return { success: false, error: d };
      }
      if (isReadOnlyQuery(sql, 'mysql')) {
        return executeLimitedRead(conn, sql, params, maxRows, queryTimeoutMs, start);
      }
      const statement = requiresTextProtocol(sql)
        ? conn.query(sql, (params ?? []) as never)
        : conn.execute(sql, (params ?? []) as never);
      const [rows] = await withTimeout(statement as Promise<[unknown, unknown]>, queryTimeoutMs);
      const executionTime = Date.now() - start;
      if (Array.isArray(rows)) {
        const data = (rows as RowDataPacket[]).slice(0, maxRows);
        return {
          success: true,
          data,
          totalRows: (rows as RowDataPacket[]).length,
          totalRowsExact: true,
          truncated: (rows as RowDataPacket[]).length > maxRows,
          executionTime,
        };
      }
      const header = rows as ResultSetHeader;
      return {
        success: true,
        affectedRows: header.affectedRows,
        insertId: header.insertId,
        executionTime,
      };
    }

    return {
      async execute(sql, params, options) {
        return executeInner(
          sql,
          params,
          options.mode,
          options.maxRows,
          options.queryTimeoutMs,
          options.maxSqlLength,
        );
      },
      async commit() {
        try {
          await conn.commit();
        } finally {
          conn.release();
        }
      },
      async rollback() {
        try {
          await conn.rollback();
        } finally {
          conn.release();
        }
      },
    };
  }

  async function executeInner(
    sql: string,
    params: unknown[] | undefined,
    mode: SqlExecutionMode,
    maxRows: number,
    queryTimeoutMs: number,
    maxSqlLength: number,
  ): Promise<SqlExecuteResult> {
    const start = Date.now();
    if (sql.length > maxSqlLength) {
      return { success: false, error: `SQL 超过长度限制（${maxSqlLength}）` };
    }
    if (mode === 'readonly' && !isReadOnlyQuery(sql, 'mysql')) {
      return { success: false, error: '只读模式仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN' };
    }
    if (mode === 'readwrite') {
      const d = checkDangerousOperation(sql, 'mysql');
      if (d) return { success: false, error: d };
    }
    if (isReadOnlyQuery(sql, 'mysql')) {
      const connection = await pool.getConnection();
      try {
        const result = await executeLimitedRead(
          connection,
          sql,
          params,
          maxRows,
          queryTimeoutMs,
          start,
        );
        auditLog({ engine, sql, success: true, executionTime: result.executionTime });
        return result;
      } finally {
        connection.release();
      }
    }
    const statement = requiresTextProtocol(sql)
      ? pool.query(sql, (params ?? []) as never)
      : pool.execute(sql, (params ?? []) as never);
    const [rows, _fields] = await withTimeout(
      statement as Promise<[unknown, unknown]>,
      queryTimeoutMs,
    );
    const executionTime = Date.now() - start;
    if (Array.isArray(rows)) {
      const data = (rows as RowDataPacket[]).slice(0, maxRows);
      auditLog({ engine, sql, success: true, executionTime });
      return {
        success: true,
        data,
        totalRows: (rows as RowDataPacket[]).length,
        totalRowsExact: true,
        truncated: (rows as RowDataPacket[]).length > maxRows,
        executionTime,
      };
    }
    const header = rows as ResultSetHeader;
    auditLog({ engine, sql, success: true, executionTime, affectedRows: header.affectedRows });
    return {
      success: true,
      affectedRows: header.affectedRows,
      insertId: header.insertId,
      executionTime,
    };
  }

  async function executeWithRetry(
    sql: string,
    params: unknown[] | undefined,
    mode: SqlExecutionMode,
    maxRows: number,
    queryTimeoutMs: number,
    maxSqlLength: number,
  ): Promise<SqlExecuteResult> {
    const { retryCount, retryDelayMs } = globalLimits();
    const attempts = Math.max(0, retryCount) + 1;
    for (let i = 0; i < attempts; i++) {
      try {
        return await executeInner(sql, params, mode, maxRows, queryTimeoutMs, maxSqlLength);
      } catch (e) {
        const code = (e as { code?: string })?.code;
        const retriable = mode === 'readonly' && code && RETRIABLE.has(code);
        if (!retriable || i === attempts - 1) {
          const msg = e instanceof Error ? e.message : String(e);
          auditLog({ engine, sql, success: false, error: msg });
          return { success: false, error: msg, executionTime: undefined };
        }
        await sleep(Math.max(50, retryDelayMs) * Math.pow(2, i));
      }
    }
    return { success: false, error: '执行失败' };
  }

  return {
    engine,
    async ping() {
      try {
        await pool.query('SELECT 1');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async execute(sql, params, options) {
      return executeWithRetry(
        sql,
        params,
        options.mode,
        options.maxRows,
        options.queryTimeoutMs,
        options.maxSqlLength,
      );
    },
    beginTransaction,
    async close() {
      await pool.end();
    },
  };
}
