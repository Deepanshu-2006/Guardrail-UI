/**
 * Guardrail Canonical Risk Policies
 *
 * Implements concrete, verifiable risk policies for interaction types that the
 * current Guardrail browser extension architecture can reliably detect and enforce.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. METADATA GROUNDING: Policies evaluate verifiable metadata (ActionType, element tags,
 *    visible text, IDs, class names, origin boundaries). They NEVER guess user or website intent.
 * 2. ZERO PRIVACY INTRUSION: Form input values, passwords, card numbers, and OTPs are never
 *    accessed or inspected.
 * 3. NO UNSUPPORTED CLAIMS: Warnings are user friction advisories, NOT proof of fraud or malice.
 *    ALLOW decisions indicate absence of elevated triggers, NOT a safety certification.
 * 4. DETERMINISTIC ENFORCEMENT: For controlled test actions, PROTECT strictly halts DOM execution,
 *    enters Staging Mode, and requires backend authorization + explicit user confirmation.
 */

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import {
  PolicyEvaluationResult,
  RiskPolicyDefinition,
  RiskPolicyId,
} from '../types/policy.js';
import { ResponseAction } from '../types/response.js';
import { RiskAssessment, RiskLevel } from '../types/risk.js';
import {
  getCriticalThresholdScore,
  getRoutineThresholdMax,
  isTrustedDomain,
  getActivePolicyConfig,
} from '../config/registry.js';
import { GuardrailPolicyConfig } from '../types/config.js';
import { matchesAnyPhrase } from '../classifier/rules.js';

/**
 * Extracts searchable text tokens strictly from the interactive DOM element.
 * Never includes page.title, page.url pathname, or element.className.
 */
function extractTokens(action: GuardrailAction): string[] {
  const tokens: string[] = [];
  const elem = action.element || (action as any).target;
  const visibleText = elem?.visibleText || (elem as any)?.text;
  if (visibleText && typeof visibleText === 'string' && visibleText.trim().length > 0) {
    tokens.push(visibleText.trim());
  }
  if (elem?.ariaLabel && typeof elem.ariaLabel === 'string' && elem.ariaLabel.trim().length > 0) {
    tokens.push(elem.ariaLabel.trim());
  }
  const elemId = elem?.id || (elem as any)?.elementId;
  if (tokens.length === 0 && elemId && typeof elemId === 'string' && elemId.trim().length > 0) {
    tokens.push(elemId.replace(/[-_]/g, ' ').trim());
  }
  return tokens;
}

function hasAnyToken(tokens: string[], keywords: string[]): boolean {
  return matchesAnyPhrase(tokens, keywords).matched;
}

/**
 * Helper to test if an element is a link or anchor.
 */
function isLinkAction(action: GuardrailAction): boolean {
  return action.element?.tagName === 'A' || action.type === ActionType.NAVIGATION;
}

/**
 * -----------------------------------------------------------------------------
 * 1. CONTROLLED DESTRUCTIVE ACTION POLICY
 * -----------------------------------------------------------------------------
 */
