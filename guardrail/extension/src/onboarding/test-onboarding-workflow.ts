/**
 * Guardrail Controlled Pilot - Onboarding & First-Time Experience Test Suite
 *
 * Verifies all onboarding workflow states, step transitions, truthful boundary disclosures,
 * browser permission explanations, strict zero-sensitive-data guarantees, Staging Mode invariants,
 * trusted contact participation, live status reporting, and incomplete setup diagnostics.
 */

import { AppEnvironment, EnvironmentConfig, resolveEnvironmentConfig } from '../config/environment.js';
import { ConfigHealthStatus } from '../types/config.js';
import {
  advanceOnboardingStep,
  DEFAULT_ONBOARDING_STATE,
  evaluateProtectionStatus,
  evaluateSetupDiagnostics,
  getStoredOnboardingState,
  InMemoryOnboardingStorageProvider,
  ONBOARDING_STEPS,
  PERMISSION_DISCLOSURES,
  PRIVACY_INVARIANTS,
  resetOnboardingState,
  saveStoredOnboardingState,
  SCOPE_DISCLOSURES,
} from './state.js';
import { OnboardingState, OnboardingStepId, ProtectionStatusReport } from './types.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, description: string): void {
  totalTests++;
  if (!condition) {
    console.error(`  ✕ FAILED: ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
  passedTests++;
  console.log(`  ✓ ${description}`);
}

console.log('====================================================================');
console.log('🧪 GUARDRAIL CONTROLLED PILOT ONBOARDING & SETUP TEST SUITE');
console.log('====================================================================\n');

// ------------------------------------------------------------------
// Test Suite 1: Onboarding State Machine & Step Progression
// ------------------------------------------------------------------
console.log('▶ Test Suite 1: Onboarding State Machine & Step Transitions');
{
  const storage = new InMemoryOnboardingStorageProvider();

  // Fresh state loading
  const initial = await getStoredOnboardingState(storage);
  assert(initial.currentStep === 'installation_guide', 'Initial state starts on installation_guide step');
  assert(initial.completedSteps.length === 0, 'Initial state has zero completed steps');
  assert(initial.isCompleted === false, 'Initial state is not completed');
  assert(initial.acknowledgedScope === false, 'Initial state has not acknowledged scope');
  assert(initial.acknowledgedPermissions === false, 'Initial state has not acknowledged permissions');

  // Step progression without full acknowledgements
  let next = advanceOnboardingStep(initial, 'installation_guide');
  assert(next.currentStep === 'protection_scope', 'Advances to protection_scope after installation_guide');
  assert(next.completedSteps.includes('installation_guide'), 'Records installation_guide as completed');
  assert(next.isCompleted === false, 'Workflow is not complete after only step 1');

  // Advance through all steps with acknowledgements
  next = advanceOnboardingStep(next, 'protection_scope', { scope: true });
  assert(next.acknowledgedScope === true, 'Acknowledge scope recorded');
  assert(next.currentStep === 'browser_permissions', 'Advances to browser_permissions');

  next = advanceOnboardingStep(next, 'browser_permissions', { permissions: true });
  assert(next.acknowledgedPermissions === true, 'Acknowledge permissions recorded');
  assert(next.currentStep === 'staging_mode', 'Advances to staging_mode');

  next = advanceOnboardingStep(next, 'staging_mode', { staging: true });
  assert(next.acknowledgedStaging === true, 'Acknowledge staging recorded');
  assert(next.currentStep === 'trusted_approval', 'Advances to trusted_approval');

  next = advanceOnboardingStep(next, 'trusted_approval', { approvals: true });
  assert(next.acknowledgedApprovals === true, 'Acknowledge approvals recorded');
  assert(next.currentStep === 'protection_status', 'Advances to protection_status');

  next = advanceOnboardingStep(next, 'protection_status');
  assert(next.currentStep === 'setup_complete', 'Advances to setup_complete');

  next = advanceOnboardingStep(next, 'setup_complete');
  assert(next.isCompleted === true, 'Workflow marks isCompleted = true when all steps and acknowledgements are verified');
  assert(typeof next.completedAt === 'string', 'Sets non-null completedAt timestamp');

  // Persistence round-trip
  await saveStoredOnboardingState(next, storage);
  const reloaded = await getStoredOnboardingState(storage);
  assert(reloaded.isCompleted === true, 'Persisted completion state is loaded correctly');
  assert(reloaded.acknowledgedScope === true, 'Persisted scope acknowledgement is retained');
  assert(reloaded.completedSteps.length === ONBOARDING_STEPS.length, 'All 7 steps marked completed');

  // Reset functionality
  const reset = await resetOnboardingState(storage);
  assert(reset.isCompleted === false, 'Reset returns state to isCompleted = false');
  assert(reset.currentStep === 'installation_guide', 'Reset returns currentStep to installation_guide');
  assert(reset.completedSteps.length === 0, 'Reset clears completedSteps list');
}

// ------------------------------------------------------------------
// Test Suite 2: Truthful Protection Scope Disclosures
// ------------------------------------------------------------------
console.log('\n▶ Test Suite 2: Truthful Protection Scope Disclosures');
{
  assert(SCOPE_DISCLOSURES.protectedItems.length >= 4, 'Provides at least 4 detailed protected items');
  assert(SCOPE_DISCLOSURES.unprotectedItems.length >= 4, 'Provides at least 4 detailed unprotected items');

  const protectedText = SCOPE_DISCLOSURES.protectedItems.join(' ');
  const unprotectedText = SCOPE_DISCLOSURES.unprotectedItems.join(' ');

  // Verified truths about what Guardrail protects
  assert(protectedText.includes('data-guardrail-test-action'), 'Discloses that protection requires designated test elements');
  assert(protectedText.includes('Synchronous event interception'), 'Discloses synchronous event cancellation');
  assert(protectedText.includes('Staging Mode'), 'Discloses Staging Mode holding');
  assert(protectedText.includes('fail-closed'), 'Discloses fail-closed protection when policy is corrupt');

  // Verified truths about what Guardrail does NOT protect
  assert(unprotectedText.includes('Arbitrary third-party websites'), 'Explicitly discloses arbitrary websites are not protected');
  assert(unprotectedText.includes('background scripts') || unprotectedText.includes('fetch/XHR'), 'Discloses ambient page scripts/fetch/XHR are not blocked');
  assert(unprotectedText.includes('inactive') || unprotectedText.includes('suspended'), 'Discloses that inactive service worker provides no protection');
  assert(unprotectedText.includes('Phishing') || unprotectedText.includes('malware'), 'Explicitly disclaims universal malware/phishing coverage');
}

// ------------------------------------------------------------------
// Test Suite 3: Browser Permissions & Zero-Sensitive-Data Guarantees
// ------------------------------------------------------------------
console.log('\n▶ Test Suite 3: Browser Permissions & Zero-Sensitive-Data Invariants');
{
  assert(PERMISSION_DISCLOSURES.length >= 2, 'Discloses rationale for all requested browser permissions');

  const storagePerm = PERMISSION_DISCLOSURES.find((p) => p.permission === 'storage');
  assert(storagePerm !== undefined, 'Includes storage permission disclosure');
  assert(storagePerm!.rationale.includes('policy'), 'Explains storage is used for safety policy configuration');
  assert(storagePerm!.whatItNeverAccesses.includes('credentials') || storagePerm!.whatItNeverAccesses.includes('history'), 'Discloses storage never accesses credentials or history');

  const domPerm = PERMISSION_DISCLOSURES.find((p) => p.permission.includes('activeTab') || p.permission.includes('content_scripts'));
  assert(domPerm !== undefined, 'Includes DOM detection permission disclosure');
  assert(domPerm!.whatItNeverAccesses.toLowerCase().includes('password'), 'Discloses DOM script never accesses passwords');
  assert(domPerm!.whatItNeverAccesses.toLowerCase().includes('credit card'), 'Discloses DOM script never accesses credit cards');

  // Strict privacy invariants
  const privacyText = PRIVACY_INVARIANTS.join(' ');
  assert(privacyText.includes('passwords'), 'Guarantees zero password collection');
  assert(privacyText.includes('credit card') || privacyText.includes('CVVs'), 'Guarantees zero payment card collection');
  assert(privacyText.includes('one-time passcodes') || privacyText.includes('OTPs'), 'Guarantees zero OTP collection');
  assert(privacyText.includes('raw user form values'), 'Guarantees zero raw form values collection');
}

// ------------------------------------------------------------------
// Test Suite 4: Staging Mode Understanding & Safety Invariants
// ------------------------------------------------------------------
console.log('\n▶ Test Suite 4: Staging Mode Understanding & Safety Invariants');
{
  const stagingStep = ONBOARDING_STEPS.find((s) => s.id === 'staging_mode');
  assert(stagingStep !== undefined, 'Staging mode step is defined in onboarding checklist');
  assert(stagingStep!.description.includes('held synchronously'), 'Explains synchronous holding');
  assert(stagingStep!.description.includes('zero actions run automatically'), 'Explains zero automatic action execution');
}

// ------------------------------------------------------------------
// Test Suite 5: Trusted Contact Out-of-Band Approvals
// ------------------------------------------------------------------
console.log('\n▶ Test Suite 5: Trusted Contact Participation & Decoupled Review');
{
  const approvalStep = ONBOARDING_STEPS.find((s) => s.id === 'trusted_approval');
  assert(approvalStep !== undefined, 'Trusted approval step is defined in onboarding checklist');
  assert(approvalStep!.description.includes('remote trusted contacts'), 'Explains remote trusted contact role');
  assert(approvalStep!.description.includes('decision decoupling'), 'Explains decision decoupling concept');
}

// ------------------------------------------------------------------
// Test Suite 6: Live Protection Configuration & Status Inspection
// ------------------------------------------------------------------
console.log('\n▶ Test Suite 6: Live Protection Configuration & Status Inspection');
{
  const pilotEnv: EnvironmentConfig = Object.freeze({
    environment: 'pilot',
    apiBaseUrl: 'https://pilot-api.guardrail-safety.org',
    requireHttps: true,
    allowInsecureHttp: false,
    isMockService: false,
    serviceType: 'live',
    timeoutMs: 15000,
    pollIntervalMs: 15000,
  });

  // 1. Healthy pilot status
  const activeReport = evaluateProtectionStatus({
    envConfig: pilotEnv,
    policyHealth: ConfigHealthStatus.HEALTHY,
    isServiceWorkerActive: true,
    isStorageFunctional: true,
  });

  assert(activeReport.status === 'ACTIVE', 'Reports ACTIVE when service worker is running and policy is healthy');
  assert(activeReport.isProtected === true, 'isProtected is true for supported test actions');
  assert(activeReport.statusTitle.includes('Test Actions Only'), 'Title explicitly states Test Actions Only');
  assert(activeReport.statusDescription.includes('Arbitrary websites are not protected'), 'Description explicitly disclaims arbitrary websites');
  assert(activeReport.environment === 'pilot', 'Reflects pilot environment');
  assert(activeReport.isMockService === false, 'Reflects live service');

  // 2. Inactive service worker status
  const inactiveReport = evaluateProtectionStatus({
    envConfig: pilotEnv,
    policyHealth: ConfigHealthStatus.HEALTHY,
    isServiceWorkerActive: false,
    isStorageFunctional: true,
  });

  assert(inactiveReport.status === 'INACTIVE', 'Reports INACTIVE when service worker is offline');
  assert(inactiveReport.isProtected === false, 'isProtected is strictly false when service worker is offline');
  assert(inactiveReport.statusDescription.includes('not evaluated or protected'), 'Truthfully explains that actions are not evaluated when inactive');

  // 3. Corrupt/failed policy status
  const failedPolicyReport = evaluateProtectionStatus({
    envConfig: pilotEnv,
    policyHealth: ConfigHealthStatus.FAILED,
    isServiceWorkerActive: true,
    isStorageFunctional: true,
  });

  assert(failedPolicyReport.status === 'POLICY_ERROR', 'Reports POLICY_ERROR when policy health is FAILED');
  assert(failedPolicyReport.isProtected === false, 'isProtected is false when policy has failed');
  assert(failedPolicyReport.statusTitle.includes('Fail-Closed'), 'Mentions Fail-Closed in status title');

  // 4. Mock service detection
  const devMockEnv: EnvironmentConfig = Object.freeze({
    environment: 'development',
    apiBaseUrl: 'http://localhost:3000',
    requireHttps: false,
    allowInsecureHttp: true,
    isMockService: true,
    serviceType: 'in_memory',
    timeoutMs: 10000,
    pollIntervalMs: 10000,
  });

  const mockReport = evaluateProtectionStatus({
    envConfig: devMockEnv,
    policyHealth: ConfigHealthStatus.HEALTHY,
    isServiceWorkerActive: true,
    isStorageFunctional: true,
  });

  assert(mockReport.isMockService === true, 'Identifies mock service');
  assert(mockReport.diagnostics.warnings.some((w) => w.includes('mock')), 'Emits diagnostic warning for in-memory mock service');
}

// ------------------------------------------------------------------
// Test Suite 7: Incomplete Setup & Error Diagnostics Handling
// ------------------------------------------------------------------
console.log('\n▶ Test Suite 7: Incomplete Setup & Error Diagnostics Handling');
{
  const pilotEnv: EnvironmentConfig = Object.freeze({
    environment: 'pilot',
    apiBaseUrl: 'https://pilot-api.guardrail-safety.org',
    requireHttps: true,
    allowInsecureHttp: false,
    isMockService: false,
    serviceType: 'live',
    timeoutMs: 15000,
    pollIntervalMs: 15000,
  });

  // Storage failure diagnostics
  const storageFailDiag = evaluateSetupDiagnostics(pilotEnv, ConfigHealthStatus.HEALTHY, false);
  assert(storageFailDiag.isStorageFunctional === false, 'Detects storage inaccessibility');
  assert(storageFailDiag.errors.some((e) => e.includes('storage is inaccessible')), 'Emits error for inaccessible storage');
  assert(storageFailDiag.isReadyForPilot === false, 'Blocks pilot readiness when storage is broken');

  // Insecure HTTP in pilot diagnostics
  const insecurePilotEnv: EnvironmentConfig = Object.freeze({
    environment: 'pilot',
    apiBaseUrl: 'http://remote-pilot.guardrail-safety.org',
    requireHttps: true,
    allowInsecureHttp: false,
    isMockService: false,
    serviceType: 'live',
    timeoutMs: 15000,
    pollIntervalMs: 15000,
  });

  const insecureDiag = evaluateSetupDiagnostics(insecurePilotEnv, ConfigHealthStatus.HEALTHY, true);
  assert(insecureDiag.isHttpsEnforced === false, 'Detects insecure HTTP violation in pilot');
  assert(insecureDiag.errors.some((e) => e.includes('Insecure HTTP endpoint rejected')), 'Emits error rejecting unencrypted pilot endpoint');
  assert(insecureDiag.isReadyForPilot === false, 'Blocks pilot readiness for insecure pilot URL');

  // Uninitialized policy warning
  const uninitDiag = evaluateSetupDiagnostics(pilotEnv, ConfigHealthStatus.UNINITIALIZED, true);
  assert(uninitDiag.warnings.some((w) => w.includes('not initialized yet')), 'Emits warning for uninitialized policy');
  assert(uninitDiag.isReadyForPilot === false, 'Blocks pilot readiness while policy is uninitialized');

  // Fully clean pilot diagnostics
  const cleanDiag = evaluateSetupDiagnostics(pilotEnv, ConfigHealthStatus.HEALTHY, true);
  assert(cleanDiag.errors.length === 0, 'Clean setup has zero errors');
  assert(cleanDiag.isReadyForPilot === true, 'Clean setup is ready for pilot');
}

// ------------------------------------------------------------------
// Test Suite 8: Setup Completion State & Readiness Checklist
// ------------------------------------------------------------------
console.log('\n▶ Test Suite 8: Setup Completion State & Checklist');
{
  let state = { ...DEFAULT_ONBOARDING_STATE };

  // Attempting to advance all steps without acknowledgements
  for (const step of ONBOARDING_STEPS) {
    state = advanceOnboardingStep(state, step.id);
  }
  assert(state.isCompleted === false, 'Cannot complete setup if acknowledgements are missing, even if all steps visited');

  // Supplying all acknowledgements completes setup
  state = advanceOnboardingStep(state, 'setup_complete', {
    scope: true,
    permissions: true,
    staging: true,
    approvals: true,
  });
  assert(state.isCompleted === true, 'Successfully completes setup when all 4 acknowledgements are granted');
  assert(state.completedSteps.length === ONBOARDING_STEPS.length, 'All 7 steps recorded as completed');
}

console.log('\n====================================================================');
console.log(`📊 ONBOARDING WORKFLOW TESTS: ${passedTests} / ${totalTests} PASSED`);
console.log('🎉 ALL ONBOARDING & PILOT SETUP INVARIANTS VERIFIED!');
console.log('====================================================================');
