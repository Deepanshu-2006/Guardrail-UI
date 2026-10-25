/**
 * Guardrail Approval Concurrency, Race Condition & Idempotency Test Suite
 *
 * Exhaustive verification of approval-to-action binding hardening against:
 * 1. Concurrent request creation & compound idempotency deduplication.
 * 2. Conflicting binding prevention and anti-reassignment enforcement.
 * 3. Concurrent conflicting decisions (first-responder wins, loser gets 409 Conflict).
 * 4. Safe repeated cancellation & idempotent reconciliation.
 * 5. Atomic multi-entity state transitions & rollback guarantees.
 * 6. Stale extension responses & invalidation immunity.
 * 7. In-flight and sequential duplicate continuation rejection.
 * 8. Persistence layer concurrency model audit & limitations verification.
 */

declare const process: any;

import { ActionType, GuardrailAction } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import {
  ApprovalActionBinding,
  ApprovalActionBindingState,
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import {
  ApprovalBindingConflictError,
  createApprovalActionBinding,
  transitionBindingState,
} from './binding.js';
import { TimeProvider } from './model.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
  PERSISTENCE_METADATA,
} from './repository.js';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from './authorization.js';
import { ApprovalService } from './service.js';
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
// Test Fixtures
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

function createTestHarness(initialIsoTime: string = '2026-10-25T10:00:00.000Z'): TestHarness {
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

function createSamplePayload(actionId: string): ClientApprovalRequestPayload {
  return {
    actionId,
    actionDescription: 'Transfer $500 to savings',
    actionType: ActionType.CLICK,
    riskLevel: RiskLevel.HIGH,
    riskScore: 78,
    riskReasons: ['Unusual recipient', 'High amount'],
    pageContext: {
      url: 'https://bank.example.com/transfer',
      origin: 'https://bank.example.com',
      hostname: 'bank.example.com',
      pageTitle: 'Online Banking - Transfer Funds',
    },
  };
}

function createSampleAction(actionId: string): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    target: {
      selector: '#btn-submit-transfer',
      elementId: 'btn-submit-transfer',
      tagName: 'BUTTON',
      text: 'Confirm Transfer',
    },
    risk: {
      level: RiskLevel.HIGH,
      score: 78,
      factors: ['Unusual recipient', 'High amount'],
    },
    context: {
      page: {
        url: 'https://bank.example.com/transfer',
        origin: 'https://bank.example.com',
        title: 'Online Banking - Transfer Funds',
      },
      timestamp: Date.now(),
      isolationStatus: 'STAGED',
    },
  };
}

// =============================================================================
// Test Execution
// =============================================================================

