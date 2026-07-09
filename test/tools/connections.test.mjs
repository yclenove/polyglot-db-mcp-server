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

// Mock ConnectionRegistry
class MockRegistry {
  constructor(specs = [], defaultId = 'test') {
    this.specs = specs;
    this.defaultId = defaultId;
    this.handles = new Map();
  }
  listMeta() {
    return this.specs.map(s => ({ id: s.id, engine: s.engine, readonly: s.readonly === true }));
  }
  resolveConnectionId(id) {
    if (!id || id.trim() === '') return this.defaultId;
    if (!this.handles.has(id)) throw new Error(`未知 connection_id: ${id}`);
    return id;
  }
  getDefaultId() {
    return this.defaultId;
  }
  getSpecs() {
    return this.specs;
  }
  require(id) {
    const h = this.handles.get(id);
    if (!h) throw new Error(`未知 connection_id: ${id}`);
    return h;
  }
  requireSql(id) {
    const h = this.require(id);
    if (h.kind !== 'sql') throw new Error(`连接「${id}」不是 SQL`);
    return h.driver;
  }
  requireMongo(id) {
    const h = this.require(id);
    if (h.kind !== 'mongo') throw new Error(`连接「${id}」不是 MongoDB`);
    return h.driver;
  }
  requireRedis(id) {
    const h = this.require(id);
    if (h.kind !== 'redis') throw new Error(`连接「${id}」不是 Redis`);
    return h.driver;
  }
}

