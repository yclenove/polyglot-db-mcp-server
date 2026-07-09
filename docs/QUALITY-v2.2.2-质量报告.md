# v2.2.2 质量报告：告警 webhook 基线

**文档编号**: QUALITY-v2.2.2
**日期**: 2026-07-10
**状态**: 已完成
**关联 ITER**: `docs/ITER-v2.2.2-迭代计划.md`

---

## 一、结论

v2.2.2 新增显式启用的告警 webhook、连接失败告警、工具错误率告警、慢工具调用告警和 `alert_test` 诊断工具。完整 CI 与发布门禁已通过，可以进入提交与远端 CI 验证。

## 二、质量门禁记录

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm ci` | 通过 | Node 24 环境安装依赖，0 vulnerabilities；Windows 文件锁重试后通过 |
| `npm run build` | 通过 | TypeScript 编译通过 |
| `node --test --test-name-pattern=. test/alerts.test.mjs test/observability.test.mjs test/tools/connections.test.mjs test/auth/authorization.test.mjs test/auth/tool-action-map.test.mjs test/version.test.mjs` | 通过 | targeted 回归通过，43 tests |
| `npm test` | 通过 | 552 tests / 117 suites / 0 failed |
| `npm run typecheck` | 通过 | `tsc --noEmit` 通过 |
| `npm run lint` | 通过 | `eslint src/` 通过 |
| `npm run format:check` | 通过 | Prettier 检查通过 |
| `npm run test:coverage:check` | 通过 | 552 tests；总覆盖率 statements 69.52%、branches 72.53%、functions 74.57%、lines 69.52%，超过 50% 门槛 |
| `npm pack --dry-run` | 通过 | `yclenove-polyglot-db-mcp-server-2.2.2.tgz`，218 files，package size 186.2 kB |
| `npm run benchmark` | 通过 | SQL guards 总操作数/秒 256,602,277；平均操作数/秒 6,579,546 |
| `docker compose config` | 通过 | Compose 配置可解析 |
| `npm audit --audit-level=moderate` | 通过 | 0 vulnerabilities |
| `git diff --check` | 通过 | 仅 Windows CRLF 工作区提示，无空白错误 |

## 三、安全复核

| 项目 | 结论 | 证据 |
|------|------|------|
| 显式启用 | 通过 | `alerts.test.mjs` 覆盖默认 disabled、`DB_ALERT_ENABLED=true` 缺 URL 报 `CFG_005` |
| webhook secret | 通过 | `alerts.test.mjs` 和 `connections.test.mjs` 覆盖 secret 只进 header，不进入安全摘要和工具返回 |
| 连接失败告警 | 通过 | `alerts.test.mjs` 覆盖默认连接 `critical`、非默认连接 `warning` |
| 工具错误率和慢调用 | 通过 | `alerts.test.mjs` 覆盖 `tool_error_rate`、`slow_tool_call` payload 和阈值 |
| 统一 RBAC 边界 | 通过 | `tool-action-map.test.mjs` 覆盖 `alert_test` 已归类为 `diagnose` |
| 既有 MCP 安全边界 | 通过 | 完整测试覆盖 `sql_query` 写 SQL 仍返回 `SQL_002` |

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| 告警无持久化队列 | P2 | 当前定位为尽力通知；关键审计仍由文件 JSONL 或后续外部 sink 承担 |
| 告警规则仍为内置阈值 | P2 | 后续 v2.2.x 策略治理可引入规则 DSL 或配置中心 |
| 未实现频繁写操作告警 | P2 | 保留给审批式策略治理，与写操作 workflow 一起设计 |
