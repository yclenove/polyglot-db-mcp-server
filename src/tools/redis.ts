import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry.js';
import { REDIS_BLOCKED_COMMANDS } from '../core/redis-guards.js';

export function registerRedisTools(server: McpServer, registry: ConnectionRegistry): void {
  server.registerTool(
    'redis_get',
    {
      description: '读取 Redis 字符串键值。遵守连接 keyPrefix。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const v = await r.get(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, value: v }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_set',
    {
      description: '写入 Redis 字符串键。只读连接拒绝。可选 ttl_seconds。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        value: z.string(),
        ttl_seconds: z.number().int().min(1).max(8640000).optional(),
      },
    },
    async ({ connection_id, key, value, ttl_seconds }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        await r.set(key, value, ttl_seconds);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, ok: true }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_del',
    {
      description: '删除 Redis 键。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.del(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, deleted: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_scan',
    {
      description:
        '使用 SCAN 迭代键（禁止 KEYS）。cursor 首次传 "0"；match 支持 glob；count 最大 500。返回 next_cursor 与 keys。',
      inputSchema: {
        connection_id: z.string().optional(),
        match: z.string().default('*'),
        cursor: z.string().default('0'),
        count: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ connection_id, match, cursor, count }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const res = await r.scan(match, cursor, count ?? 100);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                next_cursor: res.cursor,
                keys: res.keys,
              }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_blocked_commands',
    {
      description: '列出本服务默认禁止通过任意通道执行的 Redis 命令名（文档/自检）。',
      inputSchema: {},
    },
    async () => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ blocked: [...REDIS_BLOCKED_COMMANDS].sort() }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'redis_hget',
    {
      description: '获取 Redis Hash 中指定字段的值。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        field: z.string(),
      },
    },
    async ({ connection_id, key, field }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const v = await r.hget(key, field);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, value: v }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_hset',
    {
      description: '设置 Redis Hash 中指定字段的值。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        field: z.string(),
        value: z.string(),
      },
    },
    async ({ connection_id, key, field, value }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        await r.hset(key, field, value);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, ok: true }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_hgetall',
    {
      description: '获取 Redis Hash 的所有字段和值。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const v = await r.hgetall(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, fields: v }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_hdel',
    {
      description: '删除 Redis Hash 中指定字段。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        field: z.string(),
      },
    },
    async ({ connection_id, key, field }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.hdel(key, field);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, deleted: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  // ── List 操作 ──────────────────────────────────────────

  server.registerTool(
    'redis_lpush',
    {
      description: '向 Redis List 头部插入一个或多个元素。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        values: z.array(z.string()).min(1).describe('要插入的值数组'),
      },
    },
    async ({ connection_id, key, values }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.lpush(key, ...values);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, length: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_rpush',
    {
      description: '向 Redis List 尾部插入一个或多个元素。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        values: z.array(z.string()).min(1).describe('要插入的值数组'),
      },
    },
    async ({ connection_id, key, values }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.rpush(key, ...values);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, length: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_lpop',
    {
      description: '移除并返回 Redis List 头部元素。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const v = await r.lpop(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, value: v }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_rpop',
    {
      description: '移除并返回 Redis List 尾部元素。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const v = await r.rpop(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, value: v }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_lrange',
    {
      description:
        '返回 Redis List 中指定范围的元素。start 和 stop 为索引（0 开始，-1 表示最后一个）。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        start: z.number().int().describe('起始索引'),
        stop: z.number().int().describe('结束索引'),
      },
    },
    async ({ connection_id, key, start, stop }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const v = await r.lrange(key, start, stop);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, values: v }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_llen',
    {
      description: '返回 Redis List 的长度。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.llen(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, length: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  // ── Set 操作 ──────────────────────────────────────────

  server.registerTool(
    'redis_sadd',
    {
      description: '向 Redis Set 添加一个或多个成员。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        members: z.array(z.string()).min(1).describe('要添加的成员数组'),
      },
    },
    async ({ connection_id, key, members }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.sadd(key, ...members);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, added: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_smembers',
    {
      description: '返回 Redis Set 的所有成员。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const v = await r.smembers(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, members: v }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_srem',
    {
      description: '从 Redis Set 移除一个或多个成员。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        members: z.array(z.string()).min(1).describe('要移除的成员数组'),
      },
    },
    async ({ connection_id, key, members }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.srem(key, ...members);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, removed: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_scard',
    {
      description: '返回 Redis Set 的成员数量。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.scard(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, count: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_sismember',
    {
      description: '检查成员是否存在于 Redis Set 中。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        member: z.string(),
      },
    },
    async ({ connection_id, key, member }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.sismember(key, member);
        return {
          content: [
            { type: 'text', text: JSON.stringify({ connection_id: id, isMember: n === 1 }) },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  // ── Sorted Set 操作 ──────────────────────────────────

  server.registerTool(
    'redis_zadd',
    {
      description: '向 Redis Sorted Set 添加成员及其分数。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        score: z.number().describe('分数'),
        member: z.string().describe('成员'),
      },
    },
    async ({ connection_id, key, score, member }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.zadd(key, score, member);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, added: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_zrange',
    {
      description:
        '返回 Redis Sorted Set 中指定范围的成员。start 和 stop 为索引。可选 withScores 返回分数。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        start: z.number().int().describe('起始索引'),
        stop: z.number().int().describe('结束索引'),
        withScores: z.boolean().optional().describe('是否返回分数'),
      },
    },
    async ({ connection_id, key, start, stop, withScores }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const v = await r.zrange(key, start, stop, withScores);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, members: v }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_zrem',
    {
      description: '从 Redis Sorted Set 移除一个或多个成员。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        members: z.array(z.string()).min(1).describe('要移除的成员数组'),
      },
    },
    async ({ connection_id, key, members }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.zrem(key, ...members);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, removed: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_zcard',
    {
      description: '返回 Redis Sorted Set 的成员数量。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.zcard(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, count: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_zscore',
    {
      description: '返回 Redis Sorted Set 中指定成员的分数。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        member: z.string(),
      },
    },
    async ({ connection_id, key, member }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const v = await r.zscore(key, member);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, score: v }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  // ── 键信息 ──────────────────────────────────────────

  server.registerTool(
    'redis_type',
    {
      description:
        '返回 Redis 键的数据类型（string/hash/list/set/zset/stream/none）。使用原生 TYPE 命令，单次网络往返。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const type = await r.type(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, key, type }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  // ── 键管理 ──────────────────────────────────────────

  server.registerTool(
    'redis_expire',
    {
      description: '设置 Redis 键的过期时间（秒）。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
        seconds: z.number().int().min(1).describe('过期时间（秒）'),
      },
    },
    async ({ connection_id, key, seconds }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.expire(key, seconds);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, ok: n === 1 }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'redis_ttl',
    {
      description: '返回 Redis 键的剩余过期时间（秒）。-1 表示无过期时间，-2 表示键不存在。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: z.string(),
      },
    },
    async ({ connection_id, key }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const n = await r.ttl(key);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, ttl: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );
}
