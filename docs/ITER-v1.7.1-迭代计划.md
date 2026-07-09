# v1.7.1 迭代计划：质量基线与安全收敛

**文档编号**: ITER-v1.7.1
**版本**: 1.0
**日期**: 2026-07-09
**目标版本**: v1.7.1
**迭代类型**: Patch / Quality Release
**建议周期**: 5 个工作日
**状态**: 已完成
**上游依据**: `docs/ROADMAP.md`、`docs/QUALITY-v1.7.0-质量报告.md`、当前代码基线 v1.7.0

---

## 一、迭代目标

v1.7.1 不新增大型业务功能，核心目标是把 v1.7.0 扩展后的代码库沉淀成稳定、可测试、可发布的质量基线。

### 1.1 总目标

1. **补齐核心测试缺口**：为缓存、限流、SQL helper、版本读取、registry 指标等核心模块添加独立测试。
2. **修复长运行稳定性风险**：为 RateLimiter 增加不活跃 bucket 清理能力，避免服务长期运行后 Map 持续增长。
3. **收敛边界安全问题**：改进 query cache key 序列化，规避 `undefined`、`Date`、`BigInt` 等参数边界导致的缓存键碰撞。
4. **验证并修正方言行为**：处理 MSSQL EXPLAIN 的批处理语义风险，避免工具在 SQL Server 上表现不稳定。
5. **清理质量信号**：消除 ESLint warning，更新质量报告状态，让代码、测试、文档一致。

### 1.2 成功指标

| 指标 | v1.7.0 状态 | v1.7.1 目标 |
|------|-------------|-------------|
| `npm run build` | 通过 | 必须通过 |
| `npm test` | 295 passed | 必须通过，新增测试全部纳入默认 test |
| `npm run lint` | 0 error / 5 warning | 0 error / 0 warning，或有明确豁免说明 |
| 核心模块独立测试 | 部分缺失 | `query-cache`、`rate-limiter`、`sql-helpers`、`version`、`registry` 覆盖 |
| 长运行内存风险 | RateLimiter bucket 不清理 | 可配置或默认清理不活跃 bucket |
| 文档一致性 | 质量报告部分项已过期 | 已修复/遗留/转后续版本状态清晰 |

---

## 二、范围边界

### 2.1 纳入范围

| 编号 | 类型 | 内容 |
|------|------|------|
| S-001 | 测试 | 核心模块单元测试补齐 |
| S-002 | 稳定性 | RateLimiter bucket 生命周期管理 |
| S-003 | 安全 | query cache key 稳定序列化 |
| S-004 | 兼容性 | MSSQL EXPLAIN 行为修正或明确降级 |
| S-005 | 质量 | ESLint warning 清理和类型收敛 |
| S-006 | 文档 | 质量报告状态、CHANGELOG、README/API 必要更新 |

### 2.2 不纳入范围

| 内容 | 原因 | 规划版本 |
|------|------|----------|
| Streamable HTTP 传输 | 属于传输层能力，需独立设计和测试 | v1.8.0 |
| OAuth 2.1 / RBAC | 企业安全能力，涉及架构变更 | v2.0.0 |
| MongoDB 多文档事务 | 需要 session 生命周期设计 | v1.9.0 |
| Redis Pipeline | 需要批处理安全模型 | v1.9.0 |
| DuckDB 引擎 | 新引擎，不适合质量补丁混入 | v2.1.0 |
| 插件化驱动 | 架构级能力，需 ADR | v3.0.0 |

---

## 三、当前证据与问题拆解

### 3.1 已确认事实

| 事实 | 证据 |
|------|------|
| 当前版本为 `1.7.0` | `package.json` |
| `sql_call_procedure` 已调用 `validateIdent(procedure, 'procedure')` | `src/tools/sql.ts` |
| RateLimiter 当前没有 bucket 清理机制 | `src/core/rate-limiter.ts` |
| query cache key 当前使用 `JSON.stringify(params)` | `src/core/query-cache.ts` |
| MSSQL EXPLAIN 当前拼成单个字符串 | `src/tools/sql.ts`, `src/tools/advisor.ts` |
| 默认 test 未包含 `query-cache.test.mjs` 等独立测试 | `package.json` 和 `test/` 文件列表 |
| lint 当前存在 `no-explicit-any` warning | `src/tools/advisor.ts`, `src/tools/sql.ts` |

### 3.2 v1.7.0 质量报告状态重核

