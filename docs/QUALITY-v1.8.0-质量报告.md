# v1.8.0 质量报告模板：Streamable HTTP 与运维增强

**文档编号**: QUALITY-v1.8.0
**版本**: 0.1
**日期**: 2026-07-09
**状态**: 模板，待迭代完成后填写
**关联迭代**: `docs/ITER-v1.8.0-迭代计划.md`
**关联 PRD/ADR**: `docs/PRD-v1.8.0.md`, `docs/ADR-001-streamable-http.md`

---

## 一、审查结论

| 结论项 | 状态 | 证据 |
|--------|------|------|
| 是否允许发布 | 待评估 | 待填写 |
| stdio 兼容性 | 待评估 | 待填写 |
| HTTP endpoint 可用性 | 待评估 | 待填写 |
| HTTP 安全默认值 | 待评估 | 待填写 |
| 数据库工具安全边界 | 待评估 | 待填写 |
| 文档和发布门禁 | 待评估 | 待填写 |

---

## 二、PRD/ADR 验收复核

| 项目 | 目标 | 状态 | 证据 |
|------|------|------|------|
| 默认 stdio | 无参数启动保持 v1.7.x 行为 | 待评估 | |
| HTTP 启动 | `DB_MCP_TRANSPORT=http` 可启动 | 待评估 | |
| POST `/mcp` | initialize/listTools/callTool 可用 | 待评估 | |
| GET/DELETE `/mcp` | 实现或明确 405 | 待评估 | |
| `/healthz` | 进程健康探活 | 待评估 | |
| `/readyz` | registry/server readiness | 待评估 | |
| Origin allowlist | 非法 Origin 被拒绝 | 待评估 | |
| API key | 未授权请求被拒绝 | 待评估 | |
| Body limit | 超限请求被拒绝 | 待评估 | |
| 优雅关闭 | HTTP server 可关闭 | 待评估 | |

---

## 三、安全复核

| 安全项 | 状态 | 证据 |
|--------|------|------|
| HTTP 默认 host 为 `127.0.0.1` | 待评估 | |
| 远程访问必须显式配置保护 | 待评估 | |
| API key/token 不进入日志和审计 | 待评估 | |
| `sql_query` MCP 层只读检查未削弱 | 待评估 | |
| SQL 注入检测未削弱 | 待评估 | |
| Mongo NoSQL 注入和 allowlist 未削弱 | 待评估 | |
| Redis keyPrefix/blocked commands 未削弱 | 待评估 | |
| 错误响应不泄露连接串密码 | 待评估 | |

---

## 四、测试覆盖复核

| 测试文件 | 目标 | 状态 |
|----------|------|------|
| `test/transports/http-config.test.mjs` | HTTP 配置解析 | 待完成 |
| `test/transports/http-security.test.mjs` | Origin/API key/body limit | 待完成 |
| `test/transports/http.test.mjs` | MCP HTTP endpoint | 待完成 |
| `test/transports/health.test.mjs` | health/readiness | 待完成 |
| `test/tools/sql.test.mjs` | readonly 回归 | 待复核 |
| `test/tools/mongo.test.mjs` | Mongo 安全回归 | 待复核 |
| `test/tools/redis.test.mjs` | Redis 安全回归 | 待复核 |

---

## 五、命令结果

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run build` | 待运行 | |
| `npm test` | 待运行 | |
| `npm run lint` | 待运行 | |
| `npm run typecheck` | 待运行 | |
| `npm pack --dry-run` | 待运行 | |
| HTTP smoke test | 待运行 | 如 `scripts/http-smoke.mjs` 已实现 |

---

## 六、兼容性复核

| 维度 | 状态 | 说明 |
|------|------|------|
| stdio 默认 | 待评估 | 不破坏 Claude Desktop/Cursor 等本地用法 |
| 工具名 | 待评估 | 不删除/重命名现有工具 |
| 工具参数 | 待评估 | 不新增破坏性必填参数 |
| 配置格式 | 待评估 | `DB_MCP_CONNECTIONS` 不变 |
| HTTP 配置 | 待评估 | 全部为新增环境变量 |
| Docker 示例 | 待评估 | 不包含真实凭证 |

---

## 七、发布阻塞项

| 编号 | 阻塞项 | 等级 | 状态 |
|------|--------|------|------|
| B-001 | 默认 stdio 回归 | P0 | 待评估 |
| B-002 | HTTP 未授权可访问 | P0 | 待评估 |
| B-003 | HTTP 绕过工具安全检查 | P0 | 待评估 |
| B-004 | POST `/mcp` 无法完成基本 MCP 调用 | P0 | 待评估 |
| B-005 | build/test/lint 任一失败 | P0 | 待评估 |
| B-006 | 文档未说明 HTTP 安全默认值 | P1 | 待评估 |

---

## 八、接受风险

| 风险 | 接受理由 | 后续跟踪 |
|------|----------|----------|
| GET SSE 暂不实现 | v1.8.0 stateless-first，降低范围风险 | v1.8.x/v2.0 |
| OAuth 不纳入 v1.8 | 企业权限模型需独立设计 | v2.0.0 |
| Docker 镜像可能后置 | 先完成 HTTP 功能和 compose 示例 | v1.8.x |

---

## 九、最终签核

| 项目 | 结果 | 备注 |
|------|------|------|
| P0 完成 | ☐ 通过 / ☐ 不通过 | |
| 安全复核 | ☐ 通过 / ☐ 不通过 | |
| 兼容性复核 | ☐ 通过 / ☐ 不通过 | |
| 测试命令 | ☐ 通过 / ☐ 不通过 | |
| 文档同步 | ☐ 通过 / ☐ 不通过 | |
| 允许发布 | ☐ 是 / ☐ 否 | |
