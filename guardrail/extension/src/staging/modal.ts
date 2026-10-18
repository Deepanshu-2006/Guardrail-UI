/**
 * Guardrail Staging Mode - Visual Shell Component
 *
 * Implements the isolated, accessible, and trustworthy visual shell for Staging Mode.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. SHADOW DOM ISOLATION:
 *    - Attached to a transient host container (`#guardrail-staging-ui-host`) with an open Shadow Root.
 *    - Completely isolates Staging UI typography, layout, and colors from host webpage styles.
 * 2. RESTRAINED & ACCESSIBLE DESIGN:
 *    - Calm, trustworthy neutral palette with restrained green accents for normal actions,
 *      amber for elevated risk, and reserved crimson for critical operations.
 *    - Large, legible typography and generous spacing designed for non-technical and elderly users.
 * 3. STRICT DOM SAFETY:
 *    - Renders all dynamic text using `.textContent` and standard DOM manipulation APIs.
 *    - Never uses unsafe `innerHTML` for dynamic content, eliminating XSS risks.
 * 4. SINGLETON LIFECYCLE:
 *    - Guarantees exactly one active panel at any time. Automatically removes previous instances
 *      and cleans up window event listeners upon dismissal.
 * 5. COMPREHENSIVE VIEW STATES:
 *    - Supports 'active' (held action review), 'loading' (context gathering), and 'empty' (no action held) states.
 */

import { ActionCategory, ActionType } from '../types/actions.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { RiskLevel } from '../types/risk.js';
import { StagingActionContext } from '../types/staging.js';
import {
  ApprovalRequest,
  ApprovalRequestIntent,
  ApprovalRequestResult,
  ApprovalStatus,
  GuardrailSubmitApprovalRequestResponse,
} from '../types/approval.js';
import {
  CancellationResult,
  ContinuationManager,
  defaultContinuationManager,
} from '../interception/continuation.js';
import {
  defaultInterceptionController,
  type InterceptionController,
} from '../interception/controller.js';
import { createApprovalRequestIntent } from './context.js';
import {
  dispatchApprovalRequestToBackground,
  dispatchSubmitApprovalRequestToBackground,
} from '../utils/messaging.js';
import {
  SubmissionOutcome,
  submitApprovalRequest,
} from '../approval/submit-operation.js';
import { ApprovalApiClient } from '../approval/client.js';
import {
  sanitizeApprovalErrorMessage,
  validateBackendApprovalResponse,
} from './status.js';

export const STAGING_HOST_ELEMENT_ID = 'guardrail-staging-ui-host';

export type StagingDisplayState = 'active' | 'loading' | 'empty';

/**
 * Explicit, mutually distinct interface states for Staging Mode operations.
 */
export type StagingInterceptionUIState =
  | 'held'
  | 'cancelling'
  | 'cancelled'
  | 'approval_intent_recorded'
  | 'stale_or_invalid'
  | 'submitting_approval'
  | 'approval_requested'
  | 'approval_confirmed_approved'
  | 'approval_confirmed_rejected'
  | 'approval_confirmed_expired'
  | 'approval_confirmed_cancelled'
  | 'approval_uncertain'
  | 'approval_failed'
  | 'malformed_response';

export interface StagingModalOptions {
  /** The prepared staging action context (required when state is 'active') */
  context?: StagingActionContext;

  /** Visual state of the staging modal: 'active', 'loading', or 'empty' */
  state?: StagingDisplayState;

  /** Callback invoked when the modal is closed or dismissed */
  onDismiss?: () => void;

  /** Optional callback for primary action click (shell preview) */
  onPrimaryAction?: () => void;

  /** Optional custom or delegated cancel handler */
  onCancel?: (
    actionId: string
  ) =>
    | CancellationResult
    | Promise<CancellationResult>
    | { success: boolean; actionId: string; error?: string; record?: InterceptionRecord };

  /** InterceptionController instance to use (defaults to defaultInterceptionController) */
  controller?: InterceptionController;

  /** ContinuationManager instance to use (defaults to defaultContinuationManager) */
  continuationManager?: ContinuationManager;

  /** Optional callback invoked upon successful cancellation */
  onCancelSuccess?: (result: CancellationResult) => void;

  /** Optional callback invoked upon cancellation error / rejection */
  onCancelError?: (result: CancellationResult) => void;

  /** Optional custom or delegated approval request handler */
  onRequestApproval?: (
    context: StagingActionContext
  ) => ApprovalRequestResult | Promise<ApprovalRequestResult>;

  /** Optional callback invoked upon successful local approval request intent creation */
  onRequestApprovalSuccess?: (result: ApprovalRequestResult) => void;

  /** Optional callback invoked upon approval request rejection or error */
  onRequestApprovalError?: (result: ApprovalRequestResult) => void;

  /**
   * Whether to connect to the real backend approval submission operation.
   * When true or when live extension runtime is detected, submits through the real API.
   */
  useRealBackend?: boolean;

  /** Optional custom ApprovalApiClient instance (useful for dependency injection in tests) */
  apiClient?: ApprovalApiClient;

  /** Optional direct submit operation function (useful for dependency injection in tests) */
  submitApprovalRequest?: typeof submitApprovalRequest;
}

let activeKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let currentHost: HTMLDivElement | null = null;
let currentShadow: ShadowRoot | null = null;
let currentUIState: StagingInterceptionUIState | null = null;
let previousActiveElement: HTMLElement | null = null;
let currentMountedActionId: string | null = null;
let currentModalSessionId: number = 0;

/**
 * Checks whether the Guardrail Staging Modal is currently mounted in the document.
 */
export function isStagingModalActive(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.getElementById(STAGING_HOST_ELEMENT_ID));
}

/**
 * Returns the active ShadowRoot of the Staging Modal for testing and inspection, if open.
 */
export function getStagingModalShadowRoot(): ShadowRoot | null {
  return currentShadow;
}

/**
 * Returns the current programmatic UI state of Staging Mode, or null if modal is not open.
 */
export function getStagingUIState(): StagingInterceptionUIState | null {
  return currentUIState;
}

/**
 * Returns the action ID currently mounted in the Staging Modal, or null if unmounted.
 */
export function getCurrentMountedActionId(): string | null {
  return currentMountedActionId;
}

/**
 * Returns the monotonic modal session sequence ID. Increments whenever the modal
 * is mounted, updated, or dismissed to prevent stale async responses from updating the UI.
 */
export function getCurrentModalSessionId(): number {
  return currentModalSessionId;
}

/**
 * Dismisses and cleans up the active Guardrail Staging Modal.
 * Removes host element, unregisters keyboard event listeners, and restores focus to page.
 */
export function dismissStagingModal(): void {
  if (activeKeyHandler && typeof window !== 'undefined') {
    window.removeEventListener('keydown', activeKeyHandler);
    activeKeyHandler = null;
  }

  if (currentHost && currentHost.parentNode) {
    currentHost.remove();
  }

  const existingInDom = typeof document !== 'undefined' ? document.getElementById(STAGING_HOST_ELEMENT_ID) : null;
  if (existingInDom && existingInDom.parentNode) {
    existingInDom.remove();
  }

  currentHost = null;
  currentShadow = null;
  currentUIState = null;
  currentMountedActionId = null;
  currentModalSessionId++;

  // Restore focus to previous active element before modal opened
  if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
    try {
      previousActiveElement.focus();
    } catch {
      // Ignore if element is detached
    }
  }
  previousActiveElement = null;
}

/**
 * Formats canonical ActionType into clean, user-friendly plain English.
 */
export function formatActionTypeName(type?: unknown): string {
  switch (type) {
    case ActionType.CLICK:
      return 'Button / Link Click';
    case ActionType.SUBMIT:
      return 'Form Submission';
    case ActionType.INPUT:
      return 'Text Entry';
    case ActionType.NAVIGATION:
      return 'Page Navigation';
    default:
      return 'Standard Interaction';
  }
}

/**
 * Formats canonical ActionCategory into a friendly plain English badge label.
 */
export function formatCategoryName(category?: unknown): string {
  switch (category) {
    case ActionCategory.PAYMENT:
      return 'Payment & Billing';
    case ActionCategory.DESTRUCTIVE:
      return 'Permanent Deletion / Removal';
    case ActionCategory.AUTHENTICATION:
      return 'Authentication & Login';
    case ActionCategory.DOWNLOAD:
      return 'File Download';
    case ActionCategory.EXTERNAL_NAVIGATION:
      return 'External Website';
    case ActionCategory.GENERAL:
    default:
      return 'General Activity';
  }
}

/**
 * Verifies whether a candidate hostname string is safe for plain-text UI rendering.
 */
