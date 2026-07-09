# v1.9.0 迭代计划：高级数据库工作流

**文档编号**: ITER-v1.9.0
**版本**: 1.0
**日期**: 2026-07-10
**目标版本**: v1.9.0
**迭代类型**: Minor / Advanced Database Workflows
**状态**: 已完成
**上游依据**: `docs/PRD-v1.9.0.md`、`docs/ROADMAP.md`

---

## 一、迭代目标

v1.9.0 完成三个面向工作流的 P0 能力：

1. SQL `schema_diff`，用于只读比较结构差异。
2. MongoDB 多文档事务，提供 begin/execute/commit/rollback 生命周期。
3. Redis pipeline，提供安全命令子集的批处理入口。

---

## 二、任务分解

| 编号 | 优先级 | 任务 | 文件 | 验收 |
|------|--------|------|------|------|
| A-001 | P0 | Schema diff 工具 | `src/tools/schema.ts` | `test/schema.test.mjs` 覆盖 added/removed/changed |
| A-002 | P1 | Schema export 支持 schema 参数 | `src/tools/schema.ts` | PostgreSQL schema 参数测试 |
| B-001 | P0 | Redis pipeline 类型与 driver | `src/core/types.ts`, `src/drivers/redis/redis-driver.ts` | build 通过，工具测试覆盖 |
| B-002 | P0 | Redis pipeline 工具 | `src/tools/redis.ts` | 阻断命令、readonly 错误映射测试 |
| C-001 | P0 | Mongo 事务接口与 driver | `src/core/types.ts`, `src/drivers/mongo/mongo-driver.ts` | begin/execute/commit/rollback 可编译 |
| C-002 | P0 | Mongo 事务工具 | `src/tools/mongo.ts` | 事务流、readonly、NoSQL 注入测试 |
| D-001 | P1 | 错误码补充 | `src/core/error-codes.ts`, `docs/ERRORS.md` | `MONGO_005` 文档化 |
| D-002 | P1 | 文档与版本同步 | README、API、CONFIG、CHANGELOG、package | `npm run docs` 后 API 更新 |
| E-001 | P0 | 发布门禁 | build/test/lint/typecheck/coverage/pack | 全部通过 |

---

## 三、接受风险

| 风险 | 接受理由 | 后续 |
|------|----------|------|
| `schema_diff` 不生成 migration SQL | 自动迁移风险高，本版本只输出可审查差异 | v2.x 审批/回滚设计后再做 |
| Redis pipeline 仅支持安全子集 | 保持可验证边界，避免任意命令通道 | 根据需求逐步扩展 |
| Mongo 事务 execute 一次执行一个操作 | 简化错误定位和审计 | 后续可增加批量 operation 输入 |

---

## 四、完成定义

- 版本号为 `1.9.0`。
- 新工具在源码、测试和 API 文档中可见。
- 安全边界测试覆盖 readonly、NoSQL 注入、Redis blocked command。
- `npm run build` 后 `npm test` 通过。
- CI 在 `codex/v1.9-advanced-db-workflows` 和 `main` 上通过后关闭版本。

---

## 五、完成记录

| 编号 | 状态 | 证据 |
|------|------|------|
| A-001 | 已完成 | `schema_diff` 已实现，`test/schema.test.mjs` 覆盖表/列差异 |
| A-002 | 已完成 | `schema_export` 支持 `schema` 参数并有测试 |
| B-001 | 已完成 | Redis driver pipeline 类型和实现已编译通过 |
| B-002 | 已完成 | `redis_pipeline` 工具已覆盖安全子集、阻断命令、readonly |
| C-001 | 已完成 | Mongo driver 支持 session transaction 生命周期 |
| C-002 | 已完成 | Mongo 事务工具覆盖 begin/execute/commit/rollback 与错误边界 |
| D-001 | 已完成 | `MONGO_005` 已加入源码和错误码文档 |
| D-002 | 已完成 | README/API/CONFIG/CHANGELOG/package 已同步到 v1.9.0 |
| E-001 | 已完成 | 本地发布门禁通过，详见 `docs/QUALITY-v1.9.0-质量报告.md` |
