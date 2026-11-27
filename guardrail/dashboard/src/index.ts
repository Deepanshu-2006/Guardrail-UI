/**
 * Guardrail Trusted-Contact Dashboard - Main Library Entry Point
 */

export * from './types.js';
export * from './shell.js';
export * from './components/navigation.js';
export * from './components/account.js';
export * from './components/auth-modal.js';
export * from './components/connect-modal.js';
export * from './components/overview.js';
export * from './components/pending.js';
export * from './components/history.js';
export * from './components/settings.js';
export * from './components/relationships.js';
export * from './services/clerk-service.js';
export * from '../../extension/src/settings/types.js';
export * from '../../extension/src/settings/controller.js';
export * from '../../extension/src/settings/component.js';

import { DashboardShell } from './shell.js';
import { DashboardShellOptions, TrustedContactProfile } from './types.js';
import { resolveEnvironmentConfig } from '../../extension/src/config/environment.js';
import { ApprovalApiClient, TokenProvider } from '../../extension/src/approval/client.js';
import { getClerk } from './services/clerk-service.js';
import { showConnectedModal, showConnectingModal } from './components/auth-modal.js';
import { formatWardDisplayName } from './components/overview.js';

/**
 * Convenience bootstrap function to mount the dashboard shell into the page.
 */
export function mountDashboardShell(options: DashboardShellOptions): DashboardShell {
  return new DashboardShell(options);
}

function resolveRuntimeEnvConfig() {
  const envConfig = resolveEnvironmentConfig();
  if (
    envConfig.environment === 'development' &&
    typeof window !== 'undefined' &&
    window.location?.hostname &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    window.location.hostname !== '::1'
  ) {
    try {
      const parsed = new URL(envConfig.apiBaseUrl);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        parsed.hostname = window.location.hostname;
        return { ...envConfig, apiBaseUrl: parsed.origin };
      }
    } catch {
      // Keep original apiBaseUrl on parse error
    }
  }
  return envConfig;
}

/** Mount a live dashboard using a host-provided, verified-identity token provider. */
export function mountAuthenticatedDashboardShell(
  options: Omit<DashboardShellOptions, 'apiClient' | 'isMockService'> & { readonly tokenProvider: TokenProvider }
): DashboardShell {
  const envConfig = resolveRuntimeEnvConfig();
  const apiClient = new ApprovalApiClient({
    baseUrl: envConfig.apiBaseUrl,
    environment: envConfig.environment,
    serviceType: 'live',
    tokenProvider: options.tokenProvider,
    timeoutMs: envConfig.timeoutMs,
  });
  return new DashboardShell({ ...options, apiClient, environment: envConfig.environment, isMockService: false });
}

declare global {
  interface Window {
    /** Supplied by the embedding identity-provider host; never compiled into this bundle. */
    __GUARDRAIL_AUTH_TOKEN_PROVIDER__?: TokenProvider;
  }
}

/**
 * Returns a human-friendly display name from an explicit name or an email address.
 */
export function formatDisplayName(name?: string | null, email?: string | null): string {
  if (name && name.trim()) return name.trim();
  if (email && email.trim()) {
    const localPart = email.split('@')[0];
    return localPart
      .split(/[._-]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
  return 'Designated Caretaker';
}

export function isDefaultAvatar(url?: string | null): boolean {
  if (!url) return true;
  return (
    url.includes('img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdC') ||
    url.includes('images.clerk.dev') ||
    url.includes('gravatar.com/avatar?d=mp') ||
    url.includes('d=mp')
  );
}

function parseJwtProfile(token: string, fallbackEmail?: string | null): TrustedContactProfile | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    const role = payload['https://guardrail.local/role'] || payload.role || 'TRUSTED_CONTACT';
    const actorId = payload.sub || 'tc_reviewer';
    const email =
      payload.email ||
      payload.email_address ||
      payload.primary_email_address ||
      payload.phone_number ||
      payload.preferred_username ||
      payload.name ||
      fallbackEmail ||
      undefined;

    let storedAvatar = typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_user_avatar') : null;
    if (storedAvatar && isDefaultAvatar(storedAvatar)) {
      localStorage.removeItem('guardrail_user_avatar');
      storedAvatar = null;
    }

    const rawAvatar =
      payload.picture ||
      payload.avatar_url ||
      payload.image_url ||
      payload.photo_url ||
      storedAvatar ||
      undefined;

    const storedName = typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_user_name') : null;
    const avatarUrl = rawAvatar && !isDefaultAvatar(rawAvatar) ? rawAvatar : undefined;
    const fullName = payload.name || payload.full_name || storedName || formatDisplayName(null, email);

    const storedWardId = typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_assigned_ward_id') || undefined : undefined;
    const storedWardName = typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_assigned_ward_name') || undefined : undefined;
    const storedWardEmail = typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_assigned_ward_email') || undefined : undefined;
    const effectiveWardName = storedWardName || (storedWardId ? formatWardDisplayName(undefined, storedWardId) : undefined);

    return {
      actorId,
      role,
      email,
      fullName,
      avatarUrl,
      imageUrl: avatarUrl,
      isAuthenticated: true,
      relationshipLabel: role === 'TRUSTED_CONTACT' ? 'Designated Caretaker' : 'User',
      assignedWardId: storedWardId,
      assignedWardName: effectiveWardName,
      assignedWardEmail: storedWardEmail,
    };
  } catch {
    return null;
  }
}

