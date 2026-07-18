import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { isFetchBlockedPort } from '../../dist/transports/http.js';

const config = {
  transport: 'http',
  host: '127.0.0.1',
  port: 0,
  endpoint: '/mcp',
  origins: [],
  allowedHosts: ['localhost', '127.0.0.1', '::1'],
  apiKey: undefined,
  authDisabled: true,
  bodyLimitBytes: 1024 * 1024,
  requestTimeoutMs: 5000,
  maxSessions: 1000,
  sessionIdleTimeoutMs: 30 * 60_000,
  eventStoreMaxEvents: 1000,
  eventStoreMaxBytes: 8 * 1024 * 1024,
};

test('dynamic HTTP ports avoid the Fetch blocked-port list', () => {
  assert.equal(isFetchBlockedPort(6000), true);
  assert.equal(isFetchBlockedPort(6667), true);
  assert.equal(isFetchBlockedPort(3000), false);
  assert.equal(isFetchBlockedPort(65535), false);
});

async function createSqliteRegistry() {
  const { ConnectionRegistry } = await import('../../dist/core/registry.js');
  const { createSqliteDriver } = await import('../../dist/drivers/sql/sqlite-driver.js');

  const spec = { id: 'local', engine: 'sqlite', url: ':memory:', readonly: false };
  const driver = await createSqliteDriver(spec);
  const registry = new ConnectionRegistry([spec], 'local', [
    { id: 'local', spec, kind: 'sql', driver },
  ]);

  return {
    registry,
    driver,
    close: () => driver.close(),
  };
}

async function startServer({ configOverrides = {}, configureDriver } = {}) {
  const { startHttpTransport } = await import('../../dist/transports/http.js');
  const sqlite = await createSqliteRegistry();
  if (configureDriver) await configureDriver(sqlite.driver);
  const started = await startHttpTransport({
    registry: sqlite.registry,
    config: { ...config, ...configOverrides },
    startupPings: [{ id: 'local', ok: true, latencyMs: 1 }],
  });
  return {
    ...started,
    close: async () => {
      await started.close();
      await sqlite.close();
    },
  };
}

const protocolVersion = '2025-11-25';

function mcpHeaders(sessionId, extra = {}) {
  return {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    ...(sessionId ? { 'mcp-protocol-version': protocolVersion } : {}),
    ...extra,
  };
}

