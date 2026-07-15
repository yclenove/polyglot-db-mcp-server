import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBResultReader,
  type DuckDBValue,
} from '@duckdb/node-api';
import type {
  ConnectionSpec,
  SqlDriver,
  SqlExecuteResult,
  SqlExecutionMode,
  SqlTransaction,
} from '../../core/types.js';
import { auditLog } from '../../core/audit.js';
import { checkDangerousOperation, isReadOnlyQuery } from '../../core/sql-guards.js';

type DuckDbPathConfig = {
  databasePath: string;
  allowedDirectories: string[];
  allowedPaths: string[];
};

function stripFilePrefix(value: string): string {
  if (!value.startsWith('file:')) return value;
  return value.slice(5).replace(/^\/\//, '');
}

function normalizeLocalPath(raw: string): string {
  const withoutPrefix = stripFilePrefix(raw.trim());
  if (withoutPrefix === ':memory:') return ':memory:';
  const resolved = isAbsolute(withoutPrefix)
    ? withoutPrefix
    : resolve(process.cwd(), withoutPrefix);
  return resolved.replace(/\\/g, '/');
}

function ensureParentDir(filePath: string): void {
  if (filePath === ':memory:') return;
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

function parsePathConfig(spec: ConnectionSpec): DuckDbPathConfig {
  const databasePath = normalizeLocalPath(spec.url ?? spec.database ?? ':memory:');
  const allowedDirectories: string[] = [];
  const allowedPaths: string[] = [];

  for (const item of spec.allowlist ?? []) {
    const normalized = normalizeLocalPath(item);
    if (normalized === ':memory:') continue;
    if (existsSync(normalized) && statSync(normalized).isFile()) {
      allowedPaths.push(normalized);
    } else {
      allowedDirectories.push(normalized.endsWith('/') ? normalized : `${normalized}/`);
    }
  }

  return { databasePath, allowedDirectories, allowedPaths };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlList(values: string[]): string {
  return `[${values.map(sqlString).join(', ')}]`;
}

function toDuckDbValue(value: unknown): DuckDBValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'string'
  ) {
    return value;
  }
  throw new Error(`DuckDB 参数类型不支持: ${typeof value}`);
}

function adaptRowsResult(
  result: DuckDBResultReader,
  rows: Record<string, unknown>[],
  maxRows: number,
  executionTime: number,
): SqlExecuteResult {
  const truncated = rows.length > maxRows;
  return {
    success: true,
    data: rows.slice(0, maxRows),
    totalRows: rows.length,
    totalRowsExact: result.done,
    truncated,
    executionTime,
    fields: result.columnNames().map((name, index) => ({
      name,
      dataTypeID: Number(result.columnTypeId(index)),
    })),
  };
}

async function runWithQueryTimeout<T>(
  connection: DuckDBConnection,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      connection.interrupt();
      reject(new Error(`查询超时（>${timeoutMs}ms）`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function executeOne(
  connection: DuckDBConnection,
  sql: string,
  params: unknown[] | undefined,
  mode: SqlExecutionMode,
  maxRows: number,
  queryTimeoutMs: number,
  maxSqlLength: number,
): Promise<SqlExecuteResult> {
  if (sql.length > maxSqlLength) {
    return { success: false, error: `SQL 超过长度限制（${maxSqlLength}）` };
  }
  if (mode === 'readonly' && !isReadOnlyQuery(sql, 'duckdb')) {
    return { success: false, error: '只读模式仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN' };
  }
  if (mode === 'readwrite') {
    const dangerous = checkDangerousOperation(sql, 'duckdb');
    if (dangerous) return { success: false, error: dangerous };
  }

  const start = Date.now();
  try {
    const values = (params ?? []).map(toDuckDbValue);
    if (isReadOnlyQuery(sql, 'duckdb')) {
      const reader = await runWithQueryTimeout(
        connection,
        connection.streamAndReadUntil(sql, Math.max(1, maxRows) + 1, values),
        queryTimeoutMs,
      );
      const executionTime = Date.now() - start;
      const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
      auditLog({ engine: 'duckdb', sql, success: true, executionTime });
      return adaptRowsResult(reader, rows, maxRows, executionTime);
    }

    const result = await runWithQueryTimeout(
      connection,
      connection.run(sql, values),
      queryTimeoutMs,
    );
    const executionTime = Date.now() - start;

    auditLog({
      engine: 'duckdb',
      sql,
      success: true,
      executionTime,
      affectedRows: Number(result.rowsChanged),
    });
    return {
      success: true,
      affectedRows: Number(result.rowsChanged),
      executionTime,
    };
  } catch (error) {
    const executionTime = Date.now() - start;
    const msg = error instanceof Error ? error.message : String(error);
    auditLog({ engine: 'duckdb', sql, success: false, error: msg, executionTime });
    return { success: false, error: msg, executionTime };
  }
}

async function configureFileAccess(
  connection: DuckDBConnection,
  allowedDirectories: string[],
  allowedPaths: string[],
): Promise<void> {
  if (allowedDirectories.length > 0) {
    await connection.run(`SET allowed_directories = ${sqlList(allowedDirectories)}`);
  }
  if (allowedPaths.length > 0) {
    await connection.run(`SET allowed_paths = ${sqlList(allowedPaths)}`);
  }
  await connection.run('SET enable_external_access = false');
}

export async function createDuckDbDriver(spec: ConnectionSpec): Promise<SqlDriver> {
  const connectionReadonly = spec.readonly !== false;
  const { databasePath, allowedDirectories, allowedPaths } = parsePathConfig(spec);

  if (databasePath !== ':memory:') {
    if (connectionReadonly && !existsSync(databasePath)) {
      throw new Error(`DuckDB 只读数据库文件不存在: ${databasePath}`);
    }
    if (!connectionReadonly) {
      ensureParentDir(databasePath);
    }
  }

  const options: Record<string, string> = {};
  if (databasePath !== ':memory:') {
    options.access_mode = connectionReadonly ? 'READ_ONLY' : 'READ_WRITE';
  }

  const instance = await DuckDBInstance.create(databasePath, options);
  const connection = await instance.connect();
  await configureFileAccess(connection, allowedDirectories, allowedPaths);

  const engine = 'duckdb' as const;

  async function beginTransaction(): Promise<SqlTransaction> {
    if (connectionReadonly) {
      throw new Error('DuckDB 只读连接不支持事务');
    }
    await connection.run('BEGIN TRANSACTION');
    let finalised = false;

    return {
      async execute(sql, params, options): Promise<SqlExecuteResult> {
        if (finalised) return { success: false, error: '事务已结束' };
        return executeOne(
          connection,
          sql,
          params,
          options.mode,
          options.maxRows,
          options.queryTimeoutMs,
          options.maxSqlLength,
        );
      },
      async commit(): Promise<void> {
        if (finalised) return;
        finalised = true;
        await connection.run('COMMIT');
      },
      async rollback(): Promise<void> {
        if (finalised) return;
        finalised = true;
        await connection.run('ROLLBACK');
      },
    };
  }

  return {
    engine,

    async ping() {
      const result = await executeOne(connection, 'SELECT 1 AS ok', [], 'readonly', 1, 5000, 100);
      return result.success ? { ok: true } : { ok: false, error: result.error };
    },

    async execute(sql, params, options) {
      const effectiveMode: SqlExecutionMode = connectionReadonly ? 'readonly' : options.mode;
      return executeOne(
        connection,
        sql,
        params,
        effectiveMode,
        options.maxRows,
        options.queryTimeoutMs,
        options.maxSqlLength,
      );
    },

    beginTransaction,

    async close() {
      connection.closeSync();
      instance.closeSync();
    },
  };
}
