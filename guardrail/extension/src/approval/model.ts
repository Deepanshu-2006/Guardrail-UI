/**
 * Guardrail Approval Request Model & Validation Engine
 *
 * Implements the strongly typed ApprovalRequest domain entity, deterministic
 * lifecycle state machine, zero-trust validation invariants, and serialization.
 *
 * PERSISTENCE ARCHITECTURE NOTICE:
 * Currently, no persistent database layer exists in `guardrail/server`.
 * This model serves as the authoritative in-memory contract, validation suite,
 * and serialization standard. Requests are NOT yet persisted to a database.
 * When backend storage is introduced (Day 10+), this model maps directly to
 * the PostgreSQL/SQLite schema specified in `guardrail/docs/approval-workflow-contract.md`.
 *
 * PRIVACY & SECURITY INVARIANTS:
 * 1. Zero client self-authorization: Requesters cannot assign their own requesterId or mark requests APPROVED.
 * 2. Separation of duties: Requesters cannot approve or decide their own requests.
 * 3. Strict privacy whitelist: Rejects all passwords, OTPs, PINs, cards, cookies, tokens, and form data.
 * 4. Deterministic immutability: All entities and transitions produce frozen records.
 */

import { ActionCategory, ActionType } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import {
  ApprovalDecisionMetadata,
  ApprovalRequest,
  ApprovalStatus,
  ApprovalValidationResult,
  ClientApprovalRequestPayload,
  SubmitApprovalDecisionInput,
} from '../types/approval.js';
import { generateActionId, generateTimestamp } from '../utils/metadata.js';

// =============================================================================
// Security Constants & Whitelists
// =============================================================================

/**
 * Whitelist of permitted top-level property names for ApprovalRequest.
 * Any property outside this list is strictly rejected to guarantee minimal model scope.
 */
export const PERMITTED_APPROVAL_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'actionId',
  'requesterId',
  'bindingId',
  'actionDigest',
  'status',
  'actionDescription',
  'actionType',
  'category',
  'riskLevel',
  'riskScore',
  'riskReasons',
  'origin',
  'hostname',
  'pageTitle',
  'createdAt',
  'expiresAt',
  'resolvedAt',
  'decision',
  'cancellationReason',
]);

/**
 * Whitelist of permitted property names for ApprovalDecisionMetadata.
 */
export const PERMITTED_DECISION_FIELDS: ReadonlySet<string> = new Set([
  'decision',
  'decidedBy',
  'decidedAt',
  'decisionReason',
]);

/**
 * Regex patterns identifying forbidden sensitive property names.
 * Strictly rejected to prevent accidental leakage of secrets, auth credentials,
 * or personal identifiable form entries into the approval model.
 */
export const FORBIDDEN_PROPERTY_PATTERNS: readonly RegExp[] = Object.freeze([
  /password/i,
  /passphrase/i,
  /passwd/i,
  /secret/i,
  /\botp\b/i,
  /\bpin\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /credit[-_]?card/i,
  /debit[-_]?card/i,
  /card[-_]?number/i,
  /\bpan\b/i,
  /\btoken\b/i,
  /authtoken/i,
  /bearer/i,
  /cookie/i,
  /form[-_]?value/i,
  /input[-_]?value/i,
  /form[-_]?data/i,
  /raw[-_]?html/i,
  /raw[-_]?content/i,
  /dom[-_]?node/i,
  /element[-_]?node/i,
  /private[-_]?key/i,
  /\bssn\b/i,
]);

// =============================================================================
// State Machine Transitions
// =============================================================================

/**
 * Declarative state transition matrix for ApprovalStatus.
 *
 * Transitions:
 * - PENDING   -> [APPROVED, REJECTED, EXPIRED, CANCELLED]
 * - APPROVED  -> [] (Terminal)
 * - REJECTED  -> [] (Terminal)
 * - EXPIRED   -> [] (Terminal)
 * - CANCELLED -> [] (Terminal)
 */
export const VALID_APPROVAL_TRANSITIONS: Readonly<
  Record<ApprovalStatus, readonly ApprovalStatus[]>
> = Object.freeze({
  [ApprovalStatus.PENDING]: Object.freeze([
    ApprovalStatus.APPROVED,
    ApprovalStatus.REJECTED,
    ApprovalStatus.EXPIRED,
    ApprovalStatus.CANCELLED,
  ]),
  [ApprovalStatus.APPROVED]: Object.freeze([]),
  [ApprovalStatus.REJECTED]: Object.freeze([]),
  [ApprovalStatus.EXPIRED]: Object.freeze([]),
  [ApprovalStatus.CANCELLED]: Object.freeze([]),
});

/**
 * Checks whether an ApprovalStatus is terminal (no further transitions permitted).
 */
