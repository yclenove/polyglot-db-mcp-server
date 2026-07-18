import assert from 'node:assert/strict';
import { isUtf8 } from 'node:buffer';
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
  async getWindow(key, offsetBytes, maxBytes) {
    this.operations.push({ op: 'getWindow', key, offsetBytes, maxBytes });
    const stored = this.store.get(key);
    if (stored === undefined) {
      return {
        value: null,
        valueEncoding: null,
        totalBytes: 0,
        offsetBytes: 0,
        returnedBytes: 0,
        nextOffsetBytes: null,
        truncated: false,
      };
    }
    const bytes = Buffer.from(String(stored));
    const start = Math.min(offsetBytes, bytes.length);
    const end = Math.min(bytes.length, start + maxBytes);
    const valueBytes = bytes.subarray(start, end);
    const utf8 = isUtf8(valueBytes);
    return {
      value: utf8 ? valueBytes.toString('utf8') : null,
      ...(utf8 ? {} : { valueBase64: valueBytes.toString('base64') }),
      valueEncoding: utf8 ? 'utf8' : 'base64',
      totalBytes: bytes.length,
      offsetBytes: start,
      returnedBytes: end - start,
      nextOffsetBytes: end < bytes.length ? end : null,
      truncated: start > 0 || end < bytes.length,
    };
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
  async hscan(key, cursor, count, match = '*') {
    this.operations.push({ op: 'hscan', key, cursor, count, match });
    const hash = this.store.get(key);
    const entries = typeof hash === 'object' && hash !== null && !Array.isArray(hash)
      ? Object.entries(hash)
          .filter(([field]) => match === '*' || field.startsWith(match.replace(/\*$/, '')))
          .slice(0, count)
          .map(([field, value]) => ({ field, value: String(value) }))
      : [];
    return { cursor: '0', entries };
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
  async sscan(key, cursor, count, match = '*') {
    this.operations.push({ op: 'sscan', key, cursor, count, match });
    const set = this.store.get(key);
    const members = set instanceof Set
      ? [...set].filter(member => match === '*' || member.startsWith(match.replace(/\*$/, ''))).slice(0, count)
      : [];
    return { cursor: '0', members };
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
  async zscan(key, cursor, count, match = '*') {
    this.operations.push({ op: 'zscan', key, cursor, count, match });
    const zset = this.store.get(key);
    const entries = Array.isArray(zset)
      ? zset
          .filter(({ member }) => match === '*' || member.startsWith(match.replace(/\*$/, '')))
          .slice(0, count)
          .map(({ member, score }) => ({ member, score: String(score) }))
      : [];
    return { cursor: '0', entries };
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
  async pipeline(commands) {
    this.operations.push({ op: 'pipeline', commands });
    const results = [];
    for (const [index, command] of commands.entries()) {
      try {
        let result;
        switch (command.command) {
          case 'get':
            result = await this.get(command.key);
            break;
          case 'set':
            await this.set(command.key, command.args[0], command.args[1]);
            result = 'OK';
            break;
          case 'del':
            result = await this.del(command.key);
            break;
          case 'hget':
            result = await this.hget(command.key, command.args[0]);
            break;
          case 'hset':
            await this.hset(command.key, command.args[0], command.args[1]);
            result = 1;
            break;
          case 'ttl':
            result = await this.ttl(command.key);
            break;
          default:
            throw new Error(`unsupported ${command.command}`);
        }
        results.push({ index, command: command.command, key: command.key, ok: true, result });
      } catch (e) {
        results.push({
          index,
          command: command.command,
          key: command.key,
          ok: false,
          error: e.message,
        });
      }
    }
    return results;
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

  test('Redis collection scan tools are registered', () => {
    assert.ok(server.tools.has('redis_hscan'));
    assert.ok(server.tools.has('redis_sscan'));
    assert.ok(server.tools.has('redis_zscan'));
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
    assert.equal(data.value_encoding, 'utf8');
    assert.equal(data.total_bytes, 6);
    assert.equal(data.truncated, false);
  });

  test('redis_get returns null for missing key', async () => {
    const tool = server.tools.get('redis_get');
    const result = await tool.handler({ key: 'app:missing' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.value, null);
  });

  test('redis_get returns REDIS_002 for keyPrefix rejection', async () => {
    mockDriver.getWindow = async () => {
      throw new Error('Redis key 必须以配置的前缀「app:」开头');
    };

    const tool = server.tools.get('redis_get');
    const result = await tool.handler({ key: 'other:test' });
    assert.equal(result.isError, true);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.error_info.code, 'REDIS_002');
    assert.match(data.error_info.hint, /keyPrefix/);
  });

  test('redis_get returns a resumable byte window', async () => {
    mockDriver.store.set('app:large', 'abcdefghij');
    const tool = server.tools.get('redis_get');
    const result = await tool.handler({ key: 'app:large', offset_bytes: 2, max_bytes: 4 });
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.value, 'cdef');
    assert.equal(data.total_bytes, 10);
    assert.equal(data.offset_bytes, 2);
    assert.equal(data.returned_bytes, 4);
    assert.equal(data.next_offset_bytes, 6);
    assert.equal(data.truncated, true);
  });

  test('redis_get preserves split UTF-8 bytes as base64', async () => {
    mockDriver.store.set('app:utf8', 'é');
    const tool = server.tools.get('redis_get');
    const first = JSON.parse(
      (await tool.handler({ key: 'app:utf8', offset_bytes: 0, max_bytes: 1 })).content[0].text,
    );
    const second = JSON.parse(
      (await tool.handler({ key: 'app:utf8', offset_bytes: 1, max_bytes: 1 })).content[0].text,
    );

    assert.equal(first.value, null);
    assert.equal(first.value_encoding, 'base64');
    assert.equal(second.value_encoding, 'base64');
    assert.equal(first.next_offset_bytes, 1);
    assert.equal(second.next_offset_bytes, null);
    assert.equal(
      Buffer.concat([
        Buffer.from(first.value_base64, 'base64'),
        Buffer.from(second.value_base64, 'base64'),
      ]).toString('utf8'),
      'é',
    );
  });

  test('redis_get tightens escaped output to the serialized response budget', async () => {
    const original = process.env.DB_MAX_RESPONSE_BYTES;
    process.env.DB_MAX_RESPONSE_BYTES = '4096';
    try {
      mockDriver.store.set('app:escaped', '\u0000'.repeat(10_000));
      const tool = server.tools.get('redis_get');
      const result = await tool.handler({ key: 'app:escaped' });
      const data = JSON.parse(result.content[0].text);

      assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 4096);
      assert.ok(data.returned_bytes > 0);
      assert.ok(data.returned_bytes < data.total_bytes);
      assert.equal(data.next_offset_bytes, data.returned_bytes);
      assert.equal(data.truncated, true);
    } finally {
      if (original === undefined) delete process.env.DB_MAX_RESPONSE_BYTES;
      else process.env.DB_MAX_RESPONSE_BYTES = original;
    }
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

  test('redis_set returns REDIS_004 for readonly rejection', async () => {
    mockDriver.set = async () => {
      throw new Error('该 Redis 连接为只读');
    };

    const tool = server.tools.get('redis_set');
    const result = await tool.handler({
      connection_id: 'rd_ro',
      key: 'app:test',
      value: 'value1',
    });
    assert.equal(result.isError, true);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.error_info.code, 'REDIS_004');
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
    assert.equal(data.scan_complete, true);
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

  test('redis_hscan returns structured hash entries', async () => {
    mockDriver.store.set('app:user:1', { name: 'John', age: '30' });
    const tool = server.tools.get('redis_hscan');
    const result = await tool.handler({
      key: 'app:user:1',
      cursor: '0',
      match: 'n*',
      count: 10,
    });
    const data = JSON.parse(result.content[0].text);
    assert.deepEqual(data.entries, [{ field: 'name', value: 'John' }]);
    assert.equal(data.next_cursor, '0');
    assert.equal(data.scan_complete, true);
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

  test('redis_pipeline tool is registered', () => {
    assert.ok(server.tools.has('redis_pipeline'));
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

  test('redis_sscan returns a resumable member batch', async () => {
    mockDriver.store.set('app:tags', new Set(['js', 'ts', 'py']));
    const tool = server.tools.get('redis_sscan');
    const result = await tool.handler({
      key: 'app:tags',
      cursor: '0',
      match: 't*',
      count: 10,
    });
    const data = JSON.parse(result.content[0].text);
    assert.deepEqual(data.members, ['ts']);
    assert.equal(data.scan_complete, true);
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

  test('redis_zscan returns structured member and score entries', async () => {
    mockDriver.store.set('app:scores', [
      { member: 'alice', score: 100 },
      { member: 'bob', score: 50 },
    ]);
    const tool = server.tools.get('redis_zscan');
    const result = await tool.handler({
      key: 'app:scores',
      cursor: '0',
      match: 'a*',
      count: 10,
    });
    const data = JSON.parse(result.content[0].text);
    assert.deepEqual(data.entries, [{ member: 'alice', score: '100' }]);
    assert.equal(data.scan_complete, true);
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

  test('redis_pipeline executes allowed command batch', async () => {
    const tool = server.tools.get('redis_pipeline');
    const result = await tool.handler({
      commands_json: JSON.stringify([
        { command: 'set', key: 'app:pipeline', args: ['v1', 60] },
        { command: 'get', key: 'app:pipeline' },
        { command: 'ttl', key: 'app:pipeline' },
      ]),
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'rd');
    assert.equal(data.ok, true);
    assert.equal(data.results.length, 3);
    assert.equal(data.results[1].result, 'v1');
    assert.equal(mockDriver.operations[0].op, 'pipeline');
  });

  test('redis_pipeline rejects blocked commands before driver execution', async () => {
    const tool = server.tools.get('redis_pipeline');
    const result = await tool.handler({
      commands_json: JSON.stringify([{ command: 'flushdb', key: 'app:any' }]),
    });
    assert.equal(result.isError, true);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.error_info.code, 'REDIS_003');
    assert.equal(mockDriver.operations.length, 0);
  });

  test('redis_pipeline rejects collection materialization commands', async () => {
    const tool = server.tools.get('redis_pipeline');
    const result = await tool.handler({
      commands_json: JSON.stringify([{ command: 'hgetall', key: 'app:hash' }]),
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /不支持命令 hgetall/);
    assert.equal(mockDriver.operations.length, 0);
  });

  test('redis_pipeline rejects oversized keys before driver execution', async () => {
    const tool = server.tools.get('redis_pipeline');
    const result = await tool.handler({
      commands_json: JSON.stringify([{ command: 'get', key: 'x'.repeat(4097) }]),
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /不能超过 4096 字节/);
    assert.equal(mockDriver.operations.length, 0);
  });

  test('redis_pipeline maps readonly rejection to REDIS_004', async () => {
    mockDriver.pipeline = async () => {
      throw new Error('该 Redis 连接为只读');
    };
    const tool = server.tools.get('redis_pipeline');
    const result = await tool.handler({
      connection_id: 'rd_ro',
      commands_json: JSON.stringify([{ command: 'set', key: 'app:pipeline', args: ['v1'] }]),
    });
    assert.equal(result.isError, true);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.error_info.code, 'REDIS_004');
  });
});
