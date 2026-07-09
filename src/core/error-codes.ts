/**
 * 统一错误码体系
 *
 * 格式：[模块]_[序号]
 * 模块前缀：
 *   CONN - 连接相关
 *   SQL  - SQL 执行相关
 *   MONGO - MongoDB 相关
 *   REDIS - Redis 相关
 *   AUTH  - 认证/权限相关
 *   CFG   - 配置相关
 */

export const ErrorCodes = {
  // 连接错误
  CONN_001: '连接失败：无法建立到数据库的连接',
  CONN_002: '连接超时：连接建立超过配置的超时时间',
  CONN_003: '连接断开：与数据库的连接已丢失',
  CONN_004: '连接池耗尽：所有连接都在使用中',
  CONN_005: '默认连接 ping 失败',
  CONN_006: '未知的 connection_id',

  // SQL 错误
  SQL_001: 'SQL 超过长度限制',
  SQL_002: '只读模式不允许写操作',
  SQL_003: '危险操作被拦截',
  SQL_004: 'SQL 注入风险被拦截',
  SQL_005: '查询超时',
  SQL_006: '事务不存在或已结束',

  // MongoDB 错误
  MONGO_001: '不是 MongoDB 连接',
  MONGO_002: '集合不在 allowlist 中',
  MONGO_003: 'NoSQL 注入风险被拦截',
  MONGO_004: '只读连接拒绝写操作',

  // Redis 错误
  REDIS_001: '不是 Redis 连接',
  REDIS_002: 'Key 不在允许的前缀范围内',
  REDIS_003: '命令被禁止',
  REDIS_004: '只读连接拒绝写操作',

  // 认证/权限错误
  AUTH_001: '连接配置为只读',
  AUTH_002: '不在允许列表中',

  // 配置错误
  CFG_001: 'DB_MCP_CONNECTIONS 未设置或为空',
  CFG_002: 'DB_MCP_CONNECTIONS 不是合法 JSON',
  CFG_003: '连接 ID 重复',
  CFG_004: '不支持的引擎类型',
  CFG_005: '缺少必填字段',
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

/** 创建带错误码的错误消息 */
export function withErrorCode(code: ErrorCode, detail?: string): string {
  const base = `[${code}] ${ErrorCodes[code]}`;
  return detail ? `${base}：${detail}` : base;
}

/** 脱敏 URL 中的密码部分 */
export function maskUrl(url: string): string {
  return url.replace(/(\/\/[^:]+:)[^@]+(@)/, '$1***$2');
}

/** 脱敏错误消息中可能包含的 URL 凭证 */
export function maskErrorCredentials(msg: string): string {
  // 脱敏 postgres://user:pass@host 形式的 URL
  return msg.replace(/(postgres|mysql|redis|mongodb|mssql|oracle):\/\/[^:]+:[^@]+@/gi, (match) => {
    return match.replace(/:[^@]+@/, ':***@');
  });
}
