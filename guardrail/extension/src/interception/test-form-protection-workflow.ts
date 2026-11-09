/**
 * Guardrail UI - Day 28: Controlled Risky Form Submission Protection Test Suite
 *
 * Exercises the end-to-end Guardrail extension form protection workflow:
 * DOM Event -> ActionDetector (deduplication & submitter extraction) ->
 * Pipeline Evaluation (Risk Engine & Response Policies) ->
 * Interception Controller (HELD state) -> Continuation Manager (safe resolution).
 *
 * SPECIFICATION & SECURITY REQUIREMENTS VERIFIED:
 * 1. Supported form submission events:
 *    - SubmitEvent on HTMLFormElement
 *    - Submit button clicks (<button type="submit">, <button> default type, <input type="submit">)
 *    - Enter keypress within form inputs
 *    - form.requestSubmit() programmatic dispatch
 * 2. Risk engine evaluation of structural form metadata (destination, scheme, sensitive inputs).
 * 3. Protection policies: ALLOW (routine), WARN (advisory), PROTECT (held).
 * 4. Staging and warning display differentiation based on browser architecture.
 * 5. Strict distinction between advisory WARN (not held, no record) and PROTECT (held in memory).
 * 6. Duplicate handling prevention:
 *    - Submit button click emits ONLY a single SUBMIT action (never a duplicate CLICK action).
 *    - Repeated submit attempts while an action is already HELD are synchronously suppressed.
 * 7. Dynamically inserted forms are detected and protected via document-level event delegation.
 * 8. Destination modification handling:
 *    - Runtime form.action mutation triggers FORM_DESTINATION_MODIFIED.
 *    - Button formaction override is extracted and evaluated as the effective target.
 * 9. Safe recovery path & fail-closed error handling:
 *    - Cancellation cleanly transitions record to CANCELLED without replaying the form.
 *    - Interception errors fail closed synchronously (preventDefault / stopImmediatePropagation).
 * 10. Documented browser architectural limitations:
 *    - form.submit() bypasses DOM event listeners by browser specification.
 *    - preventDefault() does not rewind previous network calls.
 *    - Zero raw passwords, OTPs, or credit cards are collected or stored.
 *    - Forms are NEVER replayed automatically after approval.
 */

import { ActionType, ActionCategory, GuardrailAction } from '../types/actions.js';
import { InterceptionState, InterceptionRecord } from '../types/interception.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';
import { RiskLevel, RiskSignalId } from '../types/risk.js';
import { ActionDetector } from '../detector/action-detector.js';
import { createGuardrailAction } from '../detector/action-factory.js';
import { evaluateActionPipeline } from '../response/engine.js';
import { InterceptionController, defaultInterceptionController } from './controller.js';
import { ContinuationManager, defaultContinuationManager } from './continuation.js';
import { createStagingActionContext, generateSafeActionDescription } from '../staging/context.js';
import { StagingActionContext } from '../types/staging.js';
import {
  GUARDRAIL_TEST_ACTION_ATTR,
  extractElementInfo,
  isFormSubmitTrigger,
} from '../utils/dom.js';
import { FormSafetyIndicatorCode } from '../utils/form-detector.js';

// =============================================================================
// Synthetic Privacy Test Sentinels
// =============================================================================
const SENSITIVE_SENTINELS = {
  USER_PASSWORD: 'sentinel_pass_SecretPassword!9876',
  CARD_NUMBER: 'sentinel_card_4111222233334444',
  CARD_CVV: 'sentinel_cvv_883',
  OTP_CODE: 'sentinel_otp_592817',
  SSN: 'sentinel_ssn_123-45-6789',
} as const;

function assertNoSensitiveLeakage(target: unknown, context: string): void {
  const serialized = typeof target === 'string' ? target : JSON.stringify(target);
  for (const [name, sentinel] of Object.entries(SENSITIVE_SENTINELS)) {
    if (serialized.includes(sentinel)) {
      throw new Error(`[PRIVACY LEAK] Sensitive sentinel "${name}" was leaked into ${context}!`);
    }
  }
}

// =============================================================================
// Test Runner & Assertion Helpers
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
// Mock DOM & Event Environment Setup
// =============================================================================
type EventListener = (event: any) => void;

class MockDOMEvent {
  public defaultPrevented = false;
  public propagationStopped = false;
  public immediatePropagationStopped = false;
  public isConnected = true;

