/**
 * Guardrail Action Classification Rules
 *
 * Provides a modular, rule-based heuristic specification for classifying
 * Guardrail actions into semantic categories based on safe metadata.
 */

import { ActionCategory, GuardrailAction } from '../types/actions.js';

/**
 * Result returned from evaluating a single classification rule against an action.
 */
export interface RuleEvaluationResult {
  /** True if the rule conditions matched the action */
  matched: boolean;

  /** Non-sensitive explanation or matched token for audit/debugging */
  reason?: string;
}

/**
 * Interface representing a modular classification rule.
 */
export interface ClassificationRule {
  /** Unique machine-readable rule identifier (e.g., 'PAYMENT_KEYWORD_RULE') */
  id: string;

  /** The semantic category assigned when this rule matches */
  category: ActionCategory;

  /** Human-readable description of what this rule inspects */
  description: string;

  /** Evaluation logic to determine if an action matches this rule */
  evaluate: (action: GuardrailAction) => RuleEvaluationResult;
}

/**
 * Helper to extract safe, searchable text tokens from an action without inspecting input values.
 */
function extractSearchableTokens(action: GuardrailAction): string[] {
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

  if (action.page.title) {
    tokens.push(action.page.title.toLowerCase().trim());
  }

  if (action.page.url) {
    try {
      const parsedUrl = new URL(action.page.url);
      tokens.push(parsedUrl.pathname.toLowerCase());
    } catch {
      // Ignore URL parsing errors for non-standard schemes
    }
  }

  return tokens;
}

/**
 * Helper to match any keyword against the action's searchable metadata tokens.
 * Uses case-insensitive word or substring matching.
 */
function matchesAnyKeyword(tokens: string[], keywords: string[]): { matched: boolean; matchedKeyword?: string } {
  for (const keyword of keywords) {
    const normalizedKeyword = keyword.toLowerCase();
    for (const token of tokens) {
      if (token.includes(normalizedKeyword)) {
        return { matched: true, matchedKeyword: keyword };
      }
    }
  }
  return { matched: false };
}

/**
 * Rule: PAYMENT
 * Matches actions involving checkout, fund transfers, purchases, and payments.
 */
export const PAYMENT_KEYWORDS: readonly string[] = [
  'pay',
  'payment',
  'purchase',
  'checkout',
  'transfer',
  'buy',
];

export const PaymentRule: ClassificationRule = {
  id: 'RULE_PAYMENT_KEYWORDS',
  category: ActionCategory.PAYMENT,
  description: 'Matches keywords related to payments, billing, checkout, and money transfers',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    const tokens = extractSearchableTokens(action);
    const { matched, matchedKeyword } = matchesAnyKeyword(tokens, [...PAYMENT_KEYWORDS]);
    if (matched) {
      return {
        matched: true,
        reason: `Matched payment keyword "${matchedKeyword}" in action metadata`,
      };
    }
    return { matched: false };
  },
};

/**
 * Rule: AUTHENTICATION
 * Matches actions involving sign-in, login, registration, and identity verification.
 */
export const AUTH_KEYWORDS: readonly string[] = [
  'login',
  'log in',
  'sign in',
  'authenticate',
  'verify',
];

export const AuthenticationRule: ClassificationRule = {
  id: 'RULE_AUTH_KEYWORDS',
  category: ActionCategory.AUTHENTICATION,
  description: 'Matches keywords related to user sign-in, login, and identity verification',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    const tokens = extractSearchableTokens(action);
    const { matched, matchedKeyword } = matchesAnyKeyword(tokens, [...AUTH_KEYWORDS]);
    if (matched) {
      return {
        matched: true,
        reason: `Matched authentication keyword "${matchedKeyword}" in action metadata`,
      };
    }
    return { matched: false };
  },
};

/**
 * Rule: DESTRUCTIVE
 * Matches actions involving permanent deletions, item removals, and account closures.
 */
