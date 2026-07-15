import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry.js';
import { globalLimits } from '../core/config.js';
import { isReadOnlyQuery } from '../core/sql-guards.js';
import { getGlobalQueryHistory, type QueryRecord } from '../core/query-replay.js';

export function registerReplayTools(server: McpServer, registry: ConnectionRegistry): void {
  const history = getGlobalQueryHistory();
  const limits = () => globalLimits();

  server.registerTool(
    'query_history',
    {
      description:
        '获取最近的查询历史记录。返回查询 SQL、参数摘要、执行时间和结果摘要（前5行采样）。',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('返回记录数，默认 20'),
        connectionId: z.string().optional().describe('按连接 ID 过滤'),
      },
    },
    async ({ limit, connectionId }) => {
      try {
        let records = history.list(limit ?? 20);
        if (connectionId) {
          records = records.filter((r) => r.connectionId === connectionId);
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                records: records.map(formatRecord),
                total: history.size,
                capacity: history.capacity,
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );

  server.registerTool(
    'query_replay',
    {
      description:
        '重新执行历史记录中的查询。通过 queryId 指定要回放的查询，使用原始 SQL 和参数重新执行。',
      inputSchema: {
        queryId: z.string().describe('要回放的查询 ID'),
        connectionId: z.string().optional().describe('使用指定连接执行（默认使用原查询的连接）'),
      },
    },
    async ({ queryId, connectionId }) => {
      try {
        const record = history.getById(queryId);
        if (!record) {
          return { content: [{ type: 'text', text: `查询记录 ${queryId} 不存在` }], isError: true };
        }

        const targetConnId = connectionId ?? record.connectionId;
        const id = registry.resolveConnectionId(targetConnId);
        const driver = registry.requireSql(id);
        const L = limits();

        if (!isReadOnlyQuery(record.sql, driver.engine)) {
          return {
            content: [{ type: 'text', text: '安全限制：回放仅支持只读查询' }],
            isError: true,
          };
        }

        const startTime = Date.now();
        const res = await driver.execute(record.sql, record.params, {
          mode: 'readonly',
          maxRows: L.maxRows,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });
        const duration = Date.now() - startTime;

        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '回放失败' }], isError: true };
        }

        // 记录回放结果到历史
        history.push({
          connectionId: id,
          engine: driver.engine,
          sql: record.sql,
          params: record.params,
          resultSummary: {
            rowCount: (res.data ?? []).length,
            fields: (res.fields ?? []).map((f) => f.name),
            sampleRows: (res.data ?? []).slice(0, 5),
          },
          executionTime: duration,
          success: true,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                replayed_from: queryId,
                connection_id: id,
                engine: driver.engine,
                data: res.data,
                totalRows: res.totalRows,
                totalRowsExact: res.totalRowsExact ?? !res.truncated,
                truncated: res.truncated,
                executionTime: duration,
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );

  server.registerTool(
    'query_diff',
    {
      description: '对比两次查询结果的差异。比较采样行数据，返回新增、删除、修改的行数和详细差异。',
      inputSchema: {
        queryIdA: z.string().describe('第一个查询 ID'),
        queryIdB: z.string().describe('第二个查询 ID'),
      },
    },
    async ({ queryIdA, queryIdB }) => {
      try {
        const diff = history.diff(queryIdA, queryIdB);
        const recordA = history.getById(queryIdA);
        const recordB = history.getById(queryIdB);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                queryA: {
                  id: queryIdA,
                  sql: recordA?.sql,
                  rowCount: recordA?.resultSummary.rowCount,
                },
                queryB: {
                  id: queryIdB,
                  sql: recordB?.sql,
                  rowCount: recordB?.resultSummary.rowCount,
                },
                diff,
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}

function formatRecord(record: QueryRecord): Record<string, unknown> {
  return {
    id: record.id,
    timestamp: record.timestamp,
    connectionId: record.connectionId,
    engine: record.engine,
    sql: record.sql,
    params: record.params.slice(0, 5),
    resultSummary: record.resultSummary,
    executionTime: record.executionTime,
    success: record.success,
  };
}
