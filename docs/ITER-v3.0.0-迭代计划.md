# v3.0.0 迭代计划：Manifest-first 插件化生态

**文档编号**: ITER-v3.0.0
**日期**: 2026-07-10
**状态**: 已完成
**关联 PRD**: `docs/PRD-v3.0.0.md`

---

## 一、目标

推进 v3.0.0 插件化生态：先完成 manifest-first 的本地插件发现、校验和诊断工具，保持默认不执行第三方代码；再继续接入 driver/tool/policy/export 注册扩展点。

## 二、任务拆分

| ID | 优先级 | 任务 | 范围 | 状态 |
|----|--------|------|------|------|
| PLUG-001 | P0 | 插件 manifest parser 和 schema 校验 | `src/core/plugins.ts` | 已完成 |
| PLUG-002 | P0 | `DB_PLUGIN_PATHS` 本地插件发现 | `src/core/plugins.ts`, `.env.example` | 已完成 |
| PLUG-003 | P0 | main 路径逃逸和目录缺失 fail-fast | `src/core/plugins.ts` | 已完成 |
| PLUG-004 | P1 | 启动诊断和 `server_info` 插件安全摘要 | `src/bootstrap.ts`, `src/tools/connections.ts` | 已完成 |
| PLUG-005 | P1 | 插件治理 MCP 工具 | `src/tools/plugins.ts`, `src/server.ts`, `src/core/tool-action-map.ts` | 已完成 |
| PLUG-006 | P1 | 插件 parser、discovery、tools 测试 | `test/plugins.test.mjs`, `test/tools/plugins.test.mjs` | 已完成 |
| PLUG-007 | P1 | 文档同步 | README、CONFIG、API、ROADMAP、CHANGELOG | 已完成 |
| PLUG-008 | P0 | Driver Plugin 注册接口 | `src/core/plugins.ts`, `src/bootstrap.ts` | 已完成 |
| PLUG-009 | P0 | Tool Plugin 安全 wrapper 注册 | `src/server.ts`, `src/auth/authorization.ts` | 已完成 |
| PLUG-010 | P1 | Policy/Export Plugin 扩展点 | auth/audit/observability | 已完成 |

## 三、当前验收标准

- `DB_PLUGIN_PATHS` 默认空值，不改变现有启动行为。
- 合法 `plugin.json` 可被解析和发现。
- `main` 不能是绝对路径、URL 或跳出插件目录。
- `plugin_validate_manifest` 不执行插件入口；运行时只加载 `DB_PLUGIN_PATHS` 显式配置的本地插件。
- 插件工具进入 `TOOL_ACTIONS`，默认按 diagnose 授权。
- Driver Plugin 可为自定义 engine 创建 registry handle。
- Tool Plugin 注册的工具经过统一 authorization/audit/observability wrapper。
- Policy Plugin 只能追加 deny 决策，不能放宽授权。
- Export Plugin 接收 audit event 副本且失败不阻断。
- 新增测试在 `npm run build` 后通过。

## 四、接受风险

| 风险 | 级别 | 处理 |
|------|------|------|
| manifest schema 未使用 JSON Schema 库 | P2 | 当前为无新增依赖的结构化 parser；复杂 schema 后续再引入 |
| 插件依赖隔离未完成 | P1 | 当前仅加载显式本地路径；依赖隔离和 worker thread 后续增强 |
