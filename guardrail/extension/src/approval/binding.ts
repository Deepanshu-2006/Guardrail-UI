/**
 * Guardrail Approval Action Binding Model, State Machine & Validation Engine
 *
 * Implements the strongly typed, immutable 1:1 relationship between an intercepted
 * protected browser action and its corresponding backend approval request.
 *
 * ARCHITECTURAL RESPONSIBILITIES & INVARIANTS:
 * 1. STRICT 1:1 CARDINALITY:
 *    - Each intercepted browser action is associated with exactly one approval request.
 *    - Each approval request is bound to exactly one intercepted action.
 *    - Reassignment of an existing request to a different action, or re-binding an action
 *      to a conflicting request while active, is strictly prohibited and throws explicit domain errors.
 * 2. ZERO-TRUST AUTHORIZATION:
 *    - Client-supplied action IDs cannot authorize an action or grant approval status.
 *    - Requester identity is bound authoritatively from server-verified authentication context.
 * 3. STRICT PRIVACY & LEAST PRIVILEGE:
 *    - The binding record and action fingerprint strictly exclude sensitive form data,
 *      passwords, OTPs, PINs, card numbers, cookies, auth tokens, and raw DOM trees.
 *    - Action digests are deterministic SHA-256 hashes of non-sensitive structural attributes only.
 * 4. DETERMINISTIC STATE MACHINE:
 *    - States: BOUND -> [APPROVED, REJECTED, EXPIRED, CANCELLED, INVALIDATED]
 *    - Terminal states cannot transition further; all entities are frozen records.
 * 5. PERSISTENCE CLASSIFICATION:
 *    - EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY: In the current development architecture,
 *      bindings are managed in-memory and do NOT survive process or extension restarts.
 */

import type {
  ActionFingerprintDescriptor,
  ApprovalActionBinding,
  ApprovalActionBindingStateString,
  ApprovalValidationResult,
  CreateApprovalActionBindingInput,
} from '../types/approval.js';
import { ApprovalActionBindingState } from '../types/approval.js';
import { generateActionId } from '../utils/metadata.js';
import {
  defaultTimeProvider,
  findForbiddenProperties,
  isIso8601Timestamp,
  resolveTimestamp,
  TimeProvider,
  validateActionId,
  validateApprovalRequestId,
} from './model.js';

// Re-export core types for single-point import
export { ApprovalActionBindingState, validateActionId };
export type {
  ActionFingerprintDescriptor,
  ApprovalActionBinding,
  ApprovalActionBindingStateString,
  CreateApprovalActionBindingInput,
};

// =============================================================================
// Security Constants & Whitelists
// =============================================================================

/**
 * Whitelist of permitted top-level property names for ApprovalActionBinding.
 * Any property outside this list is strictly rejected to guarantee minimal scope.
 */
export const PERMITTED_BINDING_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'actionId',
  'requestId',
  'requesterId',
  'state',
  'actionDigest',
  'createdAt',
  'expiresAt',
  'resolvedAt',
  'reason',
]);

/**
 * Whitelist of permitted property names for ActionFingerprintDescriptor.
 * Any property outside this list is rejected to guarantee zero credential/form value leakage.
 */
export const PERMITTED_FINGERPRINT_FIELDS: ReadonlySet<string> = new Set([
  'origin',
  'pathname',
  'actionType',
  'targetTagName',
  'targetId',
  'targetName',
  'formAction',
  'formMethod',
  'formFieldKeys',
  'actionLabel',
]);

// =============================================================================
// State Machine Transitions
// =============================================================================

/**
 * Declarative state transition matrix for ApprovalActionBindingState.
 *
 * Transitions:
 * - BOUND       -> [APPROVED, REJECTED, EXPIRED, CANCELLED, INVALIDATED]
 * - APPROVED    -> [] (Terminal)
 * - REJECTED    -> [] (Terminal)
 * - EXPIRED     -> [] (Terminal)
 * - CANCELLED   -> [] (Terminal)
 * - INVALIDATED -> [] (Terminal)
 */
