/**
 * Guardrail UI - Day 27: Website Protection Unit Test Suite
 *
 * TIER 1: UNIT TESTS (Pure In-Memory Algorithmic Verification)
 *
 * Verifies core website detection engine, URL normalization, heuristic scoring,
 * decision contracts, and boundary rules without DOM, network, or browser processes:
 * 1. Normal legitimate website URLs & false-positive resilience.
 * 2. Malformed URLs and boundary error recovery.
 * 3. Suspicious hostname patterns (public IP, hyphen stuffing, stacked subdomains, non-standard ports).
 * 4. Lookalike domain examples (deceptive subdomains, punycode/homoglyphs).
 * 5. Synthetic phishing-style login heuristics (brand identity mismatch, credential harvesting).
 * 6. Unexpected form destinations (exfiltration webhooks, insecure transport).
 * 7. Cross-origin form heuristics (password submission across origins).
 * 8. Navigation state & previousUrl tracking transitions.
 * 9. Detection failure handling (fail-closed, truthful failure reporting).
 * 10. Privacy & data sanitization invariants (zero password/card leakage in models).
 */

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { ActionClassificationResult } from '../types/classification.js';
import { RiskLevel, RiskSignalId } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { assessRisk, RiskEngine } from './engine.js';
import { INITIAL_RISK_SIGNALS } from './signals.js';
import { evaluateActionPipeline } from '../response/engine.js';
import {
  evaluateSuspiciousUrl,
  normalizeUrlComponents,
  SuspiciousUrlIndicatorCode,
  isIpv4Address,
  isIpv6Address,
  isLocalhostAddress,
} from '../utils/url-detector.js';
import {
  evaluatePhishingIndicators,
  PhishingIndicatorCode,
} from '../utils/phishing-detector.js';
import { sanitizeUrlForDiagnostics, sanitizeForDiagnostics } from '../utils/privacy.js';

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

console.log('======================================================================');
console.log('Day 27 Tier 1: Website Protection Unit Test Suite');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// Scenario 1: Normal Legitimate Website URLs
// -----------------------------------------------------------------------------
console.log('▶ Scenario 1: Normal Legitimate Website URLs');
{
  const legitUrls = [
    'https://github.com/login',
    'https://accounts.google.com/signin',
    'https://appleid.apple.com/auth/authorize',
    'https://www.paypal.com/signin',
    'http://localhost:8899/index.html',
    'http://127.0.0.1:8899/synthetic-legitimate.html',
  ];

  for (const url of legitUrls) {
    const res = evaluateSuspiciousUrl(url);
    assert(!res.isSuspicious, `Legitimate URL is not flagged as suspicious: ${url}`);
    assertEquals(res.score, 0, `Risk score is 0 for legitimate URL: ${url}`);
  }

  // Authentic brand on authentic domain is NOT flagged as phishing
  const authenticGoogle = evaluatePhishingIndicators({
    pageUrl: 'https://accounts.google.com/signin',
    pageTitle: 'Google Workspace - Sign in - Google Accounts',
    pageMetaBranding: 'Google Workspace',
    isSecureContext: true,
    hasPasswordField: true,
  });
  assert(!authenticGoogle.isPhishingSuspected, 'Authentic Google Accounts is not flagged as phishing');
  assertEquals(authenticGoogle.score, 0, 'Phishing score is 0 on authentic portal');
}

// -----------------------------------------------------------------------------
// Scenario 2: Malformed URLs
// -----------------------------------------------------------------------------
console.log('\n▶ Scenario 2: Malformed URLs');
{
  const malformedUrls = [
    'http://',
    'https://',
    'not_a_valid_url_at_all',
    'https://[invalid-ipv6/path',
    'javascript:alert("malicious")',
    'data:text/html;base64,PHNjcmlwdD4=',
    '',
  ];

  for (const badUrl of malformedUrls) {
    const norm = normalizeUrlComponents(badUrl);
    assert(!norm.isValid, `Malformed URL detected as invalid: "${badUrl}"`);

    const evalResult = evaluateSuspiciousUrl(badUrl);
    assert(evalResult.isSuspicious, `Malformed URL flagged as suspicious: "${badUrl}"`);
    assert(
      evalResult.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.INVALID_OR_MALFORMED_URL),
      `Triggers INVALID_OR_MALFORMED_URL indicator for: "${badUrl}"`
    );
  }
}

