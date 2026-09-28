/**
 * Guardrail Extension - Popup Script
 *
 * Populates popup UI with runtime information.
 */

document.addEventListener('DOMContentLoaded', () => {
  const manifest = chrome.runtime.getManifest();
  const versionElement = document.getElementById('ext-version');
  const statusElement = document.getElementById('ext-status');

  if (versionElement) {
    versionElement.textContent = manifest.version;
  }

  if (statusElement) {
    statusElement.textContent = 'Active';
  }

  console.log(`[Guardrail Popup] Loaded: ${manifest.name} v${manifest.version}`);
});
