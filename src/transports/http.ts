import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { URL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionRegistry } from '../core/registry.js';
import type { HttpTransportConfig } from '../core/http-config.js';
import { createErrorPayload, maskErrorCredentials, type ErrorCode } from '../core/error-codes.js';
import { logger } from '../core/logger.js';
import { createServer as createMcpServer } from '../server.js';
import { healthPayload, readinessPayload, type PingSummary } from './health.js';

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

function extractBearerToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

function assertAuthorized(req: IncomingMessage, config: HttpTransportConfig): void {
  if (config.authDisabled || !config.apiKey) return;
  const bearer = extractBearerToken(getHeader(req, 'authorization'));
  const apiKey = getHeader(req, 'x-api-key');
  if (bearer === config.apiKey || apiKey === config.apiKey) return;
  throw new HttpResponseError(401, 'AUTH_003', 'Missing or invalid HTTP API key');
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
  startedAt?: Date;
}): Promise<StartedHttpTransport> {
  const { registry, config, startupPings, startedAt = new Date() } = options;
  const sessions = new Map<string, SessionEntry>();

  const handleMcpPost = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    assertOriginAllowed(req, config);
    assertAuthorized(req, config);
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

    const mcpServer = createMcpServer(registry);
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
      const requestUrl = new URL(
        req.url ?? '/',
        `http://${req.headers.host ?? `${config.host}:${config.port}`}`,
      );
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
        assertAuthorized(req, config);
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
