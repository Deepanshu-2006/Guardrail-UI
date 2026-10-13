/**
 * Guardrail Staging Mode - Action Context Data Model
 *
 * Defines the strongly-typed data structures for representing an intercepted action
 * prepared for Staging Mode display.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. LEAST PRIVILEGE / MINIMAL SURFACE:
 *    - Supplies strictly the information necessary for the Staging UI to render a clear, safe preview.
 *    - Never exposes raw form payloads, user inputs, passwords, OTPs, credit cards, or internal DOM nodes.
 * 2. PRE-COMPUTED RISK & GOVERNANCE:
 *    - Reuses existing RiskAssessment, ResponseDecision, and InterceptionRecord outputs.
 *    - The UI is never responsible for calculating risk scores, running heuristics, or deciding policy.
 * 3. STABLE IDENTIFIER PRESERVATION:
 *    - Preserves the original `actionId` across capture, holding, staging, and resolution.
 * 4. SAFE ORIGIN & URL HANDLING:
 *    - Extracts only sanitized origin and hostname, stripping credentials and query parameters.
 * 5. REUSE OVER RE-CREATION:
 *    - Directly reuses canonical enums (ActionCategory, ActionType, RiskLevel, ResponseAction, InterceptionState)
 *      rather than introducing competing definitions.
 */

import { ActionCategory, ActionType, GuardrailAction } from './actions.js';
import { ActionClassificationResult } from './classification.js';
import { InterceptionRecord, InterceptionState } from './interception.js';
import { ResponseAction, ResponseDecision } from './response.js';
import { RiskAssessment, RiskLevel } from './risk.js';

/**
 * Strongly typed staging context representing an intercepted action prepared for Staging Mode display.
 *
 * Designed as a lean, immutable data contract consumed directly by the Staging UI.
 */
export interface StagingActionContext {
  /**
   * Stable, unique identifier of the intercepted action.
   * Matches the original GuardrailAction id and InterceptionRecord actionId.
   */
  readonly actionId: string;

  /**
   * Human-readable, safe summary describing the nature of the intercepted action
   * (e.g. "Click button 'Delete Account'", "Page navigation to checkout", "Form submission").
   * STRICT PRIVACY: Derived from element metadata and category without user-typed input values.
   */
  readonly description: string;

  /**
   * The underlying interaction mechanism (CLICK, INPUT, SUBMIT, NAVIGATION).
   */
  readonly actionType: ActionType;

  /**
   * Semantic category classifying the domain intent of the action, if available
   * (e.g. PAYMENT, DESTRUCTIVE, AUTHENTICATION, DOWNLOAD, GENERAL).
   */
  readonly category?: ActionCategory;

  /**
   * Qualitative severity level determined by the Risk Engine (LOW, MEDIUM, HIGH, CRITICAL).
   */
  readonly riskLevel: RiskLevel;

  /**
   * Quantitative risk score on a 0-100 scale, evaluated by the Risk Engine.
   */
  readonly riskScore?: number;

  /**
   * Non-sensitive explanations justifying the risk assessment score and severity.
   */
  readonly riskReasons: readonly string[];

  /**
   * Operational response action determined by the Response Engine (ALLOW, WARN, PROTECT).
   */
  readonly responseAction: ResponseAction;

  /**
   * Current interception lifecycle state (DETECTED, HELD, CONTINUED, CANCELLED).
   */
  readonly interceptionState: InterceptionState;

  /**
   * Human-readable explanation of why the action is in its current interception state.
   */
  readonly interceptionReason?: string;

  /**
   * Sanitized website origin where the action was intercepted (e.g. "https://example.com").
   * Strips path, query string, auth credentials, and hash. Undefined if URL is unavailable or invalid.
   */
  readonly origin?: string;

  /**
   * Sanitized hostname of the website (e.g. "example.com" or "demo.localhost").
   * Undefined if unavailable or invalid.
   */
  readonly hostname?: string;

  /**
   * Safe document title of the webpage at the moment of interaction, if available.
   */
  readonly pageTitle?: string;

  /**
   * ISO 8601 timestamp recording when the action was originally captured.
   */
  readonly timestamp: string;

  /**
   * ISO 8601 timestamp recording when this staging context was prepared.
   */
  readonly stagedAt: string;
}

/**
 * Parameters supplied to the staging context factory.
 * Accepts existing pipeline outputs to ensure seamless integration and avoid recomputation.
 */
export interface CreateStagingContextInput {
  /**
   * The captured interaction model.
   */
  action: GuardrailAction;

  /**
   * The active or historical interception record governing this action.
   */
  interception: InterceptionRecord;

  /**
   * Pre-computed risk evaluation from the Risk Engine.
   */
  risk: RiskAssessment;

  /**
   * Optional classification output from the Action Classifier.
   */
  classification?: ActionClassificationResult;

  /**
   * Optional operational decision from the Response Engine.
   * If omitted, derived from risk or defaults to ResponseAction.PROTECT if held.
   */
  decision?: ResponseDecision;
}
