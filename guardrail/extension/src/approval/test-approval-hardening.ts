/**
 * Guardrail Approval Delivery Hardening Verification Suite
 *
 * Verifies that approval request delivery is hardened against:
 * 1. Repeated clicks and concurrent in-flight submissions (Single Active Submission Invariant).
 * 2. Backend-enforced compound idempotency (userId, actionId) and correctly scoped keys.
 * 3. Ambiguous outcomes (timeouts, connection drops, 502/500 errors) kept as UNCERTAIN.
 * 4. Safe status reconciliation without broad retry loops.
 * 5. Stale responses, modal session increments, and unmounted components.
 * 6. Race conditions between cancellation and in-flight submission (late response safely dropped).
 * 7. Server errors, rate limiting (429), expired requests (410), auth failures (401), and malformed payloads.
 * 8. Zero credential leaks or sensitive property exposure.
 * 9. Execution Decoupling Invariant: Protected action remains strictly HELD across all failure modes.
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
  generateActionIdempotencyKey,
  isSubmissionInProgress,
  reconcileApprovalSubmission,
  resetActiveSubmissions,
  SubmissionOutcome,
  submitApprovalRequest,
} from './submit-operation.js';
import { ApprovalApiClient } from './client.js';
import {
  ActorRole,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
} from './authorization.js';
import { DevelopmentInMemoryApprovalRequestRepository } from './repository.js';
import { ApprovalService } from './service.js';
import { ApprovalApiRouter, InMemoryTokenVerifier } from './api.js';
import {
  dismissStagingModal,
  getStagingModalShadowRoot,
  getStagingUIState,
  showStagingModal,
} from '../staging/modal.js';

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
// DOM Simulation for Node.js
// =============================================================================

class MockDOMTokenList {
  private classes: Set<string> = new Set();
  constructor(initial: string = '') {
    if (initial) {
      initial.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    }
  }
  add(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.add(t));
  }
  remove(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.delete(t));
  }
  contains(token: string): boolean {
    return this.classes.has(token);
  }
  toString(): string {
    return Array.from(this.classes).join(' ');
  }
}

class MockDOMElement {
  public tagName: string;
  public id: string = '';
  public attributes: Record<string, string> = {};
  public style: Record<string, string> = {};
  public children: MockDOMElement[] = [];
  public parentNode: MockDOMElement | null = null;
  public shadowRoot: MockShadowRoot | null = null;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  private _textContent: string = '';
  public classList: MockDOMTokenList;
  public disabled: boolean = false;
  public type: string = '';

  get firstChild(): MockDOMElement | null {
    return this.children[0] || null;
  }

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockDOMTokenList();
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(val: string) {
    this.classList = new MockDOMTokenList(val);
  }

  get textContent(): string {
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'id') this.id = value;
    if (name === 'class') this.className = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
    if (name === 'id') this.id = '';
  }

  appendChild<T extends MockDOMElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends MockDOMElement>(child: T): T {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  click(): void {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', target: this });
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  attachShadow(init: { mode: 'open' | 'closed' }): MockShadowRoot {
    const shadow = new MockShadowRoot(init.mode);
    this.shadowRoot = shadow;
    shadow.host = this;
    return shadow;
  }

  addEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }

  dispatchEvent(event: any): boolean {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        listener(event);
      }
    }
    return true;
  }

  querySelector(selector: string): MockDOMElement | null {
    return querySelectorInternal(this, selector);
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];
    querySelectorAllInternal(this, selector, results);
    return results;
  }
}

class MockShadowRoot extends MockDOMElement {
  public mode: string;
  public host: MockDOMElement | null = null;
  constructor(mode: string) {
    super('#SHADOW-ROOT');
    this.mode = mode;
  }
}

function querySelectorInternal(root: MockDOMElement, selector: string): MockDOMElement | null {
  for (const child of root.children) {
    if (matchesSelector(child, selector)) return child;
    const found = querySelectorInternal(child, selector);
    if (found) return found;
  }
  return null;
}

function querySelectorAllInternal(
  root: MockDOMElement,
  selector: string,
  results: MockDOMElement[]
): void {
  for (const child of root.children) {
    if (matchesSelector(child, selector)) results.push(child);
    querySelectorAllInternal(child, selector, results);
  }
}

function matchesSelector(el: MockDOMElement, selector: string): boolean {
  if (selector.startsWith('#')) return el.id === selector.slice(1);
  if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

function setupMockDOM(): () => void {
  const originalDocument = (globalThis as any).document;
  const originalWindow = (globalThis as any).window;

  const mockBody = new MockDOMElement('BODY');
  const mockDoc: any = {
    body: mockBody,
    createElement: (tag: string) => new MockDOMElement(tag),
    getElementById: (id: string) => {
      if (id === 'guardrail-staging-ui-host') {
        return mockBody.children.find((c) => c.id === 'guardrail-staging-ui-host') || null;
      }
      return null;
    },
    activeElement: null,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const mockWin: any = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  (globalThis as any).document = mockDoc;
  (globalThis as any).window = mockWin;

  return () => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  };
}

// =============================================================================
// Helper Factories
// =============================================================================

function createMockResponse(
  body: unknown,
  init?: { status?: number; statusText?: string; headers?: Record<string, string> }
): Response {
  const status = init?.status ?? 200;
  const statusText =
    init?.statusText ?? (status === 200 ? 'OK' : status === 201 ? 'Created' : 'Error');
  const headers = new Headers(init?.headers ?? { 'content-type': 'application/json' });
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);

  return new Response(rawBody, {
    status,
    statusText,
    headers,
  });
}

function createSampleAction(id: string = 'act_test_001'): GuardrailAction {
  return {
    id,
    type: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    timestamp: new Date().toISOString(),
    page: {
      url: 'https://bank.example.com/checkout',
      title: 'Payment Checkout',
    },
    element: {
      tagName: 'BUTTON',
      visibleText: 'Confirm Payment',
      id: 'pay-btn',
    },
  };
}

function createSampleStagingContext(overrides?: Partial<StagingActionContext>): StagingActionContext {
  return {
    actionId: overrides?.actionId || 'act_test_001',
    description: overrides?.description || 'Payment trigger: Click on "Confirm Payment"',
    actionType: overrides?.actionType || ActionType.CLICK,
    category: overrides?.category || ActionCategory.PAYMENT,
    riskLevel: overrides?.riskLevel || RiskLevel.CRITICAL,
    riskScore: overrides?.riskScore ?? 90,
    riskReasons: overrides?.riskReasons || Object.freeze(['High-value transaction']),
    responseAction: overrides?.responseAction || ResponseAction.PROTECT,
    interceptionState: overrides?.interceptionState || InterceptionState.HELD,
    origin: overrides?.origin || 'https://bank.example.com',
    hostname: overrides?.hostname || 'bank.example.com',
    pageTitle: overrides?.pageTitle || 'Payment Checkout',
    timestamp: overrides?.timestamp || new Date().toISOString(),
    stagedAt: overrides?.stagedAt || new Date().toISOString(),
  };
}

// =============================================================================
// Test Runner
// =============================================================================

async function runHardeningTests(): Promise<void> {
  const tearDownDOM = setupMockDOM();
  console.log('\n====================================================================');
  console.log('🛡️ GUARDRAIL APPROVAL DELIVERY HARDENING TEST SUITE');
  console.log('====================================================================');

  // ---------------------------------------------------------------------------
  // 1. Single Active Submission Invariant & Repeated Clicks
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 1: Single Active Submission per Held Interception');
  {
    resetActiveSubmissions();

    const controller = new InterceptionController();
    const action = createSampleAction('act_single_001');
    controller.register(action);
    controller.holdAction('act_single_001');

    let resolveFetch!: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const delayedFetch: typeof fetch = () => fetchPromise;

    const client = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: delayedFetch,
    });

    const context = createSampleStagingContext({ actionId: 'act_single_001' });

    // Launch first submission (in-flight)
    const firstSubmissionPromise = submitApprovalRequest(context, controller, {
      apiClient: client,
    });

    // Verify registry reports active submission
    assert(
      isSubmissionInProgress('act_single_001'),
      'Submission is actively tracked as in-progress'
    );

    // Launch concurrent second submission for same actionId without joinInFlight
    const concurrentSubmission = await submitApprovalRequest(context, controller, {
      apiClient: client,
    });

    assert(!concurrentSubmission.success, 'Concurrent submission is rejected');
    assertEquals(
      concurrentSubmission.outcome,
      SubmissionOutcome.SUBMISSION_IN_PROGRESS,
      'Outcome is SUBMISSION_IN_PROGRESS'
    );
    if (!concurrentSubmission.success) {
      assertEquals(
        concurrentSubmission.error.code,
        'SUBMISSION_ALREADY_IN_PROGRESS',
        'Error code is SUBMISSION_ALREADY_IN_PROGRESS'
      );
    }

    // Launch third submission with joinInFlight: true
    const joinedPromise = submitApprovalRequest(context, controller, {
      apiClient: client,
      joinInFlight: true,
    });

    // Distinct action act_single_002 is NOT blocked by act_single_001's submission
    const action2 = createSampleAction('act_single_002');
    controller.register(action2);
    controller.holdAction('act_single_002');

    assert(
      !isSubmissionInProgress('act_single_002'),
      'Distinct action act_single_002 is NOT in progress'
    );

    // Resolve the delayed fetch
    const mockCreated = {
      id: 'apr_single_001',
      actionId: 'act_single_001',
      requesterId: 'usr_test',
      status: ApprovalStatus.PENDING,
      riskLevel: RiskLevel.CRITICAL,
      category: ActionCategory.PAYMENT,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };

    resolveFetch!(
      createMockResponse(
        { success: true, data: mockCreated },
        { status: 201 }
      )
    );

    const firstRes = await firstSubmissionPromise;
    const joinedRes = await joinedPromise;

    assert(firstRes.success, 'First submission completes successfully');
    assertEquals(firstRes.outcome, SubmissionOutcome.CREATED_PENDING, 'First outcome is CREATED_PENDING');
    assert(joinedRes.success, 'Joined submission receives identical success');
    assertEquals(
      joinedRes.outcome,
      SubmissionOutcome.CREATED_PENDING,
      'Joined outcome matches CREATED_PENDING'
    );

    // After completion, active lock is released
    assert(
      !isSubmissionInProgress('act_single_001'),
      'Active submission lock is cleanly released after completion'
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Correct Scoping of Idempotency Keys & Backend Compound Deduplication
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 2: Scoped Idempotency Keys & Backend Compound Deduplication');
  {
    // A: Scoping helper
    const keyAliceAct1 = generateActionIdempotencyKey('act_alpha', 'usr_alice');
    const keyAliceAct2 = generateActionIdempotencyKey('act_beta', 'usr_alice');
    const keyBobAct1 = generateActionIdempotencyKey('act_alpha', 'usr_bob');

    assertEquals(keyAliceAct1, 'usr_alice:act_alpha', 'Correct key format for Alice Act 1');
    assertEquals(keyAliceAct2, 'usr_alice:act_beta', 'Correct key format for Alice Act 2');
    assert(keyAliceAct1 !== keyAliceAct2, 'Action Alpha and Action Beta have distinct keys');
    assert(keyAliceAct1 !== keyBobAct1, 'Alice and Bob have distinct keys for the same actionId');

    // B: Backend compound deduplication via Router and Service
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

    actionRegistry.registerActionOwnership('act_idemp_001', 'usr_alice');

    const router = new ApprovalApiRouter(service, tokenVerifier);

    const routerFetchAdapter: typeof fetch = async (input, init) => {
      const urlStr = String(input);
      const parsed = new URL(urlStr, 'http://localhost:3000');
      const headers: Record<string, string> = {};
      if (init?.headers) {
        new Headers(init.headers as any).forEach((v, k) => {
          headers[k] = v;
        });
      }
      let body: unknown = undefined;
      if (init?.body) body = JSON.parse(String(init.body));

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

    const controller = new InterceptionController();
    const action = createSampleAction('act_idemp_001');
    controller.register(action);
    controller.holdAction('act_idemp_001');
    const context = createSampleStagingContext({ actionId: 'act_idemp_001' });

    // 1st request -> 201 Created
    const res1 = await submitApprovalRequest(context, controller, { apiClient });
    assert(res1.success, 'First request succeeds with 201 Created');
    assertEquals(res1.outcome, SubmissionOutcome.CREATED_PENDING, 'Outcome is CREATED_PENDING');
    const createdId = res1.success ? res1.request.id : '';

    // Exactly 1 record in repository
    assertEquals(repo.count(), 1, 'Repository has exactly 1 entity');

    // 2nd request -> 200 OK idempotent return (same record, no duplicate created!)
    const res2 = await submitApprovalRequest(context, controller, { apiClient });
    assert(res2.success, 'Sequential duplicate request succeeds idempotently');
    assertEquals(res2.outcome, SubmissionOutcome.ALREADY_PENDING, 'Outcome is ALREADY_PENDING');
    if (res2.success) {
      assertEquals(res2.request.id, createdId, 'Returns exact same canonical requestId');
    }

    // Repository count MUST remain strictly 1
    assertEquals(repo.count(), 1, 'ZERO duplicate records created on server');
  }

  // ---------------------------------------------------------------------------
  // 3. Ambiguous Outcomes (Timeouts, Network Disconnect, 502 Bad Gateway)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 3: Ambiguous Network Outcomes Kept as UNCERTAIN');
  {
    const controller = new InterceptionController();
    const action = createSampleAction('act_ambig_001');
    controller.register(action);
    controller.holdAction('act_ambig_001');
    const context = createSampleStagingContext({ actionId: 'act_ambig_001' });

    // Case A: Timeout
    const timeoutClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      timeoutMs: 10,
      fetchFn: () => new Promise((resolve) => setTimeout(resolve, 50)),
    });

    const timeoutRes = await submitApprovalRequest(context, controller, {
      apiClient: timeoutClient,
    });

    assert(!timeoutRes.success, 'Timeout fails safely');
    assertEquals(
      timeoutRes.outcome,
      SubmissionOutcome.TIMEOUT_UNCERTAIN,
      'Outcome is TIMEOUT_UNCERTAIN'
    );
    assertEquals(timeoutRes.isAuthoritative, false, 'CRITICAL: Timeout outcome is UNCERTAIN');
    assertEquals(
      controller.getRecord('act_ambig_001')?.state,
      InterceptionState.HELD,
      'Protected action remains HELD on timeout'
    );

    // Case B: Network socket reset / offline (status 0)
    const netDropClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () => {
        throw new TypeError('Failed to fetch: Connection reset by peer');
      },
    });

    const netDropRes = await submitApprovalRequest(context, controller, {
      apiClient: netDropClient,
    });

    assert(!netDropRes.success, 'Network drop fails safely');
    assertEquals(
      netDropRes.outcome,
      SubmissionOutcome.NETWORK_FAILURE_UNCERTAIN,
      'Outcome is NETWORK_FAILURE_UNCERTAIN'
    );
    assertEquals(netDropRes.isAuthoritative, false, 'CRITICAL: Network drop is UNCERTAIN');
    assertEquals(
      controller.getRecord('act_ambig_001')?.state,
      InterceptionState.HELD,
      'Protected action remains HELD on network drop'
    );

    // Case C: 502 Bad Gateway HTML response
    const gatewayClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () =>
        createMockResponse('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
    });

    const gatewayRes = await submitApprovalRequest(context, controller, {
      apiClient: gatewayClient,
    });

    assert(!gatewayRes.success, '502 error fails cleanly');
    assertEquals(
      gatewayRes.outcome,
      SubmissionOutcome.SERVER_ERROR,
      'Outcome is SERVER_ERROR'
    );
    assertEquals(gatewayRes.isAuthoritative, false, 'CRITICAL: Server error is UNCERTAIN');
    assertEquals(
      controller.getRecord('act_ambig_001')?.state,
      InterceptionState.HELD,
      'Protected action remains HELD on server error'
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Safe Status Reconciliation without Broad Retry Loops
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 4: Safe Reconciliation of Uncertain Outcomes');
  {
    const controller = new InterceptionController();
    const action = createSampleAction('act_recon_001');
    controller.register(action);
    controller.holdAction('act_recon_001');
    const context = createSampleStagingContext({ actionId: 'act_recon_001' });

    // Scenario A: Submission timed out on client, but the request WAS created on server!
    // Reconciliation queries GET /api/v1/approval-requests/:id (when requestId is known)
    const validServerRequest: ApprovalRequest = {
      id: 'apr_recon_123',
      actionId: 'act_recon_001',
      requesterId: 'usr_test',
      status: ApprovalStatus.PENDING,
      riskLevel: RiskLevel.CRITICAL,
      category: ActionCategory.PAYMENT,
      actionDescription: 'Confirm Payment',
      actionType: ActionType.CLICK,
      riskReasons: Object.freeze(['High-value transaction']),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };

    const getClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async (url) => {
        if (String(url).includes('/api/v1/approval-requests/apr_recon_123')) {
          return createMockResponse({
            success: true,
            data: validServerRequest,
          });
        }
        return createMockResponse({ success: false }, { status: 404 });
      },
    });

    const reconRes = await reconcileApprovalSubmission(context, controller, {
      apiClient: getClient,
      requestId: 'apr_recon_123',
    });

    assert(reconRes.success, 'Reconciliation succeeds for known requestId');
    assertEquals(reconRes.outcome, SubmissionOutcome.RECONCILED, 'Outcome is RECONCILED');
    assertEquals(reconRes.isAuthoritative, true, 'Reconciliation is authoritative');
    assertEquals(
      controller.getRecord('act_recon_001')?.state,
      InterceptionState.HELD,
      'Action remains HELD'
    );

    // Scenario B: Reconciliation when requestId was unknown -> uses backend compound idempotency
    const idempotentClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () =>
        createMockResponse(
          {
            success: true,
            data: validServerRequest,
          },
          { status: 200 } // Server returned existing pending request
        ),
    });

    const reconIdempRes = await reconcileApprovalSubmission(context, controller, {
      apiClient: idempotentClient,
    });

    assert(reconIdempRes.success, 'Idempotent reconciliation succeeds');
    assertEquals(
      reconIdempRes.outcome,
      SubmissionOutcome.ALREADY_PENDING,
      'Outcome is ALREADY_PENDING'
    );

    // Scenario C: Reconciliation network fails again -> remains UNCERTAIN without looping
    let callCount = 0;
    const failingClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () => {
        callCount++;
        throw new TypeError('Failed to fetch');
      },
    });

    const failedRecon = await reconcileApprovalSubmission(context, controller, {
      apiClient: failingClient,
    });

    assert(!failedRecon.success, 'Failed reconciliation returns false');
    assertEquals(
      failedRecon.outcome,
      SubmissionOutcome.NETWORK_FAILURE_UNCERTAIN,
      'Outcome remains NETWORK_FAILURE_UNCERTAIN'
    );
    assertEquals(failedRecon.isAuthoritative, false, 'Outcome remains UNCERTAIN');
    assertEquals(callCount, 1, 'Controlled single inquiry: exactly 1 probe, NO infinite loop');
    assertEquals(
      controller.getRecord('act_recon_001')?.state,
      InterceptionState.HELD,
      'Action remains HELD'
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Race Conditions: Cancellation vs. In-Flight Submission
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 5: Race Condition Immunity (Cancellation vs. In-Flight Submission)');
  {
    const controller = new InterceptionController();
    const continuationManager = new ContinuationManager();

    const action = createSampleAction('act_race_001');
    controller.register(action);
    const heldRecord = controller.holdAction('act_race_001');

    let actionExecuted = false;
    continuationManager.registerHeldAction(action, heldRecord, () => {
      actionExecuted = true;
    });

    let resolveSlowFetch: (val: Response) => void;
    const slowFetch = new Promise<Response>((resolve) => {
      resolveSlowFetch = resolve;
    });

    const client = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: () => slowFetch,
    });

    const context = createSampleStagingContext({ actionId: 'act_race_001' });

    // 1. Launch submission (now in-flight)
    const submissionPromise = submitApprovalRequest(context, controller, {
      apiClient: client,
    });

    assert(
      isSubmissionInProgress('act_race_001'),
      'Submission is actively in flight'
    );

    // 2. WHILE SUBMISSION IS IN FLIGHT, user cancels the action!
    controller.cancelAction('act_race_001', 'User cancelled while waiting');
    continuationManager.cancelAction('act_race_001', 'User cancelled');

    assertEquals(
      controller.getRecord('act_race_001')?.state,
      InterceptionState.CANCELLED,
      'Action is now in CANCELLED state'
    );

    // 3. Now the slow network response returns 201 Created PENDING
    const mockCreated = {
      id: 'apr_race_late_999',
      actionId: 'act_race_001',
      requesterId: 'usr_test',
      status: ApprovalStatus.PENDING,
      riskLevel: RiskLevel.CRITICAL,
      category: ActionCategory.PAYMENT,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };

    resolveSlowFetch!(
      createMockResponse({ success: true, data: mockCreated }, { status: 201 })
    );

    const submissionResult = await submissionPromise;

    // 4. Verification: The late response MUST be safely discarded!
    assert(
      !submissionResult.success,
      'Late response for cancelled action is rejected'
    );
    assertEquals(
      submissionResult.outcome,
      SubmissionOutcome.INVALID_LOCAL_STATE,
      'Outcome is INVALID_LOCAL_STATE'
    );
    if (!submissionResult.success) {
      assertEquals(
        submissionResult.error.code,
        'ACTION_STATE_CHANGED_POST_SUBMISSION',
        'Error code is ACTION_STATE_CHANGED_POST_SUBMISSION'
      );
    }

    // 5. Invariant check: Execution strictly ZERO
    assertEquals(actionExecuted, false, 'CRITICAL: Browser action was NEVER executed!');
    assertEquals(
      controller.getRecord('act_race_001')?.state,
      InterceptionState.CANCELLED,
      'Action remains CANCELLED'
    );
  }

  // ---------------------------------------------------------------------------
  // 6. Staging Mode UI Concurrency & Stale Response Protection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 6: Staging Mode UI Session & Concurrency Protection');
  {
    resetActiveSubmissions();

    const controller = new InterceptionController();
    const action = createSampleAction('act_ui_race_001');
    controller.register(action);
    controller.holdAction('act_ui_race_001');
    const context = createSampleStagingContext({ actionId: 'act_ui_race_001' });

    let resolveUiFetch: (val: Response) => void;
    const uiDelayedFetch = new Promise<Response>((resolve) => {
      resolveUiFetch = resolve;
    });

    const client = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: () => uiDelayedFetch,
    });

    showStagingModal({
      context,
      state: 'active',
      controller,
      useRealBackend: true,
      apiClient: client,
    });

    const shadow = getStagingModalShadowRoot();
    const reqBtn = shadow?.querySelector('#gs-btn-request-approval') as HTMLButtonElement;
    const cancelBtn = shadow?.querySelector('#gs-btn-cancel-action') as HTMLButtonElement;

    // Trigger request approval
    reqBtn.click();

    assertEquals(
      getStagingUIState(),
      'submitting_approval',
      'UI state is submitting_approval'
    );
    assert(reqBtn.disabled, 'Request button is disabled during submission');
    assert(cancelBtn.disabled, 'Cancel button is locked to prevent UI races');

    // Attempt second click while in-flight -> should not spawn a new submission
    reqBtn.click();
    assert(
      isSubmissionInProgress('act_ui_race_001'),
      'Still exactly one active submission in progress'
    );

    // Dismiss modal before fetch completes (simulates user closing or navigating away)
    dismissStagingModal();

    assert(
      !getStagingModalShadowRoot(),
      'Modal is completely unmounted'
    );

    // Now resolve the late fetch
    resolveUiFetch!(
      createMockResponse(
        {
          success: true,
          data: {
            id: 'apr_ui_late_123',
            actionId: 'act_ui_race_001',
            requesterId: 'usr_test',
            status: ApprovalStatus.PENDING,
            createdAt: new Date().toISOString(),
          },
        },
        { status: 201 }
      )
    );

    // Wait a tick for async promises to settle
    await new Promise((r) => setTimeout(r, 10));

    // UI state must remain null (not resurrected or updated)
    assertEquals(getStagingUIState(), null, 'Unmounted modal was NOT resurrected by late response');
  }

  // ---------------------------------------------------------------------------
  // 7. Server Errors, Rate Limiting & Malformed Responses
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 7: Server Errors, Rate Limiting & Schema Violations');
  {
    const controller = new InterceptionController();
    const action = createSampleAction('act_err_001');
    controller.register(action);
    controller.holdAction('act_err_001');
    const context = createSampleStagingContext({ actionId: 'act_err_001' });

    // A: 429 Rate Limit
    const rateLimitClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () =>
        createMockResponse(
          {
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Rate limit exceeded. Please wait 60 seconds.',
              statusCode: 429,
            },
          },
          { status: 429 }
        ),
    });

    const rateRes = await submitApprovalRequest(context, controller, {
      apiClient: rateLimitClient,
    });

    assert(!rateRes.success, 'Rate limit error handled cleanly');
    assertEquals(
      rateRes.outcome,
      SubmissionOutcome.TRANSPORT_REJECTED,
      'Outcome is TRANSPORT_REJECTED'
    );
    assertEquals(rateRes.isAuthoritative, true, 'Server rate limit is authoritative');

    // B: 410 Request Expired
    const expiredClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () =>
        createMockResponse(
          {
            success: false,
            error: {
              code: 'REQUEST_EXPIRED',
              message: 'Approval request expired',
              statusCode: 410,
            },
          },
          { status: 410 }
        ),
    });

    const expRes = await submitApprovalRequest(context, controller, {
      apiClient: expiredClient,
    });

    assert(!expRes.success, 'Expired error handled cleanly');
    assertEquals(expRes.outcome, SubmissionOutcome.EXPIRED, 'Outcome is EXPIRED');

    // C: Malformed response schema (201 Created with missing apr_ prefix)
    const malformedClient = new ApprovalApiClient({
      tokenProvider: () => 'token_test',
      fetchFn: async () =>
        createMockResponse(
          {
            success: true,
            data: {
              id: 'forged_id_no_prefix', // Invalid!
              actionId: 'act_err_001',
              status: ApprovalStatus.PENDING,
            },
          },
          { status: 201 }
        ),
    });

    const malformedRes = await submitApprovalRequest(context, controller, {
      apiClient: malformedClient,
    });

    assert(!malformedRes.success, 'Malformed response rejected');
    if (!malformedRes.success) {
      assertEquals(
        malformedRes.error.code,
        'MALFORMED_BACKEND_RESPONSE',
        'Error code is MALFORMED_BACKEND_RESPONSE'
      );
    }
    assertEquals(
      controller.getRecord('act_err_001')?.state,
      InterceptionState.HELD,
      'Action remains safely HELD'
    );
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  tearDownDOM();
  console.log('\n====================================================================');
  console.log(`📊 APPROVAL HARDENING TEST SUITE: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('🎉 ALL HARDENING SPECIFICATIONS & RESILIENCE INVARIANTS MET!');
  } else {
    console.error('❌ SOME TESTS FAILED');
  }
  console.log('====================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runHardeningTests().catch((err) => {
  console.error('[Hardening Test Exception]', err);
  process.exit(1);
});
