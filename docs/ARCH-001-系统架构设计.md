# ARCH-001 系统架构设计

> 初稿，待确认 | 版本：v1.4.0 | 日期：2026-05-05

---

## 1. 系统概述

**一句话定位：** polyglot-db-mcp-server 是一个基于 Model Context Protocol (MCP) 的多引擎数据库统一接入层，通过 stdio 传输为 AI 助手提供对 MySQL、PostgreSQL、MSSQL、Oracle、MongoDB、Redis 六种数据库的安全操作能力。

### ASCII 架构图

```
+------------------------------------------------------------------+
|                        MCP Client (AI 助手)                       |
+------------------------------------------------------------------+
         |  stdio (JSON-RPC 2.0)
         v
+------------------------------------------------------------------+
|  index.ts (入口)                                                  |
|  +--------------------------------------------------------------+ |
|  | server.ts (McpServer)                                         | |
|  |  +-- registerConnectionTools()    -- 连接管理 (6 tools)        | |
|  |  +-- registerSqlTools()           -- SQL 操作 (15 tools)       | |
|  |  +-- registerMongoTools()         -- MongoDB 操作 (14 tools)   | |
|  |  +-- registerRedisTools()         -- Redis 操作 (22 tools)     | |
|  |  +-- registerSchemaTools()        -- Schema 导出 (1 tool)      | |
|  |  +-- registerAuditTools()         -- 审计日志 (3 tools)        | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
         |
         v
+------------------------------------------------------------------+
|  core/ (核心层)                                                    |
|  +-----------+ +----------+ +------------+ +---------+ +--------+ |
|  | registry  | | config   | | sql-guards | | audit   | | logger | |
|  | 连接注册表 | | 环境配置  | | SQL 安全守卫| | 审计日志 | | 结构化  | |
|  +-----------+ +----------+ +------------+ +---------+ +--------+ |
|  +-----------+ +-------------+ +--------------+                   |
|  |query-cache| | rate-limiter | | redis-guards |                   |
|  | LRU 缓存  | | 令牌桶限流   | | Redis 命令守卫|                   |
|  +-----------+ +-------------+ +--------------+                   |
+------------------------------------------------------------------+
         |
         v
+------------------------------------------------------------------+
|  drivers/ (驱动层)                                                 |
|  +---------------------+  +----------+  +----------+              |
|  | sql/                 |  | mongo/   |  | redis/   |              |
|  |  mysql-driver        |  | mongo-   |  | redis-   |              |
|  |  postgres-driver     |  | driver   |  | driver   |              |
|  |  mssql-driver        |  |          |  |          |              |
|  |  oracle-driver       |  |          |  |          |              |
|  +---------------------+  +----------+  +----------+              |
+------------------------------------------------------------------+
         |
         v
+------------------------------------------------------------------+
|  MySQL  PostgreSQL  MSSQL  Oracle  MongoDB  Redis                  |
+------------------------------------------------------------------+
```

---

## 2. 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 运行时 | Node.js >= 20 | ESM 原生支持，AsyncLocalStorage 稳定 |
| 语言 | TypeScript 5.9 (strict) | 类型安全，编译期捕获错误 |
| MCP SDK | @modelcontextprotocol/sdk ^1.29 | 官方 SDK，stdio 传输内置 |
| 参数校验 | Zod ^4.3 | MCP inputSchema 要求 JSON Schema，Zod 可直接生成 |
| MySQL | mysql2/promise | 连接池 + Promise 原生支持，性能优于 mysql 包 |
| PostgreSQL | pg ^8.13 | 生态成熟，TypeScript 类型完善 |
| MSSQL | mssql ^11 | 官方推荐，支持 Tedious/ConnectionString |
| Oracle | oracledb ^6.7 (optional) | 官方驱动，纯 JS 安装可选避免 OCI 依赖 |
| MongoDB | mongodb ^6.12 | 官方驱动，原生聚合管道支持 |
| Redis | ioredis ^5.4 | 支持 Cluster/Sentinel，命令覆盖全面 |
| 配置 | dotenv + 环境变量 | 12-Factor App，容器友好 |
| 模块系统 | ESM + NodeNext | TypeScript `moduleResolution: "NodeNext"` |

