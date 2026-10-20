/**
 * Guardrail Trusted-Contact Dashboard - Overview Component
 *
 * Renders the top-level overview, assigned ward status, safety architecture guidance,
 * and an intentional activity placeholder without fake counts or simulated users.
 */

import { TrustedContactProfile } from '../types.js';

export interface OverviewProps {
  profile: TrustedContactProfile | null;
  pendingCount: number;
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

  // Recent Activity Card (Intentional Empty Placeholder)
  const activitySection = document.createElement('div');
  activitySection.className = 'gd-card';

  const activityTitle = document.createElement('h2');
  activityTitle.className = 'gd-section-title';
  activityTitle.textContent = 'Recent Activity Audit';

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
  section.appendChild(activitySection);

  return section;
}
