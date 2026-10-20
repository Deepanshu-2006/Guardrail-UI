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
        isMatch = node.classList.contains(part.slice(1));
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
import { ApprovalRequest, ApprovalStatus, RiskLevel, ActionType, ActionCategory } from '../types.js';

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
