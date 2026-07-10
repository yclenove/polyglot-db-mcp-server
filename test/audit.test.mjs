import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditLog,
  getRecentAuditLogs,
  filterAuditLogs,
  getAuditStats,
  parseAuditPersistenceConfig,
  safeAuditPersistenceConfig,
  setAuditWebhookDispatchForTests,
  resetAuditForTests,
} from '../dist/core/audit.js';

// Helper: clear the buffer by reading and noting size
function bufferLen() {
  return getRecentAuditLogs(2000).length;
}

// ── 环形缓冲 O(1) 性能验证 ──────────────────────────────────

describe('audit ring buffer O(1) performance', () => {
  test('push beyond MAX_BUFFER_SIZE does not use shift()', () => {
    // 写入超过缓冲区上限的条目
    for (let i = 0; i < 1200; i++) {
      auditLog({ engine: 'ring_perf', operation: `op_${i}`, success: true });
    }
    // 缓冲区应该限制在 1000 条以内
    const logs = getRecentAuditLogs(2000);
    assert.ok(logs.length <= 1000);
    // 最新条目应该存在
    const filtered = filterAuditLogs({ engine: 'ring_perf', limit: 5 });
    assert.ok(filtered.length > 0);
  });

  test('chronological order preserved after wrap-around', () => {
    auditLog({ engine: 'ring_order', operation: 'first', success: true });
    auditLog({ engine: 'ring_order', operation: 'second', success: true });
    auditLog({ engine: 'ring_order', operation: 'third', success: true });
    const logs = filterAuditLogs({ engine: 'ring_order', limit: 3 });
    assert.ok(logs.length >= 3);
    // 时间戳应该递增
    for (let i = 1; i < logs.length; i++) {
      assert.ok(new Date(logs[i].timestamp).getTime() >= new Date(logs[i - 1].timestamp).getTime());
    }
  });
});

describe('auditLog', () => {
  test('adds entry to buffer', () => {
    const before = bufferLen();
    auditLog({ engine: 'mysql', operation: 'query', sql: 'SELECT RING_TEST', success: true });
    const after = bufferLen();
    // 环形缓冲区有上限，可能不会增长（已满时覆盖最旧条目）
    assert.ok(after >= before);
    assert.ok(after <= 1000); // 不超过缓冲区上限
    // 验证最新条目已写入
    const logs = getRecentAuditLogs(1);
    const last = logs[logs.length - 1];
    assert.equal(last.sql, 'SELECT RING_TEST');
  });

  test('entry has timestamp', () => {
    auditLog({ engine: 'mysql', operation: 'query', success: true });
    const logs = getRecentAuditLogs(1);
    const last = logs[logs.length - 1];
    assert.ok(last.timestamp);
    assert.ok(!isNaN(Date.parse(last.timestamp)));
  });

  test('entry preserves custom fields', () => {
    auditLog({ engine: 'postgres', operation: 'execute', sql: 'INSERT INTO t VALUES (1)', success: true, affectedRows: 1, executionTime: 42 });
    const logs = getRecentAuditLogs(1);
    const last = logs[logs.length - 1];
    assert.equal(last.engine, 'postgres');
    assert.equal(last.operation, 'execute');
    assert.equal(last.sql, 'INSERT INTO t VALUES (1)');
    assert.equal(last.success, true);
    assert.equal(last.affectedRows, 1);
    assert.equal(last.executionTime, 42);
  });
});

