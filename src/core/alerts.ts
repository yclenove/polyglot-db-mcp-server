import { URL } from 'node:url';
import type { ToolCallMetrics, ToolCallObservation } from './observability.js';
import { maskErrorCredentials, withErrorCode } from './error-codes.js';
import { logger } from './logger.js';

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export type AlertKind = 'test' | 'connection_failure' | 'tool_error_rate' | 'slow_tool_call';

export interface AlertConfig {
  enabled: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
  minSeverity: AlertSeverity;
  timeoutMs: number;
  cooldownMs: number;
  toolErrorRateMinCalls: number;
  toolErrorRateThreshold: number;
  slowToolMs: number;
}

export interface AlertEvent {
  timestamp: string;
  source: 'polyglot-db-mcp-server';
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  message: string;
  labels: Record<string, string>;
  details: Record<string, unknown>;
}

export type AlertInput = Omit<AlertEvent, 'timestamp' | 'source' | 'labels' | 'details'> & {
  timestamp?: string;
  labels?: Record<string, string | undefined>;
  details?: Record<string, unknown>;
};

export interface AlertDispatchRequest {
  url: string;
  event: AlertEvent;
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface AlertDispatchResult {
  ok: boolean;
  status: number;
  statusText: string;
}

export type AlertDispatch = (request: AlertDispatchRequest) => Promise<AlertDispatchResult>;

type EnvLike = Record<string, string | undefined>;

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

const DEFAULT_ALERT_TIMEOUT_MS = 3000;
const DEFAULT_ALERT_COOLDOWN_MS = 60_000;
const DEFAULT_TOOL_ERROR_RATE_MIN_CALLS = 5;
const DEFAULT_TOOL_ERROR_RATE_THRESHOLD = 50;
const DEFAULT_SLOW_TOOL_MS = 5000;

const lastAlertAt = new Map<string, number>();

let dispatchAlert: AlertDispatch = defaultAlertDispatch;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(name: string, value: string | undefined, defaultValue: boolean): boolean {
  const raw = nonEmpty(value);
  if (!raw) return defaultValue;
  const normalized = raw.toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(withErrorCode('CFG_005', `${name} 必须是布尔值`));
}

function parseSeverity(value: string | undefined, defaultValue: AlertSeverity): AlertSeverity {
  const normalized = (nonEmpty(value) ?? defaultValue).toLowerCase();
  if (ALERT_SEVERITIES.includes(normalized as AlertSeverity)) {
    return normalized as AlertSeverity;
  }
  throw new Error(
    withErrorCode('CFG_005', `DB_ALERT_MIN_SEVERITY 必须是 ${ALERT_SEVERITIES.join(', ')}`),
  );
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

function parseNonNegativeInt(
  name: string,
  value: string | undefined,
  defaultValue: number,
): number {
  const raw = nonEmpty(value);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(withErrorCode('CFG_005', `${name} 必须是非负整数`));
  }
  return parsed;
}

function parsePercentage(name: string, value: string | undefined, defaultValue: number): number {
  const parsed = parsePositiveInt(name, value, defaultValue);
  if (parsed > 100) {
    throw new Error(withErrorCode('CFG_005', `${name} 必须是 1-100 的整数百分比`));
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
    throw new Error(withErrorCode('CFG_005', 'DB_ALERT_WEBHOOK_URL 必须是 http(s) URL'));
  }
}

function normalizeLabels(
  labels: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels ?? {})) {
    if (value !== undefined && value.trim() !== '') normalized[key] = value;
  }
  return normalized;
}

function materializeEvent(event: AlertInput): AlertEvent {
  return {
    timestamp: event.timestamp ?? new Date().toISOString(),
    source: 'polyglot-db-mcp-server',
    kind: event.kind,
    severity: event.severity,
    title: event.title,
    message: event.message,
    labels: normalizeLabels(event.labels),
    details: event.details ?? {},
  };
}

async function defaultAlertDispatch(request: AlertDispatchRequest): Promise<AlertDispatchResult> {
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await globalThis.fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.event),
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

