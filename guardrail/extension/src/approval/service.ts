/**
 * Guardrail Approval Coordination Service
 *
 * Coordinates approval request creation, retrieval, reviewer decisions, and cancellations.
 * Enforces server-side authorization, deterministic lifecycle transitions, persistence,
 * concurrency control, and idempotency guarantees.
 *
 * ARCHITECTURAL RESPONSIBILITIES & BOUNDARIES:
 * 1. PERSISTENCE & STORAGE:
 *    - Delegates storage to the `ApprovalRequestRepository` abstraction.
 *    - In the current development stage, utilizes `DevelopmentInMemoryApprovalRequestRepository`.
 * 2. AUTHORIZATION & ZERO CLIENT TRUST:
 *    - Validates action ownership via `ActionOwnershipRegistry`.
 *    - Validates caretaker relationship via `TrustedContactRegistry`.
 *    - Re-derives acting identity exclusively from verified server `AuthContext`.
 *    - Strictly prevents self-approval (separation of duties).
 *    - Returns opaque 404 access denied errors to prevent request ID enumeration.
 * 3. LIFECYCLE & CONCURRENCY:
 *    - Validates deterministic state transitions (PENDING -> APPROVED/REJECTED/CANCELLED/EXPIRED).
 *    - Guarantees first-responder concurrency via atomic conditional repository updates.
 *    - Concurrent decisions cannot both succeed.
 * 4. IDEMPOTENCY & DUPLICATE SUPPRESSION:
 *    - Indexing by compound (userId, actionId) key. Active duplicate submissions return the
 *      existing pending request (safe network retry) or throw DuplicateApprovalRequestError.
 * 5. SAFE OPERATION:
 *    - Never executes or releases intercepted browser actions (ContinuationManager).
 *    - Logs only sanitized, non-sensitive audit metadata; never raw forms or secrets.
 */

import {
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import {
  ApprovalAlreadyResolvedError,
  ApprovalExpiredError,
  ApprovalValidationError,
  cancelApprovalRequest,
  createApprovalRequest,
  CreateApprovalRequestOptions,
  defaultTimeProvider,
  DuplicateApprovalRequestError,
  expireApprovalRequest,
  isRequestExpired,
  isTerminalApprovalStatus,
  resolveApprovalRequest,
  resolveTimestamp,
  TimeProvider,
  validateApprovalRequestId,
} from './model.js';
import {
  ApprovalRequestRepository,
  DevelopmentInMemoryApprovalRequestRepository,
} from './repository.js';
import {
  ActorRole,
  ApprovalAccessDeniedError,
  AuthContext,
  ActionOwnershipRegistry,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  SelfApprovalProhibitedError,
  TrustedContactRegistry,
  UnauthenticatedError,
  UnauthorizedActionRequesterError,
} from './authorization.js';

// =============================================================================
// Logging Abstraction (Safe & Privacy-Preserving)
// =============================================================================

/**
 * Interface for logging ApprovalService events.
 * Implementations must never log passwords, OTPs, form data, or personal secrets.
 */
export interface ApprovalServiceLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Silent no-op logger for test suites and headless environments.
 */
export class NoopApprovalServiceLogger implements ApprovalServiceLogger {
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

/**
 * Safe console logger that strictly whitelists non-sensitive metadata keys.
 */
export class SafeConsoleApprovalServiceLogger implements ApprovalServiceLogger {
  private readonly allowedKeys = new Set([
    'requestId',
    'actionId',
    'requesterId',
    'decidedBy',
    'decision',
    'status',
    'riskLevel',
    'category',
    'timestamp',
  ]);

  public info(message: string, context?: Record<string, unknown>): void {
    console.log(`[ApprovalService INFO] ${message}`, this.filterSafeContext(context));
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`[ApprovalService WARN] ${message}`, this.filterSafeContext(context));
  }

  public error(message: string, context?: Record<string, unknown>): void {
    console.error(`[ApprovalService ERROR] ${message}`, this.filterSafeContext(context));
  }

  private filterSafeContext(context?: Record<string, unknown>): Record<string, unknown> {
    if (!context) {
      return {};
    }
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (this.allowedKeys.has(key)) {
        safe[key] = value;
      }
    }
    return safe;
  }
}

// =============================================================================
// Service Configuration & Dependency Injection
// =============================================================================

/**
 * Dependencies injected into ApprovalService.
 */
export interface ApprovalServiceDependencies {
  /** Repository for persisting ApprovalRequest records */
  readonly repository?: ApprovalRequestRepository;

