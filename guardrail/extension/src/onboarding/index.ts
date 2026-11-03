/**
 * Guardrail UI - Controlled Pilot Onboarding Controller
 *
 * Coordinates step navigation, interactive disclosures, acknowledgement validation,
 * live protection status rendering, and setup completion persistence.
 */

import { resolveEnvironmentConfig } from '../config/environment.js';
import { ConfigHealthStatus } from '../types/config.js';
import { loadPolicyConfigFromStorage } from '../config/registry.js';
import {
  advanceOnboardingStep,
  DEFAULT_ONBOARDING_STATE,
  evaluateProtectionStatus,
  getStoredOnboardingState,
  ONBOARDING_STEPS,
  resetOnboardingState,
  saveStoredOnboardingState,
} from './state.js';
import { OnboardingState, OnboardingStepId, ProtectionStatusReport } from './types.js';

let state: OnboardingState = { ...DEFAULT_ONBOARDING_STATE };
let statusReport: ProtectionStatusReport | null = null;

/**
 * Initializes the onboarding interface when DOM is ready.
 */
export async function initializeOnboardingUI(): Promise<void> {
  state = await getStoredOnboardingState();
  statusReport = await refreshProtectionStatus();

  renderSidebarNavigation();
  renderCurrentStep();
  setupEventListeners();
  updateDiagnosticsBanner();

  console.log('[Guardrail Onboarding] Initialized at step:', state.currentStep);
}

/**
 * Refreshes live operational protection status.
 */
async function refreshProtectionStatus(): Promise<ProtectionStatusReport> {
  const env = resolveEnvironmentConfig();
  let policyResult;
  let isStorageOk = true;

  try {
    policyResult = await loadPolicyConfigFromStorage();
  } catch {
    isStorageOk = false;
  }

  const report = evaluateProtectionStatus({
    envConfig: env,
    policyConfig: policyResult?.config ?? null,
    policyHealth: policyResult?.healthStatus ?? ConfigHealthStatus.UNINITIALIZED,
    isServiceWorkerActive: true,
    isStorageFunctional: isStorageOk,
  });

  updateStatusDisplay(report);
  return report;
}

/**
 * Renders the sidebar navigation list.
 */
function renderSidebarNavigation(): void {
  const list = document.getElementById('step-nav-list');
  if (!list) return;

  list.innerHTML = '';

  for (const step of ONBOARDING_STEPS) {
    const li = document.createElement('li');
    li.className = 'step-item';
    li.setAttribute('role', 'tab');
    li.setAttribute('id', `step-nav-${step.id}`);
    li.setAttribute('aria-selected', step.id === state.currentStep ? 'true' : 'false');

    if (step.id === state.currentStep) {
      li.classList.add('active');
    }
    if (state.completedSteps.includes(step.id)) {
      li.classList.add('completed');
    }

    const badge = document.createElement('span');
    badge.className = 'step-item-badge';
    badge.textContent = state.completedSteps.includes(step.id) ? '✓' : String(step.index + 1);

    const label = document.createElement('span');
    label.textContent = step.shortLabel;

    li.appendChild(badge);
    li.appendChild(label);

    li.addEventListener('click', () => {
      // Allow jumping to already completed steps or the current step
      const stepIndex = step.index;
      const currentStepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === state.currentStep);
      if (stepIndex <= currentStepIndex || state.completedSteps.includes(step.id)) {
        goToStep(step.id);
      }
    });

    list.appendChild(li);
  }
}

/**
 * Renders the active step panel and updates headers/buttons.
 */
function renderCurrentStep(): void {
  const stepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === state.currentStep);
  const currentStepDef = ONBOARDING_STEPS[stepIndex] || ONBOARDING_STEPS[0];

  // Update header text
  const indicator = document.getElementById('step-indicator-text');
  const heading = document.getElementById('step-heading-text');
  const lead = document.getElementById('step-lead-text');

  if (indicator) indicator.textContent = `Step ${stepIndex + 1} of ${ONBOARDING_STEPS.length}`;
  if (heading) heading.textContent = currentStepDef.title;
  if (lead) lead.textContent = currentStepDef.description;

  // Toggle active panel
  for (const step of ONBOARDING_STEPS) {
    const panel = document.getElementById(`panel-${step.id}`);
    if (panel) {
      if (step.id === state.currentStep) {
        panel.classList.remove('hidden');
      } else {
        panel.classList.add('hidden');
      }
    }
  }

  // Update sidebar active class
  for (const step of ONBOARDING_STEPS) {
    const navItem = document.getElementById(`step-nav-${step.id}`);
    if (navItem) {
      if (step.id === state.currentStep) {
        navItem.classList.add('active');
        navItem.setAttribute('aria-selected', 'true');
      } else {
        navItem.classList.remove('active');
        navItem.setAttribute('aria-selected', 'false');
      }
      if (state.completedSteps.includes(step.id)) {
        navItem.classList.add('completed');
        const badge = navItem.querySelector('.step-item-badge');
        if (badge) badge.textContent = '✓';
      }
    }
  }

  // Restore checkbox states if acknowledged
  const ackScope = document.getElementById('ack-scope') as HTMLInputElement | null;
  const ackPerm = document.getElementById('ack-permissions') as HTMLInputElement | null;
  const ackStaging = document.getElementById('ack-staging') as HTMLInputElement | null;
  const ackApprovals = document.getElementById('ack-approvals') as HTMLInputElement | null;

  if (ackScope) ackScope.checked = state.acknowledgedScope;
  if (ackPerm) ackPerm.checked = state.acknowledgedPermissions;
  if (ackStaging) ackStaging.checked = state.acknowledgedStaging;
  if (ackApprovals) ackApprovals.checked = state.acknowledgedApprovals;

  // Update navigation buttons
  updateNavigationButtons(stepIndex);
}

