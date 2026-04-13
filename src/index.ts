#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closeAll, createRegistryFromEnv, pingAll } from './bootstrap.js';
import { createServer } from './server.js';

function log(...args: unknown[]): void {
  console.error('[polyglot-db-mcp]', ...args);
}

loadEnv({ path: path.join(process.cwd(), '.env'), override: true });

async function main(): Promise<void> {
  const registry = await createRegistryFromEnv();
  const pings = await pingAll(registry);
  const defaultId = registry.getDefaultId();
  for (const p of pings) {
    if (!p.ok && p.id !== defaultId) {
      log('connection ping failed', { connection_id: p.id, error: p.error });
    }
  }
  const defaultPing = pings.find((p) => p.id === defaultId);
  if (!defaultPing?.ok) {
    log('default connection ping failed', { connection_id: defaultId, error: defaultPing?.error });
    await closeAll(registry);
    process.exit(1);
  }

  const server = createServer(registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('stdio transport connected');

  const shutdown = async (signal: string): Promise<void> => {
    log('shutting down', signal);
    try {
      await server.close();
    } catch (e) {
      log('server.close error', e instanceof Error ? e.message : String(e));
    }
    await closeAll(registry);
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((e) => {
  log('fatal', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});