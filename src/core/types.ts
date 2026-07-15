export const CONNECTION_ID_REGEX = /^[A-Za-z0-9_]+$/;

export type SqlEngine = 'mysql' | 'postgres' | 'mssql' | 'oracle' | 'sqlite' | 'duckdb';
export type BuiltinEngine = SqlEngine | 'mongodb' | 'redis';
export type Engine = BuiltinEngine | (string & {});

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
  insertId?: number | string | bigint;
  error?: string;
  executionTime?: number;
  truncated?: boolean;
  totalRows?: number;
  /** `false` means totalRows is only the number observed before a hard fetch cap. */
  totalRowsExact?: boolean;
  truncatedBy?: 'rows' | 'bytes';
  returnedBytes?: number;
  fields?: { name: string; dataTypeID?: number }[];
}

export interface SqlExecuteOptions {
  mode: SqlExecutionMode;
  maxRows: number;
  queryTimeoutMs: number;
  maxSqlLength: number;
  maxBytes?: number;
}

export interface SqlTransaction {
  execute(
    sql: string,
    params: unknown[] | undefined,
    options: SqlExecuteOptions,
  ): Promise<SqlExecuteResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface SqlDriver {
  readonly engine: SqlEngine;
  ping(): Promise<{ ok: boolean; error?: string }>;
  execute(
    sql: string,
    params: unknown[] | undefined,
    options: SqlExecuteOptions,
  ): Promise<SqlExecuteResult>;
  beginTransaction(): Promise<SqlTransaction>;
  close(): Promise<void>;
}

export interface MongoInsertResult {
  acknowledged: boolean;
  insertedId: unknown;
  insertedCount: number;
}

export interface MongoUpdateResult {
  acknowledged: boolean;
  matchedCount: number;
  modifiedCount: number;
  upsertedId: unknown;
}

export interface MongoDeleteResult {
  acknowledged: boolean;
  deletedCount: number;
}

export interface MongoReadResult {
  data: unknown[];
  totalRows: number;
  totalRowsExact: boolean;
  truncated: boolean;
  truncatedBy?: 'rows' | 'bytes';
  returnedBytes: number;
}

export interface MongoDriver {
  ping(): Promise<{ ok: boolean; error?: string }>;
  listCollections(): Promise<string[]>;
  find(
    collection: string,
    filter: Record<string, unknown>,
    options: { limit: number; skip?: number; maxBytes?: number },
  ): Promise<MongoReadResult>;
  aggregate(
    collection: string,
    pipeline: unknown[],
    options?: { limit?: number; maxBytes?: number },
  ): Promise<MongoReadResult>;
  count(collection: string, filter: Record<string, unknown>): Promise<number>;
  insertOne(collection: string, document: Record<string, unknown>): Promise<MongoInsertResult>;
  insertMany(collection: string, documents: Record<string, unknown>[]): Promise<MongoInsertResult>;
  updateOne(
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean },
  ): Promise<MongoUpdateResult>;
  updateMany(
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<MongoUpdateResult>;
  deleteOne(collection: string, filter: Record<string, unknown>): Promise<MongoDeleteResult>;
  deleteMany(collection: string, filter: Record<string, unknown>): Promise<MongoDeleteResult>;
  findOneAndUpdate(
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean; returnDocument?: 'before' | 'after' },
  ): Promise<unknown | null>;
  findOneAndDelete(collection: string, filter: Record<string, unknown>): Promise<unknown | null>;
  dropCollection(collection: string): Promise<boolean>;
  renameCollection(collection: string, newName: string): Promise<string>;
  listIndexes(collection: string): Promise<unknown[]>;
  createIndex(
    collection: string,
    keys: Record<string, 1 | -1>,
    options?: { name?: string; unique?: boolean; sparse?: boolean },
  ): Promise<string>;
  beginTransaction(): Promise<MongoTransaction>;
  close(): Promise<void>;
}

export type MongoTransactionOperationName =
  | 'insert_one'
  | 'insert_many'
  | 'update_one'
  | 'update_many'
  | 'delete_one'
  | 'delete_many';

export interface MongoTransactionOperation {
  operation: MongoTransactionOperationName;
  collection: string;
  document?: Record<string, unknown>;
  documents?: Record<string, unknown>[];
  filter?: Record<string, unknown>;
  update?: Record<string, unknown>;
  options?: { upsert?: boolean };
}

export interface MongoTransactionOperationResult {
  operation: MongoTransactionOperationName;
  collection: string;
  result: unknown;
}

export interface MongoTransaction {
  execute(operation: MongoTransactionOperation): Promise<MongoTransactionOperationResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface RedisDriver {
  ping(): Promise<{ ok: boolean; error?: string }>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<number>;
  scan(match: string, cursor: string, count: number): Promise<{ cursor: string; keys: string[] }>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, field: string): Promise<number>;
  // List 操作
  lpush(key: string, ...values: string[]): Promise<number>;
  rpush(key: string, ...values: string[]): Promise<number>;
  lpop(key: string): Promise<string | null>;
  rpop(key: string): Promise<string | null>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  // Set 操作
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, ...members: string[]): Promise<number>;
  scard(key: string): Promise<number>;
  sismember(key: string, member: string): Promise<number>;
  // Sorted Set 操作
  zadd(key: string, score: number, member: string): Promise<number>;
  zrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zcard(key: string): Promise<number>;
  zscore(key: string, member: string): Promise<string | null>;
  // 键管理
  type(key: string): Promise<string>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  pipeline(commands: RedisPipelineCommand[]): Promise<RedisPipelineResult[]>;
  close(): Promise<void>;
}

export type RedisPipelineCommandName =
  | 'get'
  | 'set'
  | 'del'
  | 'hget'
  | 'hset'
  | 'hgetall'
  | 'hdel'
  | 'lpush'
  | 'rpush'
  | 'lpop'
  | 'rpop'
  | 'lrange'
  | 'llen'
  | 'sadd'
  | 'smembers'
  | 'srem'
  | 'scard'
  | 'sismember'
  | 'zadd'
  | 'zrange'
  | 'zrem'
  | 'zcard'
  | 'zscore'
  | 'type'
  | 'expire'
  | 'ttl';

export interface RedisPipelineCommand {
  command: RedisPipelineCommandName;
  key: string;
  args?: unknown[];
}

export interface RedisPipelineResult {
  index: number;
  command: RedisPipelineCommandName;
  key: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface PluginRuntimeDriver {
  ping(): Promise<{ ok: boolean; error?: string }>;
  close(): Promise<void>;
}

export type RuntimeHandle =
  | { id: string; spec: ConnectionSpec; kind: 'sql'; driver: SqlDriver }
  | { id: string; spec: ConnectionSpec; kind: 'mongo'; driver: MongoDriver }
  | { id: string; spec: ConnectionSpec; kind: 'redis'; driver: RedisDriver }
  | { id: string; spec: ConnectionSpec; kind: 'plugin'; driver: PluginRuntimeDriver };

export const SQL_ENGINES: ReadonlySet<string> = new Set([
  'mysql',
  'postgres',
  'mssql',
  'oracle',
  'sqlite',
  'duckdb',
]);

export function isSqlEngine(engine: Engine): engine is SqlEngine {
  return SQL_ENGINES.has(engine);
}
