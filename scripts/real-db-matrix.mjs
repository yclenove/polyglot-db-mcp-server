import assert from 'node:assert/strict';

import { createRegistryFromEnv, closeAll, pingAll } from '../dist/bootstrap.js';
import { registerAdvisorTools } from '../dist/tools/advisor.js';
import { registerConnectionTools } from '../dist/tools/connections.js';
import { registerMongoTools } from '../dist/tools/mongo.js';
import { registerRedisTools } from '../dist/tools/redis.js';
import { registerSchemaTools } from '../dist/tools/schema.js';
import { registerSqlTools } from '../dist/tools/sql.js';
import { installResponseBudget } from '../dist/core/response-budget.js';

const SQL_ENGINES = ['mysql', 'postgres', 'mssql', 'oracle', 'sqlite', 'duckdb'];
const REQUIRED_ENGINES = [...SQL_ENGINES, 'mongodb', 'redis'];
const LARGE_INTEGER = '9007199254740993';
const RW = { mode: 'readwrite', maxRows: 100, queryTimeoutMs: 30_000, maxSqlLength: 100_000 };
const RO = { ...RW, mode: 'readonly' };

class ToolCollector {
  tools = new Map();
  called = new Set();

  registerTool(name, schema, handler) {
    this.tools.set(name, { schema, handler });
  }
}

function resultText(result) {
  return result?.content?.map((item) => item.text ?? '').join('\n') ?? '';
}

function parseResult(result) {
  const text = resultText(result);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function containsIdentifier(value, expected) {
  const needle = expected.toLowerCase();
  if (Array.isArray(value)) return value.some((item) => containsIdentifier(item, expected));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => containsIdentifier(item, expected));
  }
  return typeof value === 'string' && value.toLowerCase() === needle;
}

function indexMetadataContainsColumn(indexes, expected) {
  if (containsIdentifier(indexes, expected)) return true;
  const token = new RegExp(`(?:^|[^A-Za-z0-9_])${expected}(?:$|[^A-Za-z0-9_])`, 'i');
  return indexes.some((row) => {
    if (!row || typeof row !== 'object') return false;
    return ['column_name', 'expressions', 'definition', 'indexdef', 'sql'].some((field) => {
      const value = row[field] ?? row[field.toUpperCase()];
      return typeof value === 'string' && token.test(value);
    });
  });
}

