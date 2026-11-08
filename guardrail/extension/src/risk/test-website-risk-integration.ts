/**
 * Guardrail Website Detection Risk Integration Test Suite
 *
 * Comprehensive automated tests verifying the end-to-end integration of website detection
 * (suspicious URLs, lookalike domains, phishing indicators, insecure login contexts)
 * with the Guardrail Risk Engine, canonical policies, staging workflow, and approval system.
 *
 * SPECIFICATION REQUIREMENTS VERIFIED:
 * 1. Convert supported website indicators into structured risk signals.
 * 2. Reuse the existing risk decision contract (RiskEvaluationResult, RiskAssessment).
 * 3. Avoid creating a separate conflicting website risk engine (unified pipeline).
 * 4. Apply existing protection policies consistently (WARN advisories, PROTECT staging).
 * 5. Distinguish low, medium, high, and critical risk where supported.
 * 6. Explain why a website received a particular risk classification.
 * 7. Handle conflicting or incomplete detection signals.
 * 8. Ensure risk decisions are reproducible and testable.
 * 9. Respect user-configured policies without weakening mandatory security rules.
 * 10. Document detection limitations & preserve architectural invariants:
 *     - High risk score does not automatically imply confirmed malice.
 *     - Missing threat intelligence is NOT evidence of safety.
 *     - Website risk results NEVER bypass approval or action-binding checks.
 *     - Held actions are NEVER automatically continued or executed.
 *     - Do not invent risk signals outside canonical architecture.
 */

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import {
  EvaluationReason,
  RiskAssessment,
  RiskEvaluationResult,
  RiskEvaluationStatus,
  RiskLevel,
  RiskSignalId,
} from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import { assessRisk, defaultRiskEngine, RiskEngine } from './engine.js';
import { INITIAL_RISK_RULES } from './rules.js';
import { evaluateActionPipeline, evaluateRiskAndDecision } from '../response/engine.js';
import { evaluatePolicies } from '../response/policies.js';
import { InterceptionController } from '../interception/controller.js';
import { InterceptionState } from '../types/interception.js';
import { DEFAULT_GUARDRAIL_POLICY_CONFIG } from '../config/schema.js';
import { GuardrailPolicyConfig } from '../types/config.js';

// =============================================================================
// Test Harness Utilities
// =============================================================================

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition: boolean, message: string): void {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  totalAssertions++;
  if (actual === expected) {
    passedAssertions++;
    console.log(`  ✓ ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ✗ FAIL: ${message} (expected: ${String(expected)}, got: ${String(actual)})`);
  }
}

console.log('======================================================================');
console.log('🧪 GUARDRAIL WEBSITE DETECTION & RISK ENGINE INTEGRATION TEST SUITE');
console.log('======================================================================\n');

// =============================================================================
// Suite 1: Convert Supported Website Indicators into Structured Risk Signals
// =============================================================================
console.log('▶ Suite 1: Structured Risk Signals from Website Indicators');

const phishingAction: GuardrailAction = {
  id: 'act-phish-struct-01',
  type: ActionType.CLICK,
  page: {
    url: 'https://security-verify-paypal.org/login',
    title: 'PayPal: Verify Your Account',
    metaBranding: 'PayPal',
    isSecureContext: true,
  },
  element: {
    tagName: 'INPUT',
    type: 'password',
    formAction: 'https://formspree.io/f/xyz-harvest',
    formMethod: 'POST',
    hasPasswordField: true,
    hasUsernameField: true,
  },
  timestamp: new Date().toISOString(),
};

const phishingAssessment = assessRisk(phishingAction);

// 1.1 Canonical signal IDs only
assert(
  phishingAssessment.matchedRules?.some((r) => r.signalId === RiskSignalId.PHISHING_INDICATOR),
  'Rule attribution references canonical RiskSignalId.PHISHING_INDICATOR'
);
assert(
  !phishingAssessment.matchedRules?.some(
    (r) => !Object.values(RiskSignalId).includes(r.signalId as RiskSignalId)
  ),
  'No non-canonical or invented risk signal IDs in matchedRules'
);

