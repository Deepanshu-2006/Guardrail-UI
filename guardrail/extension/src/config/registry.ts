/**
 * Guardrail Central Risk-Policy Configuration Registry
 *
 * Provides a single, authoritative in-memory registry and accessor service
 * for all active risk-policy settings across Guardrail.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. SINGLE SOURCE OF TRUTH: All components (RiskEngine, ResponseEngine, policies, validation service)
 *    consume policy configuration from this registry rather than maintaining independent copies.
 * 2. VALIDATED & FAIL-CLOSED: Configuration changes are strictly validated against the GuardrailPolicyConfig
 *    schema. Invalid candidates safely fall back to immutable defaults.
 * 3. NO MAGIC NUMBERS: Granular accessors provide computed boundary values (e.g. getCriticalThresholdScore())
 *    to prevent scattering hardcoded numbers across codebase.
 * 4. SEPARATION OF INVARIANTS: Non-configurable security invariants are protected from runtime tampering.
 */

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
  RiskThresholdSettings,
} from '../types/config.js';
import {
  assertValidPolicyConfig,
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  resolveSafePolicyConfig,
  validatePolicyConfig,
} from './schema.js';
import { ConfigStorageProvider, PolicyConfigLoader } from './loader.js';

export type PolicyConfigChangeListener = (newConfig: GuardrailPolicyConfig) => void;

/**
 * Authoritative central registry managing active risk-policy configuration.
 */
export class PolicyConfigRegistry {
  private activeConfig: GuardrailPolicyConfig = DEFAULT_GUARDRAIL_POLICY_CONFIG;
  private healthStatus: ConfigHealthStatus = ConfigHealthStatus.UNINITIALIZED;
  private lastError?: ConfigErrorDetail;
  private readonly loader: PolicyConfigLoader;
  private readonly listeners: Set<PolicyConfigChangeListener> = new Set();

  constructor(options?: { loader?: PolicyConfigLoader; storageProvider?: ConfigStorageProvider }) {
    this.loader =
      options?.loader ??
      new PolicyConfigLoader(options?.storageProvider ? { storageProvider: options.storageProvider } : undefined);
  }

  /**
   * Retrieves the active, validated, deeply frozen policy configuration.
   */
  public getConfig(): GuardrailPolicyConfig {
    return this.activeConfig;
  }

  /**
   * Retrieves the current operational health status of the configuration system.
   */
  public getHealthStatus(): ConfigHealthStatus {
    return this.healthStatus;
  }

  /**
   * Checks whether the configuration is running in a degraded state.
   */
  public isDegraded(): boolean {
    return this.healthStatus === ConfigHealthStatus.DEGRADED;
  }

  /**
   * Checks whether the configuration is in a failed (fail-closed) state.
   */
  public isFailed(): boolean {
    return this.healthStatus === ConfigHealthStatus.FAILED;
  }

  /**
   * Retrieves diagnostic details of the last failure encountered, if any.
   */
  public getLastError(): ConfigErrorDetail | undefined {
    return this.lastError;
  }

  /**
   * Directly sets the health status and optional error (useful for tests or runtime hooks).
   */
  public setHealthStatus(status: ConfigHealthStatus, error?: ConfigErrorDetail): void {
    this.healthStatus = status;
    this.lastError = error;
  }

  /**
   * Loads configuration from underlying storage with throttling, validation, and safe defaults.
   *
   * SAFETY INVARIANT:
   * When configuration loading recovers, held actions in the InterceptionController
   * MUST NOT be automatically continued or executed. Continuation strictly requires
   * explicit backend approval and user confirmation passing Condition 10 revalidation.
   */
  public async loadFromStorage(options?: ConfigLoadOptions): Promise<ConfigLoadResult> {
    const result = await this.loader.load(options);
    this.activeConfig = result.config;
    this.healthStatus = result.healthStatus;
    this.lastError = result.error;
    this.notifyListeners();
    return result;
  }

  /**
   * Forces a reload from storage, bypassing active failure cooldown.
   */
  public async reload(options?: ConfigLoadOptions): Promise<ConfigLoadResult> {
    return this.loadFromStorage({ ...options, force: true });
  }

  /**
   * Updates the active configuration after strict schema validation.
   * Throws PolicyConfigValidationError if candidate violates schema or security invariants.
   *
   * @param candidate Unvalidated configuration object
   * @returns The newly applied, validated, frozen configuration
   */
  public setConfig(candidate: unknown): GuardrailPolicyConfig {
    assertValidPolicyConfig(candidate);
    this.activeConfig = candidate;
    this.healthStatus = ConfigHealthStatus.HEALTHY;
    this.lastError = undefined;
    this.notifyListeners();
    return this.activeConfig;
  }

