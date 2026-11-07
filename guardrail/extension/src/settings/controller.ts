/**
 * Guardrail UI - Protection Settings Controller
 *
 * Implements business logic, validation, state management, and persistence
 * coordination for the protected user's settings interface.
 *
 * CRITICAL SAFETY & SECURITY INVARIANTS:
 * 1. MANDATORY POLICY IMMUTABILITY:
 *    - Rejects any attempt to disable or downgrade CONTROLLED_DESTRUCTIVE or
 *      UNSUPPORTED_BOUNDARY_GUARD.
 * 2. NO PERMISSIVE DOWNGRADES:
 *    - Sensitive boundary policies (PAYMENT, EXTERNAL_NAVIGATION, AUTHENTICATION_BOUNDARY)
 *      can never be set to ALLOW.
 * 3. FAIL-CLOSED VALIDATION:
 *    - All changes are strictly validated via validatePolicyConfig() prior to persistence.
 *    - Malformed or out-of-bounds inputs prevent save execution.
 * 4. TRUTHFUL CAPABILITY DISCLOSURE:
 *    - Never fakes save operations or claims unconfigured notifications are active.
 */

import {
  ConfigHealthStatus,
  GuardrailPolicyConfig,
  OperationalTimeouts,
  PolicyConfigValidationErrorDetail,
  RiskThresholdSettings,
} from '../types/config.js';
import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  HOSTNAME_REGEX,
  validatePolicyConfig,
} from '../config/schema.js';
import {
  loadPolicyConfigFromStorage,
  savePolicyConfigToStorage,
} from '../config/registry.js';
import { resolveEnvironmentConfig } from '../config/environment.js';
import { evaluateProtectionStatus } from '../onboarding/state.js';
import { ProtectionStatusReport } from '../onboarding/types.js';
import {
  ProtectionSettingsProps,
  ProtectionSettingsState,
  SENSITIVITY_PRESETS,
  SensitivityPreset,
  TrustedContactCoverage,
} from './types.js';

export class ProtectionSettingsController {
  private state: ProtectionSettingsState;
  private readonly listeners: Set<(state: ProtectionSettingsState) => void> = new Set();
  private readonly props: ProtectionSettingsProps;

  constructor(props: ProtectionSettingsProps = {}) {
    this.props = props;

    const initialConfig = props.initialConfig
      ? deepCloneConfig(props.initialConfig)
      : deepCloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);

