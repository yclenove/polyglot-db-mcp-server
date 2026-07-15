import type { BuiltinEngine, ConnectionSpec, RuntimeHandle } from './core/types.js';
import { closeRuntime, pingRuntime } from './core/handle-runtime.js';
import { ConnectionRegistry } from './core/registry.js';
import { getDefaultConnectionId, globalLimits, parseConnectionSpecs } from './core/config.js';
import { parseAuditPersistenceConfig, safeAuditPersistenceConfig } from './core/audit.js';
import { parseAlertConfig, safeAlertConfig } from './core/alerts.js';
import { parseTelemetryConfig, safeTelemetryConfig } from './core/telemetry.js';
import {
  discoverPlugins,
  findDriverPlugin,
  loadPlugins,
  pluginDriverEngines,
  safePluginDiscoverySummary,
  type LoadedPlugin,
} from './core/plugins.js';
import { logger } from './core/logger.js';
import { createMysqlDriver } from './drivers/sql/mysql-driver.js';
import { createPostgresDriver } from './drivers/sql/postgres-driver.js';
import { createMssqlDriver } from './drivers/sql/mssql-driver.js';
import { createOracleDriver } from './drivers/sql/oracle-driver.js';
import { createSqliteDriver } from './drivers/sql/sqlite-driver.js';
import { createDuckDbDriver } from './drivers/sql/duckdb-driver.js';
import { createMongoDriver } from './drivers/mongo/mongo-driver.js';
import { createRedisDriver } from './drivers/redis/redis-driver.js';

const BUILTIN_ENGINES = new Set<BuiltinEngine>([
  'mysql',
  'postgres',
  'mssql',
  'oracle',
  'sqlite',
  'duckdb',
  'mongodb',
  'redis',
]);

function isBuiltinEngine(engine: string): engine is BuiltinEngine {
  return BUILTIN_ENGINES.has(engine as BuiltinEngine);
}

function validatePluginHandle(spec: ConnectionSpec, handle: RuntimeHandle): RuntimeHandle {
  if (handle.id !== spec.id) {
    throw new Error(`插件 driver 返回的 handle id「${handle.id}」与连接「${spec.id}」不一致`);
  }
  if (handle.spec.id !== spec.id || handle.spec.engine !== spec.engine) {
    throw new Error(`插件 driver 返回的 spec 与连接「${spec.id}」不一致`);
  }
  return handle;
}

async function createBuiltinHandle(
  spec: ConnectionSpec & { engine: BuiltinEngine },
): Promise<RuntimeHandle> {
  switch (spec.engine) {
    case 'mysql':
      return { id: spec.id, spec, kind: 'sql', driver: await createMysqlDriver(spec) };
    case 'postgres':
      return { id: spec.id, spec, kind: 'sql', driver: await createPostgresDriver(spec) };
    case 'mssql':
      return { id: spec.id, spec, kind: 'sql', driver: await createMssqlDriver(spec) };
    case 'oracle':
      return { id: spec.id, spec, kind: 'sql', driver: await createOracleDriver(spec) };
    case 'sqlite':
      return { id: spec.id, spec, kind: 'sql', driver: await createSqliteDriver(spec) };
    case 'duckdb':
      return { id: spec.id, spec, kind: 'sql', driver: await createDuckDbDriver(spec) };
    case 'mongodb':
      return { id: spec.id, spec, kind: 'mongo', driver: await createMongoDriver(spec) };
    case 'redis':
      return { id: spec.id, spec, kind: 'redis', driver: await createRedisDriver(spec) };
  }
}

async function createHandle(
  spec: ConnectionSpec,
  plugins: readonly LoadedPlugin[],
): Promise<RuntimeHandle> {
  if (isBuiltinEngine(spec.engine)) {
    return createBuiltinHandle({ ...spec, engine: spec.engine });
  }

  const plugin = findDriverPlugin(plugins, spec.engine);
  if (!plugin?.module.createDriver) {
    throw new Error(`未找到 engine「${spec.engine}」对应的 driver 插件`);
  }
  const handle = await plugin.module.createDriver(spec, {
    manifest: plugin.manifest,
    pluginPath: plugin.path,
  });
  return validatePluginHandle(spec, handle);
}

