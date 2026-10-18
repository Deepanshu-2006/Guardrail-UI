/**
 * Guardrail Approval Lifecycle Manager
 *
 * Implements authoritative in-memory lifecycle state management, transition enforcement,
 * time-source validation, and concurrency safeguards for ApprovalRequests.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. STRICT SEPARATION OF CONCERNS:
 *    - Independent of DOM elements, user interfaces, or browser rendering contexts.
 *    - Independent of live browser action continuation (ContinuationManager).
 *    - Changing approval status DOES NOT execute or release held browser actions.
 * 2. DETERMINISTIC STATE ENFORCEMENT:
 *    - Enforces permitted transitions: PENDING -> [APPROVED, REJECTED, EXPIRED, CANCELLED].
 *    - Terminal states (APPROVED, REJECTED, EXPIRED, CANCELLED) are strictly immutable.
 *    - Reopening resolved requests is prohibited; clients must create a new request.
 * 3. AUTHORITATIVE SERVER TIME SOURCE:
 *    - Validates expiration deadlines using an injectable reliable time provider.
 *    - Prevents late decisions on expired requests.
 * 4. CONCURRENCY & REPEATED DECISION GUARDS:
 *    - Enforces first-responder concurrency: once decided, conflicting/duplicate
 *      decisions are rejected with ApprovalAlreadyResolvedError.
 *    - Suppresses duplicate active submissions for the same intercepted action.
 */

import {
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
  SubmitApprovalDecisionInput,
} from '../types/approval.js';
import {
  ApprovalRequestNotFoundError,
  cancelApprovalRequest,
  createApprovalRequest,
  CreateApprovalRequestOptions,
  defaultTimeProvider,
  DuplicateApprovalRequestError,
  expireApprovalRequest,
  isRequestExpired,
  reopenApprovalRequest,
  resolveApprovalRequest,
  resolveTimestamp,
  TimeProvider,
} from './model.js';

/**
 * Configuration options for initializing an ApprovalLifecycleManager.
 */
export interface ApprovalLifecycleOptions {
  /**
   * Reliable time provider function returning an ISO string, epoch ms, or Date.
   * Enables injecting authoritative server clocks and deterministic test clocks.
   */
  readonly timeProvider?: TimeProvider;

  /**
   * If true, attempting to create a second request for an action that already has
   * an active PENDING request throws DuplicateApprovalRequestError.
   * If false (default), returns the existing active pending request (idempotent submission).
   */
  readonly rejectDuplicates?: boolean;
}

/**
 * In-memory lifecycle manager governing ApprovalRequest transitions.
 */
export class ApprovalLifecycleManager {
  private readonly requests: Map<string, ApprovalRequest> = new Map();
  private readonly actionIndex: Map<string, string> = new Map(); // actionId -> requestId
  private timeProvider: TimeProvider;
  private readonly defaultRejectDuplicates: boolean;

  constructor(options?: ApprovalLifecycleOptions) {
    this.timeProvider = options?.timeProvider ?? defaultTimeProvider;
    this.defaultRejectDuplicates = options?.rejectDuplicates ?? false;
  }

  /**
   * Updates the authoritative time provider. Useful for simulating time progression in tests.
   */
  public setTimeProvider(timeProvider: TimeProvider): void {
    this.timeProvider = timeProvider;
  }

  /**
   * Returns the current active time provider.
   */
  public getTimeProvider(): TimeProvider {
    return this.timeProvider;
  }

  /**
   * Gets the current normalized ISO 8601 UTC timestamp from the active time provider.
   */
  public getCurrentTimestamp(): string {
    return resolveTimestamp(this.timeProvider);
  }

