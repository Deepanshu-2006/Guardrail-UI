/**
 * Guardrail Phishing & Deceptive Website Detection Test Suite
 *
 * Verifies multi-indicator heuristic phishing detection, brand identity consistency,
 * insecure login contexts, cross-origin form exfiltration, and risk engine integration.
 *
 * Requirements Verified:
 * 1. Safe, standards-compliant parsing & structural DOM inspection.
 * 2. Multi-indicator evaluation (never triggers on routine login forms on HTTPS).
 * 3. Zero credential capture invariant (passwords and raw values never extracted).
 * 4. Transparent heuristic disclaimers separating local heuristics from verified intelligence.
 * 5. Full pipeline integration (Classifier -> RiskEngine -> ResponseEngine -> Policy).
 */

import {
  evaluatePhishingIndicators,
  PhishingEvaluationContext,
  PhishingIndicatorCode,
  PHISHING_HEURISTIC_DISCLAIMER,
} from './phishing-detector.js';
import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { classifyAction } from '../classifier/index.js';
import { assessRisk, RiskEngine } from '../risk/engine.js';
import { evaluateActionPipeline } from '../response/index.js';
import { RiskLevel, RiskSignalId } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedTests++;
  }
}

function suite(name: string): void {
  console.log(`\n▶ ${name}`);
}

console.log('======================================================================');
console.log('🧪 GUARDRAIL PHISHING & DECEPTIVE WEBSITE DETECTION TEST SUITE');
console.log('======================================================================');

// ---------------------------------------------------------------------------
// Group 1: Benign Legitimate Portals (Zero False Positives)
// ---------------------------------------------------------------------------
suite('Group 1: Benign Legitimate Portals (Zero False Positives)');

{
  // 1.1 Legitimate PayPal Login
  const paypalCtx: PhishingEvaluationContext = {
    pageUrl: 'https://www.paypal.com/signin',
    pageTitle: 'Log in to your PayPal account',
    hasPasswordField: true,
    hasUsernameField: true,
    formAction: 'https://www.paypal.com/signin/submit',
    isSecureContext: true,
  };
  const paypalResult = evaluatePhishingIndicators(paypalCtx);
  assert(!paypalResult.isPhishingSuspected, 'Legitimate PayPal login is NOT flagged as phishing');
  assert(paypalResult.score === 0, 'Legitimate PayPal login has risk score 0');
  assert(paypalResult.indicators.length === 0, 'Zero indicators triggered for legitimate PayPal login');

  // 1.2 Legitimate Microsoft Online OAuth
  const msCtx: PhishingEvaluationContext = {
    pageUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    pageTitle: 'Sign in to your Microsoft account',
    hasPasswordField: true,
    formAction: 'https://login.microsoftonline.com/kmsi',
    isSecureContext: true,
  };
  const msResult = evaluatePhishingIndicators(msCtx);
  assert(!msResult.isPhishingSuspected, 'Legitimate Microsoft Online OAuth is NOT flagged');
  assert(msResult.score === 0, 'Microsoft Online login has score 0');

  // 1.3 Legitimate Google Sign-in
  const googleCtx: PhishingEvaluationContext = {
    pageUrl: 'https://accounts.google.com/signin/v2/identifier',
    pageTitle: 'Sign in - Google Accounts',
    hasPasswordField: true,
    formAction: 'https://accounts.google.com/signin/challenge',
    isSecureContext: true,
  };
  const googleResult = evaluatePhishingIndicators(googleCtx);
  assert(!googleResult.isPhishingSuspected, 'Legitimate Google Accounts login is NOT flagged');
  assert(googleResult.score === 0, 'Google Accounts login has score 0');

  // 1.4 Legitimate GitHub Login
  const githubCtx: PhishingEvaluationContext = {
    pageUrl: 'https://github.com/login',
    pageTitle: 'Sign in to GitHub · GitHub',
    hasPasswordField: true,
    formAction: 'https://github.com/session',
    isSecureContext: true,
  };
  const githubResult = evaluatePhishingIndicators(githubCtx);
  assert(!githubResult.isPhishingSuspected, 'Legitimate GitHub sign-in is NOT flagged');
  assert(githubResult.score === 0, 'GitHub sign-in has score 0');

  // 1.5 Routine Enterprise SaaS Login Form
  const saasCtx: PhishingEvaluationContext = {
    pageUrl: 'https://app.mycloudcorp.com/login',
    pageTitle: 'Customer Portal Login',
    hasPasswordField: true,
    formAction: 'https://app.mycloudcorp.com/api/auth',
    isSecureContext: true,
  };
  const saasResult = evaluatePhishingIndicators(saasCtx);
  assert(!saasResult.isPhishingSuspected, 'Routine unbranded enterprise login is NOT treated as suspicious');
  assert(saasResult.score === 0, 'Routine enterprise login score is 0');
}

