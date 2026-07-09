# ARCH: polyglot-db-mcp-server v1.7.0 架构评估报告

**文档编号**: ARCH-v1.7.0
**版本**: 1.0
**日期**: 2026-05-05
**评审人**: 架构师
**状态**: 待评审
**基准版本**: v1.6.0 (commit 3a524cf)

---

## 一、变更影响矩阵

### 1.1 功能-文件影响总览

| 功能 ID | 功能名称 | 影响文件 | 影响程度 | 风险等级 |
|---------|----------|----------|----------|----------|
| F-001 | 版本号统一 | `src/server.ts`, `src/tools/connections.ts`, **新建** `src/core/version.ts` | 修改 + 新增 | 低 |
| F-002 | strict-v2 脱敏修正 | `src/core/data-masking.ts` | 修改 | 中 |
| F-003 | SQL 辅助函数去重 | **新建** `src/core/sql-helpers.ts`, `src/tools/sql.ts`, `src/tools/advisor.ts` | 重构 | 低 |
| F-004 | sql_query 自动分页 | `src/tools/sql.ts`, `src/core/config.ts` | 修改 | 中 |
| F-005 | redis_type 优化 | `src/tools/redis.ts`, `src/drivers/redis/redis-driver.ts`, `src/core/types.ts` | 修改 | 低 |
| F-006 | 错误信息增强 | `src/tools/*.ts`, `src/core/registry.ts`, **新建/修改** `src/core/error-codes.ts` | 修改 + 新增 | 中 |
| F-007 | SQLite 引擎 | **新建** `src/drivers/sql/sqlite-driver.ts`, `src/core/types.ts`, `src/core/config.ts`, `src/bootstrap.ts`, `src/tools/sql.ts` | 新增 | 高 |
| F-008 | 连接诊断工具 | `src/tools/connections.ts` | 修改 | 低 |
| F-009 | 缓存命中率统计 | `src/core/query-cache.ts`, `src/tools/sql.ts` | 修改 | 低 |

### 1.2 文件级变更明细

| 文件 | 受影响功能 | 变更类型 | 变更行数估算 |
|------|-----------|----------|-------------|
| `src/core/version.ts` | F-001 | **新建** | ~10 行 |
| `src/server.ts` | F-001 | 修改（1 行） | ~3 行 |
| `src/tools/connections.ts` | F-001, F-006, F-008 | 修改 + 新增工具 | ~120 行 |
| `src/core/data-masking.ts` | F-002 | 修改（函数重写） | ~40 行 |
| `src/core/sql-helpers.ts` | F-003 | **新建** | ~100 行 |
| `src/tools/sql.ts` | F-003, F-004, F-007, F-009 | 重构 + 修改 | ~200 行 |
| `src/tools/advisor.ts` | F-003 | 修改（改用导入） | ~-70 行（删除重复） |
| `src/tools/redis.ts` | F-005, F-006 | 修改 | ~30 行 |
| `src/drivers/redis/redis-driver.ts` | F-005 | 修改（新增方法） | ~10 行 |
| `src/core/types.ts` | F-005, F-007 | 修改（类型扩展） | ~15 行 |
| `src/core/config.ts` | F-004, F-007 | 修改 | ~20 行 |
| `src/bootstrap.ts` | F-007 | 修改（新增 case） | ~5 行 |
| `src/core/query-cache.ts` | F-009 | 修改（新增统计） | ~30 行 |
| `src/drivers/sql/sqlite-driver.ts` | F-007 | **新建** | ~200 行 |
| `src/core/error-codes.ts` | F-006 | 修改/新建 | ~60 行 |
| `src/core/registry.ts` | F-006 | 修改（错误信息增强） | ~20 行 |
| `src/tools/mongo.ts` | F-006 | 修改（错误信息） | ~30 行 |
| `package.json` | F-007 | 修改（新增依赖） | ~3 行 |

### 1.3 变更规模统计

- **新建文件**: 4 个 (`version.ts`, `sql-helpers.ts`, `sqlite-driver.ts`, `error-codes.ts` 可能)
- **修改文件**: 14 个
- **预计净增代码行**: ~500-600 行（含测试）
- **预计删除代码行**: ~70 行（去重）

---

## 二、架构风险评估

### 2.1 版本号统一 (F-001) -- 风险: 低

