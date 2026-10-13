/**
 * Guardrail Staging Mode - Comprehensive End-to-End Workflow Verification Suite
 *
 * Verifies the complete Staging Mode workflow from action interception through user decision:
 *
 * SCENARIO 1  — Protected action interception and staging interface presentation.
 * SCENARIO 2  — Correct action description and risk reasons display.
 * SCENARIO 3  — Graceful handling of missing optional metadata without breaking.
 * SCENARIO 4  — Cancel action successfully cancels the held interception.
 * SCENARIO 5  — Cancellation does NOT execute the controlled test handler.
 * SCENARIO 6  — Request approval produces only the intended local approval-request event.
 * SCENARIO 7  — UI does not claim caretaker was notified or approval was granted.
 * SCENARIO 8  — Requesting approval does not execute or release the held action.
 * SCENARIO 9  — Repeated clicks do not create duplicate operations or execute actions.
 * SCENARIO 10 — Invalid, stale, or already-resolved records are handled safely.
 * SCENARIO 11 — UI does not expose sensitive input values, tokens, or credentials.
 * SCENARIO 12 — Page-derived text is rendered safely without executable HTML / XSS.
 * SCENARIO 13 — Modal opens and dismisses without duplicate panels or listeners.
 * SCENARIO 14 — Canonical state machine integrity & zero accidental execution.
 */

declare const process: { exit: (code: number) => void };

