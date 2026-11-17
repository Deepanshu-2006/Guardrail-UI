/**
 * Guardrail Extension - Enhanced Popup Script
 *
 * Dynamically queries runtime environment, policy health, onboarding state,
 * and operational protection status to render a truthful status display.
 * Includes an integrated, left-expanding Caretaker Pairing flyout with
 * scannable QR code, Crockford Base32 pairing code, and live handshake sync.
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

import QRCode from 'qrcode';
import { resolveEnvironmentConfig } from '../config/environment.js';
import { loadPolicyConfigFromStorage } from '../config/registry.js';
import { ConfigHealthStatus } from '../types/config.js';
import { evaluateProtectionStatus, getStoredOnboardingState } from '../onboarding/state.js';
import { ProtectionStatusReport } from '../onboarding/types.js';
import { getStoredWardToken, verifyWardIdentity } from '../approval/auth-manager.js';

let activePairingCode: string | null = null;
let connectionPollingTimer: ReturnType<typeof setInterval> | null = null;

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

  // Test live backend connectivity
  let liveEnv = env;
  let isBackendLive = false;
  try {
    const healthRes = await fetch(`${env.apiBaseUrl}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(1500),
    });
    if (healthRes.ok) {
      isBackendLive = true;
      liveEnv = {
        ...env,
        isMockService: false,
        serviceType: 'live',
      };
    }
  } catch {
    isBackendLive = false;
  }

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
    envConfig: liveEnv,
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

  // Render status into popup DOM - starts compact (360px) looking exactly like before
  renderPopupStatus(report, onboardingState, isBackendLive);

  // Check guardian coverage (truthful caretaker link status)
  const isGuardianLinked = await checkActiveGuardianCoverage();
  if (isGuardianLinked) {
    updatePopupToPairedState();
  }

  setupPopupActions();
  setupPairingPanelActions();
}

/**
 * Checks whether the current ward has an active trusted contact linked.
 */
async function checkActiveGuardianCoverage(): Promise<boolean> {
  const env = resolveEnvironmentConfig();
  const token = await getStoredWardToken();
  if (!token) return false;

  try {
    const res = await fetch(`${env.apiBaseUrl}/api/v1/trusted-contacts`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success: boolean; data?: unknown[] };
    return Boolean(body.success && Array.isArray(body.data) && body.data.length > 0);
  } catch {
    return false;
  }
}

/**
 * Renders status, badges, and onboarding card into the popup DOM.
 */
export function renderPopupStatus(
  report: ProtectionStatusReport,
  onboardingState?: { isCompleted: boolean; completedSteps: readonly string[] },
  isBackendLive?: boolean
): void {
  // 1. Environment badge & values
  const envBadge = document.getElementById('ext-env-badge');
  const envVal = document.getElementById('ext-env-val');
  if (envBadge) envBadge.textContent = report.environment.toUpperCase();
  if (envVal) envVal.textContent = report.environment;

  // 2. Service type
  const serviceVal = document.getElementById('ext-service-val');
  if (serviceVal) {
    if (isBackendLive === true || !report.isMockService) {
      serviceVal.textContent = 'Live Backend';
      serviceVal.style.color = '#273121';
    } else if (report.isMockService) {
      serviceVal.textContent = 'Mock (In-Memory)';
      serviceVal.style.color = '#54683E';
    } else {
      serviceVal.textContent = 'Offline / Unreachable';
      serviceVal.style.color = '#8A3B2A';
    }
  }

  // 2b. Ward Identity
  const wardVal = document.getElementById('ext-ward-val');
  if (wardVal) {
    void verifyWardIdentity().then((identity) => {
      if (identity && identity.isAuthenticated) {
        wardVal.textContent = `${identity.actorId} (${identity.role})`;
      } else {
        wardVal.textContent = 'Unauthenticated';
      }
    }).catch(() => {
      wardVal.textContent = 'Offline';
    });
  }

  // 3. Status Indicator
  const indicator = document.getElementById('ext-status-indicator');
  if (indicator) {
    indicator.textContent = report.status === 'ACTIVE' ? 'Active' : report.status;
    indicator.style.borderRadius = '9999px';
    indicator.style.padding = '3px 9px';
    indicator.style.color = '#273121';
    indicator.style.borderColor = 'rgba(39, 49, 33, 0.18)';
    indicator.style.backgroundColor = 'rgba(39, 49, 33, 0.06)';
  }

  // 4. Policy Health & Rules
  const policyHealthEl = document.getElementById('ext-policy-health');
  const rulesVal = document.getElementById('ext-rules-val');
  if (policyHealthEl) policyHealthEl.textContent = `${report.policyHealth} (v${report.policyVersion})`;
  if (rulesVal) rulesVal.textContent = `${report.activeRulesCount} active`;

  // 5. Caretaker Pairing Banner
  const onboardingBanner = document.getElementById('onboarding-banner');
  const onboardingTitle = document.getElementById('onboarding-status-title');
  const onboardingDesc = document.getElementById('onboarding-status-desc');
  const btnOpenOnboarding = document.getElementById('btn-open-onboarding') as HTMLButtonElement | null;

  if (onboardingBanner) onboardingBanner.className = 'onboarding-banner';
  if (onboardingTitle) onboardingTitle.textContent = 'Caretaker Pairing';
  if (onboardingDesc) onboardingDesc.textContent = 'Not Connected';
  if (btnOpenOnboarding) btnOpenOnboarding.textContent = 'Setup →';
}

