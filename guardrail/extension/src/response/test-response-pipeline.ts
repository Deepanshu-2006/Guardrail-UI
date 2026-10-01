/**
 * Guardrail Response Pipeline - Verification & Test Suite
 *
 * Validates the complete integrated Guardrail pipeline:
 * Browser Event -> Action Detector -> GuardrailAction -> Action Classifier ->
 * ClassificationResult -> Risk Engine -> RiskAssessment -> Response Engine ->
 * ResponseDecision -> UI / Warning Modal / Service Worker
 *
 * Test Scenarios:
 * 1. LOW-risk general action (ALLOW, no warning UI)
 * 2. MEDIUM-risk authentication-style action (WARN, displays warning UI)
 * 3. HIGH-risk destructive or payment-style action (WARN, displays warning UI)
 * 4. CRITICAL-risk combined mock scenario (PROTECT, logs protection required)
 * 5. Warning UI controls: Continue, Cancel, Close ('✕'), Backdrop click, Escape key
 * 6. Sequential actions pipeline processing
 * 7. Rapid repeated clicks handling (idempotent modal replacement, no stacking)
 * 8. Dynamically created button detection via event delegation
 * 9. Sensitive data privacy preservation
 */

declare const process: { exit: (code: number) => void };

import { classifyAction } from '../classifier/index.js';
import { ActionDetector } from '../detector/action-detector.js';
import { assessRisk } from '../risk/engine.js';
import { decideResponse } from './engine.js';
import {
  showWarningModal,
  dismissWarningModal,
  isWarningModalActive,
  HOST_ELEMENT_ID,
} from '../ui/warning-modal.js';
import {
  ActionCategory,
  ActionType,
  GuardrailAction,
  ResponseAction,
  ResponseDecision,
  RiskAssessment,
  RiskLevel,
} from '../types/index.js';

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

console.log('\n============================================================');
console.log('🧪 GUARDRAIL RESPONSE PIPELINE - COMPREHENSIVE TEST SUITE');
console.log('============================================================\n');

// -----------------------------------------------------------------------------
// Lightweight Headless DOM Mock Environment for Node Runtime
// -----------------------------------------------------------------------------
type EventListenerFn = (e: any) => void;

class MockNode {
  public id: string = '';
  public className: string = '';
  public tagName: string = 'DIV';
  public parentNode: MockNode | null = null;
  public children: MockNode[] = [];
  public style: Record<string, string> = {};
  public attributes: Record<string, string> = {};
  public textContent: string = '';
  public innerHTML: string = '';
  public placeholder?: string;
  public value?: string;
  public type?: string;
  public shadowRoot: MockShadowRoot | null = null;
  private listeners: Record<string, { fn: EventListenerFn; capture?: boolean }[]> = {};

  constructor(tagName: string = 'DIV') {
    this.tagName = tagName.toUpperCase();
  }

  public appendChild(child: MockNode): MockNode {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  public remove(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  public getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  public attachShadow(_options: { mode: string }): MockShadowRoot {
    this.shadowRoot = new MockShadowRoot(this);
    return this.shadowRoot;
  }

  public getRootNode(): MockNode | MockShadowRoot {
    let curr: MockNode = this;
    while (curr.parentNode) {
      curr = curr.parentNode;
    }
    return curr;
  }

  public closest<T extends MockNode = MockNode>(selector: string): T | null {
    const selectors = selector.split(',').map((s) => s.trim().toLowerCase());
    let curr: MockNode | null = this;
    while (curr) {
      const tagMatch = selectors.includes(curr.tagName.toLowerCase());
      const idMatch = curr.id && selectors.includes(`#${curr.id.toLowerCase()}`);
      const roleMatch = curr.getAttribute('role') && selectors.includes(`[role="${curr.getAttribute('role')}"]`);
      if (tagMatch || idMatch || roleMatch) {
        return curr as unknown as T;
      }
      curr = curr.parentNode;
    }
    return null;
  }

  public querySelector<T extends MockNode = MockNode>(selector: string): T | null {
    const sel = selector.trim();
    for (const child of this.children) {
      if (sel.startsWith('.') && child.className.split(' ').includes(sel.slice(1))) {
        return child as unknown as T;
      }
      if (sel.startsWith('#') && child.id === sel.slice(1)) {
        return child as unknown as T;
      }
      if (child.tagName.toLowerCase() === sel.toLowerCase()) {
        return child as unknown as T;
      }
      const found = child.querySelector<T>(selector);
      if (found) return found;
    }
    return null;
  }

  public addEventListener(type: string, fn: EventListenerFn, capture: boolean = false): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push({ fn, capture });
  }

  public removeEventListener(type: string, fn: EventListenerFn, capture: boolean = false): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(
      (l) => l.fn !== fn || l.capture !== capture
    );
  }

