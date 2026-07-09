# 配置指南

**文档编号**: CONFIG
**版本**: 1.0
**日期**: 2026-07-09
**状态**: 当前有效草案
**适用版本**: v1.7.x，v1.8.0 HTTP 配置为前瞻规划

---

## 一、配置原则

polyglot-db-mcp-server 通过环境变量配置。启动时会从当前工作目录加载 `.env`，并解析 `DB_MCP_CONNECTIONS` 构建连接注册表。

配置设计原则：

1. **单一连接入口**：所有数据库连接放在 `DB_MCP_CONNECTIONS` JSON 数组中。
2. **默认安全**：建议生产环境默认 `readonly: true`，只对明确需要写入的连接关闭只读。
3. **敏感信息不入库**：不要提交 `.env`、生产密码、真实 token 或完整生产连接串。
4. **显式默认连接**：多连接场景建议设置 `DB_MCP_DEFAULT_CONNECTION_ID`。
5. **限制优先**：生产环境必须配置最大行数、SQL 长度、超时、限流和脱敏。

---

## 二、最小 SQLite 配置

适合本地 5 分钟快速开始，不依赖外部数据库服务。

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
DB_MCP_CONNECTIONS=[{"id":"pg","engine":"postgres","url":"postgres://dev:devpass@127.0.0.1:5432/devdb","readonly":true},{"id":"mysql","engine":"mysql","host":"127.0.0.1","port":3306,"user":"dev","password":"devpass","database":"devdb","readonly":true},{"id":"redis","engine":"redis","url":"redis://:redispass@127.0.0.1:6379/0","readonly":false,"keyPrefix":"app:"},{"id":"mongo","engine":"mongodb","url":"mongodb://dev:devpass@127.0.0.1:27017/?authSource=admin","database":"devdb","readonly":true,"allowlist":["users","orders"]},{"id":"local","engine":"sqlite","url":"file:./data/local.db","readonly":false}]
DB_MCP_DEFAULT_CONNECTION_ID=local
```

建议：

- Redis 写操作必须配合 `keyPrefix` 限制业务前缀。
- MongoDB 建议使用 `allowlist` 限制集合。
- SQL 连接建议生产默认 `readonly:true`，写入场景使用独立连接 id。

---

## 四、连接对象字段

| 字段 | 类型 | 适用引擎 | 必填 | 说明 |
|------|------|----------|------|------|
| `id` | string | 全部 | 是 | 只能使用字母、数字、下划线 |
| `engine` | string | 全部 | 是 | `mysql`、`postgres`、`mssql`、`oracle`、`sqlite`、`mongodb`、`redis` |
| `url` | string | 推荐全部 | 条件 | Redis/MongoDB 必填；SQL 可用 url 或 host |
| `host` | string | SQL | 条件 | 未提供 url 时使用 |
| `port` | number | SQL | 否 | 1-65535 |
| `user` | string | SQL | 否 | 用户名 |
| `password` | string | SQL | 否 | 密码；不要提交真实值 |
| `database` | string | SQL/Mongo/SQLite | 否 | 数据库名或 SQLite 路径替代 |
| `readonly` | boolean | 全部 | 否 | 默认 `false`；生产建议显式设置 |
| `allowlist` | string[] | MongoDB/部分工具 | 否 | 允许访问的集合或对象列表 |
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

### 5.6 日志和关闭

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `LOG_LEVEL` | `info` | `debug`、`info`、`warn`、`error` |
| `LOG_FORMAT` | `human` | `human` 或 `json` |
| `DB_SHUTDOWN_TIMEOUT_MS` | `10000` | 优雅关闭超时 |

### 5.7 v1.8.0 HTTP 前瞻配置

以下变量由 `docs/ADR-001-streamable-http.md` 和 `docs/PRD-v1.8.0.md` 规划，v1.7.x 不一定已实现。

| 环境变量 | 规划默认值 | 说明 |
|----------|------------|------|
| `DB_MCP_TRANSPORT` | `stdio` | `stdio` 或 `http` |
| `DB_HTTP_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `DB_HTTP_PORT` | `3000` | HTTP 监听端口 |
| `DB_HTTP_ENDPOINT` | `/mcp` | MCP HTTP endpoint |
| `DB_HTTP_ORIGINS` | 空 | Origin allowlist |
| `DB_HTTP_API_KEY` | 空 | 轻量 API key |
| `DB_HTTP_AUTH_DISABLED` | `false` | 显式关闭 HTTP 认证，仅本地开发使用 |

---

## 六、安全配置建议

### 6.1 本地开发

| 项目 | 建议 |
|------|------|
| SQLite | 可使用 `readonly:false` 验证写入工具 |
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
| 查询限制 | 调低 `DB_MAX_ROWS`，配置超时和 SQL 长度 |
| 限流 | 设置 `DB_RATE_LIMIT_PER_SECOND` |
| 脱敏 | 开启 `strict` 或 `strict-v2` |
| 审计 | 设置 `MCP_AUDIT_LOG` 或后续外部审计输出 |
| HTTP | 默认 localhost；远程部署必须配置认证和 Origin |

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
| 日志出现敏感信息 | 提交 issue 前先脱敏，检查 `LOG_LEVEL` 和错误输出 |

---

## 八、配置变更验收

涉及配置变更的 PR 必须确认：

- [ ] 新环境变量写入 README 或本文件。
- [ ] 默认值在源码、文档、测试中一致。
- [ ] 不引入真实凭证。
- [ ] 不破坏现有 `DB_MCP_CONNECTIONS` 格式。
- [ ] `npm run build` 和 `npm test` 通过。
