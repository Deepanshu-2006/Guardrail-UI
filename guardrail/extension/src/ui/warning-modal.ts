/**
 * Guardrail Warning UI Component
 *
 * Dynamically injected modal dialog presented to the user when Guardrail renders
 * a WARN response.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. SHADOW DOM ISOLATION: Rendered inside a Shadow Root attached to a transient host.
 *    Completely insulates Guardrail's styles from the host webpage's CSS and vice versa.
 * 2. ZERO DOM MUTATION: Does not alter or re-parent existing website elements.
 * 3. PROTOTYPE CONTROLS: "Continue" and "Cancel" dismiss the warning advisory.
 *    No actual action blocking or payload interception is enforced at this stage.
 * 4. MODULAR & REPLACEABLE: Self-contained module with a clean API surface for future UI upgrades.
 */

import { GuardrailAction } from '../types/actions.js';
import { RiskAssessment } from '../types/risk.js';
import { ResponseDecision } from '../types/response.js';

export interface WarningModalProps {
  /** The interaction that triggered the warning */
  action: GuardrailAction;

  /** Evaluated risk assessment */
  risk: RiskAssessment;

  /** Response decision rendered */
  decision: ResponseDecision;

  /** Callback when user clicks Continue */
  onContinue?: () => void;

  /** Callback when user clicks Cancel */
  onCancel?: () => void;
}

export const HOST_ELEMENT_ID = 'guardrail-warning-ui-host';

let activeEscapeHandler: ((e: KeyboardEvent) => void) | null = null;

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
  if (activeEscapeHandler && typeof window !== 'undefined') {
    window.removeEventListener('keydown', activeEscapeHandler);
    activeEscapeHandler = null;
  }
  const existingHost = typeof document !== 'undefined' ? document.getElementById(HOST_ELEMENT_ID) : null;
  if (existingHost) {
    existingHost.remove();
  }
}

/**
 * Injects and displays the Guardrail warning UI into the webpage.
 *
 * @param props Metadata for rendering the warning dialog.
 * @returns A dismiss function to close the warning programmatically.
 */
