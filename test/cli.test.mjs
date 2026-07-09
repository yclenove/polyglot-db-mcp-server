import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('CLI helpers', () => {
  test('buildDefaultEnvContent creates a parseable SQLite configuration', async () => {
    const { buildDefaultEnvContent } = await import('../dist/cli.js');
    const content = buildDefaultEnvContent(new Date('2026-07-10T00:00:00.000Z'));
    const line = content
      .split(/\r?\n/)
      .find((item) => item.startsWith('DB_MCP_CONNECTIONS='));

    assert.ok(line);
    const raw = line.slice('DB_MCP_CONNECTIONS='.length);
    const connections = JSON.parse(raw);

    assert.equal(connections.length, 1);
    assert.equal(connections[0].id, 'local');
    assert.equal(connections[0].engine, 'sqlite');
    assert.equal(connections[0].url, 'file:./data/local.db');
    assert.equal(connections[0].readonly, false);
    assert.match(content, /DB_MCP_DEFAULT_CONNECTION_ID=local/);
    assert.doesNotMatch(content, /password|secret|token/i);
  });

  test('parseInitOptions supports safe output and overwrite flags', async () => {
    const { parseInitOptions } = await import('../dist/cli.js');
    const options = parseInitOptions(['--stdout', '--force', '--path', 'sample.env']);

    assert.equal(options.stdout, true);
    assert.equal(options.force, true);
    assert.equal(options.path, 'sample.env');
    assert.equal(options.interactive, false);
  });

  test('parseInitOptions rejects unknown arguments with CLI_002', async () => {
    const { parseInitOptions } = await import('../dist/cli.js');

    assert.throws(() => parseInitOptions(['--bad']), /CLI_002/);
  });
});