/**
 * Safely extracts authentication tokens passed back via OAuth 2.0 / OIDC redirects
 * in either URL hash fragments (#access_token=... / #id_token=...) or query parameters
 * (?token=... / ?id_token=... / ?session_token=...).
 *
 * Implements address bar sanitization to strip credentials from browser history immediately.
 */
export function extractOAuthRedirectToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let extracted: string | null = null;

    // 1. Inspect URL hash fragment (implicit flow / PKCE hash redirect)
    if (window.location.hash && window.location.hash.length > 1) {
      const hashClean = window.location.hash.replace(/^#\/?/, '');
      const hashParams = new URLSearchParams(hashClean);
      const token = hashParams.get('access_token') || hashParams.get('id_token') || hashParams.get('token');
      if (token && token.trim()) {
        extracted = token.trim();
      }
    }

    // 2. Inspect query parameters (?token=... or ?id_token=... or ?session_token=...)
    if (!extracted && window.location.search && window.location.search.length > 1) {
      const searchParams = new URLSearchParams(window.location.search);
      const token = searchParams.get('token') || searchParams.get('id_token') || searchParams.get('access_token') || searchParams.get('session_token');
      if (token && token.trim()) {
        extracted = token.trim();
      }
    }

    // 3. Immediately sanitize the browser address bar to prevent credential leakage in history/logs
    if (extracted && window.history && typeof window.history.replaceState === 'function') {
      const cleanPath = window.location.pathname || '/';
      window.history.replaceState({}, document.title, cleanPath);
    }

    return extracted;
  } catch {
    return null;
  }
}

