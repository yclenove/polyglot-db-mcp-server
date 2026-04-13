import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry.js';

export function registerMongoTools(server: McpServer, registry: ConnectionRegistry): void {
  server.registerTool(
    'mongo_list_collections',
    {
      description: '列出 MongoDB 数据库中的集合名称',
      inputSchema: {
        connection_id: z.string().optional(),
      },
    },
    async ({ connection_id }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const names = await d.listCollections();
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, collections: names }) }],
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
    'mongo_find',
    {
      description: '在集合上执行 find。filter 为 JSON 对象；limit 默认 50，最大 500。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        filter_json: z.string().optional().describe('JSON 对象字符串，默认 {}'),
        limit: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
    },
    async ({ connection_id, collection, filter_json, limit, skip }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const filter = filter_json ? (JSON.parse(filter_json) as Record<string, unknown>) : {};
        if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
          throw new Error('filter_json 须为 JSON 对象');
        }
        const lim = limit ?? 50;
        const rows = await d.find(collection, filter, { limit: lim, skip });
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, rows }) }],
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
    'mongo_aggregate',
    {
      description: '对集合执行聚合管道。pipeline_json 为 JSON 数组字符串。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        pipeline_json: z.string(),
      },
    },
    async ({ connection_id, collection, pipeline_json }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const pipeline = JSON.parse(pipeline_json) as unknown;
        if (!Array.isArray(pipeline)) {
          throw new Error('pipeline_json 须为 JSON 数组');
        }
        const rows = await d.aggregate(collection, pipeline);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, rows }) }],
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
    'mongo_count',
    {
      description: '统计集合文档数，filter_json 可选',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        filter_json: z.string().optional(),
      },
    },
    async ({ connection_id, collection, filter_json }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const filter = filter_json ? (JSON.parse(filter_json) as Record<string, unknown>) : {};
        if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
          throw new Error('filter_json 须为 JSON 对象');
        }
        const n = await d.count(collection, filter);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, count: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    }
  );
}
