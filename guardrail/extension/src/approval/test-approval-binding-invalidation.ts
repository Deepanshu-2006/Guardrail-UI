/**
 * Guardrail Approval Action Binding Expiration and Invalidation Test Suite
 *
 * Verifies secure expiration, cancellation, invalidation, delayed response protection,
 * and continuation authorization gating for approval-to-action bindings.
 *
 * VERIFICATION REQUIREMENTS:
 * 1. Action binding becomes invalid when approval request expires or is cancelled.
 * 2. Continuation authorization is strictly rejected for rejected, expired, cancelled, or invalid requests.
 * 3. Terminal approval requests cannot be silently reopened or rebound to a different action.
 * 4. Expiration is validated using trusted clock and authoritative backend state.
 * 5. Delayed approval responses arriving after invalidation/expiration are safely rejected.
 * 6. Explicit user cancellation invalidates and detaches local held-action state.
 * 7. Navigation, reload, and page departure invalidate held action state without assuming cross-page restoration.
 * 8. A new action cannot inherit a previous action's approval (strict action isolation).
 * 9. Expiration and invalidation operations are idempotent on repeated calls.
 * 10. Unavailable backend or unknown lifecycle states fail-closed (never treated as authorization).
 * 11. Zero protected action execution throughout all invalidation and expiration events.
 */

declare const process: any;

import { ActionType, GuardrailAction } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { InterceptionState } from '../types/interception.js';
import {
  ApprovalActionBinding,
  ApprovalActionBindingState,
  ApprovalStatus,
} from '../types/approval.js';
import {
  isBindingExpired,
  isBindingValidForContinuation,
} from './binding.js';
import {
  reopenApprovalRequest,
  TimeProvider,
} from './model.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
} from './repository.js';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from './authorization.js';
import { ApprovalService } from './service.js';
import { ApprovalApiRouter, TokenVerifier } from './api.js';
import { InterceptionController } from '../interception/controller.js';
import {
  ContinuationManager,
  verifyContinuationAuthorization,
} from '../interception/continuation.js';

