# v3.0.0 质量报告：Manifest-first 插件化生态

**文档编号**: QUALITY-v3.0.0
**日期**: 2026-07-10
**状态**: 已完成
**关联 ITER**: `docs/ITER-v3.0.0-迭代计划.md`

---

## 一、结论

v3.0.0 完成 manifest-first 插件化生态 MVP：本地插件 discovery、manifest 校验、Driver/Tool/Policy/Export 插件扩展点、插件治理工具和安全摘要均已实现。本轮完整质量门禁已通过。

## 二、质量门禁记录

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run build` | 通过 | TypeScript 编译通过 |
| `node --test --test-name-pattern=. test/plugins.test.mjs test/tools/plugins.test.mjs test/auth/tool-action-map.test.mjs` | 通过 | 覆盖插件 parser、discovery、driver/tool/policy/export 和 action map |
| `npm run docs` | 通过 | API 文档已生成，工具总数 97 |
| `npm test` | 通过 | 575 tests |
| `npm run typecheck` | 通过 | `tsc --noEmit` 通过 |
| `npm run lint` | 通过 | ESLint 无 error |
| `npm run format:check` | 通过 | 当前新增 TS 文件格式检查通过 |
| `npm audit --audit-level=moderate` | 通过 | found 0 vulnerabilities |
| `git diff --check` | 通过 | 无 whitespace error；仅 Windows CRLF 提示 |

## 三、安全复核

| 项目 | 结论 | 证据 |
|------|------|------|
| 默认关闭 | 通过 | `parsePluginDiscoveryConfig({})` 返回空 paths |
| 治理校验不执行插件入口 | 通过 | `plugin_validate_manifest` 和 discovery 测试中的 main 文件 `throw` 未被触发 |
| main 路径约束 | 通过 | 测试覆盖 `../outside.js` 拒绝 |
| 安全摘要 | 通过 | 测试验证摘要不包含本地插件目录 |
| 授权分类 | 通过 | `plugin_list` 和 `plugin_validate_manifest` 均为 diagnose |

## 四、未完成项

| 项目 | 级别 | 下一步 |
|------|------|--------|
| 插件依赖隔离 | P1 | 后续可评估 worker thread 或进程隔离 |
| Metric export event | P2 | 当前 Export Plugin 先接入 audit event |
| 插件市场 | P2 | ADR 明确首版不做市场 |

## 五、2026-07-16 增量全功能审计

本轮针对结果字节上限、数据库操作完整性和生产镜像执行了增量全功能回归。结论为通过；所有已注册数据库工具均至少在一个适用的真实引擎上执行，SQL 通用工具在六个 SQL 引擎上逐一验证。

### 5.1 最终门禁

| 项目 | 结果 | 证据 |
|------|------|------|
| TypeScript 构建 | 通过 | `npm run build` |
| 全量测试 | 通过 | 659/659，0 fail、0 skip |
| 覆盖率门禁 | 通过 | statements/lines 73.17%，branches 75.91%，functions 81.11% |
| 类型、Lint、格式 | 通过 | `npm run typecheck`、`npm run lint`、`npm run format:check` |
| 原生集成测试 | 通过 | MySQL、PostgreSQL、MongoDB、Redis，39/39 |
| 真实数据库矩阵 | 通过 | 8 engines，73/73 registered database tools exercised |
| 生产镜像 | 通过 | Docker build；HTTP 与 stdio 均列出 97 tools 并完成真实调用 |
| 依赖审计 | 通过 | moderate 及以上漏洞 0，总漏洞 0 |
| npm 包检查 | 通过 | 233573 bytes，解包 1206867 bytes，250 entries |
| 静态发布检查 | 通过 | `git diff --check`、脚本语法、Compose 配置 |

### 5.2 数据库操作证据

| 范围 | 验证内容 |
|------|----------|
| DDL | 六个 SQL 引擎真实创建表和视图；适用引擎创建/调用过程；JSON/SQL schema 导出包含新表 DDL |
| DDL 防护 | `ALTER TABLE`、`TRUNCATE TABLE`、`DROP TABLE` 均被 MCP 安全策略拒绝，拒绝后回查确认原表和数据仍存在 |
| 索引 | 六个 SQL 引擎创建复合唯一索引并从系统目录反查名称和列；MongoDB 创建唯一稀疏复合索引并反查 |
| SQL 分析 | MySQL、PostgreSQL、Oracle、SQLite、DuckDB 返回真实 `EXPLAIN`；SQL Server 返回文档化的不支持错误 |
| 优化建议 | 六个 SQL 引擎执行 `query_suggest`/`query_optimize`，验证 schema、索引元数据和执行计划；已有索引不再被误报缺失 |
| 数据与事务 | 参数查询、分页、增删改、batch、commit/rollback、过程调用、导出、采样和类型生成 |
| MongoDB | CRUD、聚合、索引、schema analysis、rename/drop、事务 commit/rollback、危险聚合阶段拦截 |
| Redis | String、Hash、List、Set、Sorted Set、TTL、SCAN、pipeline 和危险命令拦截 |
| 响应上限 | SQL 六驱动、Mongo 游标和 Redis 2 MiB 值均验证字节截断；普通连接与事务截断后可复用 |

### 5.3 生产协议验收

- HTTP MCP：通过 SDK 执行建表、batch insert、复合唯一索引、索引反查、`query_suggest`、`query_optimize`、`sql_explain`、DDL 导出和危险 DDL 拦截。
- stdio MCP：通过 SDK 执行建表、建索引、索引反查和索引感知建议。
- 两种传输均从生产镜像列出 97 个工具。
- HTTP 动态端口连续执行 15 轮 SDK 回归，未再出现 Fetch `bad port`。

### 5.4 边界说明

- “73/73”表示所有已注册数据库工具均被真实调用，不表示覆盖每个数据库版本、所有参数排列或所有 SQL 方言语句。
- SQL Server 的安全 `EXPLAIN` 批处理当前明确不支持，测试要求返回稳定错误；其余五个 SQL 引擎验证真实执行计划。
- 危险 DDL 是产品安全边界，目标是稳定拒绝而不是成功执行；允许的建表、建视图、建索引和过程 DDL 已真实执行。

## 六、2026-07-18 Redis 大 key 增量审计

本轮在 5.x 全功能矩阵基础上补齐 Redis 大字符串与集合的物化边界，并重新执行发布入口验收。

| 项目 | 结果 | 证据 |
|------|------|------|
| 构建与静态门禁 | 通过 | `npm run build`、`npm run typecheck`、`npm run lint`、`npm run format:check` |
| 全量自动化 | 通过 | 678/678，0 fail、0 skip |
| 覆盖率 | 通过 | statements/lines 73.28%，branches 76.53%，functions 79.92% |
| Redis 真实集成 | 通过 | 13/13；String/Hash/List/Set/ZSet、SCAN、pipeline、TTL 与大 key 边界 |
| 容器集成 | 通过 | MySQL、PostgreSQL、MongoDB、Redis，43/43，0 skip |
| 真实数据库矩阵 | 通过 | 8 engines；76/76 个已注册数据库工具至少在一个适用真实引擎执行 |
| 生产传输 | 通过 | stdio、Streamable HTTP 均列出 100 tools，并真实执行 Redis 字节续读 |
| 发布包安装 | 通过 | npm tarball 安装 250 packages；从安装目录启动并完成 MCP SDK 调用 |

Redis 专项边界：

- `redis_get` 使用 `STRLEN`/`GETRANGE`，按原始字节返回 `next_offset_bytes`；窗口切开 UTF-8 字符或包含二进制时使用 `value_encoding=base64` 与 `value_base64`，可逐窗口无损重组。
- 转义密集值会在工具层继续收紧实际字节窗口；4 KiB 配置下 stdio/HTTP 实际结果均为 4091 bytes，未被协议层替换为通用截断响应。
- `HGETALL`、`SMEMBERS`、`LRANGE`、`ZRANGE` 受 `DB_MAX_ROWS` 约束；大 Hash/Set/ZSet 使用 `HSCAN`、`SSCAN`、`ZSCAN` 续读；pipeline 禁止集合物化命令。
- “76/76”仍表示工具级真实执行覆盖，不代表穷举所有 Redis 编码、数据库版本、并发时序和参数排列。