describe('Connection Tools', () => {
  let server;
  let registry;
  let registerConnectionTools;

  beforeEach(async () => {
    server = new MockMcpServer();
    registry = new MockRegistry([
      { id: 'pg', engine: 'postgres', readonly: false },
      { id: 'my', engine: 'mysql', readonly: true },
      { id: 'rd', engine: 'redis', readonly: false },
    ], 'pg');

    // 注册工具
    const mod = await import('../../dist/tools/connections.js');
    registerConnectionTools = mod.registerConnectionTools;
    registerConnectionTools(server, registry);
  });

  test('list_connections tool is registered', () => {
    assert.ok(server.tools.has('list_connections'));
  });

  test('test_connection tool is registered', () => {
    assert.ok(server.tools.has('test_connection'));
  });

  test('health_check tool is registered', () => {
    assert.ok(server.tools.has('health_check'));
  });

  test('connection_stats tool is registered', () => {
    assert.ok(server.tools.has('connection_stats'));
  });

  test('list_connections returns connection metadata', async () => {
    const tool = server.tools.get('list_connections');
    const result = await tool.handler({});
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connections.length, 3);
    assert.equal(data.connections[0].id, 'pg');
    assert.equal(data.connections[0].engine, 'postgres');
    assert.equal(data.connections[0].readonly, false);
  });

  test('test_connection with default connection', async () => {
    // 添加 mock handle
    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres' },
      kind: 'sql',
      driver: { ping: async () => ({ ok: true }) },
    });

    const tool = server.tools.get('test_connection');
    const result = await tool.handler({});
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'pg');
    assert.equal(data.ok, true);
  });

  test('test_connection with specific connection', async () => {
    registry.handles.set('my', {
      id: 'my',
      spec: { id: 'my', engine: 'mysql' },
      kind: 'sql',
      driver: { ping: async () => ({ ok: true }) },
    });

    const tool = server.tools.get('test_connection');
    const result = await tool.handler({ connection_id: 'my' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'my');
  });

  test('test_connection returns error for unknown connection', async () => {
    const tool = server.tools.get('test_connection');
    const result = await tool.handler({ connection_id: 'unknown' });
    assert.equal(result.isError, true);
  });

  test('health_check returns healthy status', async () => {
    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false },
      kind: 'sql',
      driver: { ping: async () => ({ ok: true }) },
    });
    registry.handles.set('my', {
      id: 'my',
      spec: { id: 'my', engine: 'mysql', readonly: true },
      kind: 'sql',
      driver: { ping: async () => ({ ok: true }) },
    });
    registry.handles.set('rd', {
      id: 'rd',
      spec: { id: 'rd', engine: 'redis', readonly: false },
      kind: 'redis',
      driver: { ping: async () => ({ ok: true }) },
    });

    const tool = server.tools.get('health_check');
    const result = await tool.handler({});
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.status, 'healthy');
    assert.equal(data.connections.length, 3);
  });

  test('health_check returns degraded when one connection fails', async () => {
    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false },
      kind: 'sql',
      driver: { ping: async () => ({ ok: true }) },
    });
    registry.handles.set('my', {
      id: 'my',
      spec: { id: 'my', engine: 'mysql', readonly: true },
      kind: 'sql',
      driver: { ping: async () => ({ ok: false, error: 'Connection refused' }) },
    });
    registry.handles.set('rd', {
      id: 'rd',
      spec: { id: 'rd', engine: 'redis', readonly: false },
      kind: 'redis',
      driver: { ping: async () => ({ ok: true }) },
    });

    const tool = server.tools.get('health_check');
    const result = await tool.handler({});
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.status, 'degraded');
    assert.equal(result.isError, true);
  });

  // ── v1.3.0 新增工具测试 ──────────────────────────────────

  test('server_info tool is registered', () => {
    assert.ok(server.tools.has('server_info'));
  });

  test('server_info returns version and connection info', async () => {
    const tool = server.tools.get('server_info');
    const result = await tool.handler({});
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.name, 'polyglot-db-mcp-server');
    assert.ok(data.version);
    assert.ok(data.uptime);
    assert.ok(data.uptime.formatted);
    assert.equal(data.connections.total, 3);
    assert.ok(data.connections.byEngine);
  });

  // ── connection_diagnose 工具测试 ──────────────────────────

  test('connection_diagnose tool is registered', () => {
    assert.ok(server.tools.has('connection_diagnose'));
  });

  test('connection_diagnose diagnoses all connections - all healthy', async () => {
    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false, database: 'testdb', host: 'localhost' },
      kind: 'sql',
      driver: {
        ping: async () => ({ ok: true }),
        execute: async () => ({ success: true, data: [{ version: 'PostgreSQL 15.3' }] }),
      },
    });
    registry.handles.set('my', {
      id: 'my',
      spec: { id: 'my', engine: 'mysql', readonly: true, database: 'mydb', host: 'localhost' },
      kind: 'sql',
      driver: {
        ping: async () => ({ ok: true }),
        execute: async () => ({ success: true, data: [{ 'VERSION()': '8.0.33' }] }),
      },
    });
    registry.handles.set('rd', {
      id: 'rd',
      spec: { id: 'rd', engine: 'redis', readonly: false, url: 'redis://localhost:6379' },
      kind: 'redis',
      driver: { ping: async () => ({ ok: true }) },
    });

    const tool = server.tools.get('connection_diagnose');
    const result = await tool.handler({});
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.summary.total, 3);
    assert.equal(data.summary.healthy, 3);
    assert.equal(data.summary.unhealthy, 0);
    assert.equal(data.connections.length, 3);
    assert.equal(result.isError, false);
  });

  test('connection_diagnose detects unhealthy connections', async () => {
    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false, database: 'testdb', host: 'localhost' },
      kind: 'sql',
      driver: {
        ping: async () => ({ ok: true }),
        execute: async () => ({ success: true, data: [{ version: 'PostgreSQL 15.3' }] }),
      },
    });
    registry.handles.set('my', {
      id: 'my',
      spec: { id: 'my', engine: 'mysql', readonly: true, host: 'localhost' },
      kind: 'sql',
      driver: {
        ping: async () => ({ ok: false, error: 'Connection refused' }),
      },
    });
    registry.handles.set('rd', {
      id: 'rd',
      spec: { id: 'rd', engine: 'redis', readonly: false, url: 'redis://localhost:6379' },
      kind: 'redis',
      driver: { ping: async () => ({ ok: true }) },
    });

    const tool = server.tools.get('connection_diagnose');
    const result = await tool.handler({});
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.summary.total, 3);
    assert.equal(data.summary.healthy, 2);
    assert.equal(data.summary.unhealthy, 1);
    assert.equal(result.isError, true);

    const myResult = data.connections.find((c) => c.id === 'my');
    assert.equal(myResult.status, 'error');
    assert.equal(myResult.error, 'Connection refused');
    assert.equal(myResult.error_info.code, 'CONN_001');
    assert.ok(myResult.suggestions.some((s) => /host\/port|端口映射/.test(s)));
  });

  test('connection_diagnose diagnoses a specific connection', async () => {
    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false, database: 'testdb', host: 'localhost' },
      kind: 'sql',
      driver: {
        ping: async () => ({ ok: true }),
        execute: async () => ({ success: true, data: [{ version: 'PostgreSQL 15.3' }] }),
      },
    });
    registry.handles.set('my', {
      id: 'my',
      spec: { id: 'my', engine: 'mysql', readonly: true, host: 'localhost' },
      kind: 'sql',
      driver: { ping: async () => ({ ok: true }) },
    });
    registry.handles.set('rd', {
      id: 'rd',
      spec: { id: 'rd', engine: 'redis', readonly: false, url: 'redis://localhost:6379' },
      kind: 'redis',
      driver: { ping: async () => ({ ok: true }) },
    });

    const tool = server.tools.get('connection_diagnose');
    const result = await tool.handler({ connection_id: 'pg' });
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.summary.total, 1);
    assert.equal(data.connections[0].id, 'pg');
    assert.equal(data.connections[0].status, 'ok');
  });

  test('connection_diagnose returns error for unknown connection', async () => {
    const tool = server.tools.get('connection_diagnose');
    const result = await tool.handler({ connection_id: 'nonexistent' });
    assert.equal(result.isError, true);
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.error);
    assert.equal(data.error_info.code, 'CONN_006');
    assert.deepEqual(data.error_info.details.available_connections, ['pg', 'my', 'rd']);
  });

  test('connection_diagnose returns version for SQL engines', async () => {
    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false, database: 'testdb', host: 'localhost' },
      kind: 'sql',
      driver: {
        engine: 'postgres',
        ping: async () => ({ ok: true }),
        execute: async () => ({ success: true, data: [{ version: 'PostgreSQL 15.3 on x86_64' }] }),
      },
    });

    const tool = server.tools.get('connection_diagnose');
    const result = await tool.handler({ connection_id: 'pg' });
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connections[0].server_version, 'PostgreSQL 15.3 on x86_64');
  });

  test('connection_diagnose includes suggestions for misconfigured connections', async () => {
    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false },
      kind: 'sql',
      driver: {
        ping: async () => ({ ok: true }),
        execute: async () => ({ success: false, error: 'no version' }),
      },
    });

    const tool = server.tools.get('connection_diagnose');
    const result = await tool.handler({ connection_id: 'pg' });
    const data = JSON.parse(result.content[0].text);
    const pgResult = data.connections[0];
    assert.ok(pgResult.suggestions.length > 0);
    // 应该建议设置 database 字段
    assert.ok(pgResult.suggestions.some((s) => s.includes('database')));
  });

  test('connection_diagnose includes SQLite path hints', async () => {
    const sqliteServer = new MockMcpServer();
    const sqliteRegistry = new MockRegistry([
      { id: 'local', engine: 'sqlite', readonly: false, url: 'file:./data/local.db' },
    ], 'local');
    sqliteRegistry.handles.set('local', {
      id: 'local',
      spec: { id: 'local', engine: 'sqlite', readonly: false, url: 'file:./data/local.db' },
      kind: 'sql',
      driver: {
        engine: 'sqlite',
        ping: async () => ({ ok: true }),
        execute: async () => ({ success: true, data: [{ version: '3.45.0' }] }),
      },
    });
    registerConnectionTools(sqliteServer, sqliteRegistry);

    const tool = sqliteServer.tools.get('connection_diagnose');
    const result = await tool.handler({ connection_id: 'local' });
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connections[0].status, 'ok');
    assert.ok(data.connections[0].suggestions.some((s) => s.includes('SQLite 文件路径')));
  });

  test('connection_diagnose includes DuckDB memory and allowlist hints', async () => {
    const duckServer = new MockMcpServer();
    const duckRegistry = new MockRegistry([
      { id: 'duck', engine: 'duckdb', readonly: true, url: ':memory:' },
    ], 'duck');
    duckRegistry.handles.set('duck', {
      id: 'duck',
      spec: { id: 'duck', engine: 'duckdb', readonly: true, url: ':memory:' },
      kind: 'sql',
      driver: {
        engine: 'duckdb',
        ping: async () => ({ ok: true }),
        execute: async () => ({ success: true, data: [{ version: 'v1.5.4' }] }),
      },
    });
    registerConnectionTools(duckServer, duckRegistry);

    const tool = duckServer.tools.get('connection_diagnose');
    const result = await tool.handler({ connection_id: 'duck' });
    const data = JSON.parse(result.content[0].text);
    const suggestions = data.connections[0].suggestions;
    assert.equal(data.connections[0].status, 'ok');
    assert.ok(suggestions.some((s) => s.includes('DuckDB 当前使用 :memory:')));
    assert.ok(suggestions.some((s) => s.includes('allowlist')));
    assert.equal(suggestions.some((s) => s.includes('缺少 url 和 host')), false);
  });

  test('connection_diagnose handles ping throwing exception', async () => {
    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false, database: 'testdb', host: 'localhost' },
      kind: 'sql',
      driver: {
        ping: async () => { throw new Error('Network unreachable'); },
      },
    });

    const tool = server.tools.get('connection_diagnose');
    const result = await tool.handler({ connection_id: 'pg' });
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connections[0].status, 'error');
    assert.equal(data.connections[0].error, 'Network unreachable');
    assert.equal(data.summary.unhealthy, 1);
  });

  test('connection_diagnose handles MongoDB connection', async () => {
    // Create a fresh registry with a MongoDB connection
    const mongoServer = new MockMcpServer();
    const mongoRegistry = new MockRegistry([
      { id: 'mg', engine: 'mongodb', readonly: false, url: 'mongodb://localhost:27017', database: 'testdb' },
      { id: 'pg', engine: 'postgres', readonly: false, database: 'testdb', host: 'localhost' },
    ], 'mg');
    mongoRegistry.handles.set('mg', {
      id: 'mg',
      spec: { id: 'mg', engine: 'mongodb', readonly: false, url: 'mongodb://localhost:27017', database: 'testdb' },
      kind: 'mongo',
      driver: { ping: async () => ({ ok: true }) },
    });
    mongoRegistry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false, database: 'testdb', host: 'localhost' },
      kind: 'sql',
      driver: {
        engine: 'postgres',
        ping: async () => ({ ok: true }),
        execute: async () => ({ success: true, data: [{ version: '15.3' }] }),
      },
    });
    registerConnectionTools(mongoServer, mongoRegistry);

    const tool = mongoServer.tools.get('connection_diagnose');
    const result = await tool.handler({});
    const data = JSON.parse(result.content[0].text);
    const mongoResult = data.connections.find((c) => c.id === 'mg');
    assert.equal(mongoResult.status, 'ok');
    assert.equal(mongoResult.engine, 'mongodb');
  });

  test('connection_diagnose includes latency_ms in results', async () => {
    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false, database: 'testdb', host: 'localhost' },
      kind: 'sql',
      driver: {
        ping: async () => ({ ok: true }),
        execute: async () => ({ success: true, data: [{ version: '15.3' }] }),
      },
    });

    const tool = server.tools.get('connection_diagnose');
    const result = await tool.handler({ connection_id: 'pg' });
    const data = JSON.parse(result.content[0].text);
    assert.ok(typeof data.connections[0].latency_ms === 'number');
    assert.ok(data.connections[0].latency_ms >= 0);
  });
});
