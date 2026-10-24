/**
 * Guardrail Approval Action Binding - Comprehensive Test Suite
 *
 * Verifies:
 * 1. Strongly typed ApprovalActionBinding model and 1:1 association with ApprovalRequest.
 * 2. Established ID generation (bnd_...) and trust boundary identifier validation (act_, apr_, bnd_).
 * 3. Explicit lifecycle state transitions (BOUND -> APPROVED / REJECTED / EXPIRED / CANCELLED / INVALIDATED).
 * 4. Creation and expiration metadata recording (createdAt, expiresAt, resolvedAt).
 * 5. Anti-reassignment safeguards (prohibits reassigning request to different action or action to conflicting request).
 * 6. Conflict detection for concurrent or duplicate active bindings.
 * 7. Strict privacy exclusions (rejection of passwords, OTPs, PINs, cards, cookies, tokens, form values).
 * 8. Pure-JS SHA-256 structural fingerprint digest calculation and tamper detection.
 * 9. Zero-trust authorization and server-side requester binding.
 * 10. Persistence classification audit (EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY).
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionType } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import {
  ApprovalActionBinding,
  ApprovalActionBindingState,
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import {
  ActionFingerprintDescriptor,
  ApprovalBindingConflictError,
  ApprovalBindingReassignmentError,
  ApprovalBindingStateTransitionError,
  ApprovalBindingValidationError,
  assertNoBindingReassignment,
  assertValidActionId,
  assertValidApprovalActionBinding,
  assertValidBindingId,
  computeActionDigest,
  computeSha256,
  createApprovalActionBinding,
  generateActionBindingId,
  isBindingExpired,
  isTerminalBindingState,
  isValidBindingTransition,
  transitionBindingState,
  validateActionDigest,
  validateActionId,
  validateApprovalActionBinding,
  validateBindingId,
} from './binding.js';
import {
  createApprovalRequest,
  resolveTimestamp,
  TimeProvider,
  validateApprovalRequestId,
} from './model.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
  PERSISTENCE_METADATA,
} from './repository.js';
import {
  ActorRole,
  ApprovalAccessDeniedError,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
  UnauthorizedActionRequesterError,
} from './authorization.js';
import { ApprovalService } from './service.js';

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
  const matches = actual === expected;
  assert(matches, `${message} (expected: ${String(expected)}, got: ${String(actual)})`);
}

function assertThrows(fn: () => unknown, expectedErrorName: string, message: string): void {
  totalTests++;
  try {
    fn();
    console.error(`  ✗ FAILED: ${message} (expected error "${expectedErrorName}" but none was thrown)`);
    process.exitCode = 1;
  } catch (err: unknown) {
    const errName = err instanceof Error ? err.name : String(err);
    if (errName === expectedErrorName || (err instanceof Error && err.constructor.name === expectedErrorName)) {
      passedTests++;
      console.log(`  ✓ ${message} (caught ${errName})`);
    } else {
      console.error(
        `  ✗ FAILED: ${message} (expected error "${expectedErrorName}", got "${errName}": ${err instanceof Error ? err.message : String(err)})`
      );
      process.exitCode = 1;
    }
  }
}

console.log('====================================================================');
console.log('🛡️  GUARDRAIL APPROVAL ACTION BINDING MODEL TEST SUITE');
console.log('====================================================================');

// =============================================================================
// Suite 1: Valid Binding Creation & Data Invariants
// =============================================================================
console.log('\n▶ Suite 1: Valid Binding Creation & Data Invariants');

{
  const actionId = 'act_payment_transfer_123';
  const requestId = 'apr_transfer_req_456';
  const requesterId = 'usr_alice';
  const createdAt = '2026-10-24T10:00:00.000Z';
  const expiresAt = '2026-10-24T10:15:00.000Z';

  const binding = createApprovalActionBinding({
    actionId,
    requestId,
    requesterId,
    createdAt,
    expiresAt,
  });

  assert(binding.id.startsWith('bnd_'), 'Generated binding ID has canonical bnd_ prefix');
  assertEquals(binding.actionId, actionId, 'Action ID is preserved exactly');
  assertEquals(binding.requestId, requestId, 'Request ID is preserved exactly');
  assertEquals(binding.requesterId, requesterId, 'Requester ID is bound authoritatively');
  assertEquals(binding.state, ApprovalActionBindingState.BOUND, 'Initial state is explicitly BOUND');
  assertEquals(binding.createdAt, createdAt, 'Creation timestamp is recorded');
  assertEquals(binding.expiresAt, expiresAt, 'Expiration timestamp is recorded');
  assertEquals(binding.resolvedAt, undefined, 'Initial binding has undefined resolvedAt');
  assert(Object.isFrozen(binding), 'Created binding entity is deeply immutable (frozen)');
}

{
  // Complete binding with action digest and explanation
  const actionDigest = computeSha256('canonical-action-representation');
  const binding = createApprovalActionBinding({
    actionId: 'act_wire_transfer_789',
    requestId: 'apr_wire_req_999',
    requesterId: 'usr_bob',
    actionDigest,
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:30:00.000Z',
    reason: 'High-value wire transfer gating',
  });

  assertEquals(binding.actionDigest, actionDigest, 'Action digest SHA-256 is recorded');
  assertEquals(binding.reason, 'High-value wire transfer gating', 'Non-sensitive reason recorded');
  const val = validateApprovalActionBinding(binding);
  assert(val.valid, 'Complete binding passes validation with zero errors');
}

// =============================================================================
// Suite 2: Trust Boundary Identifier Validation
// =============================================================================
console.log('\n▶ Suite 2: Trust Boundary Identifier Validation');

{
  // Binding ID
  assert(validateBindingId('bnd_abc123').valid, 'Valid bnd_ ID passes');
  assert(validateBindingId('bnd_f47ac10b-58cc-4372-a567-0e02b2c3d479').valid, 'Valid UUID bnd_ ID passes');
  assert(!validateBindingId('').valid, 'Empty binding ID rejected');
  assert(!validateBindingId(null).valid, 'Null binding ID rejected');
  assert(!validateBindingId('apr_123').valid, 'Binding ID with wrong prefix rejected');
  assert(!validateBindingId('bnd_').valid, 'Empty suffix binding ID rejected');
  assert(!validateBindingId('bnd_' + 'x'.repeat(125)).valid, 'Binding ID exceeding length limit rejected');
  assert(!validateBindingId('bnd_invalid spaces').valid, 'Binding ID with spaces rejected');
  assertThrows(() => assertValidBindingId('invalid_id'), 'ApprovalBindingValidationError', 'assertValidBindingId throws on invalid ID');

  // Action ID
  assert(validateActionId('act_click_button_1').valid, 'Valid act_ ID passes');
  assert(validateActionId('act-legacy-dash-id').valid, 'Valid act- legacy ID passes');
  assert(validateActionId('act_f47ac10b-58cc-4372-a567-0e02b2c3d479').valid, 'Valid UUID act_ ID passes');
  assert(!validateActionId('').valid, 'Empty action ID rejected');
  assert(!validateActionId(undefined).valid, 'Undefined action ID rejected');
  assert(!validateActionId('btn_123').valid, 'Action ID with invalid prefix rejected');
  assert(!validateActionId('act_' + 'a'.repeat(125)).valid, 'Action ID exceeding length limit rejected');
  assert(!validateActionId('act_test;DROP TABLE').valid, 'Action ID with invalid special characters rejected');
  assertThrows(() => assertValidActionId('bad_action'), 'ApprovalBindingValidationError', 'assertValidActionId throws on invalid ID');

  // Request ID
  assert(validateApprovalRequestId('apr_req_123').valid, 'Valid apr_ ID passes');
  assert(!validateApprovalRequestId('act_123').valid, 'Request ID with wrong prefix rejected');
  assert(!validateApprovalRequestId('').valid, 'Empty request ID rejected');

  // Action Digest
  const validHex64 = '48e04c07b2caa20a7f5c144e217d2fbc5d65c215b49dfe18c1a9721b59080cca';
  assert(validateActionDigest(validHex64).valid, '64-character hex digest passes');
  assert(!validateActionDigest('short_hash').valid, 'Short digest rejected');
  assert(!validateActionDigest(validHex64 + '0').valid, '65-character digest rejected');
  assert(!validateActionDigest('zzzz'.repeat(16)).valid, 'Non-hex digest rejected');
}

// =============================================================================
// Suite 3: Missing Required Fields & Malformed Payload Rejection
// =============================================================================
console.log('\n▶ Suite 3: Missing Required Fields & Malformed Payload Rejection');

{
  const validPayload = {
    id: 'bnd_test_1',
    actionId: 'act_test_1',
    requestId: 'apr_test_1',
    requesterId: 'usr_test_1',
    state: ApprovalActionBindingState.BOUND,
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:15:00.000Z',
  };

  assert(validateApprovalActionBinding(validPayload).valid, 'Base valid payload passes');

  // Missing id
  assert(!validateApprovalActionBinding({ ...validPayload, id: undefined }).valid, 'Missing id rejected');

  // Missing actionId
  assert(!validateApprovalActionBinding({ ...validPayload, actionId: '' }).valid, 'Missing actionId rejected');

  // Missing requestId
  assert(!validateApprovalActionBinding({ ...validPayload, requestId: undefined }).valid, 'Missing requestId rejected');

  // Missing requesterId
  assert(!validateApprovalActionBinding({ ...validPayload, requesterId: '' }).valid, 'Missing requesterId rejected');

  // Missing state
  assert(!validateApprovalActionBinding({ ...validPayload, state: 'INVALID_STATE' }).valid, 'Unknown state rejected');

  // Missing createdAt
  assert(!validateApprovalActionBinding({ ...validPayload, createdAt: 'not-a-date' }).valid, 'Malformed createdAt rejected');

  // Missing expiresAt
  assert(!validateApprovalActionBinding({ ...validPayload, expiresAt: undefined }).valid, 'Missing expiresAt rejected');

  // Non-object
  assert(!validateApprovalActionBinding(null).valid, 'Null rejected');
  assert(!validateApprovalActionBinding('string').valid, 'Primitive string rejected');
  assert(!validateApprovalActionBinding([]).valid, 'Array rejected');

  // Unpermitted field injection
  assert(
    !validateApprovalActionBinding({ ...validPayload, unpermittedField: 'injected' }).valid,
    'Unpermitted property rejected'
  );

  assertThrows(
    () => assertValidApprovalActionBinding({ ...validPayload, id: 'bad' }),
    'ApprovalBindingValidationError',
    'assertValidApprovalActionBinding throws ApprovalBindingValidationError'
  );
}

// =============================================================================
// Suite 4: Expiration Metadata & Chronological Timestamp Invariants
// =============================================================================
console.log('\n▶ Suite 4: Expiration Metadata & Chronological Timestamp Invariants');

{
  const base = {
    id: 'bnd_time_1',
    actionId: 'act_time_1',
    requestId: 'apr_time_1',
    requesterId: 'usr_time_1',
    state: ApprovalActionBindingState.BOUND,
  };

  // expiresAt <= createdAt rejected
  const equalTime = validateApprovalActionBinding({
    ...base,
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:00:00.000Z',
  });
  assert(!equalTime.valid, 'expiresAt equal to createdAt is strictly rejected');

  const priorExpires = validateApprovalActionBinding({
    ...base,
    createdAt: '2026-10-24T10:15:00.000Z',
    expiresAt: '2026-10-24T10:00:00.000Z',
  });
  assert(!priorExpires.valid, 'expiresAt preceding createdAt is strictly rejected');

  // resolvedAt preceding createdAt rejected
  const priorResolved = validateApprovalActionBinding({
    ...base,
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:15:00.000Z',
    state: ApprovalActionBindingState.APPROVED,
    resolvedAt: '2026-10-24T09:59:00.000Z',
  });
  assert(!priorResolved.valid, 'resolvedAt preceding createdAt is strictly rejected');

  // isBindingExpired evaluation
  const binding = createApprovalActionBinding({
    actionId: 'act_exp_1',
    requestId: 'apr_exp_1',
    requesterId: 'usr_exp_1',
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:15:00.000Z',
  });

  const beforeExpiry: TimeProvider = () => new Date('2026-10-24T10:14:59.000Z');
  const atExpiry: TimeProvider = () => new Date('2026-10-24T10:15:00.000Z');
  const afterExpiry: TimeProvider = () => new Date('2026-10-24T10:15:01.000Z');

  assertEquals(isBindingExpired(binding, beforeExpiry), false, 'Binding is not expired before deadline');
  assertEquals(isBindingExpired(binding, atExpiry), true, 'Binding is expired at exact deadline');
  assertEquals(isBindingExpired(binding, afterExpiry), true, 'Binding is expired after deadline');
}

// =============================================================================
// Suite 5: Explicit Lifecycle State Machine Transitions
// =============================================================================
console.log('\n▶ Suite 5: Explicit Lifecycle State Machine Transitions');

{
  const initial = createApprovalActionBinding({
    actionId: 'act_life_1',
    requestId: 'apr_life_1',
    requesterId: 'usr_life_1',
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:15:00.000Z',
  });

  assertEquals(isTerminalBindingState(initial.state), false, 'BOUND is not a terminal state');

  // BOUND -> APPROVED
  const approved = transitionBindingState(initial, ApprovalActionBindingState.APPROVED, {
    resolvedAt: '2026-10-24T10:05:00.000Z',
    reason: 'Approved by trusted contact',
  });
  assertEquals(approved.state, ApprovalActionBindingState.APPROVED, 'Transitioned to APPROVED');
  assertEquals(approved.resolvedAt, '2026-10-24T10:05:00.000Z', 'Resolution timestamp recorded');
  assertEquals(isTerminalBindingState(approved.state), true, 'APPROVED is a terminal state');

  // BOUND -> REJECTED
  const rejected = transitionBindingState(initial, ApprovalActionBindingState.REJECTED, {
    resolvedAt: '2026-10-24T10:06:00.000Z',
  });
  assertEquals(rejected.state, ApprovalActionBindingState.REJECTED, 'Transitioned to REJECTED');
  assertEquals(isTerminalBindingState(rejected.state), true, 'REJECTED is a terminal state');

  // BOUND -> EXPIRED
  const expired = transitionBindingState(initial, ApprovalActionBindingState.EXPIRED, {
    resolvedAt: '2026-10-24T10:15:00.000Z',
  });
  assertEquals(expired.state, ApprovalActionBindingState.EXPIRED, 'Transitioned to EXPIRED');
  assertEquals(isTerminalBindingState(expired.state), true, 'EXPIRED is a terminal state');

  // BOUND -> CANCELLED
  const cancelled = transitionBindingState(initial, ApprovalActionBindingState.CANCELLED, {
    resolvedAt: '2026-10-24T10:02:00.000Z',
    reason: 'User cancelled in Staging Mode',
  });
  assertEquals(cancelled.state, ApprovalActionBindingState.CANCELLED, 'Transitioned to CANCELLED');
  assertEquals(isTerminalBindingState(cancelled.state), true, 'CANCELLED is a terminal state');

  // BOUND -> INVALIDATED
  const invalidated = transitionBindingState(initial, ApprovalActionBindingState.INVALIDATED, {
    resolvedAt: '2026-10-24T10:03:00.000Z',
    reason: 'Page navigated before review completed',
  });
  assertEquals(invalidated.state, ApprovalActionBindingState.INVALIDATED, 'Transitioned to INVALIDATED');
  assertEquals(isTerminalBindingState(invalidated.state), true, 'INVALIDATED is a terminal state');

  // Terminal state immutability: transitions from terminal states must throw
  assertThrows(
    () => transitionBindingState(approved, ApprovalActionBindingState.REJECTED),
    'ApprovalBindingStateTransitionError',
    'Cannot transition from APPROVED to REJECTED'
  );
  assertThrows(
    () => transitionBindingState(rejected, ApprovalActionBindingState.APPROVED),
    'ApprovalBindingStateTransitionError',
    'Cannot transition from REJECTED to APPROVED'
  );
  assertThrows(
    () => transitionBindingState(expired, ApprovalActionBindingState.BOUND),
    'ApprovalBindingStateTransitionError',
    'Cannot transition from EXPIRED back to BOUND'
  );
  assertThrows(
    () => transitionBindingState(cancelled, ApprovalActionBindingState.APPROVED),
    'ApprovalBindingStateTransitionError',
    'Cannot transition from CANCELLED to APPROVED'
  );
  assertThrows(
    () => transitionBindingState(invalidated, ApprovalActionBindingState.BOUND),
    'ApprovalBindingStateTransitionError',
    'Cannot transition from INVALIDATED to BOUND'
  );

  // Transitions matrix checks
  assert(!isValidBindingTransition(ApprovalActionBindingState.APPROVED, ApprovalActionBindingState.APPROVED), 'No self-transition on terminal state');
  assert(!isValidBindingTransition(ApprovalActionBindingState.BOUND, ApprovalActionBindingState.BOUND), 'No self-transition on BOUND');
}

// =============================================================================
// Suite 6: Anti-Reassignment Safeguards & 1:1 Enforcement
// =============================================================================
console.log('\n▶ Suite 6: Anti-Reassignment Safeguards & 1:1 Enforcement');

{
  const bindingA = createApprovalActionBinding({
    actionId: 'act_original_100',
    requestId: 'apr_original_200',
    requesterId: 'usr_alice',
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:15:00.000Z',
  });

  // Guard assertion: Reassigning existing request to a different action
  assertThrows(
    () => assertNoBindingReassignment(bindingA, 'act_different_999', 'apr_original_200'),
    'ApprovalBindingReassignmentError',
    'assertNoBindingReassignment throws when attempting to reassign request to different action'
  );

  // Guard assertion: Binding conflicting request to an active action
  assertThrows(
    () => assertNoBindingReassignment(bindingA, 'act_original_100', 'apr_different_888'),
    'ApprovalBindingConflictError',
    'assertNoBindingReassignment throws when attempting to bind second active request to same action'
  );

  // Repository-level enforcement
  const repo = new DevelopmentInMemoryApprovalRequestRepository();

  // Save binding A
  repo.saveBinding(bindingA);
  assertEquals(repo.countBindings(), 1, 'Binding saved to repository');
  assertEquals(repo.findBindingById(bindingA.id)?.actionId, 'act_original_100', 'Found by binding ID');
  assertEquals(repo.findBindingByRequestId('apr_original_200')?.id, bindingA.id, 'Found by request ID');
  assertEquals(repo.findBindingByActionId('act_original_100')?.id, bindingA.id, 'Found by action ID');

  // Attempt to save another binding for apr_original_200 with different actionId
  const conflictingRequestBinding = createApprovalActionBinding({
    actionId: 'act_hijacked_300',
    requestId: 'apr_original_200',
    requesterId: 'usr_alice',
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:15:00.000Z',
  });

  assertThrows(
    () => repo.saveBinding(conflictingRequestBinding),
    'ApprovalBindingReassignmentError',
    'Repository.saveBinding prohibits reassigning existing request to new action'
  );

  // Attempt to bind another active request to the same active action
  const conflictingActionBinding = createApprovalActionBinding({
    actionId: 'act_original_100',
    requestId: 'apr_conflicting_400',
    requesterId: 'usr_alice',
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:15:00.000Z',
  });

  assertThrows(
    () => repo.saveBinding(conflictingActionBinding),
    'ApprovalBindingConflictError',
    'Repository.saveBinding prohibits binding second active request to same action'
  );

  // Attempt to save an ApprovalRequest that reassigns actionId
  const requestA = createApprovalRequest(
    {
      actionId: 'act_original_100',
      actionDescription: 'Original Transfer',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.HIGH,
      origin: 'https://bank.example.com',
      hostname: 'bank.example.com',
    },
    'usr_alice',
    { id: 'apr_original_200' }
  );
  repo.save(requestA);

  const reassignedRequest = createApprovalRequest(
    {
      actionId: 'act_reassigned_999',
      actionDescription: 'Reassigned Action',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.HIGH,
      origin: 'https://bank.example.com',
      hostname: 'bank.example.com',
    },
    'usr_alice',
    { id: 'apr_original_200' }
  );

  assertThrows(
    () => repo.save(reassignedRequest),
    'ApprovalBindingReassignmentError',
    'Repository.save(request) prohibits reassigning request to different actionId'
  );

  // Atomic transition prevents actionId reassignment
  const tamperedRequest = { ...requestA, actionId: 'act_tampered_666' };
  assertThrows(
    () => repo.atomicTransition('apr_original_200', ApprovalStatus.PENDING, tamperedRequest as ApprovalRequest),
    'ApprovalBindingReassignmentError',
    'Repository.atomicTransition prohibits changing actionId'
  );

  // Atomic binding transition prevents actionId reassignment
  const tamperedBinding = { ...bindingA, actionId: 'act_tampered_777' };
  assertThrows(
    () =>
      repo.atomicTransitionBinding(
        bindingA.id,
        ApprovalActionBindingState.BOUND,
        tamperedBinding as ApprovalActionBinding
      ),
    'ApprovalBindingReassignmentError',
    'Repository.atomicTransitionBinding prohibits changing actionId'
  );

  // Clearing repository cleans up all bindings
  repo.clear();
  assertEquals(repo.countBindings(), 0, 'Repository.clear removes all bindings');
  assertEquals(repo.findBindingById(bindingA.id), undefined, 'Bindings map cleared');
  assertEquals(repo.findBindingByRequestId('apr_original_200'), undefined, 'RequestId index cleared');
  assertEquals(repo.findBindingByActionId('act_original_100'), undefined, 'ActionId index cleared');
}

// =============================================================================
// Suite 7: Strict Privacy & Sensitive Data Exclusion
// =============================================================================
console.log('\n▶ Suite 7: Strict Privacy & Sensitive Data Exclusion');

{
  const validBase = {
    id: 'bnd_priv_1',
    actionId: 'act_priv_1',
    requestId: 'apr_priv_1',
    requesterId: 'usr_priv_1',
    state: ApprovalActionBindingState.BOUND,
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:15:00.000Z',
  };

  const forbiddenKeys = [
    'password',
    'passphrase',
    'otp',
    'pin',
    'cvv',
    'cardNumber',
    'creditCard',
    'authToken',
    'cookie',
    'formData',
    'formValue',
    'rawHtml',
    'privateKey',
  ];

  for (const forbidden of forbiddenKeys) {
    const payload = { ...validBase, [forbidden]: 'sensitive-value-here' };
    const res = validateApprovalActionBinding(payload);
    assert(!res.valid, `Sensitive key "${forbidden}" is strictly rejected`);
    assert(
      res.errors.some((e) => e.includes('Forbidden property') || e.includes('Unpermitted property')),
      `Diagnostic error recorded for sensitive key "${forbidden}"`
    );
  }

  // Action Fingerprint Descriptor & Digest: Non-sensitive structural metadata only
  const safeDescriptor: ActionFingerprintDescriptor = {
    origin: 'https://bank.example.com',
    pathname: '/transfer/confirm',
    actionType: ActionType.CLICK,
    targetTagName: 'BUTTON',
    targetId: 'submit-transfer-btn',
    targetName: 'confirmBtn',
    formAction: '/api/v1/transfers',
    formMethod: 'POST',
    formFieldKeys: ['recipientId', 'amount', 'currency'],
    actionLabel: 'Confirm Transfer',
  };

  const digest1 = computeActionDigest(safeDescriptor);
  assert(validateActionDigest(digest1).valid, 'Computed digest is a valid 64-char hex SHA-256 string');

  // Determinism: Same descriptor yields identical digest
  const digest2 = computeActionDigest({
    ...safeDescriptor,
    formFieldKeys: ['currency', 'amount', 'recipientId'], // Unordered keys normalized
  });
  assertEquals(digest1, digest2, 'computeActionDigest is order-independent for field keys');

  // Tamper detection: Modifying structural attributes changes digest
  const tamperedAction = computeActionDigest({
    ...safeDescriptor,
    formAction: '/api/v1/evil-endpoint',
  });
  assert(digest1 !== tamperedAction, 'Digest detects altered formAction endpoint');

  const tamperedTag = computeActionDigest({
    ...safeDescriptor,
    targetTagName: 'A',
  });
  assert(digest1 !== tamperedTag, 'Digest detects altered targetTagName');

  // Sensitive keys inside descriptor rejected
  const sensitiveDescriptor = {
    ...safeDescriptor,
    password: 'super-secret-password',
  } as unknown as ActionFingerprintDescriptor;

  assertThrows(
    () => computeActionDigest(sensitiveDescriptor),
    'ApprovalBindingValidationError',
    'computeActionDigest rejects descriptors with unpermitted sensitive keys'
  );
}

// =============================================================================
// Suite 8: Zero Client Trust & ApprovalService Integration
// =============================================================================
console.log('\n▶ Suite 8: Zero Client Trust & ApprovalService Integration');

{
  const repo = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();

  const service = new ApprovalService({
    repository: repo,
    contactRegistry,
    actionOwnershipRegistry,
    timeProvider: () => new Date('2026-10-24T10:00:00.000Z'),
  });

  const wardUser: AuthContext = {
    actorId: 'usr_ward_alice',
    role: ActorRole.WARD,
    isAuthenticated: true,
  };

  const trustedContact: AuthContext = {
    actorId: 'tc_bob',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  };

  const unauthenticatedCaller: AuthContext = {
    actorId: '',
    role: ActorRole.WARD,
    isAuthenticated: false,
  };

  const unrelatedUser: AuthContext = {
    actorId: 'usr_charlie',
    role: ActorRole.WARD,
    isAuthenticated: true,
  };

  contactRegistry.addContact({
    id: 'tc_bob',
    userId: 'usr_ward_alice',
    status: TrustedContactStatus.ACTIVE,
  });
  actionOwnershipRegistry.registerActionOwnership('act_checkout_123', 'usr_ward_alice');

  // 1. Unauthenticated creation rejected
  assertThrows(
    () =>
      service.createRequest(
        {
          actionId: 'act_checkout_123',
          actionDescription: 'Checkout Transfer',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          origin: 'https://shop.example.com',
          hostname: 'shop.example.com',
        },
        unauthenticatedCaller
      ),
    'UnauthenticatedError',
    'Unauthenticated caller cannot create approval request or binding'
  );

  // 2. Caller attempting to claim action not owned by them rejected
  assertThrows(
    () =>
      service.createRequest(
        {
          actionId: 'act_checkout_123',
          actionDescription: 'Checkout Transfer',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          origin: 'https://shop.example.com',
          hostname: 'shop.example.com',
        },
        unrelatedUser
      ),
    'UnauthorizedActionRequesterError',
    'Caller cannot supply an action ID owned by another user'
  );

  // 3. Authorized request & binding creation
  const createdRequest = service.createRequest(
    {
      actionId: 'act_checkout_123',
      actionDescription: 'Checkout Transfer',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.HIGH,
      origin: 'https://shop.example.com',
      hostname: 'shop.example.com',
    },
    wardUser
  );

  assertEquals(createdRequest.status, ApprovalStatus.PENDING, 'Request created in PENDING state');
  assert(Boolean(createdRequest.bindingId), 'Created request contains bindingId');

  const boundBinding = service.getBindingByRequestId(createdRequest.id, wardUser);
  assertEquals(boundBinding.id, createdRequest.bindingId, 'Binding retrieved by requestId matches request.bindingId');
  assertEquals(boundBinding.actionId, 'act_checkout_123', 'Binding matches actionId');
  assertEquals(boundBinding.requestId, createdRequest.id, 'Binding matches requestId');
  assertEquals(boundBinding.requesterId, 'usr_ward_alice', 'Requester identity derived authoritatively from session');
  assertEquals(boundBinding.state, ApprovalActionBindingState.BOUND, 'Binding state is BOUND');

  // 4. Multi-tenant privacy: unrelated caller cannot inspect binding
  assertThrows(
    () => service.getBindingByRequestId(createdRequest.id, unrelatedUser),
    'ApprovalAccessDeniedError',
    'Unrelated user receives access denied on getBindingByRequestId'
  );
  assertThrows(
    () => service.getBindingByActionId('act_checkout_123', unrelatedUser),
    'ApprovalAccessDeniedError',
    'Unrelated user receives access denied on getBindingByActionId'
  );

  // Trusted contact can inspect binding
  const contactBinding = service.getBindingByRequestId(createdRequest.id, trustedContact);
  assertEquals(contactBinding.id, boundBinding.id, 'Authorized trusted contact can inspect binding');

  // 5. Decision workflow: Approval synchronizes binding to APPROVED
  service.setTimeProvider(() => new Date('2026-10-24T10:05:00.000Z'));
  const approvedReq = service.approveRequest(
    createdRequest.id,
    { decisionReason: 'Authorized by parent' },
    trustedContact
  );
  assertEquals(approvedReq.status, ApprovalStatus.APPROVED, 'Request transitioned to APPROVED');

  const approvedBinding = service.getBindingByRequestId(createdRequest.id, wardUser);
  assertEquals(approvedBinding.state, ApprovalActionBindingState.APPROVED, 'Binding state synchronized to APPROVED');
  assertEquals(approvedBinding.resolvedAt, '2026-10-24T10:05:00.000Z', 'Binding records resolvedAt matching decision');
  assertEquals(approvedBinding.reason, 'Authorized by parent', 'Binding records decisionReason');

  // 6. Cancellation workflow
  actionOwnershipRegistry.registerActionOwnership('act_cancel_test', 'usr_ward_alice');
  const cancelReq = service.createRequest(
    {
      actionId: 'act_cancel_test',
      actionDescription: 'Cancel Test Action',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.MEDIUM,
      origin: 'https://shop.example.com',
      hostname: 'shop.example.com',
    },
    wardUser
  );

  service.setTimeProvider(() => new Date('2026-10-24T10:07:00.000Z'));
  service.cancelRequest(cancelReq.id, 'User clicked Cancel in Staging Mode', wardUser);

  const cancelledBinding = service.getBindingByRequestId(cancelReq.id, wardUser);
  assertEquals(cancelledBinding.state, ApprovalActionBindingState.CANCELLED, 'Binding state synchronized to CANCELLED');
  assertEquals(cancelledBinding.resolvedAt, '2026-10-24T10:07:00.000Z', 'Binding records cancellation resolvedAt');

  // 7. Expiration workflow
  actionOwnershipRegistry.registerActionOwnership('act_expire_test', 'usr_ward_alice');
  const expReq = service.createRequest(
    {
      actionId: 'act_expire_test',
      actionDescription: 'Expire Test Action',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.MEDIUM,
      origin: 'https://shop.example.com',
      hostname: 'shop.example.com',
    },
    wardUser,
    { ttlMs: 10 * 60 * 1000 } // 10 min TTL (expires at 10:17:00)
  );

  // Fast-forward past TTL
  service.setTimeProvider(() => new Date('2026-10-24T10:20:00.000Z'));
  service.checkAndExpireStaleRequests();

  const expiredBinding = service.getBindingByRequestId(expReq.id, wardUser);
  assertEquals(expiredBinding.state, ApprovalActionBindingState.EXPIRED, 'Binding state synchronized to EXPIRED');

  // 8. Invalidation workflow (e.g. DOM drift or navigation)
  actionOwnershipRegistry.registerActionOwnership('act_inval_test', 'usr_ward_alice');
  service.setTimeProvider(() => new Date('2026-10-24T10:22:00.000Z'));
  const invalReq = service.createRequest(
    {
      actionId: 'act_inval_test',
      actionDescription: 'Invalidation Test Action',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.MEDIUM,
      origin: 'https://shop.example.com',
      hostname: 'shop.example.com',
    },
    wardUser
  );

  const invalidatedBinding = service.invalidateBinding(
    'act_inval_test',
    'Page refreshed before review completed',
    wardUser
  );
  assertEquals(invalidatedBinding.state, ApprovalActionBindingState.INVALIDATED, 'Binding explicitly INVALIDATED');
  assertEquals(invalidatedBinding.reason, 'Page refreshed before review completed', 'Reason recorded');
}

// =============================================================================
// Suite 9: Persistence Classification Audit
// =============================================================================
console.log('\n▶ Suite 9: Persistence Classification Audit');

{
  assertEquals(
    PERSISTENCE_METADATA.TYPE,
    'EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY',
    'PERSISTENCE_METADATA type declares EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY'
  );
  assertEquals(
    PERSISTENCE_METADATA.IS_PRODUCTION,
    false,
    'PERSISTENCE_METADATA confirms repository is not production persistence'
  );
  assertEquals(
    DevelopmentInMemoryApprovalRequestRepository.IS_PRODUCTION_PERSISTENCE,
    false,
    'DevelopmentInMemoryApprovalRequestRepository explicitly flags non-production persistence'
  );
}

// =============================================================================
// Test Summary
// =============================================================================
console.log('\n====================================================================');
console.log(`📊 APPROVAL ACTION BINDING TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
if (passedTests === totalTests && (process.exitCode === undefined || process.exitCode === 0)) {
  console.log('🎉 ALL ACTION-APPROVAL BINDING SECURITY INVARIANTS SATISFIED!');
  console.log('====================================================================');
} else {
  console.error(`💥 FAILURES DETECTED: ${totalTests - passedTests} failed.`);
  console.log('====================================================================');
  process.exit(1);
}
