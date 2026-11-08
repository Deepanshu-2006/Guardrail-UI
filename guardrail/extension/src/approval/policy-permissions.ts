/**
 * Guardrail Protection Policy Permission Boundaries & Authority Model
 *
 * Authoritatively defines the ownership, viewing permissions, mutation rights,
 * and security invariants governing protection policy management in Guardrail.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. STRICT SEPARATION OF DUTIES (WARD SOVEREIGNTY):
 *    - Protection policy settings belong EXCLUSIVELY to the protected user (ward).
 *    - Trusted contacts hold ZERO policy administration authority.
 *    - A trusted contact's approval permission (deciding specific action requests)
 *      does NOT grant policy administration permission.
 *    - Dashboard visibility does not imply modification rights.
 * 2. MINIMAL READ-ONLY CONTACT VISIBILITY (SANITIZED SUMMARY):
 *    - Trusted contacts with ACTIVE status may view a high-level, sanitized summary
 *      of protection status and category protections to provide informed oversight.
 *    - Private browsing habits (trusted domain allowlists), internal detection weights,
 *      and configuration credentials are STRICTLY REDACTED from trusted contact views.
 * 3. STRICT REVOCATION HANDLING:
 *    - If a trusted contact relationship is REVOKED or PENDING, all visibility into
 *      the ward's policy is immediately terminated (yielding opaque 404 anti-enumeration).
 * 4. OPTIMISTIC CONCURRENCY CONTROL (STALE UPDATE PREVENTION):
 *    - Every policy update must specify an expected policy version or satisfy strict
 *      semver forward progression, preventing stale requests from overwriting newer policies.
 * 5. IMMUTABLE SECURITY INVARIANTS:
 *    - Non-configurable protections (e.g. CONTROLLED_DESTRUCTIVE, UNSUPPORTED_BOUNDARY_GUARD)
 *      cannot be disabled, bypassed, or downgraded to ALLOW/WARN by ANY actor.
 * 6. AUDIT TRAIL WITHOUT SENSITIVE DATA:
 *    - Non-sensitive change metadata (timestamp, actor, modified fields, version bump) is
 *      durably recorded without capturing credentials, passwords, or secrets.
 */

import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import {
  CURRENT_ARCHITECTURE_POLICY_VERSION,
  CURRENT_ARCHITECTURE_SCHEMA_VERSION,
  GuardrailPolicyConfig,
  PolicyConfigValidationErrorDetail,
} from '../types/config.js';
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  validatePolicyConfig,
} from '../config/schema.js';
import {
  ActorRole,
  AuthContext,
  TrustedContact,
  TrustedContactRegistry,
  TrustedContactStatus,
} from './authorization.js';

// =============================================================================
// Authority & Permission Classification
// =============================================================================

/**
 * Declares the authoritative owner scope for a policy setting.
 */
export enum PolicySettingAuthority {
  /** Setting belongs exclusively to the protected user; only the ward can read/write. */
  WARD_EXCLUSIVE = 'WARD_EXCLUSIVE',

  /** High-level summary viewable by active trusted contact; editable only by ward. */
  WARD_EDITABLE_CONTACT_SUMMARY = 'WARD_EDITABLE_CONTACT_SUMMARY',

  /** Immutable system security invariant; non-configurable by any actor. */
  IMMUTABLE_SYSTEM_INVARIANT = 'IMMUTABLE_SYSTEM_INVARIANT',
}

/**
 * Authoritative matrix defining permissions for all protection settings.
 */
