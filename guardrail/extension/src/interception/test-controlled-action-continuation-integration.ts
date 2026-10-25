/**
 * Guardrail Controlled Action Continuation Integration Test Suite
 *
 * Verifies the end-to-end integration of explicit user confirmation with the
 * controlled continuation mechanism, strictly restricted to explicitly registered
 * test actions with verified resumption behavior:
 *
 * Requirements Verified:
 * 1. User must explicitly select Continue.
 * 2. Backend-confirmed approval and exact action binding revalidated immediately before continuation.
 * 3. Held action verified eligible (not cancelled, expired, invalidated, or consumed).
 * 4. Controlled action handler executed directly (zero synthetic DOM click replay).
 * 5. Monotonic exactly-once execution (handler executes at most once).
 * 6. Duplicate, stale, and conflicting continuation attempts rejected.
 * 7. Risk-engine and staging requirements preserved.
 * 8. Action kept HELD if required validation fails.
 * 9. Fail-closed if original page context (origin, path, DOM element attachment) changed.
 * 10. No automatic continuation upon approval status transition.
 * 11. No automatic submission of real forms or consequential operations; arbitrary websites rejected.
 * 12. No storage or transmission of sensitive form values.
 * 13. Documented architectural limitations (including lack of atomic server-side consumption CAS).
 */

declare const process: { exit: (code: number) => void };

import { ActionType, GuardrailAction } from '../types/actions.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { InterceptionController } from './controller.js';
import { ContinuationManager } from './continuation.js';
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
  setStagingUIState,
  getStagingUIState,
  getStagingModalShadowRoot,
} from '../staging/modal.js';
import { StagingContext } from '../staging/context.js';

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
// ISOLATED HARMLESS OBSERVABLE EFFECT
// ============================================================================

interface ObservableEffectInvocation {
  actionId: string;
  timestamp: number;
  payload?: any;
  elementTag?: string;
}

class HarmlessObservableEffect {
  public executionCount: number = 0;
  public invocations: ObservableEffectInvocation[] = [];
  public domClickCount: number = 0;

  public execute(action: GuardrailAction): void {
    this.executionCount++;
    this.invocations.push({
      actionId: action.id,
      timestamp: Date.now(),
      payload: action.payload,
      elementTag: action.element?.tagName,
    });
  }

  public recordDomClick(): void {
    this.domClickCount++;
  }

  public reset(): void {
    this.executionCount = 0;
    this.invocations = [];
    this.domClickCount = 0;
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
  public classList: MockDOMTokenList;
  public disabled: boolean = false;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockDOMTokenList();
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
    if (name === 'class') this.classList = new MockDOMTokenList(value);
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
  if (trimmed.startsWith('.')) return el.classList.contains(trimmed.slice(1));
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const attrName = trimmed.slice(1, -1);
    return el.getAttribute(attrName) !== null;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

// Global window and document mock
class MockWindow {
  public location = {
    href: 'https://bank.example.com/transfer/confirm',
    origin: 'https://bank.example.com',
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
  dispatchEvent(event: any): void {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        listener(event);
      }
    }
  }
}

const mockWin = new MockWindow();
const mockBody = new MockDOMElement('BODY');
const mockDocument = {
  body: mockBody,
  createElement: (tag: string) => new MockDOMElement(tag),
  getElementById: (id: string) => mockBody.querySelector(`#${id}`),
  querySelector: (sel: string) => mockBody.querySelector(sel),
  querySelectorAll: (sel: string) => mockBody.querySelectorAll(sel),
  addEventListener: (ev: string, fn: any) => mockBody.addEventListener(ev, fn),
  removeEventListener: (ev: string, fn: any) => mockBody.removeEventListener(ev, fn),
  dispatchEvent: (ev: any) => mockBody.dispatchEvent(ev),
};

(globalThis as any).window = mockWin;
(globalThis as any).document = mockDocument;
(globalThis as any).CustomEvent = class {
  public type: string;
  public detail: any;
  public bubbles: boolean;
  constructor(type: string, init?: { detail?: any; bubbles?: boolean }) {
    this.type = type;
    this.detail = init?.detail;
    this.bubbles = Boolean(init?.bubbles);
  }
};

// ============================================================================
// HARNESS BUILDER
// ============================================================================

interface TestHarness {
  service: ApprovalService;
  repository: DevelopmentInMemoryApprovalRequestRepository;
  contactRegistry: InMemoryTrustedContactRegistry;
  actionOwnershipRegistry: InMemoryActionOwnershipRegistry;
  controller: InterceptionController;
  continuationManager: ContinuationManager;
  validationService: ContinuationValidationService;
  observableEffect: HarmlessObservableEffect;
  aliceAuth: AuthContext;
  bobAuth: AuthContext;
  currentTime: string;
  setTime: (t: string) => void;
}

function createIntegrationHarness(initialTime: string = '2026-10-26T12:00:00.000Z'): TestHarness {
  let currentTime = initialTime;
  const timeProvider = () => currentTime;

  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();

  const service = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    timeProvider,
  });

  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);
  const validationService = new ContinuationValidationService({
    controller,
    continuationManager,
    approvalService: service,
    timeProvider,
  });

  const observableEffect = new HarmlessObservableEffect();

  const aliceAuth: AuthContext = {
    actorId: 'usr_alice',
    role: ActorRole.USER,
    isAuthenticated: true,
  };

  const bobAuth: AuthContext = {
    actorId: 'usr_contact_bob',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  };

  // Configure trusted contact
  contactRegistry.addContact({
    id: 'usr_contact_bob',
    userId: 'usr_alice',
    status: TrustedContactStatus.ACTIVE,
    createdAt: initialTime,
    relationshipLabel: 'Finance Manager',
  });

  // Reset window location
  mockWin.location.href = 'https://bank.example.com/transfer/confirm';
  mockWin.location.origin = 'https://bank.example.com';

  return {
    service,
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    controller,
    continuationManager,
    validationService,
    observableEffect,
    aliceAuth,
    bobAuth,
    get currentTime() {
      return currentTime;
    },
    setTime: (t: string) => {
      currentTime = t;
    },
  };
}

