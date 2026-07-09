# ADR-002: v2.0.0 OAuth 2.1 与 RBAC 企业安全方案

**文档编号**: ADR-002
**版本**: 1.0
**日期**: 2026-07-09
**状态**: Proposed
**目标版本**: v2.0.0
**关联文档**: `docs/ROADMAP.md`, `docs/PRD-v1.8.0.md`, `docs/ADR-001-streamable-http.md`

---

## 一、背景

v1.8.0 规划引入 Streamable HTTP，使 polyglot-db-mcp-server 可以从本地 stdio 进程演进为可部署的 HTTP MCP 网关。一旦服务可以远程访问，单纯依赖 API key 或网络边界将不足以满足企业场景：

- 不同用户/Agent 应访问不同连接。
- 同一连接下应区分 read/write/admin/diagnose/export 权限。
- 审计日志需要记录 subject、tenant、transport、tool、action。
- 安全策略需要从工具内部散落判断演进为统一授权决策。
- 未来多租户、审批、策略引擎都依赖稳定权限模型。

因此 v2.0.0 需要设计 OAuth/Bearer Token 验证与 RBAC 权限模型。本 ADR 是前置方案，不代表 v1.8.0 必须实现。

---

## 二、决策

v2.0.0 采用 **认证与授权分层** 的企业安全架构：

1. **认证层 Authentication**：HTTP 模式验证 Bearer Token，解析出 subject、scopes、tenant 和 claims。
2. **授权层 Authorization**：基于 RBAC policy 判断 subject 是否允许执行 connection/tool/action。
3. **策略层 Policy**：在 RBAC 基础上叠加条件，如 readonly 强制、最大行数、脱敏强制、时间窗口。
4. **审计层 Audit**：所有授权决策和工具调用记录 subject、decision、reason、policy version。
5. **兼容层 Compatibility**：stdio 本地模式默认可继续无认证；HTTP 模式默认要求认证，除非显式禁用。

---

## 三、目标与非目标

### 3.1 目标

| 编号 | 目标 | 验收 |
|------|------|------|
| G-001 | HTTP Bearer Token 验证 | 无 token/无效 token 被拒绝 |
| G-002 | RBAC 权限模型 | 可按 subject/role/connection/tool/action 授权 |
| G-003 | 策略条件 | 可限制 maxRows、readonly、masking、time window |
| G-004 | 审计增强 | 审计日志记录 subject、role、decision、reason |
| G-005 | 兼容 stdio | 本地 stdio 默认不破坏 |
| G-006 | 配置可迁移 | v1.x 配置可在无 RBAC 时继续运行 |

### 3.2 非目标

| 非目标 | 原因 | 后续版本 |
|--------|------|----------|
| 自建完整 IdP | 应接入外部身份提供商 | 不计划 |
| Web 管理 UI | 范围过大 | 后续评估 |
| 复杂 ABAC/Rego 引擎 | 初版先用 RBAC + 条件 | v2.2+ 策略引擎 |
| 数据库行列级权限 | 应由数据库自身权限或后续策略扩展 | v2.x |
| 自动审批流 | 需要 UI/工作流 | v2.x |

---

## 四、安全模型

### 4.1 核心实体

| 实体 | 说明 | 示例 |
|------|------|------|
| Subject | 调用方身份 | `user:alice`, `agent:report-bot` |
| Role | 权限集合 | `readonly_analyst`, `db_admin` |
| Resource | 被访问对象 | `connection:pg`, `collection:users`, `redis_prefix:app:` |
| Action | 操作类型 | `read`, `write`, `admin`, `diagnose`, `export` |
| Condition | 条件限制 | `maxRows<=100`, `masking=strict`, `time=workhours` |
| Tenant | 租户/工作区 | `tenant:acme` |

### 4.2 Action 分类

