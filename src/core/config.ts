import type { ConnectionSpec, Engine } from './types.js';
import { CONNECTION_ID_REGEX } from './types.js';

const ENGINES = new Set<Engine>(['mysql', 'postgres', 'mssql', 'oracle', 'mongodb', 'redis']);

function assertEngine(v: string): Engine {
  if (!ENGINES.has(v as Engine)) {
    throw new Error(`不支持的 engine: ${v}，允许: ${[...ENGINES].join(', ')}`);
  }
  return v as Engine;
}

/**
 * 从环境变量解析 `DB_MCP_CONNECTIONS`（JSON 数组）。
 */
export function parseConnectionSpecs(raw?: string): ConnectionSpec[] {
  const src = raw ?? process.env.DB_MCP_CONNECTIONS;
  if (src === undefined || String(src).trim() === '') {
    throw new Error('必须设置 DB_MCP_CONNECTIONS（JSON 数组），每项含 id、engine 与 url 或 host 等');
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
    const engine = assertEngine(engineRaw.toLowerCase());

    const url = typeof o.url === 'string' && o.url.trim() !== '' ? o.url.trim() : undefined;
    const host = o.host !== undefined ? String(o.host) : undefined;
    const port = o.port !== undefined ? parseInt(String(o.port), 10) : undefined;
    const user = o.user !== undefined ? String(o.user) : undefined;
    const password = o.password !== undefined ? String(o.password) : undefined;
    const database = o.database !== undefined ? String(o.database) : undefined;
    const readonly = o.readonly === true;
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
    } else if (!url && !host) {
      throw new Error(`连接「${id}」：SQL 类引擎需提供 url 或 host`);
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

export function globalLimits() {
  return {
    queryTimeoutMs: parseInt(process.env.DB_QUERY_TIMEOUT || '30000', 10),
    maxRows: parseInt(process.env.DB_MAX_ROWS || '100', 10),
    maxSqlLength: parseInt(process.env.DB_MAX_SQL_LENGTH || '102400', 10),
    retryCount: parseInt(process.env.DB_RETRY_COUNT || '2', 10),
    retryDelayMs: parseInt(process.env.DB_RETRY_DELAY_MS || '200', 10),
  };
}
