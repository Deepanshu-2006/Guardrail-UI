/**
 * Guardrail Protection Policy Service
 *
 * Implements authoritative backend permission enforcement, ownership validation,
 * sanitized trusted-contact summaries, optimistic concurrency control, and
 * non-sensitive policy change audit logging.
 */

import {
  CURRENT_ARCHITECTURE_POLICY_VERSION,
  CURRENT_ARCHITECTURE_SCHEMA_VERSION,
  GuardrailPolicyConfig,
} from '../types/config.js';
import { RiskPolicyId } from '../types/policy.js';
import { ResponseAction } from '../types/response.js';
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
  UnauthenticatedError,
} from './authorization.js';
import {
  assertCanAdministerPolicy,
  computePolicyDiff,
  extractTrustedContactPolicySummary,
  PolicyAccessDeniedError,
  PolicyAdministrationDeniedError,
  PolicyAuditRecord,
  PolicyChangeSource,
  PolicyInvariantViolationError,
  PolicyVersionConflictError,
  UpdateUserPolicyInput,
  UserPolicyRecord,
  UserPolicyView,
} from './policy-permissions.js';
import {
  InMemoryPolicyRepository,
  PolicyRepository,
} from './policy-repository.js';
import { generateActionId, generateTimestamp } from '../utils/metadata.js';

export interface PolicyServiceDependencies {
  readonly policyRepository?: PolicyRepository;
  readonly contactRegistry: TrustedContactRegistry;
  readonly timeProvider?: () => Date;
}

export class PolicyService {
  private readonly policyRepository: PolicyRepository;
  private readonly contactRegistry: TrustedContactRegistry;
  private readonly timeProvider: () => Date;

  constructor(deps: PolicyServiceDependencies) {
    this.policyRepository = deps.policyRepository ?? new InMemoryPolicyRepository();
    this.contactRegistry = deps.contactRegistry;
    this.timeProvider = deps.timeProvider ?? (() => new Date());
  }

  /**
   * Retrieves a user's protection policy respecting strict permission boundaries.
   * - Wards receive their full policy configuration (WARD_FULL_POLICY).
   * - Active trusted contacts receive a sanitized, read-only summary (TRUSTED_CONTACT_SUMMARY).
   * - Revoked contacts or unassigned third parties are denied with opaque 404 (anti-enumeration).
   */
  public async getUserPolicy(
    authContext: AuthContext,
    targetUserId: string
  ): Promise<UserPolicyView> {
    if (!authContext || !authContext.isAuthenticated) {
      throw new UnauthenticatedError();
    }
    if (!targetUserId || !targetUserId.trim()) {
      throw new PolicyAccessDeniedError('Invalid user identifier.');
    }
    const normalizedUserId = targetUserId.trim();

    // 1. Target Ward requesting their own policy
    if (authContext.actorId === normalizedUserId && authContext.role === ActorRole.USER) {
      const record = await this.getOrCreatePolicyRecord(normalizedUserId);
      return Object.freeze({
        viewType: 'WARD_FULL_POLICY',
        userId: normalizedUserId,
        config: record.config,
        isOwner: true,
        canAdminister: true,
      });
    }

    // 2. Trusted Contact requesting visibility into assigned ward
    if (authContext.role === ActorRole.TRUSTED_CONTACT || authContext.role === 'TRUSTED_CONTACT') {
      const isAuthorized = this.contactRegistry.isTrustedContactForUser(
        authContext.actorId,
        normalizedUserId
      );

      // If not active, or relationship revoked / pending -> opaque 404 anti-enumeration
      if (!isAuthorized) {
        throw new PolicyAccessDeniedError();
      }

      const contacts = this.contactRegistry.getTrustedContactsForUser(normalizedUserId);
      const activeContact = contacts.find((c) => c.id === authContext.actorId) ?? {
        id: authContext.actorId,
        userId: normalizedUserId,
        status: TrustedContactStatus.ACTIVE,
        createdAt: generateTimestamp(),
      };

      const record = await this.getOrCreatePolicyRecord(normalizedUserId);
      const summary = extractTrustedContactPolicySummary(
        normalizedUserId,
        record.config,
        activeContact
      );

      return Object.freeze({
        viewType: 'TRUSTED_CONTACT_SUMMARY',
        wardId: normalizedUserId,
        summary,
        isOwner: false,
        canAdminister: false,
      });
    }

    // 3. Third party or Admin -> Opaque 404
    throw new PolicyAccessDeniedError();
  }

