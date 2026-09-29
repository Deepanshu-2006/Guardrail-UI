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

import { ActionDetector } from '../detector/index.js';
import { dispatchActionToBackground, extractPageInfo } from '../utils/index.js';

/**
 * Bootstraps the Guardrail Content Script runtime and Action Detector.
 */
function bootstrap(): void {
  const pageInfo = extractPageInfo();

  console.log(
    '%c[Guardrail Content]%c Unified Action Detector initialized on page',
    'color: #0ea5e9; font-weight: bold; padding: 2px 4px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    {
      url: pageInfo.url,
      title: pageInfo.title,
      documentState: document.readyState,
      timestamp: new Date().toISOString(),
    }
  );

  // Instantiate the unified ActionDetector and connect it to the messaging pipeline
  const detector = new ActionDetector((action) => {
    console.log(
      `%c[Guardrail Content]%c Action Captured [${action.type}]:`,
      'color: #10b981; font-weight: bold; background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 3px;',
      'color: inherit; font-weight: normal;',
      action
    );

    // Forward the normalized action to the background coordinator
    dispatchActionToBackground(action);
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
