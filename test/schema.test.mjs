import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

async function invokeSchemaExport(engine, rows, args = {}) {
  const driver = {
    engine,
    queries: [],
    async execute(sql, params, options) {
      this.queries.push({ sql, params, options });
      return { success: true, data: rows };
    },
  };
  const server = {
    tools: new Map(),
    registerTool(name, schema, handler) {
      this.tools.set(name, { schema, handler });
    },
  };
  const registry = {
    resolveConnectionId() {
      return 'source';
    },
    requireSql() {
      return driver;
    },
  };
  const { registerSchemaTools } = await import('../dist/tools/schema.js');
  registerSchemaTools(server, registry);
  const result = await server.tools.get('schema_export').handler({
    connection_id: 'source',
    ...args,
  });
  return { driver, result };
}

describe('Schema SQL generation', () => {
  test('MySQL uses full column types and excludes views', async () => {
    const { driver } = await invokeSchemaExport('mysql', []);
    assert.match(driver.queries[0].sql, /c\.COLUMN_TYPE as data_type/);
    assert.match(driver.queries[0].sql, /t\.TABLE_TYPE = 'BASE TABLE'/);
  });

  test('PostgreSQL preserves modifiers and scopes primary keys to the schema', async () => {
    const { driver } = await invokeSchemaExport('postgres', [], { schema: 'analytics' });
    assert.match(driver.queries[0].sql, /pg_catalog\.format_type/);
    assert.match(driver.queries[0].sql, /tc\.constraint_schema = ku\.constraint_schema/);
    assert.match(driver.queries[0].sql, /t\.table_type = 'BASE TABLE'/);
    assert.deepEqual(driver.queries[0].params, ['analytics']);
  });

  test('MSSQL reconstructs length, precision, and temporal modifiers', async () => {
    const { driver } = await invokeSchemaExport('mssql', []);
    assert.match(driver.queries[0].sql, /CHARACTER_MAXIMUM_LENGTH/);
    assert.match(driver.queries[0].sql, /NUMERIC_PRECISION/);
    assert.match(driver.queries[0].sql, /DATETIME_PRECISION/);
    assert.match(driver.queries[0].sql, /t\.TABLE_TYPE = 'BASE TABLE'/);
    assert.deepEqual(driver.queries[0].params, ['dbo']);
  });

  test('Oracle reconstructs character and numeric modifiers and excludes views', async () => {
    const { driver } = await invokeSchemaExport('oracle', []);
    assert.match(driver.queries[0].sql, /c\.char_length/);
    assert.match(driver.queries[0].sql, /c\.data_precision/);
    assert.match(driver.queries[0].sql, /JOIN user_tables/);
  });

  test('DuckDB scopes metadata to main or the requested schema', async () => {
    const defaultSchema = await invokeSchemaExport('duckdb', []);
    const customSchema = await invokeSchemaExport('duckdb', [], { schema: 'analytics' });

    assert.match(defaultSchema.driver.queries[0].sql, /c\.table_schema = \?/);
    assert.deepEqual(defaultSchema.driver.queries[0].params, ['main']);
    assert.deepEqual(customSchema.driver.queries[0].params, ['analytics']);
  });
});

describe('DDL generation', () => {
  test('MySQL DDL preserves full types, defaults, extras, and quoted identifiers', async () => {
    const { result } = await invokeSchemaExport(
      'mysql',
      [
        {
          table_name: 'order',
          column_name: 'id',
          data_type: 'int unsigned',
          is_nullable: 'NO',
          column_key: 'PRI',
          extra: 'auto_increment',
        },
        {
          table_name: 'order',
          column_name: 'select',
          data_type: 'varchar(80)',
          is_nullable: 'NO',
          column_key: '',
          column_default: "'guest'",
        },
      ],
      { format: 'sql' },
    );
    const ddl = result.content[0].text;
    assert.match(ddl, /CREATE TABLE `order`/);
    assert.match(ddl, /`id` int unsigned NOT NULL AUTO_INCREMENT/);
    assert.match(ddl, /`select` varchar\(80\) DEFAULT 'guest' NOT NULL/);
    assert.match(ddl, /PRIMARY KEY \(`id`\)/);
  });

  test('Oracle DDL preserves type modifiers and quotes composite keys', async () => {
    const { result } = await invokeSchemaExport(
      'oracle',
      [
        {
          TABLE_NAME: 'USER_ROLE',
          COLUMN_NAME: 'USER_ID',
          DATA_TYPE: 'NUMBER(19,0)',
          IS_NULLABLE: 'N',
          COLUMN_KEY: 'YES',
        },
        {
          TABLE_NAME: 'USER_ROLE',
          COLUMN_NAME: 'ROLE_ID',
          DATA_TYPE: 'NUMBER(19,0)',
          IS_NULLABLE: 'N',
          COLUMN_KEY: 'YES',
        },
        {
          TABLE_NAME: 'USER_ROLE',
          COLUMN_NAME: 'LABEL',
          DATA_TYPE: 'VARCHAR2(80 CHAR)',
          IS_NULLABLE: 'Y',
          COLUMN_KEY: 'NO',
          COLUMN_DEFAULT: "'member'",
        },
      ],
      { format: 'sql' },
    );
    const ddl = result.content[0].text;
    assert.match(ddl, /CREATE TABLE "USER_ROLE"/);
    assert.match(ddl, /"LABEL" VARCHAR2\(80 CHAR\) DEFAULT 'member'/);
    assert.match(ddl, /PRIMARY KEY \("USER_ID", "ROLE_ID"\)/);
  });
});

class MockMcpServer {
  constructor() {
    this.tools = new Map();
  }

  registerTool(name, schema, handler) {
    this.tools.set(name, { schema, handler });
  }
}

