import sql from 'mssql';
import type { ConnectionSpec } from '../../core/types.js';
import type { SqlDriver, SqlExecuteResult, SqlExecutionMode } from '../../core/types.js';
import { checkDangerousOperation, isReadOnlyQuery } from '../../core/sql-guards.js';
import { auditLog } from '../../core/audit.js';
import { createSqlRowCollector } from './row-budget.js';

function inferSqlType(val: unknown) {
  if (val === null || val === undefined) return sql.NVarChar(sql.MAX);
  if (typeof val === 'number' && Number.isInteger(val)) return sql.Int;
  if (typeof val === 'number') return sql.Float;
  if (typeof val === 'boolean') return sql.Bit;
  if (val instanceof Date) return sql.DateTime2;
  if (Buffer.isBuffer(val)) return sql.VarBinary(sql.MAX);
  return sql.NVarChar(sql.MAX);
}

/** 将 `?` 依次替换为 @p0,@p1… 并绑定参数（勿在字符串字面量中使用裸 `?`） */
function bindQuestionMarks(
  request: sql.Request,
  rawSql: string,
  params: unknown[] | undefined,
): string {
  if (!params?.length) return rawSql;
  let i = 0;
  return rawSql.replace(/\?/g, () => {
    const name = `p${i}`;
    const v = params[i];
    i++;
    request.input(name, inferSqlType(v as unknown) as never, v as never);
    return `@${name}`;
  });
}

interface StreamedMssqlResult {
  rows: unknown[];
  observedRows: number;
  rowsAffected?: number;
  fields: { name: string }[];
  hasRecordset: boolean;
  exact: boolean;
  truncatedBy?: 'rows' | 'bytes';
  returnedBytes: number;
}

async function queryStreamed(
  request: sql.Request,
  text: string,
  maxRows: number,
  maxBytes: number | undefined,
  queryTimeoutMs: number,
  cancelOnLimit: boolean,
): Promise<StreamedMssqlResult> {
  return new Promise((resolve, reject) => {
    const collector = createSqlRowCollector<unknown>(maxRows, maxBytes);
    let observedRows = 0;
    let fields: { name: string }[] = [];
    let hasRecordset = false;
    let rowsAffected: number | undefined;
    let canceledForLimit = false;
    let pendingError: unknown;
    let settled = false;
    let cancelFallback: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (cancelFallback) clearTimeout(cancelFallback);
      if (pendingError) {
        reject(pendingError);
        return;
      }
      resolve({
        rows: collector.items,
        observedRows,
        rowsAffected,
        fields,
        hasRecordset,
        exact: !canceledForLimit,
        truncatedBy: collector.truncatedBy,
        returnedBytes: collector.returnedBytes,
      });
    };

    request.stream = true;
    request.on('recordset', (columns: Record<string, unknown>) => {
      hasRecordset = true;
      if (fields.length === 0) fields = Object.keys(columns).map((name) => ({ name }));
    });
    request.on('row', (row: unknown) => {
      observedRows++;
      const accepted = collector.truncatedBy ? false : collector.add(row);
      if (cancelOnLimit && !accepted && !canceledForLimit) {
        canceledForLimit = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        request.cancel();
        cancelFallback = setTimeout(finish, 5000);
      }
    });
    request.on('rowsaffected', (count: number) => {
      rowsAffected = (rowsAffected ?? 0) + count;
    });
    request.on('error', (error: unknown) => {
      const code = (error as { code?: string })?.code;
      const message = error instanceof Error ? error.message : String(error);
      const expectedCancel =
        canceledForLimit && (code === 'ECANCEL' || /\bcancel(?:ed|led)?\b/i.test(message));
      if (!expectedCancel) pendingError ??= error;
    });
    request.on('done', (result: { rowsAffected?: number[] }) => {
      if (rowsAffected === undefined && result.rowsAffected?.length) {
        rowsAffected = result.rowsAffected.reduce((sum, count) => sum + count, 0);
      }
      finish();
    });

    if (queryTimeoutMs > 0) {
      timeout = setTimeout(() => {
        pendingError = new Error(`查询超时（>${queryTimeoutMs}ms）`);
        request.cancel();
        cancelFallback = setTimeout(finish, 5000);
      }, queryTimeoutMs);
    }

    void request.query(text).catch((error: unknown) => {
      const code = (error as { code?: string })?.code;
      const message = error instanceof Error ? error.message : String(error);
      const expectedCancel =
        canceledForLimit && (code === 'ECANCEL' || /\bcancel(?:ed|led)?\b/i.test(message));
      if (!expectedCancel) pendingError ??= error;
      finish();
    });
  });
}

