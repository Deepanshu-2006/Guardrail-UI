/**
 * Guardrail Trusted-Contact Dashboard - Pending Approvals Component
 *
 * Implements the two-pane layout:
 * - Left Pane: Filterable list of pending approval requests.
 * - Right Pane: Structured request detail inspector with risk reasons, metadata, and decoupling notices.
 * Includes intentional loading, error, and empty placeholders.
 * Note: Approval decision submission is intentionally deferred to Day 13+.
 */

import { ApprovalRequest, ApprovalStatus, RequestFilters, ViewStatus } from '../types.js';
import { formatExpirationInfo, isRequestExpired, renderRequestDetailView } from './detail.js';
import { filterRequests, renderFilterBar, renderFilterEmptyState } from './filters.js';

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
  onDecisionSubmit?: (decision: 'APPROVED' | 'REJECTED', reason?: string) => void | Promise<unknown>;
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

export function renderPendingApprovals(props: PendingApprovalsProps): HTMLElement {
  const section = document.createElement('section');
  section.id = 'view-pending';
  section.className = 'gd-view-section';
  section.setAttribute('aria-labelledby', 'pending-title');

  // Header
  const header = document.createElement('header');
  header.className = 'gd-section-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'gd-section-title-group';

  const title = document.createElement('h1');
  title.id = 'pending-title';
  title.className = 'gd-section-title';
  title.textContent = 'Pending Approval Requests';

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-section-subtitle';
  subtitle.textContent =
    'Review and manage pending browsing approval requests from your contacts.';

  titleGroup.appendChild(title);
  titleGroup.appendChild(subtitle);
  header.appendChild(titleGroup);

  // Header Actions (Sync status & Refresh)
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

  // Refresh Action Button
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
    refreshBtn.innerHTML = `
      <svg class="gd-icon ${isBusy ? 'gd-spin' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
      </svg>
      <span>${isBusy ? 'Refreshing...' : 'Refresh'}</span>
    `;
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

  // Stale Data Notice (Task 3: Displayed when cached requests exist but latest refresh failed)
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

  // Two-Pane Layout
  const layout = document.createElement('div');
  layout.className = 'gd-approvals-layout';

  // --- Left Pane: Request List ---
  const listPane = document.createElement('div');
  listPane.className = 'gd-list-pane';
  listPane.setAttribute('role', 'region');
  listPane.setAttribute('aria-label', 'Pending Requests List');

  const activeFilters: RequestFilters = props.filters ?? {
    status: 'ALL',
    riskLevel: 'ALL',
    dateRange: 'ALL',
    searchQuery: '',
  };

  if (props.status === 'loading') {
    // Skeleton Loading State
    const skeletonCard = document.createElement('div');
    skeletonCard.className = 'gd-request-card';
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
    // Failed request / Unavailable backend when list is empty (Task 3: Never confuse empty with failed)
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
  } else if (props.requests.length === 0) {
    // Genuinely Empty Placeholder (All Clear)
    const emptyPlaceholder = document.createElement('div');
    emptyPlaceholder.className = 'gd-placeholder gd-empty-state';

    const icon = document.createElement('div');
    icon.className = 'gd-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');

    const pTitle = document.createElement('h2');
    pTitle.className = 'gd-placeholder-title';
    pTitle.textContent = 'No Pending Approval Requests';

    const pText = document.createElement('p');
    pText.className = 'gd-placeholder-text';
    pText.textContent =
      'There are no pending approval requests waiting for review. When an action requires approval, it will appear here.';

    emptyPlaceholder.appendChild(icon);
    emptyPlaceholder.appendChild(pTitle);
    emptyPlaceholder.appendChild(pText);
    listPane.appendChild(emptyPlaceholder);
  } else {
    // Apply filters
    const filteredRequests = filterRequests(props.requests, activeFilters);

    // Filter Bar
    const filterBar = renderFilterBar({
      filters: activeFilters,
      totalCount: props.requests.length,
      filteredCount: filteredRequests.length,
      showStatusFilter: false,
      showRiskFilter: true,
      showDateFilter: true,
      searchPlaceholder: 'Search pending requests by description, website, or ID...',
      onFiltersChange: (newFilters) => {
        props.onFiltersChange?.(newFilters);
      },
    });
    listPane.appendChild(filterBar);

    if (filteredRequests.length === 0) {
      // Filter Empty State
      const emptyFilter = renderFilterEmptyState({
        title: 'No Matching Pending Requests',
        description: 'No pending requests match the current filter and search criteria. Try adjusting your filters or search query.',
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
      // Render Request Cards
      for (const req of filteredRequests) {
        const isSelected = req.id === props.selectedRequestId;
        const isExpired = isRequestExpired(req);
        const card = document.createElement('article');
        card.className = `gd-request-card ${isSelected ? 'selected' : ''} ${isExpired ? 'is-expired' : ''}`;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        card.setAttribute('aria-label', `Review request ${req.id}: ${req.actionDescription}`);

        // Card Header: ID, Status Badge (if applicable), and Risk Badge
        const cardHeader = document.createElement('div');
        cardHeader.className = 'gd-request-card-header';

        const idSpan = document.createElement('span');
        idSpan.className = 'gd-request-id';
        idSpan.textContent = req.id.slice(0, 16) + '...';

        const headerBadges = document.createElement('div');
        headerBadges.className = 'gd-pending-card-badges';

        if (req.status && req.status !== ApprovalStatus.PENDING) {
          const statusBadge = document.createElement('span');
          statusBadge.className = `gd-status-badge ${req.status.toLowerCase()}`;
          statusBadge.textContent = req.status;
          headerBadges.appendChild(statusBadge);
        } else if (isExpired) {
          const expBadge = document.createElement('span');
          expBadge.className = 'gd-status-badge expired';
          expBadge.textContent = 'EXPIRED';
          headerBadges.appendChild(expBadge);
        }

        const riskBadge = document.createElement('span');
        const riskClass = (req.riskLevel || 'LOW').toLowerCase();
        riskBadge.className = `gd-risk-badge ${riskClass}`;
        riskBadge.textContent = req.riskLevel || 'LOW';
        headerBadges.appendChild(riskBadge);

        cardHeader.appendChild(idSpan);
        cardHeader.appendChild(headerBadges);

        // Card Description
        const desc = document.createElement('h2');
        desc.className = 'gd-request-description';
        desc.textContent = req.actionDescription;

        // Card Meta
        const meta = document.createElement('div');
        meta.className = 'gd-request-meta';

        const originSpan = document.createElement('span');
        originSpan.textContent = req.hostname || 'Local Interaction';

        const timeSpan = document.createElement('span');
        timeSpan.textContent = req.createdAt ? new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending';

        meta.appendChild(originSpan);
        meta.appendChild(timeSpan);

        if (req.expiresAt) {
          const expInfo = formatExpirationInfo(req.expiresAt);
          const expSpan = document.createElement('span');
          expSpan.className = expInfo.isPast ? 'gd-card-meta-expired' : 'gd-card-meta-expires';
          expSpan.textContent = expInfo.isPast
            ? '⚠️ Expired'
            : `Expires: ${new Date(req.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          meta.appendChild(expSpan);
        }

        card.appendChild(cardHeader);
        card.appendChild(desc);
        card.appendChild(meta);

        // Event handlers
        const selectAction = () => props.onRequestSelect(req.id);
        card.addEventListener('click', selectAction);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectAction();
          }
        });

        listPane.appendChild(card);
      }
    }
  }

  layout.appendChild(listPane);

  // --- Right Pane: Request Details ---
  const selectedRequest =
    props.selectedRequestDetail !== undefined
      ? props.selectedRequestDetail
      : (props.requests.find((r) => r.id === props.selectedRequestId) ?? null);

  const detailPane = renderRequestDetailView({
    request: selectedRequest,
    isLoading: props.isDetailLoading,
    errorMessage: props.detailErrorMessage,
    onRefresh: props.onRefreshDetail,
    isSubmittingDecision: props.isSubmittingDecision,
    decisionErrorMessage: props.decisionErrorMessage,
    decisionSuccessMessage: props.decisionSuccessMessage,
    onDecisionSubmit: props.onDecisionSubmit,
    isBackendUnavailable: props.isBackendUnavailable,
  });

  layout.appendChild(detailPane);
  section.appendChild(layout);

  return section;
}
