import type { ConnectionSpec, Engine, RuntimeHandle, SqlEngine } from './types.js';

export class ConnectionRegistry {
  private readonly byId = new Map<string, RuntimeHandle>();
  private readonly defaultId: string;

  constructor(
    private readonly specs: ConnectionSpec[],
    defaultConnectionId: string,
    handles: RuntimeHandle[]
  ) {
    this.defaultId = defaultConnectionId;
    if (!specs.some((s) => s.id === defaultConnectionId)) {
      throw new Error(`默认连接 id「${defaultConnectionId}」不在 DB_MCP_CONNECTIONS 中`);
    }
    for (const h of handles) {
      if (!specs.some((s) => s.id === h.id)) {
        throw new Error(`内部错误：handle id「${h.id}」不在 specs 中`);
      }
      this.byId.set(h.id, h);
    }
    if (this.byId.size !== specs.length) {
      throw new Error('DB_MCP_CONNECTIONS 中的连接数与已建立句柄数不一致');
    }
  }

  getSpecs(): ReadonlyArray<ConnectionSpec> {
    return this.specs;
  }

  resolveConnectionId(connectionId?: string): string {
    if (connectionId === undefined || connectionId === null) {
      return this.defaultId;
    }
    const trimmed = String(connectionId).trim();
    if (trimmed === '') {
      return this.defaultId;
    }
    if (!this.byId.has(trimmed)) {
      throw new Error(`未知 connection_id: ${trimmed}`);
    }
    return trimmed;
  }

  getDefaultId(): string {
    return this.defaultId;
  }

  get(id: string): RuntimeHandle | undefined {
    return this.byId.get(id);
  }

  require(id: string): RuntimeHandle {
    const h = this.byId.get(id);
    if (!h) {
      throw new Error(`未知 connection_id: ${id}`);
    }
    return h;
  }

  listMeta(): { id: string; engine: Engine; readonly: boolean }[] {
    return this.specs.map((s) => ({ id: s.id, engine: s.engine, readonly: s.readonly === true }));
  }

  requireSql(id: string, allowed?: ReadonlySet<SqlEngine>): import('./types.js').SqlDriver {
    const h = this.require(id);
    if (h.kind !== 'sql') {
      throw new Error(`连接「${id}」引擎为 ${h.spec.engine}，不能用于 SQL 工具`);
    }
    if (allowed && !allowed.has(h.driver.engine)) {
      throw new Error(`连接「${id}」引擎 ${h.driver.engine} 与此工具不兼容`);
    }
    return h.driver;
  }

  requireMongo(id: string): import('./types.js').MongoDriver {
    const h = this.require(id);
    if (h.kind !== 'mongo') {
      throw new Error(`连接「${id}」不是 MongoDB，不能用于 mongo_* 工具`);
    }
    return h.driver;
  }

  requireRedis(id: string): import('./types.js').RedisDriver {
    const h = this.require(id);
    if (h.kind !== 'redis') {
      throw new Error(`连接「${id}」不是 Redis，不能用于 redis_* 工具`);
    }
    return h.driver;
  }

  engineOf(id: string): Engine | undefined {
    return this.byId.get(id)?.spec.engine;
  }

  assertAllowlistDb(connectionId: string, databaseName: string | undefined): void {
    const spec = this.require(connectionId).spec;
    if (!spec.allowlist?.length) return;
    if (!databaseName) return;
    if (!spec.allowlist.includes(databaseName)) {
      throw new Error(`数据库/库「${databaseName}」不在连接「${connectionId}」的 allowlist 中`);
    }
  }
}