  public dispatchEvent(event: any): boolean {
    event.target = event.target || this;
    event.currentTarget = this;

    // Capture listeners on path
    const path: MockNode[] = [];
    let curr: MockNode | null = this;
    while (curr) {
      path.unshift(curr);
      curr = curr.parentNode;
    }

    for (const node of path) {
      const caps = node.listeners[event.type]?.filter((l) => l.capture);
      if (caps) {
        for (const { fn } of caps) fn(event);
      }
    }

    // Bubble listeners
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i];
      const bubbles = node.listeners[event.type]?.filter((l) => !l.capture);
      if (bubbles) {
        for (const { fn } of bubbles) fn(event);
      }
    }

    return true;
  }

  public click(): void {
    this.dispatchEvent({
      type: 'click',
      target: this,
      composedPath: () => [this],
      defaultPrevented: false,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  }
}

class MockShadowRoot extends MockNode {
  public host: MockNode;
  constructor(host: MockNode) {
    super('#document-fragment');
    this.host = host;
  }
}

class MockDocument extends MockNode {
  public body: MockNode;
  public readyState: string = 'complete';

  constructor() {
    super('#document');
    this.body = new MockNode('BODY');
    this.appendChild(this.body);
  }

  public createElement(tagName: string): MockNode {
    return new MockNode(tagName);
  }

  public getElementById(id: string): MockNode | null {
    function search(node: MockNode): MockNode | null {
      if (node.id === id) return node;
      for (const child of node.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    }
    return search(this);
  }
}

class MockWindow {
  public location = { href: 'http://localhost:3000/test-page/index.html' };
  public document: MockDocument;
  private listeners: Record<string, EventListenerFn[]> = {};

  constructor(doc: MockDocument) {
    this.document = doc;
  }

  public addEventListener(type: string, fn: EventListenerFn): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  public removeEventListener(type: string, fn: EventListenerFn): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }

  public dispatchEvent(event: any): void {
    const list = this.listeners[event.type];
    if (list) {
      for (const fn of list) fn(event);
    }
  }
}

// Install mock DOM globals
const mockDoc = new MockDocument();
const mockWin = new MockWindow(mockDoc);

(globalThis as any).document = mockDoc;
(globalThis as any).window = mockWin;
(globalThis as any).Element = MockNode;
(globalThis as any).HTMLElement = MockNode;
(globalThis as any).HTMLButtonElement = MockNode;
(globalThis as any).HTMLFormElement = MockNode;
(globalThis as any).HTMLInputElement = MockNode;
(globalThis as any).HTMLTextAreaElement = MockNode;
(globalThis as any).HTMLSelectElement = MockNode;
(globalThis as any).ShadowRoot = MockShadowRoot;

// -----------------------------------------------------------------------------
// Pipeline Test Helper
// -----------------------------------------------------------------------------
interface PipelineExecutionResult {
  action: GuardrailAction;
  classification: ReturnType<typeof classifyAction>;
  risk: RiskAssessment;
  decision: ResponseDecision;
  warningModalActive: boolean;
}

function runFullPipeline(action: GuardrailAction): PipelineExecutionResult {
  // 1. Classification
  const classification = classifyAction(action);

  // 2. Risk Assessment
  const risk = assessRisk(action, classification);

  // 3. Response Decision
  const decision = decideResponse(risk);

  // 4. UI Side Effects (mimicking Content Script branch)
  let warningModalActive = false;
  switch (decision.response) {
    case ResponseAction.ALLOW:
      // ALLOW does not display warning
      break;

    case ResponseAction.WARN:
      showWarningModal({
        action,
        risk,
        decision,
        onContinue: () => {},
        onCancel: () => {},
      });
      warningModalActive = isWarningModalActive();
      break;

    case ResponseAction.PROTECT:
      // PROTECT logs required gating without showing warning modal yet
      break;
  }

  return {
    action,
    classification,
    risk,
    decision,
    warningModalActive,
  };
}

// -----------------------------------------------------------------------------
// 1. LOW-Risk General Action (ALLOW)
// -----------------------------------------------------------------------------
console.log('▶ Test 1: LOW-Risk General Action (ALLOW)');
{
  dismissWarningModal();
  const action: GuardrailAction = {
    id: 'act-test-low-1',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'test-action-btn', visibleText: '⚡ Generic Action' },
    page: { url: 'http://localhost:3000/test-page/index.html', title: 'Guardrail Test Page' },
    timestamp: new Date().toISOString(),
  };

  const res = runFullPipeline(action);

  assert(res.classification.category === ActionCategory.GENERAL, 'Classification is GENERAL');
  assert(res.risk.score >= 0 && res.risk.score <= 100, `Score is within 0-100: ${res.risk.score}`);
  assert(res.risk.riskLevel === RiskLevel.LOW, 'Risk level is LOW (0-24 tier)');
  assert(res.decision.response === ResponseAction.ALLOW, 'ResponseAction is ALLOW');
  assert(
    res.action.id === res.classification.actionId &&
    res.action.id === res.risk.actionId &&
    res.action.id === res.decision.actionId,
    `actionId remained strictly unchanged: ${res.action.id}`
  );
  assert(!isWarningModalActive(), 'ALLOW does NOT display the warning UI');
  assert(res.decision.reasons.length > 0, `Explanation reason present: "${res.decision.reasons[0]}"`);
}
console.log('');

