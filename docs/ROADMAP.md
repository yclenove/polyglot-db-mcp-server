# polyglot-db-mcp-server 长期迭代规划

**文档编号**: ROADMAP
**版本**: 1.0
**日期**: 2026-07-09
**规划周期**: 2026 Q3 ~ 2027 Q2
**当前基线**: v1.9.0
**状态**: 当前有效
**当前详细迭代**: `docs/ITER-v1.7.1-迭代计划.md`、`docs/ITER-v1.7.2-迭代计划.md`、`docs/ITER-v1.7.3-迭代计划.md`、`docs/ITER-v1.8.0-迭代计划.md`、`docs/ITER-v1.9.0-迭代计划.md`
**文档索引**: `docs/INDEX.md`

---

## 一、长期定位

polyglot-db-mcp-server 的长期目标是成为 **安全优先、企业可用、多引擎覆盖完整的数据库 MCP 网关**。

核心差异化不应只放在"支持更多数据库"，而应建立在以下四个支柱上：

| 支柱 | 目标 | 关键能力 |
|------|------|----------|
| 安全可信 | 默认安全，最小权限，敏感数据可控 | 只读保护、注入检测、脱敏、审计、权限控制 |
| 多引擎统一 | 屏蔽数据库差异，提供一致 MCP 工具体验 | SQL/Mongo/Redis/SQLite，后续 DuckDB/向量库 |
| 运维可观测 | 生产环境可诊断、可度量、可追责 | 健康检查、指标、日志、审计导出、告警接口 |
| 开发者体验 | 易配置、易调试、易集成、易发布 | CLI、配置校验、错误提示、文档、模板、CI |

---

## 二、当前状态评估

### 2.1 已具备能力

- 支持 MySQL、PostgreSQL、SQL Server、Oracle、MongoDB、Redis、SQLite。
- 支持 stdio 和 Streamable HTTP 双传输，HTTP 模式包含 `/mcp`、`/healthz`、`/readyz`。
- SQL 查询在 MCP 层保留只读保护，驱动层也有 readonly 约束。
- 已具备注入检测、数据脱敏、审计日志、查询缓存、查询回放、查询建议等安全与体验功能。
- 已支持 SQL `schema_diff`、MongoDB 事务工具和 Redis pipeline 安全批处理。
- 已有较完整的单元测试和工具层测试，当前 `npm run build`、`npm test` 可通过。
- 已有中文文档、API 文档、质量报告、市场分析和多轮迭代文档。

### 2.2 主要短板

| 类型 | 短板 | 影响 |
|------|------|------|
| 质量债 | 部分核心模块缺少独立测试，如 query-cache、rate-limiter、sql-helpers、version | 后续重构风险较高 |
| 稳定性 | RateLimiter 桶长期不清理，存在长运行内存增长风险 | 生产进程稳定性 |
| 方言一致性 | MSSQL EXPLAIN 语法仍可能不符合驱动批处理行为 | 部分工具可用性不稳定 |
| 安全规范 | cacheKey 序列化边界、分页数字拼接、正则 ReDoS 防护仍需收敛 | 边界安全风险 |
| 发布体系 | 版本、文档、质量门禁、发布说明尚未形成自动化流水线 | 发布效率与一致性 |
| 企业安全 | 当前已有 HTTP API key，但缺少 OAuth/RBAC/租户隔离 | 企业集成能力不足 |
| 高级数据库 | v1.9.0 已完成 P0 工作流，Redis Stream、Mongo explain、迁移草案仍待后续 | 工作流深度仍需扩展 |

---

## 三、版本节奏

建议采用"小步快跑 + 明确质量门禁"：

| 版本类型 | 周期 | 内容边界 | 发布条件 |
|----------|------|----------|----------|
| Patch `1.7.x` | 3 ~ 7 天 | bugfix、测试补齐、文档修正、安全小修 | build/test/lint 无 error，风险可控 |
| Minor `1.x.0` | 3 ~ 5 周 | 新工具、新引擎、小型协议能力 | PRD + 设计 + 测试计划齐全 |
| Major `2.0+` | 8 ~ 12 周 | 认证、权限、传输、插件等架构能力 | 迁移文档、兼容策略、灰度方案齐全 |