export const CONTROLLED_DESTRUCTIVE_POLICY: RiskPolicyDefinition = Object.freeze({
  id: RiskPolicyId.CONTROLLED_DESTRUCTIVE,
  name: 'Controlled Irreversible / Destructive Action Policy',
  description:
    'Identifies high-impact destructive interactions (account deletion, permanent purges, cancellations) and routes them into the controlled Staging Mode workflow.',
  supportedActionTypes: [ActionType.CLICK],
  evidenceRequirement:
    'Action type must be CLICK. The targeted element or classification must contain explicit destructive tokens (e.g. "delete", "remove", "purge", "close account", "terminate") or category DESTRUCTIVE.',
  decision: ResponseAction.PROTECT,
  userExplanation:
    'Protective mechanism required: Irreversible destructive action detected on target element. Staging Mode initiated to require trusted-contact authorization before execution.',
  ruleId: 'RULE_CONTROLLED_DESTRUCTIVE',
  downstreamBehavior:
    'Enters Staging Mode: Halts event propagation immediately via capturing-phase preventDefault() and stopImmediatePropagation(). Transitions action to HELD in InterceptionController, creates an InterceptionRecord, binds to backend approval request, and opens Staging Modal. Action cannot continue without backend confirmation and explicit user confirmation.',
  limitations: {
    falsePositives:
      'May trigger on benign delete actions, such as deleting a draft email, removing a search tag, or clearing non-sensitive UI filters.',
    falseNegatives:
      'Will not trigger on icon-only delete buttons that lack visible text, accessible names (aria-label), or identifiable IDs/classes.',
    architecturalConstraints:
      'Can only be reliably halted when targeted elements are within reach of the content script DOM capturing-phase listener. Actions in detached native browser dialogs (e.g., window.confirm) cannot be intercepted.',
  },
  appliesTo: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): boolean => {
    if (action.type !== ActionType.CLICK) return false;
    const tokens = extractTokens(action);
    const hasDestructiveToken =
      action.category === ActionCategory.DESTRUCTIVE ||
      action.category === ActionCategory.DESTRUCTIVE_ACTION ||
      hasAnyToken(tokens, ['delete', 'remove', 'purge', 'close account', 'terminate']);
    const hasDestructiveAssessment =
      assessment?.riskLevel === RiskLevel.CRITICAL ||
      assessment?.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_DESTRUCTIVE') ||
      false;

    return hasDestructiveToken || hasDestructiveAssessment;
  },
  evaluate: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): PolicyEvaluationResult => {
    if (!CONTROLLED_DESTRUCTIVE_POLICY.appliesTo(action, assessment)) {
      return { matched: false };
    }

    const tokens = extractTokens(action);
    const isDangerousIrreversible =
      hasAnyToken(tokens, ['delete account', 'close account', 'terminate', 'purge', 'wipe', 'delete all']) ||
      assessment?.riskLevel === RiskLevel.CRITICAL ||
      (typeof assessment?.score === 'number' && assessment.score >= 75);

    const decision = isDangerousIrreversible ? ResponseAction.PROTECT : ResponseAction.WARN;
    const ruleId = isDangerousIrreversible ? 'RULE_CONTROLLED_DESTRUCTIVE' : 'RULE_DESTRUCTIVE_MODERATE_WARN';
    const reasonCode = isDangerousIrreversible ? 'POLICY_PROTECT_DESTRUCTIVE' : 'POLICY_WARN_DESTRUCTIVE';
    const explanation = isDangerousIrreversible
      ? CONTROLLED_DESTRUCTIVE_POLICY.userExplanation
      : 'User warning recommended: Destructive action detected on target element. Review before confirming.';

    return {
      matched: true,
      decision,
      ruleId,
      reasonCode,
      explanation,
      downstreamBehavior: isDangerousIrreversible
        ? CONTROLLED_DESTRUCTIVE_POLICY.downstreamBehavior
        : 'Displays warning modal without automatic staging hold.',
    };
  },
});

/**
 * -----------------------------------------------------------------------------
 * 2. CONTROLLED FINANCIAL & PAYMENT POLICY
 * -----------------------------------------------------------------------------
 */
export const CONTROLLED_PAYMENT_POLICY: RiskPolicyDefinition = Object.freeze({
  id: RiskPolicyId.CONTROLLED_PAYMENT,
  name: 'Controlled Financial & Checkout Policy',
  description:
    'Identifies interactions targeting financial transactions, checkouts, and fund transfers. Applies advisory warnings or Staging Mode depending on compounding risk factors.',
  supportedActionTypes: [ActionType.CLICK, ActionType.SUBMIT],
  evidenceRequirement:
    'Action type must be CLICK or SUBMIT. Target element text, attributes, or form context must indicate checkout or funds transfer ("pay", "payment", "checkout", "purchase", "transfer", "buy") or category PAYMENT.',
  decision: ResponseAction.WARN,
  userExplanation:
    'User advisory recommended: Action interacts with checkout or payment transaction flow. Please verify transaction details before continuing.',
  ruleId: 'RULE_PAYMENT_INTERACTION_POLICY',
  downstreamBehavior:
    'Standard payment touchpoints display a non-blocking Warning Modal without halting page execution. If compounded with external destination, destructive modifiers, or evaluation score >= 75, elevates strictly to PROTECT and enters Staging Mode.',
  limitations: {
    falsePositives:
      'May trigger on informational buttons such as "How to Pay", "Payment Options", or browsing catalog buttons labeled "Buy".',
    falseNegatives:
      'Cannot detect payment forms rendered inside sandboxed cross-origin iframes without parent window DOM permissions.',
    architecturalConstraints:
      'Does not inspect monetary amounts, credit card numbers, or bank account inputs to preserve user privacy and data security.',
  },
  appliesTo: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): boolean => {
    if (action.type !== ActionType.CLICK && action.type !== ActionType.SUBMIT) return false;

    // Routine financial read-only operations must never trigger payment policies or staging
    if (
      action.category === ActionCategory.FINANCIAL_READ_ONLY ||
      assessment?.matchedRules?.some((r) => r.ruleId === 'RULE_FINANCIAL_READ_ONLY')
    ) {
      return false;
    }

    const tokens = extractTokens(action);
    const isInformational = hasAnyToken(tokens, ['faq', 'help', 'options', 'guide', 'policy', 'terms', 'methods', 'about', 'how to pay']);
    if (isInformational && (action.category === ActionCategory.GENERAL || !action.category)) {
      return false;
    }
    const hasPaymentToken =
      action.category === ActionCategory.PAYMENT ||
      action.category === ActionCategory.FINANCIAL_TRANSACTION ||
      hasAnyToken(tokens, ['pay', 'payment', 'checkout', 'purchase', 'buy', 'transfer money', 'send money', 'fund transfer', 'transfer']);
    const hasPaymentAssessment =
      assessment?.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PAYMENT') || false;

    return hasPaymentToken || hasPaymentAssessment;
  },
  evaluate: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): PolicyEvaluationResult => {
    if (!CONTROLLED_PAYMENT_POLICY.appliesTo(action, assessment)) {
      return { matched: false };
    }

    // Compound check: If payment is high-risk authorization, escalate to PROTECT
    const criticalScore = getCriticalThresholdScore();
    const isHighRiskAuthorization =
      assessment?.riskLevel === RiskLevel.CRITICAL ||
      (typeof assessment?.score === 'number' && assessment.score >= criticalScore) ||
      assessment?.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR') ||
      action.category === ActionCategory.BENEFICIARY_MANAGEMENT;

    const decision = isHighRiskAuthorization ? ResponseAction.PROTECT : ResponseAction.WARN;
    const ruleId = isHighRiskAuthorization ? 'RULE_PAYMENT_COMPOUND_PROTECT' : 'RULE_PAYMENT_INTERACTION_POLICY';
    const explanation = isHighRiskAuthorization
      ? 'Protective mechanism required: High-consequence financial authorization requires verification before processing.'
      : CONTROLLED_PAYMENT_POLICY.userExplanation;

    return {
      matched: true,
      decision,
      ruleId,
      reasonCode: isHighRiskAuthorization ? 'POLICY_PROTECT_PAYMENT_COMPOUND' : 'POLICY_WARN_PAYMENT',
      explanation,
      downstreamBehavior: isHighRiskAuthorization
        ? 'Enters Staging Mode requiring trusted-contact approval.'
        : CONTROLLED_PAYMENT_POLICY.downstreamBehavior,
    };
  },
});

