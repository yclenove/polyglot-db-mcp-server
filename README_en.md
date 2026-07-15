# polyglot-db-mcp-server

**[简体中文](./README.md) | English**

A multi-engine database [Model Context Protocol](https://modelcontextprotocol.io/) server for **MySQL**, **PostgreSQL**, **Microsoft SQL Server**, **Oracle**, **MongoDB**, **Redis**, **SQLite**, and **DuckDB**. Connections are declared in a single environment variable **`DB_MCP_CONNECTIONS`** (a JSON array) so one process can expose multiple backends in one MCP session.

NPM package: **`@yclenove/polyglot-db-mcp-server`**. CLI after install: **`polyglot-db-mcp-server`** (the old name `unified-db-mcp-server` is deprecated—update the `command` in your MCP config).

See **[CHANGELOG.md](./CHANGELOG.md)** for release notes. Migration from single-engine env vars: **[MIGRATION.md](./MIGRATION.md)**.

## Requirements

- **Node.js 20+**; Node.js 24+ is recommended and matches GitHub Actions CI

## 5-Minute SQLite Quick Start

SQLite does not require an external database service, so it is the fastest way to verify the server.

```bash
npm ci
npm run build
node dist/index.js init
node dist/index.js test
node dist/index.js
```

`init` writes the minimal `.env` below unless `.env` already exists:

```dotenv
DB_MCP_CONNECTIONS=[{"id":"local","engine":"sqlite","url":"file:./data/local.db","readonly":false}]
DB_MCP_DEFAULT_CONNECTION_ID=local
```

If `.env` already exists, `init` will not overwrite it. Use `node dist/index.js init --stdout` to print the template, or `--force` to overwrite.

Call `sql_query` from your MCP client:

```json
{
  "connection_id": "local",
  "sql": "SELECT 1 AS ok"
}
```

When installed from npm, use:

```bash
polyglot-db-mcp-server init
polyglot-db-mcp-server test
polyglot-db-mcp-server
```

## Transport Modes

The default transport is still `stdio`, so existing desktop MCP client configs keep working.

Enable Streamable HTTP explicitly:

```bash
DB_MCP_TRANSPORT=http DB_AUTH_DISABLED=true node dist/index.js
```

Or:

```bash
node dist/index.js --transport http --host 127.0.0.1 --port 3000
```

HTTP mode provides:

- `POST /mcp`: Streamable HTTP MCP endpoint for initialize, tools/list, and tools/call.
- `GET /healthz`: process health without pinging databases.
- `GET /readyz`: registry and startup ping readiness.
- `GET /metrics`: Prometheus text exposition for connection, audit, and tool-call metrics; it requires HTTP auth unless auth is explicitly disabled.
- `GET/DELETE /mcp`: returns 405 in v1.8.0; SSE/resumability are planned later.

Security defaults:

- Listens on `127.0.0.1` by default.
- HTTP defaults to `DB_AUTH_MODE=bearer`; configure issuer/audience/JWKS and an RBAC policy.
- API key fallback accepts `Authorization: Bearer <key>` or `x-api-key`, and is intended for development or migration only.
- `DB_AUTH_DISABLED=true` disables HTTP auth explicitly for local development.
- `DB_HTTP_ALLOWED_HOSTS` is the Host allowlist. Only `localhost`, `127.0.0.1`, and `::1` are allowed by default; remote deployments must add their hostname or IP explicitly.
- `DB_HTTP_ORIGINS` is the Origin allowlist; unmatched Origin headers are rejected.
- Use `DB_RBAC_POLICY_TEMPLATE=readonly-http` for a built-in readonly starter policy; production deployments should copy and tighten it as `DB_RBAC_POLICY_FILE`.
- Custom RBAC policies can set `conditions.approvalRequired=true` to require an approval claim in verified bearer claims for write or admin actions.

Minimal bearer/RBAC example:

```bash
DB_MCP_TRANSPORT=http \
DB_AUTH_MODE=bearer \
DB_AUTH_ISSUER=https://idp.example.com/ \
DB_AUTH_AUDIENCE=polyglot-db-mcp-server \
DB_AUTH_JWKS_FILE=./jwks.json \
DB_RBAC_POLICY_FILE=./rbac-policy.json \
node dist/index.js
```

Enable persistent audit JSONL output with:

```bash
DB_AUDIT_SINK=file DB_AUDIT_FILE_PATH=./logs/audit.jsonl node dist/index.js
```

Or send audit events to an internal webhook sink:

```bash
DB_AUDIT_SINK=webhook DB_AUDIT_WEBHOOK_URL=https://audit.example.com/mcp node dist/index.js
```

v3.0.0 supports manifest-first local plugins. Plugins are disabled by default; set `DB_PLUGIN_PATHS` to read each plugin directory's `plugin.json`, validate the manifest, and load explicitly configured local plugins:

```bash
DB_PLUGIN_PATHS=./plugins/clickhouse node dist/index.js
```

Use `plugin_validate_manifest` to validate manifest JSON, or `plugin_list` to inspect the sanitized discovery summary. Plugin types cover driver, tool, policy, and export; plugin tools go through the unified authorization, audit, and observability wrapper.

Alert webhooks are explicit opt-in and cover connection failures, tool error-rate spikes, and slow tool calls:

```bash
DB_ALERT_ENABLED=true DB_ALERT_WEBHOOK_URL=https://alerts.example.com/mcp node dist/index.js
```

OpenTelemetry traces are also explicit opt-in and default to OTLP HTTP traces:

```bash
DB_OTEL_ENABLED=true DB_OTEL_OTLP_ENDPOINT=http://localhost:4318/v1/traces node dist/index.js
```

Smoke test:

```bash
node scripts/http-smoke.mjs http://127.0.0.1:3000/mcp
```

## Multi-Connection Configuration

Each entry needs a unique **`id`** and **`engine`**. Most SQL engines use either **`url`** or **`host`** fields; **DuckDB** can use `url`/`database` and falls back to `:memory:` when omitted. **Redis** and **MongoDB** require **`url`**.

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

Engines: `mysql`, `postgres`, `mssql`, `oracle`, `mongodb`, `redis`, `sqlite`, `duckdb`.

DuckDB defaults to read-only mode; set `readonly:false` only when writes are intentional. CSV/Parquet/JSON file reads must stay under `allowlist` files or directories, otherwise DuckDB rejects the access.

Optional fields include `readonly`, MongoDB/DuckDB `allowlist`, and Redis `keyPrefix`.

See [docs/CONFIG.md](./docs/CONFIG.md) and [.env.example](./.env.example) for the full configuration reference.

## Diagnostics

- `polyglot-db-mcp-server test`: parses `.env`, pings every connection, and prints `code` plus `hint` for failures.
- `connection_diagnose`: returns status, latency, `error_info`, and actionable suggestions inside MCP.
- [docs/ERRORS.md](./docs/ERRORS.md): error-code matrix and hint conventions.
- [docs/API.md](./docs/API.md): tool parameters and common error entry points.

The **default** connection must pass a ping at startup; otherwise the process exits with code `1`. Failures on **non-default** connections are logged to stderr but do not stop startup.

## Local databases with Docker

```bash
docker compose up -d
```

See `docker-compose.yml` for default users, passwords, and published ports. The MCP service loads development connection defaults from `docker-compose.env`; a local `.env` is loaded after it and can override `DB_MCP_CONNECTIONS`, `DB_MCP_DEFAULT_CONNECTION_ID`, and related settings.

## Tools

**Connections**

- `list_connections` — list configured `connection_id`, `engine`, and `readonly`
- `test_connection` — ping a connection (defaults to the configured default)
- `health_check`, `connection_diagnose` — health and connection diagnostics
- `prometheus_metrics` — Prometheus text metrics
- `alert_test` — send a test alert and return a redacted alert configuration summary

When you **explicitly** pass `connection_id` on any tool, it must match a configured `id`. Invalid ids are **rejected** and do **not** fall back to the default. Omit the parameter or pass empty/whitespace to use the default connection.

**SQL** (MySQL / PostgreSQL / SQL Server / Oracle / SQLite / DuckDB)

- `sql_query` — read-only queries only (validated before execution)
- `sql_export_query` — export read-only query results as JSON/CSV/Markdown after masking and row limiting
- `sql_sample_table` — read-only table sampling with field types, null ratios, unique counts, and examples
- `sql_execute` — write-capable SQL (blocked when connection is `readonly`)
- `sql_list_tables` — list tables (optional `schema` for PostgreSQL)
- `sql_describe_table` — column metadata for a table
- `schema_export`, `schema_diff` — export or compare SQL schemas

**MongoDB**

- `mongo_list_collections`, `mongo_find`, `mongo_aggregate`, `mongo_count`
- `mongo_begin_transaction`, `mongo_execute_in_transaction`, `mongo_commit`, `mongo_rollback`

**Redis**

- `redis_get`, `redis_set`, `redis_del`, `redis_scan`, `redis_blocked_commands`
- `redis_pipeline` — batch a safe Redis command subset while preserving keyPrefix/readonly boundaries

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DB_MCP_CONNECTIONS` | JSON array of connections (required) |
| `DB_MCP_DEFAULT_CONNECTION_ID` | Optional; must match an `id` in the array |
| `DB_MCP_TRANSPORT` | `stdio` by default, or `http` |
| `DB_HTTP_HOST`, `DB_HTTP_PORT`, `DB_HTTP_ENDPOINT` | HTTP bind host, port, and MCP endpoint |
| `DB_HTTP_API_KEY`, `DB_HTTP_AUTH_DISABLED`, `DB_HTTP_ALLOWED_HOSTS`, `DB_HTTP_ORIGINS` | HTTP API key, explicit auth disable flag, and Host/Origin allowlists |
| `DB_QUERY_TIMEOUT`, `DB_MAX_ROWS`, `DB_MAX_SQL_LENGTH`, `DB_RETRY_COUNT`, `DB_RETRY_DELAY_MS` | Global SQL limits (see `src/core/config.ts`) |
| `DB_AUDIT_SINK`, `DB_AUDIT_FILE_PATH`, `DB_AUDIT_WEBHOOK_URL` | In-memory, file, or webhook audit sink |
| `DB_ALERT_ENABLED`, `DB_ALERT_WEBHOOK_URL` | Explicit opt-in webhook alerts |
| `DB_OTEL_ENABLED`, `DB_OTEL_OTLP_ENDPOINT` | Explicit opt-in OpenTelemetry trace exporter |
| `DB_TRANSACTION_TIMEOUT_MS`, `DB_MONGO_TRANSACTION_TIMEOUT_MS` | SQL/Mongo transaction cleanup timeouts |

## License

MIT
