/**
 * Guardrail Extension Messaging Utility
 *
 * Provides safe, typed cross-process communication between Content Scripts
 * and the Background Service Worker, with resilient context-invalidation handling.
 */

import {
  ActionAcknowledgementResponse,
  ActionClassificationResult,
  ApprovalRequestIntent,
  ApprovalRequestResponse,
  GuardrailAction,
  GuardrailActionMessage,
  GuardrailApprovalRequestMessage,
  GuardrailGetApprovalStatusMessage,
  GuardrailGetApprovalStatusResponse,
  GuardrailSubmitApprovalRequestMessage,
  GuardrailSubmitApprovalRequestResponse,
  InterceptionRecord,
  ResponseDecision,
  RiskAssessment,
  StagingActionContext,
} from '../types/index.js';

/**
 * Safely dispatches a GuardrailAction, its classification, risk assessment, response decision, and interception record to the background service worker.
 *
 * @param action The normalized GuardrailAction to send
 * @param classification Optional ActionClassificationResult computed by the classifier
 * @param risk Optional RiskAssessment computed by the Risk Engine
 * @param decision Optional ResponseDecision computed by the Response Engine
 * @param interception Optional InterceptionRecord computed by the Interception Controller
 * @returns A promise resolving to the acknowledgement response or null if failed
 */