  /** Registry for querying designated trusted contacts */
  readonly contactRegistry?: TrustedContactRegistry;

  /** Registry for checking action ownership */
  readonly actionOwnershipRegistry?: ActionOwnershipRegistry;

  /** Authoritative server time provider */
  readonly timeProvider?: TimeProvider;

  /** Safe logger */
  readonly logger?: ApprovalServiceLogger;
}

/**
 * Options for creating an approval request via ApprovalService.
 */
export interface CreateApprovalServiceRequestOptions extends CreateApprovalRequestOptions {
  /** If true, duplicate active submissions for an actionId throw DuplicateApprovalRequestError */
  readonly rejectDuplicates?: boolean;
}

/**
 * Input for submitting an approval decision.
 */
export interface DecisionInput {
  /** Optional reviewer explanation or justification note */
  readonly decisionReason?: string;
}

// =============================================================================
// Approval Service Implementation
// =============================================================================

/**
 * Authoritative service coordinating ApprovalRequest operations.
 */
export class ApprovalService {
  private readonly repository: ApprovalRequestRepository;
  private readonly contactRegistry: TrustedContactRegistry;
  private readonly actionOwnershipRegistry: ActionOwnershipRegistry;
  private timeProvider: TimeProvider;
  private readonly logger: ApprovalServiceLogger;

  constructor(dependencies?: ApprovalServiceDependencies) {
    this.repository = dependencies?.repository ?? new DevelopmentInMemoryApprovalRequestRepository();
    this.contactRegistry = dependencies?.contactRegistry ?? new InMemoryTrustedContactRegistry();
    this.actionOwnershipRegistry =
      dependencies?.actionOwnershipRegistry ?? new InMemoryActionOwnershipRegistry();
    this.timeProvider = dependencies?.timeProvider ?? defaultTimeProvider;
    this.logger = dependencies?.logger ?? new NoopApprovalServiceLogger();
  }

  /**
   * Returns the configured repository instance.
   */
  public getRepository(): ApprovalRequestRepository {
    return this.repository;
  }

  /**
   * Returns the configured trusted contact registry.
   */
  public getContactRegistry(): TrustedContactRegistry {
    return this.contactRegistry;
  }

  /**
   * Returns the configured action ownership registry.
   */
  public getActionOwnershipRegistry(): ActionOwnershipRegistry {
    return this.actionOwnershipRegistry;
  }

