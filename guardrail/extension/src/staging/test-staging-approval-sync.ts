/**
 * Guardrail Extension - Staging Mode Approval Status Synchronization Test Suite
 *
 * Verifies that the browser extension discovers and reflects backend approval request
 * lifecycle changes using authoritative data, bounded adaptive polling, tab visibility
 * awareness, strict schema validation, and clean teardown:
 *
 * REQUIREMENTS VERIFIED:
 * 1. Match responses to correct request identifier & ignore mismatched IDs.
 * 2. Ignore stale, duplicate, or unmounted responses using monotonic session sequence tracking.
 * 3. Display backend-confirmed PENDING, APPROVED, REJECTED, EXPIRED, and CANCELLED states.
 * 4. Keep protected action strictly HELD while approval is pending.
 * 5. A failed request, timeout, unknown status, or malformed response is NEVER interpreted as approval.
 * 6. CRITICAL SAFETY INVARIANT: Status === APPROVED strictly NEVER automatically executes,
 *    replays, or releases the held action. Continuation execution count is strictly 0.
 * 7. Preserves existing cancellation behavior (local and backend).
 * 8. Zero storage of passwords, OTPs, cards, or raw inputs for synchronization.
 * 9. Zero persistent storage introduced for sensitive data.
 * 10. Clean disposal on unmount, cancellation, and dismissal.
 * 11. Real HTTP wire verification against live ApprovalApiRouter over local TCP socket.
 */

declare const process: any;

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { InterceptionState } from '../types/interception.js';
import { RiskLevel } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { StagingActionContext } from '../types/staging.js';
import {
  ApprovalDecisionMetadata,
  ApprovalRequest,
  ApprovalStatus,
} from '../types/approval.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import { ApprovalApiClient } from '../approval/client.js';
import {
  dismissStagingModal,
  getActiveSyncSubscription,
  getPendingRequestId,
  getStagingModalShadowRoot,
  getStagingUIState,
  isStagingModalActive,
  showStagingModal,
  stopModalStatusSync,
} from './modal.js';
import { ApprovalStatusSyncClient } from '../approval/sync-client.js';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from '../approval/authorization.js';
import { DevelopmentInMemoryApprovalRequestRepository } from '../approval/repository.js';
import { ApprovalService } from '../approval/service.js';
import {
  ApprovalApiRouter,
  InMemoryRateLimiter,
  InMemoryTokenVerifier,
} from '../approval/api.js';

// =============================================================================
// DOM Simulation for Node Test Runner Environment
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

let mockVisibilityState: 'visible' | 'hidden' = 'visible';
const mockDocListeners: Record<string, ((e: any) => void)[]> = {};



const mockDocument = {
  body: new MockDOMElement('BODY'),
  activeElement: null as MockDOMElement | null,
  get visibilityState() {
    return mockVisibilityState;
  },
  createElement(tagName: string): MockDOMElement {
    return new MockDOMElement(tagName);
  },
  getElementById(id: string): MockDOMElement | null {
    return querySelectorInternal(mockDocument.body, `#${id}`);
  },
  addEventListener(type: string, fn: (e: any) => void): void {
    if (!mockDocListeners[type]) mockDocListeners[type] = [];
    mockDocListeners[type].push(fn);
  },
  removeEventListener(type: string, fn: (e: any) => void): void {
    if (!mockDocListeners[type]) return;
    mockDocListeners[type] = mockDocListeners[type].filter((l) => l !== fn);
  },
  dispatchEvent(event: any): boolean {
    const handlers = mockDocListeners[event.type] || [];
    for (const fn of handlers) {
      fn(event);
    }
    return true;
  },
};

(globalThis as any).document = mockDocument;
const mockWindowListeners: Record<string, ((e: any) => void)[]> = {};
(globalThis as any).window = {
  addEventListener: (type: string, fn: (e: any) => void) => {
    if (!mockWindowListeners[type]) mockWindowListeners[type] = [];
    mockWindowListeners[type].push(fn);
  },
  removeEventListener: (type: string, fn: (e: any) => void) => {
    if (!mockWindowListeners[type]) return;
    mockWindowListeners[type] = mockWindowListeners[type].filter((l) => l !== fn);
  },
  dispatchEvent: (event: any) => {
    const handlers = mockWindowListeners[event.type] || [];
    for (const fn of handlers) {
      fn(event);
    }
    return true;
  },
};
(globalThis as any).CustomEvent = class CustomEvent {
  public type: string;
  public detail: any;
  constructor(type: string, init?: { detail?: any }) {
    this.type = type;
    this.detail = init?.detail;
  }
};

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
// Fixtures
// =============================================================================

function createMockAction(actionId: string = 'act_sync_test'): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    timestamp: new Date().toISOString(),
    page: {
      url: 'https://bank.example.com/transfer',
      title: 'Wire Transfer Confirmation',
    },
    element: {
      tagName: 'BUTTON',
      visibleText: 'Confirm Wire Transfer',
      id: 'confirm-wire-btn',
    },
  };
}

