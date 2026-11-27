/**
 * Guardrail Extension - Content Script Entrypoint
 *
 * Initializes the unified ActionDetector on the webpage DOM and routes
 * normalized GuardrailAction models to the background service worker coordinator.
 *
 * Architecture Pipeline:
 * DOM / Browser Event -> ActionDetector -> ActionFactory (GuardrailAction) -> Messaging Layer
 *
 * PRIVACY SAFEGUARD: Never captures or transmits user-typed form values or credentials.
 *
 * NOTE: Risk scoring, action interception, payment logic, and backend
 * communication are intentionally omitted at this stage.
 */

import { ActionDetector, createGuardrailAction } from '../detector/index.js';
import { evaluateActionPipeline } from '../response/index.js';
import {
  dismissPendingApprovalPill,
  dismissWarningModal,
  isExternalNavigationAction,
  showPendingApprovalPill,
  showWarningModal,
  showAdvisoryNotice,
  updatePendingApprovalPill,
  updateWaitingScreenStatus,
  type ApprovalWaitingState,
} from '../ui/index.js';
import { ApprovalStatus, type ApprovalRequest } from '../types/approval.js';
import { ApprovalStatusSyncClient, type StatusSyncSubscription } from '../approval/sync-client.js';
import {
  ActionClassificationResult,
  ActionType,
  ApprovalRequestResult,
  GuardrailAction,
  InterceptionRecord,
  InterceptionState,
  ResponseAction,
  ResponseDecision,
  RiskAssessment,
} from '../types/index.js';
import {
  CancellationResult,
  defaultContinuationManager,
  defaultInterceptionController,
  defaultRecoveryManager,
} from '../interception/index.js';
import {
  mountRecoveryBanner,
  dismissRecoveryBanner,
} from '../ui/recovery-banner.js';
import {
  createApprovalRequestIntent,
  createStagingActionContext,
  dismissStagingModal,
  getStagingUIState,
  isStagingModalActive,
  setStagingUIState,
  showStagingModal,
} from '../staging/index.js';
import { StagingActionContext } from '../types/staging.js';
import {
  dispatchActionToBackground,
  dispatchApprovalRequestToBackground,
  dispatchCancelApprovalRequestToBackground,
  dispatchGetApprovalStatusToBackground,
  dispatchSubmitApprovalRequestToBackground,
  extractPageInfo,
  GUARDRAIL_TEST_ACTION_ATTR,
  sanitizeForDiagnostics,
} from '../utils/index.js';
import {
  ConfigHealthStatus,
  getConfigHealthStatus,
  loadPolicyConfigFromStorage,
  reloadPolicyConfig,
  isTrustedDomain,
} from '../config/index.js';
import { cancelControlledActionUntilPolicyInitialized, isPolicyConfigurationInitialized } from '../config/readiness.js';
import { GUARDRAIL_POLICY_CONFIG_STORAGE_KEY } from '../config/loader.js';
import { getStoredWardToken } from '../approval/auth-manager.js';

/**
 * Detects if the current webpage is the Guardrail Trusted Contact Portal dashboard
 * or an internal extension page, which must be strictly exempt from content script
 * interception, policy evaluation, and warning UI injection.
 */
