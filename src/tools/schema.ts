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
          c.TABLE_NAME as table_name,
          c.COLUMN_NAME as column_name,
          c.COLUMN_TYPE as data_type,
          c.IS_NULLABLE as is_nullable,
          c.COLUMN_KEY as column_key,
          CASE
            WHEN c.COLUMN_DEFAULT IS NULL THEN NULL
            WHEN c.EXTRA LIKE '%DEFAULT_GENERATED%' THEN c.COLUMN_DEFAULT
            WHEN c.DATA_TYPE IN (
              'char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext',
              'enum', 'set', 'binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob',
              'longblob', 'date', 'datetime', 'timestamp', 'time', 'year'
            ) THEN QUOTE(c.COLUMN_DEFAULT)
            ELSE c.COLUMN_DEFAULT
          END as column_default,
          c.EXTRA as extra
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
        WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
      };
    case 'postgres':
      return {
        sql: `SELECT
          c.table_name,
          c.column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
          c.is_nullable,
          CASE WHEN pk.column_name IS NOT NULL THEN 'YES' ELSE 'NO' END as column_key,
          c.column_default
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
        JOIN pg_catalog.pg_class r ON r.relnamespace = n.oid AND r.relname = c.table_name
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = r.oid AND a.attname = c.column_name AND a.attnum > 0 AND NOT a.attisdropped
        LEFT JOIN (
          SELECT ku.table_schema, ku.table_name, ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_schema = ku.constraint_schema
           AND tc.constraint_name = ku.constraint_name
           AND tc.table_schema = ku.table_schema
           AND tc.table_name = ku.table_name
          WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.table_schema = pk.table_schema
            AND c.table_name = pk.table_name
            AND c.column_name = pk.column_name
        WHERE c.table_schema = $1 AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name, c.ordinal_position`,
        params: [database ?? 'public'],
      };
    case 'mssql':
      return {
        sql: `SELECT
          c.TABLE_NAME as table_name,
          c.COLUMN_NAME as column_name,
          CASE
            WHEN c.DATA_TYPE IN ('varchar', 'char', 'varbinary', 'binary') THEN
              c.DATA_TYPE + '(' + CASE WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN 'MAX'
                ELSE CAST(c.CHARACTER_MAXIMUM_LENGTH AS varchar(20)) END + ')'
            WHEN c.DATA_TYPE IN ('nvarchar', 'nchar') THEN
              c.DATA_TYPE + '(' + CASE WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN 'MAX'
                ELSE CAST(c.CHARACTER_MAXIMUM_LENGTH AS varchar(20)) END + ')'
            WHEN c.DATA_TYPE IN ('decimal', 'numeric') THEN
              c.DATA_TYPE + '(' + CAST(c.NUMERIC_PRECISION AS varchar(20)) + ','
                + CAST(c.NUMERIC_SCALE AS varchar(20)) + ')'
            WHEN c.DATA_TYPE = 'float' AND c.NUMERIC_PRECISION IS NOT NULL THEN
              c.DATA_TYPE + '(' + CAST(c.NUMERIC_PRECISION AS varchar(20)) + ')'
            WHEN c.DATA_TYPE IN ('datetime2', 'datetimeoffset', 'time')
              AND c.DATETIME_PRECISION IS NOT NULL THEN
              c.DATA_TYPE + '(' + CAST(c.DATETIME_PRECISION AS varchar(20)) + ')'
            ELSE c.DATA_TYPE
          END as data_type,
          c.IS_NULLABLE as is_nullable,
          CASE WHEN EXISTS (
            SELECT 1
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
              ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
             AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
             AND tc.TABLE_NAME = ku.TABLE_NAME
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
              AND ku.TABLE_SCHEMA = c.TABLE_SCHEMA
              AND ku.TABLE_NAME = c.TABLE_NAME
              AND ku.COLUMN_NAME = c.COLUMN_NAME
          ) THEN 'YES' ELSE 'NO' END as column_key,
          c.COLUMN_DEFAULT as column_default
        FROM INFORMATION_SCHEMA.COLUMNS c
        JOIN INFORMATION_SCHEMA.TABLES t
          ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
        WHERE t.TABLE_TYPE = 'BASE TABLE' AND c.TABLE_SCHEMA = ?
        ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
        params: [database ?? 'dbo'],
      };
    case 'oracle':
      return {
        sql: `SELECT
          c.table_name,
          c.column_name,
          CASE
            WHEN c.data_type IN ('VARCHAR2', 'CHAR') AND c.char_length IS NOT NULL THEN
              c.data_type || '(' || TO_CHAR(c.char_length) ||
                CASE c.char_used WHEN 'C' THEN ' CHAR' WHEN 'B' THEN ' BYTE' ELSE '' END || ')'
            WHEN c.data_type IN ('NVARCHAR2', 'NCHAR') AND c.char_length IS NOT NULL THEN
              c.data_type || '(' || TO_CHAR(c.char_length) || ')'
            WHEN c.data_type = 'RAW' AND c.data_length IS NOT NULL THEN
              c.data_type || '(' || TO_CHAR(c.data_length) || ')'
            WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN
              c.data_type || '(' || TO_CHAR(c.data_precision) ||
                CASE WHEN c.data_scale IS NOT NULL THEN ',' || TO_CHAR(c.data_scale) ELSE '' END || ')'
            WHEN c.data_type = 'FLOAT' AND c.data_precision IS NOT NULL THEN
              c.data_type || '(' || TO_CHAR(c.data_precision) || ')'
            ELSE c.data_type
          END as data_type,
          c.nullable as is_nullable,
          CASE WHEN EXISTS (
            SELECT 1
            FROM user_constraints uc
            JOIN user_cons_columns ucc
              ON uc.constraint_name = ucc.constraint_name
            WHERE uc.constraint_type = 'P'
              AND ucc.table_name = c.table_name
              AND ucc.column_name = c.column_name
          ) THEN 'YES' ELSE 'NO' END as column_key,
          c.data_default as column_default
        FROM user_tab_columns c
        JOIN user_tables t ON t.table_name = c.table_name
        ORDER BY c.table_name, c.column_id`,
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
    case 'duckdb':
      return {
        sql: `SELECT
          c.table_name,
          c.column_name,
          c.data_type,
          c.is_nullable,
          CASE WHEN constraint_type = 'PRIMARY KEY' THEN 'YES' ELSE 'NO' END AS column_key,
          c.column_default
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        LEFT JOIN (
          SELECT tc.table_schema AS pk_table_schema,
                 tc.table_name AS pk_table_name,
                 ku.column_name AS pk_column_name,
                 tc.constraint_type
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
           AND tc.table_schema = ku.table_schema
           AND tc.table_name = ku.table_name
          WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.table_schema = pk.pk_table_schema
            AND c.table_name = pk.pk_table_name
            AND c.column_name = pk.pk_column_name
        WHERE c.table_schema NOT IN ('information_schema', 'pg_catalog')
          AND t.table_type = 'BASE TABLE'
          AND c.table_schema = ?
        ORDER BY c.table_name, c.ordinal_position`,
        params: [database ?? 'main'],
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

type SchemaRow = Record<string, unknown>;

interface TableSchema {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    primaryKey: boolean;
    default?: string;
    extra?: string;
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

function schemaField(row: SchemaRow, name: string): unknown {
  return row[name] ?? row[name.toUpperCase()];
}

function requiredSchemaField(row: SchemaRow, name: string): string {
  const value = schemaField(row, name);
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`Schema 元数据缺少字段 ${name}`);
  }
  return String(value);
}

function normalizeColumnInfo(row: SchemaRow): ColumnInfo {
  const defaultValue = schemaField(row, 'column_default');
  const extraValue = schemaField(row, 'extra');
  return {
    table_name: requiredSchemaField(row, 'table_name'),
    column_name: requiredSchemaField(row, 'column_name'),
    data_type: requiredSchemaField(row, 'data_type'),
    is_nullable: requiredSchemaField(row, 'is_nullable'),
    column_key: schemaField(row, 'column_key')?.toString(),
    column_default:
      defaultValue === undefined || defaultValue === null ? undefined : String(defaultValue),
    extra: extraValue === undefined || extraValue === null ? undefined : String(extraValue),
  };
}

function buildSchemaFromRows(rows: SchemaRow[]): TableSchema[] {
  const tables = new Map<string, TableSchema>();

  for (const rawRow of rows) {
    const row = normalizeColumnInfo(rawRow);
    let table = tables.get(row.table_name);
    if (!table) {
      table = { name: row.table_name, columns: [] };
      tables.set(row.table_name, table);
    }

    const nullable = row.is_nullable.trim().toUpperCase();
    const primaryKey = row.column_key?.trim().toUpperCase();
    table.columns.push({
      name: row.column_name,
      type: row.data_type,
      nullable: ['YES', 'Y', 'TRUE', '1'].includes(nullable),
      primaryKey:
        primaryKey !== undefined &&
        ['PRI', 'YES', 'Y', 'TRUE', '1', 'PRIMARY KEY'].includes(primaryKey),
      default: row.column_default,
      extra: row.extra,
    });
  }

  return Array.from(tables.values());
}

function quoteIdentifier(engine: SqlEngine, identifier: string): string {
  switch (engine) {
    case 'mysql':
      return `\`${identifier.replaceAll('`', '``')}\``;
    case 'mssql':
      return `[${identifier.replaceAll(']', ']]')}]`;
    default:
      return `"${identifier.replaceAll('"', '""')}"`;
  }
}

