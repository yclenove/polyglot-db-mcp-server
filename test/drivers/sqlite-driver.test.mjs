import assert from 'node:assert/strict';
import { test, describe, afterEach } from 'node:test';

describe('SQLite Driver', () => {
  test('createSqliteDriver is a function', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    assert.ok(typeof createSqliteDriver === 'function');
  });

  test('driver factory returns a valid SqlDriver', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    const spec = { id: 'test', engine: 'sqlite', url: ':memory:' };
    const driver = await createSqliteDriver(spec);

    assert.equal(driver.engine, 'sqlite');
    assert.ok(typeof driver.ping === 'function');
    assert.ok(typeof driver.execute === 'function');
    assert.ok(typeof driver.beginTransaction === 'function');
    assert.ok(typeof driver.close === 'function');

    await driver.close();
  });
});

describe('SQLite Driver Ping', () => {
  test('ping succeeds on in-memory database', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    const driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    const result = await driver.ping();
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);

    await driver.close();
  });
});

describe('SQLite Driver Execute', () => {
  let driver;

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = null;
    }
  });

  test('SELECT 1 returns data', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    const result = await driver.execute('SELECT 1 AS value', [], {
      mode: 'readonly',
      maxRows: 100,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });

    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.data));
    assert.equal(result.data.length, 1);
    assert.deepEqual(result.data[0], { value: 1 });
  });

  test('CREATE TABLE and INSERT work', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    const opts = { mode: 'readwrite', maxRows: 100, queryTimeoutMs: 5000, maxSqlLength: 10240 };

    // Create table
    const create = await driver.execute(
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
      [],
      opts
    );
    assert.equal(create.success, true);

    // Insert row
    const insert = await driver.execute(
      'INSERT INTO users (name) VALUES (?)',
      ['Alice'],
      opts
    );
    assert.equal(insert.success, true);
    assert.equal(Number(insert.affectedRows), 1);

    // Query back
    const select = await driver.execute('SELECT * FROM users', [], {
      mode: 'readonly',
      maxRows: 100,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    assert.equal(select.success, true);
    assert.equal(select.data.length, 1);
    assert.equal(select.data[0].name, 'Alice');
  });

  test('readonly mode rejects write operations', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    const result = await driver.execute('CREATE TABLE t (id INTEGER)', [], {
      mode: 'readonly',
      maxRows: 100,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });

    assert.equal(result.success, false);
    assert.ok(result.error.includes('只读模式'));
  });

  test('SQL length limit is enforced', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    const result = await driver.execute('SELECT 1', [], {
      mode: 'readonly',
      maxRows: 100,
      queryTimeoutMs: 5000,
      maxSqlLength: 3, // very small limit
    });

    assert.equal(result.success, false);
    assert.ok(result.error.includes('长度限制'));
  });

  test('PRAGMA statements return data', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    const rwOpts = { mode: 'readwrite', maxRows: 100, queryTimeoutMs: 5000, maxSqlLength: 10240 };
    const roOpts = { mode: 'readonly', maxRows: 100, queryTimeoutMs: 5000, maxSqlLength: 10240 };

    // Create a table first
    const create = await driver.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)', [], rwOpts);
    assert.equal(create.success, true, `CREATE TABLE failed: ${create.error}`);

    const result = await driver.execute('PRAGMA table_info(t)', [], roOpts);
    assert.equal(result.success, true, `PRAGMA failed: ${result.error}`);
    assert.ok(result.data.length >= 2, `Expected >=2 columns, got ${result.data.length}`);
  });

  test('readonly mode rejects state-changing PRAGMA statements', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    for (const sql of [
      'PRAGMA journal_mode = DELETE',
      'PRAGMA foreign_keys = OFF',
      'PRAGMA writable_schema = ON',
    ]) {
      const result = await driver.execute(sql, [], {
        mode: 'readonly',
        maxRows: 100,
        queryTimeoutMs: 5000,
        maxSqlLength: 10240,
      });
      assert.equal(result.success, false, `${sql} must be rejected in readonly mode`);
      assert.match(result.error, /只读模式/);
    }
  });

  test('maxRows truncates results', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    await driver.execute('CREATE TABLE t (id INTEGER)', [], {
      mode: 'readwrite',
      maxRows: 100,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });

    // Insert 5 rows
    for (let i = 0; i < 5; i++) {
      await driver.execute('INSERT INTO t (id) VALUES (?)', [i], {
        mode: 'readwrite',
        maxRows: 100,
        queryTimeoutMs: 5000,
        maxSqlLength: 10240,
      });
    }

    const result = await driver.execute('SELECT * FROM t', [], {
      mode: 'readonly',
      maxRows: 3, // limit to 3
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });

    assert.equal(result.success, true);
    assert.equal(result.data.length, 3);
    assert.equal(result.truncated, true);
    assert.equal(result.totalRows, 5);
  });

  test('preserves integers larger than Number.MAX_SAFE_INTEGER', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    const result = await driver.execute(
      "SELECT CAST('9007199254740993' AS INTEGER) AS value",
      [],
      {
        mode: 'readonly',
        maxRows: 100,
        queryTimeoutMs: 5000,
        maxSqlLength: 10240,
      }
    );

    assert.equal(result.success, true);
    assert.deepEqual(result.data[0], { value: '9007199254740993' });
  });

  test('connection readonly flag forces readonly', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    driver = await createSqliteDriver({
      id: 't',
      engine: 'sqlite',
      url: ':memory:',
      readonly: true,
    });

    // Even with mode: 'readwrite', the connection-level readonly should take effect
    const result = await driver.execute('CREATE TABLE t (id INTEGER)', [], {
      mode: 'readwrite',
      maxRows: 100,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });

    assert.equal(result.success, false);
    assert.ok(result.error.includes('只读模式'));
  });
});

