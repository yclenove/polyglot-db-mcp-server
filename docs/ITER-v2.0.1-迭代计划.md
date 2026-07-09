# v2.0.1 迭代计划：Policy Masking 安全收口

**文档编号**: ITER-v2.0.1
**版本**: 1.0
**日期**: 2026-07-10
**目标版本**: v2.0.1
**迭代类型**: Patch / Security Hardening
**状态**: 已完成
**上游依据**: `docs/ITER-v2.0.0-迭代计划.md`、`docs/QUALITY-v2.0.0-质量报告.md`、`docs/ADR-002-oauth-rbac.md`

---

## 一、迭代目标

v2.0.1 聚焦 v2.0.0 已接受风险中的 `maskingMode` condition 执行闭环：

1. 授权命中的 policy conditions 必须在工具 handler 执行期间可读取。
2. `maskingMode` 只能提高当前请求的脱敏强度，不能降低全局 `DB_MASKING_MODE`。
3. 不通过全局 `setMaskingConfig` 注入请求策略，避免并发请求串扰。
4. SQL/Mongo 只读结果返回前按请求 policy 脱敏，现有只读、allowlist、NoSQL guard 不变。
5. 补齐测试、版本、CHANGELOG、ROADMAP、CONFIG 和质量报告。

---

## 二、任务分解

| 编号 | 优先级 | 任务 | 文件 | 验收 |
|------|--------|------|------|------|
| A-001 | P0 | 请求级 policy context | `src/auth/request-policy.ts`, `src/auth/authorization.ts` | 授权通过后 handler 内可读取 conditions，执行后自动清理 |
| A-002 | P0 | RBAC decision 携带 conditions | `src/auth/rbac.ts` | allow 和 condition deny 决策保留命中规则条件 |
| B-001 | P0 | SQL 返回脱敏 | `src/tools/sql.ts`, `src/tools/result-masking.ts` | `sql_query` 普通路径和缓存路径均按请求 policy 脱敏 |
| B-002 | P0 | Mongo 返回脱敏 | `src/tools/mongo.ts` | `mongo_find`、`mongo_aggregate` 结果按请求 policy 脱敏 |
| C-001 | P1 | 回归测试 | `test/auth/*`, `test/tools/*` | 覆盖 context、SQL、Mongo policy masking |
| D-001 | P1 | 文档和版本同步 | package、CHANGELOG、docs | 说明 v2.0.1 修复范围和剩余边界 |
| E-001 | P0 | 发布门禁 | build/test/typecheck/lint/format/coverage/pack/benchmark | 全部通过或有明确环境说明 |

---

## 三、非目标

| 范围 | 说明 | 后续 |
|------|------|------|
| 表/集合/key prefix 级完整 ABAC | v2.0.1 只执行已有 `maskingMode` condition，不新增资源抽取模型 | v2.x policy engine 扩展 |
| 审计持久化 sink | 本补丁只补齐请求级脱敏执行 | v2.2 可观测治理 |
| 动态 policy hot reload | 静态 policy loader 保持不变 | v2.x 评估 |

---

## 四、完成定义

- 版本号为 `2.0.1`。
- `maskingMode` policy condition 可在请求上下文内执行，不依赖全局 mutable state。
- SQL/Mongo read rows 在返回给 MCP client 前应用有效脱敏配置。
- `sql_query` 仍在 MCP 层先执行 `isReadOnlyQuery` 后再调用 driver。
- `npm run build` 后 `npm test` 通过，完整 CI gate 通过后推送分支。

---

## 五、完成记录

| 编号 | 状态 | 证据 |
|------|------|------|
| A-001 | 已完成 | `runWithRequestPolicy` 使用 `AsyncLocalStorage`，`authorization.test.mjs` 验证 handler 内可见、执行后清理 |
| A-002 | 已完成 | `authorizeWithPolicy` 在命中规则决策中返回 `conditions` |
| B-001 | 已完成 | `sql_query` 普通路径和 cache hit 路径调用 `withMaskedDataRows` |
| B-002 | 已完成 | `mongo_find`、`mongo_aggregate` 调用 `maskResultRows` |
| C-001 | 已完成 | 新增 SQL/Mongo/request policy masking 回归测试 |
| D-001 | 已完成 | 本文档、CHANGELOG、CONFIG、ROADMAP、INDEX 已更新 |
| E-001 | 已完成 | 详见 `docs/QUALITY-v2.0.1-质量报告.md` |