function quoteSqlIdentifier(engine, identifier) {
  if (engine === 'mysql') return `\`${identifier.replaceAll('`', '``')}\``;
  if (engine === 'mssql') return `[${identifier.replaceAll(']', ']]')}]`;
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function callTool(server, name, args = {}, options = {}) {
  const tool = server.tools.get(name);
  assert.ok(tool, `tool not registered: ${name}`);
  const result = await tool.handler(args);
  server.called.add(name);
  if (!options.allowError) {
    assert.notEqual(result?.isError, true, `${name} failed: ${resultText(result)}`);
  }
  return { result, value: parseResult(result) };
}

function connectionIdsByEngine(registry) {
  const ids = new Map();
  for (const spec of registry.getSpecs()) {
    if (!ids.has(spec.engine)) ids.set(spec.engine, spec.id);
  }
  for (const engine of REQUIRED_ENGINES) {
    assert.ok(ids.has(engine), `DB_MCP_CONNECTIONS missing required engine: ${engine}`);
  }
  return ids;
}

async function verifyPostgresRoleDiagnostics(registry, connectionId) {
  const server = new ToolCollector();
  installResponseBudget(server);
  registerConnectionTools(server, registry);

  const diagnosed = await callTool(server, 'connection_diagnose', {
    connection_id: connectionId,
  });
  const role = diagnosed.value.connections?.[0]?.security?.postgres_role;
  assert.equal(role?.status, 'checked', 'PostgreSQL role security diagnostics were unavailable');
  assert.ok(role.current_user, 'PostgreSQL role diagnostics returned no current_user');
  assert.equal(typeof role.is_superuser, 'boolean');
  assert.ok(Array.isArray(role.server_file_roles));
  assert.match(role.server_file_access_risk, /^(?:high|low)$/);
}

function sqlDialect(engine, table, view, procedure) {
  const idType = engine === 'oracle' ? 'NUMBER' : 'INTEGER';
  const nameType = engine === 'oracle' ? 'VARCHAR2(80)' : 'VARCHAR(80)';
  const placeholders = engine === 'postgres' ? ['$1', '$2', '$3'] : ['?', '?', '?'];
  const selectPlaceholder = engine === 'postgres' ? '$1' : '?';
  const procedureDdl = {
    mysql: `CREATE PROCEDURE ${procedure}(IN x INTEGER) SELECT x AS value`,
    postgres: `CREATE PROCEDURE ${procedure}(IN x INTEGER) LANGUAGE SQL AS 'SELECT 1'`,
    mssql: `CREATE PROCEDURE ${procedure} @p0 INTEGER AS SELECT @p0 AS value`,
    oracle: null,
    sqlite: null,
    duckdb: null,
  }[engine];
  const largeIntegerQuery = {
    mysql: `SELECT CAST('${LARGE_INTEGER}' AS UNSIGNED) AS big_value`,
    postgres: `SELECT ${LARGE_INTEGER}::BIGINT AS big_value`,
    mssql: `SELECT CAST('${LARGE_INTEGER}' AS BIGINT) AS big_value`,
    oracle: `SELECT CAST(${LARGE_INTEGER} AS NUMBER(19, 0)) AS big_value FROM DUAL`,
    sqlite: `SELECT CAST('${LARGE_INTEGER}' AS INTEGER) AS big_value`,
    duckdb: `SELECT ${LARGE_INTEGER}::BIGINT AS big_value`,
  }[engine];
  const boundedReadQuery = {
    mysql: `WITH RECURSIVE seq(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1000
    ) SELECT n FROM seq ORDER BY n`,
    postgres: 'SELECT value FROM generate_series(1, 100000) AS value ORDER BY value',
    mssql: `WITH seq(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 100000
    ) SELECT n FROM seq ORDER BY n OPTION (MAXRECURSION 0)`,
    oracle: 'SELECT LEVEL AS n FROM dual CONNECT BY LEVEL <= 100000',
    sqlite: `WITH RECURSIVE seq(n) AS (
      VALUES (1) UNION ALL SELECT n + 1 FROM seq WHERE n < 100000
    ) SELECT n FROM seq ORDER BY n`,
    duckdb: 'SELECT range AS n FROM range(100000)',
  }[engine];
  const byteBoundedReadQuery = {
    mysql: `SELECT 1 AS id, 'ok' AS value
      UNION ALL SELECT 2, REPEAT('x', 200000)
      UNION ALL SELECT 3, 'unread' ORDER BY id`,
    postgres: `SELECT 1 AS id, 'ok' AS value
      UNION ALL SELECT 2, repeat('x', 200000)
      UNION ALL SELECT 3, 'unread' ORDER BY id`,
    mssql: `SELECT 1 AS id, CAST('ok' AS VARCHAR(MAX)) AS value
      UNION ALL SELECT 2, REPLICATE(CAST('x' AS VARCHAR(MAX)), 200000)
      UNION ALL SELECT 3, CAST('unread' AS VARCHAR(MAX)) ORDER BY id`,
    oracle: `SELECT 1 AS id, 'ok' AS value FROM dual
      UNION ALL SELECT 2, RPAD('x', 3000, 'x') FROM dual
      UNION ALL SELECT 3, 'unread' FROM dual ORDER BY 1`,
    sqlite: `SELECT 1 AS id, 'ok' AS value
      UNION ALL SELECT 2, printf('%0200000d', 1)
      UNION ALL SELECT 3, 'unread' ORDER BY id`,
    duckdb: `SELECT * FROM (VALUES
      (1, 'ok'), (2, repeat('x', 200000)), (3, 'unread')
    ) AS t(id, value) ORDER BY id`,
  }[engine];
  const probeQuery = engine === 'oracle' ? 'SELECT 42 AS value FROM dual' : 'SELECT 42 AS value';

  return {
    createTable: `CREATE TABLE ${table} (id ${idType} PRIMARY KEY, name ${nameType} NOT NULL, score ${idType})`,
    createView: `CREATE VIEW ${view} AS SELECT id, name, score FROM ${table}`,
    insert: `INSERT INTO ${table} (id, name, score) VALUES (${placeholders.join(', ')})`,
    update: `UPDATE ${table} SET score = ${engine === 'postgres' ? '$1' : '?'} WHERE id = ${engine === 'postgres' ? '$2' : '?'}`,
    deleteById: `DELETE FROM ${table} WHERE id = ${engine === 'postgres' ? '$1' : '?'}`,
    selectById: `SELECT id, name, score FROM ${table} WHERE id = ${selectPlaceholder}`,
    selectAll: `SELECT id, name, score FROM ${table} ORDER BY id`,
    largeIntegerQuery,
    boundedReadQuery,
    byteBoundedReadQuery,
    probeQuery,
    procedureDdl,
    procedureName:
      procedureDdl || engine === 'oracle'
        ? procedure
        : engine === 'sqlite' || engine === 'duckdb'
          ? 'abs'
          : null,
  };
}

async function verifyByteBoundedReads(driver, engine, byteBoundedReadQuery, probeQuery) {
  const options = { ...RO, maxRows: 10, maxBytes: 1024 };
  const assertBounded = (result, context) => {
    assert.equal(result.success, true, `${engine} ${context} failed: ${result.error ?? ''}`);
    assert.equal(result.data?.length, 1, `${engine} ${context} retained an oversized row`);
    assert.equal(result.truncated, true, `${engine} ${context} was not marked truncated`);
    assert.equal(result.truncatedBy, 'bytes', `${engine} ${context} used the wrong limit`);
    assert.ok(result.returnedBytes <= 1024, `${engine} ${context} exceeded its byte budget`);
  };

  const result = await driver.execute(byteBoundedReadQuery, [], options);
  assertBounded(result, 'byte-bounded read');
  const followUp = await executeOk(driver, probeQuery, [], RO);
  assert.equal(followUp.data?.length, 1, `${engine} connection was not reusable after byte cap`);

  const tx = await driver.beginTransaction();
  try {
    const transactionResult = await tx.execute(byteBoundedReadQuery, [], options);
    assertBounded(transactionResult, 'transaction byte-bounded read');
    const transactionFollowUp = await tx.execute(probeQuery, [], RO);
    assert.equal(
      transactionFollowUp.success,
      true,
      `${engine} transaction was not reusable after byte cap: ${transactionFollowUp.error ?? ''}`,
    );
  } finally {
    await tx.rollback();
  }
}

async function verifyBoundedReads(driver, engine, boundedReadQuery, probeQuery) {
  const options = { ...RO, maxRows: 2 };
  const assertBounded = (result, context) => {
    assert.equal(result.success, true, `${engine} ${context} failed: ${result.error ?? ''}`);
    assert.equal(result.data?.length, 2, `${engine} ${context} returned the wrong row count`);
    assert.equal(result.truncated, true, `${engine} ${context} was not marked truncated`);
    assert.equal(result.totalRowsExact, false, `${engine} ${context} total was marked exact`);
    assert.ok(result.totalRows >= 3, `${engine} ${context} did not observe the probe row`);
    const observedUpperBound = engine === 'duckdb' ? 4096 : engine === 'mssql' ? 1000 : 3;
    assert.ok(
      result.totalRows <= observedUpperBound,
      `${engine} ${context} read too many rows: ${result.totalRows}`,
    );
  };

  const result = await driver.execute(boundedReadQuery, [], options);
  assertBounded(result, 'bounded read');
  const followUp = await executeOk(driver, probeQuery, [], RO);
  assert.equal(followUp.data?.length, 1, `${engine} connection was not reusable after truncation`);

  const tx = await driver.beginTransaction();
  try {
    const transactionResult = await tx.execute(boundedReadQuery, [], options);
    assertBounded(transactionResult, 'transaction bounded read');
    const transactionFollowUp = await tx.execute(probeQuery, [], RO);
    assert.equal(
      transactionFollowUp.success,
      true,
      `${engine} transaction was not reusable: ${transactionFollowUp.error ?? ''}`,
    );
    assert.equal(
      transactionFollowUp.data?.length,
      1,
      `${engine} transaction follow-up returned the wrong row count`,
    );
  } finally {
    await tx.rollback();
  }
}

async function provisionOracleProcedure(spec, procedure) {
  const loaded = await import('oracledb');
  const oracledb = loaded.default ?? loaded;
  const connectString =
    spec.url ?? `${spec.host ?? 'localhost'}:${spec.port ?? 1521}/${spec.database ?? ''}`;
  const connection = await oracledb.getConnection({
    user: spec.user,
    password: spec.password ?? '',
    connectString,
  });
  try {
    await connection.execute(
      `CREATE OR REPLACE PROCEDURE ${procedure}(x IN NUMBER) AS BEGIN NULL; END;`,
    );
  } finally {
    await connection.close();
  }
}

async function executeOk(driver, sql, params = [], options = RW) {
  const result = await driver.execute(sql, params, options);
  assert.equal(result.success, true, `${driver.engine} SQL failed: ${sql}\n${result.error ?? ''}`);
  return result;
}

async function verifyReadonlyBypasses(server, driver, id, engine, table) {
  const attacks = [
    {
      name: 'stacked statement',
      sql: `SELECT 1; DELETE FROM ${table} WHERE id = 1`,
    },
  ];
  if (engine === 'postgres') {
    attacks.push({
      name: 'writable CTE',
      sql: `WITH deleted AS (DELETE FROM ${table} WHERE id = 1 RETURNING *) SELECT * FROM deleted`,
    });
    attacks.push({
      name: 'backslash quote escape mismatch',
      sql: `SELECT '\\'; DELETE FROM ${table} WHERE id = 1; --'`,
    });
    attacks.push(
      {
        name: 'server file read function',
        sql: "SELECT pg_read_file('/etc/passwd')",
      },
      {
        name: 'quoted server file function in FROM',
        sql: "SELECT * FROM \"pg_catalog\".\"pg_read_binary_file\"/**/('/etc/passwd')",
      },
    );
  }
  if (engine === 'mysql') {
    attacks.push({
      name: 'executable comment',
      sql: `/*!50000 DELETE FROM ${table} WHERE id = 1 */`,
    });
    attacks.push(
      {
        name: 'PostgreSQL dollar quote confusion',
        sql: `SELECT $tag$; DELETE FROM ${table} WHERE id = 1; $tag$`,
      },
      {
        name: 'dash comment without required whitespace',
        sql: `SELECT 1--x; DELETE FROM ${table} WHERE id = 1`,
      },
      {
        name: 'nested comment confusion',
        sql: `SELECT 1 /* outer /* nested */; DELETE FROM ${table} WHERE id = 1; */`,
      },
      {
        name: 'server file read function',
        sql: "SELECT LOAD_FILE('/etc/passwd')",
      },
      {
        name: 'quoted server file read function',
        sql: "SELECT `LOAD_FILE`/**/('/etc/passwd')",
      },
    );
  }
  if (engine === 'mssql') {
    attacks.push({
      name: 'dynamic EXEC',
      sql: `EXEC('DELETE FROM ${table} WHERE id = 1')`,
    });
  }

  for (const attack of attacks) {
    const blocked = await callTool(
      server,
      'sql_query',
      { connection_id: id, sql: attack.sql },
      { allowError: true },
    );
    assert.equal(blocked.result.isError, true, `${engine} ${attack.name} was not rejected`);
    assert.match(
      resultText(blocked.result),
      /SQL_002/,
      `${engine} ${attack.name} was not rejected at the MCP readonly layer`,
    );
  }

  const survivor = await executeOk(driver, `SELECT id FROM ${table} WHERE id = 1`, [], RO);
  assert.equal(survivor.data?.length, 1, `${engine} readonly bypass changed protected data`);

  const readwriteCapabilitySql = {
    postgres: "SELECT pg_catalog.pg_read_file('/etc/passwd')",
    mysql: "SELECT LOAD_FILE('/etc/passwd')",
  }[engine];
  if (readwriteCapabilitySql) {
    const blocked = await callTool(
      server,
      'sql_execute',
      { connection_id: id, sql: readwriteCapabilitySql },
      { allowError: true },
    );
    assert.equal(
      blocked.result.isError,
      true,
      `${engine} dangerous capability reached the readwrite database path`,
    );
    assert.match(resultText(blocked.result), /危险 SQL 能力/);
  }

  if (engine === 'mysql') {
    await callTool(server, 'sql_query', {
      connection_id: id,
      sql: '# comment\nSELECT 1 AS comment_value',
    });
  }
  if (engine === 'postgres') {
    await callTool(server, 'sql_query', {
      connection_id: id,
      sql: 'SELECT $$DELETE FROM users$$ AS message /* outer /* nested */ comment */',
    });
  }
}

async function verifyDangerousDdlBlocked(server, driver, id, engine, table) {
  for (const sql of [
    `ALTER TABLE ${table} ADD blocked_column INTEGER`,
    `TRUNCATE TABLE ${table}`,
    `DROP TABLE ${table}`,
  ]) {
    const blocked = await callTool(
      server,
      'sql_execute',
      { connection_id: id, sql },
      { allowError: true },
    );
    assert.equal(blocked.result.isError, true, `${engine} dangerous DDL was not rejected: ${sql}`);
  }

  const survivor = await executeOk(driver, `SELECT id FROM ${table} WHERE id = 1`, [], RO);
  assert.equal(survivor.data?.length, 1, `${engine} blocked DDL changed the protected table`);
}

async function verifySqlEngine(server, registry, id, engine, suffix) {
  const driver = registry.requireSql(id);
  const table = `rt_${engine}_${suffix}`;
  const view = `rv_${engine}_${suffix}`;
  const index = `ri_${engine}_${suffix}`;
  const procedure = `rp_${engine}_${suffix}`;
  const sql = sqlDialect(engine, table, view, procedure);

  const ping = await driver.ping();
  assert.equal(ping.ok, true, `${engine} ping failed: ${ping.error ?? ''}`);

  await callTool(server, 'sql_execute', { connection_id: id, sql: sql.createTable });
  await callTool(server, 'sql_batch_execute', {
    connection_id: id,
    statements: [
      { sql: sql.insert, params: [1, 'alpha', 10] },
      { sql: sql.insert, params: [2, 'beta', 20] },
      { sql: sql.insert, params: [5, 'gamma', 50] },
    ],
  });

  const queried = await callTool(server, 'sql_query', {
    connection_id: id,
    sql: sql.selectById,
    params: [1],
    limit: 10,
  });
  assert.equal(queried.value.data?.length, 1, `${engine} parameter query returned wrong row count`);
  const paged = await callTool(server, 'sql_query', {
    connection_id: id,
    sql: sql.selectAll,
    page: 1,
    page_size: 2,
  });
  assert.equal(paged.value.data?.length, 2, `${engine} pagination returned wrong row count`);
  assert.equal(paged.value.pagination?.has_next, true, `${engine} missed the next page`);
  assert.equal(paged.value.totalRowsExact, false, `${engine} first page total should be inexact`);
  assert.equal(
    'total_pages' in (paged.value.pagination ?? {}),
    false,
    `${engine} exposed total_pages before the total was known`,
  );
  const lastPage = await callTool(server, 'sql_query', {
    connection_id: id,
    sql: sql.selectAll,
    page: 2,
    page_size: 2,
  });
  assert.equal(lastPage.value.data?.length, 1, `${engine} last page returned wrong row count`);
  assert.equal(lastPage.value.pagination?.has_next, false, `${engine} last page has_next mismatch`);
  assert.equal(lastPage.value.totalRows, 3, `${engine} exact paginated row count mismatch`);
  assert.equal(lastPage.value.totalRowsExact, true, `${engine} last page total was not exact`);
  assert.equal(lastPage.value.pagination?.total_pages, 2, `${engine} total_pages mismatch`);

  const largeInteger = await callTool(server, 'sql_query', {
    connection_id: id,
    sql: sql.largeIntegerQuery,
  });
  const largeIntegerValue = Object.values(largeInteger.value.data?.[0] ?? {})[0];
  assert.equal(
    largeIntegerValue,
    LARGE_INTEGER,
    `${engine} lost BIGINT precision or did not serialize it as a string`,
  );

  await verifyBoundedReads(driver, engine, sql.boundedReadQuery, sql.probeQuery);
  await verifyByteBoundedReads(driver, engine, sql.byteBoundedReadQuery, sql.probeQuery);

  await verifyReadonlyBypasses(server, driver, id, engine, table);
  await verifyDangerousDdlBlocked(server, driver, id, engine, table);

  await callTool(server, 'sql_execute', {
    connection_id: id,
    sql: sql.update,
    params: [11, 1],
  });
  const updated = await executeOk(driver, sql.selectById, [1], RO);
  assert.equal(updated.data?.length, 1, `${engine} update removed the target row`);
  assert.equal(
    Number(updated.data?.[0]?.score ?? updated.data?.[0]?.SCORE),
    11,
    `${engine} standalone update did not persist`,
  );
  await callTool(server, 'sql_execute', {
    connection_id: id,
    sql: sql.insert,
    params: [4, 'delete', 40],
  });
  const inserted = await executeOk(driver, sql.selectById, [4], RO);
  assert.equal(inserted.data?.length, 1, `${engine} standalone insert did not persist`);
  await callTool(server, 'sql_execute', {
    connection_id: id,
    sql: sql.deleteById,
    params: [4],
  });
  const deleted = await executeOk(driver, sql.selectById, [4], RO);
  assert.equal(deleted.data?.length ?? 0, 0, `${engine} delete did not remove data`);

  const rollbackTx = await callTool(server, 'sql_begin_transaction', { connection_id: id });
  await callTool(server, 'sql_execute_in_transaction', {
    transaction_id: rollbackTx.value.transaction_id,
    sql: sql.insert,
    params: [3, 'rollback', 30],
  });
  await callTool(server, 'sql_rollback', { transaction_id: rollbackTx.value.transaction_id });
  const rolledBack = await executeOk(driver, sql.selectById, [3], RO);
  assert.equal(rolledBack.data?.length ?? 0, 0, `${engine} rollback persisted data`);

  const commitTx = await callTool(server, 'sql_begin_transaction', { connection_id: id });
  await callTool(server, 'sql_execute_in_transaction', {
    transaction_id: commitTx.value.transaction_id,
    sql: sql.insert,
    params: [3, 'commit', 30],
  });
  await callTool(server, 'sql_commit', { transaction_id: commitTx.value.transaction_id });
  const committed = await executeOk(driver, sql.selectById, [3], RO);
  assert.equal(committed.data?.length, 1, `${engine} commit did not persist data`);

  const missingIndexSuggestion = await callTool(server, 'query_suggest', {
    connectionId: id,
    sql: `SELECT id FROM ${table} WHERE score = 11`,
  });
  assert.ok(
    missingIndexSuggestion.value.suggestions.some(
      (item) => item.type === 'index' && String(item.message).includes('score'),
    ),
    `${engine} query_suggest did not identify the missing score index`,
  );

  await callTool(server, 'sql_create_index', {
    connection_id: id,
    table,
    columns: ['score', 'name'],
    unique: true,
    indexName: index,
  });
  const indexes = await callTool(server, 'sql_list_indexes', { connection_id: id, table });
  assert.ok(Array.isArray(indexes.value.indexes), `${engine} index listing is not an array`);
  assert.ok(
    containsIdentifier(indexes.value.indexes, index),
    `${engine} index listing did not contain created index ${index}`,
  );
  assert.ok(
    indexMetadataContainsColumn(indexes.value.indexes, 'score') &&
      indexMetadataContainsColumn(indexes.value.indexes, 'name'),
    `${engine} index listing did not expose both indexed columns`,
  );
  const duplicateIndexEntry = await callTool(
    server,
    'sql_execute',
    {
      connection_id: id,
      sql: sql.insert,
      params: [6, 'alpha', 11],
    },
    { allowError: true },
  );
  assert.equal(
    duplicateIndexEntry.result.isError,
    true,
    `${engine} unique composite index accepted a duplicate key`,
  );
  const rejectedDuplicate = await executeOk(driver, sql.selectById, [6], RO);
  assert.equal(
    rejectedDuplicate.data?.length ?? 0,
    0,
    `${engine} duplicate key failure still persisted a row`,
  );

  await callTool(server, 'sql_execute', { connection_id: id, sql: sql.createView });
  const views = await callTool(server, 'sql_list_views', { connection_id: id });
  assert.ok(Array.isArray(views.value.views), `${engine} view listing is not an array`);
  assert.ok(
    containsIdentifier(views.value.views, view),
    `${engine} view listing did not contain created view ${view}`,
  );
  await callTool(server, 'sql_describe_view', { connection_id: id, view });

  const tables = await callTool(server, 'sql_list_tables', { connection_id: id });
  assert.ok(Array.isArray(tables.value.tables), `${engine} table listing is not an array`);
  assert.ok(
    containsIdentifier(tables.value.tables, table),
    `${engine} table listing did not contain created table ${table}`,
  );
  const described = await callTool(server, 'sql_describe_table', { connection_id: id, table });
  assert.ok(described.value.columns?.length >= 3, `${engine} table description missed columns`);
  await callTool(server, 'sql_generate_types', { connection_id: id, table });
  await callTool(server, 'sql_sample_table', {
    connection_id: id,
    table,
    sample_size: 10,
  });

  const byteBoundedToolResult = await callTool(server, 'sql_query', {
    connection_id: id,
    sql: sql.byteBoundedReadQuery,
    limit: 10,
    response_bytes_limit: 1024,
  });
  assert.equal(byteBoundedToolResult.value.data?.length, 1, `${engine} tool retained large row`);
  assert.equal(byteBoundedToolResult.value.truncatedBy, 'bytes');

  for (const format of ['json', 'csv', 'markdown']) {
    const exported = await callTool(server, 'sql_export_query', {
      connection_id: id,
      sql: sql.selectAll,
      format,
      limit: 10,
    });
    assert.equal(exported.value.format, format, `${engine} ${format} export format mismatch`);
  }

  const explained = await callTool(
    server,
    'sql_explain',
    { connection_id: id, sql: sql.selectAll },
    { allowError: engine === 'mssql' },
  );
  if (engine === 'mssql') {
    assert.equal(
      explained.result.isError,
      true,
      'MSSQL EXPLAIN must report documented unsupported error',
    );
  } else {
    assert.ok(Array.isArray(explained.value.execution_plan), `${engine} EXPLAIN returned no plan`);
  }

  const suggested = await callTool(server, 'query_suggest', {
    connectionId: id,
    sql: `SELECT * FROM ${table}`,
  });
  assert.ok(
    Array.isArray(suggested.value.suggestions),
    `${engine} query_suggest returned no suggestions`,
  );
  assert.ok(
    suggested.value.suggestions.some((item) => String(item.message).includes('SELECT *')),
    `${engine} query_suggest did not detect SELECT *`,
  );
  assert.equal(suggested.value.analyzedWithSchema, true, `${engine} schema analysis was not used`);
  assert.ok(suggested.value.tableCount >= 1, `${engine} query_suggest loaded no table metadata`);
  const indexAwareSuggestion = await callTool(server, 'query_suggest', {
    connectionId: id,
    sql: `SELECT id FROM ${table} WHERE score = 11`,
  });
  assert.equal(
    indexAwareSuggestion.value.suggestions.some(
      (item) => item.type === 'index' && String(item.message).includes('score'),
    ),
    false,
    `${engine} query_suggest did not recognize the created score index`,
  );
  const optimized = await callTool(server, 'query_optimize', {
    connectionId: id,
    sql: sql.selectAll,
  });
  assert.ok(
    Array.isArray(optimized.value.suggestions),
    `${engine} query_optimize returned no suggestions`,
  );
  assert.ok(
    optimized.value.tableInfo?.some((item) => item.name.toLowerCase() === table.toLowerCase()),
    `${engine} query_optimize loaded no metadata for ${table}`,
  );
  assert.ok(
    optimized.value.tableInfo?.some(
      (item) => item.name.toLowerCase() === table.toLowerCase() && item.indexCount >= 1,
    ),
    `${engine} query_optimize did not load index metadata for ${table}`,
  );
  if (engine === 'mssql') {
    assert.match(
      optimized.value.planError ?? '',
      /MSSQL EXPLAIN/,
      'MSSQL query_optimize must report the documented EXPLAIN limitation',
    );
  } else {
    assert.ok(
      Array.isArray(optimized.value.executionPlan),
      `${engine} query_optimize returned no execution plan`,
    );
  }

  const schemaJson = await callTool(server, 'schema_export', {
    connection_id: id,
    format: 'json',
  });
  assert.ok(schemaJson.value.table_count >= 1, `${engine} schema export returned no tables`);
  const schemaSql = await callTool(server, 'schema_export', {
    connection_id: id,
    format: 'sql',
  });
  const exportedDdl = String(schemaSql.value);
  assert.match(
    exportedDdl,
    /CREATE TABLE/i,
    `${engine} DDL export returned no CREATE TABLE`,
  );
  const catalogTable = engine === 'oracle' ? table.toUpperCase() : table;
  const catalogView = engine === 'oracle' ? view.toUpperCase() : view;
  const exportedTablePrefix = `CREATE TABLE ${quoteSqlIdentifier(engine, catalogTable)} (`;
  assert.ok(
    exportedDdl.includes(exportedTablePrefix),
    `${engine} DDL export did not contain created table ${table}`,
  );
  assert.equal(
    exportedDdl.includes(`CREATE TABLE ${quoteSqlIdentifier(engine, catalogView)} (`),
    false,
    `${engine} DDL export treated view ${view} as a base table`,
  );

  const exportedTableDdl = exportedDdl
    .split('\n\n')
    .find((statement) => statement.startsWith(exportedTablePrefix));
  assert.ok(exportedTableDdl, `${engine} could not isolate exported DDL for ${table}`);
  const restoredTable =
    engine === 'oracle'
      ? `RD_ORACLE_${suffix.toUpperCase()}`
      : `rd_${engine}_${suffix}`;
  const restoredTableDdl = exportedTableDdl.replace(
    exportedTablePrefix,
    `CREATE TABLE ${quoteSqlIdentifier(engine, restoredTable)} (`,
  );
  await callTool(server, 'sql_execute', {
    connection_id: id,
    sql: restoredTableDdl,
  });
  const restoredDescription = await callTool(server, 'sql_describe_table', {
    connection_id: id,
    table: restoredTable,
  });
  assert.equal(
    restoredDescription.value.columns?.length,
    3,
    `${engine} restored DDL did not recreate all columns`,
  );
  const restoredProbe = await executeOk(
    driver,
    `SELECT * FROM ${quoteSqlIdentifier(engine, restoredTable)} WHERE 1 = 0`,
    [],
    RO,
  );
  assert.equal(restoredProbe.data?.length, 0, `${engine} restored table was not queryable`);

  if (sql.procedureDdl) {
    await callTool(server, 'sql_execute', { connection_id: id, sql: sql.procedureDdl });
  }
  if (engine === 'oracle') {
    await provisionOracleProcedure(registry.require(id).spec, procedure);
  }
  if (sql.procedureName) {
    await callTool(server, 'sql_call_procedure', {
      connection_id: id,
      procedure: sql.procedureName,
      params: [7],
    });
  }

  console.log(`SQL ${engine}: all applicable operations OK`);
  return { id, table };
}

async function verifyMongo(server, id, suffix) {
  const collection = `rt_mongo_${suffix}`;
  const renamed = `rr_mongo_${suffix}`;

  await callTool(server, 'mongo_insert_one', {
    connection_id: id,
    collection,
    document_json: JSON.stringify({
      id: 1,
      name: 'alpha',
      group: 'a',
      score: 10,
      big_value: { $numberLong: LARGE_INTEGER },
    }),
  });
  await callTool(server, 'mongo_insert_many', {
    connection_id: id,
    collection,
    documents_json: JSON.stringify([
      { id: 2, name: 'beta', group: 'a', score: 20 },
      { id: 3, name: 'gamma', group: 'b', score: 30 },
    ]),
  });
  await callTool(server, 'mongo_insert_many', {
    connection_id: id,
    collection,
    documents_json: JSON.stringify([
      { id: 98, value: 'ok' },
      { id: 99, value: 'x'.repeat(200000) },
      { id: 100, value: 'unread' },
    ]),
  });
  const byteBoundedFind = await callTool(server, 'mongo_find', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ id: { $gte: 98 } }),
    limit: 10,
    response_bytes_limit: 1024,
  });
  assert.equal(byteBoundedFind.value.rows?.length, 1, 'MongoDB find retained oversized document');
  assert.equal(byteBoundedFind.value.truncatedBy, 'bytes');

  const byteBoundedAggregate = await callTool(server, 'mongo_aggregate', {
    connection_id: id,
    collection,
    pipeline_json: JSON.stringify([
      { $match: { id: { $gte: 98 } } },
      { $sort: { id: 1 } },
    ]),
    limit: 10,
    response_bytes_limit: 1024,
  });
  assert.equal(
    byteBoundedAggregate.value.rows?.length,
    1,
    'MongoDB aggregate retained oversized document',
  );
  assert.equal(byteBoundedAggregate.value.truncatedBy, 'bytes');
  await callTool(server, 'mongo_delete_many', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ id: { $gte: 98 } }),
  });
  const exactInt64 = await callTool(server, 'mongo_find', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ big_value: { $numberLong: LARGE_INTEGER } }),
    limit: 10,
  });
  assert.deepEqual(
    exactInt64.value.rows?.[0]?.big_value,
    { $numberLong: LARGE_INTEGER },
    'MongoDB Extended JSON Int64 lost precision',
  );
  await callTool(server, 'mongo_count', { connection_id: id, collection });
  const aggregated = await callTool(server, 'mongo_aggregate', {
    connection_id: id,
    collection,
    pipeline_json: JSON.stringify([{ $group: { _id: '$group', total: { $sum: '$score' } } }]),
  });
  assert.equal(aggregated.value.limit, 50, 'MongoDB aggregate default limit was not enforced');

  for (const [name, pipeline] of [
    ['out', [{ $out: `blocked_out_${suffix}` }]],
    ['merge', [{ $merge: { into: `blocked_merge_${suffix}` } }]],
  ]) {
    const blocked = await callTool(
      server,
      'mongo_aggregate',
      {
        connection_id: id,
        collection,
        pipeline_json: JSON.stringify(pipeline),
      },
      { allowError: true },
    );
    assert.equal(blocked.result.isError, true, `MongoDB $${name} write stage was not rejected`);
    assert.equal(blocked.value.error_info?.code, 'MONGO_003');
  }
  const collectionsAfterBlockedWrites = await callTool(server, 'mongo_list_collections', {
    connection_id: id,
  });
  assert.equal(
    collectionsAfterBlockedWrites.value.collections.some(
      (name) => name === `blocked_out_${suffix}` || name === `blocked_merge_${suffix}`,
    ),
    false,
    'MongoDB blocked aggregation created a collection',
  );
  await callTool(server, 'mongo_update_one', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ id: 1 }),
    update_json: JSON.stringify({ $set: { score: 11 } }),
  });
  await callTool(server, 'mongo_update_many', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ group: 'a' }),
    update_json: JSON.stringify({ $set: { active: true } }),
  });
  await callTool(server, 'mongo_find_one_and_update', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ id: 2 }),
    update_json: JSON.stringify({ $set: { name: 'beta2' } }),
    returnDocument: 'after',
  });
  const mongoIndex = `ri_mongo_${suffix}`;
  const createdIndex = await callTool(server, 'mongo_create_index', {
    connection_id: id,
    collection,
    keys_json: JSON.stringify({ score: 1, name: -1 }),
    name: mongoIndex,
    unique: true,
    sparse: true,
  });
  assert.equal(createdIndex.value.indexName, mongoIndex, 'MongoDB returned the wrong index name');
  const mongoIndexes = await callTool(server, 'mongo_list_indexes', { connection_id: id, collection });
  assert.ok(Array.isArray(mongoIndexes.value.indexes), 'MongoDB index listing is not an array');
  assert.ok(
    containsIdentifier(mongoIndexes.value.indexes, mongoIndex),
    `MongoDB index listing did not contain created index ${mongoIndex}`,
  );
  const duplicateIndexDocument = await callTool(
    server,
    'mongo_insert_one',
    {
      connection_id: id,
      collection,
      document_json: JSON.stringify({ id: 99, name: 'alpha', score: 11 }),
    },
    { allowError: true },
  );
  assert.equal(
    duplicateIndexDocument.result.isError,
    true,
    'MongoDB unique composite index accepted a duplicate key',
  );
  const rejectedMongoDuplicate = await callTool(server, 'mongo_find', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ id: 99 }),
  });
  assert.equal(
    rejectedMongoDuplicate.value.documents?.length ?? 0,
    0,
    'MongoDB duplicate key failure still persisted a document',
  );
  await callTool(server, 'mongo_schema_analysis', {
    connection_id: id,
    collection,
    sample_size: 10,
  });
  await callTool(server, 'mongo_delete_one', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ id: 3 }),
  });
  await callTool(server, 'mongo_find_one_and_delete', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ id: 2 }),
  });

  const commitTx = await callTool(server, 'mongo_begin_transaction', { connection_id: id });
  const txOperations = [
    {
      operation: 'insert_one',
      document_json: JSON.stringify({ id: 10, tx: 'commit', txGroup: 'keep' }),
    },
    {
      operation: 'insert_many',
      documents_json: JSON.stringify([
        { id: 12, tx: 'many', txGroup: 'delete' },
        { id: 13, tx: 'many', txGroup: 'delete' },
      ]),
    },
    {
      operation: 'update_one',
      filter_json: JSON.stringify({ id: 10 }),
      update_json: JSON.stringify({ $set: { updatedOne: true } }),
    },
    {
      operation: 'update_many',
      filter_json: JSON.stringify({ tx: 'many' }),
      update_json: JSON.stringify({ $set: { updatedMany: true } }),
    },
    { operation: 'delete_one', filter_json: JSON.stringify({ id: 12 }) },
    { operation: 'delete_many', filter_json: JSON.stringify({ txGroup: 'delete' }) },
  ];
  for (const operation of txOperations) {
    await callTool(server, 'mongo_execute_in_transaction', {
      transaction_id: commitTx.value.transaction_id,
      collection,
      ...operation,
    });
  }
  await callTool(server, 'mongo_commit', { transaction_id: commitTx.value.transaction_id });

  const rollbackTx = await callTool(server, 'mongo_begin_transaction', { connection_id: id });
  await callTool(server, 'mongo_execute_in_transaction', {
    transaction_id: rollbackTx.value.transaction_id,
    operation: 'insert_one',
    collection,
    document_json: JSON.stringify({ id: 11, tx: 'rollback' }),
  });
  await callTool(server, 'mongo_rollback', { transaction_id: rollbackTx.value.transaction_id });

  await callTool(server, 'mongo_delete_many', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ active: true }),
  });
  await callTool(server, 'mongo_rename_collection', {
    connection_id: id,
    collection,
    newName: renamed,
  });
  await callTool(server, 'mongo_list_collections', { connection_id: id });
  await callTool(server, 'mongo_drop_collection', { connection_id: id, collection: renamed });
  console.log('MongoDB: all operations OK');
}

