import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

const mockRegistry = {
  getDefaultId() {
    return 'local';
  },
  listMeta() {
    return [{ id: 'local', engine: 'sqlite', readonly: false }];
  },
};

const baseConfig = {
  transport: 'http',
  host: '127.0.0.1',
  port: 0,
  endpoint: '/mcp',
  origins: [],
  apiKey: undefined,
  authDisabled: true,
  bodyLimitBytes: 1024,
  requestTimeoutMs: 5000,
};

describe('HTTP transport security', () => {
  let started;

  afterEach(async () => {
    if (started) {
      await started.close();
      started = undefined;
    }
  });

  async function start(config) {
    const { startHttpTransport } = await import('../../dist/transports/http.js');
    started = await startHttpTransport({
      registry: mockRegistry,
      config: { ...baseConfig, ...config },
      startupPings: [{ id: 'local', ok: true, latencyMs: 1 }],
    });
    return started;
  }

  test('healthz and readyz are reachable without API key', async () => {
    const server = await start({ apiKey: 'secret', authDisabled: false });

    const health = await fetch(server.url.replace('/mcp', '/healthz'));
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'healthy');

    const ready = await fetch(server.url.replace('/mcp', '/readyz'));
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, 'ready');
  });

  test('rejects missing API key on MCP endpoint', async () => {
    const server = await start({ apiKey: 'secret', authDisabled: false });

    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.data.error_info.code, 'AUTH_003');
  });

  test('rejects origin not in allowlist', async () => {
    const server = await start({
      apiKey: 'secret',
      authDisabled: false,
      origins: ['https://allowed.example'],
    });

    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
        origin: 'https://blocked.example',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.data.error_info.code, 'HTTP_001');
  });

  test('enforces body size limit before MCP handling', async () => {
    const server = await start({ bodyLimitBytes: 10 });

    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.error.data.error_info.code, 'HTTP_002');
  });

  test('GET and DELETE /mcp return documented 405', async () => {
    const server = await start({});

    const get = await fetch(server.url, { method: 'GET' });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');

    const del = await fetch(server.url, { method: 'DELETE' });
    assert.equal(del.status, 405);
    assert.equal(del.headers.get('allow'), 'POST');
  });
});
