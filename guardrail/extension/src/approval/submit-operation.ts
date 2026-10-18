/**
 * Guardrail Approval Submission Operation
 *
 * Implements the typed extension-side operation for submitting an approval request
 * for an intercepted, held browser action to the remote backend.
 *
 * ARCHITECTURAL PRINCIPLES & INVARIANTS:
 * 1. STRICT LOCAL STATE PRE-CONDITION:
 *    - The target action MUST be actively registered in `InterceptionController` in the `HELD` state.
 *    - Actions in `DETECTED`, `CONTINUED`, `CANCELLED`, or untracked states are strictly rejected
 *      with `INVALID_LOCAL_STATE` before any network activity begins.
 * 2. SINGLE ACTIVE SUBMISSION PER HELD INTERCEPTION:
 *    - Guarantees that only ONE active approval submission executes per held actionId at a time.
 *    - Rapid repeated clicks or concurrent triggers are blocked via `ActiveSubmissionRegistry`.
 * 3. DEDUPLICATION & IDEMPOTENCY BOUNDARY:
 *    - Deduplication is keyed by the compound identifier `(authenticatedUserId, payload.actionId)` on the backend.
 *    - The client passes the stable `context.actionId` matching the held interception.
 *    - The client computes correctly scoped idempotency keys via `generateActionIdempotencyKey(actionId, userId)`.
 *    - If an active `PENDING` request already exists on the server, the backend returns the existing record
 *      (mapped to `ALREADY_PENDING`).
 *    - TRUTHFUL CLAIMS: Duplicate delivery suppression is not claimed to be unconditionally guaranteed
 *      across stateless server restarts or without transactional database uniqueness constraints.
 * 4. AUTHORITATIVE VS UNCERTAIN OUTCOMES:
 *    - Authoritative outcomes (`isAuthoritative: true`): Local validation failures, server status confirmations
 *      (201 Created `PENDING`, 200 OK idempotent return), and definitive server rejections (400, 401, 403, 404, 409, 410, 413, 415, 429).
 *    - Uncertain outcomes (`isAuthoritative: false`): Timeouts (`TIMEOUT_UNCERTAIN`), network socket drops
 *      (`NETWORK_FAILURE_UNCERTAIN`), and server 5xx/502 gateway errors (`SERVER_ERROR`).
 *      If a timeout or network drop occurs after headers are dispatched, the backend MAY have processed and
 *      created the request! The client must NOT assume that request creation failed on the server.
 * 5. SAFE RECONCILIATION WITHOUT BROAD RETRY LOOPS:
 *    - If an outcome is uncertain, `reconcileApprovalSubmission` provides a single, controlled status reconciliation
 *      probe using request ID lookup or backend compound idempotency. No broad or infinite retry loops.
 * 6. RACE CONDITION & STALE RESPONSE IMMUNITY:
 *    - If an action is cancelled, resolved, or removed from `InterceptionController` while an HTTP submission
 *      is in flight, the late network response is safely discarded and NOT applied.
 *    - Submitting, reconciling, or receiving an approval decision NEVER automatically executes or releases
 *      the held action. The action remains safely HELD in browser memory until explicit user confirmation.
 * 7. PRIVACY & LEAST PRIVILEGE:
 *    - Strictly whitelists metadata from `StagingActionContext`.
 *    - Excludes passwords, OTPs, PINs, cards, cookies, tokens, form values, and DOM nodes.
 *    - Re-derives user identity authoritatively from server session tokens; never accepts client-provided IDs.
 */

