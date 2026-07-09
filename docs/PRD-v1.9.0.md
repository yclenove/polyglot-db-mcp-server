# PRD: polyglot-db-mcp-server v1.9.0

**文档编号**: PRD-v1.9.0
**版本**: 1.0
**日期**: 2026-07-10
**目标版本**: v1.9.0
**状态**: 已完成
**主题**: 高级数据库工作流：Schema diff、MongoDB 事务、Redis pipeline
**上游依据**: `docs/ROADMAP.md` Phase 2

---

## 一、背景

v1.8.0 完成 HTTP 传输和运维基线后，v1.9.0 聚焦数据库工作流本身，让服务从单点查询/写入升级为更贴近 DBA 和数据工程日常的批处理、结构比较和事务操作。

---

## 二、目标

| 编号 | 目标 | 成功标准 |
|------|------|----------|
| O-001 | SQL Schema diff | 可比较两个 SQL 连接或 schema 的表/列差异 |
| O-002 | MongoDB 多文档事务 | 支持 begin/execute/commit/rollback，超时清理 |
| O-003 | Redis pipeline | 支持安全命令子集批处理，保留 keyPrefix/readonly |
| O-004 | 安全边界 | 不削弱 SQL 只读、Mongo allowlist/NoSQL guard、Redis keyPrefix |
| O-005 | 文档与测试 | README/API/CONFIG/ERRORS/CHANGELOG 同步，新增确定性测试 |

---

## 三、范围

### 3.1 纳入范围

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | `schema_diff` | 只读读取系统目录，返回新增/删除/变更表和列 |
| P0 | MongoDB 事务工具 | `mongo_begin_transaction`、`mongo_execute_in_transaction`、`mongo_commit`、`mongo_rollback` |
| P0 | `redis_pipeline` | 批量执行现有安全命令子集 |
| P1 | Schema export 参数补强 | `schema_export` 支持 PostgreSQL `schema` 参数 |
| P1 | 事务清理配置 | `DB_MONGO_TRANSACTION_TIMEOUT_MS` |

### 3.2 不纳入范围

| 内容 | 原因 | 后续版本 |
|------|------|----------|
| 自动执行 schema migration | 风险高，需要审批/回滚设计 | v2.x |
| Mongo 聚合 explain 和索引建议 | 需要更细的 explain 输出和建议模型 | v1.9.x / v2.2 |
| Redis Stream | 批处理先完成安全模型 | v1.9.x |
| 跨库数据迁移 | 越权和一致性复杂 | v2.x |

---

## 四、安全要求

| 要求 | 验证 |
|------|------|
| `schema_diff` 必须 readonly | 调用 `driver.execute(... mode: "readonly")`，测试覆盖 |
| Mongo 事务不得绕过 readonly | `mongo_begin_transaction` 在 readonly 连接上返回 `MONGO_004` |
| Mongo 事务 filter 继续检测 NoSQL 注入 | `$where` 等危险 operator 返回 `MONGO_003` |
| Redis pipeline 不支持危险命令 | `flushdb` 等阻断命令在工具层拒绝 |
| Redis pipeline 不绕过 keyPrefix/readonly | driver 层继续执行 keyPrefix 和 readonly 检查 |

---

## 五、验收命令

| 命令 | 目标 |
|------|------|
| `npm run build` | 编译和类型检查 |
| `npm test` | 全量确定性测试 |
| `npm run typecheck` | noEmit 类型检查 |
| `npm run lint` | ESLint |
| `npm run format:check` | Prettier |
| `npm run test:coverage:check` | 覆盖率门禁 |
| `npm pack --dry-run` | 发布产物核对 |

---

## 六、完成记录

- `schema_diff`、MongoDB 事务工具、Redis pipeline 已实现并覆盖确定性测试。
- README、README_en、CONFIG、ERRORS、API、CHANGELOG、`.env.example` 已同步。
- 本地质量门禁结果记录在 `docs/QUALITY-v1.9.0-质量报告.md`。
