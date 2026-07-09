import { readFileSync } from 'node:fs';
import { withErrorCode } from '../core/error-codes.js';

export type AuthAction = 'read' | 'write' | 'admin' | 'diagnose' | 'export' | 'replay';
export type PolicyEffect = 'allow' | 'deny';

export interface PolicyConditions {
  maxRows?: number;
  maskingMode?: 'off' | 'loose' | 'strict' | 'strict-v2';
  transport?: Array<'stdio' | 'http'>;
  timeWindow?: {
    start: string;
    end: string;
  };
}

export interface PolicyRule {
  resources: string[];
  actions: Array<AuthAction | '*'>;
  effect?: PolicyEffect;
  conditions?: PolicyConditions;
}

export interface PolicyBinding {
  subject: string;
  roles: string[];
  tenant?: string;
}

export interface RbacPolicy {
  version: string;
  roles: Record<string, PolicyRule[]>;
  bindings: PolicyBinding[];
}

export interface AuthorizationRequest {
  subject: string;
  tenant?: string;
  action: AuthAction;
  resources: string[];
  input: Record<string, unknown>;
  transport: 'stdio' | 'http';
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
  roles: string[];
  matchedRole?: string;
  matchedResource?: string;
  policyVersion?: string;
  conditions?: PolicyConditions;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(withErrorCode('POLICY_001', `${label} 必须是对象`));
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(withErrorCode('POLICY_001', `${label} 必须是字符串数组`));
  }
  return value as string[];
}

function parseConditions(value: unknown): PolicyConditions | undefined {
  if (value === undefined) return undefined;
  const raw = asObject(value, 'conditions');
  const conditions: PolicyConditions = {};

  if (raw.maxRows !== undefined) {
    if (!Number.isInteger(raw.maxRows) || Number(raw.maxRows) < 1) {
      throw new Error(withErrorCode('POLICY_001', 'conditions.maxRows 必须是正整数'));
    }
    conditions.maxRows = Number(raw.maxRows);
  }

  if (raw.maskingMode !== undefined) {
    if (!['off', 'loose', 'strict', 'strict-v2'].includes(String(raw.maskingMode))) {
      throw new Error(withErrorCode('POLICY_001', 'conditions.maskingMode 无效'));
    }
    conditions.maskingMode = raw.maskingMode as PolicyConditions['maskingMode'];
  }

  if (raw.transport !== undefined) {
    const transport = asStringArray(raw.transport, 'conditions.transport');
    if (transport.some((item) => item !== 'stdio' && item !== 'http')) {
      throw new Error(withErrorCode('POLICY_001', 'conditions.transport 只能包含 stdio/http'));
    }
    conditions.transport = transport as Array<'stdio' | 'http'>;
  }

  if (raw.timeWindow !== undefined) {
    const window = asObject(raw.timeWindow, 'conditions.timeWindow');
    if (typeof window.start !== 'string' || typeof window.end !== 'string') {
      throw new Error(withErrorCode('POLICY_001', 'timeWindow.start/end 必须是 HH:mm 字符串'));
    }
    conditions.timeWindow = { start: window.start, end: window.end };
  }

  return conditions;
}

export function parseRbacPolicy(value: unknown): RbacPolicy {
  const root = asObject(value, 'policy');
  if (typeof root.version !== 'string' || root.version.trim() === '') {
    throw new Error(withErrorCode('POLICY_001', 'policy.version 必须是非空字符串'));
  }

  const rolesRaw = asObject(root.roles, 'policy.roles');
  const roles: Record<string, PolicyRule[]> = {};
  for (const [roleName, rulesRaw] of Object.entries(rolesRaw)) {
    if (!Array.isArray(rulesRaw)) {
      throw new Error(withErrorCode('POLICY_001', `roles.${roleName} 必须是规则数组`));
    }
    roles[roleName] = rulesRaw.map((ruleRaw, idx) => {
      const rule = asObject(ruleRaw, `roles.${roleName}[${idx}]`);
      const actions = asStringArray(rule.actions, `roles.${roleName}[${idx}].actions`);
      for (const action of actions) {
        if (!['read', 'write', 'admin', 'diagnose', 'export', 'replay', '*'].includes(action)) {
          throw new Error(withErrorCode('POLICY_001', `未知 action: ${action}`));
        }
      }
      const effect = rule.effect === undefined ? 'allow' : String(rule.effect);
      if (effect !== 'allow' && effect !== 'deny') {
        throw new Error(withErrorCode('POLICY_001', 'rule.effect 只能是 allow/deny'));
      }
      return {
        resources: asStringArray(rule.resources, `roles.${roleName}[${idx}].resources`),
        actions: actions as Array<AuthAction | '*'>,
        effect,
        conditions: parseConditions(rule.conditions),
      };
    });
  }

  if (!Array.isArray(root.bindings)) {
    throw new Error(withErrorCode('POLICY_001', 'policy.bindings 必须是数组'));
  }
  const bindings = root.bindings.map((bindingRaw, idx) => {
    const binding = asObject(bindingRaw, `bindings[${idx}]`);
    if (typeof binding.subject !== 'string' || binding.subject.trim() === '') {
      throw new Error(withErrorCode('POLICY_001', `bindings[${idx}].subject 必须是字符串`));
    }
    const parsed: PolicyBinding = {
      subject: binding.subject,
      roles: asStringArray(binding.roles, `bindings[${idx}].roles`),
    };
    if (binding.tenant !== undefined) {
      if (typeof binding.tenant !== 'string') {
        throw new Error(withErrorCode('POLICY_001', `bindings[${idx}].tenant 必须是字符串`));
      }
      parsed.tenant = binding.tenant;
    }
    return parsed;
  });

  for (const binding of bindings) {
    for (const role of binding.roles) {
      if (!roles[role]) {
        throw new Error(withErrorCode('POLICY_001', `binding 引用了未知 role: ${role}`));
      }
    }
  }

  return { version: root.version, roles, bindings };
}

