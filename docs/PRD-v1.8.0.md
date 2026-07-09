# PRD: polyglot-db-mcp-server v1.8.0

**文档编号**: PRD-v1.8.0
**版本**: 1.0
**日期**: 2026-07-09
**目标版本**: v1.8.0
**状态**: 草案，待评审
**主题**: Streamable HTTP 传输与运维增强
**前置依赖**: v1.7.1、v1.7.2、v1.7.3 完成
**关联 ADR**: `docs/ADR-001-streamable-http.md`

---

## 一、产品背景

v1.7.x 已经覆盖多引擎数据库、SQLite、本地诊断、审计、脱敏、缓存和查询建议。但当前默认运行模型仍以 stdio 为主，更适合桌面客户端本地拉起。对于容器化部署、远程 Agent、统一网关和平台集成，项目需要 HTTP 传输、健康检查和更清晰的运维入口。

v1.8.0 的目标不是引入完整企业权限体系，而是在保持 stdio 兼容的前提下，提供可部署、可探活、可保护的 HTTP 传输基础。

---

## 二、用户画像

| 用户 | 诉求 |
|------|------|
| 本地开发者 | 继续使用 stdio，不希望升级后配置破坏 |
| 平台工程师 | 希望将 MCP server 容器化，以 HTTP 方式接入内部 Agent 平台 |
| 运维人员 | 需要 health/readiness endpoint、结构化日志和明确启动参数 |
| 安全负责人 | 需要默认 localhost、Origin 校验、API key 或明确禁用开关 |
| 维护者 | 需要 HTTP 能力不破坏现有工具层安全边界和测试体系 |

---

## 三、核心目标

| 编号 | 目标 | 成功标准 |
|------|------|----------|
| O-001 | stdio 兼容 | 默认启动仍为 stdio，现有客户端配置无需修改 |
| O-002 | HTTP 可用 | 显式配置后可通过 HTTP 完成 MCP initialize/listTools/callTool |
| O-003 | 运维可探活 | 提供 `/healthz` 和 `/readyz` |
| O-004 | 安全默认 | 默认绑定 localhost，HTTP 暴露需要显式配置和保护 |
| O-005 | 可测试 | HTTP transport 有 deterministic tests，不依赖真实数据库网络 |
| O-006 | 可文档化 | README/CONFIG/API 描述启动方式、环境变量、安全注意事项 |

---

## 四、功能清单

### 4.1 P0 功能

#### F-001：双传输启动模式

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 用户价值 | 保持本地兼容，同时支持远程部署 |
| 范围 | `src/index.ts`, `src/transports/*`, CLI/env parsing |

需求：

- 默认 `DB_MCP_TRANSPORT=stdio`。
- 支持 `DB_MCP_TRANSPORT=http`。
- 支持 CLI `--transport stdio|http`。
- stdio 模式 stdout 不输出日志或非 MCP 内容。
- HTTP 模式可输出结构化日志。

验收：

- [ ] 无参数启动行为与 v1.7.x 一致。
- [ ] HTTP 参数启动可监听指定 host/port。
- [ ] 非法 transport 返回清晰错误。

#### F-002：Streamable HTTP MCP endpoint

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 用户价值 | 远程 Agent 可通过 HTTP 调用 MCP 工具 |
| 范围 | `src/transports/http.ts`, tests |

需求：

- 默认 endpoint `/mcp`。
- 支持 POST JSON-RPC 请求。
- 支持 initialize、listTools、callTool 基本链路。
- GET `/mcp` 若不实现 SSE，必须返回明确 405 和文档说明。

验收：

- [ ] HTTP client 可完成 MCP 初始化。
- [ ] HTTP client 可调用 `list_connections` 或 mock 工具。
- [ ] HTTP client 调用 `sql_query` 仍受只读保护。

#### F-003：健康检查端点

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 用户价值 | 容器和平台可探活 |
| 范围 | `src/transports/health.ts` |

需求：

- `/healthz`：进程运行即可返回 healthy。
- `/readyz`：配置已加载、registry 创建成功，默认连接 ping 状态可作为 readiness 依据。
- 返回 JSON，不泄露连接凭证。

验收：

- [ ] 未加载 registry 时 readyz 返回非 ready。
- [ ] registry 加载后 readyz 返回 ready 或 degraded 并说明原因。

#### F-004：HTTP 安全默认值

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 用户价值 | 避免误暴露数据库 MCP 网关 |
| 范围 | config, middleware, docs |

需求：

- 默认 host 为 `127.0.0.1`。
- 支持 Origin allowlist。
- 支持 API key header，例如 `Authorization: Bearer <key>` 或 `x-api-key`，具体在 ADR 评审时定稿。
- Body size limit。
- 请求超时。

验收：

- [ ] 默认不会监听 `0.0.0.0`。
- [ ] 非法 Origin 被拒绝。
- [ ] 缺失或错误 API key 被拒绝，除非显式禁用。
- [ ] 大 body 被拒绝。

### 4.2 P1 功能

| 编号 | 功能 | 说明 |
|------|------|------|
| F-005 | Docker HTTP 示例 | docker compose 展示 HTTP 模式和 healthcheck |
| F-006 | 结构化日志字段统一 | transport、request_id、connection_id、duration_ms、error_code |
| F-007 | HTTP smoke test 脚本 | 本地启动后可运行脚本验证 endpoint |
| F-008 | 文档补充 | README/CONFIG/API 增加 HTTP 模式章节 |

### 4.3 P2 功能

