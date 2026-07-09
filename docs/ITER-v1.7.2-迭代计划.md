# v1.7.2 迭代计划：发布工程与配置基线

**文档编号**: ITER-v1.7.2
**版本**: 1.0
**日期**: 2026-07-09
**目标版本**: v1.7.2
**迭代类型**: Patch / Release Engineering
**建议周期**: 3 ~ 5 个工作日
**状态**: 初稿，待执行
**前置依赖**: v1.7.1 质量补丁完成

---

## 一、迭代目标

v1.7.2 聚焦发布工程、配置模板、CI 门禁和包产物检查。目标是让项目从“本地可运行”提升为“可稳定发布、可复现安装、可快速排障”。

### 1.1 总目标

1. 建立可重复执行的发布 checklist。
2. 保证 CI 顺序符合仓库约定：先 `npm run build`，再 `npm test`。
3. 提供完整 `.env.example` 和多引擎配置模板。
4. 增加 npm package 产物检查，避免漏发运行时文件或误发内部文档。
5. 规范文档状态，降低后续维护和评审成本。

### 1.2 成功指标

| 指标 | 目标 |
|------|------|
| CI 门禁 | build -> test -> lint 顺序明确，失败即阻断 |
| 配置模板 | 覆盖 MySQL/PG/MSSQL/Oracle/MongoDB/Redis/SQLite 和关键环境变量 |
| package dry-run | `npm pack --dry-run` 输出清晰，必要文件包含，敏感文件排除 |
| 发布 checklist | 覆盖版本、CHANGELOG、README/API、测试、tag、push、npm 发布前检查 |
| 文档状态 | 主要 docs 均有状态或在索引中标注用途 |

---

## 二、范围边界

### 2.1 纳入范围

| 编号 | 类型 | 内容 |
|------|------|------|
| S-001 | CI | workflow 顺序、Node 版本、缓存、必要命令 |
| S-002 | 配置 | `.env.example`、多引擎连接示例、默认值说明 |
| S-003 | 发布 | release checklist、npm pack dry-run、tag 流程 |
| S-004 | 文档 | 文档索引、状态归档、README 发布相关说明 |
| S-005 | 安全 | secrets 排除检查、`.gitignore`/`.npmignore` 或 `files` 字段核对 |

### 2.2 不纳入范围

| 内容 | 原因 | 后续版本 |
|------|------|----------|
| HTTP 传输实现 | 属于 v1.8.0 功能开发 | v1.8.0 |
| OAuth/RBAC | 企业安全架构能力 | v2.0.0 |
| 自动 npm publish | 需先稳定手动 release checklist | v1.8+ |
| GitHub Release 自动生成 | 依赖 changelog 规范和 token 配置 | v1.8+ |

---

## 三、任务分解

### Epic A：CI 门禁补强

#### A-001：CI 命令顺序标准化

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `.github/workflows/ci.yml` |
| 预估 | 0.25 天 |

要求：

1. 明确执行顺序：`npm ci` -> `npm run build` -> `npm test` -> `npm run lint`。
2. 测试导入 `dist/` 的约束必须保留，不能跳过 build。
3. Node 版本与 `package.json` engines 对齐，至少覆盖 Node 20。
4. CI 日志中能直接看出失败阶段。

验收：

- [ ] CI 文件中 build 在 test 之前。
- [ ] 本地按 CI 顺序运行通过。
- [ ] README 或文档说明本地验证命令。

#### A-002：依赖缓存与锁文件检查

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `.github/workflows/ci.yml`, `package-lock.json` |
| 预估 | 0.25 天 |

要求：

- 使用 `npm ci`，不使用 `npm install`。
- CI 缓存基于 `package-lock.json`。
- 如果 `package.json` 与 lock 不一致，CI 必须失败。

---

### Epic B：配置模板与本地启动体验

#### B-001：新增 `.env.example`

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `.env.example` |
| 预估 | 0.5 天 |

必须覆盖：

| 类别 | 环境变量 |
|------|----------|
| 核心连接 | `DB_MCP_CONNECTIONS`, `DB_MCP_DEFAULT_CONNECTION_ID` |
| 查询限制 | `DB_MAX_ROWS`, `DB_QUERY_TIMEOUT_MS`, `DB_MAX_SQL_LENGTH` |
| 安全 | `DB_MASKING_MODE`, `DB_MASKING_EXCLUDE_FIELDS`, `DB_AUTO_PAGINATION` |
| 缓存/限流 | `DB_QUERY_CACHE_SIZE`, `DB_QUERY_CACHE_TTL_MS`, `DB_RATE_LIMIT_PER_SECOND` |
| 日志 | `LOG_LEVEL`, `LOG_FORMAT` |
| 关闭 | `DB_SHUTDOWN_TIMEOUT_MS`, `DB_TRANSACTION_TIMEOUT_MS` |

模板要求：

