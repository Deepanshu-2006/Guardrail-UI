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
  ApiClientErrorCodes,
  DashboardShellOptions,
  DashboardShellState,
  DashboardView,
  TrustedContactProfile,
} from './types.js';
import { renderNavigation } from './components/navigation.js';
import { renderAccountArea } from './components/account.js';
import { renderOverview } from './components/overview.js';
import { renderPendingApprovals } from './components/pending.js';
import { renderDecisionHistory } from './components/history.js';

export class DashboardShell {
  private readonly rootContainer: HTMLElement;
  private state: DashboardShellState;
  private appWrapper: HTMLElement | null = null;
  private sidebarEl: HTMLElement | null = null;
  private headerTitleEl: HTMLElement | null = null;
  private mainContentEl: HTMLElement | null = null;
  private isMobileSidebarOpen: boolean = false;
  private hashChangeHandler: (() => void) | null = null;
  private readonly apiClient?: ApprovalApiClient;
  private readonly autoFetch: boolean;
  private readonly pollIntervalMs?: number;
  private activeFetchPromise: Promise<void> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly detailedRequestsCache: Map<string, ApprovalRequest> = new Map();
  private isDetailLoading: boolean = false;
  private detailErrorMessage: string | null = null;

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
    this.pollIntervalMs = options.pollIntervalMs;