export function loadRbacPolicyFile(path: string): RbacPolicy {
  try {
    return parseRbacPolicy(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if (error instanceof Error && error.message.includes('[POLICY_001]')) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(withErrorCode('POLICY_001', `无法读取 RBAC policy: ${message}`));
  }
}

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === value) return true;
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return false;
}

function resourceMatch(
  patterns: readonly string[],
  resources: readonly string[],
): string | undefined {
  for (const pattern of patterns) {
    for (const resource of resources) {
      if (wildcardMatch(pattern, resource)) return resource;
    }
  }
  return undefined;
}

function actionMatch(actions: ReadonlyArray<AuthAction | '*'>, action: AuthAction): boolean {
  return actions.includes('*') || actions.includes(action);
}

function parseMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function currentUtcMinute(now = new Date()): number {
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function requestedMaxRows(input: Record<string, unknown>): number | undefined {
  for (const key of ['limit', 'page_size', 'maxRows']) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function conditionsAllow(
  conditions: PolicyConditions | undefined,
  request: AuthorizationRequest,
): string | null {
  if (!conditions) return null;

  if (conditions.transport && !conditions.transport.includes(request.transport)) {
    return `transport ${request.transport} not allowed`;
  }

  if (conditions.maxRows !== undefined) {
    const rows = requestedMaxRows(request.input);
    if (rows !== undefined && rows > conditions.maxRows) {
      return `requested rows ${rows} exceeds maxRows ${conditions.maxRows}`;
    }
  }

  if (conditions.timeWindow) {
    const start = parseMinute(conditions.timeWindow.start);
    const end = parseMinute(conditions.timeWindow.end);
    if (start === null || end === null) return 'invalid time window';
    const now = currentUtcMinute();
    const inside = start <= end ? now >= start && now <= end : now >= start || now <= end;
    if (!inside) return 'outside allowed time window';
  }

  return null;
}

export function rolesForSubject(policy: RbacPolicy, subject: string, tenant?: string): string[] {
  const roles = new Set<string>();
  for (const binding of policy.bindings) {
    if (!wildcardMatch(binding.subject, subject)) continue;
    if (binding.tenant && binding.tenant !== tenant) continue;
    for (const role of binding.roles) roles.add(role);
  }
  return [...roles];
}

export function authorizeWithPolicy(
  policy: RbacPolicy,
  request: AuthorizationRequest,
  defaultEffect: PolicyEffect = 'deny',
): AuthorizationDecision {
  const roles = rolesForSubject(policy, request.subject, request.tenant);
  if (roles.length === 0) {
    return {
      allowed: defaultEffect === 'allow',
      reason: defaultEffect === 'allow' ? 'no role matched; default allow' : 'no role matched',
      roles,
      policyVersion: policy.version,
    };
  }

  for (const role of roles) {
    const rules = policy.roles[role] ?? [];
    for (const rule of rules) {
      if (!actionMatch(rule.actions, request.action)) continue;
      const matchedResource = resourceMatch(rule.resources, request.resources);
      if (!matchedResource) continue;
      const conditionDenyReason = conditionsAllow(rule.conditions, request);
      if (conditionDenyReason) {
        return {
          allowed: false,
          reason: conditionDenyReason,
          roles,
          matchedRole: role,
          matchedResource,
          policyVersion: policy.version,
          conditions: rule.conditions,
        };
      }
      return {
        allowed: rule.effect !== 'deny',
        reason: rule.effect === 'deny' ? 'explicit deny' : 'matched policy rule',
        roles,
        matchedRole: role,
        matchedResource,
        policyVersion: policy.version,
        conditions: rule.conditions,
      };
    }
  }

  return {
    allowed: defaultEffect === 'allow',
    reason: defaultEffect === 'allow' ? 'no rule matched; default allow' : 'no rule matched',
    roles,
    policyVersion: policy.version,
  };
}
