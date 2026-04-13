# polyglot-db-mcp-server

**[简体中文](./README.md) | English**

A multi-engine database [Model Context Protocol](https://modelcontextprotocol.io/) server for **MySQL**, **PostgreSQL**, **Microsoft SQL Server**, **Oracle**, **MongoDB**, and **Redis**. Connections are declared in a single environment variable **`DB_MCP_CONNECTIONS`** (a JSON array) so one process can expose multiple backends in one MCP session.

NPM package: **`@yclenove/polyglot-db-mcp-server`**. CLI after install: **`polyglot-db-mcp-server`** (the old name `unified-db-mcp-server` is deprecated—update the `command` in your MCP config).

See **[CHANGELOG.md](./CHANGELOG.md)** for release notes. Migration from single-engine env vars: **[MIGRATION.md](./MIGRATION.md)**.

## Requirements

- **Node.js 24+** recommended (matches GitHub Actions CI; Node 20+ often works)
- **`DB_MCP_CONNECTIONS`** must be a JSON **array** of connection objects (example below)

## Quick start

```bash
npm install
npm run build
```

Set `DB_MCP_CONNECTIONS` (and optionally `DB_MCP_DEFAULT_CONNECTION_ID`), then:

```bash
node dist/index.js
```

The **default** connection must pass a ping at startup; otherwise the process exits with code `1`. Failures on **non-default** connections are logged to stderr but do not stop startup.

## `DB_MCP_CONNECTIONS` example

Each entry needs a unique **`id`**, **`engine`**, and either **`url`** or (for SQL engines) **`host`**. **Redis** and **MongoDB** require **`url`**.

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

Optional fields include `readonly`, MongoDB `allowlist`, and Redis `keyPrefix`.

## Local databases with Docker

```bash
docker compose up -d
```

See `docker-compose.yml` for default users, passwords, and published ports.

## Tools

**Connections**

- `list_connections` — list configured `connection_id`, `engine`, and `readonly`
- `test_connection` — ping a connection (defaults to the configured default)

When you **explicitly** pass `connection_id` on any tool, it must match a configured `id`. Invalid ids are **rejected** and do **not** fall back to the default. Omit the parameter or pass empty/whitespace to use the default connection.

**SQL** (MySQL / PostgreSQL / SQL Server / Oracle)

- `sql_query` — read-only queries only (validated before execution)
- `sql_execute` — write-capable SQL (blocked when connection is `readonly`)
- `sql_list_tables` — list tables (optional `schema` for PostgreSQL)
- `sql_describe_table` — column metadata for a table

**MongoDB**

- `mongo_list_collections`, `mongo_find`, `mongo_aggregate`, `mongo_count`

**Redis**

- `redis_get`, `redis_set`, `redis_del`, `redis_scan`, `redis_blocked_commands`

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DB_MCP_CONNECTIONS` | JSON array of connections (required) |
| `DB_MCP_DEFAULT_CONNECTION_ID` | Optional; must match an `id` in the array |
| `DB_QUERY_TIMEOUT`, `DB_MAX_ROWS`, `DB_MAX_SQL_LENGTH`, `DB_RETRY_COUNT`, `DB_RETRY_DELAY_MS` | Global SQL limits (see `src/core/config.ts`) |

## License

MIT