export function isTerminalApprovalStatus(status: ApprovalStatus): boolean {
  return (
    status === ApprovalStatus.APPROVED ||
    status === ApprovalStatus.REJECTED ||
    status === ApprovalStatus.EXPIRED ||
    status === ApprovalStatus.CANCELLED
  );
}

/**
 * Validates whether transitioning from `currentStatus` to `targetStatus` is permissible.
 */
export function isValidApprovalTransition(
  currentStatus: ApprovalStatus,
  targetStatus: ApprovalStatus
): boolean {
  const allowed = VALID_APPROVAL_TRANSITIONS[currentStatus];
  return Boolean(allowed && allowed.includes(targetStatus));
}

// =============================================================================
// Time Provider & Server Clock Invariants
// =============================================================================

/**
 * Reliable time provider function returning an ISO string, epoch milliseconds, or Date.
 * Allows injecting authoritative server clocks and deterministic test clocks.
 */
export type TimeProvider = () => string | number | Date;

/**
 * Default system time provider returning current ISO 8601 UTC timestamp.
 */
export const defaultTimeProvider: TimeProvider = () => new Date().toISOString();

/**
 * Normalizes a TimeProvider output to a standard ISO 8601 UTC string.
 */
export function resolveTimestamp(timeProvider: TimeProvider = defaultTimeProvider): string {
  const val = timeProvider();
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val === 'number') {
    return new Date(val).toISOString();
  }
  return new Date(Date.parse(val)).toISOString();
}

/**
 * Checks whether an ApprovalRequest has expired against a reliable time provider.
 *
 * @param request The ApprovalRequest to evaluate
 * @param timeProvider Authoritative time source
 * @returns True if current time is greater than or equal to request.expiresAt
 */
export function isRequestExpired(
  request: ApprovalRequest,
  timeProvider: TimeProvider = defaultTimeProvider
): boolean {
  const currentEpoch = Date.parse(resolveTimestamp(timeProvider));
  const expiresEpoch = Date.parse(request.expiresAt);
  return currentEpoch >= expiresEpoch;
}

// =============================================================================
// Custom Domain Errors
// =============================================================================

/**
 * Error thrown when an ApprovalRequest fails structural or semantic validation.
 */
