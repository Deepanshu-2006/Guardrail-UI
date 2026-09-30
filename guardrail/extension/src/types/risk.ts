/**
 * Guardrail Risk Engine Models & Levels
 *
 * Defines the canonical risk levels for evaluating user and agent actions.
 *
 * ARCHITECTURAL PRINCIPLE:
 * Risk levels describe the outcome of Guardrail's risk assessment and sensitivity evaluation.
 * They signify potential operational, data-loss, or security impact.
 * They are NOT proof or confirmation that an action is malicious, fraudulent, or abusive.
 */

/**
 * Canonical risk severity levels evaluated by the Guardrail Risk Engine.
 */
export enum RiskLevel {
  /**
   * Low operational or security impact. Standard, benign, or routine read/navigation interactions.
   */
  LOW = 'LOW',

  /**
   * Moderate impact. State modifications, reversible changes, or low-stakes submissions.
   */
  MEDIUM = 'MEDIUM',

  /**
   * High impact. Sensitive data entry, financial workflows, authentication, or significant configuration updates.
   */
  HIGH = 'HIGH',

  /**
   * Severe/irreversible impact. Irrevocable deletions, bulk data purges, root privilege escalations, or critical resource termination.
   */
  CRITICAL = 'CRITICAL',
}

/**
 * String union type representing valid RiskLevel values.
 */
export type RiskLevelString = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Result of evaluating an action through the Guardrail Risk Engine.
 *
 * Captures the quantitative score, categorical risk level, and explainable
 * justification for an action without exposing sensitive user inputs or secrets.
 */
export interface RiskAssessment {
  /**
   * Reference to the unique identifier of the GuardrailAction that was evaluated.
   * Enables precise correlation across pipeline stages, logs, and telemetry.
   */
  actionId: string;

  /**
   * Quantitative risk score assigned to the action on a normalized scale of 0 to 100.
   *
   * Scale semantics:
   * - 0 to 25: Low operational or security impact (routine read/navigation).
   * - 26 to 50: Moderate impact (reversible state modifications, low-stakes input).
   * - 51 to 75: High impact (sensitive data, payment triggers, authentication changes).
   * - 76 to 100: Critical impact (irreversible deletions, privilege escalation, destructive purges).
   */
  score: number;

  /**
   * Qualitative severity level categorization derived from the risk score and policy rules.
   */
  riskLevel: RiskLevel;

  /**
   * Human-readable explanations describing why this score and risk level were assigned.
   *
   * PRIVACY & SECURITY GUARANTEE:
   * Contains only non-sensitive contextual reasons (e.g., "Target element is a destructive delete button",
   * "Action matches external payment submission").
   * Never contains raw input values, passwords, card numbers, OTPs, or form payloads.
   */
  reasons: string[];

  /**
   * ISO 8601 timestamp string representing the exact time the risk evaluation was performed.
   */
  evaluatedAt: string;
}
