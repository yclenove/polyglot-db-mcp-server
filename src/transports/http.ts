import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { URL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectionRegistry } from '../core/registry.js';
import {
  DEFAULT_HTTP_ALLOWED_HOSTS,
  normalizeHttpHostHeader,
  type HttpTransportConfig,
} from '../core/http-config.js';
import { createErrorPayload, maskErrorCredentials, type ErrorCode } from '../core/error-codes.js';
import { logger } from '../core/logger.js';
import { buildPrometheusMetrics } from '../core/observability.js';
import { createServerWithPlugins as createMcpServer } from '../server.js';
import { healthPayload, readinessPayload, type PingSummary } from './health.js';
import { createJwtVerifier, type JwtVerifier } from '../auth/token-verifier.js';
import type { AuthorizationRuntime } from '../auth/authorization.js';
import { authContextFromInfo } from '../auth/auth-context.js';
import { BoundedHttpEventStore } from './http-event-store.js';

interface SessionEntry {
  id: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  eventStore: BoundedHttpEventStore;
  principal: string;
  createdAt: number;
  lastSeenAt: number;
  activeRequests: number;
  inFlightRequestIds: Set<string>;
  closing?: Promise<void>;
}

export interface StartedHttpTransport {
  server: http.Server;
  url: string;
  close: () => Promise<void>;
}

const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080,
]);

export function isFetchBlockedPort(port: number): boolean {
  return FETCH_BLOCKED_PORTS.has(port);
}

async function listenOnce(server: http.Server, port: number, host: string): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server.address() as AddressInfo;
}

async function closeListener(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function listenOnUsablePort(
  server: http.Server,
  config: Pick<HttpTransportConfig, 'host' | 'port'>,
): Promise<AddressInfo> {
  const maxAttempts = config.port === 0 ? 20 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const address = await listenOnce(server, config.port, config.host);
    if (config.port !== 0 || !isFetchBlockedPort(address.port)) return address;
    await closeListener(server);
  }
  throw new Error('无法分配 MCP SDK 可访问的 HTTP 动态端口');
}

class HttpResponseError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? createErrorPayload(code).message);
  }
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function sendText(
  res: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    'content-type': contentType,
    ...headers,
  });
  res.end(body);
}