长期保持 `main` 可发布；大型特性用 `codex/feature-*` 或常规 feature 分支开发。

---

## 四、路线图总览

| 阶段 | 目标版本 | 时间窗口 | 主题 | 目标结果 |
|------|----------|----------|------|----------|
| Phase 0 | v1.7.1 ~ v1.7.3 | 2026 Q3 前半 | 质量与安全收敛 | 消除 v1.7.0 质量债，建立稳定基线 |
| Phase 1 | v1.8.0 | 2026 Q3 | 传输与运维增强 | 支持 HTTP 传输、健康端点、部署体验增强 |
| Phase 2 | v1.9.0 | 2026 Q4 | 高级数据库能力 | Mongo 事务、Redis pipeline、SQL schema diff 已完成 |
| Phase 3 | v2.0.0 | 2026 Q4 ~ 2027 Q1 | 企业安全 | OAuth 2.1、RBAC、租户隔离、审计增强 |
| Phase 4 | v2.1.0 | 2027 Q1 | 分析与本地数据生态 | DuckDB、CSV/Parquet、只读分析场景 |
| Phase 5 | v2.2.0 | 2027 Q2 | 可观测与治理 | Prometheus/OTel、策略引擎、配置中心化 |
| Phase 6 | v3.0.0 | 2027 Q2+ | 插件化生态 | 插件式驱动、第三方工具包、可扩展能力市场 |

### 4.1 需求追踪矩阵

| 来源 | 关键诉求 | 落地版本 | 追踪方式 |
|------|----------|----------|----------|
| `docs/QUALITY-v1.7.0-质量报告.md` | 测试缺口、RateLimiter、cacheKey、MSSQL EXPLAIN | v1.7.1 | `ITER-v1.7.1` P0/P1 任务 |
| `docs/QUALITY-v1.7.1-质量报告.md` | v1.7.1 完成审计 | v1.7.1 | 已填写真实命令和质量结果 |
| `docs/QUALITY-v1.7.3-质量报告.md` | v1.7.3 完成审计 | v1.7.3 | 已填写真实命令、快速开始和质量结果 |
| `docs/QUALITY-v1.8.0-质量报告.md` | v1.8.0 完成审计 | v1.8.0 | 已填写真实命令、HTTP smoke 和质量结果 |
| `docs/QUALITY-v1.9.0-质量报告.md` | v1.9.0 完成审计 | v1.9.0 | 已填写真实命令、高级工作流和安全边界结果 |
| `docs/PRD-v1.7.0.md` | 后续 HTTP、OAuth、RBAC、Mongo 事务、Redis Pipeline、DuckDB | v1.8 ~ v2.1 | ROADMAP Phase 1 ~ 4 |
| `docs/MARKET-市场分析.md` | DBHub/FreePeak 等竞品压力，引擎覆盖和企业能力 | v1.8 ~ v2.2 | 传输、企业安全、可观测 |
| AGENTS.md | `sql_query` 必须保持 MCP 层只读保护，测试先 build 后 test | 所有版本 | 质量门禁和发布 checklist |
| 当前代码状态 | lint warning、缺少独立核心测试 | v1.7.1 | 必跑命令和 DoD |

### 4.2 规划优先级原则

| 原则 | 说明 |
|------|------|
| 安全优先 | 会削弱只读、脱敏、审计、allowlist/keyPrefix 的变更不得进入 patch 版本 |
| 质量先于功能 | 当前质量债未收敛前，不启动 HTTP/OAuth/DuckDB 等大功能 |
| 可验证优先 | 每个计划项必须能对应代码、测试、文档或命令输出证据 |
| 默认兼容 | stdio、本地开发、现有 `DB_MCP_CONNECTIONS` 格式默认不破坏 |
| 小步发布 | patch 聚焦修复，minor 聚焦功能，major 聚焦架构与兼容策略 |

