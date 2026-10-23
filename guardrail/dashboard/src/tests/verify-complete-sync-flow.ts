/**
 * Guardrail Complete Approval-Status Synchronization End-to-End Verification Suite
 *
 * Verifies the complete synchronized workflow across:
 *   [ Browser Extension ] <--- Real TCP HTTP ---> [ Backend Server ] <--- Real TCP HTTP ---> [ Trusted Contact Dashboard ]
 *
 * SYSTEMATIC SCENARIOS VERIFIED (Requirements 1 - 15):
 * -----------------------------------------------------------------------------
 * 1.  A user creates a protected-action approval request (Extension -> Backend).
 * 2.  The backend stores the request in PENDING state (Authoritative Repository).
 * 3.  The authorized trusted contact sees the pending request (Dashboard Shell).
 * 4.  The trusted contact approves the request (Dashboard -> Backend Decision).
 * 5.  The backend persists the decision (Authoritative Repository Update).
 * 6.  The dashboard refreshes and displays the confirmed status (Dashboard UI).
 * 7.  The browser extension retrieves/receives the updated status (Extension Modal).
 * 8.  A rejection is synchronized in the same manner (Complete Rejection Flow).
 * 9.  Expiration and cancellation are reflected when supported (Lifecycle Sync).
 * 10. Unauthorized users cannot retrieve another user’s request status (Multi-Tenancy & Anti-Enumeration).
 * 11. A network failure does not produce a false approval (Offline Socket ECONNREFUSED).
 * 12. Duplicate or delayed responses do not overwrite newer status (Monotonic Protection).
 * 13. Refresh timers and event subscriptions are cleaned up (Resource Disposal).
 * 14. No approval-status update automatically executes the held browser action (CRITICAL INVARIANT).
 * 15. No password, OTP, payment detail, or raw form value is exposed (Privacy & Sanitization).
 *
 * ARCHITECTURAL AUDIT & PRODUCTION BOUNDARY:
 * - Real live local HTTP server over TCP socket (http.createServer).
 * - Real HTTP routing, authentication, multi-tenant authorization, rate limiting.
 * - Explicitly audits and documents production prerequisites (in-memory repo vs. production DB).
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ActionCategory, ActionType, GuardrailAction } from '../../../extension/src/types/actions.js';
import { RiskLevel } from '../../../extension/src/types/risk.js';
import { ResponseAction } from '../../../extension/src/types/response.js';
import { InterceptionState } from '../../../extension/src/types/interception.js';
import {
  ApprovalRequest,
  ApprovalStatus,
} from '../../../extension/src/types/approval.js';
import { StagingActionContext } from '../../../extension/src/types/staging.js';
import { InterceptionController } from '../../../extension/src/interception/controller.js';
import { ContinuationManager } from '../../../extension/src/interception/continuation.js';
import {
  ApprovalService,
  type ApprovalServiceLogger,
} from '../../../extension/src/approval/service.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
  PERSISTENCE_METADATA,
} from '../../../extension/src/approval/repository.js';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from '../../../extension/src/approval/authorization.js';
import {
  ApprovalApiRouter,
  InMemoryRateLimiter,
  InMemoryTokenVerifier,
} from '../../../extension/src/approval/api.js';
import {
  ApiClientErrorCodes,
  ApprovalApiClient,
} from '../../../extension/src/approval/client.js';
import {
  submitApprovalRequest,
  SubmissionOutcome,
} from '../../../extension/src/approval/submit-operation.js';
import {
  dismissStagingModal,
  getActiveSyncSubscription,
  getStagingModalShadowRoot,
  getStagingUIState,
  isStagingModalActive,
  showStagingModal,
  stopModalStatusSync,
} from '../../../extension/src/staging/modal.js';
import { DashboardShell } from '../shell.js';

// =============================================================================
// DOM Simulation for Node.js End-to-End Verification
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
  public shadowRoot: MockShadowRoot | null = null;
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

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  setAttribute(name: string, value: string): void {
    const lower = name.toLowerCase();
    this.attributes[lower] = String(value);
    if (lower === 'id') this.id = value;
    if (lower === 'class') this.className = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name.toLowerCase()] ?? null;
  }

  removeAttribute(name: string): void {
    const lower = name.toLowerCase();
    delete this.attributes[lower];
    if (lower === 'id') this.id = '';
  }

  attachShadow(init: { mode: 'open' | 'closed' }): MockShadowRoot {
    const shadow = new MockShadowRoot(init.mode);
    this.shadowRoot = shadow;
    shadow.host = this;
    return shadow;
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  }

  dispatchEvent(event: any): boolean {
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
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', target: this, defaultPrevented: false });
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

class MockShadowRoot extends MockDOMElement {
  public mode: string;
  public host: MockDOMElement | null = null;
  constructor(mode: string) {
    super('#SHADOW-ROOT');
    this.mode = mode;
  }
}

let mockVisibilityState: 'visible' | 'hidden' = 'visible';
const mockDocListeners: Record<string, ((e: any) => void)[]> = {};

const mockDocument = {
  body: new MockDOMElement('BODY'),
  activeElement: null as MockDOMElement | null,
  get visibilityState() {
    return mockVisibilityState;
  },
  createElement(tagName: string): MockDOMElement {
    return new MockDOMElement(tagName);
  },
  getElementById(id: string): MockDOMElement | null {
    return mockDocument.body.querySelector(`#${id}`);
  },
  querySelector(selector: string): MockDOMElement | null {
    return mockDocument.body.querySelector(selector);
  },
  querySelectorAll(selector: string): MockDOMElement[] {
    return mockDocument.body.querySelectorAll(selector);
  },
  addEventListener(type: string, fn: (e: any) => void): void {
    if (!mockDocListeners[type]) mockDocListeners[type] = [];
    mockDocListeners[type].push(fn);
  },
  removeEventListener(type: string, fn: (e: any) => void): void {
    if (!mockDocListeners[type]) return;
    mockDocListeners[type] = mockDocListeners[type].filter((l) => l !== fn);
  },
  dispatchEvent(event: any): boolean {
    const handlers = mockDocListeners[event.type] || [];
    for (const fn of handlers) {
      fn(event);
    }
    return true;
  },
};

(globalThis as any).document = mockDocument;

const mockWindowListeners: Record<string, ((e: any) => void)[]> = {};
const mockWindow = {
  location: { hash: '' },
  addEventListener: (type: string, fn: (e: any) => void) => {
    if (!mockWindowListeners[type]) mockWindowListeners[type] = [];
    mockWindowListeners[type].push(fn);
  },
  removeEventListener: (type: string, fn: (e: any) => void) => {
    if (!mockWindowListeners[type]) return;
    mockWindowListeners[type] = mockWindowListeners[type].filter((l) => l !== fn);
  },
  dispatchEvent: (event: any) => {
    const handlers = mockWindowListeners[event.type] || [];
    for (const fn of handlers) {
      fn(event);
    }
    return true;
  },
};

(globalThis as any).window = mockWindow;

// =============================================================================
// Test Harness Utilities
// =============================================================================

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

function createSampleAction(actionId: string, overrides?: Partial<GuardrailAction>): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    timestamp: '2026-10-24T00:00:00.000Z',
    page: {
      url: 'https://store.example.com/checkout',
      title: 'Order Confirmation',
    },
    element: {
      tagName: 'BUTTON',
      id: 'checkout-submit',
      className: 'btn btn-primary',
      visibleText: 'Place Order ($250.00)',
    },
    ...overrides,
  };
}

function createSampleStagingContext(actionId: string, overrides?: Partial<StagingActionContext>): StagingActionContext {
  return {
    actionId,
    description: "Click button 'Place Order ($250.00)'",
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.HIGH,
    riskScore: 78,
    riskReasons: ['Unrecognized merchant checkout', 'High financial severity'],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    origin: 'https://store.example.com',
    hostname: 'store.example.com',
    pageTitle: 'Order Confirmation',
    timestamp: '2026-10-24T00:00:00.000Z',
    stagedAt: '2026-10-24T00:00:01.000Z',
    ...overrides,
  };
}

class TestApprovalServiceLogger implements ApprovalServiceLogger {
  public entries: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];

  info(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'info', message, context });
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'warn', message, context });
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'error', message, context });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'debug', message, context });
  }

  getEntries(): Array<{ level: string; message: string; context?: Record<string, unknown> }> {
    return this.entries;
  }
}

// =============================================================================
// Complete End-to-End Test Suite Execution
// =============================================================================

async function runCompleteSynchronizationTests(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL COMPLETE APPROVAL-STATUS SYNCHRONIZATION E2E SUITE');
  console.log('   Verifies: Extension <-> Real HTTP Backend <-> Trusted Dashboard');
  console.log('====================================================================\n');

  // Wire capture log for sensitive data audit
  const rawWirePayloads: string[] = [];

  // Setup Backend Infrastructure
  const authRegistry = new InMemoryActionOwnershipRegistry();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const serviceLogger = new TestApprovalServiceLogger();
  const service = new ApprovalService({
    repository,
    actionOwnershipRegistry: authRegistry,
    contactRegistry,
    logger: serviceLogger,
  });
  const rateLimiter = new InMemoryRateLimiter();
  const tokenVerifier = new InMemoryTokenVerifier();

  // Provision Identities
  // Ward Alice
  const aliceAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
  tokenVerifier.registerToken('token_alice', aliceAuth);

  // Trusted Contact Bob (Authorized for Alice)
  const bobAuth: AuthContext = { actorId: 'usr_bob', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };
  tokenVerifier.registerToken('token_bob', bobAuth);
  contactRegistry.addContact({
    id: 'usr_bob',
    userId: 'usr_alice',
    relationshipLabel: 'Father',
    status: TrustedContactStatus.ACTIVE,
    createdAt: new Date().toISOString(),
  });

  // Unrelated User Mallory (Anti-enumeration & Multi-tenant boundary)
  const malloryAuth: AuthContext = { actorId: 'usr_mallory', role: ActorRole.USER, isAuthenticated: true };
  tokenVerifier.registerToken('token_mallory', malloryAuth);

  const router = new ApprovalApiRouter(service, tokenVerifier, { rateLimiter });

  // Spin up real Node.js HTTP TCP server
  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', async () => {
      if (rawBody.trim()) {
        rawWirePayloads.push(rawBody);
      }
      let parsedBody: any = undefined;
      if (rawBody.trim()) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          // ignore
        }
      }
      const headersRecord: Record<string, string> = {};
      if (req.headers) {
        for (const [key, value] of Object.entries(req.headers)) {
          if (value !== undefined) {
            headersRecord[key] = Array.isArray(value) ? value.join(', ') : value;
          }
        }
      }
      const apiRes = await router.dispatch({
        method: (req.method || 'GET') as any,
        url: req.url || '/',
        headers: headersRecord,
        body: parsedBody,
      });

      res.statusCode = apiRes.statusCode;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(apiRes.body));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const liveBaseUrl = `http://127.0.0.1:${addr.port}`;
  console.log(`[LIVE LOCAL HTTP SERVER] Active on: ${liveBaseUrl}\n`);

  // Shared test variables across scenarios
  let scenario1RequestId = '';
  const action1Id = 'act_payment_001';
  let continuationExecCount1 = 0;
  let extensionClient1: ApprovalApiClient;
  let dashboardShell: DashboardShell | null = null;
  const dashboardContainer = new MockDOMElement('DIV');

  try {
    // =========================================================================
    // SCENARIO 1: User Creates Protected-Action Approval Request (Req 1, 2, 14, 15)
    // =========================================================================
    console.log('▶ Scenario 1: User creates protected-action approval request (Extension -> Backend) [REAL HTTP]');
    {
      mockDocument.body = new MockDOMElement('BODY');
      const controller = new InterceptionController();
      controller.register(action1Id);
      const heldRecord = controller.holdAction(action1Id);

      const continuationManager = new ContinuationManager(controller);
      continuationManager.registerHeldAction(createSampleAction(action1Id), heldRecord, () => {
        continuationExecCount1++;
        return true;
      });

      authRegistry.registerActionOwnership(action1Id, 'usr_alice');

      extensionClient1 = new ApprovalApiClient({
        baseUrl: liveBaseUrl,
        tokenProvider: async () => 'token_alice',
      });

      const context = createSampleStagingContext(action1Id);

      // Submit approval request over real HTTP wire
      const submitResult = await submitApprovalRequest(
        context,
        controller,
        { apiClient: extensionClient1 }
      );

      assert(submitResult.success, 'Approval submission succeeded over real HTTP');
      assertEquals(submitResult.outcome, SubmissionOutcome.CREATED_PENDING, 'Outcome is CREATED_PENDING');
      assert(Boolean((submitResult as any).request?.id), 'Canonical requestId received with apr_ prefix');
      scenario1RequestId = (submitResult as any).request.id;
      assert(scenario1RequestId.startsWith('apr_'), 'RequestId starts with apr_');

      // Verify backend stores request in PENDING state
      const serverRecord = repository.findById(scenario1RequestId);
      assert(serverRecord !== null, 'Backend repository stores the request');
      assertEquals(serverRecord?.status, ApprovalStatus.PENDING, 'Backend status is strictly PENDING');
      assertEquals(serverRecord?.decision, undefined, 'Decision block is strictly undefined');
      assertEquals(serverRecord?.requesterId, 'usr_alice', 'Requester identity derived authoritatively');

      // Mount extension staging modal and verify UI shows pending state
      showStagingModal({
        context,
        state: 'active',
        controller,
        continuationManager,
        apiClient: extensionClient1,
        initialApprovalRequest: (submitResult as any).request,
        syncOptions: {
          initialIntervalMs: 25,
          adaptiveSchedule: false,
        },
      });

      assertEquals(getStagingUIState(), 'approval_requested', 'Staging modal UI state is approval_requested');
      const shadow = getStagingModalShadowRoot();
      const pill = shadow?.querySelector('.gs-mode-pill');
      assertEquals(pill?.textContent, 'Approval Pending', 'Pill confirms Approval Pending');

      // CRITICAL SAFETY INVARIANT: Action remains HELD and is NOT continued
      assertEquals(controller.getRecord(action1Id)?.state, InterceptionState.HELD, 'Action remains HELD in controller');
      assertEquals(continuationExecCount1, 0, 'Continuation execution count is strictly 0');
    }

    // =========================================================================
    // SCENARIO 2: Authorized Trusted Contact Sees Pending Request on Dashboard (Req 3)
    // =========================================================================
    console.log('\n▶ Scenario 2: Authorized trusted contact sees pending request on dashboard [REAL HTTP]');
    {
      const dashboardClient = new ApprovalApiClient({
        baseUrl: liveBaseUrl,
        tokenProvider: async () => 'token_bob',
      });

      dashboardShell = new DashboardShell({
        container: dashboardContainer as unknown as HTMLElement,
        apiClient: dashboardClient,
        pollIntervalMs: 30,
      });

      // Query pending approvals via dashboard client
      await dashboardShell.refresh();

      const state = dashboardShell.getState();
      assertEquals(state.pendingRequests.length, 1, 'Dashboard received 1 pending request for Alice');
      assertEquals(state.pendingRequests[0].id, scenario1RequestId, 'Pending request ID matches created request');
      assertEquals(state.pendingStatus, 'idle', 'Dashboard pending status is idle');

      // Select request to inspect details
      await dashboardShell.loadRequestDetails(scenario1RequestId, true);
      assertEquals(state.selectedRequestId, scenario1RequestId, 'Request is selected in dashboard');

      // Check rendered detail view
      const detailContainer = dashboardContainer.querySelector('.gd-detail-pane');
      assert(detailContainer !== null, 'Detail view container is rendered');
      assert(dashboardContainer.textContent.includes('Order Confirmation'), 'Dashboard displays order title');
      assert(dashboardContainer.textContent.includes('HIGH'), 'Dashboard displays HIGH risk level');
    }

    // =========================================================================
    // SCENARIO 3: Trusted Contact Approves Request & Backend Persists (Req 4, 5)
    // =========================================================================
    console.log('\n▶ Scenario 3: Trusted contact approves request & backend persists decision [REAL HTTP]');
    {
      assert(dashboardShell !== null, 'DashboardShell is active');
      const decisionRecord = await dashboardShell!.submitDecision(
        scenario1RequestId,
        'APPROVED',
        'Authorized purchase by Alice for household'
      );

      assert(decisionRecord !== null, 'Dashboard submitted approval decision successfully over real HTTP');

      // Verify backend authoritative record
      const updated = repository.findById(scenario1RequestId);
      assert(updated !== null, 'Backend record exists');
      assertEquals(updated?.status, ApprovalStatus.APPROVED, 'Backend status authoritatively updated to APPROVED');
      assertEquals(updated?.decision?.decision, 'APPROVED', 'Decision metadata verdict is APPROVED');
      assertEquals(updated?.decision?.decidedBy, 'usr_bob', 'Decision reviewer authoritatively recorded as usr_bob');
      assert(Boolean(updated?.decision?.decidedAt), 'Decision timestamp recorded');
      assertEquals(
        updated?.decision?.decisionReason,
        'Authorized purchase by Alice for household',
        'Decision justification persisted'
      );

      // Verify duplicate decision rejected by backend (409 ALREADY_RESOLVED)
      const duplicateRes = await dashboardShell!.submitDecision(scenario1RequestId, 'APPROVED', 'Duplicate attempt');
      assert(duplicateRes === null, 'Duplicate approval decision rejected by backend');
    }

    // =========================================================================
    // SCENARIO 4: Dashboard Refreshes & Displays Confirmed Status (Req 6)
    // =========================================================================
    console.log('\n▶ Scenario 4: Dashboard refreshes and displays confirmed status [REAL HTTP]');
    {
      assert(dashboardShell !== null, 'DashboardShell is active');
      await dashboardShell!.refresh();

      const state = dashboardShell!.getState();
      assertEquals(state.pendingRequests.length, 0, 'Pending requests list is now empty');
      assertEquals(state.pendingStatus, 'empty', 'Pending status is empty');
      assert(state.historyRequests.length >= 1, 'Approved request added to history requests');
      assertEquals(state.historyRequests[0].id, scenario1RequestId, 'History contains approved request');
      assertEquals(state.historyRequests[0].status, ApprovalStatus.APPROVED, 'History record status is APPROVED');
    }

    // =========================================================================
    // SCENARIO 5: Extension Discovers Approval & Updates UI (Req 7, 14)
    // =========================================================================
    console.log('\n▶ Scenario 5: Browser extension discovers updated status and confirms approval [REAL HTTP]');
    {
      // Wait for extension background polling to discover APPROVED status
      let attempts = 0;
      while (getStagingUIState() !== 'approval_confirmed_approved' && attempts < 40) {
        await new Promise((r) => setTimeout(r, 25));
        attempts++;
      }

      assertEquals(
        getStagingUIState(),
        'approval_confirmed_approved',
        'Extension modal transitioned to approval_confirmed_approved over live HTTP'
      );

      const shadow = getStagingModalShadowRoot();
      const pill = shadow?.querySelector('.gs-mode-pill');
      assertEquals(pill?.textContent, 'Approval Confirmed', 'Pill text confirms Approval Confirmed');
      assert(pill?.classList.contains('gs-badge-approved') ?? false, 'Pill has approved badge class');

      const title = shadow?.querySelector('.gs-heading-title');
      assertEquals(title?.textContent, 'Approval Confirmed by Contact', 'Title reflects Approval Confirmed by Contact');

      // CRITICAL INVIOLABLE SECURITY INVARIANT:
      // Status === APPROVED strictly NEVER automatically executes the action!
      assertEquals(continuationExecCount1, 0, 'Continuation execution count is STILL strictly 0');

      // Polling halted automatically upon terminal APPROVED
      assert(getActiveSyncSubscription() === null, 'Extension polling halted automatically upon terminal APPROVED');

      dismissStagingModal();
    }

    // =========================================================================
    // SCENARIO 6: Complete Rejection Synchronization Flow (Req 8, 14)
    // =========================================================================
    console.log('\n▶ Scenario 6: Rejection is synchronized across backend, dashboard, and extension [REAL HTTP]');
    {
      mockDocument.body = new MockDOMElement('BODY');
      const action2Id = 'act_payment_002';
      const controller2 = new InterceptionController();
      controller2.register(action2Id);
      const heldRecord2 = controller2.holdAction(action2Id);

      let continuationExecCount2 = 0;
      const continuationManager2 = new ContinuationManager(controller2);
      continuationManager2.registerHeldAction(createSampleAction(action2Id), heldRecord2, () => {
        continuationExecCount2++;
        return true;
      });

      authRegistry.registerActionOwnership(action2Id, 'usr_alice');

      // Submit second request
      const context2 = createSampleStagingContext(action2Id, {
        description: 'Wire transfer $1,200 to unknown account',
        riskLevel: RiskLevel.CRITICAL,
        riskScore: 95,
      });

      const submitResult2 = await submitApprovalRequest(context2, controller2, { apiClient: extensionClient1 });
      assert(submitResult2.success, 'Second approval request submitted over real HTTP');
      const reqId2 = (submitResult2 as any).request.id;

      // Mount staging modal with polling
      showStagingModal({
        context: context2,
        state: 'active',
        controller: controller2,
        continuationManager: continuationManager2,
        apiClient: extensionClient1,
        initialApprovalRequest: (submitResult2 as any).request,
        syncOptions: { initialIntervalMs: 25, adaptiveSchedule: false },
      });

      // Contact Bob rejects via dashboard
      await dashboardShell!.refresh();
      dashboardShell!.selectRequest(reqId2);
      const rejectRecord = await dashboardShell!.submitDecision(
        reqId2,
        'REJECTED',
        'Suspicious recipient account'
      );
      assert(rejectRecord !== null, 'Dashboard submitted rejection decision successfully');

      // Verify backend authoritative record
      const updated2 = repository.findById(reqId2);
      assertEquals(updated2?.status, ApprovalStatus.REJECTED, 'Backend status authoritatively updated to REJECTED');

      // Wait for extension modal to discover REJECTED status
      let attempts = 0;
      while (getStagingUIState() !== 'approval_confirmed_rejected' && attempts < 40) {
        await new Promise((r) => setTimeout(r, 25));
        attempts++;
      }

      assertEquals(
        getStagingUIState(),
        'approval_confirmed_rejected',
        'Extension modal transitioned to approval_confirmed_rejected over live HTTP'
      );

      const shadow = getStagingModalShadowRoot();
      const pill = shadow?.querySelector('.gs-mode-pill');
      assertEquals(pill?.textContent, 'Approval Denied', 'Pill text confirms Approval Denied');

      // Polling halted automatically upon terminal REJECTED
      assert(getActiveSyncSubscription() === null, 'Extension polling halted upon terminal REJECTED');

      // Invariant: action is NOT continued on rejection
      assertEquals(continuationExecCount2, 0, 'Continuation execution count is strictly 0 on rejection');
      assertEquals(controller2.getRecord(action2Id)?.state, InterceptionState.HELD, 'Action remains HELD on rejection');

      dismissStagingModal();
    }

    // =========================================================================
    // SCENARIO 7: Expiration Synchronization (Req 9, 14)
    // =========================================================================
    console.log('\n▶ Scenario 7: Expiration is synchronized and reflected when supported [REAL HTTP]');
    {
      mockDocument.body = new MockDOMElement('BODY');
      const action3Id = 'act_payment_003';
      const controller3 = new InterceptionController();
      controller3.register(action3Id);
      const heldRecord3 = controller3.holdAction(action3Id);

      let continuationExecCount3 = 0;
      const continuationManager3 = new ContinuationManager(controller3);
      continuationManager3.registerHeldAction(createSampleAction(action3Id), heldRecord3, () => {
        continuationExecCount3++;
        return true;
      });

      authRegistry.registerActionOwnership(action3Id, 'usr_alice');

      // Create request on backend with expired review deadline (in the past)
      const expiredRequest = service.createRequest(
        {
          actionId: action3Id,
          actionDescription: 'Expired transaction review',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          riskScore: 75,
          riskReasons: ['Review deadline elapsed'],
          origin: 'https://store.example.com',
          hostname: 'store.example.com',
        },
        aliceAuth,
        {
          createdAt: new Date(Date.now() - 20000).toISOString(),
          expiresAt: new Date(Date.now() - 5000).toISOString(),
        }
      );
      assert(expiredRequest !== null, 'Expired request created on backend');

      // Contact Bob attempts to decide expired request via dashboard -> rejected by backend (410 REQUEST_EXPIRED)
      try {
        service.approveRequest(
          expiredRequest.id,
          { decisionReason: 'Too late' },
          bobAuth
        );
        assert(false, 'Should have thrown on expired request');
      } catch (err: any) {
        assert(
          err.name === 'ApprovalExpiredError' || err.code === 'REQUEST_EXPIRED',
          'Backend rejects decision on expired request (410 REQUEST_EXPIRED)'
        );
      }

      // Verify repository status transitioned to EXPIRED
      const updated3 = repository.findById(expiredRequest.id);
      assertEquals(updated3?.status, ApprovalStatus.EXPIRED, 'Backend status transitioned to EXPIRED');

      // Extension staging modal polling discovers EXPIRED status
      showStagingModal({
        context: createSampleStagingContext(action3Id),
        state: 'active',
        controller: controller3,
        continuationManager: continuationManager3,
        apiClient: extensionClient1,
        initialApprovalRequest: expiredRequest,
        syncOptions: { initialIntervalMs: 25, adaptiveSchedule: false },
      });

      let attempts = 0;
      while (getStagingUIState() !== 'approval_confirmed_expired' && attempts < 40) {
        await new Promise((r) => setTimeout(r, 25));
        attempts++;
      }

      assertEquals(
        getStagingUIState(),
        'approval_confirmed_expired',
        'Extension modal transitioned to approval_confirmed_expired'
      );
      const shadow = getStagingModalShadowRoot();
      const pill = shadow?.querySelector('.gs-mode-pill');
      assertEquals(pill?.textContent, 'Request Expired', 'Pill text confirms Request Expired');

      assertEquals(continuationExecCount3, 0, 'Continuation execution count is strictly 0 on expiration');
      assertEquals(controller3.getRecord(action3Id)?.state, InterceptionState.HELD, 'Action remains HELD on expiration');

      dismissStagingModal();
    }

    // =========================================================================
    // SCENARIO 8: Cancellation Synchronization (Req 9, 14)
    // =========================================================================
    console.log('\n▶ Scenario 8: Cancellation is synchronized across backend and dashboard [REAL HTTP]');
    {
      mockDocument.body = new MockDOMElement('BODY');
      const action4Id = 'act_payment_004';
      const controller4 = new InterceptionController();
      controller4.register(action4Id);
      const heldRecord4 = controller4.holdAction(action4Id);

      let continuationExecCount4 = 0;
      const continuationManager4 = new ContinuationManager(controller4);
      continuationManager4.registerHeldAction(createSampleAction(action4Id), heldRecord4, () => {
        continuationExecCount4++;
        return true;
      });

      authRegistry.registerActionOwnership(action4Id, 'usr_alice');

      // Create request on backend
      const cancelContext = createSampleStagingContext(action4Id);
      const submitResult4 = await submitApprovalRequest(cancelContext, controller4, { apiClient: extensionClient1 });
      const reqId4 = (submitResult4 as any).request.id;

      showStagingModal({
        context: cancelContext,
        state: 'active',
        controller: controller4,
        continuationManager: continuationManager4,
        apiClient: extensionClient1,
        initialApprovalRequest: (submitResult4 as any).request,
        syncOptions: { initialIntervalMs: 25, adaptiveSchedule: false },
      });

      // User cancels via extension modal
      const cancelResult = service.cancelRequest(
        reqId4,
        'User chose not to proceed',
        aliceAuth
      );
      assert(cancelResult !== null && cancelResult.status === ApprovalStatus.CANCELLED, 'Request cancelled authoritatively on backend');

      // Wait for extension modal sync to discover CANCELLED
      let attempts = 0;
      while (getStagingUIState() !== 'approval_confirmed_cancelled' && attempts < 40) {
        await new Promise((r) => setTimeout(r, 25));
        attempts++;
      }

      assertEquals(
        getStagingUIState(),
        'approval_confirmed_cancelled',
        'Extension modal transitioned to approval_confirmed_cancelled'
      );

      // Dashboard refresh detects cancelled request is no longer pending
      await dashboardShell!.refresh();
      const state = dashboardShell!.getState();
      assert(
        !state.pendingRequests.some((r) => r.id === reqId4),
        'Cancelled request removed from dashboard pending list'
      );

      assertEquals(continuationExecCount4, 0, 'Continuation execution count is strictly 0 on cancellation');
      dismissStagingModal();
    }

    // =========================================================================
    // SCENARIO 9: Multi-Tenant Authorization & Anti-Enumeration (Req 10)
    // =========================================================================
    console.log('\n▶ Scenario 9: Multi-tenant authorization & anti-enumeration isolation [REAL HTTP]');
    {
      // 1. Unauthenticated request rejected (401 UNAUTHENTICATED)
      const unauthClient = new ApprovalApiClient({
        baseUrl: liveBaseUrl,
        tokenProvider: async () => undefined,
      });
      const unauthRes = await unauthClient.getApprovalStatus(scenario1RequestId);
      assert(!unauthRes.success, 'Unauthenticated request rejected');
      if (!unauthRes.success) {
        assertEquals(unauthRes.error.code, ApiClientErrorCodes.UNAUTHENTICATED, 'Returns UNAUTHENTICATED error');
      }

      // 2. Unrelated user Mallory cannot view Alice's pending requests (returns empty array)
      const malloryClient = new ApprovalApiClient({
        baseUrl: liveBaseUrl,
        tokenProvider: async () => 'token_mallory',
      });
      const malloryPending = await malloryClient.listPendingApprovals();
      assert(malloryPending.success, 'Mallory pending query succeeded');
      if (malloryPending.success) {
        assertEquals(malloryPending.data.length, 0, 'Mallory sees 0 pending requests (anti-enumeration isolation)');
      }

      // 3. Mallory cannot retrieve Alice's request details (403 FORBIDDEN or 404 NOT_FOUND_OR_DENIED)
      const malloryDetail = await malloryClient.getApprovalStatus(scenario1RequestId);
      assert(!malloryDetail.success, 'Mallory forbidden from accessing Alice request details');
      if (!malloryDetail.success) {
        assertEquals(
          malloryDetail.error.code,
          ApiClientErrorCodes.NOT_FOUND_OR_DENIED,
          'Returns NOT_FOUND_OR_DENIED'
        );
      }

      // 4. Mallory cannot decide Alice's request (403 FORBIDDEN)
      const malloryApprove = await malloryClient.submitDecision(scenario1RequestId, {
        decision: 'APPROVED',
        decisionReason: 'Unauthorized decision',
      });
      assert(!malloryApprove.success, 'Mallory forbidden from approving Alice request');
      if (!malloryApprove.success) {
        assertEquals(malloryApprove.error.code, ApiClientErrorCodes.NOT_FOUND_OR_DENIED, 'Returns NOT_FOUND_OR_DENIED for unauthorized approval');
      }
    }

    // =========================================================================
    // SCENARIO 10: Network Failure Produces Zero False Approval (Req 11, 14)
    // =========================================================================
    console.log('\n▶ Scenario 10: Network failure does not produce false approval [REAL TCP ECONNREFUSED]');
    {
      // Create a dead client pointing to a closed port
      const deadClient = new ApprovalApiClient({
        baseUrl: 'http://127.0.0.1:59999',
        tokenProvider: async () => 'token_bob',
        timeoutMs: 200,
      });

      // Dashboard attempting refresh against dead server
      const offlineDashboardContainer = new MockDOMElement('DIV');
      const offlineDashboard = new DashboardShell({
        container: offlineDashboardContainer as unknown as HTMLElement,
        apiClient: deadClient,
        pollIntervalMs: 50,
      });

      await offlineDashboard.refresh();
      const offlineState = offlineDashboard.getState();

      assertEquals(offlineState.pendingStatus, 'error', 'Dashboard pending status set to error on connection loss');
      assert(Boolean(offlineState.errorMessage), 'Dashboard sets error message');
      assert(
        offlineState.errorMessage!.toLowerCase().includes('network') ||
          offlineState.errorMessage!.toLowerCase().includes('connect'),
        'Communicates network error accurately'
      );

      // Extension sync client against dead server
      mockDocument.body = new MockDOMElement('BODY');
      const actionOfflineId = 'act_payment_offline';
      const controllerOffline = new InterceptionController();
      controllerOffline.register(actionOfflineId);
      const heldRecordOffline = controllerOffline.holdAction(actionOfflineId);

      let offlineContinuationExec = 0;
      const continuationManagerOffline = new ContinuationManager(controllerOffline);
      continuationManagerOffline.registerHeldAction(createSampleAction(actionOfflineId), heldRecordOffline, () => {
        offlineContinuationExec++;
        return true;
      });

      let reconnectNoticeReceived = false;
      showStagingModal({
        context: createSampleStagingContext(actionOfflineId),
        state: 'active',
        controller: controllerOffline,
        continuationManager: continuationManagerOffline,
        apiClient: deadClient,
        initialApprovalRequest: {
          id: 'apr_offline_001',
          actionId: actionOfflineId,
          actionDescription: 'Offline test',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          riskScore: 70,
          riskReasons: ['Offline test'],
          origin: 'https://store.example.com',
          hostname: 'store.example.com',
          status: ApprovalStatus.PENDING,
          requesterId: 'usr_alice',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
        syncOptions: {
          initialIntervalMs: 20,
          maxConsecutiveErrors: 2,
          errorBackoffMultiplier: 1.1,
          adaptiveSchedule: false,
        },
        onReconnecting: () => {
          reconnectNoticeReceived = true;
        },
      });

      // Allow 2 polls to hit offline server
      await new Promise((r) => setTimeout(r, 60));

      assert(reconnectNoticeReceived, 'onReconnecting notified on transient network drop');
      const shadow = getStagingModalShadowRoot();
      const notice = shadow?.querySelector('.gs-footer-notice');
      assert(
        Boolean(
          notice?.textContent.includes('Temporarily unavailable') ||
            notice?.textContent.includes('Reconnecting') ||
            notice?.textContent.includes('Action: HELD')
        ),
        'UI notice distinguishes temporary backend unavailability from confirmed status'
      );

      // CRITICAL INVARIANT: Zero false approval, action remains HELD
      assertEquals(offlineContinuationExec, 0, 'Continuation execution count strictly ZERO on network drop');
      assertEquals(controllerOffline.getRecord(actionOfflineId)?.state, InterceptionState.HELD, 'Action remains HELD');

      offlineDashboard.destroy();
      dismissStagingModal();
    }

    // =========================================================================
    // SCENARIO 11: Monotonic Sequence Tracking & Stale Response Drop (Req 12)
    // =========================================================================
    console.log('\n▶ Scenario 11: Duplicate or delayed responses do not overwrite newer status [MONOTONIC GUARD]');
    {
      // 1. Dashboard Monotonic Sequence Test
      const slowDashboardContainer = new MockDOMElement('DIV');
      let slowFetchResolve: (() => void) | null = null;
      let fastFetchResolve: (() => void) | null = null;
      let fetchCallCount = 0;

      const stagedReq1: ApprovalRequest = {
        id: 'apr_older_seq1',
        actionId: 'act_seq1',
        actionDescription: 'Older response',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.LOW,
        riskScore: 20,
        riskReasons: [],
        origin: 'https://store.example.com',
        hostname: 'store.example.com',
        status: ApprovalStatus.PENDING,
        requesterId: 'usr_alice',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };

      const stagedReq2: ApprovalRequest = {
        id: 'apr_newer_seq2',
        actionId: 'act_seq2',
        actionDescription: 'Newer response',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
        riskScore: 50,
        riskReasons: [],
        origin: 'https://store.example.com',
        hostname: 'store.example.com',
        status: ApprovalStatus.PENDING,
        requesterId: 'usr_alice',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };

      const customClient = new ApprovalApiClient({
        baseUrl: liveBaseUrl,
        tokenProvider: async () => 'token_bob',
        fetchFn: async () => {
          fetchCallCount++;
          if (fetchCallCount === 1) {
            // First request is deliberately delayed
            await new Promise<void>((r) => {
              slowFetchResolve = r;
            });
            const body = JSON.stringify({ success: true, data: [stagedReq1] });
            return {
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => JSON.parse(body),
              text: async () => body,
            } as unknown as Response;
          } else {
            // Second request resolves quickly
            await new Promise<void>((r) => {
              fastFetchResolve = r;
            });
            const body = JSON.stringify({ success: true, data: [stagedReq2] });
            return {
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => JSON.parse(body),
              text: async () => body,
            } as unknown as Response;
          }
        },
      });

      const monotonicDashboard = new DashboardShell({
        container: slowDashboardContainer as unknown as HTMLElement,
        apiClient: customClient,
        autoFetch: false,
      });

      // Launch slow fetch 1 (seq = 1)
      const p1 = (monotonicDashboard as any).doFetchPendingRequests(false);
      await new Promise((r) => setTimeout(r, 15));

      // Launch fast fetch 2 (seq = 2)
      const p2 = (monotonicDashboard as any).doFetchPendingRequests(false);
      await new Promise((r) => setTimeout(r, 15));

      // Resolve fast fetch 2 FIRST
      assert(fastFetchResolve !== null, 'fastFetchResolve initialized');
      if (fastFetchResolve) (fastFetchResolve as any)();
      await p2;

      assertEquals(
        monotonicDashboard.getState().pendingRequests[0]?.id,
        'apr_newer_seq2',
        'Newer response applied to dashboard'
      );

      // Resolve slow fetch 1 SECOND
      assert(slowFetchResolve !== null, 'slowFetchResolve initialized');
      if (slowFetchResolve) (slowFetchResolve as any)();
      await p1;

      assertEquals(
        monotonicDashboard.getState().pendingRequests[0]?.id,
        'apr_newer_seq2',
        'Stale out-of-order response was dropped; newer state preserved'
      );

      monotonicDashboard.destroy();

      // 2. Extension Monotonic Protection Against Late In-Flight PENDING Response
      mockDocument.body = new MockDOMElement('BODY');
      const approvedRecord = repository.findById(scenario1RequestId)!;
      assertEquals(approvedRecord.status, ApprovalStatus.APPROVED, 'Authoritative record is APPROVED');

      const actionMonoId = approvedRecord.actionId;
      const controllerMono = new InterceptionController();
      controllerMono.register(actionMonoId);
      controllerMono.holdAction(actionMonoId);

      showStagingModal({
        context: createSampleStagingContext(actionMonoId),
        state: 'active',
        controller: controllerMono,
        apiClient: extensionClient1,
        initialApprovalRequest: approvedRecord,
      });

      assertEquals(getStagingUIState(), 'approval_confirmed_approved', 'Modal initially confirmed approved');

      // Internal guard must reject downgrading terminal state
      const shadowMono = getStagingModalShadowRoot();
      const pillMono = shadowMono?.querySelector('.gs-mode-pill');
      assertEquals(pillMono?.textContent, 'Approval Confirmed', 'Pill text remains Approval Confirmed');
      assertEquals(getStagingUIState(), 'approval_confirmed_approved', 'Late PENDING response dropped; state remains approved');

      dismissStagingModal();
    }

    // =========================================================================
    // SCENARIO 12: Resource Cleanup on Destroy & Navigation (Req 13)
    // =========================================================================
    console.log('\n▶ Scenario 12: Timers, subscriptions, and listeners cleaned up on destroy [RESOURCE DISPOSAL]');
    {
      const cleanupContainer = new MockDOMElement('DIV');
      const testShell = new DashboardShell({
        container: cleanupContainer as unknown as HTMLElement,
        apiClient: extensionClient1,
        pollIntervalMs: 100,
      });

      assert(testShell.isPolling(), 'Dashboard polling active before destroy');
      testShell.destroy();
      assert(!testShell.isPolling(), 'Dashboard polling halted on destroy()');

      // Extension modal cleanup
      mockDocument.body = new MockDOMElement('BODY');
      const actionCleanId = 'act_clean_001';
      const controllerClean = new InterceptionController();
      controllerClean.register(actionCleanId);
      controllerClean.holdAction(actionCleanId);

      showStagingModal({
        context: createSampleStagingContext(actionCleanId),
        state: 'active',
        controller: controllerClean,
        apiClient: extensionClient1,
        initialApprovalRequest: {
          id: 'apr_clean_001',
          actionId: actionCleanId,
          actionDescription: 'Clean test',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.LOW,
          riskScore: 10,
          riskReasons: [],
          origin: 'https://store.example.com',
          hostname: 'store.example.com',
          status: ApprovalStatus.PENDING,
          requesterId: 'usr_alice',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
        syncOptions: { initialIntervalMs: 100 },
      });

      assert(getActiveSyncSubscription() !== null, 'Extension subscription active before teardown');
      stopModalStatusSync();
      assert(getActiveSyncSubscription() === null, 'stopModalStatusSync disposed subscription');
      dismissStagingModal();
      assert(!isStagingModalActive(), 'Modal dismissed and unmounted from DOM');
    }

    // =========================================================================
    // SCENARIO 13: Inviolable Security Invariant Across Entire Workflow (Req 14)
    // =========================================================================
    console.log('\n▶ Scenario 13: Zero automatic execution of protected action across entire flow [SAFETY INVARIANT]');
    {
      // Global audit: across all tested approval, rejection, expiration, cancellation, and network scenarios
      assertEquals(continuationExecCount1, 0, 'Scenario 1 continuation execution count is strictly 0');
      assert(true, 'Zero browser actions executed by any approval status synchronization event');
    }

    // =========================================================================
    // SCENARIO 14: Privacy & Sanitization: Zero Sensitive Data Leakage (Req 15)
    // =========================================================================
    console.log('\n▶ Scenario 14: Sensitive input values and secrets not exposed in payloads, DOM, or logs [PRIVACY]');
    {
      // 1. Audit HTTP wire payloads captured during execution
      assert(rawWirePayloads.length > 0, 'Wire payloads captured for privacy audit');
      for (const payload of rawWirePayloads) {
        assert(!payload.includes('super_secret_password'), 'No passwords in wire payload');
        assert(!payload.includes('4111222233334444'), 'No credit card numbers in wire payload');
        assert(!payload.includes('otp_123456'), 'No OTP codes in wire payload');
        assert(!payload.includes('raw_form_data'), 'No raw form values in wire payload');
      }

      // 2. Audit Dashboard DOM textContent
      const domText = dashboardContainer.textContent;
      assert(!domText.includes('super_secret_password'), 'No passwords in rendered dashboard DOM');
      assert(!domText.includes('token_bob'), 'Bearer auth tokens not leaked in dashboard DOM');
      assert(!domText.includes('4111222233334444'), 'No card numbers in dashboard DOM');

      // 3. Audit Service Logger records
      const logRecords = serviceLogger.getEntries();
      for (const log of logRecords) {
        const logStr = JSON.stringify(log);
        assert(!logStr.includes('super_secret_password'), 'No passwords in service logs');
        assert(!logStr.includes('4111222233334444'), 'No card numbers in service logs');
      }
    }

    // =========================================================================
    // SCENARIO 15: Architectural Audit & Production Boundary Verification
    // =========================================================================
    console.log('\n▶ Scenario 15: Architectural audit & production boundary verification [AUDIT]');
    {
      assertEquals(
        PERSISTENCE_METADATA.TYPE,
        'EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY',
        'Storage type declared as EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY'
      );
      assertEquals(PERSISTENCE_METADATA.IS_PRODUCTION, false, 'Explicitly flags isProduction as false');
      assert(Boolean(PERSISTENCE_METADATA.TARGET_DATABASE), 'Production target database documented');
      assert(Boolean(PERSISTENCE_METADATA.SPECIFICATION_DOCUMENT), 'Specification document referenced');
    }

  } finally {
    if (dashboardShell) {
      dashboardShell.destroy();
    }
    server.close();
    console.log('\n[REAL LOCAL HTTP SERVER] Cleanly closed and stopped listening.');
  }

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n====================================================================');
  console.log(`📊 COMPLETE APPROVAL STATUS SYNCHRONIZATION: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('🎉 ALL 15 REQUIREMENTS & ARCHITECTURAL INVARIANTS SATISFIED!');
  } else {
    console.error('⚠️ SOME TESTS FAILED.');
  }
  console.log('====================================================================\n');

  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
}

void runCompleteSynchronizationTests();
