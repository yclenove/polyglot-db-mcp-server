import type { ConnectionSpec } from '../../core/types.js';
import type { SqlDriver, SqlExecuteResult, SqlExecutionMode } from '../../core/types.js';
import { checkDangerousOperation, isReadOnlyQuery } from '../../core/sql-guards.js';
import { auditLog } from '../../core/audit.js';
import { withTimeout } from './timeout.js';

type OraConnection = {
  execute: (sql: string, binds: unknown[], opts: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

type OraPool = {
  getConnection: () => Promise<OraConnection>;
  close: (seconds: number) => Promise<void>;
};

type OraModule = {
  createPool: (config: Record<string, unknown>) => Promise<OraPool>;
  OUT_FORMAT_OBJECT: number;
};

/** 动态加载 optionalDependency `oracledb` */
export async function createOracleDriver(spec: ConnectionSpec): Promise<SqlDriver> {
  let oracledb: OraModule;
  try {
    oracledb = (await import('oracledb')) as OraModule;
  } catch (e) {
    throw new Error(
      `未安装 oracledb 可选依赖，无法创建 Oracle 连接：${e instanceof Error ? e.message : String(e)}`
    );
  }

  const connectString =
    spec.url ??
    `${spec.host ?? 'localhost'}:${spec.port ?? 1521}/${spec.database ?? ''}`.replace(/\/$/, '');
  const user = spec.user;
  const password = spec.password;
  if (!user) {
    throw new Error('Oracle 连接需要 user');
  }

  const pool = await oracledb.createPool({
    user,
    password: password ?? '',
    connectString,
    poolMin: 0,
    poolMax: 8,
    poolTimeout: 60,
  });

  const engine = 'oracle' as const;

  function bindQuestionMarks(sqlText: string, params: unknown[] | undefined): { text: string; binds: unknown[] } {
    if (!params?.length) return { text: sqlText, binds: [] };
    const binds = [...params];
    let n = 0;
    const text = sqlText.replace(/\?/g, () => {
      n++;
      return `:${n}`;
    });
    if (n !== binds.length) {
      throw new Error('SQL 中 ? 占位符数量与 params 长度不一致');
    }
    return { text, binds };
  }

  return {
    engine,
    async ping() {
      let conn: OraConnection | undefined;
      try {
        conn = await pool.getConnection();
        await conn.execute('SELECT 1 FROM DUAL', [], {});
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      } finally {
        if (conn) {
          try {
            await conn.close();
          } catch {
            /* ignore */
          }
        }
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
      let conn: OraConnection | undefined;
      try {
        const { text, binds } = bindQuestionMarks(sqlText, params);
        conn = await pool.getConnection();
        const execOpts: Record<string, unknown> = {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        };
        if (options.mode === 'readonly') {
          execOpts.maxRows = Math.min(options.maxRows, 10_000);
        }
        const result = (await withTimeout(
          conn.execute(text, binds, execOpts),
          options.queryTimeoutMs
        )) as {
          rows?: unknown[];
          rowsAffected?: number;
        };
        const executionTime = Date.now() - start;
        if (result.rows && Array.isArray(result.rows)) {
          const rows = result.rows as unknown[];
          auditLog({ engine, sql: sqlText, success: true, executionTime });
          return {
            success: true,
            data: rows,
            totalRows: rows.length,
            truncated: rows.length > options.maxRows,
            executionTime,
          };
        }
        auditLog({ engine, sql: sqlText, success: true, executionTime });
        return {
          success: true,
          affectedRows: result.rowsAffected,
          executionTime,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        auditLog({ engine, sql: sqlText, success: false, error: msg });
        return { success: false, error: msg };
      } finally {
        if (conn) {
          try {
            await conn.close();
          } catch {
            /* ignore */
          }
        }
      }
    },
    async close() {
      await pool.close(10);
    },
  };
}