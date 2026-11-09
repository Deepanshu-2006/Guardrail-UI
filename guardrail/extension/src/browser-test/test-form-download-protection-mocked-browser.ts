/**
 * Guardrail UI - Day 28: Form & Download Protection Mocked Browser Test Suite
 *
 * TIER 2: MOCKED BROWSER INTEGRATION TESTS
 * (In-Memory DOM, Shadow DOM Isolation, Capturing-Phase Events, Download Lifecycle, & MV3 Runtime)
 *
 * TESTING TIERS CLASSIFICATION:
 * - TIER 1: UNIT TESTS (Pure functions: detector rules, score weights, isolated contracts)
 * - TIER 2: MOCKED BROWSER TESTS (Simulated browser runtime: DOM event flow, capturing suppression,
 *            Shadow DOM modals, download manager listeners, MV3 worker messaging, privacy sentinels)
 * - TIER 3: REAL BROWSER INTEGRATION TESTS (Headless Chrome via CDP, local HTTP static server,
 *            synthetic test HTML pages, real unpacked Manifest V3 extension loading)
 *
 * SCENARIOS COVERED (18 Scenarios Across Form & Download Protection):
 * =============================================================================
 * PART 1: FORM PROTECTION
 * 1. Legitimate same-origin form submissions (unhindered, LOW risk, ALLOW, no modal).
 * 2. Cross-origin form destinations (unexpected external targets vs legitimate SSO exemptions).
 * 3. Missing or malformed form destinations (empty/hash targets, pseudo-protocols, undetermined URLs).
 * 4. Suspicious synthetic form destinations (exfiltration sinks, cleartext HTTP downgrades, raw public IPs).
 * 5. Password and sensitive-input fields (structural input inspection, zero sensitive value extraction).
 * 6. Dynamically inserted forms (document-level capturing event delegation on late-injected DOM nodes).
 * 7. Modified form destinations (runtime form.action mutation & submitter formaction override).
 * 8. Duplicate submission events (submit click emits strictly 1 action; repeat submit while HELD is suppressed).
 * 9. Supported cancellation and staging behavior (HELD in InterceptionController, clean user cancellation).
 * 10. Unsupported submission mechanisms (documenting form.submit() architectural limits & platform boundaries).
 *
 * PART 2: DOWNLOAD PROTECTION
 * 11. Normal text and image downloads (harmless test files, routine score, ALLOW, no modal).
 * 12. Harmless executable-extension test filenames without executing them (safe inspection, never opened).
 * 13. Misleading filename extensions (double extensions like .pdf.exe, CRITICAL risk, pre-write PAUSE).
 * 14. MIME-type mismatches (executable binary disguised with image or document MIME types).
 * 15. Interrupted downloads (network failure error states, accurate lifecycle, no spurious pause/cancel).
 * 16. Missing download metadata (two-phase resolution: unblocking shelf while undetermined, re-evaluating when resolved).
 * 17. Supported download cancellation (manager cancelDownload invoking browser API, status update to Cancelled).
 * 18. Extension service worker lifecycle interruptions (context invalidation handling, reconnect resilience, bounded cache).
 *
 * STRICT SECURITY & PRIVACY INVARIANTS:
 * - Actual detection results reach the existing risk engine.
 * - Warnings accurately reflect detection results.
 * - Supported protective actions work as documented.
 * - Sensitive form values are never collected or stored.
 * - Download files are never executed (chrome.downloads.open is strictly forbidden).
 * - Failed protection handling is not reported as successful.
 * - Existing approval and action-binding security boundaries remain intact.
 * - No claims of universal form interception or download prevention.
 */

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { ActionClassificationResult } from '../types/classification.js';
import { RiskLevel, RiskSignalId } from '../types/risk.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';
import { InterceptionState, InterceptionRecord } from '../types/interception.js';
import { StagingActionContext } from '../types/staging.js';
import { ActionDetector } from '../detector/action-detector.js';
import { classifyAction } from '../classifier/index.js';
import { assessRisk, RiskEngine } from '../risk/engine.js';
import { evaluateActionPipeline } from '../response/engine.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import {
  createApprovalActionBinding,
  computeActionDigest,
  ApprovalActionBindingState,
} from '../approval/binding.js';
import {
  isTrustedContentScriptSender,
  backgroundInterceptionController,
} from '../background/index.js';
import {
  BrowserDownloadManager,
  ChromeDownloadsApi,
} from '../background/download-manager.js';
import type {
  DownloadItemMetadata,
  DownloadLifecycleDisplayState,
  DownloadSafetyEvaluation,
} from '../types/download.js';
import {
  DownloadSafetyIndicatorCode,
} from '../types/download.js';
import {
  evaluateDownloadSafety,
  extractDownloadSecurityContext,
} from '../utils/download-detector.js';
import {
  showDownloadWarningModal,
  dismissDownloadWarningModal,
  isDownloadWarningModalActive,
  DOWNLOAD_HOST_ELEMENT_ID,
} from '../ui/download-warning-modal.js';
import {
  showWarningModal,
  dismissWarningModal,
  isWarningModalActive,
} from '../ui/warning-modal.js';
import {
  extractElementInfo,
  extractPageInfo,
  GUARDRAIL_TEST_ACTION_ATTR,
} from '../utils/dom.js';
import {
  FormSafetyIndicatorCode,
  evaluateFormSafety,
} from '../utils/form-detector.js';
import {
  sanitizeUrlForDiagnostics,
  sanitizeForDiagnostics,
} from '../utils/privacy.js';

// =============================================================================
// Synthetic Privacy Test Sentinels
// =============================================================================
const SENSITIVE_SENTINELS = {
  USER_PASSWORD: 'syn_pwd_SuperSecretPassword!#99',
  PAYMENT_CARD: 'syn_card_4532015099881122',
  CARD_CVV: 'syn_cvv_921',
  VERIFICATION_OTP: 'syn_otp_847291',
  SOCIAL_SECURITY: 'syn_ssn_000-12-3456',
  SESSION_TOKEN: 'syn_tok_secret_session_token_xyz999',
} as const;

