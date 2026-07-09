# v2.0.0 迭代计划：企业安全基线

**文档编号**: ITER-v2.0.0
**版本**: 1.0
**日期**: 2026-07-10
**目标版本**: v2.0.0
**迭代类型**: Major / Enterprise Security
**状态**: 已完成
**上游依据**: `docs/ADR-002-oauth-rbac.md`、`docs/PRD-v2.0.0.md`、`docs/ROADMAP.md`

---

## 一、迭代目标

v2.0.0 建立远程 HTTP MCP 部署的企业安全基线：

1. HTTP 默认 Bearer Token 认证，stdio 继续默认本地无认证。
2. RBAC policy 支持 subject、tenant、role、resource、action 和条件限制。
3. 所有工具调用前经过统一授权 wrapper，保留原有工具安全边界。
4. allow/deny 授权决策进入审计，不泄露 token 原文。
5. README、CONFIG、ERRORS、API、CHANGELOG、迁移文档同步。

---

## 二、任务分解

| 编号 | 优先级 | 任务 | 文件 | 验收 |
|------|--------|------|------|------|
| A-001 | P0 | JWT/JWKS Bearer verifier | `src/auth/token-verifier.ts` | issuer/audience/expiry/signature 测试通过 |
| A-002 | P0 | AuthContext | `src/auth/auth-context.ts` | subject、tenant、roles、transport 可解析 |
| B-001 | P0 | RBAC policy parser 和 matcher | `src/auth/rbac.ts` | default deny、resource wildcard、maxRows 条件测试通过 |
| B-002 | P0 | 工具 action map | `src/core/tool-action-map.ts` | 自动覆盖所有注册工具 |
| C-001 | P0 | Authorization wrapper | `src/auth/authorization.ts`, `src/server.ts` | 工具执行前拒绝未授权调用 |
| C-002 | P0 | HTTP bearer 接入 | `src/transports/http.ts`, `src/core/http-config.ts` | 缺 token 401，无权限 403，有权限可调用 |
| D-001 | P1 | Auth 工具 | `src/tools/auth.ts` | `auth_whoami`、`auth_policy_validate` 可用 |
| D-002 | P1 | 错误码扩展 | `src/core/error-codes.ts`, `docs/ERRORS.md` | `AUTH_006`、`POLICY_001` 文档化 |
| E-001 | P1 | 文档和版本同步 | README、CONFIG、API、CHANGELOG、package | `npm run docs` 后工具数 91 |
| F-001 | P0 | 发布门禁 | build/test/typecheck/lint/coverage/pack/benchmark | 全部通过或有明确环境说明 |

---

## 三、接受风险

| 风险 | 接受理由 | 后续 |
|------|----------|------|
| `maskingMode` condition 仅校验合法性，未逐请求强制执行 | 当前脱敏配置是模块级全局状态，直接在授权 wrapper 中 set/reset 会引入并发串扰 | 已由 v2.0.1 通过请求上下文脱敏配置修复 |
| 审计仍以内存 buffer 为主 | v2.0 聚焦认证授权基线，持久化 sink 需要单独运维设计 | v2.2 可观测治理阶段实现 |
| RBAC resource 初版以 tool/connection 为主 | 表、collection、key prefix 细粒度策略需要更完整的资源提取模型 | v2.x 策略引擎扩展 |
| API key fallback 仍保留 | 方便 v1.8 HTTP 用户迁移和本地开发 | 文档标注不适合企业生产 |

---

## 四、完成定义

- 版本号为 `2.0.0`。
- HTTP bearer/RBAC 在源码、测试和 API 文档中可见。
- `sql_query` 仍在 MCP 层先执行 `isReadOnlyQuery` 后再调用 driver。
- 现有 readonly、SQL guard、NoSQL guard、Redis keyPrefix、Mongo allowlist 不被绕过。
- `npm run build` 后 `npm test` 通过。
- v2.0.0 分支 CI 通过后再合入 `main`。

---

## 五、完成记录

| 编号 | 状态 | 证据 |
|------|------|------|
| A-001 | 已完成 | `test/auth/token-verifier.test.mjs` 覆盖 valid/wrong issuer/wrong audience/expired token |
| A-002 | 已完成 | `auth_whoami` 和授权审计可读取 subject、tenant、roles、transport |
| B-001 | 已完成 | `test/auth/rbac.test.mjs` 覆盖 default deny、resource/action、maxRows |
| B-002 | 已完成 | `test/auth/tool-action-map.test.mjs` 自动扫描 `src/tools/*.ts` |
| C-001 | 已完成 | `installAuthorization` 包装 `registerTool`，拒绝时返回授权错误 |
| C-002 | 已完成 | `test/transports/http-auth.test.mjs` 覆盖 401/403/read allow/write deny |
| D-001 | 已完成 | `auth_whoami`、`auth_policy_validate` 已注册并进入 API 文档 |
| D-002 | 已完成 | `AUTH_006`、`POLICY_001` 已加入源码和错误码文档 |
| E-001 | 已完成 | README、README_en、CONFIG、ERRORS、API、CHANGELOG、`.env.example` 已同步 |
| F-001 | 已完成 | 本地发布门禁通过，详见 `docs/QUALITY-v2.0.0-质量报告.md` |
