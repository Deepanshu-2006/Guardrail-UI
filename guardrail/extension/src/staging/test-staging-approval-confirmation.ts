/**
 * Guardrail Controlled Action Continuation Confirmation Interface Test Suite
 *
 * Verifies the user-facing confirmation interface for protected actions that
 * have received backend-confirmed approval:
 * 1. Visibility & Confirmation Display for Approved Action (Pill, title, banner, approver info).
 * 2. Explicit Continue Action Enabled ONLY when Validation Service confirms eligibility.
 * 3. Protected Action Remains Held while user reviews (0 handler executions).
 * 4. Cancel Action Workflow during confirmation (aborts held action, transitions UI to cancelled).
 * 5. Explanations for Ineligible & Expired, Rejected, Cancelled, Mismatched, and Unavailable States.
 * 6. Non-misleading advisory copy (approval authorizes continuation, but does not guarantee safety).
 * 7. Duplicate Click Prevention & Monotonic Exactly-Once Execution (in-flight locking, count: 1).
 * 8. Zero Bypass Guarantee (UI calls validation service; direct handler invocation bypassed/rejected).
 * 9. Privacy & Safe Context (zero raw form values, passwords, PINs, OTPs in rendered DOM).
 * 10. Accessibility Basics (dialog role, aria-modal, live region announcer, focus placement).
 */

declare const process: { exit: (code: number) => void };

// Setup minimal DOM simulation in Node
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

  insertBefore<T extends MockDOMElement>(newChild: T, refChild: MockDOMElement | null): T {
    newChild.parentNode = this;
    if (!refChild) {
      this.children.push(newChild);
      return newChild;
    }
    const idx = this.children.indexOf(refChild);
    if (idx === -1) {
      this.children.push(newChild);
    } else {
      this.children.splice(idx, 0, newChild);
    }
    return newChild;
  }

  remove(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
  }

  attachShadow(init: { mode: string }): MockShadowRoot {
    const shadow = new MockShadowRoot(init.mode);
    shadow.host = this;
    this.shadowRoot = shadow;
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

  dispatchEvent(event: any): void {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        listener(event);
      }
    }
    if (event.bubbles && this.parentNode) {
      this.parentNode.dispatchEvent(event);
    }
  }

  click(): void {
    this.dispatchEvent({ type: 'click', target: this, defaultPrevented: false });
  }

  focus(): void {
    if (typeof (globalThis as any).document !== 'undefined') {
      (globalThis as any).document._setActiveElement(this);
    }
  }

  blur(): void {
    if (
      typeof (globalThis as any).document !== 'undefined' &&
      (globalThis as any).document.activeElement === this
    ) {
      (globalThis as any).document._setActiveElement(null);
    }
  }

  querySelector(selector: string): MockDOMElement | null {
    if (selector.includes(',')) {
      const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const found = this.querySelector(part);
        if (found) return found;
      }
      return null;
    }
    const parts = selector.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      let curr: MockDOMElement | null = this;
      for (const part of parts) {
        if (!curr) return null;
        curr = querySelectorInternal(curr, part);
      }
      return curr;
    }
    return querySelectorInternal(this, selector);
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    if (selector.includes(',')) {
      const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
      const results: MockDOMElement[] = [];
      for (const part of parts) {
        const found = this.querySelectorAll(part);
        for (const el of found) {
          if (!results.includes(el)) results.push(el);
        }
      }
      return results;
    }
    const results: MockDOMElement[] = [];
    const parts = selector.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      let currentElements: MockDOMElement[] = [this];
      for (const part of parts) {
        const nextElements: MockDOMElement[] = [];
        for (const el of currentElements) {
          querySelectorAllInternal(el, part, nextElements);
        }
        currentElements = nextElements;
      }
      return currentElements;
    }
    querySelectorAllInternal(this, selector, results);
    return results;
  }

  contains(other: MockDOMElement | null): boolean {
    if (!other) return false;
    if (other === this) return true;
    let curr: MockDOMElement | null = other;
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
  public activeElement: MockDOMElement | null = null;
  constructor(mode: string) {
    super('#SHADOW-ROOT');
    this.mode = mode;
  }
}