/**
 * -----------------------------------------------------------------------------
 * 3. EXTERNAL NAVIGATION & ORIGIN BOUNDARY POLICY
 * -----------------------------------------------------------------------------
 */
export const EXTERNAL_NAVIGATION_POLICY: RiskPolicyDefinition = Object.freeze({
  id: RiskPolicyId.EXTERNAL_NAVIGATION,
  name: 'External Navigation & Origin Boundary Policy',
  description:
    'Detects navigations or link transitions that cross origin boundaries to external domains, presenting an advisory warning before domain shift.',
  supportedActionTypes: [ActionType.NAVIGATION, ActionType.CLICK, ActionType.SUBMIT],
  evidenceRequirement:
    'Action is a link CLICK, page NAVIGATION, or form SUBMIT where current URL and destination URL have valid HTTP/HTTPS origins and the origins strictly differ (currentOrigin !== destinationOrigin).',
  decision: ResponseAction.WARN,
  userExplanation:
    'User advisory recommended: Navigation redirects to an external origin across domain boundaries.',
  ruleId: 'RULE_EXTERNAL_NAVIGATION_POLICY',
  downstreamBehavior:
    'Displays an advisory Warning Modal. For ambient navigation, does not synchronously block tab unloading unless explicitly marked with controlled test interception hooks.',
  limitations: {
    falsePositives:
      'Triggers on legitimate single sign-on (SSO) authentication hops (e.g. login.example.com to auth0.com) and payment gateway redirects.',
    falseNegatives:
      'Cannot detect malicious content served from the exact same origin or compromised subdomains sharing the parent origin.',
    architecturalConstraints:
      'A URL hostname alone does not prove or disprove legitimacy. Browser extension content scripts cannot synchronously cancel native top-level window.location assignments without DeclarativeNetRequest rules.',
  },
  appliesTo: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): boolean => {
    if (
      action.type !== ActionType.NAVIGATION &&
      action.type !== ActionType.CLICK &&
      action.type !== ActionType.SUBMIT
    ) {
      return false;
    }

    // Check if destination candidate is explicitly configured as trusted
    const destCandidate =
      action.element?.targetUrl ||
      action.element?.formAction ||
      (action.type === ActionType.NAVIGATION ? action.page?.url : undefined);
    if (destCandidate && isTrustedDomain(destCandidate)) {
      return false;
    }

    // Check explicit classification or assessment
    if (action.category === ActionCategory.EXTERNAL_NAVIGATION) {
      if (
        action.page?.url &&
        isTrustedDomain(action.page.url) &&
        !action.element?.targetUrl &&
        !action.element?.formAction
      ) {
        return false;
      }
      return true;
    }
    if (
      assessment?.matchedRules?.some(
        (r) =>
          r.ruleId === 'RISK_RULE_EXTERNAL_NAVIGATION' ||
          r.ruleId === 'RISK_RULE_SUSPICIOUS_URL' ||
          r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'
      )
    ) {
      return true;
    }

    // Check origin boundary if URLs are available
    if (action.page?.url && action.page?.previousUrl) {
      try {
        const curOrigin = new URL(action.page.url).origin;
        const prevOrigin = new URL(action.page.previousUrl).origin;
        if (curOrigin === prevOrigin) {
          return false;
        }
        if (curOrigin !== prevOrigin && curOrigin !== 'null' && prevOrigin !== 'null') {
          // If destination origin is explicitly configured as trusted, exempt it from external warning
          if (isTrustedDomain(curOrigin)) {
            return false;
          }
          return true;
        }
      } catch {
        return false;
      }
    }

    // Check link click targetUrl cross-origin boundary
    if (action.page?.url && action.element?.targetUrl) {
      try {
        const curOrigin = new URL(action.page.url).origin;
        const destOrigin = new URL(action.element.targetUrl).origin;
        if (curOrigin !== destOrigin && curOrigin !== 'null' && destOrigin !== 'null') {
          if (isTrustedDomain(destOrigin)) {
            return false;
          }
          return true;
        }
      } catch {
        // Ignore
      }
    }

    // Check form submission cross-origin boundary
    if (action.page?.url && action.element?.formAction) {
      try {
        const curOrigin = new URL(action.page.url).origin;
        const destOrigin = new URL(action.element.formAction).origin;
        if (curOrigin !== destOrigin && curOrigin !== 'null' && destOrigin !== 'null') {
          if (isTrustedDomain(destOrigin)) {
            return false;
          }
          return true;
        }
      } catch {
        // Ignore
      }
    }

    // Check direct navigation to an untrusted domain
    if (action.type === ActionType.NAVIGATION && action.page?.url) {
      if (!isTrustedDomain(action.page.url)) {
        return true;
      }
    }

    const tokens = extractTokens(action);
    return (
      isLinkAction(action) &&
      Boolean(action.element?.targetUrl) &&
      hasAnyToken(tokens, ['external', 'third-party', 'redirect', 'leave site'])
    );
  },
  evaluate: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): PolicyEvaluationResult => {
    if (!EXTERNAL_NAVIGATION_POLICY.appliesTo(action, assessment)) {
      return { matched: false };
    }

    const phishingRule = assessment?.matchedRules?.find((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR');
    const suspiciousRule = assessment?.matchedRules?.find((r) => r.ruleId === 'RISK_RULE_SUSPICIOUS_URL');

    // 1. Phishing / deceptive indicators strictly escalate to PROTECT
    if (phishingRule) {
      return {
        matched: true,
        decision: ResponseAction.PROTECT,
        ruleId: 'RULE_EXTERNAL_NAVIGATION_PHISHING_PROTECT',
        reasonCode: 'POLICY_PROTECT_PHISHING_INDICATOR',
        explanation: `Protective mechanism required: Deceptive website or phishing indicator detected across navigation boundary (${phishingRule.reason}).`,
        downstreamBehavior: 'Halts execution and prevents navigation pending verification.',
      };
    }

    // 2. High severity suspicious URL escalates to WARN; mild suspicion to ADVISE
    if (suspiciousRule) {
      const isHighSuspicion =
        (suspiciousRule.scoreContribution ?? 0) >= 40 ||
        (assessment?.score ?? 0) >= 50;

      const decision = isHighSuspicion ? ResponseAction.WARN : ResponseAction.ADVISE;
      return {
        matched: true,
        decision,
        ruleId: 'RULE_EXTERNAL_NAVIGATION_POLICY',
        reasonCode: isHighSuspicion ? 'POLICY_WARN_SUSPICIOUS_URL' : 'POLICY_ADVISE_SUSPICIOUS_URL',
        explanation: `${decision === ResponseAction.WARN ? 'User warning recommended' : 'Advisory notice'}: Suspicious URL characteristics detected (${suspiciousRule.reason}).`,
        downstreamBehavior: decision === ResponseAction.WARN
          ? EXTERNAL_NAVIGATION_POLICY.downstreamBehavior
          : 'Displays non-blocking advisory notification without halting page execution.',
      };
    }

    // 3. Meaningful risky action across boundary (e.g. form submission, payment, credentials, destructive, or sensitive endpoints)
    const targetUrlStr = action.element?.targetUrl || action.element?.formAction || action.page?.url || '';
    const hasSensitiveDestination = /\b(login|signin|sign-in|auth|authenticate|checkout|pay|billing|transfer)\b/i.test(targetUrlStr);

    const isMeaningfulRisk =
      action.type === ActionType.SUBMIT ||
      action.category === ActionCategory.PAYMENT ||
      action.category === ActionCategory.AUTHENTICATION ||
      action.category === ActionCategory.FINANCIAL_TRANSACTION ||
      action.category === ActionCategory.DESTRUCTIVE_ACTION ||
      hasSensitiveDestination ||
      (assessment?.score ?? 0) >= 50;

    if (isMeaningfulRisk) {
      return {
        matched: true,
        decision: ResponseAction.WARN,
        ruleId: 'RULE_EXTERNAL_NAVIGATION_POLICY',
        reasonCode: 'POLICY_WARN_EXTERNAL_NAVIGATION',
        explanation: 'User warning recommended: High-sensitivity interaction crossing external origin boundaries.',
        downstreamBehavior: EXTERNAL_NAVIGATION_POLICY.downstreamBehavior,
      };
    }

    // 4. Unknown but ordinary website navigation -> ADVISE (non-blocking advisory)
    return {
      matched: true,
      decision: ResponseAction.ADVISE,
      ruleId: 'RULE_EXTERNAL_NAVIGATION_ADVISE',
      reasonCode: 'POLICY_ADVISE_EXTERNAL_NAVIGATION',
      explanation: 'Advisory notice: Navigation redirects to an unclassified external destination. Proceed with normal caution.',
      downstreamBehavior: 'Displays non-blocking advisory notification without halting page execution.',
    };
  },
});

