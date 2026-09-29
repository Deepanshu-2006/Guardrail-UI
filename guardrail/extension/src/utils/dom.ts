/**
 * Guardrail DOM Action Extractor Utility
 *
 * Safely inspects browser DOM elements and extracts lightweight, normalized,
 * JSON-serializable representations matching the GuardrailAction data model.
 *
 * Does not retain live references to DOM nodes.
 * Enforces strict privacy: never captures typed user input values.
 */

import { ActionElementInfo, ActionPageInfo } from '../types/index.js';

/**
 * CSS selector matching relevant clickable/interactive elements for generic click detection.
 */
export const INTERACTIVE_CLICK_SELECTOR = [
  'button',
  'a',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="image"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
].join(', ');

/**
 * CSS selector matching form input controls for generic INPUT action detection.
 */
export const FORM_INPUT_SELECTOR = [
  'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"])',
  'textarea',
  'select',
].join(', ');

/**
 * Traverses upwards from the clicked target element to locate the nearest
 * interactive element (such as a button, link, or role="button").
 *
 * @param target The raw event target from a click event
 * @returns The nearest interactive HTMLElement, or null if non-interactive
 */
export function findInteractiveElement(target: EventTarget | null): HTMLElement | null {
  if (!target || !(target instanceof Element)) {
    return null;
  }

  // Locate the nearest interactive element ancestor or the element itself
  return target.closest<HTMLElement>(INTERACTIVE_CLICK_SELECTOR) || null;
}

/**
 * Checks if the target element is a form input control (input, textarea, select).
 *
 * @param target The event target
 * @returns The form control HTMLElement, or null if not an input control
 */
export function findFormInputElement(target: EventTarget | null): HTMLElement | null {
  if (!target || !(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>(FORM_INPUT_SELECTOR) || null;
}

/**
 * Checks if a clicked element is a form submit button/trigger.
 *
 * @param element The interactive element
 * @returns True if the element triggers a form submit
 */
export function isFormSubmitTrigger(element: HTMLElement | null): boolean {
  if (!element) return false;

  if (element instanceof HTMLButtonElement) {
    // Buttons inside forms default to type="submit" unless type="button"
    return (element.type === 'submit' || !element.type) && Boolean(element.form);
  }

  if (element instanceof HTMLInputElement) {
    return element.type === 'submit' && Boolean(element.form);
  }

  return false;
}

/**
 * Safely extracts human-readable visible text or placeholders from a DOM element.
 * PRIVACY SAFEGUARD: NEVER extracts typed user values from input fields or textareas.
 *
 * @param element The target DOM element
 * @returns Cleaned text string or undefined if empty
 */
function extractVisibleText(element: HTMLElement | Element): string | undefined {
  let rawText = '';

  if (element instanceof HTMLFormElement) {
    // For forms, never concatenate inner text of inputs or labels
    return undefined;
  }

  if (element instanceof HTMLInputElement) {
    // For button-like inputs, value is the visible label on the button (e.g. <input type="submit" value="Submit Form" />)
    if (['submit', 'button', 'reset'].includes(element.type.toLowerCase()) && element.value) {
      rawText = element.value;
    } else if (element.placeholder) {
      // For text/data inputs, ONLY extract the placeholder (e.g., "Enter your email"), NEVER typed input values!
      rawText = element.placeholder;
    }
  } else if (element instanceof HTMLTextAreaElement) {
    // For textareas, ONLY extract the placeholder, NEVER typed content
    if (element.placeholder) {
      rawText = element.placeholder;
    }
  } else if (element instanceof HTMLSelectElement) {
    // For select dropdowns, do not extract user-selected option values
    rawText = '';
  } else if ('innerText' in element && typeof (element as HTMLElement).innerText === 'string') {
    // innerText reflects what is rendered on screen for standard DOM elements
    rawText = (element as HTMLElement).innerText;
  } else if (element.textContent) {
    // Fallback to textContent for non-HTML elements
    rawText = element.textContent;
  }

  const trimmed = rawText.replace(/\s+/g, ' ').trim();

  // Return undefined for empty strings to keep JSON payload minimal
  if (!trimmed) {
    return undefined;
  }

  // Cap length to prevent gigantic text payloads
  const MAX_TEXT_LENGTH = 200;
  return trimmed.length > MAX_TEXT_LENGTH
    ? `${trimmed.substring(0, MAX_TEXT_LENGTH)}...`
    : trimmed;
}

/**
 * Safely extracts class name string across standard HTML and SVG elements.
 *
 * @param element The target DOM element
 * @returns Cleaned class string or undefined if absent
 */
function extractClassName(element: HTMLElement | Element): string | undefined {
  if (typeof element.className === 'string') {
    const trimmed = element.className.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  // Handle SVG elements or custom elements where className is an SVGAnimatedString
  const attrClass = element.getAttribute('class');
  if (attrClass) {
    const trimmed = attrClass.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
}

/**
 * Safely extracts normalized ActionElementInfo from a live DOM element.
 *
 * @param element The target DOM element to inspect
 * @returns A plain, serializable ActionElementInfo object
 */
export function extractElementInfo(element: HTMLElement | Element): ActionElementInfo {
  // Safe extraction of tag name in standard uppercase
  const tagName = element.tagName ? element.tagName.toUpperCase() : 'UNKNOWN';

  // Safe extraction of element ID attribute
  const elementId = element.id && typeof element.id === 'string' && element.id.trim().length > 0
    ? element.id.trim()
    : undefined;

  // Extract visible text/placeholder and class name (strictly value-free)
  const visibleText = extractVisibleText(element);
  const className = extractClassName(element);

  // Return plain, serializable object with no circular references or DOM bindings
  const elementInfo: ActionElementInfo = {
    tagName,
  };

  if (visibleText !== undefined) {
    elementInfo.visibleText = visibleText;
  }

  if (elementId !== undefined) {
    elementInfo.id = elementId;
  }

  if (className !== undefined) {
    elementInfo.className = className;
  }

  return elementInfo;
}

/**
 * Safely extracts normalized ActionPageInfo from the active browser window/document.
 *
 * @returns A plain, serializable ActionPageInfo object
 */
export function extractPageInfo(): ActionPageInfo {
  const url = typeof window !== 'undefined' && window.location ? window.location.href : '';
  const title = typeof document !== 'undefined' && document.title ? document.title.trim() : '';

  return {
    url,
    title,
  };
}
