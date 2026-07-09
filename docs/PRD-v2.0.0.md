# PRD: polyglot-db-mcp-server v2.0.0

**文档编号**: PRD-v2.0.0
**版本**: 1.0
**日期**: 2026-07-09
**目标版本**: v2.0.0
**状态**: 已完成
**主题**: 企业安全：OAuth/Bearer Token、RBAC、审计增强
**关联 ADR**: `docs/ADR-002-oauth-rbac.md`
**前置依赖**: v1.8.0 HTTP 传输稳定

---

## 一、产品背景

v1.8.0 引入 HTTP 传输后，polyglot-db-mcp-server 可以作为远程数据库 MCP 网关部署。远程部署带来新的企业需求：身份认证、细粒度授权、审计可追责、租户或团队隔离、策略化安全限制。

v2.0.0 的目标是建立企业安全基线，让项目从“可部署 HTTP MCP server”升级为“可被企业安全团队接受的数据库 MCP 网关”。

---

## 二、用户画像

| 用户 | 诉求 |
|------|------|
| 平台管理员 | 将 MCP server 接入内部身份系统，并限制不同 Agent 的权限 |
| 安全负责人 | 默认拒绝未授权访问，审计每一次工具调用和拒绝原因 |
| DBA | 控制哪些连接可读、可写、可管理，避免越权操作 |
| 业务 Agent 开发者 | 只获得需要的连接和工具权限，错误时能看到清晰 hint |
| 运维人员 | 通过日志和审计定位失败率、越权调用和异常使用 |

---

## 三、核心目标

| 编号 | 目标 | 成功标准 |
|------|------|----------|
| O-001 | HTTP 认证 | 无 token/无效 token 请求被拒绝 |
| O-002 | RBAC 授权 | 可按 subject/role/connection/tool/action 控制访问 |
| O-003 | 策略条件 | 支持 maxRows、readonly、masking、time window 等条件 |
| O-004 | 审计增强 | allow/deny 决策均可追踪 |
| O-005 | 兼容迁移 | stdio 本地用户不被破坏，v1.x 配置可迁移 |
| O-006 | 文档可操作 | 提供 policy 示例、迁移指南、错误码说明 |

### 3.1 实施结论

v2.0.0 已完成 HTTP Bearer Token、RBAC policy、统一授权 wrapper、授权审计、认证诊断工具和迁移文档。Policy conditions 已覆盖 `maxRows`、`transport`、`timeWindow` 的运行时限制，并验证 `maskingMode` 配置合法性；v2.0.1 已通过请求上下文补齐 `maskingMode` 的逐请求强制执行，避免全局脱敏配置并发串扰。

---

## 四、功能清单

### 4.1 P0 功能

| 编号 | 功能 | 说明 |
|------|------|------|
| F-001 | Bearer Token 验证 | JWT/JWKS issuer/audience/expiry/signature 验证 |
| F-002 | AuthContext | 为每次工具调用提供 subject、tenant、roles、claims |
| F-003 | RBAC policy loader | 从 JSON/YAML 文件加载 roles/bindings |
| F-004 | Tool action map | 工具名映射到 read/write/admin/diagnose/export |
| F-005 | Authorization wrapper | 工具 handler 执行前统一授权 |
| F-006 | Default deny | HTTP + RBAC 模式未命中策略默认拒绝 |
| F-007 | Audit decision | 记录 allow/deny、reason、policy_version |
| F-008 | 安全边界保留 | readonly、SQL guard、NoSQL guard、keyPrefix、allowlist 不被绕过 |

### 4.2 P1 功能

| 编号 | 功能 | 说明 |
|------|------|------|
| F-009 | Policy conditions | maxRows、maskingMode、time window、transport 限制 |
| F-010 | Policy validate tool | 校验 policy 文件，返回错误和 hint |
| F-011 | Auth diagnostics | 诊断 token claims、policy match 和拒绝原因 |
| F-012 | 迁移指南 | 从 v1.8 API key 到 v2.0 bearer/rbac |
| F-013 | 错误码扩展 | AUTH/RBAC/POLICY 错误码和测试 |

### 4.3 P2 功能

| 编号 | 功能 | 说明 |
|------|------|------|
| F-014 | Tenant isolation 初版 | 在 AuthContext 和 audit 中记录 tenant |
| F-015 | Policy hot reload | SIGHUP 或文件 watcher 重载 policy |
| F-016 | External audit sink | webhook/文件/SQLite 持久化增强 |
| F-017 | Fine-grained resource | table/collection/key prefix 更细粒度授权 |

---

## 五、不纳入范围

