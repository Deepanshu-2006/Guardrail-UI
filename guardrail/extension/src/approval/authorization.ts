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
import { generateActionId, generateTimestamp } from '../utils/metadata.js';

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

/// =============================================================================
// Trusted Contact & Invitation Relationship Models
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
 * Lifecycle status of an out-of-band trusted contact invitation.
 */
export enum InvitationStatus {
  /** Invitation generated and waiting for contact acceptance */
  PENDING = 'PENDING',
  /** Accepted by designated contact; relationship is now ACTIVE */
  ACCEPTED = 'ACCEPTED',
  /** Expired past validity window without acceptance */
  EXPIRED = 'EXPIRED',
  /** Revoked by issuing ward before acceptance */
  REVOKED = 'REVOKED',
}

/**
 * Representation of a designated trusted contact relationship.
 */
export interface TrustedContact {
  /** Unique trusted contact identifier (e.g., 'tc_01J9X4...' or actorId) */
  readonly id: string;

  /** Canonical alias for id representing the contact actor */
  readonly contactId?: string;

  /** The protected user / ward who designated this contact ('usr_...') */
  readonly userId: string;

  /** Canonical alias for userId representing the ward */
  readonly wardId?: string;

  /** Optional human-readable relationship label (e.g., 'Guardian', 'Supervisor') */
  readonly relationshipLabel?: string;

  /** Current authorization status of this relationship */
  readonly status: TrustedContactStatus;

  /** ISO 8601 UTC creation timestamp */
  readonly createdAt: string;
}

/**
 * Representation of a secure out-of-band invitation to become a trusted contact.
 */
export interface TrustedContactInvitation {
  /** Canonical invitation identifier (e.g., 'inv_...') */
  readonly id: string;

  /** Out-of-band pairing code (e.g., 'GR-INV-A1B2-C3D4') */
  readonly code: string;

  /** The issuing protected user / ward ('usr_...') */
  readonly userId: string;

  /** Canonical alias for userId representing the ward */
  readonly wardId?: string;

  /** Optional human-readable relationship label suggested by the ward */
  readonly relationshipLabel?: string;

  /** Current lifecycle status of the invitation */
  readonly status: InvitationStatus;

  /** ISO 8601 UTC creation timestamp */
  readonly createdAt: string;

  /** ISO 8601 UTC expiration timestamp */
  readonly expiresAt: string;

  /** Trusted contact identifier that accepted this invitation, if resolved */
  readonly acceptedByContactId?: string;

  /** ISO 8601 UTC acceptance timestamp, if resolved */
  readonly acceptedAt?: string;

  /** ISO 8601 UTC revocation timestamp, if revoked */
  readonly revokedAt?: string;
}

/**
 * Options for generating a new trusted contact invitation.
 */
export interface CreateInvitationOptions {
  /** Optional human-readable relationship label (e.g., 'Guardian', 'Spouse', 'IT Supervisor') */
  readonly relationshipLabel?: string;

  /** Optional invitation TTL in milliseconds (defaults to 24 hours = 86,400,000 ms) */
  readonly ttlMs?: number;

  /** Optional custom invitation code (for testing or deterministic seeding) */
  readonly customCode?: string;

  /** Optional custom invitation identifier ('inv_...') */
  readonly id?: string;
}

/**
 * Generates an unambiguous, human-readable pairing code (format: 'GR-INV-XXXX-YYYY').
 * Uses a Crockford-inspired alphanumeric character set excluding easily confused glyphs (0, O, 1, I, L).
 */
export function generateInvitationCode(): string {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let p1 = '';
  let p2 = '';
  for (let i = 0; i < 4; i++) {
    p1 += chars.charAt(Math.floor(Math.random() * chars.length));
    p2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `GR-INV-${p1}-${p2}`;
}

/**
 * Validates an invitation pairing code format.
 */
export function validateInvitationCode(
  code: unknown
): { valid: boolean; normalized?: string; errors: readonly string[] } {
  const errors: string[] = [];
  if (typeof code !== 'string' || !code.trim()) {
    errors.push('Invitation code is required and must be a non-empty string.');
    return { valid: false, errors: Object.freeze(errors) };
  }

  const normalized = code.trim().toUpperCase();
  // Accepts standard GR-INV-XXXX-YYYY, or testing token forms (INV-...)
  if (
    !/^GR-INV-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized) &&
    !/^INV-[A-Z0-9_-]{4,32}$/.test(normalized)
  ) {
    errors.push(
      `Invalid invitation code format "${code}". Expected format: "GR-INV-XXXX-YYYY" (e.g. "GR-INV-4B7K-9MP2").`
    );
    return { valid: false, errors: Object.freeze(errors) };
  }

  return { valid: true, normalized, errors: Object.freeze(errors) };
}

