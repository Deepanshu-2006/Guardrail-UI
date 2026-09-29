/**
 * Guardrail Extension - Content Script Entrypoint
 *
 * Runs inside the webpage's DOM context in an isolated JavaScript execution world.
 * Detects interactive target elements (buttons, inputs) on the test page,
 * inspects their DOM attributes, and dispatches messages to the background service worker.
 *
 * NOTE: Risk scoring, action interception, payment logic, and backend
 * communication are intentionally omitted at this stage.
 */

import { ActionAcknowledgementResponse, TestActionMessage } from '../types/index.js';

// Interface defining the structured metadata we extract from each DOM element
interface ElementSummary {
  elementType: string;
  id: string;
  className: string;
  visibleText?: string;
  inputType?: string;
  placeholder?: string;
}

/**
 * Helper function to inspect an HTMLElement and extract readable metadata.
 */
function inspectElement(element: HTMLElement): ElementSummary {
  const summary: ElementSummary = {
    elementType: element.tagName.toLowerCase(),
    id: element.id || '(no id)',
    className: element.className || '(no class)',
  };

  if (element instanceof HTMLInputElement) {
    summary.inputType = element.type;
    if (element.placeholder) {
      summary.placeholder = element.placeholder;
    }
  } else if (element instanceof HTMLButtonElement) {
    summary.inputType = element.type;
    summary.visibleText = element.innerText?.trim() || element.textContent?.trim() || '(empty)';
  } else {
    const text = element.innerText?.trim() || element.textContent?.trim();
    if (text) {
      summary.visibleText = text;
    }
  }

  return summary;
}

/**
 * Main DOM inspection and interaction setup for the Guardrail test page.
 */
function initializeDOMInspection(): void {
  const pageUrl = window.location.href;
  const timestamp = new Date().toISOString();

  console.log(
    '%c[Guardrail Content]%c Content script initialized on page',
    'color: #0ea5e9; font-weight: bold; padding: 2px 4px; background: rgba(14, 165, 233, 0.1); border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    {
      url: pageUrl,
      documentState: document.readyState,
      timestamp,
    }
  );

  // 1. Detect the "Test Action" button
  const testActionBtn = document.querySelector<HTMLButtonElement>('#test-action-btn');
  if (testActionBtn) {
    console.log(
      '%c[Guardrail Content]%c Detected [Test Action] Button:',
      'color: #38bdf8; font-weight: bold;',
      'color: inherit;',
      inspectElement(testActionBtn)
    );

    // Attach click listener: Logs locally and sends message to background service worker
    testActionBtn.addEventListener('click', (event: MouseEvent) => {
      console.log(
        '%c[Guardrail Content]%c Guardrail detected Test Action click',
        'color: #10b981; font-weight: bold; background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 3px;',
        'color: inherit; font-weight: normal;',
        {
          target: (event.target as HTMLElement)?.tagName,
          id: (event.target as HTMLElement)?.id,
          timestamp: new Date().toISOString(),
        }
      );

      // Create message object for the background service worker
      const message: TestActionMessage = {
        type: 'TEST_ACTION',
        action: 'Test Action',
        url: window.location.href,
      };

      // Dispatch to background service worker and handle acknowledgement response
      chrome.runtime.sendMessage<TestActionMessage, ActionAcknowledgementResponse>(message)
        .then((response) => {
          if (response) {
            console.log(
              '%c[Guardrail Content]%c Received background response:',
              'color: #a855f7; font-weight: bold;',
              'color: inherit;',
              response
            );
          }
        })
        .catch((error) => {
          console.warn('[Guardrail Content] Failed to send message to background worker:', error);
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
      inspectElement(textInput)
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
      inspectElement(submitBtn)
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
