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
import { formatExpirationInfo, formatTimestamp, getRiskLevelExplanation, isRequestExpired } from './detail.js';
import { filterRequests, renderFilterBar, renderFilterEmptyState } from './filters.js';
import { setAnimatedHeading } from './icons.js';

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
  /** Whether backend service is confirmed unreachable or in error */
  isBackendUnavailable?: boolean;
  /** Timestamp of last successful synchronization */
  lastSynchronizedAt?: Date | null;
  /** Whether refresh is currently in progress */
  isRefreshing?: boolean;
}

/**
 * Resolves human-friendly display name for a ward ID.
 */
function formatWardDisplayName(requesterId?: string): string {
  if (!requesterId || typeof requesterId !== 'string') return 'Your ward';
  const clean = requesterId.replace(/^usr_/, '').trim();
  if (!clean) return 'Your ward';
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

  // Radius = 26, Circumference = 2 * PI * 26 ≈ 163.36
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const chartWrap = document.createElement('div');
  chartWrap.className = 'gd-risk-chart-wrap';

  chartWrap.innerHTML = `
    <svg class="gd-risk-circular-svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="Risk Score: ${score} out of 100 (${riskLevel})">
      <circle
        class="gd-risk-circle-bg"
        cx="32"
        cy="32"
        r="${radius}"
        fill="transparent"
        stroke="rgba(39, 49, 33, 0.08)"
        stroke-width="4.5"
      />
      <circle
        class="gd-risk-circle-fill ${riskClass}"
        cx="32"
        cy="32"
        r="${radius}"
        fill="transparent"
        stroke-width="4.5"
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
  levelTag.textContent = `${riskLevel} RISK EVALUATION`;

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
export function renderPendingApprovals(props: PendingApprovalsProps): HTMLElement {
  const section = document.createElement('section');
  section.id = 'view-pending';
  section.className = 'gd-view-section gd-pending-redesign';
  section.setAttribute('aria-labelledby', 'pending-title');

  // 1. Page Header (Editorial, Unboxed)
  const header = document.createElement('header');
  header.className = 'gd-section-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'gd-section-title-group';

  const sectionEyebrow = document.createElement('span');
  sectionEyebrow.className = 'gd-section-eyebrow';
  sectionEyebrow.textContent = 'TRUSTED CONTACT VERIFICATION QUEUE';
  titleGroup.appendChild(sectionEyebrow);

  const titleRow = document.createElement('div');
  titleRow.className = 'gd-pending-title-row';

  const title = document.createElement('h1');
  title.id = 'pending-title';
  title.className = 'gd-section-title';
  setAnimatedHeading(title, 'Pending Approvals');
  titleRow.appendChild(title);

  // Subtle pending count indicator
  if (props.requests.length > 0) {
    const countPill = document.createElement('span');
    countPill.className = 'gd-pending-count-pill';
    countPill.setAttribute('role', 'status');
    const n = props.requests.length;
    countPill.textContent = `— ${n < 10 ? '0' + n : n} ${n === 1 ? 'Awaiting Evaluation' : 'Awaiting Evaluation'}`;
    titleRow.appendChild(countPill);
  }

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-section-subtitle';
  subtitle.textContent = 'Review browsing actions that require your approval.';

  titleGroup.appendChild(titleRow);
  titleGroup.appendChild(subtitle);
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
    const refreshText = document.createElement('span');
    refreshText.textContent = isBusy ? 'Refreshing...' : 'Refresh';
    refreshBtn.appendChild(refreshIcon);
    refreshBtn.appendChild(refreshText);

    let refreshClicked = false;
    refreshBtn.addEventListener('click', () => {
      if (refreshClicked || isBusy) return;
      refreshClicked = true;
      props.onRefresh?.();
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

    const dErrIcon = document.createElement('span');
    dErrIcon.className = 'gd-error-icon';
    dErrIcon.setAttribute('aria-hidden', 'true');

    const dErrText = document.createElement('span');
    dErrText.className = 'gd-decision-error-text';
    dErrText.textContent = props.decisionErrorMessage;

    dErrBanner.appendChild(dErrIcon);
    dErrBanner.appendChild(dErrText);
    listPane.appendChild(dErrBanner);
  }

  if (props.decisionSuccessMessage) {
    const dSuccBanner = document.createElement('div');
    dSuccBanner.className = 'gd-decision-success-banner';
    dSuccBanner.setAttribute('role', 'status');

    const dSuccIcon = document.createElement('span');
    dSuccIcon.className = 'gd-success-icon';
    dSuccIcon.setAttribute('aria-hidden', 'true');

    const dSuccText = document.createElement('span');
    dSuccText.className = 'gd-decision-success-text';
    dSuccText.textContent = props.decisionSuccessMessage;

    dSuccBanner.appendChild(dSuccIcon);
    dSuccBanner.appendChild(dSuccText);
    listPane.appendChild(dSuccBanner);
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
      iconWrap.innerHTML = `
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
      `;

      const emptyKicker = document.createElement('span');
      emptyKicker.className = 'gd-empty-kicker';
      emptyKicker.textContent = 'SYSTEM POSTURE · ALL CLEAR';

      const emptyHeadline = document.createElement('h2');
      emptyHeadline.className = 'gd-empty-title gd-placeholder-title';
      emptyHeadline.textContent = 'No Pending Approval Requests';

      const emptyDesc = document.createElement('p');
      emptyDesc.className = 'gd-empty-desc gd-placeholder-text';
      emptyDesc.textContent =
        'All browsing actions have been reviewed. There are no high-impact requests currently awaiting your evaluation.';

      const emptyAssurance = document.createElement('div');
      emptyAssurance.className = 'gd-empty-assurance-badge';
      emptyAssurance.innerHTML = `
        <span class="gd-status-dot"></span>
        <span class="gd-empty-assurance-text">Real-time sync active · 15-minute review window ready</span>
      `;

      emptyPlaceholder.appendChild(iconWrap);
      emptyPlaceholder.appendChild(emptyKicker);
      emptyPlaceholder.appendChild(emptyHeadline);
      emptyPlaceholder.appendChild(emptyDesc);
      emptyPlaceholder.appendChild(emptyAssurance);
      listPane.appendChild(emptyPlaceholder);

      layout.appendChild(listPane);
      layout.appendChild(renderProtocolSidebar());
    } else {
      // State D: Filterable Approval Items List
      const filteredRequests = filterRequests(displayRequests, activeFilters);

      // Filter Bar (rendered if multiple requests or active filter)
      if (displayRequests.length > 2 || activeFilters.searchQuery || activeFilters.riskLevel !== 'ALL') {
        const filterBar = renderFilterBar({
          filters: activeFilters,
          totalCount: displayRequests.length,
          filteredCount: filteredRequests.length,
          showStatusFilter: false,
          showRiskFilter: true,
          showDateFilter: true,
          searchPlaceholder: 'Search pending requests...',
          onFiltersChange: (newFilters) => {
            props.onFiltersChange?.(newFilters);
          },
        });
        listPane.appendChild(filterBar);
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

        // Render Left Column: Clean List Header & Minimal Numbered Rows
        const listHeader = document.createElement('div');
        listHeader.className = 'gd-list-header';

        const listKicker = document.createElement('span');
        listKicker.className = 'gd-list-kicker';
        listKicker.textContent = 'VERIFICATION QUEUE';

        const listCountBadge = document.createElement('span');
        listCountBadge.className = 'gd-list-count';
        const qCount = filteredRequests.length;
        listCountBadge.textContent = `${qCount} ${qCount === 1 ? 'Action Pending' : 'Actions Pending'}`;

        listHeader.appendChild(listKicker);
        listHeader.appendChild(listCountBadge);
        listPane.appendChild(listHeader);

        filteredRequests.forEach((baseReq, index) => {
          const req = (props.selectedRequestDetail && props.selectedRequestDetail.id === baseReq.id)
            ? { ...baseReq, ...props.selectedRequestDetail }
            : baseReq;

          const isSelected = selectedReq && req.id === selectedReq.id;
          const isExpired = isRequestExpired(req);
          const wardName = formatWardDisplayName(req.requesterId);
          const hostname = resolveSafeHostname(req);
          const riskLevel = req.riskLevel || RiskLevel.LOW;
          const riskClass = riskLevel.toLowerCase();

          const card = document.createElement('article');
          card.className = `gd-request-card ${isSelected ? 'selected' : ''} ${isExpired ? 'is-expired' : ''}`;
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

          // Subheading: Clean, minimal single-line context (Domain · Contact · Expiration)
          const subheading = document.createElement('p');
          subheading.className = 'gd-request-subheading';

          const hostSpan = document.createElement('span');
          hostSpan.className = 'gd-context-hostname';
          hostSpan.textContent = hostname;
          subheading.appendChild(hostSpan);

          const sep1 = document.createElement('span');
          sep1.className = 'gd-subheading-sep';
          sep1.setAttribute('aria-hidden', 'true');
          sep1.textContent = '·';
          subheading.appendChild(sep1);

          const wardSpan = document.createElement('span');
          wardSpan.className = 'gd-requester-name';
          wardSpan.textContent = wardName;
          subheading.appendChild(wardSpan);

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
          detailPane.className = 'gd-detail-pane gd-decision-dossier-box';
          detailPane.setAttribute('role', 'region');
          detailPane.setAttribute('aria-label', `Review and decide on ${selectedReq.actionDescription}`);

          // 1. Decision Dossier Header
          const dossierHeader = document.createElement('div');
          dossierHeader.className = 'gd-detail-dossier-header';

          const topBar = document.createElement('div');
          topBar.className = 'gd-detail-header-top';

          const kicker = document.createElement('span');
          kicker.className = 'gd-detail-dossier-kicker';
          kicker.textContent = 'ACTION VERIFICATION REQUIRED';
          topBar.appendChild(kicker);

          const displayStatus = isExpired && selectedReq.status === ApprovalStatus.PENDING ? ApprovalStatus.EXPIRED : (selectedReq.status || ApprovalStatus.PENDING);
          const statusPill = document.createElement('span');
          const sClass = displayStatus.toLowerCase();
          statusPill.className = `gd-detail-status-pill ${sClass}`;
          statusPill.setAttribute('role', 'status');
          statusPill.setAttribute('data-status', sClass);
          statusPill.textContent = displayStatus;
          topBar.appendChild(statusPill);
          dossierHeader.appendChild(topBar);

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
            titleSpan.textContent = selectedReq.pageTitle;
            headerMeta.appendChild(titleSpan);
          }

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
              const resolvedNotice = document.createElement('div');
              resolvedNotice.className = `gd-decision-resolved-notice ${selectedReq.status.toLowerCase()}`;
              resolvedNotice.setAttribute('role', 'status');

              const statusText = document.createElement('span');
              statusText.className = 'gd-resolved-status-text';
              statusText.textContent =
                selectedReq.status === ApprovalStatus.APPROVED
                  ? 'Approved: This action has been approved.'
                  : selectedReq.status === ApprovalStatus.REJECTED
                    ? 'Rejected: This action has been rejected.'
                    : `Decision Recorded: ${selectedReq.status}`;

              resolvedNotice.appendChild(statusText);
              decisionControlsContainer.appendChild(resolvedNotice);
              return;
            }

            if (!activeConfirmation) {
              const btnGroup = document.createElement('div');
              btnGroup.className = 'gd-decision-btn-group';

              const approveBtn = document.createElement('button');
              approveBtn.type = 'button';
              approveBtn.className = 'gd-btn-decision gd-btn-approve';
              approveBtn.textContent = 'Approve Request';
              approveBtn.setAttribute('aria-label', `Approve request ${selectedReq.id}: ${selectedReq.actionDescription}`);

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
              rejectBtn.textContent = 'Reject Request';
              rejectBtn.setAttribute('aria-label', `Reject request ${selectedReq.id}: ${selectedReq.actionDescription}`);

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
                wText.textContent =
                  'This action involves elevated operational risk. Your decision commits an authoritative audit record.';
                warningBox.appendChild(wTitle);
                warningBox.appendChild(wText);
                confirmBox.appendChild(warningBox);
              }

              const noteGroup = document.createElement('div');
              noteGroup.className = 'gd-confirm-field-group';

              const noteLabel = document.createElement('label');
              noteLabel.htmlFor = 'decision-reason-input';
              noteLabel.className = 'gd-confirm-field-label';
              noteLabel.textContent = 'Reason or Notes (Optional)';

              const noteInput = document.createElement('input');
              noteInput.type = 'text';
              noteInput.id = 'decision-reason-input';
              noteInput.className = 'gd-confirm-note-input gd-decision-note-input';
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
                'Consequential Decision Notice: Submitting this decision authoritatively commits it to the Guardrail backend audit log. Decisions are permanent and cannot be reversed or undone.';
              consequentialNotice.appendChild(cNoticeText);
              confirmBox.appendChild(consequentialNotice);

              const confirmActions = document.createElement('div');
              confirmActions.className = 'gd-confirm-actions-row';

              const submitBtn = document.createElement('button');
              submitBtn.type = 'button';
              submitBtn.className = `gd-btn-confirm-submit ${isApprove ? 'gd-btn-approve-confirm' : 'gd-btn-reject-confirm'}`;
              submitBtn.textContent = props.isSubmittingDecision
                ? 'Submitting decision...'
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
          initSpan.textContent = `Initiated At: ${formatTimestamp(selectedReq.createdAt)}`;

          const timeSep = document.createElement('span');
          timeSep.className = 'gd-context-sep';
          timeSep.textContent = '·';

          const expSpan2 = document.createElement('span');
          const expFormatted = formatExpirationInfo(selectedReq.expiresAt);
          const expRelativeText = expFormatted.isPast ? 'Expired' : (expFormatted.text.includes('(') ? expFormatted.text.split(' (')[0] : expFormatted.text);
          expSpan2.textContent = `Expires At: ${formatTimestamp(selectedReq.expiresAt)} (${expRelativeText})`;

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
          auditSummary.textContent = 'Security Governance & Audit Trail';
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
  sideTag.textContent = 'PROTOCOL CONSOLE';

  const sideConsoleTitle = document.createElement('h2');
  sideConsoleTitle.className = 'gd-sidebar-console-title';
  sideConsoleTitle.textContent = 'Security & Oversight';

  sideHeaderLeft.appendChild(sideTag);
  sideHeaderLeft.appendChild(sideConsoleTitle);
  sideHeader.appendChild(sideHeaderLeft);

  const sideHeaderRight = document.createElement('div');
  sideHeaderRight.className = 'gd-sidebar-header-right';
  sideHeaderRight.innerHTML = `
    <span class="gd-status-dot"></span>
    <span class="gd-sidebar-live-text">STANDARDS & SAFEGUARDS ACTIVE</span>
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
  gBadge.textContent = 'INVIOLABLE SAFETY GUARANTEE';

  const gTitle = document.createElement('h3');
  gTitle.className = 'gd-sidebar-block-title';
  gTitle.textContent = 'Safe Approvals Guarantee';

  const gText = document.createElement('p');
  gText.className = 'gd-sidebar-block-text';
  gText.textContent =
    'Guardrail strictly decouples reviewer approvals from client-side execution. Approving an action records reviewer consent on the backend only. It never triggers execution on your contact’s browser—the user retains complete final control to proceed or abort in Staging Mode.';

  const contrastPair = document.createElement('div');
  contrastPair.className = 'gd-sidebar-contrast-pair';

  const cp1 = document.createElement('div');
  cp1.className = 'gd-contrast-item';
  cp1.innerHTML = '<span class="gd-contrast-kicker">REVIEWER ROLE</span><strong class="gd-contrast-value">Audit Consent Only</strong>';

  const cp2 = document.createElement('div');
  cp2.className = 'gd-contrast-item';
  cp2.innerHTML = '<span class="gd-contrast-kicker">BROWSER EXECUTION</span><strong class="gd-contrast-value">Ward Local Authority</strong>';

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
  guideBadge.textContent = 'EVALUATION CHECKLIST';

  const guideTitle = document.createElement('h3');
  guideTitle.className = 'gd-sidebar-block-title';
  guideTitle.textContent = 'Review Guidelines';

  const guideList = document.createElement('ol');
  guideList.className = 'gd-sidebar-guidelines-list';

  const g1 = document.createElement('li');
  g1.className = 'gd-sidebar-guideline-item';
  g1.innerHTML =
    '<div class="gd-guideline-header"><span class="gd-guideline-num">01</span><strong class="gd-guideline-title">Verify Destination</strong></div><p class="gd-guideline-desc">Confirm the target hostname and origin match the expected web application and do not spoof trusted services.</p>';

  const g2 = document.createElement('li');
  g2.className = 'gd-sidebar-guideline-item';
  g2.innerHTML =
    '<div class="gd-guideline-header"><span class="gd-guideline-num">02</span><strong class="gd-guideline-title">Evaluate Intent</strong></div><p class="gd-guideline-desc">Review the action trigger and initiating context to ensure it reflects intentional browsing activity.</p>';

  const g3 = document.createElement('li');
  g3.className = 'gd-sidebar-guideline-item';
  g3.innerHTML =
    '<div class="gd-guideline-header"><span class="gd-guideline-num">03</span><strong class="gd-guideline-title">15-Minute Expiry</strong></div><p class="gd-guideline-desc">Pending requests automatically expire after 15 minutes to prevent stale execution windows.</p>';

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
  pBadge.textContent = 'RUNTIME TELEMETRY';

  const pTitle = document.createElement('h3');
  pTitle.className = 'gd-sidebar-block-title';
  pTitle.textContent = 'Session Protection';

  const pMeta = document.createElement('div');
  pMeta.className = 'gd-sidebar-posture-meta';

  const pm1 = document.createElement('div');
  pm1.className = 'gd-sidebar-meta-row';
  pm1.innerHTML = '<span class="gd-sidebar-meta-label">Interception</span> <span class="gd-sidebar-meta-val">Staging Mode Active</span>';

  const pm2 = document.createElement('div');
  pm2.className = 'gd-sidebar-meta-row';
  pm2.innerHTML = '<span class="gd-sidebar-meta-label">Consent Signature</span> <span class="gd-sidebar-meta-val">Ed25519 Cryptographic</span>';

  const pm3 = document.createElement('div');
  pm3.className = 'gd-sidebar-meta-row';
  pm3.innerHTML = '<span class="gd-sidebar-meta-label">Tenant Boundary</span> <span class="gd-sidebar-meta-val">Strict Multi-Tenant</span>';

  const pm4 = document.createElement('div');
  pm4.className = 'gd-sidebar-meta-row';
  pm4.innerHTML = '<span class="gd-sidebar-meta-label">Local Execution</span> <span class="gd-sidebar-meta-val">Decoupled (0 Actions)</span>';

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
