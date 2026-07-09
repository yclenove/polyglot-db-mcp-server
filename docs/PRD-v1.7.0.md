# PRD: polyglot-db-mcp-server v1.7.0

**文档编号**: PRD-v1.7.0
**版本**: 1.0
**日期**: 2026-05-05
**作者**: 产品经理
**状态**: 待评审

---

## 一、迭代目标

### 1.1 核心目标

v1.7.0 聚焦于**质量修复 + 体验增强 + 引擎扩展**三个维度：

1. **修复 P0 缺陷**：版本号硬编码和 strict-v2 脱敏逻辑缺陷，消除生产环境中的正确性风险
2. **增强开发者体验**：自动分页、错误信息优化、代码去重，降低用户使用门槛
3. **补齐 SQLite 引擎**：覆盖轻量级本地开发场景，与竞品 DBHub 正面对标

### 1.2 成功指标

| 指标 | 目标值 |
|------|--------|
| P0 缺陷修复率 | 100% |
| 工具总数 | 从 82 个增至 91 个（+9） |
| 测试用例数 | 从 442 个增至 500+ 个 |
| CI 覆盖率门槛 | 从 50% 提升至 60% |
| 向后兼容性 | 零 breaking change |

### 1.3 迭代周期

- **计划周期**: 2026-05-06 ~ 2026-05-19（10 个工作日）
- **里程碑**:
  - Day 1-2: P0 修复 + 测试验证
  - Day 3-5: P1 改进（代码去重、分页、Redis TYPE、错误信息）
  - Day 6-9: SQLite 引擎支持（驱动 + 工具 + 测试）
  - Day 10: 文档更新 + 发布准备

---

## 二、功能清单

### 2.1 P0 -- 缺陷修复（必须完成）

#### F-001: 版本号统一管理

| 属性 | 值 |
|------|-----|
| 优先级 | P0 |
| 预估工时 | 1h |
| 负责模块 | `src/server.ts`, `src/tools/connections.ts` |
| 来源 | 侦察报告 #1, 反馈 P0-1 |

**问题描述**: `server.ts:14` 和 `connections.ts:276` 中版本号硬编码为 `'1.4.0'`，而 `package.json` 已是 `1.6.0`。`server_info` 工具返回错误版本号，误导用户。

**修复方案**: 从 `package.json` 动态读取版本号，消除所有硬编码。

**验收标准**:
- [ ] `server_info` 工具返回的版本号与 `package.json` 一致
- [ ] `McpServer` 构造函数使用的版本号与 `package.json` 一致
- [ ] 版本号仅在 `package.json` 中维护，无其他硬编码点
- [ ] 新增单元测试验证版本号一致性

---

#### F-002: strict-v2 脱敏逻辑修正

| 属性 | 值 |
|------|-----|
| 优先级 | P0 |
| 预估工时 | 2h |
| 负责模块 | `src/core/data-masking.ts` |
| 来源 | 侦察报告 #2, 反馈分析 |

**问题描述**: `applyStrictV2Mode`（第 187-202 行）与 `applyLooseMode`（第 204-218 行）的实现逻辑完全相同——都调用 `shouldMaskField` + `maskValue`。这意味着配置 `strict-v2` 与 `loose` 行为无差异，违反了设计意图。

**设计意图澄清**:

| 模式 | 字段名匹配 | 值正则匹配 | 脱敏行为 |
|------|:----------:|:----------:|----------|
| strict | 匹配 | 不检查 | 直接脱敏（宁可多脱不漏脱） |
| strict-v2 | 匹配 | 必须匹配 | 双重校验才脱敏（精确脱敏） |
| loose | 不检查 | 必须匹配 | 仅按值模式脱敏（宽泛脱敏） |

**修复方案**: 重写三个模式函数，使行为差异清晰可辨：
- `applyStrictMode`: 仅检查字段名，匹配即脱敏（当前实现正确，保持不变）
- `applyStrictV2Mode`: 字段名匹配 AND 值正则匹配才脱敏（当前逻辑正确但需增加注释和测试覆盖）
- `applyLooseMode`: 不检查字段名，仅按值正则匹配脱敏（需修复，当前实现错误地检查了字段名）

