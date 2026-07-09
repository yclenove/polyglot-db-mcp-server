import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { pingRuntime } from '../core/handle-runtime.js';
import type { ConnectionRegistry } from '../core/registry.js';
import { getAuditStats } from '../core/audit.js';
import { getVersion } from '../core/version.js';
import { parseConnectionSpecs } from '../core/config.js';
import type { ConnectionSpec, Engine, SqlEngine, RuntimeHandle } from '../core/types.js';
import { isSqlEngine } from '../core/types.js';

/** 服务器启动时间 */
const serverStartTime = Date.now();

/** SQL 引擎版本查询语句 */
const VERSION_QUERIES: Record<SqlEngine, string> = {
  mysql: 'SELECT VERSION() AS version',
  postgres: 'SELECT version() AS version',
  mssql: 'SELECT @@VERSION AS version',
  oracle: 'SELECT BANNER AS version FROM V$VERSION WHERE ROWNUM = 1',
  sqlite: 'SELECT sqlite_version() AS version',
};

/** 根据引擎获取服务器版本 */
async function getServerVersion(handle: RuntimeHandle): Promise<string | null> {
  if (handle.kind === 'sql') {
    const sql = VERSION_QUERIES[handle.driver.engine];
    if (!sql) return null;
    const result = await handle.driver.execute(sql, undefined, {
      mode: 'readonly',
      maxRows: 1,
      queryTimeoutMs: 5000,
      maxSqlLength: 500,
    });
    if (result.success && result.data && result.data.length > 0) {
      const row = result.data[0] as Record<string, unknown>;
      // 不同引擎返回的字段名可能不同，取第一个字段
      const firstKey = Object.keys(row)[0];
      return firstKey ? String(row[firstKey]) : null;
    }
    return null;
  }
  if (handle.kind === 'mongo') {
    // MongoDriver 未暴露 command 方法，版本信息暂不可用
    return null;
  }
  if (handle.kind === 'redis') {
    // RedisDriver 未暴露 info 方法，版本信息暂不可用
    return null;
  }
  return null;
}

/** 根据连接配置生成诊断建议 */
function generateSuggestions(spec: ConnectionSpec): string[] {
  const suggestions: string[] = [];

  if (spec.readonly !== true && spec.readonly !== false) {
    suggestions.push('建议明确设置 readonly 字段，提高安全性');
  }

  if (!spec.database) {
    if (spec.engine !== 'redis') {
      suggestions.push(`建议设置 database 字段以明确目标数据库`);
    }
  }

  if (spec.engine === 'redis' && !spec.keyPrefix) {
    suggestions.push('建议设置 keyPrefix 字段以隔离键命名空间');
  }

  if (isSqlEngine(spec.engine) && !spec.allowlist?.length) {
    suggestions.push('建议设置 allowlist 字段限制可访问的数据库');
  }

  if (spec.engine === 'mongodb' && !spec.allowlist?.length) {
    suggestions.push('建议设置 allowlist 字段限制可访问的集合');
  }

  if (!spec.url && !spec.host) {
    suggestions.push('连接缺少 url 和 host 配置，请检查连接配置是否完整');
  }

  return suggestions;
}

interface ConnectionDiagnoseResult {
  id: string;
  engine: Engine;
  status: 'ok' | 'error';
  latency_ms: number | null;
  server_version: string | null;
  readonly: boolean;
  error?: string;
  suggestions: string[];
}

async function diagnoseConnection(
  spec: ConnectionSpec,
  handle: RuntimeHandle,
): Promise<ConnectionDiagnoseResult> {
  const suggestions = generateSuggestions(spec);
  const pingStart = Date.now();

  try {
    const r = await pingRuntime(handle);
    const latency = Date.now() - pingStart;

    if (!r.ok) {
      return {
        id: spec.id,
        engine: spec.engine,
        status: 'error',
        latency_ms: latency,
        server_version: null,
        readonly: spec.readonly === true,
        error: r.error ?? 'ping 失败',
        suggestions,
      };
    }

    // ping 成功，尝试获取版本信息
    let serverVersion: string | null = null;
    try {
      serverVersion = await getServerVersion(handle);
    } catch {
      // 获取版本失败不影响诊断结果
    }

    return {
      id: spec.id,
      engine: spec.engine,
      status: 'ok',
      latency_ms: latency,
      server_version: serverVersion,
      readonly: spec.readonly === true,
      suggestions,
    };
  } catch (e) {
    return {
      id: spec.id,
      engine: spec.engine,
      status: 'error',
      latency_ms: Date.now() - pingStart,
      server_version: null,
      readonly: spec.readonly === true,
      error: e instanceof Error ? e.message : String(e),
      suggestions,
    };
  }
}

