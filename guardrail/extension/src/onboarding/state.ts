/**
 * Guardrail Controlled Pilot - Onboarding State Machine & Status Engine
 *
 * Coordinates onboarding progress, scope disclosures, permission explanations,
 * privacy invariants, and live protection status reporting.
 */

import { AppEnvironment, EnvironmentConfig, resolveEnvironmentConfig, ServiceType } from '../config/environment.js';
import { ConfigHealthStatus, GuardrailPolicyConfig } from '../types/config.js';
import {
  ExtensionOperationalState,
  OnboardingState,
  OnboardingStepDefinition,
  OnboardingStepId,
  PermissionDisclosure,
  ProtectionStatusReport,
  SetupDiagnostics,
} from './types.js';

export const ONBOARDING_STORAGE_KEY = 'guardrail_pilot_onboarding_state';
export const ONBOARDING_VERSION = '1.0.0-pilot';

/**
 * Sequential steps of the pilot onboarding experience.
 */
export const ONBOARDING_STEPS: readonly OnboardingStepDefinition[] = Object.freeze([
  {
    id: 'installation_guide',
    index: 0,
    title: 'Installation Instructions',
    shortLabel: '1. Install',
    description: 'Load the Guardrail extension in Chrome Developer Mode and verify activation.',
  },
  {
    id: 'protection_scope',
    index: 1,
    title: 'Protection Scope & Boundaries',
    shortLabel: '2. Scope',
    description: 'Understand exactly what Guardrail UI does and does NOT protect.',
  },
  {
    id: 'browser_permissions',
    index: 2,
    title: 'Browser Permissions & Privacy',
    shortLabel: '3. Permissions',
    description: 'Review requested browser permissions and our strict zero-sensitive-data guarantees.',
  },
  {
    id: 'staging_mode',
    index: 3,
    title: 'Understanding Staging Mode',
    shortLabel: '4. Staging Mode',
    description: 'Learn how actions are held synchronously and why zero actions run automatically.',
  },
  {
    id: 'trusted_approval',
    index: 4,
    title: 'Trusted Contact Approvals',
    shortLabel: '5. Approvals',
    description: 'See how remote trusted contacts review requests and how decision decoupling works.',
  },
  {
    id: 'protection_status',
    index: 5,
    title: 'Configuration & Status',
    shortLabel: '6. Status',
    description: 'Inspect live protection configuration, active policies, and backend health.',
  },
  {
    id: 'setup_complete',
    index: 6,
    title: 'Pilot Setup Complete',
    shortLabel: '7. Complete',
    description: 'Verify your pilot readiness checklist and launch the controlled test page.',
  },
]);

/**
 * Default initial onboarding state.
 */
export const DEFAULT_ONBOARDING_STATE: OnboardingState = Object.freeze({
  currentStep: 'installation_guide',
  completedSteps: [],
  isCompleted: false,
  acknowledgedScope: false,
  acknowledgedPermissions: false,
  acknowledgedStaging: false,
  acknowledgedApprovals: false,
  completedAt: null,
  version: ONBOARDING_VERSION,
});

/**
 * Explicit browser permission disclosures.
 * Pre-informs users of why each permission is required and what it never accesses.
 */
export const PERMISSION_DISCLOSURES: readonly PermissionDisclosure[] = Object.freeze([
  {
    permission: 'storage',
    name: 'Browser Local Storage',
    rationale: 'Required to persist local safety policy configurations and pilot onboarding state across browser restarts.',
    whatItAccesses: 'Local policy rule definitions, risk thresholds, and onboarding completion status.',
    whatItNeverAccesses: 'Browsing history, website cookies, cached webpage data, or personal account credentials.',
  },
  {
    permission: 'activeTab / content_scripts',
    name: 'Controlled DOM Action Detection',
    rationale: 'Runs the action detector on webpage DOMs to identify supported pilot test actions and synchronously hold them if high risk.',
    whatItAccesses: 'Interactions on buttons or forms designated for pilot testing (marked with data-guardrail-test-action).',
    whatItNeverAccesses: 'Input values typed into password fields, credit card forms, CVVs, OTP inputs, or arbitrary sensitive text.',
  },
]);

