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
  const riskClass = risk.toLowerCase();

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
  sheet.className = 'gd-mobile-action-sheet';

  const handle = document.createElement('div');
  handle.className = 'gd-sheet-drag-handle';
  handle.setAttribute('aria-hidden', 'true');

  const header = document.createElement('div');
  header.className = 'gd-sheet-header';

  const badgeRow = document.createElement('div');
  badgeRow.className = 'gd-sheet-badge-row';

  const wardEl = document.createElement('span');
  wardEl.className = 'gd-m-hero-ward';
  wardEl.style.padding = '0';
  wardEl.style.background = 'transparent';
  wardEl.textContent = wardName;

  const statusPill = document.createElement('span');
  statusPill.className = `gd-m-history-status ${statusClass}`;
  statusPill.textContent = status;

  const riskPill = document.createElement('span');
  riskPill.className = `gd-m-risk-pill ${riskClass}`;
  riskPill.textContent = risk;

  badgeRow.appendChild(wardEl);
  badgeRow.appendChild(statusPill);
  badgeRow.appendChild(riskPill);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-sheet-btn-close';
  closeBtn.setAttribute('aria-label', 'Close decision details');
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  closeBtn.addEventListener('click', closeSheet);

  header.appendChild(badgeRow);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'gd-sheet-body';

  const title = document.createElement('h2');
  title.className = 'gd-sheet-action-title';
  title.textContent = req.actionDescription;

  const metaRow = document.createElement('div');
  metaRow.className = 'gd-sheet-meta-row';

  const domainPill = document.createElement('span');
  domainPill.className = 'gd-sheet-domain-pill';
  domainPill.textContent = host;
  metaRow.appendChild(domainPill);

  if (req.category) {
    const catPill = document.createElement('span');
    catPill.className = 'gd-sheet-category-pill';
    catPill.textContent = req.category.replace(/_/g, ' ');
    metaRow.appendChild(catPill);
  }

  const riskBox = document.createElement('div');
  riskBox.className = 'gd-sheet-risk-box';
  const riskHead = document.createElement('div');
  riskHead.className = 'gd-sheet-risk-headline';
  riskHead.textContent = 'Why this action was held:';
  riskBox.appendChild(riskHead);

  const reasonsList = document.createElement('ul');
  reasonsList.className = 'gd-sheet-reasons-list';
  const reasons = req.riskReasons?.length
    ? req.riskReasons
    : ['Action triggered Guardrail protective policy review.'];
  reasons.forEach((reason) => {
    const li = document.createElement('li');
    li.textContent = reason;
    reasonsList.appendChild(li);
  });
  riskBox.appendChild(reasonsList);

  const auditNote = document.createElement('div');
  auditNote.className = 'gd-sheet-decoupling-note';
  const shortId = req.id.length > 18 ? `${req.id.slice(0, 14)}…` : req.id;
  auditNote.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span><strong>Immutable Decision Record:</strong> Decided ${fullTimestamp} · Request ${shortId}</span>`;

  body.appendChild(title);
  body.appendChild(metaRow);
  body.appendChild(riskBox);
  body.appendChild(auditNote);

  const actions = document.createElement('div');
  actions.className = 'gd-sheet-actions';

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'gd-btn-approve-touch';
  doneBtn.textContent = 'Close';
  doneBtn.addEventListener('click', closeSheet);
  actions.appendChild(doneBtn);

  sheet.appendChild(handle);
  sheet.appendChild(header);
  sheet.appendChild(body);
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
    `;
    main.appendChild(card);

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

  return shell;
}