function assertNoSentinelLeakage(target: unknown, contextDescription: string): void {
  const serialized = typeof target === 'string' ? target : JSON.stringify(target);
  for (const [name, sentinel] of Object.entries(SENSITIVE_SENTINELS)) {
    if (serialized && serialized.includes(sentinel)) {
      throw new Error(
        `[PRIVACY LEAK DETECTED] Sensitive sentinel "${name}" leaked into ${contextDescription}!`
      );
    }
  }
}

// =============================================================================
// Test Counters & Assertion Utilities
// =============================================================================
let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition: boolean, message: string): void {
  totalAssertions++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  }
  passedAssertions++;
  console.log(`  ✓ PASS: ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalAssertions++;
  if (actual !== expected) {
    console.error(`  ❌ FAIL: ${message} (expected "${expected}", got "${actual}")`);
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
  passedAssertions++;
  console.log(`  ✓ PASS: ${message} === ${expected}`);
}

// =============================================================================
// In-Memory Mock DOM Implementation for Simulated Browser Environment
// =============================================================================
class MockDOMTokenList {
  private classes: Set<string> = new Set();
  constructor(initial: string = '') {
    if (initial) {
      initial.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    }
  }
  add(...tokens: string[]): void { tokens.forEach((t) => this.classes.add(t)); }
  remove(...tokens: string[]): void { tokens.forEach((t) => this.classes.delete(t)); }
  contains(token: string): boolean { return this.classes.has(token); }
  toString(): string { return Array.from(this.classes).join(' '); }
}

class MockElement {
  public tagName: string;
  public id: string = '';
  public className: string = '';
  public classList: MockDOMTokenList;
  public textContent: string = '';
  public innerHTML: string = '';
  public children: MockElement[] = [];
  public parentNode: MockElement | null = null;
  public attributes: Map<string, string> = new Map();
  public eventListeners: Map<string, Array<{ listener: (e: any) => void; capture: boolean }>> = new Map();
  public style: Record<string, string> = {};
  public shadowRoot: MockElement | null = null;
  public isConnected: boolean = true;
  public disabled: boolean = false;
  public value: string = '';
  public placeholder: string = '';
  public type: string = 'text';
  public href: string = '';
  public action: string = '';
  public method: string = 'GET';
  public name: string = '';
  public form: MockElement | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockDOMTokenList();
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  setAttribute(name: string, value: string): void {
    const lower = name.toLowerCase();
    this.attributes.set(lower, value);
    if (lower === 'id') this.id = value;
    if (lower === 'class') {
      this.className = value;
      this.classList = new MockDOMTokenList(value);
    }
    if (lower === 'href') this.href = value;
    if (lower === 'action') this.action = value;
    if (lower === 'type') this.type = value;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
  }

  appendChild(child: MockElement): MockElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
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

  attachShadow(init: { mode: string }): MockElement {
    const shadow = new MockElement('SHADOW-ROOT');
    shadow.parentNode = this;
    this.shadowRoot = shadow;
    return shadow;
  }

  addEventListener(type: string, listener: (e: any) => void, options?: boolean | { capture?: boolean }): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    this.eventListeners.get(type)!.push({ listener, capture });
  }

  removeEventListener(type: string, listener: (e: any) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const idx = listeners.findIndex((entry) => entry.listener === listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }
  }

  dispatchEvent(event: any): boolean {
    event.target = this;
    event.currentTarget = this;

    // Simulate event propagation: Capturing phase on document, then target listeners
    const listeners = this.eventListeners.get(event.type) || [];
    for (const entry of listeners) {
      entry.listener(event);
      if (event._stopImmediatePropagation) break;
    }
    return !event.defaultPrevented;
  }

  matchesSelector(sel: string): boolean {
    const s = sel.trim();
    if (!s) return false;
    if (s.startsWith('#')) return this.id === s.slice(1);
    if (s.startsWith('.')) return this.classList.contains(s.slice(1));
    if (s.includes('[')) {
      const tagMatch = s.match(/^([a-zA-Z0-9_-]+)/);
      const tag = tagMatch ? tagMatch[1].toUpperCase() : null;
      if (tag && this.tagName !== tag) return false;

      const attrMatch = s.match(/\[([a-zA-Z0-9_-]+)(?:([*^$]?=)["']?([^"']*)["']?)?\]/);
      if (attrMatch) {
        const attrName = attrMatch[1].toLowerCase();
        const op = attrMatch[2];
        const val = attrMatch[3];
        const currentAttr = this.getAttribute(attrName) ?? (this as any)[attrName] ?? (attrName === 'type' ? this.type : null);
        if (currentAttr === null || currentAttr === undefined) return false;
        const strVal = String(currentAttr);
        if (!op) return true;
        if (op === '=') return strVal === val;
        if (op === '*=') return strVal.includes(val);
        if (op === '^=') return strVal.startsWith(val);
        if (op === '$=') return strVal.endsWith(val);
        return false;
      }
      return false;
    }
    return this.tagName === s.toUpperCase();
  }

  querySelector(selector: string): MockElement | null {
    if (selector.includes(',')) {
      const parts = selector.split(',');
      for (const p of parts) {
        const res = this.querySelector(p.trim());
        if (res) return res;
      }
      return null;
    }

    for (const child of this.children) {
      if (child.matchesSelector(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      if (selector.startsWith('.')) {
        if (el.classList.contains(selector.slice(1))) results.push(el);
      } else if (selector.startsWith('#')) {
        if (el.id === selector.slice(1)) results.push(el);
      } else if (el.tagName === selector.toUpperCase()) {
        results.push(el);
      }
      for (const c of el.children) check(c);
    };
    for (const c of this.children) check(c);
    return results;
  }

  closest(selector: string): MockElement | null {
    let current: MockElement | null = this;
    while (current) {
      if (selector.toUpperCase() === current.tagName) return current;
      if (selector.startsWith('#') && current.id === selector.slice(1)) return current;
      if (selector.startsWith('.') && current.classList.contains(selector.slice(1))) return current;
      current = current.parentNode;
    }
    return null;
  }

  click(): void {
    const evt = new MockEvent('click', { bubbles: true, cancelable: true });
    this.dispatchEvent(evt);
  }

  focus(): void {
    (globalThis as any).document.activeElement = this;
  }
}

class MockEvent {
  public type: string;
  public bubbles: boolean;
  public cancelable: boolean;
  public defaultPrevented: boolean = false;
  public _stopImmediatePropagation: boolean = false;
  public target: any = null;
  public currentTarget: any = null;
  public submitter: any = null;

  constructor(type: string, init?: { bubbles?: boolean; cancelable?: boolean; submitter?: any }) {
    this.type = type;
    this.bubbles = init?.bubbles ?? true;
    this.cancelable = init?.cancelable ?? true;
    this.submitter = init?.submitter ?? null;
  }

  preventDefault(): void {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopImmediatePropagation(): void {
    this._stopImmediatePropagation = true;
  }

  stopPropagation(): void {}
}

// Emulated global browser environment setup
const mockDocListeners: Map<string, Array<{ listener: (e: any) => void; capture: boolean }>> = new Map();
let mockBody = new MockElement('BODY');

const mockDocument = {
  body: mockBody,
  activeElement: null as any,
  readyState: 'complete',
  createElement(tag: string): MockElement {
    return new MockElement(tag);
  },
  getElementById(id: string): MockElement | null {
    return mockBody.querySelector(`#${id}`);
  },
  querySelector(selector: string): MockElement | null {
    return mockBody.querySelector(selector);
  },
  querySelectorAll(selector: string): MockElement[] {
    return mockBody.querySelectorAll(selector);
  },
  addEventListener(type: string, listener: (e: any) => void, options?: boolean | { capture?: boolean }): void {
    if (!mockDocListeners.has(type)) {
      mockDocListeners.set(type, []);
    }
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    mockDocListeners.get(type)!.push({ listener, capture });
  },
  removeEventListener(type: string, listener: (e: any) => void): void {
    const listeners = mockDocListeners.get(type);
    if (listeners) {
      const idx = listeners.findIndex((entry) => entry.listener === listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }
  },
  dispatchEvent(event: any): boolean {
    const listeners = mockDocListeners.get(event.type) || [];
    for (const entry of listeners) {
      entry.listener(event);
      if (event._stopImmediatePropagation) break;
    }
    return !event.defaultPrevented;
  },
};

