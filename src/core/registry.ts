import type { ConnectionSpec, Engine, RuntimeHandle, SqlEngine } from './types.js';

/** 连接级别的请求指标 */
export interface ConnectionMetrics {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalLatencyMs: number;
  lastUsedAt: number;
  lastError?: string;
}

export class ConnectionRegistry {
  private readonly byId = new Map<string, RuntimeHandle>();
  private readonly defaultId: string;
  private readonly metrics = new Map<string, ConnectionMetrics>();

  constructor(
    private readonly specs: ConnectionSpec[],
    defaultConnectionId: string,
    handles: RuntimeHandle[],
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
      const available = this.specs.map((s) => s.id);
      throw new Error(`未知 connection_id: ${trimmed}。可用连接: [${available.join(', ')}]`);
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
      const available = this.specs.map((s) => s.id);
      throw new Error(`未知 connection_id: ${id}。可用连接: [${available.join(', ')}]`);
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

  /** 记录一次请求的指标 */
  recordRequest(id: string, success: boolean, latencyMs: number, error?: string): void {
    if (!this.byId.has(id)) return;
    let m = this.metrics.get(id);
    if (!m) {
      m = {
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        totalLatencyMs: 0,
        lastUsedAt: 0,
      };
      this.metrics.set(id, m);
    }
    m.totalRequests++;
    if (success) m.successRequests++;
    else {
      m.failedRequests++;
      m.lastError = error;
    }
    m.totalLatencyMs += latencyMs;
    m.lastUsedAt = Date.now();
  }

  /** 获取连接指标 */
  getMetrics(id: string): ConnectionMetrics {
    return (
      this.metrics.get(id) ?? {
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        totalLatencyMs: 0,
        lastUsedAt: 0,
      }
    );
  }

  /** 获取所有连接指标 */
  getAllMetrics(): Map<string, ConnectionMetrics> {
    return new Map(this.metrics);
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