export function isDashboardOrInternalPage(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  // 1. Dashboard mount container or application role
  if (
    (typeof document.getElementById === 'function' && document.getElementById('dashboard-app')) ||
    (typeof document.querySelector === 'function' && document.querySelector('[role="application"][aria-label*="Guardrail"]'))
  ) {
    return true;
  }

  // 2. Document title
  if (typeof document.title === 'string' && (document.title.includes('Guardrail — Trusted Contact Portal') || document.title.includes('Guardrail'))) {
    return true;
  }

  // 3. Location heuristics (dashboard dev port 5173, localhost, or extension origin)
  const loc = window.location;
  if (loc) {
    if (loc.port === '5173' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
      return true;
    }
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime?.id &&
      loc.origin === `chrome-extension://${chrome.runtime.id}`
    ) {
      return true;
    }

    // 4. Legitimate OAuth / Identity Provider pages (Google, Clerk, Apple)
    const hostname = loc.hostname.toLowerCase();
    if (
      hostname === 'accounts.google.com' ||
      hostname.endsWith('.google.com') ||
      hostname.endsWith('.clerk.accounts.dev') ||
      hostname.endsWith('.clerk.com') ||
      hostname.endsWith('.accounts.dev') ||
      hostname.endsWith('.apple.com') ||
      hostname === 'appleid.apple.com'
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether a destination URL represents an untrusted web destination.
 */
export function isUntrustedWebDestination(urlCandidate?: string, currentOrigin?: string): boolean {
  if (!urlCandidate || typeof urlCandidate !== 'string') return false;
  const trimmed = urlCandidate.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return false;
    }
    // Legitimate OAuth / Identity Provider hostnames
    if (
      hostname === 'accounts.google.com' ||
      hostname.endsWith('.google.com') ||
      hostname.endsWith('.clerk.accounts.dev') ||
      hostname.endsWith('.clerk.com') ||
      hostname.endsWith('.accounts.dev') ||
      hostname.endsWith('.apple.com') ||
      hostname === 'appleid.apple.com'
    ) {
      return false;
    }
    if (isTrustedDomain(trimmed)) {
      return false;
    }
    const originToCheck = currentOrigin ?? (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : undefined);
    if (originToCheck && parsed.origin === originToCheck) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

let latestStagingContext: StagingActionContext | null = null;
let activeWarningSyncSub: StatusSyncSubscription | null = null;
let activeBackgroundPollTimer: ReturnType<typeof setInterval> | null = null;

interface ActiveApprovalSession {
  action: GuardrailAction;
  risk: RiskAssessment;
  decision: ResponseDecision;
  classification?: ActionClassificationResult;
  requestId: string | null;
  status: ApprovalWaitingState;
  hasExecutedContinuation: boolean;
  submittedAt: string;
}

let activeApprovalSession: ActiveApprovalSession | null = null;

function stopWarningStatusPolling(): void {
  if (activeWarningSyncSub) {
    activeWarningSyncSub.stop();
    activeWarningSyncSub = null;
  }
  if (activeBackgroundPollTimer) {
    clearInterval(activeBackgroundPollTimer);
    activeBackgroundPollTimer = null;
  }
}

function resolveApproverDisplayName(decision?: {
  decidedBy?: string;
  decidedByName?: string;
}): string {
  const named = decision?.decidedByName?.trim();
  if (named) return named;
  const raw = decision?.decidedBy?.trim();
  if (!raw) return 'your designated caretaker';
  if (/^(usr|tc|adm)_[a-zA-Z0-9_-]{6,}$/.test(raw) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)) {
    return 'Trusted Contact';
  }
  return raw;
}

/**
 * Handles terminal status updates (APPROVED, REJECTED, CANCELLED, EXPIRED) authoritatively.
 * Decoupled execution invariant: Rejections and cancellations strictly NEVER continue or navigate.
 */
function handleAuthoritativeApprovalResolution(
  requestId: string,
  action: GuardrailAction,
  status: ApprovalStatus,
  request?: ApprovalRequest
): void {
  if (!activeApprovalSession || activeApprovalSession.action.id !== action.id) {
    return;
  }

  // Security Guard: Prevent stale approval responses from releasing cancelled or rejected requests
  if (
    activeApprovalSession.status === 'cancelled' ||
    activeApprovalSession.status === 'rejected' ||
    activeApprovalSession.hasExecutedContinuation
  ) {
    console.warn(
      `[Guardrail UI] Security Guard: Rejected stale status update [${status}] for request in terminal state [${activeApprovalSession.status}]`
    );
    return;
  }

  if (status === ApprovalStatus.APPROVED) {
    activeApprovalSession.status = 'approved';
    const approver = resolveApproverDisplayName(request?.decision as any);
    const reason =
      request?.decision?.decisionReason ||
      (request?.decision as any)?.reason ||
      undefined;
    void defaultRecoveryManager.updateStagedActionStatus(action.id, 'approved', approver);

    updatePendingApprovalPill('approved');
    updateWaitingScreenStatus('approved', {
      requestId,
      approver,
      reason,
      submittedAt: activeApprovalSession.submittedAt,
      onProceed: () => {
        if (!activeApprovalSession || activeApprovalSession.hasExecutedContinuation) {
          return;
        }
        activeApprovalSession.hasExecutedContinuation = true;
        void defaultRecoveryManager.clearRecovery(action.id);

        stopWarningStatusPolling();
        dismissPendingApprovalPill();
        dismissWarningModal();

        console.log(`[Guardrail UI] Releasing held action exactly once for approved request: ${requestId}`);
        try {
          defaultContinuationManager.continueAction(action.id);
        } catch (contErr) {
          console.warn('[Guardrail UI] Continuation manager warning:', contErr);
        }

        const destUrl = action.element?.targetUrl || action.element?.formAction || action.page?.url;
        if (destUrl && typeof window !== 'undefined') {
          window.location.href = destUrl;
        }
      },
    });

    stopWarningStatusPolling();
  } else if (status === ApprovalStatus.REJECTED) {
    activeApprovalSession.status = 'rejected';
    void defaultRecoveryManager.clearRecovery(action.id);
    const approver = resolveApproverDisplayName(request?.decision as any);
    const reason =
      request?.decision?.decisionReason ||
      (request?.decision as any)?.reason ||
      undefined;

    console.log(`[Guardrail UI] Authoritative rejection received for ${requestId}. Reason: "${reason || 'Declined by caretaker'}". Action remains safely blocked.`);

    // 1. Update UI FIRST so user immediately sees authoritative Access Denied view
    updateWaitingScreenStatus('rejected', {
      requestId,
      approver,
      reason,
      submittedAt: activeApprovalSession.submittedAt,
    });
    updatePendingApprovalPill('rejected');

    // 2. Decoupled execution guarantee: explicitly cancel held action in managers
    try {
      defaultContinuationManager.cancelAction(action.id, 'Request declined by caretaker');
    } catch (cancelErr) {
      console.warn('[Guardrail UI] Continuation cancellation notice:', cancelErr);
    }
    try {
      defaultInterceptionController.cancelAction(action.id, 'Request declined by caretaker');
    } catch (ctrlErr) {
      console.warn('[Guardrail UI] Interception cancellation notice:', ctrlErr);
    }

    // 3. Stop status polling since terminal rejection state reached
    stopWarningStatusPolling();
  } else if (status === ApprovalStatus.CANCELLED) {
    activeApprovalSession.status = 'cancelled';
    void defaultRecoveryManager.clearRecovery(action.id);
    stopWarningStatusPolling();
    dismissPendingApprovalPill();

    try {
      defaultContinuationManager.cancelAction(action.id, 'Request cancelled');
    } catch {}

    updateWaitingScreenStatus('cancelled', {
      requestId,
      submittedAt: activeApprovalSession.submittedAt,
    });
  } else if (status === ApprovalStatus.EXPIRED) {
    activeApprovalSession.status = 'expired';
    void defaultRecoveryManager.clearRecovery(action.id);
    stopWarningStatusPolling();
    dismissPendingApprovalPill();

    try {
      defaultContinuationManager.cancelAction(action.id, 'Approval request expired');
    } catch {}

    updateWaitingScreenStatus('expired', {
      requestId,
      submittedAt: activeApprovalSession.submittedAt,
    });
  }
}

function startWaitingStatusPolling(requestId: string, action: GuardrailAction): void {
  stopWarningStatusPolling();

  try {
    const syncClient = new ApprovalStatusSyncClient({
      defaultIntervalMs: 2000,
      tokenProvider: () => getStoredWardToken(),
    });

    activeWarningSyncSub = syncClient.startSync(requestId, {
      onStatusChange: (newStatus, result) => {
        console.log(`[Guardrail UI] Status synchronization event for ${requestId}: ${newStatus}`);
        handleAuthoritativeApprovalResolution(requestId, action, newStatus, result.request);
      },

      onTerminal: (terminalStatus, result) => {
        console.log(`[Guardrail UI] Status synchronization terminal event for ${requestId}: ${terminalStatus}`);
        handleAuthoritativeApprovalResolution(requestId, action, terminalStatus, result.request);
      },

      onReconnecting: (attempt, maxAttempts, error) => {
        console.warn(`[Guardrail UI] Real-time sync reconnecting (attempt ${attempt}/${maxAttempts})...`);
        if (activeApprovalSession && (activeApprovalSession.status === 'pending' || activeApprovalSession.status === 'under_review')) {
          updateWaitingScreenStatus(activeApprovalSession.status, {
            requestId,
            connectionStatus: 'reconnecting',
            connectionMessage: `Connection interrupted • Reconnecting (${attempt}/${maxAttempts})...`,
            submittedAt: activeApprovalSession.submittedAt,
          });
          updatePendingApprovalPill('reconnecting');
        }
      },

      onReconnected: () => {
        console.log('[Guardrail UI] Real-time sync restored.');
        if (activeApprovalSession && (activeApprovalSession.status === 'pending' || activeApprovalSession.status === 'under_review')) {
          updateWaitingScreenStatus(activeApprovalSession.status, {
            requestId,
            connectionStatus: 'connected',
            submittedAt: activeApprovalSession.submittedAt,
          });
          updatePendingApprovalPill(activeApprovalSession.status);
        }
      },

      onError: (error, result) => {
        console.warn('[Guardrail UI] Real-time sync connection notice:', error?.message);
        // Fallback: poll via background service worker to bypass cross-origin/mixed-content limitations
        void dispatchGetApprovalStatusToBackground(requestId, action.id).then((bgResponse) => {
          if (!activeApprovalSession || activeApprovalSession.action.id !== action.id) {
            return;
          }
          if (bgResponse.success && bgResponse.request) {
            const bgStatus = bgResponse.request.status as ApprovalStatus;
            if (bgStatus && bgStatus !== ApprovalStatus.PENDING) {
              handleAuthoritativeApprovalResolution(requestId, action, bgStatus, bgResponse.request);
              return;
            }
          }
          if (activeApprovalSession && (activeApprovalSession.status === 'pending' || activeApprovalSession.status === 'under_review')) {
            updateWaitingScreenStatus(activeApprovalSession.status, {
              requestId,
              connectionStatus: 'offline',
              connectionMessage: 'Sync temporarily unavailable • Action remains safely held',
              submittedAt: activeApprovalSession.submittedAt,
            });
            updatePendingApprovalPill('offline');
          }
        }).catch(() => {
          if (activeApprovalSession && (activeApprovalSession.status === 'pending' || activeApprovalSession.status === 'under_review')) {
            updateWaitingScreenStatus(activeApprovalSession.status, {
              requestId,
              connectionStatus: 'offline',
              connectionMessage: 'Sync temporarily unavailable • Action remains safely held',
              submittedAt: activeApprovalSession.submittedAt,
            });
            updatePendingApprovalPill('offline');
          }
        });
      },
    });

    // Fallback background polling timer:
    // Ensures status synchronization continues unimpeded even if content-script direct fetch/SSE
    // is blocked by browser mixed-content (HTTPS page connecting to local HTTP backend)
    activeBackgroundPollTimer = setInterval(() => {
      if (
        !activeApprovalSession ||
        (activeApprovalSession.status !== 'pending' && activeApprovalSession.status !== 'under_review')
      ) {
        if (activeBackgroundPollTimer) {
          clearInterval(activeBackgroundPollTimer);
          activeBackgroundPollTimer = null;
        }
        return;
      }

      void dispatchGetApprovalStatusToBackground(requestId, action.id).then((bgResponse) => {
        if (!activeApprovalSession || activeApprovalSession.action.id !== action.id) {
          return;
        }
        if (bgResponse.success && bgResponse.request) {
          const bgStatus = bgResponse.request.status as ApprovalStatus;
          if (bgStatus && bgStatus !== ApprovalStatus.PENDING) {
            console.log(`[Guardrail UI] Background polling fallback resolved status: ${bgStatus} for ${requestId}`);
            handleAuthoritativeApprovalResolution(requestId, action, bgStatus, bgResponse.request);
          }
        }
      }).catch(() => {});
    }, 2000);
  } catch (err) {
    console.warn('[Guardrail UI] Failed to initiate approval status sync:', err);
  }
}

/**
 * Minimizes the waiting interface to a floating status pill when the user closes the modal.
 * Preserves the held navigation and keeps background status synchronization active.
 */
function handleCloseWaiting(
  action: GuardrailAction,
  risk: RiskAssessment,
  decision: ResponseDecision,
  classification?: ActionClassificationResult
): void {
  console.log(
    `[Guardrail UI] Waiting modal closed (minimized to floating pill). Approval request [${activeApprovalSession?.requestId || action.id}] remains PENDING and action held.`
  );
  showPendingApprovalPill({
    domain: action.page?.domain || (typeof window !== 'undefined' ? window.location.hostname : 'External Domain'),
    requestId: activeApprovalSession?.requestId || undefined,
    status: activeApprovalSession?.status || 'pending',
    onOpen: () => {
      dismissPendingApprovalPill();
      reopenWaitingModal(action, risk, decision, classification);
    },
    onCancel: () => {
      void handleCancelApproval(action);
    },
    onDismiss: () => {
      // Floating pill dismissed; action remains safely held in memory
    },
  });
}

/**
 * Handles user cancellation from warning dialogs.
 * If the action is an external navigation away from the current website ("Cancel & Leave"),
 * it exits the site safely to protect the user from malicious navigation.
 * If the action is an in-page button click or interaction ("Cancel & Stay"), it cancels the
 * held action and safely dismisses the modal, allowing the user to stay on the current website.
 */
function handleModalCancel(action: GuardrailAction): void {
  console.log(`[Guardrail UI] Handling modal cancellation for action: ${action.id}`);
  stopWarningStatusPolling();
  dismissPendingApprovalPill();
  void defaultRecoveryManager.clearRecovery(action.id);

  // 1. Safely cancel held action in continuation manager and interception controller
  try {
    defaultContinuationManager.cancelAction(action.id, 'Action cancelled by user.');
  } catch (err) {
    console.warn('[Guardrail UI] Continuation cancellation notice:', err);
  }
  try {
    defaultInterceptionController.cancelAction(action.id, 'Action cancelled by user.');
  } catch (err) {
    console.warn('[Guardrail UI] Interception cancellation notice:', err);
  }

  // 2. Only exit the website if this was an external navigation ("Cancel & Leave")
  const isExternalNav = isExternalNavigationAction(action);
  if (isExternalNav) {
    console.log(`[Guardrail UI] External navigation cancelled (Cancel & Leave) -> performing safe site exit`);
    performSafeSiteExit();
  } else {
    console.log(`[Guardrail UI] In-page button or interaction cancelled (Cancel & Stay) -> staying safely on website`);
  }
}

/**
 * Re-opens the waiting screen modal directly in waiting state when the user clicks the floating pill.
 */
function reopenWaitingModal(
  action: GuardrailAction,
  risk: RiskAssessment,
  decision: ResponseDecision,
  classification?: ActionClassificationResult
): void {
  dismissPendingApprovalPill();
  showWarningModal({
    action,
    risk,
    decision,
    initialState: 'waiting',
    onCloseWaiting: () => handleCloseWaiting(action, risk, decision, classification),
    onCancelRequest: () => {
      void handleCancelApproval(action);
    },
    onCancel: () => {
      handleModalCancel(action);
    },
  });

  if (activeApprovalSession) {
    updateWaitingScreenStatus(activeApprovalSession.status, {
      requestId: activeApprovalSession.requestId || undefined,
      submittedAt: activeApprovalSession.submittedAt,
    });
  }
}

/**
 * Explicitly cancels the pending approval request.
 * Updates backend status to CANCELLED, ensures held action is never executed,
 * and updates UI to show cancellation confirmation.
 */
async function handleCancelApproval(action: GuardrailAction): Promise<void> {
  console.log(`[Guardrail UI] Cancelling approval request for action: ${action.id}`);
  stopWarningStatusPolling();
  dismissPendingApprovalPill();

  const reqId = activeApprovalSession?.requestId;
  if (activeApprovalSession) {
    activeApprovalSession.status = 'cancelled';
  }
  void defaultRecoveryManager.clearRecovery(action.id);

  // 1. Dispatch explicit cancellation message to background service worker
  if (reqId) {
    try {
      await dispatchCancelApprovalRequestToBackground(
        reqId,
        action.id,
        'User explicitly cancelled approval request from waiting interface.'
      );
    } catch (err) {
      console.warn('[Guardrail UI] Background cancellation dispatch warning:', err);
    }
  }

  // 2. Safely cancel held action in continuation manager and interception controller
  try {
    defaultContinuationManager.cancelAction(action.id, 'Approval request cancelled by user.');
  } catch {}
  try {
    defaultInterceptionController.cancelAction(action.id, 'Approval request cancelled by user.');
  } catch {}

  // 3. Update UI to show cancellation confirmation state
  updateWaitingScreenStatus('cancelled', {
    requestId: reqId || undefined,
    submittedAt: activeApprovalSession?.submittedAt,
  });
}

/**
 * Displays the Guardrail Warning Dialog with comprehensive Caretaker Approval workflow.
 */
function formatApprovalSubmissionFailure(error?: { code?: string; message?: string }): string {
  if (error?.code === 'RUNTIME_UNAVAILABLE') {
    return 'Guardrail was updated or reloaded. Refresh this tab to reconnect before sending requests.';
  }
  if (error?.code === 'UNAUTHENTICATED') {
    return 'Sign in via the Guardrail extension popup to deliver requests to your caretaker.';
  }
  if (error?.code === 'NO_ACTIVE_TRUSTED_CONTACT') {
    return 'No active caretaker is connected to your Guardrail account yet.';
  }
  if (error?.message && error.message.trim()) {
    return error.message.trim();
  }
  return 'Could not deliver request to your caretaker dashboard • Action remains safely held.';
}

function dispatchBackendApprovalAndPoll(
  action: GuardrailAction,
  risk: RiskAssessment,
  stagingContext: StagingActionContext
): void {
  const reportSubmissionFailure = (error?: { code?: string; message?: string }) => {
    if (!activeApprovalSession || activeApprovalSession.action.id !== action.id) {
      return;
    }
    activeApprovalSession.status = 'failed';
    const isRuntimeDisconnected = error?.code === 'RUNTIME_UNAVAILABLE';
    updateWaitingScreenStatus('failed', {
      reason: formatApprovalSubmissionFailure(error),
      submittedAt: activeApprovalSession.submittedAt,
      onRetry: () => {
        if (isRuntimeDisconnected && typeof window !== 'undefined') {
          window.location.reload();
          return;
        }
        if (!activeApprovalSession || activeApprovalSession.action.id !== action.id) return;
        activeApprovalSession.status = 'pending';
        updateWaitingScreenStatus('pending', {
          submittedAt: activeApprovalSession.submittedAt,
        });
        dispatchBackendApprovalAndPoll(action, risk, stagingContext);
      },
    });
  };

  dispatchSubmitApprovalRequestToBackground(action.id, stagingContext)
    .then((response) => {
      console.log('[Guardrail UI] Caretaker approval request dispatched to backend:', response);
      if (!activeApprovalSession || activeApprovalSession.action.id !== action.id) {
        return;
      }

      if (response && response.success && response.request && response.request.id) {
        const reqId = response.request.id;
        activeApprovalSession.requestId = reqId;
        activeApprovalSession.status = 'pending';

        updateWaitingScreenStatus('pending', {
          requestId: reqId,
          submittedAt: activeApprovalSession.submittedAt,
        });
        startWaitingStatusPolling(reqId, action);

        const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
        const domain = typeof window !== 'undefined' && window.location?.hostname ? window.location.hostname : '';
        const pageUrl = typeof window !== 'undefined' && window.location?.href ? window.location.href : '';
        const destUrl = action.element?.targetUrl || action.element?.formAction || pageUrl;

        void defaultRecoveryManager.saveStagedAction({
          actionId: action.id,
          requestId: reqId,
          origin,
          url: pageUrl,
          domain,
          description: latestStagingContext?.description || action.description || 'Action awaiting caretaker review',
          category: action.category,
          riskLevel: risk.riskLevel,
          status: 'pending',
          destinationUrl: destUrl,
          elementId: action.element?.id,
        });
        return;
      }

      console.warn('[Guardrail UI] Approval delivery rejected or incomplete:', response);
      reportSubmissionFailure(response?.error);
    })
    .catch((err) => {
      console.warn('[Guardrail UI] Caretaker approval backend dispatch failed:', err);
      reportSubmissionFailure({
        message: err instanceof Error ? err.message : undefined,
      });
    });
}

function presentWarningWithApproval(
  action: GuardrailAction,
  risk: RiskAssessment,
  decision: ResponseDecision,
  classification?: ActionClassificationResult
): void {
  // Never present warning modals on the Trusted Contact Portal Dashboard or internal pages
  if (isDashboardOrInternalPage()) {
    return;
  }

  showWarningModal({
    action,
    risk,
    decision,
    onCloseWaiting: () => handleCloseWaiting(action, risk, decision, classification),
    onCancelRequest: () => {
      void handleCancelApproval(action);
    },
    onRequestApproval: () => {
      if (
        activeApprovalSession &&
        activeApprovalSession.action.id === action.id &&
        (activeApprovalSession.status === 'pending' || activeApprovalSession.status === 'under_review')
      ) {
        console.warn(`[Guardrail UI] Caretaker approval is already pending for action: ${action.id}. Duplicate submission ignored.`);
        return;
      }
      console.log(`[Guardrail UI] User clicked Request Approval for caretaker review on action: ${action.id}`);
      try {
        // 1. Register & hold action in InterceptionController so it is recognized for approval
        let heldRecord = defaultInterceptionController.getRecord(action.id);
        if (!heldRecord) {
          defaultInterceptionController.register(action, 'External navigation warned; awaiting caretaker approval.');
          heldRecord = defaultInterceptionController.holdAction(
            action.id,
            'External navigation intercepted; user requested caretaker approval.'
          );
        } else if (heldRecord.state !== InterceptionState.HELD) {
          heldRecord = defaultInterceptionController.holdAction(
            action.id,
            'External navigation intercepted; user requested caretaker approval.'
          );
        }

        // 2. Build staging context
        const stagingContext = createStagingActionContext({
          action,
          interception: heldRecord,
          risk,
          classification,
          decision,
        });
        latestStagingContext = stagingContext;

        activeApprovalSession = {
          action,
          risk,
          decision,
          classification,
          requestId: null,
          status: 'pending',
          hasExecutedContinuation: false,
          submittedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };

        // 3. Dispatch real backend approval submission to background service worker
        dispatchBackendApprovalAndPoll(action, risk, stagingContext);

        // 4. Also dispatch local intent and DOM event for UI synchronization
        const intent = createApprovalRequestIntent(stagingContext, heldRecord);
        dispatchApprovalRequestToBackground(intent).catch(() => {});
        document.dispatchEvent(
          new CustomEvent('guardrail:approval-requested', {
            detail: { actionId: action.id, intent, isBackendConnected: true },
            bubbles: true,
          })
        );
      } catch (appErr) {
        console.warn('[Guardrail UI] Failed to prepare caretaker approval request.', appErr);
      }
    },
    onCancel: () => {
      handleModalCancel(action);
    },
  });
}

/**
 * Safely exits the current site and closes the entire tab when the user chooses "Cancel & Leave".
 * Sends a message to the background service worker to close the tab via chrome.tabs API,
 * with fallbacks to window.close() and about:blank.
 */
export function performSafeSiteExit(): void {
  console.log('[Guardrail UI] Executing full tab close (Cancel & Leave)...');

  // 1. Send message to background service worker to close this tab directly
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      chrome.runtime.sendMessage({ type: 'GUARDRAIL_CLOSE_CURRENT_TAB' }, () => {
        // Callback if acknowledged before closure
      });
    } catch {
      // Ignore if runtime disconnected
    }
  }

  if (typeof window === 'undefined') return;

  // 2. Direct DOM window.close() call
  try {
    window.close();
  } catch {
    // Ignore error if not script-closable
  }

  // 3. Fallback: navigate away from the current website to an empty safe location
  setTimeout(() => {
    try {
      if (typeof window !== 'undefined' && window.location) {
        window.location.replace('about:blank');
      }
    } catch {
      window.location.href = 'about:blank';
    }
  }, 100);
}

