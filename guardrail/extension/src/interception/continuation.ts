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
import { AuthContext } from '../approval/authorization.js';
import type { ApprovalService } from '../approval/service.js';
import type { ApprovalApiClient } from '../approval/client.js';
import {
  ContinuationValidationService,
  ContinuationEligibilityStatus,
  defaultContinuationValidationService,
  CONTINUATION_VALIDATION_LIMITATIONS,
  type ContinuationValidationResult,
  type ContinuationValidationOptions,
  type ContinuationValidationServiceOptions,
} from './validation-service.js';

export {
  ContinuationValidationService,
  ContinuationEligibilityStatus,
  defaultContinuationValidationService,
  CONTINUATION_VALIDATION_LIMITATIONS,
};
export type {
  ContinuationValidationResult,
  ContinuationValidationOptions,
  ContinuationValidationServiceOptions,
};

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
  | 'BACKEND_STATE_UNKNOWN'
  | 'PAGE_CONTEXT_MISMATCH'
  | 'ELEMENT_DETACHED'
  | 'ALREADY_CONTINUED'
  | 'AUTHORIZATION_UNAVAILABLE';

export interface ContinuationPageContext {
  readonly url?: string;
  readonly origin?: string;
}

export interface ContinuationAuthorizationInput {
  /** Target action ID to be authorized */
  readonly actionId: string;
  /** Authoritative ApprovalRequest from backend, if available */
  readonly request?: ApprovalRequest | null;
  /** Authoritative ApprovalActionBinding from backend, if available */
  readonly binding?: ApprovalActionBinding | null;
  /** Original intercepted GuardrailAction (for local context & element checking) */
  readonly originalAction?: GuardrailAction | null;
  /** Current active page context (URL, origin) to verify against original action */
  readonly currentPageContext?: ContinuationPageContext | null;
  /** Custom element presence checker (or checks DOM if window/document available) */
  readonly isElementAttached?: (elementId?: string) => boolean;
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