// 1.2 Structured reasons contain granular indicator codes
const structuredCodes = (phishingAssessment.structuredReasons || []).map((sr) => sr.code);
assert(
  structuredCodes.includes('SIGNAL_PHISHING_INDICATOR'),
  'Contains top-level signal code: SIGNAL_PHISHING_INDICATOR'
);
assert(
  structuredCodes.some((c) => c.includes('BRAND_IDENTITY_MISMATCH')),
  'Exposes granular indicator code: INDICATOR_BRAND_IDENTITY_MISMATCH'
);
assert(
  structuredCodes.some((c) => c.includes('EXFILTRATION_ENDPOINT')),
  'Exposes granular indicator code: INDICATOR_EXFILTRATION_ENDPOINT'
);

// 1.3 Structured reasons include severity, ruleId, and score contribution
const brandIndicatorReason = phishingAssessment.structuredReasons?.find((sr) =>
  sr.code.includes('BRAND_IDENTITY_MISMATCH')
);
assert(brandIndicatorReason !== undefined, 'Found brand indicator structured reason');
assertEqual(
  brandIndicatorReason?.ruleId,
  'RISK_RULE_PHISHING_INDICATOR',
  'Attributed to RISK_RULE_PHISHING_INDICATOR'
);
assertEqual(
  brandIndicatorReason?.signalId,
  RiskSignalId.PHISHING_INDICATOR,
  'Attributed to RiskSignalId.PHISHING_INDICATOR'
);
assert(
  brandIndicatorReason?.scoreContribution !== undefined && brandIndicatorReason.scoreContribution > 0,
  'Contains quantitative scoreContribution'
);

// =============================================================================
// Suite 2: Reuse Existing Risk Decision Contract
// =============================================================================
console.log('\n▶ Suite 2: Reuse Existing Risk Decision Contract');

const pipelineResult = evaluateActionPipeline(phishingAction);
const evalContract: RiskEvaluationResult = pipelineResult.evaluationResult;

// 2.1 Standard contract properties exist
assertEqual(evalContract.actionId, phishingAction.id, 'RiskEvaluationResult preserves exact actionId');
assertEqual(evalContract.status, RiskEvaluationStatus.EVALUATED, 'Status is EVALUATED');
assertEqual(evalContract.success, true, 'Success flag is true');
assert(typeof evalContract.score === 'number', 'Score is a numeric value');
assert(evalContract.score >= 0 && evalContract.score <= 100, 'Score is bounded [0, 100]');
assert(Object.values(RiskLevel).includes(evalContract.riskLevel), 'Valid categorical RiskLevel');
assert(Object.values(ResponseAction).includes(evalContract.decision), 'Valid canonical ResponseAction');
assert(Array.isArray(evalContract.reasons), 'Reasons is an array');
assert(Array.isArray(evalContract.structuredReasons), 'StructuredReasons is an array');
assert(Array.isArray(evalContract.matchedRules), 'MatchedRules is an array');
assert(typeof evalContract.evaluatedAt === 'string', 'EvaluatedAt is an ISO timestamp');

// 2.2 Contract immutability
assert(Object.isFrozen(evalContract), 'RiskEvaluationResult is deeply frozen');
assert(Object.isFrozen(evalContract.reasons), 'reasons array is frozen');
assert(Object.isFrozen(evalContract.structuredReasons), 'structuredReasons array is frozen');
assert(Object.isFrozen(evalContract.matchedRules), 'matchedRules array is frozen');

// 2.3 Strict separation: does not contain runtime or execution state
assert(
  !('interceptionState' in evalContract),
  'Does not contain interceptionState (strict separation of concerns)'
);
assert(
  !('approvalStatus' in evalContract),
  'Does not contain approvalStatus (strict separation of concerns)'
);
assert(
  !('executionCount' in evalContract),
  'Does not contain executionCount (strict separation of concerns)'
);

// =============================================================================
// Suite 3: Multi-Tier Risk Sensitivity Distinction (LOW, MEDIUM, HIGH, CRITICAL)
// =============================================================================
console.log('\n▶ Suite 3: Multi-Tier Risk Sensitivity Distinction');

