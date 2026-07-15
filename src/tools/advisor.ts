import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry.js';
import type { SqlDriver } from '../core/types.js';
import { globalLimits } from '../core/config.js';
import { isReadOnlyQuery } from '../core/sql-guards.js';
import { analyzeQuery, generateAnalysis, type TableInfo } from '../core/query-suggest.js';
import { describeTableSql, explainQuerySql, listIndexesSql } from '../core/sql-helpers.js';

type SqlResultRow = Record<string, unknown>;

function rowValue(row: SqlResultRow, ...keys: string[]): unknown {
  const values = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    if (values.has(key.toLowerCase())) return values.get(key.toLowerCase());
  }
  return undefined;
}

function isPrimaryKeyValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value > 0;
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();
  return normalized === 'PRI' || normalized === 'PRIMARY' || normalized === 'TRUE';
}

function normalizeColumns(rows: SqlResultRow[]): TableInfo['columns'] {
  const columns: TableInfo['columns'] = [];
  for (const row of rows) {
    const name = String(rowValue(row, 'column_name', 'field', 'name') ?? '').trim();
    if (!name) continue;
    columns.push({
      name,
      type: String(rowValue(row, 'data_type', 'type', 'column_type') ?? ''),
      isPrimaryKey: isPrimaryKeyValue(rowValue(row, 'column_key', 'key', 'pk', 'is_primary')),
    });
  }
  return columns;
}

function columnsFromDefinition(definition: string, columns: TableInfo['columns']): string[] {
  const canonical = new Map(columns.map((column) => [column.name.toLowerCase(), column.name]));
  const trimmed = definition.trim();
  const body = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  const found: string[] = [];
  const wrappers: ReadonlyArray<readonly [string, string]> = [
    ["'", "'"],
    ['"', '"'],
    ['`', '`'],
    ['[', ']'],
  ];

  for (const expression of body.split(',')) {
    let identifier = expression.trim();
    for (const [open, close] of wrappers) {
      if (identifier.startsWith(open) && identifier.endsWith(close)) {
        identifier = identifier.slice(1, -1).trim();
      }
    }
    const column = /^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)
      ? canonical.get(identifier.toLowerCase())
      : undefined;
    if (column && !found.includes(column)) found.push(column);
  }

  return found;
}

function normalizeIndexes(
  rows: SqlResultRow[],
  columns: TableInfo['columns'],
): TableInfo['indexes'] {
  const indexes = new Map<string, string[]>();
  const canonicalColumns = new Map(
    columns.map((column) => [column.name.toLowerCase(), column.name]),
  );

  for (const row of rows) {
    const name = String(rowValue(row, 'name', 'index_name', 'indexname', 'key_name') ?? '').trim();
    if (!name) continue;

    const existing = indexes.get(name) ?? [];
    const directColumn = String(rowValue(row, 'column_name', 'column') ?? '').trim();
    const definition = String(rowValue(row, 'definition', 'expressions', 'indexdef', 'sql') ?? '');
    const candidates = directColumn
      ? [canonicalColumns.get(directColumn.toLowerCase()) ?? directColumn]
      : columnsFromDefinition(definition, columns);

    for (const column of candidates) {
      if (!existing.some((item) => item.toLowerCase() === column.toLowerCase())) {
        existing.push(column);
      }
    }
    indexes.set(name, existing);
  }

  return Array.from(indexes.entries()).map(([name, indexColumns]) => ({
    name,
    columns: indexColumns,
  }));
}

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
  if (!colRes.success) throw new Error(colRes.error ?? `无法读取表 ${tableName} 的列信息`);

  const columns = normalizeColumns((colRes.data ?? []) as SqlResultRow[]);
  if (columns.length === 0) throw new Error(`表 ${tableName} 没有可分析的列信息`);

  // 获取索引信息
  const { sql: idxSql, params: idxParams } = listIndexesSql(driver.engine, tableName);
  const idxRes = await driver.execute(idxSql, idxParams, {
    mode: 'readonly',
    maxRows: 2000,
    queryTimeoutMs: L.queryTimeoutMs,
    maxSqlLength: L.maxSqlLength,
  });
  if (!idxRes.success) throw new Error(idxRes.error ?? `无法读取表 ${tableName} 的索引信息`);

  return {
    tableName,
    columns,
    indexes: normalizeIndexes((idxRes.data ?? []) as SqlResultRow[], columns),
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
                analyzedWithSchema: (tableInfo?.length ?? 0) > 0,
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
