import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActorRole } from '../../extension/src/approval/authorization.js';
import { SqliteIdentityStore } from './identity-store.js';
import { SqliteTrustedContactRegistry } from './sqlite-trusted-contact-registry.js';
import { createResendProviderFromEnv, ResendEmailProvider, SqliteInvitationDeliveryCoordinator } from './invitation-delivery.js';

const root = mkdtempSync(join(tmpdir(), 'guardrail-email-delivery-'));
const databasePath = join(root, 'delivery.sqlite');
const identities = SqliteIdentityStore.open(databasePath);
const issuer = 'https://email-test-issuer.example';
const ownerId = identities.resolveVerifiedIdentity(issuer, 'owner', ActorRole.USER)!.actorId;
const recipientId = identities.resolveVerifiedIdentity(issuer, 'recipient', ActorRole.TRUSTED_CONTACT, 'trusted@example.test')!.actorId;
const failedRecipientId = identities.resolveVerifiedIdentity(issuer, 'failed-recipient', ActorRole.TRUSTED_CONTACT, 'failed@example.test')!.actorId;
const noEmailRecipientId = identities.resolveVerifiedIdentity(issuer, 'no-email-recipient', ActorRole.TRUSTED_CONTACT)!.actorId;
const expiringRecipientId = identities.resolveVerifiedIdentity(issuer, 'expiring-recipient', ActorRole.TRUSTED_CONTACT, 'expiring@example.test')!.actorId;
const registry = SqliteTrustedContactRegistry.open(databasePath);
let sendCount = 0;
let requestBody = '';
let requestHeaders = new Headers();
const provider = new ResendEmailProvider({
  apiKey: 're_test_fake_key', from: 'pilot@example.test', dashboardUrl: 'https://dashboard.example.test/',
}, async (_input, init) => {
  sendCount += 1;
  requestBody = String(init?.body ?? '');
  requestHeaders = new Headers(init?.headers);
  return new Response(JSON.stringify({ id: `resend_test_${sendCount}` }), { status: 200 });
});
const coordinator = SqliteInvitationDeliveryCoordinator.open(databasePath, identities, provider);

try {
  console.log('Invitation delivery tests (real temporary SQLite; mocked Resend HTTP responses)');
  assert.equal(createResendProviderFromEnv({}), undefined, 'missing provider settings disable delivery safely');
  assert.throws(() => createResendProviderFromEnv({ RESEND_API_KEY: 'test' }), /configured together/);
  assert.ok(createResendProviderFromEnv({
    RESEND_API_KEY: 're_test_key', GUARDRAIL_EMAIL_FROM: 'pilot@example.test',
    GUARDRAIL_DASHBOARD_URL: 'https://dashboard.example.test/',
    GUARDRAIL_ALLOWED_ORIGINS: 'https://dashboard.example.test',
  }), 'complete provider configuration is accepted');
  assert.throws(() => createResendProviderFromEnv({
    RESEND_API_KEY: 're_test_key', GUARDRAIL_EMAIL_FROM: 'pilot@example.test',
    GUARDRAIL_DASHBOARD_URL: 'https://dashboard.example.test/',
    GUARDRAIL_ALLOWED_ORIGINS: 'https://other.example.test',
  }), /included in GUARDRAIL_ALLOWED_ORIGINS/);

  const created = registry.createInvitation(ownerId, { recipientActorId: recipientId });
  assert.match(created.code ?? '', /^GRI_[A-Za-z0-9_-]{43}$/, 'backend creates an unpredictable 256-bit invitation token');
  const success = await coordinator.deliver(created);
  assert.equal(success.deliveryStatus, 'SUBMITTED', 'provider success is reported as submission, not inbox delivery');
  assert.equal(sendCount, 1);
  assert.equal(requestHeaders.get('authorization'), 'Bearer re_test_fake_key');
  assert.equal(requestHeaders.get('idempotency-key'), `guardrail-invitation-${created.id}`);
  const body = JSON.parse(requestBody) as { to: string[]; text: string; subject: string };
  assert.deepEqual(body.to, ['trusted@example.test'], 'destination comes from the issuer-verified email claim');
  assert.ok(body.text.includes(created.code ?? ''), 'email includes only the invitation token and generic setup instructions');
  assert.equal(body.text.includes('Bearer '), false, 'email contains no authentication token');
  assert.ok(body.text.includes(new Date(created.expiresAt).toUTCString()), 'email communicates invitation expiry');
  assert.equal(body.text.includes(created.userId), false, 'email omits unrelated account identifiers and approval details');
  assert.equal(body.text.includes(created.code ?? ''), true);
  const stored = registry.getInvitationById(created.id)!;
  assert.equal(stored.code, undefined, 'persistent invitation reads omit the one-time token');
  assert.equal(stored.deliveryStatus, 'SUBMITTED');
  const db = new Database(databasePath, { readonly: true });
  try {
    const row = db.prepare('SELECT code,payload_json FROM trusted_contact_invitations WHERE id=?').get(created.id) as { code: string; payload_json: string };
    assert.match(row.code, /^sha256:[a-f0-9]{64}$/);
    assert.equal(row.payload_json.includes(created.code ?? ''), false, 'database stores only the token hash');
  } finally { db.close(); }

  const duplicateCreate = registry.createInvitation(ownerId, { recipientActorId: recipientId });
  assert.equal(duplicateCreate.id, created.id, 'repeat creation returns the existing pending invitation');
  assert.equal(duplicateCreate.code, undefined, 'repeat creation cannot recover the one-time token');
  await coordinator.deliver(created);
  assert.equal(sendCount, 1, 'duplicate delivery attempts do not send another email');

  const failureProvider = new ResendEmailProvider({
    apiKey: 're_test_fake_key', from: 'pilot@example.test', dashboardUrl: 'https://dashboard.example.test/',
  }, async () => new Response(JSON.stringify({ error: 'synthetic failure' }), { status: 503 }));
  const failureCoordinator = SqliteInvitationDeliveryCoordinator.open(databasePath, identities, failureProvider);
  try {
    const failedInvite = registry.createInvitation(ownerId, { recipientActorId: failedRecipientId });
    const failure = await failureCoordinator.deliver(failedInvite);
    assert.equal(failure.deliveryStatus, 'FAILED');
    assert.equal(failure.deliveryFailureCode, 'PROVIDER_REJECTED');
    assert.equal(registry.getInvitationById(failedInvite.id)?.deliveryStatus, 'FAILED');
  } finally { failureCoordinator.close(); }

  const noEmailInvite = registry.createInvitation(ownerId, { recipientActorId: noEmailRecipientId });
  const noEmail = await coordinator.deliver(noEmailInvite);
  assert.equal(noEmail.deliveryStatus, 'FAILED');
  assert.equal(noEmail.deliveryFailureCode, 'RECIPIENT_EMAIL_UNAVAILABLE');
  assert.equal(sendCount, 1, 'unverified or unavailable email addresses are never sent to');

  const expiring = registry.createInvitation(ownerId, { recipientActorId: expiringRecipientId, ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(registry.getInvitationById(expiring.id)?.status, 'EXPIRED');
  const expiredDelivery = await coordinator.deliver(expiring);
  assert.notEqual(expiredDelivery.deliveryStatus, 'SUBMITTED');
  assert.equal(sendCount, 1, 'expired invitations are not sent');

  console.log('PASS: provider submission, failure, recipient verification, secret hashing, expiry, and duplicate suppression');
} finally {
  coordinator.close();
  registry.close();
  identities.close();
  rmSync(root, { recursive: true, force: true });
}
