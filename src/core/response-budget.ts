import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { globalLimits } from './config.js';
import { jsonByteLength, stringifyJsonSafe } from './byte-budget.js';
import { logger } from './logger.js';

export const RESPONSE_METADATA_KEY = '_db_mcp_response';

interface ResponseLimitMetadata {
  truncated: true;
  reason: 'response_byte_limit';
  tool: string;
  limitBytes: number;
  originalBytes: number;
}

function truncateString(value: string, maxBytes: number): string {
  if (jsonByteLength(value) <= maxBytes) return value;
  const suffix = '...[truncated]';
  const boundaries = [0];
  let offset = 0;
  for (const codePoint of value) {
    offset += codePoint.length;
    boundaries.push(offset);
  }
  let low = 0;
  let high = boundaries.length - 1;
  let best = '';

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${value.slice(0, boundaries[middle])}${suffix}`;
    if (jsonByteLength(candidate) <= maxBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best || '';
}

function fitJsonValue(value: unknown, maxBytes: number, depth = 0): unknown {
  if (maxBytes <= 0) return null;
  if (jsonByteLength(value) <= maxBytes) return value;
  if (depth >= 32) return null;

  if (typeof value === 'string') return truncateString(value, maxBytes);
  if (Array.isArray(value)) {
    let low = 0;
    let high = value.length;
    let count = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (jsonByteLength(value.slice(0, middle)) <= maxBytes) {
        count = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (count > 0) return value.slice(0, count);
    if (value.length === 0 || maxBytes <= 2) return [];
    const first = fitJsonValue(value[0], maxBytes - 2, depth + 1);
    return jsonByteLength([first]) <= maxBytes ? [first] : [];
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      const fullCandidate = { ...output, [key]: nested };
      if (jsonByteLength(fullCandidate) <= maxBytes) {
        output[key] = nested;
        continue;
      }

      const nullCandidate = { ...output, [key]: null };
      const nestedBudget = Math.max(0, maxBytes - jsonByteLength(nullCandidate) + 4);
      const fitted = fitJsonValue(nested, nestedBudget, depth + 1);
      const fittedCandidate = { ...output, [key]: fitted };
      if (jsonByteLength(fittedCandidate) <= maxBytes) output[key] = fitted;
      break;
    }
    return output;
  }

  return null;
}

function extractSourceValue(result: CallToolResult): unknown {
  if (result.structuredContent) return result.structuredContent;
  const values = result.content
    .filter(
      (item): item is Extract<(typeof result.content)[number], { type: 'text' }> =>
        item.type === 'text',
    )
    .map((item) => {
      try {
        return JSON.parse(item.text) as unknown;
      } catch {
        return item.text;
      }
    });
  if (values.length === 1) return values[0];
  return values.length > 1 ? values : undefined;
}

function compactResult(
  result: CallToolResult,
  tool: string,
  limitBytes: number,
  originalBytes: number,
  hasOutputSchema: boolean,
): CallToolResult {
  const metadata: ResponseLimitMetadata = {
    truncated: true,
    reason: 'response_byte_limit',
    tool,
    limitBytes,
    originalBytes,
  };

  if (hasOutputSchema) {
    return {
      content: [
        {
          type: 'text',
          text: stringifyJsonSafe({
            error: '工具响应超过服务端字节上限，无法在保持 outputSchema 的同时返回部分结果',
            [RESPONSE_METADATA_KEY]: metadata,
          }),
        },
      ],
      isError: true,
    };
  }

  const source = extractSourceValue(result);
  let low = 0;
  let high = limitBytes;
  let best: CallToolResult = {
    content: [
      {
        type: 'text',
        text: stringifyJsonSafe({ [RESPONSE_METADATA_KEY]: metadata }),
      },
    ],
    ...(result.isError === true ? { isError: true } : {}),
  };

  while (low <= high) {
    const budget = Math.floor((low + high) / 2);
    const fitted = source === undefined ? undefined : fitJsonValue(source, budget);
    const payload = {
      [RESPONSE_METADATA_KEY]: metadata,
      ...(fitted === undefined ? {} : { data: fitted }),
    };
    const candidate: CallToolResult = {
      content: [{ type: 'text', text: stringifyJsonSafe(payload) }],
      ...(result.isError === true ? { isError: true } : {}),
    };
    if (jsonByteLength(candidate) <= limitBytes) {
      best = candidate;
      low = budget + 1;
    } else {
      high = budget - 1;
    }
  }

  return best;
}

export function enforceToolResponseBudget(
  result: CallToolResult,
  tool: string,
  limitBytes: number,
  hasOutputSchema = false,
): CallToolResult {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) return result;
  const originalBytes = jsonByteLength(result);
  if (originalBytes <= limitBytes) return result;

  const compacted = compactResult(result, tool, limitBytes, originalBytes, hasOutputSchema);
  logger.warn('tool response exceeded byte limit', {
    tool,
    limit_bytes: limitBytes,
    original_bytes: originalBytes,
    returned_bytes: jsonByteLength(compacted),
  });
  return compacted;
}

export function installResponseBudget(server: McpServer): void {
  const registerTool = server.registerTool.bind(server);
  server.registerTool = ((
    name: string,
    config: Parameters<McpServer['registerTool']>[1],
    callback: ToolCallback,
  ) => {
    const handler = callback as unknown;
    const hasOutputSchema = (config as { outputSchema?: unknown }).outputSchema !== undefined;
    if (typeof handler !== 'function') {
      const taskHandler = handler as {
        createTask: (...args: unknown[]) => unknown;
        getTask: (...args: unknown[]) => unknown;
        getTaskResult: (...args: unknown[]) => CallToolResult | Promise<CallToolResult>;
      };
      const wrappedTaskHandler = {
        ...taskHandler,
        async getTaskResult(...args: unknown[]) {
          const result = await taskHandler.getTaskResult(...args);
          return enforceToolResponseBudget(
            result,
            name,
            globalLimits().maxResponseBytes,
            hasOutputSchema,
          );
        },
      };
      return registerTool(name, config, wrappedTaskHandler as unknown as ToolCallback);
    }

    const rawCallback = handler as (...args: unknown[]) => CallToolResult | Promise<CallToolResult>;
    const wrapped = (async (...args: unknown[]) => {
      const result = await rawCallback(...args);
      return enforceToolResponseBudget(
        result,
        name,
        globalLimits().maxResponseBytes,
        hasOutputSchema,
      );
    }) as ToolCallback;
    return registerTool(name, config, wrapped);
  }) as McpServer['registerTool'];
}
