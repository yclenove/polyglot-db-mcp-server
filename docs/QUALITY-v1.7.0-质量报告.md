# polyglot-db-mcp-server v1.7.0 质量报告

> 审查日期：2026-05-05
> 审查范围：11 个变更文件（2 个新建 + 9 个修改）
> 审查人：质量门禁 AI

---

## 审查结果：有条件通过

版本 v1.7.0 的代码变更整体质量良好，架构设计合理，向后兼容性好。但存在 **2 个高优先级问题** 和 **5 个中优先级问题** 需要在正式发布前解决。

---

## 发现的问题

### 高优先级（High）

#### H-1：package.json 版本号未更新至 1.7.0

- **文件**：`package.json`（第 3 行）
- **描述**：当前 `package.json` 中 `"version": "1.6.0"`，但本版本应为 v1.7.0。`src/core/version.ts` 的 `getVersion()` 函数会读取此值作为服务器版本号，导致版本信息错误。
- **影响**：运行时 `server_info` 等工具返回的版本号为 "1.6.0" 而非 "1.7.0"，对用户造成混淆。
- **建议**：在发布前将 `package.json` 的 `version` 字段更新为 `"1.7.0"`。

#### H-2：sql_call_procedure 存在 SQL 注入风险

- **文件**：`src/tools/sql.ts`（第 639-659 行）
- **描述**：`sql_call_procedure` 工具的 `procedure` 参数在 PostgreSQL、MSSQL、Oracle 引擎下直接拼接到 SQL 中，未调用 `validateIdent()` 进行校验。仅 MySQL 使用了反引号转义（`procedure.replace(/`/g, '')`），但该转义本身也不足以防止注入。
- **代码片段**：
  ```typescript
  case 'postgres':
    sql = `CALL ${procedure}(${params?.map((_, i) => `$${i + 1}`).join(', ') || ''})`;
    break;
  case 'mssql':
    sql = `EXEC ${procedure} ${params?.map((_, i) => `@p${i}`).join(', ') || ''}`;
    break;
  case 'oracle':
    sql = `BEGIN ${procedure}(${params?.map((_, i) => `:p${i}`).join(', ') || ''}); END;`;
    break;
  ```
- **影响**：恶意用户可通过 `procedure` 参数注入任意 SQL 语句。
- **建议**：在函数入口处添加 `validateIdent(procedure, 'procedure')` 调用。

---

### 中优先级（Medium）

#### M-1：新增模块缺少独立单元测试

- **描述**：以下新建/修改的核心模块没有对应的独立测试文件：
  - `src/core/query-cache.ts` — 无 `test/query-cache.test.mjs`
  - `src/core/rate-limiter.ts` — 无 `test/rate-limiter.test.mjs`
  - `src/core/sql-helpers.ts` — 无 `test/sql-helpers.test.mjs`
  - `src/core/version.ts` — 无 `test/version.test.mjs`
  - `src/tools/advisor.ts` — `test/query-suggest.test.mjs` 仅覆盖 `query-suggest.ts` 的核心函数，未覆盖 `advisor.ts` 中的 `extractReferencedTables`、`fetchTableInfo` 以及工具注册逻辑。
- **影响**：核心逻辑缺乏测试覆盖，回归风险高。
- **建议**：
  - 为 `QueryCache` 添加测试：LRU 淘汰、TTL 过期、缓存命中率统计。
  - 为 `RateLimiter` 添加测试：令牌桶补充、限流触发、并发安全。
  - 为 `sql-helpers.ts` 的 `describeTableSql`、`listIndexesSql`、`listTablesSql` 添加多引擎测试。
  - 为 `advisor.ts` 添加集成测试。

#### M-2：RateLimiter 存在内存泄漏风险

- **文件**：`src/core/rate-limiter.ts`（第 7 行）
- **描述**：`RateLimiter.buckets` Map 持续增长，从未清理不活跃的连接桶。长时间运行后，大量不活跃连接的桶会占用内存。
- **影响**：在高连接数场景下，内存使用量会持续增长。
- **建议**：添加定期清理机制，移除超过 N 分钟未使用的桶：
  ```typescript
  private cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - 300_000; // 5 分钟
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff) this.buckets.delete(key);
    }
  }, 60_000).unref();
  ```

#### M-3：MSSQL EXPLAIN 语法在单一语句中无法正常工作

- **文件**：`src/tools/sql.ts`（第 552-553 行）和 `src/tools/advisor.ts`（第 203-204 行）
- **描述**：MSSQL 的 `SET SHOWPLAN_ALL ON` 要求与后续 SQL 在不同的批处理中执行（使用 `GO` 分隔或通过 `sp_executesql`），但代码将其合并为单个语句 `SET SHOWPLAN_ALL ON; ${sql}; SET SHOWPLAN_ALL OFF`。大多数 MSSQL 驱动会将分号分隔的语句作为单个批处理发送，SHOWPLAN_ALL 可能不会正确生效。
- **影响**：MSSQL 引擎的 EXPLAIN 功能可能返回错误结果或执行失败。
- **建议**：将三条语句拆分为独立的 `driver.execute()` 调用，或参考各驱动文档确认批处理行为。

#### M-4：query_cache 的 cacheKey 使用 JSON.stringify 存在边界风险

- **文件**：`src/core/query-cache.ts`（第 84-86 行）
- **描述**：`cacheKey` 函数使用 `JSON.stringify(params)` 生成缓存键。当参数包含 `undefined`、`Date`、`BigInt` 等特殊类型时，`JSON.stringify` 的行为可能导致不同参数产生相同键。
- **代码片段**：
  ```typescript
  export function cacheKey(connectionId: string, sql: string, params: unknown[]): string {
    return `${connectionId}:${sql}:${JSON.stringify(params)}`;
  }
  ```
- **影响**：极端情况下可能导致缓存脏读。
- **建议**：对参数序列化添加类型标记或使用更安全的序列化方式。

#### M-5：sql_query 分页逻辑中 OFFSET 注入使用数字拼接

- **文件**：`src/tools/sql.ts`（第 77-87 行）
- **描述**：自动分页逻辑中，`offset` 和 `page_size` 直接通过模板字符串拼接到 SQL 中。虽然这些值来自经过 Zod 验证的 `number.int()`，但仍属于数字注入拼接模式，不符合参数化查询的最佳实践。
- **代码片段**：
  ```typescript
  finalSql = `${sql} LIMIT ${page_size} OFFSET ${offset}`;
  ```
- **影响**：当前无实际安全风险（因为值已验证为整数），但违反了安全编码规范。
- **建议**：在驱动层支持 LIMIT/OFFSET 参数化，或在文档中注明此为已知设计决策。

---

### 低优先级（Low）

#### L-1：Oracle 表名大小处理可能导致查询失败

- **文件**：`src/core/sql-helpers.ts`（第 44 行）
- **描述**：Oracle 驱动中 `describeTableSql` 使用 `table.toUpperCase()`，但 Oracle 支持大小写敏感的标识符（使用双引号创建的表名）。如果用户创建了小写表名（如 `"my_table"`），`toUpperCase()` 会导致查询失败。
- **建议**：在文档中说明此限制，或支持大小写敏感模式。

#### L-2：query_suggest 的 extractReferencedTables 使用简单正则

- **文件**：`src/tools/advisor.ts`（第 17-32 行）
- **描述**：`extractReferencedTables` 使用正则表达式提取表名，对于包含子查询、CTE、别名等复杂 SQL 可能产生误报或遗漏。
- **影响**：建议的准确性可能受影响，但不会导致功能错误。
- **建议**：在工具描述中注明此局限性，或考虑引入简单的 SQL 解析器。

#### L-3：版本回退方案的 import.meta.url 依赖

- **文件**：`src/core/version.ts`（第 13 行）
- **描述**：`createRequire(import.meta.url)` 在某些打包工具（如 esbuild、webpack）处理后可能无法正确解析 `package.json` 路径。
- **影响**：当前项目使用 `tsc` 直接编译，不受影响。但如果未来切换打包工具，需要验证。
- **建议**：在 CI 中添加版本号端到端测试。

---

## 向后兼容性评估：通过

| 维度 | 评估 | 说明 |
|------|------|------|
| API 接口 | 通过 | 所有现有工具接口不变，新增工具为纯增量 |
| 类型定义 | 通过 | `types.ts` 仅新增类型和字段，无修改或删除 |
| 环境变量 | 通过 | 新增环境变量均有默认值，无环境变量行为变更 |
| 驱动接口 | 通过 | `RedisDriver` 和 `MongoDriver` 新增方法为纯增量 |
| 配置格式 | 通过 | `ConnectionSpec` 新增 `keyPrefix` 字段为可选 |

---

## 安全性评估：有条件通过

| 维度 | 评估 | 说明 |
|------|------|------|
| SQL 注入防护 | 部分通过 | H-2：`sql_call_procedure` 的 procedure 参数未校验 |
| Redis 命令管控 | 通过 | 禁止命令列表完整，keyPrefix 验证到位 |
| 只读保护 | 通过 | 所有写操作均检查 readonly 标志 |
| 数据脱敏 | 通过 | strict-v2 模式实现正确，双重校验逻辑清晰 |
| 审计日志 | 通过 | 所有新 Redis 操作均有审计记录 |
| 凭证安全 | 通过 | 无新的凭证泄露风险 |

---

## 性能评估：通过

| 维度 | 评估 | 说明 |
|------|------|------|
| 查询缓存 | 正面 | LRU 缓存可显著减少重复查询开销 |
| 速率限制 | 中性 | 令牌桶算法开销极低，对正常请求无感知 |
| 分页优化 | 正面 | 自动 LIMIT/OFFSET 防止无界结果集 |
| 内存使用 | 注意 | M-2：RateLimiter 桶未清理，长期运行有增长风险 |
| Redis 操作 | 正面 | 所有新操作为单次网络往返，无额外开销 |

---

## 代码质量评估

### 优点

1. **架构清晰**：`sql-helpers.ts` 抽取公共 SQL 生成逻辑，消除了 `sql.ts` 中的重复代码，符合 DRY 原则。
2. **穷尽性检查**：所有 `switch(engine)` 均使用 `const e: never = engine` 进行穷尽性检查，确保新增引擎时编译器会提醒。
3. **一致的错误处理**：所有新工具遵循统一的 try-catch 模式，错误信息结构一致。
4. **配置驱动**：缓存大小、TTL、速率限制等均通过环境变量配置，灵活且有合理默认值。
5. **Redis 安全层完整**：所有写操作检查 readonly、keyPrefix、审计日志，安全层无遗漏。
6. **脱敏模块设计合理**：纯函数方案，驱动层无感知，工具层拦截，职责分离清晰。
7. **环形缓冲实现**：`query-replay.ts` 使用 head/count + modulo 索引，O(1) 插入，避免了 `Array.shift()` 的 O(n) 开销。

### 改进建议

1. **统一 SQL 生成工具**：`advisor.ts` 中的 `fetchTableInfo` 函数与 `sql.ts` 中的 `sql_describe_table`、`sql_list_indexes` 逻辑重复。建议提取为共享的 service 层。
2. **错误码体系**：新增的工具仍使用 `throw new Error()` 字符串，建议统一使用 `src/core/error-codes.ts` 中定义的错误码。
3. **Zod schema 类型复用**：多个工具的 `connection_id: z.string().optional()` 重复定义，建议抽取为共享 schema。
4. **日志规范化**：`query-suggest.ts` 中使用 `console.warn` 输出超时日志，建议统一使用 `src/core/logger.ts` 的结构化日志。

---

## 测试覆盖评估

### 现有测试覆盖

| 模块 | 测试文件 | 覆盖状态 |
|------|----------|----------|
| data-masking.ts | test/data-masking.test.mjs, test/strict-v2.test.mjs | 良好 |
| query-suggest.ts | test/query-suggest.test.mjs | 良好 |
| redis tools | test/tools/redis.test.mjs | 良好（含 v1.3.0 新工具） |
| sql tools | test/tools/sql.test.mjs | 良好（含分页测试） |
| redis-driver.ts | test/drivers/redis-driver.test.mjs | 良好 |
| sql-guards.ts | test/sql-guards.test.mjs | 良好 |

### 缺失测试

| 模块 | 缺失测试 | 优先级 |
|------|----------|--------|
| query-cache.ts | LRU 淘汰、TTL 过期、命中率统计 | 高 |
| rate-limiter.ts | 令牌桶算法、限流触发 | 高 |
| sql-helpers.ts | 多引擎 SQL 生成 | 高 |
| version.ts | 版本读取 fallback 链 | 中 |
| advisor.ts (工具层) | fetchTableInfo 集成、extractReferencedTables | 中 |
| registry.ts (新增方法) | recordRequest、getMetrics | 中 |

---

## 总体评分

| 维度 | 评分 | 权重 | 加权分 |
|------|------|------|--------|
| 代码质量 | 8.5/10 | 30% | 2.55 |
| 向后兼容性 | 9.5/10 | 20% | 1.90 |
| 安全性 | 7.5/10 | 25% | 1.88 |
| 测试覆盖 | 6.5/10 | 15% | 0.98 |
| 性能 | 8.5/10 | 10% | 0.85 |
| **总分** | | **100%** | **8.16/10** |

---

## 发布前必须修复

1. **H-1**：更新 `package.json` 版本号为 `"1.7.0"`
2. **H-2**：在 `sql_call_procedure` 中对 `procedure` 参数添加 `validateIdent()` 校验

## 发布前建议修复

3. **M-1**：为 `query-cache.ts`、`rate-limiter.ts`、`sql-helpers.ts` 添加单元测试
4. **M-2**：为 `RateLimiter` 添加桶清理机制
5. **M-3**：验证 MSSQL EXPLAIN 语法在目标驱动下的行为

---

> 本报告基于静态代码审查生成，建议结合集成测试和实际环境验证后发布。
