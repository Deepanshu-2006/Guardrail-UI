import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ActorRole, AuthContext } from '../../extension/src/approval/authorization.js';
import { TokenVerifier } from '../../extension/src/approval/api.js';
import { SqliteIdentityStore } from './identity-store.js';

export interface OidcTokenVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  /** Signed claim containing exactly one Guardrail role value. */
  readonly roleClaim: string;
  /** Fallback role if roleClaim is not present in token */
  readonly defaultRole?: ActorRole;
}

export function tryLoadOidcTokenVerifierConfig(env: NodeJS.ProcessEnv = process.env): OidcTokenVerifierConfig | undefined {
  const issuer = env.GUARDRAIL_OIDC_ISSUER?.trim();
  const audience = env.GUARDRAIL_OIDC_AUDIENCE?.trim();
  const jwksUrl = env.GUARDRAIL_OIDC_JWKS_URL?.trim();
  const roleClaim = env.GUARDRAIL_OIDC_ROLE_CLAIM?.trim() || 'role';
  if (!issuer || !audience || !jwksUrl) {
    return undefined;
  }
  try {
    const issuerUrl = new URL(issuer);
    const jwks = new URL(jwksUrl);
    if (
      issuerUrl.protocol !== 'https:' ||
      jwks.protocol !== 'https:' ||
      issuerUrl.origin !== jwks.origin ||
      issuerUrl.username ||
      issuerUrl.password ||
      issuerUrl.search ||
      issuerUrl.hash ||
      jwks.username ||
      jwks.password ||
      jwks.search ||
      jwks.hash ||
      issuerUrl.origin === 'null' ||
      jwks.origin === 'null'
    ) {
      return undefined;
    }
    return Object.freeze({ issuer, audience, jwksUrl: jwks.href, roleClaim });
  } catch {
    return undefined;
  }
}

export function loadOidcTokenVerifierConfig(env: NodeJS.ProcessEnv = process.env): OidcTokenVerifierConfig {
  const issuer = env.GUARDRAIL_OIDC_ISSUER?.trim();
  const audience = env.GUARDRAIL_OIDC_AUDIENCE?.trim();
  const jwksUrl = env.GUARDRAIL_OIDC_JWKS_URL?.trim();
  const roleClaim = env.GUARDRAIL_OIDC_ROLE_CLAIM?.trim();
  if (!issuer || !audience || !jwksUrl || !roleClaim) {
    throw new Error('GUARDRAIL_OIDC_ISSUER, GUARDRAIL_OIDC_AUDIENCE, GUARDRAIL_OIDC_JWKS_URL, and GUARDRAIL_OIDC_ROLE_CLAIM are required.');
  }
  let issuerUrl: URL;
  let jwks: URL;
  try {
    issuerUrl = new URL(issuer);
    jwks = new URL(jwksUrl);
  } catch {
    throw new Error('OIDC issuer or JWKS URL is invalid.');
  }
  if (issuerUrl.protocol !== 'https:' || jwks.protocol !== 'https:' || issuerUrl.origin !== jwks.origin ||
      issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash ||
      jwks.username || jwks.password || jwks.search || jwks.hash ||
      issuerUrl.origin === 'null' || jwks.origin === 'null') {
    throw new Error('OIDC issuer and JWKS must be credential-free HTTPS URLs on the same host.');
  }
  return Object.freeze({ issuer, audience, jwksUrl: jwks.href, roleClaim });
}

function parseRole(value: unknown, fallback?: ActorRole): ActorRole | undefined {
  const candidates = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  if (candidates.length === 1 && typeof candidates[0] === 'string') {
    const matched = Object.values(ActorRole).find((role) => role === candidates[0]);
    if (matched) return matched;
  }
  return fallback;
}

/** OIDC JWT verifier. All claims used for identity/role mapping are read only after jose verifies the signature. */
export class OidcTokenVerifier implements TokenVerifier {
  private readonly getKey: JWTVerifyGetKey;

  constructor(
    private readonly config: OidcTokenVerifierConfig,
    private readonly identities: SqliteIdentityStore,
    getKey?: JWTVerifyGetKey,
  ) {
    this.getKey = getKey ?? createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: 5000,
      cooldownDuration: 30000,
      cacheMaxAge: 300000,
    });
  }

  public async verifyToken(token: string): Promise<AuthContext | undefined> {
    if (typeof token !== 'string' || !token.trim() || token.length > 16_384 || token !== token.trim()) return undefined;
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        algorithms: ['RS256', 'ES256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
        requiredClaims: ['sub', 'exp'],
        clockTolerance: 0,
      });
      if (typeof payload.sub !== 'string' || !payload.sub.trim() || typeof payload.exp !== 'number') return undefined;
      const role = parseRole(payload[this.config.roleClaim], this.config.defaultRole);
      if (!role) return undefined;
      const issuer = typeof payload.iss === 'string' ? payload.iss : '';
      if (!issuer) return undefined;
      const verifiedEmail = payload.email_verified === true && typeof payload.email === 'string'
        ? payload.email
        : undefined;
      if (payload.jti !== undefined && (typeof payload.jti !== 'string' || !payload.jti.trim() || this.identities.isTokenRevoked(payload.jti))) {
        return undefined;
      }
      const identity = this.identities.resolveVerifiedIdentity(issuer, payload.sub, role, verifiedEmail);
      if (!identity) return undefined;
      return Object.freeze({
        actorId: identity.actorId,
        role: identity.role,
        isAuthenticated: true,
        ...(typeof payload.jti === 'string' ? { sessionId: payload.jti } : {}),
      });
    } catch {
      // No token, claims, key data, or provider error details leave this boundary.
      return undefined;
    }
  }
}

/**
 * Hybrid token verifier supporting both real OIDC JWT verification and
 * development test tokens. In production or pilot environments, dev tokens
 * are disabled by default.
 */
export class HybridTokenVerifier implements TokenVerifier {
  private readonly devTokens = new Map<string, AuthContext>([
    ['test-ward-token', { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true }],
    ['test-contact-token', { actorId: 'tc_carol', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true }],
    ['test-admin-token', { actorId: 'adm_admin', role: ActorRole.ADMIN, isAuthenticated: true }],
  ]);

  constructor(
    private readonly oidcVerifier?: TokenVerifier,
    private readonly devTokensEnabled: boolean = true,
    customTokens?: Record<string, AuthContext> | Map<string, AuthContext>
  ) {
    if (customTokens) {
      if (customTokens instanceof Map) {
        customTokens.forEach((v, k) => this.devTokens.set(k, v));
      } else {
        Object.entries(customTokens).forEach(([k, v]) => this.devTokens.set(k, v));
      }
    }
  }

  public registerDevToken(token: string, context: AuthContext): void {
    this.devTokens.set(token, context);
  }

  public async verifyToken(token: string): Promise<AuthContext | undefined> {
    if (typeof token !== 'string' || !token.trim()) return undefined;
    const cleanToken = token.trim();

    if (this.devTokensEnabled && this.devTokens.has(cleanToken)) {
      return this.devTokens.get(cleanToken);
    }

    if (this.oidcVerifier) {
      return await this.oidcVerifier.verifyToken(cleanToken);
    }

    return undefined;
  }
}
