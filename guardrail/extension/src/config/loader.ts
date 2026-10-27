/**
 * Guardrail Central Policy Configuration Loader
 *
 * Implements safe, validated, fail-closed configuration loading with:
 * 1. Documented defaults application when optional configuration fields are missing.
 * 2. Strict rejection of malformed or corrupt configuration (never interpreted as ALLOW).
 * 3. Inviolable preservation of mandatory safety invariants (CONTROLLED_DESTRUCTIVE, UNSUPPORTED_BOUNDARY_GUARD).
 * 4. Explicit operational health status tracking (UNINITIALIZED, HEALTHY, DEGRADED, FAILED).
 * 5. Stale and unsupported version detection (semver compatibility enforcement).
 * 6. Protection against unknown policies and unsupported action types weakening defense.
 * 7. In-flight request debouncing and failure cooldown to eliminate excessive resource usage.
 * 8. Strict privacy preservation: zero credentials, secrets, or sensitive inputs in logs or errors.
 * 9. Separation of configuration recovery from action execution (never auto-executes held actions).
 */

import { ActionType } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import { RiskSignalId } from '../types/risk.js';
import {
  ConfigErrorDetail,
  ConfigHealthStatus,
  ConfigLoadOptions,
  ConfigLoadResult,
  ConfigurablePolicyRule,
  ConfigurableSignalSetting,
  GuardrailPolicyConfig,
  OperationalTimeouts,
  PolicyConfigValidationErrorDetail,
  RiskThresholdSettings,
} from '../types/config.js';
import {
  assertValidPolicyConfig,
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  FORBIDDEN_CONFIG_PATTERNS,
  HOSTNAME_REGEX,
  SEMVER_REGEX,
  validatePolicyConfig,
} from './schema.js';

/** Canonical storage key for Guardrail policy configuration in browser storage */
export const GUARDRAIL_POLICY_CONFIG_STORAGE_KEY = 'guardrailPolicyConfig';

/** Default cooldown period in milliseconds after a configuration load failure */
export const DEFAULT_LOAD_COOLDOWN_MS = 5000;

/** Current architectural schema format version */
export const CURRENT_ARCHITECTURE_SCHEMA_VERSION = '1.0.0';

/** Current architectural policy version */
export const CURRENT_ARCHITECTURE_POLICY_VERSION = '1.0.0';

/** Minimum supported schema version; configurations older than this are rejected as stale */
export const MIN_SUPPORTED_SCHEMA_VERSION = '1.0.0';

/**
 * Storage abstraction allowing decoupled persistence across Chrome extensions,
 * headless test runners, and Node.js environments.
 */
export interface ConfigStorageProvider {
  /** Retrieves stored value for the given key, or undefined/null if unset */
  get(key: string): Promise<unknown>;

  /** Persists value for the given key */
  set(key: string, value: unknown): Promise<void>;

  /** Clears the given key from storage */
  remove?(key: string): Promise<void>;
}

/**
 * Browser storage provider utilizing chrome.storage.local when available.
 */
