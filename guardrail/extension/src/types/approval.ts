/**
 * Guardrail Approval Request Intent & Domain Models
 *
 * Defines the strongly typed approval request data structures, lifecycle states,
 * and decision contracts for the Guardrail approval workflow.
 *
 * ARCHITECTURAL PRINCIPLES & BOUNDARIES:
 * 1. PERSISTENCE NOTICE:
 *    - Currently, no persistent database layer exists in `guardrail/server`.
 *    - These models serve as the authoritative in-memory contract and serialization format
 *      for client-to-server messaging and Day 10+ persistent storage.
 * 2. SEPARATION OF CONCERNS:
 *    - Client initiates a request; server authenticates and assigns the authoritative requester ID.
 *    - Trusted contacts review and record decisions.
 *    - Approval decisions do NOT automatically execute browser actions.
 * 3. PRIVACY & LEAST PRIVILEGE:
 *    - Strictly excludes passwords, OTPs, credit cards, cookies, auth tokens, and raw form values.
 *    - Carries only minimal safe metadata: actionId, description, category, riskLevel,
 *      sanitized origin, sanitized hostname, and lifecycle timestamps.
 * 4. IMMUTABILITY & DETERMINISM:
 *    - All models are immutable with `readonly` fields.
 *    - Terminal states (APPROVED, REJECTED, EXPIRED, CANCELLED) cannot transition further.
 */

import { ActionCategory, ActionType } from './actions.js';
import { InterceptionState } from './interception.js';
import { RiskLevel } from './risk.js';
import { StagingActionContext } from './staging.js';

// =============================================================================
// Lifecycle States
// =============================================================================

/**
 * Canonical lifecycle states for an approval request.
 */
export enum ApprovalStatus {
  /**
   * Request has been created by an authenticated user and is waiting for review.
   * Action remains HELD in client browser runtime. Initial state.
   */
  PENDING = 'PENDING',

  /**
   * An authorized trusted contact has explicitly approved the request.
   * A short-lived cryptographic approval grant token is generated. Terminal state.
   */
  APPROVED = 'APPROVED',

  /**
   * An authorized trusted contact has explicitly rejected the request.
   * Action cannot proceed. Terminal state.
   */
  REJECTED = 'REJECTED',

  /**
   * Expiration deadline elapsed without a caretaker decision.
   * Action cannot proceed without a fresh review. Terminal state.
   */
  EXPIRED = 'EXPIRED',

  /**
   * The requesting user cancelled the action from Staging Mode or navigated away.
   * Review is aborted. Terminal state.
   */
  CANCELLED = 'CANCELLED',
}

/**
 * String union representing valid ApprovalStatus values.
 */
export type ApprovalStatusString = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

// =============================================================================
// Approval Action Binding Models
// =============================================================================

/**
 * Explicit lifecycle states for the immutable 1:1 binding between a protected action and its approval request.
 */
export enum ApprovalActionBindingState {
  /**
   * Binding is active and approval request is pending review for the held action.
   */
  BOUND = 'BOUND',

  /**
   * The bound approval request was explicitly approved by an authorized contact.
   */
  APPROVED = 'APPROVED',

  /**
   * The bound approval request was explicitly rejected by an authorized contact.
   */
  REJECTED = 'REJECTED',

  /**
   * The binding expired due to expiration deadline elapsed without decision.
   */
  EXPIRED = 'EXPIRED',

  /**
   * The binding was explicitly cancelled by the requesting user.
   */
  CANCELLED = 'CANCELLED',

  /**
   * The binding was invalidated (e.g., page reload, navigation, or DOM context drift).
   */
  INVALIDATED = 'INVALIDATED',
}

/**
 * String union representing valid ApprovalActionBindingState values.
 */
export type ApprovalActionBindingStateString =
  | 'BOUND'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'INVALIDATED';

/**
 * Canonical Action Fingerprint Descriptor capturing non-sensitive structural attributes of an action.
 * Strictly excludes form values, passwords, card numbers, OTPs, query parameters, and auth tokens.
 */