  /**
   * Registers and initializes a new ApprovalRequest in the PENDING lifecycle state.
   *
   * IDEMPOTENCY & DUPLICATE SUPPRESSION:
   * - If an active, non-expired PENDING request already exists for this actionId:
   *   - If `rejectDuplicates` is enabled, throws DuplicateApprovalRequestError.
   *   - Otherwise, returns the existing active request (idempotent network retry handling).
   * - If an existing request for this actionId has reached a terminal state (or expired),
   *   creating a fresh request is permitted (safe re-submission).
   *
   * @param payload Client submission containing held action metadata
   * @param authenticatedRequesterId Authoritative user identity from server session
   * @param options Creation options (ID, TTL, rejectDuplicates flag)
   * @returns Newly created or existing idempotent ApprovalRequest in PENDING state
   */
  public createRequest(
    payload: ClientApprovalRequestPayload,
    authenticatedRequesterId: string,
    options?: CreateApprovalRequestOptions & { rejectDuplicates?: boolean }
  ): ApprovalRequest {
    const actionId = payload.actionId;
    const existingRequestId = this.actionIndex.get(actionId);

    if (existingRequestId) {
      const existing = this.getRequest(existingRequestId);
      if (existing && existing.status === ApprovalStatus.PENDING && !isRequestExpired(existing, this.timeProvider)) {
        const shouldReject = options?.rejectDuplicates ?? this.defaultRejectDuplicates;
        if (shouldReject) {
          throw new DuplicateApprovalRequestError(actionId, existing.id);
        }
        return existing;
      }
    }

    const createdAt = options?.createdAt ?? resolveTimestamp(this.timeProvider);
    const request = createApprovalRequest(payload, authenticatedRequesterId, {
      ...options,
      createdAt,
    });

    this.requests.set(request.id, request);
    this.actionIndex.set(actionId, request.id);
    return request;
  }

  /**
   * Retrieves an ApprovalRequest by its canonical requestId.
   * Lazily checks expiration: if the request is PENDING but its deadline has passed,
   * it is automatically transitioned to EXPIRED.
   *
   * @param id Canonical approval request identifier ('apr_...')
   * @returns The ApprovalRequest, or undefined if not found
   */
  public getRequest(id: string): ApprovalRequest | undefined {
    const request = this.requests.get(id);
    if (!request) {
      return undefined;
    }

    // Lazy expiration check using reliable time source
    if (request.status === ApprovalStatus.PENDING && isRequestExpired(request, this.timeProvider)) {
      const expired = expireApprovalRequest(request, this.timeProvider);
      this.requests.set(id, expired);
      return expired;
    }

    return request;
  }

  /**
   * Retrieves the most recent ApprovalRequest associated with an intercepted actionId.
   *
   * @param actionId Intercepted action identifier ('act_...')
   * @returns The ApprovalRequest, or undefined if not found
   */
  public getRequestByActionId(actionId: string): ApprovalRequest | undefined {
    const requestId = this.actionIndex.get(actionId);
    if (!requestId) {
      return undefined;
    }
    return this.getRequest(requestId);
  }

  /**
   * Checks whether an approval request exists in the store.
   *
   * @param id Canonical approval request identifier
   */
  public hasRequest(id: string): boolean {
    return this.requests.has(id);
  }

  /**
   * Submits an authoritative reviewer decision (APPROVED or REJECTED) on a PENDING request.
   *
   * LIFECYCLE GUARDS:
   * 1. Rejects non-existent requests (ApprovalRequestNotFoundError).
   * 2. Rejects already resolved requests (ApprovalAlreadyResolvedError) - prevents duplicate/conflicting decisions.
   * 3. Rejects expired requests (ApprovalExpiredError) - validates against reliable time source.
   * 4. Enforces separation of duties: requester cannot decide own request.
   * 5. STRICT NON-EXECUTION: Does NOT trigger or release any browser action handlers.
   *
   * @param requestId Canonical approval request identifier
   * @param decisionInput Reviewer verdict and metadata
   * @returns Updated immutable ApprovalRequest in APPROVED or REJECTED state
   */
  public submitDecision(
    requestId: string,
    decisionInput: SubmitApprovalDecisionInput
  ): ApprovalRequest {
    const existing = this.requests.get(requestId);
    if (!existing) {
      throw new ApprovalRequestNotFoundError(requestId);
    }

    const resolved = resolveApprovalRequest(existing, decisionInput, this.timeProvider);
    this.requests.set(requestId, resolved);
    return resolved;
  }