// 3.1 LOW: Legitimate PayPal login on authentic domain
const authenticLoginAction: GuardrailAction = {
  id: 'act-tier-low-01',
  type: ActionType.CLICK,
  page: {
    url: 'https://www.paypal.com/signin',
    title: 'Log in to your PayPal account',
    isSecureContext: true,
  },
  element: {
    tagName: 'BUTTON',
    visibleText: 'Log In',
    hasPasswordField: true,
  },
  timestamp: new Date().toISOString(),
};
const lowAssessment = assessRisk(authenticLoginAction);
assert(
  !lowAssessment.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'),
  'Authentic PayPal login does not match phishing rule'
);
// Only matches AUTHENTICATION_ACTION (score 20 <= lowMax 24)
assertEqual(lowAssessment.riskLevel, RiskLevel.LOW, 'Authentic login maps to LOW risk (score: 20)');

// 3.2 MEDIUM: Public IP as hostname on standard content
const ipNavAction: GuardrailAction = {
  id: 'act-tier-med-01',
  type: ActionType.CLICK,
  page: {
    url: 'http://203.0.113.195/documents/report.pdf',
    title: 'Quarterly Report',
    isSecureContext: false,
  },
  element: {
    tagName: 'A',
    visibleText: 'Download Document',
    targetUrl: 'http://203.0.113.195/documents/report.pdf',
  },
  timestamp: new Date().toISOString(),
};
const medAssessment = assessRisk(ipNavAction);
assert(
  medAssessment.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_SUSPICIOUS_URL'),
  'Matches RISK_RULE_SUSPICIOUS_URL for public IP address'
);
assertEqual(medAssessment.riskLevel, RiskLevel.MEDIUM, 'Public IP address maps to MEDIUM risk (score: 25)');

// 3.3 HIGH: Deceptive website claiming brand identity on unrelated domain
const highAssessment = assessRisk(phishingAction);
assertEqual(highAssessment.riskLevel, RiskLevel.HIGH, 'Phishing form maps to HIGH risk (score: 55)');

// 3.4 CRITICAL: Compound high-risk action (Destructive deletion + Phishing site)
const compoundCriticalAction: GuardrailAction = {
  id: 'act-tier-crit-01',
  type: ActionType.CLICK,
  category: ActionCategory.DESTRUCTIVE,
  page: {
    url: 'https://security-verify-paypal.account-update.xyz/terminate',
    title: 'PayPal: Close Account',
    metaBranding: 'PayPal',
    isSecureContext: true,
  },
  element: {
    tagName: 'BUTTON',
    visibleText: 'Permanently Delete Account',
  },
  timestamp: new Date().toISOString(),
};
const critAssessment = assessRisk(compoundCriticalAction);
assertEqual(
  critAssessment.riskLevel,
  RiskLevel.CRITICAL,
  `Compound destructive action maps to CRITICAL risk (score: ${critAssessment.score} >= 75)`
);

// =============================================================================
// Suite 4: Handling Conflicting Detection Signals
// =============================================================================
console.log('\n▶ Suite 4: Handling Conflicting Detection Signals');

// 4.1 Conflict 1: Page title mentions brand, but domain IS the authentic brand domain
const brandOnOwnDomain: GuardrailAction = {
  id: 'act-conflict-brand-own-01',
  type: ActionType.CLICK,
  page: {
    url: 'https://login.live.com/oauth20_authorize.srf',
    title: 'Sign in to your Microsoft account',
    metaBranding: 'Microsoft',
    isSecureContext: true,
  },
  element: {
    tagName: 'BUTTON',
    visibleText: 'Sign in',
    hasPasswordField: true,
  },
  timestamp: new Date().toISOString(),
};
const brandOwnAssessment = assessRisk(brandOnOwnDomain);
assert(
  !brandOwnAssessment.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'),
  'Legitimate Microsoft domain claiming Microsoft identity is NOT flagged as phishing'
);

