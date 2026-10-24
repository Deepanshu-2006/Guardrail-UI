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

export type ContinuationAuthorizationErrorCode =
  | 'ACTION_ID_MISMATCH'
  | 'REQUEST_NOT_FOUND'
  | 'BINDING_NOT_FOUND'
  | 'REQUEST_NOT_APPROVED'
  | 'BINDING_NOT_APPROVED'
  | 'REQUEST_EXPIRED'
  | 'BINDING_EXPIRED'
  | 'BINDING_INVALIDATED'
  | 'BINDING_CANCELLED'
  | 'REQUEST_CANCELLED'
  | 'REQUEST_REJECTED'
  | 'BACKEND_STATE_UNKNOWN';

export interface ContinuationAuthorizationInput {
  /** Target action ID to be authorized */
  readonly actionId: string;
  /** Authoritative ApprovalRequest from backend, if available */
  readonly request?: ApprovalRequest | null;
  /** Authoritative ApprovalActionBinding from backend, if available */
  readonly binding?: ApprovalActionBinding | null;
  /** Reliable time provider for validating expiration deadlines */
  readonly timeProvider?: TimeProvider;
  /** If true, permits continuing actions that have no approval request/binding (e.g. standalone test mocks) */
  readonly allowUnboundAction?: boolean;
}

export interface ContinuationAuthorizationResult {
  readonly authorized: boolean;
  readonly actionId: string;
  readonly error?: string;
  readonly errorCode?: ContinuationAuthorizationErrorCode;
}

/**
 * Pure evaluation function validating whether continuation is authorized for a held action.
 * Enforces:
 * 1. Identifier matching (request.actionId === actionId, binding.actionId === actionId).
 * 2. Status verification (strictly APPROVED).
 * 3. Rejection of terminal non-approved states (REJECTED, EXPIRED, CANCELLED, INVALIDATED).
 * 4. Trusted clock expiration checks.
 * 5. Fail-closed on missing, unauthenticated, or unknown backend state.
 */
