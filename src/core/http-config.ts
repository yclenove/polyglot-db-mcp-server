import { withErrorCode } from './error-codes.js';

export type TransportMode = 'stdio' | 'http';

export interface HttpTransportConfig {
  transport: TransportMode;
  host: string;
  port: number;
  endpoint: string;
  origins: string[];
  apiKey?: string;
  authDisabled: boolean;
  bodyLimitBytes: number;
  requestTimeoutMs: number;
}

type EnvLike = Record<string, string | undefined>;

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value.trim() === '') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(withErrorCode('CFG_005', `布尔值无效: ${value}`));
}

function parseIntRange(name: string, value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(withErrorCode('CFG_005', `${name} 必须是 1-65535 之间的整数`));
  }
  return parsed;
}

function parsePositiveInt(name: string, value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(withErrorCode('CFG_005', `${name} 必须是正整数`));
  }
  return parsed;
}

function parseTransport(value: string | undefined): TransportMode {
  const normalized = (value ?? 'stdio').trim().toLowerCase();
  if (normalized === 'stdio' || normalized === 'http') return normalized;
  throw new Error(withErrorCode('CLI_002', `transport 必须是 stdio 或 http，实际为 ${value}`));
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertEndpoint(endpoint: string): string {
  if (!endpoint.startsWith('/')) {
    throw new Error(withErrorCode('CFG_005', 'DB_HTTP_ENDPOINT 必须以 / 开头'));
  }
  if (endpoint.includes('?') || endpoint.includes('#')) {
    throw new Error(withErrorCode('CFG_005', 'DB_HTTP_ENDPOINT 不能包含 query 或 fragment'));
  }
  return endpoint;
}

function isLocalHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return ['127.0.0.1', 'localhost', '::1'].includes(normalized);
}

function applyArgs(env: EnvLike, args: readonly string[]): EnvLike {
  const merged: EnvLike = { ...env };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--transport': {
        const value = args[++i];
        if (!value) throw new Error(withErrorCode('CLI_002', '--transport 需要 stdio 或 http'));
        merged.DB_MCP_TRANSPORT = value;
        break;
      }
      case '--host': {
        const value = args[++i];
        if (!value) throw new Error(withErrorCode('CLI_002', '--host 需要监听地址'));
        merged.DB_HTTP_HOST = value;
        break;
      }
      case '--port': {
        const value = args[++i];
        if (!value) throw new Error(withErrorCode('CLI_002', '--port 需要端口号'));
        merged.DB_HTTP_PORT = value;
        break;
      }
      case '--endpoint': {
        const value = args[++i];
        if (!value) throw new Error(withErrorCode('CLI_002', '--endpoint 需要路径'));
        merged.DB_HTTP_ENDPOINT = value;
        break;
      }
      case '--http-api-key': {
        const value = args[++i];
        if (!value) throw new Error(withErrorCode('CLI_002', '--http-api-key 需要值'));
        merged.DB_HTTP_API_KEY = value;
        break;
      }
      case '--http-auth-disabled':
        merged.DB_HTTP_AUTH_DISABLED = 'true';
        break;
      default:
        throw new Error(withErrorCode('CLI_002', `未知启动参数 ${arg}`));
    }
  }
  return merged;
}

export function parseHttpTransportConfig(
  env: EnvLike = process.env,
  args: readonly string[] = [],
): HttpTransportConfig {
  const merged = applyArgs(env, args);
  const transport = parseTransport(merged.DB_MCP_TRANSPORT);
  const host = (merged.DB_HTTP_HOST || '127.0.0.1').trim();
  if (!host) throw new Error(withErrorCode('CFG_005', 'DB_HTTP_HOST 不能为空'));

  const config: HttpTransportConfig = {
    transport,
    host,
    port: parseIntRange('DB_HTTP_PORT', merged.DB_HTTP_PORT, 3000),
    endpoint: assertEndpoint(merged.DB_HTTP_ENDPOINT || '/mcp'),
    origins: parseOrigins(merged.DB_HTTP_ORIGINS),
    apiKey: merged.DB_HTTP_API_KEY?.trim() || undefined,
    authDisabled: parseBoolean(merged.DB_HTTP_AUTH_DISABLED),
    bodyLimitBytes: parsePositiveInt(
      'DB_HTTP_BODY_LIMIT_BYTES',
      merged.DB_HTTP_BODY_LIMIT_BYTES,
      DEFAULT_BODY_LIMIT_BYTES,
    ),
    requestTimeoutMs: parsePositiveInt(
      'DB_HTTP_REQUEST_TIMEOUT_MS',
      merged.DB_HTTP_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
  };

  if (
    config.transport === 'http' &&
    !isLocalHost(config.host) &&
    !config.apiKey &&
    !config.authDisabled
  ) {
    throw new Error(
      withErrorCode(
        'AUTH_003',
        'HTTP 监听非本地地址时必须设置 DB_HTTP_API_KEY，或显式设置 DB_HTTP_AUTH_DISABLED=true',
      ),
    );
  }

  return config;
}

export function safeHttpConfig(config: HttpTransportConfig): Record<string, unknown> {
  return {
    transport: config.transport,
    host: config.host,
    port: config.port,
    endpoint: config.endpoint,
    origins: config.origins,
    auth: config.apiKey ? 'api_key' : config.authDisabled ? 'disabled' : 'local-only',
    body_limit_bytes: config.bodyLimitBytes,
    request_timeout_ms: config.requestTimeoutMs,
  };
}

export function isLocalHttpHost(host: string): boolean {
  return isLocalHost(host);
}
