/**
 * Guardrail Action Classifier
 *
 * Evaluates normalized Guardrail actions against an ordered set of heuristic
 * classification rules to deterministically determine their semantic category.
 */

import { ActionCategory, GuardrailAction } from '../types/actions.js';
import { ActionClassificationResult } from '../types/classification.js';
import { CLASSIFICATION_RULES, ClassificationRule } from './rules.js';

/**
 * Evaluates a GuardrailAction against classification rules in sequential priority order.
 *
 * @param action - The normalized GuardrailAction to classify.
 * @param rules - Ordered array of classification rules (defaults to CLASSIFICATION_RULES).
 * @returns A strongly-typed ActionClassificationResult referencing the original actionId.
 */
export function classifyAction(
  action: GuardrailAction,
  rules: readonly ClassificationRule[] = CLASSIFICATION_RULES
): ActionClassificationResult {
  const timestamp = new Date().toISOString();

  // Evaluate rules in predictable priority order
  for (const rule of rules) {
    try {
      const evaluation = rule.evaluate(action);
      if (evaluation.matched) {
        return {
          actionId: action.id,
          category: rule.category,
          matchedRule: rule.id,
          classifiedAt: timestamp,
          reason: evaluation.reason,
          confidence: 1.0,
        };
      }
    } catch {
      // In case of any evaluation error on a custom rule, safely continue to next rule
      continue;
    }
  }

  // Guaranteed fallback in case custom rule array omitted the fallback rule
  return {
    actionId: action.id,
    category: ActionCategory.GENERAL,
    matchedRule: 'RULE_GENERAL_FALLBACK',
    classifiedAt: timestamp,
    reason: 'Default fallback category assigned',
    confidence: 1.0,
  };
}

/**
 * ActionClassifier class providing an encapsulated, state-free classifier service.
 */
export class ActionClassifier {
  private readonly rules: readonly ClassificationRule[];

  constructor(rules: readonly ClassificationRule[] = CLASSIFICATION_RULES) {
    this.rules = rules;
  }

  /**
   * Classify a given GuardrailAction.
   */
  public classify(action: GuardrailAction): ActionClassificationResult {
    return classifyAction(action, this.rules);
  }
}
