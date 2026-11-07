/**
 * Guardrail Protection Policy Repository Interface & In-Memory Implementation
 *
 * Defines the storage contract and in-memory test/development implementation
 * for persisting user protection policies, optimistic version concurrency, and
 * non-sensitive policy audit history.
 */

import {
  PolicyAuditRecord,
  PolicyVersionConflictError,
  UserPolicyRecord,
} from './policy-permissions.js';

export interface PolicyRepository {
  /**
   * Retrieves the active policy record for a user.
   * Returns undefined if no custom policy has been saved.
   */
  getPolicy(userId: string): Promise<UserPolicyRecord | undefined>;

  /**
   * Saves or updates a user's policy record.
   * If expectedVersion is specified, verifies that the existing record matches
   * that version before writing; otherwise throws PolicyVersionConflictError.
   */
  savePolicy(
    record: UserPolicyRecord,
    expectedVersion?: string
  ): Promise<UserPolicyRecord>;

  /**
   * Retrieves non-sensitive audit history for a user's policy changes.
   */
  getAuditHistory(
    userId: string,
    limit?: number
  ): Promise<readonly PolicyAuditRecord[]>;

  /**
   * Records a non-sensitive policy audit log entry.
   */
  recordAudit(audit: PolicyAuditRecord): Promise<void>;

  /**
   * Verifies health of the storage medium.
   */
  healthCheck(): boolean;
}

/**
 * Minimal in-memory repository for unit testing and ephemeral development.
 */
export class InMemoryPolicyRepository implements PolicyRepository {
  private readonly policies: Map<string, UserPolicyRecord> = new Map();
  private readonly auditLogs: Map<string, PolicyAuditRecord[]> = new Map();

  public async getPolicy(userId: string): Promise<UserPolicyRecord | undefined> {
    const existing = this.policies.get(userId);
    return existing ? Object.freeze({ ...existing }) : undefined;
  }

  public async savePolicy(
    record: UserPolicyRecord,
    expectedVersion?: string
  ): Promise<UserPolicyRecord> {
    const existing = this.policies.get(record.userId);
    const activeVersion = existing ? existing.policyVersion : '1.0.0';

    if (expectedVersion !== undefined) {
      if (expectedVersion !== activeVersion && expectedVersion !== '0.0.0') {
        throw new PolicyVersionConflictError(
          expectedVersion,
          existing ? existing.policyVersion : '1.0.0'
        );
      }
    }

    const frozen = Object.freeze({ ...record });
    this.policies.set(record.userId, frozen);
    return frozen;
  }

  public async getAuditHistory(
    userId: string,
    limit: number = 50
  ): Promise<readonly PolicyAuditRecord[]> {
    const logs = this.auditLogs.get(userId) ?? [];
    // Sort descending by timestamp
    const sorted = [...logs].sort(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
    );
    return Object.freeze(sorted.slice(0, Math.max(1, limit)));
  }

  public async recordAudit(audit: PolicyAuditRecord): Promise<void> {
    const list = this.auditLogs.get(audit.userId) ?? [];
    list.push(Object.freeze({ ...audit }));
    this.auditLogs.set(audit.userId, list);
  }

  public healthCheck(): boolean {
    return true;
  }

  public clear(): void {
    this.policies.clear();
    this.auditLogs.clear();
  }
}
