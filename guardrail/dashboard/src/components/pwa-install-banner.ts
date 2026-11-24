/**
 * Guardrail Trusted-Contact Dashboard - PWA Companion & Add-to-Home-Screen Manager
 *
 * Implements:
 * 1. Automatic detection of standalone / PWA display mode (iOS standalone & Chromium display-mode).
 * 2. Deferred prompt capture for Android, Chrome, Edge, and Desktop PWAs (beforeinstallprompt).
 * 3. Human-centered iOS Safari guidance card ("Tap Share ⎋ → Add to Home Screen ⊞").
 * 4. Respectful dismissal lifecycle with 7-day cooldown in localStorage.
 * 5. Reusable Settings PWA status card so caretakers can inspect installation anytime.
 */

import { setAnimatedHeading } from './icons.js';

export interface PwaInstallOptions {
  force?: boolean;
  onInstalled?: () => void;
  onDismissed?: () => void;
}

const DISMISS_STORAGE_KEY = 'guardrail_pwa_dismissed_at';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class PwaInstallManager {
  private static instance: PwaInstallManager | null = null;
  private deferredPrompt: any = null;
  private isListening = false;
  private installCallbacks: Set<() => void> = new Set();

  private constructor() {
    this.initListeners();
  }

  public static getInstance(): PwaInstallManager {
    if (!PwaInstallManager.instance) {
      PwaInstallManager.instance = new PwaInstallManager();
    }
    return PwaInstallManager.instance;
  }

  /**
   * Initializes browser event listeners for PWA installation.
   */
  public initListeners(): void {
    if (typeof window === 'undefined' || this.isListening) return;
    this.isListening = true;

    // Capture Chromium / Android beforeinstallprompt
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferredPrompt = e;
      // Trigger any registered banner re-renders
      this.installCallbacks.forEach((cb) => cb());
    });

    // Capture successful app installation
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      try {
        localStorage.removeItem(DISMISS_STORAGE_KEY);
      } catch {}
      this.installCallbacks.forEach((cb) => cb());
    });
  }

  /**
   * Registers a callback triggered when install availability changes.
   */
  public onAvailabilityChange(callback: () => void): () => void {
    this.installCallbacks.add(callback);
    return () => {
      this.installCallbacks.delete(callback);
    };
  }

  /**
   * Checks whether the dashboard is currently running as an installed standalone PWA.
   */
  public isStandalone(): boolean {
    if (typeof window === 'undefined') return false;

    // Display-mode standalone media query (Android, Chrome, Edge, Desktop)
    if (typeof window.matchMedia === 'function') {
      const match = window.matchMedia('(display-mode: standalone)');
      if (match && match.matches) return true;
    }

    // iOS Safari standalone property
    if (typeof navigator !== 'undefined' && (navigator as any).standalone === true) {
      return true;
    }

    // URL source indicator (?source=pwa)
    try {
      if (window.location && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        if (params.get('source') === 'pwa') return true;
      }
    } catch {}

    return false;
  }

  /**
   * Checks whether the current browser is iOS Safari where A2HS requires manual Share sheet steps.
   */
  public isIosSafari(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/.test(ua) && !(typeof window !== 'undefined' && (window as any).MSStream);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return isIOS && isSafari;
  }

  /**
   * Checks if the user dismissed the banner recently.
   */
  public isDismissed(): boolean {
    try {
      const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
      if (!raw) return false;
      const timestamp = parseInt(raw, 10);
      if (isNaN(timestamp)) return false;
      return Date.now() - timestamp < DISMISS_COOLDOWN_MS;
    } catch {
      return false;
    }
  }

  /**
   * Marks the prompt as dismissed for the cooldown duration.
   */
  public dismiss(): void {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {}
  }

  /**
   * Clears dismissal cooldown so prompt can be re-tested or manually triggered.
   */
  public resetDismissal(): void {
    try {
      localStorage.removeItem(DISMISS_STORAGE_KEY);
    } catch {}
  }

  /**
   * Checks whether an install prompt can be presented to the user.
   */
  public canPromptInstall(): boolean {
    if (this.isStandalone()) return false;
    return Boolean(this.deferredPrompt) || this.isIosSafari();
  }

  /**
   * Triggers the native installation flow for Chromium/Android browsers.
   */
  public async promptInstall(): Promise<'accepted' | 'dismissed' | 'unsupported'> {
    if (!this.deferredPrompt) {
      return 'unsupported';
    }

    try {
      const promptEvent = this.deferredPrompt;
      this.deferredPrompt = null;
      await promptEvent.prompt();
      const choiceResult = await promptEvent.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        return 'accepted';
      }
      return 'dismissed';
    } catch (err) {
      console.warn('[Guardrail PWA] promptInstall failed:', err);
      return 'unsupported';
    }
  }

  /**
   * Renders the Add to Home Screen guidance banner.
   */
  public renderBanner(options: PwaInstallOptions = {}): HTMLElement | null {
    if (typeof document === 'undefined') return null;

    // Do not show if already running in standalone mode (unless forced)
    if (this.isStandalone() && !options.force) {
      return null;
    }

    // Do not show if dismissed within cooldown period (unless forced)
    if (this.isDismissed() && !options.force) {
      return null;
    }

    const hasChromiumPrompt = Boolean(this.deferredPrompt);
    const isIos = this.isIosSafari();

    // If neither native prompt nor iOS Safari, return null unless forced for preview
    if (!hasChromiumPrompt && !isIos && !options.force) {
      return null;
    }

    const banner = document.createElement('aside');
    banner.className = 'gd-a2hs-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Install Guardrail Application');

    const inner = document.createElement('div');
    inner.className = 'gd-a2hs-inner';

    // Left: Icon + Text
    const leftCol = document.createElement('div');
    leftCol.className = 'gd-a2hs-left';

    const iconBadge = document.createElement('div');
    iconBadge.className = 'gd-a2hs-icon-badge';
    iconBadge.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FAF6ED" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <polyline points="9 11 12 14 22 4"/>
      </svg>
    `;

    const textGroup = document.createElement('div');
    textGroup.className = 'gd-a2hs-text-group';

    const title = document.createElement('div');
    title.className = 'gd-a2hs-title';
    title.textContent = isIos ? 'Install on iPhone / iPad' : 'Install Guardrail Companion';

    const description = document.createElement('div');
    description.className = 'gd-a2hs-desc';

    if (isIos) {
      description.innerHTML = `Tap the Share icon <span class="gd-a2hs-symbol">⎋</span> below, then tap <strong class="gd-a2hs-highlight">"Add to Home Screen ⊞"</strong> for instant alerts.`;
    } else {
      description.textContent = 'Add to your home screen for instant full-screen alert review and lock-screen alerts.';
    }

    textGroup.appendChild(title);
    textGroup.appendChild(description);
    leftCol.appendChild(iconBadge);
    leftCol.appendChild(textGroup);

    // Right: Action buttons
    const actions = document.createElement('div');
    actions.className = 'gd-a2hs-actions';

    if (!isIos) {
      const installBtn = document.createElement('button');
      installBtn.type = 'button';
      installBtn.className = 'gd-a2hs-btn-install';
      installBtn.textContent = 'Install App';
      installBtn.addEventListener('click', async () => {
        const result = await this.promptInstall();
        if (result === 'accepted') {
          banner.remove();
          options.onInstalled?.();
        } else if (result === 'dismissed') {
          this.dismiss();
          banner.remove();
          options.onDismissed?.();
        }
      });
      actions.appendChild(installBtn);
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'gd-a2hs-btn-dismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss install banner');
    dismissBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    dismissBtn.addEventListener('click', () => {
      this.dismiss();
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(-8px)';
      setTimeout(() => banner.remove(), 200);
      options.onDismissed?.();
    });

    actions.appendChild(dismissBtn);

    inner.appendChild(leftCol);
    inner.appendChild(actions);
    banner.appendChild(inner);

    return banner;
  }

  /**
   * Renders the PWA companion status card for the Settings / Protection section.
   */
  public renderSettingsCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'gd-card gd-settings-card gd-settings-pwa-card gd-scroll-reveal';
    card.id = 'gd-card-pwa';

    const isInstalled = this.isStandalone();
    const isIos = this.isIosSafari();

    card.innerHTML = `
      <div class="gd-settings-card-header">
        <h2 class="gd-section-title">Mobile PWA Companion App</h2>
        <span class="gd-settings-badge ${isInstalled ? 'gd-badge-ok' : 'gd-badge-muted'}">
          ${isInstalled ? 'Active Standalone' : 'Ready to Install'}
        </span>
      </div>
      <p class="gd-settings-sub">
        Caretakers evaluate and approve requests on their mobile phones when out-of-band alerts arrive.
      </p>
      <div class="gd-pwa-status-box ${isInstalled ? 'installed' : ''}">
        <div class="gd-pwa-status-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${isInstalled ? '#273121' : '#5F6656'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
          </svg>
        </div>
        <div class="gd-pwa-status-info">
          <div class="gd-pwa-status-headline">
            ${isInstalled ? 'Installed as Standalone App' : 'Web Application Mode'}
          </div>
          <div class="gd-pwa-status-subline">
            ${
              isInstalled
                ? 'Guardrail is running in native standalone mode with high-priority lock-screen alerts.'
                : isIos
                ? 'To install on iOS: Tap Share ⎋ in Safari, then select "Add to Home Screen ⊞".'
                : 'Install Guardrail to your home screen for full-screen review and lock-screen notification badges.'
            }
          </div>
        </div>
        ${
          !isInstalled && !isIos
            ? `<button type="button" class="gd-btn-install-pwa">Install App</button>`
            : ''
        }
      </div>
    `;

    const titleEl = card.querySelector<HTMLElement>('.gd-section-title');
    if (titleEl) {
      setAnimatedHeading(titleEl, 'Mobile PWA Companion App');
    }

    const installBtn = card.querySelector<HTMLButtonElement>('.gd-btn-install-pwa');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        installBtn.disabled = true;
        await this.promptInstall();
        installBtn.disabled = false;
      });
    }

    return card;
  }
}
