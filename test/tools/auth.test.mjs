import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';

class MockMcpServer {
  constructor() {
    this.tools = new Map();
  }

  registerTool(name, schema, handler) {
    this.tools.set(name, { schema, handler });
  }
}

describe('Auth Tools', () => {
  let server;

  beforeEach(async () => {
    server = new MockMcpServer();
    const { registerAuthTools } = await import('../../dist/tools/auth.js');
    registerAuthTools(server);
  });

  test('auth_policy_template tool is registered', () => {
    assert.ok(server.tools.has('auth_policy_template'));
  });

  test('auth_policy_template returns a valid policy template', async () => {
    const templateTool = server.tools.get('auth_policy_template');
    const validateTool = server.tools.get('auth_policy_validate');

    const templateResult = await templateTool.handler({ name: 'readonly-http' });
    assert.equal(templateResult.isError, undefined);

    const templatePayload = JSON.parse(templateResult.content[0].text);
    assert.equal(templatePayload.name, 'readonly-http');
    assert.equal(templatePayload.policy.version, 'template:readonly-http:v1');
    assert.ok(templatePayload.available_templates.includes('local-admin'));

    const validateResult = await validateTool.handler({
      policy_json: JSON.stringify(templatePayload.policy),
    });
    const validatePayload = JSON.parse(validateResult.content[0].text);
    assert.equal(validatePayload.valid, true);
    assert.ok(validatePayload.roles.includes('readonly_analyst'));
  });
});
