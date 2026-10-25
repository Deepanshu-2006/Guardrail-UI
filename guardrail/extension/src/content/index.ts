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

import { classifyAction } from '../classifier/index.js';
import { ActionDetector } from '../detector/index.js';
import { assessRisk } from '../risk/index.js';
import { decideResponse, evaluateActionPipeline } from '../response/index.js';
import { showWarningModal } from '../ui/index.js';
import {
  ActionClassificationResult,
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
} from '../interception/index.js';
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
  dispatchSubmitApprovalRequestToBackground,
  extractPageInfo,
  GUARDRAIL_TEST_ACTION_ATTR,
} from '../utils/index.js';

let latestStagingContext: StagingActionContext | null = null;
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
  const textSummary =
    action.element?.visibleText ||
    action.element?.id ||
    action.element?.tagName ||
    action.page.url;

  const primaryReason = decision.reasons[0] || risk.reasons[0] || 'Standard action evaluation';

  console.log(
    `%c[Guardrail Pipeline]%c EVALUATION SUMMARY\n` +
    `ACTION: ${action.type}${textSummary ? ` ("${textSummary}")` : ''}\n` +
    `CATEGORY: ${classification.category}\n` +
    `RISK: ${risk.riskLevel} (score: ${risk.score})\n` +
    `RESPONSE: ${decision.response}\n` +
    `REASON: ${primaryReason}`,
    'color: #0ea5e9; font-weight: bold; padding: 2px 6px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    {
      actionId: action.id,
      action,
      classification,
      risk,
      decision,
    }
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
        console.warn('[Guardrail Content] Error dispatching custom allowed event:', err);
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
        console.warn('[Guardrail Content] Error dispatching custom warned event:', err);
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
        devMessageEl.innerHTML = `<strong>🛡️ Guardrail Development Notice:</strong> Action <code>${escapeHtml(action.id)}</code> has been intercepted and transitioned to <strong>HELD</strong>. This action is waiting for a protection decision. Use the controls below to Continue or Cancel.`;
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
        console.warn('[Guardrail Content] Error dispatching custom intercepted event:', err);
      }
      break;
    }
  }
}

/**
 * Bootstraps the Guardrail Content Script runtime and Action Detector.
 */
function bootstrap(): void {
  const pageInfo = extractPageInfo();

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
      // 1. Centralized pipeline evaluation (classification -> prioritized risk rules -> deterministic response precedence)
      const { classification, risk, decision } = evaluateActionPipeline(action);

      // 2. Output standardized development log
      logPipelineResult(action, classification, risk, decision);

      // 3. Branch on ResponseAction:
      switch (decision.response) {
        case ResponseAction.ALLOW:
          console.log(`[Guardrail Response] ALLOW: Action permitted. Prototype flow continues.`);
          break;

        case ResponseAction.WARN:
          console.log(`[Guardrail Response] WARN: Displaying Guardrail warning UI.`);
          showWarningModal({
            action,
            risk,
            decision,
            onContinue: () => {
              console.log(`[Guardrail UI] User clicked Continue on warning for action: ${action.id}`);
            },
            onCancel: () => {
              console.log(`[Guardrail UI] User clicked Cancel on warning for action: ${action.id}`);
            },
          });
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
            `ACTION: ${action.type} ("${action.element?.visibleText || action.element?.id || ''}")\n` +
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

          // Forward pipeline evaluation to background coordinator (without interception record)
          dispatchActionToBackground(action, classification, risk, decision);
          break;
        }

        case ResponseAction.WARN: {
          // WARN:
          // * Preserve the existing Guardrail warning behavior.
          // * Do not treat WARN as authorization to execute an already-held action.
          // * Do not create an unnecessary interception record if the action has not been held.
          console.log(
            `%c[Guardrail Interception]%c ACTION WARNED (Score: ${risk.score})\n` +
            `ACTION: ${action.type} ("${action.element?.visibleText || action.element?.id || ''}")\n` +
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

          showWarningModal({
            action,
            risk,
            decision,
            onContinue: () => {
              console.log(
                `[Guardrail UI] User clicked Continue on warning for action: ${action.id}. Action was not held; no held state to authorize.`
              );
            },
            onCancel: () => {
              console.log(
                `[Guardrail UI] User clicked Cancel on warning for action: ${action.id}.`
              );
            },
          });

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
            console.warn('[Guardrail Content] Error creating StagingActionContext:', ctxErr);
          }

          // * Show a development message explaining that the action is waiting for a protection decision.
          console.log(
            `%c[Guardrail Interception]%c 🛡️ ACTION PROTECTED (HELD)\n` +
            `ACTION: ${action.type} ("${action.element?.visibleText || action.element?.id || ''}")\n` +
            `ACTION ID: ${action.id}\n` +
            `STATE: ${heldRecord.state}\n` +
            `SCORE: ${risk.score} (${risk.riskLevel})\n` +
            `DEVELOPMENT NOTICE: Action is waiting for a protection decision. Normal page execution has been halted.`,
            'color: #ef4444; font-weight: bold; padding: 2px 6px; background: rgba(239, 68, 68, 0.1); border-radius: 3px;',
            'color: inherit; font-weight: normal;',
            {
              actionId: action.id,
              record: heldRecord,
              action,
              classification,
              risk,
              decision,
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
                console.warn('[Guardrail Content] Error dispatching controlled handler executed event:', err);
              }
            }
          );

          updateControlledTestPageDisplay(action, {
            response: ResponseAction.PROTECT,
            risk,
            decision,
            record: heldRecord,
          });

          // Forward pipeline evaluation to background coordinator WITH the held interception record
          dispatchActionToBackground(action, classification, risk, decision, heldRecord);

          // * Automatically present staging interface for user review and decision
          if (latestStagingContext) {
            showStagingModal({
              context: latestStagingContext,
              state: 'active',
              controller: defaultInterceptionController,
              continuationManager: defaultContinuationManager,
              useRealBackend: true,
              onCancel: (id) => cancelHeldAction(id),
            });
          }
          break;
        }
      }
    }
  );

  // Start ambient observation
  detector.start();

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

    const result = defaultContinuationManager.continueAction(
      actionId,
      'Action continued via explicit development control on test website.'
    );

    if (!result.success) {
      console.warn(`[Guardrail Continuation] Rejection: ${result.error}`);
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
      console.warn('[Guardrail Content] Error dispatching custom action-continued event:', err);
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
      console.warn(`[Guardrail Cancellation] Rejection: ${result.error}`);
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
      console.warn('[Guardrail Content] Error dispatching custom action-cancelled event:', err);
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
      console.warn(`[Guardrail Approval] Rejection: ${err}`);
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
          console.warn('[Guardrail Approval] Error creating StagingActionContext:', ctxErr);
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
      console.warn('[Guardrail Content] Error dispatching custom approval-requested event:', err);
    }

    // Dispatch to background coordinator
    dispatchApprovalRequestToBackground(intent).catch((err) => {
      console.warn('[Guardrail Content] Background dispatch failed:', err);
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
 * Guards against duplicate content script initialization within the same execution context.
 */
function init(): void {
  if (typeof window !== 'undefined') {
    if ((window as any).__GUARDRAIL_CONTENT_BOOTSTRAPPED__) {
      return;
    }
    (window as any).__GUARDRAIL_CONTENT_BOOTSTRAPPED__ = true;
  }
  bootstrap();
}

// Ensure initialization occurs after the DOM tree is available
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
