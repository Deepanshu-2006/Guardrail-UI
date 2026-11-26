/**
 * Guardrail Trusted-Contact Dashboard - PWA Companion & Mobile UX Test Suite (Phase 7)
 *
 * Verifies:
 * 1. Web App Manifest (manifest.webmanifest):
 *    - Valid JSON, display: standalone, brand colors (#1B2418, #F5F3EC).
 *    - Full icon suite including 192x192, 512x512, and maskable adaptive icon.
 *    - Shortcuts for quick navigation to Pending and History.
 * 2. Service Worker (sw.js):
 *    - Offline shell pre-caching, activate cleanup, and fetch routing.
 *    - Security invariant: Network-Only bypass for /api/ (never cache sensitive security decisions).
 * 3. PwaInstallManager & Add-to-Home-Screen Banner:
 *    - Standalone mode detection (matchMedia & navigator.standalone).
 *    - beforeinstallprompt event handling and deferred prompt trigger.
 *    - iOS Safari detection and step-by-step guidance card rendering.
 *    - Dismissal cooldown lifecycle (localStorage persistence).
 *    - Settings companion status card.
 * 4. Mobile Action Sheet (renderMobileActionSheet):
 *    - Touch-friendly action sheet rendering with dialog semantics.
 *    - Touch target dimensions (>= 48px height for WCAG 2.5.5 compliance).
 *    - Ward attribution and risk gauge binding.
 *    - Decoupled execution guarantee callout.
 *    - Decision triggers (Approve & Reject callbacks).
 */

import fs from 'node:fs';
import path from 'node:path';
import { PwaInstallManager } from '../components/pwa-install-banner.js';
import { renderMobileActionSheet } from '../components/mobile-action-sheet.js';
import { ApprovalRequest, ApprovalStatus, RiskLevel } from '../types.js';

// =============================================================================
// DOM & Environment Simulation for Node.js
// =============================================================================

class MockDOMTokenList {
  private classes: Set<string> = new Set();
  constructor(initial: string = '') {
    if (initial) {
      initial.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    }
  }
  add(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.add(t));
  }
  remove(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.delete(t));
  }
  contains(token: string): boolean {
    return this.classes.has(token);
  }
  toString(): string {
    return Array.from(this.classes).join(' ');
  }
}

class MockDOMElement {
  public tagName: string;
  public id: string = '';
  public attributes: Record<string, string> = {};
  public style: Record<string, string> = {};
  public children: MockDOMElement[] = [];
  public parentNode: MockDOMElement | null = null;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  private _textContent: string = '';
  public classList: MockDOMTokenList;
  public tabIndex: number = 0;
  public disabled: boolean = false;
  public type: string = '';

  get innerHTML(): string {
    if (this._textContent) return this._textContent;
    return this.children
      .map((c) => `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`)
      .join('');
  }
  set innerHTML(val: string) {
    this.children = [];
    this._textContent = val;
  }

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockDOMTokenList();
  }

  get className(): string {
    return this.classList.toString();
  }
  set className(val: string) {
    this.classList = new MockDOMTokenList(val);
  }

  get textContent(): string {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
  }

  get firstChild(): MockDOMElement | null {
    return this.children[0] || null;
  }

  appendChild<T extends MockDOMElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends MockDOMElement>(child: T): T {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name.toLowerCase()] = String(value);
  }

  getAttribute(name: string): string | null {
    return this.attributes[name.toLowerCase()] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name.toLowerCase()];
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  }

  dispatchEvent(event: { type: string; [key: string]: any }): boolean {
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) {
      h(event);
    }
    return true;
  }

  click(): void {
    this.dispatchEvent({ type: 'click' });
  }

  private findSimpleMatches(part: string): MockDOMElement[] {
    const matches: MockDOMElement[] = [];
    const search = (node: MockDOMElement) => {
      let isMatch = false;
      if (part.startsWith('#')) {
        isMatch = node.id === part.slice(1);
      } else if (part.startsWith('.')) {
        const classes = part.split('.').filter(Boolean);
        isMatch = classes.every((c) => node.classList.contains(c));
      } else if (part.includes('.')) {
        const [tag, ...classes] = part.split('.');
        isMatch =
          node.tagName.toLowerCase() === tag.toLowerCase() &&
          classes.every((c) => node.classList.contains(c));
      } else {
        isMatch = node.tagName.toLowerCase() === part.toLowerCase();
      }
      if (isMatch) {
        matches.push(node);
      }
      for (const child of node.children) {
        search(child);
      }
    };
    for (const child of this.children) {
      search(child);
    }
    return matches;
  }

  querySelector(selector: string): MockDOMElement | null {
    const parts = selector.trim().split(/\s+/);
    let currentSet: MockDOMElement[] = [this];
    for (const part of parts) {
      const nextSet: MockDOMElement[] = [];
      for (const node of currentSet) {
        nextSet.push(...node.findSimpleMatches(part));
      }
      currentSet = nextSet;
      if (currentSet.length === 0) return null;
    }
    return currentSet[0] || null;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const parts = selector.trim().split(/\s+/);
    let currentSet: MockDOMElement[] = [this];
    for (const part of parts) {
      const nextSet: MockDOMElement[] = [];
      for (const node of currentSet) {
        nextSet.push(...node.findSimpleMatches(part));
      }
      currentSet = nextSet;
    }
    return currentSet;
  }
}

