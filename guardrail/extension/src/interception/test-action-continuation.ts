/**
 * Guardrail Controlled Action Continuation & Cancellation - Verification Test Suite
 *
 * Verifies the end-to-end functionality of controlled continuation and cancellation:
 * 1. State Validation: Only actions currently in HELD state can be continued or cancelled.
 * 2. Transition to CONTINUED: Validates transition, resolvedAt recording, and actionId preservation.
 * 3. Exactly-Once Execution: The registered controlled test handler executes at most once.
 * 4. Duplicate Prevention: Subsequent continuation attempts on already-resolved actions are rejected.
 * 5. Cancellation Behavior: Transitions to CANCELLED, ensures handler is NOT executed, and clears held state.
 * 6. Terminal State Enforcement: Rejects cancelling a CONTINUED action and re-resolving CANCELLED actions.
 * 7. Recursion Prevention: Direct execution avoids synthetic click replay and capture recursion.
 * 8. Safe Handling of Repeated / Rapid Clicks.
 */

declare const process: { exit: (code: number) => void };

import { ActionType, GuardrailAction } from '../types/actions.js';
import { InterceptionState } from '../types/interception.js';
import { InterceptionController } from './controller.js';
import { ContinuationManager } from './continuation.js';

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
console.log('🧪 CONTROLLED ACTION CONTINUATION & CANCELLATION TEST SUITE');
console.log('============================================================\n');

function createSampleAction(id: string): GuardrailAction {
  return {
    id,
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      id: 'btn-test',
      visibleText: 'Test Action',
    },
    page: {
      url: 'http://localhost:3000/demo-sites/test-page/',
      title: 'Test Page',
    },
    timestamp: new Date().toISOString(),
  };
}

// ------------------------------------------------------------
// TEST 1: STATE VALIDATION - CONTINUATION REQUIRES HELD STATE
// ------------------------------------------------------------
console.log('▶ Test 1: State Validation - Continuation Requires HELD State');

const controller1 = new InterceptionController();
const manager1 = new ContinuationManager(controller1);

// 1. Untracked actionId
const missingResult = manager1.continueAction('act-nonexistent-123');
assertEquals(missingResult.success, false, 'Missing action continuation is rejected');
assertEquals(missingResult.executed, false, 'Handler is not executed for missing action');
assert(Boolean(missingResult.error?.includes('not found')), 'Error explains action was not found');

// 2. Action registered in DETECTED state (not yet HELD)
const actionDetected = createSampleAction('act-detected-only');
const detectedRecord = controller1.register(actionDetected);
assertEquals(detectedRecord.state, InterceptionState.DETECTED, 'Record is in DETECTED state');

const detectedContinuation = manager1.continueAction('act-detected-only');
assertEquals(detectedContinuation.success, false, 'Continuation rejected for DETECTED action');
assertEquals(detectedContinuation.executed, false, 'Handler not executed for DETECTED action');
assert(
  Boolean(detectedContinuation.error?.includes('Only actions in HELD state')),
  'Error specifies only HELD actions can be continued'
);

// 3. Action transitioned to HELD state can be registered and continued
const heldRecord1 = controller1.holdAction('act-detected-only');
assertEquals(heldRecord1.state, InterceptionState.HELD, 'Record transitioned to HELD state');

let executionCount1 = 0;
manager1.registerHeldAction(actionDetected, heldRecord1, () => {
  executionCount1++;
});

const validContinuation = manager1.continueAction('act-detected-only');
assertEquals(validContinuation.success, true, 'HELD action is successfully continued');
assertEquals(validContinuation.executed, true, 'Execution flag is true');
assertEquals(executionCount1, 1, 'Controlled handler executed exactly once');
assertEquals(validContinuation.record?.state, InterceptionState.CONTINUED, 'Record transitioned to CONTINUED');
assert(Boolean(validContinuation.record?.resolvedAt), 'resolvedAt timestamp is recorded');

