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

// Auto-mount if running in standalone HTML document with #dashboard-app container
if (typeof document !== 'undefined') {
  const defaultMountPoint = document.getElementById('dashboard-app');
  if (defaultMountPoint) {
    const envConfig = resolveEnvironmentConfig();
    const tokenProvider = (globalThis as typeof globalThis & { __GUARDRAIL_AUTH_TOKEN_PROVIDER__?: TokenProvider })
      .__GUARDRAIL_AUTH_TOKEN_PROVIDER__;
    const apiClient = tokenProvider ? new ApprovalApiClient({
      baseUrl: envConfig.apiBaseUrl,
      environment: envConfig.environment,
      serviceType: 'live',
      tokenProvider,
      timeoutMs: envConfig.timeoutMs,
    }) : undefined;
    new DashboardShell({
      container: defaultMountPoint,
      environment: envConfig.environment,
      isMockService: apiClient ? false : envConfig.serviceType === 'mock' || envConfig.serviceType === 'in_memory',
      ...(apiClient ? { apiClient } : {}),
    });
  }
}
