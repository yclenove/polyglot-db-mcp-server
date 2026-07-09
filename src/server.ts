import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionRegistry } from './core/registry.js';
import { getVersion } from './core/version.js';
import { registerConnectionTools } from './tools/connections.js';
import { registerSqlTools } from './tools/sql.js';
import { registerMongoTools } from './tools/mongo.js';
import { registerRedisTools } from './tools/redis.js';
import { registerAuditTools } from './tools/audit.js';
import { registerSchemaTools } from './tools/schema.js';
import { registerMaskingTools } from './tools/masking.js';
import { registerReplayTools } from './tools/replay.js';
import { registerAdvisorTools } from './tools/advisor.js';

export function createServer(registry: ConnectionRegistry): McpServer {
  const server = new McpServer({ name: 'polyglot-db-mcp-server', version: getVersion() });
  registerConnectionTools(server, registry);
  registerSqlTools(server, registry);
  registerMongoTools(server, registry);
  registerRedisTools(server, registry);
  registerAuditTools(server);
  registerSchemaTools(server, registry);
  registerMaskingTools(server);
  registerReplayTools(server, registry);
  registerAdvisorTools(server, registry);
  return server;
}