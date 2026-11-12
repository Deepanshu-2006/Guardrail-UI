/**
 * Guardrail Pending Approval Floating Pill Component
 *
 * Rendered when the user minimizes or closes the Approval Waiting Modal
 * without cancelling the pending request.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. CLOSING != CANCELLING:
 *    - Closing the modal interface leaves the approval request actively PENDING on the backend.
 *    - The intercepted browser navigation remains safely HELD in browser memory.
 *    - This floating pill provides the persistent visual anchor allowing the user to return
 *      to the pending approval screen at any time.
 * 2. SHADOW DOM ISOLATION:
 *    - Self-contained in an isolated Shadow Root attached to `#guardrail-pending-pill-host`.
 *    - Zero stylesheet bleed with host webpage.
 * 3. WARM IVORY & DEEP OLIVE DESIGN LANGUAGE:
 *    - Preserves Guardrail's bespoke Warm Ivory (#F5F2E8), Deep Olive (#25291F), and amber alert accents.
 * 4. REAL-TIME SYNCHRONIZATION:
 *    - Dynamically updates to Approved (green check) or Rejected (terracotta) when real-time
 *      status updates arrive while minimized.
 */

export const PILL_HOST_ELEMENT_ID = 'guardrail-pending-pill-host';

export interface PendingApprovalPillOptions {
  domain: string;
  requestId?: string;
  status?: string;
  onOpen: () => void;
  onCancel?: () => void;
  onDismiss?: () => void;
}

let currentPillHost: HTMLElement | null = null;
let currentPillShadow: ShadowRoot | null = null;
let currentPillOptions: PendingApprovalPillOptions | null = null;

/**
 * Checks whether the pending approval floating pill is currently active in the DOM.
 */
export function isPendingApprovalPillActive(): boolean {
  return typeof document !== 'undefined' && Boolean(document.getElementById(PILL_HOST_ELEMENT_ID));
}

/**
 * Dismisses and removes the floating pill from the DOM.
 */
export function dismissPendingApprovalPill(): void {
  const existingHost = typeof document !== 'undefined' ? document.getElementById(PILL_HOST_ELEMENT_ID) : null;
  if (existingHost) {
    existingHost.remove();
  }
  currentPillHost = null;
  currentPillShadow = null;
  currentPillOptions = null;
}

/**
 * Injects and displays the floating status pill in the bottom corner of the webpage.
 */