  /**
   * Updates the authoritative time provider.
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
   * Creates a new ApprovalRequest in PENDING state.
   *
   * REQUIREMENTS ENFORCED:
   * 1. Requires valid authenticated session (`assertAuthenticated`).
   * 2. Rejects client-supplied `APPROVED` status or any client status instruction.
   * 3. Rejects client-supplied `requesterId`, `decision`, or `resolvedAt`.
   * 4. Enforces action ownership: User may create requests only for their own actions.
   * 5. Enforces compound idempotency: Duplicate active requests for (userId, actionId)
   *    return the existing active request or throw `DuplicateApprovalRequestError`.
   * 6. Strictly does NOT execute the intercepted browser action.
   * 7. Logs only non-sensitive metadata.
   *
   * @param payload Client submission containing held action metadata
   * @param authContext Verified server authentication context
   * @param options Creation options (TTL, rejectDuplicates)
   * @returns Newly created or existing idempotent ApprovalRequest in PENDING state
   */
  public createRequest(
    payload: ClientApprovalRequestPayload,
    authContext: AuthContext,
    options?: CreateApprovalServiceRequestOptions
  ): ApprovalRequest {
    // 1. Verify caller authentication
    this.assertAuthenticated(authContext);

    // 2. Validate client payload structure & zero client trust
    if (!payload || typeof payload !== 'object') {
      throw new ApprovalValidationError(['ClientApprovalRequestPayload must be a non-null object.']);
    }

    const rawPayload = payload as unknown as Record<string, unknown>;

    // Requirement 9: Do not accept a client-supplied APPROVED status
    if (rawPayload.status !== undefined) {
      throw new ApprovalValidationError([
        'Client payload cannot specify "status". New approval requests are always initialized in PENDING state.',
      ]);
    }
    if (rawPayload.requesterId !== undefined) {
      throw new ApprovalValidationError([
        'Client payload cannot specify "requesterId". The requester identity must be assigned authoritatively by the authenticated session.',
      ]);
    }
    if (rawPayload.decision !== undefined) {
      throw new ApprovalValidationError([
        'Client payload cannot specify "decision". Decisions can only be submitted by authorized trusted contacts.',
      ]);
    }
    if (rawPayload.resolvedAt !== undefined) {
      throw new ApprovalValidationError([
        'Client payload cannot specify "resolvedAt". Initial requests are unresolved.',
      ]);
    }
    if (rawPayload.userId !== undefined && rawPayload.userId !== authContext.actorId) {
      throw new UnauthorizedActionRequesterError(authContext.actorId, payload.actionId);
    }

    // 3. Verify action ownership
    const isActionOwner = this.actionOwnershipRegistry.isActionOwnedByUser(
      payload.actionId,
      authContext.actorId
    );
    if (!isActionOwner) {
      throw new UnauthorizedActionRequesterError(authContext.actorId, payload.actionId);
    }

    // 4. Idempotency & duplicate check
    const existing = this.repository.findByUserAndAction(authContext.actorId, payload.actionId);
    if (existing && existing.status === ApprovalStatus.PENDING) {
      if (!isRequestExpired(existing, this.timeProvider)) {
        const shouldReject = options?.rejectDuplicates ?? false;
        if (shouldReject) {
          throw new DuplicateApprovalRequestError(payload.actionId, existing.id);
        }
        this.logger.info('Returning existing active approval request (idempotent)', {
          requestId: existing.id,
          actionId: existing.actionId,
          requesterId: existing.requesterId,
          status: existing.status,
        });
        return existing;
      }
    }

    // 5. Authoritative requester binding
    const requesterId = authContext.actorId;
    const createdAt = options?.createdAt ?? resolveTimestamp(this.timeProvider);
    const ttlMs = options?.ttlMs ?? 15 * 60 * 1000;
    const expiresAt =
      options?.expiresAt ?? new Date(Date.parse(createdAt) + ttlMs).toISOString();

    const request = createApprovalRequest(payload, requesterId, {
      id: options?.id,
      createdAt,
      expiresAt,
      ttlMs,
    });

    // 6. Save to repository
    this.repository.save(request);

    // 7. Register action ownership in development registry
    if (this.actionOwnershipRegistry instanceof InMemoryActionOwnershipRegistry) {
      this.actionOwnershipRegistry.registerActionOwnership(payload.actionId, requesterId);
    }

    // 8. Safe non-sensitive logging
    this.logger.info('Created approval request', {
      requestId: request.id,
      actionId: request.actionId,
      requesterId: request.requesterId,
      riskLevel: request.riskLevel,
      category: request.category,
      status: request.status,
    });

    return request;
  }

  /**
   * Retrieves an authorized ApprovalRequest by ID.
   *
   * REQUIREMENTS ENFORCED:
   * 1. Requires authenticated session.
   * 2. Allowed callers: Request owner, designated active trusted contact, or admin.
   * 3. Unrelated callers receive an opaque 404 ApprovalAccessDeniedError (anti-enumeration).
   * 4. Lazily evaluates expiration against authoritative time source.
   *
   * @param requestId Canonical approval request identifier
   * @param authContext Verified server authentication context
   * @returns Authorized ApprovalRequest
   */
  public getRequest(requestId: string, authContext: AuthContext): ApprovalRequest {
    this.assertAuthenticated(authContext);

    const validation = validateApprovalRequestId(requestId);
    if (!validation.valid) {
      throw new ApprovalValidationError(validation.errors);
    }

    let request = this.repository.findById(requestId);
    if (!request) {
      throw new ApprovalAccessDeniedError();
    }

    // Lazy expiration check
    if (request.status === ApprovalStatus.PENDING && isRequestExpired(request, this.timeProvider)) {
      const expired = expireApprovalRequest(request, this.timeProvider);
      this.repository.save(expired);
      request = expired;
    }

    // Multi-tenant authorization check
    const isOwner = request.requesterId === authContext.actorId;
    const isAuthorizedContact = this.contactRegistry.isTrustedContactForUser(
      authContext.actorId,
      request.requesterId
    );
    const isAdmin = authContext.role === ActorRole.ADMIN;

    if (!isOwner && !isAuthorizedContact && !isAdmin) {
      // Safe opaque error: identical for missing and unauthorized IDs
      throw new ApprovalAccessDeniedError();
    }

    return request;
  }

