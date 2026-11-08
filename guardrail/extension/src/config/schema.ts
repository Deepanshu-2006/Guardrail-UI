/**
 * Guardrail Risk-Policy Configuration Validator & Defaults
 *
 * Implements the validation engine, mandatory security invariants, fail-closed
 * fallback resolution, and default immutable configuration for Guardrail UI.
 *
 * ARCHITECTURAL REQUIREMENTS & SECURITY INVARIANTS:
 * 1. MANDATORY SECURITY INVARIANTS:
 *    - CONTROLLED_DESTRUCTIVE policy must be enabled and cannot be downgraded below PROTECT.
 *    - UNSUPPORTED_BOUNDARY_GUARD policy must be enabled and cannot be downgraded below PROTECT.
 *    - Sensitive boundary policies (PAYMENT, EXTERNAL_NAVIGATION, AUTHENTICATION_BOUNDARY)
 *      cannot be downgraded to ALLOW.
 * 2. BOUNDED THRESHOLDS:
 *    - 5 <= lowMax < mediumMax < highMax <= 85.
 * 3. ZERO PRIVACY INTRUSION:
 *    - Passwords, OTPs, PINs, card numbers, CVVs, tokens, and form values are strictly rejected.
 * 4. PURE CONFIGURATION:
 *    - Static policy schema completely isolated from runtime action/request state.
 * 5. SAFE FAIL-CLOSED RESOLUTION:
 *    - Any corrupt, null, or invalid configuration safely defaults to DEFAULT_GUARDRAIL_POLICY_CONFIG.
 */

import { ActionType } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import { RiskSignalId } from '../types/risk.js';
import {
  ConfigurablePolicyRule,
  ConfigurableSignalSetting,
  CURRENT_ARCHITECTURE_POLICY_VERSION,
  CURRENT_ARCHITECTURE_SCHEMA_VERSION,
  GuardrailPolicyConfig,
  MIN_SUPPORTED_POLICY_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  OperationalTimeouts,
  PolicyConfigValidationErrorDetail,
  PolicyConfigValidationResult,
  PolicySettingSpecification,
  RiskThresholdSettings,
  VersionCompatibilityResult,
} from '../types/config.js';

// =============================================================================
// Security Constants & Whitelists
// =============================================================================

/**
 * Permitted top-level property names for GuardrailPolicyConfig.
 * Any property outside this list is strictly rejected to prevent scope pollution.
 */
export const PERMITTED_CONFIG_TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'policyVersion',
  'updatedAt',
  'thresholds',
  'signals',
  'policies',
  'trustedDomains',
  'timeouts',
]);

/**
 * Permitted property names for RiskThresholdSettings.
 */
export const PERMITTED_THRESHOLD_FIELDS: ReadonlySet<string> = new Set([
  'lowMax',
  'mediumMax',
  'highMax',
]);

/**
 * Permitted property names for ConfigurableSignalSetting.
 */
export const PERMITTED_SIGNAL_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'enabled',
  'scoreContribution',
]);

/**
 * Permitted property names for ConfigurablePolicyRule.
 */
export const PERMITTED_POLICY_RULE_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'name',
  'enabled',
  'actionTypes',
  'decision',
  'priority',
  'reasonCode',
  'userExplanation',
  'isImmutableSecurityInvariant',
]);

/**
 * Permitted property names for OperationalTimeouts.
 */
export const PERMITTED_TIMEOUT_FIELDS: ReadonlySet<string> = new Set([
  'approvalTtlSeconds',
  'dashboardPollIntervalMs',
]);

/**
 * Regex patterns identifying forbidden sensitive property names or values.
 * Strictly rejected to guarantee zero credential leakage into configuration.
 */
export const FORBIDDEN_CONFIG_PATTERNS: readonly RegExp[] = Object.freeze([
  /password/i,
  /passphrase/i,
  /passwd/i,
  /secret/i,
  /\botp\b/i,
  /\bpin\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /credit[-_]?card/i,
  /debit[-_]?card/i,
  /card[-_]?number/i,
  /\bpan\b/i,
  /\btoken\b/i,
  /authtoken/i,
  /bearer/i,
  /cookie/i,
  /form[-_]?value/i,
  /input[-_]?value/i,
  /form[-_]?data/i,
  /raw[-_]?html/i,
  /raw[-_]?content/i,
]);

/**
 * Semver format regex for schemaVersion and policyVersion (e.g. '1.0.0', '1.2.3').
 */
export const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;

/**
 * Valid hostname regex for trustedDomains allowlist.
 */
export const HOSTNAME_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^localhost$/;

/**
 * Checks whether a candidate version string is semver-compatible with current architecture.
 *
 * RULES:
 * 1. Must match standard semver pattern (e.g. '1.0.0').
 * 2. Major version < 1 is STALE (rejected to prevent applying outdated policies).
 * 3. Major version > 1 is UNSUPPORTED (rejected to prevent future breaking policy formats).
 */
export function checkVersionCompatibility(
  version: unknown,
  fieldName = 'schemaVersion'
): VersionCompatibilityResult {
  if (!version || typeof version !== 'string') {
    return {
      compatible: false,
      code: 'INVALID_CONFIG_VERSION',
      message: `Version field "${fieldName}" must be a non-empty semver string.`,
      field: fieldName,
    };
  }

  const trimmed = version.trim();
  if (!SEMVER_REGEX.test(trimmed)) {
    return {
      compatible: false,
      code: 'INVALID_SEMVER_FORMAT',
      message: `Property "${fieldName}" must be a valid semantic version (e.g. "1.0.0"), got "${trimmed}".`,
      field: fieldName,
    };
  }

  const [majorStr] = trimmed.split('.');
  const major = parseInt(majorStr, 10);
  const minVersion = fieldName === 'policyVersion' ? MIN_SUPPORTED_POLICY_VERSION : MIN_SUPPORTED_SCHEMA_VERSION;

  if (isNaN(major) || major < 1) {
    return {
      compatible: false,
      code: 'STALE_CONFIG_VERSION',
      message: `Stale configuration version (v${trimmed}) cannot be applied; current architecture requires v${minVersion} or newer.`,
      field: fieldName,
    };
  }

  if (major > 1) {
    return {
      compatible: false,
      code: 'UNSUPPORTED_CONFIG_VERSION',
      message: `Unsupported configuration version (v${trimmed}); current architecture only supports v1.x.`,
      field: fieldName,
    };
  }

  return { compatible: true };
}

// =============================================================================
// Custom Validation Error
// =============================================================================

/**
 * Strongly typed error thrown when policy configuration violates schema or security invariants.
 */
export class PolicyConfigValidationError extends Error {
  public readonly code: string;
  public readonly field?: string;
  public readonly validationErrors?: readonly PolicyConfigValidationErrorDetail[];

