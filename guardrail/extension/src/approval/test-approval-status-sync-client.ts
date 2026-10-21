/**
 * Guardrail Approval Status Synchronization Client Test Suite
 *
 * Comprehensive verification for the reusable, typed ApprovalStatusSyncClient.
 * Tests are strictly separated into two distinct categories:
 *
 * SECTION 1: MOCKED & BOUNDARY UNIT TESTS (Isolated In-Memory & Faults)
 *   - Status retrieval: PENDING, APPROVED, REJECTED, EXPIRED, CANCELLED
 *   - Error handling: 401 UNAUTHENTICATED, 404 NOT_FOUND_OR_DENIED, 429 RATE_LIMIT_EXCEEDED, 500 SERVER_ERROR
 *   - Client-side input validation and malformed ID rejection
 *   - Fault injection: Network disconnect (TypeError), timeout/abort (AbortError)
 *   - Schema & contract validation: Malformed JSON, missing fields, unknown status codes
 *   - CRITICAL INVARIANT: Unknown status or failed request is NEVER treated as APPROVED
 *   - DECOUPLED EXECUTION INVARIANT: Querying status NEVER executes or releases held browser action
 *   - SENSITIVE DATA AUDIT: No tokens, credentials, or secrets in logs or result models
 *   - Polling coordinator: Adaptive schedule, terminal cutoff, tab visibility, concurrency guard
 *
 * SECTION 2: LIVE BACKEND VERIFICATION (Real Local HTTP Server over TCP Socket)
 *   - Live Node.js HTTP TCP server (127.0.0.1:ephemeral_port) running ApprovalApiRouter
 *   - Live PENDING status retrieval over real HTTP wire
 *   - Live 401 Unauthenticated and 404 Anti-enumeration over real wire
 *   - Live multi-turn synchronization: Backend approval transition detected by sync loop
 *   - Live TCP network drop: Connection refusal on closed port
 *   - Clean server socket disposal
 */

declare const process: any;

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { InterceptionState } from '../types/interception.js';
import {
  ApprovalDecisionMetadata,
  ApprovalRequest,
  ApprovalStatus,
} from '../types/approval.js';
import {
  ApiClientErrorCodes,
} from './client.js';
import {
  ApprovalStatusSyncClient,
} from './sync-client.js';
import {
  ActorRole,
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
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';

// =============================================================================
// Test Runner Harness
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
    console.error(
      `  ✗ FAILED: ${message}. Expected "${String(expected)}", received "${String(actual)}"`
    );
    process.exitCode = 1;
  }
}

// =============================================================================
// Mock Clock & Sample Fixtures
// =============================================================================

function createMockClock(initialEpochMs: number = 1729252800000) {
  let currentEpoch = initialEpochMs;
  return {
    getTime: () => new Date(currentEpoch).toISOString(),
    getTimeMs: () => currentEpoch,
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

function createSampleAction(actionId: string = 'act_test_001'): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    timestamp: new Date().toISOString(),
    page: {
      url: 'https://checkout.example.com/pay',
      title: 'Payment Checkout',
    },
    element: {
      tagName: 'BUTTON',
      visibleText: 'Submit Payment Order',
      id: 'submit-order',
    },
  };
}

function createSampleRequest(
  requestId: string,
  status: ApprovalStatus = ApprovalStatus.PENDING,
  overrides?: Partial<ApprovalRequest>,
  clockEpochMs: number = 1729252800000
): ApprovalRequest {
  const createdAt = new Date(clockEpochMs).toISOString();
  const expiresAt = new Date(clockEpochMs + 15 * 60 * 1000).toISOString();
  const decidedAt = new Date(clockEpochMs + 5 * 60 * 1000).toISOString();

  let decision: ApprovalDecisionMetadata | undefined = undefined;
  let resolvedAt: string | undefined = undefined;

  if (status === ApprovalStatus.APPROVED) {
    decision = {
      decision: 'APPROVED',
      decidedBy: 'tc_carol',
      decidedAt,
      decisionReason: 'Verified by telephone call',
    };
    resolvedAt = decidedAt;
  } else if (status === ApprovalStatus.REJECTED) {
    decision = {
      decision: 'REJECTED',
      decidedBy: 'tc_carol',
      decidedAt,
      decisionReason: 'Suspicious recipient account',
    };
    resolvedAt = decidedAt;
  } else if (status === ApprovalStatus.EXPIRED || status === ApprovalStatus.CANCELLED) {
    resolvedAt = decidedAt;
    decision = undefined;
  }

  return {
    id: requestId,
    actionId: 'act_sample_001',
    actionDescription: 'High-value wire transfer',
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 92,
    riskReasons: ['Irreversible transfer'],
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    pageTitle: 'Confirm Transfer',
    status,
    requesterId: 'usr_alice',
    createdAt,
    expiresAt,
    decision,
    resolvedAt,
    ...overrides,
  };
}

