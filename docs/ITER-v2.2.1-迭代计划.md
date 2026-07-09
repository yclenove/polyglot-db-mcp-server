# v2.2.1 迭代计划：审计持久化与策略模板

**文档编号**: ITER-v2.2.1
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD**: `docs/PRD-v2.2.1.md`

---

## 一、目标

完成 v2.2.1 治理扩展：把审计文件持久化从隐式旧变量收束为正式配置，并提供内置 RBAC policy 模板与 MCP 导出工具，降低企业接入 RBAC 的起步成本。

## 二、任务拆分

| ID | 优先级 | 任务 | 范围 | 状态 |
|----|--------|------|------|------|
| GOV-001 | P0 | 审计持久化配置解析 | `src/core/audit.ts` | 已完成 |
| GOV-002 | P0 | JSONL 文件 sink 与旧变量兼容 | `src/core/audit.ts` | 已完成 |
| GOV-003 | P0 | 内置 RBAC policy 模板 | `src/auth/rbac.ts` | 已完成 |
| GOV-004 | P1 | 启动配置接入 `DB_RBAC_POLICY_TEMPLATE` | `src/core/http-config.ts`、`src/index.ts` | 已完成 |
| GOV-005 | P1 | 新增 `auth_policy_template` 工具 | `src/tools/auth.ts` | 已完成 |
| GOV-006 | P1 | 测试覆盖 audit、RBAC、authorization、auth tools、HTTP config | `test/*` | 已完成 |
| DOC-001 | P1 | README、CONFIG、API、ROADMAP、CHANGELOG 更新 | docs / README | 已完成 |

## 三、验收标准

- `DB_AUDIT_SINK=file` 和 `DB_AUDIT_FILE_PATH` 可写入 JSONL 审计记录。
- 未设置新变量但设置 `MCP_AUDIT_LOG` 时仍兼容旧文件审计路径。
- `DB_RBAC_POLICY_TEMPLATE=readonly-http` 可被授权 runtime 加载，并拒绝写操作。
- `auth_policy_template` 返回的模板可被 `auth_policy_validate` 校验通过。
- `sql_query` MCP 层只读保护不变。
- `npm run build` 后 `npm test` 通过。

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| 文件 sink 不做轮转 | P2 | 交给宿主日志系统或后续 v2.2.x 增加轮转/外部 sink |
| policy 模板仍需人工收紧 | P2 | 明确模板是起点；生产建议复制为 `DB_RBAC_POLICY_FILE` 后维护 |
| 外部审批流未完成 | P2 | 保留在后续策略治理迭代 |
