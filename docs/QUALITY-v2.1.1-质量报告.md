# v2.1.1 质量报告：查询导出与表采样画像

**文档编号**: QUALITY-v2.1.1
**日期**: 2026-07-10
**状态**: 已完成
**关联 ITER**: `docs/ITER-v2.1.1-迭代计划.md`

---

## 一、结论

v2.1.1 新增 `sql_export_query` 和 `sql_sample_table`，延续 SQL 工具层只读保护、请求级脱敏和行数限制。完整发布门禁已通过，当前实现可以进入提交与远端 CI 验证。

## 二、质量门禁记录

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run build` | 通过 | TypeScript 编译通过 |
| `node --test --test-name-pattern=. test/tools/sql.test.mjs test/auth/tool-action-map.test.mjs` | 通过 | 44 tests |
| `npm test` | 通过 | 525 tests / 112 suites |
| `npm run typecheck` | 通过 | `tsc --noEmit` 通过 |
| `npm run lint` | 通过 | ESLint 通过 |
| `npm run format:check` | 通过 | Prettier 检查通过 |
| `npm run test:coverage:check` | 通过 | lines 67.29%, branches 71.84%, functions 72.67% |
| `npm pack --dry-run` | 通过 | `@yclenove/polyglot-db-mcp-server@2.1.1`，210 files |
| `npm run benchmark` | 通过 | SQL guard benchmark 通过，生成报告未纳入本次 diff |
| `docker compose config` | 通过 | Compose 配置可解析 |
| `npm audit --audit-level=moderate` | 通过 | 0 vulnerabilities |
| `git diff --check` | 通过 | 仅 Windows LF/CRLF 提示，无空白错误 |

## 三、安全复核

| 项目 | 结论 | 证据 |
|------|------|------|
| 导出只读保护 | 通过 | `sql_export_query` 执行前调用 `isReadOnlyQuery` |
| 导出脱敏 | 通过 | `maskResultRows` 用于导出前数据处理 |
| 采样注入边界 | 通过 | `validateIdent` 校验 table/schema，服务端生成 SQL |
| RBAC 映射 | 通过 | `tool-action-map` 覆盖新增工具 |
| 行数限制 | 通过 | `limit`/`sample_size` 最大 10000 |
| secrets 扫描 | 通过 | 命中仅为 placeholder/dev/test/doc 示例，无生产凭据 |

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| 导出只返回文本内容，不写本地文件 | P2 | 当前符合 MCP 工具安全边界，文件落盘留给后续 export plugin |
| 采样是轻量画像，不做深度数据质量规则 | P2 | v2.2 策略治理阶段继续扩展 |
