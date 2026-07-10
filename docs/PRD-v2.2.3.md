# PRD v2.2.3：OpenTelemetry exporter 配置

**文档编号**: PRD-v2.2.3
**日期**: 2026-07-10
**状态**: 已完成
**关联路线图**: Phase 5 可观测与治理

---

## 一、背景

v2.2.0 已在统一授权 wrapper 中创建 OpenTelemetry API span，但需要宿主进程自行注册 provider。v2.2.3 将补齐内置 exporter 配置，让生产部署可以只通过环境变量启用 traces，同时继续保持默认无外发。

## 二、目标

| 优先级 | 目标 | 验收 |
|--------|------|------|
| P0 | 显式启用 OTel exporter | `DB_OTEL_ENABLED=true` 时注册 provider；默认关闭 |
| P0 | OTLP HTTP exporter | 支持 `DB_OTEL_OTLP_ENDPOINT` 和标准 `OTEL_EXPORTER_OTLP_*` endpoint |
| P0 | 安全摘要 | 启动诊断不泄漏 OTLP header 值或 endpoint 明文 |
| P1 | 采样和 batch 配置 | 支持 sampling ratio、batch interval、timeout、queue、batch size |
| P1 | 优雅关闭 | shutdown 时尽力 flush span processor/provider |
| P1 | 文档和测试 | `.env.example`、CONFIG、README、ROADMAP、CHANGELOG 同步 |

## 三、不纳入本版本

| 项目 | 处理 |
|------|------|
| Metrics/logs OTLP exporter | 后续根据运维需求独立推进 |
| 自动 instrumentation | 当前只导出服务显式创建的 MCP tool span |
| 外部审计 sink | webhook sink 已在 v2.2.4 独立推进；数据库 sink 留给后续插件化 exporter |
| 插件式 exporter | v3.0.0 Export Plugin 范围 |

## 四、安全边界

- OTel 必须显式启用，避免共享 shell 或 CI 中残留 endpoint 触发真实外发。
- `DB_OTEL_OTLP_HEADERS` 不进入安全摘要和启动诊断。
- exporter 不记录 SQL、查询参数、token 或查询结果；span 属性保持在 tool/action/transport/connection/error/duration 等运维元数据。
- 初始化失败应作为配置错误 fail-fast，避免生产环境误以为 traces 已接入。
