/**
 * Guardrail Warning Modal UI Test Suite
 *
 * Verifies the user-facing suspicious website warning experience:
 * 1. Mounting, Shadow DOM Attachment & Singleton Lifecycle.
 * 2. Website Domain Display & Detection Basis (Local Safety Heuristics vs No Fabricated Intel).
 * 3. Detected Characteristics & Non-Technical Risk Explanation.
 * 4. Safe Next Steps & Consequential Action Disclaimers.
 * 5. Action Status Distinction (Prevented, Held in Staging, or Merely Warned About).
 * 6. View States (Warning, Loading, Dismissed).
 * 7. Recovery Actions & Dismissal (Cancel, Continue, Backdrop, Close button, Escape key).
 * 8. Accessibility & Keyboard Navigation (Live Announcements, alertdialog, Focus Trapping, Focus Restoration).
 */

declare const process: { exit: (code: number) => void };

// Setup DOM simulation in Node
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

  get innerHTML(): string {
    return this.textContent;
  }

  set innerHTML(val: string) {
    // Basic parser for simple text extraction in tests
    this._textContent = val.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

function matchesSelector(el: MockDOMElement, selector: string): boolean {
  if (selector.startsWith('#')) {
    return el.id === selector.substring(1);
  }
  if (selector.startsWith('.')) {
    const classNames = selector.split('.').filter(Boolean);
    return classNames.every((cls) => el.classList.contains(cls));
  }
  if (selector.startsWith('[') && selector.endsWith(']')) {
    const inner = selector.slice(1, -1);
    if (inner.includes('=')) {
      const [attr, rawVal] = inner.split('=');
      const cleanVal = rawVal.replace(/^["']|["']$/g, '');
      return el.getAttribute(attr) === cleanVal;
    }
    return el.getAttribute(inner) !== null;
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
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
  public body: MockDOMElement = new MockDOMElement('BODY');
  public activeElement: MockDOMElement | null = null;

  createElement(tagName: string): MockDOMElement {
    return new MockDOMElement(tagName);
  }

  getElementById(id: string): MockDOMElement | null {
    return this.body.querySelector(`#${id}`);
  }

  _setActiveElement(el: MockDOMElement | null): void {
    this.activeElement = el;
    let curr: MockDOMElement | null = el;
    while (curr) {
      if (curr.parentNode instanceof MockShadowRoot) {
        curr.parentNode.activeElement = el;
      }
      curr = curr.parentNode;
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

  dispatchEvent(event: any): boolean {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        listener(event);
      }
    }
    return true;
  }
}

// Install mock DOM in global environment
const mockDoc = new MockDocument();
const mockWin = new MockWindow();
(globalThis as any).document = mockDoc;
(globalThis as any).window = mockWin;

// Import warning modal and types
import {
  showWarningModal,
  dismissWarningModal,
  isWarningModalActive,
  updateWarningModalState,
  transitionToWaitingView,
  updateWaitingScreenStatus,
  HOST_ELEMENT_ID,
  WarningModalProps,
} from './warning-modal.js';
import { GuardrailAction, ActionType } from '../types/actions.js';
import { RiskAssessment, RiskLevel } from '../types/risk.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';

// Test runner helpers
let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failed++;
    throw new Error(msg);
  } else {
    console.log(`  PASS: ${msg}`);
    passed++;
  }
}

function createSampleAction(url: string = 'https://paypa1-security.com/login'): GuardrailAction {
  return {
    id: 'act-sample-101',
    type: ActionType.CLICK,
    target: '#submit-btn',
    timestamp: Date.now(),
    page: {
      url,
      title: 'Sign In Page',
      domain: new URL(url).hostname,
    },
    element: {
      tagName: 'BUTTON',
      id: 'submit-btn',
      visibleText: 'Log In Now',
    },
  };
}

function createSampleRisk(level: RiskLevel = RiskLevel.HIGH, score: number = 78): RiskAssessment {
  return {
    riskLevel: level,
    score,
    factors: [
      {
        factor: 'SUSPICIOUS_DOMAIN_PATTERN',
        weight: 0.8,
        description: 'Target hostname mimics PayPal brand with character substitution',
      },
    ],
    timestamp: Date.now(),
  };
}

function createSampleDecision(action: ResponseAction = ResponseAction.WARN, ruleId: string = 'RULE_WARN_SUSPICIOUS_URL'): ResponseDecision {
  return {
    action,
    response: action,
    confidence: 0.85,
    timestamp: Date.now(),
    ruleId,
    reasonCode: 'POLICY_WARN_PHISHING_INDICATOR',
  };
}

async function runWarningUITests() {
  console.log('\n--- GUARDRAIL WARNING UI COMPONENT TEST SUITE ---\n');

  // Test Suite 1: Mounting, Shadow DOM Isolation, & Singleton Lifecycle
  console.log('Suite 1: Mounting, Shadow DOM Isolation, & Singleton Lifecycle');
  {
    mockDoc.body = new MockDOMElement('BODY');
    assert(!isWarningModalActive(), 'Modal initially inactive');

    const props: WarningModalProps = {
      action: createSampleAction(),
      risk: createSampleRisk(),
      decision: createSampleDecision(),
    };

    const dismissFn = showWarningModal(props);
    assert(isWarningModalActive(), 'Modal is active after showWarningModal');

    const host = mockDoc.getElementById(HOST_ELEMENT_ID);
    assert(host !== null, 'Host element present in document body');
    assert(host?.style.position === 'relative', 'Host has position relative');
    assert(host?.style.zIndex === '2147483647', 'Host has maximum z-index 2147483647');
    assert(host?.shadowRoot !== null, 'Shadow root attached to host');

    const shadow = host?.shadowRoot;
    const backdrop = shadow?.querySelector('.gr-backdrop');
    assert(backdrop !== null, 'Backdrop element present in Shadow DOM');
    const card = shadow?.querySelector('.gr-card');
    assert(card !== null, 'Card dialog element present in Shadow DOM');

    // Duplicate prevention / Singleton lifecycle
    showWarningModal(props);
    const hostCount = mockDoc.body.querySelectorAll(`#${HOST_ELEMENT_ID}`).length;
    assert(hostCount === 1, 'Only one warning host exists after multiple showWarningModal calls');

    dismissFn();
    assert(!isWarningModalActive(), 'Modal inactive after dismiss invocation');
    assert(mockDoc.getElementById(HOST_ELEMENT_ID) === null, 'Host removed from DOM upon dismissal');
  }

  // Test Suite 2: Website Domain & Heuristic Detection Basis (Requirements 1 & 2)
  console.log('\nSuite 2: Website Domain & Heuristic Detection Basis');
  {
    mockDoc.body = new MockDOMElement('BODY');
    showWarningModal({
      action: createSampleAction('https://login.apple-verify.cc/account'),
      risk: createSampleRisk(RiskLevel.HIGH, 82),
      decision: createSampleDecision(ResponseAction.WARN, 'RULE_WARN_SUSPICIOUS_URL'),
    });

    const host = mockDoc.getElementById(HOST_ELEMENT_ID);
    const shadow = host!.shadowRoot!;

    // Domain display
    const domainEl = shadow.querySelector('.gr-domain-value');
    assert(domainEl !== null, 'Domain value element rendered');
    assert(domainEl?.textContent.includes('login.apple-verify.cc') ?? false, 'Accurately displays target domain');

    // Detection basis: local heuristic (not fake threat intel)
    const sourceTag = shadow.querySelector('.gr-source-tag');
    assert(sourceTag !== null, 'Source indicator tag rendered');
    assert(sourceTag?.textContent.includes('Detection Basis: Local Safety Heuristic') ?? false, 'Source tagged as Local Safety Heuristic');

    const sourceSubtext = shadow.querySelector('.gr-source-subtext');
    assert(sourceSubtext !== null, 'Source subtext rendered');
    assert(sourceSubtext?.textContent.includes('not a verified blacklist feed') ?? false, 'Explicitly notes it is an automated heuristic, not a verified blacklist feed');

    // Technical Diagnostics check
    const diagValElements = shadow.querySelectorAll('.gr-diag-val');
    const threatClassVal = diagValElements.find((el) => el.textContent.includes('Not a verified malware threat'));
    assert(threatClassVal !== undefined, 'Diagnostic details declare non-malware heuristic nature');

    dismissWarningModal();
  }

  // Test Suite 3: Detected Characteristics & Non-Technical Risk Explanation (Requirements 3 & 4)
  console.log('\nSuite 3: Detected Characteristics & Non-Technical Risk Explanation');
  {
    mockDoc.body = new MockDOMElement('BODY');
    showWarningModal({
      action: createSampleAction('http://insecure-bank.example/login'),
      risk: createSampleRisk(RiskLevel.HIGH, 75),
      decision: createSampleDecision(ResponseAction.WARN, 'RULE_WARN_INSECURE_LOGIN'),
    });

    const host = mockDoc.getElementById(HOST_ELEMENT_ID);
    const shadow = host!.shadowRoot!;

    // Characteristics list
    const reasonsList = shadow.querySelector('.gr-reasons-list');
    assert(reasonsList !== null, 'Detected characteristics list rendered');
    const reasonItems = shadow.querySelectorAll('.gr-reason-item');
    assert(reasonItems.length > 0, 'Populated with characteristic items');

    // Non-technical explanation in Risk Box
    const riskBox = shadow.querySelector('.gr-risk-box');
    assert(riskBox !== null, 'Risk explanation container rendered');
    assert(riskBox?.textContent.includes('Why Guardrail Considers This Risky') ?? false, 'Risk box contains section title');
    assert(!riskBox?.textContent.toLowerCase().includes('fraudster'), 'Avoids defamatory or inflammatory jargon');

    dismissWarningModal();
  }

  // Test Suite 4: Action Status Distinction (Requirement 6)
  console.log('\nSuite 4: Action Status Distinction (Advisory vs Held)');
  {
    mockDoc.body = new MockDOMElement('BODY');

    // Scenario A: Advisory Warning (Not held or blocked)
    showWarningModal({
      action: createSampleAction(),
      risk: createSampleRisk(),
      decision: createSampleDecision(ResponseAction.WARN),
    });

    let host = mockDoc.getElementById(HOST_ELEMENT_ID);
    let shadow = host!.shadowRoot!;
    let banner = shadow.querySelector('.gr-action-status-banner');
    assert(banner !== null, 'Action status banner rendered');
    assert(banner?.classList.contains('gr-status-advisory') ?? false, 'Has advisory styling class');
    assert(banner?.textContent.includes('Advisory Notice') ?? false, 'Banner headline states Advisory Notice');
    assert(banner?.textContent.toLowerCase().includes('not blocked or held') ?? false, 'Explicitly explains action was NOT blocked or held');

    dismissWarningModal();

    // Scenario B: Held in Staging Mode
    showWarningModal({
      action: createSampleAction(),
      risk: createSampleRisk(),
      decision: createSampleDecision(ResponseAction.PROTECT, 'RULE_STAGE_HIGH_RISK'),
    });

    host = mockDoc.getElementById(HOST_ELEMENT_ID);
    shadow = host!.shadowRoot!;
    banner = shadow.querySelector('.gr-action-status-banner');
    assert(banner?.classList.contains('gr-status-held') ?? false, 'Has held styling class for PROTECT');
    assert(banner?.textContent.includes('Held in Staging Mode') ?? false, 'Banner headline states Held in Staging Mode');
    assert(banner?.textContent.includes('Continuation requires') ?? false, 'Explains action was paused and continuation requires approval');

    dismissWarningModal();
  }

  // Test Suite 5: View States (Warning, Loading, Dismissed)
  console.log('\nSuite 5: View States (Warning, Loading, Dismissed)');
  {
    mockDoc.body = new MockDOMElement('BODY');
    showWarningModal({
      action: createSampleAction(),
      risk: createSampleRisk(),
      decision: createSampleDecision(),
    });

    const host = mockDoc.getElementById(HOST_ELEMENT_ID);
    const shadow = host!.shadowRoot!;
    const overlay = shadow.querySelector('.gr-loading-overlay');
    const continueBtn = shadow.querySelector('.gr-btn-continue');
    const cancelBtn = shadow.querySelector('.gr-btn-cancel');
    const card = shadow.querySelector('.gr-card');

    assert(overlay?.style.display === 'none' || !overlay?.style.display, 'Loading overlay initially hidden');
    assert(continueBtn?.disabled === false, 'Continue button initially enabled');
    assert(cancelBtn?.disabled === false, 'Cancel button initially enabled');

    // Transition to loading state
    updateWarningModalState('loading', 'Verifying website safety...');
    assert(overlay?.style.display === 'flex', 'Loading overlay visible in loading state');
    assert(shadow.querySelector('.gr-loading-text')?.textContent === 'Verifying website safety...', 'Loading text updated');
    assert(continueBtn?.disabled === true, 'Continue button disabled during loading');
    assert(cancelBtn?.disabled === true, 'Cancel button disabled during loading');
    assert(card?.getAttribute('aria-busy') === 'true', 'Card marked aria-busy during loading');

    // Transition back to warning state
    updateWarningModalState('warning');
    assert(overlay?.style.display === 'none', 'Loading overlay hidden in warning state');
    assert(continueBtn?.disabled === false, 'Continue button re-enabled');
    assert(cancelBtn?.disabled === false, 'Cancel button re-enabled');
    assert(card?.getAttribute('aria-busy') === 'false', 'Card aria-busy reset to false');

    // Transition to dismissed state
    updateWarningModalState('dismissed');
    assert(!isWarningModalActive(), 'Modal dismissed via updateWarningModalState');
  }

  // Test Suite 6: Recovery Actions and Dismissal
  console.log('\nSuite 6: Recovery Actions and Dismissal');
  {
    // A: Cancel Button
    let cancelCalled = false;
    let continueCalled = false;
    mockDoc.body = new MockDOMElement('BODY');

    showWarningModal({
      action: createSampleAction(),
      risk: createSampleRisk(),
      decision: createSampleDecision(),
      onCancel: () => { cancelCalled = true; },
      onContinue: () => { continueCalled = true; },
    });

    let shadow = mockDoc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    let cancelBtn = shadow.querySelector('.gr-btn-cancel');
    assert(
      cancelBtn?.textContent === 'Cancel & Leave' ||
        cancelBtn?.textContent === 'Cancel & Stay' ||
        cancelBtn?.textContent === 'Cancel (Leave Page)',
      'Cancel button copy is explicit and clear'
    );
    cancelBtn?.click();
    assert(cancelCalled, 'Cancel callback invoked on cancel button click');
    assert(!isWarningModalActive(), 'Modal dismissed on cancel button click');

    // B: Continue / Request Approval Button
    cancelCalled = false;
    continueCalled = false;
    showWarningModal({
      action: createSampleAction(),
      risk: createSampleRisk(),
      decision: createSampleDecision(),
      onCancel: () => { cancelCalled = true; },
      onContinue: () => { continueCalled = true; },
    });

    shadow = mockDoc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    let continueBtn = shadow.querySelector('.gr-btn-continue');
    assert(
      continueBtn?.textContent === 'Request Approval' ||
        continueBtn?.textContent === 'Continue Anyway' ||
        continueBtn?.textContent === 'Continue at My Own Risk',
      'Continue button copy makes risk consequential'
    );
    continueBtn?.click();
    assert(continueCalled, 'Continue callback invoked on continue button click');
    assert(!isWarningModalActive(), 'Modal dismissed on continue button click');

    // C: Close Button
    cancelCalled = false;
    showWarningModal({
      action: createSampleAction(),
      risk: createSampleRisk(),
      decision: createSampleDecision(),
      onCancel: () => { cancelCalled = true; },
    });

    shadow = mockDoc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    let closeBtn = shadow.querySelector('.gr-btn-close');
    closeBtn?.click();
    assert(cancelCalled, 'Cancel callback invoked on close button click');
    assert(!isWarningModalActive(), 'Modal dismissed on close button click');

    // D: Escape Key
    cancelCalled = false;
    showWarningModal({
      action: createSampleAction(),
      risk: createSampleRisk(),
      decision: createSampleDecision(),
      onCancel: () => { cancelCalled = true; },
    });

    mockWin.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert(cancelCalled, 'Cancel callback invoked on Escape keypress');
    assert(!isWarningModalActive(), 'Modal dismissed on Escape keypress');
  }

  // Test Suite 7: Accessibility & Keyboard Navigation
  console.log('\nSuite 7: Accessibility & Keyboard Navigation');
  {
    mockDoc.body = new MockDOMElement('BODY');
    const anchor = mockDoc.createElement('A');
    mockDoc.body.appendChild(anchor);
    anchor.focus();
    assert(mockDoc.activeElement === anchor, 'Previous active element set before modal');

    showWarningModal({
      action: createSampleAction(),
      risk: createSampleRisk(),
      decision: createSampleDecision(),
    });

    const host = mockDoc.getElementById(HOST_ELEMENT_ID);
    const shadow = host!.shadowRoot!;
    const card = shadow.querySelector('.gr-card');

    // Dialog roles and labels
    assert(card?.getAttribute('role') === 'alertdialog', 'Card has role alertdialog');
    assert(card?.getAttribute('aria-modal') === 'true', 'Card has aria-modal true');
    assert(card?.getAttribute('aria-labelledby') === 'gr-title-id', 'Card labeled by title element');
    assert(card?.getAttribute('aria-describedby') === 'gr-summary-id', 'Card described by summary element');

    // Accessible live region
    const srAnnounce = shadow.querySelector('.gr-sr-only');
    assert(srAnnounce !== null, 'Screen reader live announcement element present');
    assert(srAnnounce?.getAttribute('role') === 'status', 'Live announcement has role status');
    assert(srAnnounce?.getAttribute('aria-live') === 'polite', 'Live announcement has aria-live polite');
    assert(srAnnounce?.textContent.includes('Guardrail Safety Advisory') ?? false, 'Live announcement contains advisory context');

    // Safe focus default: Cancel button receives initial focus
    assert(mockDoc.activeElement?.classList.contains('gr-btn-cancel') ?? false, 'Initial focus safely placed on Cancel button');

    // Focus trapping (Tab & Shift+Tab)
    const cancelBtn = shadow.querySelector('.gr-btn-cancel');
    const continueBtn = shadow.querySelector('.gr-btn-continue');
    const closeBtn = shadow.querySelector('.gr-btn-close');
    const detailsToggle = shadow.querySelector('.gr-diagnostics-summary');

    // Forward Tab wrap
    detailsToggle?.focus();
    let defaultPrevented = false;
    mockWin.dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => { defaultPrevented = true; },
    });
    assert(defaultPrevented, 'Forward tab wraps from last focusable element');
    assert(mockDoc.activeElement === cancelBtn, 'Focus wrapped to first element (Cancel button)');

    // Reverse Tab wrap (Shift+Tab)
    cancelBtn?.focus();
    defaultPrevented = false;
    mockWin.dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      shiftKey: true,
      preventDefault: () => { defaultPrevented = true; },
    });
    assert(defaultPrevented, 'Backward tab wraps from first focusable element');
    assert(mockDoc.activeElement === detailsToggle, 'Focus wrapped to last element (detailsToggle)');

    // Focus restoration on dismissal
    dismissWarningModal();
    assert(mockDoc.activeElement === anchor, 'Focus restored to previous active element upon dismissal');
  }

  // Test Suite 8: Consequential Copy & Continuation Disclaimer
  console.log('\nSuite 8: Consequential Copy & Continuation Disclaimer');
  {
    mockDoc.body = new MockDOMElement('BODY');
    showWarningModal({
      action: createSampleAction(),
      risk: createSampleRisk(),
      decision: createSampleDecision(),
    });

    const host = mockDoc.getElementById(HOST_ELEMENT_ID);
    const shadow = host!.shadowRoot!;

    const disclaimer = shadow.querySelector('.gr-continuation-disclaimer');
    assert(disclaimer !== null, 'Continuation disclaimer rendered');
    assert(
      disclaimer?.textContent.includes('Continuing does not guarantee or certify that this website is safe') ?? false,
      'Continuation disclaimer does not certify safety'
    );

    // Safe next steps list
    const guidanceList = shadow.querySelector('.gr-guidance-list');
    assert(guidanceList !== null, 'Safe next steps list rendered');
    const steps = shadow.querySelectorAll('.gr-guidance-item');
    assert(steps.length > 0, 'Guidance steps provided');
    const stepsText = steps.map((s) => s.textContent).join(' ');
    assert(stepsText.includes('Check your browser address bar') || stepsText.includes('Cancel this action'), 'Guidance includes actionable safety steps');

    dismissWarningModal();
  }

  // Test Suite 9: Slide-Out Transition & Waiting Screen Approval Workflow
  console.log('\nSuite 9: Slide-Out Transition & Waiting Screen Approval Workflow');
  {
    mockDoc.body = new MockDOMElement('BODY');
    let approvalRequested = false;
    let cancelCalled = false;

    showWarningModal({
      action: createSampleAction('https://gaiaflix.xyz/#/movies'),
      risk: createSampleRisk(RiskLevel.MEDIUM, 60),
      decision: createSampleDecision(ResponseAction.WARN, 'RULE_WARN_SUSPICIOUS_URL'),
      onRequestApproval: () => {
        approvalRequested = true;
      },
      onCancel: () => {
        cancelCalled = true;
      },
    });

    const host = mockDoc.getElementById(HOST_ELEMENT_ID);
    const shadow = host!.shadowRoot!;

    const viewWarning = shadow.querySelector('.gr-view-warning');
    const viewWaiting = shadow.querySelector('.gr-view-waiting');
    assert(viewWarning !== null, 'Warning view pane present in card');
    assert(viewWaiting !== null, 'Waiting view pane present in card');
    assert(viewWarning?.classList.contains('gr-view-warning') ?? false, 'Warning view has initial base class');

    // Click Request Approval button
    const requestApprovalBtn = shadow.querySelector('.gr-btn-continue');
    assert(requestApprovalBtn !== null, 'Request Approval button present in warning view');
    requestApprovalBtn?.click();

    // Verify modal remains active (did NOT abruptly dismiss)
    assert(isWarningModalActive(), 'Modal remains active after Request Approval click');
    assert(approvalRequested, 'onRequestApproval callback invoked');

    // Verify slide-out and slide-in transition classes applied
    assert(viewWarning?.classList.contains('gr-slide-out') ?? false, 'Warning view has gr-slide-out class applied');
    assert(viewWaiting?.classList.contains('gr-slide-in') ?? false, 'Waiting view has gr-slide-in class applied');

    // Verify card has waiting status styling
    const card = shadow.querySelector('.gr-card');
    assert(card?.classList.contains('gr-card-waiting') ?? false, 'Card has gr-card-waiting class for shimmer ribbon');

    // Verify waiting screen contents
    const waitingTitle = shadow.querySelector('.gr-waiting-title');
    assert(waitingTitle !== null, 'Waiting screen title rendered');
    assert(waitingTitle?.textContent.includes('Waiting for approval') ?? false, 'Waiting screen title communicates pending review');

    const waitingPill = shadow.querySelector('.gr-waiting-pill');
    assert(waitingPill !== null, 'Waiting status badge pill rendered');
    assert(waitingPill?.textContent.includes('Pending Review') ?? false, 'Displays Pending Review badge');

    const waitingDomain = shadow.querySelector('.gr-waiting-domain-value');
    assert(waitingDomain?.textContent.includes('gaiaflix.xyz') ?? false, 'Waiting screen displays target domain');

    const stepper = shadow.querySelector('.gr-waiting-stepper');
    assert(stepper !== null, 'Waiting screen approval status stepper rendered');

    // Verify live update to APPROVED state
    let proceeded = false;
    updateWaitingScreenStatus('approved', {
      requestId: 'apr_test_12345',
      approver: 'Sarah Caretaker',
      onProceed: () => {
        proceeded = true;
      },
    });

    assert(waitingPill?.textContent.includes('Approved') ?? false, 'Badge updated to Approved');
    assert(waitingTitle?.textContent.includes('Request Approved') ?? false, 'Title updated to Request Approved');

    const continueNavBtn = shadow.querySelector('.gr-btn-continue-nav');
    assert(continueNavBtn !== null, 'Continue to Website button rendered upon approval');
    continueNavBtn?.click();
    assert(proceeded, 'onProceed callback invoked on continue button click');
    assert(!isWarningModalActive(), 'Modal dismissed after user continues');

    // Test rejection state & cancel button
    mockDoc.body = new MockDOMElement('BODY');
    cancelCalled = false;
    showWarningModal({
      action: createSampleAction('https://gaiaflix.xyz/#/movies'),
      risk: createSampleRisk(RiskLevel.MEDIUM, 60),
      decision: createSampleDecision(ResponseAction.WARN, 'RULE_WARN_SUSPICIOUS_URL'),
      onRequestApproval: () => {},
      onCancel: () => {
        cancelCalled = true;
      },
    });

    const host2 = mockDoc.getElementById(HOST_ELEMENT_ID);
    const shadow2 = host2!.shadowRoot!;
    const reqBtn2 = shadow2.querySelector('.gr-btn-continue');
    reqBtn2?.click();

    const cancelReqBtn = shadow2.querySelector('.gr-btn-cancel-request');
    assert(cancelReqBtn !== null, 'Cancel Request button rendered in waiting view');
    cancelReqBtn?.click();
    assert(cancelCalled, 'onCancel callback invoked on Cancel Request click');
    assert(!isWarningModalActive(), 'Modal dismissed after Cancel Request click');

    dismissWarningModal();
  }

  console.log(`\n========================================`);
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runWarningUITests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
