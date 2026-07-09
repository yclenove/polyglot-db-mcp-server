import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolve } from 'node:path';
import { z } from 'zod';
import { pingRuntime } from '../core/handle-runtime.js';
import type { ConnectionRegistry } from '../core/registry.js';
import { getAuditStats } from '../core/audit.js';
import { getVersion } from '../core/version.js';
import { parseConnectionSpecs } from '../core/config.js';
import type { ConnectionSpec, Engine, SqlEngine, RuntimeHandle } from '../core/types.js';
import { isSqlEngine } from '../core/types.js';
import { buildPrometheusMetrics, getToolCallMetrics } from '../core/observability.js';
import {
  createErrorPayload,
  maskErrorCredentials,
  type ErrorCode,
  type ErrorPayload,
} from '../core/error-codes.js';

/** 服务器启动时间 */
const serverStartTime = Date.now();

/** SQL 引擎版本查询语句 */
const VERSION_QUERIES: Record<SqlEngine, string> = {
  mysql: 'SELECT VERSION() AS version',
  postgres: 'SELECT version() AS version',
  mssql: 'SELECT @@VERSION AS version',
  oracle: 'SELECT BANNER AS version FROM V$VERSION WHERE ROWNUM = 1',
  sqlite: 'SELECT sqlite_version() AS version',
  duckdb: 'SELECT version() AS version',
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

function localSqlPathHint(spec: ConnectionSpec): string | null {
  if (spec.engine !== 'sqlite' && spec.engine !== 'duckdb') return null;
  const raw = spec.url ?? spec.database ?? ':memory:';
  if (raw === ':memory:') {
    return `${spec.engine === 'sqlite' ? 'SQLite' : 'DuckDB'} 当前使用 :memory: 内存数据库；进程结束后数据不会保留`;
  }
  const withoutPrefix = raw.startsWith('file:') ? raw.slice(5).replace(/^\/\//, '') : raw;
  const resolved = resolve(process.cwd(), withoutPrefix);
  return `${spec.engine === 'sqlite' ? 'SQLite' : 'DuckDB'} 文件路径将按当前工作目录解析为 ${resolved}；如 ping 失败，请检查父目录权限`;
}

function classifyConnectionError(rawError?: string): ErrorCode {
  const msg = (rawError ?? '').toLowerCase();
  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('etimedout') ||
    msg.includes('eai_again')
  ) {
    return 'CONN_002';
  }
  if (
    msg.includes('closed') ||
    msg.includes('reset') ||
    msg.includes('econnreset') ||
    msg.includes('lost') ||
    msg.includes('gone away')
  ) {
    return 'CONN_003';
  }
  if (msg.includes('pool') && (msg.includes('exhaust') || msg.includes('acquire'))) {
    return 'CONN_004';
  }
  return 'CONN_001';
}

function errorSpecificSuggestions(spec: ConnectionSpec, rawError?: string): string[] {
  if (!rawError) return [];
  const msg = rawError.toLowerCase();
  const suggestions: string[] = [];

  if (msg.includes('econnrefused') || msg.includes('connection refused')) {
    suggestions.push('确认数据库服务已启动，并检查 host/port 与 Docker 端口映射');
  }
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('timed out')) {
    suggestions.push('检查网络、防火墙、VPN、数据库负载，并按需增大 DB_QUERY_TIMEOUT');
  }
  if (
    msg.includes('auth') ||
    msg.includes('password') ||
    msg.includes('login failed') ||
    msg.includes('permission denied') ||
    msg.includes('access denied')
  ) {
    suggestions.push('检查 user/password/database；MongoDB 还需确认 authSource');
  }
  if (spec.engine === 'sqlite' || spec.engine === 'duckdb') {
    const hint = localSqlPathHint(spec);
    if (hint) suggestions.push(hint);
  }

  return suggestions;
}

/** 根据连接配置和错误生成诊断建议 */
function generateSuggestions(spec: ConnectionSpec, rawError?: string): string[] {
  const suggestions: string[] = [];

  if (spec.readonly !== true && spec.readonly !== false) {
    suggestions.push('建议明确设置 readonly 字段，提高安全性');
  }

  if (spec.readonly === true) {
    suggestions.push('当前连接为只读；写操作需使用独立写连接并设置 readonly:false');
  }

  if (!spec.database) {
    if (spec.engine !== 'redis' && spec.engine !== 'sqlite' && spec.engine !== 'duckdb') {
      suggestions.push(`建议设置 database 字段以明确目标数据库`);
    }
  }

  if (spec.engine === 'redis' && !spec.keyPrefix) {
    suggestions.push('建议设置 keyPrefix 字段以隔离键命名空间');
  }

  if (spec.engine === 'redis' && spec.keyPrefix) {
    suggestions.push(`Redis key 必须以 keyPrefix「${spec.keyPrefix}」开头`);
  }

  if (isSqlEngine(spec.engine) && !spec.allowlist?.length) {
    suggestions.push('建议设置 allowlist 字段限制可访问的数据库');
  }

  if (spec.engine === 'mongodb' && !spec.allowlist?.length) {
    suggestions.push('建议设置 allowlist 字段限制可访问的集合');
  }

  if (!spec.url && !spec.host && spec.engine !== 'sqlite' && spec.engine !== 'duckdb') {
    suggestions.push('连接缺少 url 和 host 配置，请检查连接配置是否完整');
  }

  const localPathHint = localSqlPathHint(spec);
  if (localPathHint) {
    suggestions.push(localPathHint);
  }

  if (spec.engine === 'duckdb' && !spec.allowlist?.length) {
    suggestions.push('DuckDB 外部文件访问默认关闭；读取 CSV/Parquet/JSON 前请设置 allowlist');
  }

  suggestions.push(...errorSpecificSuggestions(spec, rawError));

  return [...new Set(suggestions)];
}

