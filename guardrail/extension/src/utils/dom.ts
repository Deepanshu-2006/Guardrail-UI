/**
 * Guardrail DOM Action Extractor Utility
 *
 * Safely inspects browser DOM elements and extracts lightweight, normalized,
 * JSON-serializable representations matching the GuardrailAction data model.
 *
 * Does not retain live references to DOM nodes.
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
  const interactive = target.closest<HTMLElement>(INTERACTIVE_CLICK_SELECTOR);
  return interactive || null;
}

/**
 * Safely extracts human-readable visible text from a DOM element.
 *
 * @param element The target DOM element
 * @returns Cleaned text string or undefined if empty
 */
function extractVisibleText(element: HTMLElement | Element): string | undefined {
  let rawText = '';

  if (element instanceof HTMLInputElement) {
    // For button-like inputs (e.g., <input type="submit" value="Pay Now" />)
    if (['submit', 'button', 'reset'].includes(element.type.toLowerCase()) && element.value) {
      rawText = element.value;
    } else if (element.placeholder) {
      rawText = element.placeholder;
    }
  } else if ('innerText' in element && typeof (element as HTMLElement).innerText === 'string') {
    // innerText reflects what is rendered on screen (aware of CSS styling and visibility)
    rawText = (element as HTMLElement).innerText;
  } else if (element.textContent) {
    // Fallback to textContent for non-HTML elements or unrendered DOM fragments
    rawText = element.textContent;
  }

  const trimmed = rawText.replace(/\s+/g, ' ').trim();

  // Return undefined for empty strings to keep JSON payload minimal
  if (!trimmed) {
    return undefined;
  }

  // Cap length to prevent gigantic text payloads if a container element is clicked
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

  // Extract visible text and class name
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