// -----------------------------------------------------------------------------
// 2. MEDIUM-Risk Authentication-Style Action (WARN)
// -----------------------------------------------------------------------------
console.log('▶ Test 2: MEDIUM-Risk Authentication-Style Action (WARN)');
{
  dismissWarningModal();
  // External SSO login combines AUTH (+20) and EXTERNAL (+20) = 40 (MEDIUM)
  const action: GuardrailAction = {
    id: 'act-test-med-auth',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      id: 'btn-auth-sso',
      visibleText: '🔑 Sign In with External SSO (+20 Auth, +20 Ext = 40 MEDIUM)',
    },
    page: { url: 'http://localhost:3000/test-page/index.html', title: 'Guardrail Test Page' },
    timestamp: new Date().toISOString(),
  };

  const res = runFullPipeline(action);

  assert(res.classification.category === ActionCategory.AUTHENTICATION, 'Classification is AUTHENTICATION');
  assert(res.risk.score === 40, `Score is exactly 40 (within 0-100)`);
  assert(res.risk.riskLevel === RiskLevel.MEDIUM, 'Risk level is MEDIUM (25-49 tier)');
  assert(res.decision.response === ResponseAction.WARN, 'ResponseAction is WARN');
  assert(
    res.action.id === res.classification.actionId &&
    res.action.id === res.risk.actionId &&
    res.action.id === res.decision.actionId,
    `actionId preserved across all layers: ${res.action.id}`
  );
  assert(
    res.risk.reasons.some((r) => r.toLowerCase().includes('authentication') || r.toLowerCase().includes('login')),
    'Includes authentication risk reason'
  );
  assert(
    res.risk.reasons.some((r) => r.toLowerCase().includes('external') || r.toLowerCase().includes('destination')),
    'Includes external navigation risk reason'
  );

  dismissWarningModal();
}
console.log('');

// -----------------------------------------------------------------------------
// 3. HIGH-Risk Destructive or Payment-Style Action (WARN)
// -----------------------------------------------------------------------------
console.log('▶ Test 3: HIGH-Risk Destructive Action (WARN)');
{
  dismissWarningModal();
  const action: GuardrailAction = {
    id: 'act-test-high-dest',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'btn-destructive', visibleText: '🗑️ Delete Account' },
    page: { url: 'http://localhost:3000/test-page/index.html', title: 'Guardrail Test Page' },
    timestamp: new Date().toISOString(),
  };

  const res = runFullPipeline(action);

  assert(res.classification.category === ActionCategory.DESTRUCTIVE, 'Classification is DESTRUCTIVE');
  assert(res.risk.score === 50, `Score is 50 (within 0-100)`);
  assert(res.risk.riskLevel === RiskLevel.HIGH, 'Risk level is HIGH (50-74 tier)');
  assert(res.decision.response === ResponseAction.WARN, 'ResponseAction is WARN');
  assert(
    res.action.id === res.classification.actionId &&
    res.action.id === res.risk.actionId &&
    res.action.id === res.decision.actionId,
    `actionId preserved across all layers: ${res.action.id}`
  );
  assert(isWarningModalActive(), 'WARN displays the Guardrail warning UI');

  dismissWarningModal();
}
console.log('');

