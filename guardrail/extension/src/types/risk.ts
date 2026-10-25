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

import type { ResponseAction } from './response.js';

/**
 * Canonical lifecycle status for risk evaluation execution.
 */
export enum RiskEvaluationStatus {
  /**
   * The evaluation completed successfully and deterministically assessed the action.
   */
  EVALUATED = 'EVALUATED',

  /**
   * The evaluation failed due to malformed input, missing action identity,
   * unhandled rule execution error, or invalid evaluation context.
   */
  FAILED = 'FAILED',
}

/**
 * String union type representing valid RiskEvaluationStatus values.
 */
export type RiskEvaluationStatusString = 'EVALUATED' | 'FAILED';

/**
 * Standard error details provided when risk evaluation fails.
 */
export interface EvaluationError {
  /** Machine-readable error code (e.g. 'INVALID_ACTION_PAYLOAD', 'EVALUATION_EXCEPTION') */
  readonly code: string;

  /** Human-readable explanatory message */
  readonly message: string;

  /** Optional non-sensitive diagnostic details */
  readonly details?: unknown;
}

/**
 * Structured, machine-readable reason explaining a risk or policy decision.
 *
 * PRIVACY GUARANTEE:
 * Structured reasons explain contextual and heuristic risk characteristics only.
 * They strictly never store or log user input values, passwords, card numbers, or OTPs.
 */
export interface EvaluationReason {
  /** Stable machine-readable reason code (e.g. 'SIGNAL_PAYMENT', 'POLICY_THRESHOLD_PROTECT', 'EVALUATION_ERROR') */
  readonly code: string;

  /** Human-readable message explaining the reason */
  readonly message: string;

  /** Identifier of the rule that produced this reason, if applicable */
  readonly ruleId?: string;

  /** Associated risk signal, if applicable */
  readonly signalId?: RiskSignalId;

  /** Severity level associated with this reason */
  readonly severity?: RiskLevel;

  /** Quantitative score contribution from this reason, if applicable */
  readonly scoreContribution?: number;
}

/**
 * Information describing a matched rule during risk evaluation.
 */
export interface MatchedRuleInfo {
  /** Machine-readable identifier of the matching rule (e.g. 'RISK_RULE_PAYMENT') */
  readonly ruleId: string;

  /** Associated risk signal identifier */
  readonly signalId: RiskSignalId;

  /** Quantitative score contributed by this rule */
  readonly scoreContribution: number;

  /** Human-readable explanation from the rule */
  readonly reason: string;

  /** High-level description of what this rule inspects */
  readonly description?: string;
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
   * - 0 to 24: Low operational or security impact (routine read/navigation).
   * - 25 to 49: Moderate impact (reversible state modifications, low-stakes input).
   * - 50 to 74: High impact (sensitive data, payment triggers, authentication changes).
   * - 75 to 100: Critical impact (irreversible deletions, privilege escalation, destructive purges).
   *
   * NOTE: The score is a heuristic measure of sensitivity under Guardrail policy.
   * It is NOT a statistical probability of malice or fraud.
   * In evaluation failures, score reflects fail-closed maximum sensitivity (100).
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

  /**
   * Lifecycle status of the evaluation: EVALUATED or FAILED.
   * Defaults to EVALUATED for standard successful assessments.
   */
  status?: RiskEvaluationStatus;

  /**
   * True if evaluation completed normally; false if evaluation failed.
   */
  success?: boolean;

  /**
   * Strongly typed, structured reasons providing machine-readable codes and rule attribution.
   */
  structuredReasons?: readonly EvaluationReason[];

  /**
   * Identifiers and descriptions of all discrete rules that fired during evaluation.
   */
  matchedRules?: readonly MatchedRuleInfo[];

  /**
   * Diagnostic error details if status is FAILED.
   */
  error?: EvaluationError;
}

/**
 * Canonical contract for a complete risk-evaluation and policy-decision result.
 * Unifies the sensitivity assessment (score, riskLevel, matchedRules) and governance decision (ALLOW, WARN, PROTECT).
 */
export interface RiskEvaluationResult {
  /** Unique action identifier correlating the evaluation to the captured action */
  readonly actionId: string;

  /** Explicit operational decision: ALLOW, WARN, or PROTECT */
  readonly decision: ResponseAction;

  /** Evaluation lifecycle status: EVALUATED vs FAILED */
  readonly status: RiskEvaluationStatus;

  /** Boolean indicating whether evaluation completed without errors */
  readonly success: boolean;

  /** Categorical risk sensitivity level */
  readonly riskLevel: RiskLevel;

  /**
   * Quantitative score bounded to [0, 100].
   * Meaning: Heuristic indicator of sensitivity and blast radius under Guardrail policies.
   * It is NOT a statistical probability of malice or fraud.
   */
  readonly score: number;

  /** Backward-compatible array of human-readable explanation strings */
  readonly reasons: readonly string[];

  /** Strongly typed structured reasons with stable codes and attribution */
  readonly structuredReasons: readonly EvaluationReason[];

  /** Discrete risk rules that matched during evaluation */
  readonly matchedRules: readonly MatchedRuleInfo[];

  /** Identifier of the response policy rule applied */
  readonly policyRuleId?: string;

  /** ISO 8601 evaluation timestamp */
  readonly evaluatedAt: string;

  /** Populated with error details when status === RiskEvaluationStatus.FAILED */
  readonly error?: EvaluationError;
}