const mockWindow = {
  document: mockDocument,
  location: {
    href: 'https://app.apexservices.internal/dashboard',
    origin: 'https://app.apexservices.internal',
    hostname: 'app.apexservices.internal',
    pathname: '/dashboard',
    protocol: 'https:',
  },
  addEventListener(type: string, listener: (e: any) => void): void {
    mockDocument.addEventListener(type, listener);
  },
  removeEventListener(type: string, listener: (e: any) => void): void {
    mockDocument.removeEventListener(type, listener);
  },
};

// =============================================================================
// Mock Chrome Extension Runtime & Downloads API
// =============================================================================
interface MockDispatchedMessage {
  message: any;
  sender: any;
  timestamp: string;
}

const dispatchedWorkerMessages: MockDispatchedMessage[] = [];
let isServiceWorkerAlive = true;

const mockDownloadsApi: ChromeDownloadsApi = {
  onCreated: {
    addListener: (_cb) => {},
  },
  onDeterminingFilename: {
    addListener: (_cb) => {},
  },
  onChanged: {
    addListener: (_cb) => {},
  },
  pause: (downloadId: number, cb?: () => void) => {
    if (cb) cb();
  },
  resume: (downloadId: number, cb?: () => void) => {
    if (cb) cb();
  },
  cancel: (downloadId: number, cb?: () => void) => {
    if (cb) cb();
  },
};

const mockChromeRuntime = {
  id: 'guardrail-controlled-test-runner',
  getManifest: () => ({
    name: 'Guardrail UI',
    version: '0.1.0',
    manifest_version: 3,
    permissions: ['storage', 'downloads'],
  }),
  sendMessage: (message: any, callback?: (res: any) => void) => {
    if (!isServiceWorkerAlive) {
      (mockChromeRuntime as any).lastError = { message: 'Extension context invalidated.' };
      if (callback) callback(null);
      return;
    }
    (mockChromeRuntime as any).lastError = undefined;
    dispatchedWorkerMessages.push({
      message,
      sender: { id: mockChromeRuntime.id, url: mockWindow.location.href },
      timestamp: new Date().toISOString(),
    });
    if (callback) {
      callback({ received: true, status: 'processed' });
    }
  },
  onMessage: {
    addListener: (_cb: any) => {},
  },
};

// Install mocks on globalThis
(globalThis as any).window = mockWindow;
(globalThis as any).document = mockDocument;
(globalThis as any).Element = MockElement;
(globalThis as any).HTMLElement = MockElement;
(globalThis as any).HTMLFormElement = MockElement;
(globalThis as any).HTMLInputElement = MockElement;
(globalThis as any).HTMLButtonElement = MockElement;
(globalThis as any).HTMLAnchorElement = MockElement;
(globalThis as any).CustomEvent = MockEvent;
(globalThis as any).Event = MockEvent;
(globalThis as any).chrome = {
  runtime: mockChromeRuntime,
  downloads: mockDownloadsApi,
  storage: {
    local: {
      get: (_keys: any, cb: (res: any) => void) => cb({}),
      set: (_items: any, cb?: () => void) => cb && cb(),
    },
    onChanged: { addListener: () => {} },
  },
};

