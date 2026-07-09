# 更新日志

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.2.2] - 2026-07-10

### 新增
- **告警 webhook 基线**：新增 `DB_ALERT_ENABLED`、`DB_ALERT_WEBHOOK_URL` 等配置，支持连接失败、工具错误率升高和慢工具调用告警。
- **测试告警工具**：新增 `alert_test`，用于发送测试告警并返回脱敏后的告警配置摘要。
- **告警安全摘要**：启动诊断展示告警启用状态、阈值和冷却配置，但不泄漏 webhook secret。

### 安全
- 告警默认关闭，必须显式设置 `DB_ALERT_ENABLED=true` 才会发送 webhook。
- webhook payload 不包含 SQL、查询参数、token 或连接密码；共享密钥仅通过 `x-db-mcp-alert-secret` header 发送。
- webhook 发送失败不会阻断工具调用。

## [2.2.1] - 2026-07-10

### 新增
- **审计文件持久化配置**：新增 `DB_AUDIT_SINK=file` 和 `DB_AUDIT_FILE_PATH`，将审计记录追加为 JSONL 文件；旧 `MCP_AUDIT_LOG` 继续兼容。
- **RBAC policy 模板**：新增内置 `readonly-http`、`diagnostic-readonly`、`local-admin` 模板，并支持通过 `DB_RBAC_POLICY_TEMPLATE` 启用。
- **Policy 模板工具**：新增 `auth_policy_template`，返回内置 RBAC policy 模板 JSON，可与 `auth_policy_validate` 组成模板导出与校验闭环。

### 安全
- 内置 HTTP 模板默认拒绝写操作，并强制 `strict-v2` 脱敏和 `maxRows` 限制。
- `local-admin` 模板只匹配 `local:stdio` 与 stdio transport，不扩大 HTTP 权限。
- 文件审计写入失败不会阻断工具调用；明显错误的审计 sink 配置会在启动诊断阶段暴露。

## [2.2.0] - 2026-07-10

### 新增
- **HTTP Prometheus endpoint**：HTTP 模式新增 `GET /metrics`，输出与 `prometheus_metrics` MCP 工具一致的 Prometheus text exposition。
- **工具调用可观测性**：统一授权 wrapper 会记录工具调用次数、失败数、耗时、最大耗时和错误码，并暴露为 `db_mcp_tool_*` 指标。
- **OpenTelemetry API span**：每次 MCP 工具调用都会创建 `mcp.tool.<name>` span，包含 tool、action、transport、connection、tenant、duration 和 error code 属性。

### 安全
- `/metrics` 默认复用 HTTP Origin 与认证校验；只有显式关闭 HTTP 认证时才允许匿名访问。
- 工具调用指标只记录 tool/action/connection/transport/error code 等运行时元数据，不记录 SQL、参数、token 或查询结果。

## [2.1.1] - 2026-07-10

### 新增
- **只读查询结果导出**：新增 `sql_export_query`，支持将 SQL 查询结果导出为 JSON、CSV 或 Markdown。
- **SQL 表采样画像**：新增 `sql_sample_table`，返回字段类型、空值率、唯一值数量、示例值、字符串长度和数值范围。

### 安全
- `sql_export_query` 在执行前强制 `isReadOnlyQuery` 校验，导出前应用全局和请求级脱敏，并将导出行数限制在 10000 以内。
- `sql_sample_table` 只接受合法表名/schema 标识符，由服务端生成只读采样 SQL，不接受任意 SQL 片段。

## [2.1.0] - 2026-07-10

### 新增
- **DuckDB 引擎支持**：新增 `duckdb` SQL 类引擎，使用 `@duckdb/node-api`，支持 `:memory:` 和本地 DuckDB 数据库文件。
- **本地分析文件 allowlist**：DuckDB 可读取 `allowlist` 指定文件或目录内的 CSV/Parquet/JSON 等外部数据源，默认禁止任意外部文件访问。
- **DuckDB SQL 工具适配**：`sql_query`、`sql_execute`、`sql_list_tables`、`sql_describe_table`、`sql_explain`、`schema_export` 等 SQL 工具可识别 DuckDB 方言。

