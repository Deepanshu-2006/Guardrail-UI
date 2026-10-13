/**
 * Guardrail Staging Mode - Context Builder & Sanitization Engine
 *
 * Implements deterministic context creation, safe URL parsing, and privacy-preserving
 * action description synthesis for displaying intercepted actions in Staging Mode.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. ZERO RE-COMPUTATION:
 *    - Reuses outputs from the Action Classifier, Risk Engine, Response Engine, and Interception Controller.
 *    - The Staging UI is never tasked with assessing risk or making policy decisions.
 * 2. STRICT PRIVACY & CREDENTIAL STRIPPING:
 *    - Strips user query parameters, auth credentials, tokens, and fragments from URLs.
 *    - Extracts static element labels and structural attributes only; never captures user inputs, passwords, or OTPs.
 * 3. GRACEFUL METADATA DEGRADATION:
 *    - Handles missing, partial, or malformed attributes gracefully with safe fallbacks.
 * 4. IMMUTABILITY:
 *    - Returns frozen, readonly contexts safe to share across extension boundaries.
 */

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { ActionClassificationResult } from '../types/classification.js';
import { InterceptionState } from '../types/interception.js';
import { ResponseAction } from '../types/response.js';
import { RiskLevel } from '../types/risk.js';
import { CreateStagingContextInput, StagingActionContext } from '../types/staging.js';

/**
 * Maximum character length allowed for element label extracts in descriptions.
 */
const MAX_LABEL_LENGTH = 80;

/**
 * Normalizes and cleans element labels, stripping excessive whitespace and control characters.
 *
 * @param raw Raw text extracted from element
 * @returns Cleaned label string
 */
function sanitizeLabel(raw: string): string {
  const cleaned = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length > MAX_LABEL_LENGTH) {
    return `${cleaned.slice(0, MAX_LABEL_LENGTH)}...`;
  }
  return cleaned;
}

/**
 * Formats canonical ActionCategory names into clean human-readable labels.
 */
function formatCategoryLabel(category: ActionCategory): string {
  switch (category) {
    case ActionCategory.PAYMENT:
      return 'Payment & Billing';
    case ActionCategory.DESTRUCTIVE:
      return 'Destructive Deletion';
    case ActionCategory.AUTHENTICATION:
      return 'Authentication & Credentials';
    case ActionCategory.DOWNLOAD:
      return 'File Download & Export';
    case ActionCategory.EXTERNAL_NAVIGATION:
      return 'External Navigation';
    case ActionCategory.GENERAL:
    default:
      return 'General Interaction';
  }
}

/**
 * Safely extracts sanitized website origin and hostname from a webpage URL.
 *
 * PRIVACY GUARANTEE:
 * - Strips all basic auth credentials (user:password@)
 * - Strips all URL paths (/account/settings)
 * - Strips all query parameters (?token=secret&api_key=123)
 * - Strips all fragments and hashes (#hash)
 * - Handles malformed URLs, relative paths, and 'about:blank' without throwing
 *
 * @param rawUrl The raw URL string from ActionPageInfo
 * @returns Object with optional origin and hostname
 */
export function extractSafeOriginAndHost(rawUrl?: string): {
  origin?: string;
  hostname?: string;
} {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {};
  }

  const trimmed = rawUrl.trim();
  if (
    !trimmed ||
    trimmed === 'about:blank' ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:')
  ) {
    return {};
  }

  try {
    const parsed = new URL(trimmed);

    // Standard web schemes (http, https)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return {
        origin: parsed.origin,
        hostname: parsed.hostname || undefined,
      };
    }

    // Chrome/browser extension scheme
    if (parsed.protocol === 'chrome-extension:' || parsed.protocol === 'moz-extension:') {
      return {
        origin: parsed.hostname ? `${parsed.protocol}//${parsed.hostname}` : undefined,
        hostname: parsed.hostname || undefined,
      };
    }

    // Fallback for other valid URIs
    if (parsed.origin && parsed.origin !== 'null') {
      return {
        origin: parsed.origin,
        hostname: parsed.hostname || undefined,
      };
    }

    return {
      hostname: parsed.hostname || undefined,
    };
  } catch {
    // Malformed URL or non-standard relative path: fail gracefully without exceptions
    return {};
  }
}

