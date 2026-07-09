# 配置指南

**文档编号**: CONFIG
**版本**: 2.1
**日期**: 2026-07-10
**状态**: 当前有效
**适用版本**: v2.1.x+

---

## 一、配置原则

polyglot-db-mcp-server 通过环境变量配置。启动时会从当前工作目录加载 `.env`，并解析 `DB_MCP_CONNECTIONS` 构建连接注册表。

仓库提供 `.env.example` 作为安全模板。复制它到 `.env` 后再修改；`.env` 和 `.env.*` 默认被 Git 忽略，`.env.example` 只允许出现本地开发值或占位符。

配置设计原则：

1. **单一连接入口**：所有数据库连接放在 `DB_MCP_CONNECTIONS` JSON 数组中。
2. **默认安全**：建议生产环境默认 `readonly: true`，只对明确需要写入的连接关闭只读。
3. **敏感信息不入库**：不要提交 `.env`、生产密码、真实 token 或完整生产连接串。
4. **显式默认连接**：多连接场景建议设置 `DB_MCP_DEFAULT_CONNECTION_ID`。
5. **限制优先**：生产环境必须配置最大行数、SQL 长度、超时、限流和脱敏。

---

## 二、最小 SQLite 配置

适合本地 5 分钟快速开始，不依赖外部数据库服务。

可以直接运行：

```powershell
polyglot-db-mcp-server init
```

或在源码仓库内运行：

```powershell
node dist/index.js init
```

```env
DB_MCP_CONNECTIONS=[{"id":"local","engine":"sqlite","url":"file:./data/local.db","readonly":false}]
DB_MCP_DEFAULT_CONNECTION_ID=local
DB_MAX_ROWS=100
DB_QUERY_TIMEOUT=30000
DB_MAX_SQL_LENGTH=102400
LOG_LEVEL=info
LOG_FORMAT=human
```

说明：

- `file:./data/local.db` 相对进程当前工作目录解析。
- SQLite 未提供 `url` 或 `database` 时可默认使用内存数据库，但推荐显式配置文件路径。
- 本地演示可以 `readonly:false`；生产或共享环境建议只读。

---

## 三、多连接配置示例

> 以下示例只使用开发占位符，不可直接作为生产凭证。

```env
DB_MCP_CONNECTIONS=[{"id":"pg","engine":"postgres","url":"postgres://<pg_user>:<pg_password>@127.0.0.1:5432/<pg_database>","readonly":true},{"id":"mysql","engine":"mysql","host":"127.0.0.1","port":3306,"user":"<mysql_user>","password":"<mysql_password>","database":"<mysql_database>","readonly":true},{"id":"redis","engine":"redis","url":"redis://:<redis_password>@127.0.0.1:6379/0","readonly":false,"keyPrefix":"app:"},{"id":"mongo","engine":"mongodb","url":"mongodb://<mongo_user>:<mongo_password>@127.0.0.1:27017/?authSource=admin","database":"<mongo_database>","readonly":true,"allowlist":["users","orders"]},{"id":"local","engine":"sqlite","url":"file:./data/local.db","readonly":false},{"id":"duck","engine":"duckdb","url":":memory:","readonly":true,"allowlist":["./data"]}]
DB_MCP_DEFAULT_CONNECTION_ID=local
```

建议：

- Redis 写操作必须配合 `keyPrefix` 限制业务前缀。
- MongoDB 建议使用 `allowlist` 限制集合。
- SQL 连接建议生产默认 `readonly:true`，写入场景使用独立连接 id。
- DuckDB 默认只读；读取 CSV/Parquet/JSON 等外部文件时必须配置 `allowlist`。

---

## 四、连接对象字段

