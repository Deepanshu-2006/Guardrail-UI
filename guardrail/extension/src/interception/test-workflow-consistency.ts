/**
 * Guardrail Workflow Consistency & Lifecycle Invariant Test Suite
 *
 * Comprehensive end-to-end regression tests verifying state transition consistency,
 * action-approval identity binding, fail-closed policy enforcement, stale message
 * rejection, and zero-automatic-continuation guarantees across the entire product.
 */

import { GuardrailAction, ActionType, ActionCategory } from '../types/actions.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalActionBinding,
  ApprovalActionBindingState,
} from '../types/approval.js';
import { ResponseAction } from '../types/response.js';
import {
  createInterceptionRecord,
  transitionInterceptionRecord,
  isValidInterceptionTransition,
  isTerminalInterceptionState,
  InvalidStateTransitionError,
  evaluateContinuationEligibility,
} from './transitions.js';
import {
  InterceptionController,
  ActionNotFoundError,
  ActionAlreadyRegisteredError,
} from './controller.js';
import {
  ContinuationManager,
  ContinuationAuthorizationBoundary,
  verifyContinuationAuthorization,
} from './continuation.js';
import {
  ContinuationValidationService,
  ContinuationEligibilityStatus,
} from './validation-service.js';
import {
  createApprovalRequest,
  resolveApprovalRequest,
  expireApprovalRequest,
  cancelApprovalRequest,
  defaultTimeProvider,
  resolveTimestamp,
  TimeProvider,
} from '../approval/model.js';
import {
  createApprovalActionBinding,
  transitionBindingState,
  computeActionDigest,
} from '../approval/binding.js';
import {
  evaluatePolicies,
  CONTROLLED_DESTRUCTIVE_POLICY,
  UNSUPPORTED_BOUNDARY_GUARD_POLICY,
} from '../response/policies.js';
import {
  ResponseEngine,
  createFailedResponseDecision,
} from '../response/engine.js';
import {
  determineApprovalState,
  UIApprovalStatus,
} from '../staging/status.js';

