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
  GuardrailActionMessage,
  GuardrailApprovalRequestMessage,
  GuardrailSubmitApprovalRequestResponse,
  InterceptionState,
  StagingActionContext,
  TestActionMessage,
} from '../types/index.js';
import { InterceptionController } from '../interception/controller.js';
import {
  SubmissionOutcome,
  submitApprovalRequest,
  SubmitApprovalRequestOptions,
} from '../approval/submit-operation.js';
import { checkPayloadForSensitiveFields, ApprovalApiClient } from '../approval/client.js';
import { validateApprovalRequestId } from '../approval/model.js';
import {
  ApprovalRequest,
  ApprovalStatusString,
  GuardrailGetApprovalStatusMessage,
  GuardrailGetApprovalStatusResponse,
} from '../types/approval.js';

const manifest =
  typeof chrome !== 'undefined' && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest()
    : { name: 'guardrail', version: '0.1.0', version_name: '0.1.0', manifest_version: 3 };
const startTime = new Date().toISOString();

/**
 * Shared in-memory InterceptionController instance for the Background Service Worker.
 * Tracks held actions dispatched from content scripts and validates state before backend dispatch.
 */
export const backgroundInterceptionController = new InterceptionController();

/**
 * Result of validating an incoming approval submission message.
 */
export interface ValidatedApprovalMessage {
  readonly valid: boolean;
  readonly error?: string;
  readonly actionId?: string;
  readonly context?: StagingActionContext;
}

/**
 * Validates message type, payload shape, security boundaries, and least-privilege constraints
 * for an incoming approval submission message from a content script.
 *
 * SECURITY INVARIANTS:
 * 1. Requires type === 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST'.
 * 2. Strictly rejects privileged decision overrides (decision, status, decidedBy, verdict, etc.).
 * 3. Strictly rejects auth secrets, tokens, passwords, and arbitrary endpoints.
 * 4. Ensures actionId matches context.actionId.
 * 5. Scans context for sensitive properties.
 */
export function validateApprovalSubmissionMessage(message: unknown): ValidatedApprovalMessage {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be a non-null object.' };
  }

  const raw = message as Record<string, unknown>;

  // 1. Validate message type
  if (raw.type !== 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST') {
    return { valid: false, error: `Unsupported message type: "${String(raw.type)}".` };
  }

  // 2. Reject privileged instructions or decision overrides (Requirement 4)
  const privilegedFields = [
    'decision',
    'status',
    'decidedBy',
    'decidedAt',
    'decisionReason',
    'verdict',
    'approve',
    'reject',
    'cancel',
    'token',
    'authToken',
    'jwt',
    'secret',
    'password',
    'otp',
    'endpoint',
    'url',
    'method',
  ];

  for (const field of privilegedFields) {
    if (field in raw && raw[field] !== undefined) {
      return {
        valid: false,
        error: `Security violation: Message contains forbidden or privileged instruction "${field}". Untrusted scripts cannot decide approvals or supply arbitrary endpoints/credentials.`,
      };
    }
  }

  // 3. Validate actionId
  const actionId = typeof raw.actionId === 'string' ? raw.actionId.trim() : '';
  if (!actionId) {
    return { valid: false, error: 'Missing or empty actionId in submission message.' };
  }

  // 4. Validate context
  const context = raw.context as StagingActionContext | undefined;
  if (!context || typeof context !== 'object') {
    return { valid: false, error: 'Missing or invalid StagingActionContext in submission message.' };
  }

  if (context.actionId !== actionId) {
    return {
      valid: false,
      error: `Action ID mismatch: message actionId "${actionId}" does not match context actionId "${context.actionId}".`,
    };
  }

  // 5. Check context for sensitive fields (Requirement 13)
  const sensitiveFields = checkPayloadForSensitiveFields(context);
  if (sensitiveFields.length > 0) {
    return {
      valid: false,
      error: `Security violation: Staging context contains sensitive fields (${sensitiveFields.join(', ')}).`,
    };
  }

  return {
    valid: true,
    actionId,
    context,
  };
}

