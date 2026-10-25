/**
 * Guardrail Protected-Action Continuation Authorization Validation Test Suite
 *
 * Verifies the authorization-validation boundary for protected-action continuation:
 * 1. Matching actions, valid active binding, confirmed approval -> Authorized.
 * 2. Mismatching action IDs across request, binding, and held action -> Rejected.
 * 3. Expired approval requests and bindings -> Rejected via trusted clock.
 * 4. Rejected approval requests and bindings -> Rejected.
 * 5. Cancelled approval requests and bindings -> Rejected.
 * 6. Invalidated approval bindings -> Rejected.
 * 7. Missing backend confirmation (pending, unauthenticated, offline) -> Fail closed.
 * 8. Changed page context (origin or path change) -> Rejected.
 * 9. Changed DOM element context (detached target element) -> Rejected.
 * 10. Duplicate continuation attempts & state transition bypass -> Rejected.
 * 11. Sensitive form values and credentials absent from comparison models.
 * 12. Inviolable non-execution guarantee across all rejected attempts.
 */

declare const process: any;

import { ActionType, GuardrailAction } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';

import { TimeProvider } from '../approval/model.js';
import { DevelopmentInMemoryApprovalRequestRepository } from '../approval/repository.js';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from '../approval/authorization.js';
import { ApprovalService } from '../approval/service.js';
import { ApprovalApiRouter, TokenVerifier } from '../approval/api.js';
import { InterceptionController } from './controller.js';
import {
  ContinuationAuthorizationBoundary,
  ContinuationManager,
  verifyContinuationAuthorization,
} from './continuation.js';

