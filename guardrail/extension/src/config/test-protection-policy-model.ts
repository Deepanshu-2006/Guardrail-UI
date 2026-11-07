/**
 * Guardrail Protection Policy Model & Single Source of Truth Test Suite
 *
 * Comprehensive automated verification covering:
 * 1. Explicit defaults immutability, completeness, and non-permissive values.
 * 2. Valid policy settings across thresholds, signals, policies, domains, and timeouts.
 * 3. Invalid settings detection (out-of-bounds, ordering, extraneous fields, sensitive data).
 * 4. Missing settings resolution and fail-closed fallback to defaults.
 * 5. Safe policy versioning (compatible 1.x, stale < 1.0.0, unsupported > 1.x).
 * 6. Extension and backend policy contract consistency and server-side validation.
 * 7. Policy specifications dictionary completeness and documented security implications.
 */

import { ActionCategory, ActionType } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import { RiskLevel, RiskSignalId } from '../types/risk.js';
import {
  ConfigHealthStatus,
  CURRENT_ARCHITECTURE_SCHEMA_VERSION,
  GuardrailPolicyConfig,
} from '../types/config.js';
import {
  checkVersionCompatibility,
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  DEFAULT_OPERATIONAL_TIMEOUTS,
  DEFAULT_POLICY_RULES,
  DEFAULT_RISK_THRESHOLDS,
  DEFAULT_SIGNAL_SETTINGS,
  DEFAULT_TRUSTED_DOMAINS,
  POLICY_SETTINGS_SPECIFICATIONS,
  resolveSafePolicyConfig,
  validatePolicyConfig,
} from './schema.js';
import { mergeConfigWithDefaults } from './loader.js';
import { ApprovalService } from '../approval/service.js';
import { ApprovalApiRouter } from '../approval/api.js';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
} from '../approval/authorization.js';
import { ApprovalValidationError } from '../approval/model.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  ✓ ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalTests++;
  if (actual !== expected) {
    console.error(`  ❌ FAILED: ${message} (Expected ${String(expected)}, got ${String(actual)})`);
    throw new Error(`Assertion failed: ${message} (Expected ${String(expected)}, got ${String(actual)})`);
  }
  passedTests++;
  console.log(`  ✓ ${message}`);
}

function cloneConfig(base: GuardrailPolicyConfig = DEFAULT_GUARDRAIL_POLICY_CONFIG): any {
  return JSON.parse(JSON.stringify(base));
}