/**
 * Validates a human-readable relationship label.
 */
export function validateRelationshipLabel(
  label: unknown
): { valid: boolean; normalized?: string; errors: readonly string[] } {
  const errors: string[] = [];
  if (label === undefined || label === null || label === '') {
    return { valid: true, normalized: undefined, errors: Object.freeze(errors) };
  }

  if (typeof label !== 'string') {
    errors.push('Relationship label must be a string if provided.');
    return { valid: false, errors: Object.freeze(errors) };
  }

  const trimmed = label.trim();
  if (trimmed.length > 64) {
    errors.push(
      `Relationship label exceeds maximum permitted length of 64 characters (length: ${trimmed.length}).`
    );
    return { valid: false, errors: Object.freeze(errors) };
  }

  if (/[\r\n\t\x00-\x1F\x7F]/.test(trimmed)) {
    errors.push('Relationship label must not contain control characters or newlines.');
    return { valid: false, errors: Object.freeze(errors) };
  }

  return { valid: true, normalized: trimmed, errors: Object.freeze(errors) };
}

/**
 * Interface for querying and managing trusted contact relationships and invitations.
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

  /**
   * Checks whether a user has at least one ACTIVE designated trusted contact.
   */
  hasActiveTrustedContact(userId: string): boolean;

  /**
   * Creates an out-of-band invitation for a ward to invite a trusted contact.
   */
  createInvitation(userId: string, options?: CreateInvitationOptions): TrustedContactInvitation;

  /**
   * Looks up an invitation by its pairing code, lazily expiring it if deadline passed.
   */
  getInvitationByCode(code: string): TrustedContactInvitation | undefined;

  /**
   * Looks up an invitation by its unique identifier.
   */
  getInvitationById(id: string): TrustedContactInvitation | undefined;

  /**
   * Lists all invitations created by a user.
   */
  listInvitationsForUser(userId: string): readonly TrustedContactInvitation[];

  /**
   * Accepts an invitation code on behalf of an authenticated contact, activating the relationship.
   */
  acceptInvitation(
    code: string,
    contactId: string
  ): { invitation: TrustedContactInvitation; contact: TrustedContact };

  /**
   * Revokes an existing invitation created by the ward.
   */
  revokeInvitation(invitationId: string, userId: string): TrustedContactInvitation;

  /**
   * Revokes an active trusted contact relationship.
   */
  revokeTrustedContact(contactId: string, userId: string): boolean;
}

/**
 * Minimal in-memory implementation of TrustedContactRegistry.
 * Provides the relationship and invitation abstraction until persistent database storage is introduced.
 */
export class InMemoryTrustedContactRegistry implements TrustedContactRegistry {
  private readonly contacts: Map<string, TrustedContact> = new Map();
  private readonly userIndex: Map<string, Set<string>> = new Map(); // userId -> Set<contactId>
  private readonly invitations: Map<string, TrustedContactInvitation> = new Map(); // invitationId -> invitation
  private readonly codeIndex: Map<string, string> = new Map(); // normalized code -> invitationId
  private readonly userInvitations: Map<string, Set<string>> = new Map(); // userId -> Set<invitationId>

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

  public hasActiveTrustedContact(userId: string): boolean {
    return this.getTrustedContactsForUser(userId).length > 0;
  }

  public createInvitation(
    userId: string,
    options?: CreateInvitationOptions
  ): TrustedContactInvitation {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new Error('userId is required to create a trusted contact invitation.');
    }

    const trimmedUserId = userId.trim();

    // Validate relationship label if specified
    const labelValidation = validateRelationshipLabel(options?.relationshipLabel);
    if (!labelValidation.valid) {
      throw new Error(labelValidation.errors[0]);
    }