| Action | 包含工具 |
|--------|----------|
| `read` | `sql_query`, `sql_list_tables`, `mongo_find`, `redis_get`, schema read |
| `write` | `sql_execute`, Mongo insert/update/delete, Redis set/del/list/set/zset writes |
| `admin` | drop/rename/create index、危险 DDL、配置验证以外的管理操作 |
| `diagnose` | `test_connection`, `health_check`, `connection_diagnose`, `server_info` |
| `export` | `export_audit`, 查询结果导出、schema export |
| `replay` | `query_history`, `query_replay`, `query_diff` |

### 4.3 决策顺序

授权顺序建议固定为：

1. Transport 认证：确认 subject。
2. 连接解析：确认 connection_id。
3. RBAC 判断：subject/role 是否允许 resource/action。
4. Policy 判断：是否满足条件限制。
5. 工具安全判断：readonly、SQL guard、NoSQL guard、keyPrefix、allowlist。
6. 执行工具。
7. 审计记录。

注意：RBAC 不替代现有工具安全检查。现有 readonly、注入检测、keyPrefix、allowlist 必须保留。

---

## 五、配置设计草案

### 5.1 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_AUTH_MODE` | `none` for stdio, `bearer` for HTTP | `none`、`api_key`、`bearer` |
| `DB_AUTH_ISSUER` | 空 | JWT issuer |
| `DB_AUTH_AUDIENCE` | 空 | JWT audience |
| `DB_AUTH_JWKS_URL` | 空 | JWKS 地址 |
| `DB_AUTH_JWKS_FILE` | 空 | 本地 JWKS 文件，离线测试用 |
| `DB_RBAC_POLICY_FILE` | 空 | RBAC policy JSON/YAML |
| `DB_RBAC_DEFAULT_EFFECT` | `deny` | 未匹配策略默认拒绝 |
| `DB_AUTH_DISABLED` | `false` | 显式关闭认证，仅开发使用 |

### 5.2 Policy 示例

```json
{
  "version": "2026-07-09",
  "roles": {
    "readonly_analyst": [
      {
        "resources": ["connection:pg", "connection:local"],
        "actions": ["read", "diagnose"],
        "conditions": {
          "maxRows": 500,
          "maskingMode": "strict-v2"
        }
      }
    ],
    "redis_operator": [
      {
        "resources": ["connection:redis", "redis_prefix:app:"],
        "actions": ["read", "write", "diagnose"],
        "conditions": {
          "blockedCommands": ["FLUSHALL", "CONFIG", "EVAL"]
        }
      }
    ]
  },
  "bindings": [
    { "subject": "user:alice", "roles": ["readonly_analyst"] },
    { "subject": "agent:cache-bot", "roles": ["redis_operator"] }
  ]
}
```

---

## 六、模块边界

建议新增模块：

| 文件 | 职责 |
|------|------|
| `src/auth/token-verifier.ts` | JWT/Bearer Token 验证和 claims 解析 |
| `src/auth/auth-context.ts` | AuthContext 类型和匿名/stdin 上下文 |
| `src/auth/rbac.ts` | RBAC policy 加载、匹配和 decision |
| `src/auth/policy.ts` | 条件策略，如 maxRows/masking/time window |
| `src/auth/audit.ts` | 授权决策审计辅助 |
| `src/core/tool-action-map.ts` | 工具名到 action/resource 类型映射 |
| `test/auth/*.test.mjs` | token/rbac/policy 单元测试 |

工具注册层需要在 handler 执行前增加统一 wrapper：

```typescript
withAuthorization(toolName, input, context, async () => {
  return handler(input);
});
```

---

## 七、兼容策略

| 场景 | v2.0 行为 |
|------|-----------|
| stdio 默认启动 | 可继续无认证，subject=`local:stdio` |
| HTTP 默认启动 | 默认要求认证，除非 `DB_AUTH_DISABLED=true` |
| 未配置 RBAC policy | HTTP bearer 模式默认 deny；stdio local 可 allow local policy |
| v1.x 配置 | `DB_MCP_CONNECTIONS` 格式不变 |
| 只读连接 | 即使 RBAC 允许 write，连接 readonly 仍拒绝写入 |
| 脱敏 | policy 可强制 masking mode，但不能降低连接/全局强制要求 |

