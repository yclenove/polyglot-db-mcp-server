# v2.2.0 质量报告：可观测与治理基线

**文档编号**: QUALITY-v2.2.0
**日期**: 2026-07-10
**状态**: 已完成
**关联 ITER**: `docs/ITER-v2.2.0-迭代计划.md`

---

## 一、结论

v2.2.0 新增 HTTP `/metrics`、统一 Prometheus 指标生成、工具调用内建指标和 OpenTelemetry API span。完整 CI 与发布门禁已通过，可以进入提交与远端 CI 验证。

## 二、质量门禁记录

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run build` | 通过 | TypeScript 编译通过 |
| `node --test --test-name-pattern=. test/observability.test.mjs test/auth/authorization.test.mjs test/transports/http-security.test.mjs test/tools/connections.test.mjs test/auth/tool-action-map.test.mjs test/version.test.mjs` | 通过 | targeted 回归通过，43 tests |
| `npm test` | 通过 | 533 tests / 113 suites / 0 failed |
| `npm run typecheck` | 通过 | `tsc --noEmit` 通过 |
| `npm run lint` | 通过 | `eslint src/` 通过 |
| `npm run format:check` | 通过 | Prettier 检查通过 |
| `npm run test:coverage:check` | 通过 | 533 tests；总覆盖率 statements 68.32%、branches 71.9%、functions 73.19%、lines 68.32%，超过 50% 门槛 |
| `npm pack --dry-run` | 通过 | `yclenove-polyglot-db-mcp-server-2.2.0.tgz`，214 files，package size 174.9 kB |
| `npm run benchmark` | 通过 | SQL guards 总操作数/秒 288,505,802；平均操作数/秒 7,397,585 |
| `docker compose config` | 通过 | Compose 配置可解析 |
| `npm audit --audit-level=moderate` | 通过 | 0 vulnerabilities |
| `git diff --check` | 通过 | 仅 Windows CRLF 工作区提示，无空白错误 |

## 三、安全复核

| 项目 | 结论 | 证据 |
|------|------|------|
| `/metrics` 认证 | 通过 | `http-security.test.mjs` 覆盖匿名开发模式、认证开启拒绝匿名、有效 API key 访问 |
| 指标敏感信息 | 通过 | 仅记录 tool/action/transport/connection/error code/duration，不记录 SQL/params/token |
| OTel span 行为 | 通过 | wrapper 中 span 包裹不改变 result；未配置 provider 时 no-op |
| 授权拒绝路径 | 通过 | deny 返回 `AUTH_005` 并记录工具失败指标 |
| 既有 MCP 安全边界 | 通过 | 工具 handler 内只读、allowlist、keyPrefix 逻辑不变 |

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| OTel exporter 未内置 | P2 | 已在 v2.2.3 扩展 env 配置和 exporter |
| 内存指标不跨进程 | P2 | 当前符合单实例 MCP server；多实例由 Prometheus 聚合 |
