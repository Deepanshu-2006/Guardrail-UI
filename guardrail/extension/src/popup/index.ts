/**
 * Guardrail Extension - Enhanced Popup Script
 *
 * Dynamically queries runtime environment, policy health, onboarding state,
 * and operational protection status to render a truthful status display.
 *
 * CRITICAL SAFETY INVARIANTS:
 * 1. TRUTHFUL PROTECTION STATUS:
 *    - Never implies that a user is protected when the extension or policy is inactive.
 *    - Strictly qualifies that protection applies ONLY to supported pilot test actions.
 * 2. MOCK SERVICE ADVISORY:
 *    - Explicitly surfaces in-memory or mock backend service types.
 * 3. ZERO SENSITIVE DATA EXPOSURE:
 *    - Never displays or queries authentication credentials or secrets.
 */

import { resolveEnvironmentConfig } from '../config/environment.js';
import { loadPolicyConfigFromStorage } from '../config/registry.js';
import { ConfigHealthStatus } from '../types/config.js';
import { evaluateProtectionStatus, getStoredOnboardingState } from '../onboarding/state.js';
import { ProtectionStatusReport } from '../onboarding/types.js';

export async function initializePopup(): Promise<void> {
  const manifest =
    typeof chrome !== 'undefined' && chrome.runtime?.getManifest
      ? chrome.runtime.getManifest()
      : { name: 'Guardrail', version: '0.1.0' };

  // Set version
  const versionElement = document.getElementById('ext-version');
  if (versionElement) {
    versionElement.textContent = manifest.version;
  }

  // Load environment config
  const env = resolveEnvironmentConfig();

  // Load policy configuration
  let policyConfig = null;
  let policyHealth = ConfigHealthStatus.UNINITIALIZED;
  let isStorageOk = true;

  try {
    const policyResult = await loadPolicyConfigFromStorage();
    policyConfig = policyResult.config;
    policyHealth = policyResult.healthStatus;
  } catch {
    isStorageOk = false;
  }

  // Evaluate live protection status report
  const report = evaluateProtectionStatus({
    envConfig: env,
    policyConfig,
    policyHealth,
    isServiceWorkerActive: true,
    isStorageFunctional: isStorageOk,
  });

  // Load onboarding state
  let onboardingState;
  try {
    onboardingState = await getStoredOnboardingState();
  } catch {
    // safe fallback
  }

  // Render status into popup DOM
  renderPopupStatus(report, onboardingState);
  setupPopupActions();
}

/**
 * Renders status, badges, and onboarding card into the popup DOM.
 */
export function renderPopupStatus(
  report: ProtectionStatusReport,
  onboardingState?: { isCompleted: boolean; completedSteps: readonly string[] }
): void {
  // 1. Environment badge & values
  const envBadge = document.getElementById('ext-env-badge');
  const envVal = document.getElementById('ext-env-val');
  if (envBadge) envBadge.textContent = report.environment.toUpperCase();
  if (envVal) envVal.textContent = report.environment;

  // 2. Service type
  const serviceVal = document.getElementById('ext-service-val');
  if (serviceVal) {
    serviceVal.textContent = report.isMockService ? 'Mock (In-Memory)' : 'Live Backend';
    if (report.isMockService) {
      serviceVal.style.color = '#B45309';
    }
  }

  // 3. Status Indicator & Card
  const indicator = document.getElementById('ext-status-indicator');
  const statusCard = document.getElementById('protection-status-card');
  const statusTitle = document.getElementById('ext-status-title');
  const statusExplanation = document.getElementById('ext-status-explanation');

  if (statusTitle) statusTitle.textContent = report.statusTitle;
  if (statusExplanation) {
    statusExplanation.textContent = report.status === 'DEGRADED'
      ? 'Operating on safety defaults for designated test actions.'
      : report.status === 'ACTIVE'
      ? 'Protecting designated pilot test actions.'
      : report.statusDescription;
  }

  if (indicator) {
    indicator.textContent = report.status === 'ACTIVE' ? 'Active' : report.status;
    indicator.style.borderRadius = '9999px';
    indicator.style.padding = '3px 10px';
    if (report.status === 'ACTIVE') {
      indicator.style.color = '#2E6F40';
      indicator.style.borderColor = 'rgba(46, 111, 64, 0.25)';
      indicator.style.backgroundColor = 'rgba(46, 111, 64, 0.08)';
    } else if (report.status === 'DEGRADED') {
      indicator.style.color = '#B45309';
      indicator.style.borderColor = 'rgba(180, 83, 9, 0.25)';
      indicator.style.backgroundColor = 'rgba(180, 83, 9, 0.08)';
    } else {
      indicator.style.color = '#C53030';
      indicator.style.borderColor = 'rgba(197, 48, 48, 0.25)';
      indicator.style.backgroundColor = 'rgba(197, 48, 48, 0.08)';
    }
  }

  if (statusCard) {
    if (report.status === 'DEGRADED') {
      statusCard.className = 'status-card warn';
    } else if (report.status === 'POLICY_ERROR' || report.status === 'INACTIVE') {
      statusCard.className = 'status-card error';
    } else {
      statusCard.className = 'status-card';
    }
  }

  // 4. Policy Health & Rules
  const policyHealthEl = document.getElementById('ext-policy-health');
  const rulesVal = document.getElementById('ext-rules-val');
  if (policyHealthEl) policyHealthEl.textContent = `${report.policyHealth} (v${report.policyVersion})`;
  if (rulesVal) rulesVal.textContent = `${report.activeRulesCount} active`;

  // 5. Onboarding Status Banner
  const onboardingBanner = document.getElementById('onboarding-banner');
  const onboardingTitle = document.getElementById('onboarding-status-title');
  const onboardingDesc = document.getElementById('onboarding-status-desc');
  const btnOpenOnboarding = document.getElementById('btn-open-onboarding') as HTMLButtonElement | null;

  if (onboardingState && onboardingState.isCompleted) {
    if (onboardingBanner) onboardingBanner.className = 'onboarding-banner completed';
    if (onboardingTitle) onboardingTitle.textContent = 'Pilot Setup';
    if (onboardingDesc) onboardingDesc.textContent = 'Complete ✓';
    if (btnOpenOnboarding) btnOpenOnboarding.textContent = 'Review →';
  } else {
    const count = onboardingState?.completedSteps.length ?? 0;
    if (onboardingBanner) onboardingBanner.className = 'onboarding-banner';
    if (onboardingTitle) onboardingTitle.textContent = 'Pilot Setup';
    if (onboardingDesc) onboardingDesc.textContent = `${count} of 7 steps`;
    if (btnOpenOnboarding) btnOpenOnboarding.textContent = 'Setup →';
  }
}

/**
 * Attaches popup action click listeners.
 */
function setupPopupActions(): void {
  const btnOpenSettings = document.getElementById('btn-open-settings');
  if (btnOpenSettings) {
    btnOpenSettings.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        const url =
          typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL('settings/settings.html')
            : 'settings/settings.html';
        if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
          chrome.tabs.create({ url });
        } else {
          window.open(url, '_blank');
        }
      }
    });
  }

  const btnOpenOnboarding = document.getElementById('btn-open-onboarding');
  if (btnOpenOnboarding) {
    btnOpenOnboarding.addEventListener('click', () => {
      const url =
        typeof chrome !== 'undefined' && chrome.runtime?.getURL
          ? chrome.runtime.getURL('onboarding/onboarding.html')
          : 'onboarding/onboarding.html';

      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, '_blank');
      }
    });
  }
}

// Auto-boot if running in browser window
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void initializePopup();
  });
}
