/**
 * Guardrail Trusted-Contact Dashboard - Pending Approvals Component
 *
 * Implements the two-pane layout:
 * - Left Pane: Filterable list of pending approval requests.
 * - Right Pane: Structured request detail inspector with risk reasons, metadata, and decoupling notices.
 * Includes intentional loading, error, and empty placeholders.
 * Note: Approval decision submission is intentionally deferred to Day 13+.
 */

import { ApprovalRequest, ViewStatus } from '../types.js';

export interface PendingApprovalsProps {
  requests: readonly ApprovalRequest[];
  selectedRequestId: string | null;
  status: ViewStatus;
  errorMessage?: string | null;
  onRequestSelect: (requestId: string) => void;
}

export function renderPendingApprovals(props: PendingApprovalsProps): HTMLElement {
  const section = document.createElement('section');
  section.id = 'view-pending';
  section.className = 'gd-view-section';
  section.setAttribute('aria-labelledby', 'pending-title');

  // Header
  const header = document.createElement('header');
  header.className = 'gd-section-header';

  const title = document.createElement('h1');
  title.id = 'pending-title';
  title.className = 'gd-section-title';
  title.textContent = 'Pending Approval Requests';

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-section-subtitle';
  subtitle.textContent =
    'Inspect held browser actions requiring trusted contact review before the user may proceed in Staging Mode.';

  header.appendChild(title);
  header.appendChild(subtitle);
  section.appendChild(header);

  // Error Banner (if error state)
  if (props.status === 'error' && props.errorMessage) {
    const errorBanner = document.createElement('div');
    errorBanner.className = 'gd-error-banner';
    errorBanner.setAttribute('role', 'alert');

    const errorText = document.createElement('span');
    errorText.textContent = props.errorMessage;

    errorBanner.appendChild(errorText);
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
    // Render Request Cards
    for (const req of props.requests) {
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

  layout.appendChild(listPane);

  // --- Right Pane: Request Details ---
  const detailPane = document.createElement('div');
  detailPane.className = 'gd-detail-pane';
  detailPane.setAttribute('role', 'region');
  detailPane.setAttribute('aria-label', 'Selected Request Details');

  const selectedRequest = props.requests.find((r) => r.id === props.selectedRequestId);

  if (selectedRequest) {
    // Header
    const dHeader = document.createElement('div');
    dHeader.className = 'gd-detail-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'gd-detail-title-group';

    const idSpan = document.createElement('span');
    idSpan.className = 'gd-detail-id';
    idSpan.textContent = `Canonical Request ID: ${selectedRequest.id}`;

    const dTitle = document.createElement('h2');
    dTitle.className = 'gd-detail-title';
    dTitle.textContent = selectedRequest.actionDescription;

    titleGroup.appendChild(idSpan);
    titleGroup.appendChild(dTitle);

    const statusPill = document.createElement('span');
    statusPill.className = 'gd-detail-status-pill';
    statusPill.textContent = selectedRequest.status;

    dHeader.appendChild(titleGroup);
    dHeader.appendChild(statusPill);
    detailPane.appendChild(dHeader);

    // Meta Grid
    const grid = document.createElement('div');
    grid.className = 'gd-detail-grid';

    const items = [
      { label: 'Origin Website', value: selectedRequest.origin || selectedRequest.hostname || 'Unknown' },
      { label: 'Interaction Mechanism', value: selectedRequest.actionType || 'Standard Click' },
      { label: 'Semantic Category', value: selectedRequest.category || 'General' },
      { label: 'Ward Identity', value: selectedRequest.requesterId },
      { label: 'Evaluated Risk Level', value: selectedRequest.riskLevel },
      { label: 'Numeric Risk Score', value: selectedRequest.riskScore !== undefined ? `${selectedRequest.riskScore} / 100` : 'Not Scored' },
    ];

    for (const item of items) {
      const field = document.createElement('div');
      field.className = 'gd-detail-item';

      const label = document.createElement('span');
      label.className = 'gd-detail-label';
      label.textContent = item.label;

      const val = document.createElement('span');
      val.className = 'gd-detail-value';
      val.textContent = item.value;

      field.appendChild(label);
      field.appendChild(val);
      grid.appendChild(field);
    }

    detailPane.appendChild(grid);

    // Risk Reasons Section
    if (selectedRequest.riskReasons && selectedRequest.riskReasons.length > 0) {
      const riskSection = document.createElement('div');
      riskSection.className = 'gd-detail-item';

      const riskLabel = document.createElement('span');
      riskLabel.className = 'gd-detail-label';
      riskLabel.textContent = 'Heuristic Risk Analysis';

      const ul = document.createElement('ul');
      ul.className = 'gd-risk-reasons-list';

      for (const reason of selectedRequest.riskReasons) {
        const li = document.createElement('li');
        li.className = 'gd-risk-reason-item';
        li.textContent = reason;
        ul.appendChild(li);
      }

      riskSection.appendChild(riskLabel);
      riskSection.appendChild(ul);
      detailPane.appendChild(riskSection);
    }

    // Decoupling & Decision Notice
    const notice = document.createElement('div');
    notice.className = 'gd-decision-notice';
    notice.setAttribute('role', 'note');

    const noticeText = document.createElement('p');
    noticeText.textContent =
      'Decoupled Execution Architecture: Approving this request records reviewer consent on the Guardrail backend. It does NOT remotely execute the action in the ward’s browser. The user retains sole continuation authority in Staging Mode.';

    const decisionShellNotice = document.createElement('p');
    decisionShellNotice.style.marginTop = '8px';
    decisionShellNotice.style.fontWeight = '600';
    decisionShellNotice.textContent =
      '🔒 Decision Actions Shell: Approval & Rejection decision submissions will be wired to the REST API in Day 13.';

    notice.appendChild(noticeText);
    notice.appendChild(decisionShellNotice);
    detailPane.appendChild(notice);
  } else {
    // Nothing Selected Placeholder
    const noSelectPlaceholder = document.createElement('div');
    noSelectPlaceholder.className = 'gd-placeholder';

    const icon = document.createElement('div');
    icon.className = 'gd-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '👆';

    const pTitle = document.createElement('h2');
    pTitle.className = 'gd-placeholder-title';
    pTitle.textContent = 'Select an Approval Request';

    const pText = document.createElement('p');
    pText.className = 'gd-placeholder-text';
    pText.textContent =
      'Select any pending request from the list on the left to inspect its security risk assessment, target website origin, and heuristic analysis.';

    noSelectPlaceholder.appendChild(icon);
    noSelectPlaceholder.appendChild(pTitle);
    noSelectPlaceholder.appendChild(pText);
    detailPane.appendChild(noSelectPlaceholder);
  }

  layout.appendChild(detailPane);
  section.appendChild(layout);

  return section;
}
