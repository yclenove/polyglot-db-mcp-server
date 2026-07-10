# PRD v2.2.5：审批声明式策略门控

**文档编号**: PRD-v2.2.5
**日期**: 2026-07-10
**状态**: 已完成
**关联路线图**: Phase 5 可观测与治理

---

## 一、背景

v2.0 已建立 Bearer/RBAC 基线，v2.2.1 已提供 policy 模板，v2.2.4 已完成审计 webhook sink。进入 v3.0.0 插件化前，需要先给高风险写入和管理动作沉淀一个保守的审批策略边界，供后续 Policy Plugin、审批系统或外部网关复用。

## 二、目标

| 优先级 | 目标 | 验收 |
|--------|------|------|
| P0 | RBAC condition 支持审批门控 | policy 可声明 `conditions.approvalRequired=true` |
| P0 | 审批证据来自 bearer claims | 未提供有效审批 claim 时拒绝授权 |
| P0 | 支持自定义 claim 名称 | `conditions.approvalClaim` 可覆盖默认 `db_mcp_approval` |
| P1 | 审计审批元信息 | 授权审计记录是否需要审批和 claim 名称，不记录 claim payload |
| P1 | 测试覆盖 | 覆盖无审批、有效审批、过期审批、自定义 claim 和审计不泄漏 |

## 三、不纳入本版本

| 项目 | 处理 |
|------|------|
| 审批 UI 或工单系统 | 后续由企业网关或 Policy Plugin 接入 |
| 审批 token 签名校验 | 本版本复用 JWT/Bearer 验证后的 claims |
| 动态 policy reload | 保持现有静态 policy loader 行为 |
| 工具参数内审批字段 | 不接受工具输入自证审批，避免被调用方伪造 |

## 四、安全边界

- 默认 policy 行为不变，只有显式声明 `approvalRequired` 的规则才启用门控。
- 审批证据必须来自已验证 bearer token 的 claims。
- 字符串 claim 只要求非空；对象 claim 要求 `status="approved"`，并在提供 `expires_at` 时检查未过期。
- 授权审计只记录 `approval_required` 和 `approval_claim`，不记录审批 payload、工单号或 token。
