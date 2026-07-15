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
    assert.deepEqual(config.allowedHosts, ['localhost', '127.0.0.1', '::1']);
    assert.equal(config.authDisabled, false);
    assert.equal(config.authMode, 'none');
    assert.equal(config.bodyLimitBytes, 1024 * 1024);
    assert.equal(config.rbacPolicyTemplate, undefined);

    const safe = safeHttpConfig({
      ...config,
      authMode: 'api_key',
      apiKey: 'secret-key',
      rbacPolicyTemplate: 'readonly-http',
    });
    assert.equal(safe.auth, 'api_key');
    assert.equal(safe.rbac_policy_template, 'readonly-http');
    assert.deepEqual(safe.allowed_hosts, ['localhost', '127.0.0.1', '::1']);
    assert.equal(Object.values(safe).includes('secret-key'), false);
  });

  test('CLI args override environment values', async () => {
    const { parseHttpTransportConfig } = await import('../../dist/core/http-config.js');

    const config = parseHttpTransportConfig(
      {
        DB_MCP_TRANSPORT: 'stdio',
        DB_HTTP_PORT: '3000',
      },
      [
        '--transport',
        'http',
        '--host',
        'localhost',
        '--port',
        '3100',
        '--endpoint',
        '/db',
        '--auth-disabled',
      ],
    );

    assert.equal(config.transport, 'http');
    assert.equal(config.host, 'localhost');
    assert.equal(config.port, 3100);
    assert.equal(config.endpoint, '/db');
    assert.equal(config.authDisabled, true);
  });

  test('rejects invalid transport, endpoint, and port', async () => {
    const { parseHttpTransportConfig } = await import('../../dist/core/http-config.js');

    assert.throws(() => parseHttpTransportConfig({ DB_MCP_TRANSPORT: 'tcp' }), /CLI_002/);
    assert.throws(() => parseHttpTransportConfig({ DB_HTTP_ENDPOINT: 'mcp' }), /CFG_005/);
    assert.throws(() => parseHttpTransportConfig({ DB_HTTP_PORT: '70000' }), /CFG_005/);
    assert.throws(
      () => parseHttpTransportConfig({ DB_HTTP_ALLOWED_HOSTS: '*.example.com' }),
      /CFG_005/,
    );
    assert.throws(
      () => parseHttpTransportConfig({ DB_HTTP_ALLOWED_HOSTS: 'example.com:443' }),
      /CFG_005/,
    );
  });

  test('parses and normalizes HTTP Host allowlist', async () => {
    const { parseHttpTransportConfig } = await import('../../dist/core/http-config.js');

    const config = parseHttpTransportConfig({
      DB_HTTP_ALLOWED_HOSTS: 'db.internal,DB.EXAMPLE.,[::1]',
    });

    assert.deepEqual(config.allowedHosts, [
      'localhost',
      '127.0.0.1',
      '::1',
      'db.internal',
      'db.example',
    ]);
  });

  test('HTTP defaults to bearer and keeps API key fallback explicit', async () => {
    const { parseHttpTransportConfig } = await import('../../dist/core/http-config.js');

    assert.throws(
      () =>
        parseHttpTransportConfig({
          DB_MCP_TRANSPORT: 'http',
          DB_HTTP_HOST: '0.0.0.0',
        }),
      /AUTH_006/,
    );

    const withBearer = parseHttpTransportConfig({
      DB_MCP_TRANSPORT: 'http',
      DB_HTTP_HOST: '0.0.0.0',
      DB_AUTH_ISSUER: 'https://idp.example.com/',
      DB_AUTH_AUDIENCE: 'polyglot-db-mcp-server',
      DB_AUTH_JWKS_FILE: './jwks.json',
    });
    assert.equal(withBearer.authMode, 'bearer');

    const withKey = parseHttpTransportConfig({
      DB_MCP_TRANSPORT: 'http',
      DB_HTTP_HOST: '0.0.0.0',
      DB_HTTP_API_KEY: 'dev-key',
    });
    assert.equal(withKey.apiKey, 'dev-key');
    assert.equal(withKey.authMode, 'api_key');

    const disabled = parseHttpTransportConfig({
      DB_MCP_TRANSPORT: 'http',
      DB_HTTP_HOST: '0.0.0.0',
      DB_AUTH_DISABLED: 'true',
    });
    assert.equal(disabled.authDisabled, true);
    assert.equal(disabled.authMode, 'none');
  });

  test('parses RBAC policy template configuration', async () => {
    const { parseHttpTransportConfig } = await import('../../dist/core/http-config.js');

    const config = parseHttpTransportConfig({
      DB_RBAC_POLICY_TEMPLATE: 'readonly-http',
    });

    assert.equal(config.rbacPolicyTemplate, 'readonly-http');
  });
});
