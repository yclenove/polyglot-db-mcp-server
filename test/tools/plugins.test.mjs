import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class MockMcpServer {
  constructor() {
    this.tools = new Map();
  }

  registerTool(name, schema, handler) {
    this.tools.set(name, { schema, handler });
  }
}

class MockRegistry {
  resolveConnectionId(id) {
    return id && id.trim() !== '' ? id : 'pg';
  }
}

function manifest(overrides = {}) {
  return {
    name: '@company/polyglot-clickhouse-plugin',
    version: '1.0.0',
    polyglotPluginVersion: '1',
    type: ['tool'],
    main: './dist/index.js',
    permissions: {
      connections: ['clickhouse:*'],
      actions: ['read'],
      network: true,
      filesystem: false,
    },
    tools: [
      {
        name: 'clickhouse_query',
        action: 'read',
        description: 'Execute readonly ClickHouse query',
      },
    ],
    ...overrides,
  };
}

describe('Plugin Tools', () => {
  let server;

  beforeEach(async () => {
    server = new MockMcpServer();
    const { registerPluginTools } = await import('../../dist/tools/plugins.js');
    registerPluginTools(server);
  });

  test('plugin tools are registered', () => {
    assert.ok(server.tools.has('plugin_list'));
    assert.ok(server.tools.has('plugin_validate_manifest'));
  });

  test('plugin_validate_manifest returns a sanitized manifest summary', async () => {
    const tool = server.tools.get('plugin_validate_manifest');
    const result = await tool.handler({ manifest_json: JSON.stringify(manifest()) });

    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.valid, true);
    assert.equal(payload.manifest.name, '@company/polyglot-clickhouse-plugin');
    assert.equal(payload.manifest.tools[0].name, 'clickhouse_query');
    assert.equal(JSON.stringify(payload).includes('dist/index.js'), false);
  });

  test('plugin_list returns disabled summary by default', async () => {
    const original = process.env.DB_PLUGIN_PATHS;
    delete process.env.DB_PLUGIN_PATHS;
    try {
      const tool = server.tools.get('plugin_list');
      const result = await tool.handler({});
      assert.equal(result.isError, undefined);
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.enabled, false);
      assert.equal(payload.count, 0);
      assert.deepEqual(payload.plugins, []);
    } finally {
      if (original === undefined) delete process.env.DB_PLUGIN_PATHS;
      else process.env.DB_PLUGIN_PATHS = original;
    }
  });

  test('plugin_validate_manifest reports invalid manifests as errors', async () => {
    const tool = server.tools.get('plugin_validate_manifest');
    const result = await tool.handler({ manifest_json: '{"name": ""}' });
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.valid, false);
    assert.match(payload.error, /CFG_005/);
  });

  test('external tool plugins register tools and runtime action metadata', async () => {
    const { registerExternalPluginTools } = await import('../../dist/tools/plugins.js');
    const { getToolActionInfo } = await import('../../dist/core/tool-action-map.js');
    const dir = mkdtempSync(join(tmpdir(), 'db-mcp-tool-plugin-'));
    const pluginDir = join(dir, 'tools');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'dist', 'index.js'),
      `export function registerTools(server) {
        server.registerTool('demo_plugin_read', { description: 'demo', inputSchema: {} }, async () => ({
          content: [{ type: 'text', text: JSON.stringify({ ok: true }) }]
        }));
      }\n`,
    );
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify(
        manifest({
          tools: [
            {
              name: 'demo_plugin_read',
              action: 'read',
              description: 'Demo plugin read tool',
            },
          ],
        }),
      ),
      'utf8',
    );
    const original = process.env.DB_PLUGIN_PATHS;

    try {
      process.env.DB_PLUGIN_PATHS = pluginDir;
      await registerExternalPluginTools(server);

      assert.ok(server.tools.has('demo_plugin_read'));
      assert.equal(getToolActionInfo('demo_plugin_read').action, 'read');
      const result = await server.tools.get('demo_plugin_read').handler({});
      assert.equal(JSON.parse(result.content[0].text).ok, true);
    } finally {
      if (original === undefined) delete process.env.DB_PLUGIN_PATHS;
      else process.env.DB_PLUGIN_PATHS = original;
      rmSync(dir, { recursive: true, force: true });
      await registerExternalPluginTools(new MockMcpServer());
    }
  });

  test('policy plugins can only add deny decisions', async () => {
    const { registerExternalPluginTools } = await import('../../dist/tools/plugins.js');
    const { createAuthorizationRuntime } = await import('../../dist/auth/authorization.js');
    const dir = mkdtempSync(join(tmpdir(), 'db-mcp-policy-plugin-'));
    const pluginDir = join(dir, 'policy');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'dist', 'index.js'),
      `export function evaluatePolicy(input) {
        return input.action === 'write'
          ? { allowed: false, reason: 'change ticket required by plugin' }
          : { allowed: true };
      }\n`,
    );
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify(
        manifest({
          type: ['policy'],
          tools: [],
          permissions: {
            connections: ['*'],
            actions: ['read', 'write'],
            network: false,
            filesystem: false,
          },
        }),
      ),
      'utf8',
    );
    const original = process.env.DB_PLUGIN_PATHS;

    try {
      process.env.DB_PLUGIN_PATHS = pluginDir;
      await registerExternalPluginTools(server);
      const runtime = createAuthorizationRuntime(new MockRegistry(), {
        mode: 'api_key',
        defaultEffect: 'deny',
      });
      const read = runtime.authorize('sql_query', { connection_id: 'pg' });
      assert.equal(read.allowed, true);

      const write = runtime.authorize('sql_execute', { connection_id: 'pg' });
      assert.equal(write.allowed, false);
      assert.equal(write.reason, 'change ticket required by plugin');
    } finally {
      if (original === undefined) delete process.env.DB_PLUGIN_PATHS;
      else process.env.DB_PLUGIN_PATHS = original;
      rmSync(dir, { recursive: true, force: true });
      await registerExternalPluginTools(new MockMcpServer());
    }
  });

  test('export plugins receive audit events without blocking auditLog', async () => {
    const { registerExternalPluginTools } = await import('../../dist/tools/plugins.js');
    const { auditLog } = await import('../../dist/core/audit.js');
    const dir = mkdtempSync(join(tmpdir(), 'db-mcp-export-plugin-'));
    const pluginDir = join(dir, 'export');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'dist', 'index.js'),
      `export function exportEvent(event) {
        globalThis.__dbMcpExportEvents = globalThis.__dbMcpExportEvents || [];
        globalThis.__dbMcpExportEvents.push(event);
      }\n`,
    );
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify(
        manifest({
          type: ['export'],
          tools: [],
          permissions: {
            connections: ['*'],
            actions: ['export'],
            network: false,
            filesystem: false,
          },
        }),
      ),
      'utf8',
    );
    const original = process.env.DB_PLUGIN_PATHS;
    globalThis.__dbMcpExportEvents = [];

    try {
      process.env.DB_PLUGIN_PATHS = pluginDir;
      await registerExternalPluginTools(server);
      auditLog({ engine: 'plugin', operation: 'export_plugin_probe', success: true });
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(globalThis.__dbMcpExportEvents.length, 1);
      assert.equal(globalThis.__dbMcpExportEvents[0].operation, 'export_plugin_probe');
    } finally {
      if (original === undefined) delete process.env.DB_PLUGIN_PATHS;
      else process.env.DB_PLUGIN_PATHS = original;
      delete globalThis.__dbMcpExportEvents;
      rmSync(dir, { recursive: true, force: true });
      await registerExternalPluginTools(new MockMcpServer());
    }
  });
});
