import { getAuditStats } from './audit.js';
import type { ConnectionRegistry } from './registry.js';

export interface ToolCallObservation {
  tool: string;
  action: string;
  transport: 'stdio' | 'http';
  success: boolean;
  durationMs: number;
  connectionId?: string;
  errorCode?: string;
}

export interface ToolCallMetrics {
  tool: string;
  action: string;
  transport: 'stdio' | 'http';
  connectionId?: string;
  totalCalls: number;
  failedCalls: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastCalledAt: number;
  byErrorCode: Record<string, number>;
}

interface ToolMetricState extends ToolCallMetrics {
  byErrorCode: Record<string, number>;
}

const serverStartTime = Date.now();
const toolMetrics = new Map<string, ToolMetricState>();

function metricKey(obs: ToolCallObservation): string {
  return JSON.stringify([obs.tool, obs.action, obs.transport, obs.connectionId ?? '']);
}

function finiteDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 0;
  return Math.round(durationMs);
}

export function recordToolCall(obs: ToolCallObservation): void {
  const durationMs = finiteDuration(obs.durationMs);
  const key = metricKey(obs);
  let metric = toolMetrics.get(key);
  if (!metric) {
    metric = {
      tool: obs.tool,
      action: obs.action,
      transport: obs.transport,
      connectionId: obs.connectionId,
      totalCalls: 0,
      failedCalls: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      lastCalledAt: 0,
      byErrorCode: {},
    };
    toolMetrics.set(key, metric);
  }

  metric.totalCalls++;
  if (!obs.success) metric.failedCalls++;
  metric.totalDurationMs += durationMs;
  metric.maxDurationMs = Math.max(metric.maxDurationMs, durationMs);
  metric.lastCalledAt = Date.now();
  if (obs.errorCode) {
    metric.byErrorCode[obs.errorCode] = (metric.byErrorCode[obs.errorCode] ?? 0) + 1;
  }
}

export function getToolCallMetrics(): ToolCallMetrics[] {
  return [...toolMetrics.values()]
    .map((metric) => ({
      ...metric,
      byErrorCode: { ...metric.byErrorCode },
    }))
    .sort((a, b) =>
      [a.tool, a.action, a.transport, a.connectionId ?? '']
        .join('\0')
        .localeCompare([b.tool, b.action, b.transport, b.connectionId ?? ''].join('\0')),
    );
}

export function resetObservabilityForTests(): void {
  toolMetrics.clear();
}

function labelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labels(values: Record<string, string | undefined>): string {
  const pairs = Object.entries(values).map(
    ([key, value]) => `${key}="${labelValue(value ?? 'none')}"`,
  );
  return `{${pairs.join(',')}}`;
}

