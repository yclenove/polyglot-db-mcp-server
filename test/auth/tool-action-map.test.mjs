import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

function registeredToolNames() {
  const names = [];
  for (const file of readdirSync('src/tools')) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(join('src/tools', file), 'utf8');
    for (const match of source.matchAll(/registerTool\(\s*['"]([^'"]+)/g)) {
      names.push(match[1]);
    }
  }
  return names.sort();
}

describe('tool action map', () => {
  test('covers every registered tool', async () => {
    const { knownToolNames } = await import('../../dist/core/tool-action-map.js');
    const known = new Set(knownToolNames());
    const missing = registeredToolNames().filter((name) => !known.has(name));

    assert.deepEqual(missing, []);
  });

  test('classifies representative tools conservatively', async () => {
    const { getToolActionInfo } = await import('../../dist/core/tool-action-map.js');

    assert.equal(getToolActionInfo('sql_query').action, 'read');
    assert.equal(getToolActionInfo('sql_execute').action, 'write');
    assert.equal(getToolActionInfo('mongo_drop_collection').action, 'admin');
    assert.equal(getToolActionInfo('redis_pipeline').action, 'write');
    assert.equal(getToolActionInfo('export_audit').action, 'export');
  });
});
