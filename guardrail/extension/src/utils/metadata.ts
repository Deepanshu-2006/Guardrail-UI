/**
 * Guardrail Action Metadata Utilities
 *
 * Generates unique identifiers and synchronized timestamps for captured interactions.
 * Safe for use across Content Scripts, Service Workers, and Popup environments.
 */

export interface ActionMetadata {
  /** Unique action trace identifier (e.g., 'act_f47ac10b-58cc-4372-a567-0e02b2c3d479') */
  id: string;

  /** Standard ISO 8601 UTC timestamp string */
  timestamp: string;
}

/**
 * Generates a unique, collision-resistant action identifier using browser-safe crypto APIs.
 *
 * @param prefix Optional prefix for namespace categorization (defaults to 'act')
 * @returns A unique action ID string
 */
export function generateActionId(prefix: string = 'act'): string {
  // Use Web Crypto API standard (available in modern browsers and service workers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  // Fallback generation combining epoch timestamp and high-entropy randomness
  const timestampPart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 11);
  return `${prefix}_${timestampPart}_${randomPart}`;
}

/**
 * Generates a standard ISO 8601 UTC timestamp for when an action was detected.
 *
 * @returns An ISO 8601 timestamp string (e.g., '2026-09-29T06:45:00.000Z')
 */
export function generateTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Convenience helper to create a complete metadata payload containing both ID and timestamp.
 *
 * @param prefix Optional ID prefix (defaults to 'act')
 * @returns An ActionMetadata object
 */
export function createActionMetadata(prefix: string = 'act'): ActionMetadata {
  return {
    id: generateActionId(prefix),
    timestamp: generateTimestamp(),
  };
}
