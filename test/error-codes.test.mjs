import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('ErrorCodes metadata', () => {
  test('core error definitions expose message, hint, severity, retryable, and applies_to', async () => {
    const { ErrorDefinitions, ErrorCodes, getErrorInfo } = await import(
      '../dist/core/error-codes.js'
    );

    assert.equal(ErrorCodes.CONN_006, '未知的 connection_id');
    const info = getErrorInfo('SQL_002');
    assert.equal(info.code, 'SQL_002');
    assert.match(info.message, /只读/);
    assert.match(info.hint, /readonly:false|只读查询/);
    assert.equal(info.severity, 'error');
    assert.equal(info.retryable, false);
    assert.ok(info.applies_to.includes('SQL'));
    assert.ok(Object.keys(ErrorDefinitions).includes('CLI_001'));
    assert.ok(Object.keys(ErrorDefinitions).includes('HTTP_005'));
  });

  test('createErrorPayload returns stable code and overrideable hint', async () => {
    const { createErrorPayload } = await import('../dist/core/error-codes.js');

    const payload = createErrorPayload(
      'CONN_006',
      { connection_id: 'missing', available_connections: ['local'] },
      '可用连接: local',
    );

    assert.equal(payload.code, 'CONN_006');
    assert.equal(payload.message, '未知的 connection_id');
    assert.equal(payload.hint, '可用连接: local');
    assert.equal(payload.details.connection_id, 'missing');
  });

  test('credential masking hides URL passwords and key-value secrets', async () => {
    const { maskErrorCredentials } = await import('../dist/core/error-codes.js');

    const masked = maskErrorCredentials(
      'postgres://user:secret@localhost/db password=hunter2 token: abc123 redis://:redispass@localhost:6379',
    );

    assert.match(masked, /postgres:\/\/user:\*\*\*@localhost/);
    assert.match(masked, /password=\*\*\*/);
    assert.match(masked, /token: \*\*\*/);
    assert.match(masked, /redis:\/\/:\*\*\*@localhost/);
    assert.doesNotMatch(masked, /hunter2|abc123|secret@|redispass@/);
  });
});
