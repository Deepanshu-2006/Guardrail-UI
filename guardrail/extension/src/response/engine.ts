/**
 * Guardrail Response Engine
 *
 * Deterministic engine that evaluates a RiskAssessment against configured response policies
 * to determine the operational governance ResponseDecision (ALLOW, WARN, PROTECT).
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. SEPARATION OF CONCERNS: The Response Engine does not evaluate risk or inspect DOM elements.
 *    It consumes an immutable RiskAssessment and outputs a ResponseDecision.
 * 2. DETERMINISTIC & TESTABLE: The same RiskAssessment under the same policy will always produce
 *    the exact same ResponseAction and reasons.
 * 3. EXPLAINABLE: Every decision is accompanied by human-readable policy justifications.
 * 4. STRICT PRIVACY: Operates strictly on risk metadata; never handles credentials or secrets.
 */

import { GuardrailAction } from '../types/actions.js';
import { ActionClassificationResult } from '../types/classification.js';
import {
  EvaluationError,
  EvaluationReason,
  RiskAssessment,
  RiskEvaluationResult,
  RiskEvaluationStatus,
  RiskLevel,
} from '../types/risk.js';
import {
  ResponseAction,
  ResponseDecision,
  validateResponseAction,
} from '../types/response.js';
import { classifyAction } from '../classifier/index.js';
import { assessRisk, RiskEngineOptions } from '../risk/engine.js';
import {
  DEFAULT_RESPONSE_POLICY,
  DEFAULT_RESPONSE_RULES,
  evaluateAllResponseRules,
  ResponsePolicyMapping,
  ResponseRule,
} from './rules.js';
import { evaluatePolicies } from './policies.js';

/**
 * Creates a strongly typed, fail-closed ResponseDecision for an evaluation failure.
 *
 * SAFETY INVARIANT:
 * Evaluation failures must NEVER silently become ALLOW.
 * They strictly fail closed to PROTECT.
 */
export function createFailedResponseDecision(
  actionId: string,
  error: EvaluationError,
  assessment?: Readonly<RiskAssessment>
): ResponseDecision {
  const timestamp = new Date().toISOString();
  const safeActionId = typeof actionId === 'string' && actionId.trim() ? actionId.trim() : 'unknown-action';
  const errorMessage = `Policy evaluation failed [${error.code}]: ${error.message} (Resolved fail-closed to PROTECT).`;

  const reasons = [errorMessage];
  if (assessment?.reasons && Array.isArray(assessment.reasons)) {
    for (const r of assessment.reasons) {
      if (!reasons.includes(r)) {
        reasons.push(r);
      }
    }
  }

  return {
    actionId: safeActionId,
    response: ResponseAction.PROTECT, // Fail closed strictly to PROTECT! Never ALLOW!
    reasons,
    createdAt: timestamp,
    status: RiskEvaluationStatus.FAILED,
    success: false,
    policyRuleId: 'RULE_FAIL_CLOSED_FALLBACK',
    structuredReasons: [
      {
        code: error.code || 'POLICY_EVALUATION_FAILED',
        message: errorMessage,
        ruleId: 'RULE_FAIL_CLOSED_FALLBACK',
        severity: RiskLevel.CRITICAL,
      },
    ],
    error,
  };
}

/**
 * Configuration options for the ResponseEngine.
 */
export interface ResponseEngineOptions {
  /** Custom mapping from RiskLevel to ResponseAction */
  policy?: ResponsePolicyMapping;

  /** Configured response rules evaluated in deterministic precedence order */
  rules?: readonly ResponseRule[];
}

/**
 * Core Guardrail Response Engine implementation.
 */
export class ResponseEngine {
  private readonly policy: ResponsePolicyMapping;
  private readonly rules: readonly ResponseRule[];

  constructor(options?: ResponseEngineOptions) {
    this.policy = options?.policy ?? DEFAULT_RESPONSE_POLICY;
    this.rules = options?.rules ?? DEFAULT_RESPONSE_RULES;
  }

