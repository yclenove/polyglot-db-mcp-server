# v1.7.3 迭代计划：开发者体验与错误可理解性

**文档编号**: ITER-v1.7.3
**版本**: 1.0
**日期**: 2026-07-09
**目标版本**: v1.7.3
**迭代类型**: Patch / Developer Experience
**建议周期**: 3 ~ 5 个工作日
**状态**: 初稿，待执行
**前置依赖**: v1.7.1 质量补丁、v1.7.2 发布工程补强

---

## 一、迭代目标

v1.7.3 聚焦开发者首次使用、错误理解、诊断闭环和文档可读性。目标是让新用户可以用 SQLite 在 5 分钟内跑通，让老用户遇到问题时能直接从错误码、hint 和诊断工具定位原因。

### 1.1 总目标

1. 强化 CLI init/test/help，生成可运行配置而不是只给提示。
2. 统一错误码文档，让 `message/code/hint` 可查、可测试、可维护。
3. 增强连接诊断建议，覆盖常见端口、认证、readonly、SQLite 路径和 keyPrefix 问题。
4. 重写 README 快速开始路径，优先展示本地 SQLite 最小闭环。
5. 让 API 文档与工具注册保持同步，降低文档漂移。

### 1.2 成功指标

| 指标 | 目标 |
|------|------|
| 首次体验 | 用户复制 README 最小示例后 5 分钟内完成 SQLite 查询 |
| CLI init | 可生成 `.env` 或输出可复制配置，默认不覆盖现有文件 |
| 错误码 | 核心错误码均有 code、message、hint、触发场景 |
| 诊断工具 | 连接失败能返回可执行建议，而不是只返回底层错误 |
| 文档 | README 快速开始、API、CONFIG 不互相矛盾 |

---

## 二、范围边界

### 2.1 纳入范围

| 编号 | 类型 | 内容 |
|------|------|------|
| S-001 | CLI | `init`、`test`、`--help` 体验增强 |
| S-002 | 错误 | 错误码和 hint 文档化，必要时补测试 |
| S-003 | 诊断 | `connection_diagnose` 建议增强 |
| S-004 | 文档 | README 快速开始瘦身、API 错误码补充 |
| S-005 | 示例 | SQLite 最小可运行示例、常见多连接示例 |

### 2.2 不纳入范围

| 内容 | 原因 | 后续版本 |
|------|------|----------|
| GUI/Web UI | 偏离 MCP server 核心 | 重新评估 |
| HTTP 传输 | v1.8.0 单独实现 | v1.8.0 |
| OAuth/RBAC | 企业安全能力 | v2.0.0 |
| 自动迁移或写入审批 | 安全复杂度高 | v2.x |

---

## 三、用户旅程

### 3.1 新用户 5 分钟路径

| 步骤 | 用户动作 | 系统期望 |
|------|----------|----------|
| 1 | 安装包或本地 clone | README 给出清晰命令 |
| 2 | 运行 `polyglot-db-mcp-server init` | 生成 SQLite 示例配置或打印可复制 `.env` |
| 3 | 运行 `polyglot-db-mcp-server test` | 显示连接解析、默认连接、ping 结果 |
| 4 | 启动 MCP server | stdio 正常启动，无多余 stdout 污染 |
| 5 | 调用 `sql_query` | 返回 `SELECT 1` 结果 |

### 3.2 失败诊断路径

| 场景 | 当前常见问题 | v1.7.3 目标 |
|------|--------------|-------------|
| 未配置连接 | 用户只看到 env 缺失 | 提示运行 init 或给出最小配置 |
| 默认连接不存在 | 不知道有哪些 id | hint 列出可用 id |
| readonly 写入失败 | 不知道如何开启写入 | hint 指向 readonly=false 和风险说明 |
| SQLite 文件路径错误 | 不知道 cwd 和 file: 规则 | hint 显示解析后的路径和权限建议 |
| Redis keyPrefix 拒绝 | 不知道允许前缀 | hint 显示配置前缀和传入 key |

---

## 四、任务分解

### Epic A：CLI 体验增强

#### A-001：`init` 生成最小配置

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `src/cli.ts`, `.env.example`, `test/cli*.test.mjs` |
| 预估 | 0.5 天 |

要求：

1. 默认生成 SQLite `file:./data/local.db` 或 `:memory:` 示例。
2. 如果 `.env` 已存在，默认不覆盖，提示 `--force` 或输出到 stdout。
3. 输出内容不包含真实凭证。
4. 保持 stdout/stderr 语义清晰，server stdio 模式不能被 CLI 日志污染。

#### A-002：`test` 子命令增强

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `src/cli.ts`, `src/bootstrap.ts` |
| 预估 | 0.5 天 |

要求：

- 显示解析到的连接数量、默认连接 id、每个连接 engine、readonly 状态。
- ping 失败时显示错误码和 hint。
- 默认不输出密码或完整连接串。

#### A-003：`--help` 文案标准化

| 属性 | 内容 |
|------|------|
| 优先级 | P2 |
| 文件 | `src/cli.ts`, `README.md` |
| 预估 | 0.25 天 |

---

### Epic B：错误码与 hint 文档化

