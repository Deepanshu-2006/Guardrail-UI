/**
 * Guardrail Extension - Content Script Entrypoint
 *
 * Runs inside an isolated JavaScript execution world on matched web pages.
 * Proves injection, establishes the webpage runtime boundary, and logs page context.
 *
 * NOTE: Action interception, DOM modification, and risk engines are intentionally
 * omitted for Day 1 foundation.
 */

(() => {
  const pageUrl = window.location.href;
  const pageOrigin = window.location.origin;
  const timestamp = new Date().toISOString();

  console.log(
    '%c[Guardrail]%c Content script loaded',
    'color: #0ea5e9; font-weight: bold; padding: 2px 4px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    {
      url: pageUrl,
      origin: pageOrigin,
      timestamp,
      documentState: document.readyState,
    }
  );
})();
