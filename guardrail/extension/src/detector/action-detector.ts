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

export type ActionHandler = (action: GuardrailAction) => void;
export type InterceptHandler = (
  action: GuardrailAction,
  element: HTMLElement,
  event: MouseEvent
) => void;

export class ActionDetector {
  private lastTrackedUrl: string = '';
  private onAction: ActionHandler;
  private onIntercept?: InterceptHandler;
  private isRunning: boolean = false;

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
    const interactiveElement = findInteractiveElement(event.target);
    if (!interactiveElement) {
      return;
    }

    // Controlled Action Interception (Day 8 Integration):
    // If the element is explicitly marked with data-guardrail-test-action,
    // route to interception handler passing the action, element, and original event.
    // The decision to halt execution or permit it is governed by the Response Engine integration.
    const controlledTestAction = findControlledTestAction(event.target);
    if (controlledTestAction) {
      const action = createGuardrailAction(ActionType.CLICK, controlledTestAction);

      if (this.onIntercept) {
        try {
          this.onIntercept(action, controlledTestAction, event);
        } catch (err) {
          console.error('[Guardrail Detector] Error in action interception handler:', err);
        }
      } else {
        this.emitAction(action);
      }
      return;
    }

    // De-duplicate: Defer submit buttons to the higher-level SUBMIT event
    if (isFormSubmitTrigger(interactiveElement)) {
      return;
    }

    const action = createGuardrailAction(ActionType.CLICK, interactiveElement);
    this.emitAction(action);
  };

  /**
   * Handles generic form control input/change events via event delegation.
   */
  private handleChange = (event: Event): void => {
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
    let formElement: HTMLFormElement | null = null;
    if (event.target instanceof HTMLFormElement) {
      formElement = event.target;
    } else if (event.target instanceof Element) {
      formElement = event.target.closest('form');
    }

    if (!formElement) {
      return;
    }

    const action = createGuardrailAction(ActionType.SUBMIT, formElement);
    this.emitAction(action);
  };

  /**
   * Emits the normalized action to the consumer callback.
   */
  private emitAction(action: GuardrailAction): void {
    try {
      this.onAction(action);
    } catch (err) {
      console.error('[Guardrail Detector] Error in action subscriber callback:', err);
    }
  }
}
