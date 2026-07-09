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

// Mock RedisDriver
class MockRedisDriver {
  constructor() {
    this.store = new Map();
    this.operations = [];
  }
  async get(key) {
    this.operations.push({ op: 'get', key });
    return this.store.get(key) ?? null;
  }
  async set(key, value, ttlSeconds) {
    this.operations.push({ op: 'set', key, value, ttlSeconds });
    this.store.set(key, value);
  }
  async del(key) {
    this.operations.push({ op: 'del', key });
    const existed = this.store.has(key) ? 1 : 0;
    this.store.delete(key);
    return existed;
  }
  async scan(match, cursor, count) {
    this.operations.push({ op: 'scan', match, cursor, count });
    const keys = [...this.store.keys()].filter(k => {
      if (match === '*') return true;
      const pattern = match.replace(/\*/g, '.*');
      return new RegExp(`^${pattern}$`).test(k);
    });
    return { cursor: '0', keys };
  }
  async hget(key, field) {
    this.operations.push({ op: 'hget', key, field });
    const hash = this.store.get(key);
    if (typeof hash === 'object' && hash !== null) {
      return hash[field] ?? null;
    }
    return null;
  }
  async hset(key, field, value) {
    this.operations.push({ op: 'hset', key, field, value });
    let hash = this.store.get(key);
    if (typeof hash !== 'object' || hash === null) {
      hash = {};
    }
    hash[field] = value;
    this.store.set(key, hash);
  }
  async hgetall(key) {
    this.operations.push({ op: 'hgetall', key });
    const hash = this.store.get(key);
    if (typeof hash === 'object' && hash !== null) {
      return hash;
    }
    return {};
  }
  async hdel(key, field) {
    this.operations.push({ op: 'hdel', key, field });
    const hash = this.store.get(key);
    if (typeof hash === 'object' && hash !== null && field in hash) {
      delete hash[field];
      return 1;
    }
    return 0;
  }
  async lpush(key, ...values) {
    this.operations.push({ op: 'lpush', key, values });
    let list = this.store.get(key);
    if (!Array.isArray(list)) list = [];
    list.unshift(...values);
    this.store.set(key, list);
    return list.length;
  }
  async rpush(key, ...values) {
    this.operations.push({ op: 'rpush', key, values });
    let list = this.store.get(key);
    if (!Array.isArray(list)) list = [];
    list.push(...values);
    this.store.set(key, list);
    return list.length;
  }
  async lpop(key) {
    this.operations.push({ op: 'lpop', key });
    const list = this.store.get(key);
    if (Array.isArray(list) && list.length > 0) return list.shift();
    return null;
  }
  async rpop(key) {
    this.operations.push({ op: 'rpop', key });
    const list = this.store.get(key);
    if (Array.isArray(list) && list.length > 0) return list.pop();
    return null;
  }
  async lrange(key, start, stop) {
    this.operations.push({ op: 'lrange', key, start, stop });
    const list = this.store.get(key);
    if (!Array.isArray(list)) return [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  }
  async llen(key) {
    this.operations.push({ op: 'llen', key });
    const list = this.store.get(key);
    return Array.isArray(list) ? list.length : 0;
  }
  async sadd(key, ...members) {
    this.operations.push({ op: 'sadd', key, members });
    let set = this.store.get(key);
    if (!(set instanceof Set)) set = new Set();
    let added = 0;
    for (const m of members) { if (!set.has(m)) { set.add(m); added++; } }
    this.store.set(key, set);
    return added;
  }
  async smembers(key) {
    this.operations.push({ op: 'smembers', key });
    const set = this.store.get(key);
    return set instanceof Set ? [...set] : [];
  }
  async srem(key, ...members) {
    this.operations.push({ op: 'srem', key, members });
    const set = this.store.get(key);
    if (!(set instanceof Set)) return 0;
    let removed = 0;
    for (const m of members) { if (set.delete(m)) removed++; }
    return removed;
  }
  async scard(key) {
    this.operations.push({ op: 'scard', key });
    const set = this.store.get(key);
    return set instanceof Set ? set.size : 0;
  }
  async sismember(key, member) {
    this.operations.push({ op: 'sismember', key, member });
    const set = this.store.get(key);
    return set instanceof Set && set.has(member) ? 1 : 0;
  }
  async zadd(key, score, member) {
    this.operations.push({ op: 'zadd', key, score, member });
    let zset = this.store.get(key);
    if (!Array.isArray(zset)) zset = [];
    const existing = zset.findIndex(z => z.member === member);
    if (existing >= 0) zset[existing].score = score;
    else zset.push({ member, score });
    zset.sort((a, b) => a.score - b.score);
    this.store.set(key, zset);
    return 1;
  }
  async zrange(key, start, stop, withScores) {
    this.operations.push({ op: 'zrange', key, start, stop, withScores });
    const zset = this.store.get(key);
    if (!Array.isArray(zset)) return [];
    const slice = zset.slice(start, stop === -1 ? undefined : stop + 1);
    if (withScores) return slice.flatMap(z => [z.member, String(z.score)]);
    return slice.map(z => z.member);
  }
  async zrem(key, ...members) {
    this.operations.push({ op: 'zrem', key, members });
    const zset = this.store.get(key);
    if (!Array.isArray(zset)) return 0;
    let removed = 0;
    for (const m of members) {
      const idx = zset.findIndex(z => z.member === m);
      if (idx >= 0) { zset.splice(idx, 1); removed++; }
    }
    return removed;
  }
  async zcard(key) {
    this.operations.push({ op: 'zcard', key });
    const zset = this.store.get(key);
    return Array.isArray(zset) ? zset.length : 0;
  }
  async zscore(key, member) {
    this.operations.push({ op: 'zscore', key, member });
    const zset = this.store.get(key);
    if (!Array.isArray(zset)) return null;
    const found = zset.find(z => z.member === member);
    return found ? String(found.score) : null;
  }
  async expire(key, seconds) {
    this.operations.push({ op: 'expire', key, seconds });
    return this.store.has(key) ? 1 : 0;
  }
  async ttl(key) {
    this.operations.push({ op: 'ttl', key });
    return this.store.has(key) ? 3600 : -2;
  }
}

// Mock ConnectionRegistry
class MockRegistry {
  constructor() {
    this.handles = new Map();
    this.defaultId = 'rd';
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
  requireRedis(id) {
    const h = this.require(id);
    if (h.kind !== 'redis') throw new Error(`连接「${id}」不是 Redis`);
    return h.driver;
  }
}

describe('Redis Tools', () => {
  let server;
  let registry;
  let mockDriver;

  beforeEach(async () => {
    server = new MockMcpServer();
    registry = new MockRegistry();
    mockDriver = new MockRedisDriver();

    registry.handles.set('rd', {
      id: 'rd',
      spec: { id: 'rd', engine: 'redis', readonly: false, keyPrefix: 'app:' },
      kind: 'redis',
      driver: mockDriver,
    });

    registry.handles.set('rd_ro', {
      id: 'rd_ro',
      spec: { id: 'rd_ro', engine: 'redis', readonly: true },
      kind: 'redis',
      driver: mockDriver,
    });

    const { registerRedisTools } = await import('../../dist/tools/redis.js');
    registerRedisTools(server, registry);
  });

  test('redis_get tool is registered', () => {
    assert.ok(server.tools.has('redis_get'));
  });

  test('redis_set tool is registered', () => {
    assert.ok(server.tools.has('redis_set'));
  });

  test('redis_del tool is registered', () => {
    assert.ok(server.tools.has('redis_del'));
  });

  test('redis_scan tool is registered', () => {
    assert.ok(server.tools.has('redis_scan'));
  });

  test('redis_blocked_commands tool is registered', () => {
    assert.ok(server.tools.has('redis_blocked_commands'));
  });

  test('redis_hget tool is registered', () => {
    assert.ok(server.tools.has('redis_hget'));
  });

  test('redis_hset tool is registered', () => {
    assert.ok(server.tools.has('redis_hset'));
  });

  test('redis_hgetall tool is registered', () => {
    assert.ok(server.tools.has('redis_hgetall'));
  });

  test('redis_hdel tool is registered', () => {
    assert.ok(server.tools.has('redis_hdel'));
  });

  test('redis_get returns value', async () => {
    mockDriver.store.set('app:test', 'value1');
    const tool = server.tools.get('redis_get');
    const result = await tool.handler({ key: 'app:test' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'rd');
    assert.equal(data.value, 'value1');
  });

  test('redis_get returns null for missing key', async () => {
    const tool = server.tools.get('redis_get');
    const result = await tool.handler({ key: 'app:missing' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.value, null);
  });

  test('redis_set stores value', async () => {
    const tool = server.tools.get('redis_set');
    const result = await tool.handler({
      key: 'app:test',
      value: 'value1',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'rd');
    assert.equal(data.ok, true);
    assert.equal(mockDriver.store.get('app:test'), 'value1');
  });

  test('redis_set with TTL', async () => {
    const tool = server.tools.get('redis_set');
    await tool.handler({
      key: 'app:test',
      value: 'value1',
      ttl_seconds: 60,
    });
    assert.equal(mockDriver.operations[0].ttlSeconds, 60);
  });

  test('redis_del deletes key', async () => {
    mockDriver.store.set('app:test', 'value1');
    const tool = server.tools.get('redis_del');
    const result = await tool.handler({ key: 'app:test' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'rd');
    assert.equal(data.deleted, 1);
    assert.equal(mockDriver.store.has('app:test'), false);
  });

  test('redis_del returns 0 for missing key', async () => {
    const tool = server.tools.get('redis_del');
    const result = await tool.handler({ key: 'app:missing' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.deleted, 0);
  });

  test('redis_scan returns matching keys', async () => {
    mockDriver.store.set('app:user:1', 'a');
    mockDriver.store.set('app:user:2', 'b');
    mockDriver.store.set('app:order:1', 'c');

    const tool = server.tools.get('redis_scan');
    const result = await tool.handler({
      match: 'app:user:*',
      cursor: '0',
      count: 100,
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'rd');
    assert.equal(data.next_cursor, '0');
    assert.ok(Array.isArray(data.keys));
    assert.equal(data.keys.length, 2);
  });

  test('redis_hget returns hash field value', async () => {
    mockDriver.store.set('app:user:1', { name: 'John', age: '30' });
    const tool = server.tools.get('redis_hget');
    const result = await tool.handler({
      key: 'app:user:1',
      field: 'name',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'rd');
    assert.equal(data.value, 'John');
  });

  test('redis_hset sets hash field', async () => {
    const tool = server.tools.get('redis_hset');
    const result = await tool.handler({
      key: 'app:user:1',
      field: 'name',
      value: 'John',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'rd');
    assert.equal(data.ok, true);
    assert.deepEqual(mockDriver.store.get('app:user:1'), { name: 'John' });
  });

  test('redis_hgetall returns all hash fields', async () => {
    mockDriver.store.set('app:user:1', { name: 'John', age: '30' });
    const tool = server.tools.get('redis_hgetall');
    const result = await tool.handler({ key: 'app:user:1' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'rd');
    assert.deepEqual(data.fields, { name: 'John', age: '30' });
  });

  test('redis_hdel deletes hash field', async () => {
    mockDriver.store.set('app:user:1', { name: 'John', age: '30' });
    const tool = server.tools.get('redis_hdel');
    const result = await tool.handler({
      key: 'app:user:1',
      field: 'name',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'rd');
    assert.equal(data.deleted, 1);
    assert.deepEqual(mockDriver.store.get('app:user:1'), { age: '30' });
  });

  test('redis_blocked_commands returns blocked list', async () => {
    const tool = server.tools.get('redis_blocked_commands');
    const result = await tool.handler({});
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(data.blocked));
    assert.ok(data.blocked.includes('FLUSHDB'));
    assert.ok(data.blocked.includes('FLUSHALL'));
    assert.ok(data.blocked.includes('KEYS'));
  });

  // ── v1.3.0 新增工具测试 ──────────────────────────────────

  test('redis_lpush tool is registered', () => {
    assert.ok(server.tools.has('redis_lpush'));
  });

  test('redis_rpush tool is registered', () => {
    assert.ok(server.tools.has('redis_rpush'));
  });

  test('redis_lpop tool is registered', () => {
    assert.ok(server.tools.has('redis_lpop'));
  });

  test('redis_rpop tool is registered', () => {
    assert.ok(server.tools.has('redis_rpop'));
  });

  test('redis_lrange tool is registered', () => {
    assert.ok(server.tools.has('redis_lrange'));
  });

  test('redis_llen tool is registered', () => {
    assert.ok(server.tools.has('redis_llen'));
  });

  test('redis_sadd tool is registered', () => {
    assert.ok(server.tools.has('redis_sadd'));
  });

  test('redis_smembers tool is registered', () => {
    assert.ok(server.tools.has('redis_smembers'));
  });

  test('redis_srem tool is registered', () => {
    assert.ok(server.tools.has('redis_srem'));
  });

  test('redis_scard tool is registered', () => {
    assert.ok(server.tools.has('redis_scard'));
  });

  test('redis_sismember tool is registered', () => {
    assert.ok(server.tools.has('redis_sismember'));
  });

  test('redis_zadd tool is registered', () => {
    assert.ok(server.tools.has('redis_zadd'));
  });

  test('redis_zrange tool is registered', () => {
    assert.ok(server.tools.has('redis_zrange'));
  });

  test('redis_zrem tool is registered', () => {
    assert.ok(server.tools.has('redis_zrem'));
  });

  test('redis_zcard tool is registered', () => {
    assert.ok(server.tools.has('redis_zcard'));
  });

  test('redis_zscore tool is registered', () => {
    assert.ok(server.tools.has('redis_zscore'));
  });

  test('redis_expire tool is registered', () => {
    assert.ok(server.tools.has('redis_expire'));
  });

  test('redis_ttl tool is registered', () => {
    assert.ok(server.tools.has('redis_ttl'));
  });

  test('redis_lpush inserts to list head', async () => {
    const tool = server.tools.get('redis_lpush');
    const result = await tool.handler({ key: 'app:queue', values: ['a', 'b'] });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.length, 2);
  });

  test('redis_rpush inserts to list tail', async () => {
    const tool = server.tools.get('redis_rpush');
    const result = await tool.handler({ key: 'app:queue', values: ['x'] });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.length, 1);
  });

  test('redis_lpop removes from list head', async () => {
    mockDriver.store.set('app:queue', ['a', 'b', 'c']);
    const tool = server.tools.get('redis_lpop');
    const result = await tool.handler({ key: 'app:queue' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.value, 'a');
  });

  test('redis_rpop removes from list tail', async () => {
    mockDriver.store.set('app:queue', ['a', 'b', 'c']);
    const tool = server.tools.get('redis_rpop');
    const result = await tool.handler({ key: 'app:queue' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.value, 'c');
  });

  test('redis_lrange returns list range', async () => {
    mockDriver.store.set('app:queue', ['a', 'b', 'c', 'd']);
    const tool = server.tools.get('redis_lrange');
    const result = await tool.handler({ key: 'app:queue', start: 1, stop: 2 });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.deepEqual(data.values, ['b', 'c']);
  });

  test('redis_llen returns list length', async () => {
    mockDriver.store.set('app:queue', ['a', 'b', 'c']);
    const tool = server.tools.get('redis_llen');
    const result = await tool.handler({ key: 'app:queue' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.length, 3);
  });

  test('redis_sadd adds set members', async () => {
    const tool = server.tools.get('redis_sadd');
    const result = await tool.handler({ key: 'app:tags', members: ['js', 'ts', 'py'] });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.added, 3);
  });

  test('redis_smembers returns all set members', async () => {
    mockDriver.store.set('app:tags', new Set(['js', 'ts']));
    const tool = server.tools.get('redis_smembers');
    const result = await tool.handler({ key: 'app:tags' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.deepEqual(data.members.sort(), ['js', 'ts']);
  });

  test('redis_zadd adds sorted set member', async () => {
    const tool = server.tools.get('redis_zadd');
    const result = await tool.handler({ key: 'app:scores', score: 100, member: 'alice' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.added, 1);
  });

  test('redis_zrange returns sorted set range', async () => {
    mockDriver.store.set('app:scores', [{ member: 'alice', score: 100 }, { member: 'bob', score: 200 }]);
    const tool = server.tools.get('redis_zrange');
    const result = await tool.handler({ key: 'app:scores', start: 0, stop: -1 });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.deepEqual(data.members, ['alice', 'bob']);
  });

  test('redis_zrange with scores', async () => {
    mockDriver.store.set('app:scores', [{ member: 'alice', score: 100 }, { member: 'bob', score: 200 }]);
    const tool = server.tools.get('redis_zrange');
    const result = await tool.handler({ key: 'app:scores', start: 0, stop: -1, withScores: true });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.deepEqual(data.members, ['alice', '100', 'bob', '200']);
  });

  test('redis_expire sets TTL', async () => {
    mockDriver.store.set('app:key', 'val');
    const tool = server.tools.get('redis_expire');
    const result = await tool.handler({ key: 'app:key', seconds: 60 });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.ok, true);
  });

  test('redis_ttl returns remaining TTL', async () => {
    mockDriver.store.set('app:key', 'val');
    const tool = server.tools.get('redis_ttl');
    const result = await tool.handler({ key: 'app:key' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.ttl, 3600);
  });

  test('redis_ttl returns -2 for missing key', async () => {
    const tool = server.tools.get('redis_ttl');
    const result = await tool.handler({ key: 'app:missing' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.ttl, -2);
  });
});
