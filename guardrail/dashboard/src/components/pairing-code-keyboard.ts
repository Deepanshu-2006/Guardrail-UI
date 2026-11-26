/**
 * Guardrail Pairing Code Custom Keyboard
 *
 * Clean 3×4 numeric dialpad for 8-digit Guardrail codes (`XXXX-YYYY`),
 * with a 1-tap `ABC` switch (or auto-switch on paste) for legacy `GR-INV-XXXX-YYYY` codes.
 * Automatically scrolls the pairing field cleanly above the keyboard when opened.
 */

const NUMERIC_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
const TOP_ALPHA_KEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'] as const;
const MID_ALPHA_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'] as const;
const BOT_ALPHA_KEYS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M'] as const;

export type PairingKeyboardMode = 'numeric' | 'legacy';

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
  setMode: (mode: PairingKeyboardMode) => void;
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
 * Normalizes raw user input or pasted invite URLs/codes into body chars and detected mode.
 */
export function parsePairingInput(raw: string): { mode: PairingKeyboardMode; body: string } {
  if (!raw) return { mode: 'numeric', body: '' };
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
  const isLegacy = /^GR-?INV-?/i.test(upper) || /[A-Z]/.test(upper.replace(/^GR-?/i, ''));
  if (isLegacy) {
    const withoutPrefix = upper.replace(/^GR-?INV-?/i, '').replace(/^INV-/i, '');
    return {
      mode: 'legacy',
      body: withoutPrefix.replace(/[^A-Z0-9]/g, '').slice(0, 8),
    };
  }
  return {
    mode: 'numeric',
    body: upper.replace(/\D/g, '').slice(0, 8),
  };
}

/**
 * Backward-compatible extractor returning up to 8 normalized alphanumeric body chars.
 */
export function extractPairingCodeBody(raw: string): string {
  return parsePairingInput(raw).body;
}

/**
 * Formats 0..8 body characters into `XXXX-YYYY` (numeric) or `GR-INV-XXXX-YYYY` (legacy).
 */