**验收标准**:
- [ ] strict 模式: 字段名匹配但值不符合正则 -> 仍然脱敏
- [ ] strict-v2 模式: 字段名匹配且值符合正则 -> 脱敏；字段名匹配但值不符合正则 -> 不脱敏
- [ ] loose 模式: 字段名不匹配但值符合正则 -> 脱敏
- [ ] 新增至少 6 个测试用例覆盖三种模式的差异行为
- [ ] 现有 `strict-v2.test.mjs` 和 `masking-rules.test.mjs` 全部通过

---

### 2.2 P1 -- 体验增强（重要改进）

#### F-003: SQL 辅助函数去重

| 属性 | 值 |
|------|-----|
| 优先级 | P1 |
| 预估工时 | 2h |
| 负责模块 | `src/core/sql-helpers.ts`（新建）, `src/tools/sql.ts`, `src/tools/advisor.ts` |
| 来源 | 侦察报告 #3 |

**问题描述**: `describeTableSql` 和 `listIndexesSql` 函数在 `sql.ts` 和 `advisor.ts` 中各有一份几乎相同的实现，维护成本高，修改一处易遗漏另一处。

**修复方案**: 抽取到 `src/core/sql-helpers.ts` 共享模块，两个文件改为导入使用。

**验收标准**:
- [ ] `src/core/sql-helpers.ts` 导出 `describeTableSql` 和 `listIndexesSql`
- [ ] `sql.ts` 和 `advisor.ts` 均从共享模块导入，不再有重复实现
- [ ] 现有 `sql.test.mjs` 和相关测试全部通过
- [ ] 新增 `sql-helpers.test.mjs` 覆盖共享函数

---

#### F-004: sql_query 自动分页

| 属性 | 值 |
|------|-----|
| 优先级 | P1 |
| 预估工时 | 3h |
| 负责模块 | `src/tools/sql.ts` |
| 来源 | 侦察报告 #5, 反馈 P1-1 |

**问题描述**: `sql_query` 的 `page` 和 `page_size` 参数仅用于计算元数据（总页数、当前页码），但不会自动追加 `LIMIT/OFFSET` 到 SQL 中。用户需要自己在 SQL 中写分页逻辑，与参数的直觉含义不符。

**修复方案**:
1. 当用户传入 `page` + `page_size` 且 SQL 中未包含 `LIMIT` 时，自动追加 `LIMIT {page_size} OFFSET {(page-1) * page_size}`
2. 当 SQL 中已包含 `LIMIT` 时，不覆盖，仅更新元数据
3. 添加环境变量 `DB_AUTO_PAGINATION`（默认 `true`），允许用户关闭自动分页

**验收标准**:
- [ ] `SELECT * FROM users` + `page=2, page_size=10` -> 自动追加 `LIMIT 10 OFFSET 10`
- [ ] `SELECT * FROM users LIMIT 5` + `page=2, page_size=10` -> 不覆盖原有 LIMIT
- [ ] 返回的元数据包含 `page`、`pageSize`、`totalPages`、`hasMore` 字段
- [ ] `DB_AUTO_PAGINATION=false` 时行为与当前版本一致
- [ ] MySQL、PostgreSQL、MSSQL、Oracle 四种方言的 LIMIT/OFFSET 语法正确
- [ ] 新增至少 8 个测试用例

---

#### F-005: redis_type 使用原生 TYPE 命令

| 属性 | 值 |
|------|-----|
| 优先级 | P1 |
| 预估工时 | 1h |
| 负责模块 | `src/tools/redis.ts`, `src/drivers/redis/redis-driver.ts` |
| 来源 | 侦察报告 #4, 反馈 P0-2 |

**问题描述**: `redis_type` 工具通过分别调用 `get`、`hgetall`、`llen`、`scard` 四个命令推断类型，效率低（4 次网络往返），且无法检测 Sorted Set (zset) 类型。

**修复方案**: 使用 Redis 原生 `TYPE` 命令，单次调用即可返回准确类型（string/hash/list/set/zset/none/stream）。

**验收标准**:
- [ ] `redis_type` 工具使用原生 `TYPE` 命令，仅 1 次网络往返
- [ ] 正确返回所有 Redis 数据类型：string, hash, list, set, zset, stream, none
- [ ] `RedisDriver` 接口新增 `type(key)` 方法
- [ ] 新增测试用例覆盖各类型检测

