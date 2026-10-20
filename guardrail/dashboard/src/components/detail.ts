/**
 * Guardrail Trusted-Contact Dashboard - Request Detail Inspector Component
 *
 * Presents the comprehensive, structured information needed for an informed approval decision:
 * 1. Action Under Review (Held Browser Action):
 *    - Description, website hostname, origin, page title, interaction type, semantic category.
 *    - Explicitly distinguished from the backend approval request governance record.
 *    - Reaffirms the decoupled execution guarantee: approving records reviewer consent on server,
 *      it does NOT remotely trigger or execute the action in the ward's browser.
 * 2. Safety & Risk Evaluation:
 *    - Evaluated risk level (LOW, MEDIUM, HIGH, CRITICAL) with plain-language operational explanation.
 *    - Quantitative score on the 0-100 normalized scale.
 *    - Authentic heuristic risk reasons strictly from the evaluation engine (no invented reasons).
 *    - Explicit non-malicious risk disclaimer: High risk reflects operational impact/sensitivity,
 *      not proof of malicious intent.
 * 3. Approval Request Governance (Backend Record):
 *    - Canonical Request ID (`apr_...`), lifecycle status, creation time, expiration deadline.
 *    - Resolved states (APPROVED, REJECTED, CANCELLED, EXPIRED) with decision & cancellation metadata.
 * 4. Safe Rendering & Privacy:
 *    - Zero executable HTML insertion; strictly safe textContent assignment.
 *    - Whitelist projection excluding passwords, OTPs, card numbers, tokens, cookies, or secrets.
 * 5. Read-only Decision Notice:
 *    - Decision submission behavior is intentionally deferred to Day 13+.
 */

import {
  ApprovalRequest,
  ApprovalStatus,
  RiskLevel,
} from '../types.js';

export interface RequestDetailViewProps {
  /** The approval request record to display, or null/undefined if none is selected */
  request: ApprovalRequest | null | undefined;
  /** Whether request details are currently being loaded from the backend */
  isLoading?: boolean;
  /** Optional error message if loading details failed */
  errorMessage?: string | null;
  /** Optional callback to refresh or retry fetching request details */
  onRefresh?: () => void;
}

/**
 * Returns a human-friendly, plain-language explanation of a risk level.
 *
 * ARCHITECTURAL PRINCIPLE:
 * Explains operational impact, data-loss risk, and reversibility.
 * Does NOT label the action or website as malicious.
 */
export function getRiskLevelExplanation(level?: RiskLevel | string): string {
  const normalized = String(level || '').toUpperCase();
  switch (normalized) {
    case RiskLevel.LOW:
    case 'LOW':
      return 'Low operational impact: Routine read or benign navigation with negligible risk of permanent data loss.';
    case RiskLevel.MEDIUM:
    case 'MEDIUM':
      return 'Moderate operational impact: Typically reversible state modifications or standard low-stakes form submissions.';
    case RiskLevel.HIGH:
    case 'HIGH':
      return 'Elevated operational impact: Involves sensitive configuration changes, financial workflows, or authentication boundaries that warrant human verification.';
    case RiskLevel.CRITICAL:
    case 'CRITICAL':
      return 'High operational impact: Involves irreversible deletions, permanent resource destruction, or elevated privilege modifications.';
    default:
      return 'Unclassified impact: This action has not received an automated risk level categorization.';
  }
}

/**
 * Formats an ISO 8601 timestamp string into a readable local date and time.
 * Handles missing or invalid strings gracefully.
 */
export function formatTimestamp(isoString?: string | null): string {
  if (!isoString || typeof isoString !== 'string' || !isoString.trim()) {
    return 'Not specified';
  }
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) {
      return isoString;
    }
    return d.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

/**
 * Helper to safely extract or fallback a display hostname from hostname or origin.
 */
function resolveSafeHostname(request: ApprovalRequest): string {
  if (request.hostname && typeof request.hostname === 'string' && request.hostname.trim()) {
    return request.hostname.trim();
  }
  if (request.origin && typeof request.origin === 'string' && request.origin.trim()) {
    try {
      const parsed = new URL(request.origin.trim());
      if (parsed.hostname) return parsed.hostname;
    } catch {
      // Invalid URL format, use raw origin string safely
      return request.origin.trim();
    }
  }
  return 'Not reported';
}

/**
 * Helper to build an accessible label-value grid item.
 */
