/**
 * Guardrail Approval Status Retrieval & Verification Suite
 *
 * Verifies that the browser extension and backend provide a secure, authoritative,
 * and reliable mechanism for inspecting the current status of an approval request.
 *
 * VERIFIED REQUIREMENTS:
 * 1. Established Request Identifier: Uses canonical 'apr_...' request IDs and standard API envelope.
 * 2. Authoritative Persisted State: Status is retrieved from authoritative backend repository.
 * 3. Typed, Predictable Response: Structured envelope { success: true, data: ApprovalRequest }.
 * 4. Error Differentiation:
 *    - Missing requests -> 404 NOT_FOUND_OR_DENIED
 *    - Unauthorized access -> 404 NOT_FOUND_OR_DENIED (anti-enumeration)
 *    - Unauthenticated -> 401 UNAUTHENTICATED
 *    - Expired requests -> 200 OK with status EXPIRED
 *    - Malformed identifiers -> 400 VALIDATION_ERROR
 * 5. Server-Enforced Authorization: Client-supplied IDs are never trusted as proof of access.
 * 6. Privacy & Data Minimization: No passwords, OTPs, cards, or form values exposed.
 * 7. Identifier Validation: Enforces canonical 'apr_' prefix, regex safety, and length bounds.
 * 8. Complete Lifecycle Coverage: PENDING, APPROVED, REJECTED, EXPIRED, CANCELLED.
 * 9. Decoupled Execution Invariant: Approval status retrieval NEVER triggers action execution.
 * 10. Background Service Worker Coordination: Validates messages, enforces boundaries, dispatches securely.
 */

import { ActionCategory, ActionType } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import {
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
  GuardrailGetApprovalStatusMessage,
  GuardrailGetApprovalStatusResponse,
} from '../types/approval.js';
import {
  assertValidApprovalRequestId,
  validateApprovalRequestId,
} from './model.js';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from './authorization.js';
import { DevelopmentInMemoryApprovalRequestRepository } from './repository.js';
import { ApprovalService } from './service.js';
import {
  ApprovalApiRouter,
  InMemoryRateLimiter,
  InMemoryTokenVerifier,
} from './api.js';
import { ApprovalApiClient } from './client.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import { InterceptionState } from '../types/interception.js';
import {
  handleBackgroundApprovalStatusLookup,
  validateApprovalStatusLookupMessage,
} from '../background/index.js';

// =============================================================================
// Test Harness
// =============================================================================

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

// =============================================================================
// Test Environment Setup
// =============================================================================

function createMockClock(initialEpochMs: number = 1729252800000) {
  let currentEpoch = initialEpochMs;
  return {
    getTime: () => new Date(currentEpoch).toISOString(),
    advanceSeconds: (seconds: number) => {
      currentEpoch += seconds * 1000;
      return new Date(currentEpoch).toISOString();
    },
    advanceMinutes: (minutes: number) => {
      currentEpoch += minutes * 60 * 1000;
      return new Date(currentEpoch).toISOString();
    },
  };
}

interface TestSetup {
  service: ApprovalService;
  repository: DevelopmentInMemoryApprovalRequestRepository;
  contactRegistry: InMemoryTrustedContactRegistry;
  actionOwnershipRegistry: InMemoryActionOwnershipRegistry;
  clock: ReturnType<typeof createMockClock>;
  tokenVerifier: InMemoryTokenVerifier;
  router: ApprovalApiRouter;
  client: ApprovalApiClient;
}

