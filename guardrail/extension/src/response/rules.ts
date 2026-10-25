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
 * Deterministic precedence hierarchy for ResponseAction decisions.
 *
 * Conflict Resolution Policy:
 * 1. PROTECT (Priority 300) > WARN (Priority 200) > ALLOW (Priority 100).
 * 2. Monotonic Protection Invariant: If ANY matching rule yields PROTECT,
 *    the resolved decision MUST be PROTECT. An ordinary WARN or ALLOW rule
 *    can never downgrade a PROTECT decision.
 * 3. Advisory Invariant: A WARN rule takes precedence over ALLOW. An ALLOW rule
 *    can never downgrade a WARN decision.
 * 4. Tie-breaking: When multiple rules match and produce the same highest action,
 *    the rule with the highest rule priority (or first registered in deterministic order)
 *    is designated as the primary resolving rule.
 * 5. Complete Attribution: Reasons and rule identifiers from ALL matching rules are
 *    retained in the composite result for auditing.
 */
export const RESPONSE_ACTION_PRECEDENCE: Readonly<Record<ResponseAction, number>> = Object.freeze({
  [ResponseAction.PROTECT]: 300,
  [ResponseAction.WARN]: 200,
  [ResponseAction.ALLOW]: 100,
});

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
  /** Deterministic rule priority (higher numbers evaluate first; default: 100) */
  readonly priority?: number;
  evaluate: (
    context: ResponseRuleContext,
    policy?: ResponsePolicyMapping
  ) => ResponseRuleResult | null | undefined;
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
 * Priority: 100 (standard tier).
 */