  /**
   * Lists all PENDING approval requests that the authenticated actor is authorized to review.
   *
   * @param authContext Verified server authentication context of the trusted contact
   * @returns Array of active pending requests for wards designated to this contact
   */
  public listPendingRequestsForContact(authContext: AuthContext): readonly ApprovalRequest[] {
    this.assertAuthenticated(authContext);

    const all = this.repository.findAll();
    return Object.freeze(
      all.filter((r) => {
        if (r.status !== ApprovalStatus.PENDING) {
          return false;
        }
        if (isRequestExpired(r, this.timeProvider)) {
          return false;
        }
        return this.contactRegistry.isTrustedContactForUser(
          authContext.actorId,
          r.requesterId
        );
      })
    );
  }

  /**
   * Lists all approval requests created by the authenticated requester.
   *
   * @param authContext Verified server authentication context of the requester
   * @param status Optional filter by ApprovalStatus
   * @returns Array of requests belonging strictly to the requester
   */
  public listRequestsForRequester(
    authContext: AuthContext,
    status?: ApprovalStatus
  ): readonly ApprovalRequest[] {
    this.assertAuthenticated(authContext);

    return this.repository.findByRequesterId(authContext.actorId, status);
  }

  /**
   * Approves a PENDING approval request.
   *
   * @param requestId Canonical approval request identifier
   * @param input Optional reviewer explanation or justification note
   * @param authContext Verified server authentication context of the trusted contact
   * @returns Resolved ApprovalRequest in APPROVED state
   */
  public approveRequest(
    requestId: string,
    input: DecisionInput | undefined,
    authContext: AuthContext
  ): ApprovalRequest {
    return this.submitDecision(requestId, 'APPROVED', input, authContext);
  }

  /**
   * Rejects a PENDING approval request.
   *
   * @param requestId Canonical approval request identifier
   * @param input Optional reviewer explanation or justification note
   * @param authContext Verified server authentication context of the trusted contact
   * @returns Resolved ApprovalRequest in REJECTED state
   */
  public rejectRequest(
    requestId: string,
    input: DecisionInput | undefined,
    authContext: AuthContext
  ): ApprovalRequest {
    return this.submitDecision(requestId, 'REJECTED', input, authContext);
  }

  /**
   * Cancels a PENDING approval request.
   *
   * REQUIREMENTS ENFORCED:
   * 1. Requires authenticated session.
   * 2. Only the requesting user who created the request may cancel it.
   * 3. Cannot cancel an already-resolved or expired request.
   * 4. Enforces atomic conditional update.
   *
   * @param requestId Canonical approval request identifier
   * @param reason Optional human-readable cancellation explanation
   * @param authContext Verified server authentication context of the requesting user
   * @returns Resolved ApprovalRequest in CANCELLED state
   */
  public cancelRequest(
    requestId: string,
    reason: string | undefined,
    authContext: AuthContext
  ): ApprovalRequest {
    this.assertAuthenticated(authContext);

    const validation = validateApprovalRequestId(requestId);
    if (!validation.valid) {
      throw new ApprovalValidationError(validation.errors);
    }

    const request = this.repository.findById(requestId);
    if (!request) {
      throw new ApprovalAccessDeniedError();
    }

    // Only the requesting user who created the request may cancel it
    const isOwner = request.requesterId === authContext.actorId;
    if (!isOwner) {
      throw new ApprovalAccessDeniedError();
    }

    // Lifecycle check: terminal states cannot be cancelled
    if (isTerminalApprovalStatus(request.status)) {
      throw new ApprovalAlreadyResolvedError(requestId, request.status, ApprovalStatus.CANCELLED);
    }

    const cancelled = cancelApprovalRequest(
      request,
      authContext.actorId,
      reason,
      this.timeProvider
    );

    // Atomic conditional update
    const success = this.repository.atomicTransition(
      requestId,
      ApprovalStatus.PENDING,
      cancelled
    );

    if (!success) {
      const current = this.repository.findById(requestId);
      const currStatus = current ? current.status : ApprovalStatus.CANCELLED;
      throw new ApprovalAlreadyResolvedError(requestId, currStatus, ApprovalStatus.CANCELLED);
    }

    this.logger.info('Cancelled approval request', {
      requestId,
      requesterId: authContext.actorId,
      status: ApprovalStatus.CANCELLED,
    });

    return cancelled;
  }

  /**
   * Explicitly expires a PENDING approval request.
   *
   * @param requestId Canonical approval request identifier
   * @returns Updated ApprovalRequest in EXPIRED state
   */
  public expireRequest(requestId: string): ApprovalRequest {
    const request = this.repository.findById(requestId);
    if (!request) {
      throw new ApprovalAccessDeniedError();
    }

    if (isTerminalApprovalStatus(request.status)) {
      throw new ApprovalAlreadyResolvedError(requestId, request.status, ApprovalStatus.EXPIRED);
    }

    const expired = expireApprovalRequest(request, this.timeProvider);
    const success = this.repository.atomicTransition(requestId, ApprovalStatus.PENDING, expired);
    if (!success) {
      const current = this.repository.findById(requestId);
      const currStatus = current ? current.status : ApprovalStatus.EXPIRED;
      throw new ApprovalAlreadyResolvedError(requestId, currStatus, ApprovalStatus.EXPIRED);
    }

    return expired;
  }

