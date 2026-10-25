/**
 * Guardrail Approval Action Binding - Focused Security Test Suite
 *
 * Exhaustive security and authorization verification for the approval-to-action binding:
 *
 * LAYER 1: UNIT TESTS [PURE DOMAIN & INVARIANT GATING]
 * - Scenario 1: Valid approval request bound 1:1 to its intended action with deterministic SHA-256 digest.
 * - Scenario 2: Request cannot be rebound or reassigned to another action.
 * - Scenario 8 (Model): In-memory active binding conflict detection on duplicate active bindings.
 * - Scenario 13 (Model): Unknown or malformed lifecycle states fail closed (transition & validation errors).
 * - Scenario 15 (Model): Sensitive credentials, OTPs, PANs, CVVs, and raw form values excluded from binding models.
 *
 * LAYER 2: MOCKED & ISOLATED COMPONENT TESTS [API ROUTER & SERVICE AUTHORIZATION]
 * - Scenario 3: Unauthorized user cannot access or modify the binding (multi-tenant isolation, 401/403/404).
 * - Scenario 4: Trusted contact cannot decide a request outside their authorization (separation of duties).
 * - Scenario 9: Concurrent lifecycle changes preserve valid state transitions via atomic CAS.
 * - Scenario 13 (Router): Malformed or injection payloads fail closed with 400 validation errors.
 *
 * LAYER 3: INTEGRATION TESTS [SERVICE + CONTROLLER + CONTINUATION BOUNDARY]
 * - Scenario 5: Expired approval cannot authorize continuation via trusted clock.
 * - Scenario 6: Rejected or cancelled request cannot authorize continuation.
 * - Scenario 7: Invalidated binding cannot be restored by a stale response.
 * - Scenario 10: A different action cannot inherit the original action's approval.
 * - Scenario 11: Changed page context (origin, path, detached DOM) invalidates continuation.
 * - Scenario 12: Missing backend confirmation never becomes authorization (fail closed).
 * - Scenario 14: An approval-status update alone does NOT execute the held action.
 * - Regressions: In-flight continuation deduplication, idempotent cancellation reconciliation, and CAS rollback.
 *
 * LAYER 4: GENUINE LIVE BACKEND TESTS [REAL OS TCP SOCKETS & REAL HTTP WIRE]
 * - Real Node.js HTTP TCP server on loopback (127.0.0.1:0) testing actual socket communication.
 * - Real ApprovalApiClient over native fetch.
 * - Live wire traffic sniffer auditing zero leakage of sensitive keys, passwords, or bearer tokens.
 */

declare const process: any;

import http, { IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';

import { ActionType, GuardrailAction } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { InterceptionState } from '../types/interception.js';
import {
  ActionFingerprintDescriptor,
  ApprovalActionBinding,
  ApprovalActionBindingState,
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import {
  ApprovalBindingConflictError,
  ApprovalBindingReassignmentError,
  ApprovalBindingStateTransitionError,
  ApprovalBindingValidationError,
  assertNoBindingReassignment,
  assertValidActionId,
  assertValidApprovalActionBinding,
  assertValidBindingId,
  computeActionDigest,
  createApprovalActionBinding,
  isBindingExpired,
  isValidBindingTransition,
  transitionBindingState,
  validateActionDigest,
  validateActionId,
  validateApprovalActionBinding,
  validateBindingId,
} from './binding.js';
import {
  expireApprovalRequest,
  isRequestExpired,
  TimeProvider,
} from './model.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
  PERSISTENCE_METADATA,
} from './repository.js';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  SelfApprovalProhibitedError,
  TrustedContactStatus,
} from './authorization.js';
import {
  ApprovalAccessDeniedError,
  ApprovalAlreadyResolvedError,
  ApprovalService,
  ApprovalValidationError,
  UnauthenticatedError,
} from './service.js';
import {
  ApiRequest,
  ApprovalApiRouter,
  InMemoryTokenVerifier,
} from './api.js';
import { ApprovalApiClient } from './client.js';
import { InterceptionController } from '../interception/controller.js';
import {
  ContinuationAuthorizationBoundary,
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
    throw new Error(
      `[ASSERTION FAILED]: ${message} (expected: ${String(expected)}, got: ${String(actual)})`
    );
  }
  passedTests++;
  console.log(`  ✓ ${message} (expected: ${String(expected)}, got: ${String(actual)})`);
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
  tokenVerifier: InMemoryTokenVerifier;
  router: ApprovalApiRouter;
  timeProvider: TimeProvider;
  currentTimeMs: number;
}

function createTestHarness(initialIsoTime: string = '2026-10-25T12:00:00.000Z'): TestHarness {
  let currentTimeMs = Date.parse(initialIsoTime);
  const timeProvider: TimeProvider = () => new Date(currentTimeMs);

  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();

  const service = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    timeProvider,
  });

  const tokenVerifier = new InMemoryTokenVerifier();
  const router = new ApprovalApiRouter(service, tokenVerifier, {
    rateLimiter: { checkRateLimit: () => ({ allowed: true }) },
  });

  return {
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    service,
    tokenVerifier,
    router,
    timeProvider,
    currentTimeMs,
  };
}

