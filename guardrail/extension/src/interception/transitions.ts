/**
 * Guardrail Interception State Transition Engine
 *
 * Implements deterministic transition rules, validation logic, and factory functions
 * for the InterceptionRecord lifecycle model.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. STRICT IMMUTABILITY:
 *    - Transition functions never mutate existing InterceptionRecord instances;
 *      they return newly created, frozen records.
 * 2. ACTION ID INTEGRITY:
 *    - The actionId is strictly preserved across all transitions.
 * 3. CONTROLLED STATE TRANSITIONS:
 *    - Enforces valid transition paths and throws InvalidStateTransitionError on violations.
 * 4. ISOLATION:
 *    - Zero DOM references and zero coupling to risk algorithms or sensitive values.
 */

import {
  InterceptionRecord,
  InterceptionState,
} from '../types/interception.js';

import {
  ApprovalActionBinding,
  ApprovalActionBindingState,
  ApprovalRequest,
  ApprovalStatus,
} from '../types/approval.js';
import {
  defaultTimeProvider,
  isRequestExpired,
  TimeProvider,
} from '../approval/model.js';
import { isBindingExpired } from '../approval/binding.js';

/**
 * Declarative mapping of permitted forward state transitions for each InterceptionState / ControlledActionState.
 *
 * Valid state transitions:
 * - DETECTED                    -> [HELD, CONTINUED, CANCELLED, INVALIDATED]
 * - HELD                        -> [AWAITING_APPROVAL, READY_FOR_USER_CONFIRMATION, CONTINUED, CANCELLED, EXPIRED, INVALIDATED]
 * - AWAITING_APPROVAL           -> [READY_FOR_USER_CONFIRMATION, CANCELLED, EXPIRED, INVALIDATED]
 * - READY_FOR_USER_CONFIRMATION -> [CONTINUED, CANCELLED, EXPIRED, INVALIDATED]
 * - CONTINUED                   -> [] (Terminal)
 * - CANCELLED                   -> [] (Terminal)
 * - EXPIRED                     -> [] (Terminal)
 * - INVALIDATED                 -> [] (Terminal)
 */
export const VALID_INTERCEPTION_TRANSITIONS: Readonly<
  Record<InterceptionState, readonly InterceptionState[]>
> = Object.freeze({
  [InterceptionState.DETECTED]: Object.freeze([
    InterceptionState.HELD,
    InterceptionState.CONTINUED,
    InterceptionState.CANCELLED,
    InterceptionState.INVALIDATED,
  ]),
  [InterceptionState.HELD]: Object.freeze([
    InterceptionState.AWAITING_APPROVAL,
    InterceptionState.READY_FOR_USER_CONFIRMATION,
    InterceptionState.CONTINUED,
    InterceptionState.CANCELLED,
    InterceptionState.EXPIRED,
    InterceptionState.INVALIDATED,
  ]),
  [InterceptionState.AWAITING_APPROVAL]: Object.freeze([
    InterceptionState.READY_FOR_USER_CONFIRMATION,
    InterceptionState.CANCELLED,
    InterceptionState.EXPIRED,
    InterceptionState.INVALIDATED,
  ]),
  [InterceptionState.READY_FOR_USER_CONFIRMATION]: Object.freeze([
    InterceptionState.CONTINUED,
    InterceptionState.CANCELLED,
    InterceptionState.EXPIRED,
    InterceptionState.INVALIDATED,
  ]),
  [InterceptionState.CONTINUED]: Object.freeze([]),
  [InterceptionState.CANCELLED]: Object.freeze([]),
  [InterceptionState.EXPIRED]: Object.freeze([]),
  [InterceptionState.INVALIDATED]: Object.freeze([]),
});

/**
 * Checks whether a given InterceptionState is a terminal state.
 * Terminal states (CONTINUED, CANCELLED, EXPIRED, INVALIDATED) signify the end of the action's lifecycle
 * and cannot undergo any further transitions.
 *
 * @param state The InterceptionState to evaluate
 * @returns True if the state is terminal
 */
export function isTerminalInterceptionState(state: InterceptionState): boolean {
  return (
    state === InterceptionState.CONTINUED ||
    state === InterceptionState.CANCELLED ||
    state === InterceptionState.EXPIRED ||
    state === InterceptionState.INVALIDATED
  );
}

