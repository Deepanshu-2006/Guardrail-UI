import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { InMemoryTokenVerifier } from '../../extension/src/approval/api.js';
import { ApprovalApiClient } from '../../extension/src/approval/client.js';
import { ActorRole } from '../../extension/src/approval/authorization.js';
import { ApprovalStatus } from '../../extension/src/types/approval.js';
import { ActionType } from '../../extension/src/types/actions.js';
import { RiskLevel } from '../../extension/src/types/risk.js';
import { startGuardrailHttpServer } from './http-server.js';
import { SqliteIdentityStore } from './identity-store.js';
import { SqliteTrustedContactRegistry } from './sqlite-trusted-contact-registry.js';

const root = mkdtempSync(join(tmpdir(), 'guardrail-api-integration-'));
const databasePath = join(root, 'pilot.sqlite');
const verifier = new InMemoryTokenVerifier();
const identityStore = SqliteIdentityStore.open(databasePath);
const issuer = 'https://synthetic-test-issuer.example';
const wardId = identityStore.resolveVerifiedIdentity(issuer, 'ward', ActorRole.USER)!.actorId;
const contactId = identityStore.resolveVerifiedIdentity(issuer, 'contact', ActorRole.TRUSTED_CONTACT)!.actorId;
const otherContactId = identityStore.resolveVerifiedIdentity(issuer, 'other-contact', ActorRole.TRUSTED_CONTACT)!.actorId;
const outsiderId = identityStore.resolveVerifiedIdentity(issuer, 'outsider', ActorRole.USER)!.actorId;
{
  const legacyPath = join(root, 'legacy.sqlite');
  const legacyDb = new Database(legacyPath);
  legacyDb.exec(`
    CREATE TABLE trusted_contact_invitations (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL, expires_at TEXT NOT NULL, payload_json TEXT NOT NULL
    );
    CREATE TABLE trusted_contacts (
      id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL,
      PRIMARY KEY(user_id,id)
    );
  `);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const legacyBase = { userId: 'usr_legacy_owner', wardId: 'usr_legacy_owner', relationshipLabel: 'Legacy',
    createdAt, expiresAt, code: 'GR-INV-LEGY-CODE' };
  legacyDb.prepare('INSERT INTO trusted_contact_invitations VALUES (?,?,?,?,?,?)').run(
    'inv_legacy_pending', legacyBase.userId, legacyBase.code, 'PENDING', expiresAt,
    JSON.stringify({ ...legacyBase, id: 'inv_legacy_pending', status: 'PENDING' }),
  );
  legacyDb.prepare('INSERT INTO trusted_contact_invitations VALUES (?,?,?,?,?,?)').run(
    'inv_legacy_accepted', legacyBase.userId, 'GR-INV-OLD1-OLD2', 'ACCEPTED', expiresAt,
    JSON.stringify({ ...legacyBase, id: 'inv_legacy_accepted', code: 'GR-INV-OLD1-OLD2',
      status: 'ACCEPTED', acceptedByContactId: 'usr_legacy_contact', acceptedAt: createdAt }),
  );
  legacyDb.close();
  const migratedRegistry = SqliteTrustedContactRegistry.open(legacyPath);
  try {
    assert.equal(migratedRegistry.getInvitationById('inv_legacy_pending')?.status, 'REVOKED',
      'old bearer invitations without a recipient are invalidated during schema upgrade');
    assert.equal(migratedRegistry.getInvitationById('inv_legacy_accepted')?.recipientActorId, 'usr_legacy_contact',
      'accepted legacy invitations remain linked to their recorded contact');
  } finally {
    migratedRegistry.close();
  }
}
verifier.registerToken('synthetic-ward-token', { actorId: wardId, role: ActorRole.USER, isAuthenticated: true });
verifier.registerToken('synthetic-contact-token', { actorId: contactId, role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true });
verifier.registerToken('synthetic-other-contact-token', { actorId: otherContactId, role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true });
verifier.registerToken('synthetic-outsider-token', { actorId: outsiderId, role: ActorRole.USER, isAuthenticated: true });
const api = (port: number, token: string) => new ApprovalApiClient({
  baseUrl: `http://127.0.0.1:${port}`, environment: 'test', tokenProvider: () => token,
});

