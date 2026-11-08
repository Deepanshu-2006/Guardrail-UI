/**
 * Guardrail Phishing & Deceptive Website Detection Engine
 *
 * Implements multi-indicator heuristic detection for deceptive websites,
 * brand identity inconsistencies, insecure login contexts, and suspicious form exfiltration.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. MULTI-INDICATOR CORROBORATION: Evaluates compound risk characteristics; never flags
 *    an action based on a single weak or ambiguous signal (e.g., standard login form on HTTPS is benign).
 * 2. ZERO PRIVACY INTRUSION: Inspects structural DOM attributes and metadata only.
 *    STRICTLY NEVER accesses, reads, logs, or transmits user-entered values, passwords, or cards.
 * 3. HEURISTIC TRANSPARENCY: Clearly separates local structural heuristics from verified threat
 *    intelligence feeds; never claims universal or infallible protection.
 * 4. STANDARDS COMPLIANCE: Uses native Web URL parsing with strict exception isolation.
 */

import { EvaluationReason, RiskLevel } from '../types/risk.js';
import {
  evaluateSuspiciousUrl,
  extractDomainParts,
  isIpv4Address,
  isIpv6Address,
  isLocalhostAddress,
  normalizeUrlComponents,
} from './url-detector.js';

/**
 * Checks whether a hostname is a non-loopback public IP address.
 */
function isPublicIp(hostname: string): boolean {
  return (isIpv4Address(hostname) || isIpv6Address(hostname)) && !isLocalhostAddress(hostname);
}

/**
 * Canonical indicator codes for supported heuristic phishing detections.
 * Prefixed with HEURISTIC_ to explicitly distinguish local behavioural heuristics
 * from external, verified threat intelligence feeds.
 */
export enum PhishingIndicatorCode {
  /** Page title or meta branding claims a brand identity that conflicts with the hosting domain */
  BRAND_IDENTITY_MISMATCH = 'HEURISTIC_BRAND_IDENTITY_MISMATCH',

  /** External favicon or logo asset is loaded directly from a recognized brand's CDN on an unrelated host */
  DECEPTIVE_ASSET_ORIGIN = 'HEURISTIC_DECEPTIVE_ASSET_ORIGIN',

  /** Target domain contains deceptive brand tokens or lookalike patterns */
  DECEPTIVE_HOSTNAME_PATTERN = 'HEURISTIC_DECEPTIVE_HOSTNAME_PATTERN',

  /** Password or credential input field presented over an unencrypted, non-secure context (HTTP) */
  INSECURE_LOGIN_CONTEXT = 'HEURISTIC_INSECURE_LOGIN_CONTEXT',

  /** Password or login form hosted on a raw public IP address rather than a domain name */
  IP_HOSTED_LOGIN = 'HEURISTIC_IP_HOSTED_LOGIN',

  /** Credential input field present on a website exhibiting conflicting brand identity */
  UNEXPECTED_CREDENTIAL_FIELD = 'HEURISTIC_UNEXPECTED_CREDENTIAL_FIELD',

  /** Form with password fields submits across domain boundaries to an unrelated third party */
  CROSS_ORIGIN_CREDENTIAL_SUBMISSION = 'HEURISTIC_CROSS_ORIGIN_CREDENTIAL_SUBMISSION',

  /** Form destination points to known third-party form collection / webhook exfiltration endpoints */
  EXFILTRATION_ENDPOINT = 'HEURISTIC_DATA_EXFILTRATION_ENDPOINT',

  /** Form collecting sensitive credentials submits to an insecure (HTTP) destination */
  INSECURE_CREDENTIAL_TRANSMISSION = 'HEURISTIC_INSECURE_CREDENTIAL_TRANSMISSION',

  /** Form action uses pseudo-protocols such as javascript: or data: */
  SUSPICIOUS_FORM_ACTION = 'HEURISTIC_SUSPICIOUS_FORM_ACTION',
}

/**
 * Categorical grouping for heuristic phishing indicators.
 */
