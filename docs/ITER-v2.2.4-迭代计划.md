# v2.2.4 迭代计划：外部审计 webhook sink

**文档编号**: ITER-v2.2.4
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD**: `docs/PRD-v2.2.4.md`

---

## 一、目标

完成 v2.2.4 治理扩展：在内存审计和文件 JSONL sink 之上增加 webhook sink，让生产环境可以将审计事件外发到内网采集器，并为 v3.0.0 Export Plugin 提供保守事件外发语义。

## 二、任务拆分

| ID | 优先级 | 任务 | 范围 | 状态 |
|----|--------|------|------|------|
| AUDIT-001 | P0 | `DB_AUDIT_SINK=webhook` 配置解析 | `src/core/audit.ts` | 已完成 |
| AUDIT-002 | P0 | webhook dispatch、timeout、失败不阻断 | `src/core/audit.ts` | 已完成 |
| AUDIT-003 | P1 | 审计 sink 安全摘要 | `src/core/audit.ts`、`src/bootstrap.ts` | 已完成 |
| AUDIT-004 | P1 | 单元测试覆盖配置、secret header 和安全摘要 | `test/audit.test.mjs` | 已完成 |
| DOC-001 | P1 | README、CONFIG、ROADMAP、CHANGELOG 更新 | docs / README | 已完成 |

## 三、验收标准

- 默认 `memory` 行为不变。
- `file` sink 与旧 `MCP_AUDIT_LOG` 兼容不变。
- `webhook` sink 启用时必须配置 http(s) URL。
- `DB_AUDIT_WEBHOOK_SECRET` 只进入请求 header，不进入 payload 或安全摘要。
- webhook 发送失败不阻断工具调用。
- `npm run build` 后相关测试通过。

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| 无可靠队列和重试 | P2 | 当前定位为轻量外发；高可靠采集交给内网 collector 或后续插件 |
| 无多 sink 同时写入 | P2 | v3.0 Export Plugin 可扩展多 sink fan-out |
| payload 字段不可配置 | P2 | 后续审批式策略治理可增加字段级外发控制 |