| 字段 | 类型 | 适用引擎 | 必填 | 说明 |
|------|------|----------|------|------|
| `id` | string | 全部 | 是 | 只能使用字母、数字、下划线 |
| `engine` | string | 全部 | 是 | `mysql`、`postgres`、`mssql`、`oracle`、`sqlite`、`duckdb`、`mongodb`、`redis` |
| `url` | string | 推荐全部 | 条件 | Redis/MongoDB 必填；多数 SQL 可用 url 或 host；DuckDB 可省略 |
| `host` | string | SQL | 条件 | 未提供 url 时使用 |
| `port` | number | SQL | 否 | 1-65535 |
| `user` | string | SQL | 否 | 用户名 |
| `password` | string | SQL | 否 | 密码；不要提交真实值 |
| `database` | string | SQL/Mongo/SQLite/DuckDB | 否 | 数据库名，或 SQLite/DuckDB 路径替代 |
| `readonly` | boolean | 全部 | 否 | 默认 `false`；DuckDB 默认 `true`；生产建议显式设置 |
| `allowlist` | string[] | MongoDB/DuckDB | 否 | MongoDB 允许访问的集合；DuckDB 允许读取的本地文件或目录 |
| `keyPrefix` | string | Redis | 否 | 限制 key 必须以此前缀开头 |

---

## 五、环境变量总表

### 5.1 核心连接

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `DB_MCP_CONNECTIONS` | 无 | 必填，连接 JSON 数组 |
| `DB_MCP_DEFAULT_CONNECTION_ID` | 第一条连接 | 默认连接 id；若不存在则回退第一条 |

### 5.2 查询限制与重试

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `DB_QUERY_TIMEOUT` | `30000` | 查询超时，毫秒 |
| `DB_MAX_ROWS` | `100` | 单次结果最大行数 |
| `DB_MAX_SQL_LENGTH` | `102400` | SQL 最大长度 |
| `DB_RETRY_COUNT` | `2` | SQL 驱动重试次数 |
| `DB_RETRY_DELAY_MS` | `200` | 重试间隔 |
| `DB_AUTO_PAGINATION` | `true` | `sql_query` 是否自动追加分页 |
| `DB_TRANSACTION_TIMEOUT_MS` | `300000` | SQL 事务超时自动回滚 |

### 5.3 缓存、限流、回放和建议

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `DB_QUERY_CACHE_SIZE` | `0` | 查询缓存大小，0 表示关闭 |
| `DB_QUERY_CACHE_TTL_MS` | `30000` | 查询缓存 TTL |
| `DB_RATE_LIMIT_PER_SECOND` | `0` | 每连接每秒速率限制，0 表示不限 |
| `DB_REPLAY_BUFFER_SIZE` | `50` | 查询回放历史缓冲大小 |
| `DB_SUGGEST_TIMEOUT_MS` | `5000` | 查询建议分析超时 |
| `DB_SLOW_QUERY_MS` | `5000` | 慢查询审计阈值 |

### 5.4 脱敏与审计

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `DB_MASKING_MODE` | `off` | `off`、`loose`、`strict`、`strict-v2` |
| `DB_MASKING_EXCLUDE_FIELDS` | 空 | 逗号分隔，字段名白名单 |
| `DB_MASKING_EXCLUDE_CONNECTIONS` | 空 | 逗号分隔，连接 id 白名单 |
| `MCP_AUDIT_LOG` | 空 | 审计日志文件路径；为空则只保留内存记录 |

### 5.5 Redis 和 SQL Server 专项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `REDIS_BLOCKED_COMMANDS` | 内置列表 | 逗号分隔，额外禁止 Redis 命令 |
| `DB_MSSQL_ENCRYPT` | `true` | MSSQL 连接加密开关；设为 `false` 关闭 |
| `DB_MSSQL_TRUST_SERVER_CERTIFICATE` | `false` | MSSQL 是否信任自签证书 |

### 5.6 DuckDB 专项

DuckDB 使用 `url` 或 `database` 指向数据库文件，未提供时使用 `:memory:`。与其他 SQL 引擎不同，DuckDB 连接默认 `readonly:true`，只有显式设置 `readonly:false` 时才允许写入。

示例：

```env
DB_MCP_CONNECTIONS=[{"id":"duck","engine":"duckdb","url":":memory:","readonly":true,"allowlist":["./data"]}]
DB_MCP_DEFAULT_CONNECTION_ID=duck
```

安全边界：

- `sql_query` 仍在 MCP 工具层执行只读 SQL 检查。
- driver 层会再次执行 readonly 检查；`:memory:` 连接也会保持只读策略。
- 外部文件读取默认关闭。配置 `allowlist` 后，只允许读取列表内的文件或目录，例如 `read_csv_auto('./data/demo.csv')`。
- 不要把用户主目录、仓库根目录或系统目录整体加入 `allowlist`。

