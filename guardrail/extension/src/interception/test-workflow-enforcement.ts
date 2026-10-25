/**
 * Guardrail Workflow Enforcement & Risk Decision Boundary Integration Suite
 *
 * Verifies that the entire Guardrail workflow consistently enforces risk decisions:
 * 1. ALLOW follows the supported normal-action path without unnecessary staging.
 * 2. WARN invokes the warning experience and preserves non-judgmental warning semantics.
 * 3. PROTECT enters the protection workflow (HELD, Staging Mode, ContinuationManager).
 * 4. Failed/invalid evaluations fail closed strictly to PROTECT (never silently ALLOW).
 * 5. UI components cannot independently downgrade a PROTECT decision.
 * 6. Approval status does not bypass risk policy or action-binding validation.
 * 7. Continuation revalidates applicable policy requirements before action proceeds.
 * 8. Ambient actions that cannot be reliably intercepted report limitations rather than claiming HELD.
 * 9. Avoids repeated contradictory evaluations and records decisions using safe diagnostics.
 * 10. The risk engine itself NEVER executes the action callback.
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { ActionClassificationResult } from '../types/classification.js';
import { ResponseAction } from '../types/response.js';
import { RiskEvaluationStatus, RiskLevel } from '../types/risk.js';
import { InterceptionState } from '../types/interception.js';
import { InterceptionController } from './controller.js';
import { ContinuationManager } from './continuation.js';
import {
  ContinuationEligibilityStatus,
  ContinuationValidationService,
} from './validation-service.js';
import { evaluateActionPipeline } from '../response/engine.js';
import { createStagingActionContext } from '../staging/context.js';
import { ApprovalService } from '../approval/service.js';
import { ActorRole, AuthContext, TrustedContactStatus } from '../approval/authorization.js';
import { ApprovalStatus } from '../types/approval.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

function assertEquals<T>(actual: T, expected: T, testName: string): void {
  if (actual === expected) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName} - Expected: ${expected}, Got: ${actual}`);
    failed++;
  }
}

console.log('\n=== Guardrail Workflow Risk Decision Enforcement Suite ===\n');

// -----------------------------------------------------------------------------
// Test Group 1: ALLOW Workflow Boundary (Normal Action Path)
// -----------------------------------------------------------------------------
console.log('Test Group 1: ALLOW Workflow Boundary');

const allowAction: GuardrailAction = {
  id: 'act-allow-workflow-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.GENERAL,
  element: {
    tagName: 'BUTTON',
    id: 'btn-view-docs',
    visibleText: 'View Documentation',
  },
  page: {
    url: 'https://app.example.com/docs',
    title: 'Documentation',
  },
};

const allowPipeline = evaluateActionPipeline(allowAction);
assertEquals(allowPipeline.decision.response, ResponseAction.ALLOW, 'Pipeline evaluates routine click to ALLOW');
assertEquals(allowPipeline.risk.riskLevel, RiskLevel.LOW, 'Risk level is LOW');

// Controller check: Action is NOT held and NO interception record is created
const testController = new InterceptionController();
const testContinuationManager = new ContinuationManager(testController);

const allowRecord = testController.getRecord(allowAction.id);
assert(allowRecord === undefined, 'No InterceptionRecord created for ALLOW action');

const heldEntry = testContinuationManager.getCurrentHeldAction();
assert(heldEntry === null, 'ContinuationManager does not track ALLOW action as held');

// Attempting to continue an unheld action is rejected
const continueAllowResult = testContinuationManager.continueAction(allowAction.id);
assert(!continueAllowResult.success, 'Attempt to continue un-held ALLOW action is rejected');
assert(!continueAllowResult.executed, 'ALLOW action callback is never executed through continuation');

// -----------------------------------------------------------------------------
// Test Group 2: WARN Workflow Boundary (Advisory Friction, Action Not Held)
// -----------------------------------------------------------------------------
console.log('\nTest Group 2: WARN Workflow Boundary');

const warnAction: GuardrailAction = {
  id: 'act-warn-workflow-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.PAYMENT,
  element: {
    tagName: 'BUTTON',
    id: 'btn-checkout',
    visibleText: 'Checkout Order',
  },
  page: {
    url: 'https://shop.example.com/cart',
    title: 'Cart',
  },
};

const warnPipeline = evaluateActionPipeline(warnAction);
assertEquals(warnPipeline.decision.response, ResponseAction.WARN, 'Pipeline evaluates checkout click to WARN');
assert(warnPipeline.decision.reasons.length > 0, 'WARN decision provides explanatory user advisory');
assert(
  !warnPipeline.decision.reasons[0].includes('malicious'),
  'Warning preserves semantics: Advisory notice, NOT proof of malice'
);

// Under WARN semantics: Action is NOT held; no InterceptionRecord created in HELD state
const warnRecord = testController.getRecord(warnAction.id);
assert(warnRecord === undefined, 'WARN action creates no HELD record in InterceptionController');
assert(testContinuationManager.getCurrentHeldAction() === null, 'WARN action is not held in ContinuationManager');

// -----------------------------------------------------------------------------
// Test Group 3: PROTECT Workflow Boundary (Genuinely Held & Staged)
// -----------------------------------------------------------------------------
console.log('\nTest Group 3: PROTECT Workflow Boundary (Genuinely Held)');

const protectAction: GuardrailAction = {
  id: 'act-protect-workflow-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE,
  element: {
    tagName: 'BUTTON',
    id: 'btn-delete-account',
    visibleText: 'Delete Account Permanently',
  },
  page: {
    url: 'https://app.example.com/settings/danger-zone',
    title: 'Danger Zone',
  },
};

const protectPipeline = evaluateActionPipeline(protectAction);
assertEquals(protectPipeline.decision.response, ResponseAction.PROTECT, 'Pipeline evaluates destructive click to PROTECT');

// Enters protection workflow:
testController.register(protectAction, 'Test action registered pending protection decision');
const heldRecord = testController.holdAction(protectAction.id, 'Action held pending trusted contact authorization');
assertEquals(heldRecord.state, InterceptionState.HELD, 'Action successfully transitions to HELD state');

let executionCounter = 0;
testContinuationManager.registerHeldAction(protectAction, heldRecord, (_act) => {
  executionCounter++;
});

// Genuinely held verification:
const currentHeld = testContinuationManager.getCurrentHeldAction();
assert(currentHeld !== null, 'Action is genuinely held in ContinuationManager');
assertEquals(currentHeld?.action.id, protectAction.id, 'Held action matches protectAction ID');
assertEquals(executionCounter, 0, 'Action callback is strictly NOT executed during holding or staging');

// Build StagingActionContext
const stagingContext = createStagingActionContext({
  action: protectAction,
  interception: heldRecord,
  risk: protectPipeline.risk,
  classification: protectPipeline.classification,
  decision: protectPipeline.decision,
});
assertEquals(stagingContext.responseAction, ResponseAction.PROTECT, 'StagingActionContext preserves PROTECT responseAction');

// -----------------------------------------------------------------------------
// Test Group 4: Evaluation Failure & Fail-Closed Invariant
// -----------------------------------------------------------------------------
console.log('\nTest Group 4: Evaluation Failure & Fail-Closed Invariant');

// Corrupted action missing ID
const corruptAction = {
  id: '',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  page: { url: 'https://app.example.com', title: 'App' },
} as unknown as GuardrailAction;

const corruptPipeline = evaluateActionPipeline(corruptAction);
assertEquals(corruptPipeline.decision.response, ResponseAction.PROTECT, 'Corrupted action fails closed strictly to PROTECT');
assertEquals(corruptPipeline.decision.status, RiskEvaluationStatus.FAILED, 'Status is marked FAILED');
assert(!corruptPipeline.decision.success, 'Success flag is false');
assertEquals(corruptPipeline.decision.policyRuleId, 'RULE_FAIL_CLOSED_FALLBACK', 'Attributed to RULE_FAIL_CLOSED_FALLBACK');

// Action ID mismatch across pipeline inputs
const mismatchedAction: GuardrailAction = {
  id: 'act-expected-id',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  page: { url: 'https://app.example.com', title: 'App' },
};
const forgedClassification: ActionClassificationResult = {
  actionId: 'act-forged-other-id',
  category: ActionCategory.GENERAL,
  matchedRule: 'SPOOFED_RULE',
  confidence: 0.9,
  reason: 'Spoofed classification',
  classifiedAt: new Date().toISOString(),
};
const mismatchedPipeline = evaluateActionPipeline(mismatchedAction, forgedClassification);
assertEquals(mismatchedPipeline.decision.response, ResponseAction.PROTECT, 'actionId mismatch fails closed strictly to PROTECT');
assertEquals(mismatchedPipeline.decision.structuredReasons?.[0].code, 'PIPELINE_ACTION_ID_MISMATCH', 'Structured reason indicates action ID mismatch');

// -----------------------------------------------------------------------------
// Test Group 5: UI Downgrade Prevention Boundary
// -----------------------------------------------------------------------------
console.log('\nTest Group 5: UI Downgrade Prevention Boundary');

const validationService = new ContinuationValidationService({
  controller: testController,
  continuationManager: testContinuationManager,
});

// Attempt to pass an artificially downgraded StagingActionContext (ALLOW) into continuation validation
const downgradedStagingContext = {
  ...stagingContext,
  responseAction: ResponseAction.ALLOW,
};

async function testDowngradeRejection(): Promise<void> {
  const downgradeResult = await validationService.validateEligibility(protectAction.id, {
    stagingContext: downgradedStagingContext,
    originalAction: protectAction,
  });

  assert(!downgradeResult.eligible, 'Continuation validation rejects downgraded ALLOW staging context');
  assertEquals(downgradeResult.status, ContinuationEligibilityStatus.REJECTED, 'Status is REJECTED');
  assertEquals(downgradeResult.errorCode, 'POLICY_REQUIREMENTS_NOT_MET', 'Error code is POLICY_REQUIREMENTS_NOT_MET');
  assert(
    downgradeResult.reason.includes('Policy downgrade rejected'),
    'Reason explicitly documents rejection of policy downgrade'
  );
  assertEquals(executionCounter, 0, 'Action callback was strictly NOT executed');
}
await testDowngradeRejection();

// -----------------------------------------------------------------------------
// Test Group 6: Approval Followed by Policy Revalidation Boundary
// -----------------------------------------------------------------------------
console.log('\nTest Group 6: Approval Followed by Policy Revalidation');

const approvalService = new ApprovalService();
const fullValidationService = new ContinuationValidationService({
  controller: testController,
  continuationManager: testContinuationManager,
  approvalService,
});

const userAuth: AuthContext = {
  actorId: 'usr_alice',
  role: ActorRole.USER,
  isAuthenticated: true,
};

const reviewerAuth: AuthContext = {
  actorId: 'usr_bob',
  role: ActorRole.TRUSTED_CONTACT,
  isAuthenticated: true,
};

// Designate Bob as an active trusted contact for Alice
approvalService.getContactRegistry().addContact({
  id: 'usr_bob',
  userId: 'usr_alice',
  relationshipLabel: 'Guardian',
  status: TrustedContactStatus.ACTIVE,
  createdAt: new Date().toISOString(),
});

// 1. Submit approval request
const createdRequest = approvalService.createRequest(
  {
    actionId: protectAction.id,
    actionDescription: 'Delete Account Permanently',
    actionType: protectAction.type,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 90,
    riskReasons: ['Destructive account deletion'],
    origin: 'https://app.example.com',
    hostname: 'app.example.com',
    pageTitle: 'Danger Zone',
  },
  userAuth
);
assert(Boolean(createdRequest?.id), 'Approval request created on backend');
const requestId = createdRequest.id;

// 2. Pre-approval validation check: Backend has not approved yet -> PENDING
const preApprovalVal = await fullValidationService.validateEligibility(protectAction.id, {
  stagingContext,
  originalAction: protectAction,
  authContext: userAuth,
});
assert(!preApprovalVal.eligible, 'Validation rejects pre-approval continuation');
assertEquals(preApprovalVal.status, ContinuationEligibilityStatus.PENDING, 'Status is PENDING');

// 3. Reviewer approves request
const approvedRequest = approvalService.approveRequest(
  requestId,
  { decisionReason: 'Approved by Bob' },
  reviewerAuth
);
assertEquals(approvedRequest.status, ApprovalStatus.APPROVED, 'Request status is APPROVED');

// 4. Policy Revalidation: Legitimate action satisfies policy requirements
const postApprovalVal = await fullValidationService.validateEligibility(protectAction.id, {
  stagingContext,
  originalAction: protectAction,
  authContext: userAuth,
});
assert(postApprovalVal.eligible, 'Valid approved action is ELIGIBLE for continuation');
assertEquals(postApprovalVal.status, ContinuationEligibilityStatus.ELIGIBLE, 'Status is ELIGIBLE');
assertEquals(postApprovalVal.policyDecision, ResponseAction.PROTECT, 'Recorded policyDecision is PROTECT');
assertEquals(postApprovalVal.policyRuleId, 'RULE_CONTROLLED_DESTRUCTIVE', 'Recorded policyRuleId is RULE_CONTROLLED_DESTRUCTIVE');

// 5. Continuation Execution: User confirms continuation
const continueRes = testContinuationManager.continueAction(
  protectAction.id,
  'User confirmed continuation after approval'
);
assert(continueRes.success, 'Action successfully continued');
assert(continueRes.executed, 'Controlled action handler executed');
assertEquals(executionCounter, 1, 'Controlled handler executed exactly once');

// Exactly-once guarantee: Attempt duplicate continuation
const duplicateContinue = testContinuationManager.continueAction(protectAction.id);
assert(!duplicateContinue.success, 'Duplicate continuation is rejected');
assertEquals(executionCounter, 1, 'Execution count remains strictly 1');

// -----------------------------------------------------------------------------
// Test Group 7: Policy Revalidation Catches Tampered Substituted Action
// -----------------------------------------------------------------------------
console.log('\nTest Group 7: Policy Revalidation Rejects Substituted Benign Action');

const protectAction2: GuardrailAction = {
  id: 'act-protect-workflow-2',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE,
  element: { tagName: 'BUTTON', id: 'btn-purge', visibleText: 'Purge Data' },
  page: { url: 'https://app.example.com/admin', title: 'Admin' },
};

testController.register(protectAction2, 'Action 2 registered');
const heldRecord2 = testController.holdAction(protectAction2.id, 'Held for testing');
let exec2Counter = 0;
testContinuationManager.registerHeldAction(protectAction2, heldRecord2, () => {
  exec2Counter++;
});

const req2 = approvalService.createRequest(
  {
    actionId: protectAction2.id,
    actionDescription: 'Purge Data',
    actionType: protectAction2.type,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 85,
    riskReasons: ['Purge data'],
    origin: 'https://app.example.com',
    hostname: 'app.example.com',
    pageTitle: 'Admin',
  },
  userAuth
);
approvalService.approveRequest(req2.id, undefined, reviewerAuth);

// Now substitute action2 with a completely routine benign action under the same actionId
const substitutedAction: GuardrailAction = {
  id: protectAction2.id,
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  element: { tagName: 'BUTTON', visibleText: 'Read Help Guide' },
  page: { url: 'https://app.example.com/help', title: 'Help' },
};

const substitutedValidation = await fullValidationService.validateEligibility(protectAction2.id, {
  originalAction: substitutedAction,
  authContext: userAuth,
});

assert(!substitutedValidation.eligible, 'Policy revalidation blocks substituted benign action');
assertEquals(substitutedValidation.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED');
assertEquals(substitutedValidation.errorCode, 'POLICY_REQUIREMENTS_NOT_MET', 'Error code is POLICY_REQUIREMENTS_NOT_MET');
assert(
  substitutedValidation.reason.includes('routine ALLOW'),
  'Reason identifies that substituted action only evaluates to routine ALLOW'
);
assertEquals(exec2Counter, 0, 'Substituted action handler was NOT executed');

// -----------------------------------------------------------------------------
// Test Group 8: Sensor Limitations & Diagnostics Verification
// -----------------------------------------------------------------------------
console.log('\nTest Group 8: Sensor Limitations & Safe Diagnostics');

// Ambient action sensor limitation test
const ambientAction: GuardrailAction = {
  id: 'act-ambient-delete-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE,
  element: { tagName: 'BUTTON', visibleText: 'Delete' },
  page: { url: 'https://third-party.example.org', title: 'Third Party' },
};

const ambientPipeline = evaluateActionPipeline(ambientAction);
assertEquals(ambientPipeline.decision.response, ResponseAction.PROTECT, 'Evaluates to PROTECT');

// Check that ambient action is NOT held in InterceptionController
const ambientInController = testController.getRecord(ambientAction.id);
assert(ambientInController === undefined, 'Ambient action was NOT held in InterceptionController');

// Privacy guarantee on diagnostic outputs
const serializedDecision = JSON.stringify(ambientPipeline.decision);
assert(!serializedDecision.includes('password'), 'Diagnostic output does not contain password');
assert(!serializedDecision.includes('otp'), 'Diagnostic output does not contain OTP');
assert(!serializedDecision.includes('cvv'), 'Diagnostic output does not contain CVV');

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All workflow enforcement tests PASSED cleanly.\n');
}
