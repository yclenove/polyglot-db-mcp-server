# v1.7.0 迭代计划

**文档编号**: ITER-v1.7.0
**版本**: 1.0
**日期**: 2026-05-05
**迭代周期**: 2026-05-06 ~ 2026-05-19（10 个工作日）
**状态**: 待执行

---

## 一、迭代范围确认

基于 PRD-v1.7.0、侦察报告、反馈分析和市场分析，最终纳入以下 9 个功能：

| 编号 | 功能 | 优先级 | 预估工时 | 来源 |
|------|------|:------:|:--------:|------|
| F-001 | 版本号统一管理 | P0 | 1h | 侦察报告 #1, 反馈 P0-1 |
| F-002 | strict-v2 脱敏逻辑修正 | P0 | 2h | 侦察报告 #2 |
| F-003 | SQL 辅助函数去重 | P1 | 2h | 侦察报告 #3 |
| F-004 | sql_query 自动分页 | P1 | 3h | 侦察报告 #5, 反馈 P1-1 |
| F-005 | redis_type 使用原生 TYPE 命令 | P1 | 1h | 侦察报告 #4, 反馈 P0-2 |
| F-006 | 错误信息增强 | P1 | 4h | 反馈 2.2 |
| F-007 | SQLite 引擎支持 | P2 | 16h | 侦察报告 5.2, 竞品分析 |
| F-008 | 连接诊断工具 | P2 | 4h | 反馈 2.1, 2.3 |
| F-009 | 缓存命中率统计 | P2 | 2h | 反馈 P1-3 |

**总计预估工时**: 35h（约 4.4 个工作日，留有缓冲用于测试、review、文档）

**不纳入范围**（列入后续版本）:
- Streamable HTTP 传输 -> v1.8.0
- OAuth 2.1 认证 -> v2.0.0
- MongoDB 多文档事务 -> v1.8.0
- DuckDB 引擎支持 -> v2.0.0

---

## 二、任务分解

### T-001: 版本号统一管理（F-001）

| 属性 | 值 |
|------|-----|
| 所属功能 | F-001 |
| 预估工时 | 1h |
| 前置依赖 | 无 |

**任务清单**:

| # | 任务 | 文件路径 | 工时 |
|---|------|----------|:----:|
| T-001-1 | 新建 `version.ts`，使用 `createRequire` 从 `package.json` 动态读取版本号 | `src/core/version.ts`（新建） | 0.3h |
| T-001-2 | `server.ts` 改为 `import { APP_VERSION } from '../core/version.js'` | `src/server.ts` | 0.1h |
| T-001-3 | `connections.ts` 改为导入 `APP_VERSION` | `src/tools/connections.ts` | 0.1h |
| T-001-4 | 新增版本号一致性测试：验证 `APP_VERSION` 与 `package.json` 一致 | `test/version.test.mjs`（新建） | 0.3h |
| T-001-5 | 全局搜索确认无其他硬编码版本号 | -- | 0.2h |

---

### T-002: strict-v2 脱敏逻辑修正（F-002）

| 属性 | 值 |
|------|-----|
| 所属功能 | F-002 |
| 预估工时 | 2h |
| 前置依赖 | 无 |

**任务清单**:

| # | 任务 | 文件路径 | 工时 |
|---|------|----------|:----:|
| T-002-1 | 重写 `applyLooseMode`：移除字段名检查，仅按值正则匹配脱敏 | `src/core/data-masking.ts` | 0.5h |
| T-002-2 | 为 `applyStrictV2Mode` 增加清晰注释，说明双重校验逻辑 | `src/core/data-masking.ts` | 0.2h |
| T-002-3 | 确认 `applyStrictMode` 逻辑正确，无需修改 | `src/core/data-masking.ts` | 0.1h |
| T-002-4 | 新增 strict-v2 模式专项测试：字段名匹配+值不匹配 -> 不脱敏 | `test/strict-v2.test.mjs` | 0.5h |
| T-002-5 | 新增 loose 模式专项测试：字段名不匹配+值匹配 -> 脱敏 | `test/masking-rules.test.mjs` | 0.5h |
| T-002-6 | 运行现有脱敏相关测试，确认无回归 | -- | 0.2h |

---

### T-003: SQL 辅助函数去重（F-003）

| 属性 | 值 |
|------|-----|
| 所属功能 | F-003 |
| 预估工时 | 2h |
| 前置依赖 | 无 |

**任务清单**:

