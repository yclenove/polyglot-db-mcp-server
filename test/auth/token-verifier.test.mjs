import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const issuer = 'https://idp.example.com/';
const audience = 'polyglot-db-mcp-server';

async function keyFixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  return { privateKey, jwks: { keys: [jwk] } };
}

async function sign(privateKey, claims = {}, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scope: 'read write',
    roles: ['readonly_analyst'],
    tenant: 'acme',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setSubject(options.subject ?? 'agent:report')
    .setIssuedAt(now)
    .setExpirationTime(options.exp ?? now + 300)
    .sign(privateKey);
}

describe('JWT bearer verifier', () => {
  test('valid token returns sanitized AuthInfo', async () => {
    const { createJwtVerifier } = await import('../../dist/auth/token-verifier.js');
    const { privateKey, jwks } = await keyFixture();
    const token = await sign(privateKey);
    const verifier = createJwtVerifier({ issuer, audience, jwks });

    const auth = await verifier.verify(token);

    assert.equal(auth.clientId, 'agent:report');
    assert.deepEqual(auth.scopes, ['read', 'write']);
    assert.equal(auth.extra.subject, 'agent:report');
    assert.equal(auth.extra.tenant, 'acme');
    assert.deepEqual(auth.extra.roles, ['readonly_analyst']);
    assert.equal(auth.extra.transport, 'http');
  });

  test('wrong issuer is rejected', async () => {
    const { createJwtVerifier } = await import('../../dist/auth/token-verifier.js');
    const { privateKey, jwks } = await keyFixture();
    const token = await sign(privateKey, {}, { issuer: 'https://evil.example.com/' });
    const verifier = createJwtVerifier({ issuer, audience, jwks });

    await assert.rejects(() => verifier.verify(token), /\[AUTH_006\]/);
  });

  test('wrong audience is rejected', async () => {
    const { createJwtVerifier } = await import('../../dist/auth/token-verifier.js');
    const { privateKey, jwks } = await keyFixture();
    const token = await sign(privateKey, {}, { audience: 'other-service' });
    const verifier = createJwtVerifier({ issuer, audience, jwks });

    await assert.rejects(() => verifier.verify(token), /\[AUTH_006\]/);
  });

  test('expired token uses AUTH_004', async () => {
    const { createJwtVerifier } = await import('../../dist/auth/token-verifier.js');
    const { privateKey, jwks } = await keyFixture();
    const token = await sign(privateKey, {}, { exp: Math.floor(Date.now() / 1000) - 10 });
    const verifier = createJwtVerifier({ issuer, audience, jwks });

    await assert.rejects(() => verifier.verify(token), /\[AUTH_004\]/);
  });
});