**当前问题**:
- `src/server.ts:14` 硬编码 `'1.4.0'`
- `src/tools/connections.ts:277` 硬编码 `'1.4.0'`
- `package.json` 已为 `1.6.0`

**方案评估**: PRD 提议使用 `createRequire(import.meta.url)` 读取 `package.json`。

**风险点**:

| 风险 | 概率 | 影响 | 说明 |
|------|:----:|:----:|------|
| ESM/CJS 兼容性 | 低 | 低 | 项目已声明 `"type": "module"`，`createRequire` 是标准 ESM 读取 CJS 模块的方式，Node.js >= 20 完全支持 |
| `package.json` 不在 dist 目录 | 中 | 高 | 构建后 `dist/core/version.js` 通过 `require('../../package.json')` 读取，路径依赖 `package.json` 在项目根目录。**npm 发布时 `package.json` 一定在根目录，但 monorepo 或 symlink 场景可能失败** |
| TypeScript 类型推断 | 低 | 低 | `require()` 返回 `any`，需要显式断言 `{ version: string }` |

**建议**:
1. 使用 `createRequire` 方案可行，但应增加 fallback：若读取失败则使用环境变量 `APP_VERSION` 或默认值 `'unknown'`
2. 考虑在构建脚本中将版本号注入为常量（更可靠的方案）：
   ```typescript
   // tsconfig.json 配置 define 或在构建时替换
   export const APP_VERSION = process.env.APP_VERSION ?? '0.0.0-dev';
   ```
3. 新增单元测试验证 `APP_VERSION` 非空且格式合法（semver）

---

### 2.2 strict-v2 脱敏修正 (F-002) -- 风险: 中

**当前问题**（已确认）:

`src/core/data-masking.ts` 中 `applyStrictV2Mode`（第 187-202 行）与 `applyLooseMode`（第 204-218 行）逻辑**完全相同**：

```typescript
// 两者都是：字段名匹配 -> maskValue（值正则校验后脱敏）
function applyStrictV2Mode(row, config) {
  for (const [key, value] of Object.entries(row)) {
    const rule = shouldMaskField(key, config.excludeFields, config.rules);
    if (rule) {
      result[key] = maskValue(value, rule);  // 与 loose 完全相同
    }
  }
}

function applyLooseMode(row, config) {
  for (const [key, value] of Object.entries(row)) {
    const rule = shouldMaskField(key, config.excludeFields, config.rules);
    if (rule) {
      result[key] = maskValue(value, rule);  // 与 strict-v2 完全相同
    }
  }
}
```

**设计意图与实现差异**:

| 模式 | 文档描述 | 当前实现 | 修正后 |
|------|----------|----------|--------|
| strict | 字段名匹配即脱敏 | 字段名匹配 -> 直接 `rule.mask(value)`（**正确**） | 不变 |
| strict-v2 | 字段名 AND 值正则双重校验 | 字段名匹配 -> `maskValue`（值正则校验） | 不变（逻辑本身正确，但需增加注释和测试） |
| loose | 仅按值正则匹配 | 字段名匹配 -> `maskValue`（**错误：多了一层字段名检查**） | 不检查字段名，遍历所有值正则规则 |

**关键发现**: `applyStrictV2Mode` 的逻辑实际上**已经是正确的**（字段名匹配 AND 值正则匹配），问题在于 `applyLooseMode` 错误地复用了同样的逻辑，导致 loose 模式也要求字段名先匹配。

**行为变化影响**:

| 场景 | 修正前 loose | 修正后 loose | 是否 breaking |
|------|-------------|-------------|:------------:|
| 字段名匹配 + 值匹配 | 脱敏 | 脱敏 | 否 |
| 字段名匹配 + 值不匹配 | 不脱敏 | 不脱敏 | 否 |
| 字段名不匹配 + 值匹配 | **不脱敏** | **脱敏** | **是** |
| 字段名不匹配 + 值不匹配 | 不脱敏 | 不脱敏 | 否 |

**风险**: 修正后 loose 模式会脱敏更多字段（字段名不匹配但值匹配的情况）。这符合文档描述，但**现有使用 loose 模式的用户可能感知到行为变化**。

**建议**:
1. 在 CHANGELOG 中明确标注 loose 模式行为修正
2. 新增至少 6 个测试用例，覆盖三种模式的差异场景
3. 考虑在 `applyLooseMode` 中新增注释说明设计意图

