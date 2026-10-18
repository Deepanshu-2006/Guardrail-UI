/**
 * Guardrail Staging Mode - Approval Status Model & Validation
 *
 * Implements decoupled approval status management, response schema validation,
 * error sanitization, and truthful lifecycle messaging.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. SEPARATION OF CONCERNS:
 *    - Keeps approval status determination and response validation separate from DOM rendering.
 * 2. AUTHORITATIVE BACKEND STATUS REUSE:
 *    - Reuses canonical ApprovalStatus ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED').
 * 3. STRICT SCHEMA VALIDATION:
 *    - Validates backend response shape, request IDs, timestamps, and decision metadata before accepting.
 *    - Rejects malformed or spoofed responses (e.g. PENDING with decision, or APPROVED without decision).
 * 4. NEVER CONFUSE CREATION WITH APPROVAL:
 *    - Successfully creating an approval request confirms PENDING review only, NEVER APPROVED.
 * 5. TRUTHFUL CARETAKER MESSAGING:
 *    - Never claims a caretaker has been notified or received an SMS/email, as notification delivery
 *      is not confirmed in this milestone.
 * 6. PRIVACY & SANITIZATION:
 *    - Strips stack traces, SQL syntax, secrets, and auth tokens from error messages.
 * 7. ACTION HELD INVARIANT:
 *    - Preserves action in HELD state across all lifecycle and error states.
 */

import {
  ApprovalRequest,
  ApprovalStatus,
} from '../types/approval.js';

// =============================================================================
// Status Types & Enums
// =============================================================================

/**
 * Mutually exclusive UI approval status categories representing both local operational
 * states and backend-confirmed lifecycle states.
 */
export enum UIApprovalStatus {
  /**
   * Action is held in Staging Mode; no approval request has been submitted yet.
   * [Local UI state]
   */
  NOT_SUBMITTED = 'NOT_SUBMITTED',

  /**
   * Submission operation is currently in flight over extension messaging / backend API.
   * [Local UI state]
   */
  SUBMISSION_IN_PROGRESS = 'SUBMISSION_IN_PROGRESS',

  /**
   * Backend confirmed that an approval request was created (or already actively exists)
   * in PENDING status.
   * [Backend-confirmed status]
   */
  REQUEST_CREATION_CONFIRMED = 'REQUEST_CREATION_CONFIRMED',

  /**
   * Backend confirmed that an existing request was APPROVED by an authorized trusted contact.
   * Valid decision block verified. Action remains HELD until user explicitly confirms.
   * [Backend-confirmed status]
   */
  STATUS_CONFIRMED_APPROVED = 'STATUS_CONFIRMED_APPROVED',

  /**
   * Backend confirmed that an existing request was REJECTED by an authorized trusted contact.
   * Valid decision block verified. Action remains HELD/paused.
   * [Backend-confirmed status]
   */
  STATUS_CONFIRMED_REJECTED = 'STATUS_CONFIRMED_REJECTED',

  /**
   * Backend confirmed that the request has EXPIRED.
   * [Backend-confirmed status]
   */
  STATUS_CONFIRMED_EXPIRED = 'STATUS_CONFIRMED_EXPIRED',

  /**
   * Backend confirmed that the request was CANCELLED.
   * [Backend-confirmed status]
   */
  STATUS_CONFIRMED_CANCELLED = 'STATUS_CONFIRMED_CANCELLED',

  /**
   * Backend authoritatively rejected the submission (400, 401, 403, 409, 410, 413, 429).
   * [Backend-confirmed failure]
   */
  SUBMISSION_REJECTED = 'SUBMISSION_REJECTED',

  /**
   * Network outcome is unknown due to timeout (408), connection reset, socket drop, or disconnect.
   * The backend state is uncertain.
   * [Local uncertainty state]
   */
  SUBMISSION_OUTCOME_UNKNOWN = 'SUBMISSION_OUTCOME_UNKNOWN',