function matchesSelector(el: MockDOMElement, selector: string): boolean {
  const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    return parts.some((p) => matchesSelector(el, p));
  }
  const trimmed = selector.trim();
  if (trimmed.startsWith('#')) {
    return el.id === trimmed.slice(1);
  }
  if (trimmed.startsWith('.')) {
    return el.classList.contains(trimmed.slice(1));
  }
  if (trimmed === 'button:not(:disabled)') {
    return el.tagName.toLowerCase() === 'button' && !el.disabled;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
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

class MockDocument {
  public body: MockDOMElement;
  public activeElement: MockDOMElement | null = null;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  constructor() {
    this.body = new MockDOMElement('BODY');
  }
  _setActiveElement(el: MockDOMElement | null): void {
    this.activeElement = el;
    let curr: MockDOMElement | null = el;
    while (curr) {
      if (curr instanceof MockShadowRoot) {
        curr.activeElement = el;
        break;
      }
      curr = curr.parentNode;
    }
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

class MockCustomEvent {
  public type: string;
  public detail: any;
  public bubbles: boolean;
  constructor(type: string, init?: { detail?: any; bubbles?: boolean }) {
    this.type = type;
    this.detail = init?.detail;
    this.bubbles = Boolean(init?.bubbles);
  }
}

const mockDoc = new MockDocument();
const mockWin = new MockWindow();
(globalThis as any).document = mockDoc;
(globalThis as any).window = mockWin;
(globalThis as any).CustomEvent = MockCustomEvent;

// Imports under test
import {
  showStagingModal,
  dismissStagingModal,
  getStagingModalShadowRoot,
  getStagingUIState,
  setStagingUIState,
  handleModalContinue,
} from './modal.js';
import {
  ContinuationManager,
} from '../interception/continuation.js';
import {
  ContinuationValidationService,
  ContinuationEligibilityStatus,
} from '../interception/validation-service.js';
import { InterceptionController } from '../interception/controller.js';
import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { InterceptionState } from '../types/interception.js';
import { RiskLevel } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { StagingActionContext } from '../types/staging.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    console.error(`  ✗ FAIL: ${message}. Expected "${expected}", received "${actual}"`);
    failed++;
    throw new Error(`${message}. Expected "${expected}", received "${actual}"`);
  } else {
    console.log(`  ✓ ${message}: ${actual}`);
    passed++;
  }
}

function createSampleContext(overrides: Partial<StagingActionContext> = {}): StagingActionContext {
  return {
    actionId: 'act_test_confirm_123',
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    description: 'Authorize $250.00 Wire Transfer',
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    riskLevel: RiskLevel.HIGH,
    riskScore: 78,
    riskReasons: ['Unusual recipient account detected', 'New transfer destination'],
    interceptionState: InterceptionState.HELD,
    responseAction: ResponseAction.PROTECT,
    timestamp: '2026-10-26T00:00:00.000Z',
    stagedAt: '2026-10-26T00:00:00.000Z',
    ...overrides,
  };
}

console.log('====================================================================');
console.log('🛡️ GUARDRAIL: USER-FACING ACTION CONTINUATION CONFIRMATION TEST SUITE');
console.log('====================================================================\n');

// ============================================================================
// SUITE 1: Visibility & Confirmation Display for Approved Action
// ============================================================================
console.log('▶ Suite 1: Visibility & Confirmation Display for Approved Action');
{
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);
  const actionId = 'action_suite1_confirm';

  const testAction: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-26T00:00:00Z',
    page: { url: 'https://bank.example.com/transfer', title: 'Bank Transfer' },
  };
  testController.register(testAction, 'Registered');
  testController.holdAction(actionId, 'Held for review');

  const context = createSampleContext({ actionId });

  showStagingModal({
    context,
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });

  const shadow = getStagingModalShadowRoot();
  assert(Boolean(shadow), 'Modal Shadow Root mounted successfully');

  // Trigger backend approval confirmation state with verified eligibility
  setStagingUIState('approval_confirmed_approved', {
    requestId: 'apr_req_suite1_789',
    decidedBy: 'Caretaker Bob',
    decidedAt: '2026-10-26T00:05:00Z',
    isEligible: true,
  });

  assertEquals(getStagingUIState(), 'approval_confirmed_approved', 'UI state transitioned to approval_confirmed_approved');

  // Requirement 1: Clear status indicating trusted contact approved the request
  const pill = shadow?.querySelector('.gs-mode-pill');
  assertEquals(pill?.textContent, 'Approval Confirmed', 'Mode pill text is "Approval Confirmed"');
  assert(pill?.classList.contains('gs-badge-approved') || false, 'Mode pill has .gs-badge-approved badge style');

  const title = shadow?.querySelector('.gs-heading-title');
  assertEquals(title?.textContent, 'Approval Confirmed by Contact', 'Title is "Approval Confirmed by Contact"');

  const subtitle = shadow?.querySelector('.gs-heading-subtitle');
  assert(
    subtitle?.textContent?.includes('authorized trusted contact has approved this action') || false,
    'Subtitle clearly explains that an authorized contact approved the action'
  );

  const notice = shadow?.querySelector('.gs-footer-notice');
  assert(
    notice?.textContent?.includes('Status: APPROVED • Action: READY FOR CONFIRMATION') || false,
    'Footer notice shows APPROVED status and READY FOR CONFIRMATION'
  );

  // Requirement 9: Non-misleading advisory warning present
  const infoBanner = shadow?.querySelector('.gs-confirmation-info');
  assert(Boolean(infoBanner), 'Confirmation info banner is displayed');
  const bannerDesc = shadow?.querySelector('.gs-confirmation-desc')?.textContent || '';
  assert(
    bannerDesc.includes('Caretaker Bob') && bannerDesc.includes('apr_req_suite1_789'),
    'Banner identifies reviewer and request reference'
  );
  assert(
    bannerDesc.includes('Notice: Trusted contact approval authorizes continuation, but does not guarantee the action is safe'),
    'Banner explicitly warns that approval does NOT guarantee safety or lack of risk'
  );

  // Requirement 2: Concise, safe description of the intended action and website context
  const descEl = shadow?.querySelector('.gs-action-desc');
  assertEquals(descEl?.textContent, 'Authorize $250.00 Wire Transfer', 'Intended action description rendered safely');

  const allText = shadow?.textContent || '';
  assert(allText.includes('bank.example.com'), 'Website hostname bank.example.com rendered');

  // Requirement 8: Sensitive values, passwords, PINs, OTPs, CVVs strictly absent
  const forbiddenSensitive = ['password', 'secret', 'otp', 'pin', 'cvv', 'cardnumber', 'rawform'];
  for (const forbidden of forbiddenSensitive) {
    assert(!allText.toLowerCase().includes(forbidden), `No sensitive "${forbidden}" present in DOM textContent`);
  }

  dismissStagingModal();
}