| # | 任务 | 文件路径 | 工时 |
|---|------|----------|:----:|
| T-003-1 | 新建 `sql-helpers.ts`，从 `sql.ts` 中提取 `describeTableSql` 和 `listIndexesSql` | `src/core/sql-helpers.ts`（新建） | 0.5h |
| T-003-2 | `sql.ts` 改为从 `sql-helpers.ts` 导入 | `src/tools/sql.ts` | 0.3h |
| T-003-3 | `advisor.ts` 改为从 `sql-helpers.ts` 导入 | `src/tools/advisor.ts` | 0.3h |
| T-003-4 | 新增 `sql-helpers.test.mjs`，覆盖各引擎方言的辅助函数 | `test/sql-helpers.test.mjs`（新建） | 0.5h |
| T-003-5 | 运行 `sql.test.mjs` 和 `advisor` 相关测试，确认无回归 | -- | 0.4h |

---

### T-004: sql_query 自动分页（F-004）

| 属性 | 值 |
|------|-----|
| 所属功能 | F-004 |
| 预估工时 | 3h |
| 前置依赖 | T-003（需先完成 SQL 辅助函数去重，避免冲突） |

**任务清单**:

| # | 任务 | 文件路径 | 工时 |
|---|------|----------|:----:|
| T-004-1 | 实现 `applyPagination` 函数，支持 MySQL/PG/MSSQL/Oracle 四种方言 | `src/tools/sql.ts` | 1.0h |
| T-004-2 | 在 `sql_query` handler 中集成自动分页逻辑：检测 SQL 中是否已有 LIMIT | `src/tools/sql.ts` | 0.5h |
| T-004-3 | 增加 `DB_AUTO_PAGINATION` 环境变量支持，默认 `true` | `src/core/config.ts` | 0.3h |
| T-004-4 | 返回元数据增加 `page`、`pageSize`、`hasMore` 字段 | `src/tools/sql.ts` | 0.3h |
| T-004-5 | 新增自动分页测试：各方言 LIMIT/OFFSET 语法、已有 LIMIT 不覆盖、环境变量关闭 | `test/tools/sql.test.mjs` | 0.9h |

---

### T-005: redis_type 使用原生 TYPE 命令（F-005）

| 属性 | 值 |
|------|-----|
| 所属功能 | F-005 |
| 预估工时 | 1h |
| 前置依赖 | 无 |

**任务清单**:

| # | 任务 | 文件路径 | 工时 |
|---|------|----------|:----:|
| T-005-1 | `RedisDriver` 接口新增 `type(key)` 方法 | `src/drivers/redis/redis-driver.ts` | 0.2h |
| T-005-2 | 实现 `type(key)` 方法：调用 `redis.type(key)` | `src/drivers/redis/redis-driver.ts` | 0.2h |
| T-005-3 | `redis_type` 工具改为调用 `driver.type(key)` | `src/tools/redis.ts` | 0.2h |
| T-005-4 | 新增测试覆盖所有 Redis 类型（string/hash/list/set/zset/stream/none） | `test/tools/redis.test.mjs` | 0.4h |

---

### T-006: 错误信息增强（F-006）

| 属性 | 值 |
|------|-----|
| 所属功能 | F-006 |
| 预估工时 | 4h |
| 前置依赖 | T-001（版本号修复后，工具注册可能有变动） |

**任务清单**:

| # | 任务 | 文件路径 | 工时 |
|---|------|----------|:----:|
| T-006-1 | 统一错误格式为 `{ message, code, hint }` | `src/core/error-codes.ts` | 0.5h |
| T-006-2 | `connections.ts` 中 connection_id 未知错误增加可用 ID 列表 | `src/tools/connections.ts` | 0.5h |
| T-006-3 | `sql.ts` 中"非 SQL 连接"错误增加当前连接类型 | `src/tools/sql.ts` | 0.5h |
| T-006-4 | `sql.ts` 中"只读连接"错误增加修改建议 | `src/tools/sql.ts` | 0.3h |
| T-006-5 | `redis.ts` 中连接相关错误增加上下文信息 | `src/tools/redis.ts` | 0.5h |
| T-006-6 | `mongo.ts` 中连接相关错误增加上下文信息 | `src/tools/mongo.ts` | 0.5h |
| T-006-7 | 更新现有测试中对错误消息的断言 | `test/tools/*.test.mjs` | 0.7h |
| T-006-8 | 新增错误信息增强专项测试（8 个用例） | `test/tools/error-hints.test.mjs`（新建） | 0.5h |

---

### T-007: SQLite 引擎支持（F-007）

| 属性 | 值 |
|------|-----|
| 所属功能 | F-007 |
| 预估工时 | 16h |
| 前置依赖 | T-003, T-004（依赖共享 SQL helpers 和分页逻辑） |

**任务清单**:

| # | 任务 | 文件路径 | 工时 |
|---|------|----------|:----:|
| **驱动层** | | | |
| T-007-1 | 安装 `better-sqlite3` 和 `@types/better-sqlite3` | `package.json` | 0.5h |
| T-007-2 | `EngineType` 联合类型新增 `'sqlite'` | `src/core/types.ts` | 0.2h |
| T-007-3 | 实现 `SqliteDriver` 类：连接、查询、执行、关闭 | `src/drivers/sql/sqlite-driver.ts`（新建） | 3.0h |
| T-007-4 | 实现 SQLite 方言的 SQL Guards 适配（LIMIT/OFFSET 语法、危险操作检测） | `src/core/sql-guards.ts` | 0.5h |
| T-007-5 | `config.ts` 支持 `engine: 'sqlite'` 配置解析和校验 | `src/core/config.ts` | 0.5h |
| T-007-6 | `bootstrap.ts` 支持 SQLite 连接创建（WAL 模式默认开启） | `src/bootstrap.ts` | 0.5h |
| **工具层** | | | |
| T-007-7 | `sql.ts` 中注册 SQLite 专属工具（9 个路由别名） | `src/tools/sql.ts` | 1.5h |
| T-007-8 | `schema.ts` 的 `schema_export` 工具支持 SQLite 方言 | `src/tools/schema.ts` | 0.5h |
| **错误处理** | | | |
| T-007-9 | SQLite 文件不存在时自动创建 | `src/drivers/sql/sqlite-driver.ts` | 0.3h |
| T-007-10 | SQLite 连接错误增加友好提示（文件路径、权限问题） | `src/drivers/sql/sqlite-driver.ts` | 0.3h |
| **测试** | | | |
| T-007-11 | SQLite 驱动单元测试（连接、查询、执行、事务、WAL） | `test/drivers/sqlite-driver.test.mjs`（新建） | 2.5h |
| T-007-12 | SQLite 工具集成测试（9 个工具的端到端测试） | `test/tools/sqlite.test.mjs`（新建） | 2.5h |
| T-007-13 | SQLite SQL 注入检测测试 | `test/sql-guards.test.mjs` | 0.5h |
| T-007-14 | SQLite 只读连接保护测试 | `test/tools/sqlite.test.mjs` | 0.3h |
| **配置示例** | | | |
| T-007-15 | `.env.example` 增加 SQLite 配置示例 | `.env.example` | 0.2h |
| T-007-16 | `README.md` 增加 SQLite 配置和使用说明 | `README.md` | 0.5h |
| T-007-17 | `docker-compose.yml` 无需变更（SQLite 为本地文件） | -- | 0h |

---

### T-008: 连接诊断工具（F-008）

| 属性 | 值 |
|------|-----|
| 所属功能 | F-008 |
| 预估工时 | 4h |
| 前置依赖 | T-006（错误信息增强后，诊断工具的错误提示更友好） |

**任务清单**:

| # | 任务 | 文件路径 | 工时 |
|---|------|----------|:----:|
| T-008-1 | 实现 `connection_diagnose` 工具逻辑：遍历连接、ping、获取版本、延迟 | `src/tools/connections.ts` | 1.5h |
| T-008-2 | 增加配置建议检测（未设 readonly、缺少 database 等） | `src/tools/connections.ts` | 0.5h |
| T-008-3 | 支持单连接和全连接诊断模式 | `src/tools/connections.ts` | 0.5h |
| T-008-4 | 新增连接诊断测试（5 个用例：单连接、全连接、不可达、建议生成） | `test/tools/connections.test.mjs` | 1.0h |
| T-008-5 | `README.md` 更新工具列表 | `README.md` | 0.5h |

---

### T-009: 缓存命中率统计（F-009）

| 属性 | 值 |
|------|-----|
| 所属功能 | F-009 |
| 预估工时 | 2h |
| 前置依赖 | 无 |

**任务清单**:

| # | 任务 | 文件路径 | 工时 |
|---|------|----------|:----:|
| T-009-1 | `QueryCache` 类增加 `hits`/`misses` 计数器 | `src/core/query-cache.ts` | 0.3h |
| T-009-2 | `sql_cache_stats` 工具返回命中率、条目数、容量、内存估算 | `src/tools/connections.ts` | 0.5h |
| T-009-3 | 缓存关闭时返回 `enabled: false` | `src/tools/connections.ts` | 0.2h |
| T-009-4 | 新增缓存统计测试（3 个用例：命中率计算、缓存关闭、容量统计） | `test/tools/connections.test.mjs` | 0.5h |
| T-009-5 | `README.md` 更新环境变量表 | `README.md` | 0.5h |

---

### T-010: 文档更新与发布准备

| 属性 | 值 |
|------|-----|
| 所属功能 | 发布 |
| 预估工时 | 3h |
| 前置依赖 | T-001 ~ T-009 全部完成 |

**任务清单**:

| # | 任务 | 文件路径 | 工时 |
|---|------|----------|:----:|
| T-010-1 | 更新 `CHANGELOG.md`：新增 v1.7.0 条目 | `CHANGELOG.md` | 0.5h |
| T-010-2 | 更新 `README.md`：工具总数从 82 更新为 92，新增 SQLite 章节 | `README.md` | 0.5h |
| T-010-3 | 重新生成 `API.md` | `API.md` | 0.3h |
| T-010-4 | 更新 `package.json` 版本号为 `1.7.0` | `package.json` | 0.1h |
| T-010-5 | 更新 CI 覆盖率门槛从 50% 提升至 60% | `.c8rc.json` | 0.1h |
| T-010-6 | 运行全量测试，确认 500+ 用例全部通过 | -- | 0.5h |
| T-010-7 | 运行 CI 检查（lint + test + coverage） | -- | 0.5h |
| T-010-8 | 本地 `npm pack` 验证打包产物 | -- | 0.3h |
| T-010-9 | 更新 `.env.example` 补充新增环境变量 | `.env.example` | 0.2h |

---

## 三、依赖关系

### 3.1 任务依赖图

```
T-001 (版本号) ──────────────────────────────┐
T-002 (脱敏修正) ────────────────────────────┤
T-003 (SQL helpers 去重) ──┬────────────────┤
                           │                │
T-004 (自动分页) ──────────┤                │
                           │                │
T-005 (redis_type) ────────┤                │
                           │                │
T-006 (错误信息增强) ──────┤────────────────┤
                           │                │
T-007 (SQLite) ────────────┘                │
                                             │
T-008 (连接诊断) ────────────────────────────┤
T-009 (缓存统计) ────────────────────────────┤
                                             │
T-010 (文档与发布) ◄─── T-001~T-009 全部完成 ┘
```

### 3.2 依赖关系详情

| 任务 | 前置依赖 | 原因 |
|------|----------|------|
| T-001 | 无 | 独立修复 |
| T-002 | 无 | 独立修复 |
| T-003 | 无 | 独立重构 |
| T-004 | T-003 | 自动分页需在去重后的 `sql.ts` 上修改，避免合并冲突 |
| T-005 | 无 | 独立优化 |
| T-006 | T-001 | 版本号修复后工具注册可能有变动，先稳定再改错误信息 |
| T-007 | T-003, T-004 | SQLite 驱动需复用共享 SQL helpers 和分页逻辑 |
| T-008 | T-006 | 诊断工具的错误提示依赖增强后的错误格式 |
| T-009 | 无 | 独立增强 |
| T-010 | T-001~T-009 | 文档和发布必须在所有功能完成后进行 |

### 3.3 可并行任务

以下任务之间无依赖，可并行开发：

- **并行组 A**（Day 1）: T-001 + T-002 + T-005 + T-009
- **并行组 B**（Day 2-3）: T-003 + T-006
- **并行组 C**（Day 4）: T-004 + T-008
- **串行**（Day 6-9）: T-007

---

## 四、时间安排

### 4.1 甘特图

```
Day  1  2  3  4  5  6  7  8  9  10
     ├──┼──┼──┼──┼──┼──┼──┼──┼──┤
T-001 ██
T-002 ██
T-005 ██
T-009 ██
T-003    ██
T-006    ██████
T-004          ██
T-008          ██
T-007             ██████████
T-010                      ████
```

### 4.2 每日详细安排

#### Day 1（5/6 周三）-- P0 修复 + 快速改进

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | T-001: 版本号统一管理 | `src/core/version.ts` + 测试通过 |
| 上午 | T-002: strict-v2 脱敏逻辑修正 | `data-masking.ts` 修正 + 测试通过 |
| 下午 | T-005: redis_type 使用原生 TYPE | `redis-driver.ts` + `redis.ts` 修正 |
| 下午 | T-009: 缓存命中率统计 | `query-cache.ts` 增强 + 测试 |

**验收检查点**: P0 修复完成，4 个快速改进全部通过测试

#### Day 2（5/7 周四）-- SQL 重构 + 错误信息

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | T-003: SQL 辅助函数去重 | `sql-helpers.ts` 新建 + 导入替换 |
| 下午 | T-006-1 ~ T-006-4: 错误信息增强（核心模块） | `error-codes.ts` + `connections.ts` + `sql.ts` |

**验收检查点**: SQL helpers 抽取完成，核心错误信息增强完成

#### Day 3（5/8 周五）-- 错误信息续 + 测试补充

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | T-006-5 ~ T-006-6: 错误信息增强（Redis/Mongo） | `redis.ts` + `mongo.ts` 错误增强 |
| 下午 | T-006-7 ~ T-006-8: 错误信息测试更新 + 新测试 | 所有测试通过 |

**验收检查点**: 错误信息增强全部完成，所有现有测试通过

#### Day 4（5/9 周六）-- 分页 + 诊断

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | T-004: sql_query 自动分页 | `applyPagination` + 环境变量 + 测试 |
| 下午 | T-008: 连接诊断工具 | `connection_diagnose` 工具 + 测试 |

