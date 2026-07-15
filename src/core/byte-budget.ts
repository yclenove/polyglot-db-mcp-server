export type ResultTruncationReason = 'rows' | 'bytes';

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export function stringifyJsonSafe(value: unknown): string {
  return JSON.stringify(value, jsonReplacer) ?? 'null';
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(stringifyJsonSafe(value), 'utf8');
}

export interface BoundedItems<T> {
  items: T[];
  observedItems: number;
  returnedBytes: number;
  truncated: boolean;
  truncatedBy?: ResultTruncationReason;
}

/** Collects a JSON array prefix without retaining the first item over either limit. */
export class BoundedItemCollector<T> {
  readonly items: T[] = [];
  observedItems = 0;
  returnedBytes = 2;
  truncatedBy: ResultTruncationReason | undefined;

  constructor(
    private readonly maxItems: number,
    private readonly maxBytes: number,
    private readonly measureItem: (item: T) => number = jsonByteLength,
  ) {}

  add(item: T): boolean {
    if (this.truncatedBy) return false;
    this.observedItems++;

    if (this.items.length >= Math.max(0, this.maxItems)) {
      this.truncatedBy = 'rows';
      return false;
    }

    const itemBytes = this.measureItem(item);
    const nextBytes = this.returnedBytes + (this.items.length > 0 ? 1 : 0) + itemBytes;
    if (nextBytes > Math.max(2, this.maxBytes)) {
      this.truncatedBy = 'bytes';
      return false;
    }

    this.items.push(item);
    this.returnedBytes = nextBytes;
    return true;
  }

  result(): BoundedItems<T> {
    return {
      items: this.items,
      observedItems: this.observedItems,
      returnedBytes: this.returnedBytes,
      truncated: this.truncatedBy !== undefined,
      truncatedBy: this.truncatedBy,
    };
  }
}

export function boundMaterializedItems<T>(
  items: readonly T[],
  maxItems: number,
  maxBytes: number,
): BoundedItems<T> & { totalItems: number; totalItemsExact: true } {
  const collector = new BoundedItemCollector<T>(maxItems, maxBytes);
  for (const item of items) {
    if (!collector.add(item)) break;
  }
  return {
    ...collector.result(),
    totalItems: items.length,
    totalItemsExact: true,
  };
}