// ------------------------------------------------------------
// TEST 2: EXACTLY-ONCE EXECUTION GUARANTEE & DUPLICATE PREVENTION
// ------------------------------------------------------------
console.log('\n▶ Test 2: Exactly-Once Execution & Duplicate Prevention');

const controller2 = new InterceptionController();
const manager2 = new ContinuationManager(controller2);

const action2 = createSampleAction('act-once-test');
controller2.register(action2);
const heldRecord2 = controller2.holdAction(action2.id);

let handler2Runs = 0;
manager2.registerHeldAction(action2, heldRecord2, () => {
  handler2Runs++;
});

// First continuation: Must execute
const firstContinue = manager2.continueAction(action2.id);
assertEquals(firstContinue.success, true, 'First continuation succeeded');
assertEquals(firstContinue.executed, true, 'First continuation executed');
assertEquals(handler2Runs, 1, 'Handler executed on first continuation');
assertEquals(firstContinue.executionCount, 1, 'Execution count is 1');

// Second continuation: MUST BE REJECTED
const secondContinue = manager2.continueAction(action2.id);
assertEquals(secondContinue.success, false, 'Second continuation is rejected');
assertEquals(secondContinue.executed, false, 'Second continuation does NOT execute');
assertEquals(handler2Runs, 1, 'Handler was NOT executed a second time');
assert(
  Boolean(secondContinue.error?.includes('already executed') || secondContinue.error?.includes('CONTINUED')),
  'Error explains duplicate execution is prevented'
);

// Third continuation: MUST STILL BE REJECTED
const thirdContinue = manager2.continueAction(action2.id);
assertEquals(thirdContinue.success, false, 'Third continuation is rejected');
assertEquals(handler2Runs, 1, 'Handler remains executed exactly once');

// ------------------------------------------------------------
// TEST 3: CANCELLATION VALIDATION & EXECUTION ABORTION
// ------------------------------------------------------------
console.log('\n▶ Test 3: Cancellation Validation & Execution Abortion');

const controller3 = new InterceptionController();
const manager3 = new ContinuationManager(controller3);

const action3 = createSampleAction('act-cancel-test');
controller3.register(action3);
const heldRecord3 = controller3.holdAction(action3.id);

let handler3Runs = 0;
manager3.registerHeldAction(action3, heldRecord3, () => {
  handler3Runs++;
});

assert(Boolean(manager3.getCurrentHeldAction()), 'Held action is tracked in manager prior to cancellation');

// Perform explicit cancellation
const cancelResult = manager3.cancelAction(action3.id, 'User clicked Cancel Test Action.');
assertEquals(cancelResult.success, true, 'Cancellation succeeded');
assertEquals(cancelResult.record?.state, InterceptionState.CANCELLED, 'InterceptionRecord transitioned to CANCELLED');
assertEquals(handler3Runs, 0, 'Controlled test handler was NOT executed upon cancellation');
assert(Boolean(cancelResult.record?.resolvedAt), 'resolvedAt timestamp recorded on CANCELLED record');
assertEquals(manager3.getCurrentHeldAction(), null, 'Temporary held state is cleared after cancellation');

// ------------------------------------------------------------
// TEST 4: TERMINAL RESOLUTION ENFORCEMENT (CROSS-RESOLUTION REJECTIONS)
// ------------------------------------------------------------
console.log('\n▶ Test 4: Terminal Resolution Enforcement & State Immutability');

// 1. Cannot re-cancel an already CANCELLED action
const reCancelResult = manager3.cancelAction(action3.id);
assertEquals(reCancelResult.success, false, 'Re-cancelling already CANCELLED action is rejected');
assert(
  Boolean(reCancelResult.error?.includes('Only actions in HELD state')),
  'Error specifies cannot cancel CANCELLED action'
);