export const DESTRUCTIVE_KEYWORDS: readonly string[] = [
  'delete',
  'remove',
  'permanently delete',
  'close account',
];

export const DestructiveRule: ClassificationRule = {
  id: 'RULE_DESTRUCTIVE_KEYWORDS',
  category: ActionCategory.DESTRUCTIVE,
  description: 'Matches keywords related to deletion, removal, and account closure',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    const tokens = extractSearchableTokens(action);
    const { matched, matchedKeyword } = matchesAnyKeyword(tokens, [...DESTRUCTIVE_KEYWORDS]);
    if (matched) {
      return {
        matched: true,
        reason: `Matched destructive keyword "${matchedKeyword}" in action metadata`,
      };
    }
    return { matched: false };
  },
};

/**
 * Rule: DOWNLOAD
 * Matches actions involving file downloads, data exports, and file saving.
 */
export const DOWNLOAD_KEYWORDS: readonly string[] = [
  'download',
  'export',
  'save file',
];

export const DownloadRule: ClassificationRule = {
  id: 'RULE_DOWNLOAD_KEYWORDS',
  category: ActionCategory.DOWNLOAD,
  description: 'Matches keywords related to file downloads, data exports, and file saving',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    const tokens = extractSearchableTokens(action);
    const { matched, matchedKeyword } = matchesAnyKeyword(tokens, [...DOWNLOAD_KEYWORDS]);
    if (matched) {
      return {
        matched: true,
        reason: `Matched download keyword "${matchedKeyword}" in action metadata`,
      };
    }
    return { matched: false };
  },
};

/**
 * Rule: EXTERNAL_NAVIGATION
 * Matches navigation or link traversal that departs from the current origin/site context,
 * or elements explicitly targeting external destinations.
 */
export const EXTERNAL_KEYWORDS: readonly string[] = [
  'external',
  'third-party',
  'redirect',
  'leave site',
];

export const ExternalNavigationRule: ClassificationRule = {
  id: 'RULE_EXTERNAL_NAVIGATION',
  category: ActionCategory.EXTERNAL_NAVIGATION,
  description: 'Matches navigation events or links where the target domain or metadata indicates external departure',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    // 1. Keyword check in metadata tokens (e.g. id="external-link", text="External Navigation")
    const tokens = extractSearchableTokens(action);
    const { matched, matchedKeyword } = matchesAnyKeyword(tokens, [...EXTERNAL_KEYWORDS]);
    if (matched) {
      return {
        matched: true,
        reason: `Matched external navigation keyword "${matchedKeyword}" in action metadata`,
      };
    }

    // 2. Navigation crossing origin boundaries
    if (action.page.url && action.page.previousUrl) {
      try {
        const currentOrigin = new URL(action.page.url).origin;
        const previousOrigin = new URL(action.page.previousUrl).origin;

        if (currentOrigin !== previousOrigin && previousOrigin !== 'null' && currentOrigin !== 'null') {
          return {
            matched: true,
            reason: `Navigation crossed site origin boundary from ${previousOrigin} to ${currentOrigin}`,
          };
        }
      } catch {
        // Ignore invalid URL parse attempts
      }
    }

    return { matched: false };
  },
};

/**
 * Fallback Rule: GENERAL
 * Default category when no specialized heuristic rules match.
 */
export const GeneralFallbackRule: ClassificationRule = {
  id: 'RULE_GENERAL_FALLBACK',
  category: ActionCategory.GENERAL,
  description: 'Default category assigned when no specific category rules match',
  evaluate: (_action: GuardrailAction): RuleEvaluationResult => {
    return {
      matched: true,
      reason: 'No specialized classification rules matched; defaulted to GENERAL',
    };
  },
};

/**
 * Ordered list of classification rules.
 * Rules are evaluated in priority order; first match wins before falling back to GENERAL.
 */
export const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  PaymentRule,
  AuthenticationRule,
  DestructiveRule,
  DownloadRule,
  ExternalNavigationRule,
  GeneralFallbackRule,
];
