#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import process from 'node:process';
import { closeAll, createRegistryFromEnv, logStartupDiagnostics, pingAll } from './bootstrap.js';
import { createServer } from './server.js';
import { logger } from './core/logger.js';
import { runCli } from './cli.js';
import { parseHttpTransportConfig, safeHttpConfig } from './core/http-config.js';
import { connectStdioTransport } from './transports/stdio.js';
import { startHttpTransport, type StartedHttpTransport } from './transports/http.js';
import { createAuthorizationRuntime } from './auth/authorization.js';
import { publishConnectionPingAlerts } from './core/alerts.js';
import { initializeTelemetry, shutdownTelemetry } from './core/telemetry.js';

loadEnv({ path: path.join(process.cwd(), '.env'), override: true });

// CLI 子命令处理（init、test、--help）
const cliCommands = new Set(['init', 'test', '--help', '-h']);
if (cliCommands.has(process.argv[2] ?? '')) {
  const exitCode = await runCli();
  process.exit(exitCode);
}

async function main(): Promise<void> {
  logger.info('starting server');
  initializeTelemetry();
  const transportConfig = parseHttpTransportConfig(process.env, process.argv.slice(2));
  logger.info('transport config', safeHttpConfig(transportConfig));

  const registry = await createRegistryFromEnv();
  const authorization = createAuthorizationRuntime(registry, {
    mode: transportConfig.authMode,
    policyFile: transportConfig.rbacPolicyFile,
    policyTemplate: transportConfig.rbacPolicyTemplate,
    defaultEffect: transportConfig.rbacDefaultEffect,
  });
  const pings = await pingAll(registry);
  logStartupDiagnostics(registry, pings);
  const defaultId = registry.getDefaultId();
  await publishConnectionPingAlerts(pings, defaultId);

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
    await shutdownTelemetry();
    process.exit(1);
  }

  let mcpServer: ReturnType<typeof createServer> | undefined;
  let httpTransport: StartedHttpTransport | undefined;

  if (transportConfig.transport === 'stdio') {
    mcpServer = createServer(registry, { authorization });
    await connectStdioTransport(mcpServer);
    logger.info('stdio transport connected');
  } else {
    httpTransport = await startHttpTransport({
      registry,
      config: transportConfig,
      startupPings: pings,
      authorization,
    });
    logger.info('http transport listening', { url: httpTransport.url });
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    const shutdownTimeout = parseInt(process.env.DB_SHUTDOWN_TIMEOUT_MS || '10000', 10);
    const timer = setTimeout(() => {
      logger.warn('shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, shutdownTimeout);
    timer.unref();

    try {
      if (httpTransport) {
        await httpTransport.close();
      }
      if (mcpServer) {
        await mcpServer.close();
      }
    } catch (e) {
      logger.error('transport close error', { error: e instanceof Error ? e.message : String(e) });
    }
    await closeAll(registry);
    await shutdownTelemetry();
    process.exit(0);
  };

  // SIGHUP：热重载配置（重新解析 DB_MCP_CONNECTIONS，重建连接）
  process.once('SIGHUP', async () => {
    logger.info('received SIGHUP, reloading configuration');
    try {
      const newRegistry = await createRegistryFromEnv();
      const newPings = await pingAll(newRegistry);
      logStartupDiagnostics(newRegistry, newPings);
      await publishConnectionPingAlerts(newPings, newRegistry.getDefaultId());
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
      await shutdownTelemetry();
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

main().catch(async (e) => {
  logger.error('fatal error', { error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  try {
    await shutdownTelemetry();
  } catch (shutdownError) {
    logger.warn('telemetry shutdown failed', {
      error: shutdownError instanceof Error ? shutdownError.message : String(shutdownError),
    });
  }
  process.exit(1);
});