### 变更
- DuckDB 连接默认 `readonly:true`，只有显式配置 `readonly:false` 才允许写入。
- CLI `init --interactive`、连接诊断、README、CONFIG 和 `.env.example` 增加 DuckDB 配置提示。

### 安全
- `sql_query` 继续在 MCP 工具层执行 `isReadOnlyQuery`，DuckDB driver 层也会再次执行 readonly 检查。
- driver 初始化时先配置 DuckDB `allowed_directories`/`allowed_paths`，再关闭外部访问，确保越界文件读取由 DuckDB 原生权限检查拒绝。

## [2.0.1] - 2026-07-10

### 修复
- **RBAC policy 脱敏条件执行**：`conditions.maskingMode` 现在会在每次授权通过后的工具调用上下文中生效，SQL/Mongo 只读结果会按策略要求执行更严格脱敏。

### 安全
- 请求级脱敏通过 `AsyncLocalStorage` 传递 policy 条件，不修改全局脱敏配置，避免并发请求之间串扰。
- policy `maskingMode` 只能提升脱敏强度，不能弱化 `DB_MASKING_MODE` 已配置的全局脱敏要求。
- SQL 查询缓存仍保存未脱敏结果，读取缓存时按当前请求策略重新脱敏，避免不同 subject/role 共享已脱敏变体。

## [2.0.0] - 2026-07-10

### 新增
- **Bearer Token 认证**：HTTP 模式支持 JWT issuer/audience/expiry/signature 校验，JWKS 可来自 URL 或本地文件。
- **RBAC 授权**：新增 policy loader、subject/role/resource/action 授权、默认拒绝和 maxRows/transport/timeWindow 条件。
- **统一授权包装**：工具调用前统一执行授权，所有工具映射到 read/write/admin/diagnose/export/replay action。
- **认证工具**：新增 `auth_whoami` 和 `auth_policy_validate`。

### 变更
- 版本升至 `2.0.0`，HTTP 默认认证从 API key 过渡为 bearer；API key fallback 保留给开发和迁移。
- 默认测试脚本纳入 `test/auth/*.test.mjs`。
- API 文档生成器补齐认证工具。

### 安全
- 授权 allow/deny 决策写入审计，包含 subject、tenant、tool、action、roles、reason 和 policy version，不记录 token 原文。
- 现有 SQL 只读、Mongo allowlist/NoSQL guard、Redis keyPrefix/blocked command 仍保留在工具/driver 层。

## [1.9.0] - 2026-07-10

### 新增
- **SQL Schema diff**：新增 `schema_diff`，只读比较两个 SQL 连接或 schema 的表/列差异，返回新增、删除和变更详情。
- **MongoDB 多文档事务**：新增 `mongo_begin_transaction`、`mongo_execute_in_transaction`、`mongo_commit`、`mongo_rollback`。
- **Redis pipeline**：新增 `redis_pipeline`，批量执行安全 Redis 命令子集，保留 keyPrefix、readonly 和阻断命令边界。
- **Mongo 事务错误码**：新增 `MONGO_005` 表示事务不存在或已结束。

### 变更
- `schema_export` 新增 `schema` 参数，主要用于 PostgreSQL schema 选择。
- 新增 `DB_MONGO_TRANSACTION_TIMEOUT_MS`，未设置时回退到 `DB_TRANSACTION_TIMEOUT_MS`。
- API 生成脚本补齐 v1.9.0 新工具。

### 安全
- MongoDB 事务在 readonly 连接上拒绝开始，事务内 filter 继续执行 NoSQL 注入检测。
- Redis pipeline 在工具层拒绝阻断命令，driver 层继续执行 keyPrefix 和 readonly 检查。

## [1.8.0] - 2026-07-10