export function showPendingApprovalPill(options: PendingApprovalPillOptions): () => void {
  dismissPendingApprovalPill();
  currentPillOptions = options;

  if (typeof document === 'undefined') return dismissPendingApprovalPill;

  const host = document.createElement('div');
  host.id = PILL_HOST_ELEMENT_ID;
  host.style.position = 'fixed';
  host.style.bottom = '22px';
  host.style.right = '22px';
  host.style.zIndex = '2147483646'; // Sits right below modal
  currentPillHost = host;

  const shadow = host.attachShadow({ mode: 'open' });
  currentPillShadow = shadow;

  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;600;700&family=IBM+Plex+Mono:wght@600&family=Space+Grotesk:wght@700&display=swap');

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .gr-pill-container {
      display: inline-flex;
      align-items: center;
      background: #F5F2E8;
      border: 1.5px solid #CCD2C0;
      border-radius: 9999px;
      padding: 8px 10px 8px 14px;
      box-shadow: 0 12px 32px -4px rgba(24, 28, 20, 0.28),
                  0 4px 12px rgba(24, 28, 20, 0.08);
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #25291F;
      gap: 10px;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      animation: grPillSlideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .gr-pill-container:hover {
      transform: translateY(-2px);
      border-color: #394532;
      box-shadow: 0 16px 36px -4px rgba(24, 28, 20, 0.35),
                  0 6px 14px rgba(24, 28, 20, 0.12);
    }

    @keyframes grPillSlideIn {
      from {
        opacity: 0;
        transform: translateY(20px) scale(0.96);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .gr-pill-badge {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #F0E8D6;
      border: 1px solid #E2D5BA;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #A87932;
      flex-shrink: 0;
      position: relative;
    }

    .gr-pill-badge.gr-badge-approved {
      background: #E5ECD9;
      border-color: #BFCEA8;
      color: #4B6331;
    }

    .gr-pill-badge.gr-badge-rejected {
      background: #FDE8E8;
      border-color: #F8B4B4;
      color: #8F2B2B;
    }

    .gr-pill-pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #A87932;
      animation: grDotPulse 1.8s infinite;
    }

    @keyframes grDotPulse {
      0% { box-shadow: 0 0 0 0 rgba(168, 121, 50, 0.6); }
      70% { box-shadow: 0 0 0 6px rgba(168, 121, 50, 0); }
      100% { box-shadow: 0 0 0 0 rgba(168, 121, 50, 0); }
    }

    .gr-pill-text-col {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .gr-pill-title-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .gr-pill-label {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #A87932;
    }

    .gr-pill-label.gr-label-approved {
      color: #556B3A;
    }

    .gr-pill-label.gr-label-rejected {
      color: #8F2B2B;
    }

    .gr-pill-domain {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 12.5px;
      font-weight: 600;
      color: #1E2319;
      max-width: 170px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .gr-pill-cta {
      font-size: 12px;
      font-weight: 600;
      color: #394532;
      display: flex;
      align-items: center;
      gap: 4px;
      background: #EFECE1;
      padding: 4px 10px;
      border-radius: 20px;
      margin-left: 4px;
      transition: background 0.15s ease;
    }

    .gr-pill-container:hover .gr-pill-cta {
      background: #E2DFD3;
      color: #1E2319;
    }

    .gr-pill-close {
      background: transparent;
      border: none;
      color: #8C9283;
      font-size: 14px;
      line-height: 1;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      margin-left: 2px;
      transition: all 0.15s ease;
    }

    .gr-pill-close:hover {
      background: rgba(37, 41, 31, 0.08);
      color: #25291F;
    }
  `;

  const pill = document.createElement('div');
  pill.className = 'gr-pill-container';
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');
  pill.setAttribute('title', `Guardrail: Approval request pending for ${options.domain}. Click to view details.`);

  // Left Icon Badge
  const badge = document.createElement('div');
  badge.className = 'gr-pill-badge';
  badge.innerHTML = `<span class="gr-pill-pulse-dot"></span>`;

  // Middle Text Content
  const textCol = document.createElement('div');
  textCol.className = 'gr-pill-text-col';

  const titleRow = document.createElement('div');
  titleRow.className = 'gr-pill-title-row';

  const label = document.createElement('span');
  label.className = 'gr-pill-label';
  label.textContent = 'Approval Pending';

  titleRow.appendChild(label);

  const domainEl = document.createElement('span');
  domainEl.className = 'gr-pill-domain';
  domainEl.textContent = options.domain;

  textCol.appendChild(titleRow);
  textCol.appendChild(domainEl);

  // Right CTA View Pill
  const cta = document.createElement('span');
  cta.className = 'gr-pill-cta';
  cta.innerHTML = `<span>View</span><span aria-hidden="true">↗</span>`;

  // Dismiss Cross Button (minimizes the pill from view without cancelling backend request)
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gr-pill-close';
  closeBtn.setAttribute('aria-label', 'Dismiss floating pill (action remains safely held)');
  closeBtn.setAttribute('title', 'Dismiss pill');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissPendingApprovalPill();
    if (options.onDismiss) {
      options.onDismiss();
    }
  });

  pill.appendChild(badge);
  pill.appendChild(textCol);
  pill.appendChild(cta);
  pill.appendChild(closeBtn);

  pill.addEventListener('click', () => {
    options.onOpen();
  });

  shadow.appendChild(style);
  shadow.appendChild(pill);
  document.body.appendChild(host);

  return dismissPendingApprovalPill;
}

/**
 * Updates the floating pill's status label and styling in real-time.
 */
export function updatePendingApprovalPill(status: string, message?: string): void {
  if (!currentPillShadow) return;

  const pill = currentPillShadow.querySelector('.gr-pill-container') as HTMLElement | null;
  const badge = currentPillShadow.querySelector('.gr-pill-badge') as HTMLElement | null;
  const label = currentPillShadow.querySelector('.gr-pill-label') as HTMLElement | null;
  const cta = currentPillShadow.querySelector('.gr-pill-cta') as HTMLElement | null;

  if (!pill || !badge || !label || !cta) return;

  const norm = status.toLowerCase();

  if (norm === 'approved') {
    badge.className = 'gr-pill-badge gr-badge-approved';
    badge.innerHTML = `<span style="font-size: 13px; font-weight: 700;">✓</span>`;
    label.className = 'gr-pill-label gr-label-approved';
    label.textContent = 'Request Approved';
    cta.innerHTML = `<span>Continue</span><span aria-hidden="true">→</span>`;
    cta.style.background = '#556B3A';
    cta.style.color = '#FFFFFF';
    pill.style.borderColor = '#556B3A';
  } else if (norm === 'rejected') {
    badge.className = 'gr-pill-badge gr-badge-rejected';
    badge.innerHTML = `<span style="font-size: 12px; font-weight: 700;">✕</span>`;
    label.className = 'gr-pill-label gr-label-rejected';
    label.textContent = 'Request Declined';
    cta.innerHTML = `<span>View</span><span aria-hidden="true">↗</span>`;
    cta.style.background = '#FDE8E8';
    cta.style.color = '#8F2B2B';
    pill.style.borderColor = '#F8B4B4';
  } else if (norm === 'under_review') {
    label.textContent = 'Under Review';
    label.style.color = '#76854A';
    if (message) {
      label.textContent = message;
    }
  } else if (norm === 'reconnecting') {
    label.textContent = 'Reconnecting...';
    label.style.color = '#A87932';
  } else if (norm === 'offline') {
    label.textContent = 'Sync Offline';
    label.style.color = '#8F2B2B';
  } else {
    label.textContent = message || 'Approval Pending';
  }
}