---

## 3. 模块设计

### 3.1 入口层

| 文件 | 职责 |
|------|------|
| `src/index.ts` | CLI 入口。加载 .env，区分 CLI 子命令（init/test）与 MCP server 模式；初始化 registry、执行 ping 健康检查、创建 server 并连接 stdio transport；注册 SIGINT/SIGTERM 优雅关闭、SIGHUP 热重载 |
| `src/server.ts` | 创建 McpServer 实例，依次注册 6 组 tool，返回 server |
| `src/bootstrap.ts` | 启动编排。从环境变量解析 ConnectionSpec[]，按引擎创建 Driver 实例，组装 ConnectionRegistry；提供 pingAll / closeAll / logStartupDiagnostics |

### 3.2 核心层 (core/)

| 模块 | 职责 | 关键接口 |
|------|------|----------|
| `types.ts` | 全局类型定义 | `Engine`, `SqlEngine`, `ConnectionSpec`, `SqlDriver`, `MongoDriver`, `RedisDriver`, `RuntimeHandle` |
| `config.ts` | 环境变量解析与校验 | `parseConnectionSpecs()`, `getDefaultConnectionId()`, `globalLimits()` |
| `registry.ts` | 连接注册表，管理多连接生命周期 | `ConnectionRegistry`: resolve/get/require/requireSql/requireMongo/requireRedis, recordRequest, assertAllowlistDb |
| `sql-guards.ts` | SQL 安全守卫 | `isReadOnlyQuery()`, `checkDangerousOperation()`, `detectInjectionPatterns()` |
| `redis-guards.ts` | Redis 命令守卫 | `getBlockedCommands()`, `assertRedisKeyPrefix()` |
| `audit.ts` | 审计日志（内存环形缓冲 + 文件追加） | `auditLog()`, `getRecentAuditLogs()`, `filterAuditLogs()`, `getAuditStats()` |
| `logger.ts` | 结构化日志（JSON/人类可读） | `createLogger()`, `maskCredential()`, `maskSensitiveData()` |
| `query-cache.ts` | LRU 只读查询缓存 | `QueryCache`: get/set/clear, `cacheKey()` |
| `rate-limiter.ts` | 令牌桶速率限制 | `RateLimiter`: allow(key) |
| `error-codes.ts` | 统一错误码体系 | `ErrorCodes` (CONN/SQL/MONGO/REDIS/AUTH/CFG), `withErrorCode()`, `maskUrl()` |

### 3.3 驱动层 (drivers/)

每个 Driver 实现 core/types.ts 中定义的接口，统一提供 `ping / execute / close` 语义。

| 驱动 | 文件 | 底层库 | 特殊能力 |
|------|------|--------|----------|
| MySQL | `drivers/sql/mysql-driver.ts` | mysql2/promise | 连接池、指数退避重试（PROTOCOL_CONNECTION_LOST 等）、事务 |
| PostgreSQL | `drivers/sql/postgres-driver.ts` | pg | 参数占位 `$1..`、Schema 感知 |
| MSSQL | `drivers/sql/mssql-driver.ts` | mssql | Tedious 引擎、命名参数映射 |
| Oracle | `drivers/sql/oracle-driver.ts` | oracledb | 绑定变量 `:1`、可选依赖 |
| MongoDB | `drivers/mongo/mongo-driver.ts` | mongodb | 聚合管道、索引管理、Schema 采样分析 |
| Redis | `drivers/redis/redis-driver.ts` | ioredis | 5 种数据结构全覆盖、keyPrefix 约束 |

**驱动层安全职责（双重守卫）：**

```
sql_query / sql_execute
    |
    +-- Tool 层：isReadOnlyQuery() 前置拦截
    |
    +-- Driver 层：checkDangerousOperation() + SQL 长度校验
    |
    +-- Driver 层：auditLog() 写入审计
    |
    +-- Driver 层：withTimeout() 查询超时保护
```

### 3.4 工具层 (tools/)

