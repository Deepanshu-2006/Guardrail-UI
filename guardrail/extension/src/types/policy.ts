/**
 * Guardrail Risk Policy Contract
 *
 * Formal specification for actionable risk policies across Guardrail.
 *
 * Each policy articulates:
 * 1. Which action types it applies to (CLICK, INPUT, SUBMIT, NAVIGATION).
 * 2. What explicit, verifiable evidence triggers it.
 * 3. The resulting operational decision (ALLOW, WARN, PROTECT).
 * 4. The explanation presented to the user.
 * 5. The reason code or matched rule identifier.
 * 6. Required downstream extension behavior (Staging Mode, Warning Modal, Pass-through).
 * 7. Known false-positive, false-negative, and architectural limitations.
 *
 * PRIVACY GUARANTEE: Policies operate strictly on action metadata and DOM structure.
 * Passwords, OTPs, credit cards, and form input values are NEVER inspected or stored.
 */

import { ActionType, GuardrailAction } from './actions.js';
import { ResponseAction } from './response.js';
import { RiskAssessment } from './risk.js';

/**
 * Canonical identifiers for supported Guardrail risk policies.
 */
export enum RiskPolicyId {
  CONTROLLED_DESTRUCTIVE = 'POLICY_CONTROLLED_DESTRUCTIVE',
  CONTROLLED_PAYMENT = 'POLICY_CONTROLLED_PAYMENT',
  EXTERNAL_NAVIGATION = 'POLICY_EXTERNAL_NAVIGATION',
  AUTHENTICATION_BOUNDARY = 'POLICY_AUTHENTICATION_BOUNDARY',
  ROUTINE_INTERACTION = 'POLICY_ROUTINE_INTERACTION',
  UNSUPPORTED_BOUNDARY_GUARD = 'POLICY_UNSUPPORTED_BOUNDARY_GUARD',
}

/**
 * Documented false-positive and false-negative limitations for a risk policy.
 */
export interface RiskPolicyLimitations {
  /** Known conditions that cause a false positive (benign action flagged) */
  readonly falsePositives: string;

  /** Known conditions that cause a false negative (sensitive action missed) */
  readonly falseNegatives: string;

  /** Physical or architectural constraints of browser extension sensors */
  readonly architecturalConstraints: string;
}

/**
 * Result produced by evaluating an individual policy against an action.
 */
export interface PolicyEvaluationResult {
  /** True if the policy evidence requirement was satisfied */
  readonly matched: boolean;

  /** Resulting operational decision */
  readonly decision?: ResponseAction;

  /** Canonical rule/policy identifier */
  readonly ruleId?: string;

  /** Human-readable rationale shown to the user */
  readonly explanation?: string;

  /** Machine-readable reason code */
  readonly reasonCode?: string;

  /** Required downstream extension behavior */
  readonly downstreamBehavior?: string;
}

/**
 * Formal specification of an actionable risk policy in Guardrail.
 */
export interface RiskPolicyDefinition {
  /** Canonical machine-readable policy identifier */
  readonly id: RiskPolicyId | string;

  /** Human-readable policy title */
  readonly name: string;

  /** High-level summary of the policy rationale */
  readonly description: string;

  /** Action types this policy can reliably identify and evaluate */
  readonly supportedActionTypes: readonly ActionType[];

  /** Explicit, verifiable evidence required to trigger this policy */
  readonly evidenceRequirement: string;

  /** Resulting operational decision */
  readonly decision: ResponseAction;

  /** Explanation shown to the user */
  readonly userExplanation: string;

  /** Reason code or matched rule identifier */
  readonly ruleId: string;

  /** Required downstream extension behavior */
  readonly downstreamBehavior: string;

  /** Known false-positive and false-negative limitations */
  readonly limitations: RiskPolicyLimitations;

  /** Predicate testing whether an action satisfies this policy's evidence requirement */
  readonly appliesTo: (action: GuardrailAction, assessment?: Readonly<RiskAssessment>) => boolean;

  /** Evaluates this policy deterministically */
  readonly evaluate: (
    action: GuardrailAction,
    assessment?: Readonly<RiskAssessment>
  ) => PolicyEvaluationResult;
}
