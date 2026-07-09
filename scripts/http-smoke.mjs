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

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  if (!toolNames.includes('list_connections')) {
    throw new Error('list_connections not found in tools/list response');
  }
  console.log(`[OK] connected to ${endpoint}`);
  console.log(`[OK] tools: ${toolNames.length}`);
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await transport.close().catch(() => {});
}
