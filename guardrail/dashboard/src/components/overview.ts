/**
 * Guardrail Trusted-Contact Dashboard - Overview Component
 *
 * Renders the top-level overview, assigned ward status, safety architecture guidance,
 * and an intentional activity placeholder without fake counts or simulated users.
 */

import { ApprovalRequest, ApprovalStatus, TrustedContactProfile } from '../types.js';

export interface OverviewProps {
  profile: TrustedContactProfile | null;
  pendingCount: number;
  recentActivity?: readonly ApprovalRequest[];
  onViewHistory?: () => void;
  onConnectInvitation?: (code: string) => Promise<{ success: boolean; wardId?: string; error?: string }>;
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

  // Ward Connection & Setup Section
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
    wardTitle.textContent = 'Active Ward Association';

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

    wardGrid.appendChild(item1);
    wardGrid.appendChild(item2);
    wardGrid.appendChild(item3);

    const dutyNotice = document.createElement('p');
    dutyNotice.className = 'gd-ward-duty-notice';
    dutyNotice.textContent =
      `Separation of Duties Enforced: You are authorized to review and evaluate intercepted actions for ward ${props.profile.assignedWardId}. Approval decisions register consent on the backend; the user in Staging Mode retains ultimate agency to execute or cancel the action.`;

    wardCard.appendChild(wardTitle);
    wardCard.appendChild(wardGrid);
    wardCard.appendChild(dutyNotice);
    section.appendChild(wardCard);
  }

  // Recent Activity Section
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
      const timeStr = req.resolvedAt ? new Date(req.resolvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Resolved';
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