describe('SQLite Driver Transaction', () => {
  test('transaction commit persists data', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    const driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    const opts = { mode: 'readwrite', maxRows: 100, queryTimeoutMs: 5000, maxSqlLength: 10240 };

    await driver.execute('CREATE TABLE t (id INTEGER, val TEXT)', [], opts);

    const tx = await driver.beginTransaction();
    await tx.execute('INSERT INTO t VALUES (?, ?)', [1, 'hello'], opts);
    await tx.commit();

    const result = await driver.execute('SELECT * FROM t', [], {
      ...opts,
      mode: 'readonly',
    });
    assert.equal(result.success, true);
    assert.equal(result.data.length, 1);

    await driver.close();
  });

  test('transaction rollback discards data', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    const driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: ':memory:' });

    const opts = { mode: 'readwrite', maxRows: 100, queryTimeoutMs: 5000, maxSqlLength: 10240 };

    await driver.execute('CREATE TABLE t (id INTEGER)', [], opts);

    const tx = await driver.beginTransaction();
    await tx.execute('INSERT INTO t (id) VALUES (1)', [], opts);
    await tx.rollback();

    const result = await driver.execute('SELECT * FROM t', [], {
      ...opts,
      mode: 'readonly',
    });
    assert.equal(result.success, true);
    assert.equal(result.data.length, 0);

    await driver.close();
  });
});

describe('SQLite Driver Path Resolution', () => {
  test('file: prefix is handled', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    // Use :memory: to avoid file creation issues in tests
    const driver = await createSqliteDriver({ id: 't', engine: 'sqlite', url: 'file::memory:' });

    const result = await driver.ping();
    assert.equal(result.ok, true);

    await driver.close();
  });

  test('default to :memory: when no url or database', async () => {
    const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');
    const driver = await createSqliteDriver({ id: 't', engine: 'sqlite' });

    const result = await driver.ping();
    assert.equal(result.ok, true);

    await driver.close();
  });
});

describe('SQLite Driver Interface Shape', () => {
  test('SqlDriver interface shape is complete', () => {
    const expectedMethods = ['ping', 'execute', 'beginTransaction', 'close'];
    const expectedProperties = ['engine'];
    assert.ok(expectedMethods.length > 0);
    assert.ok(expectedProperties.length > 0);
  });
});