### 5.7 日志和关闭

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `LOG_LEVEL` | `info` | `debug`、`info`、`warn`、`error` |
| `LOG_FORMAT` | `human` | `human` 或 `json` |
| `DB_TRANSACTION_TIMEOUT_MS` | `300000` | SQL 事务清理超时 |
| `DB_MONGO_TRANSACTION_TIMEOUT_MS` | `300000` | MongoDB 事务清理超时；未设置时回退到 `DB_TRANSACTION_TIMEOUT_MS` |
| `DB_SHUTDOWN_TIMEOUT_MS` | `10000` | 优雅关闭超时 |

### 5.8 HTTP 传输配置

默认仍为 `stdio`。只有设置 `DB_MCP_TRANSPORT=http` 或 CLI `--transport http` 时才启动 Streamable HTTP。

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `DB_MCP_TRANSPORT` | `stdio` | `stdio` 或 `http` |
| `DB_HTTP_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `DB_HTTP_PORT` | `3000` | HTTP 监听端口 |
| `DB_HTTP_ENDPOINT` | `/mcp` | MCP HTTP endpoint |
| `DB_HTTP_ORIGINS` | 空 | 逗号分隔 Origin allowlist；请求带 Origin 且不匹配时拒绝 |
| `DB_AUTH_MODE` | `none` for stdio, `bearer` for HTTP | `none`、`api_key`、`bearer` |
| `DB_AUTH_ISSUER` | 空 | Bearer JWT issuer |
| `DB_AUTH_AUDIENCE` | 空 | Bearer JWT audience |
| `DB_AUTH_JWKS_URL` | 空 | 远程 JWKS URL |
| `DB_AUTH_JWKS_FILE` | 空 | 本地 JWKS JSON 文件，适合离线测试和内网部署 |
| `DB_RBAC_POLICY_FILE` | 空 | RBAC policy JSON 文件路径 |
| `DB_RBAC_DEFAULT_EFFECT` | `deny` | 未匹配策略时 `deny` 或 `allow`；生产必须使用 `deny` |
| `DB_HTTP_API_KEY` | 空 | API key fallback，支持 Bearer 和 `x-api-key`，仅建议开发/过渡使用 |
| `DB_AUTH_DISABLED` | `false` | 显式关闭 HTTP 认证，仅本地开发使用 |
| `DB_HTTP_AUTH_DISABLED` | `false` | 旧别名；建议改用 `DB_AUTH_DISABLED` |
| `DB_HTTP_BODY_LIMIT_BYTES` | `1048576` | POST `/mcp` JSON body 大小限制 |
| `DB_HTTP_REQUEST_TIMEOUT_MS` | `30000` | HTTP 请求体读取超时 |

示例：

```powershell
$env:DB_MCP_TRANSPORT="http"
$env:DB_HTTP_HOST="127.0.0.1"
$env:DB_HTTP_PORT="3000"
$env:DB_AUTH_DISABLED="true"
node dist/index.js
```

生产或共享 HTTP 部署建议使用 bearer + RBAC：

```powershell
$env:DB_MCP_TRANSPORT="http"
$env:DB_HTTP_HOST="0.0.0.0"
$env:DB_AUTH_MODE="bearer"
$env:DB_AUTH_ISSUER="https://idp.example.com/"
$env:DB_AUTH_AUDIENCE="polyglot-db-mcp-server"
$env:DB_AUTH_JWKS_FILE="./jwks.json"
$env:DB_RBAC_POLICY_FILE="./rbac-policy.json"
node dist/index.js
```

API key fallback 仍可用于开发或迁移期：

```powershell
$env:DB_MCP_TRANSPORT="http"
$env:DB_AUTH_MODE="api_key"
$env:DB_HTTP_API_KEY="<change-me>"
node dist/index.js
```

RBAC policy 的 `conditions.maskingMode` 可按请求强制更严格的脱敏：

```json
{
  "resources": ["connection:pg"],
  "actions": ["read"],
  "conditions": { "maxRows": 500, "maskingMode": "strict-v2" }
}
```

说明：

- `maskingMode` 只影响当前授权通过的工具调用，不修改全局 `DB_MASKING_MODE`。
- 当 policy mode 比全局 mode 更严格时才会提升有效脱敏强度；policy 不能关闭或弱化全局脱敏。
- v2.0.1 已对 `sql_query`、`mongo_find`、`mongo_aggregate` 的 read rows 返回路径执行请求级 policy 脱敏。

HTTP endpoint：

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/mcp` | Streamable HTTP MCP endpoint |
| `GET` | `/healthz` | 进程健康 |
| `GET` | `/readyz` | registry 和启动 ping readiness |
| `GET` | `/metrics` | Prometheus text exposition；除显式关闭认证外需要 HTTP 认证 |
| `GET/DELETE` | `/mcp` | v1.8.0 返回 405 |

