import { Redis } from 'ioredis';
import type { ConnectionSpec } from '../../core/types.js';
import type { RedisDriver } from '../../core/types.js';
import { assertRedisKeyPrefix } from '../../core/redis-guards.js';
import { auditLog } from '../../core/audit.js';

export async function createRedisDriver(spec: ConnectionSpec): Promise<RedisDriver> {
  const url = spec.url;
  if (!url) {
    throw new Error('Redis 连接需要 url（如 redis://localhost:6379/0）');
  }
  const redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  const prefix = spec.keyPrefix;

  return {
    async ping() {
      try {
        const p = await redis.ping();
        return { ok: p === 'PONG' };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async get(key: string) {
      assertRedisKeyPrefix(key, prefix);
      const v = await redis.get(key);
      auditLog({ engine: 'redis', op: 'get', key });
      return v;
    },
    async set(key: string, value: string, ttlSeconds?: number) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      if (ttlSeconds && ttlSeconds > 0) {
        await redis.set(key, value, 'EX', ttlSeconds);
      } else {
        await redis.set(key, value);
      }
      auditLog({ engine: 'redis', op: 'set', key });
    },
    async del(key: string) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.del(key);
      auditLog({ engine: 'redis', op: 'del', key });
      return n;
    },
    async scan(match: string, cursor: string, count: number) {
      const safeCount = Math.min(Math.max(count, 1), 500);
      const [next, keys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', safeCount);
      const filtered = prefix ? keys.filter((k: string) => k.startsWith(prefix)) : keys;
      return { cursor: next, keys: filtered };
    },
    async close() {
      redis.disconnect();
    },
  };
}
