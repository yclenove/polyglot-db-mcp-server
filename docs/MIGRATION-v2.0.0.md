# v2.0.0 迁移指南：从 v1.x 到企业安全模式

**文档编号**: MIGRATION-v2.0.0
**版本**: 1.0
**日期**: 2026-07-09
**状态**: 当前有效
**适用范围**: v1.7.x / v1.8.x -> v2.0.x
**关联文档**: `docs/ADR-002-oauth-rbac.md`, `docs/PRD-v2.0.0.md`, `docs/CONFIG.md`, `docs/ERRORS.md`

---

## 一、迁移目标

v2.0.0 的核心变化是把 HTTP 模式从“轻量 API key 保护”升级为“Bearer Token + RBAC + 策略条件 + 审计决策”的企业安全模式。

迁移目标：

1. 保持本地 stdio 用户可继续使用。
2. 让 HTTP 生产部署具备默认认证和默认拒绝策略。
3. 给现有 API key 用户提供可控迁移路径。
4. 确保现有数据库安全边界不被权限系统替代或绕过。

---

## 二、兼容性总览

| 使用方式 | v1.x 行为 | v2.0 行为 | 是否需要迁移 |
|----------|-----------|---------------|--------------|
| stdio 本地启动 | 默认无认证 | 默认仍可无认证，subject=`local:stdio` | 通常不需要 |
| HTTP + 无认证 | v1.8 开发模式可能允许 | 默认拒绝，除非显式 `DB_AUTH_DISABLED=true` | 需要 |
| HTTP + API key | v1.8 过渡保护 | 可保留开发 fallback，但生产推荐 bearer | 需要 |
| HTTP + Bearer Token | v1.x 未支持 | v2.0 推荐生产模式 | 需要配置 |
| 现有 `DB_MCP_CONNECTIONS` | 当前连接格式 | 保持兼容 | 不需要 |
| readonly/keyPrefix/allowlist | 工具层判断 | 继续保留 | 不需要 |

---

## 三、迁移阶段

### 3.1 Phase A：升级前盘点

发布 v2.0 前，先完成以下盘点：

| 检查项 | 操作 |
|--------|------|
| 连接清单 | 运行 `list_connections`，确认所有 connection_id |
| 默认连接 | 确认 `DB_MCP_DEFAULT_CONNECTION_ID` 是否存在 |
| 写连接 | 找出所有 `readonly:false` 的连接 |
| Redis 前缀 | 确认所有 Redis 写操作都有 `keyPrefix` |
| Mongo 集合 | 确认 MongoDB 生产连接使用 `allowlist` |
| HTTP 暴露 | 确认是否绑定非 localhost |
| 审计 | 确认是否需要持久化 audit |

### 3.2 Phase B：引入 Bearer Token

新增配置示例：

```env
DB_MCP_TRANSPORT=http
DB_AUTH_MODE=bearer
DB_AUTH_ISSUER=https://idp.example.com/
DB_AUTH_AUDIENCE=polyglot-db-mcp-server
DB_AUTH_JWKS_URL=https://idp.example.com/.well-known/jwks.json
DB_RBAC_DEFAULT_EFFECT=deny
```

验收：

- 无 token 请求返回 401。
- issuer/audience 不匹配返回 401。
- 过期 token 返回 401。
- token 原文不出现在日志或审计中。

### 3.3 Phase C：创建 RBAC policy

从最小只读策略开始：

```json
{
  "version": "2026-07-09",
  "roles": {
    "readonly_analyst": [
      {
        "resources": ["connection:local", "connection:pg"],
        "actions": ["read", "diagnose"],
        "conditions": {
          "maxRows": 500,
          "maskingMode": "strict-v2"
        }
      }
    ]
  },
  "bindings": [
    { "subject": "agent:report", "roles": ["readonly_analyst"] }
  ]
}
```

配置：

```env
DB_RBAC_POLICY_FILE=./rbac-policy.json
DB_RBAC_DEFAULT_EFFECT=deny
```

验收：

- `agent:report` 可执行 read/diagnose。
- `agent:report` 不可执行 write/admin/export。
- `maskingMode` 会在 SQL/Mongo read rows 返回前逐请求生效，且不能弱化全局脱敏配置。
- 拒绝事件进入 audit。

### 3.4 Phase D：替换 API key

| v1.8 API key | v2.0 Bearer/RBAC |
|--------------|------------------|
| 一个 key 代表全部权限 | token subject 映射到角色 |
| 无细粒度权限 | 按 connection/tool/action 授权 |
| 审计身份弱 | 审计记录 subject/roles |
| 适合本地/过渡 | 适合生产 |

