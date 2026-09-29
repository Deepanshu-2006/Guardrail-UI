/**
 * Guardrail Extension - Content Script Entrypoint
 *
 * Runs inside the webpage's DOM context in an isolated JavaScript execution world.
 * Observes user/agent interactions across the entire document using event delegation,
 * normalizes interactions into structured GuardrailAction models, and dispatches
 * them to the background service worker coordinator.
 *
 * Supported Action Types:
 * - CLICK: Buttons, links, role="button" elements (excluding form submit buttons)
 * - INPUT: Form control modifications (inputs, textareas, selects - value-free)
 * - SUBMIT: Form submissions (form level)
 * - NAVIGATION: Page load and client-side route transitions
 *
 * PRIVACY SAFEGUARD: Never captures or transmits user-typed form values or credentials.
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
  findFormInputElement,
  findInteractiveElement,
  isFormSubmitTrigger,
} from '../utils/index.js';

// In-memory state tracking URL to avoid duplicate navigation events
let lastTrackedUrl = '';

/**
 * Safely dispatches an action message to the background service worker.
 * Gracefully handles browser extension reloads / context invalidation.
 */
function safelyDispatchAction(action: GuardrailAction): void {
  // Guard against disconnected runtime if extension was reloaded in chrome://extensions
  if (!chrome.runtime?.id) {
    console.info('[Guardrail Content] Extension was updated. Please refresh the webpage tab to reconnect.');
    return;
  }

  const message: GuardrailActionMessage = {
    type: 'GUARDRAIL_ACTION',
    action,
  };

  try {
    chrome.runtime.sendMessage<GuardrailActionMessage, ActionAcknowledgementResponse>(message)
      .then((response) => {
        if (response) {
          console.log(
            `%c[Guardrail Content]%c Received background acknowledgement for ${action.type}:`,
            'color: #a855f7; font-weight: bold;',
            'color: inherit;',
            response
          );
        }
      })
      .catch((error: Error) => {
        if (error?.message?.includes('Extension context invalidated')) {
          console.info('[Guardrail Content] Extension was updated. Please refresh the webpage tab to reconnect.');
        } else {
          console.warn(`[Guardrail Content] Failed to dispatch ${action.type} action:`, error);
        }
      });
  } catch (syncError: unknown) {
    const errorMsg = syncError instanceof Error ? syncError.message : String(syncError);
    if (errorMsg.includes('Extension context invalidated')) {
      console.info('[Guardrail Content] Extension was updated. Please refresh the webpage tab to reconnect.');
    } else {
      console.warn(`[Guardrail Content] Sync error dispatching ${action.type} action:`, syncError);
    }
  }
}

/**
 * Tracks meaningful page navigation events (initial page load and SPA route changes).
 *
 * @param explicitPreviousUrl Optional previous URL if known
 */
function trackNavigation(explicitPreviousUrl?: string): void {
  const currentUrl = typeof window !== 'undefined' && window.location ? window.location.href : '';

  // Avoid generating duplicate navigation actions if the URL has not changed
  if (!currentUrl || currentUrl === lastTrackedUrl) {
    return;
  }

  // Resolve previous URL (from memory, referrer, or caller)
  const previousUrl = explicitPreviousUrl || (lastTrackedUrl ? lastTrackedUrl : (document.referrer || undefined));
  lastTrackedUrl = currentUrl;

  const pageInfo = extractPageInfo(previousUrl);
  const metadata = createActionMetadata('act');

  const action: GuardrailAction = {
    id: metadata.id,
    type: ActionType.NAVIGATION,
    page: pageInfo,
    timestamp: metadata.timestamp,
  };

  console.log(
    '%c[Guardrail Content]%c Detected NAVIGATION Action:',
    'color: #3b82f6; font-weight: bold; background: rgba(59, 130, 246, 0.1); padding: 2px 6px; border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    action
  );

  safelyDispatchAction(action);
}

/**
 * Handles generic click events across the document via event delegation.
 */
