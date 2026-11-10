/**
 * Guardrail Trusted-Contact Dashboard - Relationships Component
 *
 * Implements connected users and trusted contact relationship lifecycle management:
 * 1. Displays connected users (wards and contacts) and their authoritative status (ACTIVE, REVOKED).
 * 2. Displays invitations and their full lifecycle states (PENDING, ACCEPTED, EXPIRED, REVOKED).
 * 3. Shows accurate delivery status (distinguishing provider submission from inbox delivery).
 * 4. Enables supported operations: create invitation, revoke invitation, revoke contact relationship, and connect ward.
 * 5. Enforces deliberate consequential confirmations before revoking active relationships.
 * 6. Prevents duplicate submissions and actions on expired invitations.
 * 7. Strictly avoids fabricating data, leaking unauthorized users, or bypassing backend authorization.
 */

import {
  InvitationStatus,
  TrustedContact,
  TrustedContactInvitation,
  TrustedContactProfile,
  TrustedContactStatus,
  ViewStatus,
} from '../types.js';

export interface RelationshipsProps {
  profile: TrustedContactProfile | null;
  connectedUsers: readonly TrustedContact[];
  connectedUsersStatus: ViewStatus;
  connectedUsersError: string | null;
  invitations: readonly TrustedContactInvitation[];
  invitationsStatus: ViewStatus;
  invitationsError: string | null;
  isSubmitting?: boolean;
  actionMessage?: { type: 'success' | 'error' | 'info'; text: string } | null;
  isBackendUnavailable?: boolean;
  onCreateInvitation?: (payload: {
    recipientActorId: string;
    relationshipLabel?: string;
    ttlMs?: number;
  }) => Promise<{ success: boolean; invitation?: TrustedContactInvitation; error?: string }>;
  onRevokeInvitation?: (invitationId: string) => Promise<{ success: boolean; error?: string }>;
  onRevokeTrustedContact?: (contactId: string) => Promise<{ success: boolean; error?: string }>;
  onConnectInvitation?: (code: string) => Promise<{ success: boolean; wardId?: string; error?: string }>;
  onDisconnectWard?: () => void;
  onRefresh?: () => void;
}

export function isInvitationExpired(inv: TrustedContactInvitation): boolean {
  if (inv.status === InvitationStatus.EXPIRED) return true;
  if (inv.expiresAt && Number.isFinite(Date.parse(inv.expiresAt))) {
    return Date.now() >= Date.parse(inv.expiresAt);
  }
  return false;
}

export function formatTimeRelative(dateString: string): string {
  try {
    const timeMs = Date.parse(dateString);
    if (!Number.isFinite(timeMs)) return dateString;
    const diffMs = Date.now() - timeMs;
    const diffSec = Math.floor(Math.abs(diffMs) / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffMs < 0) {
      // Future
      if (diffMin < 60) return `in ${diffMin}m`;
      if (diffHour < 24) return `in ${diffHour}h`;
      return `in ${diffDay}d`;
    } else {
      // Past
      if (diffSec < 60) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHour < 24) return `${diffHour}h ago`;
      return `${diffDay}d ago`;
    }
  } catch {
    return dateString;
  }
}