export const VALID_BINDING_TRANSITIONS: Readonly<
  Record<ApprovalActionBindingState, readonly ApprovalActionBindingState[]>
> = Object.freeze({
  [ApprovalActionBindingState.BOUND]: Object.freeze([
    ApprovalActionBindingState.APPROVED,
    ApprovalActionBindingState.REJECTED,
    ApprovalActionBindingState.EXPIRED,
    ApprovalActionBindingState.CANCELLED,
    ApprovalActionBindingState.INVALIDATED,
  ]),
  [ApprovalActionBindingState.APPROVED]: Object.freeze([]),
  [ApprovalActionBindingState.REJECTED]: Object.freeze([]),
  [ApprovalActionBindingState.EXPIRED]: Object.freeze([]),
  [ApprovalActionBindingState.CANCELLED]: Object.freeze([]),
  [ApprovalActionBindingState.INVALIDATED]: Object.freeze([]),
});

/**
 * Checks whether an ApprovalActionBindingState is terminal (no further transitions permitted).
 */
export function isTerminalBindingState(state: ApprovalActionBindingState): boolean {
  return (
    state === ApprovalActionBindingState.APPROVED ||
    state === ApprovalActionBindingState.REJECTED ||
    state === ApprovalActionBindingState.EXPIRED ||
    state === ApprovalActionBindingState.CANCELLED ||
    state === ApprovalActionBindingState.INVALIDATED
  );
}

/**
 * Validates whether transitioning from `currentState` to `targetState` is permissible.
 */
export function isValidBindingTransition(
  currentState: ApprovalActionBindingState,
  targetState: ApprovalActionBindingState
): boolean {
  const allowed = VALID_BINDING_TRANSITIONS[currentState];
  return Boolean(allowed && allowed.includes(targetState));
}

// =============================================================================
// Domain Error Classes
// =============================================================================

/**
 * Error thrown when binding validation invariants are violated.
 */
export class ApprovalBindingValidationError extends Error {
  public readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`ApprovalActionBinding validation failed: ${errors.join('; ')}`);
    this.name = 'ApprovalBindingValidationError';
    this.errors = Object.freeze([...errors]);
  }
}

/**
 * Error thrown when an invalid lifecycle state transition is attempted on a binding.
 */
export class ApprovalBindingStateTransitionError extends Error {
  public readonly bindingId: string;
  public readonly currentState: ApprovalActionBindingState;
  public readonly targetState: ApprovalActionBindingState;

  constructor(
    bindingId: string,
    currentState: ApprovalActionBindingState,
    targetState: ApprovalActionBindingState
  ) {
    super(
      `Invalid binding transition on "${bindingId}": cannot transition from ${currentState} to ${targetState}.`
    );
    this.name = 'ApprovalBindingStateTransitionError';
    this.bindingId = bindingId;
    this.currentState = currentState;
    this.targetState = targetState;
  }
}

/**
 * Error thrown when an attempt is made to reassign an approval request to a different action ID,
 * or vice versa, violating the immutable 1:1 relationship requirement.
 */
export class ApprovalBindingReassignmentError extends Error {
  public readonly requestId: string;
  public readonly boundActionId: string;
  public readonly attemptedActionId: string;

  constructor(requestId: string, boundActionId: string, attemptedActionId: string) {
    super(
      `Reassignment prohibited: Approval request "${requestId}" is already bound to action "${boundActionId}". Cannot reassign to action "${attemptedActionId}".`
    );
    this.name = 'ApprovalBindingReassignmentError';
    this.requestId = requestId;
    this.boundActionId = boundActionId;
    this.attemptedActionId = attemptedActionId;
  }
}

/**
 * Error thrown when an active binding already exists for an action with a different request ID.
 */
export class ApprovalBindingConflictError extends Error {
  public readonly actionId: string;
  public readonly existingRequestId: string;
  public readonly attemptedRequestId: string;