  /**
   * Local pre-flight check failed (action not held, untracked, or already resolved locally).
   * [Local UI state]
   */
  LOCAL_STATE_INVALID = 'LOCAL_STATE_INVALID',

  /**
   * Backend returned a malformed response that violated the canonical ApprovalRequest schema.
   * [Local validation failure]
   */
  MALFORMED_RESPONSE = 'MALFORMED_RESPONSE',
}

/**
 * Validated, immutable status record decoupling state calculation from DOM rendering.
 */
export interface ValidatedApprovalState {
  /** The high-level UI approval status category */
  readonly uiStatus: UIApprovalStatus;

  /** Whether this status is authoritatively confirmed by the backend */
  readonly isBackendConfirmed: boolean;

  /** The authoritative backend status enum value if confirmed */
  readonly backendStatus?: ApprovalStatus;

  /** Canonical request identifier ('apr_...') if known */
  readonly requestId?: string;

  /** Plain-language headline for modal heading / banner */
  readonly headline: string;

  /** Clear, non-technical explanation for user review */
  readonly detail: string;

  /** Concise status badge / mode pill label */
  readonly badgeLabel: string;

  /** CSS class modifier for the mode badge pill */
  readonly badgeClass: string;

  /** Safe, non-sensitive footer status notice */
  readonly footerNotice: string;

  /** Screen reader announcement text */
  readonly ariaAnnouncement: string;

  /** Sanitized error code if rejected */
  readonly errorCode?: string;

  /** Whether the Request Approval button should be disabled */
  readonly isRequestButtonDisabled: boolean;

  /** Text label for the Request Approval button */
  readonly requestButtonText: string;

  /** Whether the Request Approval button aria-busy attribute should be true */
  readonly isBusy: boolean;

  /**
   * ARCHITECTURAL INVARIANT:
   * The protected action MUST remain in HELD state across all of these states.
   * Never release or execute the action automatically.
   */
  readonly isActionHeld: true;
}

// =============================================================================
// Schema Validation (Re-exported from submit-operation.js)
// =============================================================================

export { validateBackendApprovalResponse } from '../approval/submit-operation.js';
export type {
  BackendResponseValidationResult,
  ValidationSuccess,
  ValidationFailure,
} from '../approval/submit-operation.js';

// =============================================================================
// Error Sanitization
// =============================================================================

/**
 * Strips sensitive stack traces, SQL statements, auth tokens, and internal paths
 * from errors before presenting to the user.
 */
export function sanitizeApprovalErrorMessage(rawError: unknown, statusCode?: number): string {
  if (statusCode === 401) {
    return 'Authentication session expired or missing. Please sign in again.';
  }
  if (statusCode === 403) {
    return 'You do not have permission to request approval for this action.';
  }
  if (statusCode === 404) {
    return 'The requested action or approval record was not found on the server.';
  }
  if (statusCode === 409) {
    return 'Action state conflict on the server. The action may have already been resolved.';
  }
  if (statusCode === 410) {
    return 'This approval request has expired and is no longer valid.';
  }
  if (statusCode === 413) {
    return 'The request payload exceeds the allowed size limit.';
  }
  if (statusCode === 429) {
    return 'Too many requests. Please wait a moment before trying again.';
  }
  if (statusCode && statusCode >= 500) {
    return 'A temporary server error occurred. The action remains safely paused.';
  }

  let text = '';
  if (rawError instanceof Error) {
    text = rawError.message;
  } else if (typeof rawError === 'string') {
    text = rawError;
  } else if (rawError && typeof rawError === 'object' && 'message' in rawError) {
    text = String((rawError as any).message);
  } else {
    return 'An unexpected error occurred during approval submission. Action remains paused.';
  }

  // 1. Strip stack traces (e.g. at functionName (file.js:1:2))
  text = text.replace(/at\s+.*(\n|$)/g, ' ').replace(/\n\s*at\s+.*/g, ' ');

  // 2. Strip sensitive tokens and bearer credentials
  text = text.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
  text = text.replace(/(token|password|secret|key|jwt)=[^&\s]+/gi, '$1=[REDACTED]');

  // 3. Strip SQL / database syntax
  text = text.replace(
    /\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|FROM|WHERE|TABLE|COLUMN)\b.*?(;|\.|$)/gi,
    '[Database details omitted]'
  );

  // 4. Strip internal filesystem paths
  text = text.replace(/(?:\/[a-zA-Z0-9_.\-]+)+\.[a-zA-Z0-9]+/g, '[Internal file]');

  // 5. Clean up duplicate whitespace
  text = text.replace(/\s+/g, ' ').trim();

  if (!text || text.length > 300) {
    return 'The approval request could not be processed by the server. The action remains safely held.';
  }

  return text;
}

