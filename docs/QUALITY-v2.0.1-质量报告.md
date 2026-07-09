# v2.0.1 质量报告：Policy Masking 安全收口

**文档编号**: QUALITY-v2.0.1
**版本**: 1.0
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD/ITER**: `docs/PRD-v2.0.0.md`, `docs/ITER-v2.0.1-迭代计划.md`

---

## 一、审查结论

| 结论项 | 状态 | 证据 |
|--------|------|------|
| 是否允许发布 | 通过 | 本地 build/test/typecheck/lint/coverage/pack/benchmark 均通过；Windows 全仓 format 受 CRLF 影响，已对变更 TS 文件单独校验 |
| 请求级 policy context | 通过 | `test/auth/authorization.test.mjs` 验证 handler 内 conditions 可见且执行后清理 |
| SQL policy masking | 通过 | `test/tools/sql.test.mjs` 覆盖 `maskingMode: strict-v2` 返回脱敏 |
| Mongo policy masking | 通过 | `test/tools/mongo.test.mjs` 覆盖 `mongo_find` 返回脱敏 |
| 并发安全设计 | 通过 | 使用 `AsyncLocalStorage`，不修改全局 masking config |
| 安全边界 | 通过 | `sql_query` 只读检查顺序保留，Mongo NoSQL guard 和 allowlist 路径不变 |
| 文档同步 | 通过 | CHANGELOG、CONFIG、ROADMAP、INDEX、v2.0.0 风险说明已更新 |

---

## 二、命令结果

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run build` | 通过 | TypeScript 编译成功 |
| `npm test` | 通过 | 111 suites / 508 tests / 0 failed |
| `npm run typecheck` | 通过 | TypeScript noEmit 通过 |
| `npm run lint` | 通过 | ESLint 通过 |
| `npm run format:check` | 本地 Windows 受限 | 全仓检查因 CRLF 命中旧文件；变更 TS 文件 `npx prettier --check ...` 通过，CI Ubuntu 预期全仓通过 |
| `npm run test:coverage:check` | 通过 | All files lines 66.72%，branches 72.59%，functions 71.18% |
| `npm pack --dry-run` | 通过 | `@yclenove/polyglot-db-mcp-server@2.0.1`，206 files |
| `npm run benchmark` | 通过 | SQL guards benchmark 通过，生成报告已恢复不纳入变更 |
| `docker compose config` | 通过 | Compose 配置可解析 |
| `git diff --check` | 通过 | 仅输出 Windows CRLF 提示，无 whitespace error |
| `npm audit` | 通过 | 0 vulnerabilities |
| secrets scan | 通过 | 命中均为占位符、本地 dev Compose 密码、测试 token 或文档术语，无生产凭证 |

---

## 三、安全复核

| 安全项 | 状态 | 证据 |
|--------|------|------|
| policy `maskingMode` 执行 | 通过 | 授权 decision conditions 经请求上下文传入工具返回脱敏 |
| 全局配置不被弱化 | 通过 | 仅当 policy mode rank 强于全局 mode 时才提升有效配置 |
| SQL cache 隔离 | 通过 | cache 保存原始 result，返回时按当前请求 policy 重新脱敏 |
| Mongo read rows | 通过 | 仅对对象行执行脱敏，primitive rows 保持原样 |
| Secrets | 通过 | 新增内容仅包含测试邮箱和文档占位符；全仓扫描无生产凭证 |

---

## 四、剩余风险与后续

| 风险 | 等级 | 处理 |
|------|------|------|
| 表/集合/key prefix 级完整 ABAC 尚未实现 | P1 | v2.x policy engine 扩展，当前仍保留 connection/tool/action 粒度 |
| 审计持久化 sink 未纳入本补丁 | P1 | v2.2 可观测治理阶段实现 |
| Windows 本地全仓 format 可能受 CRLF 影响 | P2 | 以 CI Ubuntu 全仓 format 为准，必要时对变更 TS 文件单独校验 |

---

## 五、CI 观察

- GitHub Actions 最新 `codex/v2.0-enterprise-security` run #11（提交 `6c7e2af`）为成功。
- GitHub Actions 最新 `main` run #12（提交 `6c7e2af`）为成功。
- 历史失败集中在旧 run #3/#4，不代表当前 `main`。
- v2.0.1 分支推送后需等待新的 `codex/v2.0.1-policy-masking` CI run 通过，再快进合入 `main`。