async function runTestSuite(): Promise<void> {
  console.log('======================================================================');
  console.log('🛡️  GUARDRAIL PROTECTION POLICY MODEL & SOURCE OF TRUTH TEST SUITE');
  console.log('======================================================================\n');

  // ---------------------------------------------------------------------------
  // Test Group 1: Explicit Defaults & Immutability
  // ---------------------------------------------------------------------------
  console.log('▶ Group 1: Explicit Defaults & Conservative Invariants');
  {
    assert(Object.isFrozen(DEFAULT_RISK_THRESHOLDS), 'DEFAULT_RISK_THRESHOLDS is frozen');
    assertEquals(DEFAULT_RISK_THRESHOLDS.lowMax, 24, 'lowMax default is 24');
    assertEquals(DEFAULT_RISK_THRESHOLDS.mediumMax, 49, 'mediumMax default is 49');
    assertEquals(DEFAULT_RISK_THRESHOLDS.highMax, 74, 'highMax default is 74 (CRITICAL starts at 75 <= 86)');

    assert(Object.isFrozen(DEFAULT_SIGNAL_SETTINGS), 'DEFAULT_SIGNAL_SETTINGS is frozen');
    assertEquals(DEFAULT_SIGNAL_SETTINGS[RiskSignalId.DESTRUCTIVE_ACTION].enabled, true, 'Destructive signal default is enabled');
    assertEquals(DEFAULT_SIGNAL_SETTINGS[RiskSignalId.DESTRUCTIVE_ACTION].scoreContribution, 50, 'Destructive signal default weight is 50');

    assert(Object.isFrozen(DEFAULT_POLICY_RULES), 'DEFAULT_POLICY_RULES is frozen');
    const destructiveRule = DEFAULT_POLICY_RULES.find((r) => r.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE);
    assert(Boolean(destructiveRule), 'CONTROLLED_DESTRUCTIVE policy rule exists');
    assertEquals(destructiveRule?.decision, ResponseAction.PROTECT, 'CONTROLLED_DESTRUCTIVE default decision is PROTECT (fail-closed)');
    assertEquals(destructiveRule?.isImmutableSecurityInvariant, true, 'CONTROLLED_DESTRUCTIVE is marked immutable security invariant');

    const corruptionGuard = DEFAULT_POLICY_RULES.find((r) => r.id === RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD);
    assert(Boolean(corruptionGuard), 'UNSUPPORTED_BOUNDARY_GUARD policy rule exists');
    assertEquals(corruptionGuard?.decision, ResponseAction.PROTECT, 'UNSUPPORTED_BOUNDARY_GUARD default decision is PROTECT');
    assertEquals(corruptionGuard?.priority, 350, 'UNSUPPORTED_BOUNDARY_GUARD has highest priority (350)');

    assert(Object.isFrozen(DEFAULT_OPERATIONAL_TIMEOUTS), 'DEFAULT_OPERATIONAL_TIMEOUTS is frozen');
    assertEquals(DEFAULT_OPERATIONAL_TIMEOUTS.approvalTtlSeconds, 3600, 'approvalTtlSeconds default is 3600 (1 hour)');
    assertEquals(DEFAULT_OPERATIONAL_TIMEOUTS.dashboardPollIntervalMs, 10000, 'dashboardPollIntervalMs default is 10000 (10 sec)');

    assert(Object.isFrozen(DEFAULT_TRUSTED_DOMAINS), 'DEFAULT_TRUSTED_DOMAINS is frozen');
    assertEquals(DEFAULT_TRUSTED_DOMAINS.length, 0, 'DEFAULT_TRUSTED_DOMAINS is empty by default (no permissive origin bypasses)');

    const baselineValidation = validatePolicyConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
    assert(baselineValidation.valid, 'DEFAULT_GUARDRAIL_POLICY_CONFIG passes schema validation cleanly');
    assertEquals(baselineValidation.errors.length, 0, 'Zero errors in default configuration');
  }

  // ---------------------------------------------------------------------------
  // Test Group 2: Valid Supported Policy Settings
  // ---------------------------------------------------------------------------
  console.log('\n▶ Group 2: Valid Supported Policy Settings');
  {
    const validCustom = cloneConfig();
    validCustom.thresholds.lowMax = 15;
    validCustom.thresholds.mediumMax = 40;
    validCustom.thresholds.highMax = 80;
    validCustom.signals[RiskSignalId.PAYMENT_ACTION].scoreContribution = 45;
    validCustom.signals[RiskSignalId.EXTERNAL_NAVIGATION].enabled = false;
    validCustom.trustedDomains = ['internal.company.com', 'login.partner.org', 'localhost'];
    validCustom.timeouts.approvalTtlSeconds = 1800;
    validCustom.timeouts.dashboardPollIntervalMs = 5000;

    const res = validatePolicyConfig(validCustom);
    assert(res.valid, 'Valid custom policy configuration satisfies schema');
    assertEquals(res.errors.length, 0, 'No validation errors for valid custom settings');
    assert(Object.isFrozen(res.config!), 'Validated config is recursively frozen');
  }

  // ---------------------------------------------------------------------------
  // Test Group 3: Invalid Settings Rejection & Bounds Enforcement
  // ---------------------------------------------------------------------------
  console.log('\n▶ Group 3: Invalid Settings & Bounds Enforcement');
  {
    // 3.1 Threshold lower bound violation (lowMax < 5)
    const invalidLow = cloneConfig();
    invalidLow.thresholds.lowMax = 4;
    const resLow = validatePolicyConfig(invalidLow);
    assert(!resLow.valid, 'Rejects lowMax < 5');
    assert(resLow.errors.some((e) => e.code === 'THRESHOLD_BOUNDARY_VIOLATION'), 'Emits THRESHOLD_BOUNDARY_VIOLATION');

    // 3.2 Threshold upper bound violation (highMax > 85)
    const invalidHigh = cloneConfig();
    invalidHigh.thresholds.highMax = 86;
    const resHigh = validatePolicyConfig(invalidHigh);
    assert(!resHigh.valid, 'Rejects highMax > 85 (to ensure CRITICAL starts no later than 86)');
    assert(resHigh.errors.some((e) => e.code === 'THRESHOLD_BOUNDARY_VIOLATION'), 'Emits THRESHOLD_BOUNDARY_VIOLATION');

    // 3.3 Monotonic ordering violation (mediumMax <= lowMax)
    const invertedThresholds = cloneConfig();
    invertedThresholds.thresholds.lowMax = 30;
    invertedThresholds.thresholds.mediumMax = 25;
    const resInverted = validatePolicyConfig(invertedThresholds);
    assert(!resInverted.valid, 'Rejects mediumMax <= lowMax');
    assert(resInverted.errors.some((e) => e.code === 'THRESHOLD_ORDERING_VIOLATION'), 'Emits THRESHOLD_ORDERING_VIOLATION');

    // 3.4 Disabling mandatory invariant signal (DESTRUCTIVE_ACTION)
    const disabledDestructiveSignal = cloneConfig();
    disabledDestructiveSignal.signals[RiskSignalId.DESTRUCTIVE_ACTION].enabled = false;
    const resDestSignal = validatePolicyConfig(disabledDestructiveSignal);
    assert(!resDestSignal.valid, 'Rejects disabling mandatory DESTRUCTIVE_ACTION signal');
    assert(resDestSignal.errors.some((e) => e.code === 'MANDATORY_SIGNAL_DISABLED'), 'Emits MANDATORY_SIGNAL_DISABLED');

    // 3.5 Lowering destructive weight below minimum invariant
    const weakDestructiveSignal = cloneConfig();
    weakDestructiveSignal.signals[RiskSignalId.DESTRUCTIVE_ACTION].scoreContribution = 20;
    const resWeakSignal = validatePolicyConfig(weakDestructiveSignal);
    assert(!resWeakSignal.valid, 'Rejects lowering DESTRUCTIVE_ACTION weight below 25');
    assert(resWeakSignal.errors.some((e) => e.code === 'MANDATORY_SIGNAL_WEIGHT_TOO_LOW'), 'Emits MANDATORY_SIGNAL_WEIGHT_TOO_LOW');

    // 3.6 Downgrading mandatory policy rule (CONTROLLED_DESTRUCTIVE) to WARN or ALLOW
    const downgradedDestructiveRule = cloneConfig();
    const destIdx = downgradedDestructiveRule.policies.findIndex((p: any) => p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE);
    downgradedDestructiveRule.policies[destIdx].decision = ResponseAction.WARN;
    const resDowngrade = validatePolicyConfig(downgradedDestructiveRule);
    assert(!resDowngrade.valid, 'Rejects downgrading CONTROLLED_DESTRUCTIVE to WARN');
    assert(resDowngrade.errors.some((e) => e.code === 'MANDATORY_PROTECTION_DOWNGRADE'), 'Emits MANDATORY_PROTECTION_DOWNGRADE');

    // 3.7 Downgrading sensitive boundary policy to ALLOW
    const paymentToAllow = cloneConfig();
    const payIdx = paymentToAllow.policies.findIndex((p: any) => p.id === RiskPolicyId.CONTROLLED_PAYMENT);
    paymentToAllow.policies[payIdx].decision = ResponseAction.ALLOW;
    const resPayAllow = validatePolicyConfig(paymentToAllow);
    assert(!resPayAllow.valid, 'Rejects configuring CONTROLLED_PAYMENT to ALLOW');
    assert(resPayAllow.errors.some((e) => e.code === 'PROHIBITED_ALLOW_DECISION'), 'Emits PROHIBITED_ALLOW_DECISION');

    // 3.8 Sensitive keyword injection (Password / Secret)
    const secretConfig = cloneConfig();
    secretConfig.password = 'super_secret';
    const resSecret = validatePolicyConfig(secretConfig);
    assert(!resSecret.valid, 'Rejects configuration containing "password" property');
    assert(resSecret.errors.some((e) => e.code === 'FORBIDDEN_SENSITIVE_KEY'), 'Emits FORBIDDEN_SENSITIVE_KEY');

    // 3.9 Invalid trusted domain syntax
    const badDomain = cloneConfig();
    badDomain.trustedDomains = ['https://malicious.org/path'];
    const resBadDomain = validatePolicyConfig(badDomain);
    assert(!resBadDomain.valid, 'Rejects trusted domain containing scheme or path');
    assert(resBadDomain.errors.some((e) => e.code === 'INVALID_DOMAIN_FORMAT'), 'Emits INVALID_DOMAIN_FORMAT');

    // 3.10 Timeout bounds violations
    const badTimeout = cloneConfig();
    badTimeout.timeouts.approvalTtlSeconds = 30; // Min is 60s
    const resBadTimeout = validatePolicyConfig(badTimeout);
    assert(!resBadTimeout.valid, 'Rejects approvalTtlSeconds < 60');
    assert(resBadTimeout.errors.some((e) => e.code === 'TIMEOUT_OUT_OF_BOUNDS'), 'Emits TIMEOUT_OUT_OF_BOUNDS');
  }

  // ---------------------------------------------------------------------------
  // Test Group 4: Missing Settings & Fail-Closed Defaults Resolution
  // ---------------------------------------------------------------------------
  console.log('\n▶ Group 4: Missing Settings & Fail-Closed Fallback');
  {
    // 4.1 resolveSafePolicyConfig with null/undefined returns clean frozen defaults
    const safeNull = resolveSafePolicyConfig(null);
    assertEquals(safeNull.schemaVersion, CURRENT_ARCHITECTURE_SCHEMA_VERSION, 'null resolves to default schemaVersion');
    assertEquals(safeNull.thresholds.lowMax, 24, 'null resolves to default lowMax');

    const safeUndefined = resolveSafePolicyConfig(undefined);
    assertEquals(safeUndefined.thresholds.highMax, 74, 'undefined resolves to default highMax');

    // 4.2 Malformed config safely falls back to defaults without throwing
    const corruptCandidate = { thresholds: 'broken', policies: 123 };
    const safeCorrupt = resolveSafePolicyConfig(corruptCandidate);
    assertEquals(safeCorrupt.thresholds.lowMax, 24, 'Corrupted candidate safely falls back to default lowMax');
    assertEquals(safeCorrupt.policies.length, DEFAULT_POLICY_RULES.length, 'Corrupted candidate retains all default policy rules');

    // 4.3 Partial configuration merge applies documented defaults and tracks DEGRADED health
    const partialConfig = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      // Missing thresholds, signals, policies, trustedDomains, timeouts
    };
    const mergeRes = mergeConfigWithDefaults(partialConfig);
    assertEquals(mergeRes.healthStatus, ConfigHealthStatus.DEGRADED, 'Partial config results in DEGRADED health status');
    assertEquals(mergeRes.config.thresholds.lowMax, 24, 'Missing thresholds filled with default lowMax');
    assertEquals(mergeRes.config.policies.length, 6, 'Missing policies filled with default policies');
  }

  // ---------------------------------------------------------------------------
  // Test Group 5: Policy Versioning & Compatibility
  // ---------------------------------------------------------------------------
  console.log('\n▶ Group 5: Safe Policy Versioning & Semver Enforcement');
  {
    // 5.1 Compatible 1.x versions
    const compat100 = checkVersionCompatibility('1.0.0', 'policyVersion');
    assert(compat100.compatible, 'v1.0.0 is compatible');

    const compat120 = checkVersionCompatibility('1.2.0', 'policyVersion');
    assert(compat120.compatible, 'v1.2.0 is forward-compatible minor version');

    // 5.2 Stale versions (< 1.0.0)
    const staleV09 = checkVersionCompatibility('0.9.0', 'policyVersion');
    assert(!staleV09.compatible, 'v0.9.0 is rejected as stale');
    assertEquals(staleV09.code, 'STALE_CONFIG_VERSION', 'Stale version emits STALE_CONFIG_VERSION');

    // 5.3 Unsupported breaking versions (> 1.x)
    const futureV2 = checkVersionCompatibility('2.0.0', 'policyVersion');
    assert(!futureV2.compatible, 'v2.0.0 is rejected as unsupported');
    assertEquals(futureV2.code, 'UNSUPPORTED_CONFIG_VERSION', 'Future breaking version emits UNSUPPORTED_CONFIG_VERSION');

    // 5.4 Malformed semver strings
    const invalidSemver = checkVersionCompatibility('not-semver', 'policyVersion');
    assert(!invalidSemver.compatible, 'Malformed semver rejected');
    assertEquals(invalidSemver.code, 'INVALID_SEMVER_FORMAT', 'Malformed semver emits INVALID_SEMVER_FORMAT');
  }

  // ---------------------------------------------------------------------------
  // Test Group 6: Extension & Backend Contract Consistency & Server Validation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Group 6: Extension & Backend Contract Consistency');
  {
    const ownershipRegistry = new InMemoryActionOwnershipRegistry();
    const contactRegistry = new InMemoryTrustedContactRegistry();
    const service = new ApprovalService({
      actionOwnershipRegistry: ownershipRegistry,
      contactRegistry: contactRegistry,
    });

    const wardAuth: AuthContext = {
      actorId: 'usr_ward_1',
      role: ActorRole.USER,
      sessionId: 'sess_1',
      isAuthenticated: true,
    };

    ownershipRegistry.registerActionOwnership('act_dest_1', 'usr_ward_1');
    ownershipRegistry.registerActionOwnership('act_pay_1', 'usr_ward_1');

    // 6.1 Server rejects client falsely claiming LOW risk for DESTRUCTIVE action
    let rejectedDestructive = false;
    try {
      service.createRequest(
        {
          actionId: 'act_dest_1',
          actionDescription: 'Purge all customer data',
          actionType: ActionType.CLICK,
          category: ActionCategory.DESTRUCTIVE,
          riskLevel: RiskLevel.LOW, // False / tampered claim
          policyVersion: '1.0.0',
        },
        wardAuth
      );
    } catch (err: any) {
      if (err instanceof ApprovalValidationError) {
        rejectedDestructive = true;
        assert(
          err.errors.some((e) => e.includes('Destructive actions cannot be submitted with LOW risk level')),
          'Server rejects destructive action falsely submitted with LOW risk level'
        );
      }
    }
    assert(rejectedDestructive, 'Server-side invariant prevented LOW risk destructive action submission');

    // 6.2 Server rejects client falsely claiming LOW risk for PAYMENT action
    let rejectedPayment = false;
    try {
      service.createRequest(
        {
          actionId: 'act_pay_1',
          actionDescription: 'Transfer $10,000',
          actionType: ActionType.CLICK,
          category: ActionCategory.PAYMENT,
          riskLevel: RiskLevel.LOW, // False claim
          policyVersion: '1.0.0',
        },
        wardAuth
      );
    } catch (err: any) {
      if (err instanceof ApprovalValidationError) {
        rejectedPayment = true;
        assert(
          err.errors.some((e) => e.includes('Financial checkout/payment actions cannot be submitted with LOW risk level')),
          'Server rejects payment action falsely submitted with LOW risk level'
        );
      }
    }
    assert(rejectedPayment, 'Server-side invariant prevented LOW risk payment action submission');

    // 6.3 Server rejects incompatible policyVersion on request creation
    ownershipRegistry.registerActionOwnership('act_stale_1', 'usr_ward_1');
    let rejectedStaleVersion = false;
    try {
      service.createRequest(
        {
          actionId: 'act_stale_1',
          actionDescription: 'Valid action with stale policy version',
          actionType: ActionType.CLICK,
          category: ActionCategory.GENERAL,
          riskLevel: RiskLevel.MEDIUM,
          policyVersion: '0.8.0', // Stale version
        },
        wardAuth
      );
    } catch (err: any) {
      if (err instanceof ApprovalValidationError) {
        rejectedStaleVersion = true;
        assert(
          err.errors.some((e) => e.includes('Stale configuration version')),
          'Server rejects request submitted under stale policyVersion (v0.8.0)'
        );
      }
    }
    assert(rejectedStaleVersion, 'Server-side policy version check enforced');

    // 6.4 HTTP API GET /api/v1/policy-config returns canonical configuration and specifications
    const router = new ApprovalApiRouter(service, {
      verifyToken: () => wardAuth,
    });

    const getPolicyRes = await router.dispatch({
      method: 'GET',
      url: '/api/v1/policy-config',
    });

    assertEquals(getPolicyRes.statusCode, 200, 'GET /api/v1/policy-config returns 200');
    assert(getPolicyRes.body.success, 'Policy config response has success: true');
    const policyData = getPolicyRes.body.data as any;
    assertEquals(policyData.schemaVersion, '1.0.0', 'API exposes current schemaVersion 1.0.0');
    assertEquals(policyData.policyVersion, '1.0.0', 'API exposes current policyVersion 1.0.0');
    assertEquals(policyData.config.thresholds.lowMax, 24, 'API returns canonical default thresholds');
    assert(Array.isArray(policyData.specifications), 'API returns programmatic specifications array');

    // 6.5 HTTP API POST /api/v1/policy-config/validate validates candidate server-side
    const validCandidate = cloneConfig();
    const validateOkRes = await router.dispatch({
      method: 'POST',
      url: '/api/v1/policy-config/validate',
      headers: { 'content-type': 'application/json' },
      body: validCandidate,
    });
    assertEquals(validateOkRes.statusCode, 200, 'POST /api/v1/policy-config/validate returns 200 for valid candidate');
    assert((validateOkRes.body.data as any).valid, 'Candidate marked valid server-side');

    // 6.6 HTTP API POST /api/v1/policy-config/validate rejects invalid candidate
    const invalidCandidate = cloneConfig();
    invalidCandidate.thresholds.lowMax = 999;
    const validateBadRes = await router.dispatch({
      method: 'POST',
      url: '/api/v1/policy-config/validate',
      headers: { 'content-type': 'application/json' },
      body: invalidCandidate,
    });
    assertEquals(validateBadRes.statusCode, 400, 'POST /api/v1/policy-config/validate returns 400 for invalid candidate');
    assertEquals(validateBadRes.body.error?.code, 'INVALID_POLICY_CONFIG', 'Error code is INVALID_POLICY_CONFIG');
  }

  // ---------------------------------------------------------------------------
  // Test Group 7: Programmatic Policy Specifications Dictionary
  // ---------------------------------------------------------------------------
  console.log('\n▶ Group 7: Programmatic Policy Specifications Completeness');
  {
    assert(POLICY_SETTINGS_SPECIFICATIONS.length >= 15, 'Specifications dictionary contains all major setting keys');

    for (const spec of POLICY_SETTINGS_SPECIFICATIONS) {
      assert(typeof spec.key === 'string' && spec.key.length > 0, `Spec key "${spec.key}" is valid`);
      assert(typeof spec.title === 'string' && spec.title.length > 0, `Spec "${spec.key}" has title`);
      assert(typeof spec.description === 'string' && spec.description.length > 0, `Spec "${spec.key}" has description`);
      assert(typeof spec.securityImplication === 'string' && spec.securityImplication.length > 0, `Spec "${spec.key}" documents security implications`);
      assert(typeof spec.isImmutableInvariant === 'boolean', `Spec "${spec.key}" specifies isImmutableInvariant flag`);
    }

    const destructiveSpec = POLICY_SETTINGS_SPECIFICATIONS.find((s) => s.key === 'policies.CONTROLLED_DESTRUCTIVE');
    assert(Boolean(destructiveSpec), 'Specification for CONTROLLED_DESTRUCTIVE exists');
    assertEquals(Boolean(destructiveSpec?.isImmutableInvariant), true, 'CONTROLLED_DESTRUCTIVE spec is marked immutable invariant');
    assert(Boolean(destructiveSpec?.securityImplication.includes('Core safety invariant')), 'Documents core safety invariant in implication');

    const highMaxSpec = POLICY_SETTINGS_SPECIFICATIONS.find((s) => s.key === 'thresholds.highMax');
    assert(Boolean(highMaxSpec), 'Specification for thresholds.highMax exists');
    assertEquals(highMaxSpec?.maxValue, 85, 'highMax maxValue documented as 85');
  }

  console.log('\n======================================================================');
  console.log(`Results: ${passedTests} passed, 0 failed across all 7 test groups`);
  console.log('======================================================================');
  console.log('🎉 ALL PROTECTION POLICY MODEL & SOURCE OF TRUTH TESTS PASSED CLEANLY!\n');
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  if (typeof process !== 'undefined' && process.exit) {
    process.exit(1);
  }
});
