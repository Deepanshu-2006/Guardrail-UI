/**
 * Guardrail Trusted-Contact Dashboard - Pending Approvals Component
 *
 * Implements the two-pane layout:
 * - Left Pane: Filterable list of pending approval requests.
 * - Right Pane: Structured request detail inspector with risk reasons, metadata, and decoupling notices.
 * Includes intentional loading, error, and empty placeholders.
 * Note: Approval decision submission is intentionally deferred to Day 13+.
 */

import { ApprovalRequest, RequestFilters, ViewStatus } from '../types.js';
import { renderRequestDetailView } from './detail.js';
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
    'Inspect held browser actions requiring trusted contact review before the user may proceed in Staging Mode.';

  titleGroup.appendChild(title);
  titleGroup.appendChild(subtitle);
  header.appendChild(titleGroup);

  // Refresh Action Button
  if (props.onRefresh) {
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'gd-btn-refresh';
    refreshBtn.setAttribute('aria-label', 'Refresh pending approval requests');
    if (props.status === 'loading') {
      refreshBtn.disabled = true;
      refreshBtn.setAttribute('aria-busy', 'true');
    }
    refreshBtn.innerHTML = `
      <svg class="gd-icon ${props.status === 'loading' ? 'gd-spin' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
      </svg>
      <span>${props.status === 'loading' ? 'Refreshing...' : 'Refresh'}</span>
    `;
    refreshBtn.addEventListener('click', () => {
      props.onRefresh?.();
    });
    header.appendChild(refreshBtn);
  }

  section.appendChild(header);

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
    icon.textContent = '⚠️';

    const errorText = document.createElement('span');
    errorText.className = 'gd-error-text';
    errorText.textContent = props.errorMessage;

    errorContent.appendChild(icon);
    errorContent.appendChild(errorText);
    errorBanner.appendChild(errorContent);

    if (props.onRefresh) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
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
  } else if (props.requests.length === 0) {
    // Empty Placeholder
    const emptyPlaceholder = document.createElement('div');
    emptyPlaceholder.className = 'gd-placeholder';

    const icon = document.createElement('div');
    icon.className = 'gd-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🛡️';

    const pTitle = document.createElement('h2');
    pTitle.className = 'gd-placeholder-title';
    pTitle.textContent = 'No Pending Approval Requests';

    const pText = document.createElement('p');
    pText.className = 'gd-placeholder-text';
    pText.textContent =
      'All protected actions have been evaluated or resolved. Incoming requests initiated from your wards’ Staging Mode will appear here in real time.';

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
        const card = document.createElement('article');
        card.className = `gd-request-card ${isSelected ? 'selected' : ''}`;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        card.setAttribute('aria-label', `Review request ${req.id}: ${req.actionDescription}`);

        // Card Header: ID and Risk Badge
        const cardHeader = document.createElement('div');
        cardHeader.className = 'gd-request-card-header';

        const idSpan = document.createElement('span');
        idSpan.className = 'gd-request-id';
        idSpan.textContent = req.id.slice(0, 16) + '...';

        const riskBadge = document.createElement('span');
        const riskClass = (req.riskLevel || 'LOW').toLowerCase();
        riskBadge.className = `gd-risk-badge ${riskClass}`;
        riskBadge.textContent = req.riskLevel || 'LOW';

        cardHeader.appendChild(idSpan);
        cardHeader.appendChild(riskBadge);

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
  });

  layout.appendChild(detailPane);
  section.appendChild(layout);

  return section;
}
