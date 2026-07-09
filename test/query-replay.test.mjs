import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  QueryHistory,
  getGlobalQueryHistory,
  resetGlobalQueryHistory,
} from '../dist/core/query-replay.js';

// ── QueryHistory 基础操作 ──────────────────────────────────────

describe('QueryHistory', () => {
  test('starts empty', () => {
    const history = new QueryHistory(10);
    assert.equal(history.size, 0);
    assert.equal(history.capacity, 10);
    assert.deepStrictEqual(history.list(), []);
  });

  test('push adds a record with auto-generated id and timestamp', () => {
    const history = new QueryHistory(10);
    const record = history.push({
      connectionId: 'test_conn',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: { rowCount: 1, fields: ['id'], sampleRows: [{ id: 1 }] },
      executionTime: 42,
      success: true,
    });
    assert.ok(record.id);
    assert.ok(record.timestamp);
    assert.equal(record.connectionId, 'test_conn');
    assert.equal(record.engine, 'mysql');
    assert.equal(record.sql, 'SELECT 1');
    assert.equal(record.executionTime, 42);
    assert.equal(record.success, true);
  });

  test('size increases after push', () => {
    const history = new QueryHistory(10);
    history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    assert.equal(history.size, 1);
  });

  test('getById returns the correct record', () => {
    const history = new QueryHistory(10);
    const r1 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    const r2 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 2',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 20,
      success: true,
    });

    const found = history.getById(r1.id);
    assert.ok(found);
    assert.equal(found.sql, 'SELECT 1');

    const found2 = history.getById(r2.id);
    assert.ok(found2);
    assert.equal(found2.sql, 'SELECT 2');
  });

  test('getById returns undefined for non-existent id', () => {
    const history = new QueryHistory(10);
    assert.equal(history.getById('999'), undefined);
  });

  test('list returns records in order', () => {
    const history = new QueryHistory(10);
    history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'first',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'second',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 20,
      success: true,
    });

    const all = history.list();
    assert.equal(all[0].sql, 'first');
    assert.equal(all[1].sql, 'second');
  });

  test('list respects limit', () => {
    const history = new QueryHistory(100);
    for (let i = 0; i < 10; i++) {
      history.push({
        connectionId: 'c1',
        engine: 'mysql',
        sql: `SELECT ${i}`,
        params: [],
        resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
        executionTime: 10,
        success: true,
      });
    }
    const limited = history.list(3);
    assert.equal(limited.length, 3);
  });
});

// ── 环形缓冲溢出 ──────────────────────────────────────────

describe('ring buffer overflow', () => {
  test('evicts oldest record when buffer is full', () => {
    const history = new QueryHistory(3);
    const r1 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'first',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'second',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'third',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'fourth',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });

    assert.equal(history.size, 3);
    assert.equal(history.getById(r1.id), undefined);
    assert.ok(history.getById('2'));
    assert.ok(history.getById('3'));
    assert.ok(history.getById('4'));
  });
});

// ── diff 功能 ──────────────────────────────────────────

describe('QueryHistory.diff', () => {
  test('detects added rows', () => {
    const history = new QueryHistory(10);
    const r1 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: {
        rowCount: 1,
        fields: ['id'],
        sampleRows: [{ id: 1 }],
      },
      executionTime: 10,
      success: true,
    });
    const r2 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 2',
      params: [],
      resultSummary: {
        rowCount: 2,
        fields: ['id'],
        sampleRows: [{ id: 1 }, { id: 2 }],
      },
      executionTime: 20,
      success: true,
    });

    const diff = history.diff(r1.id, r2.id);
    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 0);
  });

  test('detects removed rows', () => {
    const history = new QueryHistory(10);
    const r1 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: {
        rowCount: 2,
        fields: ['id'],
        sampleRows: [{ id: 1 }, { id: 2 }],
      },
      executionTime: 10,
      success: true,
    });
    const r2 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 2',
      params: [],
      resultSummary: {
        rowCount: 1,
        fields: ['id'],
        sampleRows: [{ id: 1 }],
      },
      executionTime: 20,
      success: true,
    });

    const diff = history.diff(r1.id, r2.id);
    assert.equal(diff.added, 0);
    assert.equal(diff.removed, 1);
  });

  test('detects modified values', () => {
    const history = new QueryHistory(10);
    const r1 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: {
        rowCount: 1,
        fields: ['name'],
        sampleRows: [{ name: 'Alice' }],
      },
      executionTime: 10,
      success: true,
    });
    const r2 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 2',
      params: [],
      resultSummary: {
        rowCount: 1,
        fields: ['name'],
        sampleRows: [{ name: 'Bob' }],
      },
      executionTime: 20,
      success: true,
    });

    const diff = history.diff(r1.id, r2.id);
    assert.equal(diff.modified, 1);
    assert.equal(diff.details.length, 1);
    assert.equal(diff.details[0].field, '[0].name');
    assert.equal(diff.details[0].old, 'Alice');
    assert.equal(diff.details[0].new, 'Bob');
  });

  test('throws for non-existent id', () => {
    const history = new QueryHistory(10);
    history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });

    assert.throws(() => history.diff('1', '999'), /999.*不存在/);
    assert.throws(() => history.diff('999', '1'), /999.*不存在/);
  });

  test('returns zero diff for identical results', () => {
    const history = new QueryHistory(10);
    const r1 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: {
        rowCount: 1,
        fields: ['id'],
        sampleRows: [{ id: 1 }],
      },
      executionTime: 10,
      success: true,
    });
    const r2 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: {
        rowCount: 1,
        fields: ['id'],
        sampleRows: [{ id: 1 }],
      },
      executionTime: 15,
      success: true,
    });

    const diff = history.diff(r1.id, r2.id);
    assert.equal(diff.added, 0);
    assert.equal(diff.removed, 0);
    assert.equal(diff.modified, 0);
    assert.equal(diff.details.length, 0);
  });
});

