import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { URL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
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

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  createdAt: number;
  lastSeenAt: number;
}

export interface StartedHttpTransport {
  server: http.Server;
  url: string;
  close: () => Promise<void>;
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
  await Promise.allSettled([session.transport.close(), session.server.close()]);
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

  const handleMcpPost = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    assertOriginAllowed(req, config);
    const authInfo = await authenticateHttpRequest(req, config, jwtVerifier);
    (req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo;
    const body = await readJsonBody(req, config.bodyLimitBytes, config.requestTimeoutMs);
    const sessionId = getHeader(req, 'mcp-session-id');

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        sendMcpError(res, 404, 'HTTP_004', 'MCP session not found');
        return;
      }
      session.lastSeenAt = Date.now();
      await session.transport.handleRequest(req, res, body);
      return;
    }

    const mcpServer = await createMcpServer(registry, { authorization });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, {
          server: mcpServer,
          transport,
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
        });
      },
      onsessionclosed: (closedSessionId) => {
        sessions.delete(closedSessionId);
      },
    });

    await mcpServer.connect(transport);
    try {
      await transport.handleRequest(req, res, body);
    } finally {
      if (!transport.sessionId && !res.destroyed) {
        await closeSession({
          server: mcpServer,
          transport,
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
        });
      }
    }
  };

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
        assertOriginAllowed(req, config);
        await authenticateHttpRequest(req, config, jwtVerifier);
        sendMcpError(res, 405, 'HTTP_003', 'Method not allowed', { allow: 'POST' });
        return;
      }

      sendMcpError(res, 405, 'HTTP_003', 'Method not allowed', { allow: 'POST' });
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

  await new Promise<void>((resolve, reject) => {
    nodeServer.once('error', reject);
    nodeServer.listen(config.port, config.host, () => {
      nodeServer.off('error', reject);
      resolve();
    });
  });

  const address = nodeServer.address() as AddressInfo;
  const url = `http://${config.host}:${address.port}${config.endpoint}`;

  return {
    server: nodeServer,
    url,
    close: async () => {
      for (const session of sessions.values()) {
        await closeSession(session);
      }
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        nodeServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
