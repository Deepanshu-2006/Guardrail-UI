/**
 * Guardrail Trusted-Contact Dashboard - Pending Approvals Component
 *
 * Editorial, Human-Centric Pending Approvals Redesign:
 * - Single-column focused layout replacing the dense two-column debugging inspector.
 * - Human-first information hierarchy: Requester identity, primary action hero title, website, and expiration.
 * - Direct decision controls: Deep forest green Approve Request and muted ruby Reject Request buttons.
 * - Deliberate inline two-step confirmation flow with high-impact warnings and optional reviewer notes.
 * - Optional "View Request Details" drawer with human-friendly context (page title, plain-language risk reason)
 *   and tucked developer audit metadata.
 * - Clean, reassuring empty state: "You're all caught up."
 * - Full architectural invariant preservation and strict backend synchronization.
 */

import { ApprovalRequest, ApprovalStatus, RequestFilters, RiskLevel, ViewStatus } from '../types.js';
import { renderDecisionConfirmation } from './decision-confirmation.js';
import { formatExpirationInfo, formatTimestamp, getRiskLevelExplanation, isRequestExpired } from './detail.js';
import { filterRequests, renderFilterBar, renderFilterEmptyState, renderWardSwitcher } from './filters.js';
import { createIcon, populateWardAvatar, setAnimatedHeading } from './icons.js';

export interface PendingApprovalsProps {
  requests: readonly ApprovalRequest[];
  selectedRequestId: string | null;
  selectedRequestDetail?: ApprovalRequest | null;
  isDetailLoading?: boolean;
  detailErrorMessage?: string | null;
  status: ViewStatus;
  errorMessage?: string | null;
  onRequestSelect: (requestId: string) => void;
  onRefresh?: () => void;
  onRefreshDetail?: () => void;
  /** Whether an approval decision is actively being submitted to the backend */
  isSubmittingDecision?: boolean;
  /** Error message resulting from a failed decision attempt */
  decisionErrorMessage?: string | null;
  /** Success message resulting from a confirmed decision attempt */
  decisionSuccessMessage?: string | null;
  /** Callback invoked when the user confirms their decision */
  onDecisionSubmit?: (decision: 'APPROVED' | 'REJECTED', reason?: string, targetId?: string) => void | Promise<unknown>;
  /** Current filter settings */
  filters?: RequestFilters;
  /** Callback when user changes filter settings */
  onFiltersChange?: (filters: RequestFilters) => void;
  /** Whether displayed requests are cached/stale due to recent sync failure */
  isStale?: boolean;
  /** Whether the Pending Approvals view is currently the active visible view */
  isActive?: boolean;
  /** Whether backend service is confirmed unreachable or in error */
  isBackendUnavailable?: boolean;
  /** Timestamp of last successful synchronization */
  lastSynchronizedAt?: Date | null;
  /** Whether refresh is currently in progress */
  isRefreshing?: boolean;
  /** List of connected wards for multi-ward switching and attribution */
  connectedWards?: readonly { id: string; name: string; email?: string; imageUrl?: string; avatarUrl?: string }[];
}

/**
 * Resolves human-friendly display name for a ward ID using connected wards when available.
 */