function buildErrorInfo(spec: ConnectionSpec, rawError?: string): ErrorPayload {
  const code = classifyConnectionError(rawError);
  return createErrorPayload(code, {
    connection_id: spec.id,
    engine: spec.engine,
  });
}

interface ConnectionDiagnoseResult {
  id: string;
  connection_id: string;
  engine: Engine;
  status: 'ok' | 'error';
  latency_ms: number | null;
  server_version: string | null;
  readonly: boolean;
  error?: string;
  error_info?: ErrorPayload;
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
      const error = maskErrorCredentials(r.error ?? 'ping 失败');
      return {
        id: spec.id,
        connection_id: spec.id,
        engine: spec.engine,
        status: 'error',
        latency_ms: latency,
        server_version: null,
        readonly: spec.readonly === true,
        error,
        error_info: buildErrorInfo(spec, error),
        suggestions: generateSuggestions(spec, error),
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
      connection_id: spec.id,
      engine: spec.engine,
      status: 'ok',
      latency_ms: latency,
      server_version: serverVersion,
      readonly: spec.readonly === true,
      suggestions,
    };
  } catch (e) {
    const error = maskErrorCredentials(e instanceof Error ? e.message : String(e));
    return {
      id: spec.id,
      connection_id: spec.id,
      engine: spec.engine,
      status: 'error',
      latency_ms: Date.now() - pingStart,
      server_version: null,
      readonly: spec.readonly === true,
      error,
      error_info: buildErrorInfo(spec, error),
      suggestions: generateSuggestions(spec, error),
    };
  }
}

function unknownConnectionPayload(connectionId: string, available: string[]): ErrorPayload {
  return createErrorPayload(
    'CONN_006',
    { connection_id: connectionId, available_connections: available },
    `可用连接: ${available.join(', ') || '(无)'}`,
  );
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
        const error = r.error ? maskErrorCredentials(r.error) : undefined;
        const errorInfo = r.ok ? undefined : buildErrorInfo(h.spec, error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                ok: r.ok,
                error,
                error_info: errorInfo,
              }),
            },
          ],
          isError: !r.ok,
        };
      } catch (e) {
        const msg = maskErrorCredentials(e instanceof Error ? e.message : String(e));
        const available = registry.getSpecs().map((s) => s.id);
        const errorInfo = connection_id
          ? unknownConnectionPayload(connection_id, available)
          : createErrorPayload('CLI_004', { error: msg });
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: msg, error_info: errorInfo }) }],
          isError: true,
        };
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
          const msg = maskErrorCredentials(e instanceof Error ? e.message : String(e));
          results.push({
            id: spec.id,
            engine: spec.engine,
            readonly: spec.readonly === true,
            status: 'error',
            latency_ms: Date.now() - pingStart,
            error: msg,
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
              tools: getToolCallMetrics(),
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
      return {
        content: [{ type: 'text', text: buildPrometheusMetrics(registry) }],
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
        let targetSpecs: readonly ConnectionSpec[];
        if (connection_id && connection_id.trim() !== '') {
          let resolvedId: string;
          try {
            resolvedId = registry.resolveConnectionId(connection_id);
          } catch {
            const errorInfo = unknownConnectionPayload(
              connection_id,
              specs.map((s) => s.id),
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: errorInfo.message,
                    error_info: errorInfo,
                  }),
                },
              ],
              isError: true,
            };
          }
          targetSpecs = specs.filter((s) => s.id === resolvedId);
        } else {
          targetSpecs = [...specs];
        }

        if (connection_id && targetSpecs.length === 0) {
          const errorInfo = unknownConnectionPayload(
            connection_id,
            specs.map((s) => s.id),
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: errorInfo.message,
                  error_info: errorInfo,
                }),
              },
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
        const msg = maskErrorCredentials(e instanceof Error ? e.message : String(e));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: msg,
                error_info: createErrorPayload('CLI_004', { error: msg }),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
