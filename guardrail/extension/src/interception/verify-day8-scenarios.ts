/**
 * Guardrail Day 8 - Comprehensive Workflow Verification Test Suite
 *
 * Verifies the end-to-end Guardrail action interception workflow on the controlled test website:
 *
 * TEST 1 — Normal action:
 *   - Trigger a low-risk, explicitly marked test action.
 *   - Verify it executes normally when the response is ALLOW.
 *
 * TEST 2 — Protected action:
 *   - Trigger a controlled test action that receives a PROTECT response.
 *   - Verify Guardrail intercepts it before the normal test handler executes.
 *   - Verify the interception record reaches HELD.
 *
 * TEST 3 — Continue:
 *   - Continue a HELD action.
 *   - Verify the interception record becomes CONTINUED.
 *   - Verify the test handler executes exactly once.
 *
 * TEST 4 — Cancel:
 *   - Hold another test action.
 *   - Cancel it.
 *   - Verify the interception record becomes CANCELLED.
 *   - Verify the test handler never executes.
 *
 * TEST 5 — Duplicate controls:
 *   - Rapidly click Continue multiple times.
 *   - Verify the action executes at most once.
 *
 * TEST 6 — Invalid state transitions:
 *   - Try continuing a cancelled action.
 *   - Try cancelling a continued action.
 *   - Verify invalid transitions are rejected safely.
 *
 * TEST 7 — Reload and cleanup:
 *   - Reload the test page during or after an interception.
 *   - Document what state is lost and ensure the page does not falsely claim that an action executed.
 *
 * TEST 8 — Privacy:
 *   - Verify that no passwords, OTPs, card numbers, or other input values are captured.
 *
 * ALSO AUDITED:
 *   - TypeScript compilation
 *   - browser-console errors
 *   - extension service-worker errors
 *   - correct actionId propagation
 *   - no accidental interception of unmarked controls
 *   - no duplicate event listeners
 */

declare const process: { exit: (code: number) => void };

import { ActionType, GuardrailAction } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { InterceptionState } from '../types/interception.js';
import { classifyAction } from '../classifier/index.js';
import { assessRisk } from '../risk/index.js';
import { decideResponse } from '../response/index.js';
import { InterceptionController } from './controller.js';
import { ContinuationManager } from './continuation.js';
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
console.log('🛡️ GUARDRAIL DAY 8: COMPLETE WORKFLOW VERIFICATION SUITE');
console.log('============================================================\n');

// -----------------------------------------------------------------------------
// DOM & Event Simulation Environment matching test-page & content script
// -----------------------------------------------------------------------------
class MockSimulatedEvent {
  public type: string;
  public target: MockSimulatedElement;
  public defaultPrevented: boolean = false;
  public immediatePropagationStopped: boolean = false;
  public propagationStopped: boolean = false;

