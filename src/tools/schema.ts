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

export function registerSchemaTools(server: McpServer, registry: ConnectionRegistry): void {
  server.registerTool(
    'schema_export',
    {
      description:
        '导出数据库 Schema 为 JSON 格式。返回所有表的列信息，包括列名、类型、是否可空、主键等。',
      inputSchema: {
        connection_id: z.string().optional(),
        format: z.enum(['json', 'sql']).optional().describe('输出格式，默认 json'),
      },
    },
    async ({ connection_id, format }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const driver = registry.requireSql(id);
        const L = limits();
        const { sql, params } = getSchemaSql(driver.engine);

        const res = await driver.execute(sql, params, {
          mode: 'readonly',
          maxRows: 10000,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });

        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '查询失败' }], isError: true };
        }

        const rows = (res.data ?? []) as ColumnInfo[];
        const schema = buildSchemaFromRows(rows);

        if (format === 'sql') {
          // 生成 SQL DDL
          const ddl = schema
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
                engine: driver.engine,
                tables: schema,
                table_count: schema.length,
                column_count: rows.length,
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
