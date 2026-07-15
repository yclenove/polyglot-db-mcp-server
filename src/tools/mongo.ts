import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry.js';
import { createErrorPayload, type ErrorCode } from '../core/error-codes.js';
import type {
  MongoReadResult,
  MongoTransaction,
  MongoTransactionOperation,
} from '../core/types.js';
import { responseDataByteLimit } from '../core/config.js';
import {
  parseMongoEjsonArray,
  parseMongoEjsonObject as parseJsonObject,
  parseMongoEjsonObjectArray as parseJsonObjectArray,
  isMongoBsonValue,
  stringifyMongoResult,
} from '../core/mongo-ejson.js';
import {
  detectNoSqlInjection,
  findDisallowedMongoPipelineCollection,
} from '../core/mongo-guards.js';
import { maskResultRows } from './result-masking.js';

const activeMongoTransactions = new Map<
  string,
  {
    connectionId: string;
    transaction: MongoTransaction;
    createdAt: number;
  }
>();
let mongoTxCounter = 0;
let mongoTransactionCleanupStarted = false;

/** 分析文档结构，收集字段路径和类型 */
function analyzeDocument(
  obj: Record<string, unknown>,
  prefix: string,
  fieldMap: Map<string, Set<string>>,
): void {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const bsonType = isMongoBsonValue(value) ? value._bsontype : undefined;
    const type =
      typeof bsonType === 'string'
        ? `bson:${bsonType}`
        : value instanceof Date
          ? 'date'
          : value === null
            ? 'null'
            : Array.isArray(value)
              ? 'array'
              : typeof value;
    if (!fieldMap.has(path)) fieldMap.set(path, new Set());
    fieldMap.get(path)!.add(type);

    if (type === 'object' && value !== null && !Array.isArray(value)) {
      analyzeDocument(value as Record<string, unknown>, path, fieldMap);
    }
  }
}

function codedMongoErrorText(code: ErrorCode, detail: string): string {
  const errorInfo = createErrorPayload(code, { detail });
  return JSON.stringify({ error: errorInfo.message, detail, error_info: errorInfo });
}

function normalizeMongoReadResult(result: MongoReadResult | unknown[]): MongoReadResult {
  if (!Array.isArray(result)) return result;
  return {
    data: result,
    totalRows: result.length,
    totalRowsExact: true,
    truncated: false,
    returnedBytes: 2,
  };
}

function effectiveMongoByteLimit(requested: number | undefined): number {
  return Math.min(requested ?? Number.MAX_SAFE_INTEGER, responseDataByteLimit());
}

function ensureMongoTransactionCleanup(): void {
  if (mongoTransactionCleanupStarted) return;
  mongoTransactionCleanupStarted = true;
  setInterval(() => {
    const txTimeoutMs = parseInt(
      process.env.DB_MONGO_TRANSACTION_TIMEOUT_MS ||
        process.env.DB_TRANSACTION_TIMEOUT_MS ||
        '300000',
      10,
    );
    const now = Date.now();
    for (const [txId, entry] of activeMongoTransactions) {
      if (now - entry.createdAt > txTimeoutMs) {
        entry.transaction.rollback().catch(() => {});
        activeMongoTransactions.delete(txId);
      }
    }
  }, 60_000).unref();
}

function buildMongoTransactionOperation(input: {
  operation: MongoTransactionOperation['operation'];
  collection: string;
  document_json?: string;
  documents_json?: string;
  filter_json?: string;
  update_json?: string;
  upsert?: boolean;
}): MongoTransactionOperation {
  switch (input.operation) {
    case 'insert_one':
      return {
        operation: input.operation,
        collection: input.collection,
        document: parseJsonObject(input.document_json, 'document_json'),
      };
    case 'insert_many':
      return {
        operation: input.operation,
        collection: input.collection,
        documents: parseJsonObjectArray(input.documents_json, 'documents_json'),
      };
    case 'update_one':
    case 'update_many': {
      const filter = parseJsonObject(input.filter_json, 'filter_json');
      const injection = detectNoSqlInjection(filter);
      if (injection) throw new Error(codedMongoErrorText('MONGO_003', injection));
      return {
        operation: input.operation,
        collection: input.collection,
        filter,
        update: parseJsonObject(input.update_json, 'update_json'),
        options: { upsert: input.upsert },
      };
    }
    case 'delete_one':
    case 'delete_many': {
      const filter = parseJsonObject(input.filter_json, 'filter_json');
      const injection = detectNoSqlInjection(filter);
      if (injection) throw new Error(codedMongoErrorText('MONGO_003', injection));
      return {
        operation: input.operation,
        collection: input.collection,
        filter,
      };
    }
    default: {
      const neverOperation: never = input.operation;
      throw new Error(`不支持的 MongoDB 事务操作: ${neverOperation}`);
    }
  }
}

