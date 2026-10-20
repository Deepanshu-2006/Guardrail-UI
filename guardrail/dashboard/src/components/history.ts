/**
 * Guardrail Trusted-Contact Dashboard - Decision History Component
 *
 * Implements the authoritative Decision History and Audit Log:
 * 1. Two-pane layout matching Pending Approvals for visual and ergonomic consistency:
 *    - Left pane: Filterable, searchable list of resolved requests (APPROVED, REJECTED, CANCELLED, EXPIRED).
 *    - Right pane: Request detail inspector displaying full governance audit trail and reviewer notes.
 * 2. Visual Distinction:
 *    - Resolved cards display authoritative status pills (green APPROVED, red REJECTED, slate CANCELLED, amber EXPIRED).
 *    - Status badges, resolved timestamps, and reviewer attribution prominently displayed.
 * 3. Useful Filtering & Search:
 *    - Filters by Decision Status (ALL, APPROVED, REJECTED, CANCELLED, EXPIRED).
 *    - Filters by Risk Level (ALL, CRITICAL, HIGH, MEDIUM, LOW).
 *    - Filters by Date Range (ALL, TODAY/24h, 7_DAYS, 30_DAYS).
 *    - Safe keyword search over non-sensitive fields (description, hostname, ID, category, audit notes).
 * 4. Architectural Capability Documentation:
 *    - Documents the server-side history endpoint status (`GET /api/v1/approvals/history` on roadmap)
 *      without generating fictional history.
 * 5. Distinct Empty States:
 *    - Empty view state ("No Prior Decisions Recorded").
 *    - Empty filter state ("No Matching Requests Found" with Clear Filters button).
 */

import { ApprovalRequest, ApprovalStatus, RequestFilters } from '../types.js';
import { formatTimestamp, renderRequestDetailView } from './detail.js';
import { filterRequests, renderFilterBar, renderFilterEmptyState } from './filters.js';

export interface DecisionHistoryProps {
  /** Authoritative historical / resolved requests */
  requests?: readonly ApprovalRequest[];
  /** Identifier of the currently selected request in the detail pane */
  selectedRequestId?: string | null;
  /** Selected request detail record (if loaded/cached) */
  selectedRequestDetail?: ApprovalRequest | null;
  /** Whether request details are currently being loaded from the backend */
  isDetailLoading?: boolean;
  /** Optional error message if loading details failed */
  detailErrorMessage?: string | null;
  /** Current filter settings */
  filters?: RequestFilters;
  /** Callback when user selects a request from the list */
  onRequestSelect?: (requestId: string) => void;
  /** Callback when user changes filter settings */
  onFiltersChange?: (filters: RequestFilters) => void;
  /** Optional callback to refresh */
  onRefresh?: () => void;
  /** Optional callback to refresh detail */
  onRefreshDetail?: () => void;

  // Backward compatibility alias:
  historyRequests?: readonly ApprovalRequest[];
}