function createStagingContext(actionId: string, overrides: Partial<StagingContext> = {}): StagingContext {
  return {
    actionId,
    mode: 'staged',
    riskLevel: 'HIGH',
    riskScore: 85,
    reasons: ['Protected high-value financial transaction'],
    stagedAt: new Date().toISOString(),
    actionSummary: {
      type: 'CLICK',
      targetDescription: 'Authorize Wire Transfer',
      pageTitle: 'Bank Secure Transfer',
      domain: 'bank.example.com',
    },
    ...overrides,
  };
}

// ============================================================================
// TEST SUITES
// ============================================================================

async function runControlledContinuationIntegrationTests(): Promise<void> {
  console.log('\n====================================================================');
  console.log('🛡️ CONTROLLED ACTION CONTINUATION INTEGRATION TEST SUITE');
  console.log('====================================================================');

  // --------------------------------------------------------------------------
  // SUITE 1: Explicit User Confirmation Required & Zero Auto-Continuation
  // (Requirements 1, 4, 10)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 1: Explicit User Confirmation Required (No Auto-Continuation)');
  {
    const h = createIntegrationHarness();
    const actionId = 'act_suite1_explicit';

    // 1. Create registered DOM element & attach click listener to detect any DOM replay
    const buttonEl = mockDocument.createElement('button');
    buttonEl.setAttribute('id', 'btn-test-action');
    buttonEl.setAttribute('data-guardrail-test-action', 'true');
    buttonEl.addEventListener('click', () => {
      h.observableEffect.recordDomClick();
    });
    mockBody.appendChild(buttonEl);

    const action: GuardrailAction = {
      id: actionId,
      type: ActionType.CLICK,
      timestamp: h.currentTime,
      page: {
        url: 'https://bank.example.com/transfer/confirm',
        title: 'Confirm Transfer',
      },
      element: {
        tagName: 'BUTTON',
        id: 'btn-test-action',
        visibleText: 'Submit Transfer',
      },
    };

    h.controller.register(action, 'User clicked action button');
    const heldRecord = h.controller.holdAction(actionId, 'Held for trusted contact approval');

    // Register with isolated harmless observable effect
    h.continuationManager.registerHeldAction(action, heldRecord, (act) => {
      h.observableEffect.execute(act);
    });

    // 2. Submit approval request bound to this action
    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    const req = h.service.createRequest(
      {
        actionId,
        actionType: ActionType.CLICK,
        actionDescription: 'Authorize $500 Wire Transfer',
        riskLevel: RiskLevel.HIGH,
      },
      h.aliceAuth
    );

    // 3. Mount staging modal with authoritative validation context
    showStagingModal({
      context: createStagingContext(actionId),
      state: 'active',
      controller: h.controller,
      continuationManager: h.continuationManager,
      validationService: h.validationService,
      initialApprovalRequest: req,
      validationOptions: {
        authContext: h.aliceAuth,
        expectedRequesterId: 'usr_alice',
        pageContext: {
          url: 'https://bank.example.com/transfer/confirm',
          origin: 'https://bank.example.com',
        },
      },
    });

    // 4. Trusted contact approves the request on backend
    h.service.approveRequest(
      req.id,
      { decisionReason: 'Approved via secure channel' },
      h.bobAuth
    );

    const backendApprovedReq = h.service.getRequest(req.id, h.aliceAuth);
    assertEquals(backendApprovedReq.status, ApprovalStatus.APPROVED, 'Backend confirms request is APPROVED');

    // Update modal UI state to reflect approval received
    setStagingUIState('approval_confirmed_approved', {
      requestId: req.id,
      decidedBy: 'Bob Banker',
      isEligible: true,
      request: backendApprovedReq,
    });

    // INVIOLABLE CHECK 10: Auto-continuation MUST NOT occur when approval is received
    assertEquals(h.observableEffect.executionCount, 0, 'Harmless observable effect count is strictly 0 (no auto-continuation)');
    assertEquals(h.observableEffect.domClickCount, 0, 'DOM click count is strictly 0 (no DOM replay)');
    assertEquals(h.controller.getRecord(actionId)?.state, InterceptionState.HELD, 'InterceptionRecord remains HELD');

    // 5. User explicitly clicks "Continue Action"
    const shadow = getStagingModalShadowRoot();
    const continueBtn = shadow?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
    assert(Boolean(continueBtn), 'Continue Action button is present in confirmation dialog');
    assertEquals(continueBtn.disabled, false, 'Continue button is enabled after backend approval');

    // User triggers continuation
    continueBtn.click();
    await new Promise((r) => setTimeout(r, 60)); // drain async continuation handler

    // INVIOLABLE CHECK 1 & 4: Controlled handler executes once upon explicit user confirmation
    assertEquals(h.observableEffect.executionCount, 1, 'Harmless observable effect executed exactly ONCE');
    assertEquals(h.observableEffect.domClickCount, 0, 'DOM element click count remains 0 (NO synthetic DOM events emitted)');
    assertEquals(h.observableEffect.invocations[0].actionId, actionId, 'Executed action ID matches');
    assertEquals(h.controller.getRecord(actionId)?.state, InterceptionState.CONTINUED, 'Action transitioned to CONTINUED');
    assertEquals(getStagingUIState(), 'continued', 'UI state transitioned to continued');

    // Teardown
    buttonEl.remove();
    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // SUITE 2: Monotonic Exactly-Once Protection & Duplicate Continuation Rejection
  // (Requirements 5 & 6)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 2: Monotonic Exactly-Once Protection & Duplicate Continuation Rejection');
  {
    const h = createIntegrationHarness();
    const actionId = 'act_suite2_duplicate';

    const testButton = mockDocument.createElement('button');
    testButton.setAttribute('id', 'btn-suite2');
    testButton.setAttribute('data-guardrail-test-action', 'true');
    mockBody.appendChild(testButton);

    const action: GuardrailAction = {
      id: actionId,
      type: ActionType.CLICK,
      timestamp: h.currentTime,
      page: { url: 'https://bank.example.com/transfer/confirm', title: 'Transfer' },
      element: { tagName: 'BUTTON', id: 'btn-suite2' },
    };

    h.controller.register(action);
    const held = h.controller.holdAction(actionId);
    h.continuationManager.registerHeldAction(action, held, (act) => {
      h.observableEffect.execute(act);
    });

    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    const req = h.service.createRequest(
      {
        actionId,
        actionType: ActionType.CLICK,
        actionDescription: 'Test Transaction',
        riskLevel: RiskLevel.HIGH,
      },
      h.aliceAuth
    );

    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, h.bobAuth);
    const approvedReq = h.service.getRequest(req.id, h.aliceAuth);

    // Initial continuation succeeds
    showStagingModal({
      context: createStagingContext(actionId),
      state: 'active',
      controller: h.controller,
      continuationManager: h.continuationManager,
      validationService: h.validationService,
      initialApprovalRequest: approvedReq,
      validationOptions: {
        authContext: h.aliceAuth,
        expectedRequesterId: 'usr_alice',
        request: approvedReq,
        pageContext: {
          url: 'https://bank.example.com/transfer/confirm',
          origin: 'https://bank.example.com',
        },
      },
    });

    setStagingUIState('approval_confirmed_approved', {
      requestId: req.id,
      decidedBy: 'Bob',
      isEligible: true,
      request: approvedReq,
    });

    const shadow = getStagingModalShadowRoot();
    const continueBtn = shadow?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
    continueBtn.click();
    await new Promise((r) => setTimeout(r, 60));

    assertEquals(h.observableEffect.executionCount, 1, 'First continuation executed exactly once');

    // Subsequent continuation attempt 1: rapid / repeated click
    continueBtn.click();
    await new Promise((r) => setTimeout(r, 60));

    assertEquals(h.observableEffect.executionCount, 1, 'Execution count strictly remains 1 after duplicate click');

    // Subsequent continuation attempt 2: direct call on ContinuationManager
    const duplicateRes = h.continuationManager.continueAction(actionId);
    assertEquals(duplicateRes.success, false, 'Duplicate continuation call returns success: false');
    assertEquals(duplicateRes.executed, false, 'Duplicate continuation call returns executed: false');
    assert(duplicateRes.error?.includes('already executed') || duplicateRes.error?.includes('Only actions in HELD'), 'Duplicate error correctly documented');
    assertEquals(h.observableEffect.executionCount, 1, 'Execution count strictly remains 1 after direct duplicate invocation');

    testButton.remove();
    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // SUITE 3: Trusted Contact Rejection Fails Closed
  // (Requirements 3, 5, 8)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Trusted Contact Rejection Fails Closed');
  {
    const h = createIntegrationHarness();
    const actionId = 'act_suite3_rejected';

    const testButton = mockDocument.createElement('button');
    testButton.setAttribute('id', 'btn-suite3');
    testButton.setAttribute('data-guardrail-test-action', 'true');
    mockBody.appendChild(testButton);

    const action: GuardrailAction = {
      id: actionId,
      type: ActionType.CLICK,
      timestamp: h.currentTime,
      page: { url: 'https://bank.example.com/transfer/confirm', title: 'Transfer' },
      element: { tagName: 'BUTTON', id: 'btn-suite3' },
    };

    h.controller.register(action);
    const held = h.controller.holdAction(actionId);
    h.continuationManager.registerHeldAction(action, held, (act) => {
      h.observableEffect.execute(act);
    });

    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    const req = h.service.createRequest(
      {
        actionId,
        actionType: ActionType.CLICK,
        actionDescription: 'Suspicious Wire',
        riskLevel: RiskLevel.HIGH,
      },
      h.aliceAuth
    );

    // Contact REJECTS
    h.service.rejectRequest(req.id, { decisionReason: 'Fraud suspected' }, h.bobAuth);
    const rejectedReq = h.service.getRequest(req.id, h.aliceAuth);

    showStagingModal({
      context: createStagingContext(actionId),
      state: 'active',
      controller: h.controller,
      continuationManager: h.continuationManager,
      validationService: h.validationService,
      initialApprovalRequest: rejectedReq,
      validationOptions: {
        authContext: h.aliceAuth,
        expectedRequesterId: 'usr_alice',
        request: rejectedReq,
        pageContext: {
          url: 'https://bank.example.com/transfer/confirm',
          origin: 'https://bank.example.com',
        },
      },
    });

    setStagingUIState('approval_confirmed_rejected', {
      requestId: req.id,
      decidedBy: 'Bob',
      reason: 'Fraud suspected',
    });

    const shadow = getStagingModalShadowRoot();
    const actionBtn = (shadow?.querySelector('#gs-btn-continue-action') || shadow?.querySelector('#gs-btn-request-approval')) as unknown as MockDOMElement;
    assert(Boolean(actionBtn), 'Action button is present in modal');
    assertEquals(actionBtn.disabled, true, 'Action button is disabled for rejected request');
    assertEquals(actionBtn.textContent, 'Request Denied', 'Button displays "Request Denied"');

    // Attempt continuation directly via ContinuationManager with rejected request
    const contRes = h.continuationManager.continueAction(actionId, 'Attempt continuation', {
      actionId,
      request: rejectedReq,
    });
    assertEquals(contRes.success, false, 'Continuation on rejected action fails closed');
    assertEquals(contRes.executed, false, 'Handler executed is false');
    assert(Boolean(contRes.error?.includes('REJECTED')), 'Continuation rejected with REJECTED error');

    // Validate eligibility via ValidationService
    const validRes = await h.validationService.validateEligibility(actionId, {
      request: rejectedReq,
      authContext: h.aliceAuth,
    });
    assertEquals(validRes.eligible, false, 'Validation service marks rejected request ineligible');
    assertEquals(validRes.status, ContinuationEligibilityStatus.REJECTED, 'Status is REJECTED');

    assertEquals(h.observableEffect.executionCount, 0, 'Controlled handler was strictly NEVER executed (count: 0)');
    assertEquals(h.controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains safely HELD (Requirement 8)');

    testButton.remove();
    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // SUITE 4: Expiration via Trusted Server Clock Fails Closed
  // (Requirements 3, 5, 8)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Expiration via Trusted Clock Fails Closed');
  {
    const h = createIntegrationHarness('2026-10-26T12:00:00.000Z');
    const actionId = 'act_suite4_expired';

    const testButton = mockDocument.createElement('button');
    testButton.setAttribute('id', 'btn-suite4');
    testButton.setAttribute('data-guardrail-test-action', 'true');
    mockBody.appendChild(testButton);

    const action: GuardrailAction = {
      id: actionId,
      type: ActionType.CLICK,
      timestamp: h.currentTime,
      page: { url: 'https://bank.example.com/transfer/confirm', title: 'Transfer' },
      element: { tagName: 'BUTTON', id: 'btn-suite4' },
    };

    h.controller.register(action);
    const held = h.controller.holdAction(actionId);
    h.continuationManager.registerHeldAction(action, held, (act) => {
      h.observableEffect.execute(act);
    });

    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    const req = h.service.createRequest(
      {
        actionId,
        actionType: ActionType.CLICK,
        actionDescription: 'Expiring Transfer',
        riskLevel: RiskLevel.HIGH,
      },
      h.aliceAuth
    );

    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, h.bobAuth);
    const approvedReq = h.service.getRequest(req.id, h.aliceAuth);

    // Fast-forward trusted time past expiration (default window is 15 minutes = 900,000ms)
    h.setTime('2026-10-26T12:30:00.000Z');

    showStagingModal({
      context: createStagingContext(actionId),
      state: 'active',
      controller: h.controller,
      continuationManager: h.continuationManager,
      validationService: h.validationService,
      initialApprovalRequest: approvedReq,
      validationOptions: {
        authContext: h.aliceAuth,
        expectedRequesterId: 'usr_alice',
        request: approvedReq,
        pageContext: {
          url: 'https://bank.example.com/transfer/confirm',
          origin: 'https://bank.example.com',
        },
      },
    });

    setStagingUIState('approval_confirmed_approved', {
      requestId: req.id,
      decidedBy: 'Bob',
      isEligible: true,
      request: approvedReq,
    });

    const shadow = getStagingModalShadowRoot();
    const continueBtn = shadow?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
    continueBtn.click();
    await new Promise((r) => setTimeout(r, 60));

    assertEquals(h.observableEffect.executionCount, 0, 'Controlled handler was strictly NEVER executed on expiration');
    assertEquals(h.controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action record remains safely HELD (Requirement 8)');
    assertEquals(getStagingUIState(), 'approval_confirmed_expired', 'UI state transitioned to approval_confirmed_expired');

    testButton.remove();
    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // SUITE 5: Cancellation Gating (Action Kept Cancelled & Handler Never Executed)
  // (Requirements 3, 5, 8)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Cancellation Gating (Cancel Action Workflow)');
  {
    const h = createIntegrationHarness();
    const actionId = 'act_suite5_cancelled';

    const testButton = mockDocument.createElement('button');
    testButton.setAttribute('id', 'btn-suite5');
    testButton.setAttribute('data-guardrail-test-action', 'true');
    mockBody.appendChild(testButton);

    const action: GuardrailAction = {
      id: actionId,
      type: ActionType.CLICK,
      timestamp: h.currentTime,
      page: { url: 'https://bank.example.com/transfer/confirm', title: 'Transfer' },
      element: { tagName: 'BUTTON', id: 'btn-suite5' },
    };

    h.controller.register(action);
    const held = h.controller.holdAction(actionId);
    h.continuationManager.registerHeldAction(action, held, (act) => {
      h.observableEffect.execute(act);
    });

    showStagingModal({
      context: createStagingContext(actionId),
      state: 'active',
      controller: h.controller,
      continuationManager: h.continuationManager,
      validationService: h.validationService,
    });

    const shadow = getStagingModalShadowRoot();
    const cancelBtn = shadow?.querySelector('#gs-btn-cancel-action') as unknown as MockDOMElement;
    assert(Boolean(cancelBtn), 'Cancel button exists');

    // User clicks cancel button
    cancelBtn.click();

    assertEquals(getStagingUIState(), 'cancelled', 'UI state is cancelled');
    assertEquals(h.controller.getRecord(actionId)?.state, InterceptionState.CANCELLED, 'Record transitioned to CANCELLED');
    assertEquals(h.observableEffect.executionCount, 0, 'Handler execution count is 0 after cancel');

    // Attempting continuation on cancelled action must fail closed
    const continueBtn = shadow?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
    if (continueBtn) {
      continueBtn.click();
      await new Promise((r) => setTimeout(r, 60));
    }

    assertEquals(h.observableEffect.executionCount, 0, 'Handler execution count strictly remains 0');

    testButton.remove();
    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // SUITE 6: Mismatched Action Binding & Impostor Protection
  // (Requirements 2 & 8)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 6: Mismatched Action Binding & Impostor Protection');
  {
    const h = createIntegrationHarness();
    const actionAlpha = 'act_suite6_alpha';
    const actionBeta = 'act_suite6_beta';

    const testButton = mockDocument.createElement('button');
    testButton.setAttribute('id', 'btn-suite6');
    testButton.setAttribute('data-guardrail-test-action', 'true');
    mockBody.appendChild(testButton);

    const action: GuardrailAction = {
      id: actionAlpha,
      type: ActionType.CLICK,
      timestamp: h.currentTime,
      page: { url: 'https://bank.example.com/transfer/confirm', title: 'Transfer' },
      element: { tagName: 'BUTTON', id: 'btn-suite6' },
    };

    h.controller.register(action);
    const held = h.controller.holdAction(actionAlpha);
    h.continuationManager.registerHeldAction(action, held, (act) => {
      h.observableEffect.execute(act);
    });

    // Request is created and approved for actionBeta (NOT actionAlpha!)
    h.actionOwnershipRegistry.registerActionOwnership(actionBeta, 'usr_alice');
    const reqBeta = h.service.createRequest(
      {
        actionId: actionBeta,
        actionType: ActionType.CLICK,
        actionDescription: 'Transaction Beta',
        riskLevel: RiskLevel.HIGH,
      },
      h.aliceAuth
    );

    h.service.approveRequest(reqBeta.id, { decisionReason: 'Approved' }, h.bobAuth);
    const approvedBeta = h.service.getRequest(reqBeta.id, h.aliceAuth);

    // Attempt continuation of actionAlpha using reqBeta
    showStagingModal({
      context: createStagingContext(actionAlpha),
      state: 'active',
      controller: h.controller,
      continuationManager: h.continuationManager,
      validationService: h.validationService,
      initialApprovalRequest: approvedBeta,
      validationOptions: {
        authContext: h.aliceAuth,
        expectedRequesterId: 'usr_alice',
        request: approvedBeta,
        actionId: actionAlpha,
        pageContext: {
          url: 'https://bank.example.com/transfer/confirm',
          origin: 'https://bank.example.com',
        },
      },
    });

    setStagingUIState('approval_confirmed_approved', {
      requestId: reqBeta.id,
      decidedBy: 'Bob',
      isEligible: true,
      request: approvedBeta,
    });

    const shadow = getStagingModalShadowRoot();
    const continueBtn = shadow?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
    continueBtn.click();
    await new Promise((r) => setTimeout(r, 60));

    assertEquals(h.observableEffect.executionCount, 0, 'Handler was never executed on mismatched binding');
    assertEquals(h.controller.getRecord(actionAlpha)?.state, InterceptionState.HELD, 'Target action remains safely HELD');

    testButton.remove();
    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // SUITE 7: Page Context Drift & DOM Element Detachment Fail-Closed
  // (Requirement 9)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 7: Page Context Drift & DOM Element Detachment Fail-Closed');
  {
    const h = createIntegrationHarness();
    const actionId = 'act_suite7_drift';

    const testButton = mockDocument.createElement('button');
    testButton.setAttribute('id', 'btn-drift-target');
    testButton.setAttribute('data-guardrail-test-action', 'true');
    mockBody.appendChild(testButton);

    const action: GuardrailAction = {
      id: actionId,
      type: ActionType.CLICK,
      timestamp: h.currentTime,
      page: {
        url: 'https://bank.example.com/transfer/step3',
        title: 'Step 3',
      },
      element: {
        tagName: 'BUTTON',
        id: 'btn-drift-target',
      },
    };

    h.controller.register(action);
    const held = h.controller.holdAction(actionId);
    h.continuationManager.registerHeldAction(action, held, (act) => {
      h.observableEffect.execute(act);
    });

    h.actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');
    const req = h.service.createRequest(
      {
        actionId,
        actionType: ActionType.CLICK,
        actionDescription: 'Drifting Action',
        riskLevel: RiskLevel.HIGH,
      },
      h.aliceAuth
    );
    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, h.bobAuth);
    const approvedReq = h.service.getRequest(req.id, h.aliceAuth);

    // Case 7A: Origin drift (phishing / domain change)
    mockWin.location.origin = 'https://malicious.attacker.com';
    mockWin.location.href = 'https://malicious.attacker.com/transfer/step3';

    showStagingModal({
      context: createStagingContext(actionId),
      state: 'active',
      controller: h.controller,
      continuationManager: h.continuationManager,
      validationService: h.validationService,
      initialApprovalRequest: approvedReq,
      validationOptions: {
        authContext: h.aliceAuth,
        expectedRequesterId: 'usr_alice',
        request: approvedReq,
      },
    });

    setStagingUIState('approval_confirmed_approved', {
      requestId: req.id,
      decidedBy: 'Bob',
      isEligible: true,
      request: approvedReq,
    });

    const shadowA = getStagingModalShadowRoot();
    const continueBtnA = shadowA?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
    continueBtnA.click();
    await new Promise((r) => setTimeout(r, 60));

    assertEquals(h.observableEffect.executionCount, 0, 'Handler count is 0 on origin drift');
    assertEquals(getStagingUIState(), 'action_invalidated', 'UI transitioned to action_invalidated requiring user to restart');
    dismissStagingModal();

    // Reset origin
    mockWin.location.origin = 'https://bank.example.com';

    // Case 7B: Path drift (navigation within same origin)
    mockWin.location.href = 'https://bank.example.com/account/profile'; // Intercepted path was /transfer/step3

    showStagingModal({
      context: createStagingContext(actionId),
      state: 'active',
      controller: h.controller,
      continuationManager: h.continuationManager,
      validationService: h.validationService,
      initialApprovalRequest: approvedReq,
      validationOptions: {
        authContext: h.aliceAuth,
        expectedRequesterId: 'usr_alice',
        request: approvedReq,
      },
    });

    setStagingUIState('approval_confirmed_approved', {
      requestId: req.id,
      decidedBy: 'Bob',
      isEligible: true,
      request: approvedReq,
    });

    const shadowB = getStagingModalShadowRoot();
    const continueBtnB = shadowB?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
    continueBtnB.click();
    await new Promise((r) => setTimeout(r, 60));

    assertEquals(h.observableEffect.executionCount, 0, 'Handler count is 0 on path drift');
    assertEquals(getStagingUIState(), 'action_invalidated', 'UI transitioned to action_invalidated on path drift');
    dismissStagingModal();

    // Reset URL to matching path
    mockWin.location.href = 'https://bank.example.com/transfer/step3';

    // Case 7C: Element detached from DOM
    testButton.remove(); // Detach element from DOM

    showStagingModal({
      context: createStagingContext(actionId),
      state: 'active',
      controller: h.controller,
      continuationManager: h.continuationManager,
      validationService: h.validationService,
      initialApprovalRequest: approvedReq,
      validationOptions: {
        authContext: h.aliceAuth,
        expectedRequesterId: 'usr_alice',
        request: approvedReq,
        isElementAttached: () => false,
      },
    });

    setStagingUIState('approval_confirmed_approved', {
      requestId: req.id,
      decidedBy: 'Bob',
      isEligible: true,
      request: approvedReq,
    });

    const shadowC = getStagingModalShadowRoot();
    const continueBtnC = shadowC?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
    continueBtnC.click();
    await new Promise((r) => setTimeout(r, 60));

    assertEquals(h.observableEffect.executionCount, 0, 'Handler count is 0 on detached element');
    assertEquals(getStagingUIState(), 'action_invalidated', 'UI transitioned to action_invalidated on detached element');
    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // SUITE 8: Universal Continuation Rejected - Only Verified Actions Supported
  // (Requirements 4 & 11)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 8: Universal Continuation Rejected (Verified Actions Only)');
  {
    const h = createIntegrationHarness();
    const arbitraryActionId = 'act_suite8_arbitrary_bank_form';

    // Simulated arbitrary website form button
    const arbitraryAction: GuardrailAction = {
      id: arbitraryActionId,
      type: ActionType.SUBMIT,
      timestamp: h.currentTime,
      page: { url: 'https://bank.example.com/transfer/confirm', title: 'Payment' },
      element: { tagName: 'FORM', id: 'payment-form' },
    };

    h.controller.register(arbitraryAction);
    const held = h.controller.holdAction(arbitraryActionId);

    // Intentionally DO NOT register a handler, or register with no verified resumption behavior
    // (This models an arbitrary website interaction where Guardrail intercepted the submit event)

    h.actionOwnershipRegistry.registerActionOwnership(arbitraryActionId, 'usr_alice');
    const req = h.service.createRequest(
      {
        actionId: arbitraryActionId,
        actionType: ActionType.SUBMIT,
        actionDescription: 'Real Payment Submission',
        riskLevel: RiskLevel.HIGH,
      },
      h.aliceAuth
    );
    h.service.approveRequest(req.id, { decisionReason: 'Approved' }, h.bobAuth);
    const approvedReq = h.service.getRequest(req.id, h.aliceAuth);

    // Validate eligibility
    const validResult = await h.validationService.validateEligibility(arbitraryActionId, {
      request: approvedReq,
      authContext: h.aliceAuth,
    });

    assertEquals(validResult.eligible, false, 'Arbitrary website action is NOT eligible for continuation');
    assertEquals(validResult.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE');
    assert(
      validResult.reason.includes('missing or detached') ||
        validResult.reason.includes('Resumption is strictly restricted to'),
      'Explains missing handler or verified test action restriction'
    );

    // Attempt direct continuation
    const contRes = h.continuationManager.continueAction(arbitraryActionId);
    assertEquals(contRes.success, false, 'Continuation on arbitrary website action rejected');
    assertEquals(contRes.executed, false, 'Executed is false');
    assert(contRes.error?.includes('arbitrary website continuation is not supported'), 'Error message prohibits arbitrary continuation');

    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // SUITE 9: Zero Synthetic DOM Click Event Replay
  // (Requirement 4)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 9: Zero Synthetic DOM Event Replay');
  {
    const h = createIntegrationHarness();
    const actionId = 'act_suite9_no_synthetic';

    let syntheticClickCount = 0;
    const testButton = mockDocument.createElement('button');
    testButton.setAttribute('id', 'btn-replay-detector');
    testButton.setAttribute('data-guardrail-test-action', 'true');
    testButton.addEventListener('click', () => {
      syntheticClickCount++;
    });
    mockBody.appendChild(testButton);

    const action: GuardrailAction = {
      id: actionId,
      type: ActionType.CLICK,
      timestamp: h.currentTime,
      page: { url: 'https://bank.example.com/action', title: 'Action' },
      element: { tagName: 'BUTTON', id: 'btn-replay-detector' },
    };

    h.controller.register(action);
    const held = h.controller.holdAction(actionId);
    h.continuationManager.registerHeldAction(action, held, (act) => {
      h.observableEffect.execute(act);
    });

    const contRes = h.continuationManager.continueAction(actionId);
    assertEquals(contRes.success, true, 'Controlled handler executed successfully');
    assertEquals(h.observableEffect.executionCount, 1, 'Observable handler executed directly: 1');
    assertEquals(syntheticClickCount, 0, 'Synthetic DOM click count is strictly 0 (no simulated clicks on element)');

    testButton.remove();
    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // SUITE 10: Zero Sensitive Form Value Storage Guarantee
  // (Requirement 12)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 10: Zero Sensitive Form Value Storage Guarantee');
  {
    const h = createIntegrationHarness();
    const actionId = 'act_suite10_privacy';

    const action: GuardrailAction = {
      id: actionId,
      type: ActionType.CLICK,
      timestamp: h.currentTime,
      page: { url: 'https://bank.example.com/transfer', title: 'Bank' },
      element: { tagName: 'BUTTON', visibleText: 'Transfer Funds' },
    };

    h.controller.register(action);
    const held = h.controller.holdAction(actionId);
    h.continuationManager.registerHeldAction(action, held, () => {});

    const heldEntry = h.continuationManager.getCurrentHeldAction();
    const serializedHeld = JSON.stringify(heldEntry);
    const serializedRecord = JSON.stringify(held);

    assert(!serializedHeld.includes('password'), 'Held action does not contain password');
    assert(!serializedHeld.includes('otp'), 'Held action does not contain otp');
    assert(!serializedHeld.includes('cvv'), 'Held action does not contain cvv');
    assert(!serializedHeld.includes('cardnumber'), 'Held action does not contain cardnumber');
    assert(!serializedRecord.includes('password'), 'Interception record does not contain password');
    assert(!serializedRecord.includes('cvv'), 'Interception record does not contain cvv');

    dismissStagingModal();
  }

  // --------------------------------------------------------------------------
  // SUITE 11: Documented Architectural Limitations (Server CAS Note)
  // (Requirements 13 & 15)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 11: Documented Architectural Limitations');
  {
    const limitations = CONTINUATION_VALIDATION_LIMITATIONS;
    assertEquals(limitations.length, 8, 'Exactly 8 architectural limitations documented');

    assert(
      limitations.some((l) => l.includes('LIMITATION_ATOMIC_SERVER_CONSUMPTION')),
      'Documents lack of atomic server-side consumption transition and client-side limits'
    );
    assert(
      limitations.some((l) => l.includes('LIMITATION_VERIFIED_ACTIONS_ONLY')),
      'Documents strict restriction to verified test actions and rejection of arbitrary websites'
    );
    assert(
      limitations.some((l) => l.includes('LIMITATION_SYNTHETIC_EVENTS')),
      'Documents avoidance of synthetic DOM click replay'
    );
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n====================================================================');
  console.log(`📊 INTEGRATION TEST SUMMARY: ${passedTests} / ${passedTests + failedTests} PASSED`);
  if (failedTests > 0) {
    console.error(`❌ FAILED TESTS: ${failedTests}`);
    process.exit(1);
  } else {
    console.log('🎉 ALL INTEGRATION SCENARIOS SATISFIED WITH ZERO BYPASS!');
    console.log('====================================================================\n');
  }
}

runControlledContinuationIntegrationTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