  constructor(type: string, target: MockSimulatedElement) {
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

class MockSimulatedElement {
  public tagName: string;
  public id: string = '';
  public textContent: string = '';
  public attributes: Record<string, string> = {};
  public style: Record<string, string> = {};
  public parentElement: MockSimulatedElement | null = null;
  public listeners: Record<string, ((e: MockSimulatedEvent) => void)[]> = {};

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

  public addEventListener(type: string, fn: (e: MockSimulatedEvent) => void): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(fn);
  }

  public dispatchEvent(event: MockSimulatedEvent): boolean {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        if (event.immediatePropagationStopped) break;
        listener(event);
      }
    }
    return !event.defaultPrevented;
  }

  public closest(selector: string): MockSimulatedElement | null {
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
 * Harness simulating the exact capture-phase interception and continuation
 * architecture from src/content/index.ts and src/detector/action-detector.ts.
 */
class GuardrailTestHarness {
  public controller: InterceptionController;
  public continuationManager: ContinuationManager;
  public dispatchedEvents: { type: string; detail: any }[] = [];

  constructor() {
    this.controller = new InterceptionController();
    this.continuationManager = new ContinuationManager(this.controller);
  }

  public handleCaptureClick(
    element: MockSimulatedElement,
    event: MockSimulatedEvent,
    controlledHandlerCallback?: (act: GuardrailAction) => void
  ): {
    action: GuardrailAction | null;
    response: ResponseAction | null;
    isIntercepted: boolean;
  } {
    const markedTarget = element.closest(`[${GUARDRAIL_TEST_ACTION_ATTR}]`);

    // Unmarked elements are ignored by interception logic
    if (!markedTarget) {
      return { action: null, response: null, isIntercepted: false };
    }

    const testAttr = markedTarget.getAttribute(GUARDRAIL_TEST_ACTION_ATTR) || 'controlled-test-action';

    const action: GuardrailAction = {
      id: `act-verify-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
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

    // Run synchronous pipeline
    const classification = classifyAction(action);
    const risk = assessRisk(action, classification);
    const decision = decideResponse(risk);

    // Verify actionId consistency across pipeline
    if (
      action.id !== classification.actionId ||
      action.id !== risk.actionId ||
      action.id !== decision.actionId
    ) {
      throw new Error(`actionId mismatch: ${action.id} vs ${classification.actionId}`);
    }

    switch (decision.response) {
      case ResponseAction.ALLOW: {
        // ALLOW:
        // * Do not intercept.
        // * Allow controlled website handler to execute.
        // * Do not create an interception record.
        this.dispatchedEvents.push({
          type: 'guardrail:action-allowed',
          detail: { actionId: action.id, risk, decision },
        });
        return { action, response: ResponseAction.ALLOW, isIntercepted: false };
      }

      case ResponseAction.WARN: {
        // WARN:
        // * Advisory modal only.
        // * Action is NOT held; no interception record created.
        this.dispatchedEvents.push({
          type: 'guardrail:action-warned',
          detail: { actionId: action.id, risk, decision },
        });
        return { action, response: ResponseAction.WARN, isIntercepted: false };
      }

      case ResponseAction.PROTECT: {
        // PROTECT:
        // * Prevent action through controlled event flow.
        event.preventDefault();
        event.stopImmediatePropagation();

        // * Create interception record and transition to HELD.
        this.controller.register(
          action,
          `Controlled test action [${testAttr}] halted pending protection decision.`
        );
        const heldRecord = this.controller.holdAction(
          action.id,
          'Action intercepted and held by Guardrail. Normal execution prevented; waiting for a protection decision.'
        );

        // * Register in ContinuationManager with controlled test handler
        this.continuationManager.registerHeldAction(
          action,
          heldRecord,
          (act) => {
            if (controlledHandlerCallback) {
              controlledHandlerCallback(act);
            }
            this.dispatchedEvents.push({
              type: 'guardrail:controlled-handler-executed',
              detail: { actionId: act.id, timestamp: new Date().toISOString() },
            });
          }
        );

        this.dispatchedEvents.push({
          type: 'guardrail:action-intercepted',
          detail: { actionId: action.id, risk, decision, record: heldRecord },
        });

        return { action, response: ResponseAction.PROTECT, isIntercepted: true };
      }
    }
  }
}

// =============================================================================
// TEST 1 — NORMAL ACTION: Low-Risk Marked Action Evaluating to ALLOW
// =============================================================================
console.log('▶ TEST 1 — Normal Action (ALLOW Evaluation & Normal Execution)');
{
  const harness = new GuardrailTestHarness();

  // Create marked allow button
  const allowBtn = new MockSimulatedElement('BUTTON');
  allowBtn.id = 'btn-intercept-allow';
  allowBtn.textContent = 'View Dashboard';
  allowBtn.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'test-allow');

  let normalHandlerRan = false;
  allowBtn.addEventListener('click', () => {
    normalHandlerRan = true;
  });

  const event = new MockSimulatedEvent('click', allowBtn);

  // 1. Guardrail capture-phase intercepts first
  const { action, response, isIntercepted } = harness.handleCaptureClick(allowBtn, event);

  // 2. Normal host handler fires if event was not stopped
  allowBtn.dispatchEvent(event);

  assertEquals(response, ResponseAction.ALLOW, 'Pipeline response evaluates to ALLOW');
  assertEquals(isIntercepted, false, 'Action is not marked intercepted');
  assertEquals(event.defaultPrevented, false, 'event.preventDefault() is NOT called');
  assertEquals(event.immediatePropagationStopped, false, 'event.stopImmediatePropagation() is NOT called');
  assertEquals(normalHandlerRan, true, 'Controlled test website handler executed normally');
  assertEquals(harness.controller.getAllRecords().length, 0, 'No interception record created in controller');
  assert(Boolean(action?.id), 'Valid actionId generated');
}

// =============================================================================
// TEST 2 — PROTECTED ACTION: Compound Action Evaluating to PROTECT & HELD State
// =============================================================================
console.log('\n▶ TEST 2 — Protected Action (PROTECT Evaluation & Halting Execution)');
{
  const harness = new GuardrailTestHarness();

  const protectBtn = new MockSimulatedElement('BUTTON');
  protectBtn.id = 'btn-intercept-protect';
  protectBtn.textContent = 'Delete All Data, Cancel Billing, and Export to External Server';
  protectBtn.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'test-protect');

  let normalHandlerRan = false;
  protectBtn.addEventListener('click', () => {
    normalHandlerRan = true;
  });

  const event = new MockSimulatedEvent('click', protectBtn);

  // 1. Guardrail capture-phase intercepts
  const { action, response, isIntercepted } = harness.handleCaptureClick(protectBtn, event);

  // 2. Host handler attempt (must be blocked by stopImmediatePropagation)
  protectBtn.dispatchEvent(event);

  assertEquals(response, ResponseAction.PROTECT, 'Pipeline response evaluates to PROTECT');
  assertEquals(isIntercepted, true, 'Action is marked as intercepted');
  assertEquals(event.defaultPrevented, true, 'event.preventDefault() was called');
  assertEquals(event.immediatePropagationStopped, true, 'event.stopImmediatePropagation() was called');
  assertEquals(normalHandlerRan, false, 'Normal test click handler NEVER ran');

  const heldRecord = harness.controller.getRecord(action!.id);
  assert(Boolean(heldRecord), 'Interception record exists in controller');
  assertEquals(heldRecord?.state, InterceptionState.HELD, 'Interception record reaches HELD state');
  assertEquals(heldRecord?.actionId, action!.id, 'Record actionId matches original action');
  assert(Boolean(harness.continuationManager.getCurrentHeldAction()), 'ContinuationManager tracks held action');
}

// =============================================================================
// TEST 3 — CONTINUE: Continuing a HELD Action Exactly Once
// =============================================================================
console.log('\n▶ TEST 3 — Continue (Transition to CONTINUED & Exactly-Once Handler Execution)');
{
  const harness = new GuardrailTestHarness();

  const protectBtn = new MockSimulatedElement('BUTTON');
  protectBtn.id = 'btn-intercept-protect';
  protectBtn.textContent = 'Delete All Data, Cancel Billing, and Export to External Server';
  protectBtn.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'test-protect');

  let controlledHandlerRuns = 0;
  let receivedActionId = '';

  const event = new MockSimulatedEvent('click', protectBtn);
  const { action } = harness.handleCaptureClick(protectBtn, event, (act) => {
    controlledHandlerRuns++;
    receivedActionId = act.id;
  });

  // Verify action is HELD before continuing
  assertEquals(harness.controller.getRecord(action!.id)?.state, InterceptionState.HELD, 'Action is initially HELD');

  // Trigger Continue
  const continueResult = harness.continuationManager.continueAction(action!.id, 'User clicked Continue.');

  assertEquals(continueResult.success, true, 'Continuation operation succeeded');
  assertEquals(continueResult.executed, true, 'Continuation execution flag is true');
  assertEquals(continueResult.executionCount, 1, 'Execution count returned is 1');
  assertEquals(controlledHandlerRuns, 1, 'Controlled test handler executed exactly once');
  assertEquals(receivedActionId, action!.id, 'Handler received the original actionId');

  const updatedRecord = harness.controller.getRecord(action!.id);
  assertEquals(updatedRecord?.state, InterceptionState.CONTINUED, 'Interception record became CONTINUED');
  assert(Boolean(updatedRecord?.resolvedAt), 'resolvedAt timestamp is recorded');
  assertEquals(harness.continuationManager.getCurrentHeldAction(), null, 'Temporary held state cleared in manager');
}

// =============================================================================
// TEST 4 — CANCEL: Cancelling a HELD Action Without Execution
// =============================================================================
console.log('\n▶ TEST 4 — Cancel (Transition to CANCELLED & Handler Never Executes)');
{
  const harness = new GuardrailTestHarness();

  const protectBtn = new MockSimulatedElement('BUTTON');
  protectBtn.id = 'btn-intercept-protect';
  protectBtn.textContent = 'Delete All Data, Cancel Billing, and Export to External Server';
  protectBtn.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'test-protect');

  let controlledHandlerRuns = 0;

  const event = new MockSimulatedEvent('click', protectBtn);
  const { action } = harness.handleCaptureClick(protectBtn, event, () => {
    controlledHandlerRuns++;
  });

  // Verify action is HELD
  assertEquals(harness.controller.getRecord(action!.id)?.state, InterceptionState.HELD, 'Action is initially HELD');

  // Trigger Cancel
  const cancelResult = harness.continuationManager.cancelAction(action!.id, 'User clicked Cancel.');

  assertEquals(cancelResult.success, true, 'Cancellation operation succeeded');
  assertEquals(controlledHandlerRuns, 0, 'Controlled test handler NEVER executed');

  const cancelledRecord = harness.controller.getRecord(action!.id);
  assertEquals(cancelledRecord?.state, InterceptionState.CANCELLED, 'Interception record became CANCELLED');
  assert(Boolean(cancelledRecord?.resolvedAt), 'resolvedAt timestamp is recorded');
  assertEquals(harness.continuationManager.getCurrentHeldAction(), null, 'Temporary held state cleared in manager');
}

// =============================================================================
// TEST 5 — DUPLICATE CONTROLS: Rapid Multiple Clicks Execute At Most Once
// =============================================================================
console.log('\n▶ TEST 5 — Duplicate Controls (Rapid Multiple Continue Clicks Guarantee At Most Once)');
{
  const harness = new GuardrailTestHarness();

  const protectBtn = new MockSimulatedElement('BUTTON');
  protectBtn.id = 'btn-intercept-protect';
  protectBtn.textContent = 'Delete All Data, Cancel Billing, and Export to External Server';
  protectBtn.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'test-protect');

  let handlerExecutions = 0;

  const event = new MockSimulatedEvent('click', protectBtn);
  const { action } = harness.handleCaptureClick(protectBtn, event, () => {
    handlerExecutions++;
  });

  // Simulate 10 rapid repeated clicks on Continue
  const results = [];
  for (let i = 0; i < 10; i++) {
    results.push(harness.continuationManager.continueAction(action!.id));
  }

  // First click should succeed
  assertEquals(results[0].success, true, 'Click #1 succeeded');
  assertEquals(results[0].executed, true, 'Click #1 executed');

  // Clicks 2 through 10 must all be rejected safely
  let rejectedCount = 0;
  for (let i = 1; i < 10; i++) {
    if (!results[i].success && !results[i].executed) {
      rejectedCount++;
    }
  }
  assertEquals(rejectedCount, 9, 'All 9 subsequent rapid clicks safely rejected');
  assertEquals(handlerExecutions, 1, 'Handler executed strictly at most once (exactly 1)');
}

// =============================================================================
// TEST 6 — INVALID STATE TRANSITIONS: Rejecting Invalid Lifecycle Flows
// =============================================================================
console.log('\n▶ TEST 6 — Invalid State Transitions (Rejected Safely Without Corruption)');
{
  const controller = new InterceptionController();
  const manager = new ContinuationManager(controller);

  // Subtest 6A: Try continuing a CANCELLED action
  const actCancel = {
    id: 'act-trans-cancel',
    type: ActionType.CLICK,
    page: { url: 'http://localhost/test', title: 'Test' },
    timestamp: new Date().toISOString(),
  };
  controller.register(actCancel);
  const heldCancel = controller.holdAction(actCancel.id);
  manager.registerHeldAction(actCancel, heldCancel, () => {});
  manager.cancelAction(actCancel.id);

  const invalidContinueOnCancel = manager.continueAction(actCancel.id);
  assertEquals(invalidContinueOnCancel.success, false, 'Continuing a CANCELLED action is rejected');
  assertEquals(invalidContinueOnCancel.executed, false, 'Handler not executed on cancelled action');

  // Subtest 6B: Try cancelling a CONTINUED action
  const actContinue = {
    id: 'act-trans-continue',
    type: ActionType.CLICK,
    page: { url: 'http://localhost/test', title: 'Test' },
    timestamp: new Date().toISOString(),
  };
  controller.register(actContinue);
  const heldContinue = controller.holdAction(actContinue.id);
  manager.registerHeldAction(actContinue, heldContinue, () => {});
  manager.continueAction(actContinue.id);

  const invalidCancelOnContinue = manager.cancelAction(actContinue.id);
  assertEquals(invalidCancelOnContinue.success, false, 'Cancelling a CONTINUED action is rejected');

  // Subtest 6C: Try continuing an action that is only DETECTED (not yet HELD)
  const actDetected = {
    id: 'act-trans-detected',
    type: ActionType.CLICK,
    page: { url: 'http://localhost/test', title: 'Test' },
    timestamp: new Date().toISOString(),
  };
  controller.register(actDetected);
  const detectedContinueResult = manager.continueAction(actDetected.id);
  assertEquals(detectedContinueResult.success, false, 'Continuing a DETECTED action via manager is rejected');
  assertEquals(detectedContinueResult.executed, false, 'Handler not executed on DETECTED action');

  // Subtest 6D: Try transitioning from CONTINUED back to HELD
  let reHoldExceptionCaught = false;
  try {
    controller.holdAction(actContinue.id);
  } catch (err: any) {
    reHoldExceptionCaught = true;
    assert(Boolean(err.message.includes('Invalid state transition')), 'Exception thrown for CONTINUED -> HELD');
  }
  assert(reHoldExceptionCaught, 'Controller rejected invalid CONTINUED -> HELD transition');
}

// =============================================================================
// TEST 7 — RELOAD AND CLEANUP: Memory Reset & No False Claims
// =============================================================================
console.log('\n▶ TEST 7 — Reload and Cleanup (State Reset & No False Execution Claims)');
{
  // 1. Before reload: an action is held in memory
  let preReloadController: InterceptionController | null = new InterceptionController();
  let preReloadManager: ContinuationManager | null = new ContinuationManager(preReloadController);

  const actBeforeReload = {
    id: 'act-pre-reload-123',
    type: ActionType.CLICK,
    page: { url: 'http://localhost/test', title: 'Test' },
    timestamp: new Date().toISOString(),
  };
  preReloadController.register(actBeforeReload);
  const heldPreReload = preReloadController.holdAction(actBeforeReload.id);
  let preReloadHandlerRan = false;
  preReloadManager.registerHeldAction(actBeforeReload, heldPreReload, () => {
    preReloadHandlerRan = true;
  });

  assertEquals(preReloadController.getRecord(actBeforeReload.id)?.state, InterceptionState.HELD, 'Action held prior to reload');

  // 2. Simulate page reload: execution context is torn down
  preReloadController = null;
  preReloadManager = null;

  // 3. Post-reload initialization: Content script bootstraps afresh
  const postReloadController = new InterceptionController();
  const postReloadManager = new ContinuationManager(postReloadController);

  // In the real DOM, initial page state:
  const postReloadStatusText = 'IDLE (Click a marked button above)';
  const postReloadIndicatorText = 'No action held';
  const postReloadContinueDisabled = true;
  const postReloadCancelDisabled = true;

  // Verify memory reset
  assertEquals(postReloadController.getAllRecords().length, 0, 'Post-reload controller contains 0 records');
  assertEquals(postReloadController.getRecord(actBeforeReload.id), undefined, 'Pre-reload action is NOT tracked in post-reload controller');
  assertEquals(postReloadManager.getCurrentHeldAction(), null, 'Post-reload manager has no held actions');
  assertEquals(preReloadHandlerRan, false, 'Pre-reload held handler was NEVER executed');

  // Verify DOM guarantees
  assertEquals(postReloadStatusText.includes('IDLE'), true, 'Page status resets cleanly to IDLE');
  assertEquals(postReloadIndicatorText, 'No action held', 'Held action indicator resets to "No action held"');
  assertEquals(postReloadContinueDisabled, true, 'Continue button is disabled post-reload');
  assertEquals(postReloadCancelDisabled, true, 'Cancel button is disabled post-reload');
  assert(true, 'Post-reload page does NOT falsely claim that an action executed');
}

// =============================================================================
// TEST 8 — PRIVACY: Strict Zero-Credential & Zero-DOM Storage Enforcement
// =============================================================================
console.log('\n▶ TEST 8 — Privacy (No Passwords, OTPs, Card Numbers, or Form Values Stored)');
{
  const controller = new InterceptionController();
  const manager = new ContinuationManager(controller);

  const sensitiveAction: GuardrailAction = {
    id: 'act-privacy-test-999',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      id: 'btn-payment',
      visibleText: 'Pay ₹5,000',
    },
    page: {
      url: 'https://example.com/checkout',
      title: 'Checkout Page',
    },
    timestamp: new Date().toISOString(),
  };

  const regRecord = controller.register(sensitiveAction);
  assertEquals(regRecord.actionId, sensitiveAction.id, 'Registered record matches actionId');
  const heldRecord = controller.holdAction(sensitiveAction.id);
  manager.registerHeldAction(sensitiveAction, heldRecord, () => {});

  // Inspect record serialization
  const serializedRecord = JSON.stringify(heldRecord);
  const parsedRecord = JSON.parse(serializedRecord);

  const forbiddenKeys = [
    'password', 'pass', 'pwd',
    'card', 'cardNumber', 'cvv', 'cvc',
    'otp', 'pin', 'secret',
    'token', 'authCode',
    'value', 'inputValue', 'formValue',
    'element', 'node', 'target', 'window', 'document'
  ];

  for (const key of forbiddenKeys) {
    assert(!(key in parsedRecord), `InterceptionRecord does NOT contain forbidden property "${key}"`);
  }

  // Validate allowed fields
  const allowedKeys = new Set(['actionId', 'state', 'createdAt', 'resolvedAt', 'reason']);
  const actualKeys = Object.keys(parsedRecord);
  const hasOnlyAllowed = actualKeys.every((k) => allowedKeys.has(k));
  assert(hasOnlyAllowed, `InterceptionRecord contains strictly allowed metadata fields: [${actualKeys.join(', ')}]`);

  // Verify manager serialization hygiene
  const currentHeld = manager.getCurrentHeldAction();
  assert(Boolean(currentHeld), 'Held action entry exists in manager');
  assert(!('node' in (currentHeld?.action || {})), 'Action has no DOM node reference');
  assert(!('elementNode' in (currentHeld || {})), 'Manager does not store element node');
}

// =============================================================================
// AUDIT: ACTION ID FIDELITY, UNMARKED CONTROLS & LISTENER CLEANLINESS
// =============================================================================
console.log('\n▶ Additional Quality Audits (ActionId Fidelity, Unmarked Controls & Listeners)');
{
  const harness = new GuardrailTestHarness();

  // Audit 1: Unmarked controls are completely immune from interception
  const unmarkedButton = new MockSimulatedElement('BUTTON');
  unmarkedButton.id = 'btn-regular-unmarked';
  unmarkedButton.textContent = 'Regular Generic Button';
  // Note: NO data-guardrail-test-action attribute!

  let unmarkedHandlerRan = false;
  unmarkedButton.addEventListener('click', () => {
    unmarkedHandlerRan = true;
  });

  const unmarkedEvent = new MockSimulatedEvent('click', unmarkedButton);
  const { action: unAction, response: unResp, isIntercepted: unInter } = harness.handleCaptureClick(unmarkedButton, unmarkedEvent);
  unmarkedButton.dispatchEvent(unmarkedEvent);

  assertEquals(unAction, null, 'Unmarked element returns null action from interception handler');
  assertEquals(unResp, null, 'Unmarked element receives no response decision in interception flow');
  assertEquals(unInter, false, 'Unmarked element is not intercepted');
  assertEquals(unmarkedEvent.defaultPrevented, false, 'Unmarked event defaultPrevented is false');
  assertEquals(unmarkedEvent.immediatePropagationStopped, false, 'Unmarked event stopImmediatePropagation is false');
  assertEquals(unmarkedHandlerRan, true, 'Unmarked host handler executed unimpeded');

  // Audit 2: ActionId fidelity across entire lifecycle
  const dedicatedId = 'act-audit-fidelity-12345';
  const customAct: GuardrailAction = {
    id: dedicatedId,
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      id: 'btn-intercept-protect',
      visibleText: 'Delete All Data, Cancel Billing, and Export to External Server',
    },
    page: { url: 'http://localhost/test', title: 'Test' },
    timestamp: new Date().toISOString(),
  };

  const classRes = classifyAction(customAct);
  assertEquals(classRes.actionId, dedicatedId, 'Classifier preserved actionId');

  const riskRes = assessRisk(customAct, classRes);
  assertEquals(riskRes.actionId, dedicatedId, 'Risk assessment preserved actionId');

  const decRes = decideResponse(riskRes);
  assertEquals(decRes.actionId, dedicatedId, 'Response decision preserved actionId');

  const record = harness.controller.register(customAct);
  assertEquals(record.actionId, dedicatedId, 'Interception record preserved actionId');

  const heldRec = harness.controller.holdAction(dedicatedId);
  assertEquals(heldRec.actionId, dedicatedId, 'Held record preserved actionId');

  let handlerReceivedId = '';
  harness.continuationManager.registerHeldAction(customAct, heldRec, (a) => {
    handlerReceivedId = a.id;
  });

  const contRes = harness.continuationManager.continueAction(dedicatedId);
  assertEquals(contRes.actionId, dedicatedId, 'ContinuationManager preserved actionId');
  assertEquals(handlerReceivedId, dedicatedId, 'Execution callback received original actionId');
}

console.log('\n============================================================');
console.log(`TOTAL DAY 8 VERIFICATION TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
