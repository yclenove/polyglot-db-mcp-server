# polyglot-db-mcp-server

**[简体中文](./README.md) | [English](./README_en.md)**

面向 **MySQL**、**PostgreSQL**、**Microsoft SQL Server**、**Oracle**、**MongoDB**、**Redis**、**SQLite**、**DuckDB** 的多引擎数据库 [Model Context Protocol](https://modelcontextprotocol.io/) 服务。所有连接在单一环境变量 **`DB_MCP_CONNECTIONS`**（JSON 数组）中声明，同一进程可在一次 MCP 会话中暴露多个后端。

NPM 包名：**`@yclenove/polyglot-db-mcp-server`**；安装后 CLI：**`polyglot-db-mcp-server`**（旧名 `unified-db-mcp-server` 已弃用，请在 MCP 配置中更新 command）。

更新记录见 **[CHANGELOG.md](./CHANGELOG.md)**。从单引擎环境变量迁移见 **[MIGRATION.md](./MIGRATION.md)**。

## 环境要求

- Node.js **20+**；推荐 Node.js 24+（与 GitHub Actions CI 一致）

## 5 分钟 SQLite 快速开始

SQLite 不需要外部数据库服务，适合先确认 MCP server 能正常启动。

```bash
npm ci
npm run build
node dist/index.js init
node dist/index.js test
```

`init` 会生成最小 `.env`：

```dotenv
DB_MCP_CONNECTIONS=[{"id":"local","engine":"sqlite","url":"file:./data/local.db","readonly":false}]
DB_MCP_DEFAULT_CONNECTION_ID=local
```

如果 `.env` 已存在，`init` 默认不会覆盖；可使用 `node dist/index.js init --stdout` 查看模板，或使用 `--force` 覆盖。

测试通过后启动 MCP server：

```bash
node dist/index.js
```

在 MCP 客户端里调用 `sql_query`：

```json
{
  "connection_id": "local",
  "sql": "SELECT 1 AS ok"
}
```

已安装 npm 包时，命令名为：

```bash
polyglot-db-mcp-server init
polyglot-db-mcp-server test
polyglot-db-mcp-server
```

## 传输模式

默认仍是 `stdio`，适合 Claude Desktop、Cursor 等本地 MCP 客户端，升级后不需要改现有配置。

显式启用 Streamable HTTP：

```bash
DB_MCP_TRANSPORT=http DB_AUTH_DISABLED=true node dist/index.js
```

或：

```bash
node dist/index.js --transport http --host 127.0.0.1 --port 3000
```

HTTP 模式提供：

- `POST /mcp`：Streamable HTTP MCP endpoint，支持 initialize、tools/list、tools/call。
- `GET /healthz`：进程健康，不 ping 数据库。
- `GET /readyz`：registry 和启动 ping 状态。
- `GET /metrics`：Prometheus text exposition，包含连接、审计和工具调用指标；除显式关闭认证外需要 HTTP 认证。
- `GET/DELETE /mcp`：v1.8.0 返回 405，SSE/resumability 后续迭代。

安全默认值：

- 默认监听 `127.0.0.1`。
- HTTP 模式默认使用 `DB_AUTH_MODE=bearer`，需要配置 issuer/audience/JWKS 和 RBAC policy。
- API key fallback 支持 `Authorization: Bearer <key>` 和 `x-api-key`，仅建议开发/过渡使用。
- 显式 `DB_AUTH_DISABLED=true` 可关闭 HTTP 认证，仅限本地开发。
- `DB_HTTP_ALLOWED_HOSTS` 是 Host allowlist；默认仅允许 `localhost`、`127.0.0.1` 和 `::1`，远程部署必须显式加入服务域名或 IP。
- `DB_HTTP_ORIGINS` 非空时作为 Origin allowlist；带 Origin 且不匹配会被拒绝。
- 可用 `DB_RBAC_POLICY_TEMPLATE=readonly-http` 快速启用内置只读模板；生产建议复制模板后改为 `DB_RBAC_POLICY_FILE`。
- 自定义 RBAC policy 可通过 `conditions.approvalRequired=true` 要求 bearer claims 中存在审批声明，适合保护写入和管理动作。

最小 bearer/RBAC 配置示例：

```bash
DB_MCP_TRANSPORT=http \
DB_AUTH_MODE=bearer \
DB_AUTH_ISSUER=https://idp.example.com/ \
DB_AUTH_AUDIENCE=polyglot-db-mcp-server \
DB_AUTH_JWKS_FILE=./jwks.json \
DB_RBAC_POLICY_FILE=./rbac-policy.json \
node dist/index.js
```

审计持久化可通过 JSONL 文件 sink 开启：

```bash
DB_AUDIT_SINK=file DB_AUDIT_FILE_PATH=./logs/audit.jsonl node dist/index.js
```

也可将审计事件发送到内网 webhook sink：

```bash
DB_AUDIT_SINK=webhook DB_AUDIT_WEBHOOK_URL=https://audit.example.com/mcp node dist/index.js
```

v3.0.0 支持 manifest-first 本地插件。默认关闭；设置 `DB_PLUGIN_PATHS` 后，服务会读取每个插件目录下的 `plugin.json`，校验 manifest，并加载显式配置的本地插件：

```bash
DB_PLUGIN_PATHS=./plugins/clickhouse node dist/index.js
```

可用 `plugin_validate_manifest` 验证 manifest JSON，或用 `plugin_list` 查看已发现插件的脱敏摘要。插件类型覆盖 driver、tool、policy 和 export；插件工具会经过统一授权、审计和可观测 wrapper。

告警 webhook 需要显式开启，可覆盖连接失败、工具错误率和慢工具调用：

```bash
DB_ALERT_ENABLED=true DB_ALERT_WEBHOOK_URL=https://alerts.example.com/mcp node dist/index.js
```

OpenTelemetry traces 也需要显式开启；默认使用 OTLP HTTP traces endpoint：

```bash
DB_OTEL_ENABLED=true DB_OTEL_OTLP_ENDPOINT=http://localhost:4318/v1/traces node dist/index.js
```

HTTP smoke test：

```bash
node scripts/http-smoke.mjs http://127.0.0.1:3000/mcp
```

## 多连接配置

每项需要唯一 **`id`**、**`engine`**。多数 SQL 类引擎使用 **`url`** 或基于 **`host`** 的字段；**DuckDB** 可使用 `url`/`database`，未提供时使用 `:memory:`；**Redis** 与 **MongoDB** 必须提供 **`url`**。

```json
[
  {
    "id": "pg",
    "engine": "postgres",
    "url": "postgres://<pg_user>:<pg_password>@127.0.0.1:5432/<pg_database>",
    "readonly": true
  },
  {
    "id": "my",
    "engine": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "user": "<mysql_user>",
    "password": "<mysql_password>",
    "database": "<mysql_database>",
    "readonly": true
  },
  {
    "id": "rd",
    "engine": "redis",
    "url": "redis://:<redis_password>@127.0.0.1:6379/0",
    "keyPrefix": "app:"
  },
  {
    "id": "mdb",
    "engine": "mongodb",
    "url": "mongodb://<mongo_user>:<mongo_password>@127.0.0.1:27017/?authSource=admin",
    "database": "<mongo_database>",
    "allowlist": ["users", "orders"],
    "readonly": true
  },
  {
    "id": "duck",
    "engine": "duckdb",
    "url": ":memory:",
    "readonly": true,
    "allowlist": ["./data"]
  }
]
```

支持的 `engine`：`mysql`、`postgres`、`mssql`、`oracle`、`mongodb`、`redis`、`sqlite`、`duckdb`。

**SQLite 配置示例**（文件数据库，无需额外服务）：

```json
{
  "id": "local",
  "engine": "sqlite",
  "url": "file:./data/local.db"
}
```

SQLite 支持 `file:` 前缀路径、相对路径、绝对路径和 `:memory:` 内存数据库。文件不存在时自动创建。

**DuckDB 配置示例**（本地只读分析，无需外部服务）：

```json
{
  "id": "duck",
  "engine": "duckdb",
  "url": ":memory:",
  "readonly": true,
  "allowlist": ["./data"]
}
```

DuckDB 连接默认只读；只有显式设置 `readonly:false` 才允许写入。读取 CSV/Parquet/JSON 等外部文件时，路径必须位于 `allowlist` 指定的文件或目录内，否则会被 DuckDB 拒绝。

可选字段：`readonly`、`allowlist`（Mongo 集合白名单或 DuckDB 本地文件路径白名单）、Redis 的 `keyPrefix` 等。

完整配置说明见 [docs/CONFIG.md](./docs/CONFIG.md)，安全模板见 [.env.example](./.env.example)。

## 诊断与排障

- `polyglot-db-mcp-server test`：解析 `.env` 并 ping 所有连接，输出 `code` 和 `hint`。
- `connection_diagnose`：在 MCP 内返回每个连接的状态、延迟、`error_info` 和可执行建议。
- [docs/ERRORS.md](./docs/ERRORS.md)：错误码矩阵和 hint 编写规范。
- [docs/API.md](./docs/API.md)：所有工具参数和常见错误入口。

**默认连接**在启动时必须 ping 成功，否则进程以退出码 `1` 结束。其他连接 ping 失败时会在 stderr 打日志，但不阻止进程启动。

## 本地数据库（Docker）

```bash
docker compose up -d
```

默认账号、密码与端口见 `docker-compose.yml`。MCP 服务默认读取 `docker-compose.env` 中的开发连接配置；本地 `.env` 会在其后加载，可覆盖 `DB_MCP_CONNECTIONS`、`DB_MCP_DEFAULT_CONNECTION_ID` 等设置。

## 工具一览

**连接**

- `list_connections` — 列出已配置的 `connection_id`、`engine`、`readonly`
- `test_connection` — 对指定连接 ping（缺省为默认连接）
- `health_check` — 全面健康检查，测试所有连接的状态和延迟
- `connection_diagnose` — 连接诊断，返回状态、延迟、服务器版本和配置建议
- `prometheus_metrics` — 返回 Prometheus 文本格式指标
- `alert_test` — 发送测试告警并返回脱敏后的告警配置摘要

在任意工具上若**显式传入** `connection_id`，其值必须与配置中的 `id` 一致；**错误或未配置的 id 会报错，不会静默回退到默认连接**。省略或传空/空白则使用默认连接。

**SQL**（MySQL / PostgreSQL / SQL Server / Oracle / SQLite / DuckDB）

- `sql_query` — 有界只读查询（执行前校验），支持分页（`page`、`page_size` 参数）
- `sql_export_query` — 只读查询结果导出为 JSON/CSV/Markdown，导出前执行脱敏并限制最大行数
- `sql_sample_table` — 对表执行只读采样，返回字段类型、空值率、唯一值数量和示例值
- `sql_execute` — 可写 SQL（连接 `readonly=true` 时拒绝）
- `sql_list_tables` — 列出表（PostgreSQL 可选 `schema`）
- `sql_describe_table` — 表结构（列、类型等）
- `sql_begin_transaction` — 开始事务，返回事务 ID
- `sql_execute_in_transaction` — 在事务中执行 SQL
- `sql_commit` — 提交事务
- `sql_rollback` — 回滚事务
- `sql_batch_execute` — 批量执行多条 SQL（在同一事务中）

六个 SQL 驱动会在数据库/游标读取层限制结果，而不是先加载完整结果再截断。分页会多探测一行来计算 `has_next`；`totalRowsExact=false` 时 `totalRows` 只是已观察到的下界，`total_pages` 仅在总数可精确推导时返回。

**MongoDB**

- `mongo_list_collections`、`mongo_find`、`mongo_aggregate`、`mongo_count`
- `mongo_insert_one`、`mongo_insert_many`、`mongo_update_one`、`mongo_delete_one`
- `mongo_begin_transaction`、`mongo_execute_in_transaction`、`mongo_commit`、`mongo_rollback`
- 文档、filter 和 pipeline 参数支持 canonical Extended JSON，例如 `{"id":{"$numberLong":"9007199254740993"}}`。
- `mongo_aggregate` 是只读工具，拒绝 `$out`/`$merge`，并对 `$lookup`、`$graphLookup`、`$unionWith` 执行集合 allowlist 校验。

**Redis**

- `redis_get` — 按字节窗口读取字符串，返回 `total_bytes`、`next_offset_bytes` 和 `truncated`；非完整 UTF-8/二进制窗口通过 `value_base64` 无损返回
- `redis_set`、`redis_del`、`redis_scan`、`redis_blocked_commands`
- `redis_hget`、`redis_hset`、`redis_hgetall`、`redis_hscan`、`redis_hdel`
- `redis_sscan`、`redis_zscan` — 对大型 Set / Sorted Set 执行可续读的游标分页
- `redis_pipeline` — 批量执行安全命令子集；禁止集合物化命令，保留 keyPrefix/readonly 边界

`HGETALL`、`SMEMBERS`、`LRANGE`、`ZRANGE` 的旧兼容工具会在驱动层按 `DB_MAX_ROWS` 拒绝过大的集合或范围。大型 Hash/Set/Sorted Set 应使用对应 SCAN 工具；SCAN cursor 始终以字符串传递，避免 64 位游标精度损失。

**审计**

- `audit_get_recent` — 获取最近的审计日志
- `audit_filter` — 按条件过滤审计日志
- `audit_stats` — 获取审计统计信息
- `export_audit` — 导出审计日志（JSON 格式）

**认证与授权**

- `auth_whoami` — 返回当前认证主体、tenant、scope 和 token roles
- `auth_policy_validate` — 验证 RBAC policy JSON
- `auth_policy_template` — 返回内置 RBAC policy 模板 JSON

**Schema**

- `schema_export` — 导出数据库 Schema 为 JSON 或 SQL DDL 格式
- `schema_diff` — 比较两个 SQL 连接或 schema 的表结构差异

**数据脱敏**

- `set_masking_mode` — 设置脱敏模式（strict/strict-v2/loose/off）
- `get_masking_config` — 获取当前脱敏配置
- `manage_masking_rules` — 管理自定义脱敏规则（添加/删除/列出）

**查询回放**

- `query_history` — 查询历史记录列表
- `query_replay` — 回放指定历史查询
- `query_diff` — 对比两次查询结果

**智能查询建议**

- `query_suggest` — 获取查询优化建议
- `query_optimize` — 分析慢查询并给出建议

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `DB_MCP_CONNECTIONS` | 连接 JSON 数组（必填） |
| `DB_MCP_DEFAULT_CONNECTION_ID` | 可选；须为数组中某条 `id` |
| `DB_MCP_TRANSPORT` | `stdio`（默认）或 `http` |
| `DB_HTTP_HOST`、`DB_HTTP_PORT`、`DB_HTTP_ENDPOINT` | HTTP 监听地址、端口和 MCP endpoint |
| `DB_HTTP_API_KEY`、`DB_HTTP_AUTH_DISABLED`、`DB_HTTP_ALLOWED_HOSTS`、`DB_HTTP_ORIGINS` | HTTP API key、显式关闭认证、Host 和 Origin allowlist |
| `DB_QUERY_TIMEOUT`、`DB_MAX_ROWS`、`DB_MAX_SQL_LENGTH`、`DB_RETRY_COUNT`、`DB_RETRY_DELAY_MS` | 全局执行/结果限制；`DB_MAX_ROWS` 同时约束 SQL 行数和 Redis 集合读取 |
| `DB_MAX_RESPONSE_BYTES` | 所有 MCP 工具序列化结果硬上限，默认 1 MiB；有效范围 4 KiB..16 MiB |
| `DB_MONGO_MAX_TIME_MS` | MongoDB `find`/`aggregate`/`count` 服务端超时；默认 `30000`，`0` 表示关闭 |
| `DB_MASKING_MODE` | 脱敏模式：`off`（默认）、`loose`、`strict`、`strict-v2` |
| `DB_MASKING_EXCLUDE_FIELDS` | 白名单字段（逗号分隔），这些字段不脱敏 |
| `DB_MASKING_EXCLUDE_CONNECTIONS` | 排除脱敏的连接 ID（逗号分隔） |
| `DB_AUDIT_SINK`、`DB_AUDIT_FILE_PATH`、`DB_AUDIT_WEBHOOK_URL` | 审计内存、文件或 webhook sink |
| `DB_REPLAY_BUFFER_SIZE` | 查询历史缓冲大小，默认 50 |
| `DB_SUGGEST_TIMEOUT_MS` | 查询建议分析超时（ms），默认 5000 |
| `DB_ALERT_ENABLED`、`DB_ALERT_WEBHOOK_URL` | 显式启用 webhook 告警 |
| `DB_OTEL_ENABLED`、`DB_OTEL_OTLP_ENDPOINT` | 显式启用 OpenTelemetry traces exporter |
| `DB_TRANSACTION_TIMEOUT_MS`、`DB_MONGO_TRANSACTION_TIMEOUT_MS` | SQL/Mongo 事务清理超时 |
| `LOG_LEVEL` | 日志级别：`debug`、`info`（默认）、`warn`、`error` |
| `LOG_FORMAT` | 日志格式：`json` 或人类可读（默认） |

## 测试

```bash
# 运行所有测试
npm test

# 仅运行单元测试
npm run test:unit

# 运行集成测试（需要真实数据库）
npm run test:integration

# 代码检查
npm run lint

# 代码格式化
npm run format
```

## 许可证

MIT
