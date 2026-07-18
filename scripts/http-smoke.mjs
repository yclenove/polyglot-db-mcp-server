#!/usr/bin/env node
/**
 * Streamable HTTP smoke test.
 *
 * Usage:
 *   node scripts/http-smoke.mjs http://127.0.0.1:3000/mcp
 *   node scripts/http-smoke.mjs http://127.0.0.1:3000/mcp --api-key dev-key
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
const endpoint = args[0] || process.env.DB_HTTP_SMOKE_URL || 'http://127.0.0.1:3000/mcp';
const apiKeyIndex = args.indexOf('--api-key');
const apiKey = apiKeyIndex >= 0 ? args[apiKeyIndex + 1] : process.env.DB_HTTP_API_KEY;

if (apiKeyIndex >= 0 && !apiKey) {
  console.error('[FAIL] --api-key requires a value');
  process.exit(1);
}

const client = new Client({ name: 'polyglot-db-http-smoke', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : undefined,
});
const authHeaders = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
let terminated = false;

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  if (!toolNames.includes('list_connections')) {
    throw new Error('list_connections not found in tools/list response');
  }
  const sessionId = transport.sessionId;
  if (!sessionId) throw new Error('server did not issue an MCP session ID');

  const sse = await fetch(endpoint, {
    method: 'GET',
    headers: {
      ...authHeaders,
      accept: 'text/event-stream',
      'mcp-session-id': sessionId,
      'mcp-protocol-version': '2025-11-25',
    },
  });
  if (sse.status !== 200 && sse.status !== 409) {
    throw new Error(`GET SSE returned unexpected status ${sse.status}`);
  }
  if (sse.status === 200 && !sse.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new Error('GET SSE returned an unexpected content type');
  }
  await sse.body?.cancel();

  await transport.terminateSession();
  terminated = true;
  const stale = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...authHeaders,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-session-id': sessionId,
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  if (stale.status !== 404) {
    throw new Error(`terminated session returned unexpected status ${stale.status}`);
  }
  await stale.body?.cancel();

  console.log(`[OK] connected to ${endpoint}`);
  console.log(`[OK] tools: ${toolNames.length}`);
  console.log(`[OK] GET SSE: ${sse.status}`);
  console.log('[OK] DELETE terminated the session');
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (!terminated) await transport.close().catch(() => {});
}