### 新增
- **Streamable HTTP 传输**：新增 `DB_MCP_TRANSPORT=http` 和 `--transport http`，支持 SDK client 通过 `POST /mcp` 完成 initialize、tools/list 和 tools/call。
- **运维探活端点**：HTTP 模式提供 `GET /healthz` 和 `GET /readyz`，用于 Docker/Kubernetes 健康检查。
- **HTTP 安全默认值**：默认监听 `127.0.0.1`；远程监听必须配置 `DB_HTTP_API_KEY`，除非显式 `DB_HTTP_AUTH_DISABLED=true`；支持 Origin allowlist、body limit 和 request timeout。
- **HTTP smoke test**：新增 `scripts/http-smoke.mjs`，可验证远端 `/mcp` 是否可初始化并列出工具。
- **Docker HTTP 示例**：新增 Dockerfile，并将 `docker-compose.yml` 的 mcp-server 示例切到 HTTP 模式和 `/readyz` 探活。

### 变更
- **Transport 架构拆分**：新增 `src/transports/stdio.ts`、`src/transports/http.ts`、`src/transports/health.ts` 和 `src/core/http-config.ts`，`src/index.ts` 负责启动编排和传输选择。
- **测试门禁扩展**：默认 `npm test` 和 coverage 脚本纳入 `test/transports/*.test.mjs`。
- **SQL 事务清理器共享**：事务状态提升到模块级，避免 HTTP session 多次注册 SQL 工具时重复启动清理定时器。

### 安全
- **HTTP 错误结构化**：未授权、非法 Origin、body 超限、method 不支持和 endpoint 不存在均返回稳定错误码。
- **只读边界回归**：新增 HTTP 测试确认 `sql_query` 写 SQL 仍在 MCP 工具层返回 `SQL_002`。

## [1.7.3] - 2026-07-10

### 新增
- **SQLite 快速开始闭环**：`init` 默认生成最小 SQLite `.env`，README 中提供 5 分钟本地验证路径。
- **错误码元数据**：`src/core/error-codes.ts` 补齐 `message`、`hint`、`severity`、`retryable` 和适用范围，并覆盖 CLI/HTTP 前瞻错误码。
- **诊断错误对象**：`connection_diagnose` 返回 `error_info`，并针对端口、认证、timeout、readonly、Redis keyPrefix、SQLite 文件路径给出建议。
- **CLI 测试体验**：`test` 子命令输出连接数量、默认连接、engine、readonly、失败 code 和 hint。

### 修复
- **API 文档漂移**：补齐 `scripts/generate-docs.mjs` 中缺失的当前工具，并生成包含通用错误章节的 `docs/API.md`。
- **凭证脱敏边界**：错误脱敏覆盖 `redis://:password@host` 这类空用户名 URL。

### 变更
- **CLI init 行为**：默认不进入交互向导，改为生成最小 SQLite 配置；旧交互式向导保留为 `init --interactive`。
- **README/CONFIG/ERRORS 同步**：文档统一指向 SQLite quickstart、`.env.example`、`connection_diagnose` 和错误码矩阵。

## [1.7.2] - 2026-07-10

### 新增
- **发布工程门禁**：CI 新增 `npm pack --dry-run`，按仓库约定先 build 再 test，确保测试导入的是最新 `dist/`。
- **配置模板入库**：新增可提交的 `.env.example`，默认 SQLite 本地配置，并提供 MySQL、PostgreSQL、MSSQL、Oracle、MongoDB、Redis、SQLite 多引擎占位符示例。

### 修复
- **GitHub CI 格式检查失败**：对 `src/**/*.ts` 执行 Prettier 机械格式化，使 `npm run format:check` 在 CI 中通过。
- **`.env.example` 被忽略**：调整 `.gitignore`，继续排除真实 `.env` 和 `.env.*`，但允许安全模板 `.env.example` 入库。

### 变更
- **npm 包产物**：`package.json` 的 `files` 显式包含 `.env.example`，方便安装包用户获得配置模板。
- **发布文档同步**：更新发布检查清单、配置指南和文档索引中的 v1.7.2 状态。

## [1.7.1] - 2026-07-09

### 新增
- **核心质量测试补齐**：新增 QueryCache、RateLimiter、SQL helpers、Version、Registry metrics 等独立测试，并纳入默认 `npm test` 与覆盖率脚本。
- **MSSQL EXPLAIN 安全覆盖**：新增单元测试确保 MSSQL 不再生成 `SHOWPLAN` 多语句批处理。

