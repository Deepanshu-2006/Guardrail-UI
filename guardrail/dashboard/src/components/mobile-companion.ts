/**
 * Guardrail Mobile PWA Companion — Purpose-Built Phone Interface
 *
 * Dedicated mobile-first UI for <= 768px viewports and standalone PWA launches.
 * Inspired by a floating-pill bottom dock + detached circular action button,
 * crafted in Guardrail's Quiet Assurance (#EDE6D6 / #1F291A) editorial palette.
 */

import { ApprovalRequest, ApprovalStatus, ConnectedWard, ContactProfile, RiskLevel } from '../types.js';
import { createIcon } from './icons.js';
import { formatTimestamp, isRequestExpired } from './detail.js';
import { getRealTimeScenery, SceneryPhase } from './pixel-scenery.js';

function formatWardDisplayName(name?: string | null, requesterId?: string | null): string {
  if (name && name.trim()) return name.trim();
  if (!requesterId) return 'Protected Ward';
  const clean = requesterId.replace(/^(usr_|ward_)/i, '').replace(/[_-]+/g, ' ').trim();
  return clean ? clean.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Protected Ward';
}

function resolveSafeHostname(req: ApprovalRequest): string {
  if (req.hostname && req.hostname.trim()) return req.hostname.trim();
  if (req.origin) {
    try {
      return new URL(req.origin).hostname;
    } catch {
      return req.origin;
    }
  }
  return 'Protected Site';
}

export type MobileTab = 'queue' | 'history' | 'wards' | 'settings';

export interface MobileCompanionProps {
  activeTab: MobileTab;
  profile: ContactProfile | null;
  pendingRequests: readonly ApprovalRequest[];
  historyRequests: readonly ApprovalRequest[];
  connectedWards: readonly ConnectedWard[];
  activeWardFilter: string;
  isRefreshing: boolean;
  isBackendUnavailable: boolean;
  onSelectTab: (tab: MobileTab) => void;
  onSelectWardFilter: (wardId: string) => void;
  onOpenRequestSheet: (requestId: string) => void;
  onRefresh: () => void;
  onConnectWard?: (code: string) => Promise<{ success: boolean; message?: string }>;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
  pushStatus?: {
    readonly isSupported: boolean;
    readonly permission: NotificationPermission | 'unsupported';
    readonly isSubscribed: boolean;
    readonly vapidConfigured?: boolean;
  };
  isSubscribingPush?: boolean;
  pushActionMessage?: string | null;
  onSubscribePush?: () => Promise<void> | void;
  onUnsubscribePush?: () => Promise<void> | void;
  onSendTestPush?: () => Promise<void> | void;
}

