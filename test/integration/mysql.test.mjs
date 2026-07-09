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

  test('ping succeeds', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const result = await driver.ping();
    assert.equal(result.ok, true);
  });

  test('execute SELECT 1', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const result = await driver.execute('SELECT 1 AS val', [], {
      mode: 'readonly',
      maxRows: 10,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.data));
  });

  test('readonly mode blocks INSERT', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const result = await driver.execute('INSERT INTO nonexistent VALUES (1)', [], {
      mode: 'readonly',
      maxRows: 10,
      queryTimeoutMs: 5000,
      maxSqlLength: 10240,
    });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  test('SQL length limit enforced', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
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

  test('beginTransaction returns transaction object', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
    const tx = await driver.beginTransaction();
    assert.ok(typeof tx.execute === 'function');
    assert.ok(typeof tx.commit === 'function');
    assert.ok(typeof tx.rollback === 'function');
    await tx.rollback();
  });

  test('transaction rollback works', async () => {
    if (!isAvailable) {
      console.log(`SKIP: ${SKIP_REASON}`);
      return;
    }
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
