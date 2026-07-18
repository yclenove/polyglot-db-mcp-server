import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { afterEach, describe, test } from 'node:test';

const mockRegistry = {
  getDefaultId() {
    return 'local';
  },
  listMeta() {
    return [{ id: 'local', engine: 'sqlite', readonly: false }];
  },
  getSpecs() {
    return [{ id: 'local', engine: 'sqlite', readonly: false }];
  },
  getMetrics() {
    return {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      lastUsedAt: 0,
    };
  },
};

const baseConfig = {
  transport: 'http',
  host: '127.0.0.1',
  port: 0,
  endpoint: '/mcp',
  origins: [],
  allowedHosts: ['localhost', '127.0.0.1', '::1'],
  apiKey: undefined,
  authDisabled: true,
  bodyLimitBytes: 1024,
  requestTimeoutMs: 5000,
  maxSessions: 1000,
  sessionIdleTimeoutMs: 30 * 60_000,
  eventStoreMaxEvents: 1000,
  eventStoreMaxBytes: 8 * 1024 * 1024,
};

const fetchBlockedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080,
]);

function isFetchBlockedPort(url) {
  return fetchBlockedPorts.has(Number(new URL(url).port));
}

function requestWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers: { host } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

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
    for (let i = 0; i < 10; i++) {
      started = await startHttpTransport({
        registry: mockRegistry,
        config: { ...baseConfig, ...config },
        startupPings: [{ id: 'local', ok: true, latencyMs: 1 }],
      });
      if (!isFetchBlockedPort(started.url)) break;
      await started.close();
      started = undefined;
    }
    if (!started) throw new Error('failed to allocate a Fetch-compatible test port');
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

  test('rejects spoofed Host before routing and accepts explicit allowed hosts', async () => {
    const server = await start({
      allowedHosts: [...baseConfig.allowedHosts, 'mcp.internal'],
    });

    for (const path of ['/healthz', '/readyz', '/metrics', '/mcp', '/missing']) {
      const response = await requestWithHost(server.url.replace('/mcp', path), 'attacker.example');
      assert.equal(response.status, 403, `expected Host rejection for ${path}`);
      assert.equal(JSON.parse(response.body).error.data.error_info.code, 'HTTP_001');
    }

    const allowed = await requestWithHost(
      server.url.replace('/mcp', '/healthz'),
      'MCP.INTERNAL:8080',
    );
    assert.equal(allowed.status, 200);
  });

  test('metrics endpoint returns Prometheus text when auth is disabled', async () => {
    const server = await start({});

    const metrics = await fetch(server.url.replace('/mcp', '/metrics'));
    assert.equal(metrics.status, 200);
    assert.match(metrics.headers.get('content-type'), /^text\/plain/);
    assert.match(await metrics.text(), /db_mcp_connections_total 1/);
  });

  test('metrics endpoint requires configured HTTP auth', async () => {
    const server = await start({ apiKey: 'secret', authDisabled: false });

    const missing = await fetch(server.url.replace('/mcp', '/metrics'));
    assert.equal(missing.status, 401);

    const ok = await fetch(server.url.replace('/mcp', '/metrics'), {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /db_mcp_uptime_seconds/);
  });

  test('metrics endpoint only allows GET', async () => {
    const server = await start({});

    const res = await fetch(server.url.replace('/mcp', '/metrics'), { method: 'POST' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
  });

  test('rejects missing API key on every MCP method', async () => {
    const server = await start({ apiKey: 'secret', authDisabled: false });

    const post = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const get = await fetch(server.url, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    });
    const del = await fetch(server.url, { method: 'DELETE' });

    for (const response of [post, get, del]) {
      assert.equal(response.status, 401);
      const body = await response.json();
      assert.equal(body.error.data.error_info.code, 'AUTH_003');
    }
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

  test('GET and DELETE require a session while unsupported methods return 405', async () => {
    const server = await start({});

    const get = await fetch(server.url, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    });
    assert.equal(get.status, 400);
    assert.equal((await get.json()).error.data.error_info.code, 'HTTP_006');

    const del = await fetch(server.url, { method: 'DELETE' });
    assert.equal(del.status, 400);
    assert.equal((await del.json()).error.data.error_info.code, 'HTTP_006');

    const put = await fetch(server.url, { method: 'PUT' });
    assert.equal(put.status, 405);
    assert.equal(put.headers.get('allow'), 'POST, GET, DELETE');
  });
});
