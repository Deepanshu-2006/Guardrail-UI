/**
 * Guardrail Trusted Contact Portal - Ward Connection Modal
 *
 * Implements a delightful, reassuring pairing popup when connecting to a ward:
 * 1. "Connecting..." state with animated connection emblem & status pulse
 * 2. "Connected!" state with celebratory checkmark, ward details, and continue action
 * 3. Error state with descriptive recovery guidance
 *
 * Designed in strict adherence to Guardrail's Quiet Assurance theme:
 * - Warm Ivory modal surface (#FAF7F0)
 * - Deep Olive emblem (#273121)
 * - Space Grotesk display headings + Plus Jakarta Sans UI
 */

import { createIcon } from './icons.js';

export interface ConnectWardModalOptions {
  readonly code: string;
  readonly onConnect: (code: string) => Promise<{ success: boolean; wardId?: string; error?: string }>;
  readonly onSuccess?: (wardId: string) => void;
  readonly onClose?: () => void;
}

export function showConnectWardModal(options: ConnectWardModalOptions): () => void {
  if (typeof document === 'undefined' || !document.body) {
    void options.onConnect(options.code).then((result) => {
      if (result.success) {
        options.onSuccess?.(result.wardId || 'assigned');
      }
      options.onClose?.();
    });
    return () => {};
  }

  // Remove any existing connection modal
  const existing = document.getElementById('gd-connect-modal-root');
  if (existing) {
    existing.remove();
  }

  const backdrop = document.createElement('div');
  backdrop.id = 'gd-connect-modal-root';
  backdrop.className = 'gd-modal-backdrop gd-auth-modal-backdrop gd-connect-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'gd-connect-modal-title');

  const card = document.createElement('div');
  card.className = 'gd-auth-modal-card gd-connect-modal-card';

  let isClosed = false;
  let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    if (isClosed) return;
    isClosed = true;
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
    card.classList.add('gd-fade-out');
    backdrop.classList.add('gd-fade-out');
    setTimeout(() => {
      backdrop.remove();
      options.onClose?.();
    }, 180);
  };

  // Close button (X)
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-auth-modal-close-btn';
  closeBtn.setAttribute('aria-label', 'Close dialog');
  closeBtn.appendChild(createIcon('x'));
  closeBtn.addEventListener('click', close);
  card.appendChild(closeBtn);

  // Content Container
  const content = document.createElement('div');
  content.className = 'gd-connect-modal-content';

  // Emblem Wrapper
  const emblemWrap = document.createElement('div');
  emblemWrap.className = 'gd-connect-emblem-wrap';

  const pulseRing = document.createElement('div');
  pulseRing.className = 'gd-connect-pulse-ring';

  const emblem = document.createElement('div');
  emblem.className = 'gd-connect-emblem connecting';
  emblem.appendChild(createIcon('link-2', 'gd-connect-icon'));

  emblemWrap.appendChild(pulseRing);
  emblemWrap.appendChild(emblem);
  content.appendChild(emblemWrap);

  // Title & Subtitle
  const title = document.createElement('h2');
  title.id = 'gd-connect-modal-title';
  title.className = 'gd-connect-title';
  title.textContent = 'Connecting to Ward';

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-connect-subtitle';
  subtitle.innerHTML = `Verifying invitation code <span class="gd-connect-code-pill">${options.code}</span> and establishing authorized oversight session...`;

  content.appendChild(title);
  content.appendChild(subtitle);

  // Dynamic Status / Action Box
  const actionArea = document.createElement('div');
  actionArea.className = 'gd-connect-action-area';

  const connectingStatus = document.createElement('div');
  connectingStatus.className = 'gd-connect-status-indicator';
  connectingStatus.innerHTML = `
    <span class="gd-status-dot-pulse"></span>
    <span>Cryptographic Handshake in Progress</span>
  `;
  actionArea.appendChild(connectingStatus);
  content.appendChild(actionArea);

  card.appendChild(content);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  // Execute Connection Promise
  void (async () => {
    try {
      // Minimum duration for the connecting state so the transition feels smooth and deliberate
      const [result] = await Promise.all([
        options.onConnect(options.code),
        new Promise((resolve) => setTimeout(resolve, 850)),
      ]);

      if (isClosed) return;

      if (result.success) {
        const wardId = result.wardId || 'assigned';

        // --- SUCCESS TRANSITION ---
        pulseRing.style.display = 'none';
        emblem.className = 'gd-connect-emblem connected';
        emblem.innerHTML = '';
        emblem.appendChild(createIcon('shield-check', 'gd-connect-icon-success'));

        title.textContent = 'Connected!';
        subtitle.textContent = `You are now authorized as a designated caretaker for ward ${wardId}.`;

        actionArea.innerHTML = '';

        // Summary details
        const summaryBox = document.createElement('div');
        summaryBox.className = 'gd-connect-summary-box';
        summaryBox.innerHTML = `
          <div class="gd-connect-summary-row">
            <span class="gd-connect-summary-label">Designated Ward</span>
            <span class="gd-connect-summary-val">${wardId}</span>
          </div>
          <div class="gd-connect-summary-row">
            <span class="gd-connect-summary-label">Authority</span>
            <span class="gd-connect-summary-badge">Enforced</span>
          </div>
          <div class="gd-connect-summary-row">
            <span class="gd-connect-summary-label">Review Portal</span>
            <span class="gd-connect-summary-val" style="color: #4D6B27;">Active</span>
          </div>
        `;
        actionArea.appendChild(summaryBox);

        const continueBtn = document.createElement('button');
        continueBtn.type = 'button';
        continueBtn.className = 'gd-btn-connect-modal-action';
        continueBtn.textContent = 'Continue to Dashboard →';
        continueBtn.addEventListener('click', () => {
          options.onSuccess?.(wardId);
          close();
        });
        actionArea.appendChild(continueBtn);

        // Auto-close smoothly after 2.2s if user doesn't click
        autoCloseTimer = setTimeout(() => {
          if (!isClosed) {
            options.onSuccess?.(wardId);
            close();
          }
        }, 2200);
      } else {
        // --- ERROR TRANSITION ---
        pulseRing.style.display = 'none';
        emblem.className = 'gd-connect-emblem error';
        emblem.innerHTML = '';
        emblem.appendChild(createIcon('alert-triangle', 'gd-connect-icon-error'));

        title.textContent = 'Connection Failed';
        subtitle.textContent =
          result.error ||
          'Failed to connect. The invitation code may be invalid, expired, or already accepted.';

        actionArea.innerHTML = '';

        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'gd-btn-connect-modal-action gd-btn-retry';
        retryBtn.textContent = 'Try Another Code';
        retryBtn.addEventListener('click', close);
        actionArea.appendChild(retryBtn);
      }
    } catch (err: unknown) {
      if (isClosed) return;
      pulseRing.style.display = 'none';
      emblem.className = 'gd-connect-emblem error';
      emblem.innerHTML = '';
      emblem.appendChild(createIcon('alert-triangle', 'gd-connect-icon-error'));

      title.textContent = 'Connection Failed';
      subtitle.textContent =
        err instanceof Error ? err.message : 'An unexpected error occurred while connecting.';

      actionArea.innerHTML = '';

      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-connect-modal-action gd-btn-retry';
      retryBtn.textContent = 'Try Again';
      retryBtn.addEventListener('click', close);
      actionArea.appendChild(retryBtn);
    }
  })();

  return close;
}