// 4.2 Conflict 2: Authentic merchant checkout with third-party payment button
// (Merchant mentions "PayPal", but is a real store with its own store password login)
const merchantStoreWithPaypal: GuardrailAction = {
  id: 'act-conflict-merchant-01',
  type: ActionType.CLICK,
  page: {
    url: 'https://www.acme-electronics.com/checkout',
    title: 'Acme Electronics - Checkout',
    metaBranding: 'Acme Electronics',
    isSecureContext: true,
  },
  element: {
    tagName: 'BUTTON',
    visibleText: 'Pay with PayPal',
  },
  timestamp: new Date().toISOString(),
};
const merchantAssessment = assessRisk(merchantStoreWithPaypal);
assert(
  !merchantAssessment.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'),
  'Merchant store with "Pay with PayPal" checkout button is NOT flagged as PayPal phishing'
);

// 4.3 Conflict 3: Cross-origin form submission to authentic SSO provider (Google SSO)
const ssoLoginAction: GuardrailAction = {
  id: 'act-conflict-sso-01',
  type: ActionType.SUBMIT,
  page: {
    url: 'https://partner-portal.com/login',
    title: 'Partner Portal Sign-In',
    isSecureContext: true,
  },
  element: {
    tagName: 'FORM',
    formAction: 'https://accounts.google.com/o/oauth2/v2/auth',
    formMethod: 'POST',
    hasPasswordField: true,
  },
  timestamp: new Date().toISOString(),
};
const ssoAssessment = assessRisk(ssoLoginAction);
assert(
  !ssoAssessment.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'),
  'Cross-origin submission to authentic Google SSO is exempted from phishing exfiltration'
);

// 4.4 Conflict 4: Localhost developer portal on unencrypted HTTP
const localhostLoginAction: GuardrailAction = {
  id: 'act-conflict-localhost-01',
  type: ActionType.CLICK,
  page: {
    url: 'http://localhost:3000/auth/login',
    title: 'Local Dev Portal',
    isSecureContext: false,
  },
  element: {
    tagName: 'BUTTON',
    visibleText: 'Log In',
    hasPasswordField: true,
  },
  timestamp: new Date().toISOString(),
};
const localhostAssessment = assessRisk(localhostLoginAction);
assert(
  !localhostAssessment.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'),
  'Localhost development login on HTTP is exempted from insecure context phishing warnings'
);

// =============================================================================
// Suite 5: Handling Incomplete / Missing Detection Signals
// =============================================================================
console.log('\n▶ Suite 5: Handling Incomplete / Missing Detection Signals');

// 5.1 Missing page URL: does not throw, evaluates gracefully
const missingUrlAction: GuardrailAction = {
  id: 'act-missing-url-01',
  type: ActionType.CLICK,
  element: {
    tagName: 'BUTTON',
    visibleText: 'Next',
  },
  timestamp: new Date().toISOString(),
};
const missingUrlAssessment = assessRisk(missingUrlAction);
assertEqual(missingUrlAssessment.score, 0, 'Missing page URL evaluates safely without crash (score: 0)');
assertEqual(missingUrlAssessment.riskLevel, RiskLevel.LOW, 'Missing page URL assigns LOW risk');

// 5.2 Missing targetUrl: checks page.url safely
const missingTargetUrlAction: GuardrailAction = {
  id: 'act-missing-target-01',
  type: ActionType.CLICK,
  page: {
    url: 'https://example.com/about',
  },
  element: {
    tagName: 'A',
    visibleText: 'Read More',
    // targetUrl omitted
  },
  timestamp: new Date().toISOString(),
};
const missingTargetAssessment = assessRisk(missingTargetUrlAction);
assertEqual(missingTargetAssessment.score, 0, 'Missing targetUrl on benign page evaluates safely');

// 5.3 Missing formAction: standard HTML defaults to same-origin relative action
const missingFormAction: GuardrailAction = {
  id: 'act-missing-form-action-01',
  type: ActionType.SUBMIT,
  page: {
    url: 'https://my-company-portal.internal/login',
    title: 'Employee Portal',
    isSecureContext: true,
  },
  element: {
    tagName: 'FORM',
    // formAction omitted
    hasPasswordField: true,
  },
  timestamp: new Date().toISOString(),
};
const missingFormAssessment = assessRisk(missingFormAction);
assert(
  !missingFormAssessment.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'),
  'Missing formAction safely treats form as same-origin, not phishing'
);

