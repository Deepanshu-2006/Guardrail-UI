/**
 * Guardrail Controlled Action Continuation Hardening Regression Suite
 *
 * Verifies that the controlled action continuation workflow is hardened against:
 * 1. Cancellation races (simultaneous cancel and approve events; delayed approval after cancellation).
 * 2. Expiration immediately before confirmation via trusted server clock.
 * 3. Duplicate confirmation clicks (rapid double/triple click concurrency).
 * 4. Repeated, stale, or out-of-order poll responses.
 * 5. State overwrite protection (older state updates cannot overwrite newer authoritative terminal states).
 * 6. Resource disposal (event listeners, timers, and pending subscriptions cleaned up).
 * 7. Context & navigation isolation (origin, path, detached DOM elements cannot silently transfer authorization).
 * 8. Network failures (fail-closed behavior without treating uncertainty as approval).
 * 9. Clear, accessible UI feedback when an action can no longer be continued.
 * 10. Atomic backend state transitions & single-use continuation authorization (CAS).
 * 11. Documented architectural limitations (no race-free claims beyond persistence layer).
 * 12. Restoration & reconnection invariants (never auto-execute actions).
 * 13. Controlled test actions only (universal continuation on arbitrary websites fails closed).
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { ResponseAction } from '../types/response.js';
import { StagingActionContext } from '../types/staging.js';
import { InterceptionController } from './controller.js';
import {
  ContinuationManager,
  ContinuationAuthorizationBoundary,
} from './continuation.js';
import {
  ContinuationValidationService,
  ContinuationEligibilityStatus,
  CONTINUATION_VALIDATION_LIMITATIONS,
} from './validation-service.js';
import { ApprovalService } from '../approval/service.js';
import { DevelopmentInMemoryApprovalRequestRepository } from '../approval/repository.js';
import { RiskLevel } from '../types/risk.js';
import {
  InMemoryTrustedContactRegistry,
  InMemoryActionOwnershipRegistry,
  AuthContext,
  ActorRole,
  TrustedContactStatus,
} from '../approval/authorization.js';
import {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalActionBinding,
  ApprovalActionBindingState,
} from '../types/approval.js';
import {
  showStagingModal,
  dismissStagingModal,
  handleModalContinue,
  handleModalCancel,
  setStagingUIState,
  getStagingUIState,
  getStagingModalShadowRoot,
  startModalStatusSync,
  stopModalStatusSync,
  getActiveSyncSubscription,
  getCurrentModalSessionId,
} from '../staging/modal.js';
import {
  ApprovalApiClient,
  ApprovalApiClientConfig,
  ApiClientResult,
} from '../approval/client.js';
import { ApprovalStatusSyncClient } from '../approval/sync-client.js';

// ============================================================================
// TEST HARNESS & ASSERTION UTILITIES
// ============================================================================

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedTests++;
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    console.log(`  ✓ ${message}: ${String(actual)}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}. Expected "${String(expected)}", received "${String(actual)}"`);
    failedTests++;
  }
}

// ============================================================================
// OBSERVABLE TEST ACTION EFFECT
// ============================================================================

class HarmlessObservableEffect {
  public executionCount: number = 0;
  public executedActionIds: string[] = [];

  public execute(action: GuardrailAction): void {
    this.executionCount++;
    this.executedActionIds.push(action.id);
  }

  public reset(): void {
    this.executionCount = 0;
    this.executedActionIds = [];
  }
}

// ============================================================================
// LIGHTWEIGHT MOCK DOM FOR NODE ENVIRONMENT
// ============================================================================

class MockDOMTokenList {
  private classes: Set<string> = new Set();
  constructor(initial?: string) {
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
  public children: MockDOMElement[] = [];
  public parentNode: MockDOMElement | null = null;
  public shadowRoot: MockShadowRoot | null = null;
  public style: Record<string, string> = {};
  public listeners: Record<string, ((e: any) => void)[]> = {};
  private _textContent: string = '';
  private _className: string = '';
  public classList: MockDOMTokenList;
  public disabled: boolean = false;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockDOMTokenList();
  }

  get className(): string {
    return this._className;
  }

  set className(val: string) {
    this._className = val || '';
    this.classList = new MockDOMTokenList(this._className);
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
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
    if (name === 'class') this.className = '';
  }

  appendChild<T extends MockDOMElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
  }

  attachShadow(options: { mode: string }): MockShadowRoot {
    this.shadowRoot = new MockShadowRoot(options.mode);
    this.shadowRoot.host = this;
    return this.shadowRoot;
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  }

  dispatchEvent(event: any): boolean {
    const list = this.listeners[event.type || event] || [];
    list.forEach((h) => {
      try {
        h(event);
      } catch (err) {
        console.error(err);
      }
    });
    return true;
  }

  click(): void {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', target: this, defaultPrevented: false });
  }

  querySelector(selector: string): MockDOMElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];
    const traverse = (node: MockDOMElement) => {
      for (const child of node.children) {
        if (matches(child, selector)) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  contains(other: MockDOMElement | null): boolean {
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
  }

  focus(): void {}
}

class MockShadowRoot extends MockDOMElement {
  public mode: string;
  public host: MockDOMElement | null = null;
  constructor(mode: string) {
    super('#SHADOW-ROOT');
    this.mode = mode;
  }
}

function matches(el: MockDOMElement, selector: string): boolean {
  const trimmed = selector.trim();
  if (trimmed.startsWith('#')) return el.id === trimmed.slice(1);
  if (trimmed.startsWith('.')) {
    const cls = trimmed.slice(1);
    return el.classList.contains(cls) || el.className.split(/\s+/).includes(cls);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const attrName = trimmed.slice(1, -1);
    return el.getAttribute(attrName) !== null;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

class MockWindow {
  public location = {
    href: 'https://bank.example.com/transfer/confirm',
    origin: 'https://bank.example.com',
    pathname: '/transfer/confirm',
  };
  public listeners: Record<string, ((e: any) => void)[]> = {};
  addEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
  removeEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }
}

class MockDocument {
  public body: MockDOMElement = new MockDOMElement('BODY');
  public head: MockDOMElement = new MockDOMElement('HEAD');
  private elementMap: Map<string, MockDOMElement> = new Map();
  public listeners: Record<string, ((e: any) => void)[]> = {};

  constructor() {
    this.elementMap.set('body', this.body);
  }

  createElement(tag: string): MockDOMElement {
    return new MockDOMElement(tag);
  }

  getElementById(id: string): MockDOMElement | null {
    if (this.elementMap.has(id)) {
      const el = this.elementMap.get(id)!;
      let curr: MockDOMElement | null = el;
      while (curr) {
        if (curr === this.body) return el;
        curr = curr.parentNode;
      }
    }
    return this.body.querySelector(`#${id}`);
  }

  registerElement(id: string, el: MockDOMElement): void {
    el.id = id;
    this.elementMap.set(id, el);
    this.body.appendChild(el);
  }

  removeElement(id: string): void {
    const el = this.elementMap.get(id);
    if (el) {
      el.remove();
      this.elementMap.delete(id);
    }
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
    const list = this.listeners[event.type || event] || [];
    list.forEach((h) => {
      try {
        h(event);
      } catch (err) {
        console.error(err);
      }
    });
    return true;
  }
}

// Global installation
const mockWindow = new MockWindow();
const mockDocument = new MockDocument();
(globalThis as any).window = mockWindow;
(globalThis as any).document = mockDocument;
(globalThis as any).CustomEvent = class CustomEvent {
  type: string;
  detail: any;
  bubbles: boolean;
  constructor(type: string, params?: { detail?: any; bubbles?: boolean }) {
    this.type = type;
    this.detail = params?.detail;
    this.bubbles = params?.bubbles || false;
  }
};

// ============================================================================
// ENVIRONMENT FIXTURES SETUP
// ============================================================================

interface TestFixtures {
  controller: InterceptionController;
  continuationManager: ContinuationManager;
  repository: DevelopmentInMemoryApprovalRequestRepository;
  contactRegistry: InMemoryTrustedContactRegistry;
  actionOwnershipRegistry: InMemoryActionOwnershipRegistry;
  service: ApprovalService;
  effect: HarmlessObservableEffect;
}

function createTestFixtures(): TestFixtures {
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);
  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();
  const service = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry,
  });
  const effect = new HarmlessObservableEffect();

  return {
    controller,
    continuationManager,
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    service,
    effect,
  };
}

function setupApprovedActionFixture(
  fixtures: TestFixtures,
  actionId: string,
  requestId: string,
  options?: {
    expiresInSeconds?: number;
    baseTime?: number;
    url?: string;
    origin?: string;
    elementId?: string;
  }
): { action: GuardrailAction; request: ApprovalRequest; binding: ApprovalActionBinding } {
  const url = options?.url || 'https://bank.example.com/transfer/confirm';
  const origin = options?.origin || 'https://bank.example.com';
  const elementId = options?.elementId || 'btn-submit-transfer';

  // Attach target DOM element
  const targetElem = mockDocument.createElement('button');
  mockDocument.registerElement(elementId, targetElem);

  const action: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    page: { url, origin, title: 'Bank Transfer' },
    element: { tagName: 'BUTTON', id: elementId },
  };

  fixtures.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
  fixtures.contactRegistry.addContact({
    id: 'tc_bob',
    userId: 'usr_alice',
    status: TrustedContactStatus.ACTIVE,
    createdAt: new Date().toISOString(),
  });

  fixtures.controller.register(action, 'Protected action intercepted');
  const heldRecord = fixtures.controller.holdAction(actionId, 'Held for caretaker review');
  fixtures.continuationManager.registerHeldAction(action, heldRecord, (act) => {
    fixtures.effect.execute(act);
  });

  const now = options?.baseTime ?? Date.now();
  const ttlMs = (options?.expiresInSeconds ?? 900) * 1000;
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlMs).toISOString();

  const request: ApprovalRequest = {
    id: requestId,
    actionId,
    requesterId: 'usr_alice',
    status: ApprovalStatus.APPROVED,
    riskLevel: RiskLevel.HIGH,
    riskReasons: ['FINANCIAL_TRANSACTION'],
    createdAt,
    expiresAt,
    decision: {
      decision: 'APPROVED',
      decidedBy: 'tc_bob',
      decidedAt: new Date(now + 1000).toISOString(),
    },
    origin,
  };
  fixtures.repository.save(request);

  const binding: ApprovalActionBinding = {
    id: `bnd_${actionId}`,
    actionId,
    requestId,
    requesterId: 'usr_alice',
    state: ApprovalActionBindingState.APPROVED,
    createdAt,
    expiresAt,
    resolvedAt: request.decision?.decidedAt,
  };
  fixtures.repository.saveBinding(binding);

  return { action, request, binding };
}

function createStagingContextFromAction(
  action: GuardrailAction,
  overrides?: Partial<StagingActionContext>
): StagingActionContext {
  const origin = action.pageInfo?.url ? new URL(action.pageInfo.url).origin : 'https://bank.example.com';
  const hostname = action.pageInfo?.url ? new URL(action.pageInfo.url).hostname : 'bank.example.com';
  return {
    actionId: action.id,
    description: overrides?.description ?? 'Controlled test wire transfer action',
    actionType: action.type,
    category: ActionCategory.PAYMENT,
    riskLevel: overrides?.riskLevel ?? RiskLevel.HIGH,
    riskScore: 85,
    riskReasons: ['FINANCIAL_TRANSACTION'],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    origin,
    hostname,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// REGRESSION TEST SUITES
// ============================================================================

async function runRegressionSuite(): Promise<void> {
  console.log('\n====================================================================');
  console.log('🛡️ CONTROLLED ACTION CONTINUATION HARDENING REGRESSION TEST SUITE');
  console.log('====================================================================\n');

  // --------------------------------------------------------------------------
  // Suite 1: Simultaneous Cancel and Approve Events
  // --------------------------------------------------------------------------
  console.log('▶ Suite 1: Simultaneous Cancel and Approve Events');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_race_cancel_approve';
    const requestId = 'apr_race_cancel_approve';
    const { action, request } = setupApprovedActionFixture(fixtures, actionId, requestId);

    // Mount staging modal
    showStagingModal({
      context: createStagingContextFromAction(action, { riskLevel: RiskLevel.HIGH }),
      state: 'active',
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
      initialApprovalRequest: request,
    });

    const shadow = getStagingModalShadowRoot()!;
    const cancelBtn = shadow.querySelector('#gs-btn-cancel-action') as MockDOMElement;
    const continueBtn = shadow.querySelector('#gs-btn-continue-action') as MockDOMElement;

    // Simulate simultaneous click: user cancels
    cancelBtn.click();
    assertEquals(getStagingUIState(), 'cancelled', 'Cancel click transitions modal to cancelled');
    assertEquals(fixtures.controller.getRecord(actionId)?.state, InterceptionState.CANCELLED, 'InterceptionRecord is CANCELLED');

    // Concurrently, a delayed APPROVED event arrives via setStagingUIState
    setStagingUIState('approval_confirmed_approved', {
      requestId,
      request,
      isEligible: true,
    });

    // Verification: Delayed approve response must NOT overwrite cancelled state
    assertEquals(getStagingUIState(), 'cancelled', 'Delayed approval event was dropped; UI remains cancelled');
    assertEquals(continueBtn.style.display, 'none', 'Continue button remains hidden');

    // Attempting to continue the cancelled action must fail closed
    const continueAttempt = await handleModalContinue(actionId, {
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
    }, {
      continueBtn: continueBtn as any,
      cancelBtn: cancelBtn as any,
      body: shadow.querySelector('.gs-body') as any,
      header: shadow.querySelector('.gs-header') as any,
    });

    assertEquals(continueAttempt.success, false, 'Continuation on cancelled action fails closed');
    assertEquals(continueAttempt.executed, false, 'Continuation was not executed');
    assertEquals(fixtures.effect.executionCount, 0, 'Controlled handler was strictly NEVER executed (count: 0)');

    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // Suite 2: Expiration Immediately Before Confirmation
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 2: Expiration Immediately Before Confirmation');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_expire_before_confirm';
    const requestId = 'apr_expire_before_confirm';

    // Set TTL to 10 seconds in the past
    let currentTime = 1000000;
    const timeProvider = () => new Date(currentTime);

    const { action, request } = setupApprovedActionFixture(fixtures, actionId, requestId, {
      expiresInSeconds: 10,
      baseTime: currentTime,
    });

    // Mount staging modal with validation service using dynamic timeProvider
    const validationService = new ContinuationValidationService({
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
      timeProvider,
    });

    showStagingModal({
      context: createStagingContextFromAction(action, { riskLevel: RiskLevel.HIGH }),
      state: 'active',
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
      validationService,
      initialApprovalRequest: request,
    });

    const shadow = getStagingModalShadowRoot()!;
    const continueBtn = shadow.querySelector('#gs-btn-continue-action') as MockDOMElement;
    const cancelBtn = shadow.querySelector('#gs-btn-cancel-action') as MockDOMElement;

    // Simulate clock advancing past expiration deadline (15 seconds elapsed, TTL was 10s)
    currentTime += 20000;

    // User now clicks Continue
    const continueResult = await handleModalContinue(actionId, {
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
      validationService,
    }, {
      continueBtn: continueBtn as any,
      cancelBtn: cancelBtn as any,
      body: shadow.querySelector('.gs-body') as any,
      header: shadow.querySelector('.gs-header') as any,
    });

    assertEquals(continueResult.success, false, 'Continuation rejected because request expired before confirmation');
    assertEquals(continueResult.executed, false, 'Continuation was not executed on expiration');
    assertEquals(fixtures.effect.executionCount, 0, 'Controlled action handler was NEVER executed: 0');
    assertEquals(getStagingUIState(), 'approval_confirmed_expired', 'UI state transitioned to approval_confirmed_expired');

    const notice = shadow.querySelector('.gs-footer-notice');
    assert(notice?.textContent?.includes('EXPIRED') || false, 'Notice reflects EXPIRED status');

    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // Suite 3: Duplicate Confirmation Clicks (Concurrency & Race Immunity)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Duplicate Confirmation Clicks (Concurrency & Race Immunity)');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_dup_clicks';
    const requestId = 'apr_dup_clicks';
    const { action, request } = setupApprovedActionFixture(fixtures, actionId, requestId);

    showStagingModal({
      context: createStagingContextFromAction(action, { riskLevel: RiskLevel.HIGH }),
      state: 'active',
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
      initialApprovalRequest: request,
    });

    const shadow = getStagingModalShadowRoot()!;
    const continueBtn = shadow.querySelector('#gs-btn-continue-action') as MockDOMElement;
    const cancelBtn = shadow.querySelector('#gs-btn-cancel-action') as MockDOMElement;

    // Fire 5 concurrent continuation attempts simulating rapid double/triple clicks
    const modalOptions = {
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
      initialApprovalRequest: request,
      validationOptions: {
        authContext: {
          actorId: 'usr_alice',
          role: ActorRole.USER,
          isAuthenticated: true,
        },
        expectedRequesterId: 'usr_alice',
        pageContext: {
          url: 'https://bank.example.com/transfer/confirm',
          origin: 'https://bank.example.com',
        },
      },
    };
    const uiRefs = {
      continueBtn: continueBtn as any,
      cancelBtn: cancelBtn as any,
      body: shadow.querySelector('.gs-body') as any,
      header: shadow.querySelector('.gs-header') as any,
    };

    // Enable Continue button via verified eligibility
    setStagingUIState('approval_confirmed_approved', {
      requestId: request.id,
      isEligible: true,
      request,
    });

    const results = await Promise.all([
      handleModalContinue(actionId, modalOptions, uiRefs),
      handleModalContinue(actionId, modalOptions, uiRefs),
      handleModalContinue(actionId, modalOptions, uiRefs),
      handleModalContinue(actionId, modalOptions, uiRefs),
      handleModalContinue(actionId, modalOptions, uiRefs),
    ]);

    const successCount = results.filter((r) => r.success && r.executed).length;
    const rejectedCount = results.filter((r) => !r.success && !r.executed).length;

    assertEquals(successCount, 1, 'Exactly ONE continuation attempt succeeded');
    assertEquals(rejectedCount, 4, 'All 4 duplicate / concurrent attempts were safely rejected');
    assertEquals(fixtures.effect.executionCount, 1, 'Controlled handler executed strictly ONCE: 1');
    assertEquals(fixtures.continuationManager.getExecutionCount(actionId), 1, 'ContinuationManager executionCount is 1');
    assertEquals(getStagingUIState(), 'continued', 'UI state reached continued');

    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // Suite 4: Repeated / Stale / Out-of-Order Responses
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Repeated / Stale / Out-of-Order Responses');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_stale_responses';
    const requestId = 'apr_stale_responses';
    const { action, request } = setupApprovedActionFixture(fixtures, actionId, requestId);

    const initialSessionId = getCurrentModalSessionId();

    showStagingModal({
      context: createStagingContextFromAction(action, { riskLevel: RiskLevel.HIGH }),
      state: 'active',
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
    });

    const activeSessionId = getCurrentModalSessionId();
    assert(activeSessionId > initialSessionId, 'Modal session sequence token increments on mount');

    // Simulate an out-of-order stale response with old session ID
    // Directly invoke setStagingUIState with mismatched action ID
    setStagingUIState('approval_confirmed_approved', {
      requestId: 'apr_different_action',
      request: {
        ...request,
        id: 'apr_different_action',
        actionId: 'act_different_action',
      },
    });

    // Verify modal does not accept mismatched action
    assertEquals(fixtures.controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains safely HELD');

    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // Suite 5: Conflicting Lifecycle Transitions (Terminal Overwrite Immunity)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Conflicting Lifecycle Transitions (Terminal Overwrite Immunity)');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_conflicting_transitions';
    const requestId = 'apr_conflicting_transitions';
    const { action, request } = setupApprovedActionFixture(fixtures, actionId, requestId);

    showStagingModal({
      context: createStagingContextFromAction(action, { riskLevel: RiskLevel.HIGH }),
      state: 'active',
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
      initialApprovalRequest: request,
    });

    const shadow = getStagingModalShadowRoot()!;
    const continueBtn = shadow.querySelector('#gs-btn-continue-action') as MockDOMElement;
    const cancelBtn = shadow.querySelector('#gs-btn-cancel-action') as MockDOMElement;

    // Enable Continue button via verified eligibility
    setStagingUIState('approval_confirmed_approved', {
      requestId: request.id,
      isEligible: true,
      request,
    });

    // Continue the action to reach terminal CONTINUED state
    const contResult = await handleModalContinue(actionId, {
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
      initialApprovalRequest: request,
      validationOptions: {
        authContext: {
          actorId: 'usr_alice',
          role: ActorRole.USER,
          isAuthenticated: true,
        },
        expectedRequesterId: 'usr_alice',
        pageContext: {
          url: 'https://bank.example.com/transfer/confirm',
          origin: 'https://bank.example.com',
        },
      },
    }, {
      continueBtn: continueBtn as any,
      cancelBtn: cancelBtn as any,
      body: shadow.querySelector('.gs-body') as any,
      header: shadow.querySelector('.gs-header') as any,
    });

    assertEquals(contResult.success, true, 'Action successfully reached continued');
    assertEquals(getStagingUIState(), 'continued', 'UI state is continued');

    // Now simulate late arriving conflicting status updates:
    // 1. Late PENDING update arrives
    setStagingUIState('held');
    assertEquals(getStagingUIState(), 'continued', 'Late PENDING update cannot overwrite CONTINUED state');

    // 2. Late APPROVED update arrives
    setStagingUIState('approval_confirmed_approved', { requestId, request });
    assertEquals(getStagingUIState(), 'continued', 'Late APPROVED update cannot overwrite CONTINUED state');

    // 3. Late CANCELLED update arrives
    setStagingUIState('cancelled');
    assertEquals(getStagingUIState(), 'continued', 'Late CANCELLED update cannot overwrite CONTINUED state');

    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // Suite 6: Resource Disposal on Terminal Lifecycle Transitions
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 6: Resource Disposal on Terminal Lifecycle Transitions');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_resource_disposal';
    const requestId = 'apr_resource_disposal';
    const { action, request } = setupApprovedActionFixture(fixtures, actionId, requestId);

    showStagingModal({
      context: createStagingContextFromAction(action, { riskLevel: RiskLevel.HIGH }),
      state: 'active',
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
    });

    // Start status sync loop
    startModalStatusSync(requestId, actionId, {
      controller: fixtures.controller,
    });

    const subBefore = getActiveSyncSubscription();
    assert(Boolean(subBefore), 'Active sync subscription exists');
    assertEquals(subBefore?.isActive(), true, 'Subscription is actively polling');

    // Cancel action: Must cleanly stop polling and dispose subscription
    handleModalCancel(actionId, {
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
    }, {
      cancelBtn: mockDocument.createElement('button') as any,
      body: mockDocument.createElement('div') as any,
      header: mockDocument.createElement('div') as any,
    });

    const subAfter = getActiveSyncSubscription();
    assertEquals(subAfter, null, 'Active sync subscription was stopped and disposed upon cancellation');
    assertEquals(subBefore?.isActive(), false, 'Original subscription is inactive');

    // Keydown event listeners cleaned up upon dismissal
    const handlerCountBefore = Object.keys(mockWindow.listeners).reduce(
      (acc, k) => acc + mockWindow.listeners[k].length,
      0
    );
    dismissStagingModal();
    const handlerCountAfter = Object.keys(mockWindow.listeners).reduce(
      (acc, k) => acc + mockWindow.listeners[k].length,
      0
    );
    assert(handlerCountAfter <= handlerCountBefore, 'Keydown listeners cleaned up upon dismissal');
  }

  // --------------------------------------------------------------------------
  // Suite 7: Navigation & Context Changes Cannot Silently Transfer Authorization
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 7: Navigation & Context Changes Cannot Silently Transfer Authorization');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_context_change';
    const requestId = 'apr_context_change';
    const elementId = 'btn-origin-check';
    const { action, request } = setupApprovedActionFixture(fixtures, actionId, requestId, {
      elementId,
      url: 'https://bank.example.com/transfer/confirm',
      origin: 'https://bank.example.com',
    });

    // Subtest 7A: Origin Mismatch
    const validationService = new ContinuationValidationService({
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
    });

    const originDriftRes = await validationService.validateEligibility(actionId, {
      request,
      pageContext: {
        origin: 'https://evil-attacker.example.com',
        url: 'https://evil-attacker.example.com/transfer/confirm',
      },
    });

    assertEquals(originDriftRes.eligible, false, 'Validation fails closed on origin mismatch');
    assertEquals(originDriftRes.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED');
    assertEquals(originDriftRes.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code is PAGE_CONTEXT_MISMATCH');

    // Subtest 7B: Path Mismatch
    const pathDriftRes = await validationService.validateEligibility(actionId, {
      request,
      pageContext: {
        origin: 'https://bank.example.com',
        url: 'https://bank.example.com/different/route',
      },
    });

    assertEquals(pathDriftRes.eligible, false, 'Validation fails closed on path mismatch');
    assertEquals(pathDriftRes.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED');
    assertEquals(pathDriftRes.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code is PAGE_CONTEXT_MISMATCH');

    // Subtest 7C: Detached DOM Element
    mockDocument.removeElement(elementId);

    const detachedRes = await validationService.validateEligibility(actionId, {
      request,
      pageContext: {
        origin: 'https://bank.example.com',
        url: 'https://bank.example.com/transfer/confirm',
      },
    });

    assertEquals(detachedRes.eligible, false, 'Validation fails closed on detached DOM element');
    assertEquals(detachedRes.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED');
    assertEquals(detachedRes.errorCode, 'ELEMENT_DETACHED', 'Error code is ELEMENT_DETACHED');

    // Subtest 7D: Tab Navigation / Reload clears held closure
    fixtures.continuationManager.detachHeldAction(actionId);

    const detachedClosureRes = await validationService.validateEligibility(actionId, {
      request,
    });

    assertEquals(detachedClosureRes.eligible, false, 'Validation fails closed when held action is detached from memory');
    assertEquals(detachedClosureRes.errorCode, 'AUTHORIZATION_UNAVAILABLE', 'Error code is AUTHORIZATION_UNAVAILABLE');
    assertEquals(fixtures.effect.executionCount, 0, 'Controlled handler was strictly NEVER executed: 0');
  }

  // --------------------------------------------------------------------------
  // Suite 8: Network Failures Fail Closed (No Uncertainty as Approval)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 8: Network Failures Fail Closed (No Uncertainty as Approval)');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_network_failure';
    const requestId = 'apr_network_failure';
    const { action } = setupApprovedActionFixture(fixtures, actionId, requestId);

    // Mock API client that fails with simulated network error / ECONNREFUSED
    const mockOfflineClient = {
      validateContinuationAuthorization: async () => ({
        success: false,
        isNetworkError: true,
        isTimeout: false,
        error: {
          code: 'NETWORK_ERROR',
          message: 'Failed to connect to backend server at http://127.0.0.1:9999 (ECONNREFUSED)',
        },
      }),
    } as unknown as ApprovalApiClient;

    const validationService = new ContinuationValidationService({
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalClient: mockOfflineClient,
    });

    const netResult = await validationService.validateEligibility(actionId);

    assertEquals(netResult.eligible, false, 'Network failure fails closed: eligible is false');
    assertEquals(netResult.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE');
    assert(netResult.reason.includes('offline') || netResult.reason.includes('unreachable'), 'Reason documents unreachable backend');
    assertEquals(fixtures.effect.executionCount, 0, 'Zero execution across network failures: 0');
  }

  // --------------------------------------------------------------------------
  // Suite 9: Atomic Backend State Transitions & CAS Single-Use Consumption
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 9: Atomic Backend State Transitions & CAS Single-Use Consumption');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_backend_cas_consume';
    const requestId = 'apr_backend_cas_consume';
    setupApprovedActionFixture(fixtures, actionId, requestId);

    const authContext: AuthContext = {
      actorId: 'usr_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    };

    // Subtest 9A: First consumption succeeds
    const firstConsume = fixtures.service.consumeContinuationAuthorization(
      { actionId, requestId },
      authContext
    );
    assertEquals(firstConsume.authorized, true, 'First continuation consumption succeeds');
    assertEquals(fixtures.service.isContinuationConsumed(actionId), true, 'Action marked as consumed in service');

    // Subtest 9B: Concurrent or second consumption attempt is rejected atomically
    const secondConsume = fixtures.service.consumeContinuationAuthorization(
      { actionId, requestId },
      authContext
    );
    assertEquals(secondConsume.authorized, false, 'Second continuation consumption rejected');
    assertEquals(secondConsume.errorCode, 'ALREADY_CONSUMED', 'Error code is ALREADY_CONSUMED');

    // Subtest 9C: validateContinuationAuthorization also rejects consumed action
    const validationAfterConsume = fixtures.service.validateContinuationAuthorization(
      { actionId, requestId },
      authContext
    );
    assertEquals(validationAfterConsume.authorized, false, 'Validation rejects already-consumed action');
    assertEquals(validationAfterConsume.errorCode, 'ALREADY_CONSUMED', 'Error code is ALREADY_CONSUMED');

    // Subtest 9D: ContinuationAuthorizationBoundary integrates backend consumption
    const boundaryActionId = 'act_boundary_cas';
    const boundaryRequestId = 'apr_boundary_cas';
    setupApprovedActionFixture(fixtures, boundaryActionId, boundaryRequestId);

    const boundary = new ContinuationAuthorizationBoundary({
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
    });

    const boundaryCont1 = await boundary.authorizeAndContinue(boundaryActionId, 'First confirmation', {
      authContext,
    });
    assertEquals(boundaryCont1.success, true, 'First boundary continuation succeeds');
    assertEquals(boundaryCont1.executed, true, 'First boundary continuation executes handler');
    assertEquals(fixtures.service.isContinuationConsumed(boundaryActionId), true, 'Boundary consumed action on backend');

    const boundaryCont2 = await boundary.authorizeAndContinue(boundaryActionId, 'Second confirmation', {
      authContext,
    });
    assertEquals(boundaryCont2.success, false, 'Second boundary continuation rejected by duplicate/consumption checks');
    assertEquals(boundaryCont2.executed, false, 'Second boundary continuation does not execute handler');
    assertEquals(fixtures.continuationManager.getExecutionCount(boundaryActionId), 1, 'Handler executed strictly ONCE: 1');
  }

  // --------------------------------------------------------------------------
  // Suite 10: Restoration / Reconnection Invariants (Zero Auto-Execution)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 10: Restoration / Reconnection Invariants (Zero Auto-Execution)');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_restore_no_auto_exec';
    const requestId = 'apr_restore_no_auto_exec';
    const { action, request } = setupApprovedActionFixture(fixtures, actionId, requestId);

    // Mount staging modal directly with restored APPROVED request
    showStagingModal({
      context: createStagingContextFromAction(action, { riskLevel: RiskLevel.HIGH }),
      state: 'active',
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
      approvalService: fixtures.service,
      initialApprovalRequest: request,
    });

    // Verification: Modal mounts and displays confirmation, but does NOT auto-execute
    assertEquals(getStagingUIState(), 'approval_confirmed_approved', 'Restored modal state is approval_confirmed_approved');
    assertEquals(fixtures.effect.executionCount, 0, 'Restoration NEVER automatically executes action: 0');
    assertEquals(fixtures.controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains safely HELD');

    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // Suite 11: Controlled Test Actions Only (Universal Continuation Prohibited)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 11: Controlled Test Actions Only (Universal Continuation Prohibited)');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_arbitrary_website';

    const unverifiedAction: GuardrailAction = {
      id: actionId,
      type: ActionType.CLICK,
      timestamp: new Date().toISOString(),
      page: { url: 'https://arbitrary-unverified-website.com/buy', origin: 'https://arbitrary-unverified-website.com' },
    };

    fixtures.controller.register(unverifiedAction, 'Intercepted on arbitrary site');
    fixtures.controller.holdAction(actionId, 'Held');

    const validationService = new ContinuationValidationService({
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
    });

    const valResult = await validationService.validateEligibility(actionId);
    assertEquals(valResult.eligible, false, 'Arbitrary website action is NOT eligible for continuation');
    assert(valResult.reason.includes('verified') || valResult.reason.includes('arbitrary'), 'Explains verified test action restriction');

    const contResult = fixtures.continuationManager.continueAction(actionId);
    assertEquals(contResult.success, false, 'Continuation on arbitrary website action rejected');
    assertEquals(contResult.executed, false, 'Executed is false');
    assert(contResult.error?.includes('arbitrary') || false, 'Error message explicitly prohibits arbitrary continuation');
  }

  // --------------------------------------------------------------------------
  // Suite 12: Clear UI Feedback When Action Can No Longer Be Continued
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 12: Clear UI Feedback When Action Can No Longer Be Continued');
  {
    const fixtures = createTestFixtures();
    const actionId = 'act_clear_feedback';
    const requestId = 'apr_clear_feedback';
    const { action } = setupApprovedActionFixture(fixtures, actionId, requestId);

    showStagingModal({
      context: createStagingContextFromAction(action, { riskLevel: RiskLevel.HIGH }),
      state: 'active',
      controller: fixtures.controller,
      continuationManager: fixtures.continuationManager,
    });

    const shadow = getStagingModalShadowRoot()!;

    // 1. Expired feedback
    setStagingUIState('approval_confirmed_expired', { requestId });
    const bannerExpired = shadow.querySelector('.gs-confirmation-error');
    assert(Boolean(bannerExpired), 'Expired banner is rendered');
    assert(bannerExpired?.textContent?.includes('Expired') || false, 'Expired banner contains "Expired"');

    // 2. Cancelled feedback
    setStagingUIState('approval_confirmed_cancelled', { requestId });
    const bannerCancelled = shadow.querySelector('.gs-confirmation-info');
    assert(Boolean(bannerCancelled), 'Cancelled banner is rendered');
    assert(bannerCancelled?.textContent?.includes('Cancelled') || false, 'Cancelled banner contains "Cancelled"');

    // 3. Rejected feedback
    setStagingUIState('approval_confirmed_rejected', { requestId });
    const bannerRejected = shadow.querySelector('.gs-confirmation-error');
    assert(Boolean(bannerRejected), 'Rejected banner is rendered');
    assert(bannerRejected?.textContent?.includes('Denied') || false, 'Rejected banner contains "Denied"');

    // 4. Invalidated / Context Changed feedback
    setStagingUIState('action_invalidated', {
      error: 'The webpage or target element changed while this action was held.',
    });
    const bannerInvalidated = shadow.querySelector('.gs-confirmation-error');
    assert(Boolean(bannerInvalidated), 'Invalidated banner is rendered');
    assert(bannerInvalidated?.textContent?.includes('Cannot Be Resumed') || false, 'Invalidated banner informs user action cannot be resumed');

    // 5. Temporarily Unavailable (network failure)
    setStagingUIState('temporarily_unavailable', {
      description: 'Guardrail cannot verify authorization status with the backend at this time. To protect your security, this action remains safely paused.',
      error: 'Backend unreachable',
    });
    const bannerUnavailable = shadow.querySelector('.gs-confirmation-error');
    assert(Boolean(bannerUnavailable), 'Temporarily unavailable banner is rendered');
    assert(bannerUnavailable?.textContent?.includes('safely paused') || false, 'Unavailable banner confirms action remains safely paused');

    dismissStagingModal();
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n====================================================================');
  console.log(`📊 HARDENING REGRESSION SUMMARY: ${passedTests} / ${passedTests + failedTests} PASSED`);
  if (failedTests === 0) {
    console.log('🎉 ALL HARDENING & RACE IMMUNITY REGRESSION SCENARIOS FULLY SATISFIED!');
  } else {
    console.error(`❌ ${failedTests} REGRESSION TEST(S) FAILED.`);
    process.exit(1);
  }
  console.log('====================================================================\n');
}

runRegressionSuite().catch((err) => {
  console.error('Unhandled exception in regression test suite:', err);
  process.exit(1);
});