  /**
   * Evaluates a RiskAssessment to render an operational ResponseDecision.
   *
   * @param assessment The evaluated risk assessment (immutable).
   * @returns Strongly typed ResponseDecision.
   */
  public decide(assessment: Readonly<RiskAssessment>): ResponseDecision {
    const timestamp = new Date().toISOString();

    // 1. Guard against null, undefined, or missing actionId (fail-closed)
    if (!assessment || typeof assessment !== 'object' || typeof assessment.actionId !== 'string' || !assessment.actionId.trim()) {
      const actionId =
        assessment && typeof (assessment as any).actionId === 'string' && (assessment as any).actionId.trim()
          ? (assessment as any).actionId.trim()
          : 'unknown-action';

      return createFailedResponseDecision(actionId, {
        code: 'INVALID_ASSESSMENT_PAYLOAD',
        message: 'Cannot evaluate response policy: RiskAssessment is invalid, null, or missing actionId.',
      });
    }

    // 2. Guard against upstream risk evaluation failure (fail closed to PROTECT)
    if (assessment.status === RiskEvaluationStatus.FAILED || assessment.success === false) {
      return createFailedResponseDecision(
        assessment.actionId,
        assessment.error || {
          code: 'UPSTREAM_EVALUATION_FAILED',
          message: 'Upstream risk evaluation failed. Policy resolved fail-closed to PROTECT.',
        },
        assessment
      );
    }

    // 3. Apply configured response policy rules with deterministic precedence resolution
    const resolved = evaluateAllResponseRules(
      { assessment },
      this.rules,
      this.policy
    );

    const action = resolved.action;
    const policyReason = resolved.reason;
    const policyRuleId = resolved.ruleId;

    // 4. Compile comprehensive, explainable reasons
    const reasons: string[] = [policyReason];
    if (resolved.allReasons) {
      for (const r of resolved.allReasons) {
        if (!reasons.includes(r)) {
          reasons.push(r);
        }
      }
    }
    if (assessment.reasons && assessment.reasons.length > 0) {
      for (const r of assessment.reasons) {
        if (!reasons.includes(r)) {
          reasons.push(r);
        }
      }
    }

    // 5. Compile structured reasons
    const structuredReasons: EvaluationReason[] = [
      {
        code: `POLICY_${action}`,
        message: policyReason,
        ruleId: policyRuleId,
        severity: assessment.riskLevel,
      },
    ];

    if (resolved.matchedOutcomes) {
      for (const mo of resolved.matchedOutcomes) {
        if (mo.ruleId && mo.ruleId !== policyRuleId) {
          structuredReasons.push({
            code: `POLICY_RULE_${mo.action}`,
            message: mo.reason,
            ruleId: mo.ruleId,
            severity: assessment.riskLevel,
          });
        }
      }
    }

    if (assessment.structuredReasons && assessment.structuredReasons.length > 0) {
      for (const sr of assessment.structuredReasons) {
        structuredReasons.push(sr);
      }
    }

    // 6. Return the immutable ResponseDecision with preserved actionId and timestamp
    return {
      actionId: assessment.actionId,
      response: action,
      reasons,
      createdAt: timestamp,
      status: RiskEvaluationStatus.EVALUATED,
      success: true,
      policyRuleId,
      structuredReasons,
    };
  }
}

/**
 * Default singleton instance of the ResponseEngine using initial development policy mappings.
 */
export const defaultResponseEngine = new ResponseEngine();

/**
 * Functional convenience helper to evaluate a response decision.
 *
 * @param assessment The evaluated risk assessment.
 * @param options Optional configuration overrides.
 * @returns ResponseDecision.
 */
export function decideResponse(
  assessment: Readonly<RiskAssessment>,
  options?: ResponseEngineOptions
): ResponseDecision {
  if (!options) {
    return defaultResponseEngine.decide(assessment);
  }
  const engine = new ResponseEngine(options);
  return engine.decide(assessment);
}