// ---------------------------------------------------------------------------
// Group 2: Website Identity Inconsistencies & Misleading Branding
// ---------------------------------------------------------------------------
suite('Group 2: Website Identity Inconsistencies & Misleading Branding');

{
  // 2.1 PayPal Brand Claim on Unrelated Domain
  const fakePaypalCtx: PhishingEvaluationContext = {
    pageUrl: 'https://paypal-update-account.xyz/security-check',
    pageTitle: 'PayPal: Verify Your Account Information',
    hasPasswordField: true,
    formAction: 'https://paypal-update-account.xyz/save.php',
    isSecureContext: true,
  };
  const fakePaypalResult = evaluatePhishingIndicators(fakePaypalCtx);
  assert(fakePaypalResult.isPhishingSuspected, 'Flags PayPal identity claim on unrelated domain');
  assert(
    fakePaypalResult.indicators.some((i) => i.code === PhishingIndicatorCode.BRAND_IDENTITY_MISMATCH),
    'Emits BRAND_IDENTITY_MISMATCH indicator'
  );
  assert(
    fakePaypalResult.indicators.some((i) => i.code === PhishingIndicatorCode.UNEXPECTED_CREDENTIAL_FIELD),
    'Emits UNEXPECTED_CREDENTIAL_FIELD when password input present on spoofed domain'
  );
  assert(fakePaypalResult.score >= 50, `Score is elevated for brand identity mismatch (${fakePaypalResult.score})`);

  // 2.2 Apple ID Claim on Foreign Domain
  const fakeAppleCtx: PhishingEvaluationContext = {
    pageUrl: 'https://support-appleid-service.org/login',
    pageTitle: 'Sign in with your Apple ID',
    pageMetaBranding: 'Apple ID',
    hasPasswordField: true,
    isSecureContext: true,
  };
  const fakeAppleResult = evaluatePhishingIndicators(fakeAppleCtx);
  assert(fakeAppleResult.isPhishingSuspected, 'Flags Apple ID branding on unrelated domain');
  assert(
    fakeAppleResult.indicators.some((i) => i.code === PhishingIndicatorCode.BRAND_IDENTITY_MISMATCH),
    'Emits BRAND_IDENTITY_MISMATCH for Apple ID claim'
  );

  // 2.3 Deceptive Favicon / CDN Asset Origin
  const fakeAssetCtx: PhishingEvaluationContext = {
    pageUrl: 'https://quick-payment-checkout.net/pay',
    pageTitle: 'Express Checkout',
    faviconUrl: 'https://www.paypalobjects.com/webstatic/icon/favicon.ico',
    isSecureContext: true,
  };
  const fakeAssetResult = evaluatePhishingIndicators(fakeAssetCtx);
  assert(
    fakeAssetResult.indicators.some((i) => i.code === PhishingIndicatorCode.DECEPTIVE_ASSET_ORIGIN),
    'Emits DECEPTIVE_ASSET_ORIGIN when referencing official brand CDN icon from unrelated host'
  );
}

// ---------------------------------------------------------------------------
// Group 3: Insecure Login Context & Transport Downgrade
// ---------------------------------------------------------------------------
suite('Group 3: Insecure Login Context & Transport Downgrade');