/**
 * -----------------------------------------------------------------------------
 * 4. AUTHENTICATION & CREDENTIAL BOUNDARY POLICY
 * -----------------------------------------------------------------------------
 */
export const AUTHENTICATION_BOUNDARY_POLICY: RiskPolicyDefinition = Object.freeze({
  id: RiskPolicyId.AUTHENTICATION_BOUNDARY,
  name: 'Authentication & Credential Boundary Policy',
  description:
    'Identifies interactions targeting login portals, password fields, and session boundaries. Operates strictly on structural DOM metadata without accessing input text or credentials.',
  supportedActionTypes: [ActionType.CLICK, ActionType.INPUT, ActionType.SUBMIT],
  evidenceRequirement:
    'Target element is an INPUT with type="password", or target element / form contains explicit authentication keywords ("login", "signin", "authenticate", "password", "2fa"), or category AUTHENTICATION, or matched phishing indicator.',
  decision: ResponseAction.WARN,
  userExplanation:
    'User advisory recommended: Action interacts with authentication, credential, or session boundaries.',
  ruleId: 'RULE_AUTHENTICATION_BOUNDARY_POLICY',
  downstreamBehavior:
    'Emits an advisory warning. Never captures, stores, or transmits user-entered passwords, OTPs, or authentication tokens.',
  limitations: {
    falsePositives:
      'May trigger on benign search inputs or articles with titles containing words like "login" or "authenticate".',
    falseNegatives:
      'Cannot detect credential entry on custom canvas-based keyboards or obfuscated shadow DOM text inputs.',
    architecturalConstraints:
      'Under Guardrail privacy mandates, input element values are strictly omitted from action models.',
  },
  appliesTo: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): boolean => {
    if (
      action.type !== ActionType.CLICK &&
      action.type !== ActionType.INPUT &&
      action.type !== ActionType.SUBMIT
    ) {
      return false;
    }

    if (action.category === ActionCategory.AUTHENTICATION) return true;
    if (
      assessment?.matchedRules?.some(
        (r) => r.ruleId === 'RISK_RULE_AUTHENTICATION' || r.ruleId === 'RISK_RULE_PHISHING_INDICATOR'
      )
    ) {
      return true;
    }

    const tokens = extractTokens(action);
    // Benign password recovery links do not represent credential entry or authentication boundaries
    const firstText = tokens[0]?.toLowerCase() || '';
    if (firstText.includes('forgot password') || firstText.includes('recover password')) {
      return false;
    }

    return hasAnyToken(tokens, ['login', 'log in', 'sign in', 'signin', 'authenticate', 'password', '2fa']);
  },
  evaluate: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): PolicyEvaluationResult => {
    if (!AUTHENTICATION_BOUNDARY_POLICY.appliesTo(action, assessment)) {
      return { matched: false };
    }

    const phishingRule = assessment?.matchedRules?.find((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR');
    const explanation = phishingRule?.reason
      ? `Deceptive website advisory: ${phishingRule.reason}`
      : AUTHENTICATION_BOUNDARY_POLICY.userExplanation;

    return {
      matched: true,
      decision: ResponseAction.WARN,
      ruleId: 'RULE_AUTHENTICATION_BOUNDARY_POLICY',
      reasonCode: phishingRule ? 'POLICY_WARN_PHISHING_INDICATOR' : 'POLICY_WARN_AUTHENTICATION',
      explanation,
      downstreamBehavior: AUTHENTICATION_BOUNDARY_POLICY.downstreamBehavior,
    };
  },
});

