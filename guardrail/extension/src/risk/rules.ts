/**
 * Guardrail Deterministic Risk Rules
 *
 * Centralized heuristic rules for mapping actions and classifications
 * to discrete risk signals and their configured score contributions.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. PURE HEURISTICS: These rules and their score contributions are development heuristics only.
 *    They must NOT be presented as statistically validated probabilities or guarantees of malicious behavior.
 * 2. INDEPENDENCE: Fully decoupled from DOM manipulation, network communication, and browser messaging.
 * 3. BOUNDED SCORING: Output scores must be bounded between 0 and 100.
 */

import { ActionCategory, GuardrailAction } from '../types/actions.js';
import { ActionClassificationResult } from '../types/classification.js';
import { EvaluationReason, RiskLevel, RiskSignalDefinition, RiskSignalId } from '../types/risk.js';
import { getRiskSignalDefinition, INITIAL_RISK_SIGNALS, RiskSignalOverrides } from './signals.js';
import { evaluateSuspiciousUrl } from '../utils/url-detector.js';
import { evaluatePhishingIndicators } from '../utils/phishing-detector.js';

/**
 * Context provided to a risk rule for evaluation.
 */
export interface RiskRuleEvaluationContext {
  /** The normalized action being evaluated */
  action: GuardrailAction;

  /** Optional classification result from the ActionClassifier */
  classification?: ActionClassificationResult;
}

/**
 * Result returned when a risk rule evaluates an action context.
 */
export interface RiskRuleResult {
  /** Indicates whether this rule matched and triggered its risk signal */
  matched: boolean;

  /** The identifier of the triggering rule (if matched) */
  ruleId?: string;

  /** The identifier of the triggered risk signal (if matched) */
  signalId?: RiskSignalId;

  /** Configured score contribution for this signal (0 to 100) */
  scoreContribution?: number;

  /** Human-readable explanation of why the risk signal was triggered */
  reason?: string;

  /** Discrete human-readable reasons if multiple indicators matched */
  reasons?: readonly string[];

  /** Structured indicator reasons providing fine-grained machine-readable codes */
  structuredReasons?: readonly EvaluationReason[];
}

/**
 * Specification for a deterministic risk rule.
 */
export interface RiskRule {
  /** Unique machine-readable identifier for the rule */
  readonly id: string;

  /** Associated risk signal identifier */
  readonly signalId: RiskSignalId;

  /** Human-readable description of what this rule inspects */
  readonly description: string;

  /**
   * Deterministic evaluation priority.
   * Higher values evaluate first. Defaults to 50 when omitted.
   */
  readonly priority?: number;

  /**
   * Evaluates the action context deterministically.
   * Pure function: no side effects, no DOM access, no network/messaging calls.
   */
  evaluate: (
    context: RiskRuleEvaluationContext,
    signalConfig?: RiskSignalDefinition
  ) => RiskRuleResult;
}

/**
 * Clamps any cumulative score strictly between 0 and 100.
 */
