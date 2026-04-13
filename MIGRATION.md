# Migration from single-engine env vars

> 仓库与包曾用名 **`unified-db-mcp-server`** / `@yclenove/unified-db-mcp-server`，已更名为 **`polyglot-db-mcp-server`** / `@yclenove/polyglot-db-mcp-server`；可执行文件为 **`polyglot-db-mcp-server`**。

Older MCP servers often used isolated variables such as `MYSQL_HOST`, `PGHOST`, `PGUSER`, etc. This project uses a single JSON document: **`DB_MCP_CONNECTIONS`**.

## MySQL (`MYSQL_*` style)

Typical mapping:

| Legacy | `DB_MCP_CONNECTIONS` field |
| --- | --- |
| `MYSQL_HOST` / host | `host` |
| `MYSQL_PORT` | `port` |
| `MYSQL_USER` | `user` |
| `MYSQL_PASSWORD` | `password` |
| `MYSQL_DATABASE` | `database` |

Alternatively build one `url` (for example `mysql://user:pass@host:3306/db`) and omit discrete host fields.

## PostgreSQL (`PG*` / libpq style)

| Legacy | Field |
| --- | --- |
| `PGHOST` | `host` |
| `PGPORT` | `port` |
| `PGUSER` | `user` |
| `PGPASSWORD` | `password` |
| `PGDATABASE` | `database` |

Or use a single `postgres://...` / `postgresql://...` URL in `url`.

## Default connection

If you previously relied on implicit defaults, set `DB_MCP_DEFAULT_CONNECTION_ID` to the `id` of the connection that should answer tools when `connection_id` is omitted.

## `connection_id` validation (behavior change)

If `connection_id` is omitted or empty/whitespace, tools use the default connection. If you pass a **non-empty** `connection_id` that is not in `DB_MCP_CONNECTIONS`, the server returns an error instead of silently using the default—fix the id or omit the parameter.

## Read-only mode

Map previous read-only flags to `"readonly": true` on the specific connection object.

## Next steps

1. Compose JSON for each engine you need.
2. Export `DB_MCP_CONNECTIONS` (PowerShell: `setx` / `$env:...` for the session).
3. Run `npm run build && node dist/index.js` and confirm the startup ping succeeds.