export function registerMongoTools(server: McpServer, registry: ConnectionRegistry): void {
  ensureMongoTransactionCleanup();

  server.registerTool(
    'mongo_list_collections',
    {
      description: '列出 MongoDB 数据库中的集合名称',
      inputSchema: {
        connection_id: z.string().optional(),
      },
    },
    async ({ connection_id }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const names = await d.listCollections();
        return {
          content: [
            { type: 'text', text: stringifyMongoResult({ connection_id: id, collections: names }) },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_begin_transaction',
    {
      description:
        '开始 MongoDB 多文档事务。返回 transaction_id，后续使用 mongo_execute_in_transaction、mongo_commit 或 mongo_rollback。',
      inputSchema: {
        connection_id: z.string().optional(),
      },
    },
    async ({ connection_id }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const h = registry.require(id);
        if (h.kind !== 'mongo') {
          return {
            content: [
              { type: 'text', text: codedMongoErrorText('MONGO_001', `当前连接类型: ${h.kind}`) },
            ],
            isError: true,
          };
        }
        if (h.spec.readonly) {
          return {
            content: [
              { type: 'text', text: codedMongoErrorText('MONGO_004', `connection_id=${id}`) },
            ],
            isError: true,
          };
        }
        const transaction = await h.driver.beginTransaction();
        const transactionId = `mongo_tx_${++mongoTxCounter}_${Date.now()}`;
        activeMongoTransactions.set(transactionId, {
          connectionId: id,
          transaction,
          createdAt: Date.now(),
        });
        return {
          content: [
            {
              type: 'text',
              text: stringifyMongoResult({ transaction_id: transactionId, connection_id: id }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_execute_in_transaction',
    {
      description:
        '在 MongoDB 事务中执行一个写操作。operation 支持 insert_one、insert_many、update_one、update_many、delete_one、delete_many。',
      inputSchema: {
        transaction_id: z.string(),
        operation: z.enum([
          'insert_one',
          'insert_many',
          'update_one',
          'update_many',
          'delete_one',
          'delete_many',
        ]),
        collection: z.string(),
        document_json: z.string().optional(),
        documents_json: z.string().optional(),
        filter_json: z.string().optional(),
        update_json: z.string().optional(),
        upsert: z.boolean().optional(),
      },
    },
    async ({
      transaction_id,
      operation,
      collection,
      document_json,
      documents_json,
      filter_json,
      update_json,
      upsert,
    }) => {
      try {
        const entry = activeMongoTransactions.get(transaction_id);
        if (!entry) {
          return {
            content: [
              {
                type: 'text',
                text: codedMongoErrorText('MONGO_005', transaction_id),
              },
            ],
            isError: true,
          };
        }
        const txOperation = buildMongoTransactionOperation({
          operation,
          collection,
          document_json,
          documents_json,
          filter_json,
          update_json,
          upsert,
        });
        const result = await entry.transaction.execute(txOperation);
        return {
          content: [
            {
              type: 'text',
              text: stringifyMongoResult({
                transaction_id,
                connection_id: entry.connectionId,
                ...result,
              }),
            },
          ],
        };
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text }], isError: true };
      }
    },
  );

  server.registerTool(
    'mongo_commit',
    {
      description: '提交 MongoDB 事务。',
      inputSchema: {
        transaction_id: z.string(),
      },
    },
    async ({ transaction_id }) => {
      try {
        const entry = activeMongoTransactions.get(transaction_id);
        if (!entry) {
          return {
            content: [{ type: 'text', text: codedMongoErrorText('MONGO_005', transaction_id) }],
            isError: true,
          };
        }
        await entry.transaction.commit();
        activeMongoTransactions.delete(transaction_id);
        return {
          content: [
            { type: 'text', text: stringifyMongoResult({ transaction_id, status: 'committed' }) },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_rollback',
    {
      description: '回滚 MongoDB 事务。',
      inputSchema: {
        transaction_id: z.string(),
      },
    },
    async ({ transaction_id }) => {
      try {
        const entry = activeMongoTransactions.get(transaction_id);
        if (!entry) {
          return {
            content: [{ type: 'text', text: codedMongoErrorText('MONGO_005', transaction_id) }],
            isError: true,
          };
        }
        await entry.transaction.rollback();
        activeMongoTransactions.delete(transaction_id);
        return {
          content: [
            { type: 'text', text: stringifyMongoResult({ transaction_id, status: 'rolled_back' }) },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_insert_one',
    {
      description: '向集合插入单个文档。document_json 支持 JSON 和 MongoDB Extended JSON。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        document_json: z.string().describe('JSON/EJSON 对象字符串'),
      },
    },
    async ({ connection_id, collection, document_json }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const document = parseJsonObject(document_json, 'document_json');
        const result = await d.insertOne(collection, document);
        return {
          content: [{ type: 'text', text: stringifyMongoResult({ connection_id: id, ...result }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_insert_many',
    {
      description: '向集合插入多个文档。documents_json 支持 JSON 和 MongoDB Extended JSON。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        documents_json: z.string().describe('JSON/EJSON 数组字符串'),
      },
    },
    async ({ connection_id, collection, documents_json }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const documents = parseJsonObjectArray(documents_json, 'documents_json');
        const result = await d.insertMany(collection, documents);
        return {
          content: [{ type: 'text', text: stringifyMongoResult({ connection_id: id, ...result }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_update_one',
    {
      description: '更新集合中匹配 filter 的单个文档。update_json 须包含 $set 等更新操作符。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        filter_json: z.string().describe('JSON 对象字符串'),
        update_json: z.string().describe('JSON 对象字符串，如 {"$set": {"name": "new"}}'),
        upsert: z.boolean().optional().describe('如果为 true，当没有匹配文档时插入新文档'),
      },
    },
    async ({ connection_id, collection, filter_json, update_json, upsert }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const filter = parseJsonObject(filter_json, 'filter_json');
        const update = parseJsonObject(update_json, 'update_json');
        const injection = detectNoSqlInjection(filter);
        if (injection) {
          return {
            content: [{ type: 'text', text: codedMongoErrorText('MONGO_003', injection) }],
            isError: true,
          };
        }
        const result = await d.updateOne(collection, filter, update, { upsert });
        return {
          content: [{ type: 'text', text: stringifyMongoResult({ connection_id: id, ...result }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_delete_one',
    {
      description: '删除集合中匹配 filter 的单个文档。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        filter_json: z.string().describe('JSON 对象字符串'),
      },
    },
    async ({ connection_id, collection, filter_json }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const filter = parseJsonObject(filter_json, 'filter_json');
        const injection = detectNoSqlInjection(filter);
        if (injection) throw new Error(injection);
        const result = await d.deleteOne(collection, filter);
        return {
          content: [{ type: 'text', text: stringifyMongoResult({ connection_id: id, ...result }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_find',
    {
      description: '在集合上执行 find。filter 支持 JSON/EJSON；limit 默认 50，最大 500。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        filter_json: z.string().optional().describe('JSON/EJSON 对象字符串，默认 {}'),
        limit: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
        response_bytes_limit: z
          .number()
          .int()
          .min(1024)
          .max(16 * 1024 * 1024)
          .optional(),
      },
    },
    async ({ connection_id, collection, filter_json, limit, skip, response_bytes_limit }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const filter = filter_json ? parseJsonObject(filter_json, 'filter_json') : {};
        const injection = detectNoSqlInjection(filter);
        if (injection) {
          return {
            content: [{ type: 'text', text: codedMongoErrorText('MONGO_003', injection) }],
            isError: true,
          };
        }
        const lim = limit ?? 50;
        const read = normalizeMongoReadResult(
          await d.find(collection, filter, {
            limit: lim,
            skip,
            maxBytes: effectiveMongoByteLimit(response_bytes_limit),
          }),
        );
        const rows = maskResultRows(read.data);
        return {
          content: [
            {
              type: 'text',
              text: stringifyMongoResult({
                connection_id: id,
                rows,
                returnedRows: rows.length,
                totalRows: read.totalRows,
                totalRowsExact: read.totalRowsExact,
                truncated: read.truncated,
                truncatedBy: read.truncatedBy,
                returnedBytes: read.returnedBytes,
              }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_aggregate',
    {
      description: '执行只读聚合管道。支持 JSON/EJSON，拒绝 $out/$merge；limit 默认 50，最大 500。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        pipeline_json: z.string(),
        limit: z.number().int().min(1).max(500).optional(),
        response_bytes_limit: z
          .number()
          .int()
          .min(1024)
          .max(16 * 1024 * 1024)
          .optional(),
      },
    },
    async ({ connection_id, collection, pipeline_json, limit, response_bytes_limit }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const h = registry.require(id);
        if (h.kind !== 'mongo') {
          return {
            content: [
              { type: 'text', text: codedMongoErrorText('MONGO_001', `当前连接类型: ${h.kind}`) },
            ],
            isError: true,
          };
        }
        const pipeline = parseMongoEjsonArray(pipeline_json, 'pipeline_json');
        const injection = detectNoSqlInjection(pipeline);
        if (injection) {
          return {
            content: [{ type: 'text', text: codedMongoErrorText('MONGO_003', injection) }],
            isError: true,
          };
        }
        const disallowedCollection = findDisallowedMongoPipelineCollection(
          pipeline,
          h.spec.allowlist,
        );
        if (disallowedCollection) {
          return {
            content: [
              {
                type: 'text',
                text: codedMongoErrorText(
                  'MONGO_002',
                  `聚合管道引用了未授权集合「${disallowedCollection}」`,
                ),
              },
            ],
            isError: true,
          };
        }
        const maxRows = limit ?? 50;
        const read = normalizeMongoReadResult(
          await h.driver.aggregate(collection, pipeline, {
            limit: maxRows,
            maxBytes: effectiveMongoByteLimit(response_bytes_limit),
          }),
        );
        const rows = maskResultRows(read.data);
        return {
          content: [
            {
              type: 'text',
              text: stringifyMongoResult({
                connection_id: id,
                rows,
                returnedRows: rows.length,
                limit: maxRows,
                totalRows: read.totalRows,
                totalRowsExact: read.totalRowsExact,
                truncated: read.truncated,
                truncatedBy: read.truncatedBy,
                returnedBytes: read.returnedBytes,
              }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_count',
    {
      description: '统计集合文档数，filter_json 可选',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        filter_json: z.string().optional(),
      },
    },
    async ({ connection_id, collection, filter_json }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const filter = filter_json ? parseJsonObject(filter_json, 'filter_json') : {};
        const injection = detectNoSqlInjection(filter);
        if (injection) throw new Error(injection);
        const n = await d.count(collection, filter);
        return {
          content: [{ type: 'text', text: stringifyMongoResult({ connection_id: id, count: n }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  // ── mongo_list_indexes ──────────────────────────────────

  server.registerTool(
    'mongo_list_indexes',
    {
      description: '列出集合的所有索引。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
      },
    },
    async ({ connection_id, collection }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const indexes = await d.listIndexes(collection);
        return {
          content: [
            {
              type: 'text',
              text: stringifyMongoResult({ connection_id: id, collection, indexes }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  // ── mongo_create_index ──────────────────────────────────

  server.registerTool(
    'mongo_create_index',
    {
      description:
        '为集合创建索引。keys_json 为 JSON 对象，如 {"name": 1} 表示升序，{"name": -1} 表示降序。支持 unique 和 sparse 选项。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        keys_json: z.string().describe('索引键定义，如 {"field": 1}'),
        name: z.string().optional().describe('索引名称'),
        unique: z.boolean().optional().describe('是否唯一索引'),
        sparse: z.boolean().optional().describe('是否稀疏索引'),
      },
    },
    async ({ connection_id, collection, keys_json, name, unique, sparse }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const keys = JSON.parse(keys_json) as Record<string, 1 | -1>;
        if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
          throw new Error('keys_json 须为 JSON 对象');
        }
        const indexName = await d.createIndex(collection, keys, { name, unique, sparse });
        return {
          content: [
            {
              type: 'text',
              text: stringifyMongoResult({ connection_id: id, collection, indexName }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  // ── 批量操作 ──────────────────────────────────────────

  server.registerTool(
    'mongo_update_many',
    {
      description: '更新集合中匹配 filter 的所有文档。update_json 须包含 $set 等更新操作符。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        filter_json: z.string().describe('JSON 对象字符串'),
        update_json: z.string().describe('JSON 对象字符串，如 {"$set": {"name": "new"}}'),
      },
    },
    async ({ connection_id, collection, filter_json, update_json }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const filter = parseJsonObject(filter_json, 'filter_json');
        const update = parseJsonObject(update_json, 'update_json');
        const injection = detectNoSqlInjection(filter);
        if (injection) throw new Error(injection);
        const result = await d.updateMany(collection, filter, update);
        return {
          content: [{ type: 'text', text: stringifyMongoResult({ connection_id: id, ...result }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_delete_many',
    {
      description: '删除集合中匹配 filter 的所有文档。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        filter_json: z.string().describe('JSON 对象字符串'),
      },
    },
    async ({ connection_id, collection, filter_json }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const filter = parseJsonObject(filter_json, 'filter_json');
        const injection = detectNoSqlInjection(filter);
        if (injection) throw new Error(injection);
        const result = await d.deleteMany(collection, filter);
        return {
          content: [{ type: 'text', text: stringifyMongoResult({ connection_id: id, ...result }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_find_one_and_update',
    {
      description: '查找并更新单个文档。可选 upsert 和 returnDocument（before/after）。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        filter_json: z.string().describe('JSON 对象字符串'),
        update_json: z.string().describe('JSON 对象字符串'),
        upsert: z.boolean().optional().describe('如果为 true，当没有匹配文档时插入新文档'),
        returnDocument: z
          .enum(['before', 'after'])
          .optional()
          .describe('返回更新前还是更新后的文档'),
      },
    },
    async ({ connection_id, collection, filter_json, update_json, upsert, returnDocument }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const filter = parseJsonObject(filter_json, 'filter_json');
        const update = parseJsonObject(update_json, 'update_json');
        const injection = detectNoSqlInjection(filter);
        if (injection) throw new Error(injection);
        const result = await d.findOneAndUpdate(collection, filter, update, {
          upsert,
          returnDocument,
        });
        return {
          content: [
            { type: 'text', text: stringifyMongoResult({ connection_id: id, document: result }) },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_find_one_and_delete',
    {
      description: '查找并删除单个文档。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        filter_json: z.string().describe('JSON 对象字符串'),
      },
    },
    async ({ connection_id, collection, filter_json }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const filter = parseJsonObject(filter_json, 'filter_json');
        const injection = detectNoSqlInjection(filter);
        if (injection) throw new Error(injection);
        const result = await d.findOneAndDelete(collection, filter);
        return {
          content: [
            { type: 'text', text: stringifyMongoResult({ connection_id: id, document: result }) },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  // ── Schema 分析 ──────────────────────────────────────────

  server.registerTool(
    'mongo_schema_analysis',
    {
      description:
        '分析集合的文档结构（采样 N 条文档，合并所有字段路径和类型）。用于快速了解集合 schema。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        sample_size: z.number().int().min(1).max(1000).optional().describe('采样文档数，默认 100'),
      },
    },
    async ({ connection_id, collection, sample_size }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const limit = sample_size ?? 100;
        const read = normalizeMongoReadResult(await d.find(collection, {}, { limit }));
        const docs = read.data;

        const fieldMap = new Map<string, Set<string>>();
        for (const doc of docs) {
          analyzeDocument(doc as Record<string, unknown>, '', fieldMap);
        }

        const schema = [...fieldMap.entries()].map(([path, types]) => ({
          path,
          types: [...types],
          frequency: fieldMap.has(path) ? 'common' : 'rare',
        }));

        return {
          content: [
            {
              type: 'text',
              text: stringifyMongoResult({
                connection_id: id,
                collection,
                sampleSize: docs.length,
                fields: schema,
              }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  // ── 集合管理 ──────────────────────────────────────────

  server.registerTool(
    'mongo_drop_collection',
    {
      description: '删除集合。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
      },
    },
    async ({ connection_id, collection }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const result = await d.dropCollection(collection);
        return {
          content: [
            { type: 'text', text: stringifyMongoResult({ connection_id: id, dropped: result }) },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'mongo_rename_collection',
    {
      description: '重命名集合。只读连接拒绝。',
      inputSchema: {
        connection_id: z.string().optional(),
        collection: z.string(),
        newName: z.string().describe('新集合名称'),
      },
    },
    async ({ connection_id, collection, newName }) => {
      try {
        const id = registry.resolveConnectionId(connection_id);
        const d = registry.requireMongo(id);
        const result = await d.renameCollection(collection, newName);
        return {
          content: [
            {
              type: 'text',
              text: stringifyMongoResult({ connection_id: id, collectionName: result }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  );
}
