/**
 * Guardrail Pairing Code Custom Keyboard
 *
 * Dedicated mobile keypad tailored for Guardrail invitation codes (`GR-INV-XXXX-YYYY`).
 * Auto-prefixes `GR-INV-` and formats the hyphen separator while providing a dedicated
 * permanent top digit row, uppercase-only keys, live 8-slot preview, paste, and backspace.
 */

const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
const TOP_ALPHA_KEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'] as const;
const MID_ALPHA_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'] as const;
const BOT_ALPHA_KEYS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M'] as const;

export interface PairingCodeKeyboardOptions {
  input: HTMLInputElement;
  pairBox: HTMLElement;
  form: HTMLFormElement;
  msgEl?: HTMLElement | null;
}

export interface PairingCodeKeyboardController {
  open: () => void;
  close: () => void;
  reset: () => void;
  setStatus: (text: string, tone?: 'neutral' | 'error' | 'success') => void;
  destroy: () => void;
}

let activeKeyboardCleanup: (() => void) | null = null;

/**
 * Dismisses any currently mounted custom pairing-code keyboard.
 */
export function closeActivePairingKeyboard(): void {
  if (activeKeyboardCleanup) {
    const cleanup = activeKeyboardCleanup;
    activeKeyboardCleanup = null;
    cleanup();
  }
}

/**
 * Normalizes raw user input or pasted invite URLs/codes into up to 8 alphanumeric body chars.
 */
