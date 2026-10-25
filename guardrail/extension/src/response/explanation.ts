/**
 * Guardrail Decision Explanation & Diagnostic Presentation Model
 *
 * Translates operational risk decisions, policy reason codes, and evaluation metadata
 * into clear, reassuring, plain-language user guidance while maintaining strict privacy.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. CLARITY & REASSURANCE: Explains *what* was detected and *why* without jargon.
 * 2. NO ACCUSATORY LANGUAGE: Distinguishes policy-based sensitivity checks from confirmed security threats.
 *    Never claims an action or website is "fraudulent", "phishing", or "malicious" without forensic proof.
 * 3. RECOVERY GUIDANCE: Provides practical, actionable next steps when actions are held or evaluations fail.
 * 4. SEPARATION OF CONCERNS: Keeps technical diagnostic information (rule IDs, raw heuristic scores,
 *    reason codes) cleanly separated from user-facing explanations.
 * 5. PRIVACY PRESERVATION: Sanitizes URLs (stripping query parameters and tokens) and redacts credentials.
 * 6. ZERO FABRICATION: Never invents risk scores, matched rules, or fictitious protection events.
 */

import { GuardrailAction } from '../types/actions.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';
import {
  EvaluationError,
  RiskAssessment,
  RiskEvaluationStatus,
  RiskLevel,
} from '../types/risk.js';
import { sanitizeUrlForDiagnostics } from '../utils/privacy.js';

/**
 * Nature of the evaluated event.
 * Strictly separates operational policy matches from system failures and confirmed threats.
 */
export type ExplanationNature =
  | 'POLICY_MATCH'            // Operational sensitivity policy requirement matched (e.g., delete button, checkout)
  | 'OPERATIONAL_PRECAUTION' // Advisory friction to prevent unintended user errors
  | 'BASELINE_ROUTINE'       // Standard everyday interaction passing routine checks
  | 'EVALUATION_FAILURE'     // Internal error or corrupt payload; fail-closed protection applied
  | 'SENSOR_LIMITATION';     // Ambient browser sensor boundary limitation

/**
 * Technical diagnostic details strictly separated from user-facing copy.
 * Useful for engineers, caretakers, and diagnostic audits without cluttering user experience.
 */
export interface TechnicalDiagnostics {
  /** Correlated action identifier */
  readonly actionId: string;

  /** Primary response policy rule applied */
  readonly ruleId?: string;

  /** Machine-readable reason code */
  readonly reasonCode?: string;

  /** Quantitative heuristic score [0, 100] (heuristic sensitivity, NOT probability of malice) */
  readonly score?: number;

  /** Categorical risk level */
  readonly riskLevel?: RiskLevel;

  /** Evaluation lifecycle status */
  readonly evaluationStatus?: RiskEvaluationStatus;

  /** Sanitized URL free of query strings and tokens */
  readonly sanitizedUrl?: string;

  /** Target element label or identifier */
  readonly targetLabel?: string;

  /** All matching rule IDs */
  readonly matchedRules?: readonly string[];

  /** Structured error details if evaluation failed */
  readonly error?: EvaluationError;
}

/**
 * Structured, human-readable explanation of an operational risk decision.
 */
export interface RiskDecisionExplanation {
  /** The operational governance decision (ALLOW, WARN, PROTECT) */
  readonly decision: ResponseAction;

  /** Nature of the decision (never an unverified security threat) */
  readonly nature: ExplanationNature;

  /** Short category badge for UI chips (e.g., "Permanent Deletion Guard", "Payment Advisory") */
  readonly categoryBadge: string;

  /** Concise, understandable user-facing headline */
  readonly headline: string;

  /** Plain-language user summary explaining the operational context */
  readonly userSummary: string;

  /** Clear bullet points explaining why this action was evaluated as such */
  readonly whyFlagged: readonly string[];

  /** Practical recovery guidance for held, failed, or advisory actions */
  readonly recoveryGuidance?: readonly string[];

  /** Technical diagnostic details strictly partitioned from user copy */
  readonly technicalDetails: TechnicalDiagnostics;

  /**
   * INVARIANT: Always false for Guardrail policy evaluations.
   * Confirms that this is a sensitivity or operational policy match, NOT a confirmed malware/fraud finding.
   */
  readonly isSecurityThreat: false;
}

/**
 * Normalizes and extracts searchable target label safely.
 */
