/** 默认禁止的高风险 Redis 命令（大写） */
const DEFAULT_BLOCKED = [
  'FLUSHALL',
  'FLUSHDB',
  'KEYS',
  'CONFIG',
  'SHUTDOWN',
  'SCRIPT',
  'EVAL',
  'EVALSHA',
  'DEBUG',
  'MODULE',
];

/**
 * 从环境变量 REDIS_BLOCKED_COMMANDS 读取自定义禁止列表（逗号分隔），
 * 若未设置则使用默认列表。
 */
export function getBlockedCommands(): Set<string> {
  const env = process.env.REDIS_BLOCKED_COMMANDS;
  if (env && env.trim()) {
    return new Set(
      env
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    );
  }
  return new Set(DEFAULT_BLOCKED);
}

export const REDIS_BLOCKED_COMMANDS = getBlockedCommands();

export function assertRedisKeyPrefix(key: string, prefix?: string): void {
  if (!prefix) return;
  if (!key.startsWith(prefix)) {
    throw new Error(`Redis key 必须以配置的前缀「${prefix}」开头`);
  }
}
