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
import { RiskSignalDefinition, RiskSignalId } from '../types/risk.js';
import { getRiskSignalDefinition, INITIAL_RISK_SIGNALS, RiskSignalOverrides } from './signals.js';

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