{
  // 3.1 Cleartext HTTP Login Page
  const httpLoginCtx: PhishingEvaluationContext = {
    pageUrl: 'http://my-online-banking.org/signin',
    pageTitle: 'Online Banking Sign In',
    hasPasswordField: true,
    isSecureContext: false,
  };
  const httpResult = evaluatePhishingIndicators(httpLoginCtx);
  assert(httpResult.isPhishingSuspected, 'Flags password entry on unencrypted HTTP page');
  assert(
    httpResult.indicators.some((i) => i.code === PhishingIndicatorCode.INSECURE_LOGIN_CONTEXT),
    'Emits INSECURE_LOGIN_CONTEXT indicator for HTTP password form'
  );
  assert(httpResult.score >= 40, 'Insecure login context contributes >= 40 score');

  // 3.2 Insecure Credential Transmission (HTTPS page -> HTTP form action)
  const mixedActionCtx: PhishingEvaluationContext = {
    pageUrl: 'https://secure-portal.com/login',
    hasPasswordField: true,
    formAction: 'http://data-endpoint.org/submit-credentials',
    isSecureContext: true,
  };
  const mixedActionResult = evaluatePhishingIndicators(mixedActionCtx);
  assert(
    mixedActionResult.indicators.some((i) => i.code === PhishingIndicatorCode.INSECURE_CREDENTIAL_TRANSMISSION),
    'Emits INSECURE_CREDENTIAL_TRANSMISSION when form transmits credentials over HTTP'
  );
}

// ---------------------------------------------------------------------------
// Group 4: IP-Hosted Login Portals & Localhost Exemption
// ---------------------------------------------------------------------------
suite('Group 4: IP-Hosted Login Portals & Localhost Exemption');

{
  // 4.1 Public IP Hosting Password Form
  const ipLoginCtx: PhishingEvaluationContext = {
    pageUrl: 'http://198.51.100.42/admin/login',
    hasPasswordField: true,
  };
  const ipResult = evaluatePhishingIndicators(ipLoginCtx);
  assert(ipResult.isPhishingSuspected, 'Flags public IP address hosting password form');
  assert(
    ipResult.indicators.some((i) => i.code === PhishingIndicatorCode.IP_HOSTED_LOGIN),
    'Emits IP_HOSTED_LOGIN indicator for public IP'
  );

  // 4.2 Localhost Development Exemption
  const localhostCtx: PhishingEvaluationContext = {
    pageUrl: 'http://localhost:3000/login',
    pageTitle: 'Local Dev Login',
    hasPasswordField: true,
    formAction: 'http://localhost:3000/api/login',
  };
  const localhostResult = evaluatePhishingIndicators(localhostCtx);
  assert(!localhostResult.isPhishingSuspected, 'Localhost dev login is NOT flagged as phishing');
  assert(localhostResult.score === 0, 'Localhost dev login score is 0');

  // 4.3 127.0.0.1 Loopback Exemption
  const loopbackCtx: PhishingEvaluationContext = {
    pageUrl: 'http://127.0.0.1:8080/auth',
    hasPasswordField: true,
    formAction: 'http://127.0.0.1:8080/login',
  };
  const loopbackResult = evaluatePhishingIndicators(loopbackCtx);
  assert(!loopbackResult.isPhishingSuspected, '127.0.0.1 loopback is NOT flagged as phishing');
  assert(loopbackResult.score === 0, '127.0.0.1 loopback score is 0');
}

// ---------------------------------------------------------------------------
// Group 5: Deceptive Domain Naming & Lookalike Targets
// ---------------------------------------------------------------------------
suite('Group 5: Deceptive Domain Naming & Lookalike Targets');

