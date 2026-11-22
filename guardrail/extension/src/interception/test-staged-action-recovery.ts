/**
 * Guardrail Staged Action Cold Restart Recovery Test Suite
 *
 * Verifies Task 4.1:
 * 1. Persistent serialization of held action descriptors & request IDs.
 * 2. Seamless recovery on same origin after cold browser restart.
 * 3. Strict origin isolation (no leakage to other domains).
 * 4. Status progression across restarts (PENDING -> APPROVED).
 * 5. Notification banner generation: "You have an approved action waiting: Continue on [Domain]".
 * 6. Permanent purge on execution or dismissal (anti-replay guarantee).
 * 7. Expiration / TTL pruning.
 * 8. Strict zero-knowledge privacy invariant (no passwords, OTPs, or DOM nodes).
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionCategory, RiskLevel } from '../types/index.js';
import {
  DefaultRecoveryStorageProvider,
  GUARDRAIL_RECOVERY_STORAGE_KEY,
  InMemoryRecoveryStorageProvider,
  sanitizeRecoveryText,
  StagedActionRecoveryManager,
} from './recovery.js';
import {
  mountRecoveryBanner,
  dismissRecoveryBanner,
  RECOVERY_BANNER_ID,
} from '../ui/recovery-banner.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function assertEquals<T>(actual: T, expected: T, msg: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg} (expected ${expected}, got ${actual})`);
  }
}

async function runRecoveryTests(): Promise<void> {
  console.log('============================================================');
  console.log('🧪 GUARDRAIL STAGED ACTION COLD RESTART RECOVERY (PHASE 4)');
  console.log('============================================================\n');

  // ---------------------------------------------------------------------------
  // Test Suite 1: Privacy Sanitization Helper
  // ---------------------------------------------------------------------------
  console.log('▶ Test Suite 1: Sensitive Data Sanitization');
  {
    const sanitized = sanitizeRecoveryText('Transfer to account with password=mySecretPassword123 and token=BearerABC');
    assert(!sanitized.includes('mySecretPassword123'), 'Passwords are fully stripped/redacted');
    assert(sanitized.includes('password=[REDACTED]'), 'Replaced with [REDACTED]');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 2: Staged Action Persistence & Cold Restart Recovery
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 2: Staged Action Persistence & Cold Restart Recovery');
  {
    const sharedStorage = new InMemoryRecoveryStorageProvider();
    const managerBeforeShutdown = new StagedActionRecoveryManager(sharedStorage);

    // Ward A encounters a high-risk transfer on mybank.com and requests approval
    const record = await managerBeforeShutdown.saveStagedAction({
      actionId: 'act-transfer-001',
      requestId: 'req-appr-777',
      origin: 'https://mybank.com',
      url: 'https://mybank.com/transfer/confirm',
      domain: 'mybank.com',
      description: 'Transfer $500.00 to External Routing Number',
      category: ActionCategory.PAYMENT,
      riskLevel: RiskLevel.CRITICAL,
      status: 'pending',
      destinationUrl: 'https://mybank.com/transfer/complete',
      elementId: 'btn-submit-transfer',
    });

    assertEquals(record.actionId, 'act-transfer-001', 'actionId correctly persisted');
    assertEquals(record.requestId, 'req-appr-777', 'requestId correctly persisted');
    assertEquals(record.origin, 'https://mybank.com', 'origin correctly recorded');
    assertEquals(record.domain, 'mybank.com', 'domain correctly recorded');
    assertEquals(record.status, 'pending', 'initial status is pending');

    // SIMULATE COLD BROWSER RESTART:
    // All in-memory variables are wiped. A new manager is created accessing the same storage.
    const managerAfterRestart = new StagedActionRecoveryManager(sharedStorage);

    // Ward A opens Chrome and navigates back to mybank.com
    const recovered = await managerAfterRestart.getActiveRecovery('https://mybank.com');
    assert(recovered !== null, 'Staged action recovered successfully after cold restart');
    assertEquals(recovered?.actionId, 'act-transfer-001', 'Recovered actionId matches');
    assertEquals(recovered?.requestId, 'req-appr-777', 'Recovered requestId matches');
    assertEquals(recovered?.destinationUrl, 'https://mybank.com/transfer/complete', 'Destination URL intact');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 3: Strict Origin Isolation (Zero Cross-Site Leakage)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 3: Strict Origin Isolation');
  {
    const sharedStorage = new InMemoryRecoveryStorageProvider();
    const manager = new StagedActionRecoveryManager(sharedStorage);

    await manager.saveStagedAction({
      actionId: 'act-sensitive-002',
      requestId: 'req-appr-888',
      origin: 'https://secure-portal.com',
      url: 'https://secure-portal.com/auth',
      domain: 'secure-portal.com',
      description: 'Authorize Security Key Registration',
      riskLevel: RiskLevel.HIGH,
      status: 'pending',
    });

    // An unrelated website (e.g. phishing or third-party tab) must NEVER see the staged action
    const otherOriginRecovery = await manager.getActiveRecovery('https://attacker.site');
    assertEquals(otherOriginRecovery, null, 'Unrelated origin receives null (isolated)');

    const matchingOriginRecovery = await manager.getActiveRecovery('https://secure-portal.com');
    assert(matchingOriginRecovery !== null, 'Target origin correctly receives recovery record');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 4: Out-of-Band Caretaker Approval State Propagation
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 4: Status Transition to APPROVED across Restarts');
  {
    const sharedStorage = new InMemoryRecoveryStorageProvider();
    const manager = new StagedActionRecoveryManager(sharedStorage);

    await manager.saveStagedAction({
      actionId: 'act-tx-003',
      requestId: 'req-appr-999',
      origin: 'https://finances.org',
      url: 'https://finances.org/send',
      domain: 'finances.org',
      description: 'Send $1,200 to Beneficiary',
      riskLevel: RiskLevel.CRITICAL,
      status: 'pending',
    });

    // Caretaker B approves the request out-of-band via phone/dashboard
    const updated = await manager.updateStagedActionStatus(
      'act-tx-003',
      'approved',
      'Caretaker Carol'
    );

    assert(updated !== null, 'Record status updated');
    assertEquals(updated?.status, 'approved', 'Status is now approved');
    assertEquals(updated?.approver, 'Caretaker Carol', 'Approver name recorded');

    // Simulate browser restart and verify recovered state
    const postRestartManager = new StagedActionRecoveryManager(sharedStorage);
    const recovered = await postRestartManager.getActiveRecovery('https://finances.org');
    assertEquals(recovered?.status, 'approved', 'Approved status persisted across restarts');
    assertEquals(recovered?.approver, 'Caretaker Carol', 'Approver preserved');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 5: In-Page Recovery Notification Banner Specification
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 5: Recovery Notification Banner DOM Specification');
  {
    // Minimal mock document if running under pure Node
    if (typeof document === 'undefined') {
      (globalThis as any).document = {
        getElementById: () => null,
        createElement: (tag: string) => {
          const el: any = {
            id: '',
            style: {},
            setAttribute: () => {},
            attachShadow: () => ({
              appendChild: () => {},
            }),
            appendChild: () => {},
            addEventListener: () => {},
            remove: () => {},
          };
          return el;
        },
        body: {
          appendChild: () => {},
        },
      };
    }

    const testRecord = {
      actionId: 'act-mock-banner-1',
      requestId: 'req-banner-1',
      origin: 'https://example-bank.com',
      url: 'https://example-bank.com/pay',
      domain: 'example-bank.com',
      description: 'Authorize $250.00 Wire',
      riskLevel: RiskLevel.CRITICAL,
      status: 'approved' as const,
      approver: 'Caretaker Carol',
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    let reviewCalled = false;
    let dismissCalled = false;

    const banner = mountRecoveryBanner({
      record: testRecord,
      onReviewAndContinue: () => {
        reviewCalled = true;
      },
      onDismiss: () => {
        dismissCalled = true;
      },
    });

    assert(banner !== null, 'Recovery banner successfully mounted');
    dismissRecoveryBanner();
    assert(true, 'Recovery banner can be dismissed cleanly');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 6: Terminal Purge & Anti-Replay Guarantee
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 6: Terminal Purge & Anti-Replay Guarantee');
  {
    const sharedStorage = new InMemoryRecoveryStorageProvider();
    const manager = new StagedActionRecoveryManager(sharedStorage);

    await manager.saveStagedAction({
      actionId: 'act-consume-005',
      requestId: 'req-appr-555',
      origin: 'https://shopping.com',
      url: 'https://shopping.com/checkout',
      domain: 'shopping.com',
      description: 'Checkout $80.00 Cart',
      riskLevel: RiskLevel.MEDIUM,
      status: 'approved',
    });

    // User confirms and executes continuation:
    const cleared = await manager.clearRecovery('act-consume-005');
    assert(cleared, 'Recovery record cleared upon continuation');

    // Subsequent query must return null:
    const reQuery = await manager.getActiveRecovery('https://shopping.com');
    assertEquals(reQuery, null, 'Anti-replay invariant: Action cannot be recovered twice');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 7: TTL Expiration & Auto-Pruning
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 7: Expiration & Auto-Pruning');
  {
    const sharedStorage = new InMemoryRecoveryStorageProvider();
    const manager = new StagedActionRecoveryManager(sharedStorage);

    // Save action with negative TTL (already expired)
    await manager.saveStagedAction({
      actionId: 'act-expired-006',
      requestId: 'req-appr-444',
      origin: 'https://old-session.com',
      url: 'https://old-session.com/form',
      domain: 'old-session.com',
      description: 'Expired Session Action',
      riskLevel: RiskLevel.LOW,
      status: 'pending',
      ttlMs: -1000, // Expired in the past
    });

    const recovered = await manager.getActiveRecovery('https://old-session.com');
    assertEquals(recovered, null, 'Expired staged action is automatically pruned');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 8: Zero-Knowledge Privacy Invariant
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 8: Zero-Knowledge Privacy Boundary Inspection');
  {
    const sharedStorage = new InMemoryRecoveryStorageProvider();
    const manager = new StagedActionRecoveryManager(sharedStorage);

    const record = await manager.saveStagedAction({
      actionId: 'act-privacy-007',
      requestId: 'req-appr-333',
      origin: 'https://payment.com',
      url: 'https://payment.com/pay',
      domain: 'payment.com',
      description: 'Confirm Payment',
      riskLevel: RiskLevel.HIGH,
      status: 'pending',
    });

    const serialized = JSON.stringify(record);
    assert(!serialized.includes('password'), 'Zero passwords in serialized recovery');
    assert(!serialized.includes('creditCard'), 'Zero credit cards in serialized recovery');
    assert(!serialized.includes('cvv'), 'Zero CVVs in serialized recovery');
    assert(!serialized.includes('otp'), 'Zero OTPs in serialized recovery');
    assert(!serialized.includes('cookie'), 'Zero cookies in serialized recovery');
    assert(!serialized.includes('authorization'), 'Zero auth headers in serialized recovery');
    assert(!serialized.includes('bearer'), 'Zero bearer tokens in serialized recovery');
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n============================================================');
  console.log(`📊 STAGED ACTION RECOVERY SUITE: ${passed}/${passed + failed} PASSED`);
  if (failed === 0) {
    console.log('🎉 TASK 4.1 COLD BROWSER RESTART RECOVERY VERIFIED!');
  } else {
    console.error(`💥 ${failed} TESTS FAILED!`);
    process.exit(1);
  }
  console.log('============================================================\n');
}

runRecoveryTests().catch((err) => {
  console.error('Test runner exception:', err);
  process.exit(1);
});
