# v1.8.0 迭代计划：Streamable HTTP 传输与运维增强

**文档编号**: ITER-v1.8.0
**版本**: 1.0
**日期**: 2026-07-09
**目标版本**: v1.8.0
**迭代类型**: Minor / Transport & Operations
**建议周期**: 10 个工作日
**状态**: 已完成
**前置依赖**: v1.7.1、v1.7.2、v1.7.3 完成
**上游依据**: `docs/ADR-001-streamable-http.md`、`docs/PRD-v1.8.0.md`、`docs/ROADMAP.md`

---

## 一、迭代目标

v1.8.0 将项目从纯本地 stdio MCP server 扩展为 **stdio + Streamable HTTP 双传输 MCP server**。本版本的核心原则是：

1. **默认不破坏**：无参数启动仍保持 stdio 行为。
2. **显式开启 HTTP**：只有配置 `DB_MCP_TRANSPORT=http` 或 CLI 参数时才启动 HTTP。
3. **安全默认**：HTTP 默认监听 `127.0.0.1`，远程访问必须显式配置认证和 Origin。
4. **运维可用**：提供 health/readiness endpoint、结构化日志、Docker 示例和 smoke test。
5. **安全边界不变**：HTTP 仅为传输层，不得绕过工具层 readonly、注入检测、脱敏、审计和 allowlist/keyPrefix。

---

## 二、成功指标

| 指标 | 目标 |
|------|------|
| stdio 兼容 | 默认启动和 v1.7.x 行为一致，现有测试不回归 |
| HTTP 可用 | POST `/mcp` 可完成 initialize/listTools/callTool |
| 健康检查 | `/healthz`、`/readyz` 可用于 Docker/Kubernetes 探活 |
| 安全默认 | 默认 localhost，Origin/API key/body limit 有测试 |
| 文档完整 | README、CONFIG、API、CHANGELOG 均说明 HTTP 模式 |
| 验证命令 | build/test/lint/typecheck/pack dry-run 全部通过 |

---

## 三、范围边界

### 3.1 纳入范围

| 编号 | 类型 | 内容 |
|------|------|------|
| S-001 | Transport | stdio/http 双模式启动 |
| S-002 | HTTP | POST `/mcp` MCP JSON-RPC endpoint |
| S-003 | Health | `/healthz`、`/readyz` |
| S-004 | Security | host 默认值、Origin allowlist、API key、body limit、timeout |
| S-005 | Ops | Docker/Compose 示例、日志字段、smoke test |
| S-006 | Docs | README/CONFIG/API/CHANGELOG 更新 |
| S-007 | Tests | HTTP config/security/health/integration 测试 |

### 3.2 不纳入范围

| 内容 | 原因 | 后续版本 |
|------|------|----------|
| 完整 OAuth 2.1 | 需要独立认证授权设计 | v2.0.0 |
| RBAC | 需要 subject/resource/action 权限模型 | v2.0.0 |
| 多租户隔离 | 需要连接池、配置、审计隔离 | v2.0+ |
| SSE resumability | 需要 session 和 event store | v1.8.x / v2.0 |
| Web UI | 偏离当前 server 核心 | 重新评估 |

---

## 四、任务分解

### Epic A：Transport 架构拆分

#### A-001：抽取 stdio transport

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `src/transports/stdio.ts`, `src/index.ts` |
| 预估 | 0.5 天 |

要求：

1. 将现有 `StdioServerTransport` 启动逻辑封装为函数。
2. `src/index.ts` 只负责加载 env、处理 CLI、创建 registry/server、选择 transport。
3. stdio 模式 stdout 不输出日志或普通文本。
4. 现有启动行为保持兼容。

验收：

- [x] 无参数启动仍使用 stdio。
- [x] 现有工具测试全部通过。
- [x] `src/index.ts` transport 选择逻辑清晰。

#### A-002：HTTP 配置解析

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `src/core/http-config.ts`, `test/transports/http-config.test.mjs` |
| 预估 | 0.5 天 |

配置项：

| 变量 | 默认值 | 校验 |
|------|--------|------|
| `DB_MCP_TRANSPORT` | `stdio` | `stdio`/`http` |
| `DB_HTTP_HOST` | `127.0.0.1` | 非空字符串 |
| `DB_HTTP_PORT` | `3000` | 1-65535 |
| `DB_HTTP_ENDPOINT` | `/mcp` | 必须以 `/` 开头 |
| `DB_HTTP_ORIGINS` | 空 | 逗号分隔 URL/origin |
| `DB_HTTP_API_KEY` | 空 | 不记录原文 |
| `DB_HTTP_AUTH_DISABLED` | `false` | boolean |

验收：