---

#### F-006: 错误信息增强

| 属性 | 值 |
|------|-----|
| 优先级 | P1 |
| 预估工时 | 4h |
| 负责模块 | `src/tools/*.ts`, `src/core/error-codes.ts` |
| 来源 | 反馈分析 2.2 |

**问题描述**: 部分错误信息过于简洁，缺乏上下文和解决建议。典型场景：
- `未知 connection_id: xxx` 未提示可用的连接 ID 列表
- `非 SQL 连接` 未说明当前连接的实际类型
- `该连接为只读` 未说明如何修改为可写

**修复方案**: 在错误消息中增加 `hint` 字段，提供可用选项和建议操作。

**验收标准**:
- [ ] `未知 connection_id` 错误包含可用 ID 列表：`可用连接: [pg, my, rd]`
- [ ] `非 SQL 连接` 错误包含当前连接类型：`当前连接类型: redis`
- [ ] `只读连接` 错误包含修改建议：`如需写入，请将连接配置中的 readonly 设为 false`
- [ ] 错误格式统一：`{ message, code, hint }`
- [ ] 现有测试中对错误消息的断言更新

---

### 2.3 P2 -- 新功能（竞争力特性）

#### F-007: SQLite 引擎支持

| 属性 | 值 |
|------|-----|
| 优先级 | P2 |
| 预估工时 | 16h |
| 负责模块 | `src/drivers/sql/sqlite-driver.ts`, `src/tools/sql.ts`, `src/core/types.ts` |
| 来源 | 侦察报告 5.2, 竞品分析 |
| 竞争对标 | DBHub (bytebase), mcp-databases (cyanheads) |

**用户故事**: 作为 AI Agent 用户，我希望在本地开发和测试时使用 SQLite 数据库文件，无需启动完整的数据库服务器，以便快速验证 SQL 查询和数据操作。

**功能描述**:

新增第 7 个数据库引擎 `sqlite`，支持 `.db` / `.sqlite` / `.sqlite3` 文件。配置方式：

```json
{
  "id": "local",
  "engine": "sqlite",
  "url": "file:./data/local.db"
}
```

**新增工具**（9 个）:

| 工具 | 说明 |
|------|------|
| `sqlite_query` | 只读查询（自动路由到 sql_query） |
| `sqlite_execute` | 可写执行（自动路由到 sql_execute） |
| `sqlite_list_tables` | 列出表 |
| `sqlite_describe_table` | 表结构 |
| `sqlite_list_indexes` | 列出索引 |
| `sqlite_create_index` | 创建索引 |
| `sqlite_begin_transaction` | 开始事务 |
| `sqlite_commit` | 提交事务 |
| `sqlite_rollback` | 回滚事务 |

注：SQLite 工具实际上是现有 SQL 工具的路由别名，核心逻辑复用 `sql.ts`，仅在驱动层新增 SQLite 实现。

**技术方案**:
1. 新增 `src/drivers/sql/sqlite-driver.ts`，使用 `better-sqlite3` 同步驱动
2. `src/core/types.ts` 的 `EngineType` 联合类型新增 `'sqlite'`
3. `src/core/config.ts` 支持 `engine: 'sqlite'` 配置解析
4. `src/tools/sql.ts` 的 `registerSqlTools` 自动注册 SQLite 工具
5. `src/bootstrap.ts` 支持 SQLite 连接创建

**依赖变更**:
- 新增 `better-sqlite3` 依赖
- 新增 `@types/better-sqlite3` 开发依赖

**验收标准**:
- [ ] `engine: 'sqlite'` 配置正确解析
- [ ] SQLite 文件不存在时自动创建
- [ ] `sqlite_query` 正确执行只读查询
- [ ] `sqlite_execute` 正确执行写操作
- [ ] `sqlite_list_tables` 返回所有用户表
- [ ] `sqlite_describe_table` 返回列名、类型、是否可空、主键信息
- [ ] 事务支持正常工作
- [ ] SQL 注入检测对 SQLite 方言生效
- [ ] 只读连接保护生效
- [ ] 新增单元测试 + 集成测试（至少 20 个用例）
- [ ] `schema_export` 工具支持 SQLite
- [ ] README.md 和 API.md 更新

