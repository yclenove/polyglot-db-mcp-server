import assert from 'node:assert/strict';
import { test, describe, beforeEach } from 'node:test';

// Mock McpServer
class MockMcpServer {
  constructor() {
    this.tools = new Map();
  }
  registerTool(name, schema, handler) {
    this.tools.set(name, { schema, handler });
  }
}

// Mock MongoDriver
class MockMongoDriver {
  constructor() {
    this.operations = [];
  }
  async listCollections() {
    return ['users', 'orders'];
  }
  async find(collection, filter, options) {
    this.operations.push({ op: 'find', collection, filter, options });
    return [{ id: 1, name: 'test' }];
  }
  async aggregate(collection, pipeline) {
    this.operations.push({ op: 'aggregate', collection, pipeline });
    return [{ _id: null, count: 10 }];
  }
  async count(collection, filter) {
    this.operations.push({ op: 'count', collection, filter });
    return 10;
  }
  async insertOne(collection, document) {
    this.operations.push({ op: 'insertOne', collection, document });
    return { acknowledged: true, insertedId: 'abc123', insertedCount: 1 };
  }
  async insertMany(collection, documents) {
    this.operations.push({ op: 'insertMany', collection, documents });
    return { acknowledged: true, insertedId: null, insertedCount: documents.length };
  }
  async updateOne(collection, filter, update, options) {
    this.operations.push({ op: 'updateOne', collection, filter, update, options });
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }
  async deleteOne(collection, filter) {
    this.operations.push({ op: 'deleteOne', collection, filter });
    return { acknowledged: true, deletedCount: 1 };
  }
  async updateMany(collection, filter, update) {
    this.operations.push({ op: 'updateMany', collection, filter, update });
    return { acknowledged: true, matchedCount: 5, modifiedCount: 3 };
  }
  async deleteMany(collection, filter) {
    this.operations.push({ op: 'deleteMany', collection, filter });
    return { acknowledged: true, deletedCount: 5 };
  }
  async findOneAndUpdate(collection, filter, update, options) {
    this.operations.push({ op: 'findOneAndUpdate', collection, filter, update, options });
    return { _id: 'abc', name: 'updated' };
  }
  async findOneAndDelete(collection, filter) {
    this.operations.push({ op: 'findOneAndDelete', collection, filter });
    return { _id: 'abc', name: 'deleted' };
  }
  async dropCollection(collection) {
    this.operations.push({ op: 'dropCollection', collection });
    return true;
  }
  async renameCollection(collection, newName) {
    this.operations.push({ op: 'renameCollection', collection, newName });
    return newName;
  }
  async listIndexes(collection) {
    return [{ name: '_id_', key: { _id: 1 } }];
  }
  async createIndex(collection, keys, options) {
    this.operations.push({ op: 'createIndex', collection, keys, options });
    return 'index_name';
  }
}

// Mock ConnectionRegistry
class MockRegistry {
  constructor() {
    this.handles = new Map();
    this.defaultId = 'mdb';
  }
  resolveConnectionId(id) {
    if (!id || id.trim() === '') return this.defaultId;
    if (!this.handles.has(id)) throw new Error(`未知 connection_id: ${id}`);
    return id;
  }
  require(id) {
    const h = this.handles.get(id);
    if (!h) throw new Error(`未知 connection_id: ${id}`);
    return h;
  }
  requireMongo(id) {
    const h = this.require(id);
    if (h.kind !== 'mongo') throw new Error(`连接「${id}」不是 MongoDB`);
    return h.driver;
  }
}

