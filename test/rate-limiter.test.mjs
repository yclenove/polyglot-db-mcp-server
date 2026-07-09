import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RateLimiter } from '../dist/core/rate-limiter.js';

describe('RateLimiter', () => {
  test('disabled limiter always allows without creating buckets', () => {
    const limiter = new RateLimiter(0);
    assert.equal(limiter.allow('a'), true);
    assert.equal(limiter.allow('a'), true);
    assert.equal(limiter.size, 0);
  });

  test('consumes tokens per key', () => {
    let now = 1000;
    const limiter = new RateLimiter(2, { now: () => now, cleanupIntervalMs: 0 });
    assert.equal(limiter.allow('a'), true);
    assert.equal(limiter.allow('a'), true);
    assert.equal(limiter.allow('a'), false);
    assert.equal(limiter.size, 1);
  });

  test('tracks independent buckets per key', () => {
    let now = 1000;
    const limiter = new RateLimiter(1, { now: () => now, cleanupIntervalMs: 0 });
    assert.equal(limiter.allow('a'), true);
    assert.equal(limiter.allow('a'), false);
    assert.equal(limiter.allow('b'), true);
    assert.equal(limiter.size, 2);
  });

  test('refills tokens over time', () => {
    let now = 1000;
    const limiter = new RateLimiter(1, { now: () => now, cleanupIntervalMs: 0 });
    assert.equal(limiter.allow('a'), true);
    assert.equal(limiter.allow('a'), false);
    now += 1000;
    assert.equal(limiter.allow('a'), true);
  });

  test('cleans inactive buckets without removing active ones', () => {
    let now = 1000;
    const limiter = new RateLimiter(1, { now: () => now, idleTtlMs: 100, cleanupIntervalMs: 0 });
    limiter.allow('old');
    now += 50;
    limiter.allow('active');
    now += 60;
    assert.equal(limiter.cleanup(), 1);
    assert.equal(limiter.size, 1);
    now += 1000;
    assert.equal(limiter.allow('active'), true);
  });

  test('dispose clears cleanup timer', () => {
    const limiter = new RateLimiter(1, { cleanupIntervalMs: 1000 });
    assert.doesNotThrow(() => limiter.dispose());
  });
});
