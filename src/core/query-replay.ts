/**
 * 查询回放模块 —— 环形缓冲存储查询历史
 * ADR-006: 仅存结果摘要（前5行 + 元数据），不缓存完整结果集
 *
 * 环形缓冲使用 head/count + modulo 索引实现 O(1) push，避免 Array.shift()。
 */

export interface QueryRecord {
  id: string;
  timestamp: string;
  connectionId: string;
  engine: string;
  sql: string;
  params: unknown[];
  resultSummary: {
    rowCount: number;
    fields: string[];
    sampleRows: unknown[];
  };
  executionTime: number;
  success: boolean;
}

export interface QueryDiffResult {
  added: number;
  removed: number;
  modified: number;
  details: Array<{ field: string; old: unknown; new: unknown }>;
}

function getBufferSizeFromEnv(): number {
  const raw = process.env.DB_REPLAY_BUFFER_SIZE;
  if (!raw) return 50;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

export class QueryHistory {
  private buffer: (QueryRecord | undefined)[];
  private maxSize: number;
  private head: number;
  private count: number;
  private counter: number;

  constructor(maxSize?: number) {
    this.maxSize = maxSize ?? getBufferSizeFromEnv();
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.count = 0;
    this.counter = 0;
  }

  push(record: Omit<QueryRecord, 'id' | 'timestamp'>): QueryRecord {
    const fullRecord: QueryRecord = {
      ...record,
      id: String(++this.counter),
      timestamp: new Date().toISOString(),
    };
    const tail = (this.head + this.count) % this.maxSize;
    if (this.count === this.maxSize) {
      // 缓冲区满：覆盖最旧条目，head 前进
      this.buffer[tail] = fullRecord;
      this.head = (this.head + 1) % this.maxSize;
    } else {
      this.buffer[tail] = fullRecord;
      this.count++;
    }
    return fullRecord;
  }

  getById(id: string): QueryRecord | undefined {
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.maxSize;
      const rec = this.buffer[idx];
      if (rec && rec.id === id) return rec;
    }
    return undefined;
  }

  list(limit?: number): QueryRecord[] {
    const n = limit === undefined ? this.count : Math.min(limit, this.count);
    const start = this.count - n;
    const result: QueryRecord[] = [];
    for (let i = start; i < this.count; i++) {
      const idx = (this.head + i) % this.maxSize;
      const rec = this.buffer[idx];
      if (rec) result.push(rec);
    }
    return result;
  }

  get size(): number {
    return this.count;
  }

  get capacity(): number {
    return this.maxSize;
  }

  diff(idA: string, idB: string): QueryDiffResult {
    const recordA = this.getById(idA);
    const recordB = this.getById(idB);

    if (!recordA) {
      throw new Error(`查询记录 ${idA} 不存在`);
    }
    if (!recordB) {
      throw new Error(`查询记录 ${idB} 不存在`);
    }

    return diffRecords(recordA, recordB);
  }
}

/** 提取纯函数，便于测试 */
function diffRecords(recordA: QueryRecord, recordB: QueryRecord): QueryDiffResult {
  const rowsA = recordA.resultSummary.sampleRows;
  const rowsB = recordB.resultSummary.sampleRows;

  const details: Array<{ field: string; old: unknown; new: unknown }> = [];
  let modified = 0;

  const allFields = new Set<string>();
  for (const row of [...rowsA, ...rowsB]) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row as Record<string, unknown>)) {
        allFields.add(key);
      }
    }
  }

  // 比较相同行数的行
  const minLen = Math.min(rowsA.length, rowsB.length);
  for (let i = 0; i < minLen; i++) {
    const rowA = (rowsA[i] ?? {}) as Record<string, unknown>;
    const rowB = (rowsB[i] ?? {}) as Record<string, unknown>;
    for (const field of allFields) {
      const valA = rowA[field];
      const valB = rowB[field];
      if (JSON.stringify(valA) !== JSON.stringify(valB)) {
        details.push({ field: `[${i}].${field}`, old: valA, new: valB });
        modified++;
      }
    }
  }

  const added = Math.max(0, rowsB.length - rowsA.length);
  const removed = Math.max(0, rowsA.length - rowsB.length);

  return { added, removed, modified, details };
}

// 全局单例
let _globalHistory: QueryHistory | undefined;

export function getGlobalQueryHistory(): QueryHistory {
  if (!_globalHistory) {
    _globalHistory = new QueryHistory();
  }
  return _globalHistory;
}

export function resetGlobalQueryHistory(): void {
  _globalHistory = undefined;
}