  constructor(
    message: string,
    code = 'INVALID_POLICY_CONFIG',
    field?: string,
    validationErrors?: readonly PolicyConfigValidationErrorDetail[]
  ) {
    super(message);
    this.name = 'PolicyConfigValidationError';
    this.code = code;
    this.field = field;
    this.validationErrors = validationErrors;
    Object.setPrototypeOf(this, PolicyConfigValidationError.prototype);
  }
}

// =============================================================================
// Safe Default Immutable Configuration
// =============================================================================

/**
 * Baseline default Guardrail risk-policy configuration.
 * Fully compliant with all schema rules and immutable security invariants.
 */
/**
 * Explicit safe default risk thresholds.
 * Strictly bounded: 5 <= lowMax < mediumMax < highMax <= 85.
 */
export const DEFAULT_RISK_THRESHOLDS: Readonly<RiskThresholdSettings> = Object.freeze({
  lowMax: 24,
  mediumMax: 49,
  highMax: 74,
});

/**
 * Explicit safe default signal settings.
 * DESTRUCTIVE_ACTION is mandatory and cannot be disabled or lowered below 25.
 */
export const DEFAULT_SIGNAL_SETTINGS: Readonly<Record<RiskSignalId, ConfigurableSignalSetting>> = Object.freeze({
  [RiskSignalId.DESTRUCTIVE_ACTION]: Object.freeze({
    id: RiskSignalId.DESTRUCTIVE_ACTION,
    enabled: true,
    scoreContribution: 50,
  }),
  [RiskSignalId.PAYMENT_ACTION]: Object.freeze({
    id: RiskSignalId.PAYMENT_ACTION,
    enabled: true,
    scoreContribution: 40,
  }),
  [RiskSignalId.AUTHENTICATION_ACTION]: Object.freeze({
    id: RiskSignalId.AUTHENTICATION_ACTION,
    enabled: true,
    scoreContribution: 20,
  }),
  [RiskSignalId.EXTERNAL_NAVIGATION]: Object.freeze({
    id: RiskSignalId.EXTERNAL_NAVIGATION,
    enabled: true,
    scoreContribution: 20,
  }),
  [RiskSignalId.DOWNLOAD_ACTION]: Object.freeze({
    id: RiskSignalId.DOWNLOAD_ACTION,
    enabled: true,
    scoreContribution: 10,
  }),
  [RiskSignalId.SUSPICIOUS_URL]: Object.freeze({
    id: RiskSignalId.SUSPICIOUS_URL,
    enabled: true,
    scoreContribution: 25,
  }),
});

/**
 * Explicit safe default policy rules.
 * Preserves immutable security invariants (CONTROLLED_DESTRUCTIVE, UNSUPPORTED_BOUNDARY_GUARD).
 */
export const DEFAULT_POLICY_RULES: readonly ConfigurablePolicyRule[] = Object.freeze([
  Object.freeze({
    id: RiskPolicyId.CONTROLLED_DESTRUCTIVE,
    name: 'Controlled Irreversible / Destructive Action Policy',
    enabled: true,
    actionTypes: Object.freeze([ActionType.CLICK]),
    decision: ResponseAction.PROTECT,
    priority: 300,
    reasonCode: 'POLICY_PROTECT_DESTRUCTIVE',
    userExplanation:
      'Protective mechanism required: Irreversible destructive action detected on target element. Staging Mode initiated.',
    isImmutableSecurityInvariant: true,
  }),
  Object.freeze({
    id: RiskPolicyId.CONTROLLED_PAYMENT,
    name: 'Controlled Financial & Checkout Policy',
    enabled: true,
    actionTypes: Object.freeze([ActionType.CLICK, ActionType.SUBMIT]),
    decision: ResponseAction.WARN,
    priority: 250,
    reasonCode: 'POLICY_WARN_PAYMENT',
    userExplanation:
      'User advisory recommended: Action interacts with checkout or payment transaction flow.',
  }),
  Object.freeze({
    id: RiskPolicyId.EXTERNAL_NAVIGATION,
    name: 'External Navigation & Origin Boundary Policy',
    enabled: true,
    actionTypes: Object.freeze([ActionType.NAVIGATION, ActionType.CLICK]),
    decision: ResponseAction.WARN,
    priority: 200,
    reasonCode: 'POLICY_WARN_EXTERNAL_NAVIGATION',
    userExplanation:
      'User advisory recommended: Navigation redirects to an external origin across domain boundaries.',
  }),
  Object.freeze({
    id: RiskPolicyId.AUTHENTICATION_BOUNDARY,
    name: 'Authentication & Credential Boundary Policy',
    enabled: true,
    actionTypes: Object.freeze([ActionType.CLICK, ActionType.INPUT, ActionType.SUBMIT]),
    decision: ResponseAction.WARN,
    priority: 150,
    reasonCode: 'POLICY_WARN_AUTHENTICATION',
    userExplanation:
      'User advisory recommended: Action interacts with authentication, credential, or session boundaries.',
  }),
  Object.freeze({
    id: RiskPolicyId.ROUTINE_INTERACTION,
    name: 'Routine Interaction Policy',
    enabled: true,
    actionTypes: Object.freeze([ActionType.CLICK, ActionType.NAVIGATION]),
    decision: ResponseAction.ALLOW,
    priority: 100,
    reasonCode: 'POLICY_ALLOW_ROUTINE',
    userExplanation:
      'Action permitted without intervention: No elevated risk signals detected. Routine interaction.',
  }),
  Object.freeze({
    id: RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD,
    name: 'Unsupported Action Type & Corruption Guard Policy',
    enabled: true,
    actionTypes: Object.freeze([ActionType.INPUT, ActionType.SUBMIT, ActionType.NAVIGATION]),
    decision: ResponseAction.PROTECT,
    priority: 350,
    reasonCode: 'POLICY_FAIL_CLOSED_CORRUPT_PAYLOAD',
    userExplanation:
      'Protective mechanism required: Malformed or unverified action payload resolved fail-closed.',
    isImmutableSecurityInvariant: true,
  }),
]);

/**
 * Explicit safe default trusted domains list (empty by default).
 */
export const DEFAULT_TRUSTED_DOMAINS: readonly string[] = Object.freeze([]);

/**
 * Explicit safe default operational timeouts.
 */
export const DEFAULT_OPERATIONAL_TIMEOUTS: Readonly<OperationalTimeouts> = Object.freeze({
  approvalTtlSeconds: 3600,
  dashboardPollIntervalMs: 10000,
});

/**
 * Baseline default Guardrail risk-policy configuration.
 * Fully compliant with all schema rules and immutable security invariants.
 */
