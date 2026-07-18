import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BoundedHttpEventStore } from '../../dist/transports/http-event-store.js';

describe('bounded HTTP event store', () => {
  test('replays only later events from the same stream', async () => {
    const store = new BoundedHttpEventStore(10, 4096);
    const first = await store.storeEvent('stream-a', { jsonrpc: '2.0', method: 'a/first' });
    await store.storeEvent('stream-b', { jsonrpc: '2.0', method: 'b/only' });
    const second = await store.storeEvent('stream-a', { jsonrpc: '2.0', method: 'a/second' });
    const replayed = [];

    const streamId = await store.replayEventsAfter(first, {
      send: async (eventId, message) => replayed.push({ eventId, message }),
    });

    assert.equal(streamId, 'stream-a');
    assert.deepEqual(replayed, [
      { eventId: second, message: { jsonrpc: '2.0', method: 'a/second' } },
    ]);
  });

  test('evicts oldest events by count and byte budget', async () => {
    const countBounded = new BoundedHttpEventStore(2, 4096);
    const first = await countBounded.storeEvent('stream', { jsonrpc: '2.0', method: 'one' });
    const second = await countBounded.storeEvent('stream', { jsonrpc: '2.0', method: 'two' });
    await countBounded.storeEvent('stream', { jsonrpc: '2.0', method: 'three' });
    assert.equal(await countBounded.getStreamIdForEventId(first), undefined);
    assert.equal(await countBounded.getStreamIdForEventId(second), 'stream');
    assert.equal(countBounded.size, 2);

    const byteBounded = new BoundedHttpEventStore(10, 100);
    const old = await byteBounded.storeEvent('stream', {
      jsonrpc: '2.0',
      method: 'event',
      params: { value: 'x'.repeat(30) },
    });
    await byteBounded.storeEvent('stream', {
      jsonrpc: '2.0',
      method: 'event',
      params: { value: 'y'.repeat(30) },
    });
    assert.equal(await byteBounded.getStreamIdForEventId(old), undefined);
    assert.ok(byteBounded.bytes <= 100);
  });

  test('rejects one oversized event and clears retained state', async () => {
    const store = new BoundedHttpEventStore(10, 64);
    await assert.rejects(
      store.storeEvent('stream', {
        jsonrpc: '2.0',
        method: 'large',
        params: { value: 'x'.repeat(100) },
      }),
      /超过 event store 上限/,
    );
    assert.equal(store.size, 0);

    await store.storeEvent('stream', { jsonrpc: '2.0', method: 'small' });
    store.clear();
    assert.equal(store.size, 0);
    assert.equal(store.bytes, 0);
  });
});