| 质量项 | 当前判断 | v1.7.1 动作 |
|--------|----------|-------------|
| H-1 package version 未更新 | 已修复，当前为 `1.7.0` | 更新质量报告状态 |
| H-2 procedure 注入风险 | 代码已添加 `validateIdent`，仍需测试覆盖 | 增加恶意 procedure 测试并更新质量报告 |
| M-1 核心模块测试缺失 | 未完成 | 本迭代 P0 |
| M-2 RateLimiter 内存增长 | 未完成 | 本迭代 P0 |
| M-3 MSSQL EXPLAIN | 未完成或未验证 | 本迭代 P1 |
| M-4 cacheKey 边界风险 | 未完成 | 本迭代 P0/P1 |
| M-5 分页数字拼接 | 当前由 Zod 约束，短期可接受 | 记录为已知设计，v1.8+ 再评估驱动参数化 |
| L-1 Oracle 大小写表名 | 未完成 | 文档化限制或转 v1.8 |
| L-2 简单正则提表名 | 未完成 | 工具说明补充局限，转 v1.9 |
| L-3 version fallback | 未测试 | 本迭代通过 `version.test.mjs` 覆盖 |

---

## 四、任务分解

### Epic A：核心测试补齐

#### A-001：QueryCache 测试

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `test/query-cache.test.mjs` |
| 涉及源码 | `src/core/query-cache.ts` |
| 预估 | 0.5 天 |

测试用例：

| 编号 | 场景 | 断言 |
|------|------|------|
| A-001-1 | disabled cache | `maxSize <= 0` 时 `get` 永远返回 `undefined`，`set` 不写入 |
| A-001-2 | basic hit/miss | miss/hit 计数正确，hitRate 保留两位 |
| A-001-3 | LRU eviction | 超过 maxSize 后淘汰最旧未访问项 |
| A-001-4 | access refreshes LRU | `get` 命中后移动到最新 |
| A-001-5 | TTL expiry | 过期项返回 miss 并从 cache 删除 |
| A-001-6 | clear | 清空数据并重置 hits/misses |
| A-001-7 | cacheKey special values | `undefined`、`null`、`Date`、`BigInt`、嵌套对象不碰撞 |

#### A-002：RateLimiter 测试

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `test/rate-limiter.test.mjs` |
| 涉及源码 | `src/core/rate-limiter.ts` |
| 预估 | 0.5 天 |

测试用例：

| 编号 | 场景 | 断言 |
|------|------|------|
| A-002-1 | disabled limiter | `maxPerSecond <= 0` 永远允许 |
| A-002-2 | token consumption | 同一 key 连续请求超过额度后拒绝 |
| A-002-3 | independent keys | 不同 key 独立限流 |
| A-002-4 | refill over time | 时间推进后令牌恢复 |
| A-002-5 | inactive cleanup | 超过 idle TTL 的 bucket 被清理 |
| A-002-6 | cleanup timer lifecycle | 定时器不会阻止进程退出，支持 dispose/stop |

#### A-003：SQL helper 测试

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `test/sql-helpers.test.mjs` |
| 涉及源码 | `src/core/sql-helpers.ts` |
| 预估 | 0.5 天 |

测试用例：

| 编号 | 场景 | 断言 |
|------|------|------|
| A-003-1 | `describeTableSql` 多引擎 | MySQL/PG/MSSQL/Oracle/SQLite SQL 与参数正确 |
| A-003-2 | `listIndexesSql` 多引擎 | 各引擎 SQL 与参数正确 |
| A-003-3 | `listTablesSql` 多引擎 | 各引擎 SQL 与参数正确 |
| A-003-4 | invalid identifier | 表名非法时抛错 |
| A-003-5 | schema fallback | PostgreSQL schema 缺省为 `public` |
| A-003-6 | Oracle uppercase behavior | 现有 uppercase 行为有明确测试，后续改动可感知 |

#### A-004：Version 测试

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `test/version.test.mjs` |
| 涉及源码 | `src/core/version.ts` |
| 预估 | 0.25 天 |

测试用例：

| 编号 | 场景 | 断言 |
|------|------|------|
| A-004-1 | package version | `getVersion()` 等于 `package.json.version` |
| A-004-2 | stable cache | 多次调用返回一致 |
| A-004-3 | server_info integration | `server_info` 返回版本与 package 一致 |

#### A-005：Registry metrics 测试

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `test/registry.test.mjs` 或 `test/registry-metrics.test.mjs` |
| 涉及源码 | `src/core/registry.ts` |
| 预估 | 0.25 天 |