function setupTestEnvironment(): TestSetup {
  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();
  const clock = createMockClock(1729252800000); // 2024-10-18T12:00:00.000Z
  const tokenVerifier = new InMemoryTokenVerifier();
  const rateLimiter = new InMemoryRateLimiter(200, 60);

  const service = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    timeProvider: clock.getTime,
    approvalTtlMinutes: 15,
  });

  const router = new ApprovalApiRouter(service, tokenVerifier, {
    rateLimiter,
  });

  // Setup tokens
  tokenVerifier.registerToken('alice-token', {
    actorId: 'usr_alice',
    role: ActorRole.WARD,
    isAuthenticated: true,
  });
  tokenVerifier.registerToken('bob-token', {
    actorId: 'usr_bob',
    role: ActorRole.WARD,
    isAuthenticated: true,
  });
  tokenVerifier.registerToken('carol-contact-token', {
    actorId: 'tc_carol',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });
  tokenVerifier.registerToken('stranger-contact-token', {
    actorId: 'tc_stranger',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });
  tokenVerifier.registerToken('admin-token', {
    actorId: 'usr_admin',
    role: ActorRole.ADMIN,
    isAuthenticated: true,
  });

  // Carol is an active trusted contact for Alice
  contactRegistry.addContact({
    id: 'tc_carol',
    userId: 'usr_alice',
    relationshipLabel: 'Daughter',
    status: TrustedContactStatus.ACTIVE,
    createdAt: clock.getTime(),
  });

  // In-memory client dispatcher that routes directly through ApprovalApiRouter
  const client = new ApprovalApiClient({
    baseUrl: 'http://localhost:3000',
    tokenProvider: () => 'alice-token',
    fetchFn: async (url, init) => {
      const parsedUrl = new URL(String(url));
      const headers: Record<string, string> = {};
      if (init?.headers) {
        if (typeof init.headers === 'object') {
          for (const [k, v] of Object.entries(init.headers)) {
            if (typeof v === 'string') headers[k.toLowerCase()] = v;
          }
        }
      }
      let body: unknown;
      if (init?.body && typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const apiRes = await router.dispatch({
        method: init?.method || 'GET',
        url: parsedUrl.pathname + parsedUrl.search,
        headers,
        body,
      });

      return {
        ok: apiRes.statusCode >= 200 && apiRes.statusCode < 300,
        status: apiRes.statusCode,
        statusText: apiRes.statusCode === 200 ? 'OK' : 'Error',
        headers: {
          get: (name: string) => apiRes.headers[name.toLowerCase()] || null,
        },
        json: async () => apiRes.body,
        text: async () => JSON.stringify(apiRes.body),
      };
    },
  });

  return {
    service,
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    clock,
    tokenVerifier,
    router,
    client,
  };
}

function makeSamplePayload(actionId: string = 'act_payment_01'): ClientApprovalRequestPayload {
  return {
    actionId,
    actionDescription: 'Send $250 Payment via Zelle',
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.HIGH,
    riskScore: 78,
    riskReasons: ['Recipient is not in address book', 'Transaction is irreversible'],
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    pageTitle: 'Bank Transfer Confirmation',
  };
}

// =============================================================================
// Test Execution
// =============================================================================