---

#### F-008: 连接诊断工具

| 属性 | 值 |
|------|-----|
| 优先级 | P2 |
| 预估工时 | 4h |
| 负责模块 | `src/tools/connections.ts` |
| 来源 | 反馈分析 2.1, 2.3 |

**用户故事**: 作为首次使用的开发者，我希望有一个统一的诊断工具帮我检查所有连接的健康状况和配置问题，以便快速排查连接故障。

**功能描述**:

新增 `connection_diagnose` 工具，对所有已配置连接执行全面诊断：

```json
{
  "tool": "connection_diagnose",
  "params": { "connection_id": "pg" }  // 可选，不传则诊断所有连接
}
```

返回内容：
- 连接状态（可达/不可达）
- 响应延迟（ms）
- 服务器版本信息
- 连接池状态（活跃连接数、空闲连接数）
- 配置建议（如：检测到未设 readonly、缺少 database 等）

**验收标准**:
- [ ] 不传 `connection_id` 时诊断所有连接
- [ ] 传 `connection_id` 时仅诊断指定连接
- [ ] 返回结构化诊断报告：状态、延迟、版本、建议
- [ ] 不可达连接返回明确的错误原因和解决建议
- [ ] 新增至少 5 个测试用例

---

#### F-009: 缓存命中率统计

| 属性 | 值 |
|------|-----|
| 优先级 | P2 |
| 预估工时 | 2h |
| 负责模块 | `src/core/query-cache.ts`, `src/tools/connections.ts` |
| 来源 | 反馈 P1-3 |

**用户故事**: 作为性能调优的开发者，我希望查看查询缓存的命中率和使用情况，以便评估缓存配置是否合理。

**功能描述**: 增强 `sql_cache_stats` 工具，返回：
- 缓存命中次数 / 未命中次数 / 命中率
- 当前缓存条目数 / 最大容量
- 缓存总内存占用估算
- 最近被驱逐的查询摘要

**验收标准**:
- [ ] `sql_cache_stats` 返回 `hits`、`misses`、`hitRate` 字段
- [ ] 命中率计算准确（hits / (hits + misses)）
- [ ] 缓存关闭时返回 `enabled: false`，不报错
- [ ] 新增至少 3 个测试用例

---

## 三、不纳入范围

以下功能经评估后**不纳入 v1.7.0**，列入后续版本规划：

| 功能 | 原因 | 建议版本 |
|------|------|----------|
| Streamable HTTP 传输 | MCP SDK 支持尚不成熟，需更多调研 | v1.8.0 |
| OAuth 2.1 认证 | 企业级特性，设计复杂度高 | v2.0.0 |
| RBAC 细粒度权限 | 需要权限模型设计，工作量大 | v2.0.0 |
| MongoDB 多文档事务 | 需要会话管理重构 | v1.8.0 |
| Redis 管道支持 | 与当前工具模型不兼容 | v1.8.0 |
| 数据导出 (CSV/Excel) | 非核心路径，优先级不足 | v1.9.0 |
| DuckDB 引擎支持 | 与 SQLite 定位重叠 | v2.0.0 |
| README_en.md 同步 | 文档工作，不阻塞发布 | v1.7.1 |

---

## 四、用户故事

### 4.1 P0 修复相关

**US-001: 准确的版本信息**
> 作为运维人员，我希望 `server_info` 返回准确的版本号，以便确认当前运行的版本并与部署记录比对。

**US-002: 可靠的数据脱敏**
> 作为数据安全负责人，我配置了 `strict-v2` 脱敏模式，期望它比 `loose` 模式更精确——只在字段名和值都匹配时才脱敏，避免误脱敏导致数据不可用。

### 4.2 体验增强相关

**US-003: 无感分页**
> 作为 AI Agent，我希望传入 `page` 和 `page_size` 参数就能自动获得分页结果，无需在 SQL 中手动拼写 `LIMIT/OFFSET`。

**US-004: 快速定位问题**
> 作为首次使用的开发者，当工具调用报错时，我希望错误信息中包含可用选项和修复建议，以便自行排查而无需翻阅文档。