export type PhishingIndicatorCategory =
  | 'IDENTITY'
  | 'LOGIN_CONTEXT'
  | 'FORM_DESTINATION'
  | 'DOMAIN_NAMING'
  | 'INSECURE_TRANSPORT';

/**
 * Individual detected heuristic indicator.
 */
export interface PhishingIndicator {
  /** Unique indicator identifier */
  readonly code: PhishingIndicatorCode;

  /** Category of the indicator */
  readonly category: PhishingIndicatorCategory;

  /** Numerical score contribution (0-100) */
  readonly scoreWeight: number;

  /** Human-readable explanation of why this indicator fired */
  readonly description: string;

  /** Safe, non-sensitive contextual evidence (e.g. hostnames, schemes; strictly zero passwords) */
  readonly evidence?: string;
}

/**
 * Input context for evaluating a page or form interaction for phishing indicators.
 */
export interface PhishingEvaluationContext {
  /** Full URL of the active webpage */
  readonly pageUrl: string;

  /** Visible document title */
  readonly pageTitle?: string;

  /** Website branding name from meta tags (e.g., og:site_name, application-name) */
  readonly pageMetaBranding?: string;

  /** Favicon URL extracted safely from link[rel~="icon"] */
  readonly faviconUrl?: string;

  /** Form action destination URL (if target is a form or submit trigger) */
  readonly formAction?: string;

  /** HTTP method of the form (e.g. 'POST', 'GET') */
  readonly formMethod?: string;

  /** Structural boolean: true if form contains a password field */
  readonly hasPasswordField?: boolean;

  /** Structural boolean: true if form contains username/email/account fields */
  readonly hasUsernameField?: boolean;

  /** Destination URL if interaction is an anchor or actionable link */
  readonly targetUrl?: string;

  /** Whether the webpage environment is considered a secure context */
  readonly isSecureContext?: boolean;

  /** List of user-configured or enterprise trusted domains */
  readonly trustedDomains?: readonly string[];
}

/**
 * Comprehensive detection result from the Phishing & Deceptive Website Engine.
 */
export interface PhishingDetectionResult {
  /** Whether the combined compound signals exceed the heuristic suspicion threshold */
  readonly isPhishingSuspected: boolean;

  /** Clamped overall composite risk score (0 to 100) */
  readonly score: number;

  /** Confidence level of the heuristic assessment */
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH';

  /** Ordered list of triggered heuristic indicators */
  readonly indicators: readonly PhishingIndicator[];

  /** Human-readable summary explanations */
  readonly reasons: readonly string[];

  /** Structured, machine-readable reasons suitable for RiskAssessment */
  readonly structuredReasons: readonly EvaluationReason[];

  /** Mandatory architectural disclaimer clarifying heuristic scope */
  readonly disclaimer: string;
}

/**
 * Well-known brand registry mapping brand identifiers to legitimate registrable domains
 * and recognizable title tokens for heuristic identity consistency checks.
 */
interface BrandIdentityDefinition {
  readonly brandName: string;
  readonly titleKeywords: readonly string[];
  readonly legitimateDomains: readonly string[];
  readonly assetDomains?: readonly string[];
}

