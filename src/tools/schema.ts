import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry.js';
import { globalLimits } from '../core/config.js';
import type { SqlEngine } from '../core/types.js';

function getSchemaSql(engine: SqlEngine, database?: string): { sql: string; params?: unknown[] } {
  switch (engine) {
    case 'mysql':
      return {
        sql: `SELECT
          TABLE_NAME as table_name,
          COLUMN_NAME as column_name,
          DATA_TYPE as data_type,
          IS_NULLABLE as is_nullable,
          COLUMN_KEY as column_key,
          COLUMN_DEFAULT as column_default,
          EXTRA as extra
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      };
    case 'postgres':
      return {
        sql: `SELECT
          c.table_name,
          c.column_name,
          c.data_type,
          c.is_nullable,
          CASE WHEN pk.column_name IS NOT NULL THEN 'YES' ELSE 'NO' END as column_key,
          c.column_default
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT ku.table_name, ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
        WHERE c.table_schema = $1
        ORDER BY c.table_name, c.ordinal_position`,
        params: [database ?? 'public'],
      };
    case 'mssql':
      return {
        sql: `SELECT
          TABLE_NAME as table_name,
          COLUMN_NAME as column_name,
          DATA_TYPE as data_type,
          IS_NULLABLE as is_nullable,
          COLUMN_DEFAULT as column_default
        FROM INFORMATION_SCHEMA.COLUMNS
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      };
    case 'oracle':
      return {
        sql: `SELECT
          table_name,
          column_name,
          data_type,
          nullable as is_nullable,
          data_default as column_default
        FROM user_tab_columns
        ORDER BY table_name, column_id`,
      };
    case 'sqlite':
      return {
        sql: `SELECT
          m.name AS table_name,
          p.name AS column_name,
          p.type AS data_type,
          CASE WHEN p."notnull" = 0 THEN 'YES' ELSE 'NO' END AS is_nullable,
          CASE WHEN p.pk = 1 THEN 'YES' ELSE 'NO' END AS column_key,
          p.dflt_value AS column_default
        FROM sqlite_master m
        JOIN pragma_table_info(m.name) p
        WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
        ORDER BY m.name, p.cid`,
      };
    default: {
      const e: never = engine;
      throw new Error(`不支持的 SQL 引擎: ${e}`);
    }
  }
}

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_key?: string;
  column_default?: string;
  extra?: string;
}

interface TableSchema {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    primaryKey: boolean;
    default?: string;
  }>;
}

interface SchemaDiff {
  added_tables: TableSchema[];
  removed_tables: TableSchema[];
  changed_tables: Array<{
    table: string;
    added_columns: TableSchema['columns'];
    removed_columns: TableSchema['columns'];
    changed_columns: Array<{
      column: string;
      source: TableSchema['columns'][number];
      target: TableSchema['columns'][number];
      changes: string[];
    }>;
  }>;
}

function buildSchemaFromRows(rows: ColumnInfo[]): TableSchema[] {
  const tables = new Map<string, TableSchema>();

  for (const row of rows) {
    let table = tables.get(row.table_name);
    if (!table) {
      table = { name: row.table_name, columns: [] };
      tables.set(row.table_name, table);
    }

    table.columns.push({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === 'YES',
      primaryKey: row.column_key === 'PRI' || row.column_key === 'YES',
      default: row.column_default,
    });
  }

  return Array.from(tables.values());
}

function normalizeDefault(value: string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
}

function columnChanges(
  source: TableSchema['columns'][number],
  target: TableSchema['columns'][number],
): string[] {
  const changes: string[] = [];
  if (source.type.toLowerCase() !== target.type.toLowerCase()) changes.push('type');
  if (source.nullable !== target.nullable) changes.push('nullable');
  if (source.primaryKey !== target.primaryKey) changes.push('primaryKey');
  if (normalizeDefault(source.default) !== normalizeDefault(target.default)) {
    changes.push('default');
  }
  return changes;
}

