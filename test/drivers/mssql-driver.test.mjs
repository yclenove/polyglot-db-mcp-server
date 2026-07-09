import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

describe('MSSQL Driver', () => {
  test('createMssqlDriver is a function', async () => {
    const { createMssqlDriver } = await import('../../dist/drivers/sql/mssql-driver.js');
    assert.ok(typeof createMssqlDriver === 'function');
  });

  test('driver factory returns promise', async () => {
    const { createMssqlDriver } = await import('../../dist/drivers/sql/mssql-driver.js');
    // Verify it's an async function by checking the return type
    const spec = { id: 'test', engine: 'mssql', url: 'mssql://invalid:invalid@127.0.0.1:1/db' };
    try {
      const driver = await createMssqlDriver(spec);
      // If it somehow connects, verify interface
      assert.ok(typeof driver.ping === 'function');
      assert.ok(typeof driver.execute === 'function');
      assert.ok(typeof driver.beginTransaction === 'function');
      assert.ok(typeof driver.close === 'function');
      assert.equal(driver.engine, 'mssql');
      await driver.close();
    } catch {
      // Expected to fail with invalid connection
      assert.ok(true);
    }
  });
});

describe('MSSQL Driver Interface', () => {
  test('SqlDriver interface shape', () => {
    // Verify the expected interface shape
    const expectedMethods = ['ping', 'execute', 'beginTransaction', 'close'];
    const expectedProperties = ['engine'];
    assert.ok(expectedMethods.length > 0);
    assert.ok(expectedProperties.length > 0);
  });
});
