# 错误码与提示规范

**文档编号**: ERRORS
**版本**: 2.0
**日期**: 2026-07-10
**状态**: 当前有效
**适用版本**: v2.0.x+

---

## 一、设计目标

错误响应应帮助用户完成下一步动作，而不是只暴露底层异常。统一错误体系需要满足：

1. **稳定可搜索**：每类错误有稳定 `code`。
2. **可执行 hint**：告诉用户下一步检查什么、改哪里。
3. **不泄露敏感信息**：连接串、密码、token、API key 必须脱敏。
4. **可测试**：关键错误场景有断言，避免文案退化。
5. **可扩展**：HTTP/OAuth/RBAC 后续可新增错误码，不破坏现有码。

---

## 二、错误对象结构

推荐结构。v1.7.3 起，`connection_diagnose`、CLI `test/init` 和部分关键工具错误已返回或展示 `code`/`hint`：

```json
{
  "code": "CONN_006",
  "message": "未知的 connection_id",
  "hint": "可用连接: local, pg, redis",
  "retryable": false,
  "details": {}
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `code` | 是 | 稳定错误码，格式 `PREFIX_000` |
| `message` | 是 | 简短用户可读错误 |
| `hint` | 建议 | 下一步可执行建议 |
| `retryable` | 建议 | 是否值得自动或人工重试 |
| `details` | 否 | 结构化上下文，必须脱敏 |

---

## 三、错误码前缀

| 前缀 | 模块 | 示例 |
|------|------|------|
| `CONN` | 连接、registry、ping | 未知连接、连接失败、默认连接失败 |
| `SQL` | SQL 查询、事务、SQL guard | 只读拒绝、注入风险、事务不存在 |
| `MONGO` | MongoDB 工具 | allowlist、NoSQL 注入、只读拒绝 |
| `REDIS` | Redis 工具 | keyPrefix、禁止命令、只读拒绝 |
| `AUTH` | 认证/权限 | readonly、HTTP API key、OAuth/RBAC |
| `CFG` | 配置解析 | JSON 非法、缺字段、不支持引擎 |
| `HTTP` | v1.8 HTTP 传输 | Origin、body limit、method 不支持 |
| `CLI` | CLI 命令 | init/test/help 参数错误 |

---

## 四、当前错误码矩阵

### 4.1 连接错误

| Code | Message | Hint | Retryable |
|------|---------|------|-----------|
| `CONN_001` | 连接失败：无法建立到数据库的连接 | 检查 host、port、url、数据库服务状态和网络 | true |
| `CONN_002` | 连接超时：连接建立超过配置的超时时间 | 增大超时或检查网络、防火墙、数据库负载 | true |
| `CONN_003` | 连接断开：与数据库的连接已丢失 | 重试请求；若持续出现，检查数据库连接池和网络 | true |
| `CONN_004` | 连接池耗尽：所有连接都在使用中 | 降低并发、增加连接池、检查慢查询 | true |
| `CONN_005` | 默认连接 ping 失败 | 检查 `DB_MCP_DEFAULT_CONNECTION_ID` 和该连接配置 | true |
| `CONN_006` | 未知的 connection_id | 使用 `list_connections` 查看可用 id | false |

### 4.2 SQL 错误

| Code | Message | Hint | Retryable |
|------|---------|------|-----------|
| `SQL_001` | SQL 超过长度限制 | 缩短 SQL 或调整 `DB_MAX_SQL_LENGTH` | false |
| `SQL_002` | 只读模式不允许写操作 | 使用写工具或将专用连接配置为 `readonly:false` | false |
| `SQL_003` | 危险操作被拦截 | 检查 DROP/TRUNCATE/ALTER/无 WHERE UPDATE/DELETE 等操作 | false |
| `SQL_004` | SQL 注入风险被拦截 | 使用参数化查询，移除可疑拼接片段 | false |
| `SQL_005` | 查询超时 | 优化 SQL、增加索引、降低结果集或调整超时 | true |
| `SQL_006` | 事务不存在或已结束 | 重新 `sql_begin_transaction`，确认 transaction_id 未过期 | false |

### 4.3 MongoDB 错误

| Code | Message | Hint | Retryable |
|------|---------|------|-----------|
| `MONGO_001` | 不是 MongoDB 连接 | 检查 connection_id 对应 engine | false |
| `MONGO_002` | 集合不在 allowlist 中 | 使用允许集合或更新连接 allowlist | false |
| `MONGO_003` | NoSQL 注入风险被拦截 | 移除 `$where`、`$function` 等危险 operator | false |
| `MONGO_004` | 只读连接拒绝写操作 | 使用写连接或显式 `readonly:false` | false |
| `MONGO_005` | MongoDB 事务不存在或已结束 | 重新 `mongo_begin_transaction`，确认 transaction_id 未过期 | false |

### 4.4 Redis 错误

| Code | Message | Hint | Retryable |
|------|---------|------|-----------|
| `REDIS_001` | 不是 Redis 连接 | 检查 connection_id 对应 engine | false |
| `REDIS_002` | Key 不在允许的前缀范围内 | 确认 key 以配置的 `keyPrefix` 开头 | false |
| `REDIS_003` | 命令被禁止 | 检查 `REDIS_BLOCKED_COMMANDS` 和内置禁止列表 | false |
| `REDIS_004` | 只读连接拒绝写操作 | 使用写连接或显式 `readonly:false` | false |

### 4.5 认证与权限错误

| Code | Message | Hint | Retryable |
|------|---------|------|-----------|
| `AUTH_001` | 连接配置为只读 | 如确需写入，使用单独写连接并设置 `readonly:false` | false |
| `AUTH_002` | 不在允许列表中 | 检查 allowlist/keyPrefix/RBAC 策略 | false |
| `AUTH_003` | HTTP 认证凭证缺失或无效 | 设置正确 Authorization Bearer token 或 x-api-key header | false |
| `AUTH_004` | Token 已过期 | 重新获取 token | true |
| `AUTH_005` | 权限不足 | 联系管理员授予对应 connection/tool/action 权限 | false |
| `AUTH_006` | Bearer Token 无效 | 检查 token 签名、issuer、audience、nbf/exp 和 JWKS 配置 | false |

### 4.6 Policy 错误

| Code | Message | Hint | Retryable |
|------|---------|------|-----------|
| `POLICY_001` | RBAC policy 无效 | 检查 policy JSON 的 version、roles、bindings、actions 和 resources | false |

### 4.7 配置错误

| Code | Message | Hint | Retryable |
|------|---------|------|-----------|
| `CFG_001` | `DB_MCP_CONNECTIONS` 未设置或为空 | 参考 `docs/CONFIG.md` 添加最小 SQLite 配置 | false |
| `CFG_002` | `DB_MCP_CONNECTIONS` 不是合法 JSON | 使用 JSON 校验器或复制单行示例 | false |
| `CFG_003` | 连接 ID 重复 | 保证每个 `id` 唯一 | false |
| `CFG_004` | 不支持的引擎类型 | 使用支持的 engine 枚举 | false |
| `CFG_005` | 缺少必填字段 | 检查 `id`、`engine`、`url` 或 host/database | false |

### 4.8 HTTP 传输错误

| Code | Message | Hint | Retryable |
|------|---------|------|-----------|
| `HTTP_001` | HTTP 来源不被允许 | 将 Host 加入 `DB_HTTP_ALLOWED_HOSTS`，或将 Origin 加入 `DB_HTTP_ORIGINS` | false |
| `HTTP_002` | 请求体过大 | 缩小请求或调整 body limit | false |
| `HTTP_003` | HTTP method 不支持 | 使用 POST `/mcp`，GET/SSE 取决于实现版本 | false |
| `HTTP_004` | Endpoint 不存在 | 检查 `DB_HTTP_ENDPOINT` | false |
| `HTTP_005` | HTTP transport 未启用 | 设置 `DB_MCP_TRANSPORT=http` | false |

### 4.9 CLI 错误

| Code | Message | Hint | Retryable |
|------|---------|------|-----------|
| `CLI_001` | `.env` 已存在 | 使用 `--force` 或输出到其他路径 | false |
| `CLI_002` | 不支持的 CLI 参数 | 运行 `--help` 查看支持命令 | false |
| `CLI_003` | 初始化模板生成失败 | 检查目录权限或改用 stdout 输出 | true |
| `CLI_004` | 连接测试失败 | 运行 `connection_diagnose` 或检查 `docs/CONFIG.md` | true |

---

## 五、Hint 编写规范

好的 hint 应该：

- 明确下一步动作。
- 尽量给出配置名、工具名或命令。
- 不泄露密码、token、完整生产 URL。
- 不建议用户关闭安全保护，除非明确说明风险。

示例：

| 场景 | 不推荐 | 推荐 |
|------|--------|------|
| 未知连接 | `connection_id error` | `可用连接: local, pg；可调用 list_connections 查看` |
| readonly | `readonly` | `该连接为只读；如确需写入，请使用独立写连接并设置 readonly:false` |
| Redis prefix | `invalid key` | `key 必须以 app: 开头，当前 key 不符合 keyPrefix 限制` |
| SQL 注入 | `bad sql` | `检测到 UNION 注入风险；请使用 params 参数化传值` |

---

## 六、测试要求

新增或修改错误行为时必须补测试：

| 场景 | 测试位置 |
|------|----------|
| 配置解析错误 | `test/config.test.mjs` |
| 未知连接 | `test/tools/connections.test.mjs` |
| SQL 只读/注入/危险操作 | `test/tools/sql.test.mjs`, `test/sql-guards.test.mjs` |
| Redis keyPrefix/readonly | `test/tools/redis.test.mjs` |
| Mongo allowlist/NoSQL 注入 | `test/tools/mongo.test.mjs` |
| HTTP 认证/Origin | `test/transports/*.test.mjs`（v1.8） |
| CLI init/test | `test/cli*.test.mjs`（v1.7.3） |

断言建议：

- 至少断言 `code` 稳定。
- 对 `hint` 断言关键字，不要全文精确匹配导致文案难维护。
- 断言错误消息不包含明文密码或 token。

---

## 七、演进规则

1. 可以新增错误码，不随意删除或复用已有错误码。
2. 修改 `message` 可以，但不能改变错误语义。
3. `hint` 可以优化，但必须保持可执行。
4. 引入 HTTP/OAuth/RBAC 时使用新前缀或扩展 `AUTH`，不要混入 SQL/Redis/Mongo 错误码。
5. 文档、源码 `ErrorCodes`、测试必须同步。

---

## 八、落地清单

### v1.7.3

- [x] `src/core/error-codes.ts` 补齐本文档中的当前、HTTP 前瞻和 CLI 错误码。
- [x] 工具层关键错误返回 `{ error, error_info: { code, message, hint } }`。
- [x] `connection_diagnose` 使用错误码生成建议，并保留兼容的 `error` 字符串。
- [x] README/API 指向本文档。
- [x] 新增关键错误测试：CLI、错误码元数据、连接诊断、SQL 只读、Redis keyPrefix、Mongo NoSQL 注入。

### v1.8.0

- [x] HTTP transport 使用 `AUTH_003`、`HTTP_001`、`HTTP_002`、`HTTP_003`、`HTTP_004` 返回结构化错误。
- [x] HTTP Host、Origin、API key、body limit 和 method 405 均有 transport 测试覆盖。
- [x] `sql_query` 通过 HTTP 调用时仍返回 `SQL_002` 拒绝写 SQL。