---

### 2.3 自动分页 (F-004) -- 风险: 中

**当前问题**:

`src/tools/sql.ts` 的 `sql_query` 工具接受 `page` 和 `page_size` 参数（第 116-117 行），但**仅用于计算元数据**，不会自动追加 `LIMIT/OFFSET` 到 SQL 中（第 139-155 行注释明确说明："实际的 LIMIT/OFFSET 应该在 SQL 中由用户指定"）。

**SQL 方言差异分析**:

| 引擎 | LIMIT/OFFSET 语法 | 特殊情况 |
|------|-------------------|----------|
| MySQL | `LIMIT n OFFSET m` | 标准语法 |
| PostgreSQL | `LIMIT n OFFSET m` | 标准语法 |
| MSSQL | `OFFSET m ROWS FETCH NEXT n ROWS ONLY` | 需要 ORDER BY 子句 |
| Oracle | `OFFSET m ROWS FETCH NEXT n ROWS ONLY`（12c+）或 `ROWNUM`（旧版） | 需要 ORDER BY 子句 |
| SQLite | `LIMIT n OFFSET m` | 与 MySQL/PG 相同 |

**风险点**:

| 风险 | 概率 | 影响 | 说明 |
|------|:----:|:----:|------|
| MSSQL/Oracle 缺少 ORDER BY | 高 | 中 | `OFFSET...FETCH` 语法强制要求 ORDER BY，自动追加可能报错 |
| SQL 已有 LIMIT 时的检测准确性 | 中 | 中 | PRD 提议用 `/LIMIT\s+\d+/i` 正则检测，但可能误判子查询中的 LIMIT |
| 与现有 maxRows 逻辑冲突 | 中 | 低 | `maxRows` 参数控制驱动层截断，分页控制工具层追加，两层逻辑需协调 |
| 用户预期不一致 | 中 | 中 | 用户可能期望 `page=2, page_size=10` 自动生效，但也可能期望手动控制 |

**建议**:
1. 自动分页**仅对 MySQL、PostgreSQL、SQLite 生效**，MSSQL 和 Oracle 由于语法复杂度建议暂不支持自动追加，仅更新元数据
2. LIMIT 检测正则应排除子查询：`/(?<!\()(?:^|\s)LIMIT\s+\d+/i` 或更简单地只检测 SQL 末尾
3. `DB_AUTO_PAGINATION` 环境变量默认 `true`，在文档中明确说明
4. 当自动追加 LIMIT 时，应同时追加 `ORDER BY 1`（或跳过 MSSQL/Oracle），避免无序结果

---

### 2.4 SQLite 引擎 (F-007) -- 风险: 高

**当前驱动层抽象评估**:

`src/core/types.ts` 定义了 `SqlDriver` 接口：

```typescript
export interface SqlDriver {
  readonly engine: SqlEngine;  // 'mysql' | 'postgres' | 'mssql' | 'oracle'
  ping(): Promise<{ ok: boolean; error?: string }>;
  execute(sql, params, options): Promise<SqlExecuteResult>;
  beginTransaction(): Promise<SqlTransaction>;
  close(): Promise<void>;
}
```

**抽象充分性分析**:

| 维度 | 评估 | 说明 |
|------|------|------|
| 接口兼容性 | **充分** | SQLite 可以完全实现 `SqlDriver` 接口 |
| 同步 vs 异步 | **需适配** | `better-sqlite3` 是同步 API，需包装为 `Promise` |
| 引擎类型扩展 | **需修改** | `SqlEngine` 联合类型需新增 `'sqlite'`，`Engine` 类型自动扩展 |
| SQL 方言差异 | **需处理** | SQLite 的 `PRAGMA`、`AUTOINCREMENT`、`WITHOUT ROWID` 等语法独特 |
| 连接模型差异 | **需适配** | SQLite 是文件数据库，无 host/port/user/password，需通过 `url` 解析文件路径 |
| 并发模型差异 | **需注意** | SQLite 单写多读，WAL 模式可优化并发读 |
| 事务模型 | **需注意** | `better-sqlite3` 事务是同步的，需包装 |

**关键架构决策点**:

1. **`SqlEngine` 类型扩展**: 需将 `SqlEngine` 从 `'mysql' | 'postgres' | 'mssql' | 'oracle'` 扩展为包含 `'sqlite'`。这会影响所有 `switch (engine)` 的 exhaustive check（`const e: never = engine`），需在每个 switch 中新增 sqlite case。

2. **`SQL_ENGINES` 集合**: `src/core/types.ts:147` 的 `SQL_ENGINES` 需新增 `'sqlite'`。

3. **工具注册**: PRD 提议 SQLite 工具作为路由别名复用 `sql.ts`。当前 `sql.ts` 的 `listTablesSql`、`describeTableSql`、`listIndexesSql` 等函数都使用 `SqlEngine` 类型的 switch，需新增 sqlite 分支。

4. **配置解析**: `src/core/config.ts:4` 的 `ENGINES` 集合需新增 `'sqlite'`，且 SQLite 的配置校验逻辑不同于其他 SQL 引擎（只需 url，不需要 host/port/user/password）。

5. **SQL 注入检测**: `src/core/sql-guards.ts` 的 `isReadOnlyQuery` 和 `checkDangerousOperation` 需确认对 SQLite 方言生效。SQLite 支持 `ATTACH DATABASE`、`DETACH DATABASE` 等特有语句，可能需要额外拦截。

**风险矩阵**:

| 风险 | 概率 | 影响 | 等级 | 缓解措施 |
|------|:----:|:----:|:----:|----------|
| better-sqlite3 原生编译失败 | 中 | 高 | **高** | 设为 optionalDependency，运行时动态 import，编译失败时优雅降级并提示 |
| exhaustive check 破坏 | 高 | 中 | **高** | 修改 `SqlEngine` 后，所有 switch 语句需同步更新 |
| SQLite 文件路径安全 | 中 | 高 | **高** | 需限制路径在允许的目录范围内，防止路径穿越攻击 |
| 同步 API 包装性能 | 低 | 低 | **低** | `better-sqlite3` 同步 API 在 Node.js 主线程执行，长时间查询会阻塞事件循环，需设置超时 |
| WAL 模式并发写入 | 低 | 中 | **中** | 文档说明单写多读限制，工具层可增加写入排队机制 |

**建议**:
1. 将 `better-sqlite3` 放入 `optionalDependencies`，在 `createSqliteDriver` 中使用 `await import('better-sqlite3')` 动态导入
2. 修改 `SqlEngine` 类型后，用 TypeScript 编译器验证所有 exhaustive check 是否更新完整
3. SQLite 文件路径需做安全校验：禁止 `..` 路径穿越，限制为绝对路径或相对于工作目录的路径
4. 考虑将 SQLite 的 `execute` 包装在 `setImmediate` 或 worker thread 中，避免阻塞事件循环
5. 新增 `sql-guards.ts` 中对 SQLite 特有危险语句的拦截（`ATTACH`、`DETACH`、`VACUUM` 等）

---

### 2.5 redis_type 优化 (F-005) -- 风险: 低

**当前问题**:

`src/tools/redis.ts:698-725` 的 `redis_type` 工具通过 4 次命令推断类型：

```typescript
const v = await r.get(key);        // 1. 检查 string
const hash = await r.hgetall(key); // 2. 检查 hash
const len = await r.llen(key);     // 3. 检查 list
const scard = await r.scard(key);  // 4. 检查 set
```

**问题**:
1. 4 次网络往返，效率低
2. 无法检测 `zset`（Sorted Set）类型
3. 对不存在的键会执行 4 次无效命令

**方案评估**: 使用 Redis 原生 `TYPE` 命令，单次调用返回准确类型。

**接口变更**:

`RedisDriver` 接口需新增：

```typescript
type(key: string): Promise<string>;  // 返回 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'none'
```

**影响分析**:

| 文件 | 变更 |
|------|------|
| `src/core/types.ts` | `RedisDriver` 接口新增 `type()` 方法 |
| `src/drivers/redis/redis-driver.ts` | 实现 `type()` 方法，调用 `redis.type(key)` |
| `src/tools/redis.ts` | `redis_type` 工具改用 `r.type(key)` |

**风险点**:

| 风险 | 概率 | 影响 | 说明 |
|------|:----:|:----:|------|
| MockDriver 缺少 type 方法 | 高 | 中 | 测试中的 MockDriver 需同步新增 `type()` 方法 |
| 返回值类型变化 | 低 | 低 | 当前返回 `string/hash/list/set/none`，新增 `zset/stream`，向后兼容 |

**建议**:
1. `type()` 方法应包含 keyPrefix 校验和 auditLog
2. 测试中需覆盖所有 7 种返回值类型
3. `redis_type` 工具的 description 需更新，补充 `zset` 和 `stream` 类型说明

---

### 2.6 错误信息增强 (F-006) -- 风险: 中

**当前问题**:

| 错误位置 | 当前消息 | 问题 |
|----------|----------|------|
| `registry.ts:52` | `未知 connection_id: ${id}` | 未提示可用 ID 列表 |
| `sql.ts:234` | `非 SQL 连接` | 未说明当前连接类型 |
| `sql.ts:237` | `该连接为只读` | 未说明如何修改 |
| `redis-driver.ts:36` | `该 Redis 连接为只读` | 同上 |

**方案评估**: 增加 `hint` 字段，统一错误格式为 `{ message, code, hint }`。

**风险点**:

| 风险 | 概率 | 影响 | 说明 |
|------|:----:|:----:|------|
| 现有测试断言失败 | 高 | 中 | 现有测试可能对错误消息做精确匹配，格式变化会导致断言失败 |
| 错误消息 API 兼容性 | 低 | 低 | MCP 协议中错误消息是文本，增加 hint 字段不影响协议层 |
| 错误码维护成本 | 中 | 低 | 新增错误码体系需持续维护 |

**建议**:
1. 错误格式建议为 `{ message: string, code: string, hint?: string }`，`hint` 可选
2. 在 `registry.ts` 的 `resolveConnectionId` 和 `require` 方法中增加 hint
3. 更新现有测试中对错误消息的断言，改为匹配消息的子串或 code 字段

---

## 三、接口变更分析

### 3.1 新增接口

| 接口 | 类型 | 所属模块 | 说明 |
|------|------|----------|------|
| `APP_VERSION` | 导出常量 | `src/core/version.ts` | 版本号统一管理 |
| `describeTableSql()` | 导出函数 | `src/core/sql-helpers.ts` | 从 sql.ts/advisor.ts 抽取 |
| `listIndexesSql()` | 导出函数 | `src/core/sql-helpers.ts` | 从 sql.ts/advisor.ts 抽取 |
| `RedisDriver.type()` | 接口方法 | `src/core/types.ts` | Redis TYPE 命令 |
| `connection_diagnose` | MCP 工具 | `src/tools/connections.ts` | 连接诊断 |
| `sqlite_*` (9 个) | MCP 工具 | `src/tools/sql.ts` | SQLite 工具别名 |
| `QueryCache.hits/misses` | 类属性 | `src/core/query-cache.ts` | 缓存命中率统计 |

### 3.2 修改接口

| 接口 | 变更内容 | 影响范围 |
|------|----------|----------|
| `SqlEngine` 类型 | 新增 `'sqlite'` | 所有使用 `SqlEngine` 的 switch 语句 |
| `Engine` 类型 | 自动扩展（通过 `SqlEngine`） | `config.ts`、`types.ts` |
| `SQL_ENGINES` 集合 | 新增 `'sqlite'` | `types.ts` |
| `ConnectionSpec` | 可能新增 SQLite 特有字段 | `types.ts`、`config.ts` |
| `maskingLimits()` | 可能支持 `strict-v2` 模式 | `config.ts` |
| `sql_query` 输入参数 | 新增 `DB_AUTO_PAGINATION` 环境变量 | `config.ts` |
| `sql_query` 返回值 | 新增 `hasMore` 分页字段 | `sql.ts` |
| `sql_cache_stats` 返回值 | 新增 `hits`、`misses`、`hitRate` | `sql.ts`、`query-cache.ts` |

### 3.3 删除接口

无。v1.7.0 承诺零 breaking change。

---

## 四、依赖变更分析

### 4.1 新增依赖

| 包名 | 类型 | 版本 | 用途 | 影响评估 |
|------|------|------|------|----------|
| `better-sqlite3` | optionalDependencies | ^11.x | SQLite 同步驱动 | **高影响**：原生 C++ 模块，需 node-gyp 编译 |
| `@types/better-sqlite3` | devDependencies | ^11.x | TypeScript 类型 | 低影响 |

