import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry.js';
import type { SqlDriver } from '../core/types.js';
import { globalLimits } from '../core/config.js';
import { isReadOnlyQuery } from '../core/sql-guards.js';
import { analyzeQuery, generateAnalysis, type TableInfo } from '../core/query-suggest.js';
import { describeTableSql, explainQuerySql, listIndexesSql } from '../core/sql-helpers.js';

type SqlResultRow = Record<string, unknown>;

// 提取 WHERE/ORDER BY 列名用于索引建议
function extractReferencedTables(sql: string): string[] {
  const normalized = sql
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
  const tables: string[] = [];
  const fromMatch = normalized.matchAll(/\bfrom\s+([a-z_][a-z_0-9]*)/gi);
  for (const m of fromMatch) {
    if (m[1]) tables.push(m[1]);
  }
  const joinMatch = normalized.matchAll(/\bjoin\s+([a-z_][a-z_0-9]*)/gi);
  for (const m of joinMatch) {
    if (m[1]) tables.push(m[1]);
  }
  return [...new Set(tables)];
}

async function fetchTableInfo(
  driver: SqlDriver,
  tableName: string,
  L: ReturnType<typeof globalLimits>,
): Promise<TableInfo> {
  // 获取列信息
  const { sql: colSql, params: colParams } = describeTableSql(driver.engine, tableName);
  const colRes = await driver.execute(colSql, colParams, {
    mode: 'readonly',
    maxRows: 2000,
    queryTimeoutMs: L.queryTimeoutMs,
    maxSqlLength: L.maxSqlLength,
  });

  const columns = ((colRes.data ?? []) as SqlResultRow[]).map((row) => ({
    name: String(row.column_name ?? row.COLUMN_NAME ?? row.Field ?? Object.values(row)[0]),
    type: String(row.data_type ?? row.DATA_TYPE ?? row.Type ?? Object.values(row)[1]),
    isPrimaryKey: String(row.column_key ?? row.COLUMN_KEY ?? '').toUpperCase() === 'PRI',
  }));

  // 获取索引信息
  const { sql: idxSql, params: idxParams } = listIndexesSql(driver.engine, tableName);
  const idxRes = await driver.execute(idxSql, idxParams, {
    mode: 'readonly',
    maxRows: 2000,
    queryTimeoutMs: L.queryTimeoutMs,
    maxSqlLength: L.maxSqlLength,
  });

  const indexesMap = new Map<string, string[]>();
  for (const row of (idxRes.data ?? []) as SqlResultRow[]) {
    const idxName = String(row.name ?? row.Key_name ?? row.indexname ?? '');
    const colName = String(row.column_name ?? row.Column_name ?? '');
    if (idxName && colName) {
      const existing = indexesMap.get(idxName) ?? [];
      if (!existing.includes(colName)) {
        existing.push(colName);
        indexesMap.set(idxName, existing);
      }
    }
  }

  return {
    tableName,
    columns,
    indexes: Array.from(indexesMap.entries()).map(([name, cols]) => ({ name, columns: cols })),
  };
}

export function registerAdvisorTools(server: McpServer, registry: ConnectionRegistry): void {
  const limits = () => globalLimits();

  server.registerTool(
    'query_suggest',
    {
      description:
        '对 SQL 进行静态分析，返回优化建议（SELECT * 检测、全表扫描风险、索引建议、通配符检测等）。',
      inputSchema: {
        sql: z.string().describe('要分析的 SQL 查询'),
        connectionId: z.string().optional().describe('连接 ID，用于获取表结构信息以提供索引建议'),
      },
    },
    async ({ sql, connectionId }) => {
      try {
        let tableInfo: TableInfo[] | undefined;

        if (connectionId) {
          const id = registry.resolveConnectionId(connectionId);
          const driver = registry.requireSql(id);
          const L = limits();

          const tables = extractReferencedTables(sql);
          tableInfo = [];
          for (const table of tables) {
            try {
              const info = await fetchTableInfo(driver, table, L);
              tableInfo.push(info);
            } catch {
              // 获取表信息失败不阻断分析
            }
          }
        }

        const suggestions = analyzeQuery(sql, tableInfo);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sql,
                suggestions,
                analyzedWithSchema: !!tableInfo,
                tableCount: tableInfo?.length ?? 0,
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
    'query_optimize',
    {
      description: '综合优化分析：结合 SQL 静态分析和 EXPLAIN 执行计划，返回全面的优化建议。',
      inputSchema: {
        sql: z.string().describe('要分析的 SQL 查询'),
        connectionId: z.string().optional().describe('连接 ID，用于执行 EXPLAIN 和获取表结构'),
      },
    },
    async ({ sql, connectionId }) => {
      try {
        const engine = connectionId
          ? registry.requireSql(registry.resolveConnectionId(connectionId)).engine
          : undefined;
        if (!isReadOnlyQuery(sql, engine)) {
          return {
            content: [{ type: 'text', text: '错误：query_optimize 仅支持 SELECT 类查询' }],
            isError: true,
          };
        }

        if (!connectionId) {
          // 仅静态分析
          const suggestions = analyzeQuery(sql);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  sql,
                  suggestions,
                  executionPlan: null,
                  note: '未提供 connectionId，仅进行静态分析',
                }),
              },
            ],
          };
        }

        const id = registry.resolveConnectionId(connectionId);
        const driver = registry.requireSql(id);
        const L = limits();

        // 获取表结构
        const tables = extractReferencedTables(sql);
        const tableInfo: TableInfo[] = [];
        for (const table of tables) {
          try {
            const info = await fetchTableInfo(driver, table, L);
            tableInfo.push(info);
          } catch {
            // 获取表信息失败不阻断分析
          }
        }

        // 执行 EXPLAIN
        let executionPlan: Record<string, unknown>[] | undefined;
        let planError: string | undefined;

        try {
          const explainSql = explainQuerySql(driver.engine, sql);

          const explainRes = await driver.execute(explainSql, [], {
            mode: 'readonly',
            maxRows: 100,
            queryTimeoutMs: L.queryTimeoutMs,
            maxSqlLength: L.maxSqlLength,
          });

          if (explainRes.success) {
            executionPlan = (explainRes.data ?? []) as Record<string, unknown>[];
          } else {
            planError = explainRes.error;
          }
        } catch (e) {
          planError = e instanceof Error ? e.message : String(e);
        }

        const result = generateAnalysis(
          sql,
          tableInfo.length > 0 ? tableInfo : undefined,
          executionPlan,
          driver.engine,
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...result,
                connection_id: id,
                engine: driver.engine,
                tableInfo: tableInfo.map((t) => ({
                  name: t.tableName,
                  columnCount: t.columns.length,
                  indexCount: t.indexes.length,
                })),
                planError,
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