---

## 八、审计设计

授权审计字段：

| 字段 | 说明 |
|------|------|
| `timestamp` | ISO 时间 |
| `subject` | 调用主体 |
| `tenant` | 租户 |
| `roles` | 命中的角色 |
| `transport` | stdio/http |
| `tool` | 工具名 |
| `connection_id` | 连接 id |
| `action` | read/write/admin/diagnose/export |
| `decision` | allow/deny |
| `reason` | 命中/拒绝原因 |
| `policy_version` | 策略版本 |
| `latency_ms` | 授权和工具执行耗时 |

敏感字段：

- 不记录 token 原文。
- 不记录完整 connection string。
- SQL 可按现有审计策略记录，但参数必须脱敏。

---

## 九、测试计划

### 9.1 单元测试

| 测试 | 场景 |
|------|------|
| token verifier | valid/expired/wrong issuer/wrong audience/bad signature |
| RBAC match | subject role、resource wildcard、action match、default deny |
| policy conditions | maxRows、maskingMode、time window、readonly force |
| tool action map | 每个工具映射到正确 action |
| audit sanitize | 不泄露 token/password |

### 9.2 集成测试

| 测试 | 场景 |
|------|------|
| HTTP no token | 401 |
| HTTP invalid token | 401 |
| valid token no role | 403 |
| readonly role read | 允许 |
| readonly role write | 403 或工具 readonly 拒绝 |
| admin role dangerous op | 仍需 SQL guard/明确工具限制 |
| stdio compatibility | 默认本地仍可使用 |

---

## 十、迁移计划

| 阶段 | 内容 |
|------|------|
| v1.8.x | API key 轻量保护，收集 HTTP 使用反馈 |
| v2.0 Alpha | Bearer Token 验证 + 静态 RBAC policy |
| v2.0 Beta | 工具 action map + audit decision |
| v2.0 RC | 文档、迁移指南、兼容测试 |
| v2.0 GA | 默认 HTTP 认证开启，stdio 兼容保留 |

---

## 十一、风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 权限模型过复杂导致难用 | 高 | 初版 RBAC + 条件，不做完整 ABAC |
| 误授权写操作 | 高 | default deny，工具层 readonly 保留 |
| token 验证实现不安全 | 高 | 使用成熟 JOSE/JWT 库，测试 issuer/audience/expiry |
| 审计泄露 token | 高 | 审计 sanitize 测试 |
| stdio 用户被破坏 | 中 | stdio 默认 local context，无认证迁移成本 |
| policy 文件配置困难 | 中 | 提供模板、validate tool、错误 hint |

---

## 十二、待评审问题

1. v2.0 是否强制 HTTP bearer，还是保留 API key fallback。
2. Policy 使用 JSON 还是 YAML，是否接受两者。
3. 是否需要 tenant 作为 v2.0 P0，还是 v2.1+。
4. action 粒度是否足够，是否需要 table/collection/key prefix 级细分。
5. 是否引入外部 JOSE/JWT 依赖，具体库在实施前评审。

---

## 十三、验收清单

- [ ] HTTP 模式默认要求认证。
- [ ] Bearer Token 验证 issuer/audience/expiry/signature。
- [ ] RBAC policy default deny。
- [ ] 工具调用前有统一授权 wrapper。
- [ ] 现有 readonly、SQL guard、NoSQL guard、keyPrefix、allowlist 未被绕过。
- [ ] 审计记录 subject/roles/decision/reason。
- [ ] stdio 默认兼容。
- [ ] 文档包含迁移指南和 policy 示例。
- [ ] auth/rbac/policy 测试覆盖通过。

---

## 十四、结论

v2.0.0 应以 **Bearer Token + RBAC + Policy Conditions + Audit Decision** 作为企业安全基线。API key 可作为 v1.8 过渡能力，但不应成为 v2.0 的最终权限模型。所有授权能力必须建立在现有工具安全边界之上，而不是替代它们。
