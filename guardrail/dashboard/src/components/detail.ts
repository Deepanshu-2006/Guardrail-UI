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
  /** Whether an approval decision is actively being submitted to the backend */
  isSubmittingDecision?: boolean;
  /** Error message resulting from a failed decision attempt */
  decisionErrorMessage?: string | null;
  /** Success message resulting from a confirmed decision attempt */
  decisionSuccessMessage?: string | null;
  /** Callback invoked when the user confirms their decision */
  onDecisionSubmit?: (decision: 'APPROVED' | 'REJECTED', reason?: string) => void | Promise<unknown>;
  /** Whether backend service is confirmed unreachable or in error */
  isBackendUnavailable?: boolean;
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
 * Evaluates whether an approval request has expired based on its expiresAt timestamp.
 */
export function isRequestExpired(request?: ApprovalRequest | null): boolean {
  if (!request) return false;
  if (request.status === ApprovalStatus.EXPIRED) return true;
  if (!request.expiresAt || typeof request.expiresAt !== 'string') return false;
  const expTime = new Date(request.expiresAt).getTime();
  if (isNaN(expTime)) return false;
  return expTime <= Date.now();
}

/**
 * Returns a human-friendly expiration description (e.g. "Expired 5m ago" or "Expires in 12m (10:15:00 AM)").
 */
