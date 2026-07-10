# v2.2.3 迭代计划：OpenTelemetry exporter 配置

**文档编号**: ITER-v2.2.3
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD**: `docs/PRD-v2.2.3.md`

---

## 一、目标

完成 v2.2.3 可观测补强：在 v2.2.0 的 OTel API span 基线上增加内置 exporter bootstrap，为生产环境和后续 v3.0.0 Export Plugin 提供稳定配置语义。

## 二、任务拆分

| ID | 优先级 | 任务 | 范围 | 状态 |
|----|--------|------|------|------|
| OTEL-001 | P0 | OTel 配置解析和安全摘要 | `src/core/telemetry.ts` | 已完成 |
| OTEL-002 | P0 | NodeTracerProvider + OTLP HTTP/console exporter 注册 | `src/core/telemetry.ts` | 已完成 |
| OTEL-003 | P0 | 启动和优雅关闭接入 | `src/index.ts` | 已完成 |
| OTEL-004 | P1 | 启动诊断 telemetry 摘要 | `src/bootstrap.ts` | 已完成 |
| OTEL-005 | P1 | 单元测试覆盖默认关闭、endpoint、header 脱敏和阈值校验 | `test/telemetry.test.mjs` | 已完成 |
| DOC-001 | P1 | README、CONFIG、ROADMAP、CHANGELOG 更新 | docs / README | 已完成 |

## 三、验收标准

- 默认配置下不注册 exporter，也不校验残留 endpoint/header。
- `DB_OTEL_ENABLED=true` 可启用 `otlp_http` 或 `console` exporter。
- `DB_OTEL_OTLP_HEADERS` 不出现在安全配置摘要中。
- 采样比例、batch 队列和超时参数有确定性配置校验。
- 进程 shutdown 时调用 telemetry shutdown。
- `npm run build` 后相关测试通过。

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| 未覆盖 metrics/logs exporter | P2 | 当前只补齐 traces；Prometheus metrics 仍走 `/metrics` |
| 未提供自动 instrumentation | P2 | 当前只导出 MCP tool span，避免依赖和隐私面扩大 |
| OTLP header 只支持静态 key=value | P2 | 后续配置中心或插件化 exporter 可扩展动态凭证 |