  // 1. Verify original action and page context if provided
  if (input.originalAction && input.currentPageContext) {
    const origUrl = input.originalAction.page?.url;
    const currentOrigin = input.currentPageContext.origin;
    const currentUrl = input.currentPageContext.url;

    if (origUrl && currentOrigin) {
      try {
        const origOrigin = new URL(origUrl).origin;
        if (origOrigin !== currentOrigin) {
          return {
            authorized: false,
            actionId,
            error: `Page context mismatch: Interaction origin "${currentOrigin}" does not match original intercepted origin "${origOrigin}".`,
            errorCode: 'PAGE_CONTEXT_MISMATCH',
          };
        }
      } catch {
        return {
          authorized: false,
          actionId,
          error: `Page context mismatch: Invalid original URL "${origUrl}".`,
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
            authorized: false,
            actionId,
            error: `Page context mismatch: Target path "${currParsed.pathname}" does not match intercepted path "${origParsed.pathname}".`,
            errorCode: 'PAGE_CONTEXT_MISMATCH',
          };
        }
      } catch {
        return {
          authorized: false,
          actionId,
          error: `Page context mismatch: Failed to compare page URLs.`,
          errorCode: 'PAGE_CONTEXT_MISMATCH',
        };
      }
    }
  }

  // 2. Verify DOM element attachment if element is targeted
  if (input.originalAction?.element?.id) {
    const elemId = input.originalAction.element.id;
    if (input.isElementAttached) {
      if (!input.isElementAttached(elemId)) {
        return {
          authorized: false,
          actionId,
          error: `Element context mismatch: Target element "#${elemId}" is no longer attached to the document.`,
          errorCode: 'ELEMENT_DETACHED',
        };
      }
    } else if (typeof document !== 'undefined') {
      const el = document.getElementById(elemId);
      if (!el) {
        return {
          authorized: false,
          actionId,
          error: `Element context mismatch: Target element "#${elemId}" was removed from the active DOM.`,
          errorCode: 'ELEMENT_DETACHED',
        };
      }
    }
  }

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

    this.isResolving.add(id);

    try {
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

      if (
        record.state !== InterceptionState.HELD &&
        record.state !== InterceptionState.READY_FOR_USER_CONFIRMATION
      ) {
        return {
          success: false,
          actionId: id,
          record,
          executed: false,
          executionCount: this.getExecutionCount(id),
          error: `Cannot continue action "${id}": Current state is "${record.state}". Only actions in HELD state (or READY_FOR_USER_CONFIRMATION) can be continued.`,
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

      // 3. Verified Controlled Test Action Check
      // Continuation is strictly restricted to verified test actions with registered callbacks.
      const heldEntry =
        this.currentHeldAction && this.currentHeldAction.action.id === id
          ? this.currentHeldAction
          : null;

      if (!heldEntry || typeof heldEntry.handler !== 'function') {
        return {
          success: false,
          actionId: id,
          record,
          executed: false,
          executionCount: priorExecutions,
          error: `Cannot continue action "${id}": No verified controlled continuation handler is registered. Resumption is strictly restricted to verified test actions; arbitrary website continuation is not supported.`,
        };
      }

      // 4. Transition interception record from HELD -> CONTINUED
      const continuedRecord = this.controller.continueAction(id, reason);

      // 5. Execute the controlled test handler exactly once
      this.executionCounts.set(id, 1);
      heldEntry.handler(heldEntry.action);
      const executed = true;

      // 6. Clear temporary held action state if it matches this action
      this.currentHeldAction = null;

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

    if (
      record.state !== InterceptionState.HELD &&
      record.state !== InterceptionState.AWAITING_APPROVAL &&
      record.state !== InterceptionState.READY_FOR_USER_CONFIRMATION
    ) {
      return {
        success: false,
        actionId: id,
        record,
        error: `Cannot cancel action "${id}": Current state is "${record.state}". Only actions in HELD state (or non-terminal states) can be cancelled.`,
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

export interface ContinuationBoundaryOptions {
  readonly continuationManager?: ContinuationManager;
  readonly controller?: InterceptionController;
  readonly approvalClient?: ApprovalApiClient;
  readonly approvalService?: ApprovalService;
  readonly timeProvider?: TimeProvider;
  readonly getCurrentPageContext?: () => ContinuationPageContext;
  readonly isElementAttached?: (elementId?: string) => boolean;
}

export interface ContinuationBoundaryValidationOptions {
  readonly authContext?: AuthContext;
  readonly expectedRequesterId?: string;
  readonly pageContext?: ContinuationPageContext;
  readonly isElementAttached?: (elementId?: string) => boolean;
}

/**
 * Focused Authorization-Validation Boundary for Protected Action Continuation.
 *
 * Enforces all 8 core conditions before any action continuation is permitted:
 * 1. The approval request exists and belongs to the expected user/workflow.
 * 2. The approval request is bound 1:1 to the exact protected action.
 * 3. The backend has confirmed the approval decision.
 * 4. The approval has not expired, been cancelled, or become invalid.
 * 5. The binding has not been reassigned or invalidated.
 * 6. The local interception record corresponds to the same action in HELD state.
 * 7. The relevant page or action context has not changed (origin, URL path, element attached).
 * 8. State transitions are permitted and duplicate continuation attempts are rejected.
 *
 * SAFETY INVARIANTS:
 * - Does NOT execute action automatically when status is APPROVED.
 * - Does NOT store or inspect sensitive form values (passwords, OTPs, card numbers).
 * - Fails closed on missing or unconfirmed backend authorization.
 * - Fails closed if page navigation, reload, or DOM detachment occurred.
 */
export class ContinuationAuthorizationBoundary {
  private readonly continuationManager: ContinuationManager;
  private readonly controller: InterceptionController;
  private readonly approvalClient?: ApprovalApiClient;
  private readonly approvalService?: ApprovalService;
  private readonly timeProvider: TimeProvider;
  private readonly getCurrentPageContext?: () => ContinuationPageContext;
  private readonly isElementAttached?: (elementId?: string) => boolean;
  private readonly validationService: ContinuationValidationService;
  private readonly activeContinuations: Set<string> = new Set();

  constructor(options?: ContinuationBoundaryOptions) {
    this.continuationManager = options?.continuationManager ?? defaultContinuationManager;
    this.controller = options?.controller ?? defaultInterceptionController;
    this.approvalClient = options?.approvalClient;
    this.approvalService = options?.approvalService;
    this.timeProvider = options?.timeProvider ?? defaultTimeProvider;
    this.getCurrentPageContext = options?.getCurrentPageContext;
    this.isElementAttached = options?.isElementAttached;
    this.validationService = new ContinuationValidationService({
      controller: this.controller,
      continuationManager: this.continuationManager,
      approvalClient: this.approvalClient,
      approvalService: this.approvalService,
      timeProvider: this.timeProvider,
      getCurrentPageContext: this.getCurrentPageContext,
      isElementAttached: this.isElementAttached,
    });
  }

  public getContinuationManager(): ContinuationManager {
    return this.continuationManager;
  }

  public getController(): InterceptionController {
    return this.controller;
  }

  public getValidationService(): ContinuationValidationService {
    return this.validationService;
  }

  /**
   * Validates all conditions before any action continuation can be authorized.
   * Delegates directly to the dedicated ContinuationValidationService.
   */
  public async validateContinuation(
    actionId: string,
    options?: ContinuationBoundaryValidationOptions
  ): Promise<ContinuationAuthorizationResult> {
    const res = await this.validationService.validateEligibility(actionId, {
      authContext: options?.authContext,
      expectedRequesterId: options?.expectedRequesterId,
      pageContext: options?.pageContext,
      isElementAttached: options?.isElementAttached,
    });

    return {
      authorized: res.eligible,
      actionId: res.actionId,
      error: res.eligible ? undefined : res.reason,
      errorCode: res.errorCode as ContinuationAuthorizationErrorCode,
    };
  }

  /**
   * Authorizes and continues a held action.
   *
   * IMPORTANT SAFETY INVARIANT:
   * This method is only invoked upon explicit continuation instruction.
   * Under no circumstances is it invoked automatically when status is APPROVED.
   */
  public async authorizeAndContinue(
    actionId: string,
    reason: string = 'Action continued via authorized boundary.',
    options?: ContinuationBoundaryValidationOptions
  ): Promise<ContinuationResult> {
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

    // In-flight concurrency guard: Prevent concurrent or racing continuation attempts
    if (this.activeContinuations.has(id)) {
      return {
        success: false,
        actionId: id,
        executed: false,
        executionCount: this.continuationManager.getExecutionCount(id),
        error: `Cannot continue action "${id}": A continuation operation is already actively in progress for this action. Duplicate continuation rejected.`,
      };
    }

    if (this.continuationManager.getExecutionCount(id) > 0) {
      return {
        success: false,
        actionId: id,
        executed: false,
        executionCount: this.continuationManager.getExecutionCount(id),
        error: `Cannot continue action "${id}": Action has already executed. Duplicate execution prohibited.`,
      };
    }

    this.activeContinuations.add(id);

    try {
      const authResult = await this.validateContinuation(id, options);
      if (!authResult.authorized) {
        return {
          success: false,
          actionId: id,
          executed: false,
          executionCount: this.continuationManager.getExecutionCount(id),
          error: authResult.error,
        };
      }

      return this.continuationManager.continueAction(id, reason, {
        actionId: id,
        allowUnboundAction: true,
      });
    } finally {
      this.activeContinuations.delete(id);
    }
  }
}

export const defaultContinuationAuthorizationBoundary = new ContinuationAuthorizationBoundary();
