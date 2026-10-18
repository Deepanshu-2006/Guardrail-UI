/**
 * Guardrail Server-Side Approval Authorization Service
 *
 * Implements authoritative server-side authorization rules governing who may
 * create, view, decide (approve/reject), or cancel an ApprovalRequest.
 *
 * ARCHITECTURAL BOUNDARIES & RESPONSIBILITIES:
 * 1. AUTHENTICATION VS AUTHORIZATION:
 *    - AUTHENTICATION (Who are you?): Handled by incoming server transport middleware
 *      (e.g., verifying JWT bearer tokens, session cookies, or magic-link signatures).
 *      Produces a verified `AuthContext`.
 *    - AUTHORIZATION (What are you allowed to do?): Enforced here in the service boundary.
 *      Verifies whether the authenticated `AuthContext` possesses permission to perform
 *      the requested operation on the target resource.
 * 2. ZERO CLIENT TRUST:
 *    - Requester IDs, approver IDs, and verdicts in client JSON are NEVER trusted as proof.
 *    - The acting identity is obtained strictly from the verified server `AuthContext`.
 * 3. MULTI-TENANT PRIVACY & SAFE ERRORS:
 *    - Unrelated users cannot enumerate or discover other users' requests by guessing IDs.
 *    - Unauthorized access returns safe, opaque access-denied errors that never leak
 *      whether an unowned request ID exists or disclose sensitive ward/contact names.
 * 4. SEPARATION OF DUTIES & SELF-APPROVAL:
 *    - Protected users (wards) CANNOT approve or decide their own requests.
 *    - Only verified, active Trusted Contacts designated for that user may decide requests.
 * 5. PERSISTENCE & ABSTRACTION NOTICE:
 *    - No persistent database or auth middleware exists yet in `guardrail/server`.
 *    - `InMemoryTrustedContactRegistry` provides the minimal suitable relationship abstraction.
 *    - When the backend datastore is introduced, this interface will bind to the PostgreSQL/SQLite
 *      `trusted_contacts` table defined in `guardrail/docs/approval-workflow-contract.md`.
 */

import {
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
  SubmitApprovalDecisionInput,
} from '../types/approval.js';
import {
  ApprovalLifecycleManager,
  defaultApprovalLifecycleManager,
} from './lifecycle.js';
import {
  CreateApprovalRequestOptions,
} from './model.js';

// =============================================================================
// Authentication & Identity Models
// =============================================================================

/**
 * Roles recognized by Guardrail authorization.
 */
export enum ActorRole {
  /** The protected user / ward using the browser extension */
  USER = 'USER',
  /** An authorized caretaker / approver designated by a user */
  TRUSTED_CONTACT = 'TRUSTED_CONTACT',
  /** System administrator */
  ADMIN = 'ADMIN',
}

/**
 * Authoritative server-side authentication context.
 * Produced by server transport middleware after cryptographically verifying credentials.
 */
export interface AuthContext {
  /** Unique authoritative identifier of the authenticated actor (e.g., 'usr_alice' or 'tc_bob') */
  readonly actorId: string;

  /** Verified role of the actor */
  readonly role: ActorRole | 'USER' | 'TRUSTED_CONTACT' | 'ADMIN';

  /** True if the caller's session has been successfully verified */
  readonly isAuthenticated: boolean;

  /** Optional active session identifier */
  readonly sessionId?: string;
}

// =============================================================================
// Trusted Contact Relationship Model
// =============================================================================

/**
 * Lifecycle status of a trusted contact relationship.
 */
export enum TrustedContactStatus {
  /** Active and authorized to review and decide requests */
  ACTIVE = 'ACTIVE',
  /** Invitation pending acceptance; not yet authorized */
  PENDING_INVITE = 'PENDING_INVITE',
  /** Relationship revoked by user or policy; decisions prohibited */
  REVOKED = 'REVOKED',
}

/**
 * Representation of a designated trusted contact relationship.
 */
export interface TrustedContact {
  /** Unique trusted contact identifier (e.g., 'tc_01J9X4...') */
  readonly id: string;

