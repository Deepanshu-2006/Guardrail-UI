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

import { ActionCategory, ActionType } from '../types/actions.js';
import { InterceptionState } from '../types/interception.js';
import { ResponseAction } from '../types/response.js';
import { RiskLevel } from '../types/risk.js';
import { StagingActionContext } from '../types/staging.js';
import {
  STAGING_HOST_ELEMENT_ID,
  dismissStagingModal,
  getStagingModalShadowRoot,
  isStagingModalActive,
  showStagingModal,
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

console.log('\n============================================================');
console.log(`TOTAL STAGING UI TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