- [x] 默认值测试覆盖。
- [x] 非法端口、非法 transport、非法 endpoint 抛出清晰错误。
- [x] API key 不进入日志。

---

### Epic B：HTTP MCP endpoint

#### B-001：实现 HTTP server

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `src/transports/http.ts` |
| 预估 | 1.0 天 |

要求：

1. 使用 MCP TypeScript SDK 支持的 Streamable HTTP transport 或最小兼容封装。
2. POST `DB_HTTP_ENDPOINT` 接收 MCP JSON-RPC 请求。
3. 返回符合 MCP 客户端预期的响应。
4. GET/DELETE 若未实现，返回明确 405 和 JSON 错误。
5. 支持优雅关闭。

验收：

- [x] HTTP client 可 initialize。
- [x] HTTP client 可 listTools。
- [x] HTTP client 可 callTool。
- [x] GET `/mcp` 行为与文档一致。

#### B-002：HTTP integration tests

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `test/transports/http.test.mjs` |
| 预估 | 1.0 天 |

测试场景：

| 编号 | 场景 | 断言 |
|------|------|------|
| B-002-1 | 启动 HTTP server | 绑定随机端口成功 |
| B-002-2 | initialize | 返回 MCP 初始化响应 |
| B-002-3 | listTools | 能看到至少一个工具 |
| B-002-4 | callTool readonly | mock/sqlite readonly 查询成功 |
| B-002-5 | callTool write blocked | `sql_query` 写 SQL 被拒绝 |
| B-002-6 | invalid JSON | 返回 400 或 MCP error |
| B-002-7 | unsupported method | GET/DELETE 返回声明的状态 |

---

### Epic C：HTTP 安全中间件

#### C-001：Origin allowlist

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `src/transports/http.ts`, `test/transports/http-security.test.mjs` |
| 预估 | 0.5 天 |

要求：

- 对带 `Origin` 的请求执行 allowlist 校验。
- 无 Origin 的本地服务端调用可允许，但需文档说明。
- 拒绝时返回 403，不执行 MCP handler。

#### C-002：API key 轻量保护

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `src/transports/http.ts`, `docs/CONFIG.md`, `docs/ERRORS.md` |
| 预估 | 0.5 天 |

要求：

- 支持 `Authorization: Bearer <key>`。
- 可选支持 `x-api-key`，但文档推荐 Bearer。
- `DB_HTTP_AUTH_DISABLED=true` 才能关闭认证。
- 默认 localhost 不强制 API key；监听非本地地址时必须配置 API key，除非显式 `DB_HTTP_AUTH_DISABLED=true`。

#### C-003：Body limit 和 request timeout

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `src/transports/http.ts`, `src/core/http-config.ts` |
| 预估 | 0.5 天 |

要求：

- 限制 JSON body 大小。
- HTTP request timeout 与 DB query timeout 分离。
- 超限错误使用 `HTTP_002` 或同等错误码。

---

### Epic D：Health、Readiness 和运维

#### D-001：Health endpoints

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `src/transports/health.ts`, `test/transports/health.test.mjs` |
| 预估 | 0.5 天 |

语义：

| Endpoint | 语义 | 是否 ping DB |
|----------|------|------------|
| `/healthz` | 进程活着 | 否 |
| `/readyz` | registry/server 已准备好 | 可配置，默认检查默认连接状态或启动时 ping 结果 |

#### D-002：Docker/Compose HTTP 示例

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `docker-compose.yml`, `README.md`, `docs/CONFIG.md` |
| 预估 | 0.5 天 |

要求：

- 展示 HTTP 模式环境变量。
- healthcheck 使用 `/healthz` 或 `/readyz`。
- 不包含生产凭证。

#### D-003：Smoke test 脚本

| 属性 | 内容 |
|------|------|
| 优先级 | P2 |
| 文件 | `scripts/http-smoke.mjs` |
| 预估 | 0.5 天 |

要求：

- 可对本地 HTTP endpoint 执行 initialize/listTools。
- 支持 API key。
- 输出适合 CI 或手动排障。

---

### Epic E：文档、发布和质量

#### E-001：文档更新

| 文件 | 内容 |
|------|------|
| `README.md` / `README_en.md` | stdio 默认、HTTP 启动、健康检查、安全默认值 |
| `docs/CONFIG.md` | HTTP 环境变量从前瞻改为当前实现 |
| `docs/API.md` | HTTP transport 使用说明或链接 |
| `docs/ERRORS.md` | HTTP 错误码落地 |
| `CHANGELOG.md` | v1.8.0 变更 |

#### E-002：质量报告

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `docs/QUALITY-v1.8.0-质量报告.md` |
| 预估 | 0.5 天 |