export function extractPairingCodeBody(raw: string): string {
  if (!raw) return '';
  let candidate = String(raw).trim();
  const inviteMatch = candidate.match(/[?&]invite=([^&#\s]+)/i);
  if (inviteMatch && inviteMatch[1]) {
    try {
      candidate = decodeURIComponent(inviteMatch[1]).trim();
    } catch {
      candidate = inviteMatch[1].trim();
    }
  }
  const upper = candidate.toUpperCase();
  const withoutPrefix = upper.replace(/^GR-?INV-?/i, '').replace(/^INV-/i, '');
  return withoutPrefix.replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

/**
 * Formats 0..8 normalized body characters into `GR-INV-XXXX-YYYY`.
 */
export function formatPairingCodeValue(body: string): string {
  const clean = body.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
  if (!clean) return '';
  if (clean.length <= 4) return `GR-INV-${clean}`;
  return `GR-INV-${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
}

function isDescendantOrSelf(node: unknown, root: unknown): boolean {
  let cur: any = node;
  while (cur) {
    if (cur === root) return true;
    cur = cur.parentNode || null;
  }
  return false;
}

/**
 * Binds the dedicated pairing-code keyboard to a Wards-tab pairing input/form.
 */
export function attachPairingCodeKeyboard(
  options: PairingCodeKeyboardOptions
): PairingCodeKeyboardController {
  closeActivePairingKeyboard();

  const { input, pairBox, form, msgEl } = options;
  let body = extractPairingCodeBody(input.value || '');
  let isOpen = false;
  let isDestroyed = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let repeatTimer: ReturnType<typeof setTimeout> | null = null;
  let repeatInterval: ReturnType<typeof setInterval> | null = null;

  const kbdEl = document.createElement('section');
  kbdEl.className = 'gd-m-code-kbd';
  kbdEl.setAttribute('role', 'region');
  kbdEl.setAttribute('aria-label', 'Ward pairing code keyboard');

  // Top bar: live segmented slots + Clear & Done controls
  const head = document.createElement('div');
  head.className = 'gd-m-kbd-head';

  const preview = document.createElement('div');
  preview.className = 'gd-m-kbd-preview';
  preview.setAttribute('aria-hidden', 'true');

  const prefixBadge = document.createElement('span');
  prefixBadge.className = 'gd-m-kbd-prefix';
  prefixBadge.textContent = 'GR-INV-';
  preview.appendChild(prefixBadge);

  const slotEls: HTMLElement[] = [];
  for (let i = 0; i < 8; i++) {
    if (i === 4) {
      const dash = document.createElement('span');
      dash.className = 'gd-m-kbd-dash';
      dash.textContent = '-';
      preview.appendChild(dash);
    }
    const slot = document.createElement('span');
    slot.className = 'gd-m-kbd-slot';
    slot.textContent = '';
    slotEls.push(slot);
    preview.appendChild(slot);
  }

  const headActions = document.createElement('div');
  headActions.className = 'gd-m-kbd-head-actions';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'gd-m-kbd-util-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.setAttribute('aria-label', 'Clear pairing code');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-m-kbd-close-btn';
  closeBtn.setAttribute('aria-label', 'Hide pairing keyboard');
  closeBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  headActions.appendChild(clearBtn);
  headActions.appendChild(closeBtn);
  head.appendChild(preview);
  head.appendChild(headActions);
  kbdEl.appendChild(head);

  // Keypad rows
  const rowsWrap = document.createElement('div');
  rowsWrap.className = 'gd-m-kbd-rows';

  const createKeyButton = (label: string, extraClass: string, ariaLabel?: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `gd-m-kbd-key ${extraClass}`.trim();
    btn.textContent = label;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    return btn;
  };

  // Row 1: Dedicated permanent numeric row (0-9)
  const row1 = document.createElement('div');
  row1.className = 'gd-m-kbd-row is-10';
  DIGIT_KEYS.forEach((digit) => {
    const btn = createKeyButton(digit, 'is-digit', `Digit ${digit}`);
    btn.addEventListener('click', () => appendChar(digit));
    row1.appendChild(btn);
  });
  rowsWrap.appendChild(row1);

  // Row 2: Top uppercase QWERTY row
  const row2 = document.createElement('div');
  row2.className = 'gd-m-kbd-row is-10';
  TOP_ALPHA_KEYS.forEach((ch) => {
    const btn = createKeyButton(ch, 'is-alpha', ch);
    btn.addEventListener('click', () => appendChar(ch));
    row2.appendChild(btn);
  });
  rowsWrap.appendChild(row2);

  // Row 3: Middle uppercase QWERTY row (9 centered keys)
  const row3 = document.createElement('div');
  row3.className = 'gd-m-kbd-row is-9';
  MID_ALPHA_KEYS.forEach((ch) => {
    const btn = createKeyButton(ch, 'is-alpha', ch);
    btn.addEventListener('click', () => appendChar(ch));
    row3.appendChild(btn);
  });
  rowsWrap.appendChild(row3);

  // Row 4: Paste + bottom alpha + Backspace
  const row4 = document.createElement('div');
  row4.className = 'gd-m-kbd-row is-bottom';

  const pasteBtn = createKeyButton('Paste', 'is-action is-paste', 'Paste code from clipboard');
  pasteBtn.addEventListener('click', () => {
    void handlePasteAction();
  });
  row4.appendChild(pasteBtn);

  BOT_ALPHA_KEYS.forEach((ch) => {
    const btn = createKeyButton(ch, 'is-alpha', ch);
    btn.addEventListener('click', () => appendChar(ch));
    row4.appendChild(btn);
  });

  const backspaceBtn = createKeyButton('', 'is-action is-backspace', 'Backspace');
  backspaceBtn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>';
  backspaceBtn.addEventListener('click', () => backspaceChar());
  const stopBackspaceRepeat = () => {
    if (repeatTimer !== null) {
      clearTimeout(repeatTimer);
      repeatTimer = null;
    }
    if (repeatInterval !== null) {
      clearInterval(repeatInterval);
      repeatInterval = null;
    }
  };
  backspaceBtn.addEventListener('pointerdown', () => {
    stopBackspaceRepeat();
    repeatTimer = setTimeout(() => {
      repeatInterval = setInterval(() => {
        backspaceChar();
      }, 65);
    }, 360);
  });
  backspaceBtn.addEventListener('pointerup', stopBackspaceRepeat);
  backspaceBtn.addEventListener('pointercancel', stopBackspaceRepeat);
  backspaceBtn.addEventListener('pointerleave', stopBackspaceRepeat);
  row4.appendChild(backspaceBtn);
  rowsWrap.appendChild(row4);

  // Bottom bar inside keyboard: helper/status hint + Connect CTA
  const footer = document.createElement('div');
  footer.className = 'gd-m-kbd-footer';

  const statusEl = document.createElement('div');
  statusEl.className = 'gd-m-kbd-status';
  statusEl.textContent = 'GR-INV-XXXX-YYYY · 0/8';

  const connectBtn = document.createElement('button');
  connectBtn.type = 'button';
  connectBtn.className = 'gd-m-kbd-connect';
  connectBtn.textContent = 'Connect';
  connectBtn.addEventListener('mousedown', (e) => e.preventDefault());
  connectBtn.addEventListener('click', () => {
    if (typeof (form as any).requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  footer.appendChild(statusEl);
  footer.appendChild(connectBtn);
  rowsWrap.appendChild(footer);
  kbdEl.appendChild(rowsWrap);

  const setStatus = (text: string, tone: 'neutral' | 'error' | 'success' = 'neutral') => {
    statusEl.textContent = text;
    statusEl.classList.remove('is-error', 'is-success');
    if (tone === 'error') statusEl.classList.add('is-error');
    if (tone === 'success') statusEl.classList.add('is-success');
  };

  const setFlagClass = (el: Element, cls: string, on: boolean) => {
    if (on) el.classList.add(cls);
    else el.classList.remove(cls);
  };

  const syncUI = () => {
    const formatted = formatPairingCodeValue(body);
    input.value = formatted;

    for (let i = 0; i < 8; i++) {
      const slot = slotEls[i];
      const ch = body[i] || '';
      slot.textContent = ch;
      setFlagClass(slot, 'is-filled', Boolean(ch));
      setFlagClass(slot, 'is-active', isOpen && i === Math.min(body.length, 7) && body.length < 8);
    }

    const ready = body.length === 8;
    clearBtn.disabled = body.length === 0;
    setFlagClass(connectBtn, 'is-ready', ready);
    setStatus(ready ? 'Code ready · Tap Connect' : `GR-INV- prefix added · ${body.length}/8`, ready ? 'success' : 'neutral');
  };

  const setBody = (next: string) => {
    body = next.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
    if (msgEl && msgEl.textContent && body.length > 0) {
      msgEl.textContent = '';
    }
    syncUI();
  };

  const appendChar = (ch: string) => {
    if (body.length >= 8) return;
    setBody(body + ch);
  };

  const backspaceChar = () => {
    if (body.length === 0) return;
    setBody(body.slice(0, -1));
  };

  const handlePasteAction = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        const clip = await navigator.clipboard.readText();
        const extracted = extractPairingCodeBody(clip || '');
        if (extracted) {
          setBody(extracted);
          return;
        }
        setStatus('No pairing code found in clipboard', 'error');
        return;
      }
    } catch {
      // Clipboard read can be blocked on non-HTTPS LAN origins
    }
    if (typeof input.focus === 'function') input.focus();
    setStatus('Long-press the code field above to paste', 'neutral');
  };

  const open = () => {
    if (isDestroyed) return;
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (!kbdEl.parentNode) {
      document.body.appendChild(kbdEl);
    }
    isOpen = true;
    document.body.classList.add('gd-kbd-open');
    syncUI();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (!isDestroyed && isOpen) {
          kbdEl.classList.add('is-open');
        }
      });
    } else {
      kbdEl.classList.add('is-open');
    }
    if (typeof pairBox.scrollIntoView === 'function') {
      try {
        pairBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch {
        // Ignore on older browsers
      }
    }
  };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    stopBackspaceRepeat();
    kbdEl.classList.remove('is-open');
    document.body.classList.remove('gd-kbd-open');
    syncUI();
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!isOpen && kbdEl.parentNode) {
        kbdEl.remove();
      }
      closeTimer = null;
    }, 340);
  };

  const onInputFocus = () => open();
  const onInputClick = () => open();

  const onRawInput = () => {
    const rawVal = input.value || '';
    if (/^INV-[A-Z0-9_-]*$/i.test(rawVal.trim())) {
      return;
    }
    body = extractPairingCodeBody(rawVal);
    syncUI();
  };

  const onInputPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text') || '';
    const extracted = extractPairingCodeBody(text);
    if (extracted) {
      e.preventDefault();
      setBody(extracted);
    }
  };

  const onClearClick = () => {
    setBody('');
    if (msgEl) msgEl.textContent = '';
  };

  const onCloseClick = () => {
    close();
    if (typeof input.blur === 'function') input.blur();
  };

  const onDocPointerDown = (e: Event) => {
    if (!isOpen) return;
    const target = e.target;
    if (!target) return;
    if (isDescendantOrSelf(target, kbdEl) || isDescendantOrSelf(target, pairBox)) {
      return;
    }
    close();
  };

  input.addEventListener('focus', onInputFocus);
  input.addEventListener('click', onInputClick);
  input.addEventListener('input', onRawInput);
  input.addEventListener('paste', onInputPaste as any);
  clearBtn.addEventListener('click', onClearClick);
  closeBtn.addEventListener('click', onCloseClick);
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('pointerdown', onDocPointerDown);
  }

  const destroy = () => {
    if (isDestroyed) return;
    isDestroyed = true;
    stopBackspaceRepeat();
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    document.body.classList.remove('gd-kbd-open');
    input.removeEventListener('focus', onInputFocus);
    input.removeEventListener('click', onInputClick);
    input.removeEventListener('input', onRawInput);
    input.removeEventListener('paste', onInputPaste as any);
    clearBtn.removeEventListener('click', onClearClick);
    closeBtn.removeEventListener('click', onCloseClick);
    if (typeof document.removeEventListener === 'function') {
      document.removeEventListener('pointerdown', onDocPointerDown);
    }
    if (kbdEl.parentNode) kbdEl.remove();
    if (activeKeyboardCleanup === destroy) {
      activeKeyboardCleanup = null;
    }
  };

  activeKeyboardCleanup = destroy;

  return {
    open,
    close,
    reset: () => setBody(''),
    setStatus,
    destroy,
  };
}
