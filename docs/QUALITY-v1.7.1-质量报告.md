# v1.7.1 质量报告：质量基线与安全收敛

**文档编号**: QUALITY-v1.7.1
**版本**: 1.0
**日期**: 2026-07-09
**状态**: 已完成
**关联迭代**: `docs/ITER-v1.7.1-迭代计划.md`
**审查范围**: v1.7.1 质量补丁的代码、测试、文档和发布门禁

---

## 一、审查结论

v1.7.1 的定位是 patch 级质量补丁。本次迭代未引入新的大型业务能力，重点完成核心测试补齐、长运行稳定性修复、缓存键安全收敛、MSSQL EXPLAIN 风险降级和 lint 清理。

| 结论项 | 状态 | 证据 |
|--------|------|------|
| 是否允许发布 | 允许 | build/test/typecheck/lint/coverage/pack dry-run 均通过 |
| P0/P1 是否完成 | 通过 | QueryCache、RateLimiter、SQL helpers、Version、Registry、MSSQL EXPLAIN 均有代码和测试覆盖 |
| 安全边界是否保持 | 通过 | `sql_query` 仍先执行 `isReadOnlyQuery`，MSSQL EXPLAIN 不再拼多语句批处理 |
| 测试是否通过 | 通过 | `npm test`: 455 passed / 0 failed |
| 文档是否同步 | 通过 | `CHANGELOG.md`、本报告和迭代文档已同步 |

---

## 二、v1.7.0 遗留问题复核

| 编号 | v1.7.0 问题 | v1.7.1 状态 | 证据 |
|------|-------------|-------------|------|
| H-1 | package version 未更新 | 已修复 | `package.json`、`package-lock.json` 升至 `1.7.1`，`test/version.test.mjs` 通过 |
| H-2 | `sql_call_procedure` procedure 注入风险 | 已修复并补测试 | `validateIdent(procedure, 'procedure')`，`sql_call_procedure rejects invalid procedure identifier` |
| M-1 | 核心模块缺少独立测试 | 已补齐 | `test/query-cache.test.mjs`、`test/rate-limiter.test.mjs`、`test/sql-helpers.test.mjs`、`test/version.test.mjs`、`test/registry.test.mjs` |
| M-2 | RateLimiter bucket 不清理 | 已修复 | `cleanup()`、`dispose()`、`idleTtlMs`、`cleanupIntervalMs`、可注入 `now` |
| M-3 | MSSQL EXPLAIN 单批语义风险 | 已降级 | `explainQuerySql('mssql', ...)` 抛出明确错误，不再生成 `SHOWPLAN` 批处理 |
| M-4 | cacheKey 序列化边界风险 | 已修复 | 类型标记稳定序列化，特殊值和循环引用测试通过 |
| M-5 | 分页数字拼接 | 接受风险 | `page`、`page_size` 由 Zod `number.int()` 约束，后续评估驱动参数化 |
| L-1 | Oracle 表名大小写限制 | 转后续版本 | 当前 helper 保持 `toUpperCase()` 行为并有测试感知 |
| L-2 | query_suggest 简单正则局限 | 转 v1.9 | 不属于本 patch 范围 |
| L-3 | version fallback 未测试 | 已覆盖主路径 | `test/version.test.mjs` 覆盖 package version 和缓存稳定性 |

---

## 三、质量门禁结果

| 命令 | 结果 | 关键输出/备注 |
|------|------|----------------|
| `npm run build` | 通过 | `tsc` 通过 |
| `npm run typecheck` | 通过 | `tsc --noEmit` 通过 |
| `npm run lint` | 通过 | 0 error / 0 warning |
| `npm test` | 通过 | 455 tests / 99 suites / 0 failed |
| `npm run test:coverage:check` | 通过 | All files lines 65.73%，branches 74.71%，functions 66.03%，高于 50% 门禁 |
| `npm pack --dry-run` | 通过 | dry-run 成功，包内容包含 `dist`、README、CHANGELOG、LICENSE 等 |
| `git diff --check` | 通过 | 仅 Windows 行尾提示，无 trailing whitespace 错误 |

---

## 四、测试覆盖复核

| 模块 | 测试文件 | 状态 | 覆盖场景 |
|------|----------|------|----------|
| QueryCache | `test/query-cache.test.mjs` | 通过 | disabled、hit/miss、LRU、TTL、clear、特殊 cache key、循环引用 |
| RateLimiter | `test/rate-limiter.test.mjs` | 通过 | token 消耗、独立 key、refill、inactive cleanup、dispose |
| SQL helpers | `test/sql-helpers.test.mjs` | 通过 | 多引擎 SQL、非法 identifier、`explainQuerySql`、MSSQL 降级 |
| Version | `test/version.test.mjs` | 通过 | 与 package version 一致、缓存稳定 |
| Registry metrics | `test/registry.test.mjs` | 通过 | success/failure metrics、未知 ID 不污染 |
| SQL tool security | `test/tools/sql.test.mjs` | 通过 | readonly、MSSQL EXPLAIN 降级、procedure identifier 校验 |

---

## 五、安全与兼容性复核

| 项目 | 状态 | 说明 |
|------|------|------|
| `sql_query` MCP 层只读检查 | 通过 | `isReadOnlyQuery(finalSql)` 仍在 `execute` 前执行 |
| MSSQL EXPLAIN | 通过 | patch 版本保守降级，避免可能污染会话的 `SHOWPLAN` 单批语句 |
| SQL procedure identifier | 通过 | 非法 procedure 名称在 driver execute 前被拒绝 |
| Redis keyPrefix / Mongo NoSQL 注入 | 未改变 | 本迭代未改相关路径，既有测试通过 |
| 配置兼容性 | 通过 | 未新增必填配置，`DB_MCP_CONNECTIONS` 格式不变 |
| 工具兼容性 | 通过 | 未删除或重命名工具；MSSQL EXPLAIN 返回明确错误属于风险降级 |
| 凭证提交风险 | 通过 | 未新增 `.env` 或真实连接串；文档仅包含示例占位 |

---

## 六、接受风险

| 风险 | 接受理由 | 后续跟踪 |
|------|----------|----------|
| MSSQL EXPLAIN 暂不支持 | 无真实 SQL Server 会话验证前，不实现三次 execute 以免污染连接状态 | v1.8 或后续集成测试环境中重新评估 |
| 分页 LIMIT/OFFSET 数字拼接 | 输入由 Zod 整数约束，短期安全风险可控 | 后续驱动参数化评估 |
| Oracle quoted identifier 大小写 | 保持 v1.7.0 行为，避免 patch 版本兼容性波动 | v1.9 schema helper 改进 |
| query_suggest 表名提取仍为简单正则 | 本迭代聚焦质量基线，不引入 SQL parser | v1.9 查询分析升级 |

---

## 七、最终签核

| 项目 | 结果 | 备注 |
|------|------|------|
| P0/P1 完成 | 通过 | 核心任务已完成 |
| 测试命令 | 通过 | build/typecheck/lint/test/coverage 均通过 |
| 安全复核 | 通过 | 只读边界和 EXPLAIN 风险已复核 |
| 兼容性复核 | 通过 | patch 级改动，配置和工具名兼容 |
| 文档同步 | 通过 | CHANGELOG 与质量报告已更新 |
| 允许发布 | 是 | 可发布 v1.7.1 |