export function buildPrometheusMetrics(registry: ConnectionRegistry): string {
  const specs = registry.getSpecs();
  const auditStats = getAuditStats();
  const uptimeMs = Date.now() - serverStartTime;
  const lines: string[] = [];

  lines.push('# HELP db_mcp_uptime_seconds Server uptime in seconds');
  lines.push('# TYPE db_mcp_uptime_seconds gauge');
  lines.push(`db_mcp_uptime_seconds ${Math.floor(uptimeMs / 1000)}`);

  lines.push('# HELP db_mcp_connections_total Total configured connections');
  lines.push('# TYPE db_mcp_connections_total gauge');
  lines.push(`db_mcp_connections_total ${specs.length}`);

  lines.push('# HELP db_mcp_connection_requests_total Total requests per connection');
  lines.push('# TYPE db_mcp_connection_requests_total counter');
  for (const spec of specs) {
    const m = registry.getMetrics(spec.id);
    lines.push(
      `db_mcp_connection_requests_total${labels({
        connection: spec.id,
        engine: spec.engine,
      })} ${m.totalRequests}`,
    );
  }

  lines.push('# HELP db_mcp_connection_requests_failed Failed requests per connection');
  lines.push('# TYPE db_mcp_connection_requests_failed counter');
  for (const spec of specs) {
    const m = registry.getMetrics(spec.id);
    lines.push(
      `db_mcp_connection_requests_failed${labels({
        connection: spec.id,
        engine: spec.engine,
      })} ${m.failedRequests}`,
    );
  }

  lines.push('# HELP db_mcp_connection_avg_latency_ms Average latency per connection');
  lines.push('# TYPE db_mcp_connection_avg_latency_ms gauge');
  for (const spec of specs) {
    const m = registry.getMetrics(spec.id);
    const avg = m.totalRequests > 0 ? Math.round(m.totalLatencyMs / m.totalRequests) : 0;
    lines.push(
      `db_mcp_connection_avg_latency_ms${labels({
        connection: spec.id,
        engine: spec.engine,
      })} ${avg}`,
    );
  }

  lines.push('# HELP db_mcp_audit_total Total audit log entries');
  lines.push('# TYPE db_mcp_audit_total gauge');
  lines.push(`db_mcp_audit_total ${auditStats.total}`);

  lines.push('# HELP db_mcp_audit_slow_queries Total slow queries');
  lines.push('# TYPE db_mcp_audit_slow_queries gauge');
  lines.push(`db_mcp_audit_slow_queries ${auditStats.performance.slowQueries}`);

  lines.push('# HELP db_mcp_audit_p95_latency_ms P95 query latency');
  lines.push('# TYPE db_mcp_audit_p95_latency_ms gauge');
  lines.push(`db_mcp_audit_p95_latency_ms ${auditStats.performance.p95Ms}`);

  const toolCallMetrics = getToolCallMetrics();

  lines.push('# HELP db_mcp_tool_calls_total Total MCP tool calls');
  lines.push('# TYPE db_mcp_tool_calls_total counter');
  for (const metric of toolCallMetrics) {
    lines.push(
      `db_mcp_tool_calls_total${labels({
        tool: metric.tool,
        action: metric.action,
        transport: metric.transport,
        connection: metric.connectionId,
      })} ${metric.totalCalls}`,
    );
  }

  lines.push('# HELP db_mcp_tool_call_failures_total Failed MCP tool calls');
  lines.push('# TYPE db_mcp_tool_call_failures_total counter');
  for (const metric of toolCallMetrics) {
    lines.push(
      `db_mcp_tool_call_failures_total${labels({
        tool: metric.tool,
        action: metric.action,
        transport: metric.transport,
        connection: metric.connectionId,
      })} ${metric.failedCalls}`,
    );
  }

  lines.push('# HELP db_mcp_tool_call_duration_ms_sum Sum of MCP tool call durations');
  lines.push('# TYPE db_mcp_tool_call_duration_ms_sum counter');
  for (const metric of toolCallMetrics) {
    lines.push(
      `db_mcp_tool_call_duration_ms_sum${labels({
        tool: metric.tool,
        action: metric.action,
        transport: metric.transport,
        connection: metric.connectionId,
      })} ${metric.totalDurationMs}`,
    );
  }

  lines.push('# HELP db_mcp_tool_call_duration_ms_count Count of MCP tool call durations');
  lines.push('# TYPE db_mcp_tool_call_duration_ms_count counter');
  for (const metric of toolCallMetrics) {
    lines.push(
      `db_mcp_tool_call_duration_ms_count${labels({
        tool: metric.tool,
        action: metric.action,
        transport: metric.transport,
        connection: metric.connectionId,
      })} ${metric.totalCalls}`,
    );
  }

  lines.push('# HELP db_mcp_tool_call_duration_ms_max Max MCP tool call duration');
  lines.push('# TYPE db_mcp_tool_call_duration_ms_max gauge');
  for (const metric of toolCallMetrics) {
    lines.push(
      `db_mcp_tool_call_duration_ms_max${labels({
        tool: metric.tool,
        action: metric.action,
        transport: metric.transport,
        connection: metric.connectionId,
      })} ${metric.maxDurationMs}`,
    );
  }

  lines.push('# HELP db_mcp_tool_call_errors_total MCP tool call errors by code');
  lines.push('# TYPE db_mcp_tool_call_errors_total counter');
  for (const metric of toolCallMetrics) {
    for (const [errorCode, count] of Object.entries(metric.byErrorCode).sort()) {
      lines.push(
        `db_mcp_tool_call_errors_total${labels({
          tool: metric.tool,
          action: metric.action,
          transport: metric.transport,
          connection: metric.connectionId,
          error_code: errorCode,
        })} ${count}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}
