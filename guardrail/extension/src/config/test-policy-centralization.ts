/**
 * Guardrail Centralized Risk-Policy Configuration Integration Tests
 *
 * Verifies that all risk engine, response engine, policy evaluation,
 * and continuation validation components dynamically consume the central
 * configuration registry rather than maintaining independent or hardcoded copies.
 *
 * TEST REQUIREMENTS VERIFIED:
 * 1. Policy consumers (RiskEngine, ResponseEngine, policies, validation-service) use central configuration.
 * 2. Default behavior and thresholds remain identical to safe baseline defaults.
 * 3. Duplicated definitions and magic numbers (75, 24, signal weights) derive dynamically from central config.
 * 4. Changing thresholds or signal weights in the registry dynamically updates evaluated risk scores and levels.
 * 5. Configured policy decisions and enabled/disabled flags take effect dynamically.
 * 6. Mandatory safety invariants (CONTROLLED_DESTRUCTIVE, UNSUPPORTED_BOUNDARY_GUARD) cannot be disabled or downgraded.
 * 7. Trusted domain allowlist dynamically exempts trusted origins from external navigation warnings.
 * 8. Invalid configuration safely falls back to fail-closed defaults via setConfigSafe().
 * 9. Browser-side configuration cannot override authoritative backend approval decisions (Condition 2).
 * 10. Disagreements between backend and extension policy revalidation fail closed (Condition 10).
 */

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { ActionClassificationResult } from '../types/classification.js';
import { ResponseAction } from '../types/response.js';
import { RiskAssessment, RiskLevel, RiskSignalId } from '../types/risk.js';
import { RiskPolicyId } from '../types/policy.js';
import { GuardrailPolicyConfig } from '../types/config.js';

// Central configuration registry & schema
import {
  policyConfigRegistry,
  getActivePolicyConfig,
  getRiskThresholds,
  getCriticalThresholdScore,
  getRoutineThresholdMax,
  getSignalContribution,
  isSignalEnabled,
  getPolicyRule,
  isPolicyEnabled,
  getPolicyDecision,
  isTrustedDomain,
  getTimeouts,
} from './registry.js';
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  getSafeDefaultPolicyConfig,
  assertValidPolicyConfig,
  PolicyConfigValidationError,
} from './schema.js';

// Risk & Response Engine consumers
import {
  assessRisk,
  determineRiskLevel,
  RiskEngine,
  DEFAULT_RISK_THRESHOLDS,
} from '../risk/engine.js';
import { getRiskSignalDefinition, INITIAL_RISK_SIGNALS } from '../risk/signals.js';
import {
  evaluatePolicies,
  CONTROLLED_DESTRUCTIVE_POLICY,
  CONTROLLED_PAYMENT_POLICY,
  EXTERNAL_NAVIGATION_POLICY,
  ROUTINE_INTERACTION_POLICY,
  UNSUPPORTED_BOUNDARY_GUARD_POLICY,
} from '../response/policies.js';
import {
  CriticalRiskProtectionRule,
  DEFAULT_RESPONSE_RULES,
  resolveResponsePrecedence,
} from '../response/rules.js';
import {
  ResponseEngine,
  evaluateActionPipeline,
} from '../response/engine.js';
import {
  ContinuationValidationService,
  ContinuationEligibilityStatus,
} from '../interception/validation-service.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import { ApprovalService } from '../approval/service.js';
import { ActorRole, AuthContext } from '../approval/authorization.js';

// =============================================================================
// Test Assertions & Runner
// =============================================================================

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    totalPassed++;
    console.log(`  ✓ ${message}`);
  } else {
    totalFailed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  const pass = actual === expected;
  if (pass) {
    totalPassed++;
    console.log(`  ✓ ${message}`);
  } else {
    totalFailed++;
    console.error(`  ✗ FAIL: ${message} - Expected: ${String(expected)}, Got: ${String(actual)}`);
  }
}

console.log('======================================================================');
console.log('🧪 GUARDRAIL CENTRALIZED RISK-POLICY CONFIGURATION TEST SUITE');
console.log('======================================================================');