/**
 * Validates whether transitioning from `currentState` to `nextState` is permissible
 * under Guardrail's lifecycle state machine rules.
 *
 * @param currentState Current state of the interception record
 * @param nextState Intended target state
 * @returns True if the transition is allowed
 */
export function isValidInterceptionTransition(
  currentState: InterceptionState,
  nextState: InterceptionState
): boolean {
  const allowed = VALID_INTERCEPTION_TRANSITIONS[currentState];
  return Boolean(allowed && allowed.includes(nextState));
}

/**
 * Error thrown when an invalid interception state transition is attempted.
 */
export class InvalidStateTransitionError extends Error {
  public readonly actionId: string;
  public readonly fromState: InterceptionState;
  public readonly toState: InterceptionState;

  constructor(actionId: string, fromState: InterceptionState, toState: InterceptionState) {
    super(
      `[Guardrail Interception] Invalid state transition for actionId "${actionId}": Cannot transition from ${fromState} to ${toState}.`
    );
    this.name = 'InvalidStateTransitionError';
    this.actionId = actionId;
    this.fromState = fromState;
    this.toState = toState;
  }
}

/**
 * Factory to create an initial InterceptionRecord in the DETECTED state.
 *
 * @param actionId Unique action identifier to preserve across the pipeline
 * @param reason Human-readable explanation of why the action was detected
 * @param timestamp Optional ISO 8601 creation timestamp (defaults to current time)
 * @returns An immutable InterceptionRecord in DETECTED state
 */
export function createInterceptionRecord(
  actionId: string,
  reason: string = 'Action captured at browser capture boundary.',
  timestamp: string = new Date().toISOString()
): InterceptionRecord {
  if (!actionId || typeof actionId !== 'string' || !actionId.trim()) {
    throw new Error('[Guardrail Interception] Cannot create InterceptionRecord without a valid actionId.');
  }

  return Object.freeze({
    actionId: actionId.trim(),
    state: InterceptionState.DETECTED,
    createdAt: timestamp,
    reason,
  });
}

/**
 * Transitions an existing InterceptionRecord to a valid new state.
 *
 * @param currentRecord The existing InterceptionRecord (immutable)
 * @param nextState The desired target InterceptionState
 * @param reason Human-readable explanation justifying the transition
 * @param timestamp Optional ISO 8601 timestamp for the transition (defaults to current time)
 * @returns A new, immutable InterceptionRecord reflecting the transition
 * @throws InvalidStateTransitionError if the requested transition is prohibited
 */
export function transitionInterceptionRecord(
  currentRecord: Readonly<InterceptionRecord>,
  nextState: InterceptionState,
  reason: string,
  timestamp: string = new Date().toISOString()
): InterceptionRecord {
  if (!currentRecord) {
    throw new Error('[Guardrail Interception] currentRecord is required for state transition.');
  }

  if (!isValidInterceptionTransition(currentRecord.state, nextState)) {
    throw new InvalidStateTransitionError(
      currentRecord.actionId,
      currentRecord.state,
      nextState
    );
  }

  const isTerminal = isTerminalInterceptionState(nextState);

  return Object.freeze({
    actionId: currentRecord.actionId,
    state: nextState,
    createdAt: currentRecord.createdAt,
    resolvedAt: isTerminal ? timestamp : undefined,
    reason,
  });
}

// =============================================================================
// Continuation Eligibility Evaluator (Requirement 5)
// =============================================================================

export interface ContinuationEligibilityInput {
  readonly actionId: string;
  readonly request?: ApprovalRequest | null;
  readonly binding?: ApprovalActionBinding | null;
  readonly currentPageContext?: { readonly url?: string; readonly origin?: string };
  readonly originalPageUrl?: string;
  readonly isElementAttached?: boolean | ((elementId: string) => boolean);
  readonly targetElementId?: string;
  readonly timeProvider?: TimeProvider;
}

export interface ContinuationEligibilityResult {
  readonly eligible: boolean;
  readonly targetState: InterceptionState;
  readonly reason: string;
  readonly errorCode?: string;
}

