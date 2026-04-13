# 更新日志

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-04-14

### 新增

- 多引擎数据库 MCP 服务：在同一进程内通过 `DB_MCP_CONNECTIONS` 配置 MySQL、PostgreSQL、SQL Server、Oracle、MongoDB、Redis。
- 连接类工具：`list_connections`、`test_connection`。
- SQL 工具：`sql_query`（只读）、`sql_execute`、`sql_list_tables`、`sql_describe_table`。
- MongoDB / Redis 工具集（含 key 前缀与危险命令相关约束）。
- GitHub Actions CI（Node 24：`npm ci`、`typecheck`、`build`、`test`）。
- 文档：`README.md`（简体中文）、`README_en.md`（英文）、本 `CHANGELOG.md`；迁移说明见 `MIGRATION.md`。

### 变更

- **多连接**：启动时并行建立各连接、并行执行 `pingAll`；`closeAll` 使用 `Promise.allSettled`，单个连接关闭失败不阻塞其余连接释放。
- **`connection_id` 解析**：显式传入非空且 trim 后的 id 若不在配置中则报错，**不再静默回退**到默认连接；省略或空/仅空白仍使用默认连接。
- **启动行为**：默认连接 ping 失败仍退出码 `1`；非默认连接 ping 失败时向 stderr 输出告警日志。

### 优化

- 抽取 `src/core/handle-runtime.ts` 统一 `ping` / `close` 调用，减少 `bootstrap` 与 `test_connection` 中的重复分支。
