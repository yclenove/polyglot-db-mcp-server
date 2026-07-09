# ADR-001: v1.8.0 Streamable HTTP 传输方案

**文档编号**: ADR-001
**版本**: 1.0
**日期**: 2026-07-09
**状态**: Proposed
**目标版本**: v1.8.0
**关联文档**: `docs/ROADMAP.md`, `docs/ITER-v1.7.2-迭代计划.md`, `docs/ITER-v1.7.3-迭代计划.md`
**参考来源**: [MCP Transports specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), [MCP TypeScript SDK docs](https://ts.sdk.modelcontextprotocol.io/)

---

## 一、背景

当前项目以 stdio 传输为主，适合 Claude Desktop、Cursor 等本地进程拉起的使用方式。随着项目向企业部署、容器化和远程访问演进，v1.8.0 需要引入 Streamable HTTP 传输，同时保持 stdio 完全兼容。

官方 MCP 规范把 stdio 与 Streamable HTTP 定义为标准传输方式；Streamable HTTP 使用 HTTP POST/GET，并可选使用 SSE 承载服务端流式消息。MCP TypeScript SDK 文档也将 Streamable HTTP 作为远程服务器推荐传输，同时保留 stdio 用于本地集成。

---

## 二、决策

v1.8.0 采用 **双传输模式**：

1. **默认保持 stdio**：不传新参数时，行为与 v1.7.x 完全一致。
2. **显式启用 HTTP**：通过 CLI 参数或环境变量启用 Streamable HTTP server。
3. **单 MCP endpoint**：默认 endpoint 为 `/mcp`，同时支持 POST 和 GET。
4. **首版优先 JSON 响应**：先支持 JSON response mode；SSE GET 和 resumability 作为 P1/P2 分阶段实现。
5. **本地安全默认值**：默认绑定 `127.0.0.1`，显式配置才允许 `0.0.0.0`。
6. **认证分层演进**：v1.8.0 可提供 API key 轻量保护；完整 OAuth 2.1/RBAC 留到 v2.0.0。

---

## 三、目标与非目标

### 3.1 目标

| 编号 | 目标 | 验收 |
|------|------|------|
| G-001 | 支持 stdio + HTTP 双模式 | 现有 stdio 测试不变，新增 HTTP 测试通过 |
| G-002 | HTTP 模式支持 MCP 初始化和工具调用 | 可通过 SDK client 调用 `listTools` 和 `callTool` |
| G-003 | 提供 `/healthz` 和 `/readyz` | 容器和平台可探活 |
| G-004 | 默认安全绑定 | 默认 host 为 `127.0.0.1`，远程绑定需显式配置 |
| G-005 | Origin 校验 | HTTP 模式默认校验 Origin allowlist |
| G-006 | 日志不污染 MCP 消息 | stdio 继续只在 stderr 输出日志，HTTP 使用结构化日志 |

### 3.2 非目标

| 非目标 | 原因 | 后续版本 |
|--------|------|----------|
| 完整 OAuth 2.1 | 认证授权模型复杂，需要独立设计 | v2.0.0 |
| 细粒度 RBAC | 依赖 subject/resource/action 模型 | v2.0.0 |
| 全量 SSE resumability | 需要 session 和 event store | v1.8.x 或 v2.0 |
| 多租户隔离 | 需要配置、审计、连接池隔离 | v2.0+ |
| HTTP+SSE 旧协议兼容 | 首版降低复杂度 | 视用户需求评估 |

---

## 四、接口设计

### 4.1 CLI 与环境变量

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `DB_MCP_TRANSPORT` | `stdio` | `stdio` 或 `http` |
| `DB_HTTP_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `DB_HTTP_PORT` | `3000` | HTTP 监听端口 |
| `DB_HTTP_ENDPOINT` | `/mcp` | MCP endpoint |
| `DB_HTTP_ORIGINS` | 空 | 逗号分隔 Origin allowlist；本地模式可允许无 Origin |
| `DB_HTTP_API_KEY` | 空 | v1.8 轻量 API key；为空时仅允许 localhost 或显式禁用 |
| `DB_HTTP_AUTH_DISABLED` | `false` | 显式关闭 HTTP 认证，仅建议本地开发 |

CLI 示例：

```powershell
polyglot-db-mcp-server --transport stdio
polyglot-db-mcp-server --transport http --host 127.0.0.1 --port 3000
```

### 4.2 HTTP endpoint

| Method | Path | 用途 |
|--------|------|------|
| POST | `/mcp` | 客户端发送 JSON-RPC 请求/通知/响应 |
| GET | `/mcp` | 可选 SSE stream；首版可返回 405 并文档化 |
| DELETE | `/mcp` | 可选 session 终止；首版可返回 405 |
| GET | `/healthz` | 进程健康，不强制 ping 数据库 |
| GET | `/readyz` | registry 已加载，默认连接状态可用 |

### 4.3 模块边界

建议新增模块：

| 文件 | 职责 |
|------|------|
| `src/transports/stdio.ts` | 封装现有 stdio 启动逻辑 |
| `src/transports/http.ts` | HTTP server、endpoint、Origin/auth 中间件 |
| `src/transports/health.ts` | healthz/readyz 逻辑 |
| `src/core/http-config.ts` | HTTP 配置解析和校验 |
| `test/transports/http.test.mjs` | HTTP transport 单元/集成测试 |

现有 `src/index.ts` 只负责：加载 env、解析 CLI/transport、创建 registry/server、选择 transport、优雅关闭。

---

## 五、安全设计

### 5.1 必须实现

| 安全项 | 要求 |
|--------|------|
| Host 默认值 | 默认 `127.0.0.1`，避免无意暴露到局域网 |
| Origin 校验 | 对带 Origin 的请求执行 allowlist 检查 |
| 认证 | 非 localhost 或生产模式必须配置 API key，除非显式禁用 |
| Body 限制 | 限制 JSON body 大小，防止内存耗尽 |
| 超时 | HTTP request timeout 与查询 timeout 分离 |
| 日志脱敏 | headers、query、错误消息不得泄露 token/connection string |
| CORS | 默认关闭跨域；如开启必须与 Origin allowlist 一致 |

### 5.2 保持既有数据库安全边界

HTTP 只是传输层，不得改变工具安全语义：

- `sql_query` 必须继续先执行 `isReadOnlyQuery`，再调用 driver。
- SQL/Mongo/Redis 写操作必须继续检查 readonly。
- Redis 必须继续检查 keyPrefix。
- Mongo collection allowlist 和 NoSQL 注入检测不得绕过。
- 审计日志必须包含 HTTP/stdio transport 维度，但不得记录敏感 token。

---

## 六、会话策略

### 6.1 v1.8.0 首版策略

采用 **stateless-first**：

- 不主动创建长期 session store。
- POST 请求完成即返回 JSON 或短 SSE。
- GET `/mcp` 首版可返回 405，表示暂不提供独立 server-to-client SSE stream。
- 如 SDK transport 要求 session header，则使用 SDK 推荐最小实现，并加入测试。

### 6.2 后续增强

| 能力 | 版本 | 说明 |
|------|------|------|
| SSE GET | v1.8.x | 支持服务端通知和长连接 |
| Resumability | v2.0+ | 需要 event id 和 session event store |
| Session DELETE | v1.8.x | 显式释放会话资源 |
| OAuth session | v2.0 | 与认证授权统一设计 |

---

## 七、测试计划

### 7.1 单元测试

| 测试 | 断言 |
|------|------|
| HTTP config parse | 默认值、安全约束、非法端口、endpoint 格式 |
| Origin allowlist | 允许、拒绝、无 Origin、本地例外 |
| API key middleware | 缺失、错误、正确、禁用开关 |
| healthz/readyz | 健康与未就绪状态 |

### 7.2 集成测试

| 测试 | 断言 |
|------|------|
| initialize over HTTP | 返回 MCP 初始化结果 |
| listTools over HTTP | 能列出工具 |
| call sql_query over HTTP | readonly 查询成功 |
| write query blocked | `sql_query` 写入仍被 MCP 层拒绝 |
| body too large | 返回 413 或明确错误 |
| invalid origin | 返回 403 |

### 7.3 必跑命令

```powershell
npm run build
npm test
npm run lint
npm run typecheck
```

如新增 HTTP 依赖，必须额外运行：

```powershell
npm audit --production
npm pack --dry-run
```

---

## 八、迁移与兼容

| 维度 | 策略 |
|------|------|
| 默认启动 | 保持 stdio，不破坏现有 MCP desktop 配置 |
| 环境变量 | HTTP 变量均为新增，有默认值 |
| 工具协议 | 工具名、参数、返回结构默认不变 |
| 日志 | stdio stdout 不输出非 MCP 消息 |
| Docker | HTTP 模式可作为容器默认，但 npm binary 默认仍 stdio |

---

## 九、备选方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 只支持 stdio | 最稳定 | 无法远程部署 | 不满足长期目标 |
| HTTP 作为默认 | 容器友好 | 破坏桌面用户预期 | 不采用 |
| 同时实现 OAuth | 企业能力完整 | 范围过大，风险高 | 延后 v2.0 |
| 旧 HTTP+SSE 兼容 | 支持旧客户端 | 增加复杂度 | 暂不做，按需求评估 |

---

## 十、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| SDK Streamable HTTP API 变化 | 中 | 中 | 实施前锁定 SDK 版本并参考官方 examples |
| 本地 HTTP 暴露导致安全风险 | 中 | 高 | 默认 localhost、Origin 校验、认证提示 |
| HTTP 模式绕过现有审计 | 低 | 高 | 在工具层统一审计，transport 只加上下文 |
| SSE/session 首版复杂度超出预期 | 中 | 中 | v1.8.0 stateless-first，GET 可 405 |
| 客户端兼容性差异 | 中 | 中 | 提供 SDK client 测试和 curl smoke test |

---

## 十一、验收清单

- [ ] 默认 `polyglot-db-mcp-server` 仍走 stdio。
- [ ] `--transport http` 或 `DB_MCP_TRANSPORT=http` 可启动 HTTP server。
- [ ] `/healthz` 和 `/readyz` 可访问。
- [ ] POST `/mcp` 可完成 initialize/listTools/callTool。
- [ ] GET `/mcp` 行为符合实现声明：SSE 或 405。
- [ ] Origin 校验和 API key 保护有测试。
- [ ] HTTP 模式下 `sql_query` 只读保护仍有效。
- [ ] README/CONFIG/API 描述 HTTP 启动和安全默认值。
- [ ] `npm run build`、`npm test`、`npm run lint` 通过。

---

## 十二、实施前检查

实施 v1.8.0 前必须完成：

1. v1.7.1 质量补丁完成。
2. v1.7.2 发布工程完成。
3. v1.7.3 CLI/错误体验完成。
4. 再次核对官方 MCP specification 和 TypeScript SDK 当前版本文档。
5. 新建 feature 分支，避免直接在 `main` 上开发大功能。