    const initialRequests = options.initialRequests ?? [];
    this.state = {
      activeView: options.initialView ?? this.getViewFromHash() ?? 'overview',
      contactProfile: options.initialProfile ?? null,
      pendingRequests: initialRequests,
      selectedRequestId: initialRequests[0]?.id ?? null,
      pendingStatus: initialRequests.length === 0 ? 'empty' : 'idle',
      errorMessage: null,
    };

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
    }
    if (this.pollIntervalMs && this.pollIntervalMs > 0 && this.apiClient) {
      this.pollTimer = setInterval(() => {
        void this.fetchPendingRequests();
      }, this.pollIntervalMs);
    }
  }

  /**
   * Sets up URL hash and window event listeners.
   */
  private setupListeners(): void {
    if (typeof window === 'undefined') return;

    this.hashChangeHandler = () => {
      const view = this.getViewFromHash();
      if (view && view !== this.state.activeView) {
        this.setActiveView(view, false);
      }
    };

    window.addEventListener('hashchange', this.hashChangeHandler);
  }

  /**
   * Reads view name from URL hash (#overview, #pending, #history).
   */
  private getViewFromHash(): DashboardView | null {
    if (typeof window === 'undefined' || !window.location.hash) return null;
    const cleanHash = window.location.hash.replace(/^#/, '').toLowerCase();
    if (cleanHash === 'overview' || cleanHash === 'pending' || cleanHash === 'history') {
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
    skipLink.className = 'gd-skip-link';
    skipLink.textContent = 'Skip to main content';
    this.rootContainer.appendChild(skipLink);

    // App Wrapper
    this.appWrapper = document.createElement('div');
    this.appWrapper.className = 'gd-dashboard-app';

    // 1. Sidebar (Navigation + Account Profile)
    this.sidebarEl = renderNavigation({
      activeView: this.state.activeView,
      pendingCount: this.state.pendingRequests.length,
      onViewChange: (view) => this.setActiveView(view),
    });

    const accountArea = renderAccountArea({
      profile: this.state.contactProfile,
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
    mobileToggle.setAttribute('aria-label', 'Toggle Navigation Menu');
    mobileToggle.textContent = '☰';
    mobileToggle.addEventListener('click', () => this.toggleMobileSidebar());

    this.headerTitleEl = document.createElement('h1');
    this.headerTitleEl.className = 'gd-header-title';
    this.headerTitleEl.textContent = this.formatViewTitle(this.state.activeView);

    headerLeft.appendChild(mobileToggle);
    headerLeft.appendChild(this.headerTitleEl);

    const headerActions = document.createElement('div');
    headerActions.className = 'gd-header-actions';

    const statusPill = document.createElement('div');
    statusPill.className = 'gd-status-pill';
    statusPill.setAttribute('role', 'status');

    const dot = document.createElement('span');
    dot.className = 'gd-status-dot';
    dot.setAttribute('aria-hidden', 'true');

    const statusText = document.createElement('span');
    statusText.textContent = this.state.contactProfile?.isAuthenticated
      ? 'Verified Reviewer'
      : 'Reviewer Portal';

    statusPill.appendChild(dot);
    statusPill.appendChild(statusText);
    headerActions.appendChild(statusPill);

    topHeader.appendChild(headerLeft);
    topHeader.appendChild(headerActions);
    workspace.appendChild(topHeader);

    // Content Body with Landmark <main>
    const contentBody = document.createElement('div');
    contentBody.className = 'gd-content-body';

    this.mainContentEl = document.createElement('main');
    this.mainContentEl.id = 'main-content';
    this.mainContentEl.tabIndex = -1;
    this.mainContentEl.className = 'gd-content-container';

    // View 1: Overview
    const overviewSection = renderOverview({
      profile: this.state.contactProfile,
      pendingCount: this.state.pendingRequests.length,
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
      onRequestSelect: (id) => this.selectRequest(id),
      onRefresh: this.apiClient ? () => void this.refresh() : undefined,
      onRefreshDetail: this.apiClient && this.state.selectedRequestId
        ? () => void this.loadRequestDetails(this.state.selectedRequestId!, true)
        : undefined,
    });
    if (this.state.activeView === 'pending') {
      pendingSection.classList.add('active');
    } else {
      pendingSection.classList.remove('active');
    }
    this.mainContentEl.appendChild(pendingSection);

    // View 3: Decision History
    const historySection = renderDecisionHistory({});
    if (this.state.activeView === 'history') {
      historySection.classList.add('active');
    } else {
      historySection.classList.remove('active');
    }
    this.mainContentEl.appendChild(historySection);

    contentBody.appendChild(this.mainContentEl);
    workspace.appendChild(contentBody);
    this.appWrapper.appendChild(workspace);

    this.rootContainer.appendChild(this.appWrapper);
  }

  /**
   * Switches the active dashboard section.
   */
  public setActiveView(view: DashboardView, updateHash: boolean = true): void {
    if (this.state.activeView === view) return;

    this.state.activeView = view;
    if (updateHash && typeof window !== 'undefined') {
      window.location.hash = `#${view}`;
    }

    if (this.isMobileSidebarOpen) {
      this.toggleMobileSidebar(false);
    }

    // When switching to pending view, refresh pending requests if autoFetch is enabled
    if (view === 'pending' && this.autoFetch && this.apiClient && this.state.pendingStatus !== 'loading') {
      void this.fetchPendingRequests();
    }

    // Full re-render guarantees accessibility attributes and view DOM sync
    this.render();

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
   * Fetches real pending approval requests from the remote backend.
   *
   * ARCHITECTURAL REQUIREMENTS & CONCURRENCY:
   * 1. Uses the verified pending-requests endpoint from integration contract (GET /api/v1/approvals/pending).
   * 2. Backend determines authorized requests; frontend sends NO approver ID as proof of authority.
   * 3. Avoids duplicate concurrent requests by returning the active in-flight Promise.
   * 4. Accurately reflects empty, loading, error, and populated states without fabricating data.
   */
  public async fetchPendingRequests(): Promise<void> {
    if (this.activeFetchPromise) {
      return this.activeFetchPromise;
    }

    this.activeFetchPromise = (async () => {
      try {
        await this.doFetchPendingRequests();
      } finally {
        this.activeFetchPromise = null;
      }
    })();

    return this.activeFetchPromise;
  }

  private async doFetchPendingRequests(): Promise<void> {
    if (!this.apiClient) {
      this.setError('No approval API client configured. Unable to fetch pending requests.');
      return;
    }

    this.setLoading(true);

    try {
      const result = await this.apiClient.listPendingApprovals();

      if (result.success) {
        // Validate payload integrity: must be an array
        if (!Array.isArray(result.data)) {
          this.setError('Protocol error: Backend returned an invalid, non-array response payload.');
          return;
        }

        // Validate that items are valid objects with canonical ids
        const safeRequests: ApprovalRequest[] = [];
        for (const req of result.data) {
          if (!req || typeof req !== 'object' || typeof req.id !== 'string') {
            this.setError('Protocol error: Malformed approval request item received from backend.');
            return;
          }
          safeRequests.push(req);
        }

        this.state.errorMessage = null;
        this.setPendingRequests(safeRequests);
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
            break;
          case ApiClientErrorCodes.NOT_FOUND_OR_DENIED:
            userMessage = 'Access denied: You are not authorized to view pending approval requests for this ward.';
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
          case ApiClientErrorCodes.RATE_LIMIT_EXCEEDED:
            userMessage = 'Too many requests: Please wait a few moments before retrying.';
            break;
          case ApiClientErrorCodes.SERVER_ERROR:
            userMessage = 'Internal server error: The approval backend encountered an unexpected error.';
            break;
          default:
            userMessage = err.message || 'An unexpected error occurred while fetching pending approvals.';
            break;
        }

        this.setError(userMessage);
      }
    } catch (unhandled) {
      const msg = unhandled instanceof Error ? unhandled.message : String(unhandled);
      this.setError(`Client error while retrieving pending approvals: ${msg}`);
    }
  }

  /**
   * Refreshes the pending approvals list from the backend.
   */
  public async refresh(): Promise<void> {
    return this.fetchPendingRequests();
  }

  /**
   * Invalidates current data and requests fresh data from the backend.
   */
  public async invalidate(): Promise<void> {
    this.state.pendingRequests = [];
    this.state.selectedRequestId = null;
    return this.fetchPendingRequests();
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

    this.isDetailLoading = true;
    this.detailErrorMessage = null;
    this.render();

    try {
      const result = await this.apiClient.getApprovalDetails(trimmedId);
      if (result.success) {
        this.detailedRequestsCache.set(trimmedId, result.data);
        this.detailErrorMessage = null;
        return result.data;
      } else {
        const msg = result.error.message || 'Failed to retrieve approval request details.';
        this.detailErrorMessage = msg;
        return existing;
      }
    } catch (unhandled) {
      const msg = unhandled instanceof Error ? unhandled.message : String(unhandled);
      this.detailErrorMessage = `Error retrieving details: ${msg}`;
      return existing;
    } finally {
      this.isDetailLoading = false;
      this.render();
    }
  }

  /**
   * Selects an approval request in the pending list for inspection.
   * Can reuse loaded authoritative record or fetch fresh via backend endpoint.
   */
  public selectRequest(requestId: string, fetchFresh: boolean = false): void {
    this.state.selectedRequestId = requestId;
    if (fetchFresh && this.apiClient) {
      void this.loadRequestDetails(requestId, true);
    } else {
      this.render();
    }
  }

  /**
   * Sets the pending requests list and updates view status.
   */
  public setPendingRequests(requests: readonly ApprovalRequest[]): void {
    this.state.pendingRequests = requests;
    this.state.pendingStatus = requests.length === 0 ? 'empty' : 'idle';
    if (!this.state.selectedRequestId || !requests.some((r) => r.id === this.state.selectedRequestId)) {
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
    this.state.pendingStatus = message ? 'error' : this.state.pendingRequests.length === 0 ? 'empty' : 'idle';
    this.render();
  }

  /**
   * Updates contact profile.
   */
  public setProfile(profile: TrustedContactProfile | null): void {
    this.state.contactProfile = profile;
    this.render();
  }

  /**
   * Returns a copy of the current dashboard state.
   */
  public getState(): Readonly<DashboardShellState> {
    return { ...this.state };
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
      default:
        return 'Trusted Contact Portal';
    }
  }

  /**
   * Cleans up event listeners and removes DOM nodes.
   */
  public destroy(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.hashChangeHandler && typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this.hashChangeHandler);
      this.hashChangeHandler = null;
    }

    while (this.rootContainer.firstChild) {
      this.rootContainer.removeChild(this.rootContainer.firstChild);
    }
  }
}