| 功能 | 原因 | 后续版本 |
|------|------|----------|
| 自建用户系统 | 应接企业 IdP | 不计划 |
| Web 管理控制台 | 范围大，需单独产品设计 | v2.x 评估 |
| 复杂策略语言/Rego | 初版先 RBAC + 条件 | v2.2+ |
| 数据库行列级权限 | 依赖数据库自身权限或更细策略 | v2.x |
| 审批流 | 需要 UI/工作流 | v2.x |

---

## 六、用户故事

### US-001：平台管理员配置只读 Agent

作为平台管理员，我希望给报表 Agent 只授予 PostgreSQL 和 SQLite 的 read/diagnose 权限，禁止写入和审计导出。

验收：

- Agent 可执行 `sql_query`。
- Agent 无法执行 `sql_execute`。
- Agent 无法调用 `export_audit`。
- 拒绝记录包含 subject、tool、action、reason。

### US-002：DBA 配置 Redis 操作员

作为 DBA，我希望缓存 Agent 只能访问 `app:` 前缀 Redis key，并禁止危险命令。

验收：

- `redis_get app:x` 允许。
- `redis_get other:x` 拒绝。
- 任何 blocked command 拒绝。
- 审计记录 resource 和 keyPrefix 决策。

### US-003：安全负责人审计越权调用

作为安全负责人，我希望看到每次拒绝的 subject、角色、工具、连接和拒绝原因。

验收：

- deny 事件进入 audit。
- token 原文不进入 audit。
- 可按 subject/tool/decision 过滤。

---

## 七、配置与示例

### 7.1 最小 bearer 配置

```env
DB_MCP_TRANSPORT=http
DB_AUTH_MODE=bearer
DB_AUTH_ISSUER=https://idp.example.com/
DB_AUTH_AUDIENCE=polyglot-db-mcp-server
DB_AUTH_JWKS_URL=https://idp.example.com/.well-known/jwks.json
DB_RBAC_POLICY_FILE=./rbac-policy.json
DB_RBAC_DEFAULT_EFFECT=deny
```

### 7.2 只读分析员 policy

```json
{
  "version": "2026-07-09",
  "roles": {
    "readonly_analyst": [
      {
        "resources": ["connection:pg", "connection:local"],
        "actions": ["read", "diagnose"],
        "conditions": { "maxRows": 500, "maskingMode": "strict-v2" }
      }
    ]
  },
  "bindings": [
    { "subject": "agent:report", "roles": ["readonly_analyst"] }
  ]
}
```

---

## 八、测试策略

### 8.1 必须新增测试

| 测试文件 | 内容 |
|----------|------|
| `test/auth/token-verifier.test.mjs` | issuer/audience/expiry/signature |
| `test/auth/rbac.test.mjs` | role/resource/action/default deny |
| `test/auth/rbac.test.mjs` | role/resource/action/default deny/maxRows 条件 |
| `test/auth/tool-action-map.test.mjs` | 所有工具 action 映射 |
| `test/auth/authorization.test.mjs` | allow/deny 审计脱敏 |
| `test/transports/http-auth.test.mjs` | HTTP bearer 集成 |

### 8.2 回归测试

- SQL 只读保护和 SQL guard。
- Redis keyPrefix。
- Mongo allowlist/NoSQL 注入。
- stdio 默认兼容。

---

## 九、迁移计划

| 阶段 | 内容 |
|------|------|
| Alpha | Bearer Token 验证 + static policy |
| Beta | tool action map + auth wrapper + audit decision |
| RC | migration guide + examples + error docs |
| GA | HTTP 默认认证，stdio 兼容保留 |

迁移原则：

- v1.x stdio 用户不需要立即配置认证。
- HTTP 生产用户必须迁移到 bearer/rbac。
- API key 可保留为开发/过渡模式，但文档标注不适合企业生产。

---

## 十、验收清单

- [x] HTTP bearer 验证完整。
- [x] RBAC policy loader 和 default deny 完成。
- [x] 工具调用前统一授权。
- [x] 所有工具有 action map 覆盖。
- [x] allow/deny 审计完整且脱敏。
- [x] 现有工具安全边界未削弱。
- [x] stdio 默认兼容。
- [x] Policy 示例和迁移指南完成。
- [x] `npm run build`、`npm test`、`npm run lint`、`npm run typecheck` 通过。

---

## 十一、评审结论

1. 初版 policy 仅支持 JSON；YAML 不纳入 v2.0。
2. tenant 进入 AuthContext 与 audit，完整租户隔离留给 v2.x。
3. API key fallback 保留为开发/迁移模式，生产文档推荐 bearer/RBAC。
4. Tool action map 采用集中硬编码，并用测试自动覆盖所有注册工具。
5. JWT/JWKS 使用 `jose`，覆盖 issuer、audience、expiry 和签名验证测试。