// ============================================================================
// SUITE 2: Explicit Continue Action Enabled ONLY When Validation Service Confirms
// ============================================================================
console.log('\n▶ Suite 2: Explicit Continue Action Enabled ONLY When Validation Service Confirms');
{
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);
  const actionId = 'action_suite2_eligible';

  const testAction: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-26T00:00:00Z',
    page: { url: 'https://bank.example.com/transfer', title: 'Bank Transfer' },
  };
  testController.register(testAction, 'Registered');
  testController.holdAction(actionId, 'Held');

  showStagingModal({
    context: createSampleContext({ actionId }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });

  const shadow = getStagingModalShadowRoot();

  // Subtest 2A: When eligibility is confirmed (isEligible: true)
  setStagingUIState('approval_confirmed_approved', {
    requestId: 'apr_2a',
    decidedBy: 'Trusted Contact Alice',
    isEligible: true,
  });

  const continueBtn = shadow?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
  assert(Boolean(continueBtn), 'Continue button (#gs-btn-continue-action) is present');
  assertEquals(continueBtn.textContent, 'Continue Action', 'Continue button text is "Continue Action"');
  assertEquals(continueBtn.disabled, false, 'Continue button is enabled');
  assertEquals(continueBtn.getAttribute('aria-disabled'), null, 'Continue button has no aria-disabled="true"');
  assert(continueBtn.classList.contains('gs-btn-continue'), 'Continue button has .gs-btn-continue style');

  const cancelBtn = shadow?.querySelector('#gs-btn-cancel-action') as unknown as MockDOMElement;
  assert(Boolean(cancelBtn), 'Cancel button (#gs-btn-cancel-action) is present');
  assertEquals(cancelBtn.disabled, false, 'Cancel button is enabled');
  assertEquals(cancelBtn.textContent, 'Cancel Action', 'Cancel button displays "Cancel Action"');

  // Subtest 2B: When eligibility is NOT confirmed (isEligible: false)
  setStagingUIState('approval_confirmed_approved', {
    requestId: 'apr_2b',
    decidedBy: 'Trusted Contact Alice',
    isEligible: false,
    ineligibleReason: 'Action binding not approved or verified.',
  });

  const continueBtnIneligible = shadow?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
  assert(Boolean(continueBtnIneligible), 'Continue button remains present');
  assertEquals(continueBtnIneligible.disabled, true, 'Continue button is disabled when not eligible');
  assertEquals(continueBtnIneligible.getAttribute('aria-disabled'), 'true', 'Continue button has aria-disabled="true"');
  assertEquals(continueBtnIneligible.textContent, 'Continuation Unavailable', 'Button text shows "Continuation Unavailable"');

  dismissStagingModal();
}