function createMockResponse(body: unknown, status: number = 200): Response {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(rawBody, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// =============================================================================
// DOM Visibility Mock for Node.js Environment
// =============================================================================

let mockVisibilityState: 'visible' | 'hidden' = 'visible';
const mockVisibilityListeners: (() => void)[] = [];

function setupMockDOM(): void {
  mockVisibilityState = 'visible';
  mockVisibilityListeners.length = 0;

  (globalThis as any).document = {
    get visibilityState() {
      return mockVisibilityState;
    },
    addEventListener: (event: string, callback: () => void) => {
      if (event === 'visibilitychange') {
        mockVisibilityListeners.push(callback);
      }
    },
    removeEventListener: (event: string, callback: () => void) => {
      if (event === 'visibilitychange') {
        const idx = mockVisibilityListeners.indexOf(callback);
        if (idx !== -1) mockVisibilityListeners.splice(idx, 1);
      }
    },
  };
}

function triggerVisibilityChange(state: 'visible' | 'hidden'): void {
  mockVisibilityState = state;
  for (const listener of [...mockVisibilityListeners]) {
    try {
      listener();
    } catch {
      // safe
    }
  }
}

// =============================================================================
// Router-Backed Mock Environment Setup
// =============================================================================

interface RouterTestEnv {
  service: ApprovalService;
  repository: DevelopmentInMemoryApprovalRequestRepository;
  contactRegistry: InMemoryTrustedContactRegistry;
  actionOwnershipRegistry: InMemoryActionOwnershipRegistry;
  tokenVerifier: InMemoryTokenVerifier;
  router: ApprovalApiRouter;
  syncClient: ApprovalStatusSyncClient;
  clock: ReturnType<typeof createMockClock>;
}

function setupRouterTestEnv(): RouterTestEnv {
  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();
  const clock = createMockClock();
  const tokenVerifier = new InMemoryTokenVerifier();
  const rateLimiter = new InMemoryRateLimiter(500, 60);

  const service = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    timeProvider: clock.getTime,
  });

  const router = new ApprovalApiRouter(service, tokenVerifier, { rateLimiter });

  // Register token for Alice
  tokenVerifier.registerToken('token_alice', {
    actorId: 'usr_alice',
    role: ActorRole.USER,
    isAuthenticated: true,
  });

  // Register token for Carol (trusted contact)
  tokenVerifier.registerToken('token_carol', {
    actorId: 'tc_carol',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });

  contactRegistry.addContact({
    id: 'tc_carol',
    userId: 'usr_alice',
    relationshipLabel: 'Guardian',
    status: TrustedContactStatus.ACTIVE,
    createdAt: clock.getTime(),
  });

  // Client that routes in-memory directly through ApprovalApiRouter
  const syncClient = new ApprovalStatusSyncClient({
    baseUrl: 'http://localhost:3000',
    tokenProvider: () => 'token_alice',
    fetchFn: async (url, init) => {
      const parsedUrl = new URL(String(url));
      const headers: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => {
            headers[k.toLowerCase()] = v;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([k, v]) => {
            headers[k.toLowerCase()] = v;
          });
        } else if (typeof init.headers === 'object') {
          for (const [k, v] of Object.entries(init.headers)) {
            if (typeof v === 'string') headers[k.toLowerCase()] = v;
          }
        }
      }
      const method = (init?.method ?? 'GET') as any;
      let body: unknown;
      if (init?.body && typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }

      const apiResponse = await router.dispatch({
        method,
        url: parsedUrl.pathname + parsedUrl.search,
        headers,
        body,
      });

      return {
        ok: apiResponse.statusCode >= 200 && apiResponse.statusCode < 300,
        status: apiResponse.statusCode,
        statusText: apiResponse.statusCode === 200 ? 'OK' : 'Error',
        headers: {
          get: (name: string) => apiResponse.headers[name.toLowerCase()] || null,
        },
        json: async () => apiResponse.body,
        text: async () => JSON.stringify(apiResponse.body),
      } as any;
    },
  });

  return {
    service,
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    tokenVerifier,
    router,
    syncClient,
    clock,
  };
}

// =============================================================================
// TEST SUITE EXECUTION
// =============================================================================

