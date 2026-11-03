/**
 * Guardrail Controlled Pilot - Onboarding & Installation Types
 *
 * Defines the domain model for extension installation, first-time user experience,
 * boundary disclosures, permission explanations, and live protection diagnostics.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. TRUTHFUL PROTECTION SCOPE:
 *    - Never claim that every website or action is protected.
 *    - Explicitly distinguish supported pilot test actions from arbitrary websites.
 * 2. NO FALSE SENSE OF SECURITY:
 *    - Never imply a user is protected when the extension or policy is inactive.
 * 3. STRICT PRIVACY INVARIANTS:
 *    - Explicitly state and enforce zero collection of passwords, card numbers,
 *      OTPs, or raw sensitive form inputs.
 * 4. LEAST PRIVILEGE:
 *    - Document why each browser permission is requested before the user grants it.
 */

import { AppEnvironment, ServiceType } from '../config/environment.js';
import { ConfigHealthStatus } from '../types/config.js';

/**
 * Sequential steps in the pilot onboarding workflow.
 */
export type OnboardingStepId =
  | 'installation_guide'
  | 'protection_scope'
  | 'browser_permissions'
  | 'staging_mode'
  | 'trusted_approval'
  | 'protection_status'
  | 'setup_complete';

/**
 * Metadata defining an onboarding step.
 */
export interface OnboardingStepDefinition {
  readonly id: OnboardingStepId;
  readonly index: number;
  readonly title: string;
  readonly shortLabel: string;
  readonly description: string;
}

/**
 * Persistent onboarding state tracking user progress.
 */
export interface OnboardingState {
  /** The current active step */
  readonly currentStep: OnboardingStepId;

  /** List of step IDs that have been reviewed or completed */
  readonly completedSteps: readonly OnboardingStepId[];

  /** Whether the full onboarding workflow is completed */
  readonly isCompleted: boolean;

  /** User explicit acknowledgement that Guardrail does NOT protect arbitrary websites */
  readonly acknowledgedScope: boolean;

  /** User explicit acknowledgement of browser permissions and zero sensitive data collection */
  readonly acknowledgedPermissions: boolean;

  /** User explicit acknowledgement of Staging Mode (held actions, zero auto-exec) */
  readonly acknowledgedStaging: boolean;

  /** User explicit acknowledgement of trusted contact approval role */
  readonly acknowledgedApprovals: boolean;

  /** ISO timestamp of completion */
  readonly completedAt: string | null;

  /** Version of onboarding workflow viewed */
  readonly version: string;
}

/**
 * Comprehensive status of Guardrail protection.
 */
export type ExtensionOperationalState =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'INITIALIZING'
  | 'POLICY_ERROR'
  | 'DEGRADED';

/**
 * Structured report of current protection status and configuration.
 */
export interface ProtectionStatusReport {
  /** Overall operational status */
  readonly status: ExtensionOperationalState;

  /** Whether protection is currently active for supported test actions */
  readonly isProtected: boolean;

  /** Short user-facing status title */
  readonly statusTitle: string;

  /** Precise, truthful explanation of the current protection status */
  readonly statusDescription: string;

  /** Execution environment (pilot, development, production, test) */
  readonly environment: AppEnvironment;

  /** Base URL of the backend approval API */
  readonly apiBaseUrl: string;

  /** Classification of backend service (live vs mock/in-memory) */
  readonly serviceType: ServiceType;

  /** True if using a mock or in-memory backend */
  readonly isMockService: boolean;

  /** Operational health of policy configuration */
  readonly policyHealth: ConfigHealthStatus;

  /** Active policy schema and rules version */
  readonly policyVersion: string;

  /** Number of active policy rules */
  readonly activeRulesCount: number;

  /** Structured scope disclosures */
  readonly scope: {
    readonly protectedItems: readonly string[];
    readonly unprotectedItems: readonly string[];
  };

  /** Core privacy invariants */
  readonly privacyGuarantees: readonly string[];

  /** Diagnostic checklist results */
  readonly diagnostics: SetupDiagnostics;
}

/**
 * System diagnostics result for pilot setup.
 */
export interface SetupDiagnostics {
  /** Whether browser storage is operational */
  readonly isStorageFunctional: boolean;

  /** Whether policy configuration loaded successfully without fatal errors */
  readonly isPolicyConfigValid: boolean;

  /** Whether environment enforces HTTPS (for pilot/prod) */
  readonly isHttpsEnforced: boolean;

  /** Whether mock service is active */
  readonly isMockService: boolean;

  /** List of critical configuration or permission errors */
  readonly errors: readonly string[];

  /** List of operational warnings */
  readonly warnings: readonly string[];

  /** Overall readiness score / boolean */
  readonly isReadyForPilot: boolean;
}

/**
 * Browser permission disclosure definition.
 */
export interface PermissionDisclosure {
  readonly permission: string;
  readonly name: string;
  readonly rationale: string;
  readonly whatItAccesses: string;
  readonly whatItNeverAccesses: string;
}