/**
 * -----------------------------------------------------------------------------
 * 5. SUSPICIOUS FILE DOWNLOAD POLICY
 * -----------------------------------------------------------------------------
 */
export const SUSPICIOUS_DOWNLOAD_POLICY: RiskPolicyDefinition = Object.freeze({
  id: RiskPolicyId.SUSPICIOUS_DOWNLOAD,
  name: 'Suspicious Executable & File Download Policy',
  description:
    'Identifies file download triggers and halts executable or high-risk binary transfers pending verification.',
  supportedActionTypes: [ActionType.CLICK, ActionType.NAVIGATION],
  evidenceRequirement:
    'Action initiates a file download targeting executable file formats (.exe, .msi, .dmg, .pkg, .bat, etc.) or triggered by DOWNLOAD_ACTION signal with elevated risk score.',
  decision: ResponseAction.PROTECT,
  userExplanation:
    'Protective mechanism required: Suspicious executable file download detected. Transfer held pending security review.',
  ruleId: 'RULE_SUSPICIOUS_DOWNLOAD_POLICY',
  downstreamBehavior:
    'Halts execution of download links and prevents automated binary transfers.',
  limitations: {
    falsePositives:
      'May trigger on legitimate developer utility scripts or software installers downloaded intentionally.',
    falseNegatives:
      'Cannot inspect binary payloads delivered via blob URLs generated purely in memory by service workers.',
    architecturalConstraints:
      'Guardrail operates at the DOM click/navigation boundary before native browser download managers take control.',
  },
  appliesTo: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): boolean => {
    if (action.type !== ActionType.CLICK && action.type !== ActionType.NAVIGATION) return false;

    const hasDownloadCategory =
      action.category === ActionCategory.DOWNLOAD ||
      action.category === ActionCategory.FILE_DOWNLOAD;
    const hasDownloadRule =
      assessment?.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_DOWNLOAD') || false;

    const downloadCandidate =
      action.download?.filename ||
      action.element?.downloadAttribute ||
      action.element?.targetUrl ||
      action.page?.url ||
      '';
    const hasExecutableTarget = /\.(exe|msi|dmg|pkg|zip|tar|gz|7z|iso|img|vhd|bat|cmd|sh|ps1|vbs|scr|hta)(\?.*)?$/i.test(downloadCandidate);

    return hasDownloadCategory || hasDownloadRule || hasExecutableTarget;
  },
  evaluate: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): PolicyEvaluationResult => {
    if (!SUSPICIOUS_DOWNLOAD_POLICY.appliesTo(action, assessment)) {
      return { matched: false };
    }

    const downloadCandidate =
      action.download?.filename ||
      action.element?.downloadAttribute ||
      action.element?.targetUrl ||
      action.page?.url ||
      '';
    const isExecutable = /\.(exe|msi|dmg|pkg|iso|img|vhd|bat|cmd|sh|ps1|vbs|scr|hta)(\?.*)?$/i.test(downloadCandidate);
    const isHighRisk = (assessment?.score ?? 0) >= 50 || isExecutable;

    if (isHighRisk) {
      return {
        matched: true,
        decision: ResponseAction.PROTECT,
        ruleId: 'RULE_SUSPICIOUS_DOWNLOAD_POLICY',
        reasonCode: 'POLICY_PROTECT_SUSPICIOUS_DOWNLOAD',
        explanation: 'Protective mechanism required: Suspicious executable download detected from unverified source.',
        downstreamBehavior: SUSPICIOUS_DOWNLOAD_POLICY.downstreamBehavior,
      };
    }

    return { matched: false };
  },
});