// Ensure clean state before running
policyConfigRegistry.resetToDefault();

// =============================================================================
// Group 1: Central Registry Singleton & Default Values
// =============================================================================
console.log('\n▶ Group 1: Central Registry Singleton & Default Values');
{
  const activeCfg = getActivePolicyConfig();
  assertEquals(activeCfg.schemaVersion, '1.0.0', 'Active schema version is 1.0.0');
  assertEquals(activeCfg.policyVersion, '1.0.0', 'Active policy version is 1.0.0');

  // Verify thresholds match defaults
  const thresholds = getRiskThresholds();
  assertEquals(thresholds.lowMax, 24, 'Default lowMax is 24');
  assertEquals(thresholds.mediumMax, 49, 'Default mediumMax is 49');
  assertEquals(thresholds.highMax, 74, 'Default highMax is 74');

  // Dynamic threshold derivation (No hardcoded magic numbers)
  assertEquals(getCriticalThresholdScore(), 75, 'Critical threshold score is dynamically highMax + 1 = 75');
  assertEquals(getRoutineThresholdMax(), 24, 'Routine threshold score max is dynamically lowMax = 24');

  // Signal contributions match defaults
  assertEquals(getSignalContribution(RiskSignalId.DESTRUCTIVE_ACTION), 50, 'DESTRUCTIVE signal contribution is 50');
  assertEquals(getSignalContribution(RiskSignalId.PAYMENT_ACTION), 40, 'PAYMENT signal contribution is 40');
  assertEquals(getSignalContribution(RiskSignalId.AUTHENTICATION_ACTION), 20, 'AUTHENTICATION signal contribution is 20');
  assertEquals(getSignalContribution(RiskSignalId.EXTERNAL_NAVIGATION), 20, 'EXTERNAL_NAVIGATION signal contribution is 20');
  assertEquals(getSignalContribution(RiskSignalId.DOWNLOAD_ACTION), 10, 'DOWNLOAD signal contribution is 10');

  // Signals are all enabled by default
  assert(isSignalEnabled(RiskSignalId.DESTRUCTIVE_ACTION), 'DESTRUCTIVE signal is enabled by default');
  assert(isSignalEnabled(RiskSignalId.PAYMENT_ACTION), 'PAYMENT signal is enabled by default');

  // Policy rules exist and have expected defaults
  assert(isPolicyEnabled(RiskPolicyId.CONTROLLED_DESTRUCTIVE), 'CONTROLLED_DESTRUCTIVE policy is enabled');
  assertEquals(getPolicyDecision(RiskPolicyId.CONTROLLED_DESTRUCTIVE), ResponseAction.PROTECT, 'CONTROLLED_DESTRUCTIVE default decision is PROTECT');
  assertEquals(getPolicyDecision(RiskPolicyId.CONTROLLED_PAYMENT), ResponseAction.WARN, 'CONTROLLED_PAYMENT default decision is WARN');
  assertEquals(getPolicyDecision(RiskPolicyId.ROUTINE_INTERACTION), ResponseAction.ALLOW, 'ROUTINE_INTERACTION default decision is ALLOW');

  // Timeouts match defaults
  const timeouts = getTimeouts();
  assertEquals(timeouts.approvalTtlSeconds, 3600, 'approvalTtlSeconds is 3600s');
  assertEquals(timeouts.dashboardPollIntervalMs, 10000, 'dashboardPollIntervalMs is 10000ms');

  // Baseline signals in signals.ts sourced directly from config defaults
  assertEquals(
    INITIAL_RISK_SIGNALS[RiskSignalId.DESTRUCTIVE_ACTION].scoreContribution,
    DEFAULT_GUARDRAIL_POLICY_CONFIG.signals[RiskSignalId.DESTRUCTIVE_ACTION].scoreContribution,
    'INITIAL_RISK_SIGNALS DESTRUCTIVE weight sourced from config'
  );
  assertEquals(
    INITIAL_RISK_SIGNALS[RiskSignalId.PAYMENT_ACTION].scoreContribution,
    DEFAULT_GUARDRAIL_POLICY_CONFIG.signals[RiskSignalId.PAYMENT_ACTION].scoreContribution,
    'INITIAL_RISK_SIGNALS PAYMENT weight sourced from config'
  );
}