export function formatPairingCodeValue(body: string, mode: PairingKeyboardMode = 'numeric'): string {
  if (mode === 'legacy') {
    const clean = body.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
    if (!clean) return '';
    if (clean.length <= 4) return `GR-INV-${clean}`;
    return `GR-INV-${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
  }
  const digits = body.replace(/\D/g, '').slice(0, 8);
  if (!digits) return '';
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
}

function isDescendantOrSelf(node: unknown, root: unknown): boolean {
  let cur: any = node;
  while (cur) {
    if (cur === root) return true;
    cur = cur.parentNode || null;
  }
  return false;
}

function setFlagClass(el: Element, cls: string, on: boolean): void {
  if (on) el.classList.add(cls);
  else el.classList.remove(cls);
}

/**
 * Binds the dedicated pairing-code keyboard to a Wards-tab pairing input/form.
 */
export function attachPairingCodeKeyboard(
  options: PairingCodeKeyboardOptions
): PairingCodeKeyboardController {
  closeActivePairingKeyboard();

  const { input, pairBox, form, msgEl } = options;
  const initialParsed = parsePairingInput(input.value || '');
  let mode: PairingKeyboardMode = initialParsed.mode;
  let body = initialParsed.body;
  let isOpen = false;
  let isDestroyed = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let repeatTimer: ReturnType<typeof setTimeout> | null = null;
  let repeatInterval: ReturnType<typeof setInterval> | null = null;

  const kbdEl = document.createElement('section');
  kbdEl.className = 'gd-m-code-kbd';
  kbdEl.setAttribute('role', 'region');
  kbdEl.setAttribute('aria-label', 'Ward pairing code keyboard');

  // Slim top accessory strip (status on left; subtle ABC / Clear / Connect / Hide on right)
  const head = document.createElement('div');
  head.className = 'gd-m-kbd-head';

  const statusEl = document.createElement('div');
  statusEl.className = 'gd-m-kbd-status';
  statusEl.textContent = '8-digit code · 0/8';

  const headActions = document.createElement('div');
  headActions.className = 'gd-m-kbd-head-actions';

  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'gd-m-kbd-mode-btn';
  modeBtn.textContent = 'ABC';
  modeBtn.setAttribute('aria-label', 'Switch to legacy alphanumeric keyboard');

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'gd-m-kbd-util-btn is-hidden';
  clearBtn.textContent = 'Clear';
  clearBtn.setAttribute('aria-label', 'Clear pairing code');

  const connectBtn = document.createElement('button');
  connectBtn.type = 'button';
  connectBtn.className = 'gd-m-kbd-connect is-hidden';
  connectBtn.textContent = 'Connect';
  connectBtn.addEventListener('mousedown', (e) => e.preventDefault());
  connectBtn.addEventListener('click', () => {
    if (typeof (form as any).requestSubmit === 'function') {
      form.requestSubmit();
    } else if (typeof Event === 'function') {
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    } else {
      form.dispatchEvent({ type: 'submit', preventDefault: () => {} } as any);
    }
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-m-kbd-close-btn';
  closeBtn.setAttribute('aria-label', 'Hide pairing keyboard');
  closeBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  headActions.appendChild(clearBtn);
  headActions.appendChild(connectBtn);
  headActions.appendChild(modeBtn);
  headActions.appendChild(closeBtn);
  head.appendChild(statusEl);
  head.appendChild(headActions);
  kbdEl.appendChild(head);

  const rowsWrap = document.createElement('div');
  rowsWrap.className = 'gd-m-kbd-rows';

  const numericContainer = document.createElement('div');
  numericContainer.className = 'gd-m-kbd-mode-pane is-numeric';

  const legacyContainer = document.createElement('div');
  legacyContainer.className = 'gd-m-kbd-mode-pane is-legacy';

  const createKeyButton = (label: string, extraClass: string, ariaLabel?: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `gd-m-kbd-key ${extraClass}`.trim();
    btn.textContent = label;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    return btn;
  };

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

  const attachBackspaceBehavior = (btn: HTMLButtonElement) => {
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>';
    btn.addEventListener('click', () => backspaceChar());
    btn.addEventListener('pointerdown', () => {
      stopBackspaceRepeat();
      repeatTimer = setTimeout(() => {
        repeatInterval = setInterval(() => backspaceChar(), 65);
      }, 360);
    });
    btn.addEventListener('pointerup', stopBackspaceRepeat);
    btn.addEventListener('pointercancel', stopBackspaceRepeat);
    btn.addEventListener('pointerleave', stopBackspaceRepeat);
  };

  // --- Numeric 3×4 dialpad ---
  NUMERIC_ROWS.forEach((digits) => {
    const r = document.createElement('div');
    r.className = 'gd-m-kbd-row is-dialpad';
    digits.forEach((d) => {
      const btn = createKeyButton(d, 'is-dialpad-key', `Digit ${d}`);
      btn.addEventListener('click', () => appendChar(d));
      r.appendChild(btn);
    });
    numericContainer.appendChild(r);
  });

  const dialRow4 = document.createElement('div');
  dialRow4.className = 'gd-m-kbd-row is-dialpad';

  const dialPasteBtn = createKeyButton('Paste', 'is-dialpad-action is-paste', 'Paste pairing code');
  dialPasteBtn.addEventListener('click', () => void handlePasteAction());
  dialRow4.appendChild(dialPasteBtn);

  const zeroBtn = createKeyButton('0', 'is-dialpad-key', 'Digit 0');
  zeroBtn.addEventListener('click', () => appendChar('0'));
  dialRow4.appendChild(zeroBtn);

  const dialBackspaceBtn = createKeyButton('', 'is-dialpad-action is-backspace', 'Backspace');
  attachBackspaceBehavior(dialBackspaceBtn);
  dialRow4.appendChild(dialBackspaceBtn);
  numericContainer.appendChild(dialRow4);

  // --- Legacy 36-key alphanumeric layout ---
  const lRow1 = document.createElement('div');
  lRow1.className = 'gd-m-kbd-row is-10';
  DIGIT_KEYS.forEach((d) => {
    const btn = createKeyButton(d, 'is-digit', `Digit ${d}`);
    btn.addEventListener('click', () => appendChar(d));
    lRow1.appendChild(btn);
  });
  legacyContainer.appendChild(lRow1);

  const lRow2 = document.createElement('div');
  lRow2.className = 'gd-m-kbd-row is-10';
  TOP_ALPHA_KEYS.forEach((ch) => {
    const btn = createKeyButton(ch, 'is-alpha', ch);
    btn.addEventListener('click', () => appendChar(ch));
    lRow2.appendChild(btn);
  });
  legacyContainer.appendChild(lRow2);

  const lRow3 = document.createElement('div');
  lRow3.className = 'gd-m-kbd-row is-9';
  MID_ALPHA_KEYS.forEach((ch) => {
    const btn = createKeyButton(ch, 'is-alpha', ch);
    btn.addEventListener('click', () => appendChar(ch));
    lRow3.appendChild(btn);
  });
  legacyContainer.appendChild(lRow3);

  const lRow4 = document.createElement('div');
  lRow4.className = 'gd-m-kbd-row is-bottom';
  const legacyPasteBtn = createKeyButton('Paste', 'is-action is-paste', 'Paste pairing code');
  legacyPasteBtn.addEventListener('click', () => void handlePasteAction());
  lRow4.appendChild(legacyPasteBtn);

  BOT_ALPHA_KEYS.forEach((ch) => {
    const btn = createKeyButton(ch, 'is-alpha', ch);
    btn.addEventListener('click', () => appendChar(ch));
    lRow4.appendChild(btn);
  });

  const legacyBackspaceBtn = createKeyButton('', 'is-action is-backspace', 'Backspace');
  attachBackspaceBehavior(legacyBackspaceBtn);
  lRow4.appendChild(legacyBackspaceBtn);
  legacyContainer.appendChild(lRow4);

  rowsWrap.appendChild(numericContainer);
  rowsWrap.appendChild(legacyContainer);
  kbdEl.appendChild(rowsWrap);

  const setStatus = (text: string, tone: 'neutral' | 'error' | 'success' = 'neutral') => {
    statusEl.textContent = text;
    statusEl.classList.remove('is-error', 'is-success');
    if (tone === 'error') statusEl.classList.add('is-error');
    if (tone === 'success') statusEl.classList.add('is-success');
  };

  const syncUI = () => {
    const formatted = formatPairingCodeValue(body, mode);
    input.value = formatted;

    setFlagClass(kbdEl, 'is-legacy-mode', mode === 'legacy');
    modeBtn.textContent = mode === 'legacy' ? '123' : 'ABC';
    modeBtn.setAttribute(
      'aria-label',
      mode === 'legacy' ? 'Switch to 8-digit numeric keypad' : 'Switch to legacy alphanumeric keyboard'
    );

    const ready = body.length === 8;
    clearBtn.disabled = body.length === 0;
    setFlagClass(clearBtn, 'is-hidden', body.length === 0);
    setFlagClass(connectBtn, 'is-hidden', !ready);
    setFlagClass(connectBtn, 'is-ready', ready);

    setStatus(
      ready
        ? 'Ready to connect'
        : mode === 'legacy'
          ? `Legacy code · ${body.length}/8`
          : `8-digit code · ${body.length}/8`,
      ready ? 'success' : 'neutral'
    );
  };

  const setMode = (nextMode: PairingKeyboardMode) => {
    mode = nextMode;
    if (nextMode === 'numeric') {
      body = body.replace(/\D/g, '').slice(0, 8);
    }
    syncUI();
  };

  const setBody = (next: string) => {
    body =
      mode === 'numeric'
        ? next.replace(/\D/g, '').slice(0, 8)
        : next.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
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

  const applyParsedPaste = (text: string): boolean => {
    const parsed = parsePairingInput(text);
    if (!parsed.body) return false;
    mode = parsed.mode;
    body = parsed.body;
    if (msgEl && msgEl.textContent) msgEl.textContent = '';
    syncUI();
    return true;
  };

  const handlePasteAction = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        const clip = await navigator.clipboard.readText();
        if (applyParsedPaste(clip || '')) {
          return;
        }
        setStatus('No pairing code found in clipboard', 'error');
        return;
      }
    } catch {
      // Clipboard read can be blocked on non-HTTPS LAN origins
    }
    if (typeof input.focus === 'function') input.focus();
    setStatus('Long-press code field above to paste', 'neutral');
  };

  const scrollPairBoxAboveKeyboard = () => {
    if (typeof window === 'undefined' || typeof pairBox.getBoundingClientRect !== 'function') return;
    try {
      const kbdHeight = kbdEl.offsetHeight || (mode === 'legacy' ? 240 : 260);
      const viewportH = window.innerHeight || document.documentElement?.clientHeight || 0;
      if (!viewportH) return;
      const rect = pairBox.getBoundingClientRect();
      const targetBottom = viewportH - kbdHeight - 20;
      if (rect.bottom <= targetBottom) return;
      const delta = Math.ceil(rect.bottom - targetBottom);

      // Walk ancestors plus document scroll roots to find the active vertical scroll container
      const candidates: HTMLElement[] = [];
      let cur: HTMLElement | null = pairBox.parentElement;
      while (cur) {
        candidates.push(cur);
        cur = cur.parentElement;
      }
      if (document.scrollingElement && !candidates.includes(document.scrollingElement as HTMLElement)) {
        candidates.push(document.scrollingElement as HTMLElement);
      }
      if (document.body && !candidates.includes(document.body)) candidates.push(document.body);
      if (document.documentElement && !candidates.includes(document.documentElement)) {
        candidates.push(document.documentElement);
      }

      let scrolled = false;
      for (const el of candidates) {
        if (el.scrollHeight > el.clientHeight + 2) {
          const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(el) : null;
          const oy = style?.overflowY || '';
          const canScrollContainer =
            el === document.scrollingElement ||
            el === document.body ||
            el === document.documentElement ||
            oy === 'auto' ||
            oy === 'scroll';
          if (!canScrollContainer) continue;

          if (typeof el.scrollBy === 'function') {
            el.scrollBy({ top: delta, behavior: 'smooth' });
          } else {
            el.scrollTop = el.scrollTop + delta;
          }
          scrolled = true;
          break;
        }
      }

      if (!scrolled && typeof window.scrollBy === 'function') {
        window.scrollBy({ top: delta, behavior: 'smooth' });
      }
    } catch {
      // Ignore in mocked test DOM
    }
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
          scrollPairBoxAboveKeyboard();
        }
      });
    } else {
      kbdEl.classList.add('is-open');
    }
  };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    stopBackspaceRepeat();
    if (scrollTimer !== null) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
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
    const parsed = parsePairingInput(rawVal);
    mode = parsed.mode;
    body = parsed.body;
    syncUI();
  };

  const onInputPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text') || '';
    if (applyParsedPaste(text)) {
      e.preventDefault();
    }
  };

  const onModeClick = () => {
    setMode(mode === 'numeric' ? 'legacy' : 'numeric');
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
  modeBtn.addEventListener('click', onModeClick);
  clearBtn.addEventListener('click', onClearClick);
  closeBtn.addEventListener('click', onCloseClick);
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('pointerdown', onDocPointerDown);
  }

  const destroy = () => {
    if (isDestroyed) return;
    isDestroyed = true;
    stopBackspaceRepeat();
    if (scrollTimer !== null) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    document.body.classList.remove('gd-kbd-open');
    input.removeEventListener('focus', onInputFocus);
    input.removeEventListener('click', onInputClick);
    input.removeEventListener('input', onRawInput);
    input.removeEventListener('paste', onInputPaste as any);
    modeBtn.removeEventListener('click', onModeClick);
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
    setMode,
    setStatus,
    destroy,
  };
}