function mysqlColumnExtra(extra: string | undefined): string {
  if (!extra) return '';
  const clauses: string[] = [];
  if (/\bauto_increment\b/i.test(extra)) clauses.push('AUTO_INCREMENT');
  const onUpdate = /\bon update\s+(CURRENT_TIMESTAMP(?:\(\d+\))?)/i.exec(extra);
  if (onUpdate?.[1]) clauses.push(`ON UPDATE ${onUpdate[1]}`);
  return clauses.length > 0 ? ` ${clauses.join(' ')}` : '';
}

function renderSchemaDdl(engine: SqlEngine, tables: TableSchema[]): string {
  return tables
    .map((table) => {
      const cols = table.columns
        .map((col) => {
          let def = `  ${quoteIdentifier(engine, col.name)} ${col.type}`;
          if (col.default !== undefined) def += ` DEFAULT ${col.default}`;
          if (!col.nullable) def += ' NOT NULL';
          if (engine === 'mysql') def += mysqlColumnExtra(col.extra);
          return def;
        })
        .join(',\n');
      const pk = table.columns.filter((column) => column.primaryKey);
      const pkClause =
        pk.length > 0
          ? `,\n  PRIMARY KEY (${pk.map((column) => quoteIdentifier(engine, column.name)).join(', ')})`
          : '';
      return `CREATE TABLE ${quoteIdentifier(engine, table.name)} (\n${cols}${pkClause}\n);`;
    })
    .join('\n\n');
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

  const rows = (res.data ?? []) as SchemaRow[];
  return { engine: driver.engine, tables: buildSchemaFromRows(rows), columnCount: rows.length };
}

export function registerSchemaTools(server: McpServer, registry: ConnectionRegistry): void {
  server.registerTool(
    'schema_export',
    {
      description:
        '导出 base table Schema 为 JSON 或当前引擎可执行的 SQL DDL。保留列类型、默认值、可空和主键；不包含外键、触发器或独立索引。',
      inputSchema: {
        connection_id: z.string().optional(),
        schema: z
          .string()
          .optional()
          .describe('Schema 名称；PostgreSQL 默认 public，SQL Server 默认 dbo，DuckDB 默认 main'),
        format: z.enum(['json', 'sql']).optional().describe('输出格式，默认 json'),
      },
    },
    async ({ connection_id, schema, format }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const loaded = await loadSqlSchema(registry, id, schema);

        if (format === 'sql') {
          return {
            content: [{ type: 'text', text: renderSchemaDdl(loaded.engine, loaded.tables) }],
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
        source_schema: z.string().optional().describe('源 schema（PostgreSQL/SQL Server/DuckDB）'),
        target_schema: z
          .string()
          .optional()
          .describe('目标 schema（PostgreSQL/SQL Server/DuckDB）'),
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
