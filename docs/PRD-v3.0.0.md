# PRD v3.0.0：Manifest-first 插件化生态

**文档编号**: PRD-v3.0.0
**日期**: 2026-07-10
**状态**: 已完成
**关联 ADR**: `docs/ADR-003-plugin-architecture.md`

---

## 一、背景

v2.x 已完成 Bearer/RBAC、授权审计、请求级 policy、可观测、告警、审计 webhook sink 和审批声明式策略门控。v3.0.0 进入插件化生态阶段，需要先稳定第三方扩展的 manifest、权限声明和诊断边界，再逐步开放 driver/tool/policy/export 注册。

## 二、目标

| 优先级 | 目标 | 验收 |
|--------|------|------|
| P0 | Manifest-first 插件声明 | 本地插件目录必须提供 `plugin.json`，声明 name/version/type/main/permissions |
| P0 | 本地插件发现 | `DB_PLUGIN_PATHS` 可配置逗号分隔插件目录，默认关闭 |
| P0 | 安全校验 | `main` 必须在插件目录内，manifest 无效时 fail-fast |
| P1 | 插件治理工具 | `plugin_list` 和 `plugin_validate_manifest` 可用于诊断，不执行插件入口 |
| P1 | 安全摘要 | 启动诊断和 `server_info` 只展示插件名称、版本、类型和权限摘要，不泄漏本地路径 |
| P1 | 测试覆盖 | 覆盖 manifest parser、路径逃逸、发现、工具注册和 tool action map |

## 三、后续目标

| 项目 | 处理 |
|------|------|
| 插件市场 | 后续评估，不纳入 v3.0.0 |
| 插件依赖隔离 | 后续增强；v3.0.0 仅加载显式本地路径 |
| export plugin 指标事件 | v3.0.0 先接入 audit event，metric event 后续扩展 |
| 任意 npm 自动安装 | 不纳入 v3.0.0 GA，保持本地显式路径 |

## 四、安全边界

- 默认 `DB_PLUGIN_PATHS` 为空，插件发现完全关闭。
- 只有显式配置 `DB_PLUGIN_PATHS` 的本地插件会被加载。
- 插件 manifest 必须声明权限；工具 action 必须属于核心 `AuthAction` 集合。
- 安全摘要不输出本地目录、入口文件路径或插件配置内容。
- 插件工具必须通过核心统一 authorization、audit、observability 和 error handling。
- Policy Plugin 只能在 RBAC allow 后追加 deny，不能放宽既有拒绝。
- Export Plugin 接收审计事件副本，失败不阻断工具调用或审计写入。
