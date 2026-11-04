import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { ActorRole } from '../../extension/src/approval/authorization.js';
import { SqliteIdentityStore } from './identity-store.js';
import { OidcTokenVerifier, loadOidcTokenVerifierConfig } from './oidc-token-verifier.js';

const issuer = 'https://identity.example.test/';
const audience = 'guardrail-api';
const roleClaim = 'https://guardrail.example/role';
const config = loadOidcTokenVerifierConfig({
  GUARDRAIL_OIDC_ISSUER: issuer,
  GUARDRAIL_OIDC_AUDIENCE: audience,
  GUARDRAIL_OIDC_JWKS_URL: 'https://identity.example.test/.well-known/jwks.json',
  GUARDRAIL_OIDC_ROLE_CLAIM: roleClaim,
});

const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey);
jwk.kid = 'test-key';
jwk.alg = 'RS256';
jwk.use = 'sig';
const keySet = createLocalJWKSet({ keys: [jwk] });
const identities = SqliteIdentityStore.open(':memory:');
const verifier = new OidcTokenVerifier(config, identities, keySet);

async function signedToken(overrides: Record<string, unknown> = {}, key = privateKey, subject = 'provider-user-123'): Promise<string> {
  return new SignJWT({ [roleClaim]: ActorRole.USER, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer).setAudience(audience).setSubject(subject)
    .setIssuedAt().setExpirationTime('5m').sign(key);
}

try {
  console.log('OIDC verifier tests (locally generated RSA keys and in-memory SQLite; no live provider)');
  const valid = await verifier.verifyToken(await signedToken());
  assert.equal(valid?.isAuthenticated, true);
  assert.equal(valid?.role, ActorRole.USER);
  assert.match(valid?.actorId ?? '', /^usr_/);
  const verifiedEmailContext = await verifier.verifyToken(await signedToken({ email: 'verified@example.test', email_verified: true }));
  assert.equal(verifiedEmailContext?.actorId, valid?.actorId);
  assert.equal(identities.getVerifiedEmail(valid!.actorId), 'verified@example.test', 'only issuer-signed verified email is retained');
  const unverifiedIdentity = await verifier.verifyToken(await signedToken({ email: 'unverified@example.test', email_verified: false }, privateKey, 'unverified-user'));
  assert.ok(unverifiedIdentity);
  assert.equal(identities.getVerifiedEmail(unverifiedIdentity.actorId), undefined, 'unverified email claims are not retained');
  const signed = await signedToken();
  const segments = signed.split('.');
  segments[2] = `${segments[2]![0] === 'A' ? 'B' : 'A'}${segments[2]!.slice(1)}`;
  assert.equal(await verifier.verifyToken(segments.join('.')), undefined, 'a token with a tampered signature is rejected');
  assert.equal((await verifier.verifyToken(await signedToken({}, (await generateKeyPair('RS256')).privateKey))), undefined,
    'a JWT signed by an unknown key is rejected');
  const expired = await new SignJWT({ [roleClaim]: ActorRole.USER })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer)
    .setAudience(audience).setSubject('provider-user-123').setExpirationTime('-1s').sign(privateKey);
  assert.equal(await verifier.verifyToken(expired), undefined, 'expired tokens are rejected');
  assert.equal(await verifier.verifyToken(await new SignJWT({ [roleClaim]: ActorRole.USER })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer)
    .setAudience('different-api').setSubject('provider-user-123').setExpirationTime('5m').sign(privateKey)), undefined,
  'tokens for another audience are rejected');
  assert.equal(await verifier.verifyToken('not.a.jwt'), undefined, 'malformed tokens are rejected');

  const withJti = await signedToken({ jti: 'revoked-session' });
  identities.revokeToken('revoked-session', new Date(Date.now() + 60_000).toISOString());
  assert.equal(await verifier.verifyToken(withJti), undefined, 'locally revoked JTIs are rejected');
  assert.equal(identities.setIdentityActive(issuer, 'provider-user-123', false), true);
  assert.equal(await verifier.verifyToken(await signedToken()), undefined, 'disabled identities are rejected');

  assert.throws(() => loadOidcTokenVerifierConfig({}), /are required/, 'missing provider configuration fails closed');
  assert.throws(() => loadOidcTokenVerifierConfig({
    GUARDRAIL_OIDC_ISSUER: 'http://identity.example.test/',
    GUARDRAIL_OIDC_AUDIENCE: audience,
    GUARDRAIL_OIDC_JWKS_URL: 'http://identity.example.test/jwks',
    GUARDRAIL_OIDC_ROLE_CLAIM: roleClaim,
  }), /HTTPS/);
  console.log('OIDC verifier checks passed.');
} finally {
  identities.close();
}
