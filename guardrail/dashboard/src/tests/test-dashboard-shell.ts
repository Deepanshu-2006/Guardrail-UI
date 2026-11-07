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

  dispatchEvent(event: { type: string; defaultPrevented?: boolean; preventDefault?: () => void; [key: string]: any }): boolean {
    if (typeof event.preventDefault !== 'function') {
      event.preventDefault = () => {
        event.defaultPrevented = true;
      };
    }
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) {
      h(event);
    }
    return true;
  }

  click(): void {
    this.dispatchEvent({ type: 'click', defaultPrevented: false });
  }

  focus(): void {
    (globalThis as any).document.activeElement = this;
  }

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
  activeElement: null as MockDOMElement | null,
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
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
    assertEquals(navLinks.length, 4, 'Renders 4 navigation links (Overview, Pending, History, Settings)');
    assertEquals(rootElement.querySelector('.gd-nav-list')?.getAttribute('role'), null, 'Navigation uses native list semantics instead of an unsupported ARIA menubar pattern');
    assertEquals(navLinks[0]?.getAttribute('role'), null, 'Navigation anchors retain native link semantics');
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

    // Switch to Settings
    shell.setActiveView('settings', false);
    assertEquals(shell.getState().activeView, 'settings', 'activeView state updated to settings');
    const settingsLinks = rootElement.querySelectorAll('.gd-nav-link');
    assertEquals(settingsLinks[3]?.getAttribute('aria-current'), 'page', 'Settings link now has aria-current="page"');

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
      'Action heading identifies the record’s related browser action'
    );
    assert(
      actionCard?.querySelector('.gd-card-subtitle')?.textContent.includes('cannot inspect the ward’s current tab') ?? false,
      'Action card does not claim dashboard can verify local held state'
    );
    const decouplingNote = actionCard?.querySelector('.gd-action-decoupling-note');
    assert(decouplingNote !== null, 'Action card contains decoupled execution note');
    assert(
      decouplingNote?.textContent.includes('They do not execute or trigger an action') ?? false,
      'Reiterates that approval does not execute the action remotely'
    );
    assert(
      decouplingNote?.textContent.includes('require explicit user confirmation') ?? false,
      'Dashboard explains local revalidation and explicit confirmation remain necessary'
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
    assert(appBanner?.textContent.includes('Approval does not run the action') ?? false, 'Approved status does not imply action execution');
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
    assert(rejectedView.textContent.includes('does not authorize continuation'), 'Rejected request does not imply current browser state');

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
      expBanner?.textContent.includes('server marked this request expired') ?? false,
      'Expired banner describes the server request state without asserting browser action state'
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
      if (url.includes('/decide')) {
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
      }

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
    assertEquals(confirmBox?.getAttribute('role'), 'group', 'Inline confirmation is exposed as a labelled group, not a modal dialog');
    assertEquals(confirmBox?.getAttribute('aria-labelledby'), 'gd-decision-confirm-title', 'Confirmation group is labelled by its heading');
    assertEquals(mockDocument.activeElement, confirmTitle, 'Focus moves to the confirmation heading after selecting approval');

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
      if (url.includes('/decide')) {
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
      }

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
    assertEquals(mockDocument.activeElement, restoredApproveBtn, 'Cancelling confirmation returns focus to the originating decision button');
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

  // Test Suite 36: Status Filtering in Decision History
  console.log('\n▶ Test Suite 36: Status Filtering in Decision History');
  {
    const historyItems: ApprovalRequest[] = [
      {
        ...SAMPLE_REQUEST,
        id: 'apr_hist_app_01',
        status: ApprovalStatus.APPROVED,
        actionDescription: 'Approved Wire Transfer to Alice Savings',
        resolvedAt: '2026-10-20T11:00:00.000Z',
        decision: {
          decision: ApprovalStatus.APPROVED,
          decidedBy: 'tc_carol',
          decidedAt: '2026-10-20T11:00:00.000Z',
          decisionReason: 'Verified with Alice',
        },
      },
      {
        ...SAMPLE_REQUEST,
        id: 'apr_hist_rej_02',
        status: ApprovalStatus.REJECTED,
        actionDescription: 'Rejected Unknown Wire Transfer',
        resolvedAt: '2026-10-20T11:30:00.000Z',
        decision: {
          decision: ApprovalStatus.REJECTED,
          decidedBy: 'tc_carol',
          decidedAt: '2026-10-20T11:30:00.000Z',
          decisionReason: 'Unrecognized recipient',
        },
      },
      {
        ...SAMPLE_REQUEST,
        id: 'apr_hist_can_03',
        status: ApprovalStatus.CANCELLED,
        actionDescription: 'Cancelled Staging Mode Transfer',
        resolvedAt: '2026-10-20T12:00:00.000Z',
        cancellationReason: 'Ward dismissed prompt in browser',
      },
      {
        ...SAMPLE_REQUEST,
        id: 'apr_hist_exp_04',
        status: ApprovalStatus.EXPIRED,
        actionDescription: 'Expired Transfer Order',
        resolvedAt: '2026-10-20T12:30:00.000Z',
      },
    ];

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'history',
      initialHistoryRequests: historyItems,
    });

    // All items initially displayed
    const cardsInitial = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(cardsInitial.length, 4, 'All 4 historical decisions rendered initially');

    // Filter by APPROVED
    shell.setHistoryFilters({ status: ApprovalStatus.APPROVED });
    const approvedCards = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(approvedCards.length, 1, 'Only APPROVED decisions rendered when filtered by APPROVED');
    assert(approvedCards[0]?.textContent.includes('Approved Wire Transfer') ?? false, 'Approved card title matches');

    // Filter by REJECTED
    shell.setHistoryFilters({ status: ApprovalStatus.REJECTED });
    const rejectedCards = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(rejectedCards.length, 1, 'Only REJECTED decisions rendered when filtered by REJECTED');
    assert(rejectedCards[0]?.textContent.includes('Rejected Unknown Wire Transfer') ?? false, 'Rejected card matches');

    // Filter by CANCELLED
    shell.setHistoryFilters({ status: ApprovalStatus.CANCELLED });
    const cancelledCards = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(cancelledCards.length, 1, 'Only CANCELLED decisions rendered when filtered by CANCELLED');

    // Filter by EXPIRED
    shell.setHistoryFilters({ status: ApprovalStatus.EXPIRED });
    const expiredCards = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(expiredCards.length, 1, 'Only EXPIRED decisions rendered when filtered by EXPIRED');

    // Reset to ALL
    shell.setHistoryFilters({ status: 'ALL' });
    const allCards = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(allCards.length, 4, 'All 4 decisions restored when status filter reset to ALL');

    shell.destroy();
  }

  // Test Suite 37: Risk Level Filtering in Pending and History
  console.log('\n▶ Test Suite 37: Risk Level Filtering in Pending and History');
  {
    const pendingItems: ApprovalRequest[] = [
      { ...SAMPLE_REQUEST, id: 'apr_risk_crit', riskLevel: RiskLevel.CRITICAL, actionDescription: 'Critical Transfer' },
      { ...SAMPLE_REQUEST, id: 'apr_risk_high', riskLevel: RiskLevel.HIGH, actionDescription: 'High Risk Transfer' },
      { ...SAMPLE_REQUEST, id: 'apr_risk_med', riskLevel: RiskLevel.MEDIUM, actionDescription: 'Medium Risk Form' },
      { ...SAMPLE_REQUEST, id: 'apr_risk_low', riskLevel: RiskLevel.LOW, actionDescription: 'Low Risk Nav' },
    ];

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: pendingItems,
    });

    const initialPendingCards = rootElement.querySelectorAll('#view-pending .gd-request-card');
    assertEquals(initialPendingCards.length, 4, 'All 4 pending requests displayed initially');

    // Filter by CRITICAL
    shell.setPendingFilters({ riskLevel: RiskLevel.CRITICAL });
    const critCards = rootElement.querySelectorAll('#view-pending .gd-request-card');
    assertEquals(critCards.length, 1, 'Only 1 request rendered when filtered by CRITICAL risk');
    assert(critCards[0]?.textContent.includes('Critical Transfer') ?? false, 'Rendered card is Critical Transfer');

    // Filter by LOW
    shell.setPendingFilters({ riskLevel: RiskLevel.LOW });
    const lowCards = rootElement.querySelectorAll('#view-pending .gd-request-card');
    assertEquals(lowCards.length, 1, 'Only 1 request rendered when filtered by LOW risk');
    assert(lowCards[0]?.textContent.includes('Low Risk Nav') ?? false, 'Rendered card is Low Risk Nav');

    // Reset risk filter
    shell.setPendingFilters({ riskLevel: 'ALL' });
    const resetPendingCards = rootElement.querySelectorAll('#view-pending .gd-request-card');
    assertEquals(resetPendingCards.length, 4, 'All 4 requests restored when risk level reset to ALL');

    shell.destroy();
  }

  // Test Suite 38: Date Range Filtering (TODAY, 7_DAYS, 30_DAYS)
  console.log('\n▶ Test Suite 38: Date Range Filtering');
  {
    const now = Date.now();
    const dateItems: ApprovalRequest[] = [
      {
        ...SAMPLE_REQUEST,
        id: 'apr_date_today',
        actionDescription: 'Action From 2 Hours Ago',
        resolvedAt: new Date(now - 2 * 3600 * 1000).toISOString(),
        status: ApprovalStatus.APPROVED,
      },
      {
        ...SAMPLE_REQUEST,
        id: 'apr_date_3days',
        actionDescription: 'Action From 3 Days Ago',
        resolvedAt: new Date(now - 3 * 86400 * 1000).toISOString(),
        status: ApprovalStatus.APPROVED,
      },
      {
        ...SAMPLE_REQUEST,
        id: 'apr_date_45days',
        actionDescription: 'Action From 45 Days Ago',
        resolvedAt: new Date(now - 45 * 86400 * 1000).toISOString(),
        status: ApprovalStatus.APPROVED,
      },
    ];

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'history',
      initialHistoryRequests: dateItems,
    });

    // TODAY (within 24h)
    shell.setHistoryFilters({ dateRange: 'TODAY' });
    const todayCards = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(todayCards.length, 1, 'Only 1 decision within last 24h matched for TODAY filter');
    assert(todayCards[0]?.textContent.includes('2 Hours Ago') ?? false, 'Matches 2 Hours Ago record');

    // 7_DAYS
    shell.setHistoryFilters({ dateRange: '7_DAYS' });
    const weekCards = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(weekCards.length, 2, '2 decisions within last 7 days matched for 7_DAYS filter');

    // 30_DAYS
    shell.setHistoryFilters({ dateRange: '30_DAYS' });
    const monthCards = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(monthCards.length, 2, '2 decisions within last 30 days matched for 30_DAYS filter');

    // ALL
    shell.setHistoryFilters({ dateRange: 'ALL' });
    const allCards = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(allCards.length, 3, 'All 3 decisions matched for ALL date range');

    shell.destroy();
  }

  // Test Suite 39: Safe Keyword Search & Non-Sensitive Field Restriction
  console.log('\n▶ Test Suite 39: Safe Keyword Search & Non-Sensitive Field Restriction');
  {
    const searchItems: ApprovalRequest[] = [
      {
        ...SAMPLE_REQUEST,
        id: 'apr_srch_wire_001',
        actionDescription: 'Wire Transfer Authorization',
        hostname: 'banking.safe.org',
        category: ActionCategory.PAYMENT,
        status: ApprovalStatus.APPROVED,
        decision: {
          decision: ApprovalStatus.APPROVED,
          decidedBy: 'tc_carol',
          decidedAt: '2026-10-20T10:00:00.000Z',
          decisionReason: 'Authorized verified invoice',
        },
      },
      {
        ...SAMPLE_REQUEST,
        id: 'apr_srch_auth_002',
        actionDescription: 'Federated OAuth Delegation',
        hostname: 'login.identity.io',
        category: ActionCategory.AUTHENTICATION,
        status: ApprovalStatus.REJECTED,
      },
    ];

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'history',
      initialHistoryRequests: searchItems,
    });

    // Search by description
    shell.setHistoryFilters({ searchQuery: 'wire transfer' });
    let matches = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(matches.length, 1, 'Matches description query "wire transfer"');
    assert(matches[0]?.textContent.includes('Wire Transfer Authorization') ?? false, 'Matched record title');

    // Search by hostname
    shell.setHistoryFilters({ searchQuery: 'identity.io' });
    matches = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(matches.length, 1, 'Matches hostname query "identity.io"');
    assert(matches[0]?.textContent.includes('Federated OAuth Delegation') ?? false, 'Matched OAuth record');

    // Search by canonical ID
    shell.setHistoryFilters({ searchQuery: 'apr_srch_wire_001' });
    matches = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(matches.length, 1, 'Matches canonical ID query');

    // Search by audit reason
    shell.setHistoryFilters({ searchQuery: 'verified invoice' });
    matches = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(matches.length, 1, 'Matches audit reason query');

    // Verify search does NOT index or match sensitive fields like passwords, OTPs, or cards
    shell.setHistoryFilters({ searchQuery: 'password' });
    matches = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(matches.length, 0, 'Sensitive term "password" matches 0 records');

    shell.setHistoryFilters({ searchQuery: 'otp_secret' });
    matches = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(matches.length, 0, 'Sensitive term "otp_secret" matches 0 records');

    shell.destroy();
  }

  // Test Suite 40: Filter Empty States & Clear Filters Action
  console.log('\n▶ Test Suite 40: Filter Empty States & Clear Filters Action');
  {
    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [SAMPLE_REQUEST],
    });

    // Apply an impossible search
    shell.setPendingFilters({ searchQuery: 'non_existent_unmatched_query_xyz' });

    const emptyFilter = rootElement.querySelector('#view-pending .gd-filter-empty-state');
    assert(emptyFilter !== null, 'Renders filter empty state when query matches 0 requests');
    assertEquals(
      emptyFilter?.querySelector('.gd-placeholder-title')?.textContent,
      'No Matching Pending Requests',
      'Filter empty state title communicates no matching pending requests'
    );

    // Clear filters button in empty state
    const clearBtn = emptyFilter?.querySelector('.gd-btn-reset-filters');
    assert(clearBtn !== null, 'Clear All Filters button rendered in empty state');

    clearBtn?.click();

    // After clearing, pending request is restored
    const restoredCards = rootElement.querySelectorAll('#view-pending .gd-request-card');
    assertEquals(restoredCards.length, 1, 'Original pending request restored after clicking Clear Filters');
    assertEquals(shell.getState().pendingFilters.searchQuery, '', 'searchQuery reset to empty string');

    shell.destroy();
  }

  // Test Suite 41: Decision History View with Authoritative Resolved Records
  console.log('\n▶ Test Suite 41: Decision History View with Authoritative Resolved Records');
  {
    const resolvedRecord: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_hist_detail_001',
      status: ApprovalStatus.APPROVED,
      actionDescription: 'Approved Wire Transfer Transaction',
      resolvedAt: '2026-10-20T14:30:00.000Z',
      decision: {
        decision: ApprovalStatus.APPROVED,
        decidedBy: 'tc_carol',
        decidedAt: '2026-10-20T14:30:00.000Z',
        decisionReason: 'Confirmed phone verification with ward Alice',
      },
    };

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'history',
      initialHistoryRequests: [resolvedRecord],
    });

    const historyCard = rootElement.querySelector('.gd-history-card');
    assert(historyCard !== null, 'Historical request card rendered');
    assert(historyCard?.classList.contains('status-approved') ?? false, 'Card has .status-approved class for visual distinction');

    const statusPill = historyCard?.querySelector('.gd-detail-status-pill');
    assert(statusPill !== null, 'Status pill rendered on history card');
    assertEquals(statusPill?.textContent, 'APPROVED', 'Status pill displays APPROVED');
    assert(statusPill?.classList.contains('approved') ?? false, 'Status pill has .approved class');

    const reviewerTag = historyCard?.querySelector('.gd-history-reviewer-tag');
    assert(reviewerTag !== null, 'Reviewer attribution tag rendered');
    assertEquals(reviewerTag?.textContent, 'Reviewer: tc_carol', 'Reviewer attribution matches authoritative record');

    // Detail inspector in right pane
    const detailPane = rootElement.querySelector('#view-history .gd-detail-pane');
    assert(detailPane !== null, 'Detail pane rendered in history view');
    assert(
      detailPane?.textContent.includes('Confirmed phone verification with ward Alice') ?? false,
      'Reviewer reason rendered in detail audit trail'
    );

    shell.destroy();
  }

  // Test Suite 42: Post-Decision Feedback & Automatic Addition to History
  console.log('\n▶ Test Suite 42: Post-Decision Feedback & Automatic Addition to History');
  {
    let decideCalled = false;
    const mockClient = {
      listPendingApprovals: async () => ({ success: true, data: decideCalled ? [] : [SAMPLE_REQUEST] }),
      getApprovalDetails: async (_id: string) => ({ success: true, data: SAMPLE_REQUEST }),
      submitDecision: async (_id: string, _payload: any) => {
        decideCalled = true;
        const resolved: ApprovalRequest = {
          ...SAMPLE_REQUEST,
          status: ApprovalStatus.APPROVED,
          resolvedAt: '2026-10-20T15:00:00.000Z',
          decision: {
            decision: ApprovalStatus.APPROVED,
            decidedBy: 'tc_carol',
            decidedAt: '2026-10-20T15:00:00.000Z',
            decisionReason: 'Verified post-decision addition',
          },
        };
        return { success: true, data: resolved };
      },
    } as unknown as ApprovalApiClient;

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [SAMPLE_REQUEST],
      apiClient: mockClient,
      autoFetch: false,
    });

    // Submit approval
    const approveBtn = rootElement.querySelector('.gd-btn-approve');
    approveBtn?.click();

    const confirmSubmitBtn = rootElement.querySelector('.gd-btn-confirm-submit');
    confirmSubmitBtn?.click();

    await new Promise((r) => setTimeout(r, 10));

    assert(decideCalled, 'Decision submitted to backend client');

    // Success banner displayed
    const successBanner = rootElement.querySelector('.gd-decision-success-banner');
    assert(successBanner !== null, 'Success banner displayed after decision confirmed');

    // Pending requests list is now empty
    assertEquals(shell.getState().pendingRequests.length, 0, 'Pending requests pruned to 0');

    // Authoritative history contains the resolved request
    assertEquals(shell.getState().historyRequests.length, 1, 'Resolved request added to historyRequests');
    assertEquals(shell.getState().historyRequests[0]?.status, ApprovalStatus.APPROVED, 'History record is APPROVED');

    // Switch to history view
    shell.setActiveView('history', false);

    const histCards = rootElement.querySelectorAll('.gd-history-card');
    assertEquals(histCards.length, 1, 'Newly decided request rendered in Decision History list');

    shell.destroy();
  }

  // Test Suite 43: Architectural Capability Notice Documenting Backend Endpoint Gap
  console.log('\n▶ Test Suite 43: Architectural Notice Documenting Missing Backend History Endpoint');
  {
    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'history',
      initialHistoryRequests: [{ ...SAMPLE_REQUEST, id: 'apr_hist_notice_01', status: ApprovalStatus.APPROVED }],
    });

    const noticeBox = rootElement.querySelector('.gd-history-notice');
    assert(noticeBox !== null, 'Architectural backend notice rendered in Decision History');

    const noticeText = noticeBox?.textContent || '';
    assert(
      noticeText.includes('Authoritative Decision History'),
      'Notice identifies authoritative session records'
    );
    assert(
      noticeText.includes('GET /api/v1/approvals/history'),
      'Notice explicitly cites GET /api/v1/approvals/history on backend roadmap without fabricating fake data'
    );

    shell.destroy();
  }

  // Test Suite 44: Responsive Layout & Keyboard Accessibility
  console.log('\n▶ Test Suite 44: Responsive Layout & Keyboard Accessibility');
  {
    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [
        { ...SAMPLE_REQUEST, id: 'apr_kb_01', actionDescription: 'First Action' },
        { ...SAMPLE_REQUEST, id: 'apr_kb_02', actionDescription: 'Second Action' },
      ],
    });

    const cards = rootElement.querySelectorAll('#view-pending .gd-request-card');
    assertEquals(cards.length, 2, '2 cards rendered for keyboard accessibility test');

    // Role and tabindex attributes
    assertEquals(cards[0]?.getAttribute('role'), 'button', 'Request card has role="button"');
    assertEquals(cards[0]?.getAttribute('tabindex'), '0', 'Request card has tabindex="0"');
    assert(cards[0]?.getAttribute('aria-label')?.includes('apr_kb_01') ?? false, 'Accessible aria-label set');

    // Enter key triggers selection
    let selectedId = shell.getState().selectedRequestId;
    assertEquals(selectedId, 'apr_kb_01', 'First card selected initially');

    cards[1]?.dispatchEvent({ type: 'keydown', key: 'Enter', defaultPrevented: false });
    assertEquals(shell.getState().selectedRequestId, 'apr_kb_02', 'Enter key selected second card');

    // Space key triggers selection
    cards[0]?.dispatchEvent({ type: 'keydown', key: ' ', defaultPrevented: false });
    assertEquals(shell.getState().selectedRequestId, 'apr_kb_01', 'Space key selected first card');

    // Mobile sidebar toggle
    const mobileBtn = rootElement.querySelector('.gd-mobile-toggle');
    assert(mobileBtn !== null, 'Mobile toggle button rendered');
    assertEquals(mobileBtn?.getAttribute('aria-label'), 'Open navigation menu', 'Mobile toggle has a clear initial action label');
    assertEquals(mobileBtn?.getAttribute('aria-controls'), 'gd-primary-sidebar', 'Mobile toggle identifies the controlled navigation region');
    assertEquals(mobileBtn?.getAttribute('aria-expanded'), 'false', 'Mobile navigation starts collapsed');

    shell.toggleMobileSidebar();
    const sidebar = rootElement.querySelector('.gd-sidebar');
    assert(sidebar?.classList.contains('open') ?? false, 'Sidebar has .open class after toggle');
    assertEquals(mobileBtn?.getAttribute('aria-expanded'), 'true', 'Mobile toggle announces expanded navigation');
    assertEquals(mobileBtn?.getAttribute('aria-label'), 'Close navigation menu', 'Mobile toggle label updates to its close action');

    shell.toggleMobileSidebar();
    assert(!(sidebar?.classList.contains('open') ?? false), 'Sidebar removes .open class after second toggle');
    assertEquals(mobileBtn?.getAttribute('aria-expanded'), 'false', 'Mobile toggle announces collapsed navigation');

    shell.destroy();
  }

  // Test Suite 45: Day 21 Trusted-Contact Dashboard Consistency & Resilience
  console.log('\n▶ Test Suite 45: Day 21 Trusted-Contact Dashboard Consistency & Resilience');
  {
    // 1. Distinction between empty queue and failed request placeholder
    const emptyShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [],
      autoFetch: false,
    });

    const emptyPlaceholder = rootElement.querySelector('.gd-empty-state');
    assert(emptyPlaceholder !== null, 'Empty state placeholder rendered when queue is empty');
    assert(
      emptyPlaceholder?.textContent.includes('No Pending Approval Requests') ?? false,
      'Empty state title communicates No Pending Approval Requests'
    );
    assertEquals(rootElement.querySelector('.gd-error-placeholder'), null, 'Error placeholder is NOT rendered when queue is empty');
    emptyShell.destroy();

    // 2. Failed request with 0 requests renders error placeholder, not empty state
    const errorShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [],
      autoFetch: false,
    });
    errorShell.setError('Connection refused by approval gateway');
    const errPlaceholder = rootElement.querySelector('.gd-error-placeholder');
    assert(errPlaceholder !== null, 'Failed request renders gd-error-placeholder');
    assert(
      errPlaceholder?.textContent.includes('Unable to Load Approval Requests') ?? false,
      'Failed placeholder title is distinct from empty state'
    );
    assert(
      errPlaceholder?.textContent.includes('Connection refused by approval gateway') ?? false,
      'Failed placeholder displays specific error message'
    );
    assertEquals(rootElement.querySelector('.gd-empty-state'), null, 'Empty state placeholder is NOT rendered on failure');
    errorShell.destroy();

    // 3. Stale data banner when cached records exist during backend outage
    const staleShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_stale_001' }],
      autoFetch: false,
    });
    staleShell.setError('Network connection error: Unable to reach backend');
    const staleBanner = rootElement.querySelector('.gd-stale-banner');
    assert(staleBanner !== null, 'Stale banner rendered when cached records exist during outage');
    assert(
      staleBanner?.textContent.includes('cached records') && staleBanner?.textContent.includes('unreachable'),
      'Stale banner warns reviewer that backend is unreachable'
    );
    assertEquals(staleShell.getState().pendingRequests.length, 1, 'Cached records preserved during outage');
    staleShell.destroy();

    // 4. Request ID Deduplication in incoming list responses
    const dupFetch = async (): Promise<Response> => {
      return createMockResponse(200, {
        success: true,
        data: [
          {
            id: 'apr_dup_001',
            actionId: 'act_1',
            requesterId: 'usr_alice',
            status: ApprovalStatus.PENDING,
            actionDescription: 'First Duplicate',
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.LOW,
            hostname: 'example.com',
            createdAt: '2026-10-20T10:00:00.000Z',
          },
          {
            id: 'apr_dup_001',
            actionId: 'act_1',
            requesterId: 'usr_alice',
            status: ApprovalStatus.PENDING,
            actionDescription: 'Identical Duplicate Record',
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.LOW,
            hostname: 'example.com',
            createdAt: '2026-10-20T10:00:00.000Z',
          },
        ],
      });
    };
    const dupClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: dupFetch,
    });
    const dupShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: dupClient,
      autoFetch: false,
    });
    await dupShell.fetchPendingRequests();
    assertEquals(dupShell.getState().pendingRequests.length, 1, 'Duplicate request IDs deduplicated to exactly 1 record');
    dupShell.destroy();

    // 5. Backend offline disables decision actions and displays offline banner
    const offlineShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_offline_001' }],
      autoFetch: false,
    });
    offlineShell.setError('Network connection error: Unable to reach the Guardrail approval backend. Please verify your connection and retry.');
    (offlineShell as any).isBackendUnavailable = true;
    offlineShell.render();

    const offlineBanner = rootElement.querySelector('.gd-backend-offline-banner');
    assert(offlineBanner !== null, 'Backend offline status banner rendered');
    assert(
      offlineBanner?.textContent.includes('Backend Unavailable') ?? false,
      'Offline banner explains backend service is unreachable'
    );
    const approveBtnDisabled = rootElement.querySelector('.gd-btn-approve') as MockDOMElement | null;
    assertEquals(approveBtnDisabled?.disabled, true, 'Approve button disabled when backend is unavailable');
    const rejectBtnDisabled = rootElement.querySelector('.gd-btn-reject') as MockDOMElement | null;
    assertEquals(rejectBtnDisabled?.disabled, true, 'Reject button disabled when backend is unavailable');
    offlineShell.destroy();

    // 6. Standardized status rendering for UNAVAILABLE and FAILED
    const unavailDetail = renderRequestDetailView({
      request: { ...SAMPLE_REQUEST, status: 'UNAVAILABLE' as any },
      onDecisionSubmit: async () => {},
    });
    const unavailBanner = unavailDetail.querySelector('.gd-status-banner.unavailable');
    assert(unavailBanner !== null, 'Status banner rendered for UNAVAILABLE state');
    assert(unavailBanner?.textContent.includes('Status Unavailable') ?? false, 'UNAVAILABLE banner text matches');

    const failedDetail = renderRequestDetailView({
      request: { ...SAMPLE_REQUEST, status: 'FAILED' as any },
      onDecisionSubmit: async () => {},
    });
    const failedBanner = failedDetail.querySelector('.gd-status-banner.failed');
    assert(failedBanner !== null, 'Status banner rendered for FAILED state');
    assert(failedBanner?.textContent.includes('Evaluation Failed') ?? false, 'FAILED banner text matches');

    // 6. Terminal state protection: delayed PENDING response cannot revert resolved request
    const delayedFetch = async (): Promise<Response> => {
      return createMockResponse(200, {
        success: true,
        data: [
          {
            id: 'apr_term_001',
            actionId: 'act_term',
            requesterId: 'usr_alice',
            status: ApprovalStatus.PENDING,
            actionDescription: 'Resolved Request Returned As Pending',
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.LOW,
            hostname: 'example.com',
            createdAt: '2026-10-20T10:00:00.000Z',
          },
        ],
      });
    };
    const delayedClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: delayedFetch,
    });
    const termShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: delayedClient,
      autoFetch: false,
    });
    // Pre-populate detailed cache with terminal APPROVED record
    (termShell as any).detailedRequestsCache.set('apr_term_001', {
      ...SAMPLE_REQUEST,
      id: 'apr_term_001',
      status: ApprovalStatus.APPROVED,
    });
    await termShell.fetchPendingRequests();
    assertEquals(termShell.getState().pendingRequests.length, 0, 'Resolved terminal request not reverted to pending list');
    termShell.destroy();

    // Invitation acceptance grants a relationship, not an authenticated dashboard identity.
    const invitationClient = {
      acceptInvitation: async () => ({
        success: true,
        data: { invitation: { wardId: 'usr_invited_ward', relationshipLabel: 'Guardian' } },
      }),
      listPendingApprovals: async () => ({ success: true, data: [] }),
    } as any;
    const invitationShell = new DashboardShell({
      container: testContainer,
      apiClient: invitationClient,
      autoFetch: false,
    });
    const invitationInput = rootElement.querySelector('#gd-invitation-code-input') as MockDOMElement;
    const invitationForm = rootElement.querySelector('.gd-setup-form') as MockDOMElement;
    invitationInput.value = 'GR-INV-ABCD-EFGH';
    await invitationForm.listeners.submit[0]({ preventDefault() {} });
    assertEquals(
      invitationShell.getState().contactProfile,
      null,
      'Successful invitation acceptance does not fabricate an authenticated contact profile'
    );
    invitationShell.destroy();
  }

  // Test Suite 46: Overview Enhancement & Trusted Contact User Experience
  console.log('\n▶ Test Suite 46: Overview Enhancement & Trusted Contact User Experience');
  {
    // 1. Protection Status Card states
    const standaloneShell = new DashboardShell({
      container: testContainer,
      initialView: 'overview',
      autoFetch: false,
    });
    const standCard = rootElement.querySelector('.gd-protection-status-card');
    assert(standCard !== null, 'Protection status card is rendered on Overview');
    assert(standCard?.classList.contains('status-standalone') ?? false, 'Renders standalone status when unauthenticated');
    assert(standCard?.textContent.includes('Standalone Preview Mode') ?? false, 'Communicates standalone preview mode');

    // Posture chips present
    const chips = rootElement.querySelectorAll('.gd-protection-chip');
    assertEquals(chips.length, 4, 'Renders 4 governance posture chips (Interception, Execution, Isolation, Last Sync)');
    assert(chips[0]?.textContent.includes('Interception') ?? false, 'Interception posture chip present');
    assert(chips[1]?.textContent.includes('Execution') ?? false, 'Execution posture chip present');
    assert(chips[2]?.textContent.includes('Isolation') ?? false, 'Multi-tenant isolation posture chip present');
    standaloneShell.destroy();

    // Authenticated live protection status
    const liveShell = new DashboardShell({
      container: testContainer,
      initialView: 'overview',
      initialProfile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        assignedWardId: 'usr_alice',
        isAuthenticated: true,
      },
      autoFetch: false,
    });
    const liveCard = rootElement.querySelector('.gd-protection-status-card');
    assert(liveCard?.classList.contains('status-operational') ?? false, 'Renders operational status when authenticated');
    assert(liveCard?.textContent.includes('Live Guardrail Protection Active') ?? false, 'Communicates live guardrail protection');
    liveShell.destroy();

    // Mock service fixture indicator
    const mockShell = new DashboardShell({
      container: testContainer,
      initialView: 'overview',
      isMockService: true,
      autoFetch: false,
    });
    const mockCard = rootElement.querySelector('.gd-protection-status-card');
    assert(mockCard?.classList.contains('status-mock') ?? false, 'Renders mock status when isMockService is true');
    assert(mockCard?.textContent.includes('Development Fixture Active') ?? false, 'Communicates development fixture mode');
    mockShell.destroy();

    // Offline status card
    const offlineShell = new DashboardShell({
      container: testContainer,
      initialView: 'overview',
      autoFetch: false,
    });
    (offlineShell as any).isBackendUnavailable = true;
    offlineShell.render();
    const offCard = rootElement.querySelector('.gd-protection-status-card');
    assert(offCard?.classList.contains('status-offline') ?? false, 'Renders offline status when backend unavailable');
    assert(offCard?.textContent.includes('Service Connection Offline') ?? false, 'Communicates service connection offline');
    offlineShell.destroy();

    // 2. Important Notifications & Action Items
    const notifPendingShell = new DashboardShell({
      container: testContainer,
      initialView: 'overview',
      initialProfile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        assignedWardId: 'usr_alice',
        isAuthenticated: true,
      },
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_notif_1' }],
      autoFetch: false,
    });
    const notifWarning = rootElement.querySelector('.gd-notification-item.gd-notif-warning');
    assert(notifWarning !== null, 'Action Required notification item rendered when pending actions exist');
    assert(notifWarning?.textContent.includes('1 pending approval request') ?? false, 'Notification text specifies pending count');
    notifPendingShell.destroy();

    // All Systems Normal when queue is clear and ward is linked
    const normalShell = new DashboardShell({
      container: testContainer,
      initialView: 'overview',
      initialProfile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        assignedWardId: 'usr_alice',
        isAuthenticated: true,
      },
      initialRequests: [],
      autoFetch: false,
    });
    const notifSuccess = rootElement.querySelector('.gd-notification-item.gd-notif-success');
    assert(notifSuccess !== null, 'All Systems Normal notification rendered when queue is empty');
    assert(notifSuccess?.textContent.includes('All Systems Normal') ?? false, 'Communicates all systems normal');
    normalShell.destroy();

    // 3. Actionable Pending Approvals Quick-Review on Overview
    const quickShell = new DashboardShell({
      container: testContainer,
      initialView: 'overview',
      initialProfile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        assignedWardId: 'usr_alice',
        isAuthenticated: true,
      },
      initialRequests: [
        {
          ...SAMPLE_REQUEST,
          id: 'apr_quick_01',
          actionDescription: 'Wire Transfer to Unknown Payee',
          riskLevel: RiskLevel.CRITICAL,
        },
      ],
      autoFetch: false,
    });
    const quickSection = rootElement.querySelector('#gd-overview-pending-section');
    assert(quickSection !== null, 'Pending approval section rendered on Overview');
    const quickItem = quickSection?.querySelector('.gd-overview-pending-item');
    assert(quickItem !== null, 'Pending request item rendered on Overview');
    assert(quickItem?.textContent.includes('Wire Transfer to Unknown Payee') ?? false, 'Displays action description');
    assert(quickItem?.textContent.includes('CRITICAL') ?? false, 'Displays critical risk level badge');

    // Clicking "Review & Decide →" button navigates to pending view with request selected
    const reviewBtn = quickItem?.querySelector('.gd-btn-overview-review') as MockDOMElement | null;
    assert(reviewBtn !== null, 'Review & Decide button present on overview item');
    reviewBtn?.listeners.click[0]({ preventDefault() {} });
    assertEquals(quickShell.getState().activeView, 'pending', 'Active view transitioned to pending');
    assertEquals(quickShell.getState().selectedRequestId, 'apr_quick_01', 'Selected request ID matches clicked overview item');
    quickShell.destroy();

    // 4. Authorized Ward Oversight & Tenant Isolation Guarantee
    const wardShell = new DashboardShell({
      container: testContainer,
      initialView: 'overview',
      initialProfile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        assignedWardId: 'usr_alice',
        relationshipLabel: 'Designated Guardian',
        isAuthenticated: true,
      },
      autoFetch: false,
    });
    const activeWardCard = rootElement.querySelector('#gd-active-ward-card');
    assert(activeWardCard !== null, 'Active ward association card rendered on Overview');
    assert(activeWardCard?.textContent.includes('usr_alice') ?? false, 'Displays assigned ward identifier');
    assert(activeWardCard?.textContent.includes('Designated Guardian') ?? false, 'Displays relationship label');
    assert(activeWardCard?.textContent.includes('Separation of Duties') ?? false, 'Emphasizes separation of duties');
    assert(activeWardCard?.textContent.includes('Multi-tenant isolation guarantees no access to data belonging to other users') ?? false, 'Guarantees multi-tenant isolation');
    wardShell.destroy();

    // 5. Account & Settings View
    const settingsShell = new DashboardShell({
      container: testContainer,
      initialView: 'settings',
      initialProfile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        assignedWardId: 'usr_alice',
        relationshipLabel: 'Designated Guardian',
        isAuthenticated: true,
      },
      environment: 'pilot' as any,
      autoFetch: false,
    });
    const settingsSec = rootElement.querySelector('#view-settings');
    assert(settingsSec !== null, 'Settings section rendered');
    assert(settingsSec?.classList.contains('active') ?? false, 'Settings section is active');
    assert(settingsSec?.textContent.includes('tc_carol') ?? false, 'Displays canonical actor ID');
    assert(settingsSec?.textContent.includes('PILOT') ?? false, 'Displays deployment environment');
    assert(settingsSec?.textContent.includes('Decoupled Action Execution') ?? false, 'Documents decoupled execution invariant');
    assert(settingsSec?.textContent.includes('Zero-Trust Data Scrubbing') ?? false, 'Documents data scrubbing invariant');

    // Clear session resets profile to null
    const clearBtn = rootElement.querySelector('#gd-btn-clear-session') as MockDOMElement | null;
    assert(clearBtn !== null, 'Clear session button present');
    clearBtn?.listeners.click[0]({ preventDefault() {} });
    assertEquals(settingsShell.getState().contactProfile, null, 'Contact profile cleared on sign out');
    settingsShell.destroy();

    // 6. Mobile Navigation & Drawer Backing
    const mobileShell = new DashboardShell({
      container: testContainer,
      autoFetch: false,
    });
    mobileShell.toggleMobileSidebar(true);
    const backdrop = rootElement.querySelector('.gd-mobile-backdrop.active');
    assert(backdrop !== null, 'Mobile backdrop element created when drawer opens');

    // Clicking backdrop closes drawer
    (backdrop as MockDOMElement)?.listeners.click[0]({ preventDefault() {} });
    assert(!(rootElement.querySelector('.gd-sidebar')?.classList.contains('open') ?? false), 'Drawer closes on backdrop click');

    // Selecting view on mobile closes drawer
    mobileShell.toggleMobileSidebar(true);
    mobileShell.setActiveView('overview');
    assert(!(rootElement.querySelector('.gd-sidebar')?.classList.contains('open') ?? false), 'Drawer closes when active view is re-selected');

    mobileShell.destroy();
  }

  // Test Suite 47: Trusted-Contact Approval Request Interface Enhancements
  console.log('\n▶ Test Suite 47: Trusted-Contact Approval Request Interface Enhancements');
  {
    // 47.1: Distinct Status Distinction for All 5 States
    const fiveStatuses: { status: ApprovalStatus; bannerClass: string; titleKeyword: string }[] = [
      { status: ApprovalStatus.PENDING, bannerClass: 'pending', titleKeyword: 'Awaiting Review' },
      { status: ApprovalStatus.APPROVED, bannerClass: 'approved', titleKeyword: 'Approved by Trusted Contact' },
      { status: ApprovalStatus.REJECTED, bannerClass: 'rejected', titleKeyword: 'Rejected by Trusted Contact' },
      { status: ApprovalStatus.CANCELLED, bannerClass: 'cancelled', titleKeyword: 'Action Cancelled' },
      { status: ApprovalStatus.EXPIRED, bannerClass: 'expired', titleKeyword: 'Request Expired' },
    ];

    for (const item of fiveStatuses) {
      const view = renderRequestDetailView({
        request: {
          ...SAMPLE_REQUEST,
          id: `apr_status_${item.status.toLowerCase()}`,
          status: item.status,
          decision: item.status === ApprovalStatus.APPROVED || item.status === ApprovalStatus.REJECTED
            ? { decision: item.status, decidedBy: 'tc_carol', decidedAt: '2026-10-20T10:05:00.000Z' }
            : undefined,
          cancellationReason: item.status === ApprovalStatus.CANCELLED ? 'User dismissed staging' : undefined,
        },
      });

      const banner = view.querySelector(`.gd-status-banner.${item.bannerClass}`);
      assert(banner !== null, `Renders .gd-status-banner.${item.bannerClass} for ${item.status}`);
      assert(banner?.textContent.includes(item.titleKeyword) ?? false, `Status banner for ${item.status} contains "${item.titleKeyword}"`);

      const pill = view.querySelector('.gd-detail-status-pill');
      assertEquals(pill?.textContent, item.status, `Detail status pill displays ${item.status}`);
      assert(pill?.classList.contains(item.status.toLowerCase()) ?? false, `Status pill has .${item.status.toLowerCase()} class`);
    }

    // 47.2: Request Timestamps & Expiration Information Display
    const futureIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const createdIso = '2026-10-20T10:00:00.000Z';
    const timestampShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [
        {
          ...SAMPLE_REQUEST,
          id: 'apr_ts_info_01',
          createdAt: createdIso,
          expiresAt: futureIso,
        },
      ],
      autoFetch: false,
    });

    const pendingCard = rootElement.querySelector('#view-pending .gd-request-card');
    assert(pendingCard !== null, 'Pending request card rendered');
    const expiresMeta = pendingCard?.querySelector('.gd-card-meta-expires');
    assert(expiresMeta !== null, 'Expiration deadline rendered in pending card meta');
    assert(expiresMeta?.textContent.includes('Expires:') ?? false, 'Card meta displays "Expires:" prefix');

    const detailPane = rootElement.querySelector('#view-pending .gd-detail-pane');
    assert(detailPane !== null, 'Detail pane rendered');
    assert(detailPane?.textContent.includes('Initiated At') ?? false, 'Detail pane displays Initiated At timestamp');
    assert(detailPane?.textContent.includes('Expires At') ?? false, 'Detail pane displays Expires At information');
    assert(detailPane?.textContent.includes('Expires in') ?? false, 'Detail pane computes relative expiration time');
    timestampShell.destroy();

    // 47.3: Stale / Expired Request Proactive Client-Side Handling
    const pastIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const expiredShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [
        {
          ...SAMPLE_REQUEST,
          id: 'apr_expired_client_01',
          status: ApprovalStatus.PENDING,
          expiresAt: pastIso,
        },
      ],
      autoFetch: false,
    });

    // Pending card reflects expired status badge and meta
    const expiredCard = rootElement.querySelector('#view-pending .gd-request-card');
    assert(expiredCard !== null, 'Card rendered for expired request');
    assert(expiredCard?.classList.contains('is-expired') ?? false, 'Card has .is-expired class');
    const expiredBadge = expiredCard?.querySelector('.gd-status-badge.expired');
    assert(expiredBadge !== null, 'Expired status badge rendered on card');
    assertEquals(expiredBadge?.textContent, 'EXPIRED', 'Badge text is EXPIRED');
    const expiredMeta = expiredCard?.querySelector('.gd-card-meta-expired');
    assert(expiredMeta !== null, 'Card meta displays expired indicator');
    assert(expiredMeta?.textContent.includes('Expired') ?? false, 'Meta text warns Expired');

    // Detail view displays review deadline elapsed banner
    const deadlineBanner = rootElement.querySelector('.gd-status-banner.expired');
    assert(deadlineBanner !== null, 'Review deadline elapsed banner rendered in detail view');
    assert(deadlineBanner?.textContent.includes('Review Deadline Elapsed') ?? false, 'Banner title specifies Review Deadline Elapsed');

    // Attempting decision on expired request proactively rejects without dispatching network call
    let networkCallMade = false;
    const clientForExpired = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      fetchFn: async () => {
        networkCallMade = true;
        return createMockResponse(200, {});
      },
    });
    (expiredShell as any).apiClient = clientForExpired;

    const approveBtn = rootElement.querySelector('.gd-btn-approve');
    assert(approveBtn !== null, 'Approve button rendered in pending view');
    approveBtn?.click();

    const confirmSubmitBtn = rootElement.querySelector('.gd-btn-confirm-submit');
    assert(confirmSubmitBtn !== null, 'Confirm submit button rendered');
    confirmSubmitBtn?.click();

    await new Promise((r) => setTimeout(r, 10));

    assertEquals(networkCallMade, false, 'Zero network calls dispatched for client-detected expired request');
    assert(
      expiredShell.getState().decisionErrorMessage?.includes('Request expired') ?? false,
      'Error message identifies that review deadline elapsed'
    );
    const expiredErrorBanner = rootElement.querySelector('.gd-decision-error-banner');
    assert(expiredErrorBanner !== null, 'Decision error banner displayed for expired request attempt');
    expiredShell.destroy();

    // 47.4: Consequential Confirmation Step with Irreversible Notice
    const confirmShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [
        {
          ...SAMPLE_REQUEST,
          id: 'apr_consequential_01',
          riskLevel: RiskLevel.HIGH,
          riskScore: 78,
          status: ApprovalStatus.PENDING,
        },
      ],
      autoFetch: false,
    });

    const approveButton = rootElement.querySelector('.gd-btn-approve');
    approveButton?.click();

    const confirmBox = rootElement.querySelector('.gd-decision-confirm-box');
    assert(confirmBox !== null, 'Confirmation box displayed on Approve');
    const consequentialNotice = confirmBox?.querySelector('.gd-consequential-notice');
    assert(consequentialNotice !== null, 'Consequential decision notice rendered in confirmation box');
    assert(
      consequentialNotice?.textContent.includes('Consequential Decision Notice') ?? false,
      'Notice informs reviewer that decisions are consequential'
    );
    assert(
      consequentialNotice?.textContent.includes('cannot be reversed or undone') ?? false,
      'Notice explicitly emphasizes that server commitments cannot be reversed or undone'
    );

    const highImpact = confirmBox?.querySelector('.gd-high-impact-warning');
    assert(highImpact !== null, 'High-Impact warning displayed for HIGH risk action');
    confirmShell.destroy();

    // 47.5: Revoked Trusted-Contact Relationship Handling
    let fetchPendingDispatched = false;
    const mockRevokedClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'revoked-token',
      fetchFn: async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('/decide')) {
          return createMockResponse(404, {
            success: false,
            error: {
              code: 'NOT_FOUND_OR_DENIED',
              message: 'Request not found or access denied',
            },
          });
        }
        if (u.includes('/pending')) {
          fetchPendingDispatched = true;
          return createMockResponse(200, { success: true, data: [] });
        }
        return createMockResponse(404, {});
      },
    });

    const revokedShell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [
        { ...SAMPLE_REQUEST, id: 'apr_revoked_rel_01', status: ApprovalStatus.PENDING },
      ],
      apiClient: mockRevokedClient,
      autoFetch: false,
    });

    await revokedShell.submitDecision('apr_revoked_rel_01', 'APPROVED');
    await new Promise((r) => setTimeout(r, 15));
    assert(
      revokedShell.getState().decisionErrorMessage?.includes('trusted-contact relationship was revoked') ?? false,
      'Error message informs user of possible relationship revocation'
    );
    assertEquals(revokedShell.getState().pendingRequests.length, 0, 'Unauthorized request pruned from pending list');
    assert(fetchPendingDispatched, 'Pending requests refreshed after relationship authorization failure');
    revokedShell.destroy();

    // 47.6: Strict Zero-Trust Privacy: No Raw Passwords, OTPs, or Form Values in DOM
    const sensitiveWardRequest: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_privacy_strict_01',
      actionDescription: 'Submit Secure Form',
      origin: 'https://bank.example.com',
      hostname: 'bank.example.com',
      pageTitle: 'Account Security Settings',
      // Injected malicious/sensitive mock properties that must NEVER be rendered
      ...({
        rawPassword: 'SuperSecretPassword123!',
        otpCode: '839201',
        cardNumber: '4111222233334444',
        formData: { password: 'secret', token: 'bearer-xyz' },
      } as any),
    };

    const privacyView = renderRequestDetailView({ request: sensitiveWardRequest });
    const renderedHtml = privacyView.innerHTML || '';
    assert(!renderedHtml.includes('SuperSecretPassword123!'), 'No raw passwords in rendered DOM');
    assert(!renderedHtml.includes('839201'), 'No OTP codes in rendered DOM');
    assert(!renderedHtml.includes('4111222233334444'), 'No card numbers in rendered DOM');
    assert(!renderedHtml.includes('bearer-xyz'), 'No sensitive form data or auth tokens in rendered DOM');
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
