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
 * Helper to determine if an event target originates from within Guardrail's internal UI
 * (e.g. Warning Modal or Staging Mode Shadow DOM host).
 */
export function isInternalGuardrailUi(target: Element): boolean {
  if (
    target.id === 'guardrail-warning-ui-host' ||
    target.id === 'guardrail-staging-ui-host' ||
    Boolean(target.closest?.('#guardrail-warning-ui-host')) ||
    Boolean(target.closest?.('#guardrail-staging-ui-host'))
  ) {
    return true;
  }

  if (typeof target.getRootNode === 'function') {
    const root = target.getRootNode();
    if (root instanceof ShadowRoot && root.host) {
      const hostId = (root.host as Element).id;
      if (hostId === 'guardrail-warning-ui-host' || hostId === 'guardrail-staging-ui-host') {
        return true;
      }
    }
  }

  return false;
}

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

  // Ignore interactions originating from within Guardrail's internal UI
  if (isInternalGuardrailUi(target)) {
    return null;
  }

  // Locate the nearest interactive element ancestor or the element itself
  return target.closest<HTMLElement>(INTERACTIVE_CLICK_SELECTOR) || null;
}

/**
 * Attribute name identifying controlled test actions targeted for proof-of-interception.
 */
export const GUARDRAIL_TEST_ACTION_ATTR = 'data-guardrail-test-action';

/**
 * Checks if the target element or any ancestor is explicitly marked with the
 * data-guardrail-test-action attribute on our controlled test website.
 *
 * Scoped strictly to explicitly marked controls to prevent interfering with
 * normal page elements, password managers, or browser UI.
 *
 * @param target The event target
 * @returns The marked HTMLElement, or null if not a marked test action
 */
export function findControlledTestAction(target: EventTarget | null): HTMLElement | null {
  if (!target || !(target instanceof Element)) {
    return null;
  }

  // Ignore interactions originating from within Guardrail's internal UI
  if (isInternalGuardrailUi(target)) {
    return null;
  }

  return target.closest<HTMLElement>(`[${GUARDRAIL_TEST_ACTION_ATTR}]`) || null;
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

  // Ignore form controls originating from within Guardrail's internal UI
  if (
    target.id === 'guardrail-warning-ui-host' ||
    target.closest('#guardrail-warning-ui-host')
  ) {
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

  // Safe extraction of destination URL for links (without live DOM or form inputs)
  if (typeof HTMLAnchorElement !== 'undefined' && element instanceof HTMLAnchorElement && element.href) {
    elementInfo.targetUrl = element.href;
  } else if ('href' in element && typeof (element as any).href === 'string' && (element as any).href) {
    elementInfo.targetUrl = (element as any).href;
  } else if (typeof element.getAttribute === 'function') {
    const rawAttr = element.getAttribute('href');
    if (rawAttr && typeof rawAttr === 'string' && !rawAttr.startsWith('#')) {
      try {
        const base = typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost';
        elementInfo.targetUrl = new URL(rawAttr, base).href;
      } catch {
        elementInfo.targetUrl = rawAttr;
      }
    }
  }

  // Safe extraction of structural form and submission metadata (strictly value-free)
  try {
    let enclosingForm: HTMLFormElement | any | null = null;
    const isForm = (el: any): boolean => {
      if (!el) return false;
      if (typeof HTMLFormElement !== 'undefined' && el instanceof HTMLFormElement) return true;
      return el.tagName === 'FORM';
    };

    if (isForm(element)) {
      enclosingForm = element;
    } else if (typeof element.closest === 'function') {
      enclosingForm = element.closest('form');
    }

    if (!enclosingForm && 'form' in element && isForm((element as any).form)) {
      enclosingForm = (element as any).form;
    }

    if (enclosingForm) {
      // Resolve form action target safely
      let rawAction = '';
      if (typeof element.getAttribute === 'function' && element.getAttribute('formaction')) {
        rawAction = element.getAttribute('formaction') || '';
      } else if (enclosingForm.action) {
        rawAction = enclosingForm.action;
      } else if (typeof enclosingForm.getAttribute === 'function' && enclosingForm.getAttribute('action')) {
        rawAction = enclosingForm.getAttribute('action') || '';
      }

      if (rawAction && rawAction.trim().length > 0) {
        try {
          const base = typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost';
          elementInfo.formAction = new URL(rawAction, base).href;
        } catch {
          elementInfo.formAction = rawAction;
        }

        if (!elementInfo.targetUrl) {
          elementInfo.targetUrl = elementInfo.formAction;
        }
      }

      // Safe extraction of HTTP submission method
      let rawMethod = '';
      if (typeof element.getAttribute === 'function' && element.hasAttribute('formmethod')) {
        rawMethod = element.getAttribute('formmethod') || '';
      } else if (enclosingForm.method) {
        rawMethod = enclosingForm.method;
      }
      elementInfo.formMethod = rawMethod ? rawMethod.toUpperCase() : 'GET';

      // Safe structural detection of password field presence in form (strictly boolean, zero value extraction)
      if (typeof enclosingForm.querySelector === 'function') {
        const pwdInput = enclosingForm.querySelector('input[type="password"]');
        elementInfo.hasPasswordField = Boolean(pwdInput);

        const usernameInput = enclosingForm.querySelector(
          'input[type="text"], input[type="email"], input[autocomplete*="username"], input[name*="user"], input[name*="login"], input[name*="email"]'
        );
        elementInfo.hasUsernameField = Boolean(usernameInput);
      }
    } else if (element instanceof HTMLInputElement) {
      if (element.type?.toLowerCase() === 'password') {
        elementInfo.hasPasswordField = true;
      }
      const name = (element.name || element.id || '').toLowerCase();
      if (['text', 'email'].includes(element.type?.toLowerCase() || '') && (name.includes('user') || name.includes('login') || name.includes('email'))) {
        elementInfo.hasUsernameField = true;
      }
    }
  } catch {
    // Non-critical: Ignore structural form extraction failures gracefully
  }

  return elementInfo;
}

/**
 * Safely extracts normalized ActionPageInfo from the active browser window/document.
 *
 * @param previousUrl Optional explicit previous URL or referrer
 * @returns A plain, serializable ActionPageInfo object
 */
export function extractPageInfo(previousUrl?: string): ActionPageInfo {
  const url = typeof window !== 'undefined' && window.location ? window.location.href : '';
  const title = typeof document !== 'undefined' && document.title ? document.title.trim() : '';
  const referrer = typeof document !== 'undefined' && document.referrer ? document.referrer : undefined;

  const resolvedPrevious = previousUrl || referrer || undefined;

  const pageInfo: ActionPageInfo = {
    url,
    title,
  };

  if (resolvedPrevious && resolvedPrevious !== url) {
    pageInfo.previousUrl = resolvedPrevious;
  }

  if (typeof window !== 'undefined') {
    pageInfo.isSecureContext = typeof window.isSecureContext === 'boolean'
      ? window.isSecureContext
      : (window.location?.protocol === 'https:' || window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1');
  }

  if (typeof document !== 'undefined') {
    try {
      const iconEl = document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null;
      if (iconEl && iconEl.href) {
        pageInfo.faviconUrl = iconEl.href;
      }

      const metaBrandingEl = document.querySelector('meta[property="og:site_name"]') || document.querySelector('meta[name="application-name"]');
      const brandingContent = metaBrandingEl?.getAttribute('content')?.trim();
      if (brandingContent) {
        pageInfo.metaBranding = brandingContent;
      }
    } catch {
      // Safe fallback
    }
  }

  return pageInfo;
}
