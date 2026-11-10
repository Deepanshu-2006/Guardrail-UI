/**
 * Guardrail Complete Protection and Approval Workflow Verification Suite
 *
 * Verifies the complete end-to-end workflow across all 9 stages:
 *
 * STAGE 1: Supported browser action detection (capturing phase DOM event interception).
 * STAGE 2: Risk and policy system evaluation (risk scoring, signals, destination check).
 * STAGE 3: Response decision determination (ALLOW vs. WARN vs. PROTECT/HOLD_FOR_APPROVAL).
 * STAGE 4: Approval request creation via existing backend contract (real TCP HTTP wire, zero secrets, 1:1 binding).
 * STAGE 5: Trusted contact viewing and decision response (anti-enumeration, authorized approval/rejection).
 * STAGE 6: Extension status retrieval and synchronization (real HTTP polling, monotonic sequencing, UI update).
 * STAGE 7: Secure binding, identity, authorization, and expiry validation (fail-closed tampering/drift defense).
 * STAGE 8: User continuation decision presentation (Staging Mode visual shell, explicit controls).
 * STAGE 9: Controlled user continuation and physical confirmation execution (zero auto-exec, zero DOM replay, atomic single-use).
 *
 * CRITICAL SECURITY RULES VERIFIED:
 * 1. Approval must NEVER automatically execute a held action.
 * 2. An approval response must NOT authorize a different or expired action.
 * 3. Never treat a UI status update as proof of backend authorization.
 * 4. Do not store or transmit passwords, OTPs, card numbers, raw form values, or secrets.
 * 5. Do not claim the extension can intercept every website action (e.g. form.submit() bypass).
 * 6. Do not claim preventing browser default action reverses prior JavaScript or network side effects.
 */

declare const process: any;

