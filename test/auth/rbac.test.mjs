import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

function samplePolicy() {
  return {
    version: 'test-policy',
    roles: {
      readonly_analyst: [
        {
          resources: ['connection:pg', 'tool:auth_whoami'],
          actions: ['read', 'diagnose'],
          conditions: { maxRows: 500, transport: ['http'] },
        },
      ],
      writer: [{ resources: ['connection:pg'], actions: ['read', 'write'] }],
    },
    bindings: [
      { subject: 'agent:report', roles: ['readonly_analyst'] },
      { subject: 'agent:writer', roles: ['writer'] },
    ],
  };
}

describe('RBAC policy authorization', () => {
  test('allows matching subject, action, resource, and transport', async () => {
    const { parseRbacPolicy, authorizeWithPolicy } = await import('../../dist/auth/rbac.js');
    const policy = parseRbacPolicy(samplePolicy());

    const decision = authorizeWithPolicy(policy, {
      subject: 'agent:report',
      action: 'read',
      resources: ['connection:pg', 'tool:sql_query'],
      input: { limit: 100 },
      transport: 'http',
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.matchedRole, 'readonly_analyst');
    assert.equal(decision.policyVersion, 'test-policy');
  });

  test('denies write for readonly role', async () => {
    const { parseRbacPolicy, authorizeWithPolicy } = await import('../../dist/auth/rbac.js');
    const policy = parseRbacPolicy(samplePolicy());

    const decision = authorizeWithPolicy(policy, {
      subject: 'agent:report',
      action: 'write',
      resources: ['connection:pg', 'tool:sql_execute'],
      input: {},
      transport: 'http',
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'no rule matched');
  });

  test('denies maxRows condition violations', async () => {
    const { parseRbacPolicy, authorizeWithPolicy } = await import('../../dist/auth/rbac.js');
    const policy = parseRbacPolicy(samplePolicy());

    const decision = authorizeWithPolicy(policy, {
      subject: 'agent:report',
      action: 'read',
      resources: ['connection:pg', 'tool:sql_query'],
      input: { limit: 1000 },
      transport: 'http',
    });

    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /exceeds maxRows/);
  });

  test('default deny applies when subject has no binding', async () => {
    const { parseRbacPolicy, authorizeWithPolicy } = await import('../../dist/auth/rbac.js');
    const policy = parseRbacPolicy(samplePolicy());

    const decision = authorizeWithPolicy(policy, {
      subject: 'agent:unknown',
      action: 'read',
      resources: ['connection:pg'],
      input: {},
      transport: 'http',
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'no role matched');
  });
});