export interface ActionFingerprintDescriptor {
  readonly origin: string;
  readonly pathname: string;
  readonly actionType: ActionType;
  readonly targetTagName?: string;
  readonly targetId?: string;
  readonly targetName?: string;
  readonly formAction?: string;
  readonly formMethod?: string;
  readonly formFieldKeys?: readonly string[];
  readonly actionLabel?: string;
}

/**
 * Strongly typed domain entity representing the immutable 1:1 relationship between an
 * intercepted browser action and its corresponding backend approval request.
 */
export interface ApprovalActionBinding {
  /** Unique canonical identifier for the binding entity (prefixed with 'bnd_') */
  readonly id: string;

  /** Unique intercepted action identifier ('act_...') */
  readonly actionId: string;

  /** Unique canonical approval request identifier ('apr_...') */
  readonly requestId: string;

  /** Authoritative user ID who initiated the action and owns the request ('usr_...') */
  readonly requesterId: string;

  /** Current explicit lifecycle state of the binding */
  readonly state: ApprovalActionBindingState;

  /** Non-sensitive action structural fingerprint digest (SHA-256 hex string) */
  readonly actionDigest?: string;

  /** ISO 8601 UTC timestamp recording when this binding was created */
  readonly createdAt: string;

  /** ISO 8601 UTC timestamp recording when this binding expires */
  readonly expiresAt: string;

  /** Optional ISO 8601 UTC timestamp recording when the binding reached terminal state */
  readonly resolvedAt?: string;

  /** Optional non-sensitive explanation or reason */
  readonly reason?: string;
}

/**
 * Input descriptor for creating an ApprovalActionBinding.
 */
export interface CreateApprovalActionBindingInput {
  readonly actionId: string;
  readonly requestId: string;
  readonly requesterId: string;
  readonly actionDigest?: string;
  readonly createdAt?: string;
  readonly expiresAt: string;
  readonly state?: ApprovalActionBindingState;
  readonly reason?: string;
}

// =============================================================================
// Decision Metadata
// =============================================================================

/**
 * Decision metadata recorded when an authorized trusted contact resolves an approval request.
 * Present if and only if status is APPROVED or REJECTED.
 */
export interface ApprovalDecisionMetadata {
  /**
   * The authoritative verdict submitted by the reviewer (APPROVED or REJECTED).
   */
  readonly decision: 'APPROVED' | 'REJECTED';

  /**
   * Identifier of the authorized decision-maker (e.g., trusted contact ID 'tc_...').
   */
  readonly decidedBy: string;

  /**
   * ISO 8601 UTC timestamp when the decision was committed.
   */
  readonly decidedAt: string;

  /**
   * Optional non-sensitive reviewer explanation or justification note.
   */
  readonly decisionReason?: string;
}

// =============================================================================
// Canonical Approval Request Model
// =============================================================================

/**
 * Strongly typed approval request model representing an intercepted action submitted for review.
 *
 * PERSISTENCE NOTICE:
 * Represents the server-side entity and exchange contract. Not yet persisted in a database.
 */
export interface ApprovalRequest {
  /**
   * Unique canonical approval request identifier (e.g., 'apr_01J9X4M5N2...').
   */
  readonly id: string;

  /**
   * Reference to the specific intercepted action identifier being reviewed.
   * Strictly preserves the original actionId matching GuardrailAction and InterceptionRecord.
   */
  readonly actionId: string;

  /**
   * Authoritative identity of the authenticated user who initiated the request.
   * Strictly assigned by the server session/auth layer; never trusted from client JSON.
   */
  readonly requesterId: string;

  /**
   * Current lifecycle status in the approval state machine.
   */
  readonly status: ApprovalStatus;

  /**
   * Safe, human-readable summary describing the nature of the held action.
   * STRICT PRIVACY: Derived from element labels/actions; never user-typed input values.
   */
  readonly actionDescription: string;

  /**
   * Underlying interaction mechanism (CLICK, INPUT, SUBMIT, NAVIGATION).
   */
  readonly actionType: ActionType;