function formatWardDisplayName(
  requesterId?: string,
  connectedWards?: readonly { id: string; name: string; email?: string }[]
): string {
  if (!requesterId || typeof requesterId !== 'string') return 'Your ward';
  const matched = connectedWards?.find((w) => w.id.toLowerCase() === requesterId.toLowerCase());
  if (matched?.name && matched.name.trim()) {
    return matched.name.trim();
  }
  const clean = requesterId.replace(/^usr_/, '').trim();
  if (!clean) return 'Your ward';
  if (clean.toLowerCase().includes('deepanshukhatri')) return 'Deepanshu Khatri';
  const alphaOnly = clean.replace(/[0-9]+$/, '');
  if (alphaOnly.length >= 3) {
    return alphaOnly
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[._-]/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
      .join(' ');
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Resolves a human-readable action category label.
 */
function formatFriendlyCategory(category?: string): string {
  if (!category || typeof category !== 'string') return 'External navigation';
  const cat = category.toUpperCase().trim();
  if (cat.includes('NAVIGATION') || cat.includes('URL') || cat.includes('LINK')) return 'External navigation';
  if (cat.includes('FORM') || cat.includes('SUBMIT')) return 'Form submission';
  if (cat.includes('TRANSFER') || cat.includes('WIRE') || cat.includes('FINANCE')) return 'Financial transfer';
  if (cat.includes('DOWNLOAD') || cat.includes('EXPORT')) return 'File transfer';
  if (cat.includes('AUTH') || cat.includes('LOGIN')) return 'Authentication action';
  if (cat.includes('SETTINGS') || cat.includes('CONFIG') || cat.includes('PRIVILEGE')) return 'Settings modification';
  return 'Browsing action';
}

/**
 * Safely extracts a display hostname from hostname or origin URL.
 */
function resolveSafeHostname(request: ApprovalRequest): string {
  if (request.hostname && typeof request.hostname === 'string' && request.hostname.trim()) {
    return request.hostname.trim();
  }
  if (request.origin && typeof request.origin === 'string' && request.origin.trim()) {
    try {
      const parsed = new URL(request.origin.trim());
      if (parsed.hostname) return parsed.hostname;
    } catch {
      return request.origin.trim();
    }
  }
  return 'Local application';
}

/**
 * Cleans long SEO or repetitive page titles into a concise brand or page context tag.
 */
function formatCleanPageTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  const trimmed = rawTitle.trim();
  // Split on pipe, dash, or hyphen commonly used in web page title meta tags
  const segments = trimmed.split(/\s*[|—–-]\s*/).map(s => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    const brand = segments[segments.length - 1];
    if (brand && brand.length <= 25 && !brand.toLowerCase().includes('banking services') && !brand.toLowerCase().includes('online')) {
      return brand;
    }
    const first = segments[0];
    return first.length > 32 ? first.slice(0, 30) + '…' : first;
  }
  return trimmed.length > 35 ? trimmed.slice(0, 32) + '…' : trimmed;
}

/**
 * Generates a human-understandable explanation of why this action was flagged.
 */
function getHumanReadableRiskExplanation(request: ApprovalRequest): string {
  const wardName = formatWardDisplayName(request.requesterId);
  const hostname = resolveSafeHostname(request);
  const cat = (request.category || '').toUpperCase();
  const desc = (request.actionDescription || '').toLowerCase();
  const riskLevel = request.riskLevel || RiskLevel.LOW;

  if (cat.includes('TRANSFER') || desc.includes('wire') || desc.includes('transfer') || desc.includes('pay')) {
    return `This action initiates an irreversible transfer of funds on ${hostname}.`;
  }
  if (cat.includes('NAVIGATION') || desc.includes('click') || desc.includes('navigat')) {
    return `This action will navigate ${wardName} away from the currently trusted website to ${hostname}.`;
  }
  if (riskLevel === RiskLevel.CRITICAL) {
    return `This action involves high operational impact and irreversible state changes on ${hostname}.`;
  }
  if (request.riskReasons && Array.isArray(request.riskReasons) && request.riskReasons.length > 0 && request.riskReasons[0]) {
    return request.riskReasons[0];
  }
  return `This action on ${hostname} requires your explicit review to safeguard ${wardName}'s browsing session.`;
}

/**
 * Wraps each character into an animated span for fluid typewriter entrance (no pill wrapper).
 */
function renderActionTypewriterText(phrase: string, baseDelayMs: number = 30): string {
  return phrase
    .split('')
    .map((char, i) => {
      const delay = baseDelayMs + i * 22;
      const display = char === ' ' ? '&nbsp;' : char;
      return `<span class="gd-type-char" style="animation-delay: ${delay}ms;">${display}</span>`;
    })
    .join('');
}

/**
 * Renders an animated circular risk gauge chart with score and human-readable breakdown.
 */
function renderRiskCircularChart(request: ApprovalRequest): HTMLElement {
  const container = document.createElement('div');
  container.className = 'gd-risk-visual-card';

  const riskLevel = request.riskLevel || RiskLevel.LOW;
  const riskClass = riskLevel.toLowerCase();

  // Compute canonical score (0-100)
  let score = typeof request.riskScore === 'number' ? Math.round(request.riskScore) : 15;
  if (typeof request.riskScore !== 'number') {
    if (riskLevel === RiskLevel.CRITICAL) score = 92;
    else if (riskLevel === RiskLevel.HIGH) score = 75;
    else if (riskLevel === RiskLevel.MEDIUM) score = 45;
    else score = 15;
  }

  // Radius = 30, Circumference = 2 * PI * 30 ≈ 188.50
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const chartWrap = document.createElement('div');
  chartWrap.className = 'gd-risk-chart-wrap';

  chartWrap.innerHTML = `
    <svg class="gd-risk-circular-svg" width="76" height="76" viewBox="0 0 76 76" role="img" aria-label="Risk Score: ${score} out of 100 (${riskLevel})">
      <defs>
        <linearGradient id="gd-risk-grad-low" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#4F7A36"/>
          <stop offset="100%" stop-color="#284617"/>
        </linearGradient>
        <linearGradient id="gd-risk-grad-medium" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#D98E18"/>
          <stop offset="100%" stop-color="#995E05"/>
        </linearGradient>
        <linearGradient id="gd-risk-grad-high" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#DE5331"/>
          <stop offset="100%" stop-color="#A8280D"/>
        </linearGradient>
        <linearGradient id="gd-risk-grad-critical" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#C73838"/>
          <stop offset="100%" stop-color="#781414"/>
        </linearGradient>
      </defs>
      <circle
        class="gd-risk-circle-bg"
        cx="38"
        cy="38"
        r="${radius}"
        fill="transparent"
        stroke="rgba(39, 49, 33, 0.09)"
        stroke-width="5"
      />
      <circle
        class="gd-risk-circle-fill ${riskClass}"
        cx="38"
        cy="38"
        r="${radius}"
        fill="transparent"
        stroke="url(#gd-risk-grad-${riskClass})"
        stroke-width="5"
        stroke-linecap="round"
        stroke-dasharray="${circumference.toFixed(1)}"
        stroke-dashoffset="${circumference.toFixed(1)}"
        style="--target-offset: ${offset.toFixed(1)};"
      />
    </svg>
    <div class="gd-risk-chart-center">
      <span class="gd-risk-chart-score">${score}</span>
      <span class="gd-risk-chart-max">/100</span>
    </div>
  `;

  const infoWrap = document.createElement('div');
  infoWrap.className = 'gd-risk-chart-info';

  const levelTag = document.createElement('div');
  levelTag.className = `gd-risk-level-tag ${riskClass}`;
  levelTag.innerHTML = `
    <span class="gd-risk-tag-dot" aria-hidden="true"></span>
    <span class="gd-risk-tag-text">${riskLevel} RISK</span>
  `;

  const plainText = document.createElement('p');
  plainText.className = 'gd-risk-explanation';
  plainText.textContent = getHumanReadableRiskExplanation(request);

  infoWrap.appendChild(levelTag);
  infoWrap.appendChild(plainText);

  container.appendChild(chartWrap);
  container.appendChild(infoWrap);

  return container;
}

/**
 * Renders the redesigned Pending Approvals view.
 */
let lastPendingListAnimationKey: string | null = null;

export function renderPendingApprovals(props: PendingApprovalsProps): HTMLElement {
  const section = document.createElement('section');
  section.id = 'view-pending';
  section.className = 'gd-view-section gd-pending-redesign';
  section.setAttribute('aria-labelledby', 'pending-title');

  // 1. Page Header (Editorial, Unboxed, Minimal)
  const header = document.createElement('header');
  header.className = 'gd-section-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'gd-section-title-group';

  const titleRow = document.createElement('div');
  titleRow.className = 'gd-pending-title-row';

  const title = document.createElement('h1');
  title.id = 'pending-title';
  title.className = 'gd-section-title';
  setAnimatedHeading(title, 'Pending Approvals');
  titleRow.appendChild(title);

  titleGroup.appendChild(titleRow);
  header.appendChild(titleGroup);

  // Header Actions (Sync time & Refresh button)
  const headerActions = document.createElement('div');
  headerActions.className = 'gd-pending-header-actions';

  if (props.lastSynchronizedAt) {
    const syncTime = document.createElement('span');
    syncTime.className = 'gd-last-sync-time';
    syncTime.setAttribute('aria-live', 'polite');
    const timeStr = props.lastSynchronizedAt.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    syncTime.textContent = `Last synced: ${timeStr}`;
    headerActions.appendChild(syncTime);
  }

  if (props.onRefresh) {
    const isBusy = props.status === 'loading' || Boolean(props.isRefreshing);
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'gd-btn-refresh';
    refreshBtn.setAttribute('aria-label', 'Refresh pending approval requests');
    if (isBusy) {
      refreshBtn.disabled = true;
      refreshBtn.setAttribute('aria-busy', 'true');
    }
    const refreshIcon = document.createElement('span');
    refreshIcon.className = `gd-icon ${isBusy ? 'gd-spin' : ''}`;
    refreshIcon.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
      </svg>
    `;
    const refreshText = document.createElement('span');
    refreshText.textContent = isBusy ? 'Refreshing...' : 'Refresh';
    refreshBtn.appendChild(refreshIcon);
    refreshBtn.appendChild(refreshText);

    let refreshClicked = false;
    refreshBtn.addEventListener('click', () => {
      if (refreshClicked || isBusy) return;
      refreshClicked = true;
      props.onRefresh?.();
      setTimeout(() => {
        refreshClicked = false;
      }, 800);
    });
    headerActions.appendChild(refreshBtn);
  }

  header.appendChild(headerActions);
  section.appendChild(header);

  // Stale Data Notice (if backend is offline but cached records exist)
  const isStaleData = Boolean((props.isStale || props.status === 'error') && props.requests.length > 0);
  if (isStaleData) {
    const staleBanner = document.createElement('div');
    staleBanner.className = 'gd-stale-banner';
    staleBanner.setAttribute('role', 'alert');

    const staleIcon = document.createElement('span');
    staleIcon.className = 'gd-error-icon';
    staleIcon.setAttribute('aria-hidden', 'true');

    const staleText = document.createElement('span');
    staleText.className = 'gd-stale-text';
    const cachedTimeStr = props.lastSynchronizedAt
      ? ` (${props.lastSynchronizedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`
      : '';
    staleText.textContent = `Displaying cached records${cachedTimeStr}. Backend service is currently unreachable; records may be out of date.`;

    staleBanner.appendChild(staleIcon);
    staleBanner.appendChild(staleText);
    section.appendChild(staleBanner);
  }

  // Error Banner (if error state)
  if (props.status === 'error' && props.errorMessage) {
    const errorBanner = document.createElement('div');
    errorBanner.className = 'gd-error-banner';
    errorBanner.setAttribute('role', 'alert');

    const errorContent = document.createElement('div');
    errorContent.className = 'gd-error-content';

    const icon = document.createElement('span');
    icon.className = 'gd-error-icon';
    icon.setAttribute('aria-hidden', 'true');

    const errorText = document.createElement('span');
    errorText.className = 'gd-error-text';
    errorText.textContent = props.errorMessage;

    errorContent.appendChild(icon);
    errorContent.appendChild(errorText);
    errorBanner.appendChild(errorContent);

    if (props.onRefresh) {
      let isRetrying = false;
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
        if (isRetrying || props.status === 'loading' || props.isRefreshing) return;
        isRetrying = true;
        retryBtn.disabled = true;
        props.onRefresh?.();
      });
      errorBanner.appendChild(retryBtn);
    }

    section.appendChild(errorBanner);
  }

  // 2. Main Approvals Area (Two-Pane Master-Detail Workspace)
  const layout = document.createElement('div');
  layout.className = 'gd-approvals-layout';

  const listPane = document.createElement('div');
  listPane.className = 'gd-list-pane';
  listPane.setAttribute('role', 'region');
  listPane.setAttribute('aria-label', 'Pending Requests');

  // Prominent Decision Success / Error Banners (Rendered in listPane so querySelector finds them)
  if (props.decisionErrorMessage) {
    const dErrBanner = document.createElement('div');
    dErrBanner.className = 'gd-decision-error-banner';
    dErrBanner.setAttribute('role', 'alert');
    dErrBanner.style.background = 'transparent';
    dErrBanner.style.backgroundColor = 'transparent';
    dErrBanner.style.border = 'none';
    dErrBanner.style.borderLeft = '2.5px solid #8F2B2B';
    dErrBanner.style.borderRadius = '0';
    dErrBanner.style.boxShadow = 'none';
    dErrBanner.style.padding = '4px 0 4px 12px';
    dErrBanner.style.marginBottom = '16px';

    const dErrIcon = document.createElement('span');
    dErrIcon.className = 'gd-error-icon';
    dErrIcon.setAttribute('aria-hidden', 'true');

    const dErrText = document.createElement('span');
    dErrText.className = 'gd-decision-error-text';
    dErrText.textContent = props.decisionErrorMessage;
    dErrText.style.color = '#8F2B2B';
    dErrText.style.fontFamily = 'var(--gd-font-sans)';
    dErrText.style.fontSize = '12.5px';
    dErrText.style.fontWeight = '500';
    dErrText.style.lineHeight = '1.45';

    dErrBanner.appendChild(dErrIcon);
    dErrBanner.appendChild(dErrText);
    listPane.appendChild(dErrBanner);
  }

  // NOTE: Duplicate left banner removed. The unified Decision Moment experience is
  // exclusively rendered in the main dashboard workspace after server confirmation.

  // DECISION MOMENT: Centered in main dashboard workspace ONLY after server confirmation
  // Removes all other request cards, queues, and controls for a pure, serene decision moment.
  const isDecisionConfirmed = Boolean(props.decisionSuccessMessage) && !props.decisionErrorMessage;

  if (isDecisionConfirmed) {
    section.classList.add('gd-decision-moment-active');
    const isApproved = props.decisionSuccessMessage?.includes('APPROVED') ?? true;
    const resolvedReq =
      props.selectedRequestDetail ||
      (props.selectedRequestId ? props.requests.find((r) => r.id === props.selectedRequestId) : null) ||
      props.requests[0] ||
      ({
        id: props.selectedRequestId || 'req_decided',
        actionDescription: 'Authorized Browser Action',
        actionType: 'CLICK',
        category: 'GENERAL',
        riskLevel: 'LOW',
        status: isApproved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      } as unknown as ApprovalRequest);

    const centerStage = document.createElement('div');
    centerStage.className = 'gd-decision-moment-stage';

    const decisionMoment = renderDecisionConfirmation({
      request: resolvedReq,
      decision: isApproved ? 'APPROVED' : 'REJECTED',
      decidedAt: resolvedReq.resolvedAt || resolvedReq.decision?.decidedAt || new Date(),
    });

    centerStage.appendChild(decisionMoment);
    section.appendChild(centerStage);
    return section;
  }

  const activeFilters: RequestFilters = props.filters ?? {
    status: 'ALL',
    riskLevel: 'ALL',
    dateRange: 'ALL',
    searchQuery: '',
  };

  // State A: Loading State
  if (props.status === 'loading') {
    layout.classList.add('gd-approvals-layout-empty');

    const skeletonCard = document.createElement('div');
    skeletonCard.className = 'gd-request-card gd-skeleton-loading';
    skeletonCard.setAttribute('role', 'status');
    skeletonCard.setAttribute('aria-busy', 'true');
    skeletonCard.setAttribute('aria-label', 'Loading pending requests');

    const s1 = document.createElement('div');
    s1.className = 'gd-skeleton gd-skeleton-line short';
    const s2 = document.createElement('div');
    s2.className = 'gd-skeleton gd-skeleton-line';
    const s3 = document.createElement('div');
    s3.className = 'gd-skeleton gd-skeleton-line short';

    skeletonCard.appendChild(s1);
    skeletonCard.appendChild(s2);
    skeletonCard.appendChild(s3);
    listPane.appendChild(skeletonCard);

    layout.appendChild(listPane);
    layout.appendChild(renderProtocolSidebar());
  } else if (props.status === 'error' && props.requests.length === 0) {
    // State B: Backend Unavailable or Load Failure (Empty List)
    layout.classList.add('gd-approvals-layout-empty');

    const errorPlaceholder = document.createElement('div');
    errorPlaceholder.className = 'gd-placeholder gd-error-placeholder';

    const icon = document.createElement('div');
    icon.className = 'gd-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');

    const pTitle = document.createElement('h2');
    pTitle.className = 'gd-placeholder-title';
    pTitle.textContent = props.isBackendUnavailable
      ? 'Approval Backend Unavailable'
      : 'Unable to Load Approval Requests';

    const pText = document.createElement('p');
    pText.className = 'gd-placeholder-text';
    pText.textContent =
      props.errorMessage ||
      'A network or service failure prevented retrieving pending requests. Local safety isolation is maintained.';

    errorPlaceholder.appendChild(icon);
    errorPlaceholder.appendChild(pTitle);
    errorPlaceholder.appendChild(pText);

    if (props.onRefresh) {
      let isRetrying = false;
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-retry';
      retryBtn.textContent = 'Retry Connection';
      retryBtn.addEventListener('click', () => {
        if (isRetrying || props.status === 'loading' || props.isRefreshing) return;
        isRetrying = true;
        retryBtn.disabled = true;
        props.onRefresh?.();
      });
      errorPlaceholder.appendChild(retryBtn);
    }
    listPane.appendChild(errorPlaceholder);

    layout.appendChild(listPane);
    layout.appendChild(renderProtocolSidebar());
  } else {
    // Combine pending requests with selectedRequestDetail if provided (e.g. freshly resolved or remote load)
    const displayRequests: ApprovalRequest[] = [...props.requests];
    if (
      props.selectedRequestDetail &&
      !displayRequests.some((r) => r.id === props.selectedRequestDetail!.id)
    ) {
      displayRequests.unshift(props.selectedRequestDetail);
    }

    if (displayRequests.length === 0) {
      // State C: Genuinely Empty State ("No Pending Approval Requests")
      layout.classList.add('gd-approvals-layout-empty');

      const emptyPlaceholder = document.createElement('div');
      emptyPlaceholder.className = 'gd-placeholder gd-empty-state';
      emptyPlaceholder.setAttribute('role', 'status');

      const iconWrap = document.createElement('div');
      iconWrap.className = 'gd-empty-icon';
      iconWrap.setAttribute('aria-hidden', 'true');
      iconWrap.appendChild(createIcon('inbox', 'gd-empty-icon-svg'));

      const emptyHeadline = document.createElement('h2');
      emptyHeadline.className = 'gd-empty-title gd-placeholder-title';
      emptyHeadline.textContent = 'No Pending Approval Requests';

      const emptyDesc = document.createElement('p');
      emptyDesc.className = 'gd-empty-desc gd-placeholder-text';
      emptyDesc.textContent = 'All actions have been evaluated. You are completely caught up.';

      emptyPlaceholder.appendChild(iconWrap);
      emptyPlaceholder.appendChild(emptyHeadline);
      emptyPlaceholder.appendChild(emptyDesc);
      listPane.appendChild(emptyPlaceholder);

      layout.appendChild(listPane);
      layout.appendChild(renderProtocolSidebar());
    } else {
      // State D: Filterable Approval Items List
      const filteredRequests = filterRequests(displayRequests, activeFilters);
      const useFullWidthControls = Boolean(props.connectedWards && props.connectedWards.length > 2);
      const controlsTarget = useFullWidthControls ? document.createElement('div') : listPane;
      if (useFullWidthControls) {
        controlsTarget.className = 'gd-fullwidth-controls-bar';
      }

      // Multi-Ward Switcher Pill Strip (rendered if multiple wards connected)
      if (props.connectedWards && props.connectedWards.length > 1) {
        const wardSwitcher = renderWardSwitcher({
          wards: props.connectedWards,
          activeWardId: activeFilters.wardId || 'ALL',
          requests: displayRequests,
          contextKey: 'pending',
          onSelectWard: (selectedWardId) => {
            props.onFiltersChange?.({
              ...activeFilters,
              wardId: selectedWardId,
            });
          },
        });
        controlsTarget.appendChild(wardSwitcher);
      }

      // Filter Bar (rendered if multiple requests or active filter)
      if (displayRequests.length > 2 || activeFilters.searchQuery || activeFilters.riskLevel !== 'ALL' || (activeFilters.wardId && activeFilters.wardId !== 'ALL')) {
        const filterBar = renderFilterBar({
          filters: activeFilters,
          totalCount: displayRequests.length,
          filteredCount: filteredRequests.length,
          showStatusFilter: false,
          showRiskFilter: true,
          showDateFilter: true,
          showWardFilter: Boolean(props.connectedWards && props.connectedWards.length > 1),
          connectedWards: props.connectedWards,
          searchPlaceholder: 'Search pending requests...',
          onFiltersChange: (newFilters) => {
            props.onFiltersChange?.(newFilters);
          },
        });
        controlsTarget.appendChild(filterBar);
      }

      if (useFullWidthControls && controlsTarget.children.length > 0) {
        section.appendChild(controlsTarget);
      }

      if (filteredRequests.length === 0) {
        const emptyFilter = renderFilterEmptyState({
          title: 'No Matching Pending Requests',
          description: 'No pending requests match the current search criteria. Try clearing your filters.',
          onClearFilters: () => {
            props.onFiltersChange?.({
              status: 'ALL',
              riskLevel: 'ALL',
              dateRange: 'ALL',
              wardId: 'ALL',
              searchQuery: '',
            });
          },
        });
        listPane.appendChild(emptyFilter);
        layout.classList.add('gd-approvals-layout-empty');
        layout.appendChild(listPane);
        layout.appendChild(renderProtocolSidebar());
      } else {
        // Find selected request
        const selectedBaseReq = (props.selectedRequestId && filteredRequests.find(r => r.id === props.selectedRequestId))
          || filteredRequests[0];
        const selectedReq = (props.selectedRequestDetail && props.selectedRequestDetail.id === selectedBaseReq?.id)
          ? { ...selectedBaseReq, ...props.selectedRequestDetail }
          : selectedBaseReq;

        const pendingListAnimKey = `${activeFilters.wardId || 'ALL'}|${activeFilters.riskLevel}|${activeFilters.dateRange}|${activeFilters.searchQuery}|${filteredRequests.map((r) => r.id).join(',')}`;
        let shouldAnimateList = false;
        if (props.isActive === false) {
          lastPendingListAnimationKey = null;
        } else {
          shouldAnimateList = pendingListAnimKey !== lastPendingListAnimationKey;
          lastPendingListAnimationKey = pendingListAnimKey;
        }
        if (shouldAnimateList) {
          listPane.classList.add('gd-list-animating-in');
        }

        // Render Left Column: Clean List Header & Minimal Numbered Rows
        const listHeader = document.createElement('div');
        listHeader.className = 'gd-list-header';

        const listKicker = document.createElement('span');
        listKicker.className = 'gd-list-kicker';
        const qCount = filteredRequests.length;
        listKicker.textContent = `Queue (${qCount})`;

        listHeader.appendChild(listKicker);
        listPane.appendChild(listHeader);

        filteredRequests.forEach((baseReq, index) => {
          const req = (props.selectedRequestDetail && props.selectedRequestDetail.id === baseReq.id)
            ? { ...baseReq, ...props.selectedRequestDetail }
            : baseReq;

          const isSelected = selectedReq && req.id === selectedReq.id;
          const isExpired = isRequestExpired(req);
          const wardName = formatWardDisplayName(req.requesterId, props.connectedWards);
          const hostname = resolveSafeHostname(req);
          const riskLevel = req.riskLevel || RiskLevel.LOW;
          const riskClass = riskLevel.toLowerCase();

          const isResolvedTransition = req.status && req.status !== ApprovalStatus.PENDING;
          const card = document.createElement('article');
          card.className = `gd-request-card ${shouldAnimateList ? 'gd-card-animating-in' : ''} ${isSelected ? 'selected' : ''} ${isExpired ? 'is-expired' : ''} ${isResolvedTransition ? 'is-resolving-transition' : ''}`.trim();
          if (typeof card.style?.setProperty === 'function') {
            card.style.setProperty('--card-idx', String(index));
          } else if (card.style) {
            (card.style as any)['--card-idx'] = String(index);
          }
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
          card.setAttribute('aria-label', `Review request ${req.id}: ${req.actionDescription}`);

          // 1. Numbering prefix (01, 02, etc.)
          const numStr = (index + 1) < 10 ? `0${index + 1}` : String(index + 1);
          const numEl = document.createElement('span');
          numEl.className = 'gd-request-num';
          numEl.textContent = numStr;
          numEl.setAttribute('aria-hidden', 'true');
          card.appendChild(numEl);

          // 2. Main content container (Title row + Minimal subheading)
          const contentWrapper = document.createElement('div');
          contentWrapper.className = 'gd-request-item-content';

          // Title Row: Action Description + Risk Badge
          const titleRow = document.createElement('div');
          titleRow.className = 'gd-request-title-row';

          const actionTitle = document.createElement('h3');
          actionTitle.className = 'gd-request-description';
          actionTitle.textContent = req.actionDescription;
          titleRow.appendChild(actionTitle);

          const badgesWrap = document.createElement('div');
          badgesWrap.className = 'gd-pending-card-badges';

          if (isExpired) {
            const expBadge = document.createElement('span');
            expBadge.className = 'gd-status-badge expired';
            expBadge.textContent = 'EXPIRED';
            badgesWrap.appendChild(expBadge);
          } else if (req.status && req.status !== ApprovalStatus.PENDING) {
            const statusBadge = document.createElement('span');
            statusBadge.className = `gd-status-badge ${req.status.toLowerCase()}`;
            statusBadge.textContent = req.status;
            badgesWrap.appendChild(statusBadge);
          }

          const riskBadge = document.createElement('span');
          riskBadge.className = `gd-risk-badge ${riskClass}`;
          riskBadge.textContent = riskLevel;
          badgesWrap.appendChild(riskBadge);

          titleRow.appendChild(badgesWrap);
          contentWrapper.appendChild(titleRow);

          const cardWardLine = document.createElement('div');
          cardWardLine.className = 'gd-card-ward-badge gd-card-ward-line';
          const badgeName = document.createElement('span');
          badgeName.className = 'gd-ward-badge-name gd-requester-name';
          badgeName.textContent = wardName;
          cardWardLine.appendChild(badgeName);
          contentWrapper.appendChild(cardWardLine);

          // Subheading: Clean, minimal single-line context (Domain · Expiration)
          const subheading = document.createElement('p');
          subheading.className = 'gd-request-subheading';

          const hostSpan = document.createElement('span');
          hostSpan.className = 'gd-context-hostname';
          hostSpan.textContent = hostname;
          subheading.appendChild(hostSpan);

          if (req.expiresAt) {
            const expInfo = formatExpirationInfo(req.expiresAt);
            const sep2 = document.createElement('span');
            sep2.className = 'gd-subheading-sep';
            sep2.setAttribute('aria-hidden', 'true');
            sep2.textContent = '·';
            subheading.appendChild(sep2);

            const expSpan = document.createElement('span');
            expSpan.className = expInfo.isPast ? 'gd-card-meta-expired' : 'gd-card-meta-expires';
            expSpan.textContent = expInfo.isPast
              ? 'Expired'
              : `Expires: ${new Date(req.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            subheading.appendChild(expSpan);
          }

          contentWrapper.appendChild(subheading);
          card.appendChild(contentWrapper);

          // Card Selection Handler (Click & Keyboard)
          const selectAction = () => {
            props.onRequestSelect(req.id);
          };

          card.addEventListener('click', selectAction);
          card.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e?.preventDefault?.();
              selectAction();
            }
          });

          listPane.appendChild(card);
        });

        // Render Right Column: Top Decision & Inspection Box + Protocols Below
        if (selectedReq) {
          const isExpired = isRequestExpired(selectedReq);
          const hostname = resolveSafeHostname(selectedReq);
          const riskLevel = selectedReq.riskLevel || RiskLevel.LOW;

          const detailPane = document.createElement('div');
          detailPane.className = 'gd-detail-pane gd-decision-dossier-box gd-detail-animating-in';
          detailPane.setAttribute('role', 'region');
          detailPane.setAttribute('aria-label', `Review and decide on ${selectedReq.actionDescription}`);

          // 1. Decision Dossier Header
          const dossierHeader = document.createElement('div');
          dossierHeader.className = 'gd-detail-dossier-header';

          const detailTitleEl = document.createElement('h3');
          detailTitleEl.className = 'gd-detail-title';
          detailTitleEl.textContent = selectedReq.actionDescription;
          dossierHeader.appendChild(detailTitleEl);

          const headerMeta = document.createElement('div');
          headerMeta.className = 'gd-detail-header-meta';

          const hostEl = document.createElement('span');
          hostEl.className = 'gd-context-hostname';
          hostEl.textContent = hostname;
          headerMeta.appendChild(hostEl);

          if (selectedReq.pageTitle) {
            const metaSep = document.createElement('span');
            metaSep.className = 'gd-meta-sep';
            metaSep.textContent = '·';
            metaSep.setAttribute('aria-hidden', 'true');
            headerMeta.appendChild(metaSep);

            const titleSpan = document.createElement('span');
            titleSpan.className = 'gd-page-title-label';
            titleSpan.textContent = formatCleanPageTitle(selectedReq.pageTitle);
            titleSpan.title = selectedReq.pageTitle;
            headerMeta.appendChild(titleSpan);
          }

          const metaSep2 = document.createElement('span');
          metaSep2.className = 'gd-meta-sep';
          metaSep2.textContent = '·';
          metaSep2.setAttribute('aria-hidden', 'true');
          headerMeta.appendChild(metaSep2);

          const displayStatus = isExpired && selectedReq.status === ApprovalStatus.PENDING ? ApprovalStatus.EXPIRED : (selectedReq.status || ApprovalStatus.PENDING);
          const statusPill = document.createElement('span');
          const sClass = displayStatus.toLowerCase();
          statusPill.className = `gd-detail-status-pill ${sClass}`;
          statusPill.setAttribute('role', 'status');
          statusPill.setAttribute('data-status', sClass);
          statusPill.textContent = displayStatus;
          headerMeta.appendChild(statusPill);

          dossierHeader.appendChild(headerMeta);
          detailPane.appendChild(dossierHeader);

          // 2. Visual Risk Assessment Widget (Circular Animated Chart & Concise Human Reasons)
          const riskWidget = renderRiskCircularChart(selectedReq);
          detailPane.appendChild(riskWidget);

          // 3. Decision Controls (Approve & Reject Buttons + Confirmation Flows)
          const decisionControlsContainer = document.createElement('div');
          decisionControlsContainer.className = 'gd-decision-controls-container';

          if (props.isBackendUnavailable) {
            const unavailNotice = document.createElement('div');
            unavailNotice.className = 'gd-decision-error-banner gd-backend-offline-banner';
            unavailNotice.setAttribute('role', 'alert');

            const unavailIcon = document.createElement('span');
            unavailIcon.className = 'gd-error-icon';
            unavailIcon.setAttribute('aria-hidden', 'true');

            const unavailText = document.createElement('span');
            unavailText.className = 'gd-decision-error-text';
            unavailText.textContent =
              'Backend Unavailable: Decisions cannot be committed while the approval service is unreachable. Please verify network connectivity and retry.';

            unavailNotice.appendChild(unavailIcon);
            unavailNotice.appendChild(unavailText);
            decisionControlsContainer.appendChild(unavailNotice);
          }

          let activeConfirmation: 'APPROVED' | 'REJECTED' | null = props.isSubmittingDecision ? 'APPROVED' : null;

          const renderDecisionControls = () => {
            const unavail = decisionControlsContainer.querySelector('.gd-backend-offline-banner');
            while (decisionControlsContainer.firstChild) {
              decisionControlsContainer.removeChild(decisionControlsContainer.firstChild);
            }
            if (unavail) {
              decisionControlsContainer.appendChild(unavail);
            }

            if (selectedReq.status && selectedReq.status !== ApprovalStatus.PENDING) {
              const notice = document.createElement('div');
              notice.className = 'gd-decision-resolved-conflict-note';
              notice.style.fontSize = '13px';
              notice.style.color = '#736D61';
              notice.style.fontFamily = 'var(--gd-font-sans)';
              notice.style.padding = '8px 0';
              notice.textContent = `This request has already been ${selectedReq.status.toLowerCase()}.`;
              decisionControlsContainer.appendChild(notice);
              return;
            }

            if (!activeConfirmation) {
              const btnGroup = document.createElement('div');
              btnGroup.className = 'gd-decision-btn-group';

              const approveBtn = document.createElement('button');
              approveBtn.type = 'button';
              approveBtn.className = 'gd-btn-decision gd-btn-approve';
              approveBtn.setAttribute('aria-label', `Approve request ${selectedReq.id}: ${selectedReq.actionDescription}`);

              const approveIcon = document.createElement('span');
              approveIcon.className = 'gd-btn-icon';
              approveIcon.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              `;
              const approveLabel = document.createElement('span');
              approveLabel.className = 'gd-btn-label';
              approveLabel.textContent = 'Approve Request';
              approveBtn.appendChild(approveIcon);
              approveBtn.appendChild(approveLabel);

              if (isExpired || props.isBackendUnavailable) {
                approveBtn.disabled = true;
                approveBtn.setAttribute('aria-disabled', 'true');
              }

              approveBtn.addEventListener('click', (e) => {
                e?.stopPropagation?.();
                activeConfirmation = 'APPROVED';
                renderDecisionControls();
              });

              const rejectBtn = document.createElement('button');
              rejectBtn.type = 'button';
              rejectBtn.className = 'gd-btn-decision gd-btn-reject';
              rejectBtn.setAttribute('aria-label', `Reject request ${selectedReq.id}: ${selectedReq.actionDescription}`);

              const rejectIcon = document.createElement('span');
              rejectIcon.className = 'gd-btn-icon';
              rejectIcon.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              `;
              const rejectLabel = document.createElement('span');
              rejectLabel.className = 'gd-btn-label';
              rejectLabel.textContent = 'Reject Request';
              rejectBtn.appendChild(rejectIcon);
              rejectBtn.appendChild(rejectLabel);

              if (isExpired || props.isBackendUnavailable) {
                rejectBtn.disabled = true;
                rejectBtn.setAttribute('aria-disabled', 'true');
              }

              rejectBtn.addEventListener('click', (e) => {
                e?.stopPropagation?.();
                activeConfirmation = 'REJECTED';
                renderDecisionControls();
              });

              btnGroup.appendChild(approveBtn);
              btnGroup.appendChild(rejectBtn);
              decisionControlsContainer.appendChild(btnGroup);
            } else {
              const isApprove = activeConfirmation === 'APPROVED';

              const confirmBox = document.createElement('div');
              confirmBox.className = `gd-decision-confirm-box ${isApprove ? 'confirm-approve' : 'confirm-reject'}`;
              confirmBox.setAttribute('role', 'group');
              confirmBox.setAttribute('aria-labelledby', 'gd-decision-confirm-title');

              confirmBox.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                  e?.stopPropagation?.();
                  activeConfirmation = null;
                  renderDecisionControls();
                  const returnBtn = detailPane.querySelector<HTMLButtonElement>(isApprove ? '.gd-btn-approve' : '.gd-btn-reject');
                  returnBtn?.focus();
                }
              });

              // Typographic animated action status line (Zero pill container, pure editorial typography)
              const statusLine = document.createElement('div');
              statusLine.className = `gd-confirm-status-line ${isApprove ? 'approve' : 'reject'}`;
              const actionPhrase = isApprove ? 'Approving Request' : 'Rejecting Request';
              statusLine.innerHTML = `
                <span class="gd-confirm-action-icon" aria-hidden="true">${isApprove ? '✓' : '✕'}</span>
                <span class="gd-confirm-action-phrase">${renderActionTypewriterText(actionPhrase)}</span>
                <span class="gd-confirm-dots" aria-hidden="true"><span class="gd-confirm-dot gd-dot-1">.</span><span class="gd-confirm-dot gd-dot-2">.</span><span class="gd-confirm-dot gd-dot-3">.</span></span>
              `;
              confirmBox.appendChild(statusLine);

              const confirmTitle = document.createElement('h4');
              confirmTitle.id = 'gd-decision-confirm-title';
              confirmTitle.className = 'gd-confirm-title';
              confirmTitle.setAttribute('tabindex', '-1');
              confirmTitle.textContent = isApprove ? 'Confirm Approval Decision' : 'Confirm Rejection Decision';
              confirmBox.appendChild(confirmTitle);

              const isHighImpact =
                riskLevel === RiskLevel.CRITICAL ||
                riskLevel === RiskLevel.HIGH ||
                (typeof selectedReq.riskScore === 'number' && selectedReq.riskScore >= 50);

              if (isHighImpact) {
                const warningBox = document.createElement('div');
                warningBox.className = 'gd-high-impact-warning';
                warningBox.setAttribute('role', 'alert');

                const wTitle = document.createElement('h5');
                wTitle.className = 'gd-warning-heading';
                wTitle.textContent = 'High-Impact Decision Warning';

                const wText = document.createElement('p');
                wText.className = 'gd-warning-desc';
                wText.textContent =
                  'Elevated operational risk. Your decision will be recorded in the audit log.';

                warningBox.appendChild(wTitle);
                warningBox.appendChild(wText);
                confirmBox.appendChild(warningBox);
              }

              const noteGroup = document.createElement('div');
              noteGroup.className = 'gd-confirm-field-group gd-confirm-note-group';

              const noteLabel = document.createElement('label');
              noteLabel.htmlFor = 'decision-reason-input';
              noteLabel.className = 'gd-confirm-field-label';

              const noteLabelText = document.createElement('span');
              noteLabelText.className = 'gd-field-label-text';
              noteLabelText.textContent = 'Reason or Notes ';

              const noteLabelOpt = document.createElement('span');
              noteLabelOpt.className = 'gd-field-optional';
              noteLabelOpt.textContent = '(Optional)';

              noteLabel.appendChild(noteLabelText);
              noteLabel.appendChild(noteLabelOpt);

              const noteInput = document.createElement('input');
              noteInput.type = 'text';
              noteInput.id = 'decision-reason-input';
              noteInput.className = 'gd-confirm-note-input gd-decision-note-input gd-decision-reason-input';
              noteInput.setAttribute('aria-label', 'Reason or notes for decision (optional)');
              noteInput.placeholder = isApprove
                ? 'e.g., Verified routine navigation to trusted series'
                : 'e.g., Unrecognized external site';

              noteGroup.appendChild(noteLabel);
              noteGroup.appendChild(noteInput);
              confirmBox.appendChild(noteGroup);

              const consequentialNotice = document.createElement('div');
              consequentialNotice.className = 'gd-consequential-notice';
              consequentialNotice.setAttribute('role', 'note');

              const cNoticeText = document.createElement('p');
              cNoticeText.textContent =
                'Consequential Decision Notice: Submitting commits this decision to the audit log and cannot be reversed or undone.';
              consequentialNotice.appendChild(cNoticeText);
              confirmBox.appendChild(consequentialNotice);

              const confirmActions = document.createElement('div');
              confirmActions.className = 'gd-confirm-actions-row';

              const submitBtn = document.createElement('button');
              submitBtn.type = 'button';
              submitBtn.className = `gd-btn-confirm-submit ${isApprove ? 'gd-btn-approve-confirm' : 'gd-btn-reject-confirm'}`;
              submitBtn.textContent = props.isSubmittingDecision
                ? 'Submitting...'
                : `Confirm ${isApprove ? 'Approval' : 'Rejection'}`;

              if (props.isSubmittingDecision) {
                submitBtn.disabled = true;
                submitBtn.setAttribute('aria-busy', 'true');
              }

              let submitted = false;
              submitBtn.addEventListener('click', (e) => {
                e?.stopPropagation?.();
                if (props.isSubmittingDecision || submitted) return;
                submitted = true;
                submitBtn.disabled = true;
                submitBtn.setAttribute('aria-busy', 'true');
                submitBtn.textContent = 'Submitting decision...';
                const reason = noteInput.value ? noteInput.value.trim() : undefined;
                void props.onDecisionSubmit?.(isApprove ? 'APPROVED' : 'REJECTED', reason, selectedReq.id);
              });

              const cancelBtn = document.createElement('button');
              cancelBtn.type = 'button';
              cancelBtn.className = 'gd-btn-cancel-confirm';
              cancelBtn.textContent = 'Cancel';
              cancelBtn.addEventListener('click', (e) => {
                e?.stopPropagation?.();
                activeConfirmation = null;
                renderDecisionControls();
                const returnBtn = detailPane.querySelector<HTMLButtonElement>(isApprove ? '.gd-btn-approve' : '.gd-btn-reject');
                returnBtn?.focus();
              });

              confirmActions.appendChild(submitBtn);
              confirmActions.appendChild(cancelBtn);
              confirmBox.appendChild(confirmActions);
              decisionControlsContainer.appendChild(confirmBox);

              if (!props.isSubmittingDecision) {
                confirmTitle.focus();
              }
            }
          };

          renderDecisionControls();
          detailPane.appendChild(decisionControlsContainer);

          // If Expired: review deadline elapsed banner
          if (isExpired && selectedReq.status === ApprovalStatus.PENDING) {
            const expiredBanner = document.createElement('div');
            expiredBanner.className = 'gd-status-banner expired';
            expiredBanner.setAttribute('role', 'status');

            const bannerContent = document.createElement('div');
            bannerContent.className = 'gd-status-banner-content';

            const bannerTitle = document.createElement('strong');
            bannerTitle.className = 'gd-status-banner-title';
            bannerTitle.textContent = 'Review Deadline Elapsed';

            const bannerDesc = document.createElement('p');
            bannerDesc.className = 'gd-status-banner-desc';
            bannerDesc.textContent =
              'The expiration deadline for this approval request has passed. Decisions can no longer be recorded. The extension will revalidate the local action state and require a fresh request if needed.';

            bannerContent.appendChild(bannerTitle);
            bannerContent.appendChild(bannerDesc);
            expiredBanner.appendChild(bannerContent);
            detailPane.appendChild(expiredBanner);
          }

          // 4. Compact Session Timestamps Bar
          const footerMeta = document.createElement('div');
          footerMeta.className = 'gd-detail-footer-bar';

          const timestampsInfo = document.createElement('div');
          timestampsInfo.className = 'gd-context-timestamps';

          const initSpan = document.createElement('span');
          initSpan.className = 'gd-timestamp-item gd-timestamp-init';
          initSpan.innerHTML = `<span class="gd-timestamp-label">Initiated At:</span> <span class="gd-timestamp-val">${formatTimestamp(selectedReq.createdAt)}</span>`;

          const timeSep = document.createElement('span');
          timeSep.className = 'gd-context-sep';
          timeSep.textContent = '·';
          timeSep.setAttribute('aria-hidden', 'true');

          const expSpan2 = document.createElement('span');
          expSpan2.className = 'gd-timestamp-item gd-timestamp-exp';
          const expFormatted = formatExpirationInfo(selectedReq.expiresAt);
          const expRelativeText = expFormatted.isPast ? 'Expired' : (expFormatted.text.includes('(') ? expFormatted.text.split(' (')[0] : expFormatted.text);
          expSpan2.innerHTML = `<span class="gd-timestamp-label">Expires At:</span> <span class="gd-timestamp-val">${formatTimestamp(selectedReq.expiresAt)}</span> <span class="gd-timestamp-countdown">(${expRelativeText})</span>`;

          timestampsInfo.appendChild(initSpan);
          timestampsInfo.appendChild(timeSep);
          timestampsInfo.appendChild(expSpan2);
          footerMeta.appendChild(timestampsInfo);
          detailPane.appendChild(footerMeta);

          // 5. Developer & Security Audit Trail Disclosure (Disclaimers and Decoupled Notices Tucked)
          const auditDetails = document.createElement('details');
          auditDetails.className = 'gd-technical-audit-details';

          const auditSummary = document.createElement('summary');
          auditSummary.className = 'gd-audit-summary';
          auditSummary.innerHTML = `
            <svg class="gd-audit-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <span>Audit trail and governance details</span>
          `;
          auditDetails.appendChild(auditSummary);

          const auditBody = document.createElement('div');
          auditBody.className = 'gd-audit-body';

          const idBadge = document.createElement('span');
          idBadge.className = 'gd-detail-id';
          idBadge.textContent = `Canonical Request ID: ${selectedReq.id}`;
          auditBody.appendChild(idBadge);

          const impactDesc = document.createElement('p');
          impactDesc.className = 'gd-risk-level-desc';
          impactDesc.textContent = getRiskLevelExplanation(riskLevel);
          auditBody.appendChild(impactDesc);

          const disclaimer = document.createElement('div');
          disclaimer.className = 'gd-risk-disclaimer';
          disclaimer.setAttribute('role', 'note');

          const disclaimerIcon = document.createElement('span');
          disclaimerIcon.className = 'gd-disclaimer-icon';
          disclaimerIcon.setAttribute('aria-hidden', 'true');

          const disclaimerText = document.createElement('p');
          disclaimerText.className = 'gd-disclaimer-text';
          disclaimerText.textContent =
            'Notice: Guardrail risk scores measure operational sensitivity, potential data loss, and security impact to safeguard users. A high or critical risk score reflects high operational stakes requiring verification, NOT that the website or action is confirmed to be malicious or fraudulent.';

          disclaimer.appendChild(disclaimerIcon);
          disclaimer.appendChild(disclaimerText);
          auditBody.appendChild(disclaimer);

          const decouplingBox = document.createElement('div');
          decouplingBox.className = 'gd-action-decoupling-note';
          decouplingBox.setAttribute('role', 'note');

          const decP = document.createElement('p');
          decP.textContent =
            'Approval decisions update this server record only. They do not execute or trigger an action in the ward’s browser. The extension must revalidate its local action state and require explicit user confirmation before any supported continuation.';
          decouplingBox.appendChild(decP);
          auditBody.appendChild(decouplingBox);

          const noticeBox = document.createElement('div');
          noticeBox.className = 'gd-decision-notice';
          noticeBox.setAttribute('role', 'note');

          const notP = document.createElement('p');
          notP.textContent =
            'Decoupled Execution Architecture: Approving this request records reviewer consent on the Guardrail backend. It does NOT remotely execute the action in the ward’s browser. The user retains sole continuation authority in Staging Mode.';
          noticeBox.appendChild(notP);
          auditBody.appendChild(noticeBox);

          if (selectedReq.riskReasons && Array.isArray(selectedReq.riskReasons) && selectedReq.riskReasons.length > 0) {
            const ul = document.createElement('ul');
            ul.className = 'gd-risk-reasons-list';
            for (const reason of selectedReq.riskReasons) {
              if (typeof reason === 'string' && reason.trim()) {
                const li = document.createElement('li');
                li.className = 'gd-risk-reason-item';
                li.textContent = reason.trim();
                ul.appendChild(li);
              }
            }
            auditBody.appendChild(ul);
          }

          auditDetails.appendChild(auditBody);
          detailPane.appendChild(auditDetails);

          layout.appendChild(listPane);
          layout.appendChild(detailPane);
          layout.appendChild(renderProtocolSidebar());
        }
      }
    }
  }

  section.appendChild(layout);
  return section;
}

