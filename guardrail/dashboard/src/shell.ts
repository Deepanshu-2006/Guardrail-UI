/**
 * Guardrail Trusted-Contact Dashboard - Shell Component
 *
 * Coordinates the application shell layout:
 * - Brand area and responsive sidebar navigation.
 * - Top header with status indicators and mobile drawer toggle.
 * - Overview, Pending Approvals (two-pane), and Decision History sections.
 * - Account identity area (authoritative server session representation).
 * - Accessible focus management, URL hash synchronization, and keyboard navigation.
 */

import {
  ApprovalApiClient,
  ApprovalRequest,
  ApprovalStatus,
  ApiClientErrorCodes,
  DEFAULT_DASHBOARD_POLL_INTERVAL_MS,
  DashboardShellOptions,
  DashboardShellState,
  DashboardView,
  PolicyAuditRecord,
  RequestFilters,
  RiskLevel,
  TrustedContactInvitation,
  TrustedContactProfile,
} from './types.js';
import { renderNavigation } from './components/navigation.js';
import { renderAccountArea } from './components/account.js';
import { renderAuthModal } from './components/auth-modal.js';
import { renderOverview } from './components/overview.js';
import { renderPendingApprovals } from './components/pending.js';
import { renderDecisionHistory } from './components/history.js';
import { renderSettings } from './components/settings.js';
import { isInvitationExpired } from './components/relationships.js';

export class DashboardShell {
  private readonly rootContainer: HTMLElement;
  private state: DashboardShellState;
  private appWrapper: HTMLElement | null = null;
  private sidebarEl: HTMLElement | null = null;
  private headerTitleEl: HTMLElement | null = null;
  private mainContentEl: HTMLElement | null = null;
  private liveAnnouncerEl: HTMLElement | null = null;
  private isMobileSidebarOpen: boolean = false;
  private hashChangeHandler: (() => void) | null = null;
  private visibilityChangeHandler: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private readonly apiClient?: ApprovalApiClient;
  private readonly autoFetch: boolean;
  private pollIntervalMs?: number;
  private activeFetchPromise: Promise<void> | null = null;
  private readonly activeDetailFetchPromises: Map<string, Promise<ApprovalRequest | null>> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  public static readonly MAX_CACHE_ENTRIES = 100;
  private readonly detailedRequestsCache: Map<string, ApprovalRequest> = new Map();
  private isDetailLoading: boolean = false;
  private detailErrorMessage: string | null = null;

