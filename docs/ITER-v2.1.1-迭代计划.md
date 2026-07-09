# v2.1.1 迭代计划：查询导出与表采样画像

**文档编号**: ITER-v2.1.1
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD**: `docs/PRD-v2.1.0.md`

---

## 一、迭代范围

v2.1.1 继续补强 Phase 4 分析生态，在 DuckDB P0 已完成的基础上，新增通用 SQL 只读查询导出和 SQL 表采样画像能力。

## 二、任务拆分

| 优先级 | 任务 | 状态 | 交付物 |
|--------|------|------|--------|
| P1 | 查询结果导出 | 已完成 | `sql_export_query` 支持 JSON/CSV/Markdown |
| P1 | 导出安全边界 | 已完成 | 只读 SQL 检查、脱敏、最大 10000 行 |
| P2 | 表采样画像 | 已完成 | `sql_sample_table` 返回字段类型、空值率、唯一值、示例和数值范围 |
| P2 | 工具授权映射 | 已完成 | `sql_export_query=export`, `sql_sample_table=read` |
| P2 | API/README/CHANGELOG 同步 | 已完成 | 文档和生成脚本更新 |

## 三、安全边界

- `sql_export_query` 执行前强制 `isReadOnlyQuery`，不允许写 SQL。
- 导出内容先经过 `maskResultRows`，包含全局脱敏和请求级 policy `maskingMode`。
- `sql_sample_table` 不接收任意 SQL，只接收合法 `table` 和 `schema` 标识符，由服务端生成采样 SQL。
- 导出和采样行数最大 10000，默认沿用 `DB_MAX_ROWS`。

## 四、验收清单

- [x] `sql_export_query` 注册并进入工具授权映射。
- [x] JSON 导出在请求级 `strict-v2` policy 下脱敏。
- [x] CSV 导出正确处理逗号和引号。
- [x] 写 SQL 导出被拒绝且不触发 driver 执行。
- [x] `sql_sample_table` 返回字段画像。
- [x] 非法表名在执行前被拒绝。

## 五、后续输入

- v2.2.0：将导出/采样调用纳入 Prometheus/OTel 指标。
- v2.2.0：补充审计持久化和 policy 模板。