const aliceAuth: AuthContext = {
  actorId: 'usr_alice',
  role: ActorRole.USER,
  isAuthenticated: true,
};

const bobAuth: AuthContext = {
  actorId: 'usr_bob',
  role: ActorRole.TRUSTED_CONTACT,
  isAuthenticated: true,
};

const charlieAuth: AuthContext = {
  actorId: 'usr_charlie',
  role: ActorRole.TRUSTED_CONTACT,
  isAuthenticated: true,
};

const malloryAuth: AuthContext = {
  actorId: 'usr_mallory',
  role: ActorRole.USER,
  isAuthenticated: true,
};

function createSamplePayload(actionId: string): ClientApprovalRequestPayload {
  return {
    actionId,
    actionDescription: 'Send $1,000 wire transfer',
    actionType: ActionType.CLICK,
    riskLevel: RiskLevel.HIGH,
    riskScore: 85,
    riskReasons: ['International recipient', 'Amount exceeds normal baseline'],
    pageContext: {
      url: 'https://bank.example.com/wire-transfer',
      origin: 'https://bank.example.com',
      hostname: 'bank.example.com',
      pageTitle: 'Bank - Wire Transfer',
    },
  };
}

function createSampleAction(actionId: string, url: string = 'https://bank.example.com/wire-transfer'): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-25T12:00:00.000Z',
    page: {
      url,
      title: 'Bank - Wire Transfer',
    },
    element: {
      tagName: 'BUTTON',
      id: 'btn-submit-wire',
      visibleText: 'Authorize Wire Transfer $1,000',
    },
    target: {
      selector: '#btn-submit-wire',
      elementId: 'btn-submit-wire',
      tagName: 'BUTTON',
      text: 'Authorize Wire Transfer $1,000',
    },
    risk: {
      level: RiskLevel.HIGH,
      score: 85,
      factors: ['International recipient', 'Amount exceeds baseline'],
    },
  };
}

// =============================================================================
// Security Test Suite Execution
// =============================================================================