**US-005: 准确的类型检测**
> 作为 Redis 用户，我希望 `redis_type` 能正确检测所有数据类型（包括 Sorted Set），且响应尽可能快。

### 4.3 新功能相关

**US-006: 本地 SQLite 开发**
> 作为 AI Agent 用户，我希望直接操作本地 SQLite 文件进行开发和测试，无需额外安装和配置数据库服务器。

**US-007: 一键诊断**
> 作为新用户，我希望运行一个诊断工具就能了解所有连接的状态和潜在问题，快速上手。

**US-008: 缓存调优**
> 作为性能敏感的用户，我希望查看缓存命中率来评估当前缓存配置是否合理，必要时调整 TTL 和容量。

---

## 五、技术方案概要

### 5.1 版本号统一（F-001）

```typescript
// src/core/version.ts (新建)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { version } = require('../../package.json');
export const APP_VERSION = version;
```

`server.ts` 和 `connections.ts` 改为 `import { APP_VERSION } from '../core/version.js'`。

### 5.2 strict-v2 脱敏修正（F-002）

```typescript
// 修正后的三种模式对比
function applyStrictMode(row, config) {
  // strict: 字段名匹配即脱敏，不检查值
  for (const [key, value] of Object.entries(row)) {
    const rule = shouldMaskField(key, config.excludeFields, config.rules);
    result[key] = rule ? rule.mask(String(value)) : value;
  }
}

function applyStrictV2Mode(row, config) {
  // strict-v2: 字段名匹配 AND 值正则匹配才脱敏
  for (const [key, value] of Object.entries(row)) {
    const rule = shouldMaskField(key, config.excludeFields, config.rules);
    result[key] = (rule && valueMatchesPattern(value, rule))
      ? rule.mask(String(value))
      : value;
  }
}

function applyLooseMode(row, config) {
  // loose: 不检查字段名，仅按值正则匹配脱敏
  for (const [key, value] of Object.entries(row)) {
    result[key] = matchAnyValueRule(value, config.rules, config.excludeFields)
      ? applyMask(value, matchedRule)
      : value;
  }
}
```

### 5.3 自动分页（F-004）

在 `sql_query` 工具的 SQL 预处理阶段增加分页逻辑：

```typescript
function applyPagination(sql: string, page: number, pageSize: number, dialect: string): string {
  if (/LIMIT\s+\d+/i.test(sql)) return sql; // 已有 LIMIT 则不覆盖
  const offset = (page - 1) * pageSize;
  switch (dialect) {
    case 'mysql':
    case 'postgres':
      return `${sql} LIMIT ${pageSize} OFFSET ${offset}`;
    case 'mssql':
      return `${sql} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
    case 'oracle':
      return `SELECT * FROM (${sql}) WHERE ROWNUM <= ${offset + pageSize} OFFSET ${offset} ROWS`;
  }
}
```

### 5.4 SQLite 驱动（F-007）

```
src/drivers/sql/sqlite-driver.ts
  - SqliteDriver implements SqlDriver
  - 使用 better-sqlite3（同步 API，高性能）
  - 文件路径通过 url 解析：file:./path/to/db.sqlite
  - WAL 模式默认开启（并发读性能优化）