---

## 五、Phase 0：v1.7.x 质量与安全收敛

### 5.1 v1.7.1：质量补丁

**目标**: 先把当前 v1.7.0 的质量债收敛，避免在不稳基线上继续堆功能。
**详细计划**: `docs/ITER-v1.7.1-迭代计划.md`
**状态**: 已完成。

| 优先级 | 任务 | 范围 | 验收标准 |
|--------|------|------|----------|
| P0 | 补齐核心模块测试 | `query-cache`, `rate-limiter`, `sql-helpers`, `version` | 新增独立测试，覆盖关键边界 |
| P0 | 修复 RateLimiter 桶清理 | `src/core/rate-limiter.ts` | 不活跃桶可清理，定时器 `unref()` |
| P1 | 改进 cacheKey 稳定序列化 | `src/core/query-cache.ts` | 区分 `undefined`、`Date`、`BigInt` 等边界 |
| P1 | 修复 MSSQL EXPLAIN 执行方式 | `src/tools/sql.ts`, `src/tools/advisor.ts` | 驱动行为可验证，有测试或明确降级 |
| P1 | 清理 lint warning | `advisor.ts`, `sql.ts` | `npm run lint` 零 warning 或仅保留有说明豁免 |
| P2 | 更新质量报告状态 | `docs/QUALITY-v1.7.0-质量报告.md` | 已修复项和遗留项标注清楚 |

### 5.2 v1.7.2：发布工程补强

**详细计划**: `docs/ITER-v1.7.2-迭代计划.md`
**状态**: 已完成。

| 优先级 | 任务 | 验收标准 |
|--------|------|----------|
| P0 | CI 增加 build -> test 顺序门禁 | 与 AGENTS.md 要求一致 |
| P0 | 增加 release checklist | `docs/RELEASE_CHECKLIST.md` 覆盖版本、CHANGELOG、README、npm pack |
| P1 | 增加配置模板和配置指南 | `docs/CONFIG.md` 覆盖全部引擎和关键环境变量，后续与 `.env.example` 对齐 |
| P1 | 增加 npm package 产物检查 | `npm pack --dry-run` 输出符合预期 |
| P2 | 文档状态规范化 | 待评审、已完成、已废弃文档状态统一 |

### 5.3 v1.7.3：体验补丁

**详细计划**: `docs/ITER-v1.7.3-迭代计划.md`
**状态**: 已完成。

| 优先级 | 任务 | 验收标准 |
|--------|------|----------|
| P1 | CLI init 模板增强 | 可生成最小可运行配置 |
| P1 | 错误码文档化 | `docs/ERRORS.md` 和 API 文档列出 code、message、hint |
| P1 | 连接诊断建议增强 | 常见端口、认证、readonly、SQLite 文件路径有明确 hint |
| P2 | README 快速开始瘦身 | 5 分钟内完成本地 SQLite 演示 |

---

## 六、Phase 1：v1.8.0 传输与运维增强

**主题**: 从桌面/本地 stdio 走向可部署服务。
**前置 ADR**: `docs/ADR-001-streamable-http.md`
**前置 PRD**: `docs/PRD-v1.8.0.md`
**实施计划**: `docs/ITER-v1.8.0-迭代计划.md`
**状态**: 已完成。

### 6.1 功能范围

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | Streamable HTTP 传输 | 保留 stdio，新增 HTTP server 模式 |
| P0 | 健康检查端点 | `/healthz`、`/readyz`，用于容器和平台探活 |
| P1 | 配置热检查 | 启动前校验连接配置、环境变量、默认连接 |
| P1 | Docker 镜像发布 | 多平台镜像，最小运行时，健康检查 |
| P1 | 结构化日志标准化 | JSON/human 两种格式统一字段 |
| P2 | 基础 API key 保护 | 作为 OAuth 前的轻量保护，不作为最终企业权限方案 |