/**
 * Renders the Companion Protocols & Oversight Sidebar.
 */
function renderProtocolSidebar(): HTMLElement {
  const sidePane = document.createElement('aside');
  sidePane.className = 'gd-pending-sidebar gd-pending-protocols-horizontal';
  sidePane.setAttribute('aria-label', 'Review Policies and Security Oversight');

  // Console Header
  const sideHeader = document.createElement('div');
  sideHeader.className = 'gd-sidebar-header';

  const sideHeaderLeft = document.createElement('div');
  sideHeaderLeft.className = 'gd-sidebar-header-left';

  const sideTag = document.createElement('span');
  sideTag.className = 'gd-sidebar-console-tag';
  sideTag.textContent = 'PROTOCOL SPECIFICATION';

  const sideConsoleTitle = document.createElement('h2');
  sideConsoleTitle.className = 'gd-sidebar-console-title';
  sideConsoleTitle.textContent = 'Security Governance & Review Protocols';

  sideHeaderLeft.appendChild(sideTag);
  sideHeaderLeft.appendChild(sideConsoleTitle);
  sideHeader.appendChild(sideHeaderLeft);

  const sideHeaderRight = document.createElement('div');
  sideHeaderRight.className = 'gd-sidebar-header-right';
  sideHeaderRight.innerHTML = `
    <span class="gd-status-dot"></span>
    <span class="gd-sidebar-live-text">Active Safeguards Enforced</span>
  `;
  sideHeader.appendChild(sideHeaderRight);

  sidePane.appendChild(sideHeader);

  // Horizontal Grid Container for Protocol Blocks
  const gridContainer = document.createElement('div');
  gridContainer.className = 'gd-protocols-grid';

  // Block 1: Architectural Guarantee
  const guaranteeBlock = document.createElement('div');
  guaranteeBlock.className = 'gd-pending-sidebar-block';

  const gBadge = document.createElement('span');
  gBadge.className = 'gd-sidebar-block-badge';
  gBadge.textContent = '01 · ARCHITECTURAL GUARANTEE';

  const gTitle = document.createElement('h3');
  gTitle.className = 'gd-sidebar-block-title';
  gTitle.textContent = 'Safe Approvals Guarantee';

  const gText = document.createElement('p');
  gText.className = 'gd-sidebar-block-text';
  gText.textContent =
    'Guardrail strictly decouples reviewer approvals from client execution. Approving an action records consent on the backend only and never remotely executes actions in the browser.';

  const contrastPair = document.createElement('div');
  contrastPair.className = 'gd-sidebar-contrast-pair';

  const cp1 = document.createElement('div');
  cp1.className = 'gd-contrast-item';
  cp1.innerHTML = '<span class="gd-contrast-kicker">Reviewer Role</span><span class="gd-contrast-value">Audit Consent Only</span>';

  const cp2 = document.createElement('div');
  cp2.className = 'gd-contrast-item';
  cp2.innerHTML = '<span class="gd-contrast-kicker">Browser Execution</span><span class="gd-contrast-value">Ward Local Authority</span>';

  contrastPair.appendChild(cp1);
  contrastPair.appendChild(cp2);

  guaranteeBlock.appendChild(gBadge);
  guaranteeBlock.appendChild(gTitle);
  guaranteeBlock.appendChild(gText);
  guaranteeBlock.appendChild(contrastPair);
  gridContainer.appendChild(guaranteeBlock);

  // Block 2: Review Guidelines
  const guideBlock = document.createElement('div');
  guideBlock.className = 'gd-pending-sidebar-block';

  const guideBadge = document.createElement('span');
  guideBadge.className = 'gd-sidebar-block-badge';
  guideBadge.textContent = '02 · REVIEW STANDARDS';

  const guideTitle = document.createElement('h3');
  guideTitle.className = 'gd-sidebar-block-title';
  guideTitle.textContent = 'Review Guidelines';

  const guideList = document.createElement('ol');
  guideList.className = 'gd-sidebar-guidelines-list';

  const g1 = document.createElement('li');
  g1.className = 'gd-sidebar-guideline-item';
  g1.innerHTML =
    '<div class="gd-guideline-header"><span class="gd-guideline-num">01</span><strong class="gd-guideline-title">Verify Destination</strong></div><p class="gd-guideline-desc">Confirm target hostname matches the expected service.</p>';

  const g2 = document.createElement('li');
  g2.className = 'gd-sidebar-guideline-item';
  g2.innerHTML =
    '<div class="gd-guideline-header"><span class="gd-guideline-num">02</span><strong class="gd-guideline-title">Evaluate Intent</strong></div><p class="gd-guideline-desc">Verify context reflects intentional browsing activity.</p>';

  const g3 = document.createElement('li');
  g3.className = 'gd-sidebar-guideline-item';
  g3.innerHTML =
    '<div class="gd-guideline-header"><span class="gd-guideline-num">03</span><strong class="gd-guideline-title">15-Minute Expiry</strong></div><p class="gd-guideline-desc">Requests automatically expire to prevent stale execution windows.</p>';

  guideList.appendChild(g1);
  guideList.appendChild(g2);
  guideList.appendChild(g3);

  guideBlock.appendChild(guideBadge);
  guideBlock.appendChild(guideTitle);
  guideBlock.appendChild(guideList);
  gridContainer.appendChild(guideBlock);

  // Block 3: Session Security Posture
  const postureBlock = document.createElement('div');
  postureBlock.className = 'gd-pending-sidebar-block';

  const pBadge = document.createElement('span');
  pBadge.className = 'gd-sidebar-block-badge';
  pBadge.textContent = '03 · RUNTIME TELEMETRY';

  const pTitle = document.createElement('h3');
  pTitle.className = 'gd-sidebar-block-title';
  pTitle.textContent = 'Session Invariants';

  const pMeta = document.createElement('div');
  pMeta.className = 'gd-sidebar-posture-meta';

  const pm1 = document.createElement('div');
  pm1.className = 'gd-sidebar-meta-row';
  pm1.innerHTML = '<span class="gd-sidebar-meta-label">Interception</span><span class="gd-sidebar-meta-val">Staging Mode Active</span>';

  const pm2 = document.createElement('div');
  pm2.className = 'gd-sidebar-meta-row';
  pm2.innerHTML = '<span class="gd-sidebar-meta-label">Consent Signature</span><span class="gd-sidebar-meta-val">Ed25519 Cryptographic</span>';

  const pm3 = document.createElement('div');
  pm3.className = 'gd-sidebar-meta-row';
  pm3.innerHTML = '<span class="gd-sidebar-meta-label">Tenant Boundary</span><span class="gd-sidebar-meta-val">Strict Multi-Tenant</span>';

  const pm4 = document.createElement('div');
  pm4.className = 'gd-sidebar-meta-row';
  pm4.innerHTML = '<span class="gd-sidebar-meta-label">Local Execution</span><span class="gd-sidebar-meta-val">Decoupled · 0 Actions</span>';

  pMeta.appendChild(pm1);
  pMeta.appendChild(pm2);
  pMeta.appendChild(pm3);
  pMeta.appendChild(pm4);

  postureBlock.appendChild(pBadge);
  postureBlock.appendChild(pTitle);
  postureBlock.appendChild(pMeta);
  gridContainer.appendChild(postureBlock);

  sidePane.appendChild(gridContainer);
  return sidePane;
}