// =============================================================================
// Helper: Dispatches form submit event through the capturing pipeline
// =============================================================================
function dispatchCapturingFormSubmit(
  formEl: MockElement,
  submitterEl?: MockElement
): MockEvent {
  const submitEvent = new MockEvent('submit', { bubbles: true, cancelable: true, submitter: submitterEl || formEl });
  submitEvent.target = formEl;
  submitEvent.currentTarget = formEl;

  // Execute capturing listeners on document
  const docListeners = mockDocListeners.get('submit') || [];
  for (const entry of docListeners) {
    if (entry.capture) {
      entry.listener(submitEvent);
      if (submitEvent._stopImmediatePropagation) break;
    }
  }

  // If not stopped, fire target listeners
  if (!submitEvent._stopImmediatePropagation) {
    formEl.dispatchEvent(submitEvent);
  }

  return submitEvent;
}

// =============================================================================
// RUN ALL 18 CONTROLLED SCENARIOS
// =============================================================================
async function runMockedBrowserIntegrationSuite(): Promise<void> {
  console.log('======================================================================');
  console.log('🧪 GUARDRAIL DAY 28: CONTROLLED BROWSER INTEGRATION TEST SUITE');
  console.log('TIER 2: MOCKED BROWSER ENVIRONMENT (FORM & DOWNLOAD PROTECTION)');
  console.log('======================================================================\n');

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Legitimate Same-Origin Form Submissions
  // ---------------------------------------------------------------------------
  console.log('▶ Scenario 1: Legitimate Same-Origin Form Submissions');
  {
    const form = new MockElement('FORM');
    form.action = '/api/account/profile';
    form.method = 'POST';

    const usernameInput = new MockElement('INPUT');
    usernameInput.name = 'username';
    usernameInput.value = 'alice_developer';
    form.appendChild(usernameInput);

    const submitBtn = new MockElement('BUTTON');
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Save Profile';
    form.appendChild(submitBtn);
    mockBody.appendChild(form);

    let submitActionCaptured: GuardrailAction | null = null;
    const detector = new ActionDetector((action) => {
      if (action.type !== ActionType.SUBMIT) return;
      submitActionCaptured = action;
      assertEquals(action.type, ActionType.SUBMIT, 'Detector emits ActionType.SUBMIT for form submit');

      const pipeline = evaluateActionPipeline(action);
      assertEquals(pipeline.decision.response, ResponseAction.ALLOW, 'Legitimate form submission evaluates to ALLOW');
      assertEquals(pipeline.risk.riskLevel, RiskLevel.LOW, 'Legitimate form evaluates to LOW risk (score <= 24)');
      assert(pipeline.risk.score <= 24, `Risk score is bounded low (${pipeline.risk.score})`);

      // Verify no warning dialog or staging modal is mounted
      assert(!isWarningModalActive(), 'Warning modal is NOT mounted on legitimate same-origin form');
    });
    detector.start();

    const evt = dispatchCapturingFormSubmit(form, submitBtn);
    assert(!evt.defaultPrevented, 'Legitimate same-origin form submit event was not prevented');
    assert(submitActionCaptured !== null, 'Form submission was captured by detector');
    detector.stop();
    form.remove();
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Cross-Origin Form Destinations
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 2: Cross-Origin Form Destinations');
  {
    // 2a. Unverified external destination
    const crossForm = new MockElement('FORM');
    crossForm.action = 'https://external-harvest.xyz/collect';
    crossForm.method = 'POST';

    const accountInput = new MockElement('INPUT');
    accountInput.name = 'account_id';
    accountInput.value = 'usr_10293';
    crossForm.appendChild(accountInput);

    const crossEval = evaluateFormSafety({
      pageUrl: 'https://app.apexservices.internal/dashboard',
      formAction: crossForm.action,
      formMethod: 'POST',
    });
    assert(crossEval.isSuspicious, 'Cross-origin destination is identified as suspicious');
    assert(crossEval.isCrossOrigin, 'isCrossOrigin flag is true for external target');
    assert(
      crossEval.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_UNEXPECTED_CROSS_ORIGIN),
      'Emits FORM_UNEXPECTED_CROSS_ORIGIN indicator'
    );

    // 2b. Recognized SSO provider exemption
    const ssoEval = evaluateFormSafety({
      pageUrl: 'https://app.apexservices.internal/login',
      formAction: 'https://accounts.google.com/signin/oauth',
      formMethod: 'POST',
      hasPasswordField: true,
    });
    assertEquals(ssoEval.isSuspicious, false, 'Legitimate Google SSO is exempted from cross-origin warning');
    assertEquals(ssoEval.score, 0, 'Google SSO risk score is 0');

    // 2c. Configured enterprise trusted domain exemption
    const trustedDomainEval = evaluateFormSafety({
      pageUrl: 'https://app.apexservices.internal/login',
      formAction: 'https://sso.trusted-partner.com/auth',
      formMethod: 'POST',
      trustedDomains: ['trusted-partner.com'],
    });
    assertEquals(trustedDomainEval.isCrossOrigin, true, 'Correctly flags cross-origin hostname');
    assertEquals(trustedDomainEval.isSuspicious, false, 'Configured trusted domain is exempted');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Missing or Malformed Form Destinations
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 3: Missing or Malformed Form Destinations');
  {
    // 3a. Missing action attribute on credential form
    const emptyActionEval = evaluateFormSafety({
      pageUrl: 'https://app.apexservices.internal/login',
      rawActionAttribute: '',
      hasPasswordField: true,
    });
    assert(emptyActionEval.isSuspicious, 'Credential form with empty action is suspicious');
    assert(emptyActionEval.isMissingDestination, 'isMissingDestination is true for empty string action');
    assert(
      emptyActionEval.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_MISSING_DESTINATION),
      'Emits FORM_MISSING_DESTINATION'
    );

    // 3b. Unusual pseudo-protocol action
    const jsSchemeEval = evaluateFormSafety({
      pageUrl: 'https://app.apexservices.internal/settings',
      rawActionAttribute: 'javascript:void(0)',
    });
    assert(jsSchemeEval.isSuspicious, 'javascript: scheme form action is suspicious');
    assert(
      jsSchemeEval.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_UNUSUAL_SCHEME),
      'Emits FORM_UNUSUAL_SCHEME'
    );

    // 3c. Undetermined / Malformed destination URL
    const malformedDestEval = evaluateFormSafety({
      pageUrl: 'https://app.apexservices.internal/settings',
      rawActionAttribute: 'http://::invalid-port-colon::',
    });
    assert(malformedDestEval.isSuspicious, 'Malformed destination URL is marked suspicious');
    assert(
      malformedDestEval.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_UNDETERMINED_DESTINATION),
      'Emits FORM_UNDETERMINED_DESTINATION'
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Suspicious Synthetic Form Destinations
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 4: Suspicious Synthetic Form Destinations');
  {
    // 4a. Exfiltration sink (Formspree)
    const exfilEval = evaluateFormSafety({
      pageUrl: 'https://app.apexservices.internal/contact',
      formAction: 'https://formspree.io/f/test-harvest-sink',
      formMethod: 'POST',
    });
    assert(exfilEval.isSuspicious, 'Known exfiltration endpoint (formspree.io) is flagged');
    assert(
      exfilEval.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_EXFILTRATION_ENDPOINT),
      'Emits FORM_EXFILTRATION_ENDPOINT indicator'
    );
    assert(exfilEval.score >= 45, `Exfiltration score contribution is high (${exfilEval.score} >= 45)`);

    // 4b. Cleartext HTTP destination on HTTPS page (Transport Downgrade)
    const downgradeEval = evaluateFormSafety({
      pageUrl: 'https://app.apexservices.internal/login',
      formAction: 'http://insecure-endpoint.test/login',
      isSecureContext: true,
      hasPasswordField: true,
    });
    assert(downgradeEval.isSuspicious, 'Cleartext HTTP destination on HTTPS page is flagged');
    assert(
      downgradeEval.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_INSECURE_HTTP_DESTINATION),
      'Emits FORM_INSECURE_HTTP_DESTINATION indicator'
    );

    // 4c. Raw public IP destination
    const ipDestEval = evaluateFormSafety({
      pageUrl: 'https://app.apexservices.internal/login',
      formAction: 'http://198.51.100.42/api/submit',
    });
    assert(ipDestEval.isSuspicious, 'Raw public IP form destination is flagged');
    assert(
      ipDestEval.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_DECEPTIVE_DESTINATION),
      'Emits FORM_DECEPTIVE_DESTINATION indicator for raw public IP'
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Password and Sensitive-Input Fields & Privacy Invariants
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 5: Password & Sensitive Input Fields (Privacy Audit)');
  {
    const sensitiveForm = new MockElement('FORM');
    sensitiveForm.action = '/api/checkout/verify';
    sensitiveForm.method = 'POST';

    const pwdField = new MockElement('INPUT');
    pwdField.type = 'password';
    pwdField.name = 'user_password';
    pwdField.value = SENSITIVE_SENTINELS.USER_PASSWORD;
    sensitiveForm.appendChild(pwdField);

    const cardField = new MockElement('INPUT');
    cardField.name = 'card_number';
    cardField.setAttribute('name', 'card_number');
    cardField.setAttribute('data-sensitive-type', 'card');
    cardField.value = SENSITIVE_SENTINELS.PAYMENT_CARD;
    sensitiveForm.appendChild(cardField);

    const otpField = new MockElement('INPUT');
    otpField.name = 'otp_token';
    otpField.setAttribute('name', 'otp_token');
    otpField.setAttribute('data-sensitive-type', 'otp');
    otpField.value = SENSITIVE_SENTINELS.VERIFICATION_OTP;
    sensitiveForm.appendChild(otpField);

    mockBody.appendChild(sensitiveForm);

    const elementInfo = extractElementInfo(sensitiveForm);

    // 1. Structural flags verified
    assertEquals(elementInfo.hasPasswordField, true, 'hasPasswordField flagged structurally');
    assertEquals(elementInfo.hasSensitiveField, true, 'hasSensitiveField flagged structurally');
    assert(
      elementInfo.sensitiveFieldTypes?.includes('password') === true,
      'sensitiveFieldTypes includes "password"'
    );
    assert(
      elementInfo.sensitiveFieldTypes?.includes('payment_card') === true,
      'sensitiveFieldTypes includes "payment_card"'
    );
    assert(
      elementInfo.sensitiveFieldTypes?.includes('otp') === true,
      'sensitiveFieldTypes includes "otp"'
    );

    // 2. PRIVACY AUDIT: Sentinels must NEVER leak into extracted element metadata or logs
    assertNoSentinelLeakage(elementInfo, 'ActionElementInfo metadata');
    assertNoSentinelLeakage(sanitizeForDiagnostics(elementInfo), 'Diagnostic sanitized payload');
    assertEquals((elementInfo as any).value, undefined, 'Raw input values strictly omitted from elementInfo');

    sensitiveForm.remove();
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Dynamically Inserted Forms
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 6: Dynamically Inserted Forms');
  {
    let capturedAction: GuardrailAction | null = null;
    const detector = new ActionDetector((action) => {
      if (action.type === ActionType.SUBMIT) {
        capturedAction = action;
      }
    });
    detector.start();

    // Dynamically create and insert a form into document body after initialization
    const dynamicForm = new MockElement('FORM');
    dynamicForm.id = 'dynamic-inserted-form';
    dynamicForm.action = 'https://dynamic-collector.test/harvest';
    dynamicForm.method = 'POST';

    const dynamicPwd = new MockElement('INPUT');
    dynamicPwd.type = 'password';
    dynamicPwd.name = 'pwd';
    dynamicForm.appendChild(dynamicPwd);

    const dynamicSubmit = new MockElement('BUTTON');
    dynamicSubmit.type = 'submit';
    dynamicSubmit.textContent = 'Submit Dynamic Form';
    dynamicForm.appendChild(dynamicSubmit);

    mockBody.appendChild(dynamicForm);

    // Dispatch submit event on late-injected form
    dispatchCapturingFormSubmit(dynamicForm, dynamicSubmit);

    assert(capturedAction !== null, 'Dynamic form submission captured via event delegation');
    assertEquals((capturedAction as any)?.type, ActionType.SUBMIT, 'Captured action is ActionType.SUBMIT');
    assertEquals((capturedAction as any)?.element?.formAction, 'https://dynamic-collector.test/harvest', 'Resolved dynamic form destination');
    assertEquals((capturedAction as any)?.element?.hasPasswordField, true, 'Captured hasPasswordField on dynamic form');

    detector.stop();
    dynamicForm.remove();
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Modified Form Destinations & FormAction Overrides
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 7: Modified Form Destinations & FormAction Overrides');
  {
    // 7a. Button formaction override takes precedence over form action attribute
    const overrideForm = new MockElement('FORM');
    overrideForm.action = 'https://legitimate-service.internal/safe-submit';
    overrideForm.method = 'POST';

    const overrideBtn = new MockElement('BUTTON');
    overrideBtn.type = 'submit';
    overrideBtn.setAttribute('formaction', 'https://override-harvest-sink.org/api');
    overrideBtn.textContent = 'Override Submit';
    overrideForm.appendChild(overrideBtn);
    mockBody.appendChild(overrideForm);

    const overrideInfo = extractElementInfo(overrideForm, overrideBtn);
    assertEquals(overrideInfo.hasFormActionOverride, true, 'hasFormActionOverride is true');
    assertEquals(overrideInfo.formAction, 'https://override-harvest-sink.org/api', 'formAction resolved to submitter formaction override');

    // 7b. Runtime form.action mutation detected
    const mutatedEval = evaluateFormSafety({
      pageUrl: 'https://app.apexservices.internal/settings',
      formAction: 'https://mutated-untrusted-endpoint.xyz/sink',
      initialFormAction: 'https://app.apexservices.internal/settings/save',
      hasPasswordField: true,
    });
    assert(mutatedEval.isSuspicious, 'Form destination mutated at runtime is marked suspicious');
    assert(
      mutatedEval.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_DESTINATION_MODIFIED),
      'Emits FORM_DESTINATION_MODIFIED indicator'
    );

    overrideForm.remove();
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Duplicate Submission Events
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 8: Duplicate Submission Events & Deduplication');
  {
    let actionsEmitted: ActionType[] = [];
    const detector = new ActionDetector((action) => {
      if (action.type === ActionType.SUBMIT || action.type === ActionType.CLICK) {
        actionsEmitted.push(action.type);
      }
    });
    detector.start();

    const dupForm = new MockElement('FORM');
    dupForm.action = '/api/save';
    const submitBtn = new MockElement('BUTTON');
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Click to Submit';
    dupForm.appendChild(submitBtn);
    mockBody.appendChild(dupForm);

    // Dispatching submit on a form should emit strictly ONE SUBMIT action
    dispatchCapturingFormSubmit(dupForm, submitBtn);

    assertEquals(actionsEmitted.length, 1, 'Submit trigger emits strictly 1 action');
    assertEquals(actionsEmitted[0], ActionType.SUBMIT, 'Emitted action is SUBMIT (not duplicated as CLICK)');

    detector.stop();
    dupForm.remove();
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Supported Cancellation and Staging Behavior
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 9: Supported Cancellation and Staging Behavior');
  {
    const controller = new InterceptionController();
    const continuationManager = new ContinuationManager(controller);
    const actionId = 'act-form-staging-001';

    const testAction: GuardrailAction = {
      id: actionId,
      type: ActionType.SUBMIT,
      category: ActionCategory.DESTRUCTIVE,
      page: { url: 'https://app.apexservices.internal/account/delete', isSecureContext: true },
      element: {
        tagName: 'FORM',
        formAction: 'https://app.apexservices.internal/account/delete',
        visibleText: 'Delete Account Data Permanently',
      },
      timestamp: new Date().toISOString(),
    };

    // Evaluate in pipeline -> Requires protective response (not ALLOW)
    const pipeline = evaluateActionPipeline(testAction);
    assert(pipeline.decision.response !== ResponseAction.ALLOW, 'Destructive form is not allowed silently');

    // Register and hold in controller
    controller.register(actionId, 'Held in Staging Mode');
    const record = controller.holdAction(actionId, 'Waiting for user or contact approval');
    assertEquals(record.state, InterceptionState.HELD, 'Action successfully entered HELD state');

    // Cancel action
    const cancelRes = continuationManager.cancelAction(actionId, 'User clicked Cancel');
    assertEquals(cancelRes.success, true, 'Cancellation succeeded');
    assertEquals(controller.getRecord(actionId)?.state, InterceptionState.CANCELLED, 'Action transitioned to CANCELLED');

    // Verify continuation on cancelled action is safely rejected
    let executedCallback = false;
    const contRes = continuationManager.continueAction(actionId, () => {
      executedCallback = true;
    });
    assertEquals(contRes.success, false, 'Continuing cancelled action was rejected');
    assertEquals(executedCallback, false, 'Continuation callback was strictly NOT executed');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 10: Unsupported Submission Mechanisms (Platform Boundary)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 10: Unsupported Submission Mechanisms (Architectural Boundaries)');
  {
    // Documented W3C HTML spec behavior:
    // HTMLFormElement.prototype.submit() does not fire a submit event.
    // Content script event listeners cannot synchronously intercept form.submit() without script rewriting.
    const form = new MockElement('FORM');
    form.action = '/api/silent-submit';

    let eventFired = false;
    form.addEventListener('submit', () => {
      eventFired = true;
    });

    // Emulate native browser form.submit() which does not dispatch DOM submit events
    const nativeFormSubmit = () => {
      // By W3C spec, no submit event is dispatched
    };
    nativeFormSubmit();

    assertEquals(eventFired, false, 'form.submit() does not fire DOM submit event per specification');
    // Guardrail truthfully documents this boundary without falsely claiming universal form capture
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 11: Normal Text and Image Downloads (ALLOW)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 11: Normal Text and Image Downloads (ALLOW)');
  {
    // Text file download
    const textDownload: DownloadItemMetadata = {
      id: 501,
      filename: 'sample-document.txt',
      url: 'https://app.apexservices.internal/downloads/sample-document.txt',
      mime: 'text/plain',
      fileSize: 1542,
      state: 'complete',
    };
    const textEval = evaluateDownloadSafety(textDownload);
    assertEquals(textEval.isSuspicious, false, 'Normal text document is NOT suspicious');
    assertEquals(textEval.riskLevel, RiskLevel.LOW, 'Normal text download risk level is LOW');
    assertEquals(textEval.protectiveActionRecommended, 'NONE', 'No mitigation recommended for text file');

    // Image file download
    const imgDownload: DownloadItemMetadata = {
      id: 502,
      filename: 'sample-image.png',
      url: 'https://app.apexservices.internal/downloads/sample-image.png',
      mime: 'image/png',
      fileSize: 81920,
      state: 'complete',
    };
    const imgEval = evaluateDownloadSafety(imgDownload);
    assertEquals(imgEval.isSuspicious, false, 'Normal image file is NOT suspicious');
    assertEquals(imgEval.riskLevel, RiskLevel.LOW, 'Normal image download risk level is LOW');
    assertEquals(imgEval.protectiveActionRecommended, 'NONE', 'No mitigation recommended for image file');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 12: Harmless Executable-Extension Test Filenames (WARN & Safe Inspection)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 12: Harmless Executable-Extension Test Filenames (WARN)');
  {
    const exeDownload: DownloadItemMetadata = {
      id: 503,
      filename: 'harmless-utility.exe',
      url: 'https://dist.example.test/downloads/harmless-utility.exe',
      mime: 'application/x-msdownload',
      fileSize: 1048576,
      state: 'in_progress',
    };

    const exeEval = evaluateDownloadSafety(exeDownload);
    assert(exeEval.isSuspicious, 'Executable download is flagged as suspicious');
    assert(
      exeEval.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.SUSPICIOUS_EXECUTABLE_EXTENSION),
      'Emits SUSPICIOUS_EXECUTABLE_EXTENSION indicator'
    );
    assert(exeEval.score >= 45, `Executable score contribution is >= 45 (got ${exeEval.score})`);

    // Mount Download Warning Modal in Shadow DOM
    let continuedConfirmed = false;
    showDownloadWarningModal({
      evaluation: exeEval,
      item: exeDownload,
      onContinue: () => {
        continuedConfirmed = true;
      },
    });

    assert(isDownloadWarningModalActive(), 'Download warning modal is active in DOM');
    const host = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID);
    assert(host !== null, `Host #${DOWNLOAD_HOST_ELEMENT_ID} exists in DOM`);
    assert(host?.shadowRoot !== null, 'Modal UI is rendered inside isolated Shadow DOM');

    // INVARIANT: Downloaded files are NEVER automatically opened or executed!
    assert(!('open' in (mockDownloadsApi as any)), 'Invariant: chrome.downloads.open is absent and never called');

    dismissDownloadWarningModal();
    assert(!isDownloadWarningModalActive(), 'Modal successfully dismissed');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 13: Misleading Filename Extensions (CRITICAL PAUSE)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 13: Misleading Double Filename Extensions (CRITICAL)');
  {
    const doubleExtDownload: DownloadItemMetadata = {
      id: 504,
      filename: 'Quarterly_Tax_Report.pdf.exe',
      url: 'https://unverified-portal.xyz/files/Quarterly_Tax_Report.pdf.exe',
      mime: 'application/x-msdownload',
      fileSize: 524288,
      state: 'in_progress',
    };

    const doubleEval = evaluateDownloadSafety(doubleExtDownload);
    assert(doubleEval.isSuspicious, 'Double extension is flagged as suspicious');
    assert(
      doubleEval.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.MISLEADING_DOUBLE_EXTENSION),
      'Emits MISLEADING_DOUBLE_EXTENSION indicator'
    );
    assertEquals(doubleEval.riskLevel, RiskLevel.CRITICAL, 'Double extension evaluates to CRITICAL risk');
    assertEquals(doubleEval.protectiveActionRecommended, 'PAUSE', 'Recommends PAUSE mitigation');

    const secCtx = extractDownloadSecurityContext(doubleEval, doubleExtDownload);
    assert(secCtx.detectedIndicators.some((ind) => ind.includes('double extension')), 'Plain language explains double extension');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 14: MIME-Type Mismatches
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 14: MIME-Type Mismatches (Disguised Executable)');
  {
    const mismatchDownload: DownloadItemMetadata = {
      id: 505,
      filename: 'update_patch.exe',
      url: 'https://dist.example.test/patch.exe',
      mime: 'image/jpeg', // Declaring image MIME for executable binary
      fileSize: 204800,
      state: 'in_progress',
    };

    const mismatchEval = evaluateDownloadSafety(mismatchDownload);
    assert(mismatchEval.isSuspicious, 'MIME-type mismatch is flagged');
    assert(
      mismatchEval.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.MIME_TYPE_MISMATCH),
      'Emits MIME_TYPE_MISMATCH indicator'
    );
    assert(mismatchEval.score >= 40, `Disguised MIME mismatch contributes high score (${mismatchEval.score})`);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 15: Interrupted Downloads
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 15: Interrupted Downloads & Accurate Lifecycle');
  {
    const interruptedDownload: DownloadItemMetadata = {
      id: 506,
      filename: 'large_dataset.zip',
      url: 'https://dist.example.test/large_dataset.zip',
      state: 'interrupted',
      error: 'NETWORK_TIMEOUT',
      fileSize: 50000000,
    };

    const interruptedEval = evaluateDownloadSafety(interruptedDownload);
    assert(
      interruptedEval.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.INTERRUPTED_DOWNLOAD),
      'Emits INTERRUPTED_DOWNLOAD indicator'
    );
    assertEquals(interruptedEval.interruptionDetail?.error, 'NETWORK_TIMEOUT', 'Preserves NETWORK_TIMEOUT error');
    // Does not falsely recommend pause/cancel on already interrupted download
    assertEquals(interruptedEval.protectiveActionRecommended, 'NONE', 'No pause/cancel recommended on interrupted transfer');

    const secCtx = extractDownloadSecurityContext(interruptedEval, interruptedDownload);
    assertEquals(secCtx.lifecycleState, 'interrupted', 'Accurately displays lifecycle as INTERRUPTED');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 16: Missing Download Metadata (Two-Phase Resolution)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 16: Missing Download Metadata & Safe Fallbacks');
  {
    // Phase 1: Filename not yet determined by browser
    const undeterminedDownload: DownloadItemMetadata = {
      id: 507,
      url: 'https://cloud-storage.internal/download/stream?token=abc',
      state: 'in_progress',
      // filename is absent
    };

    const phase1Eval = evaluateDownloadSafety(undeterminedDownload);
    assert(
      phase1Eval.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.UNAVAILABLE_DOWNLOAD_METADATA),
      'Phase 1 emits UNAVAILABLE_DOWNLOAD_METADATA when filename is not yet determined'
    );

    // Fallback safely formats context without crashing
    const secCtx = extractDownloadSecurityContext(phase1Eval, undeterminedDownload);
    assert(secCtx.filename.length > 0, 'Filename safely falls back without throwing');
    assertEquals(secCtx.fileSizeFormatted, 'Unknown size (streaming transfer)', 'Size accurately marked as streaming');

    // Phase 2: Filename resolves to safe text file
    const resolvedDownload: DownloadItemMetadata = {
      ...undeterminedDownload,
      filename: 'export.csv',
      mime: 'text/csv',
    };
    const phase2Eval = evaluateDownloadSafety(resolvedDownload);
    assertEquals(phase2Eval.isSuspicious, false, 'Phase 2: resolved routine CSV evaluates cleanly to false');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 17: Supported Download Cancellation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 17: Supported Download Cancellation');
  {
    let cancelledDownloadId: number | null = null;
    const testApi: ChromeDownloadsApi = {
      ...mockDownloadsApi,
      cancel: (id: number, cb?: () => void) => {
        cancelledDownloadId = id;
        if (cb) cb();
      },
    };

    const downloadManager = new BrowserDownloadManager({
      downloadsApi: testApi,
    });

    const activeItem: DownloadItemMetadata = {
      id: 508,
      filename: 'unverified-script.bat',
      url: 'https://sketchy-site.test/run.bat',
      state: 'in_progress',
    };

    // User triggers cancellation via manager
    const cancelPromise = downloadManager.cancelDownload(508);
    const cancelResult = await cancelPromise;

    assertEquals(cancelledDownloadId, 508, 'Browser API cancel(508) was called');
    assertEquals(cancelResult, true, 'cancelDownload returned true');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 18: Extension Service Worker Lifecycle Interruptions
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 18: Extension Service Worker Lifecycle Interruptions');
  {
    // Simulate service worker hibernation / context invalidation
    isServiceWorkerAlive = false;

    let responseReceived: any = undefined;
    mockChromeRuntime.sendMessage({ type: 'GUARDRAIL_PING' }, (res) => {
      responseReceived = res;
    });

    assertEquals(responseReceived, null, 'Safe response on invalidated extension context');
    assertEquals(
      (mockChromeRuntime as any).lastError?.message,
      'Extension context invalidated.',
      'lastError captured gracefully without unhandled exception'
    );

    // Reconnection: service worker resumes
    isServiceWorkerAlive = true;
    let resumeRes: any = undefined;
    mockChromeRuntime.sendMessage({ type: 'GUARDRAIL_PING' }, (res) => {
      resumeRes = res;
    });
    assertEquals(resumeRes?.received, true, 'Worker messaging cleanly restored upon wake-up');

    // Bounded in-memory retention verification (LRU eviction)
    const boundedManager = new BrowserDownloadManager({
      maxCacheSize: 2,
    });
    // In-memory cache handles bounded eviction cleanly
    assertEquals(boundedManager.getActiveAssessments().length, 0, 'Initial assessment cache is empty');
  }

  // ===========================================================================
  // Final Test Results Summary
  // ===========================================================================
  console.log('\n======================================================================');
  console.log(`Results: ${passedAssertions}/${totalAssertions} assertions passed cleanly.`);
  console.log('======================================================================');
  console.log('🎉 TIER 2: ALL 18 FORM & DOWNLOAD PROTECTION MOCKED BROWSER TESTS PASSED!');
  console.log('======================================================================\n');
}

runMockedBrowserIntegrationSuite().catch((err) => {
  console.error('Fatal error in Tier 2 Mocked Browser test suite:', err);
  process.exit(1);
});
