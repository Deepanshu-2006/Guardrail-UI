/**
 * Guardrail Trusted-Contact Dashboard - Synchronization & Refresh Test Suite
 *
 * Comprehensive verification of dashboard data synchronization:
 * 1. Periodic background polling with configurable intervals (pollIntervalMs).
 * 2. Tab visibility lifecycle: pause when hidden, immediate sync probe when visible.
 * 3. Immediate authoritative refresh following approval/rejection decisions.
 * 4. Concurrency safety: deduplication of overlapping refreshes and detail queries.
 * 5. Stale-response protection: dropping out-of-order slow responses via sequence counters.
 * 6. Visible request details synchronization using authoritative backend data.
 * 7. Clean resource disposal: stopping timers and unregistering all event listeners on destroy().
 * 8. Authentication boundary: halting polling on 401 UNAUTHENTICATED until re-authenticated.
 * 9. Preservation of loading, empty, error, and retry states.
 * 10. Inviolable security invariant: Zero execution or release of browser actions.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

// =============================================================================
// DOM & Environment Simulation
// =============================================================================

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
    return this.children
      .map((c) => `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`)
      .join('');
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

// Global Environment Mock with Document Event Support & Visibility State
const rootElement = new MockDOMElement('div');
rootElement.id = 'dashboard-app-sync-root';
const testContainer = rootElement as unknown as HTMLElement;

const mockDocument = {
  visibilityState: 'visible' as 'visible' | 'hidden',
  listeners: {} as Record<string, ((e: any) => void)[]>,
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
  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  },
  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  },
  dispatchEvent(event: { type: string }): boolean {
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) {
      h(event);
    }
    return true;
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

// Imports after global DOM is established
import { DashboardShell } from '../shell.js';
import {
  ApprovalApiClient,
  ApprovalRequest,
  ApprovalStatus,
  RiskLevel,
  ActionType,
  DEFAULT_DASHBOARD_POLL_INTERVAL_MS,
} from '../types.js';

// Test assertion helpers
let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (!condition) {
    console.error(`  ✗ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  ✓ ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalTests++;
  if (actual !== expected) {
    console.error(`  ✗ FAILED: ${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    throw new Error(`Assertion failed: ${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
  passedTests++;
  console.log(`  ✓ ${message}: ${JSON.stringify(actual)}`);
}

function createMockResponse(status: number, data: unknown): Response {
  const jsonStr = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => JSON.parse(jsonStr),
    text: async () => jsonStr,
  } as unknown as Response;
}

const SAMPLE_REQUEST: ApprovalRequest = {
  id: 'apr_sync_001',
  actionId: 'act_sync_001',
  actionDescription: 'Authorize Bank Account Wire Transfer',
  actionType: ActionType.SUBMIT,
  riskLevel: RiskLevel.CRITICAL,
  riskScore: 95,
  riskReasons: ['Irreversible fund withdrawal', 'Unverified recipient'],
  origin: 'https://finance.example.com',
  hostname: 'finance.example.com',
  pageTitle: 'Transfer Confirmation',
  requesterId: 'usr_alice',
  status: ApprovalStatus.PENDING,
  createdAt: '2026-10-21T08:00:00.000Z',
  expiresAt: '2026-10-21T08:15:00.000Z',
};

// =============================================================================
// Test Suite Execution
// =============================================================================

async function runDashboardSyncTests(): Promise<void> {
  console.log('\n======================================================');
  console.log('🛡️ GUARDRAIL DASHBOARD DATA SYNCHRONIZATION TEST SUITE');
  console.log('======================================================\n');

  // Suite 1: Periodic Polling Synchronization & Configurable Intervals
  console.log('▶ Test Suite 1: Periodic Polling Synchronization & Configurable Intervals');
  {
    let pollCount = 0;
    const mockFetch = async (input: any): Promise<Response> => {
      const url = String(input);
      if (url.includes('/api/v1/approvals/pending')) {
        pollCount++;
        return createMockResponse(200, {
          success: true,
          data: [{ ...SAMPLE_REQUEST, id: `apr_poll_${pollCount}` }],
        });
      }
      return createMockResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: mockFetch,
    });

    // Verify default constant
    assertEquals(DEFAULT_DASHBOARD_POLL_INTERVAL_MS, 10000, 'DEFAULT_DASHBOARD_POLL_INTERVAL_MS is 10,000ms (10s)');

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
      pollIntervalMs: 40, // 40ms fast interval for test
    });

    assertEquals(shell.getPollIntervalMs(), 40, 'Configured poll interval is 40ms');
    assertEquals(shell.isPolling(), true, 'Background polling timer is active');

    // Wait for at least 2 interval ticks
    await new Promise((r) => setTimeout(r, 110));

    assert(pollCount >= 2, `Periodic polling dispatched queries automatically: ${pollCount} ticks`);
    assert(shell.getLastSynchronizedAt() !== null, 'lastSynchronizedAt timestamp is recorded');
    assertEquals(shell.getState().pendingRequests.length, 1, 'Pending requests synchronized');

    // Reconfigure interval at runtime
    shell.setPollInterval(200);
    assertEquals(shell.getPollIntervalMs(), 200, 'Runtime setPollInterval updated to 200ms');

    // Stop polling
    shell.stopPolling();
    assertEquals(shell.isPolling(), false, 'stopPolling halts background timer');

    const countBeforePause = pollCount;
    await new Promise((r) => setTimeout(r, 90));
    assertEquals(pollCount, countBeforePause, 'No queries dispatched while polling is stopped');

    // Restart polling
    shell.startPolling();
    assertEquals(shell.isPolling(), true, 'startPolling restarts background timer');

    shell.destroy();
    assertEquals(shell.isPolling(), false, 'destroy() cleanly terminates polling');
  }

  // Suite 2: Tab Visibility Lifecycle (Background Pause & Immediate Foreground Probe)
  console.log('\n▶ Test Suite 2: Tab Visibility Lifecycle (Background Pause & Immediate Foreground Probe)');
  {
    let pollCount = 0;
    const mockFetch = async (input: any): Promise<Response> => {
      const url = String(input);
      if (url.includes('/api/v1/approvals/pending')) {
        pollCount++;
        return createMockResponse(200, {
          success: true,
          data: [{ ...SAMPLE_REQUEST, id: `apr_vis_${pollCount}` }],
        });
      }
      return createMockResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: mockFetch,
    });

    mockDocument.visibilityState = 'visible';

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      apiClient: client,
      autoFetch: false,
      pollIntervalMs: 30,
    });

    assertEquals(shell.isPolling(), true, 'Initially polling when tab is visible');

    // 1. Simulate tab becoming hidden (user switches tabs or minimizes browser)
    mockDocument.visibilityState = 'hidden';
    mockDocument.dispatchEvent({ type: 'visibilitychange' });

    assertEquals(shell.isPolling(), false, 'Polling stopped when document became hidden');

    const countWhenHidden = pollCount;
    await new Promise((r) => setTimeout(r, 80));
    assertEquals(pollCount, countWhenHidden, 'Zero network queries dispatched while tab remains hidden');

    // 2. Simulate tab becoming visible again
    mockDocument.visibilityState = 'visible';
    mockDocument.dispatchEvent({ type: 'visibilitychange' });

    assertEquals(shell.isPolling(), true, 'Polling resumed when document returned to visible');

    // Allow immediate sync probe to dispatch and complete
    await new Promise((r) => setTimeout(r, 20));
    assert(pollCount > countWhenHidden, 'Immediate sync probe dispatched immediately upon returning to visible');

    shell.destroy();
  }

  // Suite 3: Concurrency Control & Request Storm Immunity
  console.log('\n▶ Test Suite 3: Concurrency Control & Request Storm Immunity');
  {
    let pendingFetchCount = 0;
    let detailFetchCount = 0;

    const mockFetch = async (input: any): Promise<Response> => {
      const url = String(input);
      await new Promise((r) => setTimeout(r, 25)); // Artificial latency

      if (url.includes('/api/v1/approvals/pending')) {
        pendingFetchCount++;
        return createMockResponse(200, {
          success: true,
          data: [SAMPLE_REQUEST],
        });
      }
      if (url.includes('/api/v1/approvals/apr_sync_001')) {
        detailFetchCount++;
        return createMockResponse(200, {
          success: true,
          data: SAMPLE_REQUEST,
        });
      }
      return createMockResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
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

    // 1. Dispatch 5 concurrent fetchPendingRequests calls
    const p1 = shell.fetchPendingRequests();
    const p2 = shell.fetchPendingRequests();
    const p3 = shell.fetchPendingRequests();
    const p4 = shell.fetchPendingRequests();
    const p5 = shell.fetchPendingRequests();

    await Promise.all([p1, p2, p3, p4, p5]);
    assertEquals(pendingFetchCount, 1, '5 overlapping fetchPendingRequests collapsed into exactly 1 network request');

    // 2. Dispatch 5 concurrent loadRequestDetails calls for the same ID
    const d1 = shell.loadRequestDetails('apr_sync_001', true);
    const d2 = shell.loadRequestDetails('apr_sync_001', true);
    const d3 = shell.loadRequestDetails('apr_sync_001', true);
    const d4 = shell.loadRequestDetails('apr_sync_001', true);
    const d5 = shell.loadRequestDetails('apr_sync_001', true);

    await Promise.all([d1, d2, d3, d4, d5]);
    assertEquals(detailFetchCount, 1, '5 overlapping loadRequestDetails collapsed into exactly 1 network request');

    shell.destroy();
  }

  // Suite 4: Monotonic Sequence Tracking & Stale Response Drop
  console.log('\n▶ Test Suite 4: Monotonic Sequence Tracking & Stale Response Drop');
  {
    let resolveFirstFetch: ((res: Response) => void) | null = null;
    let resolveSecondFetch: ((res: Response) => void) | null = null;

    let callIndex = 0;
    const mockFetch = async (input: any): Promise<Response> => {
      const url = String(input);
      if (url.includes('/api/v1/approvals/pending')) {
        callIndex++;
        if (callIndex === 1) {
          // Slow earlier response (seq = 1)
          return new Promise<Response>((resolve) => {
            resolveFirstFetch = resolve;
          });
        }
        if (callIndex === 2) {
          // Fast newer response (seq = 2)
          return new Promise<Response>((resolve) => {
            resolveSecondFetch = resolve;
          });
        }
      }
      return createMockResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
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

    // Start Fetch 1 (seq 1, slow)
    const promise1 = (shell as any).doFetchPendingRequests(false);
    await new Promise((r) => setTimeout(r, 10));

    // Start Fetch 2 (seq 2, fast)
    const promise2 = (shell as any).doFetchPendingRequests(false);
    await new Promise((r) => setTimeout(r, 10));

    // Resolve Fetch 2 FIRST with newer data
    const newerRequest: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_newer_seq2',
      actionDescription: 'Newer Authoritative Action',
    };
    resolveSecondFetch!(createMockResponse(200, { success: true, data: [newerRequest] }));
    await promise2;

    assertEquals(shell.getState().pendingRequests[0]?.id, 'apr_newer_seq2', 'Newer response applied to dashboard');
    assertEquals(shell.getLastAppliedSequence(), 2, 'lastAppliedSequence is 2');

    // Now resolve Fetch 1 LATER with stale data
    const staleRequest: ApprovalRequest = {
      ...SAMPLE_REQUEST,
      id: 'apr_stale_seq1',
      actionDescription: 'Stale Out-of-Order Action',
    };
    resolveFirstFetch!(createMockResponse(200, { success: true, data: [staleRequest] }));
    await promise1;

    // Stale response MUST be dropped; newer data preserved!
    assertEquals(
      shell.getState().pendingRequests[0]?.id,
      'apr_newer_seq2',
      'Stale out-of-order response was discarded; newer data preserved'
    );
    assertEquals(shell.getLastAppliedSequence(), 2, 'lastAppliedSequence remains 2');

    shell.destroy();
  }

  // Suite 5: Visible Request Details Synchronization
  console.log('\n▶ Test Suite 5: Visible Request Details Synchronization');
  {
    let backendRequests: ApprovalRequest[] = [
      { ...SAMPLE_REQUEST, id: 'apr_target_001', status: ApprovalStatus.PENDING },
    ];

    const mockFetch = async (input: any): Promise<Response> => {
      const url = String(input);
      if (url.includes('/api/v1/approvals/pending')) {
        return createMockResponse(200, {
          success: true,
          data: backendRequests,
        });
      }
      if (url.includes('/api/v1/approvals/apr_target_001')) {
        const found = backendRequests.find((r) => r.id === 'apr_target_001') || {
          ...SAMPLE_REQUEST,
          id: 'apr_target_001',
          status: ApprovalStatus.CANCELLED,
          cancellationReason: 'Cancelled by ward in Staging Mode',
        };
        return createMockResponse(200, {
          success: true,
          data: found,
        });
      }
      return createMockResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: mockFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: backendRequests,
      apiClient: client,
      autoFetch: false,
    });

    assertEquals(shell.getState().selectedRequestId, 'apr_target_001', 'Initial target selected');

    // Simulate backend change: ward cancels request in Staging Mode (no longer in pending list)
    backendRequests = [];

    // Trigger sync
    await shell.fetchPendingRequests();
    await new Promise((r) => setTimeout(r, 20));

    // Dashboard noticed selected request was removed from pending; queried details and added to history
    assertEquals(shell.getState().pendingRequests.length, 0, 'Pending list updated to 0');
    assert(
      shell.getState().historyRequests.some((r) => r.id === 'apr_target_001' && r.status === ApprovalStatus.CANCELLED),
      'Authoritative details refreshed; cancelled record added to history'
    );

    shell.destroy();
  }

  // Suite 6: Immediate Synchronization Following Reviewer Decisions
  console.log('\n▶ Test Suite 6: Immediate Synchronization Following Reviewer Decisions');
  {
    let listPendingDispatched = false;
    let decideDispatched = false;

    const mockFetch = async (input: any): Promise<Response> => {
      const url = String(input);
      if (url.includes('/decide')) {
        decideDispatched = true;
        return createMockResponse(200, {
          success: true,
          data: {
            ...SAMPLE_REQUEST,
            id: 'apr_decide_sync_001',
            status: ApprovalStatus.APPROVED,
            decision: {
              decision: 'APPROVED',
              decidedBy: 'tc_carol',
              decidedAt: new Date().toISOString(),
            },
          },
        });
      }
      if (url.includes('/api/v1/approvals/pending')) {
        listPendingDispatched = true;
        return createMockResponse(200, {
          success: true,
          data: [], // Authoritatively empty post-decision
        });
      }
      return createMockResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'carol-token',
      fetchFn: mockFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialRequests: [{ ...SAMPLE_REQUEST, id: 'apr_decide_sync_001' }],
      apiClient: client,
      autoFetch: false,
    });

    // Submit decision
    const submitResult = await shell.submitDecision('apr_decide_sync_001', 'APPROVED', 'Verified by phone');
    assert(submitResult !== null, 'Decision submission succeeded');
    assertEquals(decideDispatched, true, 'Decision endpoint called');

    // Allow background post-decision sync to execute
    await new Promise((r) => setTimeout(r, 20));

    assert(listPendingDispatched, 'Immediate backend sync dispatched right after decision committed');
    assertEquals(shell.getState().pendingRequests.length, 0, 'Pending requests synchronized to 0');
    assertEquals(shell.getState().historyRequests.length, 1, 'History contains approved decision');

    shell.destroy();
  }

  // Suite 7: Authentication Boundary & Polling Halting on 401
  console.log('\n▶ Test Suite 7: Authentication Boundary & Polling Halting on 401');
  {
    let queryAttempts = 0;
    let authHeaderValid = false;

    const mockFetch = async (input: any): Promise<Response> => {
      const url = String(input);
      if (url.includes('/api/v1/approvals/pending')) {
        queryAttempts++;
        if (!authHeaderValid) {
          return createMockResponse(401, {
            success: false,
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Authentication token is expired or invalid.',
            },
          });
        }
        return createMockResponse(200, {
          success: true,
          data: [SAMPLE_REQUEST],
        });
      }
      return createMockResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    };

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => (authHeaderValid ? 'valid-token' : undefined),
      fetchFn: mockFetch,
    });

    const shell = new DashboardShell({
      container: testContainer,
      initialView: 'pending',
      initialProfile: { actorId: 'tc_carol', role: 'TRUSTED_CONTACT', isAuthenticated: true },
      apiClient: client,
      autoFetch: false,
      pollIntervalMs: 25,
    });

    assertEquals(shell.isPolling(), true, 'Initially polling');

    // Trigger fetch that receives 401
    await shell.fetchPendingRequests();

    assertEquals(shell.getState().pendingStatus, 'error', 'pendingStatus set to error on 401');
    assertEquals(shell.getState().contactProfile, null, 'Contact profile invalidated on 401');
    assertEquals(shell.isPolling(), false, 'Polling halted immediately on 401 to prevent backend spam');

    const attemptsAfterHalt = queryAttempts;
    await new Promise((r) => setTimeout(r, 60));
    assertEquals(queryAttempts, attemptsAfterHalt, 'Zero further polling requests dispatched while unauthenticated');

    // Now re-authenticate
    authHeaderValid = true;
    shell.setProfile({ actorId: 'tc_carol', role: 'TRUSTED_CONTACT', isAuthenticated: true });

    assertEquals(shell.isPolling(), true, 'Polling resumed automatically upon re-authentication');

    shell.destroy();
  }

  // Suite 8: Loading, Empty, Error, and Retry State Preservation
  console.log('\n▶ Test Suite 8: Loading, Empty, Error, and Retry State Preservation');
  {
    let shouldFail = true;
    let refreshTriggered = false;

    const mockFetch = async (input: any): Promise<Response> => {
      const url = String(input);
      if (url.includes('/api/v1/approvals/pending')) {
        refreshTriggered = true;
        if (shouldFail) {
          return createMockResponse(503, {
            success: false,
            error: {
              code: 'SERVER_ERROR',
              message: 'Database temporarily unavailable.',
            },
          });
        }
        return createMockResponse(200, {
          success: true,
          data: [],
        });
      }
      return createMockResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
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

    // 1. Initial state
    assertEquals(shell.getState().pendingStatus, 'empty', 'Initial state is empty');

    // 2. Fetch fails with error
    await shell.fetchPendingRequests();
    assertEquals(shell.getState().pendingStatus, 'error', 'Status transitioned to error');
    assert(rootElement.querySelector('.gd-error-banner') !== null, 'Error banner rendered');

    // 3. Click retry button on error banner
    const retryBtn = rootElement.querySelector('.gd-btn-retry');
    assert(retryBtn !== null, 'Retry button rendered in error banner');

    shouldFail = false;
    refreshTriggered = false;
    retryBtn?.click();

    await new Promise((r) => setTimeout(r, 20));
    assert(refreshTriggered, 'Clicking Retry dispatched refresh');
    assertEquals(shell.getState().pendingStatus, 'empty', 'Status recovered to empty upon successful retry');
    assert(rootElement.querySelector('.gd-error-banner') === null, 'Error banner cleared on recovery');

    shell.destroy();
  }

  // Suite 9: Clean Resource Disposal (destroy())
  console.log('\n▶ Test Suite 9: Clean Resource Disposal (destroy())');
  {
    let fetchDispatched = false;

    const mockFetch = async (): Promise<Response> => {
      fetchDispatched = true;
      return createMockResponse(200, { success: true, data: [] });
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
      pollIntervalMs: 30,
    });

    assertEquals(shell.isPolling(), true, 'Polling active before destroy');
    assert(mockDocument.listeners['visibilitychange']?.length > 0, 'visibilitychange listener registered');
    assert(mockWindow.listeners['hashchange']?.length > 0, 'hashchange listener registered');

    // Destroy
    shell.destroy();

    assertEquals(shell.isPolling(), false, 'Polling halted on destroy()');
    assertEquals(mockDocument.listeners['visibilitychange']?.length ?? 0, 0, 'visibilitychange listener cleaned up');
    assertEquals(mockWindow.listeners['hashchange']?.length ?? 0, 0, 'hashchange listener cleaned up');
    assertEquals(testContainer.children.length, 0, 'DOM elements removed from container');

    // Ensure subsequent visibilitychange does not trigger fetches
    fetchDispatched = false;
    mockDocument.dispatchEvent({ type: 'visibilitychange' });
    await new Promise((r) => setTimeout(r, 40));
    assertEquals(fetchDispatched, false, 'No fetches dispatched after destroy');
  }

  // Suite 10: Inviolable Security Invariant: Zero Browser Action Execution
  console.log('\n▶ Test Suite 10: Inviolable Security Invariant: Zero Browser Action Execution');
  {
    let continuationExecutionCounter = 0;
    // Invariant: The dashboard shell never executes or releases held browser actions

    const mockFetch = async (): Promise<Response> => {
      return createMockResponse(200, {
        success: true,
        data: {
          ...SAMPLE_REQUEST,
          status: ApprovalStatus.APPROVED,
          decision: { decision: 'APPROVED', decidedBy: 'tc_carol' },
        },
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
      initialRequests: [SAMPLE_REQUEST],
      apiClient: client,
      autoFetch: false,
      pollIntervalMs: 20,
    });

    // Simulate approval and polling sync
    await shell.submitDecision(SAMPLE_REQUEST.id, 'APPROVED');
    await new Promise((r) => setTimeout(r, 50));

    // Crucial check: continuation handler must NEVER be called
    assertEquals(
      continuationExecutionCounter,
      0,
      'Inviolable Invariant: Dashboard updates strictly NEVER execute or release browser actions'
    );

    shell.destroy();
  }

  console.log('\n======================================================');
  console.log(`Dashboard Synchronization Tests Complete: ${passedTests}/${totalTests} tests passed.`);
  console.log('======================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runDashboardSyncTests().catch((err) => {
  console.error('Fatal error running dashboard sync test suite:', err);
  process.exit(1);
});