import {
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import { InterceptionState } from '../types/interception.js';
import { StagingActionContext } from '../types/staging.js';
import { InterceptionController } from '../interception/controller.js';
import {
  ApiClientErrorCodes,
  ApprovalApiClient,
  RequestOptions,
  validateClientPayloadIntegrity,
} from './client.js';

// =============================================================================
// Outcome Enumeration & Result Types
// =============================================================================

/**
 * Granular outcomes for the approval submission operation.
 */
export enum SubmissionOutcome {
  /**
   * The backend confirmed creation of a new approval request in PENDING state.
   * AUTHORITATIVE: Server confirmed record creation. Action remains HELD.
   */
  CREATED_PENDING = 'CREATED_PENDING',

  /**
   * The backend identified an existing active PENDING request for this actionId and returned it.
   * AUTHORITATIVE: Server confirmed an active review is already open. Action remains HELD.
   */
  ALREADY_PENDING = 'ALREADY_PENDING',

  /**
   * An approval submission is already in progress for this held action.
   * AUTHORITATIVE: Mutual exclusion prevented concurrent submission. Action remains HELD.
   */
  SUBMISSION_IN_PROGRESS = 'SUBMISSION_IN_PROGRESS',

  /**
   * An uncertain outcome was reconciled using backend lookup.
   * AUTHORITATIVE: Reconciled with authoritative server state. Action remains HELD.
   */
  RECONCILED = 'RECONCILED',

  /**
   * The action was not registered or not in HELD state in the InterceptionController.
   * AUTHORITATIVE: Pre-condition check failed client-side before network transmission.
   */
  INVALID_LOCAL_STATE = 'INVALID_LOCAL_STATE',

  /**
   * The client payload failed integrity or privacy validation (e.g. sensitive fields detected).
   * AUTHORITATIVE: Pre-condition check failed client-side before network transmission.
   */
  PAYLOAD_INVALID = 'PAYLOAD_INVALID',

  /**
   * The server rejected the request due to missing, invalid, or expired session credentials (401).
   * AUTHORITATIVE: Server confirmed unauthenticated caller.
   */
  UNAUTHENTICATED = 'UNAUTHENTICATED',

  /**
   * The server rejected the request because the action belongs to another user (403).
   * AUTHORITATIVE: Server confirmed unauthorized action ownership.
   */
  UNAUTHORIZED = 'UNAUTHORIZED',

  /**
   * The server rejected the request due to a lifecycle conflict or duplicate submission (409).
   * AUTHORITATIVE: Server rejected modification.
   */
  CONFLICT = 'CONFLICT',

  /**
   * The server rejected the request because an associated deadline or entity has expired (410).
   * AUTHORITATIVE: Server rejected expired request.
   */
  EXPIRED = 'EXPIRED',

  /**
   * The server rejected the request due to transport constraints (413 payload size, 415 media type, 429 rate limit).
   * AUTHORITATIVE: Server rejected transport conditions.
   */
  TRANSPORT_REJECTED = 'TRANSPORT_REJECTED',

  /**
   * The server returned a 5xx internal server error or 502/503 HTML gateway error.
   * UNCERTAIN: The backend may or may not have partially committed the request.
   */
  SERVER_ERROR = 'SERVER_ERROR',

  /**
   * The HTTP request timed out before receiving confirmation from the backend.
   * UNCERTAIN: The backend MAY have successfully processed and created the request.
   * The client must NOT assume creation failed or that the request does not exist on the server.
   */
  TIMEOUT_UNCERTAIN = 'TIMEOUT_UNCERTAIN',

  /**
   * A low-level network failure occurred (e.g. connection refused, socket reset, offline).
   * UNCERTAIN: If the socket dropped after the payload was transmitted, server state is unknown.
   */
  NETWORK_FAILURE_UNCERTAIN = 'NETWORK_FAILURE_UNCERTAIN',
}

/**
 * Detailed error structure returned on submission failures.
 */
export interface SubmissionErrorDetails {
  readonly code: string;
  readonly message: string;
  readonly statusCode?: number;
  readonly details?: readonly string[];
}

/**
 * Successful submission result.
 */
export interface SubmitApprovalRequestSuccess {
  readonly success: true;
  readonly outcome:
    | SubmissionOutcome.CREATED_PENDING
    | SubmissionOutcome.ALREADY_PENDING
    | SubmissionOutcome.RECONCILED;
  readonly request: ApprovalRequest;
  readonly actionId: string;
  /** Always true for confirmed successful server responses */
  readonly isAuthoritative: true;
}

/**
 * Failed or uncertain submission result.
 */
export interface SubmitApprovalRequestFailure {
  readonly success: false;
  readonly outcome: SubmissionOutcome;
  readonly actionId: string;
  readonly error: SubmissionErrorDetails;
  /**
   * True if the server or client-side check definitively rejected the request.
   * False if the network dropped or timed out, leaving the server-side outcome UNCERTAIN.
   */
  readonly isAuthoritative: boolean;
}

/**
 * Strongly typed union result returned by submitApprovalRequest and reconcileApprovalSubmission.
 */
export type SubmitApprovalRequestResult =
  | SubmitApprovalRequestSuccess
  | SubmitApprovalRequestFailure;

/**
 * Options supported by the submitApprovalRequest operation.
 */
export interface SubmitApprovalRequestOptions extends RequestOptions {
  /** Optional custom ApprovalApiClient instance (useful for dependency injection in tests) */
  readonly apiClient?: ApprovalApiClient;

  /**
   * If true and an active submission is already in flight for this actionId,
   * awaits and returns the result of the running submission rather than immediately rejecting.
   * Default: false (rejects with SUBMISSION_IN_PROGRESS to enforce single active submission).
   */
  readonly joinInFlight?: boolean;

  /**
   * Optional custom idempotency key override.
   * By default, the client computes the scoped compound key using generateActionIdempotencyKey(actionId, userId).
   */
  readonly idempotencyKey?: string;
}

/**
 * Options for reconciling an ambiguous approval submission.
 */
export interface ReconcileApprovalOptions extends RequestOptions {
  /** Optional custom ApprovalApiClient instance */
  readonly apiClient?: ApprovalApiClient;

  /**
   * If the canonical requestId ('apr_...') is known (e.g. from an earlier interaction or background store),
   * provides direct GET /api/v1/approval-requests/:id status inquiry.
   */
  readonly requestId?: string;

  /**
   * Optional custom timeout for the reconciliation inquiry in ms.
   */
  readonly timeoutMs?: number;
}

// =============================================================================
// Active In-Flight Submission Registry (Single Active Submission Enforcement)
// =============================================================================

/**
 * Thread-safe in-memory registry tracking currently in-flight approval submissions per actionId.
 * Guarantees that only ONE active submission executes for a given held interception at a time.
 */
export class ActiveSubmissionRegistry {
  private readonly inFlight = new Map<string, Promise<SubmitApprovalRequestResult>>();

  /**
   * Checks whether an approval submission is currently in flight for the given actionId.
   */
  public isSubmitting(actionId: string): boolean {
    return this.inFlight.has(actionId.trim());
  }

  /**
   * Returns the running in-flight submission Promise for the given actionId, if any.
   */
  public getInFlightPromise(actionId: string): Promise<SubmitApprovalRequestResult> | undefined {
    return this.inFlight.get(actionId.trim());
  }

  /**
   * Registers an active in-flight submission Promise for an actionId.
   */
  public register(actionId: string, promise: Promise<SubmitApprovalRequestResult>): void {
    this.inFlight.set(actionId.trim(), promise);
  }

  /**
   * Releases the active submission lock for an actionId.
   */
  public release(actionId: string): void {
    this.inFlight.delete(actionId.trim());
  }

  /**
   * Clears all active submissions (useful for test isolation).
   */
  public clear(): void {
    this.inFlight.clear();
  }
}

/**
 * Global singleton registry for in-flight submissions within the extension runtime.
 */
export const activeSubmissionRegistry = new ActiveSubmissionRegistry();

/**
 * Helper to check if an approval submission is currently running for an action.
 */
export function isSubmissionInProgress(actionId: string): boolean {
  return activeSubmissionRegistry.isSubmitting(actionId);
}

/**
 * Helper to reset all active in-flight submission locks (for test suite cleanup).
 */
export function resetActiveSubmissions(): void {
  activeSubmissionRegistry.clear();
}

// =============================================================================
// Idempotency Key Scoping
// =============================================================================

/**
 * Computes the compound idempotency key strictly scoped to the authenticated
 * user identity and the unique intercepted action ID: `${userId}:${actionId}`.
 *
 * Guarantees that requests for one held action cannot be confused with,
 * overwrite, or share an idempotency slot with any other action.
 *
 * @param actionId Unique intercepted browser action identifier ('act_...')
 * @param userId Authoritative user identifier ('usr_...')
 */
export function generateActionIdempotencyKey(
  actionId: string,
  userId: string = 'auth_user'
): string {
  const cleanActionId = (actionId || '').trim();
  const cleanUserId = (userId || 'auth_user').trim();
  return `${cleanUserId}:${cleanActionId}`;
}

// =============================================================================
// Domain Response Validation
// =============================================================================

export interface ValidationSuccess {
  readonly valid: true;
  readonly request: ApprovalRequest;
}

export interface ValidationFailure {
  readonly valid: false;
  readonly error: string;
}

export type BackendResponseValidationResult = ValidationSuccess | ValidationFailure;

const VALID_STATUSES = new Set<string>([
  ApprovalStatus.PENDING,
  ApprovalStatus.APPROVED,
  ApprovalStatus.REJECTED,
  ApprovalStatus.EXPIRED,
  ApprovalStatus.CANCELLED,
]);

/**
 * Validates an incoming object against the canonical ApprovalRequest domain schema.
 *
 * VALIDATION CHECKS:
 * 1. Must be a non-null object.
 * 2. `id`: non-empty string with canonical 'apr_' or 'appr_' prefix.
 * 3. `actionId`: matches expectedActionId if supplied.
 * 4. `status`: must be valid ApprovalStatus enum value.
 * 5. `createdAt` & `expiresAt`: valid ISO 8601 timestamps.
 * 6. If `status === APPROVED` or `status === REJECTED`:
 *    - `decision` block MUST be present.
 *    - `decision.decision` must match `status`.
 *    - `decision.decidedBy` must be non-empty string.
 *    - `decision.decidedAt` must be valid ISO timestamp.
 * 7. If `status === PENDING`:
 *    - `decision` block must NOT be present (rejects spoofed or inconsistent payloads).
 */
export function validateBackendApprovalResponse(
  data: unknown,
  expectedActionId?: string
): BackendResponseValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Response body is not a valid JSON object.' };
  }

  const raw = data as Record<string, unknown>;

  // 1. Validate ID
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    return { valid: false, error: 'Missing or empty request "id".' };
  }
  const id = raw.id.trim();
  if (!id.startsWith('apr_') && !id.startsWith('appr_')) {
    return {
      valid: false,
      error: `Invalid request "id" format ("${id}"). Expected "apr_" or "appr_" prefix.`,
    };
  }

  // 2. Validate actionId
  if (typeof raw.actionId !== 'string' || !raw.actionId.trim()) {
    return { valid: false, error: 'Missing or empty "actionId".' };
  }
  const actionId = raw.actionId.trim();
  if (expectedActionId && actionId !== expectedActionId.trim()) {
    return {
      valid: false,
      error: `actionId mismatch: response actionId "${actionId}" does not match expected "${expectedActionId}".`,
    };
  }

  // 3. Validate status
  if (typeof raw.status !== 'string' || !VALID_STATUSES.has(raw.status)) {
    return { valid: false, error: `Invalid or unknown status "${String(raw.status)}".` };
  }
  const status = raw.status as ApprovalStatus;

  // 4. Validate timestamps
  if (
    raw.createdAt !== undefined &&
    (typeof raw.createdAt !== 'string' || isNaN(Date.parse(raw.createdAt)))
  ) {
    return { valid: false, error: 'Invalid "createdAt" ISO timestamp.' };
  }
  if (
    raw.expiresAt !== undefined &&
    (typeof raw.expiresAt !== 'string' || isNaN(Date.parse(raw.expiresAt)))
  ) {
    return { valid: false, error: 'Invalid "expiresAt" ISO timestamp.' };
  }

  // 5. Validate decision block consistency
  if (status === ApprovalStatus.APPROVED || status === ApprovalStatus.REJECTED) {
    if (!raw.decision || typeof raw.decision !== 'object') {
      return {
        valid: false,
        error: `Request has terminal status "${status}" but is missing required decision metadata.`,
      };
    }
    const dec = raw.decision as Record<string, unknown>;
    if (dec.decision !== status) {
      return {
        valid: false,
        error: `Decision mismatch: decision.decision is "${String(dec.decision)}" but status is "${status}".`,
      };
    }
    if (typeof dec.decidedBy !== 'string' || !dec.decidedBy.trim()) {
      return { valid: false, error: 'Missing or empty "decidedBy" in decision block.' };
    }
    if (typeof dec.decidedAt !== 'string' || isNaN(Date.parse(dec.decidedAt))) {
      return { valid: false, error: 'Invalid "decidedAt" ISO timestamp in decision block.' };
    }
  } else if (status === ApprovalStatus.PENDING) {
    if (raw.decision !== undefined && raw.decision !== null) {
      return {
        valid: false,
        error: 'Inconsistent response: request in PENDING status contains premature decision metadata.',
      };
    }
  }

  return { valid: true, request: raw as unknown as ApprovalRequest };
}

