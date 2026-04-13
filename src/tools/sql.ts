import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry.js';
import { globalLimits } from '../core/config.js';
import { isReadOnlyQuery } from '../core/sql-guards.js';
import type { SqlEngine } from '../core/types.js';

const IDENT = /^[A-Za-z0-9_]+$/;

function validateIdent(name: string, field: string): void {
  if (!name || !IDENT.test(name)) {
    throw new Error(`${field} 不合法，仅支持字母数字下划线`);
  }
}

function listTablesSql(engine: SqlEngine, schema?: string): { sql: string; params?: unknown[] } {
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
      return { sql: `SELECT name FROM sys.tables ORDER BY name` };
    case 'oracle':
      return { sql: `SELECT table_name AS name FROM user_tables ORDER BY table_name` };
    default: {
      const e: never = engine;
      throw new Error(`不支持的 SQL 引擎: ${e}`);
    }
  }
}

function describeTableSql(
  engine: SqlEngine,
  table: string,
  schema?: string
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
              WHERE TABLE_NAME = @p0
              ORDER BY ORDINAL_POSITION`,
        params: [table],
      };
    case 'oracle':
      return {
        sql: `SELECT column_name, data_type, nullable
              FROM user_tab_columns
              WHERE table_name = :1
              ORDER BY column_id`,
        params: [table.toUpperCase()],
      };
    default: {
      const e: never = engine;
      throw new Error(`不支持的 SQL 引擎: ${e}`);
    }
  }
}

export function registerSqlTools(server: McpServer, registry: ConnectionRegistry): void {
  const limits = () => globalLimits();

  server.registerTool(
    'sql_query',
    {
      description:
        '在 SQL 连接（mysql/postgres/mssql/oracle）上执行只读查询。connection_id 缺省为默认连接。MySQL 用 ? 占位；PostgreSQL 用 $1..；mssql/oracle 可用 ? 由服务端映射为命名绑定。',
      inputSchema: {
        connection_id: z.string().optional(),
        sql: z.string(),
        params: z.array(z.any()).optional(),
        limit: z.number().int().min(1).max(10_000).optional(),
      },
    },
    async ({ connection_id, sql, params, limit }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const driver = registry.requireSql(id);
        const L = limits();
        const maxRows = limit ?? L.maxRows;
        if (!isReadOnlyQuery(sql)) {
          return {
            content: [{ type: 'text', text: '错误：sql_query 仅允许只读语句' }],
            isError: true,
          };
        }
        const res = await driver.execute(sql, params ?? [], {
          mode: 'readonly',
          maxRows,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });
        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '查询失败' }], isError: true };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                engine: driver.engine,
                data: res.data ?? [],
                totalRows: res.totalRows,
                truncated: res.truncated,
                fields: res.fields,
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.registerTool(
    'sql_execute',
    {
      description:
        '在 SQL 连接上执行写入类 SQL（INSERT/UPDATE/DELETE 等）。受危险语句规则约束；若连接 readonly=true 则拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        sql: z.string(),
        params: z.array(z.any()).optional(),
      },
    },
    async ({ connection_id, sql, params }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const h = registry.require(id);
        if (h.kind !== 'sql') {
          return { content: [{ type: 'text', text: '非 SQL 连接' }], isError: true };
        }
        if (h.spec.readonly) {
          return { content: [{ type: 'text', text: '该连接为只读' }], isError: true };
        }
        const L = limits();
        const res = await h.driver.execute(sql, params ?? [], {
          mode: 'readwrite',
          maxRows: L.maxRows,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });
        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '执行失败' }], isError: true };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                engine: h.driver.engine,
                affectedRows: res.affectedRows,
                insertId: res.insertId !== undefined ? String(res.insertId) : undefined,
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.registerTool(
    'sql_list_tables',
    {
      description: '列出当前连接下的表名（按引擎使用系统目录）。可选 schema（主要给 PostgreSQL）。',
      inputSchema: {
        connection_id: z.string().optional(),
        schema: z.string().optional(),
      },
    },
    async ({ connection_id, schema }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const driver = registry.requireSql(id);
        const { sql, params } = listTablesSql(driver.engine, schema);
        const L = limits();
        const res = await driver.execute(sql, params, {
          mode: 'readonly',
          maxRows: 5000,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });
        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '失败' }], isError: true };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                engine: driver.engine,
                tables: (res.data ?? []).map((row: any) => row.name ?? row.NAME ?? row.table_name),
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.registerTool(
    'sql_describe_table',
    {
      description: '查看表结构（列、类型）。PostgreSQL 可传 schema，默认 public。',
      inputSchema: {
        connection_id: z.string().optional(),
        table: z.string(),
        schema: z.string().optional(),
      },
    },
    async ({ connection_id, table, schema }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const driver = registry.requireSql(id);
        const { sql, params } = describeTableSql(driver.engine, table, schema);
        const L = limits();
        const res = await driver.execute(sql, params, {
          mode: 'readonly',
          maxRows: 2000,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });
        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '失败' }], isError: true };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                engine: driver.engine,
                columns: res.data ?? [],
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );
}