function createGridItem(label: string, valueText: string, extraClass?: string): HTMLElement {
  const item = document.createElement('div');
  item.className = extraClass ? `gd-detail-item ${extraClass}` : 'gd-detail-item';

  const labelEl = document.createElement('span');
  labelEl.className = 'gd-detail-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'gd-detail-value';
  valueEl.textContent = valueText;

  item.appendChild(labelEl);
  item.appendChild(valueEl);
  return item;
}

/**
 * Helper to build a styled status banner explaining the request's current lifecycle state.
 */
function createStatusBanner(request: ApprovalRequest): HTMLElement {
  const status = request.status || ApprovalStatus.PENDING;
  const banner = document.createElement('div');
  const statusClass = status.toLowerCase();
  banner.className = `gd-status-banner ${statusClass}`;
  banner.setAttribute('role', 'status');

  const content = document.createElement('div');
  content.className = 'gd-status-banner-content';

  const titleEl = document.createElement('strong');
  titleEl.className = 'gd-status-banner-title';

  const descEl = document.createElement('p');
  descEl.className = 'gd-status-banner-desc';

  switch (status) {
    case ApprovalStatus.PENDING:
      titleEl.textContent = '⏳ Awaiting Review';
      descEl.textContent =
        'This action is currently held in the ward’s browser. An authorized trusted contact must record a review decision before the ward can proceed in Staging Mode.';
      break;

    case ApprovalStatus.APPROVED:
      titleEl.textContent = '✅ Approved by Trusted Contact';
      if (request.decision) {
        const decidedBy = request.decision.decidedBy || 'Authorized reviewer';
        const decidedAt = formatTimestamp(request.decision.decidedAt || request.resolvedAt);
        descEl.textContent = `Approved by ${decidedBy} on ${decidedAt}. The user may proceed with this action in Staging Mode.`;
      } else {
        descEl.textContent =
          'Reviewer approval recorded on server. The user may proceed with this action in Staging Mode.';
      }
      break;

    case ApprovalStatus.REJECTED:
      titleEl.textContent = '❌ Rejected by Trusted Contact';
      if (request.decision) {
        const decidedBy = request.decision.decidedBy || 'Authorized reviewer';
        const decidedAt = formatTimestamp(request.decision.decidedAt || request.resolvedAt);
        descEl.textContent = `Rejected by ${decidedBy} on ${decidedAt}. The held action cannot proceed.`;
      } else {
        descEl.textContent =
          'This action was rejected by an authorized trusted contact. The held browser action cannot proceed.';
      }
      break;

    case ApprovalStatus.CANCELLED:
      titleEl.textContent = '🚫 Action Cancelled';
      if (request.cancellationReason) {
        descEl.textContent = `The user cancelled this action in Staging Mode: "${request.cancellationReason}".`;
      } else {
        descEl.textContent =
          'The requesting user cancelled this action from Staging Mode or navigated away. Review is aborted.';
      }
      break;

    case ApprovalStatus.EXPIRED:
      titleEl.textContent = '⏰ Request Expired';
      descEl.textContent =
        'The review deadline elapsed before a decision was recorded. The held action has timed out and cannot proceed without a fresh review.';
      break;

    default:
      titleEl.textContent = `Status: ${status}`;
      descEl.textContent = 'This request is in an authoritative server-recorded state.';
      break;
  }

  content.appendChild(titleEl);
  content.appendChild(descEl);
  banner.appendChild(content);

  return banner;
}

/**
 * Renders the complete Request Detail View component.
 */
