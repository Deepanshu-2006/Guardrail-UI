/**
 * Guardrail Trusted-Contact Dashboard - Overview Component
 *
 * Implements the Quiet Assurance design system:
 * - Section A: Page Introduction (Manrope heading, DM Sans subtitle)
 * - Section B: Refined Service Connection Status (Consolidated, no duplicate alerts)
 * - Section C: 3 Balanced Key Metrics (Manrope 32px numbers, DM Sans labels)
 * - Section D: Pending Approval Requests (DM Sans copy, IBM Plex Mono timestamps)
 * - Section E: Connect a Ward (Concise 3-step guide, IBM Plex Mono code input) / Active Ward Card
 * - Section F: Decoupled Action Execution Architecture (Compact informational note)
 * - Section G: Recent Activity (DM Sans descriptions, IBM Plex Mono timestamps)
 *
 * Clean Lucide SVG icons throughout (no emojis).
 * Strictly preserves 100% of underlying application logic, event handlers, and test assertions.
 */

import { ApprovalRequest, ApprovalStatus, RiskLevel, TrustedContactProfile, ViewStatus } from '../types.js';
import { createIcon, setAnimatedHeading } from './icons.js';

export interface OverviewProps {
  profile: TrustedContactProfile | null;
  pendingCount: number;
  pendingRequests?: readonly ApprovalRequest[];
  pendingStatus?: ViewStatus;
  errorMessage?: string | null;
  recentActivity?: readonly ApprovalRequest[];
  isBackendUnavailable?: boolean;
  isMockService?: boolean;
  environment?: string;
  lastSynchronizedAt?: Date | null;
  isSubmitting?: boolean;
  onViewHistory?: () => void;
  onViewPending?: () => void;
  onViewSettings?: () => void;
  onSelectPending?: (requestId: string) => void;
  onConnectInvitation?: (code: string) => Promise<{ success: boolean; wardId?: string; error?: string }>;
  onDisconnectWard?: () => void;
  onRefresh?: () => void;
}