export function clampRiskScore(score: number): number {
  if (isNaN(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Helper to extract non-sensitive searchable tokens from an action.
 */
function extractActionTokens(action: GuardrailAction): string[] {
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
      // Ignore
    }
  }
  return tokens;
}

function hasAnyToken(tokens: string[], keywords: string[]): boolean {
  return keywords.some((kw) => tokens.some((t) => t.includes(kw)));
}

/**
 * Centralized collection of deterministic risk rules.
 */
export const INITIAL_RISK_RULES: readonly RiskRule[] = Object.freeze([
  /**
   * Rule: Destructive Action
   * Score contribution: +50
   * Priority: 100 (highest risk severity)
   */
  {
    id: 'RISK_RULE_DESTRUCTIVE',
    signalId: RiskSignalId.DESTRUCTIVE_ACTION,
    priority: 100,
    description: 'Triggers DESTRUCTIVE_ACTION signal when action targets deletion, cancellation, or irreversible state changes.',
    evaluate: (context, signalConfig) => {
      const config = signalConfig ?? INITIAL_RISK_SIGNALS[RiskSignalId.DESTRUCTIVE_ACTION];
      const tokens = extractActionTokens(context.action);
      const isDestructive =
        context.classification?.category === ActionCategory.DESTRUCTIVE ||
        context.action.category === ActionCategory.DESTRUCTIVE ||
        hasAnyToken(tokens, ['delete', 'remove', 'purge', 'close account', 'terminate']);

      if (isDestructive) {
        return {
          matched: true,
          ruleId: 'RISK_RULE_DESTRUCTIVE',
          signalId: RiskSignalId.DESTRUCTIVE_ACTION,
          scoreContribution: config.scoreContribution,
          reason: config.reason,
        };
      }

      return { matched: false };
    },
  },

  /**
   * Rule: Payment Action
   * Score contribution: +40
   * Priority: 90
   */
  {
    id: 'RISK_RULE_PAYMENT',
    signalId: RiskSignalId.PAYMENT_ACTION,
    priority: 90,
    description: 'Triggers PAYMENT_ACTION signal when action targets checkout, payment, or financial flows.',
    evaluate: (context, signalConfig) => {
      const config = signalConfig ?? INITIAL_RISK_SIGNALS[RiskSignalId.PAYMENT_ACTION];
      const tokens = extractActionTokens(context.action);
      const isPayment =
        context.classification?.category === ActionCategory.PAYMENT ||
        context.action.category === ActionCategory.PAYMENT ||
        hasAnyToken(tokens, ['pay', 'payment', 'checkout', 'purchase', 'buy', 'transfer']);

      if (isPayment) {
        return {
          matched: true,
          ruleId: 'RISK_RULE_PAYMENT',
          signalId: RiskSignalId.PAYMENT_ACTION,
          scoreContribution: config.scoreContribution,
          reason: config.reason,
        };
      }

      return { matched: false };
    },
  },

  /**
   * Rule: Phishing & Deceptive Website Indicators
   * Score contribution: +35
   * Priority: 85
   */
  {
    id: 'RISK_RULE_PHISHING_INDICATOR',
    signalId: RiskSignalId.PHISHING_INDICATOR,
    priority: 85,
    description: 'Triggers PHISHING_INDICATOR signal when action occurs on a page with identity inconsistencies, insecure login contexts, or cross-origin form exfiltration.',
    evaluate: (context, signalConfig) => {
      const config = signalConfig ?? INITIAL_RISK_SIGNALS[RiskSignalId.PHISHING_INDICATOR];
      const pageUrl = context.action.page?.url;

      if (pageUrl) {
        try {
          const phishingResult = evaluatePhishingIndicators({
            pageUrl,
            pageTitle: context.action.page?.title,
            pageMetaBranding: context.action.page?.metaBranding,
            faviconUrl: context.action.page?.faviconUrl,
            formAction: context.action.element?.formAction,
            formMethod: context.action.element?.formMethod,
            hasPasswordField: context.action.element?.hasPasswordField,
            hasUsernameField: context.action.element?.hasUsernameField,
            targetUrl: context.action.element?.targetUrl,
            isSecureContext: context.action.page?.isSecureContext,
          });

          if (phishingResult.isPhishingSuspected) {
            const detailReason = phishingResult.reasons.length > 0
              ? phishingResult.reasons.join('; ')
              : config.reason;

            const structuredReasons: EvaluationReason[] = (phishingResult.structuredReasons || []).map((ind) => ({
              code: `INDICATOR_${ind.code}`,
              message: ind.reason,
              ruleId: 'RISK_RULE_PHISHING_INDICATOR',
              signalId: RiskSignalId.PHISHING_INDICATOR,
              severity: ind.scoreContribution >= 50 ? RiskLevel.HIGH : ind.scoreContribution >= 25 ? RiskLevel.MEDIUM : RiskLevel.LOW,
              scoreContribution: ind.scoreContribution,
            }));

            // Scale score dynamically based on compound indicators when enabled, respecting disabled overrides (0)
            const scoreContribution = config.scoreContribution;

            return {
              matched: true,
              ruleId: 'RISK_RULE_PHISHING_INDICATOR',
              signalId: RiskSignalId.PHISHING_INDICATOR,
              scoreContribution,
              reason: detailReason,
              reasons: phishingResult.reasons,
              structuredReasons,
            };
          }
        } catch {
          return { matched: false };
        }
      }

      return { matched: false };
    },
  },

  /**
   * Rule: Authentication Action
   * Score contribution: +20
   * Priority: 80
   */
  {
    id: 'RISK_RULE_AUTHENTICATION',
    signalId: RiskSignalId.AUTHENTICATION_ACTION,
    priority: 80,
    description: 'Triggers AUTHENTICATION_ACTION signal when action interacts with login, credentials, or session boundaries.',
    evaluate: (context, signalConfig) => {
      const config = signalConfig ?? INITIAL_RISK_SIGNALS[RiskSignalId.AUTHENTICATION_ACTION];
      const tokens = extractActionTokens(context.action);
      const isAuth =
        context.classification?.category === ActionCategory.AUTHENTICATION ||
        context.action.category === ActionCategory.AUTHENTICATION ||
        hasAnyToken(tokens, ['login', 'log in', 'sign in', 'signin', 'authenticate', 'password', '2fa']);

      if (isAuth) {
        return {
          matched: true,
          ruleId: 'RISK_RULE_AUTHENTICATION',
          signalId: RiskSignalId.AUTHENTICATION_ACTION,
          scoreContribution: config.scoreContribution,
          reason: config.reason,
        };
      }

      return { matched: false };
    },
  },

  /**
   * Rule: External Navigation Action
   * Score contribution: +20
   * Priority: 70
   */
  {
    id: 'RISK_RULE_EXTERNAL_NAVIGATION',
    signalId: RiskSignalId.EXTERNAL_NAVIGATION,
    priority: 70,
    description: 'Triggers EXTERNAL_NAVIGATION signal when action redirects or navigates to an external origin.',
    evaluate: (context, signalConfig) => {
      const config = signalConfig ?? INITIAL_RISK_SIGNALS[RiskSignalId.EXTERNAL_NAVIGATION];
      const tokens = extractActionTokens(context.action);
      let isExternal =
        context.classification?.category === ActionCategory.EXTERNAL_NAVIGATION ||
        context.action.category === ActionCategory.EXTERNAL_NAVIGATION ||
        hasAnyToken(tokens, ['external', 'third-party', 'redirect', 'leave site']);

      // Also evaluate URL boundaries if previousUrl and current url exist
      if (!isExternal && context.action.page?.url && context.action.page?.previousUrl) {
        try {
          const currentOrigin = new URL(context.action.page.url).origin;
          const prevOrigin = new URL(context.action.page.previousUrl).origin;
          if (currentOrigin !== prevOrigin && prevOrigin !== 'null' && currentOrigin !== 'null') {
            isExternal = true;
          }
        } catch {
          // If URL parsing fails, default to false without throwing
        }
      }

      if (isExternal) {
        return {
          matched: true,
          ruleId: 'RISK_RULE_EXTERNAL_NAVIGATION',
          signalId: RiskSignalId.EXTERNAL_NAVIGATION,
          scoreContribution: config.scoreContribution,
          reason: config.reason,
        };
      }

      return { matched: false };
    },
  },

  /**
   * Rule: Suspicious URL / Hostname
   * Score contribution: +25
   * Priority: 75
   */
  {
    id: 'RISK_RULE_SUSPICIOUS_URL',
    signalId: RiskSignalId.SUSPICIOUS_URL,
    priority: 75,
    description: 'Triggers SUSPICIOUS_URL signal when action targets a URL displaying deceptive domain patterns, raw IP address, homoglyphs, or suspicious characteristics.',
    evaluate: (context, signalConfig) => {
      const config = signalConfig ?? INITIAL_RISK_SIGNALS[RiskSignalId.SUSPICIOUS_URL];
      const targetCandidate = context.action.element?.targetUrl || context.action.page?.url;

      if (targetCandidate) {
        try {
          const evalResult = evaluateSuspiciousUrl(targetCandidate);
          if (evalResult.isSuspicious) {
            const detailReason = evalResult.reasons.length > 0
              ? evalResult.reasons.join('; ')
              : config.reason;

            const structuredReasons: EvaluationReason[] = (evalResult.structuredReasons || []).map((ind) => ({
              code: `INDICATOR_${ind.code}`,
              message: ind.reason,
              ruleId: 'RISK_RULE_SUSPICIOUS_URL',
              signalId: RiskSignalId.SUSPICIOUS_URL,
              severity: ind.scoreContribution >= 40 ? RiskLevel.HIGH : ind.scoreContribution >= 20 ? RiskLevel.MEDIUM : RiskLevel.LOW,
              scoreContribution: ind.scoreContribution,
            }));

            // Scale score dynamically based on corroborating indicators when enabled, respecting disabled overrides (0)
            const scoreContribution = config.scoreContribution;

            return {
              matched: true,
              ruleId: 'RISK_RULE_SUSPICIOUS_URL',
              signalId: RiskSignalId.SUSPICIOUS_URL,
              scoreContribution,
              reason: detailReason,
              reasons: evalResult.reasons,
              structuredReasons,
            };
          }
        } catch {
          return { matched: false };
        }
      }

      return { matched: false };
    },
  },

  /**
   * Rule: Download Action
   * Score contribution: +10
   * Priority: 60
   */
  {
    id: 'RISK_RULE_DOWNLOAD',
    signalId: RiskSignalId.DOWNLOAD_ACTION,
    priority: 60,
    description: 'Triggers DOWNLOAD_ACTION signal when action initiates file downloads or document exports.',
    evaluate: (context, signalConfig) => {
      const config = signalConfig ?? INITIAL_RISK_SIGNALS[RiskSignalId.DOWNLOAD_ACTION];
      const tokens = extractActionTokens(context.action);
      const isDownload =
        context.classification?.category === ActionCategory.DOWNLOAD ||
        context.action.category === ActionCategory.DOWNLOAD ||
        hasAnyToken(tokens, ['download', 'export', 'save file']);

      if (isDownload) {
        return {
          matched: true,
          ruleId: 'RISK_RULE_DOWNLOAD',
          signalId: RiskSignalId.DOWNLOAD_ACTION,
          scoreContribution: config.scoreContribution,
          reason: config.reason,
        };
      }

      return { matched: false };
    },
  },
]);

/**
 * Pure evaluation helper that executes risk rules against an action context
 * in deterministic priority order (descending).
 *
 * Guarantees:
 * 1. Deterministic evaluation sequence: Higher-priority rules evaluate first.
 * 2. Exception isolation: Rule errors are caught and safely bypassed without corrupting remaining rules.
 * 3. Shape validation: Corrupted or invalid rule results (non-object, NaN scores) are safely sanitized.
 *
 * @param context The action and classification context.
 * @param overrides Optional custom score contribution overrides.
 * @param rules Optional custom rule set (defaults to INITIAL_RISK_RULES).
 * @returns Array of valid matched rule results in deterministic order.
 */
export function evaluateAllRiskRules(
  context: RiskRuleEvaluationContext,
  overrides?: RiskSignalOverrides,
  rules: readonly RiskRule[] = INITIAL_RISK_RULES
): RiskRuleResult[] {
  const results: RiskRuleResult[] = [];

  // Sort rules deterministically by priority descending; preserve order on ties
  const orderedRules = [...rules].sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));

  for (const rule of orderedRules) {
    try {
      const config = getRiskSignalDefinition(rule.signalId, overrides);
      const result = rule.evaluate(context, config);

      if (result && typeof result === 'object' && result.matched === true && result.signalId) {
        const rawScore = result.scoreContribution ?? config.scoreContribution;
        const scoreContribution =
          typeof rawScore === 'number' && !isNaN(rawScore)
            ? clampRiskScore(rawScore)
            : config.scoreContribution;

        results.push({
          matched: true,
          ruleId: result.ruleId ?? rule.id,
          signalId: result.signalId,
          scoreContribution,
          reason: result.reason ?? config.reason,
        });
      }
    } catch {
      // Individual rule failure isolated; remaining rules continue
      continue;
    }
  }

  return results;
}