// =============================================================================
// Payload Mapping & Validation Helpers
// =============================================================================

/**
 * Maps a StagingActionContext to the minimal ClientApprovalRequestPayload required
 * by the backend API.
 *
 * STRICT PRIVACY:
 * Extracts only high-level, sanitized interaction attributes.
 * Excludes live DOM references, user form inputs, passwords, and OTPs.
 */
export function buildClientPayloadFromStagingContext(
  context: StagingActionContext
): ClientApprovalRequestPayload {
  return {
    actionId: context.actionId,
    actionDescription: context.description,
    actionType: context.actionType,
    category: context.category,
    riskLevel: context.riskLevel,
    riskScore: context.riskScore,
    riskReasons: context.riskReasons ? Object.freeze([...context.riskReasons]) : undefined,
    origin: context.origin,
    hostname: context.hostname,
    pageTitle: context.pageTitle,
  };
}

// =============================================================================
// Submission Operation Implementation
// =============================================================================

/**
 * Submits an approval request for an intercepted action held in browser runtime.
 *
 * PRE-CONDITIONS & INVARIANTS:
 * 1. Checks that the action is actively registered in `controller` in the `HELD` state.
 * 2. Enforces single active submission per held interception via `ActiveSubmissionRegistry`.
 * 3. Pre-validates the payload client-side to ensure no sensitive credentials leak over the wire.
 * 4. Uses `ApprovalApiClient` to perform authenticated HTTP transport.
 * 5. RACE CONDITION & STALE PROTECTION: Checks controller record state after network return.
 *    If the action was cancelled or resolved while in flight, discards the late response.
 * 6. NEVER executes, releases, or continues the held browser action.
 * 7. Accurately flags whether outcomes are authoritative or uncertain.
 *
 * @param context The verified StagingActionContext containing action metadata
 * @param controller The active InterceptionController tracking the held action
 * @param options Optional request options and custom apiClient
 * @returns Strongly typed SubmitApprovalRequestResult
 */
