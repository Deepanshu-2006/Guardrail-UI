/**
 * Guardrail Non-Blocking Advisory Notice UI Component
 *
 * Lightweight, non-blocking notification displayed for ADVISE response level
 * (mildly concerning, unknown, or uncertain situations).
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. NON-BLOCKING: Host element and toast container NEVER block normal user clicks
 *    or interactions on the host webpage (pointer-events: none on host container).
 * 2. NO FULL-SCREEN MODAL: No dark backdrop, no modal trapping, no scroll locking.
 * 3. ZERO CARETAKER REQUESTS: Strictly never initiates caretaker approval requests.
 * 4. AUTONOMOUS DISMISSAL: Auto-dismisses after 6 seconds or upon explicit user dismissal.
 * 5. SHADOW DOM ISOLATION: Encapsulated within Shadow DOM to avoid host CSS leakage.
 */

import { GuardrailAction } from '../types/actions.js';
import { ResponseDecision } from '../types/response.js';
import { RiskAssessment } from '../types/risk.js';
import { RiskDecisionExplanation, explainRiskDecision } from '../response/explanation.js';

export interface AdvisoryNoticeProps {
  action: GuardrailAction;
  risk?: RiskAssessment;
  decision?: ResponseDecision;
  explanation?: RiskDecisionExplanation;
  message?: string;
  durationMs?: number;
  onDismiss?: () => void;
}

export const ADVISORY_HOST_ELEMENT_ID = 'guardrail-advisory-notice-host';

let activeDismissTimer: any = null;
let currentAdvisoryHost: HTMLElement | null = null;

/**
 * Checks whether the Guardrail advisory notice is currently present in the DOM.
 */
export function isAdvisoryNoticeActive(): boolean {
  return typeof document !== 'undefined' && Boolean(document.getElementById(ADVISORY_HOST_ELEMENT_ID));
}

/**
 * Dismisses and cleans up any currently active Guardrail advisory notice.
 */
export function dismissAdvisoryNotice(): void {
  if (activeDismissTimer) {
    clearTimeout(activeDismissTimer);
    activeDismissTimer = null;
  }
  const existingHost = typeof document !== 'undefined' ? document.getElementById(ADVISORY_HOST_ELEMENT_ID) : null;
  if (existingHost) {
    existingHost.remove();
  }
  currentAdvisoryHost = null;
}

/**
 * Injects and displays the non-blocking Guardrail advisory notice toast.
 *
 * @param props Metadata for rendering the advisory notice
 * @returns A dismiss function to close the notice programmatically
 */
export function showAdvisoryNotice(props: AdvisoryNoticeProps): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }

  // Dismiss any existing advisory
  dismissAdvisoryNotice();

  const explanation =
    props.explanation ||
    (props.decision ? explainRiskDecision(props.decision, props.risk, props.action) : undefined);

  const headline = explanation?.headline || 'Safety Advisory: Caution Recommended';
  const summaryText =
    props.message ||
    explanation?.userSummary ||
    'You are interacting with an external or unverified destination. Normal browsing continues.';
  const categoryBadge = explanation?.categoryBadge || 'Guardrail Advisory';

  // 1. Create transient host element
  const host = document.createElement('div');
  host.id = ADVISORY_HOST_ELEMENT_ID;
  host.style.position = 'fixed';
  host.style.bottom = '24px';
  host.style.right = '24px';
  host.style.zIndex = '2147483646'; // 1 below modal
  host.style.pointerEvents = 'none'; // CRITICAL: Non-blocking on the page
  currentAdvisoryHost = host;

  // 2. Attach Shadow DOM
  const shadow = host.attachShadow({ mode: 'open' });

  // 3. Construct encapsulated styles
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .gr-advisory-toast {
      pointer-events: auto;
      background: #F5F2E8;
      border: 1.5px solid #CCD4BF;
      border-radius: 12px;
      padding: 14px 18px;
      max-width: 380px;
      box-shadow: 0 12px 32px -4px rgba(24, 28, 20, 0.18),
                  0 2px 6px rgba(24, 28, 20, 0.08);
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #25291F;
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
      animation: grToastSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      line-height: 1.45;
    }

    .gr-advisory-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .gr-advisory-badge-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .gr-advisory-icon {
      color: #687A4E;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .gr-advisory-badge {
      font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #556B3A;
    }

    .gr-advisory-close-btn {
      background: transparent;
      border: none;
      color: #8C9283;
      font-size: 14px;
      line-height: 1;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .gr-advisory-close-btn:hover {
      color: #25291F;
      background: rgba(37, 41, 31, 0.08);
    }

    .gr-advisory-headline {
      font-size: 13.5px;
      font-weight: 700;
      color: #1E2319;
      line-height: 1.3;
    }

    .gr-advisory-message {
      font-size: 12.5px;
      color: #555A4C;
      line-height: 1.4;
    }

    .gr-advisory-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 4px;
      padding-top: 6px;
      border-top: 1px solid #E2E0D4;
    }

    .gr-advisory-subtext {
      font-size: 11px;
      color: #74776B;
      font-style: italic;
    }

    @keyframes grToastSlideIn {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.96);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `;

  // 4. Toast container
  const toast = document.createElement('div');
  toast.className = 'gr-advisory-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  // Header row
  const header = document.createElement('div');
  header.className = 'gr-advisory-header';

  const badgeRow = document.createElement('div');
  badgeRow.className = 'gr-advisory-badge-row';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'gr-advisory-icon';
  iconSpan.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  `;

  const badge = document.createElement('span');
  badge.className = 'gr-advisory-badge';
  badge.textContent = categoryBadge;

  badgeRow.appendChild(iconSpan);
  badgeRow.appendChild(badge);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gr-advisory-close-btn';
  closeBtn.setAttribute('aria-label', 'Dismiss notice');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    dismissAdvisoryNotice();
    if (props.onDismiss) {
      props.onDismiss();
    }
  });

  header.appendChild(badgeRow);
  header.appendChild(closeBtn);

  // Headline
  const headEl = document.createElement('div');
  headEl.className = 'gr-advisory-headline';
  headEl.textContent = headline;

  // Message
  const msgEl = document.createElement('p');
  msgEl.className = 'gr-advisory-message';
  msgEl.textContent = summaryText;

  // Footer
  const footer = document.createElement('div');
  footer.className = 'gr-advisory-footer';
  const subtext = document.createElement('span');
  subtext.className = 'gr-advisory-subtext';
  subtext.textContent = 'Non-blocking notice • Browsing continues normally';
  footer.appendChild(subtext);

  toast.appendChild(header);
  toast.appendChild(headEl);
  toast.appendChild(msgEl);
  toast.appendChild(footer);

  shadow.appendChild(style);
  shadow.appendChild(toast);

  document.body.appendChild(host);

  // 5. Auto-dismiss timer (default 6 seconds)
  const duration = props.durationMs ?? 6000;
  if (duration > 0) {
    activeDismissTimer = setTimeout(() => {
      dismissAdvisoryNotice();
      if (props.onDismiss) {
        props.onDismiss();
      }
    }, duration);
  }

  return () => dismissAdvisoryNotice();
}
