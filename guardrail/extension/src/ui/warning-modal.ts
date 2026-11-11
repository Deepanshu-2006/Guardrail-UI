/**
 * Guardrail Warning UI Component
 *
 * Dynamically injected modal dialog presented to the user when Guardrail renders
 * a WARN response.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. SHADOW DOM ISOLATION: Rendered inside a Shadow Root attached to a transient host.
 *    Completely insulates Guardrail's styles from the host webpage's CSS and vice versa.
 * 2. CLARITY & ACCESSIBILITY: Accessible alert dialog (role="alertdialog", aria-modal="true",
 *    aria-labelledby, aria-describedby) with focus trapping, high contrast, accessible announcements,
 *    and keyboard support.
 * 3. TRANSPARENT SECURITY SCOPE: Communicates:
 *    - Which specific website or domain triggered the warning.
 *    - Whether the warning is based on local safety heuristics or verified threat intelligence.
 *    - What specific suspicious characteristics were detected.
 *    - Why Guardrail considers the situation risky in non-frightening, plain language.
 *    - What the user can safely do next (recovery steps).
 *    - Clear statement of action status: whether the action was prevented, held, or merely warned about.
 * 4. STRICT NON-MALICE DISTINCTION: Avoids accusatory or sensationalized claims ("fraud", "hacker").
 *    Distinguishes heuristic pattern matching from verified threat lists.
 * 5. SEPARATE DIAGNOSTICS: Technical diagnostics (rule IDs, reason codes, raw scores) are partitioned
 *    in an accessible collapsible details section, keeping user copy clear and reassuring.
 * 6. STRICT PRIVACY: Target URLs are sanitized (query parameters and tokens stripped); credentials and
 *    form values are never inspected or displayed.
 * 7. COMPREHENSIVE VIEW STATES: Supports active warning, loading, and clean programmatic dismissal.
 */

import { GuardrailAction } from '../types/actions.js';
import { RiskAssessment } from '../types/risk.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';
import {
  explainRiskDecision,
  RiskDecisionExplanation,
  WebsiteSecurityContext,
  extractWebsiteSecurityContext,
} from '../response/explanation.js';
import { sanitizeUrlForDiagnostics } from '../utils/privacy.js';

export type WarningModalViewState = 'warning' | 'loading' | 'dismissed';

export interface WarningModalProps {
  /** The interaction that triggered the warning */
  action: GuardrailAction;

  /** Evaluated risk assessment */
  risk: RiskAssessment;

  /** Response decision rendered */
  decision: ResponseDecision;

  /** Optional pre-computed explanation */
  explanation?: RiskDecisionExplanation;

  /** Initial view state: warning (default) or loading */
  initialState?: WarningModalViewState;

  /** Callback when user clicks Continue */
  onContinue?: () => void;

  /** Callback when user clicks Cancel */
  onCancel?: () => void;
}

export const HOST_ELEMENT_ID = 'guardrail-warning-ui-host';

let activeEscapeHandler: ((e: KeyboardEvent) => void) | null = null;
let activeTabTrapHandler: ((e: KeyboardEvent) => void) | null = null;
let previousActiveElement: HTMLElement | null = null;
let currentModalProps: WarningModalProps | null = null;
let currentHost: HTMLElement | null = null;
let currentShadow: ShadowRoot | null = null;

/**
 * Checks whether the Guardrail warning modal is currently present in the DOM.
 */
export function isWarningModalActive(): boolean {
  return typeof document !== 'undefined' && Boolean(document.getElementById(HOST_ELEMENT_ID));
}

/**
 * Dismisses and cleans up any currently active Guardrail warning modal.
 */
export function dismissWarningModal(): void {
  if (typeof window !== 'undefined') {
    if (activeEscapeHandler) {
      window.removeEventListener('keydown', activeEscapeHandler);
      activeEscapeHandler = null;
    }
    if (activeTabTrapHandler) {
      window.removeEventListener('keydown', activeTabTrapHandler);
      activeTabTrapHandler = null;
    }
  }
  const existingHost = typeof document !== 'undefined' ? document.getElementById(HOST_ELEMENT_ID) : null;
  if (existingHost) {
    existingHost.remove();
  }

  currentHost = null;
  currentShadow = null;
  currentModalProps = null;

  // Restore focus to previous active element upon dismissal
  if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
    try {
      previousActiveElement.focus();
    } catch {
      // Ignore focus errors in mock or headless environments
    }
    previousActiveElement = null;
  }
}

