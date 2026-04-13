# polyglot-db-mcp-server

Multi-engine database [Model Context Protocol](https://modelcontextprotocol.io/) server for **MySQL**, **PostgreSQL**, **Microsoft SQL Server**, **Oracle**, **MongoDB**, and **Redis**. Connections are declared in a single JSON environment variable so one process can expose multiple backends through one MCP session.

NPM 包名：**`@yclenove/polyglot-db-mcp-server`**；安装后 CLI：**`polyglot-db-mcp-server`**（与旧名 `unified-db-mcp-server` 不同，请更新 MCP 配置里的 command）。

## Requirements

- Node.js 24+ recommended（与 GitHub Actions CI 一致；20+ 通常仍可运行）
- `DB_MCP_CONNECTIONS` set to a JSON **array** of connection objects (see below)

## Quick start

```bash
npm install
npm run build
```

Set `DB_MCP_CONNECTIONS` (and optionally `DB_MCP_DEFAULT_CONNECTION_ID`), then:

```bash
node dist/index.js
```

The default connection must pass a ping at startup; otherwise the process exits with code `1`.

## `DB_MCP_CONNECTIONS` example

Each entry needs a unique `id`, an `engine`, and either `url` or (for SQL engines) `host`-based fields. Redis and MongoDB require `url`.

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

Engines: `mysql`, `postgres`, `mssql`, `oracle`, `mongodb`, `redis`.

Optional fields include `readonly`, `allowlist` (Mongo database allowlist), and Redis `keyPrefix`.

## Local databases with Docker

```bash
docker compose up -d
```

See `docker-compose.yml` for default users, passwords, and published ports.

## Tools exposed by this server

**Connections**

- `list_connections` — list configured `connection_id`, `engine`, and `readonly`
- `test_connection` — ping a connection (defaults to the configured default)

When you pass `connection_id` on any tool, it must match a configured `id`. Invalid or mistyped ids are rejected and do **not** fall back to the default connection.

**SQL** (MySQL / PostgreSQL / SQL Server / Oracle)

- `sql_query` — read-only queries only (validated before execution)
- `sql_execute` — write-capable SQL (blocked when connection is `readonly`)
- `sql_list_tables` — list tables (optional `schema` for PostgreSQL)
- `sql_describe_table` — column metadata for a table

**MongoDB**

- `mongo_list_collections`
- `mongo_find`
- `mongo_aggregate`
- `mongo_count`

**Redis**

- `redis_get`
- `redis_set`
- `redis_del`
- `redis_scan`
- `redis_blocked_commands`

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DB_MCP_CONNECTIONS` | JSON array of connections (required) |
| `DB_MCP_DEFAULT_CONNECTION_ID` | Optional; must match an `id` in the array |
| `DB_QUERY_TIMEOUT`, `DB_MAX_ROWS`, `DB_MAX_SQL_LENGTH`, `DB_RETRY_COUNT`, `DB_RETRY_DELAY_MS` | Global SQL limits (see `src/core/config.ts`) |

## License

MIT