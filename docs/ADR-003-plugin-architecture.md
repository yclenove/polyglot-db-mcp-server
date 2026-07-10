# ADR-003: v3.0.0 插件化架构方案

**文档编号**: ADR-003
**版本**: 1.0
**日期**: 2026-07-09
**状态**: Accepted
**目标版本**: v3.0.0
**关联文档**: `docs/ROADMAP.md`, `docs/ADR-002-oauth-rbac.md`

---

## 一、背景

长期路线图把 v3.0.0 定位为插件化生态阶段。项目当前通过内置 TypeScript 模块支持多数据库、多工具和安全能力。随着后续需求增长，继续把所有驱动、工具和策略都放入核心仓库会带来几个问题：

1. 核心包体积和依赖持续膨胀。
2. 新数据库引擎接入周期变长。
3. 企业用户希望定制内部工具和策略。
4. 第三方扩展需要稳定边界，而不是修改核心代码。

因此 v3.0.0 需要设计插件体系，但必须建立在 v2.x 权限、审计、策略稳定之后，避免过早开放不安全扩展点。

---

## 二、决策

v3.0.0 采用 **Manifest-first 插件架构**：

1. 插件必须声明 manifest。
2. 插件能力按类型分组：driver、tool、policy、export。
3. 插件默认不被信任，必须声明权限和资源访问范围。
4. 插件工具必须通过核心统一的 auth、audit、rate limit、error handling。
5. 插件加载器只负责发现、校验、注册，不允许绕过核心安全边界。

---

## 三、插件类型

| 类型 | 能力 | 示例 |
|------|------|------|
| Driver Plugin | 新数据库/存储引擎 | ClickHouse、MariaDB、Elasticsearch、Neo4j |
| Tool Plugin | 新 MCP 工具集合 | DBA 工具、数据质量、导入导出 |
| Policy Plugin | 自定义授权或脱敏策略 | 企业审批、字段级脱敏 |
| Export Plugin | 审计/指标/查询结果输出 | webhook、Kafka、S3、OpenTelemetry |

---

## 四、非目标

| 非目标 | 原因 | 后续评估 |
|--------|------|----------|
| 任意 npm 包自动执行 | 安全风险高 | 不计划 |
| 插件市场首版 | 治理成本高 | 核心 API 稳定后 |
| 浏览器端插件 | 当前是 Node server | 不计划 |
| 绕过 RBAC 的插件 | 破坏企业安全模型 | 禁止 |

---

## 五、Manifest 草案

```json
{
  "name": "@company/polyglot-clickhouse-plugin",
  "version": "1.0.0",
  "polyglotPluginVersion": "1",
  "type": ["driver", "tool"],
  "main": "./dist/index.js",
  "engines": {
    "polyglot-db-mcp-server": ">=3.0.0",
    "node": ">=20"
  },
  "permissions": {
    "connections": ["clickhouse:*"],
    "actions": ["read", "diagnose"],
    "network": true,
    "filesystem": false
  },
  "tools": [
    {
      "name": "clickhouse_query",
      "action": "read",
      "description": "Execute readonly ClickHouse query"
    }
  ],
  "configSchema": {
    "type": "object",
    "properties": {
      "timeoutMs": { "type": "number", "default": 30000 }
    }
  }
}
```

---

## 六、核心接口草案

### 6.1 Driver Plugin

```typescript
export interface DriverPlugin {
  readonly engines: readonly string[];
  createDriver(spec: ConnectionSpec, context: PluginContext): Promise<RuntimeHandle>;
}
```

### 6.2 Tool Plugin

```typescript
export interface ToolPlugin {
  readonly tools: readonly PluginToolDefinition[];
  register(registry: ToolRegistry, context: PluginContext): void;
}
```

### 6.3 Policy Plugin

```typescript
export interface PolicyPlugin {
  evaluate(input: PolicyInput, context: PluginContext): Promise<PolicyDecision>;
}
```

### 6.4 Export Plugin

```typescript
export interface ExportPlugin {
  export(event: AuditEvent | MetricEvent, context: PluginContext): Promise<void>;
}
```

---

## 七、安全边界

插件必须满足：

1. 所有工具调用进入核心 authorization wrapper。
2. 所有工具调用产生 audit 事件。
3. 插件不得直接访问原始 token。
4. 插件不得直接读取 `.env`，只能读取允许的配置片段。
5. 插件不得修改核心 registry 中非自己拥有的连接。
6. 插件声明的 action/resource 必须进入 RBAC policy。
7. 插件错误必须经过统一错误处理和凭证脱敏。

---

## 八、加载策略

### 8.1 发现方式

| 方式 | 说明 |
|------|------|
| `DB_PLUGIN_PATHS` | 逗号分隔本地插件目录 |
| `plugins` 配置文件 | 后续支持 JSON/YAML |
| npm package | 未来评估，首版不自动安装 |

### 8.2 加载流程

1. 读取 manifest。
2. 校验 schema 和版本兼容。
3. 校验权限声明。
4. 加载插件入口。
5. 注册 driver/tool/policy/export。
6. 生成审计事件 `plugin_loaded`。

### 8.3 失败策略

| 失败 | 行为 |
|------|------|
| manifest 无效 | 拒绝加载 |
| 版本不兼容 | 拒绝加载 |
| 权限声明过宽 | 拒绝加载或要求显式 allow |
| 插件初始化失败 | 根据配置 fail-fast 或降级 |
| 插件工具执行失败 | 返回统一错误并审计 |

---

## 九、测试要求

| 测试 | 场景 |
|------|------|
| manifest validation | 缺字段、版本不兼容、权限过宽 |
| driver plugin | mock engine 注册和连接创建 |
| tool plugin | 工具注册、auth wrapper、audit |
| policy plugin | allow/deny/condition |
| export plugin | audit event 输出失败不影响主流程 |
| security | 插件不能绕过 readonly/RBAC |

---

## 十、迁移路径

| 阶段 | 内容 |
|------|------|
| v2.x | 稳定 auth/audit/policy/tool action map |
| v2.2 | 稳定 observability/export event |
| v3.0 alpha | 内部插件 API 和本地插件加载 |
| v3.0 beta | 官方示例插件和迁移文档 |
| v3.0 GA | 第三方插件 API 稳定 |

---

## 十一、风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 插件绕过安全 | 高 | 强制 wrapper、权限声明、审计 |
| 插件 API 过早固化 | 中 | v3.0 alpha/beta 标注实验期 |
| 依赖冲突 | 中 | 插件隔离加载，peer dependency 规则 |
| 插件质量不稳定 | 中 | manifest、测试套件、认证插件列表 |
| 插件市场治理成本 | 高 | 首版只做本地插件，不做市场 |

---

## 十二、待评审问题

1. 插件是否允许网络访问，默认如何声明。
2. 插件是否允许文件系统访问，如何限制路径。
3. 是否需要 worker thread 隔离。
4. 插件 API 是否用 TypeScript types 单独发布。
5. 官方是否维护示例插件，如 ClickHouse/DuckDB export。

---

## 十三、结论

插件化应是 v3.0 的平台能力，而不是 v1.x/v2.0 的提前扩张。只有在认证、授权、审计、策略和可观测能力稳定后，插件才有安全边界。v3.0 首版应采用 manifest-first、本地插件、默认拒绝的保守策略。
