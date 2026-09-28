/**
 * Guardrail Extension - Background Service Worker
 *
 * Manifest V3 background script managing lifecycle events.
 * (Business logic, interceptors, and web sockets are omitted for Day 1 foundation.)
 */

import { ExtensionLifecycleState } from '../types/index.js';

let currentState: ExtensionLifecycleState = 'initializing';

chrome.runtime.onInstalled.addListener((details) => {
  currentState = 'ready';
  console.log(`[Guardrail Service Worker] Installed: reason=${details.reason}, state=${currentState}`);
});

chrome.runtime.onStartup.addListener(() => {
  currentState = 'ready';
  console.log('[Guardrail Service Worker] Startup initialized');
});
