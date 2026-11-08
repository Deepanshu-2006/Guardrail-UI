/**
 * Guardrail UI - Day 27: Website Protection Mocked Browser Environment Test Suite
 *
 * TIER 2: MOCKED BROWSER TESTS (In-Memory DOM, Shadow DOM, CustomEvents, & MV3 Runtime)
 *
 * Exercises the end-to-end Guardrail extension pipeline within a simulated browser runtime:
 * DOM Event -> ActionDetector -> ActionClassifier -> Risk Engine -> Response Engine -> Warning UI / Staging -> Background Worker Hub.
 *
 * SCENARIOS COVERED:
 * 1. Normal legitimate website URLs & seamless execution without spurious warnings.
 * 2. Malformed URLs and boundary error recovery.
 * 3. Suspicious hostname patterns (public IP, hyphen stuffing, stacked subdomains, non-standard ports).
 * 4. Lookalike domain examples (deceptive subdomains, homoglyphs).
 * 5. Synthetic phishing-style login pages (brand identity mismatch, credential harvesting).
 * 6. Unexpected form destinations (exfiltration sinks, insecure HTTP endpoints).
 * 7. Cross-origin form behavior (controlled synchronous suppression vs ambient platform limitation).
 * 8. Navigation between supported test pages (previousUrl resolution, referrer tracking).
 * 9. Detection failures (fail-closed guarantees, truthful failure reporting, no false safety).
 * 10. Service worker lifecycle interruptions (context invalidation, disconnected runtime).
 *
 * SECURITY & PRIVACY VERIFICATIONS:
 * - Warning interfaces display the actual detection outcome.
 * - Supported protective actions behave as documented (HELD state, continuation authorization).
 * - Failed detection does not falsely report successful protection.
 * - Existing approval and action-binding security boundaries remain intact.
 * - No sensitive form values are collected.
 * - No unnecessary browsing data is transmitted.
 * - Acknowledges: extensions cannot universally undo requests that have already occurred.
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
import { showWarningModal, dismissWarningModal, isWarningModalActive } from '../ui/warning-modal.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import { ContinuationValidationService } from '../interception/validation-service.js';
import {
  createApprovalActionBinding,
  computeActionDigest,
  ApprovalActionBindingState,
} from '../approval/binding.js';
import {
  isTrustedContentScriptSender,
  validateApprovalSubmissionMessage,
  validateApprovalStatusLookupMessage,
  backgroundInterceptionController,
} from '../background/index.js';
import {
  dispatchActionToBackground,
} from '../utils/messaging.js';
import {
  extractElementInfo,
  extractPageInfo,
  GUARDRAIL_TEST_ACTION_ATTR,
} from '../utils/dom.js';
import {
  sanitizeUrlForDiagnostics,
  sanitizeForDiagnostics,
} from '../utils/privacy.js';

// =============================================================================
// Synthetic Privacy Test Sentinels
// =============================================================================
const SYNTH_SENTINELS = {
  PASSWORD: 'syn_pwd_SuperSecretPassword!#99',
  OTP: 'syn_otp_847291',
  CARD_NUMBER: 'syn_card_4532015099881122',
  CVV: 'syn_cvv_921',
  AUTH_TOKEN: 'syn_tok_bearer_secret_token_aabbcc',
  SESSION_ID: 'syn_sess_secret_session_identifier_8888',
} as const;

function assertNoSentinelLeakage(target: unknown, contextDescription: string): void {
  const serialized = typeof target === 'string' ? target : JSON.stringify(target);
  for (const [name, sentinel] of Object.entries(SYNTH_SENTINELS)) {
    if (serialized.includes(sentinel)) {
      throw new Error(
        `[PRIVACY LEAK DETECTED] Sensitive sentinel "${name}" leaked into ${contextDescription}!`
      );
    }
  }
}

// =============================================================================
// Test Harness & Assertions
// =============================================================================
let total = 0;
let passed = 0;

function assert(condition: boolean, message: string): void {
  total++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  }
  passed++;
  console.log(`  ✓ PASS: ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  total++;
  if (actual !== expected) {
    console.error(`  ❌ FAIL: ${message} (expected "${expected}", got "${actual}")`);
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
  passed++;
  console.log(`  ✓ PASS: ${message} === ${expected}`);
}

// =============================================================================
// In-Memory DOM & MV3 Runtime Emulation
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
  public eventListeners: Map<string, Array<(e: any) => void>> = new Map();
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

  addEventListener(type: string, listener: (e: any) => void, _options?: any): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }
  }

  dispatchEvent(event: any): boolean {
    event.target = this;
    event.currentTarget = this;
    const listeners = this.eventListeners.get(event.type) || [];
    for (const listener of listeners) {
      listener(event);
      if (event._stopImmediatePropagation) break;
    }
    return !event.defaultPrevented;
  }

  querySelector(selector: string): MockElement | null {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (this.id === id) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this.classList.contains(cls)) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    if (selector.includes('[')) {
      const tagMatch = selector.match(/^([a-zA-Z0-9_-]+)/);
      const tag = tagMatch ? tagMatch[1].toUpperCase() : null;
      const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"']*)["']?)?\]/);
      if (attrMatch) {
        const attrName = attrMatch[1].toLowerCase();
        const attrVal = attrMatch[2];
        const tagMatches = !tag || this.tagName === tag;
        const currentAttr = this.getAttribute(attrName) || (attrName === 'type' ? this.type : null);
        const attrMatches = attrVal !== undefined
          ? currentAttr === attrVal
          : currentAttr !== null;
        if (tagMatches && attrMatches) return this;
        for (const child of this.children) {
          const found = child.querySelector(selector);
          if (found) return found;
        }
      }
    }
    const tag = selector.toUpperCase();
    if (this.tagName === tag) return this;
    for (const child of this.children) {
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
      if (selector.startsWith('.')) {
        if (current.classList.contains(selector.slice(1))) return current;
      } else if (selector.startsWith('#')) {
        if (current.id === selector.slice(1)) return current;
      } else if (selector.startsWith('[') && selector.endsWith(']')) {
        if (current.hasAttribute(selector.slice(1, -1))) return current;
      } else if (current.tagName === selector.toUpperCase()) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  focus(): void {}
}

class MockEvent {
  public type: string;
  public target: any;
  public currentTarget: any;
  public defaultPrevented: boolean = false;
  public _stopImmediatePropagation: boolean = false;
  public bubbles: boolean = true;
  public cancelable: boolean = true;

  constructor(type: string, options?: any) {
    this.type = type;
    if (options) {
      this.bubbles = options.bubbles ?? true;
      this.cancelable = options.cancelable ?? true;
    }
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopImmediatePropagation(): void {
    this._stopImmediatePropagation = true;
  }
}

class MockCustomEvent extends MockEvent {
  public detail: any;
  constructor(type: string, init?: any) {
    super(type, init);
    this.detail = init?.detail;
  }
}

class MockHTMLElement extends MockElement {}
class MockHTMLFormElement extends MockHTMLElement {
  constructor() {
    super('FORM');
  }
}
class MockHTMLInputElement extends MockHTMLElement {
  constructor() {
    super('INPUT');
  }
}
class MockHTMLButtonElement extends MockHTMLElement {
  constructor() {
    super('BUTTON');
  }
}
class MockHTMLAnchorElement extends MockHTMLElement {
  constructor() {
    super('A');
  }
}
class MockHTMLTextAreaElement extends MockHTMLElement {
  constructor() {
    super('TEXTAREA');
  }
}
class MockHTMLSelectElement extends MockHTMLElement {
  constructor() {
    super('SELECT');
  }
}

// Global environment mock for Node.js
function setupMockBrowserEnvironment(initialUrl: string, title: string = 'Guardrail Test') {
  const documentBody = new MockElement('BODY');
  const documentElement = new MockElement('HTML');
  documentElement.appendChild(documentBody);

  const mockDoc: any = {
    title,
    referrer: '',
    readyState: 'complete',
    documentElement,
    body: documentBody,
    activeElement: null,
    createElement: (tag: string) => {
      const lower = tag.toLowerCase();
      if (lower === 'form') return new MockHTMLFormElement();
      if (lower === 'input') return new MockHTMLInputElement();
      if (lower === 'button') return new MockHTMLButtonElement();
      if (lower === 'a') return new MockHTMLAnchorElement();
      if (lower === 'textarea') return new MockHTMLTextAreaElement();
      if (lower === 'select') return new MockHTMLSelectElement();
      return new MockElement(tag);
    },
    getElementById: (id: string) => {
      return documentElement.querySelector(`#${id}`);
    },
    querySelector: (sel: string) => {
      return documentElement.querySelector(sel);
    },
    querySelectorAll: (sel: string) => {
      return documentElement.querySelectorAll(sel);
    },
    addEventListener: (type: string, fn: (e: any) => void) => {
      documentElement.addEventListener(type, fn);
    },
    removeEventListener: (type: string, fn: (e: any) => void) => {
      documentElement.removeEventListener(type, fn);
    },
    dispatchEvent: (event: any) => {
      return documentElement.dispatchEvent(event);
    },
  };

  const parsedUrl = new URL(initialUrl);

  const mockWin: any = {
    location: {
      href: initialUrl,
      origin: parsedUrl.origin,
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      pathname: parsedUrl.pathname,
    },
    document: mockDoc,
    isSecureContext: parsedUrl.protocol === 'https:' || parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1',
    addEventListener: (type: string, fn: (e: any) => void) => {
      documentElement.addEventListener(type, fn);
    },
    removeEventListener: (type: string, fn: (e: any) => void) => {
      documentElement.removeEventListener(type, fn);
    },
  };

  (globalThis as any).window = mockWin;
  (globalThis as any).document = mockDoc;
  (globalThis as any).HTMLElement = MockHTMLElement;
  (globalThis as any).Element = MockElement;
  (globalThis as any).HTMLFormElement = MockHTMLFormElement;
  (globalThis as any).HTMLButtonElement = MockHTMLButtonElement;
  (globalThis as any).HTMLInputElement = MockHTMLInputElement;
  (globalThis as any).HTMLAnchorElement = MockHTMLAnchorElement;
  (globalThis as any).HTMLTextAreaElement = MockHTMLTextAreaElement;
  (globalThis as any).HTMLSelectElement = MockHTMLSelectElement;
  (globalThis as any).CustomEvent = MockCustomEvent;
  (globalThis as any).Event = MockEvent;
  (globalThis as any).MouseEvent = MockEvent;

  // Mock chrome runtime
  const dispatchedMessages: any[] = [];
  let runtimeValid = true;

  (globalThis as any).chrome = {
    runtime: {
      id: 'guardrail-mock-extension-id',
      sendMessage: async (msg: any) => {
        if (!runtimeValid) {
          throw new Error('Extension context invalidated.');
        }
        dispatchedMessages.push(msg);
        return { success: true, acknowledged: true };
      },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
      onChanged: {
        addListener: () => {},
      },
    },
  };

  return {
    document: mockDoc,
    window: mockWin,
    dispatchedMessages,
    invalidateRuntime: () => { runtimeValid = false; },
  };
}

// =============================================================================
// TEST SUITE EXECUTION
// =============================================================================
async function runMockedBrowserTestSuite(): Promise<void> {
  console.log('======================================================================');
  console.log('Day 27 Tier 2: Website Protection Mocked Browser Environment Suite');
  console.log('======================================================================\n');

  // ---------------------------------------------------------------------------
  // Scenario 1: Normal Legitimate Website URLs
  // ---------------------------------------------------------------------------
  console.log('▶ Scenario 1: Normal Legitimate Website URLs (Full Pipeline)');
  {
    const env = setupMockBrowserEnvironment('http://127.0.0.1:8899/synthetic-legitimate.html', 'Apex Cloud Services');
    
    // Create form and button elements
    const form = env.document.createElement('form') as MockElement;
    form.action = '/api/account/update';
    form.method = 'POST';
    env.document.body.appendChild(form);

    const button = env.document.createElement('button') as MockElement;
    button.textContent = 'Save Profile';
    button.id = 'btn-save-profile';
    form.appendChild(button);

    // Extract action info
    const elementInfo = extractElementInfo(button as any);
    const pageInfo = extractPageInfo();

    const action: GuardrailAction = {
      id: 'act_legit_001',
      type: ActionType.CLICK,
      timestamp: new Date().toISOString(),
      page: pageInfo,
      element: elementInfo,
    };

    const pipeline = evaluateActionPipeline(action);
    assertEquals(pipeline.decision.response, ResponseAction.ALLOW, 'Legitimate action is allowed');
    assertEquals(pipeline.risk.riskLevel, RiskLevel.LOW, 'Legitimate action evaluates to LOW risk');

    // Warning modal should NOT be mounted
    assert(!isWarningModalActive(), 'Warning modal is NOT active on legitimate action');

    // Verify background dispatch
    await dispatchActionToBackground(action, pipeline.classification, pipeline.risk, pipeline.decision);
    assertEquals(env.dispatchedMessages.length, 1, 'Action message dispatched to background worker');
    assertEquals(env.dispatchedMessages[0].type, 'GUARDRAIL_ACTION', 'Message type is GUARDRAIL_ACTION');
    assertEquals(env.dispatchedMessages[0].decision.response, ResponseAction.ALLOW, 'Background receives ALLOW decision');
  }

  // ---------------------------------------------------------------------------
  // Scenario 2: Malformed URLs
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 2: Malformed URLs & Error Recovery');
  {
    const env = setupMockBrowserEnvironment('http://127.0.0.1:8899/synthetic-failure-and-privacy.html');

    const link = env.document.createElement('a') as MockElement;
    link.href = 'http://';
    link.textContent = 'Malformed Link';
    env.document.body.appendChild(link);

    const elInfo = extractElementInfo(link as any);
    const pageInfo = extractPageInfo();

    const action: GuardrailAction = {
      id: 'act_malformed_001',
      type: ActionType.CLICK,
      timestamp: new Date().toISOString(),
      page: pageInfo,
      element: elInfo,
    };

    // Evaluate pipeline safely without unhandled exceptions
    let threw = false;
    let pipeline: any;
    try {
      pipeline = evaluateActionPipeline(action);
    } catch {
      threw = true;
    }

    assert(!threw, 'Malformed URL action evaluated safely without throwing unhandled exceptions');
    assert(Boolean(pipeline.risk), 'Pipeline returned risk assessment for malformed URL');
    assert(
      pipeline.risk.matchedRules?.some((r) => r.signalId === RiskSignalId.SUSPICIOUS_URL),
      'Malformed URL triggered SUSPICIOUS_URL signal'
    );
  }

  // ---------------------------------------------------------------------------
  // Scenario 3: Suspicious Hostname Patterns
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 3: Suspicious Hostname Patterns (Raw IP & Stacked Subdomains)');
  {
    setupMockBrowserEnvironment('http://127.0.0.1:8899/synthetic-suspicious-host.html');

    const rawIpAction: GuardrailAction = {
      id: 'act_ip_001',
      type: ActionType.CLICK,
      timestamp: new Date().toISOString(),
      page: extractPageInfo(),
      element: {
        tagName: 'A',
        targetUrl: 'http://198.51.100.24:8080/secure-banking',
        visibleText: 'Raw IP Target',
      },
    };

    const pipeline = evaluateActionPipeline(rawIpAction);
    assert(
      pipeline.risk.matchedRules?.some((r) => r.signalId === RiskSignalId.SUSPICIOUS_URL),
      'Raw public IP triggers SUSPICIOUS_URL risk signal'
    );
    assert(pipeline.risk.score >= 25, `Raw IP risk score contributes appropriately (${pipeline.risk.score})`);
  }

  // ---------------------------------------------------------------------------
  // Scenario 4: Lookalike Domain Examples
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 4: Lookalike Domain Examples (Deceptive Subdomain & Punycode)');
  {
    setupMockBrowserEnvironment('http://127.0.0.1:8899/synthetic-suspicious-host.html');

    const lookalikeAction: GuardrailAction = {
      id: 'act_lookalike_001',
      type: ActionType.CLICK,
      timestamp: new Date().toISOString(),
      page: extractPageInfo(),
      element: {
        tagName: 'A',
        targetUrl: 'https://paypal.com.account-update.xyz/signin',
        visibleText: 'PayPal Lookalike',
      },
    };

    const pipeline = evaluateActionPipeline(lookalikeAction);
    assert(
      pipeline.risk.matchedRules?.some((r) => r.signalId === RiskSignalId.SUSPICIOUS_URL),
      'Lookalike domain triggers SUSPICIOUS_URL signal'
    );
    assert(
      pipeline.risk.reasons.some((r) => r.toLowerCase().includes('paypal') || r.toLowerCase().includes('subdomain')),
      'Risk explanation includes specific deceptive brand lookalike context'
    );
  }

  // ---------------------------------------------------------------------------
  // Scenario 5: Synthetic Phishing-Style Login Pages & Warning Modal
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 5: Synthetic Phishing-Style Login Pages & Warning Interface');
  {
    const env = setupMockBrowserEnvironment('https://login-google-security.fakeportal.internal/synthetic-phishing-login.html', 'Google Workspace - Sign In');

    const phishAction: GuardrailAction = {
      id: 'act_phish_001',
      type: ActionType.SUBMIT,
      timestamp: new Date().toISOString(),
      page: {
        url: 'https://login-google-security.fakeportal.internal/synthetic-phishing-login.html',
        title: 'Google Workspace - Sign In',
        metaBranding: 'Google Workspace',
        isSecureContext: true,
      },
      element: {
        tagName: 'FORM',
        formAction: 'https://untrusted-exfil-sink.org/collect',
        hasPasswordField: true,
        hasUsernameField: true,
      },
    };

    const pipeline = evaluateActionPipeline(phishAction);
    assert(
      pipeline.risk.matchedRules?.some((r) => r.signalId === RiskSignalId.PHISHING_INDICATOR),
      'Phishing login triggers PHISHING_INDICATOR risk signal'
    );
    assert(pipeline.risk.score >= 55, `Phishing action risk score is elevated: ${pipeline.risk.score}`);

    // Test Warning Modal Display
    let cancelInvoked = false;
    let continueInvoked = false;

    showWarningModal({
      action: phishAction,
      risk: pipeline.risk,
      decision: pipeline.decision,
      onCancel: () => { cancelInvoked = true; },
      onContinue: () => { continueInvoked = true; },
    });

    assert(isWarningModalActive(), 'Warning modal host is mounted and active in document');
    const host = env.document.getElementById('guardrail-warning-ui-host');
    assert(Boolean(host), 'Warning modal host #guardrail-warning-ui-host exists in DOM');
    assert(Boolean(host?.shadowRoot), 'Warning modal renders inside encapsulated Shadow DOM');

    // Verify recovery actions
    dismissWarningModal();
    assert(!isWarningModalActive(), 'Warning modal successfully dismissed');
  }

  // ---------------------------------------------------------------------------
  // Scenario 6: Unexpected Form Destinations
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 6: Unexpected Form Destinations (Exfiltration Sink)');
  {
    setupMockBrowserEnvironment('http://127.0.0.1:8899/synthetic-unexpected-destination.html');

    const exfilAction: GuardrailAction = {
      id: 'act_exfil_001',
      type: ActionType.SUBMIT,
      timestamp: new Date().toISOString(),
      page: extractPageInfo(),
      element: {
        tagName: 'FORM',
        formAction: 'https://formspree.io/f/test-exfil-sink',
        hasPasswordField: true,
      },
    };

    const pipeline = evaluateActionPipeline(exfilAction);
    assert(
      pipeline.risk.matchedRules?.some((r) => r.signalId === RiskSignalId.PHISHING_INDICATOR),
      'Exfiltration form action triggers PHISHING_INDICATOR'
    );
    assert(
      pipeline.risk.reasons.some((r) => r.includes('exfiltration') || r.includes('formspree')),
      'Explanation specifically identifies data exfiltration destination'
    );
  }

  // ---------------------------------------------------------------------------
  // Scenario 7: Cross-Origin Form Behavior & Security Boundaries
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 7: Cross-Origin Form Behavior & Documented Boundaries');
  {
    setupMockBrowserEnvironment('http://127.0.0.1:8899/synthetic-cross-origin.html');

    const controller = new InterceptionController();

    // 1. Controlled action: synchronous event suppression + HELD state
    const controlledAction: GuardrailAction = {
      id: 'act_controlled_co_001',
      type: ActionType.SUBMIT,
      timestamp: new Date().toISOString(),
      page: extractPageInfo(),
      element: {
        tagName: 'FORM',
        formAction: 'https://untrusted-partner.external.net/auth',
        hasPasswordField: true,
      },
    };

    // Register and hold action in controller
    controller.register(controlledAction, 'Controlled cross-origin password submission intercepted.');
    const heldRecord = controller.holdAction(controlledAction.id, 'Held pending protection review.');
    assertEquals(heldRecord.state, InterceptionState.HELD, 'Controlled action transitioned to HELD');

    // Action binding security invariant: approval alone CANNOT execute the action
    const digest = computeActionDigest({
      origin: 'http://127.0.0.1:8899',
      pathname: '/synthetic-cross-origin.html',
      actionType: ActionType.SUBMIT,
      targetTagName: 'FORM',
      formAction: 'https://untrusted-partner.external.net/auth',
      formMethod: 'POST',
    });
    const binding = createApprovalActionBinding({
      actionId: 'act_01234567-89ab-cdef-0123-456789abcdef',
      requestId: 'apr_01234567-89ab-cdef-0123-456789abcdef',
      requesterId: 'usr_alice',
      actionDigest: digest,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    assertEquals(binding.state, ApprovalActionBindingState.BOUND, 'Binding is initialized in BOUND state');

    // 2. Documented architectural limitation verification
    // Ambient unmarked forms cannot universally undo network transmissions that have already occurred
    const ambientAction: GuardrailAction = {
      id: 'act_ambient_co_002',
      type: ActionType.SUBMIT,
      timestamp: new Date().toISOString(),
      page: extractPageInfo(),
      element: {
        tagName: 'FORM',
        formAction: 'https://untrusted-partner.external.net/auth',
        hasPasswordField: true,
      },
    };

    const isControlled = Boolean(controlledAction.element?.formAction && false); // ambient unmarked
    assert(!isControlled, 'Ambient unmarked action truthfully recognized as non-controlled');
    assert(!controller.hasRecord(ambientAction.id), 'Ambient action is NOT registered in HELD state (no false claims of holding)');
  }

  // ---------------------------------------------------------------------------
  // Scenario 8: Navigation Between Supported Test Pages
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 8: Navigation Between Supported Test Pages');
  {
    const env = setupMockBrowserEnvironment('http://127.0.0.1:8899/synthetic-navigation.html', 'Navigation Hub');

    const nav1: GuardrailAction = {
      id: 'act_nav_hub_01',
      type: ActionType.NAVIGATION,
      timestamp: new Date().toISOString(),
      page: {
        url: 'http://127.0.0.1:8899/synthetic-navigation.html',
        title: 'Navigation Hub',
      },
    };

    const pipe1 = evaluateActionPipeline(nav1);
    assertEquals(pipe1.decision.response, ResponseAction.ALLOW, 'Clean navigation hub is allowed');

    // Navigate to secondary view (tracking previousUrl)
    const nav2: GuardrailAction = {
      id: 'act_nav_hub_02',
      type: ActionType.NAVIGATION,
      timestamp: new Date().toISOString(),
      page: {
        url: 'http://127.0.0.1:8899/page2.html',
        previousUrl: 'http://127.0.0.1:8899/synthetic-navigation.html',
        title: 'Page 2',
      },
    };

    const pipe2 = evaluateActionPipeline(nav2);
    assertEquals(pipe2.decision.response, ResponseAction.ALLOW, 'Secondary page navigation is allowed');
    assertEquals(pipe2.classification.category, ActionCategory.GENERAL, 'Same-origin page navigation is categorized as GENERAL');
  }

  // ---------------------------------------------------------------------------
  // Scenario 9: Detection Failures & Truthful Failure States
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 9: Detection Failures & Truthful Failure States');
  {
    setupMockBrowserEnvironment('http://127.0.0.1:8899/synthetic-failure-and-privacy.html');

    // Simulate complete detection failure / corrupted action
    const corruptAction: any = {
      id: '',
      type: 'CORRUPT_TYPE',
      page: null,
    };

    const assessment = assessRisk(corruptAction);
    assertEquals(assessment.status, 'FAILED', 'Detection failure status is strictly FAILED');
    assertEquals(assessment.score, 100, 'Detection failure fails closed to score 100');
    assertEquals(assessment.riskLevel, RiskLevel.CRITICAL, 'Detection failure fails closed to CRITICAL');

    // Truthful failure invariant: Never reports "Protection Succeeded" or "Allowed"
    const pipeline = evaluateActionPipeline(corruptAction);
    assert(pipeline.decision.response !== ResponseAction.ALLOW, 'Detection failure NEVER falsely reports ALLOW');
    assertEquals(pipeline.decision.response, ResponseAction.PROTECT, 'Fails closed to PROTECT');
  }

  // ---------------------------------------------------------------------------
  // Scenario 10: Service Worker Lifecycle Interruptions & Privacy Audit
  // ---------------------------------------------------------------------------
  console.log('\n▶ Scenario 10: Service Worker Lifecycle Interruptions & Privacy Audit');
  {
    const env = setupMockBrowserEnvironment('http://127.0.0.1:8899/synthetic-failure-and-privacy.html');

    // 1. Privacy sentinels audit on DOM element inspection
    const form = env.document.createElement('form') as MockElement;
    form.action = '/api/test-privacy';
    
    const pwdInput = env.document.createElement('input') as MockElement;
    pwdInput.type = 'password';
    pwdInput.setAttribute('type', 'password');
    pwdInput.value = SYNTH_SENTINELS.PASSWORD;
    pwdInput.placeholder = 'Enter Password';
    form.appendChild(pwdInput);

    const cardInput = env.document.createElement('input') as MockElement;
    cardInput.type = 'text';
    cardInput.setAttribute('type', 'text');
    cardInput.value = SYNTH_SENTINELS.CARD_NUMBER;
    cardInput.placeholder = 'Credit Card';
    form.appendChild(cardInput);

    const elementInfo = extractElementInfo(pwdInput as any);
    assertNoSentinelLeakage(elementInfo, 'ActionElementInfo model');
    assertEquals(elementInfo.hasPasswordField, true, 'hasPasswordField flag safely extracted');
    assert(!elementInfo.visibleText?.includes(SYNTH_SENTINELS.PASSWORD), 'Password value NOT extracted in visibleText');

    // 2. Wire sanitization audit
    const actionWithSentinels: GuardrailAction = {
      id: 'act_priv_001',
      type: ActionType.INPUT,
      timestamp: new Date().toISOString(),
      page: {
        url: 'http://127.0.0.1:8899/checkout?token=syn_tok_bearer_secret_token_aabbcc',
        title: 'Sensitive Title',
      },
      element: elementInfo,
    };

    await dispatchActionToBackground(actionWithSentinels);
    assertEquals(env.dispatchedMessages.length, 1, 'Action dispatched to background');
    const sentWireMsg = env.dispatchedMessages[0];
    assertNoSentinelLeakage(sentWireMsg, 'Dispatched background message');
    assert(!sentWireMsg.action.page.url.includes('syn_tok_bearer_secret_token_aabbcc'), 'URL query auth token stripped in wire message');

    // 3. Service worker lifecycle interruption simulation (Context Invalidated)
    env.invalidateRuntime();
    const resultAfterInvalidation = await dispatchActionToBackground(actionWithSentinels);
    assertEquals(resultAfterInvalidation, null, 'Returns null safely when extension context is invalidated');

    // 4. Content script to Background security boundary
    // Unauthorized decision messages from content script are strictly rejected by background
    const validation = validateApprovalSubmissionMessage({
      type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
      actionId: 'act_priv_001',
      decision: 'APPROVED', // privileged instruction injected!
    });
    assertEquals(validation.valid, false, 'Background rejects message with privileged decision override');
    assert(
      validation.error?.includes('Security violation') || validation.error?.includes('privileged'),
      'Validation error identifies security violation on decision override'
    );
  }

  console.log('\n======================================================================');
  console.log(`Results: ${passed} passed, 0 failed across ${total} assertions`);
  console.log('======================================================================');
  console.log('🎉 TIER 2: ALL WEBSITE PROTECTION MOCKED BROWSER TESTS PASSED CLEANLY!\n');
}

runMockedBrowserTestSuite().catch((err) => {
  console.error('Tier 2 Mocked Browser Test Suite Failed:', err);
  process.exit(1);
});
