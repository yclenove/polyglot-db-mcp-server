# v2.1.0 PRD：DuckDB 本地只读分析

**文档编号**: PRD-v2.1.0
**日期**: 2026-07-10
**状态**: 已完成
**关联路线图**: `docs/ROADMAP.md` Phase 4

---

## 一、背景

项目已覆盖主流在线数据库和 SQLite。本迭代补齐 DuckDB，用于本地 CSV/Parquet/JSON 分析、轻量数据湖探索和离线数据检查，同时继续保持 MCP 工具层的只读安全边界。

## 二、目标

| 优先级 | 目标 | 验收标准 |
|--------|------|----------|
| P0 | 新增 `duckdb` 引擎 | `DB_MCP_CONNECTIONS` 可配置 DuckDB，registry 可创建 driver 并 ping |
| P0 | 默认只读 | 未显式设置 `readonly:false` 时，DuckDB 写操作被拒绝 |
| P0 | SQL 工具兼容 | `sql_query`、`sql_execute`、表列表、表描述、EXPLAIN、schema_export 支持 DuckDB |
| P1 | 本地文件安全 | CSV/Parquet/JSON 等外部文件读取必须落在 `allowlist` 内 |
| P1 | 配置和诊断 | CLI、README、CONFIG、`.env.example`、`connection_diagnose` 提供 DuckDB 说明 |

## 三、非目标

- 不在 v2.1.0 实现专用 DuckDB 工具集，先复用 SQL 工具体系。
- 不实现查询结果导出、采样分析和数据质量报告，这些进入 v2.1.x 或 v2.2。
- 不开放任意本地文件读取，也不默认把仓库根目录加入 allowlist。

## 四、用户故事

| 用户 | 需求 | 结果 |
|------|------|------|
| 本地数据分析用户 | 想用 MCP 查询本地 CSV/Parquet | 配置 DuckDB `allowlist` 后可通过 `sql_query` 只读查询 |
| 企业安全维护者 | 想确保工具不会读任意文件 | 未配置或越界文件路径会被 DuckDB 权限拒绝 |
| 自动化代理 | 想用统一 SQL 工具探索 DuckDB schema | 继续调用现有 SQL 工具，无需新工具名 |

## 五、安全要求

1. `sql_query` 必须继续在 MCP 工具层执行 `isReadOnlyQuery`。
2. DuckDB driver 必须在 driver 层再次执行 readonly 检查。
3. DuckDB 外部文件访问默认关闭，只允许 `allowlist` 中的文件或目录。
4. `readonly:false` 必须由用户显式配置，不能由默认值或缺省路径推导。
5. 文档示例不得包含真实凭证或生产路径。

## 六、发布要求

- `npm run build`、`npm test`、`npm run typecheck`、`npm run lint` 通过。
- 新增 DuckDB driver 和配置测试。
- README、README_en、CONFIG、CHANGELOG、`.env.example` 同步。
- `npm pack --dry-run` 包含编译后的 DuckDB driver。