let cancelHeldAction: (targetActionId?: string) => CancellationResult = (targetActionId) => {
  const held = defaultContinuationManager.getCurrentHeldAction();
  const actionId = targetActionId || held?.action.id;
  if (!actionId) {
    return {
      success: false,
      actionId: '',
      error: 'No action is currently in HELD state. Cannot cancel.',
    };
  }
  return defaultContinuationManager.cancelAction(
    actionId,
    'Action cancelled by user in Guardrail Staging Mode.'
  );
};

/**
 * Sanitizes plain text for safe insertion into HTML strings.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats pipeline evaluation results for clean development logging.
 */
function logPipelineResult(
  action: GuardrailAction,
  classification: ActionClassificationResult,
  risk: RiskAssessment,
  decision: ResponseDecision
): void {
  console.log(
    '%c[Guardrail Pipeline]%c EVALUATION SUMMARY',
    'color: #0ea5e9; font-weight: bold; padding: 2px 6px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    sanitizeForDiagnostics({
      actionId: action.id,
      actionType: action.type,
      category: classification.category,
      riskLevel: risk.riskLevel,
      riskScore: risk.score,
      response: decision.response,
    })
  );
}

export interface ControlledTestDisplayParams {
  response: ResponseAction;
  risk: RiskAssessment;
  decision: ResponseDecision;
  record?: InterceptionRecord;
}

