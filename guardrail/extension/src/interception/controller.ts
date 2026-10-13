/**
 * Guardrail Interception Controller
 *
 * In-memory controller managing the operational lifecycle state machine
 * of intercepted browser actions.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. STRICT SEPARATION OF CONCERNS:
 *    - Independent of DOM manipulation and live element references.
 *    - Independent of the Risk Engine and classification logic.
 *    - Tracks purely the lifecycle state (DETECTED, HELD, CONTINUED, CANCELLED).
 * 2. ACTION ID INTEGRITY:
 *    - Keyed by `actionId` to correlate seamlessly with GuardrailAction,
 *      classification, risk assessment, and response decisions.
 * 3. STRICT PRIVACY & DATA ISOLATION:
 *    - Stores no DOM nodes, no typed passwords, credit cards, OTPs, or form payloads.
 *    - Retains only immutable InterceptionRecord data structures.
 * 4. IN-MEMORY RUNTIME:
 *    - Operates in-memory for active browser sessions without requiring a database.
 * 5. DETERMINISTIC STATE ENFORCEMENT:
 *    - Rejects invalid transitions or attempts to re-resolve already resolved actions.
 */

import { GuardrailAction } from '../types/actions.js';
import {
  InterceptionRecord,
  InterceptionState,
} from '../types/interception.js';
import {
  createInterceptionRecord,
  isTerminalInterceptionState,
  transitionInterceptionRecord,
} from './transitions.js';

/**
 * Error thrown when an operation targets an actionId that is not registered.
 */
export class ActionNotFoundError extends Error {
  public readonly actionId: string;

  constructor(actionId: string) {
    super(`[Guardrail InterceptionController] Action with id "${actionId}" was not found.`);
    this.name = 'ActionNotFoundError';
    this.actionId = actionId;
  }
}

/**
 * Error thrown when an action with the specified actionId is already registered.
 */
export class ActionAlreadyRegisteredError extends Error {
  public readonly actionId: string;

  constructor(actionId: string) {
    super(`[Guardrail InterceptionController] Action with id "${actionId}" is already registered.`);
    this.name = 'ActionAlreadyRegisteredError';
    this.actionId = actionId;
  }
}

/**
 * In-memory lifecycle controller for intercepted actions.
 */
export class InterceptionController {
  private readonly records: Map<string, InterceptionRecord> = new Map();

  /**
   * Registers a new intercepted action in the DETECTED state.
   *
   * @param actionOrId GuardrailAction object or explicit actionId string
   * @param reason Human-readable explanation for why the action was intercepted
   * @returns The newly created, immutable InterceptionRecord in DETECTED state
   * @throws ActionAlreadyRegisteredError if an action with this actionId is already tracked
   * @throws Error if actionId is missing or empty
   */
  public register(
    actionOrId: GuardrailAction | string,
    reason: string = 'Action registered in interception controller.'
  ): InterceptionRecord {
    const actionId = typeof actionOrId === 'string' ? actionOrId.trim() : actionOrId?.id?.trim();

    if (!actionId) {
      throw new Error('[Guardrail InterceptionController] Cannot register action without a valid actionId.');
    }

    if (this.records.has(actionId)) {
      throw new ActionAlreadyRegisteredError(actionId);
    }

    const record = createInterceptionRecord(actionId, reason);
    this.records.set(actionId, record);
    return record;
  }

  /**
   * Retrieves an InterceptionRecord by actionId.
   *
   * @param actionId Unique identifier of the action
   * @returns The immutable InterceptionRecord, or undefined if not found
   */
  public getRecord(actionId: string): InterceptionRecord | undefined {
    return this.records.get(actionId);
  }

  /**
   * Checks whether an actionId is currently tracked by this controller.
   *
   * @param actionId Unique identifier of the action
   * @returns True if the action is tracked
   */
  public hasRecord(actionId: string): boolean {
    return this.records.has(actionId);
  }

