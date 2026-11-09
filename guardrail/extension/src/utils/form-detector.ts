/**
 * Guardrail Form Protection & Destination Validation Engine
 *
 * Implements safe, privacy-preserving, standards-compliant detection of form submission
 * risks, unexpected destinations, cross-origin exfiltration, insecure transport,
 * dynamic destination tampering, and misleading submission controls.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. STRICT PRIVACY INVARIANT: Form input values, passwords, credit card numbers, OTPs,
 *    and raw form contents are NEVER accessed, read, stored, or transmitted.
 *    Only structural metadata (tag name, action URL, method, boolean field presence) is inspected.
 * 2. STANDARDS-BASED PARSING: Uses native Web URL parsing with complete exception isolation.
 * 3. CORRECT ORIGIN COMPARISON: Distinguishes same-origin, same-site (registrable domain),
 *    and cross-origin destinations using effective TLD awareness.
 * 4. BALANCED RISK CLASSIFICATION: Does NOT treat every cross-origin submission as malicious
 *    (e.g., search forms and legitimate SSO/payment providers are permitted).
 *    Does NOT classify every password field as suspicious (benign HTTPS login is permitted).
 * 5. STRUCTURED REASONS: Emits deterministic, machine-readable indicator codes and
 *    plain-language explanations for transparent user advisories and risk engine integration.
 * 6. DETECTION IS NOT INTERCEPTION: Detection identifies risk characteristics; browser
 *    interception is governed strictly by capturing-phase DOM listeners on controlled targets.
 */

import { EvaluationReason, RiskLevel } from '../types/risk.js';
import {
  evaluateSuspiciousUrl,
  extractDomainParts,
  isLocalhostAddress,
  normalizeUrlComponents,
} from './url-detector.js';

/**
 * Canonical indicator codes for supported form safety detections.
 */
export enum FormSafetyIndicatorCode {
  /** Form collecting credentials or sensitive data has missing, empty, or whitespace action */
  FORM_MISSING_DESTINATION = 'FORM_MISSING_DESTINATION',

  /** Form action targets unusual or pseudo-protocols (javascript:, data:, vbscript:, about:blank, #) */
  FORM_UNUSUAL_SCHEME = 'FORM_UNUSUAL_SCHEME',

  /** Form collecting sensitive data or credentials submits across domain boundaries to an unverified external destination */
  FORM_UNEXPECTED_CROSS_ORIGIN = 'FORM_UNEXPECTED_CROSS_ORIGIN',

  /** Form collecting sensitive data or credentials transmits over unencrypted cleartext HTTP */
  FORM_INSECURE_HTTP_DESTINATION = 'FORM_INSECURE_HTTP_DESTINATION',

  /** Form destination points to a suspicious, lookalike, raw IP, or high-risk domain */
  FORM_DECEPTIVE_DESTINATION = 'FORM_DECEPTIVE_DESTINATION',

  /** Form destination targets known third-party form collection / webhook exfiltration sinks */
  FORM_EXFILTRATION_ENDPOINT = 'FORM_EXFILTRATION_ENDPOINT',

  /** Form submission destination was dynamically modified or overridden to a different external origin */
  FORM_DESTINATION_MODIFIED = 'FORM_DESTINATION_MODIFIED',

  /** Form submission control presents a misleading label (e.g. "Cancel", "Back", "Download") contradicting submission */
  FORM_MISLEADING_SUBMISSION = 'FORM_MISLEADING_SUBMISSION',

  /** Form submission destination cannot be reliably parsed or resolved */
  FORM_UNDETERMINED_DESTINATION = 'FORM_UNDETERMINED_DESTINATION',

  /** Form contains password or sensitive input fields (structural indicator) */
  FORM_CONTAINS_SENSITIVE_FIELDS = 'FORM_CONTAINS_SENSITIVE_FIELDS',
}

/**
 * Individual detected form safety indicator.
 */
