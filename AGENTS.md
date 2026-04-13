# AGENTS.md

Guidance for autonomous agents working in this repository (**polyglot-db-mcp-server**，多引擎数据库 MCP）。

## Scope

- Prefer **small, task-focused diffs**. Do not refactor unrelated modules.
- Match existing TypeScript style: ESM imports with `.js` extensions, `strict` mode, NodeNext resolution.

## Runtime model

- `src/index.ts` loads `.env` from the process cwd, builds a `ConnectionRegistry` from `DB_MCP_CONNECTIONS`, pings **all** connections, and **exits non-zero** if the **default** connection ping fails.
- Tool handlers live under `src/tools/*`; drivers under `src/drivers/*`.
- `sql_query` must stay **read-only at the MCP layer** (`isReadOnlyQuery` before `execute`). Drivers also enforce readonly mode.

## Testing

- Run `npm run build` before `npm test` (tests import compiled files from `dist/`).
- Keep new tests deterministic (no real network unless explicitly requested).

## Secrets

- Never commit real connection strings or `.env` files with production credentials.