import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { URL } from 'node:url';
import { withErrorCode } from './error-codes.js';
import { logger } from './logger.js';
import { dispatchRuntimeExportEvent } from './plugins.js';

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

export type AuditSink = 'memory' | 'file' | 'webhook';

export interface AuditPersistenceConfig {
  sink: AuditSink;
  filePath?: string;
  legacyEnv?: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookTimeoutMs: number;
}

type EnvLike = Record<string, string | undefined>;

export interface AuditWebhookDispatchRequest {
  url: string;
  entry: AuditEntry;
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface AuditWebhookDispatchResult {
  ok: boolean;
  status: number;
  statusText: string;
}

export type AuditWebhookDispatch = (
  request: AuditWebhookDispatchRequest,
) => Promise<AuditWebhookDispatchResult>;

// ── 审计日志环形缓冲区 ──────────────────────────────────────────

const MAX_BUFFER_SIZE = 1000;
const DEFAULT_AUDIT_WEBHOOK_TIMEOUT_MS = 3000;
const auditRing = new Array<AuditEntry | undefined>(MAX_BUFFER_SIZE);
let auditHead = 0;
let auditCount = 0;
let auditWebhookDispatch: AuditWebhookDispatch = defaultAuditWebhookDispatch;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInt(name: string, value: string | undefined, defaultValue: number): number {
  const raw = nonEmpty(value);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(withErrorCode('CFG_005', `${name} 必须是正整数`));
  }
  return parsed;
}

function parseWebhookUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return url.toString();
  } catch {
    throw new Error(withErrorCode('CFG_005', 'DB_AUDIT_WEBHOOK_URL 必须是 http(s) URL'));
  }
}

export function parseAuditPersistenceConfig(env: EnvLike = process.env): AuditPersistenceConfig {
  const legacyPath = nonEmpty(env.MCP_AUDIT_LOG);
  const sinkRaw = nonEmpty(env.DB_AUDIT_SINK)?.toLowerCase();

  if (!sinkRaw) {
    return legacyPath
      ? {
          sink: 'file',
          filePath: legacyPath,
          legacyEnv: true,
          webhookTimeoutMs: DEFAULT_AUDIT_WEBHOOK_TIMEOUT_MS,
        }
      : { sink: 'memory', webhookTimeoutMs: DEFAULT_AUDIT_WEBHOOK_TIMEOUT_MS };
  }

  if (sinkRaw !== 'memory' && sinkRaw !== 'file' && sinkRaw !== 'webhook') {
    throw new Error(withErrorCode('CFG_005', 'DB_AUDIT_SINK 必须是 memory、file 或 webhook'));
  }

  if (sinkRaw === 'memory') {
    return { sink: 'memory', webhookTimeoutMs: DEFAULT_AUDIT_WEBHOOK_TIMEOUT_MS };
  }

  if (sinkRaw === 'file') {
    const filePath = nonEmpty(env.DB_AUDIT_FILE_PATH) ?? legacyPath;
    if (!filePath) {
      throw new Error(withErrorCode('CFG_005', 'DB_AUDIT_SINK=file 时必须设置 DB_AUDIT_FILE_PATH'));
    }

    return {
      sink: 'file',
      filePath,
      legacyEnv: !nonEmpty(env.DB_AUDIT_FILE_PATH) && legacyPath !== undefined,
      webhookTimeoutMs: DEFAULT_AUDIT_WEBHOOK_TIMEOUT_MS,
    };
  }

  const webhookUrlRaw = nonEmpty(env.DB_AUDIT_WEBHOOK_URL);
  if (!webhookUrlRaw) {
    throw new Error(
      withErrorCode('CFG_005', 'DB_AUDIT_SINK=webhook 时必须设置 DB_AUDIT_WEBHOOK_URL'),
    );
  }
  return {
    sink: 'webhook',
    webhookUrl: parseWebhookUrl(webhookUrlRaw),
    webhookSecret: nonEmpty(env.DB_AUDIT_WEBHOOK_SECRET),
    webhookTimeoutMs: parsePositiveInt(
      'DB_AUDIT_WEBHOOK_TIMEOUT_MS',
      env.DB_AUDIT_WEBHOOK_TIMEOUT_MS,
      DEFAULT_AUDIT_WEBHOOK_TIMEOUT_MS,
    ),
  };
}

export function safeAuditPersistenceConfig(
  config: AuditPersistenceConfig,
): Record<string, unknown> {
  return {
    sink: config.sink,
    file: config.filePath ? 'configured' : 'none',
    legacy_env: config.legacyEnv === true,
    webhook: config.webhookUrl ? 'configured' : 'none',
    webhook_secret: config.webhookSecret ? 'configured' : 'none',
    webhook_timeout_ms: config.webhookTimeoutMs,
  };
}

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
  dispatchRuntimeExportEvent(auditEntry);

  const persistence = (() => {
    try {
      return parseAuditPersistenceConfig();
    } catch {
      return {
        sink: 'memory',
        webhookTimeoutMs: DEFAULT_AUDIT_WEBHOOK_TIMEOUT_MS,
      } satisfies AuditPersistenceConfig;
    }
  })();
  if (persistence.sink === 'file' && persistence.filePath) {
    try {
      const dir = dirname(persistence.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(persistence.filePath, JSON.stringify(auditEntry) + '\n', 'utf8');
    } catch {
      // 审计失败不阻断主流程
    }
    return;
  }

  if (persistence.sink === 'webhook' && persistence.webhookUrl) {
    void dispatchAuditWebhook(auditEntry, persistence).catch((error) => {
      logger.warn('audit webhook dispatch failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

async function defaultAuditWebhookDispatch(
  request: AuditWebhookDispatchRequest,
): Promise<AuditWebhookDispatchResult> {
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await globalThis.fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.entry),
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchAuditWebhook(
  entry: AuditEntry,
  config: AuditPersistenceConfig,
): Promise<void> {
  if (!config.webhookUrl) return;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'polyglot-db-mcp-server',
  };
  if (config.webhookSecret) headers['x-db-mcp-audit-secret'] = config.webhookSecret;

  const result = await auditWebhookDispatch({
    url: config.webhookUrl,
    entry,
    headers,
    timeoutMs: config.webhookTimeoutMs,
  });
  if (!result.ok) {
    logger.warn('audit webhook returned non-success', {
      status: result.status,
      status_text: result.statusText,
    });
  }
}

export function setAuditWebhookDispatchForTests(dispatch: AuditWebhookDispatch): void {
  auditWebhookDispatch = dispatch;
}

export function resetAuditForTests(): void {
  auditWebhookDispatch = defaultAuditWebhookDispatch;
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
