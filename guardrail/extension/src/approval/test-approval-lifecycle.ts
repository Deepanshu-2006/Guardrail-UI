/**
 * Guardrail Approval Lifecycle & State Transition Verification Suite
 *
 * Verifies:
 * 1. All permitted forward lifecycle transitions:
 *    - PENDING -> APPROVED
 *    - PENDING -> REJECTED
 *    - PENDING -> CANCELLED
 *    - PENDING -> EXPIRED (manual & automatic time evaluation)
 * 2. Strict rejection of all forbidden transitions out of terminal states:
 *    - APPROVED -> any (repeated decisions, conflicting decisions, cancellations, reopenings)
 *    - REJECTED -> any (repeated decisions, approvals, cancellations, reopenings)
 *    - EXPIRED -> any (late approvals, rejections, cancellations, reopenings)
 *    - CANCELLED -> any (approvals, rejections, reopenings)
 * 3. Authoritative server-side time source validation:
 *    - Accurate expiration enforcement via injectable TimeProvider.
 *    - Automatic lazy expiration on access and batch stale request expiration.
 * 4. Concurrency & First-responder protection:
 *    - Race condition simulation: exactly one reviewer wins; secondary decisions rejected.
 * 5. Reopening prevention:
 *    - Terminal states cannot be reverted to PENDING; fresh review requires a new request.
 * 6. Non-execution of held browser action:
 *    - Proves approval state transitions strictly do NOT execute or release held browser actions.
 * 7. Separation of duties & authorization:
 *    - Requesters cannot approve their own requests; non-requesters cannot cancel.
 * 8. UI Independence:
 *    - Pure domain logic operating in headless environment without DOM or window dependencies.
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
  ApprovalReopenProhibitedError,
  ApprovalRequestNotFoundError,
  ApprovalStateTransitionError,
  ApprovalValidationError,
  DuplicateApprovalRequestError,
  isRequestExpired,
  isTerminalApprovalStatus,
  isValidApprovalTransition,
  VALID_APPROVAL_TRANSITIONS,
} from './model.js';
import { ApprovalLifecycleManager } from './lifecycle.js';
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
console.log('🧪 GUARDRAIL APPROVAL LIFECYCLE & STATE TRANSITIONS TEST SUITE');
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
    setIso: (iso: string) => {
      currentEpoch = Date.parse(iso);
    },
  };
}

const baseActionId = 'act_payment_transfer_001';
const baseRequesterId = 'usr_alice';
const contactBobId = 'tc_guardian_bob';
const contactCarolId = 'tc_guardian_carol';

const samplePayload: ClientApprovalRequestPayload = Object.freeze({
  actionId: baseActionId,
  actionDescription: 'Transfer $5,000 to new vendor',
  actionType: ActionType.CLICK,
  category: ActionCategory.PAYMENT,
  riskLevel: RiskLevel.CRITICAL,
  riskScore: 90,
  riskReasons: ['Large transfer threshold exceeded'],
  origin: 'https://bank.example.com',
  hostname: 'bank.example.com',
  pageTitle: 'Wire Transfer Portal',
});

// ------------------------------------------------------------
// TEST 1: PERMITTED TRANSITION: PENDING -> APPROVED
// ------------------------------------------------------------
console.log('▶ Test 1: Permitted Transition: PENDING -> APPROVED');
const clock1 = createMockClock();
const lifecycle1 = new ApprovalLifecycleManager({ timeProvider: clock1.getTime });

const req1 = lifecycle1.createRequest(samplePayload, baseRequesterId, { ttlMs: 15 * 60 * 1000 });
assertEquals(req1.status, ApprovalStatus.PENDING, 'Request initialized in PENDING state');

// 5 minutes later, contact Bob approves
clock1.advanceMinutes(5);
const approved1 = lifecycle1.submitDecision(req1.id, {
  decision: 'APPROVED',
  decidedBy: contactBobId,
  decisionReason: 'Verified with Alice via voice call.',
});

assertEquals(approved1.status, ApprovalStatus.APPROVED, 'Status transitioned to APPROVED');
assertEquals(approved1.decision?.decision, 'APPROVED', 'Decision metadata recorded APPROVED');
assertEquals(approved1.decision?.decidedBy, contactBobId, 'Decision recorded contactBobId');
assertEquals(approved1.resolvedAt, clock1.getTime(), 'resolvedAt matches decision timestamp');
assert(isTerminalApprovalStatus(approved1.status), 'APPROVED is recognized as terminal state');

// ------------------------------------------------------------
// TEST 2: PERMITTED TRANSITION: PENDING -> REJECTED
// ------------------------------------------------------------
console.log('\n▶ Test 2: Permitted Transition: PENDING -> REJECTED');
const clock2 = createMockClock();
const lifecycle2 = new ApprovalLifecycleManager({ timeProvider: clock2.getTime });

const req2 = lifecycle2.createRequest(
  { ...samplePayload, actionId: 'act_destruct_002' },
  baseRequesterId,
  { ttlMs: 15 * 60 * 1000 }
);

clock2.advanceMinutes(3);
const rejected2 = lifecycle2.submitDecision(req2.id, {
  decision: 'REJECTED',
  decidedBy: contactCarolId,
  decisionReason: 'Unrecognized vendor. Transaction rejected for security.',
});

assertEquals(rejected2.status, ApprovalStatus.REJECTED, 'Status transitioned to REJECTED');
assertEquals(rejected2.decision?.decision, 'REJECTED', 'Decision metadata recorded REJECTED');
assertEquals(rejected2.decision?.decidedBy, contactCarolId, 'Decision recorded contactCarolId');
assertEquals(rejected2.resolvedAt, clock2.getTime(), 'resolvedAt recorded');
assert(isTerminalApprovalStatus(rejected2.status), 'REJECTED is recognized as terminal state');

// ------------------------------------------------------------
// TEST 3: PERMITTED TRANSITION: PENDING -> CANCELLED (User Cancel)
// ------------------------------------------------------------
console.log('\n▶ Test 3: Permitted Transition: PENDING -> CANCELLED');
const clock3 = createMockClock();
const lifecycle3 = new ApprovalLifecycleManager({ timeProvider: clock3.getTime });

const req3 = lifecycle3.createRequest(
  { ...samplePayload, actionId: 'act_cancel_003' },
  baseRequesterId,
  { ttlMs: 15 * 60 * 1000 }
);

clock3.advanceMinutes(2);
const cancelled3 = lifecycle3.cancelRequest(
  req3.id,
  baseRequesterId,
  'User cancelled in Staging Mode.'
);

assertEquals(cancelled3.status, ApprovalStatus.CANCELLED, 'Status transitioned to CANCELLED');
assertEquals(cancelled3.cancellationReason, 'User cancelled in Staging Mode.', 'cancellationReason recorded');
assertEquals(cancelled3.decision, undefined, 'No decision metadata attached to CANCELLED record');
assertEquals(cancelled3.resolvedAt, clock3.getTime(), 'resolvedAt recorded on cancellation');
assert(isTerminalApprovalStatus(cancelled3.status), 'CANCELLED is recognized as terminal state');

// ------------------------------------------------------------
// TEST 4: PERMITTED TRANSITION: PENDING -> EXPIRED
// ------------------------------------------------------------
console.log('\n▶ Test 4: Permitted Transition: PENDING -> EXPIRED');
const clock4 = createMockClock();
const lifecycle4 = new ApprovalLifecycleManager({ timeProvider: clock4.getTime });

const req4 = lifecycle4.createRequest(
  { ...samplePayload, actionId: 'act_expire_004' },
  baseRequesterId,
  { ttlMs: 10 * 60 * 1000 } // 10 min TTL
);

// Advance clock by 11 minutes (past 10 min TTL)
clock4.advanceMinutes(11);

// Automatic lazy expiration on getRequest
const expired4 = lifecycle4.getRequest(req4.id);
assert(Boolean(expired4), 'Request retrieved');
assertEquals(expired4?.status, ApprovalStatus.EXPIRED, 'Automatically transitioned to EXPIRED when queried after deadline');
assertEquals(expired4?.decision, undefined, 'No decision on EXPIRED request');
assert(isTerminalApprovalStatus(expired4!.status), 'EXPIRED is recognized as terminal state');

// ------------------------------------------------------------
// TEST 5: REPEATED DECISIONS & CONFLICTS (First-Responder Concurrency)
// ------------------------------------------------------------
console.log('\n▶ Test 5: Repeated Decisions & First-Responder Concurrency');
const clock5 = createMockClock();
const lifecycle5 = new ApprovalLifecycleManager({ timeProvider: clock5.getTime });

const req5 = lifecycle5.createRequest(samplePayload, baseRequesterId, { ttlMs: 15 * 60 * 1000 });

// Contact Bob approves first
clock5.advanceMinutes(2);
lifecycle5.submitDecision(req5.id, {
  decision: 'APPROVED',
  decidedBy: contactBobId,
});

// Contact Carol attempts to submit decision on already-approved request
let caughtCarolDecision = false;
try {
  lifecycle5.submitDecision(req5.id, {
    decision: 'REJECTED',
    decidedBy: contactCarolId,
  });
} catch (err) {
  caughtCarolDecision = true;
  assert(err instanceof ApprovalAlreadyResolvedError, 'Throws ApprovalAlreadyResolvedError on conflicting decision');
  assert(err instanceof ApprovalStateTransitionError, 'Inherits from ApprovalStateTransitionError');
}
assert(caughtCarolDecision, 'Prevented conflicting decision after first contact approved');

// Contact Bob attempts to re-approve the exact same request
let caughtDuplicateBob = false;
try {
  lifecycle5.submitDecision(req5.id, {
    decision: 'APPROVED',
    decidedBy: contactBobId,
  });
} catch (err) {
  caughtDuplicateBob = true;
  assert(err instanceof ApprovalAlreadyResolvedError, 'Throws ApprovalAlreadyResolvedError on duplicate identical decision');
}
assert(caughtDuplicateBob, 'Prevented duplicate decision submission by original approver');

// ------------------------------------------------------------
// TEST 6: FORBIDDEN TRANSITIONS OUT OF TERMINAL STATES
// ------------------------------------------------------------
console.log('\n▶ Test 6: Forbidden Transitions Out of Terminal States');

assertEquals(VALID_APPROVAL_TRANSITIONS[ApprovalStatus.PENDING].length, 4, 'PENDING allows 4 forward transitions');
assertEquals(VALID_APPROVAL_TRANSITIONS[ApprovalStatus.APPROVED].length, 0, 'APPROVED allows 0 forward transitions');
assertEquals(VALID_APPROVAL_TRANSITIONS[ApprovalStatus.REJECTED].length, 0, 'REJECTED allows 0 forward transitions');
assertEquals(VALID_APPROVAL_TRANSITIONS[ApprovalStatus.EXPIRED].length, 0, 'EXPIRED allows 0 forward transitions');
assertEquals(VALID_APPROVAL_TRANSITIONS[ApprovalStatus.CANCELLED].length, 0, 'CANCELLED allows 0 forward transitions');

// Test ApprovalRequestNotFoundError on unknown requestId
let caughtNotFound = false;
try {
  lifecycle1.submitDecision('apr_non_existent_123', { decision: 'APPROVED', decidedBy: contactBobId });
} catch (err) {
  caughtNotFound = true;
  assert(err instanceof ApprovalRequestNotFoundError, 'Throws ApprovalRequestNotFoundError for unknown ID');
}
assert(caughtNotFound, 'Correctly throws ApprovalRequestNotFoundError on unknown request ID');

// 6a: APPROVED terminal state transitions forbidden
const terminalApproved = approved1;
const forbiddenFromApproved = [
  ApprovalStatus.PENDING,
  ApprovalStatus.APPROVED,
  ApprovalStatus.REJECTED,
  ApprovalStatus.EXPIRED,
  ApprovalStatus.CANCELLED,
];

for (const target of forbiddenFromApproved) {
  assert(
    !isValidApprovalTransition(terminalApproved.status, target),
    `isValidApprovalTransition confirms APPROVED -> ${target} is forbidden`
  );
}

// Attempting to cancel already approved request
let caughtCancelApproved = false;
try {
  lifecycle1.cancelRequest(terminalApproved.id, baseRequesterId);
} catch (err) {
  caughtCancelApproved = true;
  assert(err instanceof ApprovalAlreadyResolvedError, 'Throws on attempt to cancel APPROVED request');
}
assert(caughtCancelApproved, 'Prevented cancellation of APPROVED request');

// 6b: REJECTED terminal state transitions forbidden
const terminalRejected = rejected2;
let caughtApproveRejected = false;
try {
  lifecycle2.submitDecision(terminalRejected.id, {
    decision: 'APPROVED',
    decidedBy: contactBobId,
  });
} catch (err) {
  caughtApproveRejected = true;
  assert(err instanceof ApprovalAlreadyResolvedError, 'Throws on attempt to approve REJECTED request');
}
assert(caughtApproveRejected, 'Prevented approval of REJECTED request');

// 6c: CANCELLED terminal state transitions forbidden
let caughtApproveCancelled = false;
try {
  lifecycle3.submitDecision(cancelled3.id, {
    decision: 'APPROVED',
    decidedBy: contactBobId,
  });
} catch (err) {
  caughtApproveCancelled = true;
  assert(err instanceof ApprovalAlreadyResolvedError, 'Throws on attempt to approve CANCELLED request');
}
assert(caughtApproveCancelled, 'Prevented approval of CANCELLED request');

// ------------------------------------------------------------
// TEST 7: REOPENING RESOLVED REQUESTS IS STRICTLY PROHIBITED
// ------------------------------------------------------------
console.log('\n▶ Test 7: Reopening Resolved Requests is Strictly Prohibited');
const terminalCases = [
  { name: 'APPROVED', req: approved1, lifecycle: lifecycle1 },
  { name: 'REJECTED', req: rejected2, lifecycle: lifecycle2 },
  { name: 'CANCELLED', req: cancelled3, lifecycle: lifecycle3 },
  { name: 'EXPIRED', req: expired4!, lifecycle: lifecycle4 },
];

for (const tc of terminalCases) {
  let caughtReopen = false;
  try {
    tc.lifecycle.reopenRequest(tc.req.id);
  } catch (err) {
    caughtReopen = true;
    assert(err instanceof ApprovalReopenProhibitedError, `Throws ApprovalReopenProhibitedError when reopening ${tc.name}`);
    if (err instanceof ApprovalReopenProhibitedError) {
      assert(err.message.includes('prohibited by Guardrail architecture'), 'Error explains architectural reopening prohibition');
      assert(err.message.includes('Prefer creating a new approval request'), 'Error recommends creating a new request');
    }
  }
  assert(caughtReopen, `Reopening prohibited for ${tc.name} record`);
}

// ------------------------------------------------------------
// TEST 8: AUTHORITATIVE SERVER TIME SOURCE & LATE DECISIONS
// ------------------------------------------------------------
console.log('\n▶ Test 8: Authoritative Server Time Source & Late Decisions');
const clock8 = createMockClock();
const lifecycle8 = new ApprovalLifecycleManager({ timeProvider: clock8.getTime });

const req8 = lifecycle8.createRequest(
  { ...samplePayload, actionId: 'act_late_008' },
  baseRequesterId,
  { ttlMs: 10 * 60 * 1000 } // 10 minutes TTL
);

// At T + 9 mins, decision is valid
clock8.advanceMinutes(9);
assert(!isRequestExpired(req8, clock8.getTime), 'Request is NOT expired at 9 mins');

// Advance clock to T + 10 mins + 1 second (deadline elapsed!)
clock8.advanceMinutes(1.1);
assert(isRequestExpired(req8, clock8.getTime), 'Request IS expired at 10.1 mins');

// Contact attempts to submit decision after expiration deadline
let caughtLateDecision = false;
try {
  lifecycle8.submitDecision(req8.id, {
    decision: 'APPROVED',
    decidedBy: contactBobId,
  });
} catch (err) {
  caughtLateDecision = true;
  assert(err instanceof ApprovalExpiredError, 'Throws ApprovalExpiredError on late decision');
  assert(err instanceof ApprovalValidationError, 'Inherits from ApprovalValidationError');
}
assert(caughtLateDecision, 'Late decision rejected by authoritative time check');

// ------------------------------------------------------------
// TEST 9: BATCH STALE REQUEST EXPIRATION SCANNER
// ------------------------------------------------------------
console.log('\n▶ Test 9: Batch Stale Request Expiration Scanner');
const clock9 = createMockClock();
const lifecycle9 = new ApprovalLifecycleManager({ timeProvider: clock9.getTime });

// Create 3 requests with varying TTLs
const r1 = lifecycle9.createRequest({ ...samplePayload, actionId: 'act_batch_1' }, baseRequesterId, { ttlMs: 5 * 60 * 1000 });
const r2 = lifecycle9.createRequest({ ...samplePayload, actionId: 'act_batch_2' }, baseRequesterId, { ttlMs: 10 * 60 * 1000 });
const r3 = lifecycle9.createRequest({ ...samplePayload, actionId: 'act_batch_3' }, baseRequesterId, { ttlMs: 30 * 60 * 1000 });

// Advance clock by 12 minutes: r1 and r2 are stale; r3 is still valid
clock9.advanceMinutes(12);

const expiredCount = lifecycle9.checkAndExpireStaleRequests();
assertEquals(expiredCount, 2, 'checkAndExpireStaleRequests expired exactly 2 stale requests');

assertEquals(lifecycle9.getRequest(r1.id)?.status, ApprovalStatus.EXPIRED, 'r1 transitioned to EXPIRED');
assertEquals(lifecycle9.getRequest(r2.id)?.status, ApprovalStatus.EXPIRED, 'r2 transitioned to EXPIRED');
assertEquals(lifecycle9.getRequest(r3.id)?.status, ApprovalStatus.PENDING, 'r3 remains PENDING (not yet expired)');

// ------------------------------------------------------------
// TEST 10: SEPARATION OF DUTIES & AUTHORIZATION GUARDS
// ------------------------------------------------------------
console.log('\n▶ Test 10: Separation of Duties & Authorization Guards');
const clock10 = createMockClock();
const lifecycle10 = new ApprovalLifecycleManager({ timeProvider: clock10.getTime });

const req10 = lifecycle10.createRequest(samplePayload, baseRequesterId);

// 10a: Requester attempts to approve own request
let caughtSelfApproval = false;
try {
  lifecycle10.submitDecision(req10.id, {
    decision: 'APPROVED',
    decidedBy: baseRequesterId, // Same as requester!
  });
} catch (err) {
  caughtSelfApproval = true;
  assert(err instanceof ApprovalValidationError, 'Self-approval throws ApprovalValidationError');
}
assert(caughtSelfApproval, 'Separation of duties enforced: Requester cannot self-approve');

// 10b: Unauthorized user attempts to cancel request
let caughtUnauthorizedCancel = false;
try {
  lifecycle10.cancelRequest(req10.id, 'usr_unauthorized_attacker', 'Malicious cancellation');
} catch (err) {
  caughtUnauthorizedCancel = true;
  assert(err instanceof ApprovalValidationError, 'Unauthorized cancel throws ApprovalValidationError');
}
assert(caughtUnauthorizedCancel, 'Only authenticated requester can cancel approval request');

// ------------------------------------------------------------
// TEST 11: IDEMPOTENCY & DUPLICATE CREATION SUPPRESSION
// ------------------------------------------------------------
console.log('\n▶ Test 11: Idempotency & Duplicate Request Handling');
const clock11 = createMockClock();
const lifecycle11 = new ApprovalLifecycleManager({ timeProvider: clock11.getTime });

// Initial creation
const req11 = lifecycle11.createRequest(samplePayload, baseRequesterId);

// Client network retry / duplicate click without rejectDuplicates flag -> returns existing active request
const retryReq = lifecycle11.createRequest(samplePayload, baseRequesterId);
assertEquals(retryReq.id, req11.id, 'Idempotent submission returns existing active requestId');

// Client retry with rejectDuplicates: true -> throws DuplicateApprovalRequestError
let caughtDuplicateCreation = false;
try {
  lifecycle11.createRequest(samplePayload, baseRequesterId, { rejectDuplicates: true });
} catch (err) {
  caughtDuplicateCreation = true;
  assert(err instanceof DuplicateApprovalRequestError, 'Throws DuplicateApprovalRequestError when rejectDuplicates is true');
}
assert(caughtDuplicateCreation, 'Duplicate active request creation rejected');

// Once resolved, creating a new request for the action is allowed
lifecycle11.submitDecision(req11.id, { decision: 'APPROVED', decidedBy: contactBobId });
const freshReq = lifecycle11.createRequest(samplePayload, baseRequesterId);
assert(freshReq.id !== req11.id, 'Creating new request after previous resolution generates fresh requestId');
assertEquals(freshReq.status, ApprovalStatus.PENDING, 'New request for action starts in PENDING');

// ------------------------------------------------------------
// TEST 12: DECOUPLING FROM ACTION EXECUTION (ZERO SIDE-EFFECTS)
// ------------------------------------------------------------
console.log('\n▶ Test 12: Decoupling Approval Lifecycle from Browser Action Execution');

const interceptionCtrl = new InterceptionController();
const continuationMgr = new ContinuationManager(interceptionCtrl);

const interceptedActionId = 'act_held_in_browser_999';
let actionExecutionCount = 0;

// 1. Action is intercepted and held in browser runtime
interceptionCtrl.register(interceptedActionId, 'High-risk interaction captured');
const heldInterceptionRecord = interceptionCtrl.holdAction(
  interceptedActionId,
  'Held in Staging Mode pending approval'
);

const sourceAction: GuardrailAction = {
  id: interceptedActionId,
  type: ActionType.CLICK,
  page: { url: 'https://bank.example.com', title: 'Bank' },
  timestamp: clock1.getTime(),
};

continuationMgr.registerHeldAction(
  sourceAction,
  heldInterceptionRecord,
  () => {
    actionExecutionCount++;
  }
);

assertEquals(actionExecutionCount, 0, 'Action execution count is 0 while held');
assertEquals(interceptionCtrl.getRecord(interceptedActionId)?.state, InterceptionState.HELD, 'InterceptionRecord is HELD');

// 2. An approval request is created in the approval lifecycle
const clock12 = createMockClock();
const lifecycle12 = new ApprovalLifecycleManager({ timeProvider: clock12.getTime });
const req12 = lifecycle12.createRequest(
  { ...samplePayload, actionId: interceptedActionId },
  baseRequesterId
);

// 3. Trusted contact approves the request
lifecycle12.submitDecision(req12.id, {
  decision: 'APPROVED',
  decidedBy: contactBobId,
});

// CRITICAL SAFETY ASSERTION: Changing approval status strictly does NOT execute or release the held action!
assertEquals(actionExecutionCount, 0, 'Action execution count remains strictly 0 after approval status changes to APPROVED');
assertEquals(
  interceptionCtrl.getRecord(interceptedActionId)?.state,
  InterceptionState.HELD,
  'InterceptionRecord remains HELD in browser runtime'
);

// Execution only occurs when client explicitly invokes ContinuationManager
continuationMgr.continueAction(interceptedActionId, 'byp_test_999');
assertEquals(actionExecutionCount, 1, 'Action execution count is exactly 1 only after explicit ContinuationManager release');

// ------------------------------------------------------------
// TEST 13: UI INDEPENDENCE & HEADLESS EXECUTION
// ------------------------------------------------------------
console.log('\n▶ Test 13: UI Independence & Headless Execution');
assert(typeof window === 'undefined', 'Runs without window object (headless)');
assert(typeof document === 'undefined', 'Runs without document object (headless)');

const headlessLifecycle = new ApprovalLifecycleManager();
const headlessReq = headlessLifecycle.createRequest(
  {
    actionId: 'act_headless_123',
    actionDescription: 'Headless API action',
    actionType: ActionType.SUBMIT,
    riskLevel: RiskLevel.HIGH,
    riskReasons: ['Automated server test'],
  },
  'usr_headless_user'
);
assert(Boolean(headlessReq.id), 'Successfully initialized approval request in purely headless environment');

console.log('\n============================================================');
console.log(`TOTAL APPROVAL LIFECYCLE TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log('============================================================\n');

if (totalTests !== passedTests) {
  process.exit(1);
}