export const POLICY_SETTING_AUTHORITY_MATRIX = Object.freeze({
  schemaVersion: {
    authority: PolicySettingAuthority.IMMUTABLE_SYSTEM_INVARIANT,
    description: 'System schema specification version. Managed strictly by runtime contract.',
    wardEditable: false,
    contactViewable: true,
  },
  policyVersion: {
    authority: PolicySettingAuthority.WARD_EXCLUSIVE,
    description: 'Ward policy semantic version. Bumped on authorized ward updates.',
    wardEditable: true,
    contactViewable: true,
  },
  updatedAt: {
    authority: PolicySettingAuthority.WARD_EXCLUSIVE,
    description: 'Authoritative server timestamp when policy was last modified.',
    wardEditable: false,
    contactViewable: true,
  },
  thresholds: {
    authority: PolicySettingAuthority.WARD_EXCLUSIVE,
    description: 'Numeric risk tier boundaries (lowMax, mediumMax, highMax). Exclusively configured by ward.',
    wardEditable: true,
    contactViewable: false, // Trusted contacts only see preset tier name (e.g. "balanced"), not internal scores
  },
  signals: {
    authority: PolicySettingAuthority.WARD_EXCLUSIVE,
    description: 'Observable risk signal weights and contributions. Internal detection parameters.',
    wardEditable: true,
    contactViewable: false,
  },
  policies: {
    authority: PolicySettingAuthority.WARD_EDITABLE_CONTACT_SUMMARY,
    description: 'Action policies. Ward configures decisions; contacts see high-level category summaries.',
    wardEditable: true,
    contactViewable: true,
  },
  trustedDomains: {
    authority: PolicySettingAuthority.WARD_EXCLUSIVE,
    description: 'Ward exempt domain allowlist. Private browsing context, strictly redacted from contacts.',
    wardEditable: true,
    contactViewable: false,
  },
  timeouts: {
    authority: PolicySettingAuthority.WARD_EXCLUSIVE,
    description: 'Operational approval TTL and dashboard polling intervals.',
    wardEditable: true,
    contactViewable: false,
  },
  destructiveActionProtection: {
    authority: PolicySettingAuthority.IMMUTABLE_SYSTEM_INVARIANT,
    description: 'CONTROLLED_DESTRUCTIVE rule. Permanently locked to PROTECT. Cannot be disabled or downgraded.',
    wardEditable: false,
    contactViewable: true,
  },
  unsupportedBoundaryGuard: {
    authority: PolicySettingAuthority.IMMUTABLE_SYSTEM_INVARIANT,
    description: 'UNSUPPORTED_BOUNDARY_GUARD rule. Permanently locked to PROTECT. Cannot be disabled or downgraded.',
    wardEditable: false,
    contactViewable: true,
  },
});

// =============================================================================
// Trusted Contact Viewable Policy Models
// =============================================================================

/**
 * Sanitized, read-only policy summary presented to authorized Trusted Contacts.
 * Strictly excludes private domain allowlists, detection weights, and credentials.
 */
export interface TrustedContactPolicySummary {
  /** The ward identifier this policy governs */
  readonly wardId: string;

  /** Active policy semantic version */
  readonly policyVersion: string;

  /** Active schema specification version */
  readonly schemaVersion: string;

  /** Timestamp when policy was last updated */
  readonly updatedAt: string;

  /** Overall protection status */
  readonly overallStatus: 'ACTIVE' | 'DEGRADED';

  /** Normalized sensitivity preset label */
  readonly sensitivityPreset: 'balanced' | 'strict' | 'custom';

  /** Staging mode activation status */
  readonly stagingModeEnabled: boolean;

  /** High-level category protections summary */
  readonly categoryProtections: {
    readonly destructiveActions: ResponseAction.PROTECT;
    readonly paymentActions: ResponseAction;
    readonly boundaryGuards: ResponseAction.PROTECT;
    readonly sensitiveData: ResponseAction;
    readonly externalNavigation: ResponseAction;
  };

  /** Summary of the active trusted contact relationship */
  readonly relationship: {
    readonly contactId: string;
    readonly relationshipLabel?: string;
    readonly status: 'ACTIVE';
  };
}

/**
 * Full policy response returned exclusively to the protected user (ward).
 */
export interface WardFullPolicyResponse {
  readonly viewType: 'WARD_FULL_POLICY';
  readonly userId: string;
  readonly config: GuardrailPolicyConfig;
  readonly isOwner: true;
  readonly canAdminister: true;
}

/**
 * Sanitized policy response returned to authorized active trusted contacts.
 */
export interface TrustedContactPolicyResponse {
  readonly viewType: 'TRUSTED_CONTACT_SUMMARY';
  readonly wardId: string;
  readonly summary: TrustedContactPolicySummary;
  readonly isOwner: false;
  readonly canAdminister: false;
}

