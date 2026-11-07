/**
 * Guardrail Trusted-Contact Dashboard - Overview Component
 *
 * Renders the top-level overview:
 * 1. Current protection status & governance banner
 * 2. Key metrics (Assigned Wards, Pending Actions, Portal Status)
 * 3. Important notifications & unresolved action items
 * 4. Actionable pending approvals quick-review
 * 5. Connected users they are authorized to assist (Ward oversight or setup)
 * 6. Recent approval activity audit
 *
 * Strictly avoids fake counts, simulated activity, or fabricated data.
 */

import { ApprovalRequest, ApprovalStatus, RiskLevel, TrustedContactProfile, ViewStatus } from '../types.js';

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
  onViewHistory?: () => void;
  onViewPending?: () => void;
  onSelectPending?: (requestId: string) => void;
  onConnectInvitation?: (code: string) => Promise<{ success: boolean; wardId?: string; error?: string }>;
  onRefresh?: () => void;
}

export function renderOverview(props: OverviewProps): HTMLElement {
  const section = document.createElement('section');
  section.id = 'view-overview';
  section.className = 'gd-view-section active';
  section.setAttribute('aria-labelledby', 'overview-title');

  // Header
  const header = document.createElement('header');
  header.className = 'gd-section-header';

  const title = document.createElement('h1');
  title.id = 'overview-title';
  title.className = 'gd-section-title';
  title.textContent = 'Trusted Contact Oversight';

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-section-subtitle';
  subtitle.textContent =
    'Review safety scores and evaluate high-risk browser actions requested by your assigned wards.';

  header.appendChild(title);
  header.appendChild(subtitle);
  section.appendChild(header);

  // 1. Current Protection Status & Governance Banner
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

  if (props.isBackendUnavailable) {
    protectionCard.classList.add('status-offline');
    protIcon.textContent = '⚠️';
    protBadge.className = 'gd-protection-badge badge-offline';
    protBadge.textContent = 'Service Offline';
    protTitle.textContent = 'Protection Status: Service Connection Offline';
    protDesc.textContent =
      'The approval backend is currently unreachable. Live action streaming and status synchronization are paused. The client will automatically resume when connectivity is restored.';
  } else if (props.isMockService) {
    protectionCard.classList.add('status-mock');
    protIcon.textContent = '🧪';
    protBadge.className = 'gd-protection-badge badge-mock';
    protBadge.textContent = 'Mock Fixture';
    protTitle.textContent = 'Protection Status: Development Fixture Active';
    protDesc.textContent =
      'Operating against an in-memory fixture service. Decisions are recorded in local memory and are not enforced on a production Guardrail cluster.';
  } else if (props.profile?.isAuthenticated) {
    protectionCard.classList.add('status-operational');
    protIcon.textContent = '🛡️';
    protBadge.className = 'gd-protection-badge badge-active';
    protBadge.textContent = 'Operational & Enforced';
    protTitle.textContent = 'Protection Status: Live Guardrail Protection Active';
    protDesc.textContent =
      'Connected to authoritative Guardrail safety backend. Intercepted actions from your authorized ward are evaluated under strict separation of duties.';
  } else {
    protectionCard.classList.add('status-standalone');
    protIcon.textContent = '🔒';
    protBadge.className = 'gd-protection-badge badge-standalone';
    protBadge.textContent = 'Standalone Shell';
    protTitle.textContent = 'Protection Status: Standalone Preview Mode';
    protDesc.textContent =
      'Running in decoupled client preview. Connect with an authorized trusted contact session to evaluate real browser actions.';
  }

  protTextGroup.appendChild(protTitle);
  protTextGroup.appendChild(protDesc);
  protHeader.appendChild(protIcon);
  protHeader.appendChild(protTextGroup);
  protHeader.appendChild(protBadge);
  protectionCard.appendChild(protHeader);

  // Invariant Posture Chips
  const chipsRow = document.createElement('div');
  chipsRow.className = 'gd-protection-chips-row';

  const createChip = (icon: string, label: string, value: string) => {
    const chip = document.createElement('div');
    chip.className = 'gd-protection-chip';
    const icn = document.createElement('span');
    icn.className = 'gd-chip-icon';
    icn.setAttribute('aria-hidden', 'true');
    icn.textContent = icon;
    const lbl = document.createElement('span');
    lbl.className = 'gd-chip-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'gd-chip-val';
    val.textContent = value;
    chip.appendChild(icn);
    chip.appendChild(lbl);
    chip.appendChild(val);
    return chip;
  };

  chipsRow.appendChild(createChip('⚡', 'Interception', 'Active in Staging Mode'));
  chipsRow.appendChild(createChip('🔒', 'Execution', 'Decoupled (Consent Only)'));
  chipsRow.appendChild(createChip('👥', 'Isolation', 'Strict Multi-Tenant Scoping'));

  const syncTimeStr = props.lastSynchronizedAt
    ? props.lastSynchronizedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Not yet synchronized';
  chipsRow.appendChild(createChip('⏱️', 'Last Sync', syncTimeStr));

  protectionCard.appendChild(chipsRow);
  section.appendChild(protectionCard);

  // Trust & Architectural Separation Callout
  const callout = document.createElement('div');
  callout.className = 'gd-callout';
  callout.setAttribute('role', 'note');

  const calloutIcon = document.createElement('div');
  calloutIcon.className = 'gd-callout-icon';
  calloutIcon.setAttribute('aria-hidden', 'true');
  calloutIcon.textContent = 'ℹ️';

  const calloutContent = document.createElement('div');
  calloutContent.className = 'gd-callout-content';

  const calloutTitle = document.createElement('h2');
  calloutTitle.className = 'gd-callout-title';
  calloutTitle.textContent = 'Decoupled Action Execution Architecture';

  const calloutText = document.createElement('p');
  calloutText.className = 'gd-callout-text';
  calloutText.textContent =
    'Guardrail strictly decouples approval decisions from browser action execution. Recording an approval on the backend validates your consent but does not remotely execute the action. The user in Staging Mode retains ultimate agency to proceed or cancel.';

  calloutContent.appendChild(calloutTitle);
  calloutContent.appendChild(calloutText);
  callout.appendChild(calloutIcon);
  callout.appendChild(calloutContent);
  section.appendChild(callout);

  // Overview Metrics Grid (Non-fabricated)
  const grid = document.createElement('div');
  grid.className = 'gd-overview-grid';

  // Card 1: Assigned Wards
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
    ? `Designated reviewer for ward ${props.profile.assignedWardId}`
    : 'No wards linked. Establish a trusted contact relationship to begin.';

  wardCard.appendChild(wardHeader);
  wardCard.appendChild(wardValue);
  wardCard.appendChild(wardDesc);
  grid.appendChild(wardCard);

  // Card 2: Pending Approvals
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
      ? 'Intercepted actions currently held in browser runtime waiting for evaluation.'
      : 'No actions currently waiting for approval.';

  pendingCard.appendChild(pendingHeader);
  pendingCard.appendChild(pendingValue);
  pendingCard.appendChild(pendingDesc);
  grid.appendChild(pendingCard);

  // Card 3: System Status
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
    ? 'Authenticated with server-enforced multi-tenant authorization.'
    : 'Running in decoupled frontend shell mode. Connect backend for live streaming.';

  statusCard.appendChild(statusHeader);
  statusCard.appendChild(statusValue);
  statusCard.appendChild(statusDesc);
  grid.appendChild(statusCard);

  section.appendChild(grid);

  // 2. Important Notifications or Unresolved Items
  const notifSection = document.createElement('div');
  notifSection.className = 'gd-card gd-notifications-card';
  notifSection.id = 'gd-notifications-card';

  const notifHeader = document.createElement('div');
  notifHeader.className = 'gd-notifications-header';

  const notifTitle = document.createElement('h2');
  notifTitle.className = 'gd-section-title';
  notifTitle.textContent = 'Important Notifications & Action Items';

  notifHeader.appendChild(notifTitle);
  notifSection.appendChild(notifHeader);

  const notifList = document.createElement('div');
  notifList.className = 'gd-notifications-list';

  let hasActionItem = false;

  // Notification 1: Pending Approvals Action Required
  if (props.pendingCount > 0) {
    hasActionItem = true;
    const item = document.createElement('div');
    item.className = 'gd-notification-item gd-notif-warning';

    const notifIcn = document.createElement('span');
    notifIcn.className = 'gd-notif-icon';
    notifIcn.setAttribute('aria-hidden', 'true');
    notifIcn.textContent = '⏳';

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
    item.appendChild(notifIcn);
    item.appendChild(notifContent);

    if (props.onViewPending) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gd-btn-notif-action';
      btn.textContent = 'Review Pending →';
      btn.addEventListener('click', () => {
        props.onViewPending?.();
      });
      item.appendChild(btn);
    }

    notifList.appendChild(item);
  }

  // Notification 2: Backend Unreachable Alert
  if (props.isBackendUnavailable) {
    hasActionItem = true;
    const item = document.createElement('div');
    item.className = 'gd-notification-item gd-notif-danger';

    const notifIcn = document.createElement('span');
    notifIcn.className = 'gd-notif-icon';
    notifIcn.setAttribute('aria-hidden', 'true');
    notifIcn.textContent = '📡';

    const notifContent = document.createElement('div');
    notifContent.className = 'gd-notif-content';

    const notifMsg = document.createElement('p');
    notifMsg.className = 'gd-notif-text';

    const strong = document.createElement('strong');
    strong.textContent = 'Connection Alert: ';
    notifMsg.appendChild(strong);

    const txt = document.createElement('span');
    txt.textContent = 'The approval backend is currently unreachable. Last verified data may be stale.';
    notifMsg.appendChild(txt);

    notifContent.appendChild(notifMsg);
    item.appendChild(notifIcn);
    item.appendChild(notifContent);

    if (props.onRefresh) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-notif-action';
      retryBtn.textContent = 'Retry Sync';
      retryBtn.addEventListener('click', () => {
        props.onRefresh?.();
      });
      item.appendChild(retryBtn);
    }

    notifList.appendChild(item);
  }

  // Notification 3: Unlinked Ward Notice
  if (!props.profile?.assignedWardId) {
    hasActionItem = true;
    const item = document.createElement('div');
    item.className = 'gd-notification-item gd-notif-info';

    const notifIcn = document.createElement('span');
    notifIcn.className = 'gd-notif-icon';
    notifIcn.setAttribute('aria-hidden', 'true');
    notifIcn.textContent = '🔗';

    const notifContent = document.createElement('div');
    notifContent.className = 'gd-notif-content';

    const notifMsg = document.createElement('p');
    notifMsg.className = 'gd-notif-text';

    const strong = document.createElement('strong');
    strong.textContent = 'Ward Oversight Needed: ';
    notifMsg.appendChild(strong);

    const txt = document.createElement('span');
    txt.textContent = 'No user ward is currently connected. Connect an invitation code below to begin receiving approval requests.';
    notifMsg.appendChild(txt);

    notifContent.appendChild(notifMsg);
    item.appendChild(notifIcn);
    item.appendChild(notifContent);
    notifList.appendChild(item);
  }

  // Notification 4: Mock Service Fixture Indicator
  if (props.isMockService) {
    const item = document.createElement('div');
    item.className = 'gd-notification-item gd-notif-muted';

    const notifIcn = document.createElement('span');
    notifIcn.className = 'gd-notif-icon';
    notifIcn.setAttribute('aria-hidden', 'true');
    notifIcn.textContent = '🧪';

    const notifContent = document.createElement('div');
    notifContent.className = 'gd-notif-content';

    const notifMsg = document.createElement('p');
    notifMsg.className = 'gd-notif-text';

    const strong = document.createElement('strong');
    strong.textContent = 'Development Mode: ';
    notifMsg.appendChild(strong);

    const txt = document.createElement('span');
    txt.textContent = 'Dashboard is connected to a local mock or in-memory service fixture. Real browser actions are not intercepted.';
    notifMsg.appendChild(txt);

    notifContent.appendChild(notifMsg);
    item.appendChild(notifIcn);
    item.appendChild(notifContent);
    notifList.appendChild(item);
  }

  // Sensible Empty State for Notifications
  if (!hasActionItem) {
    const item = document.createElement('div');
    item.className = 'gd-notification-item gd-notif-success';

    const notifIcn = document.createElement('span');
    notifIcn.className = 'gd-notif-icon';
    notifIcn.setAttribute('aria-hidden', 'true');
    notifIcn.textContent = '✓';

    const notifContent = document.createElement('div');
    notifContent.className = 'gd-notif-content';

    const notifMsg = document.createElement('p');
    notifMsg.className = 'gd-notif-text';
    notifMsg.textContent = 'All Systems Normal: No unresolved safety items or pending approvals requiring attention.';

    notifContent.appendChild(notifMsg);
    item.appendChild(notifIcn);
    item.appendChild(notifContent);
    notifList.appendChild(item);
  }

  notifSection.appendChild(notifList);
  section.appendChild(notifSection);

  // 3. Actionable Pending Approvals Quick-Review Section
  const pendingSection = document.createElement('div');
  pendingSection.className = 'gd-card gd-overview-pending-section';
  pendingSection.id = 'gd-overview-pending-section';

  const pendingSecHeader = document.createElement('div');
  pendingSecHeader.className = 'gd-overview-pending-header';

  const pendingSecTitle = document.createElement('h2');
  pendingSecTitle.className = 'gd-section-title';
  pendingSecTitle.textContent = 'Pending Approval Requests';

  const pendingSecSub = document.createElement('p');
  pendingSecSub.className = 'gd-section-subtitle';
  pendingSecSub.textContent =
    'High-risk browser actions intercepted in Staging Mode awaiting your safety determination.';

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
  } else if (props.pendingStatus === 'error' && pendingList.length === 0) {
    // Error state
    const errBox = document.createElement('div');
    errBox.className = 'gd-error-banner';
    errBox.textContent = props.errorMessage || 'Unable to load pending approval requests.';
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
      const timeStr = req.timestamp
        ? new Date(req.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
    // Sensible Empty State for Pending Requests
    const emptyBox = document.createElement('div');
    emptyBox.className = 'gd-overview-empty-pending';

    const empIcon = document.createElement('div');
    empIcon.className = 'gd-placeholder-icon';
    empIcon.setAttribute('aria-hidden', 'true');
    empIcon.textContent = '🛡️';

    const empTitle = document.createElement('h3');
    empTitle.className = 'gd-placeholder-title';
    empTitle.textContent = 'Review Queue All Clear';

    const empText = document.createElement('p');
    empText.className = 'gd-placeholder-text';
    empText.textContent =
      'No browser actions are currently held in Staging Mode waiting for evaluation. When an authorized ward initiates a high-risk action, it will appear here.';

    emptyBox.appendChild(empIcon);
    emptyBox.appendChild(empTitle);
    emptyBox.appendChild(empText);
    pendingSection.appendChild(emptyBox);
  }

  section.appendChild(pendingSection);

  // 4. Ward Connection & Setup Section (Authorized Users Assistance)
  if (!props.profile?.assignedWardId) {
    const setupCard = document.createElement('div');
    setupCard.className = 'gd-card gd-setup-card';
    setupCard.id = 'gd-setup-card';

    const setupHeader = document.createElement('div');
    setupHeader.className = 'gd-setup-header';

    const setupTitle = document.createElement('h2');
    setupTitle.className = 'gd-section-title gd-setup-title';
    setupTitle.textContent = 'Trusted Contact Setup & Ward Connection';

    const setupSubtitle = document.createElement('p');
    setupSubtitle.className = 'gd-setup-subtitle';
    setupSubtitle.textContent =
      'Connect your trusted contact portal to a ward’s browser extension using a secure out-of-band invitation code.';

    setupHeader.appendChild(setupTitle);
    setupHeader.appendChild(setupSubtitle);
    setupCard.appendChild(setupHeader);

    // Setup Steps
    const stepsList = document.createElement('ol');
    stepsList.className = 'gd-setup-steps';

    const step1 = document.createElement('li');
    step1.className = 'gd-setup-step';
    step1.innerHTML =
      '<strong>Step 1:</strong> The ward generates an invitation code (e.g. <code>GR-INV-A1B2-C3D4</code>) in their Guardrail extension popup or onboarding flow.';

    const step2 = document.createElement('li');
    step2.className = 'gd-setup-step';
    step2.innerHTML =
      '<strong>Step 2:</strong> They transmit the code to you through an out-of-band secure channel (in-person, SMS, Signal).';

    const step3 = document.createElement('li');
    step3.className = 'gd-setup-step';
    step3.innerHTML =
      '<strong>Step 3:</strong> Enter the invitation code below and click <strong>Connect Ward</strong> to establish the authorized oversight relationship.';

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
    input.className = 'gd-setup-input';
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
    section.appendChild(setupCard);
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
    section.appendChild(wardCard);
  }

  // 5. Recent Activity Section
  const activitySection = document.createElement('div');
  activitySection.className = 'gd-card';

  const activityTitle = document.createElement('h2');
  activityTitle.className = 'gd-section-title';
  activityTitle.textContent = 'Recent Activity Audit';

  const recentList = props.recentActivity ?? [];

  if (recentList.length === 0) {
    // Intentional Empty Placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'gd-placeholder';

    const icon = document.createElement('div');
    icon.className = 'gd-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '📋';

    const pTitle = document.createElement('h3');
    pTitle.className = 'gd-placeholder-title';
    pTitle.textContent = 'No Recent Activity Recorded';

    const pText = document.createElement('p');
    pText.className = 'gd-placeholder-text';
    pText.textContent =
      'When approval requests are evaluated and decisions are committed by trusted contacts, the audit log will record them here.';

    placeholder.appendChild(icon);
    placeholder.appendChild(pTitle);
    placeholder.appendChild(pText);

    activitySection.appendChild(activityTitle);
    activitySection.appendChild(placeholder);
  } else {
    // Authoritative Recent Decisions List (Top 5)
    activitySection.appendChild(activityTitle);

    const listContainer = document.createElement('div');
    listContainer.className = 'gd-recent-activity-list';

    for (const req of recentList.slice(0, 5)) {
      const item = document.createElement('div');
      item.className = 'gd-recent-activity-item';

      const itemLeft = document.createElement('div');
      itemLeft.className = 'gd-recent-activity-left';

      const desc = document.createElement('div');
      desc.className = 'gd-recent-activity-desc';
      desc.textContent = req.actionDescription;

      const meta = document.createElement('div');
      meta.className = 'gd-recent-activity-meta';
      const host = req.hostname || 'Local Interaction';
      const timeStr = req.resolvedAt
        ? new Date(req.resolvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Resolved';
      meta.textContent = `${host} • ${timeStr}`;

      itemLeft.appendChild(desc);
      itemLeft.appendChild(meta);

      const statusClass = (req.status || ApprovalStatus.APPROVED).toLowerCase();
      const statusPill = document.createElement('span');
      statusPill.className = `gd-detail-status-pill ${statusClass}`;
      statusPill.textContent = req.status || 'RESOLVED';

      item.appendChild(itemLeft);
      item.appendChild(statusPill);
      listContainer.appendChild(item);
    }

    activitySection.appendChild(listContainer);

    if (props.onViewHistory) {
      const viewAllBtn = document.createElement('button');
      viewAllBtn.type = 'button';
      viewAllBtn.className = 'gd-btn-view-all-history';
      viewAllBtn.textContent = 'View Full Decision History & Audit Log →';
      viewAllBtn.addEventListener('click', () => {
        props.onViewHistory?.();
      });
      activitySection.appendChild(viewAllBtn);
    }
  }

  section.appendChild(activitySection);

  return section;
}
