/**
 * Guardrail Controlled Action Continuation State Model - Unit Test Suite
 *
 * Comprehensive verification of the explicit state model for controlled action continuation:
 * 1. Allowed transitions defined explicitly.
 * 2. Invalid transitions rejected deterministically.
 * 3. Strict separation between ApprovalStatus and ControlledActionState / InterceptionState.
 * 4. APPROVED status does NOT directly transition an action to CONTINUED.
 * 5. Binding, expiration, origin, path, and DOM attachment checks required before READY_FOR_USER_CONFIRMATION.
 * 6. Terminal actions (CONTINUED, CANCELLED, EXPIRED, INVALIDATED) cannot return to reusable state.
 * 7. State transitions are testable and independent of UI rendering.
 * 8. Preservation of existing cancellation semantics.
 * 9. Zero automatic action execution.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import {
  InterceptionRecord,
  InterceptionState,
  ControlledActionState,
} from '../types/interception.js';
import {
  createInterceptionRecord,
  isTerminalInterceptionState,
  isValidInterceptionTransition,
  InvalidStateTransitionError,
  transitionInterceptionRecord,
  VALID_INTERCEPTION_TRANSITIONS,
  evaluateContinuationEligibility,
  transitionActionOnEligibility,
} from './transitions.js';
import { InterceptionController } from './controller.js';
import { ContinuationManager } from './continuation.js';
import { GuardrailAction, ActionType } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import {
  ApprovalActionBinding,
  ApprovalActionBindingState,
  ApprovalRequest,
  ApprovalStatus,
} from '../types/approval.js';

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

function createSampleAction(actionId: string, overrides: Partial<GuardrailAction> = {}): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    page: {
      url: 'https://bank.example.com/transfer',
      title: 'Transfer Funds',
    },
    element: {
      id: 'btn-confirm-transfer',
      tagName: 'button',
      visibleText: 'Confirm Transfer',
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createSampleApprovalRequest(
  actionId: string,
  status: ApprovalStatus = ApprovalStatus.PENDING,
  overrides: Partial<ApprovalRequest> = {}
): ApprovalRequest {
  const now = Date.now();
  return {
    id: `apr_test_${actionId}`,
    actionId,
    requesterId: 'usr_alice',
    status,
    actionDescription: 'Transfer $500',
    actionType: ActionType.CLICK,
    riskLevel: RiskLevel.HIGH,
    riskScore: 75,
    riskReasons: ['Unusual amount'],
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    pageTitle: 'Transfer Funds',
    createdAt: new Date(now - 60000).toISOString(),
    expiresAt: new Date(now + 300000).toISOString(),
    ...overrides,
  };
}

function createSampleBinding(
  actionId: string,
  requestId: string,
  state: ApprovalActionBindingState = ApprovalActionBindingState.BOUND,
  overrides: Partial<ApprovalActionBinding> = {}
): ApprovalActionBinding {
  const now = Date.now();
  return {
    id: `bnd_${actionId}`,
    actionId,
    requestId,
    requesterId: 'usr_alice',
    state,
    createdAt: new Date(now - 60000).toISOString(),
    expiresAt: new Date(now + 300000).toISOString(),
    actionDigest: 'sha256_mock_digest',
    ...overrides,
  };
}

console.log('\n============================================================');
console.log('🧪 CONTROLLED ACTION CONTINUATION STATE MODEL TEST SUITE');
console.log('============================================================\n');

// ------------------------------------------------------------
// TEST SECTION 1: STATE MODEL DEFINITIONS & TERMINAL STATUS
// ------------------------------------------------------------
console.log('▶ Section 1: State Model Definitions & Terminal Status');

// 1.1 All 8 canonical states exist
const expectedStates = [
  'DETECTED',
  'HELD',
  'AWAITING_APPROVAL',
  'READY_FOR_USER_CONFIRMATION',
  'CONTINUED',
  'CANCELLED',
  'EXPIRED',
  'INVALIDATED',
];

for (const stateName of expectedStates) {
  assert(stateName in InterceptionState, `InterceptionState contains enum member ${stateName}`);
}

// 1.2 ControlledActionState alias is strictly identical to InterceptionState
assertEquals(ControlledActionState, InterceptionState, 'ControlledActionState aliases InterceptionState directly');

// 1.3 Terminal status classification
assert(!isTerminalInterceptionState(InterceptionState.DETECTED), 'DETECTED is not terminal');
assert(!isTerminalInterceptionState(InterceptionState.HELD), 'HELD is not terminal');
assert(!isTerminalInterceptionState(InterceptionState.AWAITING_APPROVAL), 'AWAITING_APPROVAL is not terminal');
assert(!isTerminalInterceptionState(InterceptionState.READY_FOR_USER_CONFIRMATION), 'READY_FOR_USER_CONFIRMATION is not terminal');

assert(isTerminalInterceptionState(InterceptionState.CONTINUED), 'CONTINUED is terminal');
assert(isTerminalInterceptionState(InterceptionState.CANCELLED), 'CANCELLED is terminal');
assert(isTerminalInterceptionState(InterceptionState.EXPIRED), 'EXPIRED is terminal');
assert(isTerminalInterceptionState(InterceptionState.INVALIDATED), 'INVALIDATED is terminal');

// 1.4 Declarative transition matrix has empty arrays for all terminal states
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.CONTINUED].length, 0, 'CONTINUED has 0 allowed transitions');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.CANCELLED].length, 0, 'CANCELLED has 0 allowed transitions');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.EXPIRED].length, 0, 'EXPIRED has 0 allowed transitions');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.INVALIDATED].length, 0, 'INVALIDATED has 0 allowed transitions');

// ------------------------------------------------------------
// TEST SECTION 2: VALID FORWARD STATE TRANSITIONS
// ------------------------------------------------------------
console.log('\n▶ Section 2: Valid Forward State Transitions');

const actionId = 'act-lifecycle-001';
const rDetected = createInterceptionRecord(actionId, 'Initial click detected');
assertEquals(rDetected.state, InterceptionState.DETECTED, 'rDetected state is DETECTED');
assertEquals(rDetected.resolvedAt, undefined, 'resolvedAt is undefined initially');

// DETECTED -> HELD
const rHeld = transitionInterceptionRecord(rDetected, InterceptionState.HELD, 'Action withheld for security review');
assertEquals(rHeld.state, InterceptionState.HELD, 'Transition to HELD succeeded');
assertEquals(rHeld.actionId, actionId, 'actionId preserved identically across DETECTED -> HELD');
assertEquals(rHeld.createdAt, rDetected.createdAt, 'createdAt preserved across DETECTED -> HELD');
assertEquals(rHeld.resolvedAt, undefined, 'resolvedAt is undefined in non-terminal HELD state');
assert(Object.isFrozen(rHeld), 'Returned record is frozen and immutable');

// HELD -> AWAITING_APPROVAL
const rAwaiting = transitionInterceptionRecord(rHeld, InterceptionState.AWAITING_APPROVAL, 'Approval request submitted to backend');
assertEquals(rAwaiting.state, InterceptionState.AWAITING_APPROVAL, 'Transition to AWAITING_APPROVAL succeeded');
assertEquals(rAwaiting.actionId, actionId, 'actionId preserved across HELD -> AWAITING_APPROVAL');
assertEquals(rAwaiting.createdAt, rDetected.createdAt, 'createdAt preserved across HELD -> AWAITING_APPROVAL');
assertEquals(rAwaiting.resolvedAt, undefined, 'resolvedAt is undefined in AWAITING_APPROVAL');

// AWAITING_APPROVAL -> READY_FOR_USER_CONFIRMATION
const rReady = transitionInterceptionRecord(
  rAwaiting,
  InterceptionState.READY_FOR_USER_CONFIRMATION,
  'Backend approved and all contextual checks passed'
);
assertEquals(rReady.state, InterceptionState.READY_FOR_USER_CONFIRMATION, 'Transition to READY_FOR_USER_CONFIRMATION succeeded');
assertEquals(rReady.actionId, actionId, 'actionId preserved across AWAITING_APPROVAL -> READY_FOR_USER_CONFIRMATION');
assertEquals(rReady.createdAt, rDetected.createdAt, 'createdAt preserved across AWAITING_APPROVAL -> READY_FOR_USER_CONFIRMATION');
assertEquals(rReady.resolvedAt, undefined, 'resolvedAt is undefined in READY_FOR_USER_CONFIRMATION');

// READY_FOR_USER_CONFIRMATION -> CONTINUED
const rContinued = transitionInterceptionRecord(
  rReady,
  InterceptionState.CONTINUED,
  'User confirmed approved interaction. Execution completed successfully.'
);
assertEquals(rContinued.state, InterceptionState.CONTINUED, 'Transition to CONTINUED succeeded');
assertEquals(rContinued.actionId, actionId, 'actionId preserved across READY_FOR_USER_CONFIRMATION -> CONTINUED');
assertEquals(rContinued.createdAt, rDetected.createdAt, 'createdAt preserved across READY_FOR_USER_CONFIRMATION -> CONTINUED');
assert(Boolean(rContinued.resolvedAt), 'resolvedAt timestamp populated upon reaching terminal CONTINUED');
assert(isTerminalInterceptionState(rContinued.state), 'Final state is terminal');

// 2.2 Direct fast-paths
const rFastCont = transitionInterceptionRecord(rDetected, InterceptionState.CONTINUED, 'Low risk action allowed immediately');
assertEquals(rFastCont.state, InterceptionState.CONTINUED, 'Direct DETECTED -> CONTINUED succeeded');

const rFastCancel = transitionInterceptionRecord(rDetected, InterceptionState.CANCELLED, 'Blocked by static policy');
assertEquals(rFastCancel.state, InterceptionState.CANCELLED, 'Direct DETECTED -> CANCELLED succeeded');

const rDirectModalCont = transitionInterceptionRecord(rHeld, InterceptionState.CONTINUED, 'User clicked continue on warning modal');
assertEquals(rDirectModalCont.state, InterceptionState.CONTINUED, 'Direct HELD -> CONTINUED succeeded');

// 2.3 Cancellation from each non-terminal state
const rCancelFromHeld = transitionInterceptionRecord(rHeld, InterceptionState.CANCELLED, 'User cancelled held action');
assertEquals(rCancelFromHeld.state, InterceptionState.CANCELLED, 'HELD -> CANCELLED succeeded');
assert(Boolean(rCancelFromHeld.resolvedAt), 'resolvedAt recorded on HELD -> CANCELLED');

const rCancelFromAwaiting = transitionInterceptionRecord(rAwaiting, InterceptionState.CANCELLED, 'User cancelled while awaiting approval');
assertEquals(rCancelFromAwaiting.state, InterceptionState.CANCELLED, 'AWAITING_APPROVAL -> CANCELLED succeeded');
assert(Boolean(rCancelFromAwaiting.resolvedAt), 'resolvedAt recorded on AWAITING_APPROVAL -> CANCELLED');

const rCancelFromReady = transitionInterceptionRecord(rReady, InterceptionState.CANCELLED, 'User declined final confirmation');
assertEquals(rCancelFromReady.state, InterceptionState.CANCELLED, 'READY_FOR_USER_CONFIRMATION -> CANCELLED succeeded');
assert(Boolean(rCancelFromReady.resolvedAt), 'resolvedAt recorded on READY_FOR_USER_CONFIRMATION -> CANCELLED');

// 2.4 Expiration from each non-terminal state
const rExpiredFromHeld = transitionInterceptionRecord(rHeld, InterceptionState.EXPIRED, 'Action held window expired');
assertEquals(rExpiredFromHeld.state, InterceptionState.EXPIRED, 'HELD -> EXPIRED succeeded');

const rExpiredFromAwaiting = transitionInterceptionRecord(rAwaiting, InterceptionState.EXPIRED, 'Approval request TTL expired');
assertEquals(rExpiredFromAwaiting.state, InterceptionState.EXPIRED, 'AWAITING_APPROVAL -> EXPIRED succeeded');

const rExpiredFromReady = transitionInterceptionRecord(rReady, InterceptionState.EXPIRED, 'Confirmation grace period expired');
assertEquals(rExpiredFromReady.state, InterceptionState.EXPIRED, 'READY_FOR_USER_CONFIRMATION -> EXPIRED succeeded');

// 2.5 Invalidation from each non-terminal state
const rInvalidFromHeld = transitionInterceptionRecord(rHeld, InterceptionState.INVALIDATED, 'Page navigated away while held');
assertEquals(rInvalidFromHeld.state, InterceptionState.INVALIDATED, 'HELD -> INVALIDATED succeeded');

const rInvalidFromAwaiting = transitionInterceptionRecord(rAwaiting, InterceptionState.INVALIDATED, 'Backend rejected request');
assertEquals(rInvalidFromAwaiting.state, InterceptionState.INVALIDATED, 'AWAITING_APPROVAL -> INVALIDATED succeeded');

const rInvalidFromReady = transitionInterceptionRecord(rReady, InterceptionState.INVALIDATED, 'Target DOM element detached before confirmation');
assertEquals(rInvalidFromReady.state, InterceptionState.INVALIDATED, 'READY_FOR_USER_CONFIRMATION -> INVALIDATED succeeded');

// ------------------------------------------------------------
// TEST SECTION 3: REJECTION OF INVALID STATE TRANSITIONS
// ------------------------------------------------------------
console.log('\n▶ Section 3: Rejection of Invalid State Transitions');

// 3.1 CRITICAL INVARIANT: AWAITING_APPROVAL -> CONTINUED is strictly prohibited
assert(!isValidInterceptionTransition(InterceptionState.AWAITING_APPROVAL, InterceptionState.CONTINUED),
  'Matrix strictly forbids AWAITING_APPROVAL -> CONTINUED');

let caughtAwaitingToContinue = false;
try {
  transitionInterceptionRecord(rAwaiting, InterceptionState.CONTINUED, 'Direct jump to CONTINUED attempt');
} catch (err) {
  caughtAwaitingToContinue = true;
  assert(err instanceof InvalidStateTransitionError, 'Throws InvalidStateTransitionError on AWAITING_APPROVAL -> CONTINUED');
  if (err instanceof InvalidStateTransitionError) {
    assertEquals(err.fromState, InterceptionState.AWAITING_APPROVAL, 'Error identifies fromState as AWAITING_APPROVAL');
    assertEquals(err.toState, InterceptionState.CONTINUED, 'Error identifies toState as CONTINUED');
    assertEquals(err.actionId, actionId, 'Error identifies actionId');
  }
}
assert(caughtAwaitingToContinue, 'Prevented direct transition from AWAITING_APPROVAL to CONTINUED');

// 3.2 Prohibit backwards transitions
const backwardTests: [InterceptionRecord, InterceptionState, string][] = [
  [rHeld, InterceptionState.DETECTED, 'HELD -> DETECTED'],
  [rAwaiting, InterceptionState.HELD, 'AWAITING_APPROVAL -> HELD'],
  [rAwaiting, InterceptionState.DETECTED, 'AWAITING_APPROVAL -> DETECTED'],
  [rReady, InterceptionState.AWAITING_APPROVAL, 'READY_FOR_USER_CONFIRMATION -> AWAITING_APPROVAL'],
  [rReady, InterceptionState.HELD, 'READY_FOR_USER_CONFIRMATION -> HELD'],
  [rReady, InterceptionState.DETECTED, 'READY_FOR_USER_CONFIRMATION -> DETECTED'],
];

for (const [record, targetState, desc] of backwardTests) {
  let threw = false;
  try {
    transitionInterceptionRecord(record, targetState, 'Prohibited backward transition');
  } catch (err) {
    threw = true;
    assert(err instanceof InvalidStateTransitionError, `Throws InvalidStateTransitionError on ${desc}`);
  }
  assert(threw, `Prevented backward transition: ${desc}`);
}

// ------------------------------------------------------------
// TEST SECTION 4: TERMINAL STATES IMMUTABILITY & NO RESURRECTION
// ------------------------------------------------------------
console.log('\n▶ Section 4: Terminal States Immutability & No Resurrection');

const terminalRecords = [
  { record: rContinued, name: 'CONTINUED' },
  { record: rCancelFromHeld, name: 'CANCELLED' },
  { record: rExpiredFromHeld, name: 'EXPIRED' },
  { record: rInvalidFromHeld, name: 'INVALIDATED' },
];

const candidateNextStates = [
  InterceptionState.DETECTED,
  InterceptionState.HELD,
  InterceptionState.AWAITING_APPROVAL,
  InterceptionState.READY_FOR_USER_CONFIRMATION,
  InterceptionState.CONTINUED,
  InterceptionState.CANCELLED,
  InterceptionState.EXPIRED,
  InterceptionState.INVALIDATED,
];

for (const { record, name } of terminalRecords) {
  for (const nextState of candidateNextStates) {
    let threw = false;
    try {
      transitionInterceptionRecord(record, nextState, 'Attempting transition out of terminal state');
    } catch (err) {
      threw = true;
      assert(err instanceof InvalidStateTransitionError, `Prevented ${name} -> ${nextState}`);
    }
    assert(threw, `Terminal state ${name} cannot transition to ${nextState}`);
  }
}

// ------------------------------------------------------------
// TEST SECTION 5: REPEATED EVENTS & IDEMPOTENCY
// ------------------------------------------------------------
console.log('\n▶ Section 5: Repeated Events & Idempotency');

const controller = new InterceptionController();
const manager = new ContinuationManager(controller);

const actionRep = createSampleAction('act-repeat-001');
controller.register(actionRep);
const heldRecord = controller.holdAction(actionRep.id);

let executionTally = 0;
manager.registerHeldAction(actionRep, heldRecord, () => {
  executionTally++;
});

// Transition to READY_FOR_USER_CONFIRMATION
controller.markReadyForConfirmation(actionRep.id, 'Approved and checked');

// First continuation: should succeed
const cont1 = manager.continueAction(actionRep.id, 'User confirmed');
assertEquals(cont1.success, true, 'First continueAction succeeded');
assertEquals(cont1.executed, true, 'First continueAction executed handler');
assertEquals(executionTally, 1, 'Handler executed exactly 1 time');
assertEquals(cont1.executionCount, 1, 'Execution count is 1');

// Repeated continuation: MUST BE REJECTED
const cont2 = manager.continueAction(actionRep.id, 'User confirmed again');
assertEquals(cont2.success, false, 'Second continueAction rejected');
assertEquals(cont2.executed, false, 'Second continueAction did NOT execute handler');
assertEquals(executionTally, 1, 'Handler STILL executed exactly 1 time');
assert(
  Boolean(
    cont2.error?.includes('Duplicate execution prevented') ||
    cont2.error?.includes('already executed') ||
    cont2.error?.includes('CONTINUED')
  ),
  'Error identifies duplicate execution prevention or terminal state rejection'
);

// Third continuation: still rejected
const cont3 = manager.continueAction(actionRep.id, 'Third attempt');
assertEquals(cont3.success, false, 'Third continueAction rejected');
assertEquals(executionTally, 1, 'Execution count remained strictly 1');

// Repeated eligibility transition idempotency on READY_FOR_USER_CONFIRMATION record
const readyEligibility = {
  eligible: true,
  targetState: InterceptionState.READY_FOR_USER_CONFIRMATION,
  reason: 'Idempotent eligibility check',
};
const idempotentResult = transitionActionOnEligibility(rReady, readyEligibility);
assertEquals(idempotentResult, rReady, 'transitionActionOnEligibility is idempotent when already in targetState');

// And verify that attempting to transition a terminal record via eligibility throws InvalidStateTransitionError
let caughtTerminalEligibilityResurrect = false;
try {
  transitionActionOnEligibility(rContinued, readyEligibility);
} catch (err) {
  caughtTerminalEligibilityResurrect = true;
  assert(err instanceof InvalidStateTransitionError, 'Throws InvalidStateTransitionError when attempting to transition terminal action');
}
assert(caughtTerminalEligibilityResurrect, 'Eligibility evaluation cannot resurrect a terminal action');

// ------------------------------------------------------------
// TEST SECTION 6: DISTINCTION BETWEEN APPROVAL STATUS AND ACTION CONTINUATION STATUS
// ------------------------------------------------------------
console.log('\n▶ Section 6: Distinction Between Approval Status and Action Continuation Status');

// 6.1 ApprovalStatus.APPROVED does NOT equal InterceptionState.CONTINUED
assert((ApprovalStatus.APPROVED as any) !== (InterceptionState.CONTINUED as any),
  'ApprovalStatus.APPROVED is distinct from InterceptionState.CONTINUED');

// 6.2 An approval request marked APPROVED does not mutate action state
const actionSep = createSampleAction('act-sep-001');
const ctrlSep = new InterceptionController();
ctrlSep.register(actionSep);
ctrlSep.holdAction(actionSep.id);
ctrlSep.awaitApproval(actionSep.id);

const reqApproved = createSampleApprovalRequest(actionSep.id, ApprovalStatus.APPROVED);
assertEquals(reqApproved.status, ApprovalStatus.APPROVED, 'ApprovalRequest status is APPROVED');

const actionCurrentState = ctrlSep.getRecord(actionSep.id)?.state;
assertEquals(actionCurrentState, InterceptionState.AWAITING_APPROVAL,
  'Action state remains AWAITING_APPROVAL despite ApprovalRequest being APPROVED');

// 6.3 Mapping of backend ApprovalStatus to action lifecycle outcomes
const statusMappings: [ApprovalStatus, InterceptionState][] = [
  [ApprovalStatus.REJECTED, InterceptionState.INVALIDATED],
  [ApprovalStatus.EXPIRED, InterceptionState.EXPIRED],
  [ApprovalStatus.CANCELLED, InterceptionState.CANCELLED],
];

for (const [approvalStatus, expectedTarget] of statusMappings) {
  const testReq = createSampleApprovalRequest(actionSep.id, approvalStatus);
  const eligibility = evaluateContinuationEligibility({
    actionId: actionSep.id,
    request: testReq,
  });
  assertEquals(eligibility.targetState, expectedTarget,
    `ApprovalStatus.${approvalStatus} translates to InterceptionState.${expectedTarget}`);
  assertEquals(eligibility.eligible, false,
    `ApprovalStatus.${approvalStatus} is NOT eligible for continuation`);
}

// ------------------------------------------------------------
// TEST SECTION 7: ELIGIBILITY EVALUATION & CONTEXT CHECKS (Requirement 5)
// ------------------------------------------------------------
console.log('\n▶ Section 7: Eligibility Evaluation & Context Checks');

const baseActionId = 'act-eligibility-001';
const validRequest = createSampleApprovalRequest(baseActionId, ApprovalStatus.APPROVED);
const validBinding = createSampleBinding(baseActionId, validRequest.id, ApprovalActionBindingState.APPROVED);
const validContext = { url: 'https://bank.example.com/transfer', origin: 'https://bank.example.com' };

// 7.1 All conditions met -> READY_FOR_USER_CONFIRMATION
const elAllPassed = evaluateContinuationEligibility({
  actionId: baseActionId,
  request: validRequest,
  binding: validBinding,
  currentPageContext: validContext,
  originalPageUrl: 'https://bank.example.com/transfer',
  targetElementId: 'btn-confirm-transfer',
  isElementAttached: () => true,
});
assertEquals(elAllPassed.eligible, true, 'All conditions met: eligible is true');
assertEquals(elAllPassed.targetState, InterceptionState.READY_FOR_USER_CONFIRMATION,
  'All conditions met: targetState is READY_FOR_USER_CONFIRMATION');

// 7.2 Missing approval request -> AWAITING_APPROVAL
const elMissingReq = evaluateContinuationEligibility({
  actionId: baseActionId,
  request: null,
});
assertEquals(elMissingReq.eligible, false, 'Missing request is not eligible');
assertEquals(elMissingReq.targetState, InterceptionState.AWAITING_APPROVAL, 'Missing request targets AWAITING_APPROVAL');
assertEquals(elMissingReq.errorCode, 'REQUEST_NOT_APPROVED', 'Error code is REQUEST_NOT_APPROVED');

// 7.3 Request still PENDING -> AWAITING_APPROVAL
const pendingReq = createSampleApprovalRequest(baseActionId, ApprovalStatus.PENDING);
const elPending = evaluateContinuationEligibility({
  actionId: baseActionId,
  request: pendingReq,
});
assertEquals(elPending.eligible, false, 'PENDING request is not eligible');
assertEquals(elPending.targetState, InterceptionState.AWAITING_APPROVAL, 'PENDING request targets AWAITING_APPROVAL');
assertEquals(elPending.errorCode, 'REQUEST_NOT_APPROVED', 'Error code is REQUEST_NOT_APPROVED');

// 7.4 ActionId mismatch on request -> INVALIDATED
const elReqIdMismatch = evaluateContinuationEligibility({
  actionId: baseActionId,
  request: createSampleApprovalRequest('other-action-id', ApprovalStatus.APPROVED),
});
assertEquals(elReqIdMismatch.eligible, false, 'ActionId mismatch on request is not eligible');
assertEquals(elReqIdMismatch.targetState, InterceptionState.INVALIDATED, 'ActionId mismatch targets INVALIDATED');
assertEquals(elReqIdMismatch.errorCode, 'ACTION_ID_MISMATCH', 'Error code is ACTION_ID_MISMATCH');

// 7.5 Expired request -> EXPIRED
const expiredReq = createSampleApprovalRequest(baseActionId, ApprovalStatus.APPROVED, {
  expiresAt: new Date(Date.now() - 10000).toISOString(),
});
const elReqExpired = evaluateContinuationEligibility({
  actionId: baseActionId,
  request: expiredReq,
});
assertEquals(elReqExpired.eligible, false, 'Expired request is not eligible');
assertEquals(elReqExpired.targetState, InterceptionState.EXPIRED, 'Expired request targets EXPIRED');
assertEquals(elReqExpired.errorCode, 'REQUEST_EXPIRED', 'Error code is REQUEST_EXPIRED');

// 7.6 Expired binding -> EXPIRED
const expiredBinding = createSampleBinding(baseActionId, validRequest.id, ApprovalActionBindingState.APPROVED, {
  expiresAt: new Date(Date.now() - 10000).toISOString(),
});
const elBindingExpired = evaluateContinuationEligibility({
  actionId: baseActionId,
  request: validRequest,
  binding: expiredBinding,
});
assertEquals(elBindingExpired.eligible, false, 'Expired binding is not eligible');
assertEquals(elBindingExpired.targetState, InterceptionState.EXPIRED, 'Expired binding targets EXPIRED');
assertEquals(elBindingExpired.errorCode, 'BINDING_EXPIRED', 'Error code is BINDING_EXPIRED');

// 7.7 ActionId mismatch on binding -> INVALIDATED
const elBindingIdMismatch = evaluateContinuationEligibility({
  actionId: baseActionId,
  request: validRequest,
  binding: createSampleBinding('different-action', validRequest.id, ApprovalActionBindingState.APPROVED),
});
assertEquals(elBindingIdMismatch.eligible, false, 'ActionId mismatch on binding is not eligible');
assertEquals(elBindingIdMismatch.targetState, InterceptionState.INVALIDATED, 'Binding actionId mismatch targets INVALIDATED');
assertEquals(elBindingIdMismatch.errorCode, 'ACTION_ID_MISMATCH', 'Error code is ACTION_ID_MISMATCH');

// 7.8 Page origin mismatch -> INVALIDATED
const elOriginMismatch = evaluateContinuationEligibility({
  actionId: baseActionId,
  request: validRequest,
  binding: validBinding,
  originalPageUrl: 'https://bank.example.com/transfer',
  currentPageContext: { url: 'https://attacker.com/transfer', origin: 'https://attacker.com' },
});
assertEquals(elOriginMismatch.eligible, false, 'Origin mismatch is not eligible');
assertEquals(elOriginMismatch.targetState, InterceptionState.INVALIDATED, 'Origin mismatch targets INVALIDATED');
assertEquals(elOriginMismatch.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code is PAGE_CONTEXT_MISMATCH');

// 7.9 Page pathname mismatch -> INVALIDATED
const elPathMismatch = evaluateContinuationEligibility({
  actionId: baseActionId,
  request: validRequest,
  binding: validBinding,
  originalPageUrl: 'https://bank.example.com/transfer',
  currentPageContext: { url: 'https://bank.example.com/settings', origin: 'https://bank.example.com' },
});
assertEquals(elPathMismatch.eligible, false, 'Pathname mismatch is not eligible');
assertEquals(elPathMismatch.targetState, InterceptionState.INVALIDATED, 'Pathname mismatch targets INVALIDATED');
assertEquals(elPathMismatch.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code is PAGE_CONTEXT_MISMATCH');

// 7.10 Detached target DOM element -> INVALIDATED
const elDetachedElement = evaluateContinuationEligibility({
  actionId: baseActionId,
  request: validRequest,
  binding: validBinding,
  originalPageUrl: 'https://bank.example.com/transfer',
  currentPageContext: validContext,
  targetElementId: 'btn-confirm-transfer',
  isElementAttached: () => false,
});
assertEquals(elDetachedElement.eligible, false, 'Detached DOM element is not eligible');
assertEquals(elDetachedElement.targetState, InterceptionState.INVALIDATED, 'Detached DOM element targets INVALIDATED');
assertEquals(elDetachedElement.errorCode, 'ELEMENT_DETACHED', 'Error code is ELEMENT_DETACHED');

// ------------------------------------------------------------
// TEST SECTION 8: ZERO AUTOMATIC ACTION EXECUTION
// ------------------------------------------------------------
console.log('\n▶ Section 8: Zero Automatic Action Execution & Confirmation Requirement');

const ctrlExec = new InterceptionController();
const mgrExec = new ContinuationManager(ctrlExec);

const actionExec = createSampleAction('act-exec-001');
ctrlExec.register(actionExec);
const heldExecRecord = ctrlExec.holdAction(actionExec.id);

let handlerExecutionTimes = 0;
mgrExec.registerHeldAction(actionExec, heldExecRecord, () => {
  handlerExecutionTimes++;
});

// Submit approval: action transitions to AWAITING_APPROVAL
ctrlExec.awaitApproval(actionExec.id, 'Waiting for backend');
assertEquals(handlerExecutionTimes, 0, 'Zero execution upon entering AWAITING_APPROVAL');

// Evaluate eligibility and transition to READY_FOR_USER_CONFIRMATION
const eligibility = evaluateContinuationEligibility({
  actionId: actionExec.id,
  request: createSampleApprovalRequest(actionExec.id, ApprovalStatus.APPROVED),
  binding: createSampleBinding(actionExec.id, `apr_test_${actionExec.id}`, ApprovalActionBindingState.APPROVED),
  originalPageUrl: actionExec.page?.url,
  currentPageContext: { origin: 'https://bank.example.com', url: actionExec.page?.url },
  targetElementId: actionExec.element?.id,
  isElementAttached: () => true,
});
assertEquals(eligibility.eligible, true, 'Eligibility evaluation confirms eligibility');

// Action transitions to READY_FOR_USER_CONFIRMATION
const currentRec = ctrlExec.getRecord(actionExec.id);
assert(currentRec !== undefined, 'Current record exists');
if (currentRec) {
  const readyRec = transitionActionOnEligibility(currentRec, eligibility);
  assertEquals(readyRec.state, InterceptionState.READY_FOR_USER_CONFIRMATION, 'Action transitioned to READY_FOR_USER_CONFIRMATION');
  ctrlExec.markReadyForConfirmation(actionExec.id, readyRec.reason);
}

// INVIOLABLE SAFETY INVARIANT: No handler execution occurred on becoming READY_FOR_USER_CONFIRMATION
assertEquals(handlerExecutionTimes, 0, 'Zero execution upon entering READY_FOR_USER_CONFIRMATION');

// Action ONLY executes when user explicitly triggers continuation
const continueRes = mgrExec.continueAction(actionExec.id, 'User clicked Proceed');
assertEquals(continueRes.success, true, 'Explicit continuation succeeded');
assertEquals(continueRes.executed, true, 'Handler executed on explicit continuation');
assertEquals(handlerExecutionTimes, 1, 'Handler executed exactly 1 time');
assertEquals(mgrExec.getExecutionCount(actionExec.id), 1, 'Execution count is 1');

// ------------------------------------------------------------
// TEST SECTION 9: CONTROLLER HELPER METHODS & CANCELLATION SEMANTICS
// ------------------------------------------------------------
console.log('\n▶ Section 9: Controller Helper Methods & Cancellation Semantics');

const ctrlHelper = new InterceptionController();
const actionHelper = createSampleAction('act-helper-001');

// Register -> DETECTED
const r1 = ctrlHelper.register(actionHelper);
assertEquals(r1.state, InterceptionState.DETECTED, 'Controller.register sets DETECTED');

// holdAction -> HELD
const r2 = ctrlHelper.holdAction(actionHelper.id);
assertEquals(r2.state, InterceptionState.HELD, 'Controller.holdAction sets HELD');

// awaitApproval -> AWAITING_APPROVAL
const r3 = ctrlHelper.awaitApproval(actionHelper.id);
assertEquals(r3.state, InterceptionState.AWAITING_APPROVAL, 'Controller.awaitApproval sets AWAITING_APPROVAL');

// markReadyForConfirmation -> READY_FOR_USER_CONFIRMATION
const r4 = ctrlHelper.markReadyForConfirmation(actionHelper.id);
assertEquals(r4.state, InterceptionState.READY_FOR_USER_CONFIRMATION, 'Controller.markReadyForConfirmation sets READY_FOR_USER_CONFIRMATION');

// cancelAction -> CANCELLED
const r5 = ctrlHelper.cancelAction(actionHelper.id);
assertEquals(r5.state, InterceptionState.CANCELLED, 'Controller.cancelAction sets CANCELLED');
assert(Boolean(r5.resolvedAt), 'Controller.cancelAction sets resolvedAt');

// Invalidation helper on new action
const actionInv = createSampleAction('act-inv-001');
ctrlHelper.register(actionInv);
ctrlHelper.holdAction(actionInv.id);
const rInv = ctrlHelper.invalidateAction(actionInv.id, 'Context compromised');
assertEquals(rInv.state, InterceptionState.INVALIDATED, 'Controller.invalidateAction sets INVALIDATED');
assert(Boolean(rInv.resolvedAt), 'Controller.invalidateAction sets resolvedAt');

// Expiration helper on new action
const actionExp = createSampleAction('act-exp-001');
ctrlHelper.register(actionExp);
ctrlHelper.holdAction(actionExp.id);
const rExp = ctrlHelper.expireAction(actionExp.id, 'Time expired');
assertEquals(rExp.state, InterceptionState.EXPIRED, 'Controller.expireAction sets EXPIRED');
assert(Boolean(rExp.resolvedAt), 'Controller.expireAction sets resolvedAt');

console.log('\n============================================================');
console.log(`TOTAL STATE MODEL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log('============================================================\n');

if (totalTests !== passedTests) {
  process.exit(1);
}