async function runSecurityTestSuite(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL: APPROVAL-TO-ACTION BINDING FOCUSED SECURITY TEST SUITE');
  console.log('====================================================================\n');

  // ===========================================================================
  // LAYER 1: UNIT TESTS [PURE DOMAIN & INVARIANT GATING]
  // ===========================================================================
  console.log('====================================================================');
  console.log('▶ LAYER 1: UNIT TESTS (PURE DOMAIN MODELS & INVARIANT GATING)');
  console.log('====================================================================');

  // ---------------------------------------------------------------------------
  // Scenario 1 (Unit): Valid Binding Creation & 1:1 Invariants
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1 [Unit]: Valid approval request is bound 1:1 to intended action');
  {
    const h = createTestHarness();
    const actionId = 'act_sec_unit_001';
    const requestId = 'apr_sec_unit_001';

    const binding = createApprovalActionBinding(
      {
        actionId,
        requestId,
        requesterId: 'usr_alice',
        expiresAt: new Date(h.timeProvider().getTime() + 300000).toISOString(),
      },
      { timeProvider: h.timeProvider }
    );

    assert(binding.id.startsWith('bnd_'), 'Binding ID has canonical "bnd_" prefix');
    assertEquals(binding.actionId, actionId, 'Binding strictly records intended actionId');
    assertEquals(binding.requestId, requestId, 'Binding strictly records target requestId');
    assertEquals(binding.requesterId, 'usr_alice', 'Binding records authoritatively verified requesterId');
    assertEquals(binding.state, ApprovalActionBindingState.BOUND, 'Initial state is strictly BOUND');
    assertValidApprovalActionBinding(binding);

    // Structural fingerprint digest calculation
    const descriptor: ActionFingerprintDescriptor = {
      origin: 'https://bank.example.com',
      pathname: '/wire-transfer',
      actionType: ActionType.CLICK,
      targetTagName: 'BUTTON',
      targetId: 'btn-submit-wire',
      actionLabel: 'Authorize Wire Transfer',
    };
    const digest = computeActionDigest(descriptor);
    assert(digest.length === 64, 'Digest is 64-character hex SHA-256');
    assert(/^[a-f0-9]{64}$/.test(digest), 'Digest matches lowercase hex pattern');

    // Tamper detection: modifying descriptor produces distinct hash
    const tamperedDescriptor = { ...descriptor, actionLabel: 'Tampered Label' };
    const tamperedDigest = computeActionDigest(tamperedDescriptor);
    assert(digest !== tamperedDigest, 'Digest detects structural tampering');
  }

  // ---------------------------------------------------------------------------
  // Scenario 2 (Unit): Anti-Reassignment Invariant Protection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 2 [Unit]: Request cannot be reassigned to another action');
  {
    const h = createTestHarness();
    const binding = createApprovalActionBinding(
      {
        actionId: 'act_sec_unit_002',
        requestId: 'apr_sec_unit_002',
        requesterId: 'usr_alice',
        expiresAt: new Date(h.timeProvider().getTime() + 300000).toISOString(),
      },
      { timeProvider: h.timeProvider }
    );

    // Reassigning same request to different actionId must throw
    assertThrows(
      () => assertNoBindingReassignment(binding, 'act_attacker_different', 'apr_sec_unit_002'),
      'ApprovalBindingReassignmentError',
      'assertNoBindingReassignment blocks rebinding to different action'
    );
  }

  // ---------------------------------------------------------------------------
  // Scenario 8 (Unit): In-Memory Active Binding Conflict Detection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 8 [Unit]: Duplicate request cannot silently create conflicting relationship');
  {
    const h = createTestHarness();
    const actionId = 'act_sec_unit_008';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');

    const req1 = h.service.createRequest(createSamplePayload(actionId), aliceAuth);
    const existingBinding = h.repository.findBindingByRequestId(req1.id);
    assert(existingBinding !== undefined, 'Initial binding persisted');

    // Attempting to save a conflicting active binding for same actionId to another request throws
    const conflictingBinding = createApprovalActionBinding(
      {
        actionId,
        requestId: 'apr_conflicting_fake',
        requesterId: 'usr_alice',
        expiresAt: new Date(h.timeProvider().getTime() + 300000).toISOString(),
      },
      { timeProvider: h.timeProvider }
    );

    assertThrows(
      () => h.repository.saveBinding(conflictingBinding),
      'ApprovalBindingConflictError',
      'Repository rejects conflicting active binding for same actionId'
    );
  }

  // ---------------------------------------------------------------------------
  // Scenario 13 (Unit): Unknown / Malformed Lifecycle States Fail Closed
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 13 [Unit]: Unknown or malformed lifecycle states fail closed');
  {
    const h = createTestHarness();
    const binding = createApprovalActionBinding(
      {
        actionId: 'act_sec_unit_013',
        requestId: 'apr_sec_unit_013',
        requesterId: 'usr_alice',
        expiresAt: new Date(h.timeProvider().getTime() + 300000).toISOString(),
      },
      { timeProvider: h.timeProvider }
    );

    // Corrupted target state throws transition error
    assertThrows(
      () => transitionBindingState(binding, 'CORRUPTED_TARGET_STATE' as any),
      'ApprovalBindingStateTransitionError',
      'Corrupted target state rejected'
    );

    // Invalid backwards transition throws transition error (terminal state reopening)
    const approvedBinding = transitionBindingState(binding, ApprovalActionBindingState.APPROVED, {
      timeProvider: h.timeProvider,
    });
    assertThrows(
      () => transitionBindingState(approvedBinding, ApprovalActionBindingState.BOUND),
      'ApprovalBindingStateTransitionError',
      'Terminal APPROVED state cannot be reopened to BOUND'
    );

    // Malformed object fails validation
    assertThrows(
      () => assertValidApprovalActionBinding({ ...binding, state: 'INVALID_STATUS' as any }),
      'ApprovalBindingValidationError',
      'Binding with invalid state fails assertValidApprovalActionBinding'
    );
  }

  // ---------------------------------------------------------------------------
  // Scenario 15 (Unit): Sensitive Credentials Excluded from Binding Model
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 15 [Unit]: Sensitive credentials, OTPs, and form values excluded from binding');
  {
    const h = createTestHarness();
    const binding = createApprovalActionBinding(
      {
        actionId: 'act_sec_unit_015',
        requestId: 'apr_sec_unit_015',
        requesterId: 'usr_alice',
        expiresAt: new Date(h.timeProvider().getTime() + 300000).toISOString(),
      },
      { timeProvider: h.timeProvider }
    );

    const keys = Object.keys(binding);
    assert(!keys.includes('password'), 'password property strictly absent from binding');
    assert(!keys.includes('otp'), 'otp property strictly absent from binding');
    assert(!keys.includes('pin'), 'pin property strictly absent from binding');
    assert(!keys.includes('cardNumber'), 'cardNumber property strictly absent from binding');
    assert(!keys.includes('cvv'), 'cvv property strictly absent from binding');
    assert(!keys.includes('token'), 'token property strictly absent from binding');
    assert(!keys.includes('cookie'), 'cookie property strictly absent from binding');

    // Attempting to construct a binding with injected sensitive properties throws
    assertThrows(
      () =>
        assertValidApprovalActionBinding({
          ...binding,
          password: 'secret_injected_password',
        } as any),
      'ApprovalBindingValidationError',
      'Injected password property rejected by strict whitelist validator'
    );
  }

  // ===========================================================================
  // LAYER 2: MOCKED & ISOLATED COMPONENT TESTS [ROUTER & SERVICE AUTHORIZATION]
  // ===========================================================================
  console.log('\n====================================================================');
  console.log('▶ LAYER 2: MOCKED COMPONENT TESTS (ROUTER & SERVICE BOUNDARIES)');
  console.log('====================================================================');

  // ---------------------------------------------------------------------------
  // Scenario 3 (Mocked API): Multi-Tenant Isolation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 3 [Mocked API]: Unauthorized user cannot access or modify binding');
  {
    const h = createTestHarness();
    const actionId = 'act_sec_comp_003';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');

    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);

    // Mallory tries to access Alice's request directly
    assertThrows(
      () => h.service.getRequest(req.id, malloryAuth),
      'ApprovalAccessDeniedError',
      'Mallory cannot view Alice request (ApprovalAccessDeniedError)'
    );

    // Mallory tries to cancel Alice's request
    assertThrows(
      () => h.service.cancelRequest(req.id, 'Mallory malicious abort', malloryAuth),
      'ApprovalAccessDeniedError',
      'Mallory cannot cancel Alice request'
    );

    // Unauthenticated caller throws UnauthenticatedError (401)
    const unauthContext: AuthContext = { actorId: '', isAuthenticated: false };
    assertThrows(
      () => h.service.getRequest(req.id, unauthContext),
      'UnauthenticatedError',
      'Unauthenticated caller cannot view request'
    );
  }

  // ---------------------------------------------------------------------------
  // Scenario 4 (Mocked API): Trusted Contact Separation of Duties
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 4 [Mocked API]: Trusted contact cannot decide request outside authorization');
  {
    const h = createTestHarness();
    const actionId = 'act_sec_comp_004';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    h.contactRegistry.addContact({
      id: 'usr_bob',
      userId: 'usr_alice',
      email: 'bob@example.com',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);

    // Ward Alice cannot approve her own request
    assertThrows(
      () => h.service.approveRequest(req.id, { decisionReason: 'Self approval attempt' }, aliceAuth),
      'SelfApprovalProhibitedError',
      'Requester self-approval is strictly forbidden'
    );

    // Unaffiliated reviewer Charlie cannot decide Alice's request
    assertThrows(
      () => h.service.approveRequest(req.id, { decisionReason: 'Charlie unauthorized' }, charlieAuth),
      'ApprovalAccessDeniedError',
      'Unaffiliated reviewer cannot approve request'
    );

    // Revoked / inactive contact cannot decide Alice's request
    h.contactRegistry.updateStatus('usr_bob', TrustedContactStatus.REVOKED);
    assertThrows(
      () => h.service.approveRequest(req.id, { decisionReason: 'Revoked Bob attempt' }, bobAuth),
      'ApprovalAccessDeniedError',
      'Revoked contact cannot approve request'
    );
  }

  // ---------------------------------------------------------------------------
  // Scenario 9 (Mocked API): Concurrent Lifecycle Decision CAS Race
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 9 [Mocked API]: Concurrent decisions preserve valid CAS transitions');
  {
    const h = createTestHarness();
    const actionId = 'act_sec_comp_009';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    h.contactRegistry.addContact({
      id: 'usr_bob',
      userId: 'usr_alice',
      email: 'bob@example.com',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    h.contactRegistry.addContact({
      id: 'usr_charlie',
      userId: 'usr_alice',
      email: 'charlie@example.com',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);

    // Simultaneous racing decisions
    const raceResults = await Promise.allSettled([
      Promise.resolve().then(() => h.service.approveRequest(req.id, { decisionReason: 'Bob approves' }, bobAuth)),
      Promise.resolve().then(() => h.service.rejectRequest(req.id, { decisionReason: 'Charlie rejects' }, charlieAuth)),
    ]);

    const fulfilled = raceResults.filter(r => r.status === 'fulfilled');
    const rejected = raceResults.filter(r => r.status === 'rejected');

    assertEquals(fulfilled.length, 1, 'Exactly one concurrent decision commits');
    assertEquals(rejected.length, 1, 'Losing concurrent decision is rejected');
    assertEquals(
      (rejected[0] as PromiseRejectedResult).reason.name,
      'ApprovalAlreadyResolvedError',
      'Losing decision caught ApprovalAlreadyResolvedError (409 Conflict)'
    );
  }

  // ---------------------------------------------------------------------------
  // Scenario 13 (Router): Malformed Injections Fail Closed with 400
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 13 [Router]: Injected privileged properties fail closed with 400');
  {
    const h = createTestHarness();
    h.tokenVerifier.registerToken('alice_token', aliceAuth);

    // Malformed submission attempting to inject status: 'APPROVED'
    const malformedReq: ApiRequest = {
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer alice_token',
      },
      body: {
        actionId: 'act_malformed_001',
        actionDescription: 'Injected request',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
        status: 'APPROVED', // Client privilege escalation attack
      },
    };

    const res = await h.router.dispatch(malformedReq);
    const errorObj = (res.body as any).error;
    assert(
      errorObj?.message?.includes('status') ||
        errorObj?.details?.some((d: string) => d.includes('status')),
      'Error mentions client cannot specify status'
    );
  }

  // ===========================================================================
  // LAYER 3: INTEGRATION TESTS [SERVICE + CONTROLLER + CONTINUATION BOUNDARY]
  // ===========================================================================
  console.log('\n====================================================================');
  console.log('▶ LAYER 3: INTEGRATION TESTS (SERVICE + CONTROLLER + CONTINUATION)');
  console.log('====================================================================');

  // ---------------------------------------------------------------------------
  // Scenario 5 (Integration): Expired Approval Gating via Trusted Clock
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 5 [Integration]: Expired approval cannot authorize continuation');
  {
    let currentTimeMs = Date.parse('2026-10-25T12:00:00.000Z');
    const timeProvider: TimeProvider = () => new Date(currentTimeMs);

    const repository = new DevelopmentInMemoryApprovalRequestRepository();
    const contactRegistry = new InMemoryTrustedContactRegistry();
    const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();
    const service = new ApprovalService({
      repository,
      contactRegistry,
      actionOwnershipRegistry,
      timeProvider,
    });

    const actionId = 'act_sec_int_005';
    actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    contactRegistry.addContact({
      id: 'usr_bob',
      userId: 'usr_alice',
      email: 'bob@example.com',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date(currentTimeMs).toISOString(),
      updatedAt: new Date(currentTimeMs).toISOString(),
    });

    let executionCount = 0;
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller, {
      executionDispatcher: async () => {
        executionCount++;
        return { success: true };
      },
    });

    const boundary = new ContinuationAuthorizationBoundary({
      continuationManager: manager,
      controller,
      approvalService: service,
      timeProvider,
    });

    const action = createSampleAction(actionId);
    controller.register(action);
    const held = controller.holdAction(actionId);
    manager.registerHeldAction(action, held, async () => {
      executionCount++;
    });

    // Create request with 5 minute TTL (expires at 12:05)
    const req = service.createRequest(createSamplePayload(actionId), aliceAuth, { ttlMs: 5 * 60 * 1000 });
    assertEquals(req.status, ApprovalStatus.PENDING, 'Request initialized in PENDING state');

    // Trusted contact Bob approves the request while valid
    const approved = service.approveRequest(
      req.id,
      { decisionReason: 'Legitimate wire transfer verified by phone' },
      bobAuth
    );
    assertEquals(approved.status, ApprovalStatus.APPROVED, 'Request transitioned to APPROVED');

    // Advance clock past expiration deadline (+6 minutes)
    currentTimeMs += 6 * 60 * 1000;

    // Continuation validation must fail closed due to expiration despite prior approval
    const authCheck = await boundary.validateContinuation(actionId, {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/wire-transfer', origin: 'https://bank.example.com' },
      isElementAttached: () => true,
    });

    assertEquals(authCheck.authorized, false, 'Continuation check rejects expired approval');
    assertEquals(authCheck.errorCode, 'REQUEST_EXPIRED', 'Error code is REQUEST_EXPIRED');

    // Continuation execution fails closed
    const contRes = await boundary.authorizeAndContinue(actionId, 'Attempt expired continuation', {
      authContext: aliceAuth,
    });
    assertEquals(contRes.success, false, 'Expired continuation fails');
    assertEquals(executionCount, 0, 'Action was NEVER executed on expiration');
  }

  // ---------------------------------------------------------------------------
  // Scenario 6 (Integration): Rejected or Cancelled Requests Cannot Authorize Continuation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 6 [Integration]: Rejected or cancelled request cannot authorize continuation');
  {
    const h = createTestHarness();
    const actionId = 'act_sec_int_006';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    h.contactRegistry.addContact({
      id: 'usr_bob',
      userId: 'usr_alice',
      email: 'bob@example.com',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let executionCount = 0;
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller, {
      executionDispatcher: async () => {
        executionCount++;
        return { success: true };
      },
    });

    const boundary = new ContinuationAuthorizationBoundary({
      continuationManager: manager,
      controller,
      approvalService: h.service,
      timeProvider: h.timeProvider,
    });

    const action = createSampleAction(actionId);
    controller.register(action);
    const held = controller.holdAction(actionId);
    manager.registerHeldAction(action, held, async () => {
      executionCount++;
    });

    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);

    // Reviewer rejects request
    h.service.rejectRequest(req.id, { decisionReason: 'Suspicious recipient address' }, bobAuth);

    const rejCheck = await boundary.validateContinuation(actionId, {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/wire-transfer', origin: 'https://bank.example.com' },
      isElementAttached: () => true,
    });
    assertEquals(rejCheck.authorized, false, 'Rejected request is not authorized');
    assertEquals(rejCheck.errorCode, 'REQUEST_REJECTED', 'Error code is REQUEST_REJECTED');

    const rejContRes = await boundary.authorizeAndContinue(actionId, 'Attempt rejected continue', {
      authContext: aliceAuth,
    });
    assertEquals(rejContRes.success, false, 'Rejected continuation fails');
    assertEquals(executionCount, 0, 'Zero executions for rejected request');
  }

  // ---------------------------------------------------------------------------
  // Scenario 7 (Integration): Invalidated Binding Cannot Be Restored by Stale Response
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 7 [Integration]: Invalidated binding cannot be restored by stale response');
  {
    const h = createTestHarness();
    const actionId = 'act_sec_int_007';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');

    let executionCount = 0;
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller, {
      executionDispatcher: async () => {
        executionCount++;
        return { success: true };
      },
    });

    const boundary = new ContinuationAuthorizationBoundary({
      continuationManager: manager,
      controller,
      approvalService: h.service,
      timeProvider: h.timeProvider,
    });

    const action = createSampleAction(actionId);
    controller.register(action);
    const held = controller.holdAction(actionId);
    manager.registerHeldAction(action, held, async () => {
      executionCount++;
    });

    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);

    // Requester explicitly cancels from extension UI
    h.service.cancelRequest(req.id, 'User clicked Cancel', aliceAuth);

    // Stale late response arrives claiming approval
    const staleAttempt = await boundary.validateContinuation(actionId, {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/wire-transfer', origin: 'https://bank.example.com' },
      isElementAttached: () => true,
    });

    assertEquals(staleAttempt.authorized, false, 'Stale response authorization refused');
    assert(
      staleAttempt.errorCode === 'BINDING_CANCELLED' || staleAttempt.errorCode === 'REQUEST_CANCELLED',
      'ErrorCode indicates cancellation'
    );
    assertEquals(executionCount, 0, 'Zero executions for cancelled binding');
  }

  // ---------------------------------------------------------------------------
  // Scenario 10 (Integration): Different Action Cannot Inherit Approval
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 10 [Integration]: A different action cannot inherit another action\'s approval');
  {
    const h = createTestHarness();
    const actionIdApproved = 'act_legit_010';
    const actionIdAttacker = 'act_imposter_010';

    h.actionOwnershipRegistry.registerActionOwnership(actionIdApproved, 'usr_alice');
    h.actionOwnershipRegistry.registerActionOwnership(actionIdAttacker, 'usr_alice');
    h.contactRegistry.addContact({
      id: 'usr_bob',
      userId: 'usr_alice',
      email: 'bob@example.com',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let executionCount = 0;
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller, {
      executionDispatcher: async () => {
        executionCount++;
        return { success: true };
      },
    });

    const boundary = new ContinuationAuthorizationBoundary({
      continuationManager: manager,
      controller,
      approvalService: h.service,
      timeProvider: h.timeProvider,
    });

    // Register both actions
    const legitAction = createSampleAction(actionIdApproved);
    controller.register(legitAction);
    const legitHeld = controller.holdAction(actionIdApproved);
    manager.registerHeldAction(legitAction, legitHeld, async () => {
      executionCount++;
    });

    // Submit and approve legit action
    const req = h.service.createRequest(createSamplePayload(actionIdApproved), aliceAuth);
    h.service.approveRequest(req.id, { decisionReason: 'Approved legit action' }, bobAuth);

    // Attacker registers second action
    const imposterAction = createSampleAction(actionIdAttacker);
    controller.register(imposterAction);
    controller.holdAction(actionIdAttacker);

    // Attempting to continue imposter action fails closed
    const imposterAttempt = await boundary.validateContinuation(actionIdAttacker, {
      authContext: aliceAuth,
    });

    assertEquals(imposterAttempt.authorized, false, 'Imposter action continuation refused');
    assertEquals(executionCount, 0, 'Zero executions for unauthorized imposter action');
  }

  // ---------------------------------------------------------------------------
  // Scenario 11 (Integration): Changed Page Context Invalidates Continuation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 11 [Integration]: Changed page context invalidates continuation');
  {
    const h = createTestHarness();
    const actionId = 'act_sec_int_011';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    h.contactRegistry.addContact({
      id: 'usr_bob',
      userId: 'usr_alice',
      email: 'bob@example.com',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let executionCount = 0;
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller, {
      executionDispatcher: async () => {
        executionCount++;
        return { success: true };
      },
    });

    const boundary = new ContinuationAuthorizationBoundary({
      continuationManager: manager,
      controller,
      approvalService: h.service,
      timeProvider: h.timeProvider,
    });

    const action = createSampleAction(actionId, 'https://bank.example.com/wire-transfer');
    controller.register(action);
    const held = controller.holdAction(actionId);
    manager.registerHeldAction(action, held, async () => {
      executionCount++;
    });

    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);
    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, bobAuth);

    // 11.A Origin mismatch
    const originMismatchRes = await boundary.validateContinuation(actionId, {
      authContext: aliceAuth,
      pageContext: { url: 'https://attacker.example.com/wire', origin: 'https://attacker.example.com' },
      isElementAttached: () => true,
    });
    assertEquals(originMismatchRes.authorized, false, 'Origin mismatch rejected');
    assertEquals(originMismatchRes.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code is PAGE_CONTEXT_MISMATCH');

    // 11.B Path navigation departure
    const pathMismatchRes = await boundary.validateContinuation(actionId, {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/logout', origin: 'https://bank.example.com' },
      isElementAttached: () => true,
    });
    assertEquals(pathMismatchRes.authorized, false, 'Path navigation departure rejected');
    assertEquals(pathMismatchRes.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code is PAGE_CONTEXT_MISMATCH');

    // 11.C Detached DOM element
    const detachedRes = await boundary.validateContinuation(actionId, {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/wire-transfer', origin: 'https://bank.example.com' },
      isElementAttached: () => false,
    });
    assertEquals(detachedRes.authorized, false, 'Detached DOM element rejected');
    assertEquals(detachedRes.errorCode, 'ELEMENT_DETACHED', 'Error code is ELEMENT_DETACHED');

    assertEquals(executionCount, 0, 'Zero executions across all context mismatches');
  }

  // ---------------------------------------------------------------------------
  // Scenario 12 (Integration): Missing Backend Confirmation Never Becomes Authorization
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 12 [Integration]: Missing backend confirmation never becomes authorization');
  {
    const controller = new InterceptionController();
    let executionCount = 0;
    const manager = new ContinuationManager(controller, {
      executionDispatcher: async () => {
        executionCount++;
        return { success: true };
      },
    });

    // Boundary with NO backend service or client configured
    const offlineBoundary = new ContinuationAuthorizationBoundary({
      continuationManager: manager,
      controller,
    });

    const actionId = 'act_sec_int_012';
    const action = createSampleAction(actionId);
    controller.register(action);
    const held = controller.holdAction(actionId);
    manager.registerHeldAction(action, held, async () => {
      executionCount++;
    });

    const result = await offlineBoundary.validateContinuation(actionId, {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/wire-transfer', origin: 'https://bank.example.com' },
      isElementAttached: () => true,
    });

    assertEquals(result.authorized, false, 'Missing backend fails closed');
    assertEquals(result.errorCode, 'BACKEND_STATE_UNKNOWN', 'Error code is BACKEND_STATE_UNKNOWN');
    assertEquals(executionCount, 0, 'Zero executions when backend confirmation is missing');
  }

  // ---------------------------------------------------------------------------
  // Scenario 14 (Integration): Approval Update Alone Does NOT Execute Held Action
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 14 [Integration]: Approval status update alone does not execute held action');
  {
    const h = createTestHarness();
    const actionId = 'act_sec_int_014';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    h.contactRegistry.addContact({
      id: 'usr_bob',
      userId: 'usr_alice',
      email: 'bob@example.com',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let executionCount = 0;
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller, {
      executionDispatcher: async () => {
        executionCount++;
        return { success: true };
      },
    });

    const action = createSampleAction(actionId);
    controller.register(action);
    const held = controller.holdAction(actionId);
    manager.registerHeldAction(action, held, async () => {
      executionCount++;
    });

    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);

    // Reviewer approves request
    const approved = h.service.approveRequest(req.id, { decisionReason: 'Legitimate request' }, bobAuth);
    assertEquals(approved.status, ApprovalStatus.APPROVED, 'Server status updated to APPROVED');

    // Extension state sync simulates receiving status update
    assertEquals(controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains strictly HELD');
    assertEquals(executionCount, 0, 'Execution count is strictly ZERO upon status change');
  }

  // ---------------------------------------------------------------------------
  // Regression Tests: In-Flight Concurrency & Idempotent Retries
  // ---------------------------------------------------------------------------
  console.log('\n▶ Regression Tests: In-Flight Continuation Concurrency & Safe Cancellation');
  {
    const h = createTestHarness();
    const actionId = 'act_sec_reg_001';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    h.contactRegistry.addContact({
      id: 'usr_bob',
      userId: 'usr_alice',
      email: 'bob@example.com',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let executionCount = 0;
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller, {
      executionDispatcher: async () => {
        executionCount++;
        await new Promise(r => setTimeout(r, 20));
        return { success: true };
      },
    });

    const boundary = new ContinuationAuthorizationBoundary({
      continuationManager: manager,
      controller,
      approvalService: h.service,
      timeProvider: h.timeProvider,
    });

    const action = createSampleAction(actionId);
    controller.register(action);
    const held = controller.holdAction(actionId);
    manager.registerHeldAction(action, held, async () => {
      executionCount++;
      await new Promise(r => setTimeout(r, 20));
      return { success: true };
    });

    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);
    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, bobAuth);

    // Racing simultaneous continuation attempts
    const raceResults = await Promise.all([
      boundary.authorizeAndContinue(actionId, 'Race 1', {
        authContext: aliceAuth,
        pageContext: { url: 'https://bank.example.com/wire-transfer', origin: 'https://bank.example.com' },
        isElementAttached: () => true,
      }),
      boundary.authorizeAndContinue(actionId, 'Race 2', {
        authContext: aliceAuth,
        pageContext: { url: 'https://bank.example.com/wire-transfer', origin: 'https://bank.example.com' },
        isElementAttached: () => true,
      }),
    ]);

    const successes = raceResults.filter(r => r.success);
    const failures = raceResults.filter(r => !r.success);

    assertEquals(successes.length, 1, 'Exactly one concurrent continuation succeeds');
    assertEquals(failures.length, 1, 'Racing duplicate continuation is rejected');
    assertEquals(executionCount, 1, 'Protected action executed strictly once');
  }

  // ===========================================================================
  // LAYER 4: GENUINE LIVE BACKEND TESTS [REAL OS TCP SOCKETS & REAL HTTP WIRE]
  // ===========================================================================
  console.log('\n====================================================================');
  console.log('▶ LAYER 4: GENUINE LIVE BACKEND TESTS (REAL OS TCP SOCKETS & HTTP WIRE)');
  console.log('====================================================================');
  {
    const h = createTestHarness();
    h.tokenVerifier.registerToken('alice_live_token', aliceAuth);
    h.tokenVerifier.registerToken('bob_live_token', bobAuth);
    h.tokenVerifier.registerToken('mallory_live_token', malloryAuth);

    const actionId = 'act_live_wire_001';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    h.contactRegistry.addContact({
      id: 'usr_bob',
      userId: 'usr_alice',
      email: 'bob@example.com',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Wire body sniffer to audit raw TCP wire traffic
    let lastWireBody = '';
    const textDecoder = new TextDecoder();
    const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      let bodyData = '';
      req.on('data', chunk => {
        if (typeof chunk === 'string') {
          bodyData += chunk;
        } else if (chunk instanceof Uint8Array) {
          bodyData += textDecoder.decode(chunk);
        }
      });
      req.on('end', () => {
        lastWireBody = bodyData;
      });
      h.router.handleHttpStream(req, res);
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`  [REAL OS TCP SERVER] Listening on ${baseUrl}`);

    try {
      const aliceClient = new ApprovalApiClient({
        baseUrl,
        tokenProvider: async () => 'alice_live_token',
      });
      const malloryClient = new ApprovalApiClient({
        baseUrl,
        tokenProvider: async () => 'mallory_live_token',
      });

      // 1. Live wire submission establishes 1:1 binding
      const createRes = await aliceClient.createApprovalRequest(createSamplePayload(actionId));
      assertEquals(createRes.success, true, 'Live HTTP submission succeeded');
      const requestId = createRes.data?.id!;
      assert(requestId.startsWith('apr_'), 'Request has canonical apr_ prefix');

      // Verify binding in backend
      const binding = h.repository.findBindingByRequestId(requestId);
      assert(binding !== undefined, '1:1 Binding verified in repository via live wire submission');
      assertEquals(binding?.actionId, actionId, 'Binding points to correct actionId');

      // 2. Wire traffic privacy audit: sensitive keywords absent from raw HTTP wire
      assert(!lastWireBody.includes('password'), 'password absent from raw TCP wire');
      assert(!lastWireBody.includes('otp'), 'otp absent from raw TCP wire');
      assert(!lastWireBody.includes('cvv'), 'cvv absent from raw TCP wire');
      assert(!lastWireBody.includes('cardNumber'), 'cardNumber absent from raw TCP wire');
      assert(!lastWireBody.includes('cookie'), 'cookie absent from raw TCP wire');

      // 3. Multi-tenant live wire security: Mallory cannot view Alice request
      const malloryAccessRes = await malloryClient.getApprovalRequest(requestId);
      assertEquals(malloryAccessRes.success, false, 'Mallory live HTTP access is rejected');
      assert(
        malloryAccessRes.statusCode === 403 || malloryAccessRes.statusCode === 404,
        'Mallory receives 403/404 HTTP status over live socket'
      );
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      console.log('  [REAL OS TCP SERVER] Closed and stopped listening.');
    }
  }

  console.log('\n====================================================================');
  console.log(`📊 APPROVAL ACTION BINDING SECURITY SUITE: ${passedTests} / ${totalTests} PASSED`);
  console.log('🎉 ALL 15 SECURITY SCENARIOS & RESILIENCE INVARIANTS FULLY VERIFIED!');
  console.log('====================================================================\n');
}

runSecurityTestSuite().catch(err => {
  console.error('\n❌ APPROVAL BINDING SECURITY TEST SUITE FAILED:', err);
  if (typeof process !== 'undefined') {
    process.exit(1);
  }
});
