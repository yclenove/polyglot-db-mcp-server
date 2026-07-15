import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { checkTestEnv, TEST_CONNECTIONS } from '../helpers/test-config.mjs';

const SKIP_REASON = 'MySQL 测试环境不可用（需要 Docker: docker compose up -d）';

describe('MySQL Integration', () => {
  let driver;
  let isAvailable = false;

  before(async () => {
    isAvailable = await checkTestEnv('mysql');
    if (!isAvailable) return;

    const { createMysqlDriver } = await import('../../dist/drivers/sql/mysql-driver.js');
    driver = await createMysqlDriver(TEST_CONNECTIONS.mysql);
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

  integrationTest('bounded reads support parameters and connection reuse', async () => {
    const query = `WITH RECURSIVE seq(n) AS (
      SELECT 1
      UNION ALL
      SELECT n + 1 FROM seq WHERE n < ?
    ) SELECT n FROM seq ORDER BY n`;
    const result = await driver.execute(query, [100], {
      mode: 'readonly',
      maxRows: 2,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    assert.equal(result.success, true, result.error);
    assert.equal(result.data.length, 2);
    assert.equal(result.totalRows, 3);
    assert.equal(result.totalRowsExact, false);
    assert.equal(result.truncated, true);

    const followUp = await driver.execute(query, [5], {
      mode: 'readonly',
      maxRows: 10,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    assert.equal(followUp.success, true, followUp.error);
    assert.equal(followUp.data.length, 5);
    assert.equal(followUp.totalRowsExact, true);
  });

  integrationTest('bounded reads reset the session limit inside transactions', async () => {
    const tx = await driver.beginTransaction();
    const query = `WITH RECURSIVE seq(n) AS (
      SELECT 1
      UNION ALL
      SELECT n + 1 FROM seq WHERE n < 5
    ) SELECT n FROM seq ORDER BY n`;
    try {
      const truncated = await tx.execute(query, [], {
        mode: 'readonly',
        maxRows: 2,
        queryTimeoutMs: 5000,
        maxSqlLength: 10240,
      });
      assert.equal(truncated.success, true, truncated.error);
      assert.equal(truncated.totalRows, 3);

      const followUp = await tx.execute(query, [], {
        mode: 'readonly',
        maxRows: 10,
        queryTimeoutMs: 5000,
        maxSqlLength: 10240,
      });
      assert.equal(followUp.success, true, followUp.error);
      assert.equal(followUp.data.length, 5);
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

  integrationTest('transaction rollback works', async () => {
    const tx = await driver.beginTransaction();
    // Execute a safe query in transaction
    const result = await tx.execute('SELECT 1 AS val', [], {
      mode: 'readonly',
      maxRows: 10,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    assert.equal(result.success, true);
    await tx.rollback();
  });
});