function sendMcpError(
  res: ServerResponse,
  statusCode: number,
  code: ErrorCode,
  message?: string,
  headers: Record<string, string> = {},
): void {
  const errorInfo = createErrorPayload(code);
  sendJson(
    res,
    statusCode,
    {
      jsonrpc: '2.0',
      error: {
        code: statusCode === 400 ? -32600 : -32000,
        message: message ?? errorInfo.message,
        data: { error_info: errorInfo },
      },
      id: null,
    },
    headers,
  );
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function assertOriginAllowed(req: IncomingMessage, config: HttpTransportConfig): void {
  const origin = getHeader(req, 'origin');
  if (!origin) return;
  if (!config.origins.includes(origin)) {
    throw new HttpResponseError(403, 'HTTP_001', `Origin not allowed: ${origin}`);
  }
}

function assertHostAllowed(req: IncomingMessage, config: HttpTransportConfig): void {
  const hostHeader = getHeader(req, 'host');
  if (!hostHeader) {
    throw new HttpResponseError(403, 'HTTP_001', 'Host header is required');
  }

  let hostname: string;
  try {
    hostname = normalizeHttpHostHeader(hostHeader);
  } catch {
    throw new HttpResponseError(403, 'HTTP_001', 'Invalid Host header');
  }

  const allowedHosts = config.allowedHosts ?? DEFAULT_HTTP_ALLOWED_HOSTS;
  if (!allowedHosts.includes(hostname)) {
    throw new HttpResponseError(403, 'HTTP_001', `Host not allowed: ${hostname}`);
  }
}

function extractBearerToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

function apiKeyAuthInfo(): AuthInfo {
  return {
    token: 'api-key',
    clientId: 'api-key',
    scopes: ['*'],
    extra: {
      subject: 'api-key',
      transport: 'http',
      authMode: 'api_key',
      claims: {},
    },
  };
}

function disabledHttpAuthInfo(): AuthInfo {
  return {
    token: '',
    clientId: 'anonymous:http',
    scopes: ['anonymous'],
    extra: {
      subject: 'anonymous:http',
      transport: 'http',
      authMode: 'none',
      claims: {},
    },
  };
}

function effectiveAuthMode(config: HttpTransportConfig): 'none' | 'api_key' | 'bearer' {
  if (config.authDisabled) return 'none';
  return config.authMode ?? (config.apiKey ? 'api_key' : 'bearer');
}

function createVerifier(config: HttpTransportConfig): JwtVerifier | undefined {
  if (effectiveAuthMode(config) !== 'bearer') return undefined;
  if (!config.authIssuer || !config.authAudience) {
    throw new HttpResponseError(500, 'AUTH_006', 'Bearer auth missing issuer or audience');
  }
  return createJwtVerifier({
    issuer: config.authIssuer,
    audience: config.authAudience,
    jwksUrl: config.authJwksUrl,
    jwksFile: config.authJwksFile,
  });
}

async function authenticateHttpRequest(
  req: IncomingMessage,
  config: HttpTransportConfig,
  verifier: JwtVerifier | undefined,
): Promise<AuthInfo> {
  const authMode = effectiveAuthMode(config);
  if (authMode === 'none') return disabledHttpAuthInfo();

  if (authMode === 'api_key') {
    if (!config.apiKey) {
      throw new HttpResponseError(401, 'AUTH_003', 'Missing HTTP API key configuration');
    }
    const bearer = extractBearerToken(getHeader(req, 'authorization'));
    const apiKey = getHeader(req, 'x-api-key');
    if (bearer === config.apiKey || apiKey === config.apiKey) return apiKeyAuthInfo();
    throw new HttpResponseError(401, 'AUTH_003', 'Missing or invalid HTTP API key');
  }

  const bearer = extractBearerToken(getHeader(req, 'authorization'));
  if (!bearer) {
    throw new HttpResponseError(401, 'AUTH_003', 'Missing Bearer token');
  }
  if (!verifier) {
    throw new HttpResponseError(401, 'AUTH_006', 'Bearer verifier is not configured');
  }
  try {
    return await verifier.verify(bearer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code: ErrorCode = message.includes('[AUTH_004]') ? 'AUTH_004' : 'AUTH_006';
    throw new HttpResponseError(401, code, maskErrorCredentials(message));
  }
}

async function readJsonBody(
  req: IncomingMessage,
  limitBytes: number,
  timeoutMs: number,
): Promise<unknown> {
  req.setTimeout(timeoutMs, () => {
    req.destroy(new Error('HTTP request timeout'));
  });

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      throw new HttpResponseError(413, 'HTTP_002');
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    throw new HttpResponseError(400, 'HTTP_003', 'POST /mcp requires a JSON body');
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpResponseError(400, 'HTTP_003', 'Invalid JSON body');
  }
}

async function closeSession(session: SessionEntry): Promise<void> {
  if (!session.closing) {
    session.closing = (async () => {
      session.eventStore.clear();
      await Promise.allSettled([session.transport.close(), session.server.close()]);
    })();
  }
  await session.closing;
}

function sessionPrincipal(authInfo: AuthInfo): string {
  const context = authContextFromInfo(authInfo);
  return JSON.stringify([
    context.authMode,
    context.tenant ?? '',
    context.subject,
    authInfo.clientId,
  ]);
}

function requestIdKey(id: string | number): string {
  return `${typeof id}:${String(id)}`;
}

function requestIds(body: unknown): { keys: string[]; duplicate?: string | number } {
  const messages = Array.isArray(body) ? body : [body];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
    const record = message as Record<string, unknown>;
    if (typeof record.method !== 'string') continue;
    const id = record.id;
    if (typeof id !== 'string' && typeof id !== 'number') continue;
    const key = requestIdKey(id);
    if (seen.has(key)) return { keys: [], duplicate: id };
    seen.add(key);
    keys.push(key);
  }
  return { keys };
}

