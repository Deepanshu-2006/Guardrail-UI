/**
 * Shared Interactive Bottom Sheet Controller for Guardrail Mobile PWA
 *
 * Provides:
 * - Smooth GPU-accelerated open & close transitions
 * - Touch swipe-down-to-dismiss (1:1 finger tracking, velocity flick detection, rubber-band snap-back)
 * - Mouse drag-handle support for desktop/simulator testing
 * - Unified Escape key & backdrop dismissal without double-closing
 */

export interface InteractiveSheetOptions {
  overlay: HTMLElement;
  backdrop: HTMLElement;
  sheet: HTMLElement;
  onDismiss?: () => void;
  onStartClose?: () => void;
  canDismiss?: () => boolean;
}

export interface InteractiveSheetController {
  close: (immediate?: boolean) => void;
}

const CLOSE_DURATION_MS = 280;

export function setupInteractiveBottomSheet(
  options: InteractiveSheetOptions
): InteractiveSheetController {
  const { overlay, backdrop, sheet, onDismiss, onStartClose, canDismiss } = options;
  let closed = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let onWinMove: ((e: PointerEvent) => void) | null = null;
  let onWinUp: ((e: PointerEvent) => void) | null = null;

  const finalizeRemove = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKeyDown);
    }
    if (typeof window !== 'undefined' && onWinMove && onWinUp) {
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinUp);
    }
    overlay.remove();
  };

  const close = (immediate: boolean = false) => {
    if (closed) return;
    if (canDismiss && !canDismiss()) return;
    closed = true;

    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKeyDown);
    }

    onStartClose?.();

    if (immediate) {
      finalizeRemove();
      onDismiss?.();
      return;
    }

    sheet.classList.remove('is-dragging', 'is-snapping-back');
    backdrop.classList.remove('is-dragging');
    sheet.style.transition = '';
    backdrop.style.transition = '';

    // Clear inline drag transforms on next frame after adding .is-closing so CSS transitions
    // smoothly from the user's release Y offset down to 100% off-screen.
    overlay.classList.add('is-closing');
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        sheet.style.transform = 'translate3d(0, 100%, 0)';
        backdrop.style.opacity = '0';
      });
    } else {
      finalizeRemove();
      onDismiss?.();
      return;
    }

    const onEnd = (ev: Event) => {
      if (ev.target === sheet) {
        finalizeRemove();
        onDismiss?.();
      }
    };
    sheet.addEventListener('transitionend', onEnd, { once: true });
    closeTimer = setTimeout(() => {
      sheet.removeEventListener('transitionend', onEnd);
      finalizeRemove();
      onDismiss?.();
    }, CLOSE_DURATION_MS + 40);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close(false);
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown);
  }

  backdrop.addEventListener('click', () => close(false));

  // Touch swipe-down-to-dismiss + drag-handle support
  let armed = false;
  let dragging = false;
  let startedOnHandleOrHeader = false;
  let startY = 0;
  let startX = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocityY = 0;
  let currentDragY = 0;

  const beginDragCandidate = (clientX: number, clientY: number, target: EventTarget | null) => {
    if (closed) return;
    if (canDismiss && !canDismiss()) return;
    const el = target as Element | null;
    startedOnHandleOrHeader = Boolean(
      el?.closest?.('.gd-sheet-drag-handle, .gd-m-audit-top, .gd-sheet-header')
    );
    const isInteractiveInput = Boolean(
      el?.closest?.('input, textarea, select')
    );
    if (isInteractiveInput && !startedOnHandleOrHeader) {
      armed = false;
      return;
    }
    if (!startedOnHandleOrHeader && sheet.scrollTop > 1) {
      armed = false;
      return;
    }
    armed = true;
    dragging = false;
    startY = clientY;
    startX = clientX;
    lastY = clientY;
    lastTime = Date.now();
    velocityY = 0;
    currentDragY = 0;
  };

  const updateDragCandidate = (
    clientX: number,
    clientY: number,
    preventDefaultFn?: () => void
  ) => {
    if (!armed || closed) return;
    const dy = clientY - startY;
    const dx = Math.abs(clientX - startX);

    if (!dragging) {
      if (dy <= 5) {
        if (dy < -8 && !startedOnHandleOrHeader) armed = false;
        return;
      }
      if (dx > dy * 1.15) {
        armed = false;
        return;
      }
      if (!startedOnHandleOrHeader && sheet.scrollTop > 1) {
        armed = false;
        return;
      }
      dragging = true;
      sheet.classList.remove('is-snapping-back');
      sheet.classList.add('is-dragging');
      backdrop.classList.add('is-dragging');
    }

    preventDefaultFn?.();

    const now = Date.now();
    const dt = now - lastTime;
    if (dt >= 16) {
      velocityY = (clientY - lastY) / dt;
      lastY = clientY;
      lastTime = now;
    }

    currentDragY = dy >= 0 ? dy : dy * 0.18;
    sheet.style.transform = `translate3d(0, ${Math.round(currentDragY)}px, 0)`;

    const sheetH = Math.max(240, (sheet as any).offsetHeight || 380);
    const fadeProgress = Math.min(1, Math.max(0, currentDragY) / (sheetH * 0.72));
    backdrop.style.opacity = String(1 - fadeProgress * 0.75);
  };

  const endDragCandidate = () => {
    if (!armed) return;
    armed = false;
    if (!dragging) return;
    dragging = false;

    sheet.classList.remove('is-dragging');
    backdrop.classList.remove('is-dragging');

    const endDt = Math.max(16, Date.now() - lastTime);
    const endVel = (startY + currentDragY - lastY) / endDt;
    const effectiveVel = Math.max(velocityY, endVel);
    const sheetH = Math.max(240, (sheet as any).offsetHeight || 380);
    const shouldDismiss =
      currentDragY > Math.min(140, sheetH * 0.30) ||
      (effectiveVel > 0.55 && currentDragY > 56);

    if (shouldDismiss) {
      close(false);
    } else {
      sheet.classList.add('is-snapping-back');
      sheet.style.transform = '';
      backdrop.style.opacity = '';
      setTimeout(() => {
        sheet.classList.remove('is-snapping-back');
      }, 320);
    }
  };

  sheet.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (!e.touches || e.touches.length !== 1) {
        armed = false;
        return;
      }
      beginDragCandidate(e.touches[0].clientX, e.touches[0].clientY, e.target);
    },
    { passive: true }
  );

  sheet.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (!e.touches || e.touches.length !== 1) return;
      updateDragCandidate(e.touches[0].clientX, e.touches[0].clientY, () => {
        if (e.cancelable) e.preventDefault();
      });
    },
    { passive: false }
  );

  sheet.addEventListener('touchend', endDragCandidate, { passive: true });
  sheet.addEventListener('touchcancel', endDragCandidate, { passive: true });

  // Mouse pointer drag on the handle pill / top bar for desktop/simulator convenience
  let mouseDraggingId: number | null = null;
  const handleEl = sheet.querySelector('.gd-sheet-drag-handle');
  if (handleEl && typeof window !== 'undefined') {
    handleEl.addEventListener('pointerdown', (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType !== 'mouse' || pe.button !== 0) return;
      mouseDraggingId = pe.pointerId;
      beginDragCandidate(pe.clientX, pe.clientY, pe.target);
    });
    const winMove = (e: PointerEvent) => {
      if (mouseDraggingId === null || e.pointerId !== mouseDraggingId) return;
      updateDragCandidate(e.clientX, e.clientY, () => e.preventDefault());
    };
    const winUp = (e: PointerEvent) => {
      if (mouseDraggingId === null || e.pointerId !== mouseDraggingId) return;
      mouseDraggingId = null;
      endDragCandidate();
    };
    onWinMove = winMove;
    onWinUp = winUp;
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinUp);
  }

  return { close };
}