/**
 * Updates Next/Back buttons state based on step and acknowledgement prerequisites.
 */
function updateNavigationButtons(stepIndex: number): void {
  const btnBack = document.getElementById('btn-back') as HTMLButtonElement | null;
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement | null;
  const helperText = document.getElementById('footer-helper-text');

  if (btnBack) {
    btnBack.disabled = stepIndex === 0;
  }

  if (btnNext) {
    const isLastStep = stepIndex === ONBOARDING_STEPS.length - 1;

    if (isLastStep) {
      btnNext.textContent = 'Setup Completed ✓';
      btnNext.disabled = !state.isCompleted;
    } else {
      btnNext.textContent = 'Next →';
      // Validate acknowledgement prerequisite for the current step
      const canProceed = canAdvanceFromStep(state.currentStep);
      btnNext.disabled = !canProceed;

      if (!canProceed && helperText) {
        helperText.textContent = 'Please acknowledge the requirements above to proceed.';
      } else if (helperText) {
        helperText.textContent = '';
      }
    }
  }
}

/**
 * Checks whether the user has fulfilled prerequisites for the current step.
 */
function canAdvanceFromStep(stepId: OnboardingStepId): boolean {
  switch (stepId) {
    case 'installation_guide':
      return true;
    case 'protection_scope':
      return state.acknowledgedScope;
    case 'browser_permissions':
      return state.acknowledgedPermissions;
    case 'staging_mode':
      return state.acknowledgedStaging;
    case 'trusted_approval':
      return state.acknowledgedApprovals;
    case 'protection_status':
      return true;
    case 'setup_complete':
      return state.isCompleted;
    default:
      return true;
  }
}

/**
 * Transitions to the designated step.
 */
async function goToStep(stepId: OnboardingStepId): Promise<void> {
  state = {
    ...state,
    currentStep: stepId,
  };
  await saveStoredOnboardingState(state);
  renderCurrentStep();
}

/**
 * Advances to the next step.
 */
async function handleNextStep(): Promise<void> {
  const stepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === state.currentStep);
  if (stepIndex < ONBOARDING_STEPS.length - 1) {
    state = advanceOnboardingStep(state, state.currentStep);
    await saveStoredOnboardingState(state);
    renderCurrentStep();
  }
}

/**
 * Returns to previous step.
 */
async function handleBackStep(): Promise<void> {
  const stepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === state.currentStep);
  if (stepIndex > 0) {
    const prevStep = ONBOARDING_STEPS[stepIndex - 1];
    await goToStep(prevStep.id);
  }
}

/**
 * Updates UI with protection status details.
 */
function updateStatusDisplay(report: ProtectionStatusReport): void {
  const envBadge = document.getElementById('sidebar-env-badge');
  const statusChipText = document.getElementById('sidebar-status-text');
  const titleDisplay = document.getElementById('status-title-display');
  const badgeDisplay = document.getElementById('status-badge-display');
  const descDisplay = document.getElementById('status-desc-display');

  if (envBadge) envBadge.textContent = report.environment.toUpperCase();
  if (statusChipText) statusChipText.textContent = `Status: ${report.statusTitle.split(' ')[0]}`;

  if (titleDisplay) titleDisplay.textContent = report.statusTitle;
  if (badgeDisplay) {
    badgeDisplay.textContent = report.status;
    badgeDisplay.className = `status-badge ${report.status === 'ACTIVE' ? 'badge-accent' : report.status === 'DEGRADED' ? 'badge-warn' : 'badge-neutral'}`;
  }
  if (descDisplay) descDisplay.textContent = report.statusDescription;

  // Config items
  const cfgEnv = document.getElementById('cfg-env');
  const cfgService = document.getElementById('cfg-service');
  const cfgEndpoint = document.getElementById('cfg-endpoint');
  const cfgHealth = document.getElementById('cfg-health');
  const cfgVersion = document.getElementById('cfg-version');
  const cfgRules = document.getElementById('cfg-rules');
  const mockBanner = document.getElementById('mock-warning-banner');

  if (cfgEnv) cfgEnv.textContent = report.environment;
  if (cfgService) cfgService.textContent = report.isMockService ? 'Mock (In-Memory)' : 'Live Backend';
  if (cfgEndpoint) cfgEndpoint.textContent = report.apiBaseUrl;
  if (cfgHealth) cfgHealth.textContent = report.policyHealth;
  if (cfgVersion) cfgVersion.textContent = `v${report.policyVersion}`;
  if (cfgRules) cfgRules.textContent = `${report.activeRulesCount} rules active`;

  if (mockBanner) {
    if (report.isMockService) {
      mockBanner.classList.remove('hidden');
    } else {
      mockBanner.classList.add('hidden');
    }
  }

  // Update diagnostic checklist
  const diagStorage = document.getElementById('diag-storage');
  const diagPolicy = document.getElementById('diag-policy');
  const diagHttps = document.getElementById('diag-https');

  if (diagStorage) {
    const icon = diagStorage.querySelector('.diag-status-icon');
    if (icon) icon.textContent = report.diagnostics.isStorageFunctional ? '✓' : '✕';
  }
  if (diagPolicy) {
    const icon = diagPolicy.querySelector('.diag-status-icon');
    if (icon) icon.textContent = report.diagnostics.isPolicyConfigValid ? '✓' : '✕';
  }
  if (diagHttps) {
    const icon = diagHttps.querySelector('.diag-status-icon');
    if (icon) icon.textContent = report.diagnostics.isHttpsEnforced ? '✓' : '✕';
  }
}

