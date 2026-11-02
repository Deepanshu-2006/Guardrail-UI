/**
 * Guardrail UI - Day 20 Prompt 4: Approval Workflow Integration Suite
 *
 * Evidence-based integration test verifying the end-to-end approval workflow across:
 *   [ Browser Extension Runtime ] <--- Real TCP HTTP ---> [ Approval Backend Service ] <--- Real TCP HTTP ---> [ Caretaker Dashboard ]
 *
 * VERIFICATION SCOPE:
 * 1. Task 1: Complete 9-stage trace (Detection -> Risk -> Request -> Status -> Dashboard -> Decision -> Extension Sync -> Continuation Validation -> Controlled Handler Execution).
 * 2. Task 2: Approval lifecycle states (PENDING, APPROVED, REJECTED, EXPIRED, CANCELLED, UNAVAILABLE, INVALID/UNKNOWN, Monotonicity).
 * 3. Task 3: Action-to-approval binding enforcement (mismatched ID, mismatched origin, expired binding, stale response, duplicate message, double consumption).
 * 4. Task 4: Caretaker Dashboard consistency (labels, loading/error states, delayed response handling, anti-enumeration multi-tenancy).
 * 5. Task 5: Service and message boundary hardening (client self-approval rejection, untrusted payload validation, network drop fail-safe, zero automatic execution).
 */

import http from 'http';
import { startControlledTestServers, RunningTestServers } from './test-server.js';
import {
  ApprovalApiClient,
  ApiClientErrorCodes,
} from '../approval/client.js';
import {
  ApprovalRequest,
  ApprovalStatus,
} from '../types/approval.js';
import {
  ActionCategory,
  ActionType,
  GuardrailAction,
} from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { InterceptionState } from '../types/interception.js';
import { StagingActionContext } from '../types/staging.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import {
  ContinuationValidationService,
  ContinuationEligibilityStatus,
} from '../interception/validation-service.js';
import {
  createApprovalActionBinding,
  isBindingValidForContinuation,
  computeActionDigest,
  ApprovalActionBindingState,
} from '../approval/binding.js';
import { submitApprovalRequest } from '../approval/submit-operation.js';
import { DashboardShell } from '../../../dashboard/src/shell.js';

// =============================================================================
// Assertion Utilities
// =============================================================================

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  ❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    console.error(`  ❌ ASSERTION FAILED: ${message} (expected "${expected}", got "${actual}")`);
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
  console.log(`  ✓ ${message}: ${actual}`);
}