| 编号 | 功能 | 说明 |
|------|------|------|
| F-009 | GET SSE stream | 若 SDK 需求强烈，则实现；否则后续版本 |
| F-010 | Session DELETE | 显式释放 session；依赖 session 策略 |
| F-011 | 基础 metrics endpoint | 可先复用已有 prometheus_metrics 工具，HTTP endpoint 后置 |

---

## 五、不纳入范围

| 功能 | 原因 | 规划版本 |
|------|------|----------|
| OAuth 2.1 | 需要独立认证授权设计 | v2.0.0 |
| RBAC | 需要 subject/resource/action 模型 | v2.0.0 |
| 多租户 | 涉及配置、连接池、审计隔离 | v2.0+ |
| 插件化 transport | 当前先稳定内置 HTTP | v3.0 |
| 自动 TLS 证书 | 应由反向代理或部署平台处理 | 后续评估 |

---

## 六、用户故事

### US-001：本地用户无感升级

作为本地 Claude Desktop 用户，我升级到 v1.8.0 后，不修改任何配置也能继续通过 stdio 使用原有工具。

验收：

- 默认启动走 stdio。
- stdout 不出现日志污染。
- 现有工具测试全部通过。

### US-002：平台工程师启用 HTTP

作为平台工程师，我希望通过环境变量启动 HTTP server，让内部 Agent 通过 `/mcp` 调用数据库工具。

验收：

- 设置 `DB_MCP_TRANSPORT=http` 后服务监听 `DB_HTTP_HOST:DB_HTTP_PORT`。
- POST `/mcp` 可执行 MCP 调用。
- `/healthz` 和 `/readyz` 可被 Kubernetes/Docker 健康检查使用。

### US-003：安全负责人限制访问

作为安全负责人，我希望 HTTP 模式默认只允许本地访问，并能通过 Origin/API key 限制远程调用。

验收：

- 默认 host 为 `127.0.0.1`。
- 未授权请求被拒绝。
- 错误日志不泄露 API key 或连接字符串。

---

## 七、指标与埋点

| 指标 | 类型 | 用途 |
|------|------|------|
| `transport_requests_total` | counter | HTTP 请求量 |
| `transport_errors_total` | counter | HTTP 错误量 |
| `transport_request_duration_ms` | histogram | HTTP 延迟 |
| `mcp_tool_calls_total` | counter | 工具调用量，带 transport 标签 |
| `mcp_tool_errors_total` | counter | 工具错误量，带 error_code |
| `registry_ready` | gauge | readiness 状态 |

v1.8.0 可先在结构化日志中记录，Prometheus endpoint 可作为 P2 或 v2.2.0 统一治理。

---

## 八、测试策略

### 8.1 必须新增测试

| 测试文件 | 内容 |
|----------|------|
| `test/transports/http-config.test.mjs` | 环境变量和 CLI 参数解析 |
| `test/transports/http-security.test.mjs` | Origin/API key/body limit |
| `test/transports/http.test.mjs` | initialize/listTools/callTool |
| `test/transports/health.test.mjs` | healthz/readyz |

### 8.2 回归测试

- `test/tools/sql.test.mjs`：确认 `sql_query` 只读保护不变。
- `test/tools/connections.test.mjs`：确认连接诊断不受 transport 影响。
- `test/config.test.mjs`：确认新增 HTTP env 不影响连接配置解析。

### 8.3 必跑命令

```powershell
npm run build
npm test
npm run lint
npm run typecheck
npm pack --dry-run
```

---

## 九、发布计划

| 阶段 | 内容 | 退出条件 |
|------|------|----------|
| Alpha | 本地 HTTP endpoint + healthz | HTTP mock tests 通过 |
| Beta | SDK client 验证 + Docker 示例 | Docker healthcheck 通过 |
| RC | 文档、CHANGELOG、pack dry-run | 全量命令通过 |
| GA | tag + release | 无 P0/P1 阻塞问题 |

---

## 十、风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| HTTP 暴露数据库工具导致安全事故 | 高 | 默认 localhost、API key、Origin 校验、文档警告 |
| SDK transport API 变更 | 中 | 实施前锁定 SDK 版本并验证官方 examples |
| SSE/session 范围膨胀 | 中 | v1.8.0 stateless-first，SSE 后置 |
| 与 stdio 共享启动逻辑导致回归 | 中 | 抽 transport 模块，保留 stdio 回归测试 |
| 日志泄露 token | 高 | 统一脱敏，安全测试覆盖 headers |

---

## 十一、验收清单

- [ ] 默认 stdio 不变。
- [ ] HTTP 模式可启动并通过 `/healthz`。
- [ ] POST `/mcp` 可完成 MCP 基本调用。
- [ ] GET `/mcp` 行为明确实现或明确 405。
- [ ] Origin/API key/body limit 有测试。
- [ ] HTTP 模式不绕过 SQL readonly 和各工具安全检查。
- [ ] Docker 示例可探活。
- [ ] README/CONFIG/API/CHANGELOG 更新。
- [ ] `npm run build`、`npm test`、`npm run lint`、`npm run typecheck`、`npm pack --dry-run` 通过。

---

## 十二、待评审问题

1. API key 使用 `Authorization: Bearer` 还是 `x-api-key`，或同时支持？
2. v1.8.0 是否必须实现 GET SSE，还是先 405 并文档化？
3. `/readyz` 是否必须 ping 默认连接，还是只验证 registry 加载？
4. Docker 镜像是否在 v1.8.0 发布，还是只提供 docker-compose 示例？
5. HTTP 模式是否默认要求 API key，即使绑定 localhost？
