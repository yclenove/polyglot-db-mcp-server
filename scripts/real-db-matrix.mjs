import assert from 'node:assert/strict';

import { createRegistryFromEnv, closeAll, pingAll } from '../dist/bootstrap.js';
import { registerAdvisorTools } from '../dist/tools/advisor.js';
import { registerMongoTools } from '../dist/tools/mongo.js';
import { registerRedisTools } from '../dist/tools/redis.js';
import { registerSchemaTools } from '../dist/tools/schema.js';
import { registerSqlTools } from '../dist/tools/sql.js';

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

  return {
    createTable: `CREATE TABLE ${table} (id ${idType} PRIMARY KEY, name ${nameType} NOT NULL, score ${idType})`,
    createView: `CREATE VIEW ${view} AS SELECT id, name, score FROM ${table}`,
    insert: `INSERT INTO ${table} (id, name, score) VALUES (${placeholders.join(', ')})`,
    update: `UPDATE ${table} SET score = ${engine === 'postgres' ? '$1' : '?'} WHERE id = ${engine === 'postgres' ? '$2' : '?'}`,
    deleteById: `DELETE FROM ${table} WHERE id = ${engine === 'postgres' ? '$1' : '?'}`,
    selectById: `SELECT id, name, score FROM ${table} WHERE id = ${selectPlaceholder}`,
    selectAll: `SELECT id, name, score FROM ${table} ORDER BY id`,
    largeIntegerQuery,
    procedureDdl,
    procedureName:
      procedureDdl || engine === 'oracle'
        ? procedure
        : engine === 'sqlite' || engine === 'duckdb'
          ? 'abs'
          : null,
  };
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

  await verifyReadonlyBypasses(server, driver, id, engine, table);

  await callTool(server, 'sql_execute', {
    connection_id: id,
    sql: sql.update,
    params: [11, 1],
  });
  await callTool(server, 'sql_execute', {
    connection_id: id,
    sql: sql.insert,
    params: [4, 'delete', 40],
  });
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

  await callTool(server, 'sql_create_index', {
    connection_id: id,
    table,
    columns: ['score'],
    indexName: index,
  });
  const indexes = await callTool(server, 'sql_list_indexes', { connection_id: id, table });
  assert.ok(Array.isArray(indexes.value.indexes), `${engine} index listing is not an array`);

  await callTool(server, 'sql_execute', { connection_id: id, sql: sql.createView });
  const views = await callTool(server, 'sql_list_views', { connection_id: id });
  assert.ok(Array.isArray(views.value.views), `${engine} view listing is not an array`);
  await callTool(server, 'sql_describe_view', { connection_id: id, view });

  const tables = await callTool(server, 'sql_list_tables', { connection_id: id });
  assert.ok(Array.isArray(tables.value.tables), `${engine} table listing is not an array`);
  const described = await callTool(server, 'sql_describe_table', { connection_id: id, table });
  assert.ok(described.value.columns?.length >= 3, `${engine} table description missed columns`);
  await callTool(server, 'sql_generate_types', { connection_id: id, table });
  await callTool(server, 'sql_sample_table', {
    connection_id: id,
    table,
    sample_size: 10,
  });

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
  const optimized = await callTool(server, 'query_optimize', {
    connectionId: id,
    sql: sql.selectAll,
  });
  assert.ok(
    Array.isArray(optimized.value.suggestions),
    `${engine} query_optimize returned no suggestions`,
  );

  const schemaJson = await callTool(server, 'schema_export', {
    connection_id: id,
    format: 'json',
  });
  assert.ok(schemaJson.value.table_count >= 1, `${engine} schema export returned no tables`);
  const schemaSql = await callTool(server, 'schema_export', {
    connection_id: id,
    format: 'sql',
  });
  assert.match(
    String(schemaSql.value),
    /CREATE TABLE/i,
    `${engine} DDL export returned no CREATE TABLE`,
  );

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
    document_json: JSON.stringify({ id: 1, name: 'alpha', group: 'a', score: 10 }),
  });
  await callTool(server, 'mongo_insert_many', {
    connection_id: id,
    collection,
    documents_json: JSON.stringify([
      { id: 2, name: 'beta', group: 'a', score: 20 },
      { id: 3, name: 'gamma', group: 'b', score: 30 },
    ]),
  });
  await callTool(server, 'mongo_find', {
    connection_id: id,
    collection,
    filter_json: JSON.stringify({ group: 'a' }),
    limit: 10,
  });
  await callTool(server, 'mongo_count', { connection_id: id, collection });
  await callTool(server, 'mongo_aggregate', {
    connection_id: id,
    collection,
    pipeline_json: JSON.stringify([{ $group: { _id: '$group', total: { $sum: '$score' } } }]),
  });
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
  await callTool(server, 'mongo_create_index', {
    connection_id: id,
    collection,
    keys_json: JSON.stringify({ score: 1 }),
    name: `ri_mongo_${suffix}`,
    sparse: false,
  });
  await callTool(server, 'mongo_list_indexes', { connection_id: id, collection });
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
      { command: 'hgetall', key: key('pipeline:hash') },
      { command: 'hdel', key: key('pipeline:hash'), args: ['f'] },
      { command: 'lpush', key: key('pipeline:list'), args: ['b', 'a'] },
      { command: 'rpush', key: key('pipeline:list'), args: ['c', 'd'] },
      { command: 'lrange', key: key('pipeline:list'), args: [0, -1] },
      { command: 'llen', key: key('pipeline:list') },
      { command: 'lpop', key: key('pipeline:list') },
      { command: 'rpop', key: key('pipeline:list') },
      { command: 'sadd', key: key('pipeline:set'), args: ['a', 'b'] },
      { command: 'smembers', key: key('pipeline:set') },
      { command: 'scard', key: key('pipeline:set') },
      { command: 'sismember', key: key('pipeline:set'), args: ['a'] },
      { command: 'srem', key: key('pipeline:set'), args: ['b'] },
      { command: 'zadd', key: key('pipeline:zset'), args: [1, 'a'] },
      { command: 'zrange', key: key('pipeline:zset'), args: [0, -1, true] },
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

  const registry = await createRegistryFromEnv();
  try {
    const ids = connectionIdsByEngine(registry);
    const pings = await pingAll(registry);
    for (const ping of pings) {
      assert.equal(ping.ok, true, `${ping.id} ping failed: ${ping.error ?? ''}`);
    }

    const server = new ToolCollector();
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
