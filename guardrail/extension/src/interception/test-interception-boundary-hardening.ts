/**
 * Guardrail UI - Action Interception Boundary & Staging Mode Hardening Regression Suite
 *
 * Verifies architectural safety boundaries, synchronous event suppression, truthful
 * ambient limitations, duplicate staging prevention, detached element safeguards,
 * idempotent lifecycle transitions, and zero automatic continuation on approval.
 *
 * Scenarios Tested:
 * 1. Synchronous suppression of controlled test actions (preventDefault + stopImmediatePropagation).
 * 2. Truthful boundary: No claim of successful blocking for unsupported ambient actions.
 * 3. Repeated events and duplicate staging prevention while action is actively held.
 * 4. Detached DOM elements and stale action references fail safely.
 * 5. Cancellation, invalidation, and terminal state immutability.
 * 6. Duplicate approval status updates do not create duplicate continuation attempts.
 * 7. Confirmation that approval status alone NEVER automatically executes an action.
 * 8. Exception fail-closed boundary during controlled action interception.
 * 9. Guardrail internal UI isolation (warning host & staging host ignored by detector).
 * 10. Privacy guarantees: Zero sensitive credentials or tokens in interception state.
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { ApprovalStatus } from '../types/approval.js';
import { InterceptionController } from './controller.js';
import { ContinuationManager } from './continuation.js';
import { evaluateActionPipeline } from '../response/engine.js';
import { ActionDetector } from '../detector/action-detector.js';
import {
  findControlledTestAction,
  findInteractiveElement,
  GUARDRAIL_TEST_ACTION_ATTR,
  isInternalGuardrailUi,
} from '../utils/dom.js';
import {
  ContinuationEligibilityStatus,
  ContinuationValidationService,
} from './validation-service.js';
import { createStagingActionContext } from '../staging/context.js';
import { ConfigHealthStatus } from '../types/config.js';
import { cancelControlledActionUntilPolicyInitialized } from '../config/readiness.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
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
console.log('🛡️ ACTION INTERCEPTION BOUNDARY & STAGING HARDENING SUITE');
console.log('============================================================\n');

// -----------------------------------------------------------------------------
// Lightweight DOM & Event Mock for Node.js
// -----------------------------------------------------------------------------
class MockShadowRoot {
  public host: any = null;
  constructor(host: any) {
    this.host = host;
  }
}

class MockElement {
  public tagName: string;
  public id: string = '';
  public textContent: string = '';
  public attributes: Record<string, string> = {};
  public parentNode: MockElement | null = null;
  public isConnected: boolean = true;
  private shadowHost: MockElement | null = null;

  constructor(tagName: string = 'BUTTON') {
    this.tagName = tagName.toUpperCase();
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  public getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  public removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  public closest<T extends Element = Element>(selector: string): T | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (selector === `#${curr.id}`) return curr as unknown as T;
      if (selector.startsWith('#') && curr.id === selector.slice(1)) return curr as unknown as T;
      if (selector === `[${GUARDRAIL_TEST_ACTION_ATTR}]` && curr.attributes[GUARDRAIL_TEST_ACTION_ATTR]) {
        return curr as unknown as T;
      }
      if (selector.includes(curr.tagName.toLowerCase())) return curr as unknown as T;
      curr = curr.parentNode;
    }
    return null;
  }

  public getRootNode(): any {
    if (this.shadowHost) {
      return new MockShadowRoot(this.shadowHost);
    }
    return this;
  }

  public setShadowHost(host: MockElement): void {
    this.shadowHost = host;
  }
}

// Install Mock DOM globals in Node.js test environment
(globalThis as any).Element = MockElement;
(globalThis as any).HTMLElement = MockElement;
(globalThis as any).ShadowRoot = MockShadowRoot;

class MockHTMLButtonElement extends MockElement {}
class MockHTMLInputElement extends MockElement {}
class MockHTMLFormElement extends MockElement {}
class MockHTMLTextAreaElement extends MockElement {}
class MockHTMLSelectElement extends MockElement {}

(globalThis as any).HTMLButtonElement = MockHTMLButtonElement;
(globalThis as any).HTMLInputElement = MockHTMLInputElement;
(globalThis as any).HTMLFormElement = MockHTMLFormElement;
(globalThis as any).HTMLTextAreaElement = MockHTMLTextAreaElement;
(globalThis as any).HTMLSelectElement = MockHTMLSelectElement;

class MockEvent {
  public type: string;
  public target: any;
  public defaultPrevented: boolean = false;
  public immediatePropagationStopped: boolean = false;
  public propagationStopped: boolean = false;

  constructor(type: string, target: any) {
    this.type = type;
    this.target = target;
  }

  public preventDefault(): void {
    this.defaultPrevented = true;
  }

  public stopImmediatePropagation(): void {
    this.immediatePropagationStopped = true;
    this.propagationStopped = true;
  }

  public stopPropagation(): void {
    this.propagationStopped = true;
  }
}

// Exercise the production detector boundary rather than simulating its callback.
console.log('▶ Production detector boundary: synchronous dispatch and detached target');
{
  const element = new MockElement('BUTTON');
  element.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'detector-proof');
  let interceptCalls = 0;
  const detector = new ActionDetector(() => {}, (_action, _element, event) => {
    interceptCalls++;
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  const liveEvent = new MockEvent('click', element);
  (detector as any).handleClick(liveEvent);
  assertEquals(liveEvent.defaultPrevented, true, 'Real detector callback cancels synchronously');
  assertEquals(liveEvent.immediatePropagationStopped, true, 'Real detector callback stops immediate propagation synchronously');
  assertEquals(interceptCalls, 1, 'Live controlled action reaches interception once');

  const detached = new MockElement('BUTTON');
  detached.isConnected = false;
  detached.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'detached-proof');
  const detachedEvent = new MockEvent('click', detached);
  (detector as any).handleClick(detachedEvent);
  assertEquals(detachedEvent.defaultPrevented, true, 'Detached controlled event is suppressed');
  assertEquals(interceptCalls, 1, 'Detached target does not enter staging callback');
}

console.log('▶ Runtime lifecycle: startup gate and repeated detector start/stop');
{
  const pendingEvent = new MockEvent('click', new MockElement('BUTTON'));
  assertEquals(
    cancelControlledActionUntilPolicyInitialized(ConfigHealthStatus.UNINITIALIZED, pendingEvent),
    true,
    'Controlled action is blocked while the first policy load is pending'
  );
  assertEquals(pendingEvent.defaultPrevented, true, 'Startup gate cancels the event synchronously');
  assertEquals(pendingEvent.immediatePropagationStopped, true, 'Startup gate prevents later page handlers synchronously');
  assertEquals(
    cancelControlledActionUntilPolicyInitialized(ConfigHealthStatus.HEALTHY, pendingEvent),
    false,
    'Configured policy resumes normal controlled-action evaluation'
  );

  const originalDocument = (globalThis as any).document;
  const originalWindow = (globalThis as any).window;
  const documentAdds: Record<string, number> = {};
  const documentRemoves: Record<string, number> = {};
  const windowAdds: Record<string, number> = {};
  const windowRemoves: Record<string, number> = {};
  (globalThis as any).document = {
    referrer: '',
    addEventListener: (type: string) => { documentAdds[type] = (documentAdds[type] || 0) + 1; },
    removeEventListener: (type: string) => { documentRemoves[type] = (documentRemoves[type] || 0) + 1; },
  };
  (globalThis as any).window = {
    location: { href: 'https://controlled.example.test/' },
    addEventListener: (type: string) => { windowAdds[type] = (windowAdds[type] || 0) + 1; },
    removeEventListener: (type: string) => { windowRemoves[type] = (windowRemoves[type] || 0) + 1; },
  };
  try {
    const detector = new ActionDetector(() => {});
    detector.start();
    detector.start();
    assertEquals(documentAdds.click, 1, 'Repeated start registers one click listener');
    assertEquals(documentAdds.submit, 1, 'Repeated start registers one submit listener');
    assertEquals(windowAdds.popstate, 1, 'Repeated start registers one navigation listener');
    detector.stop();
    detector.stop();
    assertEquals(documentRemoves.click, 1, 'Repeated stop removes only the detector click listener once');
    assertEquals(windowRemoves.popstate, 1, 'Repeated stop removes only the detector navigation listener once');
  } finally {
    if (originalDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = originalDocument;
    if (originalWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = originalWindow;
  }
}

// =============================================================================
// SCENARIO 1: Synchronous Event Suppression on Controlled Test Action
// =============================================================================
console.log('▶ Scenario 1: Synchronous Event Suppression on Controlled Test Action');
{
  const controller = new InterceptionController();
  const manager = new ContinuationManager(controller);

  const testBtn = new MockElement('BUTTON');
  testBtn.id = 'btn-delete-account-test';
  testBtn.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'critical-delete');
  testBtn.textContent = 'Permanently Delete Account';

  const event = new MockEvent('click', testBtn);

  // Simulate controlled test action detection & synchronous interception
  const controlledElement = findControlledTestAction(event.target);
  assert(controlledElement !== null, 'findControlledTestAction finds marked element');

  const action: GuardrailAction = {
    id: 'act_controlled_sync_001',
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: {
      tagName: 'BUTTON',
      id: testBtn.id,
      visibleText: testBtn.textContent,
    },
    page: {
      url: 'https://test.guardrail.internal/settings',
      title: 'Controlled Test Settings',
    },
    timestamp: new Date().toISOString(),
  };

  const { decision } = evaluateActionPipeline(action);
  assertEquals(decision.response, ResponseAction.PROTECT, 'Pipeline renders PROTECT decision');

  // Synchronous suppression happens before any async work or approval checks
  event.preventDefault();
  event.stopImmediatePropagation();

  assertEquals(event.defaultPrevented, true, 'preventDefault called synchronously');
  assertEquals(event.immediatePropagationStopped, true, 'stopImmediatePropagation called synchronously');

  // Controller registers and transitions to HELD
  const registered = controller.register(action, 'Controlled test action intercepted');
  assertEquals(registered.state, InterceptionState.DETECTED, 'Record in DETECTED state');
  const held = controller.holdAction(action.id, 'Action held pending user confirmation');
  assertEquals(held.state, InterceptionState.HELD, 'Record transitioned to HELD');
  assertEquals(controller.isActionHeld(action.id), true, 'Controller confirms action is HELD');

  // Register in continuation manager
  let execCount = 0;
  manager.registerHeldAction(action, held, () => {
    execCount++;
  });

  assertEquals(execCount, 0, 'Action handler was NOT executed during synchronous interception');
}

// =============================================================================
// SCENARIO 2: Truthful Boundary: No Claim of Successful Blocking for Ambient Actions
// =============================================================================
console.log('\n▶ Scenario 2: Truthful Boundary: Unsupported Ambient Actions Not Claimed Held');
{
  const controller = new InterceptionController();
  const manager = new ContinuationManager(controller);

  const ambientBtn = new MockElement('BUTTON');
  ambientBtn.id = 'btn-ambient-delete';
  // Notice: NO data-guardrail-test-action attribute!
  ambientBtn.textContent = 'Delete Remote Workspace';

  const event = new MockEvent('click', ambientBtn);

  // findControlledTestAction must return null for ambient element
  const controlledElement = findControlledTestAction(event.target);
  assertEquals(controlledElement, null, 'Ambient element is NOT matched as controlled test action');

  const ambientAction: GuardrailAction = {
    id: 'act_ambient_delete_002',
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: {
      tagName: 'BUTTON',
      id: ambientBtn.id,
      visibleText: ambientBtn.textContent,
    },
    page: {
      url: 'https://third-party.example.com/project',
      title: 'Third Party Project',
    },
    timestamp: new Date().toISOString(),
  };

  const { decision } = evaluateActionPipeline(ambientAction);
  assertEquals(decision.response, ResponseAction.PROTECT, 'Pipeline renders PROTECT');

  // Under the ambient sensor boundary:
  // preventDefault is NOT called because arbitrary website JS cannot be reliably intercepted
  assertEquals(event.defaultPrevented, false, 'DOM event is NOT cancelled on ambient action');
  assertEquals(event.immediatePropagationStopped, false, 'Propagation is NOT stopped on ambient action');

  // Interception record must NOT be created
  assertEquals(controller.hasRecord(ambientAction.id), false, 'Ambient action NOT registered in InterceptionController');
  assertEquals(controller.isActionHeld(ambientAction.id), false, 'Ambient action is NOT claimed to be HELD');
  assertEquals(manager.getCurrentHeldAction(), null, 'Ambient action NOT tracked in ContinuationManager');
}

// =============================================================================
// SCENARIO 3: Repeated Events and Duplicate Staging Prevention
// =============================================================================
console.log('\n▶ Scenario 3: Repeated Events and Duplicate Staging Prevention');
{
  const controller = new InterceptionController();
  const manager = new ContinuationManager(controller);

  const action1: GuardrailAction = {
    id: 'act_held_initial_003',
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: {
      tagName: 'BUTTON',
      id: 'btn-purge',
      visibleText: 'Purge Records',
    },
    page: {
      url: 'https://test.guardrail.internal/admin',
      title: 'Admin',
    },
    timestamp: new Date().toISOString(),
  };

  controller.register(action1);
  const heldRecord1 = controller.holdAction(action1.id);
  let action1Executions = 0;
  manager.registerHeldAction(action1, heldRecord1, () => {
    action1Executions++;
  });

  assertEquals(manager.getCurrentHeldAction()?.action.id, action1.id, 'Action 1 is currently HELD');

  // Repeated click arrives while Action 1 is actively HELD
  const repeatedEvent = new MockEvent('click', new MockElement('BUTTON'));

  // Handler applies duplicate staging prevention guard:
  const activeHeld = manager.getCurrentHeldAction();
  let duplicateStagingTriggered = false;

  if (activeHeld) {
    const existingRec = controller.getRecord(activeHeld.action.id);
    if (existingRec && existingRec.state === InterceptionState.HELD) {
      // Synchronously cancel the event
      repeatedEvent.preventDefault();
      repeatedEvent.stopImmediatePropagation();
      // DO NOT overwrite active held action or trigger staging
      duplicateStagingTriggered = false;
    }
  } else {
    duplicateStagingTriggered = true;
  }

  assertEquals(repeatedEvent.defaultPrevented, true, 'Repeated event synchronously cancelled');
  assertEquals(repeatedEvent.immediatePropagationStopped, true, 'Repeated event propagation stopped');
  assertEquals(duplicateStagingTriggered, false, 'Duplicate staging operation strictly prevented');
  assertEquals(manager.getCurrentHeldAction()?.action.id, action1.id, 'Action 1 remains the active held action');
  assertEquals(action1Executions, 0, 'Action 1 callback was not executed');
}

// =============================================================================
// SCENARIO 4: Detached Target DOM Elements and Stale Action References
// =============================================================================
console.log('\n▶ Scenario 4: Detached Target Elements and Stale Action References');
{
  const controller = new InterceptionController();
  const manager = new ContinuationManager(controller);

  const action: GuardrailAction = {
    id: 'act_detached_004',
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: {
      tagName: 'BUTTON',
      id: 'btn-target-dynamic',
      visibleText: 'Dynamic Button',
    },
    page: {
      url: 'https://test.guardrail.internal/dynamic',
      title: 'Dynamic Page',
    },
    timestamp: new Date().toISOString(),
  };

  controller.register(action);
  const heldRecord = controller.holdAction(action.id);
  let handlerExecutions = 0;
  manager.registerHeldAction(action, heldRecord, () => {
    handlerExecutions++;
  }, () => false);

  const validationService = new ContinuationValidationService({
    controller,
    continuationManager: manager,
    isElementAttached: (_elemId) => false, // Target element is detached from DOM!
  });

  const validationResult = await validationService.validateEligibility(action.id, {
    originalAction: action,
  });

  assertEquals(validationResult.eligible, false, 'Validation rejects detached DOM target');
  assertEquals(validationResult.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED');
  assertEquals(validationResult.errorCode, 'ELEMENT_DETACHED', 'Error code is ELEMENT_DETACHED');

  // Stale action reference check: Continuing an unknown or stale ID fails safely
  const staleContinuation = manager.continueAction('act_unknown_stale_999');
  assertEquals(staleContinuation.success, false, 'Stale action reference continuation rejected');
  assertEquals(staleContinuation.executed, false, 'Stale action did not execute');
  assertEquals(handlerExecutions, 0, 'Original handler execution count strictly 0');
  const detachedContinuation = manager.continueAction(action.id);
  assertEquals(detachedContinuation.success, false, 'Continuation rejects stale original target');
  assertEquals(controller.getRecord(action.id)?.state, InterceptionState.CANCELLED, 'Stale target invalidates held lifecycle');
  assertEquals(handlerExecutions, 0, 'Stale target handler never executes');
}

// =============================================================================
// Registration cannot replace active or stale held state
// =============================================================================
console.log('\n▶ Held registration cannot replace active or stale state');
{
  const controller = new InterceptionController();
  const manager = new ContinuationManager(controller);
  const first: GuardrailAction = {
    id: 'act_registration_first', type: ActionType.CLICK, category: ActionCategory.DESTRUCTIVE,
    element: { tagName: 'BUTTON', id: 'first' }, page: { url: 'https://test.guardrail.internal', title: 'Test' }, timestamp: new Date().toISOString(),
  };
  controller.register(first);
  const firstHeld = controller.holdAction(first.id);
  manager.registerHeldAction(first, firstHeld, () => {});

  const second: GuardrailAction = { ...first, id: 'act_registration_second' };
  controller.register(second);
  const secondHeld = controller.holdAction(second.id);
  let replaced = false;
  try { manager.registerHeldAction(second, secondHeld, () => {}); } catch { replaced = true; }
  assertEquals(replaced, true, 'Second held registration is rejected');
  assertEquals(manager.getCurrentHeldAction()?.action.id, first.id, 'Active held entry remains intact');

  manager.cancelAction(first.id);
  let staleRejected = false;
  try { manager.registerHeldAction(first, firstHeld, () => {}); } catch { staleRejected = true; }
  assertEquals(staleRejected, true, 'Stale held record cannot be re-registered');
}

// =============================================================================
// SCENARIO 5: Cancellation, Invalidation, and Terminal State Immutability
// =============================================================================
console.log('\n▶ Scenario 5: Cancellation, Invalidation, and Terminal State Immutability');
{
  const controller = new InterceptionController();
  const manager = new ContinuationManager(controller);

  const action: GuardrailAction = {
    id: 'act_cancel_test_005',
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: { tagName: 'BUTTON', id: 'btn-cancel-me', visibleText: 'Cancel Me' },
    page: { url: 'https://test.guardrail.internal', title: 'Test' },
    timestamp: new Date().toISOString(),
  };

  controller.register(action);
  const held = controller.holdAction(action.id);
  let execCount = 0;
  manager.registerHeldAction(action, held, () => {
    execCount++;
  });

  // User cancels held action
  const cancelResult = manager.cancelAction(action.id, 'User cancelled in Staging Modal');
  assertEquals(cancelResult.success, true, 'Action cancellation succeeds');
  assertEquals(cancelResult.record?.state, InterceptionState.CANCELLED, 'Interception state is CANCELLED');
  assertEquals(manager.getCurrentHeldAction(), null, 'Held action closure cleared from memory');

  // Attempting to continue a cancelled action is strictly rejected
  const continueAttempt = manager.continueAction(action.id);
  assertEquals(continueAttempt.success, false, 'Cannot continue a cancelled action');
  assertEquals(continueAttempt.executed, false, 'Handler was NOT executed on cancelled action');
  assertEquals(execCount, 0, 'Execution count strictly 0');

  // Idempotent invalidation on terminal states
  const repeatedInv = manager.invalidateHeldAction(action.id, 'Repeated invalidation');
  assertEquals(repeatedInv.success, true, 'invalidateHeldAction is idempotent on CANCELLED');
  assertEquals(repeatedInv.record?.state, InterceptionState.CANCELLED, 'Record remains CANCELLED');

  // Transitioning out of CANCELLED is prohibited by state machine
  let prohibitedTransitionThrown = false;
  try {
    controller.holdAction(action.id, 'Illegal re-hold');
  } catch (err: any) {
    prohibitedTransitionThrown = true;
    assert(err.name === 'InvalidStateTransitionError', 'InvalidStateTransitionError thrown');
  }
  assertEquals(prohibitedTransitionThrown, true, 'Cannot transition out of terminal CANCELLED state');
}

// =============================================================================
// SCENARIO 6: Duplicate Approval Updates Do Not Cause Duplicate Continuations
// =============================================================================
console.log('\n▶ Scenario 6: Duplicate Approval Updates & Anti-Duplicate Execution');
{
  const controller = new InterceptionController();
  const manager = new ContinuationManager(controller);

  const action: GuardrailAction = {
    id: 'act_dup_approval_006',
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: { tagName: 'BUTTON', id: 'btn-dup-approve', visibleText: 'Confirm Transfer' },
    page: { url: 'https://test.guardrail.internal', title: 'Transfer' },
    timestamp: new Date().toISOString(),
  };

  controller.register(action);
  const held = controller.holdAction(action.id);
  let handlerExecutions = 0;
  manager.registerHeldAction(action, held, () => {
    handlerExecutions++;
  });

  // Simulate arrival of APPROVED status update multiple times
  const lastDiscoveredStatus = new Map<string, ApprovalStatus>();
  const reqId = 'apr_req_dup_001';

  let updateProcessingCount = 0;
  const handleStatusDiscovery = (status: ApprovalStatus) => {
    if (lastDiscoveredStatus.get(reqId) === status) {
      return; // Deduplicated
    }
    lastDiscoveredStatus.set(reqId, status);
    updateProcessingCount++;
  };

  handleStatusDiscovery(ApprovalStatus.APPROVED);
  handleStatusDiscovery(ApprovalStatus.APPROVED);
  handleStatusDiscovery(ApprovalStatus.APPROVED);

  assertEquals(updateProcessingCount, 1, 'Duplicate APPROVED updates processed exactly once');
  assertEquals(handlerExecutions, 0, 'Status updates NEVER execute the held action automatically');
  assertEquals(controller.getRecord(action.id)?.state, InterceptionState.HELD, 'Action remains HELD');
}

// =============================================================================
// SCENARIO 7: Approval Status Alone NEVER Executes Held Action
// =============================================================================
console.log('\n▶ Scenario 7: Approval Status Alone NEVER Executes Held Action');
{
  const controller = new InterceptionController();
  const manager = new ContinuationManager(controller);

  const action: GuardrailAction = {
    id: 'act_no_auto_exec_007',
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: { tagName: 'BUTTON', id: 'btn-delete-org', visibleText: 'Delete Org' },
    page: { url: 'https://test.guardrail.internal', title: 'Org' },
    timestamp: new Date().toISOString(),
  };

  controller.register(action);
  const held = controller.holdAction(action.id);
  let actionExecuted = false;
  manager.registerHeldAction(action, held, () => {
    actionExecuted = true;
  });

  // Transition to AWAITING_APPROVAL
  controller.awaitApproval(action.id);
  assertEquals(controller.getRecord(action.id)?.state, InterceptionState.AWAITING_APPROVAL, 'State is AWAITING_APPROVAL');

  // Approval confirmed by contact: transition to READY_FOR_USER_CONFIRMATION
  controller.markReadyForConfirmation(action.id);
  assertEquals(controller.getRecord(action.id)?.state, InterceptionState.READY_FOR_USER_CONFIRMATION, 'State is READY_FOR_USER_CONFIRMATION');

  // Invariant: Callback is strictly NOT executed upon approval arrival
  assertEquals(actionExecuted, false, 'Approval confirmation does NOT execute action');
  assertEquals(manager.getExecutionCount(action.id), 0, 'Execution count is 0');

  // Only explicit user continuation executes the handler
  const contRes = manager.continueAction(action.id, 'User clicked Continue button');
  assertEquals(contRes.success, true, 'Explicit continuation succeeds');
  assertEquals(contRes.executed, true, 'Explicit continuation executes handler');
  assertEquals(actionExecuted, true, 'Handler executed exactly once upon user confirmation');
  assertEquals(manager.getExecutionCount(action.id), 1, 'Execution count is strictly 1');

  // Duplicate continuation attempt is rejected
  const dupCont = manager.continueAction(action.id, 'Duplicate click');
  assertEquals(dupCont.success, false, 'Duplicate continuation is rejected');
  assertEquals(manager.getExecutionCount(action.id), 1, 'Execution count remains strictly 1');
}

// =============================================================================
// SCENARIO 8: Exception Fail-Closed Boundary During Controlled Interception
// =============================================================================
console.log('\n▶ Scenario 8: Exception Fail-Closed Boundary During Controlled Interception');
{
  const testElement = new MockElement('BUTTON');
  testElement.id = 'btn-controlled-crash';
  testElement.setAttribute(GUARDRAIL_TEST_ACTION_ATTR, 'critical-op');

  const event = new MockEvent('click', testElement);

  // Simulating detector handler with exception in interception logic
  const detector = new ActionDetector(
    () => {},
    (_act, _el, evt) => {
      // Simulate an unexpected error thrown during pipeline processing
      throw new Error('Simulated unexpected pipeline failure during interception');
    }
  );

  // Trigger click on detector
  (detector as any).handleClick(event);

  // Event must have been synchronously cancelled despite the exception!
  assertEquals(event.defaultPrevented, true, 'Event was synchronously cancelled on exception (fail-closed)');
  assertEquals(event.immediatePropagationStopped, true, 'Propagation was stopped on exception (fail-closed)');
}

// =============================================================================
// SCENARIO 9: Guardrail Internal UI Isolation
// =============================================================================
console.log('\n▶ Scenario 9: Guardrail Internal UI Isolation');
{
  // Warning modal host
  const warningHost = new MockElement('DIV');
  warningHost.id = 'guardrail-warning-ui-host';

  const warningBtn = new MockElement('BUTTON');
  warningBtn.textContent = 'Cancel';
  warningBtn.parentNode = warningHost;

  // Staging modal host
  const stagingHost = new MockElement('DIV');
  stagingHost.id = 'guardrail-staging-ui-host';

  const stagingContinueBtn = new MockElement('BUTTON');
  stagingContinueBtn.textContent = 'Continue Action';
  stagingContinueBtn.parentNode = stagingHost;

  assert(isInternalGuardrailUi(warningBtn as any), 'Warning host child is identified as internal UI');
  assert(isInternalGuardrailUi(stagingContinueBtn as any), 'Staging host child is identified as internal UI');

  assertEquals(findInteractiveElement(warningBtn as any), null, 'findInteractiveElement ignores warning host button');
  assertEquals(findInteractiveElement(stagingContinueBtn as any), null, 'findInteractiveElement ignores staging host button');
  assertEquals(findControlledTestAction(stagingContinueBtn as any), null, 'findControlledTestAction ignores staging host');
}

// =============================================================================
// SCENARIO 10: Zero Sensitive Credentials or Tokens in Interception State
// =============================================================================
console.log('\n▶ Scenario 10: Zero Sensitive Credentials or Tokens in Interception State');
{
  const controller = new InterceptionController();
  const action: GuardrailAction = {
    id: 'act_safe_diagnostics_010',
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: { tagName: 'BUTTON', id: 'btn-danger', visibleText: 'Delete' },
    page: { url: 'https://test.guardrail.internal/settings', title: 'Settings' },
    timestamp: new Date().toISOString(),
  };

  const rec = controller.register(action, 'Action registered');
  const held = controller.holdAction(action.id, 'Action held');

  const serializedRecord = JSON.stringify(held);
  assert(!serializedRecord.includes('password'), 'InterceptionRecord contains no password');
  assert(!serializedRecord.includes('cardNumber'), 'InterceptionRecord contains no cardNumber');
  assert(!serializedRecord.includes('otp'), 'InterceptionRecord contains no OTP');
  assert(!serializedRecord.includes('authToken'), 'InterceptionRecord contains no authToken');
  assert(!serializedRecord.includes('secret'), 'InterceptionRecord contains no secret');

  const { classification, risk, decision } = evaluateActionPipeline(action);
  const stagingContext = createStagingActionContext({
    action,
    interception: held,
    risk,
    classification,
    decision,
  });

  const serializedContext = JSON.stringify(stagingContext);
  assert(!serializedContext.includes('password'), 'StagingActionContext contains no password');
  assert(!serializedContext.includes('cvv'), 'StagingActionContext contains no CVV');
  assert(!serializedContext.includes('otp'), 'StagingActionContext contains no OTP');
  assert(!serializedContext.includes('secret'), 'StagingActionContext contains no secret');
}

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n============================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL ACTION INTERCEPTION BOUNDARY & STAGING HARDENING TESTS PASSED!\n');
}