### 6.2 不纳入 v1.8.0

- 完整 OAuth 2.1。
- 细粒度 RBAC。
- 多租户隔离。
- 插件式驱动加载。

### 6.3 成功指标

- stdio 与 HTTP 两种模式均可运行。
- Docker Compose 可一键启动并通过健康检查。
- 传输层新增功能不改变现有工具参数。
- HTTP 模式下错误返回结构与 stdio 工具结果保持一致。

---

## 七、Phase 2：v1.9.0 高级数据库能力

**主题**: 从"能查能写"升级到"更懂数据库工作流"。
**前置 PRD**: `docs/PRD-v1.9.0.md`
**实施计划**: `docs/ITER-v1.9.0-迭代计划.md`
**状态**: 已完成。

v1.9.0 已完成 P0 范围：SQL `schema_diff`、MongoDB 多文档事务生命周期工具、Redis pipeline 安全命令子集。P1/P2 能力作为 v1.9.x 或 v2.x 后续输入。

### 7.1 SQL 能力

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | Schema diff | 比较两个连接或两个 schema 的表结构差异 |
| P1 | DDL 生成增强 | 支持索引、主键、外键、nullable、默认值 |
| P1 | Explain 标准化 | 各 SQL 引擎返回统一字段：plan、cost、warnings |
| P2 | 迁移草案生成 | 生成可人工审核的 migration draft，不自动执行 |

### 7.2 MongoDB 能力

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | 多文档事务 | session 管理、commit/rollback、超时清理 |
| P1 | 聚合 pipeline explain | 只读分析性能瓶颈 |
| P1 | 索引建议增强 | 基于 filter/sort/pipeline 生成索引建议 |

### 7.3 Redis 能力

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | Pipeline 批处理 | 限制命令白名单，提升批量操作效率 |
| P1 | Stream 支持 | xadd/xread/xrange 等安全子集 |
| P2 | keyspace 分析 | key 类型、TTL、大小采样、热点提示 |

---

## 八、Phase 3：v2.0.0 企业安全

**主题**: 企业可接入、可审计、可授权。
**前置 ADR**: `docs/ADR-002-oauth-rbac.md`
**前置 PRD**: `docs/PRD-v2.0.0.md`
**迁移指南**: `docs/MIGRATION-v2.0.0.md`

### 8.1 核心能力

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | OAuth 2.1 / Bearer Token 验证 | HTTP 模式下的标准认证入口 |
| P0 | RBAC 权限模型 | 按用户、连接、工具、操作类型授权 |
| P0 | 策略化只读保护 | SQL/Mongo/Redis 写操作统一策略判断 |
| P1 | 审计日志持久化 | 文件、SQLite、外部 webhook 可选 |
| P1 | Secret 管理适配 | 环境变量、文件、云 Secret Provider 预留接口 |
| P2 | 多租户隔离 | 租户级连接池、配置隔离、审计隔离 |

### 8.2 权限模型建议

| 维度 | 示例 |
|------|------|
| Subject | user、service account、anonymous |
| Resource | connection_id、database、collection、key prefix |
| Action | read、write、admin、diagnose、export |
| Condition | 时间窗口、IP、最大行数、只读强制、脱敏强制 |

### 8.3 兼容策略

- v2.0 默认保持本地 stdio 无认证，以兼容桌面客户端。
- HTTP 模式默认要求认证；允许显式 `DB_HTTP_AUTH_DISABLED=true` 关闭。
- 所有破坏性行为必须有迁移说明和配置开关。

---

## 九、Phase 4：v2.1.0 分析型与本地数据生态

**主题**: 把本项目扩展到本地分析和轻量数据湖场景。

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | DuckDB 引擎 | CSV/Parquet/JSON 本地分析，默认只读 |
| P1 | 文件数据源只读挂载 | 明确路径 allowlist，禁止任意文件读取 |
| P1 | 查询结果导出 | CSV/JSON/Markdown，可配置最大行数 |
| P2 | 采样分析 | 大表自动采样、字段类型推断、数据质量提示 |