const RECOGNIZED_BRANDS: readonly BrandIdentityDefinition[] = Object.freeze([
  {
    brandName: 'PayPal',
    titleKeywords: ['paypal'],
    legitimateDomains: ['paypal.com', 'paypal.me'],
    assetDomains: ['paypalobjects.com'],
  },
  {
    brandName: 'Microsoft',
    titleKeywords: ['microsoft', 'office 365', 'outlook', 'onedrive', 'azure'],
    legitimateDomains: [
      'microsoft.com',
      'live.com',
      'office.com',
      'outlook.com',
      'microsoftonline.com',
      'windows.com',
      'azure.com',
    ],
    assetDomains: ['microsoft.com', 'live.com', 'msftauth.net'],
  },
  {
    brandName: 'Google',
    titleKeywords: ['google', 'gmail', 'google account', 'google drive'],
    legitimateDomains: [
      'google.com',
      'google.co.uk',
      'google.de',
      'google.fr',
      'google.ca',
      'google.com.au',
      'youtube.com',
      'gmail.com',
    ],
    assetDomains: ['google.com', 'gstatic.com', 'googleusercontent.com'],
  },
  {
    brandName: 'Apple',
    titleKeywords: ['apple id', 'icloud', 'apple account', 'apple support'],
    legitimateDomains: ['apple.com', 'icloud.com'],
    assetDomains: ['apple.com', 'icloud.com', 'apple-dns.net'],
  },
  {
    brandName: 'Amazon',
    titleKeywords: ['amazon', 'amazon prime', 'amazon aws'],
    legitimateDomains: [
      'amazon.com',
      'amazon.co.uk',
      'amazon.de',
      'amazon.ca',
      'amazon.co.jp',
      'aws.amazon.com',
    ],
    assetDomains: ['amazon.com', 'images-amazon.com', 'ssl-images-amazon.com'],
  },
  {
    brandName: 'Chase Bank',
    titleKeywords: ['chase', 'chase bank', 'chase online'],
    legitimateDomains: ['chase.com'],
  },
  {
    brandName: 'Bank of America',
    titleKeywords: ['bank of america', 'bofa'],
    legitimateDomains: ['bankofamerica.com'],
  },
  {
    brandName: 'Wells Fargo',
    titleKeywords: ['wells fargo'],
    legitimateDomains: ['wellsfargo.com'],
  },
  {
    brandName: 'Netflix',
    titleKeywords: ['netflix'],
    legitimateDomains: ['netflix.com'],
    assetDomains: ['nflxext.com', 'nflximg.net'],
  },
  {
    brandName: 'Facebook / Meta',
    titleKeywords: ['facebook', 'meta'],
    legitimateDomains: ['facebook.com', 'fb.com', 'meta.com'],
    assetDomains: ['facebook.com', 'fbcdn.net'],
  },
  {
    brandName: 'GitHub',
    titleKeywords: ['github'],
    legitimateDomains: ['github.com'],
    assetDomains: ['github.com', 'githubassets.com'],
  },
]);

/**
 * Recognized third-party Single Sign-On (SSO) authentication destinations
 * that legitimately receive cross-origin form submissions or OAuth hops.
 */
const KNOWN_SSO_PROVIDERS: readonly string[] = Object.freeze([
  'accounts.google.com',
  'login.microsoftonline.com',
  'appleid.apple.com',
  'auth0.com',
  'okta.com',
  'cognito-idp.amazonaws.com',
  'github.com',
  'facebook.com',
]);

/**
 * Known third-party form collection endpoints and webhook services commonly abused for data harvesting.
 */
const DATA_EXFILTRATION_DOMAINS: readonly string[] = Object.freeze([
  'formspree.io',
  'formsubmit.co',
  'discord.com/api/webhooks',
  'webhook.site',
  'pipedream.net',
  'freeform.my',
  'getform.io',
  'herotofu.com',
  'formkeep.com',
]);

/**
 * Default heuristic disclaimer.
 */
export const PHISHING_HEURISTIC_DISCLAIMER =
  'Heuristic risk assessment based on local DOM structure, transport context, and domain consistency. Not a confirmed threat intelligence feed; does not certify safety of unmarked sites.';

/**
 * Helper to test if a hostname matches any configured trusted domain or suffix.
 */
function isTrustedHost(hostname: string, trustedDomains: readonly string[]): boolean {
  const norm = hostname.toLowerCase().trim();
  return trustedDomains.some((trusted) => {
    const tNorm = trusted.toLowerCase().trim();
    return norm === tNorm || norm.endsWith(`.${tNorm}`);
  });
}

/**
 * Evaluates a webpage and interaction context for supported phishing and deceptive website indicators.
 *
 * Guarantees:
 * 1. Safe, non-invasive execution: zero credential access or capture.
 * 2. Multi-indicator corroboration: routine login forms on HTTPS are NOT flagged.
 * 3. Deterministic, explainable scoring and structured reasons.
 *
 * @param context Input context describing the page and target interaction
 * @returns Strongly typed PhishingDetectionResult
 */
