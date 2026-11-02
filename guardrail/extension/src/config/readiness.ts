import { ConfigHealthStatus } from '../types/config.js';

/** Returns whether an initial configuration load has reached a known outcome. */
export function isPolicyConfigurationInitialized(status: ConfigHealthStatus): boolean {
  return status !== ConfigHealthStatus.UNINITIALIZED;
}

/**
 * Synchronously suppresses a supported controlled action while policy storage is
 * still loading. The caller can safely retry after initialization completes.
 */
export function cancelControlledActionUntilPolicyInitialized(
  status: ConfigHealthStatus,
  event: Pick<Event, 'preventDefault' | 'stopImmediatePropagation'>
): boolean {
  if (isPolicyConfigurationInitialized(status)) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}
