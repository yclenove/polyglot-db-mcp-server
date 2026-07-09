/**
 * 简易 LRU 查询缓存，用于缓存只读查询结果。
 * 通过 DB_QUERY_CACHE_SIZE 环境变量启用（默认 0 = 禁用）。
 */

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

type SerializedValue = readonly [string, unknown?];

export class QueryCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 0, ttlMs: number = 30_000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): unknown | undefined {
    if (this.maxSize <= 0) return undefined;
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    // LRU: 移到末尾
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  set(key: string, data: unknown): void {
    if (this.maxSize <= 0) return;
    if (this.cache.size >= this.maxSize) {
      // 删除最旧的条目
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  getStats(): {
    enabled: boolean;
    maxSize: number;
    ttlMs: number;
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      enabled: this.maxSize > 0,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Math.round((this.hits / total) * 10000) / 100 : 0,
    };
  }
}

/** 从环境变量创建全局查询缓存实例 */
export function createQueryCacheFromEnv(): QueryCache {
  const size = parseInt(process.env.DB_QUERY_CACHE_SIZE || '0', 10);
  const ttlMs = parseInt(process.env.DB_QUERY_CACHE_TTL_MS || '30000', 10);
  return new QueryCache(size, ttlMs);
}

/** 生成缓存键 */
export function cacheKey(connectionId: string, sql: string, params: unknown[]): string {
  return JSON.stringify({
    connectionId,
    sql,
    params: stableSerialize(params, new WeakSet<object>()),
  });
}

function stableSerialize(value: unknown, seen: WeakSet<object>): SerializedValue {
  if (value === null) return ['null'];

  switch (typeof value) {
    case 'undefined':
      return ['undefined'];
    case 'string':
      return ['string', value];
    case 'boolean':
      return ['boolean', value];
    case 'number':
      if (Number.isNaN(value)) return ['number', 'NaN'];
      if (value === Infinity) return ['number', 'Infinity'];
      if (value === -Infinity) return ['number', '-Infinity'];
      if (Object.is(value, -0)) return ['number', '-0'];
      return ['number', value];
    case 'bigint':
      return ['bigint', value.toString()];
    case 'symbol':
      return ['symbol', String(value.description ?? '')];
    case 'function':
      return ['function', value.name || 'anonymous'];
    case 'object':
      break;
  }

  if (value instanceof Date) {
    return ['date', value.toISOString()];
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('缓存参数包含循环引用，无法生成缓存键');
    seen.add(value);
    const out = value.map((item) => stableSerialize(item, seen));
    seen.delete(value);
    return ['array', out];
  }

  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) throw new Error('缓存参数包含循环引用，无法生成缓存键');
  seen.add(obj);
  const out = Object.keys(obj)
    .sort()
    .map((key) => [key, stableSerialize(obj[key], seen)] as const);
  seen.delete(obj);
  return ['object', out];
}
