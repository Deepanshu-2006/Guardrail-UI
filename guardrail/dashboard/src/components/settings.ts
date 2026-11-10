/**
 * Guardrail Trusted-Contact Dashboard - Settings Component
 *
 * Renders the account profile, authorized ward relationships, backend connection
 * parameters, environment indicators, safety governance invariants, and session management.
 * Strictly avoids exposing information belonging to other users or hardcoding fake data.
 */

import {
  PolicyAuditRecord,
  TrustedContact,
  TrustedContactInvitation,
  TrustedContactPolicySummary,
  TrustedContactProfile,
  ViewStatus,
} from '../types.js';
import { renderRelationshipManagementSection } from './relationships.js';

export interface SettingsProps {
  profile: TrustedContactProfile | null;
  environment?: string;
  isMockService?: boolean;
  backendOrigin?: string;
  pollIntervalMs?: number;
  lastSynchronizedAt?: Date | null;
  isBackendUnavailable?: boolean;
  connectedUsers?: readonly TrustedContact[];
  connectedUsersStatus?: ViewStatus;
  connectedUsersError?: string | null;
  invitations?: readonly TrustedContactInvitation[];
  invitationsStatus?: ViewStatus;
  invitationsError?: string | null;
  wardPolicySummary?: TrustedContactPolicySummary | null;
  wardPolicyStatus?: ViewStatus;
  wardPolicyError?: string | null;
  wardPolicyAuditHistory?: readonly PolicyAuditRecord[] | null;
  wardPolicyAuditStatus?: ViewStatus;
  wardPolicyAuditError?: string | null;
  hasPendingSync?: boolean;
  pendingSyncChanges?: readonly string[];
  isSubmittingRelationshipAction?: boolean;
  relationshipActionMessage?: { type: 'success' | 'error' | 'info'; text: string } | null;
  onCreateInvitation?: (payload: {
    recipientActorId: string;
    relationshipLabel?: string;
    ttlMs?: number;
  }) => Promise<{ success: boolean; invitation?: TrustedContactInvitation; error?: string }>;
  onRevokeInvitation?: (invitationId: string) => Promise<{ success: boolean; error?: string }>;
  onRevokeTrustedContact?: (contactId: string) => Promise<{ success: boolean; error?: string }>;
  onConnectInvitation?: (code: string) => Promise<{ success: boolean; wardId?: string; error?: string }>;
  onDisconnectWard?: () => void;
  onClearSession?: () => void;
  onRefresh?: () => void;
}

