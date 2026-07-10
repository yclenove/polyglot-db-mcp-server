import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerNotification,
  ServerRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { ConnectionRegistry } from '../core/registry.js';
import { auditLog } from '../core/audit.js';
import { createErrorPayload } from '../core/error-codes.js';
import { recordToolCall } from '../core/observability.js';
import { evaluateRuntimePolicyPlugins } from '../core/plugins.js';
import { getToolActionInfo } from '../core/tool-action-map.js';
import { authContextFromInfo, localStdioAuthInfo } from './auth-context.js';
import { runWithRequestPolicy } from './request-policy.js';
import {
  authorizeWithPolicy,
  loadRbacPolicyFile,
  loadRbacPolicyTemplate,
  type AuthorizationDecision,
  type AuthAction,
  type PolicyEffect,
  type RbacPolicy,
} from './rbac.js';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type RawToolCallback = (first: unknown, second?: Extra) => CallToolResult | Promise<CallToolResult>;
const toolTracer = trace.getTracer('polyglot-db-mcp-server.tools');

export interface AuthorizationOptions {
  mode: 'none' | 'api_key' | 'bearer';
  policyFile?: string;
  policyTemplate?: string;
  policy?: RbacPolicy;
  defaultEffect: PolicyEffect;
}

export interface AuthorizationRuntime {
  policy?: RbacPolicy;
  authorize(
    toolName: string,
    input: Record<string, unknown>,
    extra?: Extra,
  ): AuthorizationDecision & {
    action: AuthAction;
    connectionId?: string;
    subject: string;
    tenant?: string;
    transport: 'stdio' | 'http';
  };
}

function inputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveConnectionResources(
  registry: ConnectionRegistry,
  toolName: string,
  input: Record<string, unknown>,
): { resources: string[]; connectionId?: string } {
  const info = getToolActionInfo(toolName);
  const resources = [`tool:${toolName}`];

  if (info.allConnections) {
    resources.push('connection:*');
    return { resources };
  }

  for (const field of info.connectionFields ?? []) {
    const value = input[field];
    if (typeof value === 'string' && value.trim() !== '') {
      resources.push(`connection:${registry.resolveConnectionId(value)}`);
      continue;
    }
    if (field === 'connection_id' || field === 'connectionId') {
      const id = registry.resolveConnectionId(undefined);
      resources.push(`connection:${id}`);
      return { resources, connectionId: id };
    }
  }

  const explicit = resources.find((resource) => resource.startsWith('connection:'));
  return {
    resources,
    connectionId: explicit?.slice('connection:'.length),
  };
}

function auditDecision(entry: {
  subject: string;
  tenant?: string;
  transport: 'stdio' | 'http';
  tool: string;
  action: AuthAction;
  connectionId?: string;
  decision: AuthorizationDecision;
}): void {
  auditLog({
    operation: 'authorization',
    subject: entry.subject,
    tenant: entry.tenant,
    transport: entry.transport,
    tool: entry.tool,
    action: entry.action,
    connection_id: entry.connectionId,
    decision: entry.decision.allowed ? 'allow' : 'deny',
    reason: entry.decision.reason,
    roles: entry.decision.roles,
    matched_role: entry.decision.matchedRole,
    matched_resource: entry.decision.matchedResource,
    policy_version: entry.decision.policyVersion,
    approval_required: entry.decision.conditions?.approvalRequired === true,
    approval_claim: entry.decision.conditions?.approvalRequired
      ? (entry.decision.conditions.approvalClaim ?? 'db_mcp_approval')
      : undefined,
    success: entry.decision.allowed,
  });
}

function denialResult(decision: AuthorizationDecision, action: AuthAction): CallToolResult {
  const errorInfo = createErrorPayload('AUTH_005', {
    action,
    reason: decision.reason,
    roles: decision.roles,
    matched_role: decision.matchedRole,
    matched_resource: decision.matchedResource,
    policy_version: decision.policyVersion,
  });
  return {
    content: [
      { type: 'text', text: JSON.stringify({ error: errorInfo.message, error_info: errorInfo }) },
    ],
    isError: true,
  };
}

function textContent(result: CallToolResult): string | undefined {
  const item = result.content.find((content) => content.type === 'text');
  return item?.type === 'text' ? item.text : undefined;
}

function extractErrorCode(result: CallToolResult): string | undefined {
  if (!result.isError) return undefined;
  const text = textContent(result);
  if (!text) return undefined;
  try {
    const payload = JSON.parse(text) as {
      error_info?: { code?: unknown };
      error?: { data?: { error_info?: { code?: unknown } } };
    };
    const code = payload.error_info?.code ?? payload.error?.data?.error_info?.code;
    return typeof code === 'string' && code.trim() !== '' ? code : undefined;
  } catch {
    return undefined;
  }
}