### 4.2 better-sqlite3 影响分析

**编译环境要求**:
- 需要 C++ 编译工具链（python3, make, g++/clang）
- Windows 需要 `windows-build-tools` 或 Visual Studio Build Tools
- macOS 需要 Xcode Command Line Tools
- Linux 需要 `build-essential`

**CI/CD 影响**:

| 平台 | 影响 | 说明 |
|------|------|------|
| Linux CI | 低 | 通常已有编译工具 |
| macOS CI | 低 | Xcode CLT 通常已安装 |
| Windows CI | **中** | 可能需要额外安装 Build Tools |
| Docker | **中** | 基础镜像可能缺少编译工具，需在 Dockerfile 中添加 |
| Alpine Linux | **高** | musl libc 与 better-sqlite3 的预编译二进制不兼容，需从源码编译 |

**npm 安装影响**:
- 作为 `optionalDependencies`，编译失败不会阻塞安装
- 但 SQLite 功能将不可用，需在运行时给出明确提示

**建议**:
1. 在 `README.md` 中明确说明 SQLite 功能的系统要求
2. 在 `createSqliteDriver` 中使用 try-catch 包装动态 import，失败时抛出友好的错误信息
3. CI 矩阵中增加 SQLite 相关测试的条件执行（仅在 better-sqlite3 可用时运行）
4. Docker 镜像使用 `node:20-bookworm`（非 Alpine）以避免 musl 兼容问题

---

## 五、测试策略建议

### 5.1 测试矩阵

| 功能 | 测试类型 | 测试重点 | 建议用例数 |
|------|----------|----------|-----------|
| F-001 版本号统一 | 单元测试 | `APP_VERSION` 非空、格式合法、与 package.json 一致 | 3 |
| F-002 strict-v2 脱敏 | 单元测试 | 三种模式的差异行为、边界情况 | 8 |
| F-003 SQL 辅助函数 | 单元测试 | 共享函数的正确性、各引擎方言 | 8 |
| F-004 自动分页 | 单元测试 | LIMIT 追加/不追加、方言差异、环境变量开关 | 10 |
| F-005 redis_type | 单元测试 | 各类型检测、MockDriver 适配 | 5 |
| F-006 错误信息 | 单元测试 | hint 字段存在性、格式统一性 | 8 |
| F-007 SQLite 驱动 | 单元测试 + 集成测试 | CRUD、事务、边界、安全 | 20 |
| F-008 连接诊断 | 单元测试 | 单连接/全连接诊断、不可达处理 | 5 |
| F-009 缓存统计 | 单元测试 | 命中率计算、缓存关闭场景 | 3 |

### 5.2 测试重点

**F-002 strict-v2 脱敏修正** -- 最关键的测试:

```
测试用例 1: strict 模式 - 字段名匹配 + 值不符合正则 -> 仍然脱敏
测试用例 2: strict 模式 - 字段名不匹配 -> 不脱敏
测试用例 3: strict-v2 模式 - 字段名匹配 + 值符合正则 -> 脱敏
测试用例 4: strict-v2 模式 - 字段名匹配 + 值不符合正则 -> 不脱敏
测试用例 5: strict-v2 模式 - 字段名不匹配 + 值符合正则 -> 不脱敏
测试用例 6: loose 模式 - 字段名不匹配 + 值符合正则 -> 脱敏 (修正后新增)
测试用例 7: loose 模式 - 字段名匹配 + 值不符合正则 -> 不脱敏
测试用例 8: loose 模式 - 字段名匹配 + 值符合正则 -> 脱敏
```

**F-007 SQLite 引擎** -- 测试覆盖要点:

```
- 文件不存在时自动创建
- WAL 模式启用验证
- CRUD 操作正确性
- 事务 commit/rollback
- SQL 注入检测对 SQLite 方言生效
- 只读连接保护
- 文件路径安全校验（路径穿越防护）
- better-sqlite3 不可用时的优雅降级
- schema_export 支持
- 并发读测试
```

**F-004 自动分页** -- 边界情况:

```
- SELECT * FROM users + page=2, page_size=10 -> 自动追加 LIMIT 10 OFFSET 10
- SELECT * FROM users LIMIT 5 + page=2, page_size=10 -> 不覆盖
- SELECT * FROM users (子查询中有 LIMIT) -> 检测准确性
- DB_AUTO_PAGINATION=false -> 行为与当前版本一致
- MSSQL 方言 -> OFFSET...FETCH 语法（或降级为仅元数据）
- page=1, page_size=20 -> LIMIT 20 OFFSET 0
```

### 5.3 回归测试策略

- 现有 442 个测试必须全部通过
- `strict-v2.test.mjs` 和 `masking-rules.test.mjs` 是关键回归测试
- `sql.test.mjs` 需验证去重后功能不变
- CI 覆盖率门槛从 50% 提升至 60%

---

## 六、代码质量建议

### 6.1 去重 -- SQL 方言辅助函数

**当前问题**: `describeTableSql` 和 `listIndexesSql` 在 `sql.ts` 和 `advisor.ts` 中各有一份几乎相同的实现。

| 函数 | sql.ts 行号 | advisor.ts 行号 | 差异 |
|------|------------|----------------|------|
| `describeTableSql` | 42-82 | 32-63 | advisor 版本缺少 schema 参数、缺少 validateIdent |
| `listIndexesSql` | 987-1024 | 65-97 | advisor 版本缺少 schema 参数、缺少 validateIdent |

**建议**:
1. 抽取到 `src/core/sql-helpers.ts`，保留 sql.ts 版本（更完整）
2. advisor.ts 改为 `import { describeTableSql, listIndexesSql } from '../core/sql-helpers.js'`
3. 共享版本应包含 schema 参数支持和 validateIdent 校验

### 6.2 去重 -- switch(engine) 模式

当前代码中存在大量 `switch (engine)` 语句，分布在：

| 文件 | switch 语句数 | 用途 |
|------|:------------:|------|
| `sql.ts` | 7 | listTablesSql, describeTableSql, listIndexesSql, createIndexSql, explainSql, listViewsSql, describeViewSql |
| `advisor.ts` | 2 | describeTableSql, listIndexesSql |
| `sql-guards.ts` | 0 | 无（引擎无关） |

**建议**:
1. 将所有 SQL 方言辅助函数集中到 `src/core/sql-helpers.ts`
2. 新增 SQLite 方言支持时，在共享模块中统一添加
3. 考虑使用策略模式替代 switch：

```typescript
type SqlDialect = {
  listTables(schema?: string): { sql: string; params?: unknown[] };
  describeTable(table: string, schema?: string): { sql: string; params?: unknown[] };
  listIndexes(table: string, schema?: string): { sql: string; params?: unknown[] };
  // ...
};

const DIALECTS: Record<SqlEngine, SqlDialect> = {
  mysql: { /* ... */ },
  postgres: { /* ... */ },
  // ...
};
```

### 6.3 模块化 -- 工具注册职责

当前 `src/tools/sql.ts` 文件已达 1153 行，包含 17 个工具注册。新增 SQLite 工具后将进一步膨胀。

**建议**:
1. 将视图相关工具（`sql_list_views`、`sql_describe_view`）抽取到 `src/tools/sql-views.ts`
2. 将索引相关工具（`sql_list_indexes`、`sql_create_index`）抽取到 `src/tools/sql-indexes.ts`
3. 将类型生成工具（`sql_generate_types`）抽取到 `src/tools/sql-types.ts`
4. 或按职责拆分为 `src/tools/sql/query.ts`、`src/tools/sql/ddl.ts`、`src/tools/sql/tx.ts`

### 6.4 模块化 -- 错误处理标准化

当前错误处理模式不一致：

```typescript
// 模式 A: 直接返回字符串
return { content: [{ type: 'text', text: msg }], isError: true };

// 模式 B: 返回 JSON
return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
```

**建议**:
1. 统一错误返回格式为 `{ message, code, hint }` 的 JSON
2. 在 `src/core/error-codes.ts` 中定义错误码常量
3. 创建 `formatError(msg, code, hint?)` 工具函数

### 6.5 配置管理 -- 环境变量收敛

当前环境变量散落在多个文件中：