  constructor(actionId: string, existingRequestId: string, attemptedRequestId: string) {
    super(
      `Binding conflict: Action "${actionId}" is already bound to active request "${existingRequestId}". Cannot bind to second request "${attemptedRequestId}".`
    );
    this.name = 'ApprovalBindingConflictError';
    this.actionId = actionId;
    this.existingRequestId = existingRequestId;
    this.attemptedRequestId = attemptedRequestId;
  }
}

/**
 * Error thrown when an expected binding record is not found.
 */
export class ApprovalBindingNotFoundError extends Error {
  public readonly identifier: string;

  constructor(identifier: string) {
    super(`Approval action binding not found for identifier "${identifier}".`);
    this.name = 'ApprovalBindingNotFoundError';
    this.identifier = identifier;
  }
}

// =============================================================================
// Identifier Generators & Validators
// =============================================================================

/**
 * Generates a unique, collision-resistant binding identifier prefixed with 'bnd_'.
 * Uses the project's established ID generation utility.
 */
export function generateActionBindingId(prefix: string = 'bnd'): string {
  return generateActionId(prefix);
}

// validateActionId is canonically defined in model.ts and re-exported above.

/**
 * Asserts that a value is a valid canonical action ID, throwing ApprovalBindingValidationError if not.
 */
export function assertValidActionId(id: unknown): asserts id is string {
  const result = validateActionId(id);
  if (!result.valid) {
    throw new ApprovalBindingValidationError(result.errors);
  }
}

/**
 * Validates a canonical binding identifier format ('bnd_...').
 */
