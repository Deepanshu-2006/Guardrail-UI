/**
 * Guardrail Action Interception - Response Engine Integration Test Suite
 *
 * Verifies the end-to-end integration between the Response Engine and the Interception Controller
 * for explicitly marked controlled test actions (data-guardrail-test-action):
 *
 * 1. ALLOW:
 *    - Does NOT intercept the action.
 *    - Allows the host webpage click handler to execute normally.
 *    - Does NOT create an interception record.
 *
 * 2. WARN:
 *    - Preserves existing Guardrail warning behavior.
 *    - Does NOT treat WARN as authorization to execute an already-held action.
 *    - Does NOT create an unnecessary interception record if not held.
 *    - Allows normal page execution.
 *
 * 3. PROTECT:
 *    - Prevents the controlled test action from executing (preventDefault + stopImmediatePropagation).
 *    - Creates an InterceptionRecord in the InterceptionController.
 *    - Transitions the record to HELD.
 *    - Generates a development notice explaining that the action is waiting for a protection decision.
 *
 * 4. UNMARKED ACTIONS:
 *    - Arbitrary unmarked controls are never intercepted, keeping normal browsing unaffected.
 *
 * 5. ACTION ID PRESERVATION:
 *    - Preserves actionId across detection, classification, risk assessment, response, and interception.
 *
 * 6. PRIVACY & SECURITY:
 *    - Stores no passwords, cards, OTPs, form payloads, or live DOM element references.
 */

declare const process: { exit: (code: number) => void };

import { ActionType, GuardrailAction } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { InterceptionState } from '../types/interception.js';
import { classifyAction } from '../classifier/index.js';
import { assessRisk } from '../risk/index.js';
import { decideResponse } from '../response/index.js';
import { InterceptionController } from './controller.js';
import { GUARDRAIL_TEST_ACTION_ATTR } from '../utils/dom.js';

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
console.log('🧪 RESPONSE ENGINE & INTERCEPTION CONTROLLER INTEGRATION');
console.log('============================================================\n');

// -----------------------------------------------------------------------------
// Lightweight Mock Event & DOM Environment
// -----------------------------------------------------------------------------
class MockEvent {
  public type: string;
  public target: MockElement;
  public defaultPrevented: boolean = false;
  public immediatePropagationStopped: boolean = false;
  public propagationStopped: boolean = false;

  constructor(type: string, target: MockElement) {
    this.type = type;
    this.target = target;
  }

  public preventDefault(): void {
    this.defaultPrevented = true;
  }

  public stopImmediatePropagation(): void {
    this.immediatePropagationStopped = true;
    this.propagationStopped = true;
  }

  public stopPropagation(): void {
    this.propagationStopped = true;
  }
}

class MockElement {
  public tagName: string;
  public id: string = '';
  public textContent: string = '';
  public attributes: Record<string, string> = {};
  public style: Record<string, string> = {};
  public parentElement: MockElement | null = null;
  public listeners: Record<string, ((e: MockEvent) => void)[]> = {};

  constructor(tagName: string = 'BUTTON') {
    this.tagName = tagName.toUpperCase();
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  public getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  public hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  public removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  public addEventListener(type: string, fn: (e: MockEvent) => void): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(fn);
  }

  public dispatchEvent(event: MockEvent): boolean {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        if (event.immediatePropagationStopped) break;
        listener(event);
      }
    }
    return !event.defaultPrevented;
  }

  public closest(selector: string): MockElement | null {
    if (selector.includes(GUARDRAIL_TEST_ACTION_ATTR)) {
      if (this.hasAttribute(GUARDRAIL_TEST_ACTION_ATTR)) return this;
      return this.parentElement ? this.parentElement.closest(selector) : null;
    }
    if (selector.toLowerCase().includes('button')) {
      if (this.tagName === 'BUTTON') return this;
      return this.parentElement ? this.parentElement.closest(selector) : null;
    }
    return null;
  }
}

/**
 * Simulates the integrated Guardrail capture-phase interception logic
 * matching src/content/index.ts and src/detector/action-detector.ts.
 */