// -----------------------------------------------------------------------------
// Scenario 3: Suspicious Hostname Patterns
// -----------------------------------------------------------------------------
console.log('\n▶ Scenario 3: Suspicious Hostname Patterns');
{
  // 1. Raw public IPv4
  const ipv4Res = evaluateSuspiciousUrl('http://198.51.100.24:8080/account');
  assert(ipv4Res.isSuspicious, 'Public IPv4 flagged as suspicious');
  assert(
    ipv4Res.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.IP_ADDRESS_HOSTNAME),
    'Fires IP_ADDRESS_HOSTNAME for public IPv4'
  );

  // 2. Localhost IPv4 loopback is exempted
  assert(isLocalhostAddress('127.0.0.1'), '127.0.0.1 recognized as loopback');
  assert(isLocalhostAddress('localhost'), 'localhost recognized as loopback');
  const localRes = evaluateSuspiciousUrl('http://127.0.0.1:8899/test');
  assert(!localRes.isSuspicious, 'Local development 127.0.0.1 is not flagged as suspicious');

  // 3. Hyphen-stuffed hostname with security keywords
  const hyphenRes = evaluateSuspiciousUrl('https://secure-login-account-update-verify.com/login');
  assert(hyphenRes.isSuspicious, 'Hyphen-stuffed hostname flagged as suspicious');
  assert(
    hyphenRes.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.HYPHEN_STUFFED_HOSTNAME),
    'Fires HYPHEN_STUFFED_HOSTNAME'
  );

  // 4. Excessive stacked subdomains
  const stackedRes = evaluateSuspiciousUrl('https://login.security.update.verify.bank.service.example.net/auth');
  assert(stackedRes.isSuspicious, 'Excessive subdomains flagged as suspicious');
  assert(
    stackedRes.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.EXCESSIVE_SUBDOMAINS),
    'Fires EXCESSIVE_SUBDOMAINS'
  );

  // 5. Suspicious port
  const portRes = evaluateSuspiciousUrl('https://example.com:1337/login');
  assert(portRes.isSuspicious, 'Non-standard port 1337 on sensitive endpoint flagged');
  assert(
    portRes.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.SUSPICIOUS_PORT),
    'Fires SUSPICIOUS_PORT'
  );
}

// -----------------------------------------------------------------------------
// Scenario 4: Lookalike Domain Examples
// -----------------------------------------------------------------------------
console.log('\n▶ Scenario 4: Lookalike Domain Examples');
{
  // 1. Deceptive brand subdomain on foreign root (e.g., paypal.com.account-update.xyz)
  const lookalikeRes = evaluateSuspiciousUrl('https://paypal.com.account-update.xyz/signin');
  assert(lookalikeRes.isSuspicious, 'PayPal lookalike subdomain flagged as suspicious');
  assert(
    lookalikeRes.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.DECEPTIVE_SUBDOMAIN),
    'Fires DECEPTIVE_SUBDOMAIN for paypal.com on account-update.xyz root'
  );

  // 2. Punycode / Homoglyph lookalike (xn--pple-43d.com -> àpple.com)
  const punyRes = evaluateSuspiciousUrl('https://xn--pple-43d.com/login');
  assert(punyRes.isSuspicious, 'Punycode hostname flagged as suspicious');
  assert(
    punyRes.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.PUNYCODE_OR_HOMOGLYPH),
    'Fires PUNYCODE_OR_HOMOGLYPH'
  );
}