export type UserPolicyView = WardFullPolicyResponse | TrustedContactPolicyResponse;

// =============================================================================
// Policy Record & Audit Models
// =============================================================================

/**
 * Classification of policy change origins to distinguish user agency from system defaults.
 */
export type PolicyChangeSource = 'USER_CHANGE' | 'SYSTEM_DEFAULT' | 'SYSTEM_RESET';

/**
 * Authoritative record of a user's protection policy stored on the backend.
 */
export interface UserPolicyRecord {
  readonly userId: string;
  readonly policyVersion: string;
  readonly schemaVersion: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly config: GuardrailPolicyConfig;
  readonly isSystemDefault?: boolean;
}

/**
 * Non-sensitive change log entry recording policy configuration mutations.
 */
export interface PolicyAuditRecord {
  /** Unique audit entry identifier (e.g. 'audit_pol_...') */
  readonly id: string;

  /** Target user whose policy was updated */
  readonly userId: string;

  /** Authoritative actor who initiated the change */
  readonly updatedBy: string;

  /** Role of the actor responsible for the change */
  readonly actorRole?: ActorRole | 'USER' | 'TRUSTED_CONTACT' | 'ADMIN' | 'SYSTEM';

  /** ISO 8601 UTC timestamp of change */
  readonly timestamp: string;

  /** Policy version prior to update */
  readonly previousPolicyVersion: string;

  /** Policy version resulting from update */
  readonly newPolicyVersion: string;

  /** Dot-path list of modified configuration properties */
  readonly changedFields: readonly string[];

  /** Human-readable change summary */
  readonly changeSummary: string;

  /** Distinguishes user-initiated customizations from system defaults and automated resets */
  readonly changeSource?: PolicyChangeSource;

  /** True if the resulting configuration represents default system recommendations */
  readonly isSystemDefault?: boolean;

  /** Clear explanation of the practical security and user interaction impact of the change */
  readonly impactSummary?: string;
}

/**
 * Input payload for updating a user's protection policy.
 */
export interface UpdateUserPolicyInput {
  /** The full candidate policy configuration document */
  readonly config: GuardrailPolicyConfig;

  /**
   * Expected active policy version (Optimistic Concurrency Control).
   * If provided and doesn't match current backend policy version, update fails with 409 Conflict.
   */
  readonly expectedPolicyVersion?: string;

  /** Optional non-sensitive reason for the change */
  readonly changeReason?: string;

  /** Optional explicit change source flag */
  readonly changeSource?: PolicyChangeSource;

  /** Optional system default flag */
  readonly isSystemDefault?: boolean;
}

// =============================================================================
// Safe Authorization & Concurrency Errors
// =============================================================================

/**
 * Error thrown when an actor lacking policy administration authority
 * attempts to modify a protection policy.
 */
export class PolicyAdministrationDeniedError extends Error {
  public readonly statusCode: number = 403;
  public readonly code: string = 'POLICY_ADMINISTRATION_DENIED';

  constructor(
    message: string = 'Access denied: Trusted contacts and third parties hold zero policy administration authority. Protection policies belong exclusively to the protected user.'
  ) {
    super(`[Guardrail Policy Authorization] ${message}`);
    this.name = 'PolicyAdministrationDeniedError';
  }
}

/**
 * Safe, opaque error thrown when an unauthorized or revoked actor
 * attempts to access a policy resource. Prevents user ID guessing.
 */
export class PolicyAccessDeniedError extends Error {
  public readonly statusCode: number = 404;
  public readonly code: string = 'NOT_FOUND_OR_DENIED';

  constructor(
    message: string = 'Access denied: Policy not found or insufficient permissions.'
  ) {
    super(`[Guardrail Policy Authorization] ${message}`);
    this.name = 'PolicyAccessDeniedError';
  }
}

/**
 * Error thrown when an update fails due to a version conflict or stale request.
 */
export class PolicyVersionConflictError extends Error {
  public readonly statusCode: number = 409;
  public readonly code: string = 'POLICY_VERSION_CONFLICT';