迁移建议：

1. 开发环境可暂时保留 API key fallback。
2. 生产环境改为 bearer + RBAC。
3. API key fallback 必须在文档中标注“不适合企业生产”。

### 3.5 Phase E：上线与观察

上线后观察：

- 401 数量：认证失败。
- 403 数量：授权拒绝。
- deny audit：是否存在误拒绝。
- write/admin 调用：是否符合预期。
- 慢查询和大结果：是否被 policy 限制。

---

## 四、配置迁移映射

| v1.x 配置 | v2.0 配置 | 说明 |
|-----------|-----------|------|
| `DB_MCP_CONNECTIONS` | 保持不变 | 连接模型兼容 |
| `DB_MCP_DEFAULT_CONNECTION_ID` | 保持不变 | 默认连接兼容 |
| `DB_HTTP_API_KEY` | `DB_AUTH_MODE=bearer` + token | API key 变为过渡方案 |
| `DB_HTTP_AUTH_DISABLED=true` | 仅开发保留 | 生产不得使用 |
| 无 RBAC | `DB_RBAC_POLICY_FILE` | 新增权限策略 |
| 无 default effect | `DB_RBAC_DEFAULT_EFFECT=deny` | 生产默认拒绝 |
| `readonly` | 保持不变 | 连接级保护仍生效 |
| `keyPrefix` | 保持不变，可叠加 policy | Redis 安全边界仍生效 |
| `allowlist` | 保持不变，可叠加 policy | Mongo 安全边界仍生效 |

---

## 五、常见迁移场景

### 5.1 仅本地 stdio 用户

不需要迁移认证配置。

建议仍执行：

```powershell
npm run build
npm test
```

确认：

- 默认 stdio 启动不要求 token。
- MCP 客户端配置不需要改。

### 5.2 内网 HTTP 只读查询服务

建议：

1. 配置 bearer token。
2. 创建 `readonly_analyst` role。
3. 仅允许 `read` 和 `diagnose`。
4. 强制 `maxRows` 和 `maskingMode`。

### 5.3 Redis 写入服务

建议：

1. Redis 连接保留 `keyPrefix`。
2. RBAC role 只允许目标 Redis connection。
3. policy condition 中禁止危险命令。
4. 审计所有 write action。

### 5.4 管理员/DBA

建议：

1. 单独 subject/role。
2. admin 权限不要授予通配资源。
3. admin 操作必须完整审计。
4. DROP/TRUNCATE/ALTER 等仍受工具层 guard 控制。

---

## 六、回滚策略

| 失败场景 | 回滚方式 |
|----------|----------|
| token 验证配置错误 | 暂时切回 v1.8 API key 或修复 IdP/JWKS 配置 |
| policy 误拒绝 | 调整 policy bindings；保留 default deny |
| 生产访问中断 | 回滚到上一版本镜像和配置 |
| audit 量过大 | 降低 audit sink 级别，但不关闭 deny audit |
| stdio 回归 | 立即回滚；stdio 兼容是 v2.0 发布阻塞项 |

禁止：

- 生产环境长期使用 `DB_AUTH_DISABLED=true`。
- 为解决权限问题授予 `*:*` 通配 admin。
- 关闭工具层 readonly/guard/keyPrefix/allowlist。

---

## 七、迁移验收清单

- [ ] v1.x 配置已备份。
- [ ] `DB_MCP_CONNECTIONS` 解析通过。
- [ ] Bearer Token issuer/audience/JWKS 配置通过。
- [ ] RBAC policy 校验通过。
- [ ] 默认未匹配权限为 deny。
- [ ] read/write/admin/diagnose/export 权限符合预期。
- [ ] deny audit 可查询。
- [ ] token 和连接密码未进入日志。
- [ ] stdio 本地模式仍兼容。
- [ ] README/CONFIG/ERRORS/CHANGELOG 已同步。

---

## 八、发布状态与后续项

v2.0.0 已补齐：

1. 可执行 policy validator：`auth_policy_validate`。
2. 最小 bearer 配置示例：README、`.env.example`、`docs/CONFIG.md`。
3. 401/403 错误码和 hint 文档：`docs/ERRORS.md`。
4. v1.8 API key 到 v2.0 bearer 的迁移路径。
5. 授权 allow/deny 审计字段说明。

后续项：

1. 增加更多生产 policy 模板：readonly、Redis operator、admin 分离文件。
2. `maskingMode` condition 已在 v2.0.1 接入逐请求脱敏执行上下文。
3. 增加审计持久化 sink，与 v2.2 可观测治理合流。