export function renderRequestDetailView(props: RequestDetailViewProps): HTMLElement {
  const container = document.createElement('div');
  container.className = 'gd-detail-pane';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Selected Request Details');

  // 1. Loading State
  if (props.isLoading) {
    const loadingWrap = document.createElement('div');
    loadingWrap.className = 'gd-detail-loading-wrap';
    loadingWrap.setAttribute('role', 'status');
    loadingWrap.setAttribute('aria-busy', 'true');
    loadingWrap.setAttribute('aria-label', 'Loading approval request details');

    const s1 = document.createElement('div');
    s1.className = 'gd-skeleton gd-skeleton-line short';
    s1.style.height = '24px';

    const s2 = document.createElement('div');
    s2.className = 'gd-skeleton gd-skeleton-line';
    s2.style.height = '18px';

    const s3 = document.createElement('div');
    s3.className = 'gd-skeleton gd-skeleton-line';
    s3.style.height = '140px';

    loadingWrap.appendChild(s1);
    loadingWrap.appendChild(s2);
    loadingWrap.appendChild(s3);
    container.appendChild(loadingWrap);
    return container;
  }

  // 2. Error State
  if (props.errorMessage) {
    const errorBanner = document.createElement('div');
    errorBanner.className = 'gd-error-banner';
    errorBanner.setAttribute('role', 'alert');

    const errorContent = document.createElement('div');
    errorContent.className = 'gd-error-content';

    const icon = document.createElement('span');
    icon.className = 'gd-error-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⚠️';

    const errorText = document.createElement('span');
    errorText.className = 'gd-error-text';
    errorText.textContent = props.errorMessage;

    errorContent.appendChild(icon);
    errorContent.appendChild(errorText);
    errorBanner.appendChild(errorContent);

    if (props.onRefresh) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => props.onRefresh?.());
      errorBanner.appendChild(retryBtn);
    }

    container.appendChild(errorBanner);
    return container;
  }

  // 3. No Request Selected Placeholder
  if (!props.request) {
    const placeholder = document.createElement('div');
    placeholder.className = 'gd-placeholder';

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

    placeholder.appendChild(icon);
    placeholder.appendChild(pTitle);
    placeholder.appendChild(pText);
    container.appendChild(placeholder);
    return container;
  }

  const req = props.request;

  // 4. Detail Header (Canonical ID, Action Description, Status Pill)
  const dHeader = document.createElement('header');
  dHeader.className = 'gd-detail-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'gd-detail-title-group';

  const idSpan = document.createElement('span');
  idSpan.className = 'gd-detail-id';
  idSpan.textContent = `Canonical Request ID: ${req.id}`;

  const dTitle = document.createElement('h2');
  dTitle.className = 'gd-detail-title';
  dTitle.textContent = req.actionDescription || 'Unnamed Browser Action';

  titleGroup.appendChild(idSpan);
  titleGroup.appendChild(dTitle);

  const statusPill = document.createElement('span');
  const statusClass = (req.status || ApprovalStatus.PENDING).toLowerCase();
  statusPill.className = `gd-detail-status-pill ${statusClass}`;
  statusPill.textContent = req.status || ApprovalStatus.PENDING;

  dHeader.appendChild(titleGroup);
  dHeader.appendChild(statusPill);
  container.appendChild(dHeader);

  // 5. Lifecycle Status Banner
  container.appendChild(createStatusBanner(req));

  // 6. Section A: Held Browser Action (Action Under Review)
  // ARCHITECTURAL DISTINCTION: Separates what the ward did in browser from the approval request record.
  const actionCard = document.createElement('section');
  actionCard.className = 'gd-detail-card gd-action-card';
  actionCard.setAttribute('aria-labelledby', 'detail-action-heading');

  const actionHeader = document.createElement('div');
  actionHeader.className = 'gd-card-header';

  const actionTitle = document.createElement('h3');
  actionTitle.id = 'detail-action-heading';
  actionTitle.className = 'gd-card-title';
  actionTitle.textContent = 'Browser Action Under Review';

  const actionSubtitle = document.createElement('p');
  actionSubtitle.className = 'gd-card-subtitle';
  actionSubtitle.textContent =
    'The specific browser interaction intercepted and currently held in the ward’s local tab.';

  actionHeader.appendChild(actionTitle);
  actionHeader.appendChild(actionSubtitle);
  actionCard.appendChild(actionHeader);

  const actionGrid = document.createElement('div');
  actionGrid.className = 'gd-detail-grid';

  actionGrid.appendChild(createGridItem('Website Hostname', resolveSafeHostname(req)));
  actionGrid.appendChild(createGridItem('Full Origin URL', req.origin || 'Not reported'));
  actionGrid.appendChild(createGridItem('Webpage Title', req.pageTitle || 'Untitled webpage'));
  actionGrid.appendChild(createGridItem('Interaction Type', req.actionType || 'Standard interaction'));
  actionGrid.appendChild(createGridItem('Semantic Category', req.category || 'General'));
  actionGrid.appendChild(createGridItem('Ward Identifier', req.requesterId || 'Unknown'));
  actionGrid.appendChild(createGridItem('Browser Action ID', req.actionId || 'Not reported'));

  actionCard.appendChild(actionGrid);

  // Decoupled Action Architecture Box
  const actionDecouplingBox = document.createElement('div');
  actionDecouplingBox.className = 'gd-action-decoupling-note';
  actionDecouplingBox.setAttribute('role', 'note');

  const decouplingP = document.createElement('p');
  decouplingP.textContent =
    'Held in Ward’s Browser: This interaction is currently paused in the user’s browser tab. Approving or rejecting updates the server governance record; it does NOT remotely execute or trigger the action in the ward’s browser.';

  actionDecouplingBox.appendChild(decouplingP);
  actionCard.appendChild(actionDecouplingBox);

  container.appendChild(actionCard);

  // 7. Section B: Safety & Risk Evaluation
  const riskCard = document.createElement('section');
  riskCard.className = 'gd-detail-card gd-risk-card';
  riskCard.setAttribute('aria-labelledby', 'detail-risk-heading');

  const riskHeader = document.createElement('div');
  riskHeader.className = 'gd-card-header';

  const riskTitle = document.createElement('h3');
  riskTitle.id = 'detail-risk-heading';
  riskTitle.className = 'gd-card-title';
  riskTitle.textContent = 'Safety & Risk Evaluation';

  const riskSubtitle = document.createElement('p');
  riskSubtitle.className = 'gd-card-subtitle';
  riskSubtitle.textContent =
    'Automated analysis performed by the Guardrail Risk Engine evaluating operational and security impact.';

  riskHeader.appendChild(riskTitle);
  riskHeader.appendChild(riskSubtitle);
  riskCard.appendChild(riskHeader);

  // Risk Level Badge + Plain-Language Explanation Row
  const riskSummaryRow = document.createElement('div');
  riskSummaryRow.className = 'gd-risk-summary-row';

  const riskBadge = document.createElement('span');
  const riskClass = (req.riskLevel || 'LOW').toLowerCase();
  riskBadge.className = `gd-risk-badge ${riskClass}`;
  riskBadge.textContent = req.riskLevel || 'LOW';

  const riskExplanation = document.createElement('div');
  riskExplanation.className = 'gd-risk-explanation';
  riskExplanation.textContent = getRiskLevelExplanation(req.riskLevel);

  riskSummaryRow.appendChild(riskBadge);
  riskSummaryRow.appendChild(riskExplanation);
  riskCard.appendChild(riskSummaryRow);

  // Quantitative Score
  const scoreRow = document.createElement('div');
  scoreRow.className = 'gd-risk-score-row';

  const scoreLabel = document.createElement('span');
  scoreLabel.className = 'gd-detail-label';
  scoreLabel.textContent = 'Quantitative Risk Score';

  const scoreValue = document.createElement('span');
  scoreValue.className = 'gd-risk-score-value';
  scoreValue.textContent =
    req.riskScore !== undefined
      ? `${req.riskScore} / 100 (Evaluation Scale: 0–25 Low, 26–50 Medium, 51–75 High, 76–100 Critical)`
      : 'Not Scored';

  scoreRow.appendChild(scoreLabel);
  scoreRow.appendChild(scoreValue);
  riskCard.appendChild(scoreRow);

  // Heuristic Risk Reasons
  const reasonsSection = document.createElement('div');
  reasonsSection.className = 'gd-risk-reasons-section';

  const reasonsLabel = document.createElement('span');
  reasonsLabel.className = 'gd-detail-label';
  reasonsLabel.textContent = 'Heuristic Risk Analysis';

  reasonsSection.appendChild(reasonsLabel);

  if (req.riskReasons && Array.isArray(req.riskReasons) && req.riskReasons.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'gd-risk-reasons-list';

    for (const reason of req.riskReasons) {
      if (typeof reason === 'string' && reason.trim()) {
        const li = document.createElement('li');
        li.className = 'gd-risk-reason-item';
        li.textContent = reason.trim();
        ul.appendChild(li);
      }
    }
    reasonsSection.appendChild(ul);
  } else {
    // Graceful fallback: do NOT invent new risk reasons
    const emptyReasons = document.createElement('p');
    emptyReasons.className = 'gd-risk-empty-text';
    emptyReasons.textContent = 'No specific risk heuristics reported by the evaluation engine.';
    reasonsSection.appendChild(emptyReasons);
  }

  riskCard.appendChild(reasonsSection);

  // NON-MALICIOUS RISK DISCLAIMER (Requirement 10)
  const disclaimer = document.createElement('div');
  disclaimer.className = 'gd-risk-disclaimer';
  disclaimer.setAttribute('role', 'note');

  const disclaimerIcon = document.createElement('span');
  disclaimerIcon.className = 'gd-disclaimer-icon';
  disclaimerIcon.setAttribute('aria-hidden', 'true');
  disclaimerIcon.textContent = 'ℹ️';

  const disclaimerText = document.createElement('p');
  disclaimerText.className = 'gd-disclaimer-text';
  disclaimerText.textContent =
    'Notice: Guardrail risk scores measure operational sensitivity, potential data loss, and security impact to safeguard users. A high or critical risk score reflects high operational stakes requiring verification, NOT that the website or action is confirmed to be malicious or fraudulent.';

  disclaimer.appendChild(disclaimerIcon);
  disclaimer.appendChild(disclaimerText);
  riskCard.appendChild(disclaimer);

  container.appendChild(riskCard);

  // 8. Section C: Approval Request Governance (Backend Record)
  const govCard = document.createElement('section');
  govCard.className = 'gd-detail-card gd-governance-card';
  govCard.setAttribute('aria-labelledby', 'detail-gov-heading');

  const govHeader = document.createElement('div');
  govHeader.className = 'gd-card-header';

  const govTitle = document.createElement('h3');
  govTitle.id = 'detail-gov-heading';
  govTitle.className = 'gd-card-title';
  govTitle.textContent = 'Approval Request Governance';

  const govSubtitle = document.createElement('p');
  govSubtitle.className = 'gd-card-subtitle';
  govSubtitle.textContent =
    'Authoritative server-side audit trail tracking the request lifecycle and reviewer decisions.';

  govHeader.appendChild(govTitle);
  govHeader.appendChild(govSubtitle);
  govCard.appendChild(govHeader);

  const govGrid = document.createElement('div');
  govGrid.className = 'gd-detail-grid';

  govGrid.appendChild(createGridItem('Canonical Request ID', req.id));
  govGrid.appendChild(createGridItem('Current Status', req.status || ApprovalStatus.PENDING));
  govGrid.appendChild(createGridItem('Initiated At', formatTimestamp(req.createdAt)));
  govGrid.appendChild(
    createGridItem('Expires At', req.expiresAt ? formatTimestamp(req.expiresAt) : 'No expiration deadline')
  );

  if (req.resolvedAt) {
    govGrid.appendChild(createGridItem('Resolved At', formatTimestamp(req.resolvedAt)));
  } else if (req.status === ApprovalStatus.PENDING) {
    govGrid.appendChild(createGridItem('Resolved At', 'Pending review'));
  }

  govCard.appendChild(govGrid);

  // Decision details (if present)
  if (req.decision) {
    const decisionBox = document.createElement('div');
    decisionBox.className = 'gd-resolved-details-box';

    const dTitle = document.createElement('strong');
    dTitle.className = 'gd-resolved-details-title';
    dTitle.textContent = `Reviewer Verdict: ${req.decision.decision}`;

    const dGrid = document.createElement('div');
    dGrid.className = 'gd-detail-grid';
    dGrid.style.marginTop = '8px';

    dGrid.appendChild(createGridItem('Decided By', req.decision.decidedBy || 'Trusted Contact'));
    dGrid.appendChild(createGridItem('Decided At', formatTimestamp(req.decision.decidedAt)));
    dGrid.appendChild(
      createGridItem('Reviewer Note', req.decision.decisionReason || 'None provided')
    );

    decisionBox.appendChild(dTitle);
    decisionBox.appendChild(dGrid);
    govCard.appendChild(decisionBox);
  }

  // Cancellation details (if present)
  if (req.cancellationReason) {
    const cancelBox = document.createElement('div');
    cancelBox.className = 'gd-resolved-details-box';

    const cTitle = document.createElement('strong');
    cTitle.className = 'gd-resolved-details-title';
    cTitle.textContent = 'Cancellation Record';

    const cDesc = document.createElement('p');
    cDesc.className = 'gd-detail-value';
    cDesc.style.marginTop = '4px';
    cDesc.textContent = req.cancellationReason;

    cancelBox.appendChild(cTitle);
    cancelBox.appendChild(cDesc);
    govCard.appendChild(cancelBox);
  }

  container.appendChild(govCard);

  // 9. Decoupling & Decision Notice (Preserving selectors expected by existing test suite)
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
  container.appendChild(notice);

  return container;
}