// =============================================================================
// Minimal DOM Simulation Environment (Node.js ESM Test Runner)
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

  focus(): void {
    if (typeof (globalThis as any).document?._setActiveElement === 'function') {
      (globalThis as any).document._setActiveElement(this);
    }
  }

  blur(): void {
    if (typeof (globalThis as any).document?._setActiveElement === 'function') {
      if ((globalThis as any).document.activeElement === this) {
        (globalThis as any).document._setActiveElement(null);
      }
    }
  }

  contains(other: MockDOMElement | null): boolean {
    if (!other) return false;
    if (other === this) return true;
    for (const child of this.children) {
      if (child.contains(other)) return true;
    }
    return false;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'id') this.id = value;
    if (name === 'class') this.className = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return name in this.attributes;
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

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  attachShadow(init: { mode: string }): MockShadowRoot {
    this.shadowRoot = new MockShadowRoot(init.mode);
    this.shadowRoot.host = this;
    return this.shadowRoot;
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

  click(): void {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', target: this });
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
  public activeElement: MockDOMElement | null = null;
  constructor(mode: string = 'open') {
    super('#SHADOW-ROOT');
    this.mode = mode;
  }

  contains(other: MockDOMElement | null): boolean {
    if (!other) return false;
    for (const child of this.children) {
      if (child.contains(other)) return true;
    }
    return false;
  }
}

function querySelectorInternal(root: MockDOMElement, selector: string): MockDOMElement | null {
  const parts = selector.trim().split(/\s+/);
  if (parts.length > 1) {
    const [first, ...rest] = parts;
    const firstMatches: MockDOMElement[] = [];
    querySelectorAllInternal(root, first, firstMatches);
    for (const m of firstMatches) {
      const nested = m.querySelector(rest.join(' '));
      if (nested) return nested;
    }
    return null;
  }
  for (const child of root.children) {
    if (matchesSelector(child, selector)) {
      return child;
    }
    const found = querySelectorInternal(child, selector);
    if (found) return found;
  }
  return null;
}

function querySelectorAllInternal(root: MockDOMElement, selector: string, acc: MockDOMElement[]): void {
  const parts = selector.trim().split(/\s+/);
  if (parts.length > 1) {
    const [first, ...rest] = parts;
    const firstMatches: MockDOMElement[] = [];
    querySelectorAllInternal(root, first, firstMatches);
    for (const m of firstMatches) {
      const nested = m.querySelectorAll(rest.join(' '));
      for (const n of nested) {
        if (!acc.includes(n)) acc.push(n);
      }
    }
    return;
  }
  for (const child of root.children) {
    if (matchesSelector(child, selector)) {
      acc.push(child);
    }
    querySelectorAllInternal(child, selector, acc);
  }
}

function matchesSelector(el: MockDOMElement, selector: string): boolean {
  const trimmed = selector.trim();
  if (trimmed.startsWith('#')) {
    return el.id === trimmed.slice(1);
  }
  if (trimmed.startsWith('.')) {
    return el.classList.contains(trimmed.slice(1));
  }
  if (trimmed === 'button:not(:disabled)') {
    return el.tagName.toLowerCase() === 'button' && !el.disabled;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

class MockDocument {
  public body: MockDOMElement;
  public activeElement: MockDOMElement | null = null;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  constructor() {
    this.body = new MockDOMElement('BODY');
  }
  _setActiveElement(el: MockDOMElement | null): void {
    this.activeElement = el;
    let curr: MockDOMElement | null = el;
    while (curr) {
      if (curr instanceof MockShadowRoot) {
        curr.activeElement = el;
        break;
      }
      curr = curr.parentNode;
    }
  }
  createElement(tag: string): MockDOMElement {
    return new MockDOMElement(tag);
  }
  getElementById(id: string): MockDOMElement | null {
    return querySelectorInternal(this.body, `#${id}`);
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
  }
}

class MockWindow {
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

if (typeof (globalThis as any).CustomEvent === 'undefined') {
  (globalThis as any).CustomEvent = class CustomEvent {
    public type: string;
    public detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
}

const mockDoc = new MockDocument();
const mockWin = new MockWindow();
(globalThis as any).document = mockDoc;
(globalThis as any).window = mockWin;

// =============================================================================
// Imports from Extension Architecture
// =============================================================================
import { classifyAction } from '../classifier/index.js';
import { assessRisk } from '../risk/index.js';
import { decideResponse } from '../response/index.js';
import {
  ActionCategory,
  ActionType,
  GuardrailAction,
} from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { InterceptionState } from '../types/interception.js';
import { RiskLevel } from '../types/risk.js';
import { StagingActionContext } from '../types/staging.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import {
  createStagingActionContext,
  createApprovalRequestIntent,
} from './context.js';
import {
  STAGING_HOST_ELEMENT_ID,
  dismissStagingModal,
  getStagingModalShadowRoot,
  getStagingUIState,
  isStagingModalActive,
  showStagingModal,
  handleModalCancel,
} from './modal.js';

// =============================================================================
// Helper: Create Standard Staging Context
// =============================================================================
function createSampleContext(overrides: Partial<StagingActionContext> = {}): StagingActionContext {
  return {
    actionId: 'act-workflow-sample-123',
    description: 'Destructive operation: Click on "Delete All Data"',
    actionType: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 100,
    riskReasons: [
      'Target element is a destructive delete button',
      'Action causes permanent bulk data removal',
    ],
    responseAction: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    interceptionReason: 'Action halted pending user protection review.',
    origin: 'https://app.example.com',
    hostname: 'app.example.com',
    pageTitle: 'Account Settings',
    timestamp: '2026-10-13T10:00:00.000Z',
    stagedAt: '2026-10-13T10:00:00.050Z',
    ...overrides,
  };
}

// =============================================================================
// Test Runner Assertions
// =============================================================================
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    console.log(`  ✓ ${message}: ${String(actual)}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}. Expected "${String(expected)}", received "${String(actual)}"`);
    failed++;
  }
}

console.log('\n============================================================');
console.log('🛡️ GUARDRAIL DAY 9: COMPLETE STAGING MODE WORKFLOW VERIFICATION');
console.log('============================================================\n');

// =============================================================================
// SCENARIO 1: Protected Action Interception & Staging Presentation
// =============================================================================
console.log('▶ Scenario 1: Protected Action Interception & Staging Mode Presentation');
{
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  let controlledHandlerExecutions = 0;
  // Use high-impact text matching Day 8 / classifier destructive patterns that trigger CRITICAL -> PROTECT
  const protectedAction: GuardrailAction = {
    id: 'workflow-action-scenario-1',
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: {
      url: 'https://bank.example.com/transfer',
      title: 'Transfer Money - Online Banking',
    },
    element: {
      tagName: 'BUTTON',
      id: 'btn-confirm-transfer',
      visibleText: 'Delete All Account Data, Cancel Billing, and Export to External Server',
    },
  };

  // 1. Pipeline evaluation
  const classification = classifyAction(protectedAction);
  const risk = assessRisk(protectedAction, classification);
  const decision = decideResponse(risk);

  assertEquals(decision.response, ResponseAction.PROTECT, 'Pipeline evaluation produces PROTECT response');
  assertEquals(risk.riskLevel, RiskLevel.CRITICAL, 'Elevated CRITICAL risk detected');

  // 2. Interception state transition
  controller.register(protectedAction, 'Detected on bank page');
  const heldRecord = controller.holdAction(protectedAction.id, 'Held for review');
  assertEquals(heldRecord.state, InterceptionState.HELD, 'Interception record transitioned to HELD');

  // 3. Register controlled continuation handler
  continuationManager.registerHeldAction(protectedAction, heldRecord, () => {
    controlledHandlerExecutions++;
  });

  // 4. Build strongly typed staging context
  const stagingContext = createStagingActionContext({
    action: protectedAction,
    interception: heldRecord,
    risk,
    classification,
    decision,
  });

  // 5. Mount Staging Mode visual shell
  showStagingModal({
    context: stagingContext,
    state: 'active',
    controller,
    continuationManager,
  });

  assert(isStagingModalActive(), 'Staging Mode interface is active in DOM');
  const shadow = getStagingModalShadowRoot();
  assert(shadow !== null, 'Staging Mode shadow DOM root is attached and isolated');
  assertEquals(getStagingUIState(), 'held', 'Initial interface state is "held"');
  assertEquals(controlledHandlerExecutions, 0, 'Controlled handler has not executed');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 2: Correct Action Description & Risk Reasons Displayed
// =============================================================================
console.log('\n▶ Scenario 2: Correct Action Description & Risk Reasons Displayed');
{
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  const sensitiveAction: GuardrailAction = {
    id: 'workflow-action-scenario-2',
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: 'https://secure.example.com/admin', title: 'Admin Console' },
    element: {
      tagName: 'BUTTON',
      visibleText: 'Delete All Cloud Storage Backups',
    },
  };

  const classification = classifyAction(sensitiveAction);
  const risk = assessRisk(sensitiveAction, classification);
  const decision = decideResponse(risk);

  controller.register(sensitiveAction, 'Registered');
  const heldRecord = controller.holdAction(sensitiveAction.id, 'Held');

  const context = createStagingActionContext({
    action: sensitiveAction,
    interception: heldRecord,
    risk,
    classification,
    decision,
  });

  showStagingModal({ context, state: 'active', controller, continuationManager });
  const shadow = getStagingModalShadowRoot()!;

  // Verify description in .gs-action-desc
  const descEl = shadow.querySelector('.gs-action-desc');
  assert(descEl?.textContent.includes('Delete All Cloud Storage Backups') || false, 'Safe action description is prominently displayed');

  // Verify risk badge
  const riskBadge = shadow.querySelector('.gs-risk-badge');
  assert(riskBadge !== null, 'Risk badge is rendered');
  assert(riskBadge?.textContent.includes(context.riskLevel) || false, 'Risk badge displays correct risk level');

  // Verify risk reasons
  const reasonItems = shadow.querySelectorAll('.gs-reason-item');
  assert(reasonItems.length > 0, 'Risk reasons list rendered in risk card');

  // Verify website origin display
  assert(shadow.textContent.includes('secure.example.com'), 'Safe website hostname displayed');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 3: Missing Optional Metadata Handled Gracefully
// =============================================================================
console.log('\n▶ Scenario 3: Missing Optional Metadata Handled Gracefully');
{
  const sparseAction: GuardrailAction = {
    id: 'workflow-action-scenario-3',
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: '', title: '' }, // empty URL and title
    // element completely omitted
  };

  const classification = classifyAction(sparseAction);
  const risk = assessRisk(sparseAction, classification);
  const decision = decideResponse(risk);

  const controller = new InterceptionController();
  controller.register(sparseAction, 'Sparse registration');
  const held = controller.holdAction(sparseAction.id, 'Held');

  const sparseContext = createStagingActionContext({
    action: sparseAction,
    interception: held,
    risk,
    classification,
    decision,
  });

  assert(sparseContext.description.length > 0, 'Graceful fallback action description generated');
  assert(sparseContext.category !== undefined, 'Graceful category fallback provided');

  // Mount modal with sparse context
  showStagingModal({ context: sparseContext, state: 'active' });
  const shadow = getStagingModalShadowRoot();
  assert(shadow !== null, 'Modal mounts successfully without optional metadata');

  const descEl = shadow!.querySelector('.gs-action-desc');
  assert(descEl?.textContent.length! > 0, 'Summary description rendered from fallback');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 4: Selecting Cancel Successfully Cancels the Held Action
// =============================================================================
console.log('\n▶ Scenario 4: Selecting Cancel Successfully Cancels the Held Action');
{
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  const cancelActionId = 'workflow-action-scenario-4';
  const cancelAction: GuardrailAction = {
    id: cancelActionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };

  controller.register(cancelAction, 'Registered');
  controller.holdAction(cancelActionId, 'Held');

  const context = createSampleContext({
    actionId: cancelActionId,
    interceptionState: InterceptionState.HELD,
  });

  let onCancelSuccessFired = false;
  showStagingModal({
    context,
    state: 'active',
    controller,
    continuationManager,
    onCancelSuccess: () => {
      onCancelSuccessFired = true;
    },
  });

  const shadow = getStagingModalShadowRoot()!;
  const cancelBtn = shadow.querySelector('#gs-btn-cancel-action') as any;

  // User clicks Cancel Action
  cancelBtn.click();

  assertEquals(onCancelSuccessFired, true, 'onCancelSuccess callback fired');
  assertEquals(controller.getRecord(cancelActionId)?.state, InterceptionState.CANCELLED, 'Interception record transitioned to CANCELLED');
  assertEquals(getStagingUIState(), 'cancelled', 'UI state transitioned to "cancelled"');

  const banner = shadow.querySelector('.gs-confirmation-success');
  assert(banner !== null, 'Success confirmation banner is rendered');
  assert(banner?.textContent.includes('Action cancelled. Nothing was changed.') || false, 'Accurate cancellation confirmation text displayed');

  const pill = shadow.querySelector('.gs-mode-pill');
  assertEquals(pill?.textContent, 'Cancelled', 'Header mode pill indicates Cancelled');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 5: Cancelling an Action Does NOT Execute Protected Handler
// =============================================================================
console.log('\n▶ Scenario 5: Cancelling Action Does NOT Execute Protected Handler');
{
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  let protectedHandlerInvocations = 0;
  const cancelActionId5 = 'workflow-action-scenario-5';
  const cancelAction5: GuardrailAction = {
    id: cancelActionId5,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };

  controller.register(cancelAction5, 'Registered');
  const held = controller.holdAction(cancelActionId5, 'Held');

  continuationManager.registerHeldAction(cancelAction5, held, () => {
    protectedHandlerInvocations++;
  });

  const context = createSampleContext({
    actionId: cancelActionId5,
    interceptionState: InterceptionState.HELD,
  });

  showStagingModal({ context, state: 'active', controller, continuationManager });
  const shadow = getStagingModalShadowRoot()!;
  const cancelBtn = shadow.querySelector('#gs-btn-cancel-action') as any;

  cancelBtn.click();

  assertEquals(protectedHandlerInvocations, 0, 'Protected handler invocation count strictly ZERO after cancellation');
  assertEquals(continuationManager.getExecutionCount(cancelActionId5), 0, 'ContinuationManager execution count is 0');
  assertEquals(continuationManager.getCurrentHeldAction(), null, 'Held action cleared from ContinuationManager');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 6: Request Approval Produces Only Intended Local Event
// =============================================================================
console.log('\n▶ Scenario 6: Request Approval Produces Only Intended Local Event');
{
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  const approvalActionId = 'workflow-action-scenario-6';
  const approvalAction: GuardrailAction = {
    id: approvalActionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: 'https://test.example.com', title: 'Test Page' },
    element: {
      tagName: 'BUTTON',
      visibleText: 'Send Money',
    },
  };

  controller.register(approvalAction, 'Registered');
  controller.holdAction(approvalActionId, 'Held');

  const context = createSampleContext({
    actionId: approvalActionId,
    interceptionState: InterceptionState.HELD,
  });

  let capturedEventDetail: any = null;
  const eventListener = (e: any) => {
    capturedEventDetail = e.detail;
  };
  mockDoc.addEventListener('guardrail:approval-requested', eventListener);

  showStagingModal({ context, state: 'active', controller, continuationManager });
  const shadow = getStagingModalShadowRoot()!;
  const reqBtn = shadow.querySelector('#gs-btn-request-approval') as any;

  // User clicks Request Approval
  reqBtn.click();

  assert(capturedEventDetail !== null, 'DOM event "guardrail:approval-requested" was dispatched');
  assertEquals(capturedEventDetail.actionId, approvalActionId, 'Event carries correct actionId');
  assertEquals(capturedEventDetail.isBackendConnected, false, 'Event accurately states backend is not connected');

  const intent = capturedEventDetail.intent;
  assert(intent !== undefined, 'Typed ApprovalRequestIntent produced');
  assertEquals(intent.actionId, approvalActionId, 'Intent matches actionId');
  assertEquals(intent.status, 'LOCAL_PROTOTYPE_ONLY', 'Intent status is strictly "LOCAL_PROTOTYPE_ONLY"');
  assertEquals(intent.type, 'GUARDRAIL_APPROVAL_REQUEST_INTENT', 'Intent type is "GUARDRAIL_APPROVAL_REQUEST_INTENT"');

  mockDoc.removeEventListener('guardrail:approval-requested', eventListener);
  dismissStagingModal();
}

// =============================================================================
// SCENARIO 7: Honest Boundary — No Fictitious Caretaker Claims
// =============================================================================
console.log('\n▶ Scenario 7: Honest Boundary — No Fictitious Caretaker Claims');
{
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  const testActionId7 = 'workflow-action-scenario-7';
  const testAction7: GuardrailAction = {
    id: testActionId7,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };

  controller.register(testAction7, 'Registered');
  controller.holdAction(testActionId7, 'Held');

  const context = createSampleContext({
    actionId: testActionId7,
    interceptionState: InterceptionState.HELD,
  });

  showStagingModal({ context, state: 'active', controller, continuationManager });
  const shadow = getStagingModalShadowRoot()!;
  const reqBtn = shadow.querySelector('#gs-btn-request-approval') as any;

  reqBtn.click();

  const allText = shadow.textContent;
  assert(!allText.includes('Request sent'), 'Modal does NOT claim "Request sent"');
  assert(!allText.includes('Caretaker notified'), 'Modal does NOT claim "Caretaker notified"');
  assert(!allText.includes('Caretaker has been notified'), 'Modal does NOT claim "Caretaker has been notified"');
  assert(!allText.includes('Approved'), 'Modal does NOT claim "Approved"');

  const banner = shadow.querySelector('.gs-confirmation-info');
  assert(banner !== null, 'Info confirmation banner rendered');
  assert(banner?.textContent.includes('Approval Request Prepared (Local Prototype)') || false, 'Banner headline confirms Local Prototype');
  assert(banner?.textContent.includes('not connected') || false, 'Banner clearly explains prototype limitation');

  const footerNotice = shadow.querySelector('.gs-footer-notice');
  assert(footerNotice?.textContent.includes('Backend not connected') || false, 'Footer notice confirms backend not connected');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 8: Request Approval Does NOT Release or Execute Action
// =============================================================================
console.log('\n▶ Scenario 8: Request Approval Does NOT Release or Execute Action');
{
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  let handlerCalls8 = 0;
  const testActionId8 = 'workflow-action-scenario-8';
  const testAction8: GuardrailAction = {
    id: testActionId8,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };

  controller.register(testAction8, 'Registered');
  const held = controller.holdAction(testActionId8, 'Held');

  continuationManager.registerHeldAction(testAction8, held, () => {
    handlerCalls8++;
  });

  const context = createSampleContext({
    actionId: testActionId8,
    interceptionState: InterceptionState.HELD,
  });

  showStagingModal({ context, state: 'active', controller, continuationManager });
  const shadow = getStagingModalShadowRoot()!;
  const reqBtn = shadow.querySelector('#gs-btn-request-approval') as any;

  reqBtn.click();

  assertEquals(handlerCalls8, 0, 'Handler execution strictly 0 after request approval');
  assertEquals(controller.getRecord(testActionId8)?.state, InterceptionState.HELD, 'Record state remains strictly HELD');

  // Cancel button MUST remain enabled so user can cancel afterwards
  const cancelBtn = shadow.querySelector('#gs-btn-cancel-action') as any;
  assertEquals(cancelBtn.disabled, false, 'Cancel button is active after approval intent recorded');

  // User subsequently clicks Cancel
  cancelBtn.click();

  assertEquals(controller.getRecord(testActionId8)?.state, InterceptionState.CANCELLED, 'Action successfully cancelled after approval request');
  assertEquals(handlerCalls8, 0, 'Handler was NEVER executed throughout whole lifecycle');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 9: Repeated Clicks Prevent Duplicate Operations & Execution
// =============================================================================
console.log('\n▶ Scenario 9: Repeated Clicks Prevent Duplicate Operations & Execution');
{
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  let handlerCalls9 = 0;
  const testActionId9 = 'workflow-action-scenario-9';
  const testAction9: GuardrailAction = {
    id: testActionId9,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };

  controller.register(testAction9, 'Registered');
  const held = controller.holdAction(testActionId9, 'Held');

  continuationManager.registerHeldAction(testAction9, held, () => {
    handlerCalls9++;
  });

  const context = createSampleContext({
    actionId: testActionId9,
    interceptionState: InterceptionState.HELD,
  });

  let cancelCallbackCount = 0;
  showStagingModal({
    context,
    state: 'active',
    controller,
    continuationManager,
    onCancelSuccess: () => {
      cancelCallbackCount++;
    },
  });

  const shadow = getStagingModalShadowRoot()!;
  const cancelBtn = shadow.querySelector('#gs-btn-cancel-action') as any;

  // Simulate 5 rapid clicks
  cancelBtn.click();
  cancelBtn.click();
  cancelBtn.click();
  cancelBtn.click();
  cancelBtn.click();

  assertEquals(cancelCallbackCount, 1, 'onCancelSuccess callback fired exactly ONCE despite rapid repeated clicks');
  assertEquals(handlerCalls9, 0, 'Handler execution strictly 0 during repeated clicks');
  assertEquals(controller.getRecord(testActionId9)?.state, InterceptionState.CANCELLED, 'Action transitioned to CANCELLED');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 10: Invalid, Stale, or Resolved Records Handled Safely
// =============================================================================
console.log('\n▶ Scenario 10: Invalid, Stale, or Resolved Records Handled Safely');
{
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  let handlerCalls10 = 0;
  const staleActionId = 'workflow-action-scenario-10';
  const staleAction: GuardrailAction = {
    id: staleActionId,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };

  controller.register(staleAction, 'Registered');
  const held = controller.holdAction(staleActionId, 'Held');

  continuationManager.registerHeldAction(staleAction, held, () => {
    handlerCalls10++;
  });

  // Action already transitioned to CONTINUED outside modal
  controller.continueAction(staleActionId, 'Already continued');

  let errorFired = false;
  showStagingModal({
    context: createSampleContext({
      actionId: staleActionId,
      interceptionState: InterceptionState.CONTINUED,
    }),
    state: 'active',
    controller,
    continuationManager,
    onCancelError: () => {
      errorFired = true;
    },
  });

  const shadow = getStagingModalShadowRoot()!;
  const cancelBtn = shadow.querySelector('#gs-btn-cancel-action') as any;

  // User attempts to cancel already-continued action
  cancelBtn.click();

  assertEquals(errorFired, true, 'Cancellation rejected with error callback for stale record');
  assertEquals(handlerCalls10, 0, 'Handler was NOT executed when operation was rejected');
  assertEquals(getStagingUIState(), 'stale_or_invalid', 'UI state transitioned to "stale_or_invalid"');

  const errorBanner = shadow.querySelector('.gs-confirmation-error');
  assert(errorBanner !== null, 'Error confirmation banner rendered for invalid state');

  const pill = shadow.querySelector('.gs-mode-pill');
  assertEquals(pill?.textContent, 'Operation Unavailable', 'Mode pill displays "Operation Unavailable"');
  assertEquals(cancelBtn.disabled, true, 'Cancel button permanently disabled');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 11: Privacy — No Exposure of Passwords, Tokens, or Form Data
// =============================================================================
console.log('\n▶ Scenario 11: Privacy — No Exposure of Passwords, Tokens, or Form Data');
{
  const sensitiveAction11: GuardrailAction = {
    id: 'workflow-action-scenario-11',
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: 'https://auth.example.com/login?token=supersecrettoken123', title: 'Login' },
    element: {
      tagName: 'BUTTON',
      visibleText: 'Sign In',
    },
  };

  const classification = classifyAction(sensitiveAction11);
  const risk = assessRisk(sensitiveAction11, classification);
  const decision = decideResponse(risk);

  const controller = new InterceptionController();
  controller.register(sensitiveAction11, 'Registered');
  const held = controller.holdAction(sensitiveAction11.id, 'Held');

  const context = createStagingActionContext({
    action: sensitiveAction11,
    interception: held,
    risk,
    classification,
    decision,
  });

  const intent = createApprovalRequestIntent(context, held);

  // Assert context and intent do not leak sensitive values
  const serializedContext = JSON.stringify(context);
  const serializedIntent = JSON.stringify(intent);

  assert(!serializedContext.includes('supersecrettoken123'), 'Staging context excludes URL tokens');
  assert(!serializedIntent.includes('supersecrettoken123'), 'Approval intent excludes URL tokens');

  showStagingModal({ context, state: 'active' });
  const shadow = getStagingModalShadowRoot()!;
  const domText = shadow.textContent;

  assert(!domText.includes('supersecrettoken123'), 'Rendered modal excludes URL tokens');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 12: Safe Text Rendering — HTML Injection / XSS Resistance
// =============================================================================
console.log('\n▶ Scenario 12: Safe Text Rendering — HTML Injection / XSS Resistance');
{
  const maliciousAction: GuardrailAction = {
    id: '<script>window.xss=1</script>',
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: {
      url: 'javascript:alert("pwned")',
      title: '<img src=x onerror=alert(1)>Malicious Page',
    },
    element: {
      tagName: 'BUTTON',
      visibleText: '<svg/onload=alert("svg")> Click Me',
    },
  };

  const classification = classifyAction(maliciousAction);
  const risk = assessRisk(maliciousAction, classification);
  const decision = decideResponse(risk);

  const controller = new InterceptionController();
  controller.register(maliciousAction, 'Malicious Registered');
  const held = controller.holdAction(maliciousAction.id, 'Held');

  const context = createStagingActionContext({
    action: maliciousAction,
    interception: held,
    risk,
    classification,
    decision,
  });

  showStagingModal({ context, state: 'active' });
  const shadow = getStagingModalShadowRoot()!;

  // Verify that dangerous tags were NOT created in the shadow DOM tree
  const scriptTags = shadow.querySelectorAll('script');
  const imgTags = shadow.querySelectorAll('img');
  const svgTags = shadow.querySelectorAll('svg');

  assertEquals(scriptTags.length, 0, 'Zero <script> tags injected into modal');
  assertEquals(imgTags.length, 0, 'Zero <img> tags injected into modal');
  assertEquals(svgTags.length, 0, 'Zero <svg> tags injected into modal');

  // Verify safe host URL handling
  assert(!shadow.textContent.includes('javascript:'), 'Dangerous javascript: URL protocol not displayed');

  dismissStagingModal();
}

// =============================================================================
// SCENARIO 13: Clean Modal Lifecycle — No Duplicate Panels or Orphan Listeners
// =============================================================================
console.log('\n▶ Scenario 13: Clean Modal Lifecycle — No Duplicate Panels or Orphan Listeners');
{
  const context13 = createSampleContext({ actionId: 'workflow-action-scenario-13' });

  // Call showStagingModal multiple times consecutively
  showStagingModal({ context: context13, state: 'active' });
  showStagingModal({ context: context13, state: 'active' });
  showStagingModal({ context: context13, state: 'active' });

  const hosts = mockDoc.body.querySelectorAll(`#${STAGING_HOST_ELEMENT_ID}`);
  assertEquals(hosts.length, 1, 'Exactly ONE host element in document body despite repeated calls');

  // Dismiss modal
  dismissStagingModal();
  assertEquals(isStagingModalActive(), false, 'Modal inactive after dismissal');
  assertEquals(mockDoc.getElementById(STAGING_HOST_ELEMENT_ID), null, 'Host element removed from DOM');

  // Re-open and dismiss with close button
  showStagingModal({ context: context13, state: 'active' });
  const shadow = getStagingModalShadowRoot()!;
  const closeBtn = shadow.querySelector('.gs-btn-close') as any;
  closeBtn.click();

  assertEquals(isStagingModalActive(), false, 'Modal dismissed via close button click');
}

// =============================================================================
// SCENARIO 14: Canonical State Machine & Accidental Execution Audit
// =============================================================================
console.log('\n▶ Scenario 14: Canonical State Machine & Accidental Execution Audit');
{
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);

  let handlerCalls14 = 0;
  const testActionId14 = 'workflow-action-scenario-14';
  const testAction14: GuardrailAction = {
    id: testActionId14,
    type: ActionType.CLICK,
    timestamp: '2026-10-13T12:00:00.000Z',
    page: { url: 'https://test.example.com', title: 'Test' },
  };

  controller.register(testAction14, 'Registered');
  const held = controller.holdAction(testActionId14, 'Held');

  continuationManager.registerHeldAction(testAction14, held, () => {
    handlerCalls14++;
  });

  // Verify single canonical state machine:
  assertEquals(held.state, InterceptionState.HELD, 'InterceptionController is canonical source of truth');

  // Direct modal cancel call
  const dummyBtn = mockDoc.createElement('BUTTON') as any;
  const result = handleModalCancel(testActionId14, { controller, continuationManager }, {
    cancelBtn: dummyBtn,
    body: mockDoc.createElement('DIV') as any,
    header: mockDoc.createElement('HEADER') as any,
  });

  assertEquals(result.success, true, 'handleModalCancel successfully cancelled action');
  assertEquals(controller.getRecord(testActionId14)?.state, InterceptionState.CANCELLED, 'InterceptionController record is CANCELLED');
  assertEquals(handlerCalls14, 0, 'Protected handler execution count strictly ZERO');

  // Re-cancelling must fail and NOT invoke handler
  const duplicateResult = handleModalCancel(testActionId14, { controller, continuationManager }, {
    cancelBtn: dummyBtn,
    body: mockDoc.createElement('DIV') as any,
    header: mockDoc.createElement('HEADER') as any,
  });

  assertEquals(duplicateResult.success, false, 'Second cancellation attempt correctly rejected');
  assertEquals(handlerCalls14, 0, 'Protected handler execution remains strictly ZERO');
}

// =============================================================================
// SUMMARY & PROCESS EXIT
// =============================================================================
console.log('\n============================================================');
console.log(`TOTAL WORKFLOW VERIFICATION TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
}