export class ChromeLocalStorageProvider implements ConfigStorageProvider {
  public async get(key: string): Promise<unknown> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
      try {
        const result = await chrome.storage.local.get(key);
        return result ? result[key] : undefined;
      } catch (err) {
        throw new Error(
          `[Guardrail Storage] chrome.storage.local.get failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return undefined;
  }

  public async set(key: string, value: unknown): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
      try {
        await chrome.storage.local.set({ [key]: value });
      } catch (err) {
        throw new Error(
          `[Guardrail Storage] chrome.storage.local.set failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  public async remove(key: string): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.remove) {
      try {
        await chrome.storage.local.remove(key);
      } catch (err) {
        throw new Error(
          `[Guardrail Storage] chrome.storage.local.remove failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
}

/**
 * Ephemeral in-memory storage provider for tests and decoupled execution.
 */
export class InMemoryConfigStorageProvider implements ConfigStorageProvider {
  private readonly storage = new Map<string, unknown>();

  public async get(key: string): Promise<unknown> {
    return this.storage.get(key);
  }

  public async set(key: string, value: unknown): Promise<void> {
    this.storage.set(key, value);
  }

  public async remove(key: string): Promise<void> {
    this.storage.delete(key);
  }

  public clear(): void {
    this.storage.clear();
  }
}

/**
 * Resolves the appropriate storage provider for the active runtime.
 */
export function resolveDefaultStorageProvider(): ConfigStorageProvider {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return new ChromeLocalStorageProvider();
  }
  return new InMemoryConfigStorageProvider();
}

/**
 * Result of checking version compatibility against current architecture.
 */
export interface VersionCompatibilityResult {
  readonly compatible: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly field?: string;
}

/**
 * Sanitizes a string for inclusion in log messages or diagnostic errors.
 * Guarantees zero sensitive data or unredacted credentials leak into messages.
 */
export function sanitizeLogString(val: unknown, maxLen = 64): string {
  if (val === null || val === undefined) return String(val);
  const str = String(val).trim();
  for (const pattern of FORBIDDEN_CONFIG_PATTERNS) {
    if (pattern.test(str)) {
      return '[REDACTED_SENSITIVE_DATA]';
    }
  }
  if (str.length > maxLen) {
    return `${str.substring(0, maxLen)}...`;
  }
  return str;
}

/**
 * Recursively scans an object for forbidden credential/secret patterns.
 * Returns the matched property path if found, or null if clean.
 */
export function scanForSensitiveContent(obj: unknown, path = ''): string | null {
  if (obj === null || obj === undefined) return null;

  if (typeof obj === 'string') {
    for (const pattern of FORBIDDEN_CONFIG_PATTERNS) {
      if (pattern.test(obj)) {
        return path || 'root';
      }
    }
    return null;
  }

  if (typeof obj === 'object') {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const itemPath = path ? `${path}[${i}]` : `[${i}]`;
        const matched = scanForSensitiveContent(obj[i], itemPath);
        if (matched) return matched;
      }
    } else {
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const propPath = path ? `${path}.${key}` : key;
        for (const pattern of FORBIDDEN_CONFIG_PATTERNS) {
          if (pattern.test(key)) {
            return propPath;
          }
        }
        const matched = scanForSensitiveContent(val, propPath);
        if (matched) return matched;
      }
    }
  }

  return null;
}

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
      code: 'INVALID_CONFIG_VERSION',
      message: `Version field "${fieldName}" contains invalid semver format: "${sanitizeLogString(trimmed)}".`,
      field: fieldName,
    };
  }

  const [majorStr] = trimmed.split('.');
  const major = parseInt(majorStr, 10);

  if (isNaN(major) || major < 1) {
    return {
      compatible: false,
      code: 'STALE_CONFIG_VERSION',
      message: `Stale configuration version (v${sanitizeLogString(trimmed)}) cannot be applied; current architecture requires v1.0.0 or newer.`,
      field: fieldName,
    };
  }

  if (major > 1) {
    return {
      compatible: false,
      code: 'UNSUPPORTED_CONFIG_VERSION',
      message: `Unsupported configuration version (v${sanitizeLogString(trimmed)}); current architecture only supports v1.x.`,
      field: fieldName,
    };
  }

  return { compatible: true };
}

/**
 * Merges a candidate configuration with documented defaults while strictly
 * preserving mandatory security invariants and rejecting malformed settings.
 *
 * GUARANTEES:
 * 1. Applies documented defaults for any missing optional top-level or child properties.
 * 2. Rejects malformed configuration rather than interpreting unknown values as ALLOW.
 * 3. Preserves mandatory protection rules (CONTROLLED_DESTRUCTIVE, UNSUPPORTED_BOUNDARY_GUARD).
 * 4. Strips unknown policy identifiers and unsupported action types so they cannot weaken protection.
 * 5. Returns explicit health status (HEALTHY, DEGRADED, FAILED).
 */
export function mergeConfigWithDefaults(candidate: unknown): {
  config: GuardrailPolicyConfig;
  healthStatus: ConfigHealthStatus;
  nonFatalErrors: readonly PolicyConfigValidationErrorDetail[];
  fatalError?: ConfigErrorDetail;
} {
  const timestamp = new Date().toISOString();
  const nonFatalErrors: PolicyConfigValidationErrorDetail[] = [];

  // 1. Handle null or undefined: clean default installation
  if (candidate === null || candidate === undefined) {
    return {
      config: DEFAULT_GUARDRAIL_POLICY_CONFIG,
      healthStatus: ConfigHealthStatus.HEALTHY,
      nonFatalErrors: [],
    };
  }

  // 2. Reject non-object or array root
  if (typeof candidate !== 'object' || Array.isArray(candidate)) {
    const error: ConfigErrorDetail = {
      code: 'INVALID_CONFIG_ROOT',
      message: 'Configuration root must be a plain object, not a primitive or array.',
      field: 'root',
      timestamp,
      fatal: true,
    };
    return {
      config: DEFAULT_GUARDRAIL_POLICY_CONFIG,
      healthStatus: ConfigHealthStatus.FAILED,
      nonFatalErrors: [],
      fatalError: error,
    };
  }

  // 3. Scan for forbidden credentials or secret patterns
  const sensitiveField = scanForSensitiveContent(candidate);
  if (sensitiveField) {
    const error: ConfigErrorDetail = {
      code: 'FORBIDDEN_SENSITIVE_CONTENT',
      message: `Configuration contains forbidden sensitive credential pattern in field "${sensitiveField}". Configuration strictly rejected.`,
      field: sensitiveField,
      timestamp,
      fatal: true,
    };
    return {
      config: DEFAULT_GUARDRAIL_POLICY_CONFIG,
      healthStatus: ConfigHealthStatus.FAILED,
      nonFatalErrors: [],
      fatalError: error,
    };
  }

  const raw = candidate as Record<string, unknown>;

  // 4. Validate schemaVersion compatibility
  let schemaVersion = DEFAULT_GUARDRAIL_POLICY_CONFIG.schemaVersion;
  if ('schemaVersion' in raw && raw.schemaVersion !== undefined) {
    const compat = checkVersionCompatibility(raw.schemaVersion, 'schemaVersion');
    if (!compat.compatible) {
      const error: ConfigErrorDetail = {
        code: compat.code || 'INVALID_CONFIG_VERSION',
        message: compat.message || 'Incompatible configuration version.',
        field: 'schemaVersion',
        timestamp,
        fatal: true,
      };
      return {
        config: DEFAULT_GUARDRAIL_POLICY_CONFIG,
        healthStatus: ConfigHealthStatus.FAILED,
        nonFatalErrors: [],
        fatalError: error,
      };
    }
    schemaVersion = String(raw.schemaVersion).trim();
  } else {
    nonFatalErrors.push({
      field: 'schemaVersion',
      code: 'MISSING_OPTIONAL_FIELD',
      message: 'Optional field "schemaVersion" was missing; applied default "1.0.0".',
    });
  }

  // 5. Validate policyVersion compatibility
  let policyVersion = DEFAULT_GUARDRAIL_POLICY_CONFIG.policyVersion;
  if ('policyVersion' in raw && raw.policyVersion !== undefined) {
    const compat = checkVersionCompatibility(raw.policyVersion, 'policyVersion');
    if (!compat.compatible) {
      const error: ConfigErrorDetail = {
        code: compat.code || 'INVALID_CONFIG_VERSION',
        message: compat.message || 'Incompatible policy version.',
        field: 'policyVersion',
        timestamp,
        fatal: true,
      };
      return {
        config: DEFAULT_GUARDRAIL_POLICY_CONFIG,
        healthStatus: ConfigHealthStatus.FAILED,
        nonFatalErrors: [],
        fatalError: error,
      };
    }
    policyVersion = String(raw.policyVersion).trim();
  } else {
    nonFatalErrors.push({
      field: 'policyVersion',
      code: 'MISSING_OPTIONAL_FIELD',
      message: 'Optional field "policyVersion" was missing; applied default "1.0.0".',
    });
  }

  // 6. Resolve updatedAt timestamp
  let updatedAt = DEFAULT_GUARDRAIL_POLICY_CONFIG.updatedAt;
  if (typeof raw.updatedAt === 'string' && !isNaN(Date.parse(raw.updatedAt))) {
    updatedAt = raw.updatedAt;
  }

  // 7. Resolve Risk Thresholds
  let thresholds: RiskThresholdSettings = DEFAULT_GUARDRAIL_POLICY_CONFIG.thresholds;
  if (raw.thresholds && typeof raw.thresholds === 'object' && !Array.isArray(raw.thresholds)) {
    const rawTh = raw.thresholds as Record<string, unknown>;
    const hasLowMax = typeof rawTh.lowMax === 'number' && Number.isInteger(rawTh.lowMax);
    const hasMedMax = typeof rawTh.mediumMax === 'number' && Number.isInteger(rawTh.mediumMax);
    const hasHighMax = typeof rawTh.highMax === 'number' && Number.isInteger(rawTh.highMax);

    if (!hasLowMax || !hasMedMax || !hasHighMax) {
      nonFatalErrors.push({
        field: 'thresholds',
        code: 'MISSING_OPTIONAL_FIELD',
        message: 'Partial thresholds provided; applied defaults for missing threshold fields.',
      });
    }

    const lowMax = hasLowMax ? (rawTh.lowMax as number) : DEFAULT_GUARDRAIL_POLICY_CONFIG.thresholds.lowMax;
    const mediumMax = hasMedMax ? (rawTh.mediumMax as number) : DEFAULT_GUARDRAIL_POLICY_CONFIG.thresholds.mediumMax;
    const highMax = hasHighMax ? (rawTh.highMax as number) : DEFAULT_GUARDRAIL_POLICY_CONFIG.thresholds.highMax;

    // Validate numeric constraints: 5 <= lowMax < mediumMax < highMax <= 85
    if (lowMax >= 5 && lowMax < mediumMax && mediumMax < highMax && highMax <= 85) {
      thresholds = Object.freeze({ lowMax, mediumMax, highMax });
    } else {
      nonFatalErrors.push({
        field: 'thresholds',
        code: 'INVALID_THRESHOLD_BOUNDS',
        message: `Custom thresholds [${lowMax}, ${mediumMax}, ${highMax}] violate numeric constraints (5 <= low < med < high <= 85). Reverted to defaults.`,
      });
      thresholds = DEFAULT_GUARDRAIL_POLICY_CONFIG.thresholds;
    }
  } else if ('thresholds' in raw && raw.thresholds !== undefined) {
    nonFatalErrors.push({
      field: 'thresholds',
      code: 'INVALID_THRESHOLD_TYPE',
      message: 'Property "thresholds" must be an object. Reverted to defaults.',
    });
  } else {
    nonFatalErrors.push({
      field: 'thresholds',
      code: 'MISSING_OPTIONAL_FIELD',
      message: 'Optional field "thresholds" was missing; applied default thresholds.',
    });
  }

  // 8. Resolve Signals
  const signals: Record<RiskSignalId, ConfigurableSignalSetting> = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG.signals,
  };
  if (raw.signals && typeof raw.signals === 'object' && !Array.isArray(raw.signals)) {
    const rawSignals = raw.signals as Record<string, unknown>;
    for (const [key, defaultSignal] of Object.entries(DEFAULT_GUARDRAIL_POLICY_CONFIG.signals)) {
      const signalId = key as RiskSignalId;
      if (signalId in rawSignals) {
        const rawSig = rawSignals[signalId];
        if (rawSig && typeof rawSig === 'object' && !Array.isArray(rawSig)) {
          const sigObj = rawSig as Record<string, unknown>;
          const enabled = typeof sigObj.enabled === 'boolean' ? sigObj.enabled : defaultSignal.enabled;
          const scoreContribution =
            typeof sigObj.scoreContribution === 'number' &&
            Number.isInteger(sigObj.scoreContribution) &&
            sigObj.scoreContribution >= 0 &&
            sigObj.scoreContribution <= 100
              ? sigObj.scoreContribution
              : defaultSignal.scoreContribution;

          signals[signalId] = Object.freeze({
            id: signalId,
            enabled,
            scoreContribution,
          });
        }
      } else {
        nonFatalErrors.push({
          field: `signals.${signalId}`,
          code: 'MISSING_OPTIONAL_FIELD',
          message: `Optional signal "${signalId}" was missing; applied default score contribution.`,
        });
      }
    }
  } else {
    nonFatalErrors.push({
      field: 'signals',
      code: 'MISSING_OPTIONAL_FIELD',
      message: 'Optional field "signals" was missing; applied default signals.',
    });
  }

  // 9. Resolve Trusted Domains
  let trustedDomains: readonly string[] = DEFAULT_GUARDRAIL_POLICY_CONFIG.trustedDomains;
  if (Array.isArray(raw.trustedDomains)) {
    const validDomains: string[] = [];
    for (const d of raw.trustedDomains) {
      if (typeof d === 'string') {
        const trimmed = d.trim().toLowerCase();
        if (HOSTNAME_REGEX.test(trimmed) && !FORBIDDEN_CONFIG_PATTERNS.some((p) => p.test(trimmed))) {
          if (!validDomains.includes(trimmed)) {
            validDomains.push(trimmed);
          }
        }
      }
    }
    trustedDomains = Object.freeze(validDomains);
  } else {
    nonFatalErrors.push({
      field: 'trustedDomains',
      code: 'MISSING_OPTIONAL_FIELD',
      message: 'Optional field "trustedDomains" was missing; applied default empty list.',
    });
  }

  // 10. Resolve Operational Timeouts
  let timeouts: OperationalTimeouts = DEFAULT_GUARDRAIL_POLICY_CONFIG.timeouts;
  if (raw.timeouts && typeof raw.timeouts === 'object' && !Array.isArray(raw.timeouts)) {
    const rawTo = raw.timeouts as Record<string, unknown>;
    const approvalTtlSeconds =
      typeof rawTo.approvalTtlSeconds === 'number' &&
      Number.isInteger(rawTo.approvalTtlSeconds) &&
      rawTo.approvalTtlSeconds >= 60 &&
      rawTo.approvalTtlSeconds <= 86400
        ? rawTo.approvalTtlSeconds
        : DEFAULT_GUARDRAIL_POLICY_CONFIG.timeouts.approvalTtlSeconds;

    const dashboardPollIntervalMs =
      typeof rawTo.dashboardPollIntervalMs === 'number' &&
      Number.isInteger(rawTo.dashboardPollIntervalMs) &&
      rawTo.dashboardPollIntervalMs >= 1000 &&
      rawTo.dashboardPollIntervalMs <= 60000
        ? rawTo.dashboardPollIntervalMs
        : DEFAULT_GUARDRAIL_POLICY_CONFIG.timeouts.dashboardPollIntervalMs;

    timeouts = Object.freeze({ approvalTtlSeconds, dashboardPollIntervalMs });
  } else {
    nonFatalErrors.push({
      field: 'timeouts',
      code: 'MISSING_OPTIONAL_FIELD',
      message: 'Optional field "timeouts" was missing; applied default operational timeouts.',
    });
  }


  // 11. Resolve Policies (Preserving Mandatory Security Invariants)
  // Baseline is all default supported policies
  const policyMap = new Map<RiskPolicyId, ConfigurablePolicyRule>();
  for (const defPolicy of DEFAULT_GUARDRAIL_POLICY_CONFIG.policies) {
    policyMap.set(defPolicy.id, defPolicy);
  }

  if (Array.isArray(raw.policies)) {
    const validActionTypes = new Set(Object.values(ActionType));
    const validDecisions = new Set(Object.values(ResponseAction));

    for (const item of raw.policies) {
      if (!item || typeof item !== 'object') continue;
      const rule = item as Record<string, unknown>;
      const ruleId = rule.id as RiskPolicyId;

      // REQUIREMENT 6: Unknown policy identifiers must be rejected, not allowed to weaken defense
      if (!ruleId || !Object.values(RiskPolicyId).includes(ruleId)) {
        nonFatalErrors.push({
          field: 'policies',
          code: 'UNKNOWN_POLICY_IDENTIFIER',
          message: `Unknown policy identifier "${sanitizeLogString(ruleId)}" ignored to prevent weakening protection.`,
          actualValue: sanitizeLogString(ruleId),
        });
        continue;
      }

      const defaultRule = policyMap.get(ruleId);
      if (!defaultRule) continue;

      // REQUIREMENT 3: Mandatory security invariants can NEVER be disabled or downgraded
      if (defaultRule.isImmutableSecurityInvariant) {
        if (rule.enabled === false || rule.decision !== ResponseAction.PROTECT) {
          nonFatalErrors.push({
            field: `policies.${ruleId}`,
            code: 'CANNOT_DOWNGRADE_MANDATORY_INVARIANT',
            message: `Mandatory security invariant policy "${ruleId}" cannot be disabled or downgraded below PROTECT. Maintained invariant.`,
          });
        }
        // Force invariant settings
        policyMap.set(
          ruleId,
          Object.freeze({
            ...defaultRule,
            enabled: true,
            decision: ResponseAction.PROTECT,
            isImmutableSecurityInvariant: true,
          })
        );
        continue;
      }

      // Check decision: Sensitive boundary rules cannot be downgraded to ALLOW
      let decision = defaultRule.decision;
      if (typeof rule.decision === 'string' && validDecisions.has(rule.decision as ResponseAction)) {
        const candidateDecision = rule.decision as ResponseAction;
        const isSensitiveBoundary =
          ruleId === RiskPolicyId.CONTROLLED_PAYMENT ||
          ruleId === RiskPolicyId.EXTERNAL_NAVIGATION ||
          ruleId === RiskPolicyId.AUTHENTICATION_BOUNDARY;

        if (isSensitiveBoundary && candidateDecision === ResponseAction.ALLOW) {
          nonFatalErrors.push({
            field: `policies.${ruleId}.decision`,
            code: 'CANNOT_DOWNGRADE_TO_ALLOW',
            message: `Sensitive boundary policy "${ruleId}" cannot be downgraded to ALLOW. Reverted to WARN.`,
          });
          decision = ResponseAction.WARN;
        } else {
          decision = candidateDecision;
        }
      } else if (rule.decision !== undefined) {
        // REQUIREMENT 2: Reject malformed configuration rather than interpreting unknown values as ALLOW
        nonFatalErrors.push({
          field: `policies.${ruleId}.decision`,
          code: 'INVALID_POLICY_DECISION',
          message: `Invalid decision "${sanitizeLogString(rule.decision)}" for policy "${ruleId}". Reverted to default "${defaultRule.decision}".`,
        });
        decision = defaultRule.decision;
      }

      // Check actionTypes: unsupported action types are filtered out
      let actionTypes = defaultRule.actionTypes;
      if (Array.isArray(rule.actionTypes)) {
        const filtered = rule.actionTypes.filter(
          (at): at is ActionType => typeof at === 'string' && validActionTypes.has(at as ActionType)
        );
        if (filtered.length > 0) {
          actionTypes = Object.freeze(filtered);
        } else {
          nonFatalErrors.push({
            field: `policies.${ruleId}.actionTypes`,
            code: 'INVALID_ACTION_TYPES',
            message: `Policy "${ruleId}" must contain at least one valid ActionType. Reverted to defaults.`,
          });
        }
      }

      const enabled = typeof rule.enabled === 'boolean' ? rule.enabled : defaultRule.enabled;
      const priority =
        typeof rule.priority === 'number' &&
        Number.isInteger(rule.priority) &&
        rule.priority >= 1 &&
        rule.priority <= 1000
          ? rule.priority
          : defaultRule.priority;

      const name = typeof rule.name === 'string' && rule.name.trim() ? rule.name.trim() : defaultRule.name;
      const reasonCode =
        typeof rule.reasonCode === 'string' && rule.reasonCode.trim()
          ? rule.reasonCode.trim()
          : defaultRule.reasonCode;
      const userExplanation =
        typeof rule.userExplanation === 'string' && rule.userExplanation.trim()
          ? rule.userExplanation.trim()
          : defaultRule.userExplanation;

      policyMap.set(
        ruleId,
        Object.freeze({
          id: ruleId,
          name,
          enabled,
          actionTypes,
          decision,
          priority,
          reasonCode,
          userExplanation,
          isImmutableSecurityInvariant: false,
        })
      );
    }
  } else {
    nonFatalErrors.push({
      field: 'policies',
      code: 'MISSING_OPTIONAL_FIELD',
      message: 'Optional field "policies" was missing; applied default policies.',
    });
  }

  // Ensure mandatory invariants are present regardless of candidate

  const mandatoryPolicies = [
    RiskPolicyId.CONTROLLED_DESTRUCTIVE,
    RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD,
  ];
  for (const mId of mandatoryPolicies) {
    const existing = policyMap.get(mId);
    if (!existing || !existing.enabled || existing.decision !== ResponseAction.PROTECT) {
      const def = DEFAULT_GUARDRAIL_POLICY_CONFIG.policies.find((p) => p.id === mId)!;
      policyMap.set(mId, def);
    }
  }

  const policies = Object.freeze(Array.from(policyMap.values()));

  const mergedConfig: GuardrailPolicyConfig = Object.freeze({
    schemaVersion,
    policyVersion,
    updatedAt,
    thresholds,
    signals: Object.freeze(signals),
    policies,
    trustedDomains,
    timeouts,
  });

  // 12. Final schema validation
  const validation = validatePolicyConfig(mergedConfig);
  if (!validation.valid || !validation.config) {
    return {
      config: DEFAULT_GUARDRAIL_POLICY_CONFIG,
      healthStatus: ConfigHealthStatus.DEGRADED,
      nonFatalErrors: [...nonFatalErrors, ...validation.errors],
    };
  }

  const healthStatus =
    nonFatalErrors.length > 0 ? ConfigHealthStatus.DEGRADED : ConfigHealthStatus.HEALTHY;

  return {
    config: validation.config,
    healthStatus,
    nonFatalErrors,
  };
}

/**
 * Authoritative Policy Configuration Loader managing storage reads, validation,
 * recovery, throttling, cooldown, and health status tracking.
 */
export class PolicyConfigLoader {
  private readonly storageProvider: ConfigStorageProvider;
  private readonly cooldownMs: number;

  private healthStatus: ConfigHealthStatus = ConfigHealthStatus.UNINITIALIZED;
  private activeConfig: GuardrailPolicyConfig = DEFAULT_GUARDRAIL_POLICY_CONFIG;
  private lastError?: ConfigErrorDetail;
  private lastAttemptTimestamp = 0;
  private consecutiveFailures = 0;

  private inFlightPromise: Promise<ConfigLoadResult> | null = null;

  constructor(options?: { storageProvider?: ConfigStorageProvider; cooldownMs?: number }) {
    this.storageProvider = options?.storageProvider ?? resolveDefaultStorageProvider();
    this.cooldownMs = options?.cooldownMs ?? DEFAULT_LOAD_COOLDOWN_MS;
  }

  /**
   * Returns current operational health status.
   */
  public getHealthStatus(): ConfigHealthStatus {
    return this.healthStatus;
  }

  /**
   * Returns active, validated configuration in effect.
   */
  public getConfig(): GuardrailPolicyConfig {
    return this.activeConfig;
  }

  /**
   * Returns diagnostic details of the last failure encountered, if any.
   */
  public getLastError(): ConfigErrorDetail | undefined {
    return this.lastError;
  }

  /**
   * Returns remaining cooldown in milliseconds before next storage read is allowed.
   */
  public getCooldownRemainingMs(): number {
    if (this.consecutiveFailures === 0 || this.healthStatus === ConfigHealthStatus.HEALTHY) {
      return 0;
    }
    const elapsed = Date.now() - this.lastAttemptTimestamp;
    const remaining = this.cooldownMs - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Loads configuration from storage with debouncing, cooldown throttling,
   * safe merging, and fail-closed error handling.
   *
   * @param options ConfigLoadOptions (e.g. force: true)
   */
  public async load(options?: ConfigLoadOptions): Promise<ConfigLoadResult> {
    // 1. Debouncing: if load is already in-flight, return same promise
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    // 2. Cooldown check: if recent failure and cooldown active, return cached state
    const cooldownRemaining = this.getCooldownRemainingMs();
    if (!options?.force && cooldownRemaining > 0 && this.healthStatus === ConfigHealthStatus.FAILED) {
      return {
        healthStatus: this.healthStatus,
        config: this.activeConfig,
        error: this.lastError,
        fromCache: true,
        cooldownRemainingMs: cooldownRemaining,
      };
    }

    this.inFlightPromise = this.executeLoad(options);
    try {
      return await this.inFlightPromise;
    } finally {
      this.inFlightPromise = null;
    }
  }

  private async executeLoad(options?: ConfigLoadOptions): Promise<ConfigLoadResult> {
    const key = options?.storageKey ?? GUARDRAIL_POLICY_CONFIG_STORAGE_KEY;
    this.lastAttemptTimestamp = Date.now();

    let rawCandidate: unknown;
    try {
      rawCandidate = await this.storageProvider.get(key);
    } catch (err) {
      // Storage read error: fatal failure, fail-closed
      this.consecutiveFailures++;
      this.healthStatus = ConfigHealthStatus.FAILED;
      const error: ConfigErrorDetail = {
        code: 'STORAGE_READ_ERROR',
        message: `Failed to read configuration from storage: ${sanitizeLogString(err instanceof Error ? err.message : String(err))}`,
        timestamp: new Date().toISOString(),
        fatal: true,
      };
      this.lastError = error;
      this.activeConfig = DEFAULT_GUARDRAIL_POLICY_CONFIG;

      return {
        healthStatus: ConfigHealthStatus.FAILED,
        config: this.activeConfig,
        error,
        fromCache: false,
        cooldownRemainingMs: this.cooldownMs,
      };
    }

    // Merge candidate with documented defaults
    const mergeResult = mergeConfigWithDefaults(rawCandidate);

    if (mergeResult.fatalError) {
      this.consecutiveFailures++;
      this.healthStatus = ConfigHealthStatus.FAILED;
      this.lastError = mergeResult.fatalError;
      this.activeConfig = DEFAULT_GUARDRAIL_POLICY_CONFIG;

      return {
        healthStatus: ConfigHealthStatus.FAILED,
        config: this.activeConfig,
        error: mergeResult.fatalError,
        fromCache: false,
        cooldownRemainingMs: this.cooldownMs,
      };
    }

    // Load succeeded (either HEALTHY or DEGRADED)
    this.consecutiveFailures = 0;
    this.healthStatus = mergeResult.healthStatus;
    this.activeConfig = mergeResult.config;

    if (mergeResult.healthStatus === ConfigHealthStatus.DEGRADED) {
      const firstErr = mergeResult.nonFatalErrors[0];
      this.lastError = {
        code: firstErr?.code || 'CONFIG_DEGRADED',
        message: firstErr?.message || 'Configuration loaded with non-fatal degraded defaults.',
        field: firstErr?.field,
        timestamp: new Date().toISOString(),
        fatal: false,
      };
    } else {
      this.lastError = undefined;
    }

    return {
      healthStatus: this.healthStatus,
      config: this.activeConfig,
      error: this.lastError,
      fromCache: false,
      cooldownRemainingMs: 0,
    };
  }

  /**
   * Persists a validated configuration document into storage.
   * Throws PolicyConfigValidationError if configuration is invalid.
   */
  public async save(
    config: GuardrailPolicyConfig,
    options?: ConfigLoadOptions
  ): Promise<ConfigLoadResult> {
    assertValidPolicyConfig(config);
    const key = options?.storageKey ?? GUARDRAIL_POLICY_CONFIG_STORAGE_KEY;
    await this.storageProvider.set(key, config);

    this.activeConfig = config;
    this.healthStatus = ConfigHealthStatus.HEALTHY;
    this.lastError = undefined;
    this.consecutiveFailures = 0;

    return {
      healthStatus: ConfigHealthStatus.HEALTHY,
      config: this.activeConfig,
      fromCache: false,
      cooldownRemainingMs: 0,
    };
  }

  /**
   * Resets loader state, timestamps, and active configuration to default.
   */
  public reset(): void {
    this.healthStatus = ConfigHealthStatus.UNINITIALIZED;
    this.activeConfig = DEFAULT_GUARDRAIL_POLICY_CONFIG;
    this.lastError = undefined;
    this.lastAttemptTimestamp = 0;
    this.consecutiveFailures = 0;
    this.inFlightPromise = null;
  }
}
