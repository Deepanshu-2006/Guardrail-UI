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
  ApprovalRequest,
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
    const pendingSection = renderPendingApprovals({
      requests: this.state.pendingRequests,
      selectedRequestId: this.state.selectedRequestId,
      status: this.state.pendingStatus,
      errorMessage: this.state.errorMessage,
      onRequestSelect: (id) => this.selectRequest(id),
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
   * Selects an approval request in the pending list for inspection.
   */
  public selectRequest(requestId: string): void {
    this.state.selectedRequestId = requestId;
    this.render();
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
    if (this.hashChangeHandler && typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this.hashChangeHandler);
      this.hashChangeHandler = null;
    }

    while (this.rootContainer.firstChild) {
      this.rootContainer.removeChild(this.rootContainer.firstChild);
    }
  }
}
