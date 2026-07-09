import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { withTimeout, sleep } from '../../dist/drivers/sql/timeout.js';

describe('withTimeout', () => {
  test('resolves when promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000);
    assert.equal(result, 'ok');
  });

  test('rejects when promise exceeds timeout', async () => {
    await assert.rejects(
      () => withTimeout(new Promise((r) => setTimeout(r, 5000)), 50),
      (err) => {
        assert.ok(err.message.includes('查询超时'));
        return true;
      }
    );
  });

  test('returns value from slow but within-timeout promise', async () => {
    const result = await withTimeout(
      new Promise((resolve) => setTimeout(() => resolve(42), 20)),
      500
    );
    assert.equal(result, 42);
  });

  test('skips timeout when timeoutMs <= 0', async () => {
    const result = await withTimeout(Promise.resolve('no-timeout'), 0);
    assert.equal(result, 'no-timeout');
  });

  test('skips timeout when timeoutMs is negative', async () => {
    const result = await withTimeout(Promise.resolve('neg'), -1);
    assert.equal(result, 'neg');
  });
});

describe('sleep', () => {
  test('resolves after specified delay', async () => {
    const start = Date.now();
    await sleep(30);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 25, `Expected >= 25ms, got ${elapsed}ms`);
  });

  test('resolves immediately for 0ms', async () => {
    const start = Date.now();
    await sleep(0);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed}ms`);
  });
});
