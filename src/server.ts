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
import { registerAuthTools } from './tools/auth.js';
import { registerExternalPluginTools, registerPluginTools } from './tools/plugins.js';
import { installAuthorization, type AuthorizationRuntime } from './auth/authorization.js';

export interface CreateServerOptions {
  authorization?: AuthorizationRuntime;
}

export function createServer(
  registry: ConnectionRegistry,
  options: CreateServerOptions = {},
): McpServer {
  const server = new McpServer({ name: 'polyglot-db-mcp-server', version: getVersion() });
  if (options.authorization) {
    installAuthorization(server, options.authorization);
  }
  registerConnectionTools(server, registry);
  registerSqlTools(server, registry);
  registerMongoTools(server, registry);
  registerRedisTools(server, registry);
  registerAuditTools(server);
  registerAuthTools(server);
  registerPluginTools(server);
  registerSchemaTools(server, registry);
  registerMaskingTools(server);
  registerReplayTools(server, registry);
  registerAdvisorTools(server, registry);
  return server;
}

export async function createServerWithPlugins(
  registry: ConnectionRegistry,
  options: CreateServerOptions = {},
): Promise<McpServer> {
  const server = createServer(registry, options);
  await registerExternalPluginTools(server);
  return server;
}
