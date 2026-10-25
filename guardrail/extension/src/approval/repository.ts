/**
 * Guardrail Approval Request Repository Abstraction & Development Storage
 *
 * Defines the storage contract and development-only in-memory repository for
 * persisting and atomically updating ApprovalRequests.
 *
 * CRITICAL ARCHITECTURAL NOTICE (DEVELOPMENT-ONLY PERSISTENCE):
 * =============================================================
 * In the current development phase (Days 8-10), no persistent database layer exists
 * in `guardrail/server`. The `DevelopmentInMemoryApprovalRequestRepository` class is an
 * EPHEMERAL DEVELOPMENT-ONLY abstraction strictly intended for local runtime testing,
 * developer validation, and unit test suites.
 *
 * IT DOES NOT PROVIDE:
 * 1. Persistent storage across browser or server restarts.
 * 2. Cross-process clustering or multi-instance synchronization.
 * 3. ACID disaster-recovery guarantees against process termination.
 *
 * PRODUCTION ROADMAP (Day 10+):
 * When persistent storage is introduced in `guardrail/server`, this interface will be
 * implemented by a PostgreSQL/SQLite database adapter executing atomic conditional
 * updates with transactional rollback as specified in:
 * `guardrail/docs/approval-workflow-contract.md` (Section 8.1).
 */

import {
  ApprovalActionBinding,
  ApprovalActionBindingState,
  ApprovalRequest,
  ApprovalStatus,
} from '../types/approval.js';
import {
  ApprovalBindingConflictError,
  ApprovalBindingReassignmentError,
  assertValidApprovalActionBinding,
} from './binding.js';

/**
 * Persistence classification identifying storage maturity.
 */
export const PERSISTENCE_METADATA = Object.freeze({
  TYPE: 'EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY',
  IS_PRODUCTION: false,
  TARGET_DATABASE: 'PostgreSQL / SQLite (Day 10+ Roadmap)',
  SPECIFICATION_DOCUMENT: 'guardrail/docs/approval-workflow-contract.md',
  CONCURRENCY_MODEL: 'Single-thread synchronous Compare-And-Swap (CAS) in-memory state machine',
  LIMITATIONS: Object.freeze([
    'In-memory persistence does not survive process, browser, or server restarts.',
    'Multi-process clustering (multiple Node.js instances or web workers) requires database-level row locking.',
    'ACID crash-recovery requires WAL / journaling in PostgreSQL or SQLite.',
    'Client-side optimistic locking does not replace backend atomic transactions.',
  ]),
});

/**
 * Repository interface for ApprovalRequest storage and concurrency control.
 *
 * All operations must respect atomicity and compound uniqueness constraints.
 */
export interface ApprovalRequestRepository {
  /**
   * Retrieves an ApprovalRequest by its canonical requestId.
   *
   * @param id Canonical approval request identifier ('apr_...')
   * @returns The request, or undefined if not found
   */
  findById(id: string): ApprovalRequest | undefined;

  /**
   * Retrieves an active ApprovalRequest for a given requester and action.
   * Enables compound index (requesterId, actionId) lookups for idempotency.
   *
   * @param requesterId Authoritative user ID ('usr_...')
   * @param actionId Intercepted browser action identifier ('act_...')
   * @returns The request, or undefined if no record exists
   */
  findByUserAndAction(requesterId: string, actionId: string): ApprovalRequest | undefined;

  /**
   * Persists a new or modified ApprovalRequest.
   * Throws ApprovalBindingReassignmentError if attempting to change actionId for an existing request.
   *
   * @param request The immutable ApprovalRequest record to save
   */
  save(request: ApprovalRequest): void;

  /**
   * Atomically commits a new ApprovalRequest and its 1:1 ApprovalActionBinding in a single transaction.
   * If any uniqueness, anti-reassignment, or conflict check fails, neither entity is persisted (all-or-nothing rollback).
   *
   * @throws ApprovalBindingReassignmentError if requestId or actionId is already bound to a conflicting entity
   * @throws ApprovalBindingConflictError if actionId is already bound to an active or conflicting request
   */
  saveRequestWithBinding(request: ApprovalRequest, binding: ApprovalActionBinding): void;