// =============================================================================
// Group 2: RiskEngine Dynamic Consumption & Overrides
// =============================================================================
console.log('\n▶ Group 2: RiskEngine Dynamic Consumption & Overrides');
{
  const testPaymentAction: GuardrailAction = {
    id: 'act-dyn-risk-001',
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    category: ActionCategory.PAYMENT,
    element: { tagName: 'BUTTON', id: 'pay-btn', visibleText: 'Pay Now' },
    page: { url: 'https://shop.example.com/checkout', title: 'Checkout' },
  };
  const paymentClassification: ActionClassificationResult = {
    actionId: testPaymentAction.id,
    category: ActionCategory.PAYMENT,
    matchedSignals: [RiskSignalId.PAYMENT_ACTION],
    confidence: 0.9,
    reasons: ['Payment interaction'],
  };

  // 1. Default evaluation
  const defaultEngine = new RiskEngine();
  const defaultAssessment = defaultEngine.assess(testPaymentAction, paymentClassification);
  assertEquals(defaultAssessment.score, 40, 'Default payment action evaluates to score 40');
  assertEquals(defaultAssessment.riskLevel, RiskLevel.MEDIUM, 'Score 40 evaluates to MEDIUM risk level (25-49)');

  // 2. Dynamically change active config signal weight
  const modifiedConfig: GuardrailPolicyConfig = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    signals: {
      ...DEFAULT_GUARDRAIL_POLICY_CONFIG.signals,
      [RiskSignalId.PAYMENT_ACTION]: {
        id: RiskSignalId.PAYMENT_ACTION,
        enabled: true,
        scoreContribution: 60, // Elevated from 40 to 60
      },
    },
  };
  policyConfigRegistry.setConfig(modifiedConfig);

  // New assessment dynamically picks up registry weight without restarting or passing explicit options
  const dynamicAssessment = defaultEngine.assess(testPaymentAction, paymentClassification);
  assertEquals(dynamicAssessment.score, 60, 'Dynamic assessment picked up 60 score contribution from registry');
  assertEquals(dynamicAssessment.riskLevel, RiskLevel.HIGH, 'Score 60 evaluates to HIGH risk level (50-74)');

  // 3. Dynamically disable signal in central config
  const disabledSignalConfig: GuardrailPolicyConfig = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    signals: {
      ...DEFAULT_GUARDRAIL_POLICY_CONFIG.signals,
      [RiskSignalId.PAYMENT_ACTION]: {
        id: RiskSignalId.PAYMENT_ACTION,
        enabled: false,
        scoreContribution: 40,
      },
    },
  };
  policyConfigRegistry.setConfig(disabledSignalConfig);

  const disabledAssessment = defaultEngine.assess(testPaymentAction, paymentClassification);
  assertEquals(disabledAssessment.score, 0, 'Disabled signal contributes 0 to risk score');
  assertEquals(disabledAssessment.riskLevel, RiskLevel.LOW, 'Score 0 evaluates to LOW risk level');

  // Reset to default
  policyConfigRegistry.resetToDefault();
  assertEquals(defaultEngine.assess(testPaymentAction, paymentClassification).score, 40, 'Reset restored baseline score 40');
}

