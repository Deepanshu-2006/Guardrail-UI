/**
 * SQLite Policy Repository Persistence & Concurrency Verification Suite
 *
 * Verifies:
 * 1. Persistent storage of user policies in SQLite.
 * 2. Optimistic concurrency control (OCC) and version conflict rejection.
 * 3. Non-sensitive policy audit trail persistence and reverse-chronological retrieval.
 * 4. Healthcheck and error resilience.
 */

import { SqlitePolicyRepository } from './sqlite-policy-repository.js';
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
} from '../../extension/src/config/schema.js';
import {
  PolicyAuditRecord,
  PolicyVersionConflictError,
  UserPolicyRecord,
} from '../../extension/src/approval/policy-permissions.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runSqlitePolicyRepoTests(): Promise<void> {
  console.log('\n=== Starting SQLite Policy Repository Verification Suite ===\n');

  const repo = SqlitePolicyRepository.open(':memory:');
  assert(repo.healthCheck() === true, 'SqlitePolicyRepository healthCheck passes');

  // Test 1: Get non-existent policy returns undefined
  const nonExistent = await repo.getPolicy('usr_non_existent');
  assert(nonExistent === undefined, 'Non-existent policy returns undefined');

  // Test 2: Initial policy save with default expectedVersion '1.0.0'
  const record1: UserPolicyRecord = {
    userId: 'usr_alice',
    policyVersion: '1.1.0',
    schemaVersion: '1.0.0',
    updatedAt: new Date().toISOString(),
    updatedBy: 'usr_alice',
    config: {
      ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
      policyVersion: '1.1.0',
      thresholds: { lowMax: 20, mediumMax: 45, highMax: 70 },
    },
  };

  const saved1 = await repo.savePolicy(record1, '1.0.0');
  assert(saved1.policyVersion === '1.1.0', 'Initial policy saved successfully with expectedVersion 1.0.0');

  // Verify retrieval
  const retrieved1 = await repo.getPolicy('usr_alice');
  assert(retrieved1 !== undefined, 'Retrieved policy exists');
  assert(retrieved1!.policyVersion === '1.1.0', 'Retrieved policy version is 1.1.0');
  assert(retrieved1!.config.thresholds.lowMax === 20, 'Retrieved threshold lowMax matches 20');

  // Test 3: Concurrency conflict on stale update
  const staleRecord: UserPolicyRecord = {
    ...record1,
    policyVersion: '1.2.0',
    config: { ...record1.config, policyVersion: '1.2.0' },
  };

  let threwConflict = false;
  try {
    await repo.savePolicy(staleRecord, '1.0.0'); // Active is 1.1.0!
  } catch (err) {
    if (err instanceof PolicyVersionConflictError) {
      threwConflict = true;
    }
  }
  assert(threwConflict === true, 'Saving with stale expectedVersion 1.0.0 threw PolicyVersionConflictError');

  // Test 4: Successful update with matching expectedVersion 1.1.0
  const record2: UserPolicyRecord = {
    userId: 'usr_alice',
    policyVersion: '1.2.0',
    schemaVersion: '1.0.0',
    updatedAt: new Date().toISOString(),
    updatedBy: 'usr_alice',
    config: {
      ...record1.config,
      policyVersion: '1.2.0',
      thresholds: { lowMax: 15, mediumMax: 35, highMax: 60 },
    },
  };

  const saved2 = await repo.savePolicy(record2, '1.1.0');
  assert(saved2.policyVersion === '1.2.0', 'Second update with expectedVersion 1.1.0 succeeded');

  const retrieved2 = await repo.getPolicy('usr_alice');
  assert(retrieved2!.policyVersion === '1.2.0', 'Policy version is now 1.2.0 in SQLite');
  assert(retrieved2!.config.thresholds.lowMax === 15, 'Updated threshold is 15 in SQLite');

  // Test 5: Audit Trail Persistence & Reverse-Chronological Retrieval
  const audit1: PolicyAuditRecord = {
    id: 'aud_1',
    userId: 'usr_alice',
    updatedBy: 'usr_alice',
    timestamp: '2026-11-07T10:00:00.000Z',
    previousPolicyVersion: '1.0.0',
    newPolicyVersion: '1.1.0',
    changedFields: ['thresholds.lowMax', 'thresholds.mediumMax'],
    changeSummary: 'First change',
  };

  const audit2: PolicyAuditRecord = {
    id: 'aud_2',
    userId: 'usr_alice',
    updatedBy: 'usr_alice',
    timestamp: '2026-11-07T11:00:00.000Z',
    previousPolicyVersion: '1.1.0',
    newPolicyVersion: '1.2.0',
    changedFields: ['thresholds.lowMax'],
    changeSummary: 'Second change',
  };

  await repo.recordAudit(audit1);
  await repo.recordAudit(audit2);

  const history = await repo.getAuditHistory('usr_alice');
  assert(history.length === 2, 'Audit history contains 2 records');
  assert(history[0].id === 'aud_2', 'First history item is the latest (reverse-chronological)');
  assert(history[0].newPolicyVersion === '1.2.0', 'Latest audit record has newPolicyVersion 1.2.0');
  assert(history[1].id === 'aud_1', 'Second history item is aud_1');

  // Verify limit parameter
  const limitedHistory = await repo.getAuditHistory('usr_alice', 1);
  assert(limitedHistory.length === 1, 'Limit parameter limits returned records');
  assert(limitedHistory[0].id === 'aud_2', 'Limited record is the newest');

  repo.close();
  console.log('\n======================================================================');
  console.log('Results: All SQLite Policy Repository assertions PASSED cleanly!');
  console.log('======================================================================\n');
}

runSqlitePolicyRepoTests().catch((err) => {
  console.error('\n❌ SQLite policy repo tests failed with error:\n', err);
  process.exit(1);
});
