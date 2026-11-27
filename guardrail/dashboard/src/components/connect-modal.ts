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
  readonly code?: string;
  readonly onConnect: (code: string) => Promise<{
    success: boolean;
    wardId?: string;
    wardName?: string;
    wardEmail?: string;
    error?: string;
  }>;
  readonly onSuccess?: (wardId: string) => void;
  readonly onClose?: () => void;
}

/**
 * Validates and normalizes an invitation / pairing code.
 */
function normalizePairingCode(raw: string): { valid: boolean; normalized?: string; error?: string } {
  const cleaned = raw.trim().toUpperCase();
  if (!cleaned) {
    return { valid: false, error: 'Please enter an invitation code.' };
  }
  const normalized = /^\d{8}$/.test(cleaned)
    ? `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`
    : cleaned;
  const codeRegex = /^(?:\d{4}-\d{4}|GR-INV-[A-Z0-9]{4}-[A-Z0-9]{4}|INV-[A-Z0-9_-]+)$/;
  if (!codeRegex.test(normalized)) {
    return {
      valid: false,
      error: 'Invalid pairing code format. Enter an 8-digit code (e.g. 4829-1735).',
    };
  }
  return { valid: true, normalized };
}

export function showConnectWardModal(options: ConnectWardModalOptions): () => void {
  const initialCode = typeof options.code === 'string' ? options.code.trim() : '';
  const hasInitialCode = initialCode.length > 0;

  if (typeof document === 'undefined' || !document.body) {
    if (hasInitialCode) {
      void options.onConnect(initialCode).then((result) => {
        if (result.success) {
          options.onSuccess?.(result.wardId || 'assigned');
        }
        options.onClose?.();
      });
    } else {
      options.onClose?.();
    }
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
    document.removeEventListener('keydown', handleKeyDown);
    card.classList.add('gd-fade-out');
    backdrop.classList.add('gd-fade-out');
    setTimeout(() => {
      backdrop.remove();
      options.onClose?.();
    }, 180);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
    }
  };
  document.addEventListener('keydown', handleKeyDown);

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

  card.appendChild(content);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  const renderCodeEntryStep = (prefillCode = '') => {
    content.textContent = '';

    const iconBadge = document.createElement('div');
    iconBadge.style.cssText =
      'width: 52px; height: 52px; border-radius: 14px; background: rgba(39, 49, 33, 0.08); color: #273121; display: flex; align-items: center; justify-content: center; margin: 0 auto 18px;';
    iconBadge.appendChild(createIcon('link-2'));
    content.appendChild(iconBadge);

    const title = document.createElement('h2');
    title.id = 'gd-connect-modal-title';
    title.className = 'gd-connect-title';
    title.textContent = 'Connect Another Ward';

    const subtitle = document.createElement('p');
    subtitle.className = 'gd-connect-subtitle';
    subtitle.textContent =
      'Enter the 8-digit pairing code shown in the ward’s Guardrail extension popup.';

    content.appendChild(title);
    content.appendChild(subtitle);

    const actionArea = document.createElement('div');
    actionArea.className = 'gd-connect-action-area';

    const form = document.createElement('form');
    form.style.width = '100%';
    form.noValidate = true;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'gd-connect-modal-code-input';
    input.className = 'gd-setup-input gd-mono';
    input.placeholder = '4829-1735';
    input.maxLength = 32;
    input.autocomplete = 'off';
    input.value = prefillCode;
    input.style.cssText =
      'width: 100%; box-sizing: border-box; text-align: center; letter-spacing: 0.12em; font-size: 16px;';

    const feedback = document.createElement('div');
    feedback.className = 'gd-setup-feedback';
    feedback.style.marginBottom = '14px';

    input.addEventListener('input', () => {
      if (feedback.textContent) {
        feedback.className = 'gd-setup-feedback';
        feedback.textContent = '';
      }
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'gd-btn-connect-modal-action';
    submitBtn.textContent = 'Connect Ward →';

    form.appendChild(input);
    form.appendChild(feedback);
    form.appendChild(submitBtn);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const validation = normalizePairingCode(input.value);
      if (!validation.valid || !validation.normalized) {
        feedback.className = 'gd-setup-feedback error';
        feedback.textContent = validation.error || 'Please enter a valid pairing code.';
        if (typeof input.focus === 'function') input.focus();
        return;
      }
      startConnection(validation.normalized);
    });

    actionArea.appendChild(form);
    content.appendChild(actionArea);

    setTimeout(() => {
      if (!isClosed && typeof input.focus === 'function') input.focus();
    }, 30);
  };

  const startConnection = (codeToConnect: string) => {
    content.textContent = '';

    // Animation Box (The exact same loader & tick animation as in Sign In popup)
    const animBox = document.createElement('div');
    animBox.className = 'gd-auth-anim-box';
    animBox.id = 'gd-connect-loader-anim';

    const halo = document.createElement('div');
    halo.className = 'gd-loader-halo';
    halo.id = 'gd-connect-loader-halo';
    animBox.appendChild(halo);

    const circleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    circleSvg.setAttribute('class', 'gd-auth-circle-svg');
    circleSvg.setAttribute('width', '72');
    circleSvg.setAttribute('height', '72');
    circleSvg.setAttribute('viewBox', '0 0 72 72');
    circleSvg.innerHTML = `
      <circle class="gd-loader-bg-track" cx="36" cy="36" r="30" fill="none" stroke="rgba(39, 49, 33, 0.12)" stroke-width="3.5" />
      <circle class="gd-loader-circle" cx="36" cy="36" r="30" fill="none" stroke="#273121" stroke-width="3.5" stroke-linecap="round" />
    `;
    animBox.appendChild(circleSvg);

    const tickSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    tickSvg.setAttribute('class', 'gd-auth-tick-svg');
    tickSvg.setAttribute('width', '72');
    tickSvg.setAttribute('height', '72');
    tickSvg.setAttribute('viewBox', '0 0 72 72');
    tickSvg.innerHTML = `
      <path class="gd-loader-tick-path" fill="none" stroke="#3E562A" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" d="M22 37 L32 47 L51 25" />
      <path class="gd-loader-error-path" fill="none" stroke="#962828" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round" d="M25 25 L47 47 M47 25 L25 47" />
    `;
    animBox.appendChild(tickSvg);

    content.appendChild(animBox);

    // Title & Subtitle
    const title = document.createElement('h2');
    title.id = 'gd-connect-modal-title';
    title.className = 'gd-connect-title';
    title.textContent = 'Connecting to Ward';

    const subtitle = document.createElement('p');
    subtitle.className = 'gd-connect-subtitle';
    subtitle.innerHTML = `Establishing authorized caretaker oversight for<br><span class="gd-connect-code-display">${codeToConnect}</span>`;

    content.appendChild(title);
    content.appendChild(subtitle);

    // Dynamic Status / Action Box
    const actionArea = document.createElement('div');
    actionArea.className = 'gd-connect-action-area';

    const connectingStatus = document.createElement('div');
    connectingStatus.className = 'gd-connect-status-indicator';
    connectingStatus.innerHTML = `
      <span class="gd-connect-status-text">Secure connection in progress...</span>
    `;
    actionArea.appendChild(connectingStatus);
    content.appendChild(actionArea);

    // Execute Connection Promise
    void (async () => {
      try {
        // Minimum duration for the connecting state so the transition feels smooth and deliberate (6.2s)
        const [result] = await Promise.all([
          options.onConnect(codeToConnect),
          new Promise((resolve) => setTimeout(resolve, 6200)),
        ]);

        if (isClosed) return;

        if (result.success) {
          const wardId = result.wardId || 'assigned';
          const wardName =
            result.wardName ||
            (wardId.startsWith('usr_') ? wardId.slice(4) : wardId);
          const wardEmail = result.wardEmail || '';

          // --- SUCCESS TRANSITION: Animate loader ring into tick with exact same theme motion ---
          animBox.classList.add('gd-success');

          title.textContent = 'Connected!';
          subtitle.textContent = `You are now authorized as a designated caretaker for ${wardName}.`;

          actionArea.innerHTML = '';

          // Summary details (Unboxed editorial typography, no banner container, no pill)
          const summaryBox = document.createElement('div');
          summaryBox.className = 'gd-connect-meta-list';
          summaryBox.innerHTML = `
            <div class="gd-connect-meta-row">
              <span class="gd-connect-meta-label">Protected Ward</span>
              <span class="gd-connect-meta-value gd-mono">${wardName}</span>
            </div>
            ${wardEmail ? `
            <div class="gd-connect-meta-row">
              <span class="gd-connect-meta-label">Ward Email</span>
              <span class="gd-connect-meta-value">${wardEmail}</span>
            </div>` : ''}
            <div class="gd-connect-meta-row">
              <span class="gd-connect-meta-label">Authority</span>
              <span class="gd-connect-meta-value">Enforced</span>
            </div>
            <div class="gd-connect-meta-row">
              <span class="gd-connect-meta-label">Review Portal</span>
              <span class="gd-connect-meta-value gd-active"><span class="gd-status-dot-active" aria-hidden="true"></span>Active</span>
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

          // Auto-close smoothly after 6s if user doesn't click
          autoCloseTimer = setTimeout(() => {
            if (!isClosed) {
              options.onSuccess?.(wardId);
              close();
            }
          }, 6000);
        } else {
          // --- ERROR TRANSITION ---
          animBox.classList.add('gd-error');

          title.textContent = 'Connection Failed';
          const rawErr = result.error || '';
          const isNotFound = rawErr.includes('404') || rawErr.toLowerCase().includes('not found');
          const friendlyMessage = isNotFound
            ? `Invitation code <strong style="font-family: monospace; color: #141C10;">${codeToConnect}</strong> was not found.`
            : (rawErr || 'Failed to connect.');
          const hintText = isNotFound
            ? 'Please open the Guardrail extension popup, ensure the Ward is signed in, and click <strong>Setup →</strong> to generate an active pairing code.'
            : 'Please check the code and ensure both the backend server and extension are active.';

          subtitle.innerHTML = `
            <div style="font-size: 14px; color: #273121; margin-bottom: 6px;">${friendlyMessage}</div>
            <div style="font-size: 12.5px; color: #6E7964; line-height: 1.45;">${hintText}</div>
          `;

          actionArea.innerHTML = '';

          const retryBtn = document.createElement('button');
          retryBtn.type = 'button';
          retryBtn.className = 'gd-btn-connect-modal-action gd-btn-retry';
          retryBtn.textContent = 'Try Another Code';
          retryBtn.addEventListener('click', () => {
            if (!hasInitialCode) {
              renderCodeEntryStep(codeToConnect);
            } else {
              close();
            }
          });
          actionArea.appendChild(retryBtn);
        }
      } catch (err: unknown) {
        if (isClosed) return;
        animBox.classList.add('gd-error');

        title.textContent = 'Connection Failed';
        subtitle.textContent =
          err instanceof Error ? err.message : 'An unexpected error occurred while connecting.';

        actionArea.innerHTML = '';

        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'gd-btn-connect-modal-action gd-btn-retry';
        retryBtn.textContent = 'Try Again';
        retryBtn.addEventListener('click', () => {
          if (!hasInitialCode) {
            renderCodeEntryStep(codeToConnect);
          } else {
            close();
          }
        });
        actionArea.appendChild(retryBtn);
      }
    })();
  };

  if (hasInitialCode) {
    startConnection(initialCode);
  } else {
    renderCodeEntryStep('');
  }

  return close;
}