{
  // 5.1 Deceptive Subdomain Stacking
  const deceptiveNamingCtx: PhishingEvaluationContext = {
    pageUrl: 'https://paypal.com.account-update.xyz/login',
    hasPasswordField: true,
    isSecureContext: true,
  };
  const namingResult = evaluatePhishingIndicators(deceptiveNamingCtx);
  assert(namingResult.isPhishingSuspected, 'Flags deceptive brand subdomain stacking');
  assert(
    namingResult.indicators.some((i) => i.code === PhishingIndicatorCode.DECEPTIVE_HOSTNAME_PATTERN),
    'Emits DECEPTIVE_HOSTNAME_PATTERN for deceptive subdomain'
  );

  // 5.2 Punycode Homoglyph Targeting Brand
  const punycodeCtx: PhishingEvaluationContext = {
    pageUrl: 'https://xn--mcrosoft-1ya.com/login',
    pageTitle: 'Sign in to your Microsoft Account',
    hasPasswordField: true,
    isSecureContext: true,
  };
  const punycodeResult = evaluatePhishingIndicators(punycodeCtx);
  assert(punycodeResult.isPhishingSuspected, 'Flags Punycode lookalike domain with brand claim');
  assert(
    punycodeResult.indicators.some((i) => i.code === PhishingIndicatorCode.DECEPTIVE_HOSTNAME_PATTERN),
    'Emits DECEPTIVE_HOSTNAME_PATTERN for Punycode'
  );
  assert(
    punycodeResult.indicators.some((i) => i.code === PhishingIndicatorCode.BRAND_IDENTITY_MISMATCH),
    'Emits BRAND_IDENTITY_MISMATCH for spoofed Microsoft site'
  );
}

// ---------------------------------------------------------------------------
// Group 6: Suspicious Form Destinations & Data Exfiltration
// ---------------------------------------------------------------------------
suite('Group 6: Suspicious Form Destinations & Data Exfiltration');

{
  // 6.1 Form Action targeting javascript:
  const jsActionCtx: PhishingEvaluationContext = {
    pageUrl: 'https://example-form.com/contact',
    formAction: 'javascript:void(0)',
  };
  const jsActionResult = evaluatePhishingIndicators(jsActionCtx);
  assert(
    jsActionResult.indicators.some((i) => i.code === PhishingIndicatorCode.SUSPICIOUS_FORM_ACTION),
    'Emits SUSPICIOUS_FORM_ACTION for javascript: scheme'
  );

  // 6.2 Form Action targeting Formspree
  const formspreeCtx: PhishingEvaluationContext = {
    pageUrl: 'https://unrelated-site.net/verify',
    hasPasswordField: true,
    formAction: 'https://formspree.io/f/mqkopqqr',
  };
  const formspreeResult = evaluatePhishingIndicators(formspreeCtx);
  assert(formspreeResult.isPhishingSuspected, 'Flags form submission targeting Formspree exfiltration');
  assert(
    formspreeResult.indicators.some((i) => i.code === PhishingIndicatorCode.EXFILTRATION_ENDPOINT),
    'Emits EXFILTRATION_ENDPOINT indicator'
  );

  // 6.3 Form Action targeting Discord Webhook
  const discordCtx: PhishingEvaluationContext = {
    pageUrl: 'https://login-free-gift.com/auth',
    hasPasswordField: true,
    formAction: 'https://discord.com/api/webhooks/123456789/abcdef',
  };
  const discordResult = evaluatePhishingIndicators(discordCtx);
  assert(discordResult.isPhishingSuspected, 'Flags Discord webhook form submission');
  assert(
    discordResult.indicators.some((i) => i.code === PhishingIndicatorCode.EXFILTRATION_ENDPOINT),
    'Emits EXFILTRATION_ENDPOINT indicator for Discord webhook'
  );
}

// ---------------------------------------------------------------------------
// Group 7: Cross-Origin Credential Submission vs Legitimate SSO
// ---------------------------------------------------------------------------
suite('Group 7: Cross-Origin Credential Submission vs Legitimate SSO');