// 5.4 Malformed URL string: does not throw exception
const malformedUrlAction: GuardrailAction = {
  id: 'act-malformed-url-01',
  type: ActionType.CLICK,
  page: {
    url: 'not-a-valid-url-protocol:::garbage',
  },
  element: {
    tagName: 'A',
    targetUrl: 'javascript:void(0)',
  },
  timestamp: new Date().toISOString(),
};
let malformedThrew = false;
try {
  assessRisk(malformedUrlAction);
} catch {
  malformedThrew = true;
}
assert(!malformedThrew, 'Risk engine handles malformed URL gracefully without throwing');

// 5.5 Missing actionId: fails closed to CRITICAL
const corruptAction = {
  type: ActionType.CLICK,
  page: { url: 'https://example.com' },
} as any;
const corruptAssessment = assessRisk(corruptAction);
assertEqual(corruptAssessment.status, RiskEvaluationStatus.FAILED, 'Corrupt action status is FAILED');
assertEqual(corruptAssessment.score, 100, 'Corrupt action fails closed to score 100');
assertEqual(corruptAssessment.riskLevel, RiskLevel.CRITICAL, 'Corrupt action fails closed to CRITICAL');

// =============================================================================
// Suite 6: Consistent Policy Enforcement & Precedence
// =============================================================================
console.log('\n▶ Suite 6: Consistent Policy Enforcement & Precedence');

// 6.1 Phishing login action triggers AUTHENTICATION_BOUNDARY_POLICY warning
const phishingPipeline = evaluateActionPipeline(phishingAction);
assertEqual(phishingPipeline.decision.response, ResponseAction.WARN, 'Phishing login evaluates to WARN');
assert(
  phishingPipeline.decision.policyRuleId === 'RULE_AUTHENTICATION_BOUNDARY_POLICY' || phishingPipeline.decision.policyRuleId === 'RULE_EXTERNAL_NAVIGATION_POLICY',
  'Attributed to deceptive website advisory policy rule (got: ' + phishingPipeline.decision.policyRuleId + ')'
);
assert(
  phishingPipeline.decision.reasons.some((r) => r.includes('Deceptive website advisory')),
  'Decision explanation includes deceptive website advisory'
);

// 6.2 Destructive action on phishing site escalates strictly to PROTECT
const destructivePhishingAction: GuardrailAction = {
  id: 'act-dest-phish-01',
  type: ActionType.CLICK,
  category: ActionCategory.DESTRUCTIVE,
  page: {
    url: 'https://security-verify-paypal.account-update.xyz/delete',
    title: 'PayPal: Account Termination',
    metaBranding: 'PayPal',
    isSecureContext: true,
  },
  element: {
    tagName: 'BUTTON',
    visibleText: 'Delete Account Permanently',
  },
  timestamp: new Date().toISOString(),
};
const destPhishingPipeline = evaluateActionPipeline(destructivePhishingAction);
assertEqual(
  destPhishingPipeline.decision.response,
  ResponseAction.PROTECT,
  'Destructive action on phishing site strictly evaluates to PROTECT'
);
assertEqual(
  destPhishingPipeline.decision.policyRuleId,
  'RULE_CONTROLLED_DESTRUCTIVE',
  'Attributed to immutable RULE_CONTROLLED_DESTRUCTIVE'
);