async function verifyRedis(server, id, suffix) {
  const key = (kind) => `rt:${suffix}:${kind}`;
  await callTool(server, 'redis_set', { connection_id: id, key: key('string'), value: 'value' });
  await callTool(server, 'redis_get', { connection_id: id, key: key('string') });
  await callTool(server, 'redis_type', { connection_id: id, key: key('string') });
  await callTool(server, 'redis_expire', { connection_id: id, key: key('string'), seconds: 60 });
  await callTool(server, 'redis_ttl', { connection_id: id, key: key('string') });
  await callTool(server, 'redis_set', {
    connection_id: id,
    key: key('large-string'),
    value: 'x'.repeat(2 * 1024 * 1024),
  });
  const boundedString = await callTool(server, 'redis_get', {
    connection_id: id,
    key: key('large-string'),
  });
  assert.equal(boundedString.value.truncated, true);
  assert.equal(boundedString.value.total_bytes, 2 * 1024 * 1024);
  assert.ok(boundedString.value.next_offset_bytes > 0);
  const stringTail = await callTool(server, 'redis_get', {
    connection_id: id,
    key: key('large-string'),
    offset_bytes: boundedString.value.next_offset_bytes,
    max_bytes: 1024,
  });
  assert.equal(stringTail.value.value, 'x'.repeat(1024));
  await callTool(server, 'redis_del', { connection_id: id, key: key('large-string') });
  await callTool(server, 'redis_scan', {
    connection_id: id,
    match: `rt:${suffix}:*`,
    cursor: '0',
    count: 100,
  });

  await callTool(server, 'redis_hset', {
    connection_id: id,
    key: key('hash'),
    field: 'field',
    value: 'value',
  });
  await callTool(server, 'redis_hget', { connection_id: id, key: key('hash'), field: 'field' });
  await callTool(server, 'redis_hgetall', { connection_id: id, key: key('hash') });
  await callTool(server, 'redis_hscan', {
    connection_id: id,
    key: key('hash'),
    cursor: '0',
    match: '*',
    count: 100,
  });
  await callTool(server, 'redis_hdel', { connection_id: id, key: key('hash'), field: 'field' });

  await callTool(server, 'redis_lpush', {
    connection_id: id,
    key: key('list'),
    values: ['b', 'a'],
  });
  await callTool(server, 'redis_rpush', {
    connection_id: id,
    key: key('list'),
    values: ['c', 'd'],
  });
  await callTool(server, 'redis_lrange', {
    connection_id: id,
    key: key('list'),
    start: 0,
    stop: -1,
  });
  await callTool(server, 'redis_llen', { connection_id: id, key: key('list') });
  await callTool(server, 'redis_lpop', { connection_id: id, key: key('list') });
  await callTool(server, 'redis_rpop', { connection_id: id, key: key('list') });

  await callTool(server, 'redis_sadd', {
    connection_id: id,
    key: key('set'),
    members: ['a', 'b'],
  });
  await callTool(server, 'redis_smembers', { connection_id: id, key: key('set') });
  await callTool(server, 'redis_sscan', {
    connection_id: id,
    key: key('set'),
    cursor: '0',
    match: '*',
    count: 100,
  });
  await callTool(server, 'redis_scard', { connection_id: id, key: key('set') });
  await callTool(server, 'redis_sismember', {
    connection_id: id,
    key: key('set'),
    member: 'a',
  });
  await callTool(server, 'redis_srem', {
    connection_id: id,
    key: key('set'),
    members: ['b'],
  });

  await callTool(server, 'redis_zadd', {
    connection_id: id,
    key: key('zset'),
    score: 1,
    member: 'a',
  });
  await callTool(server, 'redis_zrange', {
    connection_id: id,
    key: key('zset'),
    start: 0,
    stop: -1,
    withScores: true,
  });
  await callTool(server, 'redis_zscan', {
    connection_id: id,
    key: key('zset'),
    cursor: '0',
    match: '*',
    count: 100,
  });
  await callTool(server, 'redis_zscore', {
    connection_id: id,
    key: key('zset'),
    member: 'a',
  });
  await callTool(server, 'redis_zcard', { connection_id: id, key: key('zset') });
  await callTool(server, 'redis_zrem', {
    connection_id: id,
    key: key('zset'),
    members: ['a'],
  });

  await callTool(server, 'redis_pipeline', {
    connection_id: id,
    commands_json: JSON.stringify([
      { command: 'set', key: key('pipeline:string'), args: ['p'] },
      { command: 'get', key: key('pipeline:string') },
      { command: 'type', key: key('pipeline:string') },
      { command: 'expire', key: key('pipeline:string'), args: [60] },
      { command: 'ttl', key: key('pipeline:string') },
      { command: 'hset', key: key('pipeline:hash'), args: ['f', 'v'] },
      { command: 'hget', key: key('pipeline:hash'), args: ['f'] },
      { command: 'hdel', key: key('pipeline:hash'), args: ['f'] },
      { command: 'lpush', key: key('pipeline:list'), args: ['b', 'a'] },
      { command: 'rpush', key: key('pipeline:list'), args: ['c', 'd'] },
      { command: 'llen', key: key('pipeline:list') },
      { command: 'lpop', key: key('pipeline:list') },
      { command: 'rpop', key: key('pipeline:list') },
      { command: 'sadd', key: key('pipeline:set'), args: ['a', 'b'] },
      { command: 'scard', key: key('pipeline:set') },
      { command: 'sismember', key: key('pipeline:set'), args: ['a'] },
      { command: 'srem', key: key('pipeline:set'), args: ['b'] },
      { command: 'zadd', key: key('pipeline:zset'), args: [1, 'a'] },
      { command: 'zscore', key: key('pipeline:zset'), args: ['a'] },
      { command: 'zcard', key: key('pipeline:zset') },
      { command: 'zrem', key: key('pipeline:zset'), args: ['a'] },
      { command: 'del', key: key('pipeline:string') },
    ]),
  });
  await callTool(server, 'redis_blocked_commands');

  for (const kind of [
    'string',
    'hash',
    'list',
    'set',
    'zset',
    'pipeline:hash',
    'pipeline:list',
    'pipeline:set',
    'pipeline:zset',
  ]) {
    await callTool(server, 'redis_del', { connection_id: id, key: key(kind) });
  }
  console.log('Redis: all operations OK');
}

