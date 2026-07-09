# polyglot-db-mcp-server

**[简体中文](./README.md) | [English](./README_en.md)**

面向 **MySQL**、**PostgreSQL**、**Microsoft SQL Server**、**Oracle**、**MongoDB**、**Redis**、**SQLite** 的多引擎数据库 [Model Context Protocol](https://modelcontextprotocol.io/) 服务。所有连接在单一环境变量 **`DB_MCP_CONNECTIONS`**（JSON 数组）中声明，同一进程可在一次 MCP 会话中暴露多个后端。

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
- `GET/DELETE /mcp`：v1.8.0 返回 405，SSE/resumability 后续迭代。

安全默认值：

- 默认监听 `127.0.0.1`。
- HTTP 模式默认使用 `DB_AUTH_MODE=bearer`，需要配置 issuer/audience/JWKS 和 RBAC policy。
- API key fallback 支持 `Authorization: Bearer <key>` 和 `x-api-key`，仅建议开发/过渡使用。
- 显式 `DB_AUTH_DISABLED=true` 可关闭 HTTP 认证，仅限本地开发。
- `DB_HTTP_ORIGINS` 非空时作为 Origin allowlist；带 Origin 且不匹配会被拒绝。

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

HTTP smoke test：

```bash
node scripts/http-smoke.mjs http://127.0.0.1:3000/mcp
```

## 多连接配置

每项需要唯一 **`id`**、**`engine`**，以及 SQL 类引擎的 **`url`** 或基于 **`host`** 的字段；**Redis** 与 **MongoDB** 必须提供 **`url`**。

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
  }
]
```

支持的 `engine`：`mysql`、`postgres`、`mssql`、`oracle`、`mongodb`、`redis`、`sqlite`。

**SQLite 配置示例**（文件数据库，无需额外服务）：

```json
{
  "id": "local",
  "engine": "sqlite",
  "url": "file:./data/local.db"
}
```

SQLite 支持 `file:` 前缀路径、相对路径、绝对路径和 `:memory:` 内存数据库。文件不存在时自动创建。

可选字段：`readonly`、`allowlist`（Mongo 库名白名单）、Redis 的 `keyPrefix` 等。

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

在任意工具上若**显式传入** `connection_id`，其值必须与配置中的 `id` 一致；**错误或未配置的 id 会报错，不会静默回退到默认连接**。省略或传空/空白则使用默认连接。

**SQL**（MySQL / PostgreSQL / SQL Server / Oracle / SQLite）

- `sql_query` — 仅只读查询（执行前校验），支持分页（`page`、`page_size` 参数）
- `sql_execute` — 可写 SQL（连接 `readonly=true` 时拒绝）
- `sql_list_tables` — 列出表（PostgreSQL 可选 `schema`）
- `sql_describe_table` — 表结构（列、类型等）
- `sql_begin_transaction` — 开始事务，返回事务 ID
- `sql_execute_in_transaction` — 在事务中执行 SQL
- `sql_commit` — 提交事务
- `sql_rollback` — 回滚事务
- `sql_batch_execute` — 批量执行多条 SQL（在同一事务中）

**MongoDB**

- `mongo_list_collections`、`mongo_find`、`mongo_aggregate`、`mongo_count`
- `mongo_insert_one`、`mongo_insert_many`、`mongo_update_one`、`mongo_delete_one`
- `mongo_begin_transaction`、`mongo_execute_in_transaction`、`mongo_commit`、`mongo_rollback`

**Redis**

- `redis_get`、`redis_set`、`redis_del`、`redis_scan`、`redis_blocked_commands`
- `redis_hget`、`redis_hset`、`redis_hgetall`、`redis_hdel`
- `redis_pipeline` — 批量执行安全命令子集，保留 keyPrefix/readonly 边界

**审计**

- `audit_get_recent` — 获取最近的审计日志
- `audit_filter` — 按条件过滤审计日志
- `audit_stats` — 获取审计统计信息
- `export_audit` — 导出审计日志（JSON 格式）

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
| `DB_HTTP_API_KEY`、`DB_HTTP_AUTH_DISABLED`、`DB_HTTP_ORIGINS` | HTTP API key、显式关闭认证和 Origin allowlist |
| `DB_QUERY_TIMEOUT`、`DB_MAX_ROWS`、`DB_MAX_SQL_LENGTH`、`DB_RETRY_COUNT`、`DB_RETRY_DELAY_MS` | 全局 SQL 限制（见 `src/core/config.ts`） |
| `DB_MASKING_MODE` | 脱敏模式：`off`（默认）、`loose`、`strict`、`strict-v2` |
| `DB_MASKING_EXCLUDE_FIELDS` | 白名单字段（逗号分隔），这些字段不脱敏 |
| `DB_MASKING_EXCLUDE_CONNECTIONS` | 排除脱敏的连接 ID（逗号分隔） |
| `DB_REPLAY_BUFFER_SIZE` | 查询历史缓冲大小，默认 50 |
| `DB_SUGGEST_TIMEOUT_MS` | 查询建议分析超时（ms），默认 5000 |
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