/**
 * Pure evaluation function that verifies all preconditions required before an action
 * becomes eligible for user confirmation (Requirement 5).
 *
 * Checks:
 * 1. Expiration (request & binding) via authoritative server time provider -> EXPIRED
 * 2. Binding status (not invalidated/cancelled/rejected) -> INVALIDATED
 * 3. Approval request status:
 *    - REJECTED -> INVALIDATED
 *    - CANCELLED -> CANCELLED
 *    - EXPIRED -> EXPIRED
 *    - PENDING / missing -> AWAITING_APPROVAL (eligible: false)
 *    - APPROVED -> continues to context checks
 * 4. Action correlation (actionId matches request and binding) -> INVALIDATED
 * 5. Page context (origin and pathname unchanged) -> INVALIDATED
 * 6. Target DOM element connected -> INVALIDATED
 *
 * If all pass: returns eligible: true, targetState: READY_FOR_USER_CONFIRMATION
 */
export function evaluateContinuationEligibility(
  input: ContinuationEligibilityInput
): ContinuationEligibilityResult {
  const timeProvider = input.timeProvider ?? defaultTimeProvider;

  // 1. Expiration checks
  if (input.request && isRequestExpired(input.request, timeProvider)) {
    return {
      eligible: false,
      targetState: InterceptionState.EXPIRED,
      reason: `Approval request "${input.request.id}" has expired.`,
      errorCode: 'REQUEST_EXPIRED',
    };
  }

  if (input.binding && isBindingExpired(input.binding, timeProvider)) {
    return {
      eligible: false,
      targetState: InterceptionState.EXPIRED,
      reason: `Action binding "${input.binding.id}" has expired.`,
      errorCode: 'BINDING_EXPIRED',
    };
  }

  // 2. Binding status
  if (input.binding) {
    if (
      input.binding.state === ApprovalActionBindingState.INVALIDATED ||
      input.binding.state === ApprovalActionBindingState.CANCELLED ||
      input.binding.state === ApprovalActionBindingState.REJECTED
    ) {
      return {
        eligible: false,
        targetState: InterceptionState.INVALIDATED,
        reason: `Action binding "${input.binding.id}" is in non-authorizing state "${input.binding.state}".`,
        errorCode: 'BINDING_INVALIDATED',
      };
    }
  }

  // 3. Approval request status
  if (!input.request) {
    return {
      eligible: false,
      targetState: InterceptionState.AWAITING_APPROVAL,
      reason: 'No approval request provided. Awaiting approval decision.',
      errorCode: 'REQUEST_NOT_APPROVED',
    };
  }

  if (input.request.status === ApprovalStatus.REJECTED) {
    return {
      eligible: false,
      targetState: InterceptionState.INVALIDATED,
      reason: `Approval request "${input.request.id}" was rejected by trusted contact.`,
      errorCode: 'REQUEST_REJECTED',
    };
  }

  if (input.request.status === ApprovalStatus.CANCELLED) {
    return {
      eligible: false,
      targetState: InterceptionState.CANCELLED,
      reason: `Approval request "${input.request.id}" was cancelled.`,
      errorCode: 'REQUEST_CANCELLED',
    };
  }

  if (input.request.status === ApprovalStatus.EXPIRED) {
    return {
      eligible: false,
      targetState: InterceptionState.EXPIRED,
      reason: `Approval request "${input.request.id}" has expired.`,
      errorCode: 'REQUEST_EXPIRED',
    };
  }

  if (input.request.status === ApprovalStatus.PENDING) {
    return {
      eligible: false,
      targetState: InterceptionState.AWAITING_APPROVAL,
      reason: `Approval request "${input.request.id}" is still pending review.`,
      errorCode: 'REQUEST_NOT_APPROVED',
    };
  }

  if (input.request.status !== ApprovalStatus.APPROVED) {
    return {
      eligible: false,
      targetState: InterceptionState.INVALIDATED,
      reason: `Unknown or non-approved status "${input.request.status}".`,
      errorCode: 'REQUEST_NOT_APPROVED',
    };
  }

  // 4. Action correlation
  if (input.request.actionId !== input.actionId) {
    return {
      eligible: false,
      targetState: InterceptionState.INVALIDATED,
      reason: `Action ID mismatch: Request bound to "${input.request.actionId}", target action is "${input.actionId}".`,
      errorCode: 'ACTION_ID_MISMATCH',
    };
  }

  if (input.binding && input.binding.actionId !== input.actionId) {
    return {
      eligible: false,
      targetState: InterceptionState.INVALIDATED,
      reason: `Action ID mismatch: Binding bound to "${input.binding.actionId}", target action is "${input.actionId}".`,
      errorCode: 'ACTION_ID_MISMATCH',
    };
  }

  // 5. Page context verification
  if (input.originalPageUrl && input.currentPageContext) {
    const origUrl = input.originalPageUrl;
    const currentOrigin = input.currentPageContext.origin;
    const currentUrl = input.currentPageContext.url;

    if (origUrl && currentOrigin) {
      try {
        const origOrigin = new URL(origUrl).origin;
        if (origOrigin !== currentOrigin) {
          return {
            eligible: false,
            targetState: InterceptionState.INVALIDATED,
            reason: `Page context mismatch: Interaction origin "${currentOrigin}" does not match original origin "${origOrigin}".`,
            errorCode: 'PAGE_CONTEXT_MISMATCH',
          };
        }
      } catch {
        return {
          eligible: false,
          targetState: InterceptionState.INVALIDATED,
          reason: `Invalid original URL "${origUrl}".`,
          errorCode: 'PAGE_CONTEXT_MISMATCH',
        };
      }
    }

    if (origUrl && currentUrl) {
      try {
        const origParsed = new URL(origUrl);
        const currParsed = new URL(currentUrl);
        if (origParsed.origin !== currParsed.origin || origParsed.pathname !== currParsed.pathname) {
          return {
            eligible: false,
            targetState: InterceptionState.INVALIDATED,
            reason: `Page context mismatch: Target path "${currParsed.pathname}" does not match original path "${origParsed.pathname}".`,
            errorCode: 'PAGE_CONTEXT_MISMATCH',
          };
        }
      } catch {
        return {
          eligible: false,
          targetState: InterceptionState.INVALIDATED,
          reason: `Failed to compare page URLs.`,
          errorCode: 'PAGE_CONTEXT_MISMATCH',
        };
      }
    }
  }

  // 6. Target DOM element attachment verification
  if (input.targetElementId) {
    const elemId = input.targetElementId;
    if (typeof input.isElementAttached === 'function') {
      if (!input.isElementAttached(elemId)) {
        return {
          eligible: false,
          targetState: InterceptionState.INVALIDATED,
          reason: `Target element "#${elemId}" is no longer attached to document.`,
          errorCode: 'ELEMENT_DETACHED',
        };
      }
    } else if (typeof input.isElementAttached === 'boolean' && !input.isElementAttached) {
      return {
        eligible: false,
        targetState: InterceptionState.INVALIDATED,
        reason: `Target element "#${elemId}" is not attached to document.`,
        errorCode: 'ELEMENT_DETACHED',
      };
    } else if (typeof document !== 'undefined') {
      const el = document.getElementById(elemId);
      if (!el) {
        return {
          eligible: false,
          targetState: InterceptionState.INVALIDATED,
          reason: `Target element "#${elemId}" was removed from active DOM.`,
          errorCode: 'ELEMENT_DETACHED',
        };
      }
    }
  }

  // ALL CHECKS PASSED: Transition to READY_FOR_USER_CONFIRMATION
  return {
    eligible: true,
    targetState: InterceptionState.READY_FOR_USER_CONFIRMATION,
    reason: 'Backend approval confirmed and all required binding, expiration, and context checks passed.',
  };
}

/**
 * Transitions an InterceptionRecord based on an evaluated ContinuationEligibilityResult.
 * If the record is already in the targetState, returns the record unchanged (idempotent).
 */
export function transitionActionOnEligibility(
  currentRecord: Readonly<InterceptionRecord>,
  eligibility: ContinuationEligibilityResult,
  timestamp: string = new Date().toISOString()
): InterceptionRecord {
  if (currentRecord.state === eligibility.targetState) {
    return currentRecord;
  }
  return transitionInterceptionRecord(
    currentRecord,
    eligibility.targetState,
    eligibility.reason,
    timestamp
  );
}
