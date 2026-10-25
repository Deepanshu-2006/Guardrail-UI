/**
 * Guardrail Risk Response Layer Types
 *
 * Defines the canonical response actions that Guardrail can take
 * based on risk assessment outcomes, policy configurations, and user settings.
 *
 * ARCHITECTURAL PRINCIPLE:
 * Response actions determine HOW Guardrail manages or mediates an interaction.
 * They are intentionally decoupled from the risk assessment score and risk level.
 *
 * IMPORTANT:
 * PROTECT indicates that the action requires a stronger protection mechanism before
 * proceeding. It does NOT yet mean blocking the action, requesting remote approval,
 * sending an SMS, contacting a family member, or opening staging mode.
 * Those mechanisms are specific enforcement strategies to be implemented later.
 */

/**
 * Initial Guardrail response actions.
 */
export enum ResponseAction {
  /**
   * The action can continue without additional Guardrail intervention.
   * Typical for standard, low-risk, or benign interactions.
   */
  ALLOW = 'ALLOW',

  /**
   * Guardrail should inform the user that the action deserves attention before continuing.
   * Serves as an advisory notification, visual cue, or confirmation prompt without hard impediment.
   */
  WARN = 'WARN',

  /**
   * The action requires a stronger protection mechanism before it should proceed.
   * Signals that execution must be gated pending stronger protective intervention.
   */
  PROTECT = 'PROTECT',
}

import { EvaluationError, EvaluationReason, RiskEvaluationStatus } from './risk.js';

/**
 * String union type representing valid ResponseAction values.
 */
export type ResponseActionString = 'ALLOW' | 'WARN' | 'PROTECT';

/**
 * Validates whether an arbitrary value is a canonical ResponseAction.
 *
 * @param value Candidate value to validate
 * @returns Validation outcome with typed action or descriptive error
 */
export function validateResponseAction(value: unknown): {
  valid: boolean;
  action?: ResponseAction;
  error?: string;
} {
  if (
    value === ResponseAction.ALLOW ||
    value === ResponseAction.WARN ||
    value === ResponseAction.PROTECT
  ) {
    return { valid: true, action: value };
  }
  return {
    valid: false,
    error: `Invalid ResponseAction "${String(value)}". Must be strictly one of: ALLOW, WARN, PROTECT.`,
  };
}

/**
 * Resolves an unknown or candidate decision value fail-closed.
 *
 * CRITICAL SECURITY INVARIANT:
 * Malformed, null, undefined, or unrecognized decision values must NEVER silently downgrade to ALLOW.
 * If candidate is invalid, strictly returns ResponseAction.PROTECT.
 *
 * @param candidate Unknown input value
 * @param fallbackReason Optional custom explanation of why fallback was invoked
 */
export function resolveFailClosedDecision(
  candidate: unknown,
  fallbackReason?: string
): { decision: ResponseAction; isFallback: boolean; reason: string } {
  if (
    candidate === ResponseAction.ALLOW ||
    candidate === ResponseAction.WARN ||
    candidate === ResponseAction.PROTECT
  ) {
    return {
      decision: candidate,
      isFallback: false,
      reason: `Valid decision "${candidate}" confirmed.`,
    };
  }

  const msg =
    fallbackReason ||
    `Security safeguard: Malformed, unknown, or missing decision value "${String(candidate)}" resolved fail-closed to PROTECT.`;

  return {
    decision: ResponseAction.PROTECT,
    isFallback: true,
    reason: msg,
  };
}

/**
 * Decision rendered by the Guardrail Risk Response layer.
 *
 * Represents the governance outcome determined AFTER risk assessment has completed.
 * Specifies the operational stance (ALLOW, WARN, PROTECT) alongside human-readable
 * rationales, strictly omitting sensitive form values, credentials, or secrets.
 */
export interface ResponseDecision {
  /**
   * Reference to the unique identifier of the GuardrailAction being governed.
   * Maintains end-to-end correlation across capture, classification, risk assessment, and response.
   */
  actionId: string;

  /**
   * The operational response action to execute for this interaction.
   */
  response: ResponseAction;

  /**
   * Human-readable explanations justifying why this response action was selected.
   *
   * PRIVACY GUARANTEE:
   * Contains only non-sensitive policy rationales (e.g., "High-risk action requires confirmation under standard policy").
   * Never contains user input values, passwords, card numbers, OTPs, or form payloads.
   */
  reasons: string[];

  /**
   * ISO 8601 timestamp recording exactly when the response decision was made.
   */
  createdAt: string;

  /**
   * Lifecycle status of the policy evaluation (EVALUATED vs FAILED).
   */
  status?: RiskEvaluationStatus;

  /**
   * True if policy evaluation succeeded; false if failed.
   */
  success?: boolean;

  /**
   * Identifier of the policy rule that rendered this response decision (e.g. 'RULE_CORE_RISK_LEVEL_RESPONSE').
   */
  policyRuleId?: string;

  /**
   * Strongly typed structured reasons explaining this decision.
   */
  structuredReasons?: readonly EvaluationReason[];

  /**
   * Diagnostic error details if status is FAILED.
   */
  error?: EvaluationError;
}
