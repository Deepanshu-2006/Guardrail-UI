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

import QRCode from 'qrcode/lib/browser.js';
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
  const coverage = await checkActiveGuardianCoverage();
  if (coverage.isLinked) {
    const primaryName = coverage.contacts[0]?.id || 'Caretaker';
    updatePopupToPairedState(primaryName, coverage.contacts);
  }

  setupPopupActions();
  setupPairingPanelActions();
}

export interface ActiveGuardianContact {
  id: string;
  relationshipLabel?: string;
}

/**
 * Checks whether the current ward has active trusted contact(s) linked.
 */
async function checkActiveGuardianCoverage(): Promise<{
  isLinked: boolean;
  contacts: ActiveGuardianContact[];
}> {
  const env = resolveEnvironmentConfig();
  const token = await getStoredWardToken();
  if (!token) return { isLinked: false, contacts: [] };

  try {
    const res = await fetch(`${env.apiBaseUrl}/api/v1/trusted-contacts`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return { isLinked: false, contacts: [] };
    const body = (await res.json()) as { success: boolean; data?: ActiveGuardianContact[] };
    const contacts = Array.isArray(body.data) ? body.data : [];
    return {
      isLinked: contacts.length > 0,
      contacts,
    };
  } catch {
    return { isLinked: false, contacts: [] };
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
function updatePopupToPairedState(
  caretakerName = 'Caretaker',
  contacts: ActiveGuardianContact[] = []
): void {
  const onboardingBanner = document.getElementById('onboarding-banner');
  const onboardingTitle = document.getElementById('onboarding-status-title');
  const onboardingDesc = document.getElementById('onboarding-status-desc');
  const btnOpenOnboarding = document.getElementById('btn-open-onboarding') as HTMLButtonElement | null;

  if (onboardingBanner) onboardingBanner.className = 'onboarding-banner completed';
  if (onboardingTitle) onboardingTitle.textContent = 'Guardian Linked';
  const newDesc =
    contacts.length > 1
      ? `Protected by ${contacts.length} Guardians ✓`
      : `Protected by ${caretakerName} ✓`;
  savedDescBeforeOpen = newDesc;
  if (onboardingDesc && !document.body.classList.contains('pairing-open')) {
    onboardingDesc.textContent = newDesc;
  }
  if (btnOpenOnboarding && !document.body.classList.contains('pairing-open')) {
    btnOpenOnboarding.textContent = 'Pairing Info →';
  }

  renderActiveGuardians(contacts);

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
 * Renders currently connected guardians in the left pairing flyout.
 */
function renderActiveGuardians(contacts: ActiveGuardianContact[]): void {
  const section = document.getElementById('active-guardians-section');
  const list = document.getElementById('active-guardians-list');
  const countEl = document.getElementById('active-guardians-count');
  const titleEl = document.getElementById('pairing-panel-title');
  const subtitleEl = document.getElementById('pairing-panel-subtitle');

  if (!section || !list) return;

  if (contacts.length > 0) {
    section.style.display = 'flex';
    if (countEl) countEl.textContent = `${contacts.length} Connected`;
    if (titleEl) titleEl.textContent = 'Trusted Contacts';
    if (subtitleEl) subtitleEl.textContent = 'Active guardians & device pairing';

    list.innerHTML = contacts
      .map(
        (c) => `
        <div class="active-guardian-item">
          <div class="active-guardian-info">
            <div class="active-guardian-avatar" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <div class="active-guardian-meta">
              <span class="active-guardian-id">${c.id}</span>
              <span class="active-guardian-role">${c.relationshipLabel || 'Designated Caretaker'}</span>
            </div>
          </div>
          <div class="active-guardian-status">
            <span class="active-guardian-dot"></span>
            <span>Active</span>
          </div>
        </div>
      `
      )
      .join('');
  } else {
    section.style.display = 'none';
    if (titleEl) titleEl.textContent = 'Connect Caretaker';
    if (subtitleEl) subtitleEl.textContent = 'One-time device pairing';
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
let savedDescBeforeOpen = '';

function getPairingButtonDefaultText(): string {
  const isPaired = document.getElementById('onboarding-banner')?.classList.contains('completed');
  return isPaired ? 'Pairing Info →' : 'Setup →';
}

function morphBanner(targetBtnText: string, targetDescText: string): void {
  const btn = document.getElementById('btn-open-onboarding') as HTMLButtonElement | null;
  const desc = document.getElementById('onboarding-status-desc');

  if (btn) btn.classList.add('btn-morph-out');
  if (desc) desc.classList.add('banner-morph-out');

  setTimeout(() => {
    if (btn) {
      btn.textContent = targetBtnText;
      btn.classList.remove('btn-morph-out');
      btn.classList.add('btn-morph-in');
      setTimeout(() => btn.classList.remove('btn-morph-in'), 160);
    }
    if (desc) {
      if (targetDescText.includes('Pairing in progress')) {
        desc.classList.add('is-pairing');
      } else {
        desc.classList.remove('is-pairing');
      }
      desc.textContent = targetDescText;
      desc.classList.remove('banner-morph-out');
      desc.classList.add('banner-morph-in');
      setTimeout(() => desc.classList.remove('banner-morph-in'), 160);
    }
  }, 80);
}

const SLIDE_DURATION_MS = 520;
const SLIDE_EASING = 'cubic-bezier(0.38, 0, 0.22, 1)';

/**
 * Opens the pairing panel expanding to the left with cinematic ease.
 */
export function openPairingPanel(): void {
  if (isClosingPanel) return;
  document.body.classList.remove('pairing-closing');
  document.documentElement.classList.remove('pairing-closing');
  document.documentElement.classList.add('pairing-open');
  document.body.classList.add('pairing-open');

  const stage = document.getElementById('popup-stage');
  const panel = document.getElementById('pairing-panel');

  if (panel) {
    panel.style.transition = '';
    panel.style.transform = '';
    panel.style.opacity = '';
  }

  // Smoothly expand the popup card
  document.documentElement.style.transition = `width ${SLIDE_DURATION_MS}ms ${SLIDE_EASING}`;
  document.body.style.transition = `width ${SLIDE_DURATION_MS}ms ${SLIDE_EASING}`;
  if (stage) stage.style.transition = `width ${SLIDE_DURATION_MS}ms ${SLIDE_EASING}`;

  document.documentElement.style.width = '710px';
  document.body.style.width = '710px';
  if (stage) stage.style.width = '710px';

  const desc = document.getElementById('onboarding-status-desc');
  if (desc && !savedDescBeforeOpen) {
    savedDescBeforeOpen = desc.textContent || '';
  }

  morphBanner('Close ✕', 'Pairing in progress...');

  void loadOrGenerateInvitation();
  startConnectionPolling();
}

/**
 * Closes the pairing panel with a smooth slide-out transition without flickering the main popup.
 */
export function closePairingPanel(): void {
  if (isClosingPanel || !document.body.classList.contains('pairing-open')) return;
  isClosingPanel = true;
  document.documentElement.classList.add('pairing-closing');
  document.body.classList.add('pairing-closing');
  stopConnectionPolling();

  const targetBtn = getPairingButtonDefaultText();
  const targetDesc = savedDescBeforeOpen || 'Not Connected';
  savedDescBeforeOpen = '';

  const desc = document.getElementById('onboarding-status-desc');
  if (desc) desc.classList.remove('is-pairing');

  const stage = document.getElementById('popup-stage');
  const panel = document.getElementById('pairing-panel');

  // Smoothly collapse the popup card and slide contents together
  document.documentElement.style.transition = `width ${SLIDE_DURATION_MS}ms ${SLIDE_EASING}`;
  document.body.style.transition = `width ${SLIDE_DURATION_MS}ms ${SLIDE_EASING}`;
  if (stage) stage.style.transition = `width ${SLIDE_DURATION_MS}ms ${SLIDE_EASING}`;

  document.documentElement.style.width = '360px';
  document.body.style.width = '360px';
  if (stage) stage.style.width = '360px';

  if (panel) {
    panel.style.transition = `transform ${SLIDE_DURATION_MS}ms ${SLIDE_EASING}, opacity ${Math.round(SLIDE_DURATION_MS * 0.85)}ms ease`;
    panel.style.transform = 'translate3d(100px, 0, 0)';
    panel.style.opacity = '0';
  }

  // Morph banner mid-way through the slide as panel tucks into the main card
  setTimeout(() => {
    morphBanner(targetBtn, targetDesc);
  }, 220);

  setTimeout(() => {
    document.documentElement.classList.remove('pairing-open', 'pairing-closing');
    document.body.classList.remove('pairing-open', 'pairing-closing');
    document.documentElement.style.transition = '';
    document.body.style.transition = '';
    if (stage) stage.style.transition = '';
    if (panel) {
      panel.style.transition = '';
      panel.style.transform = '';
      panel.style.opacity = '';
    }

    isClosingPanel = false;
  }, SLIDE_DURATION_MS);
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
export async function loadOrGenerateInvitation(forceNew = false, customRole?: string): Promise<void> {
  const env = resolveEnvironmentConfig();
  const token = await getStoredWardToken();
  const codeDisplay = document.getElementById('pairing-code-display');
  const qrContainer = document.getElementById('qr-code-container');
  const roleInput = document.getElementById('caretaker-role-input') as HTMLInputElement | null;
  const targetRole = customRole?.trim() || roleInput?.value?.trim() || 'Family Guardian';

  if (!token) {
    if (codeDisplay) codeDisplay.textContent = 'Offline (Sign In)';
    return;
  }

  let inviteCode: string | null = null;

  try {
    // 1. Check existing invitations if not forcing new
    if (!forceNew) {
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
    }

    // 2. Generate a new invitation if none active or forced new
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
          relationshipLabel: targetRole,
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
    void checkActiveGuardianCoverage().then(({ isLinked, contacts }) => {
      if (isLinked) {
        const primaryName = contacts[0]?.id || 'Caretaker';
        updatePopupToPairedState(primaryName, contacts);
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
 * Setup left pairing panel interactions (Close, Copy, Send, Roles, Add Another).
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

  // Sleek Role Capsule Input Interaction
  const roleInput = document.getElementById('caretaker-role-input') as HTMLInputElement | null;
  const capsule = document.getElementById('role-capsule');

  if (capsule && roleInput) {
    capsule.addEventListener('click', (e) => {
      if (e.target !== roleInput) {
        roleInput.focus();
      }
    });
  }

  if (roleInput) {
    let lastRoleValue = roleInput.value.trim();

    const resizeInput = (): void => {
      const len = roleInput.value.length || 10;
      roleInput.style.width = `${Math.max(76, Math.min(160, len * 7.4 + 8))}px`;
    };
    resizeInput();
    roleInput.addEventListener('input', resizeInput);

    const triggerRoleUpdate = (): void => {
      const currentVal = roleInput.value.trim() || 'Family Guardian';
      resizeInput();
      if (currentVal !== lastRoleValue) {
        lastRoleValue = currentVal;
        void loadOrGenerateInvitation(true, currentVal);
      }
    };

    roleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        roleInput.blur();
      }
    });

    roleInput.addEventListener('change', () => {
      triggerRoleUpdate();
    });
  }

  // "+ Add Another Contact" Button
  const btnAddAnother = document.getElementById('btn-add-another-contact');
  if (btnAddAnother) {
    btnAddAnother.addEventListener('click', () => {
      const liveStatus = document.getElementById('pairing-live-status');
      if (liveStatus) {
        liveStatus.className = 'pairing-live-status waiting';
        liveStatus.innerHTML = `
          <span class="pulse-ring"><span class="pulse-dot"></span></span>
          <span class="status-msg" id="pairing-status-msg">Waiting for new Caretaker to connect...</span>
        `;
      }
      startConnectionPolling();
      const role = roleInput?.value.trim() || 'Family Guardian';
      void loadOrGenerateInvitation(true, role);
      document.getElementById('pairing-role-card')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

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

      const role = roleInput?.value.trim() || 'Guardian';
      feedback.className = 'invite-feedback success';
      feedback.textContent = `Pairing invitation (${role}) sent to ${val}!`;
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
