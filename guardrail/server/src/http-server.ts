import { createServer, Server } from 'node:http';
import { ApprovalApiRouter, ApprovalApiRouterConfig, DEFAULT_ALLOWED_ORIGINS, InMemoryRateLimiter, InvitationDeliveryHandler, TokenVerifier } from '../../extension/src/approval/api.js';
import { ActionOwnershipRegistry, TrustedContactRegistry } from '../../extension/src/approval/authorization.js';
import { createPersistentApprovalService } from './persistent-approval-service.js';
import { loadGuardrailServerConfig } from './runtime-config.js';
import { defaultApprovalEventHub } from './event-hub.js';
import type { SqliteIdentityStore } from './identity-store.js';
import type { OidcTokenVerifierConfig } from './oidc-token-verifier.js';

export interface GuardrailHttpServerOptions {
  /** Must be supplied by the host application's real identity provider. */
  readonly tokenVerifier: TokenVerifier;
  readonly databasePath?: string;
  readonly host?: string;
  readonly port?: number;
  readonly routerConfig?: ApprovalApiRouterConfig;
  readonly contactRegistry?: TrustedContactRegistry;
  readonly actionOwnershipRegistry?: ActionOwnershipRegistry;
  readonly invitationDelivery?: InvitationDeliveryHandler;
  readonly identities?: SqliteIdentityStore;
  readonly oidcConfig?: OidcTokenVerifierConfig;
}

/**
 * Starts the existing ApprovalApiRouter over Node HTTP with SQLite-backed request,
 * binding, invitation, and trusted-contact records. Authentication remains injected.
 */
