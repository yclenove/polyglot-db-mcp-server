import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConnectionSpecs } from '../dist/core/config.js';
import { ConnectionRegistry } from '../dist/core/registry.js';

test('parseConnectionSpecs parses valid JSON', () => {
  const json = JSON.stringify([
    { id: 'pg1', engine: 'postgres', url: 'postgres://user:pass@localhost:5432/app' },
  ]);
  const specs = parseConnectionSpecs(json);
  assert.equal(specs.length, 1);
  assert.equal(specs[0]?.id, 'pg1');
  assert.equal(specs[0]?.engine, 'postgres');
});

test('parseConnectionSpecs duplicate id throws', () => {
  const json = JSON.stringify([
    { id: 'dup', engine: 'redis', url: 'redis://localhost:6379' },
    { id: 'dup', engine: 'redis', url: 'redis://localhost:6379' },
  ]);
  assert.throws(() => parseConnectionSpecs(json), /dup/);
});

test('ConnectionRegistry export is a constructor', () => {
  assert.equal(typeof ConnectionRegistry, 'function');
});

test('resolveConnectionId: empty or whitespace uses default', () => {
  const json = JSON.stringify([
    { id: 'a', engine: 'postgres', url: 'postgres://u:p@127.0.0.1:5432/d' },
    { id: 'b', engine: 'postgres', url: 'postgres://u:p@127.0.0.1:5432/d2' },
  ]);
  const specs = parseConnectionSpecs(json);
  const noopDriver = {
    engine: 'postgres',
    ping: async () => ({ ok: true }),
    execute: async () => ({ success: true }),
    close: async () => {},
  };
  const handles = [
    { id: 'a', spec: specs[0], kind: 'sql', driver: noopDriver },
    { id: 'b', spec: specs[1], kind: 'sql', driver: { ...noopDriver } },
  ];
  const reg = new ConnectionRegistry(specs, 'a', handles);
  assert.equal(reg.resolveConnectionId(), 'a');
  assert.equal(reg.resolveConnectionId(undefined), 'a');
  assert.equal(reg.resolveConnectionId(''), 'a');
  assert.equal(reg.resolveConnectionId('   '), 'a');
  assert.equal(reg.resolveConnectionId('b'), 'b');
});

test('resolveConnectionId: unknown non-empty id throws', () => {
  const json = JSON.stringify([{ id: 'only', engine: 'postgres', url: 'postgres://u:p@127.0.0.1:5432/d' }]);
  const specs = parseConnectionSpecs(json);
  const noopDriver = {
    engine: 'postgres',
    ping: async () => ({ ok: true }),
    execute: async () => ({ success: true }),
    close: async () => {},
  };
  const handles = [{ id: 'only', spec: specs[0], kind: 'sql', driver: noopDriver }];
  const reg = new ConnectionRegistry(specs, 'only', handles);
  assert.throws(() => reg.resolveConnectionId('nosuch'), /未知 connection_id/);
});

test('recordRequest updates success and failure metrics', () => {
  const json = JSON.stringify([{ id: 'only', engine: 'postgres', url: 'postgres://u:p@127.0.0.1:5432/d' }]);
  const specs = parseConnectionSpecs(json);
  const noopDriver = {
    engine: 'postgres',
    ping: async () => ({ ok: true }),
    execute: async () => ({ success: true }),
    close: async () => {},
  };
  const handles = [{ id: 'only', spec: specs[0], kind: 'sql', driver: noopDriver }];
  const reg = new ConnectionRegistry(specs, 'only', handles);

  reg.recordRequest('only', true, 10);
  reg.recordRequest('only', false, 30, 'boom');

  const metrics = reg.getMetrics('only');
  assert.equal(metrics.totalRequests, 2);
  assert.equal(metrics.successRequests, 1);
  assert.equal(metrics.failedRequests, 1);
  assert.equal(metrics.totalLatencyMs, 40);
  assert.equal(metrics.lastError, 'boom');
  assert.ok(metrics.lastUsedAt > 0);
});

test('recordRequest ignores unknown connection ids', () => {
  const json = JSON.stringify([{ id: 'only', engine: 'postgres', url: 'postgres://u:p@127.0.0.1:5432/d' }]);
  const specs = parseConnectionSpecs(json);
  const noopDriver = {
    engine: 'postgres',
    ping: async () => ({ ok: true }),
    execute: async () => ({ success: true }),
    close: async () => {},
  };
  const handles = [{ id: 'only', spec: specs[0], kind: 'sql', driver: noopDriver }];
  const reg = new ConnectionRegistry(specs, 'only', handles);

  reg.recordRequest('missing', false, 10, 'boom');

  assert.equal(reg.getAllMetrics().has('missing'), false);
  assert.deepEqual(reg.getMetrics('missing'), {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalLatencyMs: 0,
    lastUsedAt: 0,
  });
});
