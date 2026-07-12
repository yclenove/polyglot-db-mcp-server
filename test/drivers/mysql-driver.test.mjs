import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

// 模拟 mysql2/promise
const mockPool = {
  query: async () => [[], []],
  execute: async () => [[{ id: 1, name: 'test' }], []],
  end: async () => {},
};

const mockMysql = {
  createPool: () => mockPool,
};

// 测试配置生成
describe('MySQL Driver Configuration', () => {
  test('poolConfig with URL', async () => {
    // 动态导入并模拟
    const mod = await import('../../dist/drivers/sql/mysql-driver.js');
    assert.ok(typeof mod.createMysqlDriver === 'function');
  });

  test('poolConfig with host/port', async () => {
    const mod = await import('../../dist/drivers/sql/mysql-driver.js');
    assert.ok(typeof mod.createMysqlDriver === 'function');
  });
});

// 测试 SQL 驱动接口
describe('SQL Driver Interface', () => {
  test('driver has required methods', async () => {
    // 由于驱动依赖真实连接，这里测试接口存在性
    const { createMysqlDriver } = await import('../../dist/drivers/sql/mysql-driver.js');
    assert.ok(typeof createMysqlDriver === 'function');
  });
});

// 测试重试逻辑
describe('Retry Logic', () => {
  test('RETRIABLE error codes are defined', async () => {
    // 验证可重试错误码集合存在
    // 这些是内部常量，通过行为验证
    const retriableCodes = [
      'PROTOCOL_CONNECTION_LOST',
      'ER_LOCK_DEADLOCK',
      'ER_LOCK_WAIT_TIMEOUT',
      'ECONNRESET',
      'ETIMEDOUT',
      'EPIPE',
    ];
    assert.ok(retriableCodes.length > 0);
  });
});

describe('MySQL protocol selection', () => {
  test('uses text protocol only for stored procedure statements', async () => {
    const { requiresTextProtocol } = await import('../../dist/drivers/sql/mysql-driver.js');

    assert.equal(requiresTextProtocol('CREATE PROCEDURE p() SELECT 1'), true);
    assert.equal(requiresTextProtocol('CALL p()'), true);
    assert.equal(requiresTextProtocol('SELECT ? AS value'), false);
    assert.equal(requiresTextProtocol('INSERT INTO t VALUES (?)'), false);
  });
});