  constructor(
    expectedVersion: string,
    actualVersion: string,
    message?: string
  ) {
    super(
      message ??
        `[Guardrail Policy Concurrency] Stale policy update rejected: Expected version "${expectedVersion}" does not match active version "${actualVersion}". Please reload the latest policy.`
    );
    this.name = 'PolicyVersionConflictError';
  }
}

/**
 * Error thrown when a policy update violates an immutable security invariant.
 */
export class PolicyInvariantViolationError extends Error {
  public readonly statusCode: number = 400;
  public readonly code: string = 'MANDATORY_INVARIANT_VIOLATION';
  public readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(
      `[Guardrail Security Invariants] Policy update rejected due to ${violations.length} mandatory invariant violation(s): ${violations.join('; ')}`
    );
    this.name = 'PolicyInvariantViolationError';
    this.violations = Object.freeze([...violations]);
  }
}

// =============================================================================
// Pure Helper & Validation Functions
// =============================================================================

/**
 * Determines sensitivity preset from configuration thresholds.
 */
export function determineSensitivityPreset(
  config: GuardrailPolicyConfig
): 'balanced' | 'strict' | 'custom' {
  const { lowMax, mediumMax, highMax } = config.thresholds;
  if (lowMax === 24 && mediumMax === 49 && highMax === 74) {
    return 'balanced';
  }
  if (lowMax === 14 && mediumMax === 34 && highMax === 59) {
    return 'strict';
  }
  return 'custom';
}

/**
 * Extracts a sanitized, read-only policy summary for an active trusted contact.
 * Strips private domain allowlists, detection signal weights, and raw internal scoring.
 */
export function extractTrustedContactPolicySummary(
  wardId: string,
  config: GuardrailPolicyConfig,
  contact: TrustedContact
): TrustedContactPolicySummary {
  const findDecision = (id: RiskPolicyId): ResponseAction => {
    const rule = config.policies.find((p) => p.id === id);
    return rule ? rule.decision : ResponseAction.PROTECT;
  };

  const destructive = ResponseAction.PROTECT;
  const payment = findDecision(RiskPolicyId.CONTROLLED_PAYMENT);
  const boundary = ResponseAction.PROTECT;
  const sensitiveData = findDecision(RiskPolicyId.FORM_SUBMISSION);
  const externalNav = findDecision(RiskPolicyId.EXTERNAL_NAVIGATION);

  return Object.freeze({
    wardId,
    policyVersion: config.policyVersion,
    schemaVersion: config.schemaVersion,
    updatedAt: config.updatedAt,
    overallStatus: 'ACTIVE',
    sensitivityPreset: determineSensitivityPreset(config),
    stagingModeEnabled: true,
    categoryProtections: Object.freeze({
      destructiveActions: destructive,
      paymentActions: payment,
      boundaryGuards: boundary,
      sensitiveData,
      externalNavigation: externalNav,
    }),
    relationship: Object.freeze({
      contactId: contact.id,
      relationshipLabel: contact.relationshipLabel,
      status: 'ACTIVE' as const,
    }),
  });
}

/**
 * Computes non-sensitive changed fields and a concise summary between two policy configurations.
 */
