import { isUtf8 } from 'node:buffer';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry.js';
import { REDIS_BLOCKED_COMMANDS } from '../core/redis-guards.js';
import { createErrorPayload, type ErrorCode } from '../core/error-codes.js';
import type {
  RedisPipelineCommand,
  RedisPipelineCommandName,
  RedisStringWindow,
} from '../core/types.js';
import { globalLimits, responseDataByteLimit } from '../core/config.js';
import { jsonByteLength } from '../core/byte-budget.js';

const redisKeySchema = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 4096, {
    message: 'Redis key 不能超过 4096 字节',
  });
const redisCursorSchema = z
  .string()
  .regex(/^\d+$/, 'Redis SCAN cursor 必须是非负整数字符串')
  .default('0');
const redisMatchSchema = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 4096, {
    message: 'Redis MATCH pattern 不能超过 4096 字节',
  })
  .default('*');
const redisScanCountSchema = z.number().int().min(1).max(500).default(100);

const ALLOWED_REDIS_PIPELINE_COMMANDS = new Set<RedisPipelineCommandName>([
  'get',
  'set',
  'del',
  'hget',
  'hset',
  'hdel',
  'lpush',
  'rpush',
  'lpop',
  'rpop',
  'llen',
  'sadd',
  'srem',
  'scard',
  'sismember',
  'zadd',
  'zrem',
  'zcard',
  'zscore',
  'type',
  'expire',
  'ttl',
]);

function classifyRedisToolError(message: string): ErrorCode | null {
  if (message.includes('不是 Redis')) return 'REDIS_001';
  if (message.includes('前缀') || message.includes('keyPrefix')) return 'REDIS_002';
  if (message.includes('禁止')) return 'REDIS_003';
  if (message.includes('只读')) return 'REDIS_004';
  return null;
}

function redisToolError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const code = classifyRedisToolError(message);
  if (!code) {
    return { content: [{ type: 'text' as const, text: message }], isError: true };
  }
  const errorInfo = createErrorPayload(code, { error: message });
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message, error_info: errorInfo }),
      },
    ],
    isError: true,
  };
}

function parseRedisPipelineCommands(raw: string): RedisPipelineCommand[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('commands_json 须为 JSON 数组');
  }
  if (parsed.length === 0) {
    throw new Error('commands_json 不能为空');
  }
  if (parsed.length > 50) {
    throw new Error('redis_pipeline 单次最多允许 50 条命令');
  }

  return parsed.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`commands_json[${index}] 须为对象`);
    }
    const commandItem = item as Record<string, unknown>;
    const commandRaw = commandItem.command;
    const key = commandItem.key;
    if (typeof commandRaw !== 'string' || commandRaw.trim() === '') {
      throw new Error(`commands_json[${index}].command 必须是字符串`);
    }
    const command = commandRaw.trim().toLowerCase();
    if (REDIS_BLOCKED_COMMANDS.has(command.toUpperCase())) {
      throw new Error(`Redis pipeline 禁止执行命令 ${command.toUpperCase()}`);
    }
    if (!ALLOWED_REDIS_PIPELINE_COMMANDS.has(command as RedisPipelineCommandName)) {
      throw new Error(`Redis pipeline 不支持命令 ${command}`);
    }
    if (typeof key !== 'string' || key.trim() === '') {
      throw new Error(`commands_json[${index}].key 必须是非空字符串`);
    }
    if (Buffer.byteLength(key, 'utf8') > 4096) {
      throw new Error(`commands_json[${index}].key 不能超过 4096 字节`);
    }
    const args = commandItem.args;
    if (args !== undefined && !Array.isArray(args)) {
      throw new Error(`commands_json[${index}].args 必须是数组`);
    }
    return {
      command: command as RedisPipelineCommandName,
      key,
      args: args as unknown[] | undefined,
    };
  });
}

function redisWindowBytes(window: RedisStringWindow): Buffer | null {
  if (window.valueEncoding === null) return null;
  if (window.valueEncoding === 'utf8' && window.value !== null) {
    return Buffer.from(window.value, 'utf8');
  }
  if (window.valueEncoding === 'base64' && window.valueBase64 !== undefined) {
    return Buffer.from(window.valueBase64, 'base64');
  }
  throw new Error('Redis 字符串窗口编码元数据无效');
}

