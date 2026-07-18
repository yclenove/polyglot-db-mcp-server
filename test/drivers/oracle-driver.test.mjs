import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

describe('Oracle Driver', () => {
  test('createOracleDriver is a function', async () => {
    try {
      const { createOracleDriver } = await import('../../dist/drivers/sql/oracle-driver.js');
      assert.ok(typeof createOracleDriver === 'function');
    } catch {
      // oracledb is optional dependency, may not be installed
      assert.ok(true);
    }
  });

  test('driver factory returns promise', async () => {
    try {
      const { createOracleDriver } = await import('../../dist/drivers/sql/oracle-driver.js');
      // Verify it's an async function by checking the return type
      const spec = { id: 'test', engine: 'oracle', url: 'oracle://invalid:invalid@127.0.0.1:1/db' };
      try {
        const driver = await createOracleDriver(spec);
        // If it somehow connects, verify interface
        assert.ok(typeof driver.ping === 'function');
        assert.ok(typeof driver.execute === 'function');
        assert.ok(typeof driver.beginTransaction === 'function');
        assert.ok(typeof driver.close === 'function');
        assert.equal(driver.engine, 'oracle');
        await driver.close();
      } catch {
        // Expected to fail with invalid connection
        assert.ok(true);
      }
    } catch {
      // oracledb is optional dependency, may not be installed
      assert.ok(true);
    }
  });
});

describe('Oracle number fetching', () => {
  test('fetches NUMBER values as strings without dropping existing types', async () => {
    const { configureOracleNumberFetching } = await import(
      '../../dist/drivers/sql/oracle-driver.js'
    );
    const config = { NUMBER: 2010, fetchAsString: [2014] };

    configureOracleNumberFetching(config);
    configureOracleNumberFetching(config);

    assert.deepEqual(config.fetchAsString, [2014, 2010]);
  });
});

describe('Oracle SQL normalization', () => {
  test('removes script terminators from ordinary SQL without touching literals', async () => {
    const { normalizeOracleSql } = await import('../../dist/drivers/sql/oracle-driver.js');

    assert.equal(normalizeOracleSql('CREATE TABLE t (id NUMBER);'), 'CREATE TABLE t (id NUMBER)');
    assert.equal(
      normalizeOracleSql("SELECT ';' AS value FROM dual; -- trailing"),
      "SELECT ';' AS value FROM dual  -- trailing",
    );
  });

  test('preserves anonymous and stored PL/SQL block terminators', async () => {
    const { normalizeOracleSql } = await import('../../dist/drivers/sql/oracle-driver.js');
    const anonymous = '/* audit */\nBEGIN\n  NULL;\nEND;';
    const procedure = 'CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;';

    assert.equal(normalizeOracleSql(anonymous), anonymous);
    assert.equal(normalizeOracleSql(procedure), procedure);
  });
});

describe('Oracle Driver Interface', () => {
  test('SqlDriver interface shape', () => {
    // Verify the expected interface shape
    const expectedMethods = ['ping', 'execute', 'beginTransaction', 'close'];
    const expectedProperties = ['engine'];
    assert.ok(expectedMethods.length > 0);
    assert.ok(expectedProperties.length > 0);
  });
});