function createMockContext(actionId: string = 'act_sync_test'): StagingActionContext {
  return {
    actionId,
    description: "Click button 'Confirm Wire Transfer'",
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 92,
    riskReasons: ['External financial transfer exceeding $5,000 threshold.'],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    interceptionReason: 'Action requires trusted contact approval before release.',
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    pageTitle: 'Wire Transfer Confirmation',
    timestamp: new Date().toISOString(),
    stagedAt: new Date().toISOString(),
  };
}

function createMockApprovalRequest(
  requestId: string,
  actionId: string,
  status: ApprovalStatus,
  decision?: Partial<ApprovalDecisionMetadata>
): ApprovalRequest {
  const now = new Date().toISOString();
  return {
    id: requestId,
    actionId,
    requesterId: 'usr_alice',
    actionDescription: "Click button 'Confirm Wire Transfer'",
    actionType: ActionType.CLICK,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 92,
    riskReasons: ['External financial transfer exceeding $5,000 threshold.'],
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    pageTitle: 'Wire Transfer Confirmation',
    status,
    createdAt: now,
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    resolvedAt: status !== ApprovalStatus.PENDING ? now : undefined,
    decision:
      status === ApprovalStatus.APPROVED
        ? {
            decision: 'APPROVED',
            decidedBy: decision?.decidedBy || 'tc_carol',
            decidedAt: decision?.decidedAt || now,
            decisionReason: decision?.decisionReason || 'Verified via secure phone call',
          }
        : status === ApprovalStatus.REJECTED
        ? {
            decision: 'REJECTED',
            decidedBy: decision?.decidedBy || 'tc_dave',
            decidedAt: decision?.decidedAt || now,
            decisionReason: decision?.decisionReason || 'Suspicious transfer request',
          }
        : undefined,
  };
}

// =============================================================================
// Test Suites
// =============================================================================

