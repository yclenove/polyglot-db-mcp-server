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

  test('sql_export_query tool is registered', () => {
    assert.ok(server.tools.has('sql_export_query'));
  });

  test('sql_sample_table tool is registered', () => {
    assert.ok(server.tools.has('sql_sample_table'));
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

  test('sql_query applies request policy maskingMode to result rows', async () => {
    const { runWithRequestPolicy } = await import('../../dist/auth/request-policy.js');
    mockDriver.execute = async () => ({
      success: true,
      data: [{ email: 'analyst@example.com', name: 'Alice' }],
    });

    const tool = server.tools.get('sql_query');
    const result = await runWithRequestPolicy({ maskingMode: 'strict-v2' }, () =>
      tool.handler({
        sql: 'SELECT email, name FROM users',
        params: [],
      }),
    );

    const data = JSON.parse(result.content[0].text);
    assert.equal(data.data[0].email, 'a***@example.com');
    assert.equal(data.data[0].name, 'Alice');
  });

  test('sql_query rejects write query', async () => {
    const tool = server.tools.get('sql_query');
    const result = await tool.handler({
      sql: 'INSERT INTO users (name) VALUES ($1)',
      params: ['test'],
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('只读'));
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.error_info.code, 'SQL_002');
  });

  test('sql_export_query exports masked JSON rows', async () => {
    const { runWithRequestPolicy } = await import('../../dist/auth/request-policy.js');
    mockDriver.execute = async (_sql, _params, options) => {
      assert.equal(options.mode, 'readonly');
      assert.equal(options.maxRows, 2);
      return {
        success: true,
        data: [{ email: 'analyst@example.com', name: 'Alice' }],
        fields: [{ name: 'email' }, { name: 'name' }],
        totalRows: 1,
      };
    };

    const tool = server.tools.get('sql_export_query');
    const result = await runWithRequestPolicy({ maskingMode: 'strict-v2' }, () =>
      tool.handler({
        sql: 'SELECT email, name FROM users',
        format: 'json',
        limit: 2,
      }),
    );

    const data = JSON.parse(result.content[0].text);
    const rows = JSON.parse(data.content);
    assert.equal(data.format, 'json');
    assert.equal(data.content_type, 'application/json');
    assert.equal(rows[0].email, 'a***@example.com');
    assert.equal(rows[0].name, 'Alice');
  });

  test('sql_export_query supports CSV formatting', async () => {
    mockDriver.execute = async () => ({
      success: true,
      data: [{ id: 1, name: 'Alice, A' }],
      fields: [{ name: 'id' }, { name: 'name' }],
    });

    const tool = server.tools.get('sql_export_query');
    const result = await tool.handler({
      sql: 'SELECT id, name FROM users',
      format: 'csv',
    });

    const data = JSON.parse(result.content[0].text);
    assert.equal(data.format, 'csv');
    assert.equal(data.content_type, 'text/csv');
    assert.equal(data.content, 'id,name\n1,"Alice, A"');
  });

  test('sql_export_query rejects write SQL', async () => {
    const tool = server.tools.get('sql_export_query');
    const result = await tool.handler({
      sql: 'DELETE FROM users WHERE id = 1',
      format: 'json',
    });

    assert.equal(result.isError, true);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.error_info.code, 'SQL_002');
    assert.equal(mockDriver.executedSql.length, 0);
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

  test('sql_sample_table returns lightweight column profiles', async () => {
    mockDriver.execute = async (sql, _params, options) => {
      assert.equal(options.mode, 'readonly');
      assert.match(sql, /SELECT \* FROM "users" LIMIT 3/);
      return {
        success: true,
        data: [
          { id: 1, name: 'Alice', email: null },
          { id: 2, name: '', email: 'analyst@example.com' },
        ],
        fields: [{ name: 'id' }, { name: 'name' }, { name: 'email' }],
      };
    };

    const tool = server.tools.get('sql_sample_table');
    const result = await tool.handler({ table: 'users', sample_size: 3 });
    const data = JSON.parse(result.content[0].text);
    const idProfile = data.columns.find((col) => col.name === 'id');
    const nameProfile = data.columns.find((col) => col.name === 'name');
    const emailProfile = data.columns.find((col) => col.name === 'email');

    assert.equal(data.row_count, 2);
    assert.equal(idProfile.inferred_type, 'number');
    assert.equal(idProfile.numeric.min, 1);
    assert.equal(idProfile.numeric.max, 2);
    assert.equal(nameProfile.empty_string_count, 1);
    assert.equal(emailProfile.null_count, 1);
  });

  test('sql_sample_table rejects invalid table identifiers before execution', async () => {
    const tool = server.tools.get('sql_sample_table');
    const result = await tool.handler({ table: 'users;DROP', sample_size: 3 });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /table 不合法/);
    assert.equal(mockDriver.executedSql.length, 0);
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
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.error_info.code, 'SQL_002');
    assert.match(data.error_info.hint, /readonly:false/);
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

  test('sql_call_procedure binds MySQL procedure parameters', async () => {
    mockDriver.engine = 'mysql';
    mockDriver.execute = async (sql, params) => {
      assert.equal(sql, 'CALL `my_proc`(?, ?)');
      assert.deepEqual(params, [1, 'test']);
      return { success: true, data: [{ result: 42 }] };
    };
    const tool = server.tools.get('sql_call_procedure');
    const result = await tool.handler({ procedure: 'my_proc', params: [1, 'test'] });
    assert.equal(result.isError, undefined);
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

  test('sql_query uses Oracle OFFSET FETCH pagination', async () => {
    mockDriver.engine = 'oracle';
    mockDriver.execute = async (sql) => {
      assert.equal(
        sql,
        'SELECT * FROM users ORDER BY id OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY',
      );
      return { success: true, data: [{ id: 11 }], totalRows: 1 };
    };
    const tool = server.tools.get('sql_query');
    const result = await tool.handler({
      sql: 'SELECT * FROM users ORDER BY id',
      page: 2,
      page_size: 10,
    });
    assert.equal(result.isError, undefined);
  });
});
