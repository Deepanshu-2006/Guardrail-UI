/**
 * Guardrail Extension - Content Script Entrypoint
 *
 * Runs inside the webpage's DOM context in an isolated JavaScript execution world.
 * Detects interactive target elements (buttons, inputs) on the test page,
 * inspects their DOM attributes, and observes user interactions via event listeners.
 *
 * NOTE: Risk scoring, action interception, payment logic, and backend
 * communication are intentionally omitted at this stage.
 */

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
    '%c[Guardrail]%c Content script initialized on page',
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
      '%c[Guardrail]%c Detected [Test Action] Button:',
      'color: #38bdf8; font-weight: bold;',
      'color: inherit;',
      inspectElement(testActionBtn)
    );

    // Attach click listener to detect user interactions
    testActionBtn.addEventListener('click', (event: MouseEvent) => {
      console.log(
        '%c[Guardrail]%c Guardrail detected Test Action click',
        'color: #10b981; font-weight: bold; background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 3px;',
        'color: inherit; font-weight: normal;',
        {
          target: (event.target as HTMLElement)?.tagName,
          id: (event.target as HTMLElement)?.id,
          timestamp: new Date().toISOString(),
        }
      );
    });
  } else {
    console.log('[Guardrail] "Test Action" button not found on this page.');
  }

  // 2. Detect the text input field
  const textInput = document.querySelector<HTMLInputElement>('#test-input, input[name="testInput"]');
  if (textInput) {
    console.log(
      '%c[Guardrail]%c Detected Text Input:',
      'color: #38bdf8; font-weight: bold;',
      'color: inherit;',
      inspectElement(textInput)
    );
  } else {
    console.log('[Guardrail] Text input field not found on this page.');
  }

  // 3. Detect the "Submit" button
  const submitBtn = document.querySelector<HTMLButtonElement>('#submit-btn, button[type="submit"]');
  if (submitBtn) {
    console.log(
      '%c[Guardrail]%c Detected [Submit] Button:',
      'color: #38bdf8; font-weight: bold;',
      'color: inherit;',
      inspectElement(submitBtn)
    );
  } else {
    console.log('[Guardrail] "Submit" button not found on this page.');
  }
}

// Ensure execution occurs after DOM is parsed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDOMInspection);
} else {
  initializeDOMInspection();
}