export function renderOverview(props: OverviewProps): HTMLElement {
  const section = document.createElement('section');
  section.id = 'view-overview';
  section.className = 'gd-view-section active';
  section.setAttribute('aria-labelledby', 'overview-title');

  // =========================================================================
  // SECTION A: PAGE INTRODUCTION
  // =========================================================================
  const header = document.createElement('header');
  header.className = 'gd-section-header';

  const title = document.createElement('h1');
  title.id = 'overview-title';
  title.className = 'gd-section-title';
  setAnimatedHeading(title, 'Overview');

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-section-subtitle';
  subtitle.textContent = 'Your trusted contact activity and pending decisions.';

  header.appendChild(title);
  header.appendChild(subtitle);
  section.appendChild(header);

  // =========================================================================
  // SECTION B: SERVICE CONNECTION STATUS
  // =========================================================================
  const protectionCard = document.createElement('div');
  protectionCard.className = 'gd-card gd-protection-status-card';
  protectionCard.setAttribute('role', 'region');
  protectionCard.setAttribute('aria-label', 'System Protection Status');

  const protHeader = document.createElement('div');
  protHeader.className = 'gd-protection-header';

  const protIcon = document.createElement('div');
  protIcon.className = 'gd-protection-icon';
  protIcon.setAttribute('aria-hidden', 'true');

  const protTextGroup = document.createElement('div');
  protTextGroup.className = 'gd-protection-text-group';

  const protTitle = document.createElement('h2');
  protTitle.className = 'gd-protection-title';

  const protDesc = document.createElement('p');
  protDesc.className = 'gd-protection-desc';

  const protBadge = document.createElement('span');
  protBadge.className = 'gd-protection-badge';

  const protActions = document.createElement('div');
  protActions.className = 'gd-protection-actions';

  if (props.isBackendUnavailable) {
    protectionCard.classList.add('status-offline');
    protIcon.appendChild(createIcon('alert-circle', 'gd-status-icon-offline'));
    protBadge.className = 'gd-protection-badge badge-offline';
    protBadge.textContent = 'Service Connection Offline';
    protTitle.textContent = 'Approval service unavailable';
    protDesc.textContent =
      'Approval synchronization is temporarily paused. Check your connection and retry.';

    protActions.appendChild(protBadge);

    if (props.onRefresh) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-retry-action';
      retryBtn.textContent = 'Retry connection';
      retryBtn.addEventListener('click', () => {
        props.onRefresh?.();
      });
      protActions.appendChild(retryBtn);
    }
  } else if (props.isMockService) {
    protectionCard.classList.add('status-mock');
    protIcon.appendChild(createIcon('flask', 'gd-status-icon-mock'));
    protBadge.className = 'gd-protection-badge badge-mock';
    protBadge.textContent = 'Development Fixture Active';
    protTitle.textContent = 'Development Fixture Active';
    protDesc.textContent =
      'Operating in local preview mode. Changes are saved for testing.';
    protActions.appendChild(protBadge);
  } else if (props.profile?.isAuthenticated) {
    protectionCard.classList.add('status-operational');
    protIcon.appendChild(createIcon('shield-check', 'gd-status-icon-operational'));
    protBadge.className = 'gd-protection-badge badge-active';
    protBadge.textContent = 'Live Guardrail Protection Active';
    protTitle.textContent = 'Live Guardrail Protection Active';
    protDesc.textContent =
      'Connected and actively protecting your contacts. Any approval requests will appear below.';
    protActions.appendChild(protBadge);
  } else {
    protectionCard.classList.add('status-standalone');
    protIcon.appendChild(createIcon('lock', 'gd-status-icon-standalone'));
    protBadge.className = 'gd-protection-badge badge-standalone';
    protBadge.textContent = 'Standalone Preview Mode';
    protTitle.textContent = 'Standalone Preview Mode';
    protDesc.textContent =
      'Running in preview mode. Connect a contact below using an invitation code to begin.';
    protActions.appendChild(protBadge);
  }

  protTextGroup.appendChild(protTitle);
  protTextGroup.appendChild(protDesc);
  protHeader.appendChild(protIcon);
  protHeader.appendChild(protTextGroup);
  protHeader.appendChild(protActions);
  protectionCard.appendChild(protHeader);

  // Invariant Posture Chips Row
  const chipsRow = document.createElement('div');
  chipsRow.className = 'gd-protection-chips-row';

  const createChip = (iconName: any, label: string, value: string, isMonoValue: boolean = false) => {
    const chip = document.createElement('div');
    chip.className = 'gd-protection-chip';

    const icn = document.createElement('span');
    icn.className = 'gd-chip-icon';
    icn.setAttribute('aria-hidden', 'true');
    icn.appendChild(createIcon(iconName));

    const lbl = document.createElement('span');
    lbl.className = 'gd-chip-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className = isMonoValue ? 'gd-chip-val gd-mono' : 'gd-chip-val';
    val.textContent = value;

    chip.appendChild(icn);
    chip.appendChild(lbl);
    chip.appendChild(val);
    return chip;
  };

  chipsRow.appendChild(createChip('zap', 'Interception', 'Active in Staging Mode'));
  chipsRow.appendChild(createChip('lock', 'Execution', 'Decoupled (Consent Only)'));
  chipsRow.appendChild(createChip('users', 'Isolation', 'Strict Multi-Tenant Scoping'));

  const syncTimeStr = props.lastSynchronizedAt
    ? props.lastSynchronizedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Not yet synchronized';
  chipsRow.appendChild(createChip('clock', 'Last Sync', syncTimeStr, true));

  protectionCard.appendChild(chipsRow);
  section.appendChild(protectionCard);

  // =========================================================================
  // SECTION C: KEY METRICS
  // =========================================================================
  const grid = document.createElement('div');
  grid.className = 'gd-overview-grid';

  // Metric 1: Assigned Wards
  const wardCard = document.createElement('div');
  wardCard.className = 'gd-metric-card';

  const wardHeader = document.createElement('div');
  wardHeader.className = 'gd-metric-header';
  const wardLabel = document.createElement('span');
  wardLabel.className = 'gd-metric-label';
  wardLabel.textContent = 'Assigned Wards';
  const wardBadge = document.createElement('span');
  wardBadge.className = 'gd-metric-badge';
  wardBadge.textContent = props.profile?.assignedWardId ? 'Linked' : 'Unlinked';
  wardHeader.appendChild(wardLabel);
  wardHeader.appendChild(wardBadge);

  const wardValue = document.createElement('span');
  wardValue.className = 'gd-metric-value';
  wardValue.textContent = props.profile?.assignedWardId ? '1' : '0';

  const wardDesc = document.createElement('span');
  wardDesc.className = 'gd-metric-desc';
  wardDesc.textContent = props.profile?.assignedWardId
    ? `Designated reviewer for ${props.profile.assignedWardId}`
    : 'No accounts linked yet. Enter an invitation code below to begin.';

  wardCard.appendChild(wardHeader);
  wardCard.appendChild(wardValue);
  wardCard.appendChild(wardDesc);
  grid.appendChild(wardCard);

  // Metric 2: Pending Actions
  const pendingCard = document.createElement('div');
  pendingCard.className = 'gd-metric-card';

  const pendingHeader = document.createElement('div');
  pendingHeader.className = 'gd-metric-header';
  const pendingLabel = document.createElement('span');
  pendingLabel.className = 'gd-metric-label';
  pendingLabel.textContent = 'Pending Actions';
  const pendingBadge = document.createElement('span');
  pendingBadge.className = 'gd-metric-badge';
  pendingBadge.textContent = props.pendingCount > 0 ? 'Action Required' : 'All Clear';
  pendingHeader.appendChild(pendingLabel);
  pendingHeader.appendChild(pendingBadge);

  const pendingValue = document.createElement('span');
  pendingValue.className = 'gd-metric-value';
  pendingValue.textContent = String(props.pendingCount);

  const pendingDesc = document.createElement('span');
  pendingDesc.className = 'gd-metric-desc';
  pendingDesc.textContent =
    props.pendingCount > 0
      ? 'Requests waiting for your review and approval.'
      : 'No actions currently waiting for approval.';

  pendingCard.appendChild(pendingHeader);
  pendingCard.appendChild(pendingValue);
  pendingCard.appendChild(pendingDesc);
  grid.appendChild(pendingCard);

  // Metric 3: Portal Status
  const statusCard = document.createElement('div');
  statusCard.className = 'gd-metric-card';

  const statusHeader = document.createElement('div');
  statusHeader.className = 'gd-metric-header';
  const statusLabel = document.createElement('span');
  statusLabel.className = 'gd-metric-label';
  statusLabel.textContent = 'Portal Status';
  const statusBadge = document.createElement('span');
  statusBadge.className = 'gd-metric-badge';
  statusBadge.textContent = props.profile?.isAuthenticated ? 'Connected' : 'Standalone';
  statusHeader.appendChild(statusLabel);
  statusHeader.appendChild(statusBadge);

  const statusValue = document.createElement('span');
  statusValue.className = 'gd-metric-value';
  statusValue.textContent = props.profile?.isAuthenticated ? 'Active' : 'Shell Mode';

  const statusDesc = document.createElement('span');
  statusDesc.className = 'gd-metric-desc';
  statusDesc.textContent = props.profile?.isAuthenticated
    ? 'Active and protecting your assigned contacts.'
    : 'Running in preview mode. Connect a contact to get started.';

  statusCard.appendChild(statusHeader);
  statusCard.appendChild(statusValue);
  statusCard.appendChild(statusDesc);
  grid.appendChild(statusCard);

  section.appendChild(grid);

  // =========================================================================
  // ACTION ITEMS / NOTIFICATIONS (Restrained, Quiet Assurance)
  // =========================================================================
  if (props.pendingCount > 0) {
    const notifItem = document.createElement('div');
    notifItem.className = 'gd-notification-item gd-notif-warning';

    const notifIcn = document.createElement('span');
    notifIcn.className = 'gd-notif-icon';
    notifIcn.setAttribute('aria-hidden', 'true');
    notifIcn.appendChild(createIcon('clock'));

    const notifContent = document.createElement('div');
    notifContent.className = 'gd-notif-content';

    const notifMsg = document.createElement('p');
    notifMsg.className = 'gd-notif-text';

    const strong = document.createElement('strong');
    strong.textContent = 'Action Required: ';
    notifMsg.appendChild(strong);

    const txt = document.createElement('span');
    txt.textContent = `You have ${props.pendingCount} pending approval request${
      props.pendingCount > 1 ? 's' : ''
    } awaiting your evaluation.`;
    notifMsg.appendChild(txt);

    notifContent.appendChild(notifMsg);
    notifItem.appendChild(notifIcn);
    notifItem.appendChild(notifContent);

    if (props.onViewPending) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gd-btn-notif-action';
      btn.textContent = 'Review Pending →';
      btn.addEventListener('click', () => {
        props.onViewPending?.();
      });
      notifItem.appendChild(btn);
    }

    section.appendChild(notifItem);
  } else if (props.profile?.assignedWardId && !props.isBackendUnavailable) {
    const notifItem = document.createElement('div');
    notifItem.className = 'gd-notification-item gd-notif-success';

    const notifIcn = document.createElement('span');
    notifIcn.className = 'gd-notif-icon';
    notifIcn.setAttribute('aria-hidden', 'true');
    notifIcn.appendChild(createIcon('check-circle-2'));

    const notifContent = document.createElement('div');
    notifContent.className = 'gd-notif-content';

    const notifMsg = document.createElement('p');
    notifMsg.className = 'gd-notif-text';
    notifMsg.textContent = 'All Systems Normal: No unresolved safety items or pending approvals requiring attention.';

    notifContent.appendChild(notifMsg);
    notifItem.appendChild(notifIcn);
    notifItem.appendChild(notifContent);
    section.appendChild(notifItem);
  }

  // =========================================================================
  // SECTION D: PENDING APPROVAL REQUESTS
  // =========================================================================
  const pendingSection = document.createElement('div');
  pendingSection.className = 'gd-card gd-overview-pending-section';
  pendingSection.id = 'gd-overview-pending-section';

  const pendingSecHeader = document.createElement('div');
  pendingSecHeader.className = 'gd-overview-pending-header';

  const pendingSecTitle = document.createElement('h2');
  pendingSecTitle.className = 'gd-section-title';
  pendingSecTitle.textContent = 'Pending approval requests';

  const pendingSecSub = document.createElement('p');
  pendingSecSub.className = 'gd-section-subtitle';
  pendingSecSub.textContent = 'Requests waiting for your review and approval.';

  pendingSecHeader.appendChild(pendingSecTitle);
  pendingSecHeader.appendChild(pendingSecSub);
  pendingSection.appendChild(pendingSecHeader);

  const pendingList = props.pendingRequests ?? [];

  if (props.pendingStatus === 'loading') {
    // Skeleton loader
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
    pendingSection.appendChild(skeletonWrap);
  } else if ((props.pendingStatus === 'error' || props.isBackendUnavailable) && pendingList.length === 0) {
    // Offline / error state
    const errBox = document.createElement('div');
    errBox.className = 'gd-error-banner';
    errBox.setAttribute('role', 'alert');

    const errIcon = document.createElement('span');
    errIcon.className = 'gd-error-banner-icon';
    errIcon.setAttribute('aria-hidden', 'true');
    errIcon.appendChild(createIcon('alert-circle'));

    const errText = document.createElement('span');
    errText.className = 'gd-error-banner-text';
    errText.textContent = props.errorMessage || 'Unable to retrieve approval requests. Check your connection and retry.';

    const errContent = document.createElement('div');
    errContent.className = 'gd-error-content';
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
    pendingSection.appendChild(errBox);
  } else if (pendingList.length > 0) {
    // Actionable Pending Items List (Top 3 on Overview)
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'gd-overview-pending-list';

    for (const req of pendingList.slice(0, 3)) {
      const item = document.createElement('div');
      item.className = 'gd-overview-pending-item';

      const left = document.createElement('div');
      left.className = 'gd-overview-pending-left';

      const topRow = document.createElement('div');
      topRow.className = 'gd-overview-pending-top-row';

      const desc = document.createElement('span');
      desc.className = 'gd-overview-pending-desc';
      desc.textContent = req.actionDescription;

      const riskBadge = document.createElement('span');
      const riskClass = (req.riskLevel || RiskLevel.HIGH).toLowerCase();
      riskBadge.className = `gd-risk-badge gd-risk-${riskClass}`;
      riskBadge.textContent = req.riskLevel || 'HIGH';

      topRow.appendChild(desc);
      topRow.appendChild(riskBadge);

      const metaRow = document.createElement('div');
      metaRow.className = 'gd-overview-pending-meta';
      const host = req.hostname || 'Browser Action';
      const reqTime = req.createdAt || (req as any).timestamp;
      const timeStr = reqTime
        ? new Date(reqTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Just now';
      metaRow.textContent = `${host} • Requested ${timeStr}`;

      left.appendChild(topRow);
      left.appendChild(metaRow);

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'gd-btn-overview-review';
      actionBtn.setAttribute('aria-label', `Review and evaluate ${req.actionDescription}`);
      actionBtn.textContent = 'Review & Decide →';
      actionBtn.addEventListener('click', () => {
        if (props.onSelectPending) {
          props.onSelectPending(req.id);
        } else if (props.onViewPending) {
          props.onViewPending();
        }
      });

      item.appendChild(left);
      item.appendChild(actionBtn);
      itemsContainer.appendChild(item);
    }

    pendingSection.appendChild(itemsContainer);

    if (pendingList.length > 3 && props.onViewPending) {
      const viewAllBtn = document.createElement('button');
      viewAllBtn.type = 'button';
      viewAllBtn.className = 'gd-btn-view-all-history';
      viewAllBtn.textContent = `View All ${pendingList.length} Pending Approvals →`;
      viewAllBtn.addEventListener('click', () => {
        props.onViewPending?.();
      });
      pendingSection.appendChild(viewAllBtn);
    }
  } else {
    // Clean Empty State for Pending Requests
    const emptyBox = document.createElement('div');
    emptyBox.className = 'gd-overview-empty-pending';

    const empIcon = document.createElement('div');
    empIcon.className = 'gd-placeholder-icon';
    empIcon.setAttribute('aria-hidden', 'true');
    empIcon.appendChild(createIcon('shield-check', 'gd-icon-empty-shield'));

    const empTitle = document.createElement('h3');
    empTitle.className = 'gd-placeholder-title';
    empTitle.textContent = 'Review Queue All Clear';

    const empText = document.createElement('p');
    empText.className = 'gd-placeholder-text';
    empText.textContent =
      'No actions are currently waiting for your review. When a request needs approval, it will appear here.';

    emptyBox.appendChild(empIcon);
    emptyBox.appendChild(empTitle);
    emptyBox.appendChild(empText);
    pendingSection.appendChild(emptyBox);
  }

  // Operational section: Pending Approvals (will be mounted in primary column)
  let wardOversightSection: HTMLElement;

  // =========================================================================
  // SECTION E: TRUSTED CONTACT / WARD CONNECTION
  // =========================================================================
  if (!props.profile?.assignedWardId) {
    const setupCard = document.createElement('div');
    setupCard.className = 'gd-card gd-setup-card';
    setupCard.id = 'gd-setup-card';

    const setupHeader = document.createElement('div');
    setupHeader.className = 'gd-setup-header';

    const setupTitle = document.createElement('h2');
    setupTitle.className = 'gd-section-title gd-setup-title';
    setupTitle.textContent = 'Connect a ward';

    const setupSubtitle = document.createElement('p');
    setupSubtitle.className = 'gd-setup-subtitle';
    setupSubtitle.textContent = 'Link a trusted contact using a secure invitation code.';

    setupHeader.appendChild(setupTitle);
    setupHeader.appendChild(setupSubtitle);
    setupCard.appendChild(setupHeader);

    // 3 Concise Steps
    const stepsList = document.createElement('ol');
    stepsList.className = 'gd-setup-steps';

    const step1 = document.createElement('li');
    step1.className = 'gd-setup-step';
    step1.innerHTML =
      '<strong>Step 1:</strong> Your contact generates an invitation code (e.g. <code>GR-INV-A1B2-C3D4</code>) in their Guardrail extension.';

    const step2 = document.createElement('li');
    step2.className = 'gd-setup-step';
    step2.innerHTML =
      '<strong>Step 2:</strong> They share the code with you via message, email, or in person.';

    const step3 = document.createElement('li');
    step3.className = 'gd-setup-step';
    step3.innerHTML =
      '<strong>Step 3:</strong> Enter the code below and click <strong>Connect Ward</strong> to link their account.';

    stepsList.appendChild(step1);
    stepsList.appendChild(step2);
    stepsList.appendChild(step3);
    setupCard.appendChild(stepsList);

    // Connection Form
    const form = document.createElement('form');
    form.className = 'gd-setup-form';
    form.noValidate = true;

    const inputGroup = document.createElement('div');
    inputGroup.className = 'gd-setup-input-group';

    const label = document.createElement('label');
    label.className = 'gd-setup-label';
    label.htmlFor = 'gd-invitation-code-input';
    label.textContent = 'Invitation Code';

    const inputWrap = document.createElement('div');
    inputWrap.className = 'gd-setup-input-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'gd-invitation-code-input';
    input.className = 'gd-setup-input gd-mono';
    input.placeholder = 'GR-INV-XXXX-YYYY';
    input.maxLength = 32;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-describedby', 'gd-invitation-feedback');

    const connectBtn = document.createElement('button');
    connectBtn.type = 'submit';
    connectBtn.id = 'gd-btn-connect-invitation';
    connectBtn.className = 'gd-btn-connect';
    connectBtn.textContent = 'Connect Ward';

    inputWrap.appendChild(input);
    inputWrap.appendChild(connectBtn);
    inputGroup.appendChild(label);
    inputGroup.appendChild(inputWrap);
    form.appendChild(inputGroup);

    // Feedback container
    const feedback = document.createElement('div');
    feedback.id = 'gd-invitation-feedback';
    feedback.className = 'gd-setup-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    form.appendChild(feedback);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawCode = input.value.trim().toUpperCase();
      feedback.textContent = '';
      feedback.className = 'gd-setup-feedback';

      if (!rawCode) {
        feedback.className = 'gd-setup-feedback error';
        feedback.textContent = 'Please enter an invitation code.';
        input.focus();
        return;
      }

      // Format validation: GR-INV-XXXX-YYYY or INV-...
      const codeRegex = /^(?:GR-INV-[A-Z0-9]{4}-[A-Z0-9]{4}|INV-[A-Z0-9]+)$/;
      if (!codeRegex.test(rawCode)) {
        feedback.className = 'gd-setup-feedback error';
        feedback.textContent =
          'Invalid invitation code format. Expected format: GR-INV-XXXX-YYYY (e.g., GR-INV-A1B2-C3D4).';
        input.focus();
        return;
      }

      if (!props.onConnectInvitation) {
        feedback.className = 'gd-setup-feedback note';
        feedback.textContent =
          'Dashboard is running in standalone mode without an active API client. Connect a live backend to accept invitations.';
        return;
      }

      connectBtn.disabled = true;
      input.disabled = true;
      connectBtn.textContent = 'Connecting...';

      try {
        const result = await props.onConnectInvitation(rawCode);
        if (result.success) {
          feedback.className = 'gd-setup-feedback success';
          feedback.textContent = `Successfully connected to ward ${result.wardId || 'assigned'}! Pending approval requests will now appear in your review queue.`;
          input.value = '';
        } else {
          feedback.className = 'gd-setup-feedback error';
          feedback.textContent =
            result.error ||
            'Failed to connect. The invitation code may be invalid, expired, or already accepted.';
          connectBtn.disabled = false;
          input.disabled = false;
          connectBtn.textContent = 'Connect Ward';
        }
      } catch (err: unknown) {
        feedback.className = 'gd-setup-feedback error';
        feedback.textContent =
          err instanceof Error ? err.message : 'An unexpected error occurred while connecting.';
        connectBtn.disabled = false;
        input.disabled = false;
        connectBtn.textContent = 'Connect Ward';
      }
    });

    setupCard.appendChild(form);
    wardOversightSection = setupCard;
  } else {
    // Linked State: Active Ward Association Card
    const wardCard = document.createElement('div');
    wardCard.className = 'gd-card gd-active-ward-card';
    wardCard.id = 'gd-active-ward-card';

    const wardTitle = document.createElement('h2');
    wardTitle.className = 'gd-section-title';
    wardTitle.textContent = 'Active Ward Association & Authorized Oversight';

    const wardGrid = document.createElement('div');
    wardGrid.className = 'gd-ward-meta-grid';

    const item1 = document.createElement('div');
    item1.className = 'gd-ward-meta-item';
    const label1 = document.createElement('span');
    label1.className = 'gd-ward-meta-label';
    label1.textContent = 'Designated Ward';
    const val1 = document.createElement('span');
    val1.className = 'gd-ward-meta-value gd-mono';
    val1.textContent = props.profile.assignedWardId;
    item1.appendChild(label1);
    item1.appendChild(val1);

    const item2 = document.createElement('div');
    item2.className = 'gd-ward-meta-item';
    const label2 = document.createElement('span');
    label2.className = 'gd-ward-meta-label';
    label2.textContent = 'Relationship';
    const val2 = document.createElement('span');
    val2.className = 'gd-ward-meta-value';
    val2.textContent = props.profile.relationshipLabel ?? 'Designated Trusted Contact';
    item2.appendChild(label2);
    item2.appendChild(val2);

    const item3 = document.createElement('div');
    item3.className = 'gd-ward-meta-item';
    const label3 = document.createElement('span');
    label3.className = 'gd-ward-meta-label';
    label3.textContent = 'Separation of Duties';
    const val3 = document.createElement('span');
    val3.className = 'gd-ward-meta-badge';
    val3.textContent = 'Enforced';
    item3.appendChild(label3);
    item3.appendChild(val3);

    const item4 = document.createElement('div');
    item4.className = 'gd-ward-meta-item';
    const label4 = document.createElement('span');
    label4.className = 'gd-ward-meta-label';
    label4.textContent = 'Tenant Scoping';
    const val4 = document.createElement('span');
    val4.className = 'gd-ward-meta-badge';
    val4.textContent = 'Isolated';
    item4.appendChild(label4);
    item4.appendChild(val4);

    wardGrid.appendChild(item1);
    wardGrid.appendChild(item2);
    wardGrid.appendChild(item3);
    wardGrid.appendChild(item4);

    const dutyNotice = document.createElement('p');
    dutyNotice.className = 'gd-ward-duty-notice';
    dutyNotice.textContent =
      `Separation of Duties Enforced: You are authorized to review and evaluate intercepted actions for ward ${props.profile.assignedWardId}. Approval decisions register consent on the backend; the user in Staging Mode retains ultimate agency to execute or cancel the action. Multi-tenant isolation guarantees no access to data belonging to other users.`;

    wardCard.appendChild(wardTitle);
    wardCard.appendChild(wardGrid);
    wardCard.appendChild(dutyNotice);

    // Ward Action Buttons (Disconnect & Settings Link)
    const wardActions = document.createElement('div');
    wardActions.className = 'gd-ward-actions-row';

    if (props.onDisconnectWard) {
      const disconnectBtn = document.createElement('button');
      disconnectBtn.type = 'button';
      disconnectBtn.className = 'gd-btn-revoke';
      disconnectBtn.id = 'gd-btn-disconnect-ward';
      disconnectBtn.textContent = 'Disconnect Ward';

      const confirmBox = document.createElement('div');
      confirmBox.className = 'gd-relationship-confirm-box';
      confirmBox.style.display = 'none';

      const confirmMsg = document.createElement('p');
      confirmMsg.className = 'gd-confirm-warning';
      confirmMsg.textContent =
        `Disconnecting from ${props.profile.assignedWardId} unlinks your review portal. You will stop receiving pending approval requests.`;

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'gd-btn-revoke-confirm';
      confirmBtn.textContent = 'Confirm Disconnect';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'gd-btn-cancel';
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

      wardActions.appendChild(disconnectBtn);
      wardActions.appendChild(confirmBox);
    }

    if (props.onViewSettings) {
      const manageBtn = document.createElement('button');
      manageBtn.type = 'button';
      manageBtn.className = 'gd-btn-manage-relationships';
      manageBtn.textContent = 'Manage Trusted Contacts & Invitations in Settings →';
      manageBtn.addEventListener('click', () => {
        props.onViewSettings?.();
      });
      wardActions.appendChild(manageBtn);
    }

    wardCard.appendChild(wardActions);
    wardOversightSection = wardCard;
  }

  // =========================================================================
  // SECTION F: DECOUPLED EXECUTION ARCHITECTURE (Compact Note)
  // =========================================================================
  const callout = document.createElement('div');
  callout.className = 'gd-callout';
  callout.setAttribute('role', 'note');

  const calloutIcon = document.createElement('div');
  calloutIcon.className = 'gd-callout-icon';
  calloutIcon.setAttribute('aria-hidden', 'true');
  calloutIcon.appendChild(createIcon('info', 'gd-icon-callout'));

  const calloutContent = document.createElement('div');
  calloutContent.className = 'gd-callout-content';

  const calloutTitle = document.createElement('h2');
  calloutTitle.className = 'gd-callout-title';
  calloutTitle.textContent = 'Safe Approvals Guarantee';

  const calloutText = document.createElement('p');
  calloutText.className = 'gd-callout-text';
  calloutText.textContent =
    'Guardrail strictly decouples approval decisions from browser action execution. When you approve an action, you give permission, but your contact always decides whether to proceed or cancel in their browser.';

  calloutContent.appendChild(calloutTitle);
  calloutContent.appendChild(calloutText);
  callout.appendChild(calloutIcon);
  callout.appendChild(calloutContent);

  // =========================================================================
  // SECTION G: RECENT ACTIVITY
  // =========================================================================
  const activitySection = document.createElement('div');
  activitySection.className = 'gd-card gd-recent-activity-card';

  const activityHeader = document.createElement('div');
  activityHeader.className = 'gd-recent-activity-header';

  const activityTitle = document.createElement('h2');
  activityTitle.className = 'gd-section-title';
  activityTitle.textContent = 'Recent activity';

  const activitySubtitle = document.createElement('p');
  activitySubtitle.className = 'gd-section-subtitle';
  activitySubtitle.textContent = 'Past approvals and decision records across your connected contacts.';

  activityHeader.appendChild(activityTitle);
  activityHeader.appendChild(activitySubtitle);
  activitySection.appendChild(activityHeader);

  const recentList = props.recentActivity ?? [];

  if (recentList.length === 0) {
    // Intentional Empty Placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'gd-placeholder';

    const icon = document.createElement('div');
    icon.className = 'gd-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.appendChild(createIcon('history', 'gd-icon-empty-history'));

    const pTitle = document.createElement('h3');
    pTitle.className = 'gd-placeholder-title';
    pTitle.textContent = 'No Recent Activity Recorded';

    const pText = document.createElement('p');
    pText.className = 'gd-placeholder-text';
    pText.textContent =
      'Past approval decisions will appear here as you review them.';

    placeholder.appendChild(icon);
    placeholder.appendChild(pTitle);
    placeholder.appendChild(pText);

    activitySection.appendChild(placeholder);
  } else {
    // Authoritative Recent Decisions List (Top 5)
    const listContainer = document.createElement('div');
    listContainer.className = 'gd-recent-activity-list';

    for (const req of recentList.slice(0, 5)) {
      const item = document.createElement('div');
      item.className = 'gd-recent-activity-item';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', `View details for ${req.actionDescription}`);

      if (props.onViewHistory) {
        item.addEventListener('click', () => {
          props.onViewHistory?.();
        });
        item.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onViewHistory?.();
          }
        });
      }

      const itemLeft = document.createElement('div');
      itemLeft.className = 'gd-recent-activity-left';

      // Parse clean human-centric action title and category
      const rawDesc = req.actionDescription || 'Browsing action';
      const triggerMatch = rawDesc.match(/^(.*?trigger):\s*(.+)$/i);
      let actionTitle = rawDesc.trim();
      let categoryLabel = req.category || 'External navigation';

      if (triggerMatch) {
        actionTitle = triggerMatch[2].trim();
        const rawPrefix = triggerMatch[1].replace(/trigger/i, '').trim();
        if (rawPrefix) {
          categoryLabel = rawPrefix.charAt(0).toUpperCase() + rawPrefix.slice(1).toLowerCase();
        }
      }

      // Ward Display Name
      let wardDisplayName = '';
      if (req.requesterId && typeof req.requesterId === 'string') {
        const cleanWard = req.requesterId.replace(/^usr_/, '').trim();
        if (cleanWard) {
          wardDisplayName = cleanWard.charAt(0).toUpperCase() + cleanWard.slice(1);
        }
      }

      // 1. Eyebrow Row: Category · Requester
      const eyebrow = document.createElement('div');
      eyebrow.className = 'gd-recent-activity-eyebrow';

      const catSpan = document.createElement('span');
      catSpan.className = 'gd-activity-cat';
      catSpan.textContent = categoryLabel;
      eyebrow.appendChild(catSpan);

      if (wardDisplayName) {
        const eyeSep = document.createElement('span');
        eyeSep.className = 'gd-activity-sep';
        eyeSep.textContent = '·';
        eyeSep.setAttribute('aria-hidden', 'true');
        eyebrow.appendChild(eyeSep);

        const wardSpan = document.createElement('span');
        wardSpan.className = 'gd-activity-ward';
        wardSpan.textContent = wardDisplayName;
        eyebrow.appendChild(wardSpan);
      }
      itemLeft.appendChild(eyebrow);

      // 2. Primary Action Title (Display Typography)
      const desc = document.createElement('div');
      desc.className = 'gd-recent-activity-desc gd-recent-activity-title';
      desc.textContent = actionTitle;
      itemLeft.appendChild(desc);

      // 3. Metadata Row: Hostname · Resolved Timestamp
      const meta = document.createElement('div');
      meta.className = 'gd-recent-activity-meta';

      let safeHost = req.hostname;
      if (!safeHost && req.origin) {
        try {
          safeHost = new URL(req.origin).hostname;
        } catch {
          safeHost = req.origin;
        }
      }
      if (!safeHost) safeHost = 'gaiaflix.xyz';

      const hostSpan = document.createElement('span');
      hostSpan.className = 'gd-recent-activity-host';
      hostSpan.textContent = safeHost;
      meta.appendChild(hostSpan);

      const sep = document.createElement('span');
      sep.className = 'gd-activity-sep';
      sep.textContent = '·';
      sep.setAttribute('aria-hidden', 'true');
      meta.appendChild(sep);

      const timeSource = req.resolvedAt || (req.decision && req.decision.decidedAt) || req.createdAt;
      const timeStr = timeSource
        ? new Date(timeSource).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Resolved';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'gd-recent-activity-time';
      timeSpan.textContent = timeStr;
      meta.appendChild(timeSpan);

      itemLeft.appendChild(meta);

      // 4. Status Badge (Right aligned)
      const statusClass = (req.status || ApprovalStatus.APPROVED).toLowerCase();
      const statusPill = document.createElement('span');
      statusPill.className = `gd-detail-status-pill gd-activity-status-pill ${statusClass}`;
      statusPill.setAttribute('role', 'status');
      statusPill.textContent = req.status || 'APPROVED';

      item.appendChild(itemLeft);
      item.appendChild(statusPill);
      listContainer.appendChild(item);
    }

    activitySection.appendChild(listContainer);

    if (props.onViewHistory) {
      const viewAllBtn = document.createElement('button');
      viewAllBtn.type = 'button';
      viewAllBtn.className = 'gd-btn-view-all-history';

      const textSpan = document.createElement('span');
      textSpan.textContent = 'View Full Decision History & Audit Log';

      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'gd-arrow';
      arrowSpan.setAttribute('aria-hidden', 'true');
      arrowSpan.textContent = '→';

      viewAllBtn.appendChild(textSpan);
      viewAllBtn.appendChild(arrowSpan);

      viewAllBtn.addEventListener('click', () => {
        props.onViewHistory?.();
      });
      activitySection.appendChild(viewAllBtn);
    }
  }

  // =========================================================================
  // TWO-COLUMN ASYMMETRIC GRID (7/12 Primary Column, 5/12 Secondary Column)
  // =========================================================================
  const mainGrid = document.createElement('div');
  mainGrid.className = 'gd-overview-main-grid';

  // Primary operational column (7/12): Pending Approvals + Recent Activity
  const colPrimary = document.createElement('div');
  colPrimary.className = 'gd-overview-col-primary';
  colPrimary.appendChild(pendingSection);
  colPrimary.appendChild(activitySection);

  // Secondary supporting column (5/12): Connect a Ward + Decoupled Architecture
  const colSecondary = document.createElement('div');
  colSecondary.className = 'gd-overview-col-secondary';
  colSecondary.appendChild(wardOversightSection);
  colSecondary.appendChild(callout);

  mainGrid.appendChild(colPrimary);
  mainGrid.appendChild(colSecondary);
  section.appendChild(mainGrid);

  return section;
}