export function validateBindingId(id: unknown): ApprovalValidationResult {
  const errors: string[] = [];

  if (typeof id !== 'string' || !id.trim()) {
    errors.push('Binding ID is required and must be a non-empty string.');
    return { valid: false, errors: Object.freeze(errors) };
  }

  const trimmed = id.trim();

  if (!trimmed.startsWith('bnd_')) {
    errors.push(`Field "id" must be prefixed with "bnd_" (received "${trimmed}").`);
  }

  if (!/^bnd_[a-zA-Z0-9_-]{1,124}$/.test(trimmed)) {
    errors.push(
      `Field "id" format is invalid ("${trimmed}"). Expected canonical format: "bnd_" followed by alphanumeric characters, underscores, or hyphens (up to 128 characters total).`
    );
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

/**
 * Asserts that a value is a valid canonical binding ID, throwing ApprovalBindingValidationError if not.
 */
export function assertValidBindingId(id: unknown): asserts id is string {
  const result = validateBindingId(id);
  if (!result.valid) {
    throw new ApprovalBindingValidationError(result.errors);
  }
}

/**
 * Validates an action digest string (64-character lowercase hex SHA-256).
 */
export function validateActionDigest(digest: unknown): ApprovalValidationResult {
  const errors: string[] = [];

  if (typeof digest !== 'string' || !digest.trim()) {
    errors.push('Action digest must be a non-empty string.');
    return { valid: false, errors: Object.freeze(errors) };
  }

  const trimmed = digest.trim();
  if (!/^[a-f0-9]{64}$/i.test(trimmed)) {
    errors.push(
      `Action digest must be a 64-character hexadecimal SHA-256 string (received "${trimmed}").`
    );
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

// =============================================================================
// Deterministic SHA-256 Action Digest Engine (Pure JS, Cross-Platform)
// =============================================================================

/**
 * Computes standard SHA-256 hash of a string using synchronous bitwise operations.
 * Works uniformly in Node.js, Service Workers, Content Scripts, and Browsers with zero dependencies.
 */
export function computeSha256(str: string): string {
  let bytes: Uint8Array;
  if (typeof TextEncoder !== 'undefined') {
    bytes = new TextEncoder().encode(str);
  } else {
    const utf8 = unescape(encodeURIComponent(str));
    bytes = new Uint8Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) {
      bytes[i] = utf8.charCodeAt(i);
    }
  }

  const bitLen = bytes.length * 8;
  const wordCount = (((bytes.length + 8) >> 6) + 1) * 16;
  const words = new Int32Array(wordCount);

  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= (bytes[i] & 0xff) << (24 - (i % 4) * 8);
  }
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
  words[wordCount - 1] = bitLen;
  words[wordCount - 2] = (bitLen / 0x100000000) | 0;

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Int32Array(64);
  const ror = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) {
      w[t] = words[i + t];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = ror(w[t - 15], 7) ^ ror(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = ror(w[t - 2], 17) ^ ror(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const toHex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  return (
    toHex(h0) +
    toHex(h1) +
    toHex(h2) +
    toHex(h3) +
    toHex(h4) +
    toHex(h5) +
    toHex(h6) +
    toHex(h7)
  );
}

/**
 * Computes a deterministic SHA-256 digest of non-sensitive structural action attributes.
 *
 * CANONICAL NORMALIZATION RULES:
 * 1. Strictly strips any sensitive properties or form input values.
 * 2. Form field keys are sorted alphabetically.
 * 3. Origin and tag names are normalized to standard case.
 */
export function computeActionDigest(descriptor: ActionFingerprintDescriptor): string {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new ApprovalBindingValidationError([
      'ActionFingerprintDescriptor must be a non-null object.',
    ]);
  }

  // Verify no unpermitted fields on fingerprint descriptor
  for (const key of Object.keys(descriptor)) {
    if (!PERMITTED_FINGERPRINT_FIELDS.has(key)) {
      throw new ApprovalBindingValidationError([
        `Unpermitted property "${key}" in ActionFingerprintDescriptor. Only structural metadata is permitted.`,
      ]);
    }
  }

  // Verify no sensitive keys or forbidden patterns
  const forbidden = findForbiddenProperties(descriptor as unknown as Record<string, unknown>);
  if (forbidden.length > 0) {
    throw new ApprovalBindingValidationError([
      `Forbidden properties in ActionFingerprintDescriptor: ${forbidden.join(', ')}`,
    ]);
  }

  // Canonical string serialization with sorted keys
  const sortedFieldKeys = descriptor.formFieldKeys
    ? [...descriptor.formFieldKeys].sort().join(',')
    : '';

  const canonicalString = [
    `origin:${(descriptor.origin || '').toLowerCase().trim()}`,
    `pathname:${(descriptor.pathname || '').trim()}`,
    `type:${descriptor.actionType}`,
    `tag:${(descriptor.targetTagName || '').toUpperCase().trim()}`,
    `id:${(descriptor.targetId || '').trim()}`,
    `name:${(descriptor.targetName || '').trim()}`,
    `formAction:${(descriptor.formAction || '').trim()}`,
    `formMethod:${(descriptor.formMethod || '').toUpperCase().trim()}`,
    `fieldKeys:${sortedFieldKeys}`,
    `label:${(descriptor.actionLabel || '').trim()}`,
  ].join('|');

  return computeSha256(canonicalString);
}

// =============================================================================
// Binding Validation Engine
// =============================================================================

/**
 * Validates an unknown data payload against the complete ApprovalActionBinding data contract.
 *
 * ENFORCES:
 * 1. Strict property whitelist (rejects extra/unexpected properties).
 * 2. Privacy enforcement (rejects passwords, OTPs, PINs, cards, form data).
 * 3. Canonical identifier formats for id ('bnd_'), actionId ('act_'), requestId ('apr_').
 * 4. Authoritative requesterId format ('usr_...' or valid non-empty string).
 * 5. Explicit lifecycle state (BOUND, APPROVED, REJECTED, EXPIRED, CANCELLED, INVALIDATED).
 * 6. Timestamp consistency: createdAt and expiresAt must be valid ISO 8601 strings; expiresAt > createdAt.
 * 7. Terminal timestamp consistency: resolvedAt (if present) >= createdAt.
 * 8. Optional actionDigest must be a 64-character hex string.
 */
export function validateApprovalActionBinding(data: unknown): ApprovalValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      valid: false,
      errors: ['ApprovalActionBinding payload must be a non-null object.'],
    };
  }

  const rec = data as Record<string, unknown>;

  // 1. Whitelist check
  for (const key of Object.keys(rec)) {
    if (!PERMITTED_BINDING_FIELDS.has(key)) {
      errors.push(
        `Unpermitted property "${key}" in ApprovalActionBinding. The model must remain minimal and strictly typed.`
      );
    }
  }

  // 2. Privacy enforcement
  const forbidden = findForbiddenProperties(rec);
  for (const violation of forbidden) {
    errors.push(
      `Forbidden property "${violation}" violates privacy and security constraints (passwords, OTPs, tokens, cards, and form values are strictly prohibited).`
    );
  }

  // 3. ID Validation
  const idValidation = validateBindingId(rec.id);
  if (!idValidation.valid) {
    errors.push(...idValidation.errors);
  }

  // 4. Action ID Validation
  const actionIdValidation = validateActionId(rec.actionId);
  if (!actionIdValidation.valid) {
    errors.push(...actionIdValidation.errors);
  }

  // 5. Request ID Validation
  const requestIdValidation = validateApprovalRequestId(rec.requestId);
  if (!requestIdValidation.valid) {
    errors.push(...requestIdValidation.errors);
  }

  // 6. Requester ID
  if (typeof rec.requesterId !== 'string' || !rec.requesterId.trim()) {
    errors.push('Field "requesterId" is required and must be a non-empty string.');
  }

  // 7. State Validation
  const validStates = Object.values(ApprovalActionBindingState) as unknown[];
  if (!validStates.includes(rec.state)) {
    errors.push(
      `Field "state" must be a valid ApprovalActionBindingState (BOUND, APPROVED, REJECTED, EXPIRED, CANCELLED, INVALIDATED). Received "${String(rec.state)}".`
    );
  }

  // 8. Timestamps
  let createdEpoch = 0;
  let expiresEpoch = 0;

  if (typeof rec.createdAt !== 'string' || !isIso8601Timestamp(rec.createdAt)) {
    errors.push(
      `Field "createdAt" must be a valid ISO 8601 UTC timestamp string. Received "${String(rec.createdAt)}".`
    );
  } else {
    createdEpoch = Date.parse(rec.createdAt);
  }

  if (typeof rec.expiresAt !== 'string' || !isIso8601Timestamp(rec.expiresAt)) {
    errors.push(
      `Field "expiresAt" must be a valid ISO 8601 UTC timestamp string. Received "${String(rec.expiresAt)}".`
    );
  } else {
    expiresEpoch = Date.parse(rec.expiresAt);
  }

  if (createdEpoch && expiresEpoch && expiresEpoch <= createdEpoch) {
    errors.push(
      `Timestamp invariant violated: "expiresAt" (${rec.expiresAt}) must be strictly after "createdAt" (${rec.createdAt}).`
    );
  }

  if (rec.resolvedAt !== undefined) {
    if (typeof rec.resolvedAt !== 'string' || !isIso8601Timestamp(rec.resolvedAt)) {
      errors.push(
        `Field "resolvedAt" must be a valid ISO 8601 UTC timestamp string when present. Received "${String(rec.resolvedAt)}".`
      );
    } else {
      const resolvedEpoch = Date.parse(rec.resolvedAt);
      if (createdEpoch && resolvedEpoch < createdEpoch) {
        errors.push(
          `Timestamp invariant violated: "resolvedAt" (${rec.resolvedAt}) cannot precede "createdAt" (${rec.createdAt}).`
        );
      }
    }
  }

  // 9. Action Digest (optional)
  if (rec.actionDigest !== undefined) {
    const digestValidation = validateActionDigest(rec.actionDigest);
    if (!digestValidation.valid) {
      errors.push(...digestValidation.errors);
    }
  }

  // 10. Reason (optional)
  if (rec.reason !== undefined && typeof rec.reason !== 'string') {
    errors.push('Field "reason" must be a string when present.');
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

/**
 * Asserts that a value is a valid ApprovalActionBinding, throwing ApprovalBindingValidationError if not.
 */
export function assertValidApprovalActionBinding(
  data: unknown
): asserts data is ApprovalActionBinding {
  const result = validateApprovalActionBinding(data);
  if (!result.valid) {
    throw new ApprovalBindingValidationError(result.errors);
  }
}

// =============================================================================
// Binding Factory & Lifecycle Operations
// =============================================================================

export interface CreateBindingOptions {
  readonly id?: string;
  readonly timeProvider?: TimeProvider;
}

/**
 * Factory creating an immutable ApprovalActionBinding domain entity.
 */
export function createApprovalActionBinding(
  input: CreateApprovalActionBindingInput,
  options?: CreateBindingOptions
): ApprovalActionBinding {
  if (!input || typeof input !== 'object') {
    throw new ApprovalBindingValidationError([
      'CreateApprovalActionBindingInput must be a non-null object.',
    ]);
  }

  const id = options?.id ?? generateActionBindingId();
  const timeProvider = options?.timeProvider ?? defaultTimeProvider;
  const createdAt = input.createdAt ?? resolveTimestamp(timeProvider);
  const state = input.state ?? ApprovalActionBindingState.BOUND;

  const binding: ApprovalActionBinding = {
    id,
    actionId: input.actionId,
    requestId: input.requestId,
    requesterId: input.requesterId,
    state,
    ...(input.actionDigest ? { actionDigest: input.actionDigest } : {}),
    createdAt,
    expiresAt: input.expiresAt,
    ...(input.reason ? { reason: input.reason } : {}),
  };

  assertValidApprovalActionBinding(binding);
  return Object.freeze(binding);
}

export interface TransitionBindingOptions {
  readonly resolvedAt?: string;
  readonly reason?: string;
  readonly timeProvider?: TimeProvider;
}

/**
 * Transitions an ApprovalActionBinding to a new lifecycle state.
 * Validates the state machine transition and returns a frozen updated entity.
 */
export function transitionBindingState(
  binding: ApprovalActionBinding,
  targetState: ApprovalActionBindingState,
  options?: TransitionBindingOptions
): ApprovalActionBinding {
  assertValidApprovalActionBinding(binding);

  if (!isValidBindingTransition(binding.state, targetState)) {
    throw new ApprovalBindingStateTransitionError(binding.id, binding.state, targetState);
  }

  const timeProvider = options?.timeProvider ?? defaultTimeProvider;
  let resolvedAt = options?.resolvedAt;

  if (isTerminalBindingState(targetState) && !resolvedAt) {
    resolvedAt = resolveTimestamp(timeProvider);
  }

  const updated: ApprovalActionBinding = {
    ...binding,
    state: targetState,
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(options?.reason !== undefined ? { reason: options.reason } : {}),
  };

  assertValidApprovalActionBinding(updated);
  return Object.freeze(updated);
}

/**
 * Checks whether an existing binding's deadline has elapsed.
 */
export function isBindingExpired(
  binding: ApprovalActionBinding,
  timeProvider: TimeProvider = defaultTimeProvider
): boolean {
  const expiresEpoch = Date.parse(binding.expiresAt);
  const currentEpoch = Date.parse(resolveTimestamp(timeProvider));
  return currentEpoch >= expiresEpoch;
}

/**
 * Guards against accidental reassignment of an existing binding.
 */
export function assertNoBindingReassignment(
  existingBinding: ApprovalActionBinding,
  targetActionId: string,
  targetRequestId: string
): void {
  if (
    existingBinding.requestId === targetRequestId &&
    existingBinding.actionId !== targetActionId
  ) {
    throw new ApprovalBindingReassignmentError(
      targetRequestId,
      existingBinding.actionId,
      targetActionId
    );
  }

  if (
    existingBinding.actionId === targetActionId &&
    existingBinding.requestId !== targetRequestId &&
    !isTerminalBindingState(existingBinding.state)
  ) {
    throw new ApprovalBindingConflictError(
      targetActionId,
      existingBinding.requestId,
      targetRequestId
    );
  }
}