function adaptStreamedResult(result: StreamedMssqlResult, executionTime: number): SqlExecuteResult {
  if (result.hasRecordset) {
    return {
      success: true,
      data: result.rows,
      totalRows: result.observedRows,
      totalRowsExact: result.exact,
      truncated: result.truncatedBy !== undefined,
      truncatedBy: result.truncatedBy,
      returnedBytes: result.returnedBytes,
      fields: result.fields,
      executionTime,
    };
  }
  return {
    success: true,
    affectedRows: result.rowsAffected,
    executionTime,
  };
}

export async function createMssqlDriver(spec: ConnectionSpec): Promise<SqlDriver> {
  let pool: sql.ConnectionPool;
  if (spec.url) {
    pool = new sql.ConnectionPool(spec.url);
  } else {
    pool = new sql.ConnectionPool({
      server: spec.host ?? 'localhost',
      port: spec.port ?? 1433,
      user: spec.user,
      password: spec.password,
      database: spec.database,
      options: {
        encrypt: process.env.DB_MSSQL_ENCRYPT !== 'false',
        trustServerCertificate: process.env.DB_MSSQL_TRUST_SERVER_CERTIFICATE === 'true',
      },
    });
  }
  await pool.connect();
  const engine = 'mssql' as const;

  async function beginTransaction(): Promise<import('../../core/types.js').SqlTransaction> {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    async function executeInner(
      sqlText: string,
      params: unknown[] | undefined,
      mode: SqlExecutionMode,
      maxRows: number,
      maxBytes: number | undefined,
      queryTimeoutMs: number,
      maxSqlLength: number,
    ): Promise<SqlExecuteResult> {
      const start = Date.now();
      if (sqlText.length > maxSqlLength) {
        return { success: false, error: `SQL 超过长度限制（${maxSqlLength}）` };
      }
      if (mode === 'readonly' && !isReadOnlyQuery(sqlText, 'mssql')) {
        return { success: false, error: '只读模式仅允许 SELECT/WITH(SELECT) 等' };
      }
      if (mode === 'readwrite') {
        const d = checkDangerousOperation(sqlText, 'mssql');
        if (d) return { success: false, error: d };
      }
      const request = new sql.Request(transaction);
      const text = bindQuestionMarks(request, sqlText, params);
      const result = await queryStreamed(
        request,
        text,
        maxRows,
        maxBytes,
        queryTimeoutMs,
        mode === 'readonly',
      );
      const executionTime = Date.now() - start;
      return adaptStreamedResult(result, executionTime);
    }

    return {
      async execute(sql, params, options) {
        return executeInner(
          sql,
          params,
          options.mode,
          options.maxRows,
          options.maxBytes,
          options.queryTimeoutMs,
          options.maxSqlLength,
        );
      },
      async commit() {
        await transaction.commit();
      },
      async rollback() {
        await transaction.rollback();
      },
    };
  }

  return {
    engine,
    async ping() {
      try {
        await pool.request().query('SELECT 1 AS n');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async execute(sqlText, params, options) {
      const start = Date.now();
      if (sqlText.length > options.maxSqlLength) {
        return { success: false, error: `SQL 超过长度限制（${options.maxSqlLength}）` };
      }
      if (options.mode === 'readonly' && !isReadOnlyQuery(sqlText, 'mssql')) {
        return { success: false, error: '只读模式仅允许 SELECT/WITH(SELECT) 等' };
      }
      if (options.mode === 'readwrite') {
        const d = checkDangerousOperation(sqlText, 'mssql');
        if (d) return { success: false, error: d };
      }
      try {
        const request = pool.request();
        const text = bindQuestionMarks(request, sqlText, params);
        const result = await queryStreamed(
          request,
          text,
          options.maxRows,
          options.maxBytes,
          options.queryTimeoutMs,
          options.mode === 'readonly',
        );
        const executionTime = Date.now() - start;
        const adapted = adaptStreamedResult(result, executionTime);
        auditLog({
          engine,
          sql: sqlText,
          success: true,
          executionTime,
          affectedRows: adapted.affectedRows,
        });
        return adapted;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        auditLog({ engine, sql: sqlText, success: false, error: msg });
        return { success: false, error: msg };
      }
    },
    beginTransaction,
    async close() {
      await pool.close();
    },
  };
}
