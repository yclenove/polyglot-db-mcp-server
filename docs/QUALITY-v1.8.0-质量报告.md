# v1.8.0 质量报告：Streamable HTTP 与运维增强

**文档编号**: QUALITY-v1.8.0
**版本**: 1.0
**日期**: 2026-07-09
**状态**: 已完成
**关联迭代**: `docs/ITER-v1.8.0-迭代计划.md`
**关联 PRD/ADR**: `docs/PRD-v1.8.0.md`, `docs/ADR-001-streamable-http.md`

---

## 一、审查结论

| 结论项 | 状态 | 证据 |
|--------|------|------|
| 是否允许发布 | 通过 | 本地 CI 同等门禁全通过；HTTP smoke 通过 |
| stdio 兼容性 | 通过 | 默认 `DB_MCP_TRANSPORT=stdio`，配置测试覆盖 |
| HTTP endpoint 可用性 | 通过 | `scripts/http-smoke.mjs` 连接成功，列出 83 个工具 |
| HTTP 安全默认值 | 通过 | 本地默认 host；非本地监听需要 API key 或显式关闭认证 |
| 数据库工具安全边界 | 通过 | `sql_query` 只读、Mongo/Redis/SQL 回归测试通过 |
| 文档和发布门禁 | 通过 | README/CONFIG/API/ERRORS/CHANGELOG 已同步 |

---

## 二、PRD/ADR 验收复核

| 项目 | 目标 | 状态 | 证据 |
|------|------|------|------|
| 默认 stdio | 无参数启动保持 v1.7.x 行为 | 通过 | `http-config.test.mjs` 默认值覆盖 |
| HTTP 启动 | `DB_MCP_TRANSPORT=http` 可启动 | 通过 | HTTP smoke：`readyz OK` |
| POST `/mcp` | initialize/listTools/callTool 可用 | 通过 | `http.test.mjs` + smoke 列出 83 个工具 |
| GET/DELETE `/mcp` | 实现或明确 405 | 通过 | `http-security.test.mjs` 覆盖 405 |
| `/healthz` | 进程健康探活 | 通过 | smoke：`healthz status=healthy` |
| `/readyz` | registry 和启动 ping readiness | 通过 | `health.test.mjs` + smoke |
| Origin allowlist | 非法 Origin 被拒绝 | 通过 | `http-security.test.mjs` |
| API key | 未授权请求被拒绝 | 通过 | `http-security.test.mjs` |
| Body limit | 超限请求被拒绝 | 通过 | `http-security.test.mjs` |
| 优雅关闭 | HTTP server 可关闭 | 通过 | HTTP transport tests 调用 close |

---

## 三、安全复核

| 安全项 | 状态 | 证据 |
|--------|------|------|
| HTTP 默认 host 为 `127.0.0.1` | 通过 | `parseHttpTransportConfig` 默认值测试 |
| 远程访问必须显式配置保护 | 通过 | 非本地 host 无 key 且未关闭认证会失败 |
| API key/token 不进入日志和审计 | 通过 | safe config 仅输出认证模式 |
| `sql_query` MCP 层只读检查未削弱 | 通过 | HTTP 下写 SQL 被 MCP 层拒绝 |
| SQL 注入检测未削弱 | 通过 | `test/tools/sql.test.mjs`、`test/sql-guards.test.mjs` |
| Mongo NoSQL 注入和 allowlist 未削弱 | 通过 | `test/tools/mongo.test.mjs` |
| Redis keyPrefix/blocked commands 未削弱 | 通过 | `test/tools/redis.test.mjs` |
| 错误响应不泄露连接串密码 | 通过 | 错误码与 credential masking 测试通过 |

---

## 四、测试覆盖复核

| 测试文件 | 目标 | 状态 |
|----------|------|------|
| `test/transports/http-config.test.mjs` | HTTP 配置解析 | 通过 |
| `test/transports/http-security.test.mjs` | Origin/API key/body limit | 通过 |
| `test/transports/http.test.mjs` | MCP HTTP endpoint | 通过 |
| `test/transports/health.test.mjs` | health/readiness | 通过 |
| `test/tools/sql.test.mjs` | readonly 回归 | 通过 |
| `test/tools/mongo.test.mjs` | Mongo 安全回归 | 通过 |
| `test/tools/redis.test.mjs` | Redis 安全回归 | 通过 |

---

## 五、命令结果

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run build` | 通过 | TypeScript 编译成功 |
| `npm test` | 通过 | 480 tests / 105 suites |
| `npm run typecheck` | 通过 | `tsc --noEmit` |
| `npm run lint` | 通过 | `eslint src/` |
| `npm run format:check` | 通过 | Prettier check |
| `npm run test:coverage:check` | 通过 | 全局 lines 64.47%，branches 74.57%，functions 67.6%；`src/transports` lines 93.1% |
| `npm pack --dry-run` | 通过 | 174 files，包含 healthcheck 与 http smoke 脚本 |
| `npm run benchmark` | 通过 | 平均约 6,750,700 ops/s；报告文件不作为本次提交内容 |
| `docker compose config` | 通过 | `docker-compose.env` 提供开发默认连接，`.env` 可选覆盖 |
| HTTP smoke test | 通过 | `/readyz` ready，`/healthz` healthy，`POST /mcp` 可列出 83 个工具 |

---

## 六、兼容性复核

| 维度 | 状态 | 说明 |
|------|------|------|
| stdio 默认 | 通过 | 不破坏 Claude Desktop/Cursor 等本地用法 |
| 工具名 | 通过 | 不删除/重命名现有工具 |
| 工具参数 | 通过 | 不新增破坏性必填参数 |
| 配置格式 | 通过 | `DB_MCP_CONNECTIONS` 不变 |
| HTTP 配置 | 通过 | 全部为新增环境变量 |
| Docker 示例 | 通过 | 仅包含本地开发默认账号，`.env` 不提交 |

---

## 七、发布阻塞项

| 编号 | 阻塞项 | 等级 | 状态 |
|------|--------|------|------|
| B-001 | 默认 stdio 回归 | P0 | 已关闭 |
| B-002 | HTTP 未授权可访问 | P0 | 已关闭 |
| B-003 | HTTP 绕过工具安全检查 | P0 | 已关闭 |
| B-004 | POST `/mcp` 无法完成基本 MCP 调用 | P0 | 已关闭 |
| B-005 | build/test/lint 任一失败 | P0 | 已关闭 |
| B-006 | 文档未说明 HTTP 安全默认值 | P1 | 已关闭 |

---

## 八、接受风险

| 风险 | 接受理由 | 后续跟踪 |
|------|----------|----------|
| GET SSE 暂不实现 | v1.8.0 stateless-first，降低范围风险 | v1.8.x/v2.0 |
| OAuth 不纳入 v1.8 | 企业权限模型需独立设计 | v2.0.0 |
| HTTP session 生命周期较简单 | 当前状态会在 transport close 时释放；长连接和恢复能力后续加强 | v1.8.x/v2.0 |

---

## 九、最终签核

| 项目 | 结果 | 备注 |
|------|------|------|
| P0 完成 | 通过 | |
| 安全复核 | 通过 | |
| 兼容性复核 | 通过 | |
| 测试命令 | 通过 | |
| 文档同步 | 通过 | |
| 允许发布 | 是 | |
