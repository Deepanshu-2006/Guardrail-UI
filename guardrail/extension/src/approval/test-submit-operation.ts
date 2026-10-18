/**
 * Guardrail Approval Submission Operation Verification Suite
 *
 * Verifies that submitApprovalRequest adheres strictly to architectural invariants:
 * 1. Strict local state pre-condition: Requires action to be in HELD state in InterceptionController.
 * 2. Privacy & least privilege: Excludes sensitive fields and live DOM references.
 * 3. Authoritative outcomes (isAuthoritative: true):
 *    - CREATED_PENDING (201 Created)
 *    - ALREADY_PENDING (200 OK idempotent return)
 *    - INVALID_LOCAL_STATE (action missing or not HELD)
 *    - PAYLOAD_INVALID (client-side pre-flight or server 400)
 *    - UNAUTHENTICATED (401)
 *    - UNAUTHORIZED (403)
 *    - CONFLICT (409)
 *    - EXPIRED (410)
 *    - TRANSPORT_REJECTED (413, 415, 429)
 * 4. Uncertain outcomes (isAuthoritative: false):
 *    - TIMEOUT_UNCERTAIN (408 / AbortController timeout)
 *    - NETWORK_FAILURE_UNCERTAIN (network disconnect / socket drop)
 *    - SERVER_ERROR (500 / 502 HTML)
 * 5. Execution Decoupling:
 *    - Action remains safely HELD in browser runtime across all outcomes.
 *    - ContinuationManager handler is NEVER executed.
 * 6. End-to-end integration piping submitApprovalRequest into ApprovalApiRouter and ApprovalService.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { InterceptionState } from '../types/interception.js';
import { StagingActionContext } from '../types/staging.js';
import { ApprovalRequest, ApprovalStatus } from '../types/approval.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import {
  SubmissionOutcome,
  submitApprovalRequest,
  buildClientPayloadFromStagingContext,
} from './submit-operation.js';
import {
  ApprovalApiClient,
  DEFAULT_DEV_API_BASE_URL,
} from './client.js';
import {
  ActorRole,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
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
// Mock Test Helpers
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

function createSampleAction(actionId = 'act_payment_001'): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-19T02:00:00.000Z',
    page: {
      url: 'https://bank.example.com/transfer',
      title: 'Transfer Confirmation',
    },
    element: {
      tagName: 'BUTTON',
      id: 'btn-confirm-transfer',
      visibleText: 'Confirm Transfer',
    },
    category: ActionCategory.PAYMENT,
  };
}

function createSampleStagingContext(overrides?: Partial<StagingActionContext>): StagingActionContext {
  return {
    actionId: 'act_payment_001',
    description: 'Payment trigger: Click on "Confirm Transfer"',
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 90,
    riskReasons: ['Irreversible payment action', 'High financial severity'],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    pageTitle: 'Transfer Confirmation',
    timestamp: '2026-10-19T02:00:00.000Z',
    stagedAt: '2026-10-19T02:00:01.000Z',
    ...overrides,
  };
}

// =============================================================================
// Test Suite Execution
// =============================================================================

async function runTests(): Promise<void> {
  console.log('====================================================================');
  console.log('🧪 GUARDRAIL APPROVAL SUBMISSION OPERATION TEST SUITE');
  console.log('====================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Minimal Client Payload Mapping & Privacy
  // ---------------------------------------------------------------------------
  console.log('▶ Test Suite 1: Minimal Client Payload Mapping & Privacy');
  {
    const context = createSampleStagingContext();
    const payload = buildClientPayloadFromStagingContext(context);

    assertEquals(payload.actionId, 'act_payment_001', 'Maps actionId');
    assertEquals(payload.actionDescription, context.description, 'Maps safe description');
    assertEquals(payload.actionType, ActionType.CLICK, 'Maps actionType');
    assertEquals(payload.category, ActionCategory.PAYMENT, 'Maps category');
    assertEquals(payload.riskLevel, RiskLevel.CRITICAL, 'Maps riskLevel');
    assertEquals(payload.riskScore, 90, 'Maps riskScore');
    assertEquals(payload.origin, 'https://bank.example.com', 'Maps origin');
    assertEquals(payload.hostname, 'bank.example.com', 'Maps hostname');
    assertEquals(payload.pageTitle, 'Transfer Confirmation', 'Maps pageTitle');

    // Strict privacy verification: Ensure unpermitted/sensitive fields are not present
    const rawPayload = payload as unknown as Record<string, unknown>;
    assertEquals(rawPayload.requesterId, undefined, 'Does not include requesterId');
    assertEquals(rawPayload.status, undefined, 'Does not include status');
    assertEquals(rawPayload.decision, undefined, 'Does not include decision');
    assertEquals(rawPayload.resolvedAt, undefined, 'Does not include resolvedAt');
    assertEquals(rawPayload.password, undefined, 'Does not include password');
    assertEquals(rawPayload.otp, undefined, 'Does not include otp');
    assertEquals(rawPayload.token, undefined, 'Does not include token');
  }

  // ---------------------------------------------------------------------------
  // 2. Local State Pre-Condition Validation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 2: Local State Pre-Condition Validation');
  {
    const controller = new InterceptionController();
    const context = createSampleStagingContext({ actionId: 'act_unregistered_999' });

    // Case A: Action not tracked in controller
    const notFoundRes = await submitApprovalRequest(context, controller);
    assert(!notFoundRes.success, 'Rejects untracked action');
    assertEquals(notFoundRes.outcome, SubmissionOutcome.INVALID_LOCAL_STATE, 'Outcome is INVALID_LOCAL_STATE');
    assertEquals(notFoundRes.isAuthoritative, true, 'Local rejection is authoritative');
    if (!notFoundRes.success) {
      assertEquals(notFoundRes.error.code, 'ACTION_NOT_FOUND', 'Error code is ACTION_NOT_FOUND');
    }

    // Case B: Action tracked but in DETECTED state (not yet held)
    const action = createSampleAction('act_detected_001');
    controller.register(action, 'Test registered');
    const detectedContext = createSampleStagingContext({ actionId: 'act_detected_001' });

    const detectedRes = await submitApprovalRequest(detectedContext, controller);
    assert(!detectedRes.success, 'Rejects action in DETECTED state');
    assertEquals(detectedRes.outcome, SubmissionOutcome.INVALID_LOCAL_STATE, 'Outcome is INVALID_LOCAL_STATE');
    if (!detectedRes.success) {
      assertEquals(detectedRes.error.code, 'ACTION_NOT_HELD', 'Error code is ACTION_NOT_HELD');
    }

    // Case C: Action tracked but already CONTINUED (terminal state)
    const continuedAction = createSampleAction('act_continued_001');
    controller.register(continuedAction);
    controller.holdAction('act_continued_001');
    controller.continueAction('act_continued_001');
    const continuedContext = createSampleStagingContext({ actionId: 'act_continued_001' });

    const continuedRes = await submitApprovalRequest(continuedContext, controller);
    assert(!continuedRes.success, 'Rejects action in CONTINUED state');
    assertEquals(continuedRes.outcome, SubmissionOutcome.INVALID_LOCAL_STATE, 'Outcome is INVALID_LOCAL_STATE');

    // Case D: Action tracked but already CANCELLED (terminal state)
    const cancelledAction = createSampleAction('act_cancelled_001');
    controller.register(cancelledAction);
    controller.holdAction('act_cancelled_001');
    controller.cancelAction('act_cancelled_001');
    const cancelledContext = createSampleStagingContext({ actionId: 'act_cancelled_001' });

    const cancelledRes = await submitApprovalRequest(cancelledContext, controller);
    assert(!cancelledRes.success, 'Rejects action in CANCELLED state');
    assertEquals(cancelledRes.outcome, SubmissionOutcome.INVALID_LOCAL_STATE, 'Outcome is INVALID_LOCAL_STATE');
  }

  // ---------------------------------------------------------------------------
  // 3. Valid Submission & Continuation Decoupling (201 Created)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 3: Valid Submission & Continuation Decoupling (201 Created)');
  {
    const controller = new InterceptionController();
    const continuationManager = new ContinuationManager();

    const action = createSampleAction('act_payment_001');
    controller.register(action);
    const heldRecord = controller.holdAction('act_payment_001');
    assertEquals(heldRecord.state, InterceptionState.HELD, 'Action successfully held in controller');

    let handlerExecutionCount = 0;
    continuationManager.registerHeldAction(action, heldRecord, () => {
      handlerExecutionCount++;
    });

    const mockServerResponse: ApprovalRequest = {
      id: 'apr_created_123',
      actionId: 'act_payment_001',
      requesterId: 'usr_alice',
      status: ApprovalStatus.PENDING,
      actionDescription: 'Payment trigger: Click on "Confirm Transfer"',
      actionType: ActionType.CLICK,
      category: ActionCategory.PAYMENT,
      riskLevel: RiskLevel.CRITICAL,
      riskScore: 90,
      riskReasons: ['Irreversible payment action'],
      origin: 'https://bank.example.com',
      hostname: 'bank.example.com',
      pageTitle: 'Transfer Confirmation',
      createdAt: '2026-10-19T02:00:00.000Z',
      expiresAt: '2026-10-19T02:15:00.000Z',
    };

    let fetchCalled = false;
    const mockApiClient = new ApprovalApiClient({
      baseUrl: DEFAULT_DEV_API_BASE_URL,
      tokenProvider: () => 'token_alice',
      fetchFn: async () => {
        fetchCalled = true;
        return createMockResponse({ success: true, data: mockServerResponse }, { status: 201 });
      },
    });

    const context = createSampleStagingContext({ actionId: 'act_payment_001' });
    const result = await submitApprovalRequest(context, controller, { apiClient: mockApiClient });

    assert(result.success, 'Submission succeeds');
    assertEquals(result.outcome, SubmissionOutcome.CREATED_PENDING, 'Outcome is CREATED_PENDING');
    assertEquals(result.isAuthoritative, true, 'Creation response is authoritative');
    assert(fetchCalled, 'API client fetch was called');

    if (result.success) {
      assertEquals(result.request.id, 'apr_created_123', 'Returned request ID matches server response');
      assertEquals(result.request.status, ApprovalStatus.PENDING, 'Status is PENDING');
    }

    // CRITICAL ARCHITECTURAL CHECKS: Action remains HELD; handler NEVER executed
    const liveRecord = controller.getRecord('act_payment_001');
    assertEquals(liveRecord?.state, InterceptionState.HELD, 'CRITICAL: Action remains in HELD state');
    assertEquals(handlerExecutionCount, 0, 'CRITICAL: Continuation handler was NOT executed');
  }

  // ---------------------------------------------------------------------------
  // 4. Duplicate Submission & Idempotent Matching (200 OK)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 4: Duplicate Submission & Idempotent Matching (200 OK)');
  {
    const controller = new InterceptionController();
    const action = createSampleAction('act_duplicate_001');
    controller.register(action);
    controller.holdAction('act_duplicate_001');

    const existingPendingRequest: ApprovalRequest = {
      id: 'apr_existing_999',
      actionId: 'act_duplicate_001',
      requesterId: 'usr_alice',
      status: ApprovalStatus.PENDING,
      actionDescription: 'Payment trigger',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.CRITICAL,
      riskReasons: ['Duplicate check'],
      createdAt: '2026-10-19T01:50:00.000Z',
      expiresAt: '2026-10-19T02:05:00.000Z',
    };

    const mockApiClient = new ApprovalApiClient({
      tokenProvider: () => 'token_alice',
      fetchFn: async () => {
        // Return 200 OK to simulate server returning existing active request
        return createMockResponse({ success: true, data: existingPendingRequest }, { status: 200 });
      },
    });

    const context = createSampleStagingContext({ actionId: 'act_duplicate_001' });
    const result = await submitApprovalRequest(context, controller, { apiClient: mockApiClient });

    assert(result.success, 'Duplicate submission succeeds idempotently');
    assertEquals(result.outcome, SubmissionOutcome.ALREADY_PENDING, 'Outcome is ALREADY_PENDING');
    assertEquals(result.isAuthoritative, true, 'Idempotent response is authoritative');
    if (result.success) {
      assertEquals(result.request.id, 'apr_existing_999', 'Returns existing requestId');
    }
    assertEquals(controller.getRecord('act_duplicate_001')?.state, InterceptionState.HELD, 'Action remains HELD');
  }

  // ---------------------------------------------------------------------------
  // 5. Server Rejections (Authoritative Failures)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 5: Server Rejections (Authoritative Failures)');
  {
    const serverErrorScenarios = [
      {
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'Invalid session token',
        expectedOutcome: SubmissionOutcome.UNAUTHENTICATED,
      },
      {
        status: 403,
        code: 'UNAUTHORIZED_ACTION_REQUESTER',
        message: 'Action belongs to another user',
        expectedOutcome: SubmissionOutcome.UNAUTHORIZED,
      },
      {
        status: 409,
        code: 'ALREADY_RESOLVED',
        message: 'Action is already resolved',
        expectedOutcome: SubmissionOutcome.CONFLICT,
      },
      {
        status: 410,
        code: 'REQUEST_EXPIRED',
        message: 'Submission deadline expired',
        expectedOutcome: SubmissionOutcome.EXPIRED,
      },
      {
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Body exceeds 16KB',
        expectedOutcome: SubmissionOutcome.TRANSPORT_REJECTED,
      },
      {
        status: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type must be application/json',
        expectedOutcome: SubmissionOutcome.TRANSPORT_REJECTED,
      },
      {
        status: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit breached',
        expectedOutcome: SubmissionOutcome.TRANSPORT_REJECTED,
      },
      {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid parameters',
        expectedOutcome: SubmissionOutcome.PAYLOAD_INVALID,
      },
    ];

    for (const scenario of serverErrorScenarios) {
      const controller = new InterceptionController();
      const action = createSampleAction(`act_err_${scenario.status}`);
      controller.register(action);
      controller.holdAction(`act_err_${scenario.status}`);

      const mockApiClient = new ApprovalApiClient({
        tokenProvider: () => 'token_test',
        fetchFn: async () =>
          createMockResponse(
            {
              success: false,
              error: {
                code: scenario.code,
                message: scenario.message,
                statusCode: scenario.status,
              },
            },
            { status: scenario.status }
          ),
      });

      const context = createSampleStagingContext({ actionId: `act_err_${scenario.status}` });
      const result = await submitApprovalRequest(context, controller, { apiClient: mockApiClient });

      assert(!result.success, `Fails on HTTP ${scenario.status}`);
      assertEquals(result.outcome, scenario.expectedOutcome, `Outcome matches ${scenario.expectedOutcome}`);
      assertEquals(result.isAuthoritative, true, 'Server rejection is authoritative');
      if (!result.success) {
        assertEquals(result.error.statusCode, scenario.status, 'Status code matches');
      }

      // Invariant: Action remains HELD even on rejection
      assertEquals(
        controller.getRecord(`act_err_${scenario.status}`)?.state,
        InterceptionState.HELD,
        'Action remains HELD on server rejection'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Uncertain Network Outcomes (Timeouts, Socket Drops, 502 HTML)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 6: Uncertain Network Outcomes (Timeouts & Failures)');
  {
    // Case A: Timeout (408 TIMEOUT)
    const timeoutController = new InterceptionController();
    timeoutController.register(createSampleAction('act_timeout_001'));
    timeoutController.holdAction('act_timeout_001');

    const timeoutClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      timeoutMs: 10,
      fetchFn: async (_url, init) => {
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      },
    });

    const timeoutContext = createSampleStagingContext({ actionId: 'act_timeout_001' });
    const timeoutRes = await submitApprovalRequest(timeoutContext, timeoutController, {
      apiClient: timeoutClient,
    });

    assert(!timeoutRes.success, 'Timeout fails cleanly without throwing');
    assertEquals(timeoutRes.outcome, SubmissionOutcome.TIMEOUT_UNCERTAIN, 'Outcome is TIMEOUT_UNCERTAIN');
    assertEquals(timeoutRes.isAuthoritative, false, 'CRITICAL: Timeout outcome is UNCERTAIN (server state unknown)');
    assertEquals(
      timeoutController.getRecord('act_timeout_001')?.state,
      InterceptionState.HELD,
      'Action remains HELD on timeout'
    );

    // Case B: Low-Level Network Socket Failure (TypeError / offline)
    const netController = new InterceptionController();
    netController.register(createSampleAction('act_net_001'));
    netController.holdAction('act_net_001');

    const netClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () => {
        throw new TypeError('Failed to fetch (net::ERR_INTERNET_DISCONNECTED)');
      },
    });

    const netContext = createSampleStagingContext({ actionId: 'act_net_001' });
    const netRes = await submitApprovalRequest(netContext, netController, { apiClient: netClient });

    assert(!netRes.success, 'Network failure fails cleanly');
    assertEquals(
      netRes.outcome,
      SubmissionOutcome.NETWORK_FAILURE_UNCERTAIN,
      'Outcome is NETWORK_FAILURE_UNCERTAIN'
    );
    assertEquals(netRes.isAuthoritative, false, 'CRITICAL: Network failure is UNCERTAIN');
    assertEquals(netController.getRecord('act_net_001')?.state, InterceptionState.HELD, 'Action remains HELD');

    // Case C: Server 502 Bad Gateway HTML Error
    const serverErrController = new InterceptionController();
    serverErrController.register(createSampleAction('act_502_001'));
    serverErrController.holdAction('act_502_001');

    const serverErrClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () =>
        createMockResponse('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
    });

    const serverErrContext = createSampleStagingContext({ actionId: 'act_502_001' });
    const serverErrRes = await submitApprovalRequest(serverErrContext, serverErrController, {
      apiClient: serverErrClient,
    });

    assert(!serverErrRes.success, '502 error handled cleanly');
    assertEquals(serverErrRes.outcome, SubmissionOutcome.SERVER_ERROR, 'Outcome is SERVER_ERROR');
    assertEquals(serverErrRes.isAuthoritative, false, 'CRITICAL: 502 error is UNCERTAIN');
    assertEquals(serverErrController.getRecord('act_502_001')?.state, InterceptionState.HELD, 'Action remains HELD');
  }

  // ---------------------------------------------------------------------------
  // 7. End-to-End Contract Verification: submitApprovalRequest -> Router -> Service
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 7: End-to-End Contract Verification (Submit -> Router)');
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

    // Authorize Alice to own action 'act_alice_e2e_wire'
    actionRegistry.registerActionOwnership('act_alice_e2e_wire', 'usr_alice');

    const router = new ApprovalApiRouter(service, tokenVerifier);

    // Direct in-memory fetch adapter routing into router.dispatch()
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

    const apiClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_alice',
      fetchFn: routerFetchAdapter,
    });

    // Setup client runtime
    const controller = new InterceptionController();
    const continuationManager = new ContinuationManager();

    const action = createSampleAction('act_alice_e2e_wire');
    controller.register(action);
    const heldRecord = controller.holdAction('act_alice_e2e_wire');

    let executed = false;
    continuationManager.registerHeldAction(action, heldRecord, () => {
      executed = true;
    });

    const context = createSampleStagingContext({ actionId: 'act_alice_e2e_wire' });

    // Submit approval request through the end-to-end stack
    const submissionResult = await submitApprovalRequest(context, controller, { apiClient });

    assert(submissionResult.success, 'End-to-end submission succeeds');
    assertEquals(submissionResult.outcome, SubmissionOutcome.CREATED_PENDING, 'Outcome is CREATED_PENDING');
    assertEquals(submissionResult.isAuthoritative, true, 'Result is authoritative');

    if (submissionResult.success) {
      assert(submissionResult.request.id.startsWith('apr_'), 'Request ID has apr_ prefix');
      assertEquals(submissionResult.request.requesterId, 'usr_alice', 'Requester identity derived authoritatively');
      assertEquals(submissionResult.request.status, ApprovalStatus.PENDING, 'Status is PENDING on server');
    }

    // Verify database record
    const serverEntity = repo.findByUserAndAction('usr_alice', 'act_alice_e2e_wire');
    assert(Boolean(serverEntity), 'Server repository contains persisted ApprovalRequest entity');
    assertEquals(serverEntity?.status, ApprovalStatus.PENDING, 'Persisted status is PENDING');

    // Invariants check: Execution decoupled
    assertEquals(controller.getRecord('act_alice_e2e_wire')?.state, InterceptionState.HELD, 'Action remains HELD');
    assertEquals(executed, false, 'ContinuationManager handler was NOT executed');
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n====================================================================');
  console.log(`📊 SUBMISSION OPERATION SUITE: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('🎉 ALL SUBMISSION SPECIFICATIONS & INVARIANTS VERIFIED!');
  } else {
    console.error('❌ SOME TESTS FAILED');
  }
  console.log('====================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('[SubmitOperation Test Runner Exception]', err);
  process.exit(1);
});