// =============================================================================
// State Determination Logic (Decoupled from Rendering)
// =============================================================================

export interface DetermineApprovalStateParams {
  /** High-level operational state */
  state:
    | 'not_submitted'
    | 'submitting'
    | 'creation_confirmed'
    | 'status_confirmed'
    | 'rejected'
    | 'unknown'
    | 'local_invalid'
    | 'malformed';

  /** Validated request if present */
  request?: ApprovalRequest;

  /** Action ID */
  actionId?: string;

  /** Server error details or exception */
  rawError?: unknown;

  /** Server HTTP status code */
  statusCode?: number;

  /** Canonical error code (e.g., UNAUTHORIZED, CONFLICT) */
  errorCode?: string;
}

/**
 * Pure state calculation function that derives a complete ValidatedApprovalState
 * without performing any DOM mutations.
 */
export function determineApprovalState(
  params: DetermineApprovalStateParams
): ValidatedApprovalState {
  const reqId = params.request?.id || (params.actionId ? `action_${params.actionId}` : 'active');

  switch (params.state) {
    case 'not_submitted':
      return {
        uiStatus: UIApprovalStatus.NOT_SUBMITTED,
        isBackendConfirmed: false,
        headline: 'Action Paused for Your Review',
        detail:
          'Guardrail paused this action before it happens so you have a moment to review it. Nothing has been sent or changed yet.',
        badgeLabel: 'Review Mode',
        badgeClass: 'gs-badge-held',
        footerNotice: 'Staging Mode Shell • Approval workflow ready • Action: HELD',
        ariaAnnouncement: 'Action paused for review.',
        isRequestButtonDisabled: false,
        requestButtonText: 'Request Approval',
        isBusy: false,
        isActionHeld: true,
      };

    case 'submitting':
      return {
        uiStatus: UIApprovalStatus.SUBMISSION_IN_PROGRESS,
        isBackendConfirmed: false,
        headline: 'Submitting Approval Request',
        detail: 'Connecting to backend approval service. Please wait while your request is registered...',
        badgeLabel: 'Submitting...',
        badgeClass: 'gs-badge-submitting',
        footerNotice: 'Submitting approval request to backend • Please wait... • Action: HELD',
        ariaAnnouncement: 'Submitting approval request to backend. Please wait.',
        isRequestButtonDisabled: true,
        requestButtonText: 'Submitting Request...',
        isBusy: true,
        isActionHeld: true,
      };

    case 'creation_confirmed':
      // Backend confirmed 201 Created PENDING
      return {
        uiStatus: UIApprovalStatus.REQUEST_CREATION_CONFIRMED,
        isBackendConfirmed: true,
        backendStatus: ApprovalStatus.PENDING,
        requestId: params.request?.id,
        headline: 'Approval Request Submitted',
        // TRUTHFUL MESSAGING: Never claim caretaker has been notified or received SMS
        detail: `Your approval request (${reqId}) has been registered on the server in PENDING status. This action remains safely paused and will not execute until approved.`,
        badgeLabel: 'Approval Pending',
        badgeClass: 'gs-badge-requested',
        footerNotice: `Approval Request Active (${reqId}) • Status: PENDING • Action: HELD`,
        ariaAnnouncement:
          'Approval request registered on server. Status: PENDING. Action remains safely paused.',
        isRequestButtonDisabled: true,
        requestButtonText: 'Approval Requested',
        isBusy: false,
        isActionHeld: true,
      };

    case 'status_confirmed':
      if (!params.request) {
        return determineApprovalState({ ...params, state: 'malformed' });
      }

      switch (params.request.status) {
        case ApprovalStatus.PENDING:
          return determineApprovalState({ ...params, state: 'creation_confirmed' });

        case ApprovalStatus.APPROVED:
          // Validated backend approval from an authorized trusted contact
          return {
            uiStatus: UIApprovalStatus.STATUS_CONFIRMED_APPROVED,
            isBackendConfirmed: true,
            backendStatus: ApprovalStatus.APPROVED,
            requestId: params.request.id,
            headline: 'Approval Confirmed by Contact',
            // CRITICAL: Action remains HELD! Does NOT auto-execute
            detail: `An authorized trusted contact (${params.request.decision?.decidedBy || 'contact'}) approved this action. To ensure your safety, this action is still held until you review and confirm.`,
            badgeLabel: 'Approval Confirmed',
            badgeClass: 'gs-badge-held',
            footerNotice: `Approval Confirmed (${params.request.id}) • Status: APPROVED • Action: HELD`,
            ariaAnnouncement:
              'Action approved by trusted contact. Review details and confirm execution.',
            isRequestButtonDisabled: true,
            requestButtonText: 'Approval Confirmed',
            isBusy: false,
            isActionHeld: true,
          };

        case ApprovalStatus.REJECTED:
          return {
            uiStatus: UIApprovalStatus.STATUS_CONFIRMED_REJECTED,
            isBackendConfirmed: true,
            backendStatus: ApprovalStatus.REJECTED,
            requestId: params.request.id,
            headline: 'Approval Denied by Contact',
            detail: `An authorized trusted contact (${params.request.decision?.decidedBy || 'contact'}) reviewed and denied this approval request. This action remains paused and cannot proceed.`,
            badgeLabel: 'Approval Denied',
            badgeClass: 'gs-badge-stale',
            footerNotice: `Approval Denied (${params.request.id}) • Status: REJECTED • Action: HELD`,
            ariaAnnouncement: 'Action rejected by trusted contact. Action cannot proceed.',
            isRequestButtonDisabled: true,
            requestButtonText: 'Request Denied',
            isBusy: false,
            isActionHeld: true,
          };

        case ApprovalStatus.EXPIRED:
          return {
            uiStatus: UIApprovalStatus.STATUS_CONFIRMED_EXPIRED,
            isBackendConfirmed: true,
            backendStatus: ApprovalStatus.EXPIRED,
            requestId: params.request.id,
            headline: 'Approval Request Expired',
            detail:
              'The review window for this approval request has expired without a decision. This action remains safely paused.',
            badgeLabel: 'Request Expired',
            badgeClass: 'gs-badge-stale',
            footerNotice: `Approval Expired (${params.request.id}) • Status: EXPIRED • Action: HELD`,
            ariaAnnouncement: 'Approval request expired. Action remains paused.',
            isRequestButtonDisabled: true,
            requestButtonText: 'Request Expired',
            isBusy: false,
            isActionHeld: true,
          };

        case ApprovalStatus.CANCELLED:
          return {
            uiStatus: UIApprovalStatus.STATUS_CONFIRMED_CANCELLED,
            isBackendConfirmed: true,
            backendStatus: ApprovalStatus.CANCELLED,
            requestId: params.request.id,
            headline: 'Approval Request Cancelled',
            detail:
              params.request.cancellationReason ||
              'This approval request was cancelled on the server. The action remains safely aborted.',
            badgeLabel: 'Request Cancelled',
            badgeClass: 'gs-badge-cancelled',
            footerNotice: `Approval Cancelled (${params.request.id}) • Status: CANCELLED • Action: HELD`,
            ariaAnnouncement: 'Approval request cancelled on server. Action remains paused.',
            isRequestButtonDisabled: true,
            requestButtonText: 'Request Cancelled',
            isBusy: false,
            isActionHeld: true,
          };
      }
      break;

    case 'rejected': {
      const sanitizedMsg = sanitizeApprovalErrorMessage(params.rawError, params.statusCode);
      const errCode = params.errorCode || (params.statusCode ? `HTTP_${params.statusCode}` : 'REJECTED');
      return {
        uiStatus: UIApprovalStatus.SUBMISSION_REJECTED,
        isBackendConfirmed: true,
        errorCode: errCode,
        headline: 'Approval Request Rejected',
        detail: sanitizedMsg,
        badgeLabel: 'Request Rejected',
        badgeClass: 'gs-badge-stale',
        footerNotice: `Approval Request Failed • ${errCode} • Action: HELD`,
        ariaAnnouncement: `Approval request rejected by server: ${sanitizedMsg}`,
        isRequestButtonDisabled: true,
        requestButtonText: 'Request Rejected',
        isBusy: false,
        isActionHeld: true,
      };
    }

    case 'unknown': {
      const sanitizedMsg = sanitizeApprovalErrorMessage(params.rawError, params.statusCode);
      return {
        uiStatus: UIApprovalStatus.SUBMISSION_OUTCOME_UNKNOWN,
        isBackendConfirmed: false,
        headline: 'Submission Outcome Uncertain',
        detail:
          sanitizedMsg ||
          'The approval submission timed out or the network connection dropped. The backend state is unknown. To protect your safety, this action remains safely paused and will not execute.',
        badgeLabel: 'Outcome Uncertain',
        badgeClass: 'gs-badge-stale',
        footerNotice: 'Network Outcome Uncertain • Request Status Unknown • Action: HELD',
        ariaAnnouncement:
          'Approval submission outcome is uncertain. The action remains safely paused.',
        isRequestButtonDisabled: true,
        requestButtonText: 'Outcome Uncertain',
        isBusy: false,
        isActionHeld: true,
      };
    }

    case 'local_invalid':
      return {
        uiStatus: UIApprovalStatus.LOCAL_STATE_INVALID,
        isBackendConfirmed: false,
        headline: 'Action No Longer Held',
        detail:
          sanitizeApprovalErrorMessage(params.rawError) ||
          'The action could not be processed because its state has already changed or it is no longer held.',
        badgeLabel: 'Operation Unavailable',
        badgeClass: 'gs-badge-stale',
        footerNotice: 'Action cannot be modified • Interception is no longer held',
        ariaAnnouncement: 'Action is no longer held or could not be processed.',
        isRequestButtonDisabled: true,
        requestButtonText: 'Request Unavailable',
        isBusy: false,
        isActionHeld: true,
      };

    case 'malformed':
      return {
        uiStatus: UIApprovalStatus.MALFORMED_RESPONSE,
        isBackendConfirmed: false,
        headline: 'Invalid Server Response',
        detail:
          'The backend response did not match the expected approval schema. To protect your safety, this action remains safely paused.',
        badgeLabel: 'Response Invalid',
        badgeClass: 'gs-badge-stale',
        footerNotice: 'Invalid Response Schema • Action: HELD',
        ariaAnnouncement: 'Invalid server response schema. Action remains paused.',
        isRequestButtonDisabled: true,
        requestButtonText: 'Request Unavailable',
        isBusy: false,
        isActionHeld: true,
      };
  }

  // Fallback safety
  return {
    uiStatus: UIApprovalStatus.NOT_SUBMITTED,
    isBackendConfirmed: false,
    headline: 'Action Paused for Your Review',
    detail: 'Guardrail paused this action before it happens. Nothing has been sent or changed yet.',
    badgeLabel: 'Review Mode',
    badgeClass: 'gs-badge-held',
    footerNotice: 'Staging Mode Shell • State: HELD',
    ariaAnnouncement: 'Action paused for review.',
    isRequestButtonDisabled: false,
    requestButtonText: 'Request Approval',
    isBusy: false,
    isActionHeld: true,
  };
}