/**
 * Updates the view state of an active warning modal (e.g. loading, warning, or dismissed).
 *
 * @param state New view state
 * @param message Optional status or loading message
 */
export function updateWarningModalState(state: WarningModalViewState, message?: string): void {
  if (state === 'dismissed') {
    dismissWarningModal();
    return;
  }

  if (!currentShadow) return;

  const card = currentShadow.querySelector('.gr-card') as HTMLElement;
  const loadingOverlay = currentShadow.querySelector('.gr-loading-overlay') as HTMLElement;
  const loadingText = currentShadow.querySelector('.gr-loading-text') as HTMLElement;
  const continueBtn = currentShadow.querySelector('.gr-btn-continue') as HTMLButtonElement;
  const cancelBtn = currentShadow.querySelector('.gr-btn-cancel') as HTMLButtonElement;
  const closeBtn = currentShadow.querySelector('.gr-btn-close') as HTMLButtonElement;

  if (state === 'loading') {
    if (loadingOverlay) {
      loadingOverlay.style.display = 'flex';
      if (message && loadingText) {
        loadingText.textContent = message;
      }
    }
    if (continueBtn) continueBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;
    if (card) card.setAttribute('aria-busy', 'true');
  } else if (state === 'warning') {
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }
    if (continueBtn) continueBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    if (closeBtn) closeBtn.disabled = false;
    if (card) card.setAttribute('aria-busy', 'false');
  }
}

/**
 * Injects and displays the enhanced Guardrail warning UI into the webpage.
 *
 * @param props Metadata for rendering the warning dialog.
 * @returns A dismiss function to close the warning programmatically.
 */