export function renderDecisionHistory(props: DecisionHistoryProps): HTMLElement {
  const allRequests: readonly ApprovalRequest[] = props.requests ?? props.historyRequests ?? [];
  const activeFilters: RequestFilters = props.filters ?? {
    status: 'ALL',
    riskLevel: 'ALL',
    dateRange: 'ALL',
    searchQuery: '',
  };

  const section = document.createElement('section');
  section.id = 'view-history';
  section.className = 'gd-view-section';
  section.setAttribute('aria-labelledby', 'history-title');

  // 1. Header
  const header = document.createElement('header');
  header.className = 'gd-section-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'gd-section-title-group';

  const title = document.createElement('h1');
  title.id = 'history-title';
  title.className = 'gd-section-title';
  title.textContent = 'Decision History & Audit Log';

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-section-subtitle';
  subtitle.textContent =
    'Permanent compliance audit trail recording all approved, rejected, expired, or cancelled requests.';

  titleGroup.appendChild(title);
  titleGroup.appendChild(subtitle);
  header.appendChild(titleGroup);

  // Refresh Button
  if (props.onRefresh) {
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'gd-btn-refresh';
    refreshBtn.setAttribute('aria-label', 'Refresh decision history');
    refreshBtn.innerHTML = `
      <svg class="gd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
      </svg>
      <span>Refresh</span>
    `;
    refreshBtn.addEventListener('click', () => {
      props.onRefresh?.();
    });
    header.appendChild(refreshBtn);
  }

  section.appendChild(header);

  // 2. Architectural Backend Capability Notice
  // Strictly documents backend capabilities without generating fictional history
  const noticeBox = document.createElement('div');
  noticeBox.className = 'gd-history-notice';
  noticeBox.setAttribute('role', 'note');

  const noticeHeader = document.createElement('div');
  noticeHeader.className = 'gd-history-notice-header';

  const noticeIcon = document.createElement('span');
  noticeIcon.className = 'gd-notice-icon';
  noticeIcon.setAttribute('aria-hidden', 'true');
  noticeIcon.textContent = 'ℹ️';

  const noticeTitle = document.createElement('strong');
  noticeTitle.textContent = 'Authoritative Decision History';

  noticeHeader.appendChild(noticeIcon);
  noticeHeader.appendChild(noticeTitle);

  const noticeDesc = document.createElement('p');
  noticeDesc.className = 'gd-notice-text';
  noticeDesc.textContent =
    'This audit view presents authoritative decision records committed during your active session. Cross-session persistent querying requires the dedicated server-side history endpoint (GET /api/v1/approvals/history), documented on the backend roadmap.';

  noticeBox.appendChild(noticeHeader);
  noticeBox.appendChild(noticeDesc);
  section.appendChild(noticeBox);

  // 3. Empty State Check (0 total requests in history)
  if (allRequests.length === 0) {
    const card = document.createElement('div');
    card.className = 'gd-card';

    const placeholder = document.createElement('div');
    placeholder.className = 'gd-placeholder';

    const icon = document.createElement('div');
    icon.className = 'gd-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '📜';

    const pTitle = document.createElement('h2');
    pTitle.className = 'gd-placeholder-title';
    pTitle.textContent = 'No Prior Decisions Recorded';

    const pText = document.createElement('p');
    pText.className = 'gd-placeholder-text';
    pText.textContent =
      'Decisions submitted by trusted contacts (or actions cancelled by wards) will be archived here with immutable timestamps and reviewer signatures.';

    placeholder.appendChild(icon);
    placeholder.appendChild(pTitle);
    placeholder.appendChild(pText);
    card.appendChild(placeholder);
    section.appendChild(card);

    return section;
  }

  // 4. Two-Pane History Layout (when historical items exist)
  const layout = document.createElement('div');
  layout.className = 'gd-approvals-layout gd-history-layout';

  // --- Left Pane: History List & Filters ---
  const listPane = document.createElement('div');
  listPane.className = 'gd-list-pane';
  listPane.setAttribute('role', 'region');
  listPane.setAttribute('aria-label', 'Decision History List');

  // Filter requests using active filters
  const filteredRequests = filterRequests(allRequests, activeFilters);

  // Render Filter Bar
  const filterBar = renderFilterBar({
    filters: activeFilters,
    totalCount: allRequests.length,
    filteredCount: filteredRequests.length,
    showStatusFilter: true,
    showRiskFilter: true,
    showDateFilter: true,
    searchPlaceholder: 'Search history by description, website, or ID...',
    onFiltersChange: (newFilters) => {
      props.onFiltersChange?.(newFilters);
    },
  });
  listPane.appendChild(filterBar);

  if (filteredRequests.length === 0) {
    // Filter Empty State
    const emptyFilter = renderFilterEmptyState({
      title: 'No Matching Decisions Found',
      description: 'No historical decisions match your filter or search criteria. Try adjusting your filters or search query.',
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
    // Render History Cards
    for (const req of filteredRequests) {
      const isSelected = req.id === props.selectedRequestId;
      const card = document.createElement('article');
      const statusClass = (req.status || ApprovalStatus.APPROVED).toLowerCase();
      card.className = `gd-request-card gd-history-card status-${statusClass} ${isSelected ? 'selected' : ''}`;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      card.setAttribute('aria-label', `View decision details for ${req.id}: ${req.actionDescription}`);

      // Card Header: ID, Status Pill, Risk Badge
      const cardHeader = document.createElement('div');
      cardHeader.className = 'gd-request-card-header gd-history-card-header';

      const idSpan = document.createElement('span');
      idSpan.className = 'gd-request-id';
      idSpan.textContent = req.id.slice(0, 16) + '...';

      const headerBadges = document.createElement('div');
      headerBadges.className = 'gd-history-header-badges';

      // Visual distinction: prominent resolved status pill
      const statusPill = document.createElement('span');
      statusPill.className = `gd-detail-status-pill ${statusClass}`;
      statusPill.textContent = req.status || 'RESOLVED';

      const riskBadge = document.createElement('span');
      const riskClass = (req.riskLevel || 'LOW').toLowerCase();
      riskBadge.className = `gd-risk-badge ${riskClass}`;
      riskBadge.textContent = req.riskLevel || 'LOW';

      headerBadges.appendChild(statusPill);
      headerBadges.appendChild(riskBadge);
      cardHeader.appendChild(idSpan);
      cardHeader.appendChild(headerBadges);

      // Card Description
      const desc = document.createElement('h2');
      desc.className = 'gd-request-description';
      desc.textContent = req.actionDescription;

      // Card Meta (Resolved timestamp & reviewer signature)
      const meta = document.createElement('div');
      meta.className = 'gd-request-meta gd-history-meta';

      const originSpan = document.createElement('span');
      originSpan.textContent = req.hostname || 'Local Interaction';

      const resolvedTimeSpan = document.createElement('span');
      const timeLabel = req.status === ApprovalStatus.CANCELLED ? 'Cancelled' : req.status === ApprovalStatus.EXPIRED ? 'Expired' : 'Decided';
      resolvedTimeSpan.textContent = `${timeLabel}: ${formatTimestamp(req.resolvedAt || req.createdAt)}`;

      meta.appendChild(originSpan);
      meta.appendChild(resolvedTimeSpan);

      if (req.decision?.decidedBy) {
        const reviewerSpan = document.createElement('span');
        reviewerSpan.className = 'gd-history-reviewer-tag';
        reviewerSpan.textContent = `Reviewer: ${req.decision.decidedBy}`;
        meta.appendChild(reviewerSpan);
      }

      card.appendChild(cardHeader);
      card.appendChild(desc);
      card.appendChild(meta);

      // Keyboard & Click Handlers
      const selectAction = () => props.onRequestSelect?.(req.id);
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

  layout.appendChild(listPane);

  // --- Right Pane: Historical Request Details ---
  const selectedRequest =
    props.selectedRequestDetail !== undefined
      ? props.selectedRequestDetail
      : (filteredRequests.find((r) => r.id === props.selectedRequestId) ||
         allRequests.find((r) => r.id === props.selectedRequestId) ||
         filteredRequests[0] ||
         null);

  const detailPane = renderRequestDetailView({
    request: selectedRequest,
    isLoading: props.isDetailLoading,
    errorMessage: props.detailErrorMessage,
    onRefresh: props.onRefreshDetail,
  });

  layout.appendChild(detailPane);
  section.appendChild(layout);

  return section;
}
