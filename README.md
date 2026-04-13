# polyglot-db-mcp-server

**[简体中文](./README.md) | [English](./README_en.md)**

面向 **MySQL**、**PostgreSQL**、**Microsoft SQL Server**、**Oracle**、**MongoDB**、**Redis** 的多引擎数据库 [Model Context Protocol](https://modelcontextprotocol.io/) 服务。所有连接在单一环境变量 **`DB_MCP_CONNECTIONS`**（JSON 数组）中声明，同一进程可在一次 MCP 会话中暴露多个后端。

NPM 包名：**`@yclenove/polyglot-db-mcp-server`**；安装后 CLI：**`polyglot-db-mcp-server`**（旧名 `unified-db-mcp-server` 已弃用，请在 MCP 配置中更新 command）。

更新记录见 **[CHANGELOG.md](./CHANGELOG.md)**。从单引擎环境变量迁移见 **[MIGRATION.md](./MIGRATION.md)**。

## 环境要求

- 推荐使用 **Node.js 24+**（与 GitHub Actions CI 一致；Node 20+ 多数场景仍可用）
- 必须设置 **`DB_MCP_CONNECTIONS`** 为连接对象的 JSON **数组**（见下文示例）

## 快速开始

```bash
npm install
npm run build
```

配置 `DB_MCP_CONNECTIONS`（可选 `DB_MCP_DEFAULT_CONNECTION_ID`）后：

```bash
node dist/index.js
```

**默认连接**在启动时必须 ping 成功，否则进程以退出码 `1` 结束。其他连接 ping 失败时会在 stderr 打日志，但不阻止进程启动（仅默认失败会退出）。

## `DB_MCP_CONNECTIONS` 示例

每项需要唯一 **`id`**、**`engine`**，以及 SQL 类引擎的 **`url`** 或基于 **`host`** 的字段；**Redis** 与 **MongoDB** 必须提供 **`url`**。

```json
[
  {
    "id": "pg",
    "engine": "postgres",
    "url": "postgres://dev:devpass@127.0.0.1:5432/devdb"
  },
  {
    "id": "my",
    "engine": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "user": "dev",
    "password": "devpass",
    "database": "devdb",
    "readonly": false
  },
  {
    "id": "rd",
    "engine": "redis",
    "url": "redis://:redispass@127.0.0.1:6379/0",
    "keyPrefix": "app:"
  },
  {
    "id": "mdb",
    "engine": "mongodb",
    "url": "mongodb://dev:devpass@127.0.0.1:27017/?authSource=admin"
  }
]
```

支持的 `engine`：`mysql`、`postgres`、`mssql`、`oracle`、`mongodb`、`redis`。

可选字段：`readonly`、`allowlist`（Mongo 库名白名单）、Redis 的 `keyPrefix` 等。

## 本地数据库（Docker）

```bash
docker compose up -d
```

默认账号、密码与端口见 `docker-compose.yml`。

## 工具一览

**连接**

- `list_connections` — 列出已配置的 `connection_id`、`engine`、`readonly`
- `test_connection` — 对指定连接 ping（缺省为默认连接）

在任意工具上若**显式传入** `connection_id`，其值必须与配置中的 `id` 一致；**错误或未配置的 id 会报错，不会静默回退到默认连接**。省略或传空/空白则使用默认连接。

**SQL**（MySQL / PostgreSQL / SQL Server / Oracle）

- `sql_query` — 仅只读查询（执行前校验）
- `sql_execute` — 可写 SQL（连接 `readonly=true` 时拒绝）
- `sql_list_tables` — 列出表（PostgreSQL 可选 `schema`）
- `sql_describe_table` — 表结构（列、类型等）

**MongoDB**

- `mongo_list_collections`、`mongo_find`、`mongo_aggregate`、`mongo_count`

**Redis**

- `redis_get`、`redis_set`、`redis_del`、`redis_scan`、`redis_blocked_commands`

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `DB_MCP_CONNECTIONS` | 连接 JSON 数组（必填） |
| `DB_MCP_DEFAULT_CONNECTION_ID` | 可选；须为数组中某条 `id` |
| `DB_QUERY_TIMEOUT`、`DB_MAX_ROWS`、`DB_MAX_SQL_LENGTH`、`DB_RETRY_COUNT`、`DB_RETRY_DELAY_MS` | 全局 SQL 限制（见 `src/core/config.ts`） |

## 许可证

MIT
