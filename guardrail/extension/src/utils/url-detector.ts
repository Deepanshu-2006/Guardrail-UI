/**
 * Guardrail Suspicious URL & Hostname Detector
 *
 * Implements safe, standards-compliant, deterministic detection of suspicious
 * URL structures, lookalike domains, IP address hostnames, deceptive subdomains,
 * and malicious obfuscation patterns.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. STANDARDS-BASED PARSING: Uses native Web URL parsing. Handles malformed or non-HTTP schemes safely.
 * 2. CONSISTENT NORMALIZATION: Normalizes hostnames (case, trailing dots, default ports) before heuristic evaluation.
 * 3. NO DOMAIN PROOF FROM SUBSTRINGS: Recognizes registrable domains; distinguishes brand subdomains from parent domains.
 * 4. HEURISTIC NOT PROOF OF MALICE: Explicitly returns heuristic risk signals and reasons. Never claims confirmed malice.
 * 5. FALSE POSITIVE RESILIENCE: Whitelists local development (localhost, 127.0.0.1) and handles CDNs and multi-part TLDs.
 * 6. PRIVACY INVARIANT: Never leaks, transmits, or stores sensitive query parameters or user credentials.
 */

/**
 * Categorical indicator codes identifying suspicious characteristics in a URL.
 */
export enum SuspiciousUrlIndicatorCode {
  /** URL is malformed, uses an unsupported scheme, or cannot be parsed */
  INVALID_OR_MALFORMED_URL = 'INVALID_OR_MALFORMED_URL',

  /** Hostname is a raw public IPv4 or IPv6 address */
  IP_ADDRESS_HOSTNAME = 'IP_ADDRESS_HOSTNAME',

  /** URL contains basic authentication user-information in the authority section */
  EMBEDDED_CREDENTIALS = 'EMBEDDED_CREDENTIALS',

  /** URL uses deceptive credentials before an '@' symbol to masquerade as another domain */
  DECEPTIVE_USERINFO_AUTH = 'DECEPTIVE_USERINFO_AUTH',

  /** Hostname contains Punycode ('xn--') or mixed non-Latin homoglyph characters */
  PUNYCODE_OR_HOMOGLYPH = 'PUNYCODE_OR_HOMOGLYPH',

  /** Subdomain contains a recognizable sensitive brand name on an unrelated domain */
  DECEPTIVE_SUBDOMAIN = 'DECEPTIVE_SUBDOMAIN',

  /** Hostname contains an unusually high number of stacked subdomain levels */
  EXCESSIVE_SUBDOMAINS = 'EXCESSIVE_SUBDOMAINS',

  /** High-risk or abused TLD combined with sensitive security/auth/payment keywords */
  HIGH_RISK_TLD_KEYWORD = 'HIGH_RISK_TLD_KEYWORD',

  /** Hostname contains excessive hyphens combined with authentication or account terms */
  HYPHEN_STUFFED_HOSTNAME = 'HYPHEN_STUFFED_HOSTNAME',

  /** URL uses double percent-encoding or path traversal sequences */
  DOUBLE_URL_ENCODING = 'DOUBLE_URL_ENCODING',

  /** URL targets an uncommon or suspicious port outside standard web traffic */
  SUSPICIOUS_PORT = 'SUSPICIOUS_PORT',
}

/**
 * Structured details for an individual triggered indicator.
 */
export interface SuspiciousUrlIndicator {
  /** Unique indicator identifier matching the code */
  readonly code: SuspiciousUrlIndicatorCode;

  /** Indicator severity level ('LOW', 'MEDIUM', 'HIGH') */
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH';

  /** Human-readable explanation of why this characteristic is flagged */
  readonly description: string;

  /** Numeric score contribution (0 to 100) added to total risk score */
  readonly scoreContribution: number;

  /** Non-sensitive token or pattern that triggered this indicator */
  readonly matchedPattern?: string;
}

/**
 * Normalized structural components extracted safely from a URL.
 */
export interface NormalizedUrlComponents {
  /** True if URL was successfully parsed with a supported protocol (http/https) */
  readonly isValid: boolean;

  /** Original raw URL provided as input */
  readonly originalUrl: string;

  /** Cleaned, normalized URL with credentials stripped and sensitive query params removed */
  readonly normalizedUrl?: string;

  /** Normalized protocol ('http:' or 'https:') */
  readonly protocol?: string;

  /** Cleaned, lowercase hostname without trailing dots or ports */
  readonly hostname?: string;

  /** Port string if explicitly specified in non-default form */
  readonly port?: string;

  /** Normalized URL pathname */
  readonly pathname?: string;