// Auto-mount if running in standalone HTML document with #dashboard-app container
if (typeof document !== 'undefined') {
  const defaultMountPoint = document.getElementById('dashboard-app');
  if (defaultMountPoint) {
    const envConfig = resolveRuntimeEnvConfig();
    const globalProvider = (globalThis as typeof globalThis & { __GUARDRAIL_AUTH_TOKEN_PROVIDER__?: TokenProvider })
      .__GUARDRAIL_AUTH_TOKEN_PROVIDER__;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const isOAuthRedirect = Boolean(
      search.includes('rotating_token_nonce') ||
      search.includes('__clerk') ||
      hash.includes('__clerk') ||
      search.includes('status=') ||
      search.includes('__clerk_status') ||
      search.includes('__clerk_created_session') ||
      search.includes('__clerk_handshake')
    );

    const redirectToken = extractOAuthRedirectToken();
    if (redirectToken && typeof localStorage !== 'undefined') {
      localStorage.setItem('guardrail_auth_token', redirectToken);
    }
    const storageToken = redirectToken || (typeof localStorage !== 'undefined'
      ? localStorage.getItem('guardrail_auth_token')
      : null);
    const storedEmail = typeof localStorage !== 'undefined'
      ? localStorage.getItem('guardrail_user_email')
      : null;
    const storedName = typeof localStorage !== 'undefined'
      ? localStorage.getItem('guardrail_user_name')
      : null;
    const storedAvatar = typeof localStorage !== 'undefined'
      ? localStorage.getItem('guardrail_user_avatar')
      : null;
    const storedWardId = typeof localStorage !== 'undefined'
      ? localStorage.getItem('guardrail_assigned_ward_id') || undefined
      : undefined;
    const storedWardName = typeof localStorage !== 'undefined'
      ? localStorage.getItem('guardrail_assigned_ward_name') || undefined
      : undefined;
    const storedWardEmail = typeof localStorage !== 'undefined'
      ? localStorage.getItem('guardrail_assigned_ward_email') || undefined
      : undefined;
    const effectiveWardName = storedWardName || (storedWardId ? formatWardDisplayName(undefined, storedWardId) : undefined);

    if (storedWardId && effectiveWardName && typeof localStorage !== 'undefined' && !localStorage.getItem('guardrail_assigned_ward_name')) {
      localStorage.setItem('guardrail_assigned_ward_name', effectiveWardName);
    }

    let connectingMountedAt = 0;
    if (isOAuthRedirect) {
      // Present the animated connecting modal while OAuth callback resolves
      showConnectingModal();
      connectingMountedAt = Date.now();
    }

    const effectiveToken = storageToken || null;
    const tokenProvider: TokenProvider = globalProvider ?? (async () => {
      if (typeof window !== 'undefined' && (window as any).Clerk?.session?.getToken) {
        try {
          const liveToken = await (window as any).Clerk.session.getToken();
          if (liveToken) {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('guardrail_auth_token', liveToken);
            }
            return liveToken;
          }
        } catch {}
      }
      return (typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_auth_token') : null) || effectiveToken || '';
    });

    const parsedJwt = effectiveToken ? parseJwtProfile(effectiveToken, storedEmail) : null;
    const initialProfile: TrustedContactProfile | null = (isOAuthRedirect && !storedName && !storageToken)
      ? null
      : parsedJwt
      ? {
          ...parsedJwt,
          assignedWardId: storedWardId ?? parsedJwt.assignedWardId,
          assignedWardName: effectiveWardName ?? parsedJwt.assignedWardName,
          assignedWardEmail: storedWardEmail ?? parsedJwt.assignedWardEmail,
        }
      : effectiveToken
      ? (effectiveToken.startsWith('test-') ? {
          actorId: effectiveToken === 'test-ward-token' ? 'usr_deepanshukhatri20061972' : 'tc_carol',
          role: effectiveToken === 'test-ward-token' ? 'USER' : 'TRUSTED_CONTACT',
          email: storedEmail || (effectiveToken === 'test-ward-token' ? 'deepanshukhatri20061972@gmail.com' : 'carol.guardian@gmail.com'),
          fullName: effectiveToken === 'test-ward-token' ? 'Deepanshu Khatri' : (storedName || 'Carol Guardian'),
          avatarUrl: storedAvatar || undefined,
          imageUrl: storedAvatar || undefined,
          isAuthenticated: true,
          assignedWardId: storedWardId,
          assignedWardName: effectiveWardName,
          assignedWardEmail: storedWardEmail,
          relationshipLabel: effectiveToken === 'test-ward-token' ? 'Ward User' : 'Designated Caretaker',
        } : {
          actorId: 'tc_reviewer',
          role: 'TRUSTED_CONTACT',
          email: storedEmail || undefined,
          fullName: storedName || (storedEmail ? formatDisplayName(null, storedEmail) : 'Designated Caretaker'),
          avatarUrl: storedAvatar || undefined,
          imageUrl: storedAvatar || undefined,
          isAuthenticated: true,
          assignedWardId: storedWardId,
          assignedWardName: effectiveWardName,
          assignedWardEmail: storedWardEmail,
          relationshipLabel: 'Authorized Contact',
        })
      : null;
    const apiClient = tokenProvider ? new ApprovalApiClient({
      baseUrl: envConfig.apiBaseUrl,
      environment: envConfig.environment,
      serviceType: 'live',
      tokenProvider,
      timeoutMs: envConfig.timeoutMs,
      logger: {
        info: (msg: string, ctx?: Record<string, unknown>) => console.info('[Guardrail API]', msg, ctx ?? ''),
        warn: (msg: string, ctx?: Record<string, unknown>) => console.warn('[Guardrail API]', msg, ctx ?? ''),
        error: (msg: string, ctx?: Record<string, unknown>) => console.error('[Guardrail API]', msg, ctx ?? ''),
      },
    }) : undefined;
    const shell = new DashboardShell({
      container: defaultMountPoint,
      environment: envConfig.environment,
      isMockService: apiClient ? false : envConfig.serviceType === 'mock' || envConfig.serviceType === 'in_memory',
      initialProfile: initialProfile ?? undefined,
      ...(apiClient ? { apiClient } : {}),
    });
    (globalThis as unknown as { __GUARDRAIL_SHELL__?: DashboardShell }).__GUARDRAIL_SHELL__ = shell;

    // Verify token with backend asynchronously to hydrate authoritative identity
    if (storageToken) {
      fetch(`${envConfig.apiBaseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${storageToken}` },
      })
        .then((res) => res.json())
        .then((payload: { success: boolean; data?: { actorId: string; role: string; email: string | null; fullName?: string; imageUrl?: string | null } }) => {
          if (payload.success && payload.data) {
            const currentEmail = payload.data.email || storedEmail || undefined;
            const authoritativeName = payload.data.fullName || storedName;
            const currentName =
              (authoritativeName && !authoritativeName.toLowerCase().includes('designated caretaker') && !authoritativeName.toLowerCase().includes('authorized contact'))
                ? authoritativeName
                : (currentEmail ? formatDisplayName(null, currentEmail) : 'Designated Caretaker');
            const currentAvatar = payload.data.imageUrl || storedAvatar || undefined;
            if (typeof localStorage !== 'undefined') {
              if (currentEmail) localStorage.setItem('guardrail_user_email', currentEmail);
              if (currentName && !currentName.toLowerCase().includes('designated caretaker') && !currentName.toLowerCase().includes('authorized contact')) {
                localStorage.setItem('guardrail_user_name', currentName);
              }
              if (currentAvatar) localStorage.setItem('guardrail_user_avatar', currentAvatar);
            }
            const rawWardId = (payload.data as any)?.assignedWardId;
            const rawWardName = (payload.data as any)?.assignedWardName;
            const rawWardEmail = (payload.data as any)?.assignedWardEmail;
            const rawAssignedWards = (payload.data as any)?.assignedWards;
            if (rawWardId && typeof localStorage !== 'undefined') {
              localStorage.setItem('guardrail_assigned_ward_id', rawWardId);
              if (rawWardName) localStorage.setItem('guardrail_assigned_ward_name', rawWardName);
              if (rawWardEmail) localStorage.setItem('guardrail_assigned_ward_email', rawWardEmail);
            } else if (!rawWardId && typeof localStorage !== 'undefined') {
              localStorage.removeItem('guardrail_assigned_ward_id');
              localStorage.removeItem('guardrail_assigned_ward_name');
              localStorage.removeItem('guardrail_assigned_ward_email');
            }
            if (Array.isArray(rawAssignedWards) && rawAssignedWards.length > 0 && typeof localStorage !== 'undefined') {
              localStorage.setItem('guardrail_assigned_wards', JSON.stringify(rawAssignedWards));
            }
            shell.setProfile({
              actorId: payload.data.actorId,
              role: payload.data.role,
              email: currentEmail,
              fullName: currentName,
              avatarUrl: currentAvatar,
              imageUrl: currentAvatar,
              isAuthenticated: true,
              relationshipLabel: rawWardId ? (payload.data.role === 'TRUSTED_CONTACT' ? 'Designated Caretaker' : 'User') : undefined,
              assignedWardId: rawWardId || undefined,
              assignedWardName: rawWardName || undefined,
              assignedWardEmail: rawWardEmail || undefined,
              assignedWards: Array.isArray(rawAssignedWards) && rawAssignedWards.length > 0 ? rawAssignedWards : undefined,
            });
          }
        })
        .catch(() => {
          // Retain initial fallback profile if network is offline
        });
    }

    // Sync active Clerk session in real-time
    getClerk().then(async (clerk) => {
      if (!clerk) return;

      const search = typeof window !== 'undefined' ? window.location.search : '';
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      const isOAuthRedirect = Boolean(
        search.includes('rotating_token_nonce') ||
        search.includes('__clerk') ||
        hash.includes('__clerk') ||
        search.includes('status=') ||
        search.includes('__clerk_status') ||
        search.includes('__clerk_created_session') ||
        search.includes('__clerk_handshake') ||
        search.includes('__clerk_oauth_cb')
      );

      let wasAuthenticated = false;

      // Ensure an active session is selected if signedInSessions or sessions exists but clerk.session is not set
      const ensureActiveSession = async () => {
        if (!clerk.session) {
          const sessions =
            (clerk.client?.signedInSessions && clerk.client.signedInSessions.length > 0
              ? clerk.client.signedInSessions
              : null) ||
            (clerk.client?.sessions && clerk.client.sessions.length > 0
              ? clerk.client.sessions
              : null);
          if (sessions && sessions.length > 0) {
            const targetSession = clerk.client?.lastActiveSessionId
              ? sessions.find((s: any) => s.id === clerk.client?.lastActiveSessionId) || sessions[0]
              : sessions[0];
            if (targetSession && typeof clerk.setActive === 'function') {
              try {
                await clerk.setActive({ session: targetSession.id });
              } catch (actErr) {
                console.warn('[Clerk] setActive error:', actErr);
              }
            }
          }
        }
      };

      const syncClerkSession = async (showPopup: boolean = false) => {
        await ensureActiveSession();
        let activeSession = clerk.session || clerk.client?.signedInSessions?.[0] || clerk.client?.sessions?.[0];
        let activeUser = clerk.user || activeSession?.user;

        if (!activeSession) {
          if (wasAuthenticated) {
            wasAuthenticated = false;
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem('guardrail_auth_token');
              localStorage.removeItem('guardrail_user_email');
              localStorage.removeItem('guardrail_user_avatar');
            }
            shell.setProfile(null);
          }
          return;
        }

        try {
          const clerkToken =
            activeSession && typeof activeSession.getToken === 'function'
              ? await activeSession.getToken()
              : typeof localStorage !== 'undefined'
                ? localStorage.getItem('guardrail_auth_token') || ''
                : '';

          if (clerkToken && typeof localStorage !== 'undefined') {
            localStorage.setItem('guardrail_auth_token', clerkToken);
          }

          const userEmail =
            activeUser?.primaryEmailAddress?.emailAddress ||
            (Array.isArray(activeUser?.emailAddresses) && activeUser.emailAddresses[0]?.emailAddress) ||
            activeUser?.primaryPhoneNumber?.phoneNumber ||
            (Array.isArray(activeUser?.phoneNumbers) && activeUser.phoneNumbers[0]?.phoneNumber) ||
            activeUser?.username ||
            (typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_user_email') : null) ||
            '';

          if (userEmail && typeof localStorage !== 'undefined') {
            localStorage.setItem('guardrail_user_email', userEmail);
          }

          const actorId = activeUser?.id || activeSession?.id || 'tc_caretaker';
          let storedAvatar = typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_user_avatar') : null;
          if (storedAvatar && isDefaultAvatar(storedAvatar)) {
            localStorage.removeItem('guardrail_user_avatar');
            storedAvatar = null;
          }
          const rawClerkImg =
            activeUser?.imageUrl ||
            (activeUser as any)?.image_url ||
            activeUser?.externalAccounts?.[0]?.imageUrl ||
            activeUser?.externalAccounts?.[0]?.avatarUrl;
          const userAvatar = storedAvatar || (rawClerkImg && !isDefaultAvatar(rawClerkImg) ? rawClerkImg : undefined);
          if (userAvatar && typeof localStorage !== 'undefined') {
            localStorage.setItem('guardrail_user_avatar', userAvatar);
          }
          const storedName = typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_user_name') : null;
          const fullName =
            activeUser?.fullName ||
            (activeUser?.firstName ? `${activeUser.firstName} ${activeUser.lastName || ''}`.trim() : null) ||
            storedName ||
            formatDisplayName(null, userEmail);

          if (fullName && !fullName.toLowerCase().includes('designated caretaker') && !fullName.toLowerCase().includes('authorized contact') && typeof localStorage !== 'undefined') {
            localStorage.setItem('guardrail_user_name', fullName);
          }

          wasAuthenticated = true;

          const prevProfile = (typeof shell.getProfile === 'function' ? shell.getProfile() : shell.getState().contactProfile);
          const activeWardId = prevProfile?.assignedWardId ||
            (typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_assigned_ward_id') || undefined : undefined);
          const activeWardName = prevProfile?.assignedWardName ||
            (typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_assigned_ward_name') || undefined : undefined);
          const activeWardEmail = prevProfile?.assignedWardEmail ||
            (typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_assigned_ward_email') || undefined : undefined);
          let assignedWards = prevProfile?.assignedWards;
          if ((!assignedWards || assignedWards.length === 0) && typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem('guardrail_assigned_wards');
            if (stored) {
              try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) assignedWards = parsed;
              } catch {}
            }
          }
          if ((!assignedWards || assignedWards.length === 0) && activeWardId) {
            assignedWards = [{
              id: activeWardId,
              name: activeWardName || formatWardDisplayName(undefined, activeWardId),
              email: activeWardEmail,
              relationshipLabel: 'Protected Ward',
            }];
          }

          const verifiedProfile: TrustedContactProfile = {
            actorId,
            role: 'TRUSTED_CONTACT',
            email: userEmail || undefined,
            fullName,
            avatarUrl: userAvatar,
            imageUrl: userAvatar,
            isAuthenticated: true,
            assignedWardId: activeWardId,
            assignedWardName: activeWardName,
            assignedWardEmail: activeWardEmail,
            assignedWards: assignedWards && assignedWards.length > 0 ? assignedWards : undefined,
            relationshipLabel: 'Designated Caretaker',
          };

          // Ensure API client is instantiated and active on shell
          if (!shell.getApiClient()) {
            const newApiClient = new ApprovalApiClient({
              baseUrl: envConfig.apiBaseUrl,
              environment: envConfig.environment,
              serviceType: 'live',
              tokenProvider: async () => {
                if (typeof window !== 'undefined' && (window as any).Clerk?.session?.getToken) {
                  try {
                    const freshToken = await (window as any).Clerk.session.getToken();
                    if (freshToken) {
                      if (typeof localStorage !== 'undefined') {
                        localStorage.setItem('guardrail_auth_token', freshToken);
                      }
                      return freshToken;
                    }
                  } catch {}
                }
                return clerkToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_auth_token') || '' : '');
              },
              timeoutMs: envConfig.timeoutMs,
              logger: {
                info: (msg: string, ctx?: Record<string, unknown>) => console.info('[Guardrail API]', msg, ctx ?? ''),
                warn: (msg: string, ctx?: Record<string, unknown>) => console.warn('[Guardrail API]', msg, ctx ?? ''),
                error: (msg: string, ctx?: Record<string, unknown>) => console.error('[Guardrail API]', msg, ctx ?? ''),
              },
            });
            shell.setApiClient(newApiClient);
          }

          // Ensure the connecting spinner has had a comfortable duration (1.5s) to be clearly seen
          if (connectingMountedAt > 0) {
            const elapsed = Date.now() - connectingMountedAt;
            if (elapsed < 1500) {
              await new Promise((r) => setTimeout(r, 1500 - elapsed));
            }
          }

          // Immediately render authoritative Caretaker profile card in the sidebar
          shell.setProfile(verifiedProfile);

          const hasConnectingModal = typeof document !== 'undefined' && Boolean(document.getElementById('gd-auth-modal-root'));
          if (isOAuthRedirect || showPopup || hasConnectingModal) {
            showConnectedModal(verifiedProfile);
          } else {
            shell.closeAuthModal();
          }

          // Clean up address bar query params after successful redirect handling
          if (typeof window !== 'undefined' && (
            window.location.search.includes('rotating_token_nonce') ||
            window.location.search.includes('__clerk') ||
            window.location.search.includes('status=')
          )) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }

          // Authoritative backend verification via /api/v1/auth/me
          if (clerkToken) {
            fetch(`${envConfig.apiBaseUrl}/api/v1/auth/me`, {
              headers: { Authorization: `Bearer ${clerkToken}` },
            })
              .then((res) => res.json())
              .then((payload: { success: boolean; data?: { actorId: string; role: string; email: string | null; fullName?: string } }) => {
                if (payload.success && payload.data) {
                  const currentAvatar = (payload.data as any).imageUrl || userAvatar;
                  const currentEmail = payload.data.email || userEmail;
                  const authoritativeName =
                    (fullName && !fullName.toLowerCase().includes('designated caretaker') && !fullName.toLowerCase().includes('authorized contact'))
                      ? fullName
                      : (payload.data.fullName || fullName);
                  if (authoritativeName && typeof localStorage !== 'undefined') {
                    localStorage.setItem('guardrail_user_name', authoritativeName);
                  }
                  if (currentAvatar && typeof localStorage !== 'undefined') {
                    localStorage.setItem('guardrail_user_avatar', currentAvatar);
                  }
                  if (currentEmail && typeof localStorage !== 'undefined') {
                    localStorage.setItem('guardrail_user_email', currentEmail);
                  }
                  const assignedWards = Array.isArray((payload.data as any)?.assignedWards)
                    ? (payload.data as any).assignedWards
                    : undefined;
                  shell.setProfile({
                    actorId: payload.data.actorId,
                    role: payload.data.role,
                    email: currentEmail,
                    fullName: authoritativeName,
                    avatarUrl: currentAvatar,
                    imageUrl: currentAvatar,
                    isAuthenticated: true,
                    relationshipLabel: 'Designated Caretaker',
                    assignedWardId: (payload.data as any)?.assignedWardId || undefined,
                    assignedWardName: (payload.data as any)?.assignedWardName || undefined,
                    assignedWardEmail: (payload.data as any)?.assignedWardEmail || undefined,
                    assignedWards,
                  });
                  void shell.refresh();
                }
              })
              .catch(() => {});
          }
        } catch (err) {
          console.warn('[Clerk] Session sync error:', err);
        }
      };

      // 1. Real-time session listener (registered early to capture session emissions from redirect handling)
      if (typeof clerk.addListener === 'function') {
        clerk.addListener(async (emission: any) => {
          const hasSession = Boolean(
            emission?.session ||
            clerk.session ||
            (clerk.client?.signedInSessions && clerk.client.signedInSessions.length > 0) ||
            (clerk.client?.sessions && clerk.client.sessions.length > 0)
          );
          if (hasSession) {
            await syncClerkSession(false);
          } else if (!hasSession && wasAuthenticated) {
            wasAuthenticated = false;
            const current = typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_auth_token') : null;
            if (current && (current.startsWith('ey') || current.includes('.'))) {
              if (typeof localStorage !== 'undefined') {
                localStorage.removeItem('guardrail_auth_token');
                localStorage.removeItem('guardrail_user_email');
                localStorage.removeItem('guardrail_user_avatar');
              }
              shell.setProfile(null);
            }
          }
        });
      }

      // 2. Process OAuth redirect callback if returning from Google / Apple
      if (isOAuthRedirect) {
        try {
          if (typeof clerk.handleRedirectCallback === 'function') {
            await clerk.handleRedirectCallback(
              {
                redirectUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
                afterSignInUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
                afterSignUpUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
              },
              async (to: string) => {
                // Intercept navigation to prevent Clerk from navigating away to external accounts.dev signInUrl!
                if (typeof window !== 'undefined' && to && !to.includes('accounts.dev')) {
                  window.history.replaceState({}, document.title, window.location.pathname);
                }
              }
            ).catch((err) => console.warn('[Clerk] handleRedirectCallback:', err));
          } else {
            const nonce = typeof window !== 'undefined' ? new URLSearchParams(search).get('rotating_token_nonce') : null;
            if (nonce && clerk.client && typeof (clerk.client as any).reload === 'function') {
              await (clerk.client as any).reload({ rotatingTokenNonce: nonce }).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('[Clerk] OAuth redirect handling error:', e);
        }

        // Retry settling loop to ensure session is hydrated immediately after OAuth redirect without requiring page reload
        for (let attempt = 0; attempt < 8; attempt++) {
          await ensureActiveSession();
          const hasAnySession = Boolean(
            clerk.session ||
            (clerk.client?.signedInSessions && clerk.client.signedInSessions.length > 0) ||
            (clerk.client?.sessions && clerk.client.sessions.length > 0)
          );
          if (hasAnySession) {
            await syncClerkSession(false);
            if (shell.getState().contactProfile?.isAuthenticated) {
              break;
            }
          }
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      // 3. Initial session sync
      await ensureActiveSession();
      await syncClerkSession(false);

      // 4. Clean up any open modals and address bar query params
      const isAuthNow = Boolean(
        shell.getState().contactProfile?.isAuthenticated ||
        clerk.session ||
        (clerk.client?.signedInSessions && clerk.client.signedInSessions.length > 0) ||
        (clerk.client?.sessions && clerk.client.sessions.length > 0)
      );

      if (isAuthNow) {
        const hasConnectingModal = typeof document !== 'undefined' && Boolean(document.getElementById('gd-auth-modal-root'));
        if (!isOAuthRedirect && !hasConnectingModal) {
          shell.closeAuthModal();
        }
        if (typeof window !== 'undefined' && (
          window.location.search.includes('rotating_token_nonce') ||
          window.location.search.includes('__clerk') ||
          window.location.search.includes('status=')
        )) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } else if (!isOAuthRedirect) {
        const localTok = typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_auth_token') : null;
        if (!localTok) {
          shell.openAuthModal();
        }
      }
    }).catch((err) => {
      console.warn('[Clerk] Initialization error:', err);
    });
  }
}
