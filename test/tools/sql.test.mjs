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

// Mock SqlDriver
class MockSqlDriver {
  constructor(engine = 'postgres') {
    this.engine = engine;
    this.executedSql = [];
  }
  async execute(sql, params, options) {
    this.executedSql.push({ sql, params, options });
    return {
      success: true,
      data: [{ id: 1, name: 'test' }],
      affectedRows: 1,
    };
  }
  async beginTransaction() {
    return {
      execute: async (sql, params, options) => {
        this.executedSql.push({ sql, params, options, inTransaction: true });
        return { success: true, affectedRows: 1 };
      },
      commit: async () => {},
      rollback: async () => {},
    };
  }
}

// Mock ConnectionRegistry
class MockRegistry {
  constructor() {
    this.handles = new Map();
    this.defaultId = 'pg';
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
  requireSql(id) {
    const h = this.require(id);
    if (h.kind !== 'sql') throw new Error(`连接「${id}」不是 SQL`);
    return h.driver;
  }
}

describe('SQL Tools', () => {
  let server;
  let registry;
  let mockDriver;

  beforeEach(async () => {
    server = new MockMcpServer();
    registry = new MockRegistry();
    mockDriver = new MockSqlDriver();

    registry.handles.set('pg', {
      id: 'pg',
      spec: { id: 'pg', engine: 'postgres', readonly: false },
      kind: 'sql',
      driver: mockDriver,
    });

    registry.handles.set('pg_ro', {
      id: 'pg_ro',
      spec: { id: 'pg_ro', engine: 'postgres', readonly: true },
      kind: 'sql',
      driver: mockDriver,
    });

    // 设置环境变量
    process.env.DB_QUERY_TIMEOUT = '30000';
    process.env.DB_MAX_ROWS = '100';
    process.env.DB_MAX_SQL_LENGTH = '102400';

    const { registerSqlTools } = await import('../../dist/tools/sql.js');
    registerSqlTools(server, registry);
  });

  test('sql_query tool is registered', () => {
    assert.ok(server.tools.has('sql_query'));
  });

  test('sql_execute tool is registered', () => {
    assert.ok(server.tools.has('sql_execute'));
  });

  test('sql_list_tables tool is registered', () => {
    assert.ok(server.tools.has('sql_list_tables'));
  });

  test('sql_describe_table tool is registered', () => {
    assert.ok(server.tools.has('sql_describe_table'));
  });

  test('sql_begin_transaction tool is registered', () => {
    assert.ok(server.tools.has('sql_begin_transaction'));
  });

  test('sql_execute_in_transaction tool is registered', () => {
    assert.ok(server.tools.has('sql_execute_in_transaction'));
  });

  test('sql_commit tool is registered', () => {
    assert.ok(server.tools.has('sql_commit'));
  });

  test('sql_rollback tool is registered', () => {
    assert.ok(server.tools.has('sql_rollback'));
  });

  test('sql_batch_execute tool is registered', () => {
    assert.ok(server.tools.has('sql_batch_execute'));
  });

  test('sql_explain tool is registered', () => {
    assert.ok(server.tools.has('sql_explain'));
  });

  test('sql_query executes readonly query', async () => {
    const tool = server.tools.get('sql_query');
    const result = await tool.handler({
      sql: 'SELECT * FROM users',
      params: [],
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'pg');
    assert.equal(data.engine, 'postgres');
    assert.ok(Array.isArray(data.data));
  });

  test('sql_query rejects write query', async () => {
    const tool = server.tools.get('sql_query');
    const result = await tool.handler({
      sql: 'INSERT INTO users (name) VALUES ($1)',
      params: ['test'],
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('只读'));
  });

  test('sql_query with specific connection', async () => {
    const tool = server.tools.get('sql_query');
    const result = await tool.handler({
      connection_id: 'pg',
      sql: 'SELECT * FROM users',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'pg');
  });

  test('sql_query returns error for unknown connection', async () => {
    const tool = server.tools.get('sql_query');
    const result = await tool.handler({
      connection_id: 'unknown',
      sql: 'SELECT * FROM users',
    });
    assert.equal(result.isError, true);
  });

  test('sql_execute executes write query', async () => {
    const tool = server.tools.get('sql_execute');
    const result = await tool.handler({
      sql: 'INSERT INTO users (name) VALUES ($1)',
      params: ['test'],
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'pg');
    assert.equal(data.affectedRows, 1);
  });

  test('sql_execute rejects on readonly connection', async () => {
    const tool = server.tools.get('sql_execute');
    const result = await tool.handler({
      connection_id: 'pg_ro',
      sql: 'INSERT INTO users (name) VALUES ($1)',
      params: ['test'],
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('只读'));
  });

  test('sql_list_tables returns table list', async () => {
    mockDriver.execute = async () => ({
      success: true,
      data: [{ name: 'users' }, { name: 'orders' }],
    });

    const tool = server.tools.get('sql_list_tables');
    const result = await tool.handler({});
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'pg');
    assert.deepEqual(data.tables, ['users', 'orders']);
  });

  test('sql_describe_table returns column info', async () => {
    mockDriver.execute = async () => ({
      success: true,
      data: [
        { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
        { column_name: 'name', data_type: 'character varying', is_nullable: 'YES' },
      ],
    });

    const tool = server.tools.get('sql_describe_table');
    const result = await tool.handler({ table: 'users' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'pg');
    assert.ok(Array.isArray(data.columns));
  });

  test('sql_explain returns execution plan', async () => {
    mockDriver.execute = async () => ({
      success: true,
      data: [{ 'QUERY PLAN': 'Seq Scan on users' }],
    });

    const tool = server.tools.get('sql_explain');
    const result = await tool.handler({
      sql: 'SELECT * FROM users WHERE id = 1',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'pg');
    assert.ok(Array.isArray(data.execution_plan));
  });

  test('sql_explain rejects write query', async () => {
    const tool = server.tools.get('sql_explain');
    const result = await tool.handler({
      sql: 'INSERT INTO users (name) VALUES ($1)',
    });
    assert.equal(result.isError, true);
  });

  test('sql_explain returns clear error for mssql without executing SHOWPLAN batch', async () => {
    const mssqlDriver = new MockSqlDriver('mssql');
    registry.handles.set('ms', {
      id: 'ms',
      spec: { id: 'ms', engine: 'mssql', readonly: false },
      kind: 'sql',
      driver: mssqlDriver,
    });

    const tool = server.tools.get('sql_explain');
    const result = await tool.handler({
      connection_id: 'ms',
      sql: 'SELECT * FROM users',
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /MSSQL EXPLAIN 暂不支持安全批处理/);
    assert.equal(mssqlDriver.executedSql.length, 0);
  });

  // ── v1.3.0 新增工具测试 ──────────────────────────────────

  test('sql_call_procedure tool is registered', () => {
    assert.ok(server.tools.has('sql_call_procedure'));
  });

  test('sql_list_views tool is registered', () => {
    assert.ok(server.tools.has('sql_list_views'));
  });

  test('sql_describe_view tool is registered', () => {
    assert.ok(server.tools.has('sql_describe_view'));
  });

  test('sql_list_indexes tool is registered', () => {
    assert.ok(server.tools.has('sql_list_indexes'));
  });

  test('sql_create_index tool is registered', () => {
    assert.ok(server.tools.has('sql_create_index'));
  });

  test('sql_call_procedure calls postgres procedure', async () => {
    mockDriver.execute = async (sql) => {
      assert.ok(sql.startsWith('CALL'));
      return { success: true, data: [{ result: 42 }] };
    };
    const tool = server.tools.get('sql_call_procedure');
    const result = await tool.handler({ procedure: 'my_proc', params: [1, 'test'] });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.procedure, 'my_proc');
  });

  test('sql_call_procedure rejects invalid procedure identifier', async () => {
    const tool = server.tools.get('sql_call_procedure');
    const result = await tool.handler({
      procedure: 'my_proc; DROP TABLE users',
      params: [],
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /procedure 不合法/);
    assert.equal(mockDriver.executedSql.length, 0);
  });

  test('sql_list_views returns views', async () => {
    mockDriver.execute = async () => ({
      success: true,
      data: [{ name: 'user_view' }, { name: 'order_view' }],
    });
    const tool = server.tools.get('sql_list_views');
    const result = await tool.handler({});
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.deepEqual(data.views, ['user_view', 'order_view']);
  });

  test('sql_describe_view returns columns', async () => {
    mockDriver.execute = async () => ({
      success: true,
      data: [{ column_name: 'id', data_type: 'integer' }],
    });
    const tool = server.tools.get('sql_describe_view');
    const result = await tool.handler({ view: 'user_view' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(data.columns));
  });

  test('sql_list_indexes returns indexes', async () => {
    mockDriver.execute = async () => ({
      success: true,
      data: [{ name: 'idx_users_email', definition: 'CREATE INDEX ...' }],
    });
    const tool = server.tools.get('sql_list_indexes');
    const result = await tool.handler({ table: 'users' });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(data.indexes));
  });

  test('sql_create_index rejects on readonly connection', async () => {
    const tool = server.tools.get('sql_create_index');
    const result = await tool.handler({
      connection_id: 'pg_ro',
      table: 'users',
      columns: ['email'],
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('只读'));
  });

  test('sql_create_index creates index on writable connection', async () => {
    mockDriver.execute = async (sql) => {
      assert.ok(sql.includes('CREATE'));
      return { success: true };
    };
    const tool = server.tools.get('sql_create_index');
    const result = await tool.handler({
      table: 'users',
      columns: ['email', 'name'],
      unique: true,
      indexName: 'idx_users_email_name',
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.ok, true);
  });

  test('sql_query supports pagination', async () => {
    mockDriver.execute = async () => ({
      success: true,
      data: [{ id: 1 }, { id: 2 }],
      totalRows: 50,
    });
    const tool = server.tools.get('sql_query');
    const result = await tool.handler({
      sql: 'SELECT * FROM users',
      page: 2,
      page_size: 10,
    });
    assert.ok(result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.pagination);
    assert.equal(data.pagination.page, 2);
    assert.equal(data.pagination.page_size, 10);
  });
});
