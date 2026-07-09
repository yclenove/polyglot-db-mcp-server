# polyglot-db-mcp-server API 文档

> 自动生成于 2026-07-09T19:37:04.013Z

## 目录

- [连接管理](#连接管理)
- [SQL](#sql)
- [MongoDB](#mongodb)
- [MongoDB 事务](#mongodb-事务)
- [Redis](#redis)
- [审计](#审计)
- [Schema](#schema)
- [Redis List](#redis-list)
- [Redis Set](#redis-set)
- [Redis Sorted Set](#redis-sorted-set)
- [Redis 键管理](#redis-键管理)
- [MongoDB 批量操作](#mongodb-批量操作)
- [MongoDB 高级操作](#mongodb-高级操作)
- [MongoDB 集合管理](#mongodb-集合管理)
- [SQL 存储过程](#sql-存储过程)
- [SQL 视图](#sql-视图)
- [SQL 索引](#sql-索引)
- [SQL 类型生成](#sql-类型生成)
- [数据脱敏](#数据脱敏)
- [查询回放](#查询回放)
- [智能查询建议](#智能查询建议)
- [认证与授权](#认证与授权)
- [服务器信息](#服务器信息)

- [通用错误与诊断](#通用错误与诊断)
- [传输模式](#传输模式)

---

## 传输模式

默认传输仍为 `stdio`。设置 `DB_MCP_TRANSPORT=http` 或启动参数 `--transport http` 后启用 Streamable HTTP。

| Endpoint | Method | 说明 |
|----------|--------|------|
| `/mcp` | POST | MCP Streamable HTTP JSON-RPC endpoint |
| `/mcp` | GET/DELETE | v1.8.0 返回 405，SSE/resumability 后续实现 |
| `/healthz` | GET | 进程健康检查 |
| `/readyz` | GET | registry 和启动 ping readiness |

HTTP 安全默认值：

- 默认监听 `127.0.0.1`。
- 监听非本地地址时必须设置 `DB_HTTP_API_KEY`，除非显式 `DB_HTTP_AUTH_DISABLED=true`。
- API key 支持 `Authorization: Bearer <key>` 和 `x-api-key`。
- `DB_HTTP_ORIGINS` 是 Origin allowlist；请求带 Origin 且不匹配时返回 `HTTP_001`。

---

## 通用错误与诊断

工具错误可能返回纯文本，也可能返回包含 `error_info` 的 JSON。新增或结构化后的错误遵循：

```json
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
```

常见错误码：

| Code | 场景 | 处理入口 |
|------|------|----------|
| `CONN_006` | 未知 connection_id | 调用 `list_connections` 或 `connection_diagnose` |
| `SQL_002` | 只读查询或只读连接拒绝写入 | 使用只读 SQL，或配置独立 `readonly:false` 写连接 |
| `MONGO_003` | NoSQL 注入风险 | 移除危险 operator，改用安全 filter |
| `REDIS_002` | Redis keyPrefix 不匹配 | 确认 key 以配置前缀开头 |
| `CFG_001` | 未配置 DB_MCP_CONNECTIONS | 运行 `polyglot-db-mcp-server init` |

完整错误码矩阵见 `docs/ERRORS.md`。

---

## 连接管理

### `list_connections`

列出 DB_MCP_CONNECTIONS 中所有 connection_id、engine 与是否只读

---

### `validate_connection_config`

验证 DB_MCP_CONNECTIONS JSON 配置的合法性，返回解析结果或错误详情。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `config_json` | string | 是 | DB_MCP_CONNECTIONS 的 JSON 字符串 |

---

### `test_connection`

对指定 connection_id 执行 ping（缺省使用 DB_MCP_DEFAULT_CONNECTION_ID 或第一条）

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |

---

### `health_check`

执行全面的健康检查，测试所有连接的状态和延迟。

---

### `connection_diagnose`

全面诊断所有连接的健康状况，返回状态、延迟、版本信息、错误码和配置建议。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 指定连接 ID；不传则诊断所有连接 |

---

### `connection_stats`

返回各连接的统计信息，包括总请求数、审计统计和性能指标。

---

### `prometheus_metrics`

返回 Prometheus 文本格式指标，可用于监控系统集成。

---

## SQL

### `sql_query`

在 SQL 连接（mysql/postgres/mssql/oracle/sqlite/duckdb）上执行只读查询。支持分页。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `sql` | string | 是 | SQL 查询语句 |
| `params` | array | 否 | 查询参数 |
| `limit` | number | 否 | 最大返回行数 |
| `page` | number | 否 | 页码，从 1 开始 |
| `page_size` | number | 否 | 每页行数，默认 20 |

---

### `sql_export_query`

执行只读 SQL 并将脱敏后的结果导出为 JSON、CSV 或 Markdown，最大 10000 行。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `sql` | string | 是 | SQL 查询语句，必须为只读 |
| `params` | array | 否 | 查询参数 |
| `format` | string | 否 | json、csv 或 markdown；默认 json |
| `limit` | number | 否 | 最大导出行数，最大 10000 |

---

### `sql_sample_table`

对 SQL 表执行只读采样，返回字段类型、空值率、唯一值数量、示例值和数值范围。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `table` | string | 是 | 表名 |
| `schema` | string | 否 | Schema 名称 |
| `sample_size` | number | 否 | 采样行数，默认 DB_MAX_ROWS，最大 10000 |

---

### `sql_execute`

在 SQL 连接上执行写入类 SQL（INSERT/UPDATE/DELETE 等）。受危险语句规则约束；若连接 readonly=true 则拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `sql` | string | 是 | SQL 语句 |
| `params` | array | 否 | 查询参数 |

---

### `sql_list_tables`

列出当前连接下的表名（按引擎使用系统目录）。可选 schema（主要给 PostgreSQL）。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `schema` | string | 否 | Schema 名称（PostgreSQL） |

---

### `sql_describe_table`

查看表结构（列、类型）。PostgreSQL 可传 schema，默认 public。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `table` | string | 是 | 表名 |
| `schema` | string | 否 | Schema 名称（PostgreSQL） |

---

### `sql_begin_transaction`

在 SQL 连接上开始一个新事务。返回事务 ID。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |

---

### `sql_execute_in_transaction`

在事务中执行 SQL。需要先调用 sql_begin_transaction 获取 transaction_id。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `transaction_id` | string | 是 | 事务 ID |
| `sql` | string | 是 | SQL 语句 |
| `params` | array | 否 | 查询参数 |

---

### `sql_commit`

提交事务，使所有更改永久生效。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `transaction_id` | string | 是 | 事务 ID |

---

### `sql_rollback`

回滚事务，撤销所有未提交的更改。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `transaction_id` | string | 是 | 事务 ID |

---

### `sql_batch_execute`

在单个事务中批量执行多条 SQL。要么全部成功，要么全部回滚。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `statements` | array | 是 | SQL 语句数组，每项含 sql 和可选 params |

---

### `sql_explain`

返回 SQL 查询的执行计划。支持 MySQL/PostgreSQL/MSSQL/Oracle。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `sql` | string | 是 | 要分析的 SQL 查询（SELECT 语句） |

---

### `sql_cache_stats`

返回查询缓存的统计信息（大小、配置、命中率）。通过 DB_QUERY_CACHE_SIZE 启用缓存。

---

## MongoDB

### `mongo_list_collections`

列出 MongoDB 数据库中的集合名称

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |

---

### `mongo_find`

在集合上执行 find。filter 为 JSON 对象；limit 默认 50，最大 500。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `filter_json` | string | 否 | JSON 对象字符串，默认 {} |
| `limit` | number | 否 | 最大返回行数，默认 50 |
| `skip` | number | 否 | 跳过行数 |

---

### `mongo_aggregate`

对集合执行聚合管道。pipeline_json 为 JSON 数组字符串。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `pipeline_json` | string | 是 | JSON 数组字符串 |

---

### `mongo_count`

统计集合文档数，filter_json 可选

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `filter_json` | string | 否 | JSON 对象字符串 |

---

### `mongo_insert_one`

向集合插入单个文档。document_json 为 JSON 对象字符串。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `document_json` | string | 是 | JSON 对象字符串 |

---

### `mongo_insert_many`

向集合插入多个文档。documents_json 为 JSON 数组字符串。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `documents_json` | string | 是 | JSON 数组字符串 |

---

### `mongo_update_one`

更新集合中匹配 filter 的单个文档。update_json 须包含 $set 等更新操作符。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `filter_json` | string | 是 | JSON 对象字符串 |
| `update_json` | string | 是 | JSON 对象字符串 |
| `upsert` | boolean | 否 | 如果为 true，当没有匹配文档时插入新文档 |

---

### `mongo_delete_one`

删除集合中匹配 filter 的单个文档。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `filter_json` | string | 是 | JSON 对象字符串 |

---

### `mongo_list_indexes`

列出集合的所有索引。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |

---

### `mongo_create_index`

为集合创建索引。keys_json 为 JSON 对象，如 {"name": 1} 表示升序。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `keys_json` | string | 是 | 索引键定义 |
| `name` | string | 否 | 索引名称 |
| `unique` | boolean | 否 | 是否唯一索引 |
| `sparse` | boolean | 否 | 是否稀疏索引 |

---

### `mongo_schema_analysis`

分析集合的文档结构，采样文档并合并字段路径和类型。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `sample_size` | number | 否 | 采样文档数，默认 100，最大 1000 |

---

## MongoDB 事务

### `mongo_begin_transaction`

开始 MongoDB 多文档事务，返回 transaction_id。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |

---

### `mongo_execute_in_transaction`

在 MongoDB 事务中执行一个受控写操作。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `transaction_id` | string | 是 | 事务 ID |
| `operation` | string | 是 | insert_one / insert_many / update_one / update_many / delete_one / delete_many |
| `collection` | string | 是 | 集合名称 |
| `document_json` | string | 否 | insert_one 使用的 JSON 对象 |
| `documents_json` | string | 否 | insert_many 使用的 JSON 对象数组 |
| `filter_json` | string | 否 | update/delete 使用的 JSON filter |
| `update_json` | string | 否 | update 使用的 JSON 更新对象 |
| `upsert` | boolean | 否 | update_one 可选 upsert |

---

### `mongo_commit`

提交 MongoDB 事务。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `transaction_id` | string | 是 | 事务 ID |

---

### `mongo_rollback`

回滚 MongoDB 事务。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `transaction_id` | string | 是 | 事务 ID |

---

## Redis

### `redis_get`

读取 Redis 字符串键值。遵守连接 keyPrefix。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

### `redis_set`

写入 Redis 字符串键。只读连接拒绝。可选 ttl_seconds。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `value` | string | 是 | 值 |
| `ttl_seconds` | number | 否 | 过期时间（秒） |

---

### `redis_del`

删除 Redis 键。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

### `redis_scan`

使用 SCAN 迭代键（禁止 KEYS）。cursor 首次传 "0"；match 支持 glob。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `match` | string | 否 | 匹配模式，默认 * |
| `cursor` | string | 否 | 游标，默认 0 |
| `count` | number | 否 | 每次迭代数量，默认 100 |

---

### `redis_blocked_commands`

列出本服务默认禁止执行的 Redis 命令名。

---

### `redis_pipeline`

批量执行安全 Redis 命令子集。遵守 keyPrefix、readonly 和阻断命令规则。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `commands_json` | string | 是 | 命令 JSON 数组，每项包含 command、key、args |

---

### `redis_type`

返回 Redis 键的数据类型（string/hash/list/set/zset/stream/none）。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

### `redis_hget`

获取 Redis Hash 中指定字段的值。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `field` | string | 是 | 字段名 |

---

### `redis_hset`

设置 Redis Hash 中指定字段的值。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `field` | string | 是 | 字段名 |
| `value` | string | 是 | 值 |

---

### `redis_hgetall`

获取 Redis Hash 的所有字段和值。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

### `redis_hdel`

删除 Redis Hash 中指定字段。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `field` | string | 是 | 字段名 |

---

## 审计

### `audit_get_recent`

获取最近的审计日志。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `limit` | number | 否 | 返回数量，默认 50 |

---

### `audit_filter`

按条件过滤审计日志。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id |
| `tool` | string | 否 | 工具名称 |
| `success` | boolean | 否 | 是否成功 |
| `since` | string | 否 | 开始时间（ISO 8601） |
| `until` | string | 否 | 结束时间（ISO 8601） |
| `limit` | number | 否 | 返回数量 |

---

### `audit_stats`

获取审计统计信息。

---

### `export_audit`

导出审计日志，支持 JSON 格式，可按时间范围和数量限制过滤。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `format` | string | 否 | 导出格式，默认 json |
| `limit` | number | 否 | 最大导出条数，默认 1000 |
| `since` | string | 否 | 起始时间（ISO 8601） |

---

## Schema

### `schema_export`

导出数据库 Schema 为 JSON 或 SQL DDL 格式。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `format` | string | 否 | 输出格式：json 或 sql，默认 json |
| `schema` | string | 否 | Schema 名称（PostgreSQL） |

---

### `schema_diff`

比较两个 SQL 连接或 schema 的表结构差异，返回新增、删除和变更的表/列。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `source_connection_id` | string | 是 | 源连接 id |
| `target_connection_id` | string | 是 | 目标连接 id |
| `source_schema` | string | 否 | 源 schema（PostgreSQL） |
| `target_schema` | string | 否 | 目标 schema（PostgreSQL） |

---

## Redis List

### `redis_lpush`

向 Redis List 头部插入一个或多个元素。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `values` | array | 是 | 要插入的值数组 |

---

### `redis_rpush`

向 Redis List 尾部插入一个或多个元素。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `values` | array | 是 | 要插入的值数组 |

---

### `redis_lpop`

移除并返回 Redis List 头部元素。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

### `redis_rpop`

移除并返回 Redis List 尾部元素。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

### `redis_lrange`

返回 Redis List 中指定范围的元素。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `start` | number | 是 | 起始索引 |
| `stop` | number | 是 | 结束索引 |

---

### `redis_llen`

返回 Redis List 的长度。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

## Redis Set

### `redis_sadd`

向 Redis Set 添加一个或多个成员。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `members` | array | 是 | 要添加的成员数组 |

---

### `redis_smembers`

返回 Redis Set 的所有成员。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

### `redis_srem`

从 Redis Set 移除一个或多个成员。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `members` | array | 是 | 要移除的成员数组 |

---

### `redis_scard`

返回 Redis Set 的成员数量。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

### `redis_sismember`

检查成员是否存在于 Redis Set 中。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `member` | string | 是 | 成员名 |

---

## Redis Sorted Set

### `redis_zadd`

向 Redis Sorted Set 添加成员及其分数。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `score` | number | 是 | 分数 |
| `member` | string | 是 | 成员 |

---

### `redis_zrange`

返回 Redis Sorted Set 中指定范围的成员。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `start` | number | 是 | 起始索引 |
| `stop` | number | 是 | 结束索引 |
| `withScores` | boolean | 否 | 是否返回分数 |

---

### `redis_zrem`

从 Redis Sorted Set 移除一个或多个成员。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `members` | array | 是 | 要移除的成员数组 |

---

### `redis_zcard`

返回 Redis Sorted Set 的成员数量。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

### `redis_zscore`

返回 Redis Sorted Set 中指定成员的分数。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `member` | string | 是 | 成员名 |

---

## Redis 键管理

### `redis_expire`

设置 Redis 键的过期时间（秒）。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |
| `seconds` | number | 是 | 过期时间（秒） |

---

### `redis_ttl`

返回 Redis 键的剩余过期时间（秒）。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `key` | string | 是 | 键名 |

---

## MongoDB 批量操作

### `mongo_update_many`

更新集合中匹配 filter 的所有文档。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `filter_json` | string | 是 | JSON 对象字符串 |
| `update_json` | string | 是 | JSON 对象字符串 |

---

### `mongo_delete_many`

删除集合中匹配 filter 的所有文档。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `filter_json` | string | 是 | JSON 对象字符串 |

---

## MongoDB 高级操作

### `mongo_find_one_and_update`

查找并更新单个文档。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `filter_json` | string | 是 | JSON 对象字符串 |
| `update_json` | string | 是 | JSON 对象字符串 |
| `upsert` | boolean | 否 | 如果为 true，当没有匹配文档时插入新文档 |
| `returnDocument` | string | 否 | 返回更新前还是更新后的文档 |

---

### `mongo_find_one_and_delete`

查找并删除单个文档。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `filter_json` | string | 是 | JSON 对象字符串 |

---

## MongoDB 集合管理

### `mongo_drop_collection`

删除集合。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |

---

### `mongo_rename_collection`

重命名集合。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `collection` | string | 是 | 集合名称 |
| `newName` | string | 是 | 新集合名称 |

---

## SQL 存储过程

### `sql_call_procedure`

调用存储过程。支持 MySQL/PostgreSQL/MSSQL/Oracle。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `procedure` | string | 是 | 存储过程名称 |
| `params` | array | 否 | 参数数组 |

---

## SQL 视图

### `sql_list_views`

列出当前连接下的视图名。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `schema` | string | 否 | Schema 名称（PostgreSQL） |

---

### `sql_describe_view`

查看视图结构（列、类型）。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `view` | string | 是 | 视图名称 |
| `schema` | string | 否 | Schema 名称（PostgreSQL） |

---

## SQL 索引

### `sql_list_indexes`

列出表的索引。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `table` | string | 是 | 表名 |
| `schema` | string | 否 | Schema 名称（PostgreSQL） |

---

### `sql_create_index`

为表创建索引。只读连接拒绝。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `table` | string | 是 | 表名 |
| `columns` | array | 是 | 索引列名数组 |
| `unique` | boolean | 否 | 是否唯一索引 |
| `indexName` | string | 否 | 索引名称 |

---

## SQL 类型生成

### `sql_generate_types`

从表结构生成 TypeScript 接口定义，返回可直接使用的 TS 类型代码。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 连接 id；缺省为默认连接 |
| `table` | string | 是 | 表名 |
| `schema` | string | 否 | PostgreSQL schema |

---

## 数据脱敏

### `set_masking_mode`

设置数据脱敏模式。off=关闭，loose=值匹配，strict=字段名匹配，strict-v2=字段名和值双重匹配。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `mode` | string | 是 | off / loose / strict / strict-v2 |
| `enabled` | boolean | 否 | 是否启用脱敏 |
| `excludeFields` | array | 否 | 白名单字段列表 |
| `excludeConnections` | array | 否 | 排除的连接 ID 列表 |

---

### `get_masking_config`

获取当前数据脱敏配置，包括模式、规则列表和白名单字段。

---

### `manage_masking_rules`

管理自定义脱敏规则。支持 add、remove、list。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `action` | string | 是 | add / remove / list |
| `name` | string | 否 | 规则名称 |
| `fieldPattern` | string | 否 | 字段名正则 |
| `valuePattern` | string | 否 | 值正则 |
| `replacement` | string | 否 | 替换字符串 |

---

## 查询回放

### `query_history`

获取最近的查询历史记录，返回 SQL、参数摘要、执行时间和结果摘要。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `limit` | number | 否 | 返回记录数，默认 20 |
| `connectionId` | string | 否 | 按连接 ID 过滤 |

---

### `query_replay`

重新执行历史记录中的只读查询。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `queryId` | string | 是 | 要回放的查询 ID |
| `connectionId` | string | 否 | 使用指定连接执行 |

---

### `query_diff`

对比两次查询结果的采样差异。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `queryIdA` | string | 是 | 第一个查询 ID |
| `queryIdB` | string | 是 | 第二个查询 ID |

---

## 智能查询建议

### `query_suggest`

对 SQL 进行静态分析，返回优化建议和索引建议。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `sql` | string | 是 | 要分析的 SQL 查询 |
| `connectionId` | string | 否 | 连接 ID，用于获取表结构 |

---

### `query_optimize`

结合 SQL 静态分析和 EXPLAIN 执行计划，返回全面优化建议。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `sql` | string | 是 | 要分析的 SQL 查询 |
| `connectionId` | string | 否 | 连接 ID，用于执行 EXPLAIN |

---

## 认证与授权

### `auth_whoami`

返回当前认证主体、tenant、scope 和 token roles。不会返回 token 原文。

---

### `auth_policy_validate`

验证 RBAC policy JSON，返回版本、角色和绑定数量。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `policy_json` | string | 是 | RBAC policy JSON 字符串 |

---

## 服务器信息

### `server_info`

返回服务器版本、运行时间、工具数量等信息。

---

