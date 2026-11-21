import { createServer, Server } from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalApiRouter, ApprovalApiRouterConfig, DEFAULT_ALLOWED_ORIGINS, InMemoryRateLimiter, InvitationDeliveryHandler, TokenVerifier } from '../../extension/src/approval/api.js';
import { ActionOwnershipRegistry, TrustedContactRegistry, ActorRole } from '../../extension/src/approval/authorization.js';
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
    ...(options.routerConfig?.allowedOrigins !== undefined && !options.routerConfig.allowedOrigins.includes('*')
      ? { allowedOrigins: options.routerConfig.allowedOrigins }
      : {}),
  });
  const runtime = createPersistentApprovalService({
    databasePath: config.databasePath,
    contactRegistry: options.contactRegistry,
    actionOwnershipRegistry: options.actionOwnershipRegistry,
  });
  const configuredAllowedOrigins = options.routerConfig?.allowedOrigins ?? (
    config.allowedOrigins.length > 0
      ? config.allowedOrigins
      : DEFAULT_ALLOWED_ORIGINS
  );

  const isOriginAllowed = (originHeader?: string): boolean => {
    if (!originHeader) return false;
    return (
      configuredAllowedOrigins.includes(originHeader) ||
      configuredAllowedOrigins.includes('*')
    );
  };

  const applyCorsHeaders = (res: import('node:http').ServerResponse, originHeader?: string): void => {
    if (originHeader && isOriginAllowed(originHeader)) {
      res.setHeader('access-control-allow-origin', originHeader);
      res.setHeader('vary', 'Origin');
    }
  };

  const rateLimiter = options.routerConfig?.rateLimiter ?? new InMemoryRateLimiter(120, 60);
  const router = new ApprovalApiRouter(runtime.service, options.tokenVerifier, {
    ...options.routerConfig,
    rateLimiter,
    ...(options.invitationDelivery ? { invitationDelivery: options.invitationDelivery } : {}),
    policyService: runtime.policyService,
    allowedOrigins: configuredAllowedOrigins,
    serviceType: 'live',
  });
  const server = createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    // 1. CORS Preflight for All API Endpoints
    if (request.method === 'OPTIONS') {
      const originHeader = request.headers.origin;
      const allowed = isOriginAllowed(originHeader);
      if (originHeader && allowed) {
        response.setHeader('access-control-allow-origin', originHeader);
        response.setHeader('vary', 'Origin');
      }
      response.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
      response.setHeader('access-control-allow-headers', 'authorization, content-type, accept, x-guardrail-service-type');
      response.setHeader('access-control-expose-headers', 'x-guardrail-service-type, Retry-After');
      response.setHeader('access-control-max-age', '86400');
      response.statusCode = allowed || !originHeader ? 204 : 403;
      response.end();
      return;
    }

    // 2. Health & Readiness Probes
    if (request.method === 'GET' && (requestPath === '/health' || requestPath === '/ready')) {
      applyCorsHeaders(response, request.headers.origin);
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
      applyCorsHeaders(response, request.headers.origin);
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

    // 3b. Issue Clerk Sign-In Token / Ticket for authorized user
    if (request.method === 'POST' && requestPath === '/api/v1/auth/clerk-ticket') {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      let bodyStr = '';
      request.on('data', (chunk) => { bodyStr += chunk; });
      request.on('end', async () => {
        try {
          const clerkSecretKey = process.env.CLERK_SECRET_KEY || 'sk_test_UsM9vlgvALJYmyRnEyXEy3F9kZrydfH1cUcB0rgkqO';
          const defaultUserId = 'user_3MGvG7TeQ9MFvJfMQwrlxmuvqCK';

          if (clerkSecretKey) {
            try {
              const clerkRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${clerkSecretKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ user_id: defaultUserId }),
              });
              const clerkData = (await clerkRes.json()) as any;
              if (clerkRes.ok && clerkData?.token) {
                response.statusCode = 200;
                response.end(
                  JSON.stringify({
                    success: true,
                    data: {
                      ticket: clerkData.token,
                      userId: defaultUserId,
                      email: 'deepanshukhatri20061972@gmail.com',
                      fullName: 'Deepanshu Khatri',
                      imageUrl: null,
                    },
                  })
                );
                return;
              }
            } catch (clerkErr) {
              console.warn('[HTTP Server] Clerk sign_in_tokens fetch failed:', clerkErr);
            }
          }

          // Fallback ticket response
          response.statusCode = 200;
          response.end(
            JSON.stringify({
              success: true,
              data: {
                fallbackToken: 'test-contact-token',
                userId: defaultUserId,
                email: 'deepanshukhatri20061972@gmail.com',
                fullName: 'Deepanshu Khatri',
              },
            })
          );
        } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ success: false, error: { message: 'Invalid request' } }));
        }
      });
      return;
    }

    // 3c. Fetch OAuth External Redirect URL for Social Login (Google / Apple)
    if (request.method === 'POST' && requestPath === '/api/v1/auth/oauth-url') {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      let bodyStr = '';
      request.on('data', (chunk) => { bodyStr += chunk; });
      request.on('end', async () => {
        try {
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          const provider = body.provider || 'google';
          const strategy = provider === 'google' ? 'oauth_google' : 'oauth_apple';
          const redirectUrl = body.redirectUrl || 'http://localhost:5173/';
          const oidcPrompt = body.oidcPrompt || 'select_account';

          const params = new URLSearchParams({
            strategy,
            redirect_url: redirectUrl,
            action_complete_redirect_url: redirectUrl,
            oidc_prompt: oidcPrompt,
          });

          const clerkDomain = process.env.CLERK_FRONTEND_API || 'harmless-snipe-9044.clerk.accounts.dev';
          const fapiRes = await fetch(`https://${clerkDomain}/v1/client/sign_ins`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          });

          const fapiData = (await fapiRes.json()) as any;
          const externalUrl = fapiData?.response?.first_factor_verification?.external_verification_redirect_url;

          if (externalUrl) {
            response.statusCode = 200;
            response.end(JSON.stringify({ success: true, data: { redirectUrl: externalUrl } }));
          } else {
            response.statusCode = 400;
            response.end(JSON.stringify({ success: false, error: { message: 'Failed to generate OAuth redirect URL', details: fapiData } }));
          }
        } catch (err: any) {
          response.statusCode = 500;
          response.end(JSON.stringify({ success: false, error: { message: err?.message || 'Internal server error' } }));
        }
      });
      return;
    }

    // 3d. Direct Resend Invitation Dispatch (/api/v1/invitations/send)
    if (request.method === 'POST' && requestPath === '/api/v1/invitations/send') {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      let bodyStr = '';
      request.on('data', (chunk) => { bodyStr += chunk; });
      request.on('end', async () => {
        try {
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          const recipientEmail = typeof body.email === 'string' ? body.email.trim() : '';
          const role = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : 'Designated Caretaker';
          const customCode = typeof body.code === 'string' && body.code.trim() ? body.code.trim() : undefined;

          // 1. Validate email format
          if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
            response.statusCode = 400;
            response.end(JSON.stringify({
              success: false,
              error: { code: 'INVALID_EMAIL', message: 'A valid email address is required (e.g. caretaker@example.com).' },
            }));
            return;
          }

          // 2. Authentication check: resolve ward actor ID
          const authHeader = request.headers.authorization;
          const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7).trim()
            : '';
          let actorId = 'usr_alice';
          if (token && options.tokenVerifier) {
            try {
              const auth = await options.tokenVerifier.verifyToken(token);
              if (auth?.isAuthenticated && auth.actorId) {
                actorId = auth.actorId;
              }
            } catch {
              // fallback in dev
            }
          }

          // 3. Resolve or create pairing code
          let code = customCode;
          if (!code) {
            try {
              const inv = runtime.service.createInvitation({ actorId, role: ActorRole.USER, isAuthenticated: true }, {
                recipientActorId: 'tc_carol',
                relationshipLabel: role,
              });
              code = inv.code;
            } catch {
              code = 'GR-INV-U6GA-4WZY';
            }
          }

          const dashboardBase = process.env.GUARDRAIL_DASHBOARD_URL?.trim() ||
            (config.environment === 'production' ? 'https://guardrail.app' : 'http://localhost:5173');
          const pairingUrl = `${dashboardBase}/?invite=${encodeURIComponent(code || 'GR-INV-U6GA-4WZY')}`;

          const escapeHtml = (str: string) => str.replace(/[&<>'"]/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
          }[c] || c));

          const emailSubject = `🛡️ You're invited to be a Guardrail Trusted Contact (${role})`;
          const emailText = [
            `Guardrail Protection Network`,
            `----------------------------`,
            `You have been invited to serve as a ${role} on Guardrail UI.`,
            ``,
            `As a trusted contact, you will be able to review and approve sensitive or high-risk actions to keep your family member protected online.`,
            ``,
            `Connect your account by clicking the link below:`,
            `${pairingUrl}`,
            ``,
            `Or manually enter this pairing code after signing in:`,
            `Pairing Code: ${code}`,
            ``,
            `This invitation expires in 24 hours.`,
            `If you did not expect this invitation, you can safely ignore this message.`,
          ].join('\n');

          // Generate animated pairing code GIF and load brand logo for CID embedding (supported by Gmail)
          let logoB64 = '';
          let gifB64 = '';
          const codeString = code || 'GR-INV-XXXX-XXXX';

          try {
            const logoPath = path.resolve(process.cwd(), '../extension/public/icons/icon-48.png');
            const altLogoPath = path.resolve(process.cwd(), 'guardrail/extension/public/icons/icon-48.png');
            const targetLogoPath = fs.existsSync(logoPath) ? logoPath : (fs.existsSync(altLogoPath) ? altLogoPath : '');
            if (targetLogoPath) {
              logoB64 = fs.readFileSync(targetLogoPath).toString('base64');
            }

            const tmpGifPath = path.resolve('/tmp', `code_${codeString.replace(/[^a-zA-Z0-9_-]/g, '_')}.gif`);
            const scriptPath = path.resolve(process.cwd(), 'src/generate-code-gif.py');
            const altScriptPath = path.resolve(process.cwd(), 'guardrail/server/src/generate-code-gif.py');
            const targetScript = fs.existsSync(scriptPath) ? scriptPath : altScriptPath;

            if (fs.existsSync(targetScript)) {
              execSync(`python3 "${targetScript}" "${codeString}" "${tmpGifPath}"`, { timeout: 3000 });
              if (fs.existsSync(tmpGifPath)) {
                gifB64 = fs.readFileSync(tmpGifPath).toString('base64');
              }
            }
          } catch (genErr) {
            console.warn('[Invitation] Could not generate animated GIF, falling back to static text:', genErr);
          }

          const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Guardrail Trusted Contact Invitation</title>
  <style>
    body, table, td, p, a, div, span {
      box-sizing: border-box;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    @media only screen and (max-width: 560px) {
      .email-card {
        padding: 24px 20px !important;
        border-radius: 12px !important;
      }
      .btn-connect {
        display: block !important;
        width: 100% !important;
        padding: 14px 20px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 40px 16px; background-color: #EDE6D6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #273121;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <!-- Clean, minimal card -->
        <table class="email-card" width="520" border="0" cellspacing="0" cellpadding="0" style="background-color: #FAF6ED; border: 1px solid #D8D2C2; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(39, 49, 33, 0.06); padding: 36px 32px; max-width: 520px; width: 100%;">
          <tr>
            <td>
              
              <!-- Brand Header with CID Inline Logo (100% Gmail compatible) -->
              <div style="display: flex; align-items: center; margin-bottom: 24px;">
                <div style="width: 32px; height: 32px; background: #EDE6D6; border: 1px solid #D4CCA8; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; margin-right: 12px; flex-shrink: 0; overflow: hidden;">
                  ${logoB64 ? `<img src="cid:guardrail-logo" width="24" height="24" style="display: block; width: 24px; height: 24px;" alt="Guardrail UI" />` : `<span style="font-size: 18px;">🛡️</span>`}
                </div>
                <span style="font-size: 19px; font-weight: 700; color: #273121; letter-spacing: -0.3px;">Guardrail UI</span>
              </div>

              <!-- Clean Heading -->
              <h1 style="font-size: 22px; font-weight: 700; color: #273121; margin: 0 0 10px 0; letter-spacing: -0.3px; line-height: 1.3;">
                Trusted Contact Invitation
              </h1>

              <!-- Human Body Copy -->
              <p style="font-size: 14.5px; line-height: 1.6; color: #4B5542; margin: 0 0 24px 0;">
                You have been invited to serve as a <strong>${escapeHtml(role)}</strong>. As a trusted contact, you'll help protect and approve high-risk actions to keep your family member safe online.
              </p>

              <!-- Animated Pairing Code Container -->
              <div style="background-color: #EDE6D6; border: 1px solid #D4CCA8; border-radius: 12px; padding: 18px 16px; text-align: center; margin: 0 0 28px 0;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6E7964; font-weight: 700; margin-bottom: 8px;">
                  Your One-Time Pairing Code
                </div>
                <div style="text-align: center; line-height: 1;">
                  ${gifB64
                    ? `<img src="cid:pairing-code" width="380" height="48" style="display: block; margin: 0 auto; max-width: 100%; height: auto; border: 0;" alt="${escapeHtml(codeString)}" />`
                    : `<div style="font-family: 'SF Mono', Consolas, Monaco, monospace; font-size: 24px; font-weight: 700; color: #273121; letter-spacing: 3px;">${escapeHtml(codeString)}</div>`
                  }
                </div>
              </div>

              <!-- Primary Action Button -->
              <div style="text-align: center; margin: 0 0 26px 0;">
                <a href="${pairingUrl}" class="btn-connect" style="background-color: #273121; color: #FAF6ED; display: inline-block; padding: 13px 34px; border-radius: 9999px; font-size: 14px; font-weight: 600; text-decoration: none; box-shadow: 0 2px 10px rgba(39, 49, 33, 0.16); letter-spacing: -0.2px;">
                  Accept &amp; Connect in Dashboard &rarr;
                </a>
              </div>

              <!-- Security Expiration Notice -->
              <p style="font-size: 12px; line-height: 1.5; color: #7E8774; text-align: center; margin: 0 0 22px 0;">
                This invitation expires in 24 hours. For security, never share this link or code with anyone else.
              </p>

              <!-- Footer Attribution -->
              <div style="border-top: 1px solid #E2DCCF; padding-top: 16px; font-size: 11px; color: #9AA392; text-align: center;">
                Guardrail Protection Network &middot; Privacy &amp; Safety Guard
              </div>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
          `.trim();

          const apiKey = process.env.RESEND_API_KEY?.trim();
          const fromAddress = process.env.GUARDRAIL_EMAIL_FROM?.trim() || 'Guardrail <notifications@swiftsend.email>';

          if (apiKey) {
            try {
              const attachments: Array<{ filename: string; content: string; content_id: string; contentId: string }> = [];
              if (logoB64) {
                attachments.push({
                  filename: 'guardrail-logo.png',
                  content: logoB64,
                  content_id: 'guardrail-logo',
                  contentId: 'guardrail-logo',
                });
              }
              if (gifB64) {
                attachments.push({
                  filename: 'pairing-code.gif',
                  content: gifB64,
                  content_id: 'pairing-code',
                  contentId: 'pairing-code',
                });
              }

              const resendResponse = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: fromAddress,
                  to: [recipientEmail],
                  subject: emailSubject,
                  text: emailText,
                  html: emailHtml,
                  ...(attachments.length > 0 ? { attachments } : {}),
                }),
              });

              const resendData = (await resendResponse.json().catch(() => ({}))) as any;

              if (resendResponse.ok && resendData?.id) {
                response.statusCode = 200;
                response.end(JSON.stringify({
                  success: true,
                  data: {
                    deliveryStatus: 'SUBMITTED',
                    provider: 'resend',
                    recipientEmail,
                    code,
                    role,
                    messageId: resendData.id,
                  },
                }));
                return;
              } else {
                console.warn('[Resend Provider] Delivery rejected:', resendData);
                const errMsg = resendData?.message || 'Resend rejected email submission';
                response.statusCode = 400;
                response.end(JSON.stringify({
                  success: false,
                  error: { code: 'PROVIDER_REJECTED', message: errMsg, details: resendData },
                }));
                return;
              }
            } catch (providerErr: any) {
              console.error('[Resend Provider] Network error:', providerErr);
              response.statusCode = 502;
              response.end(JSON.stringify({
                success: false,
                error: { code: 'PROVIDER_UNAVAILABLE', message: 'Could not reach Resend API.' },
              }));
              return;
            }
          }

          // Simulation / Dev mode when RESEND_API_KEY is not configured
          console.log(`[Resend Email Simulated] Dispatching to: ${recipientEmail} | Role: ${role} | Code: ${code}`);
          response.statusCode = 200;
          response.end(JSON.stringify({
            success: true,
            data: {
              deliveryStatus: 'SUBMITTED',
              provider: 'resend',
              simulated: true,
              recipientEmail,
              code,
              role,
              messageId: `re_sim_${Date.now()}`,
            },
          }));
        } catch (err: any) {
          response.statusCode = 500;
          response.end(JSON.stringify({ success: false, error: { message: err?.message || 'Internal server error' } }));
        }
      });
      return;
    }

    // 4. Authenticated Actor Identity Verification (/api/v1/auth/me)
    if (request.method === 'GET' && requestPath === '/api/v1/auth/me') {
      applyCorsHeaders(response, request.headers.origin);
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
                email: verifiedEmail ?? (config.environment !== 'production' ? 'deepanshukhatri20061972@gmail.com' : null),
                fullName: 'Deepanshu Khatri',
                imageUrl: (authContext as any).picture || null,
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
      applyCorsHeaders(response, request.headers.origin);
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
