import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { QueryCache, cacheKey } from '../dist/core/query-cache.js';

function withFakeNow(start, fn) {
  const originalNow = Date.now;
  let now = start;
  Date.now = () => now;
  try {
    return fn({
      advance(ms) {
        now += ms;
      },
    });
  } finally {
    Date.now = originalNow;
  }
}

describe('QueryCache', () => {
  test('disabled cache never stores entries', () => {
    const cache = new QueryCache(0, 1000);
    cache.set('a', { ok: true });
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.size, 0);
    assert.deepEqual(cache.getStats(), {
      enabled: false,
      maxSize: 0,
      ttlMs: 1000,
      size: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
    });
  });

  test('tracks hits, misses, and hit rate', () => {
    const cache = new QueryCache(2, 1000);
    assert.equal(cache.get('missing'), undefined);
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('a'), 1);
    const stats = cache.getStats();
    assert.equal(stats.hits, 2);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hitRate, 66.67);
  });

  test('evicts least recently used entry', () => {
    const cache = new QueryCache(2, 1000);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.equal(cache.get('a'), 1);
    cache.set('c', 3);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('c'), 3);
  });

  test('expires entries by ttl', () => {
    withFakeNow(1000, (clock) => {
      const cache = new QueryCache(2, 50);
      cache.set('a', 1);
      assert.equal(cache.get('a'), 1);
      clock.advance(51);
      assert.equal(cache.get('a'), undefined);
      assert.equal(cache.size, 0);
    });
  });

  test('clear removes data and resets counters', () => {
    const cache = new QueryCache(2, 1000);
    cache.get('missing');
    cache.set('a', 1);
    cache.get('a');
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.getStats().hits, 0);
    assert.equal(cache.getStats().misses, 0);
  });
});

describe('cacheKey', () => {
  test('is stable for object key order', () => {
    assert.equal(
      cacheKey('pg', 'select $1', [{ a: 1, b: 2 }]),
      cacheKey('pg', 'select $1', [{ b: 2, a: 1 }])
    );
  });

  test('distinguishes special values that JSON.stringify collapses', () => {
    const keys = new Set([
      cacheKey('pg', 'select $1', [undefined]),
      cacheKey('pg', 'select $1', [null]),
      cacheKey('pg', 'select $1', [{ type: 'undefined' }]),
      cacheKey('pg', 'select $1', [new Date('2026-01-01T00:00:00.000Z')]),
      cacheKey('pg', 'select $1', ['2026-01-01T00:00:00.000Z']),
      cacheKey('pg', 'select $1', [1n]),
      cacheKey('pg', 'select $1', ['1']),
      cacheKey('pg', 'select $1', [Number.NaN]),
      cacheKey('pg', 'select $1', [null]),
    ]);
    assert.equal(keys.size, 8);
  });

  test('throws a clear error for circular params', () => {
    const circular = {};
    circular.self = circular;
    assert.throws(() => cacheKey('pg', 'select $1', [circular]), /循环引用/);
  });
}
);