// ============================================================================
// SUITE 3: Protected Action Remains Held While User Reviews
// ============================================================================
console.log('\n▶ Suite 3: Protected Action Remains Held While User Reviews');
{
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);
  const actionId = 'action_suite3_held_check';

  const testAction: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-26T00:00:00Z',
    page: { url: 'https://bank.example.com', title: 'Bank' },
  };
  testController.register(testAction, 'Registered');
  testController.holdAction(actionId, 'Held');

  let handlerExecutionCount = 0;
  testManager.registerHeldAction(testAction, testController.getRecord(actionId)!, () => {
    handlerExecutionCount++;
  });

  showStagingModal({
    context: createSampleContext({ actionId }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });

  // Project approved state with eligible: true
  setStagingUIState('approval_confirmed_approved', {
    requestId: 'apr_3',
    decidedBy: 'Contact Bob',
    isEligible: true,
  });

  // CRITICAL REQUIREMENT 5: Keep the action held while user decides
  assertEquals(testController.getRecord(actionId)?.state, InterceptionState.HELD, 'InterceptionRecord remains in HELD state');
  assertEquals(testManager.getExecutionCount(actionId), 0, 'ContinuationManager execution count is 0');
  assertEquals(handlerExecutionCount, 0, 'Controlled handler execution count is strictly ZERO while user reviews');

  dismissStagingModal();
}

