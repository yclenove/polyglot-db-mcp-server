import { isUtf8 } from 'node:buffer';
import { Redis } from 'ioredis';
import type { ConnectionSpec } from '../../core/types.js';
import type {
  RedisDriver,
  RedisPipelineCommand,
  RedisPipelineCommandName,
  RedisPipelineResult,
} from '../../core/types.js';
import { assertRedisKeyPrefix } from '../../core/redis-guards.js';
import { auditLog } from '../../core/audit.js';
import { globalLimits, responseDataByteLimit } from '../../core/config.js';

const REDIS_PIPELINE_WRITE_COMMANDS = new Set<RedisPipelineCommandName>([
  'set',
  'del',
  'hset',
  'hdel',
  'lpush',
  'rpush',
  'lpop',
  'rpop',
  'sadd',
  'srem',
  'zadd',
  'zrem',
  'expire',
]);

const REDIS_PIPELINE_UNBOUNDED_READ_COMMANDS = new Set<RedisPipelineCommandName>([
  'hgetall',
  'lrange',
  'smembers',
  'zrange',
]);

function safeScanCount(count: number): number {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('Redis SCAN count 必须是正整数');
  }
  return Math.min(count, globalLimits().maxRows, 500);
}

function assertScanCursor(cursor: string): void {
  if (!/^\d+$/.test(cursor)) {
    throw new Error('Redis SCAN cursor 必须是非负整数字符串');
  }
}

function assertCollectionItemLimit(
  operation: string,
  itemCount: number,
  alternative: string,
): void {
  const limit = globalLimits().maxRows;
  if (itemCount > limit) {
    throw new Error(
      `${operation} 将返回 ${itemCount} 项，超过 DB_MAX_ROWS=${limit}；请使用 ${alternative} 分页读取`,
    );
  }
}

async function assertLegacyKeyMemoryLimit(
  redis: Redis,
  key: string,
  operation: string,
  alternative: string,
): Promise<void> {
  let raw: unknown;
  try {
    raw = await redis.call('MEMORY', 'USAGE', key);
  } catch {
    // MEMORY USAGE may be unavailable or denied by ACL; item-count and protocol caps still apply.
    return;
  }
  const memoryBytes = typeof raw === 'number' ? raw : Number(raw);
  const byteLimit = responseDataByteLimit();
  if (Number.isFinite(memoryBytes) && memoryBytes > byteLimit) {
    throw new Error(
      `${operation} 目标 key 约占 ${memoryBytes} 字节，超过响应数据上限 ${byteLimit} 字节；请使用 ${alternative} 分页读取`,
    );
  }
}

function encodeRedisWindowValue(value: Buffer | null): {
  value: string | null;
  valueBase64?: string;
  valueEncoding: 'utf8' | 'base64' | null;
} {
  if (value === null) return { value: null, valueEncoding: null };
  if (isUtf8(value)) return { value: value.toString('utf8'), valueEncoding: 'utf8' };
  return {
    value: null,
    valueBase64: value.toString('base64'),
    valueEncoding: 'base64',
  };
}

/** Calculate the number of Redis list/zset members selected by an inclusive range. */
export function redisRangeItemCount(start: number, stop: number, total: number): number {
  if (total <= 0) return 0;
  let normalizedStart = start < 0 ? total + start : start;
  let normalizedStop = stop < 0 ? total + stop : stop;
  normalizedStart = Math.max(0, normalizedStart);
  if (normalizedStop < 0 || normalizedStart >= total || normalizedStart > normalizedStop) return 0;
  normalizedStop = Math.min(total - 1, normalizedStop);
  return normalizedStop - normalizedStart + 1;
}

function stringArg(command: RedisPipelineCommand, index: number): string {
  const value = command.args?.[index];
  if (typeof value !== 'string') {
    throw new Error(`Redis pipeline 命令 ${command.command} 的参数 ${index + 1} 必须是字符串`);
  }
  return value;
}

function stringArgs(command: RedisPipelineCommand): string[] {
  const args = command.args ?? [];
  if (args.length === 0) {
    throw new Error(`Redis pipeline 命令 ${command.command} 至少需要一个字符串参数`);
  }
  if (!args.every((value) => typeof value === 'string')) {
    throw new Error(`Redis pipeline 命令 ${command.command} 的参数必须全是字符串`);
  }
  return args as string[];
}

