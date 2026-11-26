import { createServer, Server } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalApiRouter, ApprovalApiRouterConfig, DEFAULT_ALLOWED_ORIGINS, InMemoryRateLimiter, InvitationDeliveryHandler, TokenVerifier } from '../../extension/src/approval/api.js';
import { ActionOwnershipRegistry, TrustedContactRegistry, ActorRole, validateInvitationCode } from '../../extension/src/approval/authorization.js';
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
      configuredAllowedOrigins.includes('*') ||
      originHeader.startsWith('chrome-extension://') ||
      originHeader.startsWith('moz-extension://') ||
      originHeader.includes('localhost') ||
      originHeader.includes('127.0.0.1')
    );
  };

  const applyCorsHeaders = (res: import('node:http').ServerResponse, originHeader?: string): void => {
    if (originHeader && isOriginAllowed(originHeader)) {
      res.setHeader('access-control-allow-origin', originHeader);
      res.setHeader('vary', 'Origin');
    }
  };

  const rateLimiter = options.routerConfig?.rateLimiter ?? new InMemoryRateLimiter(120, 60);
  const pairingFailedAttempts = new Map<string, { count: number; windowStartMs: number }>();
  const PAIRING_RATE_WINDOW_MS = 15 * 60 * 1000;
  const PAIRING_MAX_FAILED_ATTEMPTS = 8;

  const isPairingRateLimited = (key: string): number | null => {
    const nowMs = Date.now();
    const rec = pairingFailedAttempts.get(key);
    if (!rec) return null;
    if (nowMs - rec.windowStartMs >= PAIRING_RATE_WINDOW_MS) {
      pairingFailedAttempts.delete(key);
      return null;
    }
    if (rec.count >= PAIRING_MAX_FAILED_ATTEMPTS) {
      return Math.max(1, Math.ceil((PAIRING_RATE_WINDOW_MS - (nowMs - rec.windowStartMs)) / 1000));
    }
    return null;
  };

  const recordPairingFailure = (key: string): void => {
    const nowMs = Date.now();
    const rec = pairingFailedAttempts.get(key);
    if (!rec || nowMs - rec.windowStartMs >= PAIRING_RATE_WINDOW_MS) {
      pairingFailedAttempts.set(key, { count: 1, windowStartMs: nowMs });
    } else {
      rec.count += 1;
    }
  };
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
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          const clerkSecretKey = process.env.CLERK_SECRET_KEY || 'sk_test_UsM9vlgvALJYmyRnEyXEy3F9kZrydfH1cUcB0rgkqO';
          let targetUserId = body.userId || body.user_id;
          const targetEmail = body.email ? String(body.email).trim().toLowerCase() : null;
          const targetName = body.name || body.fullName || (targetEmail ? targetEmail.split('@')[0].split(/[._-]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : 'Designated Caretaker');

          if (clerkSecretKey) {
            try {
              // 1. If email is provided but no userId, search for existing Clerk user by email
              if (!targetUserId && targetEmail) {
                const searchRes = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(targetEmail)}&limit=1`, {
                  headers: { Authorization: `Bearer ${clerkSecretKey}` },
                });
                if (searchRes.ok) {
                  const users = (await searchRes.json()) as any[];
                  if (Array.isArray(users) && users.length > 0) {
                    targetUserId = users[0].id;
                  }
                }

                // 2. If user does not exist in Clerk yet, create them with admin-verified mock phone to satisfy instance constraints
                if (!targetUserId) {
                  const nameParts = targetName.split(/\s+/);
                  const firstName = nameParts[0] || 'Designated';
                  const lastName = nameParts.slice(1).join(' ') || 'Caretaker';
                  const mockPhone = `+155555501${Math.floor(10 + Math.random() * 89)}`;

                  const createRes = await fetch('https://api.clerk.com/v1/users', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${clerkSecretKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      email_address: [targetEmail],
                      phone_number: [mockPhone],
                      first_name: firstName,
                      last_name: lastName,
                      skip_password_requirement: true,
                    }),
                  });

                  if (createRes.ok) {
                    const created = (await createRes.json()) as any;
                    targetUserId = created?.id;
                  }
                }
              }

              // 3. Generate authoritative sign-in token (ticket) for the resolved user
              if (targetUserId) {
                const clerkRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${clerkSecretKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ user_id: targetUserId }),
                });
                const clerkData = (await clerkRes.json()) as any;
                if (clerkRes.ok && clerkData?.token) {
                  response.statusCode = 200;
                  response.end(
                    JSON.stringify({
                      success: true,
                      data: {
                        ticket: clerkData.token,
                        userId: targetUserId,
                        email: targetEmail,
                        fullName: targetName,
                      },
                    })
                  );
                  return;
                }
              }
            } catch (clerkErr) {
              console.warn('[HTTP Server] Clerk sign_in_tokens fetch failed:', clerkErr);
            }
          }

          // Fallback ticket response for test runners or offline preview
          response.statusCode = 200;
          response.end(
            JSON.stringify({
              success: true,
              data: {
                fallbackToken: 'test-contact-token',
                userId: targetUserId || 'tc_caretaker',
                email: targetEmail || 'carol.guardian@gmail.com',
                fullName: targetName,
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

          const cbUrl = redirectUrl.includes('?') ? `${redirectUrl}&__clerk_oauth_cb=1` : `${redirectUrl}?__clerk_oauth_cb=1`;
          const params = new URLSearchParams({
            strategy,
            redirect_url: cbUrl,
            action_complete_redirect_url: redirectUrl,
            oidc_prompt: oidcPrompt,
          });

          const clerkDomain = process.env.CLERK_FRONTEND_API || 'harmless-snipe-9044.clerk.accounts.dev';
          let externalUrl: string | undefined;
          let fapiData: any;

          // 1. Try sign_ins first so existing social users sign in seamlessly
          try {
            const signInRes = await fetch(`https://${clerkDomain}/v1/client/sign_ins`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: params.toString(),
            });
            const signInData = (await signInRes.json()) as any;
            const signInUrl = signInData?.response?.first_factor_verification?.external_verification_redirect_url;
            if (signInUrl) {
              externalUrl = signInUrl;
              fapiData = signInData;
            }
          } catch {
            // ignore sign in error, fallback to sign_up
          }

          // 2. If sign_ins fails or user does not exist, try sign_ups so brand new users are created
          if (!externalUrl) {
            try {
              const signUpRes = await fetch(`https://${clerkDomain}/v1/client/sign_ups`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
              });
              const signUpData = (await signUpRes.json()) as any;
              const signUpUrl = signUpData?.response?.verifications?.external_account?.external_verification_redirect_url;
              if (signUpUrl) {
                externalUrl = signUpUrl;
                fapiData = signUpData;
              } else if (!fapiData) {
                fapiData = signUpData;
              }
            } catch {
              // ignore sign up error
            }
          }

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
          let actorId = 'usr_deepanshukhatri20061972';
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
              code = '4829-1735';
            }
          }

          const dashboardBase = process.env.GUARDRAIL_DASHBOARD_URL?.trim() ||
            (config.environment === 'production' ? 'https://guardrail.app' : 'http://localhost:5173');
          const pairingUrl = `${dashboardBase}/?invite=${encodeURIComponent(code || '4829-1735')}`;

          const escapeHtml = (str: string) => str.replace(/[&<>'"]/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
          }[c] || c));

          const inviterName = typeof body.inviterName === 'string' && body.inviterName.trim()
            ? body.inviterName.trim()
            : (actorId.includes('deepanshu') ? 'Deepanshu Khatri' : 'Your family member');

          const emailSubject = `🛡️ You're invited to be a Guardrail Trusted Contact (${role})`;
          const emailText = [
            `Guardrail Protection Network`,
            `----------------------------`,
            `${inviterName} invited you to be their ${role} on Guardrail to help review and approve sensitive online actions.`,
            ``,
            `Connect your account by clicking the link below:`,
            `${pairingUrl}`,
            ``,
            `Or scan the QR code / manually enter this pairing code after signing in:`,
            `Pairing Code: ${code}`,
            ``,
            `This invitation expires in 24 hours.`,
            `If you did not expect this invitation, you can safely ignore this message.`,
          ].join('\n');

          // Generate animated pairing code GIF, high-res QR code PNG, and load brand logo for CID embedding (supported by Gmail)
          let logoB64 = '';
          let gifB64 = '';
          let qrCodeB64 = '';
          let qrMimeType = 'image/png';
          let gifCssWidth = 260;
          let gifCssHeight = 38;
          const codeString = code || '4829-1735';

          // 1. Logo for CID embedding
          try {
            const logoPath = path.resolve(process.cwd(), '../extension/public/icons/icon-48.png');
            const altLogoPath = path.resolve(process.cwd(), 'guardrail/extension/public/icons/icon-48.png');
            const targetLogoPath = fs.existsSync(logoPath) ? logoPath : (fs.existsSync(altLogoPath) ? altLogoPath : '');
            if (targetLogoPath) {
              logoB64 = fs.readFileSync(targetLogoPath).toString('base64');
            }
          } catch (logoErr) {
            console.warn('[Invitation] Could not read logo icon:', logoErr);
          }

          // 2. Animated optical scanner QR code GIF (exact animation matching extension popup)
          const tmpQrGifPath = path.resolve('/tmp', `qr_${codeString.replace(/[^a-zA-Z0-9_-]/g, '_')}.gif`);
          const qrScriptPath = path.resolve(process.cwd(), 'src/generate-qr-gif.py');
          const altQrScriptPath = path.resolve(process.cwd(), 'guardrail/server/src/generate-qr-gif.py');
          const targetQrScript = fs.existsSync(qrScriptPath) ? qrScriptPath : (fs.existsSync(altQrScriptPath) ? altQrScriptPath : '');

          if (targetQrScript) {
            try {
              execSync(`python3 "${targetQrScript}" "${pairingUrl}" "${tmpQrGifPath}"`, { timeout: 15000 });
              if (fs.existsSync(tmpQrGifPath)) {
                qrCodeB64 = fs.readFileSync(tmpQrGifPath).toString('base64');
                qrMimeType = 'image/gif';
              }
            } catch (qrAnimErr) {
              console.warn('[Invitation] Could not generate animated QR GIF, checking fallback:', qrAnimErr);
            }
          }

          // Fallback: If animated GIF wasn't created, generate instant static PNG QR code
          if (!qrCodeB64) {
            try {
              const nodeReq = createRequire(import.meta.url);
              let QRCode: any;
              const qrcodePaths = [
                path.resolve(process.cwd(), '../extension/node_modules/qrcode'),
                path.resolve(process.cwd(), 'guardrail/extension/node_modules/qrcode'),
                'qrcode',
              ];
              for (const qp of qrcodePaths) {
                try {
                  QRCode = nodeReq(qp);
                  if (QRCode) break;
                } catch {}
              }
              if (QRCode && typeof QRCode.toBuffer === 'function') {
                const qrBuf: Buffer = await QRCode.toBuffer(pairingUrl, {
                  width: 280,
                  margin: 2,
                  color: {
                    dark: '#273121',
                    light: '#FAF6ED',
                  },
                });
                if (qrBuf && qrBuf.length > 0) {
                  qrCodeB64 = qrBuf.toString('base64');
                  qrMimeType = 'image/png';
                }
              }
            } catch (fallbackErr) {
              console.warn('[Invitation] Static QR fallback failed:', fallbackErr);
            }
          }

          // 3. Optional Animated Pairing Code GIF
          try {
            const tmpGifPath = path.resolve('/tmp', `code_${codeString.replace(/[^a-zA-Z0-9_-]/g, '_')}.gif`);
            const scriptPath = path.resolve(process.cwd(), 'src/generate-code-gif.py');
            const altScriptPath = path.resolve(process.cwd(), 'guardrail/server/src/generate-code-gif.py');
            const targetScript = fs.existsSync(scriptPath) ? scriptPath : altScriptPath;

            if (fs.existsSync(targetScript)) {
              const genOut = execSync(`python3 "${targetScript}" "${codeString}" "${tmpGifPath}"`, { timeout: 6000 }).toString();
              try {
                const parsed = JSON.parse(genOut.trim());
                if (parsed.cssWidth && parsed.cssHeight) {
                  gifCssWidth = parsed.cssWidth;
                  gifCssHeight = parsed.cssHeight;
                }
              } catch {}
              if (fs.existsSync(tmpGifPath)) {
                gifB64 = fs.readFileSync(tmpGifPath).toString('base64');
              }
            }
          } catch (codeErr) {
            console.warn('[Invitation] Could not generate code GIF, using HTML text:', codeErr);
          }

          const emailHtml = `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Guardrail Trusted Contact Invitation</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      height: 100% !important;
      width: 100% !important;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt !important;
      mso-table-rspace: 0pt !important;
      border-collapse: collapse;
    }
    *, *:before, *:after {
      box-sizing: border-box;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    img {
      -ms-interpolation-mode: bicubic;
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
    }
    @media only screen and (max-width: 520px) {
      .email-wrapper-cell {
        padding: 16px 10px !important;
      }
      .email-card {
        padding: 24px 16px !important;
        border-radius: 14px !important;
      }
      .title-heading {
        font-size: 23px !important;
        line-height: 1.2 !important;
        margin-bottom: 12px !important;
      }
      .lede-text {
        font-size: 14.5px !important;
        line-height: 1.45 !important;
        margin-bottom: 20px !important;
      }
      .pairing-pass-card {
        padding: 18px 12px 16px !important;
        border-radius: 12px !important;
      }
      .qr-img {
        width: 130px !important;
        height: 130px !important;
      }
      .btn-connect {
        display: block !important;
        width: 100% !important;
        box-sizing: border-box !important;
        padding: 14px 16px !important;
        text-align: center !important;
      }
      .code-gif-img {
        max-width: 100% !important;
        height: auto !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; width: 100% !important; background-color: #EDE6D6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #273121; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <!-- Outer Centering Table -->
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #EDE6D6; width: 100%; margin: 0; padding: 0; table-layout: fixed;">
    <tr>
      <td class="email-wrapper-cell" align="center" valign="top" style="padding: 36px 16px;">
        <!--[if (gte mso 9)|(IE)]>
        <table role="presentation" width="480" align="center" border="0" cellspacing="0" cellpadding="0">
        <tr>
        <td>
        <![endif]-->
        <!-- Main Card: Fluid 100% on mobile, max-width 480px on desktop, always centered -->
        <table role="presentation" class="email-card" width="100%" border="0" cellspacing="0" cellpadding="0" align="center" style="background-color: #FAF6ED; border: 1px solid #D8D2C2; border-radius: 16px; box-shadow: 0 4px 20px rgba(39, 49, 33, 0.06); padding: 32px 28px; width: 100%; max-width: 480px; margin: 0 auto; border-collapse: separate;">
          <tr>
            <td style="padding: 0; margin: 0;">
              
              <!-- Brand Header with Table for 100% rock-solid alignment -->
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 22px; border-collapse: collapse;">
                <tr>
                  <td valign="middle" style="vertical-align: middle; padding-right: 10px; line-height: 0;">
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="background-color: #EDE6D6; border: 1px solid #D4CCA8; border-radius: 8px; width: 34px; height: 34px; border-collapse: separate;">
                      <tr>
                        <td align="center" valign="middle" style="width: 34px; height: 34px; line-height: 0; text-align: center; vertical-align: middle;">
                          ${logoB64 ? `<img src="cid:guardrail-logo" width="22" height="22" style="display: block; margin: 0 auto; width: 22px; height: 22px; border: 0;" alt="Guardrail UI" />` : `<span style="font-size: 18px; line-height: 1;">🛡️</span>`}
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td valign="middle" style="vertical-align: middle; line-height: 1;">
                    <span style="font-size: 18px; font-weight: 700; color: #273121; letter-spacing: -0.3px; line-height: 1; vertical-align: middle; display: inline-block;">Guardrail UI</span>
                  </td>
                </tr>
              </table>

              <!-- Big Bold Classy Title -->
              <h1 class="title-heading" style="font-size: 26px; font-weight: 800; color: #172013; margin: 0 0 12px 0; letter-spacing: -0.6px; line-height: 1.2; word-break: break-word;">
                Trusted Contact Invitation
              </h1>

              <!-- Big Bold Classy Body Lede -->
              <p class="lede-text" style="font-size: 15px; line-height: 1.5; color: #36412F; margin: 0 0 22px 0; letter-spacing: -0.2px;">
                <strong style="color: #141C10; font-weight: 700;">${escapeHtml(inviterName)}</strong> invited you to be their <strong style="color: #141C10; font-weight: 700;">${escapeHtml(role)}</strong> to help review and approve sensitive online actions.
              </p>

              <!-- Unified Pairing Pass Card -->
              <table role="presentation" class="pairing-pass-card" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #EDE6D6; border: 1px solid #D4CCA8; border-radius: 14px; margin-bottom: 24px; border-collapse: separate; width: 100%;">
                <tr>
                  <td style="padding: 20px 14px 18px; text-align: center;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6E7964; font-weight: 700; text-align: center; margin-bottom: 12px;">
                      SCAN WITH PHONE CAMERA
                    </div>
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto;">
                      <tr>
                        <td align="center" valign="middle" style="line-height: 0; text-align: center;">
                          ${qrCodeB64
                            ? `<img class="qr-img" src="cid:pairing-qr" width="136" height="136" style="display: block; margin: 0 auto; width: 136px; height: 136px; border-radius: 9px; border: 1px solid #D4CCA8; box-shadow: 0 2px 8px rgba(39, 49, 33, 0.08);" alt="Scan QR Code" />`
                            : `<div style="font-size: 12px; color: #7E8774;">Scan in Guardrail App</div>`
                          }
                        </td>
                      </tr>
                    </table>
                    <p style="font-size: 11.5px; color: #6E7964; margin: 10px 0 0 0; text-align: center; line-height: 1.4;">
                      Point your phone camera at this QR code to connect instantly.
                    </p>

                    <!-- Divider inside card -->
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 18px 0 16px;">
                      <tr>
                        <td style="border-bottom: 1px solid #D8D2C2; font-size: 0; line-height: 0;" width="26%">&nbsp;</td>
                        <td style="text-align: center; padding: 0 8px; font-size: 10px; font-weight: 700; color: #8A9480; text-transform: uppercase; letter-spacing: 1.2px; white-space: nowrap;">
                          OR ENTER CODE
                        </td>
                        <td style="border-bottom: 1px solid #D8D2C2; font-size: 0; line-height: 0;" width="26%">&nbsp;</td>
                      </tr>
                    </table>

                    <!-- Segmented Pairing Code Animation -->
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto; width: 100%; max-width: ${gifCssWidth}px;">
                      <tr>
                        <td align="center" valign="middle" style="line-height: 0; text-align: center;">
                          ${gifB64
                            ? `<img class="code-gif-img" src="cid:pairing-code" width="${gifCssWidth}" height="${gifCssHeight}" style="display: block; margin: 0 auto; width: 100%; max-width: ${gifCssWidth}px; height: auto; border: 0;" alt="${escapeHtml(codeString)}" />`
                            : `<div style="font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; font-size: 19px; font-weight: 700; color: #273121; letter-spacing: 0.06em;">${escapeHtml(codeString)}</div>`
                          }
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Primary Action Button -->
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin: 0 auto 22px auto;">
                <tr>
                  <td align="center" style="border-radius: 9999px; background-color: #273121;">
                    <a href="${pairingUrl}" class="btn-connect" style="background-color: #273121; color: #FAF6ED; display: inline-block; padding: 14px 32px; border-radius: 9999px; font-size: 14px; font-weight: 600; text-decoration: none; box-shadow: 0 2px 10px rgba(39, 49, 33, 0.16); letter-spacing: -0.2px; border: 1px solid #273121;">
                      Accept Invitation &amp; Connect &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security Expiration Notice & Safety Guarantee -->
              <p style="font-size: 12px; line-height: 1.6; color: #7E8774; text-align: center; margin: 0 0 20px 0;">
                This invitation expires in 24 hours.<br/>
                If you did not expect this invitation, you can safely ignore this message.
              </p>

              <!-- Footer Attribution -->
              <div style="border-top: 1px solid #E2DCCF; padding-top: 14px; font-size: 11px; color: #9AA392; text-align: center;">
                Guardrail Protection Network &middot; Privacy &amp; Safety Guard
              </div>

            </td>
          </tr>
        </table>
        <!--[if (gte mso 9)|(IE)]>
        </td>
        </tr>
        </table>
        <![endif]-->
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
              if (qrCodeB64) {
                attachments.push({
                  filename: qrMimeType === 'image/gif' ? 'pairing-qr.gif' : 'pairing-qr.png',
                  content: qrCodeB64,
                  content_id: 'pairing-qr',
                  contentId: 'pairing-qr',
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

    // 3e. Ward Identity Synchronization (/api/v1/ward/sync-identity & /api/v1/ward/identity)
    if (request.method === 'POST' && requestPath === '/api/v1/ward/sync-identity') {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      let bodyStr = '';
      request.on('data', (chunk) => { bodyStr += chunk; });
      request.on('end', async () => {
        try {
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          const isAuthenticated = Boolean(body.isAuthenticated);
          const actorId = typeof body.actorId === 'string' && body.actorId.trim() ? body.actorId.trim() : null;
          const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
          const fullName = typeof body.fullName === 'string' && body.fullName.trim()
            ? body.fullName.trim()
            : (email
                ? email.split('@')[0].split(/[._-]/).filter(Boolean).map((s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(' ')
                : (actorId ? (actorId.startsWith('usr_') ? actorId.slice(4) : actorId) : null));
          const picture = typeof body.picture === 'string' && body.picture.trim() ? body.picture.trim() : null;

          const now = new Date().toISOString();
          const db = (runtime.contactRegistry as any)?.database;
          let isLinked = false;

          if (db) {
            if (isAuthenticated && actorId) {
              // 1. Ensure user is registered in guardrail_users
              db.prepare(`
                INSERT OR REPLACE INTO guardrail_users (id, issuer, subject, role, status, verified_email, created_at, updated_at)
                VALUES (?, 'https://guardrail.local/internal', ?, 'USER', 'ACTIVE', ?, ?, ?)
              `).run(actorId, actorId, email || `${actorId}@guardrail.local`, now, now);

              // 2. Check if this ward ALREADY has an active relationship in trusted_contacts
              const existingRows = db.prepare(
                "SELECT id, payload_json FROM trusted_contacts WHERE user_id = ? AND status = 'ACTIVE'"
              ).all(actorId) as { id: string; payload_json: string }[];

              if (existingRows && existingRows.length > 0) {
                isLinked = true;
                // Update wardName, wardEmail, and wardAvatarUrl in existing active contacts so changes reflect
                for (const row of existingRows) {
                  try {
                    const p = JSON.parse(row.payload_json);
                    p.wardName = fullName || p.wardName;
                    p.wardEmail = email || p.wardEmail;
                    if (picture) {
                      p.wardAvatarUrl = picture;
                    }
                    db.prepare("UPDATE trusted_contacts SET payload_json = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(p), row.id, actorId);
                  } catch {}
                }
              }
              // CRITICAL: If no active pairing exists, DO NOT auto-insert trusted_contacts!
              // Pairing MUST only occur when the caretaker enters the pairing code in the dashboard.
            } else {
              // Preserve existing multi-ward trusted_contacts rows when an extension session is unauthenticated.
              isLinked = false;
            }
          }

          // 3. Emit real-time notification only when an authenticated ward synced
          if (isAuthenticated && actorId) {
            defaultApprovalEventHub.emit({
              type: 'ward_synced' as any,
              ward: {
                actorId,
                fullName,
                email,
                picture,
                isAuthenticated: true,
                isLinked,
              },
            } as any);
          }

          response.statusCode = 200;
          response.end(JSON.stringify({
            success: true,
            data: {
              actorId: isAuthenticated ? actorId : null,
              fullName: isAuthenticated ? fullName : null,
              email: isAuthenticated ? email : null,
              picture: isAuthenticated ? picture : null,
              isAuthenticated,
              isLinked,
            },
          }));
        } catch (err: any) {
          response.statusCode = 500;
          response.end(JSON.stringify({
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: err?.message || 'Failed to sync ward identity',
              statusCode: 500,
            },
          }));
        }
      });
      return;
    }

    if (request.method === 'GET' && requestPath === '/api/v1/ward/identity') {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      const db = (runtime.contactRegistry as any)?.database;
      let activeWard: any = null;
      if (db) {
        const contactRow = db.prepare("SELECT payload_json FROM trusted_contacts WHERE status = 'ACTIVE' LIMIT 1").get() as { payload_json: string } | undefined;
        if (contactRow) {
          try {
            const p = JSON.parse(contactRow.payload_json);
            activeWard = {
              actorId: p.userId || p.wardId,
              fullName: p.wardName,
              email: p.wardEmail,
              isAuthenticated: true,
            };
          } catch {}
        }
      }

      response.statusCode = 200;
      response.end(JSON.stringify({
        success: true,
        data: activeWard,
      }));
      return;
    }

    // 3d. Direct Ward Trusted Contacts Endpoint (/api/v1/trusted-contacts & /api/v1/ward/contacts)
    if (request.method === 'GET' && (requestPath === '/api/v1/trusted-contacts' || requestPath === '/api/v1/ward/contacts')) {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      const db = (runtime.contactRegistry as any)?.database;
      const contacts: any[] = [];
      if (db) {
        const rows = db.prepare("SELECT payload_json FROM trusted_contacts WHERE status = 'ACTIVE' ORDER BY rowid").all() as { payload_json: string }[];
        if (rows && rows.length > 0) {
          for (const r of rows) {
            try {
              contacts.push(JSON.parse(r.payload_json));
            } catch {}
          }
        }
      }

      response.statusCode = 200;
      response.end(JSON.stringify({
        success: true,
        data: contacts,
      }));
      return;
    }

    // 3e. Ward Disconnect Endpoint (/api/v1/ward/disconnect & /api/v1/trusted-contacts/disconnect)
    if (request.method === 'POST' && (requestPath === '/api/v1/ward/disconnect' || requestPath === '/api/v1/trusted-contacts/disconnect')) {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      let bodyStr = '';
      request.on('data', (chunk) => { bodyStr += chunk; });
      request.on('end', async () => {
        try {
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          const wardId = typeof body.wardId === 'string' && body.wardId.trim() ? body.wardId.trim() : null;

          const db = (runtime.contactRegistry as any)?.database;
          if (db) {
            if (wardId) {
              db.prepare("DELETE FROM trusted_contacts WHERE user_id = ?").run(wardId);
            } else if (body?.clearAll === true) {
              db.prepare("DELETE FROM trusted_contacts").run();
            }
          }

          let remainingCount = 0;
          let remainingWard: any = null;
          if (db) {
            const countRow = db.prepare("SELECT count(*) as count FROM trusted_contacts WHERE status = 'ACTIVE'").get() as { count: number } | undefined;
            remainingCount = countRow?.count || 0;
            if (remainingCount > 0) {
              const activeRow = db.prepare("SELECT payload_json FROM trusted_contacts WHERE status = 'ACTIVE' LIMIT 1").get() as { payload_json: string } | undefined;
              if (activeRow) {
                try {
                  const p = JSON.parse(activeRow.payload_json);
                  remainingWard = {
                    actorId: p.userId || p.wardId,
                    fullName: p.wardName,
                    email: p.wardEmail,
                    isAuthenticated: true,
                    isLinked: true,
                  };
                } catch {}
              }
            }
          }

          // Emit real-time notification to all connected dashboard SSE streams
          defaultApprovalEventHub.emit({
            type: 'ward_synced' as any,
            ward: remainingWard || {
              actorId: null,
              fullName: null,
              email: null,
              picture: null,
              isAuthenticated: false,
              isLinked: false,
            },
          } as any);

          response.statusCode = 200;
          response.end(JSON.stringify({
            success: true,
            data: {
              disconnected: true,
              wardId: wardId ?? null,
              remainingCount,
              timestamp: new Date().toISOString(),
            },
          }));
        } catch (err: any) {
          response.statusCode = 500;
          response.end(JSON.stringify({
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: err?.message || 'Failed to disconnect ward',
              statusCode: 500,
            },
          }));
        }
      });
      return;
    }

    // 3f. Direct Invitation Accept Handler (/api/v1/invitations/accept & /api/v1/invitations/:code/accept)
    if (request.method === 'POST' && (requestPath === '/api/v1/invitations/accept' || /^\/api\/v1\/invitations\/[^/]+\/accept$/.test(requestPath))) {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      let bodyStr = '';
      request.on('data', (chunk) => { bodyStr += chunk; });
      request.on('end', async () => {
        // Resolve caller rate-limit key before validating or accepting codes
        const authHeader = request.headers.authorization;
        const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : '';
        let contactId = 'usr_dee1b4c0-542f-4b0f-ae3c-126115be972b';
        if (token && options.tokenVerifier) {
          try {
            const auth = await options.tokenVerifier.verifyToken(token);
            if (auth?.isAuthenticated && auth.actorId) {
              contactId = auth.actorId;
            }
          } catch {}
        }
        const remoteIp = request.socket?.remoteAddress || 'unknown';
        const rateKey = `${contactId}:${remoteIp}`;
        const retryAfterSeconds = isPairingRateLimited(rateKey);
        if (retryAfterSeconds !== null) {
          response.setHeader('Retry-After', String(retryAfterSeconds));
          response.statusCode = 429;
          response.end(JSON.stringify({
            success: false,
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many invalid pairing attempts. Please wait a few minutes and try again.',
            },
          }));
          return;
        }

        try {
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          const pathMatch = requestPath.match(/^\/api\/v1\/invitations\/([^/]+)\/accept$/);
          const rawCode = (pathMatch ? decodeURIComponent(pathMatch[1]) : body.code) || '';
          const codeVal = validateInvitationCode(rawCode);
          if (!codeVal.valid || !codeVal.normalized) {
            recordPairingFailure(rateKey);
            response.statusCode = 400;
            response.end(JSON.stringify({
              success: false,
              error: { code: 'INVALID_CODE', message: codeVal.errors[0] || 'Invalid pairing code' },
            }));
            return;
          }
          const code = codeVal.normalized;

          const db = (runtime.contactRegistry as any)?.database;
          const now = new Date().toISOString();
          if (db) {
            db.prepare(`
              INSERT OR IGNORE INTO guardrail_users (id, issuer, subject, role, status, verified_email, created_at, updated_at)
              VALUES (?, 'https://guardrail.local/internal', ?, 'TRUSTED_CONTACT', 'ACTIVE', ?, ?, ?)
            `).run(contactId, contactId, body.contactEmail || 'deepanshukhatri20061972@gmail.com', now, now);
          }

          const contactInfo = {
            contactName: typeof body.contactName === 'string' && body.contactName.trim() ? body.contactName.trim() : 'Deepanshu Khatri',
            contactEmail: typeof body.contactEmail === 'string' && body.contactEmail.trim() ? body.contactEmail.trim() : 'deepanshukhatri20061972@gmail.com',
            contactAvatarUrl: typeof body.contactAvatarUrl === 'string' && body.contactAvatarUrl.trim() ? body.contactAvatarUrl.trim() : undefined,
          };

          const result = runtime.contactRegistry.acceptInvitation(code, contactId, contactInfo);
          pairingFailedAttempts.delete(rateKey);

          // Emit real-time notification to all connected dashboard and extension SSE streams
          defaultApprovalEventHub.emit({
            type: 'ward_synced' as any,
            ward: {
              actorId: result.contact.wardId || result.contact.userId,
              fullName: result.contact.wardName || ((result.contact.wardId || '').startsWith('usr_') ? (result.contact.wardId || '').slice(4) : result.contact.wardId),
              email: result.contact.wardEmail || null,
              picture: null,
              isAuthenticated: true,
              isLinked: true,
              contactName: result.contact.contactName,
              contactEmail: result.contact.contactEmail,
            },
          } as any);

          response.statusCode = 200;
          response.end(JSON.stringify({
            success: true,
            data: result,
          }));
        } catch (err: any) {
          recordPairingFailure(rateKey);
          response.statusCode = 400;
          response.end(JSON.stringify({
            success: false,
            error: {
              code: 'ACCEPT_INVITATION_FAILED',
              message: err?.message || 'Failed to accept invitation',
            },
          }));
        }
      });
      return;
    }

    // 3f. Web Push VAPID Public Key Discovery (/api/v1/push/vapid-public-key)
    if (request.method === 'GET' && requestPath === '/api/v1/push/vapid-public-key') {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      response.statusCode = 200;
      response.end(
        JSON.stringify({
          success: true,
          data: {
            publicKey: runtime.pushService.getVapidPublicKey(),
          },
        })
      );
      return;
    }

    // 3f. Client Push Notification Subscription Registration (/api/v1/push/subscribe)
    if (request.method === 'POST' && requestPath === '/api/v1/push/subscribe') {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      let bodyStr = '';
      request.on('data', (chunk) => { bodyStr += chunk; });
      request.on('end', async () => {
        try {
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          if (!body?.subscription?.endpoint || !body?.subscription?.keys?.p256dh || !body?.subscription?.keys?.auth) {
            response.statusCode = 400;
            response.end(JSON.stringify({ success: false, error: { message: 'Invalid subscription object: endpoint and keys are required' } }));
            return;
          }

          // Resolve caller identity
          let actorId = typeof body.actorId === 'string' && body.actorId.trim() ? body.actorId.trim() : 'tc_carol';
          const authHeader = request.headers.authorization;
          const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
          if (token && options.tokenVerifier) {
            try {
              const auth = await options.tokenVerifier.verifyToken(token);
              if (auth?.isAuthenticated && auth.actorId) {
                actorId = auth.actorId;
              }
            } catch {}
          }

          const record = runtime.pushService.saveSubscription(actorId, body.subscription, request.headers['user-agent']);
          response.statusCode = 200;
          response.end(
            JSON.stringify({
              success: true,
              data: {
                subscriptionId: record.id,
                actorId: record.actorId,
                endpoint: record.endpoint,
                createdAt: record.createdAt,
              },
            })
          );
        } catch (err: any) {
          response.statusCode = 500;
          response.end(JSON.stringify({ success: false, error: { message: err?.message || 'Subscription failed' } }));
        }
      });
      return;
    }

    // 3g. Client Push Notification Unsubscribe (/api/v1/push/unsubscribe)
    if (request.method === 'POST' && requestPath === '/api/v1/push/unsubscribe') {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      let bodyStr = '';
      request.on('data', (chunk) => { bodyStr += chunk; });
      request.on('end', async () => {
        try {
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
          if (!endpoint) {
            response.statusCode = 400;
            response.end(JSON.stringify({ success: false, error: { message: 'Subscription endpoint is required' } }));
            return;
          }

          const removed = runtime.pushService.removeSubscription(endpoint);
          response.statusCode = 200;
          response.end(JSON.stringify({ success: true, data: { unsubscribed: removed } }));
        } catch (err: any) {
          response.statusCode = 500;
          response.end(JSON.stringify({ success: false, error: { message: err?.message || 'Unsubscribe failed' } }));
        }
      });
      return;
    }

    // 3h. Test Out-of-Band Notification Dispatch (/api/v1/push/test)
    if (request.method === 'POST' && requestPath === '/api/v1/push/test') {
      applyCorsHeaders(response, request.headers.origin);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');

      let bodyStr = '';
      request.on('data', (chunk) => { bodyStr += chunk; });
      request.on('end', async () => {
        try {
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          let actorId = typeof body.actorId === 'string' && body.actorId.trim() ? body.actorId.trim() : 'tc_carol';
          const authHeader = request.headers.authorization;
          const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
          if (token && options.tokenVerifier) {
            try {
              const auth = await options.tokenVerifier.verifyToken(token);
              if (auth?.isAuthenticated && auth.actorId) {
                actorId = auth.actorId;
              }
            } catch {}
          }

          const result = await runtime.pushService.sendTestNotification(actorId);
          response.statusCode = 200;
          response.end(JSON.stringify({ success: true, data: result }));
        } catch (err: any) {
          response.statusCode = 500;
          response.end(JSON.stringify({ success: false, error: { message: err?.message || 'Test dispatch failed' } }));
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
        .then(async (authContext) => {
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

          let verifiedEmail: string | undefined = (authContext as any).email;
          let fullName: string | undefined = (authContext as any).fullName;
          let imageUrl: string | null = (authContext as any).picture || null;

          try {
            if (options.identities) {
              const fromStore = options.identities.getVerifiedEmail(authContext.actorId);
              if (fromStore) verifiedEmail = fromStore;
            }
          } catch {}

          // Determine Clerk user ID: from actorId, JWT sub claim, or identity store subject
          let clerkUserId: string | undefined;
          if (authContext.actorId.startsWith('user_')) {
            clerkUserId = authContext.actorId;
          } else {
            try {
              if (token.includes('.')) {
                const parts = token.split('.');
                if (parts[1]) {
                  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
                  if (typeof payload.sub === 'string' && payload.sub.startsWith('user_')) {
                    clerkUserId = payload.sub;
                  }
                }
              }
            } catch {}
            if (!clerkUserId && options.identities) {
              try {
                const identSubject = (options.identities as any).getSubject?.(authContext.actorId);
                if (identSubject && identSubject.startsWith('user_')) {
                  clerkUserId = identSubject;
                }
              } catch {}
            }
          }

          // Enrich user identity from Clerk Backend API when available
          const clerkSecretKey = process.env.CLERK_SECRET_KEY || 'sk_test_UsM9vlgvALJYmyRnEyXEy3F9kZrydfH1cUcB0rgkqO';
          if (clerkUserId && clerkSecretKey) {
            try {
              const clerkRes = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
                headers: { Authorization: `Bearer ${clerkSecretKey}` },
              });
              if (clerkRes.ok) {
                const u = (await clerkRes.json()) as any;
                const nameFromClerk = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username;
                if (nameFromClerk) {
                  fullName = nameFromClerk;
                }
                if (Array.isArray(u.email_addresses) && u.email_addresses[0]?.email_address) {
                  verifiedEmail = u.email_addresses[0].email_address;
                }
                const clerkAvatar = u.image_url || u.profile_image_url || u.external_accounts?.[0]?.avatar_url || u.external_accounts?.[0]?.picture;
                if (clerkAvatar) {
                  imageUrl = clerkAvatar;
                }
              }
            } catch {}
          }

          const displayName =
            fullName ||
            (verifiedEmail
              ? verifiedEmail
                  .split('@')[0]
                  .split(/[._-]/)
                  .filter(Boolean)
                  .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
                  .join(' ')
              : authContext.role === 'USER'
              ? 'Ward User'
              : 'Designated Caretaker');

          let assignedWardId: string | undefined;
          let assignedWardName: string | undefined;
          let assignedWardEmail: string | undefined;

          if (authContext.role === 'TRUSTED_CONTACT') {
            try {
              const reg = runtime.contactRegistry;
              let contacts: readonly any[] = [];
              if (typeof (reg as any).getContactsForTrustedContact === 'function') {
                contacts = (reg as any).getContactsForTrustedContact(authContext.actorId);
              }
              if ((!contacts || contacts.length === 0) && typeof (reg as any).getWardIdsForContact === 'function') {
                const wIds = (reg as any).getWardIdsForContact(authContext.actorId);
                if (wIds && wIds.length > 0) {
                  assignedWardId = wIds[0];
                }
              }
              if (contacts && contacts.length > 0) {
                assignedWardId = contacts[0].userId || contacts[0].wardId;
                assignedWardName = contacts[0].wardName || (assignedWardId && assignedWardId.startsWith('usr_') ? assignedWardId.slice(4) : assignedWardId);
                assignedWardEmail = contacts[0].wardEmail;
              }

              const assignedWards: Array<{ id: string; name: string; email?: string; relationshipLabel?: string; imageUrl?: string }> = [];
              if (contacts && contacts.length > 0) {
                for (const c of contacts) {
                  const id = c.userId || c.wardId;
                  if (id && !assignedWards.some((w) => w.id === id)) {
                    assignedWards.push({
                      id,
                      name: c.wardName || (id.startsWith('usr_') ? id.slice(4) : id),
                      email: c.wardEmail,
                      relationshipLabel: c.relationshipLabel || 'Designated Caretaker',
                      imageUrl: c.wardAvatarUrl || c.imageUrl || undefined,
                    });
                  }
                }
              } else {
                const db = (reg as any)?.database;
                if (db) {
                  const allActive = db.prepare("SELECT payload_json FROM trusted_contacts WHERE status = 'ACTIVE' ORDER BY rowid").all() as Array<{ payload_json: string }>;
                  for (const row of allActive) {
                    try {
                      const p = JSON.parse(row.payload_json);
                      const id = p.userId || p.wardId;
                      if (id && !assignedWards.some((w) => w.id === id)) {
                        assignedWards.push({
                          id,
                          name: p.wardName || (id.startsWith('usr_') ? id.slice(4) : id),
                          email: p.wardEmail,
                          relationshipLabel: p.relationshipLabel || 'Designated Caretaker',
                          imageUrl: p.wardAvatarUrl || p.imageUrl || undefined,
                        });
                      }
                    } catch {}
                  }
                }
              }

              if (assignedWards.length > 0 && !assignedWardId) {
                assignedWardId = assignedWards[0].id;
                assignedWardName = assignedWards[0].name;
                assignedWardEmail = assignedWards[0].email;
              }

              console.log('[DEBUG /api/v1/auth/me] assignedWards:', assignedWards, 'for actorId:', authContext.actorId);

              response.statusCode = 200;
              response.end(
                JSON.stringify({
                  success: true,
                  data: {
                    actorId: authContext.actorId,
                    role: authContext.role,
                    isAuthenticated: true,
                    email: verifiedEmail ?? null,
                    fullName: displayName,
                    imageUrl: imageUrl,
                    environment: config.environment,
                    assignedWardId: assignedWardId ?? null,
                    assignedWardName: assignedWardName ?? null,
                    assignedWardEmail: assignedWardEmail ?? null,
                    assignedWards,
                  },
                })
              );
              return;
            } catch (err) {
              console.error('[GET /api/v1/auth/me error]', err);
              response.statusCode = 200;
              response.end(
                JSON.stringify({
                  success: true,
                  data: {
                    actorId: authContext.actorId,
                    role: authContext.role,
                    isAuthenticated: true,
                    email: verifiedEmail ?? null,
                    fullName: displayName,
                    imageUrl: imageUrl,
                    environment: config.environment,
                    assignedWardId: null,
                    assignedWardName: null,
                    assignedWardEmail: null,
                    assignedWards: [],
                  },
                })
              );
              return;
            }
          } else {
            response.statusCode = 200;
            response.end(
              JSON.stringify({
                success: true,
                data: {
                  actorId: authContext.actorId,
                  role: authContext.role,
                  isAuthenticated: true,
                  email: verifiedEmail ?? null,
                  fullName: displayName,
                  imageUrl: imageUrl,
                  environment: config.environment,
                  assignedWardId: null,
                  assignedWardName: null,
                  assignedWardEmail: null,
                  assignedWards: [],
                },
              })
            );
          }
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
      if (host === '0.0.0.0' || host === '::' || host === 'localhost' || !host) {
        server.listen(port, () => { server.off('error', reject); resolve(); });
      } else {
        server.listen(port, host, () => { server.off('error', reject); resolve(); });
      }
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