class MockSchemaDriver {
  constructor(engine, rows) {
    this.engine = engine;
    this.rows = rows;
    this.queries = [];
  }

  async execute(sql, params, options) {
    this.queries.push({ sql, params, options });
    return { success: true, data: this.rows };
  }
}

class MockSchemaRegistry {
  constructor() {
    this.defaultId = 'source';
    this.drivers = new Map();
  }

  resolveConnectionId(id) {
    if (!id || id.trim() === '') return this.defaultId;
    if (!this.drivers.has(id)) throw new Error(`未知 connection_id: ${id}`);
    return id;
  }

  requireSql(id) {
    const driver = this.drivers.get(id);
    if (!driver) throw new Error(`未知 connection_id: ${id}`);
    return driver;
  }
}

describe('Schema tools integration', () => {
  test('schema_export passes PostgreSQL schema parameter and returns table counts', async () => {
    const server = new MockMcpServer();
    const registry = new MockSchemaRegistry();
    const driver = new MockSchemaDriver('postgres', [
      {
        table_name: 'users',
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        column_key: 'YES',
      },
    ]);
    registry.drivers.set('source', driver);

    const { registerSchemaTools } = await import('../dist/tools/schema.js');
    registerSchemaTools(server, registry);

    const result = await server.tools.get('schema_export').handler({
      connection_id: 'source',
      schema: 'analytics',
    });
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.connection_id, 'source');
    assert.equal(data.engine, 'postgres');
    assert.equal(data.schema, 'analytics');
    assert.equal(data.table_count, 1);
    assert.deepEqual(driver.queries[0].params, ['analytics']);
  });

  test('schema_export normalizes Oracle metadata keys and preserves nullability and primary keys', async () => {
    const server = new MockMcpServer();
    const registry = new MockSchemaRegistry();
    const driver = new MockSchemaDriver('oracle', [
      {
        TABLE_NAME: 'USERS',
        COLUMN_NAME: 'ID',
        DATA_TYPE: 'NUMBER',
        IS_NULLABLE: 'N',
        COLUMN_KEY: 'YES',
        COLUMN_DEFAULT: null,
      },
      {
        TABLE_NAME: 'USERS',
        COLUMN_NAME: 'NAME',
        DATA_TYPE: 'VARCHAR2(80 CHAR)',
        IS_NULLABLE: 'Y',
        COLUMN_KEY: 'NO',
        COLUMN_DEFAULT: "'anonymous'",
      },
    ]);
    registry.drivers.set('source', driver);

    const { registerSchemaTools } = await import('../dist/tools/schema.js');
    registerSchemaTools(server, registry);

    const jsonResult = await server.tools.get('schema_export').handler({
      connection_id: 'source',
      format: 'json',
    });
    const data = JSON.parse(jsonResult.content[0].text);
    assert.equal(data.table_count, 1);
    assert.equal(data.tables[0].name, 'USERS');
    assert.equal(data.tables[0].columns[0].primaryKey, true);
    assert.equal(data.tables[0].columns[0].nullable, false);
    assert.equal(data.tables[0].columns[1].nullable, true);
    assert.match(driver.queries[0].sql, /user_constraints/);

    const ddlResult = await server.tools.get('schema_export').handler({
      connection_id: 'source',
      format: 'sql',
    });
    assert.match(ddlResult.content[0].text, /CREATE TABLE "USERS"/);
    assert.match(ddlResult.content[0].text, /"NAME" VARCHAR2\(80 CHAR\) DEFAULT 'anonymous'/);
    assert.match(ddlResult.content[0].text, /PRIMARY KEY \("ID"\)/);
  });

  test('schema_diff reports table and column differences', async () => {
    const server = new MockMcpServer();
    const registry = new MockSchemaRegistry();
    registry.drivers.set(
      'source',
      new MockSchemaDriver('sqlite', [
        {
          table_name: 'users',
          column_name: 'id',
          data_type: 'integer',
          is_nullable: 'NO',
          column_key: 'YES',
        },
        {
          table_name: 'users',
          column_name: 'name',
          data_type: 'text',
          is_nullable: 'YES',
          column_key: '',
        },
        {
          table_name: 'legacy',
          column_name: 'id',
          data_type: 'integer',
          is_nullable: 'NO',
          column_key: 'YES',
        },
      ]),
    );
    registry.drivers.set(
      'target',
      new MockSchemaDriver('sqlite', [
        {
          table_name: 'users',
          column_name: 'id',
          data_type: 'bigint',
          is_nullable: 'NO',
          column_key: 'YES',
        },
        {
          table_name: 'users',
          column_name: 'email',
          data_type: 'text',
          is_nullable: 'NO',
          column_key: '',
        },
        {
          table_name: 'orders',
          column_name: 'id',
          data_type: 'integer',
          is_nullable: 'NO',
          column_key: 'YES',
        },
      ]),
    );

    const { registerSchemaTools } = await import('../dist/tools/schema.js');
    registerSchemaTools(server, registry);

    const result = await server.tools.get('schema_diff').handler({
      source_connection_id: 'source',
      target_connection_id: 'target',
    });
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.summary.added_tables, 1);
    assert.equal(data.summary.removed_tables, 1);
    assert.equal(data.summary.changed_tables, 1);
    assert.equal(data.diff.added_tables[0].name, 'orders');
    assert.equal(data.diff.removed_tables[0].name, 'legacy');
    assert.equal(data.diff.changed_tables[0].table, 'users');
    assert.equal(data.diff.changed_tables[0].added_columns[0].name, 'email');
    assert.equal(data.diff.changed_tables[0].removed_columns[0].name, 'name');
    assert.deepEqual(data.diff.changed_tables[0].changed_columns[0].changes, ['type']);
  });
});
