import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertRedisKeyPrefix } from '../dist/core/redis-guards.js';

test('assertRedisKeyPrefix is a no-op without prefix', () => {
  assertRedisKeyPrefix('any:key');
});

test('assertRedisKeyPrefix enforces prefix when configured', () => {
  assertRedisKeyPrefix('app:foo:bar', 'app:');
  assert.throws(() => assertRedisKeyPrefix('other:foo', 'app:'), Error);
});