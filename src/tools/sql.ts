import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry.js';
import { globalLimits, responseDataByteLimit } from '../core/config.js';
import {
  analyzeSqlPagination,
  isReadOnlyQuery,
  stripSqlStatementTerminators,
} from '../core/sql-guards.js';
import type { SqlEngine } from '../core/types.js';
import { createQueryCacheFromEnv, cacheKey as makeCacheKey } from '../core/query-cache.js';
import { createRateLimiterFromEnv } from '../core/rate-limiter.js';
import {
  IDENT,
  validateIdent,
  describeTableSql,
  explainQuerySql,
  listIndexesSql,
  listTablesSql,
} from '../core/sql-helpers.js';
import { createErrorPayload, type ErrorCode } from '../core/error-codes.js';
import { maskResultRows, withMaskedDataRows } from './result-masking.js';

type SqlResultRow = Record<string, unknown>;
type ExportFormat = 'json' | 'csv' | 'markdown';

const MAX_EXPORT_ROWS = 10_000;
const MAX_SAMPLE_ROWS = 10_000;

function effectiveResponseByteLimit(requested: number | undefined): number {
  return Math.min(requested ?? Number.MAX_SAFE_INTEGER, responseDataByteLimit());
}

const activeTransactions = new Map<
  string,
  {
    connectionId: string;
    transaction: import('../core/types.js').SqlTransaction;
    createdAt: number;
  }
>();
let txCounter = 0;
let transactionCleanupStarted = false;

function ensureTransactionCleanup(): void {
  if (transactionCleanupStarted) return;
  transactionCleanupStarted = true;
  setInterval(() => {
    const txTimeoutMs = parseInt(process.env.DB_TRANSACTION_TIMEOUT_MS || '300000', 10);
    const now = Date.now();
    for (const [txId, entry] of activeTransactions) {
      if (now - entry.createdAt > txTimeoutMs) {
        entry.transaction.rollback().catch(() => {});
        activeTransactions.delete(txId);
      }
    }
  }, 60_000).unref();
}

function codedErrorText(
  code: ErrorCode,
  details?: Record<string, unknown>,
  hintOverride?: string,
): string {
  const errorInfo = createErrorPayload(code, details, hintOverride);
  return JSON.stringify({ error: errorInfo.message, error_info: errorInfo });
}

function isResultRow(value: unknown): value is SqlResultRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRows(data: unknown[] | undefined): SqlResultRow[] {
  return (data ?? []).filter(isResultRow);
}

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, jsonSafeReplacer);
}

function collectFieldNames(rows: SqlResultRow[], fields?: { name: string }[]): string[] {
  const names = new Set<string>();
  for (const field of fields ?? []) {
    if (field.name) names.add(field.name);
  }
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      names.add(key);
    }
  }
  return [...names];
}