export function parseAlertConfig(env: EnvLike = process.env): AlertConfig {
  const webhookUrlRaw = nonEmpty(env.DB_ALERT_WEBHOOK_URL);
  const explicitlyEnabled = nonEmpty(env.DB_ALERT_ENABLED);
  const enabled = parseBoolean('DB_ALERT_ENABLED', explicitlyEnabled, false);

  if (!enabled) {
    return {
      enabled: false,
      minSeverity: 'warning',
      timeoutMs: DEFAULT_ALERT_TIMEOUT_MS,
      cooldownMs: DEFAULT_ALERT_COOLDOWN_MS,
      toolErrorRateMinCalls: DEFAULT_TOOL_ERROR_RATE_MIN_CALLS,
      toolErrorRateThreshold: DEFAULT_TOOL_ERROR_RATE_THRESHOLD,
      slowToolMs: DEFAULT_SLOW_TOOL_MS,
    };
  }

  if (enabled && !webhookUrlRaw) {
    throw new Error(
      withErrorCode('CFG_005', 'DB_ALERT_ENABLED=true 时必须设置 DB_ALERT_WEBHOOK_URL'),
    );
  }

  const slowToolDefault = parseNonNegativeInt(
    'DB_SLOW_QUERY_MS',
    env.DB_SLOW_QUERY_MS,
    DEFAULT_SLOW_TOOL_MS,
  );

  return {
    enabled,
    webhookUrl: webhookUrlRaw ? parseWebhookUrl(webhookUrlRaw) : undefined,
    webhookSecret: nonEmpty(env.DB_ALERT_WEBHOOK_SECRET),
    minSeverity: parseSeverity(env.DB_ALERT_MIN_SEVERITY, 'warning'),
    timeoutMs: parsePositiveInt(
      'DB_ALERT_TIMEOUT_MS',
      env.DB_ALERT_TIMEOUT_MS,
      DEFAULT_ALERT_TIMEOUT_MS,
    ),
    cooldownMs: parseNonNegativeInt(
      'DB_ALERT_COOLDOWN_MS',
      env.DB_ALERT_COOLDOWN_MS,
      DEFAULT_ALERT_COOLDOWN_MS,
    ),
    toolErrorRateMinCalls: parsePositiveInt(
      'DB_ALERT_TOOL_ERROR_RATE_MIN_CALLS',
      env.DB_ALERT_TOOL_ERROR_RATE_MIN_CALLS,
      DEFAULT_TOOL_ERROR_RATE_MIN_CALLS,
    ),
    toolErrorRateThreshold: parsePercentage(
      'DB_ALERT_TOOL_ERROR_RATE_THRESHOLD',
      env.DB_ALERT_TOOL_ERROR_RATE_THRESHOLD,
      DEFAULT_TOOL_ERROR_RATE_THRESHOLD,
    ),
    slowToolMs: parseNonNegativeInt(
      'DB_ALERT_SLOW_TOOL_MS',
      env.DB_ALERT_SLOW_TOOL_MS,
      slowToolDefault,
    ),
  };
}

export function safeAlertConfig(config: AlertConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    webhook: config.webhookUrl ? 'configured' : 'none',
    min_severity: config.minSeverity,
    timeout_ms: config.timeoutMs,
    cooldown_ms: config.cooldownMs,
    tool_error_rate_min_calls: config.toolErrorRateMinCalls,
    tool_error_rate_threshold: config.toolErrorRateThreshold,
    slow_tool_ms: config.slowToolMs,
  };
}

function severityAllowed(severity: AlertSeverity, minSeverity: AlertSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minSeverity];
}