export interface FormSafetyIndicator {
  /** Unique indicator identifier */
  readonly code: FormSafetyIndicatorCode;

  /** Indicator severity ('LOW' | 'MEDIUM' | 'HIGH') */
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH';

  /** Score weight added to total risk assessment (0-100) */
  readonly scoreWeight: number;

  /** Human-readable explanation of why this indicator was triggered */
  readonly description: string;

  /** Optional category for indicator grouping */
  readonly category?: string;

  /** Safe, non-sensitive contextual evidence (hostnames, schemes, tags; strictly zero input values) */
  readonly evidence?: string;
}

/**
 * Input context for evaluating a form interaction.
 */
export interface FormSafetyEvaluationContext {
  /** Current webpage URL where the form resides */
  readonly pageUrl: string;

  /** Form submission destination URL (resolved or raw) */
  readonly formAction?: string;

  /** Raw unnormalized form action attribute value before URL resolution */
  readonly rawActionAttribute?: string;

  /** HTTP method of the form (e.g. 'POST', 'GET') */
  readonly formMethod?: string;

  /** Structural indicator: true if the form contains a password input control */
  readonly hasPasswordField?: boolean;

  /** Structural indicator: true if the form contains username/email/account input controls */
  readonly hasUsernameField?: boolean;

  /** Structural indicator: true if form contains sensitive data inputs (card, OTP, SSN) */
  readonly hasSensitiveField?: boolean;

  /** Categorical types of sensitive inputs present in the form */
  readonly sensitiveFieldTypes?: readonly string[];

  /** Initial form action declared in HTML when form was first observed in DOM */
  readonly initialFormAction?: string;

  /** True if submit trigger specifies a formaction attribute that overrides the form's action */
  readonly hasFormActionOverride?: boolean;

  /** Visible text on the clicked submit trigger (e.g. button text) for misleading label checks */
  readonly submitButtonText?: string;

  /** Indicates whether the webpage execution environment is a secure context */
  readonly isSecureContext?: boolean;

  /** Allowlisted enterprise domains exempt from external navigation/cross-origin flags */
  readonly trustedDomains?: readonly string[];
}

/**
 * Comprehensive result of evaluating form safety.
 */
export interface FormSafetyEvaluation {
  /** True if one or more significant form security indicators were detected */
  readonly isSuspicious: boolean;

  /** Clamped aggregate risk score contribution (0 to 100) */
  readonly score: number;

  /** Array of specific indicators identified */
  readonly indicators: readonly FormSafetyIndicator[];

  /** Array of human-readable explanation strings */
  readonly reasons: readonly string[];

  /** Structured evaluation reasons for risk engine and explanation integration */
  readonly structuredReasons: readonly EvaluationReason[];

  /** True if submission destination is cross-origin relative to the page */
  readonly isCrossOrigin: boolean;

  /** True if submission destination is strictly same-origin */
  readonly isSameOrigin: boolean;

  /** True if destination is same registrable domain (e.g. subdomain to api) */
  readonly isSameSite: boolean;

  /** True if form action attribute was missing, empty, or whitespace-only */
  readonly isMissingDestination: boolean;

  /** True if form transmits over unencrypted cleartext HTTP */
  readonly isInsecureTransport: boolean;

  /** True if form destination could not be reliably resolved */
  readonly isDestinationUndetermined: boolean;

  /** Normalized destination URL if successfully parsed */
  readonly normalizedDestination?: string;
}

// =============================================================================
// Constants & Knowledge Bases (Local, Privacy-Preserving)
// =============================================================================

/**
 * Common third-party form collection and webhook services used for unauthorized data harvesting.
 */