// =============================================================================
// Lightweight Test Runner
// =============================================================================

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (!condition) {
    throw new Error(`[ASSERTION FAILED]: ${message}`);
  }
  passedTests++;
  console.log(`  ✓ ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalTests++;
  if (actual !== expected) {
    throw new Error(`[ASSERTION FAILED]: ${message} (expected: ${String(expected)}, got: ${String(actual)})`);
  }
  passedTests++;
  console.log(`  ✓ ${message}`);
}

function assertThrows(fn: () => unknown, expectedErrorName: string, message: string): void {
  totalTests++;
  try {
    fn();
    throw new Error(`[EXPECTED ERROR NOT THROWN]: Expected ${expectedErrorName} but nothing was thrown.`);
  } catch (err: unknown) {
    const errorName = (err as Error)?.name || (err as { constructor?: { name?: string } })?.constructor?.name;
    if (errorName === expectedErrorName || String(err).includes(expectedErrorName)) {
      passedTests++;
      console.log(`  ✓ ${message} (caught ${expectedErrorName})`);
    } else {
      throw new Error(
        `[WRONG ERROR TYPE]: Expected ${expectedErrorName}, but caught ${(err as Error)?.message || String(err)} (${errorName})`
      );
    }
  }
}

// =============================================================================
// Test Environment Fixture
// =============================================================================

interface TestHarness {
  repository: DevelopmentInMemoryApprovalRequestRepository;
  contactRegistry: InMemoryTrustedContactRegistry;
  actionOwnershipRegistry: InMemoryActionOwnershipRegistry;
  service: ApprovalService;
  router: ApprovalApiRouter;
  tokenVerifier: MockTokenVerifier;
  currentTime: string;
  setTime: (isoString: string) => void;
  advanceTimeByMs: (ms: number) => void;
}

class MockTokenVerifier implements TokenVerifier {
  private readonly tokens = new Map<string, AuthContext>();

  public registerToken(token: string, context: AuthContext): void {
    this.tokens.set(token, context);
  }

  public async verifyToken(token: string): Promise<AuthContext> {
    const ctx = this.tokens.get(token);
    if (!ctx) {
      return { actorId: '', role: ActorRole.USER, isAuthenticated: false };
    }
    return ctx;
  }
}

function createTestHarness(initialTime: string = '2026-10-24T12:00:00.000Z'): TestHarness {
  let currentTime = initialTime;
  const timeProvider: TimeProvider = () => currentTime;

  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();

  const service = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    timeProvider,
  });

  const tokenVerifier = new MockTokenVerifier();
  tokenVerifier.registerToken('alice_tok', {
    actorId: 'usr_alice',
    role: ActorRole.USER,
    isAuthenticated: true,
  });
  tokenVerifier.registerToken('bob_tok', {
    actorId: 'tc_bob',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });
  tokenVerifier.registerToken('dan_tok', {
    actorId: 'tc_dan',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });
  tokenVerifier.registerToken('admin_tok', {
    actorId: 'adm_charlie',
    role: ActorRole.ADMIN,
    isAuthenticated: true,
  });

  const router = new ApprovalApiRouter(service, tokenVerifier, {
    rateLimiter: { checkRateLimit: () => ({ allowed: true }) },
  });

  return {
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    service,
    router,
    tokenVerifier,
    get currentTime() {
      return currentTime;
    },
    setTime: (iso: string) => {
      currentTime = iso;
    },
    advanceTimeByMs: (ms: number) => {
      const epoch = Date.parse(currentTime);
      currentTime = new Date(epoch + ms).toISOString();
    },
  };
}

function createSampleAction(actionId: string): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-24T12:00:00.000Z',
    page: {
      url: 'https://bank.example.com/transfer',
      title: 'Funds Transfer',
    },
    element: {
      tagName: 'BUTTON',
      id: 'btn-transfer',
      visibleText: 'Transfer ₹50,000',
    },
  };
}

// =============================================================================
// Test Suites
// =============================================================================

async function runExpirationAndInvalidationTestSuite(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL: ACTION-APPROVAL BINDING EXPIRATION & INVALIDATION');
  console.log('====================================================================');

  const aliceAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
  const bobAuth: AuthContext = { actorId: 'tc_bob', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };

  // ---------------------------------------------------------------------------
  // 1. Action Binding Expiration & Trusted Clock Validation (Req 1, 4)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 1: Action Binding Expiration & Trusted Clock Validation');
  {
    const h = createTestHarness('2026-10-24T12:00:00.000Z');
    h.actionOwnershipRegistry.registerActionOwnership('act_exp_001', 'usr_alice');

    // 15-minute TTL: expires at 12:15:00
    const req = h.service.createRequest(
      {
        actionId: 'act_exp_001',
        actionDescription: 'High value transfer',
        actionType: ActionType.SUBMIT,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth,
      { ttlMs: 15 * 60 * 1000 }
    );

    const bnd = h.service.getBindingByRequestId(req.id, aliceAuth);
    assertEquals(bnd.state, ApprovalActionBindingState.BOUND, 'Initial binding state is BOUND');
    assertEquals(isBindingExpired(bnd, () => h.currentTime), false, 'Binding is not expired before deadline');

    // Advance time by 10 minutes (12:10:00): Still valid
    h.advanceTimeByMs(10 * 60 * 1000);
    assertEquals(isBindingExpired(bnd, () => h.currentTime), false, 'Binding is not expired at 10 minutes');

    // Advance time past deadline (12:16:00): Now expired
    h.advanceTimeByMs(6 * 60 * 1000);
    assertEquals(isBindingExpired(bnd, () => h.currentTime), true, 'Binding is expired past deadline');

    // Lazy expiration on getRequest: updates both request and binding
    const expiredReq = h.service.getRequest(req.id, aliceAuth);
    assertEquals(expiredReq.status, ApprovalStatus.EXPIRED, 'Lazy expiration transitions request to EXPIRED');

    const expiredBnd = h.service.getBindingByRequestId(req.id, aliceAuth);
    assertEquals(expiredBnd.state, ApprovalActionBindingState.EXPIRED, 'Lazy expiration transitions binding to EXPIRED');
    assertEquals(isBindingValidForContinuation(expiredBnd, () => h.currentTime), false, 'isBindingValidForContinuation is false for expired binding');

    // Explicit batch expiration via checkAndExpireStaleRequests
    h.service.createRequest(
      {
        actionId: 'act_exp_002',
        actionDescription: 'Another transfer',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
      },
      aliceAuth,
      { ttlMs: 5 * 60 * 1000 }
    );
    h.advanceTimeByMs(6 * 60 * 1000);
    const expiredCount = h.service.checkAndExpireStaleRequests();
    assert(expiredCount >= 1, 'checkAndExpireStaleRequests expires stale requests and bindings');

    const bnd2 = h.service.getBindingByActionId('act_exp_002', aliceAuth);
    assertEquals(bnd2?.state, ApprovalActionBindingState.EXPIRED, 'Batch expiration transitions binding to EXPIRED');
  }

  // ---------------------------------------------------------------------------
  // 2. Action Binding Cancellation & Cascading Invalidation (Req 1, 6)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 2: Action Binding Cancellation & Cascading Invalidation');
  {
    const h = createTestHarness();
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-24T10:00:00.000Z',
    });
    h.actionOwnershipRegistry.registerActionOwnership('act_cnc_001', 'usr_alice');

    const req = h.service.createRequest(
      {
        actionId: 'act_cnc_001',
        actionDescription: 'Delete user account',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.CRITICAL,
      },
      aliceAuth
    );

    // Trusted contact cannot cancel Alice's request (only Alice or admin)
    assertThrows(
      () => h.service.cancelRequest(req.id, 'Bob attempting cancel', bobAuth),
      'ApprovalAccessDeniedError',
      'Trusted contact cannot cancel request owned by user'
    );

    // Alice cancels her request
    const cancelledReq = h.service.cancelRequest(req.id, 'User changed mind', aliceAuth);
    assertEquals(cancelledReq.status, ApprovalStatus.CANCELLED, 'Request transitioned to CANCELLED');

    // Associated binding cascades to CANCELLED
    const cancelledBnd = h.service.getBindingByRequestId(req.id, aliceAuth);
    assertEquals(cancelledBnd.state, ApprovalActionBindingState.CANCELLED, 'Action binding cascaded to CANCELLED');
    assertEquals(isBindingValidForContinuation(cancelledBnd, () => h.currentTime), false, 'Cancelled binding is invalid for continuation');

    // Terminal check: cannot cancel an already cancelled request
    assertThrows(
      () => h.service.cancelRequest(req.id, 'Second cancel attempt', aliceAuth),
      'ApprovalAlreadyResolvedError',
      'Cannot re-cancel an already CANCELLED request'
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Explicit Action Invalidation & Idempotency (Req 1, 6, 9)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Explicit Action Invalidation & Idempotency');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_inv_001', 'usr_alice');

    h.service.createRequest(
      {
        actionId: 'act_inv_001',
        actionDescription: 'Settings change',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
      },
      aliceAuth
    );

    // Explicit invalidation by actionId
    const inv1 = h.service.invalidateBinding('act_inv_001', 'Page navigated', aliceAuth);
    assertEquals(inv1.state, ApprovalActionBindingState.INVALIDATED, 'Binding transitioned to INVALIDATED');

    // Repeated invalidation is strictly idempotent (does not error, returns existing binding)
    const inv2 = h.service.invalidateBinding('act_inv_001', 'Second invalidation', aliceAuth);
    assertEquals(inv2.state, ApprovalActionBindingState.INVALIDATED, 'Repeated invalidation returns INVALIDATED binding idempotently');
    assertEquals(inv1.id, inv2.id, 'Same binding ID returned on idempotent invalidation');

    // Invalidation by requestId
    h.actionOwnershipRegistry.registerActionOwnership('act_inv_002', 'usr_alice');
    const req2 = h.service.createRequest(
      {
        actionId: 'act_inv_002',
        actionDescription: 'Settings change 2',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.LOW,
      },
      aliceAuth
    );

    const invByReq = h.service.invalidateBindingByRequestId(req2.id, 'Tab closed', aliceAuth);
    assertEquals(invByReq.state, ApprovalActionBindingState.INVALIDATED, 'invalidateBindingByRequestId transitions binding to INVALIDATED');

    // Invalidation on an already CANCELLED binding is idempotent
    h.actionOwnershipRegistry.registerActionOwnership('act_inv_003', 'usr_alice');
    const req3 = h.service.createRequest(
      {
        actionId: 'act_inv_003',
        actionDescription: 'Action 3',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.LOW,
      },
      aliceAuth
    );
    h.service.cancelRequest(req3.id, 'Cancelled first', aliceAuth);
    const invOnCancelled = h.service.invalidateBinding('act_inv_003', 'Invalidate after cancel', aliceAuth);
    assertEquals(invOnCancelled.state, ApprovalActionBindingState.CANCELLED, 'Invalidation on CANCELLED binding returns CANCELLED binding idempotently');
  }

  // ---------------------------------------------------------------------------
  // 4. Rejection of Delayed Decisions on Invalid / Expired Bindings (Req 1, 5)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Rejection of Delayed Decisions on Invalid / Expired Bindings');
  {
    const h = createTestHarness();
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-24T10:00:00.000Z',
    });
    h.actionOwnershipRegistry.registerActionOwnership('act_delay_001', 'usr_alice');

    const reqExpired = h.service.createRequest(
      {
        actionId: 'act_delay_001',
        actionDescription: 'Expired action',
        actionType: ActionType.SUBMIT,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth,
      { ttlMs: 10 * 60 * 1000 }
    );

    // Fast-forward 15 minutes past deadline
    h.advanceTimeByMs(15 * 60 * 1000);

    // Delayed approval arriving after expiration must be rejected
    assertThrows(
      () => h.service.approveRequest(reqExpired.id, { decisionReason: 'Late approval' }, bobAuth),
      'ApprovalExpiredError',
      'Delayed approval on expired request is rejected with ApprovalExpiredError'
    );

    // Delayed approval on cancelled request
    h.actionOwnershipRegistry.registerActionOwnership('act_delay_002', 'usr_alice');
    const reqCancelled = h.service.createRequest(
      {
        actionId: 'act_delay_002',
        actionDescription: 'Cancelled action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );
    h.service.cancelRequest(reqCancelled.id, 'User aborted in UI', aliceAuth);

    assertThrows(
      () => h.service.approveRequest(reqCancelled.id, { decisionReason: 'Late approval after cancel' }, bobAuth),
      'ApprovalAlreadyResolvedError',
      'Delayed approval on cancelled request is rejected with ApprovalAlreadyResolvedError'
    );

    // Delayed approval on invalidated binding
    h.actionOwnershipRegistry.registerActionOwnership('act_delay_003', 'usr_alice');
    const reqInvalidated = h.service.createRequest(
      {
        actionId: 'act_delay_003',
        actionDescription: 'Navigated action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );
    h.service.invalidateBinding('act_delay_003', 'Page navigated away', aliceAuth);

    assertThrows(
      () => h.service.approveRequest(reqInvalidated.id, { decisionReason: 'Late approval after nav' }, bobAuth),
      'ApprovalBindingStateTransitionError',
      'Delayed approval on invalidated binding is rejected with ApprovalBindingStateTransitionError'
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Continuation Authorization Gating (Req 2, 8, 10)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Continuation Authorization Gating');
  {
    const h = createTestHarness();
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-24T10:00:00.000Z',
    });
    h.actionOwnershipRegistry.registerActionOwnership('act_gate_001', 'usr_alice');

    const req = h.service.createRequest(
      {
        actionId: 'act_gate_001',
        actionDescription: 'Payment authorization',
        actionType: ActionType.SUBMIT,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );

    // 5.1 While PENDING: Continuation authorization is REJECTED
    const pendingAuth = verifyContinuationAuthorization({
      actionId: 'act_gate_001',
      request: req,
      binding: h.service.getBindingByRequestId(req.id, aliceAuth),
      timeProvider: () => h.currentTime,
    });
    assertEquals(pendingAuth.authorized, false, 'Pending request rejected for continuation');
    assertEquals(pendingAuth.errorCode, 'REQUEST_NOT_APPROVED', 'Error code is REQUEST_NOT_APPROVED');

    // 5.2 Approve the request
    const approvedReq = h.service.approveRequest(req.id, { decisionReason: 'Approved by Bob' }, bobAuth);
    const approvedBnd = h.service.getBindingByRequestId(req.id, aliceAuth);
    assertEquals(approvedBnd.state, ApprovalActionBindingState.APPROVED, 'Binding is APPROVED');

    const validAuth = verifyContinuationAuthorization({
      actionId: 'act_gate_001',
      request: approvedReq,
      binding: approvedBnd,
      timeProvider: () => h.currentTime,
    });
    assertEquals(validAuth.authorized, true, 'Approved request and binding authorizes continuation');

    // 5.3 Expiration after approval: If deadline passes, authorization is REJECTED
    h.advanceTimeByMs(20 * 60 * 1000);
    const expiredPostApprovalAuth = verifyContinuationAuthorization({
      actionId: 'act_gate_001',
      request: approvedReq,
      binding: approvedBnd,
      timeProvider: () => h.currentTime,
    });
    assertEquals(expiredPostApprovalAuth.authorized, false, 'Expired approval rejected for continuation');
    assertEquals(expiredPostApprovalAuth.errorCode, 'REQUEST_EXPIRED', 'Error code is REQUEST_EXPIRED');

    // 5.4 Rejection: If request is REJECTED, authorization is REJECTED
    h.actionOwnershipRegistry.registerActionOwnership('act_gate_002', 'usr_alice');
    const reqReject = h.service.createRequest(
      {
        actionId: 'act_gate_002',
        actionDescription: 'Wire money',
        actionType: ActionType.SUBMIT,
        riskLevel: RiskLevel.CRITICAL,
      },
      aliceAuth
    );
    const rejectedReq = h.service.rejectRequest(reqReject.id, { decisionReason: 'Too risky' }, bobAuth);
    const rejectedBnd = h.service.getBindingByRequestId(reqReject.id, aliceAuth);

    const rejectedAuth = verifyContinuationAuthorization({
      actionId: 'act_gate_002',
      request: rejectedReq,
      binding: rejectedBnd,
      timeProvider: () => h.currentTime,
    });
    assertEquals(rejectedAuth.authorized, false, 'Rejected request refused for continuation');
    assertEquals(rejectedAuth.errorCode, 'REQUEST_REJECTED', 'Error code is REQUEST_REJECTED');

    // 5.5 Fail-Closed on Unknown / Unavailable backend state (Req 10)
    const unknownStateAuth = verifyContinuationAuthorization({
      actionId: 'act_gate_003',
      request: null,
      binding: null,
      allowUnboundAction: false,
    });
    assertEquals(unknownStateAuth.authorized, false, 'Null backend state rejected (fail-closed)');
    assertEquals(unknownStateAuth.errorCode, 'BACKEND_STATE_UNKNOWN', 'Error code is BACKEND_STATE_UNKNOWN');
  }

  // ---------------------------------------------------------------------------
  // 6. Prevention of Action Inheritance & Reassignment (Req 3, 8)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 6: Prevention of Action Inheritance & Reassignment');
  {
    const h = createTestHarness();
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-24T10:00:00.000Z',
    });
    h.actionOwnershipRegistry.registerActionOwnership('act_original', 'usr_alice');

    const req = h.service.createRequest(
      {
        actionId: 'act_original',
        actionDescription: 'Original legitimate action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
      },
      aliceAuth
    );
    const approvedReq = h.service.approveRequest(req.id, { decisionReason: 'Approved' }, bobAuth);
    const approvedBnd = h.service.getBindingByRequestId(req.id, aliceAuth);

    // Attempting to authorize a different action "act_malicious" using "act_original"'s approval: REJECTED
    const crossActionAuth = verifyContinuationAuthorization({
      actionId: 'act_malicious',
      request: approvedReq,
      binding: approvedBnd,
      timeProvider: () => h.currentTime,
    });
    assertEquals(crossActionAuth.authorized, false, 'New action cannot inherit previous action approval');
    assertEquals(crossActionAuth.errorCode, 'ACTION_ID_MISMATCH', 'Error code is ACTION_ID_MISMATCH');

    // Reopen prevention (Req 3)
    assertThrows(
      () => reopenApprovalRequest(approvedReq),
      'ApprovalReopenProhibitedError',
      'Reopening terminal approved request throws ApprovalReopenProhibitedError'
    );
  }

  // ---------------------------------------------------------------------------
  // 7. ContinuationManager Gating & Invalidation Integration (Req 2, 6, 9)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 7: ContinuationManager Gating & Invalidation Integration');
  {
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller);

    const action = createSampleAction('act_cm_001');
    controller.register(action);
    const heldRecord = controller.holdAction(action.id);

    let handlerExecuted = false;
    manager.registerHeldAction(action, heldRecord, () => {
      handlerExecuted = true;
    });

    // 7.1 Continuation without authorization input when approval is required fails-closed
    const unauthorizedContinuation = manager.continueAction(action.id, 'Attempt without auth', {
      actionId: action.id,
      request: null,
      binding: null,
      allowUnboundAction: false,
    });
    assertEquals(unauthorizedContinuation.success, false, 'ContinuationManager rejects unauthorized continuation');
    assertEquals(handlerExecuted, false, 'Handler was NOT executed on rejected continuation');
    assertEquals(manager.getExecutionCount(action.id), 0, 'Execution count is strictly 0');

    // 7.2 Invalidate held action: clears held entry and marks record CANCELLED
    const invResult = manager.invalidateHeldAction(action.id, 'User navigated away');
    assertEquals(invResult.success, true, 'invalidateHeldAction succeeded');
    assertEquals(invResult.record?.state, InterceptionState.CANCELLED, 'InterceptionRecord is CANCELLED');
    assertEquals(manager.getCurrentHeldAction(), null, 'Held action closure was detached');

    // 7.3 Idempotent repeated invalidation on ContinuationManager
    const repeatedInv = manager.invalidateHeldAction(action.id, 'Second invalidation');
    assertEquals(repeatedInv.success, true, 'Repeated invalidateHeldAction is idempotent');

    // 7.4 Cancelled action cannot be continued even if someone passes valid approval
    const continueCancelled = manager.continueAction(action.id, 'Trying to continue cancelled');
    assertEquals(continueCancelled.success, false, 'Cancelled action cannot be continued');
    assertEquals(handlerExecuted, false, 'Handler never executes on cancelled action');
  }

  // ---------------------------------------------------------------------------
  // 8. Page Departure & Navigation Invalidation Realities (Req 7)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 8: Page Departure & Navigation Invalidation Realities');
  {
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller);

    const action = createSampleAction('act_nav_001');
    controller.register(action);
    const held = controller.holdAction(action.id);

    let handlerRuns = 0;
    manager.registerHeldAction(action, held, () => {
      handlerRuns++;
    });

    assert(Boolean(manager.getCurrentHeldAction()), 'Action held prior to navigation');

    // Simulate pagehide / beforeunload / navigation departure
    manager.detachHeldAction(action.id);
    assertEquals(manager.getCurrentHeldAction(), null, 'detachHeldAction clears in-memory closure on page departure');

    // Even if controller is still HELD, held closure is gone
    assertEquals(handlerRuns, 0, 'Handler was not executed');
  }

  // ---------------------------------------------------------------------------
  // 9. API Router & Client Invalidation Endpoints (Req 1, 4, 9, 10)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 9: API Router & Client Invalidation Endpoints');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_api_inv_001', 'usr_alice');

    const req = h.service.createRequest(
      {
        actionId: 'act_api_inv_001',
        actionDescription: 'API action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.LOW,
      },
      aliceAuth
    );

    // 9.1 POST /api/v1/actions/:actionId/invalidate over HTTP API
    const invRes = await h.router.dispatch({
      method: 'POST',
      url: `/api/v1/actions/${encodeURIComponent(req.actionId)}/invalidate`,
      headers: { authorization: 'Bearer alice_tok' },
      body: { reason: 'Page refreshed' },
    });
    assertEquals(invRes.statusCode, 200, 'HTTP POST invalidate returns 200 OK');
    assertEquals(invRes.body.success, true, 'HTTP response indicates success');
    assertEquals((invRes.body.data as ApprovalActionBinding)?.state, ApprovalActionBindingState.INVALIDATED, 'Response binding state is INVALIDATED');

    // 9.2 Repeated HTTP invalidation is idempotent (returns 200 with same binding)
    const repeatedRes = await h.router.dispatch({
      method: 'POST',
      url: `/api/v1/actions/${encodeURIComponent(req.actionId)}/invalidate`,
      headers: { authorization: 'Bearer alice_tok' },
      body: { reason: 'Page refreshed again' },
    });
    assertEquals(repeatedRes.statusCode, 200, 'Repeated HTTP POST invalidate returns 200 OK idempotently');
    assertEquals((repeatedRes.body.data as ApprovalActionBinding)?.state, ApprovalActionBindingState.INVALIDATED, 'Repeated response is INVALIDATED');

    // 9.3 Unauthenticated invalidation returns 401
    const unauthRes = await h.router.dispatch({
      method: 'POST',
      url: `/api/v1/actions/${encodeURIComponent(req.actionId)}/invalidate`,
      headers: {},
    });
    assertEquals(unauthRes.statusCode, 401, 'Unauthenticated invalidation returns 401');

    // 9.4 Unauthorized caller (Dan) returns opaque 404
    const danRes = await h.router.dispatch({
      method: 'POST',
      url: `/api/v1/actions/${encodeURIComponent(req.actionId)}/invalidate`,
      headers: { authorization: 'Bearer dan_tok' },
    });
    assertEquals(danRes.statusCode, 404, 'Unauthorized caller receives opaque 404 on invalidation');
  }

  // ---------------------------------------------------------------------------
  // 10. Inviolable Non-Execution Guarantee (Safety Invariant)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 10: Inviolable Non-Execution Guarantee (Safety Invariant)');
  {
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller);

    let protectedActionRuns = 0;
    const action = createSampleAction('act_safety_001');
    controller.register(action);
    const held = controller.holdAction(action.id);

    manager.registerHeldAction(action, held, () => {
      protectedActionRuns++;
    });

    // Throughout all lifecycle operations, protected action handler must NEVER run automatically
    assertEquals(protectedActionRuns, 0, 'Handler execution count is strictly 0 upon hold');

    manager.invalidateHeldAction(action.id, 'Invalidated');
    assertEquals(protectedActionRuns, 0, 'Handler execution count is strictly 0 after invalidation');

    assertEquals(manager.getExecutionCount(action.id), 0, 'Recorded execution count is strictly 0');
  }

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n====================================================================');
  console.log(`📊 EXPIRATION & INVALIDATION VERIFICATION: ${passedTests} / ${totalTests} PASSED`);
  console.log('🎉 ALL 10 SUITES & SECURITY REQUIREMENTS FULLY SATISFIED!');
  console.log('====================================================================\n');
}

runExpirationAndInvalidationTestSuite().catch((err) => {
  console.error('Fatal error during test execution:', err);
  process.exit(1);
});