**验收检查点**: 自动分页和连接诊断工具全部完成

#### Day 5（5/10 周日）-- P0/P1 回归验证

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | 全量回归测试：运行所有现有 442 个测试 + 新增测试 | 确认零回归 |
| 下午 | Code Review：审查 Day 1-4 的所有变更 | Review 意见记录 |

**验收检查点**: P0/P1 功能全部完成，零回归，Code Review 通过

#### Day 6（5/12 周一）-- SQLite 驱动层

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | T-007-1: 安装 better-sqlite3 依赖 | `package.json` 更新 |
| 上午 | T-007-2: EngineType 新增 sqlite | `types.ts` 更新 |
| 上午 | T-007-5: config.ts SQLite 配置解析 | `config.ts` 更新 |
| 下午 | T-007-3: 实现 SqliteDriver 核心（连接、查询、执行、关闭） | `sqlite-driver.ts` 基础完成 |
| 下午 | T-007-9: SQLite 文件不存在时自动创建 | 自动创建逻辑 |

**验收检查点**: SqliteDriver 可以连接 SQLite 文件并执行基本查询

#### Day 7（5/13 周二）-- SQLite 驱动层续

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | T-007-3（续）: SqliteDriver 事务支持、WAL 模式 | 事务 API 完成 |
| 上午 | T-007-4: SQLite 方言 SQL Guards 适配 | `sql-guards.ts` 更新 |
| 上午 | T-007-6: bootstrap.ts SQLite 连接创建 | `bootstrap.ts` 更新 |
| 下午 | T-007-10: SQLite 连接错误友好提示 | 错误处理完善 |
| 下午 | T-007-11: SQLite 驱动单元测试 | `sqlite-driver.test.mjs` |

**验收检查点**: SqliteDriver 完整实现，驱动单元测试全部通过

#### Day 8（5/14 周三）-- SQLite 工具层

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | T-007-7: 注册 9 个 SQLite 工具 | `sql.ts` 更新 |
| 上午 | T-007-8: schema_export 支持 SQLite | `schema.ts` 更新 |
| 下午 | T-007-12: SQLite 工具集成测试 | `sqlite.test.mjs` |
| 下午 | T-007-13: SQLite SQL 注入检测测试 | `sql-guards.test.mjs` 更新 |

**验收检查点**: 9 个 SQLite 工具全部可调用，集成测试通过

#### Day 9（5/15 周四）-- SQLite 收尾 + 测试加固

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | T-007-14: SQLite 只读连接保护测试 | 只读保护验证 |
| 上午 | T-007-15: .env.example 增加 SQLite 配置 | 配置示例 |
| 下午 | SQLite 全量测试运行 + 回归验证 | 所有测试通过 |
| 下午 | Code Review：审查 T-007 所有变更 | Review 意见记录 |

**验收检查点**: SQLite 引擎完整实现，所有测试通过，Code Review 通过

#### Day 10（5/16 周五）-- 文档更新与发布

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | T-010-1 ~ T-010-3: CHANGELOG + README + API.md | 文档更新完成 |
| 上午 | T-010-4 ~ T-010-5: package.json 版本 + CI 覆盖率门槛 | 配置更新完成 |
| 下午 | T-010-6 ~ T-010-7: 全量测试 + CI 检查 | CI 全绿 |
| 下午 | T-010-8 ~ T-010-9: npm pack 验证 + .env.example | 发布准备完成 |

**验收检查点**: v1.7.0 发布准备就绪，所有检查项通过

---

## 五、风险应对

### 5.1 风险登记表

| 编号 | 风险 | 概率 | 影响 | 等级 | 应对措施 | 负责人 |
|------|------|:----:|:----:|:----:|----------|:------:|
| R-001 | better-sqlite3 原生模块编译失败（Node.js ABI 不匹配、缺少编译工具链） | 中 | 高 | **高** | 见下方详细应对 | 开发 |
| R-002 | 自动分页与用户手写 LIMIT 冲突 | 中 | 中 | **中** | 检测 SQL 中已有 LIMIT 时不覆盖；提供 `DB_AUTO_PAGINATION=false` 环境变量关闭 | 开发 |
| R-003 | SQLite 并发写入锁冲突 | 低 | 中 | **中** | WAL 模式默认开启；文档说明单写多读限制；工具层可增加重试逻辑 | 开发 |
| R-004 | strict-v2 修正导致现有用户行为变化 | 低 | 中 | **中** | 这是 bug 修复，让行为符合文档描述；CHANGELOG 明确说明变更 | 产品 |
| R-005 | 版本号读取方式与 ESM/CJS 兼容 | 低 | 低 | **低** | 使用 `createRequire` 兼容 ESM，项目中已有先例 | 开发 |
| R-006 | 10 个工作日工期紧张 | 中 | 中 | **中** | SQLite 作为 P2 可降级为仅核心表操作（砍掉 schema_export 适配）；其余功能按优先级裁剪 | PM |
| R-007 | 自动分页的 Oracle 分页语法复杂 | 低 | 低 | **低** | Oracle 使用 `OFFSET ... ROWS FETCH NEXT ... ROWS ONLY`（12c+），文档注明最低版本要求 | 开发 |

