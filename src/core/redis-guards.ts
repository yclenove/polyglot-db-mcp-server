/** 默认禁止的高风险 Redis 命令（大写） */
export const REDIS_BLOCKED_COMMANDS = new Set([
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
]);

export function assertRedisKeyPrefix(key: string, prefix?: string): void {
  if (!prefix) return;
  if (!key.startsWith(prefix)) {
    throw new Error(`Redis key 必须以配置的前缀「${prefix}」开头`);
  }
}
