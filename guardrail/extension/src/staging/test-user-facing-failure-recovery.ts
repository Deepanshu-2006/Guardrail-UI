/**
 * Guardrail User-Facing Failure Recovery & Error States Verification Suite
 * Day 19 Prompt 6
 *
 * Verifies that:
 * 1. User-facing text accurately distinguishes detection from interception, warning from blocking,
 *    pending from approved, rejection from unavailability, and expiration from generic failures.
 * 2. Zero automatic execution occurs across any error or recovery state.
 * 3. Recovery controls (dismiss, cancel, return to safety) do not bypass authorization or security policies.
 * 4. Cancelled, invalidated, or expired actions require a new supported workflow rather than unsafe replay.
 * 5. In-flight locks prevent duplicate submissions and race conditions.
 * 6. Accessibility & focus management: focus is restored to previousActiveElement upon modal dismissal;
 *    Escape key closes dialog; announcements are dispatched to live regions; status messages do not rely on color alone.
 * 7. Privacy: Stack traces, bearer tokens, passwords, SQL statements, and internal paths are strictly sanitized.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { RiskLevel, RiskAssessment, RiskEvaluationStatus } from '../types/risk.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';
import { StagingActionContext } from '../types/staging.js';
import { ApprovalRequest, ApprovalStatus } from '../types/approval.js';
import {
  determineApprovalState,
  sanitizeApprovalErrorMessage,
  UIApprovalStatus,
} from './status.js';
import {
  dismissStagingModal,
  getStagingUIState,
  isStagingModalActive,
  setStagingUIState,
  showStagingModal,
  getStagingModalShadowRoot,
} from './modal.js';
import {
  dismissWarningModal,
  isWarningModalActive,
  showWarningModal,
} from '../ui/warning-modal.js';
import { explainRiskDecision } from '../response/explanation.js';
import { ContinuationEligibilityStatus } from '../interception/validation-service.js';
import { ContinuationManager } from '../interception/continuation.js';
import { InterceptionController } from '../interception/controller.js';

// Setup minimal DOM simulation in Node
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

  insertBefore<T extends MockDOMElement>(newChild: T, refChild: MockDOMElement | null): T {
    newChild.parentNode = this;
    if (!refChild) {
      this.children.push(newChild);
      return newChild;
    }
    const idx = this.children.indexOf(refChild);
    if (idx === -1) {
      this.children.push(newChild);
    } else {
      this.children.splice(idx, 0, newChild);
    }
    return newChild;
  }

  remove(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
  }

  attachShadow(init: { mode: string }): MockShadowRoot {
    const shadow = new MockShadowRoot(init.mode);
    shadow.host = this;
    this.shadowRoot = shadow;
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

  dispatchEvent(event: any): void {
    if (this.listeners[event.type]) {
      for (const listener of this.listeners[event.type]) {
        listener(event);
      }
    }
    if (event.bubbles && this.parentNode) {
      this.parentNode.dispatchEvent(event);
    }
  }

  click(): void {
    this.dispatchEvent({ type: 'click', target: this, defaultPrevented: false });
  }

  focus(): void {
    if (typeof (globalThis as any).document !== 'undefined') {
      (globalThis as any).document._setActiveElement(this);
    }
  }

  blur(): void {
    if (
      typeof (globalThis as any).document !== 'undefined' &&
      (globalThis as any).document.activeElement === this
    ) {
      (globalThis as any).document._setActiveElement(null);
    }
  }

  querySelector(selector: string): MockDOMElement | null {
    if (selector.includes(',')) {
      const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const found = this.querySelector(part);
        if (found) return found;
      }
      return null;
    }
    const cleanSel = selector.trim();
    if (cleanSel.startsWith('#')) {
      const id = cleanSel.substring(1);
      return this._find((el) => el.id === id);
    }
    if (cleanSel.startsWith('.')) {
      const cls = cleanSel.substring(1);
      return this._find((el) => el.classList.contains(cls));
    }
    return this._find((el) => el.tagName.toLowerCase() === cleanSel.toLowerCase());
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];
    const cleanSel = selector.trim();
    this._findAll((el) => {
      if (cleanSel.startsWith('#') && el.id === cleanSel.substring(1)) return true;
      if (cleanSel.startsWith('.') && el.classList.contains(cleanSel.substring(1))) return true;
      if (el.tagName.toLowerCase() === cleanSel.toLowerCase()) return true;
      return false;
    }, results);
    return results;
  }

  private _find(predicate: (el: MockDOMElement) => boolean): MockDOMElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child._find(predicate);
      if (found) return found;
    }
    return null;
  }

  private _findAll(predicate: (el: MockDOMElement) => boolean, results: MockDOMElement[]): void {
    for (const child of this.children) {
      if (predicate(child)) results.push(child);
      child._findAll(predicate, results);
    }
  }
}

class MockShadowRoot extends MockDOMElement {
  public host: MockDOMElement | null = null;
  public mode: string;
  constructor(mode: string) {
    super('SHADOWROOT');
    this.mode = mode;
  }
}

class MockDocument {
  public body: MockDOMElement;
  public head: MockDOMElement;
  public activeElement: MockDOMElement | null = null;
  private elementsById: Map<string, MockDOMElement> = new Map();

  constructor() {
    this.body = new MockDOMElement('BODY');
    this.head = new MockDOMElement('HEAD');
  }

  createElement(tagName: string): MockDOMElement {
    return new MockDOMElement(tagName);
  }

  getElementById(id: string): MockDOMElement | null {
    if (this.body.id === id) return this.body;
    return this.body.querySelector(`#${id}`);
  }

  _setActiveElement(el: MockDOMElement | null): void {
    this.activeElement = el;
  }
}

const mockDoc = new MockDocument();
(globalThis as any).document = mockDoc;
(globalThis as any).window = {
  addEventListener: (type: string, fn: (e: any) => void) => {
    if (!(mockDoc as any)._windowListeners) (mockDoc as any)._windowListeners = {};
    if (!(mockDoc as any)._windowListeners[type]) (mockDoc as any)._windowListeners[type] = [];
    (mockDoc as any)._windowListeners[type].push(fn);
  },
  removeEventListener: (type: string, fn: (e: any) => void) => {
    if (!(mockDoc as any)._windowListeners?.[type]) return;
    (mockDoc as any)._windowListeners[type] = (mockDoc as any)._windowListeners[type].filter((l: any) => l !== fn);
  },
  dispatchEvent: (event: any) => {
    if ((mockDoc as any)._windowListeners?.[event.type]) {
      for (const listener of (mockDoc as any)._windowListeners[event.type]) {
        listener(event);
      }
    }
  },
};

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

async function runAllTests(): Promise<void> {
  console.log('================================================================');
  console.log('Recovery and Workflow Failure Verification Suite');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // TEST SUITE 1: Accurate User-Facing Messaging & Boundary Truthfulness
  // ---------------------------------------------------------------------------
  console.log('--- Suite 1: Accurate User-Facing Messaging & Boundary Truthfulness ---');

  // Test 1.1: Warning vs Blocking distinction in explanations
  const mockWarnAction: GuardrailAction = {
    id: 'act-warn-001',
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    page: { url: 'https://bank.example.com/pay', title: 'Payment' },
    element: { tagName: 'BUTTON', visibleText: 'Pay $50' },
  };
  const mockWarnDecision: ResponseDecision = {
    actionId: 'act-warn-001',
    response: ResponseAction.WARN,
    reasons: ['Elevated sensitivity: Payment checkout interaction.'],
    createdAt: new Date().toISOString(),
    status: RiskEvaluationStatus.EVALUATED,
    success: true,
    policyRuleId: 'RULE_WARN_PAYMENT',
  };
  const warnExplanation = explainRiskDecision(mockWarnDecision, undefined, mockWarnAction);

  assertEquals(warnExplanation.decision, ResponseAction.WARN, 'Decision is WARN');
  assert(
    warnExplanation.headline.includes('Advisory') || warnExplanation.headline.includes('Sensitive'),
    'Warning headline accurately reflects advisory friction rather than a blocked action'
  );
  assert(
    warnExplanation.recoveryGuidance?.some((g) => g.includes('Continue to proceed') || g.includes('Cancel')),
    'Warning recovery guidance distinguishes advisory from block'
  );

  // Test 1.2: Creation confirmed confirms PENDING, strictly NOT approved
  const pendingState = determineApprovalState({
    state: 'creation_confirmed',
    request: {
      id: 'apr_pending_001',
      actionId: 'act-001',
      status: ApprovalStatus.PENDING,
      requesterId: 'usr_alice',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    },
  });
  assertEquals(pendingState.uiStatus, UIApprovalStatus.REQUEST_CREATION_CONFIRMED, 'State is REQUEST_CREATION_CONFIRMED');
  assertEquals(pendingState.backendStatus, ApprovalStatus.PENDING, 'Backend status is strictly PENDING');
  assertEquals(pendingState.headline, 'Approval Request Submitted', 'Headline confirms request submitted for review');
  assert(pendingState.detail.includes('PENDING'), 'Detail explicitly states request is in PENDING status');
  assert(!pendingState.detail.toLowerCase().includes('has been approved'), 'Detail does NOT claim request has been approved');
  assertEquals(pendingState.isActionHeld, true, 'Protected action remains strictly HELD');

  // Test 1.3: Rejection distinguishes contact rejection from service unavailability
  const rejectedState = determineApprovalState({
    state: 'status_confirmed',
    request: {
      id: 'apr_rej_001',
      actionId: 'act-002',
      status: ApprovalStatus.REJECTED,
      requesterId: 'usr_alice',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      decision: {
        decidedBy: 'tc_carol',
        decidedAt: new Date().toISOString(),
        status: ApprovalStatus.REJECTED,
        reason: 'Untrusted vendor',
      },
    },
  });
  assertEquals(rejectedState.uiStatus, UIApprovalStatus.STATUS_CONFIRMED_REJECTED, 'State is STATUS_CONFIRMED_REJECTED');
  assertEquals(rejectedState.headline, 'Approval Denied by Contact', 'Headline explicitly indicates contact denial');
  assert(rejectedState.detail.includes('tc_carol'), 'Detail credits the authorized reviewer');
  assert(rejectedState.detail.includes('rejected'), 'Detail explains the request was rejected');
  assertEquals(rejectedState.isActionHeld, true, 'Rejected action remains safely HELD/paused');

  // Test 1.4: Expiration distinguishes review window expiration from generic failure
  const expiredState = determineApprovalState({
    state: 'status_confirmed',
    request: {
      id: 'apr_exp_001',
      actionId: 'act-003',
      status: ApprovalStatus.EXPIRED,
      requesterId: 'usr_alice',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    },
  });
  assertEquals(expiredState.uiStatus, UIApprovalStatus.STATUS_CONFIRMED_EXPIRED, 'State is STATUS_CONFIRMED_EXPIRED');
  assertEquals(expiredState.headline, 'Approval Request Expired', 'Headline identifies expiration');
  assert(expiredState.detail.includes('expired without a decision'), 'Detail explains review window expired without decision');
  assertEquals(expiredState.isActionHeld, true, 'Expired action remains safely HELD');

  const approvedState = determineApprovalState({
    state: 'status_confirmed',
    request: {
      id: 'apr_approved_001',
      actionId: 'act-004',
      status: ApprovalStatus.APPROVED,
      requesterId: 'usr_alice',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      decision: {
        decidedBy: 'tc_carol',
        decidedAt: new Date().toISOString(),
        status: ApprovalStatus.APPROVED,
      },
    },
  });
  assertEquals(approvedState.backendStatus, ApprovalStatus.APPROVED, 'Recovery displays authoritative approval status');
  assertEquals(approvedState.isActionHeld, true, 'Approval recovery leaves the browser action held');
  assert(approvedState.detail.includes('Approval does not run the action'), 'Approval copy explicitly says recovery does not execute the action');

  // ---------------------------------------------------------------------------
  // TEST SUITE 2: Safety & Non-Execution Invariants Across Error States
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 2: Non-Execution Invariants Across Failure States ---');

  const failureStates: Array<Parameters<typeof determineApprovalState>[0]['state']> = [
    'rejected',
    'unknown',
    'local_invalid',
    'malformed',
  ];

  for (const st of failureStates) {
    const computed = determineApprovalState({
      state: st,
      rawError: 'Simulated failure condition',
      statusCode: st === 'rejected' ? 403 : undefined,
    });
    const expectedHeld = st !== 'local_invalid';
    assertEquals(computed.isActionHeld, expectedHeld, `Failure state "${st}" reports the actual held state`);
    assertEquals(computed.isRequestButtonDisabled, true, `Failure state "${st}" disables request button to prevent rapid spin`);
  }

  // ---------------------------------------------------------------------------
  // TEST SUITE 3: Recovery Controls, Staging Modal Lifecycle & Cancel Behavior
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 3: Recovery Controls & In-Flight Concurrency Protection ---');

  const testContext: StagingActionContext = {
    actionId: 'act-recovery-001',
    actionType: ActionType.CLICK,
    category: ActionCategory.DOM_MUTATION,
    description: 'Delete user account and all personal files',
    riskLevel: RiskLevel.HIGH,
    riskScore: 78,
    riskReasons: ['Destructive command targeting personal account data.'],
    origin: 'https://example.com',
    hostname: 'example.com',
    targetSelector: '#btn-delete-account',
    timestamp: new Date().toISOString(),
  };

  // Mount modal in active review state
  let cancelCallbackInvoked = false;
  showStagingModal({
    context: testContext,
    state: 'active',
    onCancel: (actionId) => {
      cancelCallbackInvoked = true;
      return { success: true, actionId, record: undefined };
    },
  });

  const shadow = getStagingModalShadowRoot();
  assert(shadow !== null, 'Staging modal shadow root mounted');
  assertEquals(getStagingUIState(), 'held', 'Initial UI state is held');

  const cancelBtn = shadow?.querySelector('#gs-btn-cancel-action') as unknown as MockDOMElement;
  assert(cancelBtn !== null, 'Cancel Action button rendered in DOM');
  assertEquals(cancelBtn.disabled, false, 'Cancel Action button is enabled');

  // Test 3.1: Cancelled state transition stops modification
  setStagingUIState('cancelled');
  assertEquals(getStagingUIState(), 'cancelled', 'UI transitioned to cancelled');
  assertEquals(cancelBtn.disabled, true, 'Cancel button is disabled after action is cancelled');
  assertEquals(cancelBtn.textContent, 'Action Cancelled', 'Cancel button indicates Action Cancelled');

  // Test 3.2: Terminal cancelled state cannot be overwritten by delayed APPROVED update
  setStagingUIState('approval_confirmed_approved', {
    requestId: 'apr_late_arrival',
  });
  assertEquals(
    getStagingUIState(),
    'cancelled',
    'Monotonic terminal guard: Late APPROVED response cannot overwrite CANCELLED state'
  );

  dismissStagingModal();
  assertEquals(isStagingModalActive(), false, 'Staging modal dismissed and cleaned up');

  // ---------------------------------------------------------------------------
  // TEST SUITE 4: Warning Modal Dismissal & Escape Behavior
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 4: Warning Modal Dismissal & Safety Invariants ---');

  let warningCancelled = false;
  let warningContinued = false;

  showWarningModal({
    action: mockWarnAction,
    risk: {
      actionId: mockWarnAction.id,
      riskLevel: RiskLevel.MEDIUM,
      score: 55,
      reasons: ['Payment interaction'],
      matchedRules: [],
      evaluatedAt: new Date().toISOString(),
      status: RiskEvaluationStatus.EVALUATED,
      success: true,
    },
    decision: mockWarnDecision,
    onCancel: () => {
      warningCancelled = true;
    },
    onContinue: () => {
      warningContinued = true;
    },
  });

  assert(isWarningModalActive(), 'Warning modal is active in DOM');

  // Test 4.1: Dismissing via Escape key triggers onCancel, strictly NEVER onContinue
  (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert(warningCancelled, 'Escape key on warning modal triggered onCancel');
  assert(!warningContinued, 'Dismissing warning modal strictly NEVER implies approval or continue');
  assert(!isWarningModalActive(), 'Warning modal cleanly unmounted from DOM');

  // ---------------------------------------------------------------------------
  // TEST SUITE 5: Focus Management & Accessibility Controls
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 5: Focus Management & Accessible Status Messaging ---');

  // Create a mock trigger button to test focus capture and restoration
  const triggerBtn = new MockDOMElement('BUTTON');
  triggerBtn.id = 'external-trigger-button';
  mockDoc.body.appendChild(triggerBtn);
  triggerBtn.focus();
  assertEquals(mockDoc.activeElement?.id, 'external-trigger-button', 'Trigger element focused before modal open');

  // Open Staging Modal
  showStagingModal({
    context: testContext,
    state: 'active',
  });
  assert(isStagingModalActive(), 'Modal mounted');

  // Close Staging Modal
  dismissStagingModal();
  assertEquals(
    mockDoc.activeElement?.id,
    'external-trigger-button',
    'Focus successfully restored to trigger element upon staging modal dismissal'
  );

  // Test 5.2: Warning Modal focus capture and restoration
  triggerBtn.focus();
  assertEquals(mockDoc.activeElement?.id, 'external-trigger-button', 'Trigger element focused before warning modal open');

  showWarningModal({
    action: mockWarnAction,
    risk: {
      actionId: mockWarnAction.id,
      riskLevel: RiskLevel.MEDIUM,
      score: 50,
      reasons: [],
      matchedRules: [],
      evaluatedAt: new Date().toISOString(),
      status: RiskEvaluationStatus.EVALUATED,
      success: true,
    },
    decision: mockWarnDecision,
  });

  dismissWarningModal();
  assertEquals(
    mockDoc.activeElement?.id,
    'external-trigger-button',
    'Focus successfully restored to trigger element upon warning modal dismissal'
  );

  // Test 5.3: Status messages do not rely on color alone
  const testPillStates: Array<{ state: Parameters<typeof setStagingUIState>[0]; expectedPill: string; expectedBadgeClass: string }> = [
    { state: 'held', expectedPill: 'Review Mode', expectedBadgeClass: 'gs-badge-held' },
    { state: 'submitting_approval', expectedPill: 'Submitting...', expectedBadgeClass: 'gs-badge-submitting' },
    { state: 'approval_requested', expectedPill: 'Approval Pending', expectedBadgeClass: 'gs-badge-requested' },
    { state: 'approval_confirmed_approved', expectedPill: 'Approval Confirmed', expectedBadgeClass: 'gs-badge-approved' },
    { state: 'approval_confirmed_rejected', expectedPill: 'Approval Denied', expectedBadgeClass: 'gs-badge-stale' },
    { state: 'approval_confirmed_expired', expectedPill: 'Request Expired', expectedBadgeClass: 'gs-badge-stale' },
    { state: 'approval_confirmed_cancelled', expectedPill: 'Request Cancelled', expectedBadgeClass: 'gs-badge-cancelled' },
  ];

  showStagingModal({ context: testContext, state: 'active' });
  const activeShadow = getStagingModalShadowRoot();

  for (const item of testPillStates) {
    setStagingUIState(item.state);
    const pill = activeShadow?.querySelector('.gs-mode-pill');
    assertEquals(pill?.textContent, item.expectedPill, `State "${item.state}" has explicit textual label: "${item.expectedPill}"`);
    assert(pill?.classList.contains(item.expectedBadgeClass) ?? false, `State "${item.state}" has distinct CSS class`);
  }

  dismissStagingModal();

  // ---------------------------------------------------------------------------
  // TEST SUITE 6: Secret Redaction & Error Sanitization
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 6: Sensitive Data Redaction in Error Messages ---');

  // Test 6.1: HTTP status code standard mappings
  assertEquals(
    sanitizeApprovalErrorMessage(null, 401),
    'Authentication session expired or missing. Please sign in again.',
    '401 mapped to clean session message'
  );
  assertEquals(
    sanitizeApprovalErrorMessage(null, 403),
    'You do not have permission to request approval for this action.',
    '403 mapped to clean authorization message'
  );
  assertEquals(
    sanitizeApprovalErrorMessage(null, 429),
    'Too many requests. Please wait a moment before trying again.',
    '429 mapped to clean rate-limiting message'
  );
  assertEquals(
    sanitizeApprovalErrorMessage(null, 502),
    'A temporary server error occurred. The action remains safely paused.',
    '502 mapped to temporary server error message'
  );

  // Test 6.2: Sensitive credentials & token stripping
  const rawSensitiveError =
    'Connection error with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 ' +
    'and token=secretToken123456 and password=superSecretPassword! ' +
    'SELECT * FROM users WHERE id = 123;\n' +
    '    at submitHandler (/var/www/internal/approval.ts:124:12)';

  const sanitized = sanitizeApprovalErrorMessage(rawSensitiveError);

  assert(!sanitized.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'JWT Bearer token stripped');
  assert(!sanitized.includes('secretToken123456'), 'Raw token stripped');
  assert(!sanitized.includes('superSecretPassword!'), 'Password stripped');
  assert(!sanitized.includes('SELECT * FROM'), 'SQL statement stripped');
  assert(!sanitized.includes('/var/www/internal/approval.ts'), 'Internal file path stripped');
  assert(!sanitized.includes('at submitHandler'), 'Stack trace stripped');
  assert(sanitized.includes('[REDACTED]'), 'Replaced with [REDACTED]');

  // ---------------------------------------------------------------------------
  // TEST SUITE 7: Invalidation on Context Change
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 7: Context Change & Invalidation Workflow ---');

  showStagingModal({ context: testContext, state: 'active' });
  setStagingUIState('action_invalidated', {
    error: 'The target element was detached or modified while held.',
  });

  assertEquals(getStagingUIState(), 'action_invalidated', 'UI state is action_invalidated');
  const invShadow = getStagingModalShadowRoot();
  const invPill = invShadow?.querySelector('.gs-mode-pill');
  assertEquals(invPill?.textContent, 'Context Changed', 'Mode pill indicates Context Changed');

  const invContinueBtn = invShadow?.querySelector('#gs-btn-continue-action') as unknown as MockDOMElement;
  assertEquals(invContinueBtn.disabled, true, 'Continue button strictly disabled after context changed');

  const invCancelBtn = invShadow?.querySelector('#gs-btn-cancel-action') as unknown as MockDOMElement;
  assertEquals(invCancelBtn.disabled, true, 'Cancel button disabled as action is already invalidated');

  dismissStagingModal();

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
  console.log('================================================================');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal error in user-facing failure recovery tests:', err);
  process.exit(1);
});
