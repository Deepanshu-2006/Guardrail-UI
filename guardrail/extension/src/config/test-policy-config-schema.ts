/**
 * Guardrail Risk-Policy Configuration Schema Test Suite
 *
 * Comprehensive tests verifying schema validation, boundary enforcement,
 * mandatory security invariants, safe fallback defaults, and sensitive data rejection.
 */

import { ActionType } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import { RiskSignalId } from '../types/risk.js';
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  PolicyConfigValidationError,
  assertValidPolicyConfig,
  getSafeDefaultPolicyConfig,
  resolveSafePolicyConfig,
  validatePolicyConfig,
} from './schema.js';
import { GuardrailPolicyConfig } from '../types/config.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAILED: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  const isMatch = actual === expected || JSON.stringify(actual) === JSON.stringify(expected);
  if (isMatch) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAILED: ${message} (Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)})`);
  }
}

console.log('\n======================================================================');
console.log('🧪 GUARDRAIL RISK-POLICY CONFIGURATION SCHEMA TEST SUITE');
console.log('======================================================================\n');

// Helper to create a deep clone of the default config for mutations
function cloneDefaultConfig(): any {
  return JSON.parse(JSON.stringify(DEFAULT_GUARDRAIL_POLICY_CONFIG));
}

// -----------------------------------------------------------------------------
// Group 1: Valid Configuration & Safe Defaults
// -----------------------------------------------------------------------------
console.log('▶ Group 1: Valid Configuration & Safe Defaults');
{
  const defResult = validatePolicyConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
  assert(defResult.valid, 'DEFAULT_GUARDRAIL_POLICY_CONFIG is valid');
  assertEquals(defResult.errors.length, 0, 'Default configuration has zero validation errors');
  assert(defResult.config !== undefined, 'Validation result contains frozen config');
  assert(Object.isFrozen(defResult.config), 'Returned configuration is deeply frozen');
  assert(Object.isFrozen(defResult.config?.thresholds), 'Thresholds object is frozen');
  assert(Object.isFrozen(defResult.config?.policies), 'Policies array is frozen');

  // Assert valid does not throw on valid config
  let didThrow = false;
  try {
    assertValidPolicyConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
  } catch {
    didThrow = true;
  }
  assert(!didThrow, 'assertValidPolicyConfig does not throw on valid default configuration');

  // Valid custom configuration with custom thresholds and trusted domains
  const customConfig = cloneDefaultConfig();
  customConfig.thresholds.lowMax = 20;
  customConfig.thresholds.mediumMax = 45;
  customConfig.thresholds.highMax = 70;
  customConfig.trustedDomains = ['internal.corp.example.com', 'sso.partner.org', 'localhost'];
  customConfig.timeouts.approvalTtlSeconds = 1800; // 30 min
  customConfig.timeouts.dashboardPollIntervalMs = 5000; // 5 sec

  const customResult = validatePolicyConfig(customConfig);
  assert(customResult.valid, 'Custom valid configuration passes validation cleanly');
  assertEquals(customResult.errors.length, 0, 'Zero errors on custom valid configuration');

  // Safe default helper
  const safeDefault = getSafeDefaultPolicyConfig();
  assertEquals(safeDefault.schemaVersion, '1.0.0', 'getSafeDefaultPolicyConfig returns schemaVersion 1.0.0');
  assertEquals(safeDefault.policyVersion, '1.0.0', 'getSafeDefaultPolicyConfig returns policyVersion 1.0.0');
}

// -----------------------------------------------------------------------------
// Group 2: Missing Required Fields
// -----------------------------------------------------------------------------
console.log('\n▶ Group 2: Missing Required Fields');
{
  // Missing schemaVersion
  const noSchemaVer = cloneDefaultConfig();
  delete noSchemaVer.schemaVersion;
  const resNoSchema = validatePolicyConfig(noSchemaVer);
  assert(!resNoSchema.valid, 'Rejects config missing schemaVersion');
  assert(
    resNoSchema.errors.some((e) => e.code === 'MISSING_SCHEMA_VERSION'),
    'Reports MISSING_SCHEMA_VERSION error'
  );

  // Missing policyVersion
  const noPolicyVer = cloneDefaultConfig();
  delete noPolicyVer.policyVersion;
  const resNoPolicyVer = validatePolicyConfig(noPolicyVer);
  assert(!resNoPolicyVer.valid, 'Rejects config missing policyVersion');
  assert(
    resNoPolicyVer.errors.some((e) => e.code === 'MISSING_POLICY_VERSION'),
    'Reports MISSING_POLICY_VERSION error'
  );

  // Missing updatedAt
  const noUpdatedAt = cloneDefaultConfig();
  delete noUpdatedAt.updatedAt;
  const resNoUpdate = validatePolicyConfig(noUpdatedAt);
  assert(!resNoUpdate.valid, 'Rejects config missing updatedAt');
  assert(
    resNoUpdate.errors.some((e) => e.code === 'MISSING_UPDATED_AT'),
    'Reports MISSING_UPDATED_AT error'
  );

  // Missing thresholds
  const noThresholds = cloneDefaultConfig();
  delete noThresholds.thresholds;
  const resNoThresh = validatePolicyConfig(noThresholds);
  assert(!resNoThresh.valid, 'Rejects config missing thresholds');
  assert(
    resNoThresh.errors.some((e) => e.code === 'MISSING_THRESHOLDS'),
    'Reports MISSING_THRESHOLDS error'
  );

  // Missing signals
  const noSignals = cloneDefaultConfig();
  delete noSignals.signals;
  const resNoSignals = validatePolicyConfig(noSignals);
  assert(!resNoSignals.valid, 'Rejects config missing signals');
  assert(
    resNoSignals.errors.some((e) => e.code === 'MISSING_SIGNALS'),
    'Reports MISSING_SIGNALS error'
  );

  // Missing policies array
  const noPolicies = cloneDefaultConfig();
  delete noPolicies.policies;
  const resNoPolicies = validatePolicyConfig(noPolicies);
  assert(!resNoPolicies.valid, 'Rejects config missing policies array');
  assert(
    resNoPolicies.errors.some((e) => e.code === 'MISSING_POLICIES_ARRAY'),
    'Reports MISSING_POLICIES_ARRAY error'
  );

  // Empty policies array
  const emptyPolicies = cloneDefaultConfig();
  emptyPolicies.policies = [];
  const resEmptyPolicies = validatePolicyConfig(emptyPolicies);
  assert(!resEmptyPolicies.valid, 'Rejects empty policies array');
  assert(
    resEmptyPolicies.errors.some((e) => e.code === 'EMPTY_POLICIES_ARRAY'),
    'Reports EMPTY_POLICIES_ARRAY error'
  );

  // Missing required signal (omit DESTRUCTIVE_ACTION)
  const omittedSignal = cloneDefaultConfig();
  delete omittedSignal.signals[RiskSignalId.DESTRUCTIVE_ACTION];
  const resOmittedSignal = validatePolicyConfig(omittedSignal);
  assert(!resOmittedSignal.valid, 'Rejects config with omitted required signal');
  assert(
    resOmittedSignal.errors.some((e) => e.code === 'MISSING_REQUIRED_SIGNAL'),
    'Reports MISSING_REQUIRED_SIGNAL error'
  );

  // Missing required canonical policy (omit CONTROLLED_DESTRUCTIVE)
  const omittedPolicy = cloneDefaultConfig();
  omittedPolicy.policies = omittedPolicy.policies.filter(
    (p: any) => p.id !== RiskPolicyId.CONTROLLED_DESTRUCTIVE
  );
  const resOmittedPolicy = validatePolicyConfig(omittedPolicy);
  assert(!resOmittedPolicy.valid, 'Rejects config with omitted required policy');
  assert(
    resOmittedPolicy.errors.some((e) => e.code === 'MISSING_REQUIRED_POLICY_RULE'),
    'Reports MISSING_REQUIRED_POLICY_RULE error'
  );
}

// -----------------------------------------------------------------------------
// Group 3: Invalid Types & Malformed Values
// -----------------------------------------------------------------------------
console.log('\n▶ Group 3: Invalid Types & Malformed Values');
{
  // Root type invalid
  assert(!validatePolicyConfig(null).valid, 'Rejects null root');
  assert(!validatePolicyConfig(undefined).valid, 'Rejects undefined root');
  assert(!validatePolicyConfig([]).valid, 'Rejects array root');
  assert(!validatePolicyConfig('string').valid, 'Rejects string root');
  assert(!validatePolicyConfig(42).valid, 'Rejects number root');

  // Invalid semver
  const badSemver = cloneDefaultConfig();
  badSemver.schemaVersion = 'v1.0';
  assert(
    validatePolicyConfig(badSemver).errors.some((e) => e.code === 'INVALID_SEMVER_FORMAT'),
    'Rejects non-semver schemaVersion ("v1.0")'
  );

  // Invalid timestamp
  const badTimestamp = cloneDefaultConfig();
  badTimestamp.updatedAt = '2026-13-45 99:99:99';
  assert(
    validatePolicyConfig(badTimestamp).errors.some((e) => e.code === 'INVALID_TIMESTAMP_FORMAT'),
    'Rejects invalid timestamp format'
  );

  // Float threshold
  const floatThreshold = cloneDefaultConfig();
  floatThreshold.thresholds.lowMax = 24.5;
  assert(
    validatePolicyConfig(floatThreshold).errors.some((e) => e.code === 'INVALID_THRESHOLD_TYPE'),
    'Rejects floating-point threshold'
  );

  // NaN threshold
  const nanThreshold = cloneDefaultConfig();
  nanThreshold.thresholds.mediumMax = NaN;
  assert(
    validatePolicyConfig(nanThreshold).errors.some((e) => e.code === 'INVALID_THRESHOLD_TYPE'),
    'Rejects NaN threshold'
  );

  // Non-boolean enabled
  const nonBoolEnabled = cloneDefaultConfig();
  nonBoolEnabled.policies[1].enabled = 'true';
  assert(
    validatePolicyConfig(nonBoolEnabled).errors.some((e) => e.code === 'INVALID_POLICY_ENABLED_TYPE'),
    'Rejects non-boolean policy enabled property'
  );

  // Non-integer priority
  const nonIntPriority = cloneDefaultConfig();
  nonIntPriority.policies[1].priority = 250.7;
  assert(
    validatePolicyConfig(nonIntPriority).errors.some((e) => e.code === 'INVALID_PRIORITY_TYPE'),
    'Rejects non-integer policy priority'
  );

  // Malformed reasonCode (lowercase with spaces)
  const badReasonCode = cloneDefaultConfig();
  badReasonCode.policies[1].reasonCode = 'policy warn payment';
  assert(
    validatePolicyConfig(badReasonCode).errors.some((e) => e.code === 'INVALID_REASON_CODE_FORMAT'),
    'Rejects malformed lowercase reason code'
  );

  // Too short userExplanation
  const shortExplanation = cloneDefaultConfig();
  shortExplanation.policies[1].userExplanation = 'warn';
  assert(
    validatePolicyConfig(shortExplanation).errors.some((e) => e.code === 'INVALID_USER_EXPLANATION'),
    'Rejects userExplanation with length < 5 characters'
  );
}

// -----------------------------------------------------------------------------
// Group 4: Unknown & Malformed Decision Values
// -----------------------------------------------------------------------------
console.log('\n▶ Group 4: Unknown & Malformed Decision Values');
{
  const testDecisions = ['PERMIT', 'BLOCK', 'ALLOW_ANYWAY', 'IGNORE', 'allow', 'warn', 'protect', 123, null];
  for (const badDecision of testDecisions) {
    const config = cloneDefaultConfig();
    config.policies[1].decision = badDecision;
    const res = validatePolicyConfig(config);
    assert(!res.valid, `Rejects unknown decision value "${String(badDecision)}"`);
    assert(
      res.errors.some((e) => e.code === 'INVALID_DECISION_VALUE'),
      `Emits INVALID_DECISION_VALUE for "${String(badDecision)}"`
    );
  }
}

// -----------------------------------------------------------------------------
// Group 5: Duplicate Identifiers & Conflicting Definitions
// -----------------------------------------------------------------------------
console.log('\n▶ Group 5: Duplicate Identifiers & Conflicting Definitions');
{
  // Duplicate policy rule ID
  const dupPolicy = cloneDefaultConfig();
  dupPolicy.policies.push(cloneDefaultConfig().policies[0]); // Duplicate CONTROLLED_DESTRUCTIVE
  const resDupPolicy = validatePolicyConfig(dupPolicy);
  assert(!resDupPolicy.valid, 'Rejects duplicate policy identifier in policies array');
  assert(
    resDupPolicy.errors.some((e) => e.code === 'DUPLICATE_POLICY_IDENTIFIER'),
    'Emits DUPLICATE_POLICY_IDENTIFIER error'
  );

  // Duplicate action type inside a single policy
  const dupActionType = cloneDefaultConfig();
  dupActionType.policies[1].actionTypes = [ActionType.CLICK, ActionType.SUBMIT, ActionType.CLICK];
  const resDupActionType = validatePolicyConfig(dupActionType);
  assert(!resDupActionType.valid, 'Rejects duplicate ActionType in rule actionTypes array');
  assert(
    resDupActionType.errors.some((e) => e.code === 'DUPLICATE_ACTION_TYPE'),
    'Emits DUPLICATE_ACTION_TYPE error'
  );

  // Duplicate trusted domain
  const dupDomain = cloneDefaultConfig();
  dupDomain.trustedDomains = ['company.example.com', 'COMPANY.EXAMPLE.COM'];
  const resDupDomain = validatePolicyConfig(dupDomain);
  assert(!resDupDomain.valid, 'Rejects duplicate trusted domain entry (case-insensitive)');
  assert(
    resDupDomain.errors.some((e) => e.code === 'DUPLICATE_TRUSTED_DOMAIN'),
    'Emits DUPLICATE_TRUSTED_DOMAIN error'
  );

  // Signal key / internal id mismatch
  const mismatchedSignal = cloneDefaultConfig();
  mismatchedSignal.signals[RiskSignalId.PAYMENT_ACTION].id = RiskSignalId.DESTRUCTIVE_ACTION;
  const resMismatch = validatePolicyConfig(mismatchedSignal);
  assert(!resMismatch.valid, 'Rejects signal entry with key and id mismatch');
  assert(
    resMismatch.errors.some((e) => e.code === 'SIGNAL_ID_MISMATCH'),
    'Emits SIGNAL_ID_MISMATCH error'
  );
}

// -----------------------------------------------------------------------------
// Group 6: Numeric Boundary Violations
// -----------------------------------------------------------------------------
console.log('\n▶ Group 6: Numeric Boundary Violations');
{
  // lowMax too low (< 5)
  const lowMaxTooLow = cloneDefaultConfig();
  lowMaxTooLow.thresholds.lowMax = 4;
  assert(
    validatePolicyConfig(lowMaxTooLow).errors.some((e) => e.code === 'THRESHOLD_BOUNDARY_VIOLATION'),
    'Rejects lowMax < 5'
  );

  // lowMax too high (> 35)
  const lowMaxTooHigh = cloneDefaultConfig();
  lowMaxTooHigh.thresholds.lowMax = 36;
  assert(
    validatePolicyConfig(lowMaxTooHigh).errors.some((e) => e.code === 'THRESHOLD_BOUNDARY_VIOLATION'),
    'Rejects lowMax > 35'
  );

  // mediumMax <= lowMax inversion
  const threshInversion1 = cloneDefaultConfig();
  threshInversion1.thresholds.lowMax = 30;
  threshInversion1.thresholds.mediumMax = 28;
  assert(
    validatePolicyConfig(threshInversion1).errors.some((e) => e.code === 'THRESHOLD_ORDERING_VIOLATION'),
    'Rejects mediumMax <= lowMax threshold inversion'
  );

  // mediumMax too high (> 65)
  const medMaxTooHigh = cloneDefaultConfig();
  medMaxTooHigh.thresholds.mediumMax = 66;
  assert(
    validatePolicyConfig(medMaxTooHigh).errors.some((e) => e.code === 'THRESHOLD_BOUNDARY_VIOLATION'),
    'Rejects mediumMax > 65'
  );

  // highMax <= mediumMax inversion
  const threshInversion2 = cloneDefaultConfig();
  threshInversion2.thresholds.mediumMax = 50;
  threshInversion2.thresholds.highMax = 48;
  assert(
    validatePolicyConfig(threshInversion2).errors.some((e) => e.code === 'THRESHOLD_ORDERING_VIOLATION'),
    'Rejects highMax <= mediumMax threshold inversion'
  );

  // highMax too high (> 85 - would push CRITICAL to 86+)
  const highMaxTooHigh = cloneDefaultConfig();
  highMaxTooHigh.thresholds.highMax = 86;
  assert(
    validatePolicyConfig(highMaxTooHigh).errors.some((e) => e.code === 'THRESHOLD_BOUNDARY_VIOLATION'),
    'Rejects highMax > 85 to prevent CRITICAL threshold inflation'
  );

  // Signal score out of bounds (< 0)
  const scoreNeg = cloneDefaultConfig();
  scoreNeg.signals[RiskSignalId.DOWNLOAD_ACTION].scoreContribution = -1;
  assert(
    validatePolicyConfig(scoreNeg).errors.some((e) => e.code === 'SCORE_CONTRIBUTION_OUT_OF_BOUNDS'),
    'Rejects negative score contribution'
  );

  // Signal score out of bounds (> 100)
  const scoreTooHigh = cloneDefaultConfig();
  scoreTooHigh.signals[RiskSignalId.DOWNLOAD_ACTION].scoreContribution = 101;
  assert(
    validatePolicyConfig(scoreTooHigh).errors.some((e) => e.code === 'SCORE_CONTRIBUTION_OUT_OF_BOUNDS'),
    'Rejects score contribution > 100'
  );

  // Priority out of bounds (< 1)
  const priorityLow = cloneDefaultConfig();
  priorityLow.policies[1].priority = 0;
  assert(
    validatePolicyConfig(priorityLow).errors.some((e) => e.code === 'PRIORITY_OUT_OF_BOUNDS'),
    'Rejects policy priority < 1'
  );

  // Priority out of bounds (> 1000)
  const priorityHigh = cloneDefaultConfig();
  priorityHigh.policies[1].priority = 1001;
  assert(
    validatePolicyConfig(priorityHigh).errors.some((e) => e.code === 'PRIORITY_OUT_OF_BOUNDS'),
    'Rejects policy priority > 1000'
  );

  // approvalTtlSeconds out of bounds (< 60)
  const ttlTooShort = cloneDefaultConfig();
  ttlTooShort.timeouts.approvalTtlSeconds = 59;
  assert(
    validatePolicyConfig(ttlTooShort).errors.some((e) => e.code === 'TIMEOUT_OUT_OF_BOUNDS'),
    'Rejects approval TTL < 60 seconds'
  );

  // approvalTtlSeconds out of bounds (> 86400)
  const ttlTooLong = cloneDefaultConfig();
  ttlTooLong.timeouts.approvalTtlSeconds = 86401;
  assert(
    validatePolicyConfig(ttlTooLong).errors.some((e) => e.code === 'TIMEOUT_OUT_OF_BOUNDS'),
    'Rejects approval TTL > 86400 seconds (24h)'
  );

  // dashboardPollIntervalMs out of bounds (< 1000)
  const pollTooFast = cloneDefaultConfig();
  pollTooFast.timeouts.dashboardPollIntervalMs = 999;
  assert(
    validatePolicyConfig(pollTooFast).errors.some((e) => e.code === 'POLL_INTERVAL_OUT_OF_BOUNDS'),
    'Rejects dashboard polling interval < 1000ms'
  );

  // dashboardPollIntervalMs out of bounds (> 60000)
  const pollTooSlow = cloneDefaultConfig();
  pollTooSlow.timeouts.dashboardPollIntervalMs = 60001;
  assert(
    validatePolicyConfig(pollTooSlow).errors.some((e) => e.code === 'POLL_INTERVAL_OUT_OF_BOUNDS'),
    'Rejects dashboard polling interval > 60000ms'
  );
}

// -----------------------------------------------------------------------------
// Group 7: Mandatory Security Invariants Enforcement
// -----------------------------------------------------------------------------
console.log('\n▶ Group 7: Mandatory Security Invariants Enforcement');
{
  // 1. Attempting to disable CONTROLLED_DESTRUCTIVE
  const disableDestructive = cloneDefaultConfig();
  const destructiveIdx = disableDestructive.policies.findIndex(
    (p: any) => p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE
  );
  disableDestructive.policies[destructiveIdx].enabled = false;
  const resDisableDestructive = validatePolicyConfig(disableDestructive);
  assert(!resDisableDestructive.valid, 'Blocks attempt to disable CONTROLLED_DESTRUCTIVE policy');
  assert(
    resDisableDestructive.errors.some((e) => e.code === 'MANDATORY_POLICY_DISABLED'),
    'Emits MANDATORY_POLICY_DISABLED for destructive policy'
  );

  // 2. Attempting to downgrade CONTROLLED_DESTRUCTIVE decision to WARN
  const warnDestructive = cloneDefaultConfig();
  warnDestructive.policies[destructiveIdx].decision = ResponseAction.WARN;
  const resWarnDestructive = validatePolicyConfig(warnDestructive);
  assert(!resWarnDestructive.valid, 'Blocks attempt to downgrade CONTROLLED_DESTRUCTIVE to WARN');
  assert(
    resWarnDestructive.errors.some((e) => e.code === 'MANDATORY_PROTECTION_DOWNGRADE'),
    'Emits MANDATORY_PROTECTION_DOWNGRADE for destructive policy'
  );

  // 3. Attempting to downgrade CONTROLLED_DESTRUCTIVE decision to ALLOW
  const allowDestructive = cloneDefaultConfig();
  allowDestructive.policies[destructiveIdx].decision = ResponseAction.ALLOW;
  const resAllowDestructive = validatePolicyConfig(allowDestructive);
  assert(!resAllowDestructive.valid, 'Blocks attempt to downgrade CONTROLLED_DESTRUCTIVE to ALLOW');
  assert(
    resAllowDestructive.errors.some((e) => e.code === 'MANDATORY_PROTECTION_DOWNGRADE'),
    'Emits MANDATORY_PROTECTION_DOWNGRADE for destructive ALLOW'
  );

  // 4. Attempting to disable UNSUPPORTED_BOUNDARY_GUARD
  const disableGuard = cloneDefaultConfig();
  const guardIdx = disableGuard.policies.findIndex(
    (p: any) => p.id === RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD
  );
  disableGuard.policies[guardIdx].enabled = false;
  const resDisableGuard = validatePolicyConfig(disableGuard);
  assert(!resDisableGuard.valid, 'Blocks attempt to disable UNSUPPORTED_BOUNDARY_GUARD');
  assert(
    resDisableGuard.errors.some((e) => e.code === 'MANDATORY_POLICY_DISABLED'),
    'Emits MANDATORY_POLICY_DISABLED for boundary guard'
  );

  // 5. Attempting to downgrade UNSUPPORTED_BOUNDARY_GUARD to WARN
  const warnGuard = cloneDefaultConfig();
  warnGuard.policies[guardIdx].decision = ResponseAction.WARN;
  assert(
    validatePolicyConfig(warnGuard).errors.some((e) => e.code === 'MANDATORY_PROTECTION_DOWNGRADE'),
    'Blocks attempt to downgrade UNSUPPORTED_BOUNDARY_GUARD to WARN'
  );

  // 6. Attempting to downgrade CONTROLLED_PAYMENT to ALLOW
  const allowPayment = cloneDefaultConfig();
  const payIdx = allowPayment.policies.findIndex(
    (p: any) => p.id === RiskPolicyId.CONTROLLED_PAYMENT
  );
  allowPayment.policies[payIdx].decision = ResponseAction.ALLOW;
  assert(
    validatePolicyConfig(allowPayment).errors.some((e) => e.code === 'PROHIBITED_ALLOW_DECISION'),
    'Blocks attempt to configure CONTROLLED_PAYMENT to ALLOW'
  );

  // 7. Attempting to downgrade EXTERNAL_NAVIGATION to ALLOW
  const allowNav = cloneDefaultConfig();
  const navIdx = allowNav.policies.findIndex(
    (p: any) => p.id === RiskPolicyId.EXTERNAL_NAVIGATION
  );
  allowNav.policies[navIdx].decision = ResponseAction.ALLOW;
  assert(
    validatePolicyConfig(allowNav).errors.some((e) => e.code === 'PROHIBITED_ALLOW_DECISION'),
    'Blocks attempt to configure EXTERNAL_NAVIGATION to ALLOW'
  );

  // 8. Attempting to downgrade AUTHENTICATION_BOUNDARY to ALLOW
  const allowAuth = cloneDefaultConfig();
  const authIdx = allowAuth.policies.findIndex(
    (p: any) => p.id === RiskPolicyId.AUTHENTICATION_BOUNDARY
  );
  allowAuth.policies[authIdx].decision = ResponseAction.ALLOW;
  assert(
    validatePolicyConfig(allowAuth).errors.some((e) => e.code === 'PROHIBITED_ALLOW_DECISION'),
    'Blocks attempt to configure AUTHENTICATION_BOUNDARY to ALLOW'
  );

  // 9. Attempting to disable DESTRUCTIVE_ACTION signal
  const disableDestSignal = cloneDefaultConfig();
  disableDestSignal.signals[RiskSignalId.DESTRUCTIVE_ACTION].enabled = false;
  assert(
    validatePolicyConfig(disableDestSignal).errors.some((e) => e.code === 'MANDATORY_SIGNAL_DISABLED'),
    'Blocks attempt to disable DESTRUCTIVE_ACTION signal'
  );

  // 10. Attempting to lower DESTRUCTIVE_ACTION score contribution < 25
  const lowDestScore = cloneDefaultConfig();
  lowDestScore.signals[RiskSignalId.DESTRUCTIVE_ACTION].scoreContribution = 10;
  assert(
    validatePolicyConfig(lowDestScore).errors.some((e) => e.code === 'MANDATORY_SIGNAL_WEIGHT_TOO_LOW'),
    'Blocks attempt to lower DESTRUCTIVE_ACTION score contribution below 25'
  );
}

// -----------------------------------------------------------------------------
// Group 8: Sensitive Data & Extraneous Property Rejection
// -----------------------------------------------------------------------------
console.log('\n▶ Group 8: Sensitive Data & Extraneous Property Rejection');
{
  // Property name matches sensitive pattern: password
  const withPassword = cloneDefaultConfig();
  withPassword.password = 'supersecret';
  const resPass = validatePolicyConfig(withPassword);
  assert(!resPass.valid, 'Rejects configuration containing "password" property');
  assert(
    resPass.errors.some((e) => e.code === 'FORBIDDEN_SENSITIVE_KEY'),
    'Emits FORBIDDEN_SENSITIVE_KEY error'
  );

  // Property name matches sensitive pattern: authToken
  const withToken = cloneDefaultConfig();
  withToken.authToken = 'eyJhbGciOi...';
  assert(
    validatePolicyConfig(withToken).errors.some((e) => e.code === 'FORBIDDEN_SENSITIVE_KEY'),
    'Rejects configuration containing "authToken" property'
  );

  // Property name matches sensitive pattern: cardNumber
  const withCard = cloneDefaultConfig();
  withCard.cardNumber = '4111222233334444';
  assert(
    validatePolicyConfig(withCard).errors.some((e) => e.code === 'FORBIDDEN_SENSITIVE_KEY'),
    'Rejects configuration containing "cardNumber" property'
  );

  // Property name matches sensitive pattern: otp
  const withOtp = cloneDefaultConfig();
  withOtp.otp = '123456';
  assert(
    validatePolicyConfig(withOtp).errors.some((e) => e.code === 'FORBIDDEN_SENSITIVE_KEY'),
    'Rejects configuration containing "otp" property'
  );

  // Value contains sensitive keyword
  const valWithSecret = cloneDefaultConfig();
  valWithSecret.policies[1].userExplanation = 'Please enter your password to proceed with checkout.';
  assert(
    validatePolicyConfig(valWithSecret).errors.some((e) => e.code === 'FORBIDDEN_SENSITIVE_DATA'),
    'Rejects string value containing sensitive credential keyword'
  );

  // Extraneous unknown property
  const withExtraneous = cloneDefaultConfig();
  withExtraneous.unsupportedFeatureFlag = true;
  assert(
    validatePolicyConfig(withExtraneous).errors.some((e) => e.code === 'EXTRANEOUS_FIELD_REJECTED'),
    'Rejects extraneous unknown property'
  );

  // Runtime action state injection attempt
  const withActionState = cloneDefaultConfig();
  withActionState.actionId = 'act-test-001';
  withActionState.requestId = 'apr-test-001';
  assert(
    validatePolicyConfig(withActionState).errors.some((e) => e.code === 'EXTRANEOUS_FIELD_REJECTED'),
    'Rejects runtime actionId and requestId injection into static configuration'
  );
}

// -----------------------------------------------------------------------------
// Group 9: Safe-Default Behavior & Exception Handling
// -----------------------------------------------------------------------------
console.log('\n▶ Group 9: Safe-Default Behavior & Exception Handling');
{
  // resolveSafePolicyConfig with null
  const nullFallback = resolveSafePolicyConfig(null);
  assertEquals(
    nullFallback.schemaVersion,
    DEFAULT_GUARDRAIL_POLICY_CONFIG.schemaVersion,
    'resolveSafePolicyConfig(null) safely returns DEFAULT_GUARDRAIL_POLICY_CONFIG'
  );

  // resolveSafePolicyConfig with undefined
  const undefFallback = resolveSafePolicyConfig(undefined);
  assertEquals(
    undefFallback.policyVersion,
    DEFAULT_GUARDRAIL_POLICY_CONFIG.policyVersion,
    'resolveSafePolicyConfig(undefined) safely returns DEFAULT_GUARDRAIL_POLICY_CONFIG'
  );

  // resolveSafePolicyConfig with corrupt/malformed candidate
  const corruptCandidate = {
    schemaVersion: 'broken',
    thresholds: { lowMax: 999 },
  };
  const corruptFallback = resolveSafePolicyConfig(corruptCandidate);
  assertEquals(
    corruptFallback.thresholds.lowMax,
    24,
    'resolveSafePolicyConfig(corrupt) safely returns default thresholds.lowMax (24)'
  );

  // resolveSafePolicyConfig with tampered downgrade
  const tamperedCandidate = cloneDefaultConfig();
  tamperedCandidate.policies[0].decision = ResponseAction.ALLOW; // Tamper destructive to ALLOW
  const tamperedFallback = resolveSafePolicyConfig(tamperedCandidate);
  assertEquals(
    tamperedFallback.policies[0].decision,
    ResponseAction.PROTECT,
    'resolveSafePolicyConfig(tampered) prevents protection downgrade and defaults to PROTECT'
  );

  // assertValidPolicyConfig throws PolicyConfigValidationError with detailed summary
  let thrownError: PolicyConfigValidationError | null = null;
  try {
    assertValidPolicyConfig({ malformed: true });
  } catch (err: any) {
    thrownError = err;
  }
  assert(thrownError !== null, 'assertValidPolicyConfig throws on invalid configuration');
  assertEquals(thrownError?.name, 'PolicyConfigValidationError', 'Error instance is PolicyConfigValidationError');
  assert(
    thrownError?.message.includes('Policy configuration validation failed'),
    'Error message includes failure summary'
  );
  assert(Array.isArray(thrownError?.validationErrors), 'Error includes detailed validationErrors array');
}

// -----------------------------------------------------------------------------
// Group 10: Trusted Domains Allowlist Validation
// -----------------------------------------------------------------------------
console.log('\n▶ Group 10: Trusted Domains Allowlist Validation');
{
  // Domain with protocol scheme
  const domainWithScheme = cloneDefaultConfig();
  domainWithScheme.trustedDomains = ['https://trusted.corp.com'];
  assert(
    validatePolicyConfig(domainWithScheme).errors.some((e) => e.code === 'INVALID_DOMAIN_FORMAT'),
    'Rejects domain containing protocol scheme "https://"'
  );

  // Domain with URL path
  const domainWithPath = cloneDefaultConfig();
  domainWithPath.trustedDomains = ['trusted.corp.com/path'];
  assert(
    validatePolicyConfig(domainWithPath).errors.some((e) => e.code === 'INVALID_DOMAIN_FORMAT'),
    'Rejects domain containing URL path "/path"'
  );

  // Domain with port
  const domainWithPort = cloneDefaultConfig();
  domainWithPort.trustedDomains = ['trusted.corp.com:8080'];
  assert(
    validatePolicyConfig(domainWithPort).errors.some((e) => e.code === 'INVALID_DOMAIN_FORMAT'),
    'Rejects domain containing port ":8080"'
  );

  // Invalid domain characters
  const domainBadChars = cloneDefaultConfig();
  domainBadChars.trustedDomains = ['invalid_domain!@#'];
  assert(
    validatePolicyConfig(domainBadChars).errors.some((e) => e.code === 'INVALID_HOSTNAME_SYNTAX'),
    'Rejects domain with invalid special characters'
  );

  // Valid domain list
  const validDomainsConfig = cloneDefaultConfig();
  validDomainsConfig.trustedDomains = [
    'internal.portal.company.com',
    'auth0.example.org',
    'localhost',
  ];
  const resValidDomains = validatePolicyConfig(validDomainsConfig);
  assert(resValidDomains.valid, 'Accepts valid standard hostnames in trustedDomains');
}

// -----------------------------------------------------------------------------
// Final Results
// -----------------------------------------------------------------------------
console.log('\n======================================================================');
console.log(`Results: ${passed} passed, ${failed} failed across all 10 test groups`);
console.log('======================================================================\n');

if (failed > 0) {
  console.error(`💥 TEST SUITE FAILED: ${failed} assertions failed.`);
  process.exit(1);
} else {
  console.log('🎉 ALL RISK-POLICY CONFIGURATION SCHEMA TESTS PASSED CLEANLY!\n');
}
