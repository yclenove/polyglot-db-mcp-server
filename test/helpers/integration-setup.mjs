/**
 * 集成测试基础设施
 * 提供测试生命周期管理、数据库初始化和清理
 */

import { describe, before, after, beforeEach, afterEach } from 'node:test';
import { checkTestEnv, setupTestEnv, TEST_CONNECTIONS } from './test-config.mjs';

/**
 * 创建集成测试套件
 * @param {string} name - 测试套件名称
 * @param {string} engine - 数据库引擎
 * @param {Function} testFn - 测试函数
 */
export async function createIntegrationSuite(name, engine, testFn) {
  const isAvailable = await checkTestEnv(engine);

  if (!isAvailable) {
    describe.skip(`${name} (${engine})`, () => {
      testFn({ skip: true, reason: `${engine} 测试环境不可用` });
    });
    return;
  }

  describe(`${name} (${engine})`, () => {
    const context = {
      engine,
      config: TEST_CONNECTIONS[engine],
      driver: null,
    };

    before(async () => {
      setupTestEnv();
      // 动态创建驱动
      const { createMysqlDriver } = await import('../../dist/drivers/sql/mysql-driver.js');
      const { createPostgresDriver } = await import('../../dist/drivers/sql/postgres-driver.js');
      const { createRedisDriver } = await import('../../dist/drivers/redis/redis-driver.js');
      const { createMongoDriver } = await import('../../dist/drivers/mongo/mongo-driver.js');

      const driverMap = {
        mysql: createMysqlDriver,
        postgres: createPostgresDriver,
        redis: createRedisDriver,
        mongodb: createMongoDriver,
      };

      const createDriver = driverMap[engine];
      if (createDriver) {
        context.driver = await createDriver(TEST_CONNECTIONS[engine]);
      }
    });

    after(async () => {
      if (context.driver?.close) {
        await context.driver.close();
      }
    });

    testFn(context);
  });
}

/**
 * 等待条件满足
 * @param {Function} condition - 条件函数
 * @param {number} timeout - 超时时间
 * @param {number} interval - 检查间隔
 */
export async function waitFor(condition, timeout = 5000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`等待超时 (${timeout}ms)`);
}

/**
 * 生成随机测试数据
 */
export function generateTestData() {
  return {
    id: Math.random().toString(36).substring(7),
    timestamp: Date.now(),
    value: `test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  };
}