function isValidSafeHostname(h: string): boolean {
  if (!h || typeof h !== 'string') return false;
  const trimmed = h.trim();
  if (trimmed.length === 0 || trimmed.length > 253) return false;

  // Disallow forbidden characters or schemes
  if (/[\s@?#/\\]/.test(trimmed)) return false;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return false;
  if (/[<>"']/.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower === 'about:blank' ||
    lower === 'null' ||
    lower === 'undefined'
  ) {
    return false;
  }

  return true;
}

/**
 * Safely extracts and validates a website hostname or origin for display.
 * Returns null if missing, invalid, or potentially hostile.
 */
export function getSafeDisplayHost(origin?: string, hostname?: string): string | null {
  // 1. Prefer hostname if present and valid
  if (hostname && typeof hostname === 'string') {
    const trimmed = hostname.trim();
    if (isValidSafeHostname(trimmed)) {
      return trimmed;
    }
  }

  // 2. Fall back to origin
  if (origin && typeof origin === 'string') {
    const trimmed = origin.trim();
    // Strictly reject any origins containing user credentials or tokens
    if (trimmed.includes('@')) {
      return null;
    }

    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('chrome-extension://') ||
      trimmed.startsWith('moz-extension://')
    ) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.hostname && isValidSafeHostname(parsed.hostname)) {
          return parsed.hostname;
        }
        if (parsed.origin && parsed.origin !== 'null' && !parsed.origin.includes('@')) {
          return parsed.origin;
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}

export interface TranslatedRiskReason {
  headline: string;
  detail: string;
}

/**
 * Translates technical risk signals and reasons supplied by the Risk Engine into
 * concise, reassuring, plain-language explanations for non-technical users.
 *
 * MAPPING TO EXISTING RISK ENGINE:
 * - PAYMENT_ACTION: Maps to "Payment or Billing Activity"
 * - DESTRUCTIVE_ACTION: Maps to "Permanent Removal or Deletion"
 * - AUTHENTICATION_ACTION: Maps to "Sign-in or Account Credentials"
 * - DOWNLOAD_ACTION: Maps to "File Download"
 * - EXTERNAL_NAVIGATION: Maps to "External Website Destination"
 * - Baseline routine: Maps to "Routine Interaction"
 * - Fallback / missing: Maps to "Standard Safety Check"
 *
 * PRIVACY & SAFETY GUARANTEES:
 * - Never claims an action is "malicious", "phishing", or "fraudulent".
 * - Never invents reasons or implies a caretaker or guardian was contacted.
 */
export function translateRiskReason(rawReason?: string): TranslatedRiskReason {
  if (!rawReason || typeof rawReason !== 'string' || !rawReason.trim()) {
    return {
      headline: 'Standard Safety Check',
      detail: 'Guardrail paused this action as a standard safety precaution based on current settings.',
    };
  }

  const trimmed = rawReason.trim();

  // Standard fallback phrasing
  if (
    trimmed.includes('standard safety precaution') ||
    trimmed.includes('standard safety settings') ||
    trimmed.includes('current Guardrail policy')
  ) {
    return {
      headline: 'Standard Safety Check',
      detail: trimmed,
    };
  }

  // 1. Payment Action signal reason
  if (
    trimmed.includes('financial transactions') ||
    trimmed.includes('billing elements') ||
    trimmed.includes('checkout flows')
  ) {
    return {
      headline: 'Payment or Billing Activity',
      detail: trimmed,
    };
  }

  // 2. Destructive Action signal reason
  if (
    trimmed.includes('permanent resource deletion') ||
    trimmed.includes('irreversible state destruction') ||
    trimmed.includes('cancellation')
  ) {
    return {
      headline: 'Permanent Removal or Deletion',
      detail: trimmed,
    };
  }

  // 3. Authentication Action signal reason
  if (
    trimmed.includes('authentication boundaries') ||
    trimmed.includes('credential inputs') ||
    trimmed.includes('login sessions')
  ) {
    return {
      headline: 'Sign-in or Account Credentials',
      detail: trimmed,
    };
  }

  // 4. Download Action signal reason
  if (
    trimmed.includes('file download') ||
    trimmed.includes('document export') ||
    trimmed.includes('software installation')
  ) {
    return {
      headline: 'File Download',
      detail: trimmed,
    };
  }

  // 5. External Navigation signal reason
  if (
    trimmed.includes('external destination') ||
    trimmed.includes('navigates away') ||
    trimmed.includes('untrusted or third-party origin')
  ) {
    return {
      headline: 'External Website Destination',
      detail: trimmed,
    };
  }

  // 6. Baseline Routine signal reason
  if (
    trimmed.includes('No elevated risk signals') ||
    trimmed.includes('Routine interaction')
  ) {
    return {
      headline: 'Routine Interaction',
      detail: trimmed,
    };
  }

  // 7. General / Custom risk reasons from extensions or policy overrides
  return {
    headline: 'Safety Review Signal',
    detail: trimmed,
  };
}

export interface RiskLevelPresentation {
  className: string;
  badgeLabel: string;
  headline: string;
  description: string;
}

/**
 * Maps the RiskLevel to accessible, reassuring visual tokens and headlines.
 *
 * STRICT REASSURANCE:
 * - Emphasizes operational sensitivity and user control.
 * - Never claims or implies malice, fraud, or third-party alerts.
 */
export function getRiskLevelPresentation(level?: unknown): RiskLevelPresentation {
  switch (level) {
    case RiskLevel.CRITICAL:
      return {
        className: 'gs-risk-critical',
        badgeLabel: 'Critical Impact',
        headline: '🛑 High-Impact Action: Permanent changes detected',
        description: 'This action may permanently delete data, remove content, or cancel an account. Please review carefully.',
      };
    case RiskLevel.HIGH:
      return {
        className: 'gs-risk-high',
        badgeLabel: 'Elevated Risk',
        headline: '⚠️ Sensitive Operation: Important step requires confirmation',
        description: 'This action involves payments, login credentials, or important settings. Please confirm before proceeding.',
      };
    case RiskLevel.MEDIUM:
      return {
        className: 'gs-risk-medium',
        badgeLabel: 'Moderate Risk',
        headline: 'ℹ️ Moderate Activity: State changes requested',
        description: 'This action may update account preferences, modify settings, or change page content.',
      };
    case RiskLevel.LOW:
    default:
      return {
        className: 'gs-risk-low',
        badgeLabel: 'Routine Activity',
        headline: '🟢 Routine Activity: Standard interaction',
        description: 'Standard everyday interaction evaluated under default Guardrail safety policies.',
      };
  }
}

/**
 * Generates the encapsulated CSS styles for the Staging Mode Shadow DOM.
 */
function createStagingStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #f8fafc;
      font-size: 14px;
      line-height: 1.5;
    }

    .gs-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(11, 15, 25, 0.82);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 2147483647;
      animation: gsFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .gs-shell {
      background: #0f172a;
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 18px;
      width: 100%;
      max-width: 620px;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: gsSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    /* Header & Brand Identity */
    .gs-header {
      padding: 18px 24px;
      background: rgba(30, 41, 59, 0.6);
      border-bottom: 1px solid rgba(148, 163, 184, 0.15);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .gs-brand-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .gs-brand-icon {
      font-size: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .gs-brand-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #f8fafc;
    }

    .gs-mode-pill {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.4);
      color: #38bdf8;
    }

    .gs-btn-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 18px;
      width: 44px;
      height: 44px;
      min-width: 44px;
      min-height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
      padding: 0;
      outline: none;
    }

    .gs-btn-close:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }

    /* Main Content Area */
    .gs-body {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      max-height: calc(85vh - 140px);
      overflow-y: auto;
    }

    /* Prominent Heading */
    .gs-heading-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .gs-heading-title {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.3;
      letter-spacing: -0.01em;
    }

    .gs-heading-subtitle {
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.5;
    }

    /* Action Summary Card */
    .gs-section-card {
      background: rgba(30, 41, 59, 0.45);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .gs-section-header {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .gs-action-summary-box {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 8px;
      padding: 12px 14px;
    }

    .gs-action-desc {
      font-size: 15px;
      font-weight: 600;
      color: #ffffff;
      line-height: 1.4;
      word-break: break-word;
    }

    .gs-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px 12px;
      font-size: 12px;
    }

    .gs-meta-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .gs-meta-label {
      color: #94a3b8;
      font-size: 11px;
    }

    .gs-meta-value {
      color: #e2e8f0;
      font-weight: 600;
      word-break: break-all;
    }

    /* Risk / Attention Area */
    .gs-risk-treatment {
      border-radius: 12px;
      padding: 16px;
      border: 1px solid transparent;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Normal / LOW Risk: Neutral slate with restrained green accent */
    .gs-risk-low {
      background: rgba(16, 185, 129, 0.05);
      border-color: rgba(16, 185, 129, 0.3);
    }
    .gs-risk-low .gs-risk-badge {
      background: rgba(16, 185, 129, 0.15);
      border-color: rgba(16, 185, 129, 0.4);
      color: #34d399;
    }

    /* MEDIUM Risk: Balanced slate-blue / soft warning */
    .gs-risk-medium {
      background: rgba(56, 189, 248, 0.05);
      border-color: rgba(56, 189, 248, 0.3);
    }
    .gs-risk-medium .gs-risk-badge {
      background: rgba(56, 189, 248, 0.15);
      border-color: rgba(56, 189, 248, 0.4);
      color: #38bdf8;
    }

    /* HIGH Risk: Warm amber treatment */
    .gs-risk-high {
      background: rgba(245, 158, 11, 0.06);
      border-color: rgba(245, 158, 11, 0.35);
    }
    .gs-risk-high .gs-risk-badge {
      background: rgba(245, 158, 11, 0.18);
      border-color: rgba(245, 158, 11, 0.45);
      color: #fbbf24;
    }

    /* CRITICAL Risk: Reserved stronger warning styling */
    .gs-risk-critical {
      background: rgba(239, 68, 68, 0.08);
      border-color: rgba(239, 68, 68, 0.4);
    }
    .gs-risk-critical .gs-risk-badge {
      background: rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.5);
      color: #f87171;
    }

    .gs-risk-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .gs-risk-badge {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 3px 10px;
      border-radius: 9999px;
      border: 1px solid;
    }

    .gs-risk-headline {
      font-size: 14px;
      font-weight: 600;
      color: #ffffff;
    }

    .gs-risk-subtext {
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.4;
    }

    .gs-reasons-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .gs-reason-item {
      font-size: 13px;
      color: #e2e8f0;
      line-height: 1.5;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .gs-reason-bullet {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.4;
      flex-shrink: 0;
    }

    .gs-reason-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .gs-reason-summary {
      font-weight: 600;
      color: #f8fafc;
      font-size: 13px;
      line-height: 1.4;
    }

    .gs-reason-detail {
      font-weight: 400;
      color: #cbd5e1;
      font-size: 12px;
      line-height: 1.4;
      word-break: break-word;
    }

    /* Footer / Actions */
    .gs-footer {
      padding: 16px 24px;
      background: rgba(15, 23, 42, 0.9);
      border-top: 1px solid rgba(148, 163, 184, 0.15);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .gs-footer-notice {
      font-size: 12px;
      color: #94a3b8;
    }

    .gs-btn-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .gs-btn {
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 10px 20px;
      min-height: 44px;
      min-width: 44px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease, border-color 0.15s ease;
      outline: none;
      border: 1px solid transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    /* Visible High-Contrast Focus Indicators (WCAG 2.4.7 / 2.4.11) */
    .gs-btn:focus-visible,
    .gs-btn-close:focus-visible {
      outline: 2px solid #38bdf8 !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.25) !important;
    }

    .gs-btn:focus:not(:focus-visible),
    .gs-btn-close:focus:not(:focus-visible) {
      outline: none;
    }

    .gs-btn-secondary {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.15);
      color: #cbd5e1;
    }

    .gs-btn-secondary:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }

    .gs-btn-primary {
      background: #0284c7;
      color: #ffffff;
      box-shadow: 0 2px 8px rgba(2, 132, 199, 0.3);
    }

    .gs-btn-primary:hover:not(:disabled) {
      background: #0369a1;
      transform: translateY(-1px);
    }

    .gs-btn-primary:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .gs-btn-cancel {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.35);
      color: #f87171;
    }

    .gs-btn-cancel:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.22);
      border-color: rgba(239, 68, 68, 0.6);
      color: #fca5a5;
      transform: translateY(-1px);
    }

    .gs-btn-cancel:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    /* Screen Reader Only Utility */
    .gs-sr-only {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }

    /* Confirmation & Status Banners */
    .gs-confirmation-banner {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      border-radius: 10px;
      margin-bottom: 20px;
      animation: gsFadeIn 0.2s ease-out;
    }

    .gs-confirmation-success {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.35);
    }

    .gs-confirmation-error {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
    }

    .gs-confirmation-info {
      background: rgba(14, 165, 233, 0.12);
      border: 1px solid rgba(14, 165, 233, 0.35);
    }

    .gs-confirmation-icon {
      font-size: 18px;
      line-height: 1;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .gs-confirmation-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .gs-confirmation-title {
      font-size: 14px;
      font-weight: 700;
    }

    .gs-confirmation-success .gs-confirmation-title {
      color: #34d399;
    }

    .gs-confirmation-error .gs-confirmation-title {
      color: #f87171;
    }

    .gs-confirmation-info .gs-confirmation-title {
      color: #38bdf8;
    }

    .gs-confirmation-desc {
      font-size: 13px;
      line-height: 1.45;
      color: #cbd5e1;
    }

    /* Distinct Interface State Badges */
    .gs-badge-held {
      background: rgba(56, 189, 248, 0.15) !important;
      color: #38bdf8 !important;
      border-color: rgba(56, 189, 248, 0.4) !important;
    }

    .gs-badge-cancelling {
      background: rgba(245, 158, 11, 0.18) !important;
      color: #fbbf24 !important;
      border-color: rgba(245, 158, 11, 0.45) !important;
    }

    .gs-badge-cancelled {
      background: rgba(148, 163, 184, 0.15) !important;
      color: #94a3b8 !important;
      border-color: rgba(148, 163, 184, 0.35) !important;
    }

    .gs-badge-requested {
      background: rgba(14, 165, 233, 0.15) !important;
      color: #38bdf8 !important;
      border-color: rgba(14, 165, 233, 0.35) !important;
    }

    .gs-badge-stale {
      background: rgba(239, 68, 68, 0.15) !important;
      color: #f87171 !important;
      border-color: rgba(239, 68, 68, 0.4) !important;
    }

    .gs-badge-submitting {
      background: rgba(99, 102, 241, 0.18) !important;
      color: #818cf8 !important;
      border-color: rgba(99, 102, 241, 0.45) !important;
    }

    .gs-badge-approved {
      background: rgba(16, 185, 129, 0.15) !important;
      color: #34d399 !important;
      border-color: rgba(16, 185, 129, 0.4) !important;
    }

    /* Empty & Loading States */
    .gs-state-card {
      padding: 40px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 12px;
    }

    .gs-state-icon {
      font-size: 36px;
      margin-bottom: 4px;
    }

    .gs-state-title {
      font-size: 17px;
      font-weight: 700;
      color: #ffffff;
    }

    .gs-state-desc {
      font-size: 13px;
      color: #94a3b8;
      max-width: 380px;
      line-height: 1.5;
    }

    /* Animations & Reduced Motion */
    @keyframes gsFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes gsSlideUp {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
      }
    }

    @media (max-width: 640px) {
      .gs-backdrop {
        padding: 12px;
        align-items: flex-end;
      }
      .gs-shell {
        max-width: 100%;
        border-radius: 16px 16px 0 0;
        max-height: 92vh;
      }
      .gs-header {
        padding: 14px 16px;
      }
      .gs-body {
        padding: 16px;
        max-height: calc(92vh - 160px);
        gap: 16px;
      }
      .gs-footer {
        flex-direction: column-reverse;
        align-items: stretch;
        gap: 12px;
        padding: 14px 16px;
      }
      .gs-btn-group {
        flex-direction: column-reverse;
        width: 100%;
        gap: 10px;
      }
      .gs-btn {
        width: 100%;
        min-height: 48px;
        font-size: 14px;
        justify-content: center;
      }
      .gs-footer-notice {
        text-align: center;
        font-size: 11px;
      }
    }
  `;
  return style;
}

/**
 * Renders the header section of the Staging Modal.
 */
function renderHeader(onClose: () => void): HTMLElement {
  const header = document.createElement('header');
  header.className = 'gs-header';

  const brandGroup = document.createElement('div');
  brandGroup.className = 'gs-brand-group';

  const icon = document.createElement('span');
  icon.className = 'gs-brand-icon';
  icon.textContent = '🛡️';

  const title = document.createElement('span');
  title.className = 'gs-brand-title';
  title.textContent = 'Guardrail Staging';

  const pill = document.createElement('span');
  pill.className = 'gs-mode-pill gs-badge-held';
  pill.textContent = 'Review Mode';

  brandGroup.appendChild(icon);
  brandGroup.appendChild(title);
  brandGroup.appendChild(pill);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gs-btn-close';
  closeBtn.setAttribute('aria-label', 'Close staging preview');
  closeBtn.setAttribute('title', 'Close (Esc)');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', onClose);

  header.appendChild(brandGroup);
  header.appendChild(closeBtn);

  return header;
}

/**
 * Renders the active staged action view.
 */
function renderActiveBody(context: StagingActionContext): HTMLElement {
  const body = document.createElement('div');
  body.className = 'gs-body';

  // 1. Prominent Heading & Pause Explanation
  const headingSection = document.createElement('div');
  headingSection.className = 'gs-heading-section';

  const headingTitle = document.createElement('h2');
  headingTitle.id = 'gs-title-id';
  headingTitle.className = 'gs-heading-title';
  headingTitle.textContent = 'Action Paused for Your Review';

  const headingSubtitle = document.createElement('p');
  headingSubtitle.className = 'gs-heading-subtitle';
  headingSubtitle.textContent =
    'Guardrail paused this action before it happens so you have a moment to review it. Nothing has been sent or changed yet.';

  headingSection.appendChild(headingTitle);
  headingSection.appendChild(headingSubtitle);
  body.appendChild(headingSection);

  // 2. Protected Action Summary Area
  const summaryCard = document.createElement('section');
  summaryCard.className = 'gs-section-card';
  summaryCard.setAttribute('aria-labelledby', 'gs-summary-heading');

  const summaryHeader = document.createElement('div');
  summaryHeader.className = 'gs-section-header';
  summaryHeader.id = 'gs-summary-heading';
  summaryHeader.textContent = 'Protected Action Summary';

  const summaryBox = document.createElement('div');
  summaryBox.className = 'gs-action-summary-box';

  const descEl = document.createElement('div');
  descEl.className = 'gs-action-desc';
  descEl.textContent =
    context.description && typeof context.description === 'string' && context.description.trim()
      ? context.description.trim()
      : 'Action held for review on this page';

  summaryBox.appendChild(descEl);

  const metaGrid = document.createElement('div');
  metaGrid.className = 'gs-meta-grid';

  // Item: Mechanism / Type
  const typeItem = document.createElement('div');
  typeItem.className = 'gs-meta-item';
  const typeLabel = document.createElement('span');
  typeLabel.className = 'gs-meta-label';
  typeLabel.textContent = 'Mechanism';
  const typeVal = document.createElement('span');
  typeVal.className = 'gs-meta-value';
  typeVal.textContent = formatActionTypeName(context.actionType);
  typeItem.appendChild(typeLabel);
  typeItem.appendChild(typeVal);
  metaGrid.appendChild(typeItem);

  // Item: Category
  const catItem = document.createElement('div');
  catItem.className = 'gs-meta-item';
  const catLabel = document.createElement('span');
  catLabel.className = 'gs-meta-label';
  catLabel.textContent = 'Category';
  const catVal = document.createElement('span');
  catVal.className = 'gs-meta-value';
  catVal.textContent = formatCategoryName(context.category);
  catItem.appendChild(catLabel);
  catItem.appendChild(catVal);
  metaGrid.appendChild(catItem);

  // Item: Website Hostname / Origin (shown only when available and safe to display)
  const safeHost = getSafeDisplayHost(context.origin, context.hostname);
  if (safeHost) {
    const hostItem = document.createElement('div');
    hostItem.className = 'gs-meta-item';
    const hostLabel = document.createElement('span');
    hostLabel.className = 'gs-meta-label';
    hostLabel.textContent = 'Website';
    const hostVal = document.createElement('span');
    hostVal.className = 'gs-meta-value';
    hostVal.textContent = safeHost;
    hostItem.appendChild(hostLabel);
    hostItem.appendChild(hostVal);
    metaGrid.appendChild(hostItem);
  }

  // Item: Action ID / Audit Reference
  const idItem = document.createElement('div');
  idItem.className = 'gs-meta-item';
  const idLabel = document.createElement('span');
  idLabel.className = 'gs-meta-label';
  idLabel.textContent = 'Audit ID';
  const idVal = document.createElement('span');
  idVal.className = 'gs-meta-value';
  idVal.textContent =
    context.actionId && typeof context.actionId === 'string' && context.actionId.trim()
      ? context.actionId.trim()
      : 'N/A';
  idItem.appendChild(idLabel);
  idItem.appendChild(idVal);
  metaGrid.appendChild(idItem);

  summaryCard.appendChild(summaryHeader);
  summaryCard.appendChild(summaryBox);
  summaryCard.appendChild(metaGrid);
  body.appendChild(summaryCard);

  // 3. Attention / Risk Area (reassuring, explainable, strictly safe)
  const presentation = getRiskLevelPresentation(context.riskLevel);

  const riskCard = document.createElement('section');
  riskCard.className = `gs-risk-treatment ${presentation.className}`;
  riskCard.setAttribute('aria-labelledby', 'gs-risk-heading');

  const riskHeader = document.createElement('div');
  riskHeader.className = 'gs-risk-header';

  const riskHeadline = document.createElement('span');
  riskHeadline.id = 'gs-risk-heading';
  riskHeadline.className = 'gs-risk-headline';
  riskHeadline.textContent = presentation.headline;

  const riskBadge = document.createElement('span');
  riskBadge.className = 'gs-risk-badge';
  riskBadge.textContent =
    typeof context.riskScore === 'number' && !isNaN(context.riskScore)
      ? `${context.riskLevel || 'EVALUATED'} (${context.riskScore})`
      : `${context.riskLevel || 'EVALUATED'}`;
  riskBadge.setAttribute(
    'aria-label',
    `Risk assessment: ${context.riskLevel || 'EVALUATED'} risk, score ${
      typeof context.riskScore === 'number' ? context.riskScore : 'not available'
    }`
  );

  const riskSrSummary = document.createElement('span');
  riskSrSummary.className = 'gs-sr-only';
  riskSrSummary.textContent = `Severity Level: ${context.riskLevel || 'LOW'}. Risk Score: ${
    typeof context.riskScore === 'number' ? context.riskScore : 'N/A'
  } out of 100.`;

  riskHeader.appendChild(riskHeadline);
  riskHeader.appendChild(riskBadge);
  riskHeader.appendChild(riskSrSummary);
  riskCard.appendChild(riskHeader);

  // Reassuring explanation of what the risk evaluation means
  const riskSub = document.createElement('p');
  riskSub.className = 'gs-risk-subtext';
  riskSub.textContent = presentation.description;
  riskCard.appendChild(riskSub);

  // Reasons list: translate technical classifications into clear, reassuring language
  const rawReasons = Array.isArray(context.riskReasons)
    ? context.riskReasons.filter((r) => typeof r === 'string' && r.trim().length > 0)
    : [];

  const reasonsToDisplay =
    rawReasons.length > 0
      ? rawReasons
      : ['Guardrail paused this action as a standard safety precaution based on current settings.'];

  const reasonsList = document.createElement('ul');
  reasonsList.className = 'gs-reasons-list';

  for (const reason of reasonsToDisplay) {
    const item = document.createElement('li');
    item.className = 'gs-reason-item';

    const bullet = document.createElement('span');
    bullet.className = 'gs-reason-bullet';
    bullet.textContent = '•';

    const content = document.createElement('div');
    content.className = 'gs-reason-content';

    const translated = translateRiskReason(reason);

    const summaryEl = document.createElement('span');
    summaryEl.className = 'gs-reason-summary';
    summaryEl.textContent = translated.headline;

    const detailEl = document.createElement('span');
    detailEl.className = 'gs-reason-detail';
    detailEl.textContent = translated.detail;

    content.appendChild(summaryEl);
    content.appendChild(detailEl);

    item.appendChild(bullet);
    item.appendChild(content);
    reasonsList.appendChild(item);
  }

  riskCard.appendChild(reasonsList);
  body.appendChild(riskCard);

  return body;
}

/**
 * Renders the loading state view.
 */
function renderLoadingBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'gs-body';

  const card = document.createElement('div');
  card.className = 'gs-section-card gs-state-card';

  const icon = document.createElement('div');
  icon.className = 'gs-state-icon';
  icon.textContent = '⏳';

  const title = document.createElement('h2');
  title.id = 'gs-title-id';
  title.className = 'gs-state-title';
  title.textContent = 'Loading Staging Preview...';

  const desc = document.createElement('p');
  desc.className = 'gs-state-desc';
  desc.textContent = 'Guardrail is preparing the security context for this interaction. Please wait.';

  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(desc);
  body.appendChild(card);

  return body;
}

/**
 * Renders the empty / unavailable state view.
 */
function renderEmptyBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'gs-body';

  const card = document.createElement('div');
  card.className = 'gs-section-card gs-state-card';

  const icon = document.createElement('div');
  icon.className = 'gs-state-icon';
  icon.textContent = '🛡️';

  const title = document.createElement('h2');
  title.id = 'gs-title-id';
  title.className = 'gs-state-title';
  title.textContent = 'No Action Currently Paused';

  const desc = document.createElement('p');
  desc.className = 'gs-state-desc';
  desc.textContent =
    'There are no interactions waiting for review in Staging Mode. When a sensitive action is detected, it will be paused and previewed here.';

  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(desc);
  body.appendChild(card);

  return body;
}

/**
 * Renders an inline confirmation or error banner at the top of the modal body.
 */
export function displayConfirmationBanner(
  body: HTMLElement,
  type: 'success' | 'error' | 'info',
  titleText: string,
  descText: string
): HTMLElement {
  const existing = body.querySelector('.gs-confirmation-banner');
  if (existing) {
    existing.remove();
  }

  const banner = document.createElement('div');
  const typeClass =
    type === 'success'
      ? 'gs-confirmation-success'
      : type === 'error'
      ? 'gs-confirmation-error'
      : 'gs-confirmation-info';
  banner.className = `gs-confirmation-banner ${typeClass}`;
  banner.setAttribute('role', type === 'error' ? 'alert' : 'status');
  banner.setAttribute('aria-live', 'polite');

  const icon = document.createElement('span');
  icon.className = 'gs-confirmation-icon';
  icon.textContent = type === 'success' ? '✓' : type === 'error' ? '⚠️' : 'ℹ️';

  const content = document.createElement('div');
  content.className = 'gs-confirmation-content';

  const title = document.createElement('span');
  title.className = 'gs-confirmation-title';
  title.textContent = titleText;

  const desc = document.createElement('span');
  desc.className = 'gs-confirmation-desc';
  desc.textContent = descText;

  content.appendChild(title);
  content.appendChild(desc);
  banner.appendChild(icon);
  banner.appendChild(content);

  if (body.children && body.children.length > 0 && typeof body.insertBefore === 'function') {
    body.insertBefore(banner, body.children[0]);
  } else {
    body.appendChild(banner);
  }

  return banner;
}

/**
 * Screen Reader Live Region Announcer helper.
 * Updates the polite or assertive announcer text within the modal shadow root.
 */
export function announceStagingState(message: string, isAlert: boolean = false): void {
  if (!currentShadow) return;
  const announcer = currentShadow.querySelector('#gs-live-announcer');
  if (announcer) {
    if (isAlert) {
      announcer.setAttribute('role', 'alert');
      announcer.setAttribute('aria-live', 'assertive');
    } else {
      announcer.setAttribute('role', 'status');
      announcer.setAttribute('aria-live', 'polite');
    }
    announcer.textContent = message;
  }
}

/**
 * Transitions the Staging Mode UI to one of the 5 canonical interface states:
 * - 'held': Action held for review.
 * - 'cancelling': Cancellation in progress.
 * - 'cancelled': Successful cancellation.
 * - 'approval_intent_recorded': Local approval intent recorded.
 * - 'stale_or_invalid': Operation failed, stale, or no longer valid.
 */
export function setStagingUIState(
  state: StagingInterceptionUIState,
  details?: {
    error?: string;
    description?: string;
    requestId?: string;
    code?: string;
    decidedBy?: string;
    decidedAt?: string;
    statusCode?: number;
    request?: ApprovalRequest;
  }
): void {
  currentUIState = state;
  if (!currentShadow) return;

  const pill = currentShadow.querySelector('.gs-mode-pill');
  const title = currentShadow.querySelector('.gs-heading-title');
  const subtitle = currentShadow.querySelector('.gs-heading-subtitle');
  const body = currentShadow.querySelector('.gs-body') as HTMLElement;
  const notice = currentShadow.querySelector('.gs-footer-notice');
  const cancelBtn = currentShadow.querySelector('#gs-btn-cancel-action') as HTMLButtonElement | null;
  const reqBtn = currentShadow.querySelector('#gs-btn-request-approval') as HTMLButtonElement | null;

  const resetPillClasses = () => {
    if (pill) {
      pill.classList.remove(
        'gs-badge-held',
        'gs-badge-cancelling',
        'gs-badge-cancelled',
        'gs-badge-requested',
        'gs-badge-stale',
        'gs-badge-submitting',
        'gs-badge-approved'
      );
    }
  };

  switch (state) {
    case 'held':
      resetPillClasses();
      if (pill) {
        pill.textContent = 'Review Mode';
        pill.classList.add('gs-badge-held');
      }
      if (title) title.textContent = 'Action Paused for Your Review';
      if (subtitle) {
        subtitle.textContent =
          'Guardrail paused this action before it happens so you have a moment to review it. Nothing has been sent or changed yet.';
      }
      if (notice) {
        notice.textContent = 'Staging Mode Shell • Approval workflow active in upcoming milestone';
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel Action';
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
        cancelBtn.removeAttribute('aria-busy');
      }
      if (reqBtn) {
        reqBtn.textContent = 'Request Approval';
        reqBtn.disabled = false;
        reqBtn.removeAttribute('aria-disabled');
        reqBtn.removeAttribute('aria-busy');
        reqBtn.style.display = '';
      }
      announceStagingState('Action paused for review.');
      break;

    case 'cancelling':
      resetPillClasses();
      if (pill) {
        pill.textContent = 'Cancelling...';
        pill.classList.add('gs-badge-cancelling');
      }
      if (notice) {
        notice.textContent = 'Cancelling action safely • Please wait...';
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancelling...';
        cancelBtn.disabled = true;
        cancelBtn.setAttribute('aria-disabled', 'true');
        cancelBtn.setAttribute('aria-busy', 'true');
      }
      if (reqBtn) {
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
      }
      announceStagingState('Cancelling action. Please wait.');
      break;

    case 'cancelled':
      resetPillClasses();
      if (pill) {
        pill.textContent = 'Cancelled';
        pill.classList.add('gs-badge-cancelled');
      }
      if (title) title.textContent = 'Action Cancelled';
      if (subtitle) {
        subtitle.textContent = 'This action was cancelled before it could run. Nothing was changed.';
      }
      if (notice) {
        notice.textContent = 'Action cancelled safely • State: CANCELLED';
      }
      if (body) {
        displayConfirmationBanner(
          body,
          'success',
          'Action cancelled. Nothing was changed.',
          'The held interaction was aborted safely. No action was executed, no network data was sent, and no page state was modified.'
        );
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Action Cancelled';
        cancelBtn.disabled = true;
        cancelBtn.setAttribute('aria-disabled', 'true');
        cancelBtn.removeAttribute('aria-busy');
      }
      if (reqBtn) {
        reqBtn.disabled = true;
        reqBtn.style.display = 'none';
      }
      announceStagingState('Action cancelled. Nothing was changed.');
      break;

    case 'approval_intent_recorded':
      resetPillClasses();
      if (pill) {
        pill.textContent = 'Paused (Request Prepared)';
        pill.classList.add('gs-badge-requested');
      }
      if (notice) {
        notice.textContent = 'Approval intent recorded locally • Backend not connected • State: HELD';
      }
      if (body) {
        displayConfirmationBanner(
          body,
          'info',
          'Approval Request Prepared (Local Prototype)',
          'An approval request intent was recorded locally for this action. Remote caretaker approval and backend services are not connected yet. This action remains safely paused and will not execute.'
        );
      }
      if (reqBtn) {
        reqBtn.textContent = 'Request Prepared (Local)';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.removeAttribute('aria-busy');
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel Action';
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
      }
      announceStagingState(
        'Approval request intent recorded locally. Remote caretaker approval and backend services are not connected yet. Action remains paused.'
      );
      break;

    case 'stale_or_invalid':
      resetPillClasses();
      if (pill) {
        pill.textContent = 'Operation Unavailable';
        pill.classList.add('gs-badge-stale');
      }
      if (title) title.textContent = 'Action No Longer Held';
      if (subtitle) {
        subtitle.textContent =
          'This action has already been resolved or is no longer available in Guardrail.';
      }
      if (notice) {
        notice.textContent = 'Action cannot be modified • Interception is no longer held';
      }
      if (body) {
        displayConfirmationBanner(
          body,
          'error',
          'Action Unavailable or Already Resolved',
          details?.error ||
            'The action could not be processed because its state has already changed or it is no longer held.'
        );
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Action Unavailable';
        cancelBtn.disabled = true;
        cancelBtn.setAttribute('aria-disabled', 'true');
        cancelBtn.removeAttribute('aria-busy');
      }
      if (reqBtn) {
        reqBtn.textContent = 'Request Unavailable';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.removeAttribute('aria-busy');
      }
      announceStagingState(
        `Operation failed: ${
          details?.error || 'Action is no longer held or could not be processed.'
        }`,
        true
      );
      break;

    case 'submitting_approval':
      resetPillClasses();
      if (pill) {
        pill.textContent = 'Submitting...';
        pill.classList.add('gs-badge-submitting');
      }
      if (notice) {
        notice.textContent = 'Submitting approval request to backend • Please wait...';
      }
      if (reqBtn) {
        reqBtn.textContent = 'Submitting...';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.setAttribute('aria-busy', 'true');
      }
      if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
      }
      announceStagingState('Submitting approval request to backend. Please wait.');
      break;

    case 'approval_requested':
      resetPillClasses();
      if (pill) {
        pill.textContent = 'Approval Pending';
        pill.classList.add('gs-badge-requested');
      }
      if (title) title.textContent = 'Approval Request Active';
      if (subtitle) {
        subtitle.textContent =
          'This action requires approval from an authorized trusted contact before it can proceed.';
      }
      if (notice) {
        const reqId = details?.requestId || 'active';
        notice.textContent = `Approval Request Active (${reqId}) • Status: PENDING • Action: HELD`;
      }
      if (body) {
        const reqId = details?.requestId || 'active';
        displayConfirmationBanner(
          body,
          'success',
          'Approval Request Submitted',
          `Your approval request (${reqId}) has been registered on the server in PENDING status. This action remains safely paused and will not execute until approved.`
        );
      }
      if (reqBtn) {
        reqBtn.textContent = 'Approval Requested';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.removeAttribute('aria-busy');
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel Action';
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
        cancelBtn.removeAttribute('aria-busy');
      }
      announceStagingState(
        'Approval request submitted to backend. Status: PENDING. Action remains safely paused.'
      );
      break;

    case 'approval_confirmed_approved': {
      resetPillClasses();
      const reqId = details?.requestId || 'active';
      const approver = details?.decidedBy || 'authorized contact';
      if (pill) {
        pill.textContent = 'Approval Confirmed';
        pill.classList.add('gs-badge-approved');
      }
      if (title) title.textContent = 'Approval Confirmed by Contact';
      if (subtitle) {
        subtitle.textContent =
          'An authorized trusted contact has approved this action. To protect your safety, the action is still held until you review and confirm.';
      }
      if (notice) {
        notice.textContent = `Approval Confirmed (${reqId}) • Status: APPROVED • Action: HELD`;
      }
      if (body) {
        displayConfirmationBanner(
          body,
          'info',
          'Action Approved by Trusted Contact',
          `An authorized contact (${approver}) reviewed and approved this request (${reqId}). Guardrail keeps this action safely paused until you confirm continuation.`
        );
      }
      if (reqBtn) {
        reqBtn.textContent = 'Approval Confirmed';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.removeAttribute('aria-busy');
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel Action';
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
        cancelBtn.removeAttribute('aria-busy');
      }
      announceStagingState('Action approved by trusted contact. Review details and confirm execution.');
      break;
    }

    case 'approval_confirmed_rejected': {
      resetPillClasses();
      const reqId = details?.requestId || 'active';
      const reviewer = details?.decidedBy || 'authorized contact';
      if (pill) {
        pill.textContent = 'Approval Denied';
        pill.classList.add('gs-badge-stale');
      }
      if (title) title.textContent = 'Approval Denied by Contact';
      if (subtitle) {
        subtitle.textContent =
          'An authorized trusted contact reviewed and denied this approval request. This action remains paused and cannot proceed.';
      }
      if (notice) {
        notice.textContent = `Approval Denied (${reqId}) • Status: REJECTED • Action: HELD`;
      }
      if (body) {
        displayConfirmationBanner(
          body,
          'error',
          'Approval Denied by Trusted Contact',
          `An authorized contact (${reviewer}) reviewed and denied this request (${reqId}). The held action remains safely blocked.`
        );
      }
      if (reqBtn) {
        reqBtn.textContent = 'Request Denied';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.removeAttribute('aria-busy');
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel Action';
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
        cancelBtn.removeAttribute('aria-busy');
      }
      announceStagingState('Action rejected by trusted contact. Action cannot proceed.', true);
      break;
    }

    case 'approval_confirmed_expired': {
      resetPillClasses();
      const reqId = details?.requestId || 'active';
      if (pill) {
        pill.textContent = 'Request Expired';
        pill.classList.add('gs-badge-stale');
      }
      if (title) title.textContent = 'Approval Request Expired';
      if (subtitle) {
        subtitle.textContent =
          'The review window for this approval request has expired. This action remains safely paused.';
      }
      if (notice) {
        notice.textContent = `Approval Expired (${reqId}) • Status: EXPIRED • Action: HELD`;
      }
      if (body) {
        displayConfirmationBanner(
          body,
          'error',
          'Approval Request Expired',
          `The review window for request (${reqId}) expired without a decision. To protect your safety, this action remains paused.`
        );
      }
      if (reqBtn) {
        reqBtn.textContent = 'Request Expired';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.removeAttribute('aria-busy');
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel Action';
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
      }
      announceStagingState('Approval request expired. Action remains paused.', true);
      break;
    }

    case 'approval_confirmed_cancelled': {
      resetPillClasses();
      const reqId = details?.requestId || 'active';
      if (pill) {
        pill.textContent = 'Request Cancelled';
        pill.classList.add('gs-badge-cancelled');
      }
      if (title) title.textContent = 'Approval Request Cancelled';
      if (subtitle) {
        subtitle.textContent =
          details?.description || 'This approval request was cancelled on the server. The action remains safely paused.';
      }
      if (notice) {
        notice.textContent = `Approval Cancelled (${reqId}) • Status: CANCELLED • Action: HELD`;
      }
      if (body) {
        displayConfirmationBanner(
          body,
          'info',
          'Approval Request Cancelled',
          details?.description || `The approval request (${reqId}) was cancelled on the server. The action remains safely paused.`
        );
      }
      if (reqBtn) {
        reqBtn.textContent = 'Request Cancelled';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.removeAttribute('aria-busy');
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel Action';
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
      }
      announceStagingState('Approval request cancelled on server. Action remains paused.');
      break;
    }

    case 'approval_uncertain':
      resetPillClasses();
      if (pill) {
        pill.textContent = 'Outcome Uncertain';
        pill.classList.add('gs-badge-stale');
      }
      if (title) title.textContent = 'Submission Outcome Uncertain';
      if (subtitle) {
        subtitle.textContent =
          'A network failure or timeout occurred during submission. The server state is unknown.';
      }
      if (notice) {
        notice.textContent = 'Network Outcome Uncertain • Request Status Unknown • Action: HELD';
      }
      if (body) {
        displayConfirmationBanner(
          body,
          'info',
          'Submission Outcome Uncertain',
          details?.error ||
            'The approval submission timed out or the network connection dropped. The backend may or may not have received your request. To protect your safety, this action remains safely paused and will not execute.'
        );
      }
      if (reqBtn) {
        reqBtn.textContent = 'Outcome Uncertain';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.removeAttribute('aria-busy');
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel Action';
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
      }
      announceStagingState(
        'Approval submission outcome is uncertain. The action remains safely paused.',
        true
      );
      break;

    case 'approval_failed': {
      resetPillClasses();
      const sanitized = sanitizeApprovalErrorMessage(details?.error, details?.statusCode);
      if (pill) {
        pill.textContent = 'Request Rejected';
        pill.classList.add('gs-badge-stale');
      }
      if (title) title.textContent = 'Approval Request Rejected';
      if (subtitle) {
        subtitle.textContent =
          'The server rejected the approval request. This action remains paused.';
      }
      if (notice) {
        notice.textContent = `Approval Request Failed • ${details?.code || 'REJECTED'} • Action: HELD`;
      }
      if (body) {
        displayConfirmationBanner(
          body,
          'error',
          'Approval Request Rejected',
          sanitized ||
            'The approval request could not be processed by the server. The action remains safely held.'
        );
      }
      if (reqBtn) {
        reqBtn.textContent = 'Request Rejected';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.removeAttribute('aria-busy');
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel Action';
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
      }
      announceStagingState(
        'Approval request rejected by server: ' + (sanitized || 'Rejection'),
        true
      );
      break;
    }

    case 'malformed_response':
      resetPillClasses();
      if (pill) {
        pill.textContent = 'Response Invalid';
        pill.classList.add('gs-badge-stale');
      }
      if (title) title.textContent = 'Invalid Server Response';
      if (subtitle) {
        subtitle.textContent =
          'The backend response did not match the expected approval schema. This action remains safely paused.';
      }
      if (notice) {
        notice.textContent = 'Invalid Response Schema • Action: HELD';
      }
      if (body) {
        displayConfirmationBanner(
          body,
          'error',
          'Invalid Server Response',
          details?.error ||
            'The backend returned an unexpected response format. To ensure your safety, this action remains paused.'
        );
      }
      if (reqBtn) {
        reqBtn.textContent = 'Request Unavailable';
        reqBtn.disabled = true;
        reqBtn.setAttribute('aria-disabled', 'true');
        reqBtn.removeAttribute('aria-busy');
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel Action';
        cancelBtn.disabled = false;
        cancelBtn.removeAttribute('aria-disabled');
      }
      announceStagingState('Invalid server response schema. Action remains paused.', true);
      break;
  }
}

export interface ModalCancelUIElements {
  cancelBtn: HTMLButtonElement;
  primaryBtn?: HTMLButtonElement;
  body: HTMLElement;
  header: HTMLElement;
  notice?: HTMLElement;
}

/**
 * Executes the cancellation workflow for an intercepted action held in Staging Mode.
 *
 * Enforces:
 * 1. Single execution: Disables cancel button and rejects duplicate/concurrent clicks.
 * 2. Source of Truth: Uses InterceptionController / ContinuationManager lifecycle.
 * 3. Validation: Confirms action is currently in HELD state.
 * 4. Zero Handler Invocation: Ensures controlled test handler is not executed.
 * 5. Accurate Feedback: Displays "Action cancelled. Nothing was changed." only upon true success.
 *    Displays an appropriate error message if state has changed or cancellation fails.
 */
function applyCancellationOutcome(
  result: CancellationResult,
  options: StagingModalOptions,
  uiElements: ModalCancelUIElements
): CancellationResult {
  const { cancelBtn, primaryBtn, body, header, notice } = uiElements;

  if (result.success) {
    currentUIState = 'cancelled';
    displayConfirmationBanner(
      body,
      'success',
      'Action cancelled. Nothing was changed.',
      'The held interaction was aborted safely. No action was executed, no network data was sent, and no page state was modified.'
    );

    const pill = header.querySelector('.gs-mode-pill');
    if (pill) {
      pill.textContent = 'Cancelled';
      pill.classList.remove('gs-badge-held', 'gs-badge-cancelling', 'gs-badge-requested', 'gs-badge-stale');
      pill.classList.add('gs-badge-cancelled');
    }

    const headingTitle = body.querySelector('.gs-heading-title');
    if (headingTitle) {
      headingTitle.textContent = 'Action Cancelled';
    }
    const headingSubtitle = body.querySelector('.gs-heading-subtitle');
    if (headingSubtitle) {
      headingSubtitle.textContent = 'This action was cancelled before it could run. Nothing was changed.';
    }

    cancelBtn.textContent = 'Action Cancelled';
    if (primaryBtn) {
      primaryBtn.style.display = 'none';
      primaryBtn.disabled = true;
    }
    if (notice) {
      notice.textContent = 'Action cancelled safely • State: CANCELLED';
    }

    announceStagingState('Action cancelled. Nothing was changed.');

    if (options.onCancelSuccess) {
      options.onCancelSuccess(result);
    }
  } else {
    currentUIState = 'stale_or_invalid';
    displayConfirmationBanner(
      body,
      'error',
      'Cancellation Could Not Be Completed',
      result.error || 'The action could not be cancelled because its state has already changed or it is no longer held.'
    );

    const pill = header.querySelector('.gs-mode-pill');
    if (pill) {
      pill.textContent = 'Operation Unavailable';
      pill.classList.remove('gs-badge-held', 'gs-badge-cancelling', 'gs-badge-cancelled', 'gs-badge-requested');
      pill.classList.add('gs-badge-stale');
    }

    cancelBtn.textContent = 'Cancellation Failed';
    if (primaryBtn) {
      primaryBtn.disabled = true;
      primaryBtn.setAttribute('aria-disabled', 'true');
    }

    announceStagingState(
      'Cancellation could not be completed: ' +
        (result.error || 'The action could not be cancelled because its state has already changed or it is no longer held.'),
      true
    );

    if (options.onCancelError) {
      options.onCancelError(result);
    }
  }

  return result;
}

/**
 * Executes the cancellation workflow for an intercepted action held in Staging Mode.
 *
 * Enforces:
 * 1. Single execution: Disables cancel button and rejects duplicate/concurrent clicks.
 * 2. Source of Truth: Uses InterceptionController / ContinuationManager lifecycle.
 * 3. Validation: Confirms action is currently in HELD state.
 * 4. Zero Handler Invocation: Ensures controlled test handler is not executed.
 * 5. Accurate Feedback: Displays "Action cancelled. Nothing was changed." only upon true success.
 *    Displays an appropriate error message if state has changed or cancellation fails.
 */
export function handleModalCancel(
  actionId: string | undefined,
  options: StagingModalOptions,
  uiElements: ModalCancelUIElements
): CancellationResult {
  const { cancelBtn } = uiElements;

  // 1. Immediately disable button to prevent repeated clicks / duplicate requests
  cancelBtn.disabled = true;
  cancelBtn.setAttribute('aria-disabled', 'true');
  cancelBtn.removeAttribute('aria-busy');

  const id = actionId?.trim();
  if (!id) {
    const errorResult: CancellationResult = {
      success: false,
      actionId: '',
      error: 'Cannot cancel action: No valid action identifier is available.',
    };
    return applyCancellationOutcome(errorResult, options, uiElements);
  }

  // 2. Request cancellation via the configured source of truth
  let result: CancellationResult | Promise<CancellationResult>;

  if (options.onCancel) {
    try {
      result = options.onCancel(id) as CancellationResult | Promise<CancellationResult>;
    } catch (err: any) {
      result = {
        success: false,
        actionId: id,
        error: err?.message || 'Error occurred during action cancellation callback.',
      };
    }
  } else if (options.continuationManager) {
    result = options.continuationManager.cancelAction(
      id,
      'Action cancelled by user in Guardrail Staging Mode.'
    );
  } else if (options.controller) {
    try {
      const record = options.controller.cancelAction(
        id,
        'Action cancelled by user in Guardrail Staging Mode.'
      );
      result = {
        success: true,
        actionId: id,
        record,
      };
    } catch (err: any) {
      result = {
        success: false,
        actionId: id,
        record: options.controller.getRecord(id),
        error: err?.message || `Failed to cancel action "${id}".`,
      };
    }
  } else {
    result = defaultContinuationManager.cancelAction(
      id,
      'Action cancelled by user in Guardrail Staging Mode.'
    );
  }

  // 3. Process outcome (asynchronous or synchronous)
  if (result && typeof (result as any).then === 'function') {
    currentUIState = 'cancelling';
    (result as any)
      .then((asyncRes: CancellationResult) => applyCancellationOutcome(asyncRes, options, uiElements))
      .catch((err: any) => {
        const errorResult: CancellationResult = {
          success: false,
          actionId: id,
          error: err?.message || String(err),
        };
        applyCancellationOutcome(errorResult, options, uiElements);
      });
    return result as unknown as CancellationResult;
  }

  return applyCancellationOutcome(result as CancellationResult, options, uiElements);
}

export interface ModalApprovalRequestUIElements {
  requestBtn: HTMLButtonElement;
  cancelBtn?: HTMLButtonElement;
  body: HTMLElement;
  header: HTMLElement;
  notice?: HTMLElement;
}

function applyApprovalOutcome(
  result: ApprovalRequestResult,
  options: StagingModalOptions,
  uiElements: ModalApprovalRequestUIElements,
  sessionInfo?: { sessionToken: number; sessionActionId: string | null }
): ApprovalRequestResult {
  const { requestBtn, cancelBtn, body, header, notice } = uiElements;

  // Stale response / component unmounted guard (Requirement 8):
  // If the modal was closed, reset, or switched to another action while submission was in-flight,
  // do NOT update the wrong action's UI or touch detached elements.
  if (
    sessionInfo &&
    (!isStagingModalActive() ||
      currentModalSessionId !== sessionInfo.sessionToken ||
      (sessionInfo.sessionActionId !== null &&
        currentMountedActionId !== null &&
        currentMountedActionId !== sessionInfo.sessionActionId))
  ) {
    return result;
  }

  if (result.isBackendConnected) {
    if (result.success) {
      // Validate the backend response schema before displaying any status (Requirements 1, 3, 4, 11)
      const validation = validateBackendApprovalResponse(result.request, result.actionId);
      if (!validation.valid) {
        setStagingUIState('malformed_response', {
          error: validation.error,
        });

        const failureResult: ApprovalRequestResult = {
          ...result,
          success: false,
          error: `Malformed backend approval response: ${validation.error}`,
        };

        if (options.onRequestApprovalError) {
          options.onRequestApprovalError(failureResult);
        }
        return failureResult;
      }

      const req = validation.request;
      const reqId = req.id;

      // Authoritative status handling (Requirements 1, 3, 4, 6)
      // Never show APPROVED merely because request creation succeeded!
      switch (req.status) {
        case ApprovalStatus.APPROVED:
          setStagingUIState('approval_confirmed_approved', {
            requestId: reqId,
            decidedBy: req.decision?.decidedBy,
            decidedAt: req.decision?.decidedAt,
            request: req,
          });
          break;

        case ApprovalStatus.REJECTED:
          setStagingUIState('approval_confirmed_rejected', {
            requestId: reqId,
            decidedBy: req.decision?.decidedBy,
            decidedAt: req.decision?.decidedAt,
            request: req,
          });
          break;

        case ApprovalStatus.EXPIRED:
          setStagingUIState('approval_confirmed_expired', {
            requestId: reqId,
            request: req,
          });
          break;

        case ApprovalStatus.CANCELLED:
          setStagingUIState('approval_confirmed_cancelled', {
            requestId: reqId,
            description: req.cancellationReason,
            request: req,
          });
          break;

        case ApprovalStatus.PENDING:
        default:
          // Creation confirmed (or existing pending request)
          setStagingUIState('approval_requested', {
            requestId: reqId,
            request: req,
          });
          break;
      }

      if (options.onRequestApprovalSuccess) {
        options.onRequestApprovalSuccess(result);
      }
    } else if (
      result.outcome === 'INVALID_LOCAL_STATE' ||
      result.outcome === SubmissionOutcome.INVALID_LOCAL_STATE ||
      result.errorDetails?.code === 'ACTION_NOT_FOUND' ||
      result.errorDetails?.code === 'ACTION_NOT_HELD'
    ) {
      const sanitized = sanitizeApprovalErrorMessage(result.error);
      setStagingUIState('stale_or_invalid', {
        error: sanitized,
        code: result.errorDetails?.code,
      });

      if (options.onRequestApprovalError) {
        options.onRequestApprovalError(result);
      }
    } else if (result.isAuthoritative === false) {
      const sanitized = sanitizeApprovalErrorMessage(result.error);
      setStagingUIState('approval_uncertain', {
        error: sanitized,
        code: result.outcome,
      });

      if (options.onRequestApprovalError) {
        options.onRequestApprovalError(result);
      }
    } else {
      const sanitized = sanitizeApprovalErrorMessage(
        result.error,
        result.errorDetails?.statusCode
      );
      setStagingUIState('approval_failed', {
        error: sanitized,
        code: result.errorDetails?.code || result.outcome,
        statusCode: result.errorDetails?.statusCode,
      });

      if (options.onRequestApprovalError) {
        options.onRequestApprovalError(result);
      }
    }
    return result;
  }

  // Legacy prototype mode fallback (Day 9 behavior)
  if (result.success) {
    currentUIState = 'approval_intent_recorded';
    displayConfirmationBanner(
      body,
      'info',
      'Approval Request Prepared (Local Prototype)',
      'An approval request intent was recorded locally for this action. Remote caretaker approval and backend services are not connected yet. This action remains safely paused and will not execute.'
    );

    const pill = header.querySelector('.gs-mode-pill');
    if (pill) {
      pill.textContent = 'Paused (Request Prepared)';
      pill.classList.remove('gs-badge-held', 'gs-badge-cancelling', 'gs-badge-cancelled', 'gs-badge-requested');
      pill.classList.add('gs-badge-requested');
    }

    requestBtn.textContent = 'Request Prepared (Local)';
    if (notice) {
      notice.textContent = 'Approval intent recorded locally • Backend not connected • State: HELD';
    }

    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.removeAttribute('aria-disabled');
    }

    announceStagingState(
      'Approval request intent recorded locally. Remote caretaker approval and backend services are not connected yet. Action remains paused.'
    );

    if (options.onRequestApprovalSuccess) {
      options.onRequestApprovalSuccess(result);
    }
  } else {
    currentUIState = 'stale_or_invalid';
    displayConfirmationBanner(
      body,
      'error',
      'Approval Request Could Not Be Prepared',
      result.error || 'The approval request could not be prepared.'
    );

    const pill = header.querySelector('.gs-mode-pill');
    if (pill) {
      pill.textContent = 'Operation Unavailable';
      pill.classList.remove('gs-badge-held', 'gs-badge-cancelling', 'gs-badge-cancelled', 'gs-badge-requested');
      pill.classList.add('gs-badge-stale');
    }

    requestBtn.textContent = 'Request Unavailable';
    if (cancelBtn) {
      cancelBtn.disabled = true;
      cancelBtn.setAttribute('aria-disabled', 'true');
    }

    announceStagingState(
      'Approval request could not be prepared: ' +
        (result.error || 'The approval request could not be prepared.'),
      true
    );

    if (options.onRequestApprovalError) {
      options.onRequestApprovalError(result);
    }
  }

  return result;
}

/**
 * Executes the approval-request workflow for an intercepted action held in Staging Mode.
 *
 * ARCHITECTURAL GUARANTEES & LIFECYCLE:
 * 1. Single execution: Disables the button immediately and ignores duplicate/rapid clicks.
 * 2. State Validation: Confirms action is currently in HELD state in InterceptionController.
 *    Rejects with INVALID_LOCAL_STATE if CONTINUED, CANCELLED, or untracked.
 * 3. In-Progress Visual State: Immediately updates UI to 'submitting_approval' with aria-busy.
 * 4. Real Backend Communication: When useRealBackend is true (or live extension runtime is present),
 *    dispatches validated extension message to Background Service Worker coordinator.
 * 5. Authoritative vs Uncertain Outcomes:
 *    - On 201 Created confirmation: Updates UI to 'approval_requested', displays PENDING status & reqId.
 *    - On server rejection: Updates UI to 'approval_failed', displays honest server error.
 *    - On timeout/network drop: Updates UI to 'approval_uncertain', does NOT assume failure on server.
 * 6. Action Preserved: Keeps the action safely HELD in browser memory across all outcomes.
 *    Never continues or executes the protected action.
 * 7. Cancellation Isolation: Cancellation remains fully functional and never triggers an approval submission.
 */
export function handleModalRequestApproval(
  context: undefined,
  options: StagingModalOptions,
  uiElements: ModalApprovalRequestUIElements
): ApprovalRequestResult;
export function handleModalRequestApproval(
  context: StagingActionContext | undefined,
  options: StagingModalOptions,
  uiElements: ModalApprovalRequestUIElements
): ApprovalRequestResult | Promise<ApprovalRequestResult>;
export function handleModalRequestApproval(
  context: StagingActionContext | undefined,
  options: StagingModalOptions,
  uiElements: ModalApprovalRequestUIElements
): ApprovalRequestResult | Promise<ApprovalRequestResult> {
  const { requestBtn, notice } = uiElements;

  // 1. Immediately disable button to prevent repeated clicks / duplicate requests (Requirement 8)
  requestBtn.disabled = true;
  requestBtn.setAttribute('aria-disabled', 'true');

  // 2. Validate context and identifier
  const actionId = context?.actionId?.trim();
  const sessionToken = currentModalSessionId;
  const sessionActionId = actionId || null;
  const sessionInfo = { sessionToken, sessionActionId };

  if (!context || !actionId) {
    const errorResult: ApprovalRequestResult = {
      success: false,
      actionId: '',
      error: 'Cannot request approval: No valid action context or identifier is available.',
      isBackendConnected: Boolean(options.useRealBackend),
      isAuthoritative: true,
      outcome: 'INVALID_LOCAL_STATE',
    };
    return applyApprovalOutcome(errorResult, options, uiElements, sessionInfo);
  }

  // 3. Delegate to custom onRequestApproval if configured
  if (options.onRequestApproval) {
    let customOutcome: ApprovalRequestResult | Promise<ApprovalRequestResult>;
    try {
      customOutcome = options.onRequestApproval(context);
    } catch (err: any) {
      customOutcome = {
        success: false,
        actionId,
        error: err?.message || String(err),
        isBackendConnected: Boolean(options.useRealBackend),
        isAuthoritative: true,
      };
    }

    if (customOutcome && typeof (customOutcome as any).then === 'function') {
      return (customOutcome as any)
        .then((asyncRes: ApprovalRequestResult) => applyApprovalOutcome(asyncRes, options, uiElements, sessionInfo))
        .catch((err: any) => {
          const errorRes: ApprovalRequestResult = {
            success: false,
            actionId,
            error: err?.message || String(err),
            isBackendConnected: Boolean(options.useRealBackend),
            isAuthoritative: true,
          };
          return applyApprovalOutcome(errorRes, options, uiElements, sessionInfo);
        });
    }

    return applyApprovalOutcome(customOutcome as ApprovalRequestResult, options, uiElements, sessionInfo);
  }

  // 4. Validate live controller state (Requirement 5)
  const controller = options.controller || defaultInterceptionController;
  const record = controller.getRecord(actionId);

  if (!record) {
    const errorResult: ApprovalRequestResult = {
      success: false,
      actionId,
      error: `Cannot request approval: Action "${actionId}" is not actively tracked by Guardrail.`,
      isBackendConnected: Boolean(options.useRealBackend),
      isAuthoritative: true,
      outcome: 'INVALID_LOCAL_STATE',
    };
    return applyApprovalOutcome(errorResult, options, uiElements, sessionInfo);
  }

  if (record.state !== InterceptionState.HELD) {
    const errorResult: ApprovalRequestResult = {
      success: false,
      actionId,
      error: `Cannot request approval for action "${actionId}": State is "${record.state}". Only actions in HELD state are eligible for approval requests.`,
      isBackendConnected: Boolean(options.useRealBackend),
      isAuthoritative: true,
      outcome: 'INVALID_LOCAL_STATE',
    };
    return applyApprovalOutcome(errorResult, options, uiElements, sessionInfo);
  }

  // 5. Check if real backend should be used (Requirement 6)
  const shouldUseRealBackend =
    options.useRealBackend === true ||
    (options.useRealBackend !== false &&
      typeof chrome !== 'undefined' &&
      Boolean(chrome.runtime?.id));

  if (shouldUseRealBackend) {
    // Show in-progress state immediately (Requirement 7 & 8)
    setStagingUIState('submitting_approval');
    requestBtn.disabled = true;
    requestBtn.setAttribute('aria-disabled', 'true');
    requestBtn.setAttribute('aria-busy', 'true');
    requestBtn.textContent = 'Submitting Request...';
    if (notice) {
      notice.textContent = 'Submitting approval request to backend • Please wait...';
    }
    announceStagingState('Submitting approval request to backend. Please wait.');

    const performSubmission = async (): Promise<ApprovalRequestResult> => {
      try {
        let subRes: GuardrailSubmitApprovalRequestResponse;

        // Injected direct apiClient or submitApprovalRequest (for tests)
        if (options.apiClient || options.submitApprovalRequest) {
          const directFn = options.submitApprovalRequest || submitApprovalRequest;
          const directRes = await directFn(context, controller, {
            apiClient: options.apiClient,
          });
          subRes = {
            success: directRes.success,
            actionId: directRes.actionId,
            outcome: directRes.outcome,
            isAuthoritative: directRes.isAuthoritative,
            request: directRes.success ? directRes.request : undefined,
            error: !directRes.success ? directRes.error : undefined,
          };
        } else {
          // Dispatches validated extension message to Background Service Worker coordinator (Requirements 1, 2, 3)
          subRes = await dispatchSubmitApprovalRequestToBackground(actionId, context);
        }

        const approvalResult: ApprovalRequestResult = {
          success: subRes.success,
          actionId: subRes.actionId,
          isBackendConnected: true,
          outcome: subRes.outcome,
          isAuthoritative: subRes.isAuthoritative,
          request: subRes.request,
          error: subRes.error?.message,
          errorDetails: subRes.error,
        };

        // Dispatch DOM event for automation/testing
        if (typeof document !== 'undefined') {
          try {
            document.dispatchEvent(
              new CustomEvent('guardrail:approval-requested', {
                detail: {
                  actionId,
                  isBackendConnected: true,
                  outcome: subRes.outcome,
                  isAuthoritative: subRes.isAuthoritative,
                  request: subRes.request,
                },
                bubbles: true,
              })
            );
          } catch (e) {
            console.warn('[Guardrail Staging] Error dispatching custom event:', e);
          }
        }

        // Stale response / component unmounted guard (Requirement 8)
        if (
          !isStagingModalActive() ||
          currentModalSessionId !== sessionToken ||
          (sessionActionId !== null &&
            currentMountedActionId !== null &&
            currentMountedActionId !== sessionActionId)
        ) {
          return approvalResult;
        }

        return applyApprovalOutcome(approvalResult, options, uiElements, sessionInfo);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errorResult: ApprovalRequestResult = {
          success: false,
          actionId,
          isBackendConnected: true,
          outcome: SubmissionOutcome.NETWORK_FAILURE_UNCERTAIN,
          isAuthoritative: false,
          error: `Approval submission failed: ${errorMsg}`,
        };

        if (
          !isStagingModalActive() ||
          currentModalSessionId !== sessionToken ||
          (sessionActionId !== null &&
            currentMountedActionId !== null &&
            currentMountedActionId !== sessionActionId)
        ) {
          return errorResult;
        }

        return applyApprovalOutcome(errorResult, options, uiElements, sessionInfo);
      }
    };

    return performSubmission();
  }

  // 6. Day 9 Prototype fallback (when not using real backend)
  let intent: ApprovalRequestIntent;
  try {
    intent = createApprovalRequestIntent(context, record);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorResult: ApprovalRequestResult = {
      success: false,
      actionId,
      error: errorMsg,
      isBackendConnected: false,
    };
    return applyApprovalOutcome(errorResult, options, uiElements);
  }

  const result: ApprovalRequestResult = {
    success: true,
    actionId,
    intent,
    isBackendConnected: false,
  };

  if (typeof document !== 'undefined') {
    try {
      document.dispatchEvent(
        new CustomEvent('guardrail:approval-requested', {
          detail: {
            actionId,
            intent,
            isBackendConnected: false,
          },
          bubbles: true,
        })
      );
    } catch (eventErr) {
      console.warn('[Guardrail Staging] Error dispatching custom approval-requested event:', eventErr);
    }
  }

  dispatchApprovalRequestToBackground(intent).catch((err) => {
    console.warn('[Guardrail Staging] Background approval dispatch notification failed:', err);
  });

  return applyApprovalOutcome(result, options, uiElements);
}

/**
 * Renders the footer and action control space.
 */
function renderFooter(
  options: StagingModalOptions,
  onClose: () => void,
  uiRefs: { header: HTMLElement; body: HTMLElement }
): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'gs-footer';

  const notice = document.createElement('span');
  notice.className = 'gs-footer-notice';
  notice.textContent = 'Staging Mode Shell • Approval workflow active in upcoming milestone';

  const btnGroup = document.createElement('div');
  btnGroup.className = 'gs-btn-group';

  const secondaryBtn = document.createElement('button');
  secondaryBtn.type = 'button';
  secondaryBtn.className = 'gs-btn gs-btn-secondary';
  secondaryBtn.textContent = 'Close Preview';
  secondaryBtn.addEventListener('click', onClose);

  btnGroup.appendChild(secondaryBtn);

  if (options.state === 'active' || (options.context && options.state !== 'empty')) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.id = 'gs-btn-cancel-action';
    cancelBtn.className = 'gs-btn gs-btn-cancel';
    cancelBtn.textContent = 'Cancel Action';
    cancelBtn.setAttribute('title', 'Cancel and abort this action safely');

    let isOperationActive = false;

    const requestApprovalBtn = document.createElement('button');
    requestApprovalBtn.type = 'button';
    requestApprovalBtn.id = 'gs-btn-request-approval';
    requestApprovalBtn.className = 'gs-btn gs-btn-primary';
    requestApprovalBtn.textContent = 'Request Approval';
    requestApprovalBtn.setAttribute('title', 'Prepare a local approval request intent for this held action');

    requestApprovalBtn.addEventListener('click', () => {
      if (isOperationActive || requestApprovalBtn.disabled) {
        return;
      }
      isOperationActive = true;
      requestApprovalBtn.disabled = true;
      requestApprovalBtn.setAttribute('aria-disabled', 'true');
      requestApprovalBtn.setAttribute('aria-busy', 'true');
      requestApprovalBtn.textContent = 'Preparing Intent...';
      cancelBtn.disabled = true;
      cancelBtn.setAttribute('aria-disabled', 'true');

      announceStagingState('Preparing approval request intent. Please wait.');

      if (options.onPrimaryAction) {
        options.onPrimaryAction();
      }

      const outcome = handleModalRequestApproval(options.context, options, {
        requestBtn: requestApprovalBtn,
        cancelBtn,
        body: uiRefs.body,
        header: uiRefs.header,
        notice,
      });

      if (outcome && typeof (outcome as any).then === 'function') {
        (outcome as any)
          .then(() => {
            isOperationActive = false;
          })
          .catch((err: any) => {
            isOperationActive = false;
            setStagingUIState('stale_or_invalid', { error: String(err) });
          });
      } else {
        isOperationActive = false;
      }
    });

    cancelBtn.addEventListener('click', () => {
      if (isOperationActive || cancelBtn.disabled) {
        return;
      }
      isOperationActive = true;
      cancelBtn.disabled = true;
      cancelBtn.setAttribute('aria-disabled', 'true');
      cancelBtn.setAttribute('aria-busy', 'true');
      cancelBtn.textContent = 'Cancelling...';
      requestApprovalBtn.disabled = true;
      requestApprovalBtn.setAttribute('aria-disabled', 'true');

      const pill = uiRefs.header.querySelector('.gs-mode-pill');
      if (pill) {
        pill.textContent = 'Cancelling...';
        pill.classList.remove('gs-badge-held', 'gs-badge-cancelled', 'gs-badge-requested', 'gs-badge-stale');
        pill.classList.add('gs-badge-cancelling');
      }
      if (notice) {
        notice.textContent = 'Cancelling action safely • Please wait...';
      }
      currentUIState = 'cancelling';
      announceStagingState('Cancelling action. Please wait.');

      const cancelOutcome = handleModalCancel(options.context?.actionId, options, {
        cancelBtn,
        primaryBtn: requestApprovalBtn,
        body: uiRefs.body,
        header: uiRefs.header,
        notice,
      });

      if (cancelOutcome && typeof (cancelOutcome as any).then === 'function') {
        (cancelOutcome as any)
          .then(() => {
            isOperationActive = false;
          })
          .catch((err: any) => {
            isOperationActive = false;
            setStagingUIState('stale_or_invalid', { error: String(err) });
          });
      } else {
        isOperationActive = false;
      }
    });

    btnGroup.appendChild(cancelBtn);
    btnGroup.appendChild(requestApprovalBtn);
  }

  footer.appendChild(notice);
  footer.appendChild(btnGroup);

  return footer;
}

/**
 * Builds the complete Staging Modal dialog tree.
 */
function buildModalTree(options: StagingModalOptions): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'gs-backdrop';

  const shell = document.createElement('div');
  shell.className = 'gs-shell';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  shell.setAttribute('aria-labelledby', 'gs-title-id');

  // Screen Reader Live Region Announcer
  const announcer = document.createElement('div');
  announcer.id = 'gs-live-announcer';
  announcer.className = 'gs-sr-only';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  shell.appendChild(announcer);

  const handleClose = () => {
    dismissStagingModal();
    if (options.onDismiss) {
      options.onDismiss();
    }
  };

  // 1. Header
  const header = renderHeader(handleClose);
  shell.appendChild(header);

  // 2. Body based on state
  const state = options.state || (options.context ? 'active' : 'empty');
  let body: HTMLElement;
  if (state === 'active' && options.context) {
    body = renderActiveBody(options.context);
  } else if (state === 'loading') {
    body = renderLoadingBody();
  } else {
    body = renderEmptyBody();
  }
  shell.appendChild(body);

  // 3. Footer
  const footer = renderFooter(options, handleClose, { header, body });
  shell.appendChild(footer);

  backdrop.appendChild(shell);

  // Close on backdrop click outside the card
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      handleClose();
    }
  });

  return backdrop;
}

/**
 * Returns an array of visible, focusable interactive controls inside the shadow root.
 */
export function getFocusableElements(root: ShadowRoot | null): HTMLElement[] {
  if (!root) return [];
  const buttons = Array.from(root.querySelectorAll('button')) as HTMLElement[];
  return buttons.filter((el) => {
    if ((el as any).disabled) return false;
    if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
    if (el.getAttribute('tabindex') === '-1') return false;
    return true;
  });
}

/**
 * Keyboard Tab handler enforcing focus trapping inside the modal dialog.
 */
function handleTabKey(e: KeyboardEvent, shadow: ShadowRoot): void {
  const focusable = getFocusableElements(shadow);
  if (focusable.length === 0) {
    if (typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    return;
  }

  const active =
    (shadow as any).activeElement ||
    (typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null);

  const currentIndex = active ? focusable.indexOf(active) : -1;

  if (typeof e.preventDefault === 'function') {
    e.preventDefault();
  }

  if (e.shiftKey) {
    // Backward Tab: wrap to last if currently at beginning or outside
    if (currentIndex <= 0) {
      focusable[focusable.length - 1].focus();
    } else {
      focusable[currentIndex - 1].focus();
    }
  } else {
    // Forward Tab: wrap to first if currently at end or outside
    if (currentIndex === -1 || currentIndex >= focusable.length - 1) {
      focusable[0].focus();
    } else {
      focusable[currentIndex + 1].focus();
    }
  }
}

/**
 * Displays the Guardrail Staging Modal visual shell in the webpage DOM.
 *
 * Uses Shadow DOM for CSS isolation from the host page.
 * Enforces singleton lifecycle to prevent duplicate panels.
 *
 * @param options Modal rendering parameters and callbacks
 * @returns Programmatic dismiss callback
 */
export function showStagingModal(options: StagingModalOptions = {}): () => void {
  // 1. Dismiss any existing instance
  dismissStagingModal();

  if (typeof document === 'undefined') {
    return dismissStagingModal;
  }

  // Set mounted action ID and advance session token for stale response protection
  currentMountedActionId = options.context?.actionId?.trim() || null;
  currentModalSessionId++;

  // Capture active element before opening modal for focus restoration
  if (document.activeElement) {
    previousActiveElement = document.activeElement as HTMLElement;
  }

  // 2. Create host container
  const host = document.createElement('div');
  host.id = STAGING_HOST_ELEMENT_ID;
  host.style.position = 'relative';
  host.style.zIndex = '2147483647';

  // 3. Attach Shadow DOM
  const shadow = host.attachShadow({ mode: 'open' });
  currentHost = host;
  currentShadow = shadow;

  // 4. Append styles & DOM tree
  shadow.appendChild(createStagingStyles());
  shadow.appendChild(buildModalTree(options));

  // 5. Register Keyboard listener (Escape dismiss & Tab focus trapping)
  if (typeof window !== 'undefined') {
    activeKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissStagingModal();
        if (options.onDismiss) {
          options.onDismiss();
        }
        return;
      }

      if (e.key === 'Tab' && currentShadow) {
        handleTabKey(e, currentShadow);
      }
    };
    window.addEventListener('keydown', activeKeyHandler);
  }

  // 6. Mount to document
  document.body.appendChild(host);

  // 7. Establish initial UI state & accessible live announcements
  const state = options.state || (options.context ? 'active' : 'empty');
  if (state === 'active' && options.context) {
    currentUIState = 'held';
    announceStagingState(
      `Action paused for review: ${options.context.description || 'Action held'}. Risk level: ${
        options.context.riskLevel || 'LOW'
      }.`
    );
  } else if (state === 'loading') {
    announceStagingState('Loading staging preview. Please wait.');
  } else {
    announceStagingState('No action currently paused.');
  }

  // Focus initial interactive control (prefer Cancel Action or first focusable control)
  const initialFocusEl =
    shadow.querySelector('#gs-btn-cancel-action') ||
    shadow.querySelector('.gs-btn-close') ||
    shadow.querySelector('button');
  if (initialFocusEl && typeof (initialFocusEl as any).focus === 'function') {
    (initialFocusEl as any).focus();
  }

  return dismissStagingModal;
}

/**
 * Updates an already mounted Staging Modal with a new context or state without tearing down the host.
 * If the modal is not currently open, opens it cleanly.
 *
 * @param options Updated modal parameters
 */
export function updateStagingModal(options: StagingModalOptions): void {
  if (!isStagingModalActive() || !currentShadow) {
    showStagingModal(options);
    return;
  }

  // Update mounted action and advance session sequence
  currentMountedActionId = options.context?.actionId?.trim() || null;
  currentModalSessionId++;

  // Find existing backdrop
  const existingBackdrop = currentShadow.querySelector('.gs-backdrop');
  if (existingBackdrop) {
    existingBackdrop.remove();
  }

  // Re-build and append updated tree
  currentShadow.appendChild(buildModalTree(options));
}
