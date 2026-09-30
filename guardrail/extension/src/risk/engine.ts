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
import { RiskAssessment, RiskLevel, RiskSignalId } from '../types/risk.js';
import { clampRiskScore, INITIAL_RISK_RULES, RiskRule } from './rules.js';
import { getRiskSignalDefinition, RiskSignalOverrides } from './signals.js';

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
   * 1. Evaluates all configured risk rules against the action and classification context.
   * 2. Deduplicates triggered risk signals.
   * 3. Sums configured score contributions from triggered signals.
   * 4. Clamps the total score between 0 and 100.
   * 5. Resolves the categorical RiskLevel from centralized thresholds.
   * 6. Compiles human-readable explanations.
   * 7. Returns an immutable RiskAssessment.
   *
   * @param action The normalized interaction event.
   * @param classification Optional classification result from the classifier layer.
   * @returns Strongly typed RiskAssessment.
   */
  public assess(
    action: GuardrailAction,
    classification?: ClassificationResult
  ): RiskAssessment {
    const context = { action, classification };
    const triggeredSignals = new Map<RiskSignalId, { scoreContribution: number; reason: string }>();

    // 1. Evaluate applicable risk rules
    for (const rule of this.rules) {
      const signalConfig = getRiskSignalDefinition(rule.signalId, this.signalOverrides);
      const result = rule.evaluate(context, signalConfig);

      if (result.matched && result.signalId) {
        // Deduplicate signals: if multiple rules flag the same signal, retain the highest contribution
        const existing = triggeredSignals.get(result.signalId);
        const scoreContribution = result.scoreContribution ?? signalConfig.scoreContribution;
        const reason = result.reason ?? signalConfig.reason;

        if (!existing || scoreContribution > existing.scoreContribution) {
          triggeredSignals.set(result.signalId, { scoreContribution, reason });
        }
      }
    }

    // 2. Sum score contributions
    let rawScore = 0;
    const reasons: string[] = [];

    for (const signal of triggeredSignals.values()) {
      rawScore += signal.scoreContribution;
      if (signal.reason) {
        reasons.push(signal.reason);
      }
    }

    // 3. Clamp total score to [0, 100]
    const score = clampRiskScore(rawScore);

    // 4. Determine categorical RiskLevel using centralized thresholds
    const riskLevel = determineRiskLevel(score, this.thresholds);

    // 5. Generate human-readable reasons (fallback for clean baseline interactions)
    if (reasons.length === 0) {
      reasons.push('No elevated risk signals detected. Routine interaction.');
    }

    // 6. Return complete, strongly typed RiskAssessment
    return {
      actionId: action.id,
      score,
      riskLevel,
      reasons,
      evaluatedAt: new Date().toISOString(),
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
