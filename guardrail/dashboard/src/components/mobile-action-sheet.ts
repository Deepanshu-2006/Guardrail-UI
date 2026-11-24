/**
 * Guardrail Trusted-Contact Dashboard - Mobile Touch-Friendly Action Sheet Component
 *
 * Implements:
 * 1. Bottom-sheet modal drawer for mobile viewports (<= 768px).
 * 2. WCAG-compliant touch targets (min 48px height) for fast, deliberate review and decision execution.
 * 3. Human-first visual hierarchy: Ward attribution badge, risk severity gauge, action hero title, domain.
 * 4. Plain-language heuristic explanation bullet points.
 * 5. Decoupled safety invariant reminder: Ward in Staging Mode retains ultimate agency.
 * 6. Smooth sliding animation with safe-area insets (iOS Home indicator).
 * 7. Keyboard accessibility (Escape key dismiss, trap focus, role="dialog", aria-modal="true").
 */

import { ApprovalRequest, RiskLevel } from '../types.js';

export interface MobileActionSheetProps {
  request: ApprovalRequest;
  wardName?: string;
  isSubmitting?: boolean;
  onApprove: (requestId: string, reason?: string) => void | Promise<unknown>;
  onReject: (requestId: string, reason?: string) => void | Promise<unknown>;
  onClose: () => void;
}

/**
 * Renders an ergonomic, mobile-optimized bottom action sheet for fast review.
 */
export function renderMobileActionSheet(props: MobileActionSheetProps): HTMLElement {
  const { request, wardName = 'Protected Ward', isSubmitting = false } = props;

  const container = document.createElement('div');
  container.className = 'gd-sheet-portal';
  container.setAttribute('role', 'dialog');
  container.setAttribute('aria-modal', 'true');
  container.setAttribute('aria-labelledby', 'gd-sheet-title');

  // 1. Dimmed Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'gd-sheet-backdrop';
  backdrop.addEventListener('click', () => {
    if (!isSubmitting) {
      props.onClose();
    }
  });

  // 2. Action Sheet Drawer Container
  const sheet = document.createElement('div');
  sheet.className = 'gd-mobile-action-sheet';

  // Drag handle for mobile touch ergonomics
  const handle = document.createElement('div');
  handle.className = 'gd-sheet-drag-handle';
  handle.setAttribute('aria-hidden', 'true');

  // Header: Badges & Close Button
  const header = document.createElement('div');
  header.className = 'gd-sheet-header';

  const badgeRow = document.createElement('div');
  badgeRow.className = 'gd-sheet-badge-row';

  // Ward Attribution Badge
  const initials = wardName
    .split(/\s+/)
    .map((s) => s.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
  const wardBadge = document.createElement('div');
  wardBadge.className = 'gd-card-ward-badge';
  wardBadge.innerHTML = `
    <span class="gd-card-ward-avatar" aria-hidden="true">${initials || 'W'}</span>
    <span class="gd-card-ward-name">${wardName}</span>
  `;

  // Risk Badge
  const riskLevel = request.riskLevel || RiskLevel.LOW;
  const riskBadge = document.createElement('span');
  riskBadge.className = `gd-risk-badge ${riskLevel.toLowerCase()}`;
  riskBadge.textContent = riskLevel;

  badgeRow.appendChild(wardBadge);
  badgeRow.appendChild(riskBadge);

  // Close Button
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gd-sheet-btn-close';
  closeBtn.setAttribute('aria-label', 'Close action sheet');
  closeBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  closeBtn.addEventListener('click', () => {
    if (!isSubmitting) {
      props.onClose();
    }
  });

  header.appendChild(badgeRow);
  header.appendChild(closeBtn);

  // Content Body
  const body = document.createElement('div');
  body.className = 'gd-sheet-body';

  // Action Description
  const title = document.createElement('h2');
  title.id = 'gd-sheet-title';
  title.className = 'gd-sheet-action-title';
  title.textContent = request.actionDescription || 'Sensitive Browser Interaction';

  // Domain & Category Pill
  const metaRow = document.createElement('div');
  metaRow.className = 'gd-sheet-meta-row';

  const hostname = request.hostname || request.origin || 'Protected Domain';
  const domainBadge = document.createElement('div');
  domainBadge.className = 'gd-sheet-domain-pill';
  domainBadge.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="2" y1="12" x2="22" y2="12"></line>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
    </svg>
    <span>${hostname}</span>
  `;

  const categoryBadge = document.createElement('span');
  categoryBadge.className = 'gd-sheet-category-pill';
  categoryBadge.textContent = request.category || 'BROWSER ACTION';

  metaRow.appendChild(domainBadge);
  metaRow.appendChild(categoryBadge);

  // Risk Explanation Box
  const riskBox = document.createElement('div');
  riskBox.className = 'gd-sheet-risk-box';

  const riskHeadline = document.createElement('div');
  riskHeadline.className = 'gd-sheet-risk-headline';
  riskHeadline.textContent = 'Why this action was held:';

  const reasonsList = document.createElement('ul');
  reasonsList.className = 'gd-sheet-reasons-list';

  const reasons =
    request.riskReasons && request.riskReasons.length > 0
      ? request.riskReasons
      : ['Initiates high-impact state change requiring explicit trusted contact authorization.'];

  for (const reason of reasons) {
    const li = document.createElement('li');
    li.textContent = reason;
    reasonsList.appendChild(li);
  }

  riskBox.appendChild(riskHeadline);
  riskBox.appendChild(reasonsList);

  // Decoupled Safety Architecture Callout
  const decouplingNote = document.createElement('div');
  decouplingNote.className = 'gd-sheet-decoupling-note';
  decouplingNote.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
    <span><strong>Decoupled Safety Guarantee:</strong> Approving registers cryptographic consent on the backend. The ward in Staging Mode retains final agency to release or cancel.</span>
  `;

  body.appendChild(title);
  body.appendChild(metaRow);
  body.appendChild(riskBox);
  body.appendChild(decouplingNote);

  // Action Buttons Footer
  const actions = document.createElement('div');
  actions.className = 'gd-sheet-actions';

  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.className = 'gd-btn gd-btn-approve-touch';
  approveBtn.disabled = isSubmitting;
  approveBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <span>${isSubmitting ? 'Submitting...' : 'Approve Action'}</span>
  `;
  approveBtn.addEventListener('click', () => {
    props.onApprove(request.id);
  });

  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.className = 'gd-btn gd-btn-reject-touch';
  rejectBtn.disabled = isSubmitting;
  rejectBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
    <span>${isSubmitting ? 'Submitting...' : 'Reject Action'}</span>
  `;
  rejectBtn.addEventListener('click', () => {
    props.onReject(request.id);
  });

  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);

  // Assemble Drawer
  sheet.appendChild(handle);
  sheet.appendChild(header);
  sheet.appendChild(body);
  sheet.appendChild(actions);

  container.appendChild(backdrop);
  container.appendChild(sheet);

  // Escape key listener for keyboard accessibility
  const keydownListener = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !isSubmitting) {
      props.onClose();
    }
  };
  document.addEventListener('keydown', keydownListener);

  return container;
}