export async function startHttpTransport(options: {
  registry: ConnectionRegistry;
  config: HttpTransportConfig;
  startupPings: readonly PingSummary[];
  authorization?: AuthorizationRuntime;
  startedAt?: Date;
}): Promise<StartedHttpTransport> {
  const { registry, config, startupPings, authorization, startedAt = new Date() } = options;
  const sessions = new Map<string, SessionEntry>();
  const jwtVerifier = createVerifier(config);
  const maxSessions = config.maxSessions ?? 1000;
  const sessionIdleTimeoutMs = config.sessionIdleTimeoutMs ?? 30 * 60_000;
  const eventStoreMaxEvents = config.eventStoreMaxEvents ?? 1000;
  const eventStoreMaxBytes = config.eventStoreMaxBytes ?? 8 * 1024 * 1024;
  let pendingSessionInitializations = 0;

  const handleSessionRequest = async (
    session: SessionEntry,
    req: IncomingMessage,
    res: ServerResponse,
    body?: unknown,
  ): Promise<void> => {
    session.activeRequests++;
    session.lastSeenAt = Date.now();
    try {
      await session.transport.handleRequest(req, res, body);
    } catch (error) {
      if (req.method === 'GET' && (req.destroyed || res.destroyed)) return;
      throw error;
    } finally {
      session.activeRequests = Math.max(0, session.activeRequests - 1);
      session.lastSeenAt = Date.now();
    }
  };

  const resolveOwnedSession = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<SessionEntry | undefined> => {
    assertOriginAllowed(req, config);
    const authInfo = await authenticateHttpRequest(req, config, jwtVerifier);
    (req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo;
    const sessionId = getHeader(req, 'mcp-session-id');
    if (!sessionId) {
      sendMcpError(res, 400, 'HTTP_006', 'Mcp-Session-Id header is required');
      return undefined;
    }
    const session = sessions.get(sessionId);
    if (!session || session.principal !== sessionPrincipal(authInfo)) {
      sendMcpError(res, 404, 'HTTP_004', 'MCP session not found');
      return undefined;
    }
    return session;
  };

  const handleMcpPost = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    assertOriginAllowed(req, config);
    const authInfo = await authenticateHttpRequest(req, config, jwtVerifier);
    (req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo;
    const body = await readJsonBody(req, config.bodyLimitBytes, config.requestTimeoutMs);
    const sessionId = getHeader(req, 'mcp-session-id');

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session || session.principal !== sessionPrincipal(authInfo)) {
        sendMcpError(res, 404, 'HTTP_004', 'MCP session not found');
        return;
      }
      const ids = requestIds(body);
      if (ids.duplicate !== undefined) {
        sendMcpError(res, 400, 'HTTP_006', 'Duplicate JSON-RPC request ID in batch');
        return;
      }
      if (ids.keys.some((key) => session.inFlightRequestIds.has(key))) {
        sendMcpError(res, 400, 'HTTP_006', 'JSON-RPC request ID is already in flight');
        return;
      }
      for (const key of ids.keys) session.inFlightRequestIds.add(key);
      try {
        await handleSessionRequest(session, req, res, body);
      } finally {
        for (const key of ids.keys) session.inFlightRequestIds.delete(key);
      }
      return;
    }

    if (!isInitializeRequest(body)) {
      sendMcpError(res, 400, 'HTTP_006', 'New MCP sessions must start with initialize');
      return;
    }

    if (sessions.size + pendingSessionInitializations >= maxSessions) {
      sendMcpError(res, 503, 'HTTP_007', undefined, { 'retry-after': '1' });
      return;
    }

    pendingSessionInitializations++;
    let reservationHeld = true;
    const releaseReservation = (): void => {
      if (!reservationHeld) return;
      reservationHeld = false;
      pendingSessionInitializations--;
    };
    let provisionalSession: SessionEntry | undefined;
    try {
      const mcpServer = await createMcpServer(registry, { authorization });
      const eventStore = new BoundedHttpEventStore(eventStoreMaxEvents, eventStoreMaxBytes);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        eventStore,
        onsessioninitialized: (newSessionId) => {
          const now = Date.now();
          session.id = newSessionId;
          session.createdAt = now;
          session.lastSeenAt = now;
          sessions.set(newSessionId, session);
          releaseReservation();
        },
        onsessionclosed: (closedSessionId) => {
          const closed = sessions.get(closedSessionId);
          sessions.delete(closedSessionId);
          closed?.eventStore.clear();
        },
      });
      const session: SessionEntry = {
        id: '',
        server: mcpServer,
        transport,
        eventStore,
        principal: sessionPrincipal(authInfo),
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        activeRequests: 1,
        inFlightRequestIds: new Set(),
      };
      provisionalSession = session;

      await mcpServer.connect(transport);
      try {
        await transport.handleRequest(req, res, body);
      } finally {
        session.activeRequests = 0;
        session.lastSeenAt = Date.now();
      }
    } finally {
      releaseReservation();
      if (provisionalSession && !provisionalSession.transport.sessionId) {
        await closeSession(provisionalSession);
      }
    }
  };

  const handleMcpSessionMethod = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const session = await resolveOwnedSession(req, res);
    if (!session) return;
    await handleSessionRequest(session, req, res);
    if (req.method === 'DELETE' && !sessions.has(session.id)) {
      await closeSession(session);
    }
  };

  let sweepRunning = false;
  const sweepIdleSessions = async (): Promise<void> => {
    if (sweepRunning) return;
    sweepRunning = true;
    try {
      const now = Date.now();
      for (const [sessionId, session] of sessions) {
        if (session.activeRequests === 0 && now - session.lastSeenAt >= sessionIdleTimeoutMs) {
          sessions.delete(sessionId);
          await closeSession(session);
          logger.info('expired idle MCP HTTP session', {
            age_ms: now - session.createdAt,
            idle_ms: now - session.lastSeenAt,
          });
        }
      }
    } finally {
      sweepRunning = false;
    }
  };
  const sweepIntervalMs = Math.max(25, Math.min(60_000, Math.floor(sessionIdleTimeoutMs / 2)));
  const sessionSweepTimer = setInterval(() => {
    void sweepIdleSessions().catch((error) => {
      logger.warn('HTTP session sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, sweepIntervalMs);
  sessionSweepTimer.unref();

  const nodeServer = http.createServer((req, res) => {
    void (async () => {
      assertHostAllowed(req, config);
      const requestUrl = new URL(req.url ?? '/', 'http://localhost');
      const pathname = requestUrl.pathname;

      if (req.method === 'GET' && pathname === '/healthz') {
        sendJson(res, 200, healthPayload(startedAt));
        return;
      }

      if (req.method === 'GET' && pathname === '/readyz') {
        const ready = readinessPayload(registry, startupPings);
        sendJson(res, ready.statusCode, ready.payload);
        return;
      }

      if (pathname === '/metrics') {
        assertOriginAllowed(req, config);
        if (req.method === 'GET') {
          await authenticateHttpRequest(req, config, jwtVerifier);
          sendText(
            res,
            200,
            buildPrometheusMetrics(registry),
            'text/plain; version=0.0.4; charset=utf-8',
          );
          return;
        }
        sendMcpError(res, 405, 'HTTP_003', 'Method not allowed', { allow: 'GET' });
        return;
      }

      if (pathname !== config.endpoint) {
        sendMcpError(res, 404, 'HTTP_004', 'Endpoint not found');
        return;
      }

      if (req.method === 'POST') {
        await handleMcpPost(req, res);
        return;
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        await handleMcpSessionMethod(req, res);
        return;
      }

      sendMcpError(res, 405, 'HTTP_003', 'Method not allowed', {
        allow: 'POST, GET, DELETE',
      });
    })().catch((error) => {
      const message = maskErrorCredentials(error instanceof Error ? error.message : String(error));
      logger.error('http request failed', { error: message });
      if (error instanceof HttpResponseError) {
        sendMcpError(res, error.statusCode, error.code, error.message);
        return;
      }
      sendMcpError(res, 500, 'CONN_001', 'Internal server error');
    });
  });

  const address = await listenOnUsablePort(nodeServer, config);
  const url = `http://${config.host}:${address.port}${config.endpoint}`;

  return {
    server: nodeServer,
    url,
    close: async () => {
      clearInterval(sessionSweepTimer);
      const activeSessions = [...sessions.values()];
      sessions.clear();
      for (const session of activeSessions) {
        await closeSession(session);
      }
      await closeListener(nodeServer);
    },
  };
}
