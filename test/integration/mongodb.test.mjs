import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { checkTestEnv, TEST_CONNECTIONS } from '../helpers/test-config.mjs';

const SKIP_REASON = 'MongoDB 测试环境不可用（需要 Docker: docker compose up -d）';

describe('MongoDB Integration', () => {
  let driver;
  let isAvailable = false;
  const testCollection = 'test_collection_' + Date.now();

  before(async () => {
    isAvailable = await checkTestEnv('mongodb');
    if (!isAvailable) return;

    const { createMongoDriver } = await import('../../dist/drivers/mongo/mongo-driver.js');
    driver = await createMongoDriver(TEST_CONNECTIONS.mongodb);
  });

  after(async () => {
    if (driver) {
      try {
        // 清理测试数据
        await driver.deleteMany(testCollection, {});
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

  test('listCollections returns array', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const collections = await driver.listCollections();
    assert.ok(Array.isArray(collections));
  });

  test('insertOne inserts document', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const result = await driver.insertOne(testCollection, {
      name: 'test',
      value: 42,
    });
    assert.equal(result.acknowledged, true);
    assert.ok(result.insertedId);
    assert.equal(result.insertedCount, 1);
  });

  test('find returns documents', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const docs = await driver.find(testCollection, { name: 'test' }, { limit: 10 });
    assert.ok(Array.isArray(docs));
    assert.ok(docs.length > 0);
    assert.equal(docs[0].name, 'test');
  });

  test('count returns count', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const count = await driver.count(testCollection, {});
    assert.ok(count > 0);
  });

  test('updateOne updates document', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const result = await driver.updateOne(
      testCollection,
      { name: 'test' },
      { $set: { value: 100 } }
    );
    assert.equal(result.acknowledged, true);
    assert.equal(result.matchedCount, 1);
    assert.equal(result.modifiedCount, 1);
  });

  test('deleteOne deletes document', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    // 先插入一个文档
    await driver.insertOne(testCollection, { name: 'to_delete' });
    const result = await driver.deleteOne(testCollection, { name: 'to_delete' });
    assert.equal(result.acknowledged, true);
    assert.equal(result.deletedCount, 1);
  });

  test('aggregate returns results', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const results = await driver.aggregate(testCollection, [
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);
    assert.ok(Array.isArray(results));
  });

  test('listIndexes returns indexes', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const indexes = await driver.listIndexes(testCollection);
    assert.ok(Array.isArray(indexes));
  });

  test('createIndex creates index', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const indexName = await driver.createIndex(
      testCollection,
      { name: 1 },
      { name: 'test_name_index' }
    );
    assert.ok(indexName);
  });
});