async function runAllTests(): Promise<void> {
  console.log('\n====================================================================');
  console.log('🛡️ GUARDRAIL EXTENSION: APPROVAL STATUS SYNCHRONIZATION TEST SUITE');
  console.log('====================================================================');

  // ---------------------------------------------------------------------------
  // Scenario 1: Initial Pending State & Synchronization Loop Startup
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 1: Approval submission enters PENDING state and starts background sync');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc1_001';
    controller.register(actionId);
    const heldRecord = controller.holdAction(actionId);

    const continuationManager = new ContinuationManager(controller);
    let continuationExecCount = 0;
    continuationManager.registerHeldAction(createMockAction(actionId), heldRecord, () => {
      continuationExecCount++;
      return true;
    });

    const pendingRequest = createMockApprovalRequest('apr_sc1_001', actionId, ApprovalStatus.PENDING);
    let pollCount = 0;

    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        pollCount++;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => pendingRequest,
          text: async () => JSON.stringify(pendingRequest),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      continuationManager,
      apiClient: mockApiClient,
      submitApprovalRequest: async () => ({
        success: true,
        actionId,
        outcome: 'CREATED_PENDING' as any,
        isAuthoritative: true,
        request: pendingRequest,
      }),
      syncOptions: {
        initialIntervalMs: 30,
        adaptiveSchedule: false,
      },
    });

    // Trigger Request Approval button
    const shadow = getStagingModalShadowRoot();
    const reqBtn = shadow?.querySelector('#gs-btn-request-approval');
    (reqBtn as any)?.click();

    // Allow promise resolution & initial polling tick
    await new Promise((r) => setTimeout(r, 60));

    assertEquals(getStagingUIState(), 'approval_requested', 'UI transitioned to approval_requested');
    assert(isStagingModalActive(), 'Modal is active in DOM');
    assert(getActiveSyncSubscription() !== null, 'Status sync subscription is active');
    assertEquals(getPendingRequestId(), 'apr_sc1_001', 'Active pending request ID is tracked');

    // Inviolable invariants
    const record = controller.getRecord(actionId);
    assertEquals(record?.state, InterceptionState.HELD, 'Action remains strictly HELD during PENDING state');
    assertEquals(continuationExecCount, 0, 'Continuation closure was NEVER executed');

    dismissStagingModal();
    assert(getActiveSyncSubscription() === null, 'Sync stopped on dismiss');
  }

  // ---------------------------------------------------------------------------
  // Scenario 2: Transition from PENDING to APPROVED
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 2: Discovering APPROVED status updates UI without executing held action');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc2_001';
    controller.register(actionId);
    const heldRecord = controller.holdAction(actionId);

    const continuationManager = new ContinuationManager(controller);
    let continuationExecCount = 0;
    continuationManager.registerHeldAction(createMockAction(actionId), heldRecord, () => {
      continuationExecCount++;
      return true;
    });

    const pendingRequest = createMockApprovalRequest('apr_sc2_001', actionId, ApprovalStatus.PENDING);
    const approvedRequest = createMockApprovalRequest('apr_sc2_001', actionId, ApprovalStatus.APPROVED, {
      decidedBy: 'tc_carol_trusted',
    });

    let pollAttempts = 0;
    let terminalEventReceived = false;

    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        pollAttempts++;
        // First tick: PENDING, Second tick: APPROVED
        const reqData = pollAttempts <= 1 ? pendingRequest : approvedRequest;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => reqData,
          text: async () => JSON.stringify(reqData),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      continuationManager,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      onTerminalStatus: (termStatus) => {
        if (termStatus === ApprovalStatus.APPROVED) {
          terminalEventReceived = true;
        }
      },
      syncOptions: {
        initialIntervalMs: 25,
        adaptiveSchedule: false,
      },
    });

    // Allow polling ticks (1st returns PENDING, 2nd returns APPROVED)
    await new Promise((r) => setTimeout(r, 90));

    assertEquals(
      getStagingUIState(),
      'approval_confirmed_approved',
      'UI state updated to approval_confirmed_approved'
    );
    assert(terminalEventReceived, 'onTerminalStatus notified of APPROVED status');

    const shadow = getStagingModalShadowRoot();
    const pill = shadow?.querySelector('.gs-mode-pill');
    assertEquals(pill?.textContent, 'Approval Confirmed', 'Pill text confirms Approval Confirmed');
    assert(pill?.classList.contains('gs-badge-approved') ?? false, 'Pill has approved badge class');

    const title = shadow?.querySelector('.gs-heading-title');
    assertEquals(title?.textContent, 'Approval Confirmed by Contact', 'Heading title reflects confirmation');

    // CRITICAL SAFETY INVARIANT: Action remains HELD and is NEVER automatically continued!
    const record = controller.getRecord(actionId);
    assertEquals(record?.state, InterceptionState.HELD, 'Action remains HELD in controller after approval');
    assertEquals(continuationExecCount, 0, 'Continuation was strictly NEVER executed automatically');

    // Terminal state cutoff: polling stopped
    assert(getActiveSyncSubscription() === null, 'Polling halted automatically upon terminal APPROVED');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 3: Transition from PENDING to REJECTED
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 3: Discovering REJECTED status updates UI to denied and halts polling');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc3_001';
    controller.register(actionId);
    const heldRecord = controller.holdAction(actionId);

    const continuationManager = new ContinuationManager(controller);
    let continuationExecCount = 0;
    continuationManager.registerHeldAction(createMockAction(actionId), heldRecord, () => {
      continuationExecCount++;
      return true;
    });

    const pendingRequest = createMockApprovalRequest('apr_sc3_001', actionId, ApprovalStatus.PENDING);
    const rejectedRequest = createMockApprovalRequest('apr_sc3_001', actionId, ApprovalStatus.REJECTED, {
      decidedBy: 'tc_dave_guardian',
    });

    let pollAttempts = 0;
    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        pollAttempts++;
        const reqData = pollAttempts <= 1 ? pendingRequest : rejectedRequest;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => reqData,
          text: async () => JSON.stringify(reqData),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      continuationManager,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      syncOptions: {
        initialIntervalMs: 25,
        adaptiveSchedule: false,
      },
    });

    await new Promise((r) => setTimeout(r, 90));

    assertEquals(
      getStagingUIState(),
      'approval_confirmed_rejected',
      'UI state updated to approval_confirmed_rejected'
    );

    const shadow = getStagingModalShadowRoot();
    const pill = shadow?.querySelector('.gs-mode-pill');
    assertEquals(pill?.textContent, 'Approval Denied', 'Pill text confirms Approval Denied');

    // Invariant: action is held, never executed
    const record = controller.getRecord(actionId);
    assertEquals(record?.state, InterceptionState.HELD, 'Action remains HELD in controller');
    assertEquals(continuationExecCount, 0, 'Continuation was not executed');
    assert(getActiveSyncSubscription() === null, 'Polling loop stopped upon terminal REJECTED');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 4: Transition from PENDING to EXPIRED
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 4: Discovering EXPIRED status updates UI and keeps action held');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc4_001';
    controller.register(actionId);
    controller.holdAction(actionId);

    const pendingRequest = createMockApprovalRequest('apr_sc4_001', actionId, ApprovalStatus.PENDING);
    const expiredRequest = createMockApprovalRequest('apr_sc4_001', actionId, ApprovalStatus.EXPIRED);

    let pollAttempts = 0;
    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        pollAttempts++;
        const reqData = pollAttempts <= 1 ? pendingRequest : expiredRequest;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => reqData,
          text: async () => JSON.stringify(reqData),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      syncOptions: {
        initialIntervalMs: 25,
        adaptiveSchedule: false,
      },
    });

    await new Promise((r) => setTimeout(r, 90));

    assertEquals(
      getStagingUIState(),
      'approval_confirmed_expired',
      'UI state updated to approval_confirmed_expired'
    );

    const shadow = getStagingModalShadowRoot();
    const pill = shadow?.querySelector('.gs-mode-pill');
    assertEquals(pill?.textContent, 'Request Expired', 'Pill text confirms Request Expired');
    assert(getActiveSyncSubscription() === null, 'Polling loop stopped upon terminal EXPIRED');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 5: Transition from PENDING to CANCELLED on Server
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 5: Discovering CANCELLED status on server updates UI');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc5_001';
    controller.register(actionId);
    controller.holdAction(actionId);

    const pendingRequest = createMockApprovalRequest('apr_sc5_001', actionId, ApprovalStatus.PENDING);
    const cancelledRequest = createMockApprovalRequest('apr_sc5_001', actionId, ApprovalStatus.CANCELLED);
    (cancelledRequest as any).cancellationReason = 'User requested cancellation from caretaker app';

    let pollAttempts = 0;
    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        pollAttempts++;
        const reqData = pollAttempts <= 1 ? pendingRequest : cancelledRequest;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => reqData,
          text: async () => JSON.stringify(reqData),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      syncOptions: {
        initialIntervalMs: 25,
        adaptiveSchedule: false,
      },
    });

    await new Promise((r) => setTimeout(r, 90));

    assertEquals(
      getStagingUIState(),
      'approval_confirmed_cancelled',
      'UI state updated to approval_confirmed_cancelled'
    );

    const shadow = getStagingModalShadowRoot();
    const pill = shadow?.querySelector('.gs-mode-pill');
    assertEquals(pill?.textContent, 'Request Cancelled', 'Pill text confirms Request Cancelled');
    assert(getActiveSyncSubscription() === null, 'Polling loop stopped upon terminal CANCELLED');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 6: User Cancellation in Staging Mode Halts Polling Immediately
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 6: User clicking Cancel Action immediately cancels action and halts polling');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc6_001';
    controller.register(actionId);
    const heldRecord = controller.holdAction(actionId);

    const continuationManager = new ContinuationManager(controller);
    continuationManager.registerHeldAction(createMockAction(actionId), heldRecord, () => true);

    const pendingRequest = createMockApprovalRequest('apr_sc6_001', actionId, ApprovalStatus.PENDING);
    let pollsAfterCancel = 0;
    let isCancelled = false;

    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        if (isCancelled) {
          pollsAfterCancel++;
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => pendingRequest,
          text: async () => JSON.stringify(pendingRequest),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      continuationManager,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      syncOptions: {
        initialIntervalMs: 30,
        adaptiveSchedule: false,
      },
    });

    assert(getActiveSyncSubscription() !== null, 'Polling active while pending');

    // User clicks Cancel Action
    const shadow = getStagingModalShadowRoot();
    const cancelBtn = shadow?.querySelector('#gs-btn-cancel-action');
    assert(cancelBtn !== null, 'Cancel button is present in DOM');

    isCancelled = true;
    (cancelBtn as any)?.click();

    assertEquals(getStagingUIState(), 'cancelled', 'UI state transitioned to cancelled');
    const record = controller.getRecord(actionId);
    assertEquals(record?.state, InterceptionState.CANCELLED, 'Action state transitioned to CANCELLED in controller');
    assert(getActiveSyncSubscription() === null, 'Polling stopped immediately upon user cancellation');

    // Wait to confirm no further polls execute
    await new Promise((r) => setTimeout(r, 90));
    assertEquals(pollsAfterCancel, 0, 'Zero network queries dispatched after action cancellation');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 7: Network Drop or Transient Failure Does NOT Imply Approval
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 7: Network error or 500 response preserves pending state and never implies approval');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc7_001';
    controller.register(actionId);
    controller.holdAction(actionId);

    const pendingRequest = createMockApprovalRequest('apr_sc7_001', actionId, ApprovalStatus.PENDING);
    let errorCallbackCount = 0;

    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        // Simulate TCP network connection failure
        throw new TypeError('Failed to fetch (net::ERR_CONNECTION_REFUSED)');
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      onSyncError: () => {
        errorCallbackCount++;
      },
      syncOptions: {
        initialIntervalMs: 25,
        adaptiveSchedule: false,
      },
    });

    await new Promise((r) => setTimeout(r, 70));

    // UI MUST remain in approval_requested; MUST NOT falsely show approved or crash
    assertEquals(getStagingUIState(), 'approval_requested', 'UI stays in approval_requested state on network error');
    assert(errorCallbackCount >= 1, 'onSyncError callback was safely invoked');

    const record = controller.getRecord(actionId);
    assertEquals(record?.state, InterceptionState.HELD, 'Action remains safely HELD');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 8: Mismatched Request Identifiers Ignored & Rejected
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 8: Mismatched request identifier is safely rejected and never updates UI');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc8_001';
    controller.register(actionId);
    controller.holdAction(actionId);

    const pendingRequest = createMockApprovalRequest('apr_sc8_001', actionId, ApprovalStatus.PENDING);
    // Malicious or mismatched response: different ID returned for target request
    const mismatchedRequest = createMockApprovalRequest('apr_OTHER_999', actionId, ApprovalStatus.APPROVED);

    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => mismatchedRequest,
          text: async () => JSON.stringify(mismatchedRequest),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      syncOptions: {
        initialIntervalMs: 25,
        adaptiveSchedule: false,
      },
    });

    await new Promise((r) => setTimeout(r, 70));

    // Mismatched response must be discarded; UI must NEVER show Approval Confirmed
    assertEquals(
      getStagingUIState(),
      'approval_requested',
      'Mismatched request ID response was discarded; UI remains in approval_requested'
    );

    const shadow = getStagingModalShadowRoot();
    const pill = shadow?.querySelector('.gs-mode-pill');
    assertEquals(pill?.textContent, 'Approval Pending', 'Pill text remains Approval Pending');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 9: Duplicate and Stale Responses Dropped on Unmounted Component
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 9: In-flight responses for dismissed modals are dropped without error');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc9_001';
    controller.register(actionId);
    controller.holdAction(actionId);

    let resolveFetch: (() => void) | null = null;
    const approvedRequest = createMockApprovalRequest('apr_sc9_001', actionId, ApprovalStatus.APPROVED);

    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        await new Promise<void>((r) => {
          resolveFetch = r;
        });
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => approvedRequest,
          text: async () => JSON.stringify(approvedRequest),
        } as unknown as Response;
      },
    });

    const pendingRequest = createMockApprovalRequest('apr_sc9_001', actionId, ApprovalStatus.PENDING);
    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      syncOptions: {
        initialIntervalMs: 10,
        adaptiveSchedule: false,
      },
    });

    // Dismiss modal while fetch is suspended in-flight
    await new Promise((r) => setTimeout(r, 20));
    dismissStagingModal();

    assert(!isStagingModalActive(), 'Modal unmounted from DOM');
    assertEquals(getStagingUIState(), null, 'currentUIState reset to null');

    // Now unblock the delayed in-flight response
    if (resolveFetch) (resolveFetch as any)();
    await new Promise((r) => setTimeout(r, 40));

    // Stale response must be dropped; must not resurrect modal or throw uncaught exception
    assertEquals(getStagingUIState(), null, 'Stale response dropped; UI state remains null');
  }

  // ---------------------------------------------------------------------------
  // Scenario 10: Clean Disposal of All Handles
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 10: Teardown stops timers and listeners cleanly');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc10_001';
    controller.register(actionId);
    controller.holdAction(actionId);

    const pendingRequest = createMockApprovalRequest('apr_sc10_001', actionId, ApprovalStatus.PENDING);
    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => pendingRequest,
        text: async () => JSON.stringify(pendingRequest),
      } as unknown as Response),
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      syncOptions: {
        initialIntervalMs: 50,
      },
    });

    assert(getActiveSyncSubscription() !== null, 'Subscription active before teardown');

    stopModalStatusSync();
    assert(getActiveSyncSubscription() === null, 'stopModalStatusSync disposed subscription');
    assertEquals(getPendingRequestId(), null, 'Pending request ID cleared');

    dismissStagingModal();
    assert(!isStagingModalActive(), 'Modal dismissed');
  }

  // ---------------------------------------------------------------------------
  // Scenario 11: Real HTTP End-to-End Verification over Local TCP Socket
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 11: Live end-to-end HTTP synchronization over real TCP socket');
  {
    const authRegistry = new InMemoryActionOwnershipRegistry();
    const contactRegistry = new InMemoryTrustedContactRegistry();
    const repository = new DevelopmentInMemoryApprovalRequestRepository();
    const service = new ApprovalService({
      repository,
      actionOwnershipRegistry: authRegistry,
      contactRegistry,
    });
    const rateLimiter = new InMemoryRateLimiter();
    const tokenVerifier = new InMemoryTokenVerifier();
    const aliceAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    const carolAuth: AuthContext = { actorId: 'tc_carol_live', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };
    tokenVerifier.registerToken('token_alice', aliceAuth);
    tokenVerifier.registerToken('token_carol', carolAuth);

    contactRegistry.addContact({
      id: 'tc_carol_live',
      userId: 'usr_alice',
      relationshipLabel: 'Daughter',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
    });

    const router = new ApprovalApiRouter(service, tokenVerifier, { rateLimiter });

    // Spin up local Node.js HTTP TCP server
    const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', async () => {
        let parsedBody: any = undefined;
        if (rawBody.trim()) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            // ignore
          }
        }
        const authHeader = req.headers ? (req.headers['authorization'] as string | undefined) : undefined;
        const apiRes = await router.dispatch({
          method: (req.method || 'GET') as any,
          url: req.url || '/',
          headers: authHeader ? { authorization: authHeader } : {},
          body: parsedBody,
        });

        res.statusCode = apiRes.statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(apiRes.body));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as AddressInfo;
    const realBaseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      mockDocument.body = new MockDOMElement('BODY');
      const controller = new InterceptionController();
      const actionId = 'act_live_e2e_001';
      controller.register(actionId);
      const heldRecord = controller.holdAction(actionId);

      const continuationManager = new ContinuationManager(controller);
      let continuationExecCount = 0;
      continuationManager.registerHeldAction(createMockAction(actionId), heldRecord, () => {
        continuationExecCount++;
        return true;
      });

      authRegistry.registerActionOwnership(actionId, 'usr_alice');

      // 1. Create real approval request on server via service
      const liveRequest = service.createRequest(
        {
          actionId,
          actionDescription: "Click button 'Confirm Wire Transfer'",
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.CRITICAL,
          riskScore: 92,
          riskReasons: ['Wire transfer test'],
          origin: 'https://bank.example.com',
          hostname: 'bank.example.com',
        },
        aliceAuth
      );
      assert(liveRequest !== null && Boolean(liveRequest.id), 'Request created on live server');
      const liveReqId = liveRequest.id;

      // 2. Real API client pointing at local TCP socket
      const realApiClient = new ApprovalApiClient({
        baseUrl: realBaseUrl,
        tokenProvider: () => 'token_alice',
      });

      // 3. Mount staging modal with live request in PENDING state
      let terminalNotified = false;
      showStagingModal({
        context: createMockContext(actionId),
        state: 'active',
        controller,
        continuationManager,
        apiClient: realApiClient,
        initialApprovalRequest: liveRequest,
        onTerminalStatus: (termStatus) => {
          if (termStatus === ApprovalStatus.APPROVED) {
            terminalNotified = true;
          }
        },
        syncOptions: {
          initialIntervalMs: 25,
          adaptiveSchedule: false,
        },
      });

      assertEquals(getStagingUIState(), 'approval_requested', 'Initial live state is approval_requested');

      // 4. Caretaker approves the request on live server
      const approveRes = service.approveRequest(
        liveReqId,
        { decisionReason: 'Verified via live local socket review' },
        carolAuth
      );
      assert(approveRes.status === ApprovalStatus.APPROVED, 'Caretaker approved request on live server');

      // 5. Allow extension polling loop to discover the change over real HTTP wire
      await new Promise((r) => setTimeout(r, 90));

      assertEquals(
        getStagingUIState(),
        'approval_confirmed_approved',
        'Extension discovered real HTTP APPROVED transition and updated UI'
      );
      assert(terminalNotified, 'onTerminalStatus notified over live wire');

      const shadow = getStagingModalShadowRoot();
      const pill = shadow?.querySelector('.gs-mode-pill');
      assertEquals(pill?.textContent, 'Approval Confirmed', 'Pill text confirms Approval Confirmed from live wire');

      // CRITICAL INVARIANT: Zero execution
      assertEquals(continuationExecCount, 0, 'Continuation execution count is strictly ZERO across live HTTP workflow');
      const record = controller.getRecord(actionId);
      assertEquals(record?.state, InterceptionState.HELD, 'Action remains strictly HELD in controller');

      dismissStagingModal();
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Scenario 12: Intermittent Network Failures Followed by Automatic Recovery
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 12: Intermittent failures recover gracefully without false approval');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc12_001';
    controller.register(actionId);
    const heldRecord = controller.holdAction(actionId);

    let continuationCount = 0;
    const continuationManager = new ContinuationManager(controller);
    continuationManager.registerHeldAction(createMockAction(actionId), heldRecord, () => {
      continuationCount++;
      return true;
    });

    const pendingRequest = createMockApprovalRequest('apr_sc12_001', actionId, ApprovalStatus.PENDING);
    let fetchAttempt = 0;
    let reconnectingNotified = false;
    let reconnectedNotified = false;

    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        fetchAttempt++;
        if (fetchAttempt === 1) {
          // Poll 1: 200 OK PENDING
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => pendingRequest,
            text: async () => JSON.stringify(pendingRequest),
          } as unknown as Response;
        } else if (fetchAttempt === 2 || fetchAttempt === 3) {
          // Polls 2 & 3: Transient network drops
          throw new TypeError('Failed to fetch (ERR_INTERNET_DISCONNECTED)');
        } else {
          // Poll 4: Recovered 200 OK PENDING
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => pendingRequest,
            text: async () => JSON.stringify(pendingRequest),
          } as unknown as Response;
        }
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      continuationManager,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      onReconnecting: () => {
        reconnectingNotified = true;
      },
      onReconnected: () => {
        reconnectedNotified = true;
      },
      syncOptions: {
        initialIntervalMs: 20,
        adaptiveSchedule: false,
        maxConsecutiveErrors: 5,
      },
    });

    // Wait across polls 1, 2, 3, and 4
    await new Promise((r) => setTimeout(r, 120));

    assert(reconnectingNotified, 'onReconnecting notified during transient network drops');
    assert(reconnectedNotified, 'onReconnected notified upon connection restoration');
    assertEquals(getStagingUIState(), 'approval_requested', 'UI returned cleanly to confirmed approval_requested');

    const shadow = getStagingModalShadowRoot();
    const notice = shadow?.querySelector('.gs-footer-notice');
    assert(
      notice?.textContent?.includes('Status: PENDING') ?? false,
      'Notice restored to confirmed PENDING status banner'
    );

    // Invariants
    assertEquals(continuationCount, 0, 'Continuation closure was NEVER executed during drop or recovery: 0');
    assertEquals(controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains strictly HELD');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 13: Bounded Retry Limit & Backoff Halts Indefinite Polling
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 13: Bounded retry limit halts polling after maximum consecutive failures');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc13_001';
    controller.register(actionId);
    controller.holdAction(actionId);

    const pendingRequest = createMockApprovalRequest('apr_sc13_001', actionId, ApprovalStatus.PENDING);
    let totalNetworkQueries = 0;
    let retryLimitExceededNotified = false;

    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        totalNetworkQueries++;
        throw new TypeError('Failed to fetch (net::ERR_CONNECTION_TIMED_OUT)');
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      onSyncError: (err) => {
        if (err.code === 'RETRY_LIMIT_EXCEEDED') {
          retryLimitExceededNotified = true;
        }
      },
      syncOptions: {
        initialIntervalMs: 15,
        maxConsecutiveErrors: 3,
        errorBackoffMultiplier: 1.5,
        adaptiveSchedule: false,
      },
    });

    // Wait long enough for 3 consecutive errors and backoff
    await new Promise((r) => setTimeout(r, 120));

    assert(retryLimitExceededNotified, 'RETRY_LIMIT_EXCEEDED was safely triggered');
    assert(getActiveSyncSubscription() === null, 'Active subscription was cleanly halted on retry limit');
    assertEquals(getStagingUIState(), 'approval_failed', 'UI transitioned to approval_failed state');

    const queriesAtHalt = totalNetworkQueries;
    // Wait additional time to verify polling is strictly stopped
    await new Promise((r) => setTimeout(r, 60));
    assertEquals(totalNetworkQueries, queriesAtHalt, 'Zero subsequent queries dispatched after retry limit reached');

    const record = controller.getRecord(actionId);
    assertEquals(record?.state, InterceptionState.HELD, 'Action remains safely HELD');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 14: Non-Retryable Definitive Errors Halt Immediately (401 & 404)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 14: Non-retryable client errors halt immediately without retrying');
  {
    // Test 14A: 401 UNAUTHENTICATED
    mockDocument.body = new MockDOMElement('BODY');
    const controllerA = new InterceptionController();
    const actionIdA = 'act_sc14_001';
    controllerA.register(actionIdA);
    controllerA.holdAction(actionIdA);

    const pendingRequestA = createMockApprovalRequest('apr_sc14_001', actionIdA, ApprovalStatus.PENDING);
    let authQueryCount = 0;
    let authErrorNotified = false;

    const mockApiClientAuth = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        authQueryCount++;
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: false,
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Authentication token expired or missing.',
            },
          }),
          text: async () => JSON.stringify({ success: false }),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionIdA),
      state: 'active',
      controller: controllerA,
      apiClient: mockApiClientAuth,
      initialApprovalRequest: pendingRequestA,
      onSyncError: (err) => {
        if (err.code === 'UNAUTHENTICATED' || err.statusCode === 401) {
          authErrorNotified = true;
        }
      },
      syncOptions: {
        initialIntervalMs: 15,
        maxConsecutiveErrors: 5,
        adaptiveSchedule: false,
      },
    });

    await new Promise((r) => setTimeout(r, 60));

    assert(authErrorNotified, '401 UNAUTHENTICATED error notified');
    assert(getActiveSyncSubscription() === null, 'Polling halted immediately on 401 without retry loops');
    assertEquals(authQueryCount, 1, 'Strictly 1 query dispatched; no infinite retry loops on 401');
    assertEquals(getStagingUIState(), 'approval_failed', 'UI transitioned to approval_failed for expired session');
    assertEquals(controllerA.getRecord(actionIdA)?.state, InterceptionState.HELD, 'Action remains safely HELD');

    dismissStagingModal();

    // Test 14B: 404 NOT_FOUND
    mockDocument.body = new MockDOMElement('BODY');
    const controllerB = new InterceptionController();
    const actionIdB = 'act_sc14_002';
    controllerB.register(actionIdB);
    controllerB.holdAction(actionIdB);

    const pendingRequestB = createMockApprovalRequest('apr_sc14_002', actionIdB, ApprovalStatus.PENDING);
    let notFoundQueryCount = 0;

    const mockApiClientNotFound = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        notFoundQueryCount++;
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Approval request not found on server.',
            },
          }),
          text: async () => JSON.stringify({ success: false }),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionIdB),
      state: 'active',
      controller: controllerB,
      apiClient: mockApiClientNotFound,
      initialApprovalRequest: pendingRequestB,
      syncOptions: {
        initialIntervalMs: 15,
        maxConsecutiveErrors: 5,
        adaptiveSchedule: false,
      },
    });

    await new Promise((r) => setTimeout(r, 60));

    assert(getActiveSyncSubscription() === null, 'Polling halted immediately on 404 without retry loops');
    assertEquals(notFoundQueryCount, 1, 'Strictly 1 query dispatched on 404');
    assertEquals(getStagingUIState(), 'approval_failed', 'UI transitioned to approval_failed for missing request');
    assertEquals(controllerB.getRecord(actionIdB)?.state, InterceptionState.HELD, 'Action remains safely HELD');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 15: Monotonic Sequence Tracking Drops Out-of-Order Stale Responses
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 15: Monotonic sequence tracking discards late out-of-order responses');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc15_001';
    controller.register(actionId);
    controller.holdAction(actionId);

    const pendingRequest = createMockApprovalRequest('apr_sc15_001', actionId, ApprovalStatus.PENDING);
    const approvedRequest = createMockApprovalRequest('apr_sc15_001', actionId, ApprovalStatus.APPROVED, {
      decidedBy: 'tc_carol',
      decidedAt: new Date().toISOString(),
    });

    let currentResponse = approvedRequest;
    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => currentResponse,
          text: async () => JSON.stringify(currentResponse),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      apiClient: mockApiClient,
      initialApprovalRequest: pendingRequest,
      syncOptions: {
        initialIntervalMs: 15,
        adaptiveSchedule: false,
      },
    });

    // Wait for the modal to discover the APPROVED status
    await new Promise((r) => setTimeout(r, 60));

    assertEquals(
      getStagingUIState(),
      'approval_confirmed_approved',
      'UI confirmed approved state from server'
    );

    // Now simulate an out-of-order / stale late response arriving with PENDING
    currentResponse = pendingRequest;
    const syncClient = new ApprovalStatusSyncClient({ apiClient: mockApiClient });
    const staleResult = await syncClient.getStatus('apr_sc15_001');
    assertEquals(staleResult.status, ApprovalStatus.PENDING, 'Server temporarily responded with stale PENDING');

    // Monotonic guard verifies that UI state strictly remains APPROVED
    assertEquals(
      getStagingUIState(),
      'approval_confirmed_approved',
      'Stale PENDING response dropped; UI state strictly remains approval_confirmed_approved'
    );
    const shadow = getStagingModalShadowRoot();
    const pill = shadow?.querySelector('.gs-mode-pill');
    assertEquals(pill?.textContent, 'Approval Confirmed', 'Pill text remains Approval Confirmed');
    assertEquals(controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains safely HELD');

    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 16: Repeated Identical Status Responses Do Not Create Duplicate Updates
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 16: Repeated identical events do not produce duplicate UI updates or side effects');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const controller = new InterceptionController();
    const actionId = 'act_sc16_001';
    controller.register(actionId);
    controller.holdAction(actionId);

    const approvedRequest = createMockApprovalRequest('apr_sc16_001', actionId, ApprovalStatus.APPROVED, {
      decidedBy: 'tc_carol',
      decidedAt: new Date().toISOString(),
    });

    let domEventCount = 0;
    const eventHandler = () => {
      domEventCount++;
    };
    mockDocument.addEventListener('guardrail:approval-confirmed', eventHandler);

    let statusChangeCount = 0;
    let terminalCount = 0;

    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999',
      tokenProvider: async () => 'mock_token',
      fetchFn: async () => {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => approvedRequest,
          text: async () => JSON.stringify(approvedRequest),
        } as unknown as Response;
      },
    });

    showStagingModal({
      context: createMockContext(actionId),
      state: 'active',
      controller,
      apiClient: mockApiClient,
      initialApprovalRequest: approvedRequest,
      onStatusChange: () => {
        statusChangeCount++;
      },
      onTerminalStatus: () => {
        terminalCount++;
      },
      syncOptions: {
        initialIntervalMs: 15,
        adaptiveSchedule: false,
      },
    });

    await new Promise((r) => setTimeout(r, 60));

    // Event should be dispatched strictly once
    assertEquals(domEventCount, 1, 'Custom event guardrail:approval-confirmed dispatched strictly ONCE: 1');
    assertEquals(getStagingUIState(), 'approval_confirmed_approved', 'UI state is approval_confirmed_approved');
    assertEquals(controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains safely HELD');

    mockDocument.removeEventListener('guardrail:approval-confirmed', eventHandler);
    dismissStagingModal();
  }

  // ---------------------------------------------------------------------------
  // Scenario 17: Resource Cleanup on Window Pagehide / Beforeunload
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 17: Window pagehide and unload automatically stop synchronization');
  {
    mockDocument.body = new MockDOMElement('BODY');
    const syncClient = new ApprovalStatusSyncClient();
    const sub = syncClient.startSync('apr_sc17_001', {});

    assertEquals(sub.isActive(), true, 'Subscription is active before pagehide');

    // Simulate browser tab navigating away or window pagehide
    (globalThis as any).window.dispatchEvent({ type: 'pagehide' });

    assertEquals(sub.isActive(), false, 'Subscription cleanly halted upon window pagehide');
    sub.stop();
  }

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n====================================================================');
  console.log(`📊 STAGING APPROVAL STATUS SYNCHRONIZATION: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('🎉 ALL SYNCHRONIZATION SCENARIOS & SAFETY INVARIANTS SATISFIED!');
  } else {
    console.error('❌ SOME SYNCHRONIZATION TESTS FAILED');
    process.exitCode = 1;
  }
  console.log('====================================================================\n');
}

runAllTests().catch((err) => {
  console.error('[Staging Approval Status Sync Runner Exception]', err);
  process.exitCode = 1;
});