export function renderSettings(props: SettingsProps): HTMLElement {
  const section = document.createElement('section');
  section.id = 'view-settings';
  section.className = 'gd-view-section';
  section.setAttribute('aria-labelledby', 'settings-title');

  // Header
  const header = document.createElement('header');
  header.className = 'gd-section-header';

  const title = document.createElement('h1');
  title.id = 'settings-title';
  title.className = 'gd-section-title';
  title.textContent = 'Settings';

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-section-subtitle';
  subtitle.textContent =
    'Manage your trusted contact profile, connected wards, and security preferences.';

  header.appendChild(title);
  header.appendChild(subtitle);
  section.appendChild(header);

  // Card 1: Reviewer Identity & Authorization Hierarchy
  const identityCard = document.createElement('div');
  identityCard.className = 'gd-card gd-settings-card';

  const idHeader = document.createElement('div');
  idHeader.className = 'gd-settings-card-header';

  const idTitle = document.createElement('h2');
  idTitle.className = 'gd-section-title';
  idTitle.textContent = 'Reviewer Identity & Authorization';

  const idBadge = document.createElement('span');
  idBadge.className = props.profile?.isAuthenticated
    ? 'gd-settings-badge gd-badge-active'
    : 'gd-settings-badge gd-badge-neutral';
  idBadge.textContent = props.profile?.isAuthenticated ? 'Authenticated Session' : 'Standalone Preview';

  idHeader.appendChild(idTitle);
  idHeader.appendChild(idBadge);
  identityCard.appendChild(idHeader);

  const idGrid = document.createElement('div');
  idGrid.className = 'gd-settings-grid';

  const addItem = (label: string, value: string, isMono: boolean = false, badgeText?: string) => {
    const item = document.createElement('div');
    item.className = 'gd-settings-item';

    const lbl = document.createElement('span');
    lbl.className = 'gd-settings-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className = `gd-settings-value ${isMono ? 'gd-mono' : ''}`;
    val.textContent = value;

    item.appendChild(lbl);
    item.appendChild(val);

    if (badgeText) {
      const b = document.createElement('span');
      b.className = 'gd-settings-subbadge';
      b.textContent = badgeText;
      item.appendChild(b);
    }

    idGrid.appendChild(item);
  };

  addItem('Canonical Actor ID', props.profile?.actorId ?? 'Not Authenticated', true);
  addItem('Authorization Role', String(props.profile?.role ?? 'Standalone Reviewer'), false);
  addItem(
    'Assigned Ward ID',
    props.profile?.assignedWardId ?? 'No ward assigned',
    Boolean(props.profile?.assignedWardId),
    props.profile?.assignedWardId ? 'Authorized Scope' : 'Unlinked'
  );
  addItem(
    'Relationship Label',
    props.profile?.relationshipLabel ?? 'Designated Trusted Contact'
  );

  identityCard.appendChild(idGrid);

  const tenantNotice = document.createElement('p');
  tenantNotice.className = 'gd-settings-notice';
  tenantNotice.textContent =
    'Scoped to your designated ward. Other accounts and browser sessions are strictly isolated.';
  identityCard.appendChild(tenantNotice);

  section.appendChild(identityCard);

  // Card 2: Trusted Contacts & Connected Users Lifecycle Management
  const relationshipsSection = renderRelationshipManagementSection({
    profile: props.profile,
    connectedUsers: props.connectedUsers ?? [],
    connectedUsersStatus: props.connectedUsersStatus ?? 'idle',
    connectedUsersError: props.connectedUsersError ?? null,
    invitations: props.invitations ?? [],
    invitationsStatus: props.invitationsStatus ?? 'idle',
    invitationsError: props.invitationsError ?? null,
    isSubmitting: props.isSubmittingRelationshipAction,
    actionMessage: props.relationshipActionMessage,
    isBackendUnavailable: props.isBackendUnavailable,
    onCreateInvitation: props.onCreateInvitation,
    onRevokeInvitation: props.onRevokeInvitation,
    onRevokeTrustedContact: props.onRevokeTrustedContact,
    onConnectInvitation: props.onConnectInvitation,
    onDisconnectWard: props.onDisconnectWard,
    onRefresh: props.onRefresh,
  });
  section.appendChild(relationshipsSection);

  // Card 2b: Assigned Ward Protection Policy & Invariants
  if (props.profile?.assignedWardId) {
    const policyCard = document.createElement('div');
    policyCard.className = 'gd-card gd-settings-card';
    policyCard.id = 'gd-card-ward-policy';

    const pHeader = document.createElement('div');
    pHeader.className = 'gd-settings-card-header';

    const pTitle = document.createElement('h2');
    pTitle.className = 'gd-section-title';
    pTitle.textContent = 'Ward Protection Policy & Invariants';

    const pBadge = document.createElement('span');
    if (props.isBackendUnavailable) {
      pBadge.className = 'gd-settings-badge gd-badge-danger';
      pBadge.textContent = 'Sync Offline';
    } else if (props.hasPendingSync || props.wardPolicyStatus === ('pending_sync' as any)) {
      pBadge.className = 'gd-settings-badge gd-badge-warning';
      pBadge.textContent = 'Pending Sync';
    } else if (props.wardPolicyStatus === 'loading') {
      pBadge.className = 'gd-settings-badge gd-badge-neutral';
      pBadge.textContent = 'Syncing...';
    } else if (props.wardPolicySummary) {
      pBadge.className =
        props.wardPolicySummary.overallStatus === 'ACTIVE'
          ? 'gd-settings-badge gd-badge-active'
          : 'gd-settings-badge gd-badge-warning';
      pBadge.textContent =
        props.wardPolicySummary.overallStatus === 'ACTIVE'
          ? 'Synchronized (Active)'
          : 'Degraded';
    } else if (props.wardPolicyStatus === 'error') {
      pBadge.className = 'gd-settings-badge gd-badge-danger';
      pBadge.textContent = 'Sync Error';
    } else {
      pBadge.className = 'gd-settings-badge gd-badge-neutral';
      pBadge.textContent = 'Awaiting Sync';
    }

    pHeader.appendChild(pTitle);
    pHeader.appendChild(pBadge);
    policyCard.appendChild(pHeader);

    const pGrid = document.createElement('div');
    pGrid.className = 'gd-settings-grid';

    const addPolicyItem = (label: string, value: string, isMono = false, sub = '') => {
      const item = document.createElement('div');
      item.className = 'gd-settings-item';
      const lbl = document.createElement('span');
      lbl.className = 'gd-settings-label';
      lbl.textContent = label;
      const val = document.createElement('span');
      val.className = `gd-settings-value ${isMono ? 'gd-mono' : ''}`;
      val.textContent = value;
      item.appendChild(lbl);
      item.appendChild(val);
      if (sub) {
        const s = document.createElement('span');
        s.className = 'gd-settings-subbadge';
        s.textContent = sub;
        item.appendChild(s);
      }
      pGrid.appendChild(item);
    };

    const summary = props.wardPolicySummary;
    addPolicyItem('Governed Ward', props.profile.assignedWardId, true, 'Sovereign Owner');
    addPolicyItem(
      'Sensitivity Preset',
      summary ? summary.sensitivityPreset.toUpperCase() : 'BALANCED',
      false,
      'Validated Thresholds'
    );
    addPolicyItem('Policy Version', summary ? summary.policyVersion : '1.0.0', true);
    addPolicyItem('Schema Version', summary ? summary.schemaVersion : '1.0.0', true);
    addPolicyItem(
      'Staging Mode',
      summary ? (summary.stagingModeEnabled ? 'Enabled' : 'Disabled') : 'Enabled',
      false,
      'Mandatory Holding'
    );
    addPolicyItem(
      'Last Policy Sync',
      summary?.updatedAt ? new Date(summary.updatedAt).toLocaleTimeString() : 'Default Recommendations'
    );

    policyCard.appendChild(pGrid);

    // Categories Breakdown
    const catHeader = document.createElement('h3');
    catHeader.className = 'gd-settings-subtitle';
    catHeader.textContent = 'Protection Category Enforcement';
    catHeader.style.marginTop = '1rem';
    policyCard.appendChild(catHeader);

    const catList = document.createElement('ul');
    catList.className = 'gd-settings-invariants-list';

    const addCatItem = (titleText: string, decision: string, isLocked: boolean) => {
      const li = document.createElement('li');
      li.className = 'gd-settings-invariant-item';
      const strong = document.createElement('strong');
      strong.textContent = titleText + ': ';
      const span = document.createElement('span');
      span.textContent = `${decision} ${isLocked ? '(Permanently Locked Invariant)' : '(Configured by Ward)'}`;
      li.appendChild(strong);
      li.appendChild(span);
      catList.appendChild(li);
    };

    addCatItem('Destructive Actions', summary?.categoryProtections?.destructiveActions ?? 'PROTECT', true);
    addCatItem('Boundary Guards', summary?.categoryProtections?.boundaryGuards ?? 'PROTECT', true);
    addCatItem('Payment Actions', summary?.categoryProtections?.paymentActions ?? 'PROTECT', false);
    addCatItem('Sensitive Data Input', summary?.categoryProtections?.sensitiveData ?? 'WARN', false);
    addCatItem('External Navigation', summary?.categoryProtections?.externalNavigation ?? 'WARN', false);

    policyCard.appendChild(catList);

    if (props.hasPendingSync) {
      const pendingBanner = document.createElement('div');
      pendingBanner.className = 'gd-pending-sync-banner';
      pendingBanner.id = 'gd-ward-pending-sync-banner';
      pendingBanner.setAttribute('role', 'status');

      const pStrong = document.createElement('strong');
      pStrong.textContent = 'Configuration Changes Pending Synchronization:';
      pendingBanner.appendChild(pStrong);

      if (props.pendingSyncChanges && props.pendingSyncChanges.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'gd-pending-sync-list';
        for (const ch of props.pendingSyncChanges) {
          const li = document.createElement('li');
          li.textContent = ch;
          ul.appendChild(li);
        }
        pendingBanner.appendChild(ul);
      }

      const pNotice = document.createElement('p');
      pNotice.className = 'gd-pending-sync-subtext';
      pNotice.textContent = 'Modifications are staged in local browser storage and awaiting remote backend synchronization.';
      pendingBanner.appendChild(pNotice);

      policyCard.appendChild(pendingBanner);
    }

    const notice = document.createElement('p');
    notice.className = 'gd-settings-notice';
    notice.textContent =
      'Ward Sovereignty Notice: Protection policies, thresholds, and exempt domains are configured exclusively by the protected user through their browser extension. Trusted contacts hold zero authority to alter or weaken ward policies. Private allowlists are strictly redacted.';
    policyCard.appendChild(notice);

    section.appendChild(policyCard);

    // Card 2c: Protection Policy History & Transparency
    const historyCard = document.createElement('div');
    historyCard.className = 'gd-card gd-settings-card';
    historyCard.id = 'gd-card-policy-history';

    const hHeader = document.createElement('div');
    hHeader.className = 'gd-settings-card-header';

    const hTitle = document.createElement('h2');
    hTitle.className = 'gd-section-title';
    hTitle.textContent = 'Protection Policy History & Transparency';

    const hBadge = document.createElement('span');
    hBadge.className = 'gd-settings-badge gd-badge-neutral';
    hBadge.textContent = 'Durable Audit Trail';
    hHeader.appendChild(hTitle);
    hHeader.appendChild(hBadge);
    historyCard.appendChild(hHeader);

    const hSub = document.createElement('p');
    hSub.className = 'gd-section-subtitle';
    hSub.textContent = 'Non-sensitive audit log of policy modifications, responsible actors, version progression, and practical security impact.';
    historyCard.appendChild(hSub);

    if (props.wardPolicyAuditStatus === 'loading') {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'gd-settings-loading';
      loadingEl.textContent = 'Loading policy change history...';
      historyCard.appendChild(loadingEl);
    } else if (props.wardPolicyAuditStatus === 'error') {
      const errEl = document.createElement('div');
      errEl.className = 'gd-settings-error-banner';
      errEl.textContent = props.wardPolicyAuditError || 'Unable to retrieve policy change history.';
      historyCard.appendChild(errEl);
    } else if (!props.wardPolicyAuditHistory || props.wardPolicyAuditHistory.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'gd-settings-notice gd-settings-empty';
      emptyEl.textContent = 'No historical policy modifications recorded yet. The system is operating on initial default safety protections.';
      historyCard.appendChild(emptyEl);
    } else {
      const auditList = document.createElement('div');
      auditList.className = 'gd-policy-audit-timeline';

      for (const record of props.wardPolicyAuditHistory) {
        const item = document.createElement('div');
        item.className = 'gd-policy-audit-item';

        const topRow = document.createElement('div');
        topRow.className = 'gd-policy-audit-top';

        const versionBadge = document.createElement('span');
        versionBadge.className = 'gd-policy-version-pill';
        versionBadge.textContent = record.previousPolicyVersion && record.previousPolicyVersion !== '0.0.0'
          ? `v${record.previousPolicyVersion} \u2192 v${record.newPolicyVersion}`
          : `Initial v${record.newPolicyVersion}`;
        topRow.appendChild(versionBadge);

        const sourceBadge = document.createElement('span');
        const isSys = record.isSystemDefault || record.changeSource === 'SYSTEM_DEFAULT' || record.changeSource === 'SYSTEM_RESET';
        sourceBadge.className = `gd-settings-badge ${isSys ? 'gd-badge-neutral' : 'gd-badge-active'}`;
        sourceBadge.textContent = record.changeSource === 'SYSTEM_RESET'
          ? 'System Reset'
          : isSys
          ? 'System Default'
          : 'User Customization';
        topRow.appendChild(sourceBadge);

        const timeSpan = document.createElement('time');
        timeSpan.className = 'gd-policy-audit-time';
        timeSpan.dateTime = record.timestamp;
        timeSpan.title = record.timestamp;
        timeSpan.textContent = new Date(record.timestamp).toLocaleString();
        topRow.appendChild(timeSpan);

        item.appendChild(topRow);

        const actorRow = document.createElement('div');
        actorRow.className = 'gd-policy-audit-actor';
        const actorStrong = document.createElement('strong');
        actorStrong.textContent = 'Responsible Actor: ';
        const actorVal = document.createElement('span');
        actorVal.className = 'gd-mono';
        actorVal.textContent = `${record.updatedBy} (${record.actorRole || 'USER'})`;
        actorRow.appendChild(actorStrong);
        actorRow.appendChild(actorVal);
        item.appendChild(actorRow);

        if (record.changeSummary) {
          const summaryRow = document.createElement('div');
          summaryRow.className = 'gd-policy-audit-summary';
          summaryRow.textContent = record.changeSummary;
          item.appendChild(summaryRow);
        }

        if (record.impactSummary) {
          const impactBox = document.createElement('div');
          impactBox.className = 'gd-policy-impact-box';
          const impactTitle = document.createElement('strong');
          impactTitle.textContent = 'Practical Security Impact: ';
          const impactText = document.createElement('span');
          impactText.textContent = record.impactSummary;
          impactBox.appendChild(impactTitle);
          impactBox.appendChild(impactText);
          item.appendChild(impactBox);
        }

        auditList.appendChild(item);
      }

      historyCard.appendChild(auditList);
    }

    const auditPrivacyNotice = document.createElement('p');
    auditPrivacyNotice.className = 'gd-settings-notice';
    auditPrivacyNotice.textContent =
      'Privacy-Preserving Audit Guarantee: Audit records contain strictly non-sensitive configuration metadata (timestamps, version progression, actor role, and field names). Credentials, form entries, card numbers, OTPs, and private URLs are never recorded.';
    historyCard.appendChild(auditPrivacyNotice);

    section.appendChild(historyCard);
  }

  // Card 3: Backend Connection & Runtime Environment
  const backendCard = document.createElement('div');
  backendCard.className = 'gd-card gd-settings-card';

  const backendHeader = document.createElement('div');
  backendHeader.className = 'gd-settings-card-header';

  const backendTitle = document.createElement('h2');
  backendTitle.className = 'gd-section-title';
  backendTitle.textContent = 'Backend Connection & Synchronization';

  const connBadge = document.createElement('span');
  if (props.isBackendUnavailable) {
    connBadge.className = 'gd-settings-badge gd-badge-danger';
    connBadge.textContent = 'Connection Offline';
  } else if (props.isMockService) {
    connBadge.className = 'gd-settings-badge gd-badge-warning';
    connBadge.textContent = 'Mock Fixture';
  } else {
    connBadge.className = 'gd-settings-badge gd-badge-active';
    connBadge.textContent = 'Connected (Live)';
  }

  backendHeader.appendChild(backendTitle);
  backendHeader.appendChild(connBadge);
  backendCard.appendChild(backendHeader);

  const backendGrid = document.createElement('div');
  backendGrid.className = 'gd-settings-grid';

  const formatLastSync = (date?: Date | null): string => {
    if (!date) return 'Not synchronized yet';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const originVal =
    props.backendOrigin ||
    (typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://127.0.0.1:3000');

  const addBackendItem = (label: string, value: string, isMono: boolean = false) => {
    const item = document.createElement('div');
    item.className = 'gd-settings-item';

    const lbl = document.createElement('span');
    lbl.className = 'gd-settings-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className = `gd-settings-value ${isMono ? 'gd-mono' : ''}`;
    val.textContent = value;

    item.appendChild(lbl);
    item.appendChild(val);
    backendGrid.appendChild(item);
  };

  addBackendItem('API Endpoint', originVal, true);
  addBackendItem('Deployment Environment', (props.environment ?? 'development').toUpperCase());
  addBackendItem('Architecture', props.isMockService ? 'Development Fixture' : 'Pilot Backend');
  addBackendItem('Polling Cadence', `${(props.pollIntervalMs ?? 10000) / 1000}s interval (auto-pauses in background)`);
  addBackendItem('Last Synchronized', formatLastSync(props.lastSynchronizedAt));

  backendCard.appendChild(backendGrid);

  if (props.onRefresh) {
    const refreshRow = document.createElement('div');
    refreshRow.className = 'gd-settings-action-row';

    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.className = 'gd-btn-refresh';
    syncBtn.innerHTML = `
      <svg class="gd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
      </svg>
      <span>Test Connection & Sync Now</span>
    `;
    syncBtn.addEventListener('click', () => {
      props.onRefresh?.();
    });

    refreshRow.appendChild(syncBtn);
    backendCard.appendChild(refreshRow);
  }

  section.appendChild(backendCard);

  // Card 3: Safety & Governance Architecture Invariants
  const invariantsCard = document.createElement('div');
  invariantsCard.className = 'gd-card gd-settings-card';

  const invTitle = document.createElement('h2');
  invTitle.className = 'gd-section-title';
  invTitle.textContent = 'Safety Invariants & Zero-Trust Guarantees';
  invariantsCard.appendChild(invTitle);

  const invList = document.createElement('ul');
  invList.className = 'gd-settings-invariants-list';

  const addInvariant = (titleText: string, bodyText: string) => {
    const li = document.createElement('li');
    li.className = 'gd-settings-invariant-item';

    const strong = document.createElement('strong');
    strong.textContent = titleText + ': ';

    const span = document.createElement('span');
    span.textContent = bodyText;

    li.appendChild(strong);
    li.appendChild(span);
    invList.appendChild(li);
  };

  addInvariant(
    'Decoupled Action Execution',
    'Approving records server consent, but never automatically executes actions in the browser.'
  );
  addInvariant(
    'Strict Multi-Tenant Boundary',
    'Access is authenticated and restricted solely to your assigned ward.'
  );
  addInvariant(
    'Zero-Trust Data Scrubbing',
    'Credentials, payment cards, and authentication tokens are scrubbed before reaching this dashboard.'
  );
  addInvariant(
    'Ward Policy Authority Separation',
    'Protection policies are set by the protected user; trusted contacts cannot alter security rules.'
  );

  invariantsCard.appendChild(invList);
  section.appendChild(invariantsCard);

  // Card 4: Session Management
  const sessionCard = document.createElement('div');
  sessionCard.className = 'gd-card gd-settings-card';

  const sessTitle = document.createElement('h2');
  sessTitle.className = 'gd-section-title';
  sessTitle.textContent = 'Session Management';

  const sessDesc = document.createElement('p');
  sessDesc.className = 'gd-settings-desc';
  sessDesc.textContent =
    'Sign out or disconnect this browser from your current profile.';

  const sessActions = document.createElement('div');
  sessActions.className = 'gd-settings-action-row';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'gd-btn-clear-session';
  clearBtn.id = 'gd-btn-clear-session';
  clearBtn.textContent = 'Clear Session / Sign Out';
  clearBtn.addEventListener('click', () => {
    props.onClearSession?.();
  });

  sessActions.appendChild(clearBtn);
  sessionCard.appendChild(sessTitle);
  sessionCard.appendChild(sessDesc);
  sessionCard.appendChild(sessActions);
  section.appendChild(sessionCard);

  return section;
}