  /**
   * Updates a user's protection policy.
   * - Strictly restricted to the target ward (authContext.actorId === targetUserId).
   * - Trusted contacts are rejected with 403 Forbidden.
   * - Cross-user attempts are rejected with 404 (anti-enumeration).
   * - Enforces schema validation and mandatory security invariants.
   * - Prevents stale requests from overwriting newer versions via Optimistic Concurrency Control.
   * - Logs non-sensitive audit metadata.
   */
  public async updateUserPolicy(
    authContext: AuthContext,
    targetUserId: string,
    input: UpdateUserPolicyInput
  ): Promise<UserPolicyRecord> {
    if (!authContext || !authContext.isAuthenticated) {
      throw new UnauthenticatedError();
    }
    const normalizedUserId = targetUserId?.trim();

    // 1. Authorization & Ownership Validation
    assertCanAdministerPolicy(authContext, normalizedUserId);

    if (!input || !input.config || typeof input.config !== 'object') {
      throw new PolicyInvariantViolationError([
        'Request payload must include a valid "config" object.',
      ]);
    }

    // 2. Validate Candidate Policy Schema & Content
    const validation = validatePolicyConfig(input.config);
    if (!validation.valid) {
      const errorDetails = validation.errors.map(
        (e: PolicyConfigValidationErrorDetail) => `[${e.code}] ${e.field}: ${e.message}`
      );
      throw new PolicyInvariantViolationError(errorDetails);
    }

    const candidateConfig = validation.config!;

    // 3. Enforce Mandatory Security Invariants
    const invariantViolations: string[] = [];
    const destructivePolicy = candidateConfig.policies.find(
      (p) => p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE
    );
    if (!destructivePolicy || !destructivePolicy.enabled) {
      invariantViolations.push(
        'Policy CONTROLLED_DESTRUCTIVE cannot be disabled. It is a mandatory security invariant.'
      );
    } else if (destructivePolicy.decision !== ResponseAction.PROTECT) {
      invariantViolations.push(
        `Policy CONTROLLED_DESTRUCTIVE cannot be downgraded to ${destructivePolicy.decision}. It must remain PROTECT.`
      );
    }

    const boundaryGuard = candidateConfig.policies.find(
      (p) => p.id === RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD
    );
    if (!boundaryGuard || !boundaryGuard.enabled) {
      invariantViolations.push(
        'Policy UNSUPPORTED_BOUNDARY_GUARD cannot be disabled. It is a mandatory security invariant.'
      );
    } else if (boundaryGuard.decision !== ResponseAction.PROTECT) {
      invariantViolations.push(
        `Policy UNSUPPORTED_BOUNDARY_GUARD cannot be downgraded to ${boundaryGuard.decision}. It must remain PROTECT.`
      );
    }

    if (invariantViolations.length > 0) {
      throw new PolicyInvariantViolationError(invariantViolations);
    }

    // 4. Retrieve Existing Record & Optimistic Concurrency Check
    const existing = await this.policyRepository.getPolicy(normalizedUserId);
    const nowIso = this.timeProvider().toISOString();

    if (existing) {
      // Check explicit expected version
      if (input.expectedPolicyVersion !== undefined) {
        if (input.expectedPolicyVersion !== existing.policyVersion) {
          throw new PolicyVersionConflictError(
            input.expectedPolicyVersion,
            existing.policyVersion,
            `Stale policy update rejected: Expected version "${input.expectedPolicyVersion}" does not match active version "${existing.policyVersion}". Stale requests cannot overwrite newer policies.`
          );
        }
      } else {
        // If no expectedPolicyVersion supplied, reject update if incoming version is <= existing version
        if (candidateConfig.policyVersion === existing.policyVersion) {
          throw new PolicyVersionConflictError(
            candidateConfig.policyVersion,
            existing.policyVersion,
            `Stale policy update rejected: Policy version "${candidateConfig.policyVersion}" has already been applied. A new version identifier is required.`
          );
        }
      }
    }

    // 5. Diff & Non-Sensitive Audit Recording
    const baseConfig = existing ? existing.config : DEFAULT_GUARDRAIL_POLICY_CONFIG;
    const diff = computePolicyDiff(baseConfig, candidateConfig);

    const isReset = input.isSystemDefault ?? (input.changeReason?.toLowerCase().includes('reset to canonical') || false);
    const changeSource: PolicyChangeSource = input.changeSource ?? (isReset ? 'SYSTEM_RESET' : 'USER_CHANGE');
    const isSystemDefault = isReset;
    const actorRole = authContext.role ?? ActorRole.USER;

    const auditRecord: PolicyAuditRecord = Object.freeze({
      id: generateActionId('pol_aud'),
      userId: normalizedUserId,
      updatedBy: authContext.actorId,
      actorRole,
      timestamp: nowIso,
      previousPolicyVersion: existing ? existing.policyVersion : '0.0.0',
      newPolicyVersion: candidateConfig.policyVersion,
      changedFields: diff.changedFields,
      changeSummary: input.changeReason?.trim() || diff.summary,
      changeSource,
      isSystemDefault,
      impactSummary: diff.impactSummary,
    });

    const updatedRecord: UserPolicyRecord = Object.freeze({
      userId: normalizedUserId,
      policyVersion: candidateConfig.policyVersion,
      schemaVersion: candidateConfig.schemaVersion,
      updatedAt: nowIso,
      updatedBy: authContext.actorId,
      config: Object.freeze({
        ...candidateConfig,
        updatedAt: nowIso,
      }),
      isSystemDefault,
    });

    // 6. Save Atomically
    const saved = await this.policyRepository.savePolicy(
      updatedRecord,
      input.expectedPolicyVersion ?? existing?.policyVersion
    );
    await this.policyRepository.recordAudit(auditRecord);

    return saved;
  }