### 修复
- **RateLimiter 长运行清理**：增加不活跃 bucket 清理、定时器 `unref`、`dispose()` 和确定性测试，降低长期运行内存增长风险。
- **QueryCache 缓存键稳定性**：改用带类型标记的稳定序列化，区分 `undefined`、`null`、`Date`、`BigInt`、`NaN` 等边界值，并对对象 key 排序。
- **MSSQL EXPLAIN 降级**：`sql_explain` 与 `query_optimize` 统一使用 `explainQuerySql`，MSSQL 返回明确错误，不再拼接 `SET SHOWPLAN_ALL ON; ...; OFF` 单批语句。
- **Registry 指标污染**：`recordRequest` 忽略未知连接 ID，避免指标 Map 被无效 ID 污染。
- **邮箱脱敏边界**：修正短邮箱 local-part 与 strict 模式非邮箱字符串的脱敏行为。

### 变更
- **Lint 收敛**：移除 `advisor.ts`、`sql.ts` 中的 `any` warning，`npm run lint` 现在 0 error / 0 warning。
- **测试数量**：默认测试从 451 个增至 455 个，全部通过。

## [1.7.0] - 2026-05-05

### 新增
- **SQLite 引擎支持**：新增第 7 个数据库引擎 `sqlite`，使用 `better-sqlite3` 驱动，支持文件数据库和内存数据库，自动创建目录，WAL 模式默认开启
- **连接诊断工具**：新增 `connection_diagnose` 工具，一键检查所有连接的健康状况、延迟、服务器版本和配置建议
- **SQL 辅助函数共享模块**：新增 `src/core/sql-helpers.ts`，抽取 `describeTableSql`、`listIndexesSql`、`listTablesSql` 到共享模块，消除 `sql.ts` 和 `advisor.ts` 中的重复代码
- **版本号统一管理**：新增 `src/core/version.ts`，从 `package.json` 动态读取版本号，消除硬编码
- **缓存命中率统计**：`sql_cache_stats` 工具新增 `hits`、`misses`、`hitRate` 字段

### 修复
- **版本号不一致**：`server.ts` 和 `connections.ts` 中硬编码的 `'1.4.0'` 改为从 `package.json` 动态读取
- **strict-v2 脱敏逻辑**：修正 `applyLooseMode` 实现，使其仅按值正则匹配脱敏（不再检查字段名），与 `strict-v2` 模式形成明确差异
- **sql_call_procedure 注入风险**：新增 `validateIdent` 校验存储过程名称
- **连接错误信息增强**：`未知 connection_id` 错误现包含可用连接 ID 列表
- **SQL 连接类型错误增强**：`非 SQL 连接` 错误现包含当前连接类型提示
- **只读连接错误增强**：`该连接为只读` 错误现包含修改建议

### 变更
- **redis_type 工具**：改用 Redis 原生 `TYPE` 命令（从 4 次网络往返降为 1 次），正确检测所有类型包括 zset
- **sql_query 自动分页**：传入 `page` + `page_size` 时自动追加 `LIMIT/OFFSET`（可通过 `DB_AUTO_PAGINATION=false` 关闭）
- **Lint 修复**：移除 `advisor.ts` 和 `masking.ts` 中的未使用导入

## [1.6.0] - 2026-05-05

### 新增
- **审计日志导出**：新增 export_audit 工具，支持 JSON 格式导出
- **自定义脱敏规则**：新增 manage_masking_rules 工具，支持添加/删除/列出自定义规则
- **strict-v2 脱敏模式**：同时匹配字段名和值正则，提升脱敏精度

### 修复
- **版本号不一致**：package.json 版本号修正为 1.6.0
- **文档默认值修正**：DB_SUGGEST_TIMEOUT_MS 默认值修正为 5000
- **环形缓冲区优化**：audit 和 query-replay 模块使用真正的环形缓冲替代 Array.shift()

### 变更
- 工具总数从 80 个增至 82 个

## [1.5.0] - 2026-05-05