  /** Extracted effective registrable domain (e.g., 'example.co.uk' or 'foo.com') */
  readonly registrableDomain?: string;

  /** Extracted subdomain labels in hierarchical order (from leftmost to nearest to SLD) */
  readonly subdomains?: readonly string[];

  /** True if hostname is an IPv4 or IPv6 address */
  readonly isIpAddress?: boolean;

  /** True if hostname is a local loopback or local development address */
  readonly isLocalhost?: boolean;
}

/**
 * Comprehensive result of evaluating a URL against suspicious detection heuristics.
 */
export interface SuspiciousUrlEvaluation {
  /** True if one or more significant suspicious indicators were detected */
  readonly isSuspicious: boolean;

  /** Aggregate risk score strictly clamped between 0 and 100 */
  readonly score: number;

  /** Normalized components extracted from the URL */
  readonly components: NormalizedUrlComponents;

  /** Array of specific indicators identified during evaluation */
  readonly indicators: readonly SuspiciousUrlIndicator[];

  /** Array of human-readable explanation strings */
  readonly reasons: readonly string[];
}

// =============================================================================
// Constants & Knowledge Bases (Local, Privacy-Preserving)
// =============================================================================

/**
 * Common two-level effective top-level domains (ccTLD second-level registries).
 */
const COMMON_TWO_LEVEL_TLDS: ReadonlySet<string> = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'co.jp',
  'ne.jp',
  'ac.jp',
  'go.jp',
  'com.br',
  'co.nz',
  'net.nz',
  'org.nz',
  'com.sg',
  'edu.sg',
  'co.in',
  'net.in',
  'org.in',
  'gen.in',
  'com.mx',
  'edu.mx',
  'co.za',
  'org.za',
  'com.tr',
  'edu.tr',
]);

/**
 * High-profile brands and service providers frequently targeted in domain spoofing.
 */
const SENSITIVE_BRAND_NAMES: readonly string[] = Object.freeze([
  'paypal',
  'google',
  'microsoft',
  'apple',
  'amazon',
  'netflix',
  'facebook',
  'instagram',
  'github',
  'chase',
  'wellsfargo',
  'bankofamerica',
  'citibank',
  'coinbase',
  'binance',
  'dropbox',
  'yahoo',
  'outlook',
  'icloud',
  'whatsapp',
  'telegram',
  'metamask',
]);

/**
 * High-risk or heavily abused TLDs (e.g. file extensions or high-volume phishing TLDs).
 */
const HIGH_RISK_TLDS: ReadonlySet<string> = new Set([
  'zip',
  'mov',
  'top',
  'xyz',
  'buzz',
  'club',
  'country',
  'work',
  'fit',
  'kim',
  'gq',
  'cf',
  'tk',
  'ml',
  'ga',
  'monster',
  'rest',
]);

/**
 * Security and authentication terms that indicate elevated sensitivity when found in suspicious contexts.
 */
const SENSITIVE_AUTH_KEYWORDS: readonly string[] = Object.freeze([
  'login',
  'signin',
  'sign-in',
  'log-in',
  'auth',
  'authenticate',
  'secure',
  'security',
  'verify',
  'verification',
  'account',
  'banking',
  'wallet',
  'recover',
  'password',
  'credential',
  'billing',
  'update',
  'portal',
  'support',
]);

/**
 * Legitimate multi-tenant cloud/CDN domains where deep subdomains are expected standard practice.
 */
const LEGITIMATE_DEEP_SUBDOMAIN_SUFFIXES: readonly string[] = Object.freeze([
  'azureedge.net',
  'azurefd.net',
  'cloudfront.net',
  'trafficmanager.net',
  'amazonaws.com',
  'googleapis.com',
  'cloudfunctions.net',
  'appspot.com',
  'github.io',
  'gitlab.io',
  'pages.dev',
  'workers.dev',
]);

/**
 * Non-standard ports commonly associated with malicious C2 or unauthenticated proxies.
 */
const SUSPICIOUS_PORTS: ReadonlySet<string> = new Set([
  '1337',
  '31337',
  '6667',
  '8888',
  '9999',
  '5555',
  '4444',
]);

// =============================================================================
// Pure Parsing & Normalization Helpers
// =============================================================================

/**
 * Checks if a hostname is an IPv4 address.
 */
export function isIpv4Address(hostname: string): boolean {
  if (!hostname) return false;
  // Standard dot-decimal
  const ipv4DotDecimal =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (ipv4DotDecimal.test(hostname)) return true;

  // Hex or Dword IP representation
  const dwordIp = /^\d{8,10}$/;
  if (dwordIp.test(hostname)) return true;

  const hexIp = /^0x[0-9a-fA-F]{8}$/;
  return hexIp.test(hostname);
}