function utf8PrefixLength(value: Buffer, maxLength: number): number {
  let length = Math.min(maxLength, value.length);
  while (length > 0 && !isUtf8(value.subarray(0, length))) length--;
  return length;
}

function buildRedisGetResult(
  connectionId: string,
  window: RedisStringWindow,
  bytes: Buffer | null,
  encoding: 'utf8' | 'base64' | null,
) {
  const returnedBytes = bytes?.length ?? 0;
  const nextOffsetBytes =
    bytes !== null && window.offsetBytes + returnedBytes < window.totalBytes
      ? window.offsetBytes + returnedBytes
      : null;
  const payload: Record<string, unknown> = {
    connection_id: connectionId,
    value: encoding === 'utf8' && bytes !== null ? bytes.toString('utf8') : null,
    value_encoding: encoding,
    total_bytes: window.totalBytes,
    offset_bytes: window.offsetBytes,
    returned_bytes: returnedBytes,
    next_offset_bytes: nextOffsetBytes,
    truncated: bytes === null ? false : window.offsetBytes > 0 || nextOffsetBytes !== null,
  };
  if (encoding === 'base64' && bytes !== null) {
    payload.value_base64 = bytes.toString('base64');
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

function fitRedisGetResult(connectionId: string, window: RedisStringWindow) {
  const source = redisWindowBytes(window);
  if (source === null) return buildRedisGetResult(connectionId, window, null, null);

  const encoding = window.valueEncoding === 'utf8' ? 'utf8' : 'base64';
  const buildPrefix = (requestedLength: number) => {
    const length =
      encoding === 'utf8'
        ? utf8PrefixLength(source, requestedLength)
        : Math.min(requestedLength, source.length);
    const bytes = source.subarray(0, length);
    return { length, result: buildRedisGetResult(connectionId, window, bytes, encoding) };
  };

  const limit = globalLimits().maxResponseBytes;
  const full = buildPrefix(source.length);
  if (jsonByteLength(full.result) <= limit) return full.result;

  let low = 0;
  let high = source.length - 1;
  let best = buildPrefix(0);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = buildPrefix(middle);
    if (jsonByteLength(candidate.result) <= limit) {
      if (candidate.length > best.length) best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best.result;
}

export function registerRedisTools(server: McpServer, registry: ConnectionRegistry): void {
  server.registerTool(
    'redis_get',
    {
      description:
        '按字节窗口读取 Redis 字符串键值。默认窗口受 DB_MAX_RESPONSE_BYTES 约束；返回总字节数、下一偏移和截断状态。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
        offset_bytes: z.number().int().min(0).default(0),
        max_bytes: z
          .number()
          .int()
          .min(1)
          .max(16 * 1024 * 1024)
          .optional(),
      },
    },
    async ({ connection_id, key, offset_bytes, max_bytes }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const byteLimit = Math.min(max_bytes ?? responseDataByteLimit(), responseDataByteLimit());
        const window = await r.getWindow(key, offset_bytes ?? 0, byteLimit);
        return fitRedisGetResult(id, window);
      } catch (e) {
        return redisToolError(e);
      }
    },
  );

  server.registerTool(
    'redis_set',
    {
      description: '写入 Redis 字符串键。只读连接拒绝。可选 ttl_seconds。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
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
        return redisToolError(e);
      }
    },
  );

  server.registerTool(
    'redis_del',
    {
      description: '删除 Redis 键。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
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
        match: redisMatchSchema,
        cursor: redisCursorSchema,
        count: redisScanCountSchema,
      },
    },
    async ({ connection_id, match, cursor, count }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const res = await r.scan(match ?? '*', cursor ?? '0', count ?? 100);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                next_cursor: res.cursor,
                keys: res.keys,
                batch_count: res.keys.length,
                scan_complete: res.cursor === '0',
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
    'redis_pipeline',
    {
      description:
        '批量执行安全 Redis 命令子集。禁止 HGETALL/LRANGE/SMEMBERS/ZRANGE 集合物化；请使用分页或单独受限读取工具。',
      inputSchema: {
        connection_id: z.string().optional(),
        commands_json: z
          .string()
          .describe(
            'JSON 数组，如 [{"command":"set","key":"app:k","args":["v",60]},{"command":"get","key":"app:k"}]',
          ),
      },
    },
    async ({ connection_id, commands_json }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const commands = parseRedisPipelineCommands(commands_json);
        const results = await r.pipeline(commands);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                results,
                ok: results.every((item) => item.ok),
              }),
            },
          ],
        };
      } catch (e) {
        return redisToolError(e);
      }
    },
  );

  server.registerTool(
    'redis_hget',
    {
      description: '获取 Redis Hash 中指定字段的值。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
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
        key: redisKeySchema,
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
      description:
        '获取小型 Redis Hash 的所有字段和值。字段数超过 DB_MAX_ROWS 时拒绝，请改用 redis_hscan。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
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
    'redis_hscan',
    {
      description:
        '使用 HSCAN 分页读取 Redis Hash。cursor 首次传 "0"；返回结构化 field/value、next_cursor 和完成状态。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
        cursor: redisCursorSchema,
        match: redisMatchSchema,
        count: redisScanCountSchema,
      },
    },
    async ({ connection_id, key, cursor, match, count }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const result = await r.hscan(key, cursor ?? '0', count ?? 100, match ?? '*');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                next_cursor: result.cursor,
                entries: result.entries,
                batch_count: result.entries.length,
                scan_complete: result.cursor === '0',
              }),
            },
          ],
        };
      } catch (e) {
        return redisToolError(e);
      }
    },
  );

  server.registerTool(
    'redis_hdel',
    {
      description: '删除 Redis Hash 中指定字段。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        '返回 Redis List 中受 DB_MAX_ROWS 限制的索引范围。start 和 stop 为索引（0 开始，-1 表示最后一个）。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        key: redisKeySchema,
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
      description:
        '返回小型 Redis Set 的所有成员。成员数超过 DB_MAX_ROWS 时拒绝，请改用 redis_sscan。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
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
    'redis_sscan',
    {
      description:
        '使用 SSCAN 分页读取 Redis Set。cursor 首次传 "0"；返回 members、next_cursor 和完成状态。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
        cursor: redisCursorSchema,
        match: redisMatchSchema,
        count: redisScanCountSchema,
      },
    },
    async ({ connection_id, key, cursor, match, count }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const result = await r.sscan(key, cursor ?? '0', count ?? 100, match ?? '*');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                next_cursor: result.cursor,
                members: result.members,
                batch_count: result.members.length,
                scan_complete: result.cursor === '0',
              }),
            },
          ],
        };
      } catch (e) {
        return redisToolError(e);
      }
    },
  );

  server.registerTool(
    'redis_srem',
    {
      description: '从 Redis Set 移除一个或多个成员。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        '返回 Redis Sorted Set 中受 DB_MAX_ROWS 限制的索引范围。可选 withScores 返回分数；大集合遍历请用 redis_zscan。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
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
    'redis_zscan',
    {
      description:
        '使用 ZSCAN 分页读取 Redis Sorted Set。返回结构化 member/score、next_cursor 和完成状态。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
        cursor: redisCursorSchema,
        match: redisMatchSchema,
        count: redisScanCountSchema,
      },
    },
    async ({ connection_id, key, cursor, match, count }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const r = registry.requireRedis(id);
        const result = await r.zscan(key, cursor ?? '0', count ?? 100, match ?? '*');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                next_cursor: result.cursor,
                entries: result.entries,
                batch_count: result.entries.length,
                scan_complete: result.cursor === '0',
              }),
            },
          ],
        };
      } catch (e) {
        return redisToolError(e);
      }
    },
  );

  server.registerTool(
    'redis_zrem',
    {
      description: '从 Redis Sorted Set 移除一个或多个成员。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        key: redisKeySchema,
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
        key: redisKeySchema,
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
