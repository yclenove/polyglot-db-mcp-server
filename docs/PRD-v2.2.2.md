# PRD v2.2.2：告警 webhook 基线

**文档编号**: PRD-v2.2.2
**日期**: 2026-07-10
**状态**: 已完成
**关联路线图**: Phase 5 可观测与治理

---

## 一、背景

v2.2.0 已完成 Prometheus/OTel 可观测基线，v2.2.1 已完成审计文件持久化和 RBAC policy 模板。下一步需要把“可观察”推进为“可通知”，让生产环境能在连接失败、工具错误率升高和慢工具调用时主动通知外部系统。

## 二、目标

| 优先级 | 目标 | 验收 |
|--------|------|------|
| P0 | 告警 webhook 配置 | `DB_ALERT_ENABLED=true` + `DB_ALERT_WEBHOOK_URL` 启用发送；默认关闭 |
| P0 | 连接失败告警 | 启动和 SIGHUP ping 失败触发 `connection_failure`，默认连接为 `critical` |
| P0 | 工具调用告警 | 基于统一 observability wrapper 触发 `tool_error_rate` 和 `slow_tool_call` |
| P1 | 测试告警工具 | 新增 `alert_test`，便于部署后验证 webhook |
| P1 | 安全配置摘要 | 启动诊断和工具返回不泄漏 `DB_ALERT_WEBHOOK_SECRET` |
| P1 | 文档与门禁 | `.env.example`、CONFIG、README、API、ROADMAP、CHANGELOG 同步 |

## 三、不纳入本版本

| 项目 | 处理 |
|------|------|
| 外部审计数据库 sink | 后续 v2.2.x 独立推进 |
| OpenTelemetry exporter 自动注册 | 已在 v2.2.3 独立推进 |
| 告警规则 DSL 和动态 reload | 后续策略治理迭代 |
| 插件化 Export Plugin | v3.0.0 范围 |

## 四、安全边界

- 告警必须显式启用，避免 CI 或共享 shell 环境误触发真实 webhook。
- webhook payload 不包含 SQL、查询参数、token 或连接密码。
- webhook 失败不会阻断工具调用；启动默认连接失败时会尽力发送告警后再退出。
- `alert_test` 归类为 `diagnose` action，仍经过统一 RBAC、审计和指标 wrapper。