  /**
   * Retrieves non-sensitive audit history for a user's policy.
   * Accessible exclusively to the target ward.
   */
  public async getPolicyAuditHistory(
    authContext: AuthContext,
    targetUserId: string,
    limit: number = 50
  ): Promise<readonly PolicyAuditRecord[]> {
    if (!authContext || !authContext.isAuthenticated) {
      throw new UnauthenticatedError();
    }
    const normalizedUserId = targetUserId?.trim();

    // Wards alone may inspect their policy audit history
    if (authContext.actorId !== normalizedUserId || authContext.role !== ActorRole.USER) {
      if (authContext.role === ActorRole.TRUSTED_CONTACT) {
        throw new PolicyAdministrationDeniedError(
          'Trusted contacts hold zero policy administration authority and cannot inspect policy audit history.'
        );
      }
      throw new PolicyAccessDeniedError();
    }

    return this.policyRepository.getAuditHistory(normalizedUserId, limit);
  }

  /**
   * Resets a user's policy configuration to the canonical safe default.
   */
  public async resetPolicyToDefaults(
    authContext: AuthContext,
    targetUserId: string
  ): Promise<UserPolicyRecord> {
    const existing = await this.policyRepository.getPolicy(targetUserId.trim());
    let defaultVersion = '1.0.1';
    if (existing?.policyVersion) {
      const parts = existing.policyVersion.split('.');
      if (parts.length >= 3 && !isNaN(Number(parts[2]))) {
        defaultVersion = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
      } else {
        defaultVersion = `${existing.policyVersion}.1`;
      }
    }
    const resetConfig: GuardrailPolicyConfig = {
      ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
      policyVersion: defaultVersion,
      updatedAt: this.timeProvider().toISOString(),
    };
    return this.updateUserPolicy(authContext, targetUserId, {
      config: resetConfig,
      changeReason: 'Reset to canonical default protection settings.',
      changeSource: 'SYSTEM_RESET',
      isSystemDefault: true,
    });
  }

  /**
   * Internal helper to retrieve or initialize a policy record.
   */
  private async getOrCreatePolicyRecord(userId: string): Promise<UserPolicyRecord> {
    const existing = await this.policyRepository.getPolicy(userId);
    if (existing) {
      return existing;
    }
    return Object.freeze({
      userId,
      policyVersion: CURRENT_ARCHITECTURE_POLICY_VERSION,
      schemaVersion: CURRENT_ARCHITECTURE_SCHEMA_VERSION,
      updatedAt: generateTimestamp(),
      updatedBy: 'SYSTEM',
      config: DEFAULT_GUARDRAIL_POLICY_CONFIG,
      isSystemDefault: true,
    });
  }
}