可观测性：

- `prometheus_metrics` MCP 工具和 HTTP `GET /metrics` 使用同一套指标生成逻辑，包含连接请求、审计统计和工具调用聚合。
- 工具调用会通过 OpenTelemetry API 创建 span；宿主进程注册 OTel provider 后可采集 `mcp.tool.name`、`db_mcp.connection_id`、`db_mcp.duration_ms`、`db_mcp.error_code` 等属性。
- `/metrics` 不是健康检查端点，生产环境应继续使用 bearer/RBAC 或 API key fallback 保护。

---

## 六、安全配置建议

### 6.1 本地开发

| 项目 | 建议 |
|------|------|
| SQLite | 可使用 `readonly:false` 验证写入工具 |
| DuckDB | 默认只读；只给本地样例数据目录配置 `allowlist` |
| SQL 外部数据库 | 默认 `readonly:true` |
| Redis | 配置 `keyPrefix` |
| MongoDB | 配置 `allowlist` |
| 脱敏 | 至少开启 `loose` 或 `strict-v2` 验证效果 |
| 日志 | `LOG_FORMAT=human` 便于阅读 |

### 6.2 生产或共享环境

| 项目 | 建议 |
|------|------|
| 连接权限 | 使用最小权限账号 |
| 写连接 | 使用独立 id，并明确 `readonly:false` |
| DuckDB 文件访问 | `allowlist` 只包含业务需要的只读数据目录 |
| 查询限制 | 调低 `DB_MAX_ROWS`，配置超时和 SQL 长度 |
| 限流 | 设置 `DB_RATE_LIMIT_PER_SECOND` |
| 脱敏 | 开启 `strict` 或 `strict-v2` |
| 审计 | 设置 `MCP_AUDIT_LOG` 或后续外部审计输出 |
| HTTP | 默认 localhost；远程部署必须配置认证和 Origin |
| Docker | `docker-compose.env` 仅提供本地开发默认连接；私有环境使用 `.env` 覆盖且不要提交 |

---

## 七、常见问题

| 问题 | 排查 |
|------|------|
| `DB_MCP_CONNECTIONS 不是合法 JSON` | 使用单行 JSON，确认双引号转义正确 |
| 默认连接不可用 | 检查 `DB_MCP_DEFAULT_CONNECTION_ID` 是否存在于连接数组 |
| SQL 写入被拒绝 | 检查连接 `readonly`，确认是否应使用写连接 |
| Redis key 被拒绝 | 检查 `keyPrefix` 与传入 key 是否一致 |
| Mongo 集合被拒绝 | 检查 `allowlist` 是否包含目标集合 |
| SQLite 文件找不到 | 确认当前工作目录和 `file:` 相对路径 |
| DuckDB 外部文件被拒绝 | 检查文件路径是否位于 DuckDB 连接的 `allowlist` 内 |
| 日志出现敏感信息 | 提交 issue 前先脱敏，检查 `LOG_LEVEL` 和错误输出 |

---

## 八、配置变更验收

涉及配置变更的 PR 必须确认：

- [ ] 新环境变量写入 README 或本文件。
- [ ] 默认值在源码、文档、测试中一致。
- [ ] 不引入真实凭证。
- [ ] 不破坏现有 `DB_MCP_CONNECTIONS` 格式。
- [ ] `npm run build` 和 `npm test` 通过。