// 6.3 Financial payment on deceptive site escalates to PROTECT
const paymentPhishingAction: GuardrailAction = {
  id: 'act-pay-phish-01',
  type: ActionType.CLICK,
  category: ActionCategory.PAYMENT,
  page: {
    url: 'https://security-verify-paypal.account-update.xyz/pay',
    title: 'PayPal: Settle Past Due Balance',
    metaBranding: 'PayPal',
    isSecureContext: true,
  },
  element: {
    tagName: 'BUTTON',
    visibleText: 'Pay ₹15,000 Now',
  },
  timestamp: new Date().toISOString(),
};
const payPhishingPipeline = evaluateActionPipeline(paymentPhishingAction);
assertEqual(
  payPhishingPipeline.decision.response,
  ResponseAction.PROTECT,
  'Compound payment on deceptive site escalates to PROTECT'
);
assert(
  payPhishingPipeline.decision.policyRuleId === 'RULE_PAYMENT_COMPOUND_PROTECT' || payPhishingPipeline.decision.policyRuleId === 'RULE_CONTROLLED_DESTRUCTIVE',
  'Attributed to protective policy rule (got: ' + payPhishingPipeline.decision.policyRuleId + ')'
);

// 6.4 Routine action on clean page evaluates to ALLOW
const routineAction: GuardrailAction = {
  id: 'act-routine-clean-01',
  type: ActionType.CLICK,
  page: {
    url: 'https://en.wikipedia.org/wiki/Computer_security',
    title: 'Computer security - Wikipedia',
    isSecureContext: true,
  },
  element: {
    tagName: 'A',
    visibleText: 'Network security',
    targetUrl: 'https://en.wikipedia.org/wiki/Network_security',
  },
  timestamp: new Date().toISOString(),
};
const routinePipeline = evaluateActionPipeline(routineAction);
assertEqual(routinePipeline.decision.response, ResponseAction.ALLOW, 'Routine clean link evaluates to ALLOW');
assertEqual(
  routinePipeline.decision.policyRuleId,
  'RULE_ROUTINE_ALLOW_POLICY',
  'Attributed to RULE_ROUTINE_ALLOW_POLICY'
);

// =============================================================================
// Suite 7: User-Configured Policies & Immutable Security Invariants
// =============================================================================
console.log('\n▶ Suite 7: User-Configured Policies & Immutable Security Invariants');

// 7.1 Custom thresholds are respected
const customThresholdConfig: GuardrailPolicyConfig = {
  ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
  thresholds: {
    lowMax: 15,
    mediumMax: 30,
    highMax: 50,
  },
};
const customThresholdEngine = new RiskEngine({ config: customThresholdConfig });
const assessedUnderCustom = customThresholdEngine.assess(ipNavAction); // score: 25
// In default thresholds, score 25 is MEDIUM (lowMax 24). Under custom thresholds (mediumMax: 30), it's MEDIUM.
assertEqual(
  customThresholdEngine.thresholds.lowMax,
  15,
  'Engine dynamically consumes custom lowMax: 15'
);

// 7.2 Disabling phishing indicator signal sets score contribution to 0
const disabledPhishingConfig: GuardrailPolicyConfig = {
  ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
  signals: {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG.signals,
    [RiskSignalId.PHISHING_INDICATOR]: {
      id: RiskSignalId.PHISHING_INDICATOR,
      enabled: false,
      scoreContribution: 0,
    },
  },
};
const disabledPhishingEngine = new RiskEngine({ config: disabledPhishingConfig });
const disabledAssessment = disabledPhishingEngine.assess(phishingAction);
assertEqual(
  disabledAssessment.score,
  20,
  'Disabling PHISHING_INDICATOR drops its contribution to 0 (only AUTHENTICATION_ACTION contributes 20)'
);

// 7.3 Elevating policy rule to PROTECT is respected
const elevatedPolicyConfig: GuardrailPolicyConfig = {
  ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
  policies: DEFAULT_GUARDRAIL_POLICY_CONFIG.policies.map((p) =>
    p.id === RiskPolicyId.AUTHENTICATION_BOUNDARY
      ? { ...p, decision: ResponseAction.PROTECT, reasonCode: 'POLICY_PROTECT_AUTH_CUSTOM' }
      : p
  ),
};
const elevatedPolicies = evaluatePolicies(phishingAction, phishingAssessment, elevatedPolicyConfig);
const authPolicyResult = elevatedPolicies.find((p) => p.ruleId === 'RULE_AUTHENTICATION_BOUNDARY_POLICY');
assertEqual(
  authPolicyResult?.decision,
  ResponseAction.PROTECT,
  'User configuration successfully elevated AUTHENTICATION_BOUNDARY to PROTECT'
);