{
  // 7.1 Unexpected Cross-Origin Form Action with Password
  const crossOriginCtx: PhishingEvaluationContext = {
    pageUrl: 'https://company-intranet.com/login',
    hasPasswordField: true,
    formAction: 'https://unrelated-harvester.net/post.php',
    isSecureContext: true,
  };
  const crossOriginResult = evaluatePhishingIndicators(crossOriginCtx);
  assert(crossOriginResult.isPhishingSuspected, 'Flags unexpected cross-origin password submission');
  assert(
    crossOriginResult.indicators.some((i) => i.code === PhishingIndicatorCode.CROSS_ORIGIN_CREDENTIAL_SUBMISSION),
    'Emits CROSS_ORIGIN_CREDENTIAL_SUBMISSION indicator'
  );

  // 7.2 Legitimate Federated SSO Destination (Google Accounts)
  const ssoCtx: PhishingEvaluationContext = {
    pageUrl: 'https://my-cloud-app.com/login',
    hasPasswordField: true,
    formAction: 'https://accounts.google.com/o/oauth2/auth',
    isSecureContext: true,
  };
  const ssoResult = evaluatePhishingIndicators(ssoCtx);
  assert(
    !ssoResult.indicators.some((i) => i.code === PhishingIndicatorCode.CROSS_ORIGIN_CREDENTIAL_SUBMISSION),
    'Legitimate Google SSO is exempted from cross-origin credential warning'
  );

  // 7.3 Configured Enterprise Trusted Domain
  const trustedDomainCtx: PhishingEvaluationContext = {
    pageUrl: 'https://partner-portal.com/login',
    hasPasswordField: true,
    formAction: 'https://auth.company-sso.org/login',
    trustedDomains: ['company-sso.org'],
    isSecureContext: true,
  };
  const trustedResult = evaluatePhishingIndicators(trustedDomainCtx);
  assert(
    !trustedResult.indicators.some((i) => i.code === PhishingIndicatorCode.CROSS_ORIGIN_CREDENTIAL_SUBMISSION),
    'Configured trusted domain is exempted from cross-origin credential warning'
  );
}

// ---------------------------------------------------------------------------
// Group 8: Privacy Invariant & Heuristic Transparency
// ---------------------------------------------------------------------------
suite('Group 8: Privacy Invariant & Heuristic Transparency');

{
  const testCtx: PhishingEvaluationContext = {
    pageUrl: 'https://suspicious-login.xyz/signin',
    pageTitle: 'PayPal: Account Verification',
    hasPasswordField: true,
    formAction: 'https://formsubmit.co/attacker@evil.com',
  };
  const result = evaluatePhishingIndicators(testCtx);

  // Check structured explanations
  assert(result.structuredReasons.length > 0, 'Produces structured reasons array');
  assert(
    result.structuredReasons.every((sr) => typeof sr.code === 'string' && sr.ruleId === 'RISK_RULE_PHISHING_INDICATOR'),
    'Every structured reason has valid code and ruleId'
  );

  // Check disclaimer
  assert(
    result.disclaimer === PHISHING_HEURISTIC_DISCLAIMER,
    'Includes mandatory heuristic disclaimer clarifying scope'
  );

  // Privacy invariant: serialize result and ensure no credential patterns
  const serialized = JSON.stringify(result);
  const sensitivePatterns = [/password\s*[:=]\s*[^,]+/i, /secret/i, /authToken/i, /pin\s*[:=]/i];
  const containsSensitive = sensitivePatterns.some((p) => p.test(serialized));
  assert(!containsSensitive, 'Privacy Invariant: Detection output strictly contains no user credentials');
}

// ---------------------------------------------------------------------------
// Group 9: End-to-End Pipeline & Risk Engine Integration
// ---------------------------------------------------------------------------
suite('Group 9: End-to-End Pipeline & Risk Engine Integration');