export const DEFAULT_GUARDRAIL_POLICY_CONFIG: Readonly<GuardrailPolicyConfig> = Object.freeze({
  schemaVersion: CURRENT_ARCHITECTURE_SCHEMA_VERSION,
  policyVersion: CURRENT_ARCHITECTURE_POLICY_VERSION,
  updatedAt: '2026-10-26T00:00:00.000Z',
  thresholds: DEFAULT_RISK_THRESHOLDS,
  signals: DEFAULT_SIGNAL_SETTINGS,
  policies: DEFAULT_POLICY_RULES,
  trustedDomains: DEFAULT_TRUSTED_DOMAINS,
  timeouts: DEFAULT_OPERATIONAL_TIMEOUTS,
});

export function getSafeDefaultPolicyConfig(): GuardrailPolicyConfig {
  return DEFAULT_GUARDRAIL_POLICY_CONFIG;
}

// =============================================================================
// Schema Validation Helpers
// =============================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
}

function checkForbiddenKeysOrStrings(
  obj: unknown,
  path: string,
  errors: PolicyConfigValidationErrorDetail[]
): void {
  if (typeof obj === 'string') {
    for (const pattern of FORBIDDEN_CONFIG_PATTERNS) {
      if (pattern.test(obj)) {
        errors.push({
          field: path,
          code: 'FORBIDDEN_SENSITIVE_DATA',
          message: `Configuration contains forbidden sensitive credential keyword matching ${pattern.source}`,
          actualValue: '[REDACTED]',
        });
        return;
      }
    }
  } else if (isPlainObject(obj)) {
    for (const key of Object.keys(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      for (const pattern of FORBIDDEN_CONFIG_PATTERNS) {
        if (pattern.test(key)) {
          errors.push({
            field: currentPath,
            code: 'FORBIDDEN_SENSITIVE_KEY',
            message: `Property name "${key}" matches forbidden sensitive credential pattern ${pattern.source}`,
            actualValue: key,
          });
          return;
        }
      }
      checkForbiddenKeysOrStrings(obj[key], currentPath, errors);
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      checkForbiddenKeysOrStrings(item, `${path}[${index}]`, errors);
    });
  }
}

// =============================================================================
// Core Schema Validator
// =============================================================================

/**
 * Validates an arbitrary input candidate against the Guardrail Risk-Policy Schema.
 *
 * Enforces:
 * 1. Required fields and exact structural types.
 * 2. Whitelist of permitted property names (zero scope leakage).
 * 3. Bounded numeric thresholds and score contributions.
 * 4. Rejection of unknown, malformed, or lowercased decision values.
 * 5. Detection of duplicate identifiers or conflicting policy rules.
 * 6. Mandatory, non-configurable security invariants:
 *    - CONTROLLED_DESTRUCTIVE cannot be disabled or downgraded from PROTECT.
 *    - UNSUPPORTED_BOUNDARY_GUARD cannot be disabled or downgraded from PROTECT.
 *    - Sensitive boundary policies cannot be set to ALLOW.
 * 7. Absolute prohibition of passwords, tokens, card numbers, or form values.
 *
 * @param candidate The candidate object to inspect
 * @returns Strongly typed PolicyConfigValidationResult
 */
