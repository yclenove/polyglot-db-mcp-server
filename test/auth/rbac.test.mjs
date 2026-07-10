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
          conditions: { maxRows: 500, transport: ['http'], maskingMode: 'strict-v2' },
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
    assert.equal(decision.conditions.maskingMode, 'strict-v2');
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

  test('applies maxRows to sampling and scan count style inputs', async () => {
    const { parseRbacPolicy, authorizeWithPolicy } = await import('../../dist/auth/rbac.js');
    const policy = parseRbacPolicy(samplePolicy());

    const sampleDecision = authorizeWithPolicy(policy, {
      subject: 'agent:report',
      action: 'read',
      resources: ['connection:pg', 'tool:sql_sample_table'],
      input: { sample_size: 1000 },
      transport: 'http',
    });
    assert.equal(sampleDecision.allowed, false);
    assert.match(sampleDecision.reason, /exceeds maxRows/);

    const scanDecision = authorizeWithPolicy(policy, {
      subject: 'agent:report',
      action: 'read',
      resources: ['connection:pg', 'tool:redis_scan'],
      input: { count: 1000 },
      transport: 'http',
    });
    assert.equal(scanDecision.allowed, false);
    assert.match(scanDecision.reason, /exceeds maxRows/);
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

  test('requires approval claim when policy condition demands it', async () => {
    const { parseRbacPolicy, authorizeWithPolicy } = await import('../../dist/auth/rbac.js');
    const policy = parseRbacPolicy({
      version: 'approval-policy',
      roles: {
        approved_writer: [
          {
            resources: ['connection:pg'],
            actions: ['write'],
            conditions: { approvalRequired: true },
          },
        ],
      },
      bindings: [{ subject: 'agent:writer', roles: ['approved_writer'] }],
    });

    const denied = authorizeWithPolicy(policy, {
      subject: 'agent:writer',
      action: 'write',
      resources: ['connection:pg', 'tool:sql_execute'],
      input: {},
      transport: 'http',
      claims: { sub: 'agent:writer' },
    });
    assert.equal(denied.allowed, false);
    assert.match(denied.reason, /approval claim db_mcp_approval is required/);

    const allowed = authorizeWithPolicy(policy, {
      subject: 'agent:writer',
      action: 'write',
      resources: ['connection:pg', 'tool:sql_execute'],
      input: {},
      transport: 'http',
      claims: {
        sub: 'agent:writer',
        db_mcp_approval: { status: 'approved', expires_at: '2999-01-01T00:00:00.000Z' },
      },
    });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.conditions.approvalRequired, true);
  });

  test('rejects expired approval claim and supports custom approval claim name', async () => {
    const { parseRbacPolicy, authorizeWithPolicy } = await import('../../dist/auth/rbac.js');
    const policy = parseRbacPolicy({
      version: 'custom-approval-policy',
      roles: {
        approved_admin: [
          {
            resources: ['*'],
            actions: ['admin'],
            conditions: { approvalRequired: true, approvalClaim: 'change_ticket' },
          },
        ],
      },
      bindings: [{ subject: 'agent:admin', roles: ['approved_admin'] }],
    });

    const expired = authorizeWithPolicy(policy, {
      subject: 'agent:admin',
      action: 'admin',
      resources: ['connection:pg', 'tool:sql_create_index'],
      input: {},
      transport: 'http',
      claims: {
        sub: 'agent:admin',
        change_ticket: { status: 'approved', expires_at: '2000-01-01T00:00:00.000Z' },
      },
    });
    assert.equal(expired.allowed, false);
    assert.match(expired.reason, /approval claim change_ticket is required/);

    const approved = authorizeWithPolicy(policy, {
      subject: 'agent:admin',
      action: 'admin',
      resources: ['connection:pg', 'tool:sql_create_index'],
      input: {},
      transport: 'http',
      claims: { sub: 'agent:admin', change_ticket: 'ticket-123' },
    });
    assert.equal(approved.allowed, true);
  });
});

describe('RBAC policy templates', () => {
  test('lists and loads built-in templates', async () => {
    const { listRbacPolicyTemplates, loadRbacPolicyTemplate } = await import(
      '../../dist/auth/rbac.js'
    );

    const names = listRbacPolicyTemplates();
    assert.ok(names.includes('readonly-http'));
    assert.ok(names.includes('local-admin'));

    const policy = loadRbacPolicyTemplate('readonly-http');
    assert.equal(policy.version, 'template:readonly-http:v1');
    assert.ok(policy.roles.readonly_analyst);
  });

  test('template policies are cloned per load', async () => {
    const { loadRbacPolicyTemplate } = await import('../../dist/auth/rbac.js');

    const first = loadRbacPolicyTemplate('readonly-http');
    first.roles.readonly_analyst[0].resources.push('connection:mutated');

    const second = loadRbacPolicyTemplate('readonly-http');
    assert.equal(second.roles.readonly_analyst[0].resources.includes('connection:mutated'), false);
  });

  test('readonly-http template allows bounded HTTP reads and denies writes', async () => {
    const { authorizeWithPolicy, loadRbacPolicyTemplate } = await import('../../dist/auth/rbac.js');
    const policy = loadRbacPolicyTemplate('readonly-http');

    const read = authorizeWithPolicy(policy, {
      subject: 'agent:any',
      action: 'read',
      resources: ['connection:pg', 'tool:sql_query'],
      input: { limit: 100 },
      transport: 'http',
    });
    assert.equal(read.allowed, true);
    assert.equal(read.conditions.maskingMode, 'strict-v2');

    const write = authorizeWithPolicy(policy, {
      subject: 'agent:any',
      action: 'write',
      resources: ['connection:pg', 'tool:sql_execute'],
      input: {},
      transport: 'http',
    });
    assert.equal(write.allowed, false);

    const tooManyRows = authorizeWithPolicy(policy, {
      subject: 'agent:any',
      action: 'read',
      resources: ['connection:pg', 'tool:sql_query'],
      input: { limit: 2000 },
      transport: 'http',
    });
    assert.equal(tooManyRows.allowed, false);
    assert.match(tooManyRows.reason, /exceeds maxRows/);
  });
});
