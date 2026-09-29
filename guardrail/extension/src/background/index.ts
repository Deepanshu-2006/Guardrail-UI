/**
 * Guardrail Extension - Background Service Worker
 *
 * Runs in an isolated Service Worker environment independent of web page DOMs.
 * Acts as the centralized coordinator and message hub for the extension.
 * Receives normalized GuardrailAction models from content scripts.
 *
 * NOTE: WebSockets, risk evaluation, authentication, and policy enforcement
 * are intentionally omitted for Day 1 foundation.
 */

import {
  ActionAcknowledgementResponse,
  GuardrailActionMessage,
  TestActionMessage,
} from '../types/index.js';

const manifest = chrome.runtime.getManifest();
const startTime = new Date().toISOString();

// Top-level execution log whenever Chrome wakes or starts the service worker
console.log(
  '%c[Guardrail Background]%c Service worker initialized',
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

// Extension Message Listener: Receives messages from content scripts and returns an acknowledgement
chrome.runtime.onMessage.addListener(
  (
    message: GuardrailActionMessage | TestActionMessage,
    sender,
    sendResponse: (response: ActionAcknowledgementResponse) => void
  ) => {
    // 1. Handle normalized GuardrailAction messages
    if (message && message.type === 'GUARDRAIL_ACTION') {
      console.log(
        '%c[Guardrail Background]%c Received GuardrailAction from content script:',
        'color: #10b981; font-weight: bold; padding: 2px 4px; background: rgba(16, 185, 129, 0.1); border-radius: 3px;',
        'color: inherit; font-weight: normal;',
        {
          action: message.action,
          senderTabId: sender.tab?.id,
          senderTabTitle: sender.tab?.title,
          receivedAt: new Date().toISOString(),
        }
      );

      sendResponse({
        success: true,
        message: `Guardrail successfully registered action ${message.action.id}`,
      });

      return false;
    }

    // 2. Backward-compatible handler for legacy TEST_ACTION messages
    if (message && message.type === 'TEST_ACTION') {
      console.log(
        '%c[Guardrail Background]%c Received legacy TEST_ACTION:',
        'color: #10b981; font-weight: bold;',
        'color: inherit;',
        {
          action: message.action,
          url: message.url,
          senderTabId: sender.tab?.id,
        }
      );

      sendResponse({
        success: true,
        message: 'Guardrail received the action',
      });

      return false;
    }

    return false;
  }
);