async function initializeRawSession(url, extraHeaders = {}) {
  const initialized = await fetch(url, {
    method: 'POST',
    headers: mcpHeaders(undefined, extraHeaders),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'raw-http-test', version: '1.0.0' },
      },
    }),
  });
  assert.equal(initialized.status, 200);
  const sessionId = initialized.headers.get('mcp-session-id');
  assert.ok(sessionId);
  await initialized.json();

  const notification = await fetch(url, {
    method: 'POST',
    headers: mcpHeaders(sessionId, extraHeaders),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(notification.status, 202);
  await notification.body?.cancel();
  return sessionId;
}

describe('HTTP MCP endpoint', () => {
  let started;
  let transport;

  afterEach(async () => {
    delete process.env.DB_MAX_RESPONSE_BYTES;
    if (transport) {
      await transport.close();
      transport = undefined;
    }
    if (started) {
      await started.close();
      started = undefined;
    }
  });

  async function connectClient() {
    started = await startServer();
    const client = new Client({ name: 'http-test-client', version: '1.0.0' });
    transport = new StreamableHTTPClientTransport(new URL(started.url));
    await client.connect(transport);
    return client;
  }

  test('SDK client can initialize and list tools over Streamable HTTP', async () => {
    const client = await connectClient();

    const result = await client.listTools();
    const toolNames = result.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes('list_connections'));
    assert.ok(toolNames.includes('sql_query'));
  });

  test('GET SSE enforces one active stream and supports session cleanup', async () => {
    started = await startServer();
    const sessionId = await initializeRawSession(started.url);
    const controller = new AbortController();
    const stream = await fetch(started.url, {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        'mcp-session-id': sessionId,
        'mcp-protocol-version': protocolVersion,
      },
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type') ?? '', /^text\/event-stream/);

    const conflict = await fetch(started.url, {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        'mcp-session-id': sessionId,
        'mcp-protocol-version': protocolVersion,
      },
    });
    assert.equal(conflict.status, 409);
    await conflict.body?.cancel();

    await stream.body?.cancel();
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const invalid = await fetch(started.url, {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        'mcp-session-id': sessionId,
        'mcp-protocol-version': protocolVersion,
        'last-event-id': 'missing-event',
      },
    });
    assert.equal(invalid.status, 400);
    await invalid.body?.cancel();

    const deleted = await fetch(started.url, {
      method: 'DELETE',
      headers: {
        'mcp-session-id': sessionId,
        'mcp-protocol-version': protocolVersion,
      },
    });
    assert.equal(deleted.status, 200);
    await deleted.body?.cancel();
  });

  test('SDK terminateSession releases the server session', async () => {
    await connectClient();
    const sessionId = transport.sessionId;
    assert.ok(sessionId);

    await transport.terminateSession();
    assert.equal(transport.sessionId, undefined);

    const stale = await fetch(started.url, {
      method: 'POST',
      headers: mcpHeaders(sessionId),
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    assert.equal(stale.status, 404);
    const payload = await stale.json();
    assert.equal(payload.error.data.error_info.code, 'HTTP_004');
  });

  test('idle sessions expire after the configured timeout', async () => {
    started = await startServer({ configOverrides: { sessionIdleTimeoutMs: 50 } });
    const sessionId = await initializeRawSession(started.url);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const stale = await fetch(started.url, {
      method: 'POST',
      headers: mcpHeaders(sessionId),
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    assert.equal(stale.status, 404);
  });

  test('idle session sweeping does not interrupt an active request', async () => {
    let enteredResolve;
    let releaseResolve;
    const entered = new Promise((resolve) => {
      enteredResolve = resolve;
    });
    const release = new Promise((resolve) => {
      releaseResolve = resolve;
    });
    started = await startServer({
      configOverrides: { sessionIdleTimeoutMs: 50 },
      configureDriver(driver) {
        const execute = driver.execute.bind(driver);
        driver.execute = async (...args) => {
          if (String(args[0]).includes('idle_guard_probe')) {
            enteredResolve();
            await release;
          }
          return execute(...args);
        };
      },
    });
    const sessionId = await initializeRawSession(started.url);
    const active = fetch(started.url, {
      method: 'POST',
      headers: mcpHeaders(sessionId),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'sql_query',
          arguments: { sql: 'SELECT 1 AS idle_guard_probe' },
        },
      }),
    });
    try {
      await Promise.race([
        entered,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('active request did not start')), 2000),
        ),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      releaseResolve();
    }

    assert.equal((await active).status, 200);
    const followUp = await fetch(started.url, {
      method: 'POST',
      headers: mcpHeaders(sessionId),
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    });
    assert.equal(followUp.status, 200);
    await followUp.body?.cancel();
  });

  test('concurrent initialization respects the session capacity limit', async () => {
    started = await startServer({ configOverrides: { maxSessions: 1 } });
    const initializeBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'capacity-test', version: '1.0.0' },
      },
    });
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        fetch(started.url, {
          method: 'POST',
          headers: mcpHeaders(),
          body: initializeBody,
        }),
      ),
    );
    responses.sort((left, right) => left.status - right.status);
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 503],
    );

    const accepted = responses[0];
    const rejected = responses[1];
    const sessionId = accepted.headers.get('mcp-session-id');
    assert.ok(sessionId);
    await accepted.json();
    assert.equal(rejected.headers.get('retry-after'), '1');
    assert.equal((await rejected.json()).error.data.error_info.code, 'HTTP_007');

    const deleted = await fetch(started.url, {
      method: 'DELETE',
      headers: mcpHeaders(sessionId),
    });
    assert.equal(deleted.status, 200);
    await deleted.body?.cancel();

    const replacement = await fetch(started.url, {
      method: 'POST',
      headers: mcpHeaders(),
      body: initializeBody,
    });
    assert.equal(replacement.status, 200);
    const replacementId = replacement.headers.get('mcp-session-id');
    assert.ok(replacementId);
    await replacement.json();

    const cleanup = await fetch(started.url, {
      method: 'DELETE',
      headers: mcpHeaders(replacementId),
    });
    assert.equal(cleanup.status, 200);
    await cleanup.body?.cancel();
  });

  test('duplicate in-flight and batched JSON-RPC request IDs are rejected', async () => {
    let enteredResolve;
    let releaseResolve;
    const entered = new Promise((resolve) => {
      enteredResolve = resolve;
    });
    const release = new Promise((resolve) => {
      releaseResolve = resolve;
    });
    started = await startServer({
      configureDriver(driver) {
        const execute = driver.execute.bind(driver);
        driver.execute = async (...args) => {
          if (String(args[0]).includes('duplicate_guard_probe')) {
            enteredResolve();
            await release;
          }
          return execute(...args);
        };
      },
    });
    const sessionId = await initializeRawSession(started.url);
    const toolCall = {
      jsonrpc: '2.0',
      id: 77,
      method: 'tools/call',
      params: {
        name: 'sql_query',
        arguments: { sql: 'SELECT 1 AS duplicate_guard_probe' },
      },
    };

    const first = fetch(started.url, {
      method: 'POST',
      headers: mcpHeaders(sessionId),
      body: JSON.stringify(toolCall),
    });
    await Promise.race([
      entered,
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow tool did not start')), 2000)),
    ]);
    try {
      const duplicate = await fetch(started.url, {
        method: 'POST',
        headers: mcpHeaders(sessionId),
        body: JSON.stringify(toolCall),
      });
      assert.equal(duplicate.status, 400);
      assert.equal((await duplicate.json()).error.data.error_info.code, 'HTTP_006');
    } finally {
      releaseResolve();
    }
    assert.equal((await first).status, 200);

    const sequential = await fetch(started.url, {
      method: 'POST',
      headers: mcpHeaders(sessionId),
      body: JSON.stringify({ ...toolCall, params: { name: 'sql_query', arguments: { sql: 'SELECT 2' } } }),
    });
    assert.equal(sequential.status, 200);
    await sequential.body?.cancel();

    const batch = await fetch(started.url, {
      method: 'POST',
      headers: mcpHeaders(sessionId),
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 'same', method: 'tools/list' },
        { jsonrpc: '2.0', id: 'same', method: 'tools/list' },
      ]),
    });
    assert.equal(batch.status, 400);
    assert.equal((await batch.json()).error.data.error_info.code, 'HTTP_006');
  });

  test('SDK client can call sql_query over HTTP', async () => {
    const client = await connectClient();

    const result = await client.callTool({
      name: 'sql_query',
      arguments: { sql: 'SELECT 1 AS value' },
    });

    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.connection_id, 'local');
    assert.equal(payload.data[0].value, 1);
  });

  test('HTTP tool responses preserve byte truncation metadata', async () => {
    process.env.DB_MAX_RESPONSE_BYTES = '4096';
    const client = await connectClient();

    const result = await client.callTool({
      name: 'sql_query',
      arguments: {
        sql: `SELECT 1 AS id, 'ok' AS value
          UNION ALL SELECT 2, printf('%010000d', 1)
          UNION ALL SELECT 3, 'unread'`,
        response_bytes_limit: 2048,
      },
    });

    const payload = JSON.parse(result.content[0].text);
    assert.deepEqual(payload.data, [{ id: 1, value: 'ok' }]);
    assert.equal(payload.truncated, true);
    assert.equal(payload.truncatedBy, 'bytes');
    assert.equal(payload.responseByteLimit, 2048);
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 4096);
  });

  test('HTTP protocol backstop compacts oversized non-database tool output', async () => {
    process.env.DB_MAX_RESPONSE_BYTES = '4096';
    const client = await connectClient();
    const manifest = {
      name: 'large-tool-plugin',
      version: '1.0.0',
      polyglotPluginVersion: '1',
      type: ['tool'],
      main: './dist/index.js',
      permissions: {
        connections: ['local'],
        actions: ['read'],
        network: false,
        filesystem: false,
      },
      tools: [
        {
          name: 'large_tool',
          action: 'read',
          description: 'x'.repeat(20_000),
        },
      ],
    };

    const result = await client.callTool({
      name: 'plugin_validate_manifest',
      arguments: { manifest_json: JSON.stringify(manifest) },
    });
    const payload = JSON.parse(result.content[0].text);

    assert.equal(payload._db_mcp_response.truncated, true);
    assert.equal(payload._db_mcp_response.reason, 'response_byte_limit');
    assert.equal(payload._db_mcp_response.tool, 'plugin_validate_manifest');
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 4096);
  });

  test('HTTP sql_query still blocks write SQL at MCP tool layer', async () => {
    const client = await connectClient();

    const result = await client.callTool({
      name: 'sql_query',
      arguments: { sql: 'CREATE TABLE blocked(id INTEGER)' },
    });

    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.error_info.code, 'SQL_002');
  });

  test('SDK client can authenticate with Bearer API key', async () => {
    const { startHttpTransport } = await import('../../dist/transports/http.js');
    const sqlite = await createSqliteRegistry();
    started = await startHttpTransport({
      registry: sqlite.registry,
      config: { ...config, apiKey: 'secret', authDisabled: false },
      startupPings: [{ id: 'local', ok: true, latencyMs: 1 }],
    });

    const client = new Client({ name: 'http-auth-client', version: '1.0.0' });
    transport = new StreamableHTTPClientTransport(new URL(started.url), {
      requestInit: { headers: { authorization: 'Bearer secret' } },
    });
    await client.connect(transport);

    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'sql_query'));

    const originalClose = started.close;
    started.close = async () => {
      await originalClose();
      await sqlite.close();
    };
  });
});
