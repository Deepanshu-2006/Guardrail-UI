/**
 * Guardrail Trusted-Contact Dashboard - Main Library Entry Point
 */

export * from './types.js';
export * from './shell.js';
export * from './components/navigation.js';
export * from './components/account.js';
export * from './components/overview.js';
export * from './components/pending.js';
export * from './components/history.js';
export * from './components/settings.js';
export * from './components/relationships.js';

import { DashboardShell } from './shell.js';
import { DashboardShellOptions } from './types.js';
import { resolveEnvironmentConfig } from '../../extension/src/config/environment.js';
import { ApprovalApiClient, TokenProvider } from '../../extension/src/approval/client.js';

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

function parseJwtProfile(token: string): TrustedContactProfile | null {
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
    return {
      actorId,
      role,
      isAuthenticated: true,
      relationshipLabel: 'Authorized Contact',
    };
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
    const storageToken = typeof localStorage !== 'undefined' ? localStorage.getItem('guardrail_auth_token') : null;
    const tokenProvider: TokenProvider | undefined = globalProvider ?? (storageToken ? () => storageToken : undefined);
    const initialProfile: TrustedContactProfile | null = storageToken ? parseJwtProfile(storageToken) : null;
    const apiClient = tokenProvider ? new ApprovalApiClient({
      baseUrl: envConfig.apiBaseUrl,
      environment: envConfig.environment,
      serviceType: 'live',
      tokenProvider,
      timeoutMs: envConfig.timeoutMs,
      logger: {
        debug: (msg, ctx) => console.debug('[Guardrail API]', msg, ctx ?? ''),
        info: (msg, ctx) => console.info('[Guardrail API]', msg, ctx ?? ''),
        warn: (msg, ctx) => console.warn('[Guardrail API]', msg, ctx ?? ''),
        error: (msg, ctx) => console.error('[Guardrail API]', msg, ctx ?? ''),
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
  }
}