/**
 * -----------------------------------------------------------------------------
 * 6. PHISHING & DECEPTIVE IDENTITY PROTECTION POLICY
 * -----------------------------------------------------------------------------
 */
export const PHISHING_PROTECTION_POLICY: RiskPolicyDefinition = Object.freeze({
  id: RiskPolicyId.PHISHING_PROTECTION,
  name: 'Phishing & Deceptive Identity Protection Policy',
  description:
    'Provides strict protection against interactions on deceptive websites, homoglyph lookalikes, or credential exfiltration targets.',
  supportedActionTypes: [ActionType.CLICK, ActionType.INPUT, ActionType.SUBMIT, ActionType.NAVIGATION],
  evidenceRequirement:
    'Action occurs on a page with triggered PHISHING_INDICATOR signal, brand identity mismatch, or unencrypted credential exfiltration.',
  decision: ResponseAction.PROTECT,
  userExplanation:
    'Protective mechanism required: Deceptive website or phishing indicator detected. Action held to protect credentials.',
  ruleId: 'RULE_PHISHING_PROTECTION_POLICY',
  downstreamBehavior:
    'Enters Staging Mode: Halts form submission and navigation immediately. Requires verified authorization.',
  limitations: {
    falsePositives: 'May trigger on test staging environments using non-standard domain names.',
    falseNegatives: 'Zero-day phishing on high-reputation compromised domains without branding mismatches.',
    architecturalConstraints: 'Operates via heuristic inspection without external network reputation lookups.',
  },
  appliesTo: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): boolean => {
    return (
      assessment?.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR') ||
      action.category === ActionCategory.SUSPICIOUS_REDIRECT ||
      false
    );
  },
  evaluate: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): PolicyEvaluationResult => {
    if (!PHISHING_PROTECTION_POLICY.appliesTo(action, assessment)) {
      return { matched: false };
    }
    const phishingRule = assessment?.matchedRules?.find((r) => r.ruleId === 'RISK_RULE_PHISHING_INDICATOR');
    const reasonDetail = phishingRule?.reason || PHISHING_PROTECTION_POLICY.userExplanation;

    return {
      matched: true,
      decision: ResponseAction.PROTECT,
      ruleId: 'RULE_PHISHING_PROTECTION_POLICY',
      reasonCode: 'POLICY_PROTECT_PHISHING_INDICATOR',
      explanation: `Protective mechanism required: Deceptive website indicator detected (${reasonDetail}).`,
      downstreamBehavior: PHISHING_PROTECTION_POLICY.downstreamBehavior,
    };
  },
});