### 新增
- **数据脱敏模式**：新增 set_masking_mode 和 get_masking_config 工具，支持 strict/loose 两种脱敏模式
- **查询回放**：新增 query_history、query_replay、query_diff 工具，支持查询历史记录和结果对比
- **智能查询建议**：新增 query_suggest 和 query_optimize 工具，基于规则引擎提供查询优化建议
- 新增环境变量：DB_MASKING_MODE、DB_MASKING_EXCLUDE_FIELDS、DB_REPLAY_BUFFER_SIZE、DB_SUGGEST_TIMEOUT_MS

### 变更
- 工具总数从 73 个增至 80 个

## [1.4.0] - 2026-05-05

### 新增

- **事务超时保护**：活跃事务超过 `DB_TRANSACTION_TIMEOUT_MS`（默认 5 分钟）自动回滚，防止事务泄漏。
- **查询结果缓存**：通过 `DB_QUERY_CACHE_SIZE` 启用 LRU 缓存，`DB_QUERY_CACHE_TTL_MS` 配置 TTL。
- **缓存统计工具**：新增 `sql_cache_stats` 工具，返回缓存大小和配置信息。
- **请求速率限制**：通过 `DB_RATE_LIMIT_PER_SECOND` 配置每连接每秒最大请求数。
- **连接池指标增强**：`connection_stats` 返回成功率、平均延迟、最后使用时间等详细指标。
- **Prometheus 指标**：新增 `prometheus_metrics` 工具，返回标准 Prometheus 文本格式指标。
- **连接配置验证**：新增 `validate_connection_config` 工具，验证 JSON 配置合法性。
- **TypeScript 类型生成**：新增 `sql_generate_types` 工具，从表结构生成 TS 接口定义。
- **MongoDB Schema 分析**：新增 `mongo_schema_analysis` 工具，采样分析集合文档结构。
- **Redis 键类型检测**：新增 `redis_type` 工具，返回键的数据类型。
- **优雅关闭改进**：新增 `DB_SHUTDOWN_TIMEOUT_MS` 环境变量，超时强制退出。
- **凭证脱敏增强**：新增 `maskUrl` 和 `maskErrorCredentials` 函数，防止错误消息泄露连接密码。

### 修复

- **跨引擎索引创建**：`sql_create_index` 现在为 PostgreSQL/MSSQL/Oracle 生成正确的标识符引用语法（之前统一使用 MySQL 反引号）。

### 变更

- **测试数量**：从 210 个增至 241 个，全部通过。
- **工具总数**：从 55 个增至 63 个。

## [1.3.0] - 2026-05-05

### 新增

- **Redis List 操作**：新增 `redis_lpush`、`redis_rpush`、`redis_lpop`、`redis_rpop`、`redis_lrange`、`redis_llen` 工具。
- **Redis Set 操作**：新增 `redis_sadd`、`redis_smembers`、`redis_srem`、`redis_scard`、`redis_sismember` 工具。
- **Redis Sorted Set 操作**：新增 `redis_zadd`、`redis_zrange`、`redis_zrem`、`redis_zcard`、`redis_zscore` 工具。
- **Redis 键管理**：新增 `redis_expire` 和 `redis_ttl` 工具。
- **MongoDB 批量操作**：新增 `mongo_update_many` 和 `mongo_delete_many` 工具。
- **MongoDB 高级操作**：新增 `mongo_find_one_and_update` 和 `mongo_find_one_and_delete` 工具。
- **MongoDB 集合管理**：新增 `mongo_drop_collection` 和 `mongo_rename_collection` 工具。
- **SQL 存储过程**：新增 `sql_call_procedure` 工具，支持 MySQL/PostgreSQL/MSSQL/Oracle。
- **SQL 视图支持**：新增 `sql_list_views` 和 `sql_describe_view` 工具。
- **SQL 索引管理**：新增 `sql_list_indexes` 和 `sql_create_index` 工具。
- **服务器信息**：新增 `server_info` 工具，返回版本、运行时间、连接数等信息。

### 变更

