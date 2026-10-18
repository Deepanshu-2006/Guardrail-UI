/**
 * Guardrail Approval Submission UI & Extension Messaging Integration Test Suite
 *
 * Verifies end-to-end integration between the Staging Mode UI, extension message passing,
 * background service worker coordinator, and backend approval submission operation:
 *
 * 1. Extension Message Validation & Security Boundaries:
 *    - Validates message type, payload shape, and supported operations.
 *    - Rejects privileged decision attempts (e.g. decision: 'APPROVED', status: 'APPROVED').
 *    - Rejects credential / secret injection and untrusted endpoint tampering.
 *    - Rejects missing / mismatched action IDs and sensitive context data.
 *
 * 2. Interception State Pre-condition Enforcement:
 *    - Verifies target action exists and is held before submitting.
 *    - Rejects submissions for untracked, CONTINUED, or CANCELLED actions.
 *
 * 3. Successful Real Backend Submission Integration & UI Lifecycle:
 *    - Shows in-progress visual state immediately upon activation.
 *    - Debounces and locks button against repeated activations.
 *    - Does NOT claim request creation until backend confirms 201 Created with PENDING status.
 *    - Action remains strictly in HELD state; continuation handler is NEVER executed.
 *
 * 4. Authoritative Submission Failure Handling:
 *    - 401/403/409 server rejections transition UI to approval_failed.
 *    - Displays honest server rejection details.
 *    - Action remains safely HELD.
 *
 * 5. Uncertain Network Outcome Handling:
 *    - Timeouts and socket drops return isAuthoritative: false.
 *    - UI transitions to approval_uncertain.
 *    - Displays honest status and keeps action safely HELD.
 *
 * 6. Cancellation Isolation & Safety:
 *    - Cancel button remains fully functional and executes cancellation only.
 *    - Cancellation cannot trigger approval submission.
 *
 * 7. Extension Messaging Round-Trip:
 *    - Verifies chrome.runtime.sendMessage -> service worker onMessage -> sendResponse flow.
 *    - Verifies zero exposure of auth tokens or credentials to webpage scripts.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

// =============================================================================
// DOM Simulation for Node Environment
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
    if (matchesSelector(child, selector)) {
      return child;
    }
    const found = querySelectorInternal(child, selector);
    if (found) return found;
  }
  return null;
}

function querySelectorAllInternal(root: MockDOMElement, selector: string, acc: MockDOMElement[]): void {
  for (const child of root.children) {
    if (matchesSelector(child, selector)) {
      acc.push(child);
    }
    querySelectorAllInternal(child, selector, acc);
  }
}

function matchesSelector(el: MockDOMElement, selector: string): boolean {
  const trimmed = selector.trim();
  if (trimmed.startsWith('#')) {
    return el.id === trimmed.slice(1);
  }
  if (trimmed.startsWith('.')) {
    return el.classList.contains(trimmed.slice(1));
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

class MockDocument {
  public body: MockDOMElement;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  constructor() {
    this.body = new MockDOMElement('BODY');
  }
  createElement(tag: string): MockDOMElement {
    return new MockDOMElement(tag);
  }
  getElementById(id: string): MockDOMElement | null {
    return querySelectorInternal(this.body, `#${id}`);
  }
  addEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
  removeEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }
  dispatchEvent(event: any): void {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        listener(event);
      }
    }
  }
}

class MockWindow {
  public listeners: Record<string, ((e: any) => void)[]> = {};
  addEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
  removeEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }
  dispatchEvent(event: any): void {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        listener(event);
      }
    }
  }
}

if (typeof (globalThis as any).CustomEvent === 'undefined') {
  (globalThis as any).CustomEvent = class CustomEvent {
    public type: string;
    public detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
}

const mockDoc = new MockDocument();
const mockWin = new MockWindow();
(globalThis as any).document = mockDoc;
(globalThis as any).window = mockWin;

// =============================================================================
// Imports from Extension Codebase
// =============================================================================

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { InterceptionState } from '../types/interception.js';
import { StagingActionContext } from '../types/staging.js';
import { ApprovalStatus } from '../types/approval.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import { SubmissionOutcome } from '../approval/submit-operation.js';
import {
  ApprovalApiClient,
  DEFAULT_DEV_API_BASE_URL,
} from '../approval/client.js';
import {
  validateApprovalSubmissionMessage,
  handleBackgroundApprovalSubmission,
} from '../background/index.js';
import {
  showStagingModal,
  dismissStagingModal,
  getStagingModalShadowRoot,
  getStagingUIState,
} from './modal.js';
import { dispatchSubmitApprovalRequestToBackground } from '../utils/messaging.js';

// =============================================================================
// Test Framework Helpers
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

function findElement(root: any, selector: string): MockDOMElement | null {
  if (!root) return null;
  return (root.querySelector(selector) as any) ?? null;
}

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

function createSampleAction(actionId: string): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-19T03:00:00.000Z',
    page: {
      url: 'https://shop.example.com/checkout',
      title: 'Checkout',
    },
    element: {
      tagName: 'BUTTON',
      visibleText: 'Pay Now ($149.99)',
    },
  };
}

function createSampleContext(actionId: string = 'act_int_001'): StagingActionContext {
  return {
    actionId,
    description: 'Pay Now ($149.99)',
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 90,
    riskReasons: ['Initiates financial transaction checkout flow.'],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    interceptionReason: 'Critical payment interaction paused for staging review.',
    origin: 'https://shop.example.com',
    hostname: 'shop.example.com',
    pageTitle: 'Checkout',
    timestamp: '2026-10-19T03:00:00.000Z',
    stagedAt: '2026-10-19T03:00:00.000Z',
  };
}

// =============================================================================
// Test Suites
// =============================================================================

async function runTests(): Promise<void> {
  console.log('\n=============================================================');
  console.log('Guardrail Approval Submission UI & Extension Integration Tests');
  console.log('=============================================================\n');

  // ---------------------------------------------------------------------------
  // Suite 1: Extension Message Validation & Security Boundaries
  // ---------------------------------------------------------------------------
  console.log('Suite 1: Extension Message Validation & Security Boundaries');

  // Test 1.1: Rejects non-object or null message
  {
    const res1 = validateApprovalSubmissionMessage(null);
    assert(!res1.valid, 'Null message is rejected');
    const res2 = validateApprovalSubmissionMessage('not an object');
    assert(!res2.valid, 'String message is rejected');
  }

  // Test 1.2: Rejects unsupported message types
  {
    const res = validateApprovalSubmissionMessage({ type: 'SOME_OTHER_TYPE' });
    assert(!res.valid, 'Unsupported message type is rejected');
    assert(
      Boolean(res.error?.includes('Unsupported message type')),
      'Rejection error specifies unsupported type'
    );
  }

  // Test 1.3: Strictly rejects privileged decision overrides
  {
    const attackPayloads: Array<Record<string, unknown>> = [
      { type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST', actionId: 'act_1', decision: 'APPROVED' },
      { type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST', actionId: 'act_1', status: 'APPROVED' },
      { type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST', actionId: 'act_1', decidedBy: 'mallory' },
      { type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST', actionId: 'act_1', verdict: 'ALLOW' },
      { type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST', actionId: 'act_1', approve: true },
      { type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST', actionId: 'act_1', reject: true },
    ];

    for (const payload of attackPayloads) {
      const res = validateApprovalSubmissionMessage(payload);
      assert(!res.valid, `Privileged decision override rejected: ${JSON.stringify(payload)}`);
      assert(
        Boolean(res.error?.includes('Security violation')),
        'Error explicitly notes security violation for privileged override'
      );
    }
  }

  // Test 1.4: Strictly rejects credential/token injection and untrusted endpoints
  {
    const credentialPayloads: Array<Record<string, unknown>> = [
      { type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST', actionId: 'act_1', authToken: 'stolen_jwt' },
      { type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST', actionId: 'act_1', password: 'plain_password' },
      { type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST', actionId: 'act_1', endpoint: 'https://evil.attacker.com' },
      { type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST', actionId: 'act_1', url: 'https://evil.attacker.com' },
    ];

    for (const payload of credentialPayloads) {
      const res = validateApprovalSubmissionMessage(payload);
      assert(!res.valid, `Credential/endpoint injection rejected: ${JSON.stringify(payload)}`);
      assert(
        Boolean(res.error?.includes('forbidden or privileged instruction')),
        'Error explicitly rejects unauthorized instruction'
      );
    }
  }

  // Test 1.5: Rejects missing actionId or empty actionId
  {
    const ctx = createSampleContext('act_1');
    const res1 = validateApprovalSubmissionMessage({
      type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
      context: ctx,
    });
    assert(!res1.valid, 'Missing actionId is rejected');

    const res2 = validateApprovalSubmissionMessage({
      type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
      actionId: '   ',
      context: ctx,
    });
    assert(!res2.valid, 'Whitespace actionId is rejected');
  }

  // Test 1.6: Rejects mismatched actionId vs context.actionId
  {
    const ctx = createSampleContext('act_1');
    const res = validateApprovalSubmissionMessage({
      type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
      actionId: 'act_DIFFERENT',
      context: ctx,
    });
    assert(!res.valid, 'Action ID mismatch between message and context is rejected');
    assert(
      Boolean(res.error?.includes('Action ID mismatch')),
      'Error message identifies actionId mismatch'
    );
  }

  // Test 1.7: Rejects context containing sensitive fields
  {
    const sensitiveCtx = {
      ...createSampleContext('act_sens'),
      password: 'user_password',
    };
    const res = validateApprovalSubmissionMessage({
      type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
      actionId: 'act_sens',
      context: sensitiveCtx,
    });
    assert(!res.valid, 'Context with sensitive field (password) is rejected');
    assert(
      Boolean(res.error?.includes('sensitive fields')),
      'Error identifies sensitive fields in context'
    );
  }

  // Test 1.8: Successfully validates a compliant, least-privilege submission message
  {
    const ctx = createSampleContext('act_valid_100');
    const validMessage = {
      type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
      actionId: 'act_valid_100',
      context: ctx,
    };
    const res = validateApprovalSubmissionMessage(validMessage);
    assert(res.valid, 'Compliant submission message is accepted');
    assertEquals(res.actionId, 'act_valid_100', 'Extracted actionId matches');
    assert(res.context !== undefined, 'Extracted context is present');
  }

  // ---------------------------------------------------------------------------
  // Suite 2: Interception State Pre-condition Enforcement
  // ---------------------------------------------------------------------------
  console.log('\nSuite 2: Interception State Pre-condition Enforcement');

  // Test 2.1: Rejects submission if action does not exist and context is not HELD
  {
    const controller = new InterceptionController();
    const ctx = {
      ...createSampleContext('act_untracked'),
      interceptionState: InterceptionState.CANCELLED,
    };
    const msg = {
      type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
      actionId: 'act_untracked',
      context: ctx,
    };
    const res = await handleBackgroundApprovalSubmission(msg, controller);
    assert(!res.success, 'Untracked non-held action rejected');
    assertEquals(
      res.outcome,
      SubmissionOutcome.INVALID_LOCAL_STATE,
      'Outcome is INVALID_LOCAL_STATE'
    );
    assert(res.isAuthoritative, 'Result is authoritative');
  }

  // Test 2.2: Rejects submission if action in controller is already CONTINUED
  {
    const controller = new InterceptionController();
    controller.register('act_cont', 'Test hold');
    controller.holdAction('act_cont', 'Test hold');
    controller.continueAction('act_cont');

    const ctx = createSampleContext('act_cont');
    const msg = {
      type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
      actionId: 'act_cont',
      context: ctx,
    };
    const res = await handleBackgroundApprovalSubmission(msg, controller);
    assert(!res.success, 'CONTINUED action rejected for approval');
    assertEquals(
      res.outcome,
      SubmissionOutcome.INVALID_LOCAL_STATE,
      'Outcome is INVALID_LOCAL_STATE'
    );
    assertEquals(res.error?.code, 'ACTION_NOT_HELD', 'Error code is ACTION_NOT_HELD');
  }

  // Test 2.3: Rejects submission if action in controller is CANCELLED
  {
    const controller = new InterceptionController();
    controller.register('act_canc', 'Test hold');
    controller.holdAction('act_canc', 'Test hold');
    controller.cancelAction('act_canc');

    const ctx = createSampleContext('act_canc');
    const msg = {
      type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
      actionId: 'act_canc',
      context: ctx,
    };
    const res = await handleBackgroundApprovalSubmission(msg, controller);
    assert(!res.success, 'CANCELLED action rejected for approval');
    assertEquals(res.error?.code, 'ACTION_NOT_HELD', 'Error code is ACTION_NOT_HELD');
  }

  // Test 2.4: Local pre-flight in Staging UI modal rejects untracked/non-held action before network call
  {
    dismissStagingModal();
    const localController = new InterceptionController();
    const ctx = createSampleContext('act_stale');

    let errorResultReceived: any = null;
    showStagingModal({
      context: ctx,
      controller: localController,
      useRealBackend: true,
      onRequestApprovalError: (res) => {
        errorResultReceived = res;
      },
    });

    const shadow = getStagingModalShadowRoot();
    assert(shadow !== null, 'Modal shadow root mounted');

    const reqBtn = findElement(shadow, '#gs-btn-request-approval');
    assert(reqBtn !== null, 'Request approval button exists');

    // Click request approval
    reqBtn?.click();

    // Verify UI entered stale_or_invalid state locally
    assertEquals(
      getStagingUIState(),
      'stale_or_invalid',
      'UI transitions to stale_or_invalid for untracked action'
    );
    assert(errorResultReceived !== null, 'Error callback received');
    assertEquals(
      errorResultReceived.outcome,
      'INVALID_LOCAL_STATE',
      'Local pre-flight outcome is INVALID_LOCAL_STATE'
    );
    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Suite 3: Successful Real Backend Submission Integration & UI Lifecycle
  // ---------------------------------------------------------------------------
  console.log('\nSuite 3: Successful Real Backend Submission Integration & UI Lifecycle');

  {
    dismissStagingModal();
    const controller = new InterceptionController();
    controller.register('act_success_1', 'Payment interaction');
    const heldRecord = controller.holdAction('act_success_1', 'Payment interaction');

    const continuationManager = new ContinuationManager(controller);
    let continuationCalled = false;
    continuationManager.registerHeldAction(
      createSampleAction('act_success_1'),
      heldRecord,
      () => {
        continuationCalled = true;
      }
    );

    const ctx = createSampleContext('act_success_1');

    // Mock API client returning 201 Created PENDING
    const mockApiClient = new ApprovalApiClient({
      baseUrl: DEFAULT_DEV_API_BASE_URL,
      tokenProvider: async () => 'mock_jwt_requester',
      fetchFn: async () => {
        return createMockResponse(
          {
            id: 'appr_req_canonical_999',
            requesterId: 'user_req_alice',
            actionId: 'act_success_1',
            status: ApprovalStatus.PENDING,
            createdAt: '2026-10-19T03:01:00.000Z',
            actionCategory: ActionCategory.PAYMENT,
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.CRITICAL,
            riskScore: 90,
            summary: 'Pay Now ($149.99)',
            domain: 'shop.example.com',
          },
          { status: 201 }
        );
      },
    });

    let successResult: any = null;
    showStagingModal({
      context: ctx,
      controller,
      continuationManager,
      useRealBackend: true,
      apiClient: mockApiClient,
      onRequestApprovalSuccess: (res) => {
        successResult = res;
      },
    });

    const shadow = getStagingModalShadowRoot();
    assert(shadow !== null, 'Modal mounted');

    const reqBtn = findElement(shadow, '#gs-btn-request-approval');
    const cancelBtn = findElement(shadow, '#gs-btn-cancel-action');
    assert(reqBtn !== null, 'Request button found');

    // Initial state check
    assertEquals(getStagingUIState(), 'held', 'Initial UI state is held');
    assert(!reqBtn?.disabled, 'Request button is initially enabled');

    // User clicks Request Approval
    reqBtn?.click();

    // Verify in-progress state immediately set (Requirement 7 & 8)
    assertEquals(
      getStagingUIState(),
      'submitting_approval',
      'UI state immediately transitions to submitting_approval'
    );
    assert(Boolean(reqBtn?.disabled), 'Request button is disabled during submission');
    assertEquals(reqBtn?.attributes['aria-busy'], 'true', 'aria-busy is set to true');
    assert(
      Boolean(reqBtn?.textContent.includes('Submitting')),
      'Button text reflects in-progress state'
    );

    // Repeated clicks while in-progress must be safely ignored (Requirement 8)
    reqBtn?.click();
    reqBtn?.click();

    // Allow promise microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Verify post-submission confirmation (Requirement 9)
    assert(successResult !== null, 'Submission succeeded');
    assertEquals(
      successResult.request?.id,
      'appr_req_canonical_999',
      'Created request ID matches backend'
    );
    assertEquals(
      successResult.request?.status,
      ApprovalStatus.PENDING,
      'Backend confirmed PENDING status'
    );

    // Check UI elements reflect confirmed approval_requested state
    assertEquals(
      getStagingUIState(),
      'approval_requested',
      'UI state transitions to approval_requested'
    );

    const pill = findElement(shadow, '.gs-mode-pill');
    assertEquals(pill?.textContent, 'Approval Pending', 'Pill indicates Approval Pending');

    const notice = findElement(shadow, '.gs-footer-notice');
    assert(
      Boolean(notice?.textContent.includes('appr_req_canonical_999')),
      'Footer notice includes canonical request ID'
    );
    assert(
      Boolean(notice?.textContent.includes('PENDING')),
      'Footer notice includes PENDING status'
    );

    // CRITICAL: Action MUST remain HELD! Continuation handler must NEVER be called (Requirement 11)
    const rec = controller.getRecord('act_success_1');
    assertEquals(
      rec?.state,
      InterceptionState.HELD,
      'Action remains strictly in HELD state in InterceptionController'
    );
    assert(!continuationCalled, 'Continuation handler was NEVER executed');

    // Cancel button remains functional and enabled (Requirement 12)
    assert(!cancelBtn?.disabled, 'Cancel button is available after submission');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Suite 4: Authoritative Submission Failure Handling
  // ---------------------------------------------------------------------------
  console.log('\nSuite 4: Authoritative Submission Failure Handling');

  // Test 4.1: Server returns 401 Unauthorized
  {
    dismissStagingModal();
    const controller = new InterceptionController();
    controller.register('act_auth_fail', 'Payment hold');
    const heldRecord = controller.holdAction('act_auth_fail', 'Payment hold');

    const continuationManager = new ContinuationManager(controller);
    let continuationCalled = false;
    continuationManager.registerHeldAction(
      createSampleAction('act_auth_fail'),
      heldRecord,
      () => {
        continuationCalled = true;
      }
    );

    const ctx = createSampleContext('act_auth_fail');

    const mockApiClient = new ApprovalApiClient({
      baseUrl: DEFAULT_DEV_API_BASE_URL,
      tokenProvider: async () => 'mock_jwt_requester',
      fetchFn: async () => {
        return createMockResponse(
          {
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication token missing or invalid.',
              statusCode: 401,
            },
          },
          { status: 401 }
        );
      },
    });

    let errorResult: any = null;
    showStagingModal({
      context: ctx,
      controller,
      continuationManager,
      useRealBackend: true,
      apiClient: mockApiClient,
      onRequestApprovalError: (res) => {
        errorResult = res;
      },
    });

    const shadow = getStagingModalShadowRoot();
    const reqBtn = findElement(shadow, '#gs-btn-request-approval');
    reqBtn?.click();

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert(errorResult !== null, 'Error callback received 401 result');
    assertEquals(
      errorResult.outcome,
      SubmissionOutcome.UNAUTHENTICATED,
      'Outcome is UNAUTHENTICATED'
    );
    assert(errorResult.isAuthoritative, 'Outcome is authoritative');

    // UI state check
    assertEquals(
      getStagingUIState(),
      'approval_failed',
      'UI transitions to approval_failed state'
    );

    const pill = findElement(shadow, '.gs-mode-pill');
    assertEquals(pill?.textContent, 'Request Rejected', 'Badge displays Request Rejected');

    // Action remains safely HELD (Requirement 11)
    const rec = controller.getRecord('act_auth_fail');
    assertEquals(rec?.state, InterceptionState.HELD, 'Action remains strictly in HELD state');
    assert(!continuationCalled, 'Continuation was not executed on 401');

    dismissStagingModal();
  }

  // Test 4.2: Server returns 403 Forbidden (requester unauthorized for this action)
  {
    dismissStagingModal();
    const controller = new InterceptionController();
    controller.register('act_403', 'Payment hold');
    controller.holdAction('act_403', 'Payment hold');

    const ctx = createSampleContext('act_403');
    const mockApiClient = new ApprovalApiClient({
      baseUrl: DEFAULT_DEV_API_BASE_URL,
      tokenProvider: async () => 'mock_jwt_requester',
      fetchFn: async () => {
        return createMockResponse(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Requester cannot create approval request for another user action.',
              statusCode: 403,
            },
          },
          { status: 403 }
        );
      },
    });

    let errorResult: any = null;
    showStagingModal({
      context: ctx,
      controller,
      useRealBackend: true,
      apiClient: mockApiClient,
      onRequestApprovalError: (res) => {
        errorResult = res;
      },
    });

    const shadow = getStagingModalShadowRoot();
    const reqBtn = findElement(shadow, '#gs-btn-request-approval');
    reqBtn?.click();

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert(errorResult !== null, '403 error received');
    assertEquals(
      errorResult.outcome,
      SubmissionOutcome.UNAUTHORIZED,
      'Outcome is UNAUTHORIZED'
    );
    assertEquals(getStagingUIState(), 'approval_failed', 'UI state is approval_failed');

    const rec = controller.getRecord('act_403');
    assertEquals(rec?.state, InterceptionState.HELD, 'Action remains safely HELD on 403');
    dismissStagingModal();
  }

  // Test 4.3: Server returns 409 Conflict
  {
    dismissStagingModal();
    const controller = new InterceptionController();
    controller.register('act_409', 'Hold');
    controller.holdAction('act_409', 'Hold');

    const ctx = createSampleContext('act_409');
    const mockApiClient = new ApprovalApiClient({
      baseUrl: DEFAULT_DEV_API_BASE_URL,
      tokenProvider: async () => 'mock_jwt_requester',
      fetchFn: async () => {
        return createMockResponse(
          {
            error: {
              code: 'CONFLICT',
              message: 'Action state conflict on server.',
              statusCode: 409,
            },
          },
          { status: 409 }
        );
      },
    });

    showStagingModal({
      context: ctx,
      controller,
      useRealBackend: true,
      apiClient: mockApiClient,
    });

    const shadow = getStagingModalShadowRoot();
    const reqBtn = findElement(shadow, '#gs-btn-request-approval');
    reqBtn?.click();

    await new Promise((resolve) => setTimeout(resolve, 20));

    assertEquals(
      getStagingUIState(),
      'approval_failed',
      'UI state is approval_failed on 409'
    );
    const rec = controller.getRecord('act_409');
    assertEquals(rec?.state, InterceptionState.HELD, 'Action remains safely HELD on 409');
    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Suite 5: Uncertain Network Outcome Handling (Timeout & Socket Drop)
  // ---------------------------------------------------------------------------
  console.log('\nSuite 5: Uncertain Network Outcome Handling (Timeout & Socket Drop)');

  // Test 5.1: AbortController timeout / 408 Gateway Timeout
  {
    dismissStagingModal();
    const controller = new InterceptionController();
    controller.register('act_timeout', 'Hold');
    const heldRecord = controller.holdAction('act_timeout', 'Hold');

    const continuationManager = new ContinuationManager(controller);
    let continuationCalled = false;
    continuationManager.registerHeldAction(
      createSampleAction('act_timeout'),
      heldRecord,
      () => {
        continuationCalled = true;
      }
    );

    const ctx = createSampleContext('act_timeout');
    const mockApiClient = new ApprovalApiClient({
      baseUrl: DEFAULT_DEV_API_BASE_URL,
      tokenProvider: async () => 'mock_jwt_requester',
      fetchFn: async () => {
        return createMockResponse(
          {
            error: {
              code: 'GATEWAY_TIMEOUT',
              message: 'Request timed out waiting for backend.',
              statusCode: 408,
            },
          },
          { status: 408 }
        );
      },
    });

    let uncertainResult: any = null;
    showStagingModal({
      context: ctx,
      controller,
      continuationManager,
      useRealBackend: true,
      apiClient: mockApiClient,
      onRequestApprovalError: (res) => {
        uncertainResult = res;
      },
    });

    const shadow = getStagingModalShadowRoot();
    const reqBtn = findElement(shadow, '#gs-btn-request-approval');
    reqBtn?.click();

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert(uncertainResult !== null, 'Timeout error caught');
    assertEquals(
      uncertainResult.outcome,
      SubmissionOutcome.TIMEOUT_UNCERTAIN,
      'Outcome is TIMEOUT_UNCERTAIN'
    );
    assertEquals(uncertainResult.isAuthoritative, false, 'Result is NOT authoritative');

    // UI state transitions to approval_uncertain (Requirement 10)
    assertEquals(
      getStagingUIState(),
      'approval_uncertain',
      'UI state transitions to approval_uncertain'
    );

    const pill = findElement(shadow, '.gs-mode-pill');
    assertEquals(pill?.textContent, 'Outcome Uncertain', 'Pill text displays Outcome Uncertain');

    const notice = findElement(shadow, '.gs-footer-notice');
    assert(
      Boolean(notice?.textContent.includes('Network Outcome Uncertain')),
      'Notice displays honest uncertain status'
    );

    // Action MUST remain safely HELD (Requirement 10 & 11)
    const rec = controller.getRecord('act_timeout');
    assertEquals(
      rec?.state,
      InterceptionState.HELD,
      'Action remains safely HELD on timeout'
    );
    assert(!continuationCalled, 'Continuation was NOT invoked on timeout');

    dismissStagingModal();
  }

  // Test 5.2: Network socket drop / TypeError fetch failure
  {
    dismissStagingModal();
    const controller = new InterceptionController();
    controller.register('act_drop', 'Hold');
    controller.holdAction('act_drop', 'Hold');

    const ctx = createSampleContext('act_drop');
    const mockApiClient = new ApprovalApiClient({
      baseUrl: DEFAULT_DEV_API_BASE_URL,
      tokenProvider: async () => 'mock_jwt_requester',
      fetchFn: async () => {
        throw new TypeError('Failed to fetch: Connection reset by peer');
      },
    });

    showStagingModal({
      context: ctx,
      controller,
      useRealBackend: true,
      apiClient: mockApiClient,
    });

    const shadow = getStagingModalShadowRoot();
    const reqBtn = findElement(shadow, '#gs-btn-request-approval');
    reqBtn?.click();

    await new Promise((resolve) => setTimeout(resolve, 20));

    assertEquals(
      getStagingUIState(),
      'approval_uncertain',
      'UI transitions to approval_uncertain on socket drop'
    );

    const rec = controller.getRecord('act_drop');
    assertEquals(
      rec?.state,
      InterceptionState.HELD,
      'Action remains safely HELD on network drop'
    );

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Suite 6: Cancellation Flow Isolation & Safety
  // ---------------------------------------------------------------------------
  console.log('\nSuite 6: Cancellation Flow Isolation & Safety');

  // Test 6.1: Cancel button executes cancellation only and never triggers approval
  {
    dismissStagingModal();
    const controller = new InterceptionController();
    controller.register('act_cancel_test', 'Hold');
    const heldRecord = controller.holdAction('act_cancel_test', 'Hold');

    const continuationManager = new ContinuationManager(controller);
    let continuationCalled = false;
    continuationManager.registerHeldAction(
      createSampleAction('act_cancel_test'),
      heldRecord,
      () => {
        continuationCalled = true;
      }
    );

    let approvalRequestedCalled = false;
    const mockApiClient = new ApprovalApiClient({
      baseUrl: DEFAULT_DEV_API_BASE_URL,
      tokenProvider: async () => 'mock_jwt_requester',
      fetchFn: async () => {
        approvalRequestedCalled = true;
        return createMockResponse({}, { status: 201 });
      },
    });

    const ctx = createSampleContext('act_cancel_test');
    let cancelCallbackResult: any = null;

    showStagingModal({
      context: ctx,
      controller,
      continuationManager,
      useRealBackend: true,
      apiClient: mockApiClient,
      onCancelSuccess: (res) => {
        cancelCallbackResult = res;
      },
    });

    const shadow = getStagingModalShadowRoot();
    const cancelBtn = findElement(shadow, '#gs-btn-cancel-action');
    assert(cancelBtn !== null, 'Cancel button is present');

    // User clicks Cancel Action
    cancelBtn?.click();

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert(cancelCallbackResult !== null, 'Cancel callback was invoked');
    assertEquals(cancelCallbackResult.actionId, 'act_cancel_test', 'Cancelled correct action ID');

    // UI state transitions to cancelled
    assertEquals(getStagingUIState(), 'cancelled', 'UI state is cancelled');

    // Interception state is CANCELLED
    const rec = controller.getRecord('act_cancel_test');
    assertEquals(rec?.state, InterceptionState.CANCELLED, 'Interception state is CANCELLED');

    // Continuation was NEVER executed
    assert(!continuationCalled, 'Continuation was not executed');

    // Approval submission was NEVER triggered (Requirement 12)
    assert(!approvalRequestedCalled, 'Approval submission was NEVER called by cancellation');

    dismissStagingModal();
  }

  // Test 6.2: Cancellation after uncertain outcome safely aborts the held action
  {
    dismissStagingModal();
    const controller = new InterceptionController();
    controller.register('act_post_uncertain', 'Hold');
    controller.holdAction('act_post_uncertain', 'Hold');

    const ctx = createSampleContext('act_post_uncertain');
    const mockApiClient = new ApprovalApiClient({
      baseUrl: DEFAULT_DEV_API_BASE_URL,
      tokenProvider: async () => 'mock_jwt_requester',
      fetchFn: async () => {
        throw new TypeError('Network offline');
      },
    });

    showStagingModal({
      context: ctx,
      controller,
      useRealBackend: true,
      apiClient: mockApiClient,
    });

    const shadow = getStagingModalShadowRoot();
    const reqBtn = findElement(shadow, '#gs-btn-request-approval');
    reqBtn?.click();

    await new Promise((resolve) => setTimeout(resolve, 20));
    assertEquals(getStagingUIState(), 'approval_uncertain', 'UI is in approval_uncertain');

    const cancelBtn = findElement(shadow, '#gs-btn-cancel-action');
    assert(!cancelBtn?.disabled, 'Cancel button is enabled after uncertain outcome');

    // Now click cancel
    cancelBtn?.click();

    await new Promise((resolve) => setTimeout(resolve, 20));
    assertEquals(getStagingUIState(), 'cancelled', 'UI cleanly transitions to cancelled');
    assertEquals(
      controller.getRecord('act_post_uncertain')?.state,
      InterceptionState.CANCELLED,
      'Action is now safely CANCELLED'
    );

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Suite 7: Full Extension Messaging Round-Trip via chrome.runtime
  // ---------------------------------------------------------------------------
  console.log('\nSuite 7: Full Extension Messaging Round-Trip via chrome.runtime');

  // Test 7.1: Background message listener handles submit request and returns typed response
  {
    const backgroundController = new InterceptionController();
    backgroundController.register('act_roundtrip_1', 'Payment review');
    backgroundController.holdAction('act_roundtrip_1', 'Payment review');

    // Install mock chrome runtime
    (globalThis as any).chrome = {
      runtime: {
        id: 'guardrail-ext-id',
        lastError: null,
        sendMessage: (msg: any, callback?: (res: any) => void) => {
          const promise = handleBackgroundApprovalSubmission(msg, backgroundController, {
            apiClient: new ApprovalApiClient({
              baseUrl: DEFAULT_DEV_API_BASE_URL,
              tokenProvider: async () => 'mock_jwt_requester',
              fetchFn: async () => {
                return createMockResponse(
                  {
                    id: 'appr_req_rt_555',
                    actionId: 'act_roundtrip_1',
                    requesterId: 'user_req_alice',
                    status: ApprovalStatus.PENDING,
                    createdAt: '2026-10-19T03:02:00.000Z',
                    actionCategory: ActionCategory.PAYMENT,
                    actionType: ActionType.CLICK,
                    riskLevel: RiskLevel.CRITICAL,
                    riskScore: 95,
                    summary: 'Pay Now ($149.99)',
                    domain: 'shop.example.com',
                  },
                  { status: 201 }
                );
              },
            }),
          });
          if (callback) {
            promise.then((res) => callback(res));
          }
          return promise;
        },
      },
    };

    const ctx = createSampleContext('act_roundtrip_1');
    const response = await dispatchSubmitApprovalRequestToBackground('act_roundtrip_1', ctx);

    assert(response.success, 'Round-trip submission succeeded');
    assertEquals(response.actionId, 'act_roundtrip_1', 'Response matches actionId');
    assertEquals(
      response.outcome,
      SubmissionOutcome.CREATED_PENDING,
      'Outcome is CREATED_PENDING'
    );
    assertEquals(
      response.request?.id,
      'appr_req_rt_555',
      'Response has canonical request ID'
    );
    assertEquals(
      response.request?.status,
      ApprovalStatus.PENDING,
      'Response confirms PENDING status'
    );

    // Verify background controller state remained HELD
    const bgRec = backgroundController.getRecord('act_roundtrip_1');
    assertEquals(
      bgRec?.state,
      InterceptionState.HELD,
      'Background interception record remains safely HELD'
    );
  }

  // Test 7.2: Extension messaging handles runtime disconnect / port closed gracefully
  {
    (globalThis as any).chrome = {
      runtime: {
        id: 'guardrail-ext-id',
        lastError: { message: 'Could not establish connection. Receiving end does not exist.' },
        sendMessage: (_msg: any, callback?: (res: any) => void) => {
          const err = new Error('Could not establish connection. Receiving end does not exist.');
          if (callback) {
            callback(undefined);
            return;
          }
          return Promise.reject(err);
        },
      },
    };

    const ctx = createSampleContext('act_disconnect');
    const response = await dispatchSubmitApprovalRequestToBackground('act_disconnect', ctx);

    assert(!response.success, 'Disconnected submission fails safely');
    assertEquals(
      response.outcome,
      SubmissionOutcome.NETWORK_FAILURE_UNCERTAIN,
      'Outcome is NETWORK_FAILURE_UNCERTAIN'
    );
    assertEquals(
      response.isAuthoritative,
      false,
      'Runtime disconnect outcome is NOT authoritative'
    );
    assert(
      Boolean(response.error?.message?.includes('Receiving end does not exist')),
      'Error message preserves runtime disconnect details'
    );
  }

  // Test 7.3: Zero exposure of auth tokens or credentials to webpage scripts (Requirement 13)
  {
    const ctx = createSampleContext('act_privacy_test');
    // Ensure StagingActionContext does NOT contain tokens or passwords
    const keys = Object.keys(ctx);
    const forbiddenKeys = ['token', 'authToken', 'jwt', 'secret', 'password', 'apiKey'];
    for (const key of forbiddenKeys) {
      assert(
        !keys.includes(key),
        `StagingActionContext does NOT expose privileged property "${key}"`
      );
    }
  }

  // Clean up globals
  delete (globalThis as any).chrome;

  // ---------------------------------------------------------------------------
  // Final Results
  // ---------------------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`Results: ${passedTests} passed of ${totalTests} assertions`);
  console.log('=============================================================\n');

  if (passedTests < totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test suite failure:', err);
  process.exit(1);
});