// -----------------------------------------------------------------------------
// Scenario 5: Synthetic Phishing-Style Login Pages
// -----------------------------------------------------------------------------
console.log('\n▶ Scenario 5: Synthetic Phishing-Style Login Pages');
{
  // Brand identity mismatch: Claims Google Workspace on an unrelated host
  const phishResult = evaluatePhishingIndicators({
    pageUrl: 'https://login-google-security.fakeportal.internal/synthetic-phishing-login.html',
    pageTitle: 'Google Workspace - Secure Account Sign In',
    pageMetaBranding: 'Google Workspace',
    faviconUrl: 'https://ssl.gstatic.com/accounts/ui/avatar_2x.png',
    hasPasswordField: true,
    hasUsernameField: true,
    targetUrl: 'http://198.51.100.24:8080/collect/login',
    isSecureContext: false,
  });

  assert(phishResult.isPhishingSuspected, 'Synthetic Google Workspace phishing page is flagged');
  assert(
    phishResult.indicators.some((i) => i.code === PhishingIndicatorCode.BRAND_IDENTITY_MISMATCH),
    'Fires BRAND_IDENTITY_MISMATCH indicator'
  );
  assert(
    phishResult.indicators.some((i) => i.code === PhishingIndicatorCode.DECEPTIVE_ASSET_ORIGIN),
    'Fires DECEPTIVE_ASSET_ORIGIN indicator for Google avatar favicon'
  );
}

// -----------------------------------------------------------------------------
// Scenario 6: Unexpected Form Destinations
// -----------------------------------------------------------------------------
console.log('\n▶ Scenario 6: Unexpected Form Destinations');
{
  // 1. Known exfiltration sink
  const exfilResult = evaluatePhishingIndicators({
    pageUrl: 'https://legitimate-looking-site.org/login',
    formAction: 'https://formspree.io/f/test-exfil-sink',
    hasPasswordField: true,
  });
  assert(exfilResult.isPhishingSuspected, 'Form targeting formspree.io exfiltration sink is flagged');
  assert(
    exfilResult.indicators.some((i) => i.code === PhishingIndicatorCode.EXFILTRATION_ENDPOINT),
    'Fires EXFILTRATION_ENDPOINT'
  );

  // 2. Insecure plain HTTP credential submission
  const insecureTransportResult = evaluatePhishingIndicators({
    pageUrl: 'https://site.example.com/login',
    formAction: 'http://insecure-collector.example.com/api',
    hasPasswordField: true,
  });
  assert(insecureTransportResult.isPhishingSuspected, 'Insecure plain HTTP credential transmission flagged');
  assert(
    insecureTransportResult.indicators.some((i) => i.code === PhishingIndicatorCode.INSECURE_CREDENTIAL_TRANSMISSION),
    'Fires INSECURE_CREDENTIAL_TRANSMISSION'
  );
}

// -----------------------------------------------------------------------------
// Scenario 7: Cross-Origin Form Behavior
// -----------------------------------------------------------------------------
console.log('\n▶ Scenario 7: Cross-Origin Form Behavior');
{
  // Form with password submits across origins to unrelated third party
  const crossOriginResult = evaluatePhishingIndicators({
    pageUrl: 'https://portal.bank-a.internal/login',
    formAction: 'https://untrusted-partner.external.net/auth',
    hasPasswordField: true,
  });
  assert(crossOriginResult.isPhishingSuspected, 'Cross-origin password submission is flagged');
  assert(
    crossOriginResult.indicators.some((i) => i.code === PhishingIndicatorCode.CROSS_ORIGIN_CREDENTIAL_SUBMISSION),
    'Fires CROSS_ORIGIN_CREDENTIAL_SUBMISSION'
  );

  // Same-origin form submission with password is NOT flagged as cross-origin exfiltration
  const sameOriginResult = evaluatePhishingIndicators({
    pageUrl: 'https://portal.bank-a.internal/login',
    formAction: 'https://portal.bank-a.internal/api/auth',
    hasPasswordField: true,
  });
  assert(
    !sameOriginResult.indicators.some((i) => i.code === PhishingIndicatorCode.CROSS_ORIGIN_CREDENTIAL_SUBMISSION),
    'Same-origin form submission does NOT fire cross-origin exfiltration'
  );
}