  /**
   * Performs an atomic conditional update on an ApprovalRequest.
   *
   * Verifies that the record currently exists and matches `expectedCurrentStatus`
   * before applying the updated record. If the record does not exist or its current
   * status differs from `expectedCurrentStatus`, the operation is aborted and returns false.
   *
   * This atomic compare-and-swap mechanism guarantees that concurrent decisions
   * cannot both succeed (first-responder concurrency protection).
   *
   * @param requestId Canonical approval request identifier
   * @param expectedCurrentStatus Status required prior to transition (e.g., PENDING)
   * @param updatedRequest Updated ApprovalRequest record to commit
   * @returns True if the transition was committed; false if rejected due to status conflict
   */
  atomicTransition(
    requestId: string,
    expectedCurrentStatus: ApprovalStatus,
    updatedRequest: ApprovalRequest
  ): boolean;

  /**
   * Atomically commits a synchronized lifecycle resolution on both an ApprovalRequest and its associated binding.
   * Ensures that request is currently in `expectedRequestStatus` AND binding is in `expectedBindingState` before committing.
   * If either condition is not met, the transaction aborts and returns false without modifying either record.
   *
   * @returns True if both entities were atomically updated; false if aborted due to conflict
   */
  atomicTransitionRequestAndBinding(
    requestId: string,
    expectedRequestStatus: ApprovalStatus,
    updatedRequest: ApprovalRequest,
    bindingId: string,
    expectedBindingState: ApprovalActionBindingState,
    updatedBinding: ApprovalActionBinding
  ): boolean;

  /**
   * Lists all requests initiated by a specific requester, optionally filtered by status.
   *
   * @param requesterId Authoritative user ID
   * @param status Optional filter by ApprovalStatus
   */
  findByRequesterId(requesterId: string, status?: ApprovalStatus): readonly ApprovalRequest[];

  /**
   * Lists all PENDING requests for a set of designated ward user IDs.
   *
   * @param requesterIds Array of ward user IDs
   */
  findPendingByRequesterIds(requesterIds: readonly string[]): readonly ApprovalRequest[];

  /**
   * Retrieves all approval requests in the repository.
   */
  findAll(): readonly ApprovalRequest[];

  /**
   * Returns total count of requests currently held in the repository.
   */
  count(): number;

  /**
   * Persists an ApprovalActionBinding, enforcing 1:1 uniqueness and anti-reassignment invariants.
   */
  saveBinding(binding: ApprovalActionBinding): void;

  /**
   * Retrieves an ApprovalActionBinding by its canonical binding ID ('bnd_...').
   */
  findBindingById(id: string): ApprovalActionBinding | undefined;

  /**
   * Retrieves the ApprovalActionBinding associated with a specific approval request ID ('apr_...').
   */
  findBindingByRequestId(requestId: string): ApprovalActionBinding | undefined;

  /**
   * Retrieves the active or latest ApprovalActionBinding for an intercepted action ID ('act_...').
   */
  findBindingByActionId(actionId: string): ApprovalActionBinding | undefined;

  /**
   * Performs an atomic conditional update on an ApprovalActionBinding.
   * Ensures the binding is currently in `expectedCurrentState` before committing updates.
   */
  atomicTransitionBinding(
    bindingId: string,
    expectedCurrentState: ApprovalActionBindingState,
    updatedBinding: ApprovalActionBinding
  ): boolean;

  /**
   * Retrieves all approval action bindings in the repository.
   */
  findAllBindings(): readonly ApprovalActionBinding[];

  /**
   * Returns total count of bindings currently held in the repository.
   */
  countBindings(): number;

  /**
   * Clears all stored records (for test isolation).
   */
  clear(): void;
}

/**
 * Ephemeral In-Memory Approval Request Repository.
 *
 * DEVELOPMENT-ONLY: Implements atomic conditional updates using synchronous
 * memory locks to simulate transactional database concurrency in headless tests.
 */
export class DevelopmentInMemoryApprovalRequestRepository implements ApprovalRequestRepository {
  public static readonly IS_PRODUCTION_PERSISTENCE = false;

  private readonly requests: Map<string, ApprovalRequest> = new Map();
  // Compound index for idempotency: `${requesterId}:${actionId}` -> requestId
  private readonly userActionIndex: Map<string, string> = new Map();
  // Requester index: requesterId -> Set<requestId>
  private readonly requesterIndex: Map<string, Set<string>> = new Map();
  // Optimistic version counter: requestId -> number
  private readonly versionMap: Map<string, number> = new Map();

  // Action-Approval Binding storage
  private readonly bindings: Map<string, ApprovalActionBinding> = new Map();
  // requestId -> bindingId (1:1 relationship)
  private readonly bindingByRequestId: Map<string, string> = new Map();
  // actionId -> bindingId (1:1 relationship for active actions)
  private readonly bindingByActionId: Map<string, string> = new Map();

