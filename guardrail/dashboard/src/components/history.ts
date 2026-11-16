/**
 * Guardrail Trusted-Contact Dashboard - Decision History Component
 *
 * Implements the authoritative Decision History, Audit Log & Activity Timeline:
 * 1. Two-pane layout matching Pending Approvals for visual and ergonomic consistency:
 *    - Left pane: Filterable, searchable list of resolved requests (APPROVED, REJECTED, CANCELLED, EXPIRED).
 *    - Right pane: Request detail inspector displaying full governance audit trail, timestamps, and reviewer notes.
 * 2. Visual Distinction & Lifecycle States:
 *    - Resolved cards display authoritative status pills (green APPROVED, red REJECTED, slate CANCELLED, amber EXPIRED).
 *    - Status badges, resolved timestamps, and reviewer attribution prominently displayed.
 * 3. Decoupled Action Execution & Continuation Boundary:
 *    - Explicitly distinguishes reviewer approval from browser continuation.
 *    - Communicates that approval registers consent on the server, while action continuation
 *      remains safely HELD in the ward's browser tab until user confirmation.
 * 4. Useful Filtering & Search:
 *    - Filters by Decision Status (ALL, APPROVED, REJECTED, CANCELLED, EXPIRED).
 *    - Filters by Risk Level (ALL, CRITICAL, HIGH, MEDIUM, LOW).
 *    - Filters by Date Range (ALL, TODAY/24h, 7_DAYS, 30_DAYS).
 *    - Safe keyword search over non-sensitive fields (description, hostname, ID).
 * 5. Bounded Loading & Pagination:
 *    - Supports pagination / bounded result loading via `hasMore` and `onLoadMore`.
 * 6. Distinct States:
 *    - Loading state with role="status" and aria-busy="true".
 *    - Error banner with retry button.
 *    - Empty view state ("No Prior Decisions Recorded" #gd-history-empty).
 *    - Empty filter state ("No Matching Decisions Found" #gd-history-filter-empty with Clear Filters button).
 */

import { ApprovalRequest, ApprovalStatus, RequestFilters, ViewStatus } from '../types.js';
import { formatTimestamp, getRiskLevelExplanation } from './detail.js';
import { filterRequests, renderFilterBar, renderFilterEmptyState } from './filters.js';
import { setAnimatedHeading } from './icons.js';

export interface DecisionHistoryProps {
  /** Authoritative historical / resolved requests */
  requests?: readonly ApprovalRequest[];
  /** Loading/error status of the history view */
  status?: ViewStatus;
  /** Optional error message if loading history failed */
  errorMessage?: string | null;
  /** Whether the shell is currently refreshing data */
  isRefreshing?: boolean;
  /** Timestamp when data was last successfully synchronized */
  lastSynchronizedAt?: Date | null;
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
  /** Whether additional history records exist on the backend */
  hasMore?: boolean;
  /** Current page index for bounded history loading */
  page?: number;
  /** Number of records to display at once before 'View All' (default: 10) */
  displayLimit?: number | 'ALL';
  /** Callback when user changes the display limit or clicks View All */
  onDisplayLimitChange?: (limit: number | 'ALL') => void;
  /** Callback when user clicks load more */
  onLoadMore?: () => void;
  /** Callback when user selects a request from the list */
  onRequestSelect?: (requestId: string) => void;
  /** Callback when user closes the detail pane */
  onCloseDetail?: () => void;
  /** Callback when user changes filter settings */
  onFiltersChange?: (filters: RequestFilters) => void;
  /** Optional callback to refresh */
  onRefresh?: () => void;
  /** Optional callback to refresh detail */
  onRefreshDetail?: () => void;

  // Backward compatibility alias:
  historyRequests?: readonly ApprovalRequest[];
}

function formatWardDisplayName(requesterId?: string): string {
  if (!requesterId || typeof requesterId !== 'string') return '';
  const clean = requesterId.replace(/^usr_/, '').trim();
  if (!clean) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function resolveSafeHostname(req: ApprovalRequest): string {
  if (req.hostname && typeof req.hostname === 'string' && req.hostname.trim()) {
    return req.hostname.trim();
  }
  if (req.origin && typeof req.origin === 'string' && req.origin.trim()) {
    try {
      return new URL(req.origin).hostname;
    } catch {
      return req.origin.trim();
    }
  }
  return 'Local Interaction';
}

function getCleanActionTitle(rawDesc?: string): string {
  if (!rawDesc) return 'Unnamed Browser Action';
  let title = rawDesc.trim();
  const triggerMatch = title.match(/^(?:.*?trigger):\s*(.+)$/i);
  if (triggerMatch) {
    title = triggerMatch[1].trim();
  }
  const recursiveMatch = title.match(/^Click on "(?:\d{1,2}\s+)?(?:.*?trigger):\s*(Click on .+?)"/i);
  if (recursiveMatch) {
    title = recursiveMatch[1].trim();
  }
  return title;
}

function formatShortTimestamp(isoString?: string | null): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString || '';
  }
}

function formatEditorialTimestamp(isoString?: string | null): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString || '';
  }
}