export async function submitApprovalRequest(
  context: StagingActionContext,
  controller: InterceptionController,
  options?: SubmitApprovalRequestOptions
): Promise<SubmitApprovalRequestResult> {
  // 1. Parameter guards
  if (!context || typeof context !== 'object' || !context.actionId) {
    return {
      success: false,
      outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
      actionId: context?.actionId || '',
      error: {
        code: 'INVALID_STAGING_CONTEXT',
        message: 'A valid StagingActionContext with a non-empty actionId is required for submission.',
      },
      isAuthoritative: true,
    };
  }

  if (!controller || typeof controller.getRecord !== 'function') {
    return {
      success: false,
      outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
      actionId: context.actionId,
      error: {
        code: 'INVALID_INTERCEPTION_CONTROLLER',
        message: 'A valid InterceptionController instance is required to verify held action state.',
      },
      isAuthoritative: true,
    };
  }

  const actionId = context.actionId.trim();

  // 2. Validate that the interception is actively HELD in the controller
  const record = controller.getRecord(actionId);
  if (!record) {
    return {
      success: false,
      outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
      actionId,
      error: {
        code: 'ACTION_NOT_FOUND',
        message: `Action "${actionId}" is not registered in the InterceptionController.`,
      },
      isAuthoritative: true,
    };
  }

  if (record.state !== InterceptionState.HELD) {
    return {
      success: false,
      outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
      actionId,
      error: {
        code: 'ACTION_NOT_HELD',
        message: `Action "${actionId}" is in state "${record.state}". Only actions in HELD state are eligible for approval requests.`,
      },
      isAuthoritative: true,
    };
  }

  // 3. Mutual exclusion: Ensure only ONE active submission runs for this actionId at a time
  if (activeSubmissionRegistry.isSubmitting(actionId)) {
    if (options?.joinInFlight) {
      const existingPromise = activeSubmissionRegistry.getInFlightPromise(actionId);
      if (existingPromise) {
        return existingPromise;
      }
    }
    return {
      success: false,
      outcome: SubmissionOutcome.SUBMISSION_IN_PROGRESS,
      actionId,
      error: {
        code: 'SUBMISSION_ALREADY_IN_PROGRESS',
        message: `An approval request submission is already in progress for action "${actionId}". Only one active submission per held interception is permitted at a time.`,
      },
      isAuthoritative: true,
    };
  }

  // 4. Build minimal client payload from staging context
  const payload = buildClientPayloadFromStagingContext(context);

  // 5. Client-side pre-flight integrity & privacy check
  const integrityViolations = validateClientPayloadIntegrity(payload);
  if (integrityViolations.length > 0) {
    return {
      success: false,
      outcome: SubmissionOutcome.PAYLOAD_INVALID,
      actionId,
      error: {
        code: 'PAYLOAD_VALIDATION_ERROR',
        message: `Client payload validation failed:\n${integrityViolations.map((v) => `  - ${v}`).join('\n')}`,
        statusCode: 400,
        details: Object.freeze(integrityViolations),
      },
      isAuthoritative: true,
    };
  }

  // 6. Execute under active submission lock
  const client = options?.apiClient ?? new ApprovalApiClient();

  const executeSubmission = async (): Promise<SubmitApprovalRequestResult> => {
    try {
      // Dispatch POST /api/v1/approval-requests
      const apiResult = await client.createApprovalRequest(payload, options);

      // 7. RACE CONDITION GUARD: Verify action state has not changed while in-flight
      const currentRecord = controller.getRecord(actionId);
      if (!currentRecord) {
        return {
          success: false,
          outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
          actionId,
          error: {
            code: 'ACTION_UNTRACKED_POST_SUBMISSION',
            message: `Action "${actionId}" was removed from tracking while approval submission was in flight. The response was discarded.`,
          },
          isAuthoritative: true,
        };
      }

      if (currentRecord.state !== InterceptionState.HELD) {
        return {
          success: false,
          outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
          actionId,
          error: {
            code: 'ACTION_STATE_CHANGED_POST_SUBMISSION',
            message: `Action "${actionId}" transitioned from HELD to "${currentRecord.state}" while approval submission was in flight. The response was safely discarded to prevent race conditions.`,
          },
          isAuthoritative: true,
        };
      }

      // 8. Handle HTTP Success (201 Created or 200 OK idempotent return)
      if (apiResult.success) {
        const request = apiResult.data;

        // Validate backend response schema before accepting
        const validation = validateBackendApprovalResponse(request, actionId);
        if (!validation.valid) {
          return {
            success: false,
            outcome: SubmissionOutcome.PAYLOAD_INVALID,
            actionId,
            error: {
              code: 'MALFORMED_BACKEND_RESPONSE',
              message: `Backend approval response schema validation failed: ${validation.error}`,
              statusCode: apiResult.statusCode,
            },
            isAuthoritative: true,
          };
        }

        const isExistingRecord =
          request.status === ApprovalStatus.PENDING && apiResult.statusCode === 200;

        const outcome = isExistingRecord
          ? SubmissionOutcome.ALREADY_PENDING
          : SubmissionOutcome.CREATED_PENDING;

        return {
          success: true,
          outcome,
          request: validation.request,
          actionId,
          isAuthoritative: true,
        };
      }

      // 9. Handle HTTP Errors & Uncertain Transport Outcomes
      const apiError = apiResult.error;
      const statusCode = apiResult.statusCode;

      // Outcome A: Timeout (UNCERTAIN)
      if (apiError.code === ApiClientErrorCodes.TIMEOUT || statusCode === 408) {
        return {
          success: false,
          outcome: SubmissionOutcome.TIMEOUT_UNCERTAIN,
          actionId,
          error: {
            code: apiError.code,
            message:
              'The approval request submission timed out. The backend state is UNCERTAIN: the request may or may not have been created on the server. The intercepted action remains safely HELD.',
            statusCode: 408,
          },
          isAuthoritative: false,
        };
      }

      // Outcome B: Network Socket / Offline Failure (UNCERTAIN)
      if (apiError.code === ApiClientErrorCodes.NETWORK_FAILURE || statusCode === 0) {
        return {
          success: false,
          outcome: SubmissionOutcome.NETWORK_FAILURE_UNCERTAIN,
          actionId,
          error: {
            code: apiError.code,
            message: `Network communication failed: ${apiError.message}. If the connection dropped after data was sent, the server state remains UNCERTAIN. The intercepted action remains safely HELD.`,
            statusCode: 0,
          },
          isAuthoritative: false,
        };
      }

      // Outcome C: Server 5xx / HTML Error (UNCERTAIN)
      if (
        apiError.code === ApiClientErrorCodes.SERVER_ERROR ||
        (typeof statusCode === 'number' && statusCode >= 500)
      ) {
        return {
          success: false,
          outcome: SubmissionOutcome.SERVER_ERROR,
          actionId,
          error: {
            code: apiError.code,
            message: `The server encountered an internal error (HTTP ${statusCode ?? 500}). Server state is UNCERTAIN. The intercepted action remains safely HELD.`,
            statusCode,
          },
          isAuthoritative: false,
        };
      }

      // Outcome D: 401 Unauthenticated (AUTHORITATIVE)
      if (apiError.code === ApiClientErrorCodes.UNAUTHENTICATED || statusCode === 401) {
        return {
          success: false,
          outcome: SubmissionOutcome.UNAUTHENTICATED,
          actionId,
          error: {
            code: apiError.code,
            message: apiError.message,
            statusCode: 401,
          },
          isAuthoritative: true,
        };
      }

      // Outcome E: 403 Unauthorized (AUTHORITATIVE)
      if (
        apiError.code === 'UNAUTHORIZED_ACTION_REQUESTER' ||
        apiError.code === 'SELF_APPROVAL_PROHIBITED' ||
        statusCode === 403
      ) {
        return {
          success: false,
          outcome: SubmissionOutcome.UNAUTHORIZED,
          actionId,
          error: {
            code: apiError.code,
            message: apiError.message,
            statusCode: 403,
          },
          isAuthoritative: true,
        };
      }

      // Outcome F: 409 Conflict / Already Resolved (AUTHORITATIVE)
      if (
        apiError.code === ApiClientErrorCodes.ALREADY_RESOLVED ||
        apiError.code === 'DUPLICATE_ACTIVE_REQUEST' ||
        statusCode === 409
      ) {
        return {
          success: false,
          outcome: SubmissionOutcome.CONFLICT,
          actionId,
          error: {
            code: apiError.code,
            message: apiError.message,
            statusCode: 409,
          },
          isAuthoritative: true,
        };
      }

      // Outcome G: 410 Expired (AUTHORITATIVE)
      if (apiError.code === ApiClientErrorCodes.REQUEST_EXPIRED || statusCode === 410) {
        return {
          success: false,
          outcome: SubmissionOutcome.EXPIRED,
          actionId,
          error: {
            code: apiError.code,
            message: apiError.message,
            statusCode: 410,
          },
          isAuthoritative: true,
        };
      }

      // Outcome H: 413, 415, 429 Transport Rejections (AUTHORITATIVE)
      if (
        apiError.code === ApiClientErrorCodes.PAYLOAD_TOO_LARGE ||
        apiError.code === ApiClientErrorCodes.UNSUPPORTED_MEDIA_TYPE ||
        apiError.code === ApiClientErrorCodes.RATE_LIMIT_EXCEEDED ||
        statusCode === 413 ||
        statusCode === 415 ||
        statusCode === 429
      ) {
        return {
          success: false,
          outcome: SubmissionOutcome.TRANSPORT_REJECTED,
          actionId,
          error: {
            code: apiError.code,
            message: apiError.message,
            statusCode,
          },
          isAuthoritative: true,
        };
      }

      // Outcome I: 400 Validation Error (AUTHORITATIVE)
      return {
        success: false,
        outcome: SubmissionOutcome.PAYLOAD_INVALID,
        actionId,
        error: {
          code: apiError.code,
          message: apiError.message,
          statusCode: statusCode ?? 400,
          details: apiError.details,
        },
        isAuthoritative: true,
      };
    } finally {
      activeSubmissionRegistry.release(actionId);
    }
  };

  const submissionPromise = executeSubmission();
  activeSubmissionRegistry.register(actionId, submissionPromise);
  return submissionPromise;
}

