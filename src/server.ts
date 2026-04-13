import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionRegistry } from './core/registry.js';
import { registerConnectionTools } from './tools/connections.js';
import { registerSqlTools } from './tools/sql.js';
import { registerMongoTools } from './tools/mongo.js';
import { registerRedisTools } from './tools/redis.js';

export function createServer(registry: ConnectionRegistry): McpServer {
  const server = new McpServer({ name: 'polyglot-db-mcp-server', version: '0.1.0' });
  registerConnectionTools(server, registry);
  registerSqlTools(server, registry);
  registerMongoTools(server, registry);
  registerRedisTools(server, registry);
  return server;
}