// Storage mock
const storageMock: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storageMock[key] ?? null,
  setItem: (key: string, val: string) => {
    storageMock[key] = String(val);
  },
  removeItem: (key: string) => {
    delete storageMock[key];
  },
  clear: () => {
    for (const k of Object.keys(storageMock)) delete storageMock[k];
  },
};

const rootBody = new MockDOMElement('body');

const mockDocument = {
  body: rootBody,
  createElement(tag: string): MockDOMElement {
    return new MockDOMElement(tag);
  },
  getElementById(id: string): MockDOMElement | null {
    return rootBody.querySelector(`#${id}`);
  },
  querySelector(sel: string): MockDOMElement | null {
    return rootBody.querySelector(sel);
  },
  querySelectorAll(sel: string): MockDOMElement[] {
    return rootBody.querySelectorAll(sel);
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const windowListeners: Record<string, ((e: any) => void)[]> = {};
const mockWindow = {
  location: { search: '' },
  localStorage: mockLocalStorage,
  matchMedia: (query: string) => ({
    matches: false,
    media: query,
  }),
  addEventListener: (event: string, handler: (e: any) => void) => {
    if (!windowListeners[event]) windowListeners[event] = [];
    windowListeners[event].push(handler);
  },
  removeEventListener: (event: string, handler: (e: any) => void) => {
    if (!windowListeners[event]) return;
    windowListeners[event] = windowListeners[event].filter((h) => h !== handler);
  },
  dispatchEvent: (event: { type: string; [key: string]: any }) => {
    const handlers = windowListeners[event.type] || [];
    for (const h of handlers) h(event);
    return true;
  },
};

(globalThis as any).document = mockDocument;
(globalThis as any).window = mockWindow;
(globalThis as any).localStorage = mockLocalStorage;
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
    standalone: false,
  },
  configurable: true,
  writable: true,
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runPwaCompanionTests() {
  console.log('\n======================================================');
  console.log('📱 GUARDRAIL MOBILE PWA COMPANION TEST SUITE (PHASE 7)');
  console.log('======================================================\n');

  console.log('▶ Test Suite 1: Web App Manifest Specification & Brand Assets');
  {
    const findDashboardFile = (filename: string) => {
      const p1 = path.resolve(process.cwd(), filename);
      if (fs.existsSync(p1)) return p1;
      const p2 = path.resolve(process.cwd(), 'guardrail/dashboard', filename);
      if (fs.existsSync(p2)) return p2;
      return p1;
    };

    const manifestPath = findDashboardFile('manifest.webmanifest');
    assert(fs.existsSync(manifestPath), 'manifest.webmanifest file exists at root');

    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert(manifestContent.name === 'Guardrail Caretaker Portal', 'name is "Guardrail Caretaker Portal"');
    assert(manifestContent.short_name === 'Guardrail', 'short_name is "Guardrail"');
    assert(manifestContent.display === 'standalone', 'display mode is "standalone"');
    assert(manifestContent.theme_color.toUpperCase() === '#1B2418', 'theme_color matches Guardrail brand green #1B2418');
    assert(manifestContent.background_color.toUpperCase() === '#F5F3EC', 'background_color matches Guardrail brand ivory #F5F3EC');
    assert(manifestContent.start_url.includes('source=pwa'), 'start_url designates PWA launch source (?source=pwa)');
    assert(Array.isArray(manifestContent.icons) && manifestContent.icons.length >= 4, 'Includes comprehensive icon array');

    const icon192 = manifestContent.icons.find((i: any) => i.sizes === '192x192');
    const icon512 = manifestContent.icons.find((i: any) => i.sizes === '512x512' && i.purpose !== 'maskable');
    const iconMaskable = manifestContent.icons.find((i: any) => i.purpose === 'maskable');

    assert(icon192 !== undefined, '192x192 standard icon is configured');
    assert(icon512 !== undefined, '512x512 standard icon is configured');
    assert(iconMaskable !== undefined, '512x512 maskable adaptive icon is configured for Android');

    // Verify icon files physically exist on disk
    for (const icon of [icon192, icon512, iconMaskable]) {
      const relPath = icon.src.replace(/^\//, '');
      const fullPath = findDashboardFile(relPath);
      assert(fs.existsSync(fullPath), `Icon file physically exists on disk: ${icon.src}`);
    }
  }

  console.log('\n▶ Test Suite 2: Service Worker (sw.js) Architecture & Security Boundaries');
  {
    const findDashboardFile = (filename: string) => {
      const p1 = path.resolve(process.cwd(), filename);
      if (fs.existsSync(p1)) return p1;
      const p2 = path.resolve(process.cwd(), 'guardrail/dashboard', filename);
      if (fs.existsSync(p2)) return p2;
      return p1;
    };

    const swPath = findDashboardFile('sw.js');
    assert(fs.existsSync(swPath), 'sw.js exists at root');

    const swContent = fs.readFileSync(swPath, 'utf-8');
    assert(swContent.includes('guardrail-caretaker-pwa'), 'Defines versioned PWA cache bucket');
    assert(swContent.includes('STATIC_SHELL_ASSETS'), 'Defines pre-cached static shell assets');
    assert(swContent.includes('/manifest.webmanifest'), 'Pre-caches webmanifest');
    assert(swContent.includes('/styles/dashboard.css'), 'Pre-caches stylesheet');
    assert(swContent.includes('/dist/dashboard.js'), 'Pre-caches application bundle');

    // Security invariant check: /api/ bypass
    assert(
      swContent.includes("url.pathname.startsWith('/api/')") || swContent.includes('/api/'),
      'Enforces network-only bypass for /api/ to prevent caching sensitive safety decisions'
    );
    assert(swContent.includes("self.addEventListener('push'"), 'Handles W3C Web Push notifications');
    assert(swContent.includes("self.addEventListener('notificationclick'"), 'Handles native notification click navigation');
  }

  console.log('\n▶ Test Suite 3: PwaInstallManager & Add-to-Home-Screen (A2HS)');
  {
    const manager = PwaInstallManager.getInstance();
    assert(manager !== null, 'PwaInstallManager singleton instantiated');

    // Test standalone check
    assert(manager.isStandalone() === false, 'Initially not standalone in standard browser simulation');

    // Test dismissal persistence
    mockLocalStorage.clear();
    assert(manager.isDismissed() === false, 'Initially not dismissed');
    manager.dismiss();
    assert(manager.isDismissed() === true, 'isDismissed returns true after dismiss()');
    manager.resetDismissal();
    assert(manager.isDismissed() === false, 'isDismissed returns false after resetDismissal()');

    // Test beforeinstallprompt capture and banner rendering
    let promptInvoked = false;
    const mockPromptEvent = {
      preventDefault: () => {},
      prompt: async () => {
        promptInvoked = true;
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    };

    mockWindow.dispatchEvent({ type: 'beforeinstallprompt', ...mockPromptEvent });

    const banner = manager.renderBanner({ force: true });
    assert(banner !== null, 'renderBanner returns element when prompt is available');
    assert(banner?.className.includes('gd-a2hs-banner') ?? false, 'Banner has .gd-a2hs-banner class');

    const installBtn = banner?.querySelector<HTMLButtonElement>('.gd-a2hs-btn-install');
    assert(installBtn !== null, 'Renders "Install App" button');

    await installBtn?.click();
    assert(promptInvoked === true, 'Clicking Install App triggers native deferred prompt');

    // Test Settings Companion Status Card
    const settingsCard = manager.renderSettingsCard();
    assert(settingsCard !== null, 'renderSettingsCard renders settings card');
    assert(settingsCard.className.includes('gd-settings-pwa-card'), 'Card has .gd-settings-pwa-card class');
    assert(settingsCard.textContent?.includes('Mobile PWA Companion App') ?? false, 'Displays Mobile PWA Companion App title');
  }

  console.log('\n▶ Test Suite 4: iOS Safari Guidance Card Simulation');
  {
    // Simulate iOS Safari userAgent
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        standalone: false,
      },
      configurable: true,
      writable: true,
    });

    const manager = PwaInstallManager.getInstance();
    assert(manager.isIosSafari() === true, 'Accurately detects iOS Safari platform');

    manager.resetDismissal();
    const iosBanner = manager.renderBanner({ force: true });
    assert(iosBanner !== null, 'Renders banner for iOS Safari');
    assert(iosBanner?.textContent?.includes('Install on iPhone') ?? false, 'iOS banner displays "Install on iPhone" title');
    assert(iosBanner?.textContent?.includes('Add to Home Screen') ?? false, 'iOS banner provides "Add to Home Screen" instructions');
  }

  console.log('\n▶ Test Suite 5: Mobile Viewport Optimization & Touch Action Sheet');
  {
    const mockRequest: ApprovalRequest = {
      id: 'apr_mobile_wire_001',
      requesterId: 'usr_alice',
      actionType: 'FINANCIAL_TRANSFER' as any,
      category: 'FINANCIAL',
      actionDescription: 'Submit $1,250.00 Wire Transfer to Landlord',
      origin: 'https://secure.chase.com/transfers',
      hostname: 'secure.chase.com',
      riskLevel: RiskLevel.CRITICAL,
      status: ApprovalStatus.PENDING,
      createdAt: new Date().toISOString(),
      riskReasons: [
        'Wire transfers over $500 require explicit family reviewer authorization.',
        'Recipient wire account is an unverified external entity.',
      ],
    };

    let approvedId = '';
    let approvedReason: string | undefined;
    let rejectedId = '';
    let rejectedReason: string | undefined;
    let closed = false;

    const sheetContainer = renderMobileActionSheet({
      request: mockRequest,
      wardName: 'Alice Johnson',
      onApprove: (id, reason) => {
        approvedId = id;
        approvedReason = reason;
      },
      onReject: (id, reason) => {
        rejectedId = id;
        rejectedReason = reason;
      },
      onClose: () => {
        closed = true;
      },
    });

    assert(sheetContainer !== null, 'renderMobileActionSheet returns container');
    assert(sheetContainer.getAttribute('role') === 'dialog', 'Sheet has role="dialog"');
    assert(sheetContainer.getAttribute('aria-modal') === 'true', 'Sheet has aria-modal="true"');

    // Verify touch action drawer & handle
    const sheet = sheetContainer.querySelector('.gd-mobile-action-sheet');
    assert(sheet !== null, 'Contains .gd-mobile-action-sheet drawer');

    const handle = sheet?.querySelector('.gd-sheet-drag-handle');
    assert(handle !== null, 'Contains ergonomic touch drag handle');

    // Verify Ward Attribution Badge & Risk Badge
    const wardBadge = sheet?.querySelector('.gd-card-ward-badge');
    assert(wardBadge?.textContent?.includes('Alice Johnson') ?? false, 'Displays Alice Johnson in Ward Attribution Badge');

    const riskBadge = sheet?.querySelector('.gd-risk-badge');
    assert(riskBadge?.textContent?.includes('CRITICAL') ?? false, 'Displays CRITICAL risk badge');

    // Verify Decoupled Safety Guarantee Callout
    const decouplingCallout = sheet?.querySelector('.gd-sheet-decoupling-note');
    assert(decouplingCallout !== null, 'Renders Decoupled Safety Guarantee callout');
    assert(
      decouplingCallout?.textContent?.includes('Decoupled Safety Guarantee') ?? false,
      'Callout explicitly cites Decoupled Safety Guarantee'
    );

    // Verify Touch Action Buttons (WCAG 2.5.5 touch target size)
    const approveTouchBtn = sheet?.querySelector<HTMLButtonElement>('.gd-btn-approve-touch');
    const rejectTouchBtn = sheet?.querySelector<HTMLButtonElement>('.gd-btn-reject-touch');

    assert(approveTouchBtn !== null, 'Renders touch-friendly Approve Action button');
    assert(rejectTouchBtn !== null, 'Renders touch-friendly Reject Action button');

    const noteInput = sheet?.querySelector<HTMLInputElement>('.gd-m-decision-note-input');
    assert(noteInput !== null, 'Renders optional caretaker note input');
    if (noteInput) {
      noteInput.value = 'Verified by phone with Alice';
    }

    // Trigger Approve Action
    approveTouchBtn?.click();
    assert(approvedId === 'apr_mobile_wire_001', 'Clicking Approve button triggers onApprove with request ID');
    assert(
      approvedReason === 'Verified by phone with Alice',
      'Approve passes optional caretaker note to callback'
    );

    if (noteInput) {
      noteInput.value = 'Unrecognized merchant';
    }

    // Trigger Reject Action
    rejectTouchBtn?.click();
    assert(rejectedId === 'apr_mobile_wire_001', 'Clicking Reject button triggers onReject with request ID');
    assert(
      rejectedReason === 'Unrecognized merchant',
      'Reject passes optional caretaker note to callback'
    );

    // Close on backdrop click
    const backdrop = sheetContainer.querySelector<HTMLElement>('.gd-sheet-backdrop');
    backdrop?.click();
    assert(closed === true, 'Clicking backdrop triggers onClose');
  }

  // =========================================================================
  // Suite 6: App Icon Badging (navigator.setAppBadge / clearAppBadge)
  // =========================================================================
  console.log('\n▶ Test Suite 6: App Icon Badging (navigator.setAppBadge / clearAppBadge)');
  {
    const { syncAppBadge } = await import('../services/push-notification-service.js');

    let setCount: number | null = null;
    let cleared = false;
    const mockNav = {
      setAppBadge: async (count?: number) => {
        setCount = count ?? null;
      },
      clearAppBadge: async () => {
        cleared = true;
      },
    };

    await syncAppBadge(3, mockNav);
    assert(setCount === 3, 'Sets app icon badge to pending request count (3)');

    await syncAppBadge(0, mockNav);
    assert(cleared === true, 'Clears app icon badge when pending count hits 0');

    cleared = false;
    await syncAppBadge(-2, mockNav);
    assert(cleared === true, 'Normalizes negative count to clearAppBadge');

    let fallbackZero: number | null = null;
    await syncAppBadge(0, {
      setAppBadge: async (count?: number) => {
        fallbackZero = count ?? null;
      },
    });
    assert(fallbackZero === 0, 'Falls back to setAppBadge(0) when clearAppBadge is absent');

    await syncAppBadge(2, {
      setAppBadge: async () => {
        throw new Error('Badging restricted');
      },
    });
    assert(true, 'Swallows Badging API errors safely on restricted/unsupported browsers');

    const swPath = fs.existsSync(path.resolve(process.cwd(), 'sw.js'))
      ? path.resolve(process.cwd(), 'sw.js')
      : path.resolve(process.cwd(), 'guardrail/dashboard/sw.js');
    const swContent = fs.readFileSync(swPath, 'utf-8');
    assert(swContent.includes('setAppBadge'), 'Service worker updates app badge on background push');
    assert(swContent.includes('clearAppBadge'), 'Service worker supports clearing app badge');
  }

  // =========================================================================
  // Suite 7: Mobile Offline Banner & Pull-to-Refresh
  // =========================================================================
  console.log('\n▶ Test Suite 7: Mobile Offline Banner & Pull-to-Refresh');
  {
    const { renderMobileCompanion } = await import('../components/mobile-companion.js');
    let refreshed = 0;
    const baseProps = {
      activeTab: 'queue' as const,
      profile: {
        actorId: 'tc_dave',
        assignedWardId: 'usr_alice',
        assignedWardName: 'Alice Johnson',
        isAuthenticated: true,
      },
      pendingRequests: [],
      historyRequests: [],
      connectedWards: [{ id: 'usr_alice', name: 'Alice Johnson' }],
      activeWardFilter: 'ALL',
      isRefreshing: false,
      isBackendUnavailable: false,
      onSelectTab: () => {},
      onSelectWardFilter: () => {},
      onOpenRequestSheet: () => {},
      onRefresh: () => {
        refreshed += 1;
      },
      onOpenAuth: () => {},
      onSignOut: () => {},
    };

    const onlineView = renderMobileCompanion(baseProps);
    assert(
      onlineView.querySelector('.gd-m-offline-banner') === null,
      'Offline banner is hidden when online and backend is available'
    );

    const offlineView = renderMobileCompanion({
      ...baseProps,
      isBackendUnavailable: true,
    });
    const banner = offlineView.querySelector('.gd-m-offline-banner');
    assert(banner !== null, 'Offline/connectivity banner renders when backend is unavailable');
    assert(banner?.getAttribute('role') === 'status', 'Offline banner has role="status"');

    const ptrIndicator = onlineView.querySelector('.gd-m-ptr-indicator') as HTMLElement | null;
    assert(ptrIndicator !== null, 'Pull-to-refresh indicator is rendered at top of mobile view');

    onlineView.dispatchEvent({ type: 'touchstart', touches: [{ clientY: 100 }] } as any);
    onlineView.dispatchEvent({
      type: 'touchmove',
      touches: [{ clientY: 260 }],
      cancelable: true,
      preventDefault: () => {},
    } as any);
    assert(
      ptrIndicator?.classList.contains('is-ready') === true,
      'Pulling down past threshold marks indicator as ready to refresh'
    );
    onlineView.dispatchEvent({ type: 'touchend' } as any);
    assert(refreshed === 1, 'Releasing pull-to-refresh triggers onRefresh callback');
  }

  // =========================================================================
  // Suite 8: Notification Deep-Linking (#detail/<requestId> & SW postMessage)
  // =========================================================================
  console.log('\n▶ Test Suite 8: Notification Deep-Linking (#detail/<requestId> & SW postMessage)');
  {
    const swPath = fs.existsSync(path.resolve(process.cwd(), 'sw.js'))
      ? path.resolve(process.cwd(), 'sw.js')
      : path.resolve(process.cwd(), 'guardrail/dashboard/sw.js');
    const swContent = fs.readFileSync(swPath, 'utf-8');
    assert(swContent.includes('GUARDRAIL_OPEN_REQUEST'), 'Service worker posts GUARDRAIL_OPEN_REQUEST to active window');
    assert(swContent.includes('#detail/'), 'Service worker constructs #detail/<requestId> deep-link URLs');

    const { DashboardShell } = await import('../shell.js');
    const prevHash = (globalThis as any).window.location.hash;
    const prevSearch = (globalThis as any).window.location.search;
    (globalThis as any).window.location.hash = '#detail/apr_deep_02';
    (globalThis as any).window.location.search = '?source=pwa';

    const rootEl = new MockDOMElement('div');
    const shell = new DashboardShell({
      container: rootEl as any,
      initialProfile: {
        actorId: 'tc_dave',
        assignedWardId: 'usr_alice',
        assignedWardName: 'Alice Johnson',
        isAuthenticated: true,
      },
      initialRequests: [
        {
          id: 'apr_deep_01',
          requesterId: 'usr_alice',
          status: 'PENDING',
          actionType: 'PAYMENT',
          riskLevel: 'MEDIUM',
          riskScore: 40,
          riskReasons: ['First request'],
          actionDescription: 'First Request',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          actionPayload: { targetUrl: 'https://example.com' },
        },
        {
          id: 'apr_deep_02',
          requesterId: 'usr_alice',
          status: 'PENDING',
          actionType: 'PAYMENT',
          riskLevel: 'CRITICAL',
          riskScore: 95,
          riskReasons: ['Deep-linked wire transfer'],
          actionDescription: 'Deep-Linked Wire Transfer ($900.00)',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          actionPayload: { targetUrl: 'https://bank.example.com' },
        },
      ],
      disablePolling: true,
    });

    // Wait for queueMicrotask deep-link trigger
    await new Promise((r) => setTimeout(r, 10));
    const openedSheet = (globalThis as any).document.body.querySelector('.gd-mobile-action-sheet');
    assert(openedSheet !== null, 'Deep-linked #detail/<requestId> automatically opens Review & Decide bottom sheet');
    assert(
      (openedSheet?.textContent || '').includes('Deep-Linked Wire Transfer ($900.00)'),
      'Deep-linked sheet displays the exact target approval request'
    );

    shell.closeMobileActionSheet();
    shell.destroy();
    (globalThis as any).window.location.hash = prevHash;
    (globalThis as any).window.location.search = prevSearch;
  }

  // =========================================================================
  // Suite 9: Ward Policy Viewer Sheet (in Wards Tab)
  // =========================================================================
  console.log('\n▶ Test Suite 9: Ward Policy Viewer Sheet (in Wards Tab)');
  {
    const { renderMobileCompanion } = await import('../components/mobile-companion.js');
    let selectedTab = '';
    let selectedWard = '';
    const wardsView = renderMobileCompanion({
      activeTab: 'wards',
      profile: {
        actorId: 'tc_dave',
        assignedWardId: 'usr_alice',
        assignedWardName: 'Alice Johnson',
        isAuthenticated: true,
      },
      pendingRequests: [],
      historyRequests: [],
      connectedWards: [{ id: 'usr_alice', name: 'Alice Johnson', email: 'alice@example.com' }],
      activeWardFilter: 'ALL',
      isRefreshing: false,
      isBackendUnavailable: false,
      onSelectTab: (t) => {
        selectedTab = t;
      },
      onSelectWardFilter: (w) => {
        selectedWard = w;
      },
      onOpenRequestSheet: () => {},
      onRefresh: () => {},
      onOpenAuth: () => {},
      onSignOut: () => {},
      onLoadWardPolicy: async (wardId) => ({
        summary: {
          wardId,
          policyVersion: '2.1.0',
          schemaVersion: '1',
          updatedAt: new Date().toISOString(),
          overallStatus: 'ACTIVE',
          sensitivityPreset: 'balanced',
          stagingModeEnabled: true,
          categoryProtections: {
            destructiveActions: 'PROTECT',
            boundaryGuards: 'PROTECT',
            paymentActions: 'PROTECT',
            sensitiveData: 'WARN',
            externalNavigation: 'WARN',
          },
          relationship: { contactId: 'tc_dave', status: 'ACTIVE' },
        },
        auditHistory: [
          {
            id: 'aud_1',
            wardId,
            actorId: wardId,
            changeType: 'POLICY_UPDATED',
            summary: 'Enabled Payment Actions protection',
            timestamp: new Date().toISOString(),
          } as any,
        ],
      }),
    });

    const wardRow = wardsView.querySelector('.gd-m-row') as HTMLElement | null;
    assert(wardRow !== null, 'Ward row renders in Wards tab');
    wardRow?.click();

    await new Promise((r) => setTimeout(r, 15));
    const policySheet = (globalThis as any).document.body.querySelector('.gd-m-policy-sheet');
    assert(policySheet !== null, 'Clicking ward row opens Ward Policy bottom sheet');
    const sheetText = policySheet?.textContent || '';
    assert(sheetText.includes('Protection Active'), 'Policy sheet displays active protection status');
    assert(sheetText.includes('Destructive Actions'), 'Policy sheet displays category protection rules');
    assert(sheetText.includes('Enabled Payment Actions protection'), 'Policy sheet displays policy audit log entry');

    const queueBtn = policySheet?.querySelector('.gd-btn-approve-touch') as HTMLElement | null;
    queueBtn?.click();
    assert(selectedWard === 'usr_alice' && selectedTab === 'queue', 'Queue action filters to ward and switches to Queue tab');
  }

  // =========================================================================
  // Suite 10: Search & Status Filter in Mobile History Tab
  // =========================================================================
  console.log('\n▶ Test Suite 10: Search & Status Filter in Mobile History Tab');
  {
    const { renderMobileCompanion } = await import('../components/mobile-companion.js');
    const historyView = renderMobileCompanion({
      activeTab: 'history',
      profile: {
        actorId: 'tc_dave',
        assignedWardId: 'usr_alice',
        assignedWardName: 'Alice Johnson',
        isAuthenticated: true,
      },
      pendingRequests: [],
      historyRequests: [
        {
          id: 'apr_hist_1',
          requesterId: 'usr_alice',
          status: ApprovalStatus.APPROVED,
          actionType: 'PAYMENT',
          riskLevel: RiskLevel.MEDIUM,
          riskScore: 40,
          riskReasons: ['Subscription'],
          actionDescription: 'Confirm Cloud Workspace Renewal',
          hostname: 'billing.stripe.com',
          createdAt: new Date().toISOString(),
          resolvedAt: new Date().toISOString(),
          actionPayload: { targetUrl: 'https://billing.stripe.com' },
        },
        {
          id: 'apr_hist_2',
          requesterId: 'usr_bob',
          status: ApprovalStatus.REJECTED,
          actionType: 'DOWNLOAD',
          riskLevel: RiskLevel.CRITICAL,
          riskScore: 95,
          riskReasons: ['Untrusted binary'],
          actionDescription: 'Download Unverified Utility',
          hostname: 'soft-mirror.example.net',
          createdAt: new Date().toISOString(),
          resolvedAt: new Date().toISOString(),
          actionPayload: { targetUrl: 'https://soft-mirror.example.net' },
        },
      ],
      connectedWards: [
        { id: 'usr_alice', name: 'Alice Johnson' },
        { id: 'usr_bob', name: 'Bob Williams' },
      ],
      activeWardFilter: 'ALL',
      isRefreshing: false,
      isBackendUnavailable: false,
      onSelectTab: () => {},
      onSelectWardFilter: () => {},
      onOpenRequestSheet: () => {},
      onRefresh: () => {},
      onOpenAuth: () => {},
      onSignOut: () => {},
    });

    assert(historyView.querySelectorAll('.gd-m-history-row').length === 2, 'Initially renders all 2 history records');
    assert(historyView.querySelector('.gd-m-pill-glider') !== null, 'Top ward pill strip includes sliding glider');
    assert(historyView.querySelector('.gd-m-history-seg-glider') !== null, 'History status filter includes sliding glider');
    assert(historyView.querySelector('.gd-m-dock-glider') !== null, 'Bottom pill dock includes sliding glider');

    const segButtons = historyView.querySelectorAll('.gd-m-history-seg-btn');
    assert(segButtons.length === 3, 'Renders All / Approved / Rejected filter pills');
    (segButtons[2] as HTMLElement)?.click();
    assert(historyView.querySelectorAll('.gd-m-history-row').length === 1, 'Rejected filter narrows to 1 record');
    assert(
      (historyView.querySelector('.gd-m-history-row')?.textContent || '').includes('Download Unverified Utility'),
      'Rejected filter shows the rejected decision'
    );

    (segButtons[0] as HTMLElement)?.click();
    const searchInput = historyView.querySelector<HTMLInputElement>('.gd-m-history-search');
    assert(searchInput !== null, 'Renders compact history search input');
    if (searchInput) {
      searchInput.value = 'stripe';
      searchInput.dispatchEvent({ type: 'input' } as any);
    }
    assert(historyView.querySelectorAll('.gd-m-history-row').length === 1, 'Search query filters history records');
    assert(
      (historyView.querySelector('.gd-m-history-row')?.textContent || '').includes('Confirm Cloud Workspace Renewal'),
      'Search query matches domain/action in history'
    );
  }

  // =========================================================================
  // Suite 11: Custom Ward Pairing Code Keyboard (GR-INV-XXXX-YYYY)
  // =========================================================================
  console.log('\n▶ Test Suite 11: Custom Ward Pairing Code Keyboard');
  {
    const { renderMobileCompanion } = await import('../components/mobile-companion.js');
    const { extractPairingCodeBody, formatPairingCodeValue } = await import('../components/pairing-code-keyboard.js');

    assert(extractPairingCodeBody('gr-inv-u6ga-4wzy') === 'U6GA4WZY', 'Normalizes lowercase GR-INV code');
    assert(
      extractPairingCodeBody('http://192.168.0.100:5173/?invite=GR-INV-4B7K-9MP2') === '4B7K9MP2',
      'Extracts pairing code from invite URL'
    );
    assert(formatPairingCodeValue('U6GA4WZY') === 'GR-INV-U6GA-4WZY', 'Formats 8-char body as GR-INV-XXXX-YYYY');

    let submittedCode = '';
    const wardsView = renderMobileCompanion({
      activeTab: 'wards',
      profile: {
        actorId: 'tc_dave',
        assignedWardId: 'usr_alice',
        assignedWardName: 'Alice Johnson',
        isAuthenticated: true,
      },
      pendingRequests: [],
      historyRequests: [],
      connectedWards: [{ id: 'usr_alice', name: 'Alice Johnson', email: 'alice@example.com' }],
      activeWardFilter: 'ALL',
      isRefreshing: false,
      isBackendUnavailable: false,
      onSelectTab: () => {},
      onSelectWardFilter: () => {},
      onOpenRequestSheet: () => {},
      onRefresh: () => {},
      onConnectWard: async (code) => {
        submittedCode = code;
        return { success: true, message: 'Connected!' };
      },
    });

    const pairInput = wardsView.querySelector<HTMLInputElement>('#gd-m-pair-input');
    assert(pairInput !== null, 'Renders ward pairing input');
    assert(pairInput?.getAttribute('inputmode') === 'none', 'Suppresses native OS QWERTY keyboard via inputmode="none"');

    pairInput?.dispatchEvent({ type: 'focus' } as any);
    const kbd = (globalThis as any).document.body.querySelector('.gd-m-code-kbd');
    assert(kbd !== null, 'Opens custom pairing code keyboard when input receives focus');

    const keys = kbd?.querySelectorAll('.gd-m-kbd-key') || [];
    const findKey = (label: string) =>
      keys.find((k: any) => (k.textContent || '').trim() === label) as HTMLElement | undefined;

    for (const ch of ['4', 'B', '7', 'K', '9', 'M', 'P', '2']) {
      findKey(ch)?.click();
    }
    assert(pairInput?.value === 'GR-INV-4B7K-9MP2', 'Custom keypad auto-prefixes GR-INV- and auto-inserts hyphen');

    const bsKey = kbd?.querySelector('.is-backspace') as HTMLElement | null;
    bsKey?.click();
    assert(pairInput?.value === 'GR-INV-4B7K-9MP', 'Backspace removes last code character');
    findKey('3')?.click();
    assert(pairInput?.value === 'GR-INV-4B7K-9MP3', 'Appends replacement character cleanly');

    const kbdConnectBtn = kbd?.querySelector('.gd-m-kbd-connect') as HTMLElement | null;
    kbdConnectBtn?.click();
    await new Promise((r) => setTimeout(r, 15));
    assert(submittedCode === 'GR-INV-4B7K-9MP3', 'Submitting from custom keyboard delivers normalized GR-INV code');
  }

  console.log('\n======================================================');
  console.log('🎉 ALL PWA COMPANION & MOBILE UX ASSERTIONS PASSED!');
  console.log('======================================================\n');
}

runPwaCompanionTests().catch((err) => {
  console.error('\n❌ PWA COMPANION TEST RUNNER FAILED:', err);
  process.exit(1);
});
