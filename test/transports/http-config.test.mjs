import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('HTTP transport config', () => {
  test('uses safe localhost stdio defaults', async () => {
    const { parseHttpTransportConfig, safeHttpConfig } = await import(
      '../../dist/core/http-config.js'
    );

    const config = parseHttpTransportConfig({});
    assert.equal(config.transport, 'stdio');
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3000);
    assert.equal(config.endpoint, '/mcp');
    assert.deepEqual(config.origins, []);
    assert.equal(config.authDisabled, false);
    assert.equal(config.bodyLimitBytes, 1024 * 1024);

    const safe = safeHttpConfig({ ...config, apiKey: 'secret-key' });
    assert.equal(safe.auth, 'api_key');
    assert.equal(Object.values(safe).includes('secret-key'), false);
  });

  test('CLI args override environment values', async () => {
    const { parseHttpTransportConfig } = await import('../../dist/core/http-config.js');

    const config = parseHttpTransportConfig(
      {
        DB_MCP_TRANSPORT: 'stdio',
        DB_HTTP_PORT: '3000',
      },
      ['--transport', 'http', '--host', 'localhost', '--port', '3100', '--endpoint', '/db'],
    );

    assert.equal(config.transport, 'http');
    assert.equal(config.host, 'localhost');
    assert.equal(config.port, 3100);
    assert.equal(config.endpoint, '/db');
  });

  test('rejects invalid transport, endpoint, and port', async () => {
    const { parseHttpTransportConfig } = await import('../../dist/core/http-config.js');

    assert.throws(() => parseHttpTransportConfig({ DB_MCP_TRANSPORT: 'tcp' }), /CLI_002/);
    assert.throws(() => parseHttpTransportConfig({ DB_HTTP_ENDPOINT: 'mcp' }), /CFG_005/);
    assert.throws(() => parseHttpTransportConfig({ DB_HTTP_PORT: '70000' }), /CFG_005/);
  });

  test('requires API key for non-local HTTP bind unless explicitly disabled', async () => {
    const { parseHttpTransportConfig } = await import('../../dist/core/http-config.js');

    assert.throws(
      () =>
        parseHttpTransportConfig({
          DB_MCP_TRANSPORT: 'http',
          DB_HTTP_HOST: '0.0.0.0',
        }),
      /AUTH_003/,
    );

    const withKey = parseHttpTransportConfig({
      DB_MCP_TRANSPORT: 'http',
      DB_HTTP_HOST: '0.0.0.0',
      DB_HTTP_API_KEY: 'dev-key',
    });
    assert.equal(withKey.apiKey, 'dev-key');

    const disabled = parseHttpTransportConfig({
      DB_MCP_TRANSPORT: 'http',
      DB_HTTP_HOST: '0.0.0.0',
      DB_HTTP_AUTH_DISABLED: 'true',
    });
    assert.equal(disabled.authDisabled, true);
  });
});