  /**
   * Semantic category classifying the domain intent of the action, if available.
   */
  readonly category?: ActionCategory;

  /**
   * Evaluated qualitative risk level from the Risk Engine (LOW, MEDIUM, HIGH, CRITICAL).
   */
  readonly riskLevel: RiskLevel;

  /**
   * Quantitative risk score on a 0-100 scale, evaluated by the Risk Engine.
   */
  readonly riskScore?: number;

  /**
   * Non-sensitive heuristic explanations justifying the risk assessment score.
   */
  readonly riskReasons: readonly string[];

  /**
   * Sanitized website origin where the action was intercepted (e.g., "https://example.com").
   * Strips path, query string, auth credentials, and hash.
   */
  readonly origin?: string;

  /**
   * Sanitized hostname of the website (e.g., "example.com").
   */
  readonly hostname?: string;

  /**
   * Safe document title of the webpage at the moment of interaction.
   */
  readonly pageTitle?: string;

  /**
   * ISO 8601 UTC timestamp recording when the approval request was created on the server.
   */
  readonly createdAt: string;

  /**
   * ISO 8601 UTC timestamp recording when this approval request expires and becomes invalid.
   */
  readonly expiresAt: string;

  /**
   * ISO 8601 UTC timestamp recording when this request reached a terminal state
   * (APPROVED, REJECTED, EXPIRED, CANCELLED). Undefined while in PENDING state.
   */
  readonly resolvedAt?: string;

  /**
   * Decision metadata recorded when an authorized contact resolves the request.
   * Present IF AND ONLY IF status is APPROVED or REJECTED. Undefined for PENDING, EXPIRED, CANCELLED.
   */
  readonly decision?: ApprovalDecisionMetadata;

  /**
   * Optional human-readable reason provided if the request was cancelled by the user.
   * Present ONLY when status is CANCELLED.
   */
  readonly cancellationReason?: string;

  /**
   * Reference to the unique binding entity associating this request with the action ('bnd_...').
   */
  readonly bindingId?: string;

  /**
   * Cryptographic / structural digest of the action's canonical non-sensitive attributes.
   * Proves structural action identity without exposing passwords, OTPs, cards, or form values.
   */
  readonly actionDigest?: string;
}

// =============================================================================
// Client Submission & Decision Input Payloads
// =============================================================================

/**
 * Client submission payload when requesting approval for a held action.
 * Excludes requesterId, status, and decisions to prevent client spoofing.
 */
export interface ClientApprovalRequestPayload {
  /** The intercepted action identifier matching client InterceptionRecord */
  readonly actionId: string;

  /** Safe, human-readable summary of the action */
  readonly actionDescription: string;

  /** Interaction mechanism */
  readonly actionType: ActionType;

  /** Semantic category if classified */
  readonly category?: ActionCategory;

  /** Evaluated risk level from client pipeline */
  readonly riskLevel: RiskLevel;

  /** Evaluated risk score from client pipeline */
  readonly riskScore?: number;

  /** Non-sensitive risk reasons */
  readonly riskReasons?: readonly string[];

  /** Sanitized website origin (scheme + domain + port) */
  readonly origin?: string;

  /** Sanitized website hostname */
  readonly hostname?: string;

  /** Sanitized webpage title */
  readonly pageTitle?: string;

  /** Optional action structural fingerprint digest computed at interception time */
  readonly actionDigest?: string;
}

/**
 * Input for submitting an approval verdict by an authorized trusted contact.
 */
export interface SubmitApprovalDecisionInput {
  /** Verdict (APPROVED or REJECTED) */
  readonly decision: 'APPROVED' | 'REJECTED';

  /** Authenticated decision-maker identity (trusted contact ID) */
  readonly decidedBy: string;

  /** Optional decision timestamp override (defaults to server current time) */
  readonly decidedAt?: string;

  /** Optional reviewer note or justification */
  readonly decisionReason?: string;
}

/**
 * Validation result returned by the ApprovalRequest validator.
 */
export interface ApprovalValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

// =============================================================================
// Day 9 Local Intent Prototype Models (Preserved for Extension Compatibility)
// =============================================================================

