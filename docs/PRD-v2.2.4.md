# PRD v2.2.4：外部审计 webhook sink

**文档编号**: PRD-v2.2.4
**日期**: 2026-07-10
**状态**: 已完成
**关联路线图**: Phase 5 可观测与治理

---

## 一、背景

v2.2.1 已支持审计 JSONL 文件持久化，适合由日志系统采集。为进一步靠近企业治理场景，并为 v3.0.0 Export Plugin 沉淀事件外发边界，需要提供一个轻量外部审计 sink。

## 二、目标

| 优先级 | 目标 | 验收 |
|--------|------|------|
| P0 | webhook audit sink | `DB_AUDIT_SINK=webhook` 时 POST 审计事件 |
| P0 | 配置校验 | webhook sink 启用时必须提供 http(s) URL |
| P0 | 失败不阻断 | webhook 发送失败只记录 warning，不影响工具调用 |
| P1 | 安全摘要 | 启动诊断不泄漏 webhook URL 明文或 secret |
| P1 | 测试覆盖 | 覆盖配置解析、secret header、安全摘要和 dispatch |
| P1 | 文档同步 | `.env.example`、CONFIG、README、ROADMAP、CHANGELOG 同步 |

## 三、不纳入本版本

| 项目 | 处理 |
|------|------|
| 同时启用 file + webhook | 后续可用多 sink 或插件化 exporter 扩展 |
| 数据库审计 sink | 后续 v2.2.x 或 v3.0 Export Plugin |
| 审计 payload 字段 DSL | 保留当前审计事件结构，后续策略治理再做字段级控制 |
| 可靠队列与重试 | 当前定位为轻量尽力外发 |

## 四、安全边界

- webhook sink 必须显式配置，不会默认外发。
- `DB_AUDIT_WEBHOOK_SECRET` 只作为 `x-db-mcp-audit-secret` header，不进入 payload 或安全摘要。
- webhook payload 复用审计事件结构，可能包含 SQL/key 等审计字段；生产建议发送到内网审计采集器。
- 配置错误 fail-fast；发送错误不阻断主流程。
