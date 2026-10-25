/**
 * Guardrail Deterministic Rule Precedence & Consolidated Evaluation Suite
 *
 * Comprehensive verification of the consolidated risk and response evaluation pipeline:
 * 1. Independent validation of individual risk and response rules.
 * 2. Deterministic priority-ordered execution when multiple rules match.
 * 3. Strict precedence hierarchy: PROTECT (300) > WARN (200) > ALLOW (100).
 * 4. Monotonic protection invariant: ordinary warnings CANNOT downgrade a PROTECT decision.
 * 5. Deterministic tie-breaking for conflicting rules with equal action severity.
 * 6. Resilience and fail-closed isolation against throwing, null, or corrupted rule results.
 * 7. End-to-end integration via the centralized evaluateActionPipeline.
 * 8. Pure in-memory execution without DOM or window dependencies.
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import {
  RiskAssessment,
  RiskEvaluationStatus,
  RiskLevel,
  RiskSignalId,
} from '../types/risk.js';
import {
  ResponseAction,
  ResponseDecision,
} from '../types/response.js';
import {
  clampRiskScore,
  evaluateAllRiskRules,
  INITIAL_RISK_RULES,
  RiskRule,
} from './rules.js';
import {
  assessRisk,
  DEFAULT_RISK_THRESHOLDS,
  determineRiskLevel,
  RiskEngine,
} from './engine.js';
import {
  CoreRiskLevelResponseRule,
  CriticalRiskProtectionRule,
  DEFAULT_RESPONSE_RULES,
  evaluateAllResponseRules,
  evaluateResponseAction,
  resolveResponsePrecedence,
  RESPONSE_ACTION_PRECEDENCE,
  ResponseRule,
} from '../response/rules.js';
import {
  decideResponse,
  evaluateActionPipeline,
  evaluateRiskAndDecision,
  ResponseEngine,
} from '../response/engine.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message} (expected: ${String(expected)}, got: ${String(actual)})`);
  }
}

console.log('============================================================');
console.log('🧪 GUARDRAIL RULE PRECEDENCE & CONSOLIDATED EVALUATION SUITE');
console.log('============================================================');

// =============================================================================
// SUITE 1: Individual Risk Rules Testing
// =============================================================================
console.log('\n▶ Suite 1: Individual Risk Rules Testing');
{
  const makeAction = (text: string, category?: ActionCategory, url?: string): GuardrailAction => ({
    id: 'act-rule-test',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: text },
    page: { url: url || 'https://app.example.com', title: 'Test Page' },
    category,
    timestamp: new Date().toISOString(),
  });

  // 1. Destructive Rule
  const destructiveRule = INITIAL_RISK_RULES.find((r) => r.id === 'RISK_RULE_DESTRUCTIVE')!;
  assert(Boolean(destructiveRule), 'RISK_RULE_DESTRUCTIVE exists in registry');
  assertEquals(destructiveRule.priority, 100, 'Destructive rule has priority 100');
  assertEquals(destructiveRule.signalId, RiskSignalId.DESTRUCTIVE_ACTION, 'Destructive rule maps to DESTRUCTIVE_ACTION');

  const destMatch = destructiveRule.evaluate({ action: makeAction('Delete Profile') });
  assert(destMatch.matched === true, 'Destructive rule matches "Delete Profile"');
  assertEquals(destMatch.scoreContribution, 50, 'Destructive rule contributes +50');
  assertEquals(destMatch.ruleId, 'RISK_RULE_DESTRUCTIVE', 'Destructive rule returns ruleId');

  const destNonMatch = destructiveRule.evaluate({ action: makeAction('View Profile') });
  assert(destNonMatch.matched === false, 'Destructive rule does not match benign text');

  // 2. Payment Rule
  const paymentRule = INITIAL_RISK_RULES.find((r) => r.id === 'RISK_RULE_PAYMENT')!;
  assert(Boolean(paymentRule), 'RISK_RULE_PAYMENT exists in registry');
  assertEquals(paymentRule.priority, 90, 'Payment rule has priority 90');
  const payMatch = paymentRule.evaluate({ action: makeAction('Checkout Now') });
  assert(payMatch.matched === true, 'Payment rule matches "Checkout Now"');
  assertEquals(payMatch.scoreContribution, 40, 'Payment rule contributes +40');
  assertEquals(payMatch.ruleId, 'RISK_RULE_PAYMENT', 'Payment rule returns ruleId');

  // 3. Authentication Rule
  const authRule = INITIAL_RISK_RULES.find((r) => r.id === 'RISK_RULE_AUTHENTICATION')!;
  assert(Boolean(authRule), 'RISK_RULE_AUTHENTICATION exists in registry');
  assertEquals(authRule.priority, 80, 'Auth rule has priority 80');
  const authMatch = authRule.evaluate({ action: makeAction('Sign In with Password') });
  assert(authMatch.matched === true, 'Auth rule matches "Sign In"');
  assertEquals(authMatch.scoreContribution, 20, 'Auth rule contributes +20');

  // 4. External Navigation Rule
  const navRule = INITIAL_RISK_RULES.find((r) => r.id === 'RISK_RULE_EXTERNAL_NAVIGATION')!;
  assert(Boolean(navRule), 'RISK_RULE_EXTERNAL_NAVIGATION exists in registry');
  assertEquals(navRule.priority, 70, 'External nav rule has priority 70');
  const navAction: GuardrailAction = {
    ...makeAction('Leave'),
    page: {
      url: 'https://thirdparty.com/landing',
      previousUrl: 'https://app.example.com/dashboard',
      title: 'Third Party',
    },
  };
  const navMatch = navRule.evaluate({ action: navAction });
  assert(navMatch.matched === true, 'External navigation rule matches cross-origin navigation');
  assertEquals(navMatch.scoreContribution, 20, 'External nav rule contributes +20');

  // 5. Download Rule
  const downRule = INITIAL_RISK_RULES.find((r) => r.id === 'RISK_RULE_DOWNLOAD')!;
  assert(Boolean(downRule), 'RISK_RULE_DOWNLOAD exists in registry');
  assertEquals(downRule.priority, 60, 'Download rule has priority 60');
  const downMatch = downRule.evaluate({ action: makeAction('Export Reports to CSV') });
  assert(downMatch.matched === true, 'Download rule matches "Export Reports"');
  assertEquals(downMatch.scoreContribution, 10, 'Download rule contributes +10');
}

// =============================================================================
// SUITE 2: Multiple Matching Risk Rules & Priority-Ordered Execution
// =============================================================================
console.log('\n▶ Suite 2: Multiple Matching Risk Rules & Priority-Ordered Execution');
{
  // Compound action: Delete payment method (matches DESTRUCTIVE and PAYMENT)
  const compoundAction: GuardrailAction = {
    id: 'act-compound-multirule',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Delete Payment Method and Cancel Purchase' },
    page: { url: 'https://store.example.com/billing', title: 'Billing Settings' },
    timestamp: new Date().toISOString(),
  };

  const results = evaluateAllRiskRules({ action: compoundAction });
  assert(results.length >= 2, `Multiple rules matched (found: ${results.length})`);

  // Verify priority ordering: Destructive (100) must appear before Payment (90)
  const firstRule = results[0];
  const secondRule = results[1];
  assertEquals(firstRule.ruleId, 'RISK_RULE_DESTRUCTIVE', 'Higher priority rule evaluated first (DESTRUCTIVE)');
  assertEquals(secondRule.ruleId, 'RISK_RULE_PAYMENT', 'Lower priority rule evaluated second (PAYMENT)');

  // Evaluate through RiskEngine: verify matchedRules retains priority ordering
  const assessment = assessRisk(compoundAction);
  assert(Boolean(assessment.matchedRules), 'Assessment includes matchedRules');
  assertEquals(assessment.matchedRules![0].ruleId, 'RISK_RULE_DESTRUCTIVE', 'matchedRules[0] is highest priority DESTRUCTIVE');
  assertEquals(assessment.matchedRules![1].ruleId, 'RISK_RULE_PAYMENT', 'matchedRules[1] is PAYMENT');

  // Verify cumulative scoring: 50 (Destructive) + 40 (Payment) = 90
  assertEquals(assessment.score, 90, 'Score is deterministic sum of matched signals (50 + 40 = 90)');
  assertEquals(assessment.riskLevel, RiskLevel.CRITICAL, 'Score 90 maps to CRITICAL risk');

  // Verify signal deduplication: If custom rules trigger same signal, highest score retained
  const duplicateSignalRule1: RiskRule = {
    id: 'RULE_CUSTOM_PAYMENT_LIGHT',
    signalId: RiskSignalId.PAYMENT_ACTION,
    priority: 85,
    description: 'Minor payment touchpoint',
    evaluate: () => ({ matched: true, signalId: RiskSignalId.PAYMENT_ACTION, scoreContribution: 15, reason: 'Light payment' }),
  };
  const duplicateSignalRule2: RiskRule = {
    id: 'RULE_CUSTOM_PAYMENT_HEAVY',
    signalId: RiskSignalId.PAYMENT_ACTION,
    priority: 95,
    description: 'Heavy payment touchpoint',
    evaluate: () => ({ matched: true, signalId: RiskSignalId.PAYMENT_ACTION, scoreContribution: 45, reason: 'Heavy payment' }),
  };

  const customEngine = new RiskEngine({ rules: [duplicateSignalRule1, duplicateSignalRule2] });
  const dedupAssessment = customEngine.assess(compoundAction);
  assertEquals(dedupAssessment.score, 45, 'Deduplicates identical signals retaining highest contribution (45 vs 15)');
}

// =============================================================================
// SUITE 3: Individual Response Rules Testing
// =============================================================================
console.log('\n▶ Suite 3: Individual Response Rules Testing');
{
  const makeAssessment = (level: RiskLevel, score: number): RiskAssessment => ({
    actionId: 'act-resp-test',
    score,
    riskLevel: level,
    reasons: ['Test reason'],
    evaluatedAt: new Date().toISOString(),
  });

  // 1. CoreRiskLevelResponseRule
  assertEquals(CoreRiskLevelResponseRule.id, 'RULE_CORE_RISK_LEVEL_RESPONSE', 'Core response rule id matches');
  assertEquals(CoreRiskLevelResponseRule.priority, 100, 'Core response rule has priority 100');

  const lowResp = CoreRiskLevelResponseRule.evaluate({ assessment: makeAssessment(RiskLevel.LOW, 0) });
  assertEquals(lowResp.action, ResponseAction.ALLOW, 'LOW risk evaluates to ALLOW');

  const medResp = CoreRiskLevelResponseRule.evaluate({ assessment: makeAssessment(RiskLevel.MEDIUM, 30) });
  assertEquals(medResp.action, ResponseAction.WARN, 'MEDIUM risk evaluates to WARN');

  const highResp = CoreRiskLevelResponseRule.evaluate({ assessment: makeAssessment(RiskLevel.HIGH, 60) });
  assertEquals(highResp.action, ResponseAction.WARN, 'HIGH risk evaluates to WARN');

  const critResp = CoreRiskLevelResponseRule.evaluate({ assessment: makeAssessment(RiskLevel.CRITICAL, 85) });
  assertEquals(critResp.action, ResponseAction.PROTECT, 'CRITICAL risk evaluates to PROTECT');

  // 2. CriticalRiskProtectionRule
  assertEquals(CriticalRiskProtectionRule.id, 'RULE_CRITICAL_RISK_PROTECTION', 'Critical protection rule id matches');
  assertEquals(CriticalRiskProtectionRule.priority, 200, 'Critical protection rule has priority 200');

  const critProtect = CriticalRiskProtectionRule.evaluate({ assessment: makeAssessment(RiskLevel.CRITICAL, 90) });
  assert(critProtect !== null && critProtect.action === ResponseAction.PROTECT, 'CriticalRiskProtectionRule yields PROTECT for CRITICAL');

  const nonCritProtect = CriticalRiskProtectionRule.evaluate({ assessment: makeAssessment(RiskLevel.LOW, 10) });
  assert(nonCritProtect === null, 'CriticalRiskProtectionRule returns null for non-critical assessment');
}

// =============================================================================
// SUITE 4: Response Rule Precedence & Monotonic Protection Invariant
// =============================================================================
console.log('\n▶ Suite 4: Response Rule Precedence & Monotonic Protection Invariant');
{
  // Verify Precedence Constants
  assertEquals(RESPONSE_ACTION_PRECEDENCE[ResponseAction.PROTECT], 300, 'PROTECT precedence is 300');
  assertEquals(RESPONSE_ACTION_PRECEDENCE[ResponseAction.WARN], 200, 'WARN precedence is 200');
  assertEquals(RESPONSE_ACTION_PRECEDENCE[ResponseAction.ALLOW], 100, 'ALLOW precedence is 100');
  assert(
    RESPONSE_ACTION_PRECEDENCE[ResponseAction.PROTECT] > RESPONSE_ACTION_PRECEDENCE[ResponseAction.WARN] &&
    RESPONSE_ACTION_PRECEDENCE[ResponseAction.WARN] > RESPONSE_ACTION_PRECEDENCE[ResponseAction.ALLOW],
    'Precedence strictly satisfies: PROTECT > WARN > ALLOW'
  );

  // Case 1: Conflicting rules - Rule A yields PROTECT, Rule B yields WARN
  const outcomesConflict1 = [
    { action: ResponseAction.WARN, reason: 'Advisory notice', ruleId: 'RULE_ADVISORY', rulePriority: 150 },
    { action: ResponseAction.PROTECT, reason: 'Protective stop', ruleId: 'RULE_PROTECT_HARD', rulePriority: 100 },
  ];
  const resolvedConflict1 = resolveResponsePrecedence(outcomesConflict1);
  assertEquals(resolvedConflict1.action, ResponseAction.PROTECT, 'PROTECT takes absolute precedence over WARN');
  assertEquals(resolvedConflict1.ruleId, 'RULE_PROTECT_HARD', 'Winning ruleId is the rule yielding PROTECT');

  // Case 2: Monotonic Protection - An ordinary warning CANNOT silently downgrade a protection decision
  const outcomesConflict2 = [
    { action: ResponseAction.ALLOW, reason: 'Routine path', ruleId: 'RULE_ALLOW', rulePriority: 250 },
    { action: ResponseAction.WARN, reason: 'Caution', ruleId: 'RULE_WARN', rulePriority: 200 },
    { action: ResponseAction.PROTECT, reason: 'Critical quarantine', ruleId: 'RULE_PROTECT', rulePriority: 50 },
  ];
  const resolvedConflict2 = resolveResponsePrecedence(outcomesConflict2);
  assertEquals(resolvedConflict2.action, ResponseAction.PROTECT, 'Protection preserved even if lower rule priority than WARN/ALLOW');
  assert(resolvedConflict2.action !== ResponseAction.WARN, 'Ordinary warning strictly prevented from downgrading PROTECT');
  assert(resolvedConflict2.action !== ResponseAction.ALLOW, 'Allow strictly prevented from downgrading PROTECT');

  // Case 3: WARN takes precedence over ALLOW
  const outcomesWarnVsAllow = [
    { action: ResponseAction.ALLOW, reason: 'Allow general click', ruleId: 'RULE_GENERAL', rulePriority: 200 },
    { action: ResponseAction.WARN, reason: 'Warn financial transaction', ruleId: 'RULE_PAYMENT_WARN', rulePriority: 100 },
  ];
  const resolvedWarn = resolveResponsePrecedence(outcomesWarnVsAllow);
  assertEquals(resolvedWarn.action, ResponseAction.WARN, 'WARN takes precedence over ALLOW');

  // Case 4: Tie-breaking - Multiple rules produce the SAME highest action (PROTECT)
  // Rule with higher priority wins primary ruleId
  const outcomesTieProtect = [
    { action: ResponseAction.PROTECT, reason: 'Protection from Rule Low', ruleId: 'RULE_PROT_LOW_PRIO', rulePriority: 100 },
    { action: ResponseAction.PROTECT, reason: 'Protection from Rule High', ruleId: 'RULE_PROT_HIGH_PRIO', rulePriority: 250 },
  ];
  const resolvedTie = resolveResponsePrecedence(outcomesTieProtect);
  assertEquals(resolvedTie.action, ResponseAction.PROTECT, 'Action is PROTECT');
  assertEquals(resolvedTie.ruleId, 'RULE_PROT_HIGH_PRIO', 'Tie-break selects highest rulePriority (250 vs 100)');
  assert(resolvedTie.allReasons.length === 2, 'All reasons preserved across tied matching rules');

  // Case 5: Complete audit trail retention
  assert(resolvedConflict1.matchedRuleIds.includes('RULE_ADVISORY'), 'Preserves overridden ruleId in matchedRuleIds');
  assert(resolvedConflict1.matchedRuleIds.includes('RULE_PROTECT_HARD'), 'Preserves winning ruleId in matchedRuleIds');
}

// =============================================================================
// SUITE 5: Deterministic Outcomes Across Repetitive & Interleaved Evaluations
// =============================================================================
console.log('\n▶ Suite 5: Deterministic Outcomes Across Repetitive & Interleaved Evaluations');
{
  const testAction: GuardrailAction = {
    id: 'act-deterministic-1',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Confirm Transfer' },
    page: { url: 'https://bank.example.com/transfer', title: 'Transfer Funds' },
    timestamp: '2026-10-26T00:00:00.000Z',
  };

  const firstRun = evaluateActionPipeline(testAction);
  let allIdentical = true;

  for (let i = 0; i < 50; i++) {
    const run = evaluateActionPipeline(testAction);
    if (
      run.risk.score !== firstRun.risk.score ||
      run.risk.riskLevel !== firstRun.risk.riskLevel ||
      run.decision.response !== firstRun.decision.response ||
      run.decision.policyRuleId !== firstRun.decision.policyRuleId ||
      run.risk.reasons.length !== firstRun.risk.reasons.length
    ) {
      allIdentical = false;
      break;
    }
  }

  assert(allIdentical, 'Evaluation across 50 consecutive runs is 100% deterministic and bit-for-bit identical');
}

// =============================================================================
// SUITE 6: Robust Error Handling & Invalid Rule Results (Fail-Closed Safety)
// =============================================================================
console.log('\n▶ Suite 6: Robust Error Handling & Invalid Rule Results (Fail-Closed Safety)');
{
  const action: GuardrailAction = {
    id: 'act-resilience-1',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Click Me' },
    page: { url: 'https://example.com', title: 'Example' },
    timestamp: new Date().toISOString(),
  };

  // 1. Rule that throws an unhandled exception
  const throwingRule: RiskRule = {
    id: 'RULE_CRASHING',
    signalId: RiskSignalId.DESTRUCTIVE_ACTION,
    priority: 100,
    description: 'Rule that throws',
    evaluate: () => {
      throw new Error('Simulated internal rule crash');
    },
  };
  const safeRule: RiskRule = {
    id: 'RULE_BENIGN',
    signalId: RiskSignalId.DOWNLOAD_ACTION,
    priority: 50,
    description: 'Safe rule',
    evaluate: () => ({ matched: true, signalId: RiskSignalId.DOWNLOAD_ACTION, scoreContribution: 10 }),
  };

  const results = evaluateAllRiskRules({ action }, undefined, [throwingRule, safeRule]);
  assertEquals(results.length, 1, 'Safely catches throwing rule exception without halting pipeline');
  assertEquals(results[0].ruleId, 'RULE_BENIGN', 'Remaining valid rule evaluated successfully');

  // 2. Rule returning invalid/out-of-bounds score
  const outOfBoundsRule: RiskRule = {
    id: 'RULE_CORRUPT_SCORE',
    signalId: RiskSignalId.PAYMENT_ACTION,
    priority: 90,
    description: 'Corrupt score rule',
    evaluate: () => ({ matched: true, signalId: RiskSignalId.PAYMENT_ACTION, scoreContribution: 9999 }),
  };
  const oobResults = evaluateAllRiskRules({ action }, undefined, [outOfBoundsRule]);
  assertEquals(oobResults[0].scoreContribution, 100, 'Clamps corrupt score contribution to 100');

  // 3. Response rule throwing exception
  const throwingResponseRule: ResponseRule = {
    id: 'RULE_RESP_CRASH',
    name: 'Crashing Response Rule',
    description: 'Throws',
    priority: 500,
    evaluate: () => {
      throw new Error('Response rule crash');
    },
  };
  const respResolution = evaluateAllResponseRules(
    { assessment: { actionId: 'act-1', score: 0, riskLevel: RiskLevel.LOW, reasons: [], evaluatedAt: '' } },
    [throwingResponseRule, CoreRiskLevelResponseRule]
  );
  assertEquals(respResolution.action, ResponseAction.ALLOW, 'Isolates crashing response rule and applies remaining valid rules');

  // 4. Upstream evaluation failure strictly resolves fail-closed to PROTECT
  const failedAssessment: RiskAssessment = {
    actionId: 'act-failed-payload',
    score: 100,
    riskLevel: RiskLevel.CRITICAL,
    reasons: ['Evaluation failed'],
    evaluatedAt: '',
    status: RiskEvaluationStatus.FAILED,
    success: false,
  };
  const failedDecision = decideResponse(failedAssessment);
  assertEquals(failedDecision.response, ResponseAction.PROTECT, 'Decision on failed assessment strictly resolves fail-closed to PROTECT');
  assertEquals(failedDecision.policyRuleId, 'RULE_FAIL_CLOSED_FALLBACK', 'Policy rule is RULE_FAIL_CLOSED_FALLBACK');
}

// =============================================================================
// SUITE 7: Centralized Evaluator (evaluateActionPipeline) Integration
// =============================================================================
console.log('\n▶ Suite 7: Centralized Evaluator (evaluateActionPipeline) Integration');
{
  const testPaymentAction: GuardrailAction = {
    id: 'act-central-pipeline-1',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Pay $49.99' },
    page: { url: 'https://checkout.example.com', title: 'Checkout' },
    timestamp: new Date().toISOString(),
  };

  const pipeline = evaluateActionPipeline(testPaymentAction);

  // 1. Classification check
  assert(Boolean(pipeline.classification), 'Produces classification');
  assertEquals(pipeline.classification.category, ActionCategory.PAYMENT, 'Classified as PAYMENT');
  assertEquals(pipeline.classification.actionId, 'act-central-pipeline-1', 'classification actionId matches');

  // 2. Risk assessment check
  assert(Boolean(pipeline.risk), 'Produces risk assessment');
  assertEquals(pipeline.risk.score, 40, 'Risk score is 40');
  assertEquals(pipeline.risk.riskLevel, RiskLevel.MEDIUM, 'Risk level is MEDIUM');
  assertEquals(pipeline.risk.actionId, 'act-central-pipeline-1', 'risk actionId matches');

  // 3. Response decision check
  assert(Boolean(pipeline.decision), 'Produces response decision');
  assertEquals(pipeline.decision.response, ResponseAction.WARN, 'Response decision is WARN');
  assertEquals(pipeline.decision.actionId, 'act-central-pipeline-1', 'decision actionId matches');

  // 4. Unified evaluation result contract check
  assert(Boolean(pipeline.evaluationResult), 'Produces unified RiskEvaluationResult');
  assertEquals(pipeline.evaluationResult.decision, ResponseAction.WARN, 'Unified contract decision is WARN');
  assertEquals(pipeline.evaluationResult.status, RiskEvaluationStatus.EVALUATED, 'Status is EVALUATED');
  assertEquals(pipeline.evaluationResult.success, true, 'Success is true');
  assertEquals(pipeline.evaluationResult.actionId, 'act-central-pipeline-1', 'unified actionId matches');

  // 5. Test Critical Action routed through centralized evaluator
  const testDestructiveAction: GuardrailAction = {
    id: 'act-central-dest-1',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Delete Database and Cancel Checkout' },
    page: { url: 'https://admin.example.com/danger', title: 'Admin' },
    timestamp: new Date().toISOString(),
  };
  const destPipeline = evaluateActionPipeline(testDestructiveAction);
  assertEquals(destPipeline.decision.response, ResponseAction.PROTECT, 'Centralized evaluator routes compound action to PROTECT');
  assertEquals(destPipeline.risk.riskLevel, RiskLevel.CRITICAL, 'Assigned CRITICAL risk level');
}

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n============================================================');
console.log(`TOTAL PRECEDENCE TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================');

if (failed > 0) {
  process.exit(1);
}
