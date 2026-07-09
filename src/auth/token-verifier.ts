import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { maskErrorCredentials, withErrorCode } from '../core/error-codes.js';

export interface BearerAuthConfig {
  issuer: string;
  audience: string;
  jwksUrl?: string;
  jwksFile?: string;
  jwks?: JSONWebKeySet;
}

export interface JwtVerifier {
  verify(token: string): Promise<AuthInfo>;
}

function parseScopes(payload: JWTPayload): string[] {
  const rawScope = payload.scope;
  if (typeof rawScope === 'string') return rawScope.split(/\s+/).filter(Boolean);
  const scp = payload.scp;
  if (Array.isArray(scp)) {
    return scp.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return [];
}

function clientId(payload: JWTPayload): string {
  const client = payload.client_id ?? payload.azp ?? payload.sub;
  return typeof client === 'string' && client.length > 0 ? client : 'unknown';
}

function tenant(payload: JWTPayload): string | undefined {
  for (const key of ['tenant', 'tid', 'org_id']) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function readJwksFile(path: string): JSONWebKeySet {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as JSONWebKeySet;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(withErrorCode('CFG_005', `DB_AUTH_JWKS_FILE 无法读取: ${message}`));
  }
}

function getKeyResolver(config: BearerAuthConfig): JWTVerifyGetKey {
  if (config.jwks) return createLocalJWKSet(config.jwks);
  if (config.jwksFile) return createLocalJWKSet(readJwksFile(config.jwksFile));
  if (config.jwksUrl) return createRemoteJWKSet(new URL(config.jwksUrl));
  throw new Error(
    withErrorCode('CFG_005', 'Bearer auth 需要 DB_AUTH_JWKS_URL 或 DB_AUTH_JWKS_FILE'),
  );
}

export function createJwtVerifier(config: BearerAuthConfig): JwtVerifier {
  const keyResolver = getKeyResolver(config);

  return {
    async verify(token: string): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, keyResolver, {
          issuer: config.issuer,
          audience: config.audience,
        });
        const subject = typeof payload.sub === 'string' ? payload.sub : clientId(payload);
        const roles = payload.roles ?? payload.role ?? payload.groups;
        return {
          token,
          clientId: clientId(payload),
          scopes: parseScopes(payload),
          expiresAt: payload.exp,
          extra: {
            subject,
            tenant: tenant(payload),
            roles,
            claims: payload as Record<string, unknown>,
            transport: 'http',
            authMode: 'bearer',
          },
        };
      } catch (error) {
        if (error instanceof joseErrors.JWTExpired) {
          throw new Error(withErrorCode('AUTH_004'));
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(withErrorCode('AUTH_006', maskErrorCredentials(message)));
      }
    },
  };
}