// =============================================================================
// Lightweight Test Runner
// =============================================================================

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (!condition) {
    throw new Error(`[ASSERTION FAILED]: ${message}`);
  }
  passedTests++;
  console.log(`  ✓ ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalTests++;
  if (actual !== expected) {
    throw new Error(`[ASSERTION FAILED]: ${message} (expected: ${String(expected)}, got: ${String(actual)})`);
  }
  passedTests++;
  console.log(`  ✓ ${message}`);
}

class MockTokenVerifier implements TokenVerifier {
  private readonly tokens = new Map<string, AuthContext>();

  public registerToken(token: string, context: AuthContext): void {
    this.tokens.set(token, context);
  }

  public async verifyToken(token: string): Promise<AuthContext> {
    const ctx = this.tokens.get(token);
    if (!ctx) {
      return { actorId: '', role: ActorRole.USER, isAuthenticated: false };
    }
    return ctx;
  }
}

interface TestHarness {
  service: ApprovalService;
  repository: DevelopmentInMemoryApprovalRequestRepository;
  contactRegistry: InMemoryTrustedContactRegistry;
  actionOwnershipRegistry: InMemoryActionOwnershipRegistry;
  router: ApprovalApiRouter;
  tokenVerifier: MockTokenVerifier;
  controller: InterceptionController;
  continuationManager: ContinuationManager;
  boundary: ContinuationAuthorizationBoundary;
  currentTime: string;
  advanceTimeByMs: (ms: number) => void;
}

function createTestHarness(initialTime: string = '2026-10-25T12:00:00.000Z'): TestHarness {
  let currentTime = initialTime;
  const timeProvider: TimeProvider = () => currentTime;

  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();

  const service = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    timeProvider,
  });

  const tokenVerifier = new MockTokenVerifier();
  tokenVerifier.registerToken('alice_tok', {
    actorId: 'usr_alice',
    role: ActorRole.USER,
    isAuthenticated: true,
  });
  tokenVerifier.registerToken('bob_tok', {
    actorId: 'tc_bob',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });

  const router = new ApprovalApiRouter(service, tokenVerifier);
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  const boundary = new ContinuationAuthorizationBoundary({
    continuationManager,
    controller,
    approvalService: service,
    timeProvider,
  });

  return {
    service,
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    router,
    tokenVerifier,
    controller,
    continuationManager,
    boundary,
    get currentTime() {
      return currentTime;
    },
    advanceTimeByMs(ms: number) {
      const parsed = new Date(currentTime).getTime();
      currentTime = new Date(parsed + ms).toISOString();
    },
  };
}

function createSampleAction(actionId: string, url: string = 'https://bank.example.com/transfer'): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-25T12:00:00.000Z',
    page: {
      url,
      title: 'Funds Transfer',
    },
    element: {
      tagName: 'BUTTON',
      id: 'btn-transfer',
      visibleText: 'Confirm Transfer ₹50,000',
    },
  };
}

// =============================================================================
// Test Suites
// =============================================================================

async function runContinuationAuthorizationTestSuite(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL: CONTINUATION AUTHORIZATION BOUNDARY TEST SUITE');
  console.log('====================================================================');

  const aliceAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
  const bobAuth: AuthContext = { actorId: 'tc_bob', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };

  // ---------------------------------------------------------------------------
  // 1. Matching Action & Valid Confirmed Approval -> Authorized (Req 1, 2, 3)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 1: Matching Action & Confirmed Approval Authorization');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_ok_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_ok_001');
    h.controller.register(action);
    const heldRecord = h.controller.holdAction('act_ok_001');

    let executed = false;
    h.continuationManager.registerHeldAction(action, heldRecord, () => {
      executed = true;
    });

    const req = h.service.createRequest(
      {
        actionId: 'act_ok_001',
        actionDescription: 'Transfer ₹50,000',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );

    // Trusted contact approves the request
    h.service.approveRequest(req.id, { decisionReason: 'Legitimate rent payment' }, bobAuth);

    // Validate authorization boundary
    const valResult = await h.boundary.validateContinuation('act_ok_001', {
      authContext: aliceAuth,
      expectedRequesterId: 'usr_alice',
      pageContext: { url: 'https://bank.example.com/transfer', origin: 'https://bank.example.com' },
    });

    assertEquals(valResult.authorized, true, 'Boundary authorizes matching approved action');
    assertEquals(executed, false, 'Action handler was NOT automatically executed during authorization validation');

    // Authorize and continue explicitly
    const contResult = await h.boundary.authorizeAndContinue('act_ok_001', 'Explicit user confirm', {
      authContext: aliceAuth,
    });
    assertEquals(contResult.success, true, 'authorizeAndContinue succeeded');
    assertEquals(contResult.executed, true, 'Handler executed upon explicit continuation');
    assertEquals(executed, true, 'Controlled handler executed exactly once');
    assertEquals(h.continuationManager.getExecutionCount('act_ok_001'), 1, 'Execution count is strictly 1');
  }

  // ---------------------------------------------------------------------------
  // 2. Mismatching Actions & Reassignment Detection (Req 2, 8)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 2: Mismatching Action Rejection');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_first_001', 'usr_alice');
    h.actionOwnershipRegistry.registerActionOwnership('act_second_002', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action1 = createSampleAction('act_first_001');
    const held1 = h.controller.holdAction(h.controller.register(action1).actionId);
    let exec1 = false;
    h.continuationManager.registerHeldAction(action1, held1, () => {
      exec1 = true;
    });

    const req1 = h.service.createRequest(
      {
        actionId: 'act_first_001',
        actionDescription: 'First action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
      },
      aliceAuth
    );
    h.service.approveRequest(req1.id, {}, bobAuth);

    // Attempt to validate a DIFFERENT action ID ('act_second_002') against req1
    const mismatchRes = await h.boundary.validateContinuation('act_second_002', {
      authContext: aliceAuth,
    });
    assertEquals(mismatchRes.authorized, false, 'Boundary rejects mismatched action ID');
    assertEquals(mismatchRes.errorCode, 'ACTION_ID_MISMATCH', 'Error code is ACTION_ID_MISMATCH');
    assertEquals(exec1, false, 'First action handler was NOT executed');

    // Attempt to validate via pure function verifyContinuationAuthorization with mismatched IDs
    const pureMismatch = verifyContinuationAuthorization({
      actionId: 'act_second_002',
      request: h.service.getRequest(req1.id, aliceAuth),
      binding: h.service.getBindingByRequestId(req1.id, aliceAuth),
    });
    assertEquals(pureMismatch.authorized, false, 'verifyContinuationAuthorization rejects mismatched request.actionId');
    assertEquals(pureMismatch.errorCode, 'ACTION_ID_MISMATCH', 'Pure error code is ACTION_ID_MISMATCH');
  }

  // ---------------------------------------------------------------------------
  // 3. Expired Approval Gating & Trusted Clock (Req 4)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Expired Approval Gating');
  {
    const h = createTestHarness('2026-10-25T12:00:00.000Z');
    h.actionOwnershipRegistry.registerActionOwnership('act_exp_001', 'usr_alice');

    const action = createSampleAction('act_exp_001');
    const held = h.controller.holdAction(h.controller.register(action).actionId);
    let execCount = 0;
    h.continuationManager.registerHeldAction(action, held, () => {
      execCount++;
    });

    h.service.createRequest(
      {
        actionId: 'act_exp_001',
        actionDescription: 'Expiring transfer',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth,
      { ttlMs: 15 * 60 * 1000 }
    );

    // Advance server clock past 15 min TTL
    h.advanceTimeByMs(16 * 60 * 1000);

    const expRes = await h.boundary.validateContinuation('act_exp_001', { authContext: aliceAuth });
    assertEquals(expRes.authorized, false, 'Boundary rejects expired request');
    assertEquals(expRes.errorCode, 'REQUEST_EXPIRED', 'Error code is REQUEST_EXPIRED');

    const contRes = await h.boundary.authorizeAndContinue('act_exp_001', 'Try continue expired', {
      authContext: aliceAuth,
    });
    assertEquals(contRes.success, false, 'Continuation of expired action fails');
    assertEquals(execCount, 0, 'Handler execution count remains 0 on expired action');
  }

  // ---------------------------------------------------------------------------
  // 4. Rejected Approval Gating (Req 3, 4)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Rejected Approval Gating');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_rej_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_rej_001');
    const held = h.controller.holdAction(h.controller.register(action).actionId);
    let execCount = 0;
    h.continuationManager.registerHeldAction(action, held, () => {
      execCount++;
    });

    const req = h.service.createRequest(
      {
        actionId: 'act_rej_001',
        actionDescription: 'Suspicious action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.CRITICAL,
      },
      aliceAuth
    );

    // Trusted contact rejects the request
    h.service.rejectRequest(req.id, { decisionReason: 'Phishing suspicion' }, bobAuth);

    const rejRes = await h.boundary.validateContinuation('act_rej_001', { authContext: aliceAuth });
    assertEquals(rejRes.authorized, false, 'Boundary rejects rejected request');
    assertEquals(rejRes.errorCode, 'REQUEST_REJECTED', 'Error code is REQUEST_REJECTED');

    const contRes = await h.boundary.authorizeAndContinue('act_rej_001', 'Try continue rejected', {
      authContext: aliceAuth,
    });
    assertEquals(contRes.success, false, 'Continuation fails for rejected action');
    assertEquals(execCount, 0, 'Handler execution count is strictly 0 on rejected action');
  }

  // ---------------------------------------------------------------------------
  // 5. Cancelled Approval & Binding Gating (Req 4, 5, 6)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Cancelled Approval & Binding Gating');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_cnc_001', 'usr_alice');

    const action = createSampleAction('act_cnc_001');
    const held = h.controller.holdAction(h.controller.register(action).actionId);
    let execCount = 0;
    h.continuationManager.registerHeldAction(action, held, () => {
      execCount++;
    });

    const req = h.service.createRequest(
      {
        actionId: 'act_cnc_001',
        actionDescription: 'Cancelled purchase',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
      },
      aliceAuth
    );

    // Requester cancels request
    h.service.cancelRequest(req.id, 'User cancelled from UI', aliceAuth);
    h.continuationManager.invalidateHeldAction('act_cnc_001', 'User dismissed');

    const cncRes = await h.boundary.validateContinuation('act_cnc_001', { authContext: aliceAuth });
    assertEquals(cncRes.authorized, false, 'Boundary rejects cancelled request and binding');
    assertEquals(cncRes.errorCode, 'REQUEST_CANCELLED', 'Error code is REQUEST_CANCELLED');

    const contRes = await h.boundary.authorizeAndContinue('act_cnc_001', 'Try continue cancelled', {
      authContext: aliceAuth,
    });
    assertEquals(contRes.success, false, 'Cannot continue cancelled action');
    assertEquals(execCount, 0, 'Execution count is 0');
  }

  // ---------------------------------------------------------------------------
  // 6. Invalidated Binding Gating (Req 5)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 6: Invalidated Binding Gating');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_inv_001', 'usr_alice');

    const action = createSampleAction('act_inv_001');
    const held = h.controller.holdAction(h.controller.register(action).actionId);
    let execCount = 0;
    h.continuationManager.registerHeldAction(action, held, () => {
      execCount++;
    });

    h.service.createRequest(
      {
        actionId: 'act_inv_001',
        actionDescription: 'Page changed',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
      },
      aliceAuth
    );

    // Invalidate binding via service
    h.service.invalidateBinding('act_inv_001', 'Page refreshed', aliceAuth);

    const invRes = await h.boundary.validateContinuation('act_inv_001', { authContext: aliceAuth });
    assertEquals(invRes.authorized, false, 'Boundary rejects invalidated binding');
    assertEquals(invRes.errorCode, 'BINDING_INVALIDATED', 'Error code is BINDING_INVALIDATED');
    assertEquals(execCount, 0, 'Execution count is 0');
  }

  // ---------------------------------------------------------------------------
  // 7. Missing Backend Confirmation / Unauthenticated / Offline (Req 3, 10)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 7: Missing Backend Confirmation & Fail-Closed');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_pend_001', 'usr_alice');

    const action = createSampleAction('act_pend_001');
    const held = h.controller.holdAction(h.controller.register(action).actionId);
    let execCount = 0;
    h.continuationManager.registerHeldAction(action, held, () => {
      execCount++;
    });

    h.service.createRequest(
      {
        actionId: 'act_pend_001',
        actionDescription: 'Pending request',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
      },
      aliceAuth
    );

    // Request is still PENDING (not approved)
    const pendRes = await h.boundary.validateContinuation('act_pend_001', { authContext: aliceAuth });
    assertEquals(pendRes.authorized, false, 'Pending request rejected for continuation');
    assertEquals(pendRes.errorCode, 'REQUEST_NOT_APPROVED', 'Error code is REQUEST_NOT_APPROVED');

    // Create boundary without backend service or client (simulating offline / unavailable)
    const offlineBoundary = new ContinuationAuthorizationBoundary({
      continuationManager: h.continuationManager,
      controller: h.controller,
    });
    const offlineRes = await offlineBoundary.validateContinuation('act_pend_001');
    assertEquals(offlineRes.authorized, false, 'Unavailable backend fails closed');
    assertEquals(offlineRes.errorCode, 'BACKEND_STATE_UNKNOWN', 'Error code is BACKEND_STATE_UNKNOWN');
    assertEquals(execCount, 0, 'Execution count is strictly 0');
  }

  // ---------------------------------------------------------------------------
  // 8. Changed Page Context Validation (Req 7)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 8: Changed Page Context Validation (Origin & Path Drift)');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_ctx_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_ctx_001', 'https://bank.example.com/transfer');
    const held = h.controller.holdAction(h.controller.register(action).actionId);
    let execCount = 0;
    h.continuationManager.registerHeldAction(action, held, () => {
      execCount++;
    });

    const req = h.service.createRequest(
      {
        actionId: 'act_ctx_001',
        actionDescription: 'Funds transfer',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );
    h.service.approveRequest(req.id, {}, bobAuth);

    // 8.1 Origin changed (e.g. navigation to attacker.com)
    const originMismatchRes = await h.boundary.validateContinuation('act_ctx_001', {
      authContext: aliceAuth,
      pageContext: {
        url: 'https://attacker.example.com/transfer',
        origin: 'https://attacker.example.com',
      },
    });
    assertEquals(originMismatchRes.authorized, false, 'Boundary rejects continuation when page origin changed');
    assertEquals(originMismatchRes.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code is PAGE_CONTEXT_MISMATCH');

    // 8.2 Path changed (e.g. client-side SPA navigation from /transfer to /profile)
    const pathMismatchRes = await h.boundary.validateContinuation('act_ctx_001', {
      authContext: aliceAuth,
      pageContext: {
        url: 'https://bank.example.com/profile',
        origin: 'https://bank.example.com',
      },
    });
    assertEquals(pathMismatchRes.authorized, false, 'Boundary rejects continuation when pathname changed');
    assertEquals(pathMismatchRes.errorCode, 'PAGE_CONTEXT_MISMATCH', 'Error code is PAGE_CONTEXT_MISMATCH');
    assertEquals(execCount, 0, 'Handler execution count is strictly 0');
  }

  // ---------------------------------------------------------------------------
  // 9. Changed DOM Element Context (Detached Element) (Req 7)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 9: Changed DOM Element Context (Element Detachment)');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_elm_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_elm_001');
    const held = h.controller.holdAction(h.controller.register(action).actionId);
    let execCount = 0;
    h.continuationManager.registerHeldAction(action, held, () => {
      execCount++;
    });

    const req = h.service.createRequest(
      {
        actionId: 'act_elm_001',
        actionDescription: 'Form submit',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
      },
      aliceAuth
    );
    h.service.approveRequest(req.id, {}, bobAuth);

    // Target element was removed / detached from DOM
    const detachedRes = await h.boundary.validateContinuation('act_elm_001', {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/transfer', origin: 'https://bank.example.com' },
      isElementAttached: () => false, // simulates element detached from document
    });
    assertEquals(detachedRes.authorized, false, 'Boundary rejects continuation when target element is detached');
    assertEquals(detachedRes.errorCode, 'ELEMENT_DETACHED', 'Error code is ELEMENT_DETACHED');
    assertEquals(execCount, 0, 'Handler execution count is 0');
  }

  // ---------------------------------------------------------------------------
  // 10. Duplicate Continuation Attempts & Exactly-Once Execution (Req 8)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 10: Duplicate Continuation Attempts & Exactly-Once Execution');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_dup_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const action = createSampleAction('act_dup_001');
    const held = h.controller.holdAction(h.controller.register(action).actionId);
    let execCount = 0;
    h.continuationManager.registerHeldAction(action, held, () => {
      execCount++;
    });

    const req = h.service.createRequest(
      {
        actionId: 'act_dup_001',
        actionDescription: 'One-time transfer',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.HIGH,
      },
      aliceAuth
    );
    h.service.approveRequest(req.id, {}, bobAuth);

    // First continuation succeeds
    const firstRes = await h.boundary.authorizeAndContinue('act_dup_001', 'First continue', {
      authContext: aliceAuth,
      pageContext: { url: 'https://bank.example.com/transfer', origin: 'https://bank.example.com' },
      isElementAttached: () => true,
    });
    assertEquals(firstRes.success, true, 'First continuation succeeded');
    assertEquals(firstRes.executed, true, 'Handler executed on first continuation');
    assertEquals(execCount, 1, 'Handler executed exactly 1 time');

    // Duplicate continuation attempt is strictly rejected
    const dupRes = await h.boundary.validateContinuation('act_dup_001', {
      authContext: aliceAuth,
    });
    assertEquals(dupRes.authorized, false, 'Duplicate continuation is rejected by boundary');
    assertEquals(dupRes.errorCode, 'ALREADY_CONTINUED', 'Error code is ALREADY_CONTINUED');

    const secondRes = await h.boundary.authorizeAndContinue('act_dup_001', 'Repeat continue', {
      authContext: aliceAuth,
    });
    assertEquals(secondRes.success, false, 'Repeated authorizeAndContinue fails');
    assertEquals(execCount, 1, 'Execution count remains strictly 1 (no duplicate replay)');
  }

  // ---------------------------------------------------------------------------
  // 11. Privacy Guarantee: Zero Sensitive Form Values in Comparison Models
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 11: Privacy Guarantee (Zero Sensitive Form Values)');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_priv_001', 'usr_alice');

    const action = createSampleAction('act_priv_001');
    const actionKeys = Object.keys(action);
    assert(!actionKeys.includes('password'), 'Action model does not have password field');
    assert(!actionKeys.includes('otp'), 'Action model does not have otp field');
    assert(!actionKeys.includes('cardNumber'), 'Action model does not have cardNumber field');

    const req = h.service.createRequest(
      {
        actionId: 'act_priv_001',
        actionDescription: 'Non-sensitive summary',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.LOW,
      },
      aliceAuth
    );

    const reqKeys = Object.keys(req);
    assert(!reqKeys.includes('password'), 'ApprovalRequest does not contain password');
    assert(!reqKeys.includes('otp'), 'ApprovalRequest does not contain otp');
    assert(!reqKeys.includes('formValues'), 'ApprovalRequest does not store raw form values');
  }

  // ---------------------------------------------------------------------------
  // 12. HTTP Route Validation: POST /api/v1/actions/:actionId/validate-continuation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Suite 12: HTTP API Route Validation for Continuation Authorization');
  {
    const h = createTestHarness();
    h.actionOwnershipRegistry.registerActionOwnership('act_api_001', 'usr_alice');
    h.contactRegistry.addContact({
      id: 'tc_bob',
      userId: 'usr_alice',
      status: TrustedContactStatus.ACTIVE,
      createdAt: '2026-10-25T10:00:00.000Z',
    });

    const req = h.service.createRequest(
      {
        actionId: 'act_api_001',
        actionDescription: 'API action',
        actionType: ActionType.CLICK,
        riskLevel: RiskLevel.MEDIUM,
      },
      aliceAuth
    );
    h.service.approveRequest(req.id, {}, bobAuth);

    // 12.1 Authorized caller gets 200 with authorized: true
    const okRes = await h.router.dispatch({
      method: 'POST',
      url: `/api/v1/actions/${encodeURIComponent('act_api_001')}/validate-continuation`,
      headers: { authorization: 'Bearer alice_tok' },
      body: { pageContext: { origin: 'https://bank.example.com' } },
    });
    assertEquals(okRes.statusCode, 200, 'HTTP endpoint returns 200 OK');
    assertEquals((okRes.body.data as any)?.authorized, true, 'HTTP endpoint confirms authorized: true');

    // 12.2 Unauthenticated caller receives 401
    const unauthRes = await h.router.dispatch({
      method: 'POST',
      url: `/api/v1/actions/${encodeURIComponent('act_api_001')}/validate-continuation`,
      headers: {},
    });
    assertEquals(unauthRes.statusCode, 401, 'Unauthenticated continuation validation returns 401');

    // 12.3 Unauthorized caller receives 404 (anti-enumeration)
    const strangerRes = await h.router.dispatch({
      method: 'POST',
      url: `/api/v1/actions/${encodeURIComponent('act_api_001')}/validate-continuation`,
      headers: { authorization: 'Bearer bob_tok' },
    });
    assertEquals(strangerRes.statusCode, 404, 'Non-owner caller receives opaque 404');
  }

  console.log('\n====================================================================');
  console.log(`📊 VERIFICATION SUMMARY: ${passedTests} / ${totalTests} PASSED`);
  console.log('🎉 ALL 12 SUITES & CONTINUATION BOUNDARY INVARIANTS SATISFIED!');
  console.log('====================================================================\n');
}

runContinuationAuthorizationTestSuite().catch((err) => {
  console.error('\n❌ FATAL TEST FAILURE:', err);
  process.exit(1);
});