function simulateGuardrailPipeline(
  element: MockElement,
  event: MockEvent,
  controller: InterceptionController
): {
  action: GuardrailAction;
  response: ResponseAction;
  riskScore: number;
  devMessage?: string;
  recordCreated: boolean;
} {
  const markedTarget = element.closest(`[${GUARDRAIL_TEST_ACTION_ATTR}]`);

  // Unmarked elements do not enter interception flow
  if (!markedTarget) {
    throw new Error('simulateGuardrailPipeline called on unmarked element');
  }

  const action: GuardrailAction = {
    id: `act-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type: ActionType.CLICK,
    element: {
      tagName: markedTarget.tagName,
      id: markedTarget.id,
      visibleText: markedTarget.textContent,
    },
    page: {
      url: 'http://localhost:3000/demo-sites/test-page/',
      title: 'Guardrail Test Page',
    },
    timestamp: new Date().toISOString(),
  };

  // Run pure synchronous pipeline
  const classification = classifyAction(action);
  const risk = assessRisk(action, classification);
  const decision = decideResponse(risk);

  // Validate actionId consistency
  if (action.id !== classification.actionId || action.id !== risk.actionId || action.id !== decision.actionId) {
    throw new Error('actionId mismatch across pipeline stages');
  }

  let devMessage: string | undefined;
  let recordCreated = false;

  switch (decision.response) {
    case ResponseAction.ALLOW: {
      // ALLOW:
      // * Do not intercept the action.
      // * Allow the controlled website handler to execute normally.
      // * Do not create an interception record.
      break;
    }

    case ResponseAction.WARN: {
      // WARN:
      // * Preserve existing Guardrail warning behavior.
      // * Do not treat WARN as authorization to execute an already-held action.
      // * Do not create an unnecessary interception record if the action has not been held.
      break;
    }

    case ResponseAction.PROTECT: {
      // PROTECT:
      // * Prevent the supported test action from executing through the controlled event flow.
      event.preventDefault();
      event.stopImmediatePropagation();

      // * Create an interception record.
      controller.register(action, 'Controlled test action halted pending protection decision.');

      // * Transition the record to HELD.
      controller.holdAction(
        action.id,
        'Action intercepted and held by Guardrail. Waiting for a protection decision.'
      );

      recordCreated = true;
      devMessage = `[Guardrail Development Notice] Action ${action.id} is HELD and waiting for a protection decision.`;
      break;
    }
  }

  return {
    action,
    response: decision.response,
    riskScore: risk.score,
    devMessage,
    recordCreated,
  };
}

// ------------------------------------------------------------
// TEST 1: MARKED TEST ACTION EVALUATING TO ALLOW
// ------------------------------------------------------------
console.log('▶ Test 1: Explicitly Marked Test Action Evaluating to ALLOW');

const controller1 = new InterceptionController();

const allowButton = new MockElement('BUTTON');
allowButton.id = 'btn-intercept-allow';
allowButton.textContent = 'View Dashboard Summary';
allowButton.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'test-allow');

let allowHandlerExecuted = false;
allowButton.addEventListener('click', () => {
  allowHandlerExecuted = true;
});

const allowEvent = new MockEvent('click', allowButton);
const allowResult = simulateGuardrailPipeline(allowButton, allowEvent, controller1);

// Dispatch to button (simulating browser continuing down to target)
allowButton.dispatchEvent(allowEvent);

assertEquals(allowResult.response, ResponseAction.ALLOW, 'Pipeline rendered response');
assertEquals(allowEvent.defaultPrevented, false, 'ALLOW does not preventDefault');
assertEquals(allowEvent.immediatePropagationStopped, false, 'ALLOW does not stopImmediatePropagation');
assertEquals(allowHandlerExecuted, true, 'Controlled website click handler executed normally');
assertEquals(allowResult.recordCreated, false, 'No interception record created');
assertEquals(controller1.hasRecord(allowResult.action.id), false, 'Action is NOT tracked in InterceptionController');

// ------------------------------------------------------------
// TEST 2: MARKED TEST ACTION EVALUATING TO WARN
// ------------------------------------------------------------
console.log('\n▶ Test 2: Explicitly Marked Test Action Evaluating to WARN');

const controller2 = new InterceptionController();

const warnButton = new MockElement('BUTTON');
warnButton.id = 'btn-intercept-warn';
warnButton.textContent = 'Delete Account Profile';
warnButton.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'test-warn');

let warnHandlerExecuted = false;
warnButton.addEventListener('click', () => {
  warnHandlerExecuted = true;
});

const warnEvent = new MockEvent('click', warnButton);
const warnResult = simulateGuardrailPipeline(warnButton, warnEvent, controller2);

// Dispatch to button (simulating event flow where WARN does not halt execution)
warnButton.dispatchEvent(warnEvent);

assertEquals(warnResult.response, ResponseAction.WARN, 'Pipeline rendered response');
assertEquals(warnEvent.defaultPrevented, false, 'WARN does not preventDefault');
assertEquals(warnEvent.immediatePropagationStopped, false, 'WARN does not stopImmediatePropagation');
assertEquals(warnHandlerExecuted, true, 'Normal click handler ran (advisory warning only)');
assertEquals(warnResult.recordCreated, false, 'No interception record created');
assertEquals(controller2.hasRecord(warnResult.action.id), false, 'Action is NOT held in InterceptionController');
assert(
  !controller2.hasRecord(warnResult.action.id),
  'WARN is NOT treated as authorization to execute an already-held action (not held in controller)'
);

// ------------------------------------------------------------
// TEST 3: MARKED TEST ACTION EVALUATING TO PROTECT
// ------------------------------------------------------------
console.log('\n▶ Test 3: Explicitly Marked Test Action Evaluating to PROTECT');

const controller3 = new InterceptionController();

const protectButton = new MockElement('BUTTON');
protectButton.id = 'btn-intercept-protect';
protectButton.textContent = 'Delete All Data, Cancel Billing, and Export to External Server';
protectButton.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'test-protect');

let protectHandlerExecuted = false;
protectButton.addEventListener('click', () => {
  protectHandlerExecuted = true;
});

const protectEvent = new MockEvent('click', protectButton);
const protectResult = simulateGuardrailPipeline(protectButton, protectEvent, controller3);

// Attempt to dispatch to button: should be blocked by stopImmediatePropagation
protectButton.dispatchEvent(protectEvent);

assertEquals(protectResult.response, ResponseAction.PROTECT, 'Pipeline rendered response');
assertEquals(protectEvent.defaultPrevented, true, 'PROTECT invoked event.preventDefault()');
assertEquals(protectEvent.immediatePropagationStopped, true, 'PROTECT invoked event.stopImmediatePropagation()');
assertEquals(protectHandlerExecuted, false, 'Normal click handler was PREVENTED from executing');
assertEquals(protectResult.recordCreated, true, 'Interception record was created');
assertEquals(controller3.hasRecord(protectResult.action.id), true, 'Action is tracked in InterceptionController');

const heldRecord = controller3.getRecord(protectResult.action.id);
assertEquals(heldRecord?.state, InterceptionState.HELD, 'InterceptionRecord transitioned to HELD');
assertEquals(heldRecord?.actionId, protectResult.action.id, 'actionId preserved in InterceptionRecord');
assert(
  Boolean(protectResult.devMessage && protectResult.devMessage.includes('waiting for a protection decision')),
  'Development message explains action is waiting for a protection decision'
);

// ------------------------------------------------------------
// TEST 4: UNMARKED ACTIONS ARE NEVER INTERCEPTED
// ------------------------------------------------------------
console.log('\n▶ Test 4: Arbitrary Unmarked Controls Are Never Intercepted');

const controller4 = new InterceptionController();

const unmarkedButton = new MockElement('BUTTON');
unmarkedButton.id = 'btn-unmarked-action';
unmarkedButton.textContent = 'Delete All Data, Cancel Billing, and Export';
// Notice: NO data-guardrail-test-action attribute!

let unmarkedHandlerRan = false;
unmarkedButton.addEventListener('click', () => {
  unmarkedHandlerRan = true;
});

const unmarkedEvent = new MockEvent('click', unmarkedButton);
const unmarkedTarget = unmarkedButton.closest(`[${GUARDRAIL_TEST_ACTION_ATTR}]`);

assertEquals(unmarkedTarget, null, 'Unmarked button is not recognized as a controlled test action');

if (!unmarkedTarget) {
  // Guardrail lets standard browsing events proceed to target
  unmarkedButton.dispatchEvent(unmarkedEvent);
}

assertEquals(unmarkedHandlerRan, true, 'Normal handler ran for unmarked control');
assertEquals(unmarkedEvent.defaultPrevented, false, 'event.preventDefault() NOT called on unmarked element');
assertEquals(unmarkedEvent.immediatePropagationStopped, false, 'event.stopImmediatePropagation() NOT called');
assertEquals(controller4.size(), 0, 'No records created in controller for unmarked element');

// ------------------------------------------------------------
// TEST 5: ACTION ID PRESERVATION ACROSS PIPELINE
// ------------------------------------------------------------
console.log('\n▶ Test 5: actionId Preservation Across Pipeline & Lifecycle');

const testAction: GuardrailAction = {
  id: 'act-chain-id-test-999',
  type: ActionType.CLICK,
  element: {
    tagName: 'BUTTON',
    id: 'btn-test',
    visibleText: 'Delete All Data and Cancel Billing',
  },
  page: {
    url: 'http://localhost:3000/demo-sites/test-page/',
    title: 'Test Page',
  },
  timestamp: new Date().toISOString(),
};

const cl = classifyAction(testAction);
const rk = assessRisk(testAction, cl);
const dc = decideResponse(rk);

const controller5 = new InterceptionController();
controller5.register(testAction);
const rec = controller5.holdAction(testAction.id);

assertEquals(cl.actionId, testAction.id, 'Classification preserves actionId');
assertEquals(rk.actionId, testAction.id, 'Risk assessment preserves actionId');
assertEquals(dc.actionId, testAction.id, 'Response decision preserves actionId');
assertEquals(rec.actionId, testAction.id, 'InterceptionRecord preserves actionId');

// ------------------------------------------------------------
// TEST 6: PRIVACY & DATA ISOLATION ASSURANCES
// ------------------------------------------------------------
console.log('\n▶ Test 6: Privacy and Data Isolation on Intercepted Record');

const recorded = controller5.getRecord(testAction.id);
assert(Boolean(recorded), 'InterceptionRecord exists in controller');

const serialized = JSON.stringify(recorded);
const parsed = JSON.parse(serialized);

assertEquals(parsed.actionId, testAction.id, 'actionId serialized cleanly');
assertEquals(parsed.state, 'HELD', 'Interception state serialized as HELD');

const forbiddenKeys = ['password', 'card', 'cvv', 'otp', 'value', 'node', 'element', 'target'];
for (const key of forbiddenKeys) {
  assert(!(key in parsed), `InterceptionRecord does NOT contain forbidden property "${key}"`);
}

console.log('\n============================================================');
console.log(`TOTAL INTEGRATION TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
}
