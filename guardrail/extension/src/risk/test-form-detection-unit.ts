/**
 * Guardrail UI - Day 28: Form Protection & Destination Validation Test Suite
 *
 * Comprehensive algorithmic and synthetic DOM verification for:
 * 1. Legitimate same-origin forms (HTTPS login, contact forms, search).
 * 2. Forms with missing or unusual submission destinations (empty, hash, javascript:, data:).
 * 3. Cross-origin submissions (unexpected external origins vs legitimate SSO/search/payment).
 * 4. Insecure HTTP destinations (HTTPS downgrade and cleartext credential transport).
 * 5. Deceptive destination domains (exfiltration sinks, raw IP hosts, lookalikes).
 * 6. Dynamic destination changes (runtime attribute tampering, button formaction override).
 * 7. Sensitive input fields (structural detection of password, card, OTP, SSN without values).
 * 8. Misleading descriptions or submission behavior (cancel/back/download labels submitting forms).
 * 9. Undetermined/malformed destination URLs.
 * 10. Strict privacy invariants (zero collection of passwords, card numbers, OTPs, tokens).
 * 11. Detection vs interception architectural separation.
 */

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { assessRisk } from './engine.js';
import { evaluateActionPipeline } from '../response/engine.js';
import { evaluatePolicies } from '../response/policies.js';
import {
  evaluateFormSafety,
  FormSafetyIndicatorCode,
} from '../utils/form-detector.js';
import { extractElementInfo } from '../utils/dom.js';

let passed = 0;
let total = 0;