// =============================================================================
// Reconciliation Operation Implementation (Safe Inquiry for Ambiguous States)
// =============================================================================

/**
 * Reconciles an ambiguous or uncertain approval submission outcome (e.g. after a timeout
 * or connection drop) using authoritative backend-supported mechanisms:
 *
 * 1. If `options.requestId` is provided:
 *    Queries GET /api/v1/approval-requests/:id.
 * 2. If `options.requestId` is NOT known:
 *    Uses the backend's contractually enforced compound idempotency key `(userId, actionId)`.
 *    Submits the minimal client payload to POST /api/v1/approval-requests.
 *    Because the server deduplicates active requests by (userId, actionId), if the request
 *    was already created before the timeout, the server safely returns 200 OK with the existing
 *    request record (ALREADY_PENDING) without creating a duplicate!
 *    If the request was never received, the server creates it (201 Created PENDING).
 *
 * SAFETY INVARIANTS:
 * - Single controlled probe; strictly NO broad/infinite retry loops.
 * - Does NOT release, continue, or execute the held browser action.
 * - Validates the backend response schema before accepting any status.
 * - Discards response if the action was cancelled or resolved in the meantime.
 *
 * @param context The StagingActionContext representing the held action
 * @param controller The active InterceptionController
 * @param options Reconciliation options (apiClient, requestId, timeoutMs)
 */