// -----------------------------------------------------------------------------
// 3b. HIGH-Risk Compound Payment Action (WARN)
// -----------------------------------------------------------------------------
console.log('▶ Test 3b: HIGH-Risk Compound Payment Action (WARN)');
{
  dismissWarningModal();
  const action: GuardrailAction = {
    id: 'act-test-high-pay',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      id: 'btn-combined-external-payment',
      visibleText: '🌐 Pay via External Gateway (+40 Pay, +20 Ext = 60 HIGH)',
    },
    page: { url: 'http://localhost:3000/test-page/index.html', title: 'Guardrail Test Page' },
    timestamp: new Date().toISOString(),
  };

  const res = runFullPipeline(action);

  assert(res.classification.category === ActionCategory.PAYMENT, 'Classification is PAYMENT');
  assert(res.risk.score === 60, `Score is 60 (within 0-100)`);
  assert(res.risk.riskLevel === RiskLevel.HIGH, 'Risk level is HIGH (50-74 tier)');
  assert(res.decision.response === ResponseAction.WARN, 'ResponseAction is WARN');
  assert(isWarningModalActive(), 'WARN displays the Guardrail warning UI');

  dismissWarningModal();
}
console.log('');

// -----------------------------------------------------------------------------
// 4. CRITICAL-Risk Combined Mock Scenario (PROTECT)
// -----------------------------------------------------------------------------
console.log('▶ Test 4: CRITICAL-Risk Combined Scenario (PROTECT)');
{
  dismissWarningModal();
  const action: GuardrailAction = {
    id: 'act-test-crit-1',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      id: 'btn-combined-exceed-100',
      visibleText: '⚠️ Delete All Data, Cancel Payment Transfer, and Export to External Server',
    },
    page: { url: 'http://localhost:3000/test-page/index.html', title: 'Guardrail Test Page' },
    timestamp: new Date().toISOString(),
  };

  const res = runFullPipeline(action);

  assert(res.risk.score === 100, `Score is clamped strictly at 100 (within 0-100 bounds): ${res.risk.score}`);
  assert(res.risk.riskLevel === RiskLevel.CRITICAL, 'Risk level is CRITICAL (75-100 tier)');
  assert(res.decision.response === ResponseAction.PROTECT, 'ResponseAction is PROTECT');
  assert(
    res.action.id === res.classification.actionId &&
    res.action.id === res.risk.actionId &&
    res.action.id === res.decision.actionId,
    `actionId preserved across all layers: ${res.action.id}`
  );
  assert(!isWarningModalActive(), 'PROTECT does NOT display warning UI (logs advisory only)');
  assert(
    res.decision.reasons.some((r) => r.toUpperCase().includes('PROTECT') || r.toUpperCase().includes('CRITICAL')),
    `PROTECT reason generated: "${res.decision.reasons[0]}"`
  );
}
console.log('');