| 文件 | 注册工具数 | 工具清单 |
|------|-----------|----------|
| `connections.ts` | 6 | validate_connection_config, list_connections, test_connection, health_check, connection_stats, prometheus_metrics, server_info |
| `sql.ts` | 15 | sql_query, sql_execute, sql_list_tables, sql_describe_table, sql_begin_transaction, sql_execute_in_transaction, sql_commit, sql_rollback, sql_batch_execute, sql_explain, sql_call_procedure, sql_list_views, sql_describe_view, sql_generate_types, sql_cache_stats, sql_list_indexes, sql_create_index |
| `mongo.ts` | 14 | mongo_list_collections, mongo_find, mongo_aggregate, mongo_count, mongo_insert_one, mongo_insert_many, mongo_update_one, mongo_update_many, mongo_delete_one, mongo_delete_many, mongo_find_one_and_update, mongo_find_one_and_delete, mongo_list_indexes, mongo_create_index, mongo_schema_analysis, mongo_drop_collection, mongo_rename_collection |
| `redis.ts` | 22 | redis_get, redis_set, redis_del, redis_scan, redis_hget/hset/hgetall/hdel, redis_lpush/rpush/lpop/rpop/lrange/llen, redis_sadd/smembers/srem/scard/sismember, redis_zadd/zrange/zrem/zcard/zscore, redis_type, redis_expire, redis_ttl, redis_blocked_commands |
| `schema.ts` | 1 | schema_export（JSON / SQL DDL） |
| `audit.ts` | 3 | audit_get_recent, audit_filter, audit_stats |

---

## 4. 数据流

```
MCP Client
  |  JSON-RPC request (tool name + args)
  v
McpServer (server.ts)
  |  Zod schema 验证 inputSchema
  v
Tool Handler (tools/*.ts)
  |  1. registry.resolveConnectionId() -> 确定连接
  |  2. rateLimiter.allow()             -> 限流检查
  |  3. 前置守卫（isReadOnlyQuery 等）   -> 安全拦截
  |  4. queryCache.get()                -> 缓存命中？
  v
Driver (drivers/*)
  |  5. SQL 长度校验 + 危险操作检查
  |  6. withTimeout(execute, timeoutMs) -> 查询超时
  |  7. 审计写入 auditLog()
  |  8. 失败重试（仅只读，指数退避）
  v
数据库
  |  结果集
  v
Tool Handler
  |  9. 截断到 maxRows
  |  10. 写入 queryCache（仅只读）
  |  11. registry.recordRequest()      -> 指标统计
  v
McpServer -> JSON-RPC response -> MCP Client
```

---

## 5. 关键设计决策

### ADR-001: 多连接架构

| 项目 | 内容 |
|------|------|
| 状态 | 已采纳 |
| 背景 | 需要同时连接多个异构数据库，且每个连接的安全策略不同 |
| 决策 | 通过 `DB_MCP_CONNECTIONS` JSON 数组声明式配置多连接；每个连接有独立 id、engine、readonly 标志、allowlist；`ConnectionRegistry` 统一管理所有连接句柄 |
| 后果 | + 灵活支持异构数据库；+ 每个连接独立安全策略；- 连接数多时启动时间增加；- 热重载需重建整个 registry |

### ADR-002: SQL 双层安全守卫

| 项目 | 内容 |
|------|------|
| 状态 | 已采纳 |
| 背景 | AI 生成的 SQL 可能包含危险操作或注入模式 |
| 决策 | 工具层前置 `isReadOnlyQuery()` 拦截非只读语句；驱动层后置 `checkDangerousOperation()` + `detectInjectionPatterns()` 拦截 TRUNCATE/DROP/无 WHERE 的 DELETE/UPDATE 及 20+ 种注入模式；Redis 层通过 `REDIS_BLOCKED_COMMANDS` 禁用 FLUSHALL 等高危命令 |
| 后果 | + 纵深防御；+ 即使绕过一层仍有拦截；- 启发式检测存在误报可能（如合法 UNION 查询） |

### ADR-003: 只读连接强制读写分离

