import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { checkTestEnv, TEST_CONNECTIONS } from '../helpers/test-config.mjs';

const SKIP_REASON = 'PostgreSQL 测试环境不可用（需要 Docker: docker compose up -d）';

describe('PostgreSQL Integration', () => {
  let driver;
  let isAvailable = false;

  before(async () => {
    isAvailable = await checkTestEnv('postgres');
    if (!isAvailable) return;

    const { createPostgresDriver } = await import('../../dist/drivers/sql/postgres-driver.js');
    driver = await createPostgresDriver(TEST_CONNECTIONS.postgres);
  });

  after(async () => {
    if (driver) await driver.close();
  });

  function integrationTest(name, handler) {
    test(name, async (t) => {
      if (!isAvailable) {
        t.skip(SKIP_REASON);
        return;
      }
      await handler();
    });
  }

  integrationTest('ping succeeds', async () => {
    const result = await driver.ping();
    assert.equal(result.ok, true);
  });

  integrationTest('execute SELECT 1', async () => {
    const result = await driver.execute('SELECT 1 AS val', [], {
      mode: 'readonly',
      maxRows: 10,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.data));
  });

  integrationTest('execute with parameters', async () => {
    const result = await driver.execute('SELECT $1::int AS val', [42], {
      mode: 'readonly',
      maxRows: 10,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.data));
  });

  integrationTest('bounded cursor reads support parameters and connection reuse', async () => {
    const options = {
      mode: 'readonly',
      maxRows: 2,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    };
    const result = await driver.execute(
      'SELECT value FROM generate_series(1, $1::int) AS value ORDER BY value',
      [100000],
      options,
    );
    assert.equal(result.success, true, result.error);
    assert.equal(result.data.length, 2);
    assert.equal(result.totalRows, 3);
    assert.equal(result.totalRowsExact, false);
    assert.equal(result.truncated, true);

    const followUp = await driver.execute('SELECT 42 AS value', [], options);
    assert.equal(followUp.success, true, followUp.error);
    assert.equal(followUp.data[0].value, 42);
  });

  integrationTest('byte-bounded cursor reads skip oversized rows', async () => {
    const options = {
      mode: 'readonly',
      maxRows: 10,
      maxBytes: 1024,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    };
    const result = await driver.execute(
      `SELECT 1 AS id, 'ok' AS value
       UNION ALL SELECT 2, repeat('x', 200000)
       UNION ALL SELECT 3, 'unread' ORDER BY id`,
      [],
      options,
    );
    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.data, [{ id: 1, value: 'ok' }]);
    assert.equal(result.truncatedBy, 'bytes');
    assert.ok(result.returnedBytes <= 1024);

    const followUp = await driver.execute('SELECT 42 AS value', [], options);
    assert.equal(followUp.success, true, followUp.error);
    assert.equal(followUp.data[0].value, 42);
  });

  integrationTest('bounded cursor reads keep transactions reusable', async () => {
    const tx = await driver.beginTransaction();
    try {
      const truncated = await tx.execute(
        'SELECT value FROM generate_series(1, 1000) AS value ORDER BY value',
        [],
        {
          mode: 'readonly',
          maxRows: 2,
          queryTimeoutMs: 5000,
          maxSqlLength: 10240,
        },
      );
      assert.equal(truncated.success, true, truncated.error);
      assert.equal(truncated.totalRows, 3);

      const followUp = await tx.execute('SELECT 7 AS value', [], {
        mode: 'readonly',
        maxRows: 10,
        queryTimeoutMs: 5000,
        maxSqlLength: 10240,
      });
      assert.equal(followUp.success, true, followUp.error);
      assert.equal(followUp.data[0].value, 7);
    } finally {
      await tx.rollback();
    }
  });

  integrationTest('readonly mode blocks INSERT', async () => {
    const result = await driver.execute('INSERT INTO nonexistent VALUES (1)', [], {
      mode: 'readonly',
      maxRows: 10,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  integrationTest('SQL length limit enforced', async () => {
    const longSql = 'SELECT ' + 'x'.repeat(100000);
    const result = await driver.execute(longSql, [], {
      mode: 'readonly',
      maxRows: 10,
      queryTimeoutMs: 5000,
      maxSqlLength: 100,
    });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('长度限制'));
  });

  integrationTest('beginTransaction returns transaction object', async () => {
    const tx = await driver.beginTransaction();
    assert.ok(typeof tx.execute === 'function');
    assert.ok(typeof tx.commit === 'function');
    assert.ok(typeof tx.rollback === 'function');
    await tx.rollback();
  });

  integrationTest('transaction commit and rollback', async () => {
    // Rollback test
    const tx = await driver.beginTransaction();
    const result = await tx.execute('SELECT $1::text AS greeting', ['hello'], {
      mode: 'readonly',
      maxRows: 10,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    assert.equal(result.success, true);
    await tx.rollback();
  });

  integrationTest('returns field metadata', async () => {
    const result = await driver.execute("SELECT 1 AS id, 'test' AS name", [], {
      mode: 'readonly',
      maxRows: 10,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    if (result.fields) {
      assert.ok(Array.isArray(result.fields));
    }
  });
});
