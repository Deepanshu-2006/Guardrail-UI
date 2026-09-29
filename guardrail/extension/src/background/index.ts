/**
 * Guardrail Extension - Background Service Worker
 *
 * Runs in an isolated Service Worker environment independent of web page DOMs.
 * Acts as the centralized coordinator and event listener for the extension.
 *
 * NOTE: WebSockets, risk evaluation, authentication, and policy enforcement
 * are intentionally omitted for Day 1 foundation.
 */

const manifest = chrome.runtime.getManifest();
const startTime = new Date().toISOString();

// Top-level execution log whenever Chrome wakes or starts the service worker
console.log(
  '%c[Guardrail]%c Background service worker started',
  'color: #0ea5e9; font-weight: bold; padding: 2px 4px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
  'color: inherit; font-weight: normal;',
  {
    name: manifest.name,
    version: manifest.version,
    versionName: manifest.version_name,
    manifestVersion: manifest.manifest_version,
    startedAt: startTime,
  }
);

// Lifecycle listener: Extension installed or updated
chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  console.log(`[Guardrail] Extension lifecycle event: onInstalled (reason: ${details.reason})`);
});

// Lifecycle listener: Browser startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[Guardrail] Extension lifecycle event: onStartup');
});