let server: Awaited<ReturnType<typeof startGuardrailHttpServer>> | undefined;
try {
  console.log('Backend API integration (Node HTTP + temporary SQLite; synthetic in-memory token verifier)');
  server = await startGuardrailHttpServer({ tokenVerifier: verifier, databasePath, port: 0 });
  const ward = api(server.address.port, 'synthetic-ward-token');
  const contact = api(server.address.port, 'synthetic-contact-token');
  const identity = await contact.getVerifiedIdentity();
  assert.equal(identity.success, true);
  if (!identity.success) throw new Error(identity.error.message);
  assert.deepEqual(identity.data, { actorId: contactId, role: ActorRole.TRUSTED_CONTACT },
    'identity discovery returns only the authenticated server-mapped identity');

  const live = await fetch(`http://127.0.0.1:${server.address.port}/health`);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'ok' });
  const ready = await fetch(`http://127.0.0.1:${server.address.port}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });
  const healthCors = await fetch(`http://127.0.0.1:${server.address.port}/ready`, {
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(healthCors.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const deniedHealthCors = await fetch(`http://127.0.0.1:${server.address.port}/ready`, {
    headers: { Origin: 'https://unlisted.example.test' },
  });
  assert.equal(deniedHealthCors.headers.get('access-control-allow-origin'), null);
  const malformedRequest = await fetch(`http://127.0.0.1:${server.address.port}/api/v1/approval-requests`, {
    method: 'POST',
    headers: { Authorization: 'Bearer synthetic-ward-token', 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformedRequest.status, 400);
  const malformedBody = await malformedRequest.text();
  assert.equal(malformedBody.includes(' at '), false, 'client error response does not expose a stack trace');
  assert.equal(malformedBody.includes('synthetic-ward-token'), false, 'client error response does not echo credentials');
  const unauthenticatedRequest = await fetch(`http://127.0.0.1:${server.address.port}/api/v1/invitations`, {
    method: 'GET',
  });
  assert.equal(unauthenticatedRequest.status, 401, 'approval API rejects unauthenticated requests');

  const inviteResult = await ward.createInvitation({ recipientActorId: contactId, relationshipLabel: 'Synthetic reviewer', customCode: 'GR-INV-ABCD-EFGH' });
  assert.equal(inviteResult.success, true);
  if (!inviteResult.success) throw new Error(inviteResult.error.message);
  assert.equal(inviteResult.data.status, 'PENDING');
  assert.equal(inviteResult.data.recipientActorId, contactId);
  assert.notEqual(contactId, otherContactId);
  assert.equal((await ward.createInvitation({ recipientActorId: outsiderId })).success, false,
    'a normal user identity cannot be designated as a trusted-contact recipient');
  assert.equal(ward.getServiceType(), 'live', 'persistent HTTP API identifies as live service');
  const leakedInvitation = await contact.getInvitation(inviteResult.data.code);
  assert.equal(leakedInvitation.success, true, 'the intended verified recipient may preview the invitation');
  const otherContact = api(server.address.port, 'synthetic-other-contact-token');
  assert.equal((await otherContact.getInvitation(inviteResult.data.code)).success, false, 'another trusted contact cannot preview a targeted invitation');
  assert.equal((await otherContact.acceptInvitation(inviteResult.data.code)).success, false, 'another trusted contact cannot accept a targeted invitation');
  const outsiderBeforeRestart = api(server.address.port, 'synthetic-outsider-token');
  assert.equal((await outsiderBeforeRestart.getInvitation(inviteResult.data.code)).success, false, 'unrelated user cannot preview a targeted invitation');
  assert.equal((await outsiderBeforeRestart.acceptInvitation(inviteResult.data.code)).success, false, 'unrelated user cannot accept an invitation');

  const accepted = await contact.acceptInvitation(inviteResult.data.code);
  assert.equal(accepted.success, true);
  if (!accepted.success) throw new Error(accepted.error.message);
  assert.equal(accepted.data.contact.status, 'ACTIVE');
  assert.equal(accepted.data.invitation.recipientActorId, contactId);
  await server.close();
  server = undefined;

  // Relationship and invitation survive a backend restart against the same SQLite file.
  server = await startGuardrailHttpServer({ tokenVerifier: verifier, databasePath, port: 0 });
  const wardAfterRestart = api(server.address.port, 'synthetic-ward-token');
  const contactAfterRestart = api(server.address.port, 'synthetic-contact-token');
  const outsiderAfterRestart = api(server.address.port, 'synthetic-outsider-token');
  const contacts = await wardAfterRestart.listTrustedContacts();
  assert.equal(contacts.success, true);
  if (!contacts.success) throw new Error(contacts.error.message);
  assert.equal(contacts.data.length, 1);
  const invitationList = await wardAfterRestart.listInvitations();
  assert.equal(invitationList.success, true);
  if (!invitationList.success) throw new Error(invitationList.error.message);
  assert.equal(invitationList.data[0]?.status, 'ACCEPTED');
  const outsiderInvitations = await outsiderAfterRestart.listInvitations();
  assert.equal(outsiderInvitations.success, true);
  if (!outsiderInvitations.success) throw new Error(outsiderInvitations.error.message);
  assert.equal(outsiderInvitations.data.length, 0, 'invitation list is scoped to authenticated owner');
  const unauthorizedRevoke = await outsiderAfterRestart.revokeInvitation(invitationList.data[0]!.id);
  assert.equal(unauthorizedRevoke.success, false, 'another user cannot revoke the issuer invitation');

  const created = await wardAfterRestart.createApprovalRequest({
    actionId: 'act_http_api_test', actionDescription: 'Synthetic controlled test action',
    actionType: ActionType.CLICK, riskLevel: RiskLevel.HIGH, riskReasons: ['Synthetic test only'],
    origin: 'https://example.test', hostname: 'example.test',
  });
  assert.equal(created.success, true);
  if (!created.success) throw new Error(created.error.message);
  assert.equal(created.data.status, ApprovalStatus.PENDING);

  const pending = await contactAfterRestart.listPendingApprovals();
  assert.equal(pending.success, true);
  if (!pending.success) throw new Error(pending.error.message);
  assert.equal(pending.data.length, 1);
  assert.equal(pending.data[0]?.id, created.data.id);
  const outsiderPending = await outsiderAfterRestart.listPendingApprovals();
  assert.equal(outsiderPending.success, false, 'non-reviewer role cannot use the reviewer queue endpoint');

  const decision = await contactAfterRestart.submitDecision(created.data.id, { decision: 'APPROVED' });
  assert.equal(decision.success, true);
  if (!decision.success) throw new Error(decision.error.message);
  assert.equal(decision.data.status, ApprovalStatus.APPROVED);
  const persisted = await wardAfterRestart.getApprovalRequest(created.data.id);
  assert.equal(persisted.success, true);
  if (!persisted.success) throw new Error(persisted.error.message);
  assert.equal(persisted.data.status, ApprovalStatus.APPROVED);
  const outsiderRecord = await outsiderAfterRestart.getApprovalRequest(created.data.id);
  assert.equal(outsiderRecord.success, false, 'unrelated user cannot retrieve an approval by its identifier');

  const rejectedRequest = await wardAfterRestart.createApprovalRequest({
    actionId: 'act_http_api_test_reject', actionDescription: 'Synthetic rejected action',
    actionType: ActionType.CLICK, riskLevel: RiskLevel.HIGH, riskReasons: ['Synthetic test only'],
    origin: 'https://example.test', hostname: 'example.test',
  });
  assert.equal(rejectedRequest.success, true);
  if (!rejectedRequest.success) throw new Error(rejectedRequest.error.message);
  const rejection = await contactAfterRestart.submitDecision(rejectedRequest.data.id, { decision: 'REJECTED' });
  assert.equal(rejection.success, true);
  if (!rejection.success) throw new Error(rejection.error.message);
  assert.equal(rejection.data.status, ApprovalStatus.REJECTED);

  const expiring = await wardAfterRestart.createInvitation({ recipientActorId: otherContactId, customCode: 'GR-INV-IJKL-MNOP', ttlMs: 1 });
  assert.equal(expiring.success, true);
  if (!expiring.success) throw new Error(expiring.error.message);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const invitationStates = await wardAfterRestart.listInvitations();
  assert.equal(invitationStates.success, true);
  if (!invitationStates.success) throw new Error(invitationStates.error.message);
  assert.equal(invitationStates.data.find((item) => item.id === expiring.data.id)?.status, 'EXPIRED');
  assert.equal(invitationStates.data.find((item) => item.id === expiring.data.id)?.expiredAt,
    invitationStates.data.find((item) => item.id === expiring.data.id)?.expiresAt,
    'expiration timestamp is persisted with the invitation');
  const otherContactAfterRestart = api(server.address.port, 'synthetic-other-contact-token');
  const expiredAccept = await otherContactAfterRestart.acceptInvitation(expiring.data.code);
  assert.equal(expiredAccept.success, false, 'expired invitation cannot be accepted');
  const revoked = await wardAfterRestart.createInvitation({ recipientActorId: otherContactId, customCode: 'GR-INV-QRST-UVWX' });
  assert.equal(revoked.success, true);
  if (!revoked.success) throw new Error(revoked.error.message);
  const revokedResult = await wardAfterRestart.revokeInvitation(revoked.data.id);
  assert.equal(revokedResult.success, true);
  if (!revokedResult.success) throw new Error(revokedResult.error.message);
  assert.equal(revokedResult.data.status, 'REVOKED');
  assert.ok(revokedResult.data.revokedAt, 'invitation revocation timestamp is returned');
  const revokedAccept = await otherContactAfterRestart.acceptInvitation(revoked.data.code);
  assert.equal(revokedAccept.success, false, 'revoked invitation cannot be accepted');

  const duplicateInvite = await wardAfterRestart.createInvitation({ recipientActorId: contactId });
  assert.equal(duplicateInvite.success, true);
  if (!duplicateInvite.success) throw new Error(duplicateInvite.error.message);
  assert.equal((await contactAfterRestart.acceptInvitation(duplicateInvite.data.code)).success, false,
    'a second invitation cannot create a duplicate active relationship');

  const pendingAfterRevocation = await wardAfterRestart.createApprovalRequest({
    actionId: 'act_http_api_after_revoke', actionDescription: 'Synthetic pending action',
    actionType: ActionType.CLICK, riskLevel: RiskLevel.HIGH, riskReasons: ['Synthetic test only'],
    origin: 'https://example.test', hostname: 'example.test',
  });
  assert.equal(pendingAfterRevocation.success, true);
  const revokedRelationship = await wardAfterRestart.revokeTrustedContact(contactId);
  assert.equal(revokedRelationship.success, true, 'owner can revoke the active relationship');
  const auditDb = new Database(databasePath, { readonly: true });
  try {
    const contactRecord = auditDb.prepare('SELECT payload_json FROM trusted_contacts WHERE user_id=? AND id=?')
      .get(wardId, contactId) as { payload_json: string } | undefined;
    assert.ok(contactRecord, 'revoked relationship remains as an audit record');
    const storedContact = JSON.parse(contactRecord.payload_json) as { status: string; createdAt: string; revokedAt?: string };
    assert.equal(storedContact.status, 'REVOKED');
    assert.ok(storedContact.createdAt && storedContact.revokedAt, 'relationship lifecycle timestamps are retained');
  } finally {
    auditDb.close();
  }
  const noLongerAssigned = await contactAfterRestart.listPendingApprovals();
  assert.equal(noLongerAssigned.success, true);
  if (!noLongerAssigned.success) throw new Error(noLongerAssigned.error.message);
  assert.equal(noLongerAssigned.data.length, 0, 'revoked reviewer immediately loses queue access');
  if (pendingAfterRevocation.success) {
    assert.equal((await contactAfterRestart.submitDecision(pendingAfterRevocation.data.id, { decision: 'APPROVED' })).success, false,
      'revoked reviewer cannot decide an assigned request');
  }

  const outsider = new ApprovalApiClient({ baseUrl: `http://127.0.0.1:${server.address.port}`, environment: 'test', tokenProvider: () => 'bad-token' });
  const denied = await outsider.listPendingApprovals();
  assert.equal(denied.success, false, 'invalid credentials do not retrieve approval data');
  console.log('PASS: invite ownership, acceptance, expiration, revocation, durable relationship, pending retrieval, approve/reject, and persisted status over HTTP');
  console.log('PASS: invalid token rejected; test auth is synthetic and not a live identity provider');
} finally {
  if (server) await server.close();
  identityStore.close();
  rmSync(root, { recursive: true, force: true });
}
