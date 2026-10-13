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
  ApprovalRequestIntent,
  ApprovalRequestResult,
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
import { dispatchApprovalRequestToBackground } from '../utils/messaging.js';

export const STAGING_HOST_ELEMENT_ID = 'guardrail-staging-ui-host';

export type StagingDisplayState = 'active' | 'loading' | 'empty';

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
}

let activeKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let currentHost: HTMLDivElement | null = null;
let currentShadow: ShadowRoot | null = null;

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
 * Dismisses and cleans up the active Guardrail Staging Modal.
 * Removes host element and unregisters keyboard event listeners.
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
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
      padding: 0;
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
      padding: 9px 18px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease, border-color 0.15s ease;
      outline: none;
      border: 1px solid transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
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

    .gs-btn-primary:hover {
      background: #0369a1;
      transform: translateY(-1px);
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

    /* Animations */
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

    @media (max-width: 640px) {
      .gs-shell {
        max-width: 100%;
      }
      .gs-header, .gs-body, .gs-footer {
        padding-left: 16px;
        padding-right: 16px;
      }
      .gs-footer {
        flex-direction: column;
        align-items: stretch;
      }
      .gs-btn-group {
        width: 100%;
        justify-content: flex-end;
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
  pill.className = 'gs-mode-pill';
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

  riskHeader.appendChild(riskHeadline);
  riskHeader.appendChild(riskBadge);
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
export function handleModalCancel(
  actionId: string | undefined,
  options: StagingModalOptions,
  uiElements: ModalCancelUIElements
): CancellationResult {
  const { cancelBtn, primaryBtn, body, header, notice } = uiElements;

  // 1. Immediately disable button to prevent repeated clicks / duplicate requests
  cancelBtn.disabled = true;
  cancelBtn.setAttribute('aria-disabled', 'true');

  const id = actionId?.trim();
  if (!id) {
    const errorResult: CancellationResult = {
      success: false,
      actionId: '',
      error: 'Cannot cancel action: No valid action identifier is available.',
    };
    displayConfirmationBanner(
      body,
      'error',
      'Cancellation Could Not Be Completed',
      errorResult.error!
    );
    if (options.onCancelError) {
      options.onCancelError(errorResult);
    }
    return errorResult;
  }

  // 2. Request cancellation via the configured source of truth
  let result: CancellationResult;

  if (options.onCancel) {
    result = options.onCancel(id);
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

  // 3. Process outcome
  if (result.success) {
    // SUCCESS: Display confirmation ONLY after cancellation has succeeded
    displayConfirmationBanner(
      body,
      'success',
      'Action cancelled. Nothing was changed.',
      'The held interaction was aborted safely. No action was executed, no network data was sent, and no page state was modified.'
    );

    // Update Header Pill to CANCELLED badge
    const pill = header.querySelector('.gs-mode-pill');
    if (pill) {
      pill.textContent = 'Cancelled';
      pill.classList.add('gs-badge-cancelled');
    }

    // Update Heading Section
    const headingTitle = body.querySelector('.gs-heading-title');
    if (headingTitle) {
      headingTitle.textContent = 'Action Cancelled';
    }
    const headingSubtitle = body.querySelector('.gs-heading-subtitle');
    if (headingSubtitle) {
      headingSubtitle.textContent = 'This action was cancelled before it could run. Nothing was changed.';
    }

    // Update Controls: Permanently disable/remove action buttons, keep close button available
    cancelBtn.textContent = 'Action Cancelled';
    if (primaryBtn) {
      primaryBtn.style.display = 'none';
      primaryBtn.disabled = true;
    }
    if (notice) {
      notice.textContent = 'Action cancelled safely • State: CANCELLED';
    }

    if (options.onCancelSuccess) {
      options.onCancelSuccess(result);
    }
  } else {
    // REJECTION: Interception was already resolved, invalid state, or unknown ID
    // Show appropriate message rather than claiming success
    displayConfirmationBanner(
      body,
      'error',
      'Cancellation Could Not Be Completed',
      result.error || 'The action could not be cancelled because its state has already changed or it is no longer held.'
    );

    // Keep button disabled to prevent duplicate attempts on an unresolvable action
    cancelBtn.textContent = 'Cancellation Failed';

    if (options.onCancelError) {
      options.onCancelError(result);
    }
  }

  return result;
}

export interface ModalApprovalRequestUIElements {
  requestBtn: HTMLButtonElement;
  cancelBtn?: HTMLButtonElement;
  body: HTMLElement;
  header: HTMLElement;
  notice?: HTMLElement;
}

/**
 * Executes the local approval-request workflow for an intercepted action held in Staging Mode.
 *
 * PROTOTYPE BOUNDARY & ARCHITECTURAL GUARANTEES:
 * 1. Single execution: Disables the button immediately and ignores duplicate/rapid clicks.
 * 2. State Validation: Confirms action is currently in HELD state. Rejects if CONTINUED,
 *    CANCELLED, or untracked.
 * 3. Local Intent Only: Synthesizes typed ApprovalRequestIntent marked 'LOCAL_PROTOTYPE_ONLY'
 *    with minimum safe metadata, strictly excluding sensitive inputs, forms, and credentials.
 * 4. Transparent Communication: Displays clear confirmation that approval requesting is NOT
 *    connected yet. Never shows "Request sent", "Caretaker notified", or "Approved".
 * 5. Action Preserved: Keeps the action held. Never continues or executes the action.
 *    The user retains full ability to cancel the held action afterwards.
 * 6. Local Event Dispatch: Dispatches DOM event `guardrail:approval-requested` and sends
 *    GUARDRAIL_APPROVAL_REQUEST to the background service worker coordinator.
 */
export function handleModalRequestApproval(
  context: StagingActionContext | undefined,
  options: StagingModalOptions,
  uiElements: ModalApprovalRequestUIElements
): ApprovalRequestResult {
  const { requestBtn, cancelBtn, body, header, notice } = uiElements;

  // 1. Immediately disable button to prevent repeated clicks / duplicate requests
  requestBtn.disabled = true;
  requestBtn.setAttribute('aria-disabled', 'true');

  // 2. Validate context and identifier
  const actionId = context?.actionId?.trim();
  if (!context || !actionId) {
    const errorResult: ApprovalRequestResult = {
      success: false,
      actionId: '',
      error: 'Cannot request approval: No valid action context or identifier is available.',
      isBackendConnected: false,
    };
    displayConfirmationBanner(
      body,
      'error',
      'Approval Request Could Not Be Prepared',
      errorResult.error!
    );
    requestBtn.textContent = 'Request Unavailable';
    if (options.onRequestApprovalError) {
      options.onRequestApprovalError(errorResult);
    }
    return errorResult;
  }

  // 3. Validate live controller state
  const controller = options.controller || defaultInterceptionController;
  const record = controller.getRecord(actionId);

  if (!record) {
    const errorResult: ApprovalRequestResult = {
      success: false,
      actionId,
      error: `Cannot request approval: Action "${actionId}" is not actively tracked by Guardrail.`,
      isBackendConnected: false,
    };
    displayConfirmationBanner(
      body,
      'error',
      'Approval Request Could Not Be Prepared',
      errorResult.error!
    );
    requestBtn.textContent = 'Request Unavailable';
    if (options.onRequestApprovalError) {
      options.onRequestApprovalError(errorResult);
    }
    return errorResult;
  }

  if (record.state !== InterceptionState.HELD) {
    const errorResult: ApprovalRequestResult = {
      success: false,
      actionId,
      error: `Cannot request approval for action "${actionId}": State is "${record.state}". Only actions in HELD state are eligible for approval requests.`,
      isBackendConnected: false,
    };
    displayConfirmationBanner(
      body,
      'error',
      'Approval Request Could Not Be Prepared',
      errorResult.error!
    );
    requestBtn.textContent = 'Request Unavailable';
    if (options.onRequestApprovalError) {
      options.onRequestApprovalError(errorResult);
    }
    return errorResult;
  }

  // 4. Create typed ApprovalRequestIntent
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
    displayConfirmationBanner(
      body,
      'error',
      'Approval Request Could Not Be Prepared',
      errorMsg
    );
    requestBtn.textContent = 'Request Failed';
    if (options.onRequestApprovalError) {
      options.onRequestApprovalError(errorResult);
    }
    return errorResult;
  }

  // 5. Build result
  const result: ApprovalRequestResult = {
    success: true,
    actionId,
    intent,
    isBackendConnected: false,
  };

  // 6. Dispatch local DOM custom event for automation/testing
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

  // 7. Dispatch to background service worker (resilient, asynchronous)
  dispatchApprovalRequestToBackground(intent).catch((err) => {
    console.warn('[Guardrail Staging] Background approval dispatch notification failed:', err);
  });

  // 8. Update UI Feedback:
  // PROTOTYPE BOUNDARY: Explicitly communicate that backend services & caretaker delivery are not connected.
  // Never show "Request sent", "Caretaker notified", or "Approved".
  displayConfirmationBanner(
    body,
    'info',
    'Approval Request Prepared (Local Prototype)',
    'An approval request intent was recorded locally for this action. Remote caretaker approval and backend services are not connected yet. This action remains safely paused and will not execute.'
  );

  // Update header pill to indicate request prepared while remaining paused
  const pill = header.querySelector('.gs-mode-pill');
  if (pill) {
    pill.textContent = 'Paused (Request Prepared)';
    pill.classList.add('gs-badge-requested');
  }

  // Update footer notice and controls
  requestBtn.textContent = 'Request Prepared (Local)';
  if (notice) {
    notice.textContent = 'Approval intent recorded locally • Backend not connected • State: HELD';
  }

  // Ensure cancel button remains enabled so user can still cancel this held action
  if (cancelBtn) {
    cancelBtn.disabled = false;
  }

  if (options.onRequestApprovalSuccess) {
    options.onRequestApprovalSuccess(result);
  }

  return result;
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

    let isCancelling = false;
    let isRequesting = false;

    const requestApprovalBtn = document.createElement('button');
    requestApprovalBtn.type = 'button';
    requestApprovalBtn.id = 'gs-btn-request-approval';
    requestApprovalBtn.className = 'gs-btn gs-btn-primary';
    requestApprovalBtn.textContent = 'Request Approval';
    requestApprovalBtn.setAttribute('title', 'Prepare a local approval request intent for this held action');

    requestApprovalBtn.addEventListener('click', () => {
      if (isRequesting || requestApprovalBtn.disabled) {
        return;
      }
      isRequesting = true;
      if (options.onPrimaryAction) {
        options.onPrimaryAction();
      }
      handleModalRequestApproval(options.context, options, {
        requestBtn: requestApprovalBtn,
        cancelBtn,
        body: uiRefs.body,
        header: uiRefs.header,
        notice,
      });
    });

    cancelBtn.addEventListener('click', () => {
      if (isCancelling || cancelBtn.disabled) {
        return;
      }
      isCancelling = true;
      handleModalCancel(options.context?.actionId, options, {
        cancelBtn,
        primaryBtn: requestApprovalBtn,
        body: uiRefs.body,
        header: uiRefs.header,
        notice,
      });
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

  // 5. Register Escape key listener
  if (typeof window !== 'undefined') {
    activeKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissStagingModal();
        if (options.onDismiss) {
          options.onDismiss();
        }
      }
    };
    window.addEventListener('keydown', activeKeyHandler);
  }

  // 6. Mount to document
  document.body.appendChild(host);

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

  // Find existing backdrop
  const existingBackdrop = currentShadow.querySelector('.gs-backdrop');
  if (existingBackdrop) {
    existingBackdrop.remove();
  }

  // Re-build and append updated tree
  currentShadow.appendChild(buildModalTree(options));
}
