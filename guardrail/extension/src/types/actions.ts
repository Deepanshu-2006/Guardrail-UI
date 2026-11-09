/**
 * Guardrail Action Model
 *
 * Defines the normalized interaction data structures observed across web pages.
 * Acts as the standard data contract between the content script sensors,
 * action classifiers, service worker coordinator, and future policy/risk evaluation engines.
 */

import type { DownloadItemMetadata } from './download.js';

/**
 * Canonical interaction types recognized by Guardrail.
 * Describes the physical/DOM mechanism through which an interaction occurred.
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
 * Canonical semantic categories describing WHAT an interaction represents.
 * Captures the domain intent behind an action, independent of risk severity scoring.
 */
export enum ActionCategory {
  /** Routine interactions with standard UI controls */
  GENERAL = 'GENERAL',

  /** Login, registration, password entry, credential updates, 2FA */
  AUTHENTICATION = 'AUTHENTICATION',

  /** Checkout, fund transfers, payments, credit card input, billing */
  PAYMENT = 'PAYMENT',

  /** Permanent deletions, account cancellations, data purging, destructive updates */
  DESTRUCTIVE = 'DESTRUCTIVE',

  /** File downloads, document exports, software installation packages */
  DOWNLOAD = 'DOWNLOAD',

  /** Navigating away to external third-party websites or untrusted domains */
  EXTERNAL_NAVIGATION = 'EXTERNAL_NAVIGATION',
}

/**
 * String union type representing valid ActionCategory values.
 */
export type ActionCategoryString =
  | 'GENERAL'
  | 'AUTHENTICATION'
  | 'PAYMENT'
  | 'DESTRUCTIVE'
  | 'DOWNLOAD'
  | 'EXTERNAL_NAVIGATION';

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

  /** Destination URL or link target if element is an anchor or actionable link */
  targetUrl?: string;

  /** Form submission destination URL if element is a form or form submission trigger */
  formAction?: string;

  /** HTTP method of the enclosing form (e.g. 'POST', 'GET') */
  formMethod?: string;

  /** Structural indicator: true if the enclosing form or element contains a password input control (strictly without value) */
  hasPasswordField?: boolean;

  /** Structural indicator: true if the enclosing form or element contains username/email/account input controls */
  hasUsernameField?: boolean;

  /** Structural indicator: true if form contains sensitive inputs (password, card, OTP, SSN) strictly without values */
  hasSensitiveField?: boolean;

  /** Categorical types of sensitive inputs present in the form (e.g. ['password', 'payment_card']) */
  sensitiveFieldTypes?: readonly string[];

  /** Initial form action declared in HTML when form was first observed in DOM (for detecting dynamic modifications) */
  formInitialAction?: string;

  /** True if submit trigger specifies a formaction attribute that overrides the enclosing form's action */
  hasFormActionOverride?: boolean;

  /** True if form action attribute was missing or empty string */
  isFormActionMissing?: boolean;

  /** Raw unnormalized form action attribute value before URL resolution */
  rawFormAction?: string;

  /** Visible text or label on the clicked submit button/trigger */
  submitButtonText?: string;

  /** Value of download attribute if element is an anchor with download specified */
  downloadAttribute?: string;

  /** Associated download item metadata if element triggered or represents a download */
  downloadInfo?: DownloadItemMetadata;
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

  /** Indicates whether the webpage execution environment is a secure context (HTTPS / local loopback) */
  isSecureContext?: boolean;

  /** Safely extracted icon URL from link[rel~="icon"] metadata if present */
  faviconUrl?: string;

  /** Safely extracted website branding title from meta[property="og:site_name"] or meta[name="application-name"] */
  metaBranding?: string;
}

/**
 * Core normalized interaction model representing a single captured user/agent action.
 */
export interface GuardrailAction {
  /** Unique action identifier for event tracing and audit logging (e.g., UUID or nanoid) */
  id: string;

  /** Categorized DOM event mechanism */
  type: ActionType;

  /** Semantic category classifying the domain intent of the action */
  category?: ActionCategory;

  /** Detailed metadata about the targeted DOM element (omitted for global page events like navigation) */
  element?: ActionElementInfo;

  /** Associated browser download metadata if action corresponds to a download event */
  download?: DownloadItemMetadata;

  /** Contextual information about the active webpage */
  page: ActionPageInfo;

  /** ISO 8601 string or epoch milliseconds timestamp when the action occurred */
  timestamp: string;
}

import type { ActionClassificationResult } from './classification.js';
import type { RiskAssessment } from './risk.js';
import type { ResponseDecision } from './response.js';
import type { InterceptionRecord } from './interception.js';

/**
 * Extension message carrying a normalized GuardrailAction payload, optional classification, risk assessment, response decision, and interception record.
 */
export interface GuardrailActionMessage {
  type: 'GUARDRAIL_ACTION';
  action: GuardrailAction;
  classification?: ActionClassificationResult;
  risk?: RiskAssessment;
  decision?: ResponseDecision;
  interception?: InterceptionRecord;
}