/**
 * Visibly reflects the pipeline evaluation and interception status on our controlled test page.
 */
function updateControlledTestPageDisplay(
  action: GuardrailAction,
  params: ControlledTestDisplayParams
): void {
  if (typeof document === 'undefined') return;

  const statusEl = document.getElementById('interception-status-result');
  const detailsEl = document.getElementById('interception-details');
  const devMessageEl = document.getElementById('interception-dev-message');

  switch (params.response) {
    case ResponseAction.ALLOW: {
      if (statusEl) {
        statusEl.textContent = 'ALLOWED (Normal Execution Permitted)';
        statusEl.setAttribute('data-response', ResponseAction.ALLOW);
        statusEl.setAttribute('data-action-id', action.id);
        statusEl.removeAttribute('data-interception-state');
        statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
        statusEl.style.color = '#34d399';
        statusEl.style.borderColor = 'rgba(16, 185, 129, 0.5)';
      }
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Response] actionId: ${action.id} | response: ALLOW | risk: ${params.risk.riskLevel} (score: ${params.risk.score}) | intercepted: false | normal page handler executed`;
        detailsEl.style.display = 'block';
      }
      if (devMessageEl) {
        devMessageEl.style.display = 'none';
      }
      const continueBtnAllow = document.getElementById('btn-continue-test-action') as HTMLButtonElement | null;
      const cancelBtnAllow = document.getElementById('btn-cancel-test-action') as HTMLButtonElement | null;
      const indicatorElAllow = document.getElementById('held-action-indicator');
      if (continueBtnAllow) {
        continueBtnAllow.disabled = true;
        continueBtnAllow.style.opacity = '0.5';
        continueBtnAllow.style.cursor = 'not-allowed';
      }
      if (cancelBtnAllow) {
        cancelBtnAllow.disabled = true;
        cancelBtnAllow.style.opacity = '0.5';
        cancelBtnAllow.style.cursor = 'not-allowed';
      }
      if (indicatorElAllow) {
        indicatorElAllow.textContent = 'No action held';
        indicatorElAllow.style.color = '#64748b';
      }
      try {
        document.dispatchEvent(
          new CustomEvent('guardrail:action-allowed', {
            detail: {
              actionId: action.id,
              action,
              risk: params.risk,
              decision: params.decision,
            },
            bubbles: true,
          })
        );
      } catch (err) {
        console.warn('[Guardrail Content] Failed to dispatch custom allowed event.');
      }
      break;
    }

    case ResponseAction.ADVISE: {
      if (statusEl) {
        statusEl.textContent = 'ADVISED (Non-blocking Advisory Displayed - Not Held)';
        statusEl.setAttribute('data-response', ResponseAction.ADVISE);
        statusEl.setAttribute('data-action-id', action.id);
        statusEl.removeAttribute('data-interception-state');
        statusEl.style.background = 'rgba(59, 130, 246, 0.15)';
        statusEl.style.color = '#60a5fa';
        statusEl.style.borderColor = 'rgba(59, 130, 246, 0.5)';
      }
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Response] actionId: ${action.id} | response: ADVISE | risk: ${params.risk.riskLevel} (score: ${params.risk.score}) | non-blocking advisory active | action not held | normal execution permitted`;
        detailsEl.style.display = 'block';
      }
      if (devMessageEl) {
        devMessageEl.style.display = 'none';
      }
      const continueBtnAdvise = document.getElementById('btn-continue-test-action') as HTMLButtonElement | null;
      const cancelBtnAdvise = document.getElementById('btn-cancel-test-action') as HTMLButtonElement | null;
      const indicatorElAdvise = document.getElementById('held-action-indicator');
      if (continueBtnAdvise) {
        continueBtnAdvise.disabled = true;
        continueBtnAdvise.style.opacity = '0.5';
        continueBtnAdvise.style.cursor = 'not-allowed';
      }
      if (cancelBtnAdvise) {
        cancelBtnAdvise.disabled = true;
        cancelBtnAdvise.style.opacity = '0.5';
        cancelBtnAdvise.style.cursor = 'not-allowed';
      }
      if (indicatorElAdvise) {
        indicatorElAdvise.textContent = 'No action held';
        indicatorElAdvise.style.color = '#64748b';
      }
      try {
        document.dispatchEvent(
          new CustomEvent('guardrail:action-advised', {
            detail: {
              actionId: action.id,
              action,
              risk: params.risk,
              decision: params.decision,
            },
            bubbles: true,
          })
        );
      } catch (err) {
        console.warn('[Guardrail Content] Failed to dispatch custom advised event.');
      }
      break;
    }

    case ResponseAction.WARN: {
      if (statusEl) {
        statusEl.textContent = 'WARNED (Advisory Modal Displayed - Not Held)';
        statusEl.setAttribute('data-response', ResponseAction.WARN);
        statusEl.setAttribute('data-action-id', action.id);
        statusEl.removeAttribute('data-interception-state');
        statusEl.style.background = 'rgba(245, 158, 11, 0.15)';
        statusEl.style.color = '#fbbf24';
        statusEl.style.borderColor = 'rgba(245, 158, 11, 0.5)';
      }
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Response] actionId: ${action.id} | response: WARN | risk: ${params.risk.riskLevel} (score: ${params.risk.score}) | advisory warning active | action not held | no interception record created`;
        detailsEl.style.display = 'block';
      }
      if (devMessageEl) {
        devMessageEl.style.display = 'none';
      }
      const continueBtnWarn = document.getElementById('btn-continue-test-action') as HTMLButtonElement | null;
      const cancelBtnWarn = document.getElementById('btn-cancel-test-action') as HTMLButtonElement | null;
      const indicatorElWarn = document.getElementById('held-action-indicator');
      if (continueBtnWarn) {
        continueBtnWarn.disabled = true;
        continueBtnWarn.style.opacity = '0.5';
        continueBtnWarn.style.cursor = 'not-allowed';
      }
      if (cancelBtnWarn) {
        cancelBtnWarn.disabled = true;
        cancelBtnWarn.style.opacity = '0.5';
        cancelBtnWarn.style.cursor = 'not-allowed';
      }
      if (indicatorElWarn) {
        indicatorElWarn.textContent = 'No action held';
        indicatorElWarn.style.color = '#64748b';
      }
      try {
        document.dispatchEvent(
          new CustomEvent('guardrail:action-warned', {
            detail: {
              actionId: action.id,
              action,
              risk: params.risk,
              decision: params.decision,
            },
            bubbles: true,
          })
        );
      } catch (err) {
        console.warn('[Guardrail Content] Failed to dispatch custom warned event.');
      }
      break;
    }

    case ResponseAction.PROTECT: {
      const state = params.record?.state || 'HELD';
      if (statusEl) {
        statusEl.textContent = `PROTECTED (${state}) - Waiting for Decision`;
        statusEl.setAttribute('data-response', ResponseAction.PROTECT);
        statusEl.setAttribute('data-interception-state', state);
        statusEl.setAttribute('data-action-id', action.id);
        statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
        statusEl.style.color = '#f87171';
        statusEl.style.borderColor = 'rgba(239, 68, 68, 0.5)';
      }
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Protection] actionId: ${action.id} | state: ${state} | risk: ${params.risk.riskLevel} (score: ${params.risk.score}) | normal page handler prevented: true | WAITING FOR PROTECTION DECISION`;
        detailsEl.style.display = 'block';
      }
      if (devMessageEl) {
        const isFormSubmit = action.type === ActionType.SUBMIT;
        const formDestText = isFormSubmit && action.element?.formAction ? ` to <code>${escapeHtml(action.element.formAction)}</code>` : '';
        const actionDesc = isFormSubmit ? `Form submission${formDestText} (Action <code>${escapeHtml(action.id)}</code>)` : `Action <code>${escapeHtml(action.id)}</code>`;
        const extraNote = isFormSubmit ? ' Form submission was halted. Sensitive form values are never collected or stored. Form will not be automatically resubmitted upon approval.' : '';
        devMessageEl.innerHTML = `<strong>🛡️ Guardrail Development Notice:</strong> ${actionDesc} has been intercepted and transitioned to <strong>HELD</strong>. This action is waiting for a protection decision.${extraNote} Use the controls below to Continue or Cancel.`;
        devMessageEl.style.display = 'block';
        devMessageEl.style.background = 'rgba(239, 68, 68, 0.1)';
        devMessageEl.style.borderLeftColor = '#ef4444';
        devMessageEl.style.color = '#fca5a5';
      }
      const continueBtnProtect = document.getElementById('btn-continue-test-action') as HTMLButtonElement | null;
      const cancelBtnProtect = document.getElementById('btn-cancel-test-action') as HTMLButtonElement | null;
      const indicatorElProtect = document.getElementById('held-action-indicator');
      if (continueBtnProtect) {
        continueBtnProtect.disabled = false;
        continueBtnProtect.style.opacity = '1';
        continueBtnProtect.style.cursor = 'pointer';
      }
      if (cancelBtnProtect) {
        cancelBtnProtect.disabled = false;
        cancelBtnProtect.style.opacity = '1';
        cancelBtnProtect.style.cursor = 'pointer';
      }
      if (indicatorElProtect) {
        indicatorElProtect.textContent = `Action HELD: ${action.id}`;
        indicatorElProtect.style.color = '#f87171';
      }
      try {
        document.dispatchEvent(
          new CustomEvent('guardrail:action-intercepted', {
            detail: {
              actionId: action.id,
              action,
              risk: params.risk,
              decision: params.decision,
              record: params.record,
            },
            bubbles: true,
          })
        );
      } catch (err) {
        console.warn('[Guardrail Content] Failed to dispatch custom intercepted event.');
      }
      break;
    }
  }
}

