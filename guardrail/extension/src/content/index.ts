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

  const ruleSummary = classification.matchedRule;
  const riskReasonsList = risk.reasons.map((r) => `* ${r}`).join('\n');
  const decisionReasonsList = decision.reasons.map((r) => `* ${r}`).join('\n');

  console.log(
    `%c[Guardrail Pipeline]%c COMPLETE EVALUATION\n\n` +
    `ACTION\n` +
    `Type: ${action.type}\n` +
    `Text: ${textSummary}\n\n` +
    `CLASSIFICATION\n` +
    `Category: ${classification.category}\n` +
    `Rule: ${ruleSummary}\n\n` +
    `RISK\n` +
    `Score: ${risk.score}\n` +
    `Level: ${risk.riskLevel}\n` +
    `Reasons:\n${riskReasonsList}\n\n` +
    `RESPONSE\n` +
    `Action: ${decision.response}\n` +
    `Reasons:\n${decisionReasonsList}`,
    'color: #0ea5e9; font-weight: bold; padding: 2px 6px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    {
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
    '%c[Guardrail Content]%c Full Pipeline (Detector → Classifier → Risk Engine → Response Engine) initialized',
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
    // 1. Pass the unchanged normalized action to the Action Classifier
    const classification = classifyAction(action);

    // 2. Evaluate with the Risk Engine to produce RiskAssessment
    const risk = assessRisk(action, classification);

    // 3. Render ResponseDecision via the Response Engine
    const decision = decideResponse(risk);

    // 4. Log the complete result in clean development format
    logPipelineResult(action, classification, risk, decision);

    // 5. If response is WARN, dynamically mount the Guardrail warning UI
    if (decision.response === ResponseAction.WARN) {
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
    }

    // 6. Forward action, classification, risk assessment, and decision to background coordinator
    dispatchActionToBackground(action, classification, risk, decision);
  });

  // Start ambient observation
  detector.start();
}

// Ensure initialization occurs after the DOM tree is available
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
