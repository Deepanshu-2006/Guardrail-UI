/**
 * Guardrail Action Factory
 *
 * Centralized builder for creating normalized, immutable GuardrailAction instances.
 * Eliminates duplication of metadata generation, timestamping, and DOM extraction.
 */

import { ActionType, GuardrailAction } from '../types/index.js';
import { createActionMetadata, extractElementInfo, extractPageInfo } from '../utils/index.js';

/**
 * Creates a fully normalized GuardrailAction object.
 *
 * @param type The ActionType enum value (CLICK, INPUT, SUBMIT, NAVIGATION)
 * @param targetElement Optional DOM element for element-level actions
 * @param previousUrl Optional explicit previous URL (for navigation tracking)
 * @returns A complete, normalized GuardrailAction
 */
export function createGuardrailAction(
  type: ActionType,
  targetElement?: HTMLElement | Element | null,
  previousUrl?: string
): GuardrailAction {
  // 1. Generate unique action ID and synchronized ISO timestamp
  const metadata = createActionMetadata('act');

  // 2. Extract current page context
  const pageInfo = extractPageInfo(previousUrl);

  // 3. Extract element metadata if a target DOM element is provided
  const elementInfo = targetElement ? extractElementInfo(targetElement) : undefined;

  // 4. Assemble the complete normalized model
  const action: GuardrailAction = {
    id: metadata.id,
    type,
    page: pageInfo,
    timestamp: metadata.timestamp,
  };

  if (elementInfo) {
    action.element = elementInfo;
  }

  return action;
}
