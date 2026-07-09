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
    async hget(key: string, field: string) {
      assertRedisKeyPrefix(key, prefix);
      const v = await redis.hget(key, field);
      auditLog({ engine: 'redis', op: 'hget', key, field });
      return v;
    },
    async hset(key: string, field: string, value: string) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      await redis.hset(key, field, value);
      auditLog({ engine: 'redis', op: 'hset', key, field });
    },
    async hgetall(key: string) {
      assertRedisKeyPrefix(key, prefix);
      const v = await redis.hgetall(key);
      auditLog({ engine: 'redis', op: 'hgetall', key });
      return v;
    },
    async hdel(key: string, field: string) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.hdel(key, field);
      auditLog({ engine: 'redis', op: 'hdel', key, field });
      return n;
    },
    // List 操作
    async lpush(key: string, ...values: string[]) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.lpush(key, ...values);
      auditLog({ engine: 'redis', op: 'lpush', key, count: values.length });
      return n;
    },
    async rpush(key: string, ...values: string[]) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.rpush(key, ...values);
      auditLog({ engine: 'redis', op: 'rpush', key, count: values.length });
      return n;
    },
    async lpop(key: string) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const v = await redis.lpop(key);
      auditLog({ engine: 'redis', op: 'lpop', key });
      return v;
    },
    async rpop(key: string) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const v = await redis.rpop(key);
      auditLog({ engine: 'redis', op: 'rpop', key });
      return v;
    },
    async lrange(key: string, start: number, stop: number) {
      assertRedisKeyPrefix(key, prefix);
      const v = await redis.lrange(key, start, stop);
      auditLog({ engine: 'redis', op: 'lrange', key, start, stop });
      return v;
    },
    async llen(key: string) {
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.llen(key);
      auditLog({ engine: 'redis', op: 'llen', key });
      return n;
    },
    // Set 操作
    async sadd(key: string, ...members: string[]) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.sadd(key, ...members);
      auditLog({ engine: 'redis', op: 'sadd', key, count: members.length });
      return n;
    },
    async smembers(key: string) {
      assertRedisKeyPrefix(key, prefix);
      const v = await redis.smembers(key);
      auditLog({ engine: 'redis', op: 'smembers', key });
      return v;
    },
    async srem(key: string, ...members: string[]) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.srem(key, ...members);
      auditLog({ engine: 'redis', op: 'srem', key, count: members.length });
      return n;
    },
    async scard(key: string) {
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.scard(key);
      auditLog({ engine: 'redis', op: 'scard', key });
      return n;
    },
    async sismember(key: string, member: string) {
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.sismember(key, member);
      auditLog({ engine: 'redis', op: 'sismember', key, member });
      return n;
    },
    // Sorted Set 操作
    async zadd(key: string, score: number, member: string) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.zadd(key, score, member);
      auditLog({ engine: 'redis', op: 'zadd', key, score, member });
      return n;
    },
    async zrange(key: string, start: number, stop: number, withScores?: boolean) {
      assertRedisKeyPrefix(key, prefix);
      let v: string[];
      if (withScores) {
        v = await redis.zrange(key, start, stop, 'WITHSCORES');
      } else {
        v = await redis.zrange(key, start, stop);
      }
      auditLog({ engine: 'redis', op: 'zrange', key, start, stop, withScores });
      return v;
    },
    async zrem(key: string, ...members: string[]) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.zrem(key, ...members);
      auditLog({ engine: 'redis', op: 'zrem', key, count: members.length });
      return n;
    },
    async zcard(key: string) {
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.zcard(key);
      auditLog({ engine: 'redis', op: 'zcard', key });
      return n;
    },
    async zscore(key: string, member: string) {
      assertRedisKeyPrefix(key, prefix);
      const v = await redis.zscore(key, member);
      auditLog({ engine: 'redis', op: 'zscore', key, member });
      return v;
    },
    // 键管理
    async type(key: string) {
      assertRedisKeyPrefix(key, prefix);
      const t = await redis.type(key);
      auditLog({ engine: 'redis', op: 'type', key });
      return t;
    },
    async expire(key: string, seconds: number) {
      if (spec.readonly) {
        throw new Error('该 Redis 连接为只读');
      }
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.expire(key, seconds);
      auditLog({ engine: 'redis', op: 'expire', key, seconds });
      return n;
    },
    async ttl(key: string) {
      assertRedisKeyPrefix(key, prefix);
      const n = await redis.ttl(key);
      auditLog({ engine: 'redis', op: 'ttl', key });
      return n;
    },
    async close() {
      redis.disconnect();
    },
  };
}