| 项目 | 内容 |
|------|------|
| 状态 | 已采纳 |
| 背景 | 生产环境需要限制 AI 只能读取数据 |
| 决策 | ConnectionSpec 中 `readonly: true` 标记只读连接；`sql_query` 工具强制 `mode: 'readonly'`；`sql_execute` / `sql_batch_execute` 在入口处检查 `spec.readonly` 并拒绝；MongoDB/Redis 工具层同样检查 |
| 后果 | + 配置即策略，零代码修改；+ 可按连接粒度控制；- 只读连接无法执行存储过程（即使无副作用） |

### ADR-004: 审计日志环形缓冲

| 项目 | 内容 |
|------|------|
| 状态 | 已采纳 |
| 背景 | 需要追踪所有数据库操作，但不想引入外部依赖 |
| 决策 | 内存中维护最近 1000 条 `AuditEntry` 环形缓冲；可选通过 `MCP_AUDIT_LOG` 环境变量追加写入文件；支持按引擎/连接/操作/时间过滤和 P50/P95/P99 性能统计 |
| 后果 | + 零外部依赖；+ 实时查询；- 重启丢失内存缓冲；- 文件写入为同步 appendFileSync（审计失败不阻断主流程） |

---

## 6. 部署方案

### 6.1 Docker Compose 拓扑

```yaml
# docker-compose.yml 提供 6 个数据库容器用于开发/测试
services:
  postgres:   # postgres:16-alpine   :5432
  mysql:      # mysql:8.4            :3306
  redis:      # redis:7-alpine       :6379
  mongo:      # mongo:7              :27017
  mssql:      # mcr.microsoft.com/mssql/server:2022-latest :1433
  oracle:     # gvenzl/oracle-xe:21-slim                  :1521
```

### 6.2 环境变量清单

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `DB_MCP_CONNECTIONS` | 是 | - | JSON 数组，声明所有连接 |
| `DB_MCP_DEFAULT_CONNECTION_ID` | 否 | 数组第一项 | 默认连接 ID |
| `DB_QUERY_TIMEOUT` | 否 | 30000 | 查询超时(ms) |
| `DB_MAX_ROWS` | 否 | 100 | 单次查询最大返回行数 |
| `DB_MAX_RESPONSE_BYTES` | 否 | 1048576 | 所有 MCP 工具序列化结果硬上限（4 KiB..16 MiB） |
| `DB_MAX_SQL_LENGTH` | 否 | 102400 | SQL 最大长度(bytes) |
| `DB_RETRY_COUNT` | 否 | 2 | 只读查询重试次数 |
| `DB_RETRY_DELAY_MS` | 否 | 200 | 重试基础延迟(ms) |
| `DB_TRANSACTION_TIMEOUT_MS` | 否 | 300000 | 事务超时(ms) |
| `DB_SHUTDOWN_TIMEOUT_MS` | 否 | 10000 | 优雅关闭超时(ms) |
| `DB_QUERY_CACHE_SIZE` | 否 | 0 | 查询缓存条目数（0=禁用） |
| `DB_QUERY_CACHE_TTL_MS` | 否 | 30000 | 缓存 TTL(ms) |
| `DB_RATE_LIMIT_PER_SECOND` | 否 | 0 | 每连接每秒请求数限制（0=不限） |
| `DB_SLOW_QUERY_MS` | 否 | 5000 | 慢查询阈值(ms) |
| `REDIS_BLOCKED_COMMANDS` | 否 | 内置列表 | 自定义 Redis 禁止命令（逗号分隔） |
| `MCP_AUDIT_LOG` | 否 | - | 审计日志文件路径 |
| `LOG_LEVEL` | 否 | info | 日志级别 debug/info/warn/error |
| `LOG_FORMAT` | 否 | human | 日志格式 human/json |
| `DB_MASKING_MODE` | 否 | off | 数据脱敏模式：strict/loose/off |
| `DB_MASKING_EXCLUDE_FIELDS` | 否 | - | 脱敏白名单字段（逗号分隔） |
| `DB_REPLAY_BUFFER_SIZE` | 否 | 50 | 查询回放缓冲区大小 |
| `DB_SUGGEST_TIMEOUT_MS` | 否 | 3000 | 查询建议分析超时(ms) |

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| SQL 注入绕过启发式检测 | 数据泄露或篡改 | 双层守卫 + 只读连接 + 参数化查询（driver 层强制） |
| 大结果集 OOM / MCP 上下文溢出 | 进程崩溃或客户端拒绝响应 | `DB_MAX_ROWS` + `DB_MAX_RESPONSE_BYTES`；SQL 逐行字节预算、MongoDB 游标逐文档预算，协议层覆盖授权拒绝与插件工具 |
| 连接泄漏 | 资源耗尽 | 连接池 + 事务超时自动回滚 + 优雅关闭 closeAll |
| 审计日志同步写入 | 高吞吐下性能下降 | appendFileSync 非阻塞语义 + 审计失败不阻断主流程 |
| Oracle optionalDep 安装失败 | 功能缺失 | oracledb 声明为 optionalDependencies，缺失时创建连接报错而非启动失败 |
| 热重载 SIGHUP 不完整 | 配置不一致 | 当前实现：重建 registry 后退出，由进程管理器重启（简化方案） |