/**
 * Displays error or warning banner if setup diagnostics detect issues.
 */
function updateDiagnosticsBanner(): void {
  const banner = document.getElementById('diagnostic-banner');
  const title = document.getElementById('diagnostic-title');
  const message = document.getElementById('diagnostic-message');
  const actions = document.getElementById('diagnostic-actions');

  if (!banner || !statusReport) return;

  const { errors, warnings } = statusReport.diagnostics;

  if (errors.length > 0) {
    banner.className = 'diagnostic-banner error';
    banner.classList.remove('hidden');
    if (title) title.textContent = 'Configuration Error Detected';
    if (message) message.textContent = errors.join(' ');
    if (actions) {
      actions.innerHTML = `
        <button class="btn btn-secondary btn-sm" id="btn-fix-policy">Reset Default Policy</button>
      `;
      const btnFix = document.getElementById('btn-fix-policy');
      if (btnFix) {
        btnFix.addEventListener('click', async () => {
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            await chrome.storage.local.remove('guardrailPolicyConfig');
            statusReport = await refreshProtectionStatus();
            updateDiagnosticsBanner();
          }
        });
      }
    }
  } else if (warnings.length > 0) {
    banner.className = 'diagnostic-banner';
    banner.classList.remove('hidden');
    if (title) title.textContent = 'Operational Notice';
    if (message) message.textContent = warnings.join(' ');
    if (actions) actions.innerHTML = '';
  } else {
    banner.classList.add('hidden');
  }
}

/**
 * Attaches DOM event listeners.
 */
function setupEventListeners(): void {
  const btnNext = document.getElementById('btn-next');
  const btnBack = document.getElementById('btn-back');
  const btnRerunDiag = document.getElementById('btn-rerun-diag');
  const btnReviewAgain = document.getElementById('btn-review-again');

  if (btnNext) {
    btnNext.addEventListener('click', handleNextStep);
  }
  if (btnBack) {
    btnBack.addEventListener('click', handleBackStep);
  }
  if (btnRerunDiag) {
    btnRerunDiag.addEventListener('click', async () => {
      statusReport = await refreshProtectionStatus();
      updateDiagnosticsBanner();
    });
  }
  if (btnReviewAgain) {
    btnReviewAgain.addEventListener('click', async () => {
      await goToStep('installation_guide');
    });
  }

  // Checkbox listeners for step acknowledgement prerequisites
  const ackScope = document.getElementById('ack-scope') as HTMLInputElement | null;
  const ackPerm = document.getElementById('ack-permissions') as HTMLInputElement | null;
  const ackStaging = document.getElementById('ack-staging') as HTMLInputElement | null;
  const ackApprovals = document.getElementById('ack-approvals') as HTMLInputElement | null;

  if (ackScope) {
    ackScope.addEventListener('change', async () => {
      state = { ...state, acknowledgedScope: ackScope.checked };
      await saveStoredOnboardingState(state);
      updateNavigationButtons(1);
    });
  }

  if (ackPerm) {
    ackPerm.addEventListener('change', async () => {
      state = { ...state, acknowledgedPermissions: ackPerm.checked };
      await saveStoredOnboardingState(state);
      updateNavigationButtons(2);
    });
  }

  if (ackStaging) {
    ackStaging.addEventListener('change', async () => {
      state = { ...state, acknowledgedStaging: ackStaging.checked };
      await saveStoredOnboardingState(state);
      updateNavigationButtons(3);
    });
  }

  if (ackApprovals) {
    ackApprovals.addEventListener('change', async () => {
      state = { ...state, acknowledgedApprovals: ackApprovals.checked };
      await saveStoredOnboardingState(state);
      updateNavigationButtons(4);
    });
  }
}

// Auto-boot if running in browser window
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initializeOnboardingUI();
    });
  } else {
    void initializeOnboardingUI();
  }
}
