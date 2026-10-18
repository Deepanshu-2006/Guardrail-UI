/**
 * Guardrail Approval API Router Route-Level Verification Suite
 *
 * Verifies that ApprovalApiRouter correctly exposes ApprovalService through a minimal, secure API:
 * 1. Endpoints & Route Matching:
 *    - POST /api/v1/approval-requests (201 Created)
 *    - GET  /api/v1/approval-requests/:id (200 OK)
 *    - POST /api/v1/approval-requests/:id/cancel (200 OK)
 *    - GET  /api/v1/approvals/pending (200 OK)
 *    - GET  /api/v1/approvals/:id (200 OK)
 *    - POST /api/v1/approvals/:id/decide (200 OK)
 * 2. Authentication Enforcement:
 *    - Bearer token required for all endpoints (401 UNAUTHENTICATED)
 *    - Malformed Authorization header, invalid token, revoked token rejected (401)
 * 3. Server-Enforced Identity & Zero Client Trust:
 *    - Acting identity derived strictly from AuthContext
 *    - Client-supplied `status` (such as `APPROVED`) rejected (400 VALIDATION_ERROR)
 *    - Client-supplied `requesterId`, `decision`, or `resolvedAt` rejected (400)
 * 4. Authorization & Separation of Duties:
 *    - Requesters can only access/cancel their own requests
 *    - Contacts can only view/decide requests where designated
 *    - Self-approval strictly forbidden (403 SELF_APPROVAL_PROHIBITED)
 *    - Creating request for unowned action forbidden (403 UNAUTHORIZED_ACTION_REQUESTER)
 * 5. Anti-Enumeration & Private Information Protection:
 *    - Unrelated users receive identical opaque 404 NOT_FOUND_OR_DENIED
 *    - Non-existent IDs return the exact same 404 response
 * 6. Supported Content Types & Validation:
 *    - Missing or non-json Content-Type rejected (415 UNSUPPORTED_MEDIA_TYPE)
 *    - Malformed JSON syntax rejected (400 MALFORMED_JSON)
 *    - Invalid body types and parameter validation (400 VALIDATION_ERROR)
 *    - Non-existent route returns 404 (ROUTE_NOT_FOUND)
 * 7. Lifecycle Transitions & Concurrency:
 *    - Decision on expired request rejected (410 REQUEST_EXPIRED)
 *    - Duplicate decision on resolved request rejected (409 ALREADY_RESOLVED)
 *    - Decision on cancelled request rejected (409 ALREADY_RESOLVED)
 *    - Cancellation on resolved request rejected (409 ALREADY_RESOLVED)
 * 8. Narrow CORS Configuration:
 *    - Authorized extension & dashboard origins receive narrow CORS headers
 *    - Unrestricted origins ('*') are never used
 *    - Preflight OPTIONS from unauthorized origin rejected (403 CORS_ORIGIN_DENIED)
 * 9. Rate Limiting & Payload Size Protection:
 *    - Excessive requests return 429 RATE_LIMIT_EXCEEDED with Retry-After header
 *    - Payloads exceeding 16KB return 413 PAYLOAD_TOO_LARGE
 * 10. Streaming HTTP Adapter (handleHttpStream):
 *    - Duck-typed streaming requests parsed and dispatched correctly
 *    - Oversized streams destroyed with 413
 * 11. Privacy & Sensitive Field Protection:
 *    - Whitelisted response properties; no passwords, cookies, or raw form data
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionCategory, ActionType } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { ClientApprovalRequestPayload } from '../types/approval.js';
import {
  ActorRole,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from './authorization.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
} from './repository.js';
import {
  ApprovalService,
} from './service.js';
import {
  ApiRequest,
  ApprovalApiRouter,
  HttpRequestLike,
  HttpResponseLike,
  InMemoryRateLimiter,
  InMemoryTokenVerifier,
} from './api.js';

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
// Test Environment Setup Helpers
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
  rateLimiter: InMemoryRateLimiter;
  router: ApprovalApiRouter;
}

function createTestEnvironment(rateLimitMax: number = 100): TestSetup {
  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();
  const clock = createMockClock(1729252800000);
  const tokenVerifier = new InMemoryTokenVerifier();
  const rateLimiter = new InMemoryRateLimiter(rateLimitMax, 60);

  const service = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    timeProvider: clock.getTime,
  });

  const router = new ApprovalApiRouter(service, tokenVerifier, {
    rateLimiter,
    maxBodySizeBytes: 1024, // 1 KB for quick size testing
  });

  // Provision Standard Test Users
  tokenVerifier.registerToken('alice-token', {
    actorId: 'usr_alice',
    role: ActorRole.USER,
    isAuthenticated: true,
  });

  tokenVerifier.registerToken('bob-token', {
    actorId: 'usr_bob',
    role: ActorRole.USER,
    isAuthenticated: true,
  });

  tokenVerifier.registerToken('carol-token', {
    actorId: 'tc_carol',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });

  tokenVerifier.registerToken('dave-token', {
    actorId: 'tc_dave',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });

  tokenVerifier.registerToken('unrelated-contact-token', {
    actorId: 'tc_stranger',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });

  // Alice as a contact (for testing self-approval prevention)
  tokenVerifier.registerToken('alice-as-contact-token', {
    actorId: 'usr_alice',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });

  // Assign Trusted Contacts: Alice designates Carol and Dave
  contactRegistry.addContact({
    id: 'tc_carol',
    userId: 'usr_alice',
    relationshipLabel: 'Primary Caregiver',
    status: TrustedContactStatus.ACTIVE,
    createdAt: clock.getTime(),
  });

  contactRegistry.addContact({
    id: 'tc_dave',
    userId: 'usr_alice',
    relationshipLabel: 'Secondary Caregiver',
    status: TrustedContactStatus.ACTIVE,
    createdAt: clock.getTime(),
  });

  // Assign Action Ownership
  actionOwnershipRegistry.registerActionOwnership('act_delete_db', 'usr_alice');
  actionOwnershipRegistry.registerActionOwnership('act_transfer_funds', 'usr_alice');
  actionOwnershipRegistry.registerActionOwnership('act_bob_only', 'usr_bob');

  return {
    service,
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    clock,
    tokenVerifier,
    rateLimiter,
    router,
  };
}

function makeValidPayload(actionId: string = 'act_delete_db'): ClientApprovalRequestPayload {
  return {
    actionId,
    actionType: ActionType.CLICK,
    actionDescription: 'Delete All Account Data',
    category: ActionCategory.DESTRUCTIVE,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 95,
    riskReasons: ['Irreversible bulk data deletion'],
    origin: 'https://app.example.com',
    hostname: 'app.example.com',
    pageTitle: 'Account Settings',
  };
}

// =============================================================================
// Test Suites
// =============================================================================

async function runAllTests(): Promise<void> {
  console.log('\n=== Starting Guardrail Approval API Verification Suite ===\n');

  // ---------------------------------------------------------------------------
  // 1. Full Successful Approval Workflow (End-to-End)
  // ---------------------------------------------------------------------------
  console.log('--- 1. End-to-End Workflow: Create -> Retrieve -> Decide -> Inspect ---');
  {
    const env = createTestEnvironment();

    // 1.1 POST /api/v1/approval-requests (Alice creates request)
    const createReq: ApiRequest = {
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: makeValidPayload('act_delete_db'),
    };
    const createRes = await env.router.dispatch(createReq);
    assertEquals(createRes.statusCode, 201, 'Create request returns 201 Created');
    assert(createRes.body.success === true, 'Response body has success: true');
    const createdData = createRes.body.data as any;
    assert(typeof createdData.id === 'string' && createdData.id.startsWith('apr_'), 'Returns canonical request id');
    assertEquals(createdData.requesterId, 'usr_alice', 'Authoritative requesterId is assigned from AuthContext');
    assertEquals(createdData.status, 'PENDING', 'Initial request status is PENDING');
    assertEquals(createdData.actionId, 'act_delete_db', 'Matches actionId');
    const requestId = createdData.id;

    // 1.2 GET /api/v1/approval-requests/:id (Alice inspects her request)
    const getReq: ApiRequest = {
      method: 'GET',
      url: `/api/v1/approval-requests/${requestId}`,
      headers: {
        authorization: 'Bearer alice-token',
      },
    };
    const getRes = await env.router.dispatch(getReq);
    assertEquals(getRes.statusCode, 200, 'Alice retrieves her request successfully');
    assertEquals((getRes.body.data as any).id, requestId, 'Retrieved request ID matches');

    // 1.3 GET /api/v1/approvals/pending (Carol lists pending approvals)
    const listReq: ApiRequest = {
      method: 'GET',
      url: '/api/v1/approvals/pending',
      headers: {
        authorization: 'Bearer carol-token',
      },
    };
    const listRes = await env.router.dispatch(listReq);
    assertEquals(listRes.statusCode, 200, 'Carol lists pending requests');
    const listData = listRes.body.data as any[];
    assertEquals(listData.length, 1, 'Contains exactly 1 pending request');
    assertEquals(listData[0].id, requestId, 'Pending request ID matches');

    // 1.4 GET /api/v1/approvals/:id (Carol inspects request details)
    const inspectReq: ApiRequest = {
      method: 'GET',
      url: `/api/v1/approvals/${requestId}`,
      headers: {
        authorization: 'Bearer carol-token',
      },
    };
    const inspectRes = await env.router.dispatch(inspectReq);
    assertEquals(inspectRes.statusCode, 200, 'Carol inspects request details');
    assertEquals((inspectRes.body.data as any).actionDescription, 'Delete All Account Data', 'Metadata returned accurately');

    // 1.5 POST /api/v1/approvals/:id/decide (Carol approves request)
    const decideReq: ApiRequest = {
      method: 'POST',
      url: `/api/v1/approvals/${requestId}/decide`,
      headers: {
        authorization: 'Bearer carol-token',
        'content-type': 'application/json',
      },
      body: {
        decision: 'APPROVED',
        decisionReason: 'Verified with Alice over voice call.',
      },
    };
    const decideRes = await env.router.dispatch(decideReq);
    assertEquals(decideRes.statusCode, 200, 'Carol approves request with 200 OK');
    const approvedData = decideRes.body.data as any;
    assertEquals(approvedData.status, 'APPROVED', 'Request status is updated to APPROVED');
    assertEquals(approvedData.decision?.decidedBy, 'tc_carol', 'DecidedBy is authoritative actor tc_carol');
    assertEquals(approvedData.decision?.decisionReason, 'Verified with Alice over voice call.', 'Decision reason recorded');

    // 1.6 Pending list now empty for Carol
    const listEmptyRes = await env.router.dispatch(listReq);
    assertEquals((listEmptyRes.body.data as any[]).length, 0, 'Approved request no longer appears in pending list');
  }

  // ---------------------------------------------------------------------------
  // 2. Cancellation Workflow
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Cancellation Workflow: Create -> Cancel ---');
  {
    const env = createTestEnvironment();

    // Create request
    const createRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: makeValidPayload('act_transfer_funds'),
    });
    const requestId = (createRes.body.data as any).id;

    // Alice cancels her request
    const cancelRes = await env.router.dispatch({
      method: 'POST',
      url: `/api/v1/approval-requests/${requestId}/cancel`,
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: {
        reason: 'User decided not to transfer funds.',
      },
    });
    assertEquals(cancelRes.statusCode, 200, 'Alice cancels her request with 200 OK');
    const cancelledData = cancelRes.body.data as any;
    assertEquals(cancelledData.status, 'CANCELLED', 'Status transitioned to CANCELLED');
    assertEquals(cancelledData.cancellationReason, 'User decided not to transfer funds.', 'Cancellation reason recorded');

    // Contact cannot decide a cancelled request (409 Conflict)
    const decideRes = await env.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${requestId}/decide`,
      headers: {
        authorization: 'Bearer carol-token',
        'content-type': 'application/json',
      },
      body: { decision: 'APPROVED' },
    });
    assertEquals(decideRes.statusCode, 409, 'Attempt to approve cancelled request returns 409 Conflict');
    assertEquals(decideRes.body.error?.code, 'ALREADY_RESOLVED', 'Error code is ALREADY_RESOLVED');
  }

  // ---------------------------------------------------------------------------
  // 3. Rejection Workflow
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Rejection Workflow: Create -> Reject ---');
  {
    const env = createTestEnvironment();

    const createRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: makeValidPayload('act_delete_db'),
    });
    const requestId = (createRes.body.data as any).id;

    // Dave rejects the request
    const rejectRes = await env.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${requestId}/decide`,
      headers: {
        authorization: 'Bearer dave-token',
        'content-type': 'application/json',
      },
      body: {
        decision: 'REJECTED',
        decisionReason: 'Potential phishing attack detected on site.',
      },
    });
    assertEquals(rejectRes.statusCode, 200, 'Dave rejects request with 200 OK');
    const rejectedData = rejectRes.body.data as any;
    assertEquals(rejectedData.status, 'REJECTED', 'Status is REJECTED');
    assertEquals(rejectedData.decision?.decidedBy, 'tc_dave', 'DecidedBy is tc_dave');

    // Alice cannot cancel an already rejected request (409 Conflict)
    const cancelRes = await env.router.dispatch({
      method: 'POST',
      url: `/api/v1/approval-requests/${requestId}/cancel`,
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: {},
    });
    assertEquals(cancelRes.statusCode, 409, 'Attempt to cancel rejected request returns 409 Conflict');
  }

  // ---------------------------------------------------------------------------
  // 4. Authentication Enforcement (401 UNAUTHENTICATED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Authentication Enforcement Across All Routes ---');
  {
    const env = createTestEnvironment();

    // 4.1 Missing Authorization Header
    const noAuthRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: { 'content-type': 'application/json' },
      body: makeValidPayload(),
    });
    assertEquals(noAuthRes.statusCode, 401, 'Missing Authorization header returns 401');
    assertEquals(noAuthRes.body.error?.code, 'UNAUTHENTICATED', 'Error code is UNAUTHENTICATED');

    // 4.2 Malformed Authorization Header (Not Bearer)
    const badAuthRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Basic dXNyOmFwaQ==',
        'content-type': 'application/json',
      },
      body: makeValidPayload(),
    });
    assertEquals(badAuthRes.statusCode, 401, 'Non-Bearer Authorization returns 401');

    // 4.3 Unknown / Invalid Token
    const unknownTokenRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer non-existent-token',
        'content-type': 'application/json',
      },
      body: makeValidPayload(),
    });
    assertEquals(unknownTokenRes.statusCode, 401, 'Unrecognized token returns 401');

    // 4.4 Revoked Token
    env.tokenVerifier.revokeToken('alice-token');
    const revokedRes = await env.router.dispatch({
      method: 'GET',
      url: '/api/v1/approvals/pending',
      headers: { authorization: 'Bearer alice-token' },
    });
    assertEquals(revokedRes.statusCode, 401, 'Revoked token returns 401');
  }

  // ---------------------------------------------------------------------------
  // 5. Zero Client Trust & Rejection of Client-Provided Status
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Zero Client Trust & Client Status Rejection ---');
  {
    const env = createTestEnvironment();

    // 5.1 Client passes status: "APPROVED" on create
    const payloadWithStatus = {
      ...makeValidPayload(),
      status: 'APPROVED',
    };
    const statusRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: payloadWithStatus,
    });
    assertEquals(statusRes.statusCode, 400, 'Client-supplied status: "APPROVED" rejected with 400 Bad Request');
    assertEquals(statusRes.body.error?.code, 'VALIDATION_ERROR', 'Error code is VALIDATION_ERROR');

    // 5.2 Client passes requesterId on create
    const payloadWithRequesterId = {
      ...makeValidPayload(),
      requesterId: 'usr_impersonated',
    };
    const reqIdRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: payloadWithRequesterId,
    });
    assertEquals(reqIdRes.statusCode, 400, 'Client-supplied requesterId rejected with 400 Bad Request');

    // 5.3 Client passes decision on create
    const payloadWithDecision = {
      ...makeValidPayload(),
      decision: 'APPROVED',
    };
    const decisionRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: payloadWithDecision,
    });
    assertEquals(decisionRes.statusCode, 400, 'Client-supplied decision on create rejected with 400');
  }

  // ---------------------------------------------------------------------------
  // 6. Authorization & Anti-Enumeration Protections
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Authorization & Anti-Enumeration (Opaque 404) ---');
  {
    const env = createTestEnvironment();

    // Alice creates request
    const createRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: makeValidPayload('act_delete_db'),
    });
    const requestId = (createRes.body.data as any).id;

    // 6.1 Bob (unrelated user) tries to inspect Alice's request
    const bobGetRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approval-requests/${requestId}`,
      headers: { authorization: 'Bearer bob-token' },
    });
    assertEquals(bobGetRes.statusCode, 404, 'Bob receives 404 on Alice request (anti-enumeration)');
    assertEquals(bobGetRes.body.error?.code, 'NOT_FOUND_OR_DENIED', 'Error code is NOT_FOUND_OR_DENIED');

    // 6.2 Completely non-existent request ID
    const nonExistentRes = await env.router.dispatch({
      method: 'GET',
      url: '/api/v1/approval-requests/apr_00000000000000000000000000',
      headers: { authorization: 'Bearer bob-token' },
    });
    assertEquals(nonExistentRes.statusCode, 404, 'Non-existent ID returns 404');
    assertEquals(nonExistentRes.body.error?.code, 'NOT_FOUND_OR_DENIED', 'Non-existent ID returns identical error code');
    assertEquals(
      bobGetRes.body.error?.message,
      nonExistentRes.body.error?.message,
      'Unowned request and non-existent request return identical error messages'
    );

    // 6.3 Bob tries to cancel Alice's request
    const bobCancelRes = await env.router.dispatch({
      method: 'POST',
      url: `/api/v1/approval-requests/${requestId}/cancel`,
      headers: {
        authorization: 'Bearer bob-token',
        'content-type': 'application/json',
      },
      body: {},
    });
    assertEquals(bobCancelRes.statusCode, 404, 'Bob cancel attempt on Alice request returns 404 NOT_FOUND_OR_DENIED');

    // 6.4 Unrelated contact (tc_stranger) tries to view Alice's request
    const strangerGetRes = await env.router.dispatch({
      method: 'GET',
      url: `/api/v1/approvals/${requestId}`,
      headers: { authorization: 'Bearer unrelated-contact-token' },
    });
    assertEquals(strangerGetRes.statusCode, 404, 'Undesignated contact receives 404 NOT_FOUND_OR_DENIED');

    // 6.5 Undesignated contact tries to decide Alice's request
    const strangerDecideRes = await env.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${requestId}/decide`,
      headers: {
        authorization: 'Bearer unrelated-contact-token',
        'content-type': 'application/json',
      },
      body: { decision: 'APPROVED' },
    });
    assertEquals(strangerDecideRes.statusCode, 404, 'Undesignated contact decide returns 404 NOT_FOUND_OR_DENIED');

    // 6.6 Self-Approval: Alice attempts to approve her own request
    const selfApproveRes = await env.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${requestId}/decide`,
      headers: {
        authorization: 'Bearer alice-as-contact-token',
        'content-type': 'application/json',
      },
      body: { decision: 'APPROVED' },
    });
    assertEquals(selfApproveRes.statusCode, 403, 'Self-approval is forbidden with 403');
    assertEquals(selfApproveRes.body.error?.code, 'SELF_APPROVAL_PROHIBITED', 'Error code is SELF_APPROVAL_PROHIBITED');

    // 6.7 Alice attempts to create request for Bob's action
    const unauthorizedActionRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: makeValidPayload('act_bob_only'),
    });
    assertEquals(unauthorizedActionRes.statusCode, 403, 'Requesting approval for unowned action returns 403');
    assertEquals(
      unauthorizedActionRes.body.error?.code,
      'UNAUTHORIZED_ACTION_REQUESTER',
      'Error code is UNAUTHORIZED_ACTION_REQUESTER'
    );
  }

  // ---------------------------------------------------------------------------
  // 7. Request Validation & Content-Type Checks
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Content-Type & Payload Validation Checks ---');
  {
    const env = createTestEnvironment();

    // 7.1 Missing Content-Type header on POST
    const noContentTypeRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
      },
      body: makeValidPayload(),
    });
    assertEquals(noContentTypeRes.statusCode, 415, 'Missing Content-Type on POST returns 415 Unsupported Media Type');
    assertEquals(noContentTypeRes.body.error?.code, 'UNSUPPORTED_MEDIA_TYPE', 'Code is UNSUPPORTED_MEDIA_TYPE');

    // 7.2 Unsupported Content-Type (text/plain)
    const textPlainRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'text/plain',
      },
      body: makeValidPayload(),
    });
    assertEquals(textPlainRes.statusCode, 415, 'text/plain Content-Type returns 415');

    // 7.3 Invalid decision parameter (e.g. "MAYBE")
    // First create a valid request
    const createRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json; charset=utf-8',
      },
      body: makeValidPayload('act_delete_db'),
    });
    const requestId = (createRes.body.data as any).id;

    const invalidDecisionRes = await env.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${requestId}/decide`,
      headers: {
        authorization: 'Bearer carol-token',
        'content-type': 'application/json',
      },
      body: { decision: 'MAYBE' },
    });
    assertEquals(invalidDecisionRes.statusCode, 400, 'Invalid decision returns 400 Bad Request');
    assertEquals(invalidDecisionRes.body.error?.code, 'VALIDATION_ERROR', 'Error code is VALIDATION_ERROR');

    // 7.4 Non-existent route
    const routeNotFoundRes = await env.router.dispatch({
      method: 'GET',
      url: '/api/v1/non-existent-route',
      headers: { authorization: 'Bearer alice-token' },
    });
    assertEquals(routeNotFoundRes.statusCode, 404, 'Non-existent route returns 404');
    assertEquals(routeNotFoundRes.body.error?.code, 'ROUTE_NOT_FOUND', 'Error code is ROUTE_NOT_FOUND');
  }

  // ---------------------------------------------------------------------------
  // 8. Lifecycle Transitions & Expiration (410 REQUEST_EXPIRED & 409 Conflict)
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. Lifecycle Transitions: Expiration & Concurrency ---');
  {
    const env = createTestEnvironment();

    // Create request
    const createRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: makeValidPayload('act_delete_db'),
    });
    const requestId = (createRes.body.data as any).id;

    // Advance clock past expiration (default TTL is 15 minutes = 900 seconds)
    env.clock.advanceSeconds(901);

    // Carol tries to decide expired request
    const lateRes = await env.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${requestId}/decide`,
      headers: {
        authorization: 'Bearer carol-token',
        'content-type': 'application/json',
      },
      body: { decision: 'APPROVED' },
    });
    assertEquals(lateRes.statusCode, 410, 'Deciding expired request returns 410 Gone');
    assertEquals(lateRes.body.error?.code, 'REQUEST_EXPIRED', 'Error code is REQUEST_EXPIRED');

    // 8.2 Double Decision Concurrency Protection
    const env2 = createTestEnvironment();
    const createRes2 = await env2.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: makeValidPayload('act_delete_db'),
    });
    const req2Id = (createRes2.body.data as any).id;

    // Carol approves first
    const firstDecide = await env2.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${req2Id}/decide`,
      headers: {
        authorization: 'Bearer carol-token',
        'content-type': 'application/json',
      },
      body: { decision: 'APPROVED' },
    });
    assertEquals(firstDecide.statusCode, 200, 'First decision succeeds with 200 OK');

    // Dave attempts second decision on the same request
    const secondDecide = await env2.router.dispatch({
      method: 'POST',
      url: `/api/v1/approvals/${req2Id}/decide`,
      headers: {
        authorization: 'Bearer dave-token',
        'content-type': 'application/json',
      },
      body: { decision: 'REJECTED' },
    });
    assertEquals(secondDecide.statusCode, 409, 'Second concurrent decision returns 409 Conflict');
    assertEquals(secondDecide.body.error?.code, 'ALREADY_RESOLVED', 'Error code is ALREADY_RESOLVED');
  }

  // ---------------------------------------------------------------------------
  // 9. Narrow CORS Headers & Preflight
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. Narrow CORS Configuration & Preflight ---');
  {
    const env = createTestEnvironment();

    // 9.1 Whitelisted extension origin
    const extRes = await env.router.dispatch({
      method: 'OPTIONS',
      url: '/api/v1/approval-requests',
      headers: { origin: 'chrome-extension://guardrail-extension-id' },
    });
    assertEquals(extRes.statusCode, 204, 'Extension preflight returns 204 No Content');
    assertEquals(
      extRes.headers['access-control-allow-origin'],
      'chrome-extension://guardrail-extension-id',
      'CORS origin matches extension'
    );
    assert(extRes.headers['access-control-allow-origin'] !== '*', 'CORS is never wildcard *');

    // 9.2 Whitelisted dashboard origin
    const dashRes = await env.router.dispatch({
      method: 'OPTIONS',
      url: '/api/v1/approvals/pending',
      headers: { origin: 'http://localhost:3000' },
    });
    assertEquals(dashRes.statusCode, 204, 'Dashboard preflight returns 204');
    assertEquals(dashRes.headers['access-control-allow-origin'], 'http://localhost:3000', 'CORS origin matches dashboard');

    // 9.3 Unauthorized origin on preflight
    const evilPreflightRes = await env.router.dispatch({
      method: 'OPTIONS',
      url: '/api/v1/approvals/pending',
      headers: { origin: 'https://evil-attacker.example.com' },
    });
    assertEquals(evilPreflightRes.statusCode, 403, 'Unauthorized origin preflight returns 403 Forbidden');
    assertEquals(evilPreflightRes.body.error?.code, 'CORS_ORIGIN_DENIED', 'Code is CORS_ORIGIN_DENIED');

    // 9.4 Unauthorized origin on GET request: no access-control-allow-origin header
    const evilGetRes = await env.router.dispatch({
      method: 'GET',
      url: '/api/v1/approvals/pending',
      headers: {
        origin: 'https://evil-attacker.example.com',
        authorization: 'Bearer carol-token',
      },
    });
    assertEquals(evilGetRes.statusCode, 200, 'GET succeeds internally');
    assert(
      evilGetRes.headers['access-control-allow-origin'] === undefined,
      'No CORS allow-origin header emitted for untrusted origin'
    );
  }

  // ---------------------------------------------------------------------------
  // 10. Rate Limiting Protection (429 RATE_LIMIT_EXCEEDED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. Rate Limiting Protection ---');
  {
    // Initialize env with max 3 requests per minute
    const env = createTestEnvironment(3);

    const callApi = () =>
      env.router.dispatch({
        method: 'GET',
        url: '/api/v1/approvals/pending',
        headers: {
          authorization: 'Bearer carol-token',
          'x-forwarded-for': '198.51.100.42',
        },
      });

    const res1 = await callApi();
    const res2 = await callApi();
    const res3 = await callApi();
    assertEquals(res1.statusCode, 200, 'Request 1 allowed');
    assertEquals(res2.statusCode, 200, 'Request 2 allowed');
    assertEquals(res3.statusCode, 200, 'Request 3 allowed');

    // 4th request exceeds rate limit
    const res4 = await callApi();
    assertEquals(res4.statusCode, 429, 'Request 4 rejected with 429 Too Many Requests');
    assertEquals(res4.body.error?.code, 'RATE_LIMIT_EXCEEDED', 'Error code is RATE_LIMIT_EXCEEDED');
    assert(typeof res4.headers['retry-after'] === 'string', 'Emits Retry-After header');
  }

  // ---------------------------------------------------------------------------
  // 11. Streaming HTTP Adapter & Size Limit (handleHttpStream & 413)
  // ---------------------------------------------------------------------------
  console.log('\n--- 11. HTTP Stream Adapter & Body Size Limits ---');
  {
    const env = createTestEnvironment();

    class MockHttpRequest implements HttpRequestLike {
      public method = 'POST';
      public url = '/api/v1/approval-requests';
      public headers: Record<string, string | string[] | undefined> = {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      };
      private listeners: Record<string, ((...args: any[]) => void)[]> = {};
      public destroyed = false;

      public on(event: 'data' | 'end' | 'error', listener: (...args: any[]) => void): this {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(listener);
        return this;
      }

      public emit(event: string, ...args: any[]): void {
        const fns = this.listeners[event] || [];
        for (const fn of fns) fn(...args);
      }

      public destroy(): void {
        this.destroyed = true;
      }
    }

    class MockHttpResponse implements HttpResponseLike {
      public statusCode = 0;
      public headers: Record<string, string> = {};
      public body = '';
      public headersSent = false;

      public setHeader(name: string, value: string | number | readonly string[]): void {
        this.headers[name.toLowerCase()] = String(value);
      }

      public end(chunk?: string): void {
        if (chunk) this.body += chunk;
        this.headersSent = true;
      }
    }

    // 11.1 Successful streaming JSON request
    const mockReq = new MockHttpRequest();
    const mockRes = new MockHttpResponse();

    const handlePromise = env.router.handleHttpStream(mockReq, mockRes);
    const jsonStr = JSON.stringify(makeValidPayload('act_delete_db'));
    // Emit data in chunks
    mockReq.emit('data', jsonStr.slice(0, 50));
    mockReq.emit('data', jsonStr.slice(50));
    mockReq.emit('end');

    await handlePromise;
    assertEquals(mockRes.statusCode, 201, 'Stream adapter successfully processes chunks to 201 Created');
    const parsedResBody = JSON.parse(mockRes.body);
    assertEquals(parsedResBody.success, true, 'Stream response has success: true');

    // 11.2 Oversized streaming payload (limit is set to 1024 bytes in test config)
    const bigReq = new MockHttpRequest();
    const bigRes = new MockHttpResponse();

    const bigHandlePromise = env.router.handleHttpStream(bigReq, bigRes);
    const oversizedChunk = 'x'.repeat(2048);
    bigReq.emit('data', oversizedChunk);

    await bigHandlePromise;
    assertEquals(bigRes.statusCode, 413, 'Oversized stream rejected with 413 Payload Too Large');
    assert(bigReq.destroyed === true, 'Stream was aborted via req.destroy()');
    const bigParsed = JSON.parse(bigRes.body);
    assertEquals(bigParsed.error.code, 'PAYLOAD_TOO_LARGE', 'Error code is PAYLOAD_TOO_LARGE');

    // 11.3 Malformed JSON in stream
    const badReq = new MockHttpRequest();
    const badRes = new MockHttpResponse();
    const badHandlePromise = env.router.handleHttpStream(badReq, badRes);
    badReq.emit('data', '{ invalid json syntax');
    badReq.emit('end');

    await badHandlePromise;
    assertEquals(badRes.statusCode, 400, 'Malformed JSON stream returns 400 Bad Request');
    const badParsed = JSON.parse(badRes.body);
    assertEquals(badParsed.error.code, 'MALFORMED_JSON', 'Error code is MALFORMED_JSON');
  }

  // ---------------------------------------------------------------------------
  // 12. Privacy & Data Leak Prevention
  // ---------------------------------------------------------------------------
  console.log('\n--- 12. Response Privacy & Sensitive Field Protection ---');
  {
    const env = createTestEnvironment();

    const createRes = await env.router.dispatch({
      method: 'POST',
      url: '/api/v1/approval-requests',
      headers: {
        authorization: 'Bearer alice-token',
        'content-type': 'application/json',
      },
      body: makeValidPayload('act_delete_db'),
    });
    const data = createRes.body.data as any;

    // Check that sensitive fields are not present in response
    assert(data.password === undefined, 'No password field');
    assert(data.otp === undefined, 'No otp field');
    assert(data.token === undefined, 'No token field');
    assert(data.cookie === undefined, 'No cookie field');
    assert(data.cardNumber === undefined, 'No credit card field');
    assert(data.contactPhone === undefined, 'No contact phone field');
    assert(data.contactEmail === undefined, 'No contact email field');
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`Approval API Verification Complete: ${passedTests}/${totalTests} tests passed.`);
  console.log('======================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal error running Approval API test suite:', err);
  process.exit(1);
});