/**
 * Synthesizes a human-readable, privacy-safe description of an intercepted action.
 *
 * STRICT PRIVACY:
 * - Uses only element tag names, IDs, and static text labels.
 * - Never consumes user-typed values, inputs, passwords, or arbitrary form contents.
 *
 * @param action The normalized GuardrailAction
 * @param classification Optional classification result
 * @returns Human-friendly, safe action description
 */
export function generateSafeActionDescription(
  action: GuardrailAction,
  classification?: ActionClassificationResult
): string {
  const type = action.type;
  const element = action.element;
  const category = classification?.category || action.category;

  // Derive safe visual label or element identifier
  let labelPart = '';
  if (element?.visibleText && element.visibleText.trim()) {
    labelPart = `"${sanitizeLabel(element.visibleText)}"`;
  } else if (element?.id && element.id.trim()) {
    labelPart = `#${sanitizeLabel(element.id)}`;
  } else if (element?.tagName) {
    labelPart = `<${element.tagName.toLowerCase()}>`;
  }

  switch (type) {
    case ActionType.CLICK: {
      const targetSuffix = labelPart ? ` ${labelPart}` : '';
      if (category === ActionCategory.PAYMENT) {
        return `Payment trigger: Click on${targetSuffix}`;
      }
      if (category === ActionCategory.DESTRUCTIVE) {
        return `Destructive operation: Click on${targetSuffix}`;
      }
      if (category === ActionCategory.AUTHENTICATION) {
        return `Authentication trigger: Click on${targetSuffix}`;
      }
      if (category === ActionCategory.DOWNLOAD) {
        return `Download trigger: Click on${targetSuffix}`;
      }
      if (category === ActionCategory.EXTERNAL_NAVIGATION) {
        return `External navigation trigger: Click on${targetSuffix}`;
      }
      return labelPart ? `Click on ${labelPart}` : 'Click on interactive element';
    }

    case ActionType.SUBMIT: {
      const formSuffix = labelPart ? ` via ${labelPart}` : '';
      if (category && category !== ActionCategory.GENERAL) {
        return `Form submission (${formatCategoryLabel(category)})${formSuffix}`;
      }
      return `Form submission${formSuffix}`;
    }

    case ActionType.INPUT: {
      // PRIVACY SAFEGUARD: Completely omits any user-typed content
      const fieldSuffix = labelPart ? ` (${labelPart})` : '';
      if (category === ActionCategory.AUTHENTICATION) {
        return `Authentication field interaction${fieldSuffix}`;
      }
      if (category === ActionCategory.PAYMENT) {
        return `Payment field interaction${fieldSuffix}`;
      }
      return `Form input field interaction${fieldSuffix}`;
    }

    case ActionType.NAVIGATION: {
      const { hostname } = extractSafeOriginAndHost(action.page?.url);
      if (hostname) {
        return `Page navigation to ${hostname}`;
      }
      return 'Page navigation';
    }

    default:
      return 'User interaction';
  }
}

/**
 * Creates a strongly typed StagingActionContext from existing pipeline outputs.
 *
 * Ensures all required Staging UI metadata is assembled, sanitized, and frozen.
 * Does not re-evaluate risk or re-run heuristic algorithms.
 *
 * @param input Complete or partial pipeline outputs
 * @returns Frozen, strongly typed StagingActionContext
 */
export function createStagingActionContext(
  input: CreateStagingContextInput
): StagingActionContext {
  const { action, interception, risk, classification, decision } = input;

  if (!action || typeof action.id !== 'string') {
    throw new Error('[Guardrail Staging] Cannot create StagingActionContext without a valid GuardrailAction.');
  }

  if (!interception || typeof interception.actionId !== 'string') {
    throw new Error('[Guardrail Staging] Cannot create StagingActionContext without an InterceptionRecord.');
  }

  if (!risk || typeof risk.riskLevel !== 'string') {
    throw new Error('[Guardrail Staging] Cannot create StagingActionContext without a RiskAssessment.');
  }

  // 1. Stable Action Identifier
  const actionId = action.id;

  // 2. Safe Action Description
  const description = generateSafeActionDescription(action, classification);

  // 3. Category (prefer classification, fall back to action model)
  const category = classification?.category || action.category || undefined;

  // 4. Pre-computed Risk Evaluation (no re-calculation)
  const riskLevel = risk.riskLevel;
  const riskScore = typeof risk.score === 'number' ? Math.max(0, Math.min(100, risk.score)) : undefined;
  const riskReasons = Array.isArray(risk.reasons) ? Object.freeze([...risk.reasons]) : Object.freeze([]);

  // 5. Response Decision
  const responseAction =
    decision?.response ||
    (interception.state === InterceptionState.HELD
      ? ResponseAction.PROTECT
      : ResponseAction.ALLOW);

  // 6. Current Interception Status
  const interceptionState = interception.state;
  const interceptionReason = interception.reason || undefined;

  // 7. Sanitized Website Origin & Hostname
  const { origin, hostname } = extractSafeOriginAndHost(action.page?.url);

  // 8. Safe Page Title (trimmed)
  const pageTitle = action.page?.title ? action.page.title.trim() : undefined;

  // 9. Timestamps
  const timestamp = action.timestamp || new Date().toISOString();
  const stagedAt = new Date().toISOString();

  // Assemble and deeply freeze the staging context
  const context: StagingActionContext = Object.freeze({
    actionId,
    description,
    actionType: action.type,
    category,
    riskLevel,
    riskScore,
    riskReasons,
    responseAction,
    interceptionState,
    interceptionReason,
    origin,
    hostname,
    pageTitle,
    timestamp,
    stagedAt,
  });

  return context;
}