export function computePolicyDiff(
  oldConfig: GuardrailPolicyConfig,
  newConfig: GuardrailPolicyConfig
): { changedFields: readonly string[]; summary: string } {
  const changes: string[] = [];

  // Thresholds
  if (oldConfig.thresholds.lowMax !== newConfig.thresholds.lowMax) {
    changes.push(`thresholds.lowMax (${oldConfig.thresholds.lowMax} -> ${newConfig.thresholds.lowMax})`);
  }
  if (oldConfig.thresholds.mediumMax !== newConfig.thresholds.mediumMax) {
    changes.push(`thresholds.mediumMax (${oldConfig.thresholds.mediumMax} -> ${newConfig.thresholds.mediumMax})`);
  }
  if (oldConfig.thresholds.highMax !== newConfig.thresholds.highMax) {
    changes.push(`thresholds.highMax (${oldConfig.thresholds.highMax} -> ${newConfig.thresholds.highMax})`);
  }

  // Policies
  for (const newRule of newConfig.policies) {
    const oldRule = oldConfig.policies.find((p) => p.id === newRule.id);
    if (!oldRule) {
      changes.push(`policies[${newRule.id}] (added)`);
    } else {
      if (oldRule.enabled !== newRule.enabled) {
        changes.push(`policies[${newRule.id}].enabled (${oldRule.enabled} -> ${newRule.enabled})`);
      }
      if (oldRule.decision !== newRule.decision) {
        changes.push(`policies[${newRule.id}].decision (${oldRule.decision} -> ${newRule.decision})`);
      }
      if (oldRule.priority !== newRule.priority) {
        changes.push(`policies[${newRule.id}].priority (${oldRule.priority} -> ${newRule.priority})`);
      }
    }
  }

  // Trusted domains count
  if (oldConfig.trustedDomains.length !== newConfig.trustedDomains.length ||
      oldConfig.trustedDomains.some((d, i) => d !== newConfig.trustedDomains[i])) {
    changes.push(`trustedDomains (${oldConfig.trustedDomains.length} -> ${newConfig.trustedDomains.length} domains)`);
  }

  // Timeouts
  if (oldConfig.timeouts.approvalTtlSeconds !== newConfig.timeouts.approvalTtlSeconds) {
    changes.push(`timeouts.approvalTtlSeconds (${oldConfig.timeouts.approvalTtlSeconds}s -> ${newConfig.timeouts.approvalTtlSeconds}s)`);
  }
  if (oldConfig.timeouts.dashboardPollIntervalMs !== newConfig.timeouts.dashboardPollIntervalMs) {
    changes.push(`timeouts.dashboardPollIntervalMs (${oldConfig.timeouts.dashboardPollIntervalMs}ms -> ${newConfig.timeouts.dashboardPollIntervalMs}ms)`);
  }

  const summary = changes.length > 0
    ? `Updated ${changes.length} setting(s): ${changes.slice(0, 3).join(', ')}${changes.length > 3 ? '...' : ''}`
    : 'No structural changes detected';

  const fieldPaths = changes.map((c) => c.split(' ')[0]);
  const impactSummary = explainAllPolicyImpacts(fieldPaths, oldConfig, newConfig);

  return Object.freeze({
    changedFields: Object.freeze(fieldPaths),
    summary,
    impactSummary,
  });
}

/**
 * Explains the practical security and interaction impact of a specific policy setting modification.
 */
