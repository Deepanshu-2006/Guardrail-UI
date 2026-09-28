/**
 * Guardrail Extension - Content Script Entrypoint
 *
 * Runs in isolated DOM execution world on target pages.
 * (DOM listeners, action interception, and risk detectors are omitted for Day 1 foundation.)
 */

(() => {
  console.log('[Guardrail Content Script] Initialized in isolated world on:', window.location.href);
})();