// -----------------------------------------------------------------------------
// Scenario 8: Navigation Between Supported Test Pages
// -----------------------------------------------------------------------------
console.log('\n▶ Scenario 8: Navigation Between Supported Test Pages');
{
  const navAction: GuardrailAction = {
    id: 'act_nav_001',
    type: ActionType.NAVIGATION,
    timestamp: new Date().toISOString(),
    page: {
      url: 'https://login-google-security.fakeportal.internal/synthetic-phishing-login.html',
      previousUrl: 'http://127.0.0.1:8899/synthetic-legitimate.html',
      title: 'Google Workspace - Secure Sign In',
      metaBranding: 'Google Workspace',
    },
  };

  const pipeline = evaluateActionPipeline(navAction);
  assert(Boolean(pipeline.risk), 'Navigation action successfully evaluated through risk pipeline');
  assert(pipeline.risk.score >= 35, `Navigation to phishing page receives elevated risk score: ${pipeline.risk.score}`);
  assertEquals(pipeline.decision.response, ResponseAction.PROTECT, 'Navigation to deceptive page with critical risk score renders PROTECT decision');
}

// -----------------------------------------------------------------------------
// Scenario 9: Detection Failures & Truthful Non-Execution
// -----------------------------------------------------------------------------
console.log('\n▶ Scenario 9: Detection Failures & Truthful Non-Execution');
{
  // 1. Corrupt action with missing required fields
  const corruptAction = {
    id: '',
    type: 'INVALID_TYPE' as ActionType,
    timestamp: '',
    page: { url: '' },
  };

  const corruptAssessment = assessRisk(corruptAction as GuardrailAction);
  assertEquals(corruptAssessment.status, 'FAILED', 'Corrupt action status is strictly FAILED');
  assertEquals(corruptAssessment.riskLevel, RiskLevel.CRITICAL, 'Corrupt action fails closed to CRITICAL');
  assertEquals(corruptAssessment.score, 100, 'Corrupt action fails closed to score 100');

  // 2. Truthfulness invariant: Failed detection does NOT report ALLOW or successful protection
  const corruptPipeline = evaluateActionPipeline(corruptAction as GuardrailAction);
  assert(
    corruptPipeline.decision.response !== ResponseAction.ALLOW,
    'Failed detection NEVER falsely reports ALLOW'
  );
  assertEquals(
    corruptPipeline.decision.response,
    ResponseAction.PROTECT,
    'Failed detection fails closed to PROTECT'
  );
}

// -----------------------------------------------------------------------------
// Scenario 10: Service Worker Lifecycle Interruptions & Privacy Redaction
// -----------------------------------------------------------------------------
console.log('\n▶ Scenario 10: Service Worker Lifecycle Interruptions & Privacy Redaction');
{
  // 1. Sanitization of sensitive query tokens from URL
  const rawUrl = 'https://portal.example.com/checkout?token=syn_tok_secret99&session=syn_sess_123&user=alice#frag';
  const cleanUrl = sanitizeUrlForDiagnostics(rawUrl);
  assert(!cleanUrl.includes('syn_tok_secret99'), 'Diagnostic URL strips sensitive auth token');
  assert(!cleanUrl.includes('syn_sess_123'), 'Diagnostic URL strips sensitive session id');
  assert(cleanUrl.startsWith('https://portal.example.com/checkout'), 'Diagnostic URL preserves base host and path');

  // 2. Sanitization of diagnostic payload objects
  const payloadWithSentinels = {
    actionId: 'act_test_999',
    password: 'syn_pwd_SuperSecretPassword!#99',
    cardNumber: 'syn_card_4532015099881122',
    otp: 'syn_otp_847291',
    url: rawUrl,
  };

  const sanitizedPayload = sanitizeForDiagnostics(payloadWithSentinels) as Record<string, unknown>;
  assertEquals(sanitizedPayload.password, '[REDACTED]', 'Sensitive password property redacted');
  assertEquals(sanitizedPayload.cardNumber, '[REDACTED]', 'Sensitive cardNumber property redacted');
  assertEquals(sanitizedPayload.otp, '[REDACTED]', 'Sensitive otp property redacted');
  assert(!JSON.stringify(sanitizedPayload).includes('syn_pwd_SuperSecretPassword!#99'), 'Zero raw password sentinels leaked');
}

console.log('\n======================================================================');
console.log(`Results: ${passed} passed, 0 failed across ${total} assertions`);
console.log('======================================================================');
console.log('🎉 TIER 1: ALL WEBSITE DETECTION UNIT TESTS PASSED CLEANLY!\n');
