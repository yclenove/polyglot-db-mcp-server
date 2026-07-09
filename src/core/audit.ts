import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface AuditEntry {
  timestamp: string;
  engine?: string;
  connection_id?: string;
  operation: string;
  sql?: string;
  collection?: string;
  key?: string;
  success: boolean;
  error?: string;
  executionTime?: number;
  affectedRows?: number;
  [key: string]: unknown;
}

// ── 审计日志环形缓冲区 ──────────────────────────────────────────

const MAX_BUFFER_SIZE = 1000;
const auditRing = new Array<AuditEntry | undefined>(MAX_BUFFER_SIZE);
let auditHead = 0;
let auditCount = 0;

/** O(1) 写入，满时覆盖最旧条目 */
function ringPush(entry: AuditEntry): void {
  const tail = (auditHead + auditCount) % MAX_BUFFER_SIZE;
  if (auditCount === MAX_BUFFER_SIZE) {
    auditRing[tail] = entry;
    auditHead = (auditHead + 1) % MAX_BUFFER_SIZE;
  } else {
    auditRing[tail] = entry;
    auditCount++;
  }
}

/** 获取最近 n 条 */
function ringSlice(limit: number): AuditEntry[] {
  const n = Math.min(limit, auditCount);
  const start = auditCount - n;
  const result: AuditEntry[] = [];
  for (let i = start; i < auditCount; i++) {
    const rec = auditRing[(auditHead + i) % MAX_BUFFER_SIZE];
    if (rec) result.push(rec);
  }
  return result;
}

/** 全量迭代（用于过滤和统计） */
function ringAll(): AuditEntry[] {
  return ringSlice(auditCount);
}

// ── 公共 API ──────────────────────────────────────────

export function auditLog(entry: Record<string, unknown>): void {
  // 慢查询标记
  const slowThreshold = parseInt(process.env.DB_SLOW_QUERY_MS || '5000', 10);
  if (typeof entry.executionTime === 'number' && entry.executionTime >= slowThreshold) {
    entry.slow_query = true;
  }

  const auditEntry: AuditEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  } as AuditEntry;

  ringPush(auditEntry);

  // 写入文件（如果配置了）
  const path = process.env.MCP_AUDIT_LOG;
  if (!path) return;
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, JSON.stringify(auditEntry) + '\n', 'utf8');
  } catch {
    // 审计失败不阻断主流程
  }
}

/**
 * 获取最近的审计日志
 */
export function getRecentAuditLogs(limit: number = 100): AuditEntry[] {
  return ringSlice(limit);
}

/**
 * 按条件过滤审计日志
 */
export function filterAuditLogs(filter: {
  engine?: string;
  connection_id?: string;
  operation?: string;
  success?: boolean;
  since?: string;
  until?: string;
  limit?: number;
}): AuditEntry[] {
  let filtered = ringAll();

  if (filter.engine) {
    filtered = filtered.filter((e) => e.engine === filter.engine);
  }
  if (filter.connection_id) {
    filtered = filtered.filter((e) => e.connection_id === filter.connection_id);
  }
  if (filter.operation) {
    filtered = filtered.filter((e) => e.operation === filter.operation);
  }
  if (filter.success !== undefined) {
    filtered = filtered.filter((e) => e.success === filter.success);
  }
  if (filter.since) {
    const sinceTime = new Date(filter.since).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= sinceTime);
  }
  if (filter.until) {
    const untilTime = new Date(filter.until).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= untilTime);
  }

  return filtered.slice(-(filter.limit ?? 100));
}

/** 脱敏 SQL 参数（替换密码等敏感值） */
export function sanitizeParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (typeof p === 'string' && p.length > 20 && /^[A-Za-z0-9+/=]{20,}$/.test(p)) {
      return '***';
    }
    return p;
  });
}

/**
 * 获取审计统计信息
 */
export function getAuditStats(): {
  total: number;
  success: number;
  failed: number;
  byEngine: Record<string, number>;
  byOperation: Record<string, number>;
  performance: {
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    slowQueries: number;
  };
} {
  const allEntries = ringAll();
  const stats = {
    total: allEntries.length,
    success: 0,
    failed: 0,
    byEngine: {} as Record<string, number>,
    byOperation: {} as Record<string, number>,
    performance: {
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      slowQueries: 0,
    },
  };

  const executionTimes: number[] = [];
  const slowThreshold = parseInt(process.env.DB_SLOW_QUERY_MS || '5000', 10);

  for (const entry of allEntries) {
    if (entry.success) {
      stats.success++;
    } else {
      stats.failed++;
    }

    if (entry.engine) {
      stats.byEngine[entry.engine] = (stats.byEngine[entry.engine] || 0) + 1;
    }

    if (entry.operation) {
      stats.byOperation[entry.operation] = (stats.byOperation[entry.operation] || 0) + 1;
    }

    if (typeof entry.executionTime === 'number') {
      executionTimes.push(entry.executionTime);
      if (entry.executionTime >= slowThreshold) {
        stats.performance.slowQueries++;
      }
    }
  }

  // 计算百分位
  if (executionTimes.length > 0) {
    executionTimes.sort((a, b) => a - b);
    const sum = executionTimes.reduce((a, b) => a + b, 0);
    stats.performance.avgMs = Math.round(sum / executionTimes.length);
    stats.performance.p50Ms = percentile(executionTimes, 50);
    stats.performance.p95Ms = percentile(executionTimes, 95);
    stats.performance.p99Ms = percentile(executionTimes, 99);
  }

  return stats;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}