export function showWarningModal(props: WarningModalProps): () => void {
  // 1. Remove any previous instance to prevent stacking
  dismissWarningModal();
  currentModalProps = props;

  // Capture active element before opening modal for focus restoration
  if (typeof document !== 'undefined' && document.activeElement) {
    previousActiveElement = document.activeElement as HTMLElement;
  }

  // 2. Create the transient host container
  const host = document.createElement('div');
  host.id = HOST_ELEMENT_ID;
  host.style.position = 'relative';
  host.style.zIndex = '2147483647'; // Maximum possible z-index
  currentHost = host;

  // 3. Attach an isolated Shadow Root
  const shadow = host.attachShadow({ mode: 'open' });
  currentShadow = shadow;

  // 4. Derive structured explanation and website security context
  const explanation = props.explanation || explainRiskDecision(props.decision, props.risk, props.action);
  const webCtx: WebsiteSecurityContext =
    explanation.websiteContext ||
    extractWebsiteSecurityContext(props.action, props.risk, props.decision);

  const sanitizedUrl = sanitizeUrlForDiagnostics(props.action.page?.url);
  const targetLabel =
    props.action.element?.visibleText ||
    props.action.element?.id ||
    props.action.element?.tagName ||
    sanitizedUrl ||
    'Selected interaction';

  const isAdvisoryOnly = props.decision.response === ResponseAction.WARN;

  // 5. Construct encapsulated styles
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .gr-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .gr-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(20, 26, 17, 0.78);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 2147483647;
      animation: grFadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .gr-card {
      background: #1C2318;
      border: 1px solid rgba(237, 230, 214, 0.12);
      border-radius: 16px;
      width: 100%;
      max-width: 540px;
      box-shadow: 0 24px 56px -8px rgba(10, 14, 9, 0.72),
                  0 4px 16px -2px rgba(10, 14, 9, 0.4),
                  inset 0 1px 0 rgba(237, 230, 214, 0.14);
      font-family: -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif;
      color: #EDE6D6;
      overflow: hidden;
      position: relative;
      animation: grSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      outline: none;
    }

    .gr-header {
      padding: 16px 22px;
      background: linear-gradient(180deg, rgba(42, 54, 36, 0.95) 0%, rgba(32, 41, 27, 0.95) 100%);
      border-bottom: 1px solid rgba(237, 230, 214, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .gr-header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .gr-brand {
      display: flex;
      align-items: center;
      gap: 9px;
      font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 700;
      font-size: 13.5px;
      letter-spacing: -0.01em;
      color: #EDE6D6;
    }

    .gr-brand-icon {
      font-size: 15px;
      line-height: 1;
    }

    .gr-pill {
      font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      padding: 4px 10px;
      border-radius: 4px;
      background: rgba(217, 119, 6, 0.16);
      border: 1px solid rgba(217, 119, 6, 0.38);
      color: #FBBF24;
      text-transform: uppercase;
    }

    .gr-btn-close {
      background: transparent;
      border: 1px solid transparent;
      color: rgba(237, 230, 214, 0.55);
      font-size: 14px;
      line-height: 1;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      cursor: pointer;
      padding: 0;
      transition: all 0.15s ease;
    }

    .gr-btn-close:hover, .gr-btn-close:focus-visible {
      background: rgba(237, 230, 214, 0.08);
      border-color: rgba(237, 230, 214, 0.15);
      color: #EDE6D6;
      outline: none;
    }

    .gr-body {
      padding: 24px;
      max-height: 75vh;
      overflow-y: auto;
    }

    /* Action Status Banner */
    .gr-action-status-banner {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 12.5px;
      line-height: 1.45;
    }

    .gr-status-advisory {
      background: rgba(217, 119, 6, 0.09);
      border: 1px solid rgba(217, 119, 6, 0.28);
      color: rgba(237, 230, 214, 0.88);
    }

    .gr-status-held {
      background: rgba(185, 28, 28, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.32);
      color: #FCA5A5;
    }

    .gr-status-headline {
      font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 700;
      font-size: 12.5px;
      letter-spacing: 0.02em;
      display: block;
      color: #EDE6D6;
      margin-bottom: 2px;
    }

    .gr-status-subtext {
      font-size: 11.5px;
      color: rgba(237, 230, 214, 0.72);
      line-height: 1.4;
    }

    /* Website Domain Callout Box */
    .gr-domain-callout {
      background: rgba(32, 41, 27, 0.6);
      border: 1px solid rgba(237, 230, 214, 0.08);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 22px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .gr-domain-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12.5px;
    }

    .gr-domain-label {
      color: rgba(237, 230, 214, 0.6);
      font-weight: 500;
      letter-spacing: 0.02em;
    }

    .gr-domain-value {
      color: #EDE6D6;
      font-weight: 700;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12.5px;
      background: rgba(0, 0, 0, 0.25);
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid rgba(237, 230, 214, 0.1);
      word-break: break-all;
    }

    .gr-source-indicator {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding-top: 8px;
      border-top: 1px solid rgba(237, 230, 214, 0.06);
    }

    .gr-source-tag {
      font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #FBBF24;
    }

    .gr-source-subtext {
      font-size: 11px;
      color: rgba(237, 230, 214, 0.55);
      line-height: 1.35;
    }

    .gr-title {
      font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 20px;
      font-weight: 700;
      color: #EDE6D6;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
      line-height: 1.25;
    }

    .gr-summary {
      font-size: 13px;
      color: rgba(237, 230, 214, 0.72);
      margin-bottom: 20px;
      line-height: 1.5;
    }

    .gr-section-title {
      font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: rgba(237, 230, 214, 0.6);
      margin-bottom: 10px;
    }

    .gr-reasons-list, .gr-guidance-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 20px;
    }

    .gr-reason-item {
      font-size: 12.5px;
      line-height: 1.45;
      color: rgba(237, 230, 214, 0.9);
      background: rgba(217, 119, 6, 0.07);
      border-left: 3px solid #D97706;
      padding: 9px 14px;
      border-radius: 0 6px 6px 0;
    }

    .gr-risk-box {
      background: rgba(26, 33, 22, 0.7);
      border: 1px solid rgba(237, 230, 214, 0.08);
      border-radius: 8px;
      padding: 13px 16px;
      margin-bottom: 20px;
      font-size: 12.5px;
      line-height: 1.5;
      color: rgba(237, 230, 214, 0.82);
    }

    .gr-risk-box-title {
      font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.02em;
      color: #FBBF24;
      margin-bottom: 5px;
    }

    .gr-guidance-item {
      font-size: 12.5px;
      line-height: 1.45;
      color: #EDE6D6;
      background: rgba(42, 54, 36, 0.45);
      border-left: 3px solid #5A744C;
      padding: 9px 14px;
      border-radius: 0 6px 6px 0;
    }

    .gr-continuation-disclaimer {
      font-size: 11.5px;
      color: rgba(237, 230, 214, 0.6);
      background: rgba(0, 0, 0, 0.22);
      border: 1px dashed rgba(237, 230, 214, 0.12);
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 20px;
      line-height: 1.45;
    }

    .gr-diagnostics {
      margin-top: 14px;
      background: rgba(20, 26, 17, 0.5);
      border: 1px solid rgba(237, 230, 214, 0.08);
      border-radius: 8px;
      overflow: hidden;
      font-size: 12px;
    }

    .gr-diagnostics-summary {
      padding: 10px 14px;
      font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 600;
      font-size: 11.5px;
      letter-spacing: 0.03em;
      color: rgba(237, 230, 214, 0.6);
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 7px;
      transition: color 0.15s ease;
    }

    .gr-diagnostics-summary:hover, .gr-diagnostics-summary:focus-visible {
      color: #EDE6D6;
      outline: none;
    }

    .gr-diagnostics-body {
      padding: 12px 14px;
      border-top: 1px solid rgba(237, 230, 214, 0.06);
      display: flex;
      flex-direction: column;
      gap: 7px;
      background: rgba(0, 0, 0, 0.2);
    }

    .gr-diag-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }

    .gr-diag-key {
      color: rgba(237, 230, 214, 0.45);
      font-size: 11px;
    }

    .gr-diag-val {
      color: rgba(237, 230, 214, 0.85);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      word-break: break-all;
    }

    .gr-footer {
      padding: 16px 22px;
      background: rgba(26, 33, 22, 0.95);
      border-top: 1px solid rgba(237, 230, 214, 0.08);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
    }

    .gr-btn {
      font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      outline: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .gr-btn:focus-visible {
      outline: 2px solid #D97706;
      outline-offset: 2px;
    }

    .gr-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Primary Recommended Action: Cancel (Leave Page) */
    .gr-btn-cancel {
      background: #2A3624;
      border: 1px solid rgba(237, 230, 214, 0.16);
      color: #EDE6D6;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35),
                  inset 0 1px 0 rgba(237, 230, 214, 0.12);
    }

    .gr-btn-cancel:hover:not(:disabled) {
      background: #36462E;
      color: #FFFFFF;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
    }

    .gr-btn-cancel:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    }

    /* Cautionary Secondary Action: Continue at My Own Risk */
    .gr-btn-continue {
      background: transparent;
      border: 1px solid rgba(217, 119, 6, 0.45);
      color: #FBBF24;
      box-shadow: none;
    }

    .gr-btn-continue:hover:not(:disabled) {
      background: rgba(217, 119, 6, 0.14);
      border-color: #F59E0B;
      color: #FDE68A;
      transform: translateY(-1px);
    }

    .gr-btn-continue:active:not(:disabled) {
      transform: translateY(0);
      background: rgba(217, 119, 6, 0.08);
    }

    /* Loading Overlay State */
    .gr-loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(20, 26, 17, 0.94);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      z-index: 10;
      border-radius: 16px;
    }

    .gr-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(217, 119, 6, 0.2);
      border-top-color: #F59E0B;
      border-radius: 50%;
      animation: grSpin 0.75s linear infinite;
    }

    .gr-loading-text {
      font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      letter-spacing: 0.02em;
      color: #EDE6D6;
      font-weight: 600;
    }

    @keyframes grSpin {
      to { transform: rotate(360deg); }
    }

    @keyframes grFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes grSlideUp {
      from {
        opacity: 0;
        transform: translateY(16px) scale(0.97);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `;

  // 6. Build the dialog DOM structure
  const backdrop = document.createElement('div');
  backdrop.className = 'gr-backdrop';

  const card = document.createElement('div');
  card.className = 'gr-card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'gr-title-id');
  card.setAttribute('aria-describedby', 'gr-summary-id');
  card.setAttribute('tabindex', '-1');

  // Accessible Live Region for Screen Readers
  const srAnnounce = document.createElement('div');
  srAnnounce.className = 'gr-sr-only';
  srAnnounce.setAttribute('role', 'status');
  srAnnounce.setAttribute('aria-live', 'polite');
  srAnnounce.setAttribute('aria-atomic', 'true');
  srAnnounce.textContent = `Guardrail Safety Advisory: ${explanation.headline}. Website: ${webCtx.domain}. ${webCtx.actionStatusExplanation}`;
  card.appendChild(srAnnounce);

  // Loading Overlay
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'gr-loading-overlay';
  const spinner = document.createElement('div');
  spinner.className = 'gr-spinner';
  const loadingText = document.createElement('div');
  loadingText.className = 'gr-loading-text';
  loadingText.textContent = 'Processing selection...';
  loadingOverlay.appendChild(spinner);
  loadingOverlay.appendChild(loadingText);
  card.appendChild(loadingOverlay);

  // Header
  const header = document.createElement('div');
  header.className = 'gr-header';

  const brand = document.createElement('div');
  brand.className = 'gr-brand';
  const brandIcon = document.createElement('span');
  brandIcon.className = 'gr-brand-icon';
  brandIcon.textContent = '🛡️';
  const brandTitle = document.createElement('span');
  brandTitle.textContent = 'Guardrail Safety Advisory';
  brand.appendChild(brandIcon);
  brand.appendChild(brandTitle);

  const headerRight = document.createElement('div');
  headerRight.className = 'gr-header-right';

  const pill = document.createElement('span');
  pill.className = 'gr-pill';
  pill.textContent = explanation.categoryBadge;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gr-btn-close';
  closeBtn.setAttribute('aria-label', 'Close warning dialog');
  closeBtn.setAttribute('title', 'Close warning');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    dismissWarningModal();
    if (props.onCancel) {
      props.onCancel();
    }
  });

  headerRight.appendChild(pill);
  headerRight.appendChild(closeBtn);
  header.appendChild(brand);
  header.appendChild(headerRight);

  // Body
  const body = document.createElement('div');
  body.className = 'gr-body';

  // 1. Action Status Banner (Requirement 6)
  const statusBanner = document.createElement('div');
  statusBanner.className = `gr-action-status-banner ${isAdvisoryOnly ? 'gr-status-advisory' : 'gr-status-held'}`;
  statusBanner.setAttribute('role', 'note');

  const statusIcon = document.createElement('span');
  statusIcon.textContent = isAdvisoryOnly ? 'ℹ️' : '🛡️';

  const statusContent = document.createElement('div');
  const statusHeadline = document.createElement('span');
  statusHeadline.className = 'gr-status-headline';
  statusHeadline.textContent = isAdvisoryOnly
    ? 'Action Status: Advisory Notice'
    : 'Action Status: Held in Staging Mode';

  const statusSubtext = document.createElement('span');
  statusSubtext.className = 'gr-status-subtext';
  statusSubtext.textContent = webCtx.actionStatusExplanation;

  statusContent.appendChild(statusHeadline);
  statusContent.appendChild(statusSubtext);
  statusBanner.appendChild(statusIcon);
  statusBanner.appendChild(statusContent);
  body.appendChild(statusBanner);

  // 2. Website Domain & Detection Basis Callout (Requirements 1 & 2)
  const domainCallout = document.createElement('div');
  domainCallout.className = 'gr-domain-callout';

  const domainHeader = document.createElement('div');
  domainHeader.className = 'gr-domain-header';

  const domainIcon = document.createElement('span');
  domainIcon.className = 'gr-domain-icon';
  domainIcon.textContent = '🌐';

  const domainLabel = document.createElement('span');
  domainLabel.className = 'gr-domain-label';
  domainLabel.textContent = 'Website Domain:';

  const domainValue = document.createElement('span');
  domainValue.className = 'gr-domain-value';
  domainValue.textContent = webCtx.domain;

  domainHeader.appendChild(domainIcon);
  domainHeader.appendChild(domainLabel);
  domainHeader.appendChild(domainValue);

  const sourceInd = document.createElement('div');
  sourceInd.className = 'gr-source-indicator';

  const sourceTag = document.createElement('span');
  sourceTag.className = 'gr-source-tag';
  sourceTag.textContent = '🔍 Detection Basis: Local Safety Heuristic';

  const sourceSubtext = document.createElement('span');
  sourceSubtext.className = 'gr-source-subtext';
  sourceSubtext.textContent = webCtx.sourceDisclaimer;

  sourceInd.appendChild(sourceTag);
  sourceInd.appendChild(sourceSubtext);

  domainCallout.appendChild(domainHeader);
  domainCallout.appendChild(sourceInd);
  body.appendChild(domainCallout);

  // 3. Headline & Summary
  const title = document.createElement('h2');
  title.id = 'gr-title-id';
  title.className = 'gr-title';
  title.textContent = explanation.headline;

  const summary = document.createElement('p');
  summary.id = 'gr-summary-id';
  summary.className = 'gr-summary';
  summary.textContent = explanation.userSummary;

  body.appendChild(title);
  body.appendChild(summary);

  // 4. Detected Characteristics (Requirement 3)
  const reasonsTitle = document.createElement('div');
  reasonsTitle.className = 'gr-section-title';
  reasonsTitle.textContent = 'Detected Characteristics:';

  const reasonsListEl = document.createElement('ul');
  reasonsListEl.className = 'gr-reasons-list';
  const characteristics =
    webCtx.detectedCharacteristics && webCtx.detectedCharacteristics.length > 0
      ? webCtx.detectedCharacteristics
      : explanation.whyFlagged;

  for (const char of characteristics) {
    const item = document.createElement('li');
    item.className = 'gr-reason-item';
    item.textContent = char;
    reasonsListEl.appendChild(item);
  }

  body.appendChild(reasonsTitle);
  body.appendChild(reasonsListEl);

  // 5. Why Considered Risky (Requirement 4)
  const riskBox = document.createElement('div');
  riskBox.className = 'gr-risk-box';

  const riskBoxTitle = document.createElement('div');
  riskBoxTitle.className = 'gr-risk-box-title';
  riskBoxTitle.textContent = 'Why Guardrail Considers This Risky:';

  const riskBoxContent = document.createElement('div');
  riskBoxContent.textContent = webCtx.riskImpactExplanation;

  riskBox.appendChild(riskBoxTitle);
  riskBox.appendChild(riskBoxContent);
  body.appendChild(riskBox);

  // 6. Safe Next Steps (Requirement 5)
  const guidanceTitle = document.createElement('div');
  guidanceTitle.className = 'gr-section-title';
  guidanceTitle.textContent = 'What You Can Safely Do Next:';

  const guidanceListEl = document.createElement('ul');
  guidanceListEl.className = 'gr-guidance-list';
  const safeSteps =
    webCtx.safeNextSteps && webCtx.safeNextSteps.length > 0
      ? webCtx.safeNextSteps
      : explanation.recoveryGuidance || [];

  for (const step of safeSteps) {
    const gItem = document.createElement('li');
    gItem.className = 'gr-guidance-item';
    gItem.textContent = step;
    guidanceListEl.appendChild(gItem);
  }

  body.appendChild(guidanceTitle);
  body.appendChild(guidanceListEl);

  // 7. Explicit Continuation Disclaimer (Important invariant)
  const contDisclaimer = document.createElement('div');
  contDisclaimer.className = 'gr-continuation-disclaimer';
  contDisclaimer.textContent = `⚠️ ${webCtx.continuationDisclaimer}`;
  body.appendChild(contDisclaimer);

  // 8. Separated Technical Diagnostics
  const detailsEl = document.createElement('details');
  detailsEl.className = 'gr-diagnostics';

  const summaryToggle = document.createElement('summary');
  summaryToggle.className = 'gr-diagnostics-summary';
  summaryToggle.textContent = '⚙️ Technical Diagnostics';
  detailsEl.appendChild(summaryToggle);

  const diagBody = document.createElement('div');
  diagBody.className = 'gr-diagnostics-body';

  const diagRows = [
    { label: 'Website Domain', value: webCtx.domain },
    { label: 'Detection Basis', value: webCtx.source },
    { label: 'Action Status', value: webCtx.actionStatus },
    { label: 'Policy Rule', value: explanation.technicalDetails.ruleId || 'N/A' },
    { label: 'Reason Code', value: explanation.technicalDetails.reasonCode || 'N/A' },
    {
      label: 'Sensitivity Score',
      value: `${explanation.technicalDetails.score ?? props.risk.score} / 100 (${props.risk.riskLevel})`,
    },
    { label: 'Action ID', value: props.action.id },
    { label: 'Sanitized URL', value: sanitizedUrl || 'N/A' },
    { label: 'Threat Classification', value: 'Not a verified malware threat (local heuristic)' },
  ];

  for (const row of diagRows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'gr-diag-row';

    const keySpan = document.createElement('span');
    keySpan.className = 'gr-diag-key';
    keySpan.textContent = row.label;

    const valCode = document.createElement('code');
    valCode.className = 'gr-diag-val';
    valCode.textContent = row.value;

    rowEl.appendChild(keySpan);
    rowEl.appendChild(valCode);
    diagBody.appendChild(rowEl);
  }

  detailsEl.appendChild(diagBody);
  body.appendChild(detailsEl);

  // Footer / Controls
  const footer = document.createElement('div');
  footer.className = 'gr-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'gr-btn gr-btn-cancel';
  cancelBtn.textContent = 'Cancel (Leave Page)';
  cancelBtn.addEventListener('click', () => {
    dismissWarningModal();
    if (props.onCancel) {
      props.onCancel();
    }
  });

  const continueBtn = document.createElement('button');
  continueBtn.type = 'button';
  continueBtn.className = 'gr-btn gr-btn-continue';
  continueBtn.textContent = 'Continue at My Own Risk';
  continueBtn.addEventListener('click', () => {
    dismissWarningModal();
    if (props.onContinue) {
      props.onContinue();
    }
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(continueBtn);

  // Assemble Card
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  backdrop.appendChild(card);

  // Dismiss on backdrop click
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      dismissWarningModal();
      if (props.onCancel) {
        props.onCancel();
      }
    }
  });

  shadow.appendChild(style);
  shadow.appendChild(backdrop);

  // 7. Register Keyboard Navigation (Escape + Focus Trapping)
  if (typeof window !== 'undefined') {
    activeEscapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissWarningModal();
        if (props.onCancel) {
          props.onCancel();
        }
      }
    };
    window.addEventListener('keydown', activeEscapeHandler);

    // Tab Focus Trap
    const focusableElements = [cancelBtn, continueBtn, closeBtn, summaryToggle];
    activeTabTrapHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const activeEl = shadow.activeElement || document.activeElement;
      const currentIndex = focusableElements.indexOf(activeEl as any);

      if (e.shiftKey) {
        if (currentIndex <= 0) {
          e.preventDefault();
          focusableElements[focusableElements.length - 1].focus();
        }
      } else {
        if (currentIndex >= focusableElements.length - 1) {
          e.preventDefault();
          focusableElements[0].focus();
        }
      }
    };
    window.addEventListener('keydown', activeTabTrapHandler);
  }

  // 8. Mount to DOM
  document.body.appendChild(host);

  // 9. Initial safety focus on Cancel button to avoid accidental continuation
  try {
    cancelBtn.focus();
  } catch {
    // Non-fatal if focus() is unhandled in mock headless environments
  }

  // If initial state was loading, apply loading state immediately
  if (props.initialState === 'loading') {
    updateWarningModalState('loading', 'Loading safety information...');
  }

  // Return programmatic dismiss callback
  return dismissWarningModal;
}

function escapeText(text: string): string {
  if (typeof document === 'undefined') {
    return text.replace(/[&<>"']/g, (m) => {
      switch (m) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return m;
      }
    });
  }
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
