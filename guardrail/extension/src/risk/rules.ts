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

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
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
   * Rule: Payment Action
   * Score contribution: +40
   */
  {
    id: 'RISK_RULE_PAYMENT',
    signalId: RiskSignalId.PAYMENT_ACTION,
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
          signalId: RiskSignalId.PAYMENT_ACTION,
          scoreContribution: config.scoreContribution,
          reason: config.reason,
        };
      }

      return { matched: false };
    },
  },

  /**
   * Rule: Destructive Action
   * Score contribution: +50
   */
  {
    id: 'RISK_RULE_DESTRUCTIVE',
    signalId: RiskSignalId.DESTRUCTIVE_ACTION,
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
          signalId: RiskSignalId.DESTRUCTIVE_ACTION,
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
   */
  {
    id: 'RISK_RULE_AUTHENTICATION',
    signalId: RiskSignalId.AUTHENTICATION_ACTION,
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
          signalId: RiskSignalId.AUTHENTICATION_ACTION,
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
   */
  {
    id: 'RISK_RULE_DOWNLOAD',
    signalId: RiskSignalId.DOWNLOAD_ACTION,
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
          signalId: RiskSignalId.DOWNLOAD_ACTION,
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
   */
  {
    id: 'RISK_RULE_EXTERNAL_NAVIGATION',
    signalId: RiskSignalId.EXTERNAL_NAVIGATION,
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
          signalId: RiskSignalId.EXTERNAL_NAVIGATION,
          scoreContribution: config.scoreContribution,
          reason: config.reason,
        };
      }

      return { matched: false };
    },
  },
]);

/**
 * Pure evaluation helper that executes all risk rules against an action context.
 *
 * @param context The action and classification context.
 * @param overrides Optional custom score contribution overrides.
 * @returns Array of matched rule results.
 */
export function evaluateAllRiskRules(
  context: RiskRuleEvaluationContext,
  overrides?: RiskSignalOverrides
): RiskRuleResult[] {
  const results: RiskRuleResult[] = [];

  for (const rule of INITIAL_RISK_RULES) {
    const config = getRiskSignalDefinition(rule.signalId, overrides);
    const result = rule.evaluate(context, config);
    if (result.matched) {
      results.push(result);
    }
  }

  return results;
}
