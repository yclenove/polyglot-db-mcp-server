import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getRecentAuditLogs,
  filterAuditLogs,
  getAuditStats,
  type AuditEntry,
} from '../core/audit.js';

export function registerAuditTools(server: McpServer): void {
  server.registerTool(
    'audit_get_recent',
    {
      description: '获取最近的审计日志记录。',
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional().describe('返回记录数，默认 100'),
      },
    },
    async ({ limit }) => {
      try {
        const logs = getRecentAuditLogs(limit ?? 100);
        return {
          content: [{ type: 'text', text: JSON.stringify({ logs, count: logs.length }) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );

  server.registerTool(
    'audit_filter',
    {
      description: '按条件过滤审计日志。',
      inputSchema: {
        engine: z
          .string()
          .optional()
          .describe('按引擎过滤：mysql/postgres/mssql/oracle/mongodb/redis'),
        connection_id: z.string().optional().describe('按连接 ID 过滤'),
        operation: z.string().optional().describe('按操作类型过滤：query/execute/insertOne 等'),
        success: z.boolean().optional().describe('按成功/失败过滤'),
        since: z.string().optional().describe('起始时间（ISO 8601）'),
        until: z.string().optional().describe('结束时间（ISO 8601）'),
        limit: z.number().int().min(1).max(1000).optional().describe('返回记录数，默认 100'),
      },
    },
    async ({ engine, connection_id, operation, success, since, until, limit }) => {
      try {
        const logs = filterAuditLogs({
          engine,
          connection_id,
          operation,
          success,
          since,
          until,
          limit,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ logs, count: logs.length }) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );

  server.registerTool(
    'audit_stats',
    {
      description: '获取审计日志统计信息。',
      inputSchema: {},
    },
    async () => {
      try {
        const stats = getAuditStats();
        return {
          content: [{ type: 'text', text: JSON.stringify(stats) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );

  server.registerTool(
    'export_audit',
    {
      description: '导出审计日志，支持 JSON 格式。可按时间范围和数量限制过滤。',
      inputSchema: {
        format: z.enum(['json']).optional().describe('导出格式，默认 json'),
        limit: z.number().int().min(1).max(10000).optional().describe('最大导出条数，默认 1000'),
        since: z
          .string()
          .optional()
          .describe('起始时间（ISO 8601 时间戳），仅导出该时间之后的记录'),
      },
    },
    async ({ format, limit, since }) => {
      try {
        const maxLimit = limit ?? 1000;
        let entries: AuditEntry[];
        if (since) {
          entries = filterAuditLogs({ since, limit: maxLimit });
        } else {
          entries = getRecentAuditLogs(maxLimit);
        }
        const exportData = {
          exportedAt: new Date().toISOString(),
          format: format ?? 'json',
          count: entries.length,
          entries,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(exportData, null, 2) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