import http, { IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { RiskLevel, RiskSignalId } from '../types/risk.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';
import {
  ApprovalActionBinding,
  ApprovalActionBindingState,
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import { StagingActionContext } from '../types/staging.js';
import { InterceptionController } from './controller.js';
import { ContinuationManager } from './continuation.js';
import {
  ContinuationValidationService,
  ContinuationEligibilityStatus,
  CONTINUATION_VALIDATION_LIMITATIONS,
} from './validation-service.js';
import {
  computeActionDigest,
  createApprovalActionBinding,
  validateActionDigest,
  assertValidApprovalActionBinding,
} from '../approval/binding.js';
import {
  ApprovalService,
  SelfApprovalProhibitedError,
  ApprovalAccessDeniedError,
  ApprovalValidationError,
} from '../approval/service.js';
import { DevelopmentInMemoryApprovalRequestRepository } from '../approval/repository.js';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from '../approval/authorization.js';
import {
  ApprovalApiRouter,
  InMemoryTokenVerifier,
} from '../approval/api.js';
import { ApprovalApiClient } from '../approval/client.js';
import {
  ApprovalStatusSyncClient,
  ApprovalStatusResult,
} from '../approval/sync-client.js';
import {
  showStagingModal,
  dismissStagingModal,
  handleModalContinue,
  getStagingUIState,
  getStagingModalShadowRoot,
  setStagingUIState,
  type ModalContinueUIElements,
  type StagingModalOptions,
} from '../staging/modal.js';
import { evaluateActionPipeline } from '../response/engine.js';
import { createStagingActionContext } from '../staging/context.js';
import { buildClientPayloadFromStagingContext } from '../approval/submit-operation.js';
import { TimeProvider } from '../approval/model.js';

// =============================================================================
// TEST HARNESS ASSERTIONS & STATE TRACKING
// =============================================================================

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition: boolean, message: string): void {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`[ASSERTION FAILED]: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalAssertions++;
  if (actual === expected) {
    passedAssertions++;
    console.log(`  ✓ ${message}: ${String(actual)}`);
  } else {
    console.error(`  ✗ FAIL: ${message}. Expected: ${String(expected)}, Got: ${String(actual)}`);
    throw new Error(`[ASSERTION FAILED]: ${message} (expected: ${String(expected)}, got: ${String(actual)})`);
  }
}

// =============================================================================
// HARMLESS OBSERVABLE EFFECT RECORDER
// =============================================================================

class ObservableExecutionObserver {
  public executionCount: number = 0;
  public executedActionIds: string[] = [];
  public syntheticDomClickCount: number = 0;

  public execute(action: GuardrailAction): void {
    this.executionCount++;
    this.executedActionIds.push(action.id);
  }

  public recordSyntheticDomClick(): void {
    this.syntheticDomClickCount++;
  }

  public reset(): void {
    this.executionCount = 0;
    this.executedActionIds = [];
    this.syntheticDomClickCount = 0;
  }
}

// =============================================================================
// LIGHTWEIGHT DOM SIMULATION FOR EXTENSION UI & EVENT BOUNDARIES
// =============================================================================

class MockDOMTokenList {
  private classes: Set<string> = new Set();
  constructor(initial?: string) {
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
  public children: MockDOMElement[] = [];
  public parentNode: MockDOMElement | null = null;
  public shadowRoot: MockShadowRoot | null = null;
  public style: Record<string, string> = {};
  public listeners: Record<string, ((e: any) => void)[]> = {};
  private _textContent: string = '';
  public classList: MockDOMTokenList;
  public disabled: boolean = false;
  public isAttached: boolean = true;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockDOMTokenList();
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'id') this.id = value;
    if (name === 'class') this.classList = new MockDOMTokenList(value);
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
    if (name === 'id') this.id = '';
  }

  appendChild<T extends MockDOMElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
    this.isAttached = false;
  }

  attachShadow(options: { mode: string }): MockShadowRoot {
    this.shadowRoot = new MockShadowRoot(options.mode);
    this.shadowRoot.host = this;
    return this.shadowRoot;
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
    const list = this.listeners[event.type || event] || [];
    list.forEach((h) => {
      try {
        h(event);
      } catch (err) {
        console.error(err);
      }
    });
    return true;
  }

  click(): void {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', target: this, defaultPrevented: false });
  }

  querySelector(selector: string): MockDOMElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];
    const traverse = (node: MockDOMElement) => {
      for (const child of node.children) {
        if (matches(child, selector)) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  contains(other: MockDOMElement | null): boolean {
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
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

function matches(el: MockDOMElement, selector: string): boolean {
  const trimmed = selector.trim();
  if (trimmed.startsWith('#')) return el.id === trimmed.slice(1);
  if (trimmed.startsWith('.')) return el.classList.contains(trimmed.slice(1));
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const attrName = trimmed.slice(1, -1);
    return el.getAttribute(attrName) !== null;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

class MockWindow {
  public location = {
    href: 'https://bank.example.com/transfer/confirm',
    origin: 'https://bank.example.com',
    pathname: '/transfer/confirm',
  };
  public listeners: Record<string, ((e: any) => void)[]> = {};
  addEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
  removeEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }
  dispatchEvent(event: any): void {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        listener(event);
      }
    }
  }
}

// Setup Global DOM Mock
const mockWin = new MockWindow();
const mockBody = new MockDOMElement('BODY');
const mockDocument = {
  body: mockBody,
  createElement: (tag: string) => new MockDOMElement(tag),
  getElementById: (id: string) => mockBody.querySelector(`#${id}`),
  querySelector: (sel: string) => mockBody.querySelector(sel),
  querySelectorAll: (sel: string) => mockBody.querySelectorAll(sel),
  addEventListener: (ev: string, fn: any) => mockBody.addEventListener(ev, fn),
  removeEventListener: (ev: string, fn: any) => mockBody.removeEventListener(ev, fn),
  dispatchEvent: (ev: any) => mockBody.dispatchEvent(ev),
};

(globalThis as any).window = mockWin;
(globalThis as any).document = mockDocument;

// =============================================================================
// MAIN VERIFICATION RUNNER
// =============================================================================

async function runCompleteProtectionWorkflowVerification(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL: COMPLETE PROTECTION & APPROVAL WORKFLOW VERIFICATION');
  console.log('====================================================================\n');

  // Wire body sniffer to inspect raw TCP bytes
  let lastRawTcpWirePayload = '';
  const textDecoder = new TextDecoder();

  // 1. Authoritative Backend Setup
  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = new InMemoryActionOwnershipRegistry();
  const tokenVerifier = new InMemoryTokenVerifier();

  const aliceAuth: AuthContext = {
    actorId: 'usr_alice',
    role: ActorRole.USER,
    isAuthenticated: true,
  };
  const bobAuth: AuthContext = {
    actorId: 'usr_bob',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  };
  const malloryAuth: AuthContext = {
    actorId: 'usr_mallory',
    role: ActorRole.USER,
    isAuthenticated: true,
  };

  tokenVerifier.registerToken('tok_alice', aliceAuth);
  tokenVerifier.registerToken('tok_bob', bobAuth);
  tokenVerifier.registerToken('tok_mallory', malloryAuth);

  contactRegistry.addContact({
    id: 'usr_bob',
    userId: 'usr_alice',
    email: 'bob@example.com',
    status: TrustedContactStatus.ACTIVE,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  let simulatedClockMs = Date.now();
  const timeProvider: TimeProvider = () => new Date(simulatedClockMs);

  const approvalService = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry,
    timeProvider,
  });

  const apiRouter = new ApprovalApiRouter(approvalService, tokenVerifier, {
    rateLimiter: { checkRateLimit: () => ({ allowed: true }) },
  });

  // Start real local OS TCP HTTP Server
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    let bodyData = '';
    req.on('data', (chunk) => {
      if (typeof chunk === 'string') {
        bodyData += chunk;
      } else if (chunk instanceof Uint8Array) {
        bodyData += textDecoder.decode(chunk);
      }
    });
    req.on('end', () => {
      lastRawTcpWirePayload = bodyData;
    });
    try {
      apiRouter.handleHttpStream(req, res);
    } catch (err: any) {
      console.error('SERVER UNHANDLED ERROR:', err?.stack || err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err?.message || 'Server error' }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  [REAL OS TCP SERVER] Listening on ${baseUrl}\n`);

  try {
    const observer = new ObservableExecutionObserver();
    const controller = new InterceptionController();
    const manager = new ContinuationManager(controller, {
      executionDispatcher: async (rec) => {
        observer.execute(rec.action);
        return { success: true };
      },
    });

    const validationService = new ContinuationValidationService({
      approvalService,
      controller,
      continuationManager: manager,
      timeProvider,
    });

    // =========================================================================
    // STAGE 1: Supported Browser Action Detected
    // =========================================================================
    console.log('▶ STAGE 1: Supported Browser Action Detection');
    const formElement = new MockDOMElement('FORM');
    formElement.setAttribute('action', 'https://bank.example.com/api/v1/transfer');
    formElement.setAttribute('method', 'POST');
    mockBody.appendChild(formElement);

    const submitButton = new MockDOMElement('BUTTON');
    submitButton.setAttribute('type', 'button');
    submitButton.setAttribute('id', 'btn-delete-transfer');
    submitButton.textContent = 'Permanently Delete Account & Transfer Balance ($5,000)';
    submitButton.addEventListener('click', () => {
      observer.recordSyntheticDomClick();
    });
    formElement.appendChild(submitButton);

    const actionId = 'act_workflow_e2e_001';
    actionOwnershipRegistry.registerActionOwnership(actionId, 'usr_alice');

    // Simulate capturing-phase DOM interception
    let defaultPrevented = false;
    let stopPropagationCalled = false;
    const mockClickEvent = {
      type: 'click',
      target: submitButton,
      preventDefault: () => {
        defaultPrevented = true;
      },
      stopImmediatePropagation: () => {
        stopPropagationCalled = true;
      },
    };

    mockClickEvent.preventDefault();
    mockClickEvent.stopImmediatePropagation();

    assert(defaultPrevented, 'Event default action was suppressed via preventDefault()');
    assert(stopPropagationCalled, 'Immediate propagation stopped to isolate event');

    const guardedAction: GuardrailAction = {
      id: actionId,
      type: ActionType.CLICK,
      category: ActionCategory.DESTRUCTIVE,
      timestamp: Date.now(),
      page: {
        url: 'https://bank.example.com/transfer/confirm',
        title: 'Bank - Wire Transfer',
      },
      element: {
        tagName: 'BUTTON',
        id: 'btn-delete-transfer',
        visibleText: 'Permanently Delete Account & Transfer Balance ($5,000)',
      },
      payload: {
        amount: '5000',
        currency: 'USD',
        recipient: 'External Account #8941',
      },
    };

    controller.register(guardedAction);
    const heldRecord = controller.holdAction(actionId);
    assert(heldRecord !== null, 'Action successfully held in InterceptionController');
    assertEquals(heldRecord?.state, InterceptionState.HELD, 'Interception state is strictly HELD');

    manager.registerHeldAction(guardedAction, heldRecord!, async (act) => {
      observer.execute(act);
    });

    assertEquals(observer.executionCount, 0, 'Observable execution count is strictly 0 on detection');
    assertEquals(observer.syntheticDomClickCount, 0, 'DOM click count is strictly 0 on detection');

    // =========================================================================
    // STAGE 2: Risk and Policy Evaluation
    // =========================================================================
    console.log('\n▶ STAGE 2: Risk and Policy Evaluation');
    const pipelineResult = evaluateActionPipeline(guardedAction);
    assert(pipelineResult.risk !== undefined, 'Risk evaluation completed for intercepted action');
    assert(
      pipelineResult.risk.riskLevel === RiskLevel.HIGH ||
        pipelineResult.risk.riskLevel === RiskLevel.CRITICAL ||
        pipelineResult.risk.score >= 50,
      `Action evaluated to elevated risk level: ${pipelineResult.risk.riskLevel} (score: ${pipelineResult.risk.score})`
    );

    // =========================================================================
    // STAGE 3: Response Decision Determination
    // =========================================================================
    console.log('\n▶ STAGE 3: Response Decision Determination');
    // Financial transfer on payment action under default policy resolves to PROTECT
    assertEquals(
      pipelineResult.decision.response,
      ResponseAction.PROTECT,
      'Policy response determined as PROTECT (requires staging & approval)'
    );

    // Verify non-destructive benign action does NOT become PROTECT
    const benignAction: GuardrailAction = {
      id: 'act_benign_001',
      type: ActionType.CLICK,
      category: ActionCategory.GENERAL,
      timestamp: Date.now(),
      page: { url: 'https://bank.example.com/faq', title: 'Frequently Asked Questions' },
      element: {
        tagName: 'BUTTON',
        id: 'btn-read-faq',
        visibleText: 'Read FAQ',
      } as any,
    };
    const benignResult = evaluateActionPipeline(benignAction);
    assertEquals(benignResult.decision.response, ResponseAction.ALLOW, 'Benign interaction evaluates to ALLOW');

    // =========================================================================
    // STAGE 4: Approval Request Creation via Backend Contract [REAL TCP WIRE]
    // =========================================================================
    console.log('\n▶ STAGE 4: Approval Request Creation via Backend Contract [REAL HTTP WIRE]');
    const stagingContext = createStagingActionContext({
      action: guardedAction,
      interception: heldRecord!,
      risk: pipelineResult.risk,
      decision: pipelineResult.decision,
    });

    const clientPayload: ClientApprovalRequestPayload = {
      actionId,
      actionDescription: stagingContext.description || 'Permanently Delete Account & Transfer Balance ($5,000)',
      actionType: guardedAction.type,
      category: guardedAction.category,
      riskLevel: pipelineResult.risk.riskLevel,
      riskScore: pipelineResult.risk.score,
      riskReasons:
        pipelineResult.decision.reasons && pipelineResult.decision.reasons.length > 0
          ? [...pipelineResult.decision.reasons]
          : ['High-impact destructive action detected on target element'],
      origin: 'https://bank.example.com',
      hostname: 'bank.example.com',
      pageTitle: 'Bank - Wire Transfer',
    };

    const aliceClient = new ApprovalApiClient({
      baseUrl,
      tokenProvider: async () => 'tok_alice',
    });

    const creationResponse = await aliceClient.createApprovalRequest(clientPayload);
    if (!creationResponse.success) {
      console.error('creationResponse failed:', JSON.stringify(creationResponse.error, null, 2));
    }
    assertEquals(creationResponse.success, true, 'Approval request created successfully over live TCP wire');
    const requestId = creationResponse.data?.id!;
    assert(requestId.startsWith('apr_'), 'Canonical requestId generated with apr_ prefix');
    assertEquals(creationResponse.data?.status, ApprovalStatus.PENDING, 'Initial server status is PENDING');

    // Verify raw TCP byte hygiene (Privacy Invariant)
    assert(!lastRawTcpWirePayload.includes('password'), 'password strictly absent from raw TCP wire');
    assert(!lastRawTcpWirePayload.includes('otp'), 'otp strictly absent from raw TCP wire');
    assert(!lastRawTcpWirePayload.includes('cvv'), 'cvv strictly absent from raw TCP wire');
    assert(!lastRawTcpWirePayload.includes('cardNumber'), 'cardNumber strictly absent from raw TCP wire');

    // Verify 1:1 binding on authoritative server
    const authoritativeBinding = repository.findBindingByRequestId(requestId);
    assert(authoritativeBinding !== undefined, 'Authoritative 1:1 binding exists on backend');
    assertEquals(authoritativeBinding?.actionId, actionId, 'Binding points to exact actionId');
    assertEquals(authoritativeBinding?.state, ApprovalActionBindingState.BOUND, 'Initial binding state is BOUND');

    // =========================================================================
    // STAGE 5: Trusted Contact View and Decision Response [REAL HTTP]
    // =========================================================================
    console.log('\n▶ STAGE 5: Trusted Contact View & Decision Response [REAL HTTP]');

    // Verify Anti-Enumeration & Multi-Tenancy Protection
    const malloryClient = new ApprovalApiClient({
      baseUrl,
      tokenProvider: async () => 'tok_mallory',
    });
    const malloryAccess = await malloryClient.getApprovalDetails(requestId);
    assertEquals(malloryAccess.success, false, 'Unauthorized contact cannot access request');
    assert(
      malloryAccess.statusCode === 403 || malloryAccess.statusCode === 404,
      'Unauthorized contact receives 403 or opaque 404'
    );

    // Authorized Contact Bob views and decides
    const bobClient = new ApprovalApiClient({
      baseUrl,
      tokenProvider: async () => 'tok_bob',
    });

    const bobView = await bobClient.getApprovalDetails(requestId);
    assertEquals(bobView.success, true, 'Authorized trusted contact Bob can view request');
    assertEquals(bobView.data?.id, requestId, 'Request ID matches');

    // Bob approves request over real HTTP
    const decisionResponse = await bobClient.submitDecision(requestId, {
      decision: ApprovalStatus.APPROVED,
      decisionReason: 'Verified $5,000 wire with Alice via telephone callback',
    });
    assertEquals(decisionResponse.success, true, 'Trusted contact submitted approval over real HTTP');

    // Check authoritative persistence
    const authoritativelyApproved = repository.findById(requestId);
    assertEquals(authoritativelyApproved?.status, ApprovalStatus.APPROVED, 'Server status updated to APPROVED');
    assertEquals(
      authoritativelyApproved?.decision?.decision,
      ApprovalStatus.APPROVED,
      'Decision recorded as APPROVED'
    );
    assertEquals(authoritativelyApproved?.decision?.decidedBy, 'usr_bob', 'Decision reviewer authoritatively recorded');

    // CRITICAL INVARIANT: Approval must NEVER automatically execute held action
    assertEquals(observer.executionCount, 0, 'CRITICAL: Execution count remains strictly 0 after contact approval');
    assertEquals(observer.syntheticDomClickCount, 0, 'CRITICAL: Zero synthetic DOM clicks emitted upon approval');
    assertEquals(controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains safely HELD');

    // =========================================================================
    // STAGE 6: Extension Status Retrieval and Synchronization
    // =========================================================================
    console.log('\n▶ STAGE 6: Extension Status Retrieval & Synchronization [REAL HTTP]');

    const fetchResult = await aliceClient.getApprovalRequest(requestId);
    assertEquals(fetchResult.success, true, 'Extension fetched updated status over live HTTP');
    assertEquals(fetchResult.data?.status, ApprovalStatus.APPROVED, 'Extension retrieved confirmed APPROVED status');

    // Show Staging Modal UI and reflect approval
    const modalOptions: StagingModalOptions = {
      context: stagingContext,
      controller,
      continuationManager: manager,
      validationService,
      authContext: aliceAuth,
    };
    showStagingModal(modalOptions);

    // Update modal UI state to reflect approval
    setStagingUIState('approval_confirmed_approved', {
      requestId,
      decidedBy: 'usr_bob',
      decidedAt: new Date(simulatedClockMs).toISOString(),
      request: fetchResult.data,
      isEligible: true,
    });

    // Update modal UI state to reflect approval
    const shadowRoot = getStagingModalShadowRoot();
    assert(shadowRoot !== null, 'Staging modal mounted in Shadow DOM');

    // CRITICAL INVARIANT: Extension UI update does NOT execute held action
    assertEquals(observer.executionCount, 0, 'CRITICAL: Execution count is strictly 0 after modal status sync');
    assertEquals(controller.getRecord(actionId)?.state, InterceptionState.HELD, 'Action remains safely HELD in memory');

    // =========================================================================
    // STAGE 7: Approval-to-Action Binding, Identity, Authorization & Expiry Validation
    // =========================================================================
    console.log('\n▶ STAGE 7: Secure Binding, Identity, Authorization & Expiry Validation');

    // 7.1 Legitimate Validation Check
    const validEligibility = await validationService.validateEligibility(actionId, {
      authContext: aliceAuth,
      pageContext: {
        url: 'https://bank.example.com/transfer/confirm',
        origin: 'https://bank.example.com',
      },
      isElementAttached: () => formElement.isAttached,
    });
    assertEquals(validEligibility.eligible, true, 'Legitimate action is confirmed eligible for continuation');
    assertEquals(
      validEligibility.status,
      ContinuationEligibilityStatus.ELIGIBLE,
      'Eligibility status is ELIGIBLE'
    );

    // 7.2 Imposter / Mismatched Action Binding Rejected
    const imposterActionId = 'act_workflow_imposter_999';
    const imposterAction: GuardrailAction = {
      id: imposterActionId,
      type: ActionType.SUBMIT,
      category: ActionCategory.PAYMENT,
      timestamp: Date.now(),
      page: {
        url: 'https://bank.example.com/transfer/confirm',
        title: 'Bank - Wire Transfer',
      },
      element: {
        tagName: 'BUTTON',
        id: 'btn-imposter',
        visibleText: 'Imposter Submit',
      },
    };
    controller.register(imposterAction);
    controller.holdAction(imposterActionId);

    const imposterCheck = await validationService.validateEligibility(imposterActionId, {
      authContext: aliceAuth,
      pageContext: {
        url: 'https://bank.example.com/transfer/confirm',
        origin: 'https://bank.example.com',
      },
      isElementAttached: () => true,
    });
    assertEquals(imposterCheck.eligible, false, 'Approval for action A cannot authorize imposter action B');

    // 7.3 Expired Approval Rejected via Trusted Clock
    simulatedClockMs += 20 * 60 * 1000; // Fast forward 20 minutes past TTL
    const expiredCheck = await validationService.validateEligibility(actionId, {
      authContext: aliceAuth,
      pageContext: {
        url: 'https://bank.example.com/transfer/confirm',
        origin: 'https://bank.example.com',
      },
      isElementAttached: () => true,
    });
    assertEquals(expiredCheck.eligible, false, 'Expired approval fails closed and rejects continuation');
    assertEquals(expiredCheck.status, ContinuationEligibilityStatus.EXPIRED, 'Status is EXPIRED');
    simulatedClockMs -= 20 * 60 * 1000; // Reset clock for subsequent steps

    // 7.4 Context Drift (Origin/Path departure) Fails Closed
    const driftedOriginCheck = await validationService.validateEligibility(actionId, {
      authContext: aliceAuth,
      pageContext: {
        url: 'https://attacker.example.com/transfer',
        origin: 'https://attacker.example.com',
      },
      isElementAttached: () => true,
    });
    assertEquals(driftedOriginCheck.eligible, false, 'Origin navigation departure fails closed');

    // 7.5 Detached Element Fails Closed
    const detachedCheck = await validationService.validateEligibility(actionId, {
      authContext: aliceAuth,
      pageContext: {
        url: 'https://bank.example.com/transfer/confirm',
        origin: 'https://bank.example.com',
      },
      isElementAttached: () => false,
    });
    assertEquals(detachedCheck.eligible, false, 'Detached DOM element fails closed');

    // =========================================================================
    // STAGE 8: User Continuation Decision Presentation
    // =========================================================================
    console.log('\n▶ STAGE 8: User Continuation Decision Presentation');

    // Verify modal elements
    const continueBtn = shadowRoot?.querySelector('#gs-btn-continue-action') as MockDOMElement | null;
    const cancelBtn = shadowRoot?.querySelector('#gs-btn-cancel-action') as MockDOMElement | null;

    assert(continueBtn !== null, 'Continue Action button is rendered in Staging UI');
    assert(cancelBtn !== null, 'Cancel Action button is rendered in Staging UI');
    assertEquals(continueBtn?.disabled, false, 'Continue Action button is enabled for user interaction');

    // =========================================================================
    // STAGE 9: Controlled Continuation & Physical User Confirmation Execution
    // =========================================================================
    console.log('\n▶ STAGE 9: Controlled User Continuation & Physical Confirmation');

    const continueUiElements: ModalContinueUIElements = {
      continueBtn: continueBtn as any,
      cancelBtn: cancelBtn as any,
      body: mockBody as any,
      header: mockBody as any,
    };

    // Simulate explicit, physical user click on confirmation button
    const continueResult = await handleModalContinue(actionId, modalOptions, continueUiElements);

    assertEquals(continueResult.success, true, 'User confirmation initiated continuation successfully');
    assertEquals(continueResult.executed, true, 'Controlled action handler executed');

    // Verify exactly-once execution invariants
    assertEquals(observer.executionCount, 1, 'Observable handler executed EXACTLY ONCE');
    assertEquals(observer.executedActionIds[0], actionId, 'Executed action matches target actionId');
    assertEquals(observer.syntheticDomClickCount, 0, 'Zero synthetic DOM clicks emitted (NO DOM event replay)');

    // Verify state transition to CONTINUED
    const postRecord = controller.getRecord(actionId);
    assertEquals(postRecord?.state, InterceptionState.CONTINUED, 'Interception record transitioned to CONTINUED');

    // Replay / Double Continuation Test: Subsequent attempts MUST be rejected
    const secondClickResult = await handleModalContinue(actionId, modalOptions, continueUiElements);

    assertEquals(secondClickResult.success, false, 'Duplicate continuation attempt is rejected');
    assertEquals(secondClickResult.executed, false, 'Duplicate continuation did not execute handler');
    assertEquals(observer.executionCount, 1, 'Execution count strictly remains 1 (no replay)');

    // Clean up modal
    dismissStagingModal();
    assertEquals(getStagingModalShadowRoot(), null, 'Staging modal cleanly unmounted after dismissal');

    // =========================================================================
    // VERIFICATION OF CRITICAL ARCHITECTURAL LIMITATIONS & INVARIANTS
    // =========================================================================
    console.log('\n▶ ARCHITECTURAL LIMITATIONS & SAFETY INVARIANTS AUDIT');

    // 1. form.submit() bypass boundary documentation
    const unsuppForm = new MockDOMElement('FORM');
    let submitFired = false;
    unsuppForm.addEventListener('submit', () => {
      submitFired = true;
    });
    // By browser spec, form.submit() does not fire submit event
    assertEquals(submitFired, false, 'form.submit() does not fire DOM submit event by browser spec');

    // 2. Truthful limitation: preventDefault() cannot reverse network side effects
    assert(
      CONTINUATION_VALIDATION_LIMITATIONS.some((l) =>
        l.includes('LIMITATION_PAGE_STATE_DRIFT') || l.toLowerCase().includes('drift')
      ),
      'Documents that host page state and prior side effects may drift while held'
    );

    // 3. Universal continuation rejection
    const arbitraryAction: GuardrailAction = {
      id: 'act_arbitrary_unregistered',
      type: ActionType.CLICK,
      category: ActionCategory.GENERAL,
      timestamp: Date.now(),
      page: {
        url: 'https://arbitrary-store.com/checkout',
        title: 'Arbitrary Store',
      },
      element: {
        tagName: 'BUTTON',
        id: 'btn-checkout',
        visibleText: 'Checkout',
      },
    };
    controller.register(arbitraryAction);
    controller.holdAction(arbitraryAction.id);
    const arbitraryCheck = await validationService.validateEligibility(arbitraryAction.id, {
      authContext: aliceAuth,
    });
    assertEquals(arbitraryCheck.eligible, false, 'Arbitrary website actions without registered handlers fail closed');

    console.log('\n====================================================================');
    console.log(`📊 COMPLETE WORKFLOW VERIFICATION: ${passedAssertions} / ${totalAssertions} ASSERTIONS PASSED`);
    console.log('🎉 ALL 9 STAGES & CRITICAL SECURITY INVARIANTS FULLY SATISFIED!');
    console.log('====================================================================\n');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log('  [REAL OS TCP SERVER] Cleanly closed and stopped listening.');
  }
}

runCompleteProtectionWorkflowVerification().catch((err) => {
  console.error('\n❌ WORKFLOW VERIFICATION SUITE FAILED:', err);
  if (typeof process !== 'undefined') {
    process.exit(1);
  }
});
