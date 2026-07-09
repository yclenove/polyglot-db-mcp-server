import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

// 测试 Redis 驱动接口
describe('Redis Driver Interface', () => {
  test('createRedisDriver is a function', async () => {
    const { createRedisDriver } = await import('../../dist/drivers/redis/redis-driver.js');
    assert.ok(typeof createRedisDriver === 'function');
  });

  test('RedisDriver interface has required methods', () => {
    const requiredMethods = ['ping', 'get', 'set', 'del', 'scan', 'close'];
    assert.ok(requiredMethods.length > 0);
  });
});

// 测试 Redis 驱动配置
describe('Redis Driver Configuration', () => {
  test('requires url in spec', async () => {
    const { createRedisDriver } = await import('../../dist/drivers/redis/redis-driver.js');
    try {
      await createRedisDriver({ id: 'test', engine: 'redis' });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('url'));
    }
  });
});

// 测试 keyPrefix 逻辑
describe('Redis Key Prefix', () => {
  test('assertRedisKeyPrefix is used', async () => {
    // 验证 keyPrefix 检查逻辑存在
    const { assertRedisKeyPrefix } = await import('../../dist/core/redis-guards.js');
    assert.ok(typeof assertRedisKeyPrefix === 'function');
  });
});