// =============================================================================
// Group 3: Dynamic Threshold Boundaries (No Magic Numbers)
// =============================================================================
console.log('\n▶ Group 3: Dynamic Threshold Boundaries (No Magic Numbers)');
{
  // 1. Default thresholds
  assertEquals(determineRiskLevel(24), RiskLevel.LOW, 'Score 24 is LOW risk by default');
  assertEquals(determineRiskLevel(25), RiskLevel.MEDIUM, 'Score 25 is MEDIUM risk by default');
  assertEquals(determineRiskLevel(49), RiskLevel.MEDIUM, 'Score 49 is MEDIUM risk by default');
  assertEquals(determineRiskLevel(50), RiskLevel.HIGH, 'Score 50 is HIGH risk by default');
  assertEquals(determineRiskLevel(74), RiskLevel.HIGH, 'Score 74 is HIGH risk by default');
  assertEquals(determineRiskLevel(75), RiskLevel.CRITICAL, 'Score 75 is CRITICAL risk by default');

  // 2. Adjust thresholds centrally: lower HIGH threshold to 60 and CRITICAL to 65
  const shiftedThresholdConfig: GuardrailPolicyConfig = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    thresholds: {
      lowMax: 30,
      mediumMax: 50,
      highMax: 64, // CRITICAL will now start at 65 (highMax + 1)
    },
  };
  policyConfigRegistry.setConfig(shiftedThresholdConfig);

  assertEquals(getRiskThresholds().lowMax, 30, 'Centrally updated lowMax is 30');
  assertEquals(getCriticalThresholdScore(), 65, 'Centrally updated critical score is dynamically 65');

  // determineRiskLevel derives dynamically from registry
  assertEquals(determineRiskLevel(30), RiskLevel.LOW, 'Score 30 is now LOW under updated thresholds');
  assertEquals(determineRiskLevel(31), RiskLevel.MEDIUM, 'Score 31 is now MEDIUM');
  assertEquals(determineRiskLevel(64), RiskLevel.HIGH, 'Score 64 is now HIGH');
  assertEquals(determineRiskLevel(65), RiskLevel.CRITICAL, 'Score 65 is now CRITICAL');

  // CriticalRiskProtectionRule consumes getCriticalThresholdScore() dynamically
  const ruleContextAt64 = {
    assessment: {
      actionId: 'act-crit-001',
      score: 64,
      riskLevel: RiskLevel.HIGH,
      reasons: [],
      evaluatedAt: new Date().toISOString(),
    },
  };
  const ruleContextAt65 = {
    assessment: {
      actionId: 'act-crit-002',
      score: 65,
      riskLevel: RiskLevel.CRITICAL,
      reasons: [],
      evaluatedAt: new Date().toISOString(),
    },
  };

  const outcome64 = CriticalRiskProtectionRule.evaluate(ruleContextAt64);
  assertEquals(outcome64, null, 'Score 64 does not trigger CriticalRiskProtectionRule');

  const outcome65 = CriticalRiskProtectionRule.evaluate(ruleContextAt65);
  assert(Boolean(outcome65), 'Score 65 triggers CriticalRiskProtectionRule');
  assertEquals(outcome65?.action, ResponseAction.PROTECT, 'Decision is PROTECT');

  // Reset to default
  policyConfigRegistry.resetToDefault();
  assertEquals(getCriticalThresholdScore(), 75, 'Reset restored critical threshold 75');
}

