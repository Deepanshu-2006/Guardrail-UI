/**
 * Guardrail Approval Status Display & Verification Test Suite
 *
 * Comprehensive tests for backend-confirmed approval statuses, local UI states,
 * response schema validation, stale response handling, unmounting protection,
 * and error sanitization:
 *
 * 1. SUPPORTED STATUSES & LIFECYCLE REPRESENTATION:
 *    - Distinguishes NOT_SUBMITTED, SUBMISSION_IN_PROGRESS, REQUEST_CREATION_CONFIRMED (PENDING),
 *      STATUS_CONFIRMED_APPROVED, STATUS_CONFIRMED_REJECTED, STATUS_CONFIRMED_EXPIRED,
 *      STATUS_CONFIRMED_CANCELLED, SUBMISSION_REJECTED, and SUBMISSION_OUTCOME_UNKNOWN.
 *    - Verifies accurate UI badges, headlines, descriptions, button labels, and screen reader announcements.
 *
 * 2. BACKEND RESPONSE SCHEMA VALIDATION:
 *    - Validates schema structure, canonical ID prefixes ('apr_' / 'appr_'), timestamps, and actionId matching.
 *    - Strictly validates decision blocks on APPROVED and REJECTED responses.
 *    - Strictly rejects spoofed decision blocks on PENDING responses.
 *    - Malformed responses transition UI to 'malformed_response' without exposing internal errors.
 *
 * 3. NO FALSE APPROVAL DECISION INVARIANT:
 *    - Verifies that successful request creation (201 Created) confirms PENDING status ONLY.
 *    - NEVER displays APPROVED merely because an approval request was created.
 *
 * 4. TRUTHFUL CARETAKER MESSAGING:
 *    - Verifies the UI never claims a caretaker has been notified, messaged, or emailed,
 *      as notification delivery is not connected in this milestone.
 *
 * 5. STALE RESPONSE & UNMOUNTING PROTECTION:
 *    - Dismissing modal during in-flight submission prevents DOM mutations on unmounted components.
 *    - Switching or updating modal for a different action prevents cross-action UI pollution.
 *    - Monotonic modal session tracking protects against out-of-order async resolutions.
 *
 * 6. PRIVACY & ERROR SANITIZATION:
 *    - Strips stack traces, database queries, file paths, and bearer/auth tokens from error messages.
 *    - Maps HTTP status codes to clear, non-technical plain English explanations.
 *
 * 7. ACTION HELD INVARIANT:
 *    - Verifies that the protected action remains strictly HELD across all lifecycle states.
 *    - Continuation handler is NEVER executed automatically.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { RiskLevel } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { StagingActionContext } from '../types/staging.js';
import { ApprovalStatus } from '../types/approval.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import { ApprovalApiClient } from '../approval/client.js';
import {
  determineApprovalState,
  sanitizeApprovalErrorMessage,
  UIApprovalStatus,
  validateBackendApprovalResponse,
} from './status.js';
import {
  dismissStagingModal,
  getCurrentModalSessionId,
  getCurrentMountedActionId,
  getStagingModalShadowRoot,
  getStagingUIState,
  isStagingModalActive,
  setStagingUIState,
  showStagingModal,
  STAGING_HOST_ELEMENT_ID,
} from './modal.js';

// =============================================================================
// DOM Simulation for Node Environment
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
  public disabled: boolean = false;
  public type: string = '';

  get firstChild(): MockDOMElement | null {
    return this.children[0] || null;
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
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'id') this.id = value;
    if (name === 'class') this.className = value;
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

  removeChild<T extends MockDOMElement>(child: T): T {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  click(): void {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', target: this });
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  attachShadow(init: { mode: 'open' | 'closed' }): MockShadowRoot {
    const shadow = new MockShadowRoot(init.mode);
    this.shadowRoot = shadow;
    shadow.host = this;
    return shadow;
  }

  addEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }

  dispatchEvent(event: any): boolean {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        listener(event);
      }
    }
    return true;
  }

  querySelector(selector: string): MockDOMElement | null {
    return querySelectorInternal(this, selector);
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];
    querySelectorAllInternal(this, selector, results);
    return results;
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

function querySelectorInternal(root: MockDOMElement, selector: string): MockDOMElement | null {
  for (const child of root.children) {
    if (matchesSelector(child, selector)) return child;
    const found = querySelectorInternal(child, selector);
    if (found) return found;
  }
  return null;
}

function querySelectorAllInternal(
  root: MockDOMElement,
  selector: string,
  results: MockDOMElement[]
): void {
  for (const child of root.children) {
    if (matchesSelector(child, selector)) results.push(child);
    querySelectorAllInternal(child, selector, results);
  }
}

function matchesSelector(el: MockDOMElement, selector: string): boolean {
  if (selector.startsWith('#')) return el.id === selector.slice(1);
  if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

function setupMockDOM(): () => void {
  const originalDocument = (globalThis as any).document;
  const originalWindow = (globalThis as any).window;

  const mockBody = new MockDOMElement('BODY');
  const mockDoc: any = {
    body: mockBody,
    createElement: (tag: string) => new MockDOMElement(tag),
    getElementById: (id: string) => {
      if (id === STAGING_HOST_ELEMENT_ID) {
        return mockBody.children.find((c) => c.id === STAGING_HOST_ELEMENT_ID) || null;
      }
      return null;
    },
    activeElement: null,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const mockWin: any = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  (globalThis as any).document = mockDoc;
  (globalThis as any).window = mockWin;

  return () => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  };
}

function createMockResponse(data: unknown, options: { status?: number } = {}): Response {
  const status = options.status ?? 200;
  const text = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : 'Error',
    headers: {
      get: (header: string) => {
        if (header.toLowerCase() === 'content-type') return 'application/json';
        return null;
      },
    } as any,
    json: async () => data,
    text: async () => text,
  } as unknown as Response;
}

// =============================================================================
// Assertions
// =============================================================================

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition: boolean, message: string): void {
  totalAssertions++;
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedAssertions++;
  console.log(`  ✓ ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalAssertions++;
  if (actual !== expected) {
    console.error(`  ✗ FAIL: ${message}`);
    console.error(`    Expected: ${JSON.stringify(expected)}`);
    console.error(`    Actual:   ${JSON.stringify(actual)}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedAssertions++;
  console.log(`  ✓ ${message}: ${actual}`);
}

// =============================================================================
// Helper Factories
// =============================================================================

function createTestInterception(actionId: string, description: string = 'Transfer $500.00') {
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  let handlerExecuted = false;
  const action: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-19T03:00:00.000Z',
    page: { url: 'https://bank.example.com/transfer', title: 'Bank Transfer' },
  };

  controller.register(action, 'Test action registered');
  controller.holdAction(actionId, 'Test action held for review');

  continuationManager.registerHeldAction(
    action,
    controller.getRecord(actionId) as InterceptionRecord,
    () => {
      handlerExecuted = true;
    }
  );

  const context: StagingActionContext = {
    actionId,
    description,
    actionType: ActionType.CLICK,
    category: ActionCategory.PAYMENT,
    riskLevel: RiskLevel.HIGH,
    riskScore: 78,
    riskReasons: ['Payment or Billing Activity'],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    origin: 'https://bank.example.com',
    hostname: 'bank.example.com',
    timestamp: '2026-10-19T03:00:00.000Z',
    stagedAt: '2026-10-19T03:00:00.000Z',
  };

  return {
    controller,
    continuationManager,
    context,
    isHandlerExecuted: () => handlerExecuted,
  };
}

// =============================================================================
// Test Suites
// =============================================================================

async function runApprovalStatusTests(): Promise<void> {
  const teardownDOM = setupMockDOM();

  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL STAGING APPROVAL STATUS & BACKEND VALIDATION TEST SUITE');
  console.log('====================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // Test Suite 1: Pure Status Determination & Decoupled State Calculation
    // -------------------------------------------------------------------------
    console.log('▶ Test Suite 1: Pure Status Determination & Architecture Separation');
    {
      // 1A: Not Submitted (Local UI State)
      const notSubmitted = determineApprovalState({ state: 'not_submitted' });
      assertEquals(notSubmitted.uiStatus, UIApprovalStatus.NOT_SUBMITTED, 'Not submitted UI status enum');
      assertEquals(notSubmitted.isBackendConfirmed, false, 'Not submitted is local UI state only');
      assertEquals(notSubmitted.isActionHeld, true, 'Action remains HELD invariant');
      assertEquals(notSubmitted.isRequestButtonDisabled, false, 'Request button enabled in review mode');
      assertEquals(notSubmitted.requestButtonText, 'Request Approval', 'Request button label');

      // 1B: Submitting in Progress (Local UI State)
      const submitting = determineApprovalState({ state: 'submitting' });
      assertEquals(submitting.uiStatus, UIApprovalStatus.SUBMISSION_IN_PROGRESS, 'Submitting UI status enum');
      assertEquals(submitting.isBackendConfirmed, false, 'Submitting is local UI state only');
      assertEquals(submitting.isBusy, true, 'aria-busy is true during submission');
      assertEquals(submitting.isRequestButtonDisabled, true, 'Request button locked during submission');
      assertEquals(submitting.isActionHeld, true, 'Action remains HELD invariant');

      // 1C: Request Creation Confirmed (Backend-Confirmed: PENDING)
      const creationConfirmed = determineApprovalState({
        state: 'creation_confirmed',
        request: {
          id: 'apr_001',
          actionId: 'act_001',
          requesterId: 'usr_alice',
          status: ApprovalStatus.PENDING,
          actionDescription: 'Send Money',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          riskReasons: ['High risk payment'],
          createdAt: '2026-10-19T03:00:00.000Z',
          expiresAt: '2026-10-19T03:30:00.000Z',
        },
      });
      assertEquals(creationConfirmed.uiStatus, UIApprovalStatus.REQUEST_CREATION_CONFIRMED, 'Creation confirmed UI status');
      assertEquals(creationConfirmed.isBackendConfirmed, true, 'Creation confirmed is confirmed by backend');
      assertEquals(creationConfirmed.backendStatus, ApprovalStatus.PENDING, 'Backend status is authoritative PENDING');
      assertEquals(creationConfirmed.badgeLabel, 'Approval Pending', 'Badge indicates Approval Pending');
      assert(!creationConfirmed.headline.includes('Approved'), 'Creation confirmed NEVER displays Approved');
      assert(!creationConfirmed.detail.includes('notified'), 'Truthful messaging: never claims caretaker was notified');
      assert(!creationConfirmed.detail.includes('sent an SMS'), 'Truthful messaging: never claims SMS sent');
      assertEquals(creationConfirmed.isActionHeld, true, 'Action remains strictly HELD');

      // 1D: Existing Status Confirmed - APPROVED (Backend-Confirmed)
      const approvedConfirmed = determineApprovalState({
        state: 'status_confirmed',
        request: {
          id: 'apr_002',
          actionId: 'act_002',
          requesterId: 'usr_alice',
          status: ApprovalStatus.APPROVED,
          actionDescription: 'Send Money',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          riskReasons: ['High risk payment'],
          createdAt: '2026-10-19T03:00:00.000Z',
          expiresAt: '2026-10-19T03:30:00.000Z',
          decision: {
            decision: 'APPROVED',
            decidedBy: 'tc_carol',
            decidedAt: '2026-10-19T03:05:00.000Z',
            decisionReason: 'Verified details with user over phone',
          },
        },
      });
      assertEquals(approvedConfirmed.uiStatus, UIApprovalStatus.STATUS_CONFIRMED_APPROVED, 'Status confirmed APPROVED');
      assertEquals(approvedConfirmed.isBackendConfirmed, true, 'APPROVED is backend confirmed');
      assertEquals(approvedConfirmed.backendStatus, ApprovalStatus.APPROVED, 'Authoritative status is APPROVED');
      assertEquals(approvedConfirmed.badgeLabel, 'Approval Confirmed', 'Badge label is Approval Confirmed');
      assertEquals(approvedConfirmed.isActionHeld, true, 'CRITICAL: Action remains HELD even after backend approval');

      // 1E: Existing Status Confirmed - REJECTED (Backend-Confirmed)
      const rejectedConfirmed = determineApprovalState({
        state: 'status_confirmed',
        request: {
          id: 'apr_003',
          actionId: 'act_003',
          requesterId: 'usr_alice',
          status: ApprovalStatus.REJECTED,
          actionDescription: 'Send Money',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          riskReasons: ['High risk payment'],
          createdAt: '2026-10-19T03:00:00.000Z',
          expiresAt: '2026-10-19T03:30:00.000Z',
          decision: {
            decision: 'REJECTED',
            decidedBy: 'tc_carol',
            decidedAt: '2026-10-19T03:05:00.000Z',
            decisionReason: 'Potential scam warning',
          },
        },
      });
      assertEquals(rejectedConfirmed.uiStatus, UIApprovalStatus.STATUS_CONFIRMED_REJECTED, 'Status confirmed REJECTED');
      assertEquals(rejectedConfirmed.backendStatus, ApprovalStatus.REJECTED, 'Authoritative status is REJECTED');
      assertEquals(rejectedConfirmed.isActionHeld, true, 'Action remains HELD on rejection');

      // 1F: Existing Status Confirmed - EXPIRED (Backend-Confirmed)
      const expiredConfirmed = determineApprovalState({
        state: 'status_confirmed',
        request: {
          id: 'apr_004',
          actionId: 'act_004',
          requesterId: 'usr_alice',
          status: ApprovalStatus.EXPIRED,
          actionDescription: 'Send Money',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          riskReasons: ['High risk payment'],
          createdAt: '2026-10-19T03:00:00.000Z',
          expiresAt: '2026-10-19T03:01:00.000Z',
        },
      });
      assertEquals(expiredConfirmed.uiStatus, UIApprovalStatus.STATUS_CONFIRMED_EXPIRED, 'Status confirmed EXPIRED');
      assertEquals(expiredConfirmed.isBackendConfirmed, true, 'EXPIRED is backend confirmed');
      assertEquals(expiredConfirmed.backendStatus, ApprovalStatus.EXPIRED, 'Authoritative status is EXPIRED');
      assertEquals(expiredConfirmed.isActionHeld, true, 'Action remains HELD on expired');

      // 1G: Existing Status Confirmed - CANCELLED (Backend-Confirmed)
      const cancelledConfirmed = determineApprovalState({
        state: 'status_confirmed',
        request: {
          id: 'apr_005',
          actionId: 'act_005',
          requesterId: 'usr_alice',
          status: ApprovalStatus.CANCELLED,
          actionDescription: 'Send Money',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          riskReasons: ['High risk payment'],
          createdAt: '2026-10-19T03:00:00.000Z',
          expiresAt: '2026-10-19T03:30:00.000Z',
          cancellationReason: 'Requester navigated away',
        },
      });
      assertEquals(cancelledConfirmed.uiStatus, UIApprovalStatus.STATUS_CONFIRMED_CANCELLED, 'Status confirmed CANCELLED');
      assertEquals(cancelledConfirmed.isBackendConfirmed, true, 'CANCELLED is backend confirmed');
      assertEquals(cancelledConfirmed.backendStatus, ApprovalStatus.CANCELLED, 'Authoritative status is CANCELLED');

      // 1H: Submission Rejected by Server (Authoritative Failure)
      const submissionRejected = determineApprovalState({
        state: 'rejected',
        statusCode: 403,
        errorCode: 'UNAUTHORIZED_ACTION_REQUESTER',
        rawError: 'User is not permitted to request approval for this action',
      });
      assertEquals(submissionRejected.uiStatus, UIApprovalStatus.SUBMISSION_REJECTED, 'Submission rejected UI status');
      assertEquals(submissionRejected.isBackendConfirmed, true, 'Server rejection is authoritative');
      assertEquals(submissionRejected.badgeLabel, 'Request Rejected', 'Badge indicates Request Rejected');
      assertEquals(submissionRejected.isActionHeld, true, 'Action remains HELD on server rejection');

      // 1I: Submission Outcome Unknown (Local Uncertainty State)
      const unknownOutcome = determineApprovalState({
        state: 'unknown',
        rawError: 'Network request timed out after 5000ms',
      });
      assertEquals(unknownOutcome.uiStatus, UIApprovalStatus.SUBMISSION_OUTCOME_UNKNOWN, 'Outcome unknown UI status');
      assertEquals(unknownOutcome.isBackendConfirmed, false, 'Outcome unknown is local uncertainty state');
      assertEquals(unknownOutcome.badgeLabel, 'Outcome Uncertain', 'Badge indicates Outcome Uncertain');
      assertEquals(unknownOutcome.isActionHeld, true, 'Action remains HELD on unknown outcome');
    }

    // -------------------------------------------------------------------------
    // Test Suite 2: Strict Response Schema Validation
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 2: Strict Response Schema Validation');
    {
      const validPending = {
        id: 'apr_valid_123',
        actionId: 'act_target_456',
        requesterId: 'usr_alice',
        status: ApprovalStatus.PENDING,
        createdAt: '2026-10-19T03:00:00.000Z',
        expiresAt: '2026-10-19T03:30:00.000Z',
      };

      // Valid response
      const res1 = validateBackendApprovalResponse(validPending, 'act_target_456');
      assertEquals(res1.valid, true, 'Valid PENDING response passes validation');

      // Non-object response
      const res2 = validateBackendApprovalResponse('<html>Server Error</html>');
      assertEquals(res2.valid, false, 'Non-object HTML response is rejected');

      // Null response
      const res3 = validateBackendApprovalResponse(null);
      assertEquals(res3.valid, false, 'Null response is rejected');

      // Missing ID
      const res4 = validateBackendApprovalResponse({ ...validPending, id: '' });
      assertEquals(res4.valid, false, 'Empty ID is rejected');

      // Invalid ID prefix (must be apr_ or appr_)
      const res5 = validateBackendApprovalResponse({ ...validPending, id: 'req_unprefixed_999' });
      assertEquals(res5.valid, false, 'ID without apr_ prefix is rejected');

      // actionId mismatch
      const res6 = validateBackendApprovalResponse(validPending, 'act_different_999');
      assertEquals(res6.valid, false, 'actionId mismatch is rejected');

      // Invalid status value
      const res7 = validateBackendApprovalResponse({ ...validPending, status: 'INVALID_STATUS' });
      assertEquals(res7.valid, false, 'Invalid status string is rejected');

      // Invalid ISO timestamp
      const res8 = validateBackendApprovalResponse({ ...validPending, createdAt: 'not-a-date' });
      assertEquals(res8.valid, false, 'Invalid createdAt timestamp is rejected');

      // APPROVED status without decision metadata (CRITICAL SECURITY CHECK)
      const res9 = validateBackendApprovalResponse({
        ...validPending,
        status: ApprovalStatus.APPROVED,
      });
      assertEquals(res9.valid, false, 'APPROVED status without decision metadata is rejected');

      // REJECTED status without decision metadata
      const res10 = validateBackendApprovalResponse({
        ...validPending,
        status: ApprovalStatus.REJECTED,
      });
      assertEquals(res10.valid, false, 'REJECTED status without decision metadata is rejected');

      // PENDING status with forged decision metadata (CRITICAL SECURITY CHECK)
      const res11 = validateBackendApprovalResponse({
        ...validPending,
        status: ApprovalStatus.PENDING,
        decision: {
          decision: 'APPROVED',
          decidedBy: 'mallory',
          decidedAt: '2026-10-19T03:00:00.000Z',
        },
      });
      assertEquals(res11.valid, false, 'PENDING status containing forged decision block is rejected');

      // Valid APPROVED status with matching decision metadata
      const validApproved = {
        id: 'apr_valid_approved_789',
        actionId: 'act_target_456',
        requesterId: 'usr_alice',
        status: ApprovalStatus.APPROVED,
        createdAt: '2026-10-19T03:00:00.000Z',
        expiresAt: '2026-10-19T03:30:00.000Z',
        decision: {
          decision: 'APPROVED',
          decidedBy: 'tc_bob',
          decidedAt: '2026-10-19T03:05:00.000Z',
        },
      };
      const res12 = validateBackendApprovalResponse(validApproved, 'act_target_456');
      assertEquals(res12.valid, true, 'Valid APPROVED status with complete decision metadata passes');

      // Decision mismatch: status is APPROVED but decision.decision is REJECTED
      const res13 = validateBackendApprovalResponse({
        ...validApproved,
        decision: {
          ...validApproved.decision,
          decision: 'REJECTED',
        },
      });
      assertEquals(res13.valid, false, 'Decision verdict mismatch against status is rejected');
    }

    // -------------------------------------------------------------------------
    // Test Suite 3: Staging Mode UI Rendering of Confirmed & Local Statuses
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 3: Staging Mode UI Status Rendering & Invariants');
    {
      const { controller, continuationManager, context, isHandlerExecuted } =
        createTestInterception('act_render_test_1');

      // Mount modal
      showStagingModal({
        context,
        controller,
        continuationManager,
      });

      const shadow = getStagingModalShadowRoot();
      assert(shadow !== null, 'Modal mounted');

      // State 1: held / not submitted
      assertEquals(getStagingUIState(), 'held', 'Initial UI state is held');
      const pill = shadow!.querySelector('.gs-mode-pill');
      assertEquals(pill?.textContent, 'Review Mode', 'Mode pill is Review Mode');
      assert(pill!.classList.contains('gs-badge-held'), 'Pill has gs-badge-held');

      // State 2: submitting_approval
      setStagingUIState('submitting_approval');
      assertEquals(getStagingUIState(), 'submitting_approval', 'UI state is submitting_approval');
      assertEquals(pill?.textContent, 'Submitting...', 'Mode pill is Submitting...');
      assert(pill!.classList.contains('gs-badge-submitting'), 'Pill has gs-badge-submitting');
      const reqBtn = shadow!.querySelector('#gs-btn-request-approval') as unknown as MockDOMElement;
      assertEquals(reqBtn.disabled, true, 'Request button disabled during submission');
      assertEquals(reqBtn.attributes['aria-busy'], 'true', 'aria-busy is true');

      // State 3: approval_requested (REQUEST_CREATION_CONFIRMED: PENDING)
      setStagingUIState('approval_requested', { requestId: 'apr_created_123' });
      assertEquals(getStagingUIState(), 'approval_requested', 'UI state is approval_requested');
      assertEquals(pill?.textContent, 'Approval Pending', 'Mode pill indicates Approval Pending');
      assert(pill!.classList.contains('gs-badge-requested'), 'Pill has gs-badge-requested');
      assert(!pill!.classList.contains('gs-badge-submitting'), 'gs-badge-submitting cleanly removed');
      const notice = shadow!.querySelector('.gs-footer-notice');
      assert(Boolean(notice?.textContent.includes('Status: PENDING')), 'Footer notice reports PENDING status');
      assert(Boolean(notice?.textContent.includes('Action: HELD')), 'Footer notice reports Action: HELD');
      assertEquals(isHandlerExecuted(), false, 'Handler has NOT executed: strictly HELD');

      // State 4: approval_confirmed_approved (Backend-Confirmed: APPROVED)
      setStagingUIState('approval_confirmed_approved', {
        requestId: 'apr_created_123',
        decidedBy: 'tc_carol',
      });
      assertEquals(getStagingUIState(), 'approval_confirmed_approved', 'UI state is approval_confirmed_approved');
      assertEquals(pill?.textContent, 'Approval Confirmed', 'Mode pill indicates Approval Confirmed');
      assert(pill!.classList.contains('gs-badge-approved'), 'Pill has gs-badge-approved');
      const banner = shadow!.querySelector('.gs-confirmation-banner');
      assert(Boolean(banner?.textContent.includes('Action Approved by Trusted Contact')), 'Banner announces approved');
      assert(Boolean(banner?.textContent.includes('tc_carol')), 'Banner cites approver tc_carol');
      assertEquals(reqBtn.textContent, 'Approval Confirmed', 'Button reflects Approval Confirmed');
      assertEquals(reqBtn.disabled, true, 'Request button is locked');
      const cancelBtn = shadow!.querySelector('#gs-btn-cancel-action') as unknown as MockDOMElement;
      assertEquals(cancelBtn.disabled, false, 'Cancel action remains available');
      assertEquals(isHandlerExecuted(), false, 'Handler has NOT executed: action remains held until user confirms');

      // State 5: approval_confirmed_rejected (Backend-Confirmed: REJECTED)
      setStagingUIState('approval_confirmed_rejected', {
        requestId: 'apr_created_123',
        decidedBy: 'tc_carol',
      });
      assertEquals(getStagingUIState(), 'approval_confirmed_rejected', 'UI state is approval_confirmed_rejected');
      assertEquals(pill?.textContent, 'Approval Denied', 'Mode pill indicates Approval Denied');
      assert(pill!.classList.contains('gs-badge-stale'), 'Pill has gs-badge-stale');
      assertEquals(reqBtn.textContent, 'Request Denied', 'Button reflects Request Denied');
      assertEquals(isHandlerExecuted(), false, 'Handler has NOT executed');

      // State 6: approval_confirmed_expired (Backend-Confirmed: EXPIRED)
      setStagingUIState('approval_confirmed_expired', { requestId: 'apr_created_123' });
      assertEquals(getStagingUIState(), 'approval_confirmed_expired', 'UI state is approval_confirmed_expired');
      assertEquals(pill?.textContent, 'Request Expired', 'Mode pill indicates Request Expired');
      assertEquals(reqBtn.textContent, 'Request Expired', 'Button reflects Request Expired');

      // State 7: approval_confirmed_cancelled (Backend-Confirmed: CANCELLED)
      setStagingUIState('approval_confirmed_cancelled', { requestId: 'apr_created_123' });
      assertEquals(getStagingUIState(), 'approval_confirmed_cancelled', 'UI state is approval_confirmed_cancelled');
      assertEquals(pill?.textContent, 'Request Cancelled', 'Mode pill indicates Request Cancelled');
      assert(pill!.classList.contains('gs-badge-cancelled'), 'Pill has gs-badge-cancelled');

      // State 8: approval_failed (SUBMISSION_REJECTED)
      setStagingUIState('approval_failed', {
        error: 'You do not have permission to request approval for this action.',
        code: 'UNAUTHORIZED_ACTION_REQUESTER',
        statusCode: 403,
      });
      assertEquals(getStagingUIState(), 'approval_failed', 'UI state is approval_failed');
      assertEquals(pill?.textContent, 'Request Rejected', 'Mode pill indicates Request Rejected');
      assertEquals(reqBtn.textContent, 'Request Rejected', 'Button reflects Request Rejected');

      // State 9: approval_uncertain (SUBMISSION_OUTCOME_UNKNOWN)
      setStagingUIState('approval_uncertain', {
        error: 'The request timed out. The backend state is unknown.',
      });
      assertEquals(getStagingUIState(), 'approval_uncertain', 'UI state is approval_uncertain');
      assertEquals(pill?.textContent, 'Outcome Uncertain', 'Mode pill indicates Outcome Uncertain');
      assertEquals(reqBtn.textContent, 'Outcome Uncertain', 'Button reflects Outcome Uncertain');

      // State 10: malformed_response
      setStagingUIState('malformed_response', {
        error: 'Response body missing required request id',
      });
      assertEquals(getStagingUIState(), 'malformed_response', 'UI state is malformed_response');
      assertEquals(pill?.textContent, 'Response Invalid', 'Mode pill indicates Response Invalid');

      dismissStagingModal();
    }

    // -------------------------------------------------------------------------
    // Test Suite 4: End-to-End Submission with Confirmed Existing Statuses
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 4: End-to-End Submission with Confirmed Existing Statuses');
    {
      const { controller, continuationManager, context, isHandlerExecuted } =
        createTestInterception('act_existing_status_1');

      // Case 4A: Backend returns existing request already in APPROVED status
      const approvedApiClient = new ApprovalApiClient({
        baseUrl: 'http://localhost:3000',
        tokenProvider: async () => 'test_jwt_alice',
        fetchFn: async () => {
          return createMockResponse(
            {
              id: 'apr_existing_approved_001',
              actionId: 'act_existing_status_1',
              requesterId: 'usr_alice',
              status: ApprovalStatus.APPROVED,
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              decision: {
                decision: 'APPROVED',
                decidedBy: 'tc_carol',
                decidedAt: '2026-10-19T03:02:00.000Z',
                decisionReason: 'Verified with alice',
              },
            },
            { status: 200 }
          );
        },
      });

      let successCallbackReceived = false;
      showStagingModal({
        context,
        controller,
        continuationManager,
        useRealBackend: true,
        apiClient: approvedApiClient,
        onRequestApprovalSuccess: () => {
          successCallbackReceived = true;
        },
      });

      const shadow = getStagingModalShadowRoot();
      const reqBtn = shadow?.querySelector('#gs-btn-request-approval') as unknown as MockDOMElement;
      reqBtn.click();

      // Microtasks settle
      await new Promise((resolve) => setTimeout(resolve, 20));

      assertEquals(successCallbackReceived, true, 'onRequestApprovalSuccess callback invoked');
      assertEquals(
        getStagingUIState(),
        'approval_confirmed_approved',
        'UI accurately transitioned to approval_confirmed_approved for existing approved request'
      );
      assertEquals(isHandlerExecuted(), false, 'Handler strictly NOT executed: action remains HELD');

      dismissStagingModal();

      // Case 4B: Backend returns malformed response during live submission
      const malformedApiClient = new ApprovalApiClient({
        baseUrl: 'http://localhost:3000',
        tokenProvider: async () => 'test_jwt_alice',
        fetchFn: async () => {
          // Missing 'apr_' prefix and missing decision block on APPROVED
          return createMockResponse(
            {
              id: 'bad_id_without_prefix',
              actionId: 'act_existing_status_1',
              status: ApprovalStatus.APPROVED,
            },
            { status: 200 }
          );
        },
      });

      let errorCallbackReceived: any = null;
      showStagingModal({
        context,
        controller,
        continuationManager,
        useRealBackend: true,
        apiClient: malformedApiClient,
        onRequestApprovalError: (res) => {
          errorCallbackReceived = res;
        },
      });

      const shadow2 = getStagingModalShadowRoot();
      const reqBtn2 = shadow2?.querySelector('#gs-btn-request-approval') as unknown as MockDOMElement;
      reqBtn2.click();

      await new Promise((resolve) => setTimeout(resolve, 20));

      assert(errorCallbackReceived !== null, 'Error callback received for malformed response');
      assertEquals(
        getStagingUIState(),
        'malformed_response',
        'UI transitioned to malformed_response when response violates domain schema'
      );
      assertEquals(isHandlerExecuted(), false, 'Handler strictly NOT executed');

      dismissStagingModal();
    }

    // -------------------------------------------------------------------------
    // Test Suite 5: Stale Responses and Component Unmounting Protection
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 5: Stale Responses and Component Unmounting Protection');
    {
      const interception1 = createTestInterception('act_action_alpha');
      const interception2 = createTestInterception('act_action_beta');

      // Scenario 5A: Modal dismissed while submission is in-flight
      let resolveSlowFetch: ((resp: Response) => void) | null = null;
      const slowApiClient = new ApprovalApiClient({
        baseUrl: 'http://localhost:3000',
        tokenProvider: async () => 'test_token',
        fetchFn: async () => {
          return new Promise<Response>((resolve) => {
            resolveSlowFetch = resolve;
          });
        },
      });

      showStagingModal({
        context: interception1.context,
        controller: interception1.controller,
        continuationManager: interception1.continuationManager,
        useRealBackend: true,
        apiClient: slowApiClient,
      });

      const shadowA = getStagingModalShadowRoot();
      const reqBtnA = shadowA?.querySelector('#gs-btn-request-approval') as unknown as MockDOMElement;

      // Start submission
      reqBtnA.click();
      assertEquals(getStagingUIState(), 'submitting_approval', 'Submission started for Action Alpha');

      // Let microtask enter fetchFn so resolveSlowFetch is assigned
      await new Promise((resolve) => setTimeout(resolve, 5));

      // USER DISMISSES MODAL WHILE SUBMISSION IS STILL IN-FLIGHT
      dismissStagingModal();
      assertEquals(isStagingModalActive(), false, 'Modal is now dismissed / unmounted');
      assertEquals(getCurrentMountedActionId(), null, 'Current mounted action is null');

      // Now backend response finally arrives after unmounting
      resolveSlowFetch!(
        createMockResponse(
          {
            id: 'apr_slow_response_001',
            actionId: 'act_action_alpha',
            status: ApprovalStatus.PENDING,
          },
          { status: 201 }
        )
      );

      // Microtasks settle
      await new Promise((resolve) => setTimeout(resolve, 25));

      assertEquals(isStagingModalActive(), false, 'Modal remains dismissed');
      assertEquals(getStagingUIState(), null, 'UI state was NOT updated for unmounted modal');

      // Scenario 5B: User switches to a DIFFERENT action while first submission is in-flight
      let resolveSlowFetch2: ((resp: Response) => void) | null = null;
      const slowApiClient2 = new ApprovalApiClient({
        baseUrl: 'http://localhost:3000',
        tokenProvider: async () => 'test_token',
        fetchFn: async () => {
          return new Promise<Response>((resolve) => {
            resolveSlowFetch2 = resolve;
          });
        },
      });

      // Mount Action Alpha
      showStagingModal({
        context: interception1.context,
        controller: interception1.controller,
        continuationManager: interception1.continuationManager,
        useRealBackend: true,
        apiClient: slowApiClient2,
      });

      const sessionBefore = getCurrentModalSessionId();
      assertEquals(getCurrentMountedActionId(), 'act_action_alpha', 'Mounted action is Action Alpha');

      // Start submission for Alpha
      const shadowAlpha = getStagingModalShadowRoot();
      const reqBtnAlpha = shadowAlpha?.querySelector('#gs-btn-request-approval') as unknown as MockDOMElement;
      reqBtnAlpha.click();
      assertEquals(getStagingUIState(), 'submitting_approval', 'Alpha submission in progress');

      // Let microtask enter fetchFn so resolveSlowFetch2 is assigned
      await new Promise((resolve) => setTimeout(resolve, 5));

      // USER SWITCHES TO ACTION BETA (re-opening modal for another held action)
      showStagingModal({
        context: interception2.context,
        controller: interception2.controller,
        continuationManager: interception2.continuationManager,
      });

      const sessionAfter = getCurrentModalSessionId();
      assert(sessionAfter > sessionBefore, 'Modal session token incremented');
      assertEquals(getCurrentMountedActionId(), 'act_action_beta', 'Mounted action is now Action Beta');
      assertEquals(getStagingUIState(), 'held', 'Modal UI is in held review state for Action Beta');

      // Now the slow response for Action Alpha arrives
      resolveSlowFetch2!(
        createMockResponse(
          {
            id: 'apr_alpha_late_response',
            actionId: 'act_action_alpha',
            status: ApprovalStatus.PENDING,
          },
          { status: 201 }
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 25));

      // CRITICAL CHECK: Action Beta's modal UI was NOT overwritten with Action Alpha's response!
      assertEquals(
        getStagingUIState(),
        'held',
        'Stale response protection: Beta modal was NOT overwritten by Alpha response'
      );
      assertEquals(getCurrentMountedActionId(), 'act_action_beta', 'Mounted action remains Action Beta');

      dismissStagingModal();
    }

    // -------------------------------------------------------------------------
    // Test Suite 6: Error Message Sanitization & Security
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 6: Error Message Sanitization & Security');
    {
      // 6A: Stack trace sanitization
      const errorWithStack = new Error(
        'Database query failed\n    at queryDb (/app/src/db/repo.js:42:15)\n    at Object.handler (/app/src/index.js:10:5)'
      );
      const sanitizedStack = sanitizeApprovalErrorMessage(errorWithStack);
      assert(!sanitizedStack.includes('at queryDb'), 'Stack trace lines stripped');
      assert(!sanitizedStack.includes('/app/src/db/repo.js'), 'Internal file paths stripped');

      // 6B: Bearer token & password sanitization
      const errorWithSecrets = 'Authorization failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token password=supersecret123';
      const sanitizedSecrets = sanitizeApprovalErrorMessage(errorWithSecrets);
      assert(!sanitizedSecrets.includes('supersecret123'), 'Plain-text passwords stripped');
      assert(!sanitizedSecrets.includes('eyJhbGci'), 'Bearer JWT tokens stripped');
      assert(sanitizedSecrets.includes('[REDACTED]'), 'Replaced with [REDACTED]');

      // 6C: SQL injection / table leak sanitization
      const sqlError = 'Query error: SELECT id, password_hash FROM approval_requests WHERE user_id = 1;';
      const sanitizedSql = sanitizeApprovalErrorMessage(sqlError);
      assert(!sanitizedSql.includes('password_hash'), 'Database column names stripped');
      assert(!sanitizedSql.includes('SELECT'), 'SQL SELECT statement stripped');

      // 6D: HTTP status code standard mappings
      assertEquals(
        sanitizeApprovalErrorMessage('raw 401', 401),
        'Authentication session expired or missing. Please sign in again.',
        'HTTP 401 mapped to friendly session message'
      );
      assertEquals(
        sanitizeApprovalErrorMessage('raw 403', 403),
        'You do not have permission to request approval for this action.',
        'HTTP 403 mapped to friendly permission message'
      );
      assertEquals(
        sanitizeApprovalErrorMessage('raw 409', 409),
        'Action state conflict on the server. The action may have already been resolved.',
        'HTTP 409 mapped to friendly conflict message'
      );
      assertEquals(
        sanitizeApprovalErrorMessage('raw 410', 410),
        'This approval request has expired and is no longer valid.',
        'HTTP 410 mapped to friendly expired message'
      );
      assertEquals(
        sanitizeApprovalErrorMessage('raw 429', 429),
        'Too many requests. Please wait a moment before trying again.',
        'HTTP 429 mapped to friendly rate limit message'
      );
      assertEquals(
        sanitizeApprovalErrorMessage('raw 500', 500),
        'A temporary server error occurred. The action remains safely paused.',
        'HTTP 500 mapped to friendly safe server error'
      );
    }

    // -------------------------------------------------------------------------
    // Test Suite 7: Truthful Messaging & Caretaker Boundary
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 7: Truthful Messaging & Caretaker Boundary');
    {
      const statesToCheck: Array<'not_submitted' | 'submitting' | 'creation_confirmed' | 'status_confirmed' | 'rejected' | 'unknown' | 'local_invalid' | 'malformed'> = [
        'not_submitted',
        'submitting',
        'creation_confirmed',
        'status_confirmed',
        'rejected',
        'unknown',
        'local_invalid',
        'malformed',
      ];

      for (const st of statesToCheck) {
        const computed = determineApprovalState({
          state: st,
          request: {
            id: 'apr_truth_1',
            actionId: 'act_truth_1',
            requesterId: 'usr_alice',
            status: st === 'status_confirmed' ? ApprovalStatus.APPROVED : ApprovalStatus.PENDING,
            actionDescription: 'Test',
            actionType: ActionType.CLICK,
            riskLevel: RiskLevel.LOW,
            riskReasons: [],
            createdAt: '2026-10-19T03:00:00.000Z',
            expiresAt: '2026-10-19T03:30:00.000Z',
            decision:
              st === 'status_confirmed'
                ? {
                    decision: 'APPROVED',
                    decidedBy: 'tc_carol',
                    decidedAt: '2026-10-19T03:05:00.000Z',
                  }
                : undefined,
          },
        });

        // Truthful messaging: Never claim a caretaker has received an alert or SMS in Day 10
        assert(
          !computed.headline.toLowerCase().includes('caretaker notified') &&
            !computed.detail.toLowerCase().includes('caretaker notified') &&
            !computed.footerNotice.toLowerCase().includes('caretaker notified'),
          `State "${st}" does not claim caretaker notified`
        );

        assert(
          !computed.detail.toLowerCase().includes('sms sent') &&
            !computed.detail.toLowerCase().includes('email sent'),
          `State "${st}" does not claim SMS or email sent`
        );

        // Invariant: action must be held
        assertEquals(computed.isActionHeld, true, `State "${st}" strictly enforces isActionHeld: true`);
      }
    }

    console.log('\n====================================================================');
    console.log(`📊 APPROVAL STATUS & VALIDATION SUITE: ${passedAssertions} / ${totalAssertions} PASSED`);
    console.log('🎉 ALL STATUS DISPLAY, VALIDATION, AND INVARIANT REQUIREMENTS MET!');
    console.log('====================================================================\n');
  } finally {
    teardownDOM();
  }
}

runApprovalStatusTests().catch((err) => {
  console.error('\n❌ Unhandled failure in approval status test suite:', err);
  if (typeof process !== 'undefined') {
    process.exit(1);
  }
});