export function evaluatePhishingIndicators(
  context: PhishingEvaluationContext
): PhishingDetectionResult {
  const indicators: PhishingIndicator[] = [];
  const trusted = context.trustedDomains || [];

  // Parse current page URL safely
  const pageParsed = normalizeUrlComponents(context.pageUrl);
  const pageHost = pageParsed?.hostname || '';
  const pageProtocol = pageParsed?.protocol || '';
  const pageRegDomain = pageParsed?.registrableDomain || (pageHost ? extractDomainParts(pageHost).registrableDomain : '');

  // Determine if page itself is local loopback (localhost, 127.0.0.1, ::1)
  const isLocalhost = Boolean(pageParsed?.isLocalhost || isLocalhostAddress(pageHost));

  // ---------------------------------------------------------------------------
  // 1. Website Identity & Branding Inconsistency Checks
  // ---------------------------------------------------------------------------
  const titleText = (context.pageTitle || '').toLowerCase();
  const metaBranding = (context.pageMetaBranding || '').toLowerCase();
  const combinedBrandingText = `${titleText} ${metaBranding}`.trim();

  if (combinedBrandingText && pageRegDomain && !isLocalhost) {
    for (const brand of RECOGNIZED_BRANDS) {
      const claimsBrand = brand.titleKeywords.some((kw) => combinedBrandingText.includes(kw));
      if (claimsBrand) {
        const isLegitDomain = brand.legitimateDomains.some(
          (legit) => pageRegDomain === legit || pageHost.endsWith(`.${legit}`)
        );

        if (!isLegitDomain && !isTrustedHost(pageHost, trusted)) {
          indicators.push({
            code: PhishingIndicatorCode.BRAND_IDENTITY_MISMATCH,
            category: 'IDENTITY',
            scoreWeight: 35,
            description: `Page branding or title claims identity of "${brand.brandName}", but hosting domain "${pageHost}" is not associated with this organization.`,
            evidence: `claimedBrand=${brand.brandName}, actualHost=${pageHost}`,
          });

          // If the page also has a password field, this is an unexpected credential collection form!
          if (context.hasPasswordField) {
            indicators.push({
              code: PhishingIndicatorCode.UNEXPECTED_CREDENTIAL_FIELD,
              category: 'IDENTITY',
              scoreWeight: 30,
              description: `Credential collection input (password) detected on a website displaying conflicting identity for "${brand.brandName}".`,
              evidence: `claimedBrand=${brand.brandName}, host=${pageHost}`,
            });
          }
          break; // Avoid multi-brand spam
        }
      }
    }
  }

  // Check deceptive asset origin (e.g. Favicon pointing to brand CDN from foreign host)
  if (context.faviconUrl && pageRegDomain && !isLocalhost) {
    const iconParsed = normalizeUrlComponents(context.faviconUrl);
    if (iconParsed?.hostname) {
      const iconRegDomain = iconParsed.registrableDomain || extractDomainParts(iconParsed.hostname).registrableDomain;
      for (const brand of RECOGNIZED_BRANDS) {
        const isBrandAsset =
          brand.assetDomains?.some((ad) => iconParsed.hostname.endsWith(ad)) ||
          brand.legitimateDomains.some((ld) => iconRegDomain === ld);

        const isPageLegit = brand.legitimateDomains.some((ld) => pageRegDomain === ld);

        if (isBrandAsset && !isPageLegit && !isTrustedHost(pageHost, trusted)) {
          indicators.push({
            code: PhishingIndicatorCode.DECEPTIVE_ASSET_ORIGIN,
            category: 'IDENTITY',
            scoreWeight: 20,
            description: `Website loads official brand icon/asset from "${iconParsed.hostname}" while hosted on unrelated domain "${pageHost}".`,
            evidence: `assetHost=${iconParsed.hostname}, pageHost=${pageHost}`,
          });
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Deceptive Domain Naming & Lookalike Targeting
  // ---------------------------------------------------------------------------
  const urlEvalTarget = context.pageUrl;
  const suspiciousUrlResult = evaluateSuspiciousUrl(urlEvalTarget);

  if (suspiciousUrlResult.isSuspicious) {
    // If deceptive subdomain or punycode is present, flag as deceptive hostname pattern
    const hasDeceptiveNaming = suspiciousUrlResult.indicators.some(
      (ind) =>
        ind.code === 'DECEPTIVE_SUBDOMAIN' ||
        ind.code === 'PUNYCODE_OR_HOMOGLYPH' ||
        ind.code === 'HIGH_RISK_TLD_KEYWORD' ||
        ind.code === 'DOUBLE_URL_ENCODING'
    );

    if (hasDeceptiveNaming) {
      indicators.push({
        code: PhishingIndicatorCode.DECEPTIVE_HOSTNAME_PATTERN,
        category: 'DOMAIN_NAMING',
        scoreWeight: 35,
        description: `Target domain exhibits deceptive lookalike naming, homoglyphs, or spoofed subdomain prefixes.`,
        evidence: suspiciousUrlResult.reasons.join('; '),
      });

      if (context.hasPasswordField) {
        indicators.push({
          code: PhishingIndicatorCode.UNEXPECTED_CREDENTIAL_FIELD,
          category: 'IDENTITY',
          scoreWeight: 30,
          description: `Credential collection input (password) detected on a website with deceptive domain naming.`,
          evidence: `url=${urlEvalTarget}`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Suspicious Login-Page & Insecure Context Characteristics
  // ---------------------------------------------------------------------------
  const isHttpProtocol = pageProtocol === 'http:';
  const isInsecure = isHttpProtocol || context.isSecureContext === false;

  // Credential input field on cleartext HTTP (Insecure Login Context)
  if (context.hasPasswordField && isInsecure && !isLocalhost) {
    indicators.push({
      code: PhishingIndicatorCode.INSECURE_LOGIN_CONTEXT,
      category: 'INSECURE_TRANSPORT',
      scoreWeight: 40,
      description: `Password input field present on an unencrypted (HTTP) page context, exposing credentials to cleartext interception.`,
      evidence: `protocol=${pageProtocol}, isSecureContext=${context.isSecureContext ?? false}`,
    });
  }

  // Credential input on raw public IP address
  if (context.hasPasswordField && isPublicIp(pageHost)) {
    indicators.push({
      code: PhishingIndicatorCode.IP_HOSTED_LOGIN,
      category: 'LOGIN_CONTEXT',
      scoreWeight: 40,
      description: `Credential entry form hosted directly on a raw public IP address (${pageHost}) rather than a verified domain name.`,
      evidence: `ipHost=${pageHost}`,
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Suspicious Form Submission Destinations & Exfiltration
  // ---------------------------------------------------------------------------
  if (context.formAction) {
    const rawAction = context.formAction.trim();
    const actionLower = rawAction.toLowerCase();

    // 4a. Suspicious pseudo-protocols
    if (
      actionLower.startsWith('javascript:') ||
      actionLower.startsWith('data:') ||
      actionLower.startsWith('about:blank')
    ) {
      indicators.push({
        code: PhishingIndicatorCode.SUSPICIOUS_FORM_ACTION,
        category: 'FORM_DESTINATION',
        scoreWeight: 35,
        description: `Form action targets pseudo-protocol "${rawAction.split(':')[0]}:", which can execute arbitrary script or obscure destination.`,
        evidence: `action=${rawAction}`,
      });
    }

    const formParsed = normalizeUrlComponents(rawAction);
    if (formParsed && formParsed.isValid) {
      const formHost = formParsed.hostname || '';
      const formProtocol = formParsed.protocol || '';
      const formRegDomain = formParsed.registrableDomain || (formHost ? extractDomainParts(formHost).registrableDomain : '');

      // 4b. Insecure credential transmission (HTTPS page submitting credentials to HTTP action)
      if (
        context.hasPasswordField &&
        formProtocol === 'http:' &&
        pageProtocol === 'https:' &&
        !isLocalhost
      ) {
        indicators.push({
          code: PhishingIndicatorCode.INSECURE_CREDENTIAL_TRANSMISSION,
          category: 'INSECURE_TRANSPORT',
          scoreWeight: 35,
          description: `Form collecting password transmits data over unencrypted HTTP endpoint (${formHost}), downgrading transport security.`,
          evidence: `formAction=${formParsed.normalizedUrl}`,
        });
      }

      // 4c. Data exfiltration endpoints (Formspree, webhooks, form harvesters)
      const isExfiltrationEndpoint = DATA_EXFILTRATION_DOMAINS.some(
        (exfil) => formHost === exfil || formHost.endsWith(`.${exfil}`) || rawAction.includes(exfil)
      );

      if (isExfiltrationEndpoint && !isTrustedHost(formHost, trusted)) {
        indicators.push({
          code: PhishingIndicatorCode.EXFILTRATION_ENDPOINT,
          category: 'FORM_DESTINATION',
          scoreWeight: 45,
          description: `Form destination points to third-party form collector or webhook service (${formHost}) commonly used for unauthorized data exfiltration.`,
          evidence: `destinationHost=${formHost}`,
        });
      }

      // 4d. Unexpected cross-origin credential submission
      if (
        context.hasPasswordField &&
        formRegDomain &&
        pageRegDomain &&
        formRegDomain !== pageRegDomain &&
        !isLocalhost
      ) {
        const isLegitSso = KNOWN_SSO_PROVIDERS.some(
          (sso) => formHost === sso || formHost.endsWith(`.${sso}`)
        );

        if (!isLegitSso && !isTrustedHost(formHost, trusted)) {
          indicators.push({
            code: PhishingIndicatorCode.CROSS_ORIGIN_CREDENTIAL_SUBMISSION,
            category: 'FORM_DESTINATION',
            scoreWeight: 40,
            description: `Password form submits across domain boundaries to unrelated destination "${formHost}" (page is hosted on "${pageHost}").`,
            evidence: `pageDomain=${pageRegDomain}, formDomain=${formRegDomain}`,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Multi-Indicator Corroboration & Verdict Computation
  // ---------------------------------------------------------------------------
  // Sum weights from unique triggered indicators
  const totalRawScore = indicators.reduce((sum, ind) => sum + ind.scoreWeight, 0);
  const score = Math.min(100, Math.max(0, totalRawScore));

  // MULTI-INDICATOR REQUIREMENT:
  // An action is suspected of phishing if:
  // - It exhibits at least 1 high-confidence indicator (scoreWeight >= 40, such as INSECURE_LOGIN_CONTEXT, IP_HOSTED_LOGIN, EXFILTRATION_ENDPOINT, or CROSS_ORIGIN_CREDENTIAL_SUBMISSION), OR
  // - It exhibits 2 or more corroborated indicators totaling >= 35 score points (e.g. BRAND_IDENTITY_MISMATCH + DECEPTIVE_ASSET_ORIGIN = 55).
  // A routine login form on HTTPS with same-origin submission triggers 0 indicators and scores 0.
  const hasHighConfidenceIndicator = indicators.some((ind) => ind.scoreWeight >= 35);
  const isCorroborated = indicators.length >= 2 && score >= 35;
  const isPhishingSuspected = hasHighConfidenceIndicator || isCorroborated;

  let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  if (score >= 60 || indicators.length >= 2) {
    confidence = 'HIGH';
  } else if (score >= 35) {
    confidence = 'MEDIUM';
  }

  const reasons = indicators.map((ind) => ind.description);
  const structuredReasons: EvaluationReason[] = indicators.map((ind) => ({
    code: ind.code,
    message: ind.description,
    ruleId: 'RISK_RULE_PHISHING_INDICATOR',
    severity: ind.scoreWeight >= 35 ? RiskLevel.HIGH : RiskLevel.MEDIUM,
    scoreContribution: ind.scoreWeight,
  }));

  return {
    isPhishingSuspected,
    score,
    confidence,
    indicators,
    reasons,
    structuredReasons,
    disclaimer: PHISHING_HEURISTIC_DISCLAIMER,
  };
}
