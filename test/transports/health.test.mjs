import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

function mockRegistry(defaultId = 'local') {
  return {
    getDefaultId() {
      return defaultId;
    },
    listMeta() {
      return [
        { id: 'local', engine: 'sqlite', readonly: false },
        { id: 'pg', engine: 'postgres', readonly: true },
      ];
    },
  };
}

describe('HTTP health payloads', () => {
  test('healthz payload is process-level and does not need registry', async () => {
    const { healthPayload } = await import('../../dist/transports/health.js');

    const payload = healthPayload(new Date(Date.now() - 10));
    assert.equal(payload.status, 'healthy');
    assert.equal(payload.service, 'polyglot-db-mcp-server');
    assert.equal(typeof payload.version, 'string');
    assert.equal(typeof payload.uptime_ms, 'number');
  });

  test('readyz reports not_ready before registry is available', async () => {
    const { readinessPayload } = await import('../../dist/transports/health.js');

    const ready = readinessPayload(undefined, undefined);
    assert.equal(ready.statusCode, 503);
    assert.equal(ready.payload.status, 'not_ready');
    assert.equal(ready.payload.reason, 'registry_not_loaded');
  });

  test('readyz reports ready, degraded, and not_ready from startup pings', async () => {
    const { readinessPayload } = await import('../../dist/transports/health.js');
    const registry = mockRegistry();

    const ready = readinessPayload(registry, [
      { id: 'local', ok: true, latencyMs: 1 },
      { id: 'pg', ok: true, latencyMs: 2 },
    ]);
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.payload.status, 'ready');

    const degraded = readinessPayload(registry, [
      { id: 'local', ok: true, latencyMs: 1 },
      { id: 'pg', ok: false, latencyMs: 2, error: 'down' },
    ]);
    assert.equal(degraded.statusCode, 200);
    assert.equal(degraded.payload.status, 'degraded');
    assert.deepEqual(degraded.payload.failed_connections, [{ id: 'pg', error: 'down' }]);

    const notReady = readinessPayload(registry, [{ id: 'local', ok: false, latencyMs: 1 }]);
    assert.equal(notReady.statusCode, 503);
    assert.equal(notReady.payload.status, 'not_ready');
  });
});
