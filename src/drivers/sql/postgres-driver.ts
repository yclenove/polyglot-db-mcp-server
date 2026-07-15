import pg, { type FieldDef, type Pool, type PoolClient, type QueryResult } from 'pg';
import type { ConnectionSpec } from '../../core/types.js';
import type { SqlDriver, SqlExecuteResult, SqlExecutionMode } from '../../core/types.js';
import {
  checkDangerousOperation,
  firstSqlKeyword,
  isReadOnlyQuery,
  stripSqlStatementTerminators,
} from '../../core/sql-guards.js';
import { auditLog } from '../../core/audit.js';
import { globalLimits } from '../../core/config.js';
import { sleep, withTimeout } from './timeout.js';

function buildConnectionString(spec: ConnectionSpec): string {
  if (spec.url) return spec.url;
  const host = spec.host ?? 'localhost';
  const port = spec.port ?? 5432;
  const user = encodeURIComponent(spec.user ?? 'postgres');
  const pass = encodeURIComponent(spec.password ?? '');
  const db = spec.database ?? '';
  return `postgresql://${user}:${pass}@${host}:${port}/${db}`;
}

const RETRIABLE = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01']);
let cursorCounter = 0;

function shouldUseCursor(sql: string): boolean {
  const keyword = firstSqlKeyword(sql, 'postgres');
  return (keyword === 'select' || keyword === 'with') && isReadOnlyQuery(sql, 'postgres');
}

function adaptQueryResult(
  result: QueryResult,
  maxRows: number,
  executionTime: number,
  hardLimited: boolean,
): SqlExecuteResult {
  if (result.fields.length > 0) {
    const rows = result.rows as unknown[];
    const truncated = rows.length > maxRows;
    return {
      success: true,
      data: rows.slice(0, maxRows),
      totalRows: rows.length,
      totalRowsExact: hardLimited ? !truncated : true,
      truncated,
      fields: result.fields.map((field: FieldDef) => ({
        name: field.name,
        dataTypeID: field.dataTypeID,
      })),
      executionTime,
    };
  }
  return {
    success: true,
    affectedRows: result.rowCount ?? undefined,
    executionTime,
  };
}

async function executeCursorQuery(
  client: PoolClient,
  sql: string,
  params: unknown[] | undefined,
  maxRows: number,
  queryTimeoutMs: number,
): Promise<QueryResult> {
  const cursorName = `db_mcp_cursor_${++cursorCounter}`;
  const statement = stripSqlStatementTerminators(sql, 'postgres').trim();
  const statementTimeoutMs =
    Number.isFinite(queryTimeoutMs) && queryTimeoutMs > 0 ? Math.floor(queryTimeoutMs) : 0;
  await withTimeout(
    client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`),
    queryTimeoutMs,
  );
  await withTimeout(
    client.query({
      text: `DECLARE ${cursorName} NO SCROLL CURSOR FOR ${statement}`,
      values: params ?? [],
    }),
    queryTimeoutMs,
  );
  try {
    return await withTimeout(
      client.query(`FETCH FORWARD ${Math.max(1, maxRows) + 1} FROM ${cursorName}`),
      queryTimeoutMs,
    );
  } finally {
    try {
      await client.query(`CLOSE ${cursorName}`);
    } catch {
      // Transaction cleanup handles a cursor left open by a failed connection/query.
    }
  }
}

export async function createPostgresDriver(spec: ConnectionSpec): Promise<SqlDriver> {
  const pool: Pool = new pg.Pool({
    connectionString: buildConnectionString(spec),
    max: 10,
    connectionTimeoutMillis: 60000,
  });
  const engine = 'postgres' as const;

  async function beginTransaction(): Promise<import('../../core/types.js').SqlTransaction> {
    const client = await pool.connect();
    await client.query('BEGIN');

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
      if (mode === 'readonly' && !isReadOnlyQuery(sql, 'postgres')) {
        return {
          success: false,
          error: '只读模式仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN/WITH(SELECT)',
        };
      }
      if (mode === 'readwrite') {
        const d = checkDangerousOperation(sql, 'postgres');
        if (d) return { success: false, error: d };
      }
      const hardLimited = shouldUseCursor(sql);
      const res: QueryResult = hardLimited
        ? await executeCursorQuery(client, sql, params, maxRows, queryTimeoutMs)
        : await withTimeout(client.query(sql, params ?? []), queryTimeoutMs);
      const executionTime = Date.now() - start;
      return adaptQueryResult(res, maxRows, executionTime, hardLimited);
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
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      },
      async rollback() {
        try {
          await client.query('ROLLBACK');
        } finally {
          client.release();
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
    if (mode === 'readonly' && !isReadOnlyQuery(sql, 'postgres')) {
      return { success: false, error: '只读模式仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN/WITH(SELECT)' };
    }
    if (mode === 'readwrite') {
      const d = checkDangerousOperation(sql, 'postgres');
      if (d) return { success: false, error: d };
    }
    const hardLimited = shouldUseCursor(sql);
    let res: QueryResult;
    if (hardLimited) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        res = await executeCursorQuery(client, sql, params, maxRows, queryTimeoutMs);
        await client.query('ROLLBACK');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original query error.
        }
        throw error;
      } finally {
        client.release();
      }
    } else {
      res = await withTimeout(pool.query(sql, params ?? []), queryTimeoutMs);
    }
    const executionTime = Date.now() - start;
    const adapted = adaptQueryResult(res, maxRows, executionTime, hardLimited);
    auditLog({
      engine,
      sql,
      success: true,
      executionTime,
      rowCount: res.rowCount ?? undefined,
    });
    return adapted;
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
          return { success: false, error: msg };
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