// ============================================================================
// SUITE 4: Cancel Action Workflow During Confirmation
// ============================================================================
console.log('\n▶ Suite 4: Cancel Action Workflow During Confirmation');
{
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);
  const actionId = 'action_suite4_cancel';

  const testAction: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-26T00:00:00Z',
    page: { url: 'https://bank.example.com', title: 'Bank' },
  };
  testController.register(testAction, 'Registered');
  testController.holdAction(actionId, 'Held');

  let handlerExecutionCount = 0;
  testManager.registerHeldAction(testAction, testController.getRecord(actionId)!, () => {
    handlerExecutionCount++;
  });

  let cancelSuccessCount = 0;
  showStagingModal({
    context: createSampleContext({ actionId }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onCancelSuccess: () => {
      cancelSuccessCount++;
    },
  });

  setStagingUIState('approval_confirmed_approved', {
    requestId: 'apr_4',
    decidedBy: 'Contact Alice',
    isEligible: true,
  });

  const shadow = getStagingModalShadowRoot();
  const cancelBtn = shadow?.querySelector('#gs-btn-cancel-action') as unknown as MockDOMElement;
  assert(Boolean(cancelBtn), 'Cancel button is present during confirmation');

  // User clicks Cancel Action
  cancelBtn.click();

  assertEquals(cancelSuccessCount, 1, 'onCancelSuccess callback invoked exactly once');
  assertEquals(getStagingUIState(), 'cancelled', 'UI state transitioned to "cancelled"');
  assertEquals(testController.getRecord(actionId)?.state, InterceptionState.CANCELLED, 'InterceptionRecord transitioned to CANCELLED');
  assertEquals(handlerExecutionCount, 0, 'Controlled handler was strictly NEVER executed (count: 0)');

  const successBanner = shadow?.querySelector('.gs-confirmation-success');
  assert(Boolean(successBanner), 'Success cancellation banner rendered');
  assert(
    shadow?.querySelector('.gs-confirmation-title')?.textContent?.includes('Action cancelled') || false,
    'Banner confirms action was cancelled safely'
  );

  dismissStagingModal();
}