    // Determine code
    let code: string;
    if (options?.customCode !== undefined) {
      const codeValidation = validateInvitationCode(options.customCode);
      if (!codeValidation.valid) {
        throw new Error(codeValidation.errors[0]);
      }
      code = codeValidation.normalized!;
      if (this.codeIndex.has(code)) {
        const existingId = this.codeIndex.get(code)!;
        const existing = this.invitations.get(existingId);
        if (existing && existing.status === InvitationStatus.PENDING) {
          throw new DuplicateContactRelationshipError(code, trimmedUserId);
        }
      }
    } else {
      do {
        code = generateInvitationCode();
      } while (this.codeIndex.has(code));
    }

    const id = options?.id ?? generateActionId('inv');
    const createdAt = generateTimestamp();
    const ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000; // default 24h
    const expiresAt = new Date(Date.parse(createdAt) + ttlMs).toISOString();

    const invitation: TrustedContactInvitation = Object.freeze({
      id,
      code,
      userId: trimmedUserId,
      wardId: trimmedUserId,
      relationshipLabel: labelValidation.normalized,
      status: InvitationStatus.PENDING,
      createdAt,
      expiresAt,
    });

    this.invitations.set(id, invitation);
    this.codeIndex.set(code, id);

    let userInviteSet = this.userInvitations.get(trimmedUserId);
    if (!userInviteSet) {
      userInviteSet = new Set();
      this.userInvitations.set(trimmedUserId, userInviteSet);
    }
    userInviteSet.add(id);

