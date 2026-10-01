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

import { RiskAssessment } from '../types/risk.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';
import { DEFAULT_RESPONSE_POLICY, evaluateResponseAction, ResponsePolicyMapping } from './rules.js';

/**
 * Configuration options for the ResponseEngine.
 */
export interface ResponseEngineOptions {
  /** Custom mapping from RiskLevel to ResponseAction */
  policy?: ResponsePolicyMapping;
}

/**
 * Core Guardrail Response Engine implementation.
 */
export class ResponseEngine {
  private readonly policy: ResponsePolicyMapping;

  constructor(options?: ResponseEngineOptions) {
    this.policy = options?.policy ?? DEFAULT_RESPONSE_POLICY;
  }

  /**
   * Evaluates a RiskAssessment to render an operational ResponseDecision.
   *
   * @param assessment The evaluated risk assessment (immutable).
   * @returns Strongly typed ResponseDecision.
   */
  public decide(assessment: Readonly<RiskAssessment>): ResponseDecision {
    // 1. Apply configured response policy rules
    const { action, reason: policyReason } = evaluateResponseAction(assessment, this.policy);

    // 2. Compile comprehensive, explainable reasons
    const reasons: string[] = [policyReason];
    if (assessment.reasons && assessment.reasons.length > 0) {
      for (const r of assessment.reasons) {
        if (!reasons.includes(r)) {
          reasons.push(r);
        }
      }
    }

    // 3. Return the immutable ResponseDecision with preserved actionId and timestamp
    return {
      actionId: assessment.actionId,
      response: action,
      reasons,
      createdAt: new Date().toISOString(),
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