必须复核：

- stdio 兼容性。
- HTTP 安全默认值。
- 只读/注入/脱敏/审计安全边界。
- 新增测试覆盖。
- package dry-run。

---

## 五、执行排期

| Day | 任务 | 目标 |
|-----|------|------|
| Day 1 | A-001, A-002 | transport 抽象和 HTTP config 完成 |
| Day 2 | B-001 初版 | HTTP server 可启动，POST `/mcp` 初步可用 |
| Day 3 | B-002 | HTTP initialize/listTools/callTool 测试 |
| Day 4 | C-001, C-002 | Origin/API key 安全中间件 |
| Day 5 | C-003, D-001 | body limit、timeout、health/readiness |
| Day 6 | D-002, D-003 | Docker 示例和 smoke test |
| Day 7 | E-001 | README/CONFIG/API/ERRORS 文档更新 |
| Day 8 | 全量测试与修复 | build/test/lint/typecheck |
| Day 9 | E-002 | v1.8.0 质量报告和 pack dry-run |
| Day 10 | Review/RC | 准备发布或进入 RC |

---

## 六、测试计划

### 6.1 必跑命令

```powershell
npm run build
npm test
npm run lint
npm run typecheck
npm pack --dry-run
```

### 6.2 新增测试文件

| 文件 | 内容 |
|------|------|
| `test/transports/http-config.test.mjs` | 配置解析 |
| `test/transports/http-security.test.mjs` | Origin/API key/body limit |
| `test/transports/http.test.mjs` | MCP HTTP endpoint |
| `test/transports/health.test.mjs` | health/readiness |

### 6.3 回归重点

- `test/tools/sql.test.mjs`：`sql_query` 只读保护。
- `test/tools/redis.test.mjs`：keyPrefix 和 readonly。
- `test/tools/mongo.test.mjs`：NoSQL 注入和 allowlist。
- `test/config.test.mjs`：旧配置不受 HTTP env 影响。

---

## 七、验收清单

- [x] 默认 stdio 模式不变。
- [x] HTTP 模式可通过 env/CLI 启动。
- [x] POST `/mcp` 可 initialize/listTools/callTool。
- [x] GET/DELETE `/mcp` 有明确实现或 405。
- [x] `/healthz` 和 `/readyz` 可用。
- [x] Origin/API key/body limit/timeout 有测试。
- [x] HTTP 模式不绕过 SQL/Mongo/Redis 安全边界。
- [x] Docker/Compose 示例可用。
- [x] README/CONFIG/API/ERRORS/CHANGELOG 已更新。
- [x] `npm run build`、`npm test`、`npm run lint`、`npm run typecheck`、`npm pack --dry-run` 通过。

---

## 八、风险与回滚

| 风险 | 等级 | 缓解 | 回滚 |
|------|------|------|------|
| HTTP transport 破坏 stdio | 高 | transport 模块隔离，stdio 回归测试 | 关闭 HTTP 分支，保留 stdio |
| HTTP 暴露安全风险 | 高 | 默认 localhost、认证、Origin、body limit | 默认禁用 HTTP |
| SDK API 变化 | 中 | 实施前锁定 SDK 版本，写适配层 | 回退适配层 |
| SSE 范围膨胀 | 中 | v1.8.0 只做 stateless-first | GET 405 文档化 |
| 测试 flaky | 中 | 使用随机端口、显式关闭 server | 修测试确定性 |

---

## 九、决策结果

1. v1.8.0 使用 POST JSON response；GET/DELETE `/mcp` 返回 405。
2. localhost HTTP 不强制 API key；非本地监听必须配置 API key 或显式关闭认证。
3. API key 同时支持 Bearer 和 `x-api-key`。
4. `/readyz` 使用启动时 ping 状态。
5. v1.8.0 提供 Dockerfile 与 compose 示例，不发布镜像。

---

## 十、Definition of Done

v1.8.0 只有满足以下条件才视为完成：

1. PRD/ADR 的 P0 项全部完成或有正式接受风险记录。
2. 默认 stdio 完全兼容。
3. HTTP endpoint 有安全测试和 MCP 调用测试。
4. 数据库工具安全边界未被削弱。
5. 文档和 CHANGELOG 与实现一致。
6. 全量验证命令通过。
7. `docs/QUALITY-v1.8.0-质量报告.md` 填写完成。

---

## 十一、完成记录

详见 `docs/QUALITY-v1.8.0-质量报告.md`。本轮交付包括 HTTP transport、health/readiness、Origin/API key/body limit、Docker/Compose 示例、HTTP smoke test、README/CONFIG/API/ERRORS/CHANGELOG 同步和 transport 测试。