- **RedisDriver 接口**：新增 List/Set/ZSet 操作方法和键管理方法。
- **MongoDriver 接口**：新增批量操作和集合管理方法。
- **工具总数**：从 37 个增至 55 个。

## [1.2.0] - 2026-05-05

### 新增

- **测试覆盖率工具**：集成 `c8` 覆盖率工具，支持文本、JSON、LCOV 格式输出。
- **工具单元测试**：为 `connections`、`sql`、`mongo`、`redis` 工具模块添加完整的单元测试（67 个新测试用例）。
- **驱动测试扩展**：为 MSSQL 和 Oracle 驱动添加接口测试。
- **集成测试**：新增 MongoDB 和 Redis 集成测试（Docker 环境，自动跳过）。
- **性能基准测试**：新增 SQL Guards 性能基准测试，输出 JSON 格式报告。
- **API 文档生成**：新增 `npm run docs` 脚本，自动生成 `docs/API.md`。
- **Docker 环境完善**：`docker-compose.yml` 新增 MSSQL 2022 和 Oracle XE 21。
- **CI 增强**：GitHub Actions 新增覆盖率检查和基准测试步骤。

### 变更

- **测试数量**：从 128 个增至 210 个，全部通过。
- **覆盖率**：行覆盖率从 ~53% 提升至 ~63%。
- **工具总数**：37 个工具（4 连接 + 10 SQL + 10 MongoDB + 9 Redis + 3 审计 + 1 Schema）。

### 文档

- **API 文档**：自动生成 `docs/API.md`，包含所有工具的参数说明和使用示例。

## [1.1.0] - 2026-05-05

### 新增

- **SQL EXPLAIN 分析**：新增 `sql_explain` 工具，返回查询执行计划，支持 MySQL/PostgreSQL/MSSQL/Oracle。
- **MongoDB 索引管理**：新增 `mongo_list_indexes` 和 `mongo_create_index` 工具，支持查看和创建索引（唯一索引、稀疏索引）。
- **连接配置热重载**：支持 SIGHUP 信号触发重新加载 `DB_MCP_CONNECTIONS`，无需重启进程。
- **MongoDriver 接口扩展**：新增 `listIndexes` 和 `createIndex` 方法。

### 变更

- **MongoDriver 接口**：新增索引管理方法，向后兼容。

## [1.0.0] - 2026-05-05

### 新增

- **CLI 初始化向导**：`polyglot-db-mcp-server init` 交互式生成 `.env` 配置文件。
- **CLI 连接测试**：`polyglot-db-mcp-server test` 测试所有配置的连接并输出延迟。
- **CLI 帮助**：`polyglot-db-mcp-server --help` 显示用法说明。
- **npm 包发布就绪**：添加 `exports` 字段、`engines` 字段（Node >= 20），支持 ESM 导入。
- **配置验证增强**：端口范围校验（1-65535），更友好的错误提示。

### 变更

- **入口文件**：`index.ts` 集成 CLI 子命令路由，无参数时启动 MCP 服务器（向后兼容）。

## [0.9.0] - 2026-05-05

### 新增

- **查询性能指标**：`audit_stats` 返回 P50/P95/P99 延迟百分位和慢查询计数。
- **慢查询告警**：超过 `DB_SLOW_QUERY_MS`（默认 5000ms）的查询在审计日志中标记 `slow_query: true`。
- **连接池指标**：新增 `connection_stats` 工具，返回各连接的请求计数和审计统计。
- **启动诊断增强**：启动时输出连接数、引擎分布、配置摘要、各连接延迟。
- **统一错误码体系**：新增 `src/core/error-codes.ts`，定义 CONN/SQL/MONGO/REDIS/AUTH/CFG 六大模块错误码。
- **审计日志时间范围过滤**：`filterAuditLogs` 新增 `since`/`until` 参数。

### 变更

- **启动流程**：`pingAll` 返回延迟信息，`logStartupDiagnostics` 输出结构化诊断。
- **审计统计**：`getAuditStats` 新增 `performance` 字段，包含延迟百分位。

## [0.8.0] - 2026-05-05

### 新增