  /**
   * Cancels a PENDING approval request when the requesting user cancels the action in Staging Mode.
   *
   * LIFECYCLE GUARDS:
   * 1. Rejects non-existent requests (ApprovalRequestNotFoundError).
   * 2. Rejects already resolved requests (ApprovalAlreadyResolvedError).
   * 3. Rejects requests where authenticated user does not match requesterId.
   *
   * @param requestId Canonical approval request identifier
   * @param authenticatedUserId Authenticated identity of the cancelling user
   * @param reason Optional human-readable cancellation explanation
   * @returns Updated immutable ApprovalRequest in CANCELLED state
   */
  public cancelRequest(
    requestId: string,
    authenticatedUserId: string,
    reason?: string
  ): ApprovalRequest {
    const existing = this.getRequest(requestId);
    if (!existing) {
      throw new ApprovalRequestNotFoundError(requestId);
    }

    const cancelled = cancelApprovalRequest(
      existing,
      authenticatedUserId,
      reason,
      this.timeProvider
    );
    this.requests.set(requestId, cancelled);
    return cancelled;
  }

  /**
   * Explicitly expires a PENDING approval request.
   *
   * @param requestId Canonical approval request identifier
   * @returns Updated immutable ApprovalRequest in EXPIRED state
   */
  public expireRequest(requestId: string): ApprovalRequest {
    const existing = this.getRequest(requestId);
    if (!existing) {
      throw new ApprovalRequestNotFoundError(requestId);
    }

    const expired = expireApprovalRequest(existing, this.timeProvider);
    this.requests.set(requestId, expired);
    return expired;
  }

  /**
   * Explicitly attempts to reopen a resolved request.
   * Strictly prohibited by architecture: throws ApprovalReopenProhibitedError unconditionally.
   *
   * @param requestId Canonical approval request identifier
   * @throws ApprovalReopenProhibitedError
   */
  public reopenRequest(requestId: string): never {
    const existing = this.requests.get(requestId);
    if (!existing) {
      throw new ApprovalRequestNotFoundError(requestId);
    }
    reopenApprovalRequest(existing);
  }

  /**
   * Scans all tracked requests and automatically expires any PENDING requests whose
   * expiration deadline has passed according to the active time provider.
   *
   * @returns Count of requests newly transitioned to EXPIRED
   */
  public checkAndExpireStaleRequests(): number {
    let expiredCount = 0;
    for (const [id, req] of this.requests.entries()) {
      if (req.status === ApprovalStatus.PENDING && isRequestExpired(req, this.timeProvider)) {
        const expired = expireApprovalRequest(req, this.timeProvider);
        this.requests.set(id, expired);
        expiredCount++;
      }
    }
    return expiredCount;
  }

  /**
   * Returns a snapshot array of all tracked approval requests, with expirations evaluated.
   */
  public getAllRequests(): ApprovalRequest[] {
    return Array.from(this.requests.keys()).map((id) => this.getRequest(id)!);
  }

  /**
   * Returns a filtered snapshot array of approval requests matching a given ApprovalStatus.
   *
   * @param status Lifecycle status to filter by
   */
  public getRequestsByStatus(status: ApprovalStatus): ApprovalRequest[] {
    return this.getAllRequests().filter((r) => r.status === status);
  }

  /**
   * Returns the count of tracked approval requests.
   */
  public size(): number {
    return this.requests.size;
  }

  /**
   * Clears all in-memory records and indices. Useful for test isolation.
   */
  public clear(): void {
    this.requests.clear();
    this.actionIndex.clear();
  }
}

/**
 * Default singleton instance of ApprovalLifecycleManager for shared runtime usage.
 */
export const defaultApprovalLifecycleManager = new ApprovalLifecycleManager();