// ── 全局单例 ──────────────────────────────────────────

describe('global history singleton', () => {
  test('getGlobalQueryHistory returns the same instance', () => {
    resetGlobalQueryHistory();
    const h1 = getGlobalQueryHistory();
    const h2 = getGlobalQueryHistory();
    assert.strictEqual(h1, h2);
  });

  test('resetGlobalQueryHistory creates a new instance', () => {
    const h1 = getGlobalQueryHistory();
    h1.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    resetGlobalQueryHistory();
    const h2 = getGlobalQueryHistory();
    assert.equal(h2.size, 0);
  });
});

// ── 参数记录 ──────────────────────────────────────────

describe('params recording', () => {
  test('stores query params', () => {
    const history = new QueryHistory(10);
    const record = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT * FROM users WHERE id = ?',
      params: [42],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    assert.deepStrictEqual(record.params, [42]);
  });

  test('handles empty params', () => {
    const history = new QueryHistory(10);
    const record = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    assert.deepStrictEqual(record.params, []);
  });
});

// ── ID 自增 ──────────────────────────────────────────

describe('auto-incrementing IDs', () => {
  test('IDs are sequential strings', () => {
    const history = new QueryHistory(100);
    const r1 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 1',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    const r2 = history.push({
      connectionId: 'c1',
      engine: 'mysql',
      sql: 'SELECT 2',
      params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10,
      success: true,
    });
    assert.equal(r1.id, '1');
    assert.equal(r2.id, '2');
  });
});

// ── 环形缓冲 O(1) 性能验证 ──────────────────────────────────

describe('ring buffer O(1) performance', () => {
  test('no Array.shift() — push beyond capacity is O(1)', () => {
    const history = new QueryHistory(100);
    // 填满缓冲区
    for (let i = 0; i < 100; i++) {
      history.push({
        connectionId: 'c1',
        engine: 'mysql',
        sql: `SELECT ${i}`,
        params: [],
        resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
        executionTime: 10,
        success: true,
      });
    }
    assert.equal(history.size, 100);

    // 再推入 50 条，触发环形覆盖（不使用 shift）
    for (let i = 100; i < 150; i++) {
      history.push({
        connectionId: 'c1',
        engine: 'mysql',
        sql: `SELECT ${i}`,
        params: [],
        resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
        executionTime: 10,
        success: true,
      });
    }
    assert.equal(history.size, 100);

    // 最旧的记录（id=1~50）应该被覆盖
    assert.equal(history.getById('1'), undefined);
    assert.equal(history.getById('50'), undefined);
    // id=51 应该仍然存在
    assert.ok(history.getById('51'));
    // 最新的应该存在
    assert.ok(history.getById('150'));
  });

  test('list returns correct order after wrap-around', () => {
    const history = new QueryHistory(5);
    for (let i = 1; i <= 8; i++) {
      history.push({
        connectionId: 'c1',
        engine: 'mysql',
        sql: `SELECT ${i}`,
        params: [],
        resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
        executionTime: 10,
        success: true,
      });
    }
    const list = history.list();
    assert.equal(list.length, 5);
    // 应该是 4,5,6,7,8
    assert.equal(list[0].sql, 'SELECT 4');
    assert.equal(list[4].sql, 'SELECT 8');
  });

  test('getById works correctly after many wraps', () => {
    const history = new QueryHistory(10);
    for (let i = 1; i <= 100; i++) {
      history.push({
        connectionId: 'c1',
        engine: 'mysql',
        sql: `SELECT ${i}`,
        params: [],
        resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
        executionTime: 10,
        success: true,
      });
    }
    // 只有最后 10 条 (91-100) 应该存在
    for (let i = 1; i <= 90; i++) {
      assert.equal(history.getById(String(i)), undefined);
    }
    for (let i = 91; i <= 100; i++) {
      assert.ok(history.getById(String(i)));
    }
  });
});
