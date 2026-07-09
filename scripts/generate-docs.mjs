/**
 * API 文档生成脚本
 * 从工具注册代码中提取 description 和 inputSchema，生成 API 文档
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// 工具定义（从源码中手动提取，因为动态导入需要编译后的代码）
const tools = [
  // 连接工具
  {
    name: 'list_connections',
    category: '连接管理',
    description: '列出 DB_MCP_CONNECTIONS 中所有 connection_id、engine 与是否只读',
    params: [],
  },
  {
    name: 'validate_connection_config',
    category: '连接管理',
    description: '验证 DB_MCP_CONNECTIONS JSON 配置的合法性，返回解析结果或错误详情。',
    params: [
      { name: 'config_json', type: 'string', required: true, description: 'DB_MCP_CONNECTIONS 的 JSON 字符串' },
    ],
  },
  {
    name: 'test_connection',
    category: '连接管理',
    description: '对指定 connection_id 执行 ping（缺省使用 DB_MCP_DEFAULT_CONNECTION_ID 或第一条）',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
    ],
  },
  {
    name: 'health_check',
    category: '连接管理',
    description: '执行全面的健康检查，测试所有连接的状态和延迟。',
    params: [],
  },
  {
    name: 'connection_diagnose',
    category: '连接管理',
    description: '全面诊断所有连接的健康状况，返回状态、延迟、版本信息、错误码和配置建议。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '指定连接 ID；不传则诊断所有连接' },
    ],
  },
  {
    name: 'connection_stats',
    category: '连接管理',
    description: '返回各连接的统计信息，包括总请求数、审计统计和性能指标。',
    params: [],
  },
  {
    name: 'prometheus_metrics',
    category: '连接管理',
    description: '返回 Prometheus 文本格式指标，可用于监控系统集成。',
    params: [],
  },

  // SQL 工具
  {
    name: 'sql_query',
    category: 'SQL',
    description: '在 SQL 连接（mysql/postgres/mssql/oracle）上执行只读查询。支持分页。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'sql', type: 'string', required: true, description: 'SQL 查询语句' },
      { name: 'params', type: 'array', required: false, description: '查询参数' },
      { name: 'limit', type: 'number', required: false, description: '最大返回行数' },
      { name: 'page', type: 'number', required: false, description: '页码，从 1 开始' },
      { name: 'page_size', type: 'number', required: false, description: '每页行数，默认 20' },
    ],
  },
  {
    name: 'sql_execute',
    category: 'SQL',
    description: '在 SQL 连接上执行写入类 SQL（INSERT/UPDATE/DELETE 等）。受危险语句规则约束；若连接 readonly=true 则拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'sql', type: 'string', required: true, description: 'SQL 语句' },
      { name: 'params', type: 'array', required: false, description: '查询参数' },
    ],
  },
  {
    name: 'sql_list_tables',
    category: 'SQL',
    description: '列出当前连接下的表名（按引擎使用系统目录）。可选 schema（主要给 PostgreSQL）。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'schema', type: 'string', required: false, description: 'Schema 名称（PostgreSQL）' },
    ],
  },
  {
    name: 'sql_describe_table',
    category: 'SQL',
    description: '查看表结构（列、类型）。PostgreSQL 可传 schema，默认 public。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'table', type: 'string', required: true, description: '表名' },
      { name: 'schema', type: 'string', required: false, description: 'Schema 名称（PostgreSQL）' },
    ],
  },
  {
    name: 'sql_begin_transaction',
    category: 'SQL',
    description: '在 SQL 连接上开始一个新事务。返回事务 ID。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
    ],
  },
  {
    name: 'sql_execute_in_transaction',
    category: 'SQL',
    description: '在事务中执行 SQL。需要先调用 sql_begin_transaction 获取 transaction_id。',
    params: [
      { name: 'transaction_id', type: 'string', required: true, description: '事务 ID' },
      { name: 'sql', type: 'string', required: true, description: 'SQL 语句' },
      { name: 'params', type: 'array', required: false, description: '查询参数' },
    ],
  },
  {
    name: 'sql_commit',
    category: 'SQL',
    description: '提交事务，使所有更改永久生效。',
    params: [
      { name: 'transaction_id', type: 'string', required: true, description: '事务 ID' },
    ],
  },
  {
    name: 'sql_rollback',
    category: 'SQL',
    description: '回滚事务，撤销所有未提交的更改。',
    params: [
      { name: 'transaction_id', type: 'string', required: true, description: '事务 ID' },
    ],
  },
  {
    name: 'sql_batch_execute',
    category: 'SQL',
    description: '在单个事务中批量执行多条 SQL。要么全部成功，要么全部回滚。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'statements', type: 'array', required: true, description: 'SQL 语句数组，每项含 sql 和可选 params' },
    ],
  },
  {
    name: 'sql_explain',
    category: 'SQL',
    description: '返回 SQL 查询的执行计划。支持 MySQL/PostgreSQL/MSSQL/Oracle。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'sql', type: 'string', required: true, description: '要分析的 SQL 查询（SELECT 语句）' },
    ],
  },

  // MongoDB 工具
  {
    name: 'mongo_list_collections',
    category: 'MongoDB',
    description: '列出 MongoDB 数据库中的集合名称',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
    ],
  },
  {
    name: 'mongo_find',
    category: 'MongoDB',
    description: '在集合上执行 find。filter 为 JSON 对象；limit 默认 50，最大 500。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'filter_json', type: 'string', required: false, description: 'JSON 对象字符串，默认 {}' },
      { name: 'limit', type: 'number', required: false, description: '最大返回行数，默认 50' },
      { name: 'skip', type: 'number', required: false, description: '跳过行数' },
    ],
  },
  {
    name: 'mongo_aggregate',
    category: 'MongoDB',
    description: '对集合执行聚合管道。pipeline_json 为 JSON 数组字符串。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'pipeline_json', type: 'string', required: true, description: 'JSON 数组字符串' },
    ],
  },
  {
    name: 'mongo_count',
    category: 'MongoDB',
    description: '统计集合文档数，filter_json 可选',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'filter_json', type: 'string', required: false, description: 'JSON 对象字符串' },
    ],
  },
  {
    name: 'mongo_insert_one',
    category: 'MongoDB',
    description: '向集合插入单个文档。document_json 为 JSON 对象字符串。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'document_json', type: 'string', required: true, description: 'JSON 对象字符串' },
    ],
  },
  {
    name: 'mongo_insert_many',
    category: 'MongoDB',
    description: '向集合插入多个文档。documents_json 为 JSON 数组字符串。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'documents_json', type: 'string', required: true, description: 'JSON 数组字符串' },
    ],
  },
  {
    name: 'mongo_update_one',
    category: 'MongoDB',
    description: '更新集合中匹配 filter 的单个文档。update_json 须包含 $set 等更新操作符。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'filter_json', type: 'string', required: true, description: 'JSON 对象字符串' },
      { name: 'update_json', type: 'string', required: true, description: 'JSON 对象字符串' },
      { name: 'upsert', type: 'boolean', required: false, description: '如果为 true，当没有匹配文档时插入新文档' },
    ],
  },
  {
    name: 'mongo_delete_one',
    category: 'MongoDB',
    description: '删除集合中匹配 filter 的单个文档。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'filter_json', type: 'string', required: true, description: 'JSON 对象字符串' },
    ],
  },
  {
    name: 'mongo_list_indexes',
    category: 'MongoDB',
    description: '列出集合的所有索引。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
    ],
  },
  {
    name: 'mongo_create_index',
    category: 'MongoDB',
    description: '为集合创建索引。keys_json 为 JSON 对象，如 {"name": 1} 表示升序。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'keys_json', type: 'string', required: true, description: '索引键定义' },
      { name: 'name', type: 'string', required: false, description: '索引名称' },
      { name: 'unique', type: 'boolean', required: false, description: '是否唯一索引' },
      { name: 'sparse', type: 'boolean', required: false, description: '是否稀疏索引' },
    ],
  },
  {
    name: 'mongo_schema_analysis',
    category: 'MongoDB',
    description: '分析集合的文档结构，采样文档并合并字段路径和类型。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'sample_size', type: 'number', required: false, description: '采样文档数，默认 100，最大 1000' },
    ],
  },
  {
    name: 'mongo_begin_transaction',
    category: 'MongoDB 事务',
    description: '开始 MongoDB 多文档事务，返回 transaction_id。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
    ],
  },
  {
    name: 'mongo_execute_in_transaction',
    category: 'MongoDB 事务',
    description: '在 MongoDB 事务中执行一个受控写操作。',
    params: [
      { name: 'transaction_id', type: 'string', required: true, description: '事务 ID' },
      { name: 'operation', type: 'string', required: true, description: 'insert_one / insert_many / update_one / update_many / delete_one / delete_many' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'document_json', type: 'string', required: false, description: 'insert_one 使用的 JSON 对象' },
      { name: 'documents_json', type: 'string', required: false, description: 'insert_many 使用的 JSON 对象数组' },
      { name: 'filter_json', type: 'string', required: false, description: 'update/delete 使用的 JSON filter' },
      { name: 'update_json', type: 'string', required: false, description: 'update 使用的 JSON 更新对象' },
      { name: 'upsert', type: 'boolean', required: false, description: 'update_one 可选 upsert' },
    ],
  },
  {
    name: 'mongo_commit',
    category: 'MongoDB 事务',
    description: '提交 MongoDB 事务。',
    params: [
      { name: 'transaction_id', type: 'string', required: true, description: '事务 ID' },
    ],
  },
  {
    name: 'mongo_rollback',
    category: 'MongoDB 事务',
    description: '回滚 MongoDB 事务。',
    params: [
      { name: 'transaction_id', type: 'string', required: true, description: '事务 ID' },
    ],
  },

  // Redis 工具
  {
    name: 'redis_get',
    category: 'Redis',
    description: '读取 Redis 字符串键值。遵守连接 keyPrefix。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },
  {
    name: 'redis_set',
    category: 'Redis',
    description: '写入 Redis 字符串键。只读连接拒绝。可选 ttl_seconds。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'value', type: 'string', required: true, description: '值' },
      { name: 'ttl_seconds', type: 'number', required: false, description: '过期时间（秒）' },
    ],
  },
  {
    name: 'redis_del',
    category: 'Redis',
    description: '删除 Redis 键。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },
  {
    name: 'redis_scan',
    category: 'Redis',
    description: '使用 SCAN 迭代键（禁止 KEYS）。cursor 首次传 "0"；match 支持 glob。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'match', type: 'string', required: false, description: '匹配模式，默认 *' },
      { name: 'cursor', type: 'string', required: false, description: '游标，默认 0' },
      { name: 'count', type: 'number', required: false, description: '每次迭代数量，默认 100' },
    ],
  },
  {
    name: 'redis_blocked_commands',
    category: 'Redis',
    description: '列出本服务默认禁止执行的 Redis 命令名。',
    params: [],
  },
  {
    name: 'redis_pipeline',
    category: 'Redis',
    description: '批量执行安全 Redis 命令子集。遵守 keyPrefix、readonly 和阻断命令规则。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'commands_json', type: 'string', required: true, description: '命令 JSON 数组，每项包含 command、key、args' },
    ],
  },
  {
    name: 'redis_type',
    category: 'Redis',
    description: '返回 Redis 键的数据类型（string/hash/list/set/zset/stream/none）。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },
  {
    name: 'redis_hget',
    category: 'Redis',
    description: '获取 Redis Hash 中指定字段的值。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'field', type: 'string', required: true, description: '字段名' },
    ],
  },
  {
    name: 'redis_hset',
    category: 'Redis',
    description: '设置 Redis Hash 中指定字段的值。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'field', type: 'string', required: true, description: '字段名' },
      { name: 'value', type: 'string', required: true, description: '值' },
    ],
  },
  {
    name: 'redis_hgetall',
    category: 'Redis',
    description: '获取 Redis Hash 的所有字段和值。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },
  {
    name: 'redis_hdel',
    category: 'Redis',
    description: '删除 Redis Hash 中指定字段。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'field', type: 'string', required: true, description: '字段名' },
    ],
  },

  // 审计工具
  {
    name: 'audit_get_recent',
    category: '审计',
    description: '获取最近的审计日志。',
    params: [
      { name: 'limit', type: 'number', required: false, description: '返回数量，默认 50' },
    ],
  },
  {
    name: 'audit_filter',
    category: '审计',
    description: '按条件过滤审计日志。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id' },
      { name: 'tool', type: 'string', required: false, description: '工具名称' },
      { name: 'success', type: 'boolean', required: false, description: '是否成功' },
      { name: 'since', type: 'string', required: false, description: '开始时间（ISO 8601）' },
      { name: 'until', type: 'string', required: false, description: '结束时间（ISO 8601）' },
      { name: 'limit', type: 'number', required: false, description: '返回数量' },
    ],
  },
  {
    name: 'audit_stats',
    category: '审计',
    description: '获取审计统计信息。',
    params: [],
  },
  {
    name: 'export_audit',
    category: '审计',
    description: '导出审计日志，支持 JSON 格式，可按时间范围和数量限制过滤。',
    params: [
      { name: 'format', type: 'string', required: false, description: '导出格式，默认 json' },
      { name: 'limit', type: 'number', required: false, description: '最大导出条数，默认 1000' },
      { name: 'since', type: 'string', required: false, description: '起始时间（ISO 8601）' },
    ],
  },

  // Schema 工具
  {
    name: 'schema_export',
    category: 'Schema',
    description: '导出数据库 Schema 为 JSON 或 SQL DDL 格式。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'format', type: 'string', required: false, description: '输出格式：json 或 sql，默认 json' },
      { name: 'schema', type: 'string', required: false, description: 'Schema 名称（PostgreSQL）' },
    ],
  },
  {
    name: 'schema_diff',
    category: 'Schema',
    description: '比较两个 SQL 连接或 schema 的表结构差异，返回新增、删除和变更的表/列。',
    params: [
      { name: 'source_connection_id', type: 'string', required: true, description: '源连接 id' },
      { name: 'target_connection_id', type: 'string', required: true, description: '目标连接 id' },
      { name: 'source_schema', type: 'string', required: false, description: '源 schema（PostgreSQL）' },
      { name: 'target_schema', type: 'string', required: false, description: '目标 schema（PostgreSQL）' },
    ],
  },

  // Redis List 操作
  {
    name: 'redis_lpush',
    category: 'Redis List',
    description: '向 Redis List 头部插入一个或多个元素。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'values', type: 'array', required: true, description: '要插入的值数组' },
    ],
  },
  {
    name: 'redis_rpush',
    category: 'Redis List',
    description: '向 Redis List 尾部插入一个或多个元素。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'values', type: 'array', required: true, description: '要插入的值数组' },
    ],
  },
  {
    name: 'redis_lpop',
    category: 'Redis List',
    description: '移除并返回 Redis List 头部元素。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },
  {
    name: 'redis_rpop',
    category: 'Redis List',
    description: '移除并返回 Redis List 尾部元素。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },
  {
    name: 'redis_lrange',
    category: 'Redis List',
    description: '返回 Redis List 中指定范围的元素。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'start', type: 'number', required: true, description: '起始索引' },
      { name: 'stop', type: 'number', required: true, description: '结束索引' },
    ],
  },
  {
    name: 'redis_llen',
    category: 'Redis List',
    description: '返回 Redis List 的长度。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },

  // Redis Set 操作
  {
    name: 'redis_sadd',
    category: 'Redis Set',
    description: '向 Redis Set 添加一个或多个成员。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'members', type: 'array', required: true, description: '要添加的成员数组' },
    ],
  },
  {
    name: 'redis_smembers',
    category: 'Redis Set',
    description: '返回 Redis Set 的所有成员。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },
  {
    name: 'redis_srem',
    category: 'Redis Set',
    description: '从 Redis Set 移除一个或多个成员。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'members', type: 'array', required: true, description: '要移除的成员数组' },
    ],
  },
  {
    name: 'redis_scard',
    category: 'Redis Set',
    description: '返回 Redis Set 的成员数量。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },
  {
    name: 'redis_sismember',
    category: 'Redis Set',
    description: '检查成员是否存在于 Redis Set 中。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'member', type: 'string', required: true, description: '成员名' },
    ],
  },

  // Redis Sorted Set 操作
  {
    name: 'redis_zadd',
    category: 'Redis Sorted Set',
    description: '向 Redis Sorted Set 添加成员及其分数。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'score', type: 'number', required: true, description: '分数' },
      { name: 'member', type: 'string', required: true, description: '成员' },
    ],
  },
  {
    name: 'redis_zrange',
    category: 'Redis Sorted Set',
    description: '返回 Redis Sorted Set 中指定范围的成员。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'start', type: 'number', required: true, description: '起始索引' },
      { name: 'stop', type: 'number', required: true, description: '结束索引' },
      { name: 'withScores', type: 'boolean', required: false, description: '是否返回分数' },
    ],
  },
  {
    name: 'redis_zrem',
    category: 'Redis Sorted Set',
    description: '从 Redis Sorted Set 移除一个或多个成员。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'members', type: 'array', required: true, description: '要移除的成员数组' },
    ],
  },
  {
    name: 'redis_zcard',
    category: 'Redis Sorted Set',
    description: '返回 Redis Sorted Set 的成员数量。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },
  {
    name: 'redis_zscore',
    category: 'Redis Sorted Set',
    description: '返回 Redis Sorted Set 中指定成员的分数。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'member', type: 'string', required: true, description: '成员名' },
    ],
  },

  // Redis 键管理
  {
    name: 'redis_expire',
    category: 'Redis 键管理',
    description: '设置 Redis 键的过期时间（秒）。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
      { name: 'seconds', type: 'number', required: true, description: '过期时间（秒）' },
    ],
  },
  {
    name: 'redis_ttl',
    category: 'Redis 键管理',
    description: '返回 Redis 键的剩余过期时间（秒）。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'key', type: 'string', required: true, description: '键名' },
    ],
  },

  // MongoDB 批量操作
  {
    name: 'mongo_update_many',
    category: 'MongoDB 批量操作',
    description: '更新集合中匹配 filter 的所有文档。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'filter_json', type: 'string', required: true, description: 'JSON 对象字符串' },
      { name: 'update_json', type: 'string', required: true, description: 'JSON 对象字符串' },
    ],
  },
  {
    name: 'mongo_delete_many',
    category: 'MongoDB 批量操作',
    description: '删除集合中匹配 filter 的所有文档。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'filter_json', type: 'string', required: true, description: 'JSON 对象字符串' },
    ],
  },
  {
    name: 'mongo_find_one_and_update',
    category: 'MongoDB 高级操作',
    description: '查找并更新单个文档。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'filter_json', type: 'string', required: true, description: 'JSON 对象字符串' },
      { name: 'update_json', type: 'string', required: true, description: 'JSON 对象字符串' },
      { name: 'upsert', type: 'boolean', required: false, description: '如果为 true，当没有匹配文档时插入新文档' },
      { name: 'returnDocument', type: 'string', required: false, description: '返回更新前还是更新后的文档' },
    ],
  },
  {
    name: 'mongo_find_one_and_delete',
    category: 'MongoDB 高级操作',
    description: '查找并删除单个文档。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'filter_json', type: 'string', required: true, description: 'JSON 对象字符串' },
    ],
  },
  {
    name: 'mongo_drop_collection',
    category: 'MongoDB 集合管理',
    description: '删除集合。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
    ],
  },
  {
    name: 'mongo_rename_collection',
    category: 'MongoDB 集合管理',
    description: '重命名集合。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'collection', type: 'string', required: true, description: '集合名称' },
      { name: 'newName', type: 'string', required: true, description: '新集合名称' },
    ],
  },

  // SQL 存储过程
  {
    name: 'sql_call_procedure',
    category: 'SQL 存储过程',
    description: '调用存储过程。支持 MySQL/PostgreSQL/MSSQL/Oracle。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'procedure', type: 'string', required: true, description: '存储过程名称' },
      { name: 'params', type: 'array', required: false, description: '参数数组' },
    ],
  },

  // SQL 视图
  {
    name: 'sql_list_views',
    category: 'SQL 视图',
    description: '列出当前连接下的视图名。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'schema', type: 'string', required: false, description: 'Schema 名称（PostgreSQL）' },
    ],
  },
  {
    name: 'sql_describe_view',
    category: 'SQL 视图',
    description: '查看视图结构（列、类型）。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'view', type: 'string', required: true, description: '视图名称' },
      { name: 'schema', type: 'string', required: false, description: 'Schema 名称（PostgreSQL）' },
    ],
  },

  // SQL 索引
  {
    name: 'sql_list_indexes',
    category: 'SQL 索引',
    description: '列出表的索引。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'table', type: 'string', required: true, description: '表名' },
      { name: 'schema', type: 'string', required: false, description: 'Schema 名称（PostgreSQL）' },
    ],
  },
  {
    name: 'sql_create_index',
    category: 'SQL 索引',
    description: '为表创建索引。只读连接拒绝。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'table', type: 'string', required: true, description: '表名' },
      { name: 'columns', type: 'array', required: true, description: '索引列名数组' },
      { name: 'unique', type: 'boolean', required: false, description: '是否唯一索引' },
      { name: 'indexName', type: 'string', required: false, description: '索引名称' },
    ],
  },
  {
    name: 'sql_generate_types',
    category: 'SQL 类型生成',
    description: '从表结构生成 TypeScript 接口定义，返回可直接使用的 TS 类型代码。',
    params: [
      { name: 'connection_id', type: 'string', required: false, description: '连接 id；缺省为默认连接' },
      { name: 'table', type: 'string', required: true, description: '表名' },
      { name: 'schema', type: 'string', required: false, description: 'PostgreSQL schema' },
    ],
  },

  // 数据脱敏
  {
    name: 'set_masking_mode',
    category: '数据脱敏',
    description: '设置数据脱敏模式。off=关闭，loose=值匹配，strict=字段名匹配，strict-v2=字段名和值双重匹配。',
    params: [
      { name: 'mode', type: 'string', required: true, description: 'off / loose / strict / strict-v2' },
      { name: 'enabled', type: 'boolean', required: false, description: '是否启用脱敏' },
      { name: 'excludeFields', type: 'array', required: false, description: '白名单字段列表' },
      { name: 'excludeConnections', type: 'array', required: false, description: '排除的连接 ID 列表' },
    ],
  },
  {
    name: 'get_masking_config',
    category: '数据脱敏',
    description: '获取当前数据脱敏配置，包括模式、规则列表和白名单字段。',
    params: [],
  },
  {
    name: 'manage_masking_rules',
    category: '数据脱敏',
    description: '管理自定义脱敏规则。支持 add、remove、list。',
    params: [
      { name: 'action', type: 'string', required: true, description: 'add / remove / list' },
      { name: 'name', type: 'string', required: false, description: '规则名称' },
      { name: 'fieldPattern', type: 'string', required: false, description: '字段名正则' },
      { name: 'valuePattern', type: 'string', required: false, description: '值正则' },
      { name: 'replacement', type: 'string', required: false, description: '替换字符串' },
    ],
  },

  // 查询回放
  {
    name: 'query_history',
    category: '查询回放',
    description: '获取最近的查询历史记录，返回 SQL、参数摘要、执行时间和结果摘要。',
    params: [
      { name: 'limit', type: 'number', required: false, description: '返回记录数，默认 20' },
      { name: 'connectionId', type: 'string', required: false, description: '按连接 ID 过滤' },
    ],
  },
  {
    name: 'query_replay',
    category: '查询回放',
    description: '重新执行历史记录中的只读查询。',
    params: [
      { name: 'queryId', type: 'string', required: true, description: '要回放的查询 ID' },
      { name: 'connectionId', type: 'string', required: false, description: '使用指定连接执行' },
    ],
  },
  {
    name: 'query_diff',
    category: '查询回放',
    description: '对比两次查询结果的采样差异。',
    params: [
      { name: 'queryIdA', type: 'string', required: true, description: '第一个查询 ID' },
      { name: 'queryIdB', type: 'string', required: true, description: '第二个查询 ID' },
    ],
  },

  // 智能查询建议
  {
    name: 'query_suggest',
    category: '智能查询建议',
    description: '对 SQL 进行静态分析，返回优化建议和索引建议。',
    params: [
      { name: 'sql', type: 'string', required: true, description: '要分析的 SQL 查询' },
      { name: 'connectionId', type: 'string', required: false, description: '连接 ID，用于获取表结构' },
    ],
  },
  {
    name: 'query_optimize',
    category: '智能查询建议',
    description: '结合 SQL 静态分析和 EXPLAIN 执行计划，返回全面优化建议。',
    params: [
      { name: 'sql', type: 'string', required: true, description: '要分析的 SQL 查询' },
      { name: 'connectionId', type: 'string', required: false, description: '连接 ID，用于执行 EXPLAIN' },
    ],
  },

  // 服务器信息
  {
    name: 'server_info',
    category: '服务器信息',
    description: '返回服务器版本、运行时间、工具数量等信息。',
    params: [],
  },
];

// 生成 Markdown 文档
function generateMarkdown(tools) {
  const categories = [...new Set(tools.map(t => t.category))];

  let md = `# polyglot-db-mcp-server API 文档

> 自动生成于 ${new Date().toISOString()}

## 目录

`;

  // 生成目录
  categories.forEach(cat => {
    md += `- [${cat}](#${cat.toLowerCase().replace(/\s+/g, '-')})\n`;
  });

  md += '\n- [通用错误与诊断](#通用错误与诊断)\n';
  md += '- [传输模式](#传输模式)\n';
  md += '\n---\n\n';

  md += `## 传输模式

默认传输仍为 \`stdio\`。设置 \`DB_MCP_TRANSPORT=http\` 或启动参数 \`--transport http\` 后启用 Streamable HTTP。

| Endpoint | Method | 说明 |
|----------|--------|------|
| \`/mcp\` | POST | MCP Streamable HTTP JSON-RPC endpoint |
| \`/mcp\` | GET/DELETE | v1.8.0 返回 405，SSE/resumability 后续实现 |
| \`/healthz\` | GET | 进程健康检查 |
| \`/readyz\` | GET | registry 和启动 ping readiness |

HTTP 安全默认值：

- 默认监听 \`127.0.0.1\`。
- 监听非本地地址时必须设置 \`DB_HTTP_API_KEY\`，除非显式 \`DB_HTTP_AUTH_DISABLED=true\`。
- API key 支持 \`Authorization: Bearer <key>\` 和 \`x-api-key\`。
- \`DB_HTTP_ORIGINS\` 是 Origin allowlist；请求带 Origin 且不匹配时返回 \`HTTP_001\`。

---

`;

  md += `## 通用错误与诊断

工具错误可能返回纯文本，也可能返回包含 \`error_info\` 的 JSON。新增或结构化后的错误遵循：

\`\`\`json
{
  "error": "简短错误",
  "error_info": {
    "code": "CONN_006",
    "message": "未知的 connection_id",
    "hint": "可用连接: local",
    "severity": "error",
    "retryable": false
  }
}
\`\`\`

常见错误码：

| Code | 场景 | 处理入口 |
|------|------|----------|
| \`CONN_006\` | 未知 connection_id | 调用 \`list_connections\` 或 \`connection_diagnose\` |
| \`SQL_002\` | 只读查询或只读连接拒绝写入 | 使用只读 SQL，或配置独立 \`readonly:false\` 写连接 |
| \`MONGO_003\` | NoSQL 注入风险 | 移除危险 operator，改用安全 filter |
| \`REDIS_002\` | Redis keyPrefix 不匹配 | 确认 key 以配置前缀开头 |
| \`CFG_001\` | 未配置 DB_MCP_CONNECTIONS | 运行 \`polyglot-db-mcp-server init\` |

完整错误码矩阵见 \`docs/ERRORS.md\`。

---

`;

  // 按类别生成文档
  categories.forEach(cat => {
    md += `## ${cat}\n\n`;
    const categoryTools = tools.filter(t => t.category === cat);

    categoryTools.forEach(tool => {
      md += `### \`${tool.name}\`\n\n`;
      md += `${tool.description}\n\n`;

      if (tool.params.length > 0) {
        md += '**参数：**\n\n';
        md += '| 参数名 | 类型 | 必填 | 说明 |\n';
        md += '|--------|------|------|------|\n';
        tool.params.forEach(p => {
          md += `| \`${p.name}\` | ${p.type} | ${p.required ? '是' : '否'} | ${p.description} |\n`;
        });
        md += '\n';
      }

      md += '---\n\n';
    });
  });

  return md;
}

// 生成文档
const markdown = generateMarkdown(tools);

// 确保 docs 目录存在
try {
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
} catch {
  // 目录已存在
}

// 写入文件
writeFileSync(join(ROOT, 'docs', 'API.md'), markdown);
console.log('API 文档已生成: docs/API.md');

// 输出统计
console.log(`\n统计:`);
console.log(`  - 工具总数: ${tools.length}`);
const categories = [...new Set(tools.map(t => t.category))];
categories.forEach(cat => {
  const count = tools.filter(t => t.category === cat).length;
  console.log(`  - ${cat}: ${count} 个工具`);
});