### 5.2 R-001 better-sqlite3 编译风险详细应对

**预防措施**:

1. **设为 optional 依赖**: 在 `package.json` 中将 `better-sqlite3` 放入 `optionalDependencies`，编译失败时不阻塞安装
2. **运行时检测**: 在 `bootstrap.ts` 中使用动态 `import()` 加载 `better-sqlite3`，失败时给出友好错误信息
3. **文档说明系统要求**: 在 README 中注明需要 Node.js 18+ 和 C++ 编译工具链（`node-gyp`、Python、make/g++）
4. **CI 多平台测试**: CI 中增加 Windows/macOS/Linux 三平台编译测试

**降级方案**:

如果 `better-sqlite3` 编译问题无法在迭代内解决:
1. 替换为 `sql.js`（纯 WASM 实现，无需原生编译）
2. 性能会有所下降，但兼容性更好
3. 需要额外 2h 进行驱动层替换

**应急方案**:

如果 SQLite 引擎在 Day 9 仍无法稳定:
1. 将 SQLite 引擎标记为 `experimental`，在文档中说明
2. 或推迟到 v1.7.1 补丁版本发布
3. P0/P1 功能照常发布为 v1.7.0

---

## 六、回滚方案

### 6.1 功能级回滚策略

| 功能 | 回滚方式 | 影响范围 | 回滚成本 |
|------|----------|----------|:--------:|
| F-001 版本号统一 | 还原 `server.ts` 和 `connections.ts` 中的硬编码版本号 | 版本号显示 | 5min |
| F-002 strict-v2 修正 | 还原 `data-masking.ts` 中三个模式函数 | 脱敏行为 | 5min |
| F-003 SQL helpers 去重 | 还原 `sql.ts` 和 `advisor.ts` 中的内联实现 | 功能无变化 | 10min |
| F-004 自动分页 | 移除 `applyPagination` 调用，保留 `page`/`page_size` 元数据计算 | 分页行为 | 10min |
| F-005 redis_type | 还原 `redis.ts` 中的多命令推断逻辑 | 类型检测 | 5min |
| F-006 错误信息增强 | 还原错误消息格式 | 错误提示 | 15min |
| F-007 SQLite 引擎 | 移除 `sqlite-driver.ts`，从 `types.ts` 移除 `sqlite` 类型，从 `bootstrap.ts` 移除 SQLite 分支 | SQLite 功能完全移除 | 20min |
| F-008 连接诊断 | 移除 `connection_diagnose` 工具注册 | 诊断功能 | 5min |
| F-009 缓存统计 | 还原 `query-cache.ts` 的计数器和 `sql_cache_stats` 返回值 | 统计字段 | 5min |

### 6.2 发布级回滚方案

**场景 1: v1.7.0 发布后发现严重 bug**

```
1. npm unpublish @yclenove/polyglot-db-mcp-server@1.7.0
2. 修复 bug
3. 重新发布为 v1.7.1
4. 用户可通过 npm install @yclenove/polyglot-db-mcp-server@1.6.0 回退
```

**场景 2: SQLite 引擎不稳定**

```
1. 将 SQLite 相关工具标记为 experimental
2. 在 SQLite 驱动的 connect() 中增加警告日志
3. 不影响其他引擎的正常使用
4. 下个版本修复后移除 experimental 标记
```

**场景 3: 自动分页导致查询异常**

```
1. 用户设置 DB_AUTO_PAGINATION=false 关闭自动分页
2. 下个版本修复分页逻辑
3. 无需回滚整个版本
```

### 6.3 向后兼容性保证

| 变更点 | 兼容性 | 说明 |
|--------|:------:|------|
| 版本号从 1.4.0 变为 1.7.0 | 兼容 | 修复 bug，不影响 API |
| strict-v2 行为修正 | 兼容 | 让行为与文档描述一致 |
| 自动分页 | 兼容 | 新增行为，可通过环境变量关闭 |
| redis_type 返回值 | 兼容 | 返回值类型不变，仅实现方式优化 |
| 错误信息增加 hint 字段 | 兼容 | 新增字段，不影响现有解析 |
| SQLite 引擎 | 兼容 | 新增引擎，不影响现有配置 |
| 缓存统计增加字段 | 兼容 | 新增字段，不影响现有解析 |

---

## 七、验收检查点

### 7.1 每日验收标准

#### Day 1 检查点（5/6）