  /**
   * Safely updates the configuration fail-closed.
   * If candidate is invalid, safely defaults to DEFAULT_GUARDRAIL_POLICY_CONFIG without throwing
   * and marks the operational state as DEGRADED.
   *
   * @param candidate Unvalidated configuration object
   * @returns The resolved safe configuration
   */
  public setConfigSafe(candidate: unknown): GuardrailPolicyConfig {
    const validation = validatePolicyConfig(candidate);
    if (validation.valid && validation.config) {
      this.activeConfig = validation.config;
      this.healthStatus = ConfigHealthStatus.HEALTHY;
      this.lastError = undefined;
    } else {
      this.activeConfig = resolveSafePolicyConfig(candidate);
      this.healthStatus = ConfigHealthStatus.DEGRADED;
      const firstErr = validation.errors[0];
      this.lastError = {
        code: firstErr?.code || 'INVALID_CONFIG_FALLBACK',
        message: firstErr?.message || 'Configuration candidate was invalid; applied safe defaults.',
        field: firstErr?.field,
        timestamp: new Date().toISOString(),
        fatal: false,
      };
    }
    this.notifyListeners();
    return this.activeConfig;
  }

  /**
   * Resets active configuration to the immutable default configuration.
   */
  public resetToDefault(): GuardrailPolicyConfig {
    this.activeConfig = DEFAULT_GUARDRAIL_POLICY_CONFIG;
    this.healthStatus = ConfigHealthStatus.HEALTHY;
    this.lastError = undefined;
    this.notifyListeners();
    return this.activeConfig;
  }


  /**
   * Returns active categorical risk thresholds.
   */
  public getRiskThresholds(): RiskThresholdSettings {
    return this.activeConfig.thresholds;
  }

  /**
   * Returns the minimum numeric score that triggers CRITICAL risk.
   * Derived dynamically from thresholds: highMax + 1.
   * Eliminates hardcoded magic numbers (e.g. '75') across response rules.
   */
  public getCriticalThresholdScore(): number {
    return this.activeConfig.thresholds.highMax + 1;
  }

  /**
   * Returns the maximum numeric score that qualifies as LOW risk.
   * Derived dynamically from thresholds: lowMax.
   * Eliminates hardcoded magic numbers (e.g. '24') across response rules.
   */
  public getRoutineThresholdMax(): number {
    return this.activeConfig.thresholds.lowMax;
  }

  /**
   * Returns setting for a specific risk signal.
   */
  public getSignalConfig(signalId: RiskSignalId): ConfigurableSignalSetting {
    return (
      this.activeConfig.signals[signalId] ??
      DEFAULT_GUARDRAIL_POLICY_CONFIG.signals[signalId]
    );
  }

  /**
   * Returns configured score contribution for a risk signal.
   */
  public getSignalContribution(signalId: RiskSignalId): number {
    const signal = this.getSignalConfig(signalId);
    return signal.enabled ? signal.scoreContribution : 0;
  }

  /**
   * Checks whether a risk signal is enabled.
   */
  public isSignalEnabled(signalId: RiskSignalId): boolean {
    return this.getSignalConfig(signalId).enabled;
  }

  /**
   * Returns configured policy rule matching the given policy identifier.
   */
  public getPolicyRule(policyId: RiskPolicyId): ConfigurablePolicyRule | undefined {
    return this.activeConfig.policies.find((p) => p.id === policyId);
  }

  /**
   * Checks whether a policy is enabled in the active configuration.
   * Mandatory security invariants always return true.
   */
  public isPolicyEnabled(policyId: RiskPolicyId): boolean {
    const rule = this.getPolicyRule(policyId);
    if (!rule) return false;
    if (rule.isImmutableSecurityInvariant) return true;
    return rule.enabled;
  }

  /**
   * Returns configured decision for a policy.
   */
  public getPolicyDecision(policyId: RiskPolicyId): ResponseAction | undefined {
    return this.getPolicyRule(policyId)?.decision;
  }

  /**
   * Returns the list of trusted domain hostnames.
   */
  public getTrustedDomains(): readonly string[] {
    return this.activeConfig.trustedDomains;
  }