// =============================================================================
// Group 4: Centralized Policy Evaluation & Monotonic Precedence
// =============================================================================
console.log('\n▶ Group 4: Centralized Policy Evaluation & Monotonic Precedence');
{
  const checkoutAction: GuardrailAction = {
    id: 'act-pol-checkout-001',
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    category: ActionCategory.PAYMENT,
    element: { tagName: 'BUTTON', id: 'checkout-btn', visibleText: 'Checkout' },
    page: { url: 'https://shop.example.com/checkout', title: 'Checkout' },
  };

  // 1. Default policy evaluation -> WARN
  const defaultPolicyResults = evaluatePolicies(checkoutAction);
  const paymentMatch = defaultPolicyResults.find((p) => p.ruleId === 'RULE_PAYMENT_INTERACTION_POLICY');
  assert(Boolean(paymentMatch), 'Checkout action matched payment policy');
  assertEquals(paymentMatch?.decision, ResponseAction.WARN, 'Default payment policy decision is WARN');

  // 2. Centralized policy decision escalation: elevate CONTROLLED_PAYMENT to PROTECT
  const elevatedPaymentConfig: GuardrailPolicyConfig = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    policies: DEFAULT_GUARDRAIL_POLICY_CONFIG.policies.map((p) =>
      p.id === RiskPolicyId.CONTROLLED_PAYMENT
        ? {
            ...p,
            decision: ResponseAction.PROTECT,
            reasonCode: 'POLICY_PROTECT_PAYMENT_MANDATED',
            userExplanation: 'Organization policy mandates staging protection for all payment actions.',
          }
        : p
    ),
  };
  policyConfigRegistry.setConfig(elevatedPaymentConfig);

  const elevatedResults = evaluatePolicies(checkoutAction);
  const elevatedPaymentMatch = elevatedResults.find((p) => p.reasonCode === 'POLICY_PROTECT_PAYMENT_MANDATED');
  assert(Boolean(elevatedPaymentMatch), 'Payment match has elevated reason code');
  assertEquals(elevatedPaymentMatch?.decision, ResponseAction.PROTECT, 'Elevated payment policy decision is now PROTECT');

  // Full pipeline respects the central configuration
  const pipelineResult = evaluateActionPipeline(checkoutAction);
  assertEquals(pipelineResult.decision.response, ResponseAction.PROTECT, 'Pipeline resolved to PROTECT');

  // 3. Disabling an optional policy (EXTERNAL_NAVIGATION)
  const navAction: GuardrailAction = {
    id: 'act-ext-nav-001',
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    category: ActionCategory.NAVIGATION,
    element: { tagName: 'A', id: 'partner-link', visibleText: 'External Partner' },
    page: {
      url: 'https://partner.example.org/about',
      previousUrl: 'https://app.example.com/dashboard',
      title: 'Partner',
    },
  };

  // With default config, external navigation warns
  policyConfigRegistry.resetToDefault();
  const navResultsDefault = evaluatePolicies(navAction);
  assert(
    navResultsDefault.some((p) => p.ruleId === 'RULE_EXTERNAL_NAVIGATION_POLICY'),
    'External navigation warning fires by default'
  );

  // Disable EXTERNAL_NAVIGATION in central config
  const disabledNavConfig: GuardrailPolicyConfig = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    policies: DEFAULT_GUARDRAIL_POLICY_CONFIG.policies.map((p) =>
      p.id === RiskPolicyId.EXTERNAL_NAVIGATION ? { ...p, enabled: false } : p
    ),
  };
  policyConfigRegistry.setConfig(disabledNavConfig);

  const navResultsDisabled = evaluatePolicies(navAction);
  assert(
    !navResultsDisabled.some((p) => p.ruleId === 'RULE_EXTERNAL_NAVIGATION_POLICY'),
    'Disabled external navigation policy is skipped during evaluation'
  );

  policyConfigRegistry.resetToDefault();
}