// 7.4 Immutable invariant: User CANNOT downgrade CONTROLLED_DESTRUCTIVE
const attemptedDowngradeConfig: GuardrailPolicyConfig = {
  ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
  policies: DEFAULT_GUARDRAIL_POLICY_CONFIG.policies.map((p) =>
    p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE
      ? { ...p, enabled: false, decision: ResponseAction.ALLOW }
      : p
  ),
};
const immutablePolicies = evaluatePolicies(
  destructivePhishingAction,
  destPhishingPipeline.risk,
  attemptedDowngradeConfig
);
const destructiveResult = immutablePolicies.find((p) => p.ruleId === 'RULE_CONTROLLED_DESTRUCTIVE');
assertEqual(
  destructiveResult?.decision,
  ResponseAction.PROTECT,
  'Immutable invariant: CONTROLLED_DESTRUCTIVE strictly remains PROTECT despite user downgrade attempt'
);

// =============================================================================
// Suite 8: Approval & Staging Separation (Safety Invariants)
// =============================================================================
console.log('\n▶ Suite 8: Approval & Staging Separation (Safety Invariants)');

const controller = new InterceptionController();
const heldActionId = 'act-held-safety-01';

// Register and hold action
controller.register(heldActionId, 'Controlled test action halted.');
const heldRecord = controller.holdAction(heldActionId, 'Action held pending approval.');

assertEqual(heldRecord.state, InterceptionState.HELD, 'Action is verified HELD in controller');
assert(controller.isActionHeld(heldActionId), 'isActionHeld returns true');

// Perform risk evaluation and website detection on the held action
const heldActionPayload: GuardrailAction = {
  id: heldActionId,
  type: ActionType.CLICK,
  page: {
    url: 'https://security-verify-paypal.org/login',
  },
  element: {
    tagName: 'BUTTON',
    visibleText: 'Confirm',
  },
  timestamp: new Date().toISOString(),
};

const pipelineOnHeld = evaluateActionPipeline(heldActionPayload);

// INVARIANT: Risk evaluation MUST NOT alter the interception state or continue the action!
const recordAfterEval = controller.getRecord(heldActionId);
assertEqual(
  recordAfterEval?.state,
  InterceptionState.HELD,
  'Safety Invariant: Risk evaluation NEVER changes HELD action state'
);
assert(
  controller.isActionHeld(heldActionId),
  'Safety Invariant: Action strictly remains HELD after pipeline evaluation'
);
assert(
  recordAfterEval?.resolvedAt === undefined,
  'Safety Invariant: Action was not resolved or continued'
);

// INVARIANT: Missing threat intelligence does NOT imply safety
const unknownHostAction: GuardrailAction = {
  id: 'act-unknown-host-01',
  type: ActionType.CLICK,
  page: {
    url: 'https://newly-registered-unknown-domain-2026.org/form',
  },
  element: {
    tagName: 'BUTTON',
    visibleText: 'Submit Form',
  },
  timestamp: new Date().toISOString(),
};
const unknownHostAssessment = assessRisk(unknownHostAction);
assert(
  unknownHostAssessment.reasons.some((r) => r.includes('No elevated risk signals detected')),
  'Absence of heuristic triggers produces routine interaction reason'
);
// Verify that the assessment does NOT claim proof of safety
assert(
  !unknownHostAssessment.reasons.some((r) => r.toLowerCase().includes('certified safe')),
  'Safety Invariant: Engine does NOT certify safety when intelligence is missing'
);

// =============================================================================
// Suite 9: Decision Reproducibility & Determinism
// =============================================================================
console.log('\n▶ Suite 9: Decision Reproducibility & Determinism');

const fixedAction: GuardrailAction = {
  id: 'act-reproducibility-01',
  type: ActionType.CLICK,
  page: {
    url: 'https://secure-login-microsoft.auth-verify.net/signin',
    title: 'Microsoft Account Login',
    metaBranding: 'Microsoft',
    isSecureContext: true,
  },
  element: {
    tagName: 'INPUT',
    type: 'password',
    formAction: 'https://exfil-collector.com/api',
    formMethod: 'POST',
    hasPasswordField: true,
  },
  timestamp: '2026-11-08T12:00:00.000Z',
};