/**
 * Explicit privacy invariants guaranteed by Guardrail.
 */
export const PRIVACY_INVARIANTS: readonly string[] = Object.freeze([
  'NEVER captures, transmits, or logs passwords, PINs, or authentication secrets.',
  'NEVER captures, transmits, or logs credit card numbers, CVVs, or financial credentials.',
  'NEVER captures, transmits, or logs one-time passcodes (OTPs) or two-factor SMS/email codes.',
  'NEVER collects raw user form values from monitored input fields.',
  'Strictly sanitizes URLs in diagnostic logs and approval metadata to remove sensitive parameters.',
]);

/**
 * Explicit boundaries of what Guardrail protects and does NOT protect.
 */
export const SCOPE_DISCLOSURES = Object.freeze({
  protectedItems: Object.freeze([
    'Designated pilot test actions marked with data-guardrail-test-action (e.g. transfer and credential forms).',
    'Synchronous event interception and cancellation for supported click and submit actions before browser propagation.',
    'Holding intercepted actions in Staging Mode memory for deliberate local cancellation or human review.',
    'Out-of-band approval requests sent to the configured Guardrail backend for trusted contact review.',
    'Strict fail-closed enforcement when policy configuration is corrupted or uninitialized.',
  ]),
  unprotectedItems: Object.freeze([
    'Arbitrary third-party websites or unmarked interactive web page elements.',
    'Ambient background scripts, asynchronous fetch/XHR, or WebSockets initiated by page JavaScript.',
    'Web pages loaded before extension installation or while the extension service worker is inactive or suspended.',
    'Phishing attacks, malicious browser extensions, keyloggers, or operating system-level malware.',
    'Direct browser navigation, browser chrome UI (bookmarks, url bar, settings), or downloads.',
  ]),
});

/**
 * Storage provider interface for loading/saving onboarding state.
 */
export interface OnboardingStorageProvider {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove?(key: string): Promise<void>;
}

/**
 * Chrome storage implementation.
 */
