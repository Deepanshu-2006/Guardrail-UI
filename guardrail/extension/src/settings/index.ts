/**
 * Guardrail UI - Protection Settings Page Entry Point
 *
 * Bootstraps the protected user's protection settings interface into the DOM.
 */

import { ProtectionSettingsController } from './controller.js';
import { renderProtectionSettings } from './component.js';

export * from './types.js';
export * from './controller.js';
export * from './component.js';

export async function initializeProtectionSettingsPage(): Promise<void> {
  const mountPoint = document.getElementById('settings-app');
  if (!mountPoint) {
    console.error('[Guardrail Settings] Root mount point #settings-app not found.');
    return;
  }

  const controller = new ProtectionSettingsController();
  const component = renderProtectionSettings(controller);

  mountPoint.innerHTML = '';
  mountPoint.appendChild(component);

  await controller.initialize();
}

// Auto-bootstrap when loaded in document
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initializeProtectionSettingsPage();
    });
  } else {
    void initializeProtectionSettingsPage();
  }
}
