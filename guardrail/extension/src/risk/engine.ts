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
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  getActivePolicyConfig,
  getRiskThresholds,
  GuardrailPolicyConfig,
  RiskThresholdSettings,
} from '../config/index.js';

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
 * Backward-compatible alias to centralized RiskThresholdSettings.
 */
export type RiskThresholdConfig = RiskThresholdSettings;

/**
 * Default centralized threshold configuration sourced directly from the centralized schema.
 * Preserves the canonical 0-24 (LOW), 25-49 (MEDIUM), 50-74 (HIGH), 75-100 (CRITICAL) boundaries.
 */
export const DEFAULT_RISK_THRESHOLDS: Readonly<RiskThresholdConfig> =
  DEFAULT_GUARDRAIL_POLICY_CONFIG.thresholds;

/**
 * Maps a numeric score (0–100) to its corresponding RiskLevel based on threshold configuration.
 * Automatically consumes the active centralized thresholds if none are explicitly provided.
 *
 * @param score Clamped numerical score between 0 and 100.
 * @param thresholds Optional threshold configuration (defaults to active centralized thresholds).
 */
export function determineRiskLevel(
  score: number,
  thresholds?: RiskThresholdConfig
): RiskLevel {
  const effectiveThresholds = thresholds ?? getRiskThresholds();
  const boundedScore = clampRiskScore(score);

  if (boundedScore <= effectiveThresholds.lowMax) {
    return RiskLevel.LOW;
  }
  if (boundedScore <= effectiveThresholds.mediumMax) {
    return RiskLevel.MEDIUM;
  }
  if (boundedScore <= effectiveThresholds.highMax) {
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

  /** Custom threshold boundaries. Defaults to active centralized thresholds. */
  thresholds?: RiskThresholdConfig;

  /** Optional score contribution overrides for specific signals. */
  signalOverrides?: RiskSignalOverrides;

  /** Centralized policy configuration to consume. */
  config?: GuardrailPolicyConfig;
}

/**
 * Core Guardrail Risk Engine implementation.
 */
export class RiskEngine {
  private readonly rules: readonly RiskRule[];
  private readonly explicitThresholds?: RiskThresholdConfig;
  private readonly explicitSignalOverrides?: RiskSignalOverrides;
  private readonly explicitConfig?: GuardrailPolicyConfig;

  constructor(options?: RiskEngineOptions) {
    this.rules = options?.rules ?? INITIAL_RISK_RULES;
    this.explicitThresholds = options?.thresholds;
    this.explicitSignalOverrides = options?.signalOverrides;
    this.explicitConfig = options?.config;
  }

  /**
   * Resolves effective thresholds dynamically from explicit options or central registry.
   */
  public get thresholds(): RiskThresholdConfig {
    if (this.explicitThresholds) return this.explicitThresholds;
    if (this.explicitConfig) return this.explicitConfig.thresholds;
    return getRiskThresholds();
  }

  /**
   * Resolves effective signal score overrides dynamically from explicit options or central config.
   */
  public get signalOverrides(): RiskSignalOverrides | undefined {
    if (this.explicitSignalOverrides) return this.explicitSignalOverrides;
    const config = this.explicitConfig ?? getActivePolicyConfig();
    if (!config?.signals) return undefined;

    const overrides: RiskSignalOverrides = {};
    for (const [sigId, setting] of Object.entries(config.signals)) {
      if (setting && typeof setting.scoreContribution === 'number') {
        overrides[sigId as RiskSignalId] = {
          scoreContribution: setting.enabled ? setting.scoreContribution : 0,
        };
      }
    }
    return overrides;
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

    // 2. Evaluate applicable risk rules safely in deterministic priority order
    const orderedRules = [...this.rules].sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
    for (const rule of orderedRules) {
      const signalConfig = getRiskSignalDefinition(rule.signalId, this.signalOverrides);
      let result;
      try {
        result = rule.evaluate(context, signalConfig);
      } catch (err) {
        // Isolate single rule exception; engine continues evaluating remaining rules
        continue;
      }

      if (result && typeof result === 'object' && result.matched === true && result.signalId) {
        const rawScore = result.scoreContribution ?? signalConfig.scoreContribution;
        const scoreContribution =
          typeof rawScore === 'number' && !isNaN(rawScore)
            ? clampRiskScore(rawScore)
            : signalConfig.scoreContribution;
        const reason = result.reason ?? signalConfig.reason;

        // Record rule attribution
        matchedRules.push({
          ruleId: result.ruleId ?? rule.id,
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
            ruleId: result.ruleId ?? rule.id,
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
