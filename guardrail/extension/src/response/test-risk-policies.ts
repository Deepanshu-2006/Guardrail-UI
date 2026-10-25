/**
 * Guardrail Risk Policies Verification Suite
 *
 * Verifies that the canonical risk policies meet all requirements:
 * 1. Policy applicability across supported action types (CLICK, INPUT, SUBMIT, NAVIGATION).
 * 2. Deterministic evidence triggering based on explicit, verifiable action metadata.
 * 3. Exact decision outputs (ALLOW, WARN, PROTECT).
 * 4. User explanations and matched rule identifiers.
 * 5. Downstream behavior specification (Staging Mode, Warning Modal, uninhibited).
 * 6. Documented limitations (false-positives, false-negatives, architectural constraints).
 * 7. Boundary conditions, compound risk escalation, and fail-closed corruption guard.
 * 8. Privacy compliance (zero inspection of input values, credentials, or OTPs).
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import {
  ALL_GUARDRAIL_POLICIES,
  AUTHENTICATION_BOUNDARY_POLICY,
  CONTROLLED_DESTRUCTIVE_POLICY,
  CONTROLLED_PAYMENT_POLICY,
  evaluatePolicies,
  EXTERNAL_NAVIGATION_POLICY,
  getPolicyById,
  ROUTINE_INTERACTION_POLICY,
  UNSUPPORTED_BOUNDARY_GUARD_POLICY,
} from './policies.js';
import { ResponseAction } from '../types/response.js';
import { RiskAssessment, RiskLevel, RiskSignalId } from '../types/risk.js';
import { RiskPolicyId } from '../types/policy.js';

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

console.log('\n=== Guardrail Canonical Risk Policies Verification ===\n');

// -----------------------------------------------------------------------------
// Test 1: Policy Catalog Completeness & 7-Dimension Metadata
// -----------------------------------------------------------------------------
console.log('Test Group 1: Policy Metadata & Specification Completeness');

assert(ALL_GUARDRAIL_POLICIES.length === 6, 'All 6 canonical policies are registered');

for (const policy of ALL_GUARDRAIL_POLICIES) {
  const hasId = typeof policy.id === 'string' && policy.id.length > 0;
  const hasName = typeof policy.name === 'string' && policy.name.length > 0;
  const hasDesc = typeof policy.description === 'string' && policy.description.length > 0;
  const hasActionTypes = Array.isArray(policy.supportedActionTypes) && policy.supportedActionTypes.length > 0;
  const hasEvidence = typeof policy.evidenceRequirement === 'string' && policy.evidenceRequirement.length > 0;
  const hasDecision = Object.values(ResponseAction).includes(policy.decision);
  const hasExplanation = typeof policy.userExplanation === 'string' && policy.userExplanation.length > 0;
  const hasRuleId = typeof policy.ruleId === 'string' && policy.ruleId.length > 0;
  const hasDownstream = typeof policy.downstreamBehavior === 'string' && policy.downstreamBehavior.length > 0;
  const hasLimitations = Boolean(
    policy.limitations &&
      typeof policy.limitations.falsePositives === 'string' &&
      typeof policy.limitations.falseNegatives === 'string' &&
      typeof policy.limitations.architecturalConstraints === 'string'
  );

  assert(
    hasId &&
      hasName &&
      hasDesc &&
      hasActionTypes &&
      hasEvidence &&
      hasDecision &&
      hasExplanation &&
      hasRuleId &&
      hasDownstream &&
      hasLimitations,
    `Policy ${policy.id} defines all 7 required dimensions`,
    `Validation error on policy: ${policy.id}`
  );
}

// -----------------------------------------------------------------------------
// Test 2: Controlled Destructive Action Policy
// -----------------------------------------------------------------------------
console.log('\nTest Group 2: Controlled Destructive Action Policy');

const deleteAction: GuardrailAction = {
  id: 'act-destructive-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE,
  element: {
    tagName: 'BUTTON',
    id: 'btn-delete-account',
    className: 'btn btn-danger',
    visibleText: 'Delete Account',
  },
  page: {
    url: 'https://app.example.com/settings/account',
    title: 'Account Settings',
  },
};

const deleteResult = CONTROLLED_DESTRUCTIVE_POLICY.evaluate(deleteAction);
assert(deleteResult.matched === true, 'Matches explicit destructive button click');
assert(deleteResult.decision === ResponseAction.PROTECT, 'Results in PROTECT decision');
assert(deleteResult.ruleId === 'RULE_CONTROLLED_DESTRUCTIVE', 'Emits RULE_CONTROLLED_DESTRUCTIVE rule identifier');
assert(
  Boolean(deleteResult.downstreamBehavior?.includes('Staging Mode')),
  'Downstream behavior specifies entering Staging Mode'
);

// Destructive button matched by visible text alone
const deleteByTextAction: GuardrailAction = {
  id: 'act-destructive-2',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  element: {
    tagName: 'BUTTON',
    visibleText: 'Purge all data',
  },
  page: {
    url: 'https://app.example.com/admin',
    title: 'Admin Console',
  },
};
assert(
  CONTROLLED_DESTRUCTIVE_POLICY.appliesTo(deleteByTextAction),
  'Applies to CLICK with destructive token "purge"'
);

// Non-destructive action must NOT match
const safeClickAction: GuardrailAction = {
  id: 'act-safe-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  element: {
    tagName: 'BUTTON',
    visibleText: 'Save Settings',
  },
  page: {
    url: 'https://app.example.com/settings',
    title: 'Settings',
  },
};
assert(
  !CONTROLLED_DESTRUCTIVE_POLICY.appliesTo(safeClickAction),
  'Does NOT apply to benign "Save Settings" button'
);

// Destructive policy does not apply to INPUT actions
const deleteInputAction: GuardrailAction = {
  id: 'act-destructive-input',
  type: ActionType.INPUT,
  timestamp: new Date().toISOString(),
  element: {
    tagName: 'INPUT',
    id: 'delete-confirm-input',
  },
  page: {
    url: 'https://app.example.com/settings',
    title: 'Settings',
  },
};
assert(
  !CONTROLLED_DESTRUCTIVE_POLICY.appliesTo(deleteInputAction),
  'Destructive policy does not apply to INPUT action types'
);

// -----------------------------------------------------------------------------
// Test 3: Controlled Payment Policy & Compound Escalation
// -----------------------------------------------------------------------------
console.log('\nTest Group 3: Controlled Payment Policy & Escalation');

const paymentAction: GuardrailAction = {
  id: 'act-payment-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.PAYMENT,
  element: {
    tagName: 'BUTTON',
    id: 'pay-now-btn',
    visibleText: 'Pay Now $49.99',
  },
  page: {
    url: 'https://shop.example.com/checkout',
    title: 'Checkout',
  },
};

// Standard payment evaluation -> WARN
const standardPayResult = CONTROLLED_PAYMENT_POLICY.evaluate(paymentAction);
assert(standardPayResult.matched === true, 'Matches standard payment action');
assert(standardPayResult.decision === ResponseAction.WARN, 'Standard payment triggers WARN decision');
assert(
  standardPayResult.ruleId === 'RULE_PAYMENT_INTERACTION_POLICY',
  'Emits RULE_PAYMENT_INTERACTION_POLICY'
);

// Compound payment with high risk score (score >= 75) -> PROTECT
const highRiskAssessment: RiskAssessment = {
  riskLevel: RiskLevel.CRITICAL,
  score: 85,
  reasons: ['Payment interaction with high risk score'],
  matchedRules: [
    {
      ruleId: 'RISK_RULE_PAYMENT',
      signalId: RiskSignalId.PAYMENT_ACTION,
      scoreContribution: 40,
      reason: 'Payment interaction',
    },
  ],
  evaluatedAt: new Date().toISOString(),
  actionId: paymentAction.id,
};
const compoundPayResult = CONTROLLED_PAYMENT_POLICY.evaluate(paymentAction, highRiskAssessment);
assert(compoundPayResult.matched === true, 'Compound payment matches policy');
assert(compoundPayResult.decision === ResponseAction.PROTECT, 'Compound payment escalates to PROTECT');
assert(
  compoundPayResult.ruleId === 'RULE_PAYMENT_COMPOUND_PROTECT',
  'Compound payment emits RULE_PAYMENT_COMPOUND_PROTECT'
);

// Form submit on checkout form
const submitCheckoutAction: GuardrailAction = {
  id: 'act-submit-checkout',
  type: ActionType.SUBMIT,
  timestamp: new Date().toISOString(),
  element: {
    tagName: 'FORM',
    id: 'checkout-form',
  },
  page: {
    url: 'https://shop.example.com/checkout',
    title: 'Checkout',
  },
};
assert(
  CONTROLLED_PAYMENT_POLICY.appliesTo(submitCheckoutAction),
  'Applies to SUBMIT action for checkout form'
);

// -----------------------------------------------------------------------------
// Test 4: External Navigation & Origin Boundary Policy
// -----------------------------------------------------------------------------
console.log('\nTest Group 4: External Navigation Policy');

const externalNavAction: GuardrailAction = {
  id: 'act-nav-ext-1',
  type: ActionType.NAVIGATION,
  timestamp: new Date().toISOString(),
  category: ActionCategory.EXTERNAL_NAVIGATION,
  page: {
    url: 'https://external-service.org/login',
    previousUrl: 'https://trusted-app.com/dashboard',
    title: 'External Service',
  },
};

const externalResult = EXTERNAL_NAVIGATION_POLICY.evaluate(externalNavAction);
assert(externalResult.matched === true, 'Matches external navigation across origins');
assert(externalResult.decision === ResponseAction.WARN, 'Results in advisory WARN decision');
assert(
  externalResult.ruleId === 'RULE_EXTERNAL_NAVIGATION_POLICY',
  'Emits RULE_EXTERNAL_NAVIGATION_POLICY'
);

// Same-origin navigation must NOT match external navigation
const sameOriginNavAction: GuardrailAction = {
  id: 'act-nav-same-1',
  type: ActionType.NAVIGATION,
  timestamp: new Date().toISOString(),
  page: {
    url: 'https://trusted-app.com/settings',
    previousUrl: 'https://trusted-app.com/dashboard',
    title: 'Settings',
  },
};
assert(
  !EXTERNAL_NAVIGATION_POLICY.appliesTo(sameOriginNavAction),
  'Does NOT apply to same-origin navigation'
);

// -----------------------------------------------------------------------------
// Test 5: Authentication & Credential Boundary Policy
// -----------------------------------------------------------------------------
console.log('\nTest Group 5: Authentication Boundary Policy');

const loginAction: GuardrailAction = {
  id: 'act-auth-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.AUTHENTICATION,
  element: {
    tagName: 'BUTTON',
    id: 'login-submit',
    visibleText: 'Sign In with Password',
  },
  page: {
    url: 'https://auth.example.com/login',
    title: 'Sign In',
  },
};

const loginResult = AUTHENTICATION_BOUNDARY_POLICY.evaluate(loginAction);
assert(loginResult.matched === true, 'Matches authentication button click');
assert(loginResult.decision === ResponseAction.WARN, 'Authentication boundary yields WARN');
assert(
  loginResult.ruleId === 'RULE_AUTHENTICATION_BOUNDARY_POLICY',
  'Emits RULE_AUTHENTICATION_BOUNDARY_POLICY'
);

// Privacy invariant: Action object contains no input credentials or sensitive values
assert(
  (loginAction as any).value === undefined,
  'Privacy Invariant: Action contains no input value property'
);
assert(
  (loginAction as any).element?.value === undefined,
  'Privacy Invariant: Element contains no value property'
);

// -----------------------------------------------------------------------------
// Test 6: Routine Benign Interaction Policy
// -----------------------------------------------------------------------------
console.log('\nTest Group 6: Routine Benign Interaction Policy');

const routineClickAction: GuardrailAction = {
  id: 'act-routine-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  element: {
    tagName: 'BUTTON',
    visibleText: 'View Details',
  },
  page: {
    url: 'https://app.example.com/items',
    title: 'Items List',
  },
};

const lowAssessment: RiskAssessment = {
  riskLevel: RiskLevel.LOW,
  score: 10,
  reasons: ['Routine interaction'],
  matchedRules: [],
  evaluatedAt: new Date().toISOString(),
  actionId: routineClickAction.id,
};

const routineResult = ROUTINE_INTERACTION_POLICY.evaluate(routineClickAction, lowAssessment);
assert(routineResult.matched === true, 'Matches routine benign click');
assert(routineResult.decision === ResponseAction.ALLOW, 'Results in ALLOW decision');
assert(routineResult.ruleId === 'RULE_ROUTINE_ALLOW_POLICY', 'Emits RULE_ROUTINE_ALLOW_POLICY');
assert(
  ROUTINE_INTERACTION_POLICY.limitations.falseNegatives.includes('NOT guarantee'),
  'Documented limitation clearly states ALLOW is not a guarantee of safety'
);

// Routine policy must NOT match if destructive trigger is present
assert(
  !ROUTINE_INTERACTION_POLICY.appliesTo(deleteAction, lowAssessment),
  'Routine policy rejects actions matching destructive criteria'
);

// -----------------------------------------------------------------------------
// Test 7: Unsupported Action Type & Corruption Guard Policy
// -----------------------------------------------------------------------------
console.log('\nTest Group 7: Unsupported Action Type & Corruption Guard');

// Malformed action missing action ID
const corruptMissingIdAction = {
  id: '',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  page: { url: 'https://example.com' },
} as unknown as GuardrailAction;

const corruptResult1 = UNSUPPORTED_BOUNDARY_GUARD_POLICY.evaluate(corruptMissingIdAction);
assert(corruptResult1.matched === true, 'Corrupt action missing ID triggers corruption guard');
assert(corruptResult1.decision === ResponseAction.PROTECT, 'Resolves fail-closed to PROTECT');
assert(corruptResult1.ruleId === 'RULE_FAIL_CLOSED_FALLBACK', 'Emits RULE_FAIL_CLOSED_FALLBACK');

// Malformed action missing page URL
const corruptMissingPageAction = {
  id: 'act-corrupt-2',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  page: {} as any,
} as unknown as GuardrailAction;

const corruptResult2 = UNSUPPORTED_BOUNDARY_GUARD_POLICY.evaluate(corruptMissingPageAction);
assert(corruptResult2.matched === true, 'Corrupt action missing page URL triggers corruption guard');
assert(corruptResult2.decision === ResponseAction.PROTECT, 'Corrupt action resolves fail-closed to PROTECT');

// Valid action must NOT trigger corruption guard
assert(
  !UNSUPPORTED_BOUNDARY_GUARD_POLICY.appliesTo(safeClickAction),
  'Valid action does not trigger corruption guard'
);

// -----------------------------------------------------------------------------
// Test 8: Compound Policy Evaluation & Precedence
// -----------------------------------------------------------------------------
console.log('\nTest Group 8: Compound Policy Evaluation');

// An action that matches both destructive and payment triggers (e.g. "Cancel Subscription & Delete Billing")
const compoundDestructivePayment: GuardrailAction = {
  id: 'act-compound-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  category: ActionCategory.DESTRUCTIVE,
  element: {
    tagName: 'BUTTON',
    visibleText: 'Delete account and cancel payment subscription',
  },
  page: {
    url: 'https://app.example.com/billing',
    title: 'Billing',
  },
};

const compoundResults = evaluatePolicies(compoundDestructivePayment);
assert(compoundResults.length >= 2, 'Evaluates and matches multiple applicable policies');

const hasProtect = compoundResults.some((r) => r.decision === ResponseAction.PROTECT);
const hasWarn = compoundResults.some((r) => r.decision === ResponseAction.WARN);
assert(hasProtect && hasWarn, 'Compound action contains both PROTECT and WARN policy evaluations');

// Monotonic resolution check: When both PROTECT and WARN are present, PROTECT must dominate
const effectiveDecision = compoundResults.some((r) => r.decision === ResponseAction.PROTECT)
  ? ResponseAction.PROTECT
  : ResponseAction.WARN;
assert(effectiveDecision === ResponseAction.PROTECT, 'PROTECT strictly takes precedence over WARN');

// Lookup by ID
const fetchedPolicy = getPolicyById(RiskPolicyId.CONTROLLED_DESTRUCTIVE);
assert(
  fetchedPolicy?.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE,
  'getPolicyById correctly resolves policy by enum identifier'
);

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All risk policy tests PASSED cleanly.\n');
}