function defaultDedupeKey(event: AlertEvent): string {
  const labels = Object.entries(event.labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  return `${event.kind}:${event.severity}:${labels}`;
}

function shouldSend(dedupeKey: string, cooldownMs: number): boolean {
  if (cooldownMs <= 0) return true;
  const now = Date.now();
  const last = lastAlertAt.get(dedupeKey);
  if (last !== undefined && now - last < cooldownMs) return false;
  lastAlertAt.set(dedupeKey, now);
  return true;
}

export async function publishAlert(
  eventInput: AlertInput,
  env: EnvLike = process.env,
  options: { dedupeKey?: string; bypassCooldown?: boolean } = {},
): Promise<boolean> {
  const config = parseAlertConfig(env);
  if (!config.enabled || !config.webhookUrl) return false;

  const event = materializeEvent(eventInput);
  if (!severityAllowed(event.severity, config.minSeverity)) return false;

  const dedupeKey = options.dedupeKey ?? defaultDedupeKey(event);
  if (!options.bypassCooldown && !shouldSend(dedupeKey, config.cooldownMs)) return false;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'polyglot-db-mcp-server',
  };
  if (config.webhookSecret) headers['x-db-mcp-alert-secret'] = config.webhookSecret;

  try {
    const result = await dispatchAlert({
      url: config.webhookUrl,
      event,
      headers,
      timeoutMs: config.timeoutMs,
    });
    if (!result.ok) {
      logger.warn('alert webhook returned non-success', {
        kind: event.kind,
        severity: event.severity,
        status: result.status,
        status_text: result.statusText,
      });
    }
    return result.ok;
  } catch (error) {
    logger.warn('alert webhook dispatch failed', {
      kind: event.kind,
      severity: event.severity,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function publishConnectionPingAlerts(
  pings: readonly { id: string; ok: boolean; latencyMs: number; error?: string }[],
  defaultConnectionId: string,
  env: EnvLike = process.env,
): Promise<number> {
  let delivered = 0;
  for (const ping of pings) {
    if (ping.ok) continue;
    const error = typeof ping.error === 'string' ? maskErrorCredentials(ping.error) : undefined;
    const isDefault = ping.id === defaultConnectionId;
    const sent = await publishAlert(
      {
        kind: 'connection_failure',
        severity: isDefault ? 'critical' : 'warning',
        title: isDefault ? 'Default database connection failed' : 'Database connection failed',
        message: error ?? `Connection ${ping.id} ping failed`,
        labels: {
          connection_id: ping.id,
          default_connection: String(isDefault),
        },
        details: {
          latency_ms: ping.latencyMs,
          error,
        },
      },
      env,
      { dedupeKey: `connection_failure:${ping.id}` },
    );
    if (sent) delivered++;
  }
  return delivered;
}

export async function publishToolObservationAlerts(
  observation: ToolCallObservation,
  metric: ToolCallMetrics,
  env: EnvLike = process.env,
): Promise<number> {
  const config = parseAlertConfig(env);
  if (!config.enabled) return 0;

  let delivered = 0;
  if (config.slowToolMs > 0 && observation.durationMs >= config.slowToolMs) {
    const sent = await publishAlert(
      {
        kind: 'slow_tool_call',
        severity: 'warning',
        title: 'Slow MCP tool call',
        message: `${observation.tool} took ${Math.round(observation.durationMs)}ms`,
        labels: {
          tool: observation.tool,
          action: observation.action,
          transport: observation.transport,
          connection_id: observation.connectionId,
        },
        details: {
          duration_ms: Math.round(observation.durationMs),
          threshold_ms: config.slowToolMs,
        },
      },
      env,
      { dedupeKey: `slow_tool_call:${observation.tool}:${observation.connectionId ?? 'none'}` },
    );
    if (sent) delivered++;
  }

  const failureRate =
    metric.totalCalls > 0 ? Math.round((metric.failedCalls / metric.totalCalls) * 100) : 0;
  if (
    !observation.success &&
    metric.totalCalls >= config.toolErrorRateMinCalls &&
    failureRate >= config.toolErrorRateThreshold
  ) {
    const sent = await publishAlert(
      {
        kind: 'tool_error_rate',
        severity: failureRate >= 90 ? 'critical' : 'warning',
        title: 'MCP tool error rate exceeded threshold',
        message: `${observation.tool} failure rate is ${failureRate}%`,
        labels: {
          tool: observation.tool,
          action: observation.action,
          transport: observation.transport,
          connection_id: observation.connectionId,
          error_code: observation.errorCode,
        },
        details: {
          total_calls: metric.totalCalls,
          failed_calls: metric.failedCalls,
          failure_rate: failureRate,
          threshold: config.toolErrorRateThreshold,
          by_error_code: metric.byErrorCode,
        },
      },
      env,
      { dedupeKey: `tool_error_rate:${observation.tool}:${observation.connectionId ?? 'none'}` },
    );
    if (sent) delivered++;
  }

  return delivered;
}

export function setAlertDispatchForTests(dispatch: AlertDispatch): void {
  dispatchAlert = dispatch;
}

export function resetAlertsForTests(): void {
  dispatchAlert = defaultAlertDispatch;
  lastAlertAt.clear();
}