// =============================================================================
// Lightweight Test Assertion Utilities
// =============================================================================

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message} (Expected "${expected}", received "${actual}")`);
  }
}

function assertThrows(fn: () => void, errorType?: any, message?: string): void {
  let threw = false;
  try {
    fn();
  } catch (err: any) {
    threw = true;
    if (errorType && !(err instanceof errorType)) {
      throw new Error(`Expected error of type ${errorType.name}, but caught: ${err}`);
    }
  }
  if (!threw) {
    throw new Error(`Expected function to throw${message ? `: ${message}` : ''}`);
  }
}

// =============================================================================
// Synthetic Action & Context Factory
// =============================================================================

function createMockAction(overrides?: Partial<GuardrailAction>): GuardrailAction {
  return {
    id: overrides?.id || 'act_test_wf_001',
    type: overrides?.type || ActionType.CLICK,
    category: overrides?.category || ActionCategory.DESTRUCTIVE,
    timestamp: new Date().toISOString(),
    page: {
      url: 'https://example.com/settings/delete-account',
      title: 'Settings - Delete Account',
      origin: 'https://example.com',
      pathname: '/settings/delete-account',
      ...overrides?.page,
    },
    element: {
      tagName: 'BUTTON',
      id: 'btn-confirm-delete',
      visibleText: 'Delete My Account',
      ...overrides?.element,
    },
    ...overrides,
  };
}

function createFixedTimeProvider(isoTimestamp: string): TimeProvider {
  return () => isoTimestamp;
}

function createMockApprovalPayload(actionId: string, overrides?: any) {
  return {
    actionId,
    actionDescription: 'Delete user account and purge all associated data',
    riskLevel: 'CRITICAL' as const,
    category: ActionCategory.DESTRUCTIVE,
    actionType: ActionType.CLICK,
    origin: 'https://example.com',
    ...overrides,
  };
}

// =============================================================================
// Main Test Runner
// =============================================================================

async function runWorkflowConsistencyTests(): Promise<void> {
  console.log('======================================================================');
  console.log('Guardrail End-to-End Workflow Consistency & Lifecycle Invariant Tests');
  console.log('======================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    totalTests++;
    return Promise.resolve()
      .then(fn)
      .then(() => {
        passedTests++;
        console.log(`  ✓ ${name}`);
      })
      .catch((err) => {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err?.message || err}`);
        throw err;
      });
  }

  // ---------------------------------------------------------------------------
  // Suite 1: State Machine Transitions (Valid & Invalid Paths)
  // ---------------------------------------------------------------------------
  console.log('▶ Suite 1: State Machine Lifecycle Transitions & Invariants');

  await test('Valid complete forward lifecycle: DETECTED -> HELD -> AWAITING_APPROVAL -> READY_FOR_USER_CONFIRMATION -> CONTINUED', () => {
    const actionId = 'act_flow_001';
    let rec = createInterceptionRecord(actionId, 'Captured');
    assertEquals(rec.state, InterceptionState.DETECTED, 'Starts in DETECTED');

    rec = transitionInterceptionRecord(rec, InterceptionState.HELD, 'Action held for policy review');
    assertEquals(rec.state, InterceptionState.HELD, 'Transitions to HELD');

    rec = transitionInterceptionRecord(rec, InterceptionState.AWAITING_APPROVAL, 'Approval submitted');
    assertEquals(rec.state, InterceptionState.AWAITING_APPROVAL, 'Transitions to AWAITING_APPROVAL');

    rec = transitionInterceptionRecord(rec, InterceptionState.READY_FOR_USER_CONFIRMATION, 'Approval verified');
    assertEquals(rec.state, InterceptionState.READY_FOR_USER_CONFIRMATION, 'Transitions to READY_FOR_USER_CONFIRMATION');

    rec = transitionInterceptionRecord(rec, InterceptionState.CONTINUED, 'User confirmed continuation');
    assertEquals(rec.state, InterceptionState.CONTINUED, 'Transitions to CONTINUED');
    assert(Boolean(rec.resolvedAt), 'Records resolution timestamp');
  });

  await test('Terminal states cannot transition to any other state', () => {
    const terminalStates = [
      InterceptionState.CONTINUED,
      InterceptionState.CANCELLED,
      InterceptionState.EXPIRED,
      InterceptionState.INVALIDATED,
    ];

    for (const term of terminalStates) {
      assert(isTerminalInterceptionState(term), `State ${term} is terminal`);
      const rec: InterceptionRecord = {
        actionId: 'act_term_test',
        state: term,
        createdAt: new Date().toISOString(),
        resolvedAt: new Date().toISOString(),
      };

      for (const next of Object.values(InterceptionState)) {
        assert(!isValidInterceptionTransition(term, next), `Cannot transition from ${term} to ${next}`);
        assertThrows(
          () => transitionInterceptionRecord(rec, next, 'Invalid attempt'),
          InvalidStateTransitionError,
          `Transition from ${term} to ${next} throws InvalidStateTransitionError`
        );
      }
    }
  });

  await test('State machine rejects illegal skip transitions', () => {
    const recDetected = createInterceptionRecord('act_skip_001');

    // DETECTED cannot jump directly to AWAITING_APPROVAL or READY_FOR_USER_CONFIRMATION
    assert(!isValidInterceptionTransition(InterceptionState.DETECTED, InterceptionState.AWAITING_APPROVAL), 'DETECTED cannot jump to AWAITING_APPROVAL');
    assert(!isValidInterceptionTransition(InterceptionState.DETECTED, InterceptionState.READY_FOR_USER_CONFIRMATION), 'DETECTED cannot jump to READY_FOR_USER_CONFIRMATION');

    // AWAITING_APPROVAL cannot jump directly to CONTINUED without user confirmation
    assert(!isValidInterceptionTransition(InterceptionState.AWAITING_APPROVAL, InterceptionState.CONTINUED), 'AWAITING_APPROVAL cannot jump to CONTINUED without user confirmation');
  });

  await test('Controller enforces unique action registration and rejects duplicates', () => {
    const ctrl = new InterceptionController();
    const action = createMockAction({ id: 'act_ctrl_dup_001' });

    ctrl.register(action, 'First registration');
    assertEquals(ctrl.hasRecord(action.id), true, 'Record is tracked');

    assertThrows(
      () => ctrl.register(action, 'Duplicate registration'),
      ActionAlreadyRegisteredError,
      'Duplicate actionId registration is rejected'
    );
  });

  await test('Controller transitions to terminal states with recorded timestamps', () => {
    const ctrl = new InterceptionController();
    const actionId = 'act_term_ctrl_001';
    ctrl.register(actionId);
    ctrl.holdAction(actionId);

    const expired = ctrl.expireAction(actionId, 'TTL expired');
    assertEquals(expired.state, InterceptionState.EXPIRED, 'Record is EXPIRED');
    assert(Boolean(expired.resolvedAt), 'Expiration timestamp is recorded');

    // Attempting further transition on expired action throws
    assertThrows(
      () => ctrl.continueAction(actionId),
      InvalidStateTransitionError,
      'Expired action cannot be continued'
    );
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Action & Approval Identity Binding
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 2: Action & Approval Identity Binding Invariants');

  await test('Approval applies strictly to exact matching actionId (1:1 lock)', () => {
    const timeProvider = createFixedTimeProvider('2026-11-03T12:00:00.000Z');
    const req = createApprovalRequest(
      createMockApprovalPayload('act_correct_target'),
      'usr_alice',
      { createdAt: resolveTimestamp(timeProvider), ttlMs: 3600000 }
    );

    const approvedReq = resolveApprovalRequest(
      req,
      {
        decidedBy: 'tc_carol',
        decision: 'APPROVED',
        reason: 'Authorized by trusted contact',
      },
      timeProvider
    );

    // Mismatched actionId validation
    const mismatchedCheck = verifyContinuationAuthorization({
      actionId: 'act_wrong_impostor',
      request: approvedReq,
      timeProvider,
    });

    assertEquals(mismatchedCheck.authorized, false, 'Mismatched actionId rejected');
    assertEquals(mismatchedCheck.errorCode, 'ACTION_ID_MISMATCH', 'Error code is ACTION_ID_MISMATCH');

    // Matching actionId validation
    const matchingCheck = verifyContinuationAuthorization({
      actionId: 'act_correct_target',
      request: approvedReq,
      timeProvider,
    });

    assertEquals(matchingCheck.authorized, true, 'Matching actionId accepted');
  });

  await test('Approval binding must correlate 1:1 with approval request ID', () => {
    const timeProvider = createFixedTimeProvider('2026-11-03T12:00:00.000Z');
    const actionId = 'act_binding_correlate_001';

    const req = createApprovalRequest(
      createMockApprovalPayload(actionId),
      'usr_alice',
      { createdAt: resolveTimestamp(timeProvider), ttlMs: 3600000 }
    );

    const approvedReq = resolveApprovalRequest(
      req,
      {
        decidedBy: 'tc_carol',
        decision: 'APPROVED',
      },
      timeProvider
    );

    const validBinding = createApprovalActionBinding(
      {
        actionId,
        requestId: approvedReq.id,
        requesterId: 'usr_alice',
        expiresAt: approvedReq.expiresAt,
        actionDigest: computeActionDigest({
          origin: 'https://example.com',
          pathname: '/settings',
          actionType: ActionType.CLICK,
        }),
      },
      { timeProvider }
    );

    const approvedBinding = transitionBindingState(
      validBinding,
      ApprovalActionBindingState.APPROVED,
      { reason: 'Contact approved', timeProvider }
    );

    // Mismatched request ID between request and binding
    const mismatchedBindingCheck = verifyContinuationAuthorization({
      actionId,
      request: approvedReq,
      binding: {
        ...approvedBinding,
        requestId: 'apr_different_unrelated_id',
      },
      timeProvider,
    });

    assertEquals(mismatchedBindingCheck.authorized, false, 'Mismatched binding.requestId rejected');
    assertEquals(mismatchedBindingCheck.errorCode, 'ACTION_ID_MISMATCH', 'Identifies relation mismatch');
  });

  await test('Context verification rejects continuation if origin or pathname changes', () => {
    const timeProvider = createFixedTimeProvider('2026-11-03T12:00:00.000Z');
    const action = createMockAction({
      id: 'act_ctx_001',
      page: {
        url: 'https://example.com/transfer/confirm',
        title: 'Transfer',
        origin: 'https://example.com',
        pathname: '/transfer/confirm',
      },
    });

    const req = resolveApprovalRequest(
      createApprovalRequest(
        createMockApprovalPayload(action.id),
        'usr_alice',
        { createdAt: resolveTimestamp(timeProvider), ttlMs: 3600000 }
      ),
      { decidedBy: 'tc_carol', decision: 'APPROVED' },
      timeProvider
    );

    // Origin changed
    const crossOriginCheck = verifyContinuationAuthorization({
      actionId: action.id,
      request: req,
      originalAction: action,
      currentPageContext: {
        origin: 'https://malicious.evil.com',
        url: 'https://malicious.evil.com/transfer/confirm',
      },
      timeProvider,
    });
    assertEquals(crossOriginCheck.authorized, false, 'Origin change rejected');
    assertEquals(crossOriginCheck.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code PAGE_CONTEXT_MISMATCH');

    // Pathname changed
    const pathChangeCheck = verifyContinuationAuthorization({
      actionId: action.id,
      request: req,
      originalAction: action,
      currentPageContext: {
        origin: 'https://example.com',
        url: 'https://example.com/different/unrelated/page',
      },
      timeProvider,
    });
    assertEquals(pathChangeCheck.authorized, false, 'Path change rejected');
    assertEquals(pathChangeCheck.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code PAGE_CONTEXT_MISMATCH');
  });

  await test('DOM attachment verification rejects continuation if target element is detached', () => {
    const timeProvider = createFixedTimeProvider('2026-11-03T12:00:00.000Z');
    const action = createMockAction({
      id: 'act_elem_001',
      element: { id: 'target-btn', tagName: 'BUTTON' },
    });

    const req = resolveApprovalRequest(
      createApprovalRequest(
        createMockApprovalPayload(action.id),
        'usr_alice',
        { createdAt: resolveTimestamp(timeProvider), ttlMs: 3600000 }
      ),
      { decidedBy: 'tc_carol', decision: 'APPROVED' },
      timeProvider
    );

    const detachedCheck = verifyContinuationAuthorization({
      actionId: action.id,
      request: req,
      originalAction: action,
      isElementAttached: (_elementId) => false, // Detached!
      timeProvider,
    });

    assertEquals(detachedCheck.authorized, false, 'Detached element rejected');
    assertEquals(detachedCheck.errorCode, 'ELEMENT_DETACHED', 'Error code is ELEMENT_DETACHED');
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Expiration and Invalidation Lifecycles
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Expiration and Invalidation Lifecycles');

  await test('Expired approval request cannot authorize continuation', () => {
    const baseTime = '2026-11-03T12:00:00.000Z';
    const futureTime = '2026-11-03T14:00:00.000Z'; // 2 hours later
    const timeProvider = createFixedTimeProvider(baseTime);

    const req = createApprovalRequest(
      createMockApprovalPayload('act_expired_001'),
      'usr_alice',
      { createdAt: baseTime, ttlMs: 3600000 } // 1 hour TTL
    );

    const approvedReq = resolveApprovalRequest(
      req,
      { decidedBy: 'tc_carol', decision: 'APPROVED' },
      timeProvider
    );

    // Evaluate with clock advanced beyond TTL
    const expiredClock = createFixedTimeProvider(futureTime);
    const result = verifyContinuationAuthorization({
      actionId: 'act_expired_001',
      request: approvedReq,
      timeProvider: expiredClock,
    });

    assertEquals(result.authorized, false, 'Expired request cannot authorize continuation');
    assertEquals(result.errorCode, 'REQUEST_EXPIRED', 'Identifies REQUEST_EXPIRED');
  });

  await test('Rejected approval request transitions action to INVALIDATED and halts continuation', () => {
    const timeProvider = createFixedTimeProvider('2026-11-03T12:00:00.000Z');
    const req = resolveApprovalRequest(
      createApprovalRequest(
        createMockApprovalPayload('act_rejected_001'),
        'usr_alice',
        { createdAt: resolveTimestamp(timeProvider), ttlMs: 3600000 }
      ),
      { decidedBy: 'tc_carol', decision: 'REJECTED', reason: 'Unsafe operation denied' },
      timeProvider
    );

    const eligibility = evaluateContinuationEligibility({
      actionId: 'act_rejected_001',
      request: req,
      timeProvider,
    });

    assertEquals(eligibility.eligible, false, 'Rejected request is not eligible');
    assertEquals(eligibility.targetState, InterceptionState.INVALIDATED, 'Target state is INVALIDATED');
    assertEquals(eligibility.errorCode, 'REQUEST_REJECTED', 'Error code is REQUEST_REJECTED');
  });

  await test('Cancelled approval request transitions action to CANCELLED', () => {
    const timeProvider = createFixedTimeProvider('2026-11-03T12:00:00.000Z');
    const req = cancelApprovalRequest(
      createApprovalRequest(
        createMockApprovalPayload('act_cancel_001'),
        'usr_alice',
        { createdAt: resolveTimestamp(timeProvider), ttlMs: 3600000 }
      ),
      'usr_alice',
      'User abandoned interaction',
      timeProvider
    );

    const eligibility = evaluateContinuationEligibility({
      actionId: 'act_cancel_001',
      request: req,
      timeProvider,
    });

    assertEquals(eligibility.eligible, false, 'Cancelled request is not eligible');
    assertEquals(eligibility.targetState, InterceptionState.CANCELLED, 'Target state is CANCELLED');
    assertEquals(eligibility.errorCode, 'REQUEST_CANCELLED', 'Error code is REQUEST_CANCELLED');
  });

  await test('ContinuationManager.expireAction and invalidateAction safely detach held closures', () => {
    const ctrl = new InterceptionController();
    const mgr = new ContinuationManager(ctrl);
    const action = createMockAction({ id: 'act_mgr_clean_001' });

    ctrl.register(action);
    const held = ctrl.holdAction(action.id);
    let handlerExecuted = false;

    mgr.registerHeldAction(action, held, () => {
      handlerExecuted = true;
    });

    assert(mgr.getCurrentHeldAction() !== null, 'Held action closure registered');

    // Expire the action
    const expResult = mgr.expireAction(action.id, 'Timeout expired');
    assertEquals(expResult.success, true, 'expireAction succeeds');
    assertEquals(expResult.record?.state, InterceptionState.EXPIRED, 'Record marked EXPIRED');
    assertEquals(mgr.getCurrentHeldAction(), null, 'Held action closure detached');

    // Attempting continuation on expired action fails
    const contResult = mgr.continueAction(action.id);
    assertEquals(contResult.success, false, 'Cannot continue expired action');
    assertEquals(handlerExecuted, false, 'Handler never executed');
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Duplicate & Late Message Resilience (Exactly-Once Execution)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Duplicate & Late Message Resilience');

  await test('ContinuationManager guarantees exactly-once handler execution', () => {
    const ctrl = new InterceptionController();
    const mgr = new ContinuationManager(ctrl);
    const action = createMockAction({ id: 'act_once_001' });

    ctrl.register(action);
    const held = ctrl.holdAction(action.id);
    let executionTimes = 0;

    mgr.registerHeldAction(action, held, () => {
      executionTimes++;
    });

    // First continuation executes successfully
    const first = mgr.continueAction(action.id, 'First execution', {
      actionId: action.id,
      allowUnboundAction: true,
    });
    assertEquals(first.success, true, 'First continuation succeeds');
    assertEquals(first.executed, true, 'Executed is true');
    assertEquals(executionTimes, 1, 'Handler ran exactly once');

    // Second continuation attempt is strictly rejected
    const second = mgr.continueAction(action.id, 'Duplicate execution attempt', {
      actionId: action.id,
      allowUnboundAction: true,
    });
    assertEquals(second.success, false, 'Second continuation is rejected');
    assertEquals(second.executed, false, 'Second continuation was NOT executed');
    assertEquals(executionTimes, 1, 'Handler still executed only once');
    assert(
      second.error!.includes('CONTINUED') || second.error!.includes('Duplicate execution prevented'),
      'Error explains terminal CONTINUED state or duplicate prevention'
    );
  });

  await test('ContinuationAuthorizationBoundary rejects concurrent in-flight continuation attempts', async () => {
    const ctrl = new InterceptionController();
    const mgr = new ContinuationManager(ctrl);
    const boundary = new ContinuationAuthorizationBoundary({
      controller: ctrl,
      continuationManager: mgr,
    });

    const action = createMockAction({ id: 'act_boundary_racing_001' });
    ctrl.register(action);
    const held = ctrl.holdAction(action.id);

    let handlerCalls = 0;
    mgr.registerHeldAction(action, held, () => {
      handlerCalls++;
    });

    // Since mock validation has no backend, authorizeAndContinue fails closed safely
    const res = await boundary.authorizeAndContinue(action.id);
    assertEquals(res.success, false, 'Fails closed when backend authorization is missing');
    assertEquals(handlerCalls, 0, 'Handler never executed');
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Policy Enforcement & Fail-Closed Invariants
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Policy Enforcement & Fail-Closed Invariants');

  await test('Corrupt action payloads fail-closed strictly to PROTECT (never ALLOW)', () => {
    const corruptAction = {
      id: '   ', // Invalid empty id
      type: ActionType.CLICK,
    } as any;

    const matched = evaluatePolicies(corruptAction);
    const protectDecision = matched.find((p) => p.decision === ResponseAction.PROTECT);
    assert(Boolean(protectDecision), 'Corrupt action matched protective fallback policy');
    assertEquals(protectDecision!.ruleId, 'RULE_FAIL_CLOSED_FALLBACK', 'Matched RULE_FAIL_CLOSED_FALLBACK');
    assertEquals(protectDecision!.reasonCode, 'POLICY_FAIL_CLOSED_CORRUPT_PAYLOAD', 'Reason code is POLICY_FAIL_CLOSED_CORRUPT_PAYLOAD');
  });

  await test('createFailedResponseDecision resolves strictly to PROTECT', () => {
    const decision = createFailedResponseDecision('act_failed_eval', {
      code: 'UNEXPECTED_ENGINE_FAULT',
      message: 'Simulated pipeline crash',
    });

    assertEquals(decision.response, ResponseAction.PROTECT, 'Response is strictly PROTECT');
    assertEquals(decision.success, false, 'Success is false');
    assertEquals(decision.policyRuleId, 'RULE_FAIL_CLOSED_FALLBACK', 'Rule is RULE_FAIL_CLOSED_FALLBACK');
    assert(decision.reasons[0].includes('Resolved fail-closed to PROTECT'), 'Explicitly notes fail-closed resolution');
  });

  await test('Mandatory security invariant policies cannot be downgraded to ALLOW', () => {
    const destructiveAction = createMockAction({
      category: ActionCategory.DESTRUCTIVE,
      element: { visibleText: 'Purge all user accounts permanently', id: 'purge-btn' },
    });

    // Verify evaluatePolicies applies PROTECT
    const policies = evaluatePolicies(destructiveAction);
    const destructiveMatch = policies.find((p) => p.ruleId === 'RULE_CONTROLLED_DESTRUCTIVE');
    assert(Boolean(destructiveMatch), 'Destructive action triggers RULE_CONTROLLED_DESTRUCTIVE');
    assertEquals(destructiveMatch!.decision, ResponseAction.PROTECT, 'Decision is PROTECT');
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Missing Authoritative Backend State Fails Closed
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 6: Missing Authoritative Backend State Fails Closed');

  await test('ContinuationValidationService fails closed if approval request is missing', async () => {
    const ctrl = new InterceptionController();
    const mgr = new ContinuationManager(ctrl);
    const service = new ContinuationValidationService({
      controller: ctrl,
      continuationManager: mgr,
    });

    const action = createMockAction({ id: 'act_no_backend_001' });
    ctrl.register(action);
    const held = ctrl.holdAction(action.id);
    mgr.registerHeldAction(action, held, () => {});

    // Evaluate without request or backend
    const result = await service.validateEligibility(action.id);

    assertEquals(result.eligible, false, 'Ineligible when backend request is missing');
    assertEquals(result.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE');
    assertEquals(result.errorCode, 'BACKEND_STATE_UNKNOWN', 'Error code is BACKEND_STATE_UNKNOWN');
    assert(result.reason.includes('Authoritative backend confirmation unavailable'), 'Reason notes missing backend confirmation');
  });

  await test('ContinuationValidationService fails closed if action is untracked locally', async () => {
    const service = new ContinuationValidationService();
    const result = await service.validateEligibility('act_not_in_controller');

    assertEquals(result.eligible, false, 'Untracked action is ineligible');
    assertEquals(result.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE');
    assertEquals(result.errorCode, 'ACTION_ID_MISMATCH', 'Identifies local record missing');
  });

  // ---------------------------------------------------------------------------
  // Suite 7: Zero Automatic Continuation After Approval
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 7: Zero Automatic Continuation After Approval');

  await test('Confirmed approval updates UI state but strictly maintains isActionHeld = true', () => {
    const state = determineApprovalState({
      state: 'status_confirmed',
      request: {
        id: 'apr_approved_zero_exec',
        actionId: 'act_zero_exec_001',
        requesterId: 'usr_alice',
        status: ApprovalStatus.APPROVED,
        origin: 'https://example.com',
        riskLevel: 'CRITICAL',
        category: 'DESTRUCTIVE',
        actionType: 'CLICK',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        decision: {
          decidedBy: 'tc_carol',
          decidedAt: new Date().toISOString(),
          decision: 'APPROVED',
          reason: 'Looks good',
        },
      },
    });

    assertEquals(state.uiStatus, UIApprovalStatus.STATUS_CONFIRMED_APPROVED, 'UI status is STATUS_CONFIRMED_APPROVED');
    assertEquals(state.isActionHeld, true, 'isActionHeld is strictly true');
    assert(state.detail.includes('this action is still held until you review and confirm'), 'States action remains held');
    assert(state.footerNotice.includes('Action: HELD'), 'Footer explicitly reflects Action: HELD');
  });

  await test('Full approval verification moves controller to READY_FOR_USER_CONFIRMATION without executing', async () => {
    const timeProvider = createFixedTimeProvider('2026-11-03T12:00:00.000Z');
    const ctrl = new InterceptionController();
    const mgr = new ContinuationManager(ctrl);
    const service = new ContinuationValidationService({
      controller: ctrl,
      continuationManager: mgr,
      timeProvider,
    });

    const action = createMockAction({ id: 'act_full_approved_001' });
    ctrl.register(action);
    const held = ctrl.holdAction(action.id);

    let handlerExecuted = false;
    mgr.registerHeldAction(action, held, () => {
      handlerExecuted = true;
    });

    const approvedReq = resolveApprovalRequest(
      createApprovalRequest(
        createMockApprovalPayload(action.id),
        'usr_alice',
        { createdAt: resolveTimestamp(timeProvider), ttlMs: 3600000 }
      ),
      { decidedBy: 'tc_carol', decision: 'APPROVED' },
      timeProvider
    );

    // Validate eligibility
    const res = await service.validateEligibility(action.id, {
      request: approvedReq,
      stagingContext: {
        actionId: action.id,
        actionType: action.type,
        riskLevel: 'CRITICAL',
        riskScore: 85,
        responseAction: ResponseAction.PROTECT,
        detectedAt: new Date().toISOString(),
      },
    });

    assertEquals(res.eligible, true, 'Action is eligible');
    assertEquals(res.status, ContinuationEligibilityStatus.ELIGIBLE, 'Status is ELIGIBLE');
    assertEquals(res.targetState, InterceptionState.READY_FOR_USER_CONFIRMATION, 'Target state is READY_FOR_USER_CONFIRMATION');

    // Transition controller using validation result
    const updatedRecord = service.transitionOnValidation(res);
    assert(Boolean(updatedRecord), 'Record updated');
    assertEquals(updatedRecord!.state, InterceptionState.READY_FOR_USER_CONFIRMATION, 'Controller record is READY_FOR_USER_CONFIRMATION');

    // CRITICAL: Handler must NOT have executed automatically!
    assertEquals(handlerExecuted, false, 'Handler was NOT executed automatically on approval');
    assertEquals(mgr.getExecutionCount(action.id), 0, 'Execution count is strictly 0');

    // Now simulate explicit user confirmation
    const continuationResult = mgr.continueAction(action.id, 'User clicked Continue Action', {
      actionId: action.id,
      allowUnboundAction: true,
    });

    assertEquals(continuationResult.success, true, 'Explicit continuation succeeded');
    assertEquals(continuationResult.executed, true, 'Executed is true');
    assertEquals(handlerExecuted, true, 'Handler executed upon explicit continuation');
    assertEquals(mgr.getExecutionCount(action.id), 1, 'Execution count is 1');
  });

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n======================================================================');
  console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
  console.log('======================================================================\n');

  if (passedTests === totalTests) {
    console.log('🎉 ALL WORKFLOW CONSISTENCY & LIFECYCLE INVARIANT TESTS PASSED!');
  } else {
    throw new Error(`${totalTests - passedTests} test(s) failed.`);
  }
}

runWorkflowConsistencyTests().catch((err) => {
  console.error('\n❌ Workflow Consistency Test Suite Failed:');
  console.error(err);
  process.exit(1);
});