- 所有连接字符串使用本地开发账号或占位符，不包含真实凭证。
- 多行 JSON 必须可复制使用，或提供单行压缩示例。
- SQLite 示例优先，保证 5 分钟内可启动。

#### B-002：新增配置示例文档

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `docs/CONFIG.md` |
| 预估 | 0.5 天 |

内容：

1. 最小 SQLite 配置。
2. 多连接配置。
3. readonly 与 allowlist/keyPrefix 示例。
4. Docker Compose 本地数据库配置。
5. 常见错误与排查。

---

### Epic C：发布 checklist 和包产物检查

#### C-001：新增发布 checklist

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `docs/RELEASE_CHECKLIST.md` |
| 预估 | 0.5 天 |

Checklist 必须包括：

1. 确认工作区干净或仅有预期变更。
2. 更新 `package.json` 版本。
3. 更新 `CHANGELOG.md`。
4. 运行 `npm run build`。
5. 运行 `npm test`。
6. 运行 `npm run lint`。
7. 运行 `npm run typecheck`。
8. 运行 `npm pack --dry-run` 并核对产物。
9. 确认无 `.env`、真实连接串、生产凭证。
10. 创建 tag 并推送。

#### C-002：包产物 dry-run 规则

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `package.json`, `docs/RELEASE_CHECKLIST.md` |
| 预估 | 0.25 天 |

验收：

- [ ] `dist/`、README、CHANGELOG、LICENSE、MIGRATION、AGENTS 在包内。
- [ ] `src/`、`test/` 是否进入包有明确决策。
- [ ] `docs/` 是否进入包有明确决策；若不进入，README 指向仓库文档。
- [ ] `.env*`、coverage、临时文件不进入包。

---

### Epic D：文档状态和索引治理

#### D-001：文档索引维护

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `docs/INDEX.md` |
| 预估 | 0.25 天 |

要求：

- 列出 ROADMAP、ITER、PRD、QUALITY、ARCH、API、OPS、MARKET、SCOUT 文档。
- 标注当前状态：当前有效、历史参考、待评审、已完成、建议归档。
- 给出新贡献者阅读顺序。

#### D-002：历史文档状态标注策略

| 属性 | 内容 |
|------|------|
| 优先级 | P2 |
| 文件 | `docs/INDEX.md`，必要时各历史文档 |
| 预估 | 0.25 天 |

原则：

- 不重写历史文档内容。
- 在索引中标注其历史版本和参考价值。
- 当前规划以 `ROADMAP.md` 和最新 `ITER-*` 为准。

---

## 四、执行顺序

| 顺序 | 任务 | 说明 |
|------|------|------|
| 1 | A-001, A-002 | 先确保 CI 顺序和本地验证一致 |
| 2 | B-001, B-002 | 让配置模板和文档同步 |
| 3 | C-001, C-002 | 建立发布前检查流程 |
| 4 | D-001, D-002 | 文档索引和状态治理 |
| 5 | 全量验证 | build/test/lint/typecheck/pack dry-run |

---

## 五、测试与验证

### 5.1 必跑命令

```powershell
npm ci
npm run build
npm test
npm run lint
npm run typecheck
npm pack --dry-run
```

### 5.2 文档验证

- [ ] `.env.example` 中 JSON 示例语法有效。
- [ ] README、CONFIG、RELEASE_CHECKLIST 不互相矛盾。
- [ ] 文档中的命令在 PowerShell 下可执行。
- [ ] 文档无真实凭证。

---

## 六、验收清单

- [ ] CI 使用 `npm ci`。
- [ ] CI 中 `npm run build` 在 `npm test` 前。
- [ ] `.env.example` 覆盖全部核心环境变量。
- [ ] `docs/CONFIG.md` 提供最小 SQLite 和多连接示例。
- [ ] `docs/RELEASE_CHECKLIST.md` 覆盖发布前、发布中、发布后检查。
- [ ] `npm pack --dry-run` 结果已人工核对。
- [ ] `docs/INDEX.md` 能指导新贡献者阅读当前有效文档。
- [ ] `npm run build`、`npm test`、`npm run lint`、`npm run typecheck` 通过。

---

## 七、风险与回滚

| 风险 | 缓解 |
|------|------|
| CI 调整导致已有 workflow 失败 | 先本地按同顺序验证，再提交 |
| `.env.example` 被误认为生产配置 | 使用 dev/example 占位符，并明确禁止生产凭证 |
| package files 调整漏发文件 | 使用 `npm pack --dry-run` 核对 |
| 文档索引与旧文档冲突 | 索引声明当前有效文档优先级，不改写历史 |

---

## 八、Definition of Done

v1.7.2 完成条件：

1. 发布流程、配置模板、文档索引均落地。
2. CI 与本地验证命令一致。
3. package dry-run 产物符合预期。
4. 所有新增文档没有真实凭证。
5. `npm run build`、`npm test`、`npm run lint`、`npm run typecheck` 通过。