/**
 * Processes a validated approval submission request in the background service worker:
 * 1. Synchronizes / verifies the held action record in the background controller.
 * 2. Validates that the action is actively in HELD state.
 * 3. Dispatches the real typed submitApprovalRequest operation to the backend API.
 * 4. Returns typed GuardrailSubmitApprovalRequestResponse.
 */
export async function handleBackgroundApprovalSubmission(
  message: unknown,
  controller: InterceptionController = backgroundInterceptionController,
  options?: SubmitApprovalRequestOptions
): Promise<GuardrailSubmitApprovalRequestResponse> {
  const validation = validateApprovalSubmissionMessage(message);
  if (!validation.valid || !validation.actionId || !validation.context) {
    return {
      success: false,
      actionId: validation.actionId || '',
      outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
      isAuthoritative: true,
      error: {
        code: 'VALIDATION_ERROR',
        message: validation.error || 'Invalid approval submission message.',
        statusCode: 400,
      },
    };
  }

  const { actionId, context } = validation;

  // Verify / synchronize interception record in background controller
  if (!controller.hasRecord(actionId)) {
    if (context.interceptionState === InterceptionState.HELD) {
      controller.register(actionId, context.interceptionReason || 'Action held in staging mode.');
      controller.holdAction(actionId, context.interceptionReason || 'Action held in staging mode.');
    } else {
      return {
        success: false,
        actionId,
        outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
        isAuthoritative: true,
        error: {
          code: 'ACTION_NOT_FOUND',
          message: `Action "${actionId}" is not actively tracked by Guardrail coordinator.`,
        },
      };
    }
  }

  // Verify state in controller (Requirement 5)
  const record = controller.getRecord(actionId);
  if (!record || record.state !== InterceptionState.HELD) {
    return {
      success: false,
      actionId,
      outcome: SubmissionOutcome.INVALID_LOCAL_STATE,
      isAuthoritative: true,
      error: {
        code: 'ACTION_NOT_HELD',
        message: `Action "${actionId}" is in state "${record?.state || 'UNKNOWN'}". Only actions in HELD state are eligible for approval requests.`,
      },
    };
  }

  // Trigger the real API submission operation (Requirement 6)
  const submitResult = await submitApprovalRequest(context, controller, options);

  if (submitResult.success) {
    return {
      success: true,
      actionId: submitResult.actionId,
      outcome: submitResult.outcome,
      isAuthoritative: submitResult.isAuthoritative,
      request: submitResult.request,
    };
  } else {
    return {
      success: false,
      actionId: submitResult.actionId,
      outcome: submitResult.outcome,
      isAuthoritative: submitResult.isAuthoritative,
      error: submitResult.error,
    };
  }
}

/**
 * Result of validating an incoming approval status lookup message.
 */
export interface ValidatedStatusLookupMessage {
  readonly valid: boolean;
  readonly error?: string;
  readonly requestId?: string;
  readonly actionId?: string;
}

/**
 * Validates message type, payload shape, security boundaries, and least-privilege constraints
 * for an incoming approval status lookup message.
 *
 * SECURITY INVARIANTS:
 * 1. Requires type === 'GUARDRAIL_GET_APPROVAL_STATUS'.
 * 2. Strictly rejects privileged decision overrides (decision, status, decidedBy, verdict, etc.).
 * 3. Strictly rejects auth secrets, tokens, passwords, and arbitrary endpoints.
 * 4. Validates canonical requestId format ('apr_...').
 */