  /**
   * Checks if a domain or URL hostname is in the trusted domains allowlist.
   * Automatically normalizes URLs, ports, and case.
   *
   * @param domainOrUrl Hostname string or full URL
   */
  public isTrustedDomain(domainOrUrl: string): boolean {
    if (!domainOrUrl || typeof domainOrUrl !== 'string') return false;

    let hostname = domainOrUrl.trim().toLowerCase();
    if (hostname.includes('://')) {
      try {
        hostname = new URL(hostname).hostname.toLowerCase();
      } catch {
        return false;
      }
    } else {
      // Strip port or path if accidentally included
      hostname = hostname.split('/')[0].split(':')[0].trim();
    }

    if (!hostname) return false;

    // Check exact match or localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    return this.activeConfig.trustedDomains.some((trusted) => {
      const normalizedTrusted = trusted.trim().toLowerCase();
      return (
        hostname === normalizedTrusted ||
        hostname.endsWith(`.${normalizedTrusted}`)
      );
    });
  }

  /**
   * Returns operational timeouts configuration.
   */
  public getTimeouts(): OperationalTimeouts {
    return this.activeConfig.timeouts;
  }

  /**
   * Subscribes to configuration change events.
   * Returns an unsubscribe function.
   */
  public subscribe(listener: PolicyConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.activeConfig);
      } catch (err) {
        console.error('[Guardrail PolicyConfigRegistry] Error in config listener:', err);
      }
    }
  }
}

/**
 * Global default instance of the PolicyConfigRegistry.
 */
export const defaultPolicyConfigRegistry = new PolicyConfigRegistry();

// Convenience top-level accessor functions delegating to default registry
export function getActivePolicyConfig(): GuardrailPolicyConfig {
  return defaultPolicyConfigRegistry.getConfig();
}

export function setActivePolicyConfig(candidate: unknown): GuardrailPolicyConfig {
  return defaultPolicyConfigRegistry.setConfig(candidate);
}

export function setActivePolicyConfigSafe(candidate: unknown): GuardrailPolicyConfig {
  return defaultPolicyConfigRegistry.setConfigSafe(candidate);
}

export function resetActivePolicyConfig(): GuardrailPolicyConfig {
  return defaultPolicyConfigRegistry.resetToDefault();
}

export function getRiskThresholds(): RiskThresholdSettings {
  return defaultPolicyConfigRegistry.getRiskThresholds();
}

export function getCriticalThresholdScore(): number {
  return defaultPolicyConfigRegistry.getCriticalThresholdScore();
}

export function getRoutineThresholdMax(): number {
  return defaultPolicyConfigRegistry.getRoutineThresholdMax();
}

export function getSignalContribution(signalId: RiskSignalId): number {
  return defaultPolicyConfigRegistry.getSignalContribution(signalId);
}

export function isSignalEnabled(signalId: RiskSignalId): boolean {
  return defaultPolicyConfigRegistry.isSignalEnabled(signalId);
}

export function getPolicyRuleConfig(policyId: RiskPolicyId): ConfigurablePolicyRule | undefined {
  return defaultPolicyConfigRegistry.getPolicyRule(policyId);
}

export function isPolicyEnabled(policyId: RiskPolicyId): boolean {
  return defaultPolicyConfigRegistry.isPolicyEnabled(policyId);
}

export function getPolicyDecision(policyId: RiskPolicyId): ResponseAction | undefined {
  return defaultPolicyConfigRegistry.getPolicyDecision(policyId);
}

export function getTrustedDomains(): readonly string[] {
  return defaultPolicyConfigRegistry.getTrustedDomains();
}

export function isTrustedDomain(domainOrUrl: string): boolean {
  return defaultPolicyConfigRegistry.isTrustedDomain(domainOrUrl);
}

export function getOperationalTimeouts(): OperationalTimeouts {
  return defaultPolicyConfigRegistry.getTimeouts();
}

export function getConfigHealthStatus(): ConfigHealthStatus {
  return defaultPolicyConfigRegistry.getHealthStatus();
}

export function isConfigDegraded(): boolean {
  return defaultPolicyConfigRegistry.isDegraded();
}

export function isConfigFailed(): boolean {
  return defaultPolicyConfigRegistry.isFailed();
}

export function getConfigLastError(): ConfigErrorDetail | undefined {
  return defaultPolicyConfigRegistry.getLastError();
}

export function loadPolicyConfigFromStorage(options?: ConfigLoadOptions): Promise<ConfigLoadResult> {
  return defaultPolicyConfigRegistry.loadFromStorage(options);
}

export function reloadPolicyConfig(options?: ConfigLoadOptions): Promise<ConfigLoadResult> {
  return defaultPolicyConfigRegistry.reload(options);
}

// Aliases
export const policyConfigRegistry = defaultPolicyConfigRegistry;
export const getTimeouts = getOperationalTimeouts;

