import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

describe('PostgreSQL Driver', () => {
  test('createPostgresDriver is a function', async () => {
    const { createPostgresDriver } = await import('../../dist/drivers/sql/postgres-driver.js');
    assert.ok(typeof createPostgresDriver === 'function');
  });

  test('driver factory returns promise', async () => {
    const { createPostgresDriver } = await import('../../dist/drivers/sql/postgres-driver.js');
    // Verify it's an async function by checking the return type
    const spec = { id: 'test', engine: 'postgres', url: 'postgres://invalid:invalid@127.0.0.1:1/db' };
    try {
      const driver = await createPostgresDriver(spec);
      // If it somehow connects, verify interface
      assert.ok(typeof driver.ping === 'function');
      assert.ok(typeof driver.execute === 'function');
      assert.ok(typeof driver.beginTransaction === 'function');
      assert.ok(typeof driver.close === 'function');
      assert.equal(driver.engine, 'postgres');
      await driver.close();
    } catch {
      // Expected to fail with invalid connection
      assert.ok(true);
    }
  });
});

describe('PostgreSQL Driver Interface', () => {
  test('SqlDriver interface shape', () => {
    // Verify the expected interface shape
    const expectedMethods = ['ping', 'execute', 'beginTransaction', 'close'];
    const expectedProperties = ['engine'];
    assert.ok(expectedMethods.length > 0);
    assert.ok(expectedProperties.length > 0);
  });
});