/**
 * Bootstraps the Guardrail Content Script runtime and Action Detector.
 */
function bootstrap(): void {
  // 0. Exemption for Guardrail Trusted Contact Portal & Internal Pages
  if (isDashboardOrInternalPage()) {
    console.log(
      '[Guardrail Content] Guardrail Trusted Contact Portal / internal page detected. Content script monitoring disabled.'
    );
    return;
  }

  const pageInfo = extractPageInfo();

  // Begin loading before detection starts. While the result is pending, ambient
  // events are not evaluated and controlled test actions are synchronously
  // suppressed at the event boundary by the detector callback below.
  const initialConfigLoad = loadPolicyConfigFromStorage();
  void initialConfigLoad.then((result) => {
    if (result.healthStatus === ConfigHealthStatus.FAILED) {
      console.warn('[Guardrail Content] Initial policy configuration load failed; policy enforcement is fail-closed.');
    }
  }).catch(() => {
    console.warn('[Guardrail Content] Initial policy configuration load failed; policy enforcement is fail-closed.');
  });

  // Listen for storage changes across tabs to keep policy configuration synchronized
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[GUARDRAIL_POLICY_CONFIG_STORAGE_KEY]) {
        void initialConfigLoad.then(() => reloadPolicyConfig()).catch(() => {
          console.warn('[Guardrail Content] Policy configuration reload failed; check configuration health status.');
        });
      }
    });
  }

  console.log(
    '%c[Guardrail Content]%c End-to-End Pipeline (Event → Detector → Classifier → Risk → Response) initialized',
    'color: #0ea5e9; font-weight: bold; padding: 2px 4px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    {
      url: pageInfo.url,
      title: pageInfo.title,
      documentState: document.readyState,
      timestamp: new Date().toISOString(),
    }
  );

  // Instantiate the unified ActionDetector with classification, risk, response & interception pipeline
  const detector = new ActionDetector(
    // 1. Passive / ambient handler for standard page interactions
    (action) => {
      // Do not evaluate a possibly stale/default policy while the initial read is pending.
      if (!isPolicyConfigurationInitialized(getConfigHealthStatus())) return;

      // 1. Centralized pipeline evaluation (classification -> prioritized risk rules -> deterministic response precedence)
      const { classification, risk, decision } = evaluateActionPipeline(action);

      // 2. Output standardized development log
      logPipelineResult(action, classification, risk, decision);

      // 3. Branch on ResponseAction:
      switch (decision.response) {
        case ResponseAction.ALLOW:
          console.log(`[Guardrail Response] ALLOW: Action permitted. Prototype flow continues.`);
          break;

        case ResponseAction.ADVISE:
          console.log(`[Guardrail Response] ADVISE: Displaying non-blocking advisory notice. Browsing continues.`);
          showAdvisoryNotice({ action, risk, decision });
          break;

        case ResponseAction.WARN:
          console.log(`[Guardrail Response] WARN: Displaying Guardrail warning UI with Caretaker Approval option.`);
          presentWarningWithApproval(action, risk, decision, classification);
          break;

        case ResponseAction.PROTECT:
          console.warn(
            `[Guardrail Sensor Limitation] 🛡️ PROTECT decision rendered for ambient action [${action.id}], but ambient page interactions cannot be synchronously intercepted or held without controlled test hooks ([${GUARDRAIL_TEST_ACTION_ATTR}]). Reporting architectural limitation: action was NOT held.`
          );
          break;
      }

      // 4. Forward complete pipeline artifact to background service worker coordinator
      dispatchActionToBackground(action, classification, risk, decision);
    },
    // 2. Active Interception Handler for explicitly marked controlled test actions
    (action, element, event) => {
      const testAttr = element.getAttribute(GUARDRAIL_TEST_ACTION_ATTR) || 'controlled-test-action';

      try {
        // Ignore synthetic events dispatched on detached controls. They cannot represent
        // an active page control, and must not create resumable staging state.
        if (!element.isConnected) {
          event.preventDefault();
          event.stopImmediatePropagation();
          console.warn('[Guardrail Interception] Suppressed event on detached controlled test element; no action was staged.');
          return;
        }

        if (cancelControlledActionUntilPolicyInitialized(getConfigHealthStatus(), event)) {
          console.warn('[Guardrail Interception] Controlled action was synchronously suppressed while policy configuration initializes; retry after initialization.');
          if (typeof document !== 'undefined') {
            const statusEl = document.getElementById('interception-status-result');
            const detailsEl = document.getElementById('interception-details');
            if (statusEl) {
              statusEl.textContent = 'INITIALIZING (Action Suppressed - Retry After Initialization)';
              statusEl.style.background = 'rgba(245, 158, 11, 0.15)';
              statusEl.style.color = '#fbbf24';
              statusEl.style.borderColor = 'rgba(245, 158, 11, 0.5)';
            }
            if (detailsEl) {
              detailsEl.textContent =
                '[Guardrail Policy] Policy configuration is initializing. Controlled action was synchronously suppressed to prevent unverified execution. Please retry your action after initialization completes.';
              detailsEl.style.display = 'block';
            }
          }
          return;
        }

        // Repeated event & duplicate staging prevention:
        // If an action is already in HELD or active staging state, synchronously cancel the event
        // to prevent unrestricted execution, and prevent duplicate staging operations from overwriting state.
        const currentHeld = defaultContinuationManager.getCurrentHeldAction();
        if (currentHeld) {
          const existingRecord = defaultInterceptionController.getRecord(currentHeld.action.id);
          if (
            existingRecord &&
            (existingRecord.state === InterceptionState.HELD ||
              existingRecord.state === InterceptionState.AWAITING_APPROVAL ||
              existingRecord.state === InterceptionState.READY_FOR_USER_CONFIRMATION)
          ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            console.warn(
              `[Guardrail Interception] Synchronously suppressed repeated event: Action [${currentHeld.action.id}] is already held in Staging Mode. Duplicate staging operation prevented.`
            );
            return;
          }
        }

        // 1. Centralized pipeline evaluation (classification -> prioritized risk rules -> deterministic response precedence)
        const { classification, risk, decision } = evaluateActionPipeline(action);

        // Log pipeline result for development visibility
        logPipelineResult(action, classification, risk, decision);

        // 2. Branch strictly based on the response decision:
        switch (decision.response) {
          case ResponseAction.ALLOW: {
            // ALLOW:
            // * Do not intercept the action.
            // * Allow the controlled website handler to execute normally.
            // * Do not create an unnecessary interception record.
            console.log(
              `%c[Guardrail Interception]%c ACTION ALLOWED (Score: ${risk.score})\n` +
              `ACTION: ${action.type}\n` +
              `ACTION ID: ${action.id}\n` +
              `DECISION: ALLOW - Action proceeds without interception. Normal page handler permitted.`,
              'color: #10b981; font-weight: bold; padding: 2px 6px; background: rgba(16, 185, 129, 0.1); border-radius: 3px;',
              'color: inherit; font-weight: normal;'
            );

            updateControlledTestPageDisplay(action, {
              response: ResponseAction.ALLOW,
              risk,
              decision,
            });

            // If the navigation event was halted by pre-navigation check, allow it to proceed now
            const allowDestUrl = action.element?.targetUrl;
            if (
              allowDestUrl &&
              typeof window !== 'undefined' &&
              event.defaultPrevented &&
              !element.hasAttribute(GUARDRAIL_TEST_ACTION_ATTR)
            ) {
              window.location.href = allowDestUrl;
            }

            // Forward pipeline evaluation to background coordinator (without interception record)
            dispatchActionToBackground(action, classification, risk, decision);
            break;
          }

          case ResponseAction.ADVISE: {
            console.log(
              `%c[Guardrail Interception]%c ACTION ADVISED (Score: ${risk.score})\n` +
              `ACTION: ${action.type}\n` +
              `ACTION ID: ${action.id}\n` +
              `DECISION: ADVISE - Displaying non-blocking advisory notice without interception. Action is not held.`,
              'color: #3b82f6; font-weight: bold; padding: 2px 6px; background: rgba(59, 130, 246, 0.1); border-radius: 3px;',
              'color: inherit; font-weight: normal;'
            );

            updateControlledTestPageDisplay(action, {
              response: ResponseAction.ADVISE,
              risk,
              decision,
            });

            showAdvisoryNotice({ action, risk, decision });

            // If the navigation event was halted by pre-navigation check, allow it to proceed now
            const adviseDestUrl = action.element?.targetUrl;
            if (
              adviseDestUrl &&
              typeof window !== 'undefined' &&
              event.defaultPrevented &&
              !element.hasAttribute(GUARDRAIL_TEST_ACTION_ATTR)
            ) {
              window.location.href = adviseDestUrl;
            }

            // Forward pipeline evaluation to background coordinator (without interception record)
            dispatchActionToBackground(action, classification, risk, decision);
            break;
          }

          case ResponseAction.WARN: {
            // Synchronously halt event propagation if opening an untrusted web destination
            const dest = action.element?.targetUrl || action.element?.formAction;
            if (dest && isUntrustedWebDestination(dest)) {
              try {
                event.preventDefault();
                event.stopImmediatePropagation();
              } catch {}
            }

            // WARN:
            // * Preserve the existing Guardrail warning behavior.
            // * Do not treat WARN as authorization to execute an already-held action.
            // * Do not create an unnecessary interception record if the action has not been held.
            console.log(
              `%c[Guardrail Interception]%c ACTION WARNED (Score: ${risk.score})\n` +
              `ACTION: ${action.type}\n` +
              `ACTION ID: ${action.id}\n` +
              `DECISION: WARN - Displaying advisory modal without creating an interception record. Action is not held.`,
              'color: #f59e0b; font-weight: bold; padding: 2px 6px; background: rgba(245, 158, 11, 0.1); border-radius: 3px;',
              'color: inherit; font-weight: normal;'
            );

            updateControlledTestPageDisplay(action, {
              response: ResponseAction.WARN,
              risk,
              decision,
            });

            presentWarningWithApproval(action, risk, decision, classification);

            // Forward pipeline evaluation to background coordinator (without interception record)
            dispatchActionToBackground(action, classification, risk, decision);
            break;
          }

          case ResponseAction.PROTECT: {
            // PROTECT:
            // * Prevent the supported test action from executing through the controlled event flow.
            event.preventDefault();
            event.stopImmediatePropagation();

            // * Create an interception record.
            defaultInterceptionController.register(
              action,
              `Controlled test action [${testAttr}] halted pending protection decision.`
            );

            // * Transition the record to HELD.
            const heldRecord = defaultInterceptionController.holdAction(
              action.id,
              'Action intercepted and held by Guardrail. Normal execution prevented; waiting for a protection decision.'
            );

            // * Build and cache StagingActionContext for Staging Mode preview
            try {
              latestStagingContext = createStagingActionContext({
                action,
                interception: heldRecord,
                risk,
                classification,
                decision,
              });
            } catch (ctxErr) {
              console.warn('[Guardrail Content] Failed to create StagingActionContext.');
            }

            // * Show a development message explaining that the action is waiting for a protection decision.
            console.log(
              `%c[Guardrail Interception]%c 🛡️ ACTION PROTECTED (HELD)\n` +
              `ACTION: ${action.type}\n` +
              `ACTION ID: ${action.id}\n` +
              `STATE: ${heldRecord.state}\n` +
              `SCORE: ${risk.score} (${risk.riskLevel})\n` +
              `DEVELOPMENT NOTICE: Action is waiting for a protection decision. Normal page execution has been halted.`,
              'color: #ef4444; font-weight: bold; padding: 2px 6px; background: rgba(239, 68, 68, 0.1); border-radius: 3px;',
              'color: inherit; font-weight: normal;',
              {
                actionId: action.id,
                actionType: action.type,
                state: heldRecord.state,
                riskLevel: risk.riskLevel,
                riskScore: risk.score,
                response: decision.response,
              }
            );

            // * Register in ContinuationManager with a controlled test-action handler
            defaultContinuationManager.registerHeldAction(
              action,
              heldRecord,
              (act) => {
                console.log(
                  `%c[Guardrail Continuation]%c EXECUTED CONTROLLED HANDLER\n` +
                  `ACTION ID: ${act.id}\n` +
                  `STATUS: Executed exactly once via explicit continuation mechanism.`,
                  'color: #10b981; font-weight: bold; padding: 2px 6px; background: rgba(16, 185, 129, 0.1); border-radius: 3px;',
                  'color: inherit; font-weight: normal;',
                  { action: act }
                );

                try {
                  document.dispatchEvent(
                    new CustomEvent('guardrail:controlled-handler-executed', {
                      detail: {
                        actionId: act.id,
                        action: act,
                        timestamp: new Date().toISOString(),
                      },
                      bubbles: true,
                    })
                  );
                } catch (err) {
                  console.warn('[Guardrail Content] Failed to dispatch controlled handler executed event.');
                }
              },
              () => element.isConnected && (!element.id || document.getElementById(element.id) === element)
            );

            updateControlledTestPageDisplay(action, {
              response: ResponseAction.PROTECT,
              risk,
              decision,
              record: heldRecord,
            });

            // Forward pipeline evaluation to background coordinator WITH the held interception record
            dispatchActionToBackground(action, classification, risk, decision, heldRecord);

            // * Automatically present warning / protection interface for user review and decision
            presentWarningWithApproval(action, risk, decision, classification);
            break;
          }
        }
      } catch (err) {
        // FAIL-CLOSED INVARIANT: Synchronously suppress the event if an interception error occurs.
        // Exceptions must not silently convert a required protective decision into an unrestricted action.
        try {
          event.preventDefault();
          event.stopImmediatePropagation();
        } catch {
          // ignore if uncancelable
        }
        console.error('[Guardrail Interception] Controlled action interception failed; action remains fail-closed.');
      }
    }
  );

  // Start ambient observation
  detector.start();

  // Page-level advisory if the active page itself is an untrusted domain
  if (typeof window !== 'undefined' && window.location && window.location.href) {
    const currentUrl = window.location.href;
    if (isUntrustedWebDestination(currentUrl) && !isDashboardOrInternalPage()) {
      console.warn(
        `[Guardrail Content] Current webpage [${currentUrl}] is an untrusted domain. Enforcing warning advisory.`
      );
      const navAction = createGuardrailAction(
        ActionType.NAVIGATION,
        null,
        typeof document !== 'undefined' ? document.referrer || undefined : undefined
      );
      const { classification, risk, decision } = evaluateActionPipeline(navAction);
      if (decision.response === ResponseAction.ADVISE) {
        showAdvisoryNotice({ action: navAction, risk, decision });
      } else if (decision.response === ResponseAction.WARN || decision.response === ResponseAction.PROTECT) {
        presentWarningWithApproval(navAction, risk, decision, classification);
      }
    }
  }

  // Initialize explicit resolution controls (Continue & Cancel)
  initResolutionControls();

  // Expose test & debugging interface
  if (typeof window !== 'undefined') {
    (window as any).__GUARDRAIL_INTERCEPTION__ = {
      controller: defaultInterceptionController,
      continuationManager: defaultContinuationManager,
      continueHeldAction: (actionId?: string) => {
        const id = actionId || defaultContinuationManager.getCurrentHeldAction()?.action.id;
        return defaultContinuationManager.continueAction(id || '');
      },
      cancelHeldAction: (actionId?: string) => {
        const id = actionId || defaultContinuationManager.getCurrentHeldAction()?.action.id;
        return defaultContinuationManager.cancelAction(id || '');
      },
      getCurrentHeldAction: () => defaultContinuationManager.getCurrentHeldAction(),
    };

    (window as any).__GUARDRAIL_STAGING__ = {
      open: (ctx?: StagingActionContext) => {
        const target = ctx || latestStagingContext;
        if (target) {
          showStagingModal({
            context: target,
            state: 'active',
            controller: defaultInterceptionController,
            continuationManager: defaultContinuationManager,
            useRealBackend: true,
            onCancel: (actionId) => cancelHeldAction(actionId),
          });
        } else {
          showStagingModal({ state: 'empty' });
        }
      },
      cancel: (actionId?: string) => {
        return cancelHeldAction(actionId);
      },
      requestApproval: async (context?: StagingActionContext) => {
        const ctx = context || latestStagingContext;
        if (!ctx) {
          return {
            success: false,
            actionId: '',
            error: 'No active staging context available to request approval.',
            isBackendConnected: true,
          };
        }
        const record = defaultInterceptionController.getRecord(ctx.actionId);
        if (!record || record.state !== InterceptionState.HELD) {
          return {
            success: false,
            actionId: ctx.actionId,
            error: `Action "${ctx.actionId}" is in state "${record?.state || 'UNKNOWN'}". Only actions in HELD state are eligible for approval requests.`,
            isBackendConnected: true,
          };
        }
        return await dispatchSubmitApprovalRequestToBackground(ctx.actionId, ctx);
      },
      dismiss: () => dismissStagingModal(),
      isActive: () => isStagingModalActive(),
      getContext: () => latestStagingContext,
    };
  }
}