/**
 * Minimal safe metadata carrying a local intent to request approval for a held action.
 * Used exclusively within the browser extension prototype boundary.
 */
export interface ApprovalRequestIntent {
  /** Discriminator identifying this intent */
  readonly type: 'GUARDRAIL_APPROVAL_REQUEST_INTENT';

  /** Stable action identifier matching InterceptionRecord and GuardrailAction */
  readonly actionId: string;

  /** Safe, human-readable description of the held action */
  readonly description: string;

  /** Canonical semantic action category if available */
  readonly category?: ActionCategory;

  /** Evaluated risk level from the Risk Engine */
  readonly riskLevel: RiskLevel;

  /** Quantitative risk score from the Risk Engine (0-100) */
  readonly riskScore?: number;

  /** Sanitized website origin (scheme + domain + port, no paths/query/auth) */
  readonly origin?: string;

  /** Sanitized hostname */
  readonly hostname?: string;

  /** The interception state at the moment the intent was generated (must be HELD) */
  readonly interceptionState: InterceptionState;

  /** ISO 8601 timestamp when the user created this approval intent */
  readonly requestedAt: string;

  /** Demarcation explicitly identifying this as a local prototype intent */
  readonly status: 'LOCAL_PROTOTYPE_ONLY';
}

/**
 * Result returned by the approval request workflow (both prototype and real backend operations).
 */
export interface ApprovalRequestResult {
  readonly success: boolean;
  readonly actionId: string;
  readonly intent?: ApprovalRequestIntent;
  readonly error?: string;
  readonly isBackendConnected?: boolean;
  /** Server-created approval request record (when connected to real backend) */
  readonly request?: ApprovalRequest;
  /** Granular outcome code (e.g. CREATED_PENDING, ALREADY_PENDING, TIMEOUT_UNCERTAIN) */
  readonly outcome?: string;
  /** Whether the server-side outcome is authoritative or uncertain */
  readonly isAuthoritative?: boolean;
  /** Structured error details when submission fails */
  readonly errorDetails?: {
    readonly code: string;
    readonly message: string;
    readonly statusCode?: number;
    readonly details?: readonly string[];
  };
}

/**
 * Extension message sent from Content Script to Background Service Worker (legacy prototype).
 */
export interface GuardrailApprovalRequestMessage {
  readonly type: 'GUARDRAIL_APPROVAL_REQUEST';
  readonly intent: ApprovalRequestIntent;
}

/**
 * Response returned by the Background Service Worker acknowledgement (legacy prototype).
 */
export interface ApprovalRequestResponse {
  readonly success: boolean;
  readonly actionId: string;
  readonly message: string;
  readonly isBackendConnected: false;
}

/**
 * Extension message sent from Content Script to Background Service Worker to trigger real backend submission.
 */
export interface GuardrailSubmitApprovalRequestMessage {
  readonly type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST';
  readonly actionId: string;
  readonly context: StagingActionContext;
}

/**
 * Typed response returned by Background Service Worker for real backend submission.
 */
export interface GuardrailSubmitApprovalRequestResponse {
  readonly success: boolean;
  readonly actionId: string;
  readonly outcome: string;
  readonly isAuthoritative: boolean;
  readonly request?: ApprovalRequest;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly statusCode?: number;
    readonly details?: readonly string[];
  };
}

/**
 * Extension message sent from Content Script / Staging UI to Background Service Worker
 * to query the current status of an approval request.
 */
export interface GuardrailGetApprovalStatusMessage {
  readonly type: 'GUARDRAIL_GET_APPROVAL_STATUS';
  readonly requestId: string;
  readonly actionId?: string;
}

/**
 * Typed response returned by Background Service Worker for approval status lookup.
 */
export interface GuardrailGetApprovalStatusResponse {
  readonly success: boolean;
  readonly requestId: string;
  readonly status?: ApprovalStatusString;
  readonly isAuthoritative: boolean;
  readonly request?: ApprovalRequest;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly statusCode?: number;
    readonly details?: readonly string[];
  };
}


