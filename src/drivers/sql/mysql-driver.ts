import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import type { ConnectionSpec } from '../../core/types.js';
import type { SqlDriver, SqlExecuteResult, SqlExecutionMode } from '../../core/types.js';
import { checkDangerousOperation, isReadOnlyQuery } from '../../core/sql-guards.js';
import { auditLog } from '../../core/audit.js';
import { sleep, withTimeout } from './timeout.js';

const RETRIABLE = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
]);

function poolConfig(spec: ConnectionSpec): mysql.PoolOptions {
  if (spec.url) {
    return {
      uri: spec.url,
      connectionLimit: 10,
      connectTimeout: 60000,
      enableKeepAlive: true,
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
  };
}

export async function createMysqlDriver(spec: ConnectionSpec): Promise<SqlDriver> {
  const pool: Pool = mysql.createPool(poolConfig(spec));
  const engine = 'mysql' as const;

  async function executeInner(
    sql: string,
    params: unknown[] | undefined,
    mode: SqlExecutionMode,
    maxRows: number,
    queryTimeoutMs: number,
    maxSqlLength: number
  ): Promise<SqlExecuteResult> {
    const start = Date.now();
    if (sql.length > maxSqlLength) {
      return { success: false, error: `SQL 超过长度限制（${maxSqlLength}）` };
    }
    if (mode === 'readonly' && !isReadOnlyQuery(sql)) {
      return { success: false, error: '只读模式仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN' };
    }
    if (mode === 'readwrite') {
      const d = checkDangerousOperation(sql);
      if (d) return { success: false, error: d };
    }
    const [rows, _fields] = await withTimeout(
      pool.execute(sql, (params ?? []) as never) as Promise<[unknown, unknown]>,
      queryTimeoutMs
    );
    const executionTime = Date.now() - start;
    if (Array.isArray(rows)) {
      const data = (rows as RowDataPacket[]).slice(0, maxRows);
      auditLog({ engine, sql, success: true, executionTime });
      return {
        success: true,
        data,
        totalRows: (rows as RowDataPacket[]).length,
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
    maxSqlLength: number
  ): Promise<SqlExecuteResult> {
    const retryCount = parseInt(process.env.DB_RETRY_COUNT || '2', 10);
    const retryDelayMs = parseInt(process.env.DB_RETRY_DELAY_MS || '200', 10);
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
        options.maxSqlLength
      );
    },
    async close() {
      await pool.end();
    },
  };
}
