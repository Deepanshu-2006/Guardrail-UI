/**
 * Guardrail Continuation Validation Service Comprehensive Security Test Suite
 *
 * Verifies the dedicated validation service determining whether a held action is
 * eligible for controlled continuation against all 10 mandatory conditions:
 *
 * 1. The approval request exists.
 * 2. The backend has authoritatively confirmed the approval decision.
 * 3. The authenticated user and workflow are authorized to access the request.
 * 4. The approval request is bound to the exact expected action.
 * 5. The binding has not been reassigned, cancelled, expired, or invalidated.
 * 6. The held-action record still exists and corresponds to the same action.
 * 7. The action remains in a permitted lifecycle state.
 * 8. The relevant page or action context has not changed in a way that invalidates the authorization.
 * 9. The action has not already been continued or consumed (exactly-once execution).
 * 10. All existing risk-engine and staging requirements remain satisfied.
 *
 * Safety Invariants Tested:
 * - FAIL CLOSED: Network failures, timeouts, missing backend, or malformed data never treated as approval.
 * - STRICT NON-EXECUTION: Validation service NEVER triggers or executes the action callback.
 * - TRUSTED SERVER CLOCK: Expiration determined authoritatively via server clock.
 * - MULTI-DIMENSIONAL IDENTITY: Hostname/URL alone is never treated as proof of action identity.
 * - DOCUMENTED LIMITATIONS: Returns all 6 explicit architectural boundaries on every result.
 */

declare const process: any;

import { ActionType, GuardrailAction } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { InterceptionState } from '../types/interception.js';
import {
  ApprovalActionBindingState,
  BackendContinuationValidationResult,
} from '../types/approval.js';
import { TimeProvider } from '../approval/model.js';
import { DevelopmentInMemoryApprovalRequestRepository } from '../approval/repository.js';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from '../approval/authorization.js';
import { ApprovalService } from '../approval/service.js';
import { ApprovalApiClient, ApiClientResult, ApiClientErrorCodes } from '../approval/client.js';
import { InterceptionController } from './controller.js';
import { ContinuationManager } from './continuation.js';
import {
  ContinuationValidationService,
  ContinuationEligibilityStatus,
  CONTINUATION_VALIDATION_LIMITATIONS,
} from './validation-service.js';
import { StagingActionContext } from '../types/staging.js';

// =============================================================================
// Test Assertion Framework
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

// =============================================================================
// Test Harness Setup
// =============================================================================

interface TestHarness {
  service: ApprovalService;
  repository: DevelopmentInMemoryApprovalRequestRepository;
  contactRegistry: InMemoryTrustedContactRegistry;
  actionOwnershipRegistry: InMemoryActionOwnershipRegistry;
  controller: InterceptionController;
  continuationManager: ContinuationManager;
  validationService: ContinuationValidationService;
  currentTime: string;
  advanceTimeByMs: (ms: number) => void;
}

function createTestHarness(initialTime: string = '2026-10-25T12:00:00.000Z'): TestHarness {
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

  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  const validationService = new ContinuationValidationService({
    controller,
    continuationManager,
    approvalService: service,
    timeProvider,
  });

  return {
    service,
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    controller,
    continuationManager,
    validationService,
    get currentTime() {
      return currentTime;
    },
    advanceTimeByMs(ms: number) {
      const parsed = new Date(currentTime).getTime();
      currentTime = new Date(parsed + ms).toISOString();
    },
  };
}

function createSampleAction(
  actionId: string,
  url: string = 'https://bank.example.com/transfer'
): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-25T12:00:00.000Z',
    page: {
      url,
      title: 'Funds Transfer',
    },
    element: {
      tagName: 'BUTTON',
      id: 'btn-transfer',
      visibleText: 'Confirm Transfer ₹50,000',
    },
  };
}

// =============================================================================
// Test Runner
// =============================================================================

