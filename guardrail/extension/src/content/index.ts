/**
 * Guardrail Extension - Content Script Entrypoint
 *
 * Runs inside the webpage's DOM context in an isolated JavaScript execution world.
 * Observes user/agent interactions across the entire document using event delegation,
 * normalizes interactions into structured GuardrailAction models, and dispatches
 * them to the background service worker coordinator.
 *
 * NOTE: Risk scoring, action interception, payment logic, and backend
 * communication are intentionally omitted at this stage.
 */

import {
  ActionAcknowledgementResponse,
  ActionType,
  GuardrailAction,
  GuardrailActionMessage,
} from '../types/index.js';
import {
  createActionMetadata,
  extractElementInfo,
  extractPageInfo,
  findInteractiveElement,
} from '../utils/index.js';

/**
 * Handles generic click events across the document via event delegation.
 */
function handleDocumentClick(event: MouseEvent): void {
  // 1. Identify the nearest interactive element (button, link, role="button", etc.)
  const interactiveElement = findInteractiveElement(event.target);

  // 2. Ignore non-interactive clicks (empty space, plain text paragraphs, etc.)
  if (!interactiveElement) {
    return;
  }

  // 3. Extract normalized element information
  const elementInfo = extractElementInfo(interactiveElement);

  // 4. Extract current page context
  const pageInfo = extractPageInfo();

  // 5. Generate unique action ID and timestamp
  const metadata = createActionMetadata('act');

  // 6. Construct normalized GuardrailAction
  const action: GuardrailAction = {
    id: metadata.id,
    type: ActionType.CLICK,
    element: elementInfo,
    page: pageInfo,
    timestamp: metadata.timestamp,
  };

  console.log(
    '%c[Guardrail Content]%c Detected Generic CLICK Action:',
    'color: #10b981; font-weight: bold; background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    action
  );

  // 7. Wrap into typed extension message
  const message: GuardrailActionMessage = {
    type: 'GUARDRAIL_ACTION',
    action,
  };

  // 8. Dispatch to background service worker
  chrome.runtime.sendMessage<GuardrailActionMessage, ActionAcknowledgementResponse>(message)
    .then((response) => {
      if (response) {
        console.log(
          '%c[Guardrail Content]%c Received background acknowledgement:',
          'color: #a855f7; font-weight: bold;',
          'color: inherit;',
          response
        );
      }
    })
    .catch((error) => {
      console.warn('[Guardrail Content] Failed to dispatch action to background worker:', error);
    });
}

/**
 * Initializes generic action detection and event listeners.
 */
function initializeActionDetection(): void {
  const pageInfo = extractPageInfo();

  console.log(
    '%c[Guardrail Content]%c Generic Action Detector initialized on page',
    'color: #0ea5e9; font-weight: bold; padding: 2px 4px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    {
      url: pageInfo.url,
      title: pageInfo.title,
      documentState: document.readyState,
      timestamp: new Date().toISOString(),
    }
  );

  // Attach document-level generic click listener via event delegation
  document.addEventListener('click', handleDocumentClick, true);
}

// Ensure execution occurs after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeActionDetection);
} else {
  initializeActionDetection();
}
