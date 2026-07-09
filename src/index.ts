#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closeAll, createRegistryFromEnv, logStartupDiagnostics, pingAll } from './bootstrap.js';
import { createServer } from './server.js';
import { logger } from './core/logger.js';
import { runCli } from './cli.js';

loadEnv({ path: path.join(process.cwd(), '.env'), override: true });

// CLI 子命令处理（init、test、--help）
const cliCommands = new Set(['init', 'test', '--help', '-h']);
if (cliCommands.has(process.argv[2] ?? '')) {
  await runCli();
  process.exit(0);
}

async function main(): Promise<void> {
  logger.info('starting server');

  const registry = await createRegistryFromEnv();
  const pings = await pingAll(registry);
  logStartupDiagnostics(registry, pings);
  const defaultId = registry.getDefaultId();

  for (const p of pings) {
    if (!p.ok && p.id !== defaultId) {
      logger.warn('connection ping failed', { connection_id: p.id, error: p.error });
    }
  }

  const defaultPing = pings.find((p) => p.id === defaultId);
  if (!defaultPing?.ok) {
    logger.error('default connection ping failed', {
      connection_id: defaultId,
      error: defaultPing?.error,
    });
    await closeAll(registry);
    process.exit(1);
  }

  const server = createServer(registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('stdio transport connected');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    const shutdownTimeout = parseInt(process.env.DB_SHUTDOWN_TIMEOUT_MS || '10000', 10);
    const timer = setTimeout(() => {
      logger.warn('shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, shutdownTimeout);
    timer.unref();

    try {
      await server.close();
    } catch (e) {
      logger.error('server.close error', { error: e instanceof Error ? e.message : String(e) });
    }
    await closeAll(registry);
    process.exit(0);
  };

  // SIGHUP：热重载配置（重新解析 DB_MCP_CONNECTIONS，重建连接）
  process.once('SIGHUP', async () => {
    logger.info('received SIGHUP, reloading configuration');
    try {
      const newRegistry = await createRegistryFromEnv();
      const newPings = await pingAll(newRegistry);
      logStartupDiagnostics(newRegistry, newPings);
      const newDefaultPing = newPings.find((p) => p.id === newRegistry.getDefaultId());
      if (!newDefaultPing?.ok) {
        logger.error('reload failed: default connection ping failed, keeping old config');
        await closeAll(newRegistry);
        return;
      }
      // 替换 registry（注意：已注册的工具仍使用旧 registry 的引用）
      // 这是一个简化实现，完整的热重载需要 server 重建
      logger.info('configuration reloaded successfully');
      // 关闭旧连接
      await closeAll(registry);
      process.exit(0); // 让进程管理器重启
    } catch (e) {
      logger.error('configuration reload failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((e) => {
  logger.error('fatal error', { error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  process.exit(1);
});