export async function dispatchActionToBackground(
  action: GuardrailAction,
  classification?: ActionClassificationResult,
  risk?: RiskAssessment,
  decision?: ResponseDecision,
  interception?: InterceptionRecord
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
    interception,
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

/**
 * Safely dispatches a local ApprovalRequestIntent to the background service worker.
 *
 * PROTOTYPE BOUNDARY GUARANTEE:
 * - Emits GUARDRAIL_APPROVAL_REQUEST to the extension background hub.
 * - Confirms local delivery to background worker only.
 * - Does NOT initiate any remote network calls, WebSockets, or caretaker push notifications.
 *
 * @param intent The sanitized, typed ApprovalRequestIntent
 * @returns A promise resolving to the approval response or null if unavailable
 */
export async function dispatchApprovalRequestToBackground(
  intent: ApprovalRequestIntent
): Promise<ApprovalRequestResponse | null> {
  // Guard against disconnected runtime if extension was reloaded in chrome://extensions
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    console.info('[Guardrail Messaging] Extension was reloaded or runtime unavailable. Approval request captured locally.');
    return null;
  }

  const message: GuardrailApprovalRequestMessage = {
    type: 'GUARDRAIL_APPROVAL_REQUEST',
    intent,
  };

  try {
    const response = await chrome.runtime.sendMessage<
      GuardrailApprovalRequestMessage,
      ApprovalRequestResponse
    >(message);

    if (response) {
      console.log(
        `%c[Guardrail Messaging]%c Local approval request registered in background:`,
        'color: #0ea5e9; font-weight: bold;',
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
      console.warn('[Guardrail Messaging] Failed to dispatch approval request to background:', error);
    }
    return null;
  }
}

/**
 * Safely dispatches a real approval submission request from Content Script / Staging UI
 * to the Background Service Worker coordinator.
 *
 * RESILIENCE & ERROR HANDLING:
 * - Validates local parameters before dispatch.
 * - Handles extension context invalidation and network errors without crashing.
 * - In case of transport failure or runtime disconnect, returns a typed UNCERTAIN failure result
 *   (isAuthoritative: false) so the UI keeps the action safely HELD and displays an honest status.
 *
 * @param actionId Stable identifier of the held action
 * @param context Minimal StagingActionContext containing action metadata
 * @returns Strongly typed GuardrailSubmitApprovalRequestResponse
 */
export async function dispatchSubmitApprovalRequestToBackground(
  actionId: string,
  context: StagingActionContext
): Promise<GuardrailSubmitApprovalRequestResponse> {
  if (!actionId || !context) {
    return {
      success: false,
      actionId: actionId || '',
      outcome: 'INVALID_LOCAL_STATE',
      isAuthoritative: true,
      error: {
        code: 'INVALID_PARAMETERS',
        message: 'A valid actionId and StagingActionContext are required for approval submission.',
      },
    };
  }

  // Guard against disconnected runtime if extension was reloaded in chrome://extensions
  if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.runtime?.sendMessage) {
    console.info('[Guardrail Messaging] Extension runtime is unavailable.');
    return {
      success: false,
      actionId,
      outcome: 'NETWORK_FAILURE_UNCERTAIN',
      isAuthoritative: false,
      error: {
        code: 'RUNTIME_UNAVAILABLE',
        message: 'Extension runtime is unavailable or disconnected. The intercepted action remains safely HELD.',
      },
    };
  }

  const message: GuardrailSubmitApprovalRequestMessage = {
    type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
    actionId,
    context,
  };

  try {
    const response = await chrome.runtime.sendMessage<
      GuardrailSubmitApprovalRequestMessage,
      GuardrailSubmitApprovalRequestResponse
    >(message);

    if (response) {
      return response;
    }

    return {
      success: false,
      actionId,
      outcome: 'NETWORK_FAILURE_UNCERTAIN',
      isAuthoritative: false,
      error: {
        code: 'EMPTY_RESPONSE',
        message: 'Background worker returned an empty response. Server state is UNCERTAIN. Action remains safely HELD.',
      },
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMsg.toLowerCase().includes('timeout');

    return {
      success: false,
      actionId,
      outcome: isTimeout ? 'TIMEOUT_UNCERTAIN' : 'NETWORK_FAILURE_UNCERTAIN',
      isAuthoritative: false,
      error: {
        code: isTimeout ? 'TIMEOUT' : 'DISPATCH_ERROR',
        message: `Failed to dispatch approval request to background: ${errorMsg}. Server state is UNCERTAIN. Action remains safely HELD.`,
      },
    };
  }
}

/**
 * Safely queries the authoritative approval status from the Background Service Worker.
 *
 * @param requestId Canonical approval request identifier ('apr_...')
 * @param actionId Optional identifier of the held action
 * @returns Strongly typed GuardrailGetApprovalStatusResponse
 */
export async function dispatchGetApprovalStatusToBackground(
  requestId: string,
  actionId?: string
): Promise<GuardrailGetApprovalStatusResponse> {
  if (!requestId || typeof requestId !== 'string' || !requestId.trim()) {
    return {
      success: false,
      requestId: requestId || '',
      isAuthoritative: true,
      error: {
        code: 'INVALID_PARAMETERS',
        message: 'A valid requestId is required for approval status lookup.',
        statusCode: 400,
      },
    };
  }

  // Guard against disconnected runtime if extension was reloaded in chrome://extensions
  if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.runtime?.sendMessage) {
    return {
      success: false,
      requestId: requestId.trim(),
      isAuthoritative: false,
      error: {
        code: 'RUNTIME_UNAVAILABLE',
        message: 'Extension runtime is unavailable or disconnected. The intercepted action remains safely HELD.',
      },
    };
  }

  const message: GuardrailGetApprovalStatusMessage = {
    type: 'GUARDRAIL_GET_APPROVAL_STATUS',
    requestId: requestId.trim(),
    actionId,
  };

  try {
    const response = await chrome.runtime.sendMessage<
      GuardrailGetApprovalStatusMessage,
      GuardrailGetApprovalStatusResponse
    >(message);

    if (response) {
      return response;
    }

    return {
      success: false,
      requestId: requestId.trim(),
      isAuthoritative: false,
      error: {
        code: 'EMPTY_RESPONSE',
        message: 'Background worker returned an empty response. Server state is UNCERTAIN.',
      },
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMsg.toLowerCase().includes('timeout');

    return {
      success: false,
      requestId: requestId.trim(),
      isAuthoritative: false,
      error: {
        code: isTimeout ? 'TIMEOUT' : 'DISPATCH_ERROR',
        message: `Failed to dispatch status lookup to background: ${errorMsg}. Server state is UNCERTAIN.`,
      },
    };
  }
}


