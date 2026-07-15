import type { BuiltinEngine, ConnectionSpec, Engine } from './types.js';
import { CONNECTION_ID_REGEX } from './types.js';

const ENGINES = new Set<BuiltinEngine>([
  'mysql',
  'postgres',
  'mssql',
  'oracle',
  'sqlite',
  'duckdb',
  'mongodb',
  'redis',
]);
const PLUGIN_ENGINE_REGEX = /^[a-z][a-z0-9_-]*$/;

export interface ParseConnectionSpecsOptions {
  pluginEngines?: readonly string[];
}

function assertEngine(v: string, pluginEngines: ReadonlySet<string>): Engine {
  if (ENGINES.has(v as BuiltinEngine)) {
    return v as BuiltinEngine;
  }
  if (pluginEngines.has(v) && PLUGIN_ENGINE_REGEX.test(v)) {
    return v;
  }
  const allowed = [...ENGINES, ...pluginEngines].sort();
  throw new Error(`不支持的 engine: ${v}，允许: ${allowed.join(', ')}`);
}

/**
 * 从环境变量解析 `DB_MCP_CONNECTIONS`（JSON 数组）。
 */
export function parseConnectionSpecs(
  raw?: string,
  options: ParseConnectionSpecsOptions = {},
): ConnectionSpec[] {
  const src = raw ?? process.env.DB_MCP_CONNECTIONS;
  const pluginEngines = new Set(
    (options.pluginEngines ?? []).map((engine) => engine.toLowerCase()),
  );
  if (src === undefined || String(src).trim() === '') {
    throw new Error(
      '必须设置 DB_MCP_CONNECTIONS（JSON 数组），每项含 id、engine 与 url 或 host 等',
    );
  }
  let arr: unknown[];
  try {
    arr = JSON.parse(String(src)) as unknown[];
  } catch {
    throw new Error('DB_MCP_CONNECTIONS 不是合法 JSON');
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('DB_MCP_CONNECTIONS 须为非空 JSON 数组');
  }

  const seen = new Set<string>();
  const out: ConnectionSpec[] = [];

  for (const item of arr) {
    if (item === null || typeof item !== 'object') {
      throw new Error('DB_MCP_CONNECTIONS 数组元素须为对象');
    }
    const o = item as Record<string, unknown>;
    const id = o.id;
    if (typeof id !== 'string' || !CONNECTION_ID_REGEX.test(id)) {
      throw new Error('每个连接须包含合法 id（字母数字下划线）');
    }
    if (seen.has(id)) {
      throw new Error(`DB_MCP_CONNECTIONS 中 id「${id}」重复`);
    }
    seen.add(id);

    const engineRaw = o.engine;
    if (typeof engineRaw !== 'string') {
      throw new Error(`连接「${id}」缺少 engine`);
    }
    const engine = assertEngine(engineRaw.toLowerCase(), pluginEngines);

    const url = typeof o.url === 'string' && o.url.trim() !== '' ? o.url.trim() : undefined;
    const host = o.host !== undefined ? String(o.host) : undefined;
    const port = o.port !== undefined ? parseInt(String(o.port), 10) : undefined;
    const user = o.user !== undefined ? String(o.user) : undefined;
    const password = o.password !== undefined ? String(o.password) : undefined;
    const database = o.database !== undefined ? String(o.database) : undefined;
    const readonly = engine === 'duckdb' ? o.readonly !== false : o.readonly === true;
    const keyPrefix =
      typeof o.keyPrefix === 'string' && o.keyPrefix.length > 0 ? o.keyPrefix : undefined;

    let allowlist: string[] | undefined;
    if (Array.isArray(o.allowlist)) {
      allowlist = o.allowlist.map((x) => String(x));
    }

    if (engine === 'redis' || engine === 'mongodb') {
      if (!url) {
        throw new Error(`连接「${id}」：${engine} 必须提供 url`);
      }
    } else if (engine === 'sqlite' || engine === 'duckdb') {
      // SQLite/DuckDB 不需要 host，仅需 url 或 database，缺省为 :memory:
    } else if (!url && !host) {
      throw new Error(`连接「${id}」：SQL 类引擎需提供 url 或 host`);
    }

    // 端口范围校验
    if (port !== undefined && (!Number.isFinite(port) || port < 1 || port > 65535)) {
      throw new Error(`连接「${id}」：端口 ${port} 不在有效范围 1-65535`);
    }

    out.push({
      id,
      engine,
      url,
      host,
      port: Number.isFinite(port) ? port : undefined,
      user,
      password,
      database,
      readonly,
      allowlist,
      keyPrefix,
    });
  }

  return out;
}

export function getDefaultConnectionId(specs: ConnectionSpec[]): string {
  const fromEnv = process.env.DB_MCP_DEFAULT_CONNECTION_ID;
  if (fromEnv && specs.some((s) => s.id === fromEnv)) {
    return fromEnv;
  }
  return specs[0]!.id;
}

function boundedIntegerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = (process.env[name] ?? String(fallback)).trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) return fallback;
  return Math.min(value, maximum);
}

export function globalLimits() {
  return {
    queryTimeoutMs: boundedIntegerEnv('DB_QUERY_TIMEOUT', 30_000, 0, 2_147_483_647),
    maxRows: boundedIntegerEnv('DB_MAX_ROWS', 100, 1, 10_000),
    maxResponseBytes: boundedIntegerEnv(
      'DB_MAX_RESPONSE_BYTES',
      1024 * 1024,
      4096,
      16 * 1024 * 1024,
    ),
    maxSqlLength: boundedIntegerEnv('DB_MAX_SQL_LENGTH', 102_400, 1),
    retryCount: boundedIntegerEnv('DB_RETRY_COUNT', 2, 0, 10),
    retryDelayMs: boundedIntegerEnv('DB_RETRY_DELAY_MS', 200, 0, 2_147_483_647),
  };
}

export function responseDataByteLimit(maxResponseBytes = globalLimits().maxResponseBytes): number {
  const reserve = Math.max(1024, Math.min(64 * 1024, Math.floor(maxResponseBytes / 4)));
  return Math.max(2, maxResponseBytes - reserve);
}

export function mongoLimits() {
  const configured = parseInt(
    process.env.DB_MONGO_MAX_TIME_MS || process.env.DB_QUERY_TIMEOUT || '30000',
    10,
  );
  return {
    maxTimeMs: Number.isFinite(configured) && configured >= 0 ? configured : 30_000,
  };
}

export function maskingLimits() {
  return {
    mode: (process.env.DB_MASKING_MODE ?? 'off') as 'off' | 'loose' | 'strict',
    excludeFields: (process.env.DB_MASKING_EXCLUDE_FIELDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function replayLimits() {
  return {
    bufferSize: parseInt(process.env.DB_REPLAY_BUFFER_SIZE || '50', 10),
  };
}

export function suggestLimits() {
  return {
    timeoutMs: parseInt(process.env.DB_SUGGEST_TIMEOUT_MS || '5000', 10),
  };
}