/**
 * Initializes development resolution controls (Continue / Cancel) on the webpage.
 */
function initResolutionControls(): void {
  if (typeof document === 'undefined') return;

  const continueBtn = document.getElementById('btn-continue-test-action');
  const cancelBtn = document.getElementById('btn-cancel-test-action');
  const indicatorEl = document.getElementById('held-action-indicator');
  const statusEl = document.getElementById('interception-status-result');
  const detailsEl = document.getElementById('interception-details');
  const devMessageEl = document.getElementById('interception-dev-message');

  const disableControls = () => {
    if (continueBtn instanceof HTMLButtonElement) {
      continueBtn.disabled = true;
      continueBtn.style.opacity = '0.5';
      continueBtn.style.cursor = 'not-allowed';
    }
    if (cancelBtn instanceof HTMLButtonElement) {
      cancelBtn.disabled = true;
      cancelBtn.style.opacity = '0.5';
      cancelBtn.style.cursor = 'not-allowed';
    }
  };

  const handleContinue = (targetActionId?: string) => {
    const held = defaultContinuationManager.getCurrentHeldAction();
    const actionId = targetActionId || held?.action.id;

    if (!actionId) {
      console.warn('[Guardrail Continuation] Rejecting continuation: No action is currently tracked or held.');
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Continuation Rejection] No action is currently in HELD state. Cannot continue.`;
        detailsEl.style.display = 'block';
      }
      return;
    }

    // Context & DOM Attachment Guard: Verify target element is still attached to the active DOM
    if (held?.action?.element?.id && typeof document !== 'undefined') {
      const el = document.getElementById(held.action.element.id);
      if (!el) {
        const err = `Target element "#${held.action.element.id}" is no longer attached to document DOM tree. Cannot continue detached action.`;
        console.warn('[Guardrail Continuation] Request rejected due to a validation error.');
        defaultContinuationManager.invalidateHeldAction(actionId, err);
        latestStagingContext = null;
        disableControls();
        if (isStagingModalActive()) {
          dismissStagingModal();
        }
        if (detailsEl) {
          detailsEl.textContent = `[Guardrail Continuation Rejection] ${err}`;
          detailsEl.style.display = 'block';
        }
        return;
      }
    }

    const result = defaultContinuationManager.continueAction(
      actionId,
      'Action continued via explicit development control on test website.'
    );

    if (!result.success) {
      console.warn('[Guardrail Continuation] Request rejected.');
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Continuation Rejection] ${result.error}`;
        detailsEl.style.display = 'block';
      }
      return;
    }

    // Success: Action continued and executed
    latestStagingContext = null;
    disableControls();
    if (isStagingModalActive()) {
      dismissStagingModal();
    }
    if (indicatorEl) {
      indicatorEl.textContent = `Resolved: CONTINUED (${actionId})`;
      indicatorEl.style.color = '#34d399';
    }
    if (statusEl) {
      statusEl.textContent = `CONTINUED (Executed via Controlled Continuation)`;
      statusEl.setAttribute('data-interception-state', InterceptionState.CONTINUED);
      statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
      statusEl.style.color = '#34d399';
      statusEl.style.borderColor = 'rgba(16, 185, 129, 0.5)';
    }
    if (detailsEl) {
      detailsEl.textContent = `[Guardrail Resolution] actionId: ${actionId} | state: CONTINUED | resolvedAt: ${result.record?.resolvedAt} | executionCount: ${result.executionCount} | duplicate execution prevented: true`;
      detailsEl.style.display = 'block';
    }
    if (devMessageEl) {
      devMessageEl.innerHTML = `<strong>✅ Action Continued:</strong> Action <code>${escapeHtml(actionId)}</code> has been continued and executed exactly once via the controlled continuation handler. Duplicate execution prevented.`;
      devMessageEl.style.display = 'block';
      devMessageEl.style.background = 'rgba(16, 185, 129, 0.1)';
      devMessageEl.style.borderLeftColor = '#10b981';
      devMessageEl.style.color = '#6ee7b7';
    }

    try {
      document.dispatchEvent(
        new CustomEvent('guardrail:action-continued', {
          detail: {
            actionId,
            record: result.record,
            executionCount: result.executionCount,
          },
          bubbles: true,
        })
      );
    } catch (err) {
      console.warn('[Guardrail Content] Failed to dispatch custom action-continued event.');
    }
  };

  const handleCancel = (targetActionId?: string): CancellationResult => {
    const held = defaultContinuationManager.getCurrentHeldAction();
    const actionId = targetActionId || held?.action.id;

    if (!actionId) {
      console.warn('[Guardrail Cancellation] Rejecting cancellation: No action is currently tracked or held.');
      const err = 'No action is currently in HELD state. Cannot cancel.';
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Cancellation Rejection] ${err}`;
        detailsEl.style.display = 'block';
      }
      return {
        success: false,
        actionId: '',
        error: err,
      };
    }

    const result = defaultContinuationManager.cancelAction(
      actionId,
      'Action cancelled via explicit development control on test website.'
    );

    if (!result.success) {
      console.warn('[Guardrail Cancellation] Request rejected.');
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Cancellation Rejection] ${result.error}`;
        detailsEl.style.display = 'block';
      }
      return result;
    }

    // Success: Action cancelled, handler not executed
    latestStagingContext = null;
    disableControls();
    if (isStagingModalActive() && getStagingUIState() !== 'cancelled') {
      setStagingUIState('cancelled');
    }
    if (indicatorEl) {
      indicatorEl.textContent = `Resolved: CANCELLED (${actionId})`;
      indicatorEl.style.color = '#94a3b8';
    }
    if (statusEl) {
      statusEl.textContent = `CANCELLED (Execution Aborted)`;
      statusEl.setAttribute('data-interception-state', InterceptionState.CANCELLED);
      statusEl.style.background = 'rgba(148, 163, 184, 0.15)';
      statusEl.style.color = '#94a3b8';
      statusEl.style.borderColor = 'rgba(148, 163, 184, 0.4)';
    }
    if (detailsEl) {
      detailsEl.textContent = `[Guardrail Resolution] actionId: ${actionId} | state: CANCELLED | resolvedAt: ${result.record?.resolvedAt} | handler executed: false | temporary state cleared`;
      detailsEl.style.display = 'block';
    }
    if (devMessageEl) {
      devMessageEl.innerHTML = `<strong>✕ Action Cancelled:</strong> Action <code>${escapeHtml(actionId)}</code> has been cancelled. Controlled test action was NOT executed. Temporary state cleared.`;
      devMessageEl.style.display = 'block';
      devMessageEl.style.background = 'rgba(148, 163, 184, 0.1)';
      devMessageEl.style.borderLeftColor = '#94a3b8';
      devMessageEl.style.color = '#cbd5e1';
    }

    try {
      document.dispatchEvent(
        new CustomEvent('guardrail:action-cancelled', {
          detail: {
            actionId,
            record: result.record,
          },
          bubbles: true,
        })
      );
    } catch (err) {
      console.warn('[Guardrail Content] Failed to dispatch custom action-cancelled event.');
    }

    return result;
  };

  cancelHeldAction = handleCancel;

  const handleRequestApproval = (targetActionId?: string): ApprovalRequestResult => {
    const held = defaultContinuationManager.getCurrentHeldAction();
    const actionId = targetActionId || held?.action.id || latestStagingContext?.actionId;

    if (!actionId) {
      console.warn('[Guardrail Approval] Rejecting request: No action is currently tracked or held.');
      const err = 'No action is currently in HELD state. Cannot request approval.';
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Approval Rejection] ${err}`;
        detailsEl.style.display = 'block';
      }
      return {
        success: false,
        actionId: '',
        error: err,
        isBackendConnected: false,
      };
    }

    const record = defaultInterceptionController.getRecord(actionId);
    if (!record || record.state !== InterceptionState.HELD) {
      const err = `Action "${actionId}" is in state "${record?.state || 'UNKNOWN'}". Only actions in HELD state are eligible for approval requests.`;
      console.warn('[Guardrail Approval] Request rejected due to a validation error.');
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Approval Rejection] ${err}`;
        detailsEl.style.display = 'block';
      }
      return {
        success: false,
        actionId,
        error: err,
        isBackendConnected: false,
      };
    }

    if (!latestStagingContext || latestStagingContext.actionId !== actionId) {
      const act = held?.action;
      if (act) {
        try {
          const { classification, risk, decision } = evaluateActionPipeline(act);
          latestStagingContext = createStagingActionContext({
            action: act,
            interception: record,
            risk,
            classification,
            decision,
          });
        } catch (ctxErr) {
          console.warn('[Guardrail Approval] Failed to create StagingActionContext.');
        }
      }
    }

    if (!latestStagingContext) {
      return {
        success: false,
        actionId,
        error: 'Unable to construct staging context for approval request.',
        isBackendConnected: false,
      };
    }

    const intent = createApprovalRequestIntent(latestStagingContext, record);

    // Dispatch DOM custom event
    try {
      document.dispatchEvent(
        new CustomEvent('guardrail:approval-requested', {
          detail: {
            actionId,
            intent,
            isBackendConnected: false,
          },
          bubbles: true,
        })
      );
    } catch (err) {
      console.warn('[Guardrail Content] Failed to dispatch custom approval-requested event.');
    }

    // Dispatch to background coordinator
    dispatchApprovalRequestToBackground(intent).catch(() => {
      console.warn('[Guardrail Content] Background dispatch failed.');
    });

    if (detailsEl) {
      detailsEl.textContent = `[Guardrail Approval Prototype] actionId: ${actionId} | intent created: true | backend connected: false | state: HELD`;
      detailsEl.style.display = 'block';
    }

    return {
      success: true,
      actionId,
      intent,
      isBackendConnected: false,
    };
  };

  if (continueBtn) {
    continueBtn.addEventListener('click', () => handleContinue());
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => handleCancel());
  }

  const stagingBtn = document.getElementById('btn-preview-staging-mode');
  if (stagingBtn) {
    stagingBtn.addEventListener('click', () => {
      if (latestStagingContext) {
        showStagingModal({
          context: latestStagingContext,
          state: 'active',
          controller: defaultInterceptionController,
          continuationManager: defaultContinuationManager,
          onCancel: (actionId) => handleCancel(actionId),
        });
      } else {
        showStagingModal({ state: 'empty' });
      }
    });
  }

  // Support programmatic custom events for automation/testing
  document.addEventListener('guardrail:trigger-continue', (e: Event) => {
    const custom = e as CustomEvent<{ actionId?: string }>;
    handleContinue(custom.detail?.actionId);
  });

  document.addEventListener('guardrail:trigger-cancel', (e: Event) => {
    const custom = e as CustomEvent<{ actionId?: string }>;
    handleCancel(custom.detail?.actionId);
  });

  document.addEventListener('guardrail:trigger-request-approval', (e: Event) => {
    const custom = e as CustomEvent<{ actionId?: string }>;
    handleRequestApproval(custom.detail?.actionId);
  });

  document.addEventListener('guardrail:open-staging-mode', (e: Event) => {
    const custom = e as CustomEvent<{ context?: StagingActionContext; state?: 'active' | 'loading' | 'empty' }>;
    const ctx = custom.detail?.context || latestStagingContext;
    const state = custom.detail?.state || (ctx ? 'active' : 'empty');
    showStagingModal({
      context: ctx || undefined,
      state,
      controller: defaultInterceptionController,
      continuationManager: defaultContinuationManager,
      onCancel: (actionId) => handleCancel(actionId),
    });
  });

  document.addEventListener('guardrail:dismiss-staging-mode', () => {
    dismissStagingModal();
  });

  // Listen for action continuation from Staging Mode explicit confirmation
  document.addEventListener('guardrail:action-continued', (e: Event) => {
    const custom = e as CustomEvent<{ actionId?: string; executionCount?: number; result?: any }>;
    const actionId = custom.detail?.actionId;
    if (actionId) {
      latestStagingContext = null;
      disableControls();
      if (indicatorEl) {
        indicatorEl.textContent = `Resolved: CONTINUED (${actionId})`;
        indicatorEl.style.color = '#34d399';
      }
      if (statusEl) {
        statusEl.textContent = `CONTINUED (Executed via Controlled Continuation)`;
        statusEl.setAttribute('data-interception-state', InterceptionState.CONTINUED);
        statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
        statusEl.style.color = '#34d399';
        statusEl.style.borderColor = 'rgba(16, 185, 129, 0.5)';
      }
      if (detailsEl) {
        detailsEl.textContent = `[Guardrail Resolution] actionId: ${actionId} | state: CONTINUED | controlled handler executed | duplicate execution prevented: true`;
        detailsEl.style.display = 'block';
      }
      if (devMessageEl) {
        devMessageEl.innerHTML = `<strong>✅ Action Continued:</strong> Action <code>${escapeHtml(actionId)}</code> has been continued and executed exactly once via the controlled continuation handler following explicit user confirmation.`;
        devMessageEl.style.display = 'block';
        devMessageEl.style.background = 'rgba(16, 185, 129, 0.1)';
        devMessageEl.style.borderLeftColor = '#10b981';
        devMessageEl.style.color = '#6ee7b7';
      }
    }
  });

  // Page lifecycle & navigation invalidation policy (Requirements 6 & 7)
  const handlePageDepartureOrNavigation = (reason: string) => {
    const held = defaultContinuationManager.getCurrentHeldAction();
    if (held?.action?.id) {
      defaultContinuationManager.invalidateHeldAction(
        held.action.id,
        `Held action invalidated: ${reason}`
      );
    }
    latestStagingContext = null;
    dismissStagingModal();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      handlePageDepartureOrNavigation('Page unloaded / beforeunload');
    });

    window.addEventListener('pagehide', () => {
      handlePageDepartureOrNavigation('Page hidden / pagehide');
    });

    window.addEventListener('popstate', () => {
      handlePageDepartureOrNavigation('History popstate navigation');
    });

    window.addEventListener('hashchange', () => {
      handlePageDepartureOrNavigation('URL hashchange navigation');
    });
  }
}

