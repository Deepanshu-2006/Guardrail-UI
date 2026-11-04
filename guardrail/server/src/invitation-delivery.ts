import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { TrustedContactInvitation } from '../../extension/src/approval/authorization.js';
import { DEFAULT_ALLOWED_ORIGINS, type InvitationDeliveryHandler, type InvitationDeliveryOutcome } from '../../extension/src/approval/api.js';
import { SqliteIdentityStore } from './identity-store.js';

function retiredInvitationTokenHash(): string {
  return `sha256:${createHash('sha256').update(randomBytes(32)).digest('hex')}`;
}

export interface InvitationEmailProvider {
  submitInvitation(input: {
    readonly to: string;
    readonly code: string;
    readonly expiresAt: string;
    readonly invitationId: string;
  }): Promise<{ readonly messageId: string }>;
}

export interface ResendEmailConfig {
  readonly apiKey: string;
  readonly from: string;
  readonly dashboardUrl: string;
}

export function createResendProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
): InvitationEmailProvider | undefined {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.GUARDRAIL_EMAIL_FROM?.trim();
  const dashboardUrl = env.GUARDRAIL_DASHBOARD_URL?.trim();
  if (!apiKey && !from && !dashboardUrl) return undefined;
  if (!apiKey || !from || !dashboardUrl) {
    throw new Error('RESEND_API_KEY, GUARDRAIL_EMAIL_FROM, and GUARDRAIL_DASHBOARD_URL must be configured together.');
  }
  let parsedDashboard: URL;
  try { parsedDashboard = new URL(dashboardUrl); } catch { throw new Error('GUARDRAIL_DASHBOARD_URL must be a valid HTTPS URL.'); }
  if (parsedDashboard.protocol !== 'https:' || parsedDashboard.username || parsedDashboard.password || parsedDashboard.search || parsedDashboard.hash ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
    throw new Error('Email sender must be an address and dashboard URL must be credential-free HTTPS.');
  }
  const allowedOrigins = env.GUARDRAIL_ALLOWED_ORIGINS?.trim()
    ? env.GUARDRAIL_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
    : DEFAULT_ALLOWED_ORIGINS;
  if (!allowedOrigins.includes(parsedDashboard.origin)) {
    throw new Error('GUARDRAIL_DASHBOARD_URL origin must be included in GUARDRAIL_ALLOWED_ORIGINS.');
  }
  return new ResendEmailProvider({ apiKey, from, dashboardUrl: parsedDashboard.href }, fetchFn);
}

/** Resend adapter. A successful response means provider submission accepted, not inbox delivery. */
export class ResendEmailProvider implements InvitationEmailProvider {
  constructor(
    private readonly config: ResendEmailConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  public async submitInvitation(input: {
    readonly to: string;
    readonly code: string;
    readonly expiresAt: string;
    readonly invitationId: string;
  }): Promise<{ readonly messageId: string }> {
    const expiry = new Date(input.expiresAt);
    const text = [
      'You have been invited to become a trusted contact in Guardrail UI.',
      '',
      `Open the Guardrail dashboard: ${this.config.dashboardUrl}`,
      `Enter this invitation code after signing in: ${input.code}`,
      `This invitation expires at ${expiry.toUTCString()}. It is assigned to your verified Guardrail account.`,
      '',
      'If you were not expecting this invitation, ignore this message or contact the person who invited you.',
    ].join('\n');
    const response = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': `guardrail-invitation-${input.invitationId}`,
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [input.to],
        subject: 'Guardrail trusted-contact invitation',
        text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('PROVIDER_REJECTED');
    const body: unknown = await response.json().catch(() => undefined);
    if (!body || typeof body !== 'object' || typeof (body as { id?: unknown }).id !== 'string' || !(body as { id: string }).id.trim()) {
      throw new Error('PROVIDER_UNAVAILABLE');
    }
    return Object.freeze({ messageId: (body as { id: string }).id });
  }
}

/** Persists a single delivery claim and outcome while keeping the token out of SQLite. */
export class SqliteInvitationDeliveryCoordinator implements InvitationDeliveryHandler {
  private constructor(
    private readonly database: Database.Database,
    private readonly identities: SqliteIdentityStore,
    private readonly provider?: InvitationEmailProvider,
  ) {}

  public static open(
    databasePath: string,
    identities: SqliteIdentityStore,
    provider?: InvitationEmailProvider,
  ): SqliteInvitationDeliveryCoordinator {
    const resolved = databasePath === ':memory:' ? databasePath : resolve(databasePath);
    if (resolved !== ':memory:') mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
    const database = new Database(resolved, { timeout: 5000 });
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = FULL');
    return new SqliteInvitationDeliveryCoordinator(database, identities, provider);
  }

