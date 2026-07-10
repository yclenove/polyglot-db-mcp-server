# v2.2.2 迭代计划：告警 webhook 基线

**文档编号**: ITER-v2.2.2
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD**: `docs/PRD-v2.2.2.md`

---

## 一、目标

完成 v2.2.2 治理扩展：在既有 Prometheus/OTel 和审计能力之上，新增显式启用的 webhook 告警基线，为 v3.0.0 Export Plugin 边界沉淀稳定事件结构。

## 二、任务拆分

| ID | 优先级 | 任务 | 范围 | 状态 |
|----|--------|------|------|------|
| ALERT-001 | P0 | 告警配置解析与安全摘要 | `src/core/alerts.ts` | 已完成 |
| ALERT-002 | P0 | webhook dispatch、超时、冷却和失败不阻断 | `src/core/alerts.ts` | 已完成 |
| ALERT-003 | P0 | 启动和 SIGHUP 连接失败告警 | `src/index.ts` | 已完成 |
| ALERT-004 | P0 | 工具错误率和慢工具调用告警 | `src/core/observability.ts` | 已完成 |
| ALERT-005 | P1 | `alert_test` MCP 工具和 RBAC action map | `src/tools/connections.ts`、`src/core/tool-action-map.ts` | 已完成 |
| ALERT-006 | P1 | 单元与工具回归测试 | `test/alerts.test.mjs`、`test/tools/connections.test.mjs` | 已完成 |
| DOC-001 | P1 | README、CONFIG、API、ROADMAP、CHANGELOG 更新 | docs / README | 已完成 |

## 三、验收标准

- 默认配置下告警不发送；`DB_ALERT_ENABLED=true` 且配置 URL 后才会调用 webhook。
- `connection_failure`、`tool_error_rate`、`slow_tool_call`、`test` 均有确定 payload。
- `DB_ALERT_WEBHOOK_SECRET` 只进入 header，不进入安全配置摘要和工具返回。
- webhook 失败不阻断工具调用。
- `alert_test` 可被 RBAC 识别为 `diagnose` action。
- `npm run build` 后 `npm test` 通过。

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| 告警规则仍为内置阈值 | P2 | 后续策略治理迭代引入规则 DSL 或配置中心 |
| 无持久化告警队列 | P2 | 当前定位为尽力通知；关键审计由文件或 v2.2.4 webhook sink 承担 |
| 无 OTel exporter 自动注册 | P2 | 已在 v2.2.3 补齐内置 exporter/env 配置 |
