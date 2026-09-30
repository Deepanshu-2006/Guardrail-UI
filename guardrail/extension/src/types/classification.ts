/**
 * Guardrail Action Classification Model
 *
 * Defines the strongly-typed data structures for representing the output
 * of the Action Classifier layer.
 */

import { ActionCategory } from './actions.js';

/**
 * Result of classifying a normalized GuardrailAction into a semantic category.
 *
 * Captures WHAT category an action belongs to and WHY (the matched rule/heuristics),
 * strictly decoupled from risk severity calculations and user-sensitive inputs.
 */
export interface ActionClassificationResult {
  /**
   * Reference to the unique identifier of the GuardrailAction that was evaluated.
   * Enables correlation across pipeline stages without mutating the source action.
   */
  actionId: string;

  /**
   * The determined semantic category for the action.
   */
  category: ActionCategory;

  /**
   * Identifier or name of the specific heuristic/pattern rule that matched.
   * Useful for traceability, policy auditing, and test debugging (e.g., 'AUTH_PASSWORD_INPUT', 'PAYMENT_SUBMIT_BUTTON').
   */
  matchedRule: string;

  /**
   * ISO 8601 timestamp indicating when the classification decision was made.
   */
  classifiedAt: string;

  /**
   * Optional human-readable rationale or explanation of why the rule matched.
   * Must contain non-sensitive metadata only (e.g., 'Matched keyword "checkout" in button label').
   */
  reason?: string;

  /**
   * Optional classification confidence score between 0.0 and 1.0 (defaults to 1.0 for deterministic rule matches).
   */
  confidence?: number;
}

/**
 * Convenient alias for ActionClassificationResult.
 */
export type ClassificationResult = ActionClassificationResult;
