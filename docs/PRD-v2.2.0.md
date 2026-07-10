# PRD v2.2.0：可观测与治理基线

**文档编号**: PRD-v2.2.0
**日期**: 2026-07-10
**状态**: 已完成
**关联路线图**: Phase 5 可观测与治理

---

## 一、背景

v2.1.x 已完成 DuckDB、本地分析、查询导出和采样画像。下一阶段需要把服务从“可调用”推进到“可运维、可追踪、可治理”，为 v3.0.0 插件生态前的统一 wrapper、审计和策略能力打基础。

## 二、目标

| 优先级 | 目标 | 验收 |
|--------|------|------|
| P0 | HTTP 暴露 Prometheus 指标 | `GET /metrics` 返回 text exposition，并默认复用 HTTP 认证 |
| P0 | 工具调用运行时指标 | 记录 tool/action/transport/connection 维度的调用、失败、耗时和错误码 |
| P0 | OpenTelemetry tracing 接入点 | 每次工具调用创建 OTel span，写入 tool、connection、duration、error code 等属性 |
| P1 | 指标逻辑复用 | `prometheus_metrics` 工具与 `/metrics` 使用同一生成逻辑 |
| P1 | CI 稳定性 | HTTP 测试避免随机分配 Fetch blocked port 导致抖动 |

## 三、不纳入本版本

| 项目 | 处理 |
|------|------|
| OTel exporter 配置 | v2.2.0 只接入 API span；已在 v2.2.3 增加内置 exporter/env 配置 |
| 告警 webhook | v2.2.x 后续 |
| 外部配置中心 | v2.2.x 或 v2.3.0 |
| 写操作审批流 | 依赖更完整 policy workflow，后续独立设计 |

## 四、安全边界

- `/metrics` 不是健康检查端点，生产环境默认必须认证。
- 指标只记录运行时元数据，不记录 SQL、参数、token、查询结果或脱敏前数据。
- 工具调用仍必须经过统一授权、审计和各工具自身的只读/allowlist/keyPrefix 保护。
