/**
 * Guardrail Action Detector
 *
 * Ambient sensor layer that observes user and browser interactions across the webpage.
 * Uses event delegation on document to detect CLICK, INPUT, SUBMIT, and NAVIGATION events,
 * transforms them into normalized GuardrailAction models, and emits them to the callback handler.
 */

import { ActionType, GuardrailAction } from '../types/index.js';
import {
  findControlledTestAction,
  findFormInputElement,
  findInteractiveElement,
  isFormSubmitTrigger,
} from '../utils/index.js';
import { createGuardrailAction } from './action-factory.js';
import { isTrustedDomain } from '../config/registry.js';

export type ActionHandler = (action: GuardrailAction) => void;
export type InterceptHandler = (
  action: GuardrailAction,
  element: HTMLElement,
  event: Event
) => void;

/**
 * Checks if the current webpage execution environment is the Trusted Contact Portal Dashboard
 * or internal Guardrail page, which must remain completely exempt from action detection.
 */
function isDashboardOrInternalPage(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (
    (typeof document.getElementById === 'function' && document.getElementById('dashboard-app')) ||
    (typeof document.querySelector === 'function' && document.querySelector('[role="application"][aria-label*="Guardrail"]'))
  ) {
    return true;
  }
  if (typeof document.title === 'string' && document.title.includes('Guardrail — Trusted Contact Portal')) {
    return true;
  }
  const loc = window.location;
  if (loc) {
    if (loc.port === '5173') {
      return true;
    }
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime?.id &&
      loc.origin === `chrome-extension://${chrome.runtime.id}`
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates whether a destination URL represents an untrusted web destination
 * that must be intercepted before navigation is permitted.
 */
function isUntrustedDestination(urlCandidate?: string): boolean {
  if (!urlCandidate || typeof urlCandidate !== 'string') return false;
  const trimmed = urlCandidate.trim();
  // Only evaluate valid web schemes
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    // Localhost and loopback development environments are always trusted
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return false;
    }
    // Allowlisted trusted domains
    if (isTrustedDomain(trimmed)) {
      return false;
    }
    // Same origin as current page is not an external untrusted navigation
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      if (parsed.origin === window.location.origin) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export class ActionDetector {
  private lastTrackedUrl: string = '';
  private onAction: ActionHandler;
  private onIntercept?: InterceptHandler;
  private isRunning: boolean = false;
  private activeSubmitTrigger: HTMLElement | null = null;

  constructor(onAction: ActionHandler, onIntercept?: InterceptHandler) {
    this.onAction = onAction;
    this.onIntercept = onIntercept;
  }

  /**
   * Starts ambient action observation on the active webpage document.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Initial Page Navigation & SPA Transition Observers
    this.initNavigationDetection();

    // 2. Document-level Event Listeners (Event Delegation)
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('change', this.handleChange, true);
    document.addEventListener('submit', this.handleSubmit, true);
  }

  /**
   * Stops action observation and cleans up event listeners.
   */
  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.activeSubmitTrigger = null;

    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('change', this.handleChange, true);
    document.removeEventListener('submit', this.handleSubmit, true);
    window.removeEventListener('popstate', this.handleSpaNavigation);
    window.removeEventListener('hashchange', this.handleSpaNavigation);
  }

  /**
   * Observes initial page navigation and client-side SPA routing.
   */
  private initNavigationDetection(): void {
    // Initial page load navigation
    this.trackNavigation();

    // SPA routing history transitions
    window.addEventListener('popstate', this.handleSpaNavigation);
    window.addEventListener('hashchange', this.handleSpaNavigation);
  }

  private handleSpaNavigation = (): void => {
    this.trackNavigation();
  };

  /**
   * Tracks a page navigation event if the URL has changed.
   */
  public trackNavigation(explicitPreviousUrl?: string): void {
    if (isDashboardOrInternalPage()) {
      return;
    }

    const currentUrl = typeof window !== 'undefined' && window.location ? window.location.href : '';
    if (!currentUrl || currentUrl === this.lastTrackedUrl) {
      return;
    }

    const previousUrl = explicitPreviousUrl || this.lastTrackedUrl || document.referrer || undefined;
    this.lastTrackedUrl = currentUrl;

    const action = createGuardrailAction(ActionType.NAVIGATION, null, previousUrl);
    this.emitAction(action);
  }

  /**
   * Handles generic click events via event delegation.
   */
  private handleClick = (event: MouseEvent): void => {
    // 0. Exemption for Dashboard & Internal Guardrail Pages
    if (isDashboardOrInternalPage()) {
      return;
    }

    // 1. Check for form submit trigger:
    // When a submit button or submit input is clicked, defer to handleSubmit.
    // This prevents duplicate handling (emitting both a CLICK action and a SUBMIT action),
    // and preserves submitter button metadata (formaction, formmethod, text) for evaluation.
    const targetElement = event.target instanceof Element ? event.target : null;
    const submitTrigger = targetElement?.closest<HTMLElement>('button, input[type="submit"]');
    if (submitTrigger && isFormSubmitTrigger(submitTrigger)) {
      this.activeSubmitTrigger = submitTrigger;
      return;
    }

    // 2. Controlled Action Interception (Day 8 Integration):
    // If the element is explicitly marked with data-guardrail-test-action,
    // route directly to interception handler passing the action, element, and original event.
    // The decision to halt execution or permit it is governed by the Response Engine integration.
    const controlledTestAction = findControlledTestAction(event.target);
    if (controlledTestAction) {
      if (!controlledTestAction.isConnected) {
        try {
          event.preventDefault();
          event.stopImmediatePropagation();
        } catch {
          // A detached target cannot be resumed; suppress only when the event allows it.
        }
        return;
      }
      const action = createGuardrailAction(ActionType.CLICK, controlledTestAction);

      if (this.onIntercept) {
        try {
          this.onIntercept(action, controlledTestAction, event);
        } catch {
          console.error('[Guardrail Detector] Action interception handler failed; supported event was suppressed.');
          // FAIL-CLOSED INVARIANT: Synchronously suppress the event if an interception error occurs.
          // Exceptions must not silently convert a required protective decision into an unrestricted action.
          try {
            event.preventDefault();
            event.stopImmediatePropagation();
          } catch {
            // Ignore if event cannot be cancelled
          }
        }
      } else {
        this.emitAction(action);
      }
      return;
    }

    // 3. Ambient Interactive Element Detection:
    const interactiveElement = findInteractiveElement(event.target);
    if (!interactiveElement) {
      return;
    }

    // De-duplicate: Defer submit buttons to the higher-level SUBMIT event
    if (isFormSubmitTrigger(interactiveElement)) {
      return;
    }

    const action = createGuardrailAction(ActionType.CLICK, interactiveElement);

    // 4. Pre-Navigation Interception for Untrusted Websites:
    // If the element attempts to open or navigate to an untrusted domain/URL,
    // synchronously halt the navigation BEFORE the browser navigates away,
    // and present the warning modal with caretaker approval flow.
    const destUrl = action.element?.targetUrl || action.element?.formAction;
    if (destUrl && isUntrustedDestination(destUrl)) {
      try {
        event.preventDefault();
        event.stopImmediatePropagation();
      } catch {
        // Ignore if uncancelable
      }
      if (this.onIntercept) {
        try {
          this.onIntercept(action, interactiveElement, event);
          return;
        } catch (err) {
          console.error('[Guardrail Detector] Interception handler failed for untrusted destination:', err);
        }
      }
      this.emitAction(action);
      return;
    }

    this.emitAction(action);
  };

  /**
   * Handles generic form control input/change events via event delegation.
   */
  private handleChange = (event: Event): void => {
    if (isDashboardOrInternalPage()) {
      return;
    }

    const inputElement = findFormInputElement(event.target);
    if (!inputElement) {
      return;
    }

    const action = createGuardrailAction(ActionType.INPUT, inputElement);
    this.emitAction(action);
  };

  /**
   * Handles generic form submit events via event delegation.
   */
  private handleSubmit = (event: Event): void => {
    if (isDashboardOrInternalPage()) {
      return;
    }

    let formElement: HTMLFormElement | null = null;
    if (event.target instanceof HTMLFormElement) {
      formElement = event.target;
    } else if (event.target instanceof Element) {
      formElement = event.target.closest('form');
    }

    if (!formElement) {
      this.activeSubmitTrigger = null;
      return;
    }

    // Resolve submitter element (native submitter or recorded activeSubmitTrigger)
    const submitterCandidate = (event as any).submitter;
    const submitter =
      ((typeof HTMLElement !== 'undefined' && submitterCandidate instanceof HTMLElement) ||
       (typeof Element !== 'undefined' && submitterCandidate instanceof Element) ||
       (submitterCandidate && submitterCandidate.tagName)
        ? (submitterCandidate as HTMLElement)
        : null) ||
      this.activeSubmitTrigger ||
      null;
    this.activeSubmitTrigger = null;

    // Check if either the submitter button or enclosing form is marked as a controlled test action
    const controlledTestAction =
      (submitter ? findControlledTestAction(submitter) : null) ||
      findControlledTestAction(formElement);

    if (controlledTestAction) {
      if (!controlledTestAction.isConnected || !formElement.isConnected) {
        try {
          event.preventDefault();
          event.stopImmediatePropagation();
        } catch {
          // Ignore if detached
        }
        return;
      }
      const action = createGuardrailAction(ActionType.SUBMIT, formElement, undefined, submitter);

      if (this.onIntercept) {
        try {
          this.onIntercept(action, controlledTestAction, event);
        } catch {
          console.error('[Guardrail Detector] Form action interception handler failed; supported event was suppressed.');
          try {
            event.preventDefault();
            event.stopImmediatePropagation();
          } catch {
            // Ignore
          }
        }
      } else {
        this.emitAction(action);
      }
      return;
    }

    const action = createGuardrailAction(ActionType.SUBMIT, formElement, undefined, submitter);

    // Pre-Navigation Interception for Untrusted Form Destinations:
    const formDest = action.element?.formAction;
    if (formDest && isUntrustedDestination(formDest)) {
      try {
        event.preventDefault();
        event.stopImmediatePropagation();
      } catch {}
      if (this.onIntercept) {
        try {
          this.onIntercept(action, formElement, event);
          return;
        } catch {}
      }
      this.emitAction(action);
      return;
    }

    this.emitAction(action);
  };

  /**
   * Emits the normalized action to the consumer callback.
   */
  private emitAction(action: GuardrailAction): void {
    try {
      this.onAction(action);
    } catch {
      console.error('[Guardrail Detector] Action subscriber callback failed.');
    }
  }
}
