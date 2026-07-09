import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  auditLog,
  getRecentAuditLogs,
  filterAuditLogs,
} from '../dist/core/audit.js';

// ── 辅助函数 ──────────────────────────────────────────

function makeEntry(overrides = {}) {
  return {
    engine: 'mysql',
    connection_id: 'test-conn',
    operation: 'query',
    success: true,
    executionTime: 10,
    ...overrides,
  };
}

// ── TC-EXP-001: 导出 JSON 格式正确 ──────────────────────────────────────────

describe('TC-EXP-001: export JSON format', () => {
  test('getRecentAuditLogs returns valid array', () => {
    auditLog(makeEntry({ sql: 'SELECT 1' }));
    const logs = getRecentAuditLogs(10);
    assert.ok(Array.isArray(logs), 'should return an array');
    assert.ok(logs.length > 0, 'should have at least one entry');
  });

  test('each log entry has required fields', () => {
    auditLog(makeEntry({ sql: 'SELECT 1' }));
    const logs = getRecentAuditLogs(1);
    const entry = logs[logs.length - 1];
    assert.ok(typeof entry.timestamp === 'string', 'should have timestamp string');
    assert.ok(entry.timestamp.includes('T'), 'timestamp should be ISO format');
    assert.equal(entry.engine, 'mysql');
    assert.equal(entry.operation, 'query');
    assert.equal(entry.success, true);
  });

  test('filterAuditLogs returns structured result', () => {
    auditLog(makeEntry({ sql: 'SELECT 1' }));
    const result = filterAuditLogs({ limit: 5 });
    assert.ok(Array.isArray(result), 'should return array');
  });
});

// ── TC-EXP-002: limit 参数生效 ──────────────────────────────────────────

describe('TC-EXP-002: limit parameter', () => {
  test('getRecentAuditLogs respects limit', () => {
    // 插入足够多的记录
    for (let i = 0; i < 20; i++) {
      auditLog(makeEntry({ sql: `SELECT ${i}` }));
    }
    const logs = getRecentAuditLogs(5);
    assert.ok(logs.length <= 5, `expected <= 5, got ${logs.length}`);
  });

  test('filterAuditLogs respects limit', () => {
    for (let i = 0; i < 15; i++) {
      auditLog(makeEntry({ sql: `SELECT ${i}` }));
    }
    const result = filterAuditLogs({ limit: 3 });
    assert.ok(result.length <= 3, `expected <= 3, got ${result.length}`);
  });

  test('limit=1 returns at most 1 entry', () => {
    auditLog(makeEntry({ sql: 'SELECT A' }));
    auditLog(makeEntry({ sql: 'SELECT B' }));
    const logs = getRecentAuditLogs(1);
    assert.ok(logs.length <= 1);
  });
});

// ── TC-EXP-003: since 时间戳过滤生效 ──────────────────────────────────────────

describe('TC-EXP-003: since timestamp filter', () => {
  test('filterAuditLogs filters by since timestamp', () => {
    // 先插入一条旧记录
    auditLog(makeEntry({ sql: 'OLD_QUERY' }));

    // 记录当前时间
    const cutoff = new Date().toISOString();

    // 插入新记录
    auditLog(makeEntry({ sql: 'NEW_QUERY' }));

    const filtered = filterAuditLogs({ since: cutoff });
    // 新记录应该被包含
    const hasNew = filtered.some((e) => e.sql === 'NEW_QUERY');
    assert.ok(hasNew, 'should include records after since timestamp');
  });

  test('since filter excludes older records', () => {
    // 插入旧记录
    auditLog(makeEntry({ sql: 'EXCLUDE_ME' }));

    // 设置 cutoff 为未来时间
    const futureCutoff = new Date(Date.now() + 10000).toISOString();

    // 插入新记录
    auditLog(makeEntry({ sql: 'ALSO_EXCLUDE' }));

    const filtered = filterAuditLogs({ since: futureCutoff });
    // 未来时间之后的记录不应该存在
    assert.equal(filtered.length, 0, 'should exclude all records before future timestamp');
  });

  test('since with until range filter works', () => {
    const t1 = new Date().toISOString();
    auditLog(makeEntry({ sql: 'IN_RANGE' }));
    const t2 = new Date().toISOString();

    const filtered = filterAuditLogs({ since: t1, until: t2 });
    assert.ok(filtered.length >= 1, 'should find records in time range');
  });
});

// ── TC-EXP-004: JSON 导出结构完整性 ──────────────────────────────────────────

describe('TC-EXP-004: JSON export structure', () => {
  test('export produces valid JSON-serializable structure', () => {
    auditLog(makeEntry({ sql: 'SELECT EXPORT_TEST' }));
    const entries = getRecentAuditLogs(10);
    const exportData = {
      exportedAt: new Date().toISOString(),
      format: 'json',
      count: entries.length,
      entries,
    };
    assert.ok(typeof exportData.exportedAt === 'string');
    assert.equal(exportData.format, 'json');
    assert.ok(typeof exportData.count === 'number');
    assert.ok(Array.isArray(exportData.entries));

    const json = JSON.stringify(exportData, null, 2);
    assert.ok(json.length > 0);

    const parsed = JSON.parse(json);
    assert.equal(parsed.count, exportData.count);
    assert.equal(parsed.entries.length, exportData.entries.length);
  });

  test('export with empty buffer returns empty array', () => {
    const futureCutoff = new Date(Date.now() + 86400000).toISOString();
    const entries = filterAuditLogs({ since: futureCutoff, limit: 1000 });
    assert.deepStrictEqual(entries, []);
  });
});