/**
 * Type guard verifying whether an arbitrary object conforms to the StagingActionContext contract.
 *
 * @param value Candidate object to inspect
 * @returns True if value is a valid StagingActionContext
 */
export function isStagingActionContext(value: unknown): value is StagingActionContext {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.actionId === 'string' &&
    candidate.actionId.length > 0 &&
    typeof candidate.description === 'string' &&
    typeof candidate.actionType === 'string' &&
    Object.values(ActionType).includes(candidate.actionType as ActionType) &&
    typeof candidate.riskLevel === 'string' &&
    Object.values(RiskLevel).includes(candidate.riskLevel as RiskLevel) &&
    Array.isArray(candidate.riskReasons) &&
    typeof candidate.responseAction === 'string' &&
    Object.values(ResponseAction).includes(candidate.responseAction as ResponseAction) &&
    typeof candidate.interceptionState === 'string' &&
    Object.values(InterceptionState).includes(candidate.interceptionState as InterceptionState) &&
    typeof candidate.timestamp === 'string' &&
    typeof candidate.stagedAt === 'string'
  );
}

/**
 * Validates a StagingActionContext against data integrity and privacy rules.
 *
 * @param context The context to inspect
 * @returns Validation outcome with any detected errors
 */
export function validateStagingActionContext(
  context: StagingActionContext
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!context.actionId || typeof context.actionId !== 'string') {
    errors.push('Missing or invalid actionId.');
  }

  if (!context.description || typeof context.description !== 'string') {
    errors.push('Missing or invalid description.');
  }

  if (!Object.values(ActionType).includes(context.actionType)) {
    errors.push(`Invalid actionType: ${String(context.actionType)}`);
  }

  if (context.category && !Object.values(ActionCategory).includes(context.category)) {
    errors.push(`Invalid category: ${String(context.category)}`);
  }

  if (!Object.values(RiskLevel).includes(context.riskLevel)) {
    errors.push(`Invalid riskLevel: ${String(context.riskLevel)}`);
  }

  if (typeof context.riskScore === 'number' && (context.riskScore < 0 || context.riskScore > 100)) {
    errors.push(`riskScore out of bounds (0-100): ${context.riskScore}`);
  }

  if (!Array.isArray(context.riskReasons)) {
    errors.push('riskReasons must be an array.');
  }

  if (!Object.values(ResponseAction).includes(context.responseAction)) {
    errors.push(`Invalid responseAction: ${String(context.responseAction)}`);
  }

  if (!Object.values(InterceptionState).includes(context.interceptionState)) {
    errors.push(`Invalid interceptionState: ${String(context.interceptionState)}`);
  }

  // Privacy scan: verify forbidden properties are not present
  const forbiddenKeywords = [
    'password', 'pass', 'pwd',
    'card', 'cvv', 'cvc',
    'otp', 'pin', 'secret',
    'token', 'cookie', 'auth',
    'value', 'inputvalue', 'formcontent',
    'elementnode', 'noderef'
  ];

  const candidate = context as unknown as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    const lowerKey = key.toLowerCase();
    if (forbiddenKeywords.some((forbidden) => lowerKey === forbidden)) {
      errors.push(`Privacy violation: Context contains forbidden property "${key}".`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
