import pg, { type FieldDef, type Pool, type QueryResult } from 'pg';
import type { ConnectionSpec } from '../../core/types.js';
import type { SqlDriver, SqlExecuteResult, SqlExecutionMode } from '../../core/types.js';
import { checkDangerousOperation, isReadOnlyQuery } from '../../core/sql-guards.js';
import { auditLog } from '../../core/audit.js';
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

export async function createPostgresDriver(spec: ConnectionSpec): Promise<SqlDriver> {
  const pool: Pool = new pg.Pool({
    connectionString: buildConnectionString(spec),
    max: 10,
    connectionTimeoutMillis: 60000,
  });
  const engine = 'postgres' as const;

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
      return { success: false, error: '只读模式仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN/WITH(SELECT)' };
    }
    if (mode === 'readwrite') {
      const d = checkDangerousOperation(sql);
      if (d) return { success: false, error: d };
    }
    const res: QueryResult = await withTimeout(pool.query(sql, params ?? []), queryTimeoutMs);
    const executionTime = Date.now() - start;
    if (res.rows && res.rows.length > 0) {
      const data = res.rows.slice(0, maxRows) as unknown[];
      auditLog({ engine, sql, success: true, executionTime });
      return {
        success: true,
        data,
        totalRows: res.rows.length,
        truncated: res.rows.length > maxRows,
        fields: res.fields?.map((f: FieldDef) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        executionTime,
      };
    }
    auditLog({ engine, sql, success: true, executionTime, rowCount: res.rowCount });
    return {
      success: true,
      affectedRows: res.rowCount ?? undefined,
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
        options.maxSqlLength
      );
    },
    async close() {
      await pool.end();
    },
  };
}
