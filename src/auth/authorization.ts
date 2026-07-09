import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerNotification,
  ServerRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { ConnectionRegistry } from '../core/registry.js';
import { auditLog } from '../core/audit.js';
import { createErrorPayload } from '../core/error-codes.js';
import { getToolActionInfo } from '../core/tool-action-map.js';
import { authContextFromInfo, localStdioAuthInfo } from './auth-context.js';
import {
  authorizeWithPolicy,
  loadRbacPolicyFile,
  type AuthorizationDecision,
  type AuthAction,
  type PolicyEffect,
  type RbacPolicy,
} from './rbac.js';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type RawToolCallback = (first: unknown, second?: Extra) => CallToolResult | Promise<CallToolResult>;

export interface AuthorizationOptions {
  mode: 'none' | 'api_key' | 'bearer';
  policyFile?: string;
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

export function createAuthorizationRuntime(
  registry: ConnectionRegistry,
  options: AuthorizationOptions,
): AuthorizationRuntime {
  const policy = options.policyFile ? loadRbacPolicyFile(options.policyFile) : undefined;

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
          },
          options.defaultEffect,
        );
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
      const hasArgs = maybeExtra !== undefined;
      const input = hasArgs ? inputRecord(argsOrExtra) : {};
      const extra = hasArgs ? maybeExtra : (argsOrExtra as Extra | undefined);
      const decision = authorization.authorize(name, input, extra);
      if (!decision.allowed) return denialResult(decision, decision.action);
      return hasArgs ? rawCallback(argsOrExtra, maybeExtra) : rawCallback(argsOrExtra as Extra);
    };
    return registerTool(name, config, wrapped);
  }) as McpServer['registerTool'];
}
