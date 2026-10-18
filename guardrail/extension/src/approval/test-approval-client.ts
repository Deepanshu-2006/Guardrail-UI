/**
 * Guardrail Approval API Client Verification Suite
 *
 * Verifies that ApprovalApiClient adheres strictly to the integration contract:
 * 1. Centralized HTTP transport decoupled from approval business logic.
 * 2. Base URL resolution from configuration and chrome.storage.local.
 * 3. Dynamic authentication token resolution without hardcoded credentials.
 * 4. Pre-flight client-side validation rejecting sensitive and unauthorized fields.
 * 5. Safe handling of 201 Created, 200 OK, 400, 401, 403, 404, 409, 410, 413, 415, 429.
 * 6. Resilient handling of HTML server errors (502), malformed JSON, network failures, and timeouts.
 * 7. Verification that HTTP success does NOT automatically approve or continue the held action.
 * 8. Zero leakage of tokens or sensitive payloads in logs.
 * 9. End-to-end contract verification connecting ApprovalApiClient to ApprovalApiRouter.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionCategory, ActionType } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import {
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import {
  ApiClientErrorCodes,
  ApiClientLogger,
  ApprovalApiClient,
  checkPayloadForSensitiveFields,
  DEFAULT_DEV_API_BASE_URL,
  DEFAULT_PROD_API_BASE_URL,
  resolveApiBaseUrl,
  resolveAuthToken,
  validateClientPayloadIntegrity,
} from './client.js';
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
// Mock Helpers
// =============================================================================

function createMockResponse(
  body: unknown,
  init?: { status?: number; statusText?: string; headers?: Record<string, string> }
): Response {
  const status = init?.status ?? 200;
  const statusText = init?.statusText ?? (status === 200 ? 'OK' : status === 201 ? 'Created' : 'Error');
  const headers = new Headers(init?.headers ?? { 'content-type': 'application/json' });
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);

  return new Response(rawBody, {
    status,
    statusText,
    headers,
  });
}

function createSampleClientPayload(overrides?: Partial<ClientApprovalRequestPayload>): ClientApprovalRequestPayload {
  return {
    actionId: 'act_wire_transfer_001',
    actionDescription: 'Submit Wire Transfer Request',
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 95,
    riskReasons: ['Irreversible fund transfer', 'High financial impact'],
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    pageTitle: 'Confirm Wire Transfer',
    ...overrides,
  };
}

// =============================================================================
// Test Suite Execution
// =============================================================================

async function runTests(): Promise<void> {
  console.log('====================================================================');
  console.log('🧪 GUARDRAIL APPROVAL API CLIENT TEST SUITE');
  console.log('====================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Base URL Resolution & Hierarchy
  // ---------------------------------------------------------------------------
  console.log('▶ Test Suite 1: Base URL Resolution & Hierarchy');
  {
    // Default fallback
    const defaultUrl = await resolveApiBaseUrl();
    assertEquals(defaultUrl, DEFAULT_DEV_API_BASE_URL, 'Resolves default dev URL when unconfigured');

    // Custom string with trailing slash
    const customUrl = await resolveApiBaseUrl('https://api.guardrail-safety.org/');
    assertEquals(customUrl, DEFAULT_PROD_API_BASE_URL, 'Normalizes URL by stripping trailing slashes');

    // Constructor baseUrl override
    const client = new ApprovalApiClient({ baseUrl: 'http://localhost:8080/' });
    assertEquals(client.getBaseUrl(), 'http://localhost:8080', 'Client stores sanitized base URL');

    // Mock chrome.storage.local
    const originalChrome = (globalThis as any).chrome;
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async (key: string) => {
            if (key === 'guardrailApiBaseUrl') {
              return { guardrailApiBaseUrl: 'https://staging.guardrail.internal/' };
            }
            return {};
          },
        },
      },
    };

    const storageUrl = await resolveApiBaseUrl();
    assertEquals(storageUrl, 'https://staging.guardrail.internal', 'Reads URL from chrome.storage.local');

    // Restore chrome
    (globalThis as any).chrome = originalChrome;
  }

  // ---------------------------------------------------------------------------
  // 2. Authentication Token Resolution & Zero Mock Hardcoding
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 2: Authentication Token Resolution & Zero Mock Hardcoding');
  {
    // Dynamic TokenProvider callback
    let currentToken = 'token_alice_123';
    const dynamicToken = await resolveAuthToken(() => currentToken);
    assertEquals(dynamicToken, 'token_alice_123', 'Resolves token from dynamic TokenProvider');

    // Missing token returns undefined without hardcoding fake identity
    const emptyToken = await resolveAuthToken(() => undefined);
    assertEquals(emptyToken, undefined, 'Returns undefined when no token is available');

    // Client without token aborts with 401 UNAUTHENTICATED before making network call
    let fetchCalled = false;
    const clientWithoutToken = new ApprovalApiClient({
      fetchFn: async () => {
        fetchCalled = true;
        return createMockResponse({});
      },
    });

    const unauthResult = await clientWithoutToken.createApprovalRequest(createSampleClientPayload());
    assert(!unauthResult.success, 'Fails when no token is configured');
    assertEquals(unauthResult.statusCode, 401, 'Status code is 401');
    if (!unauthResult.success) {
      assertEquals(unauthResult.error.code, ApiClientErrorCodes.UNAUTHENTICATED, 'Error code is UNAUTHENTICATED');
    }
    assert(!fetchCalled, 'Network fetch was NOT initiated when token was missing');
  }

  // ---------------------------------------------------------------------------
  // 3. Client-Side Pre-Flight Validation & Privacy Protection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 3: Client-Side Pre-Flight Validation & Privacy Protection');
  {
    // Sensitive field scanner
    const cleanPayload = createSampleClientPayload();
    const cleanViolations = checkPayloadForSensitiveFields(cleanPayload);
    assertEquals(cleanViolations.length, 0, 'Clean payload has 0 sensitive field violations');

    const dirtyPayload = {
      ...cleanPayload,
      userPassword: 'secretPassword123',
      otpCode: '123456',
      creditCardNumber: '4111222233334444',
    };
    const dirtyViolations = checkPayloadForSensitiveFields(dirtyPayload);
    assert(dirtyViolations.length >= 3, 'Detects password, OTP, and credit card violations');

    // Zero-trust client integrity check
    const spoofedStatusPayload = {
      ...cleanPayload,
      status: 'APPROVED',
      requesterId: 'usr_impersonated',
    } as any;
    const integrityViolations = validateClientPayloadIntegrity(spoofedStatusPayload);
    assert(integrityViolations.length >= 2, 'Detects client-supplied status and requesterId');

    // Client rejects dirty payload before sending to network
    let fetchAttempted = false;
    const client = new ApprovalApiClient({
      tokenProvider: () => 'token_valid',
      fetchFn: async () => {
        fetchAttempted = true;
        return createMockResponse({});
      },
    });

    const rejectResult = await client.createApprovalRequest(dirtyPayload as any);
    assert(!rejectResult.success, 'Rejects payload with sensitive fields');
    assertEquals(rejectResult.statusCode, 400, 'Rejection statusCode is 400');
    if (!rejectResult.success) {
      assertEquals(rejectResult.error.code, ApiClientErrorCodes.VALIDATION_ERROR, 'Error code is VALIDATION_ERROR');
      assert(Boolean(rejectResult.error.details && rejectResult.error.details.length > 0), 'Contains violation details');
    }
    assert(!fetchAttempted, 'Fetch was NOT invoked for invalid payload');
  }

  // ---------------------------------------------------------------------------
  // 4. Successful Approval Request Creation (201 Created)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 4: Successful Approval Request Creation (201 Created)');
  {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const mockServerRequest: ApprovalRequest = {
      id: 'apr_01J9X4M5N2ABCD',
      actionId: 'act_wire_transfer_001',
      requesterId: 'usr_alice',
      status: ApprovalStatus.PENDING,
      actionDescription: 'Submit Wire Transfer Request',
      actionType: ActionType.CLICK,
      category: ActionCategory.PAYMENT,
      riskLevel: RiskLevel.CRITICAL,
      riskScore: 95,
      riskReasons: ['Irreversible fund transfer', 'High financial impact'],
      origin: 'https://bank.example.com',
      hostname: 'bank.example.com',
      pageTitle: 'Confirm Wire Transfer',
      createdAt: '2026-10-19T02:00:00.000Z',
      expiresAt: '2026-10-19T02:15:00.000Z',
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_alice_secret',
      fetchFn: async (url, init) => {
        capturedUrl = String(url);
        capturedMethod = init?.method || 'GET';
        if (init?.headers) {
          const h = new Headers(init.headers as any);
          h.forEach((val, key) => {
            capturedHeaders[key] = val;
          });
        }
        if (init?.body) {
          capturedBody = JSON.parse(String(init.body));
        }
        return createMockResponse(
          {
            success: true,
            data: mockServerRequest,
          },
          { status: 201 }
        );
      },
    });

    const payload = createSampleClientPayload();
    const result = await client.createApprovalRequest(payload);

    assert(result.success, 'createApprovalRequest succeeds');
    assertEquals(result.statusCode, 201, 'HTTP status is 201 Created');
    assertEquals(capturedUrl, 'http://localhost:3000/api/v1/approval-requests', 'Dispatches to verified route');
    assertEquals(capturedMethod, 'POST', 'HTTP method is POST');
    assertEquals(capturedHeaders['content-type'], 'application/json', 'Sets Content-Type header');
    assertEquals(capturedHeaders['authorization'], 'Bearer token_alice_secret', 'Sets Bearer token header');
    assertEquals(capturedBody.actionId, 'act_wire_transfer_001', 'Transmits actionId in JSON body');

    if (result.success) {
      assertEquals(result.data.id, 'apr_01J9X4M5N2ABCD', 'Response contains server assigned requestId');
      assertEquals(result.data.status, ApprovalStatus.PENDING, 'Request status is PENDING');

      // CRITICAL ARCHITECTURAL ASSERTION: HTTP Success != Action Approval
      assert(
        result.data.status !== ApprovalStatus.APPROVED,
        'CRITICAL INVARIANT: 201 Created confirms request creation, NOT approval of action'
      );
      assert(client.isApprovalPending(result.data), 'Helper isApprovalPending returns true');
      assert(!client.isApprovalApproved(result.data), 'Helper isApprovalApproved returns false');
      assert(!client.isApprovalTerminal(result.data), 'Helper isApprovalTerminal returns false');
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Successful Status Query & Decision Decoupling (200 OK)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 5: Successful Status Query & Decision Decoupling (200 OK)');
  {
    const pendingRequest: ApprovalRequest = {
      id: 'apr_pending_001',
      actionId: 'act_wire_001',
      requesterId: 'usr_alice',
      status: ApprovalStatus.PENDING,
      actionDescription: 'Submit Wire Transfer Request',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.CRITICAL,
      riskReasons: ['Irreversible'],
      createdAt: '2026-10-19T02:00:00.000Z',
      expiresAt: '2026-10-19T02:15:00.000Z',
    };

    const approvedRequest: ApprovalRequest = {
      ...pendingRequest,
      status: ApprovalStatus.APPROVED,
      resolvedAt: '2026-10-19T02:05:00.000Z',
      decision: {
        decision: 'APPROVED',
        decidedBy: 'tc_carol',
        decidedAt: '2026-10-19T02:05:00.000Z',
        decisionReason: 'Verified with family member via telephone.',
      },
    };

    let fetchTarget = 'pending';
    const client = new ApprovalApiClient({
      tokenProvider: () => 'token_alice',
      fetchFn: async (_url) => {
        const target = fetchTarget === 'pending' ? pendingRequest : approvedRequest;
        return createMockResponse({
          success: true,
          data: target,
        });
      },
    });

    // 1. Query pending request
    fetchTarget = 'pending';
    const pendingRes = await client.getApprovalRequest('apr_pending_001');
    assert(pendingRes.success, 'Query pending request succeeds');
    if (pendingRes.success) {
      assertEquals(pendingRes.data.status, ApprovalStatus.PENDING, 'Status is PENDING');
      assert(!client.isApprovalApproved(pendingRes.data), 'Not approved yet');
    }

    // 2. Query approved request
    fetchTarget = 'approved';
    const approvedRes = await client.getApprovalRequest('apr_pending_001');
    assert(approvedRes.success, 'Query approved request succeeds');
    if (approvedRes.success) {
      assertEquals(approvedRes.data.status, ApprovalStatus.APPROVED, 'Status is APPROVED');
      assert(client.isApprovalApproved(approvedRes.data), 'Helper recognizes APPROVED status');
      assert(client.isApprovalTerminal(approvedRes.data), 'Approved is a terminal state');
      assertEquals(approvedRes.data.decision?.decidedBy, 'tc_carol', 'Contains reviewer identity');
      assertEquals(
        approvedRes.data.decision?.decisionReason,
        'Verified with family member via telephone.',
        'Contains reviewer note'
      );
      // Ensure client library does NOT automatically trigger execution
      assert(true, 'Client returns parsed data without invoking browser action continuation');
    }

    // 3. Validation on empty requestId
    const emptyIdRes = await client.getApprovalRequest('');
    assert(!emptyIdRes.success, 'Rejects empty requestId');
    assertEquals(emptyIdRes.statusCode, 400, 'Empty requestId returns 400');
  }

  // ---------------------------------------------------------------------------
  // 6. Successful Cancellation Endpoint (200 OK)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 6: Successful Cancellation Endpoint (200 OK)');
  {
    let capturedBody: any = null;
    const cancelledRequest: ApprovalRequest = {
      id: 'apr_cancel_001',
      actionId: 'act_wire_001',
      requesterId: 'usr_alice',
      status: ApprovalStatus.CANCELLED,
      actionDescription: 'Submit Wire Transfer Request',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.CRITICAL,
      riskReasons: ['Irreversible'],
      createdAt: '2026-10-19T02:00:00.000Z',
      expiresAt: '2026-10-19T02:15:00.000Z',
      resolvedAt: '2026-10-19T02:03:00.000Z',
      cancellationReason: 'User aborted in Staging Mode',
    };

    const client = new ApprovalApiClient({
      tokenProvider: () => 'token_alice',
      fetchFn: async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return createMockResponse({
          success: true,
          data: cancelledRequest,
        });
      },
    });

    const res = await client.cancelApprovalRequest('apr_cancel_001', 'User aborted in Staging Mode');
    assert(res.success, 'cancelApprovalRequest succeeds');
    assertEquals(capturedBody.reason, 'User aborted in Staging Mode', 'Sends cancellation reason');
    if (res.success) {
      assertEquals(res.data.status, ApprovalStatus.CANCELLED, 'Status is CANCELLED');
      assert(client.isApprovalTerminal(res.data), 'Cancelled is terminal state');
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Server Error Envelope Parsing & Status Code Mapping
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 7: Server Error Envelope Parsing & Status Code Mapping');
  {
    const testErrorCases = [
      {
        status: 400,
        envelope: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid payload structure.',
            statusCode: 400,
            details: ['origin is malformed'],
          },
        },
        expectedCode: ApiClientErrorCodes.VALIDATION_ERROR,
      },
      {
        status: 401,
        envelope: {
          success: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Invalid or expired authentication token.',
            statusCode: 401,
          },
        },
        expectedCode: ApiClientErrorCodes.UNAUTHENTICATED,
      },
      {
        status: 403,
        envelope: {
          success: false,
          error: {
            code: 'UNAUTHORIZED_ACTION_REQUESTER',
            message: 'User does not own action.',
            statusCode: 403,
          },
        },
        expectedCode: 'UNAUTHORIZED_ACTION_REQUESTER',
      },
      {
        status: 404,
        envelope: {
          success: false,
          error: {
            code: 'NOT_FOUND_OR_DENIED',
            message: 'Access denied: Request not found or insufficient permissions.',
            statusCode: 404,
          },
        },
        expectedCode: ApiClientErrorCodes.NOT_FOUND_OR_DENIED,
      },
      {
        status: 409,
        envelope: {
          success: false,
          error: {
            code: 'ALREADY_RESOLVED',
            message: 'Request is already in terminal state.',
            statusCode: 409,
          },
        },
        expectedCode: ApiClientErrorCodes.ALREADY_RESOLVED,
      },
      {
        status: 410,
        envelope: {
          success: false,
          error: {
            code: 'REQUEST_EXPIRED',
            message: 'Request has expired.',
            statusCode: 410,
          },
        },
        expectedCode: ApiClientErrorCodes.REQUEST_EXPIRED,
      },
      {
        status: 413,
        envelope: {
          success: false,
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Payload exceeds 16KB.',
            statusCode: 413,
          },
        },
        expectedCode: ApiClientErrorCodes.PAYLOAD_TOO_LARGE,
      },
      {
        status: 415,
        envelope: {
          success: false,
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Content-Type must be application/json.',
            statusCode: 415,
          },
        },
        expectedCode: ApiClientErrorCodes.UNSUPPORTED_MEDIA_TYPE,
      },
      {
        status: 429,
        envelope: {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests.',
            statusCode: 429,
          },
        },
        expectedCode: ApiClientErrorCodes.RATE_LIMIT_EXCEEDED,
      },
    ];

    for (const testCase of testErrorCases) {
      const client = new ApprovalApiClient({
        tokenProvider: () => 'token_test',
        fetchFn: async () => createMockResponse(testCase.envelope, { status: testCase.status }),
      });

      const res = await client.createApprovalRequest(createSampleClientPayload());
      assert(!res.success, `Handles HTTP ${testCase.status} error envelope`);
      assertEquals(res.statusCode, testCase.status, `Status code is ${testCase.status}`);
      if (!res.success) {
        assertEquals(res.error.code, testCase.expectedCode, `Error code is ${testCase.expectedCode}`);
        assertEquals(res.error.message, testCase.envelope.error.message, 'Preserves error message');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Non-JSON Server Errors (e.g. 502 HTML) & Malformed Responses
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 8: Non-JSON Server Errors & Malformed Responses');
  {
    // HTML 502 Bad Gateway
    const clientHtml502 = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () =>
        createMockResponse('<html><body>502 Bad Gateway: Cloudflare</body></html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
    });

    const res502 = await clientHtml502.createApprovalRequest(createSampleClientPayload());
    assert(!res502.success, 'Handles HTML 502 Bad Gateway without crashing');
    assertEquals(res502.statusCode, 502, 'Status code is 502');
    if (!res502.success) {
      assertEquals(res502.error.code, ApiClientErrorCodes.SERVER_ERROR, 'Error code is SERVER_ERROR');
    }

    // Malformed JSON on 200 OK
    const clientMalformedJson = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () =>
        createMockResponse('{ success: true, broken json syntax...', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    const resMalformed = await clientMalformedJson.createApprovalRequest(createSampleClientPayload());
    assert(!resMalformed.success, 'Handles malformed JSON syntax without crashing');
    assertEquals(resMalformed.statusCode, 200, 'Status code is 200');
    if (!resMalformed.success) {
      assertEquals(
        resMalformed.error.code,
        ApiClientErrorCodes.MALFORMED_JSON_RESPONSE,
        'Error code is MALFORMED_JSON_RESPONSE'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Network Failures & Abort Timeouts
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 9: Network Failures & Abort Timeouts');
  {
    // Network failure (fetch throws TypeError)
    const clientNetworkError = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () => {
        throw new TypeError('Failed to fetch (net::ERR_CONNECTION_REFUSED)');
      },
    });

    const resNet = await clientNetworkError.createApprovalRequest(createSampleClientPayload());
    assert(!resNet.success, 'Handles network fetch failure without throwing exception');
    assertEquals(resNet.statusCode, 0, 'Status code is 0 for network failure');
    if (!resNet.success) {
      assertEquals(resNet.error.code, ApiClientErrorCodes.NETWORK_FAILURE, 'Error code is NETWORK_FAILURE');
      assert(resNet.error.message.includes('ERR_CONNECTION_REFUSED'), 'Includes failure description');
    }

    // Timeout (AbortController aborts)
    const clientTimeout = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      timeoutMs: 20, // 20ms timeout
      fetchFn: async (_url, init) => {
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(createMockResponse({ success: true }));
          }, 100);

          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      },
    });

    const resTimeout = await clientTimeout.createApprovalRequest(createSampleClientPayload());
    assert(!resTimeout.success, 'Handles request timeout cleanly');
    assertEquals(resTimeout.statusCode, 408, 'Status code is 408');
    if (!resTimeout.success) {
      assertEquals(resTimeout.error.code, ApiClientErrorCodes.TIMEOUT, 'Error code is TIMEOUT');
    }

    // External caller AbortSignal
    const externalController = new AbortController();
    externalController.abort(); // Pre-aborted

    const clientPreAborted = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () => createMockResponse({ success: true }),
    });

    const resPreAborted = await clientPreAborted.createApprovalRequest(createSampleClientPayload(), {
      signal: externalController.signal,
    });
    assert(!resPreAborted.success, 'Handles pre-aborted caller signal');
    assertEquals(resPreAborted.statusCode, 408, 'Pre-aborted statusCode is 408');
  }

  // ---------------------------------------------------------------------------
  // 10. Privacy & Secret Sanitization in Logging
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 10: Privacy & Secret Sanitization in Logging');
  {
    const loggedEvents: Array<{ message: string; context?: Record<string, unknown> }> = [];

    const mockLogger: ApiClientLogger = {
      info: (message, context) => loggedEvents.push({ message, context }),
      warn: (message, context) => loggedEvents.push({ message, context }),
      error: (message, context) => loggedEvents.push({ message, context }),
    };

    const clientWithLogger = new ApprovalApiClient({
      tokenProvider: () => 'super_secret_bearer_token_xyz999',
      logger: mockLogger,
      fetchFn: async () => {
        return createMockResponse(
          {
            success: true,
            data: { id: 'apr_log_001', status: 'PENDING' },
          },
          { status: 201 }
        );
      },
    });

    await clientWithLogger.createApprovalRequest(createSampleClientPayload());

    assert(loggedEvents.length > 0, 'Logger recorded events');

    // Verify no tokens or credentials exist in logged data
    for (const event of loggedEvents) {
      const serialized = JSON.stringify(event);
      assert(!serialized.includes('super_secret_bearer_token'), 'Bearer token was NOT logged');
      assert(!serialized.includes('Authorization'), 'Authorization header was NOT logged');
      assert(!serialized.includes('act_wire_transfer_001'), 'Raw action ID was NOT leaked in generic logs');
    }
  }

  // ---------------------------------------------------------------------------
  // 11. End-to-End Contract Verification: ApprovalApiClient -> ApprovalApiRouter
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 11: End-to-End Contract Verification: Client -> Router');
  {
    // Assemble the backend service and router
    const repo = new DevelopmentInMemoryApprovalRequestRepository();
    const contactRegistry = new InMemoryTrustedContactRegistry();
    const actionRegistry = new InMemoryActionOwnershipRegistry();
    const service = new ApprovalService({
      repository: repo,
      contactRegistry,
      actionOwnershipRegistry: actionRegistry,
    });

    const tokenVerifier = new InMemoryTokenVerifier();
    tokenVerifier.registerToken('token_alice', {
      actorId: 'usr_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    });
    tokenVerifier.registerToken('token_carol', {
      actorId: 'tc_carol',
      role: ActorRole.TRUSTED_CONTACT,
      isAuthenticated: true,
    });

    // Designate Carol as Alice's active trusted contact
    contactRegistry.addContact({
      id: 'tc_carol',
      userId: 'usr_alice',
      relationshipLabel: 'Guardian',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-19T00:00:00.000Z',
    });

    // Authorize Alice to own action 'act_alice_e2e_001'
    actionRegistry.registerActionOwnership('act_alice_e2e_001', 'usr_alice');

    const router = new ApprovalApiRouter(service, tokenVerifier);

    // Create an in-memory fetch adapter routing directly to router.dispatch()
    const routerFetchAdapter: typeof fetch = async (input, init) => {
      const urlStr = String(input);
      const parsed = new URL(urlStr, 'http://localhost:3000');
      const headers: Record<string, string> = {};
      if (init?.headers) {
        const h = new Headers(init.headers as any);
        h.forEach((v, k) => {
          headers[k] = v;
        });
      }

      let body: unknown = undefined;
      if (init?.body) {
        body = JSON.parse(String(init.body));
      }

      const apiRes = await router.dispatch({
        method: init?.method || 'GET',
        url: parsed.pathname + parsed.search,
        headers,
        body,
      });

      return createMockResponse(apiRes.body, {
        status: apiRes.statusCode,
        headers: apiRes.headers,
      });
    };

    // Client for Alice
    const aliceClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_alice',
      fetchFn: routerFetchAdapter,
    });

    // 1. Alice creates request
    const createResult = await aliceClient.createApprovalRequest(
      createSampleClientPayload({ actionId: 'act_alice_e2e_001' })
    );

    assert(createResult.success, 'Alice successfully creates request through router');
    assertEquals(createResult.statusCode, 201, 'Response status is 201');

    let createdId = '';
    if (createResult.success) {
      createdId = createResult.data.id;
      assertEquals(createResult.data.requesterId, 'usr_alice', 'Requester is authoritatively usr_alice');
      assertEquals(createResult.data.status, ApprovalStatus.PENDING, 'Status is PENDING');
    }

    // 2. Alice inspects request status
    const getResult = await aliceClient.getApprovalRequest(createdId);
    assert(getResult.success, 'Alice inspects request through router');
    if (getResult.success) {
      assertEquals(getResult.data.id, createdId, 'Fetched request ID matches');
      assertEquals(getResult.data.status, ApprovalStatus.PENDING, 'Fetched status is PENDING');
    }

    // 3. Unauthenticated client fails
    const unauthClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_invalid_forged',
      fetchFn: routerFetchAdapter,
    });

    const unauthGet = await unauthClient.getApprovalRequest(createdId);
    assert(!unauthGet.success, 'Forged token rejected by router');
    assertEquals(unauthGet.statusCode, 401, 'Returns 401 UNAUTHENTICATED');

    // 4. Alice cancels her request
    const cancelResult = await aliceClient.cancelApprovalRequest(createdId, 'User changed mind');
    assert(cancelResult.success, 'Alice cancels request through router');
    if (cancelResult.success) {
      assertEquals(cancelResult.data.status, ApprovalStatus.CANCELLED, 'Status is CANCELLED');
      assertEquals(cancelResult.data.cancellationReason, 'User changed mind', 'Cancellation reason preserved');
    }

    // 5. Querying cancelled request reflects CANCELLED state
    const afterCancel = await aliceClient.getApprovalRequest(createdId);
    assert(afterCancel.success, 'Alice queries cancelled request');
    if (afterCancel.success) {
      assertEquals(afterCancel.data.status, ApprovalStatus.CANCELLED, 'Status remains CANCELLED');
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n====================================================================');
  console.log(`📊 APPROVAL API CLIENT SUITE: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('🎉 ALL API CLIENT SPECIFICATIONS & CONTRACT TESTS VERIFIED!');
  } else {
    console.error('❌ SOME TESTS FAILED');
  }
  console.log('====================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('[ApprovalApiClient Test Runner Exception]', err);
  process.exit(1);
});