---

> 本文档基于 v1.4.0 代码反推生成，标注"初稿，待确认"，需团队审阅后定稿。

---

## 8. v1.5 技术设计

### 8.1 数据脱敏模块

**文件**: `src/core/data-masking.ts` + `src/tools/masking.ts`

**接口定义**:

```typescript
type MaskingMode = 'strict' | 'loose';

interface MaskingRule {
  name: string;
  fieldPatterns: RegExp[];       // 字段名匹配（如 /phone/i, /email/i）
  valuePatterns: RegExp[];       // 值正则匹配（如手机号、身份证）
  mask: (value: string) => string;
}

interface MaskingConfig {
  mode: MaskingMode;
  enabled: boolean;
  rules: MaskingRule[];
  excludeFields: string[];       // 白名单排除
  excludeConnections: string[];  // 排除的连接 ID
}

function applyMasking(data: Record<string, unknown>[], config: MaskingConfig): Record<string, unknown>[];
```

**内置规则**: phone(138\*\*\*\*5678)、email(t\*\*\*@example.com)、id_card(前6后4可见)、credit_card(前4后4可见)、bank_card、ip_address。

**集成点**: 在 `tools/sql.ts` 的 `sql_query` 和 `tools/mongo.ts` 的 `mongo_find` 返回结果前，调用 `applyMasking()`。采用纯函数设计，不修改驱动层，通过工具层拦截。

**ADR-005**: 数据脱敏采用工具层纯函数方案而非驱动层代理。

| 项目 | 内容 |
|------|------|
| 背景 | 需要在查询结果返回前对敏感字段脱敏 |
| 决策 | 在 tools 层对返回 data 数组调用纯函数 `applyMasking()`，驱动层无感知 |
| 后果 | + 所有引擎统一脱敏逻辑；+ 纯函数易测试；- 大结果集有额外遍历开销（O(n) 可接受） |

### 8.2 查询回放模块

**文件**: `src/core/query-replay.ts` + `src/tools/replay.ts`

**接口定义**:

```typescript
interface QueryRecord {
  id: string;              // 自增 ID
  timestamp: string;
  connectionId: string;
  engine: string;
  sql: string;
  params: unknown[];
  resultSummary: {         // 仅存摘要，不存完整结果
    rowCount: number;
    fields: string[];
    sampleRows: unknown[]; // 前 5 行采样
  };
  executionTime: number;
  success: boolean;
}

interface QueryDiffResult {
  added: number;
  removed: number;
  modified: number;
  details: { field: string; old: unknown; new: unknown }[];
}

class QueryHistory {
  constructor(maxSize?: number);       // 默认 50，环形缓冲
  push(record: QueryRecord): void;
  getById(id: string): QueryRecord | undefined;
  list(limit?: number): QueryRecord[];
  diff(idA: string, idB: string): QueryDiffResult;
}
```

**集成点**: 复用 `audit.ts` 的环形缓冲模式，`QueryHistory` 单例在 `tools/sql.ts` 和 `tools/mongo.ts` 中记录每次查询。`query_replay` 工具通过历史记录中的 SQL+params 重新执行查询；`query_diff` 对比两次结果的行级差异。

