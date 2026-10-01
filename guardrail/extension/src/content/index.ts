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
import { decideResponse } from '../response/index.js';
import { showWarningModal } from '../ui/index.js';
import {
  ActionClassificationResult,
  GuardrailAction,
  ResponseAction,
  ResponseDecision,
  RiskAssessment,
} from '../types/index.js';
import { dispatchActionToBackground, extractPageInfo } from '../utils/index.js';

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

  // Instantiate the unified ActionDetector with classification, risk & response pipeline
  const detector = new ActionDetector((action) => {
    // 1. Action Classifier produces ClassificationResult
    const classification = classifyAction(action);

    // 2. Risk Engine produces RiskAssessment
    const risk = assessRisk(action, classification);

    // 3. Response Engine produces ResponseDecision
    const decision = decideResponse(risk);

    // 4. Verify actionId consistency across all pipeline stages
    if (
      action.id !== classification.actionId ||
      action.id !== risk.actionId ||
      action.id !== decision.actionId
    ) {
      console.error('[Guardrail Pipeline] Critical: actionId mismatch detected across pipeline stages!', {
        actionId: action.id,
        classificationActionId: classification.actionId,
        riskActionId: risk.actionId,
        decisionActionId: decision.actionId,
      });
    }

    // 5. Output standardized development log
    logPipelineResult(action, classification, risk, decision);

    // 6. Branch on ResponseAction:
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
          `[Guardrail Response] 🛡️ PROTECT response required: Action [${action.id}] flagged for future protective gating. (Not blocking in prototype).`
        );
        break;
    }

    // 7. Forward complete pipeline artifact to background service worker coordinator
    dispatchActionToBackground(action, classification, risk, decision);
  });

  // Start ambient observation
  detector.start();
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
