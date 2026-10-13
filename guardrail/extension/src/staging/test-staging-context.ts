/**
 * Guardrail Staging Mode - Action Context Test Suite
 *
 * Verifies the StagingActionContext data model and creation engine:
 * 1. Valid Context Creation with Complete Pipeline Metadata.
 * 2. Safe Handling of Missing or Malformed Optional Metadata.
 * 3. Privacy Preservation & Exclusion of Sensitive Data (Credentials, Tokens, Form Payloads).
 * 4. Safe URL Origin & Hostname Extraction.
 * 5. Safe Action Description Synthesis across Action Types and Categories.
 * 6. Immutability & Deep Freezing.
 * 7. Type Guard and Validation Utilities.
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { ActionClassificationResult } from '../types/classification.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';
import { RiskAssessment, RiskLevel } from '../types/risk.js';
import { StagingActionContext } from '../types/staging.js';
import {
  createStagingActionContext,
  extractSafeOriginAndHost,
  generateSafeActionDescription,
  isStagingActionContext,
  validateStagingActionContext,
} from './context.js';

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

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    console.log(`  ✓ ${message}: ${String(actual)}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}. Expected "${String(expected)}", received "${String(actual)}"`);
    failed++;
  }
}

console.log('\n============================================================');
console.log('🧪 GUARDRAIL STAGING MODE: ACTION CONTEXT TEST SUITE');
console.log('============================================================\n');

// -----------------------------------------------------------------------------
// Test Helpers & Mock Fixtures
// -----------------------------------------------------------------------------
function createMockAction(overrides: Partial<GuardrailAction> = {}): GuardrailAction {
  return {
    id: 'act-stage-test-12345',
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: {
      tagName: 'BUTTON',
      id: 'btn-delete-all',
      visibleText: 'Delete All Account Data',
      className: 'btn btn-danger',
    },
    page: {
      url: 'https://app.example.com/settings/profile?tab=danger-zone',
      title: 'Account Settings - Danger Zone',
    },
    timestamp: '2026-10-13T10:00:00.000Z',
    ...overrides,
  };
}

function createMockInterception(overrides: Partial<InterceptionRecord> = {}): InterceptionRecord {
  return {
    actionId: 'act-stage-test-12345',
    state: InterceptionState.HELD,
    createdAt: '2026-10-13T10:00:00.100Z',
    reason: 'Critical destructive action halted pending protection decision.',
    ...overrides,
  };
}

function createMockRisk(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    actionId: 'act-stage-test-12345',
    score: 100,
    riskLevel: RiskLevel.CRITICAL,
    reasons: [
      'Target element is a destructive delete action',
      'Action triggers irreversible data purge',
    ],
    evaluatedAt: '2026-10-13T10:00:00.050Z',
    ...overrides,
  };
}

function createMockClassification(overrides: Partial<ActionClassificationResult> = {}): ActionClassificationResult {
  return {
    actionId: 'act-stage-test-12345',
    category: ActionCategory.DESTRUCTIVE,
    matchedRule: 'DESTRUCTIVE_DELETE_BUTTON',
    classifiedAt: '2026-10-13T10:00:00.020Z',
    reason: 'Matched keyword "delete all" in button label',
    confidence: 1.0,
    ...overrides,
  };
}

function createMockDecision(overrides: Partial<ResponseDecision> = {}): ResponseDecision {
  return {
    actionId: 'act-stage-test-12345',
    response: ResponseAction.PROTECT,
    reasons: ['CRITICAL risk level requires protective gating under default policy'],
    createdAt: '2026-10-13T10:00:00.080Z',
    ...overrides,
  };
}

// =============================================================================
// TEST 1: VALID CONTEXT CREATION WITH COMPLETE PIPELINE METADATA
// =============================================================================
console.log('▶ Test 1: Valid Context Creation with Complete Pipeline Metadata');
{
  const action = createMockAction();
  const interception = createMockInterception();
  const risk = createMockRisk();
  const classification = createMockClassification();
  const decision = createMockDecision();

  const context = createStagingActionContext({
    action,
    interception,
    risk,
    classification,
    decision,
  });

  // Verify identifier stability
  assertEquals(context.actionId, action.id, 'Preserves exact actionId');
  assertEquals(context.actionId, interception.actionId, 'actionId matches InterceptionRecord');

  // Verify safe description
  assertEquals(
    context.description,
    'Destructive operation: Click on "Delete All Account Data"',
    'Synthesizes safe, informative description'
  );

  // Verify category & types
  assertEquals(context.actionType, ActionType.CLICK, 'ActionType is CLICK');
  assertEquals(context.category, ActionCategory.DESTRUCTIVE, 'Category is DESTRUCTIVE');

  // Verify pre-computed risk data
  assertEquals(context.riskLevel, RiskLevel.CRITICAL, 'riskLevel matches pre-computed assessment');
  assertEquals(context.riskScore, 100, 'riskScore matches pre-computed assessment');
  assertEquals(context.riskReasons.length, 2, 'riskReasons preserved from assessment');
  assertEquals(context.riskReasons[0], 'Target element is a destructive delete action', 'First risk reason matches');

  // Verify operational governance
  assertEquals(context.responseAction, ResponseAction.PROTECT, 'responseAction is PROTECT');
  assertEquals(context.interceptionState, InterceptionState.HELD, 'interceptionState is HELD');
  assertEquals(
    context.interceptionReason,
    'Critical destructive action halted pending protection decision.',
    'interceptionReason matches record'
  );

  // Verify safe origin & hostname (path & query string stripped!)
  assertEquals(context.origin, 'https://app.example.com', 'origin strips path and query parameters');
  assertEquals(context.hostname, 'app.example.com', 'hostname extracted cleanly');
  assertEquals(context.pageTitle, 'Account Settings - Danger Zone', 'pageTitle is preserved');

  // Verify timestamps
  assertEquals(context.timestamp, action.timestamp, 'timestamp matches action timestamp');
  assert(Boolean(context.stagedAt), 'stagedAt timestamp generated');

  // Verify immutability
  assert(Object.isFrozen(context), 'StagingActionContext object is frozen');
  assert(Object.isFrozen(context.riskReasons), 'riskReasons array is frozen');
}

// =============================================================================
// TEST 2: HANDLING MISSING OPTIONAL METADATA SAFELY
// =============================================================================
console.log('\n▶ Test 2: Handling Missing Optional Metadata Safely');
{
  // Subtest 2A: No element metadata (e.g. Navigation action)
  const navAction = createMockAction({
    id: 'act-nav-99',
    type: ActionType.NAVIGATION,
    category: ActionCategory.GENERAL,
    element: undefined,
    page: { url: 'https://docs.service.internal/guide', title: 'Internal Guide' },
  });
  const navInterception = createMockInterception({ actionId: 'act-nav-99' });
  const navRisk = createMockRisk({ actionId: 'act-nav-99', score: 10, riskLevel: RiskLevel.LOW, reasons: [] });

  const navContext = createStagingActionContext({
    action: navAction,
    interception: navInterception,
    risk: navRisk,
  });

  assertEquals(navContext.actionId, 'act-nav-99', 'Navigation context created with correct actionId');
  assertEquals(navContext.actionType, ActionType.NAVIGATION, 'actionType is NAVIGATION');
  assertEquals(navContext.description, 'Page navigation to docs.service.internal', 'Safe navigation description');
  assertEquals(navContext.origin, 'https://docs.service.internal', 'Navigation origin resolved');
  assertEquals(navContext.hostname, 'docs.service.internal', 'Navigation hostname resolved');
  assertEquals(navContext.riskReasons.length, 0, 'Empty riskReasons array handled safely');

  // Subtest 2B: Element without visibleText, but with ID
  const idOnlyAction = createMockAction({
    category: ActionCategory.GENERAL,
    element: { tagName: 'BUTTON', id: 'confirm-order-btn' },
  });
  const idOnlyDesc = generateSafeActionDescription(idOnlyAction);
  assertEquals(idOnlyDesc, 'Click on #confirm-order-btn', 'Element with ID only uses #id in description');

  // Subtest 2C: Element with tagName only (no visibleText, no ID)
  const tagOnlyAction = createMockAction({
    element: { tagName: 'BUTTON' },
    category: ActionCategory.GENERAL,
  });
  const tagOnlyDesc = generateSafeActionDescription(tagOnlyAction);
  assertEquals(tagOnlyDesc, 'Click on <button>', 'Element with tagName only uses <tag> in description');

  // Subtest 2D: Missing classification and response decision
  const minimalContext = createStagingActionContext({
    action: createMockAction({ category: undefined }),
    interception: createMockInterception(),
    risk: createMockRisk(),
  });
  assertEquals(minimalContext.category, undefined, 'Category is safely undefined when omitted');
  assertEquals(minimalContext.responseAction, ResponseAction.PROTECT, 'responseAction defaults safely when omitted');

  // Subtest 2E: Excessive label length truncation
  const longTextAction = createMockAction({
    element: {
      tagName: 'BUTTON',
      visibleText: 'This is an extremely long label that exceeds the allowable length threshold for clean UI rendering and needs truncation',
    },
  });
  const longTextDesc = generateSafeActionDescription(longTextAction);
  assert(longTextDesc.includes('...'), 'Long element label is truncated with ellipsis');
  assert(longTextDesc.length < 130, 'Truncated description remains within safe length');
}

// =============================================================================
// TEST 3: PRIVACY PRESERVATION & EXCLUSION OF SENSITIVE DATA
// =============================================================================
console.log('\n▶ Test 3: Privacy Preservation & Exclusion of Sensitive Data');
{
  // Test 3A: URL containing credentials, secret query params, and hash
  const dirtyUrl = 'https://alice:supersecretpass@vault.company.com:9443/transfer/funds?token=jwt_xyz_998877&card=4111222233334444&cvv=123&otp=889900#oauth_secret=shhh';
  const privacyAction = createMockAction({
    page: { url: dirtyUrl, title: 'Sensitive Portal' },
  });
  const privacyContext = createStagingActionContext({
    action: privacyAction,
    interception: createMockInterception(),
    risk: createMockRisk(),
  });

  // Verify sanitized origin & hostname
  assertEquals(privacyContext.origin, 'https://vault.company.com:9443', 'Origin strips credentials, query parameters, and fragments');
  assertEquals(privacyContext.hostname, 'vault.company.com', 'Hostname strips credentials, port, and query parameters');

  // Serialized context must NOT contain any of the sensitive tokens
  const serialized = JSON.stringify(privacyContext);
  assert(!serialized.includes('supersecretpass'), 'Serialized context does not contain embedded password');
  assert(!serialized.includes('jwt_xyz_998877'), 'Serialized context does not contain session token');
  assert(!serialized.includes('4111222233334444'), 'Serialized context does not contain credit card number');
  assert(!serialized.includes('cvv'), 'Serialized context does not contain cvv');
  assert(!serialized.includes('889900'), 'Serialized context does not contain OTP');
  assert(!serialized.includes('oauth_secret'), 'Serialized context does not contain fragment secret');

  // Test 3B: Verify forbidden properties are not present on context object
  const forbiddenKeys = [
    'password', 'pass', 'pwd',
    'card', 'cvv', 'cvc',
    'otp', 'pin', 'secret',
    'token', 'cookie', 'auth',
    'value', 'inputValue', 'formContent',
    'elementNode', 'nodeRef'
  ];

  const parsedContext = JSON.parse(serialized);
  for (const forbidden of forbiddenKeys) {
    assert(!(forbidden in parsedContext), `Context does NOT contain forbidden property "${forbidden}"`);
  }

  // Test 3C: Input action does not capture user-typed values
  const inputAction: GuardrailAction = {
    id: 'act-input-priv',
    type: ActionType.INPUT,
    element: { tagName: 'INPUT', id: 'user-pin' },
    page: { url: 'https://example.com/login', title: 'Login' },
    timestamp: '2026-10-13T10:00:00Z',
  };
  const inputClassification = createMockClassification({
    actionId: 'act-input-priv',
    category: ActionCategory.AUTHENTICATION,
  });
  const inputDesc = generateSafeActionDescription(inputAction, inputClassification);
  assertEquals(inputDesc, 'Authentication field interaction (#user-pin)', 'Input action description contains no typed values');
}

// =============================================================================
// TEST 4: SAFE URL ORIGIN & HOSTNAME EXTRACTION
// =============================================================================
console.log('\n▶ Test 4: Safe URL Origin & Hostname Extraction');
{
  // Standard HTTPS
  const res1 = extractSafeOriginAndHost('https://github.com/google/guardrail?q=test');
  assertEquals(res1.origin, 'https://github.com', 'Standard HTTPS origin');
  assertEquals(res1.hostname, 'github.com', 'Standard HTTPS hostname');

  // Standard HTTP with custom port
  const res2 = extractSafeOriginAndHost('http://localhost:3000/demo/page');
  assertEquals(res2.origin, 'http://localhost:3000', 'HTTP with port origin');
  assertEquals(res2.hostname, 'localhost', 'HTTP with port hostname');

  // Extension scheme
  const res3 = extractSafeOriginAndHost('chrome-extension://abcdefghijklmnop/popup.html');
  assertEquals(res3.origin, 'chrome-extension://abcdefghijklmnop', 'Extension scheme origin');
  assertEquals(res3.hostname, 'abcdefghijklmnop', 'Extension scheme hostname');

  // Edge cases: about:blank, empty string, malformed strings
  const res4 = extractSafeOriginAndHost('about:blank');
  assertEquals(res4.origin, undefined, 'about:blank returns undefined origin');
  assertEquals(res4.hostname, undefined, 'about:blank returns undefined hostname');

  const res5 = extractSafeOriginAndHost('');
  assertEquals(res5.origin, undefined, 'Empty string returns undefined origin');

  const res6 = extractSafeOriginAndHost(undefined);
  assertEquals(res6.origin, undefined, 'undefined URL returns undefined origin');

  const res7 = extractSafeOriginAndHost('not-a-valid-url');
  assertEquals(res7.origin, undefined, 'Malformed URL does not throw and returns undefined');

  const res8 = extractSafeOriginAndHost('javascript:alert(1)');
  assertEquals(res8.origin, undefined, 'javascript: URI returns undefined origin');
}

// =============================================================================
// TEST 5: SAFE ACTION DESCRIPTION SYNTHESIS ACROSS TYPES & CATEGORIES
// =============================================================================
console.log('\n▶ Test 5: Safe Action Description Synthesis Across Types & Categories');
{
  // CLICK + PAYMENT
  const payClick = createMockAction({
    category: ActionCategory.PAYMENT,
    element: { tagName: 'BUTTON', visibleText: 'Pay ₹5,000' },
  });
  assertEquals(
    generateSafeActionDescription(payClick),
    'Payment trigger: Click on "Pay ₹5,000"',
    'CLICK + PAYMENT description'
  );

  // CLICK + AUTHENTICATION
  const authClick = createMockAction({
    category: ActionCategory.AUTHENTICATION,
    element: { tagName: 'BUTTON', visibleText: 'Sign In' },
  });
  assertEquals(
    generateSafeActionDescription(authClick),
    'Authentication trigger: Click on "Sign In"',
    'CLICK + AUTHENTICATION description'
  );

  // CLICK + DOWNLOAD
  const dlClick = createMockAction({
    category: ActionCategory.DOWNLOAD,
    element: { tagName: 'A', visibleText: 'Download Backup' },
  });
  assertEquals(
    generateSafeActionDescription(dlClick),
    'Download trigger: Click on "Download Backup"',
    'CLICK + DOWNLOAD description'
  );

  // CLICK + EXTERNAL_NAVIGATION
  const extClick = createMockAction({
    category: ActionCategory.EXTERNAL_NAVIGATION,
    element: { tagName: 'A', visibleText: 'External Partner Portal' },
  });
  assertEquals(
    generateSafeActionDescription(extClick),
    'External navigation trigger: Click on "External Partner Portal"',
    'CLICK + EXTERNAL_NAVIGATION description'
  );

  // SUBMIT + PAYMENT
  const submitAction = createMockAction({
    type: ActionType.SUBMIT,
    category: ActionCategory.PAYMENT,
    element: { tagName: 'FORM', id: 'checkout-form' },
  });
  assertEquals(
    generateSafeActionDescription(submitAction),
    'Form submission (Payment & Billing) via #checkout-form',
    'SUBMIT + PAYMENT description'
  );

  // INPUT + GENERAL
  const inputAction = createMockAction({
    type: ActionType.INPUT,
    category: ActionCategory.GENERAL,
    element: { tagName: 'TEXTAREA', id: 'notes-area' },
  });
  assertEquals(
    generateSafeActionDescription(inputAction),
    'Form input field interaction (#notes-area)',
    'INPUT + GENERAL description'
  );
}

// =============================================================================
// TEST 6: TYPE GUARD AND VALIDATOR UTILITIES
// =============================================================================
console.log('\n▶ Test 6: Type Guard and Validator Utilities');
{
  const validContext = createStagingActionContext({
    action: createMockAction(),
    interception: createMockInterception(),
    risk: createMockRisk(),
  });

  // isStagingActionContext
  assert(isStagingActionContext(validContext), 'Valid context recognized by isStagingActionContext');
  assert(!isStagingActionContext(null), 'null rejected by isStagingActionContext');
  assert(!isStagingActionContext({}), 'empty object rejected by isStagingActionContext');
  assert(!isStagingActionContext({ ...validContext, actionId: '' }), 'Empty actionId rejected');
  assert(!isStagingActionContext({ ...validContext, riskLevel: 'EXTREME' }), 'Invalid riskLevel rejected');

  // validateStagingActionContext
  const validReport = validateStagingActionContext(validContext);
  assertEquals(validReport.valid, true, 'Valid context passes validation report');
  assertEquals(validReport.errors.length, 0, 'No validation errors on valid context');

  // Injected invalid properties
  const invalidContext = {
    ...validContext,
    riskScore: 250, // out of bounds
    password: 'leaked_value', // forbidden privacy keyword
  } as unknown as StagingActionContext;

  const invalidReport = validateStagingActionContext(invalidContext);
  assertEquals(invalidReport.valid, false, 'Invalid context fails validation report');
  assert(
    invalidReport.errors.some((e) => e.includes('riskScore out of bounds')),
    'Identified riskScore bounds error'
  );
  assert(
    invalidReport.errors.some((e) => e.includes('Privacy violation')),
    'Identified privacy violation error'
  );
}

// =============================================================================
// TEST 7: ERROR HANDLING ON MISSING CORE PARAMETERS
// =============================================================================
console.log('\n▶ Test 7: Error Handling on Missing Core Parameters');
{
  let errorCaughtAction = false;
  try {
    createStagingActionContext({
      action: null as any,
      interception: createMockInterception(),
      risk: createMockRisk(),
    });
  } catch (err: any) {
    errorCaughtAction = true;
    assert(Boolean(err.message.includes('valid GuardrailAction')), 'Throws when action is missing');
  }
  assert(errorCaughtAction, 'Missing action throws error');

  let errorCaughtInterception = false;
  try {
    createStagingActionContext({
      action: createMockAction(),
      interception: null as any,
      risk: createMockRisk(),
    });
  } catch (err: any) {
    errorCaughtInterception = true;
    assert(Boolean(err.message.includes('InterceptionRecord')), 'Throws when interception is missing');
  }
  assert(errorCaughtInterception, 'Missing interception throws error');

  let errorCaughtRisk = false;
  try {
    createStagingActionContext({
      action: createMockAction(),
      interception: createMockInterception(),
      risk: null as any,
    });
  } catch (err: any) {
    errorCaughtRisk = true;
    assert(Boolean(err.message.includes('RiskAssessment')), 'Throws when risk is missing');
  }
  assert(errorCaughtRisk, 'Missing risk throws error');
}

console.log('\n============================================================');
console.log(`TOTAL STAGING CONTEXT TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