export function createAuthorizationRuntime(
  registry: ConnectionRegistry,
  options: AuthorizationOptions,
): AuthorizationRuntime {
  const policy = options.policy
    ? options.policy
    : options.policyFile
      ? loadRbacPolicyFile(options.policyFile)
      : options.policyTemplate
        ? loadRbacPolicyTemplate(options.policyTemplate)
        : undefined;

  return {
    policy,
    authorize(toolName, input, extra) {
      const authInfo = extra?.authInfo ?? localStdioAuthInfo();
      const context = authContextFromInfo(authInfo);
      const info = getToolActionInfo(toolName);
      const { resources, connectionId } = resolveConnectionResources(registry, toolName, input);

      let decision: AuthorizationDecision;
      if (!policy) {
        const allowed = options.mode === 'none' || options.mode === 'api_key';
        decision = {
          allowed,
          reason: allowed
            ? 'authorization disabled or api_key fallback'
            : 'rbac policy not configured',
          roles: [],
        };
      } else {
        decision = authorizeWithPolicy(
          policy,
          {
            subject: context.subject,
            tenant: context.tenant,
            action: info.action,
            resources,
            input,
            transport: context.transport,
            claims: context.claims,
          },
          options.defaultEffect,
        );
      }

      if (decision.allowed) {
        const pluginDecision = evaluateRuntimePolicyPlugins({
          subject: context.subject,
          tenant: context.tenant,
          action: info.action,
          resources,
          input,
          transport: context.transport,
        });
        if (!pluginDecision.allowed) {
          decision = {
            ...decision,
            allowed: false,
            reason: pluginDecision.reason ?? 'denied by policy plugin',
          };
        }
      }

      auditDecision({
        subject: context.subject,
        tenant: context.tenant,
        transport: context.transport,
        tool: toolName,
        action: info.action,
        connectionId,
        decision,
      });

      return {
        ...decision,
        action: info.action,
        connectionId,
        subject: context.subject,
        tenant: context.tenant,
        transport: context.transport,
      };
    },
  };
}

export function installAuthorization(server: McpServer, authorization: AuthorizationRuntime): void {
  const registerTool = server.registerTool.bind(server);
  server.registerTool = ((
    name: string,
    config: Parameters<McpServer['registerTool']>[1],
    cb: ToolCallback,
  ) => {
    const rawCallback = cb as unknown as RawToolCallback;
    const wrapped: ToolCallback = async (argsOrExtra: unknown, maybeExtra?: Extra) => {
      return toolTracer.startActiveSpan(`mcp.tool.${name}`, async (span) => {
        const startedAt = Date.now();
        const hasArgs = maybeExtra !== undefined;
        const input = hasArgs ? inputRecord(argsOrExtra) : {};
        const extra = hasArgs ? maybeExtra : (argsOrExtra as Extra | undefined);
        let action = 'unknown';
        let connectionId: string | undefined;
        let transport: 'stdio' | 'http' = 'stdio';

        try {
          const decision = authorization.authorize(name, input, extra);
          action = decision.action;
          connectionId = decision.connectionId;
          transport = decision.transport;

          span.setAttribute('mcp.tool.name', name);
          span.setAttribute('db_mcp.action', action);
          span.setAttribute('db_mcp.transport', transport);
          span.setAttribute('enduser.id', decision.subject);
          if (decision.tenant) span.setAttribute('db_mcp.tenant', decision.tenant);
          if (connectionId) span.setAttribute('db_mcp.connection_id', connectionId);

          if (!decision.allowed) {
            const result = denialResult(decision, decision.action);
            const durationMs = Date.now() - startedAt;
            span.setAttribute('db_mcp.duration_ms', durationMs);
            span.setAttribute('db_mcp.error_code', 'AUTH_005');
            span.setStatus({ code: SpanStatusCode.ERROR, message: decision.reason });
            recordToolCall({
              tool: name,
              action,
              connectionId,
              transport,
              success: false,
              durationMs,
              errorCode: 'AUTH_005',
            });
            return result;
          }

          const result = await runWithRequestPolicy(decision.conditions, () =>
            hasArgs ? rawCallback(argsOrExtra, maybeExtra) : rawCallback(argsOrExtra as Extra),
          );
          const errorCode = extractErrorCode(result);
          const success = result.isError !== true;
          const durationMs = Date.now() - startedAt;
          span.setAttribute('db_mcp.duration_ms', durationMs);
          if (errorCode) span.setAttribute('db_mcp.error_code', errorCode);
          if (!success) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode ?? 'tool error' });
          }
          recordToolCall({
            tool: name,
            action,
            connectionId,
            transport,
            success,
            durationMs,
            errorCode,
          });
          return result;
        } catch (error) {
          const durationMs = Date.now() - startedAt;
          const message = error instanceof Error ? error.message : String(error);
          span.recordException(error instanceof Error ? error : new Error(message));
          span.setAttribute('db_mcp.duration_ms', durationMs);
          span.setAttribute('db_mcp.error_code', 'UNHANDLED');
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          recordToolCall({
            tool: name,
            action,
            connectionId,
            transport,
            success: false,
            durationMs,
            errorCode: 'UNHANDLED',
          });
          throw error;
        } finally {
          span.end();
        }
      });
    };
    return registerTool(name, config, wrapped);
  }) as McpServer['registerTool'];
}
