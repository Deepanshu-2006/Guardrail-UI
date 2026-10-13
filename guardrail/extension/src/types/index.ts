/**
 * Foundation types for Guardrail Extension
 */

export * from './actions.js';
export * from './classification.js';
export * from './risk.js';
export * from './response.js';
export * from './interception.js';
export * from './staging.js';
export * from './approval.js';

export interface ExtensionManifestInfo {
  name: string;
  version: string;
  manifestVersion: number;
}

export type ExtensionLifecycleState = 'initializing' | 'ready' | 'idle';

export interface BaseMessage<T = unknown> {
  type: string;
  payload?: T;
}

/**
 * Message payload dispatched when user performs a test action on the demo page.
 */
export interface TestActionMessage {
  type: 'TEST_ACTION';
  action: string;
  url: string;
}

/**
 * Acknowledgement response returned by the background service worker.
 */
export interface ActionAcknowledgementResponse {
  success: boolean;
  message: string;
}