function getInitials(name?: string | null): string {
  if (!name) return 'GR';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'GR';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getRiskPriority(level?: RiskLevel): number {
  switch (level) {
    case RiskLevel.CRITICAL: return 4;
    case RiskLevel.HIGH: return 3;
    case RiskLevel.MEDIUM: return 2;
    default: return 1;
  }
}

function createAmbientBackdrop(phase: SceneryPhase): HTMLElement {
  const layer = document.createElement('div');
  layer.className = `gd-m-ambient phase-${phase}`;
  layer.setAttribute('aria-hidden', 'true');

  // Diagonal animated sunbeam / moonlight wash
  const beam = document.createElement('div');
  beam.className = 'gd-m-beam';
  layer.appendChild(beam);

  // 3 stepped pixel clouds drifting across the canvas
  const cloudSvg = `<svg viewBox="0 0 24 8" shape-rendering="crispEdges"><rect x="6" y="0" width="10" height="2" fill="currentColor"/><rect x="3" y="2" width="17" height="2" fill="currentColor"/><rect x="0" y="4" width="24" height="2" fill="currentColor"/><rect x="2" y="6" width="19" height="2" fill="currentColor" opacity="0.65"/></svg>`;
  [
    { cls: 'c1', top: '16%', w: 88 },
    { cls: 'c2', top: '49%', w: 68 },
    { cls: 'c3', top: '76%', w: 96 },
  ].forEach((c) => {
    const cloud = document.createElement('div');
    cloud.className = `gd-m-bg-cloud ${c.cls}`;
    cloud.style.top = c.top;
    cloud.style.width = `${c.w}px`;
    cloud.innerHTML = cloudSvg;
    layer.appendChild(cloud);
  });

  // Visible crisp pixel motes / fireflies / stars
  const motes = [
    { x: 8, y: 15, s: 6, dur: 10, del: -1, dx: 16, dy: -32 },
    { x: 86, y: 21, s: 7, dur: 12, del: -4, dx: -14, dy: -28 },
    { x: 14, y: 46, s: 6, dur: 13, del: -6, dx: 18, dy: -26 },
    { x: 90, y: 52, s: 8, dur: 11, del: -2, dx: -16, dy: -30 },
    { x: 10, y: 74, s: 7, dur: 14, del: -5, dx: 14, dy: -34 },
    { x: 46, y: 80, s: 6, dur: 11, del: -8, dx: -10, dy: -26 },
    { x: 84, y: 81, s: 8, dur: 13, del: -3, dx: 12, dy: -30 },
    { x: 26, y: 86, s: 6, dur: 12, del: -7, dx: 16, dy: -24 },
    { x: 68, y: 73, s: 7, dur: 15, del: -4, dx: -14, dy: -28 },
  ];

  motes.forEach((m, idx) => {
    const el = document.createElement('span');
    el.className = `gd-m-mote ${idx % 2 === 0 ? 'alt' : ''}`;
    el.style.cssText = `left:${m.x}%;top:${m.y}%;width:${m.s}px;height:${m.s}px;--dur:${m.dur}s;--del:${m.del}s;--dx:${m.dx}px;--dy:${m.dy}px;`;
    layer.appendChild(el);
  });

  // Bottom pixel-art mountain & pine horizon silhouette
  const horizon = document.createElement('div');
  horizon.className = 'gd-m-bg-horizon';
  horizon.innerHTML = `<svg viewBox="0 0 96 22" preserveAspectRatio="none" shape-rendering="crispEdges">
    <path d="M0 14 H14 V11 H24 V8 H36 V11 H48 V13 H62 V9 H74 V6 H86 V10 H96 V22 H0 Z" fill="currentColor" opacity="0.42"/>
    <path d="M0 17 H10 V15 H22 V17 H38 V14 H50 V16 H68 V13 H82 V15 H96 V22 H0 Z" fill="currentColor" opacity="0.72"/>
    <rect x="11" y="10" width="1" height="5" fill="currentColor"/><rect x="9" y="11" width="5" height="2" fill="currentColor"/><rect x="10" y="9" width="3" height="2" fill="currentColor"/>
    <rect x="77" y="9" width="1" height="5" fill="currentColor"/><rect x="75" y="10" width="5" height="2" fill="currentColor"/><rect x="76" y="8" width="3" height="2" fill="currentColor"/>
    <rect x="87" y="11" width="1" height="4" fill="currentColor"/><rect x="85" y="12" width="5" height="2" fill="currentColor"/><rect x="86" y="10" width="3" height="2" fill="currentColor"/>
  </svg>`;
  layer.appendChild(horizon);

  return layer;
}

function openHistoryDetailSheet(
  req: ApprovalRequest,
  wardName: string,
  host: string,
  status: string,
  fullTimestamp: string
): void {
  const existing = document.querySelector('.gd-m-history-sheet-overlay');
  existing?.remove();

  const statusClass = status.toLowerCase();
  const risk = (req.riskLevel || RiskLevel.LOW).toUpperCase();
  const isApproved = status === ApprovalStatus.APPROVED;
  const isRejected = status === ApprovalStatus.REJECTED;

  const overlay = document.createElement('div');
  overlay.className = 'gd-sheet-portal gd-m-history-sheet-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Decision audit details');

  const closeSheet = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeSheet();
  };
  document.addEventListener('keydown', onKeyDown);

  const backdrop = document.createElement('div');
  backdrop.className = 'gd-sheet-backdrop';
  backdrop.addEventListener('click', closeSheet);

  const sheet = document.createElement('div');
  sheet.className = 'gd-mobile-action-sheet gd-m-audit-sheet';

  const handle = document.createElement('div');
  handle.className = 'gd-sheet-drag-handle';
  handle.setAttribute('aria-hidden', 'true');

  // Top-right close button + Clean Verdict Header (zero boxes)
  const topRow = document.createElement('div');
  topRow.className = 'gd-m-audit-top';

  const verdictWrap = document.createElement('div');
  verdictWrap.className = `gd-m-audit-verdict ${statusClass}`;

  const iconSvg = isApproved
    ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  const verdictWord = isApproved ? 'Approved' : isRejected ? 'Rejected' : status;
  verdictWrap.innerHTML = `
    <span class="gd-m-audit-icon" aria-hidden="true">${iconSvg}</span>
    <div class="gd-m-audit-verdict-copy">
      <div class="gd-m-audit-verdict-title">${verdictWord}</div>
      <div class="gd-m-audit-verdict-time">${fullTimestamp}</div>
    </div>
  `;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-sheet-btn-close';
  closeBtn.setAttribute('aria-label', 'Close decision details');
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  closeBtn.addEventListener('click', closeSheet);

  topRow.appendChild(verdictWrap);
  topRow.appendChild(closeBtn);

  // Action & Site Name Block (prominent, borderless)
  const actionBlock = document.createElement('div');
  actionBlock.className = 'gd-m-audit-action';

  const siteLine = document.createElement('div');
  siteLine.className = 'gd-m-audit-site';
  siteLine.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>${host}</span>`;

  const title = document.createElement('h2');
  title.className = 'gd-m-audit-title';
  title.textContent = req.actionDescription;

  const reasonText = document.createElement('p');
  reasonText.className = 'gd-m-audit-reason';
  reasonText.textContent =
    req.riskReasons?.[0] || 'Action triggered Guardrail protective policy review.';

  actionBlock.appendChild(siteLine);
  actionBlock.appendChild(title);
  actionBlock.appendChild(reasonText);

  // Clean hairline-separated metadata rows (zero boxes)
  const shortId = req.id.length > 20 ? `${req.id.slice(0, 14)}…` : req.id;
  const catText = req.category ? req.category.replace(/_/g, ' ') : 'Action';
  const metaList = document.createElement('div');
  metaList.className = 'gd-m-audit-meta';
  metaList.innerHTML = `
    <div class="gd-m-setting-item">
      <span class="gd-m-setting-label">Ward</span>
      <span class="gd-m-setting-val">${wardName}</span>
    </div>
    <div class="gd-m-setting-item">
      <span class="gd-m-setting-label">Category · Risk</span>
      <span class="gd-m-setting-val">${catText} · ${risk}</span>
    </div>
    <div class="gd-m-setting-item">
      <span class="gd-m-setting-label">Request ID</span>
      <span class="gd-m-setting-val" title="${req.id}">${shortId}</span>
    </div>
  `;

  const actions = document.createElement('div');
  actions.className = 'gd-sheet-actions';

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'gd-btn-approve-touch';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', closeSheet);
  actions.appendChild(doneBtn);

  sheet.appendChild(handle);
  sheet.appendChild(topRow);
  sheet.appendChild(actionBlock);
  sheet.appendChild(metaList);
  sheet.appendChild(actions);

  overlay.appendChild(backdrop);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

const NOTIF_DISMISS_KEY = 'gd_m_notif_prompt_dismissed';
let hasShownNotifPromptInSession = false;

function openNotificationPromptSheet(
  onEnable: () => Promise<void> | void
): void {
  if (document.querySelector('.gd-m-notif-sheet-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'gd-sheet-portal gd-m-notif-sheet-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Enable push notifications');

  const dismiss = (remember: boolean) => {
    if (remember) {
      try {
        window.localStorage?.setItem(NOTIF_DISMISS_KEY, '1');
      } catch {
        // Ignore storage errors
      }
    }
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss(true);
  };
  document.addEventListener('keydown', onKeyDown);

  const backdrop = document.createElement('div');
  backdrop.className = 'gd-sheet-backdrop';
  backdrop.addEventListener('click', () => dismiss(true));

  const sheet = document.createElement('div');
  sheet.className = 'gd-mobile-action-sheet gd-m-audit-sheet';

  const handle = document.createElement('div');
  handle.className = 'gd-sheet-drag-handle';
  handle.setAttribute('aria-hidden', 'true');

  const topRow = document.createElement('div');
  topRow.className = 'gd-m-audit-top';

  const bellWrap = document.createElement('div');
  bellWrap.className = 'gd-m-audit-verdict';
  bellWrap.innerHTML = `
    <span class="gd-m-notif-icon" aria-hidden="true">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
    </span>
    <div class="gd-m-audit-verdict-copy">
      <div class="gd-m-audit-verdict-title" style="color:#141B11;">Enable Alerts</div>
      <div class="gd-m-audit-verdict-time">Real-time lock-screen approvals</div>
    </div>
  `;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-sheet-btn-close';
  closeBtn.setAttribute('aria-label', 'Dismiss notification prompt');
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  closeBtn.addEventListener('click', () => dismiss(true));

  topRow.appendChild(bellWrap);
  topRow.appendChild(closeBtn);

  const copyBlock = document.createElement('div');
  copyBlock.className = 'gd-m-audit-action';
  copyBlock.style.borderBottom = 'none';
  copyBlock.innerHTML = `
    <p class="gd-m-audit-reason" style="margin:0;color:#2B3823;font-size:14.5px;line-height:1.5;">
      Get notified immediately when a protected ward requests approval, so you can review and decide right from your phone.
    </p>
  `;

  const actions = document.createElement('div');
  actions.className = 'gd-sheet-actions';

  const enableBtn = document.createElement('button');
  enableBtn.type = 'button';
  enableBtn.className = 'gd-btn-approve-touch';
  enableBtn.textContent = 'Allow Notifications';
  enableBtn.addEventListener('click', async () => {
    enableBtn.disabled = true;
    enableBtn.textContent = 'Enabling…';
    try {
      await onEnable();
    } finally {
      dismiss(true);
    }
  });

  const laterBtn = document.createElement('button');
  laterBtn.type = 'button';
  laterBtn.className = 'gd-m-notif-later-btn';
  laterBtn.textContent = 'Not Now';
  laterBtn.addEventListener('click', () => dismiss(true));

  actions.appendChild(enableBtn);
  actions.appendChild(laterBtn);

  sheet.appendChild(handle);
  sheet.appendChild(topRow);
  sheet.appendChild(copyBlock);
  sheet.appendChild(actions);

  overlay.appendChild(backdrop);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

export function renderMobileCompanion(props: MobileCompanionProps): HTMLElement {
  const now = new Date();
  const scenery = getRealTimeScenery(now);
  const shell = document.createElement('div');
  shell.className = `gd-m-shell phase-${scenery.phase}`;
  shell.appendChild(createAmbientBackdrop(scenery.phase));

  const {
    activeTab,
    profile,
    pendingRequests,
    historyRequests,
    connectedWards,
    activeWardFilter,
  } = props;

  const filterByWard = (reqs: readonly ApprovalRequest[]): ApprovalRequest[] => {
    if (!activeWardFilter || activeWardFilter === 'ALL') return [...reqs];
    return reqs.filter((r) => (r.requesterId || '').toLowerCase() === activeWardFilter.toLowerCase());
  };

  const filteredPending = filterByWard(pendingRequests).sort(
    (a, b) => getRiskPriority(b.riskLevel) - getRiskPriority(a.riskLevel)
  );
  const filteredHistory = filterByWard(historyRequests);

  // =========================================================================
  // 1. UNIFIED TOP BAR: Avatar + Scrollable Ward Filter Pills
  // =========================================================================
  const topBar = document.createElement('header');
  topBar.className = 'gd-m-topbar';

  const avatarBtn = document.createElement('button');
  avatarBtn.type = 'button';
  avatarBtn.className = 'gd-m-avatar-btn';
  avatarBtn.setAttribute('aria-label', 'Open account and settings');
  if (profile?.isAuthenticated && profile.actorId && !/^(usr_|user_)/i.test(profile.actorId)) {
    avatarBtn.textContent = getInitials(profile.actorId);
  } else {
    avatarBtn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }
  avatarBtn.addEventListener('click', () => props.onSelectTab('settings'));
  topBar.appendChild(avatarBtn);

  const showWardFilter = activeTab === 'queue' || activeTab === 'history';
  if (showWardFilter) {
    const pillStrip = document.createElement('div');
    pillStrip.className = 'gd-m-ward-pills';
    pillStrip.setAttribute('role', 'tablist');
    pillStrip.setAttribute('aria-label', 'Filter by protected ward');

    const sourceForCounts = activeTab === 'history' ? historyRequests : pendingRequests;
    const makePill = (id: string, label: string, count: number) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      const isActive = (activeWardFilter || 'ALL') === id;
      pill.className = `gd-m-pill ${isActive ? 'active' : ''}`;
      pill.setAttribute('role', 'tab');
      pill.setAttribute('aria-selected', isActive ? 'true' : 'false');

      const textSpan = document.createElement('span');
      textSpan.textContent = label;
      pill.appendChild(textSpan);

      if (count > 0) {
        const cnt = document.createElement('span');
        cnt.className = 'gd-m-pill-count';
        cnt.textContent = String(count);
        pill.appendChild(cnt);
      }

      pill.addEventListener('click', () => props.onSelectWardFilter(id));
      return pill;
    };

    pillStrip.appendChild(makePill('ALL', 'All', sourceForCounts.length));
    connectedWards.forEach((w) => {
      const wCount = sourceForCounts.filter(
        (r) => (r.requesterId || '').toLowerCase() === w.id.toLowerCase()
      ).length;
      const firstName = formatWardDisplayName(w.name, w.id).split(' ')[0];
      pillStrip.appendChild(makePill(w.id, firstName, wCount));
    });

    topBar.appendChild(pillStrip);
  } else {
    const topGreeting = document.createElement('div');
    topGreeting.className = `gd-m-top-greeting-pill phase-${scenery.phase} ${scenery.isDarkScene ? 'is-dark' : 'is-light'}`;
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    topGreeting.innerHTML = `
      <div class="gd-m-top-greeting-art" aria-hidden="true">${scenery.svg}</div>
      <div class="gd-m-top-greeting-scrim" aria-hidden="true"></div>
      <div class="gd-m-top-greeting-text">
        <span class="gd-m-top-greeting-label">${scenery.greeting}</span>
        <span class="gd-m-top-greeting-dot" aria-hidden="true">·</span>
        <span class="gd-m-top-greeting-time">${timeStr}</span>
      </div>
    `;
    topBar.appendChild(topGreeting);
  }

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = `gd-m-refresh-btn ${props.isRefreshing ? 'spinning' : ''}`;
  refreshBtn.setAttribute('aria-label', 'Refresh approvals');
  refreshBtn.innerHTML = `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
    </svg>
  `;
  refreshBtn.addEventListener('click', () => props.onRefresh());
  topBar.appendChild(refreshBtn);

  shell.appendChild(topBar);

  // =========================================================================
  // 2. SCROLLABLE MAIN CONTENT
  // =========================================================================
  const main = document.createElement('main');
  main.className = 'gd-m-main';

  // Pull-to-refresh indicator & gesture
  const ptrIndicator = document.createElement('div');
  ptrIndicator.className = 'gd-m-ptr-indicator';
  ptrIndicator.setAttribute('aria-hidden', 'true');
  ptrIndicator.innerHTML = `
    <span class="gd-m-ptr-arrow">↓</span>
    <span class="gd-m-ptr-label">Pull to refresh</span>
  `;
  main.appendChild(ptrIndicator);

  const ptrArrow = ptrIndicator.querySelector('.gd-m-ptr-arrow') as HTMLElement | null;
  const ptrLabel = ptrIndicator.querySelector('.gd-m-ptr-label') as HTMLElement | null;

  let ptrArmed = false;
  let ptrStartY = 0;
  let ptrPullDist = 0;
  const PTR_THRESHOLD = 52;

  const resetPtr = () => {
    ptrArmed = false;
    ptrPullDist = 0;
    ptrIndicator.classList.remove('is-pulling', 'is-ready', 'is-refreshing');
    ptrIndicator.style.height = '0px';
    ptrIndicator.style.opacity = '0';
    if (ptrArrow) ptrArrow.style.transform = '';
    if (ptrLabel) ptrLabel.textContent = 'Pull to refresh';
  };

  shell.addEventListener('touchstart', (e: TouchEvent) => {
    const scrollTop =
      (typeof window !== 'undefined' ? window.scrollY : 0) ||
      (typeof document !== 'undefined' ? document.documentElement?.scrollTop || 0 : 0) ||
      main.scrollTop ||
      0;
    const modalOpen = typeof document !== 'undefined' && Boolean(document.querySelector('.gd-sheet-portal'));
    if (scrollTop <= 2 && !modalOpen && e.touches && e.touches.length === 1) {
      ptrArmed = true;
      ptrStartY = e.touches[0].clientY;
      ptrPullDist = 0;
    } else {
      ptrArmed = false;
    }
  }, { passive: true });

  shell.addEventListener('touchmove', (e: TouchEvent) => {
    if (!ptrArmed || !e.touches || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - ptrStartY;
    if (dy <= 0) {
      resetPtr();
      return;
    }
    ptrPullDist = Math.min(84, Math.round(dy * 0.45));
    if (ptrPullDist > 8 && e.cancelable) {
      e.preventDefault();
    }
    const isReady = ptrPullDist >= PTR_THRESHOLD;
    ptrIndicator.classList.add('is-pulling');
    if (isReady) {
      ptrIndicator.classList.add('is-ready');
    } else {
      ptrIndicator.classList.remove('is-ready');
    }
    ptrIndicator.style.height = `${ptrPullDist}px`;
    ptrIndicator.style.opacity = String(Math.min(1, ptrPullDist / 42));
    if (ptrArrow) {
      ptrArrow.style.transform = isReady ? 'rotate(180deg)' : `rotate(${Math.min(160, ptrPullDist * 2)}deg)`;
    }
    if (ptrLabel) {
      ptrLabel.textContent = isReady ? 'Release to refresh' : 'Pull to refresh';
    }
  }, { passive: false });

  const finishPtr = () => {
    if (!ptrArmed) return;
    const shouldRefresh = ptrPullDist >= PTR_THRESHOLD;
    ptrArmed = false;
    if (shouldRefresh) {
      ptrIndicator.classList.remove('is-pulling', 'is-ready');
      ptrIndicator.classList.add('is-refreshing');
      ptrIndicator.style.height = '44px';
      ptrIndicator.style.opacity = '1';
      if (ptrLabel) ptrLabel.textContent = 'Refreshing…';
      props.onRefresh();
      setTimeout(() => {
        resetPtr();
      }, 650);
    } else {
      resetPtr();
    }
  };
  shell.addEventListener('touchend', finishPtr, { passive: true });
  shell.addEventListener('touchcancel', resetPtr, { passive: true });

  // Subtle tonal Offline / Connectivity Banner
  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isBrowserOffline || props.isBackendUnavailable) {
    const offlineBanner = document.createElement('div');
    offlineBanner.className = 'gd-m-offline-banner';
    offlineBanner.setAttribute('role', 'status');
    offlineBanner.setAttribute('aria-live', 'polite');
    offlineBanner.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="1" y1="1" x2="23" y2="23"></line>
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
        <line x1="12" y1="20" x2="12.01" y2="20"></line>
      </svg>
      <span>${
        isBrowserOffline
          ? "You're offline · Decisions require internet connection"
          : 'Connection interrupted · Reconnecting to Guardrail…'
      }</span>
    `;
    main.appendChild(offlineBanner);
  }

  if (activeTab === 'queue') {
    // Pixelated Real-Time Scenery Greeting
    const greetingBlock = document.createElement('section');
    greetingBlock.className = `gd-m-greeting gd-m-scenery phase-${scenery.phase} ${scenery.isDarkScene ? 'is-dark' : 'is-light'}`;

    const sceneCanvas = document.createElement('div');
    sceneCanvas.className = 'gd-m-scenery-art';
    sceneCanvas.innerHTML = scenery.svg;
    greetingBlock.appendChild(sceneCanvas);

    const sceneScrim = document.createElement('div');
    sceneScrim.className = 'gd-m-scenery-scrim';
    sceneScrim.setAttribute('aria-hidden', 'true');
    greetingBlock.appendChild(sceneScrim);

    const sceneContent = document.createElement('div');
    sceneContent.className = 'gd-m-scenery-content';

    const clockLine = document.createElement('div');
    clockLine.className = 'gd-m-scenery-time';
    clockLine.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const greetTitle = document.createElement('h1');
    greetTitle.className = 'gd-m-greet-title';
    greetTitle.textContent = scenery.greeting;

    const greetSub = document.createElement('p');
    greetSub.className = 'gd-m-greet-sub';
    if (props.isBackendUnavailable && pendingRequests.length === 0) {
      greetSub.textContent = 'Connection paused — tap refresh';
    } else if (filteredPending.length === 0) {
      greetSub.textContent = `All ${connectedWards.length || 1} protected wards clear`;
    } else {
      greetSub.textContent = `${filteredPending.length} ${filteredPending.length === 1 ? 'request' : 'requests'} awaiting decision`;
    }

    sceneContent.appendChild(clockLine);
    sceneContent.appendChild(greetTitle);
    sceneContent.appendChild(greetSub);
    greetingBlock.appendChild(sceneContent);
    main.appendChild(greetingBlock);

    if (filteredPending.length === 0) {
      const clearCard = document.createElement('div');
      clearCard.className = 'gd-m-empty-card';
      clearCard.innerHTML = `
        <div class="gd-m-empty-mark" aria-hidden="true">✓</div>
        <h2 class="gd-m-empty-title">You're all caught up</h2>
        <p class="gd-m-empty-desc">No pending actions require your approval right now.</p>
      `;
      main.appendChild(clearCard);
    } else {
      // Spotlight Hero Card (Highest-risk / most urgent request)
      const heroReq = filteredPending[0];
      const heroWard = connectedWards.find(
        (w) => w.id.toLowerCase() === (heroReq.requesterId || '').toLowerCase()
      );
      const heroWardName = formatWardDisplayName(heroWard?.name, heroReq.requesterId);
      const heroHost = resolveSafeHostname(heroReq);
      const heroRisk = (heroReq.riskLevel || RiskLevel.HIGH).toUpperCase();
      const heroRiskClass = heroRisk.toLowerCase();

      const heroSectionLabel = document.createElement('div');
      heroSectionLabel.className = 'gd-m-section-kicker';
      heroSectionLabel.textContent = 'Needs your decision';
      main.appendChild(heroSectionLabel);

      const heroCard = document.createElement('article');
      heroCard.className = `gd-m-hero-card risk-${heroRiskClass}`;
      heroCard.setAttribute('role', 'button');
      heroCard.setAttribute('tabindex', '0');

      const heroTop = document.createElement('div');
      heroTop.className = 'gd-m-hero-top';

      const heroBadge = document.createElement('span');
      heroBadge.className = `gd-m-risk-pill ${heroRiskClass}`;
      heroBadge.textContent = heroRisk === 'CRITICAL' ? `▲ ${heroRisk}` : heroRisk;

      const heroWardSpan = document.createElement('span');
      heroWardSpan.className = 'gd-m-hero-ward';
      heroWardSpan.textContent = heroWardName;

      heroTop.appendChild(heroBadge);
      heroTop.appendChild(heroWardSpan);

      const heroTitle = document.createElement('h2');
      heroTitle.className = 'gd-m-hero-title';
      heroTitle.textContent = heroReq.actionDescription;

      const heroMeta = document.createElement('div');
      heroMeta.className = 'gd-m-hero-meta';
      const expText = heroReq.expiresAt && !isRequestExpired(heroReq)
        ? `Expires ${new Date(heroReq.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'Pending review';
      heroMeta.textContent = `${heroHost} · ${expText}`;

      const heroReason = document.createElement('p');
      heroReason.className = 'gd-m-hero-reason';
      heroReason.textContent =
        heroReq.riskReasons?.[0] ||
        'High-impact browser action held in Staging Mode pending your consent.';

      const heroActions = document.createElement('div');
      heroActions.className = 'gd-m-hero-actions';

      const reviewCta = document.createElement('button');
      reviewCta.type = 'button';
      reviewCta.className = 'gd-m-hero-cta';
      reviewCta.innerHTML = `<span>Review & Decide</span><span aria-hidden="true">→</span>`;
      reviewCta.addEventListener('click', (e) => {
        e?.stopPropagation?.();
        props.onOpenRequestSheet(heroReq.id);
      });

      heroActions.appendChild(reviewCta);

      heroCard.appendChild(heroTop);
      heroCard.appendChild(heroTitle);
      heroCard.appendChild(heroMeta);
      heroCard.appendChild(heroReason);
      heroCard.appendChild(heroActions);
      heroCard.addEventListener('click', () => props.onOpenRequestSheet(heroReq.id));
      main.appendChild(heroCard);

      // Remaining Queue List
      if (filteredPending.length > 1) {
        const upNextLabel = document.createElement('div');
        upNextLabel.className = 'gd-m-section-kicker';
        upNextLabel.textContent = `Up next (${filteredPending.length - 1})`;
        main.appendChild(upNextLabel);

        const list = document.createElement('div');
        list.className = 'gd-m-list';

        filteredPending.slice(1).forEach((req) => {
          const ward = connectedWards.find(
            (w) => w.id.toLowerCase() === (req.requesterId || '').toLowerCase()
          );
          const wardName = formatWardDisplayName(ward?.name, req.requesterId);
          const host = resolveSafeHostname(req);
          const risk = (req.riskLevel || RiskLevel.LOW).toUpperCase();
          const riskClass = risk.toLowerCase();

          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'gd-m-row';

          const dot = document.createElement('span');
          dot.className = `gd-m-row-dot ${riskClass}`;
          dot.setAttribute('aria-hidden', 'true');

          const info = document.createElement('div');
          info.className = 'gd-m-row-info';

          const rTitle = document.createElement('div');
          rTitle.className = 'gd-m-row-title';
          rTitle.textContent = req.actionDescription;

          const rSub = document.createElement('div');
          rSub.className = 'gd-m-row-sub';
          rSub.textContent = `${wardName} · ${host} · ${risk}`;

          info.appendChild(rTitle);
          info.appendChild(rSub);

          const chev = document.createElement('span');
          chev.className = 'gd-m-row-chev';
          chev.setAttribute('aria-hidden', 'true');
          chev.textContent = '›';

          row.appendChild(dot);
          row.appendChild(info);
          row.appendChild(chev);
          row.addEventListener('click', () => props.onOpenRequestSheet(req.id));
          list.appendChild(row);
        });

        main.appendChild(list);
      }

      const footerNote = document.createElement('div');
      footerNote.className = 'gd-m-footer-note';
      footerNote.textContent = `Separation of Duties Active · ${connectedWards.length || 1} Protected ${connectedWards.length === 1 ? 'Ward' : 'Wards'}`;
      main.appendChild(footerNote);
    }
  } else if (activeTab === 'history') {
    const headerBlock = document.createElement('section');
    headerBlock.className = 'gd-m-page-header';
    headerBlock.innerHTML = `
      <h1 class="gd-m-page-title">Decision History</h1>
      <p class="gd-m-page-sub">${filteredHistory.length} recorded ${filteredHistory.length === 1 ? 'decision' : 'decisions'}</p>
    `;
    main.appendChild(headerBlock);

    if (filteredHistory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gd-m-empty-card';
      empty.innerHTML = `
        <h2 class="gd-m-empty-title">No prior decisions</h2>
        <p class="gd-m-empty-desc">Approved and rejected requests will appear here.</p>
      `;
      main.appendChild(empty);
    } else {
      const historyKicker = document.createElement('div');
      historyKicker.className = 'gd-m-section-kicker';
      historyKicker.textContent = `Recorded decisions (${filteredHistory.length})`;
      main.appendChild(historyKicker);

      const list = document.createElement('div');
      list.className = 'gd-m-list';
      filteredHistory.slice(0, 25).forEach((req) => {
        const ward = connectedWards.find(
          (w) => w.id.toLowerCase() === (req.requesterId || '').toLowerCase()
        );
        const wardName = formatWardDisplayName(ward?.name, req.requesterId);
        const host = resolveSafeHostname(req);
        const status = req.status || ApprovalStatus.APPROVED;
        const statusClass = status.toLowerCase();

        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'gd-m-row gd-m-history-row';

        const mark = document.createElement('span');
        mark.className = `gd-m-history-mark ${statusClass}`;
        mark.textContent = status === ApprovalStatus.APPROVED ? '✓' : status === ApprovalStatus.REJECTED ? '✕' : '•';

        const info = document.createElement('div');
        info.className = 'gd-m-row-info';

        const rTitle = document.createElement('div');
        rTitle.className = 'gd-m-row-title';
        rTitle.textContent = req.actionDescription;

        const rSub = document.createElement('div');
        rSub.className = 'gd-m-row-sub';
        const rawDate = req.resolvedAt || req.createdAt;
        const ts = rawDate
          ? new Date(rawDate).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : formatTimestamp(rawDate);
        rSub.textContent = `${wardName.split(' ')[0]} · ${host} · ${ts}`;

        info.appendChild(rTitle);
        info.appendChild(rSub);

        const statusTag = document.createElement('span');
        statusTag.className = `gd-m-history-status ${statusClass}`;
        statusTag.textContent = status;

        row.appendChild(mark);
        row.appendChild(info);
        row.appendChild(statusTag);
        const fullTs = formatTimestamp(rawDate);
        row.addEventListener('click', () =>
          openHistoryDetailSheet(req, wardName, host, status, fullTs)
        );
        list.appendChild(row);
      });
      main.appendChild(list);

      const footerNote = document.createElement('div');
      footerNote.className = 'gd-m-footer-note';
      footerNote.textContent = 'Audit Log · Immutable Decision Record';
      main.appendChild(footerNote);
    }
  } else if (activeTab === 'wards') {
    const headerBlock = document.createElement('section');
    headerBlock.className = 'gd-m-greeting gd-m-page-header';
    headerBlock.innerHTML = `
      <h1 class="gd-m-page-title">Protected Wards</h1>
      <p class="gd-m-page-sub">${connectedWards.length} connected ${connectedWards.length === 1 ? 'person' : 'people'} under your oversight</p>
    `;
    main.appendChild(headerBlock);

    const wardsKicker = document.createElement('div');
    wardsKicker.className = 'gd-m-section-kicker';
    wardsKicker.textContent = `Connected wards (${connectedWards.length})`;
    main.appendChild(wardsKicker);

    const list = document.createElement('div');
    list.className = 'gd-m-list';
    connectedWards.forEach((ward) => {
      const pCount = pendingRequests.filter(
        (r) => (r.requesterId || '').toLowerCase() === ward.id.toLowerCase()
      ).length;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gd-m-row';

      const avatar = document.createElement('span');
      avatar.className = 'gd-m-ward-avatar';
      avatar.textContent = getInitials(ward.name);

      const info = document.createElement('div');
      info.className = 'gd-m-row-info';

      const nameEl = document.createElement('div');
      nameEl.className = 'gd-m-row-title';
      nameEl.textContent = formatWardDisplayName(ward.name, ward.id);

      const subEl = document.createElement('div');
      subEl.className = 'gd-m-row-sub';
      subEl.textContent = ward.email || ward.id;

      info.appendChild(nameEl);
      info.appendChild(subEl);

      const badge = document.createElement('span');
      badge.className = `gd-m-ward-count ${pCount > 0 ? 'urgent' : ''}`;
      badge.textContent = pCount > 0 ? `${pCount} pending` : 'Clear';

      row.appendChild(avatar);
      row.appendChild(info);
      row.appendChild(badge);
      row.addEventListener('click', () => {
        props.onSelectWardFilter(ward.id);
        props.onSelectTab('queue');
      });
      list.appendChild(row);
    });
    main.appendChild(list);

    if (props.onConnectWard) {
      const pairBox = document.createElement('form');
      pairBox.className = 'gd-m-pair-box';
      pairBox.innerHTML = `
        <label class="gd-m-section-kicker" for="gd-m-pair-input">Pair another ward</label>
        <div class="gd-m-pair-row">
          <input id="gd-m-pair-input" class="gd-m-pair-input" type="text" placeholder="GR-INV-XXXX-YYYY" autocomplete="off" />
          <button type="submit" class="gd-m-pair-btn">Connect</button>
        </div>
        <div class="gd-m-pair-msg" aria-live="polite"></div>
      `;
      const input = pairBox.querySelector<HTMLInputElement>('#gd-m-pair-input')!;
      const msgEl = pairBox.querySelector<HTMLElement>('.gd-m-pair-msg')!;
      pairBox.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = input.value.trim().toUpperCase();
        if (!code) return;
        msgEl.textContent = 'Connecting...';
        const res = await props.onConnectWard!(code);
        msgEl.textContent = res.message || (res.success ? 'Ward connected.' : 'Unable to pair.');
        if (res.success) input.value = '';
      });
      main.appendChild(pairBox);
    }
  } else {
    // Settings Tab
    const headerBlock = document.createElement('section');
    headerBlock.className = 'gd-m-page-header';
    headerBlock.innerHTML = `
      <h1 class="gd-m-page-title">Settings</h1>
      <p class="gd-m-page-sub">Reviewer account & mobile companion</p>
    `;
    main.appendChild(headerBlock);

    const settingsKicker = document.createElement('div');
    settingsKicker.className = 'gd-m-section-kicker';
    settingsKicker.textContent = 'Account & safety';
    main.appendChild(settingsKicker);

    const rawActorId = profile?.actorId || 'Guest';
    const displayActorId =
      rawActorId.length > 22
        ? `${rawActorId.slice(0, 12)}…${rawActorId.slice(-5)}`
        : rawActorId;

    const card = document.createElement('div');
    card.className = 'gd-m-settings-list';
    const pushSupported = props.pushStatus?.isSupported ?? (typeof Notification !== 'undefined');
    const pushPerm = props.pushStatus?.permission ?? (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
    const isSubscribed = Boolean(props.pushStatus?.isSubscribed);
    const pushBadgeText = !pushSupported
      ? 'Unsupported'
      : isSubscribed
        ? 'Active'
        : pushPerm === 'denied'
          ? 'Blocked'
          : 'Off';
    const pushBadgeClass = isSubscribed ? 'approved' : pushPerm === 'denied' ? 'rejected' : '';

    card.innerHTML = `
      <div class="gd-m-setting-item">
        <span class="gd-m-setting-label">Reviewer ID</span>
        <span class="gd-m-setting-pill" title="${rawActorId}">${displayActorId}</span>
      </div>
      <div class="gd-m-setting-item">
        <span class="gd-m-setting-label">Protected Wards</span>
        <span class="gd-m-setting-pill">${connectedWards.length} Connected</span>
      </div>
      <div class="gd-m-setting-item">
        <span class="gd-m-setting-label">Execution Model</span>
        <span class="gd-m-setting-pill">Decoupled Consent-Only</span>
      </div>
      <div class="gd-m-setting-item">
        <span class="gd-m-setting-label">Push Alerts</span>
        <span class="gd-m-history-status ${pushBadgeClass}">${pushBadgeText}</span>
      </div>
    `;
    main.appendChild(card);

    if (pushSupported && props.onSubscribePush && pushPerm !== 'denied') {
      const pushActions = document.createElement('div');
      pushActions.className = 'gd-m-push-actions';
      if (!isSubscribed) {
        const subBtn = document.createElement('button');
        subBtn.type = 'button';
        subBtn.className = 'gd-m-hero-cta';
        subBtn.disabled = Boolean(props.isSubscribingPush);
        subBtn.textContent = props.isSubscribingPush ? 'Enabling Alerts…' : 'Allow Push Notifications';
        subBtn.addEventListener('click', () => void props.onSubscribePush?.());
        pushActions.appendChild(subBtn);
      } else {
        if (props.onSendTestPush) {
          const testBtn = document.createElement('button');
          testBtn.type = 'button';
          testBtn.className = 'gd-m-notif-later-btn';
          testBtn.textContent = 'Send Test Notification';
          testBtn.addEventListener('click', () => void props.onSendTestPush?.());
          pushActions.appendChild(testBtn);
        }
        if (props.onUnsubscribePush) {
          const unsubBtn = document.createElement('button');
          unsubBtn.type = 'button';
          unsubBtn.className = 'gd-m-notif-later-btn';
          unsubBtn.textContent = 'Pause Alerts';
          unsubBtn.addEventListener('click', () => void props.onUnsubscribePush?.());
          pushActions.appendChild(unsubBtn);
        }
      }
      if (props.pushActionMessage) {
        const msg = document.createElement('div');
        msg.className = 'gd-m-pair-msg';
        msg.textContent = props.pushActionMessage;
        pushActions.appendChild(msg);
      }
      main.appendChild(pushActions);
    }

    if (profile?.isAuthenticated && props.onSignOut) {
      const signOutBtn = document.createElement('button');
      signOutBtn.type = 'button';
      signOutBtn.className = 'gd-m-signout-btn';
      signOutBtn.textContent = 'Sign Out';
      signOutBtn.addEventListener('click', () => props.onSignOut?.());
      main.appendChild(signOutBtn);
    } else if (props.onOpenAuth) {
      const signInBtn = document.createElement('button');
      signInBtn.type = 'button';
      signInBtn.className = 'gd-m-hero-cta';
      signInBtn.textContent = 'Sign In';
      signInBtn.addEventListener('click', () => props.onOpenAuth?.());
      main.appendChild(signInBtn);
    }

    const footerNote = document.createElement('div');
    footerNote.className = 'gd-m-footer-note';
    footerNote.textContent = 'Separation of Duties Active · Local Consent Only';
    main.appendChild(footerNote);
  }

  shell.appendChild(main);

  // =========================================================================
  // 3. FLOATING PILL BOTTOM DOCK + DETACHED CIRCULAR ACTION BUTTON
  //    (Matching reference bottom bar composition in Quiet Assurance palette)
  // =========================================================================
  const dockWrap = document.createElement('div');
  dockWrap.className = 'gd-m-dock-wrap';

  const pillDock = document.createElement('nav');
  pillDock.className = 'gd-m-pill-dock';
  pillDock.setAttribute('aria-label', 'Mobile companion navigation');

  const dockTabs: Array<{ id: MobileTab; label: string; svg: string }> = [
    {
      id: 'history',
      label: 'History',
      svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>',
    },
    {
      id: 'wards',
      label: 'Wards',
      svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    },
    {
      id: 'settings',
      label: 'Settings',
      svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    },
  ];

  dockTabs.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = activeTab === t.id;
    btn.className = `gd-m-dock-btn ${isActive ? 'active' : ''}`;
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'gd-m-dock-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.innerHTML = t.svg;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'gd-m-dock-label';
    labelSpan.textContent = t.label;

    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);
    btn.addEventListener('click', () => props.onSelectTab(t.id));
    pillDock.appendChild(btn);
  });

  const queueCircle = document.createElement('button');
  queueCircle.type = 'button';
  queueCircle.className = `gd-m-dock-circle ${activeTab === 'queue' ? 'active' : ''}`;
  queueCircle.setAttribute('aria-label', `Pending queue (${pendingRequests.length})`);
  queueCircle.setAttribute('aria-current', activeTab === 'queue' ? 'page' : 'false');
  queueCircle.innerHTML = `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`;

  if (pendingRequests.length > 0) {
    const badge = document.createElement('span');
    badge.className = 'gd-m-dock-circle-badge';
    badge.textContent = pendingRequests.length > 99 ? '99+' : String(pendingRequests.length);
    queueCircle.appendChild(badge);
  }

  queueCircle.addEventListener('click', () => {
    props.onSelectTab('queue');
  });

  dockWrap.appendChild(pillDock);
  dockWrap.appendChild(queueCircle);
  shell.appendChild(dockWrap);

  const canPromptForPush =
    Boolean(props.profile?.isAuthenticated) &&
    Boolean(props.onSubscribePush) &&
    Boolean(props.pushStatus?.isSupported) &&
    !props.pushStatus?.isSubscribed &&
    props.pushStatus?.permission === 'default';

  if (canPromptForPush && !hasShownNotifPromptInSession) {
    let dismissed = false;
    try {
      dismissed = typeof window !== 'undefined' && window.localStorage.getItem(NOTIF_DISMISS_KEY) === '1';
    } catch {
      dismissed = false;
    }
    if (!dismissed) {
      hasShownNotifPromptInSession = true;
      const onSubscribePush = props.onSubscribePush!;
      queueMicrotask(() => {
        openNotificationPromptSheet(onSubscribePush);
      });
    }
  }

  return shell;
}
