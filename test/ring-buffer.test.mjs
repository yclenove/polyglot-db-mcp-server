import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  QueryHistory,
  getGlobalQueryHistory,
  resetGlobalQueryHistory,
} from '../dist/core/query-replay.js';

// ── TC-RING-001: 缓冲满时覆盖最旧记录 ──────────────────────────────────────────

describe('TC-RING-001: ring buffer overflow eviction', () => {
  test('evicts oldest when buffer reaches capacity', () => {
    const history = new QueryHistory(3);
    const r1 = history.push({
      connectionId: 'c1', engine: 'mysql', sql: 'first', params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10, success: true,
    });
    history.push({
      connectionId: 'c1', engine: 'mysql', sql: 'second', params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10, success: true,
    });
    history.push({
      connectionId: 'c1', engine: 'mysql', sql: 'third', params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10, success: true,
    });
    history.push({
      connectionId: 'c1', engine: 'mysql', sql: 'fourth', params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10, success: true,
    });

    assert.equal(history.size, 3);
    assert.equal(history.getById(r1.id), undefined, 'oldest record should be evicted');
    const list = history.list();
    assert.equal(list[0].sql, 'second');
    assert.equal(list[1].sql, 'third');
    assert.equal(list[2].sql, 'fourth');
  });

  test('size never exceeds capacity after many insertions', () => {
    const capacity = 5;
    const history = new QueryHistory(capacity);
    for (let i = 0; i < 20; i++) {
      history.push({
        connectionId: 'c1', engine: 'mysql', sql: `SELECT ${i}`, params: [],
        resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
        executionTime: 10, success: true,
      });
    }
    assert.equal(history.size, capacity);
  });
});

// ── TC-RING-002: head/tail 指针正确移动 ──────────────────────────────────────────

describe('TC-RING-002: head/tail pointer movement', () => {
  test('list returns correct chronological order after overflow', () => {
    const history = new QueryHistory(5);
    for (let i = 1; i <= 7; i++) {
      history.push({
        connectionId: 'c1', engine: 'mysql', sql: `SELECT ${i}`, params: [],
        resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
        executionTime: 10, success: true,
      });
    }
    const list = history.list();
    assert.equal(list.length, 5);
    assert.equal(list[0].sql, 'SELECT 3');
    assert.equal(list[4].sql, 'SELECT 7');
  });

  test('getById returns undefined for evicted records', () => {
    const history = new QueryHistory(3);
    const r1 = history.push({
      connectionId: 'c1', engine: 'mysql', sql: 'old', params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10, success: true,
    });
    history.push({
      connectionId: 'c1', engine: 'mysql', sql: 'mid', params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10, success: true,
    });
    history.push({
      connectionId: 'c1', engine: 'mysql', sql: 'new', params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10, success: true,
    });
    history.push({
      connectionId: 'c1', engine: 'mysql', sql: 'newest', params: [],
      resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
      executionTime: 10, success: true,
    });

    assert.equal(history.getById(r1.id), undefined);
    assert.ok(history.getById('2'));
    assert.ok(history.getById('3'));
    assert.ok(history.getById('4'));
  });
});

// ── TC-RING-003: 大量插入性能测试 ──────────────────────────────────────────

describe('TC-RING-003: bulk insert performance', () => {
  test('1000 inserts complete within performance threshold', () => {
    const history = new QueryHistory(100);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      history.push({
        connectionId: 'c1', engine: 'mysql', sql: `SELECT ${i}`, params: [],
        resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
        executionTime: 10, success: true,
      });
    }
    const elapsed = performance.now() - start;
    assert.equal(history.size, 100);
    assert.ok(elapsed < 50, `1000 inserts took ${elapsed.toFixed(2)}ms, expected < 50ms`);
  });
});

// ── TC-RING-004: 并发插入安全性 ──────────────────────────────────────────

describe('TC-RING-004: concurrent insert safety', () => {
  test('concurrent inserts maintain buffer integrity', async () => {
    const history = new QueryHistory(10);
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        Promise.resolve().then(() => {
          history.push({
            connectionId: 'c1', engine: 'mysql', sql: `SELECT ${i}`, params: [],
            resultSummary: { rowCount: 1, fields: [], sampleRows: [] },
            executionTime: 10, success: true,
          });
        })
      );
    }
    await Promise.all(promises);
    assert.ok(history.size <= 10, `size ${history.size} should be <= 10`);
    const list = history.list();
    assert.ok(list.length <= 10);
  });
});

// ── TC-RING-005: 缓冲区大小配置生效 ──────────────────────────────────────────

describe('TC-RING-005: buffer size configuration', () => {
  test('constructor accepts custom capacity', () => {
    const history = new QueryHistory(200);
    assert.equal(history.capacity, 200);
  });

  test('default capacity is 50 when no env var set', () => {
    const oldVal = process.env.DB_REPLAY_BUFFER_SIZE;
    delete process.env.DB_REPLAY_BUFFER_SIZE;
    const history = new QueryHistory();
    assert.equal(history.capacity, 50);
    if (oldVal !== undefined) process.env.DB_REPLAY_BUFFER_SIZE = oldVal;
  });
});
