import type { ConnectionSpec, RuntimeHandle } from './core/types.js';
import { closeRuntime, pingRuntime } from './core/handle-runtime.js';
import { ConnectionRegistry } from './core/registry.js';
import { getDefaultConnectionId, parseConnectionSpecs } from './core/config.js';
import { createMysqlDriver } from './drivers/sql/mysql-driver.js';
import { createPostgresDriver } from './drivers/sql/postgres-driver.js';
import { createMssqlDriver } from './drivers/sql/mssql-driver.js';
import { createOracleDriver } from './drivers/sql/oracle-driver.js';
import { createMongoDriver } from './drivers/mongo/mongo-driver.js';
import { createRedisDriver } from './drivers/redis/redis-driver.js';

async function createHandle(spec: ConnectionSpec): Promise<RuntimeHandle> {
  switch (spec.engine) {
    case 'mysql':
      return { id: spec.id, spec, kind: 'sql', driver: await createMysqlDriver(spec) };
    case 'postgres':
      return { id: spec.id, spec, kind: 'sql', driver: await createPostgresDriver(spec) };
    case 'mssql':
      return { id: spec.id, spec, kind: 'sql', driver: await createMssqlDriver(spec) };
    case 'oracle':
      return { id: spec.id, spec, kind: 'sql', driver: await createOracleDriver(spec) };
    case 'mongodb':
      return { id: spec.id, spec, kind: 'mongo', driver: await createMongoDriver(spec) };
    case 'redis':
      return { id: spec.id, spec, kind: 'redis', driver: await createRedisDriver(spec) };
    default: {
      const _exhaustive: never = spec.engine;
      throw new Error(`未实现的引擎: ${_exhaustive}`);
    }
  }
}

export async function createRegistryFromEnv(): Promise<ConnectionRegistry> {
  const specs = parseConnectionSpecs();
  const defaultId = getDefaultConnectionId(specs);
  const handles = await Promise.all(specs.map((spec) => createHandle(spec)));
  return new ConnectionRegistry(specs, defaultId, handles);
}

export async function pingAll(registry: ConnectionRegistry): Promise<{ id: string; ok: boolean; error?: string }[]> {
  return Promise.all(
    registry.listMeta().map(async (m) => {
      const h = registry.get(m.id);
      if (!h) {
        return { id: m.id, ok: false, error: '内部错误：缺少连接句柄' };
      }
      const r = await pingRuntime(h);
      return { id: m.id, ok: r.ok, error: r.error };
    })
  );
}

export async function closeAll(registry: ConnectionRegistry): Promise<void> {
  const results = await Promise.allSettled(
    registry.getSpecs().map(async (s) => {
      const h = registry.get(s.id);
      if (!h) return;
      await closeRuntime(h);
    })
  );
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (rejected.length > 0) {
    console.error(
      '[polyglot-db-mcp]',
      'closeAll: 部分连接关闭失败',
      rejected.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
    );
  }
}
