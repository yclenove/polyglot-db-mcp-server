import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export interface AuthContext {
  subject: string;
  tenant?: string;
  tokenRoles: string[];
  scopes: string[];
  claims: Record<string, unknown>;
  transport: 'stdio' | 'http';
  authMode: 'none' | 'api_key' | 'bearer';
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

function stringClaim(
  claims: Record<string, unknown>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = claims[name];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

export function authContextFromInfo(authInfo: AuthInfo | undefined): AuthContext {
  const extra = (authInfo?.extra ?? {}) as Record<string, unknown>;
  const claims = ((extra.claims as Record<string, unknown> | undefined) ?? {}) as Record<
    string,
    unknown
  >;

  const subject =
    stringClaim(extra, ['subject']) ??
    stringClaim(claims, ['sub', 'client_id', 'azp']) ??
    authInfo?.clientId ??
    'local:stdio';

  return {
    subject,
    tenant: stringClaim(extra, ['tenant']) ?? stringClaim(claims, ['tenant', 'tid', 'org_id']),
    tokenRoles: [
      ...stringArray(extra.roles),
      ...stringArray(claims.roles),
      ...stringArray(claims.role),
      ...stringArray(claims.groups),
    ],
    scopes: authInfo?.scopes ?? stringArray(claims.scope),
    claims,
    transport: extra.transport === 'http' ? 'http' : 'stdio',
    authMode:
      extra.authMode === 'bearer' || extra.authMode === 'api_key' || extra.authMode === 'none'
        ? extra.authMode
        : 'none',
  };
}

export function localStdioAuthInfo(): AuthInfo {
  return {
    token: '',
    clientId: 'local:stdio',
    scopes: ['local'],
    extra: {
      subject: 'local:stdio',
      transport: 'stdio',
      authMode: 'none',
      claims: {},
    },
  };
}
