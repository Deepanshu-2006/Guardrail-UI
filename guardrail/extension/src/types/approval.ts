/**
 * Guardrail Approval Request Intent & Messaging Contract
 *
 * Defines the strongly typed local approval-request intent generated when a user
 * requests approval for a held action in Staging Mode.
 *
 * ARCHITECTURAL PRINCIPLES & BOUNDARIES:
 * 1. LOCAL PROTOTYPE BOUNDARY:
 *    - Captures the user's intent to request approval locally.
 *    - Strictly does NOT claim or pretend that a remote backend, WebSocket connection,
 *      push notification, or caretaker review mechanism is active.
 * 2. PRIVACY & LEAST PRIVILEGE:
 *    - Strictly excludes user input values, passwords, OTPs, card numbers, cookies,
 *      authentication tokens, or arbitrary form contents.
 *    - Carries only the minimal safe metadata: actionId, description, category,
 *      riskLevel, riskScore, sanitized origin, sanitized hostname, and timestamps.
 * 3. STATE IMMUTABILITY:
 *    - Keeps the protected action in HELD state.
 *    - Never transitions to CONTINUED or executes the action handler.
 * 4. COMPATIBLE EXTENSION MESSAGING:
 *    - Reuses the extension message format (type: 'GUARDRAIL_APPROVAL_REQUEST')
 *      so that future background-to-backend dispatchers can consume it directly.
 */

import { ActionCategory } from './actions.js';
import { InterceptionState } from './interception.js';
import { RiskLevel } from './risk.js';

/**
 * Minimal safe metadata carrying a local intent to request approval for a held action.
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
 * Result returned by the local approval request workflow.
 */
export interface ApprovalRequestResult {
  readonly success: boolean;
  readonly actionId: string;
  readonly intent?: ApprovalRequestIntent;
  readonly error?: string;
  readonly isBackendConnected: false;
}

/**
 * Extension message sent from Content Script to Background Service Worker.
 */
export interface GuardrailApprovalRequestMessage {
  readonly type: 'GUARDRAIL_APPROVAL_REQUEST';
  readonly intent: ApprovalRequestIntent;
}

/**
 * Response returned by the Background Service Worker acknowledgement.
 */
export interface ApprovalRequestResponse {
  readonly success: boolean;
  readonly actionId: string;
  readonly message: string;
  readonly isBackendConnected: false;
}