/**
 * Creates a unified, strongly typed RiskEvaluationResult combining a RiskAssessment and ResponseDecision.
 *
 * @param assessment Evaluated risk assessment
 * @param decision Evaluated response decision
 * @returns Immutable RiskEvaluationResult
 */
export function createRiskEvaluationResult(
  assessment: Readonly<RiskAssessment>,
  decision: Readonly<ResponseDecision>
): RiskEvaluationResult {
  const isFailure =
    assessment.status === RiskEvaluationStatus.FAILED ||
    assessment.success === false ||
    decision.status === RiskEvaluationStatus.FAILED ||
    decision.success === false;

  const status = isFailure ? RiskEvaluationStatus.FAILED : RiskEvaluationStatus.EVALUATED;
  const success = !isFailure;

  // FAIL-CLOSED INVARIANT: In failure states, decision is strictly PROTECT.
  const effectiveDecision = isFailure ? ResponseAction.PROTECT : decision.response;

  const reasons = decision.reasons || assessment.reasons || [];
  const structuredReasons = decision.structuredReasons || assessment.structuredReasons || [];
  const matchedRules = assessment.matchedRules || [];
  const error = assessment.error || decision.error;

  return Object.freeze({
    actionId: assessment.actionId || decision.actionId,
    decision: effectiveDecision,
    status,
    success,
    riskLevel: assessment.riskLevel,
    score: assessment.score,
    reasons: Object.freeze([...reasons]),
    structuredReasons: Object.freeze([...structuredReasons]),
    matchedRules: Object.freeze([...matchedRules]),
    policyRuleId: decision.policyRuleId,
    evaluatedAt: decision.createdAt || assessment.evaluatedAt || new Date().toISOString(),
    error,
  });
}

/**
 * Convenience helper that evaluates an action through classification, risk assessment,
 * and response policy resolution to return the canonical RiskEvaluationResult contract.
 *
 * @param action Normalized interaction event
 * @param classification Optional pre-computed classification
 * @param riskOptions Optional risk engine configuration
 * @param responseOptions Optional response engine configuration
 * @returns Complete, strongly typed RiskEvaluationResult
 */
export function evaluateRiskAndDecision(
  action: GuardrailAction,
  classification?: ActionClassificationResult,
  riskOptions?: RiskEngineOptions,
  responseOptions?: ResponseEngineOptions
): RiskEvaluationResult {
  return evaluateActionPipeline(action, classification, riskOptions, responseOptions).evaluationResult;
}

/**
 * Result of the consolidated evaluation pipeline.
 * Contains both the discrete intermediate artifacts and the unified RiskEvaluationResult contract.
 */
export interface ConsolidatedEvaluationPipelineResult {
  readonly action: GuardrailAction;
  readonly classification: ActionClassificationResult;
  readonly risk: RiskAssessment;
  readonly decision: ResponseDecision;
  readonly evaluationResult: RiskEvaluationResult;
}

/**
 * Centralized evaluator consolidating action classification, prioritized risk rule evaluation,
 * and deterministic response policy resolution into a single canonical path.
 *
 * Guarantees:
 * 1. Consistent evaluation order across all callers.
 * 2. Action ID correlation validation.
 * 3. Fail-closed error handling (failures resolve to PROTECT).
 * 4. Deterministic conflict resolution (PROTECT > WARN > ALLOW).
 * 5. Monotonic protection preservation (warning cannot downgrade protection).
 *
 * @param action Normalized interaction event
 * @param classification Optional pre-computed classification
 * @param riskOptions Optional risk engine configuration
 * @param responseOptions Optional response engine configuration
 * @returns Complete consolidated pipeline evaluation result
 */