| 文件 | 环境变量 |
|------|----------|
| `config.ts` | `DB_MCP_CONNECTIONS`, `DB_QUERY_TIMEOUT`, `DB_MAX_ROWS`, `DB_MAX_SQL_LENGTH`, `DB_RETRY_COUNT`, `DB_RETRY_DELAY_MS`, `DB_MASKING_MODE`, `DB_MASKING_EXCLUDE_FIELDS`, `DB_REPLAY_BUFFER_SIZE`, `DB_SUGGEST_TIMEOUT_MS` |
| `sql.ts` | `DB_TRANSACTION_TIMEOUT_MS` |
| `query-cache.ts` | `DB_QUERY_CACHE_SIZE`, `DB_QUERY_CACHE_TTL_MS` |
| `rate-limiter.ts` | `DB_RATE_LIMIT_*` |
| `index.ts` | `DB_SHUTDOWN_TIMEOUT_MS`, `LOG_LEVEL`, `LOG_FORMAT` |

**建议**:
1. 将所有环境变量集中到 `config.ts` 管理
2. 新增 `DB_AUTO_PAGINATION` 时统一在 `config.ts` 中定义
3. 考虑使用 `zod` schema 校验环境变量（项目已依赖 zod）

---

## 七、综合风险评估

### 7.1 风险热力图

```
影响度
  高 │  F-007(SQLite)   │  F-002(脱敏修正)  │
     │                  │                  │
  中 │  F-006(错误信息)  │  F-004(自动分页)  │
     │                  │                  │
  低 │  F-001(版本号)    │  F-005(redis)    │
     │  F-003(去重)     │  F-009(缓存统计)  │
     │  F-008(诊断)     │                  │
     └──────────────────┴──────────────────┘
           低                中                高
                      发生概率
```

### 7.2 优先级建议

| 阶段 | 功能 | 理由 |
|------|------|------|
| Phase 1 (Day 1-2) | F-001, F-002 | P0 缺陷修复，风险可控，可快速验证 |
| Phase 2 (Day 3-5) | F-003, F-005, F-009 | 低风险改进，代码质量提升 |
| Phase 3 (Day 5-7) | F-004, F-006 | 中等风险，需充分测试 |
| Phase 4 (Day 7-10) | F-007 | 高风险新功能，需独立分支开发 |
| 可选 | F-008 | 低优先级，可推迟到 v1.7.1 |

### 7.3 关键依赖关系

```
F-003 (SQL helpers 去重) ──> F-007 (SQLite)  [SQLite 需要在共享模块中新增方言]
F-001 (版本号统一) ──> 无依赖
F-002 (脱敏修正) ──> 无依赖
F-004 (自动分页) ──> F-007 (SQLite)  [分页需支持 SQLite 方言]
F-005 (redis_type) ──> 无依赖
F-006 (错误信息) ──> 无依赖（但建议先做，后续功能复用错误格式）
```

---

## 八、总结与建议

### 8.1 架构可行性结论

v1.7.0 的 9 个功能在当前架构下**均可实现**，但需注意：

1. **SQLite 引擎是最大的架构变更**，需要修改类型系统、配置解析、工具注册、驱动工厂等多个核心模块，建议在独立分支开发
2. **strict-v2 脱敏修正是最敏感的行为变更**，虽然技术上简单，但可能影响现有用户的感知
3. **自动分页需要仔细处理 SQL 方言差异**，MSSQL/Oracle 的 OFFSET 语法复杂度较高

### 8.2 关键建议

1. **先做 F-003（去重）再做 F-007（SQLite）**：去重后的共享模块是 SQLite 方言支持的基础
2. **F-007 使用 optionalDependencies + 动态 import**：避免原生模块编译失败影响整体安装
3. **F-002 的 loose 模式修正需在 CHANGELOG 中明确标注**：这是行为变化，虽然符合文档描述
4. **F-004 自动分页建议先支持 MySQL/PG/SQLite**：MSSQL/Oracle 的复杂语法可作为后续迭代
5. **F-006 错误信息增强建议先定义错误码规范**：后续所有功能复用统一的错误格式

### 8.3 工期风险评估

PRD 规划 10 个工作日完成 9 个功能，工期**偏紧**。建议：

- F-007（SQLite）预留 16h 可能不够，建议预留 20-24h
- F-006（错误信息增强）涉及多个文件修改和测试更新，4h 偏紧，建议 6-8h
- 建议 F-008（连接诊断）作为可选项，优先保证 P0/P1 功能质量

---

*文档结束 | 评审人: ___________ | 评审日期: ___________*