```

---

## 六、测试计划

### 6.1 测试范围

| 模块 | 新增测试 | 类型 |
|------|----------|------|
| 版本号一致性 | 3 个 | 单元测试 |
| strict-v2 脱敏 | 6 个 | 单元测试 |
| SQL 辅助函数 | 8 个 | 单元测试 |
| 自动分页 | 10 个 | 单元测试 |
| redis_type | 5 个 | 单元测试 |
| 错误信息 | 8 个 | 单元测试 |
| SQLite 驱动 | 15 个 | 单元测试 |
| SQLite 集成 | 10 个 | 集成测试 |
| 连接诊断 | 5 个 | 单元测试 |
| 缓存统计 | 3 个 | 单元测试 |
| **合计** | **73 个** | |

### 6.2 测试策略

- **单元测试**: 使用 `node:test` 框架，mock 驱动层依赖
- **集成测试**: 使用 Docker 环境中的 SQLite 文件（无需外部服务）
- **回归测试**: 确保现有 442 个测试全部通过
- **覆盖率**: 目标 CI 门槛从 50% 提升至 60%

---

## 七、风险评估

### 7.1 风险矩阵

| 风险 | 概率 | 影响 | 等级 | 缓解措施 |
|------|:----:|:----:|:----:|----------|
| better-sqlite3 原生模块编译失败 | 中 | 高 | **高** | 设为 optional 依赖，编译失败时优雅降级；文档说明系统要求 |
| 自动分页与用户手写 LIMIT 冲突 | 中 | 中 | **中** | 检测 SQL 中已有 LIMIT 时不覆盖；提供环境变量关闭 |
| SQLite 并发写入锁冲突 | 低 | 中 | **中** | WAL 模式 + 文档说明单写多读限制 |
| strict-v2 修正导致现有用户行为变化 | 低 | 中 | **中** | 实际上是修复 bug，让行为符合文档描述；CHANGELOG 明确说明 |
| 版本号读取方式与 ESM/CJS 兼容 | 低 | 低 | **低** | 使用 `createRequire` 兼容 ESM，已有先例 |
| 1-2 周工期紧张 | 中 | 中 | **中** | SQLite 作为 P2，可降级为仅核心表操作；其余功能按优先级裁剪 |

### 7.2 向后兼容性保证

| 变更点 | 兼容性 | 说明 |
|--------|:------:|------|
| 版本号从 1.4.0 变为 1.7.0 | 兼容 | 修复 bug，不影响 API |
| strict-v2 行为修正 | 兼容 | 让行为与文档描述一致 |
| 自动分页 | 兼容 | 新增行为，可通过 `DB_AUTO_PAGINATION=false` 关闭 |
| redis_type 返回值 | 兼容 | 返回值类型不变，仅实现方式优化 |
| 错误信息增加 hint 字段 | 兼容 | 新增字段，不影响现有解析 |
| SQLite 引擎 | 兼容 | 新增引擎，不影响现有配置 |
| 缓存统计增加字段 | 兼容 | 新增字段，不影响现有解析 |

---

## 八、发布计划

### 8.1 版本号

`1.6.0` -> `1.7.0`（minor 版本升级，含新功能）

### 8.2 发布清单

- [ ] 所有 P0/P1/P2 功能开发完成
- [ ] 所有测试通过（500+ 用例）
- [ ] CI 覆盖率 >= 60%
- [ ] CHANGELOG.md 更新
- [ ] README.md 更新（工具总数、SQLite 配置示例）
- [ ] API.md 重新生成
- [ ] package.json 版本号更新为 1.7.0
- [ ] npm publish 发布

### 8.3 回滚方案

如发布后发现严重问题：
1. npm `npm unpublish @yclenove/polyglot-db-mcp-server@1.7.0`
2. 修复后重新发布为 `1.7.1`
3. 用户可通过 `npm install @yclenove/polyglot-db-mcp-server@1.6.0` 回退

---

## 九、附录

### 9.1 变更影响分析

**新增文件**:
- `src/core/version.ts` -- 版本号统一管理
- `src/core/sql-helpers.ts` -- SQL 辅助函数共享模块
- `src/drivers/sql/sqlite-driver.ts` -- SQLite 驱动
- `test/sql-helpers.test.mjs` -- SQL 辅助函数测试
- `test/sqlite-driver.test.mjs` -- SQLite 驱动测试

**修改文件**:
- `src/server.ts` -- 版本号改为动态读取
- `src/tools/connections.ts` -- 版本号改为动态读取 + 新增诊断工具
- `src/core/data-masking.ts` -- strict-v2/loose 模式修正
- `src/tools/sql.ts` -- 自动分页 + SQLite 注册
- `src/tools/redis.ts` -- redis_type 优化
- `src/tools/advisor.ts` -- 改用共享 SQL helpers
- `src/core/types.ts` -- 新增 sqlite 引擎类型
- `src/core/config.ts` -- SQLite 配置解析
- `src/core/query-cache.ts` -- 命中率统计
- `src/bootstrap.ts` -- SQLite 连接创建
- `package.json` -- 新增 better-sqlite3 依赖

### 9.2 工具总数预估

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

---

*文档结束 | 评审人: ___________ | 评审日期: ___________*