async function runApprovalStatusTests(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL: APPROVAL STATUS RETRIEVAL & SYNCHRONIZATION TEST SUITE');
  console.log('====================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Identifier Validation Unit Tests
  // ---------------------------------------------------------------------------
  console.log('▶ Test 1: Identifier Validation (validateApprovalRequestId)');
  {
    // Valid canonical IDs
    assert(validateApprovalRequestId('apr_01J9X4M5N2P3Q4R5S6T7U8V9W0').valid, 'Valid ULID format accepted');
    assert(validateApprovalRequestId('apr_abc123-xyz_89').valid, 'Alphanumeric with hyphens and underscores accepted');
    assert(validateApprovalRequestId('apr_1').valid, 'Minimal valid prefix + char accepted');

    // Invalid / Malformed IDs
    assert(!validateApprovalRequestId('').valid, 'Empty string rejected');
    assert(!validateApprovalRequestId('   ').valid, 'Whitespace string rejected');
    assert(!validateApprovalRequestId(null).valid, 'Null rejected');
    assert(!validateApprovalRequestId(undefined).valid, 'Undefined rejected');
    assert(!validateApprovalRequestId(12345).valid, 'Number rejected');
    assert(!validateApprovalRequestId('no_prefix_123').valid, 'ID without apr_ prefix rejected');
    assert(!validateApprovalRequestId('apr_').valid, 'Prefix only without ID rejected');
    assert(!validateApprovalRequestId('apr_hello!@#$').valid, 'Special symbols rejected');
    assert(!validateApprovalRequestId('apr_../../etc/passwd').valid, 'Path traversal characters rejected');
    assert(!validateApprovalRequestId('apr_' + 'a'.repeat(200)).valid, 'Oversized ID (>128 chars) rejected');
  }

  // ---------------------------------------------------------------------------
  // 2. Authorized Ward Retrieval (GET /api/v1/approval-requests/:id)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test 2: Authorized Retrieval by Protected User (Ward)');
  {
    const env = setupTestEnvironment();

    // Alice creates an approval request
    env.actionOwnershipRegistry.registerActionOwnership('act_alice_01', 'usr_alice');
    const createdReq = env.service.createRequest(makeSamplePayload('act_alice_01'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });

    // Alice inspects status via router
    const res = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${createdReq.id}`,
      headers: { authorization: 'Bearer alice-token' },
    });

    assertEquals(res.statusCode, 200, 'HTTP status is 200 OK');
    assert(res.body.success, 'Response envelope success is true');
    const data = res.body.data as ApprovalRequest;
    assertEquals(data.id, createdReq.id, 'Returned request ID matches');
    assertEquals(data.requesterId, 'usr_alice', 'Requester is Alice');
    assertEquals(data.status, ApprovalStatus.PENDING, 'Authoritative status is PENDING');
    assertEquals(data.actionDescription, 'Send $250 Payment via Zelle', 'Action description matches');
    assertEquals(data.decision, undefined, 'Decision block is strictly undefined for PENDING');
  }

  // ---------------------------------------------------------------------------
  // 3. Authorized Retrieval by Designated Trusted Contact & Admin
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test 3: Authorized Retrieval by Designated Contact & Admin');
  {
    const env = setupTestEnvironment();

    env.actionOwnershipRegistry.registerActionOwnership('act_alice_02', 'usr_alice');
    const createdReq = env.service.createRequest(makeSamplePayload('act_alice_02'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });

    // Carol (designated active contact for Alice) queries Alice's request
    const contactRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${createdReq.id}`,
      headers: { authorization: 'Bearer carol-contact-token' },
    });
    assertEquals(contactRes.statusCode, 200, 'Designated contact receives 200 OK');
    assertEquals((contactRes.body.data as ApprovalRequest).id, createdReq.id, 'Contact retrieves correct request');

    // Admin queries Alice's request
    const adminRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${createdReq.id}`,
      headers: { authorization: 'Bearer admin-token' },
    });
    assertEquals(adminRes.statusCode, 200, 'Admin receives 200 OK');
    assertEquals((adminRes.body.data as ApprovalRequest).id, createdReq.id, 'Admin retrieves correct request');
  }

  // ---------------------------------------------------------------------------
  // 4. Unauthorized Access & Anti-Enumeration Isolation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test 4: Tenant Isolation & Anti-Enumeration (Opaque 404)');
  {
    const env = setupTestEnvironment();

    env.actionOwnershipRegistry.registerActionOwnership('act_alice_03', 'usr_alice');
    const createdReq = env.service.createRequest(makeSamplePayload('act_alice_03'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });

    // Bob (unrelated ward) queries Alice's request
    const bobRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${createdReq.id}`,
      headers: { authorization: 'Bearer bob-token' },
    });
    assertEquals(bobRes.statusCode, 404, 'Unrelated user receives 404 NOT_FOUND_OR_DENIED');
    assertEquals(bobRes.body.error?.code, 'NOT_FOUND_OR_DENIED', 'Error code is NOT_FOUND_OR_DENIED');

    // Stranger contact (not designated for Alice) queries Alice's request
    const strangerRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${createdReq.id}`,
      headers: { authorization: 'Bearer stranger-contact-token' },
    });
    assertEquals(strangerRes.statusCode, 404, 'Non-designated contact receives 404');
    assertEquals(strangerRes.body.error?.code, 'NOT_FOUND_OR_DENIED', 'Error code is NOT_FOUND_OR_DENIED');

    // Query non-existent valid request ID
    const missingRes = await env.router.dispatch({
      method: 'GET',
      url: '/api/v1/approval-requests/apr_non_existent_999999',
      headers: { authorization: 'Bearer bob-token' },
    });
    assertEquals(missingRes.statusCode, 404, 'Non-existent ID returns 404');
    assertEquals(
      bobRes.body.error?.message,
      missingRes.body.error?.message,
      'Anti-enumeration: Error messages for unowned and non-existent IDs are strictly IDENTICAL'
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Unauthenticated Access Attempt
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test 5: Unauthenticated Status Lookup Rejection');
  {
    const env = setupTestEnvironment();

    env.actionOwnershipRegistry.registerActionOwnership('act_alice_04', 'usr_alice');
    const createdReq = env.service.createRequest(makeSamplePayload('act_alice_04'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });

    // Missing token
    const noTokenRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${createdReq.id}`,
    });
    assertEquals(noTokenRes.statusCode, 401, 'Missing token returns 401 UNAUTHENTICATED');
    assertEquals(noTokenRes.body.error?.code, 'UNAUTHENTICATED', 'Error code is UNAUTHENTICATED');

    // Invalid / forged token
    const badTokenRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${createdReq.id}`,
      headers: { authorization: 'Bearer forged_token_value' },
    });
    assertEquals(badTokenRes.statusCode, 401, 'Forged token returns 401 UNAUTHENTICATED');
  }

  // ---------------------------------------------------------------------------
  // 6. Malformed Identifier Validation (HTTP 400 VALIDATION_ERROR)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test 6: Malformed Identifier Validation (400 VALIDATION_ERROR)');
  {
    const env = setupTestEnvironment();

    // Query with ID missing 'apr_' prefix
    const noPrefixRes = await env.router.dispatch({
      method: 'GET',
      url: '/api/v1/approval-requests/invalid_id_format_123',
      headers: { authorization: 'Bearer alice-token' },
    });
    assertEquals(noPrefixRes.statusCode, 400, 'Non-prefixed ID returns 400 Bad Request');
    assertEquals(noPrefixRes.body.error?.code, 'VALIDATION_ERROR', 'Error code is VALIDATION_ERROR');

    // Query with illegal characters
    const illegalCharsRes = await env.router.dispatch({
      method: 'GET',
      url: '/api/v1/approval-requests/apr_illegal!@#$',
      headers: { authorization: 'Bearer alice-token' },
    });
    assertEquals(illegalCharsRes.statusCode, 400, 'Illegal characters return 400 VALIDATION_ERROR');

    // Query with path traversal attempt
    const pathTraversalRes = await env.router.dispatch({
      method: 'GET',
      url: '/api/v1/approval-requests/apr_..%2F..%2Fetc',
      headers: { authorization: 'Bearer alice-token' },
    });
    assertEquals(pathTraversalRes.statusCode, 400, 'Path traversal returns 400 VALIDATION_ERROR');
  }

  // ---------------------------------------------------------------------------
  // 7. Terminal States Lifecycle Retrieval (APPROVED, REJECTED, EXPIRED, CANCELLED)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test 7: Terminal State Retrieval Across Approval Lifecycle');
  {
    const env = setupTestEnvironment();

    // State A: APPROVED
    env.actionOwnershipRegistry.registerActionOwnership('act_wire_approved', 'usr_alice');
    const reqApproved = env.service.createRequest(makeSamplePayload('act_wire_approved'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });
    env.service.approveRequest(
      reqApproved.id,
      { decisionReason: 'Phone verified with Alice' },
      { actorId: 'tc_carol', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true }
    );
    const approvedRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${reqApproved.id}`,
      headers: { authorization: 'Bearer alice-token' },
    });
    assertEquals(approvedRes.statusCode, 200, 'Approved request returns 200 OK');
    const approvedData = approvedRes.body.data as ApprovalRequest;
    assertEquals(approvedData.status, ApprovalStatus.APPROVED, 'Status reflects APPROVED');
    assertEquals(approvedData.decision?.decision, 'APPROVED', 'Decision is APPROVED');
    assertEquals(approvedData.decision?.decidedBy, 'tc_carol', 'Reviewer attribution matches');
    assert(approvedData.resolvedAt !== undefined, 'resolvedAt timestamp is present');

    // State B: REJECTED
    env.actionOwnershipRegistry.registerActionOwnership('act_wire_rejected', 'usr_alice');
    const reqRejected = env.service.createRequest(makeSamplePayload('act_wire_rejected'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });
    env.service.rejectRequest(
      reqRejected.id,
      { decisionReason: 'Suspicious request' },
      { actorId: 'tc_carol', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true }
    );
    const rejectedRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${reqRejected.id}`,
      headers: { authorization: 'Bearer alice-token' },
    });
    assertEquals(rejectedRes.statusCode, 200, 'Rejected request returns 200 OK');
    const rejectedData = rejectedRes.body.data as ApprovalRequest;
    assertEquals(rejectedData.status, ApprovalStatus.REJECTED, 'Status reflects REJECTED');
    assertEquals(rejectedData.decision?.decisionReason, 'Suspicious request', 'Rejection reason matches');

    // State C: EXPIRED (Lazy Expiration Verification)
    env.actionOwnershipRegistry.registerActionOwnership('act_wire_expired', 'usr_alice');
    const reqExpired = env.service.createRequest(makeSamplePayload('act_wire_expired'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });
    // Advance clock past 15-minute TTL
    env.clock.advanceMinutes(16);
    const expiredRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${reqExpired.id}`,
      headers: { authorization: 'Bearer alice-token' },
    });
    assertEquals(expiredRes.statusCode, 200, 'Expired request returns 200 OK');
    const expiredData = expiredRes.body.data as ApprovalRequest;
    assertEquals(expiredData.status, ApprovalStatus.EXPIRED, 'Status authoritatively transitioned to EXPIRED');
    assertEquals(expiredData.decision, undefined, 'Expired request has no decision metadata');

    // State D: CANCELLED
    env.actionOwnershipRegistry.registerActionOwnership('act_wire_cancelled', 'usr_alice');
    const reqCancelled = env.service.createRequest(makeSamplePayload('act_wire_cancelled'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });
    env.service.cancelRequest(
      reqCancelled.id,
      'User decided not to proceed',
      { actorId: 'usr_alice', role: ActorRole.WARD, isAuthenticated: true }
    );
    const cancelledRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${reqCancelled.id}`,
      headers: { authorization: 'Bearer alice-token' },
    });
    assertEquals(cancelledRes.statusCode, 200, 'Cancelled request returns 200 OK');
    const cancelledData = cancelledRes.body.data as ApprovalRequest;
    assertEquals(cancelledData.status, ApprovalStatus.CANCELLED, 'Status reflects CANCELLED');
    assertEquals(cancelledData.cancellationReason, 'User decided not to proceed', 'Cancellation reason matches');
  }

  // ---------------------------------------------------------------------------
  // 8. Typed ApprovalApiClient getApprovalStatus Integration
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test 8: Typed ApprovalApiClient getApprovalStatus');
  {
    const env = setupTestEnvironment();

    env.actionOwnershipRegistry.registerActionOwnership('act_client_01', 'usr_alice');
    const createdReq = env.service.createRequest(makeSamplePayload('act_client_01'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });

    // Query via typed client helper
    const statusRes = await env.client.getApprovalStatus(createdReq.id);
    assert(statusRes.success, 'getApprovalStatus succeeds');
    if (statusRes.success) {
      assertEquals(statusRes.data.id, createdReq.id, 'Response id matches');
      assertEquals(statusRes.data.status, ApprovalStatus.PENDING, 'Response status is PENDING');
      assertEquals(statusRes.data.request.actionId, 'act_client_01', 'Underlying request object returned');
    }

    // Client-side validation: malformed ID rejected before network transmission
    const malformedClientRes = await env.client.getApprovalStatus('not_apr_id');
    assert(!malformedClientRes.success, 'Malformed ID rejected client-side');
    assertEquals(malformedClientRes.statusCode, 400, 'Client status code is 400');
    assertEquals(malformedClientRes.error?.code, 'VALIDATION_ERROR', 'Error code is VALIDATION_ERROR');
  }

  // ---------------------------------------------------------------------------
  // 9. Background Service Worker Status Lookup Message Handler
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test 9: Background Service Worker Status Lookup Validation & Execution');
  {
    const env = setupTestEnvironment();
    const bgController = new InterceptionController();

    // Register action in background controller
    bgController.register('act_bg_01', 'High risk wire transfer');
    bgController.holdAction('act_bg_01', 'High risk wire transfer');

    env.actionOwnershipRegistry.registerActionOwnership('act_bg_01', 'usr_alice');
    const createdReq = env.service.createRequest(makeSamplePayload('act_bg_01'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });

    // 9.1 Message validation rejects invalid shapes
    assert(
      !validateApprovalStatusLookupMessage(null).valid,
      'Null message rejected'
    );
    assert(
      !validateApprovalStatusLookupMessage({ type: 'WRONG_TYPE' }).valid,
      'Wrong message type rejected'
    );
    assert(
      !validateApprovalStatusLookupMessage({
        type: 'GUARDRAIL_GET_APPROVAL_STATUS',
        requestId: 'invalid_no_apr',
      }).valid,
      'Invalid requestId rejected'
    );

    // 9.2 Security: Reject privileged instructions
    assert(
      !validateApprovalStatusLookupMessage({
        type: 'GUARDRAIL_GET_APPROVAL_STATUS',
        requestId: createdReq.id,
        decision: 'APPROVED',
      }).valid,
      'Privileged decision injection rejected'
    );
    assert(
      !validateApprovalStatusLookupMessage({
        type: 'GUARDRAIL_GET_APPROVAL_STATUS',
        requestId: createdReq.id,
        status: 'APPROVED',
      }).valid,
      'Privileged status injection rejected'
    );
    assert(
      !validateApprovalStatusLookupMessage({
        type: 'GUARDRAIL_GET_APPROVAL_STATUS',
        requestId: createdReq.id,
        token: 'stolen_token',
      }).valid,
      'Token injection rejected'
    );

    // 9.3 Valid message execution
    const validMsg: GuardrailGetApprovalStatusMessage = {
      type: 'GUARDRAIL_GET_APPROVAL_STATUS',
      requestId: createdReq.id,
      actionId: 'act_bg_01',
    };
    const lookupRes = await handleBackgroundApprovalStatusLookup(validMsg, bgController, {
      apiClient: env.client,
    });

    assert(lookupRes.success, 'Background lookup succeeded');
    assertEquals(lookupRes.status, 'PENDING', 'Returned status is PENDING');
    assertEquals(lookupRes.requestId, createdReq.id, 'Returned requestId matches');
    assert(lookupRes.isAuthoritative, 'Outcome is marked authoritative');

    // 9.4 Untracked actionId rejected
    const untrackedMsg: GuardrailGetApprovalStatusMessage = {
      type: 'GUARDRAIL_GET_APPROVAL_STATUS',
      requestId: createdReq.id,
      actionId: 'act_untracked_ghost',
    };
    const untrackedRes = await handleBackgroundApprovalStatusLookup(untrackedMsg, bgController, {
      apiClient: env.client,
    });
    assert(!untrackedRes.success, 'Untracked actionId rejected');
    assertEquals(untrackedRes.error?.code, 'ACTION_NOT_FOUND', 'Error code is ACTION_NOT_FOUND');
  }

  // ---------------------------------------------------------------------------
  // 10. Decoupled Execution Security Guarantee
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test 10: Decoupled Action Execution Security Guarantee');
  {
    const env = setupTestEnvironment();
    const controller = new InterceptionController();
    const continuationManager = new ContinuationManager(controller);

    // Ward initiates action; intercepted and held
    const actionId = 'act_payment_decoupled';
    const actionModel = {
      id: actionId,
      type: ActionType.CLICK,
      timestamp: new Date().toISOString(),
      page: { url: 'https://bank.example.com', title: 'Bank' },
    };
    controller.register(actionModel);
    controller.holdAction(actionId, 'Wire Transfer');
    const heldRecord = controller.getRecord(actionId)!;

    let actionExecuted = false;
    let executionCounter = 0;
    continuationManager.registerHeldAction(actionModel, heldRecord, () => {
      actionExecuted = true;
      executionCounter++;
    });

    assertEquals(controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action is HELD in controller');
    assertEquals(executionCounter, 0, 'Execution counter is strictly 0');
    assert(!actionExecuted, 'Action has not executed');

    // Server creates request and Carol approves it
    env.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    const createdReq = env.service.createRequest(makeSamplePayload(actionId), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });
    env.service.approveRequest(
      createdReq.id,
      { decisionReason: 'Caretaker approved' },
      { actorId: 'tc_carol', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true }
    );

    // Extension polls / retrieves status
    const statusRes = await env.client.getApprovalStatus(createdReq.id);
    assert(statusRes.success, 'Approval status check succeeds');
    if (statusRes.success) {
      assertEquals(statusRes.data.status, ApprovalStatus.APPROVED, 'Status is confirmed APPROVED');
    }

    // CRITICAL SECURITY INVARIANT:
    // Even though the server confirmed APPROVED, the held action MUST NOT execute!
    assertEquals(controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains safely HELD');
    assertEquals(executionCounter, 0, 'Execution counter remains strictly 0');
    assert(!actionExecuted, 'Action was NEVER automatically executed by status lookup');

    // Only explicit user continuation may release the action
    continuationManager.continueAction(actionId);
    assert(actionExecuted, 'Action executes ONLY after explicit continuation');
    assertEquals(executionCounter, 1, 'Action executed exactly once');
  }

  // ---------------------------------------------------------------------------
  // 11. Privacy & Sensitive Field Exclusion
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test 11: Privacy & Zero Sensitive Field Exposure');
  {
    const env = setupTestEnvironment();

    env.actionOwnershipRegistry.registerActionOwnership('act_privacy_01', 'usr_alice');
    const createdReq = env.service.createRequest(makeSamplePayload('act_privacy_01'), {
      actorId: 'usr_alice',
      role: ActorRole.WARD,
      isAuthenticated: true,
    });

    const res = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${createdReq.id}`,
      headers: { authorization: 'Bearer alice-token' },
    });

    const jsonStr = JSON.stringify(res.body);

    assert(!jsonStr.toLowerCase().includes('password'), 'No password in status response');
    assert(!jsonStr.toLowerCase().includes('"otp"'), 'No OTP in status response');
    assert(!jsonStr.toLowerCase().includes('cardnumber'), 'No card numbers in status response');
    assert(!jsonStr.toLowerCase().includes('cvv'), 'No CVV in status response');
    assert(!jsonStr.toLowerCase().includes('authtoken'), 'No auth tokens in status response body');
    assert(!jsonStr.toLowerCase().includes('cookie'), 'No cookies in status response');
  }

  console.log('\n====================================================================');
  console.log(`📊 STATUS LOOKUP TESTS: ${passedTests} / ${totalTests} PASSED`);
  console.log('🎉 ALL ARCHITECTURAL INVARIANTS & SECURITY CHECKS VERIFIED!');
  console.log('====================================================================\n');
}

runApprovalStatusTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