describe('MongoDB Tools', () => {
  let server;
  let registry;
  let mockDriver;

  beforeEach(async () => {
    server = new MockMcpServer();
    registry = new MockRegistry();
    mockDriver = new MockMongoDriver();

    registry.handles.set('mdb', {
      id: 'mdb',
      spec: { id: 'mdb', engine: 'mongodb', readonly: false },
      kind: 'mongo',
      driver: mockDriver,
    });

    registry.handles.set('mdb_ro', {
      id: 'mdb_ro',
      spec: { id: 'mdb_ro', engine: 'mongodb', readonly: true },
      kind: 'mongo',
      driver: mockDriver,
    });

    const { registerMongoTools } = await import('../../dist/tools/mongo.js');
    registerMongoTools(server, registry);
  });

  test('mongo_list_collections tool is registered', () => {
    assert.ok(server.tools.has('mongo_list_collections'));
  });

  test('mongo_find tool is registered', () => {
    assert.ok(server.tools.has('mongo_find'));
  });

  test('mongo_aggregate tool is registered', () => {
    assert.ok(server.tools.has('mongo_aggregate'));
  });

  test('mongo_count tool is registered', () => {
    assert.ok(server.tools.has('mongo_count'));
  });

  test('mongo_insert_one tool is registered', () => {
    assert.ok(server.tools.has('mongo_insert_one'));
  });

  test('mongo_insert_many tool is registered', () => {
    assert.ok(server.tools.has('mongo_insert_many'));
  });

  test('mongo_update_one tool is registered', () => {
    assert.ok(server.tools.has('mongo_update_one'));
  });

  test('mongo_delete_one tool is registered', () => {
    assert.ok(server.tools.has('mongo_delete_one'));
  });

  test('mongo_list_indexes tool is registered', () => {
    assert.ok(server.tools.has('mongo_list_indexes'));
  });

  test('mongo_create_index tool is registered', () => {
    assert.ok(server.tools.has('mongo_create_index'));
  });

  test('mongo_list_collections returns collection names', async () => {
    const tool = server.tools.get('mongo_list_collections');
    const result = await tool.handler({});
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.deepEqual(data.collections, ['users', 'orders']);
  });

  test('mongo_find returns documents', async () => {
    const tool = server.tools.get('mongo_find');
    const result = await tool.handler({
      collection: 'users',
      filter_json: '{"name": "test"}',
      limit: 10,
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.ok(Array.isArray(data.rows));
    assert.equal(data.rows.length, 1);
  });

  test('mongo_find with default filter', async () => {
    const tool = server.tools.get('mongo_find');
    const result = await tool.handler({
      collection: 'users',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(data.rows));
  });

  test('mongo_find rejects NoSQL injection', async () => {
    const tool = server.tools.get('mongo_find');
    const result = await tool.handler({
      collection: 'users',
      filter_json: '{"$where": "function() { return true; }"}',
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('NoSQL 注入'));
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.error_info.code, 'MONGO_003');
    assert.match(data.detail, /\$where/);
  });

  test('mongo_aggregate returns aggregated results', async () => {
    const tool = server.tools.get('mongo_aggregate');
    const result = await tool.handler({
      collection: 'users',
      pipeline_json: '[{"$group": {"_id": null, "count": {"$sum": 1}}}]',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.ok(Array.isArray(data.rows));
  });

  test('mongo_count returns count', async () => {
    const tool = server.tools.get('mongo_count');
    const result = await tool.handler({
      collection: 'users',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.equal(data.count, 10);
  });

  test('mongo_insert_one inserts document', async () => {
    const tool = server.tools.get('mongo_insert_one');
    const result = await tool.handler({
      collection: 'users',
      document_json: '{"name": "test", "age": 25}',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.equal(data.acknowledged, true);
    assert.equal(data.insertedCount, 1);
  });

  test('mongo_insert_one rejects invalid JSON', async () => {
    const tool = server.tools.get('mongo_insert_one');
    const result = await tool.handler({
      collection: 'users',
      document_json: 'invalid json',
    });
    assert.equal(result.isError, true);
  });

  test('mongo_insert_one rejects non-object', async () => {
    const tool = server.tools.get('mongo_insert_one');
    const result = await tool.handler({
      collection: 'users',
      document_json: '[1, 2, 3]',
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('JSON 对象'));
  });

  test('mongo_insert_many inserts multiple documents', async () => {
    const tool = server.tools.get('mongo_insert_many');
    const result = await tool.handler({
      collection: 'users',
      documents_json: '[{"name": "test1"}, {"name": "test2"}]',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.equal(data.insertedCount, 2);
  });

  test('mongo_update_one updates document', async () => {
    const tool = server.tools.get('mongo_update_one');
    const result = await tool.handler({
      collection: 'users',
      filter_json: '{"name": "test"}',
      update_json: '{"$set": {"age": 26}}',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.equal(data.matchedCount, 1);
    assert.equal(data.modifiedCount, 1);
  });

  test('mongo_update_one rejects NoSQL injection in filter', async () => {
    const tool = server.tools.get('mongo_update_one');
    const result = await tool.handler({
      collection: 'users',
      filter_json: '{"$where": "function() { return true; }"}',
      update_json: '{"$set": {"age": 26}}',
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('NoSQL 注入'));
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.error_info.code, 'MONGO_003');
  });

  test('mongo_delete_one deletes document', async () => {
    const tool = server.tools.get('mongo_delete_one');
    const result = await tool.handler({
      collection: 'users',
      filter_json: '{"name": "test"}',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.equal(data.deletedCount, 1);
  });

  test('mongo_list_indexes returns indexes', async () => {
    const tool = server.tools.get('mongo_list_indexes');
    const result = await tool.handler({
      collection: 'users',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.ok(Array.isArray(data.indexes));
  });

  test('mongo_create_index creates index', async () => {
    const tool = server.tools.get('mongo_create_index');
    const result = await tool.handler({
      collection: 'users',
      keys_json: '{"name": 1}',
      name: 'name_index',
      unique: true,
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.equal(data.indexName, 'index_name');
  });

  // ── v1.3.0 新增工具测试 ──────────────────────────────────

  test('mongo_update_many tool is registered', () => {
    assert.ok(server.tools.has('mongo_update_many'));
  });

  test('mongo_delete_many tool is registered', () => {
    assert.ok(server.tools.has('mongo_delete_many'));
  });

  test('mongo_find_one_and_update tool is registered', () => {
    assert.ok(server.tools.has('mongo_find_one_and_update'));
  });

  test('mongo_find_one_and_delete tool is registered', () => {
    assert.ok(server.tools.has('mongo_find_one_and_delete'));
  });

  test('mongo_drop_collection tool is registered', () => {
    assert.ok(server.tools.has('mongo_drop_collection'));
  });

  test('mongo_rename_collection tool is registered', () => {
    assert.ok(server.tools.has('mongo_rename_collection'));
  });

  test('mongo_update_many updates multiple documents', async () => {
    const tool = server.tools.get('mongo_update_many');
    const result = await tool.handler({
      collection: 'users',
      filter_json: '{"status": "inactive"}',
      update_json: '{"$set": {"status": "active"}}',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.equal(data.matchedCount, 5);
    assert.equal(data.modifiedCount, 3);
  });

  test('mongo_delete_many deletes multiple documents', async () => {
    const tool = server.tools.get('mongo_delete_many');
    const result = await tool.handler({
      collection: 'users',
      filter_json: '{"status": "inactive"}',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.equal(data.deletedCount, 5);
  });

  test('mongo_find_one_and_update returns document', async () => {
    const tool = server.tools.get('mongo_find_one_and_update');
    const result = await tool.handler({
      collection: 'users',
      filter_json: '{"name": "test"}',
      update_json: '{"$set": {"age": 30}}',
      returnDocument: 'after',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.ok(data.document);
  });

  test('mongo_find_one_and_delete returns deleted document', async () => {
    const tool = server.tools.get('mongo_find_one_and_delete');
    const result = await tool.handler({
      collection: 'users',
      filter_json: '{"name": "test"}',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.ok(data.document);
  });

  test('mongo_drop_collection drops collection', async () => {
    const tool = server.tools.get('mongo_drop_collection');
    const result = await tool.handler({ collection: 'temp_data' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.equal(data.dropped, true);
  });

  test('mongo_rename_collection renames collection', async () => {
    const tool = server.tools.get('mongo_rename_collection');
    const result = await tool.handler({
      collection: 'old_name',
      newName: 'new_name',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'mdb');
    assert.equal(data.collectionName, 'new_name');
  });
});