export function formatExpirationInfo(isoString?: string | null): { text: string; isPast: boolean } {
  if (!isoString || typeof isoString !== 'string' || !isoString.trim()) {
    return { text: 'No expiration deadline', isPast: false };
  }
  try {
    const expTime = new Date(isoString).getTime();
    if (isNaN(expTime)) {
      return { text: isoString, isPast: false };
    }
    const now = Date.now();
    const diffMs = expTime - now;
    const formattedDate = formatTimestamp(isoString);

    if (diffMs <= 0) {
      const elapsedMins = Math.max(1, Math.floor(Math.abs(diffMs) / 60000));
      return {
        text: `Expired ${elapsedMins > 60 ? Math.floor(elapsedMins / 60) + 'h ago' : elapsedMins + 'm ago'} (${formattedDate})`,
        isPast: true,
      };
    } else {
      const remainingMins = Math.floor(diffMs / 60000);
      if (remainingMins < 60) {
        return {
          text: `Expires in ${Math.max(1, remainingMins)}m (${formattedDate})`,
          isPast: false,
        };
      } else {
        const remainingHours = Math.floor(remainingMins / 60);
        return {
          text: `Expires in ~${remainingHours}h (${formattedDate})`,
          isPast: false,
        };
      }
    }
  } catch {
    return { text: isoString, isPast: false };
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
  const expired = isRequestExpired(request);
  const status = request.status || ApprovalStatus.PENDING;
  const banner = document.createElement('div');
  const statusClass = (expired && status === ApprovalStatus.PENDING ? 'expired' : status).toLowerCase();
  banner.className = `gd-status-banner ${statusClass}`;
  banner.setAttribute('role', 'status');

  const content = document.createElement('div');
  content.className = 'gd-status-banner-content';

  const titleEl = document.createElement('strong');
  titleEl.className = 'gd-status-banner-title';

  const descEl = document.createElement('p');
  descEl.className = 'gd-status-banner-desc';

  if (status === ApprovalStatus.PENDING && expired) {
    titleEl.textContent = '⏱️ Review Deadline Elapsed';
    descEl.textContent =
      'The expiration deadline for this approval request has passed. Decisions can no longer be recorded. The extension will revalidate the local action state and require a fresh request if needed.';
  } else {
    switch (status) {
      case ApprovalStatus.PENDING:
        titleEl.textContent = '⏳ Awaiting Review';
        descEl.textContent =
          'The server records this approval request as pending. This dashboard cannot verify the action’s current state in the ward’s browser. The extension must validate the local action before any continuation.';
        break;

    case ApprovalStatus.APPROVED:
      titleEl.textContent = '✅ Approved by Trusted Contact';
      if (request.decision) {
        const decidedBy = request.decision.decidedBy || 'Authorized reviewer';
        const decidedAt = formatTimestamp(request.decision.decidedAt || request.resolvedAt);
        descEl.textContent = `Approved by ${decidedBy} on ${decidedAt}. Approval does not run the action. The extension must revalidate it locally and ask the user to confirm before any supported continuation.`;
      } else {
        descEl.textContent =
          'Reviewer approval is recorded on the server. Approval does not run the action; the extension must revalidate it locally and require user confirmation before any supported continuation.';
      }
      break;

    case ApprovalStatus.REJECTED:
      titleEl.textContent = '❌ Rejected by Trusted Contact';
      if (request.decision) {
        const decidedBy = request.decision.decidedBy || 'Authorized reviewer';
        const decidedAt = formatTimestamp(request.decision.decidedAt || request.resolvedAt);
        descEl.textContent = `Rejected by ${decidedBy} on ${decidedAt}. This request does not authorize continuation. The dashboard cannot verify the action’s current browser state.`;
      } else {
        descEl.textContent =
          'This request was rejected by an authorized trusted contact and does not authorize continuation. The dashboard cannot verify the action’s current browser state.';
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
        'The server marked this request expired. This approval cannot authorize continuation; the extension must check the current action and require a fresh review if applicable.';
      break;

    case 'UNAVAILABLE':
      titleEl.textContent = '⚠️ Status Unavailable';
      descEl.textContent =
        'The current status of this approval request could not be verified by the backend. It may have been removed or the service is temporarily unreachable.';
      break;

    case 'FAILED':
      titleEl.textContent = '⚠️ Evaluation Failed';
      descEl.textContent =
        'The approval request encountered a processing or authorization failure and cannot proceed.';
      break;

    default:
      titleEl.textContent = `Status: ${status}`;
      descEl.textContent = 'This request is in an authoritative server-recorded state.';
      break;
    }
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

  const isExpired = isRequestExpired(req);
  const displayStatus = isExpired && req.status === ApprovalStatus.PENDING ? ApprovalStatus.EXPIRED : (req.status || ApprovalStatus.PENDING);
  const statusPill = document.createElement('span');
  const statusClass = displayStatus.toLowerCase();
  statusPill.className = `gd-detail-status-pill ${statusClass}`;
  statusPill.setAttribute('role', 'status');
  statusPill.setAttribute('data-status', statusClass);
  statusPill.textContent = displayStatus;

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
    'Details linked to this approval request. The dashboard cannot inspect the ward’s current tab or verify that an interaction remains held.';

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
    'Approval decisions update this server record only. They do not execute or trigger an action in the ward’s browser. The extension must revalidate its local action state and require explicit user confirmation before any supported continuation.';

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
  govGrid.appendChild(createGridItem('Current Status', displayStatus));
  govGrid.appendChild(createGridItem('Initiated At', formatTimestamp(req.createdAt)));
  const expInfo = formatExpirationInfo(req.expiresAt);
  govGrid.appendChild(
    createGridItem('Expires At', expInfo.text, expInfo.isPast ? 'gd-expired-text' : undefined)
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

  notice.appendChild(noticeText);
  container.appendChild(notice);

  // 10. Section E: Decision Controls (Connected to backend decision operations)
  const decisionCard = document.createElement('section');
  decisionCard.className = 'gd-detail-card gd-decision-actions-card';
  decisionCard.setAttribute('aria-labelledby', 'detail-decision-heading');

  const dCardHeader = document.createElement('div');
  dCardHeader.className = 'gd-card-header';

  const dCardTitle = document.createElement('h3');
  dCardTitle.id = 'detail-decision-heading';
  dCardTitle.className = 'gd-card-title';
  dCardTitle.textContent = 'Reviewer Decision';

  const dCardSubtitle = document.createElement('p');
  dCardSubtitle.className = 'gd-card-subtitle';
  dCardSubtitle.textContent =
    'Record an authoritative approval or rejection decision. Decisions are immutable once committed to the server.';

  dCardHeader.appendChild(dCardTitle);
  dCardHeader.appendChild(dCardSubtitle);
  decisionCard.appendChild(dCardHeader);

  // Decision Error Banner
  if (props.decisionErrorMessage) {
    const dErrBanner = document.createElement('div');
    dErrBanner.className = 'gd-decision-error-banner';
    dErrBanner.setAttribute('role', 'alert');

    const dErrIcon = document.createElement('span');
    dErrIcon.className = 'gd-error-icon';
    dErrIcon.setAttribute('aria-hidden', 'true');
    dErrIcon.textContent = '⚠️';

    const dErrText = document.createElement('span');
    dErrText.className = 'gd-decision-error-text';
    dErrText.textContent = props.decisionErrorMessage;

    dErrBanner.appendChild(dErrIcon);
    dErrBanner.appendChild(dErrText);
    decisionCard.appendChild(dErrBanner);
  }

  // Decision Success Banner
  if (props.decisionSuccessMessage) {
    const dSuccBanner = document.createElement('div');
    dSuccBanner.className = 'gd-decision-success-banner';
    dSuccBanner.setAttribute('role', 'status');

    const dSuccIcon = document.createElement('span');
    dSuccIcon.className = 'gd-success-icon';
    dSuccIcon.setAttribute('aria-hidden', 'true');
    dSuccIcon.textContent = '✅';

    const dSuccText = document.createElement('span');
    dSuccText.className = 'gd-decision-success-text';
    dSuccText.textContent = props.decisionSuccessMessage;

    dSuccBanner.appendChild(dSuccIcon);
    dSuccBanner.appendChild(dSuccText);
    decisionCard.appendChild(dSuccBanner);
  }

  // Lifecycle check: Decisions are allowed ONLY when request is PENDING
  if (req.status !== ApprovalStatus.PENDING) {
    const resolvedNotice = document.createElement('div');
    const isExpiredNotice = req.status === ApprovalStatus.EXPIRED;
    resolvedNotice.className = `gd-decision-resolved-notice ${isExpiredNotice ? 'expired-notice' : ''}`;
    resolvedNotice.setAttribute('role', 'note');

    const p = document.createElement('p');
    if (isExpiredNotice) {
      p.textContent = 'This request has expired and is no longer eligible for decisions. The review deadline has elapsed.';
    } else {
      const statusLabel = (req.status || 'resolved').toLowerCase();
      p.textContent = `This request has already been ${statusLabel} and is no longer eligible for decisions.`;
    }
    resolvedNotice.appendChild(p);

    if (props.onRefresh) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'gd-btn-retry';
      retryBtn.style.marginTop = '10px';
      retryBtn.textContent = 'Refresh Status from Server';
      retryBtn.addEventListener('click', () => props.onRefresh?.());
      resolvedNotice.appendChild(retryBtn);
    }

    decisionCard.appendChild(resolvedNotice);
    container.appendChild(decisionCard);
    return container;
  }

  // Backend Unavailable Notice (Task 3 & 5)
  if (props.isBackendUnavailable) {
    const unavailNotice = document.createElement('div');
    unavailNotice.className = 'gd-decision-error-banner gd-backend-offline-banner';
    unavailNotice.setAttribute('role', 'alert');

    const unavailIcon = document.createElement('span');
    unavailIcon.className = 'gd-error-icon';
    unavailIcon.setAttribute('aria-hidden', 'true');
    unavailIcon.textContent = '⚠️';

    const unavailText = document.createElement('span');
    unavailText.className = 'gd-decision-error-text';
    unavailText.textContent =
      'Backend Unavailable: Decisions cannot be committed while the approval service is unreachable. Please verify network connectivity and retry.';

    unavailNotice.appendChild(unavailIcon);
    unavailNotice.appendChild(unavailText);
    decisionCard.appendChild(unavailNotice);
  }

  // Interactive Decision Submission Flow (Two-Step Deliberate Confirmation)
  const decisionControlsContainer = document.createElement('div');
  decisionControlsContainer.className = 'gd-decision-controls-container';
  decisionCard.appendChild(decisionControlsContainer);

  let activeConfirmation: 'APPROVED' | 'REJECTED' | null = null;

  const updateDecisionControls = () => {
    while (decisionControlsContainer.firstChild) {
      decisionControlsContainer.removeChild(decisionControlsContainer.firstChild);
    }

    if (!activeConfirmation) {
      // Step 1: Initial Action Choice Row
      const actionsRow = document.createElement('div');
      actionsRow.className = 'gd-decision-actions-row';

      const approveBtn = document.createElement('button');
      approveBtn.type = 'button';
      approveBtn.className = 'gd-btn-decision gd-btn-approve';
      approveBtn.textContent = 'Approve Action';
      if (props.isSubmittingDecision || props.isBackendUnavailable) {
        approveBtn.disabled = true;
        if (props.isBackendUnavailable) {
          approveBtn.title = 'Approval backend is currently unreachable';
        } else {
          approveBtn.setAttribute('aria-busy', 'true');
        }
      }
      approveBtn.addEventListener('click', () => {
        if (props.isSubmittingDecision || props.isBackendUnavailable) return;
        activeConfirmation = 'APPROVED';
        updateDecisionControls();
      });

      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button';
      rejectBtn.className = 'gd-btn-decision gd-btn-reject';
      rejectBtn.textContent = 'Reject Action';
      if (props.isSubmittingDecision || props.isBackendUnavailable) {
        rejectBtn.disabled = true;
        if (props.isBackendUnavailable) {
          rejectBtn.title = 'Approval backend is currently unreachable';
        } else {
          rejectBtn.setAttribute('aria-busy', 'true');
        }
      }
      rejectBtn.addEventListener('click', () => {
        if (props.isSubmittingDecision || props.isBackendUnavailable) return;
        activeConfirmation = 'REJECTED';
        updateDecisionControls();
      });

      actionsRow.appendChild(approveBtn);
      actionsRow.appendChild(rejectBtn);
      decisionControlsContainer.appendChild(actionsRow);
    } else {
      // Step 2: Confirmation Box with High-Impact Warning and Note Input
      const isApprove = activeConfirmation === 'APPROVED';
      const confirmBox = document.createElement('div');
      confirmBox.className = `gd-decision-confirm-box ${isApprove ? 'confirm-approve' : 'confirm-reject'}`;
      confirmBox.setAttribute('role', 'group');
      confirmBox.setAttribute('aria-labelledby', 'gd-decision-confirm-title');

      const confirmTitle = document.createElement('h4');
      confirmTitle.id = 'gd-decision-confirm-title';
      confirmTitle.className = 'gd-confirm-title';
      confirmTitle.setAttribute('tabindex', '-1');
      confirmTitle.textContent = isApprove ? 'Confirm Approval Decision' : 'Confirm Rejection Decision';
      confirmBox.appendChild(confirmTitle);

      // High-Impact Decision Warning for Critical/High Risk
      const isHighImpact =
        req.riskLevel === RiskLevel.CRITICAL ||
        req.riskLevel === RiskLevel.HIGH ||
        (typeof req.riskScore === 'number' && req.riskScore >= 50);

      if (isHighImpact) {
        const warningBox = document.createElement('div');
        warningBox.className = 'gd-high-impact-warning';
        warningBox.setAttribute('role', 'alert');

        const warnIcon = document.createElement('span');
        warnIcon.className = 'gd-warning-icon';
        warnIcon.setAttribute('aria-hidden', 'true');
        warnIcon.textContent = '⚠️';

        const warnContent = document.createElement('div');
        warnContent.className = 'gd-warning-content';

        const warnHeading = document.createElement('strong');
        warnHeading.textContent = `High-Impact Decision Warning (${req.riskLevel || 'High'} Risk)`;

        const warnText = document.createElement('p');
        warnText.textContent = isApprove
          ? 'Approving records reviewer consent for an elevated-risk request. It does not run the action. Verify that you recognize this interaction; the extension must revalidate locally and the user must confirm any supported continuation.'
          : 'Rejecting records that reviewer consent was denied. The dashboard cannot change or verify the action’s current browser state.';

        warnContent.appendChild(warnHeading);
        warnContent.appendChild(warnText);
        warningBox.appendChild(warnIcon);
        warningBox.appendChild(warnContent);
        confirmBox.appendChild(warningBox);
      } else {
        const infoText = document.createElement('p');
        infoText.className = 'gd-confirm-desc';
        infoText.textContent = isApprove
          ? 'This records reviewer consent only. It does not run the action; the extension must revalidate locally and the user must confirm any supported continuation.'
          : 'This records rejection of the request. The dashboard cannot change or verify the action’s current browser state.';
        confirmBox.appendChild(infoText);
      }

      // Reviewer Note Textarea (Optional)
      const noteGroup = document.createElement('div');
      noteGroup.className = 'gd-confirm-note-group';

      const noteLabel = document.createElement('label');
      noteLabel.className = 'gd-detail-label';
      noteLabel.htmlFor = 'decision-reason-input';
      noteLabel.textContent = 'Reviewer Note (Optional)';

      const noteInput = document.createElement('textarea');
      noteInput.id = 'decision-reason-input';
      noteInput.className = 'gd-decision-reason-input';
      noteInput.placeholder = isApprove
        ? 'Optional: Add an audit note (e.g., "Verified with user verbally")...'
        : 'Optional: Add an explanation for the rejection...';
      noteInput.rows = 2;
      if (props.isSubmittingDecision) {
        noteInput.disabled = true;
      }

      noteGroup.appendChild(noteLabel);
      noteGroup.appendChild(noteInput);
      confirmBox.appendChild(noteGroup);

      // Consequential Decision Invariant Notice
      const consequentialNotice = document.createElement('div');
      consequentialNotice.className = 'gd-consequential-notice';
      consequentialNotice.setAttribute('role', 'note');
      const cNoticeText = document.createElement('p');
      cNoticeText.textContent =
        'Consequential Decision Notice: Submitting this decision authoritatively commits it to the Guardrail backend audit log. Decisions are permanent and cannot be reversed or undone.';
      consequentialNotice.appendChild(cNoticeText);
      confirmBox.appendChild(consequentialNotice);

      // Actions Row (Confirm Submit + Cancel)
      const confirmActions = document.createElement('div');
      confirmActions.className = 'gd-confirm-actions-row';

      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = `gd-btn-confirm-submit ${isApprove ? 'gd-btn-approve-confirm' : 'gd-btn-reject-confirm'}`;
      submitBtn.textContent = props.isSubmittingDecision
        ? 'Submitting decision...'
        : `Confirm ${isApprove ? 'Approval' : 'Rejection'}`;

      if (props.isSubmittingDecision) {
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-busy', 'true');
      }

      // Concurrency guard: prevent duplicate clicks while submitting
      let alreadyClicked = false;
      submitBtn.addEventListener('click', () => {
        if (props.isSubmittingDecision || alreadyClicked) return;
        alreadyClicked = true;
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-busy', 'true');
        submitBtn.textContent = 'Submitting decision...';
        const reason = noteInput.value.trim() || undefined;
        void props.onDecisionSubmit?.(activeConfirmation!, reason);
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'gd-btn-cancel-confirm';
      cancelBtn.textContent = 'Cancel';
      if (props.isSubmittingDecision) {
        cancelBtn.disabled = true;
      }
      cancelBtn.addEventListener('click', () => {
        if (props.isSubmittingDecision) return;
        activeConfirmation = null;
        updateDecisionControls();
        const returnButton = decisionControlsContainer.querySelector<HTMLButtonElement>(
          isApprove ? '.gd-btn-approve' : '.gd-btn-reject'
        );
        returnButton?.focus();
      });

      confirmActions.appendChild(submitBtn);
      confirmActions.appendChild(cancelBtn);
      confirmBox.appendChild(confirmActions);

      decisionControlsContainer.appendChild(confirmBox);
      confirmTitle.focus();
    }
  };

  updateDecisionControls();
  container.appendChild(decisionCard);

  return container;
}
