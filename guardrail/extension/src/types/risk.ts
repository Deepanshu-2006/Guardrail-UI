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
 * Canonical identifiers for initial risk signals recognized by Guardrail.
 *
 * Each identifier represents a discrete, observable risk condition or operational trait
 * detected during an action's lifecycle.
 */
export enum RiskSignalId {
  /** Action interacts with financial, payment, or checkout operations */
  PAYMENT_ACTION = 'PAYMENT_ACTION',

  /** Action causes permanent deletion, removal, or irreversible destruction of resources/state */
  DESTRUCTIVE_ACTION = 'DESTRUCTIVE_ACTION',

  /** Action engages with authentication, credential handling, or security boundaries */
  AUTHENTICATION_ACTION = 'AUTHENTICATION_ACTION',

  /** Action initiates file downloads, binary exports, or local filesystem writes */
  DOWNLOAD_ACTION = 'DOWNLOAD_ACTION',

  /** Action navigates away from the trusted origin or application to an external domain */
  EXTERNAL_NAVIGATION = 'EXTERNAL_NAVIGATION',
}

/**
 * String union type representing valid RiskSignalId values.
 */
export type RiskSignalIdString =
  | 'PAYMENT_ACTION'
  | 'DESTRUCTIVE_ACTION'
  | 'AUTHENTICATION_ACTION'
  | 'DOWNLOAD_ACTION'
  | 'EXTERNAL_NAVIGATION';

/**
 * Declarative definition and configuration for a risk signal.
 *
 * Separates declarative signal metadata and configurable score contributions
 * from the evaluation engine runtime.
 */
export interface RiskSignalDefinition {
  /** Stable, unique machine-readable identifier for the signal */
  readonly id: RiskSignalId;

  /** Human-readable display name for the signal */
  readonly name: string;

  /**
   * Human-readable explanation of why this signal represents an elevated risk.
   * STRICT PRIVACY: Must never contain user inputs, passwords, card numbers, or form contents.
   */
  readonly reason: string;

  /**
   * Baseline quantitative score contribution (0 to 100) added or factored
   * when this signal is triggered. Configurable per environment or policy.
   */
  readonly scoreContribution: number;

  /**
   * High-level architectural description of what constitutes this signal.
   */
  readonly description: string;
}

/**
 * Represents an active risk signal triggered during evaluation of an action.
 */
export interface TriggeredRiskSignal {
  /** Stable identifier of the triggered signal */
  readonly id: RiskSignalId;

  /** Quantitative score contributed to the overall risk evaluation */
  readonly scoreContribution: number;

  /** Human-readable rationale for why this signal fired */
  readonly reason: string;
}

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
