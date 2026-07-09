# v2.0.0 质量报告：企业安全基线

**文档编号**: QUALITY-v2.0.0
**版本**: 1.0
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD/ITER**: `docs/PRD-v2.0.0.md`, `docs/ITER-v2.0.0-迭代计划.md`

---

## 一、审查结论

| 结论项 | 状态 | 证据 |
|--------|------|------|
| 是否允许发布 | 通过 | 本地 build/test/typecheck/lint/coverage/pack/benchmark 均通过；Windows 全仓 format 受 CRLF 影响，已对变更 TS 文件单独校验 |
| HTTP Bearer Token | 通过 | `test/auth/token-verifier.test.mjs` 和 `test/transports/http-auth.test.mjs` 覆盖认证路径 |
| RBAC 授权 | 通过 | `test/auth/rbac.test.mjs` 覆盖 subject/role/resource/action/default deny/maxRows |
| Tool action map | 通过 | `test/auth/tool-action-map.test.mjs` 自动覆盖所有注册工具 |
| 授权审计 | 通过 | `test/auth/authorization.test.mjs` 覆盖 allow/deny 审计且不记录 token 原文 |
| 安全边界 | 通过 | `sql_query` MCP 层只读检查保留；Mongo/Redis/SQL 既有安全测试通过 |
| 文档同步 | 通过 | README、README_en、CONFIG、ERRORS、API、CHANGELOG、`.env.example` 已同步 |

---

## 二、命令结果

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm ci` | 通过 | 依赖按 lockfile 干净安装；全量 audit 为 0 |
| `npm run docs` | 通过 | 生成 `docs/API.md`，工具数 91 |
| `npm run build` | 通过 | 编译产物生成成功 |
| `npm test` | 通过 | 111 suites / 505 tests / 0 failed |
| `npm run typecheck` | 通过 | TypeScript noEmit 通过 |
| `npm run lint` | 通过 | ESLint 通过 |
| changed TS `prettier --check` | 通过 | 变更 TypeScript 文件均符合 Prettier；全仓 Windows checkout 受 `core.autocrlf=true` 行尾影响 |
| `npm run test:coverage:check` | 通过 | All files lines 66.53%，branches 72.47%，functions 70.67% |
| `npm pack --dry-run` | 通过 | `@yclenove/polyglot-db-mcp-server@2.0.0`，198 files |
| `npm run benchmark` | 通过 | SQL guards benchmark 通过，生成报告未纳入变更 |
| `npm audit` | 通过 | 0 vulnerabilities |

---

## 三、安全复核

| 安全项 | 状态 | 证据 |
|--------|------|------|
| HTTP 默认认证 | 通过 | HTTP 默认 `DB_AUTH_MODE=bearer`；`DB_AUTH_DISABLED=true` 才显式关闭 |
| Bearer token 校验 | 通过 | `jose` 校验 issuer、audience、expiry、JWKS 签名 |
| API key fallback | 通过 | 仅在 `DB_AUTH_MODE=api_key` 且设置 `DB_HTTP_API_KEY` 时启用 |
| RBAC default deny | 通过 | 未匹配 subject/role/resource/action 默认拒绝 |
| 授权审计脱敏 | 通过 | audit 记录 subject/roles/decision/reason，不记录 token 原文 |
| SQL 只读保护 | 通过 | `sql_query` 仍在工具层执行 `isReadOnlyQuery` 后再调用 driver |
| Redis/Mongo 边界 | 通过 | keyPrefix、blocked command、readonly、allowlist、NoSQL guard 测试仍通过 |
| Secrets | 通过 | 新增配置均为占位符或测试 token，不包含生产凭证 |

---

## 四、发布阻塞项

| 编号 | 阻塞项 | 等级 | 状态 |
|------|--------|------|------|
| B-001 | Lint 报 `URL is not defined` | P0 | 已修复，改为显式 `node:url` 导入 |
| B-002 | HTTP bearer/RBAC 无集成测试 | P0 | 已解除，新增 `test/transports/http-auth.test.mjs` |
| B-003 | 工具 action map 覆盖不完整 | P0 | 已解除，测试自动扫描所有注册工具 |
| B-004 | 文档仍为草案状态 | P1 | 已解除，PRD/ADR/Migration/Index/Roadmap 已同步 |

---

## 五、接受风险与后续

| 风险 | 等级 | 处理 |
|------|------|------|
| `maskingMode` condition 未逐请求强制执行 | P1 | v2.0.x 改造脱敏为请求上下文后接入 |
| 审计持久化 sink 未纳入 v2.0 | P1 | v2.2 可观测治理阶段实现 |
| Windows 本地全仓 format 受 CRLF 影响 | P2 | CI Ubuntu/LF 运行全仓检查；本地已对变更 TS 文件通过 Prettier |

---

## 六、CI 观察

- GitHub Actions 最新 `main` run #10（提交 `5653e61`）为成功。
- 历史失败集中在旧 run #3/#4，不代表当前 `main`。
- v2.0.0 分支推送后需等待新的 `codex/v2.0-enterprise-security` CI run 通过，再快进合入 `main`。