{
  // 9.1 Phishing Action Pipeline Evaluation
  const phishingAction: GuardrailAction = {
    id: 'act-phishing-test-01',
    type: ActionType.SUBMIT,
    page: {
      url: 'https://security-verify-paypal.org/update',
      title: 'PayPal: Verification Required',
      isSecureContext: true,
    },
    element: {
      tagName: 'FORM',
      formAction: 'https://formspree.io/f/harvest',
      hasPasswordField: true,
      hasUsernameField: true,
    },
    timestamp: new Date().toISOString(),
  };

  const classification = classifyAction(phishingAction);
  assert(
    classification.category === ActionCategory.AUTHENTICATION,
    `Classifies action with password field as AUTHENTICATION (got: ${classification.category})`
  );

  const riskAssessment = assessRisk(phishingAction, classification);
  assert(
    riskAssessment.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'),
    'Risk engine matches RISK_RULE_PHISHING_INDICATOR'
  );
  assert(
    riskAssessment.score >= 50,
    `Elevates risk score appropriately: ${riskAssessment.score} (>= 50)`
  );
  assert(
    riskAssessment.riskLevel === RiskLevel.HIGH || riskAssessment.riskLevel === RiskLevel.CRITICAL,
    `Evaluates to HIGH or CRITICAL risk level (got: ${riskAssessment.riskLevel})`
  );

  const pipelineResult = evaluateActionPipeline(phishingAction);
  assert(
    pipelineResult.decision.response === ResponseAction.WARN,
    `Pipeline evaluates phishing form to WARN advisory decision (got: ${pipelineResult.decision.response})`
  );
  assert(
    pipelineResult.decision.structuredReasons?.some((sr) => sr.code === 'POLICY_WARN_PHISHING_INDICATOR'),
    'Emits POLICY_WARN_PHISHING_INDICATOR reason code'
  );
  assert(
    pipelineResult.decision.reasons.some((r) => r.includes('Deceptive website advisory')),
    'Decision reasons contain clear deceptive website advisory'
  );

  // 9.2 Benign Action Pipeline Evaluation (No False Positive)
  const benignAction: GuardrailAction = {
    id: 'act-benign-test-01',
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

  const benignRisk = assessRisk(benignAction);
  assert(
    !benignRisk.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'),
    'Legitimate PayPal login action does NOT match RISK_RULE_PHISHING_INDICATOR'
  );
}

// ---------------------------------------------------------------------------
// Group 10: Synthetic HTML & Controlled Local Test Domains
// ---------------------------------------------------------------------------
suite('Group 10: Synthetic HTML & Controlled Local Test Domains');

{
  // 10.1 Multi-Indicator Compound Verdict vs Single Weak Signal
  const weakSignalOnly: PhishingEvaluationContext = {
    pageUrl: 'https://legitimate-blog.com/article',
    pageTitle: 'Interesting Tech Article',
    // Single external link to legitimate site
    targetUrl: 'https://google.com',
    isSecureContext: true,
  };
  const weakResult = evaluatePhishingIndicators(weakSignalOnly);
  assert(
    !weakResult.isPhishingSuspected,
    'Single weak signal (routine external link) does NOT trigger phishing verdict'
  );
  assert(weakResult.score === 0, 'Weak signal score remains 0');

  // 10.2 Compound Indicators Corroboration
  // Insecure HTTP (40) + Form Exfiltration (45) + Deceptive Brand Title (35)
  const compoundCtx: PhishingEvaluationContext = {
    pageUrl: 'http://chase-security-login.xyz/verify',
    pageTitle: 'Chase Bank - Security Sign-In',
    hasPasswordField: true,
    formAction: 'https://formspree.io/f/steal',
    isSecureContext: false,
  };
  const compoundResult = evaluatePhishingIndicators(compoundCtx);
  assert(compoundResult.isPhishingSuspected, 'Compound indicators trigger high-confidence phishing verdict');
  assert(compoundResult.confidence === 'HIGH', 'Confidence is marked HIGH for compound indicators');
  assert(compoundResult.indicators.length >= 3, `Triggered ${compoundResult.indicators.length} corroborated indicators`);
  assert(compoundResult.score >= 75, `Composite score is clamped high: ${compoundResult.score}`);
}

console.log('\n======================================================================');
console.log(`Results: ${passedTests} passed, ${failedTests} failed across all 10 test groups`);
console.log('======================================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 ALL PHISHING & DECEPTIVE WEBSITE DETECTION TESTS PASSED CLEANLY!\n');
}
