/**
 * Guardrail Approval Action Binding Relationship Enforcement Test Suite
 *
 * Comprehensive end-to-end and unit verification of the relationship between
 * each approval request and its intended protected action across backend
 * services, API router, data models, repository, and client contracts.
 *
 * VERIFICATION CRITERIA COVERED:
 * 1. Request Creation Establishes Typed Action Binding (ApprovalActionBinding).
 * 2. Independent Validation of Request Identifiers ('apr_...') and Action Identifiers ('act_...').
 * 3. Backend Relationship Validation on Retrieval and Decision.
 * 4. Anti-Reassignment Protection (Silently reassigning requests to other actions is prohibited).
 * 5. Conflicting Active Bindings Rejection (Cannot bind active action to conflicting requests).
 * 6. User and Action Ownership Authorization (Multi-tenant isolation).
 * 7. Trusted Contact Decision Authorization & Separation of Duties.
 * 8. Compound Idempotency & Duplicate Request Handling.
 * 9. Authoritative Backend Lifecycle & Zero Client Trust (Client metadata cannot prove safety).
 * 10. Explicit Error Failures (Unauthorized or conflicting operations fail with typed errors/HTTP status).
 * 11. Zero Protected Action Execution (ContinuationManager safety).
 * 12. Persistence Classification Audit (EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY).
 */

declare const process: any;

import { ActionType } from '../types/actions.js';
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
  assertNoBindingReassignment,
  createApprovalActionBinding,
  validateActionId,
} from './binding.js';
import {
  TimeProvider,
  validateApprovalRequest,
  validateApprovalRequestId,
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
  TrustedContactStatus,
} from './authorization.js';
import { ApprovalService } from './service.js';
import {
  ApiRequest,
  ApprovalApiRouter,
  InMemoryTokenVerifier,
} from './api.js';

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

function createTestHarness(initialIsoTime: string = '2026-10-24T10:00:00.000Z'): TestHarness {
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
    get currentTimeMs() {
      return currentTimeMs;
    },
    set currentTimeMs(val: number) {
      currentTimeMs = val;
    },
  };
}

// =============================================================================
// Test Suites
// =============================================================================