export function verifyContinuationAuthorization(
  input: ContinuationAuthorizationInput
): ContinuationAuthorizationResult {
  const actionId = input.actionId?.trim();
  if (!actionId) {
    return {
      authorized: false,
      actionId: '',
      error: 'Cannot authorize continuation without a valid actionId.',
      errorCode: 'ACTION_ID_MISMATCH',
    };
  }

  const timeProvider = input.timeProvider ?? defaultTimeProvider;
  const { request, binding, allowUnboundAction } = input;

  // If neither request nor binding is provided:
  if (!request && !binding) {
    if (allowUnboundAction) {
      return { authorized: true, actionId };
    }
    return {
      authorized: false,
      actionId,
      error: 'Continuation rejected: No backend approval request or action binding provided (state is unknown).',
      errorCode: 'BACKEND_STATE_UNKNOWN',
    };
  }

  // 1. Verify ApprovalRequest if provided
  if (request) {
    if (request.actionId !== actionId) {
      return {
        authorized: false,
        actionId,
        error: `Action ID mismatch: Approval request is bound to "${request.actionId}", cannot authorize action "${actionId}".`,
        errorCode: 'ACTION_ID_MISMATCH',
      };
    }

    if (isRequestExpired(request, timeProvider)) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Approval request "${request.id}" has expired.`,
        errorCode: 'REQUEST_EXPIRED',
      };
    }

    if (request.status === ApprovalStatus.REJECTED) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Approval request "${request.id}" was REJECTED by trusted contact.`,
        errorCode: 'REQUEST_REJECTED',
      };
    }

    if (request.status === ApprovalStatus.CANCELLED) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Approval request "${request.id}" was CANCELLED.`,
        errorCode: 'REQUEST_CANCELLED',
      };
    }

    if (request.status === ApprovalStatus.EXPIRED) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Approval request "${request.id}" has EXPIRED.`,
        errorCode: 'REQUEST_EXPIRED',
      };
    }

    if (request.status === ApprovalStatus.PENDING) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Approval request "${request.id}" is still PENDING.`,
        errorCode: 'REQUEST_NOT_APPROVED',
      };
    }

    if (request.status !== ApprovalStatus.APPROVED) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Unknown or invalid approval request status "${request.status}".`,
        errorCode: 'BACKEND_STATE_UNKNOWN',
      };
    }
  }

  // 2. Verify ApprovalActionBinding if provided
  if (binding) {
    if (binding.actionId !== actionId) {
      return {
        authorized: false,
        actionId,
        error: `Action ID mismatch: Action binding is bound to "${binding.actionId}", cannot authorize action "${actionId}".`,
        errorCode: 'ACTION_ID_MISMATCH',
      };
    }

    if (isBindingExpired(binding, timeProvider)) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Action binding "${binding.id}" has expired.`,
        errorCode: 'BINDING_EXPIRED',
      };
    }

    if (binding.state === ApprovalActionBindingState.INVALIDATED) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Action binding "${binding.id}" has been INVALIDATED.`,
        errorCode: 'BINDING_INVALIDATED',
      };
    }

    if (binding.state === ApprovalActionBindingState.CANCELLED) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Action binding "${binding.id}" was CANCELLED.`,
        errorCode: 'BINDING_CANCELLED',
      };
    }

    if (binding.state === ApprovalActionBindingState.EXPIRED) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Action binding "${binding.id}" has EXPIRED.`,
        errorCode: 'BINDING_EXPIRED',
      };
    }

    if (binding.state === ApprovalActionBindingState.REJECTED) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Action binding "${binding.id}" was REJECTED.`,
        errorCode: 'REQUEST_REJECTED',
      };
    }

    if (binding.state !== ApprovalActionBindingState.APPROVED) {
      return {
        authorized: false,
        actionId,
        error: `Continuation rejected: Action binding state is "${binding.state}" (expected APPROVED).`,
        errorCode: 'BINDING_NOT_APPROVED',
      };
    }
  }

  // 3. Consistency check between request and binding if both present
  if (request && binding) {
    if (request.id !== binding.requestId) {
      return {
        authorized: false,
        actionId,
        error: `Relationship mismatch: Request ID "${request.id}" does not match binding.requestId "${binding.requestId}".`,
        errorCode: 'ACTION_ID_MISMATCH',
      };
    }
  }

  return {
    authorized: true,
    actionId,
  };
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
   * 1. If authInput is provided, verifies continuation authorization (request/binding status, timestamps, ID match).
   * 2. Validates that the action is currently in HELD state.
   * 3. Transitions its interception record to CONTINUED.
   * 4. Executes the controlled handler exactly once.
   * 5. Prevents recursive interception and rejects duplicate executions.
   */
  public continueAction(
    actionId: string,
    reason: string = 'Action continued via explicit development control.',
    authInput?: ContinuationAuthorizationInput
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

    // Verify continuation authorization if provided
    if (authInput) {
      const authResult = verifyContinuationAuthorization(authInput);
      if (!authResult.authorized) {
        return {
          success: false,
          actionId: id,
          executed: false,
          executionCount: this.getExecutionCount(id),
          error: authResult.error,
        };
      }
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
   * Explicitly invalidates and detaches a held action.
   *
   * IDEMPOTENT: If the action is already CANCELLED, returns success without error.
   * Immediately clears local held action references and handler closures.
   */
  public invalidateHeldAction(
    actionId: string,
    reason: string = 'Held action invalidated and detached.'
  ): CancellationResult {
    const id = actionId?.trim();
    if (!id) {
      return {
        success: false,
        actionId: '',
        error: 'Cannot invalidate action without a valid actionId.',
      };
    }

    // Detach local held entry immediately regardless of controller state
    if (this.currentHeldAction && this.currentHeldAction.action.id === id) {
      this.currentHeldAction = null;
    }

    const record = this.controller.getRecord(id);
    if (!record) {
      return {
        success: true,
        actionId: id,
      };
    }

    // Idempotent: If already in CANCELLED state, return success
    if (record.state === InterceptionState.CANCELLED) {
      return {
        success: true,
        actionId: id,
        record,
      };
    }

    // Cannot invalidate an already continued action
    if (record.state === InterceptionState.CONTINUED) {
      return {
        success: false,
        actionId: id,
        record,
        error: `Cannot invalidate action "${id}": Current state is "${record.state}". Action was already continued.`,
      };
    }

    try {
      const cancelledRecord = this.controller.cancelAction(id, reason);
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
        error: err?.message || 'Error occurred during action invalidation.',
      };
    }
  }

  /**
   * Detaches the held action without running any handlers or altering controller records.
   * Useful when a tab unloads or navigates away.
   */
  public detachHeldAction(actionId?: string): void {
    if (!actionId || (this.currentHeldAction && this.currentHeldAction.action.id === actionId)) {
      this.currentHeldAction = null;
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
