/**
 * Guardrail Risk Evaluation Contract - Comprehensive Verification Suite
 *
 * Validates the typed contract for risk-evaluation results across the extension:
 * 1. Explicit representation of ALLOW, WARN, and PROTECT decisions.
 * 2. Consistent, machine-readable structure for decision reasons.
 * 3. Matched rule identifiers and score contributions.
 * 4. Bounded 0–100 heuristic scoring model and documented semantics.
 * 5. Distinction between successful evaluation results and evaluation failures.
 * 6. Fail-closed protection against silent ALLOW on malformed, corrupt, or unknown inputs.
 * 7. Preservation of backward compatibility with existing pipeline types.
 * 8. Strict separation from approval lifecycle and action execution states.
 * 9. Sensitive data privacy preservation (no passwords, OTPs, CVVs, card numbers).
 * 10. Pure in-memory execution without DOM or browser window dependencies.
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import {
  EvaluationError,
  EvaluationReason,
  MatchedRuleInfo,
  RiskAssessment,
  RiskEvaluationResult,
  RiskEvaluationStatus,
  RiskLevel,
  RiskSignalId,
} from '../types/risk.js';
import {
  ResponseAction,
  ResponseDecision,
  resolveFailClosedDecision,
  validateResponseAction,
} from '../types/response.js';
import {
  assessRisk,
  createFailedRiskAssessment,
  determineRiskLevel,
  determineSignalSeverity,
  RiskEngine,
} from './engine.js';
import {
  CoreRiskLevelResponseRule,
  evaluateResponseAction,
} from '../response/rules.js';
import {
  createFailedResponseDecision,
  createRiskEvaluationResult,
  decideResponse,
  evaluateRiskAndDecision,
  ResponseEngine,
  validateRiskEvaluationResult,
} from '../response/engine.js';

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
console.log('🧪 GUARDRAIL RISK EVALUATION CONTRACT - VERIFICATION SUITE');
console.log('============================================================\n');

// =============================================================================
// SUITE 1: Explicit Decision Representation (ALLOW, WARN, PROTECT)
// =============================================================================
console.log('▶ Suite 1: Explicit Decision Representation (ALLOW, WARN, PROTECT)');
{
  // 1. Validate enumeration values
  assert(ResponseAction.ALLOW === 'ALLOW', 'ResponseAction.ALLOW is explicitly "ALLOW"');
  assert(ResponseAction.WARN === 'WARN', 'ResponseAction.WARN is explicitly "WARN"');
  assert(ResponseAction.PROTECT === 'PROTECT', 'ResponseAction.PROTECT is explicitly "PROTECT"');

  // 2. validateResponseAction helper
  const allowVal = validateResponseAction('ALLOW');
  assert(allowVal.valid && allowVal.action === ResponseAction.ALLOW, 'validateResponseAction("ALLOW") is valid');

  const warnVal = validateResponseAction('WARN');
  assert(warnVal.valid && warnVal.action === ResponseAction.WARN, 'validateResponseAction("WARN") is valid');

  const protectVal = validateResponseAction('PROTECT');
  assert(protectVal.valid && protectVal.action === ResponseAction.PROTECT, 'validateResponseAction("PROTECT") is valid');

  const invalidVal = validateResponseAction('PERMIT');
  assert(!invalidVal.valid && typeof invalidVal.error === 'string', 'validateResponseAction("PERMIT") correctly rejected');

  // 3. ALLOW decision for routine action
  const lowAction: GuardrailAction = {
    id: 'act-contract-allow',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'View Dashboard' },
    page: { url: 'https://app.example.com/home', title: 'Home' },
    timestamp: new Date().toISOString(),
  };
  const lowResult = evaluateRiskAndDecision(lowAction);
  assert(lowResult.decision === ResponseAction.ALLOW, `Routine action yields ALLOW decision (got: ${lowResult.decision})`);
  assert(lowResult.riskLevel === RiskLevel.LOW, `Routine action maps to LOW risk (got: ${lowResult.riskLevel})`);
  assert(lowResult.score <= 24, `Routine action score is <= 24 (got: ${lowResult.score})`);

  // 4. WARN decision for medium-risk action (Payment)
  const warnAction: GuardrailAction = {
    id: 'act-contract-warn',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'pay-btn', visibleText: 'Pay ₹2,500' },
    page: { url: 'https://app.example.com/checkout', title: 'Checkout' },
    timestamp: new Date().toISOString(),
  };
  const warnResult = evaluateRiskAndDecision(warnAction);
  assert(warnResult.decision === ResponseAction.WARN, `Payment action yields WARN decision (got: ${warnResult.decision})`);
  assert(warnResult.riskLevel === RiskLevel.MEDIUM, `Payment action maps to MEDIUM risk (got: ${warnResult.riskLevel})`);
  assert(warnResult.score === 40, `Payment action score is 40 (got: ${warnResult.score})`);

  // 5. PROTECT decision for critical compounded action (Destructive + Payment + External)
  const critAction: GuardrailAction = {
    id: 'act-contract-protect',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'delete-pay-btn', visibleText: 'Delete Account and Transfer All Funds to External Payee' },
    page: { url: 'https://app.example.com/settings', previousUrl: 'https://other-origin.com/login', title: 'Settings' },
    timestamp: new Date().toISOString(),
  };
  const critResult = evaluateRiskAndDecision(critAction);
  assert(critResult.decision === ResponseAction.PROTECT, `Compound action yields PROTECT decision (got: ${critResult.decision})`);
  assert(critResult.riskLevel === RiskLevel.CRITICAL, `Compound action maps to CRITICAL risk (got: ${critResult.riskLevel})`);
  assert(critResult.score >= 75, `Compound action score is >= 75 (got: ${critResult.score})`);
}

// =============================================================================
// SUITE 2: Consistent Structure for Decision Reasons & Rule Attribution
// =============================================================================
console.log('\n▶ Suite 2: Consistent Structure for Decision Reasons & Rule Attribution');
{
  const action: GuardrailAction = {
    id: 'act-reasons-1',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', id: 'delete-account-btn', visibleText: 'Permanently Delete Account' },
    page: { url: 'https://app.example.com/account', title: 'Account Settings' },
    timestamp: new Date().toISOString(),
  };

  const assessment = assessRisk(action);

  // Check backward-compatible string reasons
  assert(Array.isArray(assessment.reasons), 'RiskAssessment.reasons is an array of strings');
  assert(assessment.reasons.length > 0, `Contains at least 1 string reason (found: ${assessment.reasons.length})`);

  // Check structuredReasons contract
  assert(Array.isArray(assessment.structuredReasons), 'RiskAssessment.structuredReasons is an array');
  assert(assessment.structuredReasons!.length > 0, 'Contains structured reasons');

  const reason = assessment.structuredReasons![0];
  assert(typeof reason.code === 'string' && reason.code.startsWith('SIGNAL_'), `Structured reason has code "${reason.code}"`);
  assert(typeof reason.message === 'string' && reason.message.length > 0, 'Structured reason has human-readable message');
  assert(reason.signalId === RiskSignalId.DESTRUCTIVE_ACTION, `Structured reason identifies signalId "${reason.signalId}"`);
  assert(reason.ruleId === 'RISK_RULE_DESTRUCTIVE', `Structured reason identifies ruleId "${reason.ruleId}"`);
  assert(reason.scoreContribution === 50, `Structured reason records scoreContribution 50 (got: ${reason.scoreContribution})`);
  assert(reason.severity === RiskLevel.HIGH, `Structured reason records severity HIGH (got: ${reason.severity})`);

  // Check matchedRules contract
  assert(Array.isArray(assessment.matchedRules), 'RiskAssessment.matchedRules is an array');
  assert(assessment.matchedRules!.length > 0, 'Contains matched rule entries');
  const matchedRule = assessment.matchedRules![0];
  assert(matchedRule.ruleId === 'RISK_RULE_DESTRUCTIVE', `MatchedRuleInfo contains ruleId "${matchedRule.ruleId}"`);
  assert(matchedRule.signalId === RiskSignalId.DESTRUCTIVE_ACTION, `MatchedRuleInfo contains signalId "${matchedRule.signalId}"`);
  assert(typeof matchedRule.description === 'string', 'MatchedRuleInfo contains description');

  // Check response decision policy rule attribution
  const decision = decideResponse(assessment);
  assert(decision.policyRuleId === 'RULE_CORE_RISK_LEVEL_RESPONSE', `ResponseDecision includes policyRuleId "${decision.policyRuleId}"`);
  assert(Array.isArray(decision.structuredReasons), 'ResponseDecision contains structuredReasons');
  const policyReason = decision.structuredReasons!.find((r) => r.code.startsWith('POLICY_'));
  assert(Boolean(policyReason), 'ResponseDecision includes explicit POLICY_* structured reason');
}

// =============================================================================
// SUITE 3: Scoring Model Meaning, Range & Documentation
// =============================================================================
console.log('\n▶ Suite 3: Bounded Scoring Model Range & Threshold Mapping');
{
  // Test lower clamp bound
  assert(determineRiskLevel(0) === RiskLevel.LOW, 'Score 0 maps to LOW');
  assert(determineRiskLevel(-20) === RiskLevel.LOW, 'Negative score clamped to 0 and maps to LOW');

  // Test tier boundaries
  assert(determineRiskLevel(24) === RiskLevel.LOW, 'Score 24 maps to LOW');
  assert(determineRiskLevel(25) === RiskLevel.MEDIUM, 'Score 25 maps to MEDIUM');
  assert(determineRiskLevel(49) === RiskLevel.MEDIUM, 'Score 49 maps to MEDIUM');
  assert(determineRiskLevel(50) === RiskLevel.HIGH, 'Score 50 maps to HIGH');
  assert(determineRiskLevel(74) === RiskLevel.HIGH, 'Score 74 maps to HIGH');
  assert(determineRiskLevel(75) === RiskLevel.CRITICAL, 'Score 75 maps to CRITICAL');
  assert(determineRiskLevel(100) === RiskLevel.CRITICAL, 'Score 100 maps to CRITICAL');

  // Test upper clamp bound
  assert(determineRiskLevel(150) === RiskLevel.CRITICAL, 'Score 150 clamped strictly to 100 and maps to CRITICAL');

  // Check signal severities helper
  assert(determineSignalSeverity(RiskSignalId.DESTRUCTIVE_ACTION) === RiskLevel.HIGH, 'DESTRUCTIVE_ACTION is HIGH severity');
  assert(determineSignalSeverity(RiskSignalId.PAYMENT_ACTION) === RiskLevel.MEDIUM, 'PAYMENT_ACTION is MEDIUM severity');
  assert(determineSignalSeverity(RiskSignalId.AUTHENTICATION_ACTION) === RiskLevel.LOW, 'AUTHENTICATION_ACTION is LOW severity');
}

// =============================================================================
// SUITE 4: Distinguishing Evaluation Result from Evaluation Failure
// =============================================================================
console.log('\n▶ Suite 4: Distinguishing Evaluation Result from Evaluation Failure');
{
  // 1. Normal successful evaluation
  const validAction: GuardrailAction = {
    id: 'act-success-1',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Terms of Service' },
    page: { url: 'https://example.com/terms', title: 'Terms' },
    timestamp: new Date().toISOString(),
  };
  const successAssessment = assessRisk(validAction);
  assert(successAssessment.status === RiskEvaluationStatus.EVALUATED, 'Successful evaluation status is EVALUATED');
  assert(successAssessment.success === true, 'Successful evaluation flags success: true');
  assert(successAssessment.error === undefined, 'Successful evaluation has error: undefined');

  // 2. Evaluation failure on null action
  const nullAssessment = assessRisk(null as any);
  assert(nullAssessment.status === RiskEvaluationStatus.FAILED, 'Null action assessment status is FAILED');
  assert(nullAssessment.success === false, 'Null action assessment flags success: false');
  assert(Boolean(nullAssessment.error), 'Null action assessment includes error object');
  assert(nullAssessment.error?.code === 'INVALID_ACTION_PAYLOAD', `Error code is INVALID_ACTION_PAYLOAD (got: ${nullAssessment.error?.code})`);
  assert(nullAssessment.riskLevel === RiskLevel.CRITICAL, `Failed evaluation fails closed to CRITICAL risk (got: ${nullAssessment.riskLevel})`);
  assert(nullAssessment.score === 100, `Failed evaluation scores 100 (got: ${nullAssessment.score})`);

  // 3. Evaluation failure on missing actionId
  const emptyIdAction = {
    id: '   ',
    type: ActionType.CLICK,
    page: { url: '' },
    timestamp: new Date().toISOString(),
  } as unknown as GuardrailAction;
  const emptyIdAssessment = assessRisk(emptyIdAction);
  assert(emptyIdAssessment.status === RiskEvaluationStatus.FAILED, 'Empty actionId assessment status is FAILED');
  assert(emptyIdAssessment.success === false, 'Empty actionId flags success: false');
  assert(emptyIdAssessment.error?.code === 'INVALID_ACTION_PAYLOAD', 'Identifies INVALID_ACTION_PAYLOAD');

  // 4. createFailedRiskAssessment standalone utility
  const failedCustom = createFailedRiskAssessment('act-failed-custom', {
    code: 'CUSTOM_PARSE_ERROR',
    message: 'Could not deserialize DOM token list.',
  });
  assert(failedCustom.actionId === 'act-failed-custom', 'Custom failed assessment preserves actionId');
  assert(failedCustom.status === RiskEvaluationStatus.FAILED, 'Custom failed assessment status is FAILED');
  assert(failedCustom.score === 100, 'Custom failed assessment score is 100 (fail-closed)');
  assert(failedCustom.riskLevel === RiskLevel.CRITICAL, 'Custom failed assessment riskLevel is CRITICAL');
}

// =============================================================================
// SUITE 5: Fail-Closed Protection (Zero Silent Downgrade to ALLOW)
// =============================================================================
console.log('\n▶ Suite 5: Fail-Closed Protection (Zero Silent Downgrade to ALLOW)');
{
  // 1. resolveFailClosedDecision with invalid candidates
  const nullDecision = resolveFailClosedDecision(null);
  assert(nullDecision.decision === ResponseAction.PROTECT, 'resolveFailClosedDecision(null) resolves to PROTECT');
  assert(nullDecision.isFallback === true, 'Flags isFallback: true');

  const unknownDecision = resolveFailClosedDecision('RANDOM_DECISION_STRING');
  assert(unknownDecision.decision === ResponseAction.PROTECT, 'resolveFailClosedDecision("RANDOM...") resolves to PROTECT');
  assert(unknownDecision.isFallback === true, 'Flags isFallback: true');

  const validAllow = resolveFailClosedDecision(ResponseAction.ALLOW);
  assert(validAllow.decision === ResponseAction.ALLOW, 'resolveFailClosedDecision(ALLOW) resolves to ALLOW');
  assert(validAllow.isFallback === false, 'Flags isFallback: false');

  // 2. CoreRiskLevelResponseRule with unknown/unmapped risk level
  const corruptAssessment: RiskAssessment = {
    actionId: 'act-corrupt-risk',
    score: 50,
    riskLevel: 'CORRUPTED_LEVEL' as any,
    reasons: ['Testing corrupt level'],
    evaluatedAt: new Date().toISOString(),
  };
  const corruptPolicyResult = evaluateResponseAction(corruptAssessment);
  assert(corruptPolicyResult.action === ResponseAction.PROTECT, `Corrupted risk level resolves fail-closed to PROTECT (got: ${corruptPolicyResult.action})`);
  assert(corruptPolicyResult.ruleId === 'RULE_FAIL_CLOSED_FALLBACK', `Rule is RULE_FAIL_CLOSED_FALLBACK (got: ${corruptPolicyResult.ruleId})`);

  // 3. ResponseEngine handling an upstream FAILED risk assessment
  const failedAssessment = createFailedRiskAssessment('act-failed-upstream', {
    code: 'EVALUATION_EXCEPTION',
    message: 'Unexpected runtime error during evaluation.',
  });
  const decidedForFailed = decideResponse(failedAssessment);
  assert(decidedForFailed.response === ResponseAction.PROTECT, `Decision on FAILED assessment strictly yields PROTECT (got: ${decidedForFailed.response})`);
  assert(decidedForFailed.status === RiskEvaluationStatus.FAILED, 'Decision status is FAILED');
  assert(decidedForFailed.success === false, 'Decision success is false');

  // 4. ResponseEngine handling null/undefined assessment
  const nullDecisionResult = decideResponse(null as any);
  assert(nullDecisionResult.response === ResponseAction.PROTECT, 'Decision on null assessment resolves fail-closed to PROTECT');
  assert(nullDecisionResult.status === RiskEvaluationStatus.FAILED, 'Status is FAILED');
  assert(nullDecisionResult.error?.code === 'INVALID_ASSESSMENT_PAYLOAD', 'Reports INVALID_ASSESSMENT_PAYLOAD');

  // 5. createRiskEvaluationResult enforcement
  const unifiedFailed = createRiskEvaluationResult(failedAssessment, decidedForFailed);
  assert(unifiedFailed.decision === ResponseAction.PROTECT, 'Unified contract for failure state strictly enforces PROTECT decision');
  assert(unifiedFailed.status === RiskEvaluationStatus.FAILED, 'Unified status is FAILED');
  assert(unifiedFailed.success === false, 'Unified success is false');
}

// =============================================================================
// SUITE 6: Validation of Contract Shapes, Missing Fields & Privacy
// =============================================================================
console.log('\n▶ Suite 6: Validation of Contract Shapes, Missing Fields & Privacy');
{
  // 1. Valid contract payload
  const validPayload: RiskEvaluationResult = {
    actionId: 'act-valid-contract',
    decision: ResponseAction.WARN,
    status: RiskEvaluationStatus.EVALUATED,
    success: true,
    riskLevel: RiskLevel.MEDIUM,
    score: 40,
    reasons: ['Payment action detected.'],
    structuredReasons: [
      {
        code: 'SIGNAL_PAYMENT_ACTION',
        message: 'Action interacts with financial transactions.',
        signalId: RiskSignalId.PAYMENT_ACTION,
        ruleId: 'RISK_RULE_PAYMENT',
        severity: RiskLevel.MEDIUM,
        scoreContribution: 40,
      },
    ],
    matchedRules: [
      {
        ruleId: 'RISK_RULE_PAYMENT',
        signalId: RiskSignalId.PAYMENT_ACTION,
        scoreContribution: 40,
        reason: 'Action interacts with financial transactions.',
      },
    ],
    policyRuleId: 'RULE_CORE_RISK_LEVEL_RESPONSE',
    evaluatedAt: new Date().toISOString(),
  };

  const validation = validateRiskEvaluationResult(validPayload);
  assert(validation.valid === true, 'Valid RiskEvaluationResult passes validation');
  assert(validation.errors.length === 0, 'No validation errors on valid result');

  // 2. Reject non-object
  assert(!validateRiskEvaluationResult(null).valid, 'Rejects null result');
  assert(!validateRiskEvaluationResult('string').valid, 'Rejects string result');

  // 3. Reject missing actionId
  const missingId = { ...validPayload, actionId: '' };
  const valMissingId = validateRiskEvaluationResult(missingId);
  assert(!valMissingId.valid && valMissingId.errors.some((e) => e.includes('actionId')), 'Rejects empty actionId');

  // 4. Reject invalid decision
  const badDecision = { ...validPayload, decision: 'UNKNOWN' as any };
  const valBadDecision = validateRiskEvaluationResult(badDecision);
  assert(!valBadDecision.valid && valBadDecision.errors.some((e) => e.includes('decision')), 'Rejects invalid decision');

  // 5. Reject out-of-bounds score
  const negativeScore = { ...validPayload, score: -10 };
  const valNeg = validateRiskEvaluationResult(negativeScore);
  assert(!valNeg.valid && valNeg.errors.some((e) => e.includes('score')), 'Rejects negative score');

  const overScore = { ...validPayload, score: 105 };
  const valOver = validateRiskEvaluationResult(overScore);
  assert(!valOver.valid && valOver.errors.some((e) => e.includes('score')), 'Rejects score > 100');

  // 6. Security Invariant: FAILED evaluation cannot render ALLOW
  const illegalAllow = {
    ...validPayload,
    status: RiskEvaluationStatus.FAILED,
    decision: ResponseAction.ALLOW,
  };
  const valIllegal = validateRiskEvaluationResult(illegalAllow);
  assert(
    !valIllegal.valid && valIllegal.errors.some((e) => e.includes('fail-closed invariant')),
    'Rejects FAILED evaluation that attempts to claim ALLOW (fail-closed security invariant)'
  );

  // 7. Privacy Invariant: Detect sensitive credential leakage
  const leakyObj = {
    ...validPayload,
    password: 'SuperSecretPassword123',
  };
  const valLeaky = validateRiskEvaluationResult(leakyObj);
  assert(
    !valLeaky.valid && valLeaky.errors.some((e) => e.includes('Privacy violation')),
    'Detects and rejects sensitive password key in evaluation payload'
  );
}

// =============================================================================
// SUITE 7: Separation from Approval & Continuation States
// =============================================================================
console.log('\n▶ Suite 7: Separation from Approval & Continuation States');
{
  const action: GuardrailAction = {
    id: 'act-pure-eval-1',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Checkout' },
    page: { url: 'https://store.example.com', title: 'Store' },
    timestamp: new Date().toISOString(),
  };

  const evalResult = evaluateRiskAndDecision(action);

  // Ensure risk evaluation result has no approval/continuation state contamination
  assert(!('approvalStatus' in evalResult), 'RiskEvaluationResult does not contain approvalStatus');
  assert(!('bindingState' in evalResult), 'RiskEvaluationResult does not contain bindingState');
  assert(!('executionCount' in evalResult), 'RiskEvaluationResult does not contain executionCount');
  assert(!('interceptionState' in evalResult), 'RiskEvaluationResult does not contain interceptionState');
  assert(Object.isFrozen(evalResult), 'RiskEvaluationResult is an immutable frozen object');
  assert(Object.isFrozen(evalResult.reasons), 'RiskEvaluationResult.reasons is frozen');
  assert(Object.isFrozen(evalResult.structuredReasons), 'RiskEvaluationResult.structuredReasons is frozen');
  assert(Object.isFrozen(evalResult.matchedRules), 'RiskEvaluationResult.matchedRules is frozen');
}

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n============================================================');
console.log(`TOTAL CONTRACT TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
}
