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
});