async function closeHandles(handles: readonly RuntimeHandle[]): Promise<void> {
  await Promise.allSettled(handles.map((handle) => closeRuntime(handle)));
}

export async function createRegistryFromSpecs(
  specs: ConnectionSpec[],
  defaultId: string,
  handleFactory: (spec: ConnectionSpec) => Promise<RuntimeHandle>,
): Promise<ConnectionRegistry> {
  const results = await Promise.allSettled(specs.map((spec) => handleFactory(spec)));
  const handles = results
    .filter(
      (result): result is PromiseFulfilledResult<RuntimeHandle> => result.status === 'fulfilled',
    )
    .map((result) => result.value);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );

  if (failure) {
    await closeHandles(handles);
    throw failure.reason;
  }

  try {
    return new ConnectionRegistry(specs, defaultId, handles);
  } catch (error) {
    await closeHandles(handles);
    throw error;
  }
}

export async function createRegistryFromEnv(): Promise<ConnectionRegistry> {
  const discoveredPlugins = discoverPlugins();
  const specs = parseConnectionSpecs(undefined, {
    pluginEngines: pluginDriverEngines(discoveredPlugins),
  });
  const defaultId = getDefaultConnectionId(specs);
  const loadedPlugins = await loadPlugins(discoveredPlugins);
  return createRegistryFromSpecs(specs, defaultId, (spec) => createHandle(spec, loadedPlugins));
}

export async function pingAll(
  registry: ConnectionRegistry,
): Promise<{ id: string; ok: boolean; latencyMs: number; error?: string }[]> {
  return Promise.all(
    registry.listMeta().map(async (m) => {
      const h = registry.get(m.id);
      if (!h) {
        return { id: m.id, ok: false, latencyMs: 0, error: '内部错误：缺少连接句柄' };
      }
      const start = Date.now();
      const r = await pingRuntime(h);
      return { id: m.id, ok: r.ok, latencyMs: Date.now() - start, error: r.error };
    }),
  );
}

/** 输出启动诊断摘要 */
export function logStartupDiagnostics(
  registry: ConnectionRegistry,
  pings: { id: string; ok: boolean; latencyMs: number; error?: string }[],
): void {
  const specs = registry.getSpecs();
  const defaultId = registry.getDefaultId();
  const limits = globalLimits();

  const summary = {
    total_connections: specs.length,
    default_connection: defaultId,
    engines: {} as Record<string, number>,
    config: {
      query_timeout_ms: limits.queryTimeoutMs,
      max_rows: limits.maxRows,
      max_response_bytes: limits.maxResponseBytes,
      log_level: process.env.LOG_LEVEL || 'info',
      log_format: process.env.LOG_FORMAT || 'human',
      audit: safeAuditPersistenceConfig(parseAuditPersistenceConfig()),
      alerts: safeAlertConfig(parseAlertConfig()),
      telemetry: safeTelemetryConfig(parseTelemetryConfig()),
      plugins: safePluginDiscoverySummary(discoverPlugins()),
    },
  };

  for (const spec of specs) {
    summary.engines[spec.engine] = (summary.engines[spec.engine] ?? 0) + 1;
  }

  logger.info('startup diagnostics', summary);

  for (const p of pings) {
    const level = p.ok ? 'info' : 'warn';
    logger[level](`connection ${p.id}`, {
      status: p.ok ? 'ok' : 'failed',
      latency_ms: p.latencyMs,
      error: p.error,
    });
  }
}

export async function closeAll(registry: ConnectionRegistry): Promise<void> {
  const results = await Promise.allSettled(
    registry.getSpecs().map(async (s) => {
      const h = registry.get(s.id);
      if (!h) return;
      await closeRuntime(h);
    }),
  );
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (rejected.length > 0) {
    console.error(
      '[polyglot-db-mcp]',
      'closeAll: 部分连接关闭失败',
      rejected.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason))),
    );
  }
}