// =============================================================================
// Group 5: Mandatory Security Invariants Cannot Be Weakened
// =============================================================================
console.log('\n▶ Group 5: Mandatory Security Invariants Cannot Be Weakened');
{
  const destructiveAction: GuardrailAction = {
    id: 'act-destroy-001',
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    category: ActionCategory.DESTRUCTIVE,
    element: { tagName: 'BUTTON', id: 'del-acc', visibleText: 'Delete Account Permanently' },
    page: { url: 'https://app.example.com/profile', title: 'Profile' },
  };

  // Schema validation rejects attempting to disable CONTROLLED_DESTRUCTIVE
  const invalidDisableDestructive = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    policies: DEFAULT_GUARDRAIL_POLICY_CONFIG.policies.map((p) =>
      p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE ? { ...p, enabled: false } : p
    ),
  };

  let threwValidation = false;
  try {
    assertValidPolicyConfig(invalidDisableDestructive);
  } catch (err) {
    threwValidation = true;
    assert(err instanceof PolicyConfigValidationError, 'Throws PolicyConfigValidationError for disabling destructive');
  }
  assert(threwValidation, 'Schema rejected candidate that attempted to disable destructive policy');

  // Even if a malformed config object bypasses schema validation, evaluatePolicies enforces immutable invariants
  const malformedConfigBypass = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    policies: DEFAULT_GUARDRAIL_POLICY_CONFIG.policies.map((p) =>
      p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE
        ? { ...p, enabled: false, decision: ResponseAction.ALLOW as any }
        : p
    ),
  } as unknown as GuardrailPolicyConfig;

  const bypassResults = evaluatePolicies(destructiveAction, undefined, malformedConfigBypass);
  const destructiveMatch = bypassResults.find((p) => p.ruleId === 'RULE_CONTROLLED_DESTRUCTIVE');
  assert(Boolean(destructiveMatch), 'Destructive policy still evaluated despite disabled attempt');
  assertEquals(destructiveMatch?.decision, ResponseAction.PROTECT, 'Decision strictly remains PROTECT (invariant preserved)');

  // Monotonic Protection Invariant: Compound payment PROTECT cannot be downgraded by configured WARN
  const compoundPaymentAction: GuardrailAction = {
    id: 'act-compound-pay-001',
    type: ActionType.SUBMIT,
    timestamp: new Date().toISOString(),
    category: ActionCategory.PAYMENT,
    element: { tagName: 'FORM', id: 'wire', visibleText: 'Send Wire' },
    page: { url: 'https://wire.example.com', title: 'Wire' },
  };
  const criticalAssessment: RiskAssessment = {
    actionId: compoundPaymentAction.id,
    score: 85,
    riskLevel: RiskLevel.CRITICAL,
    reasons: ['Critical wire transfer'],
    evaluatedAt: new Date().toISOString(),
  };

  const compoundResults = evaluatePolicies(compoundPaymentAction, criticalAssessment);
  const compoundMatch = compoundResults.find((p) => p.ruleId === 'RULE_PAYMENT_COMPOUND_PROTECT');
  assert(Boolean(compoundMatch), 'Compound payment matched compound protect rule');
  assertEquals(compoundMatch?.decision, ResponseAction.PROTECT, 'Compound payment evaluates strictly to PROTECT');
}

// =============================================================================
// Group 6: Trusted Domain Allowlist & Origin Boundary Normalization
// =============================================================================
console.log('\n▶ Group 6: Trusted Domain Allowlist & Origin Boundary Normalization');
{
  const extNavToPartner: GuardrailAction = {
    id: 'act-partner-nav-001',
    type: ActionType.NAVIGATION,
    timestamp: new Date().toISOString(),
    category: ActionCategory.NAVIGATION,
    element: { tagName: 'A', id: 'link-partner', visibleText: 'Authorized Partner Portal' },
    page: {
      url: 'https://trusted-portal.internal.example.com/login',
      previousUrl: 'https://main-app.internal.example.com/home',
      title: 'Partner Portal',
    },
  };

  // 1. Without allowlist -> Warning fires
  policyConfigRegistry.resetToDefault();
  const unconfiguredResults = evaluatePolicies(extNavToPartner);
  assert(
    unconfiguredResults.some((p) => p.ruleId === 'RULE_EXTERNAL_NAVIGATION_POLICY'),
    'Unlisted cross-origin navigation triggers external navigation warning'
  );

  // 2. Add domain to trustedDomains
  const allowlistConfig: GuardrailPolicyConfig = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    trustedDomains: ['trusted-portal.internal.example.com'],
  };
  policyConfigRegistry.setConfig(allowlistConfig);

  // isTrustedDomain helper normalizes correctly
  assert(isTrustedDomain('trusted-portal.internal.example.com'), 'Matches exact hostname');
  assert(isTrustedDomain('https://trusted-portal.internal.example.com/some/path?param=1'), 'Matches full URL');
  assert(isTrustedDomain('https://TRUSTED-PORTAL.INTERNAL.EXAMPLE.COM:8443/'), 'Matches case-insensitive and port');
  assert(!isTrustedDomain('malicious-site.example.org'), 'Rejects non-whitelisted domain');

  // With domain in trustedDomains, external navigation warning is exempted
  const allowlistedResults = evaluatePolicies(extNavToPartner);
  assert(
    !allowlistedResults.some((p) => p.ruleId === 'RULE_EXTERNAL_NAVIGATION_POLICY'),
    'Trusted origin is exempted from external navigation warning'
  );

  policyConfigRegistry.resetToDefault();
}

