/**
 * Guardrail Trusted-Contact Dashboard - Main Library Entry Point
 */

export * from './types.js';
export * from './shell.js';
export * from './components/navigation.js';
export * from './components/account.js';
export * from './components/auth-modal.js';
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

/**
 * Convenience bootstrap function to mount the dashboard shell into the page.
 */
export function mountDashboardShell(options: DashboardShellOptions): DashboardShell {
  return new DashboardShell(options);
}

/** Mount a live dashboard using a host-provided, verified-identity token provider. */
export function mountAuthenticatedDashboardShell(
  options: Omit<DashboardShellOptions, 'apiClient' | 'isMockService'> & { readonly tokenProvider: TokenProvider }
): DashboardShell {
  const envConfig = resolveEnvironmentConfig();
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
      (actorId.includes('3MGvG7Te') ? 'deepanshukhatri20061972@gmail.com' : undefined);
    
    const isDefaultAvatar = (url?: string | null): boolean => {
      if (!url) return true;
      return (
        url.includes('img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdC') ||
        url.includes('images.clerk.dev') ||
        url.includes('gravatar.com/avatar?d=mp') ||
        url.includes('d=mp')
      );
    };

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

    const avatarUrl = rawAvatar && !isDefaultAvatar(rawAvatar) ? rawAvatar : undefined;
    const fullName = payload.name || payload.full_name || 'Deepanshu Khatri';
    return {
      actorId,
      role,
      email,
      fullName,
      avatarUrl,
      imageUrl: avatarUrl,
      isAuthenticated: true,
      relationshipLabel: role === 'TRUSTED_CONTACT' ? 'Designated Caretaker' : 'User',
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
    const envConfig = resolveEnvironmentConfig();
    const globalProvider = (globalThis as typeof globalThis & { __GUARDRAIL_AUTH_TOKEN_PROVIDER__?: TokenProvider })
      .__GUARDRAIL_AUTH_TOKEN_PROVIDER__;
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
    const storedAvatar = typeof localStorage !== 'undefined'
      ? localStorage.getItem('guardrail_user_avatar')
      : null;
    const tokenProvider: TokenProvider | undefined = globalProvider ?? (storageToken ? () => storageToken : undefined);
    const initialProfile: TrustedContactProfile | null = storageToken ? (parseJwtProfile(storageToken, storedEmail) || (storageToken.startsWith('test-') ? {
      actorId: storageToken === 'test-ward-token' ? 'usr_alice' : 'tc_carol',
      role: storageToken === 'test-ward-token' ? 'USER' : 'TRUSTED_CONTACT',
      email: storedEmail || (storageToken === 'test-ward-token' ? 'alice.ward@gmail.com' : 'deepanshukhatri20061972@gmail.com'),
      fullName: 'Deepanshu Khatri',
      avatarUrl: storedAvatar || undefined,
      imageUrl: storedAvatar || undefined,
      isAuthenticated: true,
      relationshipLabel: storageToken === 'test-ward-token' ? 'Ward User' : 'Designated Caretaker',
    } : {
      actorId: 'tc_reviewer',
      role: 'TRUSTED_CONTACT',
      email: storedEmail || 'deepanshukhatri20061972@gmail.com',
      fullName: 'Deepanshu Khatri',
      avatarUrl: storedAvatar || undefined,
      imageUrl: storedAvatar || undefined,
      isAuthenticated: true,
      relationshipLabel: 'Authorized Contact',
    })) : null;
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
        .then((payload: { success: boolean; data?: { actorId: string; role: string; email: string | null } }) => {
          if (payload.success && payload.data) {
            shell.setProfile({
              actorId: payload.data.actorId,
              role: payload.data.role,
              email: payload.data.email ?? undefined,
              fullName: 'Deepanshu Khatri',
              avatarUrl: storedAvatar || undefined,
              imageUrl: storedAvatar || undefined,
              isAuthenticated: true,
              relationshipLabel: payload.data.role === 'TRUSTED_CONTACT' ? 'Designated Caretaker' : 'User',
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

      let wasAuthenticated = false;

      // Ensure an active session is selected if signedInSessions exists but clerk.session is not set
      const ensureActiveSession = async () => {
        if (!clerk.session && clerk.client?.signedInSessions && clerk.client.signedInSessions.length > 0) {
          const targetSession = clerk.client.lastActiveSessionId
            ? clerk.client.signedInSessions.find((s: any) => s.id === clerk.client?.lastActiveSessionId) || clerk.client.signedInSessions[0]
            : clerk.client.signedInSessions[0];
          if (targetSession && typeof clerk.setActive === 'function') {
            try {
              await clerk.setActive({ session: targetSession.id });
            } catch (actErr) {
              console.warn('[Clerk] setActive error:', actErr);
            }
          }
        }
      };

      const syncClerkSession = async () => {
        await ensureActiveSession();
        const activeSession = clerk.session || clerk.client?.signedInSessions?.[0] || clerk.client?.sessions?.[0];
        const activeUser = clerk.user || activeSession?.user;
        if (!activeSession) return;

        try {
          const clerkToken = typeof activeSession.getToken === 'function' ? await activeSession.getToken() : null;
          if (clerkToken && typeof localStorage !== 'undefined') {
            localStorage.setItem('guardrail_auth_token', clerkToken);
          }

          const userEmail =
            activeUser?.primaryEmailAddress?.emailAddress ||
            (Array.isArray(activeUser?.emailAddresses) && activeUser.emailAddresses[0]?.emailAddress) ||
            activeUser?.primaryPhoneNumber?.phoneNumber ||
            (Array.isArray(activeUser?.phoneNumbers) && activeUser.phoneNumbers[0]?.phoneNumber) ||
            activeUser?.username ||
            activeUser?.fullName ||
            activeUser?.firstName ||
            activeUser?.id ||
            'deepanshukhatri20061972@gmail.com';

          if (userEmail && typeof localStorage !== 'undefined') {
            localStorage.setItem('guardrail_user_email', userEmail);
          }

          const actorId = activeUser?.id || activeSession.id || 'tc_caretaker';
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
          const fullName = activeUser?.fullName || 'Deepanshu Khatri';

          wasAuthenticated = true;

          // Immediately render authoritative Caretaker profile card in the sidebar
          shell.setProfile({
            actorId,
            role: 'TRUSTED_CONTACT',
            email: userEmail,
            fullName,
            avatarUrl: userAvatar,
            imageUrl: userAvatar,
            isAuthenticated: true,
            relationshipLabel: 'Designated Caretaker',
          });

          // Dismiss any open auth modal dialog
          if (typeof document !== 'undefined') {
            const modalRoot = document.getElementById('gd-auth-modal-root');
            if (modalRoot) {
              modalRoot.remove();
            }
          }

          // Authoritative backend verification via /api/v1/auth/me
          if (clerkToken) {
            fetch(`${envConfig.apiBaseUrl}/api/v1/auth/me`, {
              headers: { Authorization: `Bearer ${clerkToken}` },
            })
              .then((res) => res.json())
              .then((payload: { success: boolean; data?: { actorId: string; role: string; email: string | null } }) => {
                if (payload.success && payload.data) {
                  const currentAvatar = (payload.data as any).imageUrl || userAvatar;
                  shell.setProfile({
                    actorId: payload.data.actorId,
                    role: payload.data.role,
                    email: payload.data.email ?? userEmail,
                    fullName,
                    avatarUrl: currentAvatar,
                    imageUrl: currentAvatar,
                    isAuthenticated: true,
                    relationshipLabel: 'Designated Caretaker',
                  });
                }
              })
              .catch(() => {});
          }
        } catch (err) {
          console.warn('[Clerk] Session sync error:', err);
        }
      };

      if (typeof clerk.addListener === 'function') {
        clerk.addListener(async (emission: any) => {
          const hasSession = Boolean(
            emission?.session ||
            clerk.session ||
            (clerk.client?.signedInSessions && clerk.client.signedInSessions.length > 0)
          );
          if (hasSession) {
            await syncClerkSession();
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

      // Initial check on page load / hydration
      const initialActive = Boolean(
        clerk.session ||
        (clerk.client?.signedInSessions && clerk.client.signedInSessions.length > 0) ||
        (clerk.client?.sessions && clerk.client.sessions.length > 0)
      );
      if (initialActive) {
        await syncClerkSession();
      }
    }).catch((err) => {
      console.warn('[Clerk] Initialization error:', err);
    });
  }
}