    return invitation;
  }

  public getInvitationByCode(code: string): TrustedContactInvitation | undefined {
    if (!code || typeof code !== 'string') {
      return undefined;
    }
    const normalized = code.trim().toUpperCase();
    const id = this.codeIndex.get(normalized);
    if (!id) {
      return undefined;
    }
    return this.getInvitationById(id);
  }

  public getInvitationById(id: string): TrustedContactInvitation | undefined {
    const existing = this.invitations.get(id);
    if (!existing) {
      return undefined;
    }

    // Lazy expiration check
    if (
      existing.status === InvitationStatus.PENDING &&
      Date.now() >= Date.parse(existing.expiresAt)
    ) {
      const expired = Object.freeze({
        ...existing,
        status: InvitationStatus.EXPIRED,
      });
      this.invitations.set(id, expired);
      return expired;
    }

    return existing;
  }

  public listInvitationsForUser(userId: string): readonly TrustedContactInvitation[] {
    const inviteIds = this.userInvitations.get(userId);
    if (!inviteIds) {
      return [];
    }
    const result: TrustedContactInvitation[] = [];
    for (const id of inviteIds) {
      const inv = this.getInvitationById(id);
      if (inv) {
        result.push(inv);
      }
    }
    // Newest first
    result.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return Object.freeze(result);
  }

  public acceptInvitation(
    code: string,
    contactId: string
  ): { invitation: TrustedContactInvitation; contact: TrustedContact } {
    if (!contactId || typeof contactId !== 'string' || !contactId.trim()) {
      throw new Error('contactId is required to accept an invitation.');
    }
    const trimmedContactId = contactId.trim();

    const codeValidation = validateInvitationCode(code);
    if (!codeValidation.valid) {
      throw new InvitationNotFoundError(code);
    }

    const invitation = this.getInvitationByCode(codeValidation.normalized!);
    if (!invitation) {
      throw new InvitationNotFoundError(code);
    }

    // Check expiration
    if (invitation.status === InvitationStatus.EXPIRED) {
      throw new InvitationExpiredError(invitation.id, invitation.expiresAt);
    }

    // Check revocation
    if (invitation.status === InvitationStatus.REVOKED) {
      throw new InvitationRevokedError(invitation.id);
    }

    // Check duplicate acceptance
    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new InvitationAlreadyAcceptedError(invitation.id);
    }

    // Separation of duties: Self-invitation is prohibited
    if (trimmedContactId === invitation.userId) {
      throw new SelfInvitationProhibitedError(trimmedContactId, invitation.id);
    }

    // Check duplicate relationship
    if (this.isTrustedContactForUser(trimmedContactId, invitation.userId)) {
      throw new DuplicateContactRelationshipError(trimmedContactId, invitation.userId);
    }

    const acceptedAt = generateTimestamp();
    const updatedInvitation: TrustedContactInvitation = Object.freeze({
      ...invitation,
      status: InvitationStatus.ACCEPTED,
      acceptedByContactId: trimmedContactId,
      acceptedAt,
    });
    this.invitations.set(invitation.id, updatedInvitation);

    const contact: TrustedContact = Object.freeze({
      id: trimmedContactId,
      contactId: trimmedContactId,
      userId: invitation.userId,
      wardId: invitation.userId,
      relationshipLabel: invitation.relationshipLabel,
      status: TrustedContactStatus.ACTIVE,
      createdAt: acceptedAt,
    });
    this.addContact(contact);

    return { invitation: updatedInvitation, contact };
  }

  public revokeInvitation(invitationId: string, userId: string): TrustedContactInvitation {
    const invitation = this.getInvitationById(invitationId);
    if (!invitation || invitation.userId !== userId) {
      throw new InvitationNotFoundError(invitationId);
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new ApprovalAuthorizationError(
        'Cannot revoke an invitation that has already been accepted.',
        409
      );
    }

    if (invitation.status === InvitationStatus.REVOKED) {
      return invitation;
    }

    const revoked: TrustedContactInvitation = Object.freeze({
      ...invitation,
      status: InvitationStatus.REVOKED,
      revokedAt: generateTimestamp(),
    });
    this.invitations.set(invitationId, revoked);
    return revoked;
  }

  public revokeTrustedContact(contactId: string, userId: string): boolean {
    const contact = this.contacts.get(contactId);
    if (!contact || contact.userId !== userId) {
      return false;
    }
    const revoked = Object.freeze({
      ...contact,
      status: TrustedContactStatus.REVOKED,
    });
    this.contacts.set(contactId, revoked);
    return true;
  }

  public clear(): void {
    this.contacts.clear();
    this.userIndex.clear();
    this.invitations.clear();
    this.codeIndex.clear();
    this.userInvitations.clear();
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

/**
 * Error thrown when a user without an active trusted contact attempts to create an approval request.
 */
export class NoActiveTrustedContactError extends ApprovalAuthorizationError {
  public readonly userId: string;

  constructor(userId: string) {
    super(
      `Cannot create approval request: No active trusted contact is configured for user "${userId}". High-risk browser actions requiring approval cannot proceed until a trusted contact is linked.`,
      422
    );
    this.name = 'NoActiveTrustedContactError';
    this.userId = userId;
  }
}

/**
 * Error thrown when an invitation cannot be found or the code is invalid.
 */
export class InvitationNotFoundError extends ApprovalAuthorizationError {
  constructor(identifier?: string) {
    super(`Invitation not found or invalid: "${identifier ?? 'unknown'}".`, 404);
    this.name = 'InvitationNotFoundError';
  }
}

/**
 * Error thrown when an invitation has expired past its validity window.
 */
export class InvitationExpiredError extends ApprovalAuthorizationError {
  public readonly invitationId: string;
  public readonly expiresAt: string;

  constructor(invitationId: string, expiresAt: string) {
    super(
      `Invitation "${invitationId}" has expired at ${expiresAt}. Please request a new invitation code.`,
      410
    );
    this.name = 'InvitationExpiredError';
    this.invitationId = invitationId;
    this.expiresAt = expiresAt;
  }
}

/**
 * Error thrown when an invitation was revoked by the issuing user.
 */
export class InvitationRevokedError extends ApprovalAuthorizationError {
  public readonly invitationId: string;

  constructor(invitationId: string) {
    super(
      `Invitation "${invitationId}" was revoked by the user and is no longer valid.`,
      410
    );
    this.name = 'InvitationRevokedError';
    this.invitationId = invitationId;
  }
}

/**
 * Error thrown when an invitation has already been accepted.
 */
export class InvitationAlreadyAcceptedError extends ApprovalAuthorizationError {
  public readonly invitationId: string;

  constructor(invitationId: string) {
    super(
      `Invitation "${invitationId}" has already been accepted and cannot be reused.`,
      409
    );
    this.name = 'InvitationAlreadyAcceptedError';
    this.invitationId = invitationId;
  }
}

/**
 * Error thrown when a user attempts to accept their own invitation or link with themselves.
 */
export class SelfInvitationProhibitedError extends ApprovalAuthorizationError {
  public readonly actorId: string;
  public readonly invitationId: string;

  constructor(actorId: string, invitationId: string) {
    super(
      `Access denied: Actor "${actorId}" cannot accept an invitation issued by themselves ("${invitationId}"). Users cannot serve as their own trusted contact. Separation of duties is strictly enforced.`,
      403
    );
    this.name = 'SelfInvitationProhibitedError';
    this.actorId = actorId;
    this.invitationId = invitationId;
  }
}

/**
 * Error thrown when a contact relationship already exists between this contact and user.
 */
export class DuplicateContactRelationshipError extends ApprovalAuthorizationError {
  public readonly contactId: string;
  public readonly userId: string;

  constructor(contactId: string, userId: string) {
    super(
      `Contact "${contactId}" is already an active trusted contact for user "${userId}". Duplicate active relationships are not permitted.`,
      409
    );
    this.name = 'DuplicateContactRelationshipError';
    this.contactId = contactId;
    this.userId = userId;
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
    options?: CreateApprovalRequestOptions & {
      rejectDuplicates?: boolean;
      requireActiveContact?: boolean;
    }
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

    // 3. Enforce trusted contact configuration if required
    if (options?.requireActiveContact && !this.contactRegistry.hasActiveTrustedContact(requesterId)) {
      throw new NoActiveTrustedContactError(requesterId);
    }

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

  // ===========================================================================
  // Trusted Contact & Invitation Operations
  // ===========================================================================

  /**
   * Creates a new trusted contact invitation on behalf of the authenticated ward.
   */
  public createInvitation(
    authContext: AuthContext,
    options?: CreateInvitationOptions
  ): TrustedContactInvitation {
    this.assertAuthenticated(authContext);
    return this.contactRegistry.createInvitation(authContext.actorId, options);
  }

  /**
   * Lists all trusted contact invitations issued by the authenticated user.
   */
  public listInvitationsForUser(
    authContext: AuthContext
  ): readonly TrustedContactInvitation[] {
    this.assertAuthenticated(authContext);
    return this.contactRegistry.listInvitationsForUser(authContext.actorId);
  }

  /**
   * Retrieves an invitation by its pairing code or identifier.
   */
  public getInvitation(
    identifier: string,
    authContext: AuthContext
  ): TrustedContactInvitation {
    this.assertAuthenticated(authContext);

    let invitation = this.contactRegistry.getInvitationByCode(identifier);
    if (!invitation) {
      invitation = this.contactRegistry.getInvitationById(identifier);
    }

    if (!invitation) {
      throw new ApprovalAccessDeniedError();
    }

    const isOwner = invitation.userId === authContext.actorId;
    const isPending = invitation.status === InvitationStatus.PENDING;
    const isAdmin = authContext.role === ActorRole.ADMIN;

    if (!isOwner && !isPending && !isAdmin) {
      throw new ApprovalAccessDeniedError();
    }

    return invitation;
  }

  /**
   * Accepts an invitation code on behalf of the authenticated contact.
   */
  public acceptInvitation(
    code: string,
    authContext: AuthContext
  ): { invitation: TrustedContactInvitation; contact: TrustedContact } {
    this.assertAuthenticated(authContext);
    return this.contactRegistry.acceptInvitation(code, authContext.actorId);
  }

  /**
   * Revokes an invitation created by the authenticated user.
   */
  public revokeInvitation(
    invitationId: string,
    authContext: AuthContext
  ): TrustedContactInvitation {
    this.assertAuthenticated(authContext);
    return this.contactRegistry.revokeInvitation(invitationId, authContext.actorId);
  }

  /**
   * Retrieves all active trusted contacts for the authenticated user.
   */
  public getTrustedContactsForUser(
    authContext: AuthContext
  ): readonly TrustedContact[] {
    this.assertAuthenticated(authContext);
    return this.contactRegistry.getTrustedContactsForUser(authContext.actorId);
  }

  /**
   * Revokes an active trusted contact relationship.
   */
  public revokeTrustedContact(
    contactId: string,
    authContext: AuthContext
  ): boolean {
    this.assertAuthenticated(authContext);
    return this.contactRegistry.revokeTrustedContact(contactId, authContext.actorId);
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
