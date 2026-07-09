# v2.1.0 质量报告：DuckDB 本地只读分析

**文档编号**: QUALITY-v2.1.0
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD/ITER**: `docs/PRD-v2.1.0.md`, `docs/ITER-v2.1.0-迭代计划.md`

---

## 一、结论

v2.1.0 新增 DuckDB 引擎，默认只读并通过 allowlist 限制本地外部文件读取。构建、测试、类型检查、lint、coverage、包产物、benchmark、audit 和 Docker Compose 配置检查均已通过。

## 二、质量门禁记录

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run build` | 通过 | TypeScript 编译通过 |
| `npm test` | 通过 | 518 tests / 112 suites |
| `npm run typecheck` | 通过 | `tsc --noEmit` 通过 |
| `npm run lint` | 通过 | `eslint src/` 通过 |
| `npx prettier --check <changed ts files>` | 通过 | 本次改动 TS 文件均符合 Prettier |
| `npm run test:coverage:check` | 通过 | All files: lines 66.66%, branches 72.11%, functions 71.9% |
| `npm pack --dry-run` | 通过 | `@yclenove/polyglot-db-mcp-server@2.1.0`，210 files，包含 `dist/drivers/sql/duckdb-driver.*` |
| `npm run benchmark` | 通过 | SQL guard benchmark 通过；生成报告已恢复，避免性能噪音入库 |
| `docker compose config` | 通过 | Compose 配置可解析 |
| `npm audit --audit-level=moderate` | 通过 | 0 vulnerabilities |
| `git diff --check` | 通过 | 仅 Windows LF/CRLF 提示，无 whitespace error |
| secrets scan | 通过 | 命中均为占位符、本地 dev Compose 密码、测试样例或文档术语，无生产凭证 |

## 三、安全复核

| 项目 | 结论 | 证据 |
|------|------|------|
| MCP 层只读保护 | 通过 | `sql_query` 仍调用 `isReadOnlyQuery` 后才执行 |
| driver 层 readonly | 通过 | DuckDB driver 默认拒绝写操作 |
| 外部文件访问 | 通过 | allowlist 外 CSV 读取测试被拒绝 |
| 配置默认值 | 通过 | `parseConnectionSpecs` 对 DuckDB 默认 `readonly:true` |
| 凭证安全 | 通过 | 文档仅使用占位符和本地相对路径 |

## 四、测试覆盖

新增覆盖：

- DuckDB driver factory、SELECT、默认只读、显式写入、maxRows。
- DuckDB allowlist 内文件读取和 allowlist 外访问拒绝。
- config 解析 DuckDB 默认只读。
- `connection_diagnose` DuckDB memory 和 allowlist hint。
- DuckDB 元数据 smoke：表列表、表描述、索引列表、EXPLAIN、schema 查询实跑通过。

## 五、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| DuckDB 专用导出和采样能力未实现 | P2 | 已移入 v2.1.x 后续 |
| 真实大文件和 Parquet 场景未做集成测试 | P2 | 当前只做确定性本地 CSV 单测，后续增加可选集成测试 |
| Windows 本地全量 `format:check` 可能受既有 CRLF 文件影响 | P2 | CI 在 Linux 上已对 main 通过，本次改动文件 targeted Prettier 已通过 |

## 六、发布建议

分支 CI 通过后再快进 `main`。若 GitHub Actions 失败，优先检查 Node 24 下 `@duckdb/node-api` 平台二进制安装和 `format:check` 输出。
