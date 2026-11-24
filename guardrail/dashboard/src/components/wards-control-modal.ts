/**
 * Guardrail Trusted Contact Portal — Wards Control Center Modal
 *
 * Minimal editorial popup modal for inspecting, filtering, and controlling
 * active wards linked to the caretaker account. Adheres to the Quiet Assurance
 * aesthetic: zero pure-white fills, refined typography, and organic opening animation.
 */

import { ApprovalRequest } from '../types.js';
import { formatWardDisplayName } from './overview.js';

export interface WardSummary {
  id: string;
  name: string;
  email?: string;
  relationshipLabel?: string;
}

export interface WardsControlModalProps {
  isOpen?: boolean;
  onClose: () => void;
  connectedWards: readonly WardSummary[];
  pendingRequests?: readonly ApprovalRequest[];
  onDisconnectWard?: (wardId: string) => Promise<void> | void;
  onFilterWardPending?: (wardId: string) => void;
  onFilterWardHistory?: (wardId: string) => void;
  onConnectInvitation?: (code: string) => Promise<{ success: boolean; wardId?: string; error?: string }>;
}

/**
 * Extracts initials from a ward's display name for avatar rendering.
 */
function getWardInitials(name: string): string {
  if (!name || !name.trim()) return 'W';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Renders the Wards Control Modal dialog element.
 */
export function renderWardsControlModal(props: WardsControlModalProps): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.id = 'gd-wards-control-modal-root';
  backdrop.className = 'gd-wards-modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'gd-wards-modal-title');

  const card = document.createElement('div');
  card.className = 'gd-wards-modal-card';

  // =========================================================================
  // 1. HEADER SECTION (Minimal, typography-driven)
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
  titleIcon.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
  `;

  const title = document.createElement('h2');
  title.id = 'gd-wards-modal-title';
  title.className = 'gd-wards-modal-title';
  title.textContent = 'Managed Wards';

  const wardCount = props.connectedWards.length;
  const countBadge = document.createElement('span');
  countBadge.className = 'gd-wards-modal-badge';
  countBadge.textContent = wardCount === 0 ? 'No Wards' : `${wardCount} Connected`;

  titleRow.appendChild(titleIcon);
  titleRow.appendChild(title);
  titleRow.appendChild(countBadge);
  headerLeft.appendChild(titleRow);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-wards-modal-close-btn';
  closeBtn.setAttribute('aria-label', 'Close wards control dialog');
  closeBtn.innerHTML = `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  closeBtn.addEventListener('click', () => {
    props.onClose();
  });

  header.appendChild(headerLeft);
  header.appendChild(closeBtn);
  card.appendChild(header);

  // =========================================================================
  // 2. QUIET ASSURANCE EDITORIAL METADATA STRIP (Zero pills, pure typography)
  // =========================================================================
  const allPending = props.pendingRequests ?? [];
  const summaryStrip = document.createElement('div');
  summaryStrip.className = 'gd-wards-modal-summary-strip';

  if (wardCount > 0) {
    const metaProtected = document.createElement('span');
    metaProtected.className = 'gd-summary-meta-item';
    metaProtected.textContent = `${wardCount} Protected`;

    const divider1 = document.createElement('span');
    divider1.className = 'gd-summary-meta-divider';
    divider1.textContent = '·';

    const metaReview = document.createElement('span');
    metaReview.className = `gd-summary-meta-item ${allPending.length > 0 ? 'attention' : ''}`;
    metaReview.textContent = allPending.length > 0
      ? `${allPending.length} Needs Review`
      : 'All Clear';

    const divider2 = document.createElement('span');
    divider2.className = 'gd-summary-meta-divider';
    divider2.textContent = '·';

    const metaLive = document.createElement('span');
    metaLive.className = 'gd-summary-meta-item live';
    metaLive.textContent = 'Live Protection';

    summaryStrip.appendChild(metaProtected);
    summaryStrip.appendChild(divider1);
    summaryStrip.appendChild(metaReview);
    summaryStrip.appendChild(divider2);
    summaryStrip.appendChild(metaLive);
  } else {
    const metaEmpty = document.createElement('span');
    metaEmpty.className = 'gd-summary-meta-item';
    metaEmpty.textContent = 'Awaiting your first ward invitation';
    summaryStrip.appendChild(metaEmpty);
  }
  card.appendChild(summaryStrip);

  // =========================================================================
  // 3. MODAL BODY (No white boxes, open spatial rhythm)
  // =========================================================================
  const body = document.createElement('div');
  body.className = 'gd-wards-modal-body';

  if (wardCount === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'gd-wards-modal-empty';

    const emptyIcon = document.createElement('div');
    emptyIcon.className = 'gd-wards-empty-icon';
    emptyIcon.innerHTML = `
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <line x1="17" y1="11" x2="23" y2="11"></line>
      </svg>
    `;

    const emptyTitle = document.createElement('h3');
    emptyTitle.className = 'gd-wards-empty-title';
    emptyTitle.textContent = 'No Wards Connected';

    const emptyDesc = document.createElement('p');
    emptyDesc.className = 'gd-wards-empty-desc';
    emptyDesc.textContent = 'Enter an 8-character pairing code below to link a ward.';

    emptyState.appendChild(emptyIcon);
    emptyState.appendChild(emptyTitle);
    emptyState.appendChild(emptyDesc);
    body.appendChild(emptyState);
  } else {
    const listContainer = document.createElement('div');
    listContainer.className = 'gd-wards-modal-list';

    props.connectedWards.forEach((ward) => {
      const wardCard = document.createElement('article');
      wardCard.className = 'gd-ward-control-card';
      wardCard.setAttribute('data-ward-id', ward.id);

      const wardPending = allPending.filter((r) => r.requesterId === ward.id || (r as any).wardId === ward.id);
      const pendingCount = wardPending.length;

      // Top row: Avatar + Identity + Queue Status Chip
      const topRow = document.createElement('div');
      topRow.className = 'gd-ward-control-top';

      const avatar = document.createElement('div');
      avatar.className = 'gd-ward-control-avatar';
      avatar.textContent = getWardInitials(ward.name);

      const statusDot = document.createElement('span');
      statusDot.className = 'gd-ward-status-dot online';
      statusDot.title = 'Active';
      avatar.appendChild(statusDot);

      const identityCol = document.createElement('div');
      identityCol.className = 'gd-ward-control-identity';

      const nameRow = document.createElement('div');
      nameRow.className = 'gd-ward-name-row';

      const nameEl = document.createElement('h3');
      nameEl.className = 'gd-ward-control-name';
      nameEl.textContent = formatWardDisplayName(ward.name, ward.id);

      const idTag = document.createElement('span');
      idTag.className = 'gd-ward-control-id-tag';
      idTag.textContent = ward.id;

      nameRow.appendChild(nameEl);
      nameRow.appendChild(idTag);

      const emailEl = document.createElement('div');
      emailEl.className = 'gd-ward-control-email';
      emailEl.textContent = ward.email || 'Email not registered';

      identityCol.appendChild(nameRow);
      identityCol.appendChild(emailEl);

      const queueStatus = document.createElement('div');
      queueStatus.className = 'gd-ward-queue-status';

      const pendingBadge = document.createElement('span');
      pendingBadge.className = `gd-ward-pending-badge ${pendingCount > 0 ? 'warning' : 'clear'}`;

      if (pendingCount > 0) {
        const pulseDot = document.createElement('span');
        pulseDot.className = 'gd-pulse-dot';
        pendingBadge.appendChild(pulseDot);

        const badgeText = document.createElement('span');
        badgeText.className = 'gd-badge-text';
        badgeText.textContent = `${pendingCount} Pending ${pendingCount === 1 ? 'Approval' : 'Approvals'}`;
        pendingBadge.appendChild(badgeText);
      } else {
        const badgeText = document.createElement('span');
        badgeText.className = 'gd-badge-text';
        badgeText.textContent = '✓ All Clear';
        pendingBadge.appendChild(badgeText);
      }

      queueStatus.appendChild(pendingBadge);

      // Action Controls
      const actionsRow = document.createElement('div');
      actionsRow.className = 'gd-ward-control-actions';

      // Primary Action: Review Approvals or View History
      const reviewBtn = document.createElement('button');
      reviewBtn.type = 'button';
      reviewBtn.className = pendingCount > 0 ? 'gd-ward-btn-primary' : 'gd-ward-btn-secondary';

      const reviewBtnText = document.createElement('span');
      reviewBtnText.textContent = pendingCount > 0
        ? `Review Approvals (${pendingCount})`
        : 'View History';

      const reviewArrow = document.createElement('span');
      reviewArrow.className = 'gd-arrow';
      reviewArrow.setAttribute('aria-hidden', 'true');
      reviewArrow.innerHTML = '&rarr;';

      reviewBtn.appendChild(reviewBtnText);
      reviewBtn.appendChild(reviewArrow);

      reviewBtn.addEventListener('click', () => {
        props.onClose();
        if (pendingCount > 0) {
          props.onFilterWardPending?.(ward.id);
        } else {
          props.onFilterWardHistory?.(ward.id);
        }
      });

      // Secondary Action: Disconnect Ward
      const disconnectBtn = document.createElement('button');
      disconnectBtn.type = 'button';
      disconnectBtn.className = 'gd-ward-btn-disconnect';
      disconnectBtn.textContent = 'Disconnect';

      // Inline Confirmation container
      const confirmContainer = document.createElement('div');
      confirmContainer.className = 'gd-ward-disconnect-confirm';
      confirmContainer.style.display = 'none';

      const confirmPrompt = document.createElement('p');
      confirmPrompt.className = 'gd-ward-confirm-prompt';
      confirmPrompt.textContent = `Disconnect ${formatWardDisplayName(ward.name, ward.id)}?`;

      const confirmButtonsRow = document.createElement('div');
      confirmButtonsRow.className = 'gd-ward-confirm-buttons';

      const confirmYesBtn = document.createElement('button');
      confirmYesBtn.type = 'button';
      confirmYesBtn.className = 'gd-ward-btn-confirm-yes';
      confirmYesBtn.textContent = 'Yes, Disconnect';

      const confirmNoBtn = document.createElement('button');
      confirmNoBtn.type = 'button';
      confirmNoBtn.className = 'gd-ward-btn-confirm-no';
      confirmNoBtn.textContent = 'Cancel';

      confirmButtonsRow.appendChild(confirmYesBtn);
      confirmButtonsRow.appendChild(confirmNoBtn);
      confirmContainer.appendChild(confirmPrompt);
      confirmContainer.appendChild(confirmButtonsRow);

      disconnectBtn.addEventListener('click', () => {
        topRow.style.display = 'none';
        actionsRow.style.display = 'none';
        confirmContainer.style.display = 'flex';
      });

      confirmNoBtn.addEventListener('click', () => {
        confirmContainer.style.display = 'none';
        actionsRow.style.display = 'flex';
        topRow.style.display = 'flex';
      });

      confirmYesBtn.addEventListener('click', async () => {
        confirmYesBtn.disabled = true;
        confirmNoBtn.disabled = true;
        confirmYesBtn.textContent = 'Disconnecting...';
        try {
          await props.onDisconnectWard?.(ward.id);
        } catch {
          confirmYesBtn.textContent = 'Failed';
          confirmNoBtn.disabled = false;
        }
      });

      actionsRow.appendChild(reviewBtn);
      actionsRow.appendChild(disconnectBtn);

      topRow.appendChild(avatar);
      topRow.appendChild(identityCol);
      topRow.appendChild(queueStatus);
      topRow.appendChild(actionsRow);

      wardCard.appendChild(topRow);
      wardCard.appendChild(confirmContainer);
      listContainer.appendChild(wardCard);
    });

    body.appendChild(listContainer);
  }

  // =========================================================================
  // 3. QUICK PAIR / CONNECT NEW WARD SECTION (Minimal, unboxed)
  // =========================================================================
  const pairSection = document.createElement('div');
  pairSection.className = 'gd-wards-pair-section';

  const pairHeader = document.createElement('div');
  pairHeader.className = 'gd-wards-pair-header';

  const pairTitle = document.createElement('h4');
  pairTitle.className = 'gd-wards-pair-title';
  pairTitle.textContent = '+ Pair Another Ward';
  pairHeader.appendChild(pairTitle);

  const pairForm = document.createElement('form');
  pairForm.className = 'gd-wards-pair-form';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'gd-wards-pair-input-wrap';

  const pairInput = document.createElement('input');
  pairInput.type = 'text';
  pairInput.className = 'gd-wards-pair-input';
  pairInput.placeholder = 'PAIRING CODE (e.g. WARD-9821)';
  pairInput.maxLength = 12;
  pairInput.setAttribute('aria-label', 'Ward pairing code');
  pairInput.autocomplete = 'off';
  pairInput.spellcheck = false;

  pairInput.addEventListener('input', () => {
    pairInput.value = pairInput.value.toUpperCase();
  });

  const pairSubmit = document.createElement('button');
  pairSubmit.type = 'submit';
  pairSubmit.className = 'gd-wards-pair-submit-btn';
  pairSubmit.textContent = 'Connect Ward';

  inputWrap.appendChild(pairInput);
  inputWrap.appendChild(pairSubmit);
  pairForm.appendChild(inputWrap);

  const statusFeedback = document.createElement('div');
  statusFeedback.className = 'gd-wards-pair-feedback';
  statusFeedback.style.display = 'none';

  pairForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = pairInput.value.trim().toUpperCase();
    if (!code) {
      statusFeedback.textContent = 'Please enter a pairing code.';
      statusFeedback.className = 'gd-wards-pair-feedback error';
      statusFeedback.style.display = 'block';
      return;
    }

    pairSubmit.disabled = true;
    pairSubmit.textContent = 'Connecting...';
    statusFeedback.style.display = 'none';

    try {
      if (props.onConnectInvitation) {
        const result = await props.onConnectInvitation(code);
        if (result.success) {
          statusFeedback.textContent = `Connected successfully!`;
          statusFeedback.className = 'gd-wards-pair-feedback success';
          statusFeedback.style.display = 'block';
          pairInput.value = '';
        } else {
          statusFeedback.textContent = result.error || 'Failed to connect. Check code.';
          statusFeedback.className = 'gd-wards-pair-feedback error';
          statusFeedback.style.display = 'block';
        }
      } else {
        statusFeedback.textContent = 'Service unavailable.';
        statusFeedback.className = 'gd-wards-pair-feedback error';
        statusFeedback.style.display = 'block';
      }
    } catch (err: any) {
      statusFeedback.textContent = err?.message || 'Connection failed.';
      statusFeedback.className = 'gd-wards-pair-feedback error';
      statusFeedback.style.display = 'block';
    } finally {
      pairSubmit.disabled = false;
      pairSubmit.textContent = 'Connect Ward';
    }
  });

  pairSection.appendChild(pairHeader);
  pairSection.appendChild(pairForm);
  pairSection.appendChild(statusFeedback);

  body.appendChild(pairSection);
  card.appendChild(body);
  backdrop.appendChild(card);

  // Close when clicking outside card
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      props.onClose();
    }
  });

  // Close on Escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onClose();
      document.removeEventListener('keydown', handleKeyDown);
    }
  };
  document.addEventListener('keydown', handleKeyDown);

  return backdrop;
}