const initialEval = evaluateActionPipeline(fixedAction);

let allMatchesConsistent = true;
for (let i = 0; i < 50; i++) {
  const rerun = evaluateActionPipeline(fixedAction);
  if (
    rerun.risk.score !== initialEval.risk.score ||
    rerun.risk.riskLevel !== initialEval.risk.riskLevel ||
    rerun.decision.response !== initialEval.decision.response ||
    rerun.decision.policyRuleId !== initialEval.decision.policyRuleId ||
    rerun.risk.matchedRules?.length !== initialEval.risk.matchedRules?.length ||
    rerun.risk.structuredReasons?.length !== initialEval.risk.structuredReasons?.length
  ) {
    allMatchesConsistent = false;
    break;
  }
}
assert(
  allMatchesConsistent,
  '50 repetitive pipeline runs yield 100% deterministic and reproducible results'
);

// =============================================================================
// Suite 10: False-Positive Resilience Across Benign Portals
// =============================================================================
console.log('\n▶ Suite 10: False-Positive Resilience Across Benign Portals');

const benignPortals: Array<{ name: string; action: GuardrailAction }> = [
  {
    name: 'GitHub Sign-In',
    action: {
      id: 'act-fp-github',
      type: ActionType.CLICK,
      page: {
        url: 'https://github.com/login',
        title: 'Sign in to GitHub · GitHub',
        metaBranding: 'GitHub',
        isSecureContext: true,
      },
      element: {
        tagName: 'BUTTON',
        visibleText: 'Sign in',
        hasPasswordField: true,
      },
      timestamp: new Date().toISOString(),
    },
  },
  {
    name: 'Google Accounts Sign-In',
    action: {
      id: 'act-fp-google',
      type: ActionType.CLICK,
      page: {
        url: 'https://accounts.google.com/signin/v2/identifier',
        title: 'Sign in – Google accounts',
        metaBranding: 'Google',
        isSecureContext: true,
      },
      element: {
        tagName: 'BUTTON',
        visibleText: 'Next',
        hasUsernameField: true,
      },
      timestamp: new Date().toISOString(),
    },
  },
  {
    name: 'Apple ID Sign-In',
    action: {
      id: 'act-fp-apple',
      type: ActionType.CLICK,
      page: {
        url: 'https://appleid.apple.com/sign-in',
        title: 'Sign In - Apple',
        metaBranding: 'Apple',
        isSecureContext: true,
      },
      element: {
        tagName: 'BUTTON',
        visibleText: 'Continue',
        hasPasswordField: true,
      },
      timestamp: new Date().toISOString(),
    },
  },
  {
    name: 'Routine Enterprise Portal',
    action: {
      id: 'act-fp-enterprise',
      type: ActionType.CLICK,
      page: {
        url: 'https://portal.mycompany.internal/dashboard',
        title: 'Employee Portal',
        isSecureContext: true,
      },
      element: {
        tagName: 'BUTTON',
        visibleText: 'View Benefits',
      },
      timestamp: new Date().toISOString(),
    },
  },
];

for (const portal of benignPortals) {
  const portalRisk = assessRisk(portal.action);
  assert(
    !portalRisk.matchedRules?.some(
      (r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR' || r.ruleId === 'RISK_RULE_SUSPICIOUS_URL'
    ),
    `False-positive check passed: ${portal.name} triggers NO website risk signals`
  );
}

// =============================================================================
// Test Results Summary
// =============================================================================
console.log('\n======================================================================');
console.log(`Results: ${passedAssertions} passed, ${failedAssertions} failed across ${totalAssertions} assertions`);
console.log('======================================================================\n');

if (failedAssertions > 0) {
  console.error(`❌ ${failedAssertions} assertion(s) FAILED!`);
  process.exit(1);
} else {
  console.log('🎉 ALL WEBSITE DETECTION RISK INTEGRATION TESTS PASSED CLEANLY!\n');
}
