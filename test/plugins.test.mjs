import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function validManifest(overrides = {}) {
  return {
    name: '@company/polyglot-clickhouse-plugin',
    version: '1.0.0',
    polyglotPluginVersion: '1',
    type: ['driver', 'tool'],
    main: './dist/index.js',
    driverEngines: ['clickhouse'],
    engines: {
      'polyglot-db-mcp-server': '>=3.0.0',
      node: '>=20',
    },
    permissions: {
      connections: ['clickhouse:*'],
      actions: ['read', 'diagnose'],
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
    configSchema: {
      type: 'object',
      properties: { timeoutMs: { type: 'number' } },
    },
    ...overrides,
  };
}

describe('plugin discovery config', () => {
  test('defaults to disabled and parses comma-separated paths', async () => {
    const { parsePluginDiscoveryConfig } = await import('../dist/core/plugins.js');

    assert.deepEqual(parsePluginDiscoveryConfig({}), { paths: [] });
    assert.deepEqual(parsePluginDiscoveryConfig({ DB_PLUGIN_PATHS: ' ./one,./two ,, ' }), {
      paths: ['./one', './two'],
    });
  });
});

describe('plugin manifest validation', () => {
  test('parses a manifest-first plugin declaration', async () => {
    const { parsePluginManifest } = await import('../dist/core/plugins.js');

    const manifest = parsePluginManifest(validManifest());
    assert.equal(manifest.name, '@company/polyglot-clickhouse-plugin');
    assert.deepEqual(manifest.type, ['driver', 'tool']);
    assert.equal(manifest.permissions.network, true);
    assert.equal(manifest.tools[0].name, 'clickhouse_query');
  });

  test('rejects invalid type, action, and unsafe main paths', async () => {
    const { parsePluginManifest } = await import('../dist/core/plugins.js');

    assert.throws(() => parsePluginManifest(validManifest({ type: ['market'] })), /CFG_005/);
    assert.throws(
      () =>
        parsePluginManifest(
          validManifest({
            permissions: {
              connections: ['*'],
              actions: ['superuser'],
              network: false,
              filesystem: false,
            },
          }),
        ),
      /CFG_005/,
    );
    assert.throws(() => parsePluginManifest(validManifest({ main: '../outside.js' })), /CFG_005/);
  });
});

describe('local plugin discovery', () => {
  test('discovers plugin.json without executing plugin main', async () => {
    const { discoverPlugins, safePluginDiscoverySummary } = await import('../dist/core/plugins.js');
    const dir = mkdtempSync(join(tmpdir(), 'db-mcp-plugin-'));
    const pluginDir = join(dir, 'clickhouse');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(join(pluginDir, 'dist', 'index.js'), 'throw new Error("should not execute");\n');
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(validManifest()), 'utf8');

    try {
      const plugins = discoverPlugins({ paths: [pluginDir] });
      assert.equal(plugins.length, 1);
      assert.equal(plugins[0].manifest.name, '@company/polyglot-clickhouse-plugin');

      const safe = safePluginDiscoverySummary(plugins);
      assert.equal(safe.enabled, true);
      assert.equal(safe.count, 1);
      assert.equal(JSON.stringify(safe).includes(pluginDir), false);
      assert.equal(safe.plugins[0].tools[0].name, 'clickhouse_query');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('loads driver plugin modules and creates registry handles for custom engines', async () => {
    const { createRegistryFromEnv, closeAll, pingAll } = await import('../dist/bootstrap.js');
    const dir = mkdtempSync(join(tmpdir(), 'db-mcp-driver-plugin-'));
    const pluginDir = join(dir, 'acme');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'dist', 'index.js'),
      `export async function createDriver(spec) {
        return {
          id: spec.id,
          spec,
          kind: 'plugin',
          driver: {
            async ping() { return { ok: true }; },
            async close() {}
          }
        };
      }\n`,
    );
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify(
        validManifest({
          type: ['driver'],
          driverEngines: ['acme'],
          tools: [],
          permissions: {
            connections: ['acme:*'],
            actions: ['read'],
            network: false,
            filesystem: false,
          },
        }),
      ),
      'utf8',
    );

    const original = {
      DB_PLUGIN_PATHS: process.env.DB_PLUGIN_PATHS,
      DB_MCP_CONNECTIONS: process.env.DB_MCP_CONNECTIONS,
      DB_MCP_DEFAULT_CONNECTION_ID: process.env.DB_MCP_DEFAULT_CONNECTION_ID,
    };

    try {
      process.env.DB_PLUGIN_PATHS = pluginDir;
      process.env.DB_MCP_CONNECTIONS = JSON.stringify([
        { id: 'acme1', engine: 'acme', url: 'acme://local', readonly: true },
      ]);
      delete process.env.DB_MCP_DEFAULT_CONNECTION_ID;

      const registry = await createRegistryFromEnv();
      assert.equal(registry.listMeta()[0].engine, 'acme');
      assert.equal(registry.require('acme1').kind, 'plugin');
      const pings = await pingAll(registry);
      assert.equal(pings[0].ok, true);
      await closeAll(registry);
    } finally {
      if (original.DB_PLUGIN_PATHS === undefined) delete process.env.DB_PLUGIN_PATHS;
      else process.env.DB_PLUGIN_PATHS = original.DB_PLUGIN_PATHS;
      if (original.DB_MCP_CONNECTIONS === undefined) delete process.env.DB_MCP_CONNECTIONS;
      else process.env.DB_MCP_CONNECTIONS = original.DB_MCP_CONNECTIONS;
      if (original.DB_MCP_DEFAULT_CONNECTION_ID === undefined)
        delete process.env.DB_MCP_DEFAULT_CONNECTION_ID;
      else process.env.DB_MCP_DEFAULT_CONNECTION_ID = original.DB_MCP_DEFAULT_CONNECTION_ID;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails fast for missing plugin directory or manifest', async () => {
    const { discoverPlugins } = await import('../dist/core/plugins.js');
    const dir = mkdtempSync(join(tmpdir(), 'db-mcp-plugin-missing-'));

    try {
      assert.throws(() => discoverPlugins({ paths: [join(dir, 'missing')] }), /CFG_005/);
      assert.throws(() => discoverPlugins({ paths: [dir] }), /CFG_005/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