export function validatePolicyConfig(candidate: unknown): PolicyConfigValidationResult {
  const errors: PolicyConfigValidationErrorDetail[] = [];

  // 1. Root-level object inspection
  if (!isPlainObject(candidate)) {
    return {
      valid: false,
      errors: [
        {
          field: 'root',
          code: 'INVALID_ROOT_TYPE',
          message: 'Policy configuration must be a valid non-null plain JSON object.',
          actualValue: typeof candidate,
        },
      ],
    };
  }

  // 2. Sensitive data scan across all keys and string values
  checkForbiddenKeysOrStrings(candidate, '', errors);

  // 3. Top-level property whitelist enforcement
  for (const key of Object.keys(candidate)) {
    if (!PERMITTED_CONFIG_TOP_LEVEL_FIELDS.has(key)) {
      errors.push({
        field: key,
        code: 'EXTRANEOUS_FIELD_REJECTED',
        message: `Extraneous or unsupported configuration property "${key}" is strictly forbidden.`,
        actualValue: key,
      });
    }
  }

  // 4. Validate schemaVersion
  const schemaVersion = candidate.schemaVersion;
  if (typeof schemaVersion !== 'string' || !schemaVersion.trim()) {
    errors.push({
      field: 'schemaVersion',
      code: 'MISSING_SCHEMA_VERSION',
      message: 'Property "schemaVersion" is required and must be a non-empty semver string.',
      actualValue: schemaVersion,
    });
  } else {
    const compat = checkVersionCompatibility(schemaVersion, 'schemaVersion');
    if (!compat.compatible) {
      errors.push({
        field: 'schemaVersion',
        code: compat.code || 'INVALID_CONFIG_VERSION',
        message: compat.message || `Property "schemaVersion" is incompatible with current architecture.`,
        actualValue: schemaVersion,
      });
    }
  }

  // 5. Validate policyVersion
  const policyVersion = candidate.policyVersion;
  if (typeof policyVersion !== 'string' || !policyVersion.trim()) {
    errors.push({
      field: 'policyVersion',
      code: 'MISSING_POLICY_VERSION',
      message: 'Property "policyVersion" is required and must be a non-empty semver string.',
      actualValue: policyVersion,
    });
  } else {
    const compat = checkVersionCompatibility(policyVersion, 'policyVersion');
    if (!compat.compatible) {
      errors.push({
        field: 'policyVersion',
        code: compat.code || 'INVALID_CONFIG_VERSION',
        message: compat.message || `Property "policyVersion" is incompatible with current architecture.`,
        actualValue: policyVersion,
      });
    }
  }

  // 6. Validate updatedAt timestamp
  const updatedAt = candidate.updatedAt;
  if (typeof updatedAt !== 'string' || !updatedAt.trim()) {
    errors.push({
      field: 'updatedAt',
      code: 'MISSING_UPDATED_AT',
      message: 'Property "updatedAt" is required and must be an ISO 8601 UTC timestamp string.',
      actualValue: updatedAt,
    });
  } else {
    const parsedDate = new Date(updatedAt);
    if (isNaN(parsedDate.getTime()) || !updatedAt.includes('T')) {
      errors.push({
        field: 'updatedAt',
        code: 'INVALID_TIMESTAMP_FORMAT',
        message: `Property "updatedAt" must be a valid ISO 8601 timestamp string, got "${updatedAt}".`,
        actualValue: updatedAt,
      });
    }
  }

  // 7. Validate RiskThresholdSettings
  const thresholds = candidate.thresholds;
  if (!isPlainObject(thresholds)) {
    errors.push({
      field: 'thresholds',
      code: 'MISSING_THRESHOLDS',
      message: 'Property "thresholds" is required and must be an object.',
      actualValue: typeof thresholds,
    });
  } else {
    for (const key of Object.keys(thresholds)) {
      if (!PERMITTED_THRESHOLD_FIELDS.has(key)) {
        errors.push({
          field: `thresholds.${key}`,
          code: 'EXTRANEOUS_FIELD_REJECTED',
          message: `Extraneous threshold field "${key}" is rejected.`,
          actualValue: key,
        });
      }
    }

    const { lowMax, mediumMax, highMax } = thresholds as Partial<RiskThresholdSettings>;

    if (!isInteger(lowMax)) {
      errors.push({
        field: 'thresholds.lowMax',
        code: 'INVALID_THRESHOLD_TYPE',
        message: 'Threshold "lowMax" must be a valid integer.',
        actualValue: lowMax,
      });
    } else if (lowMax < 5 || lowMax > 35) {
      errors.push({
        field: 'thresholds.lowMax',
        code: 'THRESHOLD_BOUNDARY_VIOLATION',
        message: `Threshold "lowMax" must be bounded between 5 and 35 (got ${lowMax}).`,
        actualValue: lowMax,
      });
    }

    if (!isInteger(mediumMax)) {
      errors.push({
        field: 'thresholds.mediumMax',
        code: 'INVALID_THRESHOLD_TYPE',
        message: 'Threshold "mediumMax" must be a valid integer.',
        actualValue: mediumMax,
      });
    } else if (mediumMax > 65) {
      errors.push({
        field: 'thresholds.mediumMax',
        code: 'THRESHOLD_BOUNDARY_VIOLATION',
        message: `Threshold "mediumMax" cannot exceed 65 (got ${mediumMax}).`,
        actualValue: mediumMax,
      });
    }

    if (!isInteger(highMax)) {
      errors.push({
        field: 'thresholds.highMax',
        code: 'INVALID_THRESHOLD_TYPE',
        message: 'Threshold "highMax" must be a valid integer.',
        actualValue: highMax,
      });
    } else if (highMax > 85) {
      errors.push({
        field: 'thresholds.highMax',
        code: 'THRESHOLD_BOUNDARY_VIOLATION',
        message: `Threshold "highMax" cannot exceed 85 to ensure CRITICAL risk starts no later than 86 (got ${highMax}).`,
        actualValue: highMax,
      });
    }

    // Monotonic strict ordering check
    if (isInteger(lowMax) && isInteger(mediumMax) && mediumMax <= lowMax) {
      errors.push({
        field: 'thresholds.mediumMax',
        code: 'THRESHOLD_ORDERING_VIOLATION',
        message: `Threshold ordering violation: "mediumMax" (${mediumMax}) must be strictly greater than "lowMax" (${lowMax}).`,
        actualValue: { lowMax, mediumMax },
      });
    }

    if (isInteger(mediumMax) && isInteger(highMax) && highMax <= mediumMax) {
      errors.push({
        field: 'thresholds.highMax',
        code: 'THRESHOLD_ORDERING_VIOLATION',
        message: `Threshold ordering violation: "highMax" (${highMax}) must be strictly greater than "mediumMax" (${mediumMax}).`,
        actualValue: { mediumMax, highMax },
      });
    }
  }

  // 8. Validate Risk Signals
  const signals = candidate.signals;
  if (!isPlainObject(signals)) {
    errors.push({
      field: 'signals',
      code: 'MISSING_SIGNALS',
      message: 'Property "signals" is required and must be an object.',
      actualValue: typeof signals,
    });
  } else {
    const requiredSignalIds = Object.values(RiskSignalId);
    for (const signalId of requiredSignalIds) {
      const signalEntry = signals[signalId];
      if (!isPlainObject(signalEntry)) {
        errors.push({
          field: `signals.${signalId}`,
          code: 'MISSING_REQUIRED_SIGNAL',
          message: `Required risk signal definition "${signalId}" is missing.`,
          actualValue: typeof signalEntry,
        });
        continue;
      }

      for (const key of Object.keys(signalEntry)) {
        if (!PERMITTED_SIGNAL_FIELDS.has(key)) {
          errors.push({
            field: `signals.${signalId}.${key}`,
            code: 'EXTRANEOUS_FIELD_REJECTED',
            message: `Extraneous signal field "${key}" is rejected.`,
            actualValue: key,
          });
        }
      }

      if (signalEntry.id !== signalId) {
        errors.push({
          field: `signals.${signalId}.id`,
          code: 'SIGNAL_ID_MISMATCH',
          message: `Signal entry key "${signalId}" does not match its internal id "${String(signalEntry.id)}".`,
          actualValue: signalEntry.id,
        });
      }

      if (typeof signalEntry.enabled !== 'boolean') {
        errors.push({
          field: `signals.${signalId}.enabled`,
          code: 'INVALID_SIGNAL_ENABLED_TYPE',
          message: `Signal "${signalId}" property "enabled" must be a boolean.`,
          actualValue: signalEntry.enabled,
        });
      }

      if (!isInteger(signalEntry.scoreContribution)) {
        errors.push({
          field: `signals.${signalId}.scoreContribution`,
          code: 'INVALID_SCORE_CONTRIBUTION',
          message: `Signal "${signalId}" property "scoreContribution" must be an integer.`,
          actualValue: signalEntry.scoreContribution,
        });
      } else if (signalEntry.scoreContribution < 0 || signalEntry.scoreContribution > 100) {
        errors.push({
          field: `signals.${signalId}.scoreContribution`,
          code: 'SCORE_CONTRIBUTION_OUT_OF_BOUNDS',
          message: `Signal "${signalId}" scoreContribution must be between 0 and 100 (got ${signalEntry.scoreContribution}).`,
          actualValue: signalEntry.scoreContribution,
        });
      }

      // Security Invariant: DESTRUCTIVE_ACTION signal cannot be silenced
      if (signalId === RiskSignalId.DESTRUCTIVE_ACTION) {
        if (signalEntry.enabled === false) {
          errors.push({
            field: `signals.${signalId}.enabled`,
            code: 'MANDATORY_SIGNAL_DISABLED',
            message: 'Security invariant violation: Destructive action signal cannot be disabled.',
            actualValue: signalEntry.enabled,
          });
        }
        if (typeof signalEntry.scoreContribution === 'number' && signalEntry.scoreContribution < 25) {
          errors.push({
            field: `signals.${signalId}.scoreContribution`,
            code: 'MANDATORY_SIGNAL_WEIGHT_TOO_LOW',
            message: `Security invariant violation: Destructive action score contribution cannot be lowered below 25 (got ${signalEntry.scoreContribution}).`,
            actualValue: signalEntry.scoreContribution,
          });
        }
      }
    }
  }

  // 9. Validate Policies List
  const policies = candidate.policies;
  if (!Array.isArray(policies)) {
    errors.push({
      field: 'policies',
      code: 'MISSING_POLICIES_ARRAY',
      message: 'Property "policies" is required and must be a non-empty array.',
      actualValue: typeof policies,
    });
  } else if (policies.length === 0) {
    errors.push({
      field: 'policies',
      code: 'EMPTY_POLICIES_ARRAY',
      message: 'Property "policies" array cannot be empty.',
      actualValue: 0,
    });
  } else {
    const seenPolicyIds = new Set<string>();
    const requiredPolicyIds = new Set(Object.values(RiskPolicyId));

    policies.forEach((rule, index) => {
      const prefix = `policies[${index}]`;
      if (!isPlainObject(rule)) {
        errors.push({
          field: prefix,
          code: 'INVALID_RULE_TYPE',
          message: `Policy rule at index ${index} must be a plain object.`,
          actualValue: typeof rule,
        });
        return;
      }

      for (const key of Object.keys(rule)) {
        if (!PERMITTED_POLICY_RULE_FIELDS.has(key)) {
          errors.push({
            field: `${prefix}.${key}`,
            code: 'EXTRANEOUS_FIELD_REJECTED',
            message: `Extraneous policy rule property "${key}" is rejected.`,
            actualValue: key,
          });
        }
      }

      // Validate ID
      const ruleId = rule.id as string;
      if (typeof ruleId !== 'string' || !ruleId.trim()) {
        errors.push({
          field: `${prefix}.id`,
          code: 'MISSING_POLICY_ID',
          message: `Policy rule at index ${index} is missing a valid id.`,
          actualValue: ruleId,
        });
      } else if (!Object.values(RiskPolicyId).includes(ruleId as RiskPolicyId)) {
        errors.push({
          field: `${prefix}.id`,
          code: 'UNRECOGNIZED_POLICY_ID',
          message: `Policy rule id "${ruleId}" is not a recognized canonical RiskPolicyId.`,
          actualValue: ruleId,
        });
      } else {
        if (seenPolicyIds.has(ruleId)) {
          errors.push({
            field: `${prefix}.id`,
            code: 'DUPLICATE_POLICY_IDENTIFIER',
            message: `Conflicting configuration: Duplicate policy rule definition for id "${ruleId}".`,
            actualValue: ruleId,
          });
        }
        seenPolicyIds.add(ruleId);
      }

      // Validate Name
      if (typeof rule.name !== 'string' || !rule.name.trim()) {
        errors.push({
          field: `${prefix}.name`,
          code: 'MISSING_POLICY_NAME',
          message: `Policy rule at index ${index} must have a non-empty name.`,
          actualValue: rule.name,
        });
      }

      // Validate Enabled
      if (typeof rule.enabled !== 'boolean') {
        errors.push({
          field: `${prefix}.enabled`,
          code: 'INVALID_POLICY_ENABLED_TYPE',
          message: `Policy rule "${ruleId || index}" property "enabled" must be a boolean.`,
          actualValue: rule.enabled,
        });
      }

      // Validate ActionTypes
      if (!Array.isArray(rule.actionTypes) || rule.actionTypes.length === 0) {
        errors.push({
          field: `${prefix}.actionTypes`,
          code: 'INVALID_ACTION_TYPES',
          message: `Policy rule "${ruleId || index}" must specify a non-empty array of actionTypes.`,
          actualValue: rule.actionTypes,
        });
      } else {
        const seenActionTypes = new Set<string>();
        for (const actionType of rule.actionTypes) {
          if (!Object.values(ActionType).includes(actionType)) {
            errors.push({
              field: `${prefix}.actionTypes`,
              code: 'UNRECOGNIZED_ACTION_TYPE',
              message: `Unrecognized action type "${String(actionType)}" in policy rule "${ruleId}".`,
              actualValue: actionType,
            });
          } else if (seenActionTypes.has(actionType)) {
            errors.push({
              field: `${prefix}.actionTypes`,
              code: 'DUPLICATE_ACTION_TYPE',
              message: `Duplicate action type "${actionType}" in policy rule "${ruleId}".`,
              actualValue: actionType,
            });
          }
          seenActionTypes.add(actionType);
        }
      }

      // Validate Decision
      const decision = rule.decision as ResponseAction;
      const validDecisions = Object.values(ResponseAction);
      if (!validDecisions.includes(decision)) {
        errors.push({
          field: `${prefix}.decision`,
          code: 'INVALID_DECISION_VALUE',
          message: `Invalid decision "${String(decision)}" in policy "${ruleId}". Must be strictly one of: ALLOW, WARN, PROTECT.`,
          actualValue: decision,
        });
      }

      // Validate Priority
      if (!isInteger(rule.priority)) {
        errors.push({
          field: `${prefix}.priority`,
          code: 'INVALID_PRIORITY_TYPE',
          message: `Policy rule "${ruleId || index}" priority must be an integer.`,
          actualValue: rule.priority,
        });
      } else if (rule.priority < 1 || rule.priority > 1000) {
        errors.push({
          field: `${prefix}.priority`,
          code: 'PRIORITY_OUT_OF_BOUNDS',
          message: `Policy rule priority must be bounded between 1 and 1000 (got ${rule.priority}).`,
          actualValue: rule.priority,
        });
      }

      // Validate ReasonCode
      if (typeof rule.reasonCode !== 'string' || !rule.reasonCode.trim()) {
        errors.push({
          field: `${prefix}.reasonCode`,
          code: 'MISSING_REASON_CODE',
          message: `Policy rule "${ruleId || index}" must specify a non-empty reasonCode.`,
          actualValue: rule.reasonCode,
        });
      } else if (!/^[A-Z0-9_]+$/.test(rule.reasonCode.trim())) {
        errors.push({
          field: `${prefix}.reasonCode`,
          code: 'INVALID_REASON_CODE_FORMAT',
          message: `Reason code "${rule.reasonCode}" must follow uppercase alphanumeric format (e.g. "POLICY_WARN_PAYMENT").`,
          actualValue: rule.reasonCode,
        });
      }

      // Validate UserExplanation
      if (typeof rule.userExplanation !== 'string' || rule.userExplanation.trim().length < 5) {
        errors.push({
          field: `${prefix}.userExplanation`,
          code: 'INVALID_USER_EXPLANATION',
          message: `Policy rule "${ruleId || index}" userExplanation must be a descriptive string of at least 5 characters.`,
          actualValue: rule.userExplanation,
        });
      }

      // =========================================================================
      // MANDATORY SECURITY INVARIANTS ENFORCEMENT
      // =========================================================================

      // 1. CONTROLLED_DESTRUCTIVE cannot be disabled or downgraded
      if (ruleId === RiskPolicyId.CONTROLLED_DESTRUCTIVE) {
        if (rule.enabled === false) {
          errors.push({
            field: `${prefix}.enabled`,
            code: 'MANDATORY_POLICY_DISABLED',
            message: 'Mandatory security invariant violation: Controlled destructive policy cannot be disabled.',
            actualValue: rule.enabled,
          });
        }
        if (decision !== ResponseAction.PROTECT) {
          errors.push({
            field: `${prefix}.decision`,
            code: 'MANDATORY_PROTECTION_DOWNGRADE',
            message: `Mandatory security invariant violation: Controlled destructive policy decision cannot be downgraded from PROTECT to ${String(decision)}.`,
            actualValue: decision,
          });
        }
      }

      // 2. UNSUPPORTED_BOUNDARY_GUARD cannot be disabled or downgraded
      if (ruleId === RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD) {
        if (rule.enabled === false) {
          errors.push({
            field: `${prefix}.enabled`,
            code: 'MANDATORY_POLICY_DISABLED',
            message: 'Mandatory security invariant violation: Fail-closed unsupported boundary guard policy cannot be disabled.',
            actualValue: rule.enabled,
          });
        }
        if (decision !== ResponseAction.PROTECT) {
          errors.push({
            field: `${prefix}.decision`,
            code: 'MANDATORY_PROTECTION_DOWNGRADE',
            message: `Mandatory security invariant violation: Fail-closed corruption guard policy decision cannot be downgraded from PROTECT to ${String(decision)}.`,
            actualValue: decision,
          });
        }
      }

      // 3. Sensitive policies cannot be downgraded to ALLOW
      if (
        ruleId === RiskPolicyId.CONTROLLED_PAYMENT ||
        ruleId === RiskPolicyId.EXTERNAL_NAVIGATION ||
        ruleId === RiskPolicyId.AUTHENTICATION_BOUNDARY
      ) {
        if (decision === ResponseAction.ALLOW) {
          errors.push({
            field: `${prefix}.decision`,
            code: 'PROHIBITED_ALLOW_DECISION',
            message: `Security invariant violation: Sensitive boundary policy "${ruleId}" cannot be configured to ALLOW. Permitted: WARN or PROTECT.`,
            actualValue: decision,
          });
        }
      }

      // 4. ROUTINE_INTERACTION policy decision must be ALLOW
      if (ruleId === RiskPolicyId.ROUTINE_INTERACTION && decision !== ResponseAction.ALLOW) {
        errors.push({
          field: `${prefix}.decision`,
          code: 'ROUTINE_POLICY_DECISION_INVALID',
          message: `Routine interaction policy decision must be ALLOW, got ${String(decision)}.`,
          actualValue: decision,
        });
      }
    });

    // Verify all canonical policies are present
    for (const reqId of requiredPolicyIds) {
      if (!seenPolicyIds.has(reqId)) {
        errors.push({
          field: 'policies',
          code: 'MISSING_REQUIRED_POLICY_RULE',
          message: `Configuration is missing required canonical policy rule "${reqId}".`,
          actualValue: reqId,
        });
      }
    }
  }

  // 10. Validate Trusted Domains Allowlist
  const trustedDomains = candidate.trustedDomains;
  if (!Array.isArray(trustedDomains)) {
    errors.push({
      field: 'trustedDomains',
      code: 'MISSING_TRUSTED_DOMAINS',
      message: 'Property "trustedDomains" is required and must be an array of hostname strings.',
      actualValue: typeof trustedDomains,
    });
  } else {
    const seenDomains = new Set<string>();
    trustedDomains.forEach((domain, idx) => {
      const fieldPath = `trustedDomains[${idx}]`;
      if (typeof domain !== 'string' || !domain.trim()) {
        errors.push({
          field: fieldPath,
          code: 'INVALID_DOMAIN_TYPE',
          message: `Trusted domain entry at index ${idx} must be a non-empty string.`,
          actualValue: domain,
        });
        return;
      }

      const normalized = domain.trim().toLowerCase();

      if (normalized.includes('://') || normalized.includes('/') || normalized.includes('?') || normalized.includes(':')) {
        errors.push({
          field: fieldPath,
          code: 'INVALID_DOMAIN_FORMAT',
          message: `Trusted domain "${domain}" must be a pure hostname without protocol scheme, port, or path.`,
          actualValue: domain,
        });
      } else if (!HOSTNAME_REGEX.test(normalized)) {
        errors.push({
          field: fieldPath,
          code: 'INVALID_HOSTNAME_SYNTAX',
          message: `Trusted domain "${domain}" does not match valid hostname syntax.`,
          actualValue: domain,
        });
      }

      if (seenDomains.has(normalized)) {
        errors.push({
          field: fieldPath,
          code: 'DUPLICATE_TRUSTED_DOMAIN',
          message: `Duplicate trusted domain "${domain}" detected.`,
          actualValue: domain,
        });
      }
      seenDomains.add(normalized);
    });
  }

  // 11. Validate Operational Timeouts
  const timeouts = candidate.timeouts;
  if (!isPlainObject(timeouts)) {
    errors.push({
      field: 'timeouts',
      code: 'MISSING_TIMEOUTS',
      message: 'Property "timeouts" is required and must be an object.',
      actualValue: typeof timeouts,
    });
  } else {
    for (const key of Object.keys(timeouts)) {
      if (!PERMITTED_TIMEOUT_FIELDS.has(key)) {
        errors.push({
          field: `timeouts.${key}`,
          code: 'EXTRANEOUS_FIELD_REJECTED',
          message: `Extraneous timeout property "${key}" is rejected.`,
          actualValue: key,
        });
      }
    }

    const { approvalTtlSeconds, dashboardPollIntervalMs } = timeouts as Partial<OperationalTimeouts>;

    if (!isInteger(approvalTtlSeconds)) {
      errors.push({
        field: 'timeouts.approvalTtlSeconds',
        code: 'INVALID_TIMEOUT_TYPE',
        message: 'Timeout "approvalTtlSeconds" must be a valid integer.',
        actualValue: approvalTtlSeconds,
      });
    } else if (approvalTtlSeconds < 60 || approvalTtlSeconds > 86400) {
      errors.push({
        field: 'timeouts.approvalTtlSeconds',
        code: 'TIMEOUT_OUT_OF_BOUNDS',
        message: `Timeout "approvalTtlSeconds" must be bounded between 60 (1 min) and 86400 (24 hours) seconds (got ${approvalTtlSeconds}).`,
        actualValue: approvalTtlSeconds,
      });
    }

    if (!isInteger(dashboardPollIntervalMs)) {
      errors.push({
        field: 'timeouts.dashboardPollIntervalMs',
        code: 'INVALID_POLL_INTERVAL_TYPE',
        message: 'Interval "dashboardPollIntervalMs" must be a valid integer.',
        actualValue: dashboardPollIntervalMs,
      });
    } else if (dashboardPollIntervalMs < 1000 || dashboardPollIntervalMs > 60000) {
      errors.push({
        field: 'timeouts.dashboardPollIntervalMs',
        code: 'POLL_INTERVAL_OUT_OF_BOUNDS',
        message: `Interval "dashboardPollIntervalMs" must be bounded between 1000 (1 sec) and 60000 (60 sec) ms (got ${dashboardPollIntervalMs}).`,
        actualValue: dashboardPollIntervalMs,
      });
    }
  }

  // 12. Assemble Validation Result
  if (errors.length > 0) {
    return {
      valid: false,
      errors: Object.freeze([...errors]),
    };
  }

  // Deep-freeze valid configuration
  const validConfig = deepFreezeConfig((candidate as unknown) as GuardrailPolicyConfig);

  return {
    valid: true,
    errors: Object.freeze([]),
    config: validConfig,
  };
}