// ============================================================================
// SUITE 5: Explanations for Ineligible & Expired / Cancelled / Invalidated States
// ============================================================================
console.log('\n▶ Suite 5: Explanations for Ineligible & Expired / Cancelled / Invalidated States');
{
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);

  // Subtest 5A: Expired state
  console.log('  → Subtest 5A: Expired Request Explanation');
  showStagingModal({
    context: createSampleContext({ actionId: 'act_expired' }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });
  setStagingUIState('approval_confirmed_expired', {
    requestId: 'apr_exp',
    description: 'The authorization window expired. This action cannot safely be resumed and must be initiated again.',
  });

  const shadowExp = getStagingModalShadowRoot();
  assertEquals(getStagingUIState(), 'approval_confirmed_expired', 'UI state is approval_confirmed_expired');
  const expPill = shadowExp?.querySelector('.gs-mode-pill');
  assertEquals(expPill?.textContent, 'Request Expired', 'Pill shows "Request Expired"');
  const expBanner = shadowExp?.querySelector('.gs-confirmation-error');
  assert(Boolean(expBanner), 'Error banner displayed for expired request');
  const expDesc = shadowExp?.querySelector('.gs-confirmation-desc')?.textContent || '';
  assert(expDesc.includes('cannot safely be resumed and must be initiated again'), 'Banner explains action must be initiated again');
  const expBtn = (shadowExp?.querySelector('#gs-btn-continue-action') || shadowExp?.querySelector('#gs-btn-request-approval')) as unknown as MockDOMElement;
  assertEquals(expBtn.disabled, true, 'Continue button is disabled in expired state');
  assertEquals(expBtn.textContent, 'Request Expired', 'Button displays "Request Expired"');
  dismissStagingModal();

  // Subtest 5B: Rejected state
  console.log('  → Subtest 5B: Rejected Request Explanation');
  showStagingModal({
    context: createSampleContext({ actionId: 'act_rejected' }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });
  setStagingUIState('approval_confirmed_rejected', {
    requestId: 'apr_rej',
    decidedBy: 'Guardian Dave',
    description: 'An authorized trusted contact reviewed and denied this request. This action cannot proceed and will not be executed.',
  });

  const shadowRej = getStagingModalShadowRoot();
  assertEquals(getStagingUIState(), 'approval_confirmed_rejected', 'UI state is approval_confirmed_rejected');
  assertEquals(shadowRej?.querySelector('.gs-mode-pill')?.textContent, 'Approval Denied', 'Pill shows "Approval Denied"');
  const rejBtn = (shadowRej?.querySelector('#gs-btn-continue-action') || shadowRej?.querySelector('#gs-btn-request-approval')) as unknown as MockDOMElement;
  assertEquals(rejBtn.disabled, true, 'Continue button is disabled in rejected state');
  assertEquals(rejBtn.textContent, 'Request Denied', 'Button displays "Request Denied"');
  dismissStagingModal();

  // Subtest 5C: Cancelled state
  console.log('  → Subtest 5C: Cancelled Request Explanation');
  showStagingModal({
    context: createSampleContext({ actionId: 'act_cancelled' }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });
  setStagingUIState('approval_confirmed_cancelled', {
    requestId: 'apr_can',
    description: 'This approval request was cancelled. It cannot be resumed. If you still want to perform this action, please initiate it again on the website.',
  });

  const shadowCan = getStagingModalShadowRoot();
  assertEquals(getStagingUIState(), 'approval_confirmed_cancelled', 'UI state is approval_confirmed_cancelled');
  assertEquals(shadowCan?.querySelector('.gs-mode-pill')?.textContent, 'Request Cancelled', 'Pill shows "Request Cancelled"');
  const canBtn = (shadowCan?.querySelector('#gs-btn-continue-action') || shadowCan?.querySelector('#gs-btn-request-approval')) as unknown as MockDOMElement;
  assertEquals(canBtn.disabled, true, 'Button is disabled in cancelled state');
  assertEquals(canBtn.textContent, 'Request Cancelled', 'Button displays "Request Cancelled"');
  dismissStagingModal();

  // Subtest 5D: Mismatched / Context Changed (action_invalidated)
  console.log('  → Subtest 5D: Context Changed (action_invalidated) Explanation');
  showStagingModal({
    context: createSampleContext({ actionId: 'act_invalidated' }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });
  setStagingUIState('action_invalidated', {
    error: 'The webpage or target element changed while this action was held. The authorization is no longer safe to use. Please initiate the action again from the current page.',
  });

  const shadowInv = getStagingModalShadowRoot();
  assertEquals(getStagingUIState(), 'action_invalidated', 'UI state is action_invalidated');
  assertEquals(shadowInv?.querySelector('.gs-mode-pill')?.textContent, 'Context Changed', 'Pill shows "Context Changed"');
  assertEquals(shadowInv?.querySelector('.gs-heading-title')?.textContent, 'Action Cannot Be Resumed', 'Title shows "Action Cannot Be Resumed"');
  const invDesc = shadowInv?.querySelector('.gs-confirmation-desc')?.textContent || '';
  assert(invDesc.includes('Please initiate the action again from the current page'), 'Explains user must initiate action again');
  const invBtn = shadowInv?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
  assertEquals(invBtn.disabled, true, 'Continue button is disabled');
  assertEquals(invBtn.textContent, 'Action Invalidated', 'Button displays "Action Invalidated"');
  dismissStagingModal();

  // Subtest 5E: Temporarily Unavailable
  console.log('  → Subtest 5E: Temporarily Unavailable Explanation');
  showStagingModal({
    context: createSampleContext({ actionId: 'act_unavail' }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });
  setStagingUIState('temporarily_unavailable', {
    error: 'Backend connection timed out during validation. Action remains safely paused.',
  });

  const shadowUnavail = getStagingModalShadowRoot();
  assertEquals(getStagingUIState(), 'temporarily_unavailable', 'UI state is temporarily_unavailable');
  assertEquals(shadowUnavail?.querySelector('.gs-mode-pill')?.textContent, 'Validation Unavailable', 'Pill shows "Validation Unavailable"');
  const unavailBtn = shadowUnavail?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
  assertEquals(unavailBtn.disabled, true, 'Continue button disabled');
  assertEquals(unavailBtn.textContent, 'Temporarily Unavailable', 'Button shows "Temporarily Unavailable"');
  const unavailCancel = shadowUnavail?.querySelector('#gs-btn-cancel-action') as unknown as MockDOMElement;
  assertEquals(unavailCancel.disabled, false, 'Cancel button remains enabled so user can cancel');
  dismissStagingModal();
}

// ============================================================================
// SUITE 6: Continuation Execution & Monotonic Exactly-Once Protection
// ============================================================================
console.log('\n▶ Suite 6: Continuation Execution & Monotonic Exactly-Once Protection');
await (async () => {
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);
  const actionId = 'action_suite6_execute';

  const testAction: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-26T00:00:00Z',
    page: { url: 'https://bank.example.com', title: 'Bank' },
  };
  testController.register(testAction, 'Registered');
  testController.holdAction(actionId, 'Held');

  let handlerExecutionCount = 0;
  testManager.registerHeldAction(testAction, testController.getRecord(actionId)!, () => {
    handlerExecutionCount++;
  });

  // Mock validation service that confirms eligibility
  const mockValidationService = {
    validateEligibility: async () => ({
      eligible: true,
      status: ContinuationEligibilityStatus.ELIGIBLE,
      actionId,
      reason: 'Validation passed authoritatively.',
      verifiedAt: new Date().toISOString(),
      limitations: [],
    }),
  } as unknown as ContinuationValidationService;

  let continueSuccessCount = 0;
  let eventDispatchedCount = 0;
  const continuedEventListener = () => {
    eventDispatchedCount++;
  };
  mockDoc.addEventListener('guardrail:action-continued', continuedEventListener);

  showStagingModal({
    context: createSampleContext({ actionId }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    validationService: mockValidationService,
    onContinueSuccess: () => {
      continueSuccessCount++;
    },
  });

  // Project approved state with eligible: true
  setStagingUIState('approval_confirmed_approved', {
    requestId: 'apr_suite6',
    decidedBy: 'Contact Bob',
    isEligible: true,
  });

  const shadow = getStagingModalShadowRoot();
  const continueBtn = shadow?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
  assert(Boolean(continueBtn), 'Continue action button is present and ready');

  // Simulate user clicking Continue Action
  continueBtn.click();
  await Promise.resolve(); // Allow async execution

  assertEquals(continueSuccessCount, 1, 'onContinueSuccess callback called exactly once');
  assertEquals(eventDispatchedCount, 1, 'guardrail:action-continued DOM event dispatched once');
  assertEquals(handlerExecutionCount, 1, 'Controlled test action handler executed exactly ONCE');
  assertEquals(testController.getRecord(actionId)?.state, InterceptionState.CONTINUED, 'Action transitioned to CONTINUED');
  assertEquals(getStagingUIState(), 'continued', 'UI state transitioned to "continued"');

  const continuedPill = shadow?.querySelector('.gs-mode-pill');
  assertEquals(continuedPill?.textContent, 'Action Continued', 'Mode pill shows "Action Continued"');
  assertEquals(continueBtn.style.display, 'none', 'Continue button is hidden in continued state');

  // Verify duplicate click prevention on continued action
  continueBtn.click();
  continueBtn.click();
  await Promise.resolve();

  assertEquals(handlerExecutionCount, 1, 'Handler execution count strictly remains 1 after repeated clicks');
  assertEquals(continueSuccessCount, 1, 'Callback count remains 1');

  mockDoc.removeEventListener('guardrail:action-continued', continuedEventListener);
  dismissStagingModal();
})();

// ============================================================================
// SUITE 7: Zero Bypass Guarantee
// ============================================================================
console.log('\n▶ Suite 7: Zero Bypass Guarantee');
await (async () => {
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);
  const actionId = 'action_suite7_bypass_check';

  const testAction: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-26T00:00:00Z',
    page: { url: 'https://bank.example.com', title: 'Bank' },
  };
  testController.register(testAction, 'Registered');
  testController.holdAction(actionId, 'Held');

  let handlerExecutionCount = 0;
  testManager.registerHeldAction(testAction, testController.getRecord(actionId)!, () => {
    handlerExecutionCount++;
  });

  // Mock validation service that rejects eligibility (e.g. context mismatched or tampered)
  const rejectingValidationService = {
    validateEligibility: async () => ({
      eligible: false,
      status: ContinuationEligibilityStatus.MISMATCHED,
      actionId,
      reason: 'Action structural digest does not match intercepted action record.',
      verifiedAt: new Date().toISOString(),
      limitations: [],
    }),
  } as unknown as ContinuationValidationService;

  let continueErrorCalled = false;
  let continueErrorResult: any = null;

  showStagingModal({
    context: createSampleContext({ actionId }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    validationService: rejectingValidationService,
    onContinueError: (res) => {
      continueErrorCalled = true;
      continueErrorResult = res;
    },
  });

  const shadow = getStagingModalShadowRoot();
  const continueBtn = (shadow?.querySelector('#gs-btn-continue-action') || shadow?.querySelector('#gs-btn-request-approval')) as unknown as MockDOMElement;

  // Direct invocation through handleModalContinue
  await handleModalContinue(actionId, {
    context: createSampleContext({ actionId }),
    controller: testController,
    continuationManager: testManager,
    validationService: rejectingValidationService,
    onContinueError: (res) => {
      continueErrorCalled = true;
      continueErrorResult = res;
    },
  }, {
    continueBtn: continueBtn as any,
    cancelBtn: shadow?.querySelector('#gs-btn-cancel-action') as any,
    body: shadow?.querySelector('.gs-body') as any,
    header: shadow?.querySelector('.gs-header') as any,
  });

  assertEquals(continueErrorCalled, true, 'onContinueError was called when validation failed');
  assertEquals(continueErrorResult?.success, false, 'ContinuationResult has success: false');
  assertEquals(handlerExecutionCount, 0, 'Controlled handler was strictly NEVER executed (count: 0)');
  assertEquals(testController.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains safely HELD');
  assertEquals(getStagingUIState(), 'action_invalidated', 'UI state transitioned to action_invalidated');

  dismissStagingModal();
})();

// ============================================================================
// SUITE 8: Keyboard Navigation & Accessibility Basics
// ============================================================================
console.log('\n▶ Suite 8: Keyboard Navigation & Accessibility Basics');
{
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);
  const actionId = 'action_suite8_a11y';

  const testAction: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-26T00:00:00Z',
    page: { url: 'https://bank.example.com', title: 'Bank' },
  };
  testController.register(testAction, 'Registered');
  testController.holdAction(actionId, 'Held');

  showStagingModal({
    context: createSampleContext({ actionId }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });

  const shadow = getStagingModalShadowRoot();
  assert(Boolean(shadow), 'Shadow root mounted for accessibility verification');

  // Dialog semantics
  const shell = shadow?.querySelector('.gs-shell');
  assertEquals(shell?.getAttribute('role'), 'dialog', 'Shell container has role="dialog"');
  assertEquals(shell?.getAttribute('aria-modal'), 'true', 'Shell container has aria-modal="true"');
  assertEquals(shell?.getAttribute('aria-labelledby'), 'gs-title-id', 'Shell has aria-labelledby="gs-title-id"');

  // Live announcer
  const announcer = shadow?.querySelector('#gs-live-announcer');
  assert(Boolean(announcer), 'Screen reader live announcer (#gs-live-announcer) exists');
  assertEquals(announcer?.getAttribute('role'), 'status', 'Live announcer role is "status"');
  assertEquals(announcer?.getAttribute('aria-live'), 'polite', 'Live announcer aria-live is "polite"');

  // Project approved state
  setStagingUIState('approval_confirmed_approved', {
    requestId: 'apr_a11y',
    decidedBy: 'Contact Bob',
    isEligible: true,
  });

  const continueBtn = shadow?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
  assert(Boolean(continueBtn), 'Continue action button is present');
  assertEquals(continueBtn.getAttribute('title'), 'Confirm and resume execution of this held action', 'Continue button has descriptive title');

  // Live announcement updated
  assert(
    announcer?.textContent?.includes('Action approved by trusted contact') || false,
    'Live announcer announced action approved state'
  );

  dismissStagingModal();
}

console.log('\n====================================================================');
console.log(`TOTAL CONFIRMATION TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('====================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
