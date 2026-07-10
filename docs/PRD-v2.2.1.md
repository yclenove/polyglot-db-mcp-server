# PRD v2.2.1：审计持久化与策略模板

**文档编号**: PRD-v2.2.1
**日期**: 2026-07-10
**状态**: 已完成
**关联路线图**: Phase 5 可观测与治理

---

## 一、背景

v2.2.0 已完成 `/metrics`、工具调用指标和 OTel API span。下一步需要把治理能力从“可观测”推进到“可追责、可快速配置”，为 v3.0.0 插件化前的统一审计和策略边界做铺垫。

## 二、目标

| 优先级 | 目标 | 验收 |
|--------|------|------|
| P0 | 正式化审计文件持久化配置 | `DB_AUDIT_SINK=file` + `DB_AUDIT_FILE_PATH` 写入 JSONL；旧 `MCP_AUDIT_LOG` 继续兼容 |
| P0 | 内置 RBAC policy 模板 | 提供 `readonly-http`、`diagnostic-readonly`、`local-admin` 模板，并经过同一 parser 校验 |
| P1 | 运行时可加载模板 | `DB_RBAC_POLICY_TEMPLATE` 可在无 policy 文件时启用内置模板；policy 文件优先 |
| P1 | MCP 工具导出模板 | `auth_policy_template` 返回模板 JSON，便于复制、校验和落盘 |
| P1 | 配置与文档对齐 | `.env.example`、CONFIG、README、API、ROADMAP、CHANGELOG 同步 |

## 三、不纳入本版本

| 项目 | 处理 |
|------|------|
| 外部审计数据库或 webhook sink | 后续 v2.2.x 独立推进 |
| OTel exporter 自动注册 | 已在 v2.2.3 独立推进 |
| 写操作审批流 | 需要更完整 policy workflow，后续设计 |
| 插件加载机制 | v3.0.0 前置 ADR 复核后进入 |

## 四、安全边界

- 文件审计为追加 JSONL，不改变工具返回语义；写入失败不阻断主流程。
- 审计持久化配置错误会在启动诊断阶段暴露，避免生产部署误以为已落盘。
- 内置模板默认保守：HTTP 模板不授予写操作，且强制 `strict-v2` 脱敏和 `maxRows` 限制。
- `local-admin` 只匹配 `local:stdio` 与 stdio transport，不扩大 HTTP 权限。