  /** The protected user / ward who designated this contact ('usr_...') */
  readonly userId: string;

  /** Optional human-readable relationship label (e.g., 'Guardian', 'Supervisor') */
  readonly relationshipLabel?: string;

  /** Current authorization status of this relationship */
  readonly status: TrustedContactStatus;

  /** ISO 8601 UTC creation timestamp */
  readonly createdAt: string;
}

/**
 * Interface for querying trusted contact relationships.
 */
export interface TrustedContactRegistry {
  /**
   * Verifies whether a given contact is an ACTIVE authorized trusted contact for a user.
   */
  isTrustedContactForUser(contactId: string, userId: string): boolean;

  /**
   * Retrieves all active trusted contacts designated by a user.
   */
  getTrustedContactsForUser(userId: string): readonly TrustedContact[];
}

/**
 * Minimal in-memory implementation of TrustedContactRegistry.
 * Provides the relationship abstraction until database persistence is added.
 */
export class InMemoryTrustedContactRegistry implements TrustedContactRegistry {
  private readonly contacts: Map<string, TrustedContact> = new Map();
  private readonly userIndex: Map<string, Set<string>> = new Map(); // userId -> Set<contactId>

  public addContact(contact: TrustedContact): void {
    const frozen = Object.freeze({ ...contact });
    this.contacts.set(frozen.id, frozen);

    let userSet = this.userIndex.get(frozen.userId);
    if (!userSet) {
      userSet = new Set();
      this.userIndex.set(frozen.userId, userSet);
    }
    userSet.add(frozen.id);
  }

  public updateStatus(contactId: string, status: TrustedContactStatus): boolean {
    const existing = this.contacts.get(contactId);
    if (!existing) {
      return false;
    }
    const updated = Object.freeze({ ...existing, status });
    this.contacts.set(contactId, updated);
    return true;
  }

  public getContact(contactId: string): TrustedContact | undefined {
    return this.contacts.get(contactId);
  }

  public isTrustedContactForUser(contactId: string, userId: string): boolean {
    const contact = this.contacts.get(contactId);
    if (!contact) {
      return false;
    }
    if (contact.userId !== userId) {
      return false;
    }
    return contact.status === TrustedContactStatus.ACTIVE;
  }

  public getTrustedContactsForUser(userId: string): readonly TrustedContact[] {
    const contactIds = this.userIndex.get(userId);
    if (!contactIds) {
      return [];
    }
    const result: TrustedContact[] = [];
    for (const id of contactIds) {
      const c = this.contacts.get(id);
      if (c && c.status === TrustedContactStatus.ACTIVE) {
        result.push(c);
      }
    }
    return Object.freeze(result);
  }

  public clear(): void {
    this.contacts.clear();
    this.userIndex.clear();
  }
}

// =============================================================================
// Action Ownership Model
// =============================================================================

/**
 * Interface for verifying ownership of intercepted browser actions.
 * Ensures a requester may create approval requests only for actions
 * originating from their own authenticated user session.
 */
export interface ActionOwnershipRegistry {
  /**
   * Verifies whether an intercepted action belongs to the specified user.
   */
  isActionOwnedByUser(actionId: string, userId: string): boolean;
}

/**
 * Minimal in-memory implementation of ActionOwnershipRegistry.
 * Tracks associations between intercepted actions and authenticated users.
 */
export class InMemoryActionOwnershipRegistry implements ActionOwnershipRegistry {
  private readonly actionOwners: Map<string, string> = new Map(); // actionId -> userId

  /**
   * Explicitly registers that an action belongs to a specific user.
   */
  public registerActionOwnership(actionId: string, userId: string): void {
    if (!actionId || !userId) {
      throw new Error('actionId and userId are required to register action ownership.');
    }
    this.actionOwners.set(actionId, userId);
  }

