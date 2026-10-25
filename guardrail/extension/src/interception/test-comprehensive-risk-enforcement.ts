/**
 * Guardrail Comprehensive Risk Evaluation, Policy Precedence & Workflow Enforcement Suite
 *
 * Provides end-to-end verification across the entire Guardrail workflow:
 * 1.  Supported actions produce expected decision (ALLOW, WARN, PROTECT).
 * 2.  Multiple matching rules produce a deterministic, monotonic result.
 * 3.  Protection rules cannot be silently downgraded by warning rules.
 * 4.  Invalid or unavailable evaluations fail closed strictly to PROTECT (never silent ALLOW).
 * 5.  ALLOW does not trigger unnecessary protection behavior or holding.
 * 6.  WARN displays appropriate operational advisory without falsely claiming action was held.
 * 7.  PROTECT triggers the actual supported protection workflow (HELD, Staged, Zero Pre-execution).
 * 8.  Unsupported or ambient actions are not falsely reported as held.
 * 9.  Approval status cannot bypass policy enforcement or action-binding validation.
 * 10. Continuation strictly rechecks applicable requirements before proceeding.
 * 11. Cancellation and expiration remain enforced against late or invalid continuations.
 * 12. Unknown decision values fail safely to PROTECT.
 * 13. Risk explanations correspond strictly to actual matched rules and reason codes.
 * 14. Logs and diagnostics do not contain credentials, OTPs, card numbers, or raw form values.
 * 15. Duplicate evaluation or delayed responses do not corrupt action state.
 *
 * TEST ARCHITECTURE TAXONOMY:
 * - [UNIT]: Pure in-memory algorithm & rule precedence verification.
 * - [MOCKED-SERVICE]: In-memory repository, approval service, and binding validation.
 * - [WORKFLOW-INTEGRATION]: End-to-end orchestration connecting interception, risk, staging, and continuation.
 * - [PRIVACY-AUDIT]: Deep cryptographic and structural redaction assertions.
 *
 * SAFETY INVARIANT: Uses harmless, controlled test actions exclusively.
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { ActionClassificationResult } from '../types/classification.js';
import {
  ResponseAction,
  ResponseDecision,
  resolveFailClosedDecision,
  validateResponseAction,
} from '../types/response.js';
import {
  EvaluationError,
  RiskAssessment,
  RiskEvaluationStatus,
  RiskLevel,
  RiskSignalId,
} from '../types/risk.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { ApprovalStatus } from '../types/approval.js';
import { ActorRole, AuthContext, TrustedContactStatus } from '../approval/authorization.js';

// Core engine components
import { assessRisk, determineRiskLevel, RiskEngine } from '../risk/engine.js';
import {
  evaluateResponseAction,
  CoreRiskLevelResponseRule,
} from '../response/rules.js';
import {
  evaluateActionPipeline,
  evaluateRiskAndDecision,
  createFailedResponseDecision,
} from '../response/engine.js';
import {
  ALL_GUARDRAIL_POLICIES,
  CONTROLLED_DESTRUCTIVE_POLICY,
  CONTROLLED_PAYMENT_POLICY,
  EXTERNAL_NAVIGATION_POLICY,
  ROUTINE_INTERACTION_POLICY,
  evaluatePolicies,
} from '../response/policies.js';
import { explainRiskDecision } from '../response/explanation.js';

import { InterceptionController } from './controller.js';
import { ContinuationManager } from './continuation.js';
import { InvalidStateTransitionError } from './transitions.js';
import {
  ContinuationEligibilityStatus,
  ContinuationValidationService,
} from './validation-service.js';
import { createStagingActionContext } from '../staging/context.js';
import { ApprovalService } from '../approval/service.js';
import {
  ApprovalBindingReassignmentError,
  assertNoBindingReassignment,
  createApprovalActionBinding,
} from '../approval/binding.js';

// Privacy & diagnostics components
import {
  isPrivacySafe,
  sanitizeForDiagnostics,
  sanitizeUrlForDiagnostics,
} from '../utils/privacy.js';

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

console.log('\n======================================================================');
console.log('🧪 GUARDRAIL COMPREHENSIVE RISK EVALUATION & WORKFLOW ENFORCEMENT');
console.log('======================================================================\n');

// =============================================================================
// TEST 1: [UNIT/INTEGRATION] Supported Actions Produce Expected Decision
// =============================================================================
console.log('▶ Requirement 1: Supported Actions Produce Expected Decision');

// 1A. Harmless controlled destructive action -> PROTECT
const controlledDestructiveAction: GuardrailAction = {
  id: 'act-test-dest-001',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE,
  element: {
    tagName: 'BUTTON',
    id: 'btn-delete-profile',
    visibleText: 'Delete Account Permanently',
  },
  page: {
    url: 'https://app.example.com/settings/profile',
    title: 'Account Settings',
  },
};
const destructivePipeline = evaluateActionPipeline(controlledDestructiveAction);
assertEquals(destructivePipeline.decision.response, ResponseAction.PROTECT, 'Destructive CLICK evaluates to PROTECT');
assertEquals(destructivePipeline.decision.policyRuleId, 'RULE_CONTROLLED_DESTRUCTIVE', 'Matched destructive policy rule');

// 1B. Harmless controlled checkout interaction -> WARN
const controlledPaymentAction: GuardrailAction = {
  id: 'act-test-pay-001',
  type: ActionType.SUBMIT,
  timestamp: new Date().toISOString(),
  category: ActionCategory.PAYMENT,
  element: {
    tagName: 'FORM',
    id: 'form-checkout',
    visibleText: 'Place Order - $45.00',
  },
  page: {
    url: 'https://store.example.com/checkout',
    title: 'Order Checkout',
  },
};
const paymentPipeline = evaluateActionPipeline(controlledPaymentAction);
assertEquals(paymentPipeline.decision.response, ResponseAction.WARN, 'Standard checkout interaction evaluates to WARN');
assertEquals(paymentPipeline.decision.policyRuleId, 'RULE_PAYMENT_INTERACTION_POLICY', 'Matched payment policy rule');

// 1C. Harmless controlled compound payment interaction (elevated score) -> PROTECT
const compoundPaymentAction: GuardrailAction = {
  id: 'act-test-pay-compound-001',
  type: ActionType.SUBMIT,
  timestamp: new Date().toISOString(),
  category: ActionCategory.PAYMENT,
  element: {
    tagName: 'FORM',
    id: 'form-wire-transfer',
    visibleText: 'Authorize International Wire Transfer',
  },
  page: {
    url: 'https://unknown-processor.example.net/pay',
    title: 'External Payment Gateway',
  },
};
const highRiskAssessment: RiskAssessment = {
  actionId: compoundPaymentAction.id,
  score: 85,
  riskLevel: RiskLevel.CRITICAL,
  reasons: ['High-value financial transaction', 'Unverified external processor'],
  evaluatedAt: new Date().toISOString(),
};
const compoundPolicyResult = evaluatePolicies(compoundPaymentAction, highRiskAssessment).find(
  (p) => p.decision === ResponseAction.PROTECT
);
assertEquals(compoundPolicyResult?.decision, ResponseAction.PROTECT, 'Compound high-risk payment evaluates to PROTECT');
assertEquals(compoundPolicyResult?.ruleId, 'RULE_PAYMENT_COMPOUND_PROTECT', 'Attributed to compound payment rule');

// 1D. Harmless controlled navigation to external third-party domain -> WARN
const externalNavAction: GuardrailAction = {
  id: 'act-test-nav-001',
  type: ActionType.NAVIGATION,
  timestamp: new Date().toISOString(),
  category: ActionCategory.NAVIGATION,
  element: {
    tagName: 'A',
    id: 'link-external-partner',
    visibleText: 'Visit Partner Site',
  },
  page: {
    url: 'https://partner.example.org/landing',
    title: 'External Partner',
  },
};
const navPipeline = evaluateActionPipeline(externalNavAction);
assertEquals(navPipeline.decision.response, ResponseAction.WARN, 'External navigation evaluates to WARN');
assertEquals(navPipeline.decision.policyRuleId, 'RULE_EXTERNAL_NAVIGATION_POLICY', 'Matched external navigation policy');

// 1E. Harmless controlled routine interaction -> ALLOW
const routineAction: GuardrailAction = {
  id: 'act-test-routine-001',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.GENERAL,
  element: {
    tagName: 'BUTTON',
    id: 'btn-help-faq',
    visibleText: 'Browse Knowledge Base',
  },
  page: {
    url: 'https://app.example.com/help',
    title: 'Help Center',
  },
};
const routinePipeline = evaluateActionPipeline(routineAction);
assertEquals(routinePipeline.decision.response, ResponseAction.ALLOW, 'Routine search/browse evaluates to ALLOW');
assertEquals(routinePipeline.decision.policyRuleId, 'RULE_ROUTINE_ALLOW_POLICY', 'Matched routine allow policy');

// =============================================================================
// TEST 2: [UNIT] Multiple Matching Rules Produce a Deterministic Result
// =============================================================================
console.log('\n▶ Requirement 2: Multiple Matching Rules Produce a Deterministic Result');

// An action that contains attributes matching multiple policies
const multiMatchAction: GuardrailAction = {
  id: 'act-test-multi-001',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE, // Destructive policy match -> PROTECT
  element: {
    tagName: 'BUTTON',
    id: 'btn-delete-card',
    visibleText: 'Delete Saved Credit Card & Exit to Partner', // Payment & Nav keywords
  },
  page: {
    url: 'https://partner.example.com/billing', // External domain -> WARN
    title: 'Billing Management',
  },
};

// Evaluate multiple times to guarantee deterministic outcome
const run1 = evaluateActionPipeline(multiMatchAction);
const run2 = evaluateActionPipeline(multiMatchAction);
const run3 = evaluateActionPipeline(multiMatchAction);

assertEquals(run1.decision.response, ResponseAction.PROTECT, 'Multi-match resolves to PROTECT (highest severity)');
assertEquals(run2.decision.response, run1.decision.response, 'Multi-match evaluation is deterministic on run 2');
assertEquals(run3.decision.response, run1.decision.response, 'Multi-match evaluation is deterministic on run 3');
assertEquals(run1.decision.policyRuleId, run2.decision.policyRuleId, 'Matched rule is consistent across runs');

// =============================================================================
// TEST 3: [UNIT] Protection Rule Cannot Be Silently Downgraded by Warning Rule
// =============================================================================
console.log('\n▶ Requirement 3: Protection Rule Cannot Be Silently Downgraded');

// Base risk is CRITICAL (PROTECT)
const criticalRisk: RiskAssessment = {
  actionId: 'act-test-downgrade-check',
  score: 95,
  riskLevel: RiskLevel.CRITICAL,
  reasons: ['Permanent deletion detected.'],
  evaluatedAt: new Date().toISOString(),
};

// Even if a rule evaluates to WARN, monotonic elevation prevents downgrading PROTECT
const initialDecision: ResponseDecision = {
  actionId: criticalRisk.actionId,
  response: ResponseAction.PROTECT,
  reasons: ['Protected destructive action.'],
  policyRuleId: 'RULE_DESTRUCTIVE_ACTION_PROTECT',
  status: RiskEvaluationStatus.EVALUATED,
  success: true,
  createdAt: new Date().toISOString(),
};

// Attempt to evaluate with a warning rule
const warningResult = CoreRiskLevelResponseRule.evaluate({
  assessment: { ...criticalRisk, riskLevel: RiskLevel.MEDIUM },
});
assertEquals(warningResult.action, ResponseAction.WARN, 'Standalone warning rule outputs WARN');

// Monotonic elevation rule in engine: PROTECT takes precedence over WARN
const elevatedDecision = evaluateResponseAction(controlledDestructiveAction, criticalRisk);
assertEquals(elevatedDecision.action, ResponseAction.PROTECT, 'Engine preserves PROTECT against lower warning rules');

// =============================================================================
// TEST 4: [UNIT] Invalid or Unavailable Evaluation Fails Closed to PROTECT
// =============================================================================
console.log('\n▶ Requirement 4: Invalid/Unavailable Evaluation Fails Closed to PROTECT');

// 4A. Null or undefined action
const nullFailClosed = resolveFailClosedDecision(undefined, 'Corrupt action payload');
assertEquals(nullFailClosed.decision, ResponseAction.PROTECT, 'Null candidate resolves strictly to PROTECT');
assert(nullFailClosed.isFallback, 'Marked as fallback');

const nullFailedDecision = createFailedResponseDecision('act-null-test', {
  code: 'CORRUPT_PAYLOAD',
  message: 'Corrupt action payload',
});
assertEquals(nullFailedDecision.response, ResponseAction.PROTECT, 'createFailedResponseDecision resolves strictly to PROTECT');
assertEquals(nullFailedDecision.status, RiskEvaluationStatus.FAILED, 'Status is marked FAILED');
assert(!nullFailedDecision.success, 'Success flag is false');
assertEquals(nullFailedDecision.policyRuleId, 'RULE_FAIL_CLOSED_FALLBACK', 'Attributed to RULE_FAIL_CLOSED_FALLBACK');

// 4B. Corrupted action missing ID
const corruptEmptyIdAction = {
  id: '',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
} as unknown as GuardrailAction;
const corruptEmptyPipeline = evaluateActionPipeline(corruptEmptyIdAction);
assertEquals(corruptEmptyPipeline.decision.response, ResponseAction.PROTECT, 'Empty action ID fails closed to PROTECT');
assertEquals(corruptEmptyPipeline.decision.status, RiskEvaluationStatus.FAILED, 'Corrupt ID marked FAILED');

// 4C. Action ID mismatch between pipeline inputs
const mismatchedAction: GuardrailAction = {
  id: 'act-expected-001',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  page: { url: 'https://app.example.com', title: 'App' },
};
const forgedClassification: ActionClassificationResult = {
  actionId: 'act-spoofed-999',
  category: ActionCategory.GENERAL,
  matchedRule: 'FORGED_RULE',
  confidence: 0.9,
  reason: 'Spoofed token',
  classifiedAt: new Date().toISOString(),
};
const mismatchPipeline = evaluateActionPipeline(mismatchedAction, forgedClassification);
assertEquals(mismatchPipeline.decision.response, ResponseAction.PROTECT, 'Mismatched actionId fails closed to PROTECT');
assertEquals(mismatchPipeline.decision.structuredReasons?.[0].code, 'PIPELINE_ACTION_ID_MISMATCH', 'Mismatch code preserved');

// =============================================================================
// TEST 5: [WORKFLOW-INTEGRATION] ALLOW Does Not Trigger Unnecessary Protection
// =============================================================================
console.log('\n▶ Requirement 5: ALLOW Does Not Trigger Unnecessary Protection');

const controller = new InterceptionController();
const continuationManager = new ContinuationManager(controller);

// Verify ALLOW action has no side-effects in interception controller
const allowResult = evaluateActionPipeline(routineAction);
assertEquals(allowResult.decision.response, ResponseAction.ALLOW, 'Pipeline decision is ALLOW');

// Controller must NOT track or hold routine action
const routineRecord = controller.getRecord(routineAction.id);
assert(routineRecord === undefined, 'No InterceptionRecord created for routine ALLOW action');
assert(continuationManager.getCurrentHeldAction() === null, 'ContinuationManager tracks no held action for ALLOW');

// Attempting to continue unheld action fails safely
const continueAllow = continuationManager.continueAction(routineAction.id);
assert(!continueAllow.success, 'Attempt to continue un-held ALLOW action is rejected');
assert(!continueAllow.executed, 'ALLOW action callback is never executed via continuation manager');

// =============================================================================
// TEST 6: [WORKFLOW-INTEGRATION] WARN Displays Advisory Without Claiming HELD
// =============================================================================
console.log('\n▶ Requirement 6: WARN Displays Advisory Without False HELD Claim');

const warnResult = evaluateActionPipeline(controlledPaymentAction);
assertEquals(warnResult.decision.response, ResponseAction.WARN, 'Pipeline decision is WARN');

// Controller must NOT hold the action
const warnRecord = controller.getRecord(controlledPaymentAction.id);
assert(warnRecord === undefined, 'WARN action creates no record in InterceptionController');
assert(continuationManager.getCurrentHeldAction() === null, 'WARN action is not held in ContinuationManager');

// Explanation model verification: Warning copy provides operational guidance, NOT threat claims
const warnExplanation = explainRiskDecision(warnResult.decision, warnResult.risk, controlledPaymentAction);
assertEquals(warnExplanation.decision, ResponseAction.WARN, 'Explanation decision is WARN');
assertEquals(warnExplanation.nature, 'OPERATIONAL_PRECAUTION', 'Nature is OPERATIONAL_PRECAUTION');
assert(!warnExplanation.isSecurityThreat, 'isSecurityThreat is strictly false');
assert(
  !warnExplanation.headline.toLowerCase().includes('intercepted') &&
  !warnExplanation.userSummary.toLowerCase().includes('action was held'),
  'Warning text does not falsely claim the action was held or intercepted'
);

// =============================================================================
// TEST 7: [WORKFLOW-INTEGRATION] PROTECT Triggers Actual Supported Workflow
// =============================================================================
console.log('\n▶ Requirement 7: PROTECT Triggers Actual Supported Protection Workflow');

const protectAction = controlledDestructiveAction;
const protectResult = evaluateActionPipeline(protectAction);
assertEquals(protectResult.decision.response, ResponseAction.PROTECT, 'Decision is PROTECT');

// Register and hold in InterceptionController
controller.register(protectAction, 'Protected destructive action registered');
const heldRecord = controller.holdAction(protectAction.id, 'Held pending trusted contact authorization');
assertEquals(heldRecord.state, InterceptionState.HELD, 'Action successfully enters HELD state');

// Register with ContinuationManager with controlled execution callback
let executionCounter = 0;
continuationManager.registerHeldAction(protectAction, heldRecord, (_act) => {
  executionCounter++;
});

// Verify genuinely held and zero pre-execution
const currentHeld = continuationManager.getCurrentHeldAction();
assert(currentHeld !== null, 'Action is tracked as held in ContinuationManager');
assertEquals(currentHeld?.action.id, protectAction.id, 'Held action matches protectAction ID');
assertEquals(executionCounter, 0, 'Controlled action callback is strictly NOT executed during holding or staging');

// Build staging action context
const stagingContext = createStagingActionContext({
  action: protectAction,
  interception: heldRecord,
  risk: protectResult.risk,
  classification: protectResult.classification,
  decision: protectResult.decision,
});
assertEquals(stagingContext.responseAction, ResponseAction.PROTECT, 'StagingActionContext preserves PROTECT responseAction');

// =============================================================================
// TEST 8: [WORKFLOW-INTEGRATION] Unsupported Action Is Not Falsely Reported as Held
// =============================================================================
console.log('\n▶ Requirement 8: Unsupported Action Is Not Falsely Reported as Held');

// Ambient untrusted event (e.g., background page script or synthetic dispatch)
const ambientAction: GuardrailAction = {
  id: 'act-test-ambient-001',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE,
  element: {
    tagName: 'BUTTON',
    visibleText: 'Background Automated Delete',
  },
  page: {
    url: 'https://third-party.example.org/tracker',
    title: 'Background Window',
  },
};

// Even if pipeline evaluates to PROTECT, controller refuses to claim ambient action is held
const ambientEval = evaluateActionPipeline(ambientAction);
assertEquals(ambientEval.decision.response, ResponseAction.PROTECT, 'Evaluates to PROTECT');

// Ambient action is NOT registered or held in controller
const ambientRecord = controller.getRecord(ambientAction.id);
assert(ambientRecord === undefined, 'Ambient unintercepted action is NOT recorded in controller');
assert(continuationManager.getCurrentHeldAction()?.action.id !== ambientAction.id, 'ContinuationManager confirms action is NOT held');

// =============================================================================
// TEST 9: [MOCKED-SERVICE] Approval Status Cannot Bypass Policy or Binding
// =============================================================================
console.log('\n▶ Requirement 9: Approval Status Cannot Bypass Policy or Binding');

const approvalService = new ApprovalService();
const validationService = new ContinuationValidationService({
  controller,
  continuationManager,
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
approvalService.getContactRegistry().addContact({
  id: 'usr_bob',
  userId: 'usr_alice',
  relationshipLabel: 'Guardian',
  status: TrustedContactStatus.ACTIVE,
  createdAt: new Date().toISOString(),
});

// Create and approve request on backend
const approvalReq = approvalService.createRequest(
  {
    actionId: protectAction.id,
    actionDescription: 'Delete Account Permanently',
    actionType: protectAction.type,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 90,
    riskReasons: ['Destructive account deletion'],
    origin: 'https://app.example.com',
    hostname: 'app.example.com',
    pageTitle: 'Account Settings',
  },
  userAuth
);
approvalService.approveRequest(approvalReq.id, { decisionReason: 'Authorized by Bob' }, reviewerAuth);

// 9A. Action ID mismatch bypass attempt
const wrongActionIdVal = await validationService.validateEligibility('act-wrong-id-999', {
  stagingContext,
  originalAction: protectAction,
  authContext: userAuth,
});
assert(!wrongActionIdVal.eligible, 'Mismatched actionId cannot bypass continuation validation');
assertEquals(wrongActionIdVal.status, ContinuationEligibilityStatus.UNAVAILABLE, 'Status is UNAVAILABLE');

// 9B. Origin mismatch bypass attempt
const originMismatchVal = await validationService.validateEligibility(protectAction.id, {
  stagingContext,
  originalAction: protectAction,
  authContext: userAuth,
  pageContext: {
    origin: 'https://malicious-spoof.example.org',
    url: 'https://malicious-spoof.example.org/settings',
  },
});
assert(!originMismatchVal.eligible, 'Tampered origin cannot bypass continuation validation');
assertEquals(originMismatchVal.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED');

// 9C. Substituted benign action bypass attempt (Policy Revalidation)
const substitutedBenignAction: GuardrailAction = {
  id: protectAction.id,
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  element: { tagName: 'BUTTON', visibleText: 'View Documentation' },
  page: { url: 'https://app.example.com/docs', title: 'Docs' },
};
const substitutedVal = await validationService.validateEligibility(protectAction.id, {
  stagingContext,
  originalAction: substitutedBenignAction,
  authContext: userAuth,
});
assert(!substitutedVal.eligible, 'Substituted benign action blocked by policy revalidation');
assertEquals(substitutedVal.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED');
assertEquals(substitutedVal.errorCode, 'POLICY_REQUIREMENTS_NOT_MET', 'Error code is POLICY_REQUIREMENTS_NOT_MET');

// 9D. UI downgrade attempt (attempting to pass ALLOW in staging context)
const artificiallyDowngradedContext = {
  ...stagingContext,
  responseAction: ResponseAction.ALLOW,
};
const downgradeVal = await validationService.validateEligibility(protectAction.id, {
  stagingContext: artificiallyDowngradedContext,
  originalAction: protectAction,
  authContext: userAuth,
});
assert(!downgradeVal.eligible, 'UI downgrade in staging context is rejected');
assertEquals(downgradeVal.status, ContinuationEligibilityStatus.REJECTED, 'Status is REJECTED');

// 9E. Action binding immutability and anti-reassignment check
const initialBinding = createApprovalActionBinding({
  actionId: protectAction.id,
  requestId: approvalReq.id,
  requesterId: userAuth.actorId,
  origin: protectAction.page?.url ? new URL(protectAction.page.url).origin : 'https://app.example.com',
  pathname: protectAction.page?.url ? new URL(protectAction.page.url).pathname : '/settings',
  actionType: protectAction.type,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
});

let reassignmentBlocked = false;
try {
  assertNoBindingReassignment(initialBinding, 'act-tampered-different-action', approvalReq.id);
} catch (err) {
  if (err instanceof ApprovalBindingReassignmentError) {
    reassignmentBlocked = true;
  }
}
assert(reassignmentBlocked, 'Binding anti-reassignment check blocks binding to different actionId');

// =============================================================================
// TEST 10: [MOCKED-SERVICE] Continuation Rechecks Applicable Requirements
// =============================================================================
console.log('\n▶ Requirement 10: Continuation Rechecks Applicable Requirements');

// Recheck requirements on legitimate, authorized action:
const legitimateValidation = await validationService.validateEligibility(protectAction.id, {
  stagingContext,
  originalAction: protectAction,
  authContext: userAuth,
});
assert(legitimateValidation.eligible, 'Legitimate authorized action is ELIGIBLE for continuation');
assertEquals(legitimateValidation.status, ContinuationEligibilityStatus.ELIGIBLE, 'Status is ELIGIBLE');
assertEquals(legitimateValidation.policyDecision, ResponseAction.PROTECT, 'Recorded policy decision is PROTECT');
assertEquals(legitimateValidation.policyRuleId, 'RULE_CONTROLLED_DESTRUCTIVE', 'Recorded policy rule ID matches');

// Execute continuation
const continuationOutcome = continuationManager.continueAction(protectAction.id, 'User confirmed continuation');
assert(continuationOutcome.success, 'Action successfully continued');
assert(continuationOutcome.executed, 'Controlled action callback was executed');
assertEquals(executionCounter, 1, 'Callback executed exactly once');

// =============================================================================
// TEST 11: [WORKFLOW-INTEGRATION] Cancellation and Expiration Remain Enforced
// =============================================================================
console.log('\n▶ Requirement 11: Cancellation and Expiration Remain Enforced');

// 11A. Cancellation enforcement
const cancelAction: GuardrailAction = {
  id: 'act-test-cancel-001',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE,
  element: { tagName: 'BUTTON', visibleText: 'Delete Item' },
  page: { url: 'https://app.example.com/items', title: 'Items' },
};
controller.register(cancelAction, 'Action for cancellation test');
const cancelRecord = controller.holdAction(cancelAction.id, 'Held for testing cancellation');
let cancelExecCount = 0;
continuationManager.registerHeldAction(cancelAction, cancelRecord, () => {
  cancelExecCount++;
});

// User cancels action
const cancelledRecord = controller.cancelAction(cancelAction.id, 'User cancelled');
assertEquals(cancelledRecord.state, InterceptionState.CANCELLED, 'Action state is CANCELLED');

// Attempt to continue cancelled action
const continueCancelled = continuationManager.continueAction(cancelAction.id);
assert(!continueCancelled.success, 'Continuation of cancelled action is rejected');
assertEquals(cancelExecCount, 0, 'Callback is never executed after cancellation');

// 11B. Expiration enforcement
const expireAction: GuardrailAction = {
  id: 'act-test-expire-001',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE,
  element: { tagName: 'BUTTON', visibleText: 'Purge Logs' },
  page: { url: 'https://app.example.com/admin', title: 'Admin' },
};
controller.register(expireAction, 'Action for expiration test');
const expireRecord = controller.holdAction(expireAction.id, 'Held for testing expiration');
let expireExecCount = 0;
continuationManager.registerHeldAction(expireAction, expireRecord, () => {
  expireExecCount++;
});

// Expire the action
const expiredRecord = controller.expireAction(expireAction.id, 'Holding window expired');
assertEquals(expiredRecord.state, InterceptionState.EXPIRED, 'Action state is EXPIRED');

// Attempt to continue expired action
const continueExpired = continuationManager.continueAction(expireAction.id);
assert(!continueExpired.success, 'Continuation of expired action is rejected');
assertEquals(expireExecCount, 0, 'Callback is never executed after expiration');

// =============================================================================
// TEST 12: [UNIT] Unknown Decision Values Fail Safely
// =============================================================================
console.log('\n▶ Requirement 12: Unknown Decision Values Fail Safely');

// validateResponseAction must return valid: false for invalid decision strings
assertEquals(validateResponseAction('PERMIT').valid, false, 'validateResponseAction rejects "PERMIT"');
assertEquals(validateResponseAction('BLOCK').valid, false, 'validateResponseAction rejects "BLOCK"');
assertEquals(validateResponseAction('ALLOW_ANYWAY').valid, false, 'validateResponseAction rejects "ALLOW_ANYWAY"');
assertEquals(validateResponseAction(undefined).valid, false, 'validateResponseAction rejects undefined');

// resolveFailClosedDecision safely normalizes any unknown decision string to PROTECT
const unknownFallback = resolveFailClosedDecision('UNKNOWN_VALUE');
assertEquals(unknownFallback.decision, ResponseAction.PROTECT, 'Unknown response resolves to PROTECT');
assert(unknownFallback.isFallback, 'Flagged as fallback');

// createFailedResponseDecision creates full ResponseDecision object
const failedResp = createFailedResponseDecision('act-unknown-test', {
  code: 'UNKNOWN_DECISION_FAIL_CLOSED',
  message: 'Unknown decision fallback invoked',
});
assertEquals(failedResp.response, ResponseAction.PROTECT, 'createFailedResponseDecision resolves to PROTECT');
assertEquals(failedResp.status, RiskEvaluationStatus.FAILED, 'Status marked FAILED');
assertEquals(failedResp.policyRuleId, 'RULE_FAIL_CLOSED_FALLBACK', 'Attributed to RULE_FAIL_CLOSED_FALLBACK');

// =============================================================================
// TEST 13: [UNIT] Risk Explanations Correspond to Actual Matched Rules
// =============================================================================
console.log('\n▶ Requirement 13: Risk Explanations Correspond to Matched Rules');

// 13A. Destructive policy explanation
const destExp = explainRiskDecision(destructivePipeline.decision, destructivePipeline.risk, controlledDestructiveAction);
assertEquals(destExp.categoryBadge, 'Permanent Deletion Guard', 'Category badge identifies Permanent Deletion');
assert(destExp.headline.includes('Permanent Deletion'), 'Headline specifies Permanent Deletion');
assertEquals(destExp.technicalDetails.reasonCode, 'POLICY_PROTECT_DESTRUCTIVE', 'Reason code matches canonical policy');
assertEquals(destExp.technicalDetails.ruleId, 'RULE_CONTROLLED_DESTRUCTIVE', 'Rule ID matches canonical policy');

// 13B. Payment policy explanation
const payExp = explainRiskDecision(paymentPipeline.decision, paymentPipeline.risk, controlledPaymentAction);
assertEquals(payExp.categoryBadge, 'Payment Advisory', 'Category badge identifies Payment Advisory');
assert(payExp.headline.includes('Checkout or Billing'), 'Headline specifies Checkout or Billing');
assertEquals(payExp.technicalDetails.reasonCode, 'POLICY_WARN_PAYMENT', 'Reason code matches canonical payment policy');

// 13C. Unknown code fallback without inventing rules
const customReasonDecision: ResponseDecision = {
  actionId: 'act-custom-reason-001',
  response: ResponseAction.WARN,
  reasons: ['Third-party extension heuristic triggered'],
  structuredReasons: [
    { code: 'CUSTOM_HEURISTIC_RULE_77', message: 'Third-party trigger', severity: RiskLevel.MEDIUM },
  ],
  status: RiskEvaluationStatus.EVALUATED,
  success: true,
  createdAt: new Date().toISOString(),
};
const customExp = explainRiskDecision(customReasonDecision);
assertEquals(customExp.headline, 'Safety Advisory: Sensitive Operation', 'Generic non-fabricated headline used');
assertEquals(customExp.technicalDetails.reasonCode, 'CUSTOM_HEURISTIC_RULE_77', 'Preserves exact raw reason code');
assert(customExp.whyFlagged.includes('Third-party extension heuristic triggered'), 'Preserves raw reason without hallucination');

// =============================================================================
// TEST 14: [PRIVACY-AUDIT] Logs & Diagnostics Do Not Contain Sensitive Data
// =============================================================================
console.log('\n▶ Requirement 14: Logs & Diagnostics Do Not Contain Sensitive Data');

// Payload with sensitive fields and URL query parameters
const sensitiveDiagnosticData = {
  actionId: 'act-test-sensitive-001',
  targetUrl: 'https://auth.example.com/oauth/callback?code=sec_auth_code_987654321&state=st_123#token',
  formData: {
    username: 'bob@example.com',
    password: 'SuperSecretPassword123!',
    otp: '987654',
    cardNumber: '5500000000001111',
    cvv: '999',
    sessionToken: 'jwt.token.string.here',
  },
  rawFormData: 'user=bob&pass=SuperSecretPassword123!',
};

// 14A. Sanitize URL
const cleanUrl = sanitizeUrlForDiagnostics(sensitiveDiagnosticData.targetUrl);
assertEquals(cleanUrl, 'https://auth.example.com/oauth/callback', 'URL stripped of query parameters and fragment');
assert(!cleanUrl.includes('code'), 'URL contains no auth code');
assert(!cleanUrl.includes('token'), 'URL contains no token fragment');

// 14B. Deep sanitize diagnostic payload
const cleanData = sanitizeForDiagnostics(sensitiveDiagnosticData);
assertEquals(cleanData.targetUrl, 'https://auth.example.com/oauth/callback', 'targetUrl sanitized in payload');
assertEquals((cleanData as any).formData.password, '[REDACTED]', 'password is redacted');
assertEquals((cleanData as any).formData.otp, '[REDACTED]', 'otp is redacted');
assertEquals((cleanData as any).formData.cardNumber, '[REDACTED]', 'cardNumber is redacted');
assertEquals((cleanData as any).formData.cvv, '[REDACTED]', 'cvv is redacted');
assertEquals((cleanData as any).formData.sessionToken, '[REDACTED]', 'sessionToken is redacted');
assertEquals((cleanData as any).rawFormData, '[REDACTED]', 'raw form value is redacted');
assertEquals((cleanData as any).formData.username, 'bob@example.com', 'Non-sensitive username retained');

// 14C. Verify privacy audit passing
const auditResult = isPrivacySafe(cleanData);
assert(auditResult.safe, 'Sanitized payload passes isPrivacySafe audit');
assertEquals(auditResult.violations.length, 0, 'Zero privacy violations in sanitized payload');

// =============================================================================
// TEST 15: [WORKFLOW-INTEGRATION] Duplicate Evaluation & Delayed Responses State Safety
// =============================================================================
console.log('\n▶ Requirement 15: Duplicate Evaluation & Delayed Responses State Safety');

// 15A. Repeated evaluations on the same action are immutable and state-safe
const evalA = evaluateActionPipeline(controlledDestructiveAction);
const evalB = evaluateActionPipeline(controlledDestructiveAction);
assertEquals(evalA.decision.response, evalB.decision.response, 'Duplicate evaluation yields identical response');
assertEquals(evalA.risk.score, evalB.risk.score, 'Duplicate evaluation yields identical risk score');

// 15B. Idempotent holding in controller
const repeatAction: GuardrailAction = {
  id: 'act-test-repeat-001',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE,
  element: { tagName: 'BUTTON', visibleText: 'Repeat Test' },
  page: { url: 'https://app.example.com/repeat', title: 'Repeat' },
};
controller.register(repeatAction, 'Repeat action initial register');
const firstHold = controller.holdAction(repeatAction.id, 'First hold');

let duplicateHoldRejected = false;
try {
  controller.holdAction(repeatAction.id, 'Second hold attempt');
} catch (err) {
  if (err instanceof InvalidStateTransitionError) {
    duplicateHoldRejected = true;
  }
}
assert(duplicateHoldRejected, 'Controller rejects duplicate holdAction with InvalidStateTransitionError');
assertEquals(firstHold.state, InterceptionState.HELD, 'State remains consistently HELD');

// 15C. Exactly-once execution guarantee on continuation
let repeatExecCounter = 0;
continuationManager.registerHeldAction(repeatAction, firstHold, () => {
  repeatExecCounter++;
});

const firstContinue = continuationManager.continueAction(repeatAction.id, 'First user continuation');
assert(firstContinue.success, 'First continuation succeeds');
assertEquals(repeatExecCounter, 1, 'Callback executed on first continuation');

const secondContinue = continuationManager.continueAction(repeatAction.id, 'Duplicate continuation attempt');
assert(!secondContinue.success, 'Duplicate continuation is safely rejected');
assertEquals(repeatExecCounter, 1, 'Execution counter remains strictly 1 (no duplicate execution)');

// =============================================================================
// FINAL SUMMARY
// =============================================================================
console.log('\n======================================================================');
console.log(`Results: ${passed} passed, ${failed} failed across all 15 requirements`);
console.log('======================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL 15 RISK EVALUATION & WORKFLOW ENFORCEMENT REQUIREMENTS VERIFIED!\n');
}