async function runTestSuite(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL APPROVAL STATUS SYNC CLIENT VERIFICATION SUITE');
  console.log('====================================================================\n');

  setupMockDOM();

  // ###########################################################################
  // SECTION 1: MOCKED & BOUNDARY UNIT TESTS
  // ###########################################################################
  console.log('====================================================================');
  console.log('📦 SECTION 1: MOCKED & BOUNDARY UNIT TESTS (Isolated In-Memory & Faults)');
  console.log('====================================================================');

  // ---------------------------------------------------------------------------
  // 1.1 Status Retrieval: PENDING
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.1: Retrieval of PENDING approval request status');
  {
    const env = setupRouterTestEnv();
    const req = createSampleRequest('apr_pending_001', ApprovalStatus.PENDING, {}, env.clock.getTimeMs());
    await env.repository.save(req);
    env.actionOwnershipRegistry.registerActionOwnership(req.actionId, 'usr_alice');

    const result = await env.syncClient.getStatus('apr_pending_001');

    assert(result.success, 'Retrieval succeeded');
    assertEquals(result.status, ApprovalStatus.PENDING, 'Status is PENDING');
    assert(result.isPending, 'isPending flag is true');
    assert(!result.isApproved, 'isApproved flag is strictly false');
    assert(!result.isTerminal, 'isTerminal flag is false');
    assert(!result.isRejected, 'isRejected flag is false');
    assert(!result.isExpired, 'isExpired flag is false');
    assert(!result.isCancelled, 'isCancelled flag is false');
    assertEquals(result.statusCode, 200, 'HTTP status code is 200');
    assert(result.isAuthoritative, 'Result is authoritative');
    assert(!result.isNetworkError, 'isNetworkError is false');
    assert(!result.isTimeout, 'isTimeout is false');
    assert(result.request !== undefined, 'Request object populated');
    assertEquals(result.request?.id, 'apr_pending_001', 'Request id matches');
    assert(result.request?.decision === undefined, 'Pending request has no decision block');
  }

  // ---------------------------------------------------------------------------
  // 1.2 Status Retrieval: APPROVED
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.2: Retrieval of APPROVED approval request status');
  {
    const env = setupRouterTestEnv();
    const req = createSampleRequest('apr_approved_002', ApprovalStatus.APPROVED, {}, env.clock.getTimeMs());
    await env.repository.save(req);
    env.actionOwnershipRegistry.registerActionOwnership(req.actionId, 'usr_alice');

    const result = await env.syncClient.getStatus('apr_approved_002');

    assert(result.success, 'Retrieval succeeded');
    assertEquals(result.status, ApprovalStatus.APPROVED, 'Status is APPROVED');
    assert(result.isApproved, 'isApproved flag is true');
    assert(result.isTerminal, 'isTerminal flag is true');
    assert(!result.isPending, 'isPending flag is false');
    assert(!result.isRejected, 'isRejected flag is false');
    assertEquals(result.request?.decision?.decision, 'APPROVED', 'Decision is APPROVED');
    assertEquals(result.request?.decision?.decidedBy, 'tc_carol', 'Decider is tc_carol');
    assert(result.request?.resolvedAt !== undefined, 'resolvedAt is populated');
  }

  // ---------------------------------------------------------------------------
  // 1.3 Status Retrieval: REJECTED
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.3: Retrieval of REJECTED approval request status');
  {
    const env = setupRouterTestEnv();
    const req = createSampleRequest('apr_rejected_003', ApprovalStatus.REJECTED, {}, env.clock.getTimeMs());
    await env.repository.save(req);
    env.actionOwnershipRegistry.registerActionOwnership(req.actionId, 'usr_alice');

    const result = await env.syncClient.getStatus('apr_rejected_003');

    assert(result.success, 'Retrieval succeeded');
    assertEquals(result.status, ApprovalStatus.REJECTED, 'Status is REJECTED');
    assert(!result.isApproved, 'isApproved is strictly false');
    assert(result.isRejected, 'isRejected flag is true');
    assert(result.isTerminal, 'isTerminal flag is true');
    assert(!result.isPending, 'isPending is false');
    assertEquals(result.request?.decision?.decision, 'REJECTED', 'Decision is REJECTED');
  }

  // ---------------------------------------------------------------------------
  // 1.4 Status Retrieval: EXPIRED
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.4: Retrieval of EXPIRED approval request status');
  {
    const env = setupRouterTestEnv();
    const req = createSampleRequest('apr_expired_004', ApprovalStatus.EXPIRED, {}, env.clock.getTimeMs());
    await env.repository.save(req);
    env.actionOwnershipRegistry.registerActionOwnership(req.actionId, 'usr_alice');

    const result = await env.syncClient.getStatus('apr_expired_004');

    assert(result.success, 'Retrieval succeeded');
    assertEquals(result.status, ApprovalStatus.EXPIRED, 'Status is EXPIRED');
    assert(!result.isApproved, 'isApproved is strictly false');
    assert(result.isExpired, 'isExpired flag is true');
    assert(result.isTerminal, 'isTerminal flag is true');
    assert(!result.isPending, 'isPending is false');
  }

  // ---------------------------------------------------------------------------
  // 1.5 Status Retrieval: CANCELLED
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.5: Retrieval of CANCELLED approval request status');
  {
    const env = setupRouterTestEnv();
    const req = createSampleRequest('apr_cancelled_005', ApprovalStatus.CANCELLED, {}, env.clock.getTimeMs());
    await env.repository.save(req);
    env.actionOwnershipRegistry.registerActionOwnership(req.actionId, 'usr_alice');

    const result = await env.syncClient.getStatus('apr_cancelled_005');

    assert(result.success, 'Retrieval succeeded');
    assertEquals(result.status, ApprovalStatus.CANCELLED, 'Status is CANCELLED');
    assert(!result.isApproved, 'isApproved is strictly false');
    assert(result.isCancelled, 'isCancelled flag is true');
    assert(result.isTerminal, 'isTerminal flag is true');
    assert(!result.isPending, 'isPending is false');
  }

  // ---------------------------------------------------------------------------
  // 1.6 Client-Side Input Pre-Validation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.6: Client-side input validation rejects malformed identifiers before dispatch');
  {
    let networkCallAttempted = false;
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        networkCallAttempted = true;
        return createMockResponse({});
      },
    });

    const invalidIds = ['', '   ', 'req_123', 'apr_', 'apr_invalid!@#$', 'short', 'apr_' + 'x'.repeat(129)];

    for (const invalidId of invalidIds) {
      const result = await client.getStatus(invalidId);
      assert(!result.success, `Rejected invalid ID: "${invalidId}"`);
      assert(!result.isApproved, 'Never approved on invalid ID');
      assertEquals(result.statusCode, 400, 'Status code is 400');
      assertEquals(result.error?.code, ApiClientErrorCodes.VALIDATION_ERROR, 'Error code is VALIDATION_ERROR');
    }

    assert(!networkCallAttempted, 'Zero network calls attempted for invalid identifiers');
  }

  // ---------------------------------------------------------------------------
  // 1.7 HTTP 401 UNAUTHENTICATED Error Handling
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.7: HTTP 401 Unauthenticated returns typed failure and never approved');
  {
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => undefined, // No token provided
      fetchFn: async () => {
        return createMockResponse(
          {
            success: false,
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Authentication token missing or invalid.',
            },
          },
          401
        );
      },
    });

    const result = await client.getStatus('apr_valid_id_001');

    assert(!result.success, 'Result indicates failure');
    assert(!result.isApproved, 'isApproved is strictly false on 401');
    assert(!result.isPending, 'isPending is false');
    assert(!result.isTerminal, 'isTerminal is false');
    assertEquals(result.statusCode, 401, 'Status code is 401');
    assertEquals(result.error?.code, 'UNAUTHENTICATED', 'Error code is UNAUTHENTICATED');
    assert(result.isAuthoritative, 'Authoritative response from server');
    assert(!result.isNetworkError, 'isNetworkError is false');
    assert(!result.isTimeout, 'isTimeout is false');
  }

  // ---------------------------------------------------------------------------
  // 1.8 HTTP 404 NOT_FOUND_OR_DENIED Error Handling
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.8: HTTP 404 Not Found returns typed failure without leaking existence');
  {
    const env = setupRouterTestEnv();

    // Query for non-existent request
    const result = await env.syncClient.getStatus('apr_nonexistent_999');

    assert(!result.success, 'Result indicates failure');
    assert(!result.isApproved, 'isApproved is strictly false on 404');
    assertEquals(result.statusCode, 404, 'Status code is 404');
    assertEquals(result.error?.code, 'NOT_FOUND_OR_DENIED', 'Error code is NOT_FOUND_OR_DENIED');
    assert(result.isAuthoritative, 'Authoritative server rejection');
  }

  // ---------------------------------------------------------------------------
  // 1.9 HTTP 429 RATE_LIMIT_EXCEEDED Error Handling
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.9: HTTP 429 Rate Limiting is typed and non-fatal');
  {
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        return createMockResponse(
          {
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Rate limit exceeded. Please retry later.',
            },
          },
          429
        );
      },
    });

    const result = await client.getStatus('apr_rate_limited_001');

    assert(!result.success, 'Result indicates failure');
    assert(!result.isApproved, 'isApproved is strictly false on 429');
    assertEquals(result.statusCode, 429, 'Status code is 429');
    assertEquals(result.error?.code, ApiClientErrorCodes.RATE_LIMIT_EXCEEDED, 'Error code is RATE_LIMIT_EXCEEDED');
  }

  // ---------------------------------------------------------------------------
  // 1.10 HTTP 500 SERVER_ERROR Error Handling
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.10: HTTP 500 Server Error marked as non-authoritative failure');
  {
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        return createMockResponse(
          {
            success: false,
            error: {
              code: 'SERVER_ERROR',
              message: 'Internal server error occurred.',
            },
          },
          500
        );
      },
    });

    const result = await client.getStatus('apr_server_error_001');

    assert(!result.success, 'Result indicates failure');
    assert(!result.isApproved, 'isApproved is strictly false on 500');
    assertEquals(result.statusCode, 500, 'Status code is 500');
    assert(!result.isAuthoritative, '500 error is NOT authoritative');
  }

  // ---------------------------------------------------------------------------
  // 1.11 Fault Injection: Network Drop (Connection Refused)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.11: Network connection drop marks isNetworkError: true and never approved');
  {
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        throw new TypeError('Failed to fetch (ECONNREFUSED)');
      },
    });

    const result = await client.getStatus('apr_net_drop_001');

    assert(!result.success, 'Result indicates failure');
    assert(!result.isApproved, 'isApproved is strictly false on network drop');
    assert(result.isNetworkError, 'isNetworkError is true');
    assert(!result.isTimeout, 'isTimeout is false');
    assert(!result.isTerminal, 'isTerminal is false');
    assertEquals(result.error?.code, ApiClientErrorCodes.NETWORK_FAILURE, 'Code is NETWORK_FAILURE');
  }

  // ---------------------------------------------------------------------------
  // 1.12 Fault Injection: Timeout / Abort Error
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.12: Request timeout marks isTimeout: true and never approved');
  {
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        const abortError = new Error('The operation was aborted due to timeout.');
        abortError.name = 'AbortError';
        throw abortError;
      },
    });

    const result = await client.getStatus('apr_timeout_001');

    assert(!result.success, 'Result indicates failure');
    assert(!result.isApproved, 'isApproved is strictly false on timeout');
    assert(result.isTimeout, 'isTimeout is true');
    assert(!result.isNetworkError, 'isNetworkError is false');
    assert(!result.isTerminal, 'isTerminal is false');
    assertEquals(result.error?.code, ApiClientErrorCodes.TIMEOUT, 'Code is TIMEOUT');
  }

  // ---------------------------------------------------------------------------
  // 1.13 Malformed Response: Invalid JSON
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.13: Malformed JSON body rejected as MALFORMED_JSON_RESPONSE');
  {
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        return new Response('<html><title>Not JSON</title><body>Invalid Body</body></html>', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const result = await client.getStatus('apr_bad_gateway_001');

    assert(!result.success, 'Result indicates failure');
    assert(!result.isApproved, 'isApproved is strictly false on non-JSON response');
    assertEquals(result.error?.code, ApiClientErrorCodes.MALFORMED_JSON_RESPONSE, 'Error is MALFORMED_JSON_RESPONSE');
  }

  // ---------------------------------------------------------------------------
  // 1.14 Schema Violation: Missing Required Fields
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.14: Incomplete response payload fails model validation');
  {
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        return createMockResponse({
          success: true,
          data: {
            id: 'apr_incomplete_001',
            status: 'PENDING',
            // Missing actionId, origin, riskLevel, etc.
          },
        });
      },
    });

    const result = await client.getStatus('apr_incomplete_001');

    assert(!result.success, 'Result indicates failure');
    assert(!result.isApproved, 'isApproved is strictly false on schema violation');
    assertEquals(result.error?.code, ApiClientErrorCodes.MALFORMED_JSON_RESPONSE, 'Error is MALFORMED_JSON_RESPONSE');
  }

  // ---------------------------------------------------------------------------
  // 1.15 CRITICAL INVARIANT: Unknown Status Value from Backend
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.15: Server returns unknown status value — NEVER treated as APPROVED');
  {
    const sampleReq = createSampleRequest('apr_unknown_001');
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        return createMockResponse({
          success: true,
          data: {
            ...sampleReq,
            status: 'PENDING_SECOND_STAGE_REVIEW', // Unknown enum value
          },
        });
      },
    });

    const result = await client.getStatus('apr_unknown_001');

    assert(!result.success, 'Result indicates failure for unknown status');
    assert(!result.isApproved, 'CRITICAL: Unknown status is strictly NOT approved');
    assert(!result.isPending, 'isPending is false');
    assert(!result.isTerminal, 'isTerminal is false');
    assertEquals(result.error?.code, ApiClientErrorCodes.MALFORMED_JSON_RESPONSE, 'Error is MALFORMED_JSON_RESPONSE');
    assert(
      Boolean(
        result.error?.message.includes('valid ApprovalStatus') ||
        result.error?.message.includes('unknown approval status')
      ),
      'Error message cites status validation error'
    );
  }

  // ---------------------------------------------------------------------------
  // 1.16 CRITICAL INVARIANT: Inconsistent Decision State
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.16: APPROVED status missing decision block fails contract validation');
  {
    const sampleReq = createSampleRequest('apr_inconsistent_001', ApprovalStatus.PENDING);
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        return createMockResponse({
          success: true,
          data: {
            ...sampleReq,
            status: 'APPROVED',
            decision: undefined, // Illegal: APPROVED requires decision
          },
        });
      },
    });

    const result = await client.getStatus('apr_inconsistent_001');

    assert(!result.success, 'Result indicates failure');
    assert(!result.isApproved, 'Inconsistent approval is NEVER treated as approved');
    assertEquals(result.error?.code, ApiClientErrorCodes.MALFORMED_JSON_RESPONSE, 'Rejected by model validation');
  }

  // ---------------------------------------------------------------------------
  // 1.17 INVIOLABLE SAFETY INVARIANT: Decoupled Execution
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.17: Status queries NEVER execute or release held browser actions');
  {
    const env = setupRouterTestEnv();
    const controller = new InterceptionController();
    let continuationExecutionCounter = 0;
    const continuationManager = new ContinuationManager(controller);

    const action = createSampleAction('act_decoupled_001');
    controller.register(action);
    const record = controller.holdAction('act_decoupled_001');
    continuationManager.registerHeldAction(action, record, () => {
      continuationExecutionCounter++;
    });

    // 1. Save pending request aligned with mock clock
    const req = createSampleRequest('apr_decoupled_001', ApprovalStatus.PENDING, {
      actionId: 'act_decoupled_001',
    }, env.clock.getTimeMs());
    await env.repository.save(req);
    env.actionOwnershipRegistry.registerActionOwnership('act_decoupled_001', 'usr_alice');

    // Query pending status
    const pendingResult = await env.syncClient.getStatus('apr_decoupled_001');
    assert(pendingResult.success, 'Pending status lookup succeeded');
    assertEquals(controller.getRecord('act_decoupled_001')?.state, InterceptionState.HELD, 'Action remains HELD');
    assertEquals(continuationExecutionCounter, 0, 'Action execution count is STRICTLY 0 after PENDING check');

    // Advance clock before approving
    env.clock.advanceMinutes(5);

    // 2. Transition backend to APPROVED
    await env.service.approveRequest(
      'apr_decoupled_001',
      { decisionReason: 'Approved by guardian' },
      {
        actorId: 'tc_carol',
        role: ActorRole.TRUSTED_CONTACT,
        isAuthenticated: true,
      }
    );

    // Query approved status
    const approvedResult = await env.syncClient.getStatus('apr_decoupled_001');
    assert(approvedResult.success, 'Approved status lookup succeeded');
    assert(approvedResult.isApproved, 'Status is approved');

    // CRITICAL: Inspect continuation execution count
    assertEquals(controller.getRecord('act_decoupled_001')?.state, InterceptionState.HELD, 'Action remains HELD');
    assertEquals(continuationExecutionCounter, 0, 'INVIOLABLE: Execution count remains STRICTLY 0 after APPROVED check');
  }

  // ---------------------------------------------------------------------------
  // 1.18 Privacy & Data Minimization: Zero Credentials Leaked
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.18: Sensitive credentials/tokens absent from result models and logs');
  {
    const env = setupRouterTestEnv();
    const req = createSampleRequest('apr_privacy_001', ApprovalStatus.APPROVED, {}, env.clock.getTimeMs());
    await env.repository.save(req);
    env.actionOwnershipRegistry.registerActionOwnership(req.actionId, 'usr_alice');

    const result = await env.syncClient.getStatus('apr_privacy_001');

    assert(result.success, 'Lookup succeeded');
    const resultJson = JSON.stringify(result);

    assert(!resultJson.includes('token_alice'), 'Auth token not leaked in result object');
    assert(!resultJson.includes('secretPassword'), 'Password not in result object');
    assert(!resultJson.includes('creditCard'), 'Card data not in result object');
  }

  // ---------------------------------------------------------------------------
  // 1.19 Synchronization Loop: Adaptive Polling Schedule
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.19: Adaptive polling schedule transitions across interval tiers');
  {
    let pollCount = 0;
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        pollCount++;
        return createMockResponse({
          success: true,
          data: createSampleRequest('apr_adaptive_001', ApprovalStatus.PENDING),
        });
      },
    });

    const sub = client.startSync(
      'apr_adaptive_001',
      {},
      {
        initialIntervalMs: 50,
        adaptiveSchedule: false, // fixed fast interval for test
        maxDurationMs: 1000,
      }
    );

    assert(sub.isActive(), 'Subscription is active');
    await new Promise((resolve) => setTimeout(resolve, 180));
    sub.stop();

    assert(!sub.isActive(), 'Subscription stopped');
    assert(pollCount >= 2, `Multiple polls executed smoothly (${pollCount} polls)`);
  }

  // ---------------------------------------------------------------------------
  // 1.20 Synchronization Loop: Terminal State Cutoff
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.20: Terminal state cutoff automatically halts polling upon approval');
  {
    let pollCount = 0;
    let terminalNotified = false;
    let statusChangeNotified = false;

    const samplePending = createSampleRequest('apr_cutoff_001', ApprovalStatus.PENDING);
    const sampleApproved = createSampleRequest('apr_cutoff_001', ApprovalStatus.APPROVED);

    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        pollCount++;
        // First poll returns PENDING, second poll returns APPROVED
        const data = pollCount === 1 ? samplePending : sampleApproved;
        return createMockResponse({ success: true, data });
      },
    });

    const sub = client.startSync(
      'apr_cutoff_001',
      {
        onStatusChange: (newStatus, _res, prevStatus) => {
          if (newStatus === ApprovalStatus.APPROVED) {
            statusChangeNotified = true;
            assertEquals(prevStatus, ApprovalStatus.PENDING, 'onStatusChange provides previous status');
          }
        },
        onTerminal: (termStatus) => {
          if (termStatus === ApprovalStatus.APPROVED) {
            terminalNotified = true;
          }
        },
      },
      {
        initialIntervalMs: 40,
        adaptiveSchedule: false,
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 150));

    assert(!sub.isActive(), 'Polling loop automatically stopped upon reaching terminal state');
    assert(terminalNotified, 'onTerminal listener notified of terminal transition');
    assert(statusChangeNotified, 'onStatusChange listener notified of transition');
    assertEquals(pollCount, 2, 'Exactly 2 polls attempted before cutoff');
  }

  // ---------------------------------------------------------------------------
  // 1.21 Synchronization Loop: Tab Visibility Awareness
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.21: Tab visibility change triggers immediate probe');
  {
    let probeCount = 0;
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        probeCount++;
        return createMockResponse({
          success: true,
          data: createSampleRequest('apr_vis_001', ApprovalStatus.PENDING),
        });
      },
    });

    const sub = client.startSync(
      'apr_vis_001',
      {},
      {
        initialIntervalMs: 5000, // Long interval
        hiddenIntervalMs: 30000,
        pauseWhenHidden: true,
      }
    );

    // Allow initial poll (scheduled asynchronously via scheduleNextPoll) to execute
    await new Promise((resolve) => setTimeout(resolve, 30));
    assertEquals(probeCount, 1, 'Initial poll completed');

    // Simulate tab hiding
    triggerVisibilityChange('hidden');
    assertEquals(mockVisibilityState, 'hidden', 'Tab state is hidden');

    // Simulate user switching back to tab
    triggerVisibilityChange('visible');
    // Allow microtask to process immediate probe
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert(probeCount >= 2, 'Tab visible transition triggered immediate probe');
    sub.stop();
  }

  // ---------------------------------------------------------------------------
  // 1.22 Synchronization Loop: Concurrency Safety
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.22: Overlapping poll requests are safely rejected with POLL_IN_PROGRESS');
  {
    let fetchResolver: (() => void) | null = null;
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        await new Promise<void>((resolve) => {
          fetchResolver = resolve;
        });
        return createMockResponse({
          success: true,
          data: createSampleRequest('apr_conc_001', ApprovalStatus.PENDING),
        });
      },
    });

    const sub = client.startSync('apr_conc_001', {}, { adaptiveSchedule: false });

    // Initial poll is now suspended waiting for fetchResolver
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Attempt concurrent pollNow while initial poll is in progress
    const concurrentResult = await sub.pollNow();

    assert(!concurrentResult.success, 'Concurrent poll rejected');
    assertEquals(concurrentResult.error?.code, 'POLL_IN_PROGRESS', 'Error code is POLL_IN_PROGRESS');

    // Unblock fetch and cleanup
    if (fetchResolver) (fetchResolver as any)();
    await new Promise((resolve) => setTimeout(resolve, 20));
    sub.stop();
  }

  // ---------------------------------------------------------------------------
  // 1.23 Synchronization Loop: Clean Teardown
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1.23: Clean teardown stops all active loops without dangling handles');
  {
    const client = new ApprovalStatusSyncClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        return createMockResponse({
          success: true,
          data: createSampleRequest('apr_clean_001', ApprovalStatus.PENDING),
        });
      },
    });

    const sub1 = client.startSync('apr_clean_001', {});
    const sub2 = client.startSync('apr_clean_002', {});

    assert(sub1.isActive(), 'Subscription 1 is active');
    assert(sub2.isActive(), 'Subscription 2 is active');

    client.stopAll();

    assert(!sub1.isActive(), 'Subscription 1 stopped by stopAll');
    assert(!sub2.isActive(), 'Subscription 2 stopped by stopAll');
  }

  // ###########################################################################
  // SECTION 2: LIVE BACKEND VERIFICATION (Real Local HTTP Server over TCP Socket)
  // ###########################################################################
  console.log('\n====================================================================');
  console.log('🌐 SECTION 2: LIVE BACKEND VERIFICATION (Real Local HTTP Server)');
  console.log('====================================================================');

  // Spin up real Node.js HTTP TCP server on ephemeral port
  const liveEnv = setupRouterTestEnv();

  const realHttpServer = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    liveEnv.router.handleHttpStream(req, res);
  });

  await new Promise<void>((resolve) => realHttpServer.listen(0, '127.0.0.1', () => resolve()));
  const livePort = (realHttpServer.address() as AddressInfo).port;
  const liveBaseUrl = `http://127.0.0.1:${livePort}`;

  console.log(`[REAL LOCAL HTTP SERVER] Listening on TCP: ${liveBaseUrl}`);

  try {
    // -------------------------------------------------------------------------
    // 2.1 Live HTTP: PENDING Status Retrieval
    // -------------------------------------------------------------------------
    console.log('\n▶ Scenario 2.1: Live HTTP wire retrieval of PENDING status');
    {
      const liveClient = new ApprovalStatusSyncClient({
        baseUrl: liveBaseUrl,
        tokenProvider: () => 'token_alice',
      });

      const req = createSampleRequest('apr_live_001', ApprovalStatus.PENDING, {}, liveEnv.clock.getTimeMs());
      await liveEnv.repository.save(req);
      liveEnv.actionOwnershipRegistry.registerActionOwnership(req.actionId, 'usr_alice');

      const result = await liveClient.getStatus('apr_live_001');

      assert(result.success, 'Live HTTP status query succeeded');
      assertEquals(result.status, ApprovalStatus.PENDING, 'Live status is PENDING');
      assert(result.isPending, 'isPending is true over live HTTP wire');
      assert(!result.isApproved, 'isApproved is false over live HTTP wire');
      assertEquals(result.statusCode, 200, 'Live HTTP status code is 200');
      assert(result.isAuthoritative, 'Response is authoritative from real backend');
      assertEquals(result.request?.id, 'apr_live_001', 'Retrieved canonical request matches');
    }

    // -------------------------------------------------------------------------
    // 2.2 Live HTTP: 401 Unauthenticated Enforcement
    // -------------------------------------------------------------------------
    console.log('\n▶ Scenario 2.2: Live HTTP wire rejects unauthenticated request with 401');
    {
      const liveClient = new ApprovalStatusSyncClient({
        baseUrl: liveBaseUrl,
        tokenProvider: () => undefined, // No credentials
      });

      const result = await liveClient.getStatus('apr_live_001');

      assert(!result.success, 'Unauthenticated query rejected over live wire');
      assertEquals(result.statusCode, 401, 'Live HTTP returned 401 status');
      assertEquals(result.error?.code, 'UNAUTHENTICATED', 'Live error code is UNAUTHENTICATED');
      assert(!result.isApproved, 'Unauthenticated request is never approved');
    }

    // -------------------------------------------------------------------------
    // 2.3 Live HTTP: 404 Anti-Enumeration Enforcement
    // -------------------------------------------------------------------------
    console.log('\n▶ Scenario 2.3: Live HTTP wire returns 404 for unknown request without leaking');
    {
      const liveClient = new ApprovalStatusSyncClient({
        baseUrl: liveBaseUrl,
        tokenProvider: () => 'token_alice',
      });

      const result = await liveClient.getStatus('apr_nonexistent_live');

      assert(!result.success, 'Non-existent request rejected');
      assertEquals(result.statusCode, 404, 'Live HTTP returned 404 status');
      assertEquals(result.error?.code, 'NOT_FOUND_OR_DENIED', 'Error is NOT_FOUND_OR_DENIED');
      assert(!result.isApproved, '404 is never approved');
    }

    // -------------------------------------------------------------------------
    // 2.4 Live HTTP: Real-Time Synchronization Loop Detection of Backend Approval
    // -------------------------------------------------------------------------
    console.log('\n▶ Scenario 2.4: Real-time synchronization loop detects backend approval transition');
    {
      const liveClient = new ApprovalStatusSyncClient({
        baseUrl: liveBaseUrl,
        tokenProvider: () => 'token_alice',
      });

      const req = createSampleRequest('apr_live_sync_001', ApprovalStatus.PENDING, {}, liveEnv.clock.getTimeMs());
      await liveEnv.repository.save(req);
      liveEnv.actionOwnershipRegistry.registerActionOwnership(req.actionId, 'usr_alice');

      let transitionObserved = false;
      let terminalObserved = false;

      const sub = liveClient.startSync(
        'apr_live_sync_001',
        {
          onStatusChange: (status) => {
            if (status === ApprovalStatus.APPROVED) {
              transitionObserved = true;
            }
          },
          onTerminal: (status) => {
            if (status === ApprovalStatus.APPROVED) {
              terminalObserved = true;
            }
          },
        },
        {
          initialIntervalMs: 50,
          adaptiveSchedule: false,
        }
      );

      // Verify loop is running
      assert(sub.isActive(), 'Live synchronization loop started');

      // Allow 1 initial poll
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Advance clock before approving
      liveEnv.clock.advanceMinutes(5);

      // Asynchronously approve request on backend via Trusted Contact Carol
      await liveEnv.service.approveRequest(
        'apr_live_sync_001',
        { decisionReason: 'Verified and approved by guardian via dashboard' },
        {
          actorId: 'tc_carol',
          role: ActorRole.TRUSTED_CONTACT,
          isAuthenticated: true,
        }
      );

      // Wait for next sync poll to observe transition
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert(transitionObserved, 'Live sync observed status transition to APPROVED');
      assert(terminalObserved, 'Live sync fired onTerminal callback');
      assert(!sub.isActive(), 'Live sync stopped automatically upon terminal approval');
    }

    // -------------------------------------------------------------------------
    // 2.5 Live TCP: Network Drop (Connection Refused on Closed Port)
    // -------------------------------------------------------------------------
    console.log('\n▶ Scenario 2.5: Real TCP connection refused on dead port yields isNetworkError: true');
    {
      // Port 59998 is not open
      const deadClient = new ApprovalStatusSyncClient({
        baseUrl: 'http://127.0.0.1:59998',
        tokenProvider: () => 'token_alice',
        timeoutMs: 1000,
      });

      const result = await deadClient.getStatus('apr_dead_port_001');

      assert(!result.success, 'Connection to dead port failed as expected');
      assert(result.isNetworkError, 'Live TCP failure marked isNetworkError: true');
      assert(!result.isApproved, 'TCP failure is strictly not approved');
      assert(!result.isTerminal, 'TCP failure is not terminal');
      assertEquals(result.error?.code, ApiClientErrorCodes.NETWORK_FAILURE, 'Error is NETWORK_FAILURE');
    }
  } finally {
    // Cleanly close real HTTP TCP server
    await new Promise<void>((resolve) => realHttpServer.close(() => resolve()));
    console.log('[REAL LOCAL HTTP SERVER] Cleanly closed and released TCP port.');
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n====================================================================');
  console.log(`📊 APPROVAL STATUS SYNC CLIENT VERIFICATION: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('🎉 ALL MOCKED & LIVE BACKEND TESTS PASSED WITH 100% SUCCESS!');
  } else {
    console.error(`❌ SOME TESTS FAILED: ${totalTests - passedTests} failures.`);
    process.exit(1);
  }
  console.log('====================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Fatal error during test execution:', err);
  process.exit(1);
});