- [ ] `server_info` 返回版本号与 `package.json` 一致
- [ ] `McpServer` 构造函数版本号与 `package.json` 一致
- [ ] 无其他硬编码版本号点（全局搜索确认）
- [ ] strict 模式: 字段名匹配+值不匹配 -> 仍然脱敏
- [ ] strict-v2 模式: 字段名匹配+值不匹配 -> 不脱敏
- [ ] loose 模式: 字段名不匹配+值匹配 -> 脱敏
- [ ] `redis_type` 使用原生 `TYPE` 命令，正确返回所有类型
- [ ] `sql_cache_stats` 返回 `hits`、`misses`、`hitRate` 字段
- [ ] 所有新增测试通过
- [ ] 现有 442 个测试全部通过（零回归）

#### Day 2 检查点（5/7）

- [ ] `src/core/sql-helpers.ts` 导出 `describeTableSql` 和 `listIndexesSql`
- [ ] `sql.ts` 和 `advisor.ts` 均从共享模块导入，无重复实现
- [ ] 错误格式统一为 `{ message, code, hint }`
- [ ] `未知 connection_id` 错误包含可用 ID 列表
- [ ] `非 SQL 连接` 错误包含当前连接类型
- [ ] 现有测试全部通过

#### Day 3 检查点（5/8）

- [ ] `只读连接` 错误包含修改建议
- [ ] Redis 连接错误包含上下文信息
- [ ] MongoDB 连接错误包含上下文信息
- [ ] 所有现有测试中对错误消息的断言已更新
- [ ] 新增 8 个错误信息测试用例全部通过
- [ ] 现有测试全部通过

#### Day 4 检查点（5/9）

- [ ] `SELECT * FROM users` + `page=2, page_size=10` -> 自动追加 `LIMIT 10 OFFSET 10`
- [ ] `SELECT * FROM users LIMIT 5` + `page=2, page_size=10` -> 不覆盖原有 LIMIT
- [ ] MySQL、PostgreSQL、MSSQL、Oracle 四种方言的 LIMIT/OFFSET 语法正确
- [ ] `DB_AUTO_PAGINATION=false` 时行为与当前版本一致
- [ ] `connection_diagnose` 不传参数时诊断所有连接
- [ ] `connection_diagnose` 传 `connection_id` 时仅诊断指定连接
- [ ] 不可达连接返回明确的错误原因和解决建议
- [ ] 现有测试全部通过

#### Day 5 检查点（5/10）-- P0/P1 里程碑

- [ ] P0 修复 100% 完成（版本号 + 脱敏修正）
- [ ] P1 改进 100% 完成（SQL helpers + 分页 + redis_type + 错误信息）
- [ ] 全量测试通过（442 + 新增测试）
- [ ] Code Review 通过，无遗留问题
- [ ] CI 全绿
- [ ] 工具总数达到 83 个（+1 connection_diagnose，SQLite 尚未加入）

#### Day 6 检查点（5/12）

- [ ] `better-sqlite3` 依赖安装成功，编译通过
- [ ] `EngineType` 包含 `'sqlite'`
- [ ] `config.ts` 正确解析 `engine: 'sqlite'` 配置
- [ ] `SqliteDriver` 可以连接 SQLite 文件
- [ ] SQLite 文件不存在时自动创建
- [ ] 基本查询（`SELECT 1`）可以执行

#### Day 7 检查点（5/13）

- [ ] SQLite 事务支持正常（BEGIN/COMMIT/ROLLBACK）
- [ ] WAL 模式默认开启
- [ ] SQLite SQL Guards 适配完成
- [ ] `bootstrap.ts` 正确创建 SQLite 连接
- [ ] SQLite 驱动单元测试全部通过
- [ ] SQLite 连接错误提示友好

#### Day 8 检查点（5/14）

- [ ] 9 个 SQLite 工具全部可调用
- [ ] `sqlite_query` 正确执行只读查询
- [ ] `sqlite_execute` 正确执行写操作
- [ ] `sqlite_list_tables` 返回所有用户表
- [ ] `sqlite_describe_table` 返回列名、类型、是否可空、主键信息
- [ ] `schema_export` 支持 SQLite 方言
- [ ] SQLite 工具集成测试全部通过
- [ ] SQLite SQL 注入检测测试通过

#### Day 9 检查点（5/15）-- SQLite 里程碑

- [ ] SQLite 只读连接保护生效
- [ ] `.env.example` 包含 SQLite 配置示例
- [ ] SQLite 全量测试通过（驱动 + 工具 + 注入 + 只读）
- [ ] 全量回归测试通过（所有现有测试 + 所有新增测试）
- [ ] Code Review 通过
- [ ] 工具总数达到 92 个（+9 SQLite + 1 diagnose）

#### Day 10 检查点（5/16）-- 发布里程碑

