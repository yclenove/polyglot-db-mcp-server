import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { checkTestEnv, TEST_CONNECTIONS } from '../helpers/test-config.mjs';

const SKIP_REASON = 'Redis 测试环境不可用（需要 Docker: docker compose up -d）';

describe('Redis Integration', () => {
  let driver;
  let isAvailable = false;
  const testPrefix = 'test:integration:';

  before(async () => {
    isAvailable = await checkTestEnv('redis');
    if (!isAvailable) return;

    const { createRedisDriver } = await import('../../dist/drivers/redis/redis-driver.js');
    driver = await createRedisDriver(TEST_CONNECTIONS.redis);
  });

  after(async () => {
    if (driver) {
      try {
        // 清理测试数据
        const { keys } = await driver.scan(`${testPrefix}*`, '0', 100);
        for (const key of keys) {
          await driver.del(key);
        }
      } catch {
        // 忽略清理错误
      }
      await driver.close();
    }
  });

  test('ping succeeds', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const result = await driver.ping();
    assert.equal(result.ok, true);
  });

  test('set and get string value', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const key = `${testPrefix}string`;
    await driver.set(key, 'hello');
    const value = await driver.get(key);
    assert.equal(value, 'hello');
  });

  test('get returns null for missing key', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const value = await driver.get(`${testPrefix}missing`);
    assert.equal(value, null);
  });

  test('del deletes key', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const key = `${testPrefix}to_delete`;
    await driver.set(key, 'value');
    const deleted = await driver.del(key);
    assert.equal(deleted, 1);
    const value = await driver.get(key);
    assert.equal(value, null);
  });

  test('scan returns matching keys', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    // 插入测试数据
    await driver.set(`${testPrefix}scan:1`, 'a');
    await driver.set(`${testPrefix}scan:2`, 'b');

    const result = await driver.scan(`${testPrefix}scan:*`, '0', 100);
    assert.ok(Array.isArray(result.keys));
    assert.ok(result.keys.length >= 2);
  });

  test('hset and hget hash operations', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const key = `${testPrefix}hash`;
    await driver.hset(key, 'field1', 'value1');
    await driver.hset(key, 'field2', 'value2');

    const value1 = await driver.hget(key, 'field1');
    assert.equal(value1, 'value1');

    const value2 = await driver.hget(key, 'field2');
    assert.equal(value2, 'value2');
  });

  test('hgetall returns all hash fields', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const key = `${testPrefix}hashall`;
    await driver.hset(key, 'a', '1');
    await driver.hset(key, 'b', '2');

    const all = await driver.hgetall(key);
    assert.deepEqual(all, { a: '1', b: '2' });
  });

  test('hdel deletes hash field', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const key = `${testPrefix}hashdel`;
    await driver.hset(key, 'field', 'value');
    const deleted = await driver.hdel(key, 'field');
    assert.equal(deleted, 1);
    const value = await driver.hget(key, 'field');
    assert.equal(value, null);
  });

  test('set with TTL expires', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const key = `${testPrefix}ttl`;
    await driver.set(key, 'temp', 1); // 1 second TTL

    // 立即获取应该存在
    const value = await driver.get(key);
    assert.equal(value, 'temp');

    // 等待过期
    await new Promise(resolve => setTimeout(resolve, 1100));
    const expired = await driver.get(key);
    assert.equal(expired, null);
  });
});