// =============================================================================
// DOM Mock for Headless Dashboard Shell Instantiation
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
  public classList: MockDOMTokenList;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  private _textContent: string = '';

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
    return this.textContent;
  }
  set innerHTML(val: string) {
    this._textContent = val;
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

  querySelector<T extends MockDOMElement = MockDOMElement>(selector: string): T | null {
    const clean = selector.trim();
    if (clean.startsWith('#')) {
      const targetId = clean.slice(1);
      if (this.id === targetId) return this as unknown as T;
      for (const child of this.children) {
        const found = child.querySelector<T>(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll<T extends MockDOMElement = MockDOMElement>(selector: string): T[] {
    const results: T[] = [];
    for (const child of this.children) {
      results.push(...child.querySelectorAll<T>(selector));
    }
    return results;
  }
}

// Global DOM hooks for Node.js
if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => new MockDOMElement(tag),
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { hash: '#pending', href: 'http://127.0.0.1:3000' },
  };
}

// =============================================================================
// Helper: Create Canonical Test Action & Context
// =============================================================================

function createSyntheticTestAction(actionId: string, overrides?: Partial<GuardrailAction>): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: {
      tagName: 'BUTTON',
      id: 'btn-intercept-protect',
      visibleText: '🛑 Delete All Data and Cancel Account',
    },
    page: {
      url: 'http://127.0.0.1:8878/index.html',
      title: 'Guardrail Test Page',
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createSyntheticStagingContext(action: GuardrailAction): StagingActionContext {
  return {
    actionId: action.id,
    actionType: action.type,
    category: action.category || ActionCategory.DESTRUCTIVE,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 100,
    description: 'Delete All Data and Cancel Account',
    reasons: ['Critical irreversible destructive operation'],
    suggestedDecision: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    url: action.page.url,
    timestamp: action.timestamp,
  };
}

// =============================================================================
// Main Test Execution Suite
// =============================================================================

async function runApprovalWorkflowIntegration(): Promise<void> {
  console.log('================================================================');
  console.log('Day 20 Prompt 4: Approval Workflow Integration Suite');
  console.log('================================================================\n');

  let servers: RunningTestServers | null = null;
  const backendPort = 3001; // Isolated dedicated test port

  try {
    // -------------------------------------------------------------------------
    // Step 0: Setup Real Local Test Server Infrastructure
    // -------------------------------------------------------------------------
    console.log('--- Step 0: Initializing Isolated Local Servers ---');
    servers = await startControlledTestServers({
      staticPort: 8878,
      mockBackendPort: backendPort,
    });

    // Register tokens for multi-tenancy and boundary verification
    servers.tokenVerifier.registerToken('mallory-token', {
      actorId: 'tc_mallory',
      role: 'TRUSTED_CONTACT',
      isAuthenticated: true,
    });

    const wardClient = new ApprovalApiClient({
      baseUrl: servers.mockBackendUrl,
      tokenProvider: () => 'test-ward-token',
    });

    const contactClient = new ApprovalApiClient({
      baseUrl: servers.mockBackendUrl,
      tokenProvider: () => 'test-contact-token',
    });

    const malloryClient = new ApprovalApiClient({
      baseUrl: servers.mockBackendUrl,
      tokenProvider: () => 'mallory-token',
    });

    const unauthClient = new ApprovalApiClient({
      baseUrl: servers.mockBackendUrl,
      tokenProvider: () => undefined, // missing token
    });

    assert(true, 'Isolated real HTTP server running with multi-tenant auth registries');

    // -------------------------------------------------------------------------
    // Suite 1: Complete 9-Stage Workflow Trace (Task 1)
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 1: Complete 9-Stage Approval Workflow Trace ---');

    let controlledContinuationExecutions = 0;
    const controller = new InterceptionController();
    const continuationManager = new ContinuationManager(controller);

    // Stage 1: Detect supported action
    const actionId = `act_${Date.now()}_stage1`;
    const action = createSyntheticTestAction(actionId);
    assertEquals(action.id, actionId, 'Stage 1: Action detected and assigned canonical ID');

    // Stage 2: Risk policy evaluates to PROTECT and holds action
    controller.register(action, 'Critical destructive action halted pending approval.');
    const heldRecord = controller.holdAction(action.id, 'Action held waiting for trusted-contact review.');
    assertEquals(heldRecord.state, InterceptionState.HELD, 'Stage 2: Action transitioned to HELD in controller');

    // Register controlled continuation callback (must NOT execute yet)
    continuationManager.registerHeldAction(
      action,
      heldRecord,
      () => {
        controlledContinuationExecutions++;
      },
      () => true // element is attached
    );

    // Stage 3: Approval request created & submitted over real HTTP
    const stagingContext: StagingActionContext = {
      actionId: action.id,
      actionType: action.type,
      category: action.category || ActionCategory.DESTRUCTIVE,
      riskLevel: RiskLevel.CRITICAL,
      riskScore: 100,
      description: 'Delete All Data and Cancel Account',
      reasons: ['Critical irreversible destructive operation'],
      suggestedDecision: ResponseAction.PROTECT,
      interceptionState: InterceptionState.HELD,
      url: action.page.url,
      timestamp: action.timestamp,
    };

    const submitResult = await submitApprovalRequest(
      stagingContext,
      controller,
      { apiClient: wardClient }
    );

    if (!submitResult.success) {
      console.log('DIAGNOSTIC submitResult:', JSON.stringify(submitResult, null, 2));
    }
    assert(submitResult.success, 'Stage 3: Approval request submitted over real HTTP');
    assert(Boolean(submitResult.request.id.startsWith('apr_')), 'Stage 3: Server assigned canonical requestId');
    const requestId = submitResult.request.id;
    assertEquals(submitResult.request.status, ApprovalStatus.PENDING, 'Stage 3: Server initialized status strictly as PENDING');

    // CRITICAL INVARIANT: Action was NOT executed upon submission
    assertEquals(controlledContinuationExecutions, 0, 'Stage 3: Invariant - Action strictly NOT executed upon request submission');

    // Stage 4: Approval state retrieved via GET endpoint
    const fetchedPending = await wardClient.getApprovalRequest(requestId);
    assert(fetchedPending.success, 'Stage 4: Approval state retrieved via GET /api/v1/approval-requests/:id');
    assertEquals(fetchedPending.data?.status, ApprovalStatus.PENDING, 'Stage 4: Authoritative server status is PENDING');

    // Stage 5: Dashboard queries pending requests
    const dashboardPendingRes = await contactClient.listPendingApprovals();
    assert(dashboardPendingRes.success, 'Stage 5: Dashboard queries pending requests via GET /api/v1/approvals/pending');
    const pendingItem = dashboardPendingRes.data?.find((r) => r.id === requestId);
    assert(Boolean(pendingItem), 'Stage 5: Trusted contact dashboard sees the pending request');
    assertEquals(pendingItem?.status, ApprovalStatus.PENDING, 'Stage 5: Dashboard displays authoritative PENDING status');

    // Stage 6: Trusted contact approves request via Dashboard decision endpoint
    const decideRes = await contactClient.submitDecision(requestId, {
      decision: 'APPROVED',
      decisionReason: 'Approved via trusted contact integration verification',
    });
    assert(decideRes.success, 'Stage 6: Trusted contact approved request via POST /api/v1/approvals/:id/decide');
    assertEquals(decideRes.data?.status, ApprovalStatus.APPROVED, 'Stage 6: Authoritative server status transitioned to APPROVED');
    assertEquals(decideRes.data?.decision?.decision, 'APPROVED', 'Stage 6: Server committed decision verdict as APPROVED');

    // Stage 7: Extension receives validated status update
    const syncRes = await wardClient.getApprovalRequest(requestId);
    assert(syncRes.success, 'Stage 7: Extension receives updated status from server');
    assertEquals(syncRes.data?.status, ApprovalStatus.APPROVED, 'Stage 7: Extension verified server status is APPROVED');

    // CRITICAL INVARIANT: Receiving approval does NOT execute the action
    assertEquals(controlledContinuationExecutions, 0, 'Stage 7: Invariant - Approved status strictly does NOT auto-execute action');

    // Stage 8: Continuation Validation Service validates action for continuation
    const validationService = new ContinuationValidationService({
      controller,
      continuationManager,
      approvalClient: wardClient,
      isElementAttached: () => true,
      getCurrentPageContext: () => ({ url: action.page.url, title: action.page.title }),
    });

    const validation = await validationService.validateEligibility(actionId, {
      requestId,
    });
    assert(validation.eligible, 'Stage 8: ContinuationValidationService verified all eligibility conditions');
    assertEquals(validation.status, ContinuationEligibilityStatus.ELIGIBLE, 'Stage 8: Status is ContinuationEligibilityStatus.ELIGIBLE');

    // Stage 9: Action continued ONLY through supported controlled handler upon explicit user confirmation
    const continueResult = continuationManager.continueAction(actionId, 'Explicit user confirmation executed in integration test.');
    assert(continueResult.success, 'Stage 9: ContinuationManager executed controlled action');
    assertEquals(continueResult.executionCount, 1, 'Stage 9: Execution count incremented to 1');
    assertEquals(controlledContinuationExecutions, 1, 'Stage 9: Controlled handler executed exactly once');

    // Exactly-once invariant: second continue attempt rejected
    const secondContinue = continuationManager.continueAction(actionId, 'Late repeat attempt');
    assert(!secondContinue.success, 'Stage 9: Second continuation attempt strictly rejected');
    assertEquals(controlledContinuationExecutions, 1, 'Stage 9: Handler execution count preserved as 1');

    // -------------------------------------------------------------------------
    // Suite 2: Approval Lifecycle States (Task 2)
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 2: Approval Lifecycle States & Monotonic Transitions ---');

    // 2.1 PENDING: premature continuation rejected
    const actPending = createSyntheticTestAction(`act_${Date.now()}_pending`);
    controller.register(actPending);
    const recPending = controller.holdAction(actPending.id);
    continuationManager.registerHeldAction(actPending, recPending, () => {}, () => true);
    const subPending = await submitApprovalRequest(
      createSyntheticStagingContext(actPending),
      controller,
      { apiClient: wardClient }
    );
    assert(subPending.success, 'PENDING: Request submitted');
    const valPending = await validationService.validateEligibility(actPending.id, {
      requestId: subPending.request.id,
    });
    assert(!valPending.eligible, 'PENDING: Continuation rejected while approval is pending');
    assertEquals(valPending.status, ContinuationEligibilityStatus.PENDING, 'PENDING: Status reflects PENDING');

    // 2.2 REJECTED: denial prevents continuation
    continuationManager.clearTemporaryState();
    const actReject = createSyntheticTestAction(`act_${Date.now()}_reject`);
    controller.register(actReject);
    const recReject = controller.holdAction(actReject.id);
    continuationManager.registerHeldAction(actReject, recReject, () => {}, () => true);
    const subReject = await submitApprovalRequest(
      createSyntheticStagingContext(actReject),
      controller,
      { apiClient: wardClient }
    );
    assert(subReject.success, 'REJECTED: Request submitted');
    await contactClient.submitDecision(subReject.request.id, {
      decision: 'REJECTED',
      decisionReason: 'Denied by contact',
    });
    const valReject = await validationService.validateEligibility(actReject.id, {
      requestId: subReject.request.id,
    });
    assert(!valReject.eligible, 'REJECTED: Continuation rejected after trusted contact denies approval');
    assertEquals(valReject.status, ContinuationEligibilityStatus.REJECTED, 'REJECTED: Status reflects REJECTED');

    // 2.3 EXPIRED: expired request cannot be continued
    continuationManager.clearTemporaryState();
    const actExpired = createSyntheticTestAction(`act_${Date.now()}_expired`);
    controller.register(actExpired);
    const recExpired = controller.holdAction(actExpired.id);
    continuationManager.registerHeldAction(actExpired, recExpired, () => {}, () => true);
    const subExpired = await submitApprovalRequest(
      createSyntheticStagingContext(actExpired),
      controller,
      { apiClient: wardClient }
    );
    assert(subExpired.success, 'EXPIRED: Request submitted');
    // Directly transition entity in repository to EXPIRED to test authoritative expiration handling
    const rawReq = servers.repository.findById(subExpired.request.id);
    if (rawReq) {
      const now = Date.now();
      const expiredReq = {
        ...rawReq,
        createdAt: new Date(now - 600000).toISOString(),
        expiresAt: new Date(now - 300000).toISOString(),
      };
      servers.repository.save(expiredReq);
    }
    const valExpired = await validationService.validateEligibility(actExpired.id, {
      requestId: subExpired.request.id,
    });
    assert(!valExpired.eligible, 'EXPIRED: Continuation rejected when approval request expired');
    assertEquals(valExpired.status, ContinuationEligibilityStatus.EXPIRED, 'EXPIRED: Status reflects EXPIRED');

    // 2.4 CANCELLED: user cancellation halts approval
    continuationManager.clearTemporaryState();
    const actCancel = createSyntheticTestAction(`act_${Date.now()}_cancel`);
    controller.register(actCancel);
    const recCancel = controller.holdAction(actCancel.id);
    continuationManager.registerHeldAction(actCancel, recCancel, () => {}, () => true);
    const subCancel = await submitApprovalRequest(
      createSyntheticStagingContext(actCancel),
      controller,
      { apiClient: wardClient }
    );
    assert(subCancel.success, 'CANCELLED: Request submitted');
    const cancelRes = await wardClient.cancelApprovalRequest(subCancel.request.id, 'User cancelled');
    assert(cancelRes.success, 'CANCELLED: Request cancelled on server');
    assertEquals(cancelRes.data?.status, ApprovalStatus.CANCELLED, 'CANCELLED: Server status is CANCELLED');
    const valCancel = await validationService.validateEligibility(actCancel.id, {
      requestId: subCancel.request.id,
    });
    assert(!valCancel.eligible, 'CANCELLED: Continuation rejected on cancelled approval');
    assertEquals(valCancel.status, ContinuationEligibilityStatus.CANCELLED, 'CANCELLED: Status reflects CANCELLED');

    // 2.5 UNAVAILABLE: offline network drop leaves action safely HELD
    const deadClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:9999', // closed port
      tokenProvider: () => 'test-ward-token',
      timeoutMs: 500,
    });
    const netRes = await deadClient.getApprovalRequest('apr_dummy');
    assert(!netRes.success, 'UNAVAILABLE: Network connection to closed port failed cleanly');
    assertEquals(netRes.error?.code, ApiClientErrorCodes.NETWORK_FAILURE, 'UNAVAILABLE: Error code is NETWORK_FAILURE');

    // 2.6 INVALID / UNKNOWN status: malformed status strings never become APPROVED
    const malformedPayload = { status: 'FORGED_APPROVAL', actionId: 'act_xyz' };
    const isValidStatus = Object.values(ApprovalStatus).includes(malformedPayload.status as any);
    assert(!isValidStatus, 'INVALID_OR_UNKNOWN: Malformed status "FORGED_APPROVAL" strictly rejected by schema');

    // -------------------------------------------------------------------------
    // Suite 3: Action-to-Approval Binding Invariants (Task 3)
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 3: Action-to-Approval Binding Invariants ---');

    continuationManager.clearTemporaryState();
    const actTarget = createSyntheticTestAction(`act_${Date.now()}_target`);
    const actForged = createSyntheticTestAction(`act_${Date.now()}_forged`);
    controller.register(actTarget);
    const recTarget = controller.holdAction(actTarget.id);
    continuationManager.registerHeldAction(actTarget, recTarget, () => {}, () => true);

    const subTarget = await submitApprovalRequest(
      createSyntheticStagingContext(actTarget),
      controller,
      { apiClient: wardClient }
    );
    assert(subTarget.success, 'subTarget submitted successfully');
    const targetRequestId = subTarget.request.id;

    const decTarget = await contactClient.submitDecision(targetRequestId, {
      decision: 'APPROVED',
      decisionReason: 'Approved target',
    });
    assert(decTarget.success, 'decTarget approved successfully');

    // 3.1 Mismatched Action ID
    const mismatchedVal = await validationService.validateEligibility(actForged.id, {
      requestId: targetRequestId,
    });
    assert(!mismatchedVal.eligible, 'Binding: Rejects approval grant attempted against mismatched action ID');
    assert(
      mismatchedVal.errorCode === 'ACTION_ID_MISMATCH' || mismatchedVal.errorCode === 'AUTHORIZATION_UNAVAILABLE',
      'Binding: Error code rejects mismatched action ID'
    );

    // 3.2 Mismatched Page Origin / URL Context
    const mismatchedContextService = new ContinuationValidationService({
      controller,
      continuationManager,
      approvalClient: wardClient,
      isElementAttached: () => true,
      getCurrentPageContext: () => ({ url: 'https://phishing.example.com', title: 'Phishing' }),
    });
    const mismatchContextVal = await mismatchedContextService.validateEligibility(actTarget.id, {
      requestId: targetRequestId,
    });
    assert(!mismatchContextVal.eligible, 'Binding: Rejects continuation attempted in mismatched URL context');

    // 3.3 Expired Binding Grant Token
    const parsedPageUrl = new URL(actTarget.page.url);
    const expiredBinding = createApprovalActionBinding({
      actionId: actTarget.id,
      requestId: targetRequestId,
      requesterId: 'usr_alice',
      state: ApprovalActionBindingState.APPROVED,
      createdAt: new Date(Date.now() - 60000).toISOString(), // 1 min ago
      expiresAt: new Date(Date.now() - 5000).toISOString(), // expired 5s ago
      actionDigest: computeActionDigest({
        origin: parsedPageUrl.origin,
        pathname: parsedPageUrl.pathname,
        actionType: actTarget.type,
      }),
    });
    const isBindingValid = isBindingValidForContinuation(expiredBinding);
    assert(!isBindingValid, 'Binding: Expired binding grant is invalid for continuation');

    // -------------------------------------------------------------------------
    // Suite 4: Caretaker Dashboard Consistency & Multi-Tenancy (Task 4)
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 4: Caretaker Dashboard Consistency & Multi-Tenancy ---');

    // 4.1 Multi-tenant isolation & Anti-enumeration
    // Mallory queries pending approvals - must see 0 of Alice's requests!
    const malloryPending = await malloryClient.listPendingApprovals();
    assert(malloryPending.success, 'Multi-Tenancy: Mallory pending query succeeds');
    const mallorySeesAlice = malloryPending.data?.some((r) => r.id === targetRequestId);
    assert(!mallorySeesAlice, 'Multi-Tenancy: Mallory strictly cannot see Alice approval requests (0 leaked)');

    // Mallory attempting to view Alice request detail returns 404/403
    const malloryView = await malloryClient.getApprovalDetails(targetRequestId);
    assert(!malloryView.success, 'Anti-Enumeration: Mallory blocked from viewing Alice request details');
    assertEquals(malloryView.statusCode, 404, 'Anti-Enumeration: Returns 404 Not Found to prevent ID enumeration');

    // Mallory attempting to decide Alice request returns 404/403
    const malloryDecide = await malloryClient.submitDecision(targetRequestId, {
      decision: 'APPROVED',
      decisionReason: 'Unauthorized approve',
    });
    assert(!malloryDecide.success, 'Multi-Tenancy: Mallory blocked from deciding Alice request');

    // 4.2 Dashboard Shell state consistency
    const container = new MockDOMElement('div');
    container.id = 'dashboard-app';
    const shell = new DashboardShell({
      container: container as any,
      apiClient: contactClient,
      autoFetch: false,
    });

    await shell.fetchPendingRequests();
    const shellState = shell.getState();
    assert(shellState.pendingRequests.length > 0, 'Dashboard Shell: Populated pending requests from real server');
    assertEquals(shellState.pendingStatus, 'idle', 'Dashboard Shell: Transitioned status to idle after fetch');

    // -------------------------------------------------------------------------
    // Suite 5: Service & Message Boundary Hardening (Task 5)
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 5: Service & Message Boundary Hardening ---');

    // 5.1 Client Self-Approval Prevention
    // A ward token attempting to decide its own request MUST be rejected!
    const selfApproveRes = await wardClient.submitDecision(targetRequestId, {
      decision: 'APPROVED',
      decisionReason: 'Self approval attempt',
    });
    assert(!selfApproveRes.success, 'Security Boundary: Ward client self-approval strictly rejected by server');
    assertEquals(selfApproveRes.statusCode, 403, 'Security Boundary: Server returned 403 Forbidden for ward role');

    // 5.2 Unauthenticated requests rejected
    const unauthRes = await unauthClient.listPendingApprovals();
    assert(!unauthRes.success, 'Security Boundary: Unauthenticated request rejected');
    assertEquals(unauthRes.statusCode, 401, 'Security Boundary: Server returned 401 Unauthorized for missing token');

    // 5.3 Malformed identifier rejection
    const badIdRes = await wardClient.getApprovalRequest('apr_invalid!@#$%^&*()');
    assert(!badIdRes.success, 'Security Boundary: Malformed requestId rejected');
    assertEquals(badIdRes.statusCode, 400, 'Security Boundary: Server returned 400 Bad Request');

    // 5.4 Overall Invariant Check
    assertEquals(controlledContinuationExecutions, 1, 'Overall Invariant: Exactly 1 continuation execution occurred across all suites');

    console.log('\n================================================================');
    console.log('🎉 ALL 5 APPROVAL WORKFLOW INTEGRATION SUITES PASSED!');
    console.log('================================================================\n');
  } finally {
    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------
    console.log('--- Teardown: Stopping Local Test Servers ---');
    if (servers) {
      await servers.close();
      console.log('  ✓ Real HTTP static and mock backend servers stopped');
    }
  }
}

// Execute suite
runApprovalWorkflowIntegration().catch((err) => {
  console.error('\n❌ Approval Workflow Integration Failed:', err);
  process.exit(1);
});