export function registerConnectionTools(server: McpServer, registry: ConnectionRegistry): void {
  server.registerTool(
    'validate_connection_config',
    {
      description: '验证 DB_MCP_CONNECTIONS JSON 配置的合法性，返回解析结果或错误详情。',
      inputSchema: {
        config_json: z.string().describe('DB_MCP_CONNECTIONS 的 JSON 字符串'),
      },
    },
    async ({ config_json }) => {
      try {
        const specs = parseConnectionSpecs(config_json);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                valid: true,
                connections: specs.map((s) => ({
                  id: s.id,
                  engine: s.engine,
                  readonly: s.readonly ?? false,
                  hasUrl: !!s.url,
                  hasHost: !!s.host,
                })),
                count: specs.length,
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: JSON.stringify({ valid: false, error: msg }) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'list_connections',
    {
      description: '列出 DB_MCP_CONNECTIONS 中所有 connection_id、engine 与是否只读',
      inputSchema: {},
    },
    async () => {
      return {
        content: [{ type: 'text', text: JSON.stringify({ connections: registry.listMeta() }) }],
      };
    },
  );

  server.registerTool(
    'test_connection',
    {
      description:
        '对指定 connection_id 执行 ping（缺省使用 DB_MCP_DEFAULT_CONNECTION_ID 或第一条）',
      inputSchema: {
        connection_id: z.string().optional().describe('连接 id；缺省为默认连接'),
      },
    },
    async ({ connection_id }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const h = registry.require(id);
        const r = await pingRuntime(h);
        return {
          content: [{ type: 'text', text: JSON.stringify({ connection_id: id, ...r }) }],
          isError: !r.ok,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );

  server.registerTool(
    'health_check',
    {
      description: '执行全面的健康检查，测试所有连接的状态和延迟。',
      inputSchema: {},
    },
    async () => {
      const specs = registry.getSpecs();
      const results: Array<{
        id: string;
        engine: string;
        readonly: boolean;
        status: 'ok' | 'error';
        latency_ms?: number;
        error?: string;
      }> = [];

      const startTime = Date.now();

      for (const spec of specs) {
        const h = registry.require(spec.id);
        const pingStart = Date.now();
        try {
          const r = await pingRuntime(h);
          const latency = Date.now() - pingStart;
          results.push({
            id: spec.id,
            engine: spec.engine,
            readonly: spec.readonly === true,
            status: r.ok ? 'ok' : 'error',
            latency_ms: latency,
            error: r.error,
          });
        } catch (e) {
          results.push({
            id: spec.id,
            engine: spec.engine,
            readonly: spec.readonly === true,
            status: 'error',
            latency_ms: Date.now() - pingStart,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const totalTime = Date.now() - startTime;
      const allOk = results.every((r) => r.status === 'ok');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: allOk ? 'healthy' : 'degraded',
              total_latency_ms: totalTime,
              default_connection: registry.getDefaultId(),
              connections: results,
            }),
          },
        ],
        isError: !allOk,
      };
    },
  );

  server.registerTool(
    'connection_stats',
    {
      description: '返回各连接的统计信息，包括总请求数、审计统计和性能指标。',
      inputSchema: {},
    },
    async () => {
      const specs = registry.getSpecs();
      const auditStats = getAuditStats();

      const connections = specs.map((spec) => {
        const m = registry.getMetrics(spec.id);
        return {
          id: spec.id,
          engine: spec.engine,
          readonly: spec.readonly === true,
          total_requests: m.totalRequests,
          success_requests: m.successRequests,
          failed_requests: m.failedRequests,
          avg_latency_ms: m.totalRequests > 0 ? Math.round(m.totalLatencyMs / m.totalRequests) : 0,
          last_used_at: m.lastUsedAt > 0 ? new Date(m.lastUsedAt).toISOString() : null,
          last_error: m.lastError,
        };
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              connections,
              audit: {
                total: auditStats.total,
                success: auditStats.success,
                failed: auditStats.failed,
                byEngine: auditStats.byEngine,
                performance: auditStats.performance,
              },
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'prometheus_metrics',
    {
      description: '返回 Prometheus 格式的指标数据（文本格式），可用于监控系统集成。',
      inputSchema: {},
    },
    async () => {
      const specs = registry.getSpecs();
      const auditStats = getAuditStats();
      const uptimeMs = Date.now() - serverStartTime;
      const lines: string[] = [];

      // 服务器指标
      lines.push('# HELP db_mcp_uptime_seconds Server uptime in seconds');
      lines.push('# TYPE db_mcp_uptime_seconds gauge');
      lines.push(`db_mcp_uptime_seconds ${Math.floor(uptimeMs / 1000)}`);

      lines.push('# HELP db_mcp_connections_total Total configured connections');
      lines.push('# TYPE db_mcp_connections_total gauge');
      lines.push(`db_mcp_connections_total ${specs.length}`);

      // 每连接指标
      lines.push('# HELP db_mcp_connection_requests_total Total requests per connection');
      lines.push('# TYPE db_mcp_connection_requests_total counter');
      for (const spec of specs) {
        const m = registry.getMetrics(spec.id);
        lines.push(
          `db_mcp_connection_requests_total{connection="${spec.id}",engine="${spec.engine}"} ${m.totalRequests}`,
        );
      }

      lines.push('# HELP db_mcp_connection_requests_failed Failed requests per connection');
      lines.push('# TYPE db_mcp_connection_requests_failed counter');
      for (const spec of specs) {
        const m = registry.getMetrics(spec.id);
        lines.push(
          `db_mcp_connection_requests_failed{connection="${spec.id}",engine="${spec.engine}"} ${m.failedRequests}`,
        );
      }

      lines.push('# HELP db_mcp_connection_avg_latency_ms Average latency per connection');
      lines.push('# TYPE db_mcp_connection_avg_latency_ms gauge');
      for (const spec of specs) {
        const m = registry.getMetrics(spec.id);
        const avg = m.totalRequests > 0 ? Math.round(m.totalLatencyMs / m.totalRequests) : 0;
        lines.push(
          `db_mcp_connection_avg_latency_ms{connection="${spec.id}",engine="${spec.engine}"} ${avg}`,
        );
      }

      // 审计指标
      lines.push('# HELP db_mcp_audit_total Total audit log entries');
      lines.push('# TYPE db_mcp_audit_total gauge');
      lines.push(`db_mcp_audit_total ${auditStats.total}`);

      lines.push('# HELP db_mcp_audit_slow_queries Total slow queries');
      lines.push('# TYPE db_mcp_audit_slow_queries gauge');
      lines.push(`db_mcp_audit_slow_queries ${auditStats.performance.slowQueries}`);

      lines.push('# HELP db_mcp_audit_p95_latency_ms P95 query latency');
      lines.push('# TYPE db_mcp_audit_p95_latency_ms gauge');
      lines.push(`db_mcp_audit_p95_latency_ms ${auditStats.performance.p95Ms}`);

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    },
  );

  server.registerTool(
    'server_info',
    {
      description: '返回服务器版本、运行时间、工具数量等信息。',
      inputSchema: {},
    },
    async () => {
      const specs = registry.getSpecs();
      const uptimeMs = Date.now() - serverStartTime;
      const uptimeSeconds = Math.floor(uptimeMs / 1000);
      const uptimeMinutes = Math.floor(uptimeSeconds / 60);
      const uptimeHours = Math.floor(uptimeMinutes / 60);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              name: 'polyglot-db-mcp-server',
              version: getVersion(),
              uptime: {
                ms: uptimeMs,
                seconds: uptimeSeconds,
                formatted: `${uptimeHours}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s`,
              },
              connections: {
                total: specs.length,
                byEngine: specs.reduce(
                  (acc, s) => {
                    acc[s.engine] = (acc[s.engine] ?? 0) + 1;
                    return acc;
                  },
                  {} as Record<string, number>,
                ),
              },
              defaultConnection: registry.getDefaultId(),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'connection_diagnose',
    {
      description: '全面诊断所有连接的健康状况，返回状态、延迟、版本信息和配置建议',
      inputSchema: {
        connection_id: z.string().optional().describe('指定连接 ID，不传则诊断所有连接'),
      },
    },
    async ({ connection_id }) => {
      try {
        const specs = registry.getSpecs();
        const targetSpecs = connection_id
          ? specs.filter((s) => s.id === registry.resolveConnectionId(connection_id))
          : [...specs];

        if (connection_id && targetSpecs.length === 0) {
          return {
            content: [
              { type: 'text', text: JSON.stringify({ error: `未找到连接: ${connection_id}` }) },
            ],
            isError: true,
          };
        }

        const results: ConnectionDiagnoseResult[] = [];
        for (const spec of targetSpecs) {
          const handle = registry.require(spec.id);
          const result = await diagnoseConnection(spec, handle);
          results.push(result);
        }

        const healthy = results.filter((r) => r.status === 'ok').length;
        const unhealthy = results.filter((r) => r.status === 'error').length;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connections: results,
                summary: {
                  total: results.length,
                  healthy,
                  unhealthy,
                },
              }),
            },
          ],
          isError: unhealthy > 0,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
      }
    },
  );
}
