/**
 * Guardrail Suspicious URL & Hostname Detection Test Suite
 *
 * Verifies the implementation of advanced suspicious URL detection:
 * 1. Standards-compliant URL parsing and normalization.
 * 2. Deceptive and lookalike hostname detection.
 * 3. Unexpected IP addresses as hostnames (with localhost exemption).
 * 4. Suspicious URL credentials and authority deception (@ symbol).
 * 5. Deceptive subdomain brand spoofing and subdomain stacking.
 * 6. Deceptive Unicode, Punycode, and homoglyph representations.
 * 7. Double URL encoding and path traversal patterns.
 * 8. Invalid and malformed URL handling.
 * 9. False-positive resilience across legitimate domains and local development.
 * 10. Seamless integration with ActionClassifier, RiskEngine, and ResponseEngine.
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { RiskLevel, RiskSignalId } from '../types/risk.js';
import {
  evaluateSuspiciousUrl,
  extractDomainParts,
  isIpv4Address,
  isIpv6Address,
  isLocalhostAddress,
  normalizeUrlComponents,
  SuspiciousUrlIndicatorCode,
} from './url-detector.js';
import { classifyAction } from '../classifier/index.js';
import { assessRisk } from '../risk/index.js';
import { evaluateActionPipeline } from '../response/index.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  const isMatch = actual === expected || JSON.stringify(actual) === JSON.stringify(expected);
  if (isMatch) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message} (Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)})`);
  }
}

console.log('\n======================================================================');
console.log('🧪 GUARDRAIL SUSPICIOUS URL & HOSTNAME DETECTION TEST SUITE');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// Group 1: Standards-Compliant Safe URL Parsing & Normalization
// -----------------------------------------------------------------------------
console.log('▶ Group 1: Safe Standards-Compliant Parsing & Normalization');
{
  const norm1 = normalizeUrlComponents('https://Example.COM:443/Path/To/Page?token=secret#hash');
  assert(norm1.isValid, 'Parses standard HTTPS URL successfully');
  assertEquals(norm1.protocol, 'https:', 'Extracts lowercase protocol');
  assertEquals(norm1.hostname, 'example.com', 'Normalizes hostname to lowercase');
  assertEquals(norm1.pathname, '/Path/To/Page', 'Preserves pathname');
  assertEquals(norm1.normalizedUrl, 'https://example.com/Path/To/Page', 'Strips query string and hash from normalized URL');

  // Trailing dot normalization (FQDN)
  const norm2 = normalizeUrlComponents('http://my-service.org./api');
  assertEquals(norm2.hostname, 'my-service.org', 'Strips trailing FQDN dot from hostname');

  // Credential stripping in normalization
  const norm3 = normalizeUrlComponents('https://admin:myPassword123@internal-portal.net/secure');
  assert(norm3.isValid, 'Parses URL containing credentials');
  assertEquals(
    norm3.normalizedUrl,
    'https://internal-portal.net/secure',
    'Normalized URL completely strips embedded username and password'
  );

  // Registrable domain extraction (standard 1-level TLD)
  const parts1 = extractDomainParts('login.accounts.google.com');
  assertEquals(parts1.registrableDomain, 'google.com', 'Extracts registrable domain for 1-level TLD');
  assertEquals(parts1.subdomains, ['login', 'accounts'], 'Extracts subdomains in order');

  // Registrable domain extraction (multi-level ccTLD .co.uk)
  const parts2 = extractDomainParts('banking.online.barclays.co.uk');
  assertEquals(parts2.registrableDomain, 'barclays.co.uk', 'Extracts registrable domain for 2-level ccTLD .co.uk');
  assertEquals(parts2.subdomains, ['banking', 'online'], 'Extracts subdomains for multi-level TLD');
}

// -----------------------------------------------------------------------------
// Group 2: Invalid, Malformed, and Unsupported Scheme URLs
// -----------------------------------------------------------------------------
console.log('\n▶ Group 2: Invalid, Malformed, and Unsupported Scheme URLs');
{
  // JavaScript scheme
  const jsEval = evaluateSuspiciousUrl('javascript:alert(document.cookie)');
  assert(jsEval.isSuspicious, 'Flags javascript: scheme as suspicious');
  assert(
    jsEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.INVALID_OR_MALFORMED_URL),
    'Emits INVALID_OR_MALFORMED_URL indicator for javascript: scheme'
  );

  // Data scheme
  const dataEval = evaluateSuspiciousUrl('data:text/html,<script>evil()</script>');
  assert(dataEval.isSuspicious, 'Flags data: scheme as suspicious');
  assert(
    dataEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.INVALID_OR_MALFORMED_URL),
    'Emits INVALID_OR_MALFORMED_URL indicator for data: scheme'
  );

  // Arbitrary garbage string
  const badEval = evaluateSuspiciousUrl('not_a_valid_url_at_all');
  assert(badEval.isSuspicious, 'Flags unparseable string as suspicious');
  assert(
    badEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.INVALID_OR_MALFORMED_URL),
    'Emits INVALID_OR_MALFORMED_URL for garbage input'
  );

  // Empty string
  const emptyEval = evaluateSuspiciousUrl('');
  assert(emptyEval.isSuspicious, 'Flags empty URL string');
}

// -----------------------------------------------------------------------------
// Group 3: IP Address Hostnames & Localhost Exemption
// -----------------------------------------------------------------------------
console.log('\n▶ Group 3: IP Address Hostnames & Localhost Exemption');
{
  assert(isIpv4Address('192.168.1.1'), 'Identifies standard IPv4 address');
  assert(isIpv4Address('45.33.32.156'), 'Identifies public IPv4 address');
  assert(!isIpv4Address('example.com'), 'Rejects standard domain name as IPv4');

  assert(isIpv6Address('[2001:db8::1]'), 'Identifies bracketed IPv6 address');
  assert(isIpv6Address('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), 'Identifies raw IPv6 address');

  assert(isLocalhostAddress('localhost'), 'Identifies localhost as local');
  assert(isLocalhostAddress('127.0.0.1'), 'Identifies 127.0.0.1 as local');
  assert(isLocalhostAddress('::1'), 'Identifies ::1 as local');
  assert(!isLocalhostAddress('45.33.32.156'), 'Recognizes public IP as non-local');

  // Public IPv4 evaluation
  const ipEval = evaluateSuspiciousUrl('http://45.33.32.156/bank/login');
  assert(ipEval.isSuspicious, 'Flags public IPv4 hostname as suspicious');
  assert(
    ipEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.IP_ADDRESS_HOSTNAME),
    'Emits IP_ADDRESS_HOSTNAME indicator'
  );

  // Localhost must NOT be flagged as suspicious IP hostname
  const localEval1 = evaluateSuspiciousUrl('http://localhost:3000/dashboard');
  assert(!localEval1.isSuspicious, 'Localhost is NOT flagged as suspicious');
  assertEquals(localEval1.score, 0, 'Localhost score is 0');

  const localEval2 = evaluateSuspiciousUrl('http://127.0.0.1:8080/test');
  assert(!localEval2.isSuspicious, '127.0.0.1 loopback is NOT flagged as suspicious');
}

// -----------------------------------------------------------------------------
// Group 4: URL Credentials & Deceptive User-Info Authority Tricks
// -----------------------------------------------------------------------------
console.log('\n▶ Group 4: URL Credentials & Deceptive User-Info Authority Tricks');
{
  // Deceptive authority trick: Userinfo contains domain name before @
  const deceptiveAuthEval = evaluateSuspiciousUrl('https://google.com@attacker-controlled-site.net/login');
  assert(deceptiveAuthEval.isSuspicious, 'Flags authority deception (@ trick) as suspicious');
  assert(
    deceptiveAuthEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.DECEPTIVE_USERINFO_AUTH),
    'Emits DECEPTIVE_USERINFO_AUTH indicator'
  );

  // Embedded basic authentication credentials
  const basicAuthEval = evaluateSuspiciousUrl('https://service-account:secretPass99@suspicious-host.org/');
  assert(basicAuthEval.isSuspicious, 'Flags embedded basic auth credentials');
  assert(
    basicAuthEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.EMBEDDED_CREDENTIALS),
    'Emits EMBEDDED_CREDENTIALS indicator'
  );
}

// -----------------------------------------------------------------------------
// Group 5: Deceptive Subdomain & Brand Spoofing
// -----------------------------------------------------------------------------
console.log('\n▶ Group 5: Deceptive Subdomain & Brand Spoofing');
{
  // Brand name in subdomain on unrelated domain
  const spoofEval1 = evaluateSuspiciousUrl('https://paypal.com.account-verification-notice.xyz/login');
  assert(spoofEval1.isSuspicious, 'Flags brand name in subdomain on unrelated domain');
  assert(
    spoofEval1.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.DECEPTIVE_SUBDOMAIN),
    'Emits DECEPTIVE_SUBDOMAIN indicator for paypal.com spoof'
  );

  const spoofEval2 = evaluateSuspiciousUrl('https://apple-login.support-service-portal.net/auth');
  assert(spoofEval2.isSuspicious, 'Flags apple-login subdomain on unrelated domain');
  assert(
    spoofEval2.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.DECEPTIVE_SUBDOMAIN),
    'Emits DECEPTIVE_SUBDOMAIN indicator for apple-login prefix'
  );

  // Legitimate brand domains MUST NOT be flagged as deceptive subdomains
  const legitBrand1 = evaluateSuspiciousUrl('https://www.paypal.com/signin');
  assert(
    !legitBrand1.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.DECEPTIVE_SUBDOMAIN),
    'Legitimate www.paypal.com is NOT flagged as deceptive subdomain'
  );

  const legitBrand2 = evaluateSuspiciousUrl('https://login.microsoft.com/oauth2');
  assert(
    !legitBrand2.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.DECEPTIVE_SUBDOMAIN),
    'Legitimate login.microsoft.com is NOT flagged as deceptive subdomain'
  );
}

// -----------------------------------------------------------------------------
// Group 6: Subdomain Stacking & Hyphen Stuffing
// -----------------------------------------------------------------------------
console.log('\n▶ Group 6: Subdomain Stacking & Hyphen Stuffing');
{
  // Excessive subdomain stacking (4+ levels)
  const stackedEval = evaluateSuspiciousUrl('https://a.b.c.d.random-phishing-host.com/index.html');
  assert(stackedEval.isSuspicious, 'Flags 4+ subdomain stacking');
  assert(
    stackedEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.EXCESSIVE_SUBDOMAINS),
    'Emits EXCESSIVE_SUBDOMAINS indicator'
  );

  // Cloud CDN with legitimate subdomains must NOT be flagged
  const cdnEval = evaluateSuspiciousUrl('https://client.prod.media.azureedge.net/video.mp4');
  assert(
    !cdnEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.EXCESSIVE_SUBDOMAINS),
    'Legitimate Azure CDN deep subdomain is exempted from excessive stacking'
  );

  // Hyphen stuffing with security keywords
  const hyphenEval = evaluateSuspiciousUrl('https://secure-login-account-verify-portal.com/update');
  assert(hyphenEval.isSuspicious, 'Flags hostname with 3+ hyphens and auth keywords');
  assert(
    hyphenEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.HYPHEN_STUFFED_HOSTNAME),
    'Emits HYPHEN_STUFFED_HOSTNAME indicator'
  );
}

// -----------------------------------------------------------------------------
// Group 7: Unicode, Punycode & Homoglyph Attacks
// -----------------------------------------------------------------------------
console.log('\n▶ Group 7: Unicode, Punycode & Homoglyph Attacks');
{
  // Punycode representation of homoglyph (xn-- prefix)
  const punyEval = evaluateSuspiciousUrl('https://xn--pypal-4ve.com/account/login');
  assert(punyEval.isSuspicious, 'Flags punycode domain (xn--) as suspicious');
  assert(
    punyEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.PUNYCODE_OR_HOMOGLYPH),
    'Emits PUNYCODE_OR_HOMOGLYPH for xn-- domain'
  );

  // Raw Cyrillic homoglyph in hostname ('а' U+0430)
  const homoglyphEval = evaluateSuspiciousUrl('https://p\u0430ypal.com/signin');
  assert(homoglyphEval.isSuspicious, 'Flags mixed-script Cyrillic homoglyph');
  assert(
    homoglyphEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.PUNYCODE_OR_HOMOGLYPH),
    'Emits PUNYCODE_OR_HOMOGLYPH for raw Unicode Cyrillic character'
  );

  // Standard pure Latin domain must NOT be flagged
  const standardEval = evaluateSuspiciousUrl('https://paypal.com/signin');
  assert(
    !standardEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.PUNYCODE_OR_HOMOGLYPH),
    'Standard Latin domain is not flagged as homoglyph'
  );
}

// -----------------------------------------------------------------------------
// Group 8: Suspicious URL Encoding, High-Risk TLDs & Non-Standard Ports
// -----------------------------------------------------------------------------
console.log('\n▶ Group 8: Suspicious URL Encoding, High-Risk TLDs & Ports');
{
  // Double URL encoding
  const doubleEncEval = evaluateSuspiciousUrl('https://target-portal.com/%252e%252e/admin');
  assert(doubleEncEval.isSuspicious, 'Flags double percent-encoding');
  assert(
    doubleEncEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.DOUBLE_URL_ENCODING),
    'Emits DOUBLE_URL_ENCODING indicator'
  );

  // High-risk TLD with sensitive keyword
  const highRiskTldEval = evaluateSuspiciousUrl('https://banking-auth-update.top/');
  assert(highRiskTldEval.isSuspicious, 'Flags high-risk TLD (.top) combined with sensitive terms');
  assert(
    highRiskTldEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.HIGH_RISK_TLD_KEYWORD),
    'Emits HIGH_RISK_TLD_KEYWORD indicator'
  );

  // Suspicious non-standard port on public IP/domain
  const portEval = evaluateSuspiciousUrl('https://remote-portal.org:1337/api');
  assert(
    portEval.indicators.some((i) => i.code === SuspiciousUrlIndicatorCode.SUSPICIOUS_PORT),
    'Emits SUSPICIOUS_PORT for port 1337'
  );
}

// -----------------------------------------------------------------------------
// Group 9: False-Positive Resilience across Legitimate Websites
// -----------------------------------------------------------------------------
console.log('\n▶ Group 9: False-Positive Resilience across Legitimate Websites');
{
  const testCases = [
    { url: 'https://www.google.com/search?q=guardrail+ui', label: 'Google Search' },
    { url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', label: 'Microsoft Online OAuth' },
    { url: 'https://news.bbc.co.uk/world/article', label: 'BBC UK news article' },
    { url: 'https://cdn.jsdelivr.net/npm/package@1.2.3/dist/index.js', label: 'CDN with @ in pathname' },
    { url: 'http://localhost:5173/dashboard', label: 'Vite dev server on localhost' },
    { url: 'http://127.0.0.1:3000/app', label: 'Local node app on 127.0.0.1' },
    { url: 'https://github.com/facebook/react/issues/1234', label: 'GitHub repository path' },
  ];

  for (const tc of testCases) {
    const res = evaluateSuspiciousUrl(tc.url);
    assert(!res.isSuspicious, `False-positive check passed: ${tc.label} (${tc.url})`);
    assertEquals(res.score, 0, `Zero risk score for ${tc.label}`);
    assertEquals(res.indicators.length, 0, `Zero indicators for ${tc.label}`);
  }
}

// -----------------------------------------------------------------------------
// Group 10: End-to-End Pipeline Integration (Classifier, Risk & Response)
// -----------------------------------------------------------------------------
console.log('\n▶ Group 10: End-to-End Pipeline Integration');
{
  // Scenario A: Anchor link click targeting an IP address
  const ipLinkAction: GuardrailAction = {
    id: 'act-suspicious-ip-1',
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    element: {
      tagName: 'A',
      id: 'external-link-to-ip',
      visibleText: 'Access Server Dashboard',
      targetUrl: 'http://45.33.32.156/admin/login',
    },
    page: {
      url: 'https://my-company.example.com/portal',
      title: 'Company Portal',
    },
  };

  // 1. Classifier evaluates action
  const classification = classifyAction(ipLinkAction);
  assert(
    classification.category === ActionCategory.EXTERNAL_NAVIGATION,
    'Classifier assigns EXTERNAL_NAVIGATION for suspicious destination targetUrl'
  );

  // 2. Risk Engine evaluates risk signals
  const risk = assessRisk(ipLinkAction, classification);
  assert(
    risk.matchedRules.some((r) => r.signalId === RiskSignalId.SUSPICIOUS_URL),
    'Risk engine matches RISK_RULE_SUSPICIOUS_URL'
  );
  assert(risk.score >= 25, `Computed risk score is elevated: ${risk.score} (>= 25)`);
  assertEquals(risk.riskLevel, RiskLevel.MEDIUM, 'RiskLevel evaluates to MEDIUM');

  // 3. Response Engine applies policy precedence
  const { decision } = evaluateActionPipeline(ipLinkAction);
  assertEquals(decision.response, ResponseAction.WARN, 'Policy evaluation yields advisory WARN decision');
  assert(
    decision.structuredReasons?.some((sr) => sr.code === 'POLICY_WARN_SUSPICIOUS_URL'),
    'Emits POLICY_WARN_SUSPICIOUS_URL reason code'
  );
  assert(
    decision.reasons.some((r) => r.includes('Suspicious URL advisory')),
    'Policy explanation provides clear user advisory context'
  );

  // Scenario B: Deceptive Subdomain Spoofing
  const spoofAction: GuardrailAction = {
    id: 'act-spoof-1',
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    element: {
      tagName: 'A',
      id: 'phish-link',
      visibleText: 'Confirm Your PayPal Account',
      targetUrl: 'https://paypal.com.account-update-notice.xyz/signin',
    },
    page: {
      url: 'https://my-blog.com/page',
      title: 'Blog Page',
    },
  };

  const spoofPipeline = evaluateActionPipeline(spoofAction);
  assertEquals(spoofPipeline.decision.response, ResponseAction.WARN, 'Yields WARN for deceptive subdomain click');
  assert(
    spoofPipeline.risk.matchedRules.some((r) => r.signalId === RiskSignalId.SUSPICIOUS_URL),
    'Triggers SUSPICIOUS_URL risk signal on deceptive brand subdomain'
  );

  // Scenario C: Privacy Invariant Check
  assert(
    !JSON.stringify(spoofPipeline).includes('secret'),
    'Privacy Invariant: Pipeline output contains no unredacted secret credentials'
  );
}

// -----------------------------------------------------------------------------
// Final Results
// -----------------------------------------------------------------------------
console.log('\n======================================================================');
console.log(`Results: ${passed} passed, ${failed} failed across all 10 test groups`);
console.log('======================================================================\n');

if (failed > 0) {
  console.error(`❌ Verification FAILED with ${failed} failure(s).`);
  process.exit(1);
} else {
  console.log('🎉 ALL SUSPICIOUS URL & HOSTNAME DETECTION TESTS PASSED CLEANLY!\n');
}
