# v2.2.1 质量报告：审计持久化与策略模板

**文档编号**: QUALITY-v2.2.1
**日期**: 2026-07-10
**状态**: 已完成
**关联 ITER**: `docs/ITER-v2.2.1-迭代计划.md`

---

## 一、结论

v2.2.1 新增正式审计文件 sink 配置、RBAC 内置 policy 模板、模板运行时加载和 `auth_policy_template` 工具。完整 CI 与发布门禁已通过，可以进入提交与远端 CI 验证。

## 二、质量门禁记录

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm ci` | 通过 | Node 24 环境安装依赖，0 vulnerabilities |
| `npm run build` | 通过 | TypeScript 编译通过 |
| `node --test --test-name-pattern=. test/audit.test.mjs test/auth/rbac.test.mjs test/auth/authorization.test.mjs test/tools/auth.test.mjs test/transports/http-config.test.mjs test/auth/tool-action-map.test.mjs` | 通过 | targeted 回归通过，40 tests |
| `npm test` | 通过 | 545 tests / 116 suites / 0 failed |
| `npm run typecheck` | 通过 | `tsc --noEmit` 通过 |
| `npm run lint` | 通过 | `eslint src/` 通过 |
| `npm run format:check` | 通过 | Prettier 检查通过 |
| `npm run test:coverage:check` | 通过 | 545 tests；总覆盖率 statements 68.81%、branches 72.34%、functions 73.53%、lines 68.81%，超过 50% 门槛 |
| `npm pack --dry-run` | 通过 | `yclenove-polyglot-db-mcp-server-2.2.1.tgz`，214 files，package size 178.1 kB |
| `npm run benchmark` | 通过 | SQL guards 总操作数/秒 240,905,434；平均操作数/秒 6,177,062 |
| `docker compose config` | 通过 | Compose 配置可解析 |
| `npm audit --audit-level=moderate` | 通过 | 0 vulnerabilities |
| `git diff --check` | 通过 | 仅 Windows CRLF 工作区提示，无空白错误 |

## 三、安全复核

| 项目 | 结论 | 证据 |
|------|------|------|
| 审计文件持久化 | 通过 | `audit.test.mjs` 覆盖 JSONL 写入和旧变量兼容 |
| policy 模板边界 | 通过 | `rbac.test.mjs` 覆盖只读 HTTP 模板拒绝写操作和 maxRows 限制 |
| 运行时模板加载 | 通过 | `authorization.test.mjs` 覆盖 `createAuthorizationRuntime` 加载模板 |
| 模板导出工具 | 通过 | `auth.test.mjs` 覆盖模板导出与 validate 闭环 |
| 既有 MCP 安全边界 | 通过 | 完整测试覆盖 `sql_query` 写 SQL 仍返回 `SQL_002`，工具 action map 覆盖新增工具 |

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| 文件审计无内置轮转 | P2 | 建议由外部日志采集/轮转系统处理；后续可增加 sink 插件接口 |
| 模板不是最终生产 policy | P2 | 文档明确模板为起点，生产复制为文件后收紧 |
