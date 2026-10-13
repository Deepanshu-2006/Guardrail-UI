/**
 * Guardrail Interception Controller - Focused Verification Test Suite
 *
 * Validates the in-memory lifecycle controller:
 * 1. Registering intercepted actions (both with ID and GuardrailAction).
 * 2. Retrieving records by actionId.
 * 3. Transitioning DETECTED -> HELD.
 * 4. Transitioning HELD -> CONTINUED.
 * 5. Transitioning HELD -> CANCELLED.
 * 6. Recording resolution timestamps.
 * 7. Rejecting invalid or repeated state transitions.
 * 8. Removing records explicitly and cleaning up resolved records.
 * 9. Enforcing strict data privacy and zero DOM coupling.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionType, GuardrailAction } from '../types/actions.js';
import { InterceptionState } from '../types/interception.js';
import {
  ActionAlreadyRegisteredError,
  ActionNotFoundError,
  InterceptionController,
} from './controller.js';
import { InvalidStateTransitionError } from './transitions.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAILED: ${message}`);
    process.exitCode = 1;
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalTests++;
  if (actual === expected) {
    passedTests++;
    console.log(`  ✓ ${message}: ${String(actual)}`);
  } else {
    console.error(`  ✗ FAILED: ${message}. Expected "${String(expected)}", received "${String(actual)}"`);
    process.exitCode = 1;
  }
}

console.log('\n============================================================');
console.log('🧪 INTERCEPTION CONTROLLER - VERIFICATION TEST SUITE');
console.log('============================================================\n');

const controller = new InterceptionController();

// ------------------------------------------------------------
// TEST 1: REGISTERING ACTIONS (STRING ID & GUARDRAILACTION)
// ------------------------------------------------------------
console.log('▶ Test 1: Registering Actions');
const actionId1 = 'act-ctrl-test-001';
const reg1 = controller.register(actionId1, 'Action 1 captured at document capture boundary.');

assertEquals(reg1.actionId, actionId1, 'Registered with actionId string');
assertEquals(reg1.state, InterceptionState.DETECTED, 'Registered in DETECTED state');
assertEquals(reg1.resolvedAt, undefined, 'resolvedAt is undefined at registration');
assertEquals(controller.size(), 1, 'Controller tracks 1 record');

// Register with a complete normalized GuardrailAction
const mockAction: GuardrailAction = {
  id: 'act-ctrl-test-002',
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

const reg2 = controller.register(mockAction, 'Mock payment button click captured.');
assertEquals(reg2.actionId, 'act-ctrl-test-002', 'Registered from GuardrailAction object');
assertEquals(reg2.state, InterceptionState.DETECTED, 'GuardrailAction registered in DETECTED state');
assertEquals(controller.size(), 2, 'Controller tracks 2 records');

// Reject duplicate registration of the same actionId
let caughtDuplicateError = false;
try {
  controller.register(actionId1, 'Attempting duplicate registration');
} catch (err) {
  caughtDuplicateError = true;
  assert(err instanceof ActionAlreadyRegisteredError, 'Throws ActionAlreadyRegisteredError on duplicate registration');
  if (err instanceof ActionAlreadyRegisteredError) {
    assertEquals(err.actionId, actionId1, 'Error specifies the duplicate actionId');
  }
}
assert(caughtDuplicateError, 'Duplicate registration was rejected');

// ------------------------------------------------------------
// TEST 2: RETRIEVING INTERCEPTION RECORDS
// ------------------------------------------------------------
console.log('\n▶ Test 2: Retrieving Records by actionId');
assert(controller.hasRecord(actionId1), 'hasRecord returns true for tracked actionId');
assert(controller.hasRecord('act-ctrl-test-002'), 'hasRecord returns true for second actionId');
assert(!controller.hasRecord('act-non-existent'), 'hasRecord returns false for unknown actionId');

const retrieved = controller.getRecord(actionId1);
assert(Boolean(retrieved), 'getRecord returns record');
assertEquals(retrieved?.actionId, actionId1, 'Retrieved record matches actionId');
assertEquals(retrieved?.state, InterceptionState.DETECTED, 'Retrieved record is in DETECTED state');

const nonExistent = controller.getRecord('act-unknown-999');
assertEquals(nonExistent, undefined, 'getRecord returns undefined for unknown actionId');

// ------------------------------------------------------------
// TEST 3: TRANSITIONING DETECTED -> HELD
// ------------------------------------------------------------
console.log('\n▶ Test 3: Transitioning DETECTED -> HELD');
const held = controller.holdAction(actionId1, 'Action evaluated as HIGH risk. Paused for Warning Modal confirmation.');

assertEquals(held.actionId, actionId1, 'actionId preserved through holdAction');
assertEquals(held.state, InterceptionState.HELD, 'State transitioned to HELD');
assertEquals(held.resolvedAt, undefined, 'resolvedAt is still undefined in HELD state');
assert(held.reason.includes('Paused for Warning Modal'), 'Reason updated on heldAction');

// Verify stored in-memory record reflects HELD state
const storedHeld = controller.getRecord(actionId1);
assertEquals(storedHeld?.state, InterceptionState.HELD, 'In-memory map holds updated HELD record');

// ------------------------------------------------------------
// TEST 4: TRANSITIONING HELD -> CONTINUED (TERMINAL RESOLUTION)
// ------------------------------------------------------------
console.log('\n▶ Test 4: Transitioning HELD -> CONTINUED');
const continued = controller.continueAction(actionId1, 'User clicked Continue in Warning Modal.');

assertEquals(continued.actionId, actionId1, 'actionId preserved through continueAction');
assertEquals(continued.state, InterceptionState.CONTINUED, 'State transitioned to CONTINUED');
assert(Boolean(continued.resolvedAt && !isNaN(Date.parse(continued.resolvedAt))), 'resolvedAt timestamp recorded on CONTINUED');
assert(continued.reason.includes('User clicked Continue'), 'Reason updated on continueAction');

// Verify stored in-memory record reflects CONTINUED state
const storedContinued = controller.getRecord(actionId1);
assertEquals(storedContinued?.state, InterceptionState.CONTINUED, 'In-memory record is CONTINUED');
assertEquals(storedContinued?.resolvedAt, continued.resolvedAt, 'Stored record has resolvedAt timestamp');

// ------------------------------------------------------------
// TEST 5: TRANSITIONING HELD -> CANCELLED (TERMINAL RESOLUTION)
// ------------------------------------------------------------
console.log('\n▶ Test 5: Transitioning HELD -> CANCELLED');
const actionId3 = 'act-ctrl-test-003';
controller.register(actionId3, 'Action 3 registered.');
controller.holdAction(actionId3, 'Action 3 paused for confirmation.');

const cancelled = controller.cancelAction(actionId3, 'User clicked Cancel in Warning Modal.');
assertEquals(cancelled.actionId, actionId3, 'actionId preserved through cancelAction');
assertEquals(cancelled.state, InterceptionState.CANCELLED, 'State transitioned to CANCELLED');
assert(Boolean(cancelled.resolvedAt && !isNaN(Date.parse(cancelled.resolvedAt))), 'resolvedAt timestamp recorded on CANCELLED');
assert(cancelled.reason.includes('User clicked Cancel'), 'Reason updated on cancelAction');

// Verify stored in-memory record reflects CANCELLED state
const storedCancelled = controller.getRecord(actionId3);
assertEquals(storedCancelled?.state, InterceptionState.CANCELLED, 'In-memory record is CANCELLED');

// ------------------------------------------------------------
// TEST 6: REJECTING INVALID OR REPEATED TRANSITIONS
// ------------------------------------------------------------
console.log('\n▶ Test 6: Rejecting Invalid and Repeated State Transitions');

// 6a: Attempting to continue an already CONTINUED action
let caughtRepeatContinueError = false;
try {
  controller.continueAction(actionId1, 'Attempting to re-continue an already CONTINUED action');
} catch (err) {
  caughtRepeatContinueError = true;
  assert(err instanceof InvalidStateTransitionError, 'Throws InvalidStateTransitionError when re-continuing CONTINUED action');
}
assert(caughtRepeatContinueError, 'Prevented repeated continuation of CONTINUED action');

// 6b: Attempting to cancel an already CONTINUED action
let caughtCancelAfterContinueError = false;
try {
  controller.cancelAction(actionId1, 'Attempting to cancel an already CONTINUED action');
} catch (err) {
  caughtCancelAfterContinueError = true;
  assert(err instanceof InvalidStateTransitionError, 'Throws InvalidStateTransitionError when cancelling CONTINUED action');
}
assert(caughtCancelAfterContinueError, 'Prevented cancelling an already CONTINUED action');

// 6c: Attempting to continue an already CANCELLED action
let caughtContinueAfterCancelError = false;
try {
  controller.continueAction(actionId3, 'Attempting to resurrect a CANCELLED action');
} catch (err) {
  caughtContinueAfterCancelError = true;
  assert(err instanceof InvalidStateTransitionError, 'Throws InvalidStateTransitionError when continuing CANCELLED action');
}
assert(caughtContinueAfterCancelError, 'Prevented continuing an already CANCELLED action');

// 6d: Attempting to hold an already CANCELLED action
let caughtHoldAfterCancelError = false;
try {
  controller.holdAction(actionId3, 'Attempting to hold a CANCELLED action');
} catch (err) {
  caughtHoldAfterCancelError = true;
  assert(err instanceof InvalidStateTransitionError, 'Throws InvalidStateTransitionError when holding CANCELLED action');
}
assert(caughtHoldAfterCancelError, 'Prevented holding an already CANCELLED action');

// 6e: Attempting to hold an already HELD action (repeated hold)
const actionId4 = 'act-ctrl-test-004';
controller.register(actionId4, 'Action 4 registered.');
controller.holdAction(actionId4, 'Action 4 held.');

let caughtRepeatedHoldError = false;
try {
  controller.holdAction(actionId4, 'Attempting repeated holdAction on already HELD action');
} catch (err) {
  caughtRepeatedHoldError = true;
  assert(err instanceof InvalidStateTransitionError, 'Throws InvalidStateTransitionError on repeated holdAction');
}
assert(caughtRepeatedHoldError, 'Prevented repeated hold on already HELD action');

// 6f: Operating on non-existent actionId throws ActionNotFoundError
let caughtNotFoundError = false;
try {
  controller.holdAction('act-missing-xyz', 'Holding missing action');
} catch (err) {
  caughtNotFoundError = true;
  assert(err instanceof ActionNotFoundError, 'Throws ActionNotFoundError on missing actionId');
  if (err instanceof ActionNotFoundError) {
    assertEquals(err.actionId, 'act-missing-xyz', 'ActionNotFoundError specifies missing actionId');
  }
}
assert(caughtNotFoundError, 'ActionNotFoundError thrown for untracked actionId');

// ------------------------------------------------------------
// TEST 7: REMOVING RECORDS AND CLEANING UP RESOLVED ACTIONS
// ------------------------------------------------------------
console.log('\n▶ Test 7: Removing Records and Explicit Cleanup');

// 7a: Explicit single record removal
const preRemoveSize = controller.size();
const removed = controller.removeRecord(actionId4);
assertEquals(removed, true, 'removeRecord returned true for existing action');
assertEquals(controller.hasRecord(actionId4), false, 'Removed action is no longer tracked');
assertEquals(controller.size(), preRemoveSize - 1, 'Controller size decreased by 1');

const removedAgain = controller.removeRecord(actionId4);
assertEquals(removedAgain, false, 'removeRecord returns false for already-removed action');

// 7b: clearResolvedRecords removes only terminal (CONTINUED, CANCELLED) actions
// Current state of records:
// - act-ctrl-test-001: CONTINUED (terminal)
// - act-ctrl-test-002: DETECTED (active)
// - act-ctrl-test-003: CANCELLED (terminal)
const actionId5 = 'act-ctrl-test-005';
controller.register(actionId5, 'Action 5 registered.');
controller.holdAction(actionId5, 'Action 5 held.'); // HELD (active)

assertEquals(controller.getRecordsByState(InterceptionState.CONTINUED).length, 1, '1 CONTINUED record before cleanup');
assertEquals(controller.getRecordsByState(InterceptionState.CANCELLED).length, 1, '1 CANCELLED record before cleanup');
assertEquals(controller.getRecordsByState(InterceptionState.DETECTED).length, 1, '1 DETECTED record before cleanup');
assertEquals(controller.getRecordsByState(InterceptionState.HELD).length, 1, '1 HELD record before cleanup');

const clearedCount = controller.clearResolvedRecords();
assertEquals(clearedCount, 2, 'clearResolvedRecords cleared exactly 2 terminal records');

// Verify active records remain intact
assertEquals(controller.hasRecord('act-ctrl-test-002'), true, 'DETECTED record retained after cleanup');
assertEquals(controller.hasRecord(actionId5), true, 'HELD record retained after cleanup');
assertEquals(controller.hasRecord(actionId1), false, 'CONTINUED record removed by cleanup');
assertEquals(controller.hasRecord(actionId3), false, 'CANCELLED record removed by cleanup');

// 7c: clearAll cleans everything
controller.clearAll();
assertEquals(controller.size(), 0, 'clearAll emptied all records');

// ------------------------------------------------------------
// TEST 8: STRICT ISOLATION & PRIVACY ASSURANCES
// ------------------------------------------------------------
console.log('\n▶ Test 8: Strict Isolation & Privacy Assurances');
const privacyActionId = 'act-privacy-test';
controller.register(privacyActionId, 'Privacy test action.');
controller.holdAction(privacyActionId, 'Hold action.');
const resolvedPrivacy = controller.continueAction(privacyActionId, 'Allow interaction.');

const serialized = JSON.stringify(resolvedPrivacy);
const parsed = JSON.parse(serialized);

assertEquals(parsed.actionId, privacyActionId, 'Cleanly JSON serializable with intact actionId');
assertEquals(parsed.state, 'CONTINUED', 'Cleanly JSON serializable with state string');

// Verify object contains ONLY authorized fields
const authorizedKeys = ['actionId', 'createdAt', 'reason', 'resolvedAt', 'state'].sort();
assertEquals(
  Object.keys(resolvedPrivacy).sort().join(','),
  authorizedKeys.join(','),
  'Record contains strictly authorized keys only'
);

// Verify no DOM or sensitive payload leaks
const forbiddenTokens = ['password', 'card', 'cvv', 'otp', 'element', 'target', 'node', 'event', 'payload', 'window', 'document'];
for (const token of forbiddenTokens) {
  assert(!(token in (resolvedPrivacy as any)), `Record does NOT contain forbidden property "${token}"`);
}

console.log('\n============================================================');
console.log(`TOTAL CONTROLLER TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log('============================================================\n');

if (totalTests !== passedTests) {
  process.exit(1);
}
