/**
 * Guardrail Trusted-Contact Dashboard - Settings Component
 *
 * Renders the account profile, authorized ward relationships, backend connection
 * parameters, environment indicators, safety governance invariants, and session management.
 * Strictly avoids exposing information belonging to other users or hardcoding fake data.
 */

import { TrustedContactProfile } from '../types.js';

export interface SettingsProps {
  profile: TrustedContactProfile | null;
  environment?: string;
  isMockService?: boolean;
  backendOrigin?: string;
  pollIntervalMs?: number;
  lastSynchronizedAt?: Date | null;
  isBackendUnavailable?: boolean;
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
  title.textContent = 'Account & Trusted Contact Settings';

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-section-subtitle';
  subtitle.textContent =
    'Review authenticated session parameters, authorized ward scoping, safety invariants, and backend connection details.';

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
    'Tenant Isolation Boundary: Guardrail enforces strict multi-tenant authorization. You are authorized to assist only the designated ward indicated above. Requests or browsing data belonging to other users are strictly isolated and inaccessible.';
  identityCard.appendChild(tenantNotice);

  section.appendChild(identityCard);

  // Card 2: Backend Connection & Runtime Environment
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

  addBackendItem('API Endpoint Origin', originVal, true);
  addBackendItem('Deployment Environment', (props.environment ?? 'development').toUpperCase());
  addBackendItem('Service Architecture', props.isMockService ? 'Development Fixture / In-Memory' : 'Authoritative Pilot Backend');
  addBackendItem('Polling Cadence', `${(props.pollIntervalMs ?? 10000) / 1000}s interval (auto-pauses when tab hidden)`);
  addBackendItem('Last Synchronized', formatLastSync(props.lastSynchronizedAt));

  backendCard.appendChild(backendGrid);

  if (props.onRefresh) {
    const refreshRow = document.createElement('div');
    refreshRow.className = 'gd-settings-action-row';

    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.className = 'gd-btn-refresh';
    syncBtn.textContent = '🔄 Test Connection & Sync Now';
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
    'Submitting an approval decision records your authorized consent on the backend. It strictly never remotely executes the browser action. The user in Staging Mode retains final agency to confirm or cancel.'
  );
  addInvariant(
    'Strict Multi-Tenant Boundary',
    'Requests are cryptographically authenticated and scoped exclusively to authorized contacts. Attempts to query or inspect actions from unassigned users yield opaque 404/403 responses.'
  );
  addInvariant(
    'Zero-Trust Data Scrubbing',
    'High-risk actions containing sensitive credentials, payment card details, security codes, and authentication tokens are scrubbed before reaching the backend or dashboard. Secrets are never exposed in UI or memory.'
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
    'Clear the active trusted contact session to test unauthenticated workflows or disconnect this browser from the current identity.';

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