/**
 * Asserts that a candidate object is a valid GuardrailPolicyConfig.
 * Throws a PolicyConfigValidationError if validation fails.
 */
export function assertValidPolicyConfig(
  candidate: unknown
): asserts candidate is GuardrailPolicyConfig {
  const result = validatePolicyConfig(candidate);
  if (!result.valid || !result.config) {
    const firstErr = result.errors[0];
    const summary = result.errors.map((e) => `[${e.code}] ${e.field}: ${e.message}`).join('; ');
    throw new PolicyConfigValidationError(
      `Policy configuration validation failed with ${result.errors.length} error(s): ${summary}`,
      firstErr?.code || 'INVALID_POLICY_CONFIG',
      firstErr?.field,
      result.errors
    );
  }
}

/**
 * Safely resolves an arbitrary candidate configuration fail-closed.
 *
 * SAFETY INVARIANT:
 * If the candidate is null, undefined, or fails validation, logs a diagnostic
 * notice and safely returns the immutable DEFAULT_GUARDRAIL_POLICY_CONFIG.
 *
 * Never throws, never allows malformed configuration to silently weaken protection.
 *
 * @param candidate Unknown configuration candidate
 * @returns Validated GuardrailPolicyConfig
 */
export function resolveSafePolicyConfig(candidate: unknown): GuardrailPolicyConfig {
  if (candidate === null || candidate === undefined) {
    return DEFAULT_GUARDRAIL_POLICY_CONFIG;
  }

  const result = validatePolicyConfig(candidate);
  if (result.valid && result.config) {
    return result.config;
  }

  console.warn(
    `[Guardrail Config] Malformed or invalid configuration detected (${result.errors.length} errors). ` +
      `Safely falling back to immutable default policy configuration.`,
    result.errors.map((e) => ({ field: e.field, code: e.code, message: e.message }))
  );

  return DEFAULT_GUARDRAIL_POLICY_CONFIG;
}