  /**
   * Checks whether an action belongs to the user.
   * If the action is registered, it must match the given userId.
   * If the action has not been pre-registered, returns true by default
   * (allowing newly observed actions unless explicitly registered to another user).
   */
  public isActionOwnedByUser(actionId: string, userId: string): boolean {
    const owner = this.actionOwners.get(actionId);
    if (!owner) {
      // If no explicit prior owner is registered, the action is unconstrained
      return true;
    }
    return owner === userId;
  }

  /**
   * Returns the registered owner for an action, if any.
   */
  public getActionOwner(actionId: string): string | undefined {
    return this.actionOwners.get(actionId);
  }

  /**
   * Clears all registered action ownership records.
   */
  public clear(): void {
    this.actionOwners.clear();
  }
}

// =============================================================================
// Safe Authorization Errors
// =============================================================================

/**
 * Error thrown when an unauthenticated caller attempts a protected operation.
 */
export class UnauthenticatedError extends Error {
  public readonly statusCode: number = 401;

  constructor(message: string = 'Authentication required. No valid session credentials provided.') {
    super(`[Guardrail Authorization] ${message}`);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Generic authorization error that avoids disclosing sensitive data.
 */
export class ApprovalAuthorizationError extends Error {
  public readonly statusCode: number;

  constructor(
    message: string = 'Access denied: You do not have permission to perform this action.',
    statusCode: number = 403
  ) {
    super(`[Guardrail Authorization] ${message}`);
    this.name = 'ApprovalAuthorizationError';
    this.statusCode = statusCode;
  }
}

/**
 * Safe Not Found / Access Denied error.
 * Returns an opaque message that does NOT leak whether an unowned request ID exists,
 * protecting against ID guessing and enumeration attacks.
 */
export class ApprovalAccessDeniedError extends ApprovalAuthorizationError {
  constructor() {
    super('Access denied: Request not found or insufficient permissions.', 404);
    this.name = 'ApprovalAccessDeniedError';
  }
}

/**
 * Error thrown when self-approval is attempted by the requesting user.
 */
export class SelfApprovalProhibitedError extends ApprovalAuthorizationError {
  public readonly actorId: string;
  public readonly requestId: string;

  constructor(actorId: string, requestId: string) {
    super(
      `Access denied: Requester "${actorId}" cannot approve or decide their own approval request "${requestId}". Separation of duties is strictly enforced.`,
      403
    );
    this.name = 'SelfApprovalProhibitedError';
    this.actorId = actorId;
    this.requestId = requestId;
  }
}

/**
 * Error thrown when an authenticated user attempts to create an approval request
 * for an action that belongs to a different user.
 */
export class UnauthorizedActionRequesterError extends ApprovalAuthorizationError {
  public readonly actorId: string;
  public readonly actionId: string;

  constructor(actorId: string, actionId: string) {
    super(
      `Access denied: Requester "${actorId}" is not authorized to create an approval request for action "${actionId}". Users may create requests only for their own intercepted actions.`,
      403
    );
    this.name = 'UnauthorizedActionRequesterError';
    this.actorId = actorId;
    this.actionId = actionId;
  }
}

// =============================================================================
// Server-Side Approval Authorization Service
// =============================================================================

/**
 * Service enforcing multi-tenant authorization rules for all ApprovalRequest operations.
 */
export class ApprovalAuthorizationService {
  private readonly lifecycleManager: ApprovalLifecycleManager;
  private readonly contactRegistry: TrustedContactRegistry;
  private readonly actionOwnershipRegistry: ActionOwnershipRegistry;

  constructor(
    lifecycleManager: ApprovalLifecycleManager = defaultApprovalLifecycleManager,
    contactRegistry: TrustedContactRegistry = new InMemoryTrustedContactRegistry(),
    actionOwnershipRegistry: ActionOwnershipRegistry = new InMemoryActionOwnershipRegistry()
  ) {
    this.lifecycleManager = lifecycleManager;
    this.contactRegistry = contactRegistry;
    this.actionOwnershipRegistry = actionOwnershipRegistry;
  }

  public getLifecycleManager(): ApprovalLifecycleManager {
    return this.lifecycleManager;
  }

  public getContactRegistry(): TrustedContactRegistry {
    return this.contactRegistry;
  }

  public getActionOwnershipRegistry(): ActionOwnershipRegistry {
    return this.actionOwnershipRegistry;
  }

  /**
   * Creates a new approval request on behalf of the authenticated user.
   *
   * AUTHORIZATION INVARIANTS:
   * 1. Requires an authenticated session (assertAuthenticated).
   * 2. The requester may create requests only for actions belonging to them.
   * 3. The authoritative requester identity is derived STRICTLY from authContext.actorId.
   * 4. Any client attempt to choose or spoof requester identity is blocked.
   *
   * @param payload Client submission containing held action metadata
   * @param authContext Verified server authentication context
   * @param options Creation options (TTL, rejectDuplicates)
   * @returns Newly created ApprovalRequest in PENDING state
   */
  public createRequest(
    payload: ClientApprovalRequestPayload,
    authContext: AuthContext,
    options?: CreateApprovalRequestOptions & { rejectDuplicates?: boolean }
  ): ApprovalRequest {
    this.assertAuthenticated(authContext);

    // 1. Verify action ownership: Requester may create requests only for actions belonging to them
    const rawPayload = payload as unknown as Record<string, unknown>;
    if (rawPayload && rawPayload.userId !== undefined && rawPayload.userId !== authContext.actorId) {
      throw new UnauthorizedActionRequesterError(authContext.actorId, payload.actionId);
    }

    const isActionOwner = this.actionOwnershipRegistry.isActionOwnedByUser(
      payload.actionId,
      authContext.actorId
    );
    if (!isActionOwner) {
      throw new UnauthorizedActionRequesterError(authContext.actorId, payload.actionId);
    }

    // 2. Identity is strictly bound to the authenticated server context
    const requesterId = authContext.actorId;

    const request = this.lifecycleManager.createRequest(payload, requesterId, options);

    // If using in-memory ownership registry, register the newly claimed action
    if (this.actionOwnershipRegistry instanceof InMemoryActionOwnershipRegistry) {
      this.actionOwnershipRegistry.registerActionOwnership(payload.actionId, requesterId);
    }

    return request;
  }

  /**
   * Retrieves an ApprovalRequest by ID with strict multi-tenant authorization.
   *
   * AUTHORIZATION INVARIANTS:
   * 1. Requires authenticated session.
   * 2. Allowed actors:
   *    - The requesting user who owns the request (requesterId === actorId).
   *    - An authorized active Trusted Contact designated for that user.
   *    - System administrator (role === ADMIN).
   * 3. Unrelated authenticated users receive an opaque ApprovalAccessDeniedError
   *    (preventing request ID enumeration or existence probing).
   *
   * @param requestId Canonical approval request identifier
   * @param authContext Verified server authentication context
   * @returns The authorized ApprovalRequest
   * @throws ApprovalAccessDeniedError if request not found or caller is unauthorized
   */
  public getRequest(
    requestId: string,
    authContext: AuthContext
  ): ApprovalRequest {
    this.assertAuthenticated(authContext);

    const request = this.lifecycleManager.getRequest(requestId);
    if (!request) {
      throw new ApprovalAccessDeniedError();
    }

    const isOwner = request.requesterId === authContext.actorId;
    const isAuthorizedContact = this.contactRegistry.isTrustedContactForUser(
      authContext.actorId,
      request.requesterId
    );
    const isAdmin = authContext.role === ActorRole.ADMIN;

    if (!isOwner && !isAuthorizedContact && !isAdmin) {
      // Safe opaque error: Do not disclose whether the request ID exists
      throw new ApprovalAccessDeniedError();
    }

    return request;
  }

  /**
   * Lists all approval requests belonging to the authenticated requester.
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

    const all = this.lifecycleManager.getAllRequests();
    return Object.freeze(
      all.filter((r) => {
        if (r.requesterId !== authContext.actorId) {
          return false;
        }
        return status ? r.status === status : true;
      })
    );
  }

  /**
   * Lists all PENDING approval requests that the authenticated actor is authorized to review.
   *
   * @param authContext Verified server authentication context of the trusted contact
   * @returns Array of pending requests for wards designated to this contact
   */
  public listPendingRequestsForContact(
    authContext: AuthContext
  ): readonly ApprovalRequest[] {
    this.assertAuthenticated(authContext);

    const all = this.lifecycleManager.getAllRequests();
    return Object.freeze(
      all.filter((r) => {
        if (r.status !== ApprovalStatus.PENDING) {
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
   * Submits an authoritative verdict (APPROVED or REJECTED) on an approval request.
   *
   * AUTHORIZATION INVARIANTS:
   * 1. Requires authenticated session.
   * 2. Self-approval is STRICTLY PROHIBITED: If actorId === request.requesterId, throws SelfApprovalProhibitedError.
   * 3. Only an active, designated Trusted Contact for this requester (or ADMIN) may decide.
   * 4. Unrelated users receive ApprovalAccessDeniedError.
   * 5. The decision-maker ID (`decidedBy`) is obtained STRICTLY from authContext.actorId.
   *    Client-supplied approver IDs in payload are ignored/overwritten.
   *
   * @param requestId Canonical approval request identifier
   * @param decisionInput Verdict and optional justification note
   * @param authContext Verified server authentication context
   * @returns Resolved ApprovalRequest
   */
  public submitDecision(
    requestId: string,
    decisionInput: Omit<SubmitApprovalDecisionInput, 'decidedBy'> & { decidedBy?: string },
    authContext: AuthContext
  ): ApprovalRequest {
    this.assertAuthenticated(authContext);

    // Retrieve request (opaque error if not found)
    const request = this.lifecycleManager.getRequest(requestId);
    if (!request) {
      throw new ApprovalAccessDeniedError();
    }

    // 1. Separation of duties: Self-approval is rejected by default
    if (request.requesterId === authContext.actorId) {
      throw new SelfApprovalProhibitedError(authContext.actorId, requestId);
    }

    // 2. Authorization check: Must be an active trusted contact for the requesting ward (or admin)
    const isAuthorizedContact = this.contactRegistry.isTrustedContactForUser(
      authContext.actorId,
      request.requesterId
    );
    const isAdmin = authContext.role === ActorRole.ADMIN;

    if (!isAuthorizedContact && !isAdmin) {
      throw new ApprovalAccessDeniedError();
    }

    // 3. Authoritative decision identity: Overwrite decidedBy with authenticated server actorId
    const authoritativeInput: SubmitApprovalDecisionInput = {
      decision: decisionInput.decision,
      decidedBy: authContext.actorId,
      decidedAt: decisionInput.decidedAt,
      decisionReason: decisionInput.decisionReason,
    };

    return this.lifecycleManager.submitDecision(requestId, authoritativeInput);
  }

  /**
   * Cancels a PENDING approval request.
   *
   * AUTHORIZATION INVARIANTS:
   * 1. Requires authenticated session.
   * 2. Only the requesting user who created the request (or ADMIN) may cancel it.
   * 3. Trusted contacts and unrelated users cannot cancel the ward's action.
   *
   * @param requestId Canonical approval request identifier
   * @param authContext Verified server authentication context
   * @param reason Optional cancellation explanation
   * @returns Cancelled ApprovalRequest
   */
  public cancelRequest(
    requestId: string,
    authContext: AuthContext,
    reason?: string
  ): ApprovalRequest {
    this.assertAuthenticated(authContext);

    const request = this.lifecycleManager.getRequest(requestId);
    if (!request) {
      throw new ApprovalAccessDeniedError();
    }

    const isOwner = request.requesterId === authContext.actorId;

    if (!isOwner) {
      throw new ApprovalAccessDeniedError();
    }

    return this.lifecycleManager.cancelRequest(
      requestId,
      authContext.actorId,
      reason
    );
  }

  /**
   * Validates that the authentication context represents a verified session.
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