export function evaluateActionPipeline(
  action: GuardrailAction,
  classification?: ActionClassificationResult,
  riskOptions?: RiskEngineOptions,
  responseOptions?: ResponseEngineOptions
): ConsolidatedEvaluationPipelineResult {
  try {
    const resolvedClassification = classification ?? classifyAction(action);
    const risk = assessRisk(action, resolvedClassification, riskOptions);
    let decision = decideResponse(risk, responseOptions);

    // Apply canonical risk policies and preserve monotonic precedence
    const policyResults = evaluatePolicies(action, risk);
    const protectPolicy = policyResults.find((p) => p.decision === ResponseAction.PROTECT);
    const warnPolicy = policyResults.find((p) => p.decision === ResponseAction.WARN);
    const allowPolicy = policyResults.find((p) => p.decision === ResponseAction.ALLOW);

    if (protectPolicy && decision.response !== ResponseAction.PROTECT) {
      const reasons = [
        protectPolicy.explanation || 'Protective policy requirement satisfied.',
        ...decision.reasons,
      ];
      const structuredReasons = [
        {
          code: protectPolicy.reasonCode || 'POLICY_PROTECT',
          message: protectPolicy.explanation || 'Protective policy requirement satisfied.',
          ruleId: protectPolicy.ruleId,
          severity: RiskLevel.CRITICAL,
        },
        ...(decision.structuredReasons || []),
      ];
      decision = {
        ...decision,
        response: ResponseAction.PROTECT,
        policyRuleId: protectPolicy.ruleId || decision.policyRuleId,
        reasons,
        structuredReasons,
      };
    } else if (warnPolicy && decision.response !== ResponseAction.PROTECT) {
      const reasons = [
        warnPolicy.explanation || 'Advisory warning policy requirement satisfied.',
        ...decision.reasons,
      ];
      const structuredReasons = [
        {
          code: warnPolicy.reasonCode || 'POLICY_WARN',
          message: warnPolicy.explanation || 'Advisory warning policy requirement satisfied.',
          ruleId: warnPolicy.ruleId,
          severity: RiskLevel.MEDIUM,
        },
        ...(decision.structuredReasons || []),
      ];
      decision = {
        ...decision,
        response: ResponseAction.WARN,
        policyRuleId: warnPolicy.ruleId || decision.policyRuleId,
        reasons,
        structuredReasons,
      };
    } else if (allowPolicy && decision.response === ResponseAction.ALLOW) {
      decision = {
        ...decision,
        policyRuleId: allowPolicy.ruleId || decision.policyRuleId,
      };
    }

    // Validate actionId consistency across all pipeline stages
    if (
      action.id !== resolvedClassification.actionId ||
      action.id !== risk.actionId ||
      action.id !== decision.actionId
    ) {
      console.error('[Guardrail Pipeline] Critical: actionId mismatch detected across pipeline stages!', {
        actionId: action.id,
        classificationActionId: resolvedClassification.actionId,
        riskActionId: risk.actionId,
        decisionActionId: decision.actionId,
      });
      decision = createFailedResponseDecision(
        action?.id || 'mismatched-action',
        {
          code: 'PIPELINE_ACTION_ID_MISMATCH',
          message: 'Action ID mismatch detected across pipeline evaluation stages (fail-closed).',
        },
        risk
      );
    }

    const evaluationResult = createRiskEvaluationResult(risk, decision);

    return {
      action,
      classification: resolvedClassification,
      risk,
      decision,
      evaluationResult,
    };
  } catch (err: any) {
    const actionId = action?.id || 'unknown-action';
    const error: EvaluationError = {
      code: 'PIPELINE_EVALUATION_EXCEPTION',
      message: err?.message || 'Unexpected exception during pipeline evaluation (fail-closed).',
    };
    const failedDecision = createFailedResponseDecision(actionId, error);
    const fallbackRisk: RiskAssessment = {
      actionId,
      riskLevel: RiskLevel.CRITICAL,
      score: 100,
      reasons: [failedDecision.reasons[0]],
      evaluatedAt: new Date().toISOString(),
      status: RiskEvaluationStatus.FAILED,
      success: false,
      error,
    };
    const fallbackClassification: ActionClassificationResult = classification ?? {
      actionId,
      category: action?.category || ('GENERAL' as any),
      confidence: 0,
      reasons: ['Pipeline evaluation exception'],
      classifiedAt: new Date().toISOString(),
    };
    const evaluationResult = createRiskEvaluationResult(fallbackRisk, failedDecision);

    return {
      action,
      classification: fallbackClassification,
      risk: fallbackRisk,
      decision: failedDecision,
      evaluationResult,
    };
  }
}