/**
 * Checks if a hostname is an IPv6 address.
 */
export function isIpv6Address(hostname: string): boolean {
  if (!hostname) return false;
  const clean = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  // Basic IPv6 validation (contains colons and valid hex parts)
  return clean.includes(':') && /^[0-9a-fA-F:]+$/.test(clean);
}

/**
 * Checks if a hostname is local loopback or development address.
 */
export function isLocalhostAddress(hostname: string): boolean {
  if (!hostname) return false;
  const lower = hostname.toLowerCase().trim();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower.startsWith('127.') ||
    lower === '::1' ||
    lower === '[::1]' ||
    lower.endsWith('.localhost')
  );
}

/**
 * Extracts the effective registrable domain and subdomains from a normalized hostname.
 * Safely handles common multi-part TLDs (e.g., .co.uk).
 */
export function extractDomainParts(hostname: string): {
  registrableDomain?: string;
  subdomains: string[];
} {
  if (!hostname || isIpv4Address(hostname) || isIpv6Address(hostname) || isLocalhostAddress(hostname)) {
    return { subdomains: [] };
  }

  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) {
    return { subdomains: [] };
  }

  // Check for common two-level TLDs (e.g. co.uk)
  if (parts.length >= 3) {
    const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (COMMON_TWO_LEVEL_TLDS.has(lastTwo)) {
      const sld = parts[parts.length - 3];
      const registrableDomain = `${sld}.${lastTwo}`;
      const subdomains = parts.slice(0, parts.length - 3);
      return { registrableDomain, subdomains };
    }
  }

  // Standard one-level TLD (e.g. example.com)
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const registrableDomain = `${sld}.${tld}`;
  const subdomains = parts.slice(0, parts.length - 2);

  return { registrableDomain, subdomains };
}

/**
 * Parses and normalizes a candidate URL safely using standards-compliant logic.
 * Guarantees zero leakage of credentials or sensitive parameters.
 */
export function normalizeUrlComponents(rawUrl: string): NormalizedUrlComponents {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, originalUrl: String(rawUrl) };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { isValid: false, originalUrl: rawUrl };
  }

  try {
    const parsed = new URL(trimmed);

    // Only HTTP and HTTPS are valid web protocols for Guardrail inspection
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return {
        isValid: false,
        originalUrl: trimmed,
        protocol,
      };
    }

    // Clean hostname: lowercase and strip trailing dot
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.endsWith('.')) {
      hostname = hostname.slice(0, -1);
    }

    const isIp = isIpv4Address(hostname) || isIpv6Address(hostname);
    const isLocal = isLocalhostAddress(hostname);
    const { registrableDomain, subdomains } = extractDomainParts(hostname);

    // Build safe normalized URL strictly stripping credentials (username/password)
    const portPart = parsed.port ? `:${parsed.port}` : '';
    const pathname = parsed.pathname || '/';
    const normalizedUrl = `${protocol}//${hostname}${portPart}${pathname}`;

    return {
      isValid: true,
      originalUrl: trimmed,
      normalizedUrl,
      protocol,
      hostname,
      port: parsed.port || undefined,
      pathname,
      registrableDomain,
      subdomains,
      isIpAddress: isIp,
      isLocalhost: isLocal,
    };
  } catch {
    return {
      isValid: false,
      originalUrl: trimmed,
    };
  }
}

// =============================================================================
// Heuristic Evaluator Implementation
// =============================================================================

/**
 * Checks for mixed script characters (e.g. Cyrillic or Greek lookalikes mixed with Latin).
 */
function hasMixedScriptHomoglyphs(text: string): boolean {
  if (!text) return false;
  // Common Cyrillic lookalikes: а, с, е, о, р, х, у, і, ј
  const hasCyrillic = /[\u0400-\u04FF]/.test(text);
  // Greek lookalikes: ο, ν, ρ, τ, υ, χ
  const hasGreek = /[\u0370-\u03FF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);

  return (hasCyrillic || hasGreek) && (hasLatin || text.includes('.'));
}

/**
 * Checks for double URL encoding (e.g. %252f, %253a, %252e) in a raw URL string.
 */
function hasDoubleUrlEncoding(rawUrl: string): boolean {
  if (!rawUrl) return false;
  return /%25[0-9a-fA-F]{2}/i.test(rawUrl);
}

/**
 * Checks for path traversal sequences in a raw URL string or pathname.
 */
