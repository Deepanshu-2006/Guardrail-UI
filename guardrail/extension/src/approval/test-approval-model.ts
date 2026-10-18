/**
 * Guardrail Approval Request Model - Comprehensive Test Suite
 *
 * Verifies:
 * 1. Strongly typed ApprovalRequest model with valid minimum and complete optional fields.
 * 2. Deterministic lifecycle state machine (PENDING -> APPROVED / REJECTED / EXPIRED / CANCELLED).
 * 3. Authoritative server identity assignment (preventing client requester spoofing or self-approval).
 * 4. Separation of duties (requester cannot approve own request).
 * 5. Timestamp validation (chronological order, expiry deadlines, resolution matching).
 * 6. Inconsistent status/decision metadata detection.
 * 7. Strict privacy exclusions (rejection of passwords, OTPs, PINs, cards, cookies, tokens, form values).
 * 8. Sanitized origin and hostname validation.
 * 9. Serialization round-trips.
 * 10. Correlation across GuardrailAction, InterceptionRecord, and ApprovalRequest.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionCategory, ActionType } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { InterceptionState, InterceptionRecord } from '../types/interception.js';
import { GuardrailAction } from '../types/actions.js';
import {
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
  SubmitApprovalDecisionInput,
} from '../types/approval.js';
import {
  ApprovalStateTransitionError,
  ApprovalValidationError,
  assertValidApprovalRequest,
  cancelApprovalRequest,
  createApprovalRequest,
  deserializeApprovalRequest,
  expireApprovalRequest,
  isTerminalApprovalStatus,
  isValidApprovalTransition,
  isValidSanitizedOrigin,
  resolveApprovalRequest,
  serializeApprovalRequest,
  validateApprovalRequest,
  VALID_APPROVAL_TRANSITIONS,
} from './model.js';

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
console.log('🧪 GUARDRAIL APPROVAL REQUEST MODEL - TEST SUITE');
console.log('============================================================\n');

// Sample test IDs and timestamps
const baseActionId = 'act_test_action_001';
const baseRequesterId = 'usr_requester_alice';
const baseContactId = 'tc_guardian_bob';
const t0 = '2026-10-18T12:00:00.000Z';
const t1 = '2026-10-18T12:05:00.000Z'; // 5 mins later
const tExp = '2026-10-18T12:15:00.000Z'; // 15 mins later
const tLate = '2026-10-18T12:30:00.000Z'; // 30 mins later (expired)

// ------------------------------------------------------------
// TEST 1: MINIMUM VALID PENDING RECORD
// ------------------------------------------------------------
console.log('▶ Test 1: Minimum Valid PENDING Record (Required Fields Only)');

const minPendingRecord: ApprovalRequest = Object.freeze({
  id: 'apr_min_001',
  actionId: baseActionId,
  requesterId: baseRequesterId,
  status: ApprovalStatus.PENDING,
  actionDescription: 'Click button "Confirm Transfer"',
  actionType: ActionType.CLICK,
  riskLevel: RiskLevel.HIGH,
  riskReasons: Object.freeze(['Destructive financial transaction']),
  createdAt: t0,
  expiresAt: tExp,
});

const minValidation = validateApprovalRequest(minPendingRecord);
assert(minValidation.valid, 'Minimum PENDING record passes validation');
assertEquals(minValidation.errors.length, 0, 'No validation errors on minimum record');
assertEquals(minPendingRecord.status, ApprovalStatus.PENDING, 'Status is PENDING');
assertEquals(minPendingRecord.resolvedAt, undefined, 'resolvedAt is undefined for PENDING');
assertEquals(minPendingRecord.decision, undefined, 'decision is undefined for PENDING');
assertEquals(minPendingRecord.cancellationReason, undefined, 'cancellationReason is undefined for PENDING');

// ------------------------------------------------------------
// TEST 2: VALID PENDING RECORD WITH ALL PERMITTED OPTIONAL FIELDS
// ------------------------------------------------------------
console.log('\n▶ Test 2: Valid PENDING Record With All Permitted Optional Fields');

const fullPendingRecord: ApprovalRequest = Object.freeze({
  id: 'apr_full_002',
  actionId: baseActionId,
  requesterId: baseRequesterId,
  status: ApprovalStatus.PENDING,
  actionDescription: 'Submit form "Wire Funds to Vendor"',
  actionType: ActionType.SUBMIT,
  category: ActionCategory.PAYMENT,
  riskLevel: RiskLevel.CRITICAL,
  riskScore: 95,
  riskReasons: Object.freeze([
    'High value transfer exceeding standard threshold',
    'Unrecognized recipient banking origin',
  ]),
  origin: 'https://bank.example.com',
  hostname: 'bank.example.com',
  pageTitle: 'Business Wire Transfer Portal',
  createdAt: t0,
  expiresAt: tExp,
});

const fullValidation = validateApprovalRequest(fullPendingRecord);
assert(fullValidation.valid, 'Complete PENDING record with all permitted optional fields is valid');
assertEquals(fullPendingRecord.category, ActionCategory.PAYMENT, 'category is preserved');
assertEquals(fullPendingRecord.riskScore, 95, 'riskScore is preserved');
assertEquals(fullPendingRecord.origin, 'https://bank.example.com', 'origin is preserved');
assertEquals(fullPendingRecord.hostname, 'bank.example.com', 'hostname is preserved');
assertEquals(fullPendingRecord.pageTitle, 'Business Wire Transfer Portal', 'pageTitle is preserved');

// ------------------------------------------------------------
// TEST 3: FACTORY CREATION (createApprovalRequest)
// ------------------------------------------------------------
console.log('\n▶ Test 3: Factory Creation via createApprovalRequest()');

const clientPayload: ClientApprovalRequestPayload = {
  actionId: baseActionId,
  actionDescription: 'Delete customer database records',
  actionType: ActionType.CLICK,
  category: ActionCategory.DESTRUCTIVE,
  riskLevel: RiskLevel.CRITICAL,
  riskScore: 100,
  riskReasons: ['Irreversible bulk data purge'],
  origin: 'https://admin.example.com',
  hostname: 'admin.example.com',
  pageTitle: 'Database Maintenance Console',
};

const createdRequest = createApprovalRequest(clientPayload, baseRequesterId, {
  createdAt: t0,
  ttlMs: 15 * 60 * 1000,
});

assert(createdRequest.id.startsWith('apr_'), 'Generated ID starts with apr_ prefix');
assertEquals(createdRequest.actionId, baseActionId, 'actionId matches payload');
assertEquals(createdRequest.requesterId, baseRequesterId, 'Authoritative requesterId injected');
assertEquals(createdRequest.status, ApprovalStatus.PENDING, 'Initial status is strictly PENDING');
assertEquals(createdRequest.createdAt, t0, 'createdAt recorded properly');
assertEquals(createdRequest.expiresAt, tExp, 'expiresAt computed as createdAt + 15m default TTL');
assertEquals(createdRequest.resolvedAt, undefined, 'resolvedAt is undefined');
assertEquals(createdRequest.decision, undefined, 'decision is undefined');
assert(Object.isFrozen(createdRequest), 'Created request is immutable (frozen)');

// ------------------------------------------------------------
// TEST 4: VALID RESOLUTION - APPROVED (resolveApprovalRequest)
// ------------------------------------------------------------
console.log('\n▶ Test 4: Valid Resolution: APPROVED via resolveApprovalRequest()');

const approveInput: SubmitApprovalDecisionInput = {
  decision: 'APPROVED',
  decidedBy: baseContactId,
  decidedAt: t1,
  decisionReason: 'Verified with user via telephone call. Safe to proceed.',
};

const approvedRequest = resolveApprovalRequest(createdRequest, approveInput);

assertEquals(approvedRequest.id, createdRequest.id, 'id preserved');
assertEquals(approvedRequest.actionId, baseActionId, 'actionId preserved');
assertEquals(approvedRequest.requesterId, baseRequesterId, 'requesterId preserved');
assertEquals(approvedRequest.status, ApprovalStatus.APPROVED, 'Status updated to APPROVED');
assertEquals(approvedRequest.resolvedAt, t1, 'resolvedAt populated with decidedAt');
assert(Boolean(approvedRequest.decision), 'decision metadata populated');
assertEquals(approvedRequest.decision?.decision, 'APPROVED', 'decision verdict is APPROVED');
assertEquals(approvedRequest.decision?.decidedBy, baseContactId, 'decidedBy matches contact');
assertEquals(approvedRequest.decision?.decidedAt, t1, 'decidedAt recorded');
assertEquals(approvedRequest.decision?.decisionReason, 'Verified with user via telephone call. Safe to proceed.', 'decisionReason recorded');
assert(isTerminalApprovalStatus(approvedRequest.status), 'APPROVED is a terminal state');
assert(Object.isFrozen(approvedRequest), 'Approved record is immutable');

// ------------------------------------------------------------
// TEST 5: VALID RESOLUTION - REJECTED (resolveApprovalRequest)
// ------------------------------------------------------------
console.log('\n▶ Test 5: Valid Resolution: REJECTED via resolveApprovalRequest()');

const rejectInput: SubmitApprovalDecisionInput = {
  decision: 'REJECTED',
  decidedBy: baseContactId,
  decidedAt: t1,
  decisionReason: 'Suspicious request. User did not confirm initiating this action.',
};

const rejectedRequest = resolveApprovalRequest(createdRequest, rejectInput);

assertEquals(rejectedRequest.status, ApprovalStatus.REJECTED, 'Status updated to REJECTED');
assertEquals(rejectedRequest.resolvedAt, t1, 'resolvedAt populated');
assertEquals(rejectedRequest.decision?.decision, 'REJECTED', 'decision verdict is REJECTED');
assertEquals(rejectedRequest.decision?.decidedBy, baseContactId, 'decidedBy recorded');
assert(isTerminalApprovalStatus(rejectedRequest.status), 'REJECTED is a terminal state');

// ------------------------------------------------------------
// TEST 6: VALID USER CANCELLATION (cancelApprovalRequest)
// ------------------------------------------------------------
console.log('\n▶ Test 6: Valid User Cancellation via cancelApprovalRequest()');

const cancelledRequest = cancelApprovalRequest(
  createdRequest,
  baseRequesterId,
  'User clicked Cancel in Staging Mode modal.',
  t1
);

assertEquals(cancelledRequest.status, ApprovalStatus.CANCELLED, 'Status updated to CANCELLED');
assertEquals(cancelledRequest.resolvedAt, t1, 'resolvedAt populated on cancellation');
assertEquals(cancelledRequest.decision, undefined, 'decision remains undefined on CANCELLED');
assertEquals(
  cancelledRequest.cancellationReason,
  'User clicked Cancel in Staging Mode modal.',
  'cancellationReason recorded'
);
assert(isTerminalApprovalStatus(cancelledRequest.status), 'CANCELLED is a terminal state');

// ------------------------------------------------------------
// TEST 7: VALID EXPIRATION (expireApprovalRequest)
// ------------------------------------------------------------
console.log('\n▶ Test 7: Valid Expiration via expireApprovalRequest()');

const expiredRequest = expireApprovalRequest(createdRequest, tExp);

assertEquals(expiredRequest.status, ApprovalStatus.EXPIRED, 'Status updated to EXPIRED');
assertEquals(expiredRequest.resolvedAt, tExp, 'resolvedAt populated with expiry deadline');
assertEquals(expiredRequest.decision, undefined, 'decision remains undefined on EXPIRED');
assert(isTerminalApprovalStatus(expiredRequest.status), 'EXPIRED is a terminal state');

// ------------------------------------------------------------
// TEST 8: REQUIRED FIELD VALIDATION FAILURES
// ------------------------------------------------------------
console.log('\n▶ Test 8: Required Field Validation Failures');

// 8a: Missing / empty ID
const missingId = validateApprovalRequest({ ...minPendingRecord, id: '' });
assert(!missingId.valid, 'Rejects empty id');
assert(missingId.errors.some((e) => e.includes('Field "id" is required')), 'Error mentions id requirement');

// 8b: ID missing 'apr_' prefix
const invalidPrefix = validateApprovalRequest({ ...minPendingRecord, id: 'req_12345' });
assert(!invalidPrefix.valid, 'Rejects id without apr_ prefix');
assert(invalidPrefix.errors.some((e) => e.includes('must be prefixed with "apr_"')), 'Error enforces apr_ prefix');

// 8c: Missing actionId
const missingActionId = validateApprovalRequest({ ...minPendingRecord, actionId: '   ' });
assert(!missingActionId.valid, 'Rejects whitespace actionId');

// 8d: Missing requesterId
const missingRequester = validateApprovalRequest({ ...minPendingRecord, requesterId: '' });
assert(!missingRequester.valid, 'Rejects empty requesterId');

// 8e: Missing actionDescription
const missingDesc = validateApprovalRequest({ ...minPendingRecord, actionDescription: '' });
assert(!missingDesc.valid, 'Rejects empty actionDescription');

// 8f: Invalid status
const invalidStatus = validateApprovalRequest({ ...minPendingRecord, status: 'UNKNOWN_STATUS' });
assert(!invalidStatus.valid, 'Rejects unknown status');

// 8g: Invalid actionType
const invalidType = validateApprovalRequest({ ...minPendingRecord, actionType: 'HOVER' });
assert(!invalidType.valid, 'Rejects unknown actionType');

// 8h: Invalid riskLevel
const invalidRisk = validateApprovalRequest({ ...minPendingRecord, riskLevel: 'EXTREME' });
assert(!invalidRisk.valid, 'Rejects unknown riskLevel');

// 8i: Invalid riskScore (out of bounds)
const invalidScoreHigh = validateApprovalRequest({ ...minPendingRecord, riskScore: 150 });
assert(!invalidScoreHigh.valid, 'Rejects riskScore > 100');
const invalidScoreLow = validateApprovalRequest({ ...minPendingRecord, riskScore: -5 });
assert(!invalidScoreLow.valid, 'Rejects riskScore < 0');

// 8j: Non-array or invalid riskReasons
const invalidReasons = validateApprovalRequest({ ...minPendingRecord, riskReasons: 'not an array' });
assert(!invalidReasons.valid, 'Rejects non-array riskReasons');

// ------------------------------------------------------------
// TEST 9: TIMESTAMP VALIDATION FAILURES
// ------------------------------------------------------------
console.log('\n▶ Test 9: Timestamp Validation Failures');

// 9a: Malformed createdAt
const badCreatedAt = validateApprovalRequest({ ...minPendingRecord, createdAt: 'not-a-date' });
assert(!badCreatedAt.valid, 'Rejects unparseable createdAt');

// 9b: Malformed expiresAt
const badExpiresAt = validateApprovalRequest({ ...minPendingRecord, expiresAt: 'invalid' });
assert(!badExpiresAt.valid, 'Rejects unparseable expiresAt');

// 9c: Inverted timestamps (expiresAt <= createdAt)
const invertedTimes = validateApprovalRequest({
  ...minPendingRecord,
  createdAt: tExp,
  expiresAt: t0, // earlier than createdAt
});
assert(!invertedTimes.valid, 'Rejects expiresAt <= createdAt');
assert(invertedTimes.errors.some((e) => e.includes('strictly after')), 'Error explains timestamp order');

// 9d: resolvedAt preceding createdAt
const earlyResolution = validateApprovalRequest({
  ...approvedRequest,
  resolvedAt: '2026-10-18T11:00:00.000Z', // 1 hour before t0
  decision: {
    ...approvedRequest.decision!,
    decidedAt: '2026-10-18T11:00:00.000Z',
  },
});
assert(!earlyResolution.valid, 'Rejects resolution preceding createdAt');

// 9e: Decision after expiresAt
let lateDecisionCaught = false;
try {
  resolveApprovalRequest(createdRequest, {
    decision: 'APPROVED',
    decidedBy: baseContactId,
    decidedAt: tLate, // past 15 min expiry
  });
} catch (err) {
  lateDecisionCaught = true;
  assert(err instanceof ApprovalValidationError, 'Throws ApprovalValidationError on late decision');
  if (err instanceof ApprovalValidationError) {
    assert(err.errors.some((e) => e.includes('exceeds expiration deadline')), 'Error identifies expiration violation');
  }
}
assert(lateDecisionCaught, 'Prevented decision after expiration deadline');

// ------------------------------------------------------------
// TEST 10: INCONSISTENT STATUS & DECISION COMBINATIONS
// ------------------------------------------------------------
console.log('\n▶ Test 10: Inconsistent Status & Decision Combinations');

// 10a: PENDING with decision metadata present
const pendingWithDecision = validateApprovalRequest({
  ...minPendingRecord,
  decision: {
    decision: 'APPROVED',
    decidedBy: baseContactId,
    decidedAt: t1,
  },
});
assert(!pendingWithDecision.valid, 'Rejects PENDING status with decision metadata');
assert(pendingWithDecision.errors.some((e) => e.includes('must be undefined when status is PENDING')), 'Error explains PENDING cannot have decision');

// 10b: PENDING with resolvedAt present
const pendingWithResolved = validateApprovalRequest({
  ...minPendingRecord,
  resolvedAt: t1,
});
assert(!pendingWithResolved.valid, 'Rejects PENDING status with resolvedAt');

// 10c: APPROVED without decision metadata
const approvedWithoutDecision = validateApprovalRequest({
  ...minPendingRecord,
  status: ApprovalStatus.APPROVED,
  resolvedAt: t1,
});
assert(!approvedWithoutDecision.valid, 'Rejects APPROVED status without decision object');

// 10d: REJECTED without decision metadata
const rejectedWithoutDecision = validateApprovalRequest({
  ...minPendingRecord,
  status: ApprovalStatus.REJECTED,
  resolvedAt: t1,
});
assert(!rejectedWithoutDecision.valid, 'Rejects REJECTED status without decision object');

// 10e: EXPIRED with decision metadata present
const expiredWithDecision = validateApprovalRequest({
  ...expiredRequest,
  decision: {
    decision: 'APPROVED',
    decidedBy: baseContactId,
    decidedAt: t1,
  },
});
assert(!expiredWithDecision.valid, 'Rejects EXPIRED status with decision object');

// 10f: CANCELLED with decision metadata present
const cancelledWithDecision = validateApprovalRequest({
  ...cancelledRequest,
  decision: {
    decision: 'APPROVED',
    decidedBy: baseContactId,
    decidedAt: t1,
  },
});
assert(!cancelledWithDecision.valid, 'Rejects CANCELLED status with decision object');

// 10g: Status / Decision verdict mismatch (Status: APPROVED, Decision: REJECTED)
const verdictMismatch = validateApprovalRequest({
  ...approvedRequest,
  decision: {
    ...approvedRequest.decision!,
    decision: 'REJECTED', // mismatch!
  },
});
assert(!verdictMismatch.valid, 'Rejects mismatch between request status and decision verdict');

// 10h: Inconsistent resolvedAt vs decidedAt
const timestampMismatch = validateApprovalRequest({
  ...approvedRequest,
  resolvedAt: tExp, // does not match decidedAt (t1)
});
assert(!timestampMismatch.valid, 'Rejects mismatch between resolvedAt and decidedAt');

// 10i: Non-CANCELLED with cancellationReason
const nonCancelledWithReason = validateApprovalRequest({
  ...minPendingRecord,
  cancellationReason: 'Invalid reason on pending',
});
assert(!nonCancelledWithReason.valid, 'Rejects cancellationReason on non-CANCELLED record');

// ------------------------------------------------------------
// TEST 11: PRIVACY & FORBIDDEN PROPERTY ENFORCEMENT
// ------------------------------------------------------------
console.log('\n▶ Test 11: Privacy & Forbidden Property Enforcement');

// 11a: Sensitive field names rejected (passwords, OTPs, PINs, cards, cookies, tokens, form values)
const forbiddenTestCases: Array<{ field: string; value: unknown }> = [
  { field: 'password', value: 'Secret123!' },
  { field: 'userPassword', value: 'hunter2' },
  { field: 'otp', value: '123456' },
  { field: 'pin', value: '9999' },
  { field: 'cvv', value: '123' },
  { field: 'cardNumber', value: '4111111111111111' },
  { field: 'creditCard', value: '4111-2222-3333-4444' },
  { field: 'token', value: 'jwt.token.here' },
  { field: 'authToken', value: 'bearer xyz' },
  { field: 'cookies', value: 'session_id=abc' },
  { field: 'formValue', value: 'confidential user entry' },
  { field: 'formData', value: { input1: 'value' } },
  { field: 'rawHtml', value: '<div><input type="password"/></div>' },
  { field: 'domNode', value: '[object HTMLButtonElement]' },
];

for (const tc of forbiddenTestCases) {
  const tainted = { ...minPendingRecord, [tc.field]: tc.value };
  const res = validateApprovalRequest(tainted);
  assert(!res.valid, `Rejects payload containing forbidden field "${tc.field}"`);
  assert(
    res.errors.some((e) => e.includes('violates privacy') || e.includes('Unpermitted property')),
    `Error explains forbidden/unpermitted field for "${tc.field}"`
  );
}

// 11b: Nested forbidden field inside decision
const nestedForbidden = validateApprovalRequest({
  ...approvedRequest,
  decision: {
    ...approvedRequest.decision!,
    reviewerToken: 'leaked_auth_token',
  },
});
assert(!nestedForbidden.valid, 'Rejects nested forbidden field inside decision metadata');

// 11c: Unpermitted arbitrary fields
const arbitraryField = validateApprovalRequest({
  ...minPendingRecord,
  arbitraryCustomField: 'not in schema',
});
assert(!arbitraryField.valid, 'Rejects unpermitted arbitrary property to keep model minimal');

// 11d: Origin sanitization check (isValidSanitizedOrigin)
assert(isValidSanitizedOrigin('https://example.com'), 'Accepts clean https origin');
assert(isValidSanitizedOrigin('http://localhost:3000'), 'Accepts clean localhost with port');
assert(!isValidSanitizedOrigin('https://example.com/checkout/step2'), 'Rejects origin with path');
assert(!isValidSanitizedOrigin('https://example.com?token=secret123'), 'Rejects origin with query parameters');
assert(!isValidSanitizedOrigin('https://example.com#access_token=xyz'), 'Rejects origin with hash fragment');
assert(!isValidSanitizedOrigin('https://user:pass@example.com'), 'Rejects origin with embedded credentials');
assert(!isValidSanitizedOrigin('ftp://example.com'), 'Rejects non-HTTP origin');

// 11e: Origin with path in record validation
const originWithPath = validateApprovalRequest({
  ...minPendingRecord,
  origin: 'https://example.com/sensitive/path',
});
assert(!originWithPath.valid, 'Rejects ApprovalRequest with un-sanitized origin');

// 11f: Hostname validation
const badHostname = validateApprovalRequest({
  ...minPendingRecord,
  hostname: 'https://example.com/path',
});
assert(!badHostname.valid, 'Rejects hostname containing protocol or slashes');

// ------------------------------------------------------------
// TEST 12: ZERO-TRUST CLIENT AUTHORITY & ANTI-SPOOFING
// ------------------------------------------------------------
console.log('\n▶ Test 12: Zero-Trust Client Authority & Anti-Spoofing');

// 12a: Client payload attempting to choose its own requesterId
let caughtClientRequester = false;
try {
  createApprovalRequest(
    {
      ...clientPayload,
      requesterId: 'spoofed_admin_id',
    } as any,
    baseRequesterId
  );
} catch (err) {
  caughtClientRequester = true;
  assert(err instanceof ApprovalValidationError, 'createApprovalRequest rejects client-specified requesterId');
}
assert(caughtClientRequester, 'Prevented client from choosing its own requesterId');

// 12b: Client payload attempting to self-assign status APPROVED
let caughtClientStatus = false;
try {
  createApprovalRequest(
    {
      ...clientPayload,
      status: ApprovalStatus.APPROVED,
    } as any,
    baseRequesterId
  );
} catch (err) {
  caughtClientStatus = true;
  assert(err instanceof ApprovalValidationError, 'createApprovalRequest rejects client-specified status');
}
assert(caughtClientStatus, 'Prevented client from self-assigning APPROVED status');

// 12c: Client payload attempting to supply decision
let caughtClientDecision = false;
try {
  createApprovalRequest(
    {
      ...clientPayload,
      decision: { decision: 'APPROVED', decidedBy: 'hacker', decidedAt: t0 },
    } as any,
    baseRequesterId
  );
} catch (err) {
  caughtClientDecision = true;
  assert(err instanceof ApprovalValidationError, 'createApprovalRequest rejects client-specified decision');
}
assert(caughtClientDecision, 'Prevented client from supplying decision in initial payload');

// 12d: Separation of duties: Requester cannot approve own request
let caughtSelfApproval = false;
try {
  resolveApprovalRequest(createdRequest, {
    decision: 'APPROVED',
    decidedBy: baseRequesterId, // Same as requester!
    decidedAt: t1,
  });
} catch (err) {
  caughtSelfApproval = true;
  assert(err instanceof ApprovalValidationError, 'Throws ApprovalValidationError on self-approval');
  if (err instanceof ApprovalValidationError) {
    assert(err.errors.some((e) => e.includes('Separation of duties violation')), 'Error explicitly identifies separation of duties');
  }
}
assert(caughtSelfApproval, 'Separation of duties enforced: Requester cannot approve their own request');

// 12e: Unauthorized cancellation: Another user cannot cancel requester's request
let caughtUnauthorizedCancel = false;
try {
  cancelApprovalRequest(createdRequest, 'usr_imposter_eve', 'Malicious cancellation attempt');
} catch (err) {
  caughtUnauthorizedCancel = true;
  assert(err instanceof ApprovalValidationError, 'Throws ApprovalValidationError on unauthorized cancellation');
}
assert(caughtUnauthorizedCancel, 'Only authenticated requester can cancel approval request');

// ------------------------------------------------------------
// TEST 13: DETERMINISTIC STATE MACHINE TRANSITIONS
// ------------------------------------------------------------
console.log('\n▶ Test 13: Deterministic State Machine Transitions');

// 13a: Declarative transition matrix
assertEquals(VALID_APPROVAL_TRANSITIONS[ApprovalStatus.PENDING].length, 4, 'PENDING allows 4 forward transitions');
assertEquals(VALID_APPROVAL_TRANSITIONS[ApprovalStatus.APPROVED].length, 0, 'APPROVED allows 0 transitions (Terminal)');
assertEquals(VALID_APPROVAL_TRANSITIONS[ApprovalStatus.REJECTED].length, 0, 'REJECTED allows 0 transitions (Terminal)');
assertEquals(VALID_APPROVAL_TRANSITIONS[ApprovalStatus.EXPIRED].length, 0, 'EXPIRED allows 0 transitions (Terminal)');
assertEquals(VALID_APPROVAL_TRANSITIONS[ApprovalStatus.CANCELLED].length, 0, 'CANCELLED allows 0 transitions (Terminal)');

assert(isValidApprovalTransition(ApprovalStatus.PENDING, ApprovalStatus.APPROVED), 'PENDING -> APPROVED is valid');
assert(isValidApprovalTransition(ApprovalStatus.PENDING, ApprovalStatus.REJECTED), 'PENDING -> REJECTED is valid');
assert(isValidApprovalTransition(ApprovalStatus.PENDING, ApprovalStatus.EXPIRED), 'PENDING -> EXPIRED is valid');
assert(isValidApprovalTransition(ApprovalStatus.PENDING, ApprovalStatus.CANCELLED), 'PENDING -> CANCELLED is valid');
assert(!isValidApprovalTransition(ApprovalStatus.APPROVED, ApprovalStatus.CANCELLED), 'APPROVED -> CANCELLED is invalid');
assert(!isValidApprovalTransition(ApprovalStatus.REJECTED, ApprovalStatus.APPROVED), 'REJECTED -> APPROVED is invalid');
assert(!isValidApprovalTransition(ApprovalStatus.EXPIRED, ApprovalStatus.APPROVED), 'EXPIRED -> APPROVED is invalid');
assert(!isValidApprovalTransition(ApprovalStatus.CANCELLED, ApprovalStatus.APPROVED), 'CANCELLED -> APPROVED is invalid');

// 13b: Cannot transition out of terminal APPROVED
let caughtTransitionFromApproved = false;
try {
  cancelApprovalRequest(approvedRequest, baseRequesterId, 'Attempting to cancel already approved action');
} catch (err) {
  caughtTransitionFromApproved = true;
  assert(err instanceof ApprovalStateTransitionError, 'Throws ApprovalStateTransitionError when transitioning from terminal state');
}
assert(caughtTransitionFromApproved, 'Prevented transition out of terminal APPROVED state');

// 13c: Cannot transition out of terminal REJECTED
let caughtTransitionFromRejected = false;
try {
  resolveApprovalRequest(rejectedRequest, approveInput);
} catch (err) {
  caughtTransitionFromRejected = true;
  assert(err instanceof ApprovalStateTransitionError, 'Throws on attempt to approve already REJECTED request');
}
assert(caughtTransitionFromRejected, 'Prevented transition out of terminal REJECTED state');

// 13d: Cannot transition out of terminal EXPIRED
let caughtTransitionFromExpired = false;
try {
  resolveApprovalRequest(expiredRequest, approveInput);
} catch (err) {
  caughtTransitionFromExpired = true;
  assert(err instanceof ApprovalStateTransitionError, 'Throws on attempt to approve already EXPIRED request');
}
assert(caughtTransitionFromExpired, 'Prevented transition out of terminal EXPIRED state');

// 13e: Cannot transition out of terminal CANCELLED
let caughtTransitionFromCancelled = false;
try {
  resolveApprovalRequest(cancelledRequest, approveInput);
} catch (err) {
  caughtTransitionFromCancelled = true;
  assert(err instanceof ApprovalStateTransitionError, 'Throws on attempt to approve already CANCELLED request');
}
assert(caughtTransitionFromCancelled, 'Prevented transition out of terminal CANCELLED state');

// ------------------------------------------------------------
// TEST 14: SERIALIZATION & ROUND-TRIP INTEGRITY
// ------------------------------------------------------------
console.log('\n▶ Test 14: Serialization & Round-Trip Integrity');

const serialized = serializeApprovalRequest(approvedRequest);
assert(typeof serialized === 'string' && serialized.length > 0, 'Serializes to valid JSON string');

const deserialized = deserializeApprovalRequest(serialized);
assertEquals(deserialized.id, approvedRequest.id, 'id preserved through round-trip');
assertEquals(deserialized.actionId, approvedRequest.actionId, 'actionId preserved through round-trip');
assertEquals(deserialized.requesterId, approvedRequest.requesterId, 'requesterId preserved through round-trip');
assertEquals(deserialized.status, ApprovalStatus.APPROVED, 'status preserved through round-trip');
assertEquals(deserialized.decision?.decidedBy, baseContactId, 'decision metadata preserved');
assert(Object.isFrozen(deserialized), 'Deserialized request is frozen');
assertValidApprovalRequest(deserialized);
assert(true, 'assertValidApprovalRequest succeeds on deserialized record');

// 14b: Reject malformed / empty JSON string
let caughtBadJson = false;
try {
  deserializeApprovalRequest('{ bad json');
} catch (err) {
  caughtBadJson = true;
  assert(err instanceof ApprovalValidationError, 'deserializeApprovalRequest throws ApprovalValidationError on bad JSON');
}
assert(caughtBadJson, 'Rejects invalid JSON syntax');

// 14c: Reject deserialization of tampered / invalid payload
let caughtTamperedJson = false;
try {
  deserializeApprovalRequest(JSON.stringify({ ...approvedRequest, requesterId: '' }));
} catch (err) {
  caughtTamperedJson = true;
  assert(err instanceof ApprovalValidationError, 'deserializeApprovalRequest throws ApprovalValidationError on schema violation');
}
assert(caughtTamperedJson, 'Rejects tampered JSON payload missing required fields');

// ------------------------------------------------------------
// TEST 15: PIPELINE IDENTITY CORRELATION (Action -> Interception -> Approval)
// ------------------------------------------------------------
console.log('\n▶ Test 15: Pipeline Correlation (GuardrailAction -> InterceptionRecord -> ApprovalRequest)');

const testPipelineActionId = 'act_pipeline_corr_999';

// 1. Upstream GuardrailAction
const sourceAction: GuardrailAction = {
  id: testPipelineActionId,
  type: ActionType.CLICK,
  category: ActionCategory.DESTRUCTIVE,
  page: {
    url: 'https://app.example.com/settings',
    title: 'Account Settings',
  },
  timestamp: t0,
};

// 2. InterceptionRecord (from Interception Layer)
const interceptionRecord: InterceptionRecord = Object.freeze({
  actionId: sourceAction.id,
  state: InterceptionState.HELD,
  createdAt: t0,
  reason: 'Held in Staging Mode pending user approval request',
});

// 3. ApprovalRequest (from Approval Layer)
const approvalRequest = createApprovalRequest(
  {
    actionId: interceptionRecord.actionId,
    actionDescription: 'Click button "Delete Account"',
    actionType: sourceAction.type,
    category: sourceAction.category,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 100,
    riskReasons: ['Destructive account removal'],
    origin: 'https://app.example.com',
    hostname: 'app.example.com',
    pageTitle: sourceAction.page.title,
  },
  baseRequesterId,
  { createdAt: t0 }
);

assertEquals(approvalRequest.actionId, sourceAction.id, 'ApprovalRequest.actionId strictly matches GuardrailAction.id');
assertEquals(approvalRequest.actionId, interceptionRecord.actionId, 'ApprovalRequest.actionId strictly matches InterceptionRecord.actionId');
assertEquals(approvalRequest.actionType, sourceAction.type, 'ActionType preserved from GuardrailAction');
assertEquals(approvalRequest.category, sourceAction.category, 'ActionCategory preserved from GuardrailAction');
assertEquals(approvalRequest.hostname, 'app.example.com', 'Hostname matches source action origin');
assert(approvalRequest.id !== approvalRequest.actionId, 'ApprovalRequest id (apr_...) is distinct from actionId (act_...)');

console.log('\n============================================================');
console.log(`TOTAL APPROVAL MODEL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log('============================================================\n');

if (totalTests !== passedTests) {
  process.exit(1);
}