  /**
   * Scans and expires all stale PENDING requests whose deadline has passed.
   *
   * @returns Count of requests transitioned to EXPIRED
   */
  public checkAndExpireStaleRequests(): number {
    let count = 0;
    const all = this.repository.findAll();
    for (const req of all) {
      if (req.status === ApprovalStatus.PENDING && isRequestExpired(req, this.timeProvider)) {
        const expired = expireApprovalRequest(req, this.timeProvider);
        const success = this.repository.atomicTransition(req.id, ApprovalStatus.PENDING, expired);
        if (success) {
          count++;
        }
      }
    }
    return count;
  }

  // ===========================================================================
  // Internal Decision Handler
  // ===========================================================================

  /**
   * Submits an authoritative reviewer decision (APPROVED or REJECTED).
   *
   * ATOMICITY & FIRST-RESPONDER CONCURRENCY:
   * Uses `repository.atomicTransition` to verify that the record is still PENDING
   * at the exact moment of commitment. If another decision committed first,
   * the update fails and throws ApprovalAlreadyResolvedError.
   */
  private submitDecision(
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    decisionInput: DecisionInput | undefined,
    authContext: AuthContext
  ): ApprovalRequest {
    this.assertAuthenticated(authContext);

    const validation = validateApprovalRequestId(requestId);
    if (!validation.valid) {
      throw new ApprovalValidationError(validation.errors);
    }

    const request = this.repository.findById(requestId);
    if (!request) {
      throw new ApprovalAccessDeniedError();
    }

    // 1. Separation of duties: Self-approval is strictly prohibited
    if (request.requesterId === authContext.actorId) {
      throw new SelfApprovalProhibitedError(authContext.actorId, requestId);
    }

    // 2. Authorization check: Must be an active designated trusted contact (or admin)
    const isAuthorizedContact = this.contactRegistry.isTrustedContactForUser(
      authContext.actorId,
      request.requesterId
    );
    const isAdmin = authContext.role === ActorRole.ADMIN;

    if (!isAuthorizedContact && !isAdmin) {
      throw new ApprovalAccessDeniedError();
    }

    const targetStatus = decision === 'APPROVED' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;

    // 3. Lifecycle checks
    if (isTerminalApprovalStatus(request.status)) {
      throw new ApprovalAlreadyResolvedError(requestId, request.status, targetStatus);
    }

    if (isRequestExpired(request, this.timeProvider)) {
      const expired = expireApprovalRequest(request, this.timeProvider);
      this.repository.atomicTransition(requestId, ApprovalStatus.PENDING, expired);
      const now = resolveTimestamp(this.timeProvider);
      throw new ApprovalExpiredError(requestId, request.expiresAt, now);
    }

    // 4. Authoritative decision record (overwrite client-supplied IDs)
    const decidedAt = resolveTimestamp(this.timeProvider);
    const decidedBy = authContext.actorId;

    const resolved = resolveApprovalRequest(
      request,
      {
        decision,
        decidedBy,
        decidedAt,
        decisionReason: decisionInput?.decisionReason,
      },
      this.timeProvider
    );

    // 5. Atomic conditional update (First-responder concurrency)
    const success = this.repository.atomicTransition(
      requestId,
      ApprovalStatus.PENDING,
      resolved
    );

    if (!success) {
      // Race condition lost: Another reviewer or cancellation committed first
      const current = this.repository.findById(requestId);
      const currStatus = current ? current.status : targetStatus;
      throw new ApprovalAlreadyResolvedError(requestId, currStatus, targetStatus);
    }

    // 6. Safe logging
    this.logger.info(`Recorded decision: ${decision}`, {
      requestId,
      decision,
      decidedBy,
      status: targetStatus,
    });

    return resolved;
  }

  /**
   * Asserts that the caller possesses a valid authenticated session.
   */
  private assertAuthenticated(authContext: AuthContext): void {
    if (
      !authContext ||
      !authContext.isAuthenticated ||
      !authContext.actorId ||
      !authContext.actorId.trim()
    ) {
      throw new UnauthenticatedError();
    }
  }
}
