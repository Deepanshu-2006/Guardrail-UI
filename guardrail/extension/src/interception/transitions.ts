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

/**
 * Declarative mapping of permitted forward state transitions for each InterceptionState.
 *
 * Valid state transitions:
 * - DETECTED  -> [HELD, CONTINUED, CANCELLED]
 * - HELD      -> [CONTINUED, CANCELLED]
 * - CONTINUED -> [] (Terminal)
 * - CANCELLED -> [] (Terminal)
 */
export const VALID_INTERCEPTION_TRANSITIONS: Readonly<
  Record<InterceptionState, readonly InterceptionState[]>
> = Object.freeze({
  [InterceptionState.DETECTED]: Object.freeze([
    InterceptionState.HELD,
    InterceptionState.CONTINUED,
    InterceptionState.CANCELLED,
  ]),
  [InterceptionState.HELD]: Object.freeze([
    InterceptionState.CONTINUED,
    InterceptionState.CANCELLED,
  ]),
  [InterceptionState.CONTINUED]: Object.freeze([]),
  [InterceptionState.CANCELLED]: Object.freeze([]),
});

/**
 * Checks whether a given InterceptionState is a terminal state.
 * Terminal states (CONTINUED, CANCELLED) signify the end of the action's lifecycle
 * and cannot undergo any further transitions.
 *
 * @param state The InterceptionState to evaluate
 * @returns True if the state is terminal
 */
export function isTerminalInterceptionState(state: InterceptionState): boolean {
  return state === InterceptionState.CONTINUED || state === InterceptionState.CANCELLED;
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