export const CoreRiskLevelResponseRule: ResponseRule = Object.freeze({
  id: 'RULE_CORE_RISK_LEVEL_RESPONSE',
  name: 'Core Risk Level Response Rule',
  description: 'Maps the evaluated RiskLevel to a ResponseAction based on the active response policy.',
  priority: 100,
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
 * Dedicated protection rule that explicitly mandates PROTECT whenever
 * the evaluated risk reaches CRITICAL level or score >= 75.
 * Priority: 200 (elevated protection tier).
 */
export const CriticalRiskProtectionRule: ResponseRule = Object.freeze({
  id: 'RULE_CRITICAL_RISK_PROTECTION',
  name: 'Critical Risk Protection Rule',
  description: 'Guarantees that any action reaching CRITICAL severity triggers Staging Mode and requires protective authorization.',
  priority: 200,
  evaluate: (context: ResponseRuleContext): ResponseRuleResult | null => {
    const assessment = context.assessment;
    if (assessment?.riskLevel === RiskLevel.CRITICAL || (typeof assessment?.score === 'number' && assessment.score >= 75)) {
      return {
        action: ResponseAction.PROTECT,
        reason: `Protective mechanism required: Action evaluated at critical severity (level: ${assessment.riskLevel}, score: ${assessment.score}).`,
        ruleId: 'RULE_CRITICAL_RISK_PROTECTION',
      };
    }
    return null;
  },
});

/**
 * Default collection of response rules evaluated in deterministic order.
 */
export const DEFAULT_RESPONSE_RULES: readonly ResponseRule[] = Object.freeze([
  CoreRiskLevelResponseRule,
]);

/**
 * Resolved outcome from evaluating multiple response rules through deterministic precedence.
 */
export interface ResolvedResponsePrecedence {
  /** The single deterministic operational response action */
  readonly action: ResponseAction;

  /** Primary explanation justifying the winning decision */
  readonly reason: string;

  /** Primary rule identifier that resolved the decision */
  readonly ruleId: string;

  /** All rule identifiers that matched during evaluation */
  readonly matchedRuleIds: readonly string[];

  /** All rationales compiled across all matching rules */
  readonly allReasons: readonly string[];

  /** Discrete outcomes with rule attribution */
  readonly matchedOutcomes: readonly (ResponseRuleResult & { rulePriority: number })[];
}

/**
 * Resolves deterministic precedence among multiple matching response rule outcomes.
 *
 * Conflict Resolution Invariant:
 * 1. PROTECT (300) > WARN (200) > ALLOW (100).
 * 2. An ordinary warning CANNOT silently downgrade a protection decision.
 * 3. An allow decision CANNOT silently downgrade a warning or protection decision.
 * 4. Ties at the highest precedence resolve to the rule with the highest priority.
 *
 * @param outcomes Array of rule results with associated rule priorities.
 * @param assessment The evaluated risk assessment for context and fail-closed checks.
 * @returns Strongly typed ResolvedResponsePrecedence.
 */
export function resolveResponsePrecedence(
  outcomes: readonly (ResponseRuleResult & { rulePriority?: number })[],
  assessment?: Readonly<RiskAssessment>
): ResolvedResponsePrecedence {
  // 1. Filter valid outcomes
  const valid = outcomes.filter((o) => {
    if (!o || typeof o !== 'object') return false;
    return (
      o.action === ResponseAction.ALLOW ||
      o.action === ResponseAction.WARN ||
      o.action === ResponseAction.PROTECT
    );
  });

  // 2. Fallback when no valid rule returned an outcome
  if (valid.length === 0) {
    const isUpstreamFailure =
      assessment?.status === 'FAILED' || assessment?.success === false;
    const fallbackAction = isUpstreamFailure ? ResponseAction.PROTECT : ResponseAction.ALLOW;
    const fallbackRuleId = isUpstreamFailure ? 'RULE_FAIL_CLOSED_FALLBACK' : 'RULE_DEFAULT_ALLOW';
    const fallbackReason = isUpstreamFailure
      ? 'Protective mechanism required: Upstream evaluation failure resolved fail-closed to PROTECT.'
      : 'Action permitted by default: No matching response rules triggered.';

    return {
      action: fallbackAction,
      reason: fallbackReason,
      ruleId: fallbackRuleId,
      matchedRuleIds: [fallbackRuleId],
      allReasons: [fallbackReason],
      matchedOutcomes: [],
    };
  }

  // 3. Find highest action precedence (PROTECT: 300 > WARN: 200 > ALLOW: 100)
  let maxPrecedence = -1;
  for (const item of valid) {
    const prec = RESPONSE_ACTION_PRECEDENCE[item.action] ?? 0;
    if (prec > maxPrecedence) {
      maxPrecedence = prec;
    }
  }

  // Filter outcomes that matched the highest action precedence
  const highestPrecedenceOutcomes = valid.filter(
    (o) => (RESPONSE_ACTION_PRECEDENCE[o.action] ?? 0) === maxPrecedence
  );

  // 4. Tie-breaking: Sort by rulePriority descending (default 100)
  highestPrecedenceOutcomes.sort((a, b) => (b.rulePriority ?? 100) - (a.rulePriority ?? 100));

  const winningOutcome = highestPrecedenceOutcomes[0];
  const winningAction = winningOutcome.action;
  const winningRuleId = winningOutcome.ruleId || 'RULE_UNKNOWN_RESPONSE';
  const winningReason = winningOutcome.reason;

  const matchedRuleIds = valid.map((o) => o.ruleId || 'RULE_UNKNOWN');
  const allReasons = valid.map((o) => o.reason).filter((r): r is string => Boolean(r));

  // 5. SECURITY INVARIANT CHECK:
  // If ANY rule produced PROTECT, winning action MUST be PROTECT.
  // Warning rules can NEVER downgrade a protection decision!
  const hadProtect = valid.some((o) => o.action === ResponseAction.PROTECT);
  if (hadProtect && winningAction !== ResponseAction.PROTECT) {
    return {
      action: ResponseAction.PROTECT,
      reason: 'Protective mechanism required: Monotonic protection invariant enforced (PROTECT cannot be downgraded).',
      ruleId: 'RULE_FAIL_CLOSED_FALLBACK',
      matchedRuleIds,
      allReasons,
      matchedOutcomes: valid.map((o) => ({ ...o, rulePriority: o.rulePriority ?? 100 })),
    };
  }

  return {
    action: winningAction,
    reason: winningReason,
    ruleId: winningRuleId,
    matchedRuleIds,
    allReasons,
    matchedOutcomes: valid.map((o) => ({ ...o, rulePriority: o.rulePriority ?? 100 })),
  };
}

/**
 * Evaluates all configured response rules in deterministic priority order
 * and resolves conflicts using strict precedence rules.
 *
 * @param context Response rule context containing the immutable risk assessment.
 * @param rules Array of response rules (defaults to DEFAULT_RESPONSE_RULES).
 * @param policy Optional custom response policy mapping.
 * @returns Complete ResolvedResponsePrecedence.
 */
export function evaluateAllResponseRules(
  context: ResponseRuleContext,
  rules: readonly ResponseRule[] = DEFAULT_RESPONSE_RULES,
  policy: ResponsePolicyMapping = DEFAULT_RESPONSE_POLICY
): ResolvedResponsePrecedence {
  // Sort rules deterministically by priority descending
  const orderedRules = [...rules].sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
  const outcomes: (ResponseRuleResult & { rulePriority: number })[] = [];

  for (const rule of orderedRules) {
    try {
      const result = rule.evaluate(context, policy);
      if (result && typeof result === 'object' && 'action' in result) {
        outcomes.push({
          ...result,
          ruleId: result.ruleId ?? rule.id,
          rulePriority: rule.priority ?? 100,
        });
      }
    } catch {
      // Individual rule failure isolated; remaining rules continue
      continue;
    }
  }

  return resolveResponsePrecedence(outcomes, context.assessment);
}

/**
 * Functional convenience helper to evaluate response rules under a policy.
 * Preserved for backward compatibility.
 *
 * @param assessment The evaluated risk assessment.
 * @param policy Optional custom response policy mapping.
 * @returns ResponseRuleResult with selected ResponseAction and explanation.
 */
export function evaluateResponseAction(
  assessment: Readonly<RiskAssessment>,
  policy: ResponsePolicyMapping = DEFAULT_RESPONSE_POLICY
): ResponseRuleResult {
  const resolved = evaluateAllResponseRules({ assessment }, DEFAULT_RESPONSE_RULES, policy);
  return {
    action: resolved.action,
    reason: resolved.reason,
    ruleId: resolved.ruleId,
  };
}