- [ ] `CHANGELOG.md` 包含 v1.7.0 条目，内容完整
- [ ] `README.md` 工具总数为 92，包含 SQLite 配置示例
- [ ] `API.md` 已重新生成，包含所有新工具
- [ ] `package.json` 版本号为 `1.7.0`
- [ ] CI 覆盖率门槛为 60%
- [ ] 全量测试通过（500+ 用例）
- [ ] CI 全绿（lint + test + coverage）
- [ ] `npm pack` 产物正常
- [ ] `.env.example` 包含所有新增环境变量

### 7.2 最终发布检查清单

- [ ] 所有 P0/P1/P2 功能开发完成
- [ ] 所有测试通过（500+ 用例）
- [ ] CI 覆盖率 >= 60%
- [ ] CHANGELOG.md 更新
- [ ] README.md 更新（工具总数、SQLite 配置示例）
- [ ] API.md 重新生成
- [ ] package.json 版本号更新为 1.7.0
- [ ] 零 breaking change 确认
- [ ] 向后兼容性验证
- [ ] npm publish 发布

---

## 附录

### A. 新增文件清单

| 文件 | 说明 |
|------|------|
| `src/core/version.ts` | 版本号统一管理 |
| `src/core/sql-helpers.ts` | SQL 辅助函数共享模块 |
| `src/drivers/sql/sqlite-driver.ts` | SQLite 驱动 |
| `test/version.test.mjs` | 版本号一致性测试 |
| `test/sql-helpers.test.mjs` | SQL 辅助函数测试 |
| `test/drivers/sqlite-driver.test.mjs` | SQLite 驱动测试 |
| `test/tools/sqlite.test.mjs` | SQLite 工具集成测试 |
| `test/tools/error-hints.test.mjs` | 错误信息增强测试 |

### B. 修改文件清单

| 文件 | 变更内容 |
|------|----------|
| `src/server.ts` | 版本号改为动态读取 |
| `src/tools/connections.ts` | 版本号动态读取 + 诊断工具 + 错误增强 |
| `src/core/data-masking.ts` | strict-v2/loose 模式修正 |
| `src/core/sql-guards.ts` | SQLite 方言适配 |
| `src/core/types.ts` | 新增 sqlite 引擎类型 |
| `src/core/config.ts` | SQLite 配置解析 + DB_AUTO_PAGINATION |
| `src/core/query-cache.ts` | 命中率统计 |
| `src/bootstrap.ts` | SQLite 连接创建 |
| `src/tools/sql.ts` | 自动分页 + SQLite 注册 + SQL helpers 导入 |
| `src/tools/redis.ts` | redis_type 优化 + 错误增强 |
| `src/tools/mongo.ts` | 错误增强 |
| `src/tools/advisor.ts` | 改用共享 SQL helpers |
| `src/tools/schema.ts` | schema_export 支持 SQLite |
| `src/drivers/redis/redis-driver.ts` | 新增 type(key) 方法 |
| `package.json` | 新增 better-sqlite3 依赖 + 版本号 1.7.0 |
| `.c8rc.json` | 覆盖率门槛 60% |
| `.env.example` | 新增 SQLite 配置 + DB_AUTO_PAGINATION |
| `CHANGELOG.md` | v1.7.0 条目 |
| `README.md` | 工具总数 + SQLite 章节 |
| `API.md` | 重新生成 |

### C. 工具总数预估

| 类别 | 当前 | 新增 | v1.7.0 |
|------|:----:|:----:|:------:|
| 连接管理 | 7 | +1 (diagnose) | 8 |
| SQL | 17 | 0 (SQLite 复用) | 17 |
| SQLite | 0 | +9 | 9 |
| MongoDB | 17 | 0 | 17 |
| Redis | 22 | 0 | 22 |
| 审计 | 4 | 0 | 4 |
| Schema | 1 | 0 | 1 |
| 脱敏 | 3 | 0 | 3 |
| 回放 | 3 | 0 | 3 |
| 建议 | 2 | 0 | 2 |
| 缓存 | 1 | 0 | 1 |
| **合计** | **82** | **+10** | **92** |

### D. 测试用例预估

| 模块 | 新增测试 | 类型 |
|------|----------|------|
| 版本号一致性 | 3 | 单元测试 |
| strict-v2 脱敏 | 6 | 单元测试 |
| SQL 辅助函数 | 8 | 单元测试 |
| 自动分页 | 10 | 单元测试 |
| redis_type | 5 | 单元测试 |
| 错误信息 | 8 | 单元测试 |
| SQLite 驱动 | 15 | 单元测试 |
| SQLite 集成 | 10 | 集成测试 |
| 连接诊断 | 5 | 单元测试 |
| 缓存统计 | 3 | 单元测试 |
| **合计** | **73** | |

**v1.7.0 测试用例总数**: 442 + 73 = **515 个**

---

*文档结束 | 编制人: 迭代规划师 | 编制日期: 2026-05-05*
