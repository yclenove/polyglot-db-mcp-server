# v2.2.5 迭代计划：审批声明式策略门控

**文档编号**: ITER-v2.2.5
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD**: `docs/PRD-v2.2.5.md`

---

## 一、目标

完成 v2.2.5 治理扩展：在 RBAC policy conditions 中加入审批声明门控，让写操作、管理操作或企业自定义角色可以要求 bearer claims 中存在审批证据，为 v3.0.0 Policy Plugin 提供稳定输入。

## 二、任务拆分

| ID | 优先级 | 任务 | 范围 | 状态 |
|----|--------|------|------|------|
| GOV-001 | P0 | `approvalRequired` / `approvalClaim` policy 解析 | `src/auth/rbac.ts` | 已完成 |
| GOV-002 | P0 | 授权 matcher 校验 bearer claims 审批证据 | `src/auth/rbac.ts`, `src/auth/authorization.ts` | 已完成 |
| GOV-003 | P1 | 授权审计写入审批元信息且不泄漏 payload | `src/auth/authorization.ts` | 已完成 |
| GOV-004 | P1 | 单元测试覆盖拒绝、允许、过期和审计边界 | `test/auth/*` | 已完成 |
| DOC-001 | P1 | README、CONFIG、ROADMAP、CHANGELOG、INDEX 更新 | docs / README | 已完成 |

## 三、验收标准

- 未声明审批条件的现有 policy 行为不变。
- 声明 `approvalRequired=true` 时，未提供审批 claim 的请求拒绝授权。
- 默认 claim 为 `db_mcp_approval`，可用 `approvalClaim` 指定自定义名称。
- 对象 claim 必须为 `status=approved`，且 `expires_at` 不能过期。
- 授权审计不记录审批 payload。
- `npm run build` 后相关测试通过。

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| 尚无审批工作流 | P2 | 当前仅定义策略门控；审批系统由外部网关或后续插件接入 |
| 字符串 claim 语义较宽 | P2 | 用于兼容现有 IdP；生产建议使用对象 claim 并设置过期时间 |
| 无动态撤销 | P2 | 依赖 JWT 有效期；后续 Policy Plugin 可接入实时审批状态 |