/**
 * Cold Browser Restart Staged State Recovery:
 * On tab load or browser launch, inspects if a previously held/approved action
 * belongs to this origin and restores the pending confirmation state or surfaces
 * the approved recovery notification banner: "You have an approved action waiting: Continue on [Domain]".
 */
export async function checkColdRestartRecovery(): Promise<void> {
  if (typeof window === 'undefined' || !window.location?.origin) return;
  if (isDashboardOrInternalPage()) return;

  const currentOrigin = window.location.origin;
  try {
    const record = await defaultRecoveryManager.getActiveRecovery(currentOrigin);
    if (!record) return;

    if (record.status === 'approved') {
      let displayRecord = {
        ...record,
        approver: resolveApproverDisplayName({ decidedBy: record.approver }),
      };
      let decisionReason: string | undefined;
      let modalOpenedFromRecovery = false;
      let activeProceedFn: (() => void) | undefined;

      const applyApprovedModal = (rec: typeof displayRecord) => {
        updateWaitingScreenStatus('approved', {
          requestId: rec.requestId,
          approver: resolveApproverDisplayName({ decidedBy: rec.approver }),
          reason: decisionReason,
          submittedAt: rec.submittedAt,
          onProceed: activeProceedFn,
        });
      };

      const showBannerForRecord = (recToShow: typeof displayRecord) => {
        mountRecoveryBanner({
          record: recToShow,
          onReviewAndContinue: (rec) => {
            dismissRecoveryBanner();
            modalOpenedFromRecovery = true;

            const recoveredAction: GuardrailAction = {
              id: rec.actionId,
              type: ActionType.CLICK,
              category: rec.category,
              description: rec.description,
              timestamp: rec.submittedAt,
              page: { url: rec.url, origin: rec.origin, hostname: rec.domain },
              element: rec.destinationUrl ? { targetUrl: rec.destinationUrl, id: rec.elementId } : undefined,
            };

            const recoveredRisk: RiskAssessment = {
              actionId: rec.actionId,
              riskLevel: rec.riskLevel,
              score: 85,
              reasons: ['Held action approved by caretaker'],
              matchedRules: [],
              evaluatedAt: rec.submittedAt,
            };
            const recoveredDecision: ResponseDecision = {
              actionId: rec.actionId,
              response: ResponseAction.WARN,
              reasons: [],
            };

            activeApprovalSession = {
              action: recoveredAction,
              risk: recoveredRisk,
              decision: recoveredDecision,
              requestId: rec.requestId,
              status: 'approved',
              hasExecutedContinuation: false,
              submittedAt: rec.submittedAt,
            };

            showWarningModal({
              action: recoveredAction,
              risk: recoveredRisk,
              decision: recoveredDecision,
              initialState: 'waiting',
              onCloseWaiting: () => {
                dismissWarningModal();
              },
              onCancelRequest: () => {
                void defaultRecoveryManager.clearRecovery(rec.actionId);
                dismissWarningModal();
              },
            });

            activeProceedFn = () => {
              void defaultRecoveryManager.clearRecovery(rec.actionId);
              dismissWarningModal();
              if (rec.destinationUrl && typeof window !== 'undefined') {
                window.location.href = rec.destinationUrl;
              }
            };

            applyApprovedModal(rec);
          },
          onDismiss: (rec) => {
            dismissRecoveryBanner();
            void defaultRecoveryManager.clearRecovery(rec.actionId);
          },
        });
      };

      showBannerForRecord(displayRecord);

      if (record.requestId && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(
          { type: 'GUARDRAIL_GET_APPROVAL_STATUS', requestId: record.requestId },
          (res: any) => {
            const dec = res?.request?.decision;
            if (!dec) return;
            const fetchedReason = dec.decisionReason || dec.reason;
            if (fetchedReason) {
              decisionReason = fetchedReason;
            }
            const resolvedName = resolveApproverDisplayName(dec);
            const nameChanged = Boolean(resolvedName && resolvedName !== displayRecord.approver);
            if (nameChanged) {
              displayRecord = { ...displayRecord, approver: resolvedName };
              void defaultRecoveryManager.updateStagedActionStatus(record.actionId, 'approved', resolvedName);
              if (!modalOpenedFromRecovery) {
                showBannerForRecord(displayRecord);
              }
            }
            if (modalOpenedFromRecovery && (fetchedReason || nameChanged)) {
              applyApprovedModal(displayRecord);
            }
          }
        );
      }
    } else if (record.status === 'pending') {
      showPendingApprovalPill({
        domain: record.domain,
        requestId: record.requestId,
        onOpen: () => {
          const recoveredAction: GuardrailAction = {
            id: record.actionId,
            type: ActionType.CLICK,
            category: record.category,
            description: record.description,
            timestamp: record.submittedAt,
            page: { url: record.url, origin: record.origin, hostname: record.domain },
            element: record.destinationUrl ? { targetUrl: record.destinationUrl, id: record.elementId } : undefined,
          };

          const recoveredRisk: RiskAssessment = {
            actionId: record.actionId,
            riskLevel: record.riskLevel,
            score: 85,
            reasons: ['Action pending caretaker review'],
            matchedRules: [],
            evaluatedAt: record.submittedAt,
          };
          const recoveredDecision: ResponseDecision = {
            actionId: record.actionId,
            response: ResponseAction.WARN,
            reasons: [],
          };

          activeApprovalSession = {
            action: recoveredAction,
            risk: recoveredRisk,
            decision: recoveredDecision,
            requestId: record.requestId,
            status: 'pending',
            hasExecutedContinuation: false,
            submittedAt: record.submittedAt,
          };

          showWarningModal({
            action: recoveredAction,
            risk: recoveredRisk,
            decision: recoveredDecision,
            initialState: 'waiting',
            onCloseWaiting: () => {
              dismissWarningModal();
            },
            onCancelRequest: () => {
              void defaultRecoveryManager.clearRecovery(record.actionId);
              dismissWarningModal();
            },
          });

          updateWaitingScreenStatus('pending', {
            requestId: record.requestId,
            submittedAt: record.submittedAt,
          });

          startWaitingStatusPolling(record.requestId, recoveredAction);
        },
        onCancel: () => {
          void defaultRecoveryManager.clearRecovery(record.actionId);
          dismissPendingApprovalPill();
        },
      });

      // Poll background immediately for status
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(
          { type: 'GUARDRAIL_GET_APPROVAL_STATUS', requestId: record.requestId },
          (res: any) => {
            if (res?.success && res.status === 'APPROVED') {
              void defaultRecoveryManager.updateStagedActionStatus(
                record.actionId,
                'approved',
                res.request?.decision ? resolveApproverDisplayName(res.request.decision) : (res.approver || 'Trusted Contact')
              ).then(() => {
                dismissPendingApprovalPill();
                checkColdRestartRecovery();
              });
            } else if (res?.status === 'REJECTED' || res?.status === 'CANCELLED' || res?.status === 'EXPIRED') {
              void defaultRecoveryManager.clearRecovery(record.actionId);
              dismissPendingApprovalPill();
            }
          }
        );
      }
    }
  } catch (err) {
    console.warn('[Guardrail Recovery] Cold restart recovery check error:', err);
  }
}

/**
 * Guards against duplicate content script initialization within the same execution context.
 */
function init(): void {
  if (typeof window !== 'undefined') {
    if ((window as any).__GUARDRAIL_CONTENT_BOOTSTRAPPED__) {
      return;
    }
    (window as any).__GUARDRAIL_CONTENT_BOOTSTRAPPED__ = true;
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-guardrail-extension-active', 'true');
  }
  bootstrap();
  void checkColdRestartRecovery();
}

// Ensure initialization occurs after the DOM tree is available in browser contexts
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