#### B-001：错误码矩阵

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `docs/ERRORS.md`, `src/core/error-codes.ts` |
| 预估 | 0.5 天 |

矩阵字段：

| 字段 | 说明 |
|------|------|
| code | 稳定错误码，如 `CONN_001` |
| message | 面向用户的简短错误 |
| hint | 下一步可执行建议 |
| severity | info/warn/error |
| retryable | 是否建议重试 |
| applies_to | SQL/Mongo/Redis/Config/CLI |

#### B-002：错误响应测试

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `test/tools/*`, `test/error-codes.test.mjs` |
| 预估 | 0.5 天 |

要求：

- 未知 connection_id 包含可用 id。
- 非 SQL 连接包含实际 engine。
- readonly 写操作包含配置建议。
- Redis keyPrefix 拒绝包含允许前缀。
- Mongo NoSQL 注入拦截包含危险字段或 operator。

---

### Epic C：连接诊断增强

#### C-001：诊断建议规则库

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `src/tools/connections.ts` 或 `src/core/diagnostics.ts` |
| 预估 | 0.5 天 |

建议覆盖：

| 类型 | 建议 |
|------|------|
| ECONNREFUSED | 检查 host/port、Docker 服务、端口映射 |
| AUTH failed | 检查 user/password/authSource |
| timeout | 检查网络、防火墙、queryTimeoutMs |
| SQLite path | 检查 cwd、目录权限、file: 路径 |
| readonly | 写操作需 readonly=false，并说明风险 |
| allowlist/keyPrefix | 显示允许列表或前缀 |

#### C-002：诊断输出结构稳定化

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `src/tools/connections.ts`, `docs/API.md` |
| 预估 | 0.25 天 |

输出建议：

```json
{
  "connection_id": "pg",
  "engine": "postgres",
  "status": "unhealthy",
  "latency_ms": 120,
  "error": { "code": "CONN_002", "message": "连接失败", "hint": "检查 host/port" },
  "suggestions": ["确认数据库服务已启动", "确认端口映射"]
}
```

---

### Epic D：README 与 API 可读性

#### D-001：README 快速开始重写

| 属性 | 内容 |
|------|------|
| 优先级 | P0 |
| 文件 | `README.md`, `README_en.md` |
| 预估 | 0.5 天 |

结构建议：

1. 30 秒了解项目。
2. 5 分钟 SQLite 快速开始。
3. 多连接配置示例。
4. 安全默认值说明。
5. 常用工具列表。
6. 排障入口：`connection_diagnose`、`docs/ERRORS.md`、`docs/CONFIG.md`。

#### D-002：API 文档错误码补充

| 属性 | 内容 |
|------|------|
| 优先级 | P1 |
| 文件 | `docs/API.md`, `scripts/generate-docs.mjs` |
| 预估 | 0.5 天 |

要求：

- 工具文档中说明常见错误。
- 若 API 文档由脚本生成，优先修改脚本而非手写大段重复内容。

---

## 五、执行顺序

| 顺序 | 任务 | 说明 |
|------|------|------|
| 1 | B-001 | 先稳定错误码和文档模型 |
| 2 | C-001, C-002 | 诊断输出复用错误模型 |
| 3 | A-001, A-002, A-003 | CLI 复用配置和诊断能力 |
| 4 | D-001, D-002 | 文档与实际行为对齐 |
| 5 | 全量验证 | build/test/lint/typecheck 和手动 quickstart 检查 |

---

## 六、测试与验证

### 6.1 必跑命令

```powershell
npm run build
npm test
npm run lint
npm run typecheck
```

### 6.2 手动验收脚本

```powershell
node dist/index.js --help
node dist/index.js init
node dist/index.js test
```

注意：如果 `init` 会写 `.env`，测试前必须使用临时目录或显式输出到 stdout，避免覆盖用户配置。

---

## 七、验收清单

- [ ] README 可按 SQLite 快速开始跑通。
- [ ] CLI `init` 默认不覆盖已有 `.env`。
- [ ] CLI `test` 输出不泄露密码。
- [ ] `docs/ERRORS.md` 覆盖核心错误码。
- [ ] `connection_diagnose` 输出包含可执行建议。
- [ ] API 文档说明常见错误和诊断入口。
- [ ] 新增行为均有 deterministic test。
- [ ] `npm run build`、`npm test`、`npm run lint`、`npm run typecheck` 通过。

---

## 八、风险与回滚

| 风险 | 缓解 |
|------|------|
| CLI 写入 `.env` 覆盖用户文件 | 默认不覆盖，必须显式 `--force` |
| 错误码过早固化导致后续调整困难 | v1.7.3 标记为稳定错误码初版，新增不删除 |
| README 与代码行为漂移 | quickstart 纳入手动发布检查 |
| 诊断信息泄露敏感数据 | 所有错误和连接信息走脱敏函数 |

---

## 九、Definition of Done

v1.7.3 完成条件：

1. 新用户可以根据 README 最小 SQLite 路径完成一次查询。
2. CLI init/test/help 行为清晰且不泄露凭证。
3. 核心错误码和 hint 有文档、有测试。
4. 连接诊断能输出可执行建议。
5. `npm run build`、`npm test`、`npm run lint`、`npm run typecheck` 通过。