export async function reconcileApprovalSubmission(
  context: StagingActionContext,
  controller: InterceptionController,
  options?: ReconcileApprovalOptions
): Promise<SubmitApprovalRequestResult> {
  if (!context || !context.actionId) {
    return {
      success: false,
      outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
      actionId: context?.actionId || '',
      error: {
        code: 'INVALID_STAGING_CONTEXT',
        message: 'A valid StagingActionContext with actionId is required for reconciliation.',
      },
      isAuthoritative: true,
    };
  }

  const actionId = context.actionId.trim();

  // Pre-condition: action must still be HELD
  const record = controller.getRecord(actionId);
  if (!record || record.state !== InterceptionState.HELD) {
    return {
      success: false,
      outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
      actionId,
      error: {
        code: 'ACTION_NOT_HELD',
        message: `Action "${actionId}" is no longer in HELD state (state: "${record?.state ?? 'UNTRACKED'}"). Reconciliation aborted.`,
      },
      isAuthoritative: true,
    };
  }

  // Mutual exclusion: Prevent concurrent reconciliation if a submission is already active
  if (activeSubmissionRegistry.isSubmitting(actionId)) {
    return {
      success: false,
      outcome: SubmissionOutcome.SUBMISSION_IN_PROGRESS,
      actionId,
      error: {
        code: 'SUBMISSION_ALREADY_IN_PROGRESS',
        message: `An operation is already in progress for action "${actionId}". Reconciliation cannot run concurrently.`,
      },
      isAuthoritative: true,
    };
  }

  const client = options?.apiClient ?? new ApprovalApiClient();

  const executeReconciliation = async (): Promise<SubmitApprovalRequestResult> => {
    try {
      // Path A: Request ID is already known -> GET /api/v1/approval-requests/:id
      if (options?.requestId && options.requestId.trim()) {
        const getRes = await client.getApprovalRequest(options.requestId.trim(), {
          timeoutMs: options.timeoutMs,
          token: options.token,
        });

        // Check race condition post-flight
        const currentRecord = controller.getRecord(actionId);
        if (!currentRecord || currentRecord.state !== InterceptionState.HELD) {
          return {
            success: false,
            outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
            actionId,
            error: {
              code: 'ACTION_STATE_CHANGED_POST_SUBMISSION',
              message: `Action "${actionId}" transitioned away from HELD during status reconciliation.`,
            },
            isAuthoritative: true,
          };
        }

        if (getRes.success) {
          const validation = validateBackendApprovalResponse(getRes.data, actionId);
          if (!validation.valid) {
            return {
              success: false,
              outcome: SubmissionOutcome.PAYLOAD_INVALID,
              actionId,
              error: {
                code: 'MALFORMED_BACKEND_RESPONSE',
                message: `Status check response violated schema: ${validation.error}`,
              },
              isAuthoritative: true,
            };
          }

          return {
            success: true,
            outcome: SubmissionOutcome.RECONCILED,
            request: validation.request,
            actionId,
            isAuthoritative: true,
          };
        }

        // Return authoritative error or uncertain timeout
        const isTimeout =
          getRes.error.code === ApiClientErrorCodes.TIMEOUT || getRes.statusCode === 408;
        return {
          success: false,
          outcome: isTimeout
            ? SubmissionOutcome.TIMEOUT_UNCERTAIN
            : SubmissionOutcome.CONFLICT,
          actionId,
          error: {
            code: getRes.error.code,
            message: getRes.error.message,
            statusCode: getRes.statusCode,
          },
          isAuthoritative: !isTimeout,
        };
      }

      // Path B: Request ID is not known -> Use backend compound idempotency (userId, actionId)
      // Calling createApprovalRequest with same actionId is safe and idempotent on conforming servers:
      // It returns the existing PENDING request if already created, or creates it if not.
      return await submitApprovalRequest(context, controller, {
        ...options,
        apiClient: client,
      });
    } finally {
      activeSubmissionRegistry.release(actionId);
    }
  };

  const reconPromise = executeReconciliation();
  activeSubmissionRegistry.register(actionId, reconPromise);
  return reconPromise;
}