- **SQL 注入检测增强**：新增 16 种进阶注入模式检测，包括堆叠查询执行、PostgreSQL 时间盲注、CHAR 编码绕过、十六进制编码注入、MSSQL 命令执行、Oracle 系统表探测、HAVING 注入、版本/数据目录泄露探测、系统文件读取等。
- **MongoDB NoSQL 注入防护**：新增 `detectNoSqlInjection` 函数，递归检测 `$where`、`$accumulator`、`$function`、`$expr`、`$regex` 等危险操作符，覆盖 `mongo_find`、`mongo_aggregate`、`mongo_count`、`mongo_delete_one`、`mongo_update_one`。
- **凭证脱敏**：新增 `maskCredential` 和 `maskSensitiveData` 函数，自动替换日志中 URL 密码和敏感字段（password/secret/token/credential/auth）。
- **Redis 命令白名单增强**：支持通过 `REDIS_BLOCKED_COMMANDS` 环境变量自定义禁止命令列表（逗号分隔）。
- **审计日志时间范围过滤**：`filterAuditLogs` 新增 `since` 和 `until` 参数，支持按时间范围查询。
- **审计参数脱敏**：新增 `sanitizeParams` 函数，自动识别并替换 Base64 编码的敏感参数。

### 变更

- **审计日志格式**：`filterAuditLogs` 支持时间范围过滤，向后兼容。

## [0.7.0] - 2026-05-05

### 新增

- **SQL Guards 完整测试**：`isReadOnlyQuery`、`detectInjectionPatterns`、`checkDangerousOperation` 全分支覆盖，新增 45 个测试用例。
- **Audit 模块测试**：`auditLog`、`getRecentAuditLogs`、`filterAuditLogs`、`getAuditStats` 全覆盖，14 个用例。
- **Logger 模块测试**：LOG_LEVEL 过滤、LOG_FORMAT 切换、上下文参数，7 个用例。
- **Schema 导出测试**：SQL 生成验证、数据转换逻辑、DDL 生成，11 个用例。
- **Timeout 工具测试**：`withTimeout`、`sleep` 超时与正常路径，7 个用例。
- **PostgreSQL 驱动测试**：接口存在性与工厂函数验证。
- **集成测试增强**：MySQL 和 PostgreSQL 集成测试（Docker 环境，自动跳过）。

### 变更

- **CI 质量门禁**：GitHub Actions 新增 Lint 和 Format Check 步骤，确保代码规范。
- **ESLint 配置修复**：添加 Node.js 全局变量声明，修复 76 个预存 lint 错误。
- **源码清理**：移除 `audit.ts` 未使用的 `readFileSync` 导入，修复 `sql.ts` 的 `prefer-const`。
- **测试覆盖**：单元测试从 43 个增至 128 个，全部通过。

## [0.6.0] - 2026-05-05

### 新增

- **Schema 导出**：新增 `schema_export` 工具，支持导出数据库 Schema 为 JSON 或 SQL DDL 格式。
- **Schema 信息**：返回表名、列名、数据类型、是否可空、主键、默认值等完整信息。

## [0.5.0] - 2026-05-05

### 新增

- **SQL 注入防护增强**：新增 `detectInjectionPatterns` 函数，检测多语句注入、UNION 注入、永真条件、时间盲注等常见注入模式。
- **审计日志工具**：新增 `audit_get_recent`、`audit_filter`、`audit_stats` 工具，支持查询和过滤审计日志。
- **审计统计**：内存中维护最近 1000 条审计记录，支持按引擎、操作类型统计。

### 变更

- **安全检查**：`checkDangerousOperation` 现在会检测 SQL 注入模式。
- **审计日志**：增强审计日志格式，添加内存缓冲区和查询接口。

## [0.4.0] - 2026-05-05

### 新增

- **结构化日志**：新增 `src/core/logger.ts`，支持 JSON 和人类可读格式，可通过 `LOG_LEVEL` 和 `LOG_FORMAT` 环境变量配置。
- **健康检查**：新增 `health_check` 工具，测试所有连接的状态和延迟，返回整体健康状态。

### 变更