/**
 * Validates that an arbitrary payload matches the canonical RiskEvaluationResult contract.
 *
 * Verifies:
 * - Non-null object structure
 * - actionId format
 * - Canonical ResponseAction (ALLOW, WARN, PROTECT)
 * - Canonical RiskEvaluationStatus (EVALUATED, FAILED)
 * - Canonical RiskLevel
 * - Score boundedness [0, 100]
 * - Fail-closed consistency: FAILED evaluations cannot render ALLOW
 *
 * @param value Candidate payload to validate
 */
export function validateRiskEvaluationResult(value: unknown): {
  valid: boolean;
  errors: string[];
  result?: RiskEvaluationResult;
} {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['Evaluation result must be a non-null object.'] };
  }

  const raw = value as Record<string, unknown>;

  // 1. Validate actionId
  if (typeof raw.actionId !== 'string' || !raw.actionId.trim()) {
    errors.push('Missing or empty actionId.');
  }

  // 2. Validate decision
  const decisionVal = validateResponseAction(raw.decision);
  if (!decisionVal.valid) {
    errors.push(`Invalid decision: ${decisionVal.error || 'Expected ALLOW, WARN, or PROTECT.'}`);
  }

  // 3. Validate status
  if (raw.status !== RiskEvaluationStatus.EVALUATED && raw.status !== RiskEvaluationStatus.FAILED) {
    errors.push(`Invalid evaluation status "${String(raw.status)}". Expected EVALUATED or FAILED.`);
  }

  // 4. Validate riskLevel
  const validRiskLevels = Object.values(RiskLevel);
  if (!validRiskLevels.includes(raw.riskLevel as RiskLevel)) {
    errors.push(`Invalid riskLevel "${String(raw.riskLevel)}". Expected one of: ${validRiskLevels.join(', ')}.`);
  }

  // 5. Validate score
  if (typeof raw.score !== 'number' || isNaN(raw.score) || raw.score < 0 || raw.score > 100) {
    errors.push(`Invalid risk score "${String(raw.score)}". Must be a number between 0 and 100.`);
  }

  // 6. Validate reasons array
  if (!Array.isArray(raw.reasons)) {
    errors.push('reasons must be an array of strings.');
  }

  // 7. Security Invariant: A failed evaluation cannot render an ALLOW decision
  if (raw.status === RiskEvaluationStatus.FAILED && raw.decision === ResponseAction.ALLOW) {
    errors.push('Security violation: A failed evaluation cannot render an ALLOW decision (fail-closed invariant).');
  }

  // 8. Privacy Invariant: Check for accidental leakage of sensitive keys
  const serialized = JSON.stringify(value);
  const forbiddenSensitiveKeys = [
    /"password"\s*:\s*"[^"]+"/i,
    /"otp"\s*:\s*"[^"]+"/i,
    /"cvv"\s*:\s*"[^"]+"/i,
    /"cardNumber"\s*:\s*"[^"]+"/i,
  ];
  for (const pattern of forbiddenSensitiveKeys) {
    if (pattern.test(serialized)) {
      errors.push('Privacy violation: Sensitive credential or payment data detected in evaluation result.');
      break;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    result: value as unknown as RiskEvaluationResult,
  };
}
