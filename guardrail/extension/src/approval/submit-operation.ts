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
 * 2. ACTION CONTINUATION DECOUPLING:
 *    - Submitting or successfully registering an approval request NEVER executes, releases, or continues
 *      the held browser action. The intercepted interaction remains safely HELD in browser runtime memory.
 * 3. AUTHORITATIVE VS UNCERTAIN OUTCOMES:
 *    - Authoritative outcomes (`isAuthoritative: true`): Local validation failures, server status confirmations
 *      (201 Created `PENDING`), and definitive server rejections (400, 401, 403, 404, 409, 410, 413, 415, 429).
 *    - Uncertain outcomes (`isAuthoritative: false`): Timeouts (`TIMEOUT_UNCERTAIN`), network socket drops
 *      (`NETWORK_FAILURE_UNCERTAIN`), and server 5xx/502 gateway errors (`SERVER_ERROR`).
 *      If a timeout or network drop occurs after headers are dispatched, the backend MAY have processed and
 *      created the request! The client must NOT assume that request creation failed on the server.
 * 4. DEDUPLICATION & IDEMPOTENCY BOUNDARY:
 *    - Deduplication is keyed by the compound identifier `(authenticatedUserId, payload.actionId)` on the backend.
 *    - The client passes the stable `context.actionId` matching the held interception.
 *    - The client does NOT generate or supply a custom canonical `id` (the server assigns `apr_...`).
 *    - If an active `PENDING` request already exists on the server, the backend returns the existing record
 *      (mapped to `ALREADY_PENDING`).
 * 5. PRIVACY & LEAST PRIVILEGE:
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
  readonly outcome: SubmissionOutcome.CREATED_PENDING | SubmissionOutcome.ALREADY_PENDING;
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
 * Strongly typed union result returned by submitApprovalRequest.
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
 * 2. Pre-validates the payload client-side to ensure no sensitive credentials leak over the wire.
 * 3. Uses `ApprovalApiClient` to perform authenticated HTTP transport.
 * 4. NEVER executes, releases, or continues the held browser action.
 * 5. Accurately flags whether outcomes are authoritative or uncertain.
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

  // 3. Build minimal client payload from staging context
  const payload = buildClientPayloadFromStagingContext(context);

  // 4. Client-side pre-flight integrity & privacy check
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

  // 5. Execute API client dispatch
  const client = options?.apiClient ?? new ApprovalApiClient();
  const apiResult = await client.createApprovalRequest(payload, options);

  // 6. Handle HTTP Success (201 Created or 200 OK idempotent return)
  if (apiResult.success) {
    const request = apiResult.data;

    // Check if the server returned an existing active request (idempotent matching)
    // The server initializes new requests to PENDING. If createdAt is earlier than submission,
    // or if the server returned an existing record, it is marked ALREADY_PENDING.
    const isExistingRecord =
      request.status === ApprovalStatus.PENDING &&
      apiResult.statusCode === 200;

    const outcome = isExistingRecord
      ? SubmissionOutcome.ALREADY_PENDING
      : SubmissionOutcome.CREATED_PENDING;

    // CRITICAL: We do NOT continue or release the held action.
    // The action remains in HELD state in InterceptionController & ContinuationManager.
    return {
      success: true,
      outcome,
      request,
      actionId,
      isAuthoritative: true,
    };
  }

  // 7. Handle HTTP Errors & Uncertain Transport Outcomes
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
      isAuthoritative: false, // Server state is unknown!
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
      isAuthoritative: false, // Server state is unknown!
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
}
