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
    close: () => driver.close(),
  };
}

async function startServer() {
  const { startHttpTransport } = await import('../../dist/transports/http.js');
  const sqlite = await createSqliteRegistry();
  const started = await startHttpTransport({
    registry: sqlite.registry,
    config,
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
