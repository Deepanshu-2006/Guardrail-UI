/**
 * Guardrail Deterministic Response Rules
 *
 * Provides centralized, configurable mapping from evaluated RiskLevels to ResponseActions.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. SEPARATION OF CONCERNS: Response policies define WHAT ACTION TO TAKE, strictly decoupled
 *    from the Risk Engine which defines HOW SENSITIVE THE ACTION IS.
 * 2. IMMUTABILITY: Response rules must never mutate the incoming RiskAssessment.
 * 3. CONFIGURABILITY: Mappings are development policies that can be adjusted per environment
 *    or organization without changing risk assessment algorithms.
 *
 * INITIAL DEVELOPMENT RESPONSE MAPPINGS:
 * - LOW      → ALLOW   (routine interactions proceed seamlessly)
 * - MEDIUM   → WARN    (advisory notice; user attention recommended)
 * - HIGH     → WARN    (elevated risk; prompt/inform user without immediate gating)
 * - CRITICAL → PROTECT (maximum impact; requires protective mechanism before proceeding)
 */

import { RiskAssessment, RiskLevel } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';

/**
 * Mapping configuration associating each RiskLevel with a canonical ResponseAction.
 */
export type ResponsePolicyMapping = Record<RiskLevel, ResponseAction>;

/**
 * Default centralized response policy mapping.
 */
export const DEFAULT_RESPONSE_POLICY: Readonly<ResponsePolicyMapping> = Object.freeze({
  [RiskLevel.LOW]: ResponseAction.ALLOW,
  [RiskLevel.MEDIUM]: ResponseAction.WARN,
  [RiskLevel.HIGH]: ResponseAction.WARN,
  [RiskLevel.CRITICAL]: ResponseAction.PROTECT,
});

/**
 * Context provided for evaluating response rules.
 */
export interface ResponseRuleContext {
  /** The evaluated risk assessment (immutable) */
  readonly assessment: Readonly<RiskAssessment>;
}

/**
 * Result produced by evaluating response rules against a risk assessment.
 */
export interface ResponseRuleResult {
  /** The determined operational response action */
  readonly action: ResponseAction;

  /** Human-readable explanation justifying the response decision */
  readonly reason: string;

  /** Identifier of the response rule that rendered this decision */
  readonly ruleId?: string;
}

/**
 * Specification for a deterministic response rule.
 */
export interface ResponseRule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  evaluate: (
    context: ResponseRuleContext,
    policy?: ResponsePolicyMapping
  ) => ResponseRuleResult;
}

/**
 * Generates an informative, explainable reason for the selected response action.
 */
export function generateResponseReason(
  action: ResponseAction,
  assessment: Readonly<RiskAssessment>
): string {
  switch (action) {
    case ResponseAction.ALLOW:
      return `Action permitted without intervention: Risk level is ${assessment.riskLevel} (score: ${assessment.score}).`;

    case ResponseAction.WARN:
      return `User advisory recommended: Action evaluated as ${assessment.riskLevel} risk (score: ${assessment.score}).`;

    case ResponseAction.PROTECT:
      return `Protective mechanism required: Action evaluated as ${assessment.riskLevel} risk (score: ${assessment.score}).`;

    default:
      return `Default fallback response applied for risk level ${assessment.riskLevel}.`;
  }
}

/**
 * Primary deterministic response rule mapping RiskLevel to ResponseAction.
 */
export const CoreRiskLevelResponseRule: ResponseRule = Object.freeze({
  id: 'RULE_CORE_RISK_LEVEL_RESPONSE',
  name: 'Core Risk Level Response Rule',
  description: 'Maps the evaluated RiskLevel to a ResponseAction based on the active response policy.',
  evaluate: (
    context: ResponseRuleContext,
    policy: ResponsePolicyMapping = DEFAULT_RESPONSE_POLICY
  ): ResponseRuleResult => {
    const riskLevel = context.assessment?.riskLevel;
    const mapped = riskLevel && riskLevel in policy ? policy[riskLevel] : undefined;

    // FAIL-CLOSED INVARIANT:
    // If risk level is missing, invalid, or unmapped in policy, NEVER silently default to ALLOW.
    // Strictly fail closed to PROTECT.
    const isFailClosed = mapped === undefined;
    const responseAction = mapped ?? ResponseAction.PROTECT;

    const reason = isFailClosed
      ? `Protective mechanism required: Unrecognized or unmapped risk level "${String(riskLevel)}" resolved fail-closed to PROTECT.`
      : generateResponseReason(responseAction, context.assessment);

    return {
      action: responseAction,
      reason,
      ruleId: isFailClosed ? 'RULE_FAIL_CLOSED_FALLBACK' : 'RULE_CORE_RISK_LEVEL_RESPONSE',
    };
  },
});

/**
 * Evaluates the appropriate ResponseAction for a RiskAssessment under a given policy.
 * Pure function: Does not mutate the input assessment.
 *
 * @param assessment The evaluated risk assessment.
 * @param policy Optional custom response policy mapping.
 * @returns ResponseRuleResult with selected ResponseAction and explanation.
 */
export function evaluateResponseAction(
  assessment: Readonly<RiskAssessment>,
  policy: ResponsePolicyMapping = DEFAULT_RESPONSE_POLICY
): ResponseRuleResult {
  return CoreRiskLevelResponseRule.evaluate({ assessment }, policy);
}
