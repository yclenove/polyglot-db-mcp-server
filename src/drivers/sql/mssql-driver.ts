import sql from 'mssql';
import type { ConnectionSpec } from '../../core/types.js';
import type { SqlDriver, SqlExecuteResult, SqlExecutionMode } from '../../core/types.js';
import { checkDangerousOperation, isReadOnlyQuery } from '../../core/sql-guards.js';
import { auditLog } from '../../core/audit.js';
import { withTimeout } from './timeout.js';

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
function bindQuestionMarks(request: sql.Request, rawSql: string, params: unknown[] | undefined): string {
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
      if (options.mode === 'readonly' && !isReadOnlyQuery(sqlText)) {
        return { success: false, error: '只读模式仅允许 SELECT/WITH(SELECT) 等' };
      }
      if (options.mode === 'readwrite') {
        const d = checkDangerousOperation(sqlText);
        if (d) return { success: false, error: d };
      }
      try {
        const request = pool.request();
        const text = bindQuestionMarks(request, sqlText, params);
        const result = await withTimeout(
          request.query(text),
          options.queryTimeoutMs
        );
        const executionTime = Date.now() - start;
        if (result.recordset) {
          const rows = result.recordset as unknown[];
          const data = rows.slice(0, options.maxRows);
          auditLog({ engine, sql: sqlText, success: true, executionTime });
          return {
            success: true,
            data,
            totalRows: rows.length,
            truncated: rows.length > options.maxRows,
            executionTime,
          };
        }
        auditLog({ engine, sql: sqlText, success: true, executionTime });
        return {
          success: true,
          affectedRows: result.rowsAffected?.[0],
          executionTime,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        auditLog({ engine, sql: sqlText, success: false, error: msg });
        return { success: false, error: msg };
      }
    },
    async close() {
      await pool.close();
    },
  };
}
