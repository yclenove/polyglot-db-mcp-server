/**
 * 统一错误码体系。
 *
 * 错误码是面向用户和文档的稳定标识；message/hint 可以优化，但语义不能复用。
 */

export type ErrorSeverity = 'info' | 'warn' | 'error';

export interface ErrorDefinition {
  message: string;
  hint: string;
  severity: ErrorSeverity;
  retryable: boolean;
  applies_to: readonly string[];
}

export const ErrorDefinitions = {
  CONN_001: {
    message: '连接失败：无法建立到数据库的连接',
    hint: '检查 host、port、url、数据库服务状态、Docker 端口映射和网络连通性',
    severity: 'error',
    retryable: true,
    applies_to: ['Connection', 'SQL', 'MongoDB', 'Redis', 'CLI'],
  },
  CONN_002: {
    message: '连接超时：连接建立超过配置的超时时间',
    hint: '增大超时或检查网络、防火墙、数据库负载和连接池状态',
    severity: 'error',
    retryable: true,
    applies_to: ['Connection', 'SQL', 'MongoDB', 'Redis', 'CLI'],
  },
  CONN_003: {
    message: '连接断开：与数据库的连接已丢失',
    hint: '重试请求；若持续出现，检查数据库连接池、网络抖动和服务端重启记录',
    severity: 'error',
    retryable: true,
    applies_to: ['Connection', 'SQL', 'MongoDB', 'Redis'],
  },
  CONN_004: {
    message: '连接池耗尽：所有连接都在使用中',
    hint: '降低并发、增加连接池、检查慢查询或长事务',
    severity: 'error',
    retryable: true,
    applies_to: ['Connection', 'SQL', 'MongoDB', 'Redis'],
  },
  CONN_005: {
    message: '默认连接 ping 失败',
    hint: '检查 DB_MCP_DEFAULT_CONNECTION_ID 是否存在，并修复该连接配置后再启动',
    severity: 'error',
    retryable: true,
    applies_to: ['Connection', 'Config', 'CLI'],
  },
  CONN_006: {
    message: '未知的 connection_id',
    hint: '使用 list_connections 查看可用 id；省略或传空白 connection_id 会使用默认连接',
    severity: 'error',
    retryable: false,
    applies_to: ['Connection', 'SQL', 'MongoDB', 'Redis'],
  },

  SQL_001: {
    message: 'SQL 超过长度限制',
    hint: '缩短 SQL 或调整 DB_MAX_SQL_LENGTH',
    severity: 'error',
    retryable: false,
    applies_to: ['SQL'],
  },
  SQL_002: {
    message: '只读模式不允许写操作',
    hint: 'sql_query 只能执行只读查询；如确需写入，请使用写工具和单独的 readonly:false 连接',
    severity: 'error',
    retryable: false,
    applies_to: ['SQL', 'Auth'],
  },
  SQL_003: {
    message: '危险操作被拦截',
    hint: '检查 DROP/TRUNCATE/ALTER/无 WHERE UPDATE/DELETE 等操作，确认后使用受控写入连接',
    severity: 'error',
    retryable: false,
    applies_to: ['SQL'],
  },
  SQL_004: {
    message: 'SQL 注入风险被拦截',
    hint: '使用 params 参数化传值，移除拼接 SQL 中的可疑片段',
    severity: 'error',
    retryable: false,
    applies_to: ['SQL'],
  },
  SQL_005: {
    message: '查询超时',
    hint: '优化 SQL、增加索引、降低结果集或调整 DB_QUERY_TIMEOUT',
    severity: 'error',
    retryable: true,
    applies_to: ['SQL'],
  },
  SQL_006: {
    message: '事务不存在或已结束',
    hint: '重新调用 sql_begin_transaction，确认 transaction_id 未过期',
    severity: 'error',
    retryable: false,
    applies_to: ['SQL'],
  },

  MONGO_001: {
    message: '不是 MongoDB 连接',
    hint: '检查 connection_id 对应的 engine，Mongo 工具只能用于 engine=mongodb',
    severity: 'error',
    retryable: false,
    applies_to: ['MongoDB'],
  },
  MONGO_002: {
    message: '集合不在 allowlist 中',
    hint: '使用允许集合或更新连接 allowlist；不要绕过集合访问边界',
    severity: 'error',
    retryable: false,
    applies_to: ['MongoDB', 'Auth'],
  },
  MONGO_003: {
    message: 'NoSQL 注入风险被拦截',
    hint: '移除 $where、$function、$accumulator、$expr、$regex、$out、$merge 等危险 operator',
    severity: 'error',
    retryable: false,
    applies_to: ['MongoDB'],
  },
  MONGO_004: {
    message: '只读连接拒绝写操作',
    hint: '使用单独写连接或显式设置 readonly:false，并确认写入风险',
    severity: 'error',
    retryable: false,
    applies_to: ['MongoDB', 'Auth'],
  },
  MONGO_005: {
    message: 'MongoDB 事务不存在或已结束',
    hint: '重新调用 mongo_begin_transaction，确认 transaction_id 未过期',
    severity: 'error',
    retryable: false,
    applies_to: ['MongoDB'],
  },

  REDIS_001: {
    message: '不是 Redis 连接',
    hint: '检查 connection_id 对应的 engine，Redis 工具只能用于 engine=redis',
    severity: 'error',
    retryable: false,
    applies_to: ['Redis'],
  },
  REDIS_002: {
    message: 'Key 不在允许的前缀范围内',
    hint: '确认 key 以连接配置的 keyPrefix 开头，或调整 keyPrefix 策略',
    severity: 'error',
    retryable: false,
    applies_to: ['Redis', 'Auth'],
  },
  REDIS_003: {
    message: '命令被禁止',
    hint: '检查 REDIS_BLOCKED_COMMANDS 和内置禁止列表，避免高风险命令',
    severity: 'error',
    retryable: false,
    applies_to: ['Redis'],
  },
  REDIS_004: {
    message: '只读连接拒绝写操作',
    hint: '使用单独写连接或显式设置 readonly:false，并确认写入风险',
    severity: 'error',
    retryable: false,
    applies_to: ['Redis', 'Auth'],
  },

  AUTH_001: {
    message: '连接配置为只读',
    hint: '如确需写入，使用单独写连接并设置 readonly:false',
    severity: 'error',
    retryable: false,
    applies_to: ['Auth', 'SQL', 'MongoDB', 'Redis'],
  },
  AUTH_002: {
    message: '不在允许列表中',
    hint: '检查 allowlist、keyPrefix 或 RBAC 策略',
    severity: 'error',
    retryable: false,
    applies_to: ['Auth', 'MongoDB', 'Redis'],
  },
  AUTH_003: {
    message: 'HTTP 认证凭证缺失或无效',
    hint: '设置正确 Authorization Bearer token 或 x-api-key header',
    severity: 'error',
    retryable: false,
    applies_to: ['Auth', 'HTTP'],
  },
  AUTH_004: {
    message: 'Token 已过期',
    hint: '重新获取 token 后重试',
    severity: 'error',
    retryable: true,
    applies_to: ['Auth', 'HTTP'],
  },
  AUTH_005: {
    message: '权限不足',
    hint: '联系管理员授予对应 connection、tool 或 action 权限',
    severity: 'error',
    retryable: false,
    applies_to: ['Auth'],
  },
  AUTH_006: {
    message: 'Bearer Token 无效',
    hint: '检查 token 签名、issuer、audience、nbf/exp 和 JWKS 配置',
    severity: 'error',
    retryable: false,
    applies_to: ['Auth', 'HTTP'],
  },

  POLICY_001: {
    message: 'RBAC policy 无效',
    hint: '检查 policy JSON 的 version、roles、bindings、actions 和 resources',
    severity: 'error',
    retryable: false,
    applies_to: ['Auth', 'Config'],
  },

  CFG_001: {
    message: 'DB_MCP_CONNECTIONS 未设置或为空',
    hint: '运行 polyglot-db-mcp-server init 生成最小 SQLite 配置，或参考 docs/CONFIG.md',
    severity: 'error',
    retryable: false,
    applies_to: ['Config', 'CLI'],
  },
  CFG_002: {
    message: 'DB_MCP_CONNECTIONS 不是合法 JSON',
    hint: '使用 JSON 校验器或复制 .env.example 中的单行示例',
    severity: 'error',
    retryable: false,
    applies_to: ['Config', 'CLI'],
  },
  CFG_003: {
    message: '连接 ID 重复',
    hint: '保证 DB_MCP_CONNECTIONS 中每个 id 唯一',
    severity: 'error',
    retryable: false,
    applies_to: ['Config'],
  },
  CFG_004: {
    message: '不支持的引擎类型',
    hint: 'engine 必须是 mysql、postgres、mssql、oracle、sqlite、mongodb 或 redis',
    severity: 'error',
    retryable: false,
    applies_to: ['Config'],
  },
  CFG_005: {
    message: '缺少必填字段',
    hint: '检查 id、engine、url 或 host/database 等字段',
    severity: 'error',
    retryable: false,
    applies_to: ['Config'],
  },

  HTTP_001: {
    message: 'HTTP 来源不被允许',
    hint: '将 Host 加入 DB_HTTP_ALLOWED_HOSTS，或将 Origin 加入 DB_HTTP_ORIGINS',
    severity: 'error',
    retryable: false,
    applies_to: ['HTTP'],
  },
  HTTP_002: {
    message: '请求体过大',
    hint: '缩小请求或调整 body limit',
    severity: 'error',
    retryable: false,
    applies_to: ['HTTP'],
  },
  HTTP_003: {
    message: 'HTTP method 不支持',
    hint: 'MCP endpoint 支持 POST、GET/SSE 和 DELETE；检查请求 method',
    severity: 'error',
    retryable: false,
    applies_to: ['HTTP'],
  },
  HTTP_004: {
    message: 'Endpoint 不存在',
    hint: '检查 DB_HTTP_ENDPOINT 或客户端 URL',
    severity: 'error',
    retryable: false,
    applies_to: ['HTTP'],
  },
  HTTP_005: {
    message: 'HTTP transport 未启用',
    hint: '设置 DB_MCP_TRANSPORT=http 后再访问 HTTP 端点',
    severity: 'error',
    retryable: false,
    applies_to: ['HTTP'],
  },
  HTTP_006: {
    message: 'HTTP MCP 请求无效或冲突',
    hint: '先 initialize 获取 session，并确保同一 session 内 request id 不重复并发使用',
    severity: 'error',
    retryable: false,
    applies_to: ['HTTP'],
  },
  HTTP_007: {
    message: 'HTTP MCP session 已达容量上限',
    hint: '稍后重试，或调整 DB_HTTP_MAX_SESSIONS 与 session 空闲超时',
    severity: 'error',
    retryable: true,
    applies_to: ['HTTP'],
  },

  CLI_001: {
    message: '.env 已存在',
    hint: '默认不会覆盖现有 .env；使用 --force 覆盖，或 --stdout 打印模板',
    severity: 'warn',
    retryable: false,
    applies_to: ['CLI'],
  },
  CLI_002: {
    message: '不支持的 CLI 参数',
    hint: '运行 polyglot-db-mcp-server --help 查看支持命令',
    severity: 'error',
    retryable: false,
    applies_to: ['CLI'],
  },
  CLI_003: {
    message: '初始化模板生成失败',
    hint: '检查目录权限，或改用 --stdout 输出模板',
    severity: 'error',
    retryable: true,
    applies_to: ['CLI'],
  },
  CLI_004: {
    message: '连接测试失败',
    hint: '运行 connection_diagnose 或检查 docs/CONFIG.md 中的连接配置',
    severity: 'error',
    retryable: true,
    applies_to: ['CLI', 'Connection'],
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ErrorDefinitions;

export const ErrorCodes: { readonly [K in ErrorCode]: (typeof ErrorDefinitions)[K]['message'] } = {
  CONN_001: ErrorDefinitions.CONN_001.message,
  CONN_002: ErrorDefinitions.CONN_002.message,
  CONN_003: ErrorDefinitions.CONN_003.message,
  CONN_004: ErrorDefinitions.CONN_004.message,
  CONN_005: ErrorDefinitions.CONN_005.message,
  CONN_006: ErrorDefinitions.CONN_006.message,
  SQL_001: ErrorDefinitions.SQL_001.message,
  SQL_002: ErrorDefinitions.SQL_002.message,
  SQL_003: ErrorDefinitions.SQL_003.message,
  SQL_004: ErrorDefinitions.SQL_004.message,
  SQL_005: ErrorDefinitions.SQL_005.message,
  SQL_006: ErrorDefinitions.SQL_006.message,
  MONGO_001: ErrorDefinitions.MONGO_001.message,
  MONGO_002: ErrorDefinitions.MONGO_002.message,
  MONGO_003: ErrorDefinitions.MONGO_003.message,
  MONGO_004: ErrorDefinitions.MONGO_004.message,
  MONGO_005: ErrorDefinitions.MONGO_005.message,
  REDIS_001: ErrorDefinitions.REDIS_001.message,
  REDIS_002: ErrorDefinitions.REDIS_002.message,
  REDIS_003: ErrorDefinitions.REDIS_003.message,
  REDIS_004: ErrorDefinitions.REDIS_004.message,
  AUTH_001: ErrorDefinitions.AUTH_001.message,
  AUTH_002: ErrorDefinitions.AUTH_002.message,
  AUTH_003: ErrorDefinitions.AUTH_003.message,
  AUTH_004: ErrorDefinitions.AUTH_004.message,
  AUTH_005: ErrorDefinitions.AUTH_005.message,
  AUTH_006: ErrorDefinitions.AUTH_006.message,
  POLICY_001: ErrorDefinitions.POLICY_001.message,
  CFG_001: ErrorDefinitions.CFG_001.message,
  CFG_002: ErrorDefinitions.CFG_002.message,
  CFG_003: ErrorDefinitions.CFG_003.message,
  CFG_004: ErrorDefinitions.CFG_004.message,
  CFG_005: ErrorDefinitions.CFG_005.message,
  HTTP_001: ErrorDefinitions.HTTP_001.message,
  HTTP_002: ErrorDefinitions.HTTP_002.message,
  HTTP_003: ErrorDefinitions.HTTP_003.message,
  HTTP_004: ErrorDefinitions.HTTP_004.message,
  HTTP_005: ErrorDefinitions.HTTP_005.message,
  HTTP_006: ErrorDefinitions.HTTP_006.message,
  HTTP_007: ErrorDefinitions.HTTP_007.message,
  CLI_001: ErrorDefinitions.CLI_001.message,
  CLI_002: ErrorDefinitions.CLI_002.message,
  CLI_003: ErrorDefinitions.CLI_003.message,
  CLI_004: ErrorDefinitions.CLI_004.message,
};

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  hint: string;
  severity: ErrorSeverity;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export function getErrorInfo(code: ErrorCode): ErrorDefinition & { code: ErrorCode } {
  return { code, ...ErrorDefinitions[code] };
}

export function createErrorPayload(
  code: ErrorCode,
  details?: Record<string, unknown>,
  hintOverride?: string,
): ErrorPayload {
  const info = ErrorDefinitions[code];
  return {
    code,
    message: info.message,
    hint: hintOverride ?? info.hint,
    severity: info.severity,
    retryable: info.retryable,
    details,
  };
}

/** 创建带错误码的错误消息 */
export function withErrorCode(code: ErrorCode, detail?: string): string {
  const base = `[${code}] ${ErrorCodes[code]}`;
  return detail ? `${base}：${detail}` : base;
}

/** 脱敏 URL 中的密码部分 */
export function maskUrl(url: string): string {
  return url.replace(/([a-z][a-z0-9+.-]*:\/\/[^@\s/]*:)[^@\s/]+(@)/gi, '$1***$2');
}

/** 脱敏错误消息中可能包含的 URL 凭证或 key=value 凭证。 */
export function maskErrorCredentials(msg: string): string {
  return maskUrl(msg)
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key)=([^&\s]+)/gi, '$1=***')
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key):\s*([^\s,;]+)/gi, '$1: ***');
}
