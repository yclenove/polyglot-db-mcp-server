import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { getVersion } from '../dist/core/version.js';

describe('getVersion', () => {
  test('matches package.json version', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(getVersion(), pkg.version);
  });

  test('returns stable cached value', () => {
    assert.equal(getVersion(), getVersion());
  });
});
