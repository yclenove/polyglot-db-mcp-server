import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { pingRuntime } from '../core/handle-runtime.js';
import type { ConnectionRegistry } from '../core/registry.js';

export function registerConnectionTools(server: McpServer, registry: ConnectionRegistry): void {
  server.registerTool(
    'list_connections',
    {
      description: '列出 DB_MCP_CONNECTIONS 中所有 connection_id、engine 与是否只读',
      inputSchema: {},
    },
    async () => {
      return {
        content: [{ type: 'text', text: JSON.stringify({ connections: registry.listMeta() }) }],
      };
    }
  );

  server.registerTool(
    'test_connection',
    {
      description: '对指定 connection_id 执行 ping（缺省使用 DB_MCP_DEFAULT_CONNECTION_ID 或第一条）',
      inputSchema: {
        connection_id: z.string().optional().describe('连接 id；缺省为默认连接'),
      },
    },
    async ({ connection_id }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const h = registry.require(id);
        const r = await pingRuntime(h);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, ...r }) }],
          isError: !r.ok,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );
}
