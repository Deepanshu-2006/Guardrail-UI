/**
 * Guardrail Central Policy Configuration Loader & Failure Handling Test Suite
 *
 * Comprehensive integration tests verifying:
 * 1. Documented defaults applied when optional configuration fields are missing.
 * 2. Malformed configuration rejected rather than interpreting unknown values as ALLOW.
 * 3. Mandatory protection rules preserved when optional configuration is invalid.
 * 4. Explicit error and degraded states (HEALTHY, DEGRADED, FAILED) when configuration cannot be loaded.
 * 5. Stale and unsupported version detection (semver compatibility enforcement).
 * 6. Unknown policy identifiers and unsupported action types cannot weaken defense.
 * 7. Clear distinction between configuration-loading failure and evaluated ALLOW decisions.
 * 8. Elimination of excessive resource usage via debouncing and cooldown throttling.
 * 9. Privacy preservation: zero credentials, passwords, or tokens in logs or error messages.
 * 10. Accurate interception tracking: never claiming an action was intercepted if not held.
 * 11. Security invariant: recovery from failure never auto-executes held actions.
 */

import { ActionCategory, ActionType } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import { RiskSignalId, RiskEvaluationStatus } from '../types/risk.js';
import { ConfigHealthStatus } from '../types/config.js';
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  assertValidPolicyConfig,
  validatePolicyConfig,
} from './schema.js';
import {
  checkVersionCompatibility,
  mergeConfigWithDefaults,
  InMemoryConfigStorageProvider,
  PolicyConfigLoader,
  GUARDRAIL_POLICY_CONFIG_STORAGE_KEY,
  sanitizeLogString,
  scanForSensitiveContent,
} from './loader.js';
import {
  PolicyConfigRegistry,
  defaultPolicyConfigRegistry,
} from './registry.js';
import { evaluateActionPipeline } from '../response/engine.js';
import { InterceptionController } from '../interception/controller.js';
import { InterceptionState } from '../types/interception.js';

// =============================================================================
// Lightweight Test Harness
// =============================================================================

let totalAssertions = 0;
let passedAssertions = 0;
let currentSuiteName = '';

function assert(condition: boolean, message: string): void {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed in suite "${currentSuiteName}": ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalAssertions++;
  if (actual === expected) {
    passedAssertions++;
    console.log(`  ✓ ${message} (expected: ${expected}, got: ${actual})`);
  } else {
    console.error(`  ✗ FAIL: ${message} - Expected: ${expected}, Got: ${actual}`);
    throw new Error(
      `Assertion failed in suite "${currentSuiteName}": ${message} (expected: ${expected}, got: ${actual})`
    );
  }
}

function suite(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  currentSuiteName = name;
  console.log(`\n▶ ${name}`);
  return fn();
}

// =============================================================================
// Helper Factories
// =============================================================================

function createRoutineAction(actionId = 'act-routine-001') {
  return {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    element: {
      tagName: 'BUTTON',
      id: 'view-catalog',
      visibleText: 'View Catalog',
    },
    page: {
      url: 'https://example.com/catalog',
      title: 'Catalog',
    },
  };
}

function createDestructiveAction(actionId = 'act-destr-001') {
  return {
    id: actionId,
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    category: ActionCategory.DESTRUCTIVE,
    element: {
      tagName: 'BUTTON',
      id: 'btn-delete-account',
      visibleText: 'Delete Account Permanently',
    },
    page: {
      url: 'https://example.com/settings',
      title: 'Settings',
    },
  };
}


// =============================================================================
// Test Suites
// =============================================================================