测试用例：

| 编号 | 场景 | 断言 |
|------|------|------|
| A-005-1 | record success | total/success/lastSuccess/avgLatency 更新 |
| A-005-2 | record failure | failed/lastError/lastFailure 更新 |
| A-005-3 | unknown id | 未知连接记录不污染指标 |
| A-005-4 | getMetrics default | 未调用前 metrics 有稳定默认值 |

#### A-006：默认测试脚本纳入新增测试

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `package.json` |
| 涉及脚本 | `test`, `test:coverage`, `test:coverage:check` |
| 预估 | 0.1 天 |

要求：

1. 新增的 `test/query-cache.test.mjs`、`test/rate-limiter.test.mjs`、`test/sql-helpers.test.mjs`、`test/version.test.mjs` 必须被默认 `npm test` 执行。
2. 覆盖率脚本也应包含这些测试，避免只在本地单跑通过。
3. 如测试数量继续增长，评估把默认脚本从显式枚举迁移为更稳定的 `test/*.test.mjs test/drivers/*.test.mjs test/tools/*.test.mjs`。

验收标准：

- `npm test` 输出中能看到新增测试 suite。
- `npm run test:coverage:check` 使用同一批核心测试。

---

### Epic B：稳定性与安全修复

#### B-001：RateLimiter bucket 清理

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `src/core/rate-limiter.ts` |
| 预估 | 0.5 天 |

设计要求：

1. bucket 结构增加 `lastUsed` 或复用 `lastRefill` 表示活跃时间。
2. 构造函数支持可选配置：`idleTtlMs`、`cleanupIntervalMs`、`now`。
3. 默认清理策略保守：例如 idle TTL 5 分钟、cleanup interval 1 分钟。
4. `setInterval(...).unref?.()`，不阻止 Node 进程退出。
5. 提供 `cleanup()` 显式方法，方便测试和未来运维调用。
6. 提供 `dispose()` 或 `stop()`，测试可清理 timer。

验收标准：

- 长时间不活跃 key 可被移除。
- 活跃 key 不被误删。
- `DB_RATE_LIMIT_PER_SECOND=0` 时不创建 bucket。
- 单元测试可用 fake clock 或注入 now 函数确定性验证。

#### B-002：cacheKey 稳定序列化

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `src/core/query-cache.ts` |
| 预估 | 0.5 天 |

设计要求：

1. 不再直接使用 `JSON.stringify(params)` 作为唯一序列化。
2. 序列化保留类型标记：
   - `undefined` 与 `null` 区分
   - `Date` 与普通字符串区分
   - `BigInt` 可序列化
   - `NaN`、`Infinity`、`-Infinity` 与普通 number 区分
3. 对对象 key 做稳定排序，避免 `{a:1,b:2}` 与 `{b:2,a:1}` 产生不同 key。
4. 循环引用应抛出清晰错误或降级为不可缓存，不能导致进程崩溃。

验收标准：

- 特殊参数不碰撞。
- 同义对象序列化稳定。
- 现有 SQL 查询缓存行为不破坏。

#### B-003：MSSQL EXPLAIN 行为修正

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `src/tools/sql.ts`, `src/tools/advisor.ts` |
| 预估 | 0.5 ~ 1 天 |

方案选项：

| 方案 | 优点 | 风险 |
|------|------|------|
| 拆成三次 execute：ON -> SQL -> OFF | 最贴近 SQL Server 语义 | 需要确保 OFF 在 finally 中执行 |
| 使用 `SET SHOWPLAN_XML ON` | 结构化更强 | 驱动返回格式差异较大 |
| 暂时禁用 MSSQL explain 并返回明确 hint | 风险最低 | 功能降级 |

推荐方案：先实现三次 execute，若本地无法确定驱动行为，则保守降级并记录在文档中。

验收标准：

- `sql_explain` 对 MSSQL 不再生成单批 `SET SHOWPLAN_ALL ON; ...; OFF`。
- `advisor.ts` 与 `sql.ts` 使用统一 helper 或统一行为。
- 出错时必须尝试关闭 SHOWPLAN，避免污染连接会话。
- 有单元测试覆盖生成逻辑或 mock driver 调用顺序。

#### B-004：分页数字拼接风险处置

| 属性 | 内容 |
|------|------|
| 优先级 | P2 |
| 文件 | `src/tools/sql.ts`, `docs/API.md` 或质量报告 |
| 预估 | 0.25 天 |