function handleDocumentClick(event: MouseEvent): void {
  // 1. Identify the nearest interactive element (button, link, role="button", etc.)
  const interactiveElement = findInteractiveElement(event.target);

  // 2. Ignore non-interactive clicks
  if (!interactiveElement) {
    return;
  }

  // 3. De-duplicate: If clicking a form submit button, defer to the higher-level SUBMIT event
  if (isFormSubmitTrigger(interactiveElement)) {
    return;
  }

  // 4. Extract normalized element information
  const elementInfo = extractElementInfo(interactiveElement);

  // 5. Extract current page context
  const pageInfo = extractPageInfo();

  // 6. Generate unique action ID and timestamp
  const metadata = createActionMetadata('act');

  // 7. Construct normalized GuardrailAction
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

  // 8. Dispatch to background service worker
  safelyDispatchAction(action);
}

/**
 * Handles generic form input events across the document via event delegation.
 * Captures interaction presence and control metadata without reading typed values.
 */
function handleDocumentChange(event: Event): void {
  // 1. Identify the form input control (input, textarea, select)
  const inputElement = findFormInputElement(event.target);

  // 2. Ignore changes on non-form elements
  if (!inputElement) {
    return;
  }

  // 3. Extract normalized element metadata (guaranteed value-free)
  const elementInfo = extractElementInfo(inputElement);

  // 4. Extract current page context
  const pageInfo = extractPageInfo();

  // 5. Generate unique action ID and timestamp
  const metadata = createActionMetadata('act');

  // 6. Construct normalized GuardrailAction with INPUT type
  const action: GuardrailAction = {
    id: metadata.id,
    type: ActionType.INPUT,
    element: elementInfo,
    page: pageInfo,
    timestamp: metadata.timestamp,
  };

  console.log(
    '%c[Guardrail Content]%c Detected Generic INPUT Action (Value-Free):',
    'color: #f59e0b; font-weight: bold; background: rgba(245, 158, 11, 0.1); padding: 2px 6px; border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    action
  );

  // 7. Dispatch to background service worker
  safelyDispatchAction(action);
}

/**
 * Handles generic form submit events across the document via event delegation.
 * Captures form-level submission actions without reading field contents.
 */
function handleDocumentSubmit(event: Event): void {
  // 1. Identify the submitted form element
  let formElement: HTMLFormElement | null = null;
  if (event.target instanceof HTMLFormElement) {
    formElement = event.target;
  } else if (event.target instanceof Element) {
    formElement = event.target.closest('form');
  }

  // 2. Ignore if not a form
  if (!formElement) {
    return;
  }

  // 3. Extract normalized form metadata (strictly value-free)
  const elementInfo = extractElementInfo(formElement);

  // 4. Extract current page context
  const pageInfo = extractPageInfo();

  // 5. Generate unique action ID and timestamp
  const metadata = createActionMetadata('act');

  // 6. Construct normalized GuardrailAction with SUBMIT type
  const action: GuardrailAction = {
    id: metadata.id,
    type: ActionType.SUBMIT,
    element: elementInfo,
    page: pageInfo,
    timestamp: metadata.timestamp,
  };

  console.log(
    '%c[Guardrail Content]%c Detected Generic SUBMIT Action (Value-Free):',
    'color: #06b6d4; font-weight: bold; background: rgba(6, 182, 212, 0.1); padding: 2px 6px; border-radius: 3px;',
    'color: inherit; font-weight: normal;',
    action
  );

  // 7. Dispatch to background service worker
  safelyDispatchAction(action);
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

  // 1. Track initial page navigation
  trackNavigation();

  // 2. Listen for client-side SPA navigation events
  window.addEventListener('popstate', () => trackNavigation());
  window.addEventListener('hashchange', () => trackNavigation());

  // 3. Generic Click Listener (Buttons, Links, Custom Controls)
  document.addEventListener('click', handleDocumentClick, true);

  // 4. Generic Input Listener (Form Controls: input, textarea, select)
  document.addEventListener('change', handleDocumentChange, true);

  // 5. Generic Form Submit Listener (Form level submission)
  document.addEventListener('submit', handleDocumentSubmit, true);
}

// Ensure execution occurs after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeActionDetection);
} else {
  initializeActionDetection();
}