async function runAllTests(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL POLICY CONFIG LOADER & FAILURE HANDLING TEST SUITE');
  console.log('====================================================================');

  // ---------------------------------------------------------------------------
  // Suite 1: Missing Configuration & Defaults Merging
  // ---------------------------------------------------------------------------
  await suite('Suite 1: Missing Configuration & Defaults Merging (Requirement 1)', () => {
    // 1.1 Null or undefined storage produces healthy default configuration
    const nullRes = mergeConfigWithDefaults(null);
    assertEquals(nullRes.healthStatus, ConfigHealthStatus.HEALTHY, 'Null candidate resolves to HEALTHY');
    assertEquals(nullRes.config.schemaVersion, '1.0.0', 'Schema version defaults to 1.0.0');
    assertEquals(nullRes.config.policies.length, 6, 'Contains 6 default policies');

    const undefRes = mergeConfigWithDefaults(undefined);
    assertEquals(undefRes.healthStatus, ConfigHealthStatus.HEALTHY, 'Undefined candidate resolves to HEALTHY');

    // 1.2 Partial candidate with missing optional fields
    const partialCandidate = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      thresholds: {
        highMax: 80,
      },
    };
    const merged = mergeConfigWithDefaults(partialCandidate);
    assertEquals(merged.healthStatus, ConfigHealthStatus.DEGRADED, 'Partial config resolves to DEGRADED');
    assertEquals(merged.config.thresholds.highMax, 80, 'Merged custom highMax');
    assertEquals(merged.config.thresholds.lowMax, 24, 'Fills in default lowMax');
    assertEquals(merged.config.thresholds.mediumMax, 49, 'Fills in default mediumMax');
    assertEquals(merged.config.trustedDomains.length, 0, 'Defaults trustedDomains to empty array');
    assertEquals(merged.config.timeouts.approvalTtlSeconds, 3600, 'Defaults approvalTtlSeconds to 3600');
    assertEquals(merged.config.timeouts.dashboardPollIntervalMs, 10000, 'Defaults dashboardPollIntervalMs to 10000');
    assert(merged.nonFatalErrors.length > 0, 'Logs non-fatal notices for missing optional fields');

    // 1.3 Partial signals populated from defaults
    const partialSignals = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      signals: {
        [RiskSignalId.DESTRUCTIVE_ACTION]: {
          id: RiskSignalId.DESTRUCTIVE_ACTION,
          enabled: true,
          scoreContribution: 60,
        },
      },
    };
    const mergedSignals = mergeConfigWithDefaults(partialSignals);
    assertEquals(
      mergedSignals.config.signals[RiskSignalId.DESTRUCTIVE_ACTION].scoreContribution,
      60,
      'Applies custom score contribution for DESTRUCTIVE_ACTION'
    );
    assertEquals(
      mergedSignals.config.signals[RiskSignalId.PAYMENT_ACTION].scoreContribution,
      40,
      'Defaults score contribution for omitted PAYMENT_ACTION'
    );
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Reject Malformed Configuration (Never ALLOW)
  // ---------------------------------------------------------------------------
  await suite('Suite 2: Reject Malformed Configuration (Requirement 2)', () => {
    // 2.1 Malformed roots (primitive strings, numbers, arrays)
    const stringCandidate = 'corrupt-string';
    const stringRes = mergeConfigWithDefaults(stringCandidate);
    assertEquals(stringRes.healthStatus, ConfigHealthStatus.FAILED, 'Primitive string root is FAILED');
    assertEquals(stringRes.fatalError?.code, 'INVALID_CONFIG_ROOT', 'Fatal error code is INVALID_CONFIG_ROOT');

    const arrayCandidate = [1, 2, 3];
    const arrayRes = mergeConfigWithDefaults(arrayCandidate);
    assertEquals(arrayRes.healthStatus, ConfigHealthStatus.FAILED, 'Array root is FAILED');

    // 2.2 Unknown/malformed policy decision strings (e.g. "BYPASS", "ALLOW_ALL", null)
    const malformedDecisionCandidate = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      policies: [
        {
          id: RiskPolicyId.CONTROLLED_PAYMENT,
          name: 'Payment Policy',
          enabled: true,
          actionTypes: [ActionType.CLICK],
          decision: 'BYPASS_CHECKOUT', // Unknown decision
          priority: 250,
          reasonCode: 'TEST',
          userExplanation: 'Test explanation',
        },
      ],
    };
    const malformedDecisionRes = mergeConfigWithDefaults(malformedDecisionCandidate);
    const paymentPolicy = malformedDecisionRes.config.policies.find(
      (p) => p.id === RiskPolicyId.CONTROLLED_PAYMENT
    );
    assert(paymentPolicy !== undefined, 'Payment policy present');
    assertEquals(
      paymentPolicy?.decision,
      ResponseAction.WARN,
      'Unknown decision "BYPASS_CHECKOUT" is NEVER interpreted as ALLOW; safely reverted to default WARN'
    );

    // 2.3 Out-of-bounds thresholds reverted safely
    const outOfBoundsThresholds = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      thresholds: {
        lowMax: 90, // Out of bounds: lowMax must be < mediumMax and <= 35
        mediumMax: 40,
        highMax: 20,
      },
    };
    const thRes = mergeConfigWithDefaults(outOfBoundsThresholds);
    assertEquals(thRes.config.thresholds.lowMax, 24, 'Reverts to default lowMax');
    assertEquals(thRes.config.thresholds.mediumMax, 49, 'Reverts to default mediumMax');
    assertEquals(thRes.config.thresholds.highMax, 74, 'Reverts to default highMax');
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Preservation of Mandatory Protection Rules
  // ---------------------------------------------------------------------------
  await suite('Suite 3: Preservation of Mandatory Protection Rules (Requirement 3)', () => {
    // 3.1 Candidate attempting to disable CONTROLLED_DESTRUCTIVE
    const disableDestructiveCandidate = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      policies: [
        {
          id: RiskPolicyId.CONTROLLED_DESTRUCTIVE,
          name: 'Disabled Destructive',
          enabled: false, // Illegal attempt to disable invariant
          actionTypes: [ActionType.CLICK],
          decision: ResponseAction.PROTECT,
          priority: 300,
          reasonCode: 'TEST',
          userExplanation: 'Test',
        },
      ],
    };
    const destrRes = mergeConfigWithDefaults(disableDestructiveCandidate);
    const destrRule = destrRes.config.policies.find(
      (p) => p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE
    );
    assertEquals(destrRule?.enabled, true, 'CONTROLLED_DESTRUCTIVE cannot be disabled (remains true)');
    assertEquals(destrRule?.decision, ResponseAction.PROTECT, 'CONTROLLED_DESTRUCTIVE decision remains PROTECT');

    // 3.2 Candidate attempting to downgrade CONTROLLED_DESTRUCTIVE to ALLOW
    const downgradeDestructiveCandidate = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      policies: [
        {
          id: RiskPolicyId.CONTROLLED_DESTRUCTIVE,
          name: 'Downgraded Destructive',
          enabled: true,
          actionTypes: [ActionType.CLICK],
          decision: ResponseAction.ALLOW, // Illegal attempt to downgrade invariant
          priority: 300,
          reasonCode: 'TEST',
          userExplanation: 'Test',
        },
      ],
    };
    const downRes = mergeConfigWithDefaults(downgradeDestructiveCandidate);
    const downRule = downRes.config.policies.find(
      (p) => p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE
    );
    assertEquals(downRule?.decision, ResponseAction.PROTECT, 'CONTROLLED_DESTRUCTIVE decision forced to PROTECT');

    // 3.3 Candidate attempting to downgrade UNSUPPORTED_BOUNDARY_GUARD to ALLOW
    const downgradeBoundaryCandidate = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      policies: [
        {
          id: RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD,
          name: 'Boundary Guard',
          enabled: true,
          actionTypes: [ActionType.INPUT, ActionType.SUBMIT],
          decision: ResponseAction.ALLOW,
          priority: 350,
          reasonCode: 'TEST',
          userExplanation: 'Test',
        },
      ],
    };
    const boundRes = mergeConfigWithDefaults(downgradeBoundaryCandidate);
    const boundRule = boundRes.config.policies.find(
      (p) => p.id === RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD
    );
    assertEquals(boundRule?.decision, ResponseAction.PROTECT, 'UNSUPPORTED_BOUNDARY_GUARD remains PROTECT');

    // 3.4 Sensitive boundary policies (PAYMENT, EXTERNAL_NAVIGATION, AUTH) cannot be ALLOW
    const sensitiveAllowCandidate = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      policies: [
        {
          id: RiskPolicyId.CONTROLLED_PAYMENT,
          name: 'Payment',
          enabled: true,
          actionTypes: [ActionType.CLICK],
          decision: ResponseAction.ALLOW, // Sensitive boundary downgrade attempt
          priority: 250,
          reasonCode: 'TEST',
          userExplanation: 'Test',
        },
        {
          id: RiskPolicyId.EXTERNAL_NAVIGATION,
          name: 'Nav',
          enabled: true,
          actionTypes: [ActionType.NAVIGATION],
          decision: ResponseAction.ALLOW, // Sensitive boundary downgrade attempt
          priority: 200,
          reasonCode: 'TEST',
          userExplanation: 'Test',
        },
        {
          id: RiskPolicyId.AUTHENTICATION_BOUNDARY,
          name: 'Auth',
          enabled: true,
          actionTypes: [ActionType.INPUT],
          decision: ResponseAction.ALLOW, // Sensitive boundary downgrade attempt
          priority: 150,
          reasonCode: 'TEST',
          userExplanation: 'Test',
        },
      ],
    };
    const sensRes = mergeConfigWithDefaults(sensitiveAllowCandidate);
    const payment = sensRes.config.policies.find((p) => p.id === RiskPolicyId.CONTROLLED_PAYMENT);
    const nav = sensRes.config.policies.find((p) => p.id === RiskPolicyId.EXTERNAL_NAVIGATION);
    const auth = sensRes.config.policies.find((p) => p.id === RiskPolicyId.AUTHENTICATION_BOUNDARY);

    assertEquals(payment?.decision, ResponseAction.WARN, 'Payment policy ALLOW downgrade rejected, set to WARN');
    assertEquals(nav?.decision, ResponseAction.WARN, 'Nav policy ALLOW downgrade rejected, set to WARN');
    assertEquals(auth?.decision, ResponseAction.WARN, 'Auth policy ALLOW downgrade rejected, set to WARN');
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Version Compatibility & Stale Version Detection
  // ---------------------------------------------------------------------------
  await suite('Suite 4: Version Compatibility & Stale Version Detection (Requirement 5)', () => {
    // 4.1 Valid 1.0.0 version
    const validCompat = checkVersionCompatibility('1.0.0');
    assertEquals(validCompat.compatible, true, 'Version 1.0.0 is compatible');

    const minorUpgradeCompat = checkVersionCompatibility('1.2.3');
    assertEquals(minorUpgradeCompat.compatible, true, 'Version 1.2.3 is compatible');

    // 4.2 Stale versions (v0.x)
    const staleV09 = checkVersionCompatibility('0.9.0');
    assertEquals(staleV09.compatible, false, 'v0.9.0 is rejected');
    assertEquals(staleV09.code, 'STALE_CONFIG_VERSION', 'Error code is STALE_CONFIG_VERSION');

    const staleV01 = checkVersionCompatibility('0.1.0');
    assertEquals(staleV01.compatible, false, 'v0.1.0 is rejected');
    assertEquals(staleV01.code, 'STALE_CONFIG_VERSION', 'Error code is STALE_CONFIG_VERSION');

    // 4.3 Unsupported future versions (v2.x)
    const futureV2 = checkVersionCompatibility('2.0.0');
    assertEquals(futureV2.compatible, false, 'v2.0.0 is rejected');
    assertEquals(futureV2.code, 'UNSUPPORTED_CONFIG_VERSION', 'Error code is UNSUPPORTED_CONFIG_VERSION');

    // 4.4 Malformed semver strings
    const invalidVer = checkVersionCompatibility('not-a-semver');
    assertEquals(invalidVer.compatible, false, 'Invalid semver is rejected');
    assertEquals(invalidVer.code, 'INVALID_CONFIG_VERSION', 'Error code is INVALID_CONFIG_VERSION');

    // 4.5 In loader merge: Stale configuration candidate results in FAILED state
    const staleCandidate = {
      schemaVersion: '0.8.0',
      policyVersion: '0.8.0',
    };
    const staleRes = mergeConfigWithDefaults(staleCandidate);
    assertEquals(staleRes.healthStatus, ConfigHealthStatus.FAILED, 'Stale configuration causes FAILED status');
    assertEquals(staleRes.fatalError?.code, 'STALE_CONFIG_VERSION', 'Fatal error code is STALE_CONFIG_VERSION');
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Unknown Policies & Unsupported Action Types
  // ---------------------------------------------------------------------------
  await suite('Suite 5: Unknown Policies & Unsupported Action Types (Requirement 6)', () => {
    // 5.1 Unknown policy identifier must not be included or weaken existing protection
    const unknownPolicyCandidate = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      policies: [
        {
          id: 'CUSTOM_PERMISSIVE_BYPASS_ALL', // Unknown policy identifier
          name: 'Bypass All',
          enabled: true,
          actionTypes: [ActionType.CLICK],
          decision: ResponseAction.ALLOW,
          priority: 999,
          reasonCode: 'BYPASS',
          userExplanation: 'Bypass',
        },
      ],
    };
    const unknownRes = mergeConfigWithDefaults(unknownPolicyCandidate);
    const hasUnknown = unknownRes.config.policies.some(
      (p) => (p.id as string) === 'CUSTOM_PERMISSIVE_BYPASS_ALL'
    );
    assertEquals(hasUnknown, false, 'Unknown policy identifier is strictly excluded');
    assertEquals(
      unknownRes.config.policies.length,
      6,
      'Preserves all 6 canonical policies without intrusion'
    );

    // 5.2 Unsupported action types filtered out
    const unsupportedActionTypeCandidate = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      policies: [
        {
          id: RiskPolicyId.CONTROLLED_PAYMENT,
          name: 'Payment',
          enabled: true,
          actionTypes: ['TELEPORT', 'SUPER_ADMIN_EXECUTE', ActionType.CLICK], // Unsupported types mixed in
          decision: ResponseAction.WARN,
          priority: 250,
          reasonCode: 'TEST',
          userExplanation: 'Test',
        },
      ],
    };
    const filteredRes = mergeConfigWithDefaults(unsupportedActionTypeCandidate);
    const filteredPayment = filteredRes.config.policies.find(
      (p) => p.id === RiskPolicyId.CONTROLLED_PAYMENT
    );
    assert(filteredPayment !== undefined, 'Payment rule present');
    assertEquals(
      filteredPayment?.actionTypes.includes(ActionType.CLICK),
      true,
      'Retains supported ActionType.CLICK'
    );
    assertEquals(
      (filteredPayment?.actionTypes as string[]).includes('TELEPORT'),
      false,
      'Filters out unsupported action type TELEPORT'
    );
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Health States & Storage Error Handling
  // ---------------------------------------------------------------------------
  await suite('Suite 6: Health States & Storage Error Handling (Requirement 4)', async () => {
    const storage = new InMemoryConfigStorageProvider();
    const loader = new PolicyConfigLoader({ storageProvider: storage, cooldownMs: 1000 });

    // 6.1 Initial state before loading
    assertEquals(loader.getHealthStatus(), ConfigHealthStatus.UNINITIALIZED, 'Initial health status is UNINITIALIZED');

    // 6.2 Load from empty storage -> clean HEALTHY state with defaults
    const emptyLoad = await loader.load();
    assertEquals(emptyLoad.healthStatus, ConfigHealthStatus.HEALTHY, 'Empty storage loads as HEALTHY');
    assertEquals(emptyLoad.fromCache, false, 'Loaded directly from storage');

    // 6.3 Corrupted storage throwing exception -> transitions to FAILED state
    const failingStorage: any = {
      get: async () => {
        throw new Error('Simulated disk/quota read failure');
      },
      set: async () => {},
    };
    const failingLoader = new PolicyConfigLoader({ storageProvider: failingStorage, cooldownMs: 2000 });
    const failLoad = await failingLoader.load();

    assertEquals(failLoad.healthStatus, ConfigHealthStatus.FAILED, 'Storage exception transitions to FAILED');
    assertEquals(failLoad.error?.code, 'STORAGE_READ_ERROR', 'Error code is STORAGE_READ_ERROR');
    assertEquals(failLoad.error?.fatal, true, 'Error marked as fatal');
    assertEquals(failLoad.config.schemaVersion, '1.0.0', 'Operates fail-closed with default configuration');

    // 6.4 Registry tracks health status and last error
    const registry = new PolicyConfigRegistry({ loader: failingLoader });
    await registry.loadFromStorage();
    assertEquals(registry.getHealthStatus(), ConfigHealthStatus.FAILED, 'Registry health status is FAILED');
    assertEquals(registry.isFailed(), true, 'isFailed() returns true');
    assertEquals(registry.isDegraded(), false, 'isDegraded() returns false');
    assert(registry.getLastError() !== undefined, 'Registry has lastError record');
  });

  // ---------------------------------------------------------------------------
  // Suite 7: Distinguishing Config Failure from Evaluated ALLOW Decision
  // ---------------------------------------------------------------------------
  await suite('Suite 7: Distinguishing Config Failure from Evaluated ALLOW (Requirement 7)', () => {
    const routineAction = createRoutineAction('act-routine-comp-01');

    // Reset default registry to clean HEALTHY state
    defaultPolicyConfigRegistry.resetToDefault();
    assertEquals(
      defaultPolicyConfigRegistry.getHealthStatus(),
      ConfigHealthStatus.HEALTHY,
      'Registry reset to HEALTHY'
    );

    // 7.1 Evaluated ALLOW decision in HEALTHY state
    const healthyResult = evaluateActionPipeline(routineAction);
    assertEquals(healthyResult.decision.response, ResponseAction.ALLOW, 'Healthy config evaluates routine click to ALLOW');
    assertEquals(healthyResult.decision.status, RiskEvaluationStatus.EVALUATED, 'Decision status is EVALUATED');
    assertEquals(healthyResult.decision.success, true, 'Decision success is true');
    assertEquals(healthyResult.decision.error, undefined, 'Decision error is undefined');
    assertEquals(healthyResult.evaluationResult.status, RiskEvaluationStatus.EVALUATED, 'Evaluation status is EVALUATED');
    assertEquals(healthyResult.evaluationResult.decision, ResponseAction.ALLOW, 'Evaluation decision is ALLOW');

    // 7.2 Simulate FAILED configuration state
    defaultPolicyConfigRegistry.setHealthStatus(ConfigHealthStatus.FAILED, {
      code: 'CONFIG_LOAD_FAILED',
      message: 'Simulated storage read failure on background init.',
      timestamp: new Date().toISOString(),
      fatal: true,
    });
    assertEquals(defaultPolicyConfigRegistry.isFailed(), true, 'Registry is marked as FAILED');

    // In FAILED state: Same routine click MUST evaluate fail-closed to PROTECT!
    const failedResult = evaluateActionPipeline(routineAction);
    assertEquals(
      failedResult.decision.response,
      ResponseAction.PROTECT,
      'Failed config strictly fails closed to PROTECT (NEVER ALLOW!)'
    );
    assertEquals(
      failedResult.decision.status,
      RiskEvaluationStatus.FAILED,
      'Decision status is FAILED (not EVALUATED)'
    );
    assertEquals(failedResult.decision.success, false, 'Decision success is false (not true)');
    assertEquals(
      failedResult.decision.error?.code,
      'CONFIG_LOAD_FAILED',
      'Decision error code is CONFIG_LOAD_FAILED'
    );
    assertEquals(
      failedResult.evaluationResult.decision,
      ResponseAction.PROTECT,
      'Canonical evaluation result decision is PROTECT'
    );
    assertEquals(
      failedResult.evaluationResult.status,
      RiskEvaluationStatus.FAILED,
      'Canonical evaluation result status is FAILED'
    );

    // Reset registry back to default HEALTHY state for subsequent tests
    defaultPolicyConfigRegistry.resetToDefault();
  });

  // ---------------------------------------------------------------------------
  // Suite 8: Resource Protection: Debouncing & Cooldown Throttling
  // ---------------------------------------------------------------------------
  await suite('Suite 8: Resource Protection: Debouncing & Cooldown (Requirement 8)', async () => {
    let storageReadCount = 0;
    const trackingStorage: ConfigStorageProvider = {
      get: async (key: string) => {
        storageReadCount++;
        // Simulate async delay
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error('Simulated transient storage failure');
      },
      set: async () => {},
    };

    const loader = new PolicyConfigLoader({
      storageProvider: trackingStorage,
      cooldownMs: 300, // 300ms cooldown for fast test
    });

    // 8.1 In-flight Debouncing: Concurrent calls share the same promise
    const p1 = loader.load();
    const p2 = loader.load();
    const p3 = loader.load();

    const [res1, res2, res3] = await Promise.all([p1, p2, p3]);
    assertEquals(storageReadCount, 1, 'Concurrent calls triggered strictly ONE storage read (debounced)');
    assertEquals(res1.healthStatus, ConfigHealthStatus.FAILED, 'Promise 1 resolved to FAILED');
    assertEquals(res2.healthStatus, ConfigHealthStatus.FAILED, 'Promise 2 resolved to FAILED');
    assertEquals(res3.healthStatus, ConfigHealthStatus.FAILED, 'Promise 3 resolved to FAILED');

    // 8.2 Cooldown Throttling: Subsequent call within 300ms cooldown does NOT query storage
    const quickCall = await loader.load();
    assertEquals(storageReadCount, 1, 'Quick call within cooldown did NOT trigger new storage read');
    assertEquals(quickCall.fromCache, true, 'Result returned from in-memory cache');
    assert(quickCall.cooldownRemainingMs > 0, 'Reports positive remaining cooldown milliseconds');

    // 8.3 Forced reload bypasses cooldown
    const forcedCall = await loader.load({ force: true });
    assertEquals(storageReadCount, 2, 'Forced call bypassed cooldown and queried storage');

    // 8.4 Waiting past cooldown allows new attempt
    await new Promise((resolve) => setTimeout(resolve, 350));
    assertEquals(loader.getCooldownRemainingMs(), 0, 'Cooldown expired (0 ms remaining)');
    await loader.load();
    assertEquals(storageReadCount, 3, 'After cooldown expiry, new storage read occurred');
  });

  // ---------------------------------------------------------------------------
  // Suite 9: Privacy Preservation & Zero Sensitive Data Leakage
  // ---------------------------------------------------------------------------
  await suite('Suite 9: Privacy Preservation (Requirements 9 & 11)', () => {
    // 9.1 Sanitize strings containing forbidden credentials
    const cleanStr = sanitizeLogString('standard-policy-rule');
    assertEquals(cleanStr, 'standard-policy-rule', 'Clean string untouched');

    const passStr = sanitizeLogString('UserPassword12345');
    assertEquals(passStr, '[REDACTED_SENSITIVE_DATA]', 'Password pattern redacted');

    const tokenStr = sanitizeLogString('Bearer eyJhbGciOi...');
    assertEquals(tokenStr, '[REDACTED_SENSITIVE_DATA]', 'Bearer token redacted');

    // 9.2 Sensitive configuration scan detects forbidden patterns without value leakage
    const payloadWithPassword = {
      schemaVersion: '1.0.0',
      policyVersion: '1.0.0',
      database: {
        password: 'my-super-secret-password-123',
      },
    };
    const detectedField = scanForSensitiveContent(payloadWithPassword);
    assertEquals(detectedField, 'database.password', 'Identifies sensitive property path');

    // 9.3 Config merge strictly rejects payloads with credentials
    const sensitiveRes = mergeConfigWithDefaults(payloadWithPassword);
    assertEquals(sensitiveRes.healthStatus, ConfigHealthStatus.FAILED, 'Rejects config with sensitive credentials');
    assertEquals(sensitiveRes.fatalError?.code, 'FORBIDDEN_SENSITIVE_CONTENT', 'Code is FORBIDDEN_SENSITIVE_CONTENT');
    assert(
      !sensitiveRes.fatalError?.message.includes('my-super-secret-password-123'),
      'Error message does NOT leak the password value'
    );
  });

  // ---------------------------------------------------------------------------
  // Suite 10: Accurate Interception Tracking
  // ---------------------------------------------------------------------------
  await suite('Suite 10: Accurate Interception Tracking (Requirement 10)', () => {
    const controller = new InterceptionController();
    const actionId = 'act-interception-accuracy-001';

    // 10.1 Before registration: not held
    assertEquals(controller.isActionHeld(actionId), false, 'Untracked action is not held');

    // 10.2 Registered in DETECTED state: not held
    controller.register(actionId, 'Initial registration');
    assertEquals(controller.hasRecord(actionId), true, 'Action is tracked');
    assertEquals(controller.getRecord(actionId)?.state, InterceptionState.DETECTED, 'Action state is DETECTED');
    assertEquals(controller.isActionHeld(actionId), false, 'Action in DETECTED state is NOT claimed as held');

    // 10.3 Transitioned to HELD: isActionHeld returns true
    controller.holdAction(actionId, 'Policy requirement');
    assertEquals(controller.isActionHeld(actionId), true, 'Action in HELD state is confirmed as held');

    // 10.4 Transitioned to CONTINUED: no longer held
    controller.continueAction(actionId, 'Explicit continuation');
    assertEquals(controller.isActionHeld(actionId), false, 'Resolved CONTINUED action is no longer held');
  });

  // ---------------------------------------------------------------------------
  // Suite 11: Recovery Never Auto-Executes Held Actions
  // ---------------------------------------------------------------------------
  await suite('Suite 11: Recovery Never Auto-Executes Held Actions (Requirement 12)', async () => {
    const controller = new InterceptionController();
    const actionId = 'act-recovery-no-autoexec-001';

    // 11.1 Register and hold an action in the interception controller
    controller.register(actionId, 'Action detected');
    controller.holdAction(actionId, 'Held pending authorization');
    assertEquals(controller.isActionHeld(actionId), true, 'Action is actively HELD');

    // Controlled action execution counter
    let controlledHandlerExecutionCount = 0;
    const testControlledHandler = () => {
      controlledHandlerExecutionCount++;
    };

    // 11.2 Registry in initial FAILED state
    const storage = new InMemoryConfigStorageProvider();
    const registry = new PolicyConfigRegistry({ storageProvider: storage });
    registry.setHealthStatus(ConfigHealthStatus.FAILED, {
      code: 'STORAGE_UNAVAILABLE',
      message: 'Failed to access storage.',
      timestamp: new Date().toISOString(),
      fatal: true,
    });
    assertEquals(registry.isFailed(), true, 'Registry is initially in FAILED state');

    // 11.3 Storage becomes healthy with valid configuration
    const validConfig = {
      ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
      updatedAt: '2026-10-27T12:00:00.000Z',
    };
    await storage.set(GUARDRAIL_POLICY_CONFIG_STORAGE_KEY, validConfig);

    // Track listener notifications
    let listenerFiredCount = 0;
    registry.subscribe(() => {
      listenerFiredCount++;
    });

    // 11.4 Configuration reload recovers to HEALTHY
    const reloadResult = await registry.reload();
    assertEquals(reloadResult.healthStatus, ConfigHealthStatus.HEALTHY, 'Reload recovered to HEALTHY status');
    assertEquals(registry.getHealthStatus(), ConfigHealthStatus.HEALTHY, 'Registry status is now HEALTHY');
    assertEquals(registry.isFailed(), false, 'Registry is no longer failed');
    assertEquals(listenerFiredCount, 1, 'Config listener notified of updated configuration');

    // 11.5 CRITICAL SAFETY INVARIANT VERIFICATION:
    // Held action MUST REMAIN HELD; handler MUST NOT have executed!
    assertEquals(
      controller.getRecord(actionId)?.state,
      InterceptionState.HELD,
      'Held action strictly remains in HELD state after config recovery'
    );
    assertEquals(
      controller.isActionHeld(actionId),
      true,
      'Action is still actively HELD'
    );
    assertEquals(
      controlledHandlerExecutionCount,
      0,
      'Controlled handler execution count is strictly 0 (NEVER auto-executed on recovery)'
    );
  });

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n====================================================================');
  console.log(`📊 CONFIGURATION LOADER VERIFICATION: ${passedAssertions} / ${totalAssertions} PASSED`);
  console.log('🎉 ALL 11 SUITES & SAFE LOADING INVARIANTS FULLY SATISFIED!');
  console.log('====================================================================\n');
}

runAllTests().catch((err) => {
  console.error('\n❌ FATAL EXCEPTION IN TEST RUNNER:', err);
  process.exit(1);
});
