/**
 * Guardrail Trusted-Contact Dashboard - Caretaker Auth & Identity Modal
 *
 * Implements production-ready authentication management:
 * 1. Real-time token verification via /api/v1/auth/me
 * 2. Zero-friction development profile switcher (test-contact-token, test-ward-token)
 * 3. Custom Bearer JWT token inspection and storage
 * 4. Clean sign-out and session revocation
 * 5. Minimal, editorial typography adhering strictly to the Warm Linen and Deep Forest design language.
 */

import { TrustedContactProfile } from '../types.js';
import { createIcon } from './icons.js';

export interface AuthModalProps {
  readonly profile: TrustedContactProfile | null;
  readonly apiBaseUrl?: string;
  readonly onAuthSuccess: (token: string, profile: TrustedContactProfile) => void;
  readonly onSignOut: () => void;
  readonly onClose: () => void;
}

interface AuthConfigResponse {
  environment: string;
  oidcConfigured: boolean;
  issuer: string | null;
  audience: string | null;
  clientId: string | null;
  authUrl: string | null;
  tokenUrl: string | null;
  devTokensAvailable: boolean;
}

interface AuthMeResponse {
  actorId: string;
  role: string;
  isAuthenticated: boolean;
  email: string | null;
  environment: string;
}

export function renderAuthModal(props: AuthModalProps): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'gd-modal-backdrop gd-auth-modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'gd-auth-modal-title');

  const modal = document.createElement('div');
  modal.className = 'gd-auth-modal-card';

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'gd-auth-modal-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'gd-auth-modal-title-group';

  const title = document.createElement('h2');
  title.id = 'gd-auth-modal-title';
  title.className = 'gd-auth-modal-title';
  title.textContent = 'Authentication';

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-auth-modal-subtitle';
  subtitle.textContent = 'Manage identity session and trusted contact access.';

  titleGroup.appendChild(title);
  titleGroup.appendChild(subtitle);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-auth-modal-close-btn';
  closeBtn.setAttribute('aria-label', 'Close dialog');
  closeBtn.appendChild(createIcon('x'));
  closeBtn.addEventListener('click', () => {
    cleanup();
    props.onClose();
  });

  header.appendChild(titleGroup);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // --- Body ---
  const body = document.createElement('div');
  body.className = 'gd-auth-modal-body';

  // 1. Active Session
  const sessionSection = document.createElement('div');
  sessionSection.className = 'gd-auth-session-section';

  const sessionRow = document.createElement('div');
  sessionRow.className = 'gd-auth-session-row';

  const sessionDetails = document.createElement('div');
  sessionDetails.className = 'gd-auth-session-details';

  const sessionLabel = document.createElement('span');
  sessionLabel.className = 'gd-auth-eyebrow';
  sessionLabel.textContent = 'Active session';

  const sessionName = document.createElement('div');
  sessionName.className = 'gd-auth-session-name';
  sessionName.textContent = props.profile?.isAuthenticated
    ? (props.profile.email || props.profile.actorId)
    : 'Not authenticated';

  const sessionSub = document.createElement('div');
  sessionSub.className = 'gd-auth-session-sub';
  if (props.profile?.isAuthenticated) {
    const roleText = props.profile.relationshipLabel || (props.profile.role === 'TRUSTED_CONTACT' ? 'Designated Caretaker' : props.profile.role);
    sessionSub.textContent = `${roleText} · Local environment`;
  } else {
    sessionSub.textContent = 'Guest mode · Actions require authentication';
  }

  sessionDetails.appendChild(sessionLabel);
  sessionDetails.appendChild(sessionName);
  sessionDetails.appendChild(sessionSub);
  sessionRow.appendChild(sessionDetails);

  if (props.profile?.isAuthenticated) {
    const signOutBtn = document.createElement('button');
    signOutBtn.type = 'button';
    signOutBtn.className = 'gd-auth-signout-link';
    signOutBtn.textContent = 'Sign out';
    signOutBtn.addEventListener('click', () => {
      cleanup();
      props.onSignOut();
      props.onClose();
    });
    sessionRow.appendChild(signOutBtn);
  }

  sessionSection.appendChild(sessionRow);
  body.appendChild(sessionSection);

  // Divider
  const divider1 = document.createElement('hr');
  divider1.className = 'gd-auth-divider';
  body.appendChild(divider1);

  // 2. Error message banner (initially hidden)
  const errorBanner = document.createElement('div');
  errorBanner.className = 'gd-auth-error-banner';
  errorBanner.style.display = 'none';
  body.appendChild(errorBanner);

  // 3. Provider Discovery (OIDC / SSO if configured)
  const providerContent = document.createElement('div');
  providerContent.className = 'gd-auth-provider-content';
  body.appendChild(providerContent);

  // 4. Quick Development Switcher
  const devSection = document.createElement('div');
  devSection.className = 'gd-auth-section';

  const devHeader = document.createElement('div');
  devHeader.className = 'gd-auth-section-header';

  const devTitle = document.createElement('span');
  devTitle.className = 'gd-auth-section-title';
  devTitle.textContent = 'Switch profile';

  const devHint = document.createElement('span');
  devHint.className = 'gd-auth-section-hint';
  devHint.textContent = 'Development shortcuts';

  devHeader.appendChild(devTitle);
  devHeader.appendChild(devHint);
  devSection.appendChild(devHeader);

  const devButtonsContainer = document.createElement('div');
  devButtonsContainer.className = 'gd-auth-dev-buttons';

  const isCarol = props.profile?.actorId === 'tc_carol' && props.profile?.isAuthenticated;
  const isAlice = props.profile?.actorId === 'test-ward' && props.profile?.isAuthenticated;

  // Caretaker button
  const caretakerBtn = document.createElement('button');
  caretakerBtn.type = 'button';
  caretakerBtn.className = `gd-auth-chip ${isCarol ? 'selected' : ''}`;
  caretakerBtn.textContent = 'Carol (Caretaker)';
  caretakerBtn.addEventListener('click', () => {
    void verifyAndApplyToken('test-contact-token');
  });
  devButtonsContainer.appendChild(caretakerBtn);

  // Ward user button
  const wardBtn = document.createElement('button');
  wardBtn.type = 'button';
  wardBtn.className = `gd-auth-chip ${isAlice ? 'selected' : ''}`;
  wardBtn.textContent = 'Alice (Ward)';
  wardBtn.addEventListener('click', () => {
    void verifyAndApplyToken('test-ward-token');
  });
  devButtonsContainer.appendChild(wardBtn);

  devSection.appendChild(devButtonsContainer);
  body.appendChild(devSection);

  // Divider
  const divider2 = document.createElement('hr');
  divider2.className = 'gd-auth-divider';
  body.appendChild(divider2);

  // 5. Custom Bearer Token Input
  const tokenSection = document.createElement('div');
  tokenSection.className = 'gd-auth-section';

  const tokenHeader = document.createElement('div');
  tokenHeader.className = 'gd-auth-section-header';

  const tokenTitle = document.createElement('span');
  tokenTitle.className = 'gd-auth-section-title';
  tokenTitle.textContent = 'Bearer token';

  const tokenHint = document.createElement('span');
  tokenHint.className = 'gd-auth-section-hint';
  tokenHint.textContent = 'Manual JWT override';

  tokenHeader.appendChild(tokenTitle);
  tokenHeader.appendChild(tokenHint);
  tokenSection.appendChild(tokenHeader);

  const tokenInputRow = document.createElement('div');
  tokenInputRow.className = 'gd-auth-input-group';

  const tokenInput = document.createElement('input');
  tokenInput.type = 'text';
  tokenInput.className = 'gd-auth-input';
  tokenInput.placeholder = 'Paste JWT or authorization token...';
  tokenInput.autocomplete = 'off';
  tokenInput.spellcheck = false;

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'gd-auth-btn-apply';
  applyBtn.textContent = 'Apply';
  applyBtn.addEventListener('click', () => {
    const rawVal = tokenInput.value.trim();
    if (!rawVal) {
      showError('Please enter a valid authentication token.');
      return;
    }
    const cleanToken = rawVal.startsWith('Bearer ') ? rawVal.slice(7).trim() : rawVal;
    void verifyAndApplyToken(cleanToken);
  });

  tokenInputRow.appendChild(tokenInput);
  tokenInputRow.appendChild(applyBtn);
  tokenSection.appendChild(tokenInputRow);
  body.appendChild(tokenSection);

  modal.appendChild(body);

  // --- Footer ---
  const footer = document.createElement('div');
  footer.className = 'gd-auth-modal-footer';

  const closeFooterBtn = document.createElement('button');
  closeFooterBtn.type = 'button';
  closeFooterBtn.className = 'gd-auth-btn-close';
  closeFooterBtn.textContent = 'Done';
  closeFooterBtn.addEventListener('click', () => {
    cleanup();
    props.onClose();
  });
  footer.appendChild(closeFooterBtn);
  modal.appendChild(footer);

  backdrop.appendChild(modal);

  // --- Helper Functions ---
  function showError(msg: string): void {
    errorBanner.textContent = msg;
    errorBanner.style.display = 'block';
  }

  function hideError(): void {
    errorBanner.textContent = '';
    errorBanner.style.display = 'none';
  }

  async function verifyAndApplyToken(token: string): Promise<void> {
    hideError();
    applyBtn.disabled = true;
    applyBtn.textContent = 'Verifying...';

    const baseUrl =
      props.apiBaseUrl ||
      (typeof window !== 'undefined' && window.location.port !== '5173'
        ? window.location.origin
        : 'http://127.0.0.1:3000');
    try {
      const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      const body = (await res.json()) as { success: boolean; data?: AuthMeResponse; error?: { message: string } };
      if (!res.ok || !body.success || !body.data) {
        showError(body.error?.message || `Server rejected token (HTTP ${res.status}).`);
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply';
        return;
      }

      const verifiedProfile: TrustedContactProfile = {
        actorId: body.data.actorId,
        role: body.data.role,
        email: body.data.email ?? undefined,
        isAuthenticated: true,
        relationshipLabel: body.data.role === 'TRUSTED_CONTACT' ? 'Designated Caretaker' : 'User',
      };

      cleanup();
      props.onAuthSuccess(token, verifiedProfile);
      props.onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Network error communicating with authentication service.');
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply';
    }
  }

  // Fetch auth config on mount
  const baseUrl =
    props.apiBaseUrl ||
    (typeof window !== 'undefined' && window.location.port !== '5173'
      ? window.location.origin
      : 'http://127.0.0.1:3000');
  fetch(`${baseUrl}/api/v1/auth/config`)
    .then((r) => r.json())
    .then((data: { success: boolean; data?: AuthConfigResponse }) => {
      if (data.success && data.data) {
        const config = data.data;
        providerContent.innerHTML = '';
        if (config.oidcConfigured && config.authUrl) {
          const ssoBtn = document.createElement('button');
          ssoBtn.type = 'button';
          ssoBtn.className = 'gd-auth-chip full-width';
          ssoBtn.textContent = `Sign in with ${config.issuer ? new URL(config.issuer).hostname : 'Identity Provider'}`;
          ssoBtn.addEventListener('click', () => {
            const redirectUri = typeof window !== 'undefined' ? window.location.origin : '';
            const targetUrl = new URL(config.authUrl!);
            targetUrl.searchParams.set('client_id', config.clientId || '');
            targetUrl.searchParams.set('redirect_uri', redirectUri);
            targetUrl.searchParams.set('response_type', 'code');
            targetUrl.searchParams.set('scope', 'openid email profile');
            targetUrl.searchParams.set('state', Math.random().toString(36).substring(2));
            if (typeof window !== 'undefined') {
              window.location.href = targetUrl.toString();
            }
          });
          providerContent.appendChild(ssoBtn);
        }
      }
    })
    .catch(() => {
      // Keep quiet in dev
      providerContent.innerHTML = '';
    });

  // Keyboard accessibility
  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      cleanup();
      props.onClose();
    }
  }
  document.addEventListener('keydown', handleKeyDown);

  function cleanup(): void {
    document.removeEventListener('keydown', handleKeyDown);
  }

  // Click outside to close
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      cleanup();
      props.onClose();
    }
  });

  return backdrop;
}