function intArg(command: RedisPipelineCommand, index: number): number {
  const value = command.args?.[index];
  if (!Number.isInteger(value)) {
    throw new Error(`Redis pipeline 命令 ${command.command} 的参数 ${index + 1} 必须是整数`);
  }
  return value as number;
}

function numberArg(command: RedisPipelineCommand, index: number): number {
  const value = command.args?.[index];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Redis pipeline 命令 ${command.command} 的参数 ${index + 1} 必须是数字`);
  }
  return value;
}

function booleanArg(command: RedisPipelineCommand, index: number): boolean | undefined {
  const value = command.args?.[index];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`Redis pipeline 命令 ${command.command} 的参数 ${index + 1} 必须是布尔值`);
  }
  return value;
}

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
      const byteLimit = responseDataByteLimit();
      const value = await redis.getrangeBuffer(key, 0, byteLimit);
      if (value.length > byteLimit) {
        const byteLength = Math.max(value.length, await redis.strlen(key));
        throw new Error(
          `Redis 字符串大小 ${byteLength} 字节，超过响应数据上限 ${byteLimit} 字节；请使用 getWindow 分段读取`,
        );
      }
      const exists = value.length > 0 || (await redis.exists(key)) === 1;
      auditLog({ engine: 'redis', op: 'get', key });
      return exists ? value.toString('utf8') : null;
    },
    async getWindow(key: string, offsetBytes: number, maxBytes: number) {
      assertRedisKeyPrefix(key, prefix);
      if (!Number.isSafeInteger(offsetBytes) || offsetBytes < 0) {
        throw new Error('Redis GET 字节偏移必须是非负整数');
      }
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new Error('Redis GET 字节窗口必须是正整数');
      }

      const safeMaxBytes = Math.min(maxBytes, responseDataByteLimit());
      const totalBytes = await redis.strlen(key);
      if (totalBytes === 0) {
        const value = (await redis.exists(key)) === 1 ? Buffer.alloc(0) : null;
        auditLog({ engine: 'redis', op: 'getrange', key, offsetBytes, maxBytes: safeMaxBytes });
        return {
          ...encodeRedisWindowValue(value),
          totalBytes,
          offsetBytes: 0,
          returnedBytes: 0,
          nextOffsetBytes: null,
          truncated: false,
        };
      }

      const start = Math.min(offsetBytes, totalBytes);
      if (start >= totalBytes) {
        auditLog({ engine: 'redis', op: 'getrange', key, offsetBytes, maxBytes: safeMaxBytes });
        return {
          ...encodeRedisWindowValue(Buffer.alloc(0)),
          totalBytes,
          offsetBytes: start,
          returnedBytes: 0,
          nextOffsetBytes: null,
          truncated: start > 0,
        };
      }

      const end = Math.min(totalBytes - 1, start + safeMaxBytes - 1);
      const value = await redis.getrangeBuffer(key, start, end);
      const nextOffsetBytes = end + 1 < totalBytes ? end + 1 : null;
      auditLog({
        engine: 'redis',
        op: 'getrange',
        key,
        offsetBytes: start,
        maxBytes: safeMaxBytes,
      });
      return {
        ...encodeRedisWindowValue(value),
        totalBytes,
        offsetBytes: start,
        returnedBytes: end - start + 1,
        nextOffsetBytes,
        truncated: start > 0 || nextOffsetBytes !== null,
      };
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
      assertScanCursor(cursor);
      const safeCount = safeScanCount(count);
      const [next, keys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', safeCount);
      const filtered = prefix ? keys.filter((k: string) => k.startsWith(prefix)) : keys;
      return { cursor: next, keys: filtered };
    },
    async hget(key: string, field: string) {
      assertRedisKeyPrefix(key, prefix);
      const byteLength = await redis.hstrlen(key, field);
      const byteLimit = responseDataByteLimit();
      if (byteLength > byteLimit) {
        throw new Error(
          `Redis Hash 字段大小 ${byteLength} 字节，超过响应数据上限 ${byteLimit} 字节，拒绝完整读取`,
        );
      }
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
      const itemCount = await redis.hlen(key);
      assertCollectionItemLimit('HGETALL', itemCount, 'redis_hscan');
      await assertLegacyKeyMemoryLimit(redis, key, 'HGETALL', 'redis_hscan');
      const v = await redis.hgetall(key);
      auditLog({ engine: 'redis', op: 'hgetall', key });
      return v;
    },
    async hscan(key: string, cursor: string, count: number, match = '*') {
      assertRedisKeyPrefix(key, prefix);
      assertScanCursor(cursor);
      const safeCount = safeScanCount(count);
      const [next, values] = await redis.hscan(key, cursor, 'MATCH', match, 'COUNT', safeCount);
      const entries: { field: string; value: string }[] = [];
      for (let index = 0; index + 1 < values.length; index += 2) {
        entries.push({ field: values[index]!, value: values[index + 1]! });
      }
      auditLog({ engine: 'redis', op: 'hscan', key, cursor, count: safeCount, match });
      return { cursor: next, entries };
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
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop)) {
        throw new Error('Redis LRANGE start/stop 必须是安全整数');
      }
      const total = await redis.llen(key);
      assertCollectionItemLimit('LRANGE', redisRangeItemCount(start, stop, total), '较小范围');
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
      const itemCount = await redis.scard(key);
      assertCollectionItemLimit('SMEMBERS', itemCount, 'redis_sscan');
      await assertLegacyKeyMemoryLimit(redis, key, 'SMEMBERS', 'redis_sscan');
      const v = await redis.smembers(key);
      auditLog({ engine: 'redis', op: 'smembers', key });
      return v;
    },
    async sscan(key: string, cursor: string, count: number, match = '*') {
      assertRedisKeyPrefix(key, prefix);
      assertScanCursor(cursor);
      const safeCount = safeScanCount(count);
      const [next, members] = await redis.sscan(key, cursor, 'MATCH', match, 'COUNT', safeCount);
      auditLog({ engine: 'redis', op: 'sscan', key, cursor, count: safeCount, match });
      return { cursor: next, members };
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
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop)) {
        throw new Error('Redis ZRANGE start/stop 必须是安全整数');
      }
      const total = await redis.zcard(key);
      assertCollectionItemLimit('ZRANGE', redisRangeItemCount(start, stop, total), '较小范围');
      let v: string[];
      if (withScores) {
        v = await redis.zrange(key, start, stop, 'WITHSCORES');
      } else {
        v = await redis.zrange(key, start, stop);
      }
      auditLog({ engine: 'redis', op: 'zrange', key, start, stop, withScores });
      return v;
    },
    async zscan(key: string, cursor: string, count: number, match = '*') {
      assertRedisKeyPrefix(key, prefix);
      assertScanCursor(cursor);
      const safeCount = safeScanCount(count);
      const [next, values] = await redis.zscan(key, cursor, 'MATCH', match, 'COUNT', safeCount);
      const entries: { member: string; score: string }[] = [];
      for (let index = 0; index + 1 < values.length; index += 2) {
        entries.push({ member: values[index]!, score: values[index + 1]! });
      }
      auditLog({ engine: 'redis', op: 'zscan', key, cursor, count: safeCount, match });
      return { cursor: next, entries };
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
    async pipeline(commands: RedisPipelineCommand[]): Promise<RedisPipelineResult[]> {
      if (commands.length === 0) {
        throw new Error('Redis pipeline 命令列表不能为空');
      }
      if (commands.length > 100) {
        throw new Error('Redis pipeline 单次最多允许 100 条命令');
      }

      for (const command of commands) {
        assertRedisKeyPrefix(command.key, prefix);
        if (spec.readonly && REDIS_PIPELINE_WRITE_COMMANDS.has(command.command)) {
          throw new Error('该 Redis 连接为只读');
        }
        if (REDIS_PIPELINE_UNBOUNDED_READ_COMMANDS.has(command.command)) {
          throw new Error(
            `Redis pipeline 禁止集合物化命令 ${command.command}；请使用对应的分页工具或单独的受限范围工具`,
          );
        }
      }

      const valueLengths = await Promise.all(
        commands.flatMap((command) => {
          if (command.command === 'get') return [redis.strlen(command.key)];
          if (command.command === 'hget') {
            return [redis.hstrlen(command.key, stringArg(command, 0))];
          }
          return [];
        }),
      );
      const totalValueBytes = valueLengths.reduce((sum, length) => sum + length, 0);
      const valueByteLimit = responseDataByteLimit();
      if (totalValueBytes > valueByteLimit) {
        throw new Error(
          `Redis pipeline 字符串结果共 ${totalValueBytes} 字节，超过响应数据上限 ${valueByteLimit} 字节`,
        );
      }

      const pipeline = redis.pipeline();

      for (const command of commands) {
        switch (command.command) {
          case 'get':
            pipeline.get(command.key);
            break;
          case 'set': {
            const value = stringArg(command, 0);
            const ttlSeconds = command.args?.[1];
            if (ttlSeconds === undefined) {
              pipeline.set(command.key, value);
            } else if (Number.isInteger(ttlSeconds) && (ttlSeconds as number) > 0) {
              pipeline.set(command.key, value, 'EX', ttlSeconds as number);
            } else {
              throw new Error('Redis pipeline 命令 set 的 ttl_seconds 必须是正整数');
            }
            break;
          }
          case 'del':
            pipeline.del(command.key);
            break;
          case 'hget':
            pipeline.hget(command.key, stringArg(command, 0));
            break;
          case 'hset':
            pipeline.hset(command.key, stringArg(command, 0), stringArg(command, 1));
            break;
          case 'hgetall':
            pipeline.hgetall(command.key);
            break;
          case 'hdel':
            pipeline.hdel(command.key, stringArg(command, 0));
            break;
          case 'lpush':
            pipeline.lpush(command.key, ...stringArgs(command));
            break;
          case 'rpush':
            pipeline.rpush(command.key, ...stringArgs(command));
            break;
          case 'lpop':
            pipeline.lpop(command.key);
            break;
          case 'rpop':
            pipeline.rpop(command.key);
            break;
          case 'lrange':
            pipeline.lrange(command.key, intArg(command, 0), intArg(command, 1));
            break;
          case 'llen':
            pipeline.llen(command.key);
            break;
          case 'sadd':
            pipeline.sadd(command.key, ...stringArgs(command));
            break;
          case 'smembers':
            pipeline.smembers(command.key);
            break;
          case 'srem':
            pipeline.srem(command.key, ...stringArgs(command));
            break;
          case 'scard':
            pipeline.scard(command.key);
            break;
          case 'sismember':
            pipeline.sismember(command.key, stringArg(command, 0));
            break;
          case 'zadd':
            pipeline.zadd(command.key, numberArg(command, 0), stringArg(command, 1));
            break;
          case 'zrange': {
            const start = intArg(command, 0);
            const stop = intArg(command, 1);
            const withScores = booleanArg(command, 2);
            if (withScores) {
              pipeline.zrange(command.key, start, stop, 'WITHSCORES');
            } else {
              pipeline.zrange(command.key, start, stop);
            }
            break;
          }
          case 'zrem':
            pipeline.zrem(command.key, ...stringArgs(command));
            break;
          case 'zcard':
            pipeline.zcard(command.key);
            break;
          case 'zscore':
            pipeline.zscore(command.key, stringArg(command, 0));
            break;
          case 'type':
            pipeline.type(command.key);
            break;
          case 'expire':
            pipeline.expire(command.key, intArg(command, 0));
            break;
          case 'ttl':
            pipeline.ttl(command.key);
            break;
          default: {
            const neverCommand: never = command.command;
            throw new Error(`不支持的 Redis pipeline 命令: ${neverCommand}`);
          }
        }
      }

      const rawResults = (await pipeline.exec()) ?? [];
      auditLog({ engine: 'redis', op: 'pipeline', count: commands.length });
      return commands.map((command, index) => {
        const item = rawResults[index];
        const error = item?.[0];
        return {
          index,
          command: command.command,
          key: command.key,
          ok: !error,
          result: item?.[1],
          error: error ? error.message : undefined,
        };
      });
    },
    async close() {
      redis.disconnect();
    },
  };
}
