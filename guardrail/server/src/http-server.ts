import { createServer, Server } from 'node:http';
import { ApprovalApiRouter, ApprovalApiRouterConfig, DEFAULT_ALLOWED_ORIGINS, InvitationDeliveryHandler, TokenVerifier } from '../../extension/src/approval/api.js';
import { ActionOwnershipRegistry, TrustedContactRegistry } from '../../extension/src/approval/authorization.js';
import { createPersistentApprovalService } from './persistent-approval-service.js';
import { loadGuardrailServerConfig } from './runtime-config.js';

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
  const router = new ApprovalApiRouter(runtime.service, options.tokenVerifier, {
    ...options.routerConfig,
    ...(options.invitationDelivery ? { invitationDelivery: options.invitationDelivery } : {}),
    allowedOrigins: config.allowedOrigins.length > 0 ? config.allowedOrigins : (options.routerConfig?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS),
    serviceType: 'live',
  });
  const server = createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
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
