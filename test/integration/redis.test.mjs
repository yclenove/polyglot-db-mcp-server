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

  function integrationTest(name, handler) {
    test(name, async (t) => {
      if (!isAvailable) {
        t.skip(SKIP_REASON);
        return;
      }
      await handler();
    });
  }

  integrationTest('ping succeeds', async () => {
    const result = await driver.ping();
    assert.equal(result.ok, true);
  });

  integrationTest('set and get string value', async () => {
    const key = `${testPrefix}string`;
    await driver.set(key, 'hello');
    const value = await driver.get(key);
    assert.equal(value, 'hello');
  });

  integrationTest('string reads support bounded byte windows', async () => {
    const key = `${testPrefix}window`;
    await driver.set(key, 'abcdefghij');
    const window = await driver.getWindow(key, 2, 4);
    assert.equal(window.value, 'cdef');
    assert.equal(window.valueEncoding, 'utf8');
    assert.equal(window.totalBytes, 10);
    assert.equal(window.returnedBytes, 4);
    assert.equal(window.nextOffsetBytes, 6);
    assert.equal(window.truncated, true);

    const tail = await driver.getWindow(key, window.nextOffsetBytes, 10);
    assert.equal(tail.value, 'ghij');
    assert.equal(tail.nextOffsetBytes, null);

    await driver.set(key, 'é');
    const firstByte = await driver.getWindow(key, 0, 1);
    const secondByte = await driver.getWindow(key, 1, 1);
    assert.equal(firstByte.value, null);
    assert.equal(firstByte.valueEncoding, 'base64');
    assert.equal(secondByte.valueEncoding, 'base64');
    assert.equal(
      Buffer.concat([
        Buffer.from(firstByte.valueBase64, 'base64'),
        Buffer.from(secondByte.valueBase64, 'base64'),
      ]).toString('utf8'),
      'é',
    );

    await driver.set(key, '');
    const empty = await driver.getWindow(key, 0, 10);
    const missing = await driver.getWindow(`${testPrefix}window:missing`, 0, 10);
    assert.equal(empty.value, '');
    assert.equal(empty.valueEncoding, 'utf8');
    assert.equal(missing.value, null);
    assert.equal(missing.valueEncoding, null);
  });

  integrationTest('get returns null for missing key', async () => {
    const value = await driver.get(`${testPrefix}missing`);
    assert.equal(value, null);
  });

  integrationTest('del deletes key', async () => {
    const key = `${testPrefix}to_delete`;
    await driver.set(key, 'value');
    const deleted = await driver.del(key);
    assert.equal(deleted, 1);
    const value = await driver.get(key);
    assert.equal(value, null);
  });

  integrationTest('scan returns matching keys', async () => {
    // 插入测试数据
    await driver.set(`${testPrefix}scan:1`, 'a');
    await driver.set(`${testPrefix}scan:2`, 'b');

    const result = await driver.scan(`${testPrefix}scan:*`, '0', 100);
    assert.ok(Array.isArray(result.keys));
    assert.ok(result.keys.length >= 2);
  });

  integrationTest('hset and hget hash operations', async () => {
    const key = `${testPrefix}hash`;
    await driver.hset(key, 'field1', 'value1');
    await driver.hset(key, 'field2', 'value2');

    const value1 = await driver.hget(key, 'field1');
    assert.equal(value1, 'value1');

    const value2 = await driver.hget(key, 'field2');
    assert.equal(value2, 'value2');
  });

  integrationTest('hgetall returns all hash fields', async () => {
    const key = `${testPrefix}hashall`;
    await driver.hset(key, 'a', '1');
    await driver.hset(key, 'b', '2');

    const all = await driver.hgetall(key);
    assert.deepEqual(all, { a: '1', b: '2' });
  });

  integrationTest('hdel deletes hash field', async () => {
    const key = `${testPrefix}hashdel`;
    await driver.hset(key, 'field', 'value');
    const deleted = await driver.hdel(key, 'field');
    assert.equal(deleted, 1);
    const value = await driver.hget(key, 'field');
    assert.equal(value, null);
  });

  integrationTest('collection scans return structured resumable batches', async () => {
    const hashKey = `${testPrefix}scan:hash`;
    const setKey = `${testPrefix}scan:set`;
    const zsetKey = `${testPrefix}scan:zset`;
    await driver.hset(hashKey, 'alpha', '1');
    await driver.hset(hashKey, 'beta', '2');
    await driver.sadd(setKey, 'alpha', 'beta');
    await driver.zadd(zsetKey, 1, 'alpha');
    await driver.zadd(zsetKey, 2, 'beta');

    const hash = await driver.hscan(hashKey, '0', 10, 'a*');
    const set = await driver.sscan(setKey, '0', 10, 'a*');
    const zset = await driver.zscan(zsetKey, '0', 10, 'a*');
    assert.deepEqual(hash.entries, [{ field: 'alpha', value: '1' }]);
    assert.deepEqual(set.members, ['alpha']);
    assert.deepEqual(zset.entries, [{ member: 'alpha', score: '1' }]);
    assert.match(hash.cursor, /^\d+$/);
    assert.match(set.cursor, /^\d+$/);
    assert.match(zset.cursor, /^\d+$/);
  });

  integrationTest('legacy collection reads enforce DB_MAX_ROWS before materialization', async () => {
    const originalMaxRows = process.env.DB_MAX_ROWS;
    const hashKey = `${testPrefix}bounded:hash`;
    const listKey = `${testPrefix}bounded:list`;
    const setKey = `${testPrefix}bounded:set`;
    const zsetKey = `${testPrefix}bounded:zset`;
    await driver.hset(hashKey, 'a', '1');
    await driver.hset(hashKey, 'b', '2');
    await driver.hset(hashKey, 'c', '3');
    await driver.rpush(listKey, 'a', 'b', 'c');
    await driver.sadd(setKey, 'a', 'b', 'c');
    await driver.zadd(zsetKey, 1, 'a');
    await driver.zadd(zsetKey, 2, 'b');
    await driver.zadd(zsetKey, 3, 'c');

    try {
      process.env.DB_MAX_ROWS = '2';
      await assert.rejects(driver.hgetall(hashKey), /HGETALL.*DB_MAX_ROWS=2/);
      await assert.rejects(driver.lrange(listKey, 0, -1), /LRANGE.*DB_MAX_ROWS=2/);
      await assert.rejects(driver.smembers(setKey), /SMEMBERS.*DB_MAX_ROWS=2/);
      await assert.rejects(driver.zrange(zsetKey, 0, -1), /ZRANGE.*DB_MAX_ROWS=2/);

      assert.deepEqual(await driver.lrange(listKey, 0, 1), ['a', 'b']);
      assert.deepEqual(await driver.zrange(zsetKey, 0, 1), ['a', 'b']);
      await assert.rejects(
        driver.pipeline([{ command: 'hgetall', key: hashKey }]),
        /pipeline 禁止集合物化命令/,
      );
    } finally {
      if (originalMaxRows === undefined) delete process.env.DB_MAX_ROWS;
      else process.env.DB_MAX_ROWS = originalMaxRows;
    }
  });

  integrationTest('pipeline preflights aggregate string response bytes', async () => {
    const originalMaxResponseBytes = process.env.DB_MAX_RESPONSE_BYTES;
    const first = `${testPrefix}pipeline:large:1`;
    const second = `${testPrefix}pipeline:large:2`;
    const largeString = `${testPrefix}large:string`;
    const hash = `${testPrefix}pipeline:large:hash`;
    await driver.set(first, 'x'.repeat(2000));
    await driver.set(second, 'y'.repeat(2000));
    await driver.set(largeString, 's'.repeat(4000));
    await driver.hset(hash, 'payload', 'z'.repeat(4000));
    try {
      process.env.DB_MAX_RESPONSE_BYTES = '4096';
      await assert.rejects(driver.get(largeString), /字符串大小 4000 字节.*上限 3072 字节/);
      await assert.rejects(driver.hget(hash, 'payload'), /Hash 字段大小 4000 字节/);
      await assert.rejects(driver.hgetall(hash), /HGETALL 目标 key.*超过响应数据上限/);
      await assert.rejects(
        driver.pipeline([
          { command: 'get', key: first },
          { command: 'get', key: second },
        ]),
        /pipeline 字符串结果共 4000 字节.*上限 3072 字节/,
      );
    } finally {
      if (originalMaxResponseBytes === undefined) delete process.env.DB_MAX_RESPONSE_BYTES;
      else process.env.DB_MAX_RESPONSE_BYTES = originalMaxResponseBytes;
    }
  });

  integrationTest('set with TTL expires', async () => {
    const key = `${testPrefix}ttl`;
    await driver.set(key, 'temp', 1); // 1 second TTL

    // 立即获取应该存在
    const value = await driver.get(key);
    assert.equal(value, 'temp');

    // 等待过期
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const expired = await driver.get(key);
    assert.equal(expired, null);
  });
});
