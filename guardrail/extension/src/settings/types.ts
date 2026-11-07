/**
 * Guardrail UI - Protection Settings Interface Types
 *
 * Defines state, data models, props, and callbacks for the protected user's
 * protection policy configuration interface.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Truthful Capability Representation:
 *    - Never presents unsupported or simulated features as active toggles.
 * 2. Immutable Security Policy Protection:
 *    - Mandatory invariants (CONTROLLED_DESTRUCTIVE, UNSUPPORTED_BOUNDARY_GUARD)
 *      are clearly identified as locked and immutable.
 * 3. Bounded Configuration Safety:
 *    - All editable settings are validated before saving.
 */

import {
  ConfigHealthStatus,
  GuardrailPolicyConfig,
  PolicyConfigValidationErrorDetail,
  RiskThresholdSettings,
} from '../types/config.js';
import { RiskPolicyId } from '../types/policy.js';
import { ProtectionStatusReport } from '../onboarding/types.js';

/**
 * Sensitivity preset presets mapping to validated threshold combinations.
 */
export type SensitivityPreset = 'balanced' | 'strict' | 'custom';

/**
 * Preset threshold configurations conforming strictly to schema bounds.
 */
export const SENSITIVITY_PRESETS: Record<
  Exclude<SensitivityPreset, 'custom'>,
  Readonly<RiskThresholdSettings>
> = Object.freeze({
  /** Balanced (Default): Standard protection balancing friction and security */
  balanced: Object.freeze({
    lowMax: 24,
    mediumMax: 49,
    highMax: 74,
  }),
  /** Strict (High Caution): Lower ceilings trigger earlier warnings and protective holding */
  strict: Object.freeze({
    lowMax: 15,
    mediumMax: 35,
    highMax: 60,
  }),
});

/**
 * Trusted contact visibility for the protected user.
 */
export interface TrustedContactCoverage {
  /** True if user has at least one active designated trusted contact */
  readonly hasActiveContact: boolean;
  /** Active contacts designated by this ward */
  readonly activeContacts: ReadonlyArray<{
    readonly id: string;
    readonly relationshipLabel?: string;
  }>;
}

/**
 * Operational state of the protection settings interface.
 */
export type SettingsViewStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'error';

/**
 * Full state structure governing the protection settings interface.
 */
export interface ProtectionSettingsState {
  /** Operational interface status */
  readonly status: SettingsViewStatus;

  /** Canonical saved configuration in effect */
  readonly savedConfig: GuardrailPolicyConfig;

  /** In-memory draft configuration reflecting uncommitted user changes */
  readonly draftConfig: GuardrailPolicyConfig;

  /** True if the user has modified settings compared to saved configuration */
  readonly isDirty: boolean;

  /** Active sensitivity preset or custom */
  readonly sensitivityPreset: SensitivityPreset;

  /** Active validation errors on the current draft, empty if valid */
  readonly validationErrors: readonly PolicyConfigValidationErrorDetail[];

  /** Live protection status evaluation report */
  readonly protectionReport: ProtectionStatusReport | null;

  /** Active policy health status */
  readonly policyHealth: ConfigHealthStatus;

  /** Active trusted-contact coverage visibility */
  readonly trustedContactCoverage: TrustedContactCoverage;

  /** User feedback success message */
  readonly successMessage: string | null;

  /** User feedback error message */
  readonly errorMessage: string | null;

  /** Active filter or tab in settings if tabbed */
  readonly activeCategoryFilter?: RiskPolicyId | 'ALL';
}

/**
 * Handlers and dependencies passed to the protection settings view or component.
 */
export interface ProtectionSettingsProps {
  /** Initial configuration (defaults to DEFAULT_GUARDRAIL_POLICY_CONFIG if omitted) */
  readonly initialConfig?: GuardrailPolicyConfig;

  /** Initial live protection report */
  readonly initialProtectionReport?: ProtectionStatusReport | null;

  /** Initial trusted contact coverage */
  readonly initialCoverage?: TrustedContactCoverage;

  /** Optional storage persistence handler (defaults to extension storage) */
  readonly onSave?: (
    config: GuardrailPolicyConfig
  ) => Promise<{ success: boolean; error?: string }>;

  /** Optional callback after successful save */
  readonly onSaveSuccess?: (config: GuardrailPolicyConfig) => void;

  /** Optional reset to defaults handler */
  readonly onResetDefaults?: () => Promise<void> | void;

  /** Optional change listener fired whenever the draft changes */
  readonly onDraftChange?: (draft: GuardrailPolicyConfig, isValid: boolean) => void;

  /** Optional navigation handler when user exits or navigates */
  readonly onExit?: () => void;
}
