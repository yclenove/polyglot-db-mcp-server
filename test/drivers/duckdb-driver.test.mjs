import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, describe, afterEach } from 'node:test';

const RW_OPTS = {
  mode: 'readwrite',
  maxRows: 100,
  queryTimeoutMs: 5000,
  maxSqlLength: 10240,
};

const RO_OPTS = {
  ...RW_OPTS,
  mode: 'readonly',
};

describe('DuckDB Driver', () => {
  let driver;

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = null;
    }
  });

  test('createDuckDbDriver is a function', async () => {
    const { createDuckDbDriver } = await import('../../dist/drivers/sql/duckdb-driver.js');
    assert.equal(typeof createDuckDbDriver, 'function');
  });

  test('driver factory returns a valid readonly SqlDriver by default', async () => {
    const { createDuckDbDriver } = await import('../../dist/drivers/sql/duckdb-driver.js');
    driver = await createDuckDbDriver({ id: 'duck', engine: 'duckdb', url: ':memory:' });

    assert.equal(driver.engine, 'duckdb');
    assert.equal(typeof driver.ping, 'function');
    assert.equal(typeof driver.execute, 'function');
    assert.equal(typeof driver.beginTransaction, 'function');
    assert.equal(typeof driver.close, 'function');

    const ping = await driver.ping();
    assert.equal(ping.ok, true);
  });

  test('SELECT returns rows', async () => {
    const { createDuckDbDriver } = await import('../../dist/drivers/sql/duckdb-driver.js');
    driver = await createDuckDbDriver({ id: 'duck', engine: 'duckdb', url: ':memory:' });

    const result = await driver.execute('SELECT 1 AS value, ? AS label', ['ok'], RO_OPTS);
    assert.equal(result.success, true);
    assert.deepEqual(result.data, [{ value: 1, label: 'ok' }]);
  });

  test('readonly default rejects writes even when caller asks for readwrite', async () => {
    const { createDuckDbDriver } = await import('../../dist/drivers/sql/duckdb-driver.js');
    driver = await createDuckDbDriver({ id: 'duck', engine: 'duckdb', url: ':memory:' });

    const result = await driver.execute('CREATE TABLE t (id INTEGER)', [], RW_OPTS);
    assert.equal(result.success, false);
    assert.match(result.error, /只读模式/);
  });

  test('explicit readonly false allows writes and row reads', async () => {
    const { createDuckDbDriver } = await import('../../dist/drivers/sql/duckdb-driver.js');
    driver = await createDuckDbDriver({
      id: 'duck',
      engine: 'duckdb',
      url: ':memory:',
      readonly: false,
    });

    const create = await driver.execute('CREATE TABLE t (id INTEGER, name VARCHAR)', [], RW_OPTS);
    assert.equal(create.success, true, create.error);

    const insert = await driver.execute('INSERT INTO t VALUES (?, ?)', [1, 'Alice'], RW_OPTS);
    assert.equal(insert.success, true, insert.error);
    assert.equal(insert.affectedRows, 1);

    const select = await driver.execute('SELECT * FROM t ORDER BY id', [], RO_OPTS);
    assert.equal(select.success, true, select.error);
    assert.deepEqual(select.data, [{ id: 1, name: 'Alice' }]);
  });

  test('maxRows truncates results', async () => {
    const { createDuckDbDriver } = await import('../../dist/drivers/sql/duckdb-driver.js');
    driver = await createDuckDbDriver({ id: 'duck', engine: 'duckdb', url: ':memory:' });

    const result = await driver.execute(
      'SELECT * FROM (VALUES (1), (2), (3)) AS t(id) ORDER BY id',
      [],
      { ...RO_OPTS, maxRows: 2 },
    );

    assert.equal(result.success, true, result.error);
    assert.equal(result.data.length, 2);
    assert.equal(result.totalRows, 3);
    assert.equal(result.truncated, true);
  });

  test('large readonly queries use bounded streaming reads', async () => {
    const { createDuckDbDriver } = await import('../../dist/drivers/sql/duckdb-driver.js');
    driver = await createDuckDbDriver({ id: 'duck', engine: 'duckdb', url: ':memory:' });

    const result = await driver.execute('SELECT range AS id FROM range(100000)', [], {
      ...RO_OPTS,
      maxRows: 2,
    });

    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.data, [{ id: '0' }, { id: '1' }]);
    assert.equal(result.truncated, true);
    assert.equal(result.totalRowsExact, false);
    assert.ok(result.totalRows < 100000, `expected bounded read, observed ${result.totalRows}`);

    const followUp = await driver.execute('SELECT 42 AS value', [], RO_OPTS);
    assert.equal(followUp.success, true, followUp.error);
    assert.deepEqual(followUp.data, [{ value: 42 }]);
  });

  test('read_csv_auto can read files inside allowlist', async () => {
    const { createDuckDbDriver } = await import('../../dist/drivers/sql/duckdb-driver.js');
    const dir = await mkdtemp(join(tmpdir(), 'duckdb-allow-'));
    const csv = join(dir, 'sample.csv');
    await writeFile(csv, 'id,name\n1,Alice\n', 'utf8');

    driver = await createDuckDbDriver({
      id: 'duck',
      engine: 'duckdb',
      url: ':memory:',
      allowlist: [dir],
    });

    const safePath = csv.replace(/\\/g, '/').replace(/'/g, "''");
    const result = await driver.execute(
      `SELECT * FROM read_csv_auto('${safePath}')`,
      [],
      RO_OPTS,
    );

    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.data, [{ id: '1', name: 'Alice' }]);
  });

  test('external file reads outside allowlist are denied by DuckDB', async () => {
    const { createDuckDbDriver } = await import('../../dist/drivers/sql/duckdb-driver.js');
    const allowedDir = await mkdtemp(join(tmpdir(), 'duckdb-allowed-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'duckdb-outside-'));
    const csv = join(outsideDir, 'sample.csv');
    await writeFile(csv, 'id\n1\n', 'utf8');

    driver = await createDuckDbDriver({
      id: 'duck',
      engine: 'duckdb',
      url: ':memory:',
      allowlist: [allowedDir],
    });

    const unsafePath = csv.replace(/\\/g, '/').replace(/'/g, "''");
    const result = await driver.execute(
      `SELECT * FROM read_csv_auto('${unsafePath}')`,
      [],
      RO_OPTS,
    );

    assert.equal(result.success, false);
    assert.match(result.error, /Cannot access file|disabled by configuration|Permission/i);
  });
});