// =============================================================================
// Group 7: ContinuationValidationService Condition 10 Dynamic Revalidation
// =============================================================================
console.log('\n▶ Group 7: ContinuationValidationService Condition 10 Dynamic Revalidation');
async function runValidationTests() {
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);
  const approvalService = new ApprovalService();
  const validationService = new ContinuationValidationService({
    controller,
    continuationManager,
    approvalService,
  });

  const actionId = 'act-val-test-001';
  const action: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    category: ActionCategory.DESTRUCTIVE,
    element: { tagName: 'BUTTON', id: 'del', visibleText: 'Purge Account' },
    page: { url: 'https://app.example.com/settings', title: 'Settings' },
  };

  controller.register(action);
  const heldRecord = controller.holdAction(actionId);
  continuationManager.registerHeldAction(action, heldRecord, () => {});

  const aliceAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
  const bobAuth: AuthContext = { actorId: 'usr_bob', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };
  approvalService.getContactRegistry().addContact({
    id: 'usr_bob',
    userId: 'usr_alice',
    status: 'ACTIVE' as any,
    relationshipLabel: 'Manager',
  });

  const req = approvalService.createRequest(
    {
      actionId,
      actionType: ActionType.CLICK,
      actionDescription: 'Purge Account',
      riskLevel: RiskLevel.CRITICAL,
    },
    aliceAuth
  );
  approvalService.approveRequest(req.id, { decisionReason: 'Authorized' }, bobAuth);

  // Condition 10 policy revalidation uses central config by default
  const result = await validationService.validateEligibility(actionId, {
    authContext: aliceAuth,
    originalAction: action,
    isElementAttached: () => true,
    pageContext: { url: 'https://app.example.com/settings', origin: 'https://app.example.com' },
  });
  assertEquals(result.eligible, true, 'Validation passes all 10 conditions');
  assertEquals(result.policyDecision, ResponseAction.PROTECT, 'Condition 10 revalidation recorded PROTECT decision');
  assertEquals(result.policyRuleId, 'RULE_CONTROLLED_DESTRUCTIVE', 'Condition 10 attributed to RULE_CONTROLLED_DESTRUCTIVE');
}
await runValidationTests();

