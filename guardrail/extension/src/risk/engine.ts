/**
 * Guardrail Risk Engine
 *
 * Deterministic, explainable risk assessment engine for evaluating web interactions.
 * Accepts a normalized GuardrailAction and its ClassificationResult, evaluates applicable
 * risk rules, sums configured score contributions, clamps the total score, and maps
 * the result to a categorical RiskLevel based on centralized thresholds.
 *
 * IMPORTANT ARCHITECTURAL PRINCIPLES:
 * 1. HEURISTIC INDICATOR ONLY: The computed risk score is a heuristic measure of operational
 *    and security sensitivity. It is NOT a statistical probability (e.g., 80 is not "80% chance of fraud").
 * 2. NO PROOF OF MALICE: Risk scores describe potential impact or sensitivity under Guardrail policies.
 *    They do NOT constitute proof of fraud, malice, or unauthorized activity.
 * 3. EXPLAINABLE & DETERMINISTIC: Every score is accompanied by human-readable explanations of
 *    the triggered signals. The same inputs will always produce the identical output.
 * 4. STRICT PRIVACY: Operates strictly on non-sensitive metadata. Never inspects or stores user input
 *    values, passwords, payment details, or OTPs.
 */

import { GuardrailAction } from '../types/actions.js';
import { ClassificationResult } from '../types/classification.js';
import {
  EvaluationError,
  EvaluationReason,
  MatchedRuleInfo,
  RiskAssessment,
  RiskEvaluationStatus,
  RiskLevel,
  RiskSignalId,
} from '../types/risk.js';
import { clampRiskScore, INITIAL_RISK_RULES, RiskRule } from './rules.js';
import { getRiskSignalDefinition, RiskSignalOverrides } from './signals.js';

/**
 * Determines baseline severity tier for a given RiskSignalId.
 */
export function determineSignalSeverity(signalId: RiskSignalId): RiskLevel {
  switch (signalId) {
    case RiskSignalId.DESTRUCTIVE_ACTION:
      return RiskLevel.HIGH;
    case RiskSignalId.PAYMENT_ACTION:
      return RiskLevel.MEDIUM;
    case RiskSignalId.AUTHENTICATION_ACTION:
    case RiskSignalId.EXTERNAL_NAVIGATION:
    case RiskSignalId.DOWNLOAD_ACTION:
      return RiskLevel.LOW;
    default:
      return RiskLevel.LOW;
  }
}

/**
 * Creates a strongly typed, fail-closed RiskAssessment for an evaluation failure.
 *
 * SAFETY INVARIANT:
 * Evaluation failures must NEVER silently become safe or score 0.
 * They fail closed to CRITICAL risk (score 100) with diagnostic error details.
 */
export function createFailedRiskAssessment(
  actionId: string,
  error: EvaluationError
): RiskAssessment {
  const timestamp = new Date().toISOString();
  const safeActionId = typeof actionId === 'string' && actionId.trim() ? actionId.trim() : 'unknown-action';
  const errorMessage = `Risk evaluation failed [${error.code}]: ${error.message}`;

  return {
    actionId: safeActionId,
    score: 100, // Fail-closed maximum sensitivity
    riskLevel: RiskLevel.CRITICAL, // Fail-closed highest risk level
    reasons: [errorMessage],
    evaluatedAt: timestamp,
    status: RiskEvaluationStatus.FAILED,
    success: false,
    matchedRules: [],
    structuredReasons: [
      {
        code: error.code || 'EVALUATION_FAILED',
        message: errorMessage,
        severity: RiskLevel.CRITICAL,
        scoreContribution: 100,
      },
    ],
    error,
  };
}

/**
 * Threshold configuration defining the boundaries for each categorical RiskLevel.
 *
 * Development Thresholds:
 * - 0 to 24: LOW (Routine interaction with negligible operational or security risk)
 * - 25 to 49: MEDIUM (Moderate operational impact or reversible changes)
 * - 50 to 74: HIGH (Sensitive operations like financial triggers or authentication)
 * - 75 to 100: CRITICAL (Severe impact like irreversible deletions or compounded high-risk signals)
 */
export interface RiskThresholdConfig {
  /** Maximum score (inclusive) for LOW risk tier. Defaults to 24. */
  lowMax: number;

  /** Maximum score (inclusive) for MEDIUM risk tier. Defaults to 49. */
  mediumMax: number;

  /** Maximum score (inclusive) for HIGH risk tier. Defaults to 74. */
  highMax: number;
}

/**
 * Default centralized threshold configuration.
 * Easy to inspect, tune, or override across environments.
 */
export const DEFAULT_RISK_THRESHOLDS: Readonly<RiskThresholdConfig> = Object.freeze({
  lowMax: 24,
  mediumMax: 49,
  highMax: 74,
});

/**
 * Maps a numeric score (0–100) to its corresponding RiskLevel based on threshold configuration.
 *
 * @param score Clamped numerical score between 0 and 100.
 * @param thresholds Threshold configurations to apply.
 */
export function determineRiskLevel(
  score: number,
  thresholds: RiskThresholdConfig = DEFAULT_RISK_THRESHOLDS
): RiskLevel {
  const boundedScore = clampRiskScore(score);

  if (boundedScore <= thresholds.lowMax) {
    return RiskLevel.LOW;
  }
  if (boundedScore <= thresholds.mediumMax) {
    return RiskLevel.MEDIUM;
  }
  if (boundedScore <= thresholds.highMax) {
    return RiskLevel.HIGH;
  }
  return RiskLevel.CRITICAL;
}

/**
 * Configuration options for the RiskEngine instance.
 */
export interface RiskEngineOptions {
  /** Custom rules to evaluate. Defaults to INITIAL_RISK_RULES. */
  rules?: readonly RiskRule[];

