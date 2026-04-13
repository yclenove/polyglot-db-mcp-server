export const CONNECTION_ID_REGEX = /^[A-Za-z0-9_]+$/;

export type SqlEngine = 'mysql' | 'postgres' | 'mssql' | 'oracle';
export type Engine = SqlEngine | 'mongodb' | 'redis';

export interface ConnectionSpec {
  id: string;
  engine: Engine;
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  readonly?: boolean;
  /** 库名 / schema / collection 命名空间等，按引擎解释 */
  allowlist?: string[];
  /** Redis：要求 key 必须以前缀开头（若设置） */
  keyPrefix?: string;
}

export type SqlExecutionMode = 'readonly' | 'readwrite';

export interface SqlExecuteResult {
  success: boolean;
  data?: unknown[];
  affectedRows?: number;
  insertId?: number | bigint;
  error?: string;
  executionTime?: number;
  truncated?: boolean;
  totalRows?: number;
  fields?: { name: string; dataTypeID?: number }[];
}

export interface SqlDriver {
  readonly engine: SqlEngine;
  ping(): Promise<{ ok: boolean; error?: string }>;
  execute(
    sql: string,
    params: unknown[] | undefined,
    options: {
      mode: SqlExecutionMode;
      maxRows: number;
      queryTimeoutMs: number;
      maxSqlLength: number;
    }
  ): Promise<SqlExecuteResult>;
  close(): Promise<void>;
}

export interface MongoDriver {
  ping(): Promise<{ ok: boolean; error?: string }>;
  listCollections(): Promise<string[]>;
  find(collection: string, filter: Record<string, unknown>, options: { limit: number; skip?: number }): Promise<unknown[]>;
  aggregate(collection: string, pipeline: unknown[]): Promise<unknown[]>;
  count(collection: string, filter: Record<string, unknown>): Promise<number>;
  close(): Promise<void>;
}

export interface RedisDriver {
  ping(): Promise<{ ok: boolean; error?: string }>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<number>;
  scan(match: string, cursor: string, count: number): Promise<{ cursor: string; keys: string[] }>;
  close(): Promise<void>;
}

export type RuntimeHandle =
  | { id: string; spec: ConnectionSpec; kind: 'sql'; driver: SqlDriver }
  | { id: string; spec: ConnectionSpec; kind: 'mongo'; driver: MongoDriver }
  | { id: string; spec: ConnectionSpec; kind: 'redis'; driver: RedisDriver };

export const SQL_ENGINES: ReadonlySet<Engine> = new Set(['mysql', 'postgres', 'mssql', 'oracle']);

export function isSqlEngine(engine: Engine): engine is SqlEngine {
  return SQL_ENGINES.has(engine);
}