export class ChromeOnboardingStorageProvider implements OnboardingStorageProvider {
  public async get(key: string): Promise<unknown> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
      try {
        const res = await chrome.storage.local.get(key);
        return res ? res[key] : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  public async set(key: string, value: unknown): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
      try {
        await chrome.storage.local.set({ [key]: value });
      } catch {
        // storage write failure handled gracefully
      }
    }
  }

  public async remove(key: string): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.remove) {
      try {
        await chrome.storage.local.remove(key);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * In-memory storage provider for testing.
 */
export class InMemoryOnboardingStorageProvider implements OnboardingStorageProvider {
  private readonly map = new Map<string, unknown>();

  public async get(key: string): Promise<unknown> {
    return this.map.get(key);
  }

  public async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }

  public async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/**
 * Retrieves the stored onboarding state, falling back to defaults if not found.
 */
export async function getStoredOnboardingState(
  storage: OnboardingStorageProvider = new ChromeOnboardingStorageProvider()
): Promise<OnboardingState> {
  try {
    const raw = await storage.get(ONBOARDING_STORAGE_KEY);
    if (!raw || typeof raw !== 'object') {
      return DEFAULT_ONBOARDING_STATE;
    }
    const parsed = raw as Record<string, unknown>;

    const validStepIds = new Set(ONBOARDING_STEPS.map((s) => s.id));
    const currentStep =
      typeof parsed.currentStep === 'string' && validStepIds.has(parsed.currentStep as OnboardingStepId)
        ? (parsed.currentStep as OnboardingStepId)
        : DEFAULT_ONBOARDING_STATE.currentStep;

    const completedSteps: OnboardingStepId[] = Array.isArray(parsed.completedSteps)
      ? parsed.completedSteps.filter((s): s is OnboardingStepId => typeof s === 'string' && validStepIds.has(s as OnboardingStepId))
      : [];

    return {
      currentStep,
      completedSteps,
      isCompleted: Boolean(parsed.isCompleted),
      acknowledgedScope: Boolean(parsed.acknowledgedScope),
      acknowledgedPermissions: Boolean(parsed.acknowledgedPermissions),
      acknowledgedStaging: Boolean(parsed.acknowledgedStaging),
      acknowledgedApprovals: Boolean(parsed.acknowledgedApprovals),
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
      version: typeof parsed.version === 'string' ? parsed.version : ONBOARDING_VERSION,
    };
  } catch {
    return DEFAULT_ONBOARDING_STATE;
  }
}

/**
 * Persists updated onboarding state.
 */
export async function saveStoredOnboardingState(
  state: OnboardingState,
  storage: OnboardingStorageProvider = new ChromeOnboardingStorageProvider()
): Promise<void> {
  await storage.set(ONBOARDING_STORAGE_KEY, state);
}

/**
 * Resets onboarding state back to initial uncompleted state.
 */
export async function resetOnboardingState(
  storage: OnboardingStorageProvider = new ChromeOnboardingStorageProvider()
): Promise<OnboardingState> {
  const freshState = { ...DEFAULT_ONBOARDING_STATE };
  await storage.set(ONBOARDING_STORAGE_KEY, freshState);
  return freshState;
}

/**
 * Marks an onboarding step as completed and updates checklist state.
 */
export function advanceOnboardingStep(
  currentState: OnboardingState,
  stepId: OnboardingStepId,
  acknowledgements?: Partial<{
    scope: boolean;
    permissions: boolean;
    staging: boolean;
    approvals: boolean;
  }>
): OnboardingState {
  const completed = new Set(currentState.completedSteps);
  completed.add(stepId);

  const currentIndex = ONBOARDING_STEPS.findIndex((s) => s.id === stepId);
  const nextStepDef = ONBOARDING_STEPS[currentIndex + 1];
  const nextStep = nextStepDef ? nextStepDef.id : stepId;

  const acknowledgedScope = acknowledgements?.scope ?? currentState.acknowledgedScope;
  const acknowledgedPermissions = acknowledgements?.permissions ?? currentState.acknowledgedPermissions;
  const acknowledgedStaging = acknowledgements?.staging ?? currentState.acknowledgedStaging;
  const acknowledgedApprovals = acknowledgements?.approvals ?? currentState.acknowledgedApprovals;

  // Full completion requires all key steps completed and acknowledgements verified
  const allStepsCompleted = ONBOARDING_STEPS.every((s) => completed.has(s.id));
  const isCompleted =
    allStepsCompleted &&
    acknowledgedScope &&
    acknowledgedPermissions &&
    acknowledgedStaging &&
    acknowledgedApprovals;

  return {
    ...currentState,
    currentStep: nextStep,
    completedSteps: Array.from(completed),
    acknowledgedScope,
    acknowledgedPermissions,
    acknowledgedStaging,
    acknowledgedApprovals,
    isCompleted,
    completedAt: isCompleted ? (currentState.completedAt || new Date().toISOString()) : null,
  };
}

/**
 * Evaluates setup diagnostics to detect configuration errors, permission problems,
 * or insecure endpoints.
 */
export function evaluateSetupDiagnostics(
  envConfig: EnvironmentConfig,
  policyHealth: ConfigHealthStatus,
  storageFunctional = true
): SetupDiagnostics {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!storageFunctional) {
    errors.push('Browser storage is inaccessible. Policy configuration cannot be persisted or loaded.');
  }

  if (policyHealth === ConfigHealthStatus.FAILED) {
    errors.push('Policy configuration failed validation or is corrupted. Guardrail is operating in fail-closed safety lock.');
  } else if (policyHealth === ConfigHealthStatus.UNINITIALIZED) {
    warnings.push('Policy configuration has not initialized yet. Waiting for configuration bootstrap.');
  } else if (policyHealth === ConfigHealthStatus.DEGRADED) {
    warnings.push('Policy configuration is running in degraded mode with safe fallbacks applied.');
  }

  // HTTPS validation in pilot / production
  let isHttpsEnforced = true;
  if ((envConfig.environment === 'pilot' || envConfig.environment === 'production') && !envConfig.apiBaseUrl.startsWith('https://')) {
    if (!envConfig.allowInsecureHttp) {
      errors.push(`Insecure HTTP endpoint rejected in ${envConfig.environment} mode: "${envConfig.apiBaseUrl}". Remote services require HTTPS.`);
      isHttpsEnforced = false;
    } else {
      warnings.push(`Operating with unencrypted HTTP endpoint in ${envConfig.environment} mode for local testing.`);
    }
  }

  // Mock service advisory
  if (envConfig.isMockService) {
    warnings.push('Active backend is an in-memory/mock service. Approvals will be simulated locally and will not reach real remote contacts.');
  }

  const isPolicyConfigValid = policyHealth === ConfigHealthStatus.HEALTHY || policyHealth === ConfigHealthStatus.DEGRADED;
  const isReadyForPilot = errors.length === 0 && isPolicyConfigValid && storageFunctional;

  return {
    isStorageFunctional: storageFunctional,
    isPolicyConfigValid,
    isHttpsEnforced,
    isMockService: envConfig.isMockService,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    isReadyForPilot,
  };
}

/**
 * Evaluates the live operational protection status.
 *
 * CRITICAL SAFETY INVARIANTS:
 * 1. Never imply a user is protected when the extension or policy is inactive or failed.
 * 2. When active, strictly qualify that protection applies ONLY to supported pilot test actions.
 */
export function evaluateProtectionStatus(options: {
  envConfig?: EnvironmentConfig;
  policyConfig?: GuardrailPolicyConfig | null;
  policyHealth?: ConfigHealthStatus;
  isServiceWorkerActive?: boolean;
  isStorageFunctional?: boolean;
}): ProtectionStatusReport {
  const env = options.envConfig ?? resolveEnvironmentConfig();
  const health = options.policyHealth ?? ConfigHealthStatus.UNINITIALIZED;
  const isWorkerActive = options.isServiceWorkerActive ?? true;
  const isStorageOk = options.isStorageFunctional ?? true;
  const policy = options.policyConfig;

  const diagnostics = evaluateSetupDiagnostics(env, health, isStorageOk);

  let status: ExtensionOperationalState = 'ACTIVE';
  let statusTitle = 'Active (Test Actions Only)';
  let statusDescription = 'Evaluating supported pilot test actions against active safety policies. Arbitrary websites are not protected.';
  let isProtected = true;

  if (!isWorkerActive) {
    status = 'INACTIVE';
    statusTitle = 'Inactive (Service Worker Offline)';
    statusDescription = 'The extension background service worker is inactive. Actions on web pages are not evaluated or protected.';
    isProtected = false;
  } else if (!isStorageOk || health === ConfigHealthStatus.FAILED) {
    status = 'POLICY_ERROR';
    statusTitle = 'Policy Error (Fail-Closed)';
    statusDescription = 'Safety policy failed to load or validate. Supported actions are blocked fail-closed; arbitrary websites remain unprotected.';
    isProtected = false;
  } else if (health === ConfigHealthStatus.UNINITIALIZED) {
    status = 'INITIALIZING';
    statusTitle = 'Initializing Configuration';
    statusDescription = 'Policy configuration is initializing. Protection for supported actions will activate momentarily.';
    isProtected = false;
  } else if (health === ConfigHealthStatus.DEGRADED || diagnostics.warnings.length > 0) {
    status = 'DEGRADED';
    statusTitle = 'Active (Degraded / Fallbacks)';
    statusDescription = 'Evaluating supported pilot test actions using default safety fallbacks. Arbitrary websites are not protected.';
    isProtected = true;
  }

  const activeRulesCount = policy?.rules ? policy.rules.filter((r) => r.enabled).length : 3;
  const policyVersion = policy?.policyVersion ?? '1.0.0';

  return {
    status,
    isProtected,
    statusTitle,
    statusDescription,
    environment: env.environment,
    apiBaseUrl: env.apiBaseUrl,
    serviceType: env.serviceType,
    isMockService: env.isMockService,
    policyHealth: health,
    policyVersion,
    activeRulesCount,
    scope: SCOPE_DISCLOSURES,
    privacyGuarantees: PRIVACY_INVARIANTS,
    diagnostics,
  };
}
