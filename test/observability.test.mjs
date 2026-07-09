import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

class MockRegistry {
  constructor() {
    this.specs = [{ id: 'pg', engine: 'postgres', readonly: false }];
    this.metrics = {
      totalRequests: 3,
      successRequests: 2,
      failedRequests: 1,
      totalLatencyMs: 90,
      lastUsedAt: Date.now(),
      lastError: 'boom',
    };
  }

  getSpecs() {
    return this.specs;
  }

  getMetrics() {
    return this.metrics;
  }
}

describe('observability metrics', () => {
  let observability;

  beforeEach(async () => {
    observability = await import('../dist/core/observability.js');
    observability.resetObservabilityForTests();
  });

  test('aggregates tool call metrics by stable labels', () => {
    observability.recordToolCall({
      tool: 'sql_query',
      action: 'read',
      transport: 'http',
      connectionId: 'pg',
      success: true,
      durationMs: 12.4,
    });
    observability.recordToolCall({
      tool: 'sql_query',
      action: 'read',
      transport: 'http',
      connectionId: 'pg',
      success: false,
      durationMs: 30.1,
      errorCode: 'SQL_002',
    });

    const metrics = observability.getToolCallMetrics();
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].tool, 'sql_query');
    assert.equal(metrics[0].totalCalls, 2);
    assert.equal(metrics[0].failedCalls, 1);
    assert.equal(metrics[0].totalDurationMs, 42);
    assert.equal(metrics[0].maxDurationMs, 30);
    assert.deepEqual(metrics[0].byErrorCode, { SQL_002: 1 });
  });

  test('renders Prometheus text for connections and tool calls', () => {
    observability.recordToolCall({
      tool: 'sql_query',
      action: 'read',
      transport: 'stdio',
      connectionId: 'pg',
      success: false,
      durationMs: 5,
      errorCode: 'SQL_002',
    });

    const text = observability.buildPrometheusMetrics(new MockRegistry());

    assert.match(text, /# TYPE db_mcp_connection_requests_total counter/);
    assert.match(
      text,
      /db_mcp_connection_requests_total\{connection="pg",engine="postgres"\} 3/,
    );
    assert.match(
      text,
      /db_mcp_tool_calls_total\{tool="sql_query",action="read",transport="stdio",connection="pg"\} 1/,
    );
    assert.match(
      text,
      /db_mcp_tool_call_errors_total\{tool="sql_query",action="read",transport="stdio",connection="pg",error_code="SQL_002"\} 1/,
    );
  });
});