  /**
   * Transitions a tracked action from DETECTED to HELD.
   *
   * @param actionId Unique identifier of the action to hold
   * @param reason Explanation for why the action was paused (e.g. policy review, warning modal)
   * @returns Updated immutable InterceptionRecord in HELD state
   * @throws ActionNotFoundError if actionId is not registered
   * @throws InvalidStateTransitionError if the action is not in DETECTED state
   */
  public holdAction(
    actionId: string,
    reason: string = 'Action held pending user confirmation or policy review.'
  ): InterceptionRecord {
    return this.transition(actionId, InterceptionState.HELD, reason);
  }

  /**
   * Transitions a tracked action from HELD to CONTINUED (or DETECTED to CONTINUED for ALLOW fast-path).
   * Automatically records the resolution timestamp (`resolvedAt`).
   *
   * @param actionId Unique identifier of the action to continue
   * @param reason Explanation for continuing the action (e.g. user confirmed, low-risk allow)
   * @returns Updated immutable InterceptionRecord in CONTINUED terminal state
   * @throws ActionNotFoundError if actionId is not registered
   * @throws InvalidStateTransitionError if the action is already resolved or in an invalid state
   */
  public continueAction(
    actionId: string,
    reason: string = 'Action approved and permitted to continue execution.'
  ): InterceptionRecord {
    return this.transition(actionId, InterceptionState.CONTINUED, reason);
  }

  /**
   * Transitions a tracked action from HELD to CANCELLED (or DETECTED to CANCELLED for static block).
   * Automatically records the resolution timestamp (`resolvedAt`).
   *
   * @param actionId Unique identifier of the action to cancel
   * @param reason Explanation for cancelling the action (e.g. user cancelled, policy block)
   * @returns Updated immutable InterceptionRecord in CANCELLED terminal state
   * @throws ActionNotFoundError if actionId is not registered
   * @throws InvalidStateTransitionError if the action is already resolved or in an invalid state
   */
  public cancelAction(
    actionId: string,
    reason: string = 'Action cancelled and aborted.'
  ): InterceptionRecord {
    return this.transition(actionId, InterceptionState.CANCELLED, reason);
  }

  /**
   * Generic transition method advancing a tracked action to a valid target state.
   *
   * @param actionId Unique identifier of the action
   * @param nextState Target InterceptionState
   * @param reason Explanation justifying the transition
   * @returns Updated immutable InterceptionRecord
   * @throws ActionNotFoundError if actionId is not registered
   * @throws InvalidStateTransitionError if the transition is prohibited by state machine rules
   */
  public transition(
    actionId: string,
    nextState: InterceptionState,
    reason: string
  ): InterceptionRecord {
    const existing = this.records.get(actionId);

    if (!existing) {
      throw new ActionNotFoundError(actionId);
    }

    const updatedRecord = transitionInterceptionRecord(existing, nextState, reason);
    this.records.set(actionId, updatedRecord);
    return updatedRecord;
  }

  /**
   * Explicitly removes a record from memory when cleanup is required.
   *
   * @param actionId Unique identifier of the record to remove
   * @returns True if a record was removed, false if not found
   */
  public removeRecord(actionId: string): boolean {
    return this.records.delete(actionId);
  }

  /**
   * Cleans up all resolved actions (CONTINUED or CANCELLED) from memory,
   * retaining currently active (DETECTED or HELD) records.
   *
   * @returns Number of resolved records cleared
   */
  public clearResolvedRecords(): number {
    let clearedCount = 0;

    for (const [actionId, record] of this.records.entries()) {
      if (isTerminalInterceptionState(record.state)) {
        this.records.delete(actionId);
        clearedCount++;
      }
    }

    return clearedCount;
  }

  /**
   * Returns a snapshot array of all tracked records.
   */
  public getAllRecords(): InterceptionRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Returns a snapshot array of records currently in the specified state.
   *
   * @param state The InterceptionState to filter by
   */
  public getRecordsByState(state: InterceptionState): InterceptionRecord[] {
    return Array.from(this.records.values()).filter((rec) => rec.state === state);
  }

  /**
   * Clears all in-memory records. Useful for test resets and clean session teardown.
   */
  public clearAll(): void {
    this.records.clear();
  }

  /**
   * Returns the count of records currently tracked in memory.
   */
  public size(): number {
    return this.records.size;
  }
}

/**
 * Default singleton instance of the InterceptionController for shared extension runtime usage.
 */
export const defaultInterceptionController = new InterceptionController();