短期策略：

- 保留当前数字拼接，因为 `page`、`page_size` 由 Zod `number.int()` 约束。
- 在代码附近增加简短注释：分页值来自 schema 校验后的整数。
- 在质量报告中标注为"已接受风险"，后续如驱动支持 LIMIT/OFFSET 参数化再调整。

---

### Epic C：类型与 Lint 收敛

#### C-001：消除 `advisor.ts` 中的 `any`

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `src/tools/advisor.ts` |
| 预估 | 0.25 天 |

要求：

- 定义局部 `Record<string, unknown>` 或专用 row 类型。
- 访问字段时用安全转换函数，例如 `stringValue(row.column_name ?? row.COLUMN_NAME)`。
- 不使用 `as any[]`。

#### C-002：消除 `sql.ts` 中的 `any`

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `src/tools/sql.ts` |
| 预估 | 0.5 天 |

要求：

- `z.array(z.any())` 如为工具输入 schema，可保留并配置 ESLint 局部豁免；否则改为 `z.array(z.unknown())`。
- 数据行处理统一使用 `Record<string, unknown>`。
- `sql_generate_types`、`sql_list_tables`、`sql_list_views` 字段读取有类型守卫。

验收标准：

- `npm run lint` 无 warning，或仅对 Zod schema 的 `z.any()` 有明确局部注释。

---

### Epic D：文档与发布准备

#### D-001：更新质量报告状态

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `docs/QUALITY-v1.7.0-质量报告.md` 或新增 `docs/QUALITY-v1.7.1-质量报告.md` |
| 预估 | 0.25 天 |

建议：

- 不直接覆盖历史报告结论；新增"v1.7.1 复核状态"小节或新报告。
- 标注 H-1/H-2 已修复并列出证据。
- 对 M-5、L-1、L-2 标注接受风险或转后续版本。

#### D-002：更新 CHANGELOG

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `CHANGELOG.md` |
| 预估 | 0.25 天 |

要求：

- 新增 `[1.7.1] - 2026-07-09` 或实际发布日期。
- 分为"修复"、"测试"、"文档"。
- 不夸大未完成事项。

#### D-003：更新 README/API 必要说明

| 属性 | 内容 |
|------|------|
| 优先级 | P2 |
| 文件 | `README.md`, `docs/API.md` |
| 预估 | 0.25 天 |

范围：

- 如新增环境变量或行为变更，必须说明。
- 如 MSSQL EXPLAIN 降级，API 文档必须说明。

---

## 五、执行顺序

推荐按风险和依赖排序：

| Day | 任务 | 目标 |
|-----|------|------|
| Day 1 AM | A-001, A-002 测试先行 | 先刻画 QueryCache / RateLimiter 现有行为和缺口 |
| Day 1 PM | B-001, B-002 实现 | 修复清理机制和 cacheKey |
| Day 2 AM | A-003, A-004, A-005, A-006 | 补齐 helper/version/registry 测试并纳入默认脚本 |
| Day 2 PM | B-003 | 处理 MSSQL EXPLAIN |
| Day 3 AM | C-001, C-002 | 清理 lint warning |
| Day 3 PM | D-001, D-002, D-003 | 更新质量报告和发布说明 |
| Day 4 | 全量验证与修复 | build/test/lint/coverage/pack |
| Day 5 | Review、收尾、发布准备 | tag/release 前检查 |

---

## 六、测试计划

### 6.1 必跑命令

```powershell
npm run build
npm test
npm run lint
```

### 6.2 建议补充命令

```powershell
npm run typecheck
npm run test:coverage:check
npm pack --dry-run
```

### 6.3 测试准入规则

| 规则 | 要求 |
|------|------|
| 单元测试 | 新增核心函数必须有 deterministic test，不依赖真实网络 |
| 工具测试 | 涉及工具 handler 行为变更必须 mock registry/driver |
| 集成测试 | 本迭代默认不要求真实数据库集成，但不可破坏现有 integration 脚本 |
| 时间相关 | RateLimiter/TTL 测试必须使用注入时钟或短 TTL，避免 flaky |
| 安全相关 | 注入、readonly、keyPrefix、allowlist 不能降级 |

---

## 七、验收清单

### 7.1 功能验收

