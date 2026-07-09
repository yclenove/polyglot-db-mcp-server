export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

/** 凭证脱敏：替换 URL 中的密码部分 */
export function maskCredential(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  // 匹配 URL 中的密码：protocol://user:password@host
  return value.replace(/(\/\/[^:]+:)[^@]+(@)/g, '$1***$2');
}

/** 递归脱敏对象中的敏感字段 */
export function maskSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = new Set(['password', 'secret', 'token', 'credential', 'auth']);
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.has(key.toLowerCase()) && typeof value === 'string') {
      masked[key] = '***';
    } else if (typeof value === 'string') {
      masked[key] = maskCredential(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel;
  }
  return 'info';
}

function formatLogEntry(entry: LogEntry): string {
  if (process.env.LOG_FORMAT === 'json') {
    return JSON.stringify(entry);
  }
  // 人类可读格式
  const { timestamp, level, message, ...rest } = entry;
  const extra = Object.keys(rest).length > 0 ? ' ' + JSON.stringify(rest) : '';
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${extra}`;
}

export function createLogger(context?: Record<string, unknown>) {
  const minLevel = LOG_LEVELS[getLogLevel()];

  function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (LOG_LEVELS[level] < minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
      ...data,
    };

    const formatted = formatLogEntry(entry);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      default:
        // debug 和 info 输出到 stderr，避免干扰 stdout
        console.error(formatted);
    }
  }

  return {
    debug: (message: string, data?: Record<string, unknown>) => log('debug', message, data),
    info: (message: string, data?: Record<string, unknown>) => log('info', message, data),
    warn: (message: string, data?: Record<string, unknown>) => log('warn', message, data),
    error: (message: string, data?: Record<string, unknown>) => log('error', message, data),
  };
}

export const logger = createLogger({ service: 'polyglot-db-mcp' });