function hasPathTraversal(rawUrl: string, pathname?: string): boolean {
  const target = `${rawUrl} ${pathname || ''}`;
  return (
    target.includes('/../') ||
    target.includes('\\..\\') ||
    /%2e%2e/i.test(target) ||
    target.includes('/..')
  );
}

/**
 * Evaluates a candidate URL string and produces structured suspicious indicators.
 *
 * SAFETY INVARIANT:
 * Evaluation is pure, local, deterministic, and privacy-preserving.
 * No external network requests are made.
 *
 * @param url Candidate URL or destination link string
 * @returns Structured evaluation result with reasons and clamped score
 */
export function evaluateSuspiciousUrl(url: string): SuspiciousUrlEvaluation {
  const components = normalizeUrlComponents(url);
  const indicators: SuspiciousUrlIndicator[] = [];

  // 1. Invalid or malformed URLs
  if (!components.isValid) {
    indicators.push({
      code: SuspiciousUrlIndicatorCode.INVALID_OR_MALFORMED_URL,
      severity: 'HIGH',
      description: 'URL cannot be parsed or uses an unsupported scheme (only standard HTTP/HTTPS supported).',
      scoreContribution: 30,
      matchedPattern: components.protocol || components.originalUrl,
    });

    return {
      isSuspicious: true,
      score: 30,
      components,
      indicators,
      reasons: indicators.map((i) => i.description),
    };
  }

  const hostname = components.hostname || '';
  const rawUrl = components.originalUrl;

  // 2. Unexpected use of IP addresses as hostnames (exempting localhost)
  if (components.isIpAddress && !components.isLocalhost) {
    indicators.push({
      code: SuspiciousUrlIndicatorCode.IP_ADDRESS_HOSTNAME,
      severity: 'HIGH',
      description: 'Hostname is a raw IP address rather than a registered domain name.',
      scoreContribution: 25,
      matchedPattern: hostname,
    });
  }

  // 3. Suspicious use of URL credentials or user-info fields (@ symbol authority trickery)
  try {
    const rawParsed = new URL(rawUrl);
    if (rawParsed.username || rawParsed.password) {
      const userInfo = `${rawParsed.username}:${rawParsed.password}`;
      // Check if userinfo looks like a domain or contains brand terms (masquerading authority)
      const isDeceptiveUserInfo =
        userInfo.includes('.') ||
        SENSITIVE_BRAND_NAMES.some((brand) => userInfo.toLowerCase().includes(brand));

      if (isDeceptiveUserInfo) {
        indicators.push({
          code: SuspiciousUrlIndicatorCode.DECEPTIVE_USERINFO_AUTH,
          severity: 'HIGH',
          description: 'URL uses embedded credentials before an "@" symbol to masquerade as another domain.',
          scoreContribution: 30,
          matchedPattern: userInfo.includes('.') ? '[domain-like-userinfo]' : '[brand-like-userinfo]',
        });
      } else {
        indicators.push({
          code: SuspiciousUrlIndicatorCode.EMBEDDED_CREDENTIALS,
          severity: 'MEDIUM',
          description: 'URL contains embedded credentials in the user-info section.',
          scoreContribution: 20,
        });
      }
    }
  } catch {
    // Ignore URL constructor error handled earlier
  }

  // 4. Unicode, Punycode & Homoglyph Lookalikes
  if (hostname.startsWith('xn--') || hostname.includes('.xn--')) {
    indicators.push({
      code: SuspiciousUrlIndicatorCode.PUNYCODE_OR_HOMOGLYPH,
      severity: 'HIGH',
      description: 'Hostname uses Punycode (IDN) representation, often used in lookalike homoglyph attacks.',
      scoreContribution: 25,
      matchedPattern: hostname,
    });
  } else if (hasMixedScriptHomoglyphs(hostname)) {
    indicators.push({
      code: SuspiciousUrlIndicatorCode.PUNYCODE_OR_HOMOGLYPH,
      severity: 'HIGH',
      description: 'Hostname contains mixed non-Latin characters or visually deceptive homoglyphs.',
      scoreContribution: 25,
      matchedPattern: hostname,
    });
  }

  // 5. Deceptive Subdomain & Brand Spoofing
  if (components.subdomains && components.subdomains.length > 0 && components.registrableDomain) {
    const regDomain = components.registrableDomain;
    const subdomainsJoined = components.subdomains.join('.').toLowerCase();

    for (const brand of SENSITIVE_BRAND_NAMES) {
      // Check if brand appears in subdomains but the registrable domain is NOT the brand's
      const brandInSubdomain =
        subdomainsJoined === brand ||
        subdomainsJoined.startsWith(`${brand}.`) ||
        subdomainsJoined.endsWith(`.${brand}`) ||
        subdomainsJoined.includes(`.${brand}.`) ||
        components.subdomains.some((sub) => sub === brand || sub.startsWith(`${brand}-`) || sub.endsWith(`-${brand}`));

      const isBrandRegistrableDomain =
        regDomain === `${brand}.com` ||
        regDomain === `${brand}.org` ||
        regDomain === `${brand}.net` ||
        regDomain.startsWith(`${brand}.`);

      if (brandInSubdomain && !isBrandRegistrableDomain) {
        indicators.push({
          code: SuspiciousUrlIndicatorCode.DECEPTIVE_SUBDOMAIN,
          severity: 'HIGH',
          description: `Subdomain contains recognizable brand name "${brand}" on an unrelated domain (${regDomain}).`,
          scoreContribution: 30,
          matchedPattern: brand,
        });
        break; // Match once
      }
    }
  }

  // 6. Subdomain Stacking / Excessive Depth
  if (
    components.subdomains &&
    components.subdomains.length >= 4 &&
    !LEGITIMATE_DEEP_SUBDOMAIN_SUFFIXES.some((sfx) => hostname.endsWith(sfx))
  ) {
    indicators.push({
      code: SuspiciousUrlIndicatorCode.EXCESSIVE_SUBDOMAINS,
      severity: 'MEDIUM',
      description: `Hostname contains an unusually high number of stacked subdomains (${components.subdomains.length} levels).`,
      scoreContribution: 15,
      matchedPattern: `${components.subdomains.length} levels`,
    });
  }

  // 7. Hyphen-Stuffed Hostnames
  const hyphenCount = (hostname.match(/-/g) || []).length;
  if (hyphenCount >= 3) {
    const hasAuthTerm = SENSITIVE_AUTH_KEYWORDS.some((kw) => hostname.includes(kw));
    if (hasAuthTerm) {
      indicators.push({
        code: SuspiciousUrlIndicatorCode.HYPHEN_STUFFED_HOSTNAME,
        severity: 'MEDIUM',
        description: 'Hostname contains multiple hyphens combined with authentication or account terms.',
        scoreContribution: 20,
        matchedPattern: `${hyphenCount} hyphens`,
      });
    }
  }

  // 8. High-Risk TLD paired with Sensitive Keywords
  const tldMatch = hostname.split('.').pop() || '';
  if (HIGH_RISK_TLDS.has(tldMatch)) {
    const hasAuthTerm = SENSITIVE_AUTH_KEYWORDS.some((kw) => hostname.includes(kw));
    if (hasAuthTerm) {
      indicators.push({
        code: SuspiciousUrlIndicatorCode.HIGH_RISK_TLD_KEYWORD,
        severity: 'MEDIUM',
        description: `Domain uses a high-risk TLD (.${tldMatch}) combined with sensitive authentication or financial terms.`,
        scoreContribution: 25,
        matchedPattern: `.${tldMatch}`,
      });
    }
  }

  // 9. Double Encoding & Path Traversal
  if (hasDoubleUrlEncoding(rawUrl)) {
    indicators.push({
      code: SuspiciousUrlIndicatorCode.DOUBLE_URL_ENCODING,
      severity: 'MEDIUM',
      description: 'URL contains double-percent-encoded characters, often used in filter evasion.',
      scoreContribution: 20,
    });
  } else if (hasPathTraversal(rawUrl, components.pathname)) {
    indicators.push({
      code: SuspiciousUrlIndicatorCode.DOUBLE_URL_ENCODING,
      severity: 'MEDIUM',
      description: 'URL contains path traversal sequences.',
      scoreContribution: 20,
    });
  }

  // 10. Uncommon / Suspicious Ports
  if (components.port && !components.isLocalhost && SUSPICIOUS_PORTS.has(components.port)) {
    indicators.push({
      code: SuspiciousUrlIndicatorCode.SUSPICIOUS_PORT,
      severity: 'LOW',
      description: `URL specifies an uncommon port (:${components.port}) for web traffic.`,
      scoreContribution: 10,
      matchedPattern: components.port,
    });
  }

  // Aggregate score calculation bounded between 0 and 100
  const totalScore = indicators.reduce((acc, curr) => acc + curr.scoreContribution, 0);
  const clampedScore = Math.min(100, Math.max(0, totalScore));
  const isSuspicious = clampedScore >= 20 || indicators.length > 0;

  return {
    isSuspicious,
    score: clampedScore,
    components,
    indicators,
    reasons: indicators.map((i) => i.description),
  };
}
