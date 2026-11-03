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

/**
 * Convenience bootstrap function to mount the dashboard shell into the page.
 */
export function mountDashboardShell(options: DashboardShellOptions): DashboardShell {
  return new DashboardShell(options);
}

// Auto-mount if running in standalone HTML document with #dashboard-app container
if (typeof document !== 'undefined') {
  const defaultMountPoint = document.getElementById('dashboard-app');
  if (defaultMountPoint) {
    const envConfig = resolveEnvironmentConfig();
    new DashboardShell({
      container: defaultMountPoint,
      environment: envConfig.env,
      isMockService: envConfig.serviceType === 'mock' || envConfig.serviceType === 'in_memory',
    });
  }
}