/**
 * -----------------------------------------------------------------------------
 * 7. ROUTINE BENIGN INTERACTION POLICY
 * -----------------------------------------------------------------------------
 */
export const ROUTINE_INTERACTION_POLICY: RiskPolicyDefinition = Object.freeze({
  id: RiskPolicyId.ROUTINE_INTERACTION,
  name: 'Routine Interaction Policy',
  description:
    'Permits standard, non-sensitive page interactions (navigation, safe clicks, document exports) to proceed seamlessly without intervention.',
  supportedActionTypes: [ActionType.CLICK, ActionType.NAVIGATION, ActionType.SUBMIT],
  evidenceRequirement:
    'Action involves standard interaction controls with no matched destructive, financial, or authentication signals, evaluating to LOW risk level (score < 25).',
  decision: ResponseAction.ALLOW,
  userExplanation:
    'Action permitted without intervention: No elevated risk signals detected. Routine interaction.',
  ruleId: 'RULE_ROUTINE_ALLOW_POLICY',
  downstreamBehavior:
    'Action executes without friction, without modal mounting, and without interception records.',
  limitations: {
    falsePositives: 'None for benign actions.',
    falseNegatives:
      'An ALLOW decision does NOT guarantee that a site or action is safe; it indicates only that no heuristic risk rules fired.',
    architecturalConstraints:
      'Novel or zero-day phishing interfaces using innocuous button text (e.g. "Next") on newly registered domains will not trigger heuristic policies.',
  },
  appliesTo: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): boolean => {
    // If an assessment exists and is not LOW, routine policy does not apply
    if (assessment && assessment.riskLevel !== RiskLevel.LOW) {
      return false;
    }

    // Dynamic threshold boundary: score must not exceed configured lowMax
    const routineMax = getRoutineThresholdMax();
    if (assessment && typeof assessment.score === 'number' && assessment.score > routineMax) {
      return false;
    }

    // Check that none of the elevated policies match
    if (PHISHING_PROTECTION_POLICY.appliesTo(action, assessment)) return false;
    if (CONTROLLED_DESTRUCTIVE_POLICY.appliesTo(action, assessment)) return false;
    if (CONTROLLED_PAYMENT_POLICY.appliesTo(action, assessment)) return false;
    if (EXTERNAL_NAVIGATION_POLICY.appliesTo(action, assessment)) return false;
    if (AUTHENTICATION_BOUNDARY_POLICY.appliesTo(action, assessment)) return false;

    return (
      action.type === ActionType.CLICK ||
      action.type === ActionType.NAVIGATION ||
      action.type === ActionType.SUBMIT
    );
  },
  evaluate: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): PolicyEvaluationResult => {
    if (!ROUTINE_INTERACTION_POLICY.appliesTo(action, assessment)) {
      return { matched: false };
    }
    return {
      matched: true,
      decision: ResponseAction.ALLOW,
      ruleId: 'RULE_ROUTINE_ALLOW_POLICY',
      reasonCode: 'POLICY_ALLOW_ROUTINE',
      explanation: ROUTINE_INTERACTION_POLICY.userExplanation,
      downstreamBehavior: ROUTINE_INTERACTION_POLICY.downstreamBehavior,
    };
  },
});

/**
 * -----------------------------------------------------------------------------
 * 8. UNSUPPORTED ACTION BOUNDARY & CORRUPTION GUARD POLICY
 * -----------------------------------------------------------------------------
 */