安全边界：

- 默认禁止访问工作区外路径。
- 文件路径必须配置 allowlist。
- 导出结果默认脱敏并限制大小。

---

## 十、Phase 5：v2.2.0 可观测与治理

**主题**: 从工具服务器升级为可治理的生产服务。

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | OpenTelemetry tracing | 每次工具调用可追踪 connection、duration、error code |
| P0 | Prometheus 指标完善 | 请求量、失败率、延迟、缓存命中率、连接健康 |
| P1 | 策略引擎 | 最大行数、最大执行时间、写操作审批、脱敏强制 |
| P1 | 告警 webhook | 连接失败、错误率升高、慢查询、频繁写操作 |
| P2 | 配置中心化 | 支持外部配置文件 reload，后续可接入 UI |

---

## 十一、Phase 6：v3.0.0 插件化生态

**主题**: 把核心变成平台，让第三方扩展数据库、工具和策略。
**前置 ADR**: `docs/ADR-003-plugin-architecture.md`

### 11.1 插件边界

| 插件类型 | 能力 |
|----------|------|
| Driver Plugin | 新数据库引擎，如 MariaDB、ClickHouse、Elasticsearch、Neo4j |
| Tool Plugin | 新 MCP 工具集合，如 DBA 工具、数据质量工具 |
| Policy Plugin | 自定义安全策略、审批规则、脱敏规则 |
| Export Plugin | 审计、指标、查询结果输出到外部系统 |

### 11.2 插件要求

- 插件 manifest 必须声明权限、工具名、引擎、配置 schema。
- 默认沙箱化加载，不允许任意执行危险初始化逻辑。
- 插件工具必须通过统一审计、限流、错误处理和权限校验。

---

## 十二、横向工程任务

这些任务不绑定单一版本，应在每个 minor 版本持续推进。

| 类别 | 任务 | 目标 |
|------|------|------|
| 测试 | 单测、工具测试、集成测试分层 | 快速测试 < 30s，完整测试可接 Docker |
| 类型 | 消除 `any`，复用 Zod schema | 提升维护性 |
| 文档 | API 文档由工具注册自动生成 | 避免文档漂移 |
| 安全 | 正则长度限制、超时、资源限制 | 降低 ReDoS 和资源耗尽风险 |
| 性能 | benchmark 常态化 | 防止 guard/cache/driver 性能回退 |
| 发布 | 自动生成 CHANGELOG 和 GitHub Release 草稿 | 降低发布成本 |

---

## 十三、质量门禁

每个版本合入前必须满足：

| 门禁 | 要求 |
|------|------|
| 构建 | `npm run build` 通过 |
| 测试 | `npm test` 通过；新增功能必须有确定性测试 |
| Lint | `npm run lint` 无 error；warning 必须说明 |
| 只读保护 | `sql_query` 仍必须在 MCP 层先执行 `isReadOnlyQuery` |
| 安全 | 新写操作必须检查 readonly、allowlist/keyPrefix、审计 |
| 文档 | README/API/CHANGELOG 更新；新增环境变量必须文档化 |
| 兼容 | 默认配置不得破坏现有 stdio 使用方式 |

---

## 十四、关键指标

| 指标 | v1.7 基线 | 2026 Q4 目标 | 2027 Q2 目标 |
|------|-----------|--------------|--------------|
| 支持引擎数 | 7 | 7 ~ 8 | 8 ~ 10 |
| 工具测试覆盖 | 良好但不均衡 | 核心模块全覆盖 | 所有工具有注册+行为测试 |
| 启动模式 | stdio | stdio + HTTP | stdio + HTTP + 企业部署模板 |
| 认证授权 | 无 | API key / 初版 OAuth | OAuth + RBAC + 审计持久化 |
| 可观测 | 日志 + 基础指标 | 健康检查 + Prometheus | OTel + 告警 + 策略治理 |
| 文档成熟度 | 多文档但状态混杂 | 文档状态清晰 | API 自动生成、示例完整 |

