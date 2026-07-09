# polyglot-db-mcp-server API 文档

> 自动生成于 2026-05-05T05:38:22.754Z

## 目录

- [连接管理](#连接管理)
- [SQL](#sql)
- [MongoDB](#mongodb)
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
- [服务器信息](#服务器信息)
- [数据脱敏](#数据脱敏)
- [查询回放](#查询回放)
- [智能查询建议](#智能查询建议)
- [智能查询建议](#智能查询建议)

---

## 连接管理

### `list_connections`

列出 DB_MCP_CONNECTIONS 中所有 connection_id、engine 与是否只读

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

### `connection_stats`

返回各连接的统计信息，包括总请求数、审计统计和性能指标。

---

## SQL

### `sql_query`

在 SQL 连接（mysql/postgres/mssql/oracle）上执行只读查询。支持分页。

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

导出审计日志为 JSON 格式。支持按时间范围、连接、工具名称过滤，单次最多导出 1000 条。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `connection_id` | string | 否 | 按连接 ID 过滤 |
| `tool` | string | 否 | 按工具名称过滤 |
| `since` | string | 否 | 开始时间（ISO 8601） |
| `until` | string | 否 | 结束时间（ISO 8601） |
| `limit` | number | 否 | 最大导出条数，默认 1000 |

**返回值示例：**

```json
{
  "count": 42,
  "records": [
    {
      "timestamp": "2026-05-05T10:30:00.000Z",
      "connectionId": "pg",
      "tool": "sql_query",
      "success": true,
      "duration": 12
    }
  ]
}
```

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

## 服务器信息

### `server_info`

返回服务器版本、运行时间、工具数量等信息。

---

## 数据脱敏

### `set_masking_mode`

设置数据脱敏模式。`strict` 模式对所有匹配字段脱敏；`strict-v2` 模式同时匹配字段名和值正则，提升精度；`loose` 模式仅对明确匹配值正则的字段脱敏；`off` 关闭脱敏。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `mode` | string | 是 | 脱敏模式：strict / strict-v2 / loose / off |
| `enabled` | boolean | 否 | 是否启用脱敏，默认 true |
| `excludeFields` | array | 否 | 白名单字段列表，这些字段不脱敏 |
| `excludeConnections` | array | 否 | 排除的连接 ID 列表 |

**返回值示例：**

```json
{
  "mode": "strict",
  "enabled": true,
  "rulesCount": 6
}
```

**使用示例：**

```json
{
  "mode": "strict",
  "excludeFields": ["phone", "display_name"]
}
```

---

### `get_masking_config`

获取当前数据脱敏配置，包括模式、启用状态、内置规则列表和白名单字段。

**参数：**

无。

**返回值示例：**

```json
{
  "mode": "strict",
  "enabled": true,
  "rules": ["phone", "email", "id_card", "credit_card", "bank_card", "ip_address"],
  "excludeFields": ["phone"],
  "excludeConnections": []
}
```

---

### `manage_masking_rules`

管理自定义脱敏规则。支持添加、删除、列出规则。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `action` | string | 是 | 操作：add / remove / list |
| `name` | string | 否 | 规则名称（add/remove 时必填） |
| `fieldPattern` | string | 否 | 字段名正则（add 时必填） |
| `valuePattern` | string | 否 | 值正则（add 时必填） |

**返回值示例（list）：**

```json
{
  "rules": [
    {
      "name": "custom_phone",
      "fieldPattern": "^(mobile|cellphone)$",
      "valuePattern": "^1[3-9]\\d{9}$"
    }
  ]
}
```

---

## 查询回放

### `query_history`

查询历史记录列表。返回最近执行的查询摘要（含 SQL、参数、执行时间、结果行数等），不包含完整结果集。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `limit` | number | 否 | 返回条数，默认 20 |
| `connectionId` | string | 否 | 按连接 ID 过滤 |

**返回值示例：**

```json
[
  {
    "id": "q-001",
    "timestamp": "2026-05-05T10:30:00.000Z",
    "connectionId": "pg",
    "engine": "postgres",
    "sql": "SELECT * FROM users WHERE id = $1",
    "params": [42],
    "resultSummary": { "rowCount": 1, "fields": ["id", "name", "email"], "sampleRows": [] },
    "executionTime": 12,
    "success": true
  }
]
```

---

### `query_replay`

回放指定历史查询。根据历史记录中的 SQL 和参数重新执行查询，返回完整结果。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `queryId` | string | 是 | 历史查询 ID |

**返回值示例：**

```json
{
  "queryId": "q-001",
  "replayedAt": "2026-05-05T11:00:00.000Z",
  "rows": [{ "id": 42, "name": "Alice", "email": "alice@example.com" }],
  "rowCount": 1,
  "executionTime": 8
}
```

---

### `query_diff`

对比两次查询结果的行级差异。返回新增、删除、修改的行数及具体差异详情。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `queryIdA` | string | 是 | 基准查询 ID |
| `queryIdB` | string | 是 | 对比查询 ID |

**返回值示例：**

```json
{
  "added": 2,
  "removed": 0,
  "modified": 1,
  "details": [
    { "field": "name", "old": "Alice", "new": "Alice Smith" }
  ]
}
```

---

## 智能查询建议

### `query_suggest`

获取查询优化建议。基于 SQL 静态分析（SELECT * 检测、缺少 WHERE、LIKE 前缀通配等）和表结构信息，返回索引、重写、性能、安全方面的建议。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `sql` | string | 是 | 要分析的 SQL 查询 |
| `connectionId` | string | 否 | 连接 id；缺省为默认连接 |

**返回值示例：**

```json
[
  {
    "type": "index",
    "severity": "warn",
    "message": "WHERE 子句中的 email 列没有索引，建议创建索引以提升查询性能",
    "suggestedSql": "CREATE INDEX idx_users_email ON users (email)"
  },
  {
    "type": "rewrite",
    "severity": "info",
    "message": "建议指定需要的列名，避免使用 SELECT *"
  }
]
```

---

### `query_optimize`

分析慢查询并给出优化建议。先获取执行计划（EXPLAIN），再结合规则引擎分析全表扫描、未使用索引、filesort、临时表等问题。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `sql` | string | 是 | 要分析的 SQL 查询（SELECT 语句） |
| `connectionId` | string | 否 | 连接 id；缺省为默认连接 |

**返回值示例：**

```json
{
  "sql": "SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at",
  "suggestions": [
    {
      "type": "performance",
      "severity": "critical",
      "message": "检测到全表扫描（type=ALL），建议为 status 列创建索引",
      "suggestedSql": "CREATE INDEX idx_orders_status ON orders (status)"
    }
  ],
  "executionPlan": [
    { "id": 1, "select_type": "SIMPLE", "table": "orders", "type": "ALL", "rows": 50000 }
  ]
}
```

---

