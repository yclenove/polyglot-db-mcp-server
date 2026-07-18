import { randomUUID } from 'node:crypto';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { EventStore } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { jsonByteLength } from '../core/byte-budget.js';

interface StoredHttpEvent {
  streamId: string;
  message: JSONRPCMessage;
  bytes: number;
}

export class BoundedHttpEventStore implements EventStore {
  private readonly events = new Map<string, StoredHttpEvent>();
  private totalBytes = 0;

  constructor(
    private readonly maxEvents: number,
    private readonly maxBytes: number,
  ) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) {
      throw new Error('HTTP event store maxEvents 必须是正整数');
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error('HTTP event store maxBytes 必须是正整数');
    }
  }

  async storeEvent(streamId: string, message: JSONRPCMessage): Promise<string> {
    const bytes = jsonByteLength(message);
    if (bytes > this.maxBytes) {
      throw new Error(`HTTP SSE event ${bytes} 字节，超过 event store 上限 ${this.maxBytes} 字节`);
    }

    let eventId = randomUUID();
    while (this.events.has(eventId)) eventId = randomUUID();
    this.events.set(eventId, { streamId, message, bytes });
    this.totalBytes += bytes;
    this.evictOldest();
    return eventId;
  }

  async getStreamIdForEventId(eventId: string): Promise<string | undefined> {
    return this.events.get(eventId)?.streamId;
  }

  async replayEventsAfter(
    lastEventId: string,
    options: { send: (eventId: string, message: JSONRPCMessage) => Promise<void> },
  ): Promise<string> {
    const lastEvent = this.events.get(lastEventId);
    if (!lastEvent) throw new Error('HTTP SSE event ID 已过期或不存在');

    let found = false;
    for (const [eventId, event] of [...this.events.entries()]) {
      if (eventId === lastEventId) {
        found = true;
        continue;
      }
      if (found && event.streamId === lastEvent.streamId) {
        await options.send(eventId, event.message);
      }
    }
    return lastEvent.streamId;
  }

  clear(): void {
    this.events.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.events.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  private evictOldest(): void {
    while (this.events.size > this.maxEvents || this.totalBytes > this.maxBytes) {
      const oldestId = this.events.keys().next().value as string | undefined;
      if (oldestId === undefined) return;
      const oldest = this.events.get(oldestId);
      this.events.delete(oldestId);
      this.totalBytes -= oldest?.bytes ?? 0;
    }
  }
}