export function showWarningModal(props: WarningModalProps): () => void {
  // 1. Remove any previous instance to prevent stacking
  dismissWarningModal();

  // 2. Create the transient host container
  const host = document.createElement('div');
  host.id = HOST_ELEMENT_ID;
  host.style.position = 'relative';
  host.style.zIndex = '2147483647'; // Maximum possible z-index

  // 3. Attach an isolated Shadow Root
  const shadow = host.attachShadow({ mode: 'open' });

  // 4. Derive action label and reasons
  const targetLabel =
    props.action.element?.visibleText ||
    props.action.element?.id ||
    props.action.element?.tagName ||
    props.action.page.url;

  const reasonsList = props.decision.reasons.length > 0
    ? props.decision.reasons
    : props.risk.reasons.length > 0
    ? props.risk.reasons
    : ['Action involves elevated risk sensitivity under current Guardrail policy.'];

  // 5. Construct encapsulated styles and DOM structure
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .gr-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(11, 15, 25, 0.75);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 2147483647;
      animation: grFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .gr-card {
      background: #0f172a;
      border: 1px solid rgba(245, 158, 11, 0.4);
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 25px rgba(245, 158, 11, 0.15);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #f8fafc;
      overflow: hidden;
      animation: grSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .gr-header {
      padding: 16px 20px;
      background: rgba(245, 158, 11, 0.08);
      border-bottom: 1px solid rgba(245, 158, 11, 0.2);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .gr-header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .gr-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 0.02em;
      color: #fbbf24;
    }

    .gr-brand-icon {
      font-size: 16px;
    }

    .gr-pill {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      padding: 3px 8px;
      border-radius: 9999px;
      background: rgba(245, 158, 11, 0.2);
      border: 1px solid rgba(245, 158, 11, 0.4);
      color: #fcd34d;
      text-transform: uppercase;
    }

    .gr-btn-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 16px;
      line-height: 1;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      cursor: pointer;
      padding: 0;
      transition: all 0.15s ease;
    }

    .gr-btn-close:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }

    .gr-body {
      padding: 20px;
    }

    .gr-title {
      font-size: 18px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 8px;
      line-height: 1.3;
    }

    .gr-summary {
      font-size: 13px;
      color: #94a3b8;
      margin-bottom: 16px;
      line-height: 1.5;
    }

    .gr-action-preview {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 16px;
      font-size: 12px;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .gr-action-label {
      font-weight: 600;
      color: #38bdf8;
    }

    .gr-reasons-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #cbd5e1;
      margin-bottom: 6px;
    }

    .gr-reasons-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 20px;
    }

    .gr-reason-item {
      font-size: 13px;
      line-height: 1.4;
      color: #fcd34d;
      background: rgba(245, 158, 11, 0.05);
      border-left: 3px solid #f59e0b;
      padding: 6px 10px;
      border-radius: 0 4px 4px 0;
    }

    .gr-footer {
      padding: 14px 20px;
      background: rgba(15, 23, 42, 0.6);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }

    .gr-btn {
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 9px 18px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
      outline: none;
    }

    .gr-btn-cancel {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #cbd5e1;
    }

    .gr-btn-cancel:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }

    .gr-btn-continue {
      background: #f59e0b;
      border: none;
      color: #0f172a;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
    }

    .gr-btn-continue:hover {
      background: #fbbf24;
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(245, 158, 11, 0.4);
    }

    .gr-btn-continue:active {
      transform: translateY(0);
    }

    @keyframes grFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes grSlideUp {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `;

  // 6. Build the dialog DOM
  const backdrop = document.createElement('div');
  backdrop.className = 'gr-backdrop';

  const card = document.createElement('div');
  card.className = 'gr-card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'gr-title-id');

  // Header
  const header = document.createElement('div');
  header.className = 'gr-header';

  const brand = document.createElement('div');
  brand.className = 'gr-brand';
  brand.innerHTML = `
    <span class="gr-brand-icon">🛡️</span>
    <span>Guardrail Security</span>
  `;

  const headerRight = document.createElement('div');
  headerRight.className = 'gr-header-right';

  const pill = document.createElement('span');
  pill.className = 'gr-pill';
  pill.textContent = `${props.risk.riskLevel} RISK (${props.risk.score})`;

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

  const title = document.createElement('h2');
  title.id = 'gr-title-id';
  title.className = 'gr-title';
  title.textContent = 'Attention: Elevated Risk Interaction';

  const summary = document.createElement('p');
  summary.className = 'gr-summary';
  summary.textContent = 'Guardrail detected an interaction that may have operational or security significance. Please review the details below before proceeding.';

  const actionPreview = document.createElement('div');
  actionPreview.className = 'gr-action-preview';
  actionPreview.innerHTML = `
    <span class="gr-action-label">${props.action.type}:</span>
    <span>${escapeText(targetLabel)}</span>
  `;

  const reasonsTitle = document.createElement('div');
  reasonsTitle.className = 'gr-reasons-title';
  reasonsTitle.textContent = 'Evaluation Reasons';

  const reasonsListEl = document.createElement('ul');
  reasonsListEl.className = 'gr-reasons-list';
  for (const reason of reasonsList) {
    const item = document.createElement('li');
    item.className = 'gr-reason-item';
    item.textContent = reason;
    reasonsListEl.appendChild(item);
  }

  body.appendChild(title);
  body.appendChild(summary);
  body.appendChild(actionPreview);
  body.appendChild(reasonsTitle);
  body.appendChild(reasonsListEl);

  // Footer / Controls
  const footer = document.createElement('div');
  footer.className = 'gr-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'gr-btn gr-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    dismissWarningModal();
    if (props.onCancel) {
      props.onCancel();
    }
  });

  const continueBtn = document.createElement('button');
  continueBtn.type = 'button';
  continueBtn.className = 'gr-btn gr-btn-continue';
  continueBtn.textContent = 'Continue';
  continueBtn.addEventListener('click', () => {
    dismissWarningModal();
    if (props.onContinue) {
      props.onContinue();
    }
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(continueBtn);

  // Assemble
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

  // 7. Register Escape key dismissal
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
  }

  // 8. Mount to DOM
  document.body.appendChild(host);

  // Return programmatic dismiss callback
  return dismissWarningModal;
}

function escapeText(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