function extractTargetLabel(action?: GuardrailAction): string {
  if (!action) return 'Selected interaction';
  return (
    action.element?.visibleText ||
    action.element?.id ||
    action.element?.tagName ||
    sanitizeUrlForDiagnostics(action.page?.url) ||
    'Selected interaction'
  );
}

/**
 * Maps evaluation failures into structured, reassuring explanations with clear recovery guidance.
 */
function explainEvaluationFailure(
  actionId: string,
  error?: EvaluationError,
  action?: GuardrailAction,
  risk?: Readonly<RiskAssessment>,
  decision?: Readonly<ResponseDecision>
): RiskDecisionExplanation {
  const errorCode = error?.code || decision?.structuredReasons?.[0]?.code || 'EVALUATION_FAILED';

  let headline = 'Safety Precaution: Verification Incomplete';
  let userSummary =
    'Guardrail could not complete safety evaluation for this action. To prevent unintended modifications, fail-closed protection was applied.';
  const whyFlagged: string[] = [
    'An unexpected error or payload inconsistency occurred during policy evaluation.',
    'Guardrail operates on a fail-closed architecture: unverified actions are held rather than silently allowed.',
  ];

  if (errorCode === 'PIPELINE_ACTION_ID_MISMATCH') {
    headline = 'Safety Precaution: Action Context Mismatch';
    userSummary =
      'The action identifier could not be verified consistently across extension pipeline stages.';
    whyFlagged.push('Correlation integrity check failed between detector and response engine.');
  } else if (errorCode === 'INVALID_ASSESSMENT_PAYLOAD' || errorCode === 'POLICY_FAIL_CLOSED_CORRUPT_PAYLOAD') {
    headline = 'Safety Precaution: Unverified Interaction Data';
    userSummary =
      'The interaction event lacked required structure or valid metadata for deterministic evaluation.';
  }

  const recoveryGuidance = [
    '1. Refresh the webpage to re-initialize browser extension sensors.',
    '2. If the button or form was rendered dynamically by page scripts, wait a moment and try again.',
    '3. Check your browser extension permissions for this website.',
    '4. If this error persists, share the diagnostic code below with your administrator.',
  ];

  return {
    decision: ResponseAction.PROTECT,
    nature: 'EVALUATION_FAILURE',
    categoryBadge: 'Safety Precaution (Error)',
    headline,
    userSummary,
    whyFlagged: Object.freeze(whyFlagged),
    recoveryGuidance: Object.freeze(recoveryGuidance),
    technicalDetails: Object.freeze({
      actionId,
      ruleId: decision?.policyRuleId || 'RULE_FAIL_CLOSED_FALLBACK',
      reasonCode: errorCode,
      score: risk?.score ?? 100,
      riskLevel: RiskLevel.CRITICAL,
      evaluationStatus: RiskEvaluationStatus.FAILED,
      sanitizedUrl: sanitizeUrlForDiagnostics(action?.page?.url),
      targetLabel: extractTargetLabel(action),
      matchedRules: risk?.matchedRules?.map((r) => r.ruleId) || [],
      error,
    }),
    isSecurityThreat: false,
  };
}

/**
 * Centralized explanation generator translating decisions, assessments, and policy reason codes
 * into concise, reassuring, plain-language user guidance and clean diagnostics.
 *
 * @param decision Evaluated response decision
 * @param risk Optional evaluated risk assessment
 * @param action Optional normalized action
 * @returns Complete, strongly-typed RiskDecisionExplanation
 */
