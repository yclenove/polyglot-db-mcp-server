# v2.1.0 迭代计划：DuckDB 本地分析引擎

**文档编号**: ITER-v2.1.0
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD**: `docs/PRD-v2.1.0.md`

---

## 一、迭代范围

v2.1.0 聚焦 DuckDB P0 能力：新增引擎、默认只读、文件 allowlist、SQL 工具兼容、配置诊断和确定性测试。

## 二、任务拆分

| 优先级 | 任务 | 状态 | 交付物 |
|--------|------|------|--------|
| P0 | 引擎类型和配置解析支持 `duckdb` | 已完成 | `src/core/types.ts`, `src/core/config.ts` |
| P0 | 新增 DuckDB SQL driver | 已完成 | `src/drivers/sql/duckdb-driver.ts` |
| P0 | driver 注册到 bootstrap | 已完成 | `src/bootstrap.ts` |
| P0 | SQL helper 和 schema 工具适配 DuckDB | 已完成 | `src/core/sql-helpers.ts`, `src/tools/schema.ts`, `src/tools/sql.ts` |
| P0 | 默认只读和显式写入开关 | 已完成 | config/driver 双层保护 |
| P1 | 外部文件 allowlist | 已完成 | DuckDB `allowed_directories`/`allowed_paths` |
| P1 | CLI 和诊断提示 | 已完成 | `src/cli.ts`, `src/tools/connections.ts` |
| P1 | 单元测试和工具测试 | 已完成 | `test/drivers/duckdb-driver.test.mjs`, config/connections 测试 |
| P1 | 文档和发布记录 | 已完成 | README、CONFIG、CHANGELOG、PRD/ITER/QUALITY |

## 三、实现备注

- DuckDB 使用 `@duckdb/node-api`，避免依赖已废弃的旧 `duckdb` npm 包。
- `:memory:` 数据库不能使用 DuckDB 的 `access_mode=READ_ONLY`，因此 driver 仍在执行前强制 readonly。
- 外部文件访问先配置 allowlist，再设置 `enable_external_access=false`，让 DuckDB 原生权限检查拦截越界访问。
- `allowlist` 中已存在且是文件的路径进入 `allowed_paths`，其他路径按目录进入 `allowed_directories`。

## 四、验收清单

- [x] DuckDB 可创建内存连接并执行 `SELECT`。
- [x] 默认 `readonly:true` 时写操作被拒绝。
- [x] 显式 `readonly:false` 时写入可用。
- [x] `maxRows` 截断结果。
- [x] allowlist 内 CSV 可读取。
- [x] allowlist 外文件被拒绝。
- [x] `connection_diagnose` 提供 DuckDB memory 和 allowlist hint。
- [x] 文档和版本号同步到 v2.1.0。

## 五、后续输入

- v2.1.x：查询结果导出 CSV/JSON/Markdown。
- v2.1.x：更明确的本地文件数据源配置体验。
- v2.2.0：将 DuckDB 查询指标纳入 Prometheus/OTel。