export class ApprovalValidationError extends Error {
  public readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(
      `[Guardrail Approval] ApprovalRequest validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
    this.name = 'ApprovalValidationError';
    this.errors = Object.freeze([...errors]);
  }
}

/**
 * Error thrown when an invalid state transition is attempted on an ApprovalRequest.
 */
export class ApprovalStateTransitionError extends Error {
  public readonly requestId: string;
  public readonly fromStatus: ApprovalStatus;
  public readonly toStatus: ApprovalStatus;

  constructor(requestId: string, fromStatus: ApprovalStatus, toStatus: ApprovalStatus) {
    super(
      `[Guardrail Approval] Invalid state transition for approval request "${requestId}": Cannot transition from ${fromStatus} to ${toStatus}.`
    );
    this.name = 'ApprovalStateTransitionError';
    this.requestId = requestId;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

/**
 * Error thrown when attempting a decision, cancellation, or modification on an already resolved request.
 * Enforces first-responder concurrency and prevents repeated or conflicting decisions.
 */
export class ApprovalAlreadyResolvedError extends ApprovalStateTransitionError {
  constructor(requestId: string, currentStatus: ApprovalStatus, attemptedStatus: ApprovalStatus) {
    super(requestId, currentStatus, attemptedStatus);
    this.name = 'ApprovalAlreadyResolvedError';
    this.message = `[Guardrail Approval] Cannot modify approval request "${requestId}": Request is already in terminal state "${currentStatus}". Repeated decisions and modifications on resolved requests are strictly rejected.`;
  }
}

/**
 * Error thrown when an attempt is made to decide on an expired approval request.
 * Extends ApprovalValidationError to maintain consistency with validation suites.
 */
export class ApprovalExpiredError extends ApprovalValidationError {
  public readonly requestId: string;
  public readonly expiresAt: string;
  public readonly currentTimestamp: string;

  constructor(requestId: string, expiresAt: string, currentTimestamp: string) {
    const errorMsg = `Cannot submit decision for request "${requestId}": Decision timestamp (${currentTimestamp}) exceeds expiration deadline (${expiresAt}). Late decisions are prohibited.`;
    super([errorMsg]);
    this.name = 'ApprovalExpiredError';
    this.requestId = requestId;
    this.expiresAt = expiresAt;
    this.currentTimestamp = currentTimestamp;
  }
}

/**
 * Error thrown when an attempt is made to reopen a resolved request.
 * Enforces terminal state immutability per architecture specification.
 */
export class ApprovalReopenProhibitedError extends ApprovalStateTransitionError {
  constructor(requestId: string, currentStatus: ApprovalStatus) {
    super(requestId, currentStatus, ApprovalStatus.PENDING);
    this.name = 'ApprovalReopenProhibitedError';
    this.message = `[Guardrail Approval] Reopening resolved request "${requestId}" (status: ${currentStatus}) is prohibited by Guardrail architecture. Resolved states are terminal. Prefer creating a new approval request.`;
  }
}

/**
 * Error thrown when an approval request ID is not found.
 */
export class ApprovalRequestNotFoundError extends Error {
  public readonly requestId: string;

  constructor(requestId: string) {
    super(`[Guardrail Approval] Approval request with ID "${requestId}" was not found.`);
    this.name = 'ApprovalRequestNotFoundError';
    this.requestId = requestId;
  }
}

/**
 * Error thrown when attempting to register a duplicate active approval request for an action.
 */
export class DuplicateApprovalRequestError extends Error {
  public readonly actionId: string;
  public readonly existingRequestId: string;

  constructor(actionId: string, existingRequestId: string) {
    super(
      `[Guardrail Approval] An active approval request ("${existingRequestId}") already exists for action "${actionId}". Duplicate submissions are suppressed.`
    );
    this.name = 'DuplicateApprovalRequestError';
    this.actionId = actionId;
    this.existingRequestId = existingRequestId;
  }
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validates whether an origin string is a clean, sanitized origin (scheme + host + optional port).
 * Rejects paths other than root, query parameters, fragments, and credentials.
 */
export function isValidSanitizedOrigin(origin: string): boolean {
  if (typeof origin !== 'string' || !origin.trim()) {
    return false;
  }
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    if (url.username || url.password) {
      return false;
    }
    if (url.search || url.hash) {
      return false;
    }
    if (url.pathname !== '' && url.pathname !== '/') {
      return false;
    }
    return url.origin === origin.replace(/\/$/, '');
  } catch {
    return false;
  }
}

/**
 * Checks whether a value is a valid ISO 8601 UTC timestamp string.
 */
export function isIso8601Timestamp(str: unknown): boolean {
  if (typeof str !== 'string' || !str.trim()) {
    return false;
  }
  const parsed = Date.parse(str);
  return !isNaN(parsed);
}

/**
 * Recursively scans an object for keys that match forbidden sensitive patterns.
 */
export function findForbiddenProperties(obj: Record<string, unknown>, path: string = ''): string[] {
  const violations: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullPath = path ? `${path}.${key}` : key;
    for (const pattern of FORBIDDEN_PROPERTY_PATTERNS) {
      if (pattern.test(key)) {
        violations.push(fullPath);
        break;
      }
    }
    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      violations.push(...findForbiddenProperties(val as Record<string, unknown>, fullPath));
    }
  }
  return violations;
}

// =============================================================================
// Authoritative Validation Engine
// =============================================================================

/**
 * Validates a canonical approval request identifier ('apr_...').
 *
 * VALIDATION RULES:
 * 1. Must be a non-empty string.
 * 2. Must start with the canonical 'apr_' prefix.
 * 3. Must contain only alphanumeric characters, underscores, and hyphens (preventing path traversal and injections).
 * 4. Maximum length is 128 characters, minimum length is 5 characters ('apr_' + at least 1 char).
 *
 * @param id Any value to validate as an approval request identifier
 * @returns ApprovalValidationResult with `valid` boolean and array of `errors`
 */
export function validateApprovalRequestId(id: unknown): ApprovalValidationResult {
  const errors: string[] = [];

  if (typeof id !== 'string' || !id.trim()) {
    errors.push('Approval request ID is required and must be a non-empty string.');
    return { valid: false, errors: Object.freeze(errors) };
  }

  const trimmed = id.trim();

  if (!trimmed.startsWith('apr_')) {
    errors.push(`Field "id" must be prefixed with "apr_" (received "${trimmed}").`);
  }

  if (!/^apr_[a-zA-Z0-9_-]{1,124}$/.test(trimmed)) {
    errors.push(
      `Field "id" format is invalid ("${trimmed}"). Expected canonical format: "apr_" followed by alphanumeric characters, underscores, or hyphens (up to 128 characters total).`
    );
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

/**
 * Asserts that a value is a valid canonical approval request ID, throwing ApprovalValidationError if not.
 */
export function assertValidApprovalRequestId(id: unknown): asserts id is string {
  const result = validateApprovalRequestId(id);
  if (!result.valid) {
    throw new ApprovalValidationError(result.errors);
  }
}

/**
 * Validates an unknown data payload against the complete ApprovalRequest data contract,
 * ensuring required fields, type safety, timestamp consistency, lifecycle invariants,
 * and strict privacy exclusions.
 *
 * @param data Data payload to validate
 * @returns ApprovalValidationResult with `valid` boolean and array of `errors`
 */
export function validateApprovalRequest(data: unknown): ApprovalValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      valid: false,
      errors: ['ApprovalRequest payload must be a non-null object.'],
    };
  }

  const rec = data as Record<string, unknown>;

  // 1. Check for unpermitted fields (minimal model enforcement)
  for (const key of Object.keys(rec)) {
    if (!PERMITTED_APPROVAL_REQUEST_FIELDS.has(key)) {
      errors.push(
        `Unpermitted property "${key}" in ApprovalRequest. The model must remain minimal and strictly typed.`
      );
    }
  }

  // 2. Check for sensitive/forbidden properties (privacy enforcement)
  const forbiddenViolations = findForbiddenProperties(rec);
  for (const violation of forbiddenViolations) {
    errors.push(
      `Forbidden property "${violation}" violates privacy and security constraints (passwords, OTPs, tokens, cards, and form values are strictly prohibited).`
    );
  }

  // 3. Required String Fields
  if (typeof rec.id !== 'string' || !rec.id.trim()) {
    errors.push('Field "id" is required and must be a non-empty string.');
  } else if (!rec.id.startsWith('apr_')) {
    errors.push(`Field "id" must be prefixed with "apr_" (received "${rec.id}").`);
  }

  if (typeof rec.actionId !== 'string' || !rec.actionId.trim()) {
    errors.push('Field "actionId" is required and must be a non-empty string.');
  }

  if (typeof rec.requesterId !== 'string' || !rec.requesterId.trim()) {
    errors.push('Field "requesterId" is required and must be a non-empty string.');
  }

  if (typeof rec.actionDescription !== 'string' || !rec.actionDescription.trim()) {
    errors.push('Field "actionDescription" is required and must be a non-empty string.');
  }

  // 4. Enumeration Fields
  const validStatuses = Object.values(ApprovalStatus) as unknown[];
  if (!validStatuses.includes(rec.status)) {
    errors.push(
      `Field "status" must be a valid ApprovalStatus (PENDING, APPROVED, REJECTED, EXPIRED, CANCELLED). Received "${String(rec.status)}".`
    );
  }

  const validActionTypes = Object.values(ActionType) as unknown[];
  if (!validActionTypes.includes(rec.actionType)) {
    errors.push(
      `Field "actionType" must be a valid ActionType (CLICK, INPUT, SUBMIT, NAVIGATION). Received "${String(rec.actionType)}".`
    );
  }

  if (rec.category !== undefined) {
    const validCategories = Object.values(ActionCategory) as unknown[];
    if (!validCategories.includes(rec.category)) {
      errors.push(
        `Field "category" must be a valid ActionCategory (GENERAL, AUTHENTICATION, PAYMENT, DESTRUCTIVE, DOWNLOAD, EXTERNAL_NAVIGATION). Received "${String(rec.category)}".`
      );
    }
  }

  const validRiskLevels = Object.values(RiskLevel) as unknown[];
  if (!validRiskLevels.includes(rec.riskLevel)) {
    errors.push(
      `Field "riskLevel" must be a valid RiskLevel (LOW, MEDIUM, HIGH, CRITICAL). Received "${String(rec.riskLevel)}".`
    );
  }

  if (rec.riskScore !== undefined) {
    if (
      typeof rec.riskScore !== 'number' ||
      !Number.isFinite(rec.riskScore) ||
      rec.riskScore < 0 ||
      rec.riskScore > 100
    ) {
      errors.push(
        `Field "riskScore" must be a finite number between 0 and 100. Received "${String(rec.riskScore)}".`
      );
    }
  }

  if (
    !Array.isArray(rec.riskReasons) ||
    !rec.riskReasons.every((r: unknown) => typeof r === 'string')
  ) {
    errors.push('Field "riskReasons" must be an array of strings.');
  }

  // 5. Optional Metadata Fields
  if (rec.origin !== undefined) {
    if (!isValidSanitizedOrigin(String(rec.origin))) {
      errors.push(
        `Field "origin" must be a valid sanitized origin URL (e.g. "https://example.com" without paths, query strings, fragments, or credentials). Received "${String(rec.origin)}".`
      );
    }
  }

  if (rec.hostname !== undefined) {
    if (
      typeof rec.hostname !== 'string' ||
      !rec.hostname.trim() ||
      /\s|\/|:/.test(rec.hostname)
    ) {
      errors.push(
        `Field "hostname" must be a non-empty string without whitespace, slashes, or ports. Received "${String(rec.hostname)}".`
      );
    }
  }

  if (rec.pageTitle !== undefined && typeof rec.pageTitle !== 'string') {
    errors.push('Field "pageTitle" must be a string if defined.');
  }

  // 6. Timestamps
  let validCreatedAt = false;
  let validExpiresAt = false;
  let createdAtEpoch = 0;
  let expiresAtEpoch = 0;

  if (typeof rec.createdAt !== 'string' || isNaN(Date.parse(rec.createdAt))) {
    errors.push('Field "createdAt" must be a valid ISO 8601 timestamp string.');
  } else {
    validCreatedAt = true;
    createdAtEpoch = Date.parse(rec.createdAt);
  }

  if (typeof rec.expiresAt !== 'string' || isNaN(Date.parse(rec.expiresAt))) {
    errors.push('Field "expiresAt" must be a valid ISO 8601 timestamp string.');
  } else {
    validExpiresAt = true;
    expiresAtEpoch = Date.parse(rec.expiresAt);
  }

  if (validCreatedAt && validExpiresAt) {
    if (expiresAtEpoch <= createdAtEpoch) {
      errors.push('Field "expiresAt" must be strictly after "createdAt".');
    }
  }

  // 7. Status-Dependent Resolution Timestamps
  const status = rec.status as ApprovalStatus;

  if (status === ApprovalStatus.PENDING) {
    if (rec.resolvedAt !== undefined) {
      errors.push('Field "resolvedAt" must be undefined when status is PENDING.');
    }
    if (rec.decision !== undefined) {
      errors.push('Field "decision" must be undefined when status is PENDING.');
    }
    if (rec.cancellationReason !== undefined) {
      errors.push('Field "cancellationReason" must be undefined when status is PENDING.');
    }
  } else if (isTerminalApprovalStatus(status)) {
    if (typeof rec.resolvedAt !== 'string' || isNaN(Date.parse(rec.resolvedAt))) {
      errors.push(
        `Field "resolvedAt" is required and must be a valid ISO 8601 timestamp string when status is terminal ("${status}").`
      );
    } else if (validCreatedAt) {
      const resolvedAtEpoch = Date.parse(rec.resolvedAt);
      if (resolvedAtEpoch < createdAtEpoch) {
        errors.push('Field "resolvedAt" cannot precede "createdAt".');
      }
    }
  }

  // 8. Decision Metadata Invariants
  if (status === ApprovalStatus.EXPIRED || status === ApprovalStatus.CANCELLED) {
    if (rec.decision !== undefined) {
      errors.push(`Field "decision" must be undefined when status is ${status}.`);
    }
  }

  if (status === ApprovalStatus.APPROVED || status === ApprovalStatus.REJECTED) {
    if (!rec.decision || typeof rec.decision !== 'object' || Array.isArray(rec.decision)) {
      errors.push(`Field "decision" is required and must be an object when status is ${status}.`);
    } else {
      const decision = rec.decision as Record<string, unknown>;

      // Check unpermitted decision fields
      for (const dKey of Object.keys(decision)) {
        if (!PERMITTED_DECISION_FIELDS.has(dKey)) {
          errors.push(`Unpermitted property "${dKey}" in decision metadata.`);
        }
      }

      // Check decision verdict matches status
      if (decision.decision !== status) {
        errors.push(
          `Inconsistent decision metadata: decision.decision ("${String(decision.decision)}") must match request status ("${status}").`
        );
      }

      // Check decidedBy
      if (typeof decision.decidedBy !== 'string' || !decision.decidedBy.trim()) {
        errors.push('Field "decision.decidedBy" must be a non-empty string.');
      } else if (
        typeof rec.requesterId === 'string' &&
        decision.decidedBy.trim() === rec.requesterId.trim()
      ) {
        errors.push(
          `Separation of duties violation: decidedBy ("${decision.decidedBy}") cannot be the same as requesterId ("${rec.requesterId}").`
        );
      }

      // Check decidedAt
      if (typeof decision.decidedAt !== 'string' || isNaN(Date.parse(decision.decidedAt))) {
        errors.push('Field "decision.decidedAt" must be a valid ISO 8601 timestamp string.');
      } else {
        const decidedAtEpoch = Date.parse(decision.decidedAt);
        if (validCreatedAt && decidedAtEpoch < createdAtEpoch) {
          errors.push('Field "decision.decidedAt" cannot precede "createdAt".');
        }
        if (validExpiresAt && decidedAtEpoch > expiresAtEpoch) {
          errors.push(
            'Field "decision.decidedAt" cannot be after "expiresAt" (expired requests cannot be decided).'
          );
        }
        if (typeof rec.resolvedAt === 'string' && rec.resolvedAt !== decision.decidedAt) {
          errors.push(
            `Inconsistent resolution timestamp: "resolvedAt" ("${rec.resolvedAt}") must match "decision.decidedAt" ("${decision.decidedAt}").`
          );
        }
      }

      // Check decisionReason if present
      if (decision.decisionReason !== undefined && typeof decision.decisionReason !== 'string') {
        errors.push('Field "decision.decisionReason" must be a string if provided.');
      }
    }
  }

  // 9. Cancellation Invariants
  if (rec.cancellationReason !== undefined) {
    if (typeof rec.cancellationReason !== 'string') {
      errors.push('Field "cancellationReason" must be a string if provided.');
    }
    if (status !== ApprovalStatus.CANCELLED) {
      errors.push('Field "cancellationReason" is only permitted when status is CANCELLED.');
    }
  }

  // 10. Action Binding & Digest Validation
  if (rec.bindingId !== undefined) {
    if (
      typeof rec.bindingId !== 'string' ||
      !rec.bindingId.startsWith('bnd_') ||
      !/^bnd_[a-zA-Z0-9_-]{1,124}$/.test(rec.bindingId)
    ) {
      errors.push(
        `Field "bindingId" must be a valid canonical binding identifier prefixed with "bnd_" (received "${String(rec.bindingId)}").`
      );
    }
  }

  if (rec.actionDigest !== undefined) {
    if (typeof rec.actionDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(rec.actionDigest)) {
      errors.push(
        `Field "actionDigest" must be a 64-character hexadecimal SHA-256 string (received "${String(rec.actionDigest)}").`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

/**
 * Asserts that the provided data is a valid ApprovalRequest.
 * Throws ApprovalValidationError if validation fails.
 */
export function assertValidApprovalRequest(data: unknown): asserts data is ApprovalRequest {
  const result = validateApprovalRequest(data);
  if (!result.valid) {
    throw new ApprovalValidationError(result.errors);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Configuration options for creating an ApprovalRequest.
 */
export interface CreateApprovalRequestOptions {
  /** Optional custom approval request ID (defaults to 'apr_' + UUID/entropy) */
  readonly id?: string;
  /** Optional custom creation timestamp (defaults to current UTC ISO 8601 string) */
  readonly createdAt?: string;
  /** Optional custom expiration timestamp (overrides default TTL) */
  readonly expiresAt?: string;
  /** Optional TTL in milliseconds (defaults to 15 minutes = 900,000 ms) */
  readonly ttlMs?: number;
  /** Optional canonical action binding identifier ('bnd_...') */
  readonly bindingId?: string;
  /** Optional canonical action structural digest (SHA-256 hex string) */
  readonly actionDigest?: string;
}

/**
 * Factory creating an immutable ApprovalRequest in the initial PENDING lifecycle state.
 *
 * ZERO-TRUST SECURITY:
 * - `authenticatedRequesterId` must be authoritatively supplied by the server auth context.
 * - Any attempt by the client payload to specify `requesterId`, `status`, `decision`,
 *   or `resolvedAt` is strictly rejected.
 *
 * @param payload Client submission containing held action metadata
 * @param authenticatedRequesterId Authoritative authenticated user ID from server session
 * @param options Optional configuration overrides (ID, TTL, timestamps)
 * @returns Frozen, valid ApprovalRequest in PENDING state
 */
export function createApprovalRequest(
  payload: ClientApprovalRequestPayload,
  authenticatedRequesterId: string,
  options?: CreateApprovalRequestOptions
): ApprovalRequest {
  if (!payload || typeof payload !== 'object') {
    throw new ApprovalValidationError(['ClientApprovalRequestPayload must be a non-null object.']);
  }

  if (
    !authenticatedRequesterId ||
    typeof authenticatedRequesterId !== 'string' ||
    !authenticatedRequesterId.trim()
  ) {
    throw new ApprovalValidationError([
      'authenticatedRequesterId is required and must be an authoritative user identifier.',
    ]);
  }

  // Enforce zero-trust: Client payload cannot choose its own authoritative requester identity or status
  const clientViolations: string[] = [];
  const rawPayload = payload as unknown as Record<string, unknown>;

  if (rawPayload.requesterId !== undefined) {
    clientViolations.push(
      'Client payload cannot specify "requesterId". The requester identity must be assigned authoritatively by the authenticated session.'
    );
  }
  if (rawPayload.status !== undefined) {
    clientViolations.push(
      'Client payload cannot specify "status". New approval requests are always initialized in PENDING state.'
    );
  }
  if (rawPayload.decision !== undefined) {
    clientViolations.push(
      'Client payload cannot specify "decision". Decisions can only be submitted by authorized trusted contacts.'
    );
  }
  if (rawPayload.resolvedAt !== undefined) {
    clientViolations.push(
      'Client payload cannot specify "resolvedAt". Initial requests are unresolved.'
    );
  }

  if (clientViolations.length > 0) {
    throw new ApprovalValidationError(clientViolations);
  }

  const id = options?.id ?? generateActionId('apr');
  const createdAt = options?.createdAt ?? generateTimestamp();
  const ttlMs = options?.ttlMs ?? 15 * 60 * 1000; // 15-minute default TTL
  const expiresAt =
    options?.expiresAt ?? new Date(Date.parse(createdAt) + ttlMs).toISOString();
  const bindingId = options?.bindingId;
  const actionDigest = options?.actionDigest ?? payload.actionDigest;

  const request: ApprovalRequest = Object.freeze({
    id,
    actionId: payload.actionId,
    requesterId: authenticatedRequesterId.trim(),
    status: ApprovalStatus.PENDING,
    actionDescription: payload.actionDescription,
    actionType: payload.actionType,
    category: payload.category,
    riskLevel: payload.riskLevel,
    riskScore: payload.riskScore,
    riskReasons: Object.freeze(payload.riskReasons ? [...payload.riskReasons] : []),
    origin: payload.origin,
    hostname: payload.hostname,
    pageTitle: payload.pageTitle,
    createdAt,
    expiresAt,
    ...(bindingId ? { bindingId } : {}),
    ...(actionDigest ? { actionDigest } : {}),
  });

  assertValidApprovalRequest(request);
  return request;
}

// =============================================================================
// Lifecycle State Transition Functions
// =============================================================================

/**
 * Resolves a PENDING ApprovalRequest by recording a trusted contact's verdict (APPROVED or REJECTED).
 *
 * SEPARATION OF DUTIES:
 * - The decision-maker (`decidedBy`) CANNOT be the requesting user (`requesterId`).
 *
 * EXPIRATION & TERMINAL STATE GUARDS:
 * - Rejects already-resolved requests (throws ApprovalAlreadyResolvedError).
 * - Rejects expired requests using reliable time source (throws ApprovalExpiredError).
 *
 * @param request Existing PENDING ApprovalRequest
 * @param decisionInput Verdict and reviewer details
 * @param timeProvider Optional authoritative time provider
 * @returns New immutable ApprovalRequest in APPROVED or REJECTED state
 */
export function resolveApprovalRequest(
  request: ApprovalRequest,
  decisionInput: SubmitApprovalDecisionInput,
  timeProvider?: TimeProvider
): ApprovalRequest {
  if (!request) {
    throw new ApprovalValidationError(['ApprovalRequest is required for resolution.']);
  }
  if (!decisionInput) {
    throw new ApprovalValidationError(['SubmitApprovalDecisionInput is required for resolution.']);
  }

  const targetStatus =
    decisionInput.decision === 'APPROVED' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;

  // Check if request is already in a terminal state (APPROVED, REJECTED, EXPIRED, CANCELLED)
  if (isTerminalApprovalStatus(request.status)) {
    throw new ApprovalAlreadyResolvedError(request.id, request.status, targetStatus);
  }

  if (!isValidApprovalTransition(request.status, targetStatus)) {
    throw new ApprovalStateTransitionError(request.id, request.status, targetStatus);
  }

  const decidedAt =
    decisionInput.decidedAt ??
    (timeProvider ? resolveTimestamp(timeProvider) : generateTimestamp());

  // Check if request has elapsed past expiration deadline using authoritative time source
  if (
    Date.parse(decidedAt) > Date.parse(request.expiresAt) ||
    (timeProvider && isRequestExpired(request, timeProvider))
  ) {
    throw new ApprovalExpiredError(request.id, request.expiresAt, decidedAt);
  }

  if (decisionInput.decidedBy.trim() === request.requesterId.trim()) {
    throw new ApprovalValidationError([
      `Separation of duties violation: Requester "${request.requesterId}" cannot decide or approve their own request.`,
    ]);
  }

  const decision: ApprovalDecisionMetadata = Object.freeze({
    decision: decisionInput.decision,
    decidedBy: decisionInput.decidedBy.trim(),
    decidedAt,
    decisionReason: decisionInput.decisionReason?.trim(),
  });

  const resolved: ApprovalRequest = Object.freeze({
    ...request,
    status: targetStatus,
    resolvedAt: decidedAt,
    decision,
  });

  assertValidApprovalRequest(resolved);
  return resolved;
}

/**
 * Cancels a PENDING ApprovalRequest when the user cancels the held action in Staging Mode.
 *
 * @param request Existing PENDING ApprovalRequest
 * @param authenticatedUserId Identity of user attempting cancellation (must match requesterId)
 * @param reason Optional cancellation explanation
 * @param timeProviderOrTimestamp Optional authoritative TimeProvider or ISO timestamp string
 * @returns New immutable ApprovalRequest in CANCELLED state
 */
export function cancelApprovalRequest(
  request: ApprovalRequest,
  authenticatedUserId: string,
  reason?: string,
  timeProviderOrTimestamp?: TimeProvider | string
): ApprovalRequest {
  if (!request) {
    throw new ApprovalValidationError(['ApprovalRequest is required for cancellation.']);
  }
  if (isTerminalApprovalStatus(request.status)) {
    throw new ApprovalAlreadyResolvedError(request.id, request.status, ApprovalStatus.CANCELLED);
  }
  if (!isValidApprovalTransition(request.status, ApprovalStatus.CANCELLED)) {
    throw new ApprovalStateTransitionError(request.id, request.status, ApprovalStatus.CANCELLED);
  }
  if (!authenticatedUserId || authenticatedUserId.trim() !== request.requesterId.trim()) {
    throw new ApprovalValidationError([
      `Unauthorized cancellation: Only the authenticated requester "${request.requesterId}" can cancel this request.`,
    ]);
  }

  let resolvedAt: string;
  if (typeof timeProviderOrTimestamp === 'function') {
    resolvedAt = resolveTimestamp(timeProviderOrTimestamp);
  } else if (typeof timeProviderOrTimestamp === 'string') {
    resolvedAt = timeProviderOrTimestamp;
  } else {
    resolvedAt = generateTimestamp();
  }

  const cancelled: ApprovalRequest = Object.freeze({
    ...request,
    status: ApprovalStatus.CANCELLED,
    resolvedAt,
    cancellationReason: reason?.trim() || 'Cancelled by user in Staging Mode.',
  });

  assertValidApprovalRequest(cancelled);
  return cancelled;
}

/**
 * Expires a PENDING ApprovalRequest when the expiration deadline passes without a decision.
 *
 * @param request Existing PENDING ApprovalRequest
 * @param timeProviderOrTimestamp Optional authoritative TimeProvider or ISO timestamp string
 * @returns New immutable ApprovalRequest in EXPIRED state
 */
export function expireApprovalRequest(
  request: ApprovalRequest,
  timeProviderOrTimestamp?: TimeProvider | string
): ApprovalRequest {
  if (!request) {
    throw new ApprovalValidationError(['ApprovalRequest is required for expiration.']);
  }
  if (isTerminalApprovalStatus(request.status)) {
    throw new ApprovalAlreadyResolvedError(request.id, request.status, ApprovalStatus.EXPIRED);
  }
  if (!isValidApprovalTransition(request.status, ApprovalStatus.EXPIRED)) {
    throw new ApprovalStateTransitionError(request.id, request.status, ApprovalStatus.EXPIRED);
  }

  let resolvedAt: string;
  if (typeof timeProviderOrTimestamp === 'function') {
    resolvedAt = resolveTimestamp(timeProviderOrTimestamp);
  } else if (typeof timeProviderOrTimestamp === 'string') {
    resolvedAt = timeProviderOrTimestamp;
  } else {
    resolvedAt = request.expiresAt;
  }

  const expired: ApprovalRequest = Object.freeze({
    ...request,
    status: ApprovalStatus.EXPIRED,
    resolvedAt,
  });

  assertValidApprovalRequest(expired);
  return expired;
}

/**
 * Reopening resolved requests is strictly prohibited by Guardrail architecture.
 * Resolved states (APPROVED, REJECTED, EXPIRED, CANCELLED) are permanent.
 * Prefer creating a new request.
 *
 * @param request Any ApprovalRequest
 * @throws ApprovalReopenProhibitedError unconditionally
 */
export function reopenApprovalRequest(request: ApprovalRequest): never {
  throw new ApprovalReopenProhibitedError(request.id, request.status);
}

// =============================================================================
// Serialization & Deserialization
// =============================================================================

/**
 * Serializes a valid ApprovalRequest to a clean JSON string.
 * Enforces pre-serialization validation.
 */
export function serializeApprovalRequest(request: ApprovalRequest): string {
  assertValidApprovalRequest(request);
  return JSON.stringify(request);
}

/**
 * Deserializes and validates a JSON string into an immutable ApprovalRequest.
 * Enforces post-deserialization validation.
 *
 * @param json JSON string representing an ApprovalRequest
 * @returns Valid, frozen ApprovalRequest instance
 * @throws ApprovalValidationError if JSON parsing or model validation fails
 */
export function deserializeApprovalRequest(json: string): ApprovalRequest {
  if (typeof json !== 'string' || !json.trim()) {
    throw new ApprovalValidationError(['Cannot deserialize empty or non-string JSON payload.']);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ApprovalValidationError([
      `JSON syntax error during ApprovalRequest deserialization: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }
  assertValidApprovalRequest(parsed);
  return Object.freeze(parsed);
}
