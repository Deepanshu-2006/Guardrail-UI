/**
 * Guardrail Approval Server-Side Authorization Verification Suite
 *
 * Verifies:
 * 1. Authorized Reviewer:
 *    - An active, designated trusted contact can view and decide (approve/reject) pending requests.
 *    - Authorized contacts can list pending requests for their assigned wards.
 * 2. Unrelated Authenticated User (Multi-Tenant Isolation & Anti-Enumeration):
 *    - Unrelated users cannot view, decide, or cancel another user's request.
 *    - Guessing / probing request IDs returns opaque 404 ApprovalAccessDeniedError (no existence oracle).
 * 3. Unauthenticated Request:
 *    - Invocations lacking valid authentication credentials are systematically rejected with 401 UnauthenticatedError.
 * 4. Unauthorized Requester:
 *    - Users cannot create approval requests for actions belonging to other users.
 *    - Client-supplied requester IDs or spoofed user IDs are rejected.
 *    - Users cannot cancel requests created by other users.
 * 5. Self-Approval Handling (Separation of Duties):
 *    - Users cannot approve or reject their own requests (SelfApprovalProhibitedError).
 *    - Self-approval is rejected even if the user designates themselves in the trusted contact registry.
 * 6. Zero Client Trust for Identities:
 *    - Requester ID and approver ID are strictly derived from the authenticated server context.
 * 7. Inactive / Revoked Contacts:
 *    - Contacts in PENDING_INVITE or REVOKED status cannot inspect or decide requests.
 * 8. System Administrator Privileges:
 *    - Admins can inspect, decide, and cancel requests.
 * 9. Safe Error Responses:
 *    - Error responses never disclose private information or existence of unowned resources.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionCategory, ActionType } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import {
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import {
  ApprovalLifecycleManager,
} from './lifecycle.js';
import {
  ApprovalValidationError,
} from './model.js';
import {
  ActorRole,
  ApprovalAccessDeniedError,
  ApprovalAuthorizationService,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  SelfApprovalProhibitedError,
  TrustedContactStatus,
  UnauthenticatedError,
  UnauthorizedActionRequesterError,
} from './authorization.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAILED: ${message}`);
    process.exitCode = 1;
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalTests++;
  if (actual === expected) {
    passedTests++;
    console.log(`  ✓ ${message}: ${String(actual)}`);
  } else {
    console.error(`  ✗ FAILED: ${message}. Expected "${String(expected)}", received "${String(actual)}"`);
    process.exitCode = 1;
  }
}

console.log('\n============================================================');
console.log('🧪 GUARDRAIL APPROVAL SERVER-SIDE AUTHORIZATION TEST SUITE');
console.log('============================================================\n');

// Standard test fixtures
const ALICE_AUTH: AuthContext = Object.freeze({
  actorId: 'usr_alice',
  role: ActorRole.USER,
  isAuthenticated: true,
  sessionId: 'ses_alice_123',
});

const BOB_CONTACT_AUTH: AuthContext = Object.freeze({
  actorId: 'tc_bob',
  role: ActorRole.TRUSTED_CONTACT,
  isAuthenticated: true,
  sessionId: 'ses_bob_456',
});

const CHARLIE_CONTACT_AUTH: AuthContext = Object.freeze({
  actorId: 'tc_charlie',
  role: ActorRole.TRUSTED_CONTACT,
  isAuthenticated: true,
  sessionId: 'ses_charlie_789',
});

const MALLORY_UNRELATED_AUTH: AuthContext = Object.freeze({
  actorId: 'usr_mallory',
  role: ActorRole.USER,
  isAuthenticated: true,
  sessionId: 'ses_mallory_999',
});

const ADMIN_AUTH: AuthContext = Object.freeze({
  actorId: 'usr_admin',
  role: ActorRole.ADMIN,
  isAuthenticated: true,
  sessionId: 'ses_admin_000',
});

const UNAUTHENTICATED_AUTH: AuthContext = Object.freeze({
  actorId: '',
  role: ActorRole.USER,
  isAuthenticated: false,
});

function createSamplePayload(actionId: string = 'act_payment_001'): ClientApprovalRequestPayload {
  return {
    actionId,
    actionDescription: 'Confirm bank transfer of $500',
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.HIGH,
    riskScore: 85,
    riskReasons: ['External financial transfer exceeding $100 threshold'],
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    pageTitle: 'Confirm Transfer',
  };
}

function setupTestEnvironment() {
  const lifecycle = new ApprovalLifecycleManager();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnership = new InMemoryActionOwnershipRegistry();

  // Designate Bob as an ACTIVE trusted contact for Alice
  contactRegistry.addContact({
    id: 'tc_bob',
    userId: 'usr_alice',
    relationshipLabel: 'Guardian',
    status: TrustedContactStatus.ACTIVE,
    createdAt: '2026-10-18T10:00:00.000Z',
  });

  // Designate Charlie as a PENDING_INVITE contact for Alice
  contactRegistry.addContact({
    id: 'tc_charlie',
    userId: 'usr_alice',
    relationshipLabel: 'Sibling',
    status: TrustedContactStatus.PENDING_INVITE,
    createdAt: '2026-10-18T10:00:00.000Z',
  });

  const service = new ApprovalAuthorizationService(lifecycle, contactRegistry, actionOwnership);

  return { service, lifecycle, contactRegistry, actionOwnership };
}

// -----------------------------------------------------------------------------
// Test Suite 1: Authorized Reviewer (Trusted Contact)
// -----------------------------------------------------------------------------
console.log('--- Test Suite 1: Authorized Reviewer Operations ---');

{
  const { service } = setupTestEnvironment();

  // 1. Alice creates a valid request
  const req = service.createRequest(createSamplePayload('act_alice_01'), ALICE_AUTH);
  assertEquals(req.status, ApprovalStatus.PENDING, 'Request created in PENDING state');
  assertEquals(req.requesterId, 'usr_alice', 'Requester identity bound authoritatively to Alice');

  // 2. Bob (active trusted contact for Alice) can view the request
  const viewedByBob = service.getRequest(req.id, BOB_CONTACT_AUTH);
  assertEquals(viewedByBob.id, req.id, 'Authorized trusted contact Bob can view pending request');

  // 3. Bob can approve the request
  const approvedReq = service.submitDecision(
    req.id,
    { decision: 'APPROVED', decisionReason: 'Transfer verified by phone call' },
    BOB_CONTACT_AUTH
  );
  assertEquals(approvedReq.status, ApprovalStatus.APPROVED, 'Authorized contact can approve request');
  assertEquals(approvedReq.decision?.decidedBy, 'tc_bob', 'Decision metadata records Bob as decision maker');
  assertEquals(approvedReq.decision?.decisionReason, 'Transfer verified by phone call', 'Decision note recorded');
}

{
  const { service } = setupTestEnvironment();

  // Bob can reject a request
  const req = service.createRequest(createSamplePayload('act_alice_02'), ALICE_AUTH);
  const rejectedReq = service.submitDecision(
    req.id,
    { decision: 'REJECTED', decisionReason: 'Unrecognized vendor' },
    BOB_CONTACT_AUTH
  );
  assertEquals(rejectedReq.status, ApprovalStatus.REJECTED, 'Authorized contact can reject request');
  assertEquals(rejectedReq.decision?.decidedBy, 'tc_bob', 'Decision metadata records Bob');
}

{
  const { service } = setupTestEnvironment();

  // Bob can list pending requests for his assigned wards
  service.createRequest(createSamplePayload('act_alice_03'), ALICE_AUTH);
  service.createRequest(createSamplePayload('act_alice_04'), ALICE_AUTH);

  const bobsPending = service.listPendingRequestsForContact(BOB_CONTACT_AUTH);
  assertEquals(bobsPending.length, 2, 'Bob sees 2 pending requests for his ward Alice');
  assert(
    bobsPending.every((r) => r.requesterId === 'usr_alice'),
    'All pending requests belong to ward Alice'
  );
}

// -----------------------------------------------------------------------------
// Test Suite 2: Unrelated Authenticated User & Anti-Enumeration Protection
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 2: Unrelated User & Anti-Enumeration Protections ---');

{
  const { service } = setupTestEnvironment();
  const req = service.createRequest(createSamplePayload('act_alice_05'), ALICE_AUTH);

  // 1. Mallory (unrelated user) attempts to view Alice's request
  let errorCaught = false;
  try {
    service.getRequest(req.id, MALLORY_UNRELATED_AUTH);
  } catch (err) {
    errorCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Unrelated user viewing request throws ApprovalAccessDeniedError');
    assertEquals((err as ApprovalAccessDeniedError).statusCode, 404, 'Error status code is 404 Not Found');
  }
  assert(errorCaught, 'Unrelated user viewing Alice request was blocked');

  // 2. Mallory attempts to decide Alice's request
  errorCaught = false;
  try {
    service.submitDecision(req.id, { decision: 'APPROVED' }, MALLORY_UNRELATED_AUTH);
  } catch (err) {
    errorCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Unrelated user deciding request throws ApprovalAccessDeniedError');
  }
  assert(errorCaught, 'Unrelated user decision attempt was blocked');

  // 3. Mallory attempts to cancel Alice's request
  errorCaught = false;
  try {
    service.cancelRequest(req.id, MALLORY_UNRELATED_AUTH, 'Cancelled by attacker');
  } catch (err) {
    errorCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Unrelated user cancelling request throws ApprovalAccessDeniedError');
  }
  assert(errorCaught, 'Unrelated user cancellation attempt was blocked');

  // 4. Probing / Guessing non-existent ID vs unowned ID produces identical opaque error
  let probeRealUnownedError: ApprovalAccessDeniedError | undefined;
  let probeFakeIdError: ApprovalAccessDeniedError | undefined;

  try {
    service.getRequest(req.id, MALLORY_UNRELATED_AUTH);
  } catch (err) {
    probeRealUnownedError = err as ApprovalAccessDeniedError;
  }

  try {
    service.getRequest('apr_non_existent_999999', MALLORY_UNRELATED_AUTH);
  } catch (err) {
    probeFakeIdError = err as ApprovalAccessDeniedError;
  }

  assert(probeRealUnownedError !== undefined, 'Real unowned request throws error');
  assert(probeFakeIdError !== undefined, 'Fake request ID throws error');
  assertEquals(
    probeRealUnownedError?.message,
    probeFakeIdError?.message,
    'Opaque error message is identical for unowned request and non-existent request (anti-enumeration)'
  );
  assertEquals(
    probeRealUnownedError?.statusCode,
    probeFakeIdError?.statusCode,
    'Status code is identical 404 for unowned request and non-existent request'
  );
}

// -----------------------------------------------------------------------------
// Test Suite 3: Unauthenticated Requests (401 Rejections)
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 3: Unauthenticated Invocations (401) ---');

{
  const { service } = setupTestEnvironment();
  const req = service.createRequest(createSamplePayload('act_alice_06'), ALICE_AUTH);

  // createRequest without authentication
  let unauthCaught = false;
  try {
    service.createRequest(createSamplePayload('act_anon'), UNAUTHENTICATED_AUTH);
  } catch (err) {
    unauthCaught = true;
    assert(err instanceof UnauthenticatedError, 'Unauthenticated createRequest throws UnauthenticatedError');
    assertEquals((err as UnauthenticatedError).statusCode, 401, 'UnauthenticatedError has 401 status code');
  }
  assert(unauthCaught, 'Unauthenticated createRequest was blocked');

  // getRequest without authentication
  unauthCaught = false;
  try {
    service.getRequest(req.id, UNAUTHENTICATED_AUTH);
  } catch (err) {
    unauthCaught = true;
    assert(err instanceof UnauthenticatedError, 'Unauthenticated getRequest throws UnauthenticatedError');
  }
  assert(unauthCaught, 'Unauthenticated getRequest was blocked');

  // submitDecision without authentication
  unauthCaught = false;
  try {
    service.submitDecision(req.id, { decision: 'APPROVED' }, UNAUTHENTICATED_AUTH);
  } catch (err) {
    unauthCaught = true;
    assert(err instanceof UnauthenticatedError, 'Unauthenticated submitDecision throws UnauthenticatedError');
  }
  assert(unauthCaught, 'Unauthenticated submitDecision was blocked');

  // cancelRequest without authentication
  unauthCaught = false;
  try {
    service.cancelRequest(req.id, UNAUTHENTICATED_AUTH);
  } catch (err) {
    unauthCaught = true;
    assert(err instanceof UnauthenticatedError, 'Unauthenticated cancelRequest throws UnauthenticatedError');
  }
  assert(unauthCaught, 'Unauthenticated cancelRequest was blocked');

  // listRequestsForRequester without authentication
  unauthCaught = false;
  try {
    service.listRequestsForRequester(UNAUTHENTICATED_AUTH);
  } catch (err) {
    unauthCaught = true;
    assert(err instanceof UnauthenticatedError, 'Unauthenticated listRequests throws UnauthenticatedError');
  }
  assert(unauthCaught, 'Unauthenticated listRequests was blocked');

  // Empty string actorId with isAuthenticated: true is also rejected
  const fakeAuth: AuthContext = { actorId: '   ', role: ActorRole.USER, isAuthenticated: true };
  unauthCaught = false;
  try {
    service.getRequest(req.id, fakeAuth);
  } catch (err) {
    unauthCaught = true;
    assert(err instanceof UnauthenticatedError, 'Whitespace-only actorId throws UnauthenticatedError');
  }
  assert(unauthCaught, 'Blank actorId was blocked');
}

// -----------------------------------------------------------------------------
// Test Suite 4: Unauthorized Requester & Action Ownership
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 4: Unauthorized Requester & Action Ownership ---');

{
  const { service, actionOwnership } = setupTestEnvironment();

  // 1. Action act_alice_private is pre-registered to Alice
  actionOwnership.registerActionOwnership('act_alice_private', 'usr_alice');

  // 2. Mallory attempts to create a request for Alice's action
  let caught = false;
  try {
    service.createRequest(createSamplePayload('act_alice_private'), MALLORY_UNRELATED_AUTH);
  } catch (err) {
    caught = true;
    assert(
      err instanceof UnauthorizedActionRequesterError,
      'Attempt to create request for another user action throws UnauthorizedActionRequesterError'
    );
    assertEquals((err as UnauthorizedActionRequesterError).statusCode, 403, 'Error has 403 status code');
    assertEquals((err as UnauthorizedActionRequesterError).actorId, 'usr_mallory', 'Records unauthorized actor ID');
    assertEquals((err as UnauthorizedActionRequesterError).actionId, 'act_alice_private', 'Records action ID');
  }
  assert(caught, 'Mallory was blocked from creating a request for Alice action');

  // 3. Alice creates request for act_alice_auto
  service.createRequest(createSamplePayload('act_alice_auto'), ALICE_AUTH);
  // Ownership is automatically registered to Alice
  assertEquals(
    actionOwnership.getActionOwner('act_alice_auto'),
    'usr_alice',
    'Action ownership is registered to Alice upon creation'
  );

  // 4. Mallory tries to submit another request for act_alice_auto
  caught = false;
  try {
    service.createRequest(createSamplePayload('act_alice_auto'), MALLORY_UNRELATED_AUTH);
  } catch (err) {
    caught = true;
    assert(
      err instanceof UnauthorizedActionRequesterError,
      'Second user claiming already-claimed action throws UnauthorizedActionRequesterError'
    );
  }
  assert(caught, 'Mallory cannot steal Alice claimed action');

  // 5. Client payload attempting to pass a spoofed userId
  caught = false;
  try {
    const maliciousPayload = {
      ...createSamplePayload('act_mallory_01'),
      userId: 'usr_alice', // Mallory pretends to be Alice
    };
    service.createRequest(maliciousPayload, MALLORY_UNRELATED_AUTH);
  } catch (err) {
    caught = true;
    assert(
      err instanceof UnauthorizedActionRequesterError,
      'Payload containing conflicting userId throws UnauthorizedActionRequesterError'
    );
  }
  assert(caught, 'Spoofed userId in payload was blocked');

  // 6. Client payload attempting to pass a spoofed requesterId is rejected by model validator
  caught = false;
  try {
    const maliciousPayload = {
      ...createSamplePayload('act_mallory_02'),
      requesterId: 'usr_alice',
    };
    service.createRequest(maliciousPayload as any, MALLORY_UNRELATED_AUTH);
  } catch (err) {
    caught = true;
    assert(
      err instanceof ApprovalValidationError,
      'Payload attempting to specify requesterId throws ApprovalValidationError'
    );
  }
  assert(caught, 'Spoofed requesterId in payload was rejected');
}

// -----------------------------------------------------------------------------
// Test Suite 5: Self-Approval Prevention (Separation of Duties)
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 5: Self-Approval Prevention ---');

{
  const { service, contactRegistry } = setupTestEnvironment();

  // 1. Alice creates a request
  const req = service.createRequest(createSamplePayload('act_alice_07'), ALICE_AUTH);

  // 2. Alice attempts to approve her own request
  let selfApproveCaught = false;
  try {
    service.submitDecision(
      req.id,
      { decision: 'APPROVED', decisionReason: 'Self-authorizing my transfer' },
      ALICE_AUTH
    );
  } catch (err) {
    selfApproveCaught = true;
    assert(err instanceof SelfApprovalProhibitedError, 'Self-approval throws SelfApprovalProhibitedError');
    assertEquals((err as SelfApprovalProhibitedError).statusCode, 403, 'SelfApprovalProhibitedError has 403 status code');
    assertEquals((err as SelfApprovalProhibitedError).actorId, 'usr_alice', 'Error identifies acting requester');
    assertEquals((err as SelfApprovalProhibitedError).requestId, req.id, 'Error identifies target request');
  }
  assert(selfApproveCaught, 'Self-approval was rejected');

  // 3. Alice attempts to reject her own request via decision endpoint (must use cancellation instead)
  let selfRejectCaught = false;
  try {
    service.submitDecision(
      req.id,
      { decision: 'REJECTED', decisionReason: 'Deciding to reject myself' },
      ALICE_AUTH
    );
  } catch (err) {
    selfRejectCaught = true;
    assert(err instanceof SelfApprovalProhibitedError, 'Self-rejection via decision throws SelfApprovalProhibitedError');
  }
  assert(selfRejectCaught, 'Self-rejection via reviewer endpoint was blocked');

  // 4. Separation of duties holds even if Alice designates herself as a trusted contact in the registry
  contactRegistry.addContact({
    id: 'usr_alice',
    userId: 'usr_alice',
    relationshipLabel: 'Self',
    status: TrustedContactStatus.ACTIVE,
    createdAt: '2026-10-18T10:00:00.000Z',
  });

  let registryBypassCaught = false;
  try {
    service.submitDecision(req.id, { decision: 'APPROVED' }, ALICE_AUTH);
  } catch (err) {
    registryBypassCaught = true;
    assert(
      err instanceof SelfApprovalProhibitedError,
      'Self-approval is blocked even when user is registered in contact registry'
    );
  }
  assert(registryBypassCaught, 'Registry bypass self-approval was blocked');
}

// -----------------------------------------------------------------------------
// Test Suite 6: Zero Client Trust for Identities
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 6: Zero Client Trust for Identities ---');

{
  const { service } = setupTestEnvironment();

  // 1. Requester identity is always server-derived
  const req = service.createRequest(createSamplePayload('act_alice_08'), ALICE_AUTH);
  assertEquals(req.requesterId, 'usr_alice', 'Requester identity matches authContext.actorId');

  // 2. Client-supplied decidedBy in submitDecision is strictly overwritten by server actorId
  const approved = service.submitDecision(
    req.id,
    {
      decision: 'APPROVED',
      decidedBy: 'tc_fake_spoofed_approver', // Client tries to spoof approver name
      decisionReason: 'Legitimate decision',
    },
    BOB_CONTACT_AUTH
  );

  assertEquals(
    approved.decision?.decidedBy,
    'tc_bob',
    'Client-supplied decidedBy is completely overwritten by authenticated server identity tc_bob'
  );
}

// -----------------------------------------------------------------------------
// Test Suite 7: Inactive & Revoked Trusted Contacts
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 7: Inactive & Revoked Contacts ---');

{
  const { service, contactRegistry } = setupTestEnvironment();
  const req = service.createRequest(createSamplePayload('act_alice_09'), ALICE_AUTH);

  // 1. Charlie has PENDING_INVITE status
  let inviteCaught = false;
  try {
    service.getRequest(req.id, CHARLIE_CONTACT_AUTH);
  } catch (err) {
    inviteCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Contact with PENDING_INVITE cannot view request');
  }
  assert(inviteCaught, 'PENDING_INVITE contact was blocked from viewing');

  inviteCaught = false;
  try {
    service.submitDecision(req.id, { decision: 'APPROVED' }, CHARLIE_CONTACT_AUTH);
  } catch (err) {
    inviteCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Contact with PENDING_INVITE cannot decide request');
  }
  assert(inviteCaught, 'PENDING_INVITE contact was blocked from deciding');

  // 2. Revoke Bob's relationship
  contactRegistry.updateStatus('tc_bob', TrustedContactStatus.REVOKED);

  let revokedCaught = false;
  try {
    service.submitDecision(req.id, { decision: 'APPROVED' }, BOB_CONTACT_AUTH);
  } catch (err) {
    revokedCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Contact with REVOKED status cannot decide request');
  }
  assert(revokedCaught, 'REVOKED contact was blocked from deciding');

  // Bob's pending list is now empty
  const bobsPending = service.listPendingRequestsForContact(BOB_CONTACT_AUTH);
  assertEquals(bobsPending.length, 0, 'REVOKED contact sees 0 pending requests');
}

// -----------------------------------------------------------------------------
// Test Suite 8: Request Owner Operations (Cancellation & Viewing)
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 8: Request Owner Operations ---');

{
  const { service, contactRegistry } = setupTestEnvironment();
  contactRegistry.updateStatus('tc_bob', TrustedContactStatus.ACTIVE);

  const req = service.createRequest(createSamplePayload('act_alice_10'), ALICE_AUTH);

  // 1. Alice (owner) can view her own request
  const viewedByAlice = service.getRequest(req.id, ALICE_AUTH);
  assertEquals(viewedByAlice.id, req.id, 'Alice can view her own request');

  // 2. Trusted contact Bob CANNOT cancel Alice's request (only user or admin can cancel)
  let contactCancelCaught = false;
  try {
    service.cancelRequest(req.id, BOB_CONTACT_AUTH, 'Contact tried to cancel');
  } catch (err) {
    contactCancelCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Trusted contact cannot cancel user request');
  }
  assert(contactCancelCaught, 'Contact cancellation was blocked');

  // 3. Alice can cancel her own request
  const cancelled = service.cancelRequest(req.id, ALICE_AUTH, 'User aborted checkout');
  assertEquals(cancelled.status, ApprovalStatus.CANCELLED, 'Alice successfully cancelled her own request');
  assertEquals(cancelled.cancellationReason, 'User aborted checkout', 'Cancellation reason is stored');
}

// -----------------------------------------------------------------------------
// Test Suite 9: Administrator Privileges
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 9: Administrator Role Privileges ---');

{
  const { service } = setupTestEnvironment();

  // Admin can view Alice's request
  const req1 = service.createRequest(createSamplePayload('act_alice_11'), ALICE_AUTH);
  const viewedByAdmin = service.getRequest(req1.id, ADMIN_AUTH);
  assertEquals(viewedByAdmin.id, req1.id, 'Admin can view any approval request');

  // Admin can decide Alice's request
  const decidedByAdmin = service.submitDecision(
    req1.id,
    { decision: 'APPROVED', decisionReason: 'Admin emergency override' },
    ADMIN_AUTH
  );
  assertEquals(decidedByAdmin.status, ApprovalStatus.APPROVED, 'Admin can decide approval request');
  assertEquals(decidedByAdmin.decision?.decidedBy, 'usr_admin', 'Decision reflects admin identity');

  // Only the requesting user who owns the action can cancel it; admin cancellation is blocked
  const req2 = service.createRequest(createSamplePayload('act_alice_12'), ALICE_AUTH);
  let adminCancelCaught = false;
  try {
    service.cancelRequest(req2.id, ADMIN_AUTH, 'Administrative cancellation');
  } catch (err) {
    adminCancelCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Admin cannot cancel user request');
  }
  assert(adminCancelCaught, 'Admin cancellation attempt was blocked');
}

// -----------------------------------------------------------------------------
// Test Suite 10: Multi-Tenant List Isolation
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 10: Multi-Tenant List Isolation ---');

{
  const { service } = setupTestEnvironment();

  // Alice creates 2 requests
  service.createRequest(createSamplePayload('act_alice_13'), ALICE_AUTH);
  service.createRequest(createSamplePayload('act_alice_14'), ALICE_AUTH);

  // Mallory creates 1 request
  service.createRequest(createSamplePayload('act_mallory_03'), MALLORY_UNRELATED_AUTH);

  // Alice lists her requests
  const aliceList = service.listRequestsForRequester(ALICE_AUTH);
  assertEquals(aliceList.length, 2, 'Alice sees exactly her 2 requests');
  assert(
    aliceList.every((r) => r.requesterId === 'usr_alice'),
    'All requests returned for Alice belong to Alice'
  );

  // Mallory lists her requests
  const malloryList = service.listRequestsForRequester(MALLORY_UNRELATED_AUTH);
  assertEquals(malloryList.length, 1, 'Mallory sees exactly her 1 request');
  assertEquals(malloryList[0].requesterId, 'usr_mallory', 'Mallory request belongs to Mallory');
  assert(
    !malloryList.some((r) => r.requesterId === 'usr_alice'),
    'Mallory list contains zero requests belonging to Alice'
  );
}

// -----------------------------------------------------------------------------
// Test Suite 11: Safe Error Content & Privacy Whitelist
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 11: Safe Error Content & Non-Leakage ---');

{
  const accessDeniedErr = new ApprovalAccessDeniedError();
  assertEquals(accessDeniedErr.statusCode, 404, 'ApprovalAccessDeniedError has status 404');
  assert(
    !accessDeniedErr.message.includes('usr_'),
    'ApprovalAccessDeniedError message does not contain user identifiers'
  );
  assert(
    !accessDeniedErr.message.includes('apr_'),
    'ApprovalAccessDeniedError message does not contain request identifiers'
  );
  assert(
    !accessDeniedErr.message.includes('tc_'),
    'ApprovalAccessDeniedError message does not contain contact identifiers'
  );

  const unauthErr = new UnauthenticatedError();
  assertEquals(unauthErr.statusCode, 401, 'UnauthenticatedError has status 401');
  assert(
    unauthErr.message.includes('Authentication required'),
    'UnauthenticatedError has clear generic message'
  );

  const selfApproveErr = new SelfApprovalProhibitedError('usr_alice', 'apr_test_123');
  assertEquals(selfApproveErr.statusCode, 403, 'SelfApprovalProhibitedError has status 403');
  assert(
    selfApproveErr.message.includes('Separation of duties is strictly enforced'),
    'SelfApprovalProhibitedError explains separation of duties'
  );
}

// -----------------------------------------------------------------------------
// Test Summary
// -----------------------------------------------------------------------------
console.log('\n============================================================');
console.log(`📊 AUTHORIZATION TESTS SUMMARY: ${passedTests} / ${totalTests} PASSED`);
if (passedTests === totalTests) {
  console.log('🎉 ALL SERVER-SIDE AUTHORIZATION INVARIANTS VERIFIED!');
} else {
  console.error(`⚠️ ${totalTests - passedTests} TESTS FAILED!`);
}
console.log('============================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
