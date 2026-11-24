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

function getGreetingPrefix(): string {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  return 'Good evening';
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

export function renderMobileCompanion(props: MobileCompanionProps): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'gd-m-shell';

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
  if (profile?.isAuthenticated && profile.actorId && !/^usr_/i.test(profile.actorId)) {
    avatarBtn.textContent = getInitials(profile.actorId);
  } else {
    avatarBtn.appendChild(createIcon('user'));
  }
  avatarBtn.addEventListener('click', () => props.onSelectTab('settings'));
  topBar.appendChild(avatarBtn);

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
    // Editorial Greeting
    const greetingBlock = document.createElement('section');
    greetingBlock.className = 'gd-m-greeting';

    const greetTitle = document.createElement('h1');
    greetTitle.className = 'gd-m-greet-title';
    greetTitle.textContent = getGreetingPrefix();

    const greetSub = document.createElement('p');
    greetSub.className = 'gd-m-greet-sub';
    if (props.isBackendUnavailable && pendingRequests.length === 0) {
      greetSub.textContent = 'Connection paused — tap refresh to sync';
    } else if (filteredPending.length === 0) {
      greetSub.textContent = `All ${connectedWards.length || 1} protected wards are clear`;
    } else {
      greetSub.textContent = `${filteredPending.length} ${filteredPending.length === 1 ? 'request' : 'requests'} awaiting your decision`;
    }

    greetingBlock.appendChild(greetTitle);
    greetingBlock.appendChild(greetSub);
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
    headerBlock.className = 'gd-m-greeting';
    headerBlock.innerHTML = `
      <h1 class="gd-m-greet-title">Decision History</h1>
      <p class="gd-m-greet-sub">${filteredHistory.length} recorded ${filteredHistory.length === 1 ? 'decision' : 'decisions'}</p>
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

        const row = document.createElement('div');
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
        const ts = formatTimestamp(req.resolvedAt || req.createdAt);
        rSub.textContent = `${wardName} · ${host} · ${ts}`;

        info.appendChild(rTitle);
        info.appendChild(rSub);

        const statusTag = document.createElement('span');
        statusTag.className = `gd-m-history-status ${statusClass}`;
        statusTag.textContent = status;

        row.appendChild(mark);
        row.appendChild(info);
        row.appendChild(statusTag);
        list.appendChild(row);
      });
      main.appendChild(list);
    }
  } else if (activeTab === 'wards') {
    const headerBlock = document.createElement('section');
    headerBlock.className = 'gd-m-greeting';
    headerBlock.innerHTML = `
      <h1 class="gd-m-greet-title">Protected Wards</h1>
      <p class="gd-m-greet-sub">${connectedWards.length} connected ${connectedWards.length === 1 ? 'person' : 'people'} under your oversight</p>
    `;
    main.appendChild(headerBlock);

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
    headerBlock.className = 'gd-m-greeting';
    headerBlock.innerHTML = `
      <h1 class="gd-m-greet-title">Settings</h1>
      <p class="gd-m-greet-sub">Reviewer account & mobile companion</p>
    `;
    main.appendChild(headerBlock);

    const card = document.createElement('div');
    card.className = 'gd-m-settings-list';
    card.innerHTML = `
      <div class="gd-m-setting-item">
        <span class="gd-m-setting-label">Reviewer ID</span>
        <span class="gd-m-setting-val">${profile?.actorId || 'Guest'}</span>
      </div>
      <div class="gd-m-setting-item">
        <span class="gd-m-setting-label">Protected Wards</span>
        <span class="gd-m-setting-val">${connectedWards.length} Connected</span>
      </div>
      <div class="gd-m-setting-item">
        <span class="gd-m-setting-label">Execution Model</span>
        <span class="gd-m-setting-val">Decoupled Consent-Only</span>
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

  const dockTabs: Array<{ id: MobileTab; label: string; icon: 'clock' | 'history' | 'users' }> = [
    { id: 'queue', label: 'Queue', icon: 'clock' },
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'wards', label: 'Wards', icon: 'users' },
  ];

  dockTabs.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = activeTab === t.id;
    btn.className = `gd-m-dock-btn ${isActive ? 'active' : ''}`;
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'gd-m-dock-icon';
    iconSpan.appendChild(createIcon(t.icon));

    if (t.id === 'queue' && pendingRequests.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'gd-m-dock-badge';
      badge.textContent = pendingRequests.length > 99 ? '99+' : String(pendingRequests.length);
      iconSpan.appendChild(badge);
    }

    const labelSpan = document.createElement('span');
    labelSpan.className = 'gd-m-dock-label';
    labelSpan.textContent = t.label;

    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);
    btn.addEventListener('click', () => props.onSelectTab(t.id));
    pillDock.appendChild(btn);
  });

  const actionCircle = document.createElement('button');
  actionCircle.type = 'button';
  actionCircle.className = `gd-m-dock-circle ${activeTab === 'settings' ? 'active' : ''}`;
  actionCircle.setAttribute('aria-label', 'Settings and pair ward');
  actionCircle.appendChild(createIcon('settings'));
  actionCircle.addEventListener('click', () => {
    props.onSelectTab(activeTab === 'settings' ? 'queue' : 'settings');
  });

  dockWrap.appendChild(pillDock);
  dockWrap.appendChild(actionCircle);
  shell.appendChild(dockWrap);

  return shell;
}
