import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  BoundedItemCollector,
  boundMaterializedItems,
  jsonByteLength,
} from '../dist/core/byte-budget.js';
import {
  RESPONSE_METADATA_KEY,
  enforceToolResponseBudget,
  installResponseBudget,
} from '../dist/core/response-budget.js';

afterEach(() => {
  delete process.env.DB_MAX_RESPONSE_BYTES;
});

describe('bounded item collector', () => {
  test('stops before the first row over the byte budget', () => {
    const collector = new BoundedItemCollector(10, 40);
    assert.equal(collector.add({ id: 1, value: 'ok' }), true);
    assert.equal(collector.add({ id: 2, value: 'x'.repeat(100) }), false);

    const result = collector.result();
    assert.deepEqual(result.items, [{ id: 1, value: 'ok' }]);
    assert.equal(result.observedItems, 2);
    assert.equal(result.truncated, true);
    assert.equal(result.truncatedBy, 'bytes');
    assert.ok(result.returnedBytes <= 40);
  });

  test('distinguishes row truncation and knows materialized totals', () => {
    const result = boundMaterializedItems([{ id: 1 }, { id: 2 }, { id: 3 }], 2, 1024);
    assert.deepEqual(result.items, [{ id: 1 }, { id: 2 }]);
    assert.equal(result.totalItems, 3);
    assert.equal(result.totalItemsExact, true);
    assert.equal(result.truncatedBy, 'rows');
  });
});

describe('MCP tool response budget', () => {
  test('returns an under-budget result unchanged', () => {
    const result = { content: [{ type: 'text', text: '{"ok":true}' }] };
    assert.equal(enforceToolResponseBudget(result, 'probe', 4096), result);
  });

  test('keeps oversized JSON parseable and reports explicit metadata', () => {
    const original = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            rows: Array.from({ length: 100 }, (_, index) => ({
              index,
              value: 'x'.repeat(100),
            })),
          }),
        },
      ],
    };
    const limited = enforceToolResponseBudget(original, 'large_query', 1024);

    assert.ok(jsonByteLength(limited) <= 1024);
    const payload = JSON.parse(limited.content[0].text);
    assert.equal(payload[RESPONSE_METADATA_KEY].truncated, true);
    assert.equal(payload[RESPONSE_METADATA_KEY].reason, 'response_byte_limit');
    assert.equal(payload[RESPONSE_METADATA_KEY].tool, 'large_query');
    assert.ok(payload[RESPONSE_METADATA_KEY].originalBytes > 1024);
    assert.ok(Array.isArray(payload.data.rows));
    assert.ok(payload.data.rows.length < 100);
  });

  test('does not split UTF-16 surrogate pairs while truncating text', () => {
    const symbol = '\u{1F600}';
    const original = { content: [{ type: 'text', text: symbol.repeat(2000) }] };
    const limited = enforceToolResponseBudget(original, 'unicode_probe', 700);
    const payload = JSON.parse(limited.content[0].text);
    const value = payload.data;
    const lastCodeUnit = value.charCodeAt(value.length - 1);

    assert.ok(jsonByteLength(limited) <= 700);
    assert.equal(lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff, false);
  });

  test('returns a schema-safe tool error instead of invalid structured content', () => {
    const result = {
      content: [{ type: 'text', text: 'large result' }],
      structuredContent: { rows: [{ value: 'x'.repeat(5000) }] },
    };
    const limited = enforceToolResponseBudget(result, 'schema_tool', 1024, true);
    const payload = JSON.parse(limited.content[0].text);

    assert.equal(limited.isError, true);
    assert.equal(limited.structuredContent, undefined);
    assert.equal(payload[RESPONSE_METADATA_KEY].truncated, true);
    assert.ok(jsonByteLength(limited) <= 1024);
  });

  test('wraps tools registered after installation', async () => {
    class MockServer {
      tools = new Map();
      registerTool(name, config, handler) {
        this.tools.set(name, { config, handler });
      }
    }

    process.env.DB_MAX_RESPONSE_BYTES = '4096';
    const server = new MockServer();
    installResponseBudget(server);
    server.registerTool('plugin_large', {}, async () => ({
      content: [{ type: 'text', text: JSON.stringify({ value: 'x'.repeat(20_000) }) }],
    }));

    const result = await server.tools.get('plugin_large').handler({});
    assert.ok(jsonByteLength(result) <= 4096);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload[RESPONSE_METADATA_KEY].tool, 'plugin_large');
  });

  test('remains outside the authorization wrapper and limits denial output', async () => {
    const { installAuthorization } = await import('../dist/auth/authorization.js');
    class MockServer {
      tools = new Map();
      registerTool(name, config, handler) {
        this.tools.set(name, { config, handler });
      }
    }

    process.env.DB_MAX_RESPONSE_BYTES = '4096';
    const server = new MockServer();
    installResponseBudget(server);
    installAuthorization(server, {
      authorize() {
        return {
          allowed: false,
          reason: 'x'.repeat(20_000),
          roles: [],
          action: 'read',
          subject: 'test',
          transport: 'stdio',
        };
      },
    });
    server.registerTool('denied_large', {}, async () => {
      throw new Error('must not execute');
    });

    const result = await server.tools.get('denied_large').handler({});
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload[RESPONSE_METADATA_KEY].tool, 'denied_large');
    assert.ok(jsonByteLength(result) <= 4096);
  });

  test('preserves task handlers and limits their final tool result', async () => {
    class MockServer {
      tools = new Map();
      registerTool(name, config, handler) {
        this.tools.set(name, { config, handler });
      }
    }

    process.env.DB_MAX_RESPONSE_BYTES = '4096';
    const server = new MockServer();
    installResponseBudget(server);
    const createTask = async () => ({ task: { taskId: '1', status: 'working' } });
    const getTask = async () => ({ task: { taskId: '1', status: 'completed' } });
    server.registerTool('task_large', {}, {
      createTask,
      getTask,
      async getTaskResult() {
        return { content: [{ type: 'text', text: 'x'.repeat(20_000) }] };
      },
    });

    const handler = server.tools.get('task_large').handler;
    assert.equal(handler.createTask, createTask);
    assert.equal(handler.getTask, getTask);
    const result = await handler.getTaskResult({});
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload[RESPONSE_METADATA_KEY].tool, 'task_large');
    assert.ok(jsonByteLength(result) <= 4096);
  });
});
