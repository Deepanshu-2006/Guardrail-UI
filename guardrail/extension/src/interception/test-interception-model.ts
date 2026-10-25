/**
 * Guardrail Interception Model Verification Test Suite
 *
 * Verifies the strongly-typed interception lifecycle model, state machine rules,
 * transition validation, actionId preservation, and strict privacy/serialization constraints.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import {
  InterceptionState,
} from '../types/interception.js';
import {
  createInterceptionRecord,
  isTerminalInterceptionState,
  isValidInterceptionTransition,
  InvalidStateTransitionError,
  transitionInterceptionRecord,
  VALID_INTERCEPTION_TRANSITIONS,
} from './transitions.js';

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
console.log('🧪 GUARDRAIL INTERCEPTION MODEL - TEST SUITE');
console.log('============================================================\n');

// ------------------------------------------------------------
// TEST 1: INITIAL CREATION IN DETECTED STATE
// ------------------------------------------------------------
console.log('▶ Test 1: Initial Creation in DETECTED State');
const testActionId = 'act-test-interception-101';
const initialRecord = createInterceptionRecord(testActionId, 'Action captured at document capture boundary.');

assertEquals(initialRecord.actionId, testActionId, 'Preserves actionId identically');
assertEquals(initialRecord.state, InterceptionState.DETECTED, 'Initial state is DETECTED');
assert(Boolean(initialRecord.createdAt && !isNaN(Date.parse(initialRecord.createdAt))), 'createdAt is a valid ISO 8601 string');
assertEquals(initialRecord.resolvedAt, undefined, 'resolvedAt is undefined for non-terminal DETECTED state');
assertEquals(initialRecord.reason, 'Action captured at document capture boundary.', 'Stores initial explanation reason');
assert(Object.isFrozen(initialRecord), 'InterceptionRecord is immutable (frozen)');

// ------------------------------------------------------------
// TEST 2: VALID TRANSITION: DETECTED -> HELD
// ------------------------------------------------------------
console.log('\n▶ Test 2: Valid Transition: DETECTED -> HELD');
const heldRecord = transitionInterceptionRecord(
  initialRecord,
  InterceptionState.HELD,
  'Action evaluated as HIGH risk (score: 50). Held pending user confirmation in Warning Modal.'
);

assertEquals(heldRecord.actionId, testActionId, 'actionId preserved across DETECTED -> HELD transition');
assertEquals(heldRecord.state, InterceptionState.HELD, 'State updated to HELD');
assertEquals(heldRecord.createdAt, initialRecord.createdAt, 'Original createdAt timestamp preserved');
assertEquals(heldRecord.resolvedAt, undefined, 'resolvedAt remains undefined for non-terminal HELD state');
assert(heldRecord.reason.includes('Held pending user confirmation'), 'Reason updated with policy explanation');
assert(Object.isFrozen(heldRecord), 'Held record is immutable');

// ------------------------------------------------------------
// TEST 3: VALID TRANSITION: HELD -> CONTINUED (TERMINAL)
// ------------------------------------------------------------
console.log('\n▶ Test 3: Valid Transition: HELD -> CONTINUED (Terminal)');
const continuedRecord = transitionInterceptionRecord(
  heldRecord,
  InterceptionState.CONTINUED,
  'User approved interaction via Warning Modal "Continue" button.'
);

assertEquals(continuedRecord.actionId, testActionId, 'actionId preserved across HELD -> CONTINUED transition');
assertEquals(continuedRecord.state, InterceptionState.CONTINUED, 'State updated to CONTINUED');
assertEquals(continuedRecord.createdAt, initialRecord.createdAt, 'Original createdAt preserved');
assert(Boolean(continuedRecord.resolvedAt && !isNaN(Date.parse(continuedRecord.resolvedAt))), 'resolvedAt is populated with ISO timestamp on terminal CONTINUED state');
assert(isTerminalInterceptionState(continuedRecord.state), 'isTerminalInterceptionState returns true for CONTINUED');

// ------------------------------------------------------------
// TEST 4: VALID TRANSITION: HELD -> CANCELLED (TERMINAL)
// ------------------------------------------------------------
console.log('\n▶ Test 4: Valid Transition: HELD -> CANCELLED (Terminal)');
const cancelledFromHeld = transitionInterceptionRecord(
  heldRecord,
  InterceptionState.CANCELLED,
  'User clicked "Cancel" in Warning Modal. Action aborted.'
);

assertEquals(cancelledFromHeld.actionId, testActionId, 'actionId preserved across HELD -> CANCELLED transition');
assertEquals(cancelledFromHeld.state, InterceptionState.CANCELLED, 'State updated to CANCELLED');
assert(Boolean(cancelledFromHeld.resolvedAt && !isNaN(Date.parse(cancelledFromHeld.resolvedAt))), 'resolvedAt is populated on CANCELLED state');
assert(isTerminalInterceptionState(cancelledFromHeld.state), 'isTerminalInterceptionState returns true for CANCELLED');

// ------------------------------------------------------------
// TEST 5: DIRECT TRANSITIONS FROM DETECTED (FAST-PATHS)
// ------------------------------------------------------------
console.log('\n▶ Test 5: Fast-Path Direct Transitions from DETECTED');

// Direct DETECTED -> CONTINUED (e.g. LOW risk ALLOW response)
const fastContinueRecord = transitionInterceptionRecord(
  initialRecord,
  InterceptionState.CONTINUED,
  'Action evaluated as LOW risk (score: 0). Permitted immediately without gating.'
);
assertEquals(fastContinueRecord.state, InterceptionState.CONTINUED, 'Direct transition DETECTED -> CONTINUED succeeded');
assert(Boolean(fastContinueRecord.resolvedAt), 'resolvedAt populated for direct CONTINUED');

// Direct DETECTED -> CANCELLED (e.g. static policy block)
const fastCancelRecord = transitionInterceptionRecord(
  initialRecord,
  InterceptionState.CANCELLED,
  'Action blocked by strict policy rule prior to modal.'
);
assertEquals(fastCancelRecord.state, InterceptionState.CANCELLED, 'Direct transition DETECTED -> CANCELLED succeeded');
assert(Boolean(fastCancelRecord.resolvedAt), 'resolvedAt populated for direct CANCELLED');

// ------------------------------------------------------------
// TEST 6: PREVENTING PROHIBITED TRANSITIONS
// ------------------------------------------------------------
console.log('\n▶ Test 6: Preventing Prohibited Transitions');

// 6a: Cannot transition backwards: HELD -> DETECTED
let caughtBackwardError = false;
try {
  transitionInterceptionRecord(heldRecord, InterceptionState.DETECTED, 'Invalid backward transition');
} catch (err) {
  caughtBackwardError = true;
  assert(err instanceof InvalidStateTransitionError, 'Throws InvalidStateTransitionError on HELD -> DETECTED');
  if (err instanceof InvalidStateTransitionError) {
    assertEquals(err.fromState, InterceptionState.HELD, 'Error identifies fromState as HELD');
    assertEquals(err.toState, InterceptionState.DETECTED, 'Error identifies toState as DETECTED');
  }
}
assert(caughtBackwardError, 'Prevented prohibited backward transition HELD -> DETECTED');

// 6b: Cannot transition out of terminal CONTINUED state
let caughtContinuedExitError = false;
try {
  transitionInterceptionRecord(continuedRecord, InterceptionState.HELD, 'Invalid transition from terminal state');
} catch (err) {
  caughtContinuedExitError = true;
  assert(err instanceof InvalidStateTransitionError, 'Throws on attempt to transition out of CONTINUED');
}
assert(caughtContinuedExitError, 'Prevented transition from terminal CONTINUED state');

// 6c: Cannot transition out of terminal CANCELLED state
let caughtCancelledExitError = false;
try {
  transitionInterceptionRecord(cancelledFromHeld, InterceptionState.CONTINUED, 'Cannot resurrect cancelled action');
} catch (err) {
  caughtCancelledExitError = true;
  assert(err instanceof InvalidStateTransitionError, 'Throws on attempt to resurrect CANCELLED action');
}
assert(caughtCancelledExitError, 'Prevented transition out of terminal CANCELLED state');

// ------------------------------------------------------------
// TEST 7: DECLARATIVE TRANSITION MATRIX VERIFICATION
// ------------------------------------------------------------
console.log('\n▶ Test 7: Declarative Transition Matrix & Helper Verification');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.DETECTED].length, 4, 'DETECTED has exactly 4 valid transitions (HELD, CONTINUED, CANCELLED, INVALIDATED)');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.HELD].length, 6, 'HELD has exactly 6 valid transitions (AWAITING_APPROVAL, READY_FOR_USER_CONFIRMATION, CONTINUED, CANCELLED, EXPIRED, INVALIDATED)');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.AWAITING_APPROVAL].length, 4, 'AWAITING_APPROVAL has 4 valid transitions (READY_FOR_USER_CONFIRMATION, CANCELLED, EXPIRED, INVALIDATED)');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.READY_FOR_USER_CONFIRMATION].length, 4, 'READY_FOR_USER_CONFIRMATION has 4 valid transitions (CONTINUED, CANCELLED, EXPIRED, INVALIDATED)');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.CONTINUED].length, 0, 'CONTINUED has 0 valid transitions (Terminal)');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.CANCELLED].length, 0, 'CANCELLED has 0 valid transitions (Terminal)');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.EXPIRED].length, 0, 'EXPIRED has 0 valid transitions (Terminal)');
assertEquals(VALID_INTERCEPTION_TRANSITIONS[InterceptionState.INVALIDATED].length, 0, 'INVALIDATED has 0 valid transitions (Terminal)');

assert(isValidInterceptionTransition(InterceptionState.DETECTED, InterceptionState.HELD), 'isValidInterceptionTransition confirms DETECTED -> HELD is valid');
assert(isValidInterceptionTransition(InterceptionState.HELD, InterceptionState.AWAITING_APPROVAL), 'isValidInterceptionTransition confirms HELD -> AWAITING_APPROVAL is valid');
assert(isValidInterceptionTransition(InterceptionState.AWAITING_APPROVAL, InterceptionState.READY_FOR_USER_CONFIRMATION), 'isValidInterceptionTransition confirms AWAITING_APPROVAL -> READY_FOR_USER_CONFIRMATION is valid');
assert(isValidInterceptionTransition(InterceptionState.READY_FOR_USER_CONFIRMATION, InterceptionState.CONTINUED), 'isValidInterceptionTransition confirms READY_FOR_USER_CONFIRMATION -> CONTINUED is valid');
assert(!isValidInterceptionTransition(InterceptionState.AWAITING_APPROVAL, InterceptionState.CONTINUED), 'isValidInterceptionTransition confirms AWAITING_APPROVAL cannot transition directly to CONTINUED');
assert(!isValidInterceptionTransition(InterceptionState.CONTINUED, InterceptionState.HELD), 'isValidInterceptionTransition confirms CONTINUED -> HELD is invalid');
assert(!isValidInterceptionTransition(InterceptionState.CANCELLED, InterceptionState.CONTINUED), 'isValidInterceptionTransition confirms CANCELLED -> CONTINUED is invalid');
assert(!isValidInterceptionTransition(InterceptionState.EXPIRED, InterceptionState.READY_FOR_USER_CONFIRMATION), 'isValidInterceptionTransition confirms EXPIRED -> READY_FOR_USER_CONFIRMATION is invalid');

// ------------------------------------------------------------
// TEST 8: STRICT PRIVACY & ZERO DOM LEAKAGE
// ------------------------------------------------------------
console.log('\n▶ Test 8: Strict Privacy & Zero DOM / Sensitive Data Leakage');

// Ensure record is 100% cleanly JSON-serializable
const serialized = JSON.stringify(heldRecord);
const deserialized = JSON.parse(serialized);

assertEquals(deserialized.actionId, testActionId, 'actionId preserved through JSON serialization');
assertEquals(deserialized.state, 'HELD', 'state serialized cleanly as string');

// Verify object keys contain ONLY the required schema fields
const recordKeys = Object.keys(heldRecord).sort();
const expectedKeys = ['actionId', 'createdAt', 'reason', 'state'].sort();
assertEquals(
  recordKeys.filter((k) => (heldRecord as any)[k] !== undefined).sort().join(','),
  expectedKeys.join(','),
  'Record contains ONLY authorized schema fields (actionId, createdAt, reason, state)'
);

// Verify no DOM elements or sensitive keys exist
const sensitiveFields = ['password', 'card', 'cvv', 'otp', 'element', 'target', 'node', 'event', 'payload'];
for (const field of sensitiveFields) {
  assert(!(field in (heldRecord as any)), `Record does NOT contain "${field}" property`);
}

// ------------------------------------------------------------
// TEST 9: INPUT VALIDATION
// ------------------------------------------------------------
console.log('\n▶ Test 9: Input Validation on Record Creation');
let caughtEmptyIdError = false;
try {
  createInterceptionRecord('');
} catch {
  caughtEmptyIdError = true;
}
assert(caughtEmptyIdError, 'createInterceptionRecord rejects empty actionId');

console.log('\n============================================================');
console.log(`TOTAL INTERCEPTION TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log('============================================================\n');

if (totalTests !== passedTests) {
  process.exit(1);
}
