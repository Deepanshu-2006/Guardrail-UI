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
import { dispatchActionToBackground, extractPageInfo } from '../utils/index.js';

/**
 * Bootstraps the Guardrail Content Script runtime and Action Detector.
 */
function bootstrap(): void {
  const pageInfo = extractPageInfo();

  console.log(
    '%c[Guardrail Content]%c Unified Action Detector & Classifier initialized on page',
    'color: #0ea5e9; font-weight: bold; padding: 2px 4px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    {
      url: pageInfo.url,
      title: pageInfo.title,
      documentState: document.readyState,
      timestamp: new Date().toISOString(),
    }
  );

  // Instantiate the unified ActionDetector with classification pipeline
  const detector = new ActionDetector((action) => {
    // 1. Pass the unchanged normalized action to the Action Classifier
    const classification = classifyAction(action);

    console.log(
      `%c[Guardrail Content]%c Action [${action.type}] → Classified as [${classification.category}] via [${classification.matchedRule}]`,
      'color: #10b981; font-weight: bold; background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 3px;',
      'color: inherit; font-weight: normal;',
      {
        action,
        classification,
      }
    );

    // 2. Forward the normalized action and its classification result to the background coordinator
    dispatchActionToBackground(action, classification);
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
