/**
 * Guardrail Trusted-Contact Dashboard - Component Shell Test Suite
 *
 * Verifies:
 * 1. Mounting & DOM Hierarchy:
 *    - Skip link, app layout, sidebar, top header, main landmark.
 * 2. Brand Area:
 *    - Shield badge, brand name "Guardrail", "Trusted Contact Portal" tag.
 * 3. Navigation & Section Switching:
 *    - Switching between Overview, Pending Approvals, and Decision History.
 *    - aria-current="page" update and keyboard accessibility.
 * 4. Overview Section:
 *    - Decoupled Action Execution Callout.
 *    - Non-fabricated metric cards (assigned wards, pending count, portal status).
 *    - Recent activity intentional empty placeholder.
 * 5. Pending Approvals Two-Pane Layout:
 *    - Empty state placeholder ("No Pending Approval Requests").
 *    - Loading skeleton state (role="status", aria-busy="true").
 *    - Error banner state.
 *    - Request list rendering with semantic risk badges (LOW, MEDIUM, HIGH, CRITICAL).
 *    - Request detail pane inspection (origin, actionType, category, riskReasons list, decoupling notice).
 * 6. Decision History Section:
 *    - Intentional empty placeholder ("No Prior Decisions Recorded").
 * 7. Account / Trusted Contact Area:
 *    - Authenticated session representation (actorId, role, assigned ward).
 *    - Unauthenticated standalone placeholder.
 * 8. Safe Text Rendering & Injection Resistance:
 *    - Dynamic content rendered securely without HTML injection.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

// Minimal DOM simulation for Node.js test environment
class MockDOMTokenList {
  private classes: Set<string> = new Set();
  constructor(initial: string = '') {
    if (initial) {
      initial.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    }
  }
  add(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.add(t));
  }
  remove(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.delete(t));
  }
  contains(token: string): boolean {
    return this.classes.has(token);
  }
  toString(): string {
    return Array.from(this.classes).join(' ');
  }
}

class MockDOMElement {
  public tagName: string;
  public id: string = '';
  public attributes: Record<string, string> = {};
  public style: Record<string, string> = {};
  public children: MockDOMElement[] = [];
  public parentNode: MockDOMElement | null = null;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  private _textContent: string = '';
  public classList: MockDOMTokenList;
  public tabIndex: number = 0;
  public href: string = '';
  public type: string = '';
  public disabled: boolean = false;
  public value: string = '';
  public rows: number = 0;
  public placeholder: string = '';
  public htmlFor: string = '';

  get innerHTML(): string {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`).join('');
  }
  set innerHTML(val: string) {
    this.children = [];
    this._textContent = val;
  }

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockDOMTokenList();
  }

  get className(): string {
    return this.classList.toString();
  }
  set className(val: string) {
    this.classList = new MockDOMTokenList(val);
  }

  get textContent(): string {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
  }

  get firstChild(): MockDOMElement | null {
    return this.children[0] || null;
  }

  appendChild<T extends MockDOMElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends MockDOMElement>(child: T): T {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name.toLowerCase()] = String(value);
  }

  getAttribute(name: string): string | null {
    return this.attributes[name.toLowerCase()] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name.toLowerCase()];
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  }

  dispatchEvent(event: { type: string; defaultPrevented?: boolean }): boolean {
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) {
      h(event);
    }
    return true;
  }

  click(): void {
    this.dispatchEvent({ type: 'click', defaultPrevented: false });
  }

  focus(): void {}

  private findSimpleMatches(part: string): MockDOMElement[] {
    const matches: MockDOMElement[] = [];
    const search = (node: MockDOMElement) => {
      let isMatch = false;
      if (part.startsWith('#')) {
        isMatch = node.id === part.slice(1);
      } else if (part.startsWith('.')) {
        const classes = part.split('.').filter(Boolean);
        isMatch = classes.every((c) => node.classList.contains(c));
      } else if (part.includes('.')) {
        const [tag, ...classes] = part.split('.');
        isMatch =
          node.tagName.toLowerCase() === tag.toLowerCase() &&
          classes.every((c) => node.classList.contains(c));
      } else {
        isMatch = node.tagName.toLowerCase() === part.toLowerCase();
      }
      if (isMatch) {
        matches.push(node);
      }
      for (const child of node.children) {
        search(child);
      }
    };
    for (const child of this.children) {
      search(child);
    }
    return matches;
  }

  querySelector(selector: string): MockDOMElement | null {
    const parts = selector.trim().split(/\s+/);
    let currentSet: MockDOMElement[] = [this];
    for (const part of parts) {
      const nextSet: MockDOMElement[] = [];
      for (const node of currentSet) {
        nextSet.push(...node.findSimpleMatches(part));
      }
      currentSet = nextSet;
      if (currentSet.length === 0) return null;
    }
    return currentSet[0] || null;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const parts = selector.trim().split(/\s+/);
    let currentSet: MockDOMElement[] = [this];
    for (const part of parts) {
      const nextSet: MockDOMElement[] = [];
      for (const node of currentSet) {
        nextSet.push(...node.findSimpleMatches(part));
      }
      currentSet = nextSet;
    }
    return currentSet;
  }
}

// Global environment mock
const mockDocument = {
  createElement(tag: string): MockDOMElement {
    return new MockDOMElement(tag);
  },
  getElementById(id: string): MockDOMElement | null {
    return rootElement.querySelector(`#${id}`);
  },
  querySelector(sel: string): MockDOMElement | null {
    return rootElement.querySelector(sel);
  },
  querySelectorAll(sel: string): MockDOMElement[] {
    return rootElement.querySelectorAll(sel);
  },
};

const mockWindow = {
  location: { hash: '' },
  listeners: {} as Record<string, ((e: any) => void)[]>,
  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  },
  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  },
};

(globalThis as any).document = mockDocument;
(globalThis as any).window = mockWindow;

const rootElement = new MockDOMElement('div');
rootElement.id = 'dashboard-app';
const testContainer = rootElement as unknown as HTMLElement;

import { DashboardShell } from '../shell.js';
import {
  ApprovalApiClient,
  ApprovalRequest,
  ApprovalStatus,
  RiskLevel,
  ActionType,
  ActionCategory,
} from '../types.js';
import {
  renderRequestDetailView,
} from '../components/detail.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAILED: ${message}`);
    process.exitCode = 1;
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalTests++;
  if (actual === expected) {
    passedTests++;
    console.log(`  ✓ ${message}: ${String(actual)}`);
  } else {
    console.error(`  ✗ FAILED: ${message}. Expected "${String(expected)}", received "${String(actual)}"`);
    process.exitCode = 1;
  }
}

function createMockResponse(status: number, body: unknown, statusText = 'OK'): Response {
  const jsonString = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => jsonString,
    json: async () => JSON.parse(jsonString),
  } as unknown as Response;
}

console.log('\n============================================================');
console.log('🛡️ GUARDRAIL TRUSTED-CONTACT DASHBOARD COMPONENT SHELL TESTS');
console.log('============================================================\n');

// Sample test fixture
const SAMPLE_REQUEST: ApprovalRequest = {
  id: 'apr_01J9X4M5N2ABCD1234EFGH',
  actionId: 'act_checkout_submit',
  requesterId: 'usr_alice',
  status: ApprovalStatus.PENDING,
  actionDescription: 'Submit $450.00 Wire Transfer to External Account',
  actionType: ActionType.SUBMIT,
  category: ActionCategory.PAYMENT,
  riskLevel: RiskLevel.CRITICAL,
  riskScore: 92,
  riskReasons: [
    'Destination account is an unverified external entity',
    'Transaction amount exceeds standard automated threshold',
  ],
  origin: 'https://bank.example.com',
  hostname: 'bank.example.com',
  pageTitle: 'Wire Transfer Confirmation',
  createdAt: '2026-10-20T10:00:00.000Z',
  expiresAt: '2026-10-20T10:15:00.000Z',
};

async function runDashboardTests() {
  // Test Suite 1: Mounting & DOM Structure
  console.log('▶ Test Suite 1: Dashboard Shell Mounting & Core Layout');
  {
    const shell = new DashboardShell({
      container: testContainer,
    });

    assert(rootElement.querySelector('.gd-skip-link') !== null, 'Accessible skip-to-content link rendered');
    assert(rootElement.querySelector('.gd-dashboard-app') !== null, 'App wrapper rendered');
    assert(rootElement.querySelector('.gd-sidebar') !== null, 'Sidebar navigation rendered');
    assert(rootElement.querySelector('.gd-top-header') !== null, 'Top application header rendered');
    assert(rootElement.querySelector('#main-content') !== null, 'Main content landmark with id="main-content" rendered');
    assertEquals(shell.getState().activeView, 'overview', 'Initial view defaults to overview');

    shell.destroy();
  }

  // Test Suite 2: Brand Area
  console.log('\n▶ Test Suite 2: Guardrail Brand Representation');
  {
    const shell = new DashboardShell({ container: testContainer });

    const brandName = rootElement.querySelector('.gd-brand-name');
    assert(brandName !== null, 'Brand name element present');
    assertEquals(brandName?.textContent, 'Guardrail', 'Brand name is "Guardrail"');

    const brandTag = rootElement.querySelector('.gd-brand-tag');
    assertEquals(brandTag?.textContent, 'Trusted Contact Portal', 'Tagline indicates "Trusted Contact Portal"');

    shell.destroy();
  }

  // Test Suite 3: Navigation & View Switching
  console.log('\n▶ Test Suite 3: Navigation & Active State Management');
  {
    const shell = new DashboardShell({ container: testContainer });

    // Overview should have aria-current="page"
    const navLinks = rootElement.querySelectorAll('.gd-nav-link');
    assertEquals(navLinks.length, 3, 'Renders 3 navigation links (Overview, Pending, History)');
    assertEquals(navLinks[0]?.getAttribute('aria-current'), 'page', 'Overview link has aria-current="page"');

    // Switch to Pending
    shell.setActiveView('pending', false);
    assertEquals(shell.getState().activeView, 'pending', 'activeView state updated to pending');
    const updatedLinks = rootElement.querySelectorAll('.gd-nav-link');
    assertEquals(updatedLinks[1]?.getAttribute('aria-current'), 'page', 'Pending link now has aria-current="page"');
    assert(updatedLinks[0]?.getAttribute('aria-current') === null, 'Overview link no longer has aria-current');

    // Switch to History
    shell.setActiveView('history', false);
    assertEquals(shell.getState().activeView, 'history', 'activeView state updated to history');

    shell.destroy();
  }

  // Test Suite 4: Overview Section Elements
  console.log('\n▶ Test Suite 4: Overview Section & Safety Architecture Callout');
  {
    const shell = new DashboardShell({
      container: testContainer,
      initialProfile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        assignedWardId: 'usr_alice',
        isAuthenticated: true,
      },
    });

    const callout = rootElement.querySelector('.gd-callout');
    assert(callout !== null, 'Decoupled Action Execution Architecture callout present');
    assert(
      callout?.textContent.includes('decouples approval decisions from browser action execution') ?? false,
      'Callout explicitly documents decoupled execution guarantee'
    );

    const metricCards = rootElement.querySelectorAll('.gd-metric-card');
    assertEquals(metricCards.length, 3, 'Renders exactly 3 non-fabricated metric cards');

    // Ward card
    const wardValue = metricCards[0]?.querySelector('.gd-metric-value');
    assertEquals(wardValue?.textContent, '1', 'Reflects 1 assigned ward from profile');

    // Empty activity placeholder
    const activityPlaceholder = rootElement.querySelector('#view-overview .gd-placeholder');
    assert(activityPlaceholder !== null, 'Recent activity renders intentional empty placeholder');
    assertEquals(
      activityPlaceholder?.querySelector('.gd-placeholder-title')?.textContent,
      'No Recent Activity Recorded',
      'Activity empty title is correct'
    );

    shell.destroy();
  }

  // Test Suite 5: Pending Approvals Two-Pane Layout & Placeholders
  console.log('\n▶ Test Suite 5: Pending Approvals Two-Pane Layout');
  {
    // 5.1 Empty State
    const emptyShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [],
    });

    const emptyPlaceholder = rootElement.querySelector('#view-pending .gd-list-pane .gd-placeholder');
    assert(emptyPlaceholder !== null, 'Empty placeholder rendered when no requests pending');
    assertEquals(
      emptyPlaceholder?.querySelector('.gd-placeholder-title')?.textContent,
      'No Pending Approval Requests',
      'Empty state title is correct'
    );

    // 5.2 Loading Skeleton State
    emptyShell.setLoading(true);
    const skeleton = rootElement.querySelector('#view-pending .gd-skeleton');
    assert(skeleton !== null, 'Loading skeleton pulse rendered when status is loading');
    assertEquals(
      rootElement.querySelector('#view-pending .gd-request-card')?.getAttribute('aria-busy'),
      'true',
      'Loading state has aria-busy="true"'
    );

    // 5.3 Error State
    emptyShell.setError('Unable to reach Guardrail approval server. Local isolation maintained.');
    const errorBanner = rootElement.querySelector('.gd-error-banner');
    assert(errorBanner !== null, 'Error banner rendered when error occurs');
    assert(
      errorBanner?.textContent.includes('Unable to reach Guardrail approval server') ?? false,
      'Error banner displays sanitized message'
    );

    emptyShell.destroy();
  }

  // Test Suite 6: Request List & Request Details Inspection
  console.log('\n▶ Test Suite 6: Request Selection & Detailed Safety Inspection');
  {
    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [SAMPLE_REQUEST],
    });

    // Request card in list
    const card = rootElement.querySelector('.gd-request-card');
    assert(card !== null, 'Request card rendered in list');
    assertEquals(card?.getAttribute('aria-selected'), 'true', 'Single request is selected by default');

    // Risk badge
    const badge = card?.querySelector('.gd-risk-badge');
    assertEquals(badge?.textContent, 'CRITICAL', 'Risk badge reflects CRITICAL risk level');
    assert(badge?.classList.contains('critical') ?? false, 'Risk badge has .critical styling class');

    // Request Detail Pane
    const detailPane = rootElement.querySelector('.gd-detail-pane');
    assert(detailPane !== null, 'Detail pane rendered');

    const dTitle = detailPane?.querySelector('.gd-detail-title');
    assertEquals(dTitle?.textContent, SAMPLE_REQUEST.actionDescription, 'Action description rendered in detail pane');

    const dId = detailPane?.querySelector('.gd-detail-id');
    assert(dId?.textContent.includes(SAMPLE_REQUEST.id) ?? false, 'Canonical request ID rendered');

    // Heuristic Risk Reasons
    const reasons = detailPane?.querySelectorAll('.gd-risk-reason-item') ?? [];
    assertEquals(reasons.length, 2, 'Renders 2 heuristic risk reason bullet points');
    assertEquals(
      reasons[0]?.textContent,
      'Destination account is an unverified external entity',
      'Reason 1 text matches'
    );

    // Decoupling & Decision Notice
    const notice = detailPane?.querySelector('.gd-decision-notice');
    assert(notice !== null, 'Decoupled execution notice present in detail pane');
    assert(
      notice?.textContent.includes('Approving this request records reviewer consent') ?? false,
      'Notice informs contact that action is not remotely executed'
    );

    shell.destroy();
  }

  // Test Suite 7: Decision History Section
  console.log('\n▶ Test Suite 7: Decision History Section & Placeholders');
  {
    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'history',
    });

    const historySection = rootElement.querySelector('#view-history');
    assert(historySection !== null, 'Decision history section rendered');

    const historyPlaceholder = historySection?.querySelector('.gd-placeholder');
    assert(historyPlaceholder !== null, 'Intentional empty placeholder rendered for history');
    assertEquals(
      historyPlaceholder?.querySelector('.gd-placeholder-title')?.textContent,
      'No Prior Decisions Recorded',
      'History empty title is correct'
    );

    shell.destroy();
  }

  // Test Suite 8: Account / Trusted Contact Identity Area
  console.log('\n▶ Test Suite 8: Account Identity & Privacy Protection');
  {
    // Authenticated Profile
    const authShell = new DashboardShell({
      container: testContainer,
      initialProfile: {
        actorId: 'tc_dave',
        role: 'TRUSTED_CONTACT',
        assignedWardId: 'usr_alice',
        isAuthenticated: true,
      },
    });

    const accountArea = rootElement.querySelector('.gd-sidebar-footer');
    assert(accountArea !== null, 'Account area rendered at bottom of sidebar');

    const accountName = accountArea?.querySelector('.gd-account-name');
    assertEquals(accountName?.textContent, 'tc_dave', 'Displays authenticated actor ID');

    const accountRole = accountArea?.querySelector('.gd-account-role');
    assertEquals(accountRole?.textContent, 'Contact for usr_alice', 'Displays assigned ward relation');

    authShell.destroy();

    // Unauthenticated State
    const unauthShell = new DashboardShell({
      container: testContainer,
      initialProfile: null,
    });

    const unauthName = rootElement.querySelector('.gd-account-name');
    assertEquals(unauthName?.textContent, 'Not Authenticated', 'Displays "Not Authenticated" when profile is null');

    unauthShell.destroy();
  }

  // Test Suite 9: Safe DOM APIs & XSS Prevention
  console.log('\n▶ Test Suite 9: Safe Text Rendering & Injection Resistance');
  {
    const maliciousPayload: ApprovalRequest = {
      id: 'apr_hack',
      actionId: 'act_malicious',
      requesterId: '<script>alert(1)</script>',
      status: ApprovalStatus.PENDING,
      actionDescription: '<img src=x onerror=alert(2)> Delete Bank',
      actionType: ActionType.CLICK,
      riskLevel: RiskLevel.CRITICAL,
      riskReasons: ['<script>evil()</script>'],
      origin: 'https://evil.com?param=<script>',
      hostname: 'evil.com',
      createdAt: '2026-10-20T10:00:00.000Z',
      expiresAt: '2026-10-20T10:15:00.000Z',
    };

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [maliciousPayload],
    });

    const descEl = rootElement.querySelector('.gd-request-description');
    assertEquals(descEl?.textContent, '<img src=x onerror=alert(2)> Delete Bank', 'Treated strictly as text content');

    const scriptTags = rootElement.querySelectorAll('script');
    assertEquals(scriptTags.length, 0, 'Zero script tags injected into DOM tree');

    shell.destroy();
  }

  // Test Suite 10: Populated Pending Approvals via Real ApprovalApiClient
  console.log('\n▶ Test Suite 10: Populated Pending Approvals via ApprovalApiClient');
  {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? 'GET';
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;

      return createMockResponse(200, {
        success: true,
        data: [
          {
            id: 'apr_wire_001',
            actionId: 'act_wire_001',
            requesterId: 'usr_alice',
            status: ApprovalStatus.PENDING,
            actionDescription: 'Send $1,000 wire to Acme Corp',
            actionType: ActionType.SUBMIT,
            category: ActionCategory.PAYMENT,
            riskLevel: RiskLevel.HIGH,
            riskScore: 85,
            riskReasons: ['External wire transfer exceeds standard threshold'],
            origin: 'https://bank.example.com',
            hostname: 'bank.example.com',
            pageTitle: 'Wire Transfer Portal',
            createdAt: '2026-10-20T10:00:00.000Z',
            expiresAt: '2026-10-20T10:15:00.000Z',
          },
          {
            id: 'apr_delete_002',
            actionId: 'act_delete_002',
            requesterId: 'usr_alice',
            status: ApprovalStatus.PENDING,
            actionDescription: 'Delete cloud backup database',
            actionType: ActionType.CLICK,
            category: ActionCategory.DESTRUCTIVE,
            riskLevel: RiskLevel.CRITICAL,
            riskScore: 100,
            riskReasons: ['Destructive deletion of critical backup volume'],
            origin: 'https://cloud.example.com',
            hostname: 'cloud.example.com',
            pageTitle: 'Database Settings',
            createdAt: '2026-10-20T10:05:00.000Z',
            expiresAt: '2026-10-20T10:20:00.000Z',
          },
        ],
      });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: mockFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
    });

    await shell.fetchPendingRequests();

    // Verify wire endpoint
    assertEquals(capturedUrl, 'http://localhost:3000/api/v1/approvals/pending', 'Verified pending-requests endpoint path called');
    assertEquals(capturedMethod, 'GET', 'Uses GET method per integration contract');
    assertEquals(capturedHeaders['Authorization'], 'Bearer carol-token', 'Bearer token passed in Authorization header');
    assert(!('approverId' in capturedHeaders), 'Frontend-supplied approverId is NOT passed in headers');

    // Verify populated UI
    const cards = rootElement.querySelectorAll('.gd-request-card');
    assertEquals(cards.length, 2, 'Renders exactly 2 populated request cards');

    const state = shell.getState();
    assertEquals(state.pendingRequests.length, 2, 'Shell state contains 2 pending requests');
    assertEquals(state.pendingStatus, 'idle', 'Status transitioned to idle');
    assertEquals(state.selectedRequestId, 'apr_wire_001', 'First request selected by default');

    // Verify detail pane displays safe metadata
    const detailPane = rootElement.querySelector('.gd-detail-pane');
    assert(detailPane !== null, 'Detail pane is rendered');
    const titleEl = rootElement.querySelector('.gd-detail-title');
    assertEquals(titleEl?.textContent, 'Send $1,000 wire to Acme Corp', 'Detail pane displays action description');

    shell.destroy();
  }

  // Test Suite 11: Empty Results & Intentional Empty State Handling
  console.log('\n▶ Test Suite 11: Empty Results & Intentional Empty Placeholder');
  {
    const mockFetch = async (): Promise<Response> => {
      return createMockResponse(200, {
        success: true,
        data: [],
      });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: mockFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
    });

    await shell.fetchPendingRequests();

    const state = shell.getState();
    assertEquals(state.pendingRequests.length, 0, 'Zero requests in state');
    assertEquals(state.pendingStatus, 'empty', 'pendingStatus is empty');

    const emptyPlaceholder = rootElement.querySelector('#view-pending .gd-list-pane .gd-placeholder');
    assert(emptyPlaceholder !== null, 'Intentional empty placeholder is displayed');
    const pTitle = emptyPlaceholder?.querySelector('.gd-placeholder-title');
    assertEquals(pTitle?.textContent, 'No Pending Approval Requests', 'Empty state title matches contract');

    shell.destroy();
  }

  // Test Suite 12: Loading States & Skeletons
  console.log('\n▶ Test Suite 12: Loading Skeletons & Refresh State');
  {
    let resolvePromise: (value: Response) => void;
    const pendingPromise = new Promise<Response>((resolve) => {
      resolvePromise = resolve;
    });

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: () => pendingPromise,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
    });

    // Start fetch in background
    const fetchPromise = shell.fetchPendingRequests();

    // Check loading state while in-flight
    assertEquals(shell.getState().pendingStatus, 'loading', 'Status is loading while request is in-flight');
    const skeleton = rootElement.querySelector('.gd-skeleton');
    assert(skeleton !== null, 'Skeleton placeholder rendered while loading');

    const refreshBtn = rootElement.querySelector('.gd-btn-refresh') as any;
    assert(refreshBtn !== null, 'Refresh button rendered in header');
    assertEquals(refreshBtn?.disabled, true, 'Refresh button disabled during loading');

    // Resolve response
    resolvePromise!(createMockResponse(200, { success: true, data: [] }));
    await fetchPromise;

    assertEquals(shell.getState().pendingStatus, 'empty', 'Status updated to empty after fetch resolves');
    shell.destroy();
  }

  // Test Suite 13: Authentication Failure Handling (401 UNAUTHENTICATED)
  console.log('\n▶ Test Suite 13: Authentication Failure (401 UNAUTHENTICATED)');
  {
    const mockFetch = async (): Promise<Response> => {
      return createMockResponse(401, {
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Missing or expired Authorization Bearer token.',
          statusCode: 401,
        },
      });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'bad-token',
      fetchFn: mockFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialProfile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        isAuthenticated: true,
      },
      apiClient: client,
      autoFetch: false,
    });

    await shell.fetchPendingRequests();

    const state = shell.getState();
    assertEquals(state.pendingStatus, 'error', 'Status set to error on 401');
    assert(state.contactProfile === null, 'Session profile invalidated on unauthenticated failure');

    const errorBanner = rootElement.querySelector('.gd-error-banner');
    assert(errorBanner !== null, 'Error banner displayed');
    assert(
      errorBanner?.textContent?.includes('Authentication required') ?? false,
      'Error banner explains authentication is required'
    );

    const retryBtn = rootElement.querySelector('.gd-btn-retry');
    assert(retryBtn !== null, 'Retry button rendered in error banner');

    shell.destroy();
  }

  // Test Suite 14: Multi-Tenant Authorization Failure Handling (404/403 NOT_FOUND_OR_DENIED)
  console.log('\n▶ Test Suite 14: Multi-Tenant Authorization Failure (404 NOT_FOUND_OR_DENIED)');
  {
    const mockFetch = async (): Promise<Response> => {
      return createMockResponse(404, {
        success: false,
        error: {
          code: 'NOT_FOUND_OR_DENIED',
          message: 'Access denied: Request not found or insufficient permissions.',
          statusCode: 404,
        },
      });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'stranger-token',
      fetchFn: mockFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
    });

    await shell.fetchPendingRequests();

    assertEquals(shell.getState().pendingStatus, 'error', 'Status is error');
    const errorBanner = rootElement.querySelector('.gd-error-banner');
    assert(
      errorBanner?.textContent?.includes('Access denied') ?? false,
      'Error banner indicates access denied without leaking internal tenancy details'
    );

    shell.destroy();
  }

  // Test Suite 15: Network Failure & Timeout Resilience
  console.log('\n▶ Test Suite 15: Network Failure & Timeout Resilience');
  {
    // Network Drop (Failed to fetch)
    const deadFetch = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch (ECONNREFUSED)');
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: deadFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
    });

    await shell.fetchPendingRequests();

    assertEquals(shell.getState().pendingStatus, 'error', 'Status is error on network drop');
    const errorBanner = rootElement.querySelector('.gd-error-banner');
    assert(
      errorBanner?.textContent?.includes('Network connection error') ?? false,
      'Error banner communicates network connectivity failure'
    );

    shell.destroy();
  }

  // Test Suite 16: Malformed Response Protection
  console.log('\n▶ Test Suite 16: Malformed Response Protection');
  {
    // Non-array data payload
    const malformedFetch = async (): Promise<Response> => {
      return createMockResponse(200, {
        success: true,
        data: { unexpected: 'object instead of array' },
      });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: malformedFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
    });

    await shell.fetchPendingRequests();

    assertEquals(shell.getState().pendingStatus, 'error', 'Non-array data rejected as error');
    assert(
      shell.getState().errorMessage?.includes('invalid, non-array') ?? false,
      'Protocol error reported for non-array response'
    );

    shell.destroy();
  }

  // Test Suite 17: Concurrent Request Deduplication & Coalescing
  console.log('\n▶ Test Suite 17: Concurrent Request Deduplication & Coalescing');
  {
    let fetchCount = 0;
    const countingFetch = async (): Promise<Response> => {
      fetchCount++;
      // Simulate asynchronous delay
      await new Promise((r) => setTimeout(r, 10));
      return createMockResponse(200, { success: true, data: [] });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: countingFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
    });

    // Trigger 3 concurrent fetch calls
    const p1 = shell.fetchPendingRequests();
    const p2 = shell.fetchPendingRequests();
    const p3 = shell.fetchPendingRequests();

    await Promise.all([p1, p2, p3]);

    assertEquals(fetchCount, 1, 'Exactly ONE network request dispatched for 3 concurrent fetch calls');

    shell.destroy();
  }

  // Test Suite 18: Manual Refresh and State Invalidation
  console.log('\n▶ Test Suite 18: Manual Refresh and State Invalidation');
  {
    let callNumber = 0;
    const dynamicFetch = async (): Promise<Response> => {
      callNumber++;
      if (callNumber === 1) {
        return createMockResponse(200, {
          success: true,
          data: [
            {
              id: 'apr_first',
              actionId: 'act_1',
              requesterId: 'usr_alice',
              status: ApprovalStatus.PENDING,
              actionDescription: 'First Request',
              actionType: ActionType.CLICK,
              riskLevel: RiskLevel.LOW,
              hostname: 'example.com',
              createdAt: '2026-10-20T10:00:00.000Z',
            },
          ],
        });
      }
      return createMockResponse(200, {
        success: true,
        data: [
          {
            id: 'apr_first',
            actionId: 'act_1',
            requesterId: 'usr_alice',
            status: ApprovalStatus.PENDING,
            actionDescription: 'First Request',
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.LOW,
            hostname: 'example.com',
            createdAt: '2026-10-20T10:00:00.000Z',
          },
          {
            id: 'apr_second',
            actionId: 'act_2',
            requesterId: 'usr_alice',
            status: ApprovalStatus.PENDING,
            actionDescription: 'Second Request',
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.HIGH,
            hostname: 'example.com',
            createdAt: '2026-10-20T10:05:00.000Z',
          },
        ],
      });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: dynamicFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
    });

    await shell.fetchPendingRequests();
    assertEquals(shell.getState().pendingRequests.length, 1, 'Initial fetch has 1 request');

    // Trigger refresh
    await shell.refresh();
    assertEquals(shell.getState().pendingRequests.length, 2, 'Refreshed fetch updates to 2 requests');

    shell.destroy();
  }

  // Test Suite 19: Privacy Whitelist & Malicious Sensitive Fields Stripping
  console.log('\n▶ Test Suite 19: Strict Privacy Whitelist & Sensitive Fields Exclusion');
  {
    // A mock server sends an approval request with sensitive keys injected
    const dirtyServerResponse = {
      success: true,
      data: [
        {
          id: 'apr_safe_001',
          actionId: 'act_safe_001',
          requesterId: 'usr_alice',
          status: ApprovalStatus.PENDING,
          actionDescription: 'Checkout cart at ShoppingSite',
          actionType: ActionType.SUBMIT,
          category: ActionCategory.PAYMENT,
          riskLevel: RiskLevel.MEDIUM,
          hostname: 'shoppingsite.com',
          createdAt: '2026-10-20T10:00:00.000Z',
          // Maliciously or accidentally leaked sensitive fields
          password: 'super_secret_password',
          otp: '987654',
          cardNumber: '4111222233334444',
          cvv: '123',
          authToken: 'secret_user_token',
          cookies: 'session=abc',
        },
      ],
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: async () => createMockResponse(200, dirtyServerResponse),
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
    });

    await shell.fetchPendingRequests();

    const rootHTML = rootElement.innerHTML;
    assert(!rootHTML.includes('super_secret_password'), 'Password is never rendered in DOM');
    assert(!rootHTML.includes('987654'), 'OTP is never rendered in DOM');
    assert(!rootHTML.includes('4111222233334444'), 'Card number is never rendered in DOM');
    assert(!rootHTML.includes('secret_user_token'), 'Auth token is never rendered in DOM');

    shell.destroy();
  }

  // Test Suite 20: Comprehensive Risk Level Explanations & Score Range Semantics
  console.log('\n▶ Test Suite 20: Risk Level Plain-Language Explanations & Non-Malice Disclaimer');
  {
    const riskLevels = [
      {
        level: RiskLevel.LOW,
        score: 10,
        expectedClass: 'low',
        expectedKeyword: 'Low operational impact',
      },
      {
        level: RiskLevel.MEDIUM,
        score: 42,
        expectedClass: 'medium',
        expectedKeyword: 'Moderate operational impact',
      },
      {
        level: RiskLevel.HIGH,
        score: 71,
        expectedClass: 'high',
        expectedKeyword: 'Elevated operational impact',
      },
      {
        level: RiskLevel.CRITICAL,
        score: 98,
        expectedClass: 'critical',
        expectedKeyword: 'High operational impact',
      },
    ];

    for (const item of riskLevels) {
      const testReq: ApprovalRequest = {
        id: `apr_risk_${item.expectedClass}`,
        actionId: `act_${item.expectedClass}`,
        requesterId: 'usr_alice',
        status: ApprovalStatus.PENDING,
        actionDescription: `Test Action for ${item.level}`,
        actionType: ActionType.CLICK,
        riskLevel: item.level,
        riskScore: item.score,
        riskReasons: [`Evaluated as ${item.level} operational impact`],
        hostname: 'example.com',
        createdAt: '2026-10-20T10:00:00.000Z',
        expiresAt: '2026-10-20T10:15:00.000Z',
      };

      const view = renderRequestDetailView({ request: testReq });

      const badge = view.querySelector('.gd-risk-badge');
      assertEquals(badge?.textContent, item.level, `Risk badge displays ${item.level}`);
      assert(badge?.classList.contains(item.expectedClass) ?? false, `Risk badge has .${item.expectedClass} class`);

      const explanation = view.querySelector('.gd-risk-explanation');
      assert(
        explanation?.textContent.includes(item.expectedKeyword) ?? false,
        `Risk explanation for ${item.level} contains "${item.expectedKeyword}"`
      );

      const scoreEl = view.querySelector('.gd-risk-score-value');
      assert(
        scoreEl?.textContent.includes(`${item.score} / 100`) ?? false,
        `Displays formatted score ${item.score} / 100`
      );

      // Verify non-malicious disclaimer (Requirement 10)
      const disclaimer = view.querySelector('.gd-risk-disclaimer');
      assert(disclaimer !== null, 'Non-malicious risk disclaimer is rendered');
      assert(
        disclaimer?.textContent.includes('NOT that the website or action is confirmed to be malicious') ?? false,
        'Disclaimer explicitly states high risk score does not mean action is malicious'
      );
    }
  }

  // Test Suite 21: Graceful Degradation on Missing & Malformed Metadata
  console.log('\n▶ Test Suite 21: Graceful Handling of Missing Metadata & Fallbacks');
  {
    // Minimal request missing optional fields
    const minimalReq: ApprovalRequest = {
      id: 'apr_minimal_001',
      actionId: 'act_min_001',
      requesterId: 'usr_alice',
      status: ApprovalStatus.PENDING,
      actionDescription: 'Minimal action without optional metadata',
      actionType: undefined as any,
      riskLevel: RiskLevel.LOW,
      riskReasons: [], // Empty heuristics
      createdAt: '2026-10-20T10:00:00.000Z',
      expiresAt: '', // Missing expiration
    };

    const view = renderRequestDetailView({ request: minimalReq });
    const text = view.textContent;

    // Missing hostname & origin fallback
    assert(text.includes('Not reported'), 'Missing hostname/origin displays "Not reported"');

    // Missing category fallback
    assert(text.includes('General'), 'Missing semantic category defaults to "General"');

    // Missing actionType fallback
    assert(text.includes('Standard interaction'), 'Missing actionType defaults to "Standard interaction"');

    // Missing riskScore fallback
    assert(text.includes('Not Scored'), 'Missing riskScore displays "Not Scored"');

    // Empty riskReasons fallback (DO NOT invent new reasons)
    const emptyReasonsNotice = view.querySelector('.gd-risk-empty-text');
    assert(emptyReasonsNotice !== null, 'Displays empty heuristics placeholder when riskReasons is empty');
    assertEquals(
      emptyReasonsNotice?.textContent,
      'No specific risk heuristics reported by the evaluation engine.',
      'Heuristic empty text does not invent reasons'
    );

    // Missing expiresAt fallback
    assert(text.includes('No expiration deadline'), 'Missing expiresAt displays "No expiration deadline"');

    // Missing pageTitle fallback
    assert(text.includes('Untitled webpage'), 'Missing pageTitle displays "Untitled webpage"');

    // Hostname inferred from origin URL
    const originOnlyReq: ApprovalRequest = {
      ...minimalReq,
      id: 'apr_origin_only',
      origin: 'https://subdomain.company.com:8080/path',
      hostname: undefined,
    };
    const originView = renderRequestDetailView({ request: originOnlyReq });
    assert(
      originView.textContent.includes('subdomain.company.com'),
      'Safely parses hostname from origin URL when hostname field is missing'
    );

    // Null/undefined request placeholder
    const nullView = renderRequestDetailView({ request: null });
    const nullPlaceholder = nullView.querySelector('.gd-placeholder-title');
    assertEquals(
      nullPlaceholder?.textContent,
      'Select an Approval Request',
      'Renders placeholder when request is null'
    );

    // Loading state
    const loadingView = renderRequestDetailView({ request: null, isLoading: true });
    const loadingWrap = loadingView.querySelector('.gd-detail-loading-wrap');
    assertEquals(loadingWrap?.getAttribute('aria-busy'), 'true', 'Loading state has aria-busy="true"');

    // Error state
    let retryCalled = false;
    const errorView = renderRequestDetailView({
      request: null,
      errorMessage: 'Failed to retrieve approval request details.',
      onRefresh: () => {
        retryCalled = true;
      },
    });
    const errBanner = errorView.querySelector('.gd-error-banner');
    assert(errBanner !== null, 'Error banner rendered when errorMessage provided');
    assert(
      errBanner?.textContent.includes('Failed to retrieve approval request details') ?? false,
      'Error banner displays error message'
    );
    const retryBtn = errorView.querySelector('.gd-btn-retry') as unknown as HTMLButtonElement;
    retryBtn?.click();
    assert(retryCalled, 'Retry button triggers onRefresh callback');
  }

  // Test Suite 22: Distinction Between Browser Action and Approval Governance Record
  console.log('\n▶ Test Suite 22: Distinction Between Browser Action and Governance Record');
  {
    const req: ApprovalRequest = {
      id: 'apr_distinct_001',
      actionId: 'act_delete_db',
      requesterId: 'usr_alice',
      status: ApprovalStatus.PENDING,
      actionDescription: 'Purge Production Database Tables',
      actionType: ActionType.CLICK,
      category: ActionCategory.DESTRUCTIVE,
      riskLevel: RiskLevel.CRITICAL,
      riskScore: 100,
      riskReasons: ['Irreversible data destruction'],
      origin: 'https://cloud.provider.com',
      hostname: 'cloud.provider.com',
      pageTitle: 'Database Admin Console',
      createdAt: '2026-10-20T10:00:00.000Z',
      expiresAt: '2026-10-20T10:15:00.000Z',
    };

    const view = renderRequestDetailView({ request: req });

    // Section 1: Browser Action Card
    const actionCard = view.querySelector('.gd-action-card');
    assert(actionCard !== null, 'Action Under Review card is rendered');
    const actionHeading = actionCard?.querySelector('.gd-card-title');
    assertEquals(
      actionHeading?.textContent,
      'Browser Action Under Review',
      'Action heading correctly identifies browser action'
    );
    assert(
      actionCard?.querySelector('.gd-card-subtitle')?.textContent.includes('held in the ward’s local tab') ?? false,
      'Action card clarifies action is held in local tab'
    );
    const decouplingNote = actionCard?.querySelector('.gd-action-decoupling-note');
    assert(decouplingNote !== null, 'Action card contains decoupled execution note');
    assert(
      decouplingNote?.textContent.includes('does NOT remotely execute or trigger the action') ?? false,
      'Reiterates that approval does not execute the action remotely'
    );

    // Section 2: Governance Record Card
    const govCard = view.querySelector('.gd-governance-card');
    assert(govCard !== null, 'Governance Record card is rendered');
    const govHeading = govCard?.querySelector('.gd-card-title');
    assertEquals(
      govHeading?.textContent,
      'Approval Request Governance',
      'Governance heading identifies server record'
    );
    assert(
      govCard?.querySelector('.gd-card-subtitle')?.textContent.includes('Authoritative server-side audit trail') ?? false,
      'Governance card clarifies server-side audit trail'
    );

    // Verify both IDs are present and attributed to their respective roles
    assert(actionCard?.textContent.includes('act_delete_db') ?? false, 'Action ID in action card');
    assert(govCard?.textContent.includes('apr_distinct_001') ?? false, 'Canonical Request ID in governance card');
  }

  // Test Suite 23: Complete Lifecycle States & Resolution Metadata
  console.log('\n▶ Test Suite 23: Complete Lifecycle States (APPROVED, REJECTED, CANCELLED, EXPIRED)');
  {
    // 23.1 APPROVED
    const approvedReq: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_state_approved',
      status: ApprovalStatus.APPROVED,
      resolvedAt: '2026-10-20T10:05:00.000Z',
      decision: {
        decision: 'APPROVED',
        decidedBy: 'tc_carol',
        decidedAt: '2026-10-20T10:05:00.000Z',
        decisionReason: 'Verified account transfer verbally with user.',
      },
    };
    const approvedView = renderRequestDetailView({ request: approvedReq });
    const appPill = approvedView.querySelector('.gd-detail-status-pill');
    assertEquals(appPill?.textContent, 'APPROVED', 'Pill text is APPROVED');
    assert(appPill?.classList.contains('approved') ?? false, 'Pill has .approved class');
    const appBanner = approvedView.querySelector('.gd-status-banner.approved');
    assert(appBanner !== null, 'Approved banner rendered');
    assert(appBanner?.textContent.includes('tc_carol') ?? false, 'Banner mentions reviewer');
    assert(
      approvedView.textContent.includes('Verified account transfer verbally with user'),
      'Reviewer note displayed in resolution box'
    );

    // 23.2 REJECTED
    const rejectedReq: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_state_rejected',
      status: ApprovalStatus.REJECTED,
      resolvedAt: '2026-10-20T10:06:00.000Z',
      decision: {
        decision: 'REJECTED',
        decidedBy: 'tc_carol',
        decidedAt: '2026-10-20T10:06:00.000Z',
        decisionReason: 'User did not authorize this wire transfer.',
      },
    };
    const rejectedView = renderRequestDetailView({ request: rejectedReq });
    const rejPill = rejectedView.querySelector('.gd-detail-status-pill');
    assertEquals(rejPill?.textContent, 'REJECTED', 'Pill text is REJECTED');
    assert(rejPill?.classList.contains('rejected') ?? false, 'Pill has .rejected class');
    const rejBanner = rejectedView.querySelector('.gd-status-banner.rejected');
    assert(rejBanner !== null, 'Rejected banner rendered');
    assert(
      rejectedView.textContent.includes('User did not authorize this wire transfer'),
      'Rejection explanation displayed'
    );

    // 23.3 CANCELLED
    const cancelledReq: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_state_cancelled',
      status: ApprovalStatus.CANCELLED,
      resolvedAt: '2026-10-20T10:04:00.000Z',
      cancellationReason: 'User clicked Back to Safety in Staging Mode.',
    };
    const cancelledView = renderRequestDetailView({ request: cancelledReq });
    const canPill = cancelledView.querySelector('.gd-detail-status-pill');
    assertEquals(canPill?.textContent, 'CANCELLED', 'Pill text is CANCELLED');
    assert(canPill?.classList.contains('cancelled') ?? false, 'Pill has .cancelled class');
    const canBanner = cancelledView.querySelector('.gd-status-banner.cancelled');
    assert(canBanner !== null, 'Cancelled banner rendered');
    assert(
      canBanner?.textContent.includes('User clicked Back to Safety in Staging Mode') ?? false,
      'Cancellation reason displayed in banner'
    );

    // 23.4 EXPIRED
    const expiredReq: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_state_expired',
      status: ApprovalStatus.EXPIRED,
      resolvedAt: '2026-10-20T10:15:00.000Z',
    };
    const expiredView = renderRequestDetailView({ request: expiredReq });
    const expPill = expiredView.querySelector('.gd-detail-status-pill');
    assertEquals(expPill?.textContent, 'EXPIRED', 'Pill text is EXPIRED');
    assert(expPill?.classList.contains('expired') ?? false, 'Pill has .expired class');
    const expBanner = expiredView.querySelector('.gd-status-banner.expired');
    assert(expBanner !== null, 'Expired banner rendered');
    assert(
      expBanner?.textContent.includes('review deadline elapsed') ?? false,
      'Expired banner notes deadline passed'
    );
  }

  // Test Suite 24: Hostile Display Strings & Injection Resistance
  console.log('\n▶ Test Suite 24: Hostile Strings & Anti-XSS Injection Resistance');
  {
    const hostileReq: ApprovalRequest = {
      id: 'apr_<script>alert("id")</script>',
      actionId: 'act_<img src=x onerror=alert("actionId")>',
      requesterId: 'usr_<iframe src="javascript:alert(1)"></iframe>',
      status: ApprovalStatus.PENDING,
      actionDescription: '<script>alert("actionDescription")</script><img src=x onerror=alert(2)> Transfer All Funds',
      actionType: ActionType.CLICK,
      category: ActionCategory.PAYMENT,
      riskLevel: RiskLevel.CRITICAL,
      riskScore: 99,
      riskReasons: [
        '<script>alert("reason1")</script>',
        '<b onmouseover="alert(\'hover\')">Hostile Reason</b>',
      ],
      origin: 'https://evil.com/path?foo=<script>alert("url")</script>',
      hostname: 'evil.com<script>alert("host")</script>',
      pageTitle: '<title>Fake Title</title><script>alert("pageTitle")</script>',
      createdAt: '2026-10-20T10:00:00.000Z',
      expiresAt: '2026-10-20T10:15:00.000Z',
      cancellationReason: '<img src=x onerror=alert("cancel")>',
    };

    const view = renderRequestDetailView({ request: hostileReq });

    // Assert zero dangerous element nodes exist in the rendered DOM tree
    const scripts = view.querySelectorAll('script');
    assertEquals(scripts.length, 0, 'Zero <script> elements injected into DOM tree');

    const iframes = view.querySelectorAll('iframe');
    assertEquals(iframes.length, 0, 'Zero <iframe> elements injected into DOM tree');

    const images = view.querySelectorAll('img');
    assertEquals(images.length, 0, 'Zero <img> elements injected into DOM tree');

    // Verify hostile strings are safely escaped and visible only as inert text
    const titleEl = view.querySelector('.gd-detail-title');
    assert(
      titleEl?.textContent.includes('<script>alert("actionDescription")</script>') ?? false,
      'Script tag in actionDescription rendered safely as inert textContent'
    );

    const reasons = view.querySelectorAll('.gd-risk-reason-item');
    assert(
      reasons[0]?.textContent.includes('<script>alert("reason1")</script>') ?? false,
      'Script tag in riskReason rendered safely as inert textContent'
    );
  }

  // Test Suite 25: Verified Backend Endpoint (GET /api/v1/approvals/:id) & Cache Reuse
  console.log('\n▶ Test Suite 25: Verified Backend Endpoint (GET /api/v1/approvals/:id) & Cache Reuse');
  {
    let getCallCount = 0;
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedAuthHeader = '';

    const detailedMockRequest: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_remote_001',
      actionDescription: 'Authoritative Remote Detail Record',
      riskScore: 99,
      pageTitle: 'Remote Bank Page Title',
    };

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/approvals/pending')) {
        return createMockResponse(200, {
          success: true,
          data: [SAMPLE_REQUEST],
        });
      }
      if (urlStr.includes('/api/v1/approvals/apr_remote_001')) {
        getCallCount++;
        capturedUrl = urlStr;
        capturedMethod = init?.method || 'GET';
        capturedAuthHeader = (init?.headers as any)?.['Authorization'] || '';
        return createMockResponse(200, {
          success: true,
          data: detailedMockRequest,
        });
      }
      return createMockResponse(404, {
        success: false,
        error: { code: 'NOT_FOUND_OR_DENIED', message: 'Request not found' },
      });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: mockFetch as any,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [SAMPLE_REQUEST],
      apiClient: client,
      autoFetch: false,
    });

    // 25.1 Reuse already-loaded authoritative record (zero network requests)
    const existing = await shell.loadRequestDetails(SAMPLE_REQUEST.id, false);
    assertEquals(existing?.id, SAMPLE_REQUEST.id, 'Returns loaded record from in-memory cache');
    assertEquals(getCallCount, 0, 'Zero network calls made when reusing loaded authoritative record');

    // 25.2 Fetch fresh details via verified endpoint (GET /api/v1/approvals/:id)
    const remoteRecord = await shell.loadRequestDetails('apr_remote_001', true);
    assertEquals(remoteRecord?.id, 'apr_remote_001', 'Retrieved record via backend endpoint');
    assertEquals(getCallCount, 1, 'Exactly one GET /api/v1/approvals/:id call dispatched');
    assertEquals(capturedUrl, 'http://localhost:3000/api/v1/approvals/apr_remote_001', 'Correct endpoint URL called');
    assertEquals(capturedMethod, 'GET', 'Uses GET method per integration contract');
    assertEquals(capturedAuthHeader, 'Bearer carol-token', 'Sends Bearer token');

    // 25.3 Cache reuse after first fetch
    const cachedRecord = await shell.loadRequestDetails('apr_remote_001', false);
    assertEquals(cachedRecord?.id, 'apr_remote_001', 'Returned from detailedRequestsCache');
    assertEquals(getCallCount, 1, 'Still only 1 call made; cache hit avoided duplicate request');

    // 25.4 Selection with fresh fetch
    shell.selectRequest('apr_remote_001', false);
    const detailTitle = rootElement.querySelector('.gd-detail-title');
    assertEquals(
      detailTitle?.textContent,
      'Authoritative Remote Detail Record',
      'Detail pane displays freshly loaded remote record'
    );
    shell.destroy();
  }

  // Test Suite 26: Authoritative Approve Decision Operation
  console.log('\n▶ Test Suite 26: Authoritative Approve Decision Operation');
  {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const mockFetch = async (input: any, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      capturedUrl = url;
      capturedMethod = init?.method || 'GET';
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;

      const approvedRecord: ApprovalRequest = {
        ...SAMPLE_REQUEST,
        id: 'apr_decide_approve_001',
        status: ApprovalStatus.APPROVED,
        decision: {
          decision: 'APPROVED',
          decidedBy: 'tc_carol',
          decidedAt: '2026-10-20T10:10:00.000Z',
          decisionReason: 'Verbally verified by phone with user',
        },
        resolvedAt: '2026-10-20T10:10:00.000Z',
      };

      return createMockResponse(200, {
        success: true,
        data: approvedRecord,
      });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: mockFetch,
    });

    const pendingReq: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_decide_approve_001',
      status: ApprovalStatus.PENDING,
    };

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [pendingReq],
      apiClient: client,
      autoFetch: false,
    });

    // Initial state: pending request rendered with decision controls
    const approveBtn = rootElement.querySelector('.gd-btn-approve');
    assert(approveBtn !== null, 'Approve Action button rendered for pending request');

    // Deliberate interaction: click Approve reveals confirmation dialog
    approveBtn?.click();

    const confirmBox = rootElement.querySelector('.gd-decision-confirm-box.confirm-approve');
    assert(confirmBox !== null, 'Deliberate confirmation box rendered upon clicking Approve');

    const confirmTitle = rootElement.querySelector('.gd-confirm-title');
    assertEquals(confirmTitle?.textContent, 'Confirm Approval Decision', 'Confirmation title is accurate');

    // Enter optional reviewer note
    const reasonInput = rootElement.querySelector('#decision-reason-input') as any;
    assert(reasonInput !== null, 'Reviewer note input rendered in confirmation step');
    if (reasonInput) {
      reasonInput.value = 'Verbally verified by phone with user';
    }

    // Submit decision
    const submitBtn = rootElement.querySelector('.gd-btn-confirm-submit');
    assert(submitBtn !== null, 'Confirm submit button rendered');
    submitBtn?.click();

    // Allow promise resolution
    await new Promise((r) => setTimeout(r, 10));

    // Verify wire protocol
    assertEquals(capturedUrl, 'http://localhost:3000/api/v1/approvals/apr_decide_approve_001/decide', 'POST to verified decision endpoint');
    assertEquals(capturedMethod, 'POST', 'HTTP method is POST');
    assertEquals(capturedHeaders['Authorization'], 'Bearer carol-token', 'Bearer token passed');
    assertEquals(capturedBody?.decision, 'APPROVED', 'Payload contains decision: APPROVED');
    assertEquals(capturedBody?.decisionReason, 'Verbally verified by phone with user', 'Payload contains reviewer reason');
    assert(!('approverId' in (capturedBody || {})), 'Client-supplied approverId strictly excluded from payload');
    assert(!('decidedBy' in (capturedBody || {})), 'Client-supplied decidedBy strictly excluded from payload');
    assert(!('status' in (capturedBody || {})), 'Client-supplied status strictly excluded from payload');

    // Verify authoritative UI state update
    const successBanner = rootElement.querySelector('.gd-decision-success-banner');
    assert(successBanner !== null, 'Decision success banner rendered on 200 OK');
    assert(
      successBanner?.textContent.includes('Decision successfully recorded: APPROVED') ?? false,
      'Success banner confirms server recorded decision'
    );

    // Pruned from pending requests list
    assertEquals(shell.getState().pendingRequests.length, 0, 'Resolved request pruned from pending list');
    assertEquals(shell.getState().pendingStatus, 'empty', 'Pending status updated to empty');

    // Detail view displays authoritative record
    const statusPill = rootElement.querySelector('.gd-detail-status-pill');
    assertEquals(statusPill?.textContent, 'APPROVED', 'Detail status pill updated to APPROVED');

    const resolvedNotice = rootElement.querySelector('.gd-decision-resolved-notice');
    assert(resolvedNotice !== null, 'Resolved notice displayed now that request is resolved');

    shell.destroy();
  }

  // Test Suite 27: Authoritative Reject Decision Operation
  console.log('\n▶ Test Suite 27: Authoritative Reject Decision Operation');
  {
    let capturedUrl = '';
    let capturedBody: any = null;

    const mockFetch = async (input: any, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      capturedUrl = url;
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;

      const rejectedRecord: ApprovalRequest = {
        ...SAMPLE_REQUEST,
        id: 'apr_decide_reject_001',
        status: ApprovalStatus.REJECTED,
        decision: {
          decision: 'REJECTED',
          decidedBy: 'tc_carol',
          decidedAt: '2026-10-20T10:12:00.000Z',
          decisionReason: 'Unrecognized external recipient account',
        },
        resolvedAt: '2026-10-20T10:12:00.000Z',
      };

      return createMockResponse(200, {
        success: true,
        data: rejectedRecord,
      });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: mockFetch,
    });

    const pendingReq: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_decide_reject_001',
      status: ApprovalStatus.PENDING,
    };

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [pendingReq],
      apiClient: client,
      autoFetch: false,
    });

    const rejectBtn = rootElement.querySelector('.gd-btn-reject');
    assert(rejectBtn !== null, 'Reject Action button rendered');
    rejectBtn?.click();

    const confirmBox = rootElement.querySelector('.gd-decision-confirm-box.confirm-reject');
    assert(confirmBox !== null, 'Confirmation box for rejection rendered');

    const reasonInput = rootElement.querySelector('#decision-reason-input') as any;
    if (reasonInput) {
      reasonInput.value = 'Unrecognized external recipient account';
    }

    const submitBtn = rootElement.querySelector('.gd-btn-confirm-submit');
    submitBtn?.click();

    await new Promise((r) => setTimeout(r, 10));

    assertEquals(capturedUrl, 'http://localhost:3000/api/v1/approvals/apr_decide_reject_001/decide', 'POST to reject decision endpoint');
    assertEquals(capturedBody?.decision, 'REJECTED', 'Payload contains decision: REJECTED');
    assertEquals(capturedBody?.decisionReason, 'Unrecognized external recipient account', 'Payload contains rejection reason');

    const successBanner = rootElement.querySelector('.gd-decision-success-banner');
    assert(successBanner !== null, 'Success banner rendered for rejection');

    const statusPill = rootElement.querySelector('.gd-detail-status-pill');
    assertEquals(statusPill?.textContent, 'REJECTED', 'Detail pill is REJECTED');

    shell.destroy();
  }

  // Test Suite 28: High-Impact Decision Warning & Deliberate Confirmation Step
  console.log('\n▶ Test Suite 28: High-Impact Decision Warning & Deliberate Confirmation Step');
  {
    let networkCallCount = 0;
    const mockFetch = async (): Promise<Response> => {
      networkCallCount++;
      return createMockResponse(200, { success: true, data: SAMPLE_REQUEST });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token',
      fetchFn: mockFetch,
    });

    const highImpactReq: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_high_impact_001',
      riskLevel: RiskLevel.CRITICAL,
      riskScore: 98,
      status: ApprovalStatus.PENDING,
    };

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [highImpactReq],
      apiClient: client,
      autoFetch: false,
    });

    const approveBtn = rootElement.querySelector('.gd-btn-approve');
    approveBtn?.click();

    // High impact warning rendered
    const warning = rootElement.querySelector('.gd-high-impact-warning');
    assert(warning !== null, 'High-impact decision warning rendered for CRITICAL risk request');
    assert(
      warning?.textContent.includes('High-Impact Decision Warning') ?? false,
      'Warning heading informs reviewer of elevated risk'
    );

    // Cancel interaction
    const cancelBtn = rootElement.querySelector('.gd-btn-cancel-confirm');
    assert(cancelBtn !== null, 'Cancel confirmation button rendered');
    cancelBtn?.click();

    // Confirmation box dismissed and initial buttons restored
    const confirmBoxAfterCancel = rootElement.querySelector('.gd-decision-confirm-box');
    assert(confirmBoxAfterCancel === null, 'Confirmation box dismissed on Cancel');

    const restoredApproveBtn = rootElement.querySelector('.gd-btn-approve');
    assert(restoredApproveBtn !== null, 'Initial Approve Action button restored');
    assertEquals(networkCallCount, 0, 'Zero network calls dispatched when decision is cancelled');

    shell.destroy();
  }

  // Test Suite 29: In-Flight Locking & Repeated Clicks Prevention
  console.log('\n▶ Test Suite 29: In-Flight Locking & Repeated Clicks Prevention');
  {
    let networkCallCount = 0;
    let resolveNetwork: (res: Response) => void;
    const deferredPromise = new Promise<Response>((resolve) => {
      resolveNetwork = resolve;
    });

    const mockFetch = async (): Promise<Response> => {
      networkCallCount++;
      return deferredPromise;
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token',
      fetchFn: mockFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_inflight_001', status: ApprovalStatus.PENDING }],
      apiClient: client,
      autoFetch: false,
    });

    // Start submission
    const approveBtn = rootElement.querySelector('.gd-btn-approve');
    approveBtn?.click();

    const submitBtn = rootElement.querySelector('.gd-btn-confirm-submit');
    submitBtn?.click();

    // In-flight state assertions
    assertEquals(shell.getState().isSubmittingDecision, true, 'isSubmittingDecision is true while request in flight');
    assertEquals(submitBtn?.disabled, true, 'Submit button disabled during submission');
    assertEquals(submitBtn?.getAttribute('aria-busy'), 'true', 'aria-busy is true during submission');

    // Repeated clicks while in flight
    submitBtn?.click();
    submitBtn?.click();

    // Allow token resolution and dispatch of fetch
    await new Promise((r) => setTimeout(r, 5));

    // Concurrent programmatic submission call
    const concurrentResult = await shell.submitDecision('apr_inflight_001', 'APPROVED');
    assertEquals(concurrentResult, null, 'Concurrent submitDecision returns null while in flight');

    assertEquals(networkCallCount, 1, 'Exactly ONE network call dispatched despite repeated clicks');

    // Resolve in-flight call
    resolveNetwork!(
      createMockResponse(200, {
        success: true,
        data: { ...SAMPLE_REQUEST, id: 'apr_inflight_001', status: ApprovalStatus.APPROVED },
      })
    );
    await new Promise((r) => setTimeout(r, 10));

    assertEquals(shell.getState().isSubmittingDecision, false, 'isSubmittingDecision reset to false after resolution');

    shell.destroy();
  }

  // Test Suite 30: Conflict & Concurrent Resolution (409 ALREADY_RESOLVED)
  console.log('\n▶ Test Suite 30: Conflict & Concurrent Resolution (409 ALREADY_RESOLVED)');
  {
    let detailFetchDispatched = false;
    const mockFetch = async (input: any): Promise<Response> => {
      const url = String(input);
      if (url.includes('/decide')) {
        return createMockResponse(409, {
          success: false,
          error: {
            code: 'ALREADY_RESOLVED',
            message: 'Approval request has already been decided or cancelled.',
          },
        });
      }
      if (url.includes('/approvals/apr_conflict_001')) {
        detailFetchDispatched = true;
        return createMockResponse(200, {
          success: true,
          data: {
            ...SAMPLE_REQUEST,
            id: 'apr_conflict_001',
            status: ApprovalStatus.APPROVED,
            decision: {
              decision: 'APPROVED',
              decidedBy: 'tc_bob_competing_reviewer',
              decidedAt: '2026-10-20T10:14:00.000Z',
            },
          },
        });
      }
      return createMockResponse(404, {});
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token',
      fetchFn: mockFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_conflict_001', status: ApprovalStatus.PENDING }],
      apiClient: client,
      autoFetch: false,
    });

    const approveBtn = rootElement.querySelector('.gd-btn-approve');
    approveBtn?.click();

    const submitBtn = rootElement.querySelector('.gd-btn-confirm-submit');
    submitBtn?.click();

    await new Promise((r) => setTimeout(r, 20));

    // Asserts: does NOT pretend decision succeeded
    const successBanner = rootElement.querySelector('.gd-decision-success-banner');
    assert(successBanner === null, 'No success banner displayed on 409 Conflict');

    const errorBanner = rootElement.querySelector('.gd-decision-error-banner');
    assert(errorBanner !== null, 'Conflict error banner displayed on 409 ALREADY_RESOLVED');
    assert(
      errorBanner?.textContent.includes('already been resolved by another reviewer') ?? false,
      'Error banner explains race condition conflict'
    );

    assert(detailFetchDispatched, 'Dispatched fresh detail fetch to load authoritative resolved state');
    assertEquals(shell.getState().pendingRequests.length, 0, 'Pruned resolved request from pending list');

    shell.destroy();
  }

  // Test Suite 31: Expired Request Handling (410 REQUEST_EXPIRED)
  console.log('\n▶ Test Suite 31: Expired Request Handling (410 REQUEST_EXPIRED)');
  {
    const mockFetch = async (input: any): Promise<Response> => {
      const url = String(input);
      if (url.includes('/decide')) {
        return createMockResponse(410, {
          success: false,
          error: {
            code: 'REQUEST_EXPIRED',
            message: 'Approval request has expired and can no longer be decided.',
          },
        });
      }
      if (url.includes('/approvals/apr_expired_001')) {
        return createMockResponse(200, {
          success: true,
          data: {
            ...SAMPLE_REQUEST,
            id: 'apr_expired_001',
            status: ApprovalStatus.EXPIRED,
          },
        });
      }
      return createMockResponse(404, {});
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token',
      fetchFn: mockFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_expired_001', status: ApprovalStatus.PENDING }],
      apiClient: client,
      autoFetch: false,
    });

    const approveBtn = rootElement.querySelector('.gd-btn-approve');
    approveBtn?.click();

    const submitBtn = rootElement.querySelector('.gd-btn-confirm-submit');
    submitBtn?.click();

    await new Promise((r) => setTimeout(r, 20));

    const successBanner = rootElement.querySelector('.gd-decision-success-banner');
    assert(successBanner === null, 'No success banner displayed on 410 Expired');

    const errorBanner = rootElement.querySelector('.gd-decision-error-banner');
    assert(errorBanner !== null, 'Expired error banner displayed on 410 REQUEST_EXPIRED');
    assert(
      errorBanner?.textContent.includes('The review deadline for this request has elapsed') ?? false,
      'Error banner informs user that deadline elapsed'
    );

    assertEquals(shell.getState().pendingRequests.length, 0, 'Pruned expired request from pending list');

    shell.destroy();
  }

  // Test Suite 32: Authorization Failures (401, 403, 404)
  console.log('\n▶ Test Suite 32: Authorization Failures (401, 403, 404)');
  {
    // 32.1: 401 UNAUTHENTICATED
    const mockFetch401 = async (): Promise<Response> => {
      return createMockResponse(401, {
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    };
    const client401 = new ApprovalApiClient({ baseUrl: 'http://localhost:3000', fetchFn: mockFetch401 });
    const shell401 = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_auth_001', status: ApprovalStatus.PENDING }],
      initialProfile: { actorId: 'tc_carol', role: 'TRUSTED_CONTACT', isAuthenticated: true },
      apiClient: client401,
      autoFetch: false,
    });
    await shell401.submitDecision('apr_auth_001', 'APPROVED');
    const err401 = rootElement.querySelector('.gd-decision-error-banner');
    assert(err401?.textContent.includes('Authentication required') ?? false, '401 communicates auth required');
    assertEquals(shell401.getState().contactProfile, null, 'Profile invalidated on 401 unauthenticated');
    shell401.destroy();

    // 32.2: 403 SELF_APPROVAL_PROHIBITED
    const mockFetch403 = async (): Promise<Response> => {
      return createMockResponse(403, {
        success: false,
        error: { code: 'SELF_APPROVAL_PROHIBITED', message: 'Self-approval is strictly prohibited' },
      });
    };
    const client403 = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token',
      fetchFn: mockFetch403,
    });
    const shell403 = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_self_001', status: ApprovalStatus.PENDING }],
      apiClient: client403,
      autoFetch: false,
    });
    await shell403.submitDecision('apr_self_001', 'APPROVED');
    const err403 = rootElement.querySelector('.gd-decision-error-banner');
    assert(err403?.textContent.includes('Self-approval is strictly prohibited') ?? false, '403 explains self-approval is forbidden');
    shell403.destroy();

    // 32.3: 404 NOT_FOUND_OR_DENIED
    const mockFetch404 = async (): Promise<Response> => {
      return createMockResponse(404, {
        success: false,
        error: { code: 'NOT_FOUND_OR_DENIED', message: 'Request not found or access denied' },
      });
    };
    const client404 = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token',
      fetchFn: mockFetch404,
    });
    const shell404 = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_denied_001', status: ApprovalStatus.PENDING }],
      apiClient: client404,
      autoFetch: false,
    });
    await shell404.submitDecision('apr_denied_001', 'APPROVED');
    const err404 = rootElement.querySelector('.gd-decision-error-banner');
    assert(err404?.textContent.includes('Access denied') ?? false, '404 communicates access denied');
    shell404.destroy();
  }

  // Test Suite 33: Network Failure & Timeout Resilience (No Optimistic Resolution)
  console.log('\n▶ Test Suite 33: Network Failure & Timeout Resilience (No Optimistic Resolution)');
  {
    const mockFetchNetworkError = async (): Promise<Response> => {
      throw new Error('Connection refused at localhost:3000');
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token',
      fetchFn: mockFetchNetworkError,
    });

    const pendingReq: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_net_fail_001',
      status: ApprovalStatus.PENDING,
    };

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [pendingReq],
      apiClient: client,
      autoFetch: false,
    });

    const approveBtn = rootElement.querySelector('.gd-btn-approve');
    approveBtn?.click();

    const submitBtn = rootElement.querySelector('.gd-btn-confirm-submit');
    submitBtn?.click();

    await new Promise((r) => setTimeout(r, 10));

    // Verifies: NO optimistic status transition occurred!
    const state = shell.getState();
    assertEquals(state.pendingRequests.length, 1, 'Request remains in pending list');
    assertEquals(state.pendingRequests[0]?.status, ApprovalStatus.PENDING, 'Request remains PENDING without optimistic transition');

    const errBanner = rootElement.querySelector('.gd-decision-error-banner');
    assert(errBanner !== null, 'Network error banner displayed');
    assert(
      errBanner?.textContent.includes('Network connection error') ?? false,
      'Error banner describes network connectivity issue'
    );
    assertEquals(state.isSubmittingDecision, false, 'isSubmittingDecision reset to false');

    shell.destroy();
  }

  // Test Suite 34: Zero-Trust Client-Side Spoofing Prevention
  console.log('\n▶ Test Suite 34: Zero-Trust Client-Side Spoofing Prevention');
  {
    let fetchDispatched = false;
    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token',
      fetchFn: async () => {
        fetchDispatched = true;
        return createMockResponse(200, {});
      },
    });

    // 34.1: Attempting to pass decidedBy
    const result1 = await client.submitDecision('apr_001', {
      decision: 'APPROVED',
      decidedBy: 'tc_malicious_spoof',
    } as any);
    assertEquals(result1.success, false, 'Client-side spoofed decidedBy rejected');
    if (!result1.success) {
      assertEquals(result1.error.code, 'VALIDATION_ERROR', 'Rejection code is VALIDATION_ERROR');
      assert(result1.error.message.includes('decidedBy'), 'Error message identifies decidedBy');
    }

    // 34.2: Attempting to pass approverId
    const result2 = await client.submitDecision('apr_001', {
      decision: 'APPROVED',
      approverId: 'tc_malicious_spoof',
    } as any);
    assertEquals(result2.success, false, 'Client-side spoofed approverId rejected');

    // 34.3: Attempting to pass status
    const result3 = await client.submitDecision('apr_001', {
      decision: 'APPROVED',
      status: 'APPROVED',
    } as any);
    assertEquals(result3.success, false, 'Client-side spoofed status rejected');
    if (!result3.success) {
      assert(result3.error.message.includes('status'), 'Error message identifies status');
    }

    assertEquals(fetchDispatched, false, 'Zero network calls dispatched for spoofed payloads');
  }

  // Test Suite 35: Missing Backend Prerequisite UI Boundary
  console.log('\n▶ Test Suite 35: Missing Backend Prerequisite UI Boundary');
  {
    // Shell initialized without apiClient
    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_no_api_001', status: ApprovalStatus.PENDING }],
      autoFetch: false,
    });

    const approveBtn = rootElement.querySelector('.gd-btn-approve');
    approveBtn?.click();

    const submitBtn = rootElement.querySelector('.gd-btn-confirm-submit');
    submitBtn?.click();

    await new Promise((r) => setTimeout(r, 10));

    const errBanner = rootElement.querySelector('.gd-decision-error-banner');
    assert(errBanner !== null, 'Decision error banner displayed when apiClient is missing');
    assert(
      errBanner?.textContent.includes('Backend decision service is unavailable') ?? false,
      'Error banner accurately explains missing backend prerequisite'
    );
    assert(
      errBanner?.textContent.includes('Approval API client is not configured') ?? false,
      'Error message identifies missing client rather than simulating a fake decision'
    );

    // Request is NOT faked or marked approved
    assertEquals(shell.getState().pendingRequests[0]?.status, ApprovalStatus.PENDING, 'Request remains PENDING');

    shell.destroy();
  }

  console.log('\n======================================================');
  console.log(`Dashboard Shell Component Tests Complete: ${passedTests}/${totalTests} tests passed.`);
  console.log('======================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runDashboardTests().catch((err) => {
  console.error('Fatal error running dashboard shell test suite:', err);
  process.exit(1);
});