  /**
   * Retrieves an ApprovalRequest by ID.
   */
  public findById(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  /**
   * Retrieves an ApprovalRequest by compound (requesterId, actionId) key.
   */
  public findByUserAndAction(requesterId: string, actionId: string): ApprovalRequest | undefined {
    const key = this.buildUserActionKey(requesterId, actionId);
    const requestId = this.userActionIndex.get(key);
    if (!requestId) {
      return undefined;
    }
    return this.requests.get(requestId);
  }

  /**
   * Persists an ApprovalRequest.
   * Strictly enforces that an existing request ID cannot be reassigned to a different actionId.
   */
  public save(request: ApprovalRequest): void {
    // Anti-reassignment check 1: existing request
    const existing = this.requests.get(request.id);
    if (existing && existing.actionId !== request.actionId) {
      throw new ApprovalBindingReassignmentError(request.id, existing.actionId, request.actionId);
    }

    // Anti-reassignment check 2: existing binding for this request
    const existingBindingId = this.bindingByRequestId.get(request.id);
    if (existingBindingId) {
      const binding = this.bindings.get(existingBindingId);
      if (binding && binding.actionId !== request.actionId) {
        throw new ApprovalBindingReassignmentError(request.id, binding.actionId, request.actionId);
      }
    }

    const frozen = Object.freeze({ ...request });
    this.requests.set(frozen.id, frozen);

    // Update compound index
    const key = this.buildUserActionKey(frozen.requesterId, frozen.actionId);
    this.userActionIndex.set(key, frozen.id);

    // Update requester index
    let userRequests = this.requesterIndex.get(frozen.requesterId);
    if (!userRequests) {
      userRequests = new Set();
      this.requesterIndex.set(frozen.requesterId, userRequests);
    }
    userRequests.add(frozen.id);

    // Update version if not set
    if (!this.versionMap.has(frozen.id)) {
      this.versionMap.set(frozen.id, 1);
    }
  }

  /**
   * Performs an atomic conditional update on an ApprovalRequest.
   * Simulates SQL `UPDATE ... WHERE id = :id AND status = :expectedStatus`.
   */
  public atomicTransition(
    requestId: string,
    expectedCurrentStatus: ApprovalStatus,
    updatedRequest: ApprovalRequest
  ): boolean {
    const existing = this.requests.get(requestId);
    if (!existing) {
      return false;
    }

    // Conditional check: must match expectedCurrentStatus
    if (existing.status !== expectedCurrentStatus) {
      return false;
    }

    // Anti-reassignment check on transition
    if (existing.actionId !== updatedRequest.actionId) {
      throw new ApprovalBindingReassignmentError(
        requestId,
        existing.actionId,
        updatedRequest.actionId
      );
    }

    // Commit atomic update and bump version
    const nextVersion = (this.versionMap.get(requestId) ?? 1) + 1;
    this.versionMap.set(requestId, nextVersion);

    const frozen = Object.freeze({ ...updatedRequest });
    this.requests.set(requestId, frozen);

    // Keep indexes in sync
    const key = this.buildUserActionKey(frozen.requesterId, frozen.actionId);
    this.userActionIndex.set(key, frozen.id);

    return true;
  }

  /**
   * Lists requests for a specific requester.
   */
  public findByRequesterId(
    requesterId: string,
    status?: ApprovalStatus
  ): readonly ApprovalRequest[] {
    const requestIds = this.requesterIndex.get(requesterId);
    if (!requestIds) {
      return Object.freeze([]);
    }

    const results: ApprovalRequest[] = [];
    for (const id of requestIds) {
      const r = this.requests.get(id);
      if (r) {
        if (!status || r.status === status) {
          results.push(r);
        }
      }
    }
    return Object.freeze(results);
  }

  /**
   * Lists pending requests for a set of ward user IDs.
   */
  public findPendingByRequesterIds(requesterIds: readonly string[]): readonly ApprovalRequest[] {
    const idSet = new Set(requesterIds);
    const results: ApprovalRequest[] = [];

    for (const req of this.requests.values()) {
      if (req.status === ApprovalStatus.PENDING && idSet.has(req.requesterId)) {
        results.push(req);
      }
    }
    return Object.freeze(results);
  }

  /**
   * Retrieves all requests.
   */
  public findAll(): readonly ApprovalRequest[] {
    return Object.freeze(Array.from(this.requests.values()));
  }

  /**
   * Returns current count of stored requests.
   */
  public count(): number {
    return this.requests.size;
  }

  // ===========================================================================
  // Binding Storage & Concurrency
  // ===========================================================================

  /**
   * Persists an ApprovalActionBinding, enforcing 1:1 relationship invariants and preventing reassignment.
   */
  public saveBinding(binding: ApprovalActionBinding): void {
    assertValidApprovalActionBinding(binding);

    // Reassignment check 1: Request already bound to a different action
    const existingBindingIdForReq = this.bindingByRequestId.get(binding.requestId);
    if (existingBindingIdForReq) {
      const existingBinding = this.bindings.get(existingBindingIdForReq);
      if (existingBinding && existingBinding.actionId !== binding.actionId) {
        throw new ApprovalBindingReassignmentError(
          binding.requestId,
          existingBinding.actionId,
          binding.actionId
        );
      }
    }

    // Reassignment check 2: Stored request entity with same ID has a different actionId
    const storedRequest = this.requests.get(binding.requestId);
    if (storedRequest && storedRequest.actionId !== binding.actionId) {
      throw new ApprovalBindingReassignmentError(
        binding.requestId,
        storedRequest.actionId,
        binding.actionId
      );
    }

    // Conflict check 3: Action already bound to an active request with a different requestId
    const existingBindingIdForAction = this.bindingByActionId.get(binding.actionId);
    if (existingBindingIdForAction && existingBindingIdForAction !== binding.id) {
      const existingBinding = this.bindings.get(existingBindingIdForAction);
      if (
        existingBinding &&
        existingBinding.requestId !== binding.requestId &&
        existingBinding.state === ApprovalActionBindingState.BOUND
      ) {
        throw new ApprovalBindingConflictError(
          binding.actionId,
          existingBinding.requestId,
          binding.requestId
        );
      }
    }

    const frozen = Object.freeze({ ...binding });
    this.bindings.set(frozen.id, frozen);
    this.bindingByRequestId.set(frozen.requestId, frozen.id);
    this.bindingByActionId.set(frozen.actionId, frozen.id);
  }

  /**
   * Atomically commits a new ApprovalRequest and its 1:1 ApprovalActionBinding in a single transaction.
   * If any uniqueness, anti-reassignment, or conflict check fails, neither entity is persisted (all-or-nothing rollback).
   */
  public saveRequestWithBinding(request: ApprovalRequest, binding: ApprovalActionBinding): void {
    assertValidApprovalActionBinding(binding);

    if (request.id !== binding.requestId) {
      throw new ApprovalBindingReassignmentError(
        request.id,
        binding.actionId,
        request.actionId
      );
    }
    if (request.actionId !== binding.actionId) {
      throw new ApprovalBindingReassignmentError(
        request.id,
        binding.actionId,
        request.actionId
      );
    }

    // 1. Check existing request for requestId
    const existingReq = this.requests.get(request.id);
    if (existingReq && existingReq.actionId !== request.actionId) {
      throw new ApprovalBindingReassignmentError(
        request.id,
        existingReq.actionId,
        request.actionId
      );
    }

    // 2. Check existing binding for requestId
    const existingBindingIdForReq = this.bindingByRequestId.get(binding.requestId);
    if (existingBindingIdForReq) {
      const existingBnd = this.bindings.get(existingBindingIdForReq);
      if (existingBnd && existingBnd.actionId !== binding.actionId) {
        throw new ApprovalBindingReassignmentError(
          binding.requestId,
          existingBnd.actionId,
          binding.actionId
        );
      }
    }

    // 3. Check existing binding for actionId (Conflict check on actively BOUND binding)
    const existingBindingIdForAction = this.bindingByActionId.get(binding.actionId);
    if (existingBindingIdForAction && existingBindingIdForAction !== binding.id) {
      const existingBnd = this.bindings.get(existingBindingIdForAction);
      if (
        existingBnd &&
        existingBnd.requestId !== binding.requestId &&
        existingBnd.state === ApprovalActionBindingState.BOUND
      ) {
        throw new ApprovalBindingConflictError(
          binding.actionId,
          existingBnd.requestId,
          binding.requestId
        );
      }
    }

    // 4. Check existing user-action index (Compound idempotency check)
    const userActionKey = this.buildUserActionKey(request.requesterId, request.actionId);
    const existingUserReqId = this.userActionIndex.get(userActionKey);
    if (existingUserReqId && existingUserReqId !== request.id) {
      const existingUserReq = this.requests.get(existingUserReqId);
      if (
        existingUserReq &&
        existingUserReq.status === ApprovalStatus.PENDING
      ) {
        throw new ApprovalBindingConflictError(
          request.actionId,
          existingUserReqId,
          request.id
        );
      }
    }

    // Atomically commit both
    this.save(request);
    this.saveBinding(binding);
  }

  /**
   * Retrieves an ApprovalActionBinding by binding ID ('bnd_...').
   */
  public findBindingById(id: string): ApprovalActionBinding | undefined {
    return this.bindings.get(id);
  }

  /**
   * Retrieves an ApprovalActionBinding by approval request ID ('apr_...').
   */
  public findBindingByRequestId(requestId: string): ApprovalActionBinding | undefined {
    const bindingId = this.bindingByRequestId.get(requestId);
    return bindingId ? this.bindings.get(bindingId) : undefined;
  }

  /**
   * Retrieves an ApprovalActionBinding by intercepted action ID ('act_...').
   */
  public findBindingByActionId(actionId: string): ApprovalActionBinding | undefined {
    const bindingId = this.bindingByActionId.get(actionId);
    return bindingId ? this.bindings.get(bindingId) : undefined;
  }

  /**
   * Atomically commits a synchronized lifecycle resolution on both an ApprovalRequest and its associated binding.
   * Ensures that request is currently in `expectedRequestStatus` AND binding is in `expectedBindingState` before committing.
   * If either condition is not met, the transaction aborts and returns false without modifying either record.
   */
  public atomicTransitionRequestAndBinding(
    requestId: string,
    expectedRequestStatus: ApprovalStatus,
    updatedRequest: ApprovalRequest,
    bindingId: string,
    expectedBindingState: ApprovalActionBindingState,
    updatedBinding: ApprovalActionBinding
  ): boolean {
    const existingReq = this.requests.get(requestId);
    const existingBnd = this.bindings.get(bindingId);

    if (!existingReq || !existingBnd) {
      return false;
    }

    // Conditional atomic check on both entities
    if (existingReq.status !== expectedRequestStatus) {
      return false;
    }
    if (existingBnd.state !== expectedBindingState) {
      return false;
    }

    // Invariant check: binding must correspond to request
    if (
      existingBnd.requestId !== requestId ||
      existingReq.actionId !== updatedRequest.actionId ||
      existingBnd.actionId !== updatedBinding.actionId ||
      existingBnd.requestId !== updatedBinding.requestId
    ) {
      throw new ApprovalBindingReassignmentError(
        requestId,
        existingReq.actionId,
        updatedRequest.actionId
      );
    }

    // Atomic commitment of both entities
    const nextVersion = (this.versionMap.get(requestId) ?? 1) + 1;
    this.versionMap.set(requestId, nextVersion);

    const frozenReq = Object.freeze({ ...updatedRequest });
    this.requests.set(requestId, frozenReq);
    const key = this.buildUserActionKey(frozenReq.requesterId, frozenReq.actionId);
    this.userActionIndex.set(key, frozenReq.id);

    const frozenBnd = Object.freeze({ ...updatedBinding });
    this.bindings.set(bindingId, frozenBnd);
    this.bindingByRequestId.set(frozenBnd.requestId, frozenBnd.id);
    this.bindingByActionId.set(frozenBnd.actionId, frozenBnd.id);

    return true;
  }

  /**
   * Performs an atomic conditional update on an ApprovalActionBinding.
   */
  public atomicTransitionBinding(
    bindingId: string,
    expectedCurrentState: ApprovalActionBindingState,
    updatedBinding: ApprovalActionBinding
  ): boolean {
    const existing = this.bindings.get(bindingId);
    if (!existing) {
      return false;
    }

    if (existing.state !== expectedCurrentState) {
      return false;
    }

    // Anti-reassignment check on transition
    if (existing.actionId !== updatedBinding.actionId) {
      throw new ApprovalBindingReassignmentError(
        updatedBinding.requestId,
        existing.actionId,
        updatedBinding.actionId
      );
    }
    if (existing.requestId !== updatedBinding.requestId) {
      throw new ApprovalBindingReassignmentError(
        existing.requestId,
        existing.actionId,
        updatedBinding.actionId
      );
    }

    this.saveBinding(updatedBinding);
    return true;
  }

  /**
   * Retrieves all bindings.
   */
  public findAllBindings(): readonly ApprovalActionBinding[] {
    return Object.freeze(Array.from(this.bindings.values()));
  }

  /**
   * Returns current count of stored bindings.
   */
  public countBindings(): number {
    return this.bindings.size;
  }

  /**
   * Clears all storage.
   */
  public clear(): void {
    this.requests.clear();
    this.userActionIndex.clear();
    this.requesterIndex.clear();
    this.versionMap.clear();
    this.bindings.clear();
    this.bindingByRequestId.clear();
    this.bindingByActionId.clear();
  }

  private buildUserActionKey(requesterId: string, actionId: string): string {
    return `${requesterId.trim()}:${actionId.trim()}`;
  }
}