export function explainPolicySettingImpact(
  fieldPath: string,
  oldConfig?: GuardrailPolicyConfig,
  newConfig?: GuardrailPolicyConfig
): string {
  if (fieldPath.startsWith('thresholds.lowMax')) {
    const oldVal = oldConfig?.thresholds.lowMax;
    const newVal = newConfig?.thresholds.lowMax;
    if (oldVal !== undefined && newVal !== undefined) {
      return newVal < oldVal
        ? `Low-risk threshold lowered (${oldVal} -> ${newVal}): Routine interactions will trigger warnings earlier.`
        : `Low-risk threshold raised (${oldVal} -> ${newVal}): More routine interactions will proceed without warning prompts.`;
    }
    return 'Low-risk boundary adjustment: Influences which routine interactions require initial warning confirmation.';
  }

  if (fieldPath.startsWith('thresholds.mediumMax')) {
    const oldVal = oldConfig?.thresholds.mediumMax;
    const newVal = newConfig?.thresholds.mediumMax;
    if (oldVal !== undefined && newVal !== undefined) {
      return `Medium-risk boundary adjusted (${oldVal} -> ${newVal}): Shifts boundary between self-confirmation and trusted-contact review.`;
    }
    return 'Medium-risk boundary adjustment: Determines when actions escalate from self-confirmation to trusted-contact approval.';
  }

  if (fieldPath.startsWith('thresholds.highMax')) {
    const oldVal = oldConfig?.thresholds.highMax;
    const newVal = newConfig?.thresholds.highMax;
    if (oldVal !== undefined && newVal !== undefined) {
      return `High-risk boundary adjusted (${oldVal} -> ${newVal}): Critical threshold for mandatory protection shifted.`;
    }
    return 'High-risk threshold adjustment: Defines critical ceiling where interactions require mandatory approval or protection.';
  }

  if (fieldPath.includes('CONTROLLED_DESTRUCTIVE')) {
    return 'Destructive action guard: Irreversible operations (account deletion, data wipe) remain permanently locked to PROTECT.';
  }

  if (fieldPath.includes('UNSUPPORTED_BOUNDARY_GUARD')) {
    return 'Boundary integrity guard: Untrusted execution contexts and boundary bypass attempts remain permanently locked to PROTECT.';
  }

  if (fieldPath.includes('CONTROLLED_PAYMENT')) {
    const rule = newConfig?.policies.find((p) => p.id === RiskPolicyId.CONTROLLED_PAYMENT);
    const decision = rule?.decision ?? 'PROTECT';
    return `Payment checkout protection (${decision}): E-commerce checkout and financial transactions require ${decision === ResponseAction.PROTECT ? 'trusted contact approval before execution' : 'warning review'}.`;
  }

  if (fieldPath.includes('FORM_SUBMISSION') || fieldPath.includes('AUTHENTICATION_BOUNDARY')) {
    return 'Sensitive data guard: Monitors form submissions to prevent credential harvesting and unauthorized personal data collection.';
  }

  if (fieldPath.includes('EXTERNAL_NAVIGATION')) {
    return 'Navigation boundary protection: Intercepts transitions to unknown external third-party domains.';
  }

  if (fieldPath.startsWith('trustedDomains')) {
    const count = newConfig?.trustedDomains.length ?? 0;
    return `Exempt domains allowlist updated (${count} domains): Specified hostnames bypass inspection prompts for streamlined browsing without logging URLs.`;
  }

  if (fieldPath.startsWith('timeouts.approvalTtlSeconds')) {
    const ttl = newConfig?.timeouts.approvalTtlSeconds;
    return `Review TTL updated (${ttl ? `${ttl}s` : 'custom'}): Pending requests will automatically expire after this duration if unreviewed.`;
  }

  if (fieldPath.startsWith('timeouts.dashboardPollIntervalMs')) {
    const ms = newConfig?.timeouts.dashboardPollIntervalMs;
    return `Dashboard polling cadence updated (${ms ? `${ms}ms` : 'custom'}): Adjusts refresh frequency of review queue.`;
  }

  return `Configuration setting \"${fieldPath}\" updated: Modifies runtime browser protection policy behavior.`;
}

/**
 * Aggregates practical security impact explanations for a list of modified fields.
 */
export function explainAllPolicyImpacts(
  changedFields: readonly string[],
  oldConfig?: GuardrailPolicyConfig,
  newConfig?: GuardrailPolicyConfig
): string {
  if (!changedFields || changedFields.length === 0) {
    return 'No policy settings modified; operational protection state remains unchanged.';
  }

  const explanations = changedFields
    .map((field) => explainPolicySettingImpact(field, oldConfig, newConfig))
    .filter(Boolean);

  return explanations.join(' ');
}

/**
 * Asserts that the authenticated actor has authority to administer the specified ward's policy.
 * Throws PolicyAdministrationDeniedError or PolicyAccessDeniedError if unauthorized.
 */
export function assertCanAdministerPolicy(
  authContext: AuthContext,
  targetUserId: string
): void {
  if (!authContext || !authContext.isAuthenticated) {
    throw new PolicyAccessDeniedError();
  }

  // Separation of duties: Trusted contact role can NEVER administer policy
  if (authContext.role === ActorRole.TRUSTED_CONTACT || authContext.role === 'TRUSTED_CONTACT') {
    throw new PolicyAdministrationDeniedError(
      'Trusted contacts hold zero policy administration authority. Policy settings belong exclusively to the protected user.'
    );
  }

  // Admin cannot override ward policy sovereignty
  if (authContext.role === ActorRole.ADMIN || authContext.role === 'ADMIN') {
    throw new PolicyAdministrationDeniedError(
      'Administrative override of user protection policy is prohibited. Policy authority belongs exclusively to the ward.'
    );
  }

  // Ownership validation: Acting user must strictly match the target user
  if (authContext.actorId !== targetUserId) {
    // Return opaque 404 to prevent user ID enumeration across users
    throw new PolicyAccessDeniedError(
      'Access denied: Policy not found or insufficient permissions.'
    );
  }
}