function formatCsv(rows: SqlResultRow[], fields: string[]): string {
  if (fields.length === 0) return '';
  const escapeCsv = (value: unknown): string => {
    const text = stringifyCell(value);
    if (!/[",\r\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [fields.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(fields.map((field) => escapeCsv(row[field])).join(','));
  }
  return lines.join('\n');
}

function formatMarkdown(rows: SqlResultRow[], fields: string[]): string {
  if (fields.length === 0) return '';
  const escapeMarkdown = (value: unknown): string =>
    stringifyCell(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const header = `| ${fields.map(escapeMarkdown).join(' | ')} |`;
  const separator = `| ${fields.map(() => '---').join(' | ')} |`;
  const body = rows.map(
    (row) => `| ${fields.map((field) => escapeMarkdown(row[field])).join(' | ')} |`,
  );
  return [header, separator, ...body].join('\n');
}

function formatExportContent(
  rows: SqlResultRow[],
  fields: string[],
  format: ExportFormat,
): { content: string; contentType: string } {
  switch (format) {
    case 'csv':
      return { content: formatCsv(rows, fields), contentType: 'text/csv' };
    case 'markdown':
      return { content: formatMarkdown(rows, fields), contentType: 'text/markdown' };
    case 'json':
      return {
        content: JSON.stringify(rows, jsonSafeReplacer, 2),
        contentType: 'application/json',
      };
    default: {
      const e: never = format;
      throw new Error(`不支持的导出格式: ${e}`);
    }
  }
}

function quoteIdentifier(engine: SqlEngine, ident: string): string {
  validateIdent(ident, 'identifier');
  switch (engine) {
    case 'mysql':
      return `\`${ident}\``;
    case 'postgres':
      return `"${ident}"`;
    case 'mssql':
      return `[${ident}]`;
    case 'oracle':
    case 'sqlite':
    case 'duckdb':
      return ident;
    default: {
      const e: never = engine;
      throw new Error(`不支持的 SQL 引擎: ${e}`);
    }
  }
}

function qualifiedTableName(engine: SqlEngine, table: string, schema?: string): string {
  const quotedTable = quoteIdentifier(engine, table);
  if (!schema) return quotedTable;
  return `${quoteIdentifier(engine, schema)}.${quotedTable}`;
}

function sampleTableSql(
  engine: SqlEngine,
  table: string,
  sampleSize: number,
  schema?: string,
): string {
  const tableSql = qualifiedTableName(engine, table, schema);
  switch (engine) {
    case 'mssql':
      return `SELECT TOP (${sampleSize}) * FROM ${tableSql}`;
    case 'oracle':
      return `SELECT * FROM ${tableSql} FETCH FIRST ${sampleSize} ROWS ONLY`;
    case 'mysql':
    case 'postgres':
    case 'sqlite':
    case 'duckdb':
      return `SELECT * FROM ${tableSql} LIMIT ${sampleSize}`;
    default: {
      const e: never = engine;
      throw new Error(`不支持的 SQL 引擎: ${e}`);
    }
  }
}

function valueKind(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'bigint') return 'number';
  return typeof value;
}

function profileRows(rows: SqlResultRow[], fields: string[]): Record<string, unknown>[] {
  return fields.map((field) => {
    let nullCount = 0;
    let emptyStringCount = 0;
    let numericCount = 0;
    let numericSum = 0;
    let numericMin: number | undefined;
    let numericMax: number | undefined;
    let stringMinLength: number | undefined;
    let stringMaxLength: number | undefined;
    const typeCounts = new Map<string, number>();
    const uniqueValues = new Set<string>();
    const examples: string[] = [];

    for (const row of rows) {
      const value = row[field];
      const kind = valueKind(value);
      typeCounts.set(kind, (typeCounts.get(kind) ?? 0) + 1);
      if (value === null || value === undefined) {
        nullCount += 1;
        continue;
      }

      const text = stringifyCell(value);
      uniqueValues.add(text);
      if (examples.length < 3 && !examples.includes(text)) {
        examples.push(text);
      }

      if (typeof value === 'string') {
        if (value.length === 0) emptyStringCount += 1;
        stringMinLength =
          stringMinLength === undefined ? value.length : Math.min(stringMinLength, value.length);
        stringMaxLength =
          stringMaxLength === undefined ? value.length : Math.max(stringMaxLength, value.length);
      }

      if (typeof value === 'number' && Number.isFinite(value)) {
        numericCount += 1;
        numericSum += value;
        numericMin = numericMin === undefined ? value : Math.min(numericMin, value);
        numericMax = numericMax === undefined ? value : Math.max(numericMax, value);
      }
    }

    const nonNullTypes = [...typeCounts.keys()].filter((type) => type !== 'null');
    const inferredType =
      nonNullTypes.length === 0
        ? 'null'
        : nonNullTypes.every((type) => type === nonNullTypes[0])
          ? nonNullTypes[0]
          : 'mixed';

    return {
      name: field,
      inferred_type: inferredType,
      null_count: nullCount,
      null_ratio: rows.length === 0 ? 0 : nullCount / rows.length,
      empty_string_count: emptyStringCount,
      unique_count: uniqueValues.size,
      sample_values: examples,
      type_counts: Object.fromEntries(typeCounts.entries()),
      numeric:
        numericCount > 0
          ? {
              count: numericCount,
              min: numericMin,
              max: numericMax,
              avg: numericSum / numericCount,
            }
          : undefined,
      string:
        stringMinLength !== undefined
          ? {
              min_length: stringMinLength,
              max_length: stringMaxLength,
            }
          : undefined,
    };
  });
}

export function registerSqlTools(server: McpServer, registry: ConnectionRegistry): void {
  ensureTransactionCleanup();
  const limits = () => globalLimits();
  const queryCache = createQueryCacheFromEnv();
  const rateLimiter = createRateLimiterFromEnv();

  server.registerTool(
    'sql_query',
    {
      description:
        '在 SQL 连接（mysql/postgres/mssql/oracle/sqlite/duckdb）上执行有界只读查询。connection_id 缺省为默认连接。MySQL 用 ? 占位；PostgreSQL 用 $1..；mssql/oracle 可用 ? 由服务端映射为命名绑定。支持分页：page（从 1 开始）和 page_size（默认 20）；totalRowsExact=false 表示 totalRows 只是已观察下界。',
      inputSchema: {
        connection_id: z.string().optional(),
        sql: z.string(),
        params: z.array(z.any()).optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .optional()
          .describe('最大返回行数，优先级高于分页'),
        page: z.number().int().min(1).optional().describe('页码，从 1 开始'),
        page_size: z.number().int().min(1).max(1000).optional().describe('每页行数，默认 20'),
        response_bytes_limit: z
          .number()
          .int()
          .min(1024)
          .max(16 * 1024 * 1024)
          .optional(),
      },
    },
    async ({ connection_id, sql, params, limit, page, page_size, response_bytes_limit }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);

        // 速率限制
        if (!rateLimiter.allow(id)) {
          return {
            content: [{ type: 'text', text: `连接「${id}」请求过于频繁，请稍后重试` }],
            isError: true,
          };
        }

        const driver = registry.requireSql(id);
        const L = limits();
        const maxBytes = effectiveResponseByteLimit(response_bytes_limit);

        if (!isReadOnlyQuery(sql, driver.engine)) {
          return {
            content: [
              {
                type: 'text',
                text: codedErrorText('SQL_002', { tool: 'sql_query' }),
              },
            ],
            isError: true,
          };
        }

        // 查询缓存（仅对无分页的简单查询生效）
        const ck = makeCacheKey(id, sql, params ?? [], { maxBytes });
        const cached = !page && !limit ? queryCache.get(ck) : undefined;
        if (cached !== undefined) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(withMaskedDataRows(cached as { data?: unknown[] })),
              },
            ],
          };
        }

        // 分页逻辑：自动追加 LIMIT/OFFSET
        const autoPagination = process.env.DB_AUTO_PAGINATION !== 'false';
        const paginationPage = limit ? undefined : page;
        let finalSql = sql;
        let maxRows: number;

        if (limit) {
          // limit 参数优先
          maxRows = limit;
        } else if (paginationPage) {
          const requestedPageSize = page_size ?? 20;
          // 多取一行用于判断 has_next，驱动只向调用方返回 requestedPageSize 行。
          const fetchSize = requestedPageSize + 1;
          maxRows = requestedPageSize;
          const pagination = analyzeSqlPagination(sql, driver.engine);
          if (autoPagination && !pagination.hasTopLevelRowLimit) {
            const offset = (paginationPage - 1) * requestedPageSize;
            const engine = driver.engine;
            const baseSql = stripSqlStatementTerminators(sql, engine).trim();
            if (engine === 'mssql') {
              // MSSQL: OFFSET...FETCH 要求 ORDER BY
              if (!pagination.hasTopLevelOrderBy) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: 'MSSQL 自动分页要求查询包含 ORDER BY，以保证分页顺序稳定',
                    },
                  ],
                  isError: true,
                };
              }
              finalSql = `${baseSql}\nOFFSET ${offset} ROWS FETCH NEXT ${fetchSize} ROWS ONLY`;
            } else if (engine === 'oracle') {
              finalSql = `${baseSql}\nOFFSET ${offset} ROWS FETCH NEXT ${fetchSize} ROWS ONLY`;
            } else {
              // MySQL, PostgreSQL, SQLite, DuckDB 使用 LIMIT/OFFSET
              finalSql = `${baseSql}\nLIMIT ${fetchSize} OFFSET ${offset}`;
            }
          }
        } else {
          maxRows = L.maxRows;
        }

        if (!isReadOnlyQuery(finalSql, driver.engine)) {
          return {
            content: [
              {
                type: 'text',
                text: codedErrorText('SQL_002', { tool: 'sql_query' }),
              },
            ],
            isError: true,
          };
        }
        const res = await driver.execute(finalSql, params ?? [], {
          mode: 'readonly',
          maxRows,
          maxBytes,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });
        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '查询失败' }], isError: true };
        }

        // 计算分页信息
        const rawData = res.data ?? [];
        const data = rawData.slice(0, maxRows);
        const observedRows = Math.max(res.totalRows ?? rawData.length, rawData.length);
        const truncated = Boolean(res.truncated) || observedRows > maxRows;
        const currentPage = paginationPage ?? 1;
        const currentPageSize = paginationPage ? (page_size ?? 20) : data.length;
        const pageOffset = paginationPage ? (currentPage - 1) * currentPageSize : 0;
        const canInferTotalRows = !paginationPage || currentPage === 1 || observedRows > 0;
        const totalRows = canInferTotalRows ? pageOffset + observedRows : undefined;
        const totalRowsExact = (res.totalRowsExact ?? !truncated) && canInferTotalRows;
        const totalPages =
          paginationPage && totalRowsExact && totalRows !== undefined
            ? Math.ceil(totalRows / currentPageSize)
            : undefined;

        const result = {
          connection_id: id,
          engine: driver.engine,
          data,
          totalRows,
          totalRowsExact,
          truncated,
          truncatedBy: res.truncatedBy,
          returnedBytes: res.returnedBytes,
          responseByteLimit: maxBytes,
          fields: res.fields,
          pagination: paginationPage
            ? {
                page: currentPage,
                page_size: currentPageSize,
                total_pages: totalPages,
                has_next: truncated,
                has_prev: currentPage > 1,
              }
            : undefined,
        };

        // 写入缓存（仅无分页的简单查询）
        if (!page && !limit) {
          queryCache.set(ck, result);
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(withMaskedDataRows(result)) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );

  server.registerTool(
    'sql_export_query',
    {
      description:
        '执行只读 SQL 并将结果导出为 JSON、CSV 或 Markdown。导出前应用全局和请求级脱敏，最大 10000 行。',
      inputSchema: {
        connection_id: z.string().optional(),
        sql: z.string(),
        params: z.array(z.any()).optional(),
        format: z.enum(['json', 'csv', 'markdown']).optional().describe('导出格式，默认 json'),
        limit: z.number().int().min(1).max(MAX_EXPORT_ROWS).optional().describe('最大导出行数'),
        response_bytes_limit: z
          .number()
          .int()
          .min(1024)
          .max(16 * 1024 * 1024)
          .optional(),
      },
    },
    async ({ connection_id, sql, params, format, limit, response_bytes_limit }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const driver = registry.requireSql(id);
        if (!rateLimiter.allow(id)) {
          return {
            content: [{ type: 'text', text: `连接「${id}」请求过于频繁，请稍后重试` }],
            isError: true,
          };
        }

        if (!isReadOnlyQuery(sql, driver.engine)) {
          return {
            content: [
              {
                type: 'text',
                text: codedErrorText('SQL_002', { tool: 'sql_export_query' }),
              },
            ],
            isError: true,
          };
        }

        const L = limits();
        const maxRows = Math.min(limit ?? L.maxRows, MAX_EXPORT_ROWS);
        const maxBytes = effectiveResponseByteLimit(response_bytes_limit);
        const res = await driver.execute(sql, params ?? [], {
          mode: 'readonly',
          maxRows,
          maxBytes,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });
        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '导出查询失败' }], isError: true };
        }

        const rows = maskResultRows(normalizeRows(res.data));
        const fields = collectFieldNames(rows, res.fields);
        const exportFormat = (format ?? 'json') as ExportFormat;
        const { content, contentType } = formatExportContent(rows, fields, exportFormat);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                engine: driver.engine,
                format: exportFormat,
                content_type: contentType,
                row_count: rows.length,
                totalRows: res.totalRows ?? rows.length,
                totalRowsExact: res.totalRowsExact ?? !res.truncated,
                truncated: res.truncated ?? false,
                truncatedBy: res.truncatedBy,
                returnedBytes: res.returnedBytes,
                responseByteLimit: maxBytes,
                fields,
                content,
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
    'sql_sample_table',
    {
      description:
        '对 SQL 表执行只读采样，返回字段类型、空值率、唯一值数量、示例值和数值范围等轻量画像。',
      inputSchema: {
        connection_id: z.string().optional(),
        table: z.string().describe('表名'),
        schema: z.string().optional().describe('schema 名称'),
        sample_size: z
          .number()
          .int()
          .min(1)
          .max(MAX_SAMPLE_ROWS)
          .optional()
          .describe('采样行数，默认使用 DB_MAX_ROWS，最大 10000'),
      },
    },
    async ({ connection_id, table, schema, sample_size }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        if (!rateLimiter.allow(id)) {
          return {
            content: [{ type: 'text', text: `连接「${id}」请求过于频繁，请稍后重试` }],
            isError: true,
          };
        }

        validateIdent(table, 'table');
        if (schema) validateIdent(schema, 'schema');

        const driver = registry.requireSql(id);
        const L = limits();
        const sampleSize = Math.min(sample_size ?? L.maxRows, MAX_SAMPLE_ROWS);
        const sql = sampleTableSql(driver.engine, table, sampleSize, schema);
        const res = await driver.execute(sql, [], {
          mode: 'readonly',
          maxRows: sampleSize,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });
        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '采样失败' }], isError: true };
        }

        const rows = maskResultRows(normalizeRows(res.data));
        const fields = collectFieldNames(rows, res.fields);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                engine: driver.engine,
                table,
                schema,
                sample_size_requested: sampleSize,
                row_count: rows.length,
                totalRows: res.totalRows ?? rows.length,
                totalRowsExact: res.totalRowsExact ?? !res.truncated,
                truncated: res.truncated ?? false,
                columns: profileRows(rows, fields),
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

        // 速率限制
        if (!rateLimiter.allow(id)) {
          return {
            content: [{ type: 'text', text: `连接「${id}」请求过于频繁，请稍后重试` }],
            isError: true,
          };
        }

        const h = registry.require(id);
        if (h.kind !== 'sql') {
          const hint = `当前连接类型: ${h.kind}，请使用对应的 ${h.kind} 工具`;
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: '非 SQL 连接', hint }) }],
            isError: true,
          };
        }
        if (h.spec.readonly) {
          const hint = '如需写入，请使用独立写连接并将该连接配置为 readonly:false';
          return {
            content: [
              {
                type: 'text',
                text: codedErrorText('SQL_002', { connection_id: id }, hint),
              },
            ],
            isError: true,
          };
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
    },
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
                tables: ((res.data ?? []) as SqlResultRow[]).map(
                  (row) => row.name ?? row.NAME ?? row.table_name,
                ),
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
    },
  );

  server.registerTool(
    'sql_begin_transaction',
    {
      description:
        '在 SQL 连接上开始一个新事务。返回事务 ID，后续使用 sql_execute_in_transaction 执行 SQL，最后用 sql_commit 或 sql_rollback 结束事务。',
      inputSchema: {
        connection_id: z.string().optional(),
      },
    },
    async ({ connection_id }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const driver = registry.requireSql(id);
        const tx = await driver.beginTransaction();
        const txId = `tx_${++txCounter}_${Date.now()}`;
        activeTransactions.set(txId, { connectionId: id, transaction: tx, createdAt: Date.now() });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                transaction_id: txId,
                connection_id: id,
                engine: driver.engine,
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
    'sql_execute_in_transaction',
    {
      description: '在事务中执行 SQL。需要先调用 sql_begin_transaction 获取 transaction_id。',
      inputSchema: {
        transaction_id: z.string(),
        sql: z.string(),
        params: z.array(z.any()).optional(),
      },
    },
    async ({ transaction_id, sql, params }) => {
      try {
        const entry = activeTransactions.get(transaction_id);
        if (!entry) {
          return {
            content: [
              {
                type: 'text',
                text: codedErrorText('SQL_006', { transaction_id }),
              },
            ],
            isError: true,
          };
        }
        const L = limits();
        const res = await entry.transaction.execute(sql, params ?? [], {
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
                transaction_id,
                connection_id: entry.connectionId,
                affectedRows: res.affectedRows,
                insertId: res.insertId !== undefined ? String(res.insertId) : undefined,
                data: res.data,
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
    'sql_commit',
    {
      description: '提交事务，使所有更改永久生效。',
      inputSchema: {
        transaction_id: z.string(),
      },
    },
    async ({ transaction_id }) => {
      try {
        const entry = activeTransactions.get(transaction_id);
        if (!entry) {
          return {
            content: [
              {
                type: 'text',
                text: codedErrorText('SQL_006', { transaction_id }),
              },
            ],
            isError: true,
          };
        }
        await entry.transaction.commit();
        activeTransactions.delete(transaction_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                transaction_id,
                status: 'committed',
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
    'sql_rollback',
    {
      description: '回滚事务，撤销所有未提交的更改。',
      inputSchema: {
        transaction_id: z.string(),
      },
    },
    async ({ transaction_id }) => {
      try {
        const entry = activeTransactions.get(transaction_id);
        if (!entry) {
          return {
            content: [
              {
                type: 'text',
                text: codedErrorText('SQL_006', { transaction_id }),
              },
            ],
            isError: true,
          };
        }
        await entry.transaction.rollback();
        activeTransactions.delete(transaction_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                transaction_id,
                status: 'rolled_back',
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
    'sql_batch_execute',
    {
      description:
        '在单个事务中批量执行多条 SQL。要么全部成功，要么全部回滚。connection_id 缺省为默认连接。',
      inputSchema: {
        connection_id: z.string().optional(),
        statements: z.array(
          z.object({
            sql: z.string(),
            params: z.array(z.any()).optional(),
          }),
        ),
      },
    },
    async ({ connection_id, statements }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const h = registry.require(id);
        if (h.kind !== 'sql') {
          return { content: [{ type: 'text', text: '非 SQL 连接' }], isError: true };
        }
        if (h.spec.readonly) {
          return {
            content: [
              {
                type: 'text',
                text: codedErrorText('SQL_002', { connection_id: id }),
              },
            ],
            isError: true,
          };
        }
        const L = limits();
        const tx = await h.driver.beginTransaction();
        const results: Array<{
          sql: string;
          success: boolean;
          affectedRows?: number;
          error?: string;
        }> = [];
        try {
          for (const stmt of statements) {
            const res = await tx.execute(stmt.sql, stmt.params ?? [], {
              mode: 'readwrite',
              maxRows: L.maxRows,
              queryTimeoutMs: L.queryTimeoutMs,
              maxSqlLength: L.maxSqlLength,
            });
            if (!res.success) {
              await tx.rollback();
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: res.error,
                      failed_at_sql: stmt.sql,
                      completed: results,
                    }),
                  },
                ],
                isError: true,
              };
            }
            results.push({
              sql: stmt.sql,
              success: true,
              affectedRows: res.affectedRows,
            });
          }
          await tx.commit();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  connection_id: id,
                  engine: h.driver.engine,
                  results,
                }),
              },
            ],
          };
        } catch (e) {
          await tx.rollback();
          const msg = e instanceof Error ? e.message : String(e);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: msg,
                  completed: results,
                }),
              },
            ],
            isError: true,
          };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );

  // ── sql_explain ─────────────────────────────────────────

  server.registerTool(
    'sql_explain',
    {
      description:
        '返回 SQL 查询的执行计划。支持 MySQL/PostgreSQL/MSSQL/Oracle。用于分析查询性能和索引使用情况。',
      inputSchema: {
        connection_id: z.string().optional(),
        sql: z.string().describe('要分析的 SQL 查询（SELECT 语句）'),
      },
    },
    async ({ connection_id, sql }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const driver = registry.requireSql(id);
        const L = limits();

        if (!isReadOnlyQuery(sql, driver.engine)) {
          return {
            content: [
              {
                type: 'text',
                text: codedErrorText('SQL_002', { tool: 'sql_explain' }),
              },
            ],
            isError: true,
          };
        }

        const explainSqlStr = explainQuerySql(driver.engine, sql);
        const res = await driver.execute(explainSqlStr, [], {
          mode: 'readonly',
          maxRows: 100,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });

        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? 'EXPLAIN 失败' }], isError: true };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                engine: driver.engine,
                sql,
                execution_plan: res.data ?? [],
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

  // ── 存储过程 ──────────────────────────────────────────

  server.registerTool(
    'sql_call_procedure',
    {
      description: '调用存储过程。connection_id 缺省为默认连接。',
      inputSchema: {
        connection_id: z.string().optional(),
        procedure: z.string().describe('存储过程名称'),
        params: z.array(z.any()).optional().describe('参数数组'),
      },
    },
    async ({ connection_id, procedure, params }) => {
      try {
        validateIdent(procedure, 'procedure');
        const id = registry.resolveConnectionId(connection_id);
        const driver = registry.requireSql(id);
        const L = limits();

        // 根据引擎生成调用语法
        let sql: string;
        switch (driver.engine) {
          case 'mysql':
            sql = `CALL \`${procedure.replace(/`/g, '')}\`(${params?.map(() => '?').join(', ') || ''})`;
            break;
          case 'postgres':
            sql = `CALL ${procedure}(${params?.map((_, i) => `$${i + 1}`).join(', ') || ''})`;
            break;
          case 'mssql':
            sql = `EXEC ${procedure} ${params?.map(() => '?').join(', ') || ''}`;
            break;
          case 'oracle':
            sql = `BEGIN ${procedure}(${params?.map(() => '?').join(', ') || ''}); END;`;
            break;
          case 'sqlite':
            sql = `SELECT ${procedure}(${params?.map(() => '?').join(', ') || ''})`;
            break;
          case 'duckdb':
            sql = `SELECT ${procedure}(${params?.map(() => '?').join(', ') || ''})`;
            break;
          default: {
            const e: never = driver.engine;
            throw new Error(`不支持的引擎: ${e}`);
          }
        }

        const res = await driver.execute(sql, params ?? [], {
          mode: 'readwrite',
          maxRows: L.maxRows,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });

        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '调用失败' }], isError: true };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                engine: driver.engine,
                procedure,
                data: res.data,
                affectedRows: res.affectedRows,
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

  // ── 视图 ──────────────────────────────────────────

  function listViewsSql(engine: SqlEngine, schema?: string): { sql: string; params?: unknown[] } {
    switch (engine) {
      case 'mysql':
        return {
          sql: `SELECT TABLE_NAME AS name FROM information_schema.views WHERE table_schema = DATABASE() ORDER BY TABLE_NAME`,
        };
      case 'postgres': {
        const sch = schema && IDENT.test(schema) ? schema : 'public';
        return {
          sql: `SELECT viewname AS name FROM pg_views WHERE schemaname = $1 ORDER BY viewname`,
          params: [sch],
        };
      }
      case 'mssql':
        return { sql: `SELECT name FROM sys.views ORDER BY name` };
      case 'oracle':
        return { sql: `SELECT view_name AS name FROM user_views ORDER BY view_name` };
      case 'sqlite':
        return { sql: `SELECT name FROM sqlite_master WHERE type='view' ORDER BY name` };
      case 'duckdb':
        return {
          sql: `SELECT table_name AS name
                FROM information_schema.views
                ORDER BY table_name`,
        };
      default: {
        const e: never = engine;
        throw new Error(`不支持的 SQL 引擎: ${e}`);
      }
    }
  }

  function describeViewSql(
    engine: SqlEngine,
    view: string,
    schema?: string,
  ): { sql: string; params?: unknown[] } {
    validateIdent(view, 'view');
    switch (engine) {
      case 'mysql':
        return { sql: `SHOW CREATE VIEW \`${view.replace(/`/g, '')}\`` };
      case 'postgres': {
        const sch = schema && IDENT.test(schema) ? schema : 'public';
        return {
          sql: `SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position`,
          params: [sch, view],
        };
      }
      case 'mssql':
        return {
          sql: `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = ?
                ORDER BY ORDINAL_POSITION`,
          params: [view],
        };
      case 'oracle':
        return {
          sql: `SELECT column_name, data_type, nullable
                FROM user_tab_columns
                WHERE table_name = ?
                ORDER BY column_id`,
          params: [view.toUpperCase()],
        };
      case 'sqlite':
        return {
          sql: `PRAGMA table_info(\`${view.replace(/`/g, '')}\`)`,
        };
      case 'duckdb':
        return {
          sql: `SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_name = ?
                ORDER BY ordinal_position`,
          params: [view],
        };
      default: {
        const e: never = engine;
        throw new Error(`不支持的 SQL 引擎: ${e}`);
      }
    }
  }

  server.registerTool(
    'sql_list_views',
    {
      description: '列出当前连接下的视图名。可选 schema（主要给 PostgreSQL）。',
      inputSchema: {
        connection_id: z.string().optional(),
        schema: z.string().optional(),
      },
    },
    async ({ connection_id, schema }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const driver = registry.requireSql(id);
        const { sql, params } = listViewsSql(driver.engine, schema);
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
                views: ((res.data ?? []) as SqlResultRow[]).map(
                  (row) => row.name ?? row.NAME ?? row.view_name,
                ),
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
    'sql_describe_view',
    {
      description: '查看视图结构（列、类型）。PostgreSQL 可传 schema，默认 public。',
      inputSchema: {
        connection_id: z.string().optional(),
        view: z.string(),
        schema: z.string().optional(),
      },
    },
    async ({ connection_id, view, schema }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const driver = registry.requireSql(id);
        const { sql, params } = describeViewSql(driver.engine, view, schema);
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
    },
  );

  // ── 类型生成 ──────────────────────────────────────────

  function sqlTypeToTs(dataType: string): string {
    const t = dataType.toLowerCase();
    if (
      t.includes('int') ||
      t.includes('serial') ||
      t.includes('numeric') ||
      t.includes('decimal') ||
      t.includes('float') ||
      t.includes('double') ||
      t.includes('real') ||
      t.includes('number')
    )
      return 'number';
    if (t.includes('bool')) return 'boolean';
    if (t.includes('json') || t.includes('jsonb')) return 'Record<string, unknown>';
    if (t.includes('date') || t.includes('time') || t.includes('timestamp')) return 'string';
    if (t.includes('text') || t.includes('char') || t.includes('varchar') || t.includes('clob'))
      return 'string';
    if (t.includes('blob') || t.includes('bytea') || t.includes('binary')) return 'Buffer';
    return 'unknown';
  }

  server.registerTool(
    'sql_generate_types',
    {
      description: '从表结构生成 TypeScript 接口定义。返回可直接使用的 TS 类型代码。',
      inputSchema: {
        connection_id: z.string().optional(),
        table: z.string().describe('表名'),
        schema: z.string().optional().describe('PostgreSQL schema'),
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

        const columns = (res.data ?? []) as SqlResultRow[];
        const interfaceName =
          table.charAt(0).toUpperCase() +
          table.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());

        const fields = columns.map((row) => {
          const colName = row.column_name ?? row.COLUMN_NAME ?? Object.values(row)[0];
          const dataType = row.data_type ?? row.DATA_TYPE ?? Object.values(row)[1];
          const nullable = (row.is_nullable ?? row.IS_NULLABLE ?? row.nullable ?? '') === 'YES';
          const tsType = sqlTypeToTs(String(dataType));
          return `  ${colName}${nullable ? '?' : ''}: ${tsType};`;
        });

        const code = `export interface ${interfaceName} {\n${fields.join('\n')}\n}`;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ connection_id: id, table, interfaceName, code }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );

  // ── 查询缓存统计 ──────────────────────────────────────────

  server.registerTool(
    'sql_cache_stats',
    {
      description:
        '返回查询缓存的统计信息（大小、配置、命中率）。通过 DB_QUERY_CACHE_SIZE 启用缓存。',
      inputSchema: {},
    },
    async () => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(queryCache.getStats()),
          },
        ],
      };
    },
  );

  // ── 索引 ──────────────────────────────────────────

  function createIndexSql(
    engine: SqlEngine,
    table: string,
    columns: string[],
    unique?: boolean,
    indexName?: string,
  ): string {
    validateIdent(table, 'table');
    for (const col of columns) {
      validateIdent(col, 'column');
    }
    const uniqueStr = unique ? 'UNIQUE' : '';
    const idxName =
      indexName && IDENT.test(indexName) ? indexName : `idx_${table}_${columns.join('_')}`;
    switch (engine) {
      case 'mysql': {
        const colStr = columns.map((c) => `\`${c}\``).join(', ');
        return `CREATE ${uniqueStr} INDEX \`${idxName}\` ON \`${table}\` (${colStr})`;
      }
      case 'postgres': {
        const colStr = columns.map((c) => `"${c}"`).join(', ');
        return `CREATE ${uniqueStr} INDEX "${idxName}" ON "${table}" (${colStr})`;
      }
      case 'mssql': {
        const colStr = columns.map((c) => `[${c}]`).join(', ');
        return `CREATE ${uniqueStr} INDEX [${idxName}] ON [${table}] (${colStr})`;
      }
      case 'oracle': {
        const colStr = columns.join(', ');
        return `CREATE ${uniqueStr} INDEX ${idxName} ON ${table} (${colStr})`;
      }
      case 'sqlite': {
        const colStr = columns.join(', ');
        return `CREATE ${uniqueStr} INDEX ${idxName} ON ${table} (${colStr})`;
      }
      case 'duckdb': {
        const colStr = columns.join(', ');
        return `CREATE ${uniqueStr} INDEX ${idxName} ON ${table} (${colStr})`;
      }
      default: {
        const e: never = engine;
        throw new Error(`不支持的引擎: ${e}`);
      }
    }
  }

  server.registerTool(
    'sql_list_indexes',
    {
      description: '列出表的索引。',
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
        const { sql, params } = listIndexesSql(driver.engine, table, schema);
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
                indexes: res.data ?? [],
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
    'sql_create_index',
    {
      description: '为表创建索引。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        table: z.string(),
        columns: z.array(z.string()).min(1).describe('索引列名数组'),
        unique: z.boolean().optional().describe('是否唯一索引'),
        indexName: z.string().optional().describe('索引名称'),
      },
    },
    async ({ connection_id, table, columns, unique, indexName }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const h = registry.require(id);
        if (h.kind !== 'sql') {
          return { content: [{ type: 'text', text: '非 SQL 连接' }], isError: true };
        }
        if (h.spec.readonly) {
          return {
            content: [
              {
                type: 'text',
                text: codedErrorText('SQL_002', { connection_id: id }),
              },
            ],
            isError: true,
          };
        }
        const L = limits();
        const sql = createIndexSql(h.driver.engine, table, columns, unique, indexName);
        const res = await h.driver.execute(sql, [], {
          mode: 'readwrite',
          maxRows: L.maxRows,
          queryTimeoutMs: L.queryTimeoutMs,
          maxSqlLength: L.maxSqlLength,
        });
        if (!res.success) {
          return { content: [{ type: 'text', text: res.error ?? '创建失败' }], isError: true };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                connection_id: id,
                engine: h.driver.engine,
                ok: true,
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
