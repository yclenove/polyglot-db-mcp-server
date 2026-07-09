import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

class MockRegistry {
  getDefaultId() {
    return 'pg';
  }
  resolveConnectionId(id) {
    return id && id.trim() !== '' ? id : 'pg';
  }
}

function extra(subject) {
  return {
    authInfo: {
      token: 'super-secret-token',
      clientId: subject,
      scopes: ['read'],
      extra: {
        subject,
        transport: 'http',
        authMode: 'bearer',
        claims: { sub: subject },
      },
    },
  };
}

class MockMcpServer {
  constructor() {
    this.tools = new Map();
  }
  registerTool(name, config, handler) {
    this.tools.set(name, { config, handler });
  }
}

describe('authorization runtime audit', () => {
  test('records allow and deny decisions without token leakage', async () => {
    const { createAuthorizationRuntime } = await import('../../dist/auth/authorization.js');
    const { getRecentAuditLogs } = await import('../../dist/core/audit.js');
    const runtime = createAuthorizationRuntime(new MockRegistry(), {
      mode: 'bearer',
      defaultEffect: 'deny',
    });

    const deny = runtime.authorize('sql_query', { connection_id: 'pg' }, extra('agent:audit-deny'));
    assert.equal(deny.allowed, false);

    const fallback = createAuthorizationRuntime(new MockRegistry(), {
      mode: 'api_key',
      defaultEffect: 'deny',
    });
    const allow = fallback.authorize(
      'sql_query',
      { connection_id: 'pg' },
      extra('agent:audit-allow'),
    );
    assert.equal(allow.allowed, true);

    const logs = getRecentAuditLogs(20).filter(
      (entry) =>
        entry.operation === 'authorization' &&
        (entry.subject === 'agent:audit-deny' || entry.subject === 'agent:audit-allow'),
    );

    assert.equal(logs.length, 2);
    assert.deepEqual(
      logs.map((entry) => entry.decision).sort(),
      ['allow', 'deny'],
    );
    assert.equal(JSON.stringify(logs).includes('super-secret-token'), false);
  });

  test('exposes matched policy conditions during tool execution', async () => {
    const { installAuthorization } = await import('../../dist/auth/authorization.js');
    const { getRequestPolicyConditions } = await import('../../dist/auth/request-policy.js');
    const { resetObservabilityForTests } = await import('../../dist/core/observability.js');
    resetObservabilityForTests();
    const server = new MockMcpServer();

    installAuthorization(server, {
      authorize() {
        return {
          allowed: true,
          reason: 'matched policy rule',
          roles: ['readonly_analyst'],
          action: 'read',
          subject: 'agent:report',
          transport: 'http',
          conditions: { maskingMode: 'strict-v2' },
        };
      },
    });

    server.registerTool('probe', {}, async () => ({
      content: [{ type: 'text', text: JSON.stringify(getRequestPolicyConditions()) }],
    }));

    const result = await server.tools.get('probe').handler({}, extra('agent:report'));
    const conditions = JSON.parse(result.content[0].text);
    assert.equal(conditions.maskingMode, 'strict-v2');
    assert.equal(getRequestPolicyConditions(), undefined);
  });

  test('records tool call observability metrics for allow and deny paths', async () => {
    const { installAuthorization } = await import('../../dist/auth/authorization.js');
    const { getToolCallMetrics, resetObservabilityForTests } = await import(
      '../../dist/core/observability.js'
    );
    resetObservabilityForTests();
    const server = new MockMcpServer();
    let allow = true;

    installAuthorization(server, {
      authorize() {
        return {
          allowed: allow,
          reason: allow ? 'ok' : 'blocked',
          roles: ['readonly_analyst'],
          action: 'read',
          connectionId: 'pg',
          subject: 'agent:metrics',
          transport: 'http',
        };
      },
    });

    server.registerTool('probe_metrics', {}, async () => ({
      content: [{ type: 'text', text: 'ok' }],
    }));

    await server.tools.get('probe_metrics').handler({}, extra('agent:metrics'));
    allow = false;
    const denied = await server.tools.get('probe_metrics').handler({}, extra('agent:metrics'));

    assert.equal(denied.isError, true);
    const metrics = getToolCallMetrics().find((metric) => metric.tool === 'probe_metrics');
    assert.ok(metrics);
    assert.equal(metrics.totalCalls, 2);
    assert.equal(metrics.failedCalls, 1);
    assert.equal(metrics.byErrorCode.AUTH_005, 1);
  });

  test('can authorize with a built-in policy template', async () => {
    const { createAuthorizationRuntime } = await import('../../dist/auth/authorization.js');
    const runtime = createAuthorizationRuntime(new MockRegistry(), {
      mode: 'bearer',
      defaultEffect: 'deny',
      policyTemplate: 'readonly-http',
    });

    const read = runtime.authorize(
      'sql_query',
      { connection_id: 'pg', limit: 100 },
      extra('agent:template-reader'),
    );
    assert.equal(read.allowed, true);
    assert.equal(read.policyVersion, 'template:readonly-http:v1');
    assert.equal(read.conditions.maskingMode, 'strict-v2');

    const write = runtime.authorize(
      'sql_execute',
      { connection_id: 'pg' },
      extra('agent:template-reader'),
    );
    assert.equal(write.allowed, false);
  });
});