  /** Custom threshold boundaries. Defaults to DEFAULT_RISK_THRESHOLDS. */
  thresholds?: RiskThresholdConfig;

  /** Optional score contribution overrides for specific signals. */
  signalOverrides?: RiskSignalOverrides;
}

/**
 * Core Guardrail Risk Engine implementation.
 */
export class RiskEngine {
  private readonly rules: readonly RiskRule[];
  private readonly thresholds: RiskThresholdConfig;
  private readonly signalOverrides?: RiskSignalOverrides;

  constructor(options?: RiskEngineOptions) {
    this.rules = options?.rules ?? INITIAL_RISK_RULES;
    this.thresholds = options?.thresholds ?? DEFAULT_RISK_THRESHOLDS;
    this.signalOverrides = options?.signalOverrides;
  }

  /**
   * Evaluates a GuardrailAction and its ClassificationResult to produce a comprehensive RiskAssessment.
   *
   * Evaluation pipeline:
   * 1. Validates input action structure (fails closed if invalid).
   * 2. Evaluates all configured risk rules against the action and classification context.
   * 3. Collects matched rule identifiers and deduplicates triggered risk signals.
   * 4. Sums configured score contributions from triggered signals.
   * 5. Clamps the total score strictly between 0 and 100.
   * 6. Resolves categorical RiskLevel from centralized thresholds.
   * 7. Compiles human-readable explanations and strongly typed structured reasons.
   * 8. Returns an immutable, auditable RiskAssessment.
   *
   * @param action The normalized interaction event.
   * @param classification Optional classification result from the classifier layer.
   * @returns Strongly typed RiskAssessment.
   */
  public assess(
    action: GuardrailAction,
    classification?: ClassificationResult
  ): RiskAssessment {
    // 1. Guard against null, undefined, or missing actionId (fail-closed)
    if (!action || typeof action !== 'object' || typeof action.id !== 'string' || !action.id.trim()) {
      const fallbackId =
        action && typeof (action as any).id === 'string' && (action as any).id.trim()
          ? (action as any).id.trim()
          : 'unknown-action';

      return createFailedRiskAssessment(fallbackId, {
        code: 'INVALID_ACTION_PAYLOAD',
        message: 'Action payload is invalid, null, or missing a valid actionId.',
      });
    }

    const context = { action, classification };
    const matchedRules: MatchedRuleInfo[] = [];
    const triggeredSignals = new Map<
      RiskSignalId,
      { scoreContribution: number; reason: string; ruleId: string }
    >();

    // 2. Evaluate applicable risk rules safely
    for (const rule of this.rules) {
      const signalConfig = getRiskSignalDefinition(rule.signalId, this.signalOverrides);
      let result;
      try {
        result = rule.evaluate(context, signalConfig);
      } catch (err) {
        // Isolate single rule exception; engine continues evaluating remaining rules
        continue;
      }

      if (result && result.matched && result.signalId) {
        const scoreContribution = result.scoreContribution ?? signalConfig.scoreContribution;
        const reason = result.reason ?? signalConfig.reason;

        // Record rule attribution
        matchedRules.push({
          ruleId: rule.id,
          signalId: result.signalId,
          scoreContribution,
          reason,
          description: rule.description,
        });

        // Deduplicate signals: if multiple rules flag the same signal, retain the highest contribution
        const existing = triggeredSignals.get(result.signalId);
        if (!existing || scoreContribution > existing.scoreContribution) {
          triggeredSignals.set(result.signalId, {
            scoreContribution,
            reason,
            ruleId: rule.id,
          });
        }
      }
    }

    // 3. Sum score contributions
    let rawScore = 0;
    const reasons: string[] = [];
    const structuredReasons: EvaluationReason[] = [];

    for (const [sigId, signal] of triggeredSignals.entries()) {
      rawScore += signal.scoreContribution;
      if (signal.reason) {
        reasons.push(signal.reason);
      }
      structuredReasons.push({
        code: `SIGNAL_${sigId}`,
        message: signal.reason,
        ruleId: signal.ruleId,
        signalId: sigId,
        severity: determineSignalSeverity(sigId),
        scoreContribution: signal.scoreContribution,
      });
    }

    // 4. Clamp total score strictly to [0, 100]
    const score = clampRiskScore(rawScore);

    // 5. Determine categorical RiskLevel using centralized thresholds
    const riskLevel = determineRiskLevel(score, this.thresholds);

    // 6. Generate human-readable reasons (fallback for clean baseline interactions)
    if (reasons.length === 0) {
      reasons.push('No elevated risk signals detected. Routine interaction.');
      structuredReasons.push({
        code: 'SIGNAL_NONE_DETECTED',
        message: 'No elevated risk signals detected. Routine interaction.',
        severity: RiskLevel.LOW,
        scoreContribution: 0,
      });
    }

    // 7. Return complete, strongly typed RiskAssessment
    return {
      actionId: action.id,
      score,
      riskLevel,
      reasons,
      evaluatedAt: new Date().toISOString(),
      status: RiskEvaluationStatus.EVALUATED,
      success: true,
      matchedRules,
      structuredReasons,
    };
  }
}

/**
 * Default singleton instance of the RiskEngine using initial development heuristics.
 */
export const defaultRiskEngine = new RiskEngine();

/**
 * Functional convenience helper to assess risk using the default or custom RiskEngine.
 */
export function assessRisk(
  action: GuardrailAction,
  classification?: ClassificationResult,
  options?: RiskEngineOptions
): RiskAssessment {
  if (!options) {
    return defaultRiskEngine.assess(action, classification);
  }
  const engine = new RiskEngine(options);
  return engine.assess(action, classification);
}