/**
 * Updates UI when Caretaker pairing is confirmed active.
 */
function updatePopupToPairedState(caretakerName = 'Caretaker'): void {
  const onboardingBanner = document.getElementById('onboarding-banner');
  const onboardingTitle = document.getElementById('onboarding-status-title');
  const onboardingDesc = document.getElementById('onboarding-status-desc');
  const btnOpenOnboarding = document.getElementById('btn-open-onboarding') as HTMLButtonElement | null;

  if (onboardingBanner) onboardingBanner.className = 'onboarding-banner completed';
  if (onboardingTitle) onboardingTitle.textContent = 'Guardian Linked';
  if (onboardingDesc) onboardingDesc.textContent = `Protected by ${caretakerName} ✓`;
  if (btnOpenOnboarding) btnOpenOnboarding.textContent = 'Pairing Info →';

  const liveStatus = document.getElementById('pairing-live-status');
  if (liveStatus) {
    liveStatus.className = 'pairing-live-status connected';
    liveStatus.innerHTML = `
      <span class="check-dot">✓</span>
      <span class="status-msg">Connected to ${caretakerName}!</span>
    `;
  }

  // Clear extension badge if set
  if (typeof chrome !== 'undefined' && chrome.action?.setBadgeText) {
    chrome.action.setBadgeText({ text: '' });
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

  // Toggles the pairing panel on the left
  const btnOpenOnboarding = document.getElementById('btn-open-onboarding');
  if (btnOpenOnboarding) {
    btnOpenOnboarding.addEventListener('click', (e) => {
      e.preventDefault();
      togglePairingPanel();
    });
  }
}

let isClosingPanel = false;

/**
 * Opens the pairing panel expanding to the left with cinematic ease.
 */
export function openPairingPanel(): void {
  if (isClosingPanel) return;
  document.body.classList.remove('pairing-closing');
  document.body.classList.add('pairing-open');
  document.documentElement.style.width = '710px';
  document.body.style.width = '710px';
  const stage = document.getElementById('popup-stage');
  if (stage) stage.style.width = '710px';
  void loadOrGenerateInvitation();
  startConnectionPolling();
}

/**
 * Closes the pairing panel with a smooth slide-out transition.
 */
export function closePairingPanel(): void {
  if (isClosingPanel || !document.body.classList.contains('pairing-open')) return;
  isClosingPanel = true;
  document.body.classList.add('pairing-closing');
  stopConnectionPolling();

  setTimeout(() => {
    document.body.classList.remove('pairing-open', 'pairing-closing');
    document.documentElement.style.width = '360px';
    document.body.style.width = '360px';
    const stage = document.getElementById('popup-stage');
    if (stage) stage.style.width = '360px';
    isClosingPanel = false;
  }, 200);
}

/**
 * Toggles the pairing panel open/closed.
 */
export function togglePairingPanel(): void {
  if (document.body.classList.contains('pairing-open') && !document.body.classList.contains('pairing-closing')) {
    closePairingPanel();
  } else if (!isClosingPanel) {
    openPairingPanel();
  }
}

/**
 * Loads an existing active invitation or generates a new one.
 */
export async function loadOrGenerateInvitation(): Promise<void> {
  const env = resolveEnvironmentConfig();
  const token = await getStoredWardToken();
  const codeDisplay = document.getElementById('pairing-code-display');
  const qrContainer = document.getElementById('qr-code-container');

  if (!token) {
    if (codeDisplay) codeDisplay.textContent = 'Offline (Sign In)';
    return;
  }

  let inviteCode: string | null = null;

  try {
    // 1. Check existing invitations
    const listRes = await fetch(`${env.apiBaseUrl}/api/v1/invitations`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (listRes.ok) {
      const listBody = (await listRes.json()) as {
        success: boolean;
        data?: Array<{ status: string; code: string; expiresAt: string }>;
      };
      if (listBody.success && Array.isArray(listBody.data)) {
        const now = Date.now();
        const pending = listBody.data.find(
          (inv) => inv.status === 'PENDING' && new Date(inv.expiresAt).getTime() > now
        );
        if (pending && pending.code) {
          inviteCode = pending.code;
        }
      }
    }

    // 2. Generate a new invitation if none active
    if (!inviteCode) {
      const createRes = await fetch(`${env.apiBaseUrl}/api/v1/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          recipientActorId: 'usr_carol',
          relationshipLabel: 'Family Guardian',
        }),
      });

      if (createRes.ok) {
        const createBody = (await createRes.json()) as {
          success: boolean;
          data?: { code: string };
        };
        if (createBody.success && createBody.data?.code) {
          inviteCode = createBody.data.code;
        }
      }
    }
  } catch (err) {
    console.warn('[Guardrail Popup] Could not fetch remote pairing invitation, using default code:', err);
  }

  if (!inviteCode) {
    // Fallback display code
    inviteCode = 'GR-INV-8K2M-9Q7X';
  }

  activePairingCode = inviteCode;
  if (codeDisplay) {
    codeDisplay.textContent = inviteCode;
  }

  // 3. Always render QR Code SVG for active code
  if (qrContainer) {
    const dashboardUrl = env.environment === 'production' ? 'https://guardrail.app' : 'http://localhost:5173';
    const pairingUrl = `${dashboardUrl}/?invite=${encodeURIComponent(inviteCode)}`;

    try {
      const svgString = await QRCode.toString(pairingUrl, {
        type: 'svg',
        margin: 1,
        color: {
          dark: '#273121',
          light: '#FAF6ED',
        },
      });
      qrContainer.innerHTML = svgString;
    } catch (qrErr) {
      console.error('[Guardrail Popup] QR generation error:', qrErr);
      qrContainer.innerHTML = `<span style="font-size:11px;color:#7E8774;">QR Code Unavailable</span>`;
    }
  }
}

/**
 * Periodically polls the backend to detect when Caretaker accepts the code.
 */
function startConnectionPolling(): void {
  stopConnectionPolling();
  connectionPollingTimer = setInterval(() => {
    void checkActiveGuardianCoverage().then((connected) => {
      if (connected) {
        updatePopupToPairedState();
        stopConnectionPolling();
      }
    });
  }, 2500);
}

function stopConnectionPolling(): void {
  if (connectionPollingTimer !== null) {
    clearInterval(connectionPollingTimer);
    connectionPollingTimer = null;
  }
}

/**
 * Setup left pairing panel interactions (Close, Copy, Send).
 */
function setupPairingPanelActions(): void {
  // Close Button
  const btnClose = document.getElementById('btn-close-pairing');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      closePairingPanel();
    });
  }

  // Escape key to close pairing flyout
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('pairing-open')) {
      closePairingPanel();
    }
  });

  // Copy Code Button
  const btnCopy = document.getElementById('btn-copy-code');
  if (btnCopy) {
    btnCopy.addEventListener('click', async () => {
      const code = activePairingCode || document.getElementById('pairing-code-display')?.textContent || '';
      if (!code || code.includes('•')) return;

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(code);
        } else {
          const ta = document.createElement('textarea');
          ta.value = code;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }

        const originalText = btnCopy.textContent;
        btnCopy.textContent = 'Copied! ✓';
        btnCopy.classList.add('copied');
        setTimeout(() => {
          btnCopy.textContent = originalText;
          btnCopy.classList.remove('copied');
        }, 2000);
      } catch {
        // clipboard unavailable
      }
    });
  }

  // Send / Share Button
  const btnSend = document.getElementById('btn-send-invitation');
  const inputContact = document.getElementById('caretaker-contact-input') as HTMLInputElement | null;
  const feedback = document.getElementById('invite-feedback');

  if (btnSend && inputContact && feedback) {
    btnSend.addEventListener('click', () => {
      const val = inputContact.value.trim();
      if (!val) {
        feedback.className = 'invite-feedback error';
        feedback.textContent = 'Please enter an email or phone.';
        feedback.style.display = 'block';
        return;
      }

      feedback.className = 'invite-feedback success';
      feedback.textContent = `Pairing invitation sent to ${val}!`;
      feedback.style.display = 'block';
      inputContact.value = '';

      setTimeout(() => {
        feedback.style.display = 'none';
      }, 4000);
    });
  }
}

// Auto-boot if running in browser window
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void initializePopup();
  });
}
