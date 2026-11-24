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
import { showConnectWardModal } from './connect-modal.js';

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
  onDisconnectWard?: (wardId?: string) => void;
  onFilterWardPending?: (wardId: string) => void;
  onRefresh?: () => void;
  onOpenAuth?: () => void;
  connectedWards?: readonly { id: string; name: string; email?: string; relationshipLabel?: string }[];
}

/**
 * Formats a ward identifier or raw username into a polished, human-readable display name.
 */
export function formatWardDisplayName(name?: string, id?: string): string {
  if (name && name.trim()) {
    const trimmed = name.trim();
    if (trimmed.toLowerCase().includes('deepanshukhatri')) {
      return 'Deepanshu Khatri';
    }
    return trimmed;
  }
  if (!id) return 'Ward';
  if (id.startsWith('usr_')) {
    const raw = id.slice(4);
    if (raw.toLowerCase().includes('deepanshukhatri')) {
      return 'Deepanshu Khatri';
    }
    const alphaOnly = raw.replace(/[0-9]+$/, '');
    if (alphaOnly.length >= 3) {
      return alphaOnly
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/[._-]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
        .join(' ');
    }
    return raw;
  }
  return id;
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
    protBadge.textContent = 'Connected · Real-Time';
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

    if (props.onOpenAuth) {
      const signInBtn = document.createElement('button');
      signInBtn.type = 'button';
      signInBtn.className = 'gd-btn-signin-action';
      signInBtn.textContent = 'Sign In to Connect';
      signInBtn.addEventListener('click', () => {
        props.onOpenAuth?.();
      });
      protActions.appendChild(signInBtn);
    }
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
  const wardsList = (props.connectedWards && props.connectedWards.length > 0)
    ? props.connectedWards
    : (props.profile?.assignedWardId
        ? [{
            id: props.profile.assignedWardId,
            name: formatWardDisplayName(props.profile.assignedWardName, props.profile.assignedWardId),
            email: props.profile.assignedWardEmail,
            relationshipLabel: props.profile.relationshipLabel,
          }]
        : []);
  const wardCount = wardsList.length;

  const wardCard = document.createElement('div');
  wardCard.className = 'gd-metric-card';

  const wardHeader = document.createElement('div');
  wardHeader.className = 'gd-metric-header';

  const wardIndex = document.createElement('span');
  wardIndex.className = 'gd-metric-index';
  wardIndex.textContent = '01 /';

  const wardLabel = document.createElement('span');
  wardLabel.className = 'gd-metric-label';
  wardLabel.textContent = 'Wards';

  const wardBadge = document.createElement('span');
  wardBadge.className = 'gd-metric-badge';
  wardBadge.textContent = wardCount === 0 ? 'Unlinked' : (wardCount > 1 ? `${wardCount} Linked` : 'Linked');

  wardHeader.appendChild(wardIndex);
  wardHeader.appendChild(wardLabel);
  wardHeader.appendChild(wardBadge);

  const wardValueRow = document.createElement('div');
  wardValueRow.className = 'gd-metric-value-row';

  const wardValue = document.createElement('span');
  wardValue.className = 'gd-metric-value';
  wardValue.textContent = String(wardCount);

  const wardUnit = document.createElement('span');
  wardUnit.className = 'gd-metric-unit';
  wardUnit.textContent = 'Connected';

  wardValueRow.appendChild(wardValue);
  wardValueRow.appendChild(wardUnit);

  const wardDesc = document.createElement('span');
  wardDesc.className = 'gd-metric-desc';
  if (wardCount === 0) {
    wardDesc.textContent = 'Awaiting ward invitation';
  } else if (wardCount === 1) {
    wardDesc.textContent = `Reviewer for ${wardsList[0].name}`;
  } else {
    wardDesc.textContent = `Reviewer for ${wardsList.map(w => w.name).join(', ')}`;
  }

  wardCard.appendChild(wardHeader);
  wardCard.appendChild(wardValueRow);
  wardCard.appendChild(wardDesc);
  grid.appendChild(wardCard);

  // Metric 2: Pending Actions
  const pendingCard = document.createElement('div');
  pendingCard.className = 'gd-metric-card';

  const pendingHeader = document.createElement('div');
  pendingHeader.className = 'gd-metric-header';

  const pendingIndex = document.createElement('span');
  pendingIndex.className = 'gd-metric-index';
  pendingIndex.textContent = '02 /';

  const pendingLabel = document.createElement('span');
  pendingLabel.className = 'gd-metric-label';
  pendingLabel.textContent = 'Approvals';

  const pendingBadge = document.createElement('span');
  pendingBadge.className = 'gd-metric-badge';
  pendingBadge.textContent = props.pendingCount > 0 ? 'Action Required' : 'All Clear';

  pendingHeader.appendChild(pendingIndex);
  pendingHeader.appendChild(pendingLabel);
  pendingHeader.appendChild(pendingBadge);

  const pendingValueRow = document.createElement('div');
  pendingValueRow.className = 'gd-metric-value-row';

  const pendingValue = document.createElement('span');
  pendingValue.className = 'gd-metric-value';
  pendingValue.textContent = String(props.pendingCount);

  const pendingUnit = document.createElement('span');
  pendingUnit.className = 'gd-metric-unit';
  pendingUnit.textContent = props.pendingCount === 1 ? 'Needs Review' : props.pendingCount > 0 ? 'Needs Review' : 'Needs Review';

  pendingValueRow.appendChild(pendingValue);
  pendingValueRow.appendChild(pendingUnit);

  const pendingDesc = document.createElement('span');
  pendingDesc.className = 'gd-metric-desc';
  pendingDesc.textContent =
    props.pendingCount > 0
      ? 'Requests waiting for your review'
      : 'Queue is all clear';

  pendingCard.appendChild(pendingHeader);
  pendingCard.appendChild(pendingValueRow);
  pendingCard.appendChild(pendingDesc);
  grid.appendChild(pendingCard);

  // Metric 3: Enforcement / Security Posture
  const statusCard = document.createElement('div');
  statusCard.className = 'gd-metric-card';

  const statusHeader = document.createElement('div');
  statusHeader.className = 'gd-metric-header';

  const statusIndex = document.createElement('span');
  statusIndex.className = 'gd-metric-index';
  statusIndex.textContent = '03 /';

  const statusLabel = document.createElement('span');
  statusLabel.className = 'gd-metric-label';
  statusLabel.textContent = 'Enforcement';

  const statusBadge = document.createElement('span');
  statusBadge.className = 'gd-metric-badge';
  statusBadge.textContent = props.profile?.isAuthenticated ? 'Connected' : 'Standalone';

  statusHeader.appendChild(statusIndex);
  statusHeader.appendChild(statusLabel);
  statusHeader.appendChild(statusBadge);

  const statusValueRow = document.createElement('div');
  statusValueRow.className = 'gd-metric-value-row';

  const statusValue = document.createElement('span');
  statusValue.className = 'gd-metric-value';
  statusValue.textContent = props.profile?.isAuthenticated ? 'Active' : 'Standby';

  statusValueRow.appendChild(statusValue);

  const statusDesc = document.createElement('span');
  statusDesc.className = 'gd-metric-desc';
  statusDesc.textContent = props.profile?.isAuthenticated
    ? 'Consent-only execution active'
    : 'Running in preview mode';

  statusCard.appendChild(statusHeader);
  statusCard.appendChild(statusValueRow);
  statusCard.appendChild(statusDesc);
  grid.appendChild(statusCard);

  section.appendChild(grid);

  // =========================================================================
  // ACTION ITEMS / NOTIFICATIONS (Restrained, Quiet Assurance)
  // =========================================================================
  if (props.pendingCount > 0) {
    const notifItem = document.createElement('div');
    notifItem.className = 'gd-notification-item gd-notif-warning';

    const notifContent = document.createElement('div');
    notifContent.className = 'gd-notif-content';

    const notifTitle = document.createElement('h3');
    notifTitle.className = 'gd-notif-title';
    notifTitle.textContent = 'Action Required';

    const notifMsg = document.createElement('p');
    notifMsg.className = 'gd-notif-text';
    notifMsg.textContent = `You have ${props.pendingCount} pending approval request${
      props.pendingCount > 1 ? 's' : ''
    } awaiting your evaluation.`;

    notifContent.appendChild(notifTitle);
    notifContent.appendChild(notifMsg);
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

    const notifContent = document.createElement('div');
    notifContent.className = 'gd-notif-content';

    const notifTitle = document.createElement('h3');
    notifTitle.className = 'gd-notif-title';
    notifTitle.textContent = 'All Systems Normal';

    const notifMsg = document.createElement('p');
    notifMsg.className = 'gd-notif-text';
    notifMsg.textContent = 'No unresolved safety items or pending approvals requiring attention.';

    notifContent.appendChild(notifTitle);
    notifContent.appendChild(notifMsg);

    const notifStatus = document.createElement('div');
    notifStatus.className = 'gd-notif-status-label';
    notifStatus.textContent = 'Active Oversight';

    notifItem.appendChild(notifContent);
    notifItem.appendChild(notifStatus);
    section.appendChild(notifItem);
  }

  // =========================================================================
  // SECTION D: PENDING APPROVAL REQUESTS
  // =========================================================================
  const pendingSection = document.createElement('div');
  pendingSection.className = 'gd-card gd-overview-pending-section gd-scroll-reveal';
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
      riskBadge.className = `gd-risk-badge gd-risk-${riskClass} ${riskClass}`;
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

      const textSpan = document.createElement('span');
      textSpan.textContent = `View All ${pendingList.length} Pending Approvals`;

      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'gd-arrow';
      arrowSpan.setAttribute('aria-hidden', 'true');
      arrowSpan.textContent = '→';

      viewAllBtn.appendChild(textSpan);
      viewAllBtn.appendChild(arrowSpan);

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
  const activeWards = (props.connectedWards && props.connectedWards.length > 0)
    ? props.connectedWards
    : (props.profile?.assignedWardId
        ? [{
            id: props.profile.assignedWardId,
            name: formatWardDisplayName(props.profile.assignedWardName, props.profile.assignedWardId),
            email: props.profile.assignedWardEmail,
            relationshipLabel: props.profile.relationshipLabel,
          }]
        : []);

  if (activeWards.length === 0) {
    const setupCard = document.createElement('div');
    setupCard.className = 'gd-card gd-setup-card gd-scroll-reveal';
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

      showConnectWardModal({
        code: rawCode,
        onConnect: async (code) => {
          try {
            return await props.onConnectInvitation!(code);
          } catch (err: unknown) {
            return {
              success: false,
              error: err instanceof Error ? err.message : 'An unexpected error occurred while connecting.',
            };
          }
        },
        onSuccess: (wardId) => {
          feedback.className = 'gd-setup-feedback success';
          feedback.textContent = `Successfully connected to ward ${wardId}! Pending approval requests will now appear in your review queue.`;
          input.value = '';
        },
        onClose: () => {
          connectBtn.disabled = false;
          input.disabled = false;
          connectBtn.textContent = 'Connect Ward';
        },
      });
    });

    setupCard.appendChild(form);
    wardOversightSection = setupCard;
  } else if (activeWards.length === 1) {
    const singleWard = activeWards[0];
    // Linked State: Active Ward Oversight (Single Ward)
    const wardCard = document.createElement('div');
    wardCard.className = 'gd-active-ward-card gd-scroll-reveal';
    wardCard.id = 'gd-active-ward-card';

    const wardHero = document.createElement('div');
    wardHero.className = 'gd-ward-oversight-hero';

    const kicker = document.createElement('span');
    kicker.className = 'gd-ward-kicker';
    kicker.textContent = 'Active Ward Oversight';

    const wardName = singleWard.name;
    const heroTitle = document.createElement('h2');
    heroTitle.className = 'gd-ward-hero-name';
    setAnimatedHeading(heroTitle, wardName);

    // Typographic metadata line: Email · Relationship · ID
    const metaLine = document.createElement('p');
    metaLine.className = 'gd-ward-meta-line';

    const relLabel = singleWard.relationshipLabel ?? props.profile?.relationshipLabel ?? 'Designated Caretaker';
    const wardEmail = singleWard.email || props.profile?.assignedWardEmail;
    const wardId = singleWard.id;

    const parts: string[] = [];
    if (wardEmail) parts.push(wardEmail);
    parts.push(relLabel);
    parts.push(`ID: ${wardId}`);

    metaLine.textContent = parts.join('  ·  ');

    // Policy & Architectural guarantee note
    const dutyNotice = document.createElement('p');
    dutyNotice.className = 'gd-ward-guarantee-note';
    dutyNotice.textContent =
      `Separation of Duties enforced. Approval decisions register consent on the backend; the user in Staging Mode retains ultimate agency to execute or cancel actions. Multi-tenant isolation guarantees no access to data belonging to other users.`;

    wardHero.appendChild(kicker);
    wardHero.appendChild(heroTitle);
    wardHero.appendChild(metaLine);
    wardHero.appendChild(dutyNotice);

    // Typographic action links
    const actionLinks = document.createElement('div');
    actionLinks.className = 'gd-ward-action-links';

    if (props.onViewSettings) {
      const manageLink = document.createElement('button');
      manageLink.type = 'button';
      manageLink.className = 'gd-ward-text-link gd-link-manage';
      manageLink.id = 'gd-btn-manage-ward';
      manageLink.textContent = 'Manage in Settings →';
      manageLink.addEventListener('click', () => {
        props.onViewSettings?.();
      });
      actionLinks.appendChild(manageLink);
    }

    if (props.onConnectInvitation) {
      if (props.onViewSettings) {
        const sepConnect = document.createElement('span');
        sepConnect.className = 'gd-ward-link-sep';
        sepConnect.textContent = '·';
        sepConnect.setAttribute('aria-hidden', 'true');
        actionLinks.appendChild(sepConnect);
      }

      const addWardLink = document.createElement('button');
      addWardLink.type = 'button';
      addWardLink.className = 'gd-ward-text-link gd-link-add-ward';
      addWardLink.textContent = '+ Connect Another Ward';
      addWardLink.addEventListener('click', () => {
        showConnectWardModal({
          onConnect: async (code) => {
            return await props.onConnectInvitation!(code);
          },
        });
      });
      actionLinks.appendChild(addWardLink);
    }

    if (props.onDisconnectWard) {
      const sep = document.createElement('span');
      sep.className = 'gd-ward-link-sep';
      sep.textContent = '·';
      sep.setAttribute('aria-hidden', 'true');
      actionLinks.appendChild(sep);

      const disconnectLink = document.createElement('button');
      disconnectLink.type = 'button';
      disconnectLink.className = 'gd-ward-text-link gd-link-disconnect gd-btn-revoke';
      disconnectLink.id = 'gd-btn-disconnect-ward';
      disconnectLink.textContent = 'Disconnect Ward';

      const confirmSpan = document.createElement('span');
      confirmSpan.className = 'gd-ward-confirm-inline';
      confirmSpan.style.display = 'none';

      const confirmPrompt = document.createElement('span');
      confirmPrompt.className = 'gd-ward-confirm-prompt';
      confirmPrompt.textContent = `Disconnect from ${wardId}? `;

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'gd-ward-text-link gd-link-confirm';
      confirmBtn.textContent = 'Confirm';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'gd-ward-text-link gd-link-cancel';
      cancelBtn.textContent = 'Cancel';

      confirmBtn.addEventListener('click', () => {
        props.onDisconnectWard?.(wardId);
      });

      cancelBtn.addEventListener('click', () => {
        confirmSpan.style.display = 'none';
        disconnectLink.style.display = 'inline-flex';
      });

      disconnectLink.addEventListener('click', () => {
        disconnectLink.style.display = 'none';
        confirmSpan.style.display = 'inline-flex';
      });

      confirmSpan.appendChild(confirmPrompt);
      confirmSpan.appendChild(confirmBtn);
      const space = document.createElement('span');
      space.textContent = '  ';
      space.setAttribute('aria-hidden', 'true');
      confirmSpan.appendChild(space);
      confirmSpan.appendChild(cancelBtn);

      actionLinks.appendChild(disconnectLink);
      actionLinks.appendChild(confirmSpan);
    }

    wardHero.appendChild(actionLinks);
    wardCard.appendChild(wardHero);
    wardOversightSection = wardCard;
  } else {
    // Multi-Ward Oversight Grid
    const multiWardCard = document.createElement('div');
    multiWardCard.className = 'gd-active-ward-card gd-multi-ward-container gd-scroll-reveal';
    multiWardCard.id = 'gd-active-ward-card';

    const headerRow = document.createElement('div');
    headerRow.className = 'gd-multi-ward-header';

    const kicker = document.createElement('span');
    kicker.className = 'gd-ward-kicker';
    kicker.textContent = 'Active Ward Oversight';

    const titleEl = document.createElement('h2');
    titleEl.className = 'gd-ward-hero-name';
    setAnimatedHeading(titleEl, `${activeWards.length} Protected Wards`);

    const countBadge = document.createElement('span');
    countBadge.className = 'gd-multi-ward-badge';
    countBadge.textContent = `${activeWards.length} Active Wards Linked`;

    headerRow.appendChild(kicker);
    headerRow.appendChild(titleEl);
    headerRow.appendChild(countBadge);
    multiWardCard.appendChild(headerRow);

    const dutyNotice = document.createElement('p');
    dutyNotice.className = 'gd-ward-guarantee-note';
    dutyNotice.textContent =
      `Separation of Duties enforced across all connected wards. Approval decisions register consent on the backend; each ward in Staging Mode retains ultimate agency to execute or cancel actions. Multi-tenant isolation guarantees no access to data belonging to other users.`;
    multiWardCard.appendChild(dutyNotice);

    // List of active ward cards
    const wardsGrid = document.createElement('div');
    wardsGrid.className = 'gd-multi-ward-grid';

    for (const w of activeWards) {
      const singleCard = document.createElement('div');
      singleCard.className = 'gd-multi-ward-card';
      singleCard.setAttribute('data-ward-id', w.id);

      const avatar = document.createElement('div');
      avatar.className = 'gd-multi-ward-avatar';
      avatar.textContent = (w.name || 'W').charAt(0).toUpperCase();

      const details = document.createElement('div');
      details.className = 'gd-multi-ward-details';

      const nameRow = document.createElement('div');
      nameRow.className = 'gd-multi-ward-name-row';

      const nameEl = document.createElement('strong');
      nameEl.className = 'gd-multi-ward-name';
      nameEl.textContent = w.name;

      const activeBadge = document.createElement('span');
      activeBadge.className = 'gd-status-badge approved';
      activeBadge.textContent = 'ACTIVE';

      nameRow.appendChild(nameEl);
      nameRow.appendChild(activeBadge);

      const meta = document.createElement('p');
      meta.className = 'gd-multi-ward-meta';
      const emailStr = w.email ? `${w.email} · ` : '';
      meta.textContent = `${emailStr}${w.relationshipLabel || 'Designated Caretaker'} · ID: ${w.id}`;

      details.appendChild(nameRow);
      details.appendChild(meta);

      const cardActions = document.createElement('div');
      cardActions.className = 'gd-multi-ward-card-actions';

      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'gd-ward-text-link gd-link-filter-ward';
      filterBtn.textContent = 'Review Pending →';
      filterBtn.addEventListener('click', () => {
        if (props.onFilterWardPending) {
          props.onFilterWardPending(w.id);
        } else if (props.onViewPending) {
          props.onViewPending();
        }
      });
      cardActions.appendChild(filterBtn);

      if (props.onDisconnectWard) {
        const sep = document.createElement('span');
        sep.className = 'gd-ward-link-sep';
        sep.textContent = '·';
        sep.setAttribute('aria-hidden', 'true');
        cardActions.appendChild(sep);

        const disconnectBtn = document.createElement('button');
        disconnectBtn.type = 'button';
        disconnectBtn.className = 'gd-ward-text-link gd-link-disconnect gd-btn-revoke';
        disconnectBtn.textContent = 'Disconnect';

        const confirmSpan = document.createElement('span');
        confirmSpan.className = 'gd-ward-confirm-inline';
        confirmSpan.style.display = 'none';

        const promptText = document.createElement('span');
        promptText.textContent = `Disconnect ${w.name}? `;

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'gd-ward-text-link gd-link-confirm';
        confirmBtn.textContent = 'Yes';
        confirmBtn.addEventListener('click', () => {
          props.onDisconnectWard?.(w.id);
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'gd-ward-text-link gd-link-cancel';
        cancelBtn.textContent = 'No';
        cancelBtn.addEventListener('click', () => {
          confirmSpan.style.display = 'none';
          disconnectBtn.style.display = 'inline-flex';
        });

        confirmSpan.appendChild(promptText);
        confirmSpan.appendChild(confirmBtn);
        const sp = document.createElement('span');
        sp.textContent = ' ';
        confirmSpan.appendChild(sp);
        confirmSpan.appendChild(cancelBtn);

        disconnectBtn.addEventListener('click', () => {
          disconnectBtn.style.display = 'none';
          confirmSpan.style.display = 'inline-flex';
        });

        cardActions.appendChild(disconnectBtn);
        cardActions.appendChild(confirmSpan);
      }

      singleCard.appendChild(avatar);
      singleCard.appendChild(details);
      singleCard.appendChild(cardActions);
      wardsGrid.appendChild(singleCard);
    }

    multiWardCard.appendChild(wardsGrid);

    // Multi-ward footer action bar
    const footerBar = document.createElement('div');
    footerBar.className = 'gd-multi-ward-footer';

    if (props.onViewSettings) {
      const manageAllLink = document.createElement('button');
      manageAllLink.type = 'button';
      manageAllLink.className = 'gd-ward-text-link gd-link-manage';
      manageAllLink.id = 'gd-btn-manage-ward';
      manageAllLink.textContent = 'Manage in Settings →';
      manageAllLink.addEventListener('click', () => {
        props.onViewSettings?.();
      });
      footerBar.appendChild(manageAllLink);
    }

    if (props.onConnectInvitation) {
      if (props.onViewSettings) {
        const sep = document.createElement('span');
        sep.className = 'gd-ward-link-sep';
        sep.textContent = '·';
        sep.setAttribute('aria-hidden', 'true');
        footerBar.appendChild(sep);
      }

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'gd-ward-text-link gd-link-add-ward';
      addBtn.textContent = '+ Connect Another Ward';
      addBtn.addEventListener('click', () => {
        showConnectWardModal({
          onConnect: async (code) => {
            return await props.onConnectInvitation!(code);
          },
        });
      });
      footerBar.appendChild(addBtn);
    }

    multiWardCard.appendChild(footerBar);
    wardOversightSection = multiWardCard;
  }

  // =========================================================================
  // SECTION F: DECOUPLED EXECUTION ARCHITECTURE (Compact Note)
  // =========================================================================
  const callout = document.createElement('div');
  callout.className = 'gd-callout gd-scroll-reveal';
  callout.id = 'gd-overview-callout';

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
  activitySection.className = 'gd-card gd-recent-activity-card gd-scroll-reveal';
  activitySection.id = 'gd-overview-recent-activity';

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

      // Truncate excessively long action titles with an ellipsis so they fit gracefully without causing horizontal scroll
      const MAX_TITLE_LEN = 36;
      if (actionTitle.length > MAX_TITLE_LEN) {
        actionTitle = actionTitle.slice(0, MAX_TITLE_LEN).trim() + '...';
      }

      // Ward Display Name
      let wardDisplayName = '';
      if (req.requesterId && typeof req.requesterId === 'string') {
        const cleanWard = req.requesterId.replace(/^usr_/, '').trim();
        if (cleanWard) {
          wardDisplayName = cleanWard.charAt(0).toUpperCase() + cleanWard.slice(1);
        }
      }

      // 1. Primary Action Title (Display Typography with native tooltip on hover)
      const desc = document.createElement('div');
      desc.className = 'gd-recent-activity-desc gd-recent-activity-title';
      desc.textContent = actionTitle;
      desc.title = rawDesc;
      itemLeft.appendChild(desc);

      // 2. Metadata Subline: Hostname · Requester/Ward · Resolved Timestamp
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

      if (wardDisplayName) {
        const sep1 = document.createElement('span');
        sep1.className = 'gd-activity-sep';
        sep1.textContent = '·';
        sep1.setAttribute('aria-hidden', 'true');
        meta.appendChild(sep1);

        const wardSpan = document.createElement('span');
        wardSpan.className = 'gd-activity-ward';
        wardSpan.textContent = wardDisplayName;
        meta.appendChild(wardSpan);
      }

      const sep2 = document.createElement('span');
      sep2.className = 'gd-activity-sep';
      sep2.textContent = '·';
      sep2.setAttribute('aria-hidden', 'true');
      meta.appendChild(sep2);

      const timeSource = req.resolvedAt || (req.decision && req.decision.decidedAt) || req.createdAt;
      const timeStr = timeSource
        ? new Date(timeSource).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Resolved';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'gd-recent-activity-time';
      timeSpan.textContent = timeStr;
      meta.appendChild(timeSpan);

      itemLeft.appendChild(meta);

      // 3. Typographic Status Indicator (Pure Typography, Zero Boxes / Pills)
      const statusClass = (req.status || ApprovalStatus.APPROVED).toLowerCase();
      const statusPill = document.createElement('span');
      statusPill.className = `gd-activity-status-text ${statusClass}`;
      statusPill.setAttribute('role', 'status');

      const statusText = req.status === ApprovalStatus.APPROVED
        ? 'Approved'
        : req.status === ApprovalStatus.REJECTED
        ? 'Rejected'
        : req.status === ApprovalStatus.EXPIRED
        ? 'Expired'
        : req.status === ApprovalStatus.CANCELLED
        ? 'Cancelled'
        : (req.status || 'Approved');

      const statusIcon = req.status === ApprovalStatus.APPROVED
        ? '✓'
        : req.status === ApprovalStatus.REJECTED
        ? '✕'
        : '';

      if (statusIcon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'gd-activity-status-icon';
        iconSpan.setAttribute('aria-hidden', 'true');
        iconSpan.textContent = statusIcon;
        statusPill.appendChild(iconSpan);
      }

      const labelSpan = document.createElement('span');
      labelSpan.className = 'gd-activity-status-label';
      labelSpan.textContent = statusText;
      statusPill.appendChild(labelSpan);

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

  setupOverviewScrollReveal(section);

  return section;
}

/**
 * Sets up IntersectionObserver and scroll listeners for below-the-fold cards on the Overview page so they
 * render and reveal slowly one by one as the user scrolls to them.
 */
function setupOverviewScrollReveal(container: HTMLElement): void {
  const revealCards = container.querySelectorAll('.gd-scroll-reveal');
  if (revealCards.length === 0) return;

  if (typeof window === 'undefined') {
    // In mock/test environments or SSR, immediately reveal
    revealCards.forEach((el) => el.classList.add('is-revealed'));
    return;
  }

  let hasScrolledDown = false;

  const getScrollContainer = (): HTMLElement | null => {
    return (container.closest && container.closest('.gd-content-body'))
      || (typeof document !== 'undefined' ? document.querySelector('.gd-content-body') as HTMLElement | null : null);
  };

  const checkScroll = (fromScroll: boolean = false) => {
    const scrollParent = getScrollContainer();
    const currentScrollTop = scrollParent ? scrollParent.scrollTop : (typeof window !== 'undefined' ? window.scrollY : 0);
    if (fromScroll || currentScrollTop > 10) {
      hasScrolledDown = true;
    }

    const parentBottom = scrollParent && typeof scrollParent.getBoundingClientRect === 'function'
      ? scrollParent.getBoundingClientRect().bottom
      : (typeof window !== 'undefined' ? window.innerHeight : 800);

    const parentTop = scrollParent && typeof scrollParent.getBoundingClientRect === 'function'
      ? scrollParent.getBoundingClientRect().top
      : 0;

    revealCards.forEach((el) => {
      if (el.classList.contains('is-revealed')) return;

      if (typeof el.getBoundingClientRect === 'function') {
        const rect = el.getBoundingClientRect();
        // Ignore unrendered/zero-dimension elements
        if (rect.height === 0 && rect.width === 0) return;

        // Card is within visible viewport area of the scroll parent
        if (rect.top < parentBottom - 30 && rect.bottom > parentTop + 20) {
          el.classList.add('is-revealed');
        }
      }
    });
  };

  const onScrollEvent = () => {
    checkScroll(true);
  };

  const init = () => {
    const scrollParent = getScrollContainer();

    if (scrollParent && typeof IntersectionObserver !== 'undefined') {
      try {
        const observer = new IntersectionObserver(
          (entries, obs) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                entry.target.classList.add('is-revealed');
                obs.unobserve(entry.target);
              }
            });
          },
          {
            root: scrollParent,
            threshold: 0.05,
            rootMargin: '0px 0px -30px 0px',
          }
        );
        revealCards.forEach((el) => {
          if (!el.classList.contains('is-revealed')) {
            observer.observe(el);
          }
        });
      } catch {
        // Fallback to checkScroll if IntersectionObserver with root fails
      }
    }

    if (scrollParent && typeof scrollParent.addEventListener === 'function') {
      scrollParent.addEventListener('scroll', onScrollEvent, { passive: true });
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('scroll', onScrollEvent, { capture: true, passive: true });
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('scroll', onScrollEvent, { capture: true, passive: true });
      window.addEventListener('resize', onScrollEvent, { passive: true });
    }

    // Check once mounted, but only for cards that are truly in view initially
    checkScroll(false);
    setTimeout(() => checkScroll(false), 120);
    setTimeout(() => checkScroll(false), 350);
  };

  // Allow shell to append container to .gd-content-body before binding
  setTimeout(init, 50);
}