function diffSchemas(source: TableSchema[], target: TableSchema[]): SchemaDiff {
  const sourceTables = new Map(source.map((table) => [table.name, table]));
  const targetTables = new Map(target.map((table) => [table.name, table]));
  const added_tables = target.filter((table) => !sourceTables.has(table.name));
  const removed_tables = source.filter((table) => !targetTables.has(table.name));
  const changed_tables: SchemaDiff['changed_tables'] = [];

  for (const sourceTable of source) {
    const targetTable = targetTables.get(sourceTable.name);
    if (!targetTable) continue;

    const sourceColumns = new Map(sourceTable.columns.map((column) => [column.name, column]));
    const targetColumns = new Map(targetTable.columns.map((column) => [column.name, column]));
    const added_columns = targetTable.columns.filter((column) => !sourceColumns.has(column.name));
    const removed_columns = sourceTable.columns.filter((column) => !targetColumns.has(column.name));
    const changed_columns: SchemaDiff['changed_tables'][number]['changed_columns'] = [];

    for (const sourceColumn of sourceTable.columns) {
      const targetColumn = targetColumns.get(sourceColumn.name);
      if (!targetColumn) continue;
      const changes = columnChanges(sourceColumn, targetColumn);
      if (changes.length > 0) {
        changed_columns.push({
          column: sourceColumn.name,
          source: sourceColumn,
          target: targetColumn,
          changes,
        });
      }
    }

    if (added_columns.length || removed_columns.length || changed_columns.length) {
      changed_tables.push({
        table: sourceTable.name,
        added_columns,
        removed_columns,
        changed_columns,
      });
    }
  }

  return { added_tables, removed_tables, changed_tables };
}

async function loadSqlSchema(
  registry: ConnectionRegistry,
  connectionId: string,
  schemaName?: string,
): Promise<{ engine: SqlEngine; tables: TableSchema[]; columnCount: number }> {
  const driver = registry.requireSql(connectionId);
  const L = limits();
  const { sql, params } = getSchemaSql(driver.engine, schemaName);

  const res = await driver.execute(sql, params, {
    mode: 'readonly',
    maxRows: 10000,
    queryTimeoutMs: L.queryTimeoutMs,
    maxSqlLength: L.maxSqlLength,
  });

  if (!res.success) {
    throw new Error(res.error ?? 'Schema 查询失败');
  }

  const rows = (res.data ?? []) as ColumnInfo[];
  return { engine: driver.engine, tables: buildSchemaFromRows(rows), columnCount: rows.length };
}

export function registerSchemaTools(server: McpServer, registry: ConnectionRegistry): void {
  server.registerTool(
    'schema_export',
    {
      description:
        '导出数据库 Schema 为 JSON 格式。返回所有表的列信息，包括列名、类型、是否可空、主键等。',
      inputSchema: {
        connection_id: z.string().optional(),
        schema: z.string().optional().describe('Schema 名称，主要用于 PostgreSQL，默认 public'),
        format: z.enum(['json', 'sql']).optional().describe('输出格式，默认 json'),
      },
    },
    async ({ connection_id, schema, format }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const loaded = await loadSqlSchema(registry, id, schema);

        if (format === 'sql') {
          // 生成 SQL DDL
          const ddl = loaded.tables
            .map((table) => {
              const cols = table.columns
                .map((col) => {
                  let def = `  ${col.name} ${col.type}`;
                  if (!col.nullable) def += ' NOT NULL';
                  if (col.default) def += ` DEFAULT ${col.default}`;
                  return def;
                })
                .join(',\n');
              const pk = table.columns.filter((c) => c.primaryKey);
              const pkClause =
                pk.length > 0 ? `,\n  PRIMARY KEY (${pk.map((c) => c.name).join(', ')})` : '';
              return `CREATE TABLE ${table.name} (\n${cols}${pkClause}\n);`;
            })
            .join('\n\n');

          return {
            content: [{ type: 'text', text: ddl }],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                engine: loaded.engine,
                schema,
                tables: loaded.tables,
                table_count: loaded.tables.length,
                column_count: loaded.columnCount,
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
    'schema_diff',
    {
      description:
        '比较两个 SQL 连接或 schema 的表结构差异。只读读取系统目录，返回新增/删除/变更的表和列。',
      inputSchema: {
        source_connection_id: z.string().describe('源连接 id'),
        target_connection_id: z.string().describe('目标连接 id'),
        source_schema: z.string().optional().describe('源 schema，主要用于 PostgreSQL'),
        target_schema: z.string().optional().describe('目标 schema，主要用于 PostgreSQL'),
      },
    },
    async ({ source_connection_id, target_connection_id, source_schema, target_schema }) => {
      try {
        const sourceId = registry.resolveConnectionId(source_connection_id);
        const targetId = registry.resolveConnectionId(target_connection_id);
        const source = await loadSqlSchema(registry, sourceId, source_schema);
        const target = await loadSqlSchema(registry, targetId, target_schema);
        const diff = diffSchemas(source.tables, target.tables);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                source: {
                  connection_id: sourceId,
                  engine: source.engine,
                  schema: source_schema,
                  table_count: source.tables.length,
                  column_count: source.columnCount,
                },
                target: {
                  connection_id: targetId,
                  engine: target.engine,
                  schema: target_schema,
                  table_count: target.tables.length,
                  column_count: target.columnCount,
                },
                summary: {
                  added_tables: diff.added_tables.length,
                  removed_tables: diff.removed_tables.length,
                  changed_tables: diff.changed_tables.length,
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

function limits() {
  return globalLimits();
}