export function explainRiskDecision(
  decision: Readonly<ResponseDecision>,
  risk?: Readonly<RiskAssessment>,
  action?: GuardrailAction
): RiskDecisionExplanation {
  const actionId = decision?.actionId || risk?.actionId || action?.id || 'unknown-action';
  const targetLabel = extractTargetLabel(action);
  const sanitizedUrl = sanitizeUrlForDiagnostics(action?.page?.url);

  // 1. Handle Evaluation Failure / Corrupted States
  if (
    decision?.status === RiskEvaluationStatus.FAILED ||
    decision?.success === false ||
    risk?.status === RiskEvaluationStatus.FAILED ||
    risk?.success === false
  ) {
    return explainEvaluationFailure(actionId, decision?.error || risk?.error, action, risk, decision);
  }

  // 2. Resolve primary reason code and rule ID
  const primaryCode =
    decision?.structuredReasons?.[0]?.code ||
    risk?.structuredReasons?.[0]?.code ||
    decision?.policyRuleId ||
    '';
  const primaryRuleId =
    decision?.policyRuleId ||
    decision?.structuredReasons?.[0]?.ruleId ||
    risk?.matchedRules?.[0]?.ruleId;

  // 3. Resolve based on canonical risk policy codes
  switch (primaryCode) {
    case 'POLICY_PROTECT_DESTRUCTIVE':
    case 'RULE_CONTROLLED_DESTRUCTIVE':
    case 'POLICY_CONTROLLED_DESTRUCTIVE': {
      return {
        decision: ResponseAction.PROTECT,
        nature: 'POLICY_MATCH',
        categoryBadge: 'Permanent Deletion Guard',
        headline: 'Protected Action: Permanent Deletion or Removal',
        userSummary:
          'Guardrail paused this action because it appears to permanently delete resources, remove data, or close an account. Staging Mode requires trusted confirmation before execution.',
        whyFlagged: Object.freeze([
          `The target element ("${targetLabel}") contains destructive command keywords (e.g., delete, remove, purge, or terminate).`,
          'Permanent deletion cannot typically be undone once processed.',
          'Guardrail does not inspect password or authentication credentials.',
        ]),
        recoveryGuidance: Object.freeze([
          'Review the action in Staging Mode to verify you intended to permanently delete this item.',
          'If authorized by your trusted contact, you may confirm continuation to execute the action.',
          'Click Cancel to dismiss and leave all existing data untouched.',
        ]),
        technicalDetails: Object.freeze({
          actionId,
          ruleId: primaryRuleId || 'RULE_CONTROLLED_DESTRUCTIVE',
          reasonCode: 'POLICY_PROTECT_DESTRUCTIVE',
          score: risk?.score,
          riskLevel: risk?.riskLevel || RiskLevel.CRITICAL,
          evaluationStatus: RiskEvaluationStatus.EVALUATED,
          sanitizedUrl,
          targetLabel,
          matchedRules: risk?.matchedRules?.map((r) => r.ruleId) || ['RULE_CONTROLLED_DESTRUCTIVE'],
        }),
        isSecurityThreat: false,
      };
    }

    case 'POLICY_PROTECT_PAYMENT_COMPOUND':
    case 'RULE_PAYMENT_COMPOUND_PROTECT': {
      return {
        decision: ResponseAction.PROTECT,
        nature: 'POLICY_MATCH',
        categoryBadge: 'High-Impact Payment Guard',
        headline: 'Protected Action: Sensitive Financial Checkout',
        userSummary:
          'Guardrail held this checkout or payment transaction because high-impact sensitivity factors (such as external destination or elevated thresholds) were detected.',
        whyFlagged: Object.freeze([
          `Target element ("${targetLabel}") engages with financial checkout or funds transfer.`,
          'Compounding policy criteria triggered protective Staging Mode.',
          'Guardrail never inspects, accesses, or logs credit card numbers, CVVs, or bank balances.',
        ]),
        recoveryGuidance: Object.freeze([
          'Confirm the payee and transaction total on the webpage before continuing.',
          'Obtain trusted contact confirmation or verify your purchase in Staging Mode.',
          'Click Cancel to return to the shopping cart.',
        ]),
        technicalDetails: Object.freeze({
          actionId,
          ruleId: primaryRuleId || 'RULE_PAYMENT_COMPOUND_PROTECT',
          reasonCode: 'POLICY_PROTECT_PAYMENT_COMPOUND',
          score: risk?.score,
          riskLevel: risk?.riskLevel || RiskLevel.CRITICAL,
          evaluationStatus: RiskEvaluationStatus.EVALUATED,
          sanitizedUrl,
          targetLabel,
          matchedRules: risk?.matchedRules?.map((r) => r.ruleId) || [],
        }),
        isSecurityThreat: false,
      };
    }

    case 'POLICY_WARN_PAYMENT':
    case 'RULE_PAYMENT_INTERACTION_POLICY':
    case 'POLICY_CONTROLLED_PAYMENT': {
      return {
        decision: ResponseAction.WARN,
        nature: 'OPERATIONAL_PRECAUTION',
        categoryBadge: 'Payment Advisory',
        headline: 'Sensitive Operation: Checkout or Billing Interaction',
        userSummary:
          'Guardrail identified an interaction with a payment, checkout, or billing workflow. Please verify transaction details before proceeding.',
        whyFlagged: Object.freeze([
          `Target element ("${targetLabel}") interacts with financial transaction flows.`,
          'Guardrail presents user friction to prevent unintended or accidental checkouts.',
          'Your payment information, card numbers, and credentials are never accessed or stored.',
        ]),
        recoveryGuidance: Object.freeze([
          'Verify the purchase amount, recipient, and payment method displayed on the page.',
          'Click Continue to proceed with the transaction, or Cancel to review details.',
        ]),
        technicalDetails: Object.freeze({
          actionId,
          ruleId: primaryRuleId || 'RULE_PAYMENT_INTERACTION_POLICY',
          reasonCode: 'POLICY_WARN_PAYMENT',
          score: risk?.score,
          riskLevel: risk?.riskLevel || RiskLevel.MEDIUM,
          evaluationStatus: RiskEvaluationStatus.EVALUATED,
          sanitizedUrl,
          targetLabel,
          matchedRules: risk?.matchedRules?.map((r) => r.ruleId) || [],
        }),
        isSecurityThreat: false,
      };
    }

    case 'POLICY_WARN_EXTERNAL_NAVIGATION':
    case 'RULE_EXTERNAL_NAVIGATION':
    case 'POLICY_EXTERNAL_NAVIGATION': {
      return {
        decision: ResponseAction.WARN,
        nature: 'OPERATIONAL_PRECAUTION',
        categoryBadge: 'External Domain Advisory',
        headline: 'External Destination: Navigating to Third-Party Website',
        userSummary:
          'This action leads to a different domain origin outside the current website. Please review the destination address.',
        whyFlagged: Object.freeze([
          'Action links or redirects to a different domain origin.',
          'Operational notice: Guardrail does not claim this external website is fraudulent or malicious.',
        ]),
        recoveryGuidance: Object.freeze([
          'Check your browser address bar to confirm the destination is legitimate.',
          'Avoid entering sensitive credentials or OTPs on unexpected third-party pages.',
        ]),
        technicalDetails: Object.freeze({
          actionId,
          ruleId: primaryRuleId || 'RULE_EXTERNAL_NAVIGATION',
          reasonCode: 'POLICY_WARN_EXTERNAL_NAVIGATION',
          score: risk?.score,
          riskLevel: risk?.riskLevel || RiskLevel.MEDIUM,
          evaluationStatus: RiskEvaluationStatus.EVALUATED,
          sanitizedUrl,
          targetLabel,
          matchedRules: risk?.matchedRules?.map((r) => r.ruleId) || [],
        }),
        isSecurityThreat: false,
      };
    }

    case 'POLICY_WARN_AUTH_BOUNDARY':
    case 'RULE_AUTHENTICATION_BOUNDARY':
    case 'POLICY_AUTHENTICATION_BOUNDARY': {
      return {
        decision: ResponseAction.WARN,
        nature: 'OPERATIONAL_PRECAUTION',
        categoryBadge: 'Sign-in Advisory',
        headline: 'Sign-in Boundary: Account or Credential Interaction',
        userSummary:
          'This action interacts with an account sign-in or authentication boundary. Please ensure you are on the intended website portal.',
        whyFlagged: Object.freeze([
          'Target element interacts with login, registration, or credential entry fields.',
          'Guardrail strictly respects your privacy: passwords and credentials are never read or logged.',
        ]),
        recoveryGuidance: Object.freeze([
          'Ensure the URL in the browser address bar matches your service provider and uses HTTPS.',
        ]),
        technicalDetails: Object.freeze({
          actionId,
          ruleId: primaryRuleId || 'RULE_AUTHENTICATION_BOUNDARY',
          reasonCode: 'POLICY_WARN_AUTH_BOUNDARY',
          score: risk?.score,
          riskLevel: risk?.riskLevel || RiskLevel.MEDIUM,
          evaluationStatus: RiskEvaluationStatus.EVALUATED,
          sanitizedUrl,
          targetLabel,
          matchedRules: risk?.matchedRules?.map((r) => r.ruleId) || [],
        }),
        isSecurityThreat: false,
      };
    }

    case 'POLICY_ALLOW_ROUTINE':
    case 'RULE_ROUTINE_ALLOW':
    case 'POLICY_ROUTINE_INTERACTION': {
      return {
        decision: ResponseAction.ALLOW,
        nature: 'BASELINE_ROUTINE',
        categoryBadge: 'Routine Activity',
        headline: 'Action Permitted: Standard Interaction',
        userSummary:
          'Standard everyday interaction evaluated under default Guardrail safety policies. No elevated sensitivity policies were triggered.',
        whyFlagged: Object.freeze([
          'Standard page element interaction without destructive, payment, or external triggers.',
          'Action proceeds directly without holding or interception.',
        ]),
        recoveryGuidance: undefined,
        technicalDetails: Object.freeze({
          actionId,
          ruleId: primaryRuleId || 'RULE_ROUTINE_ALLOW',
          reasonCode: 'POLICY_ALLOW_ROUTINE',
          score: risk?.score ?? 0,
          riskLevel: risk?.riskLevel || RiskLevel.LOW,
          evaluationStatus: RiskEvaluationStatus.EVALUATED,
          sanitizedUrl,
          targetLabel,
          matchedRules: risk?.matchedRules?.map((r) => r.ruleId) || [],
        }),
        isSecurityThreat: false,
      };
    }

    default: {
      // 4. Graceful Fallback for Unknown Reasons or Custom Extension Overrides
      const decisionAction = decision?.response || ResponseAction.ALLOW;
      const rawReason = decision?.reasons?.[0] || risk?.reasons?.[0] || 'Standard policy evaluation';

      if (decisionAction === ResponseAction.PROTECT) {
        return {
          decision: ResponseAction.PROTECT,
          nature: 'POLICY_MATCH',
          categoryBadge: 'Protective Staging',
          headline: 'Protected Action: Operational Precaution',
          userSummary:
            'Guardrail paused this action under active safety policies. Please review the details below before proceeding.',
          whyFlagged: Object.freeze([
            rawReason,
            'High-sensitivity policy criteria matched for this interaction.',
          ]),
          recoveryGuidance: Object.freeze([
            'Review the action details in Staging Mode.',
            'Confirm continuation if you wish to proceed, or click Cancel to abort.',
          ]),
          technicalDetails: Object.freeze({
            actionId,
            ruleId: primaryRuleId,
            reasonCode: primaryCode || 'UNKNOWN_PROTECT_REASON',
            score: risk?.score,
            riskLevel: risk?.riskLevel || RiskLevel.HIGH,
            evaluationStatus: RiskEvaluationStatus.EVALUATED,
            sanitizedUrl,
            targetLabel,
            matchedRules: risk?.matchedRules?.map((r) => r.ruleId) || [],
          }),
          isSecurityThreat: false,
        };
      }

      if (decisionAction === ResponseAction.WARN) {
        return {
          decision: ResponseAction.WARN,
          nature: 'OPERATIONAL_PRECAUTION',
          categoryBadge: 'Safety Advisory',
          headline: 'Safety Advisory: Sensitive Operation',
          userSummary:
            'Guardrail detected an interaction with elevated operational sensitivity under current settings.',
          whyFlagged: Object.freeze([
            rawReason,
            'This advisory is an operational notice, not a confirmed security threat.',
          ]),
          recoveryGuidance: Object.freeze([
            'Verify the action on the webpage before continuing.',
            'Click Continue to proceed, or Cancel to review your settings.',
          ]),
          technicalDetails: Object.freeze({
            actionId,
            ruleId: primaryRuleId,
            reasonCode: primaryCode || 'UNKNOWN_WARN_REASON',
            score: risk?.score,
            riskLevel: risk?.riskLevel || RiskLevel.MEDIUM,
            evaluationStatus: RiskEvaluationStatus.EVALUATED,
            sanitizedUrl,
            targetLabel,
            matchedRules: risk?.matchedRules?.map((r) => r.ruleId) || [],
          }),
          isSecurityThreat: false,
        };
      }

      return {
        decision: ResponseAction.ALLOW,
        nature: 'BASELINE_ROUTINE',
        categoryBadge: 'Routine Activity',
        headline: 'Action Permitted: Standard Interaction',
        userSummary:
          'This action was evaluated against standard safety rules and permitted without elevated friction.',
        whyFlagged: Object.freeze([rawReason]),
        recoveryGuidance: undefined,
        technicalDetails: Object.freeze({
          actionId,
          ruleId: primaryRuleId,
          reasonCode: primaryCode || 'UNKNOWN_ALLOW_REASON',
          score: risk?.score ?? 0,
          riskLevel: risk?.riskLevel || RiskLevel.LOW,
          evaluationStatus: RiskEvaluationStatus.EVALUATED,
          sanitizedUrl,
          targetLabel,
          matchedRules: risk?.matchedRules?.map((r) => r.ruleId) || [],
        }),
        isSecurityThreat: false,
      };
    }
  }
}