  private setCachedRequest(id: string, req: ApprovalRequest): void {
    if (this.detailedRequestsCache.has(id)) {
      this.detailedRequestsCache.delete(id);
    } else if (this.detailedRequestsCache.size >= DashboardShell.MAX_CACHE_ENTRIES) {
      const oldestKey = this.detailedRequestsCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.detailedRequestsCache.delete(oldestKey);
      }
    }
    this.detailedRequestsCache.set(id, req);
  }
  private isSubmittingDecision: boolean = false;
  private isDestroyed: boolean = false;
  private isPollingHaltedDueToAuth: boolean = false;
  private lastSynchronizedAt: Date | null = null;
  private isBackendUnavailable: boolean = false;
  private isRefreshing: boolean = false;
  private eventSource: EventSource | null = null;

  // Monotonic sequence tracking for stale-response protection
  private nextPendingFetchSeq: number = 0;
  private lastAppliedPendingSeq: number = 0;
  private readonly nextDetailFetchSeqByRequestId: Map<string, number> = new Map();
  private readonly lastAppliedDetailSeqByRequestId: Map<string, number> = new Map();

  // Monotonic sequence tracking for history stale-response protection
  private nextHistoryFetchSeq: number = 0;
  private lastAppliedHistorySeq: number = 0;
  private activeHistoryFetchPromise: Promise<void> | null = null;

  // Track initial mount so entrance animations (like sidebar slide) only run once
  private isEntryAnimationActive: boolean = true;
  private entryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: DashboardShellOptions) {
    if (typeof options.container === 'string') {
      const el = document.querySelector<HTMLElement>(options.container);
      if (!el) {
        throw new Error(`Target container "${options.container}" not found in DOM.`);
      }
      this.rootContainer = el;
    } else {
      this.rootContainer = options.container;
    }

    this.apiClient = options.apiClient;
    this.autoFetch = options.autoFetch ?? Boolean(options.apiClient);
    // Authenticated live mounts opt in with isMockService=false. Keep mock/test mounts
    // deterministic unless they explicitly request polling.
    this.pollIntervalMs = options.pollIntervalMs ?? (options.isMockService === false ? DEFAULT_DASHBOARD_POLL_INTERVAL_MS : undefined);

    const initialRequests = options.initialRequests ?? [];
    const initialHistory = options.initialHistoryRequests ?? [];
    const initialConnectedUsers = options.initialConnectedUsers ?? [];
    const initialInvitations = options.initialInvitations ?? [];

    const defaultPendingFilters: RequestFilters = {
      status: 'ALL',
      riskLevel: 'ALL',
      dateRange: 'ALL',
      searchQuery: '',
    };
    const defaultHistoryFilters: RequestFilters = {
      status: 'ALL',
      riskLevel: 'ALL',
      dateRange: 'ALL',
      searchQuery: '',
    };

    this.state = {
      activeView: options.initialView ?? this.getViewFromHash() ?? 'overview',
      contactProfile: options.initialProfile ?? null,
      pendingRequests: initialRequests,
      selectedRequestId: initialRequests[0]?.id ?? null,
      pendingStatus: initialRequests.length === 0 ? 'empty' : 'idle',
      errorMessage: null,
      isSubmittingDecision: false,
      decisionErrorMessage: null,
      decisionSuccessMessage: null,
      historyRequests: initialHistory,
      historyStatus: options.initialHistoryStatus ?? (initialHistory.length === 0 ? 'empty' : 'idle'),
      historyError: null,
      historyPage: 0,
      historyLimit: 50,
      hasMoreHistory: false,
      selectedHistoryRequestId: initialHistory[0]?.id ?? null,
      pendingFilters: defaultPendingFilters,
      historyFilters: defaultHistoryFilters,
      environment: options.environment ?? (typeof options.apiClient?.getEnvironment === 'function' ? options.apiClient.getEnvironment() : undefined),
      isMockService: options.isMockService ?? (typeof options.apiClient?.isMockService === 'function' ? options.apiClient.isMockService() : false),
      connectedUsers: initialConnectedUsers,
      connectedUsersStatus: initialConnectedUsers.length === 0 ? 'empty' : 'idle',
      connectedUsersError: null,
      invitations: initialInvitations,
      invitationsStatus: initialInvitations.length === 0 ? 'empty' : 'idle',
      invitationsError: null,
      isSubmittingRelationshipAction: false,
      relationshipActionMessage: null,
      wardPolicySummary: options.initialWardPolicy ?? null,
      wardPolicyStatus: options.initialWardPolicy ? 'idle' : 'empty',
      wardPolicyError: null,
      wardPolicyAuditHistory: options.initialPolicyAuditHistory ?? null,
      wardPolicyAuditStatus: options.initialPolicyAuditHistory ? 'idle' : 'empty',
      wardPolicyAuditError: null,
      hasPendingSync: false,
      pendingSyncChanges: [],
    };

    // Pre-seed in-memory detail cache with authoritative initial records
    for (const req of initialRequests) {
      this.setCachedRequest(req.id, req);
    }
    for (const req of initialHistory) {
      this.setCachedRequest(req.id, req);
    }

    // Expire initial entry state after cinematic animation completes
    this.entryTimer = setTimeout(() => {
      this.isEntryAnimationActive = false;
      this.entryTimer = null;
      if (this.appWrapper) {
        this.appWrapper.classList.remove('gd-initial-load');
      }
      if (this.sidebarEl) {
        this.sidebarEl.classList.remove('gd-sidebar-entry');
      }
    }, 1200);

    this.init();
  }

  /**
   * Initializes the dashboard shell in the DOM.
   */
  private init(): void {
    this.render();
    this.setupListeners();
    if (this.autoFetch && this.apiClient) {
      void this.fetchPendingRequests();
      void this.fetchRelationships();
      void this.fetchHistoryRequests();
      void this.fetchWardPolicy();
    }
    if (this.pollIntervalMs && this.pollIntervalMs > 0 && this.apiClient) {
      this.startPolling();
    }
  }

  /**
   * Sets up URL hash, window, and tab visibility event listeners.
   */
  private setupListeners(): void {
    if (typeof window !== 'undefined') {
      this.hashChangeHandler = () => {
        const view = this.getViewFromHash();
        if (view && view !== this.state.activeView) {
          this.setActiveView(view, false);
        }
      };

      window.addEventListener('hashchange', this.hashChangeHandler);

      this.keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.isMobileSidebarOpen) {
          this.toggleMobileSidebar(false);
        }
      };
      window.addEventListener('keydown', this.keyHandler);
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.visibilityChangeHandler = () => {
        this.handleVisibilityChange();
      };
      document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }
  }

  /**
   * Handles tab visibility changes (document.visibilitychange).
   * Automatically pauses polling when the tab is hidden to save background resources.
   * Resumes polling and immediately queries an authoritative sync probe when returning to visible.
   */
  public handleVisibilityChange(): void {
    if (this.isDestroyed || typeof document === 'undefined') return;

    const isHidden = document.visibilityState === 'hidden';
    if (isHidden) {
      this.stopPolling();
    } else {
      this.startPolling();
      // Immediately refresh visible dashboard state upon returning to the tab
      if (this.apiClient && !this.isPollingHaltedDueToAuth) {
        void this.fetchPendingRequests({ isBackground: true });
      }
    }
  }

  /**
   * Starts background polling timer if configured and not already running.
   */
  public startPolling(): void {
    if (this.isDestroyed) return;
    if (this.pollTimer !== null) return;
    if (!this.pollIntervalMs || this.pollIntervalMs <= 0 || !this.apiClient) return;
    if (this.isPollingHaltedDueToAuth) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    this.connectEventSource();

    this.pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      void this.fetchPendingRequests({ isBackground: true });
    }, this.pollIntervalMs);
  }

  private connectEventSource(): void {
    if (typeof EventSource === 'undefined' || !this.apiClient) return;
    if (this.eventSource !== null) return;

    try {
      const baseUrl = typeof (this.apiClient as any).getBaseUrl === 'function'
        ? (this.apiClient as any).getBaseUrl()
        : 'http://localhost:3000';
      const sseUrl = `${baseUrl}/api/v1/approvals/stream`;
      const es = new EventSource(sseUrl);
      this.eventSource = es;

      const onStreamEvent = () => {
        if (this.isDestroyed) return;
        // Immediate background refresh when any approval lifecycle event is emitted
        void this.fetchPendingRequests({ isBackground: true });
        void this.fetchHistoryRequests();
      };

      es.addEventListener('created', onStreamEvent);
      es.addEventListener('decided', onStreamEvent);
      es.addEventListener('cancelled', onStreamEvent);
      es.addEventListener('expired', onStreamEvent);

      es.onerror = () => {
        if (this.eventSource) {
          try { this.eventSource.close(); } catch {}
          this.eventSource = null;
        }
      };
    } catch {
      this.eventSource = null;
    }
  }

  /**
   * Stops background polling timer.
   */
  public stopPolling(): void {
    if (this.eventSource !== null) {
      try {
        this.eventSource.close();
      } catch {}
      this.eventSource = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Configures background polling interval at runtime.
   */
  public setPollInterval(intervalMs: number | undefined): void {
    this.pollIntervalMs = intervalMs;
    this.stopPolling();
    if (intervalMs && intervalMs > 0 && !this.isDestroyed) {
      this.startPolling();
    }
  }

  /**
   * Returns configured polling interval in milliseconds.
   */
  public getPollIntervalMs(): number | undefined {
    return this.pollIntervalMs;
  }

  /**
   * Returns true if background polling timer is actively running.
   */
  public isPolling(): boolean {
    return this.pollTimer !== null;
  }

  /**
   * Returns timestamp of last successful background/foreground synchronization.
   */
  public getLastSynchronizedAt(): Date | null {
    return this.lastSynchronizedAt;
  }

  /**
   * Returns last applied monotonic sequence number for pending approvals list.
   */
  public getLastAppliedSequence(): number {
    return this.lastAppliedPendingSeq;
  }

  /**
   * Reads view name from URL hash (#overview, #pending, #history, #settings).
   */
  private getViewFromHash(): DashboardView | null {
    if (typeof window === 'undefined' || !window.location.hash) return null;
    const cleanHash = window.location.hash.replace(/^#/, '').toLowerCase();
    if (cleanHash === 'overview' || cleanHash === 'pending' || cleanHash === 'history' || cleanHash === 'settings') {
      return cleanHash as DashboardView;
    }
    return null;
  }

  /**
   * Renders the complete dashboard DOM structure.
   */
  public render(): void {
    // Clear root container
    while (this.rootContainer.firstChild) {
      this.rootContainer.removeChild(this.rootContainer.firstChild);
    }

    // Accessible Skip-to-Content Link
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.setAttribute('href', '#main-content');
    skipLink.className = 'gd-skip-link';
    skipLink.textContent = 'Skip to main content';
    this.rootContainer.appendChild(skipLink);

    // Accessible live region for screen-reader announcements
    this.liveAnnouncerEl = document.createElement('div');
    this.liveAnnouncerEl.id = 'gd-live-announcer';
    this.liveAnnouncerEl.className = 'gd-sr-only';
    this.liveAnnouncerEl.setAttribute('role', 'status');
    this.liveAnnouncerEl.setAttribute('aria-live', 'polite');
    this.liveAnnouncerEl.setAttribute('aria-atomic', 'true');
    this.rootContainer.appendChild(this.liveAnnouncerEl);

    // App Wrapper
    this.appWrapper = document.createElement('div');
    this.appWrapper.className = this.isEntryAnimationActive
      ? 'gd-dashboard-app gd-initial-load'
      : 'gd-dashboard-app';

    // 1. Sidebar (Navigation + Account Profile)
    this.sidebarEl = renderNavigation({
      activeView: this.state.activeView,
      pendingCount: this.state.pendingRequests.length,
      onViewChange: (view) => this.setActiveView(view),
    });
    this.sidebarEl.id = 'gd-primary-sidebar';
    if (this.isEntryAnimationActive) {
      this.sidebarEl.classList.add('gd-sidebar-entry');
    }

    const accountArea = renderAccountArea({
      profile: this.state.contactProfile,
      onOpenSettings: () => this.setActiveView('settings'),
      onOpenAuth: () => this.openAuthModal(),
      onSignOut: () => this.handleSignOut(),
    });
    this.sidebarEl.appendChild(accountArea);
    this.appWrapper.appendChild(this.sidebarEl);

    // 2. Main Workspace
    const workspace = document.createElement('div');
    workspace.className = 'gd-main-workspace';

    // Top Header
    const topHeader = document.createElement('header');
    topHeader.className = 'gd-top-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'gd-top-header-left';

    const mobileToggle = document.createElement('button');
    mobileToggle.type = 'button';
    mobileToggle.className = 'gd-mobile-toggle';
    mobileToggle.setAttribute('aria-label', 'Open navigation menu');
    mobileToggle.setAttribute('aria-controls', 'gd-primary-sidebar');
    mobileToggle.setAttribute('aria-expanded', 'false');
    mobileToggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>';
    mobileToggle.addEventListener('click', () => this.toggleMobileSidebar());

    this.headerTitleEl = document.createElement('h1');
    this.headerTitleEl.className = 'gd-header-title';
    this.headerTitleEl.textContent = this.formatViewTitle(this.state.activeView);

    headerLeft.appendChild(mobileToggle);
    headerLeft.appendChild(this.headerTitleEl);

    const headerActions = document.createElement('div');
    headerActions.className = 'gd-header-actions';

    const statusPill = document.createElement('div');
    const pillModifier = this.isBackendUnavailable
      ? 'unavailable'
      : this.isRefreshing
      ? 'syncing'
      : this.state.contactProfile?.isAuthenticated
      ? 'authenticated'
      : 'portal';
    statusPill.className = `gd-status-pill ${pillModifier}`;
    statusPill.setAttribute('role', 'status');

    const dot = document.createElement('span');
    dot.className = 'gd-status-dot';
    dot.setAttribute('aria-hidden', 'true');

    const statusText = document.createElement('span');
    if (this.isBackendUnavailable) {
      statusText.textContent = this.state.contactProfile?.isAuthenticated
        ? 'Verified Reviewer (Offline)'
        : 'Backend Unavailable';
    } else if (this.isRefreshing) {
      statusText.textContent = this.state.contactProfile?.isAuthenticated
        ? 'Verified Reviewer (Syncing...)'
        : 'Synchronizing...';
    } else {
      statusText.textContent = this.state.contactProfile?.isAuthenticated
        ? 'Verified Reviewer'
        : 'Reviewer Portal';
    }

    statusPill.appendChild(dot);
    statusPill.appendChild(statusText);
    headerActions.appendChild(statusPill);

    const isMock = Boolean(
      this.state.isMockService ||
        (typeof this.apiClient?.isMockService === 'function' && this.apiClient.isMockService())
    );
    if (isMock) {
      const mockBadge = document.createElement('span');
      mockBadge.className = 'gd-mock-service-badge';
      mockBadge.setAttribute('role', 'status');
      mockBadge.textContent = 'MOCK BACKEND';
      mockBadge.title = 'Connected to simulated or in-memory mock service. Not connected to a live pilot backend.';
      headerActions.appendChild(mockBadge);
    }

    const env =
      this.state.environment ||
      (typeof this.apiClient?.getEnvironment === 'function'
        ? this.apiClient.getEnvironment()
        : undefined);
    if (env && env !== 'production') {
      const envBadge = document.createElement('span');
      envBadge.className = `gd-env-badge gd-env-${env}`;
      envBadge.textContent = env.toUpperCase();
      headerActions.appendChild(envBadge);
    }

    topHeader.appendChild(headerLeft);
    topHeader.appendChild(headerActions);
    workspace.appendChild(topHeader);

    // Content Body with Landmark <main>
    const contentBody = document.createElement('div');
    contentBody.className = 'gd-content-body';

    this.mainContentEl = document.createElement('main');
    this.mainContentEl.id = 'main-content';
    this.mainContentEl.setAttribute('id', 'main-content');
    this.mainContentEl.tabIndex = -1;
    this.mainContentEl.setAttribute('tabindex', '-1');
    this.mainContentEl.className = 'gd-content-container';

    // View 1: Overview
    const overviewSection = renderOverview({
      profile: this.state.contactProfile,
      pendingCount: this.state.pendingRequests.length,
      pendingRequests: this.state.pendingRequests,
      pendingStatus: this.state.pendingStatus,
      errorMessage: this.state.errorMessage,
      recentActivity: this.state.historyRequests,
      isBackendUnavailable: this.isBackendUnavailable,
      isMockService: this.isMockService(),
      environment: this.getEnvironment(),
      lastSynchronizedAt: this.lastSynchronizedAt,
      isSubmitting: this.state.isSubmittingRelationshipAction,
      onViewHistory: () => this.setActiveView('history'),
      onViewPending: () => this.setActiveView('pending'),
      onViewSettings: () => this.setActiveView('settings'),
      onDisconnectWard: () => this.disconnectWard(),
      onSelectPending: (id) => {
        this.setActiveView('pending');
        this.selectRequest(id);
      },
      onRefresh: this.apiClient ? () => void this.refresh() : undefined,
      onConnectInvitation: this.apiClient ? (code: string) => this.connectInvitation(code) : undefined,
    });
    if (this.state.activeView === 'overview') {
      overviewSection.classList.add('active');
    } else {
      overviewSection.classList.remove('active');
    }
    this.mainContentEl.appendChild(overviewSection);

    // View 2: Pending Approvals
    const selectedDetail = this.state.selectedRequestId
      ? (this.detailedRequestsCache.get(this.state.selectedRequestId) ||
         this.state.pendingRequests.find((r) => r.id === this.state.selectedRequestId) ||
         null)
      : null;

    const pendingSection = renderPendingApprovals({
      requests: this.state.pendingRequests,
      selectedRequestId: this.state.selectedRequestId,
      selectedRequestDetail: selectedDetail,
      isDetailLoading: this.isDetailLoading,
      detailErrorMessage: this.detailErrorMessage,
      status: this.state.pendingStatus,
      errorMessage: this.state.errorMessage,
      filters: this.state.pendingFilters,
      isStale: (this.isBackendUnavailable || this.state.pendingStatus === 'error') && this.state.pendingRequests.length > 0,
      isBackendUnavailable: this.isBackendUnavailable,
      lastSynchronizedAt: this.lastSynchronizedAt,
      isRefreshing: this.isRefreshing,
      onFiltersChange: (newFilters) => this.setPendingFilters(newFilters),
      onRequestSelect: (id) => this.selectRequest(id),
      onRefresh: this.apiClient ? () => void this.refresh() : undefined,
      onRefreshDetail: this.apiClient && this.state.selectedRequestId
        ? () => void this.loadRequestDetails(this.state.selectedRequestId!, true)
        : undefined,
      isSubmittingDecision: this.isSubmittingDecision,
      decisionErrorMessage: this.state.decisionErrorMessage,
      decisionSuccessMessage: this.state.decisionSuccessMessage,
      onDecisionSubmit: async (decision, reason, targetId) => {
        const idToDecide = targetId || this.state.selectedRequestId;
        if (idToDecide) {
          await this.submitDecision(idToDecide, decision, reason);
        }
      },
    });
    if (this.state.activeView === 'pending') {
      pendingSection.classList.add('active');
    } else {
      pendingSection.classList.remove('active');
    }
    this.mainContentEl.appendChild(pendingSection);

    // View 3: Decision History
    const selectedHistoryDetail = this.state.selectedHistoryRequestId
      ? (this.detailedRequestsCache.get(this.state.selectedHistoryRequestId) ||
         this.state.historyRequests.find((r) => r.id === this.state.selectedHistoryRequestId) ||
         null)
      : null;

    const historySection = renderDecisionHistory({
      requests: this.state.historyRequests,
      status: this.state.historyStatus,
      errorMessage: this.state.historyError,
      selectedRequestId: this.state.selectedHistoryRequestId,
      selectedRequestDetail: selectedHistoryDetail,
      isDetailLoading: this.isDetailLoading,
      detailErrorMessage: this.detailErrorMessage,
      filters: this.state.historyFilters,
      hasMore: this.state.hasMoreHistory,
      page: this.state.historyPage,
      onLoadMore: this.apiClient ? () => void this.loadMoreHistory() : undefined,
      onRequestSelect: (id) => this.selectHistoryRequest(id),
      onFiltersChange: (newFilters) => this.setHistoryFilters(newFilters),
      onRefresh: this.apiClient ? () => void this.refresh() : undefined,
      onRefreshDetail: this.apiClient && this.state.selectedHistoryRequestId
        ? () => void this.loadRequestDetails(this.state.selectedHistoryRequestId!, true)
        : undefined,
    });
    if (this.state.activeView === 'history') {
      historySection.classList.add('active');
    } else {
      historySection.classList.remove('active');
    }
    this.mainContentEl.appendChild(historySection);

    // View 4: Account & Settings
    const settingsSection = renderSettings({
      profile: this.state.contactProfile,
      environment: this.getEnvironment(),
      isMockService: this.isMockService(),
      backendOrigin: (this.apiClient as any)?.backendOrigin || (typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://127.0.0.1:3000'),
      pollIntervalMs: this.pollIntervalMs,
      lastSynchronizedAt: this.lastSynchronizedAt,
      isBackendUnavailable: this.isBackendUnavailable,
      connectedUsers: this.state.connectedUsers,
      connectedUsersStatus: this.state.connectedUsersStatus,
      connectedUsersError: this.state.connectedUsersError,
      invitations: this.state.invitations,
      invitationsStatus: this.state.invitationsStatus,
      invitationsError: this.state.invitationsError,
      wardPolicySummary: this.state.wardPolicySummary,
      wardPolicyStatus: this.state.wardPolicyStatus,
      wardPolicyError: this.state.wardPolicyError,
      wardPolicyAuditHistory: this.state.wardPolicyAuditHistory,
      wardPolicyAuditStatus: this.state.wardPolicyAuditStatus,
      wardPolicyAuditError: this.state.wardPolicyAuditError,
      hasPendingSync: this.state.hasPendingSync,
      pendingSyncChanges: this.state.pendingSyncChanges,
      isSubmittingRelationshipAction: this.state.isSubmittingRelationshipAction,
      relationshipActionMessage: this.state.relationshipActionMessage,
      onCreateInvitation: this.apiClient ? (payload) => this.createInvitation(payload) : undefined,
      onRevokeInvitation: this.apiClient ? (id) => this.revokeInvitation(id) : undefined,
      onRevokeTrustedContact: this.apiClient ? (id) => this.revokeTrustedContact(id) : undefined,
      onConnectInvitation: this.apiClient ? (code) => this.connectInvitation(code) : undefined,
      onDisconnectWard: () => this.disconnectWard(),
      onRefresh: this.apiClient ? () => void this.refresh() : undefined,
      onClearSession: () => {
        this.setProfile(null);
      },
    });
    if (this.state.activeView === 'settings') {
      settingsSection.classList.add('active');
    } else {
      settingsSection.classList.remove('active');
    }
    this.mainContentEl.appendChild(settingsSection);

    contentBody.appendChild(this.mainContentEl);
    workspace.appendChild(contentBody);
    this.appWrapper.appendChild(workspace);

    this.rootContainer.appendChild(this.appWrapper);
  }

  /**
   * Switches the active dashboard section.
   */
  public setActiveView(view: DashboardView, updateHash: boolean = true): void {
    this.isEntryAnimationActive = false;
    if (this.entryTimer) {
      clearTimeout(this.entryTimer);
      this.entryTimer = null;
    }

    if (this.isMobileSidebarOpen) {
      this.toggleMobileSidebar(false);
    }

    if (this.state.activeView === view) return;

    this.state.activeView = view;
    if (updateHash && typeof window !== 'undefined') {
      window.location.hash = `#${view}`;
    }

    // When switching to pending view, refresh pending requests if autoFetch is enabled
    if (view === 'pending' && this.autoFetch && this.apiClient && this.state.pendingStatus !== 'loading') {
      void this.fetchPendingRequests();
    }
    // When switching to history view, refresh decision history if autoFetch is enabled
    if (view === 'history' && this.autoFetch && this.apiClient && this.state.historyStatus !== 'loading') {
      void this.fetchHistoryRequests({ isBackground: this.state.historyRequests.length > 0 });
    }

    // Full re-render guarantees accessibility attributes and view DOM sync
    this.render();

    // Announce view change to screen readers
    this.announce(`Navigated to ${this.formatViewTitle(view)}`);

    // Move focus to main content region for screen readers
    if (this.mainContentEl && typeof this.mainContentEl.focus === 'function') {
      try {
        this.mainContentEl.focus();
      } catch {
        // Ignore in headless test environments
      }
    }
  }

  /**
   * Announces an accessible status update to assistive technology (screen readers).
   */
  public announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    if (!this.liveAnnouncerEl) return;
    this.liveAnnouncerEl.setAttribute('aria-live', priority);
    this.liveAnnouncerEl.textContent = message;
  }

  /**
   * Exposes live announcer element for testing.
   */
  public getLiveAnnouncerElement(): HTMLElement | null {
    return this.liveAnnouncerEl;
  }

  /**
   * Fetches real pending approval requests from the remote backend.
   *
   * ARCHITECTURAL REQUIREMENTS & CONCURRENCY:
   * 1. Uses the verified pending-requests endpoint from integration contract (GET /api/v1/approvals/pending).
   * 2. Backend determines authorized requests; frontend sends NO approver ID as proof of authority.
   * 3. Avoids duplicate concurrent requests by returning the active in-flight Promise.
   * 4. Accurately reflects empty, loading, error, and populated states without fabricating data.
   * 5. Protects against stale out-of-order responses via monotonic sequence numbers.
   * 6. Automatically refreshes visible request details if selected request state changes.
   */
  public async fetchPendingRequests(options?: { isBackground?: boolean }): Promise<void> {
    if (this.isDestroyed) return;

    if (this.activeFetchPromise) {
      return this.activeFetchPromise;
    }

    this.activeFetchPromise = (async () => {
      try {
        await this.doFetchPendingRequests(options?.isBackground ?? false);
      } finally {
        this.activeFetchPromise = null;
      }
    })();

    return this.activeFetchPromise;
  }

  private async doFetchPendingRequests(isBackground: boolean = false): Promise<void> {
    if (this.isDestroyed) return;

    if (!this.apiClient) {
      this.setError('No approval API client configured. Unable to fetch pending requests.');
      return;
    }

    this.isRefreshing = true;
    const seq = ++this.nextPendingFetchSeq;

    // Only transition to full loading state if not a silent background sync
    if (!isBackground) {
      this.setLoading(true);
    }

    try {
      const result = await this.apiClient.listPendingApprovals();

      if (this.isDestroyed) return;

      // Discard stale response if a newer response has already been applied
      if (seq < this.lastAppliedPendingSeq) {
        return;
      }
      this.lastAppliedPendingSeq = seq;
      this.lastSynchronizedAt = new Date();

      if (result.success) {
        // Validate payload integrity: must be an array
        if (!Array.isArray(result.data)) {
          this.setError('Protocol error: Backend returned an invalid, non-array response payload.');
          return;
        }

        // Validate that items are valid objects with canonical ids & deduplicate
        const safeRequests: ApprovalRequest[] = [];
        const seenIds = new Set<string>();
        for (const req of result.data) {
          if (!req || typeof req !== 'object' || typeof req.id !== 'string' || !req.id.trim()) {
            this.setError('Protocol error: Malformed approval request item received from backend.');
            return;
          }
          const trimmedId = req.id.trim();
          if (!seenIds.has(trimmedId)) {
            seenIds.add(trimmedId);
            safeRequests.push(req);
          }
        }

        // Reconcile against authoritative local cache:
        // A delayed pending response must NEVER revert an already-resolved terminal request
        const reconciledPending: ApprovalRequest[] = [];
        for (const req of safeRequests) {
          const cached = this.detailedRequestsCache.get(req.id);
          if (cached && cached.status !== ApprovalStatus.PENDING) {
            continue;
          }
          this.setCachedRequest(req.id, req);
          reconciledPending.push(req);
        }

        const prevRequests = this.state.pendingRequests;
        const isDataIdentical = (
          prevRequests.length === reconciledPending.length &&
          prevRequests.every((prev, i) => {
            const next = reconciledPending[i];
            return (
              prev.id === next.id &&
              prev.status === next.status &&
              prev.expiresAt === next.expiresAt &&
              prev.actionDescription === next.actionDescription
            );
          }) &&
          this.state.errorMessage === null &&
          !this.isBackendUnavailable
        );

        this.isBackendUnavailable = false;
        this.state.errorMessage = null;

        if (isBackground && isDataIdentical) {
          // Silent background poll with no changes: do NOT wipe/re-render DOM!
          this.state.pendingRequests = reconciledPending;
          this.updateSyncIndicatorsInPlace();
        } else {
          this.setPendingRequests(reconciledPending);
        }

        // Synchronize visible request details if a request is currently selected
        if (this.state.selectedRequestId) {
          const selectedId = this.state.selectedRequestId;
          const stillPending = reconciledPending.some((r) => r.id === selectedId);
          if (!stillPending) {
            const cached = this.detailedRequestsCache.get(selectedId);
            // Only fetch remote details if record is missing or still PENDING in memory
            if (!cached || cached.status === 'PENDING') {
              void this.loadRequestDetails(selectedId, true).then((refreshed) => {
                if (refreshed && typeof refreshed === 'object' && typeof refreshed.id === 'string' && refreshed.status !== 'PENDING') {
                  this.addHistoryRequest(refreshed);
                }
              });
            }
          }
        }
      } else {
        const err = result.error;
        let userMessage = err.message;

        switch (err.code) {
          case ApiClientErrorCodes.UNAUTHENTICATED:
            userMessage = 'Authentication required: Please sign in with an authorized trusted contact session.';
            // Invalidate profile since session is unauthenticated
            if (this.state.contactProfile) {
              this.state.contactProfile = null;
            }
            this.stopPolling();
            this.isPollingHaltedDueToAuth = true;
            this.isBackendUnavailable = false;
            break;
          case ApiClientErrorCodes.NOT_FOUND_OR_DENIED:
            userMessage = 'Access denied: You are not authorized to view pending approval requests for this ward.';
            this.isBackendUnavailable = false;
            break;
          case ApiClientErrorCodes.NETWORK_FAILURE:
            userMessage = 'Network connection error: Unable to reach the Guardrail approval backend. Please verify your connection and retry.';
            this.isBackendUnavailable = true;
            break;
          case ApiClientErrorCodes.TIMEOUT:
            userMessage = 'Request timed out: The approval backend took too long to respond. Please retry.';
            this.isBackendUnavailable = true;
            break;
          case ApiClientErrorCodes.MALFORMED_JSON_RESPONSE:
            userMessage = 'Protocol error: Received malformed response syntax from approval backend.';
            this.isBackendUnavailable = false;
            break;
          case ApiClientErrorCodes.RATE_LIMIT_EXCEEDED:
            userMessage = 'Too many requests: Please wait a few moments before retrying.';
            this.isBackendUnavailable = false;
            break;
          case ApiClientErrorCodes.SERVER_ERROR:
            userMessage = 'Internal server error: The approval backend encountered an unexpected error.';
            this.isBackendUnavailable = true;
            break;
          default:
            userMessage = err.message || 'An unexpected error occurred while fetching pending approvals.';
            this.isBackendUnavailable = false;
            break;
        }

        console.warn('[Dashboard Shell] Pending approvals fetch failed:', err);
        this.setError(userMessage);
      }
    } catch (unhandled) {
      if (this.isDestroyed) return;
      if (seq < this.lastAppliedPendingSeq) return;
      this.lastAppliedPendingSeq = seq;
      this.isBackendUnavailable = true;
      const msg = unhandled instanceof Error ? unhandled.message : String(unhandled);
      console.error('[Dashboard Shell] Pending approvals unhandled exception:', unhandled);
      this.setError(`Client error while retrieving pending approvals: ${msg}`);
    } finally {
      this.isRefreshing = false;
      if (!this.isDestroyed && !isBackground) {
        this.render();
      }
    }
  }

  private updateSyncIndicatorsInPlace(): void {
    if (this.lastSynchronizedAt && this.rootContainer) {
      const timeStr = this.lastSynchronizedAt.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const syncEls = this.rootContainer.querySelectorAll('.gd-last-sync-time');
      for (let i = 0; i < syncEls.length; i++) {
        syncEls[i].textContent = `Last synced: ${timeStr}`;
      }
    }
  }

  /**
   * Refreshes the pending approvals list, relationships, and history from the backend.
   */
  public async refresh(): Promise<void> {
    await Promise.all([
      this.fetchPendingRequests(),
      this.fetchRelationships({ isBackground: true }),
      this.fetchHistoryRequests({ isBackground: true }),
      this.fetchWardPolicy(),
    ]);
    this.announce('Dashboard data refreshed.');
  }

  /**
   * Invalidates current data and requests fresh data from the backend.
   */
  public async invalidate(): Promise<void> {
    this.state.pendingRequests = [];
    this.state.selectedRequestId = null;
    this.state.connectedUsers = [];
    this.state.invitations = [];
    this.state.historyRequests = [];
    this.state.historyPage = 0;
    this.detailedRequestsCache.clear();
    await Promise.all([
      this.fetchPendingRequests(),
      this.fetchRelationships(),
      this.fetchHistoryRequests(),
    ]);
  }

  /**
   * Retrieves request details through the verified backend endpoint (GET /api/v1/approvals/:id),
   * or reuses an already-loaded authoritative record if present in memory.
   *
   * @param requestId Canonical approval request identifier
   * @param forceFetch If true, bypasses in-memory cache and dispatches network request
   */
  public async loadRequestDetails(
    requestId: string,
    forceFetch: boolean = false
  ): Promise<ApprovalRequest | null> {
    if (this.isDestroyed) return null;
    if (!requestId || typeof requestId !== 'string' || !requestId.trim()) {
      return null;
    }

    const trimmedId = requestId.trim();
    const existing =
      this.detailedRequestsCache.get(trimmedId) ||
      this.state.pendingRequests.find((r) => r.id === trimmedId) ||
      null;

    // Reuse already-loaded authoritative record if fresh fetch is not forced
    if (existing && !forceFetch) {
      return existing;
    }

    if (!this.apiClient) {
      return existing;
    }

    // Collapse concurrent requests for the exact same requestId
    const inFlight = this.activeDetailFetchPromises.get(trimmedId);
    if (inFlight) {
      return inFlight;
    }

    const fetchPromise = (async () => {
      try {
        return await this.doLoadRequestDetails(trimmedId, existing);
      } finally {
        this.activeDetailFetchPromises.delete(trimmedId);
      }
    })();

    this.activeDetailFetchPromises.set(trimmedId, fetchPromise);
    return fetchPromise;
  }

  private async doLoadRequestDetails(
    trimmedId: string,
    existing: ApprovalRequest | null
  ): Promise<ApprovalRequest | null> {
    if (this.isDestroyed || !this.apiClient) return existing;

    const seq = (this.nextDetailFetchSeqByRequestId.get(trimmedId) || 0) + 1;
    this.nextDetailFetchSeqByRequestId.set(trimmedId, seq);

    this.isDetailLoading = true;
    this.detailErrorMessage = null;
    this.render();

    try {
      const result = await this.apiClient.getApprovalDetails(trimmedId);

      if (this.isDestroyed) return existing;

      // Stale-response guard for this specific request ID
      const lastApplied = this.lastAppliedDetailSeqByRequestId.get(trimmedId) || 0;
      if (seq < lastApplied) {
        return existing;
      }
      this.lastAppliedDetailSeqByRequestId.set(trimmedId, seq);

      if (result.success) {
        this.setCachedRequest(trimmedId, result.data);
        this.detailErrorMessage = null;
        return result.data;
      } else {
        const msg = result.error.message || 'Failed to retrieve approval request details.';
        this.detailErrorMessage = msg;
        return existing;
      }
    } catch (unhandled) {
      if (this.isDestroyed) return existing;
      const lastApplied = this.lastAppliedDetailSeqByRequestId.get(trimmedId) || 0;
      if (seq < lastApplied) return existing;
      this.lastAppliedDetailSeqByRequestId.set(trimmedId, seq);

      const msg = unhandled instanceof Error ? unhandled.message : String(unhandled);
      this.detailErrorMessage = `Error retrieving details: ${msg}`;
      return existing;
    } finally {
      this.isDetailLoading = false;
      if (!this.isDestroyed) {
        this.render();
      }
    }
  }


  /**
   * Selects an approval request in the pending list for inspection.
   * Can reuse loaded authoritative record or fetch fresh via backend endpoint.
   */
  public selectRequest(requestId: string, fetchFresh: boolean = false): void {
    if (this.state.selectedRequestId !== requestId) {
      this.state.decisionErrorMessage = null;
      this.state.decisionSuccessMessage = null;
    }
    this.state.selectedRequestId = requestId;
    if (fetchFresh && this.apiClient) {
      void this.loadRequestDetails(requestId, true);
    } else {
      this.render();
    }
  }

  /**
   * Submits an authoritative reviewer approval or rejection decision to the backend.
   *
   * ARCHITECTURAL & SECURITY REQUIREMENTS:
   * 1. Uses verified decision endpoint: POST /api/v1/approvals/:id/decide.
   * 2. Uses existing authentication mechanism (Bearer token from session/TokenProvider).
   * 3. Zero-trust client: Never sends approverId, decidedBy, or status in request body.
   * 4. Treats backend as authoritative: Does NOT optimistically update local status.
   * 5. Prevents duplicate clicks/submissions via in-flight locking (isSubmittingDecision).
   * 6. Prunes resolved requests from pending list only upon confirmed 200 OK backend response.
   * 7. Concurrency: On 409 (ALREADY_RESOLVED) or 410 (REQUEST_EXPIRED), fetches authoritative state
   *    and prunes from pending without falsely reporting success.
   * 8. Decoupled Execution: Approving or rejecting strictly NEVER triggers, executes, or replays
   *    the held browser action in the user's browser.
   * 9. Missing Backend: Reports missing API client prerequisite without simulating decisions.
   */
  public async submitDecision(
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string
  ): Promise<ApprovalRequest | null> {
    if (!requestId || typeof requestId !== 'string' || !requestId.trim()) {
      return null;
    }

    const trimmedId = requestId.trim();

    // 1. Concurrency guard: prevent duplicate submissions / re-entrance
    if (this.isSubmittingDecision) {
      return null;
    }

    // 2. UI Boundary: Check for real backend API client prerequisite
    if (!this.apiClient || typeof this.apiClient.submitDecision !== 'function') {
      this.state.decisionErrorMessage =
        'Backend decision service is unavailable: Approval API client is not configured. Real decision operations cannot be performed.';
      this.state.decisionSuccessMessage = null;
      this.render();
      return null;
    }

    // 3. Verify that the request is currently in pending state in memory and not expired
    const existingReq =
      this.detailedRequestsCache.get(trimmedId) ||
      this.state.pendingRequests.find((r) => r.id === trimmedId);

    const isExpired = Boolean(
      existingReq && (existingReq.status === 'EXPIRED' || (existingReq.expiresAt && new Date(existingReq.expiresAt).getTime() <= Date.now()))
    );

    if (existingReq && (existingReq.status !== 'PENDING' || isExpired)) {
      if (isExpired) {
        this.state.decisionErrorMessage = 'Request expired: The review deadline for this request has elapsed. Stale or expired requests cannot be approved.';
        // Prune from pending requests if present
        this.state.pendingRequests = this.state.pendingRequests.filter((r) => r.id !== trimmedId);
        this.state.pendingStatus = this.state.pendingRequests.length === 0 ? 'empty' : 'idle';
      } else {
        this.state.decisionErrorMessage = `This request is already ${existingReq.status.toLowerCase()} and cannot accept new decisions.`;
      }
      this.state.decisionSuccessMessage = null;
      this.render();
      return null;
    }

    // 4. Lock submission state (prevent duplicate clicks, disable buttons, set aria-busy)
    this.isSubmittingDecision = true;
    this.state.isSubmittingDecision = true;
    this.state.decisionErrorMessage = null;
    this.state.decisionSuccessMessage = null;
    this.render();

    try {
      // 5. Submit decision to authoritative backend endpoint
      // Zero-trust client: payload contains ONLY decision and optional decisionReason
      const result = await this.apiClient.submitDecision(trimmedId, {
        decision,
        decisionReason: reason,
      });

      if (result.success) {
        // Backend confirmed decision with authoritative updated ApprovalRequest record
        const updatedRecord = result.data;

        // Invalidate pre-decision pending fetches so their delayed response cannot overwrite this decision
        this.lastAppliedPendingSeq = Math.max(this.lastAppliedPendingSeq, this.nextPendingFetchSeq);
        this.isBackendUnavailable = false;

        // Update detailed cache with authoritative updated record
        this.setCachedRequest(trimmedId, updatedRecord);

        // Prepend to authoritative history archive
        this.state.historyRequests = [
          updatedRecord,
          ...this.state.historyRequests.filter((r) => r.id !== trimmedId),
        ];
        this.state.selectedHistoryRequestId = trimmedId;

        // Prune resolved request from pending list
        this.state.pendingRequests = this.state.pendingRequests.filter((r) => r.id !== trimmedId);
        this.state.pendingStatus = this.state.pendingRequests.length === 0 ? 'empty' : 'idle';

        // Keep selectedRequestId pointing to the resolved request so the user views the updated record
        this.state.selectedRequestId = trimmedId;

        // Set authoritative success message
        this.state.decisionSuccessMessage = `Decision successfully recorded: ${decision}. Reviewer consent is committed on the server.`;
        this.state.decisionErrorMessage = null;
        this.announce(`Decision recorded: ${decision}. Reviewer consent committed to server.`);

        // Immediate background refresh so dashboard does not depend exclusively on periodic polling
        void this.fetchPendingRequests({ isBackground: true });

        return updatedRecord;
      } else {
        // Backend returned an error
        const err = result.error;
        let userMessage = err.message;

        switch (err.code) {
          case ApiClientErrorCodes.UNAUTHENTICATED:
            userMessage = 'Authentication required: You must be signed in as a trusted contact to record a decision.';
            if (this.state.contactProfile) {
              this.state.contactProfile = null;
            }
            this.stopPolling();
            this.isPollingHaltedDueToAuth = true;
            break;
          case ApiClientErrorCodes.SELF_APPROVAL_PROHIBITED:
            userMessage = 'Authorization failure: Self-approval is strictly prohibited. You cannot review your own browser action.';
            break;
          case ApiClientErrorCodes.NOT_FOUND_OR_DENIED:
            userMessage = 'Access denied: You are not authorized to decide on this request. The request may have been removed, or your trusted-contact relationship was revoked.';
            this.state.pendingRequests = this.state.pendingRequests.filter((r) => r.id !== trimmedId);
            this.state.pendingStatus = this.state.pendingRequests.length === 0 ? 'empty' : 'idle';
            void this.fetchPendingRequests({ isBackground: true });
            break;
          case ApiClientErrorCodes.ALREADY_RESOLVED:
            userMessage = 'Conflict: This request has already been resolved by another reviewer or cancelled by the user.';
            // Authoritative state update: fetch latest record and prune from pending list
            void this.loadRequestDetails(trimmedId, true).then((refreshed) => {
              if (refreshed && refreshed.status !== 'PENDING') {
                this.addHistoryRequest(refreshed);
              }
            });
            this.state.pendingRequests = this.state.pendingRequests.filter((r) => r.id !== trimmedId);
            this.state.pendingStatus = this.state.pendingRequests.length === 0 ? 'empty' : 'idle';
            void this.fetchPendingRequests({ isBackground: true });
            break;
          case ApiClientErrorCodes.REQUEST_EXPIRED:
            userMessage = 'Request expired: The review deadline for this request has elapsed. The held action cannot proceed.';
            // Authoritative state update: fetch latest record and prune from pending list
            void this.loadRequestDetails(trimmedId, true).then((refreshed) => {
              if (refreshed && refreshed.status !== 'PENDING') {
                this.addHistoryRequest(refreshed);
              }
            });
            this.state.pendingRequests = this.state.pendingRequests.filter((r) => r.id !== trimmedId);
            this.state.pendingStatus = this.state.pendingRequests.length === 0 ? 'empty' : 'idle';
            void this.fetchPendingRequests({ isBackground: true });
            break;
          case ApiClientErrorCodes.NETWORK_FAILURE:
            userMessage = 'Network connection error: Unable to reach the Guardrail approval backend. Please verify your connection and retry.';
            break;
          case ApiClientErrorCodes.TIMEOUT:
            userMessage = 'Request timed out: The approval backend took too long to respond. Please retry.';
            break;
          case ApiClientErrorCodes.MALFORMED_JSON_RESPONSE:
            userMessage = 'Protocol error: Received malformed response syntax from approval backend.';
            break;
          case ApiClientErrorCodes.SERVER_ERROR:
            userMessage = 'Internal server error: The approval backend encountered an unexpected error.';
            break;
          default:
            userMessage = err.message || 'An unexpected error occurred while submitting decision.';
            break;
        }

        this.state.decisionErrorMessage = userMessage;
        this.state.decisionSuccessMessage = null;
        this.announce(`Decision failed: ${userMessage}`, 'assertive');
        return null;
      }
    } catch (unhandled) {
      const msg = unhandled instanceof Error ? unhandled.message : String(unhandled);
      this.state.decisionErrorMessage = `Client error while submitting decision: ${msg}`;
      this.state.decisionSuccessMessage = null;
      this.announce(`Decision error: ${msg}`, 'assertive');
      return null;
    } finally {
      this.isSubmittingDecision = false;
      this.state.isSubmittingDecision = false;
      this.render();
    }
  }

  /**
   * Sets the pending requests list and updates view status.
   */
  public setPendingRequests(requests: readonly ApprovalRequest[]): void {
    this.state.pendingRequests = requests;
    this.state.pendingStatus = requests.length === 0 ? 'empty' : 'idle';
    if (!this.state.selectedRequestId) {
      this.state.selectedRequestId = requests[0]?.id ?? null;
    } else if (
      !requests.some((r) => r.id === this.state.selectedRequestId) &&
      !this.detailedRequestsCache.has(this.state.selectedRequestId)
    ) {
      this.state.selectedRequestId = requests[0]?.id ?? null;
    }
    this.render();
  }

  /**
   * Updates loading status.
   */
  public setLoading(loading: boolean): void {
    this.state.pendingStatus = loading ? 'loading' : this.state.pendingRequests.length === 0 ? 'empty' : 'idle';
    this.render();
  }

  /**
   * Sets or clears error state.
   */
  public setError(message: string | null): void {
    this.state.errorMessage = message;
    if (message === null) {
      this.isBackendUnavailable = false;
    }
    this.state.pendingStatus = message ? 'error' : this.state.pendingRequests.length === 0 ? 'empty' : 'idle';
    this.render();
  }

  /**
   * Updates contact profile.
   */
  public setProfile(profile: TrustedContactProfile | null): void {
    this.state.contactProfile = profile;
    if (profile?.isAuthenticated) {
      this.isPollingHaltedDueToAuth = false;
      if (this.pollIntervalMs && this.pollIntervalMs > 0 && !this.pollTimer) {
        this.startPolling();
      }
    } else {
      this.stopPolling();
      this.isPollingHaltedDueToAuth = true;
    }
    this.render();
  }

  /**
   * Opens the Caretaker Authentication & Identity dialog.
   */
  public openAuthModal(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById('gd-auth-modal-root')) return;

    const modal = renderAuthModal({
      profile: this.state.contactProfile,
      apiBaseUrl: (this.apiClient as any)?.options?.baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000'),
      onAuthSuccess: (token, profile) => {
        this.handleAuthSuccess(token, profile);
      },
      onSignOut: () => {
        this.handleSignOut();
      },
      onClose: () => {
        modal.remove();
      },
    });
    modal.id = 'gd-auth-modal-root';
    document.body.appendChild(modal);
  }

  /**
   * Handles successful authentication by persisting token, updating profile,
   * and refreshing dashboard data.
   */
  public handleAuthSuccess(token: string, profile: TrustedContactProfile): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('guardrail_auth_token', token);
    }
    this.setProfile(profile);
    void this.refresh();
  }

  /**
   * Clears persisted credentials, revokes active session state, and pauses live sync.
   */
  public handleSignOut(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('guardrail_auth_token');
    }
    this.setProfile(null);
    void this.refresh();
  }

  /**
   * Updates pending approvals filters and re-renders.
   */
  public setPendingFilters(filters: Partial<RequestFilters>): void {
    this.state.pendingFilters = {
      ...this.state.pendingFilters,
      ...filters,
    };
    this.render();
  }

  /**
   * Fetches historical approval requests from the authoritative backend endpoint (GET /api/v1/approvals/history).
   */
  public async fetchHistoryRequests(options?: { isBackground?: boolean; page?: number }): Promise<void> {
    if (this.isDestroyed || !this.apiClient) return;

    if (this.activeHistoryFetchPromise) {
      return this.activeHistoryFetchPromise;
    }

    this.activeHistoryFetchPromise = (async () => {
      try {
        await this.doFetchHistoryRequests(options);
      } finally {
        this.activeHistoryFetchPromise = null;
      }
    })();

    return this.activeHistoryFetchPromise;
  }

  private async doFetchHistoryRequests(options?: { isBackground?: boolean; page?: number }): Promise<void> {
    if (this.isDestroyed || !this.apiClient) return;

    const page = options?.page ?? this.state.historyPage ?? 0;
    const limit = this.state.historyLimit ?? 50;
    const offset = page * limit;

    const seq = ++this.nextHistoryFetchSeq;
    if (!options?.isBackground && this.state.historyRequests.length === 0) {
      this.state.historyStatus = 'loading';
      this.state.historyError = null;
      this.render();
    }

    try {
      if (typeof (this.apiClient as any).listApprovalHistory !== 'function') {
        if (this.state.historyRequests.length === 0) {
          this.state.historyStatus = 'empty';
        }
        return;
      }

      const statusFilter = this.state.historyFilters?.status !== 'ALL'
        ? (this.state.historyFilters?.status as ApprovalStatus)
        : undefined;
      const riskFilter = this.state.historyFilters?.riskLevel !== 'ALL'
        ? (this.state.historyFilters?.riskLevel as RiskLevel)
        : undefined;

      const result = await (this.apiClient as any).listApprovalHistory({
        status: statusFilter,
        riskLevel: riskFilter,
        limit,
        offset,
      });

      if (this.isDestroyed || seq < this.lastAppliedHistorySeq) return;
      this.lastAppliedHistorySeq = seq;

      if (result.success && Array.isArray(result.data)) {
        const fetchedRecords: ApprovalRequest[] = [];
        const seenIds = new Set<string>();

        for (const req of result.data) {
          if (req && typeof req === 'object' && typeof req.id === 'string' && req.id.trim()) {
            const trimmed = req.id.trim();
            if (!seenIds.has(trimmed)) {
              seenIds.add(trimmed);
              fetchedRecords.push(req);
              this.setCachedRequest(trimmed, req);
            }
          }
        }

        // Merge with locally decided terminal requests in session history so in-flight decisions aren't discarded
        const mergedMap = new Map<string, ApprovalRequest>();
        for (const req of fetchedRecords) {
          mergedMap.set(req.id, req);
        }
        for (const localReq of this.state.historyRequests) {
          if (!mergedMap.has(localReq.id)) {
            mergedMap.set(localReq.id, localReq);
          }
        }

        const mergedList = Array.from(mergedMap.values()).sort((a, b) => {
          const timeA = new Date(a.resolvedAt || a.expiresAt || a.createdAt).getTime();
          const timeB = new Date(b.resolvedAt || b.expiresAt || b.createdAt).getTime();
          return timeB - timeA;
        });

        this.state.historyRequests = mergedList;
        this.state.historyStatus = mergedList.length === 0 ? 'empty' : 'idle';
        this.state.historyError = null;
        this.state.historyPage = page;
        this.state.hasMoreHistory = fetchedRecords.length >= limit;

        if (!this.state.selectedHistoryRequestId && mergedList.length > 0) {
          this.state.selectedHistoryRequestId = mergedList[0].id;
        }
      } else if (!result.success) {
        const err = result.error;
        if (err.statusCode === 401) {
          this.state.historyError = 'Authentication required: Please sign in with an authorized trusted contact session.';
          this.state.historyStatus = 'error';
        } else if (err.statusCode === 403 || err.statusCode === 404) {
          // Multi-tenant isolation: opaque refusal or denied
          this.state.historyError = 'Access denied or no approval history available.';
          this.state.historyStatus = this.state.historyRequests.length === 0 ? 'empty' : 'idle';
        } else {
          this.state.historyError = err.message || 'Failed to retrieve approval history.';
          if (this.state.historyRequests.length === 0) {
            this.state.historyStatus = 'error';
          }
        }
      }
    } catch (unhandled: any) {
      if (this.isDestroyed || seq < this.lastAppliedHistorySeq) return;
      this.lastAppliedHistorySeq = seq;
      this.state.historyError = unhandled instanceof Error ? unhandled.message : String(unhandled);
      if (this.state.historyRequests.length === 0) {
        this.state.historyStatus = 'error';
      }
    } finally {
      if (!this.isDestroyed) {
        this.render();
      }
    }
  }

  public async loadMoreHistory(): Promise<void> {
    if (this.isDestroyed || !this.apiClient || !this.state.hasMoreHistory) return;
    await this.fetchHistoryRequests({ page: this.state.historyPage + 1 });
  }

  /**
   * Updates decision history filters and refreshes if apiClient is available.
   */
  public setHistoryFilters(filters: Partial<RequestFilters>): void {
    this.state.historyFilters = {
      ...this.state.historyFilters,
      ...filters,
    };
    if (this.apiClient) {
      void this.fetchHistoryRequests({ isBackground: false, page: 0 });
    } else {
      this.render();
    }
  }

  /**
   * Selects a request in the decision history view for inspection.
   */
  public selectHistoryRequest(requestId: string): void {
    this.state.selectedHistoryRequestId = requestId;
    this.render();
  }

  /**
   * Adds an authoritative resolved request to decision history.
   */
  public addHistoryRequest(request: ApprovalRequest): void {
    if (!request || typeof request !== 'object' || typeof request.id !== 'string') {
      return;
    }
    this.setCachedRequest(request.id, request);
    this.state.historyRequests = [
      request,
      ...this.state.historyRequests.filter((r) => r.id !== request.id),
    ];
    this.state.historyStatus = 'idle';
    if (!this.state.selectedHistoryRequestId) {
      this.state.selectedHistoryRequestId = request.id;
    }
    this.render();
  }

  /**
   * Returns a copy of the current dashboard state.
   */
  public getState(): Readonly<DashboardShellState> {
    return {
      ...this.state,
      isBackendUnavailable: this.isBackendUnavailable,
      lastSynchronizedAt: this.lastSynchronizedAt,
      isRefreshing: this.isRefreshing,
    };
  }

  /**
   * Toggles mobile drawer state.
   */
  public toggleMobileSidebar(forceState?: boolean): void {
    this.isMobileSidebarOpen = forceState !== undefined ? forceState : !this.isMobileSidebarOpen;
    if (this.sidebarEl) {
      if (this.isMobileSidebarOpen) {
        this.sidebarEl.classList.add('open');
      } else {
        this.sidebarEl.classList.remove('open');
      }
    }
    const toggle = this.rootContainer.querySelector<HTMLButtonElement>('.gd-mobile-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(this.isMobileSidebarOpen));
      toggle.setAttribute('aria-label', this.isMobileSidebarOpen ? 'Close navigation menu' : 'Open navigation menu');
    }

    // Manage mobile backdrop
    const existingBackdrop = this.appWrapper?.querySelector<HTMLElement>('.gd-mobile-backdrop');
    if (this.isMobileSidebarOpen) {
      if (!existingBackdrop && this.appWrapper) {
        const backdrop = document.createElement('div');
        backdrop.className = 'gd-mobile-backdrop active';
        backdrop.setAttribute('aria-hidden', 'true');
        backdrop.addEventListener('click', () => this.toggleMobileSidebar(false));
        this.appWrapper.appendChild(backdrop);
      }
    } else {
      if (existingBackdrop && existingBackdrop.parentNode) {
        existingBackdrop.parentNode.removeChild(existingBackdrop);
      }
    }
  }

  /**
   * Formats view ID into human-friendly heading title.
   */
  private formatViewTitle(view: DashboardView): string {
    switch (view) {
      case 'overview':
        return 'Overview';
      case 'pending':
        return 'Pending Approvals';
      case 'history':
        return 'Decision History';
      case 'settings':
        return 'Settings & Account';
      default:
        return 'Trusted Contact Portal';
    }
  }

  /**
   * Returns true if the dashboard is connected to a mock or in-memory service.
   */
  public isMockService(): boolean {
    return Boolean(
      this.state.isMockService ||
        (typeof this.apiClient?.isMockService === 'function' && this.apiClient.isMockService())
    );
  }

  /**
   * Returns the current deployment environment if configured.
   */
  public getEnvironment(): string | undefined {
    return (
      this.state.environment ||
      (typeof this.apiClient?.getEnvironment === 'function'
        ? this.apiClient.getEnvironment()
        : undefined)
    );
  }

  /**
   * Authoritatively retrieves connected users/contacts and invitations from the backend.
   * Respects multi-tenant scoping and authorization boundaries without fabricating data.
   */
  public async fetchRelationships(options?: { isBackground?: boolean }): Promise<void> {
    if (!this.apiClient || this.isDestroyed) {
      return;
    }

    if (!options?.isBackground) {
      if (this.state.connectedUsers.length === 0) {
        this.state.connectedUsersStatus = 'loading';
      }
      if (this.state.invitations.length === 0) {
        this.state.invitationsStatus = 'loading';
      }
      this.render();
    }

    try {
      const [contactsRes, invitesRes] = await Promise.all([
        this.apiClient.listTrustedContacts(),
        this.apiClient.listInvitations(),
      ]);

      if (this.isDestroyed) return;

      if (contactsRes.success) {
        this.state.connectedUsers = contactsRes.data;
        this.state.connectedUsersStatus = contactsRes.data.length === 0 ? 'empty' : 'idle';
        this.state.connectedUsersError = null;
      } else {
        // If 403 / NOT_FOUND_OR_DENIED, the caller may be a TRUSTED_CONTACT whose scope is bounded to assignedWardId
        if (
          contactsRes.error.code === ApiClientErrorCodes.NOT_FOUND_OR_DENIED ||
          contactsRes.statusCode === 403 ||
          contactsRes.statusCode === 404
        ) {
          this.state.connectedUsersStatus = 'idle';
          this.state.connectedUsersError = null;
        } else {
          this.state.connectedUsersStatus = 'error';
          this.state.connectedUsersError = contactsRes.error.message;
        }
      }

      if (invitesRes.success) {
        this.state.invitations = invitesRes.data;
        this.state.invitationsStatus = invitesRes.data.length === 0 ? 'empty' : 'idle';
        this.state.invitationsError = null;
      } else {
        if (
          invitesRes.error.code === ApiClientErrorCodes.NOT_FOUND_OR_DENIED ||
          invitesRes.statusCode === 403 ||
          invitesRes.statusCode === 404
        ) {
          this.state.invitationsStatus = 'idle';
          this.state.invitationsError = null;
        } else {
          this.state.invitationsStatus = 'error';
          this.state.invitationsError = invitesRes.error.message;
        }
      }
    } catch (unhandled: unknown) {
      if (this.isDestroyed) return;
      const msg = unhandled instanceof Error ? unhandled.message : String(unhandled);
      this.state.connectedUsersStatus = 'error';
      this.state.connectedUsersError = msg;
      this.state.invitationsStatus = 'error';
      this.state.invitationsError = msg;
    } finally {
      if (!this.isDestroyed) {
        this.render();
      }
    }
  }

  /**
   * Generates a new trusted contact invitation on the backend.
   * Prevents duplicate in-flight requests and refreshes the invitations list on success.
   */
  public async createInvitation(payload: {
    recipientActorId: string;
    relationshipLabel?: string;
    ttlMs?: number;
  }): Promise<{ success: boolean; invitation?: TrustedContactInvitation; error?: string }> {
    if (this.state.isSubmittingRelationshipAction) {
      return { success: false, error: 'A relationship action is already in progress. Please wait.' };
    }
    if (!this.apiClient) {
      return { success: false, error: 'Dashboard is running in standalone mode without an active backend.' };
    }

    this.state.isSubmittingRelationshipAction = true;
    this.state.relationshipActionMessage = null;
    this.render();

    try {
      const res = await this.apiClient.createInvitation(payload);
      if (res.success) {
        this.state.relationshipActionMessage = {
          type: 'success',
          text: `Invitation generated successfully! One-time code: ${res.data.code ?? res.data.id}. Share this securely with ${res.data.recipientActorId}.`,
        };
        await this.fetchRelationships({ isBackground: true });
        this.render();
        return { success: true, invitation: res.data };
      } else {
        const errorMsg = res.error.message || 'Failed to create invitation.';
        this.state.relationshipActionMessage = { type: 'error', text: errorMsg };
        this.render();
        return { success: false, error: errorMsg };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error creating invitation.';
      this.state.relationshipActionMessage = { type: 'error', text: msg };
      this.render();
      return { success: false, error: msg };
    } finally {
      this.state.isSubmittingRelationshipAction = false;
      this.render();
    }
  }

  /**
   * Revokes an existing invitation on the backend.
   * Checks expiration to prevent redundant operations and re-syncs state immediately.
   */
  public async revokeInvitation(invitationId: string): Promise<{ success: boolean; error?: string }> {
    if (!invitationId || typeof invitationId !== 'string' || !invitationId.trim()) {
      return { success: false, error: 'Invitation ID is required.' };
    }
    if (this.state.isSubmittingRelationshipAction) {
      return { success: false, error: 'A relationship action is already in progress. Please wait.' };
    }
    if (!this.apiClient) {
      return { success: false, error: 'Dashboard is running in standalone mode without an active backend.' };
    }

    const trimmedId = invitationId.trim();
    const existing = this.state.invitations.find((i) => i.id === trimmedId);
    if (existing && isInvitationExpired(existing)) {
      const err = 'This invitation has already expired and cannot be revoked.';
      this.state.relationshipActionMessage = { type: 'error', text: err };
      this.render();
      return { success: false, error: err };
    }

    this.state.isSubmittingRelationshipAction = true;
    this.state.relationshipActionMessage = null;
    this.render();

    try {
      const res = await this.apiClient.revokeInvitation(trimmedId);
      if (res.success) {
        this.state.relationshipActionMessage = {
          type: 'success',
          text: `Invitation ${trimmedId} has been revoked. The pairing code can no longer be accepted.`,
        };
        await this.fetchRelationships({ isBackground: true });
        this.render();
        return { success: true };
      } else {
        const errorMsg = res.error.message || 'Failed to revoke invitation.';
        this.state.relationshipActionMessage = { type: 'error', text: errorMsg };
        this.render();
        return { success: false, error: errorMsg };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error revoking invitation.';
      this.state.relationshipActionMessage = { type: 'error', text: msg };
      this.render();
      return { success: false, error: msg };
    } finally {
      this.state.isSubmittingRelationshipAction = false;
      this.render();
    }
  }

  /**
   * Revokes an active trusted contact relationship on the backend.
   * Commits the revocation permanently and re-syncs connected users immediately.
   */
  public async revokeTrustedContact(contactId: string): Promise<{ success: boolean; error?: string }> {
    if (!contactId || typeof contactId !== 'string' || !contactId.trim()) {
      return { success: false, error: 'Contact ID is required.' };
    }
    if (this.state.isSubmittingRelationshipAction) {
      return { success: false, error: 'A relationship action is already in progress. Please wait.' };
    }
    if (!this.apiClient) {
      return { success: false, error: 'Dashboard is running in standalone mode without an active backend.' };
    }

    const trimmedId = contactId.trim();
    this.state.isSubmittingRelationshipAction = true;
    this.state.relationshipActionMessage = null;
    this.render();

    try {
      const res = await this.apiClient.revokeTrustedContact(trimmedId);
      if (res.success) {
        this.state.relationshipActionMessage = {
          type: 'success',
          text: `Trusted contact relationship with ${trimmedId} has been revoked. They can no longer evaluate browser actions.`,
        };
        await this.fetchRelationships({ isBackground: true });
        this.render();
        return { success: true };
      } else {
        const errorMsg = res.error.message || 'Failed to revoke trusted contact.';
        this.state.relationshipActionMessage = { type: 'error', text: errorMsg };
        this.render();
        return { success: false, error: errorMsg };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error revoking trusted contact.';
      this.state.relationshipActionMessage = { type: 'error', text: msg };
      this.render();
      return { success: false, error: msg };
    } finally {
      this.state.isSubmittingRelationshipAction = false;
      this.render();
    }
  }

  /**
   * Accepts an invitation code on the backend to pair with a ward.
   */
  public async connectInvitation(code: string): Promise<{ success: boolean; wardId?: string; error?: string }> {
    if (!code || typeof code !== 'string' || !code.trim()) {
      return { success: false, error: 'Please enter an invitation code.' };
    }
    if (this.state.isSubmittingRelationshipAction) {
      return { success: false, error: 'An action is already in progress. Please wait.' };
    }
    if (!this.apiClient) {
      return { success: false, error: 'Dashboard is running in standalone mode without an active backend.' };
    }

    this.state.isSubmittingRelationshipAction = true;
    this.state.relationshipActionMessage = null;
    this.render();

    try {
      const res = await this.apiClient.acceptInvitation(code);
      if (res.success) {
        const wardId = res.data.invitation.wardId || res.data.contact.wardId;
        const relLabel = res.data.invitation.relationshipLabel || res.data.contact.relationshipLabel;

        if (this.state.contactProfile?.isAuthenticated) {
          this.state.contactProfile = {
            ...this.state.contactProfile,
            assignedWardId: wardId,
            relationshipLabel: relLabel ?? this.state.contactProfile.relationshipLabel,
          };
        }
        this.state.relationshipActionMessage = {
          type: 'success',
          text: `Successfully connected to ward ${wardId}! Pending approval requests will now appear in your review queue.`,
        };
        await this.refresh();
        this.render();
        return { success: true, wardId };
      } else {
        const errorMsg = res.error.message || 'Failed to connect. The invitation code may be invalid, expired, or already accepted.';
        this.state.relationshipActionMessage = { type: 'error', text: errorMsg };
        this.render();
        return { success: false, error: errorMsg };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error connecting ward.';
      this.state.relationshipActionMessage = { type: 'error', text: msg };
      this.render();
      return { success: false, error: msg };
    } finally {
      this.state.isSubmittingRelationshipAction = false;
      this.render();
    }
  }

  /**
   * Fetches the sanitized policy summary for the assigned ward from the backend.
   */
  public async fetchWardPolicy(): Promise<void> {
    const wardId = this.state.contactProfile?.assignedWardId;
    if (!this.apiClient || !wardId) {
      this.state.wardPolicySummary = null;
      this.state.wardPolicyStatus = 'empty';
      this.state.wardPolicyError = null;
      return;
    }

    this.state.wardPolicyStatus = 'loading';
    this.state.wardPolicyError = null;

    try {
      const res = await this.apiClient.getUserPolicy(wardId);
      if (res.success && res.data) {
        if (res.data.viewType === 'TRUSTED_CONTACT_SUMMARY') {
          this.state.wardPolicySummary = res.data.summary;
          this.state.wardPolicyStatus = 'idle';
          this.state.wardPolicyError = null;
        } else if (res.data.viewType === 'WARD_FULL_POLICY') {
          const full = res.data.config;
          this.state.wardPolicySummary = {
            wardId,
            policyVersion: full.policyVersion,
            schemaVersion: full.schemaVersion,
            updatedAt: full.updatedAt,
            overallStatus: 'ACTIVE',
            sensitivityPreset: 'balanced',
            stagingModeEnabled: true,
            categoryProtections: {
              destructiveActions: (full.policies.find((p) => p.id === 'POLICY_CONTROLLED_DESTRUCTIVE')?.decision as any) ?? 'PROTECT',
              paymentActions: (full.policies.find((p) => p.id === 'POLICY_CONTROLLED_PAYMENT')?.decision as any) ?? 'PROTECT',
              boundaryGuards: (full.policies.find((p) => p.id === 'POLICY_UNSUPPORTED_BOUNDARY_GUARD')?.decision as any) ?? 'PROTECT',
              sensitiveData: (full.policies.find((p) => p.id === 'POLICY_AUTHENTICATION_BOUNDARY')?.decision as any) ?? 'WARN',
              externalNavigation: (full.policies.find((p) => p.id === 'POLICY_EXTERNAL_NAVIGATION')?.decision as any) ?? 'WARN',
            },
            relationship: {
              contactId: this.state.contactProfile?.actorId ?? 'contact',
              relationshipLabel: this.state.contactProfile?.relationshipLabel,
              status: 'ACTIVE',
            },
          };
          this.state.wardPolicyStatus = 'idle';
          this.state.wardPolicyError = null;
        }

        // Authoritatively fetch policy audit history if supported and caller is authorized
        if (typeof this.apiClient.getPolicyAuditHistory === 'function') {
          try {
            const auditRes = await this.apiClient.getPolicyAuditHistory(wardId);
            if (auditRes.success) {
              this.state.wardPolicyAuditHistory = auditRes.data;
              this.state.wardPolicyAuditStatus = auditRes.data.length === 0 ? 'empty' : 'idle';
              this.state.wardPolicyAuditError = null;
            } else {
              // If contact is forbidden (403), audit history is restricted as expected by ward sovereignty
              if (auditRes.statusCode === 403) {
                this.state.wardPolicyAuditHistory = null;
                this.state.wardPolicyAuditStatus = 'idle';
                this.state.wardPolicyAuditError = null;
              } else {
                this.state.wardPolicyAuditStatus = 'error';
                this.state.wardPolicyAuditError = auditRes.error?.message ?? 'Failed to retrieve policy audit history.';
              }
            }
          } catch (auditErr: unknown) {
            this.state.wardPolicyAuditStatus = 'error';
            this.state.wardPolicyAuditError = auditErr instanceof Error ? auditErr.message : String(auditErr);
          }
        }
      } else {
        this.state.wardPolicyStatus = 'error';
        const errorMsg = !res.success ? res.error?.message : undefined;
        this.state.wardPolicyError = errorMsg || 'Failed to retrieve ward policy.';
      }
    } catch (err) {
      this.state.wardPolicyStatus = 'error';
      this.state.wardPolicyError = err instanceof Error ? err.message : String(err);
    } finally {
      if (!this.isDestroyed) {
        this.render();
      }
    }
  }

  /**
   * Sets the policy audit history directly in dashboard state.
   */
  public setWardPolicyAuditHistory(history: readonly PolicyAuditRecord[] | null): void {
    this.state.wardPolicyAuditHistory = history;
    this.state.wardPolicyAuditStatus = !history || history.length === 0 ? 'empty' : 'idle';
    this.state.wardPolicyAuditError = null;
    this.render();
  }

  /**
   * Updates real-time policy synchronization status (e.g. pending synchronization indicator).
   */
  public setPolicySyncState(syncState: {
    hasPendingSync?: boolean;
    pendingChanges?: readonly string[];
    status?: string;
  }): void {
    if (syncState.hasPendingSync !== undefined) {
      this.state.hasPendingSync = syncState.hasPendingSync;
    }
    if (syncState.pendingChanges !== undefined) {
      this.state.pendingSyncChanges = syncState.pendingChanges;
    }
    if (syncState.status === 'PENDING_SYNC' || syncState.status === 'pending_sync') {
      this.state.hasPendingSync = true;
    }
    this.render();
  }

  /**
   * Unlinks the active ward relationship from the trusted contact portal.
   */
  public disconnectWard(): void {
    if (this.state.contactProfile) {
      this.state.contactProfile = {
        ...this.state.contactProfile,
        assignedWardId: undefined,
        relationshipLabel: undefined,
      };
      this.state.wardPolicySummary = null;
      this.state.wardPolicyStatus = 'empty';
      this.state.wardPolicyError = null;
      this.state.relationshipActionMessage = {
        type: 'info',
        text: 'Ward relationship disconnected. Your review queue is now unlinked.',
      };
      this.render();
    }
  }

  /**
   * Cleans up timers, event subscriptions, and in-flight operations, and removes DOM nodes.
   */
  public destroy(): void {
    this.isDestroyed = true;
    this.stopPolling();

    if (this.entryTimer) {
      clearTimeout(this.entryTimer);
      this.entryTimer = null;
    }

    if (this.hashChangeHandler && typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this.hashChangeHandler);
      this.hashChangeHandler = null;
    }

    if (this.keyHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }

    if (this.visibilityChangeHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
      this.visibilityChangeHandler = null;
    }

    this.activeFetchPromise = null;
    this.activeDetailFetchPromises.clear();

    while (this.rootContainer.firstChild) {
      this.rootContainer.removeChild(this.rootContainer.firstChild);
    }
  }
}