function assert(condition: boolean, message: string): void {
  total++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  }
  passed++;
  console.log(`  ✓ PASS: ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  total++;
  if (actual !== expected) {
    console.error(`  ❌ FAIL: ${message} (expected "${expected}", got "${actual}")`);
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
  passed++;
  console.log(`  ✓ PASS: ${message} === ${expected}`);
}

// =============================================================================
// Synthetic Privacy Test Sentinels
// =============================================================================
const SENTINELS = {
  PASSWORD: 'syn_pwd_P@ssw0rd999_SuperSecret!',
  OTP: 'syn_otp_928172',
  CARD: 'syn_card_4111222233334444',
  CVV: 'syn_cvv_321',
  TOKEN: 'syn_tok_bearer_auth_token_xyz987',
};

function assertNoSentinelLeakage(target: unknown, context: string): void {
  const serialized = typeof target === 'string' ? target : JSON.stringify(target);
  for (const [name, sentinel] of Object.entries(SENTINELS)) {
    if (serialized.includes(sentinel)) {
      throw new Error(`[PRIVACY VIOLATION] Sentinel ${name} leaked into ${context}!`);
    }
  }
}

// =============================================================================
// Lightweight In-Memory Synthetic DOM Emulation
// =============================================================================
class SyntheticDOMElement {
  public tagName: string;
  public id: string = '';
  public className: string = '';
  public value: string = '';
  public placeholder: string = '';
  public type: string = 'text';
  public href: string = '';
  public action: string = '';
  public method: string = 'GET';
  public name: string = '';
  public textContent: string = '';
  public form: SyntheticDOMElement | null = null;
  public attributes: Map<string, string> = new Map();
  public children: SyntheticDOMElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  setAttribute(name: string, value: string): void {
    const lower = name.toLowerCase();
    this.attributes.set(lower, value);
    if (lower === 'id') this.id = value;
    if (lower === 'class') this.className = value;
    if (lower === 'href') this.href = value;
    if (lower === 'action') this.action = value;
    if (lower === 'method') this.method = value;
    if (lower === 'type') this.type = value;
    if (lower === 'name') this.name = value;
    if (lower === 'value') this.value = value;
    if (lower === 'placeholder') this.placeholder = value;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  appendChild(child: SyntheticDOMElement): void {
    this.children.push(child);
    if (this.tagName === 'FORM') {
      child.form = this;
    }
  }

  closest(selector: string): SyntheticDOMElement | null {
    if (selector.toUpperCase() === 'FORM') {
      return this.form || (this.tagName === 'FORM' ? this : null);
    }
    return null;
  }

  querySelector(selector: string): SyntheticDOMElement | null {
    const tokens = selector.split(',').map((s) => s.trim().toLowerCase());
    for (const child of this.children) {
      for (const tok of tokens) {
        if (tok.includes('input[type="password"]') && child.tagName === 'INPUT' && child.type === 'password') {
          return child;
        }
        if (tok.includes('autocomplete*="username"') && child.getAttribute('autocomplete')?.includes('username')) {
          return child;
        }
        if (tok.includes('name*="user"') && child.name.toLowerCase().includes('user')) {
          return child;
        }
        if (tok.includes('name*="login"') && child.name.toLowerCase().includes('login')) {
          return child;
        }
        if (tok.includes('name*="email"') && child.name.toLowerCase().includes('email')) {
          return child;
        }
        if (tok.includes('input[type="email"]') && child.type === 'email') {
          return child;
        }
        if (tok.includes('input[type="text"]') && child.type === 'text') {
          return child;
        }
        if (tok.includes('autocomplete*="cc-"') && child.getAttribute('autocomplete')?.includes('cc-')) {
          return child;
        }
        if (tok.includes('name*="card"') && child.name.toLowerCase().includes('card')) {
          return child;
        }
        if (tok.includes('name*="cvv"') && child.name.toLowerCase().includes('cvv')) {
          return child;
        }
        if (tok.includes('name*="otp"') && child.name.toLowerCase().includes('otp')) {
          return child;
        }
        if (tok.includes('name*="2fa"') && child.name.toLowerCase().includes('2fa')) {
          return child;
        }
        if (tok.includes('name*="ssn"') && child.name.toLowerCase().includes('ssn')) {
          return child;
        }
        if (tok.includes('name*="tax"') && child.name.toLowerCase().includes('tax')) {
          return child;
        }
      }
    }
    return null;
  }
}

// =============================================================================
// Helper to build synthetic GuardrailAction
// =============================================================================
function createSyntheticSubmitAction(options: {
  pageUrl: string;
  formAction?: string;
  rawAction?: string;
  formMethod?: string;
  hasPassword?: boolean;
  hasSensitive?: boolean;
  sensitiveTypes?: string[];
  initialAction?: string;
  hasOverride?: boolean;
  buttonText?: string;
  category?: ActionCategory;
}): GuardrailAction {
  return {
    id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type: ActionType.SUBMIT,
    category: options.category || ActionCategory.READ_ONLY,
    timestamp: new Date().toISOString(),
    page: {
      url: options.pageUrl,
      title: 'Form Test Page',
      isSecureContext: options.pageUrl.startsWith('https:'),
    },
    element: {
      tagName: 'FORM',
      formAction: options.formAction,
      rawFormAction: options.rawAction,
      formMethod: options.formMethod || 'POST',
      hasPasswordField: options.hasPassword,
      hasSensitiveField: options.hasSensitive,
      sensitiveFieldTypes: options.sensitiveTypes,
      formInitialAction: options.initialAction,
      hasFormActionOverride: options.hasOverride,
      visibleText: options.buttonText,
    },
  };
}

// =============================================================================
// TEST SUITE EXECUTION
// =============================================================================
console.log('\n=== Starting Guardrail Day 28 Form Detection Test Suite ===\n');

// -----------------------------------------------------------------------------
// Test 1: Legitimate Same-Origin Forms (Zero False Positives)
// -----------------------------------------------------------------------------
console.log('--- Test 1: Legitimate Same-Origin Forms ---');
{
  const result = evaluateFormSafety({
    pageUrl: 'https://example.com/login',
    formAction: 'https://example.com/api/login',
    formMethod: 'POST',
    hasPasswordField: true,
    hasUsernameField: true,
  });

  assertEquals(result.isSuspicious, false, 'Legitimate HTTPS same-origin login is not suspicious');
  assertEquals(result.score, 0, 'Legitimate login risk score is 0');
  assertEquals(result.isSameOrigin, true, 'Correctly identifies same-origin');
  assertEquals(result.isCrossOrigin, false, 'Not cross-origin');
  assert(
    result.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_CONTAINS_SENSITIVE_FIELDS),
    'Sensitive fields are noted structurally'
  );

  // Evaluate through Risk Engine
  const action = createSyntheticSubmitAction({
    pageUrl: 'https://example.com/login',
    formAction: 'https://example.com/api/login',
    hasPassword: true,
  });
  const risk = assessRisk(action);
  assertEquals(risk.riskLevel, RiskLevel.LOW, 'Risk level is LOW (score <= 24)');
  assert(
    Boolean(risk.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_AUTHENTICATION')),
    'Matches AUTHENTICATION_ACTION signal'
  );
  assert(
    !risk.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'),
    'Does not match PHISHING_INDICATOR'
  );
}

// -----------------------------------------------------------------------------
// Test 2: Missing or Unusual Submission Destinations
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Missing or Unusual Destinations ---');
{
  // 2a. Missing action attribute on credential form
  const emptyResult = evaluateFormSafety({
    pageUrl: 'https://my-portal.com/login',
    rawActionAttribute: '',
    hasPasswordField: true,
  });
  assertEquals(emptyResult.isSuspicious, true, 'Credential form with empty action is suspicious');
  assertEquals(emptyResult.isMissingDestination, true, 'isMissingDestination is true');
  assert(
    emptyResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_MISSING_DESTINATION),
    'Emits FORM_MISSING_DESTINATION indicator'
  );

  // 2b. Hash-only action (#) on credential form
  const hashResult = evaluateFormSafety({
    pageUrl: 'https://my-portal.com/login',
    rawActionAttribute: '#',
    hasPasswordField: true,
  });
  assertEquals(hashResult.isMissingDestination, true, 'Hash action is identified as missing destination');

  // 2c. Pseudo-protocol javascript: action
  const jsResult = evaluateFormSafety({
    pageUrl: 'https://my-portal.com/account',
    rawActionAttribute: 'javascript:void(0)',
    hasPasswordField: true,
  });
  assertEquals(jsResult.isSuspicious, true, 'javascript: action is flagged as suspicious');
  assert(
    jsResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_UNUSUAL_SCHEME),
    'Emits FORM_UNUSUAL_SCHEME indicator'
  );

  // 2d. Pseudo-protocol data: action
  const dataResult = evaluateFormSafety({
    pageUrl: 'https://my-portal.com/account',
    rawActionAttribute: 'data:text/html,<script>alert(1)</script>',
  });
  assertEquals(dataResult.isSuspicious, true, 'data: action is flagged as suspicious');
  assert(
    dataResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_UNUSUAL_SCHEME),
    'Emits FORM_UNUSUAL_SCHEME indicator for data: URIs'
  );
}

// -----------------------------------------------------------------------------
// Test 3: Unexpected External Origins vs Legitimate Exceptions
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Cross-Origin Form Destinations ---');
{
  // 3a. Unexpected external origin collecting credentials
  const crossResult = evaluateFormSafety({
    pageUrl: 'https://legit-service.com/login',
    formAction: 'https://unverified-third-party.xyz/harvest',
    formMethod: 'POST',
    hasPasswordField: true,
  });
  assertEquals(crossResult.isSuspicious, true, 'Cross-origin credential submission is suspicious');
  assertEquals(crossResult.isCrossOrigin, true, 'Identifies cross-origin correctly');
  assert(
    crossResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_UNEXPECTED_CROSS_ORIGIN),
    'Emits FORM_UNEXPECTED_CROSS_ORIGIN indicator'
  );

  // 3b. Legitimate SSO provider exemption (Google SSO)
  const ssoResult = evaluateFormSafety({
    pageUrl: 'https://my-app.com/login',
    formAction: 'https://accounts.google.com/signin/oauth',
    formMethod: 'POST',
    hasPasswordField: true,
  });
  assertEquals(ssoResult.isSuspicious, false, 'Legitimate Google SSO is exempted');
  assertEquals(ssoResult.score, 0, 'Google SSO score is 0');

  // 3c. Legitimate search engine exemption (benign GET search)
  const searchResult = evaluateFormSafety({
    pageUrl: 'https://blog.example.com',
    formAction: 'https://google.com/search',
    formMethod: 'GET',
    hasPasswordField: false,
  });
  assertEquals(searchResult.isSuspicious, false, 'External search engine GET is exempted');

  // 3d. Legitimate payment gateway exemption (Stripe checkout)
  const paymentResult = evaluateFormSafety({
    pageUrl: 'https://shop.example.com/checkout',
    formAction: 'https://checkout.stripe.com/pay/cs_test_123',
    formMethod: 'POST',
    hasSensitiveField: true,
    sensitiveFieldTypes: ['payment_card'],
  });
  assertEquals(paymentResult.isSuspicious, false, 'Stripe checkout is exempted from unexpected cross-origin');

  // 3e. Same-site subdomain submission (api.example.com from app.example.com)
  const subResult = evaluateFormSafety({
    pageUrl: 'https://app.example.com/settings',
    formAction: 'https://api.example.com/v1/update',
    formMethod: 'POST',
  });
  assertEquals(subResult.isSameSite, true, 'Identifies same registrable domain');
  assertEquals(subResult.isSuspicious, false, 'Same-site subdomain is not treated as unexpected external origin');
}

// -----------------------------------------------------------------------------
// Test 4: Insecure HTTP Destinations
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Insecure Cleartext Transport ---');
{
  // 4a. Mixed-content transport downgrade (HTTPS page submitting to HTTP)
  const downgradeResult = evaluateFormSafety({
    pageUrl: 'https://secure-bank.com/transfer',
    formAction: 'http://secure-bank.com/api/submit',
    formMethod: 'POST',
  });
  assertEquals(downgradeResult.isSuspicious, true, 'HTTPS page submitting to HTTP is suspicious');
  assertEquals(downgradeResult.isInsecureTransport, true, 'isInsecureTransport is true');
  assert(
    downgradeResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_INSECURE_HTTP_DESTINATION),
    'Emits FORM_INSECURE_HTTP_DESTINATION indicator'
  );

  // 4b. Cleartext credential transport
  const cleartextAuthResult = evaluateFormSafety({
    pageUrl: 'http://insecure-forum.com/login',
    formAction: 'http://insecure-forum.com/login.php',
    hasPasswordField: true,
  });
  assertEquals(cleartextAuthResult.isSuspicious, true, 'Cleartext login is flagged as insecure');
  assert(
    cleartextAuthResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_INSECURE_HTTP_DESTINATION),
    'Flags password submission over cleartext HTTP'
  );

  // 4c. Localhost exemption
  const localhostResult = evaluateFormSafety({
    pageUrl: 'http://localhost:3000/login',
    formAction: 'http://localhost:3000/api/login',
    hasPasswordField: true,
  });
  assertEquals(localhostResult.isInsecureTransport, false, 'Localhost is exempt from insecure transport flags');
}

// -----------------------------------------------------------------------------
// Test 5: Deceptive Destinations & Data Exfiltration Sinks
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: Deceptive Destinations & Exfiltration Sinks ---');
{
  // 5a. Formspree exfiltration sink
  const formspreeResult = evaluateFormSafety({
    pageUrl: 'https://innocent-looking-site.com',
    formAction: 'https://formspree.io/f/mqkvrpqw',
    formMethod: 'POST',
  });
  assertEquals(formspreeResult.isSuspicious, true, 'Formspree sink is flagged as suspicious');
  assert(
    formspreeResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_EXFILTRATION_ENDPOINT),
    'Emits FORM_EXFILTRATION_ENDPOINT'
  );
  assertEquals(formspreeResult.score >= 50, true, 'Exfiltration endpoint has high severity score (>= 50)');

  // 5b. Webhook.site exfiltration sink
  const webhookResult = evaluateFormSafety({
    pageUrl: 'https://survey.com',
    formAction: 'https://webhook.site/550e8400-e29b-41d4-a716-446655440000',
    formMethod: 'POST',
  });
  assert(
    webhookResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_EXFILTRATION_ENDPOINT),
    'Flags webhook.site as exfiltration endpoint'
  );

  // 5c. Raw IP address destination
  const ipResult = evaluateFormSafety({
    pageUrl: 'https://legit-corp.com',
    formAction: 'http://203.0.113.195/collect',
    formMethod: 'POST',
  });
  assertEquals(ipResult.isSuspicious, true, 'Raw IP destination is flagged');
  assert(
    ipResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_DECEPTIVE_DESTINATION),
    'Emits FORM_DECEPTIVE_DESTINATION for raw IP hosts'
  );
}

// -----------------------------------------------------------------------------
// Test 6: Unexpected Changes to Form Destinations & Button Overrides
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Dynamic Destination Modifications ---');
{
  // 6a. DOM dynamic action modification from same-origin to external origin
  const modifiedResult = evaluateFormSafety({
    pageUrl: 'https://portal.company.com/login',
    initialFormAction: 'https://portal.company.com/api/login',
    formAction: 'https://malicious-hijack.org/receive',
    formMethod: 'POST',
    hasPasswordField: true,
  });
  assertEquals(modifiedResult.isSuspicious, true, 'Tampered form action is flagged');
  assert(
    modifiedResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_DESTINATION_MODIFIED),
    'Emits FORM_DESTINATION_MODIFIED indicator'
  );

  // 6b. Button formaction override to external origin
  const overrideResult = evaluateFormSafety({
    pageUrl: 'https://portal.company.com/profile',
    initialFormAction: 'https://portal.company.com/save',
    formAction: 'https://external-override.net/post',
    hasFormActionOverride: true,
    hasPasswordField: true,
  });
  assertEquals(overrideResult.isSuspicious, true, 'External formaction button override on password form is flagged');
  assert(
    overrideResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_DESTINATION_MODIFIED),
    'Emits FORM_DESTINATION_MODIFIED for button formaction override'
  );
}

// -----------------------------------------------------------------------------
// Test 7: Sensitive-Input Structural Detection (Without Value Inspection)
// -----------------------------------------------------------------------------
console.log('\n--- Test 7: Sensitive-Input Structural Detection ---');
{
  // Structural input presence without values
  const sensitiveResult = evaluateFormSafety({
    pageUrl: 'https://bank.com/apply',
    formAction: 'https://bank.com/apply',
    hasSensitiveField: true,
    sensitiveFieldTypes: ['payment_card', 'ssn'],
  });
  assertEquals(sensitiveResult.isSuspicious, false, 'Same-origin sensitive form is not suspicious by itself');
  assert(
    sensitiveResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_CONTAINS_SENSITIVE_FIELDS),
    'Identifies sensitive field types structurally'
  );

  // Risk engine test: verifies payment rule triggers correctly on payment_card
  const payAction = createSyntheticSubmitAction({
    pageUrl: 'https://bank.com/apply',
    formAction: 'https://bank.com/apply',
    hasSensitive: true,
    sensitiveTypes: ['payment_card'],
  });
  const payRisk = assessRisk(payAction);
  assert(
    Boolean(payRisk.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PAYMENT')),
    'Sensitive payment_card input triggers RISK_RULE_PAYMENT'
  );
}

// -----------------------------------------------------------------------------
// Test 8: Misleading Descriptions or Submission Behavior
// -----------------------------------------------------------------------------
console.log('\n--- Test 8: Misleading Descriptions & Behavior ---');
{
  // Submit button labeled "Cancel" submitting sensitive credentials
  const cancelResult = evaluateFormSafety({
    pageUrl: 'https://example.com/survey',
    formAction: 'https://example.com/submit',
    formMethod: 'POST',
    hasPasswordField: true,
    submitButtonText: 'Cancel and Return',
  });
  assertEquals(cancelResult.isSuspicious, true, 'Misleading "Cancel" submit button on sensitive form is flagged');
  assert(
    cancelResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_MISLEADING_SUBMISSION),
    'Emits FORM_MISLEADING_SUBMISSION'
  );

  // Submit button labeled "Download Receipt" posting data
  const downloadResult = evaluateFormSafety({
    pageUrl: 'https://invoice-view.com',
    formAction: 'https://invoice-view.com/data',
    formMethod: 'POST',
    submitButtonText: 'Download Invoice',
  });
  assertEquals(downloadResult.isSuspicious, true, 'Misleading "Download Invoice" label on POST form is flagged');
}

// -----------------------------------------------------------------------------
// Test 9: Undetermined / Malformed Destinations
// -----------------------------------------------------------------------------
console.log('\n--- Test 9: Malformed Destinations ---');
{
  const malformedResult = evaluateFormSafety({
    pageUrl: 'https://example.com/page',
    formAction: 'http://[::invalid-ipv6-address',
  });
  assertEquals(malformedResult.isDestinationUndetermined, true, 'Identifies undetermined destination');
  assert(
    malformedResult.indicators.some((i) => i.code === FormSafetyIndicatorCode.FORM_UNDETERMINED_DESTINATION),
    'Emits FORM_UNDETERMINED_DESTINATION indicator'
  );
}

// -----------------------------------------------------------------------------
// Test 10: Synthetic DOM Element Extraction & Privacy Integrity
// -----------------------------------------------------------------------------
console.log('\n--- Test 10: Synthetic DOM Extraction & Strict Privacy Audit ---');
{
  // Construct a synthetic DOM form with populated values and sentinels
  const form = new SyntheticDOMElement('form');
  form.setAttribute('action', 'https://example.com/api/login');
  form.setAttribute('method', 'POST');

  const usernameInput = new SyntheticDOMElement('input');
  usernameInput.setAttribute('type', 'text');
  usernameInput.setAttribute('name', 'username');
  usernameInput.setAttribute('value', 'john_doe@example.com');
  usernameInput.setAttribute('placeholder', 'Enter email or username');
  form.appendChild(usernameInput);

  const pwdInput = new SyntheticDOMElement('input');
  pwdInput.setAttribute('type', 'password');
  pwdInput.setAttribute('name', 'password');
  pwdInput.setAttribute('value', SENTINELS.PASSWORD);
  form.appendChild(pwdInput);

  const otpInput = new SyntheticDOMElement('input');
  otpInput.setAttribute('type', 'text');
  otpInput.setAttribute('name', 'otp_code');
  otpInput.setAttribute('value', SENTINELS.OTP);
  form.appendChild(otpInput);

  const cardInput = new SyntheticDOMElement('input');
  cardInput.setAttribute('type', 'text');
  cardInput.setAttribute('name', 'credit_card_num');
  cardInput.setAttribute('value', SENTINELS.CARD);
  form.appendChild(cardInput);

  const submitBtn = new SyntheticDOMElement('button');
  submitBtn.setAttribute('type', 'submit');
  submitBtn.textContent = 'Submit Login';
  form.appendChild(submitBtn);

  // Extract ActionElementInfo from the submit button
  const elementInfo = extractElementInfo(submitBtn as any);

  assertEquals(elementInfo.formAction, 'https://example.com/api/login', 'Extracted form action correctly');
  assertEquals(elementInfo.formMethod, 'POST', 'Extracted form method correctly');
  assertEquals(elementInfo.hasPasswordField, true, 'hasPasswordField is true');
  assertEquals(elementInfo.hasUsernameField, true, 'hasUsernameField is true');
  assertEquals(elementInfo.hasSensitiveField, true, 'hasSensitiveField is true');
  assert(
    elementInfo.sensitiveFieldTypes?.includes('password') === true,
    'sensitiveFieldTypes contains password'
  );
  assert(
    elementInfo.sensitiveFieldTypes?.includes('payment_card') === true,
    'sensitiveFieldTypes contains payment_card'
  );
  assert(
    elementInfo.sensitiveFieldTypes?.includes('otp') === true,
    'sensitiveFieldTypes contains otp'
  );

  // Verify STRICT ZERO-LEAKAGE PRIVACY INVARIANT
  assertNoSentinelLeakage(elementInfo, 'extractElementInfo result');

  // Verify that the action built from this element leaks nothing
  const action: GuardrailAction = {
    id: 'test_audit_action_1',
    type: ActionType.SUBMIT,
    category: ActionCategory.AUTHENTICATION,
    timestamp: new Date().toISOString(),
    page: {
      url: 'https://example.com/login',
      title: 'Login Page',
      isSecureContext: true,
    },
    element: elementInfo,
  };
  assertNoSentinelLeakage(action, 'GuardrailAction model');

  // Run through full pipeline
  const risk = assessRisk(action);
  assertNoSentinelLeakage(risk, 'RiskAssessment output');

  const pipelineResult = evaluateActionPipeline(action);
  assertNoSentinelLeakage(pipelineResult, 'Pipeline evaluation result');
  console.log('  ✓ PASS: Zero password, OTP, or credit card sentinels leaked in any data structure');
}

// -----------------------------------------------------------------------------
// Test 11: End-to-End Policy Integration & Interception Clarification
// -----------------------------------------------------------------------------
console.log('\n--- Test 11: End-to-End Policy & Interception Semantics ---');
{
  // 11a. Routine benign form submission -> ALLOW
  const routineAction = createSyntheticSubmitAction({
    pageUrl: 'https://news.example.com/contact',
    formAction: 'https://news.example.com/contact/send',
    formMethod: 'POST',
  });
  const routineRisk = assessRisk(routineAction);
  assertEquals(routineRisk.riskLevel, RiskLevel.LOW, 'Benign contact form risk is LOW');
  const routinePolicy = evaluateActionPipeline(routineAction);
  assertEquals(routinePolicy.decision.response, ResponseAction.ALLOW, 'Benign form evaluates to ALLOW');
  const directPolicyResults = evaluatePolicies(routineAction, routineRisk);
  const directPolicyEval = directPolicyResults[0];
  assertEquals(directPolicyEval.decision, ResponseAction.ALLOW, 'Direct policy evaluation is ALLOW');
  assertEquals(directPolicyEval.reasonCode, 'POLICY_ALLOW_ROUTINE', 'Handled by ROUTINE_INTERACTION policy');

  // 11b. Cross-origin credential theft form -> Elevated warning & advisory
  const exfilAction = createSyntheticSubmitAction({
    pageUrl: 'https://legit-site.com/login',
    formAction: 'https://formspree.io/f/mqkvrpqw',
    formMethod: 'POST',
    hasPassword: true,
  });
  const exfilRisk = assessRisk(exfilAction);
  assertEquals(exfilRisk.riskLevel === RiskLevel.HIGH || exfilRisk.riskLevel === RiskLevel.CRITICAL, true, 'Exfiltration risk is HIGH or CRITICAL');
  const exfilPolicyResults = evaluatePolicies(exfilAction, exfilRisk);
  const exfilPolicyEval = exfilPolicyResults[0];
  assertEquals(exfilPolicyEval.decision, ResponseAction.WARN, 'Exfiltration form produces advisory warning');
  assertEquals(exfilPolicyEval.reasonCode, 'POLICY_WARN_PHISHING_INDICATOR', 'Policy decision cites deceptive indicator');

  // 11c. Verify architectural invariant: detection is not equivalent to interception
  // Form detection identifies risk and structured reasons; it does NOT claim universal
  // submission cancellation unless supported by capturing-phase event listener.
  assert(
    typeof directPolicyEval.downstreamBehavior === 'string',
    'Downstream behavior is explicitly documented'
  );
}

// =============================================================================
// SUMMARY
// =============================================================================
console.log(`\n======================================================`);
console.log(`Form Detection Test Suite Complete: ${passed}/${total} assertions passed`);
console.log(`======================================================\n`);