export const DATA_EXFILTRATION_DOMAINS: readonly string[] = Object.freeze([
  'formspree.io',
  'airform.io',
  'getform.io',
  'formkeep.com',
  'formsubmit.co',
  'formbucket.com',
  'formcarry.com',
  'kwes.io',
  'usebasin.com',
  'formbold.com',
  'fabform.io',
  'pageclip.co',
  '99inbound.com',
  'formbackend.com',
  'webhook.site',
  'pipedream.net',
  'hookbin.com',
  'requestbin.com',
  'beeceptor.com',
  'postb.in',
  'discord.com/api/webhooks',
  'discordapp.com/api/webhooks',
  'telegram.org/bot',
  'api.telegram.org',
]);

/**
 * Recognized Single Sign-On (SSO) and identity providers.
 * Legitimate cross-origin authentication targets.
 */
export const KNOWN_SSO_PROVIDERS: readonly string[] = Object.freeze([
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'github.com',
  'auth.atlassian.com',
  'auth0.com',
  'okta.com',
  'oktapreview.com',
  'onelogin.com',
  'pingidentity.com',
  'amazon.com',
  'facebook.com',
  'linkedin.com',
]);

/**
 * Recognized search engines for benign cross-origin GET queries.
 */
export const KNOWN_SEARCH_DOMAINS: readonly string[] = Object.freeze([
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'yahoo.com',
  'ecosia.org',
  'baidu.com',
]);

/**
 * Recognized payment gateways for legitimate cross-origin checkout submissions.
 */
export const KNOWN_PAYMENT_GATEWAYS: readonly string[] = Object.freeze([
  'checkout.stripe.com',
  'js.stripe.com',
  'paypal.com',
  'sandbox.paypal.com',
  'authorize.net',
  'braintreegateway.com',
  'square.com',
  'squareup.com',
  'adyen.com',
  'worldpay.com',
]);

/**
 * Button labels that suggest cancellation, exit, or non-submitting action,
 * which are deceptive if they actually submit credentials or sensitive forms.
 */
export const MISLEADING_CANCEL_OR_BACK_TERMS: readonly string[] = Object.freeze([
  'cancel',
  'back',
  'close',
  'dismiss',
  'decline',
  'skip',
  'leave',
  'download invoice',
  'download receipt',
  'view statement',
]);

/**
 * Helper to check whether a hostname matches any trusted host or domain suffix.
 */
function isTrustedHost(hostname: string, trustedDomains: readonly string[]): boolean {
  if (!hostname) return false;
  const norm = hostname.toLowerCase().trim();
  return trustedDomains.some((trusted) => {
    const tNorm = trusted.toLowerCase().trim();
    return norm === tNorm || norm.endsWith(`.${tNorm}`);
  });
}

/**
 * Checks whether a hostname matches any entry in a domain list (exact or subdomain match).
 */
function matchesDomainList(hostname: string, domainList: readonly string[]): boolean {
  if (!hostname) return false;
  const norm = hostname.toLowerCase().trim();
  return domainList.some((domain) => {
    const dNorm = domain.toLowerCase().trim();
    return norm === dNorm || norm.endsWith(`.${dNorm}`);
  });
}

/**
 * Checks whether an element's visible text indicates a misleading cancellation or back action.
 */
function isMisleadingSubmitLabel(text: string | undefined): boolean {
  if (!text) return false;
  const cleaned = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return MISLEADING_CANCEL_OR_BACK_TERMS.some((term) => {
    return cleaned === term || cleaned.startsWith(`${term} `) || cleaned.endsWith(` ${term}`);
  });
}

/**
 * Evaluates a form interaction for safety, destination integrity, and privacy compliance.
 *
 * PURE FUNCTION: Zero DOM mutations, zero network requests, zero credential collection.
 *
 * @param context Input context describing the form, page, and submission metadata
 * @returns Strongly typed FormSafetyEvaluation
 */