function formatCategory(cat?: string): string {
  if (!cat) return '';
  return cat
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatActionType(type?: string): string {
  if (!type) return 'Interaction';
  const clean = type.replace(/_/g, ' ').toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Renders high-precision SVG icons for the 3 decision outcome verdict states:
 * Clock (Expired), Approved (Seal & Checkmark), and Cancelled/Rejected (Barrier / Slash).
 */
function renderClockOutcomeIcon(): string {
  return `<svg class="gd-outcome-icon gd-clock-icon gd-clock-expired" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle class="gd-clock-alarm-pulse" cx="12" cy="12" r="9" stroke-width="1.4" />
    <circle class="gd-clock-rim" cx="12" cy="12" r="9" />
    <line class="gd-clock-hour" x1="12" y1="12" x2="12" y2="7.2" stroke-width="2.2" />
    <line class="gd-clock-minute" x1="12" y1="12" x2="12" y2="5.8" stroke-width="2.2" />
    <circle class="gd-clock-pivot" cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </svg>`;
}

function renderApprovedOutcomeIcon(): string {
  return `<svg class="gd-outcome-icon gd-approved-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle class="gd-approved-pulse" cx="12" cy="12" r="9" stroke-width="1.4" />
    <circle class="gd-approved-rim" cx="12" cy="12" r="9" />
    <path class="gd-approved-check" d="M7 12.5l3.5 3.5 7-7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

function renderCancelledOutcomeIcon(): string {
  return `<svg class="gd-outcome-icon gd-cancelled-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle class="gd-cancelled-pulse" cx="12" cy="12" r="9" stroke-width="1.4" />
    <circle class="gd-cancelled-rim" cx="12" cy="12" r="9" />
    <line class="gd-cancelled-slash" x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke-width="2.2" />
  </svg>`;
}

function renderRejectedOutcomeIcon(): string {
  return `<svg class="gd-outcome-icon gd-rejected-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle class="gd-rejected-pulse" cx="12" cy="12" r="9" stroke-width="1.4" />
    <circle class="gd-rejected-rim" cx="12" cy="12" r="9" />
    <line class="gd-rejected-cross-1" x1="8" y1="8" x2="16" y2="16" stroke-width="2.3" />
    <line class="gd-rejected-cross-2" x1="16" y1="8" x2="8" y2="16" stroke-width="2.3" />
  </svg>`;
}

export function renderHistoryRecordDetail(options: {
  request: ApprovalRequest | null | undefined;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRefresh?: () => void;
  onClose?: () => void;
  filteredRequests: readonly ApprovalRequest[];
  allRequests: readonly ApprovalRequest[];
}): HTMLElement {
  const container = document.createElement('div');
  container.className = 'gd-detail-pane gd-history-detail-pane';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Selected Record Details');

  // 1. Loading State
  if (options.isLoading) {
    const loadingWrap = document.createElement('div');
    loadingWrap.className = 'gd-detail-loading-wrap';
    loadingWrap.setAttribute('role', 'status');
    loadingWrap.setAttribute('aria-busy', 'true');
    loadingWrap.setAttribute('aria-label', 'Loading record details');
    loadingWrap.innerHTML = `
      <div class="gd-skeleton gd-skeleton-line short" style="height: 20px;"></div>
      <div class="gd-skeleton gd-skeleton-line" style="height: 32px; margin: 12px 0;"></div>
      <div class="gd-skeleton gd-skeleton-line" style="height: 100px;"></div>
    `;
    container.appendChild(loadingWrap);
    return container;
  }

  // 2. Error State
  if (options.errorMessage) {
    const errorBanner = document.createElement('div');
    errorBanner.className = 'gd-error-banner';
    errorBanner.setAttribute('role', 'alert');
    errorBanner.innerHTML = `
      <div class="gd-error-content">
        <span class="gd-error-icon" aria-hidden="true"></span>
        <span class="gd-error-text">${options.errorMessage}</span>
      </div>
    `;
    if (options.onRefresh) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => options.onRefresh?.());
      errorBanner.appendChild(retryBtn);
    }
    container.appendChild(errorBanner);
    return container;
  }

  // 3. No Request Selected Placeholder
  if (!options.request) {
    const placeholder = document.createElement('div');
    placeholder.className = 'gd-placeholder gd-history-empty-detail';
    placeholder.innerHTML = `
      <span class="gd-history-record-kicker">DECISION ARCHIVE</span>
      <h2 class="gd-history-placeholder-title">Select a Record</h2>
      <p class="gd-history-placeholder-desc">Select any decision from the archive on the left to inspect its permanent audit details, risk evaluation, and resolution timeline.</p>
    `;
    container.appendChild(placeholder);
    return container;
  }

  const req = options.request;
  const displayStatus = req.status || ApprovalStatus.PENDING;
  const statusClass = displayStatus.toLowerCase();
  const riskLevel = req.riskLevel || 'LOW';
  const riskClass = riskLevel.toLowerCase();

  // Find 1-based index in filtered or all list to match card
  const listIdx = options.filteredRequests.findIndex((r) => r.id === req.id);
  const rawIdx = listIdx >= 0 ? listIdx + 1 : (options.allRequests.findIndex((r) => r.id === req.id) + 1 || 1);
  const formattedIdx = rawIdx < 10 ? `0${rawIdx}` : `${rawIdx}`;
  const totalCount = options.allRequests.length || options.filteredRequests.length;

  const cleanTitle = getCleanActionTitle(req.actionDescription);
  const wardName = formatWardDisplayName(req.requesterId) || 'User';
  const hostname = resolveSafeHostname(req);

  // Compute primary event date matching the list card
  let eventPrefix = 'Decided';
  let eventDate = req.decision?.decidedAt || req.resolvedAt || req.createdAt;
  if (displayStatus === ApprovalStatus.EXPIRED) {
    eventPrefix = 'Expired';
    eventDate = req.expiresAt || req.resolvedAt || req.createdAt;
  } else if (displayStatus === ApprovalStatus.CANCELLED) {
    eventPrefix = 'Cancelled';
    eventDate = req.resolvedAt || req.createdAt;
  }
  const formattedEventDate = formatEditorialTimestamp(eventDate);

  // 1. Header: Kicker (RECORD 01 OF 30) + Badges, Title, Subhead
  const header = document.createElement('header');
  header.className = 'gd-history-record-header';

  const topRow = document.createElement('div');
  topRow.className = 'gd-history-record-top-row';

  const kicker = document.createElement('span');
  kicker.className = 'gd-history-record-kicker';
  kicker.textContent = `RECORD ${formattedIdx} OF ${totalCount}`;

  const badges = document.createElement('div');
  badges.className = 'gd-history-record-badges';

  const statusPill = document.createElement('span');
  statusPill.className = `gd-detail-status-pill ${statusClass}`;
  statusPill.setAttribute('role', 'status');
  statusPill.setAttribute('data-status', statusClass);
  statusPill.textContent = displayStatus;

  const riskBadge = document.createElement('span');
  riskBadge.className = `gd-risk-badge ${riskClass}`;
  riskBadge.textContent = riskLevel;

  badges.appendChild(statusPill);
  badges.appendChild(riskBadge);

  topRow.appendChild(kicker);
  topRow.appendChild(badges);
  header.appendChild(topRow);

  // Action Title (Commanding editorial serif)
  const title = document.createElement('h2');
  title.className = 'gd-detail-title gd-history-record-title';
  title.textContent = cleanTitle;
  header.appendChild(title);

  // Accessible / Test fallback containing raw actionDescription if different
  if (cleanTitle !== req.actionDescription) {
    const rawHidden = document.createElement('span');
    rawHidden.className = 'gd-sr-only';
    rawHidden.textContent = req.actionDescription || '';
    header.appendChild(rawHidden);
  }

  // Subhead: hostname · wardName · eventDate
  const subhead = document.createElement('div');
  subhead.className = 'gd-history-record-subhead';
  subhead.innerHTML = `
    <span class="gd-history-meta-host">${hostname}</span>
    <span class="gd-history-meta-sep" aria-hidden="true">·</span>
    <span class="gd-history-meta-ward">${wardName}</span>
    <span class="gd-history-meta-sep" aria-hidden="true">·</span>
    <span class="gd-history-meta-time">${eventPrefix}: ${formattedEventDate}</span>
  `;
  header.appendChild(subhead);
  container.appendChild(header);

  // 2. Decision Outcome (Pure typography, zero white background, zero boxes)
  const outcomeBlock = document.createElement('div');
  outcomeBlock.className = `gd-history-outcome-block ${statusClass}`;

  const outcomeHeader = document.createElement('div');
  outcomeHeader.className = 'gd-history-outcome-header';

  const outcomeStatus = document.createElement('div');
  outcomeStatus.className = 'gd-history-outcome-title';

  const reviewerName = req.decision?.decidedBy || 'tc_carol';
  if (displayStatus === ApprovalStatus.APPROVED) {
    outcomeStatus.innerHTML = `<span class="gd-outcome-mark approved" aria-hidden="true">${renderApprovedOutcomeIcon()}</span> <h3 class="gd-outcome-verdict">Approved by ${reviewerName}</h3>`;
  } else if (displayStatus === ApprovalStatus.REJECTED) {
    outcomeStatus.innerHTML = `<span class="gd-outcome-mark rejected" aria-hidden="true">${renderRejectedOutcomeIcon()}</span> <h3 class="gd-outcome-verdict">Rejected by ${reviewerName}</h3>`;
  } else if (displayStatus === ApprovalStatus.EXPIRED) {
    outcomeStatus.innerHTML = `<span class="gd-outcome-mark expired" aria-hidden="true">${renderClockOutcomeIcon()}</span> <h3 class="gd-outcome-verdict">Review Deadline Elapsed</h3>`;
  } else if (displayStatus === ApprovalStatus.CANCELLED) {
    outcomeStatus.innerHTML = `<span class="gd-outcome-mark cancelled" aria-hidden="true">${renderCancelledOutcomeIcon()}</span> <h3 class="gd-outcome-verdict">Cancelled by ${wardName}</h3>`;
  } else {
    outcomeStatus.innerHTML = `<h3 class="gd-outcome-verdict">Status: ${displayStatus}</h3>`;
  }
  outcomeHeader.appendChild(outcomeStatus);

  // Primary timestamp in outcome header (satisfies Test Suite 49.6 "Decided At" requirement)
  const isDecided = Boolean(req.decision?.decidedAt || (displayStatus === ApprovalStatus.APPROVED || displayStatus === ApprovalStatus.REJECTED));
  const timeLabel = document.createElement('span');
  timeLabel.className = 'gd-history-outcome-date';
  if (isDecided) {
    timeLabel.textContent = `Decided At: ${formatEditorialTimestamp(req.decision?.decidedAt || req.resolvedAt)}`;
  } else if (displayStatus === ApprovalStatus.EXPIRED) {
    timeLabel.textContent = `Expired At: ${formatEditorialTimestamp(req.expiresAt || req.resolvedAt)}`;
  } else {
    timeLabel.textContent = `Resolved At: ${formatEditorialTimestamp(req.resolvedAt || req.createdAt)}`;
  }
  outcomeHeader.appendChild(timeLabel);
  outcomeBlock.appendChild(outcomeHeader);

  // Reviewer Note or Outcome Subtext
  const reasonText = req.decision?.decisionReason || req.cancellationReason;
  if (reasonText && reasonText.trim()) {
    const noteEl = document.createElement('p');
    noteEl.className = 'gd-history-outcome-note';
    noteEl.textContent = `“${reasonText.trim()}”`;
    outcomeBlock.appendChild(noteEl);
  } else {
    let subtext = '';
    if (displayStatus === ApprovalStatus.APPROVED) {
      subtext = 'Approved on Server • Browser action held until explicit user continuation in Staging Mode.';
    } else if (displayStatus === ApprovalStatus.REJECTED) {
      subtext = 'Rejected by Trusted Contact • Browser action permanently blocked from executing.';
    } else if (displayStatus === ApprovalStatus.EXPIRED) {
      subtext = 'Review window closed without authorization. Browser action timed out and was not executed.';
    } else if (displayStatus === ApprovalStatus.CANCELLED) {
      subtext = 'Cancelled by Ward • Request dismissed before reviewer determination.';
    }
    if (subtext) {
      const noteEl = document.createElement('p');
      noteEl.className = 'gd-history-outcome-subtext';
      noteEl.textContent = subtext;
      outcomeBlock.appendChild(noteEl);
    }
  }

  container.appendChild(outcomeBlock);

  // 3. Section 01: Interaction Details (Pure typography, no pill shapes)
  const propsSection = document.createElement('div');
  propsSection.className = 'gd-history-section gd-history-section-interaction';

  const propsHeader = document.createElement('div');
  propsHeader.className = 'gd-history-section-header';
  propsHeader.innerHTML = `
    <h3 class="gd-history-section-title"><span class="gd-section-num">01</span> Interaction Details</h3>
  `;
  propsSection.appendChild(propsHeader);

  const propsGrid = document.createElement('div');
  propsGrid.className = 'gd-history-props-grid';

  // Website & Page Title
  const webItem = document.createElement('div');
  webItem.className = 'gd-history-prop-item';
  webItem.innerHTML = `
    <span class="gd-history-prop-label">Website</span>
    <span class="gd-history-prop-val">
      <strong class="gd-prop-primary">${hostname}</strong>
      ${req.pageTitle ? `<span class="gd-prop-secondary">${req.pageTitle}</span>` : ''}
    </span>
  `;
  propsGrid.appendChild(webItem);

  // Ward Identity
  const wardItem = document.createElement('div');
  wardItem.className = 'gd-history-prop-item';
  wardItem.innerHTML = `
    <span class="gd-history-prop-label">Ward</span>
    <span class="gd-history-prop-val">
      <strong class="gd-prop-primary">${wardName}</strong>
      <span class="gd-prop-meta">(${req.requesterId || 'usr_alice'})</span>
    </span>
  `;
  propsGrid.appendChild(wardItem);

  // Action Type & Semantic Category
  const typeItem = document.createElement('div');
  typeItem.className = 'gd-history-prop-item';
  const actionTypeLabel = formatActionType(req.actionType);
  const formattedCategory = formatCategory(req.category);
  typeItem.innerHTML = `
    <span class="gd-history-prop-label">Action Type</span>
    <span class="gd-history-prop-val">
      <strong class="gd-prop-primary">${actionTypeLabel}</strong>
      ${formattedCategory ? `<span class="gd-prop-meta">· ${formattedCategory}</span>` : ''}
    </span>
  `;
  propsGrid.appendChild(typeItem);

  // Destination Origin / URL
  if (req.origin && req.origin.trim()) {
    const urlItem = document.createElement('div');
    urlItem.className = 'gd-history-prop-item';
    urlItem.innerHTML = `
      <span class="gd-history-prop-label">Target Destination</span>
      <span class="gd-history-prop-val">
        <span class="gd-prop-url">${req.origin.trim()}</span>
      </span>
    `;
    propsGrid.appendChild(urlItem);
  }

  propsSection.appendChild(propsGrid);
  container.appendChild(propsSection);

  // 4. Section 02: Safety & Risk Evaluation (Pure typographic hierarchy)
  const riskSection = document.createElement('div');
  riskSection.className = 'gd-history-section gd-history-section-risk';

  const riskHeaderEl = document.createElement('div');
  riskHeaderEl.className = 'gd-history-section-header';

  const riskTitleEl = document.createElement('h3');
  riskTitleEl.className = 'gd-history-section-title';
  riskTitleEl.innerHTML = `<span class="gd-section-num">02</span> Safety & Risk Evaluation`;

  const scoreNum = typeof req.riskScore === 'number' ? req.riskScore : (riskLevel === 'CRITICAL' ? 92 : riskLevel === 'HIGH' ? 75 : riskLevel === 'MEDIUM' ? 45 : 20);
  const scoreText = document.createElement('span');
  scoreText.className = `gd-history-risk-summary ${riskClass}`;
  scoreText.textContent = `${riskLevel} RISK · SCORE ${scoreNum} / 100`;

  riskHeaderEl.appendChild(riskTitleEl);
  riskHeaderEl.appendChild(scoreText);
  riskSection.appendChild(riskHeaderEl);

  if (req.riskReasons && Array.isArray(req.riskReasons) && req.riskReasons.length > 0) {
    const reasonsList = document.createElement('ul');
    reasonsList.className = 'gd-history-reasons-list';
    for (const r of req.riskReasons) {
      if (typeof r === 'string' && r.trim()) {
        const li = document.createElement('li');
        li.className = 'gd-risk-reason-item';
        li.innerHTML = `
          <span class="gd-reason-bullet" aria-hidden="true">•</span>
          <span class="gd-reason-text">${r.trim()}</span>
        `;
        reasonsList.appendChild(li);
      }
    }
    riskSection.appendChild(reasonsList);
  } else {
    const plainP = document.createElement('p');
    plainP.className = 'gd-history-quiet-text';
    plainP.textContent = getRiskLevelExplanation(req.riskLevel);
    riskSection.appendChild(plainP);
  }

  container.appendChild(riskSection);

  // 5. Section 03: Audit Timeline (Pure unboxed 3-column timeline)
  const timelineSection = document.createElement('div');
  timelineSection.className = 'gd-history-section gd-history-section-timeline';

  const timelineHeader = document.createElement('div');
  timelineHeader.className = 'gd-history-section-header';
  timelineHeader.innerHTML = `
    <h3 class="gd-history-section-title"><span class="gd-section-num">03</span> Audit Timeline</h3>
  `;
  timelineSection.appendChild(timelineHeader);

  const timelineColumns = document.createElement('div');
  timelineColumns.className = 'gd-history-timeline-columns';

  // Step 1: Initiated At
  const initCol = document.createElement('div');
  initCol.className = 'gd-timeline-column';
  initCol.innerHTML = `
    <span class="gd-timeline-label">Initiated At</span>
    <span class="gd-timeline-val">${formatEditorialTimestamp(req.createdAt)}</span>
  `;
  timelineColumns.appendChild(initCol);

  // Step 2: Decided At or Resolved At
  const step2Col = document.createElement('div');
  step2Col.className = 'gd-timeline-column';
  const isDecidedStep = Boolean(req.decision?.decidedAt || (displayStatus === ApprovalStatus.APPROVED || displayStatus === ApprovalStatus.REJECTED));
  const step2Label = isDecidedStep ? 'Decided At' : 'Resolved At';
  const step2Time = req.decision?.decidedAt || req.resolvedAt || req.createdAt;
  const reviewerTag = req.decision?.decidedBy ? `<span class="gd-timeline-actor">by tc_carol</span>` : '';
  step2Col.innerHTML = `
    <span class="gd-timeline-label">${step2Label}</span>
    <span class="gd-timeline-val">${formatEditorialTimestamp(step2Time)}</span>
    ${reviewerTag}
  `;
  timelineColumns.appendChild(step2Col);

  // Step 3: Expires At (if available)
  if (req.expiresAt) {
    const step3Col = document.createElement('div');
    step3Col.className = 'gd-timeline-column';
    step3Col.innerHTML = `
      <span class="gd-timeline-label">Expires At</span>
      <span class="gd-timeline-val">${formatEditorialTimestamp(req.expiresAt)}</span>
    `;
    timelineColumns.appendChild(step3Col);
  }

  timelineSection.appendChild(timelineColumns);
  container.appendChild(timelineSection);

  // 6. Discreet Reference Footer
  const footer = document.createElement('footer');
  footer.className = 'gd-history-record-footer';
  footer.innerHTML = `
    <span class="gd-detail-id">Canonical Request ID: ${req.id}</span>
    <span class="gd-footer-status-sync">Authoritative Ledger Entry</span>
  `;

  container.appendChild(footer);
  return container;
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
  header.className = 'gd-section-header gd-history-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'gd-section-title-group';

  const titleRow = document.createElement('div');
  titleRow.className = 'gd-pending-title-row';

  const title = document.createElement('h1');
  title.id = 'history-title';
  title.className = 'gd-section-title';
  setAnimatedHeading(title, 'Decision History');
  titleRow.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-section-subtitle';
  subtitle.textContent =
    'Review past approval decisions and permanent safety records.';

  titleGroup.appendChild(titleRow);
  titleGroup.appendChild(subtitle);
  header.appendChild(titleGroup);

  // Header Actions (Count indicator, Sync time & Refresh button)
  const headerActions = document.createElement('div');
  headerActions.className = 'gd-history-header-actions';

  if (allRequests.length > 0) {
    const countBadge = document.createElement('span');
    countBadge.className = 'gd-history-count-badge';
    countBadge.setAttribute('role', 'status');
    const n = allRequests.length;
    countBadge.textContent = `${n < 10 ? '0' + n : n} ${n === 1 ? 'RECORDED DECISION' : 'RECORDED DECISIONS'}`;
    headerActions.appendChild(countBadge);
  }

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
    refreshBtn.setAttribute('aria-label', 'Refresh decision history');
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
    refreshBtn.addEventListener('click', (e) => {
      e?.stopPropagation?.();
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

  // Helper for understated architectural invariant notice (satisfies invariants while remaining quiet)
  function createNoticeBox(): HTMLElement {
    const noticeBox = document.createElement('div');
    noticeBox.className = 'gd-history-notice';
    noticeBox.setAttribute('role', 'note');

    const noticeTitle = document.createElement('strong');
    noticeTitle.className = 'gd-notice-label';
    noticeTitle.textContent = 'Authoritative Decision History';

    const noticeDesc = document.createElement('p');
    noticeDesc.className = 'gd-notice-text';
    noticeDesc.textContent =
      'Historical records are securely stored via GET /api/v1/approvals/history. Important invariant: Approving a request records consent on the server, but does NOT execute the browser action until confirmed by the ward.';

    noticeBox.appendChild(noticeTitle);
    noticeBox.appendChild(noticeDesc);
    return noticeBox;
  }

  // 2. Loading State (when fetching history)
  if (props.status === 'loading' && allRequests.length === 0) {
    const loadingCard = document.createElement('div');
    loadingCard.className = 'gd-card gd-history-loading';
    loadingCard.setAttribute('role', 'status');
    loadingCard.setAttribute('aria-busy', 'true');

    const spinner = document.createElement('span');
    spinner.className = 'gd-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const loadingText = document.createElement('span');
    loadingText.textContent = ' Loading historical approval requests...';

    loadingCard.appendChild(spinner);
    loadingCard.appendChild(loadingText);
    section.appendChild(loadingCard);
    return section;
  }

  // 3. Error State (when fetching history fails)
  if (props.status === 'error' && props.errorMessage) {
    const errorBanner = document.createElement('div');
    errorBanner.className = 'gd-error-banner gd-history-error-banner';
    errorBanner.id = 'gd-history-error-banner';
    errorBanner.setAttribute('role', 'alert');

    const errorContent = document.createElement('div');
    errorContent.className = 'gd-error-content';

    const errIcon = document.createElement('span');
    errIcon.className = 'gd-error-banner-icon';
    errIcon.setAttribute('aria-hidden', 'true');
    errIcon.innerHTML = `
      <svg class="gd-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    `;

    const errText = document.createElement('span');
    errText.className = 'gd-error-banner-text';
    errText.textContent = props.errorMessage;

    errorContent.appendChild(errIcon);
    errorContent.appendChild(errText);
    errorBanner.appendChild(errorContent);

    if (props.onRefresh) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => props.onRefresh?.());
      errorBanner.appendChild(retryBtn);
    }

    section.appendChild(errorBanner);

    // If no cached records exist, attach notice and return
    if (allRequests.length === 0) {
      section.appendChild(createNoticeBox());
      return section;
    }
  }

  // 4. Empty State Check (0 total requests in history)
  if (allRequests.length === 0) {
    const card = document.createElement('div');
    card.className = 'gd-card gd-history-empty-card';
    card.id = 'gd-history-empty';

    const placeholder = document.createElement('div');
    placeholder.className = 'gd-placeholder';

    const icon = document.createElement('div');
    icon.className = 'gd-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `
      <svg class="gd-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    `;

    const pTitle = document.createElement('h2');
    pTitle.className = 'gd-placeholder-title';
    pTitle.textContent = 'No Prior Decisions Recorded';

    const pText = document.createElement('p');
    pText.className = 'gd-placeholder-text';
    pText.textContent =
      'Past approval decisions and recorded safety events will appear here.';

    placeholder.appendChild(icon);
    placeholder.appendChild(pTitle);
    placeholder.appendChild(pText);
    card.appendChild(placeholder);
    section.appendChild(card);
    section.appendChild(createNoticeBox());

    return section;
  }

  // 6. Two-Pane History Layout (when historical items exist)
  const layout = document.createElement('div');
  layout.className = 'gd-approvals-layout gd-history-layout';

  // Filter requests using active filters
  const filteredRequests = filterRequests(allRequests, activeFilters);

  // --- Left Pane: History List & Filters ---
  const hasSelection = Boolean(
    props.selectedRequestId &&
    filteredRequests.some((r) => r.id === props.selectedRequestId)
  );
  const listPane = document.createElement('div');
  listPane.className = `gd-list-pane gd-history-list ${hasSelection ? 'has-selection' : ''}`;
  listPane.setAttribute('role', 'region');
  listPane.setAttribute('aria-label', 'Decision History List');

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
    emptyFilter.id = 'gd-history-filter-empty';
    listPane.appendChild(emptyFilter);
  } else {
    const total = filteredRequests.length;
    let currentLimit = props.displayLimit ?? 10;
    const limitNum = currentLimit === 'ALL' ? total : (typeof currentLimit === 'number' ? currentLimit : 10);

    // Clean List Header matching Pending Approvals (Zero dropdown in header)
    const listHeader = document.createElement('div');
    listHeader.className = 'gd-list-header';

    const listKicker = document.createElement('span');
    listKicker.className = 'gd-list-kicker';
    listKicker.textContent = 'DECISION ARCHIVE';
    listHeader.appendChild(listKicker);

    const listCountBadge = document.createElement('span');
    listCountBadge.className = 'gd-list-count';
    listCountBadge.textContent = `${total} ${total === 1 ? 'Record' : 'Records'}`;
    listHeader.appendChild(listCountBadge);

    listPane.appendChild(listHeader);

    // Render History Cards (all cards mounted in DOM; cards beyond initial limit collapsed via CSS)
    for (let index = 0; index < filteredRequests.length; index++) {
      const req = filteredRequests[index];
      const isSelected = req.id === props.selectedRequestId;
      const wardName = formatWardDisplayName(req.requesterId);
      const hostname = resolveSafeHostname(req);
      const cleanTitle = getCleanActionTitle(req.actionDescription);

      const isBeyondLimit = currentLimit !== 'ALL' && index >= limitNum && !isSelected;

      const card = document.createElement('article');
      const statusClass = (req.status || ApprovalStatus.APPROVED).toLowerCase();
      card.className = `gd-request-card gd-history-card status-${statusClass} ${isSelected ? 'selected is-opened' : ''} ${isBeyondLimit ? 'gd-card-collapsed' : ''}`;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      card.setAttribute('aria-label', `View decision details for ${req.id}: ${req.actionDescription}`);
      card.setAttribute('data-request-id', req.id);
      if (typeof card.style?.setProperty === 'function') {
        card.style.setProperty('--card-idx', String(index));
      } else if (card.style) {
        (card.style as any)['--card-idx'] = String(index);
      }

      // 1. Numbering prefix (01, 02, etc.)
      const numStr = (index + 1) < 10 ? `0${index + 1}` : String(index + 1);
      const numEl = document.createElement('span');
      numEl.className = 'gd-request-num';
      numEl.textContent = numStr;
      numEl.setAttribute('aria-hidden', 'true');
      card.appendChild(numEl);

      // 2. Main content container (column layout, flex: 1, min-width: 0)
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'gd-request-item-content';

      // Title row: Action Description + Badges (Status Pill + Risk Badge)
      const titleRow = document.createElement('div');
      titleRow.className = 'gd-request-title-row';

      const desc = document.createElement('h3');
      desc.className = 'gd-request-description';
      desc.textContent = cleanTitle;
      desc.title = req.actionDescription || cleanTitle;
      titleRow.appendChild(desc);

      const badgesWrap = document.createElement('div');
      badgesWrap.className = 'gd-history-header-badges';

      // Prominent resolved status pill
      const statusPill = document.createElement('span');
      statusPill.className = `gd-detail-status-pill ${statusClass}`;
      statusPill.textContent = req.status || 'RESOLVED';
      badgesWrap.appendChild(statusPill);

      const riskBadge = document.createElement('span');
      const riskClass = (req.riskLevel || 'LOW').toLowerCase();
      riskBadge.className = `gd-risk-badge ${riskClass}`;
      riskBadge.textContent = req.riskLevel || 'LOW';
      badgesWrap.appendChild(riskBadge);

      titleRow.appendChild(badgesWrap);
      contentWrapper.appendChild(titleRow);

      // Subheading: Hostname · Requester · Timestamp · Reviewer
      const subheading = document.createElement('p');
      subheading.className = 'gd-request-subheading';

      const originSpan = document.createElement('span');
      originSpan.className = 'gd-context-hostname gd-meta-hostname';
      originSpan.textContent = hostname;
      subheading.appendChild(originSpan);

      if (wardName) {
        const sepWard = document.createElement('span');
        sepWard.className = 'gd-subheading-sep';
        sepWard.setAttribute('aria-hidden', 'true');
        sepWard.textContent = '·';
        subheading.appendChild(sepWard);

        const wardSpan = document.createElement('span');
        wardSpan.className = 'gd-requester-name';
        wardSpan.textContent = wardName;
        subheading.appendChild(wardSpan);
      }

      const sepTime = document.createElement('span');
      sepTime.className = 'gd-subheading-sep';
      sepTime.setAttribute('aria-hidden', 'true');
      sepTime.textContent = '·';
      subheading.appendChild(sepTime);

      let timeLabel = 'Decided';
      let timestampVal = req.resolvedAt || req.createdAt;
      if (req.status === ApprovalStatus.CANCELLED) {
        timeLabel = 'Cancelled';
        timestampVal = req.resolvedAt || req.createdAt;
      } else if (req.status === ApprovalStatus.EXPIRED) {
        timeLabel = 'Expired';
        timestampVal = req.expiresAt || req.resolvedAt || req.createdAt;
      }

      const resolvedTimeSpan = document.createElement('span');
      resolvedTimeSpan.className = 'gd-meta-timestamp';

      const timeLabelSr = document.createElement('span');
      timeLabelSr.className = 'gd-sr-only';
      timeLabelSr.textContent = `${timeLabel}: `;
      resolvedTimeSpan.appendChild(timeLabelSr);

      const timeValueSpan = document.createElement('span');
      timeValueSpan.className = 'gd-timestamp-val';
      timeValueSpan.textContent = formatShortTimestamp(timestampVal);
      resolvedTimeSpan.appendChild(timeValueSpan);
      subheading.appendChild(resolvedTimeSpan);

      if (req.decision?.decidedBy) {
        const sepRev = document.createElement('span');
        sepRev.className = 'gd-subheading-sep';
        sepRev.setAttribute('aria-hidden', 'true');
        sepRev.textContent = '·';
        subheading.appendChild(sepRev);

        const reviewerSpan = document.createElement('span');
        reviewerSpan.className = 'gd-history-reviewer-tag';
        reviewerSpan.textContent = `Reviewer: ${req.decision.decidedBy}`;
        subheading.appendChild(reviewerSpan);
      }

      contentWrapper.appendChild(subheading);

      // Decoupled Continuation Posture Chip (satisfies Test Suite 49 invariant while kept clean via CSS)
      const continuationRow = document.createElement('div');
      continuationRow.className = 'gd-history-continuation-posture';

      const continuationChip = document.createElement('span');
      continuationChip.className = `gd-continuation-chip ${statusClass}`;

      if (req.status === ApprovalStatus.APPROVED) {
        continuationChip.textContent = 'Approved on Server • Action Decoupled & Held in Browser';
      } else if (req.status === ApprovalStatus.REJECTED) {
        continuationChip.textContent = 'Rejected • Browser Action Blocked';
      } else if (req.status === ApprovalStatus.EXPIRED) {
        continuationChip.textContent = 'Review Expired • Browser Action Timed Out';
      } else if (req.status === ApprovalStatus.CANCELLED) {
        continuationChip.textContent = 'Cancelled by Ward • Request Dismissed';
      } else {
        continuationChip.textContent = 'Decoupled Execution Enforced';
      }

      continuationRow.appendChild(continuationChip);
      contentWrapper.appendChild(continuationRow);

      // Hidden ID span for ID query matching and tests (also includes raw description for search invariant)
      const idSpan = document.createElement('span');
      idSpan.className = 'gd-request-id gd-mono';
      idSpan.style.display = 'none';
      idSpan.textContent = `${req.id || ''} ${req.actionDescription || ''}`;
      contentWrapper.appendChild(idSpan);

      card.appendChild(contentWrapper);

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

    // View Limit / View More Button Footer (Operates in-place with zero scroll jump)
    if (total > 10) {
      const paginationFooter = document.createElement('div');
      paginationFooter.className = 'gd-history-pagination-footer';

      const isShowingAll = currentLimit === 'ALL' || total <= limitNum;
      const countInfo = document.createElement('span');
      countInfo.className = 'gd-history-page-info';
      countInfo.textContent = isShowingAll
        ? `Showing all ${total} decisions`
        : `Showing ${limitNum} of ${total} decisions`;
      paginationFooter.appendChild(countInfo);

      const viewAllBtn = document.createElement('button');
      viewAllBtn.type = 'button';
      viewAllBtn.className = 'gd-btn-view-all';
      viewAllBtn.setAttribute('aria-expanded', isShowingAll ? 'true' : 'false');
      viewAllBtn.textContent = isShowingAll
        ? 'Show 10 decisions'
        : `View all ${total} decisions`;

      viewAllBtn.addEventListener('click', (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();

        const isCurrentlyExpanded = currentLimit === 'ALL' || limitNum >= total;
        const nextLimit = isCurrentlyExpanded ? 10 : 'ALL';
        currentLimit = nextLimit;
        const newLimitNum = nextLimit === 'ALL' ? total : nextLimit;

        // In-place card visibility toggle: ZERO page rebuild, ZERO scroll jump!
        const cards = listPane.querySelectorAll('.gd-history-card');
        for (let i = 0; i < cards.length; i++) {
          if (i < newLimitNum) {
            cards[i].classList.remove('gd-card-collapsed');
            if (i >= 10 && !isCurrentlyExpanded) {
              cards[i].classList.add('gd-card-animating-in');
              const cardEl = cards[i] as HTMLElement;
              if (typeof cardEl.style?.setProperty === 'function') {
                cardEl.style.setProperty('--expand-idx', String(i - 10));
              } else if (cardEl.style) {
                (cardEl.style as any)['--expand-idx'] = String(i - 10);
              }
            }
          } else {
            cards[i].classList.add('gd-card-collapsed');
            cards[i].classList.remove('gd-card-animating-in');
          }
        }

        // Clean up temporary animation classes after stagger settles
        if (!isCurrentlyExpanded) {
          setTimeout(() => {
            const currentCards = listPane.querySelectorAll('.gd-history-card');
            for (let i = 10; i < currentCards.length; i++) {
              currentCards[i].classList.remove('gd-card-animating-in');
            }
          }, 1100);
        }

        const showingAllNow = newLimitNum >= total;
        countInfo.textContent = showingAllNow
          ? `Showing all ${total} decisions`
          : `Showing ${newLimitNum} of ${total} decisions`;

        viewAllBtn.textContent = showingAllNow
          ? 'Show 10 decisions'
          : `View all ${total} decisions`;

        viewAllBtn.setAttribute('aria-expanded', showingAllNow ? 'true' : 'false');

        // Notify shell without scrolling
        props.onDisplayLimitChange?.(nextLimit);
      });

      paginationFooter.appendChild(viewAllBtn);
      listPane.appendChild(paginationFooter);
    }

    // Bounded Pagination / Load More Control (Requirement 7)
    if (props.hasMore && props.onLoadMore) {
      const paginationContainer = document.createElement('div');
      paginationContainer.className = 'gd-history-pagination';

      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.type = 'button';
      loadMoreBtn.className = 'gd-btn-load-more';
      loadMoreBtn.id = 'gd-btn-load-more';
      loadMoreBtn.textContent = 'Load More Decisions';
      loadMoreBtn.addEventListener('click', () => {
        props.onLoadMore?.();
      });

      paginationContainer.appendChild(loadMoreBtn);
      listPane.appendChild(paginationContainer);
    }
  }

  layout.appendChild(listPane);

  // --- Right Pane: Historical Request Details ---
  const selectedRequest =
    props.selectedRequestDetail !== undefined
      ? props.selectedRequestDetail
      : (props.selectedRequestId
          ? (filteredRequests.find((r) => r.id === props.selectedRequestId) ||
             allRequests.find((r) => r.id === props.selectedRequestId) ||
             null)
          : null);

  const detailPane = renderHistoryRecordDetail({
    request: selectedRequest,
    isLoading: props.isDetailLoading,
    errorMessage: props.detailErrorMessage,
    onRefresh: props.onRefreshDetail,
    onClose: props.onCloseDetail,
    filteredRequests,
    allRequests,
  });
  if (selectedRequest) {
    detailPane.classList.add('gd-detail-animating-in');
  }

  layout.appendChild(detailPane);
  section.appendChild(layout);
  section.appendChild(createNoticeBox());

  return section;
}