    this.state = {
      status: 'loading',
      savedConfig: initialConfig,
      draftConfig: deepCloneConfig(initialConfig),
      isDirty: false,
      sensitivityPreset: determineSensitivityPreset(initialConfig.thresholds),
      validationErrors: [],
      protectionReport: props.initialProtectionReport ?? null,
      policyHealth: ConfigHealthStatus.HEALTHY,
      trustedContactCoverage: props.initialCoverage ?? {
        hasActiveContact: false,
        activeContacts: [],
      },
      successMessage: null,
      errorMessage: null,
    };
  }

  public getState(): ProtectionSettingsState {
    return this.state;
  }

  public subscribe(listener: (state: ProtectionSettingsState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('[ProtectionSettingsController] Listener notification failed:', err);
      }
    }
  }

  /**
   * Initializes the controller, loading active configuration and evaluating live protection status.
   */
  public async initialize(): Promise<void> {
    this.updateState({ status: 'loading', errorMessage: null, successMessage: null });

    try {
      let loadedConfig = this.props.initialConfig;
      let healthStatus = ConfigHealthStatus.HEALTHY;

      if (!loadedConfig) {
        try {
          const loadResult = await loadPolicyConfigFromStorage();
          loadedConfig = loadResult.config;
          healthStatus = loadResult.healthStatus;
        } catch {
          loadedConfig = DEFAULT_GUARDRAIL_POLICY_CONFIG;
          healthStatus = ConfigHealthStatus.DEGRADED;
        }
      }

      const env = resolveEnvironmentConfig();
      const report = evaluateProtectionStatus({
        envConfig: env,
        policyConfig: loadedConfig,
        policyHealth: healthStatus,
        isServiceWorkerActive: true,
        isStorageFunctional: true,
      });

      const cloned = deepCloneConfig(loadedConfig);

      this.updateState({
        status: 'ready',
        savedConfig: cloned,
        draftConfig: deepCloneConfig(cloned),
        isDirty: false,
        sensitivityPreset: determineSensitivityPreset(cloned.thresholds),
        validationErrors: [],
        protectionReport: report,
        policyHealth: healthStatus,
      });
    } catch (err) {
      this.updateState({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Failed to load protection settings.',
      });
    }
  }

  /**
   * Updates an existing policy rule in the draft.
   * Enforces that mandatory security invariants cannot be disabled or downgraded.
   */
  public updatePolicyRule(
    policyId: RiskPolicyId,
    changes: { enabled?: boolean; decision?: ResponseAction }
  ): boolean {
    const draft = deepCloneConfig(this.state.draftConfig);
    const ruleIndex = draft.policies.findIndex((p) => p.id === policyId);
    if (ruleIndex === -1) {
      return false;
    }

    const currentRule = draft.policies[ruleIndex];

    // INVARIANT 1: Mandatory security invariants cannot be disabled or downgraded
    if (currentRule.isImmutableSecurityInvariant) {
      if (changes.enabled === false || (changes.decision && changes.decision !== ResponseAction.PROTECT)) {
        this.updateState({
          errorMessage: `Security Invariant: Policy \"${currentRule.name}\" is mandatory and cannot be disabled or relaxed.`,
        });
        return false;
      }
    }

    // INVARIANT 2: Sensitive boundaries cannot be set to ALLOW
    if (changes.decision === ResponseAction.ALLOW) {
      const isSensitiveBoundary =
        policyId === RiskPolicyId.CONTROLLED_PAYMENT ||
        policyId === RiskPolicyId.EXTERNAL_NAVIGATION ||
        policyId === RiskPolicyId.AUTHENTICATION_BOUNDARY;

      if (isSensitiveBoundary) {
        this.updateState({
          errorMessage: `Safety Constraint: Sensitive boundary policy \"${currentRule.name}\" cannot be set to ALLOW. Permitted decisions are WARN or PROTECT.`,
        });
        return false;
      }
    }

    const updatedRule = {
      ...currentRule,
      ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {}),
      ...(changes.decision !== undefined ? { decision: changes.decision } : {}),
    };

    const updatedPolicies = [...draft.policies];
    updatedPolicies[ruleIndex] = updatedRule;
    draft.policies = updatedPolicies;

    this.applyDraftChanges(draft);
    return true;
  }

  /**
   * Updates operational risk threshold settings.
   */
  public updateThresholds(thresholds: Partial<RiskThresholdSettings>): void {
    const draft = deepCloneConfig(this.state.draftConfig);
    draft.thresholds = {
      ...draft.thresholds,
      ...thresholds,
    };

    const preset = determineSensitivityPreset(draft.thresholds);
    this.applyDraftChanges(draft, preset);
  }

  /**
   * Applies a documented sensitivity preset (balanced or strict).
   */
  public setSensitivityPreset(preset: SensitivityPreset): void {
    if (preset === 'custom') {
      this.updateState({ sensitivityPreset: 'custom' });
      return;
    }

    const presetThresholds = SENSITIVITY_PRESETS[preset];
    if (presetThresholds) {
      const draft = deepCloneConfig(this.state.draftConfig);
      draft.thresholds = { ...presetThresholds };
      this.applyDraftChanges(draft, preset);
    }
  }

  /**
   * Updates operational timeouts (approvalTtlSeconds, dashboardPollIntervalMs).
   */
  public updateOperationalTimeouts(timeouts: Partial<OperationalTimeouts>): void {
    const draft = deepCloneConfig(this.state.draftConfig);
    draft.timeouts = {
      ...draft.timeouts,
      ...timeouts,
    };
    this.applyDraftChanges(draft);
  }

  /**
   * Adds a trusted domain to the allowlist.
   */
  public addTrustedDomain(domain: string): { success: boolean; error?: string } {
    if (!domain || typeof domain !== 'string') {
      return { success: false, error: 'Domain must be a non-empty string.' };
    }

    const normalized = domain.trim().toLowerCase();
    if (!HOSTNAME_REGEX.test(normalized)) {
      return { success: false, error: `Invalid domain format: "${domain}". Expected valid hostname (e.g. "example.com").` };
    }

    const draft = deepCloneConfig(this.state.draftConfig);
    if (draft.trustedDomains.includes(normalized)) {
      return { success: false, error: `Domain "${normalized}" is already in the trusted list.` };
    }

    draft.trustedDomains = [...draft.trustedDomains, normalized];
    this.applyDraftChanges(draft);
    return { success: true };
  }

  /**
   * Removes a domain from the trusted domains allowlist.
   */
  public removeTrustedDomain(domain: string): boolean {
    const normalized = domain.trim().toLowerCase();
    const draft = deepCloneConfig(this.state.draftConfig);
    if (!draft.trustedDomains.includes(normalized)) {
      return false;
    }

    draft.trustedDomains = draft.trustedDomains.filter((d) => d !== normalized);
    this.applyDraftChanges(draft);
    return true;
  }

  /**
   * Resets draft settings to documented recommended defaults.
   */
  public resetToDefaults(): void {
    const defaultCopy = deepCloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
    this.applyDraftChanges(defaultCopy, 'balanced');
  }

  /**
   * Discards uncommitted draft changes and reverts to last saved configuration.
   */
  public discardDraft(): void {
    const reverted = deepCloneConfig(this.state.savedConfig);
    this.updateState({
      draftConfig: reverted,
      isDirty: false,
      sensitivityPreset: determineSensitivityPreset(reverted.thresholds),
      validationErrors: [],
      errorMessage: null,
      successMessage: null,
    });
  }

  /**
   * Sets trusted-contact relationship coverage for visibility display.
   */
  public setTrustedContactCoverage(coverage: TrustedContactCoverage): void {
    this.updateState({ trustedContactCoverage: coverage });
  }

  /**
   * Validates and persists current draft configuration through the architecture.
   */
  public async save(): Promise<{ success: boolean; error?: string }> {
    // 1. Client-side schema and invariant validation
    const validation = validatePolicyConfig(this.state.draftConfig);
    if (!validation.valid || !validation.config) {
      this.updateState({
        status: 'error',
        validationErrors: validation.errors,
        errorMessage: `Validation failed: Cannot save invalid configuration (${validation.errors.length} error(s)).`,
      });
      return {
        success: false,
        error: validation.errors.map((e) => `[${e.field}] ${e.message}`).join('; '),
      };
    }

    const validConfig = validation.config;
    this.updateState({ status: 'saving', errorMessage: null, successMessage: null });

    try {
      if (this.props.onSave) {
        const res = await this.props.onSave(validConfig);
        if (!res.success) {
          throw new Error(res.error || 'Failed to save protection settings.');
        }
      } else {
        await savePolicyConfigToStorage(validConfig);
      }

      const savedCopy = deepCloneConfig(validConfig);
      this.updateState({
        status: 'saved',
        savedConfig: savedCopy,
        draftConfig: deepCloneConfig(savedCopy),
        isDirty: false,
        validationErrors: [],
        successMessage: 'Protection settings successfully saved and applied.',
        errorMessage: null,
      });

      this.props.onSaveSuccess?.(validConfig);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to persist protection settings.';
      this.updateState({
        status: 'error',
        errorMessage: msg,
      });
      return { success: false, error: msg };
    }
  }

  private applyDraftChanges(
    draft: GuardrailPolicyConfig,
    preset?: SensitivityPreset
  ): void {
    // Validate candidate
    const validation = validatePolicyConfig(draft);
    const isDirty = !areConfigsEqual(draft, this.state.savedConfig);
    const resolvedPreset = preset ?? determineSensitivityPreset(draft.thresholds);

    this.updateState({
      draftConfig: draft,
      isDirty,
      sensitivityPreset: resolvedPreset,
      validationErrors: validation.errors,
      errorMessage: validation.valid ? null : this.state.errorMessage,
      successMessage: null,
    });

    this.props.onDraftChange?.(draft, validation.valid);
  }

  private updateState(partial: Partial<ProtectionSettingsState>): void {
    this.state = {
      ...this.state,
      ...partial,
    };
    this.notify();
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function deepCloneConfig(config: GuardrailPolicyConfig): GuardrailPolicyConfig {
  return JSON.parse(JSON.stringify(config));
}

function determineSensitivityPreset(thresholds: RiskThresholdSettings): SensitivityPreset {
  if (
    thresholds.lowMax === SENSITIVITY_PRESETS.balanced.lowMax &&
    thresholds.mediumMax === SENSITIVITY_PRESETS.balanced.mediumMax &&
    thresholds.highMax === SENSITIVITY_PRESETS.balanced.highMax
  ) {
    return 'balanced';
  }
  if (
    thresholds.lowMax === SENSITIVITY_PRESETS.strict.lowMax &&
    thresholds.mediumMax === SENSITIVITY_PRESETS.strict.mediumMax &&
    thresholds.highMax === SENSITIVITY_PRESETS.strict.highMax
  ) {
    return 'strict';
  }
  return 'custom';
}

function areConfigsEqual(a: GuardrailPolicyConfig, b: GuardrailPolicyConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
