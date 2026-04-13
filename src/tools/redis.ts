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
    }
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
    }
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
    }
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
    }
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
    }
  );
}