---

## 十五、近期建议执行顺序

1. v2.0.0：评审并实施 OAuth/RBAC、租户隔离、审计持久化和迁移策略。
2. v2.1.0：评审 DuckDB、本地文件数据源和导出边界。
3. v2.2.0：推进 OTel/Prometheus 和策略治理。
4. v3.0.0：在权限、审计、策略稳定后进入插件化生态。

---

## 十六、暂不建议投入的方向

| 方向 | 原因 | 重新评估条件 |
|------|------|--------------|
| 跨库 join 自动执行 | 安全和一致性复杂，容易越权 | RBAC、审计、资源限制成熟后 |
| 自动执行 schema migration | 风险高，不符合安全优先定位 | 有审批流和回滚机制后 |
| Web UI | 维护成本高，偏离 MCP server 核心 | 企业用户明确需要治理面板 |
| 过早插件市场 | 核心接口未稳定，容易形成兼容负担 | v2.x 权限、审计、策略稳定后 |

---

## 十七、路线图维护机制

### 17.1 文档分层

| 文档类型 | 用途 | 更新时机 |
|----------|------|----------|
| ROADMAP | 长期方向、版本边界、治理原则 | 每个 minor 版本结束后复核 |
| INDEX | 文档入口、状态索引、阅读顺序 | 新增/废弃规划文档时 |
| CONFIG | 环境变量、连接对象、安全配置建议 | 新增/修改配置项时 |
| ERRORS | 错误码、hint、排障和测试要求 | 新增/修改错误行为时 |
| RELEASE_CHECKLIST | 发布门禁、包产物和发布后验证 | 每次发布前 |
| PRD | 单个 minor/major 的产品需求 | 启动新功能版本前 |
| ITER | 单个 patch/minor 的可执行任务 | 每个迭代开始前 |
| QUALITY | 质量审查和发布门禁记录 | 迭代完成前 |
| CHANGELOG | 面向用户的真实变更 | 发布前 |
| ADR | 架构决策，如 HTTP/OAuth/插件化 | 做不可逆架构选择前 |

### 17.2 状态定义

| 状态 | 含义 |
|------|------|
| 草案 | 初步建议，未纳入执行 |
| 待评审 | 内容完整，需要人工确认优先级和边界 |
| 待执行 | 已确认，可拆分任务实施 |
| 执行中 | 已有代码或文档变更 |
| 已完成 | 验收命令和交付物均通过 |
| 已延期 | 需求保留但移出当前版本 |
| 已废弃 | 不再计划投入 |

### 17.3 完成审计要求

每个版本关闭前需要逐项回答：

1. 计划中的 P0/P1 是否全部完成，未完成项是否有接受风险记录。
2. 新增功能是否有测试、文档和 CHANGELOG。
3. 安全边界是否被复核：只读、注入、脱敏、审计、凭证。
4. 兼容性是否被复核：工具名、参数、环境变量、默认启动方式。
5. 发布命令是否通过：`npm run build`、`npm test`、`npm run lint`。

---

## 十八、下一步

建议下一步进入 **v2.0.0 企业安全迭代**：

1. v2.0.0 开发前评审 `docs/ADR-002-oauth-rbac.md`、`docs/PRD-v2.0.0.md` 和 `docs/MIGRATION-v2.0.0.md`，确认认证授权与迁移边界。
2. 明确 stdio 兼容、HTTP 默认认证、API key 与 OAuth 的过渡策略。
3. v3.0.0 开发前复核 `docs/ADR-003-plugin-architecture.md`，确认插件安全边界。
4. 提交规划包前按 `docs/PLANNING_AUDIT.md` 运行引用和格式审计。
5. 每阶段完成后运行 `npm run build`、`npm test`、`npm run lint`，再提交发布补丁。