export const UNSUPPORTED_BOUNDARY_GUARD_POLICY: RiskPolicyDefinition = Object.freeze({
  id: RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD,
  name: 'Unsupported Action Type & Corruption Guard Policy',
  description:
    'Handles unhandled action mechanisms and protects the system fail-closed against corrupted, malformed, or out-of-spec action models.',
  supportedActionTypes: [ActionType.INPUT, ActionType.SUBMIT, ActionType.NAVIGATION],
  evidenceRequirement:
    'Action type is outside supported DOM execution scopes, or action payload is malformed (missing actionId, missing page metadata, or corrupt timestamps).',
  decision: ResponseAction.PROTECT,
  userExplanation:
    'Protective mechanism required: Malformed or unverified action payload resolved fail-closed.',
  ruleId: 'RULE_UNSUPPORTED_TYPE_GUARD',
  downstreamBehavior:
    'Malformed or invalid action payloads are strictly quarantined and resolve fail-closed to PROTECT. Benign unhandled events pass through without creating state.',
  limitations: {
    falsePositives:
      'Synthetic test events or custom browser automation events with incomplete metadata will be quarantined as malformed.',
    falseNegatives:
      'Interactions occurring purely inside Web Workers or WebSockets without DOM representations bypass content script detection.',
    architecturalConstraints:
      'Guardrail is a browser UI safety extension operating on DOM events; low-level network packets are outside sensor boundaries.',
  },
  appliesTo: (action: GuardrailAction): boolean => {
    // Malformed action checks
    if (!action || typeof action !== 'object') return true;
    if (typeof action.id !== 'string' || !action.id.trim()) return true;
    if (!action.type || !Object.values(ActionType).includes(action.type)) return true;
    if (!action.page || typeof action.page.url !== 'string') return true;

    return false;
  },
  evaluate: (action: GuardrailAction): PolicyEvaluationResult => {
    const isMalformed = UNSUPPORTED_BOUNDARY_GUARD_POLICY.appliesTo(action);
    if (!isMalformed) {
      return { matched: false };
    }
    return {
      matched: true,
      decision: ResponseAction.PROTECT,
      ruleId: 'RULE_FAIL_CLOSED_FALLBACK',
      reasonCode: 'POLICY_FAIL_CLOSED_CORRUPT_PAYLOAD',
      explanation: UNSUPPORTED_BOUNDARY_GUARD_POLICY.userExplanation,
      downstreamBehavior: UNSUPPORTED_BOUNDARY_GUARD_POLICY.downstreamBehavior,
    };
  },
});

/**
 * Complete catalog of official Guardrail risk policies.
 */
export const ALL_GUARDRAIL_POLICIES: readonly RiskPolicyDefinition[] = Object.freeze([
  PHISHING_PROTECTION_POLICY,
  SUSPICIOUS_DOWNLOAD_POLICY,
  CONTROLLED_DESTRUCTIVE_POLICY,
  CONTROLLED_PAYMENT_POLICY,
  EXTERNAL_NAVIGATION_POLICY,
  AUTHENTICATION_BOUNDARY_POLICY,
  ROUTINE_INTERACTION_POLICY,
  UNSUPPORTED_BOUNDARY_GUARD_POLICY,
]);

/**
 * Retrieves a policy definition by its unique identifier.
 */
export function getPolicyById(id: string | RiskPolicyId): RiskPolicyDefinition | undefined {
  return ALL_GUARDRAIL_POLICIES.find((p) => p.id === id);
}

/**
 * Evaluates an action across all supported policies and returns all matching results.
 * Respects active or provided GuardrailPolicyConfig while enforcing immutable security invariants.
 *
 * @param action Normalized interaction event
 * @param assessment Optional risk assessment
 * @param config Optional policy configuration override (defaults to active central configuration)
 */
export function evaluatePolicies(
  action: GuardrailAction,
  assessment?: Readonly<RiskAssessment>,
  config?: GuardrailPolicyConfig
): PolicyEvaluationResult[] {
  const activeCfg = config ?? getActivePolicyConfig();
  const results: PolicyEvaluationResult[] = [];

  for (const policy of ALL_GUARDRAIL_POLICIES) {
    const configuredRule = activeCfg.policies.find((p) => p.id === policy.id);

    // SAFETY INVARIANT: Immutable security invariants cannot be disabled or downgraded
    const isImmutable =
      configuredRule?.isImmutableSecurityInvariant ||
      policy.id === RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD ||
      policy.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE;

    if (!isImmutable && configuredRule && configuredRule.enabled === false) {
      continue;
    }

    const res = policy.evaluate(action, assessment);
    if (res.matched) {
      let effectiveDecision = res.decision;
      let effectiveExplanation = res.explanation;
      let effectiveRuleId = res.ruleId;
      let effectiveReasonCode = res.reasonCode;

      // Configured decision handling respecting monotonic protection precedence:
      // A configured PROTECT decision elevates WARN to PROTECT.
      // But a configured WARN decision CANNOT downgrade a dynamic PROTECT evaluation.
      if (configuredRule && !isImmutable) {
        if (configuredRule.decision === ResponseAction.PROTECT && res.decision !== ResponseAction.PROTECT) {
          effectiveDecision = ResponseAction.PROTECT;
          effectiveReasonCode = configuredRule.reasonCode || res.reasonCode;
          effectiveExplanation = configuredRule.userExplanation || res.explanation;
        }
      }

      results.push({
        ...res,
        decision: effectiveDecision,
        ruleId: effectiveRuleId,
        reasonCode: effectiveReasonCode,
        explanation: effectiveExplanation,
      });
    }
  }
  return results;
}
