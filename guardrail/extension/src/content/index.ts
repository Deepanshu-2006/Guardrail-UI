/**
 * Guardrail Extension - Content Script Entrypoint
 *
 * Runs inside the webpage's DOM context in an isolated JavaScript execution world.
 * Detects interactive target elements (buttons, inputs) on the test page,
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
} from '../utils/index.js';

/**
 * Main DOM inspection and interaction setup for the Guardrail test page.
 */
function initializeDOMInspection(): void {
  const pageInfo = extractPageInfo();

  console.log(
    '%c[Guardrail Content]%c Content script initialized on page',
    'color: #0ea5e9; font-weight: bold; padding: 2px 4px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    {
      url: pageInfo.url,
      title: pageInfo.title,
      documentState: document.readyState,
      timestamp: new Date().toISOString(),
    }
  );

  // 1. Detect the "Test Action" button
  const testActionBtn = document.querySelector<HTMLButtonElement>('#test-action-btn');
  if (testActionBtn) {
    console.log(
      '%c[Guardrail Content]%c Detected [Test Action] Button:',
      'color: #38bdf8; font-weight: bold;',
      'color: inherit;',
      extractElementInfo(testActionBtn)
    );

    // Attach click listener: Constructs a normalized GuardrailAction and dispatches it
    testActionBtn.addEventListener('click', (event: MouseEvent) => {
      // 1. Target DOM element
      const targetElement = (event.target as HTMLElement) || testActionBtn;

      // 2. Extract element information safely
      const elementInfo = extractElementInfo(targetElement);

      // 3. Extract page information safely
      const activePageInfo = extractPageInfo();

      // 4. Generate unique ID and detection timestamp
      const metadata = createActionMetadata('act');

      // 5. Construct the complete normalized GuardrailAction model
      const action: GuardrailAction = {
        id: metadata.id,
        type: ActionType.CLICK,
        element: elementInfo,
        page: activePageInfo,
        timestamp: metadata.timestamp,
      };

      console.log(
        '%c[Guardrail Content]%c Created GuardrailAction:',
        'color: #10b981; font-weight: bold; background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 3px;',
        'color: inherit; font-weight: normal;',
        action
      );

      // 6. Wrap in extension message payload
      const message: GuardrailActionMessage = {
        type: 'GUARDRAIL_ACTION',
        action,
      };

      // 7. Dispatch to background service worker via Chrome runtime messaging
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
    });
  } else {
    console.log('[Guardrail Content] "Test Action" button not found on this page.');
  }

  // 2. Detect the text input field
  const textInput = document.querySelector<HTMLInputElement>('#test-input, input[name="testInput"]');
  if (textInput) {
    console.log(
      '%c[Guardrail Content]%c Detected Text Input:',
      'color: #38bdf8; font-weight: bold;',
      'color: inherit;',
      extractElementInfo(textInput)
    );
  } else {
    console.log('[Guardrail Content] Text input field not found on this page.');
  }

  // 3. Detect the "Submit" button
  const submitBtn = document.querySelector<HTMLButtonElement>('#submit-btn, button[type="submit"]');
  if (submitBtn) {
    console.log(
      '%c[Guardrail Content]%c Detected [Submit] Button:',
      'color: #38bdf8; font-weight: bold;',
      'color: inherit;',
      extractElementInfo(submitBtn)
    );
  } else {
    console.log('[Guardrail Content] "Submit" button not found on this page.');
  }
}

// Ensure execution occurs after DOM is parsed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDOMInspection);
} else {
  initializeDOMInspection();
}
