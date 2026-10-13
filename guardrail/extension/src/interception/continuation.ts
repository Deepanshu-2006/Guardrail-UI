/**
 * Guardrail Controlled Action Continuation Engine
 *
 * Implements explicit continuation and cancellation workflows for intercepted
 * actions that have reached the HELD state on the controlled test website.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. CONTROLLED EXECUTION OVER ARBITRARY REPLAY:
 *    Executes registered controlled test handlers directly. Does NOT attempt to
 *    replay synthetic DOM clicks (`element.click()`), which is dangerous, unreliable,
 *    and susceptible to recursive interception loops.
 * 2. EXACTLY-ONCE EXECUTION GUARANTEE:
 *    Guarantees that a continued action's handler executes no more than once.
 * 3. STRICT STATE VALIDATION:
 *    Requires that the action be currently tracked in the HELD state. Rejects
 *    attempts to continue or cancel an already-resolved (CONTINUED or CANCELLED)
 *    or untracked action.
 * 4. RECURSION PREVENTION:
 *    Controlled continuation bypasses DOM capture-phase listeners, preventing
 *    the action from re-triggering its own interception.
 * 5. TEMPORARY STATE HYGIENE:
 *    Clears temporary held action references upon terminal resolution.
 * 6. ACTION ID PRESERVATION:
 *    Preserves the original `actionId` across all resolution records and events.
 */

import { GuardrailAction } from '../types/actions.js';
import { InterceptionRecord, InterceptionState } from '../types/interception.js';
import { defaultInterceptionController, InterceptionController } from './controller.js';

export type ControlledActionCallback = (action: GuardrailAction) => void;

export interface HeldActionEntry {
  readonly action: GuardrailAction;
  readonly record: InterceptionRecord;
  readonly handler: ControlledActionCallback;
  readonly heldAt: string;
}

export interface ContinuationResult {
  readonly success: boolean;
  readonly actionId: string;
  readonly record?: InterceptionRecord;
  readonly executed: boolean;
  readonly executionCount: number;
  readonly error?: string;
}

export interface CancellationResult {
  readonly success: boolean;
  readonly actionId: string;
  readonly record?: InterceptionRecord;
  readonly error?: string;
}

export class ContinuationManager {
  private readonly controller: InterceptionController;
  private currentHeldAction: HeldActionEntry | null = null;
  private readonly executionCounts: Map<string, number> = new Map();
  private readonly isResolving: Set<string> = new Set();

  constructor(controller: InterceptionController = defaultInterceptionController) {
    this.controller = controller;
  }

  /**
   * Registers a newly held action alongside its controlled continuation handler.
   */
  public registerHeldAction(
    action: GuardrailAction,
    record: InterceptionRecord,
    handler: ControlledActionCallback
  ): void {
    if (!action || !action.id) {
      throw new Error('[ContinuationManager] Cannot register held action without a valid actionId.');
    }
    if (record.state !== InterceptionState.HELD) {
      throw new Error(
        `[ContinuationManager] Cannot register action "${action.id}" in state "${record.state}". Expected HELD.`
      );
    }

    this.currentHeldAction = {
      action,
      record,
      handler,
      heldAt: new Date().toISOString(),
    };
  }

  /**
   * Returns the currently held action entry, if any.
   */
  public getCurrentHeldAction(): HeldActionEntry | null {
    return this.currentHeldAction;
  }

  /**
   * Returns the total execution count for an actionId.
   */
  public getExecutionCount(actionId: string): number {
    return this.executionCounts.get(actionId) || 0;
  }

