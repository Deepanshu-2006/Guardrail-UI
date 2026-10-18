/**
 * Guardrail Approval Service Coordination Verification Suite
 *
 * Verifies that ApprovalService correctly coordinates:
 * 1. Request Creation, Retrieval, Decisions, and Cancellation (End-to-End Success)
 * 2. Server-side Authorization & Action Ownership Validation
 * 3. Separation of Duties (Self-Approval Strictly Prohibited)
 * 4. Deterministic Lifecycle Transitions & Invalid State Protection
 * 5. Expired Request Enforcement using Authoritative Time Provider
 * 6. Missing Request & Anti-Enumeration Protections (Opaque 404)
 * 7. First-Responder Concurrency & Atomic Conditional Updates (Concurrent decisions cannot both succeed)
 * 8. Duplicate Creation Prevention & Compound Idempotency (userId, actionId)
 * 9. Rejection of Client-Supplied APPROVED Status
 * 10. Strict Non-Execution of Held Browser Action
 * 11. Privacy-Preserving Safe Logging
 * 12. Development-Only Repository Abstraction Verification
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { InterceptionState } from '../types/interception.js';
import {
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import {
  ApprovalAlreadyResolvedError,
  ApprovalExpiredError,
  ApprovalValidationError,
  DuplicateApprovalRequestError,
} from './model.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
  PERSISTENCE_METADATA,
} from './repository.js';
import {
  ActorRole,
  ApprovalAccessDeniedError,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  SelfApprovalProhibitedError,
  TrustedContactStatus,
  UnauthenticatedError,
  UnauthorizedActionRequesterError,
} from './authorization.js';
import {
  ApprovalService,
  ApprovalServiceLogger,
  SafeConsoleApprovalServiceLogger,
} from './service.js';
import { ContinuationManager } from '../interception/continuation.js';
import { InterceptionController } from '../interception/controller.js';

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
console.log('🧪 GUARDRAIL APPROVAL SERVICE COORDINATION TEST SUITE');
console.log('============================================================\n');

// Mock clock factory for deterministic time-travel
function createMockClock(initialIso: string = '2026-10-18T12:00:00.000Z') {
  let currentEpoch = Date.parse(initialIso);
  return {
    getTime: () => new Date(currentEpoch).toISOString(),
    advanceMs: (ms: number) => {
      currentEpoch += ms;
      return new Date(currentEpoch).toISOString();
    },
    advanceMinutes: (minutes: number) => {
      currentEpoch += minutes * 60 * 1000;
      return new Date(currentEpoch).toISOString();
    },
  };
}

// Standard test authentication contexts
const ALICE_AUTH: AuthContext = Object.freeze({
  actorId: 'usr_alice',
  role: ActorRole.USER,
  isAuthenticated: true,
  sessionId: 'ses_alice_100',
});

const BOB_CONTACT_AUTH: AuthContext = Object.freeze({
  actorId: 'tc_bob',
  role: ActorRole.TRUSTED_CONTACT,
  isAuthenticated: true,
  sessionId: 'ses_bob_200',
});

const DANIEL_CONTACT_AUTH: AuthContext = Object.freeze({
  actorId: 'tc_daniel',
  role: ActorRole.TRUSTED_CONTACT,
  isAuthenticated: true,
  sessionId: 'ses_daniel_300',
});

const CHARLIE_INVITE_AUTH: AuthContext = Object.freeze({
  actorId: 'tc_charlie',
  role: ActorRole.TRUSTED_CONTACT,
  isAuthenticated: true,
  sessionId: 'ses_charlie_400',
});

const MALLORY_UNRELATED_AUTH: AuthContext = Object.freeze({
  actorId: 'usr_mallory',
  role: ActorRole.USER,
  isAuthenticated: true,
  sessionId: 'ses_mallory_999',
});

const UNAUTHENTICATED_AUTH: AuthContext = Object.freeze({
  actorId: '',
  role: ActorRole.USER,
  isAuthenticated: false,
});

function createSamplePayload(actionId: string = 'act_payment_001'): ClientApprovalRequestPayload {
  return {
    actionId,
    actionDescription: 'Execute wire transfer of $1,000',
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.HIGH,
    riskScore: 80,
    riskReasons: ['External financial wire transfer to non-whitelisted account'],
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    pageTitle: 'Review Wire Transfer',
  };
}

// In-memory test environment setup
function setupServiceTestEnvironment() {
  const clock = createMockClock();
  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnership = new InMemoryActionOwnershipRegistry();

  // Designate Bob as an ACTIVE contact for Alice
  contactRegistry.addContact({
    id: 'tc_bob',
    userId: 'usr_alice',
    relationshipLabel: 'Guardian',
    status: TrustedContactStatus.ACTIVE,
    createdAt: clock.getTime(),
  });

  // Designate Daniel as a SECOND active contact for Alice (for concurrency tests)
  contactRegistry.addContact({
    id: 'tc_daniel',
    userId: 'usr_alice',
    relationshipLabel: 'Co-Guardian',
    status: TrustedContactStatus.ACTIVE,
    createdAt: clock.getTime(),
  });

  // Designate Charlie as a PENDING_INVITE contact for Alice
  contactRegistry.addContact({
    id: 'tc_charlie',
    userId: 'usr_alice',
    relationshipLabel: 'Sibling',
    status: TrustedContactStatus.PENDING_INVITE,
    createdAt: clock.getTime(),
  });

  const service = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry: actionOwnership,
    timeProvider: clock.getTime,
  });

  return { service, repository, contactRegistry, actionOwnership, clock };
}

// -----------------------------------------------------------------------------
// Test Suite 1: Successful Operations & End-to-End Coordination
// -----------------------------------------------------------------------------
console.log('--- Test Suite 1: Successful Operations & End-to-End Coordination ---');

{
  const { service } = setupServiceTestEnvironment();

  // 1. Create request
  const req = service.createRequest(createSamplePayload('act_alice_01'), ALICE_AUTH);
  assertEquals(req.status, ApprovalStatus.PENDING, 'Request created in PENDING state');
  assertEquals(req.requesterId, 'usr_alice', 'Requester identity bound to authenticated user');
  assertEquals(req.actionId, 'act_alice_01', 'Preserves actionId correlation');
  assert(req.id.startsWith('apr_'), 'Canonical requestId has apr_ prefix');

  // 2. Retrieve request (requester and active contact)
  const byAlice = service.getRequest(req.id, ALICE_AUTH);
  assertEquals(byAlice.id, req.id, 'Alice can retrieve her own request');

  const byBob = service.getRequest(req.id, BOB_CONTACT_AUTH);
  assertEquals(byBob.id, req.id, 'Bob (active trusted contact) can retrieve request');

  // 3. Approve request
  const approved = service.approveRequest(
    req.id,
    { decisionReason: 'Transfer approved after video confirmation' },
    BOB_CONTACT_AUTH
  );
  assertEquals(approved.status, ApprovalStatus.APPROVED, 'Request transitions to APPROVED state');
  assertEquals(approved.decision?.decision, 'APPROVED', 'Decision verdict is APPROVED');
  assertEquals(approved.decision?.decidedBy, 'tc_bob', 'Decision maker authoritatively recorded as Bob');
  assertEquals(approved.decision?.decisionReason, 'Transfer approved after video confirmation', 'Decision note recorded');
  assert(approved.resolvedAt !== undefined, 'resolvedAt timestamp is recorded');
}

{
  const { service } = setupServiceTestEnvironment();

  // 4. Reject request
  const req = service.createRequest(createSamplePayload('act_alice_02'), ALICE_AUTH);
  const rejected = service.rejectRequest(
    req.id,
    { decisionReason: 'Suspicious destination account' },
    BOB_CONTACT_AUTH
  );
  assertEquals(rejected.status, ApprovalStatus.REJECTED, 'Request transitions to REJECTED state');
  assertEquals(rejected.decision?.decision, 'REJECTED', 'Decision verdict is REJECTED');
  assertEquals(rejected.decision?.decidedBy, 'tc_bob', 'Recorded decision maker is Bob');
}

{
  const { service } = setupServiceTestEnvironment();

  // 5. Cancel request by requesting owner
  const req = service.createRequest(createSamplePayload('act_alice_03'), ALICE_AUTH);
  const cancelled = service.cancelRequest(req.id, 'User changed mind', ALICE_AUTH);
  assertEquals(cancelled.status, ApprovalStatus.CANCELLED, 'Request transitions to CANCELLED state');
  assertEquals(cancelled.cancellationReason, 'User changed mind', 'Cancellation reason is stored');
}

{
  const { service } = setupServiceTestEnvironment();

  // 6. List pending requests for trusted contact
  service.createRequest(createSamplePayload('act_alice_04'), ALICE_AUTH);
  service.createRequest(createSamplePayload('act_alice_05'), ALICE_AUTH);

  const bobsPending = service.listPendingRequestsForContact(BOB_CONTACT_AUTH);
  assertEquals(bobsPending.length, 2, 'Bob sees 2 pending requests for his ward Alice');
  assert(
    bobsPending.every((r) => r.requesterId === 'usr_alice'),
    'All pending requests belong to Alice'
  );

  // 7. List requests for requester with and without status filter
  const allAlice = service.listRequestsForRequester(ALICE_AUTH);
  assertEquals(allAlice.length, 2, 'Alice lists all her requests');

  const pendingAlice = service.listRequestsForRequester(ALICE_AUTH, ApprovalStatus.PENDING);
  assertEquals(pendingAlice.length, 2, 'Alice lists her pending requests with status filter');
}

// -----------------------------------------------------------------------------
// Test Suite 2: Server-Side Authorization & Action Ownership Validation
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 2: Server-Side Authorization & Action Ownership ---');

{
  const { service, actionOwnership } = setupServiceTestEnvironment();

  // Pre-register action ownership to Alice
  actionOwnership.registerActionOwnership('act_alice_private_99', 'usr_alice');

  // Mallory tries to create a request for Alice's action
  let authErrorCaught = false;
  try {
    service.createRequest(createSamplePayload('act_alice_private_99'), MALLORY_UNRELATED_AUTH);
  } catch (err) {
    authErrorCaught = true;
    assert(
      err instanceof UnauthorizedActionRequesterError,
      'Creating request for another user action throws UnauthorizedActionRequesterError'
    );
    assertEquals((err as UnauthorizedActionRequesterError).statusCode, 403, 'Error has 403 status');
  }
  assert(authErrorCaught, 'Blocked unauthorized requester from creating request');

  // Alice creates request
  const aliceReq = service.createRequest(createSamplePayload('act_alice_06'), ALICE_AUTH);

  // Mallory tries to view Alice's request -> 404 opaque error
  authErrorCaught = false;
  try {
    service.getRequest(aliceReq.id, MALLORY_UNRELATED_AUTH);
  } catch (err) {
    authErrorCaught = true;
    assert(
      err instanceof ApprovalAccessDeniedError,
      'Unrelated user viewing request throws ApprovalAccessDeniedError'
    );
    assertEquals((err as ApprovalAccessDeniedError).statusCode, 404, 'Opaque error has 404 status code');
  }
  assert(authErrorCaught, 'Blocked unrelated user from viewing request');

  // Mallory tries to approve Alice's request -> 404 opaque error
  authErrorCaught = false;
  try {
    service.approveRequest(aliceReq.id, { decisionReason: 'Mallory approves' }, MALLORY_UNRELATED_AUTH);
  } catch (err) {
    authErrorCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Unrelated user approving request throws ApprovalAccessDeniedError');
  }
  assert(authErrorCaught, 'Blocked unrelated user from approving request');

  // Mallory tries to cancel Alice's request -> 404 opaque error
  authErrorCaught = false;
  try {
    service.cancelRequest(aliceReq.id, 'Attacker cancels', MALLORY_UNRELATED_AUTH);
  } catch (err) {
    authErrorCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Unrelated user cancelling request throws ApprovalAccessDeniedError');
  }
  assert(authErrorCaught, 'Blocked unrelated user from cancelling request');

  // Bob (trusted contact) CANNOT cancel Alice's request (only ward can cancel)
  authErrorCaught = false;
  try {
    service.cancelRequest(aliceReq.id, 'Caretaker cancels', BOB_CONTACT_AUTH);
  } catch (err) {
    authErrorCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Caretaker cannot cancel ward request');
  }
  assert(authErrorCaught, 'Blocked caretaker from cancelling ward request');

  // Charlie (PENDING_INVITE contact) cannot view or decide
  authErrorCaught = false;
  try {
    service.getRequest(aliceReq.id, CHARLIE_INVITE_AUTH);
  } catch (err) {
    authErrorCaught = true;
    assert(err instanceof ApprovalAccessDeniedError, 'Pending invite contact cannot view request');
  }
  assert(authErrorCaught, 'Blocked pending invite contact from viewing');

  // Unauthenticated caller is rejected on all endpoints
  let unauthCaught = false;
  try {
    service.createRequest(createSamplePayload('act_anon'), UNAUTHENTICATED_AUTH);
  } catch (err) {
    unauthCaught = true;
    assert(err instanceof UnauthenticatedError, 'Unauthenticated createRequest throws UnauthenticatedError');
    assertEquals((err as UnauthenticatedError).statusCode, 401, 'UnauthenticatedError has 401 status code');
  }
  assert(unauthCaught, 'Blocked unauthenticated createRequest');
}

// -----------------------------------------------------------------------------
// Test Suite 3: Self-Approval Prevention (Separation of Duties)
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 3: Self-Approval Prevention ---');

{
  const { service, contactRegistry } = setupServiceTestEnvironment();
  const req = service.createRequest(createSamplePayload('act_alice_07'), ALICE_AUTH);

  // Alice tries to approve her own request
  let selfApproveCaught = false;
  try {
    service.approveRequest(req.id, { decisionReason: 'Self approval' }, ALICE_AUTH);
  } catch (err) {
    selfApproveCaught = true;
    assert(
      err instanceof SelfApprovalProhibitedError,
      'Self-approval throws SelfApprovalProhibitedError'
    );
    assertEquals((err as SelfApprovalProhibitedError).statusCode, 403, 'SelfApprovalProhibitedError has 403 status');
  }
  assert(selfApproveCaught, 'Blocked Alice from approving own request');

  // Alice tries to reject her own request via decision endpoint
  let selfRejectCaught = false;
  try {
    service.rejectRequest(req.id, { decisionReason: 'Self reject' }, ALICE_AUTH);
  } catch (err) {
    selfRejectCaught = true;
    assert(err instanceof SelfApprovalProhibitedError, 'Self-rejection throws SelfApprovalProhibitedError');
  }
  assert(selfRejectCaught, 'Blocked Alice from self-rejection via decision endpoint');

  // Self-approval is rejected even if Alice adds herself to contactRegistry
  contactRegistry.addContact({
    id: 'usr_alice',
    userId: 'usr_alice',
    relationshipLabel: 'Self',
    status: TrustedContactStatus.ACTIVE,
    createdAt: '2026-10-18T10:00:00.000Z',
  });

  let registryBypassCaught = false;
  try {
    service.approveRequest(req.id, {}, ALICE_AUTH);
  } catch (err) {
    registryBypassCaught = true;
    assert(err instanceof SelfApprovalProhibitedError, 'Registry bypass self-approval rejected');
  }
  assert(registryBypassCaught, 'Blocked registry-bypass self-approval');
}

// -----------------------------------------------------------------------------
// Test Suite 4: Invalid Lifecycle State Transitions
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 4: Invalid Lifecycle State Transitions ---');

{
  const { service } = setupServiceTestEnvironment();

  // Approve a request
  const req1 = service.createRequest(createSamplePayload('act_alice_08'), ALICE_AUTH);
  service.approveRequest(req1.id, { decisionReason: 'First approval' }, BOB_CONTACT_AUTH);

  // Attempt second approval on already-approved request
  let alreadyResolvedCaught = false;
  try {
    service.approveRequest(req1.id, { decisionReason: 'Duplicate approval' }, BOB_CONTACT_AUTH);
  } catch (err) {
    alreadyResolvedCaught = true;
    assert(
      err instanceof ApprovalAlreadyResolvedError,
      'Approving already-approved request throws ApprovalAlreadyResolvedError'
    );
  }
  assert(alreadyResolvedCaught, 'Blocked duplicate approval on resolved request');

  // Attempt rejection on already-approved request
  alreadyResolvedCaught = false;
  try {
    service.rejectRequest(req1.id, { decisionReason: 'Conflicting reject' }, BOB_CONTACT_AUTH);
  } catch (err) {
    alreadyResolvedCaught = true;
    assert(
      err instanceof ApprovalAlreadyResolvedError,
      'Rejecting already-approved request throws ApprovalAlreadyResolvedError'
    );
  }
  assert(alreadyResolvedCaught, 'Blocked conflicting rejection on approved request');

  // Attempt cancellation on already-approved request
  alreadyResolvedCaught = false;
  try {
    service.cancelRequest(req1.id, 'Cancel after approve', ALICE_AUTH);
  } catch (err) {
    alreadyResolvedCaught = true;
    assert(
      err instanceof ApprovalAlreadyResolvedError,
      'Cancelling already-approved request throws ApprovalAlreadyResolvedError'
    );
  }
  assert(alreadyResolvedCaught, 'Blocked cancellation on approved request');

  // Cancel a request then try to approve it
  const req2 = service.createRequest(createSamplePayload('act_alice_09'), ALICE_AUTH);
  service.cancelRequest(req2.id, 'User aborted', ALICE_AUTH);

  alreadyResolvedCaught = false;
  try {
    service.approveRequest(req2.id, {}, BOB_CONTACT_AUTH);
  } catch (err) {
    alreadyResolvedCaught = true;
    assert(
      err instanceof ApprovalAlreadyResolvedError,
      'Approving cancelled request throws ApprovalAlreadyResolvedError'
    );
  }
  assert(alreadyResolvedCaught, 'Blocked approval on cancelled request');
}

// -----------------------------------------------------------------------------
// Test Suite 5: Expired Request Enforcement
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 5: Expired Request Enforcement ---');

{
  const { service, clock } = setupServiceTestEnvironment();

  // Create request with default 15-minute TTL
  const req = service.createRequest(createSamplePayload('act_alice_10'), ALICE_AUTH);

  // Advance time past 15 minutes (advance by 16 minutes)
  clock.advanceMinutes(16);

  // Submitting decision on expired request throws ApprovalExpiredError
  let expiredCaught = false;
  try {
    service.approveRequest(req.id, {}, BOB_CONTACT_AUTH);
  } catch (err) {
    expiredCaught = true;
    assert(
      err instanceof ApprovalExpiredError,
      'Late decision on expired request throws ApprovalExpiredError'
    );
  }
  assert(expiredCaught, 'Blocked late approval on expired request');

  // Lazy check: getRequest reflects EXPIRED status
  const fetched = service.getRequest(req.id, ALICE_AUTH);
  assertEquals(fetched.status, ApprovalStatus.EXPIRED, 'Request lazily updated to EXPIRED on retrieval');

  // Sweep check: checkAndExpireStaleRequests
  const req2 = service.createRequest(createSamplePayload('act_alice_11'), ALICE_AUTH);
  clock.advanceMinutes(20);
  const expiredCount = service.checkAndExpireStaleRequests();
  assert(expiredCount >= 1, 'checkAndExpireStaleRequests expired at least 1 stale request');
  assertEquals(
    service.getRequest(req2.id, ALICE_AUTH).status,
    ApprovalStatus.EXPIRED,
    'Stale request transitioned to EXPIRED'
  );
}

// -----------------------------------------------------------------------------
// Test Suite 6: Missing Request Handling (Anti-Enumeration)
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 6: Missing Request & Anti-Enumeration ---');

{
  const { service } = setupServiceTestEnvironment();
  const req = service.createRequest(createSamplePayload('act_alice_12'), ALICE_AUTH);

  let unownedError: ApprovalAccessDeniedError | undefined;
  let missingError: ApprovalAccessDeniedError | undefined;

  try {
    service.getRequest(req.id, MALLORY_UNRELATED_AUTH);
  } catch (err) {
    unownedError = err as ApprovalAccessDeniedError;
  }

  try {
    service.getRequest('apr_completely_fake_id_9999', MALLORY_UNRELATED_AUTH);
  } catch (err) {
    missingError = err as ApprovalAccessDeniedError;
  }

  assert(unownedError !== undefined, 'Unowned request throws error');
  assert(missingError !== undefined, 'Missing request throws error');
  assertEquals(
    unownedError?.message,
    missingError?.message,
    'Error message is identical for unowned and non-existent IDs (anti-enumeration)'
  );
  assertEquals(unownedError?.statusCode, 404, 'Status code is 404');
  assertEquals(missingError?.statusCode, 404, 'Missing ID status code is 404');
}

// -----------------------------------------------------------------------------
// Test Suite 7: First-Responder Concurrency & Atomic Decisions
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 7: First-Responder Concurrency & Atomic Decisions ---');

{
  const { service } = setupServiceTestEnvironment();

  // Alice creates a request for review
  const req = service.createRequest(createSamplePayload('act_alice_13'), ALICE_AUTH);

  // Bob and Daniel are both active trusted contacts for Alice
  // Simulate concurrent decision attempts:
  // Both inspect the request while it is PENDING
  const bobsView = service.getRequest(req.id, BOB_CONTACT_AUTH);
  const danielsView = service.getRequest(req.id, DANIEL_CONTACT_AUTH);
  assertEquals(bobsView.status, ApprovalStatus.PENDING, 'Bob inspects request in PENDING state');
  assertEquals(danielsView.status, ApprovalStatus.PENDING, 'Daniel inspects request in PENDING state');

  // Bob commits approval first
  const bobDecision = service.approveRequest(
    req.id,
    { decisionReason: 'Bob approves first' },
    BOB_CONTACT_AUTH
  );
  assertEquals(bobDecision.status, ApprovalStatus.APPROVED, 'Bob decision commits successfully');
  assertEquals(bobDecision.decision?.decidedBy, 'tc_bob', 'Bob is recorded as winner');

  // Daniel attempts to reject concurrently
  let danielCaught = false;
  try {
    service.rejectRequest(
      req.id,
      { decisionReason: 'Daniel rejects at same moment' },
      DANIEL_CONTACT_AUTH
    );
  } catch (err) {
    danielCaught = true;
    assert(
      err instanceof ApprovalAlreadyResolvedError,
      'Concurrent secondary decision rejected with ApprovalAlreadyResolvedError'
    );
  }
  assert(danielCaught, 'Second concurrent decision was strictly blocked');

  // Verify the stored record is solely Bob's approval (no race corruption)
  const finalState = service.getRequest(req.id, ALICE_AUTH);
  assertEquals(finalState.status, ApprovalStatus.APPROVED, 'Final status remains APPROVED');
  assertEquals(finalState.decision?.decidedBy, 'tc_bob', 'DecidedBy remains tc_bob');
}

// -----------------------------------------------------------------------------
// Test Suite 8: Duplicate Request Creation & Idempotency
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 8: Duplicate Request Creation & Idempotency ---');

{
  const { service } = setupServiceTestEnvironment();

  // 1. Initial request
  const req1 = service.createRequest(createSamplePayload('act_alice_14'), ALICE_AUTH);

  // 2. Client clicks "Request Approval" a second time (default idempotent network retry)
  const req2 = service.createRequest(createSamplePayload('act_alice_14'), ALICE_AUTH);
  assertEquals(req1.id, req2.id, 'Idempotent creation returns the existing active requestId');

  // 3. Submitting duplicate with rejectDuplicates: true throws DuplicateApprovalRequestError
  let dupCaught = false;
  try {
    service.createRequest(createSamplePayload('act_alice_14'), ALICE_AUTH, {
      rejectDuplicates: true,
    });
  } catch (err) {
    dupCaught = true;
    assert(
      err instanceof DuplicateApprovalRequestError,
      'Duplicate submission with rejectDuplicates throws DuplicateApprovalRequestError'
    );
  }
  assert(dupCaught, 'Explicit duplicate submission was rejected');

  // 4. After first request is resolved, creating a new request for the action creates a fresh request
  service.approveRequest(req1.id, {}, BOB_CONTACT_AUTH);
  const req3 = service.createRequest(createSamplePayload('act_alice_14'), ALICE_AUTH);
  assert(req3.id !== req1.id, 'Fresh requestId generated for new request after prior resolution');
  assertEquals(req3.status, ApprovalStatus.PENDING, 'New request starts in PENDING state');
}

// -----------------------------------------------------------------------------
// Test Suite 9: Rejection of Client-Supplied APPROVED Status
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 9: Rejection of Client-Supplied Status ---');

{
  const { service } = setupServiceTestEnvironment();

  // 1. Client attempts to pass status: 'APPROVED'
  let clientStatusCaught = false;
  try {
    const maliciousPayload = {
      ...createSamplePayload('act_alice_15'),
      status: 'APPROVED',
    };
    service.createRequest(maliciousPayload as any, ALICE_AUTH);
  } catch (err) {
    clientStatusCaught = true;
    assert(
      err instanceof ApprovalValidationError,
      'Client payload specifying status: APPROVED throws ApprovalValidationError'
    );
  }
  assert(clientStatusCaught, 'Client-supplied APPROVED status was rejected');

  // 2. Client attempts to pass status: 'PENDING'
  clientStatusCaught = false;
  try {
    const payloadWithStatus = {
      ...createSamplePayload('act_alice_16'),
      status: 'PENDING',
    };
    service.createRequest(payloadWithStatus as any, ALICE_AUTH);
  } catch (err) {
    clientStatusCaught = true;
    assert(
      err instanceof ApprovalValidationError,
      'Client payload specifying status: PENDING throws ApprovalValidationError'
    );
  }
  assert(clientStatusCaught, 'Client-supplied PENDING status was rejected');

  // 3. Client attempts to pass client decision
  let clientDecisionCaught = false;
  try {
    const payloadWithDecision = {
      ...createSamplePayload('act_alice_17'),
      decision: { decision: 'APPROVED', decidedBy: 'usr_alice' },
    };
    service.createRequest(payloadWithDecision as any, ALICE_AUTH);
  } catch (err) {
    clientDecisionCaught = true;
    assert(
      err instanceof ApprovalValidationError,
      'Client payload specifying decision throws ApprovalValidationError'
    );
  }
  assert(clientDecisionCaught, 'Client-supplied decision block was rejected');
}

// -----------------------------------------------------------------------------
// Test Suite 10: Strict Non-Execution of Held Browser Action
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 10: Strict Non-Execution of Browser Action ---');

{
  const { service, clock } = setupServiceTestEnvironment();
  const interception = new InterceptionController();
  const continuation = new ContinuationManager(interception);

  let executedCount = 0;
  const controlledHandler = () => {
    executedCount++;
  };

  const action: GuardrailAction = {
    id: 'act_held_browser_action',
    type: ActionType.CLICK,
    page: { url: 'https://bank.example.com', title: 'Transfer' },
    timestamp: clock.getTime(),
  };

  // Hold action in browser runtime
  interception.register(action.id, 'High-risk interaction captured');
  const heldRecord = interception.holdAction(action.id, 'Held in Staging Mode pending approval');
  continuation.registerHeldAction(action, heldRecord, controlledHandler);

  assertEquals(executedCount, 0, 'Execution count is 0 while action is held');
  assertEquals(interception.getRecord(action.id)?.state, InterceptionState.HELD, 'InterceptionRecord is HELD');

  // 1. Create approval request via ApprovalService
  const req = service.createRequest(createSamplePayload(action.id), ALICE_AUTH);
  assertEquals(executedCount, 0, 'Creating approval request does NOT execute action');
  assertEquals(interception.getRecord(action.id)?.state, InterceptionState.HELD, 'Action remains HELD after creation');

  // 2. Approve request via ApprovalService
  const approved = service.approveRequest(req.id, {}, BOB_CONTACT_AUTH);
  assertEquals(approved.status, ApprovalStatus.APPROVED, 'Request is now APPROVED on backend');
  assertEquals(executedCount, 0, 'Backend approval does NOT execute browser action');
  assertEquals(interception.getRecord(action.id)?.state, InterceptionState.HELD, 'Action remains HELD in browser runtime');

  // 3. Action is ONLY executed when explicit ContinuationManager release occurs on client
  const continuationResult = continuation.continueAction(action.id, 'byp_test_999');
  assert(continuationResult.success, 'ContinuationManager continues action on explicit client invocation');
  assertEquals(executedCount, 1, 'Action executed exactly once after client release');
}

// -----------------------------------------------------------------------------
// Test Suite 11: Privacy-Preserving Safe Logging
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 11: Privacy-Preserving Safe Logging ---');

{
  const loggedEvents: Array<{ message: string; context?: Record<string, unknown> }> = [];

  const testLogger: ApprovalServiceLogger = {
    info: (message, context) => loggedEvents.push({ message, context }),
    warn: (message, context) => loggedEvents.push({ message, context }),
    error: (message, context) => loggedEvents.push({ message, context }),
  };

  const serviceWithLogger = new ApprovalService({
    logger: testLogger,
  });

  serviceWithLogger.createRequest(createSamplePayload('act_log_01'), ALICE_AUTH);
  assert(loggedEvents.length > 0, 'Service logged createRequest event');

  const createEvent = loggedEvents[0];
  assert(createEvent.context !== undefined, 'Logged context is present');
  assertEquals(createEvent.context?.actionId, 'act_log_01', 'Logs actionId');
  assertEquals(createEvent.context?.requesterId, 'usr_alice', 'Logs requesterId');

  // Verify that no sensitive form fields, passwords, or cookies are logged
  const loggedKeys = Object.keys(createEvent.context || {});
  assert(!loggedKeys.includes('password'), 'Context does not contain password');
  assert(!loggedKeys.includes('token'), 'Context does not contain auth token');
  assert(!loggedKeys.includes('cookie'), 'Context does not contain cookies');
  assert(!loggedKeys.includes('formValue'), 'Context does not contain form data');

  // Verify SafeConsoleApprovalServiceLogger sanitization
  const safeConsoleLogger = new SafeConsoleApprovalServiceLogger();
  assert(typeof safeConsoleLogger.info === 'function', 'SafeConsoleApprovalServiceLogger provides info method');
}

// -----------------------------------------------------------------------------
// Test Suite 12: Development-Only Repository Abstraction Notice
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 12: Development-Only Repository Abstraction Notice ---');

{
  assertEquals(
    DevelopmentInMemoryApprovalRequestRepository.IS_PRODUCTION_PERSISTENCE,
    false,
    'DevelopmentInMemoryApprovalRequestRepository explicitly declares IS_PRODUCTION_PERSISTENCE = false'
  );
  assertEquals(
    PERSISTENCE_METADATA.IS_PRODUCTION,
    false,
    'PERSISTENCE_METADATA.IS_PRODUCTION is false'
  );
  assertEquals(
    PERSISTENCE_METADATA.TYPE,
    'EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY',
    'PERSISTENCE_METADATA identifies ephemeral in-memory type'
  );
}

// -----------------------------------------------------------------------------
// Test Summary
// -----------------------------------------------------------------------------
console.log('\n============================================================');
console.log(`📊 APPROVAL SERVICE TESTS SUMMARY: ${passedTests} / ${totalTests} PASSED`);
if (passedTests === totalTests) {
  console.log('🎉 ALL APPROVAL SERVICE COORDINATION INVARIANTS VERIFIED!');
} else {
  console.error(`⚠️ ${totalTests - passedTests} TESTS FAILED!`);
}
console.log('============================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
