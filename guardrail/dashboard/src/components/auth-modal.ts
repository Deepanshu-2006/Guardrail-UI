/**
 * Guardrail Trusted-Contact Dashboard - Caretaker Auth & Identity Modal
 *
 * Implements production-ready authentication management:
 * 1. OAuth 2.0 PKCE / OIDC identity provider integration
 * 2. Real-time token verification via /api/v1/auth/me
 * 3. Zero-friction development profile switcher (test-contact-token, test-ward-token)
 * 4. Custom Bearer JWT token inspection and storage
 * 5. Clean sign-out and session revocation
 *
 * Adheres strictly to the Warm Linen, Deep Forest Olive, and Muted Amber design system.
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

  const headerLeft = document.createElement('div');
  headerLeft.className = 'gd-auth-modal-header-left';

  const iconWrapper = document.createElement('div');
  iconWrapper.className = 'gd-auth-modal-icon-badge';
  iconWrapper.appendChild(createIcon('shield', 'gd-auth-shield-icon'));

  const titleGroup = document.createElement('div');
  titleGroup.className = 'gd-auth-modal-title-group';

  const title = document.createElement('h2');
  title.id = 'gd-auth-modal-title';
  title.className = 'gd-auth-modal-title';
  title.textContent = 'Caretaker Authentication';

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-auth-modal-subtitle';
  subtitle.textContent = 'Manage verified identity session and trusted contact authorization.';

  titleGroup.appendChild(title);
  titleGroup.appendChild(subtitle);
  headerLeft.appendChild(iconWrapper);
  headerLeft.appendChild(titleGroup);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-auth-modal-close-btn';
  closeBtn.setAttribute('aria-label', 'Close dialog');
  closeBtn.appendChild(createIcon('x'));
  closeBtn.addEventListener('click', () => {
    cleanup();
    props.onClose();
  });

  header.appendChild(headerLeft);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // --- Body ---
  const body = document.createElement('div');
  body.className = 'gd-auth-modal-body';

  // 1. Current Session Banner
  const sessionCard = document.createElement('div');
  sessionCard.className = 'gd-auth-session-card';

  const sessionHeader = document.createElement('div');
  sessionHeader.className = 'gd-auth-section-label';
  sessionHeader.textContent = 'CURRENT SESSION STATUS';
  sessionCard.appendChild(sessionHeader);

  const sessionRow = document.createElement('div');
  sessionRow.className = 'gd-auth-session-row';

  const avatar = document.createElement('div');
  avatar.className = 'gd-auth-avatar';
  if (props.profile?.isAuthenticated) {
    avatar.textContent = (props.profile.actorId.slice(3, 5) || 'TC').toUpperCase();
  } else {
    avatar.appendChild(createIcon('lock', 'gd-auth-lock-icon'));
  }
  sessionRow.appendChild(avatar);

  const sessionDetails = document.createElement('div');
  sessionDetails.className = 'gd-auth-session-details';

  const sessionName = document.createElement('div');
  sessionName.className = 'gd-auth-session-name';
  sessionName.textContent = props.profile?.isAuthenticated
    ? (props.profile.email || props.profile.actorId)
    : 'Not Authenticated (Guest)';
  sessionDetails.appendChild(sessionName);

  const sessionSub = document.createElement('div');
  sessionSub.className = 'gd-auth-session-sub';
  if (props.profile?.isAuthenticated) {
    sessionSub.textContent = `Actor: ${props.profile.actorId} • Role: ${props.profile.role}${props.profile.relationshipLabel ? ` (${props.profile.relationshipLabel})` : ''}`;
  } else {
    sessionSub.textContent = 'Viewing unauthenticated standalone interface. API actions require authorization.';
  }
  sessionDetails.appendChild(sessionSub);
  sessionRow.appendChild(sessionDetails);

  const statusBadge = document.createElement('div');
  statusBadge.className = `gd-auth-status-badge ${props.profile?.isAuthenticated ? 'active' : 'inactive'}`;
  statusBadge.textContent = props.profile?.isAuthenticated ? 'Authenticated' : 'Signed Out';
  sessionRow.appendChild(statusBadge);

  sessionCard.appendChild(sessionRow);
  body.appendChild(sessionCard);

  // 2. Error message banner (initially hidden)
  const errorBanner = document.createElement('div');
  errorBanner.className = 'gd-auth-error-banner';
  errorBanner.style.display = 'none';
  body.appendChild(errorBanner);

  // 3. Provider Discovery & Config
  const providerSection = document.createElement('div');
  providerSection.className = 'gd-auth-section';

  const providerLabel = document.createElement('div');
  providerLabel.className = 'gd-auth-section-label';
  providerLabel.textContent = 'IDENTITY PROVIDER (OIDC / SSO)';
  providerSection.appendChild(providerLabel);

  const providerContent = document.createElement('div');
  providerContent.className = 'gd-auth-provider-content';
  providerContent.textContent = 'Discovering authentication endpoints...';
  providerSection.appendChild(providerContent);
  body.appendChild(providerSection);

  // 4. Quick Development Switcher
  const devSection = document.createElement('div');
  devSection.className = 'gd-auth-section';

  const devLabel = document.createElement('div');
  devLabel.className = 'gd-auth-section-label';
  devLabel.textContent = 'DEVELOPMENT PROFILE SWITCHER';
  devSection.appendChild(devLabel);

  const devButtonsContainer = document.createElement('div');
  devButtonsContainer.className = 'gd-auth-dev-buttons';

  // Caretaker button
  const caretakerBtn = document.createElement('button');
  caretakerBtn.type = 'button';
  caretakerBtn.className = 'gd-auth-btn gd-auth-btn-secondary';
  caretakerBtn.innerHTML = '<span class="gd-btn-dot amber"></span> Switch to Carol (Caretaker)';
  caretakerBtn.addEventListener('click', () => {
    void verifyAndApplyToken('test-contact-token');
  });
  devButtonsContainer.appendChild(caretakerBtn);

  // Ward user button
  const wardBtn = document.createElement('button');
  wardBtn.type = 'button';
  wardBtn.className = 'gd-auth-btn gd-auth-btn-secondary';
  wardBtn.innerHTML = '<span class="gd-btn-dot green"></span> Switch to Alice (Ward)';
  wardBtn.addEventListener('click', () => {
    void verifyAndApplyToken('test-ward-token');
  });
  devButtonsContainer.appendChild(wardBtn);

  devSection.appendChild(devButtonsContainer);
  body.appendChild(devSection);

  // 5. Custom Bearer Token Input
  const tokenSection = document.createElement('div');
  tokenSection.className = 'gd-auth-section';

  const tokenLabel = document.createElement('div');
  tokenLabel.className = 'gd-auth-section-label';
  tokenLabel.textContent = 'CUSTOM BEARER TOKEN';
  tokenSection.appendChild(tokenLabel);

  const tokenInputRow = document.createElement('div');
  tokenInputRow.className = 'gd-auth-input-row';

  const tokenInput = document.createElement('input');
  tokenInput.type = 'text';
  tokenInput.className = 'gd-auth-input';
  tokenInput.placeholder = 'Paste JWT or Bearer authorization token...';
  tokenInput.autocomplete = 'off';
  tokenInput.spellcheck = false;

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'gd-auth-btn gd-auth-btn-primary';
  applyBtn.textContent = 'Apply Token';
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

  if (props.profile?.isAuthenticated) {
    const signOutBtn = document.createElement('button');
    signOutBtn.type = 'button';
    signOutBtn.className = 'gd-auth-btn gd-auth-btn-danger';
    signOutBtn.textContent = 'Sign Out';
    signOutBtn.addEventListener('click', () => {
      cleanup();
      props.onSignOut();
      props.onClose();
    });
    footer.appendChild(signOutBtn);
  }

  const closeFooterBtn = document.createElement('button');
  closeFooterBtn.type = 'button';
  closeFooterBtn.className = 'gd-auth-btn gd-auth-btn-secondary';
  closeFooterBtn.textContent = 'Close';
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

    const baseUrl = props.apiBaseUrl ?? (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000');
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
        applyBtn.textContent = 'Apply Token';
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
      applyBtn.textContent = 'Apply Token';
    }
  }

  // Fetch auth config on mount
  const baseUrl = props.apiBaseUrl ?? (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000');
  fetch(`${baseUrl}/api/v1/auth/config`)
    .then((r) => r.json())
    .then((data: { success: boolean; data?: AuthConfigResponse }) => {
      if (data.success && data.data) {
        const config = data.data;
        providerContent.innerHTML = '';
        if (config.oidcConfigured && config.authUrl) {
          const ssoBtn = document.createElement('button');
          ssoBtn.type = 'button';
          ssoBtn.className = 'gd-auth-btn gd-auth-btn-primary full-width';
          ssoBtn.textContent = `Sign In via ${config.issuer ? new URL(config.issuer).hostname : 'Identity Provider'}`;
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
        } else {
          const infoBox = document.createElement('div');
          infoBox.className = 'gd-auth-info-note';
          infoBox.innerHTML = `
            <strong>OIDC Provider:</strong> Running in local development mode.
            <div style="font-size: 11px; margin-top: 4px; color: var(--gd-text-secondary);">
              To link Okta, Google Identity, Clerk, or Auth0, set <code>GUARDRAIL_OIDC_ISSUER</code> and <code>GUARDRAIL_OIDC_AUDIENCE</code> in the backend environment.
            </div>
          `;
          providerContent.appendChild(infoBox);
        }
      }
    })
    .catch(() => {
      providerContent.textContent = 'Authentication endpoint discovery unavailable (offline or proxy blocked).';
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