// =============================================================================
// Group 8: Browser-Side vs Backend Authority Separation
// =============================================================================
console.log('\n▶ Group 8: Browser-Side vs Backend Authority Separation');
async function runAuthoritySeparationTests() {
  const controller = new InterceptionController();
  const continuationManager = new ContinuationManager(controller);
  const approvalService = new ApprovalService();
  const validationService = new ContinuationValidationService({
    controller,
    continuationManager,
    approvalService,
  });

  const actionId = 'act-sep-auth-001';
  const action: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    category: ActionCategory.DESTRUCTIVE,
    element: { tagName: 'BUTTON', id: 'del', visibleText: 'Purge Database' },
    page: { url: 'https://app.example.com/admin', title: 'Admin' },
  };

  controller.register(action);
  controller.holdAction(actionId);

  // Create approval request on backend
  const aliceAuth: AuthContext = { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
  const req = approvalService.createRequest(
    { actionId, actionType: ActionType.CLICK, actionDescription: 'Purge', riskLevel: RiskLevel.CRITICAL },
    aliceAuth
  );

  // INVARIANT 1: Browser-side configuration CANNOT override backend authorization (Condition 2)
  // Request is PENDING on backend; client cannot continue even if client configuration sets policies to ALLOW
  const pendingValidation = await validationService.validateEligibility(actionId, {
    request: req,
    authContext: aliceAuth,
    originalAction: action,
  });
  assertEquals(pendingValidation.eligible, false, 'Pending request is ineligible for continuation');
  assertEquals(pendingValidation.status, ContinuationEligibilityStatus.PENDING, 'Status is PENDING (backend holds authority)');

  // INVARIANT 2: Disagreement handling (Condition 10 fails closed)
  // Even if reviewer APPROVES the request on dashboard, if the action is corrupted or fails Condition 10,
  // extension fails closed and prevents continuation
  const contactAuth: AuthContext = { actorId: 'usr_contact_bob', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };
  approvalService.getContactRegistry().addContact({
    id: 'usr_contact_bob',
    userId: 'usr_alice',
    status: 'ACTIVE' as any,
    relationshipLabel: 'Caretaker',
  });
  approvalService.approveRequest(req.id, { decisionReason: 'Authorized' }, contactAuth);
  const approvedReq = approvalService.getRequest(req.id, aliceAuth);

  // Simulate substituted benign action that fails Condition 10 staging policy revalidation
  const substitutedRoutineAction: GuardrailAction = {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    category: ActionCategory.NAVIGATION,
    element: { tagName: 'BUTTON', id: 'search', visibleText: 'Search FAQ' },
    page: { url: 'https://app.example.com/help', title: 'Help' },
  };

  const disagreementValidation = await validationService.validateEligibility(actionId, {
    request: approvedReq,
    authContext: aliceAuth,
    originalAction: substitutedRoutineAction, // substituted benign action
  });
  assertEquals(disagreementValidation.eligible, false, 'Disagreement resolved fail-closed (continuation blocked)');
  assertEquals(disagreementValidation.errorCode, 'POLICY_REQUIREMENTS_NOT_MET', 'Error code is POLICY_REQUIREMENTS_NOT_MET');
  assertEquals(disagreementValidation.status, ContinuationEligibilityStatus.MISMATCHED, 'Status is MISMATCHED');
}
await runAuthoritySeparationTests();

// =============================================================================
// Group 9: Fail-Closed Safe Fallback & Change Listeners
// =============================================================================
console.log('\n▶ Group 9: Fail-Closed Safe Fallback & Change Listeners');
{
  let listenerNotified = false;
  let receivedConfigVersion = '';

  const unsubscribe = policyConfigRegistry.subscribe((cfg) => {
    listenerNotified = true;
    receivedConfigVersion = cfg.policyVersion;
  });

  // Safe update with valid candidate
  const customConfig: GuardrailPolicyConfig = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    policyVersion: '1.2.0',
  };
  policyConfigRegistry.setConfigSafe(customConfig);

  assert(listenerNotified, 'Registered listener was notified on configuration change');
  assertEquals(receivedConfigVersion, '1.2.0', 'Listener received updated policy version');
  assertEquals(getActivePolicyConfig().policyVersion, '1.2.0', 'Active configuration updated');

  // Safe update with invalid candidate (e.g. malformed null, out-of-bounds numbers, credentials)
  listenerNotified = false;
  const invalidCandidate = {
    schemaVersion: 'invalid-version',
    thresholds: { lowMax: 999, mediumMax: 10, highMax: 5 }, // Corrupt inverted thresholds
  };

  const resolvedSafe = policyConfigRegistry.setConfigSafe(invalidCandidate);
  assert(listenerNotified, 'Listener notified of fallback reset');
  assertEquals(resolvedSafe.policyVersion, '1.0.0', 'Safely resolved back to safe default configuration');
  assertEquals(getRiskThresholds().lowMax, 24, 'lowMax safely restored to 24');

  unsubscribe();

  // Further updates do not call unsubscribed listener
  listenerNotified = false;
  policyConfigRegistry.resetToDefault();
  assert(!listenerNotified, 'Unsubscribed listener was not called after unsubscribe');
}

// =============================================================================
// Summary
// =============================================================================
console.log('\n======================================================================');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
console.log('======================================================================\n');

if (totalFailed > 0) {
  console.error(`💥 ${totalFailed} test(s) failed in centralized policy configuration suite.`);
  process.exit(1);
} else {
  console.log('🎉 ALL CENTRALIZED POLICY CONFIGURATION INTEGRATION TESTS PASSED CLEANLY!\n');
}