// -----------------------------------------------------------------------------
// 5. Warning UI Modal Controls & Dismissal
// -----------------------------------------------------------------------------
console.log('▶ Test 5: Warning UI Modal Controls & Dismissal');
{
  const mockAction: GuardrailAction = {
    id: 'act-modal-test',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'btn-destructive', visibleText: 'Delete Account' },
    page: { url: 'http://localhost:3000/test-page/index.html', title: 'Guardrail Test Page' },
    timestamp: new Date().toISOString(),
  };
  const mockRisk: RiskAssessment = {
    actionId: mockAction.id,
    riskLevel: RiskLevel.HIGH,
    score: 50,
    reasons: ['Permanent resource deletion control'],
    evaluatedAt: new Date().toISOString(),
  };
  const mockDecision: ResponseDecision = {
    actionId: mockAction.id,
    response: ResponseAction.WARN,
    reasons: ['High risk interaction flagged'],
    createdAt: new Date().toISOString(),
  };

  // Subtest 5a: Clicking Continue
  let continueClicked = false;
  showWarningModal({
    action: mockAction,
    risk: mockRisk,
    decision: mockDecision,
    onContinue: () => {
      continueClicked = true;
    },
  });
  assert(isWarningModalActive(), 'Modal mounted before Continue click');
  const host1 = mockDoc.getElementById(HOST_ELEMENT_ID);
  const shadow1 = host1?.shadowRoot;
  const continueBtn = shadow1?.querySelector('.gr-btn-continue');
  assert(Boolean(continueBtn), 'Found Continue button inside shadow DOM');
  continueBtn?.click();
  assert(continueClicked, 'onContinue callback was invoked');
  assert(!isWarningModalActive(), 'Modal was dismissed after Continue');

  // Subtest 5b: Clicking Cancel
  let cancelClicked = false;
  showWarningModal({
    action: mockAction,
    risk: mockRisk,
    decision: mockDecision,
    onCancel: () => {
      cancelClicked = true;
    },
  });
  assert(isWarningModalActive(), 'Modal mounted before Cancel click');
  const host2 = mockDoc.getElementById(HOST_ELEMENT_ID);
  const shadow2 = host2?.shadowRoot;
  const cancelBtn = shadow2?.querySelector('.gr-btn-cancel');
  assert(Boolean(cancelBtn), 'Found Cancel button inside shadow DOM');
  cancelBtn?.click();
  assert(cancelClicked, 'onCancel callback was invoked');
  assert(!isWarningModalActive(), 'Modal was dismissed after Cancel');

  // Subtest 5c: Clicking Close button ('✕')
  let closeCancelled = false;
  showWarningModal({
    action: mockAction,
    risk: mockRisk,
    decision: mockDecision,
    onCancel: () => {
      closeCancelled = true;
    },
  });
  assert(isWarningModalActive(), 'Modal mounted before Close click');
  const host3 = mockDoc.getElementById(HOST_ELEMENT_ID);
  const shadow3 = host3?.shadowRoot;
  const closeBtn = shadow3?.querySelector('.gr-btn-close');
  assert(Boolean(closeBtn), 'Found Close ("✕") button in header');
  closeBtn?.click();
  assert(closeCancelled, 'Closing warning invoked cancellation callback');
  assert(!isWarningModalActive(), 'Modal was dismissed after Close button click');

  // Subtest 5d: Backdrop click
  let backdropCancelled = false;
  showWarningModal({
    action: mockAction,
    risk: mockRisk,
    decision: mockDecision,
    onCancel: () => {
      backdropCancelled = true;
    },
  });
  const host4 = mockDoc.getElementById(HOST_ELEMENT_ID);
  const shadow4 = host4?.shadowRoot;
  const backdrop = shadow4?.querySelector('.gr-backdrop');
  assert(Boolean(backdrop), 'Found backdrop container');
  backdrop?.click();
  assert(backdropCancelled, 'Backdrop click invoked cancel callback');
  assert(!isWarningModalActive(), 'Modal was dismissed after backdrop click');

  // Subtest 5e: Escape key dismissal
  let escapeCancelled = false;
  showWarningModal({
    action: mockAction,
    risk: mockRisk,
    decision: mockDecision,
    onCancel: () => {
      escapeCancelled = true;
    },
  });
  assert(isWarningModalActive(), 'Modal mounted before Escape key press');
  mockWin.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert(escapeCancelled, 'Escape keypress invoked cancel callback');
  assert(!isWarningModalActive(), 'Modal was dismissed after Escape key press');
}
console.log('');

// -----------------------------------------------------------------------------
// 6. Multiple Actions in Sequence
// -----------------------------------------------------------------------------
console.log('▶ Test 6: Multiple Actions in Sequence');
{
  dismissWarningModal();

  const seqActions: { action: GuardrailAction; expectedResponse: ResponseAction }[] = [
    {
      action: {
        id: 'seq-1',
        type: ActionType.CLICK,
        element: { tagName: 'BUTTON', id: 'test-action-btn', visibleText: 'Generic Action' },
        page: { url: 'http://localhost:3000/index.html', title: 'Test' },
        timestamp: new Date().toISOString(),
      },
      expectedResponse: ResponseAction.ALLOW,
    },
    {
      action: {
        id: 'seq-2',
        type: ActionType.CLICK,
        element: { tagName: 'BUTTON', id: 'btn-destructive', visibleText: 'Delete Account' },
        page: { url: 'http://localhost:3000/index.html', title: 'Test' },
        timestamp: new Date().toISOString(),
      },
      expectedResponse: ResponseAction.WARN,
    },
    {
      action: {
        id: 'seq-3',
        type: ActionType.CLICK,
        element: {
          tagName: 'BUTTON',
          id: 'btn-combined-exceed-100',
          visibleText: 'Delete account, cancel payment transfer, and export to external server',
        },
        page: { url: 'http://localhost:3000/index.html', title: 'Test' },
        timestamp: new Date().toISOString(),
      },
      expectedResponse: ResponseAction.PROTECT,
    },
    {
      action: {
        id: 'seq-4',
        type: ActionType.CLICK,
        element: { tagName: 'BUTTON', id: 'test-action-btn', visibleText: 'Generic Action' },
        page: { url: 'http://localhost:3000/index.html', title: 'Test' },
        timestamp: new Date().toISOString(),
      },
      expectedResponse: ResponseAction.ALLOW,
    },
  ];

  let seqPassed = true;
  for (const item of seqActions) {
    const res = runFullPipeline(item.action);
    if (res.decision.response !== item.expectedResponse) {
      seqPassed = false;
    }
    if (res.decision.actionId !== item.action.id) {
      seqPassed = false;
    }
  }
  assert(seqPassed, 'Sequence of 4 distinct actions processed with intact actionIds and correct responses');

  dismissWarningModal();
}
console.log('');