export function validateApprovalStatusLookupMessage(message: unknown): ValidatedStatusLookupMessage {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be a non-null object.' };
  }

  const raw = message as Record<string, unknown>;

  // 1. Validate message type
  if (raw.type !== 'GUARDRAIL_GET_APPROVAL_STATUS') {
    return { valid: false, error: `Unsupported message type: "${String(raw.type)}".` };
  }

  // 2. Reject privileged instructions or decision overrides
  const privilegedFields = [
    'decision',
    'status',
    'decidedBy',
    'decidedAt',
    'decisionReason',
    'verdict',
    'approve',
    'reject',
    'cancel',
    'token',
    'authToken',
    'jwt',
    'secret',
    'password',
    'otp',
    'endpoint',
    'url',
    'method',
  ];

  for (const field of privilegedFields) {
    if (field in raw && raw[field] !== undefined) {
      return {
        valid: false,
        error: `Security violation: Message contains forbidden or privileged instruction "${field}". Untrusted callers cannot decide approvals or inject privileged states.`,
      };
    }
  }

  // 3. Validate requestId format
  const rawId = typeof raw.requestId === 'string' ? raw.requestId.trim() : '';
  const idValidation = validateApprovalRequestId(rawId);
  if (!idValidation.valid) {
    return {
      valid: false,
      error: idValidation.errors[0] || 'Invalid requestId format.',
    };
  }

  const actionId = typeof raw.actionId === 'string' && raw.actionId.trim() ? raw.actionId.trim() : undefined;

  return {
    valid: true,
    requestId: rawId,
    actionId,
  };
}

export interface HandleStatusLookupOptions {
  readonly apiClient?: ApprovalApiClient;
  readonly token?: string;
}

/**
 * Handles an approval status query in the background service worker:
 * 1. Validates the incoming message shape and security boundaries.
 * 2. If actionId is supplied, verifies that the action is actively tracked in the controller.
 * 3. Dispatches the status query to the authoritative backend via ApprovalApiClient.
 * 4. Returns typed GuardrailGetApprovalStatusResponse.
 *
 * CRITICAL SAFETY INVARIANT:
 * Receiving an APPROVED status NEVER executes or releases the held action.
 * The action remains safely HELD in the controller until explicit user review.
 */
export async function handleBackgroundApprovalStatusLookup(
  message: unknown,
  controller: InterceptionController = backgroundInterceptionController,
  options?: HandleStatusLookupOptions
): Promise<GuardrailGetApprovalStatusResponse> {
  const validation = validateApprovalStatusLookupMessage(message);
  if (!validation.valid || !validation.requestId) {
    return {
      success: false,
      requestId: validation.requestId || '',
      isAuthoritative: true,
      error: {
        code: 'VALIDATION_ERROR',
        message: validation.error || 'Invalid approval status lookup message.',
        statusCode: 400,
      },
    };
  }

  const { requestId, actionId } = validation;

  // If actionId is supplied, verify it is tracked in the controller
  if (actionId) {
    const record = controller.getRecord(actionId);
    if (!record) {
      return {
        success: false,
        requestId,
        isAuthoritative: true,
        error: {
          code: 'ACTION_NOT_FOUND',
          message: `Action "${actionId}" is not actively tracked by Guardrail coordinator.`,
          statusCode: 404,
        },
      };
    }
  }

  const client = options?.apiClient ?? new ApprovalApiClient();

  try {
    const result = await client.getApprovalRequest(requestId, {
      token: options?.token,
    });

    if (result.success && result.data) {
      return {
        success: true,
        requestId,
        status: result.data.status,
        request: result.data,
        isAuthoritative: true,
      };
    } else {
      return {
        success: false,
        requestId,
        isAuthoritative: result.statusCode !== undefined && result.statusCode < 500,
        error: {
          code: result.error?.code || 'STATUS_LOOKUP_FAILED',
          message: result.error?.message || 'Failed to retrieve approval request status.',
          statusCode: result.statusCode,
          details: result.error?.details,
        },
      };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      requestId,
      isAuthoritative: false,
      error: {
        code: 'DISPATCH_ERROR',
        message: `Status lookup dispatch failed: ${errorMsg}`,
        statusCode: 500,
      },
    };
  }
}

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

