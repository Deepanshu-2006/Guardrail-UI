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

/**
 * Extracts searchable text tokens from an action safely (without inspecting input values).
 */
function extractTokens(action: GuardrailAction): string[] {
  const tokens: string[] = [];
  if (action.element?.visibleText) {
    tokens.push(action.element.visibleText.toLowerCase().trim());
  }
  if (action.element?.id) {
    tokens.push(action.element.id.toLowerCase().trim());
  }
  if (action.element?.className) {
    tokens.push(action.element.className.toLowerCase().trim());
  }
  if (action.page?.url) {
    try {
      tokens.push(new URL(action.page.url).pathname.toLowerCase());
    } catch {
      // Ignore URL parsing errors
    }
  }
  return tokens;
}

function hasAnyToken(tokens: string[], keywords: string[]): boolean {
  return keywords.some((kw) => tokens.some((t) => t.includes(kw)));
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
    return {
      matched: true,
      decision: ResponseAction.PROTECT,
      ruleId: 'RULE_CONTROLLED_DESTRUCTIVE',
      reasonCode: 'POLICY_PROTECT_DESTRUCTIVE',
      explanation: CONTROLLED_DESTRUCTIVE_POLICY.userExplanation,
      downstreamBehavior: CONTROLLED_DESTRUCTIVE_POLICY.downstreamBehavior,
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
    const tokens = extractTokens(action);
    const hasPaymentToken =
      action.category === ActionCategory.PAYMENT ||
      hasAnyToken(tokens, ['pay', 'payment', 'checkout', 'purchase', 'buy', 'transfer']);
    const hasPaymentAssessment =
      assessment?.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_PAYMENT') || false;

    return hasPaymentToken || hasPaymentAssessment;
  },
  evaluate: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): PolicyEvaluationResult => {
    if (!CONTROLLED_PAYMENT_POLICY.appliesTo(action, assessment)) {
      return { matched: false };
    }

    // Compound check: If payment is compounded with critical severity, escalate to PROTECT
    const isCritical =
      assessment?.riskLevel === RiskLevel.CRITICAL || (typeof assessment?.score === 'number' && assessment.score >= 75);
    const decision = isCritical ? ResponseAction.PROTECT : ResponseAction.WARN;
    const ruleId = isCritical ? 'RULE_PAYMENT_COMPOUND_PROTECT' : 'RULE_PAYMENT_INTERACTION_POLICY';
    const explanation = isCritical
      ? 'Protective mechanism required: High-consequence payment action requires verification before processing.'
      : CONTROLLED_PAYMENT_POLICY.userExplanation;

    return {
      matched: true,
      decision,
      ruleId,
      reasonCode: isCritical ? 'POLICY_PROTECT_PAYMENT_COMPOUND' : 'POLICY_WARN_PAYMENT',
      explanation,
      downstreamBehavior: isCritical
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
  supportedActionTypes: [ActionType.NAVIGATION, ActionType.CLICK],
  evidenceRequirement:
    'Action is a link CLICK or page NAVIGATION where both current URL and previous URL have valid HTTP/HTTPS origins and the origins strictly differ (currentOrigin !== previousOrigin).',
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
    if (action.type !== ActionType.NAVIGATION && action.type !== ActionType.CLICK) return false;

    // Check explicit classification or assessment
    if (action.category === ActionCategory.EXTERNAL_NAVIGATION) return true;
    if (assessment?.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_EXTERNAL_NAVIGATION')) return true;

    // Check origin boundary if URLs are available
    if (action.page?.url && action.page?.previousUrl) {
      try {
        const curOrigin = new URL(action.page.url).origin;
        const prevOrigin = new URL(action.page.previousUrl).origin;
        if (curOrigin !== prevOrigin && curOrigin !== 'null' && prevOrigin !== 'null') {
          return true;
        }
      } catch {
        return false;
      }
    }

    const tokens = extractTokens(action);
    return isLinkAction(action) && hasAnyToken(tokens, ['external', 'third-party', 'redirect', 'leave site']);
  },
  evaluate: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): PolicyEvaluationResult => {
    if (!EXTERNAL_NAVIGATION_POLICY.appliesTo(action, assessment)) {
      return { matched: false };
    }
    return {
      matched: true,
      decision: ResponseAction.WARN,
      ruleId: 'RULE_EXTERNAL_NAVIGATION_POLICY',
      reasonCode: 'POLICY_WARN_EXTERNAL_NAVIGATION',
      explanation: EXTERNAL_NAVIGATION_POLICY.userExplanation,
      downstreamBehavior: EXTERNAL_NAVIGATION_POLICY.downstreamBehavior,
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
    'Target element is an INPUT with type="password", or target element / form contains explicit authentication keywords ("login", "signin", "authenticate", "password", "2fa"), or category AUTHENTICATION.',
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
    if (assessment?.matchedRules?.some((r) => r.ruleId === 'RISK_RULE_AUTHENTICATION')) return true;

    const tokens = extractTokens(action);
    return hasAnyToken(tokens, ['login', 'log in', 'sign in', 'signin', 'authenticate', 'password', '2fa']);
  },
  evaluate: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>): PolicyEvaluationResult => {
    if (!AUTHENTICATION_BOUNDARY_POLICY.appliesTo(action, assessment)) {
      return { matched: false };
    }
    return {
      matched: true,
      decision: ResponseAction.WARN,
      ruleId: 'RULE_AUTHENTICATION_BOUNDARY_POLICY',
      reasonCode: 'POLICY_WARN_AUTHENTICATION',
      explanation: AUTHENTICATION_BOUNDARY_POLICY.userExplanation,
      downstreamBehavior: AUTHENTICATION_BOUNDARY_POLICY.downstreamBehavior,
    };
  },
});

/**
 * -----------------------------------------------------------------------------
 * 5. ROUTINE BENIGN INTERACTION POLICY
 * -----------------------------------------------------------------------------
 */
export const ROUTINE_INTERACTION_POLICY: RiskPolicyDefinition = Object.freeze({
  id: RiskPolicyId.ROUTINE_INTERACTION,
  name: 'Routine Interaction Policy',
  description:
    'Permits standard, non-sensitive page interactions (navigation, safe clicks, document exports) to proceed seamlessly without intervention.',
  supportedActionTypes: [ActionType.CLICK, ActionType.NAVIGATION],
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

    // Check that none of the elevated policies match
    if (CONTROLLED_DESTRUCTIVE_POLICY.appliesTo(action, assessment)) return false;
    if (CONTROLLED_PAYMENT_POLICY.appliesTo(action, assessment)) return false;
    if (EXTERNAL_NAVIGATION_POLICY.appliesTo(action, assessment)) return false;
    if (AUTHENTICATION_BOUNDARY_POLICY.appliesTo(action, assessment)) return false;

    return action.type === ActionType.CLICK || action.type === ActionType.NAVIGATION;
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
 * 6. UNSUPPORTED ACTION BOUNDARY & CORRUPTION GUARD POLICY
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
 */
export function evaluatePolicies(
  action: GuardrailAction,
  assessment?: Readonly<RiskAssessment>
): PolicyEvaluationResult[] {
  const results: PolicyEvaluationResult[] = [];
  for (const policy of ALL_GUARDRAIL_POLICIES) {
    const res = policy.evaluate(action, assessment);
    if (res.matched) {
      results.push(res);
    }
  }
  return results;
}