async function runConcurrencyTests(): Promise<void> {
  console.log('====================================================================');
  console.log('🔒 GUARDRAIL APPROVAL CONCURRENCY & RACE-CONDITION HARDENING TESTS');
  console.log('====================================================================\n');

  // ---------------------------------------------------------------------------
  // Suite 1: Concurrent Request Creation & Compound Idempotency
  // ---------------------------------------------------------------------------
  console.log('▶ Suite 1: Concurrent Request Creation & Compound Idempotency');
  {
    const h = createTestHarness();
    const actionId = 'act_conc_create_001';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');

    // Simulate 5 concurrent submissions for the exact same action from Alice
    const payload = createSamplePayload(actionId);
    const creationPromises = Array.from({ length: 5 }, () =>
      Promise.resolve().then(() => h.service.createRequest(payload, aliceAuth))
    );

    const results = await Promise.all(creationPromises);

    // All callers should receive a valid approval request
    assertEquals(results.length, 5, 'All 5 concurrent requests settled');

    // All results must reference the exact same canonical requestId
    const firstId = results[0].id;
    for (let i = 1; i < results.length; i++) {
      assertEquals(results[i].id, firstId, `Caller ${i} received identical canonical requestId`);
      assertEquals(results[i].status, ApprovalStatus.PENDING, `Caller ${i} received PENDING status`);
    }

    // Exactly ONE request entity in the repository
    const storedRequests = h.repository.findAll();
    assertEquals(storedRequests.length, 1, 'Exactly one ApprovalRequest persisted in repository');

    // Exactly ONE binding entity in the repository
    const binding = h.repository.findBindingByRequestId(firstId);
    assert(binding !== undefined, 'Binding exists for request');
    assertEquals(binding?.actionId, actionId, 'Binding points to correct actionId');
    assertEquals(binding?.state, ApprovalActionBindingState.BOUND, 'Binding state is BOUND');
  }

  // ---------------------------------------------------------------------------
  // Suite 2: Conflicting Binding Prevention and Anti-Reassignment
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 2: Conflicting Binding Prevention & Anti-Reassignment');
  {
    const h = createTestHarness();
    const actionId1 = 'act_conflict_001';
    const actionId2 = 'act_conflict_002';
    h.actionOwnershipRegistry.registerActionOwnership(actionId1, 'usr_alice');
    h.actionOwnershipRegistry.registerActionOwnership(actionId2, 'usr_alice');

    // Create first request bound to actionId1
    const req1 = h.service.createRequest(createSamplePayload(actionId1), aliceAuth);
    assertEquals(req1.status, ApprovalStatus.PENDING, 'First request created successfully');

    // Attempting to re-save an active binding for actionId1 to a different request throws conflict
    const conflictingBinding = createApprovalActionBinding(
      {
        requestId: 'apr_conflicting_fake',
        actionId: actionId1,
        requesterId: 'usr_alice',
        expiresAt: new Date(h.timeProvider().getTime() + 600000).toISOString(),
      },
      { timeProvider: h.timeProvider }
    );

    assertThrows(
      () => h.repository.saveBinding(conflictingBinding),
      'ApprovalBindingConflictError',
      'Saving conflicting active binding for same actionId is rejected'
    );

    // Saving via saveRequestWithBinding enforces conflict check for active action
    const secondBinding = createApprovalActionBinding(
      {
        requestId: 'apr_conflicting_second',
        actionId: actionId1, // Same actionId which is already bound to req1
        requesterId: 'usr_alice',
        expiresAt: new Date(h.timeProvider().getTime() + 600000).toISOString(),
      },
      { timeProvider: h.timeProvider }
    );
    const fakeReqWithNoBinding: ApprovalRequest = {
      ...req1,
      id: 'apr_conflicting_second',
      bindingId: undefined,
    };
    assertThrows(
      () => h.repository.saveRequestWithBinding(fakeReqWithNoBinding, secondBinding),
      'ApprovalBindingConflictError',
      'saveRequestWithBinding rejects conflicting active binding for same actionId'
    );

    // And attempting to rebind req1 to actionId2 throws ApprovalBindingReassignmentError
    const rebindingAttempt = createApprovalActionBinding(
      {
        requestId: req1.id,
        actionId: actionId2,
        requesterId: 'usr_alice',
        expiresAt: new Date(h.timeProvider().getTime() + 600000).toISOString(),
      },
      { timeProvider: h.timeProvider }
    );
    assertThrows(
      () => h.repository.saveRequestWithBinding(req1, rebindingAttempt),
      'ApprovalBindingReassignmentError',
      'Rebinding existing request to different action is strictly prohibited'
    );
  }

  // ---------------------------------------------------------------------------
  // Suite 3: Concurrent Conflicting Decisions (First-Responder Wins)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Concurrent Conflicting Decisions (First-Responder Wins)');
  {
    const h = createTestHarness();
    const actionId = 'act_race_dec_001';
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

    // Two trusted contacts race: Bob approves, Charlie rejects concurrently
    const raceResults = await Promise.allSettled([
      Promise.resolve().then(() => h.service.approveRequest(req.id, { decisionReason: 'Bob approves' }, bobAuth)),
      Promise.resolve().then(() => h.service.rejectRequest(req.id, { decisionReason: 'Charlie rejects' }, charlieAuth)),
    ]);

    const fulfilled = raceResults.filter(r => r.status === 'fulfilled');
    const rejected = raceResults.filter(r => r.status === 'rejected');

    assertEquals(fulfilled.length, 1, 'Exactly one concurrent decision succeeded');
    assertEquals(rejected.length, 1, 'Exactly one concurrent decision failed with conflict');

    const winnerResult = (fulfilled[0] as PromiseFulfilledResult<ApprovalRequest>).value;
    const loserError = (rejected[0] as PromiseRejectedResult).reason;

    assert(
      winnerResult.status === ApprovalStatus.APPROVED || winnerResult.status === ApprovalStatus.REJECTED,
      'Winner transitioned request to terminal decision'
    );

    assertEquals(
      loserError.name,
      'ApprovalAlreadyResolvedError',
      'Losing reviewer caught ApprovalAlreadyResolvedError (409 Conflict)'
    );

    // Verify authoritative repository state matches the winner
    const authoritative = h.service.getRequest(req.id, aliceAuth);
    assertEquals(authoritative.status, winnerResult.status, 'Repository state matches winner decision');

    const binding = h.repository.findBindingByRequestId(req.id);
    const expectedBindingState =
      winnerResult.status === ApprovalStatus.APPROVED
        ? ApprovalActionBindingState.APPROVED
        : ApprovalActionBindingState.REJECTED;
    assertEquals(binding?.state, expectedBindingState, 'Binding state matches winner decision');
  }

  // ---------------------------------------------------------------------------
  // Suite 4: Safe Repeated Cancellation & Idempotent Behavior
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Safe Repeated Cancellation & Idempotent Behavior');
  {
    const h = createTestHarness();
    const actionId = 'act_repeat_cancel_001';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);

    // 4.1 First cancellation succeeds
    const cancel1 = h.service.cancelRequest(req.id, 'User closed modal', aliceAuth);
    assertEquals(cancel1.status, ApprovalStatus.CANCELLED, 'First cancellation succeeds');

    // 4.2 Non-idempotent repeat cancellation throws 409 Conflict (preserves contract test invariant)
    assertThrows(
      () => h.service.cancelRequest(req.id, 'User closed modal again', aliceAuth),
      'ApprovalAlreadyResolvedError',
      'Default repeated cancellation without idempotent flag throws ApprovalAlreadyResolvedError'
    );

    // 4.3 Idempotent repeat cancellation succeeds with 200 / cancelled entity
    const cancelIdempotent = h.service.cancelRequest(req.id, 'User closed modal again', aliceAuth, {
      idempotent: true,
    });
    assertEquals(cancelIdempotent.status, ApprovalStatus.CANCELLED, 'Idempotent cancellation returns cancelled entity');
    assertEquals(cancelIdempotent.id, req.id, 'Idempotent cancellation returns same requestId');

    // 4.4 HTTP Router level verification
    h.tokenVerifier.registerToken('alice_token', aliceAuth);

    // API cancel request with idempotent: true
    const apiReqIdempotent: ApiRequest = {
      method: 'POST',
      url: `/api/v1/approval-requests/${req.id}/cancel`,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer alice_token',
      },
      body: {
        reason: 'Client retry cancellation',
        idempotent: true,
      },
    };

    const routerRes = await h.router.dispatch(apiReqIdempotent);
    assertEquals(routerRes.statusCode, 200, 'Router returns 200 OK for idempotent repeat cancellation');
    assertEquals((routerRes.body as any).data.status, ApprovalStatus.CANCELLED, 'Router response contains CANCELLED entity');

    // API cancel request without idempotent flag returns 409
    const apiReqStrict: ApiRequest = {
      method: 'POST',
      url: `/api/v1/approval-requests/${req.id}/cancel`,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer alice_token',
      },
      body: {
        reason: 'Strict cancel',
      },
    };
    const strictRes = await h.router.dispatch(apiReqStrict);
    assertEquals(strictRes.statusCode, 409, 'Router returns 409 Conflict for strict repeat cancellation');

    // 4.5 Client level verification
    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: async () => 'alice_token',
      fetchFn: async (_url, init) => {
        const bodyObj = init?.body ? JSON.parse(String(init.body)) : undefined;
        const res = await h.router.dispatch({
          method: (init?.method as any) || 'GET',
          url: String(_url).replace('http://localhost:3000', ''),
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer alice_token',
          },
          body: bodyObj,
        });
        return {
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: new Headers(res.headers),
          json: async () => res.body,
          text: async () => JSON.stringify(res.body),
        } as unknown as Response;
      },
    });

    const clientCancelRes = await client.cancelApprovalRequest(req.id, 'Client cancel', { idempotent: true });
    assertEquals(clientCancelRes.success, true, 'ApprovalApiClient cancel with idempotent: true succeeds');
    assertEquals(clientCancelRes.data?.status, ApprovalStatus.CANCELLED, 'Client received CANCELLED status');
  }

  // ---------------------------------------------------------------------------
  // Suite 5: Atomic Multi-Entity Transitions & Rollback Guarantee
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Atomic Multi-Entity Transitions & Rollback Guarantee');
  {
    const h = createTestHarness();
    const actionId = 'act_atomic_test_001';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');

    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);
    const initialBinding = h.repository.findBindingByRequestId(req.id)!;
    assertEquals(initialBinding.state, ApprovalActionBindingState.BOUND, 'Initial binding is BOUND');

    // Manually alter binding state in repository to simulate a concurrent out-of-band invalidation
    const invalidatedBinding = transitionBindingState(
      initialBinding,
      ApprovalActionBindingState.INVALIDATED,
      { reason: 'Simulated out-of-band invalidation', timeProvider: h.timeProvider }
    );
    h.repository.saveBinding(invalidatedBinding);

    // Attempt atomicTransitionRequestAndBinding expecting binding to be BOUND
    const updatedReq: ApprovalRequest = {
      ...req,
      status: ApprovalStatus.APPROVED,
    };
    const approvedBinding: ApprovalActionBinding = {
      ...initialBinding,
      state: ApprovalActionBindingState.APPROVED,
    };

    const atomicSuccess = h.repository.atomicTransitionRequestAndBinding(
      req.id,
      ApprovalStatus.PENDING,
      updatedReq,
      initialBinding.id,
      ApprovalActionBindingState.BOUND, // Expecting BOUND, but actual is INVALIDATED
      approvedBinding
    );

    assertEquals(atomicSuccess, false, 'atomicTransitionRequestAndBinding returns false on binding mismatch');

    // Request MUST remain PENDING (rollback / no partial commit)
    const storedReq = h.repository.findById(req.id);
    assertEquals(storedReq?.status, ApprovalStatus.PENDING, 'Request status remains PENDING (atomic rollback)');

    // Binding MUST remain INVALIDATED
    const storedBinding = h.repository.findBindingById(initialBinding.id);
    assertEquals(storedBinding?.state, ApprovalActionBindingState.INVALIDATED, 'Binding state remains INVALIDATED');
  }

  // ---------------------------------------------------------------------------
  // Suite 6: Stale Extension Responses & Invalidation Immunity
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 6: Stale Extension Responses & Invalidation Immunity');
  {
    const h = createTestHarness();
    const actionId = 'act_stale_resp_001';
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');

    const controller = new InterceptionController();
    const action = createSampleAction(actionId);
    controller.register(action);
    const heldRecord = controller.holdAction(actionId);

    const manager = new ContinuationManager(controller);
    manager.registerHeldAction(action, heldRecord, () => {});

    const boundary = new ContinuationAuthorizationBoundary({
      continuationManager: manager,
      approvalService: h.service,
      controller,
      timeProvider: h.timeProvider,
    });

    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);

    // User cancels the action in the UI / backend
    h.service.cancelRequest(req.id, 'User aborted action', aliceAuth);

    // A delayed / stale extension response or background message arrives claiming approval
    const lateAttempt = await boundary.validateContinuation(actionId, {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/transfer', origin: 'https://bank.example.com' },
      isElementAttached: () => true,
    });

    assertEquals(lateAttempt.authorized, false, 'Stale response authorization is strictly rejected');
    assert(
      lateAttempt.errorCode === 'BINDING_CANCELLED' || lateAttempt.errorCode === 'REQUEST_CANCELLED',
      'Rejection code indicates BINDING_CANCELLED or REQUEST_CANCELLED'
    );

    // Attempting to continue the cancelled action must fail closed
    const contResult = await boundary.authorizeAndContinue(actionId, 'Stale continuation attempt', {
      authContext: aliceAuth,
    });
    assertEquals(contResult.success, false, 'Continuation execution fails closed');
    assertEquals(contResult.executed, false, 'Action was NOT executed');
  }

  // ---------------------------------------------------------------------------
  // Suite 7: In-Flight & Sequential Duplicate Continuation Rejection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 7: In-Flight & Sequential Duplicate Continuation Rejection');
  {
    const h = createTestHarness();
    const actionId = 'act_inflight_dup_001';
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
        // Simulate a small asynchronous delay during continuation
        await new Promise(resolve => setTimeout(resolve, 20));
        return { success: true, count: executionCount };
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
    const heldRecord = controller.holdAction(actionId);
    manager.registerHeldAction(action, heldRecord, async () => {
      executionCount++;
      await new Promise(resolve => setTimeout(resolve, 20));
      return { success: true };
    });

    // Create & approve request
    const req = h.service.createRequest(createSamplePayload(actionId), aliceAuth);
    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, bobAuth);

    // Racing concurrent continuation calls
    const raceResults = await Promise.all([
      boundary.authorizeAndContinue(actionId, 'Race call 1', {
        authContext: aliceAuth,
        pageContext: { url: 'https://bank.example.com/transfer', origin: 'https://bank.example.com' },
        isElementAttached: () => true,
      }),
      boundary.authorizeAndContinue(actionId, 'Race call 2', {
        authContext: aliceAuth,
        pageContext: { url: 'https://bank.example.com/transfer', origin: 'https://bank.example.com' },
        isElementAttached: () => true,
      }),
    ]);

    const successes = raceResults.filter(r => r.success);
    const failures = raceResults.filter(r => !r.success);

    assertEquals(successes.length, 1, 'Exactly one concurrent continuation succeeded');
    assertEquals(failures.length, 1, 'In-flight racing continuation was rejected');
    assert(
      failures[0].error?.includes('already actively in progress') || failures[0].error?.includes('already executed') || false,
      'Rejection error specifies in-flight or executed duplicate rejection'
    );

    // Sequential subsequent continuation attempt is also rejected
    const sequentialAttempt = await boundary.authorizeAndContinue(actionId, 'Sequential duplicate', {
      authContext: aliceAuth,
    });
    assertEquals(sequentialAttempt.success, false, 'Sequential duplicate continuation rejected');
    assertEquals(executionCount, 1, 'Underlying handler executed strictly once (no duplicate executions)');
  }

  // ---------------------------------------------------------------------------
  // Suite 8: Persistence Layer Concurrency Model & Limitations Audit
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 8: Persistence Layer Concurrency Model & Limitations Audit');
  {
    assert(PERSISTENCE_METADATA !== undefined, 'PERSISTENCE_METADATA is defined');
    assertEquals(PERSISTENCE_METADATA.IS_PRODUCTION, false, 'Persistence correctly flagged not production ready');
    assertEquals(PERSISTENCE_METADATA.TYPE, 'EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY', 'Storage type is in-memory');

    // Audit concurrency model declarations
    assert(PERSISTENCE_METADATA.CONCURRENCY_MODEL !== undefined, 'CONCURRENCY_MODEL metadata defined');
    assert(
      PERSISTENCE_METADATA.CONCURRENCY_MODEL.includes('in-memory') || PERSISTENCE_METADATA.CONCURRENCY_MODEL.includes('CAS'),
      'CONCURRENCY_MODEL describes in-memory CAS state machine'
    );

    // Audit limitations documentation
    assert(PERSISTENCE_METADATA.LIMITATIONS.length >= 4, 'At least 4 explicit limitations documented');
    assert(
      PERSISTENCE_METADATA.LIMITATIONS.some(l => l.includes('cross-process') || l.includes('distributed') || l.includes('Multi-process')),
      'Documents limitation regarding distributed / multi-process scale-out'
    );
    assert(
      PERSISTENCE_METADATA.LIMITATIONS.some(l => l.includes('crash') || l.includes('restarts')),
      'Documents limitation regarding crash / restart persistence'
    );
    assert(
      PERSISTENCE_METADATA.LIMITATIONS.some(l => l.includes('ACID') || l.includes('transaction')),
      'Documents transaction boundaries for in-memory development repository'
    );
  }

  console.log('\n====================================================================');
  console.log(`📊 CONCURRENCY & RACE-CONDITION HARDENING: ${passedTests} / ${totalTests} PASSED`);
  console.log('🎉 ALL CONCURRENCY HARDENING INVARIANTS FULLY SATISFIED!');
  console.log('====================================================================\n');
}

runConcurrencyTests().catch(err => {
  console.error('\n❌ CONCURRENCY HARDENING TEST SUITE FAILED:', err);
  if (typeof process !== 'undefined') {
    process.exit(1);
  }
});
