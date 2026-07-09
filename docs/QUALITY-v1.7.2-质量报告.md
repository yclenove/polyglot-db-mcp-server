# v1.7.2 质量报告：发布工程与配置基线

**文档编号**: QUALITY-v1.7.2
**版本**: 1.0
**日期**: 2026-07-10
**状态**: 已完成
**关联迭代**: `docs/ITER-v1.7.2-迭代计划.md`
**审查范围**: CI 门禁、格式化、配置模板、包产物和发布文档

---

## 一、审查结论

v1.7.2 修复了 GitHub Actions 持续失败的问题，并补齐发布工程基线。线上失败根因为 CI 的 `Format check` 步骤执行 `npm run format:check`，而仓库 `src/**/*.ts` 尚未整体符合 Prettier 配置。

| 结论项 | 状态 | 证据 |
|--------|------|------|
| 是否允许发布 | 允许 | 本地按 CI 顺序验证通过 |
| CI 失败是否修复 | 通过 | `npm run format:check` 已通过，workflow 调整为 build 先于 test |
| 配置模板是否入库 | 通过 | `.env.example` 已解除忽略并纳入 npm package `files` |
| 包产物是否可核对 | 通过 | `npm pack --dry-run` 输出版本 `1.7.2`，包含 `.env.example` |
| 文档是否同步 | 通过 | `CHANGELOG.md`、`CONFIG`、`RELEASE_CHECKLIST`、`INDEX`、`ROADMAP` 已更新 |

---

## 二、CI 失败复盘

| 项目 | 结果 |
|------|------|
| 失败 workflow | `CI` |
| 失败 run | `29031891991` |
| 失败 job | `build-and-test` |
| 失败步骤 | `Format check` |
| 失败命令 | `npm run format:check` |
| 根因 | 33 个 `src/**/*.ts` 文件未通过 Prettier 检查 |
| 修复 | 执行 `npm run format`，并保留 `format:check` 作为 CI 门禁 |

---

## 三、质量门禁结果

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm ci` | 通过 | 安装成功；npm audit 报 7 moderate / 2 high，未作为本次 CI 阻塞项 |
| `npm run build` | 通过 | `tsc` 通过 |
| `npm test` | 通过 | 455 tests / 99 suites / 0 failed |
| `npm run typecheck` | 通过 | `tsc --noEmit` 通过 |
| `npm run lint` | 通过 | 0 error / 0 warning |
| `npm run format:check` | 通过 | 所有 `src/**/*.ts` 符合 Prettier |
| `npm run test:coverage:check` | 通过 | All files lines 65.53%，branches 74.71%，functions 66.03% |
| `npm pack --dry-run` | 通过 | 包版本 `1.7.2`，total files 156，包含 `.env.example` |
| `npm run benchmark` | 通过 | SQL guards benchmark 通过；生成报告未纳入本次提交 |

---

## 四、v1.7.2 验收清单

| 验收项 | 状态 | 证据 |
|--------|------|------|
| CI 使用 `npm ci` | 通过 | `.github/workflows/ci.yml` |
| CI 中 build 在 test 前 | 通过 | workflow 顺序为 install -> build -> test |
| `.env.example` 覆盖核心环境变量 | 通过 | SQLite 默认配置、多引擎示例、限制、脱敏、缓存、日志、关闭参数 |
| `docs/CONFIG.md` 提供最小 SQLite 和多连接示例 | 通过 | 文档已同步 `.env.example` 说明 |
| `docs/RELEASE_CHECKLIST.md` 覆盖发布前/中/后检查 | 通过 | 增加 format、coverage、`.env.example` 和 pack 规则 |
| `npm pack --dry-run` 已人工核对 | 通过 | `.env.example`、`dist/`、README、CHANGELOG、LICENSE、MIGRATION、AGENTS 均包含 |
| `docs/INDEX.md` 能指导当前文档阅读 | 通过 | v1.7.1/v1.7.2 状态已标为已完成 |
| 必跑命令通过 | 通过 | 见质量门禁结果 |

---

## 五、接受风险

| 风险 | 接受理由 | 后续跟踪 |
|------|----------|----------|
| `npm ci` 报依赖漏洞 | 本次目标是修复 CI 和发布工程，不做未验证的依赖升级 | 后续安全补丁或 v1.7.3+ 单独处理 |
| Prettier 机械格式化触及较多文件 | CI 已强制启用 format check，不统一格式会持续失败 | 后续避免未格式化代码进入提交 |
| `.env.example` 中含连接串协议示例 | 均为占位符或本地示例，不含真实凭证 | release checklist 要求人审 secrets scan |

---

## 六、最终签核

| 项目 | 结果 | 备注 |
|------|------|------|
| CI 失败修复 | 通过 | 本地复现并修复 `format:check` |
| 发布工程 | 通过 | CI、pack dry-run、release checklist 已补强 |
| 配置基线 | 通过 | `.env.example` 已入库并纳入包产物 |
| 文档同步 | 通过 | CHANGELOG / CONFIG / INDEX / ROADMAP / RELEASE_CHECKLIST 已更新 |
| 允许发布 | 是 | 可发布 v1.7.2 |