- **日志系统**：启动、关闭、错误等关键事件使用结构化日志输出。
- **连接工具**：`health_check` 提供全面的连接状态报告。

## [0.3.0] - 2026-05-05

### 新增

- **SQL 事务支持**：新增 `sql_begin_transaction`、`sql_execute_in_transaction`、`sql_commit`、`sql_rollback` 工具，支持连接级事务。
- **SQL 批量执行**：新增 `sql_batch_execute` 工具，在单个事务中批量执行多条 SQL，要么全部成功，要么全部回滚。
- **MongoDB 文档操作**：新增 `mongo_insert_one`、`mongo_insert_many`、`mongo_update_one`、`mongo_delete_one` 工具。
- **Redis Hash 操作**：新增 `redis_hget`、`redis_hset`、`redis_hgetall`、`redis_hdel` 工具。
- **查询分页**：`sql_query` 支持 `page` 和 `page_size` 参数，返回分页元数据。

### 变更

- **类型扩展**：`SqlDriver` 接口新增 `beginTransaction()` 方法；`MongoDriver` 接口新增 `insertOne`、`insertMany`、`updateOne`、`deleteOne` 方法；`RedisDriver` 接口新增 `hget`、`hset`、`hgetall`、`hdel` 方法。
- **所有 SQL 驱动**：MySQL、PostgreSQL、MSSQL、Oracle 驱动均已实现事务支持。
- **只读保护**：MongoDB 和 Redis 的写操作会检查连接的 `readonly` 标志。

## [0.2.0] - 2026-05-05

### 新增

- **测试框架**：使用 Node.js 内置 `node:test` 建立单元测试和集成测试框架。
- **配置解析测试**：覆盖 `parseConnectionSpecs`、`getDefaultConnectionId`、`globalLimits` 的各种边界情况。
- **驱动单元测试**：MySQL、PostgreSQL、MongoDB、Redis 驱动的接口和配置测试。
- **集成测试基础设施**：`test/helpers/` 目录提供测试配置、环境检测和生命周期管理。
- **代码规范工具**：添加 ESLint（v9）和 Prettier 配置，支持 TypeScript。
- **npm 脚本**：新增 `lint`、`lint:fix`、`format`、`format:check`、`test:unit`、`test:integration`。

### 测试覆盖

- 配置解析：18 个测试用例（正常解析、错误处理、边界情况）
- SQL Guards：2 个测试用例（只读查询识别、危险操作拦截）
- Redis Guards：2 个测试用例（key 前缀验证）
- 驱动接口：各驱动的接口存在性和配置验证
- **总计：43 个测试用例，全部通过**

## [0.1.0] - 2026-04-14

### 新增

- 多引擎数据库 MCP 服务：在同一进程内通过 `DB_MCP_CONNECTIONS` 配置 MySQL、PostgreSQL、SQL Server、Oracle、MongoDB、Redis。
- 连接类工具：`list_connections`、`test_connection`。
- SQL 工具：`sql_query`（只读）、`sql_execute`、`sql_list_tables`、`sql_describe_table`。
- MongoDB / Redis 工具集（含 key 前缀与危险命令相关约束）。
- GitHub Actions CI（Node 24：`npm ci`、`typecheck`、`build`、`test`）。
- 文档：`README.md`（简体中文）、`README_en.md`（英文）、本 `CHANGELOG.md`；迁移说明见 `MIGRATION.md`。

### 变更

- **多连接**：启动时并行建立各连接、并行执行 `pingAll`；`closeAll` 使用 `Promise.allSettled`，单个连接关闭失败不阻塞其余连接释放。
- **`connection_id` 解析**：显式传入非空且 trim 后的 id 若不在配置中则报错，**不再静默回退**到默认连接；省略或空/仅空白仍使用默认连接。
- **启动行为**：默认连接 ping 失败仍退出码 `1`；非默认连接 ping 失败时向 stderr 输出告警日志。

### 优化

- 抽取 `src/core/handle-runtime.ts` 统一 `ping` / `close` 调用，减少 `bootstrap` 与 `test_connection` 中的重复分支。