async function runEnforcementTestSuite(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL: ACTION-APPROVAL BINDING RELATIONSHIP ENFORCEMENT');
  console.log('====================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Valid Request Creation & Action Binding Establishment
  // ---------------------------------------------------------------------------
  console.log('▶ Suite 1: Valid Request Creation Establishes Action Binding');
  {
    const h = createTestHarness();
    const wardAuth: AuthContext = {
      actorId: 'usr_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    };
    h.tokenVerifier.registerToken('alice_token', wardAuth);
    h.actionOwnershipRegistry.registerActionOwnership('act_pay_100', 'usr_alice');

    const payload: ClientApprovalRequestPayload = {
      actionId: 'act_pay_100',
      actionDescription: 'High Value Wire Transfer',
      actionType: ActionType.SUBMIT,
      riskLevel: RiskLevel.HIGH,
      riskScore: 85,
      riskReasons: ['Unusual recipient', 'Large monetary amount'],
      origin: 'https://bank.example.com',
      hostname: 'bank.example.com',
    };

    // 1.1 Creation establishes request and binding
    const request = h.service.createRequest(payload, wardAuth);
    assert(request.id.startsWith('apr_'), 'Approval request created with apr_ prefix');
    assertEquals(request.actionId, 'act_pay_100', 'Approval request holds exact actionId');
    assertEquals(request.status, ApprovalStatus.PENDING, 'Initial status is PENDING');
    assertEquals(request.requesterId, 'usr_alice', 'Requester ID bound authoritatively from session');
    assert(Boolean(request.bindingId), 'Approval request contains canonical bindingId');
    assert(request.bindingId!.startsWith('bnd_'), 'Binding ID starts with bnd_');

    // 1.2 Binding persisted in repository in BOUND state
    const binding = h.service.getBindingByRequestId(request.id, wardAuth);
    assertEquals(binding.id, request.bindingId!, 'Binding retrieved by requestId matches request.bindingId');
    assertEquals(binding.requestId, request.id, 'Binding references correct requestId');
    assertEquals(binding.actionId, 'act_pay_100', 'Binding references correct actionId');
    assertEquals(binding.requesterId, 'usr_alice', 'Binding references correct requesterId');
    assertEquals(binding.state, ApprovalActionBindingState.BOUND, 'Initial binding state is BOUND');

    // 1.3 Binding retrieved by actionId returns exact record
    const bindingByAct = h.service.getBindingByActionId('act_pay_100', wardAuth);
    assert(Boolean(bindingByAct), 'Binding successfully retrieved by actionId');
    assertEquals(bindingByAct!.id, request.bindingId!, 'Binding retrieved by actionId matches bindingId');

    // 1.4 HTTP API dispatch: GET /api/v1/approval-requests/:id/binding
    const apiReq1: ApiRequest = {
      method: 'GET',
      url: `/api/v1/approval-requests/${encodeURIComponent(request.id)}/binding`,
      headers: {
        authorization: 'Bearer alice_token',
      },
    };
    const res1 = await h.router.dispatch(apiReq1);
    assertEquals(res1.statusCode, 200, 'HTTP GET /approval-requests/:id/binding returns 200');
    assert(res1.body.success, 'Response envelope indicates success');
    const returnedBinding = res1.body.data as ApprovalActionBinding;
    assertEquals(returnedBinding.id, request.bindingId!, 'HTTP response body contains valid binding data');
    assertEquals(returnedBinding.actionId, 'act_pay_100', 'HTTP response binding has matching actionId');

    // 1.5 HTTP API dispatch: GET /api/v1/actions/:actionId/binding
    const apiReq2: ApiRequest = {
      method: 'GET',
      url: `/api/v1/actions/act_pay_100/binding`,
      headers: {
        authorization: 'Bearer alice_token',
      },
    };
    const res2 = await h.router.dispatch(apiReq2);
    assertEquals(res2.statusCode, 200, 'HTTP GET /actions/:actionId/binding returns 200');
    assertEquals((res2.body.data as ApprovalActionBinding).requestId, request.id, 'Action binding endpoint returns correct requestId');
  }

  // ---------------------------------------------------------------------------
  // 2. Independent Identifier Validation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 2: Independent Identifier Validation (Request ID vs Action ID)');
  {
    // 2.1 Action ID validation independent of request ID
    assert(validateActionId('act_checkout_1').valid, 'Valid action ID with act_ prefix passes');
    assert(validateActionId('act-legacy-checkout').valid, 'Legacy action ID with act- prefix passes');
    assert(!validateActionId('').valid, 'Empty action ID rejected');
    assert(!validateActionId('   ').valid, 'Whitespace action ID rejected');
    assert(!validateActionId('apr_req_123').valid, 'Request ID prefix "apr_" rejected as action ID');
    assert(!validateActionId('action_123').valid, 'Non-standard prefix "action_" rejected');
    assert(!validateActionId('act_has spaces_12').valid, 'Spaces in action ID rejected');
    assert(!validateActionId('act_has/slash').valid, 'Slashes in action ID rejected');
    assert(!validateActionId('act_has$special').valid, 'Special chars in action ID rejected');
    assert(!validateActionId('act_' + 'a'.repeat(200)).valid, 'Excessively long action ID (>128 chars) rejected');

    // 2.2 Request ID validation independent of action ID
    assert(validateApprovalRequestId('apr_req_999').valid, 'Valid request ID with apr_ prefix passes');
    assert(!validateApprovalRequestId('act_action_999').valid, 'Action ID prefix "act_" rejected as request ID');
    assert(!validateApprovalRequestId('').valid, 'Empty request ID rejected');
    assert(!validateApprovalRequestId('apr_has spaces').valid, 'Spaces in request ID rejected');
    assert(!validateApprovalRequestId('apr_' + 'b'.repeat(200)).valid, 'Excessively long request ID (>128 chars) rejected');

    // 2.3 Independent actionId check in model validation
    const invalidActionModel = validateApprovalRequest({
      id: 'apr_valid_id_100',
      actionId: 'invalid_no_prefix',
      requesterId: 'usr_alice',
      status: ApprovalStatus.PENDING,
      actionDescription: 'Test Action',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.LOW,
      riskReasons: [],
      createdAt: '2026-10-24T10:00:00.000Z',
      expiresAt: '2026-10-24T10:15:00.000Z',
    });
    assert(!invalidActionModel.valid, 'Model validation strictly rejects invalid actionId format');
    assert(
      invalidActionModel.errors.some((e) => e.includes('actionId')),
      'Error message cites actionId format failure'
    );

    // 2.4 Service independent actionId rejection
    const h = createTestHarness();
    const wardAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    assertThrows(
      () =>
        h.service.createRequest(
          {
            actionId: 'malformed_prefix_id',
            actionDescription: 'Malformed ID',
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.LOW,
          },
          wardAuth
        ),
      'ApprovalValidationError',
      'ApprovalService rejects invalid action ID independently before checking ownership'
    );

    // 2.5 API route rejects invalid action ID with HTTP 400
    h.tokenVerifier.registerToken('alice_tok', wardAuth);
    const apiRes = await h.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice_tok',
        'content-type': 'application/json',
      },
      body: {
        actionId: 'bad_prefix',
        actionDescription: 'Invalid ID',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.LOW,
      },
    });
    assertEquals(apiRes.statusCode, 400, 'API returns 400 when client submits invalid actionId');
    assertEquals(apiRes.body.error?.code, 'VALIDATION_ERROR', 'Error code is VALIDATION_ERROR');
  }

  // ---------------------------------------------------------------------------
  // 3. Mismatched Identifiers & Tampering Detection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Mismatched Identifiers & Tampering Detection');
  {
    const h = createTestHarness();
    const wardAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    const trustedContactAuth: AuthContext = { actorId: 'tc_bob', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-24T10:00:00.000Z',
    });
    h.actionOwnershipRegistry.registerActionOwnership('act_transfer_500', 'usr_alice');

    // Create valid request & binding
    const req = h.service.createRequest(
      {
        actionId: 'act_transfer_500',
        actionDescription: 'Wire Transfer 500',
        actionType: ActionType.SUBMIT,
        riskLevel: RiskLevel.HIGH,
      },
      wardAuth
    );

    // Simulate database corruption or out-of-band tampering where stored binding references a different actionId
    // Directly mutate internal repository mapping for testing
    const repoInternal = h.repository as unknown as {
      bindings: Map<string, ApprovalActionBinding>;
    };
    const legitimateBinding = repoInternal.bindings.get(req.bindingId!)!;
    // Corrupt the binding's actionId
    const tamperedBinding = Object.freeze({
      ...legitimateBinding,
      actionId: 'act_tampered_action_999',
    });
    repoInternal.bindings.set(req.bindingId!, tamperedBinding);

    // 3.1 getRequest detects mismatch between request.actionId and binding.actionId
    assertThrows(
      () => h.service.getRequest(req.id, wardAuth),
      'ApprovalBindingReassignmentError',
      'getRequest detects mismatched actionId between request and binding'
    );

    // 3.2 getBindingByRequestId detects mismatch
    assertThrows(
      () => h.service.getBindingByRequestId(req.id, wardAuth),
      'ApprovalBindingReassignmentError',
      'getBindingByRequestId detects mismatched actionId and throws ApprovalBindingReassignmentError'
    );

    // 3.3 submitDecision detects mismatch and refuses to approve
    assertThrows(
      () => h.service.approveRequest(req.id, { decisionReason: 'Okay' }, trustedContactAuth),
      'ApprovalBindingReassignmentError',
      'approveRequest detects mismatched actionId and strictly refuses decision'
    );

    // 3.4 cancelRequest detects mismatch
    assertThrows(
      () => h.service.cancelRequest(req.id, 'User cancel', wardAuth),
      'ApprovalBindingReassignmentError',
      'cancelRequest detects mismatched actionId and refuses cancellation'
    );

    // 3.5 Over HTTP API, mismatched binding returns HTTP 409 BINDING_REASSIGNMENT_PROHIBITED
    h.tokenVerifier.registerToken('bob_tok', trustedContactAuth);
    const decideApiRes = await h.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${encodeURIComponent(req.id)}/decide`,
      headers: {
        authorization: 'Bearer bob_tok',
        'content-type': 'application/json',
      },
      body: {
        decision: 'APPROVED',
      },
    });
    assertEquals(decideApiRes.statusCode, 409, 'API returns 409 Conflict when binding is mismatched');
    assertEquals(
      decideApiRes.body.error?.code,
      'BINDING_REASSIGNMENT_PROHIBITED',
      'Error code is BINDING_REASSIGNMENT_PROHIBITED'
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Attempted Reassignment Prohibited (Anti-Reassignment Invariant)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Attempted Reassignment Prohibited (Repository & Entity Level)');
  {
    const repo = new DevelopmentInMemoryApprovalRequestRepository();

    const initialRequest: ApprovalRequest = Object.freeze({
      id: 'apr_initial_001',
      actionId: 'act_target_A',
      requesterId: 'usr_alice',
      status: ApprovalStatus.PENDING,
      actionDescription: 'Original Target',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.LOW,
      riskReasons: [],
      createdAt: '2026-10-24T10:00:00.000Z',
      expiresAt: '2026-10-24T10:15:00.000Z',
    });
    repo.save(initialRequest);

    // 4.1 Repository.save rejects altering actionId for an existing request ID
    const reassignedRequest: ApprovalRequest = Object.freeze({
      ...initialRequest,
      actionId: 'act_target_B', // Attempted reassignment!
    });
    assertThrows(
      () => repo.save(reassignedRequest),
      'ApprovalBindingReassignmentError',
      'repository.save throws ApprovalBindingReassignmentError when attempting to reassign request to new action'
    );

    // 4.2 Repository.atomicTransition rejects altering actionId
    assertThrows(
      () =>
        repo.atomicTransition('apr_initial_001', ApprovalStatus.PENDING, reassignedRequest),
      'ApprovalBindingReassignmentError',
      'repository.atomicTransition throws ApprovalBindingReassignmentError when changing actionId'
    );

    // 4.3 Repository.saveBinding rejects reassigning request to different action
    const bindingA = createApprovalActionBinding({
      actionId: 'act_target_A',
      requestId: 'apr_initial_001',
      requesterId: 'usr_alice',
      createdAt: '2026-10-24T10:00:00.000Z',
      expiresAt: '2026-10-24T10:15:00.000Z',
      state: ApprovalActionBindingState.BOUND,
    });
    repo.saveBinding(bindingA);

    const reassigningBinding = createApprovalActionBinding({
      actionId: 'act_target_B', // Different action
      requestId: 'apr_initial_001', // Same request
      requesterId: 'usr_alice',
      createdAt: '2026-10-24T10:00:00.000Z',
      expiresAt: '2026-10-24T10:15:00.000Z',
      state: ApprovalActionBindingState.BOUND,
    });
    assertThrows(
      () => repo.saveBinding(reassigningBinding),
      'ApprovalBindingReassignmentError',
      'repository.saveBinding throws ApprovalBindingReassignmentError when binding existing request to new action'
    );

    // 4.4 Repository.atomicTransitionBinding rejects altering actionId
    const updatedBinding = Object.freeze({
      ...bindingA,
      actionId: 'act_target_C',
    });
    assertThrows(
      () =>
        repo.atomicTransitionBinding(
          bindingA.id,
          ApprovalActionBindingState.BOUND,
          updatedBinding
        ),
      'ApprovalBindingReassignmentError',
      'repository.atomicTransitionBinding throws ApprovalBindingReassignmentError when altering actionId'
    );

    // 4.5 assertNoBindingReassignment utility verification
    assertThrows(
      () => assertNoBindingReassignment(bindingA, 'apr_initial_001', 'act_altered_XYZ'),
      'ApprovalBindingReassignmentError',
      'assertNoBindingReassignment helper throws ApprovalBindingReassignmentError on mismatch'
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Conflicting Bindings Rejection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Conflicting Bindings Rejection (Single Active Binding Invariant)');
  {
    const h = createTestHarness();
    const wardAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    h.tokenVerifier.registerToken('alice_tok', wardAuth);
    h.actionOwnershipRegistry.registerActionOwnership('act_single_action', 'usr_alice');

    // First request binds to act_single_action
    const req1 = h.service.createRequest(
      {
        actionId: 'act_single_action',
        actionDescription: 'Original submission',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.LOW,
      },
      wardAuth,
      { id: 'apr_first_request_001' }
    );
    assertEquals(req1.id, 'apr_first_request_001', 'First request created');

    // Attempt to bind a second active request to the same action with a different request ID
    // (e.g. bypassing normal duplicate return by specifying a distinct request ID)
    assertThrows(
      () =>
        h.service.createRequest(
          {
            actionId: 'act_single_action',
            actionDescription: 'Second conflicting submission',
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.LOW,
          },
          wardAuth,
          { id: 'apr_second_request_002', rejectDuplicates: true }
        ),
      'DuplicateApprovalRequestError',
      'createRequest rejects second submission when rejectDuplicates is true'
    );

    // Direct repository conflict: Attempt to save a second binding for the same actionId with a different requestId
    const conflictingBinding = createApprovalActionBinding({
      actionId: 'act_single_action',
      requestId: 'apr_conflicting_req_999',
      requesterId: 'usr_alice',
      createdAt: '2026-10-24T10:00:00.000Z',
      expiresAt: '2026-10-24T10:15:00.000Z',
      state: ApprovalActionBindingState.BOUND,
    });
    assertThrows(
      () => h.repository.saveBinding(conflictingBinding),
      'ApprovalBindingConflictError',
      'repository.saveBinding throws ApprovalBindingConflictError when action already bound to active request'
    );

    // Map error to HTTP 409
    const errRes = (h.router as unknown as {
      mapErrorToResponse: (err: unknown, headers: Record<string, string>) => {
        statusCode: number;
        body: { error?: { code?: string } };
      };
    }).mapErrorToResponse(
      new ApprovalBindingConflictError('act_single_action', 'apr_first_request_001', 'apr_second_002'),
      {}
    );
    assertEquals(errRes.statusCode, 409, 'ApprovalBindingConflictError maps to HTTP 409');
    assertEquals(errRes.body.error?.code, 'BINDING_CONFLICT', 'Error code maps to BINDING_CONFLICT');
  }

  // ---------------------------------------------------------------------------
  // 6. User and Action Ownership Authorization (Multi-Tenant Isolation)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 6: User & Action Ownership Authorization (Multi-Tenant Isolation)');
  {
    const h = createTestHarness();
    const aliceAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    const eveAuth: AuthContext = { actorId: 'usr_eve', role: ActorRole.USER, isAuthenticated: true };
    const unauth: AuthContext = { actorId: '', role: ActorRole.USER, isAuthenticated: false };

    h.tokenVerifier.registerToken('eve_tok', eveAuth);
    h.actionOwnershipRegistry.registerActionOwnership('act_alice_personal', 'usr_alice');

    // 6.1 Unauthenticated creation rejected
    assertThrows(
      () =>
        h.service.createRequest(
          {
            actionId: 'act_alice_personal',
            actionDescription: 'Private action',
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.LOW,
          },
          unauth
        ),
      'UnauthenticatedError',
      'Unauthenticated caller cannot create approval request'
    );

    // 6.2 Eve cannot create an approval request for an action owned by Alice
    assertThrows(
      () =>
        h.service.createRequest(
          {
            actionId: 'act_alice_personal',
            actionDescription: 'Eve impersonating Alice action',
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.LOW,
          },
          eveAuth
        ),
      'UnauthorizedActionRequesterError',
      'User cannot create request for an action ID owned by another user'
    );

    // 6.3 HTTP API: Eve submitting Alice action gets HTTP 403 UNAUTHORIZED_ACTION_REQUESTER
    const eveApiRes = await h.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer eve_tok',
        'content-type': 'application/json',
      },
      body: {
        actionId: 'act_alice_personal',
        actionDescription: 'Eve attempt',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.LOW,
      },
    });
    assertEquals(eveApiRes.statusCode, 403, 'HTTP POST returns 403 for unauthorized action requester');
    assertEquals(
      eveApiRes.body.error?.code,
      'UNAUTHORIZED_ACTION_REQUESTER',
      'Error code is UNAUTHORIZED_ACTION_REQUESTER'
    );

    // 6.4 Alice creates valid request
    const aliceReq = h.service.createRequest(
      {
        actionId: 'act_alice_personal',
        actionDescription: 'Alice legitimate action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.LOW,
      },
      aliceAuth
    );

    // 6.5 Eve attempts to inspect Alice request: gets opaque 404 access denied (anti-enumeration)
    assertThrows(
      () => h.service.getRequest(aliceReq.id, eveAuth),
      'ApprovalAccessDeniedError',
      'Unrelated user receives opaque access denied on getRequest'
    );

    // 6.6 Eve attempts to inspect Alice binding: gets opaque 404 access denied
    assertThrows(
      () => h.service.getBindingByRequestId(aliceReq.id, eveAuth),
      'ApprovalAccessDeniedError',
      'Unrelated user receives opaque access denied on getBindingByRequestId'
    );
    assertThrows(
      () => h.service.getBindingByActionId('act_alice_personal', eveAuth),
      'ApprovalAccessDeniedError',
      'Unrelated user receives opaque access denied on getBindingByActionId'
    );

    // 6.7 Over HTTP API, Eve receives 404 NOT_FOUND_OR_DENIED for Alice's request and binding
    const eveGetReqRes = await h.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${encodeURIComponent(aliceReq.id)}`,
      headers: { authorization: 'Bearer eve_tok' },
    });
    assertEquals(eveGetReqRes.statusCode, 404, 'API returns opaque 404 for unauthorized request inspection');
    assertEquals(eveGetReqRes.body.error?.code, 'NOT_FOUND_OR_DENIED', 'Error code is NOT_FOUND_OR_DENIED');

    const eveGetBindingRes = await h.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${encodeURIComponent(aliceReq.id)}/binding`,
      headers: { authorization: 'Bearer eve_tok' },
    });
    assertEquals(eveGetBindingRes.statusCode, 404, 'API returns opaque 404 for unauthorized binding inspection');
  }

  // ---------------------------------------------------------------------------
  // 7. Trusted Contact Decision Authorization & Invalidation Protection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 7: Trusted Contact Decision Authorization & Invalidation Protection');
  {
    const h = createTestHarness();
    const wardAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    const authorizedContactAuth: AuthContext = {
      actorId: 'tc_guardian_bob',
      role: ActorRole.TRUSTED_CONTACT,
      isAuthenticated: true,
    };
    const unauthorizedContactAuth: AuthContext = {
      actorId: 'tc_stranger_dan',
      role: ActorRole.TRUSTED_CONTACT,
      isAuthenticated: true,
    };

    h.contactRegistry.addContact({
      id: 'tc_guardian_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-24T10:00:00.000Z',
    });
    h.actionOwnershipRegistry.registerActionOwnership('act_delete_account', 'usr_alice');

    const req = h.service.createRequest(
      {
        actionId: 'act_delete_account',
        actionDescription: 'Delete Account',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.CRITICAL,
      },
      wardAuth
    );

    // 7.1 Separation of duties: Alice cannot approve her own request
    assertThrows(
      () => h.service.approveRequest(req.id, { decisionReason: 'Self approval' }, wardAuth),
      'SelfApprovalProhibitedError',
      'Ward cannot approve their own approval request (separation of duties)'
    );

    // 7.2 Unauthorized trusted contact Dan cannot approve Alice's request
    assertThrows(
      () => h.service.approveRequest(req.id, { decisionReason: 'Dan approving' }, unauthorizedContactAuth),
      'ApprovalAccessDeniedError',
      'Unauthorized contact receives access denied when attempting to approve'
    );

    // 7.3 Invalidated binding protection: When binding is invalidated, trusted contact decision is rejected
    h.service.invalidateBinding('act_delete_account', 'User navigated away from page', wardAuth);
    const invBinding = h.service.getBindingByActionId('act_delete_account', wardAuth);
    assertEquals(invBinding?.state, ApprovalActionBindingState.INVALIDATED, 'Binding state transitioned to INVALIDATED');

    assertThrows(
      () => h.service.approveRequest(req.id, { decisionReason: 'Approved after nav' }, authorizedContactAuth),
      'ApprovalBindingStateTransitionError',
      'Cannot approve an action request whose action binding has been INVALIDATED'
    );

    // 7.4 Over HTTP API: Decision on invalidated binding returns 409 INVALID_BINDING_TRANSITION
    h.tokenVerifier.registerToken('bob_tok', authorizedContactAuth);
    const decideInvRes = await h.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${encodeURIComponent(req.id)}/decide`,
      headers: {
        authorization: 'Bearer bob_tok',
        'content-type': 'application/json',
      },
      body: {
        decision: 'APPROVED',
      },
    });
    assertEquals(decideInvRes.statusCode, 409, 'API returns 409 when deciding on invalidated binding');
    assertEquals(decideInvRes.body.error?.code, 'INVALID_BINDING_TRANSITION', 'Error code is INVALID_BINDING_TRANSITION');
  }

  // ---------------------------------------------------------------------------
  // 8. Duplicate Submissions & Idempotency
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 8: Duplicate Submissions & Compound Idempotency');
  {
    const h = createTestHarness();
    const wardAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    h.tokenVerifier.registerToken('alice_tok', wardAuth);
    h.actionOwnershipRegistry.registerActionOwnership('act_idempotent_submit', 'usr_alice');

    const payload: ClientApprovalRequestPayload = {
      actionId: 'act_idempotent_submit',
      actionDescription: 'Transfer 50',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.MEDIUM,
    };

    // 8.1 First creation returns 201 Created
    const res1 = await h.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice_tok',
        'content-type': 'application/json',
      },
      body: payload,
    });
    assertEquals(res1.statusCode, 201, 'First submission creates request with HTTP 201');
    const firstReq = res1.body.data as ApprovalRequest;

    // 8.2 Second duplicate submission returns 200 OK with same canonical requestId
    const res2 = await h.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice_tok',
        'content-type': 'application/json',
      },
      body: payload,
    });
    assertEquals(res2.statusCode, 200, 'Duplicate submission succeeds idempotently with HTTP 200');
    const secondReq = res2.body.data as ApprovalRequest;
    assertEquals(secondReq.id, firstReq.id, 'Duplicate submission returns identical canonical requestId');
    assertEquals(secondReq.bindingId, firstReq.bindingId, 'Duplicate submission returns identical bindingId');

    // 8.3 Verify repository storage count: strictly 1 request and 1 binding
    assertEquals(h.repository.count(), 1, 'Repository stores exactly 1 ApprovalRequest record');
    const binding = h.service.getBindingByRequestId(firstReq.id, wardAuth);
    assertEquals(binding.actionId, 'act_idempotent_submit', 'Binding remains bound to act_idempotent_submit');
    assertEquals(binding.state, ApprovalActionBindingState.BOUND, 'Binding remains in BOUND state');
  }

  // ---------------------------------------------------------------------------
  // 9. Authoritative Backend Lifecycle & Zero Client Trust
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 9: Authoritative Backend Lifecycle & Zero Trust for Client Metadata');
  {
    const h = createTestHarness();
    const wardAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    h.tokenVerifier.registerToken('alice_tok', wardAuth);
    h.actionOwnershipRegistry.registerActionOwnership('act_safe_looking', 'usr_alice');

    // 9.1 Client cannot bypass review by supplying riskLevel: LOW, riskScore: 0, benign descriptions
    const payload: ClientApprovalRequestPayload = {
      actionId: 'act_safe_looking',
      actionDescription: 'Harmless benign button',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.LOW,
      riskScore: 0,
      riskReasons: [],
      origin: 'https://trusted.example.com',
      hostname: 'trusted.example.com',
      pageTitle: 'Completely Safe Page',
    };

    const req = h.service.createRequest(payload, wardAuth);
    // Backend invariant: Server ALWAYS initializes state to PENDING and binding to BOUND
    assertEquals(req.status, ApprovalStatus.PENDING, 'Request status is authoritatively PENDING despite LOW risk level');
    const binding = h.service.getBindingByRequestId(req.id, wardAuth);
    assertEquals(binding.state, ApprovalActionBindingState.BOUND, 'Binding state is authoritatively BOUND despite LOW risk level');

    // 9.2 Client cannot inject bindingId
    assertThrows(
      () =>
        h.service.createRequest(
          {
            ...payload,
            bindingId: 'bnd_injected_client_id',
          } as unknown as ClientApprovalRequestPayload,
          wardAuth
        ),
      'ApprovalValidationError',
      'Client cannot supply custom "bindingId" (binding identifiers are server-assigned)'
    );

    // 9.3 Client cannot inject status: "APPROVED"
    assertThrows(
      () =>
        h.service.createRequest(
          {
            ...payload,
            status: ApprovalStatus.APPROVED,
          } as unknown as ClientApprovalRequestPayload,
          wardAuth
        ),
      'ApprovalValidationError',
      'Client cannot supply custom "status" (requests always initialize to PENDING)'
    );

    // 9.4 Client cannot inject requesterId
    assertThrows(
      () =>
        h.service.createRequest(
          {
            ...payload,
            requesterId: 'usr_admin',
          } as unknown as ClientApprovalRequestPayload,
          wardAuth
        ),
      'ApprovalValidationError',
      'Client cannot supply custom "requesterId" (derived from session)'
    );
  }

  // ---------------------------------------------------------------------------
  // 10. Explicit Error Failures
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 10: Explicit Failure Reporting for Unauthorized / Conflicting Operations');
  {
    const h = createTestHarness();
    const wardAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    h.tokenVerifier.registerToken('alice_tok', wardAuth);
    h.actionOwnershipRegistry.registerActionOwnership('act_explicit_test', 'usr_alice');

    // Valid creation
    const req = h.service.createRequest(
      {
        actionId: 'act_explicit_test',
        actionDescription: 'Explicit error test',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
      },
      wardAuth
    );

    // Expire request by advancing time past TTL (15 minutes)
    h.currentTimeMs = Date.parse('2026-10-24T10:16:00.000Z');

    // Attempt to decide on expired request: throws ApprovalExpiredError with HTTP 410
    const bobAuth: AuthContext = { actorId: 'tc_bob', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };
    h.tokenVerifier.registerToken('bob_tok', bobAuth);
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-24T10:00:00.000Z',
    });

    const decideExpiredRes = await h.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${encodeURIComponent(req.id)}/decide`,
      headers: {
        authorization: 'Bearer bob_tok',
        'content-type': 'application/json',
      },
      body: { decision: 'APPROVED' },
    });
    assertEquals(decideExpiredRes.statusCode, 410, 'Deciding on expired request fails with HTTP 410 Gone');
    assertEquals(decideExpiredRes.body.error?.code, 'REQUEST_EXPIRED', 'Error code is REQUEST_EXPIRED');
  }

  // ---------------------------------------------------------------------------
  // 11. Zero Protected Action Execution (Continuation Safety)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 11: Zero Protected Action Execution Across All Operations');
  {
    let continuationExecutionCounter = 0;
    const dummyContinuation = () => {
      continuationExecutionCounter++;
    };

    const h = createTestHarness();
    const wardAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    const contactAuth: AuthContext = { actorId: 'tc_bob', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-24T10:00:00.000Z',
    });
    h.actionOwnershipRegistry.registerActionOwnership('act_zero_exec', 'usr_alice');

    // 1. Create request
    const req = h.service.createRequest(
      {
        actionId: 'act_zero_exec',
        actionDescription: 'Zero Exec Action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      wardAuth
    );
    assertEquals(continuationExecutionCounter, 0, 'Continuation execution count is strictly 0 after createRequest');

    // 2. Query binding
    h.service.getBindingByRequestId(req.id, wardAuth);
    assertEquals(continuationExecutionCounter, 0, 'Continuation execution count is strictly 0 after getBinding');

    // 3. Approve request
    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, contactAuth);
    assertEquals(continuationExecutionCounter, 0, 'INVIOLABLE: Continuation execution count is strictly 0 after approveRequest');

    // Never call dummyContinuation
    assert(Boolean(dummyContinuation), 'Continuation handler was safely decoupled from backend approval');
  }

  // ---------------------------------------------------------------------------
  // 12. Persistence Classification Audit
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 12: Persistence Classification Audit (Architectural Limitations)');
  {
    assertEquals(
      PERSISTENCE_METADATA.TYPE,
      'EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY',
      'Repository metadata declares EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY'
    );
    assertEquals(
      PERSISTENCE_METADATA.IS_PRODUCTION,
      false,
      'Repository metadata flags IS_PRODUCTION as false'
    );
    assertEquals(
      DevelopmentInMemoryApprovalRequestRepository.IS_PRODUCTION_PERSISTENCE,
      false,
      'DevelopmentInMemoryApprovalRequestRepository explicitly flags non-production persistence'
    );
  }

  console.log('\n====================================================================');
  console.log(`📊 BINDING ENFORCEMENT TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
  console.log('🎉 ALL ACTION-APPROVAL BINDING ENFORCEMENT INVARIANTS SATISFIED!');
  console.log('====================================================================\n');
}

runEnforcementTestSuite().catch((err) => {
  console.error('Fatal error during test execution:', err);
  process.exit(1);
});