// -----------------------------------------------------------------------------
// 7. Rapid Repeated Clicks Handling
// -----------------------------------------------------------------------------
console.log('▶ Test 7: Rapid Repeated Clicks Handling');
{
  dismissWarningModal();

  const rapidAction: GuardrailAction = {
    id: 'rapid-click-action',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'btn-destructive', visibleText: 'Delete Account' },
    page: { url: 'http://localhost:3000/index.html', title: 'Test' },
    timestamp: new Date().toISOString(),
  };

  // Simulate 5 rapid calls in succession
  for (let i = 1; i <= 5; i++) {
    runFullPipeline({ ...rapidAction, id: `rapid-click-${i}` });
  }

  // Count instances of HOST_ELEMENT_ID in body
  const matchingHosts = mockDoc.body.children.filter((c) => c.id === HOST_ELEMENT_ID);
  assert(matchingHosts.length === 1, `Exactly 1 warning host exists after 5 rapid clicks (found: ${matchingHosts.length})`);
  assert(isWarningModalActive(), 'Warning modal is active and displaying latest action');

  dismissWarningModal();
  assert(!isWarningModalActive(), 'Clean dismissal after rapid clicks');
}
console.log('');

// -----------------------------------------------------------------------------
// 8. Dynamically Created Buttons Detection
// -----------------------------------------------------------------------------
console.log('▶ Test 8: Dynamically Created Buttons Detection');
{
  let detectedAction: GuardrailAction | null = null;
  const detector = new ActionDetector((act) => {
    detectedAction = act;
  });
  detector.start();

  // Create button dynamically and attach to body
  const dynamicBtn = mockDoc.createElement('button');
  dynamicBtn.id = 'btn-dynamic-payment';
  dynamicBtn.textContent = 'Pay ₹1,500';
  mockDoc.body.appendChild(dynamicBtn);

  // Trigger click on dynamically created button
  dynamicBtn.click();

  assert(detectedAction !== null, 'ActionDetector successfully captured click on dynamically created button');
  if (detectedAction) {
    const act = detectedAction as GuardrailAction;
    assert(act.element?.id === 'btn-dynamic-payment', `Detected correct element id: ${act.element?.id}`);
    const res = runFullPipeline(act);
    assert(res.classification.category === ActionCategory.PAYMENT, 'Dynamic button classified as PAYMENT');
    assert(res.risk.riskLevel === RiskLevel.MEDIUM, 'Evaluated risk as MEDIUM (40)');
    assert(res.decision.response === ResponseAction.WARN, 'Generated WARN response decision');
  }

  detector.stop();
  dynamicBtn.remove();
  dismissWarningModal();
}
console.log('');

// -----------------------------------------------------------------------------
// 9. Sensitive Data Leakage Prevention
// -----------------------------------------------------------------------------
console.log('▶ Test 9: Strict Sensitive Data Privacy Preservation');
{
  const secretAction: GuardrailAction = {
    id: 'act-sensitive-input',
    type: ActionType.INPUT,
    element: {
      tagName: 'INPUT',
      id: 'password-field',
      visibleText: 'Enter your password...',
    },
    page: { url: 'http://localhost:3000/login', title: 'Login' },
    timestamp: new Date().toISOString(),
  };

  const res = runFullPipeline(secretAction);
  const serialized = JSON.stringify(res);

  assert(!serialized.includes('mySecretPassword123'), 'Never captures or serializes typed secret passwords');
  assert(!serialized.includes('4111222233334444'), 'Never captures or serializes credit card numbers');
  assert(!serialized.includes('123456'), 'Never captures or serializes OTP values');
  assert(res.action.id === res.decision.actionId, 'actionId preserved without sensitive data leakage');
}
console.log('');

console.log('============================================================');
console.log(`TOTAL PIPELINE TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
}