// =============================================================================
// Comprehensive Policy Settings Specifications Dictionary
// =============================================================================

/**
 * Programmatic dictionary describing every single supported policy setting,
 * its constraints, default values, and security implications.
 */
export const POLICY_SETTINGS_SPECIFICATIONS: readonly PolicySettingSpecification[] = Object.freeze([
  Object.freeze({
    key: 'schemaVersion',
    category: 'version',
    title: 'Policy Schema Format Version',
    description: 'Defines the structural format and parsing specification of the policy document.',
    valueType: 'string',
    defaultValue: CURRENT_ARCHITECTURE_SCHEMA_VERSION,
    permittedValues: Object.freeze(['1.x']),
    isImmutableInvariant: false,
    securityImplication: 'Protects against schema parsing drift. Unsupported or stale versions (< 1.0.0 or > 1.x) are strictly rejected to prevent malformed rule interpretations.',
  }),
  Object.freeze({
    key: 'policyVersion',
    category: 'version',
    title: 'Protection Policy Version',
    description: 'Identifies active operational policy configuration version. Included in approval requests and verified during action continuation.',
    valueType: 'string',
    defaultValue: CURRENT_ARCHITECTURE_POLICY_VERSION,
    permittedValues: Object.freeze(['1.x']),
    isImmutableInvariant: false,
    securityImplication: 'Guarantees version synchronization between client and backend. Prevents client execution against stale or tampered policies.',
  }),
  Object.freeze({
    key: 'updatedAt',
    category: 'version',
    title: 'Configuration Update Timestamp',
    description: 'ISO 8601 UTC timestamp recording when configuration was generated or committed.',
    valueType: 'string',
    defaultValue: '2026-10-26T00:00:00.000Z',
    isImmutableInvariant: false,
    securityImplication: 'Provides non-repudiation audit trails for policy update provenance.',
  }),
  Object.freeze({
    key: 'thresholds.lowMax',
    category: 'threshold',
    title: 'Low Risk Tier Ceiling',
    description: 'Maximum risk score considered LOW risk (inclusive). Actions within this tier proceed without user warning.',
    valueType: 'integer',
    defaultValue: 24,
    minValue: 5,
    maxValue: 35,
    isImmutableInvariant: false,
    securityImplication: 'Raising lowMax widens the envelope of silent actions. Capped at 35 to prevent high-impact actions from masquerading as benign.',
  }),
  Object.freeze({
    key: 'thresholds.mediumMax',
    category: 'threshold',
    title: 'Medium Risk Tier Ceiling',
    description: 'Maximum risk score considered MEDIUM risk (inclusive). Actions in this tier display user advisories (WARN).',
    valueType: 'integer',
    defaultValue: 49,
    minValue: 6,
    maxValue: 65,
    isImmutableInvariant: false,
    securityImplication: 'Must strictly exceed lowMax. Capped at 65 to ensure high-stakes operations cannot be downgraded to advisory warnings.',
  }),
  Object.freeze({
    key: 'thresholds.highMax',
    category: 'threshold',
    title: 'High Risk Tier Ceiling',
    description: 'Maximum risk score considered HIGH risk (inclusive). Actions in this tier trigger Staging Mode review.',
    valueType: 'integer',
    defaultValue: 74,
    minValue: 7,
    maxValue: 85,
    isImmutableInvariant: false,
    securityImplication: 'Must strictly exceed mediumMax. Capped at 85 to ensure severe, irreversible actions (>= 86) unconditionally trigger fail-closed CRITICAL protection.',
  }),
  Object.freeze({
    key: 'signals.DESTRUCTIVE_ACTION',
    category: 'signal',
    title: 'Destructive Action Risk Signal',
    description: 'Fires when user interacts with irreversible elements (delete, remove, reset, purge).',
    valueType: 'boolean',
    defaultValue: true,
    minValue: 25,
    maxValue: 100,
    isImmutableInvariant: true,
    securityImplication: 'Mandatory security invariant: Cannot be disabled and score contribution cannot be set below 25. Silencing this signal would permit unreviewed permanent data loss.',
  }),
  Object.freeze({
    key: 'signals.PAYMENT_ACTION',
    category: 'signal',
    title: 'Payment & Financial Risk Signal',
    description: 'Fires when action targets checkout, payment submission, or transaction authorization controls.',
    valueType: 'boolean',
    defaultValue: true,
    minValue: 0,
    maxValue: 100,
    isImmutableInvariant: false,
    securityImplication: 'Disabling or setting score contribution to 0 allows financial commitments without prompt or warning.',
  }),
  Object.freeze({
    key: 'signals.AUTHENTICATION_ACTION',
    category: 'signal',
    title: 'Authentication Boundary Signal',
    description: 'Fires when action interacts with login forms, credential fields, or session elevation triggers.',
    valueType: 'boolean',
    defaultValue: true,
    minValue: 0,
    maxValue: 100,
    isImmutableInvariant: false,
    securityImplication: 'Disabling risks unreviewed account hijacking or credential handoffs.',
  }),
  Object.freeze({
    key: 'signals.EXTERNAL_NAVIGATION',
    category: 'signal',
    title: 'External Navigation Risk Signal',
    description: 'Fires when links or forms redirect outside current origin domain.',
    valueType: 'boolean',
    defaultValue: true,
    minValue: 0,
    maxValue: 100,
    isImmutableInvariant: false,
    securityImplication: 'Disabling risks unprompted phishing redirections and cross-site request forgery.',
  }),
  Object.freeze({
    key: 'signals.DOWNLOAD_ACTION',
    category: 'signal',
    title: 'File Download Risk Signal',
    description: 'Fires when interaction initiates binary or executable payload downloads.',
    valueType: 'boolean',
    defaultValue: true,
    minValue: 0,
    maxValue: 100,
    isImmutableInvariant: false,
    securityImplication: 'Disabling reduces risk visibility into potentially malicious executable downloads.',
  }),
  Object.freeze({
    key: 'policies.CONTROLLED_DESTRUCTIVE',
    category: 'policy',
    title: 'Controlled Destructive Action Policy',
    description: 'Requires protective staging mode interception for irreversible destructive click actions.',
    valueType: 'enum',
    defaultValue: 'PROTECT',
    permittedValues: Object.freeze(['PROTECT']),
    isImmutableInvariant: true,
    securityImplication: 'Core safety invariant. Must be enabled with decision PROTECT. Disabling or downgrading is strictly prohibited by schema and server validation.',
  }),
  Object.freeze({
    key: 'policies.CONTROLLED_PAYMENT',
    category: 'policy',
    title: 'Controlled Payment Policy',
    description: 'Advises user or holds financial checkout transactions.',
    valueType: 'enum',
    defaultValue: 'WARN',
    permittedValues: Object.freeze(['WARN', 'PROTECT']),
    isImmutableInvariant: false,
    securityImplication: 'Downgrading to ALLOW is strictly prohibited. Permitted choices: WARN or PROTECT.',
  }),
  Object.freeze({
    key: 'policies.EXTERNAL_NAVIGATION',
    category: 'policy',
    title: 'External Navigation Boundary Policy',
    description: 'Warns before navigating across origin boundaries to external domains.',
    valueType: 'enum',
    defaultValue: 'WARN',
    permittedValues: Object.freeze(['WARN', 'PROTECT']),
    isImmutableInvariant: false,
    securityImplication: 'Downgrading to ALLOW is strictly prohibited. Permitted choices: WARN or PROTECT.',
  }),
  Object.freeze({
    key: 'policies.AUTHENTICATION_BOUNDARY',
    category: 'policy',
    title: 'Authentication Boundary Policy',
    description: 'Advises user on credential and authentication boundary interactions.',
    valueType: 'enum',
    defaultValue: 'WARN',
    permittedValues: Object.freeze(['WARN', 'PROTECT']),
    isImmutableInvariant: false,
    securityImplication: 'Downgrading to ALLOW is strictly prohibited. Permitted choices: WARN or PROTECT.',
  }),
  Object.freeze({
    key: 'policies.ROUTINE_INTERACTION',
    category: 'policy',
    title: 'Routine Interaction Policy',
    description: 'Permits non-sensitive, routine browsing interactions without intervention.',
    valueType: 'enum',
    defaultValue: 'ALLOW',
    permittedValues: Object.freeze(['ALLOW']),
    isImmutableInvariant: false,
    securityImplication: 'Must remain ALLOW to prevent denial-of-service on routine browsing.',
  }),
  Object.freeze({
    key: 'policies.UNSUPPORTED_BOUNDARY_GUARD',
    category: 'policy',
    title: 'Unsupported Boundary Fail-Closed Policy',
    description: 'Fails closed into Staging Mode when action payload is corrupt, malformed, or unverified.',
    valueType: 'enum',
    defaultValue: 'PROTECT',
    permittedValues: Object.freeze(['PROTECT']),
    isImmutableInvariant: true,
    securityImplication: 'Core safety invariant. Must be enabled with decision PROTECT. Disabling would allow corrupted or unvetted actions to execute blindly.',
  }),
  Object.freeze({
    key: 'trustedDomains',
    category: 'domain',
    title: 'Trusted Domains Allowlist',
    description: 'Array of domain hostnames exempt from external navigation warnings.',
    valueType: 'array',
    defaultValue: Object.freeze([]),
    isImmutableInvariant: false,
    securityImplication: 'Adding untrusted hostnames allows silent navigation without warning. Hostnames must strictly match valid hostname syntax without protocols, paths, or credentials.',
  }),
  Object.freeze({
    key: 'timeouts.approvalTtlSeconds',
    category: 'timeout',
    title: 'Approval Request Time-to-Live',
    description: 'Duration in seconds before an approval request expires.',
    valueType: 'integer',
    defaultValue: 3600,
    minValue: 60,
    maxValue: 86400,
    isImmutableInvariant: false,
    securityImplication: 'Setting too low (< 60s) causes frequent expiration. Setting too high (> 24h) increases window for stale authorizations.',
  }),
  Object.freeze({
    key: 'timeouts.dashboardPollIntervalMs',
    category: 'timeout',
    title: 'Dashboard Polling Cadence',
    description: 'Interval in milliseconds between dashboard status refresh calls.',
    valueType: 'integer',
    defaultValue: 10000,
    minValue: 1000,
    maxValue: 60000,
    isImmutableInvariant: false,
    securityImplication: 'Setting below 1s risks denial of service; setting above 60s severely delays trusted contact notification.',
  }),
]);

/**
 * Deep freezes an object recursively to guarantee immutability.
 */
function deepFreezeConfig<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && (typeof val === 'object' || typeof val === 'function') && !Object.isFrozen(val)) {
      deepFreezeConfig(val as object);
    }
  }
  return obj;
}
