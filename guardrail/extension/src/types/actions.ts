/**
 * Guardrail Action Model
 *
 * Defines the normalized interaction data structures observed across web pages.
 * Acts as the standard data contract between the content script sensors,
 * service worker coordinator, and future policy/risk evaluation engines.
 */

/**
 * Canonical interaction types recognized by Guardrail.
 */
export enum ActionType {
  /** User or automated click on a button, link, or actionable element */
  CLICK = 'CLICK',

  /** Keystrokes, text entry, or value changes in input fields, textareas, or selects */
  INPUT = 'INPUT',

  /** Form submission (via submit button or Enter key) */
  SUBMIT = 'SUBMIT',

  /** Page navigation, URL route changes, or tab redirections */
  NAVIGATION = 'NAVIGATION',
}

/**
 * String union type representing valid ActionType values.
 */
export type ActionTypeString = 'CLICK' | 'INPUT' | 'SUBMIT' | 'NAVIGATION';

/**
 * Normalized representation of the DOM element involved in an interaction.
 * Serialized and detached from the browser's live DOM tree.
 */
export interface ActionElementInfo {
  /** HTML tag name in uppercase (e.g., 'BUTTON', 'INPUT', 'A') */
  tagName: string;

  /** Visible human-readable text on or within the element (trimmed) */
  visibleText?: string;

  /** Element ID attribute if present (e.g., 'submit-btn') */
  id?: string;

  /** Element CSS class attribute string if present (e.g., 'btn btn-primary') */
  className?: string;
}

/**
 * Normalized context of the webpage where the interaction took place.
 */
export interface ActionPageInfo {
  /** Full URL of the page at the moment of interaction */
  url: string;

  /** Document title of the webpage */
  title: string;

  /** Referrer or previous URL before navigation occurred (if safely available) */
  previousUrl?: string;
}

/**
 * Core normalized interaction model representing a single captured user/agent action.
 */
export interface GuardrailAction {
  /** Unique action identifier for event tracing and audit logging (e.g., UUID or nanoid) */
  id: string;

  /** Categorized type of interaction */
  type: ActionType;

  /** Detailed metadata about the targeted DOM element (omitted for global page events like navigation) */
  element?: ActionElementInfo;

  /** Contextual information about the active webpage */
  page: ActionPageInfo;

  /** ISO 8601 string or epoch milliseconds timestamp when the action occurred */
  timestamp: string;
}

/**
 * Extension message carrying a normalized GuardrailAction payload.
 */
export interface GuardrailActionMessage {
  type: 'GUARDRAIL_ACTION';
  action: GuardrailAction;
}