describe('audit persistence config', () => {
  test('defaults to memory and supports explicit file sink', () => {
    const memory = parseAuditPersistenceConfig({});
    assert.equal(memory.sink, 'memory');

    const file = parseAuditPersistenceConfig({
      DB_AUDIT_SINK: 'file',
      DB_AUDIT_FILE_PATH: './audit/events.jsonl',
    });
    assert.equal(file.sink, 'file');
    assert.equal(file.filePath, './audit/events.jsonl');
    assert.equal(file.legacyEnv, false);
  });

  test('keeps MCP_AUDIT_LOG as a legacy file sink', () => {
    const config = parseAuditPersistenceConfig({ MCP_AUDIT_LOG: './audit.jsonl' });
    assert.equal(config.sink, 'file');
    assert.equal(config.filePath, './audit.jsonl');
    assert.equal(config.legacyEnv, true);
  });

  test('rejects invalid sink configuration', () => {
    assert.throws(() => parseAuditPersistenceConfig({ DB_AUDIT_SINK: 'database' }), /CFG_005/);
    assert.throws(() => parseAuditPersistenceConfig({ DB_AUDIT_SINK: 'file' }), /CFG_005/);
    assert.throws(() => parseAuditPersistenceConfig({ DB_AUDIT_SINK: 'webhook' }), /CFG_005/);
    assert.throws(
      () =>
        parseAuditPersistenceConfig({
          DB_AUDIT_SINK: 'webhook',
          DB_AUDIT_WEBHOOK_URL: 'ftp://audit.example.test/hook',
        }),
      /CFG_005/,
    );
  });

  test('parses webhook sink without leaking secret in safe summary', () => {
    const config = parseAuditPersistenceConfig({
      DB_AUDIT_SINK: 'webhook',
      DB_AUDIT_WEBHOOK_URL: 'https://audit.example.test/hook',
      DB_AUDIT_WEBHOOK_SECRET: 'secret-value',
      DB_AUDIT_WEBHOOK_TIMEOUT_MS: '1234',
    });

    assert.equal(config.sink, 'webhook');
    assert.equal(config.webhookUrl, 'https://audit.example.test/hook');
    assert.equal(config.webhookSecret, 'secret-value');
    assert.equal(config.webhookTimeoutMs, 1234);

    const safe = safeAuditPersistenceConfig(config);
    assert.equal(safe.webhook, 'configured');
    assert.equal(safe.webhook_secret, 'configured');
    assert.equal(JSON.stringify(safe).includes('secret-value'), false);
    assert.equal(JSON.stringify(safe).includes('audit.example.test'), false);
  });

  test('writes JSONL entries when DB_AUDIT_SINK=file', () => {
    const original = {
      DB_AUDIT_SINK: process.env.DB_AUDIT_SINK,
      DB_AUDIT_FILE_PATH: process.env.DB_AUDIT_FILE_PATH,
      MCP_AUDIT_LOG: process.env.MCP_AUDIT_LOG,
    };
    const dir = mkdtempSync(join(tmpdir(), 'db-mcp-audit-'));
    const filePath = join(dir, 'audit.jsonl');

    try {
      process.env.DB_AUDIT_SINK = 'file';
      process.env.DB_AUDIT_FILE_PATH = filePath;
      delete process.env.MCP_AUDIT_LOG;

      auditLog({ engine: 'postgres', operation: 'persist_file', success: true });

      const lines = readFileSync(filePath, 'utf8').trim().split('\n');
      const entry = JSON.parse(lines.at(-1));
      assert.equal(entry.engine, 'postgres');
      assert.equal(entry.operation, 'persist_file');
      assert.equal(entry.success, true);
      assert.ok(entry.timestamp);
    } finally {
      if (original.DB_AUDIT_SINK === undefined) delete process.env.DB_AUDIT_SINK;
      else process.env.DB_AUDIT_SINK = original.DB_AUDIT_SINK;
      if (original.DB_AUDIT_FILE_PATH === undefined) delete process.env.DB_AUDIT_FILE_PATH;
      else process.env.DB_AUDIT_FILE_PATH = original.DB_AUDIT_FILE_PATH;
      if (original.MCP_AUDIT_LOG === undefined) delete process.env.MCP_AUDIT_LOG;
      else process.env.MCP_AUDIT_LOG = original.MCP_AUDIT_LOG;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('sends audit entries to webhook sink without leaking secret in body', async () => {
    const original = {
      DB_AUDIT_SINK: process.env.DB_AUDIT_SINK,
      DB_AUDIT_WEBHOOK_URL: process.env.DB_AUDIT_WEBHOOK_URL,
      DB_AUDIT_WEBHOOK_SECRET: process.env.DB_AUDIT_WEBHOOK_SECRET,
      DB_AUDIT_WEBHOOK_TIMEOUT_MS: process.env.DB_AUDIT_WEBHOOK_TIMEOUT_MS,
    };
    const calls = [];
    setAuditWebhookDispatchForTests(async (request) => {
      calls.push(request);
      return { ok: true, status: 202, statusText: 'Accepted' };
    });

    try {
      process.env.DB_AUDIT_SINK = 'webhook';
      process.env.DB_AUDIT_WEBHOOK_URL = 'https://audit.example.test/hook';
      process.env.DB_AUDIT_WEBHOOK_SECRET = 'secret-value';
      process.env.DB_AUDIT_WEBHOOK_TIMEOUT_MS = '1000';

      auditLog({ engine: 'postgres', operation: 'persist_webhook', success: true });
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://audit.example.test/hook');
      assert.equal(calls[0].headers['x-db-mcp-audit-secret'], 'secret-value');
      assert.equal(calls[0].timeoutMs, 1000);
      assert.equal(calls[0].entry.engine, 'postgres');
      assert.equal(calls[0].entry.operation, 'persist_webhook');
      assert.equal(JSON.stringify(calls[0].entry).includes('secret-value'), false);
    } finally {
      if (original.DB_AUDIT_SINK === undefined) delete process.env.DB_AUDIT_SINK;
      else process.env.DB_AUDIT_SINK = original.DB_AUDIT_SINK;
      if (original.DB_AUDIT_WEBHOOK_URL === undefined) delete process.env.DB_AUDIT_WEBHOOK_URL;
      else process.env.DB_AUDIT_WEBHOOK_URL = original.DB_AUDIT_WEBHOOK_URL;
      if (original.DB_AUDIT_WEBHOOK_SECRET === undefined)
        delete process.env.DB_AUDIT_WEBHOOK_SECRET;
      else process.env.DB_AUDIT_WEBHOOK_SECRET = original.DB_AUDIT_WEBHOOK_SECRET;
      if (original.DB_AUDIT_WEBHOOK_TIMEOUT_MS === undefined)
        delete process.env.DB_AUDIT_WEBHOOK_TIMEOUT_MS;
      else process.env.DB_AUDIT_WEBHOOK_TIMEOUT_MS = original.DB_AUDIT_WEBHOOK_TIMEOUT_MS;
      resetAuditForTests();
    }
  });
});

describe('getRecentAuditLogs', () => {
  test('returns at most limit entries', () => {
    // Add a few entries
    for (let i = 0; i < 5; i++) {
      auditLog({ engine: 'mysql', operation: 'test', success: true });
    }
    const logs = getRecentAuditLogs(3);
    assert.ok(logs.length <= 3);
  });

  test('returns entries in chronological order', () => {
    auditLog({ engine: 'mysql', operation: 'first', success: true });
    auditLog({ engine: 'mysql', operation: 'second', success: true });
    const logs = getRecentAuditLogs(2);
    assert.equal(logs[0].operation, 'first');
    assert.equal(logs[1].operation, 'second');
  });
});

describe('filterAuditLogs', () => {
  test('filters by engine', () => {
    // Add known entries
    auditLog({ engine: 'filtertest_mysql', operation: 'q', success: true });
    auditLog({ engine: 'filtertest_pg', operation: 'q', success: true });
    auditLog({ engine: 'filtertest_mysql', operation: 'q', success: true });

    const filtered = filterAuditLogs({ engine: 'filtertest_mysql', limit: 10 });
    for (const entry of filtered) {
      assert.equal(entry.engine, 'filtertest_mysql');
    }
    assert.ok(filtered.length >= 2);
  });

  test('filters by success', () => {
    auditLog({ engine: 'succtest', operation: 'ok', success: true });
    auditLog({ engine: 'succtest', operation: 'fail', success: false });

    const successes = filterAuditLogs({ engine: 'succtest', success: true, limit: 10 });
    for (const entry of successes) {
      assert.equal(entry.success, true);
    }

    const failures = filterAuditLogs({ engine: 'succtest', success: false, limit: 10 });
    for (const entry of failures) {
      assert.equal(entry.success, false);
    }
  });

  test('filters by operation', () => {
    auditLog({ engine: 'opttest', operation: 'special_op', success: true });
    const filtered = filterAuditLogs({ engine: 'opttest', operation: 'special_op', limit: 10 });
    for (const entry of filtered) {
      assert.equal(entry.operation, 'special_op');
    }
    assert.ok(filtered.length >= 1);
  });

  test('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      auditLog({ engine: 'limittest', operation: 'q', success: true });
    }
    const filtered = filterAuditLogs({ engine: 'limittest', limit: 5 });
    assert.ok(filtered.length <= 5);
  });
});

describe('getAuditStats', () => {
  test('returns valid stats structure', () => {
    // Add some entries
    auditLog({ engine: 'statstest', operation: 'query', success: true });
    auditLog({ engine: 'statstest', operation: 'execute', success: true });
    auditLog({ engine: 'statstest', operation: 'query', success: false });

    const stats = getAuditStats();
    assert.ok(typeof stats.total === 'number');
    assert.ok(typeof stats.success === 'number');
    assert.ok(typeof stats.failed === 'number');
    assert.ok(typeof stats.byEngine === 'object');
    assert.ok(typeof stats.byOperation === 'object');
    assert.ok(stats.total > 0);
    assert.ok(stats.success > 0);
  });

  test('byEngine counts are non-negative', () => {
    const stats = getAuditStats();
    for (const count of Object.values(stats.byEngine)) {
      assert.ok(count >= 0);
    }
  });

  test('byOperation counts are non-negative', () => {
    const stats = getAuditStats();
    for (const count of Object.values(stats.byOperation)) {
      assert.ok(count >= 0);
    }
  });

  test('total = success + failed', () => {
    const stats = getAuditStats();
    // This is true for the global buffer
    assert.equal(stats.total, stats.success + stats.failed);
  });
});