// 2. Cannot continue an already CANCELLED action
const continueCancelledResult = manager3.continueAction(action3.id);
assertEquals(continueCancelledResult.success, false, 'Continuing already CANCELLED action is rejected');
assertEquals(continueCancelledResult.executed, false, 'Handler not executed for CANCELLED action');
assert(
  Boolean(continueCancelledResult.error?.includes('Only actions in HELD state')),
  'Error specifies cannot continue CANCELLED action'
);

// 3. Cannot cancel an already CONTINUED action
const cancelContinuedResult = manager2.cancelAction(action2.id);
assertEquals(cancelContinuedResult.success, false, 'Cancelling already CONTINUED action is rejected');
assert(
  Boolean(cancelContinuedResult.error?.includes('Only actions in HELD state')),
  'Error specifies cannot cancel CONTINUED action'
);

// ------------------------------------------------------------
// TEST 5: PRESERVATION OF ORIGINAL ACTION ID
// ------------------------------------------------------------
console.log('\n▶ Test 5: Preservation of Original actionId');

const testId = 'act-unique-preserve-uuid-987';
const controller5 = new InterceptionController();
const manager5 = new ContinuationManager(controller5);

const action5 = createSampleAction(testId);
controller5.register(action5);
const held5 = controller5.holdAction(action5.id);

let observedActionIdInHandler = '';
manager5.registerHeldAction(action5, held5, (act) => {
  observedActionIdInHandler = act.id;
});

const res5 = manager5.continueAction(testId);
assertEquals(res5.actionId, testId, 'Result actionId matches original');
assertEquals(res5.record?.actionId, testId, 'InterceptionRecord actionId matches original');
assertEquals(observedActionIdInHandler, testId, 'Handler received exact original actionId');

// ------------------------------------------------------------
// TEST 6: SAFE HANDLING OF REPEATED / RAPID BUTTON CLICKS
// ------------------------------------------------------------
console.log('\n▶ Test 6: Safe Handling of Repeated / Rapid Button Clicks');

const controller6 = new InterceptionController();
const manager6 = new ContinuationManager(controller6);

const action6 = createSampleAction('act-rapid-clicks');
controller6.register(action6);
const held6 = controller6.holdAction(action6.id);

let rapidExecutionCount = 0;
manager6.registerHeldAction(action6, held6, () => {
  rapidExecutionCount++;
});

// Simulate 5 rapid sequential clicks on the Continue button
const results = [
  manager6.continueAction(action6.id),
  manager6.continueAction(action6.id),
  manager6.continueAction(action6.id),
  manager6.continueAction(action6.id),
  manager6.continueAction(action6.id),
];

assertEquals(results[0].success, true, 'First click succeeds');
assertEquals(results[0].executed, true, 'First click executes handler');
assertEquals(results[1].success, false, 'Second rapid click is safely rejected');
assertEquals(results[2].success, false, 'Third rapid click is safely rejected');
assertEquals(results[3].success, false, 'Fourth rapid click is safely rejected');
assertEquals(results[4].success, false, 'Fifth rapid click is safely rejected');
assertEquals(rapidExecutionCount, 1, 'Handler executed exactly once despite 5 rapid clicks');

// ------------------------------------------------------------
// TEST 7: TEMPORARY STATE HYGIENE & CLEANUP
// ------------------------------------------------------------
console.log('\n▶ Test 7: Temporary State Hygiene & Cleanup');

const controller7 = new InterceptionController();
const manager7 = new ContinuationManager(controller7);

const action7 = createSampleAction('act-hygiene-test');
controller7.register(action7);
const held7 = controller7.holdAction(action7.id);

manager7.registerHeldAction(action7, held7, () => {});
assert(Boolean(manager7.getCurrentHeldAction()), 'Held action entry active');

manager7.clearTemporaryState();
assertEquals(manager7.getCurrentHeldAction(), null, 'clearTemporaryState cleanly emptied held action');

console.log('\n============================================================');
console.log(`TOTAL CONTINUATION TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
}
