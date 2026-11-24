/**
 * Guardrail Trusted Contact Portal — Pending Approvals Popup Modal
 *
 * Minimal editorial popup modal for reviewing pending approval requests
 * across all connected wards directly from the Overview metric card.
 * Matches the Managed Wards modal Quiet Assurance aesthetic: warm #EDE6D6
 * canvas, zero pure-white boxes, crisp typography, and organic bloom animation.
 */

import { ApprovalRequest, RiskLevel, ViewStatus } from '../types.js';
import { renderWardSwitcher } from './filters.js';
import { createIcon, populateWardAvatar } from './icons.js';
import { formatWardDisplayName } from './overview.js';
import { WardSummary } from './wards-control-modal.js';

export interface PendingApprovalsModalProps {
  pendingRequests: readonly ApprovalRequest[];
  connectedWards?: readonly WardSummary[];
  pendingStatus?: ViewStatus;
  errorMessage?: string | null;
  isBackendUnavailable?: boolean;
  onClose: () => void;
  onSelectPending?: (requestId: string) => void;
  onViewPending?: () => void;
  onRefresh?: () => void;
}

/**
 * Renders the Pending Approvals popup dialog element matching the Managed Wards modal theme.
 */
export function renderPendingApprovalsModal(props: PendingApprovalsModalProps): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.id = 'gd-pending-approvals-modal-root';
  backdrop.className = 'gd-wards-modal-backdrop gd-pending-modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'gd-pending-modal-title');

  const card = document.createElement('div');
  card.className = 'gd-wards-modal-card gd-pending-modal-card';

  let activeWardFilter = 'ALL';
  const pendingList = props.pendingRequests ?? [];
  const wards = props.connectedWards ?? [];

  let handleKeyDown: ((e: KeyboardEvent) => void) | null = null;
  const closeWithCleanup = () => {
    if (handleKeyDown && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('keydown', handleKeyDown);
      handleKeyDown = null;
    }
    props.onClose();
  };

  // =========================================================================
  // 1. HEADER SECTION (Matches Managed Wards modal typography & layout)
  // =========================================================================
  const header = document.createElement('header');
  header.className = 'gd-wards-modal-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'gd-wards-modal-header-left';

  const titleRow = document.createElement('div');
  titleRow.className = 'gd-wards-modal-title-row';

  const titleIcon = document.createElement('span');
  titleIcon.className = 'gd-wards-modal-title-icon';
  titleIcon.setAttribute('aria-hidden', 'true');
  titleIcon.appendChild(createIcon('clock'));

  const title = document.createElement('h2');
  title.id = 'gd-pending-modal-title';
  title.className = 'gd-wards-modal-title';
  title.textContent = 'Pending Approvals';

  const countBadge = document.createElement('span');
  countBadge.className = `gd-wards-modal-badge ${pendingList.length > 0 ? 'has-pending' : ''}`;
  countBadge.textContent =
    pendingList.length === 0 ? 'All Clear' : `${pendingList.length} Needs Review`;

  titleRow.appendChild(titleIcon);
  titleRow.appendChild(title);
  titleRow.appendChild(countBadge);
  headerLeft.appendChild(titleRow);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-wards-modal-close-btn';
  closeBtn.setAttribute('aria-label', 'Close pending approvals dialog');
  closeBtn.innerHTML = `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  closeBtn.addEventListener('click', closeWithCleanup);

  header.appendChild(headerLeft);
  header.appendChild(closeBtn);
  card.appendChild(header);

  // =========================================================================
  // 2. QUIET ASSURANCE EDITORIAL METADATA STRIP
  // =========================================================================
  const summaryStrip = document.createElement('div');
  summaryStrip.className = 'gd-wards-modal-summary-strip';

  const metaCount = document.createElement('span');
  metaCount.className = `gd-summary-meta-item ${pendingList.length > 0 ? 'attention' : ''}`;
  metaCount.textContent =
    pendingList.length > 0
      ? `${pendingList.length} Waiting Review`
      : 'Queue Clear';

  const div1 = document.createElement('span');
  div1.className = 'gd-summary-meta-divider';
  div1.textContent = '·';

  const metaWards = document.createElement('span');
  metaWards.className = 'gd-summary-meta-item';
  const wardTotal = wards.length || new Set(pendingList.map((r) => r.requesterId).filter(Boolean)).size;
  metaWards.textContent = `${wardTotal} Protected ${wardTotal === 1 ? 'Ward' : 'Wards'}`;

  const div2 = document.createElement('span');
  div2.className = 'gd-summary-meta-divider';
  div2.textContent = '·';

  const metaPolicy = document.createElement('span');
  metaPolicy.className = 'gd-summary-meta-item live';
  metaPolicy.textContent = 'Consent-Only Execution';

  summaryStrip.appendChild(metaCount);
  summaryStrip.appendChild(div1);
  summaryStrip.appendChild(metaWards);
  summaryStrip.appendChild(div2);
  summaryStrip.appendChild(metaPolicy);
  card.appendChild(summaryStrip);

  // =========================================================================
  // 3. MODAL BODY (No white boxes, hairline dividers, per-ward filtering)
  // =========================================================================
  const body = document.createElement('div');
  body.className = 'gd-wards-modal-body gd-pending-modal-body';

  const listWrap = document.createElement('div');
  listWrap.className = 'gd-pending-modal-list-wrap';

  const renderListItems = () => {
    while (listWrap.firstChild) {
      listWrap.removeChild(listWrap.firstChild);
    }

    if (props.pendingStatus === 'loading' && pendingList.length === 0) {
      const skeletonWrap = document.createElement('div');
      skeletonWrap.className = 'gd-overview-pending-skeleton';
      skeletonWrap.setAttribute('aria-busy', 'true');
      for (let i = 0; i < 2; i++) {
        const line1 = document.createElement('div');
        line1.className = 'gd-skeleton gd-skeleton-line';
        const line2 = document.createElement('div');
        line2.className = 'gd-skeleton gd-skeleton-line short';
        skeletonWrap.appendChild(line1);
        skeletonWrap.appendChild(line2);
      }
      listWrap.appendChild(skeletonWrap);
      return;
    }

    if ((props.pendingStatus === 'error' || props.isBackendUnavailable) && pendingList.length === 0) {
      const errBox = document.createElement('div');
      errBox.className = 'gd-error-banner';
      errBox.setAttribute('role', 'alert');

      const errContent = document.createElement('div');
      errContent.className = 'gd-error-content';
      const errIcon = document.createElement('span');
      errIcon.className = 'gd-error-banner-icon';
      errIcon.setAttribute('aria-hidden', 'true');
      errIcon.appendChild(createIcon('alert-circle'));
      const errText = document.createElement('span');
      errText.className = 'gd-error-banner-text';
      errText.textContent =
        props.errorMessage || 'Unable to retrieve approval requests. Check your connection and retry.';
      errContent.appendChild(errIcon);
      errContent.appendChild(errText);
      errBox.appendChild(errContent);

      if (props.onRefresh) {
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'gd-btn-retry';
        retryBtn.textContent = 'Retry';
        retryBtn.addEventListener('click', () => props.onRefresh?.());
        errBox.appendChild(retryBtn);
      }
      listWrap.appendChild(errBox);
      return;
    }

    if (pendingList.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'gd-wards-modal-empty';

      const emptyIcon = document.createElement('div');
      emptyIcon.className = 'gd-wards-empty-icon';
      emptyIcon.appendChild(createIcon('shield-check'));

      const emptyTitle = document.createElement('h3');
      emptyTitle.className = 'gd-wards-empty-title';
      emptyTitle.textContent = 'Review Queue All Clear';

      const emptyDesc = document.createElement('p');
      emptyDesc.className = 'gd-wards-empty-desc';
      emptyDesc.textContent =
        'No actions are currently waiting for your review. When a request needs approval, it will appear here.';

      emptyState.appendChild(emptyIcon);
      emptyState.appendChild(emptyTitle);
      emptyState.appendChild(emptyDesc);
      listWrap.appendChild(emptyState);
      return;
    }

    const filtered =
      activeWardFilter === 'ALL'
        ? pendingList
        : pendingList.filter(
            (r) => (r.requesterId || '').toLowerCase() === activeWardFilter.toLowerCase()
          );

    if (filtered.length === 0) {
      const emptyFilter = document.createElement('div');
      emptyFilter.className = 'gd-wards-modal-empty';
      const emptyTitle = document.createElement('h3');
      emptyTitle.className = 'gd-wards-empty-title';
      emptyTitle.textContent = 'All Clear for This Ward';
      const emptyDesc = document.createElement('p');
      emptyDesc.className = 'gd-wards-empty-desc';
      emptyDesc.textContent = 'No pending approval requests for the selected ward.';
      emptyFilter.appendChild(emptyTitle);
      emptyFilter.appendChild(emptyDesc);
      listWrap.appendChild(emptyFilter);
      return;
    }

    const itemsList = document.createElement('div');
    itemsList.className = 'gd-wards-modal-list gd-pending-modal-list';

    filtered.forEach((req, idx) => {
      const row = document.createElement('article');
      row.className = 'gd-ward-control-card gd-pending-modal-item';
      row.setAttribute('data-request-id', req.id);
      if (row.style && typeof row.style.setProperty === 'function') {
        row.style.setProperty('animation-delay', `${idx * 45}ms`);
      }

      const rowInner = document.createElement('div');
      rowInner.className = 'gd-ward-control-top gd-pending-modal-row';

      const matchedWard = wards.find(
        (w) => w.id.toLowerCase() === (req.requesterId || '').toLowerCase()
      );
      const wardName = req.requesterId
        ? formatWardDisplayName(matchedWard?.name, req.requesterId)
        : 'Protected Ward';

      // Left cluster: Ward avatar + Request info
      const leftCluster = document.createElement('div');
      leftCluster.className = 'gd-ward-meta-cluster';

      const avatar = document.createElement('div');
      avatar.className = 'gd-ward-control-avatar';
      populateWardAvatar(avatar, {
        imageUrl: matchedWard?.imageUrl || matchedWard?.avatarUrl,
        name: wardName,
        imgClass: 'gd-ward-control-avatar-img',
        iconClass: 'gd-ward-avatar-icon',
      });

      const infoCol = document.createElement('div');
      infoCol.className = 'gd-ward-control-identity gd-pending-modal-info';

      const topLine = document.createElement('div');
      topLine.className = 'gd-pending-modal-title-line';

      const desc = document.createElement('h3');
      desc.className = 'gd-pending-modal-desc';
      desc.textContent = req.actionDescription;

      const riskBadge = document.createElement('span');
      const riskClass = (req.riskLevel || RiskLevel.HIGH).toLowerCase();
      riskBadge.className = `gd-risk-badge gd-risk-${riskClass} ${riskClass}`;
      riskBadge.textContent = req.riskLevel || 'HIGH';

      topLine.appendChild(desc);
      topLine.appendChild(riskBadge);

      const metaLine = document.createElement('div');
      metaLine.className = 'gd-ward-control-email gd-pending-modal-meta';
      const host = req.hostname || 'Browser Action';
      const reqTime = req.createdAt || (req as any).timestamp;
      const timeStr = reqTime
        ? new Date(reqTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Just now';
      metaLine.textContent = `${wardName} · ${host} · Requested ${timeStr}`;

      infoCol.appendChild(topLine);
      infoCol.appendChild(metaLine);

      leftCluster.appendChild(avatar);
      leftCluster.appendChild(infoCol);

      // Right action: Review & Decide
      const actionsCluster = document.createElement('div');
      actionsCluster.className = 'gd-ward-control-actions';

      const reviewBtn = document.createElement('button');
      reviewBtn.type = 'button';
      reviewBtn.className = 'gd-ward-btn-primary gd-btn-overview-review';
      reviewBtn.setAttribute('aria-label', `Review and evaluate ${req.actionDescription}`);

      const btnLabel = document.createElement('span');
      btnLabel.textContent = 'Review & Decide';
      const btnArrow = document.createElement('span');
      btnArrow.className = 'gd-arrow';
      btnArrow.setAttribute('aria-hidden', 'true');
      btnArrow.innerHTML = '&rarr;';
      reviewBtn.appendChild(btnLabel);
      reviewBtn.appendChild(btnArrow);

      reviewBtn.addEventListener('click', () => {
        closeWithCleanup();
        if (props.onSelectPending) {
          props.onSelectPending(req.id);
        } else {
          props.onViewPending?.();
        }
      });

      actionsCluster.appendChild(reviewBtn);

      rowInner.appendChild(leftCluster);
      rowInner.appendChild(actionsCluster);
      row.appendChild(rowInner);
      itemsList.appendChild(row);
    });

    listWrap.appendChild(itemsList);
  };

  // Persistent segmented ward switcher so the olive glider animates smoothly in-place
  if (wards.length > 1 && pendingList.length > 0) {
    const switcherWrap = document.createElement('div');
    switcherWrap.className = 'gd-pending-modal-filters';
    const switcher = renderWardSwitcher({
      wards,
      activeWardId: activeWardFilter,
      requests: pendingList,
      contextKey: 'pending-modal',
      showAvatars: false,
      onSelectWard: (selectedWardId) => {
        activeWardFilter = selectedWardId;
        renderListItems();
      },
    });
    switcherWrap.appendChild(switcher);
    body.appendChild(switcherWrap);
  }

  renderListItems();
  body.appendChild(listWrap);

  // Subtle footer linking to the full Pending Approvals view
  if (props.onViewPending) {
    const footer = document.createElement('div');
    footer.className = 'gd-pending-modal-footer';

    const openQueueBtn = document.createElement('button');
    openQueueBtn.type = 'button';
    openQueueBtn.className = 'gd-ward-btn-secondary gd-pending-modal-queue-btn';
    openQueueBtn.innerHTML = `<span>Open Full Pending Queue</span> <span class="gd-arrow" aria-hidden="true">&rarr;</span>`;
    openQueueBtn.addEventListener('click', () => {
      closeWithCleanup();
      props.onViewPending?.();
    });

    footer.appendChild(openQueueBtn);
    body.appendChild(footer);
  }

  card.appendChild(body);
  backdrop.appendChild(card);

  // Close when clicking outside card
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeWithCleanup();
    }
  });

  // Close on Escape key
  handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeWithCleanup();
    }
  };
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', handleKeyDown);
  }

  return backdrop;
}