- [ ] `query-cache.test.mjs` 覆盖 LRU、TTL、stats、cacheKey 边界。
- [ ] `rate-limiter.test.mjs` 覆盖限流、补充、独立 key、bucket cleanup。
- [ ] `sql-helpers.test.mjs` 覆盖五类 SQL 引擎 helper。
- [ ] `version.test.mjs` 验证 `package.json` 与运行时版本一致。
- [ ] registry metrics 测试覆盖成功、失败、未知连接。
- [ ] RateLimiter 不活跃 bucket 可清理，timer 不阻塞退出。
- [ ] cacheKey 特殊值无碰撞。
- [ ] MSSQL EXPLAIN 不再使用高风险单批拼接，或明确降级并文档化。
- [ ] lint warning 已清理。
- [ ] 质量报告状态已更新。

### 7.2 命令验收

- [ ] `npm run build` 通过。
- [ ] `npm test` 通过。
- [ ] `npm run lint` 通过且无 error。
- [ ] `npm run typecheck` 通过。
- [ ] 如运行 coverage，`npm run test:coverage:check` 通过。
- [ ] `npm pack --dry-run` 无异常产物。

### 7.3 兼容性验收

- [ ] 不改变 `DB_MCP_CONNECTIONS` 配置格式。
- [ ] 不改变现有工具名称和必填参数。
- [ ] `sql_query` 仍在 MCP 层执行 `isReadOnlyQuery` 后再调用 driver。
- [ ] 默认 stdio 启动方式不变。
- [ ] SQLite 内存库和文件库现有测试仍通过。

---

## 八、风险登记

| 编号 | 风险 | 概率 | 影响 | 等级 | 缓解措施 |
|------|------|------|------|------|----------|
| R-001 | RateLimiter 加 timer 后测试或进程退出不稳定 | 中 | 中 | 中 | `unref()` + `dispose()` + 注入时钟 |
| R-002 | cacheKey 新序列化改变缓存命中行为 | 中 | 低 | 中 | 只影响缓存，不影响查询正确性；测试覆盖 |
| R-003 | MSSQL EXPLAIN 修复缺少真实 SQL Server 验证 | 高 | 中 | 中 | mock 调用顺序 + 文档说明；集成验证转 v1.8 |
| R-004 | 清理 `any` 引入过度类型复杂度 | 中 | 低 | 低 | 局部 helper，避免大重构 |
| R-005 | 更新质量报告与历史文档冲突 | 低 | 低 | 低 | 保留历史结论，新增复核状态 |

---

## 九、回滚策略

| 变更 | 回滚方式 |
|------|----------|
| RateLimiter cleanup | 保留默认开关；如异常可禁用 cleanup interval |
| cacheKey 序列化 | 回退到旧 `JSON.stringify` 实现，清空缓存即可恢复 |
| MSSQL EXPLAIN | 降级为返回不支持提示，不影响其他引擎 |
| 测试新增 | 如测试 flaky，先修测试确定性，不回滚源码修复 |
| 文档更新 | 可追加更正，不需要历史重写 |

---

## 十、Definition of Done

v1.7.1 只有同时满足以下条件才视为完成：

1. 范围内 P0/P1 任务全部完成或有明确接受风险记录。
2. 所有新增测试已加入默认 `npm test` 覆盖路径。
3. `npm run build`、`npm test`、`npm run lint` 在干净工作区通过。
4. `sql_query` 只读保护路径未被削弱。
5. CHANGELOG 与质量报告反映真实状态。
6. 无真实凭证、`.env` 或生产连接字符串进入提交。
7. `git status --short` 仅包含本迭代预期文件，提交前再次复核 diff。

---

## 十一、交付物

| 交付物 | 路径 |
|--------|------|
| 代码修复 | `src/core/rate-limiter.ts`, `src/core/query-cache.ts`, `src/tools/sql.ts`, `src/tools/advisor.ts` |
| 测试 | `test/query-cache.test.mjs`, `test/rate-limiter.test.mjs`, `test/sql-helpers.test.mjs`, `test/version.test.mjs`, registry 相关测试 |
| 文档 | `CHANGELOG.md`, `docs/QUALITY-v1.7.1-质量报告.md` 或质量报告复核小节 |
| 验证记录 | 最终回复中列出 build/test/lint/typecheck 结果 |

---

## 十二、后续衔接

v1.7.1 完成后再进入：

1. **v1.7.2 发布工程补强**：CI、release checklist、`.env.example`、`npm pack` 检查。
2. **v1.7.3 体验补丁**：CLI init、错误码文档、README 快速开始。
3. **v1.8.0 传输层设计**：先写 ADR，再实现 Streamable HTTP。