async function runContinuationValidationServiceTestSuite(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL: CONTINUATION VALIDATION SERVICE TEST SUITE');
  console.log('====================================================================');

  const aliceAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
  const bobAuth: AuthContext = { actorId: 'tc_bob', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };

  // ---------------------------------------------------------------------------
  // Suite 1: Successful Validation (All 10 Conditions Satisfied)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 1: Successful Validation (All 10 Conditions Satisfied)');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_valid_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_valid_001');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_valid_001');

    let handlerExecuted = false;
    h.continuationManager.registerHeldAction(action, heldRecord, () => {
      handlerExecuted = true;
    });

    const req = h.service.createRequest(
      {
        actionId: 'act_valid_001',
        actionDescription: 'Transfer ₹50,000 to vendor',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );

    // Trusted contact authoritatively approves
    h.service.approveRequest(req.id, { decisionReason: 'Verified invoice' }, bobAuth);

    // Validate eligibility
    const result = await h.validationService.validateEligibility('act_valid_001', {
      authContext: aliceAuth,
      expectedRequesterId: 'usr_alice',
      pageContext: { url: 'https://bank.example.com/transfer', origin: 'https://bank.example.com' },
      isElementAttached: () => true,
    });

    assertEquals(result.eligible, true, 'Result eligible must be strictly true');
    assertEquals(result.status, ContinuationEligibilityStatus.ELIGIBLE, 'Status must be ELIGIBLE');
    assertEquals(result.actionId, 'act_valid_001', 'Action ID matches');
    assertEquals(result.requestId, req.id, 'Request ID matches');
    assertEquals(result.requesterId, 'usr_alice', 'Requester ID matches');
    assertEquals(result.targetState, InterceptionState.READY_FOR_USER_CONFIRMATION, 'Target state is READY_FOR_USER_CONFIRMATION');
    assertEquals(result.limitations.length, 8, 'Contains all 8 documented architectural limitations');
    assert(result.limitations.includes(CONTINUATION_VALIDATION_LIMITATIONS[0]), 'Contains browser isolation limitation');
    assert(result.limitations.some(l => l.includes('LIMITATION_ATOMIC_SERVER_CONSUMPTION')), 'Contains atomic server consumption limitation');

    // Inviolable non-execution check: Validation MUST NOT execute the action callback!
    assertEquals(handlerExecuted, false, 'Action callback handler was NOT executed during validation');
    assertEquals(h.continuationManager.getExecutionCount('act_valid_001'), 0, 'Execution count is strictly 0');

    // Convenience helper
    const isEligible = await h.validationService.isEligible('act_valid_001', { authContext: aliceAuth });
    assertEquals(isEligible, true, 'isEligible helper returns true');

    // Test transitionOnValidation: update state machine to READY_FOR_USER_CONFIRMATION
    const updatedRecord = h.validationService.transitionOnValidation(result);
    assert(updatedRecord !== null, 'Updated record exists');
    assertEquals(updatedRecord?.state, InterceptionState.READY_FOR_USER_CONFIRMATION, 'Record transitioned to READY_FOR_USER_CONFIRMATION');
  }

  // ---------------------------------------------------------------------------
  // Suite 2: Mismatched Action IDs & Request Correlation (Condition 4)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 2: Mismatched Action IDs & Request Correlation');
  {
    const h = createTestHarness();
    const action = createSampleAction('act_orig_001');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_orig_001');
    h.continuationManager.registerHeldAction(action, heldRecord, () => {});

    // 2a. Query with nonexistent local action ID
    const resNonexistent = await h.validationService.validateEligibility('act_nonexistent_999');
    assertEquals(resNonexistent.eligible, false, 'Nonexistent action is not eligible');
    assertEquals(resNonexistent.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE for missing record');
    assertEquals(resNonexistent.errorCode, 'ACTION_ID_MISMATCH', 'Error code is ACTION_ID_MISMATCH');

    // 2b. Empty action ID
    const resEmpty = await h.validationService.validateEligibility('   ');
    assertEquals(resEmpty.eligible, false, 'Empty actionId is rejected');
    assertEquals(resEmpty.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED for empty ID');

    // 2c. Requester ID mismatch
    h.actionOwnershipRegistry.registerActionOwnership('act_orig_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });
    const req = h.service.createRequest(
      {
        actionId: 'act_orig_001',
        actionDescription: 'Test action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );
    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, bobAuth);

    const resUserMismatch = await h.validationService.validateEligibility('act_orig_001', {
      authContext: aliceAuth,
      expectedRequesterId: 'usr_eve_impostor',
    });
    assertEquals(resUserMismatch.eligible, false, 'Impostor requester is rejected');
    assertEquals(resUserMismatch.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED for wrong requester');
    assertEquals(resUserMismatch.errorCode, 'ACTION_ID_MISMATCH', 'Error code is ACTION_ID_MISMATCH');
  }

  // ---------------------------------------------------------------------------
  // Suite 3: Missing Backend Confirmation & Pending Status (Conditions 1 & 2)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Missing Backend Confirmation & Pending Status');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_pending_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_pending_001');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_pending_001');
    h.continuationManager.registerHeldAction(action, heldRecord, () => {});

    // Request created but NOT approved (still PENDING)
    h.service.createRequest(
      {
        actionId: 'act_pending_001',
        actionDescription: 'Pending action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );

    const resPending = await h.validationService.validateEligibility('act_pending_001', { authContext: aliceAuth });
    assertEquals(resPending.eligible, false, 'Pending request cannot continue');
    assertEquals(resPending.status, ContinuationEligibilityStatus.PENDING, 'Status is PENDING');
    assertEquals(resPending.errorCode, 'REQUEST_NOT_APPROVED', 'Error code is REQUEST_NOT_APPROVED');
    assertEquals(resPending.targetState, InterceptionState.AWAITING_APPROVAL, 'Target state is AWAITING_APPROVAL');

    // Completely missing backend (no service, no client, no preloaded entities -> Fail closed)
    const orphanService = new ContinuationValidationService({
      controller: h.controller,
      continuationManager: h.continuationManager,
    });
    const resNoBackend = await orphanService.validateEligibility('act_pending_001');
    assertEquals(resNoBackend.eligible, false, 'Missing backend fails closed');
    assertEquals(resNoBackend.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE when backend missing');
    assertEquals(resNoBackend.errorCode, 'BACKEND_STATE_UNKNOWN', 'Error code is BACKEND_STATE_UNKNOWN');
  }

  // ---------------------------------------------------------------------------
  // Suite 4: Expiration via Trusted Server Clock (Condition 5)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Expiration via Trusted Server Clock');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_exp_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_exp_001');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_exp_001');
    h.continuationManager.registerHeldAction(action, heldRecord, () => {});

    const req = h.service.createRequest(
      {
        actionId: 'act_exp_001',
        actionDescription: 'Expiring action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth,
      { ttlMs: 5 * 60 * 1000 }
    );

    h.service.approveRequest(req.id, { decisionReason: 'Approved before expiry' }, bobAuth);

    // Fast-forward trusted time by 6 minutes (360,000 ms)
    h.advanceTimeByMs(360000);

    const resExpired = await h.validationService.validateEligibility('act_exp_001', { authContext: aliceAuth });
    assertEquals(resExpired.eligible, false, 'Expired approval cannot continue');
    assertEquals(resExpired.status, ContinuationEligibilityStatus.EXPIRED, 'Status is EXPIRED');
    assertEquals(resExpired.errorCode, 'REQUEST_EXPIRED', 'Error code is REQUEST_EXPIRED');
    assertEquals(resExpired.targetState, InterceptionState.EXPIRED, 'Target state is EXPIRED');

    // Transition record on validation
    const transitioned = h.validationService.transitionOnValidation(resExpired);
    assertEquals(transitioned?.state, InterceptionState.EXPIRED, 'InterceptionRecord transitioned to EXPIRED');
  }

  // ---------------------------------------------------------------------------
  // Suite 5: Cancellation Handling (Conditions 5 & 7)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Cancellation Handling');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_cancel_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_cancel_001');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_cancel_001');
    h.continuationManager.registerHeldAction(action, heldRecord, () => {});

    const req = h.service.createRequest(
      {
        actionId: 'act_cancel_001',
        actionDescription: 'Cancelled action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );

    // Cancel approval request
    h.service.cancelRequest(req.id, 'User aborted workflow', aliceAuth);

    const resCancelled = await h.validationService.validateEligibility('act_cancel_001', { authContext: aliceAuth });
    assertEquals(resCancelled.eligible, false, 'Cancelled action cannot continue');
    assertEquals(resCancelled.status, ContinuationEligibilityStatus.CANCELLED, 'Status is CANCELLED');
    assert(
      resCancelled.errorCode === 'REQUEST_CANCELLED' || resCancelled.errorCode === 'BINDING_CANCELLED',
      'Error code is REQUEST_CANCELLED or BINDING_CANCELLED'
    );
    assertEquals(resCancelled.targetState, InterceptionState.CANCELLED, 'Target state is CANCELLED');

    // Case B: Local controller record was cancelled
    const action2 = createSampleAction('act_cancel_002');
    h.controller.register(action2);
    h.controller.holdAction('act_cancel_002');
    h.controller.cancelAction('act_cancel_002', 'User clicked cancel');

    const resLocallyCancelled = await h.validationService.validateEligibility('act_cancel_002', { authContext: aliceAuth });
    assertEquals(resLocallyCancelled.eligible, false, 'Locally cancelled action is rejected');
    assertEquals(resLocallyCancelled.status, ContinuationEligibilityStatus.CANCELLED, 'Status is CANCELLED for local cancel');
    assertEquals(resLocallyCancelled.errorCode, 'REQUEST_CANCELLED', 'Error code is REQUEST_CANCELLED');
  }

  // ---------------------------------------------------------------------------
  // Suite 6: Invalidated Bindings & Rejection Gating (Conditions 5 & 7)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 6: Invalidated Bindings & Rejection Gating');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_inval_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_inval_001');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_inval_001');
    h.continuationManager.registerHeldAction(action, heldRecord, () => {});

    h.service.createRequest(
      {
        actionId: 'act_inval_001',
        actionDescription: 'Invalidated action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );

    // Invalidate binding
    h.service.invalidateBinding('act_inval_001', 'Context security anomaly', aliceAuth);

    const resInvalidated = await h.validationService.validateEligibility('act_inval_001', { authContext: aliceAuth });
    assertEquals(resInvalidated.eligible, false, 'Invalidated binding cannot continue');
    assertEquals(resInvalidated.status, ContinuationEligibilityStatus.REJECTED, 'Status is REJECTED for invalidated binding');
    assertEquals(resInvalidated.errorCode, 'BINDING_INVALIDATED', 'Error code is BINDING_INVALIDATED');
    assertEquals(resInvalidated.targetState, InterceptionState.INVALIDATED, 'Target state is INVALIDATED');

    // Explicit rejection by trusted contact
    const action2 = createSampleAction('act_rej_002');
    h.actionOwnershipRegistry.registerActionOwnership('act_rej_002', 'usr_alice');
    h.controller.register(action2);
    const heldRecord2 = h.controller.holdAction('act_rej_002');
    h.continuationManager.registerHeldAction(action2, heldRecord2, () => {});

    const req2 = h.service.createRequest(
      {
        actionId: 'act_rej_002',
        actionDescription: 'Rejected action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );
    h.service.rejectRequest(req2.id, { decisionReason: 'Suspected phishing' }, bobAuth);

    const resRejected = await h.validationService.validateEligibility('act_rej_002', { authContext: aliceAuth });
    assertEquals(resRejected.eligible, false, 'Rejected action cannot continue');
    assertEquals(resRejected.status, ContinuationEligibilityStatus.REJECTED, 'Status is REJECTED');
    assertEquals(resRejected.errorCode, 'REQUEST_REJECTED', 'Error code is REQUEST_REJECTED');
  }

  // ---------------------------------------------------------------------------
  // Suite 7: Duplicate Continuation Attempts & Exactly-Once (Condition 9)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 7: Duplicate Continuation Attempts & Exactly-Once Protection');
  {
    const h = createTestHarness();
    const action = createSampleAction('act_consumed_001');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_consumed_001');

    let execCount = 0;
    h.continuationManager.registerHeldAction(action, heldRecord, () => {
      execCount++;
    });

    // Execute first continuation directly via continuationManager
    const contRes = h.continuationManager.continueAction('act_consumed_001', 'First continuation', {
      actionId: 'act_consumed_001',
      allowUnboundAction: true,
    });
    assertEquals(contRes.success, true, 'First continuation succeeded');
    assertEquals(execCount, 1, 'Handler executed exactly once');

    // Attempt validation on already consumed action
    const resConsumed = await h.validationService.validateEligibility('act_consumed_001');
    assertEquals(resConsumed.eligible, false, 'Consumed action cannot be re-validated');
    assertEquals(resConsumed.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE');
    assertEquals(resConsumed.errorCode, 'ALREADY_CONTINUED', 'Error code is ALREADY_CONTINUED');
    assertEquals(resConsumed.targetState, InterceptionState.CONTINUED, 'Target state remains CONTINUED');
    assertEquals(execCount, 1, 'Handler execution count remains strictly 1 (no replay)');
  }

  // ---------------------------------------------------------------------------
  // Suite 8: Network Failure, Timeouts & Unavailable Backend (Fail-Closed)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 8: Network Failure, Timeouts & Unavailable Backend (Fail-Closed)');
  {
    const controller = new InterceptionController();
    const continuationManager = new ContinuationManager(controller);
    const action = createSampleAction('act_net_001');
    controller.register(action);
    const heldRecord = controller.holdAction('act_net_001');
    continuationManager.registerHeldAction(action, heldRecord, () => {});

    // Mock client simulating network error
    const networkFailClient = {
      validateContinuationAuthorization: async (): Promise<ApiClientResult<BackendContinuationValidationResult>> => {
        return {
          success: false,
          error: {
            code: ApiClientErrorCodes.NETWORK_FAILURE,
            message: 'Failed to fetch: net::ERR_CONNECTION_REFUSED',
          },
          isNetworkError: true,
          isTimeout: false,
        };
      },
    } as unknown as ApprovalApiClient;

    const netValidationService = new ContinuationValidationService({
      controller,
      continuationManager,
      approvalClient: networkFailClient,
    });

    const resNetFail = await netValidationService.validateEligibility('act_net_001');
    assertEquals(resNetFail.eligible, false, 'Network failure must fail closed');
    assertEquals(resNetFail.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE on network error');
    assertEquals(resNetFail.errorCode, 'AUTHORIZATION_UNAVAILABLE', 'Error code is AUTHORIZATION_UNAVAILABLE');
    assert(resNetFail.reason.includes('unreachable'), 'Reason documents service is unreachable');

    // Mock client simulating request timeout
    const timeoutClient = {
      validateContinuationAuthorization: async (): Promise<ApiClientResult<BackendContinuationValidationResult>> => {
        return {
          success: false,
          error: {
            code: ApiClientErrorCodes.TIMEOUT,
            message: 'Request timed out after 10000ms',
          },
          isNetworkError: false,
          isTimeout: true,
        };
      },
    } as unknown as ApprovalApiClient;

    const timeoutValidationService = new ContinuationValidationService({
      controller,
      continuationManager,
      approvalClient: timeoutClient,
    });

    const resTimeout = await timeoutValidationService.validateEligibility('act_net_001');
    assertEquals(resTimeout.eligible, false, 'Timeout must fail closed');
    assertEquals(resTimeout.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE on timeout');
    assertEquals(resTimeout.errorCode, 'AUTHORIZATION_UNAVAILABLE', 'Error code is AUTHORIZATION_UNAVAILABLE');
    assert(resTimeout.reason.includes('timed out') || resTimeout.reason.includes('unreachable'), 'Reason documents timeout');
  }

  // ---------------------------------------------------------------------------
  // Suite 9: Context Changes & DOM Element Verification (Condition 8)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 9: Context Changes & DOM Element Verification (Not Solely Hostname)');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_ctx_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_ctx_001', 'https://bank.example.com/transfer');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_ctx_001');
    h.continuationManager.registerHeldAction(action, heldRecord, () => {});

    const req = h.service.createRequest(
      {
        actionId: 'act_ctx_001',
        actionDescription: 'Context action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );
    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, bobAuth);

    // 9a. Origin drift: https://attacker.example.com vs https://bank.example.com
    const resOriginDrift = await h.validationService.validateEligibility('act_ctx_001', {
      authContext: aliceAuth,
      pageContext: { url: 'https://attacker.example.com/transfer', origin: 'https://attacker.example.com' },
    });
    assertEquals(resOriginDrift.eligible, false, 'Origin drift is rejected');
    assertEquals(resOriginDrift.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED for origin drift');
    assertEquals(resOriginDrift.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code is PAGE_CONTEXT_MISMATCH');

    // 9b. Path drift: /settings instead of /transfer
    const resPathDrift = await h.validationService.validateEligibility('act_ctx_001', {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/settings', origin: 'https://bank.example.com' },
    });
    assertEquals(resPathDrift.eligible, false, 'Path drift is rejected');
    assertEquals(resPathDrift.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED for path drift');
    assertEquals(resPathDrift.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code is PAGE_CONTEXT_MISMATCH');

    // 9c. Target DOM element detached
    const resDetached = await h.validationService.validateEligibility('act_ctx_001', {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/transfer', origin: 'https://bank.example.com' },
      isElementAttached: () => false,
    });
    assertEquals(resDetached.eligible, false, 'Detached element is rejected');
    assertEquals(resDetached.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED for detached element');
    assertEquals(resDetached.errorCode, 'ELEMENT_DETACHED', 'Error code is ELEMENT_DETACHED');

    // 9d. Action structural digest mismatch
    const resDigestMismatch = await h.validationService.validateEligibility('act_ctx_001', {
      authContext: aliceAuth,
      expectedDigest: '0000000000000000000000000000000000000000000000000000000000000000',
      binding: {
        id: 'bnd_test',
        actionId: 'act_ctx_001',
        requestId: req.id,
        requesterId: 'usr_alice',
        state: ApprovalActionBindingState.APPROVED,
        actionDigest: '1111111111111111111111111111111111111111111111111111111111111111',
        createdAt: '2026-10-25T12:00:00.000Z',
        expiresAt: '2026-10-25T12:15:00.000Z',
      },
    });
    assertEquals(resDigestMismatch.eligible, false, 'Digest mismatch is rejected');
    assertEquals(resDigestMismatch.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED for digest');
  }

  // ---------------------------------------------------------------------------
  // Suite 10: Staging & Risk-Engine Requirements (Condition 10)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 10: Staging & Risk-Engine Requirements (Condition 10)');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_stg_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_stg_001');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_stg_001');
    h.continuationManager.registerHeldAction(action, heldRecord, () => {});

    const req = h.service.createRequest(
      {
        actionId: 'act_stg_001',
        actionDescription: 'Staging action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );
    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, bobAuth);

    // Staging context with actionId mismatch
    const mismatchedStagingContext: StagingActionContext = {
      actionId: 'act_different_999',
      description: 'Mismatched staged action',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.HIGH,
      riskReasons: ['Suspicious transfer'],
      responseAction: ResponseAction.PROTECT,
      interceptionState: InterceptionState.HELD,
      timestamp: '2026-10-25T12:00:00.000Z',
      stagedAt: '2026-10-25T12:00:00.000Z',
    };
    const resStagingMismatch = await h.validationService.validateEligibility('act_stg_001', {
      authContext: aliceAuth,
      stagingContext: mismatchedStagingContext,
    });
    assertEquals(resStagingMismatch.eligible, false, 'Mismatched staging context rejected');
    assertEquals(resStagingMismatch.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED');

    // Staging context missing riskLevel evaluation
    const incompleteStagingContext: StagingActionContext = {
      actionId: 'act_stg_001',
      description: 'Incomplete staged action',
      actionType: ActionType.CLICK,
      riskLevel: undefined as any,
      riskReasons: [],
      responseAction: ResponseAction.PROTECT,
      interceptionState: InterceptionState.HELD,
      timestamp: '2026-10-25T12:00:00.000Z',
      stagedAt: '2026-10-25T12:00:00.000Z',
    };
    const resRiskIncomplete = await h.validationService.validateEligibility('act_stg_001', {
      authContext: aliceAuth,
      stagingContext: incompleteStagingContext,
    });
    assertEquals(resRiskIncomplete.eligible, false, 'Incomplete risk evaluation rejected');
    assertEquals(resRiskIncomplete.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE');
  }

  // ---------------------------------------------------------------------------
  // Suite 11: Documented Architectural Limitations & Privacy Guarantee
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 11: Documented Architectural Limitations & Privacy Guarantee');
  {
    const h = createTestHarness();
    const action = createSampleAction('act_priv_001');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_priv_001');
    h.continuationManager.registerHeldAction(action, heldRecord, () => {});

    const res = await h.validationService.validateEligibility('act_priv_001');

    // 11a. Verify all 8 limitations are present
    assertEquals(res.limitations.length, 8, 'Exactly 8 limitations documented');
    assert(res.limitations.some(l => l.includes('LIMITATION_BROWSER_ISOLATION')), 'Has browser isolation limitation');
    assert(res.limitations.some(l => l.includes('LIMITATION_DOM_IDENTITY')), 'Has DOM identity limitation');
    assert(res.limitations.some(l => l.includes('LIMITATION_PAGE_LIFECYCLE')), 'Has page lifecycle limitation');
    assert(res.limitations.some(l => l.includes('LIMITATION_SYNTHETIC_EVENTS')), 'Has synthetic events limitation');
    assert(res.limitations.some(l => l.includes('LIMITATION_EPHEMERAL_PERSISTENCE')), 'Has ephemeral persistence limitation');
    assert(res.limitations.some(l => l.includes('LIMITATION_PAGE_STATE_DRIFT')), 'Has page state drift limitation');
    assert(res.limitations.some(l => l.includes('LIMITATION_ATOMIC_SERVER_CONSUMPTION')), 'Has atomic server consumption limitation');
    assert(res.limitations.some(l => l.includes('LIMITATION_VERIFIED_ACTIONS_ONLY')), 'Has verified actions only limitation');

    // 11b. Verify no sensitive fields are present or leaked in result
    const serialized = JSON.stringify(res);
    assert(!serialized.includes('password'), 'Validation result does not contain password');
    assert(!serialized.includes('otp'), 'Validation result does not contain otp');
    assert(!serialized.includes('cardNumber'), 'Validation result does not contain cardNumber');
  }

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n====================================================================');
  console.log(`📊 VERIFICATION SUMMARY: ${passedTests} / ${totalTests} PASSED`);
  console.log('🎉 ALL 11 SUITES & VALIDATION SERVICE INVARIANTS SATISFIED!');
  console.log('====================================================================\n');
}

runContinuationValidationServiceTestSuite().catch((err) => {
  console.error('\n❌ TEST SUITE RUNNER ENCOUNTERED UNHANDLED ERROR:', err);
  if (typeof process !== 'undefined') {
    process.exit(1);
  }
});
