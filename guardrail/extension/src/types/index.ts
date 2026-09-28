/**
 * Foundation types for Guardrail Extension
 */

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