export function renderRelationshipManagementSection(props: RelationshipsProps): HTMLElement {
  const container = document.createElement('div');
  container.className = 'gd-relationships-container';
  container.id = 'gd-relationships-container';

  // Action / Feedback Message Banner
  if (props.actionMessage) {
    const feedbackBanner = document.createElement('div');
    feedbackBanner.className = `gd-relationship-feedback-banner gd-feedback-${props.actionMessage.type}`;
    feedbackBanner.setAttribute('role', 'alert');
    feedbackBanner.setAttribute('aria-live', 'polite');

    const icon = document.createElement('span');
    icon.className = 'gd-feedback-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = props.actionMessage.type === 'success'
      ? `<svg class="gd-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
      : props.actionMessage.type === 'error'
      ? `<svg class="gd-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
      : `<svg class="gd-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;

    const text = document.createElement('span');
    text.className = 'gd-feedback-text';
    text.textContent = props.actionMessage.text;

    feedbackBanner.appendChild(icon);
    feedbackBanner.appendChild(text);
    container.appendChild(feedbackBanner);
  }

  // 1. Connected Users & Trusted Contacts Card
  const usersCard = document.createElement('div');
  usersCard.className = 'gd-card gd-relationships-card';
  usersCard.id = 'gd-connected-users-card';

  const usersHeader = document.createElement('div');
  usersHeader.className = 'gd-settings-card-header';

  const usersTitle = document.createElement('h2');
  usersTitle.className = 'gd-section-title';
  usersTitle.textContent = 'Connected Users & Trusted Contacts';

  // Calculate connected count: explicit contacts list + assigned ward if present
  const hasAssignedWard = Boolean(props.profile?.assignedWardId);
  const totalConnectedCount = props.connectedUsers.length + (hasAssignedWard ? 1 : 0);

  const usersBadge = document.createElement('span');
  usersBadge.className = 'gd-settings-badge gd-badge-active';
  usersBadge.textContent = `${totalConnectedCount} Active`;

  usersHeader.appendChild(usersTitle);
  usersHeader.appendChild(usersBadge);
  usersCard.appendChild(usersHeader);

  const usersSubtitle = document.createElement('p');
  usersSubtitle.className = 'gd-section-subtitle';
  usersSubtitle.textContent =
    'Users and trusted contacts associated with your account.';
  usersCard.appendChild(usersSubtitle);

  // Status handling for connected users
  if (props.connectedUsersStatus === 'loading') {
    const loadingEl = document.createElement('div');
    loadingEl.className = 'gd-relationships-loading';
    loadingEl.setAttribute('role', 'status');
    loadingEl.setAttribute('aria-busy', 'true');
    loadingEl.innerHTML = '<span class="gd-spinner"></span> Loading connected contacts from backend...';
    usersCard.appendChild(loadingEl);
  } else if (props.connectedUsersStatus === 'error' && props.connectedUsersError) {
    const errorEl = document.createElement('div');
    errorEl.className = 'gd-error-banner gd-relationships-error-banner';
    errorEl.setAttribute('role', 'alert');

    const errContent = document.createElement('div');
    errContent.className = 'gd-error-content';

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
    errText.textContent = `Backend error: ${props.connectedUsersError}`;

    errContent.appendChild(errIcon);
    errContent.appendChild(errText);
    errorEl.appendChild(errContent);

    if (props.onRefresh) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => props.onRefresh?.());
      errorEl.appendChild(retryBtn);
    }
    usersCard.appendChild(errorEl);
  } else if (totalConnectedCount === 0) {
    // Empty state
    const emptyEl = document.createElement('div');
    emptyEl.className = 'gd-relationships-empty';
    emptyEl.id = 'gd-connected-users-empty';

    const empIcon = document.createElement('div');
    empIcon.className = 'gd-placeholder-icon';
    empIcon.setAttribute('aria-hidden', 'true');
    empIcon.innerHTML = `
      <svg class="gd-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
    `;

    const empTitle = document.createElement('h3');
    empTitle.className = 'gd-placeholder-title';
    empTitle.textContent = 'No Connected Users or Contacts';

    const empDesc = document.createElement('p');
    empDesc.className = 'gd-placeholder-text';
    empDesc.textContent =
      'No active trusted-contact relationships are established. Generate an invitation below to designate a trusted contact, or connect with a pairing code.';

    emptyEl.appendChild(empIcon);
    emptyEl.appendChild(empTitle);
    emptyEl.appendChild(empDesc);
    usersCard.appendChild(emptyEl);
  } else {
    // List container
    const list = document.createElement('div');
    list.className = 'gd-relationships-list';
    list.id = 'gd-connected-users-list';

    // 1A. If current profile has an assigned ward (e.g. reviewer viewing their assigned ward)
    if (hasAssignedWard && props.profile?.assignedWardId) {
      const wardItem = document.createElement('div');
      wardItem.className = 'gd-relationship-item ward-item';
      wardItem.setAttribute('data-user-id', props.profile.assignedWardId);

      const itemLeft = document.createElement('div');
      itemLeft.className = 'gd-rel-item-left';

      const avatar = document.createElement('div');
      avatar.className = 'gd-rel-avatar ward-avatar';
      avatar.textContent = 'WD';
      avatar.setAttribute('aria-hidden', 'true');

      const info = document.createElement('div');
      info.className = 'gd-rel-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'gd-rel-name-row';

      const nameSpan = document.createElement('strong');
      nameSpan.className = 'gd-rel-name gd-mono';
      nameSpan.textContent = props.profile.assignedWardId;

      const roleBadge = document.createElement('span');
      roleBadge.className = 'gd-rel-role-badge';
      roleBadge.textContent = 'Ward (Protected User)';

      const statusBadge = document.createElement('span');
      statusBadge.className = 'gd-status-badge approved';
      statusBadge.textContent = 'ACTIVE';

      nameRow.appendChild(nameSpan);
      nameRow.appendChild(roleBadge);
      nameRow.appendChild(statusBadge);

      const metaRow = document.createElement('div');
      metaRow.className = 'gd-rel-meta-row';
      metaRow.textContent = `Relationship: ${props.profile.relationshipLabel ?? 'Designated Trusted Contact'} • Separation of Duties Enforced`;

      info.appendChild(nameRow);
      info.appendChild(metaRow);
      itemLeft.appendChild(avatar);
      itemLeft.appendChild(info);
      wardItem.appendChild(itemLeft);

      // Action: Disconnect Ward
      if (props.onDisconnectWard) {
        const itemActions = document.createElement('div');
        itemActions.className = 'gd-rel-actions';

        const disconnectBtn = document.createElement('button');
        disconnectBtn.type = 'button';
        disconnectBtn.className = 'gd-btn-revoke';
        disconnectBtn.disabled = Boolean(props.isSubmitting);
        disconnectBtn.textContent = 'Disconnect Ward';

        // Two-step confirmation box
        const confirmBox = document.createElement('div');
        confirmBox.className = 'gd-relationship-confirm-box';
        confirmBox.style.display = 'none';

        const confirmMsg = document.createElement('p');
        confirmMsg.className = 'gd-confirm-warning';
        confirmMsg.textContent =
          'Disconnecting from this ward unlinks your portal. You will no longer receive approval requests from them.';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'gd-btn-revoke-confirm';
        confirmBtn.disabled = Boolean(props.isSubmitting);
        confirmBtn.textContent = props.isSubmitting ? 'Disconnecting...' : 'Confirm Disconnect';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'gd-btn-cancel';
        cancelBtn.disabled = Boolean(props.isSubmitting);
        cancelBtn.textContent = 'Cancel';

        confirmBtn.addEventListener('click', () => {
          props.onDisconnectWard?.();
        });

        cancelBtn.addEventListener('click', () => {
          confirmBox.style.display = 'none';
          disconnectBtn.style.display = 'inline-block';
        });

        disconnectBtn.addEventListener('click', () => {
          disconnectBtn.style.display = 'none';
          confirmBox.style.display = 'block';
        });

        confirmBox.appendChild(confirmMsg);
        confirmBox.appendChild(confirmBtn);
        confirmBox.appendChild(cancelBtn);

        itemActions.appendChild(disconnectBtn);
        itemActions.appendChild(confirmBox);
        wardItem.appendChild(itemActions);
      }

      list.appendChild(wardItem);
    }

    // 1B. Render each authoritative TrustedContact from backend registry
    for (const contact of props.connectedUsers) {
      const contactItem = document.createElement('div');
      const isRevoked = contact.status === TrustedContactStatus.REVOKED;
      contactItem.className = `gd-relationship-item contact-item ${isRevoked ? 'is-revoked' : ''}`;
      contactItem.setAttribute('data-contact-id', contact.id);

      const itemLeft = document.createElement('div');
      itemLeft.className = 'gd-rel-item-left';

      const avatar = document.createElement('div');
      avatar.className = 'gd-rel-avatar contact-avatar';
      avatar.textContent = 'TC';
      avatar.setAttribute('aria-hidden', 'true');

      const info = document.createElement('div');
      info.className = 'gd-rel-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'gd-rel-name-row';

      const nameSpan = document.createElement('strong');
      nameSpan.className = 'gd-rel-name gd-mono';
      nameSpan.textContent = contact.contactId || contact.id;

      const roleBadge = document.createElement('span');
      roleBadge.className = 'gd-rel-role-badge';
      roleBadge.textContent = 'Trusted Contact';

      const statusBadge = document.createElement('span');
      statusBadge.className = `gd-status-badge ${isRevoked ? 'cancelled' : 'approved'}`;
      statusBadge.textContent = contact.status;

      nameRow.appendChild(nameSpan);
      nameRow.appendChild(roleBadge);
      nameRow.appendChild(statusBadge);

      const metaRow = document.createElement('div');
      metaRow.className = 'gd-rel-meta-row';
      const createdStr = contact.createdAt
        ? `Linked: ${new Date(contact.createdAt).toLocaleDateString()}`
        : 'Linked recently';
      const revokedStr = contact.revokedAt
        ? ` • Revoked: ${new Date(contact.revokedAt).toLocaleDateString()}`
        : '';
      const labelStr = contact.relationshipLabel ? ` • Label: ${contact.relationshipLabel}` : '';
      metaRow.textContent = `${createdStr}${revokedStr}${labelStr}`;

      info.appendChild(nameRow);
      info.appendChild(metaRow);
      itemLeft.appendChild(avatar);
      itemLeft.appendChild(info);
      contactItem.appendChild(itemLeft);

      // Actions: Revoke Contact (consequential confirmation)
      if (!isRevoked && props.onRevokeTrustedContact) {
        const itemActions = document.createElement('div');
        itemActions.className = 'gd-rel-actions';

        const revokeBtn = document.createElement('button');
        revokeBtn.type = 'button';
        revokeBtn.className = 'gd-btn-revoke';
        revokeBtn.disabled = Boolean(props.isSubmitting);
        revokeBtn.textContent = 'Revoke Relationship';
        revokeBtn.setAttribute('aria-label', `Revoke trusted contact authority for ${contact.id}`);

        // Two-step confirmation box
        const confirmBox = document.createElement('div');
        confirmBox.className = 'gd-relationship-confirm-box';
        confirmBox.style.display = 'none';
        confirmBox.setAttribute('role', 'alertdialog');
        confirmBox.setAttribute('aria-label', `Confirm revocation of ${contact.id}`);

        confirmBox.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            confirmBox.style.display = 'none';
            revokeBtn.style.display = 'inline-block';
            revokeBtn.focus();
          }
        });

        const confirmMsg = document.createElement('p');
        confirmMsg.className = 'gd-confirm-warning';
        confirmMsg.textContent =
          'Consequential Decision: Revoking this trusted-contact relationship authoritatively commits to the backend audit log. Their authority to evaluate browser actions will terminate immediately.';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'gd-btn-revoke-confirm';
        confirmBtn.disabled = Boolean(props.isSubmitting);
        confirmBtn.textContent = props.isSubmitting ? 'Revoking...' : 'Confirm Revoke';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'gd-btn-cancel';
        cancelBtn.disabled = Boolean(props.isSubmitting);
        cancelBtn.textContent = 'Cancel';

        let alreadySubmitted = false;
        confirmBtn.addEventListener('click', async () => {
          if (alreadySubmitted || props.isSubmitting) return;
          alreadySubmitted = true;
          confirmBtn.disabled = true;
          cancelBtn.disabled = true;
          confirmBtn.textContent = 'Revoking...';
          await props.onRevokeTrustedContact?.(contact.id);
        });

        cancelBtn.addEventListener('click', () => {
          confirmBox.style.display = 'none';
          revokeBtn.style.display = 'inline-block';
        });

        revokeBtn.addEventListener('click', () => {
          revokeBtn.style.display = 'none';
          confirmBox.style.display = 'block';
        });

        confirmBox.appendChild(confirmMsg);
        confirmBox.appendChild(confirmBtn);
        confirmBox.appendChild(cancelBtn);

        itemActions.appendChild(revokeBtn);
        itemActions.appendChild(confirmBox);
        contactItem.appendChild(itemActions);
      }

      list.appendChild(contactItem);
    }

    usersCard.appendChild(list);
  }

  container.appendChild(usersCard);

  // 2. Invitations & Pairing Codes Card
  const invitesCard = document.createElement('div');
  invitesCard.className = 'gd-card gd-relationships-card';
  invitesCard.id = 'gd-invitations-card';

  const invitesHeader = document.createElement('div');
  invitesHeader.className = 'gd-settings-card-header';

  const invitesTitle = document.createElement('h2');
  invitesTitle.className = 'gd-section-title';
  invitesTitle.textContent = 'Trusted Contact Invitations';

  const pendingInvitesCount = props.invitations.filter(
    (i) => i.status === InvitationStatus.PENDING && !isInvitationExpired(i)
  ).length;

  const invitesBadge = document.createElement('span');
  invitesBadge.className = 'gd-settings-badge gd-badge-neutral';
  invitesBadge.textContent = `${pendingInvitesCount} Pending`;

  invitesHeader.appendChild(invitesTitle);
  invitesHeader.appendChild(invitesBadge);
  invitesCard.appendChild(invitesHeader);

  const invitesSubtitle = document.createElement('p');
  invitesSubtitle.className = 'gd-section-subtitle';
  invitesSubtitle.textContent =
    'Active invitation codes and pending pairings.';
  invitesCard.appendChild(invitesSubtitle);

  // Invitations Status
  if (props.invitationsStatus === 'loading') {
    const loadingEl = document.createElement('div');
    loadingEl.className = 'gd-relationships-loading';
    loadingEl.setAttribute('role', 'status');
    loadingEl.setAttribute('aria-busy', 'true');
    loadingEl.innerHTML = '<span class="gd-spinner"></span> Loading invitations from backend...';
    invitesCard.appendChild(loadingEl);
  } else if (props.invitationsStatus === 'error' && props.invitationsError) {
    const errorEl = document.createElement('div');
    errorEl.className = 'gd-error-banner gd-relationships-error-banner';
    errorEl.setAttribute('role', 'alert');

    const errContent = document.createElement('div');
    errContent.className = 'gd-error-content';

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
    errText.textContent = `Backend error: ${props.invitationsError}`;

    errContent.appendChild(errIcon);
    errContent.appendChild(errText);
    errorEl.appendChild(errContent);
    invitesCard.appendChild(errorEl);
  } else if (props.invitations.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'gd-relationships-empty';
    emptyEl.id = 'gd-invitations-empty';

    const empIcon = document.createElement('div');
    empIcon.className = 'gd-placeholder-icon';
    empIcon.setAttribute('aria-hidden', 'true');
    empIcon.innerHTML = `
      <svg class="gd-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
        <polyline points="22,6 12,13 2,6"></polyline>
      </svg>
    `;

    const empTitle = document.createElement('h3');
    empTitle.className = 'gd-placeholder-title';
    empTitle.textContent = 'No Invitations Issued';

    const empDesc = document.createElement('p');
    empDesc.className = 'gd-placeholder-text';
    empDesc.textContent =
      'You have not generated any trusted-contact pairing codes yet. Fill out the form below to invite a designated contact.';

    emptyEl.appendChild(empIcon);
    emptyEl.appendChild(empTitle);
    emptyEl.appendChild(empDesc);
    invitesCard.appendChild(emptyEl);
  } else {
    // List of Invitations
    const invitesList = document.createElement('div');
    invitesList.className = 'gd-relationships-list';
    invitesList.id = 'gd-invitations-list';

    for (const inv of props.invitations) {
      const isExpired = isInvitationExpired(inv);
      const isPending = inv.status === InvitationStatus.PENDING && !isExpired;
      const isAccepted = inv.status === InvitationStatus.ACCEPTED;
      const isRevoked = inv.status === InvitationStatus.REVOKED;

      const invItem = document.createElement('div');
      invItem.className = `gd-relationship-item invitation-item ${
        isExpired ? 'is-expired' : isRevoked ? 'is-revoked' : isAccepted ? 'is-accepted' : 'is-pending'
      }`;
      invItem.setAttribute('data-invitation-id', inv.id);

      const itemLeft = document.createElement('div');
      itemLeft.className = 'gd-rel-item-left';

      const avatar = document.createElement('div');
      avatar.className = 'gd-rel-avatar invite-avatar';
      avatar.textContent = 'INV';
      avatar.setAttribute('aria-hidden', 'true');

      const info = document.createElement('div');
      info.className = 'gd-rel-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'gd-rel-name-row';

      const recipientSpan = document.createElement('strong');
      recipientSpan.className = 'gd-rel-name gd-mono';
      recipientSpan.textContent = inv.recipientActorId || inv.id;

      // Status badge
      const statusBadge = document.createElement('span');
      if (isPending) {
        statusBadge.className = 'gd-status-badge pending';
        statusBadge.textContent = 'PENDING';
      } else if (isAccepted) {
        statusBadge.className = 'gd-status-badge approved';
        statusBadge.textContent = 'ACCEPTED';
      } else if (isExpired) {
        statusBadge.className = 'gd-status-badge expired';
        statusBadge.textContent = 'EXPIRED';
      } else {
        statusBadge.className = 'gd-status-badge cancelled';
        statusBadge.textContent = 'REVOKED';
      }

      // Delivery Status Badge
      const deliveryBadge = document.createElement('span');
      const dStatus = inv.deliveryStatus ?? 'NOT_CONFIGURED';
      if (dStatus === 'SUBMITTED') {
        deliveryBadge.className = 'gd-delivery-badge delivery-submitted';
        deliveryBadge.textContent = 'Email Submitted';
        deliveryBadge.title =
          'Accepted by delivery provider; inbox receipt depends on recipient mail infrastructure.';
      } else if (dStatus === 'FAILED') {
        deliveryBadge.className = 'gd-delivery-badge delivery-failed';
        deliveryBadge.textContent = 'Delivery Failed';
        deliveryBadge.title = `Provider error: ${inv.deliveryFailureCode || 'FAILED'}`;
      } else {
        deliveryBadge.className = 'gd-delivery-badge delivery-manual';
        deliveryBadge.textContent = 'Manual Out-of-Band Delivery';
        deliveryBadge.title =
          'Email delivery not configured. Pairing code must be securely transmitted out-of-band.';
      }

      nameRow.appendChild(recipientSpan);
      nameRow.appendChild(statusBadge);
      nameRow.appendChild(deliveryBadge);

      // Meta row
      const metaRow = document.createElement('div');
      metaRow.className = 'gd-rel-meta-row';

      const createdTime = inv.createdAt ? `Created ${formatTimeRelative(inv.createdAt)}` : '';
      let statusDetails = '';
      if (isPending) {
        statusDetails = inv.expiresAt ? ` • Expires ${formatTimeRelative(inv.expiresAt)}` : '';
      } else if (isAccepted) {
        statusDetails = ` • Accepted by ${inv.acceptedByContactId || 'contact'}${
          inv.acceptedAt ? ` ${formatTimeRelative(inv.acceptedAt)}` : ''
        }`;
      } else if (isExpired) {
        statusDetails = ` • Expired ${formatTimeRelative(inv.expiresAt || inv.expiredAt || '')}`;
      } else if (isRevoked) {
        statusDetails = ` • Revoked ${inv.revokedAt ? formatTimeRelative(inv.revokedAt) : ''}`;
      }

      const labelDetails = inv.relationshipLabel ? ` • Label: ${inv.relationshipLabel}` : '';
      metaRow.textContent = `${createdTime}${statusDetails}${labelDetails}`;

      info.appendChild(nameRow);
      info.appendChild(metaRow);

      // If one-time pairing code is visible in the record, display it securely
      if (inv.code) {
        const codeRow = document.createElement('div');
        codeRow.className = 'gd-invite-code-row';
        const codeLabel = document.createElement('span');
        codeLabel.className = 'gd-code-label';
        codeLabel.textContent = 'Pairing Code: ';
        const codeChip = document.createElement('code');
        codeChip.className = 'gd-code-chip gd-mono';
        codeChip.textContent = inv.code;
        codeRow.appendChild(codeLabel);
        codeRow.appendChild(codeChip);
        info.appendChild(codeRow);
      }

      itemLeft.appendChild(avatar);
      itemLeft.appendChild(info);
      invItem.appendChild(itemLeft);

      // Action: Revoke pending invitation
      if (isPending && props.onRevokeInvitation) {
        const itemActions = document.createElement('div');
        itemActions.className = 'gd-rel-actions';

        const revokeBtn = document.createElement('button');
        revokeBtn.type = 'button';
        revokeBtn.className = 'gd-btn-revoke';
        revokeBtn.disabled = Boolean(props.isSubmitting);
        revokeBtn.textContent = 'Revoke Code';
        revokeBtn.setAttribute('aria-label', `Revoke invitation for ${inv.recipientActorId}`);

        // Two-step confirmation box
        const confirmBox = document.createElement('div');
        confirmBox.className = 'gd-relationship-confirm-box';
        confirmBox.style.display = 'none';
        confirmBox.setAttribute('role', 'alertdialog');
        confirmBox.setAttribute('aria-label', `Confirm revocation of invitation for ${inv.recipientActorId}`);

        confirmBox.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            confirmBox.style.display = 'none';
            revokeBtn.style.display = 'inline-block';
            revokeBtn.focus();
          }
        });

        const confirmMsg = document.createElement('p');
        confirmMsg.className = 'gd-confirm-warning';
        confirmMsg.textContent =
          'Revoking this invitation invalidates the pairing code immediately. The recipient will be unable to accept it.';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'gd-btn-revoke-confirm';
        confirmBtn.disabled = Boolean(props.isSubmitting);
        confirmBtn.textContent = props.isSubmitting ? 'Revoking...' : 'Confirm Revoke';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'gd-btn-cancel';
        cancelBtn.disabled = Boolean(props.isSubmitting);
        cancelBtn.textContent = 'Cancel';

        let alreadySubmitted = false;
        confirmBtn.addEventListener('click', async () => {
          if (alreadySubmitted || props.isSubmitting) return;
          alreadySubmitted = true;
          confirmBtn.disabled = true;
          cancelBtn.disabled = true;
          confirmBtn.textContent = 'Revoking...';
          await props.onRevokeInvitation?.(inv.id);
        });

        cancelBtn.addEventListener('click', () => {
          confirmBox.style.display = 'none';
          revokeBtn.style.display = 'inline-block';
        });

        revokeBtn.addEventListener('click', () => {
          revokeBtn.style.display = 'none';
          confirmBox.style.display = 'block';
        });

        confirmBox.appendChild(confirmMsg);
        confirmBox.appendChild(confirmBtn);
        confirmBox.appendChild(cancelBtn);

        itemActions.appendChild(revokeBtn);
        itemActions.appendChild(confirmBox);
        invItem.appendChild(itemActions);
      }

      invitesList.appendChild(invItem);
    }

    invitesCard.appendChild(invitesList);
  }

  // 3. Create Invitation Form (if supported)
  if (props.onCreateInvitation) {
    const createSection = document.createElement('div');
    createSection.className = 'gd-create-invite-section';

    const createTitle = document.createElement('h3');
    createTitle.className = 'gd-subsection-title';
    createTitle.textContent = 'Issue New Trusted Contact Invitation';

    const createDesc = document.createElement('p');
    createDesc.className = 'gd-section-subtitle';
    createDesc.textContent =
      'Generate a secure pairing code to invite a trusted contact.';

    createSection.appendChild(createTitle);
    createSection.appendChild(createDesc);

    const form = document.createElement('form');
    form.className = 'gd-create-invite-form';
    form.noValidate = true;

    const row = document.createElement('div');
    row.className = 'gd-invite-fields-row';

    // Field 1: Recipient Actor ID
    const recipientGroup = document.createElement('div');
    recipientGroup.className = 'gd-form-group';
    const recipientLabel = document.createElement('label');
    recipientLabel.htmlFor = 'gd-input-recipient-id';
    recipientLabel.textContent = 'Recipient Actor ID *';
    const recipientInput = document.createElement('input');
    recipientInput.type = 'text';
    recipientInput.id = 'gd-input-recipient-id';
    recipientInput.className = 'gd-input-text';
    recipientInput.placeholder = 'tc_carol (verified contact ID)';
    recipientInput.required = true;
    recipientInput.maxLength = 64;
    recipientInput.disabled = Boolean(props.isSubmitting);
    recipientGroup.appendChild(recipientLabel);
    recipientGroup.appendChild(recipientInput);

    // Field 2: Relationship Label
    const labelGroup = document.createElement('div');
    labelGroup.className = 'gd-form-group';
    const labelLabel = document.createElement('label');
    labelLabel.htmlFor = 'gd-input-relationship-label';
    labelLabel.textContent = 'Relationship Label';
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.id = 'gd-input-relationship-label';
    labelInput.className = 'gd-input-text';
    labelInput.placeholder = 'e.g. Guardian, Financial Advisor';
    labelInput.maxLength = 64;
    labelInput.disabled = Boolean(props.isSubmitting);
    labelGroup.appendChild(labelLabel);
    labelGroup.appendChild(labelInput);

    // Field 3: TTL Window
    const ttlGroup = document.createElement('div');
    ttlGroup.className = 'gd-form-group';
    const ttlLabel = document.createElement('label');
    ttlLabel.htmlFor = 'gd-select-ttl';
    ttlLabel.textContent = 'Expiration Window';
    const ttlSelect = document.createElement('select');
    ttlSelect.id = 'gd-select-ttl';
    ttlSelect.className = 'gd-select';
    ttlSelect.disabled = Boolean(props.isSubmitting);

    const opt24h = document.createElement('option');
    opt24h.value = String(24 * 60 * 60 * 1000);
    opt24h.textContent = '24 Hours (Default)';

    const opt7d = document.createElement('option');
    opt7d.value = String(7 * 24 * 60 * 60 * 1000);
    opt7d.textContent = '7 Days';

    const opt30d = document.createElement('option');
    opt30d.value = String(30 * 24 * 60 * 60 * 1000);
    opt30d.textContent = '30 Days';

    ttlSelect.appendChild(opt24h);
    ttlSelect.appendChild(opt7d);
    ttlSelect.appendChild(opt30d);
    ttlGroup.appendChild(ttlLabel);
    ttlGroup.appendChild(ttlSelect);

    row.appendChild(recipientGroup);
    row.appendChild(labelGroup);
    row.appendChild(ttlGroup);
    form.appendChild(row);

    // Submit Row
    const submitRow = document.createElement('div');
    submitRow.className = 'gd-invite-submit-row';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.id = 'gd-btn-create-invitation';
    submitBtn.className = 'gd-btn-submit-invite';
    submitBtn.disabled = Boolean(props.isSubmitting);
    submitBtn.textContent = props.isSubmitting ? 'Generating...' : 'Generate Invitation Code';

    submitRow.appendChild(submitBtn);
    form.appendChild(submitRow);

    // Feedback container
    const formFeedback = document.createElement('div');
    formFeedback.id = 'gd-create-invite-feedback';
    formFeedback.className = 'gd-setup-feedback';
    formFeedback.setAttribute('role', 'status');
    formFeedback.setAttribute('aria-live', 'polite');
    form.appendChild(formFeedback);

    let isSubmittingLocal = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isSubmittingLocal || props.isSubmitting) return;

      const recipient = recipientInput.value.trim();
      const label = labelInput.value.trim();
      const ttlMs = parseInt(ttlSelect.value, 10) || 24 * 60 * 60 * 1000;

      formFeedback.textContent = '';
      formFeedback.className = 'gd-setup-feedback';

      if (!recipient) {
        formFeedback.className = 'gd-setup-feedback error';
        formFeedback.textContent = 'Please enter a recipient actor ID.';
        recipientInput.focus();
        return;
      }

      // Self-invitation client check
      if (props.profile?.actorId && recipient === props.profile.actorId) {
        formFeedback.className = 'gd-setup-feedback error';
        formFeedback.textContent =
          'Self-invitation prohibited: You cannot designate your own identity as a trusted contact.';
        recipientInput.focus();
        return;
      }

      isSubmittingLocal = true;
      submitBtn.disabled = true;
      recipientInput.disabled = true;
      labelInput.disabled = true;
      ttlSelect.disabled = true;
      submitBtn.textContent = 'Generating...';

      try {
        const res = await props.onCreateInvitation?.({
          recipientActorId: recipient,
          relationshipLabel: label || undefined,
          ttlMs,
        });

        if (res?.success && res.invitation) {
          formFeedback.className = 'gd-setup-feedback success';
          formFeedback.textContent = `Invitation created! Code: ${res.invitation.code || res.invitation.id} (Expires: ${new Date(
            res.invitation.expiresAt
          ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). Share this out-of-band with ${recipient}.`;
          recipientInput.value = '';
          labelInput.value = '';
        } else {
          formFeedback.className = 'gd-setup-feedback error';
          formFeedback.textContent = res?.error || 'Failed to generate invitation code.';
        }
      } catch (err: unknown) {
        formFeedback.className = 'gd-setup-feedback error';
        formFeedback.textContent = err instanceof Error ? err.message : 'Unexpected error.';
      } finally {
        isSubmittingLocal = false;
        submitBtn.disabled = false;
        recipientInput.disabled = false;
        labelInput.disabled = false;
        ttlSelect.disabled = false;
        submitBtn.textContent = 'Generate Invitation Code';
      }
    });

    createSection.appendChild(form);
    invitesCard.appendChild(createSection);
  }

  container.appendChild(invitesCard);

  return container;
}
