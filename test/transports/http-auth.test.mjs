import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const issuer = 'https://idp.example.com/';
const audience = 'polyglot-db-mcp-server';
const protocolVersion = '2025-11-25';

function mcpHeaders(token, sessionId) {
  return {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    ...(sessionId ? { 'mcp-protocol-version': protocolVersion } : {}),
  };
}

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

async function authFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'polyglot-auth-'));
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'http-auth-key';
  publicJwk.alg = 'RS256';

  const jwksFile = join(dir, 'jwks.json');
  const policyFile = join(dir, 'policy.json');
  writeFileSync(jwksFile, JSON.stringify({ keys: [publicJwk] }), 'utf8');
  writeFileSync(
    policyFile,
    JSON.stringify({
      version: 'http-auth-test',
      roles: {
        readonly_analyst: [{ resources: ['connection:local'], actions: ['read', 'diagnose'] }],
        no_access: [{ resources: ['connection:other'], actions: ['read'] }],
      },
      bindings: [
        { subject: 'agent:reader', roles: ['readonly_analyst'] },
        { subject: 'agent:no-role-match', roles: ['no_access'] },
      ],
    }),
    'utf8',
  );

  async function token(subject) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ scope: 'read' })
      .setProtectedHeader({ alg: 'RS256', kid: 'http-auth-key' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }

  return { dir, jwksFile, policyFile, token };
}

describe('HTTP bearer auth and RBAC', () => {
  let fixture;
  let sqlite;
  let started;
  let transport;

  beforeEach(async () => {
    fixture = await authFixture();
    sqlite = await createSqliteRegistry();
  });

  afterEach(async () => {
    if (transport) {
      await transport.close();
      transport = undefined;
    }
    if (started) {
      await started.close();
      started = undefined;
    }
    if (sqlite) {
      await sqlite.close();
      sqlite = undefined;
    }
    if (fixture) {
      rmSync(fixture.dir, { recursive: true, force: true });
      fixture = undefined;
    }
  });

  async function start() {
    const { startHttpTransport } = await import('../../dist/transports/http.js');
    const { createAuthorizationRuntime } = await import('../../dist/auth/authorization.js');
    const config = {
      transport: 'http',
      host: '127.0.0.1',
      port: 0,
      endpoint: '/mcp',
      origins: [],
      allowedHosts: ['localhost', '127.0.0.1', '::1'],
      apiKey: undefined,
      authDisabled: false,
      authMode: 'bearer',
      authIssuer: issuer,
      authAudience: audience,
      authJwksFile: fixture.jwksFile,
      rbacPolicyFile: fixture.policyFile,
      rbacDefaultEffect: 'deny',
      bodyLimitBytes: 1024 * 1024,
      requestTimeoutMs: 5000,
      maxSessions: 1000,
      sessionIdleTimeoutMs: 30 * 60_000,
      eventStoreMaxEvents: 1000,
      eventStoreMaxBytes: 8 * 1024 * 1024,
    };
    const authorization = createAuthorizationRuntime(sqlite.registry, {
      mode: config.authMode,
      policyFile: config.rbacPolicyFile,
      defaultEffect: config.rbacDefaultEffect,
    });
    started = await startHttpTransport({
      registry: sqlite.registry,
      config,
      authorization,
      startupPings: [{ id: 'local', ok: true, latencyMs: 1 }],
    });
    return started;
  }

  async function clientFor(subject) {
    const server = await start();
    const token = await fixture.token(subject);
    const client = new Client({ name: `client-${subject}`, version: '1.0.0' });
    transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    return client;
  }

  test('rejects missing bearer token before MCP handling', async () => {
    const server = await start();
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.data.error_info.code, 'AUTH_003');
  });

  test('valid readonly token can read but not write', async () => {
    const client = await clientFor('agent:reader');

    const read = await client.callTool({
      name: 'sql_query',
      arguments: { sql: 'SELECT 1 AS value' },
    });
    assert.equal(read.isError, undefined);
    assert.equal(JSON.parse(read.content[0].text).data[0].value, 1);

    const write = await client.callTool({
      name: 'sql_execute',
      arguments: { sql: 'CREATE TABLE blocked(id INTEGER)' },
    });
    assert.equal(write.isError, true);
    assert.equal(JSON.parse(write.content[0].text).error_info.code, 'AUTH_005');
  });

  test('valid token without matching resource is denied by RBAC', async () => {
    const client = await clientFor('agent:no-role-match');

    const result = await client.callTool({
      name: 'sql_query',
      arguments: { sql: 'SELECT 1 AS value' },
    });

    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.error_info.code, 'AUTH_005');
    assert.match(payload.error_info.details.reason, /no rule matched/);
  });

  test('an HTTP session cannot be reused by another authenticated principal', async () => {
    const server = await start();
    const readerToken = await fixture.token('agent:reader');
    const otherToken = await fixture.token('agent:no-role-match');
    const initialized = await fetch(server.url, {
      method: 'POST',
      headers: mcpHeaders(readerToken),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: 'principal-binding-test', version: '1.0.0' },
        },
      }),
    });
    assert.equal(initialized.status, 200);
    const sessionId = initialized.headers.get('mcp-session-id');
    assert.ok(sessionId);
    await initialized.json();

    const notification = await fetch(server.url, {
      method: 'POST',
      headers: mcpHeaders(readerToken, sessionId),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.equal(notification.status, 202);
    await notification.body?.cancel();

    const post = await fetch(server.url, {
      method: 'POST',
      headers: mcpHeaders(otherToken, sessionId),
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    const get = await fetch(server.url, {
      method: 'GET',
      headers: {
        ...mcpHeaders(otherToken, sessionId),
        accept: 'text/event-stream',
      },
    });
    const del = await fetch(server.url, {
      method: 'DELETE',
      headers: mcpHeaders(otherToken, sessionId),
    });

    for (const response of [post, get, del]) {
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.data.error_info.code, 'HTTP_004');
    }

    const cleanup = await fetch(server.url, {
      method: 'DELETE',
      headers: mcpHeaders(readerToken, sessionId),
    });
    assert.equal(cleanup.status, 200);
    await cleanup.body?.cancel();
  });
});