// Register runtime listeners when running inside browser extension runtime
if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Lifecycle listener: Extension installed or updated
  if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
      console.log(`[Guardrail] Extension lifecycle event: onInstalled (reason: ${details.reason})`);
    });
  }

  // Lifecycle listener: Browser startup
  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      console.log('[Guardrail] Extension lifecycle event: onStartup');
    });
  }

  // Extension Message Listener: Receives messages from content scripts and returns an acknowledgement
  if (chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(
      (
        message: unknown,
        sender,
        sendResponse: (response: unknown) => void
      ) => {
    if (!message || typeof message !== 'object') {
      sendResponse({ success: false, error: 'INVALID_MESSAGE_PAYLOAD' });
      return false;
    }

    const raw = message as Record<string, unknown>;

    // 1. Reject unauthorized decision attempts or privileged overrides (Requirement 4)
    if (
      raw.type === 'DECIDE_APPROVAL' ||
      raw.decision !== undefined ||
      raw.status === 'APPROVED' ||
      raw.status === 'REJECTED'
    ) {
      console.warn('[Guardrail Background] Rejected unauthorized decision attempt from webpage message:', raw);
      sendResponse({
        success: false,
        error: {
          code: 'UNAUTHORIZED_INSTRUCTION',
          message: 'Approval decisions cannot be issued by content scripts or webpage messages.',
        },
        isAuthoritative: true,
      });
      return false;
    }

    // 2. Handle GUARDRAIL_SUBMIT_APPROVAL_REQUEST (Real backend submission)
    if (raw.type === 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST') {
      handleBackgroundApprovalSubmission(message, backgroundInterceptionController)
        .then((response) => {
          sendResponse(response);
        })
        .catch((err) => {
          sendResponse({
            success: false,
            actionId: typeof raw.actionId === 'string' ? raw.actionId : '',
            outcome: SubmissionOutcome.NETWORK_FAILURE_UNCERTAIN,
            isAuthoritative: false,
            error: {
              code: 'DISPATCH_ERROR',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        });
      return true; // Keep message channel open for async sendResponse
    }

    // 3. Handle GUARDRAIL_GET_APPROVAL_STATUS (Authoritative status lookup)
    if (raw.type === 'GUARDRAIL_GET_APPROVAL_STATUS') {
      handleBackgroundApprovalStatusLookup(message, backgroundInterceptionController)
        .then((response) => {
          sendResponse(response);
        })
        .catch((err) => {
          sendResponse({
            success: false,
            requestId: typeof raw.requestId === 'string' ? raw.requestId : '',
            isAuthoritative: false,
            error: {
              code: 'DISPATCH_ERROR',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        });
      return true; // Keep message channel open for async sendResponse
    }

    // 3. Handle normalized GuardrailAction messages with Classification, Risk, and Response Decision
    if (raw.type === 'GUARDRAIL_ACTION') {
      const { action, classification, risk, decision, interception } = message as GuardrailActionMessage;

      // Track interception record in background controller if present
      if (interception && !backgroundInterceptionController.hasRecord(action.id)) {
        try {
          backgroundInterceptionController.register(action.id, interception.reason);
          if (interception.state === InterceptionState.HELD) {
            backgroundInterceptionController.holdAction(action.id, interception.reason);
          }
        } catch {
          // ignore already registered
        }
      }

      const targetSummary = action.element?.visibleText
        ? `"${action.element.visibleText}"`
        : action.element?.tagName
        ? `<${action.element.tagName.toLowerCase()}>`
        : action.page.url;

      const ruleSummary = classification?.matchedRule || 'none';
      const riskReasonsList = risk?.reasons?.map((r) => `* ${r}`).join('\n') || '* None';
      const primaryReason =
        decision?.reasons?.[0] || risk?.reasons?.[0] || 'Standard action registered';

      console.log(
        `%c[Guardrail Pipeline]%c EVALUATION RECEIVED\n` +
        `ACTION: ${action.type}${targetSummary ? ` (${targetSummary})` : ''}\n` +
        `CATEGORY: ${classification?.category || 'UNCLASSIFIED'}\n` +
        `RISK: ${risk?.riskLevel || 'LOW'} (score: ${risk?.score ?? 0})\n` +
        `RESPONSE: ${decision?.response || 'ALLOW'}` +
        `${interception ? `\nINTERCEPTION: ${interception.state} (${interception.reason})` : ''}\n` +
        `REASON: ${primaryReason}`,
        'color: #0ea5e9; font-weight: bold; padding: 3px 6px; background: rgba(14, 165, 233, 0.1); border-radius: 4px;',
        'color: inherit; font-weight: normal;',
        {
          actionId: action.id,
          type: action.type,
          category: classification?.category,
          riskLevel: risk?.riskLevel,
          riskScore: risk?.score,
          responseAction: decision?.response,
          interceptionState: interception?.state,
          interception,
          action,
          classification,
          risk,
          decision,
          ruleSummary,
          riskReasonsList,
          senderTabId: sender.tab?.id,
          receivedAt: new Date().toISOString(),
        }
      );

      sendResponse({
        success: true,
        message: `Guardrail registered action ${action.id} [${classification?.category || 'GENERAL'}] (Risk: ${risk?.riskLevel || 'LOW'}, Score: ${risk?.score ?? 0}, Response: ${decision?.response || 'ALLOW'}${interception ? `, State: ${interception.state}` : ''})`,
      });

      return false;
    }

    // 4. Handle local GuardrailApprovalRequestMessage (legacy prototype intent)
    if (raw.type === 'GUARDRAIL_APPROVAL_REQUEST') {
      const { intent } = message as GuardrailApprovalRequestMessage;
      console.log(
        `%c[Guardrail Background]%c LOCAL APPROVAL REQUEST INTENT RECEIVED (PROTOTYPE ONLY)\n` +
        `ACTION ID: ${intent.actionId}\n` +
        `DESCRIPTION: ${intent.description}\n` +
        `CATEGORY: ${intent.category || 'UNCLASSIFIED'}\n` +
        `RISK: ${intent.riskLevel} (score: ${intent.riskScore ?? 'N/A'})\n` +
        `STATUS: ${intent.status} (Backend not connected)\n` +
        `NOTE: Remote caretaker delivery is not yet connected. Action remains held.`,
        'color: #0ea5e9; font-weight: bold; padding: 3px 6px; background: rgba(14, 165, 233, 0.1); border-radius: 4px;',
        'color: inherit; font-weight: normal;',
        {
          actionId: intent.actionId,
          intent,
          senderTabId: sender.tab?.id,
          receivedAt: new Date().toISOString(),
          isBackendConnected: false,
        }
      );

      sendResponse({
        success: true,
        actionId: intent.actionId,
        message: `Local approval request intent recorded for action ${intent.actionId}. Backend services are not connected yet.`,
        isBackendConnected: false,
      });

      return false;
    }

    // 5. Backward-compatible handler for legacy TEST_ACTION messages
    if (raw.type === 'TEST_ACTION') {
      const testMsg = message as TestActionMessage;
      console.log(
        '%c[Guardrail Background]%c Received legacy TEST_ACTION:',
        'color: #10b981; font-weight: bold;',
        'color: inherit;',
        {
          action: testMsg.action,
          url: testMsg.url,
          senderTabId: sender.tab?.id,
        }
      );

      sendResponse({
        success: true,
        message: 'Guardrail received the action',
      });

      return false;
    }

    // 6. Unsupported message type
    sendResponse({
      success: false,
      error: `Unsupported message type: "${String(raw.type)}"`,
    });

    return false;
  }
);
  }
}

