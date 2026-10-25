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
  GuardrailPolicyConfig,
  OperationalTimeouts,
  PolicyConfigValidationErrorDetail,
  PolicyConfigValidationResult,
  RiskThresholdSettings,
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
export const DEFAULT_GUARDRAIL_POLICY_CONFIG: Readonly<GuardrailPolicyConfig> = Object.freeze({
  schemaVersion: '1.0.0',
  policyVersion: '1.0.0',
  updatedAt: '2026-10-26T00:00:00.000Z',
  thresholds: Object.freeze({
    lowMax: 24,
    mediumMax: 49,
    highMax: 74,
  }),
  signals: Object.freeze({
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
  }),
  policies: Object.freeze([
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
  ]),
  trustedDomains: Object.freeze([]),
  timeouts: Object.freeze({
    approvalTtlSeconds: 3600,
    dashboardPollIntervalMs: 10000,
  }),
});

/**
 * Returns a deeply frozen copy of the safe default configuration.
 */
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
  } else if (!SEMVER_REGEX.test(schemaVersion.trim())) {
    errors.push({
      field: 'schemaVersion',
      code: 'INVALID_SEMVER_FORMAT',
      message: `Property "schemaVersion" must be a valid semantic version (e.g. "1.0.0"), got "${schemaVersion}".`,
      actualValue: schemaVersion,
    });
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
  } else if (!SEMVER_REGEX.test(policyVersion.trim())) {
    errors.push({
      field: 'policyVersion',
      code: 'INVALID_SEMVER_FORMAT',
      message: `Property "policyVersion" must be a valid semantic version (e.g. "1.0.0"), got "${policyVersion}".`,
      actualValue: policyVersion,
    });
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
