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

import { ApprovalRequest, ApprovalStatus } from '../types/approval.js';

/**
 * Persistence classification identifying storage maturity.
 */
export const PERSISTENCE_METADATA = Object.freeze({
  TYPE: 'EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY',
  IS_PRODUCTION: false,
  TARGET_DATABASE: 'PostgreSQL / SQLite (Day 10+ Roadmap)',
  SPECIFICATION_DOCUMENT: 'guardrail/docs/approval-workflow-contract.md',
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
   *
   * @param request The immutable ApprovalRequest record to save
   */
  save(request: ApprovalRequest): void;

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
   */
  public save(request: ApprovalRequest): void {
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

  /**
   * Clears all storage.
   */
  public clear(): void {
    this.requests.clear();
    this.userActionIndex.clear();
    this.requesterIndex.clear();
    this.versionMap.clear();
  }

  private buildUserActionKey(requesterId: string, actionId: string): string {
    return `${requesterId.trim()}:${actionId.trim()}`;
  }
}
