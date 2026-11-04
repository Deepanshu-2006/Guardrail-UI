import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryTokenVerifier } from '../../extension/src/approval/api.js';
import { ApprovalApiClient } from '../../extension/src/approval/client.js';
import { ActorRole } from '../../extension/src/approval/authorization.js';
import { ApprovalStatus } from '../../extension/src/types/approval.js';
import { ActionType } from '../../extension/src/types/actions.js';
import { RiskLevel } from '../../extension/src/types/risk.js';
import { startGuardrailHttpServer } from './http-server.js';

const root = mkdtempSync(join(tmpdir(), 'guardrail-api-integration-'));
const databasePath = join(root, 'pilot.sqlite');
const verifier = new InMemoryTokenVerifier();
verifier.registerToken('synthetic-ward-token', { actorId: 'usr_api_test', role: ActorRole.USER, isAuthenticated: true });
verifier.registerToken('synthetic-contact-token', { actorId: 'tc_api_test', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true });
verifier.registerToken('synthetic-outsider-token', { actorId: 'usr_api_outsider', role: ActorRole.USER, isAuthenticated: true });
const api = (port: number, token: string) => new ApprovalApiClient({
  baseUrl: `http://127.0.0.1:${port}`, environment: 'test', tokenProvider: () => token,
});

let server: Awaited<ReturnType<typeof startGuardrailHttpServer>> | undefined;
try {
  console.log('Backend API integration (Node HTTP + temporary SQLite; synthetic in-memory token verifier)');
  server = await startGuardrailHttpServer({ tokenVerifier: verifier, databasePath, port: 0 });
  const ward = api(server.address.port, 'synthetic-ward-token');
  const contact = api(server.address.port, 'synthetic-contact-token');

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

  const inviteResult = await ward.createInvitation({ relationshipLabel: 'Synthetic reviewer', customCode: 'GR-INV-ABCD-EFGH' });
  assert.equal(inviteResult.success, true);
  if (!inviteResult.success) throw new Error(inviteResult.error.message);
  assert.equal(inviteResult.data.status, 'PENDING');
  assert.equal(ward.getServiceType(), 'live', 'persistent HTTP API identifies as live service');
  const leakedInvitation = await contact.getInvitation(inviteResult.data.code);
  assert.equal(leakedInvitation.success, true, 'an authenticated invitee who possesses the out-of-band code may preview it');

  const accepted = await contact.acceptInvitation(inviteResult.data.code);
  assert.equal(accepted.success, true);
  if (!accepted.success) throw new Error(accepted.error.message);
  assert.equal(accepted.data.contact.status, 'ACTIVE');
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

  const expiring = await wardAfterRestart.createInvitation({ customCode: 'GR-INV-IJKL-MNOP', ttlMs: 1 });
  assert.equal(expiring.success, true);
  if (!expiring.success) throw new Error(expiring.error.message);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const invitationStates = await wardAfterRestart.listInvitations();
  assert.equal(invitationStates.success, true);
  if (!invitationStates.success) throw new Error(invitationStates.error.message);
  assert.equal(invitationStates.data.find((item) => item.id === expiring.data.id)?.status, 'EXPIRED');
  const expiredAccept = await contactAfterRestart.acceptInvitation(expiring.data.code);
  assert.equal(expiredAccept.success, false, 'expired invitation cannot be accepted');
  const revoked = await wardAfterRestart.createInvitation({ customCode: 'GR-INV-QRST-UVWX' });
  assert.equal(revoked.success, true);
  if (!revoked.success) throw new Error(revoked.error.message);
  const revokedResult = await wardAfterRestart.revokeInvitation(revoked.data.id);
  assert.equal(revokedResult.success, true);
  if (!revokedResult.success) throw new Error(revokedResult.error.message);
  assert.equal(revokedResult.data.status, 'REVOKED');
  const revokedAccept = await contactAfterRestart.acceptInvitation(revoked.data.code);
  assert.equal(revokedAccept.success, false, 'revoked invitation cannot be accepted');

  const outsider = new ApprovalApiClient({ baseUrl: `http://127.0.0.1:${server.address.port}`, environment: 'test', tokenProvider: () => 'bad-token' });
  const denied = await outsider.listPendingApprovals();
  assert.equal(denied.success, false, 'invalid credentials do not retrieve approval data');
  console.log('PASS: invite ownership, acceptance, expiration, revocation, durable relationship, pending retrieval, approve/reject, and persisted status over HTTP');
  console.log('PASS: invalid token rejected; test auth is synthetic and not a live identity provider');
} finally {
  if (server) await server.close();
  rmSync(root, { recursive: true, force: true });
}