  /**
   * Continues a held action:
   * 1. Validates that the action is currently in HELD state.
   * 2. Transition its interception record to CONTINUED.
   * 3. Executes the controlled handler exactly once.
   * 4. Prevents recursive interception and rejects duplicate executions.
   */
  public continueAction(
    actionId: string,
    reason: string = 'Action continued via explicit development control.'
  ): ContinuationResult {
    const id = actionId?.trim();
    if (!id) {
      return {
        success: false,
        actionId: '',
        executed: false,
        executionCount: 0,
        error: 'Cannot continue action without a valid actionId.',
      };
    }

    // Guard against concurrent resolution attempts for the same action
    if (this.isResolving.has(id)) {
      return {
        success: false,
        actionId: id,
        executed: false,
        executionCount: this.getExecutionCount(id),
        error: `Action "${id}" is currently undergoing resolution.`,
      };
    }

    // 1. Validate that the record exists and is in HELD state
    const record = this.controller.getRecord(id);
    if (!record) {
      return {
        success: false,
        actionId: id,
        executed: false,
        executionCount: this.getExecutionCount(id),
        error: `Action "${id}" was not found in InterceptionController.`,
      };
    }

    if (record.state !== InterceptionState.HELD) {
      return {
        success: false,
        actionId: id,
        record,
        executed: false,
        executionCount: this.getExecutionCount(id),
        error: `Cannot continue action "${id}": Current state is "${record.state}". Only actions in HELD state can be continued.`,
      };
    }

    // 2. Exactly-once execution check: Ensure it has not been executed yet
    const priorExecutions = this.getExecutionCount(id);
    if (priorExecutions > 0) {
      return {
        success: false,
        actionId: id,
        record,
        executed: false,
        executionCount: priorExecutions,
        error: `Action "${id}" has already executed ${priorExecutions} time(s). Duplicate execution prevented.`,
      };
    }

    this.isResolving.add(id);

    try {
      // 3. Transition interception record from HELD -> CONTINUED
      const continuedRecord = this.controller.continueAction(id, reason);

      // 4. Execute the controlled test handler
      let executed = false;
      const heldEntry = this.currentHeldAction && this.currentHeldAction.action.id === id
        ? this.currentHeldAction
        : null;

      if (heldEntry && heldEntry.handler) {
        this.executionCounts.set(id, 1);
        heldEntry.handler(heldEntry.action);
        executed = true;
      } else {
        this.executionCounts.set(id, 1);
        executed = true;
      }

      // 5. Clear temporary held action state if it matches this action
      if (this.currentHeldAction && this.currentHeldAction.action.id === id) {
        this.currentHeldAction = null;
      }

      return {
        success: true,
        actionId: id,
        record: continuedRecord,
        executed,
        executionCount: 1,
      };
    } catch (err: any) {
      return {
        success: false,
        actionId: id,
        record: this.controller.getRecord(id),
        executed: false,
        executionCount: this.getExecutionCount(id),
        error: err?.message || 'Error occurred during action continuation.',
      };
    } finally {
      this.isResolving.delete(id);
    }
  }

  /**
   * Cancels a held action:
   * 1. Validates that the action is currently in HELD state.
   * 2. Transitions the interception record to CANCELLED.
   * 3. Ensures the controlled handler does NOT execute.
   * 4. Clears temporary held action state.
   */
  public cancelAction(
    actionId: string,
    reason: string = 'Action cancelled via explicit development control.'
  ): CancellationResult {
    const id = actionId?.trim();
    if (!id) {
      return {
        success: false,
        actionId: '',
        error: 'Cannot cancel action without a valid actionId.',
      };
    }

    if (this.isResolving.has(id)) {
      return {
        success: false,
        actionId: id,
        error: `Action "${id}" is currently undergoing resolution.`,
      };
    }

    // 1. Validate that the record exists and is in HELD state
    const record = this.controller.getRecord(id);
    if (!record) {
      return {
        success: false,
        actionId: id,
        error: `Action "${id}" was not found in InterceptionController.`,
      };
    }

    if (record.state !== InterceptionState.HELD) {
      return {
        success: false,
        actionId: id,
        record,
        error: `Cannot cancel action "${id}": Current state is "${record.state}". Only actions in HELD state can be cancelled.`,
      };
    }

    this.isResolving.add(id);

    try {
      // 2. Transition interception record from HELD -> CANCELLED
      const cancelledRecord = this.controller.cancelAction(id, reason);

      // 3. Clear temporary state associated with the held action
      if (this.currentHeldAction && this.currentHeldAction.action.id === id) {
        this.currentHeldAction = null;
      }

      return {
        success: true,
        actionId: id,
        record: cancelledRecord,
      };
    } catch (err: any) {
      return {
        success: false,
        actionId: id,
        record: this.controller.getRecord(id),
        error: err?.message || 'Error occurred during action cancellation.',
      };
    } finally {
      this.isResolving.delete(id);
    }
  }

  /**
   * Clears temporary held state.
   */
  public clearTemporaryState(): void {
    this.currentHeldAction = null;
  }

  /**
   * Resets all internal state (for testing).
   */
  public reset(): void {
    this.currentHeldAction = null;
    this.executionCounts.clear();
    this.isResolving.clear();
  }
}

export const defaultContinuationManager = new ContinuationManager();
