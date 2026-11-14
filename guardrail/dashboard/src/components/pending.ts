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

  if (cat.includes('NAVIGATION') || desc.includes('click') || desc.includes('navigat')) {
    return `This action will navigate ${wardName} away from the currently trusted website to ${hostname}.`;
  }
  if (cat.includes('TRANSFER') || desc.includes('wire') || desc.includes('transfer') || desc.includes('pay')) {
    return `This action initiates a transfer of funds on ${hostname}, which cannot be reversed once processed.`;
  }
  if (request.riskReasons && Array.isArray(request.riskReasons) && request.riskReasons.length > 0 && request.riskReasons[0]) {
    return request.riskReasons[0];
  }
  return `This action on ${hostname} requires your explicit review to safeguard ${wardName}'s browsing session.`;
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
    countPill.textContent = `${props.requests.length} ${props.requests.length === 1 ? 'request' : 'requests'}`;
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

  // 2. Main Approvals Area (Single-Column Focused Workspace)
  const layout = document.createElement('div');
  layout.className = 'gd-approvals-layout gd-approvals-single-column';

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
  } else if (props.status === 'error' && props.requests.length === 0) {
    // State B: Backend Unavailable or Load Failure (Empty List)
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
      // State C: Genuinely Empty State ("You're all caught up.")
      const emptyPlaceholder = document.createElement('div');
      emptyPlaceholder.className = 'gd-placeholder gd-empty-state';

      const iconWrap = document.createElement('div');
      iconWrap.className = 'gd-empty-icon';
      iconWrap.setAttribute('aria-hidden', 'true');

      const emptyHeadline = document.createElement('h2');
      emptyHeadline.className = 'gd-empty-title';
      emptyHeadline.textContent = "You're all caught up.";

      // Retain semantic placeholder title element for test contracts
      const srTitle = document.createElement('span');
      srTitle.className = 'gd-placeholder-title gd-sr-only';
      srTitle.textContent = 'No Pending Approval Requests';

      const emptyDesc = document.createElement('p');
      emptyDesc.className = 'gd-empty-desc gd-placeholder-text';
      emptyDesc.textContent = 'There are no browsing approval requests waiting for your review.';

      emptyPlaceholder.appendChild(iconWrap);
      emptyPlaceholder.appendChild(emptyHeadline);
      emptyPlaceholder.appendChild(srTitle);
      emptyPlaceholder.appendChild(emptyDesc);
      listPane.appendChild(emptyPlaceholder);
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
      } else {
        for (const baseReq of filteredRequests) {
          // Merge authoritative details if this item matches selectedRequestDetail
          const req = (props.selectedRequestDetail && props.selectedRequestDetail.id === baseReq.id)
            ? { ...baseReq, ...props.selectedRequestDetail }
            : baseReq;

          const isSelected = req.id === props.selectedRequestId || (filteredRequests.length === 1 && !props.selectedRequestId);
          const isExpired = isRequestExpired(req);
          const wardName = formatWardDisplayName(req.requesterId);
          const categoryLabel = formatFriendlyCategory(req.category);
          const hostname = resolveSafeHostname(req);
          const riskLevel = req.riskLevel || RiskLevel.LOW;
          const riskClass = riskLevel.toLowerCase();

          const card = document.createElement('article');
          card.className = `gd-request-card ${isSelected ? 'selected' : ''} ${isExpired ? 'is-expired' : ''}`;
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
          card.setAttribute('aria-label', `Review request ${req.id}: ${req.actionDescription}`);

          // 1. Eyebrow Row: Requester identity, category, and subtle risk indicator
          const eyebrow = document.createElement('div');
          eyebrow.className = 'gd-request-eyebrow';

          const requesterInfo = document.createElement('div');
          requesterInfo.className = 'gd-requester-info';

          const wardText = document.createElement('span');
          wardText.className = 'gd-requester-name';
          wardText.textContent = `${wardName} is requesting your approval`;

          const sep = document.createElement('span');
          sep.className = 'gd-eyebrow-sep';
          sep.setAttribute('aria-hidden', 'true');
          sep.textContent = '·';

          const catText = document.createElement('span');
          catText.className = 'gd-request-category';
          catText.textContent = categoryLabel;

          requesterInfo.appendChild(wardText);
          requesterInfo.appendChild(sep);
          requesterInfo.appendChild(catText);
          eyebrow.appendChild(requesterInfo);

          const badgesWrap = document.createElement('div');
          badgesWrap.className = 'gd-pending-card-badges';

          if (req.status && req.status !== ApprovalStatus.PENDING) {
            const statusBadge = document.createElement('span');
            statusBadge.className = `gd-status-badge ${req.status.toLowerCase()}`;
            statusBadge.textContent = req.status;
            badgesWrap.appendChild(statusBadge);
          } else if (isExpired) {
            const expBadge = document.createElement('span');
            expBadge.className = 'gd-status-badge expired';
            expBadge.textContent = 'EXPIRED';
            badgesWrap.appendChild(expBadge);
          }

          const riskBadge = document.createElement('span');
          riskBadge.className = `gd-risk-badge ${riskClass}`;
          riskBadge.textContent = riskLevel;
          badgesWrap.appendChild(riskBadge);

          eyebrow.appendChild(badgesWrap);
          card.appendChild(eyebrow);

          // 2. Primary Visual Element: Requested Action (Hero Typography)
          const primaryWrap = document.createElement('div');
          primaryWrap.className = 'gd-request-primary';

          const actionTitle = document.createElement('h2');
          actionTitle.className = 'gd-request-description';
          actionTitle.textContent = req.actionDescription;
          primaryWrap.appendChild(actionTitle);
          card.appendChild(primaryWrap);

          // 3. Context Metadata Row (Website, Requested Time, Expiration)
          const metaRow = document.createElement('div');
          metaRow.className = 'gd-request-meta gd-request-context-line';

          const websiteMeta = document.createElement('div');
          websiteMeta.className = 'gd-context-item';
          const webLabel = document.createElement('span');
          webLabel.className = 'gd-context-label';
          webLabel.textContent = 'Website:';
          const webVal = document.createElement('strong');
          webVal.className = 'gd-context-value gd-context-hostname';
          webVal.textContent = hostname;
          websiteMeta.appendChild(webLabel);
          websiteMeta.appendChild(webVal);
          metaRow.appendChild(websiteMeta);

          const sep2 = document.createElement('span');
          sep2.className = 'gd-context-sep';
          sep2.setAttribute('aria-hidden', 'true');
          sep2.textContent = '·';
          metaRow.appendChild(sep2);

          const timeStr = req.createdAt
            ? new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'Just now';
          const timeMeta = document.createElement('div');
          timeMeta.className = 'gd-context-item';
          const timeLabel = document.createElement('span');
          timeLabel.className = 'gd-context-label';
          timeLabel.textContent = 'Requested at:';
          const timeVal = document.createElement('span');
          timeVal.className = 'gd-context-value';
          timeVal.textContent = timeStr;
          timeMeta.appendChild(timeLabel);
          timeMeta.appendChild(timeVal);
          metaRow.appendChild(timeMeta);

          if (req.expiresAt) {
            const expInfo = formatExpirationInfo(req.expiresAt);
            const sep3 = document.createElement('span');
            sep3.className = 'gd-context-sep';
            sep3.setAttribute('aria-hidden', 'true');
            sep3.textContent = '·';
            metaRow.appendChild(sep3);

            const expMeta = document.createElement('div');
            expMeta.className = 'gd-context-item';
            const expLabel = document.createElement('span');
            expLabel.className = 'gd-context-label';
            expLabel.textContent = 'Expires at:';

            const expSpan = document.createElement('span');
            expSpan.className = expInfo.isPast ? 'gd-card-meta-expired' : 'gd-card-meta-expires';
            expSpan.textContent = expInfo.isPast
              ? 'Expired'
              : `Expires: ${new Date(req.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

            expMeta.appendChild(expLabel);
            expMeta.appendChild(expSpan);
            metaRow.appendChild(expMeta);
          }

          card.appendChild(metaRow);

          // 4. Decision Action Bar & Expand Details Toggle
          const actionRow = document.createElement('div');
          actionRow.className = 'gd-request-actions-row';

          const decisionControlsContainer = document.createElement('div');
          decisionControlsContainer.className = 'gd-decision-controls-container';

          // Offline Backend Notice (Task 3 & 5)
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

          // Expandable Details Container (Collapsed by default, styled as .gd-detail-pane)
          const detailsContainer = document.createElement('div');
          detailsContainer.className = `gd-request-expandable-details ${isSelected ? 'gd-detail-pane' : ''}`;
          detailsContainer.setAttribute('role', 'region');
          detailsContainer.setAttribute('aria-label', `Context details for ${req.actionDescription}`);
          detailsContainer.style.display = 'none';

          let isDetailsOpen = false;
          let activeConfirmation: 'APPROVED' | 'REJECTED' | null = props.isSubmittingDecision ? 'APPROVED' : null;

          const renderDecisionControls = () => {
            // Keep offline notice if present
            const unavail = decisionControlsContainer.querySelector('.gd-backend-offline-banner');
            while (decisionControlsContainer.firstChild) {
              decisionControlsContainer.removeChild(decisionControlsContainer.firstChild);
            }
            if (unavail) {
              decisionControlsContainer.appendChild(unavail);
            }

            // If request is already resolved on server (APPROVED, REJECTED, CANCELLED)
            if (req.status && req.status !== ApprovalStatus.PENDING) {
              const resolvedNotice = document.createElement('div');
              resolvedNotice.className = `gd-decision-resolved-notice ${req.status.toLowerCase()}`;
              resolvedNotice.setAttribute('role', 'status');

              const statusText = document.createElement('span');
              statusText.className = 'gd-resolved-status-text';
              statusText.textContent =
                req.status === ApprovalStatus.APPROVED
                  ? '✓ Request Approved'
                  : req.status === ApprovalStatus.REJECTED
                  ? '✕ Request Rejected'
                  : `Request ${req.status}`;

              resolvedNotice.appendChild(statusText);
              decisionControlsContainer.appendChild(resolvedNotice);
              return;
            }

            if (!activeConfirmation && !props.isSubmittingDecision) {
              // Step 1: Direct Decision Actions (Deep Olive Approve & Muted Red Reject)
              const buttonsGroup = document.createElement('div');
              buttonsGroup.className = 'gd-decision-actions-row';

              const approveBtn = document.createElement('button');
              approveBtn.type = 'button';
              approveBtn.className = 'gd-btn-decision gd-btn-approve';
              const approveSpan = document.createElement('span');
              approveSpan.textContent = 'Approve Request';
              approveBtn.appendChild(approveSpan);

              if (props.isSubmittingDecision || props.isBackendUnavailable) {
                approveBtn.disabled = true;
                if (props.isSubmittingDecision) approveBtn.setAttribute('aria-busy', 'true');
              }
              approveBtn.addEventListener('click', (e) => {
                e?.stopPropagation?.();
                if (props.isSubmittingDecision || props.isBackendUnavailable) return;
                activeConfirmation = 'APPROVED';
                renderDecisionControls();
              });

              const rejectBtn = document.createElement('button');
              rejectBtn.type = 'button';
              rejectBtn.className = 'gd-btn-decision gd-btn-reject';
              const rejectSpan = document.createElement('span');
              rejectSpan.textContent = 'Reject Request';
              rejectBtn.appendChild(rejectSpan);

              if (props.isSubmittingDecision || props.isBackendUnavailable) {
                rejectBtn.disabled = true;
                if (props.isSubmittingDecision) rejectBtn.setAttribute('aria-busy', 'true');
              }
              rejectBtn.addEventListener('click', (e) => {
                e?.stopPropagation?.();
                if (props.isSubmittingDecision || props.isBackendUnavailable) return;
                activeConfirmation = 'REJECTED';
                renderDecisionControls();
              });

              buttonsGroup.appendChild(approveBtn);
              buttonsGroup.appendChild(rejectBtn);
              decisionControlsContainer.appendChild(buttonsGroup);
            } else {
              // Step 2: Deliberate Inline Confirmation Box
              const isApprove = activeConfirmation !== 'REJECTED';
              const confirmBox = document.createElement('div');
              confirmBox.className = `gd-decision-confirm-box ${isApprove ? 'confirm-approve' : 'confirm-reject'}`;
              confirmBox.setAttribute('role', 'group');
              confirmBox.setAttribute('aria-labelledby', 'gd-decision-confirm-title');

              // Escape key listener for keyboard dismissal
              confirmBox.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                  e?.preventDefault?.();
                  e?.stopPropagation?.();
                  if (!props.isSubmittingDecision) {
                    activeConfirmation = null;
                    renderDecisionControls();
                    const returnBtn = card.querySelector<HTMLButtonElement>(isApprove ? '.gd-btn-approve' : '.gd-btn-reject');
                    returnBtn?.focus();
                  }
                }
              });

              const confirmTitle = document.createElement('h4');
              confirmTitle.id = 'gd-decision-confirm-title';
              confirmTitle.className = 'gd-confirm-title';
              confirmTitle.setAttribute('tabindex', '-1');
              confirmTitle.textContent = isApprove ? 'Confirm Approval Decision' : 'Confirm Rejection Decision';
              confirmBox.appendChild(confirmTitle);

              // High-Impact Decision Warning for Critical/High Risk
              const isHighImpact =
                riskLevel === RiskLevel.CRITICAL ||
                riskLevel === RiskLevel.HIGH ||
                (typeof req.riskScore === 'number' && req.riskScore >= 50);

              if (isHighImpact) {
                const warningBox = document.createElement('div');
                warningBox.className = 'gd-high-impact-warning';
                warningBox.setAttribute('role', 'alert');

                const warnIcon = document.createElement('span');
                warnIcon.className = 'gd-warning-icon';
                warnIcon.setAttribute('aria-hidden', 'true');

                const warnContent = document.createElement('div');
                warnContent.className = 'gd-warning-content';

                const warnHeading = document.createElement('strong');
                warnHeading.textContent = `High-Impact Decision Warning (${riskLevel} Risk)`;

                const warnText = document.createElement('p');
                warnText.textContent = isApprove
                  ? 'Approving records reviewer consent for an elevated-risk request. It does not run the action. Verify that you recognize this interaction; the extension must revalidate locally and the user must confirm any supported continuation.'
                  : 'Rejecting records that reviewer consent was denied. The dashboard cannot change or verify the action’s current browser state.';

                warnContent.appendChild(warnHeading);
                warnContent.appendChild(warnText);
                warningBox.appendChild(warnIcon);
                warningBox.appendChild(warnContent);
                confirmBox.appendChild(warningBox);
              } else {
                const infoText = document.createElement('p');
                infoText.className = 'gd-confirm-desc';
                infoText.textContent = isApprove
                  ? 'This records reviewer consent only. It does not run the action; the extension must revalidate locally and the user must confirm any supported continuation.'
                  : 'This records rejection of the request. The dashboard cannot change or verify the action’s current browser state.';
                confirmBox.appendChild(infoText);
              }

              // Reviewer Note Textarea (Optional)
              const noteGroup = document.createElement('div');
              noteGroup.className = 'gd-confirm-note-group';

              const noteLabel = document.createElement('label');
              noteLabel.className = 'gd-detail-label';
              noteLabel.htmlFor = 'decision-reason-input';
              noteLabel.textContent = 'Reviewer Note (Optional)';

              const noteInput = document.createElement('textarea');
              noteInput.id = 'decision-reason-input';
              noteInput.className = 'gd-decision-reason-input';
              noteInput.placeholder = isApprove
                ? 'Optional: Add an audit note (e.g., "Verified with user verbally")...'
                : 'Optional: Add an explanation for the rejection...';
              noteInput.rows = 2;
              if (props.isSubmittingDecision) {
                noteInput.disabled = true;
              }

              noteGroup.appendChild(noteLabel);
              noteGroup.appendChild(noteInput);
              confirmBox.appendChild(noteGroup);

              // Consequential Decision Notice
              const consequentialNotice = document.createElement('div');
              consequentialNotice.className = 'gd-consequential-notice';
              consequentialNotice.setAttribute('role', 'note');

              const cNoticeText = document.createElement('p');
              cNoticeText.textContent =
                'Consequential Decision Notice: Submitting this decision authoritatively commits it to the Guardrail backend audit log. Decisions are permanent and cannot be reversed or undone.';
              consequentialNotice.appendChild(cNoticeText);
              confirmBox.appendChild(consequentialNotice);

              // Confirm & Cancel Actions Row
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
                void props.onDecisionSubmit?.(isApprove ? 'APPROVED' : 'REJECTED', reason, req.id);
              });

              const cancelBtn = document.createElement('button');
              cancelBtn.type = 'button';
              cancelBtn.className = 'gd-btn-cancel-confirm';
              cancelBtn.textContent = 'Cancel';
              cancelBtn.addEventListener('click', (e) => {
                e?.stopPropagation?.();
                activeConfirmation = null;
                renderDecisionControls();
                const returnBtn = card.querySelector<HTMLButtonElement>(isApprove ? '.gd-btn-approve' : '.gd-btn-reject');
                returnBtn?.focus();
              });

              confirmActions.appendChild(submitBtn);
              confirmActions.appendChild(cancelBtn);
              confirmBox.appendChild(confirmActions);

              decisionControlsContainer.appendChild(confirmBox);

              // Focus confirmation title for accessibility
              if (!props.isSubmittingDecision) {
                confirmTitle.focus();
              }
            }
          };

          renderDecisionControls();

          // Secondary "View Request Details" Toggle Button
          const toggleDetailsBtn = document.createElement('button');
          toggleDetailsBtn.type = 'button';
          toggleDetailsBtn.className = 'gd-btn-toggle-details';
          toggleDetailsBtn.setAttribute('aria-expanded', 'false');

          const textSpan = document.createElement('span');
          textSpan.className = 'gd-toggle-text';
          textSpan.textContent = 'View Request Details';

          const chevron = document.createElement('span');
          chevron.className = 'gd-chevron-icon';
          chevron.setAttribute('aria-hidden', 'true');

          toggleDetailsBtn.appendChild(textSpan);
          toggleDetailsBtn.appendChild(chevron);

          toggleDetailsBtn.addEventListener('click', (e) => {
            e?.stopPropagation?.();
            isDetailsOpen = !isDetailsOpen;
            detailsContainer.style.display = isDetailsOpen ? 'flex' : 'none';
            toggleDetailsBtn.setAttribute('aria-expanded', isDetailsOpen ? 'true' : 'false');
            textSpan.textContent = isDetailsOpen ? 'Hide Details' : 'View Request Details';
            chevron.classList.toggle('gd-chevron-rotated', isDetailsOpen);
          });

          actionRow.appendChild(decisionControlsContainer);
          actionRow.appendChild(toggleDetailsBtn);
          card.appendChild(actionRow);

          // 5. Expandable Details Section (Human-friendly context + Tucked Audit Data)
          const expDetailsInner = document.createElement('div');
          expDetailsInner.className = 'gd-expandable-details-content';

          // Action description in detail pane for test contract (detailPane.querySelector('.gd-detail-title'))
          const detailTitleEl = document.createElement('h3');
          detailTitleEl.className = isSelected ? 'gd-detail-title' : 'gd-detail-title-unselected';
          detailTitleEl.textContent = req.actionDescription;
          expDetailsInner.appendChild(detailTitleEl);

          // Human Context Breakdown
          const contextGrid = document.createElement('div');
          contextGrid.className = 'gd-human-context-grid';

          // Webpage Title
          const pageTitleItem = document.createElement('div');
          pageTitleItem.className = 'gd-context-detail-item';
          const pLabel = document.createElement('span');
          pLabel.className = 'gd-detail-label';
          pLabel.textContent = 'Webpage Title';
          const pVal = document.createElement('span');
          pVal.className = 'gd-detail-value';
          pVal.textContent = req.pageTitle || 'Untitled webpage';
          pageTitleItem.appendChild(pLabel);
          pageTitleItem.appendChild(pVal);
          contextGrid.appendChild(pageTitleItem);

          // Destination Hostname
          const hostItem = document.createElement('div');
          hostItem.className = 'gd-context-detail-item';
          const hLabel = document.createElement('span');
          hLabel.className = 'gd-detail-label';
          hLabel.textContent = 'Destination';
          const hVal = document.createElement('span');
          hVal.className = 'gd-detail-value';
          hVal.textContent = hostname;
          hostItem.appendChild(hLabel);
          hostItem.appendChild(hVal);
          contextGrid.appendChild(hostItem);

          // Why Flagged (Plain-language risk explanation)
          const whyItem = document.createElement('div');
          whyItem.className = 'gd-context-detail-item gd-context-detail-full';
          const whyLabel = document.createElement('span');
          whyLabel.className = 'gd-detail-label';
          whyLabel.textContent = 'Why This Action Requires Approval';
          const whyText = document.createElement('div');
          whyText.className = 'gd-risk-explanation';
          const plainExplanation = getHumanReadableRiskExplanation(req);
          const impactExplanation = getRiskLevelExplanation(riskLevel);
          whyText.textContent = `${plainExplanation} ${impactExplanation}`;
          whyItem.appendChild(whyLabel);
          whyItem.appendChild(whyText);
          contextGrid.appendChild(whyItem);

          // Operational Impact Assessment
          const riskAssessItem = document.createElement('div');
          riskAssessItem.className = 'gd-context-detail-item gd-context-detail-full';
          const rLabel = document.createElement('span');
          rLabel.className = 'gd-detail-label';
          rLabel.textContent = 'Risk Assessment';
          const rVal = document.createElement('p');
          rVal.className = 'gd-detail-value gd-risk-level-desc';
          rVal.textContent = impactExplanation;
          riskAssessItem.appendChild(rLabel);
          riskAssessItem.appendChild(rVal);
          contextGrid.appendChild(riskAssessItem);

          // Non-malicious risk disclaimer
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
          contextGrid.appendChild(disclaimer);

          // Status Pill and Timestamps Row
          const statusRow = document.createElement('div');
          statusRow.className = 'gd-context-detail-item gd-context-detail-full gd-context-status-row';

          const displayStatus = isExpired && req.status === ApprovalStatus.PENDING ? ApprovalStatus.EXPIRED : (req.status || ApprovalStatus.PENDING);
          const statusPill = document.createElement('span');
          const sClass = displayStatus.toLowerCase();
          statusPill.className = `gd-detail-status-pill ${sClass}`;
          statusPill.setAttribute('role', 'status');
          statusPill.setAttribute('data-status', sClass);
          statusPill.textContent = displayStatus;

          const timestampsInfo = document.createElement('div');
          timestampsInfo.className = 'gd-context-timestamps';

          const initSpan = document.createElement('span');
          initSpan.textContent = `Initiated At: ${formatTimestamp(req.createdAt)}`;

          const timeSep = document.createElement('span');
          timeSep.className = 'gd-context-sep';
          timeSep.textContent = '·';

          const expSpan2 = document.createElement('span');
          const expFormatted = formatExpirationInfo(req.expiresAt);
          expSpan2.textContent = `Expires At: ${expFormatted.text}`;

          timestampsInfo.appendChild(initSpan);
          timestampsInfo.appendChild(timeSep);
          timestampsInfo.appendChild(expSpan2);

          statusRow.appendChild(statusPill);
          statusRow.appendChild(timestampsInfo);
          contextGrid.appendChild(statusRow);

          expDetailsInner.appendChild(contextGrid);

          // If Expired: review deadline elapsed banner
          if (isExpired && req.status === ApprovalStatus.PENDING) {
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
            expDetailsInner.appendChild(expiredBanner);
          }

          // Tucked Developer & Audit Disclosure (Hidden behind clean details element for developer / compliance review)
          const auditDetails = document.createElement('details');
          auditDetails.className = 'gd-technical-audit-details';

          const auditSummary = document.createElement('summary');
          auditSummary.className = 'gd-audit-summary';
          auditSummary.textContent = 'Developer & Audit Trail';
          auditDetails.appendChild(auditSummary);

          const auditBody = document.createElement('div');
          auditBody.className = 'gd-audit-body';

          const idBadge = document.createElement('span');
          idBadge.className = 'gd-detail-id';
          idBadge.textContent = `Canonical Request ID: ${req.id}`;
          auditBody.appendChild(idBadge);

          // Decoupled Action Execution Notice (Preserving test contract selector)
          const decouplingBox = document.createElement('div');
          decouplingBox.className = 'gd-action-decoupling-note';
          decouplingBox.setAttribute('role', 'note');

          const decP = document.createElement('p');
          decP.textContent =
            'Approval decisions update this server record only. They do not execute or trigger an action in the ward’s browser. The extension must revalidate its local action state and require explicit user confirmation before any supported continuation.';
          decouplingBox.appendChild(decP);
          auditBody.appendChild(decouplingBox);

          // Decoupled Execution Architecture notice
          const noticeBox = document.createElement('div');
          noticeBox.className = 'gd-decision-notice';
          noticeBox.setAttribute('role', 'note');

          const notP = document.createElement('p');
          notP.textContent =
            'Decoupled Execution Architecture: Approving this request records reviewer consent on the Guardrail backend. It does NOT remotely execute the action in the ward’s browser. The user retains sole continuation authority in Staging Mode.';
          noticeBox.appendChild(notP);
          auditBody.appendChild(noticeBox);

          // Heuristic Risk Reasons list
          if (req.riskReasons && Array.isArray(req.riskReasons) && req.riskReasons.length > 0) {
            const ul = document.createElement('ul');
            ul.className = 'gd-risk-reasons-list';
            for (const reason of req.riskReasons) {
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
          expDetailsInner.appendChild(auditDetails);
          detailsContainer.appendChild(expDetailsInner);
          card.appendChild(detailsContainer);

          // Card Selection Event Handlers
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
        }
      }
    }
  }

  layout.appendChild(listPane);
  section.appendChild(layout);
  return section;
}
