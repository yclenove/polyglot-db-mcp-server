import type { SqlEngine } from './types.js';

export const IDENT = /^[A-Za-z0-9_]+$/;

export function validateIdent(name: string, field: string): void {
  if (!name || !IDENT.test(name)) {
    throw new Error(`${field} 不合法，仅支持字母数字下划线`);
  }
}

export function describeTableSql(
  engine: SqlEngine,
  table: string,
  schema?: string,
): { sql: string; params?: unknown[] } {
  validateIdent(table, 'table');
  switch (engine) {
    case 'mysql':
      return { sql: `SHOW COLUMNS FROM \`${table.replace(/`/g, '')}\`` };
    case 'postgres': {
      const sch = schema && IDENT.test(schema) ? schema : 'public';
      return {
        sql: `SELECT column_name, data_type, is_nullable
              FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = $2
              ORDER BY ordinal_position`,
        params: [sch, table],
      };
    }
    case 'mssql':
      return {
        sql: `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
              FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_NAME = ?
              ORDER BY ORDINAL_POSITION`,
        params: [table],
      };
    case 'oracle':
      return {
        sql: `SELECT column_name, data_type, nullable
              FROM user_tab_columns
              WHERE table_name = ?
              ORDER BY column_id`,
        params: [table.toUpperCase()],
      };
    case 'sqlite':
      return {
        sql: `PRAGMA table_info(\`${table.replace(/`/g, '')}\`)`,
      };
    case 'duckdb':
      return {
        sql: `SELECT column_name, data_type, is_nullable
              FROM information_schema.columns
              WHERE table_name = ?
              ORDER BY ordinal_position`,
        params: [table],
      };
    default: {
      const e: never = engine;
      throw new Error(`不支持的 SQL 引擎: ${e}`);
    }
  }
}

export function listIndexesSql(
  engine: SqlEngine,
  table: string,
  schema?: string,
): { sql: string; params?: unknown[] } {
  validateIdent(table, 'table');
  switch (engine) {
    case 'mysql':
      return { sql: `SHOW INDEX FROM \`${table.replace(/`/g, '')}\`` };
    case 'postgres': {
      const sch = schema && IDENT.test(schema) ? schema : 'public';
      return {
        sql: `SELECT index_class.relname AS name,
                     COALESCE(
                       attribute.attname,
                       pg_get_indexdef(
                         index_class.oid,
                         index_key.ordinal_position::integer,
                         true
                       )
                     ) AS column_name,
                     index_info.indisunique AS is_unique,
                     index_info.indisprimary AS is_primary,
                     pg_get_indexdef(index_class.oid) AS definition
              FROM pg_class AS table_class
              JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
              JOIN pg_index AS index_info ON index_info.indrelid = table_class.oid
              JOIN pg_class AS index_class ON index_class.oid = index_info.indexrelid
              CROSS JOIN LATERAL unnest(index_info.indkey::smallint[])
                WITH ORDINALITY AS index_key(attnum, ordinal_position)
              LEFT JOIN pg_attribute AS attribute
                ON attribute.attrelid = table_class.oid AND attribute.attnum = index_key.attnum
              WHERE namespace.nspname = $1 AND table_class.relname = $2
              ORDER BY index_class.relname, index_key.ordinal_position`,
        params: [sch, table],
      };
    }
    case 'mssql':
      return {
        sql: `SELECT i.name AS name, COL_NAME(ic.object_id, ic.column_id) AS column_name
              FROM sys.indexes i
              JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
              WHERE i.object_id = OBJECT_ID(?)
              ORDER BY i.name, ic.key_ordinal`,
        params: [table],
      };
    case 'oracle':
      return {
        sql: `SELECT index_name AS name, column_name
              FROM user_ind_columns
              WHERE table_name = ?
              ORDER BY index_name, column_position`,
        params: [table.toUpperCase()],
      };
    case 'sqlite':
      return {
        sql: `SELECT index_list.seq AS sequence,
                     index_list.name AS name,
                     index_list."unique" AS is_unique,
                     index_list.origin,
                     index_list.partial,
                     index_info.seqno AS column_position,
                     index_info.cid AS column_id,
                     index_info.name AS column_name
              FROM pragma_index_list(?) AS index_list
              JOIN pragma_index_info(index_list.name) AS index_info
              ORDER BY index_list.name, index_info.seqno`,
        params: [table],
      };
    case 'duckdb':
      return {
        sql: `SELECT index_name AS name, expressions AS definition
              FROM duckdb_indexes()
              WHERE table_name = ?
              ORDER BY index_name`,
        params: [table],
      };
    default: {
      const e: never = engine;
      throw new Error(`不支持的 SQL 引擎: ${e}`);
    }
  }
}

export function listTablesSql(
  engine: SqlEngine,
  schema?: string,
): { sql: string; params?: unknown[] } {
  switch (engine) {
    case 'mysql':
      return {
        sql: `SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY TABLE_NAME`,
      };
    case 'postgres': {
      const sch = schema && IDENT.test(schema) ? schema : 'public';
      return {
        sql: `SELECT tablename AS name FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
        params: [sch],
      };
    }
    case 'mssql':
      return {
        sql: `SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      };
    case 'oracle':
      return {
        sql: `SELECT table_name AS name FROM user_tables ORDER BY table_name`,
      };
    case 'sqlite':
      return {
        sql: `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      };
    case 'duckdb':
      return {
        sql: `SELECT table_name AS name
              FROM information_schema.tables
              WHERE table_type = 'BASE TABLE'
              ORDER BY table_name`,
      };
    default: {
      const e: never = engine;
      throw new Error(`不支持的 SQL 引擎: ${e}`);
    }
  }
}

export function explainQuerySql(engine: SqlEngine, sql: string): string {
  switch (engine) {
    case 'mysql':
      return `EXPLAIN ${sql}`;
    case 'postgres':
      return `EXPLAIN (FORMAT JSON, VERBOSE) ${sql}`;
    case 'mssql':
      throw new Error('MSSQL EXPLAIN 暂不支持安全批处理；请使用数据库客户端查看执行计划');
    case 'oracle':
      return `EXPLAIN PLAN FOR ${sql}`;
    case 'sqlite':
      return `EXPLAIN QUERY PLAN ${sql}`;
    case 'duckdb':
      return `EXPLAIN ${sql}`;
    default: {
      const e: never = engine;
      throw new Error(`不支持的 SQL 引擎: ${e}`);
    }
  }
}
