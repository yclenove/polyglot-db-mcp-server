# v2.2.0 迭代计划：可观测与治理基线

**文档编号**: ITER-v2.2.0
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD**: `docs/PRD-v2.2.0.md`

---

## 一、目标

完成 v2.2.0 可观测基线：统一 Prometheus 输出、HTTP `/metrics`、工具调用指标和 OTel API span，为后续策略治理、告警和插件化统一 wrapper 做前置建设。

## 二、任务拆分

| ID | 优先级 | 任务 | 范围 | 状态 |
|----|--------|------|------|------|
| OBS-001 | P0 | 新增 observability 核心模块 | `src/core/observability.ts` | 已完成 |
| OBS-002 | P0 | 工具调用 OTel span 和内建指标 | `src/auth/authorization.ts` | 已完成 |
| OBS-003 | P0 | HTTP `/metrics` endpoint | `src/transports/http.ts` | 已完成 |
| OBS-004 | P1 | `prometheus_metrics` 复用统一生成逻辑 | `src/tools/connections.ts` | 已完成 |
| OBS-005 | P1 | 测试覆盖核心指标、授权 wrapper、HTTP endpoint | `test/observability.test.mjs` 等 | 已完成 |
| DOC-001 | P1 | README、CONFIG、API、ROADMAP、CHANGELOG 更新 | docs / README | 已完成 |

## 三、验收标准

- `GET /metrics` 在 `DB_AUTH_DISABLED=true` 时可匿名访问，在 HTTP 认证开启时必须提供有效凭据。
- `prometheus_metrics` 和 `/metrics` 输出同一类指标。
- 工具调用 allow、deny、工具返回错误和未捕获异常均可进入内建指标。
- OTel span 不改变工具返回语义；未配置 OTel provider 时为 no-op。
- `npm run build` 后 `npm test` 通过。

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| 当前未内置 OTel exporter | P2 | 先提供 API span 接入点，后续 v2.2.x 增加 exporter/env 配置 |
| 当前指标为内存聚合 | P2 | 适合单进程服务；多实例聚合交给 Prometheus scrape 或后续外部 sink |
| 告警 webhook 未实现 | P2 | 保留在 v2.2.x 治理扩展 |
