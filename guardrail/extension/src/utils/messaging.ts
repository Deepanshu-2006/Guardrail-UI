/**
 * Guardrail Extension Messaging Utility
 *
 * Provides safe, typed cross-process communication between Content Scripts
 * and the Background Service Worker, with resilient context-invalidation handling.
 */

import {
  ActionAcknowledgementResponse,
  ActionClassificationResult,
  GuardrailAction,
  GuardrailActionMessage,
  ResponseDecision,
  RiskAssessment,
} from '../types/index.js';

/**
 * Safely dispatches a GuardrailAction, its classification, risk assessment, and response decision to the background service worker.
 *
 * @param action The normalized GuardrailAction to send
 * @param classification Optional ActionClassificationResult computed by the classifier
 * @param risk Optional RiskAssessment computed by the Risk Engine
 * @param decision Optional ResponseDecision computed by the Response Engine
 * @returns A promise resolving to the acknowledgement response or null if failed
 */
export async function dispatchActionToBackground(
  action: GuardrailAction,
  classification?: ActionClassificationResult,
  risk?: RiskAssessment,
  decision?: ResponseDecision
): Promise<ActionAcknowledgementResponse | null> {
  // Guard against disconnected runtime if extension was reloaded in chrome://extensions
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    console.info('[Guardrail Messaging] Extension was reloaded. Please refresh this tab to reconnect.');
    return null;
  }

  const message: GuardrailActionMessage = {
    type: 'GUARDRAIL_ACTION',
    action,
    classification,
    risk,
    decision,
  };

  try {
    const response = await chrome.runtime.sendMessage<
      GuardrailActionMessage,
      ActionAcknowledgementResponse
    >(message);

    if (response) {
      console.log(
        `%c[Guardrail Messaging]%c Background response for ${action.type}:`,
        'color: #a855f7; font-weight: bold;',
        'color: inherit;',
        response
      );
    }

    return response || null;
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('Extension context invalidated')) {
      console.info('[Guardrail Messaging] Extension was reloaded. Please refresh this tab to reconnect.');
    } else {
      console.warn(`[Guardrail Messaging] Failed to dispatch ${action.type} action:`, error);
    }
    return null;
  }
}