export function evaluateFormSafety(
  context: FormSafetyEvaluationContext
): FormSafetyEvaluation {
  const indicators: FormSafetyIndicator[] = [];
  const trusted = context.trustedDomains || [];

  // Parse page URL safely
  const pageParsed = normalizeUrlComponents(context.pageUrl);
  const pageHost = pageParsed?.hostname || '';
  const pageProtocol = pageParsed?.protocol || '';
  const pageRegDomain = pageParsed?.registrableDomain || (pageHost ? extractDomainParts(pageHost).registrableDomain : '');
  const isPageLocalhost = Boolean(pageParsed?.isLocalhost || isLocalhostAddress(pageHost));
  const isPageSecure = pageProtocol === 'https:' || context.isSecureContext === true || isPageLocalhost;

  // Sensitive form characteristics (strictly boolean, zero value extraction)
  const isSensitiveForm = Boolean(
    context.hasPasswordField ||
    context.hasSensitiveField ||
    (context.sensitiveFieldTypes && context.sensitiveFieldTypes.length > 0)
  );

  if (isSensitiveForm) {
    indicators.push({
      code: FormSafetyIndicatorCode.FORM_CONTAINS_SENSITIVE_FIELDS,
      category: 'FORM_METADATA',
      severity: 'LOW',
      scoreWeight: 0, // Structural indicator; non-malicious by itself
      description: 'Form contains password, credential, or sensitive input fields.',
      evidence: `sensitiveTypes=${context.sensitiveFieldTypes?.join(',') || (context.hasPasswordField ? 'password' : 'sensitive')}`,
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Missing or Empty Submission Destinations
  // ---------------------------------------------------------------------------
  const rawActionAttr = context.rawActionAttribute !== undefined
    ? context.rawActionAttribute
    : context.formAction;

  const isRawActionMissing =
    context.rawActionAttribute !== undefined
      ? (context.rawActionAttribute === null || context.rawActionAttribute.trim() === '')
      : (context.formAction !== undefined && context.formAction.trim() === '');
  const isHashOnlyAction = Boolean(rawActionAttr && rawActionAttr.trim() === '#');

  let isMissingDestination = false;
  if (isRawActionMissing || isHashOnlyAction) {
    isMissingDestination = true;
    if (isSensitiveForm && !isPageLocalhost) {
      indicators.push({
        code: FormSafetyIndicatorCode.FORM_MISSING_DESTINATION,
        severity: 'MEDIUM',
        scoreWeight: 25,
        description: 'Form collecting credentials or sensitive data lacks an explicit submission destination.',
        evidence: `rawAction=${String(rawActionAttr)}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Unusual & Pseudo-Protocol Action Schemes
  // ---------------------------------------------------------------------------
  let rawActionLower = (rawActionAttr || '').toLowerCase().trim();
  const unusualSchemes = ['javascript:', 'data:', 'vbscript:', 'about:blank', 'blob:', 'file:'];
  const hasUnusualScheme = unusualSchemes.some((scheme) => rawActionLower.startsWith(scheme));

  if (hasUnusualScheme) {
    const matchedScheme = unusualSchemes.find((s) => rawActionLower.startsWith(s)) || 'pseudo:';
    indicators.push({
      code: FormSafetyIndicatorCode.FORM_UNUSUAL_SCHEME,
      severity: 'HIGH',
      scoreWeight: 35,
      description: `Form action targets pseudo-protocol "${matchedScheme}", which can execute inline script or obscure the destination.`,
      evidence: `actionScheme=${matchedScheme}`,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Destination URL Parsing, Resolution & Origin Comparison
  // ---------------------------------------------------------------------------
  const targetActionUrl = context.formAction || context.rawActionAttribute || context.pageUrl || '';
  let formParsed = normalizeUrlComponents(targetActionUrl);
  let isDestinationUndetermined = false;

  // If action is present but failed to parse into valid components
  if (targetActionUrl && !hasUnusualScheme && !isHashOnlyAction && !isRawActionMissing) {
    if (!formParsed || !formParsed.isValid) {
      isDestinationUndetermined = true;
      indicators.push({
        code: FormSafetyIndicatorCode.FORM_UNDETERMINED_DESTINATION,
        severity: 'MEDIUM',
        scoreWeight: 25,
        description: 'Form submission destination URL is malformed or could not be reliably resolved by standard Web parsers.',
        evidence: `targetUrl=${targetActionUrl}`,
      });
    }
  }

  // Compute origin relationships safely
  const formHost = formParsed?.hostname || '';
  const formProtocol = formParsed?.protocol || '';
  const formPort = formParsed?.port || '';
  const formRegDomain = formParsed?.registrableDomain || (formHost ? extractDomainParts(formHost).registrableDomain : '');
  const isFormLocalhost = Boolean(formParsed?.isLocalhost || isLocalhostAddress(formHost));

  const pageOrigin = pageProtocol && pageHost ? `${pageProtocol}//${pageHost}${pageParsed?.port ? `:${pageParsed.port}` : ''}` : '';
  const formOrigin = formProtocol && formHost ? `${formProtocol}//${formHost}${formPort ? `:${formPort}` : ''}` : '';

  const isSameOrigin = Boolean(pageOrigin && formOrigin && pageOrigin === formOrigin);
  const isSameSite = Boolean(pageRegDomain && formRegDomain && pageRegDomain === formRegDomain);
  const isCrossOrigin = Boolean(formOrigin && pageOrigin && !isSameOrigin);

  // ---------------------------------------------------------------------------
  // 4. Insecure Cleartext HTTP Transport
  // ---------------------------------------------------------------------------
  let isInsecureTransport = false;
  if (formProtocol === 'http:' && !isFormLocalhost) {
    isInsecureTransport = true;
    // Condition A: Secure HTTPS page submitting to HTTP action (mixed-content transport downgrade)
    if (isPageSecure) {
      indicators.push({
        code: FormSafetyIndicatorCode.FORM_INSECURE_HTTP_DESTINATION,
        severity: 'HIGH',
        scoreWeight: 35,
        description: `Secure HTTPS webpage submits form data over unencrypted cleartext HTTP (${formHost}), exposing data to network sniffing.`,
        evidence: `pageProtocol=${pageProtocol}, formActionProtocol=${formProtocol}, formHost=${formHost}`,
      });
    } else if (isSensitiveForm) {
      // Condition B: Cleartext page transmitting sensitive fields or passwords
      indicators.push({
        code: FormSafetyIndicatorCode.FORM_INSECURE_HTTP_DESTINATION,
        severity: 'HIGH',
        scoreWeight: 40,
        description: `Form collecting passwords or sensitive information transmits data over unencrypted cleartext HTTP (${formHost}).`,
        evidence: `formHost=${formHost}, formProtocol=${formProtocol}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Deceptive Destinations & Data Exfiltration Sinks
  // ---------------------------------------------------------------------------
  if (formParsed && formParsed.isValid && formHost && !isFormLocalhost) {
    // 5a. Check known data exfiltration services (Formspree, webhooks, etc.)
    const isExfiltrationSink = matchesDomainList(formHost, DATA_EXFILTRATION_DOMAINS) ||
      DATA_EXFILTRATION_DOMAINS.some((sink) => targetActionUrl.toLowerCase().includes(sink));

    if (isExfiltrationSink && !isTrustedHost(formHost, trusted)) {
      indicators.push({
        code: FormSafetyIndicatorCode.FORM_EXFILTRATION_ENDPOINT,
        severity: 'HIGH',
        scoreWeight: 50,
        description: `Form destination points to third-party form collector or webhook service (${formHost}) commonly used for unauthorized data harvesting.`,
        evidence: `destinationHost=${formHost}`,
      });
    }

    // 5b. Check deceptive domain naming, homoglyphs, IP addresses, or high-risk TLDs
    const suspiciousEval = evaluateSuspiciousUrl(formParsed.normalizedUrl || targetActionUrl);
    if (suspiciousEval.isSuspicious) {
      const hasDeceptiveCharacteristics = suspiciousEval.indicators.some((ind) =>
        ind.code === 'IP_ADDRESS_HOSTNAME' ||
        ind.code === 'DECEPTIVE_SUBDOMAIN' ||
        ind.code === 'PUNYCODE_OR_HOMOGLYPH' ||
        ind.code === 'HIGH_RISK_TLD_KEYWORD' ||
        ind.code === 'HYPHEN_STUFFED_HOSTNAME'
      );

      if (hasDeceptiveCharacteristics && !isTrustedHost(formHost, trusted)) {
        indicators.push({
          code: FormSafetyIndicatorCode.FORM_DECEPTIVE_DESTINATION,
          severity: 'HIGH',
          scoreWeight: 35,
          description: `Form destination domain "${formHost}" exhibits suspicious characteristics: ${suspiciousEval.reasons.join('; ')}.`,
          evidence: `destinationHost=${formHost}, indicators=${suspiciousEval.indicators.map((i) => i.code).join(',')}`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Cross-Origin Form Submissions (Balanced Evaluation)
  // ---------------------------------------------------------------------------
  if (isCrossOrigin && !isSameSite && formHost && !isFormLocalhost) {
    const isLegitSso = matchesDomainList(formHost, KNOWN_SSO_PROVIDERS);
    const isLegitSearch = (context.formMethod || 'GET').toUpperCase() === 'GET' &&
      !isSensitiveForm &&
      matchesDomainList(formHost, KNOWN_SEARCH_DOMAINS);
    const isLegitPayment = matchesDomainList(formHost, KNOWN_PAYMENT_GATEWAYS);
    const isAllowedThirdParty = isLegitSso || isLegitSearch || isLegitPayment || isTrustedHost(formHost, trusted);

    if (!isAllowedThirdParty) {
      // Sensitive forms submitting to unknown third parties are flagged
      if (isSensitiveForm) {
        indicators.push({
          code: FormSafetyIndicatorCode.FORM_UNEXPECTED_CROSS_ORIGIN,
          severity: 'HIGH',
          scoreWeight: 40,
          description: `Form collecting credentials or sensitive data submits across domain boundaries to unverified third party "${formHost}" (page is hosted on "${pageHost}").`,
          evidence: `pageDomain=${pageRegDomain || pageHost}, formDomain=${formRegDomain || formHost}`,
        });
      } else if ((context.formMethod || 'GET').toUpperCase() === 'POST') {
        // Non-sensitive POST to unknown third party receives an informational advisory (score 15)
        indicators.push({
          code: FormSafetyIndicatorCode.FORM_UNEXPECTED_CROSS_ORIGIN,
          severity: 'LOW',
          scoreWeight: 15,
          description: `Form submits data via POST to an external third-party domain "${formHost}".`,
          evidence: `pageDomain=${pageRegDomain || pageHost}, formDomain=${formRegDomain || formHost}`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Dynamic Destination Modifications & Button Overrides
  // ---------------------------------------------------------------------------
  if (context.initialFormAction && context.formAction) {
    const initialParsed = normalizeUrlComponents(context.initialFormAction);
    const currentParsed = formParsed;

    if (initialParsed?.isValid && currentParsed?.isValid) {
      const initialHost = initialParsed.hostname || '';
      const currentHost = currentParsed.hostname || '';

      // If initial was same-origin or same-site, but current was modified to a different external host
      const wasSameSite = Boolean(pageRegDomain && initialParsed.registrableDomain === pageRegDomain);
      const isNowDifferent = Boolean(currentParsed.registrableDomain && currentParsed.registrableDomain !== initialParsed.registrableDomain);

      if (wasSameSite && isNowDifferent && !isFormLocalhost && !isTrustedHost(currentHost, trusted)) {
        indicators.push({
          code: FormSafetyIndicatorCode.FORM_DESTINATION_MODIFIED,
          severity: 'HIGH',
          scoreWeight: 35,
          description: `Form submission destination was dynamically redirected from "${initialHost}" to a different external origin "${currentHost}".`,
          evidence: `initialHost=${initialHost}, modifiedHost=${currentHost}`,
        });
      }
    }
  }

  // Also check if button formaction overrides the form's action across origins
  if (context.hasFormActionOverride) {
    const overrideCandidate = context.formAction || context.rawActionAttribute || '';
    const overrideParsed = normalizeUrlComponents(overrideCandidate);
    const overrideHost = overrideParsed?.hostname || formHost;
    const isOverrideCrossOrigin = overrideParsed?.hostname
      ? Boolean(pageHost && overrideParsed.hostname !== pageHost)
      : isCrossOrigin;
    const isOverrideSameSite = overrideParsed?.registrableDomain
      ? Boolean(pageRegDomain && overrideParsed.registrableDomain === pageRegDomain)
      : isSameSite;

    if (isOverrideCrossOrigin && !isOverrideSameSite && overrideHost && !isLocalhostAddress(overrideHost)) {
      const isOverrideTrusted = isTrustedHost(overrideHost, trusted) || matchesDomainList(overrideHost, KNOWN_SSO_PROVIDERS);
      if (!isOverrideTrusted && isSensitiveForm) {
        const alreadyFlaggedModified = indicators.some((ind) => ind.code === FormSafetyIndicatorCode.FORM_DESTINATION_MODIFIED);
        if (!alreadyFlaggedModified) {
          indicators.push({
            code: FormSafetyIndicatorCode.FORM_DESTINATION_MODIFIED,
            severity: 'MEDIUM',
            scoreWeight: 25,
            description: `Submit button overrides form destination using formaction attribute targeting external origin "${overrideHost}".`,
            evidence: `overrideHost=${overrideHost}`,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Misleading Submission Controls & Button Labels
  // ---------------------------------------------------------------------------
  if (context.submitButtonText && isMisleadingSubmitLabel(context.submitButtonText)) {
    if (isSensitiveForm || (context.formMethod || 'GET').toUpperCase() === 'POST') {
      indicators.push({
        code: FormSafetyIndicatorCode.FORM_MISLEADING_SUBMISSION,
        severity: 'MEDIUM',
        scoreWeight: 30,
        description: `Submit control presents a misleading label ("${context.submitButtonText}") suggesting cancellation or document retrieval, but triggers a data-submitting form.`,
        evidence: `buttonText=${context.submitButtonText}, method=${context.formMethod || 'GET'}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Aggregation & Clamping
  // ---------------------------------------------------------------------------
  // Only indicators with scoreWeight > 0 contribute to risk score
  const activeIndicators = indicators.filter((ind) => ind.scoreWeight > 0);
  const totalScore = activeIndicators.reduce((sum, ind) => sum + ind.scoreWeight, 0);
  const score = Math.min(100, Math.max(0, totalScore));
  const isSuspicious = activeIndicators.length > 0;

  const reasons = activeIndicators.map((ind) => ind.description);

  const structuredReasons: EvaluationReason[] = activeIndicators.map((ind) => ({
    code: `INDICATOR_${ind.code}`,
    message: ind.description,
    ruleId: 'RISK_RULE_FORM_DESTINATION',
    signalId: 'PHISHING_INDICATOR' as any,
    severity: ind.severity === 'HIGH' ? RiskLevel.HIGH : ind.severity === 'MEDIUM' ? RiskLevel.MEDIUM : RiskLevel.LOW,
    scoreContribution: ind.scoreWeight,
  }));

  return {
    isSuspicious,
    score,
    indicators: Object.freeze(indicators),
    reasons: Object.freeze(reasons),
    structuredReasons: Object.freeze(structuredReasons),
    isCrossOrigin,
    isSameOrigin,
    isSameSite,
    isMissingDestination,
    isInsecureTransport,
    isDestinationUndetermined,
    normalizedDestination: formParsed?.normalizedUrl,
  };
}
