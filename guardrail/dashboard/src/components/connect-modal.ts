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

  // Emblem Wrapper with Handcrafted Handshake Art & Keyframe Orchestration
  const emblemWrap = document.createElement('div');
  emblemWrap.className = 'gd-connect-emblem-wrap connecting';

  const rippleRing = document.createElement('div');
  rippleRing.className = 'gd-handshake-ripple-ring';

  const successRipple = document.createElement('div');
  successRipple.className = 'gd-handshake-success-ripple';

  const emblemBg = document.createElement('div');
  emblemBg.className = 'gd-handshake-emblem-bg';

  const svgWrap = document.createElement('div');
  svgWrap.className = 'gd-handshake-svg-wrap';
  svgWrap.innerHTML = `
    <svg class="gd-handshake-svg" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g class="gd-handshake-group">
        <!-- LEFT HAND (Caretaker) -->
        <g class="gd-hand-left">
          <!-- Sleeve Cuff -->
          <path d="M 8 72 L 22 84 L 28 77 L 14 65 Z" fill="#4B5E38" stroke="#FAF7F0" stroke-width="2" stroke-linejoin="round"/>
          <line x1="16" y1="67" x2="25" y2="78" stroke="#FAF7F0" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/>

          <!-- Forearm & Palm -->
          <path d="M 18 66 L 36 51 C 39 48, 43 48, 46 51 L 49 54 L 43 60 C 40 63, 36 63, 33 60 L 23 70 Z"
                fill="#FAF7F0" stroke="#273121" stroke-width="2.5" stroke-linejoin="round"/>

          <!-- Left Thumb (Upward curve) -->
          <path d="M 38 49 C 39 42, 43 38, 48 39 C 52 40, 54 43, 52 47 L 48 51"
                fill="#FAF7F0" stroke="#273121" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>

          <!-- Index & Middle finger wrap -->
          <path d="M 49 54 L 56 61 C 58 63, 58 66, 55 68 C 53 70, 50 69, 48 67 L 42 61"
                fill="#FAF7F0" stroke="#273121" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- RIGHT HAND (Ward) -->
        <g class="gd-hand-right">
          <!-- Sleeve Cuff -->
          <path d="M 92 72 L 78 84 L 72 77 L 86 65 Z" fill="#36452B" stroke="#FAF7F0" stroke-width="2" stroke-linejoin="round"/>
          <line x1="84" y1="67" x2="75" y2="78" stroke="#FAF7F0" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/>

          <!-- Forearm & Palm -->
          <path d="M 82 66 L 64 51 C 61 48, 57 48, 54 51 L 51 54 L 57 60 C 60 63, 64 63, 67 60 L 77 70 Z"
                fill="#DDD5C2" stroke="#273121" stroke-width="2.5" stroke-linejoin="round"/>

          <!-- Right Thumb (Interlocking upward curve) -->
          <path d="M 62 49 C 61 42, 57 38, 52 39 C 48 40, 46 43, 48 47 L 52 51"
                fill="#DDD5C2" stroke="#273121" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>

          <!-- Clasping fingers wrapped around Left Hand -->
          <!-- Finger 1 -->
          <path d="M 51 54 L 44 61 C 42 63, 42 66, 45 68 C 47 70, 50 69, 52 67 L 58 61"
                fill="#DDD5C2" stroke="#273121" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Finger 2 (Lower wrap) -->
          <path d="M 54 60 L 48 66 C 46.5 67.5, 47 70, 49.5 71 C 52 72, 54 71, 56 69 L 61 64"
                fill="#DDD5C2" stroke="#273121" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Dynamic Sparkle Star at Clasp Peak -->
        <g class="gd-handshake-sparkle">
          <path d="M 50 32 L 51.8 38.5 L 58.5 39 L 53 43 L 55 49.5 L 50 45.5 L 45 49.5 L 47 43 L 41.5 39 L 48.2 38.5 Z"
                fill="#FAF7F0" stroke="#273121" stroke-width="1.2" stroke-linejoin="round"/>
          <circle cx="50" cy="41" r="2" fill="#4D6B27"/>
        </g>
      </g>
    </svg>
  `;

  // Error icon fallback
  const errorIconWrap = document.createElement('div');
  errorIconWrap.className = 'gd-connect-error-icon';
  errorIconWrap.appendChild(createIcon('alert-triangle', 'gd-connect-icon-error'));

  // Verified Badge Indicator (pops in on connection)
  const verifiedBadge = document.createElement('div');
  verifiedBadge.className = 'gd-handshake-verified-badge';
  verifiedBadge.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `;

  emblemWrap.appendChild(rippleRing);
  emblemWrap.appendChild(successRipple);
  emblemWrap.appendChild(emblemBg);
  emblemWrap.appendChild(svgWrap);
  emblemWrap.appendChild(errorIconWrap);
  emblemWrap.appendChild(verifiedBadge);
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

        // --- SUCCESS TRANSITION: Authentic Handshake Clasp ---
        emblemWrap.classList.remove('connecting');
        emblemWrap.classList.add('connected');

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

        // Auto-close smoothly after 2.8s if user doesn't click
        autoCloseTimer = setTimeout(() => {
          if (!isClosed) {
            options.onSuccess?.(wardId);
            close();
          }
        }, 2800);
      } else {
        // --- ERROR TRANSITION ---
        emblemWrap.classList.remove('connecting');
        emblemWrap.classList.add('error');

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
      emblemWrap.classList.remove('connecting');
      emblemWrap.classList.add('error');

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
