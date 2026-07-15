import { BoundedItemCollector, boundMaterializedItems } from '../../core/byte-budget.js';
import { responseDataByteLimit } from '../../core/config.js';

export function effectiveSqlByteLimit(requested: number | undefined): number {
  const serverLimit = responseDataByteLimit();
  if (!Number.isSafeInteger(requested) || requested === undefined || requested <= 0) {
    return serverLimit;
  }
  return Math.min(requested, serverLimit);
}

export function createSqlRowCollector<T>(
  maxRows: number,
  maxBytes: number | undefined,
): BoundedItemCollector<T> {
  return new BoundedItemCollector<T>(maxRows, effectiveSqlByteLimit(maxBytes));
}

export function boundSqlRows<T>(rows: readonly T[], maxRows: number, maxBytes: number | undefined) {
  return boundMaterializedItems(rows, maxRows, effectiveSqlByteLimit(maxBytes));
}