async function main() {
  assert.ok(process.env.DB_MCP_CONNECTIONS, 'DB_MCP_CONNECTIONS is required');
  process.env.DB_RATE_LIMIT_PER_SECOND = '0';
  process.env.DB_QUERY_TIMEOUT = process.env.DB_QUERY_TIMEOUT ?? '30000';
  process.env.DB_MAX_ROWS = process.env.DB_MAX_ROWS ?? '1000';
  process.env.DB_MAX_RESPONSE_BYTES = '1048576';

  const registry = await createRegistryFromEnv();
  try {
    const ids = connectionIdsByEngine(registry);
    const pings = await pingAll(registry);
    for (const ping of pings) {
      assert.equal(ping.ok, true, `${ping.id} ping failed: ${ping.error ?? ''}`);
    }
    await verifyPostgresRoleDiagnostics(registry, ids.get('postgres'));

    const server = new ToolCollector();
    installResponseBudget(server);
    registerSqlTools(server, registry);
    registerSchemaTools(server, registry);
    registerAdvisorTools(server, registry);
    registerMongoTools(server, registry);
    registerRedisTools(server, registry);

    const suffix = `${Date.now().toString(36)}`;
    for (const engine of SQL_ENGINES) {
      await verifySqlEngine(server, registry, ids.get(engine), engine, suffix);
    }
    await callTool(server, 'schema_diff', {
      source_connection_id: ids.get('sqlite'),
      target_connection_id: ids.get('duckdb'),
    });
    await callTool(server, 'sql_cache_stats');
    await verifyMongo(server, ids.get('mongodb'), suffix);
    await verifyRedis(server, ids.get('redis'), suffix);

    const uncalledTools = [...server.tools.keys()].filter((name) => !server.called.has(name));
    assert.deepEqual(
      uncalledTools,
      [],
      `registered database tools not exercised: ${uncalledTools}`,
    );

    console.log(
      `REAL_DB_MATRIX_OK engines=${REQUIRED_ENGINES.join(',')} tools=${server.called.size}`,
    );
  } finally {
    await closeAll(registry);
  }
}

main().catch((error) => {
  console.error('REAL_DB_MATRIX_FAILED');
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
