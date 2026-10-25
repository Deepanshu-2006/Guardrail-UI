/**
 * Guardrail Risk-Policy Configuration Schema Types
 *
 * Defines the typed, validated configuration schema for the risk-policy settings
 * that genuinely require configuration across Guardrail components.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. ZERO NOISE / NO MISLEADING FIELDS: Only covers settings supported by the current risk engine.
 * 2. SEPARATION OF CONCERNS: Pure static policy configuration; strictly separated from runtime action state.
 * 3. IMMUTABLE SECURITY INVARIANTS: Non-configurable protections (e.g. destructive action protection,
 *    unsupported boundary fail-closed) cannot be weakened or bypassed by configuration.
 * 4. BOUNDED & DOCUMENTED THRESHOLDS: Numeric ranges are strictly validated with explicit interpretations.
 * 5. ZERO SENSITIVE DATA: Passwords, OTPs, PINs, card numbers, CVVs, tokens, and form data are strictly forbidden.
 */

import { ActionType } from './actions.js';
import { ResponseAction } from './response.js';
import { RiskPolicyId } from './policy.js';
import { RiskSignalId } from './risk.js';

/**
 * Numeric boundaries defining categorical RiskLevels.
 *
 * DOCUMENTED INTERPRETATIONS:
 * - 0 to lowMax: LOW (Routine, benign, or reversible read/navigation interactions)
 * - (lowMax + 1) to mediumMax: MEDIUM (Moderate operational impact or low-stakes changes)
 * - (mediumMax + 1) to highMax: HIGH (Sensitive workflows, checkout triggers, auth boundaries)
 * - (highMax + 1) to 100: CRITICAL (Severe/irreversible impact, permanent deletions, account closure)
 *
 * NUMERIC CONSTRAINTS:
 * - 5 <= lowMax <= 35 (default: 24)
 * - lowMax < mediumMax <= 65 (default: 49)
 * - mediumMax < highMax <= 85 (default: 74)
 * - CRITICAL threshold cannot be pushed above 86.
 */
export interface RiskThresholdSettings {
  /** Maximum score for LOW risk level (inclusive) */
  readonly lowMax: number;

  /** Maximum score for MEDIUM risk level (inclusive) */
  readonly mediumMax: number;

  /** Maximum score for HIGH risk level (inclusive) */
  readonly highMax: number;
}

/**
 * Configurable score contribution and enablement for an observable risk signal.
 */
export interface ConfigurableSignalSetting {
  /** Canonical signal identifier */
  readonly id: RiskSignalId;

  /** Whether this signal is active in risk calculations */
  readonly enabled: boolean;

  /**
   * Quantitative score contribution added when this signal fires.
   * Integer strictly bounded between 0 and 100.
   */
  readonly scoreContribution: number;
}

/**
 * Configurable policy rule defining operational response behavior for specific interactions.
 */
export interface ConfigurablePolicyRule {
  /** Canonical policy identifier */
  readonly id: RiskPolicyId;

  /** Human-readable policy title */
  readonly name: string;

  /** Whether this policy rule is active */
  readonly enabled: boolean;

  /**
   * Supported interaction types this policy evaluates.
   * Must be a non-empty subset of canonical ActionType values.
   */
  readonly actionTypes: readonly ActionType[];

  /**
   * Operational response decision rendered when policy matches.
   * Strictly one of: ALLOW, WARN, PROTECT.
   * Sensitive/destructive rules are restricted from selecting ALLOW.
   */
  readonly decision: ResponseAction;

  /**
   * Deterministic evaluation priority.
   * Higher priority rules evaluate first during tie-breaking.
   * Bounded integer between 1 and 1000.
   */
  readonly priority: number;

  /** Canonical reason code attributed to this policy (e.g. 'POLICY_PROTECT_DESTRUCTIVE') */
  readonly reasonCode: string;

  /** User-facing explanation explaining why this policy is enforced */
  readonly userExplanation: string;

  /**
   * Flags whether this policy enforces a non-configurable security invariant.
   * If true, this rule cannot be disabled or downgraded to WARN/ALLOW.
   */
  readonly isImmutableSecurityInvariant?: boolean;
}

/**
 * Operational timeouts and polling intervals.
 */
export interface OperationalTimeouts {
  /**
   * Duration in seconds before an in-memory/backend approval request expires.
   * Bounded integer between 60 (1 min) and 86400 (24 hours). Default: 3600 (1 hour).
   */
  readonly approvalTtlSeconds: number;

  /**
   * Interval in milliseconds between background dashboard status checks.
   * Bounded integer between 1000 (1 sec) and 60000 (60 sec). Default: 10000 (10 sec).
   */
  readonly dashboardPollIntervalMs: number;
}

/**
 * Complete, strongly typed Guardrail Risk-Policy Configuration document.
 */
export interface GuardrailPolicyConfig {
  /**
   * Schema format version (semver string, e.g. '1.0.0').
   * Used to guarantee forward/backward compatibility across releases.
   */
  readonly schemaVersion: string;

  /**
   * Policy version identifier (semver string, e.g. '1.0.0').
   * Included in approval requests and verified during continuation to prevent version skew.
   */
  readonly policyVersion: string;

  /**
   * ISO 8601 UTC timestamp string recording when this configuration was generated or updated.
   */
  readonly updatedAt: string;

  /**
   * Numeric thresholds defining risk tier boundaries.
   */
  readonly thresholds: RiskThresholdSettings;

  /**
   * Configurable weights and activation for supported risk signals.
   */
  readonly signals: Readonly<Record<RiskSignalId, ConfigurableSignalSetting>>;

  /**
   * Ordered list of supported risk policy definitions.
   */
  readonly policies: readonly ConfigurablePolicyRule[];

  /**
   * Whitelist of trusted domains exempt from external navigation warnings.
   * Each entry must be a valid hostname (e.g. 'internal.company.com', 'login.partner.org').
   */
  readonly trustedDomains: readonly string[];

  /**
   * Operational timeout and polling configurations.
   */
  readonly timeouts: OperationalTimeouts;
}

/**
 * Detailed error record for a specific configuration validation failure.
 */
export interface PolicyConfigValidationErrorDetail {
  /** The property path or field name that failed validation */
  readonly field: string;

  /** Machine-readable error code */
  readonly code: string;

  /** Human-readable explanation of why validation failed */
  readonly message: string;

  /** The actual invalid value encountered */
  readonly actualValue?: unknown;
}

/**
 * Outcome of validating a configuration object against the schema.
 */
export interface PolicyConfigValidationResult {
  /** True if the configuration strictly satisfies all schema rules and security invariants */
  readonly valid: boolean;

  /** List of validation errors encountered (empty if valid is true) */
  readonly errors: readonly PolicyConfigValidationErrorDetail[];

  /** The validated and frozen configuration object (undefined if valid is false) */
  readonly config?: GuardrailPolicyConfig;
}