  public async deliver(invitation: TrustedContactInvitation): Promise<InvitationDeliveryOutcome> {
    if (!this.provider) return { deliveryStatus: 'NOT_CONFIGURED' };
    if (!invitation.code) return this.outcomeFromStored(invitation.id);
    const recipientEmail = this.identities.getVerifiedEmail(invitation.recipientActorId);
    if (!recipientEmail) return this.finish(invitation.id, 'FAILED', 'RECIPIENT_EMAIL_UNAVAILABLE');

    const claimed = this.claim(invitation.id);
    if (!claimed) return this.outcomeFromStored(invitation.id);
    try {
      const result = await this.provider.submitInvitation({
        to: recipientEmail,
        code: invitation.code,
        expiresAt: invitation.expiresAt,
        invitationId: invitation.id,
      });
      return this.finish(invitation.id, 'SUBMITTED', undefined, result.messageId);
    } catch (error) {
      const code = error instanceof Error && error.message === 'PROVIDER_REJECTED' ? 'PROVIDER_REJECTED' : 'PROVIDER_UNAVAILABLE';
      return this.finish(invitation.id, 'FAILED', code);
    }
  }

  private claim(invitationId: string): boolean {
    const tx = this.database.transaction(() => {
      const row = this.database.prepare("SELECT status,payload_json FROM trusted_contact_invitations WHERE id=?").get(invitationId) as
        { status: string; payload_json: string } | undefined;
      if (!row || row.status !== 'PENDING') return false;
      const invitation = JSON.parse(row.payload_json) as TrustedContactInvitation;
      if (Date.now() >= Date.parse(invitation.expiresAt)) {
        this.database.prepare("UPDATE trusted_contact_invitations SET code=?,status='EXPIRED',expired_at=?,payload_json=? WHERE id=? AND status='PENDING'")
          .run(retiredInvitationTokenHash(), invitation.expiresAt, JSON.stringify({ ...invitation, status: 'EXPIRED', expiredAt: invitation.expiresAt }), invitationId);
        return false;
      }
      if (invitation.deliveryStatus !== 'NOT_CONFIGURED') return false;
      const attemptedAt = new Date().toISOString();
      const updated = { ...invitation, deliveryStatus: 'SUBMITTING' as const, deliveryAttemptedAt: attemptedAt };
      const result = this.database.prepare("UPDATE trusted_contact_invitations SET payload_json=? WHERE id=? AND status='PENDING'")
        .run(JSON.stringify(updated), invitationId);
      return Number(result.changes) === 1;
    });
    return tx.immediate();
  }

  private finish(
    invitationId: string,
    status: 'SUBMITTED' | 'FAILED',
    failureCode?: InvitationDeliveryOutcome['deliveryFailureCode'],
    messageId?: string,
  ): InvitationDeliveryOutcome {
    const row = this.database.prepare('SELECT payload_json FROM trusted_contact_invitations WHERE id=?').get(invitationId) as
      { payload_json: string } | undefined;
    if (!row) return { deliveryStatus: status, ...(failureCode ? { deliveryFailureCode: failureCode } : {}) };
    const invitation = JSON.parse(row.payload_json) as TrustedContactInvitation;
    const updated = {
      ...invitation,
      deliveryStatus: status,
      ...(status === 'SUBMITTED' ? { deliverySubmittedAt: new Date().toISOString() } : {}),
      ...(failureCode ? { deliveryFailureCode: failureCode } : {}),
    };
    this.database.prepare('UPDATE trusted_contact_invitations SET payload_json=? WHERE id=?').run(JSON.stringify(updated), invitationId);
    // Provider message IDs are deliberately not stored: only the submission status and timestamp are required.
    void messageId;
    return Object.freeze({
      deliveryStatus: status,
      ...(updated.deliveryAttemptedAt ? { deliveryAttemptedAt: updated.deliveryAttemptedAt } : {}),
      ...(updated.deliverySubmittedAt ? { deliverySubmittedAt: updated.deliverySubmittedAt } : {}),
      ...(failureCode ? { deliveryFailureCode: failureCode } : {}),
    });
  }

  private outcomeFromStored(invitationId: string): InvitationDeliveryOutcome {
    const row = this.database.prepare('SELECT payload_json FROM trusted_contact_invitations WHERE id=?').get(invitationId) as
      { payload_json: string } | undefined;
    if (!row) return { deliveryStatus: 'FAILED', deliveryFailureCode: 'PROVIDER_UNAVAILABLE' };
    const invitation = JSON.parse(row.payload_json) as TrustedContactInvitation;
    return Object.freeze({
      deliveryStatus: invitation.deliveryStatus ?? 'NOT_CONFIGURED',
      ...(invitation.deliveryAttemptedAt ? { deliveryAttemptedAt: invitation.deliveryAttemptedAt } : {}),
      ...(invitation.deliverySubmittedAt ? { deliverySubmittedAt: invitation.deliverySubmittedAt } : {}),
      ...(invitation.deliveryFailureCode ? { deliveryFailureCode: invitation.deliveryFailureCode } : {}),
    });
  }

  public close(): void { this.database.close(); }
}