**ADR-006**: 查询历史仅存结果摘要（前5行 + 元数据），不缓存完整结果集。

| 项目 | 内容 |
|------|------|
| 背景 | 完整缓存查询结果会导致内存不可控 |
| 决策 | 环形缓冲仅存 `QueryRecord`（含采样行），diff 时重新查询对比 |
| 后果 | + 内存可控（50条 x ~10KB）；+ 复用已有查询路径；- diff 需两次查询，有额外开销 |

### 8.3 智能查询建议模块

**文件**: `src/core/query-suggest.ts` + `src/tools/advisor.ts`

**接口定义**:

```typescript
interface Suggestion {
  type: 'index' | 'rewrite' | 'performance' | 'security';
  severity: 'info' | 'warn' | 'critical';
  message: string;
  suggestedSql?: string;
}

interface AnalysisResult {
  sql: string;
  suggestions: Suggestion[];
  executionPlan?: Record<string, unknown>[];
}

function analyzeQuery(sql: string, engine: SqlEngine, tableInfo?: TableInfo[]): Suggestion[];
function analyzeExplainPlan(plan: Record<string, unknown>[], engine: SqlEngine): Suggestion[];
```

**分析规则引擎**:
- SQL 静态分析: SELECT * 检测、缺少 WHERE、LIKE '%...' 前缀通配、子查询转 JOIN 建议
- EXPLAIN 结果分析: 全表扫描 (type=ALL)、未使用索引、filesort、临时表
- 索引建议: 基于 WHERE/JOIN/ORDER BY 列与现有索引对比

**集成点**: `query_suggest` 工具独立调用，先获取表结构（复用 `sql_describe_table`），再分析 SQL 文本。`query_optimize` 工具组合调用 `sql_explain` + `analyzeExplainPlan`。

**ADR-007**: 查询建议采用规则引擎而非机器学习模型。

| 项目 | 内容 |
|------|------|
| 背景 | 需要为 AI 生成的 SQL 提供优化建议 |
| 决策 | 基于正则 + EXPLAIN 结果的规则引擎，不引入 ML 依赖 |
| 后果 | + 零外部依赖；+ 规则可审计；- 无法覆盖所有优化场景 |

### 8.4 新增工具清单

| 工具名 | 所属模块 | 参数 | 返回值 |
|--------|---------|------|--------|
| `set_masking_mode` | data-masking | mode, enabled, excludeFields?, excludeConnections? | `{ mode, enabled, rulesCount }` |
| `get_masking_config` | data-masking | - | `{ mode, enabled, rules, excludeFields }` |
| `query_history` | query-replay | limit?, connectionId? | `QueryRecord[]` |
| `query_replay` | query-replay | queryId | 原查询结果 |
| `query_diff` | query-replay | queryIdA, queryIdB | `QueryDiffResult` |
| `query_suggest` | query-suggest | sql, connectionId? | `Suggestion[]` |
| `query_optimize` | query-suggest | sql, connectionId? | `AnalysisResult` |

### 8.5 模块依赖图

```
MCP Client
    |
    v
server.ts ──> tools/masking.ts ──> core/data-masking.ts (纯函数)
    |          tools/replay.ts  ──> core/query-replay.ts (环形缓冲)
    |          tools/advisor.ts ──> core/query-suggest.ts (规则引擎)
    |                |                    |
    v                v                    v
tools/sql.ts    tools/mongo.ts      sql_explain (复用)
    |                |
    v                v
drivers/* ──> core/audit.ts (复用审计模式)
         ──> core/sql-guards.ts (已有)
         ──> core/config.ts (环境变量: DB_MASKING_*, DB_REPLAY_*)
```

**环境变量新增**:

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `DB_MASKING_MODE` | `off` | 脱敏模式: off/loose/strict |
| `DB_MASKING_EXCLUDE_FIELDS` | - | 白名单字段（逗号分隔） |
| `DB_REPLAY_BUFFER_SIZE` | `50` | 查询历史缓冲大小 |
| `DB_SUGGEST_TIMEOUT_MS` | `3000` | 查询建议分析超时 |
