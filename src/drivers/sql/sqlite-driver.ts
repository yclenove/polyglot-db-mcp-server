import Database from 'better-sqlite3';
import { resolve, dirname, isAbsolute } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { ConnectionSpec } from '../../core/types.js';
import type {
  SqlDriver,
  SqlExecuteResult,
  SqlExecutionMode,
  SqlTransaction,
} from '../../core/types.js';
import { checkDangerousOperation, isReadOnlyQuery } from '../../core/sql-guards.js';
import { auditLog } from '../../core/audit.js';

/**
 * SQLite 扩展的只读判断：在通用 isReadOnlyQuery 基础上增加 PRAGMA 支持。
 */
function isSqliteReadOnlyQuery(sql: string): boolean {
  if (isReadOnlyQuery(sql)) return true;
  const t = sql.trim().toLowerCase();
  return t.startsWith('pragma');
}

/**
 * 从 ConnectionSpec 解析 SQLite 数据库文件路径。
 * 支持格式：
 *   - file:./path/to/db.sqlite
 *   - file:path/to/db.sqlite
 *   - /absolute/path/to/db.sqlite
 *   - ./relative/path/to/db.sqlite
 *   - :memory:（内存数据库）
 */
function resolveDbPath(spec: ConnectionSpec): string {
  let raw = spec.url ?? spec.database ?? ':memory:';

  // 去掉 file: 前缀
  if (raw.startsWith('file:')) {
    raw = raw.slice(5);
  }

  // 去掉可能的 // 前缀（如 file:///path）
  if (raw.startsWith('//')) {
    raw = raw.slice(2);
  }

  // :memory: 直接返回
  if (raw === ':memory:') {
    return ':memory:';
  }

  // 绝对路径直接返回
  if (isAbsolute(raw)) {
    return raw;
  }

  // 相对路径基于 cwd 解析
  return resolve(process.cwd(), raw);
}

/**
 * 确保数据库文件所在目录存在。
 */
function ensureParentDir(filePath: string): void {
  if (filePath === ':memory:') return;
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 将 better-sqlite3 的 Statement.run() 结果适配为 SqlExecuteResult。
 */
function adaptRunResult(info: Database.RunResult, executionTime: number): SqlExecuteResult {
  return {
    success: true,
    affectedRows: Number(info.changes),
    insertId:
      typeof info.lastInsertRowid === 'bigint'
        ? info.lastInsertRowid
        : Number(info.lastInsertRowid),
    executionTime,
  };
}

/**
 * 将 better-sqlite3 的 Statement.all() 结果适配为 SqlExecuteResult。
 */
function adaptRowsResult(
  rows: unknown[],
  maxRows: number,
  executionTime: number,
): SqlExecuteResult {
  const truncated = rows.length > maxRows;
  return {
    success: true,
    data: rows.slice(0, maxRows),
    totalRows: rows.length,
    truncated,
    executionTime,
  };
}

/**
 * 执行单条 SQL 并返回结果。
 * better-sqlite3 是同步的，这里用 try/catch 包装为符合 SqlExecuteResult 的格式。
 */
function executeOne(
  db: Database.Database,
  sql: string,
  params: unknown[],
  mode: SqlExecutionMode,
  maxRows: number,
  maxSqlLength: number,
  engine: 'sqlite',
): SqlExecuteResult {
  if (sql.length > maxSqlLength) {
    return { success: false, error: `SQL 超过长度限制（${maxSqlLength}）` };
  }
  if (mode === 'readonly' && !isSqliteReadOnlyQuery(sql)) {
    return { success: false, error: '只读模式仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN' };
  }
  if (mode === 'readwrite') {
    const d = checkDangerousOperation(sql);
    if (d) return { success: false, error: d };
  }

  const start = Date.now();
  try {
    const stmt = db.prepare(sql);
    const trimmed = sql.trim().toLowerCase();

    // 判断是否为查询语句（返回行的）
    const isQuery =
      trimmed.startsWith('select') ||
      trimmed.startsWith('pragma') ||
      trimmed.startsWith('explain') ||
      trimmed.startsWith('with');

    if (isQuery) {
      const rows = stmt.all(...params) as unknown[];
      const executionTime = Date.now() - start;
      auditLog({ engine, sql, success: true, executionTime });
      return adaptRowsResult(rows, maxRows, executionTime);
    }

    // INSERT / UPDATE / DELETE / CREATE / 等
    const info = stmt.run(...params);
    const executionTime = Date.now() - start;
    auditLog({ engine, sql, success: true, executionTime, affectedRows: Number(info.changes) });
    return adaptRunResult(info, executionTime);
  } catch (e) {
    const executionTime = Date.now() - start;
    const msg = e instanceof Error ? e.message : String(e);
    auditLog({ engine, sql, success: false, error: msg, executionTime });
    return { success: false, error: msg, executionTime };
  }
}

export async function createSqliteDriver(spec: ConnectionSpec): Promise<SqlDriver> {
  const dbPath = resolveDbPath(spec);
  ensureParentDir(dbPath);

  const db = new Database(dbPath);

  // 默认开启 WAL 模式（提升并发读性能）
  db.pragma('journal_mode = WAL');
  // 开启外键约束
  db.pragma('foreign_keys = ON');

  const engine = 'sqlite' as const;

  function runExecute(
    sql: string,
    params: unknown[] | undefined,
    mode: SqlExecutionMode,
    maxRows: number,
    _queryTimeoutMs: number,
    maxSqlLength: number,
  ): SqlExecuteResult {
    // better-sqlite3 不支持查询超时，忽略 queryTimeoutMs
    return executeOne(db, sql, params ?? [], mode, maxRows, maxSqlLength, engine);
  }

  async function beginTransaction(): Promise<SqlTransaction> {
    db.exec('BEGIN');
    let finalised = false;

    return {
      async execute(sql, params, options): Promise<SqlExecuteResult> {
        if (finalised) {
          return { success: false, error: '事务已结束' };
        }
        return runExecute(
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
        db.exec('COMMIT');
      },
      async rollback(): Promise<void> {
        if (finalised) return;
        finalised = true;
        try {
          db.exec('ROLLBACK');
        } catch {
          // 事务可能已被自动回滚
        }
      },
    };
  }

  return {
    engine,

    async ping() {
      try {
        db.prepare('SELECT 1').get();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async execute(sql, params, options) {
      // 如果连接级 readonly 标志开启，强制只读
      const effectiveMode: SqlExecutionMode = spec.readonly ? 'readonly' : options.mode;
      return runExecute(
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
      db.close();
    },
  };
}