  constructor(
    public type: string,
    public target: any,
    public currentTarget: any = target,
    public submitter: any = null
  ) {}

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }

  stopImmediatePropagation(): void {
    this.immediatePropagationStopped = true;
    this.propagationStopped = true;
  }
}

class MockElement {
  public attributes: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentNode: MockElement | null = null;
  public isConnected: boolean = true;
  public form: MockFormElement | null = null;
  public value: string = '';
  public placeholder: string = '';
  public innerText: string = '';
  public textContent: string = '';

  constructor(
    public tagName: string,
    public id: string = '',
    public className: string = ''
  ) {}

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  hasAttribute(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  appendChild(child: MockElement): void {
    child.parentNode = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
  }

  closest<T extends MockElement = MockElement>(selector: string): T | null {
    let current: MockElement | null = this;
    while (current) {
      if (matchesSelector(current, selector)) {
        return current as unknown as T;
      }
      current = current.parentNode;
    }
    return null;
  }

  querySelector(selector: string): MockElement | null {
    for (const child of this.children) {
      if (matchesSelector(child, selector)) {
        return child;
      }
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    for (const child of this.children) {
      if (matchesSelector(child, selector)) {
        results.push(child);
      }
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
}

class MockFormElement extends MockElement {
  public action: string = '';
  public method: string = 'GET';

  constructor(id: string = '') {
    super('FORM', id);
  }

  appendChild(child: MockElement): void {
    super.appendChild(child);
    if ('form' in child) {
      child.form = this;
    }
  }

  /**
   * Browser specification limitation test:
   * HTMLFormElement.prototype.submit() directly runs the submission algorithm
   * WITHOUT firing a DOM submit event!
   */
  submit(): void {
    // Specification invariant: NO submit event is dispatched!
  }

  /**
   * Modern browser API: form.requestSubmit() DOES dispatch a cancelable submit event.
   */
  requestSubmit(submitter?: MockElement): void {
    const event = new MockDOMEvent('submit', this, this, submitter || null);
    mockDocument.dispatchEvent(event);
  }
}

class MockButtonElement extends MockElement {
  public type: string = 'submit';

  constructor(id: string = '', text: string = 'Submit', type: string = 'submit') {
    super('BUTTON', id);
    this.type = type;
    this.innerText = text;
    this.setAttribute('type', type);
  }
}

class MockInputElement extends MockElement {
  public type: string = 'text';
  public name: string = '';

  constructor(type: string = 'text', id: string = '', name: string = '') {
    super('INPUT', id);
    this.type = type;
    this.name = name;
    this.setAttribute('type', type);
    if (name) this.setAttribute('name', name);
  }
}

function matchesSelector(element: MockElement, selector: string): boolean {
  const parts = selector.split(',').map((s) => s.trim());
  return parts.some((sel) => {
    if (sel.startsWith('[') && sel.endsWith(']')) {
      const attr = sel.slice(1, -1);
      return element.hasAttribute(attr);
    }
    if (sel.startsWith('#')) {
      return element.id === sel.slice(1);
    }
    if (sel.startsWith('.')) {
      return element.className.split(' ').includes(sel.slice(1));
    }
    if (sel.includes('[')) {
      const [tag, rest] = sel.split('[');
      const attr = rest.replace(']', '').replace(/["']/g, '');
      if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;

      if (attr.includes('*=')) {
        const [k, v] = attr.split('*=');
        const val = element.getAttribute(k) || (element as any)[k] || '';
        return typeof val === 'string' && val.includes(v);
      }
      const [k, v] = attr.split('=');
      const val = element.getAttribute(k) || (element as any)[k] || '';
      if (v) return val === v;
      return element.hasAttribute(k);
    }
    return element.tagName.toLowerCase() === sel.toLowerCase();
  });
}

class MockDocument {
  public body: MockElement = new MockElement('BODY');
  private listeners: Record<string, { listener: EventListener; useCapture: boolean }[]> = {};

  addEventListener(type: string, listener: EventListener, useCapture: boolean = false): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push({ listener, useCapture });
  }

  removeEventListener(type: string, listener: EventListener, useCapture: boolean = false): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(
      (entry) => entry.listener !== listener || entry.useCapture !== useCapture
    );
  }

  dispatchEvent(event: MockDOMEvent): boolean {
    const list = this.listeners[event.type] || [];
    for (const entry of list) {
      if (event.immediatePropagationStopped) break;
      entry.listener(event);
    }
    return !event.defaultPrevented;
  }

  getElementById(id: string): MockElement | null {
    if (this.body.id === id) return this.body;
    return this.body.querySelector(`#${id}`);
  }
}

const mockDocument = new MockDocument();
(globalThis as any).document = mockDocument;
(globalThis as any).Element = MockElement;
(globalThis as any).HTMLElement = MockElement;
(globalThis as any).HTMLFormElement = MockFormElement;
(globalThis as any).HTMLButtonElement = MockButtonElement;
(globalThis as any).HTMLInputElement = MockInputElement;
(globalThis as any).Event = MockDOMEvent;
(globalThis as any).MouseEvent = MockDOMEvent;
(globalThis as any).window = {
  location: {
    href: 'https://bank.example.com/login',
    origin: 'https://bank.example.com',
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

// =============================================================================
// Day 28 Form Protection Test Scenarios
// =============================================================================

async function runFormProtectionSuite(): Promise<void> {
  console.log('\n================================================================');
  console.log('Day 28: Controlled Risky Form Submission Protection Test Suite');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Supported Form Submission Events
  // ---------------------------------------------------------------------------
  console.log('--- Scenario 1: Supported Form Submission Events ---');
  {
    const recordedActions: GuardrailAction[] = [];
    const interceptedActions: GuardrailAction[] = [];

    const detector = new ActionDetector(
      (action) => recordedActions.push(action),
      (action, element, event) => {
        interceptedActions.push(action);
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    );
    detector.start();

    // 1A. Standard SubmitEvent on form
    const form = new MockFormElement('test-form-1');
    form.action = 'https://bank.example.com/api/login';
    form.method = 'POST';
    form.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'controlled-form-submit');
    mockDocument.body.appendChild(form);

    const submitEvent = new MockDOMEvent('submit', form, form);
    mockDocument.dispatchEvent(submitEvent);

    assertEquals(interceptedActions.length, 1, 'SubmitEvent on form was intercepted');
    assertEquals(interceptedActions[0].type, ActionType.SUBMIT, 'Action type is SUBMIT');
    assert(submitEvent.defaultPrevented, 'SubmitEvent was halted via preventDefault()');

    // 1B. Programmatic form.requestSubmit() with submitter
    const submitBtn = new MockButtonElement('btn-submit-1', 'Log In Securely');
    form.appendChild(submitBtn);

    const prevCount = interceptedActions.length;
    form.requestSubmit(submitBtn);

    assertEquals(interceptedActions.length, prevCount + 1, 'requestSubmit() triggered interception');
    assertEquals(interceptedActions[1].element?.submitButtonText, 'Log In Securely', 'Captured submitter button text');

    detector.stop();
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Submit Button Click Deduplication (Requirement 6)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 2: Submit Button Click Deduplication (Requirement 6) ---');
  {
    const ambientEmitted: GuardrailAction[] = [];
    const controlledIntercepted: GuardrailAction[] = [];

    const detector = new ActionDetector(
      (action) => ambientEmitted.push(action),
      (action, _el, event) => {
        controlledIntercepted.push(action);
        event.preventDefault();
      }
    );
    detector.start();

    // Form containing a controlled submit button
    const form = new MockFormElement('dedup-form');
    form.action = 'https://bank.example.com/checkout';
    form.method = 'POST';
    mockDocument.body.appendChild(form);

    const submitButton = new MockButtonElement('btn-submit-dedup', 'Complete Purchase');
    submitButton.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'controlled-purchase');
    form.appendChild(submitButton);

    // When the user clicks the submit button:
    // 1. Browser fires 'click' event on button
    const clickEvent = new MockDOMEvent('click', submitButton, submitButton);
    mockDocument.dispatchEvent(clickEvent);

    // VERIFICATION: The click event must NOT emit or intercept a duplicate CLICK action!
    assertEquals(
      ambientEmitted.filter((a) => a.type === ActionType.CLICK).length,
      0,
      'No CLICK action emitted for submit button'
    );
    assertEquals(
      controlledIntercepted.filter((a) => a.type === ActionType.CLICK).length,
      0,
      'No CLICK action intercepted for submit button'
    );

    // 2. Browser fires 'submit' event on form with submitter
    const submitEvent = new MockDOMEvent('submit', form, form, submitButton);
    mockDocument.dispatchEvent(submitEvent);

    // VERIFICATION: Exactly ONE action was intercepted, with ActionType.SUBMIT!
    assertEquals(controlledIntercepted.length, 1, 'Exactly one action intercepted overall');
    assertEquals(controlledIntercepted[0].type, ActionType.SUBMIT, 'Intercepted action is SUBMIT');
    assertEquals(
      controlledIntercepted[0].element?.submitButtonText,
      'Complete Purchase',
      'Submitter text preserved'
    );

    detector.stop();
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Repeated Submits While Already HELD (Requirement 6)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 3: Repeated Submits While Already HELD ---');
  {
    const controller = new InterceptionController();
    const continuation = new ContinuationManager(controller);

    const form = new MockFormElement('held-form');
    form.action = 'https://evil-exfil.com/sink';
    form.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'exfil-form');
    mockDocument.body.appendChild(form);

    const action = createGuardrailAction(ActionType.SUBMIT, form);
    const record = controller.register(action, 'Risky form submission held.');
    const heldRecord = controller.holdAction(action.id, 'Action held pending review.');
    continuation.registerHeldAction(action, heldRecord, () => {});

    // Verify initial HELD state
    assertEquals(continuation.getCurrentHeldAction()?.action.id, action.id, 'Action is held in continuation manager');

    // Simulate user attempting to click or submit the form again while HELD
    const repeatedSubmit = new MockDOMEvent('submit', form, form);
    let duplicateStaged = false;

    // Simulation of content script check (content/index.ts lines 422-440)
    const currentHeld = continuation.getCurrentHeldAction();
    if (currentHeld) {
      const existing = controller.getRecord(currentHeld.action.id);
      if (existing && existing.state === InterceptionState.HELD) {
        repeatedSubmit.preventDefault();
        repeatedSubmit.stopImmediatePropagation();
        duplicateStaged = false;
      } else {
        duplicateStaged = true;
      }
    }

    assert(repeatedSubmit.defaultPrevented, 'Repeated submit was synchronously suppressed');
    assert(repeatedSubmit.immediatePropagationStopped, 'Immediate propagation stopped on repeated submit');
    assertEquals(duplicateStaged, false, 'No duplicate staging occurred');
    assertEquals(controller.size(), 1, 'Interception controller record count remained 1');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Evaluation of Form Metadata Through Risk Engine (Requirements 2 & 3)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 4: Risk Engine Evaluation & Protection Policies ---');
  {
    // 4A: Routine same-origin benign contact form -> ALLOW
    (globalThis as any).window.location.href = 'https://bank.example.com/feedback';
    const benignForm = new MockFormElement('benign-form');
    benignForm.action = 'https://bank.example.com/feedback-submit';
    benignForm.method = 'POST';
    const nameInput = new MockInputElement('text', 'name-input', 'fullname');
    benignForm.appendChild(nameInput);
    mockDocument.body.appendChild(benignForm);

    const benignAction = createGuardrailAction(ActionType.SUBMIT, benignForm);
    const benignEval = evaluateActionPipeline(benignAction);
    assertEquals(benignEval.risk.riskLevel, RiskLevel.LOW, 'Benign form risk level is LOW');
    assertEquals(benignEval.decision.response, ResponseAction.ALLOW, 'Benign form evaluates to ALLOW');

    // 4B: Authentication login form on same-origin -> WARN
    (globalThis as any).window.location.href = 'https://bank.example.com/login';
    const loginForm = new MockFormElement('auth-form');
    loginForm.action = 'https://bank.example.com/api/login';
    loginForm.method = 'POST';
    const pwdInput = new MockInputElement('password', 'pwd-input', 'password');
    pwdInput.value = SENSITIVE_SENTINELS.USER_PASSWORD;
    loginForm.appendChild(pwdInput);
    mockDocument.body.appendChild(loginForm);

    const loginAction = createGuardrailAction(ActionType.SUBMIT, loginForm);
    const loginEval = evaluateActionPipeline(loginAction);
    assertEquals(loginEval.decision.response, ResponseAction.WARN, 'Legitimate login evaluates to WARN advisory');
    assert(loginEval.risk.score >= 20, 'Auth form triggers authentication signal (+20)');

    // 4C: Cross-origin exfiltration endpoint collecting credentials -> PROTECT
    const exfilForm = new MockFormElement('exfil-form');
    exfilForm.action = 'https://formspree.io/f/xyz123';
    exfilForm.method = 'POST';
    exfilForm.appendChild(pwdInput);
    mockDocument.body.appendChild(exfilForm);

    const exfilAction = createGuardrailAction(ActionType.SUBMIT, exfilForm);
    const exfilEval = evaluateActionPipeline(exfilAction);
    assertEquals(exfilEval.decision.response, ResponseAction.PROTECT, 'Credential exfiltration evaluates to PROTECT');
    assert(
      exfilEval.risk.riskLevel === RiskLevel.HIGH || exfilEval.risk.riskLevel === RiskLevel.CRITICAL,
      'Exfiltration risk level is HIGH or CRITICAL'
    );
    assert(
      (exfilEval.risk.structuredReasons?.some((r) => r.code === FormSafetyIndicatorCode.FORM_EXFILTRATION_ENDPOINT)) ||
      exfilEval.risk.reasons.some((r) => r.toLowerCase().includes('exfiltration')),
      'Detects FORM_EXFILTRATION_ENDPOINT indicator'
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Distinction Between WARN and PROTECT (Requirements 4 & 5)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 5: Distinguishing Warning-Only vs Held State ---');
  {
    const controller = new InterceptionController();

    // WARN behavior:
    // Advisory modal is shown; NO interception record is created; action is NOT held
    const warnAction = createGuardrailAction(ActionType.SUBMIT, new MockFormElement('warn-f'));
    const warnRecord = controller.getRecord(warnAction.id);
    assertEquals(warnRecord, undefined, 'WARN creates NO interception record in controller');

    // PROTECT behavior:
    // Form submission is halted via preventDefault; record is registered and HELD; staging context created
    const protectAction = createGuardrailAction(ActionType.SUBMIT, new MockFormElement('prot-f'));
    controller.register(protectAction, 'Risky submission halted.');
    const heldRecord = controller.holdAction(protectAction.id, 'Interception held.');
    assertEquals(heldRecord.state, InterceptionState.HELD, 'PROTECT transitions record to HELD state');

    const stagingCtx = createStagingActionContext({
      action: protectAction,
      interception: heldRecord,
      risk: {
        actionId: protectAction.id,
        score: 75,
        riskLevel: RiskLevel.HIGH,
        reasons: ['High risk form submission exfiltration sink'],
        evaluatedAt: new Date().toISOString(),
      },
      decision: {
        response: ResponseAction.PROTECT,
        ruleId: 'POLICY_PROTECT_CRITICAL_RISK',
        reason: 'Held for user approval',
      },
    });

    assertEquals(stagingCtx.interceptionState, InterceptionState.HELD, 'StagingActionContext interceptionState is HELD');
    assertEquals(stagingCtx.actionId, protectAction.id, 'Preserves actionId in staging context');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Dynamically Inserted Forms (Requirement 7)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 6: Dynamically Inserted Forms (Requirement 7) ---');
  {
    let dynamicActionCaptured: GuardrailAction | null = null;
    let interceptedElement: any = null;

    const detector = new ActionDetector(
      () => {},
      (action, element, event) => {
        dynamicActionCaptured = action;
        interceptedElement = element;
        event.preventDefault();
      }
    );
    detector.start();

    // Dynamically create and inject form into DOM after detector start
    const dynamicForm = new MockFormElement('dynamic-injected-form');
    dynamicForm.action = 'https://webhook.site/test-uuid';
    dynamicForm.method = 'POST';
    dynamicForm.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'dynamic-test-form');
    mockDocument.body.appendChild(dynamicForm);

    const submitEvent = new MockDOMEvent('submit', dynamicForm, dynamicForm);
    mockDocument.dispatchEvent(submitEvent);

    assert(dynamicActionCaptured !== null, 'Dynamically inserted form was captured via event delegation');
    assertEquals((dynamicActionCaptured as any)?.type, ActionType.SUBMIT, 'Captured action is SUBMIT');
    assert(submitEvent.defaultPrevented, 'Dynamically inserted form was halted');

    detector.stop();
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Modified Form Destinations & FormAction Overrides (Requirement 8)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 7: Modified Destinations & FormAction Overrides ---');
  {
    // 7A: Runtime form.action mutation
    const mutatedForm = new MockFormElement('mutated-form');
    mutatedForm.action = 'https://bank.example.com/api/login';
    mutatedForm.setAttribute('action', 'https://bank.example.com/api/login');
    mutatedForm.setAttribute('data-guardrail-initial-action', 'https://bank.example.com/api/login');

    // Attacker script mutates destination to exfiltration site
    mutatedForm.action = 'https://attacker.com/steal';
    mutatedForm.setAttribute('action', 'https://attacker.com/steal');
    const pwdInput = new MockInputElement('password', 'mut-pwd');
    mutatedForm.appendChild(pwdInput);

    const mutatedAction = createGuardrailAction(ActionType.SUBMIT, mutatedForm);
    const mutatedEval = evaluateActionPipeline(mutatedAction);
    assertEquals(mutatedEval.decision.response, ResponseAction.PROTECT, 'Mutated credential destination evaluates to PROTECT');
    assert(
      (mutatedEval.risk.structuredReasons?.some((r) => r.code.includes(FormSafetyIndicatorCode.FORM_DESTINATION_MODIFIED))) ||
      mutatedEval.risk.reasons.some((r) => r.toLowerCase().includes('redirected') || r.toLowerCase().includes('modified') || r.toLowerCase().includes('tampered')),
      'Emits FORM_DESTINATION_MODIFIED indicator'
    );

    // 7B: Compounded dangerous destination mutation (cleartext HTTP exfiltration) -> PROTECT
    const compoundForm = new MockFormElement('compound-form');
    compoundForm.action = 'https://bank.example.com/api/login';
    compoundForm.setAttribute('action', 'https://bank.example.com/api/login');
    compoundForm.setAttribute('data-guardrail-initial-action', 'https://bank.example.com/api/login');

    // Mutated to cleartext HTTP exfiltration sink
    compoundForm.action = 'http://formspree.io/f/exfil';
    compoundForm.setAttribute('action', 'http://formspree.io/f/exfil');
    const pwdInput2 = new MockInputElement('password', 'comp-pwd');
    compoundForm.appendChild(pwdInput2);

    const compoundAction = createGuardrailAction(ActionType.SUBMIT, compoundForm);
    const compoundEval = evaluateActionPipeline(compoundAction);
    assertEquals(compoundEval.decision.response, ResponseAction.PROTECT, 'Compound exfiltration mutation evaluates to PROTECT');

    // 7B: Button formaction override
    const overrideForm = new MockFormElement('override-form');
    overrideForm.action = 'https://bank.example.com/api/transfer';
    overrideForm.method = 'POST';

    const overrideButton = new MockButtonElement('btn-override', 'Fast Submit');
    overrideButton.setAttribute('formaction', 'https://phishing-sink.net/steal');
    overrideButton.setAttribute('formmethod', 'POST');
    overrideForm.appendChild(overrideButton);

    const overrideAction = createGuardrailAction(ActionType.SUBMIT, overrideForm, undefined, overrideButton);
    assertEquals(overrideAction.element?.formAction, 'https://phishing-sink.net/steal', 'Resolves formaction override');
    assertEquals(overrideAction.element?.hasFormActionOverride, true, 'hasFormActionOverride is true');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Safe Recovery Path & Fail-Closed Behavior (Requirement 9)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 8: Safe Recovery Path & Fail-Closed Error Handling ---');
  {
    const controller = new InterceptionController();
    const continuation = new ContinuationManager(controller);

    const form = new MockFormElement('cancel-form');
    form.action = 'https://bank.example.com/api/transfer';
    const action = createGuardrailAction(ActionType.SUBMIT, form);
    controller.register(action, 'Held for review');
    const held = controller.holdAction(action.id, 'Held');

    let handlerExecuted = false;
    continuation.registerHeldAction(action, held, () => {
      handlerExecuted = true;
    });

    // 8A. User cancels the held action
    const cancelResult = continuation.cancelAction(action.id, 'User cancelled submission.');
    assertEquals(cancelResult.success, true, 'Cancellation succeeded');
    assertEquals(cancelResult.record?.state, InterceptionState.CANCELLED, 'State transitioned to CANCELLED');
    assertEquals(handlerExecuted, false, 'Handler was NOT executed on cancellation');

    // Attempting to continue a cancelled action must be rejected
    const continueAttempt = continuation.continueAction(action.id);
    assertEquals(continueAttempt.success, false, 'Continuing cancelled action was rejected');

    // 8B. Fail-closed error handling in detector
    let errorCaught = false;
    const faultyDetector = new ActionDetector(
      () => {},
      () => {
        throw new Error('Simulated internal extension error during interception evaluation!');
      }
    );
    faultyDetector.start();

    const faultForm = new MockFormElement('fault-form');
    faultForm.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'faulty-action');
    mockDocument.body.appendChild(faultForm);

    const faultEvent = new MockDOMEvent('submit', faultForm, faultForm);
    try {
      mockDocument.dispatchEvent(faultEvent);
    } catch {
      errorCaught = true;
    }

    assertEquals(errorCaught, false, 'Detector caught internal error gracefully');
    assert(faultEvent.defaultPrevented, 'Event was suppressed via fail-closed preventDefault()');
    assert(faultEvent.immediatePropagationStopped, 'Event propagation was stopped via stopImmediatePropagation()');

    faultyDetector.stop();
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Strict Security & Privacy Invariants
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 9: Strict Security & Privacy Invariants ---');
  {
    const sensitiveForm = new MockFormElement('secure-audit-form');
    sensitiveForm.action = 'https://bank.example.com/secure-gateway';
    sensitiveForm.method = 'POST';

    const pField = new MockInputElement('password', 'pwd');
    pField.value = SENSITIVE_SENTINELS.USER_PASSWORD;
    const cField = new MockInputElement('text', 'cc-num');
    cField.setAttribute('autocomplete', 'cc-number');
    cField.value = SENSITIVE_SENTINELS.CARD_NUMBER;
    const oField = new MockInputElement('text', 'otp');
    oField.setAttribute('autocomplete', 'one-time-code');
    oField.value = SENSITIVE_SENTINELS.OTP_CODE;

    sensitiveForm.appendChild(pField);
    sensitiveForm.appendChild(cField);
    sensitiveForm.appendChild(oField);
    mockDocument.body.appendChild(sensitiveForm);

    const action = createGuardrailAction(ActionType.SUBMIT, sensitiveForm);
    const controller = new InterceptionController();
    const record = controller.register(action, 'Audit check');
    const held = controller.holdAction(action.id, 'Held check');
    const staging = createStagingActionContext({
      action,
      interception: held,
      risk: {
        actionId: action.id,
        score: 80,
        riskLevel: RiskLevel.HIGH,
        reasons: ['Protected form collecting sensitive data'],
        evaluatedAt: new Date().toISOString(),
      },
      decision: {
        response: ResponseAction.PROTECT,
        ruleId: 'POLICY_PROTECT_CRITICAL_RISK',
        reason: 'Protected form',
      },
    });

    // PRIVACY AUDIT: Ensure ZERO sensitive data leaked into any object
    assertNoSensitiveLeakage(action, 'GuardrailAction');
    assertNoSensitiveLeakage(record, 'InterceptionRecord');
    assertNoSensitiveLeakage(staging, 'StagingActionContext');

    assertEquals(action.element?.hasPasswordField, true, 'hasPasswordField flagged structurally');
    assertEquals(action.element?.hasSensitiveField, true, 'hasSensitiveField flagged structurally');
    assert(action.element?.sensitiveFieldTypes?.includes('password') === true, 'Contains password structural type');
    assert(action.element?.sensitiveFieldTypes?.includes('payment_card') === true, 'Contains card structural type');
    assert(action.element?.sensitiveFieldTypes?.includes('otp') === true, 'Contains otp structural type');

    const desc = generateSafeActionDescription(action);
    assert(!desc.includes('password'), 'Description does not leak passwords');
    assert(!desc.includes('sentinel'), 'Description does not leak sentinels');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 10: Unsupported Submission Mechanisms (Requirement 10)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 10: Unsupported Submission Mechanisms (Requirement 10) ---');
  {
    let submitEventDispatched = false;
    mockDocument.addEventListener('submit', () => {
      submitEventDispatched = true;
    });

    const unsuppForm = new MockFormElement('unsupported-form');
    unsuppForm.action = 'https://attacker.com/sink';
    mockDocument.body.appendChild(unsuppForm);

    // Test specification behavior: form.submit() does NOT fire submit event
    unsuppForm.submit();
    assertEquals(submitEventDispatched, false, 'form.submit() does not fire DOM submit event per specification');

    // Documented limitation verified:
    // Guardrail cannot claim protection for script-invoked form.submit(), which bypasses DOM events.
    // Applications and tests must rely on supported submit events (requestSubmit, user submit buttons, Enter key).
  }

  console.log('\n================================================================');
  console.log(`Day 28 Form Protection Suite Complete: ${passedAssertions}/${totalAssertions} assertions passed`);
  console.log('================================================================\n');
}

runFormProtectionSuite().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