export async function startGuardrailHttpServer(options: GuardrailHttpServerOptions): Promise<{
  readonly server: Server;
  readonly router: ApprovalApiRouter;
  readonly service: ReturnType<typeof createPersistentApprovalService>['service'];
  readonly address: { readonly host: string; readonly port: number };
  close(): Promise<void>;
}> {
  if (!options?.tokenVerifier || typeof options.tokenVerifier.verifyToken !== 'function') {
    throw new Error('A host-provided authentication TokenVerifier is required.');
  }
  const config = loadGuardrailServerConfig(process.env, {
    ...(options.databasePath !== undefined ? { databasePath: options.databasePath } : {}),
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.routerConfig?.allowedOrigins !== undefined ? { allowedOrigins: options.routerConfig.allowedOrigins } : {}),
  });
  const runtime = createPersistentApprovalService({
    databasePath: config.databasePath,
    contactRegistry: options.contactRegistry,
    actionOwnershipRegistry: options.actionOwnershipRegistry,
  });
  const rateLimiter = options.routerConfig?.rateLimiter ?? new InMemoryRateLimiter(120, 60);
  const router = new ApprovalApiRouter(runtime.service, options.tokenVerifier, {
    ...options.routerConfig,
    rateLimiter,
    ...(options.invitationDelivery ? { invitationDelivery: options.invitationDelivery } : {}),
    policyService: runtime.policyService,
    allowedOrigins: config.allowedOrigins.length > 0 ? config.allowedOrigins : (options.routerConfig?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS),
    serviceType: 'live',
  });
  const server = createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    // 1. CORS Preflight for Auth & Standard Endpoints
    if (request.method === 'OPTIONS' && (requestPath.startsWith('/api/v1/auth/') || requestPath === '/api/v1/auth/me' || requestPath === '/api/v1/auth/config')) {
      const originHeader = request.headers.origin;
      const allowedOrigins = config.allowedOrigins.length > 0 ? config.allowedOrigins : (options.routerConfig?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
      if (originHeader && (allowedOrigins.includes(originHeader) || allowedOrigins.includes('*'))) {
        response.setHeader('access-control-allow-origin', originHeader);
        response.setHeader('vary', 'Origin');
      }
      response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      response.setHeader('access-control-allow-headers', 'authorization, content-type');
      response.setHeader('access-control-max-age', '86400');
      response.statusCode = 204;
      response.end();
      return;
    }

    // 2. Health & Readiness Probes
    if (request.method === 'GET' && (requestPath === '/health' || requestPath === '/ready')) {
      const originHeader = request.headers.origin;
      const allowedOrigins = config.allowedOrigins.length > 0 ? config.allowedOrigins : (options.routerConfig?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
      if (originHeader && allowedOrigins.includes(originHeader)) {
        response.setHeader('access-control-allow-origin', originHeader);
        response.setHeader('vary', 'Origin');
      }
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      if (requestPath === '/health') {
        response.statusCode = 200;
        response.end(JSON.stringify({ status: 'ok' }));
      } else {
        let databaseReady = false;
        try { databaseReady = runtime.healthCheck(); } catch { /* report sanitized readiness */ }
        response.statusCode = databaseReady ? 200 : 503;
        response.end(JSON.stringify({ status: databaseReady ? 'ready' : 'not_ready' }));
      }
      return;
    }

    // 3. Public Auth Configuration Discovery (OIDC Provider URLs & Client IDs)
    if (request.method === 'GET' && requestPath === '/api/v1/auth/config') {
      const originHeader = request.headers.origin;
      const allowedOrigins = config.allowedOrigins.length > 0 ? config.allowedOrigins : (options.routerConfig?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
      if (originHeader && (allowedOrigins.includes(originHeader) || allowedOrigins.includes('*'))) {
        response.setHeader('access-control-allow-origin', originHeader);
        response.setHeader('vary', 'Origin');
      }
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      response.statusCode = 200;
      response.end(
        JSON.stringify({
          success: true,
          data: {
            environment: config.environment,
            oidcConfigured: Boolean(options.oidcConfig),
            issuer: options.oidcConfig?.issuer ?? process.env.GUARDRAIL_OIDC_ISSUER ?? null,
            audience: options.oidcConfig?.audience ?? process.env.GUARDRAIL_OIDC_AUDIENCE ?? null,
            clientId: process.env.GUARDRAIL_OIDC_CLIENT_ID ?? options.oidcConfig?.audience ?? null,
            authUrl: process.env.GUARDRAIL_OIDC_AUTH_URL ?? null,
            tokenUrl: process.env.GUARDRAIL_OIDC_TOKEN_URL ?? null,
            devTokensAvailable: config.environment !== 'production' && config.environment !== 'pilot',
          },
        })
      );
      return;
    }

    // 4. Authenticated Actor Identity Verification (/api/v1/auth/me)
    if (request.method === 'GET' && requestPath === '/api/v1/auth/me') {
      const originHeader = request.headers.origin;
      const allowedOrigins = config.allowedOrigins.length > 0 ? config.allowedOrigins : (options.routerConfig?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
      if (originHeader && (allowedOrigins.includes(originHeader) || allowedOrigins.includes('*'))) {
        response.setHeader('access-control-allow-origin', originHeader);
        response.setHeader('vary', 'Origin');
      }
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      const authHeader = request.headers.authorization;
      const token =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : '';

      if (!token) {
        response.statusCode = 401;
        response.end(
          JSON.stringify({
            success: false,
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Valid Bearer authentication token required.',
              statusCode: 401,
            },
          })
        );
        return;
      }

      options.tokenVerifier
        .verifyToken(token)
        .then((authContext) => {
          if (!authContext || !authContext.isAuthenticated) {
            response.statusCode = 401;
            response.end(
              JSON.stringify({
                success: false,
                error: {
                  code: 'UNAUTHENTICATED',
                  message: 'Invalid, expired, or untrusted authentication token.',
                  statusCode: 401,
                },
              })
            );
            return;
          }

          let verifiedEmail: string | undefined;
          try {
            if (options.identities) {
              verifiedEmail = options.identities.getVerifiedEmail(authContext.actorId);
            }
          } catch {}

          response.statusCode = 200;
          response.end(
            JSON.stringify({
              success: true,
              data: {
                actorId: authContext.actorId,
                role: authContext.role,
                isAuthenticated: true,
                email: verifiedEmail ?? null,
                environment: config.environment,
              },
            })
          );
        })
        .catch(() => {
          response.statusCode = 401;
          response.end(
            JSON.stringify({
              success: false,
              error: {
                code: 'UNAUTHENTICATED',
                message: 'Authentication token verification failed.',
                statusCode: 401,
              },
            })
          );
        });
      return;
    }
    // 2. Real-Time Server-Sent Events (SSE) Stream Endpoints
    const eventsMatch = requestPath.match(/^\/api\/v1\/approval-requests\/([^/]+)\/events$/);
    const dashboardStreamMatch = requestPath === '/api/v1/approvals/stream';
    if (request.method === 'GET' && (eventsMatch || dashboardStreamMatch)) {
      const originHeader = request.headers.origin;
      const allowedOrigins = config.allowedOrigins.length > 0 ? config.allowedOrigins : (options.routerConfig?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
      if (originHeader && allowedOrigins.includes(originHeader)) {
        response.setHeader('access-control-allow-origin', originHeader);
        response.setHeader('vary', 'Origin');
      }
      response.setHeader('content-type', 'text/event-stream; charset=utf-8');
      response.setHeader('cache-control', 'no-cache, no-transform');
      response.setHeader('connection', 'keep-alive');
      response.setHeader('x-accel-buffering', 'no');
      response.statusCode = 200;

      // Send initial connection handshake comment
      response.write(`: connected to guardrail real-time event stream\n\n`);

      // Heartbeat every 15s to keep connections alive through proxies and firewalls
      const keepaliveTimer = setInterval(() => {
        if (!response.writableEnded) {
          response.write(`:keepalive\n\n`);
        }
      }, 15000);

      let unsubscribe: (() => void) | null = null;

      if (eventsMatch) {
        const requestId = decodeURIComponent(eventsMatch[1]);
        // Send immediate current snapshot if request exists
        try {
          const reqRecord = runtime.repository.findById(requestId);
          if (reqRecord) {
            response.write(`event: status\ndata: ${JSON.stringify({
              type: 'current',
              requestId: reqRecord.id,
              status: reqRecord.status,
              decidedBy: reqRecord.decision?.decidedBy,
              decidedAt: reqRecord.decision?.decidedAt,
              decisionReason: reqRecord.decision?.reason,
              request: reqRecord,
            })}\n\n`);
          }
        } catch {}

        unsubscribe = defaultApprovalEventHub.subscribeRequest(requestId, (event) => {
          if (!response.writableEnded) {
            response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          }
        });
      } else if (dashboardStreamMatch) {
        unsubscribe = defaultApprovalEventHub.subscribeAll((event) => {
          if (!response.writableEnded) {
            response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          }
        });
      }

      const cleanup = () => {
        clearInterval(keepaliveTimer);
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };

      request.on('close', cleanup);
      request.on('end', cleanup);
      response.on('close', cleanup);
      response.on('finish', cleanup);
      return;
    }

    void router.handleHttpStream(request, response).catch(() => {
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ success: false, error: {
          code: 'INTERNAL_SERVER_ERROR', message: 'The request could not be completed.', statusCode: 500,
        } }));
      }
    });
  });
  const host = config.host;
  const port = config.port;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
  } catch (error) {
    runtime.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    runtime.close();
    throw new Error('HTTP server did not provide a TCP address.');
  }
  let closed = false;
  return Object.freeze({
    server, router, service: runtime.service,
    address: Object.freeze({ host, port: address.port }),
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      runtime.close();
    },
  });
}
