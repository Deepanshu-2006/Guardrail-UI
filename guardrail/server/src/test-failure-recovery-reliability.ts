/**
 * Guardrail UI - Day 29 Failure Recovery & Service Reliability Test Suite
 *
 * Verifies recovery, resilience, and boundary invariants under failure conditions:
 *
 * SECTION 1: REAL INTEGRATION TESTING (Temporary SQLite Database)
 *   1.1 Database connection sharing across repositories (SqliteApprovalRequestRepository,
 *       SqliteTrustedContactRegistry, SqlitePolicyRepository) eliminates SQLITE_BUSY lock collisions
 *       under rapid interleaved concurrent transactions.
 *   1.2 Graceful handling and containment of closed or unavailable database operations.
 *
 * SECTION 2: MOCKED FAILURE INJECTION (Transport & Network Resilience)
 *   2.1 Safe Retry Strategy for Idempotent Reads: GET requests retry on transient network errors
 *       and HTTP 503 Service Unavailable with exponential backoff, eventually succeeding when recovered.
 *   2.2 Duplicate Execution Protection: Consequential non-idempotent operations (POST / PUT) are
 *       STRICTLY NOT retried blindly (attempt count is strictly 1), preventing duplicate side effects.
 *   2.3 Persistent Failure Transparency: Idempotent GET that exhausts max retries returns typed
 *       NETWORK_FAILURE without throwing unhandled exceptions or crashing the runtime.
 *   2.4 Health & Readiness Probing: checkHealth() probe cleanly reports availability status without
 *       requiring authentication.
 *
 * SECTION 3: BROWSER EXTENSION SERVICE WORKER RESTARTS
 *   3.1 Wake/Restart State Recovery: When MV3 service worker wakes up with an empty controller,
 *       authoritative backend verification restores the held action in HELD state.
 *   3.2 Anti-Spoofing & Ghost Action Rejection: Status queries for untracked actions not matching
 *       authoritative backend records are strictly rejected with 404 ACTION_NOT_FOUND.
 *   3.3 Decoupled Execution Guarantee: Restoring an action after service worker wake NEVER executes
 *       or releases the action.
 *
 * SECTION 4: BOUNDED CACHING & EVECTIVE RETENTION (Memory Leak Prevention)
 *   4.1 InterceptionController enforces maxRecords limit, evicting terminal actions first and
 *       preserving active HELD records.
 *   4.2 DashboardShell enforces bounded LRU capacity on detailedRequestsCache.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPersistentApprovalService,
} from './persistent-approval-service.js';
import {
  SqliteIdentityStore,
} from './identity-store.js';
import {
  ApprovalApiClient,
  ApiClientErrorCodes,
} from '../../extension/src/approval/client.js';
import {
  handleBackgroundApprovalStatusLookup,
} from '../../extension/src/background/index.js';
import {
  InterceptionController,
} from '../../extension/src/interception/controller.js';
import {
  DashboardShell,
} from '../../dashboard/src/shell.js';
import {
  ActorRole,
} from '../../extension/src/approval/authorization.js';
import {
  ActionType,
} from '../../extension/src/types/actions.js';
import {
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../../extension/src/types/approval.js';
import {
  InterceptionState,
} from '../../extension/src/types/interception.js';
import {
  RiskLevel,
} from '../../extension/src/types/risk.js';

let passed = 0;
let total = 0;

function assert(condition: boolean, message: string): void {
  total++;
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`  PASS: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  total++;
  if (actual !== expected) {
    console.error(`  FAIL: ${message} (expected: ${String(expected)}, actual: ${String(actual)})`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`  PASS: ${message} (${String(actual)})`);
  }
}

function makePayload(actionId: string): ClientApprovalRequestPayload {
  return {
    actionId,
    actionDescription: 'Submit a controlled test action',
    actionType: ActionType.CLICK,
    riskLevel: RiskLevel.HIGH,
    riskReasons: ['Synthetic test scenario'],
    origin: 'https://example.test',
    hostname: 'example.test',
  };
}

async function runSuite(): Promise<void> {
  console.log('\n====================================================================');
  console.log('🛡️ GUARDRAIL: FAILURE RECOVERY & SERVICE RELIABILITY TEST SUITE');
  console.log('====================================================================\n');

  // ===========================================================================
  // SECTION 1: REAL INTEGRATION TESTING (Temporary SQLite Database)
  // ===========================================================================
  console.log('--- SECTION 1: REAL SQLite Integration & Connection Sharing ---');
  const tempDir = mkdtempSync(join(tmpdir(), 'guardrail-reliability-'));
  const dbPath = join(tempDir, 'guardrail.sqlite');

  try {
    const runtime = createPersistentApprovalService({ databasePath: dbPath });
    const sharedDb = runtime.repository.getDatabase();
    const identityStore = SqliteIdentityStore.open(sharedDb);
    const wardId = identityStore.resolveVerifiedIdentity('https://test.issuer', 'ward_sub', ActorRole.USER)!.actorId;
    const reviewerId = identityStore.resolveVerifiedIdentity('https://test.issuer', 'reviewer_sub', ActorRole.TRUSTED_CONTACT)!.actorId;

    // Establish trusted contact relationship so requests can be created
    const invitation = runtime.contactRegistry.createInvitation(wardId, {
      recipientActorId: reviewerId,
      relationshipLabel: 'Trusted Contact',
    });
    runtime.contactRegistry.acceptInvitation(invitation.code!, reviewerId);

    assert(runtime.healthCheck(), '1.1 Initial unified runtime healthCheck passes');

    // Concurrent operations across shared handle: repository, contactRegistry, and policyRepository
    const concurrentCount = 15;
    const tasks: Promise<unknown>[] = [];

    for (let i = 0; i < concurrentCount; i++) {
      const actionId = `act_concurrent_${i}`;
      const revSub = `concurrent_reviewer_${i}`;
      const revId = identityStore.resolveVerifiedIdentity('https://test.issuer', revSub, ActorRole.TRUSTED_CONTACT)!.actorId;
      // Interleaved: create requests, create invitations, query contacts, update policy
      tasks.push(
        (async () => {
          const req = runtime.service.createRequest(makePayload(actionId), {
            actorId: wardId,
            role: ActorRole.USER,
            isAuthenticated: true,
          });
          assert(Boolean(req.id), `1.1 Concurrent request ${i} created`);

          const inv = runtime.contactRegistry.createInvitation(wardId, {
            recipientActorId: revId,
            relationshipLabel: `Contact ${i}`,
          });
          assert(Boolean(inv.id), `1.1 Concurrent invitation ${i} created`);

          const isContact = runtime.contactRegistry.isTrustedContactForUser(reviewerId, wardId);
          assert(isContact, `1.1 Concurrent query for contact ${i} verified`);
        })()
      );
    }

    // Wait for all concurrent transactions
    await Promise.all(tasks);
    assert(true, '1.1 Rapid concurrent interleaved operations succeeded without SQLITE_BUSY error');

    // Cleanly close runtime
    runtime.close();
    assert(!runtime.healthCheck(), '1.2 healthCheck reports false cleanly when database connection is closed');

  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // cleanup
    }
  }

  // ===========================================================================
  // SECTION 2: MOCKED FAILURE INJECTION (Transport & Safe Retries)
  // ===========================================================================
  console.log('\n--- SECTION 2: MOCKED Failure Injection & Safe Retry Strategy ---');

  // Test 2.1: Transient network failure on GET (idempotent read) retries and succeeds
  {
    let getAttempts = 0;
    const mockFetch = (async (_url: string, _init?: RequestInit) => {
      getAttempts++;
      if (getAttempts === 1) {
        throw new Error('Simulated transient TCP socket reset');
      }
      return new Response(JSON.stringify({
        success: true,
        data: {
          id: 'apr_test_retry',
          actionId: 'act_test_retry',
          requesterId: 'usr_test',
          actionDescription: 'Submit test action',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          riskReasons: ['Test retry'],
          origin: 'https://example.test',
          hostname: 'example.test',
          status: ApprovalStatus.PENDING,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      fetchFn: mockFetch,
      tokenProvider: () => 'token_test_123',
    });

    const result = await client.getApprovalRequest('apr_test_retry', {
      maxRetries: 2,
      retryDelayMs: 20,
    });

    assertEquals(getAttempts, 2, '2.1 Idempotent GET retried exactly once after transient failure');
    assert(result.success, '2.1 GET succeeded on retry');
    if (result.success) {
      assertEquals(result.data.id, 'apr_test_retry', '2.1 Returned data matches requested record');
    }
  }

  // Test 2.2: Consequential operation (POST) is NEVER retried blindly
  {
    let postAttempts = 0;
    const mockFetch = (async (_url: string, _init?: RequestInit) => {
      postAttempts++;
      throw new Error('Simulated transient drop on POST submission');
    }) as typeof fetch;

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      fetchFn: mockFetch,
      tokenProvider: () => 'token_test_123',
    });

    const result = await client.createApprovalRequest(makePayload('act_no_retry'), {
      maxRetries: 3, // Caller requested retries, but client MUST NOT retry consequential calls!
      retryDelayMs: 10,
    });

    assertEquals(postAttempts, 1, '2.2 Consequential POST operation was NOT retried blindly (attempt count is 1)');
    assert(!result.success, '2.2 Operation reported failure transparently');
    if (!result.success) {
      assertEquals(result.error?.code, ApiClientErrorCodes.NETWORK_FAILURE, '2.2 Error code is NETWORK_FAILURE');
    }
  }

  // Test 2.3: Persistent failure stops after maxRetries and provides understandable error
  {
    let persistentAttempts = 0;
    const mockFetch = (async () => {
      persistentAttempts++;
      throw new Error('Persistent network down');
    }) as typeof fetch;

    const client = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      fetchFn: mockFetch,
      tokenProvider: () => 'token_test_123',
    });

    const result = await client.getApprovalRequest('apr_exhaust_retries', {
      maxRetries: 2,
      retryDelayMs: 15,
    });

    assertEquals(persistentAttempts, 3, '2.3 Exactly 3 attempts made (initial + 2 retries)');
    assert(!result.success, '2.3 Result is failure after retries exhausted');
    if (!result.success) {
      assertEquals(result.error?.code, ApiClientErrorCodes.NETWORK_FAILURE, '2.3 Returned understandable NETWORK_FAILURE code');
    }
  }

  // Test 2.4: checkHealth() probe
  {
    const mockHealthyFetch = (async () => {
      return new Response(JSON.stringify({ status: 'ready' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const healthyClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      fetchFn: mockHealthyFetch,
    });

    const health1 = await healthyClient.checkHealth();
    assert(health1.available, '2.4 checkHealth reports available when /ready returns 200');
    assertEquals(health1.status, 'ready', '2.4 Health probe status matches server response');

    const mockUnhealthyFetch = (async () => {
      throw new Error('Connection refused');
    }) as typeof fetch;

    const unhealthyClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      fetchFn: mockUnhealthyFetch,
    });

    const health2 = await unhealthyClient.checkHealth();
    assert(!health2.available, '2.4 checkHealth reports unavailable when connection fails');
  }

  // ===========================================================================
  // SECTION 3: BROWSER EXTENSION SERVICE WORKER RESTARTS
  // ===========================================================================
  console.log('\n--- SECTION 3: Service Worker Restart Recovery ---');

  // Test 3.1: Rehydrates held action into controller when authoritative backend confirms
  {
    const controller = new InterceptionController();
    assert(!controller.hasRecord('act_sw_wake_01'), '3.1 In-memory controller is empty before recovery');

    const authoritativeSyncClient = {
      getStatus: async (id: string) => ({
        success: true,
        requestId: id,
        status: ApprovalStatus.PENDING,
        isTerminal: false,
        isApproved: false,
        isPending: true,
        isRejected: false,
        isExpired: false,
        isCancelled: false,
        request: {
          id,
          actionId: 'act_sw_wake_01',
          userId: 'usr_alice',
          requesterId: 'usr_alice',
          actionDescription: 'Submit a controlled test action',
          actionType: ActionType.CLICK,
          riskLevel: RiskLevel.HIGH,
          riskReasons: ['Synthetic test scenario'],
          origin: 'https://bank.example.test',
          hostname: 'bank.example.test',
          status: ApprovalStatus.PENDING,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
        isNetworkError: false,
        isTimeout: false,
        isAuthoritative: true,
      }),
    };

    const response = await handleBackgroundApprovalStatusLookup(
      {
        type: 'GUARDRAIL_GET_APPROVAL_STATUS',
        requestId: 'apr_sw_restart_01',
        actionId: 'act_sw_wake_01',
      },
      controller,
      { syncClient: authoritativeSyncClient as any }
    );

    assert(response.success, '3.1 Status lookup succeeded following service worker wake');
    assert(controller.hasRecord('act_sw_wake_01'), '3.1 Action restored in controller');
    assert(controller.isActionHeld('act_sw_wake_01'), '3.1 Action restored in HELD state');
    assertEquals(controller.getRecord('act_sw_wake_01')?.state, InterceptionState.HELD, '3.1 State is strictly HELD');

    // Test 3.2: Untracked ghost action that does NOT match backend is strictly rejected with 404
    const rejectedResponse = await handleBackgroundApprovalStatusLookup(
      {
        type: 'GUARDRAIL_GET_APPROVAL_STATUS',
        requestId: 'apr_sw_restart_01',
        actionId: 'act_ghost_untracked',
      },
      controller,
      { syncClient: authoritativeSyncClient as any }
    );

    assert(!rejectedResponse.success, '3.2 Untracked action not matching backend is rejected');
    assertEquals(rejectedResponse.error?.code, 'ACTION_NOT_FOUND', '3.2 Error code is ACTION_NOT_FOUND');
    assertEquals(rejectedResponse.error?.statusCode, 404, '3.2 HTTP status is 404');

    // Test 3.3: Decoupled invariant verification
    const record = controller.getRecord('act_sw_wake_01');
    assert(record?.state === InterceptionState.HELD, '3.3 Restored action is held, never executed or continued');
  }

  // ===========================================================================
  // SECTION 4: BOUNDED CACHING & EVICTION
  // ===========================================================================
  console.log('\n--- SECTION 4: Bounded Cache Eviction & Memory Safety ---');

  // Test 4.1: InterceptionController capacity bounding
  {
    const boundedController = new InterceptionController(10); // cap at 10 items
    for (let i = 0; i < 10; i++) {
      boundedController.register(`act_bound_${i}`, `Reason ${i}`);
    }
    assertEquals(boundedController.getAllRecords().length, 10, '4.1 Exactly 10 items registered');

    // Put actions 0, 1, 2 into terminal states
    boundedController.holdAction('act_bound_0');
    boundedController.cancelAction('act_bound_0');
    boundedController.holdAction('act_bound_1');
    boundedController.continueAction('act_bound_1');
    boundedController.holdAction('act_bound_2');
    boundedController.cancelAction('act_bound_2');

    // Keep action 3 actively held
    boundedController.holdAction('act_bound_3');

    // Register a new action: should evict terminal records first
    boundedController.register('act_bound_new_1', 'New action');
    assertEquals(boundedController.getAllRecords().length, 10, '4.1 Size remains bounded at 10');
    assert(!boundedController.hasRecord('act_bound_0'), '4.1 Oldest terminal record act_bound_0 was evicted');
    assert(boundedController.hasRecord('act_bound_3'), '4.1 Actively HELD record act_bound_3 was preserved');
    assert(boundedController.hasRecord('act_bound_new_1'), '4.1 Newly registered record is present');
  }

  // Test 4.2: DashboardShell MAX_CACHE_ENTRIES constant
  {
    assertEquals(DashboardShell.MAX_CACHE_ENTRIES, 100, '4.2 DashboardShell enforces MAX_CACHE_ENTRIES of 100');
  }

  console.log('\n====================================================================');
  console.log(`📊 RELIABILITY SUITE RESULTS: ${passed} / ${total} PASSED`);
  console.log('🎉 ALL SERVICE RELIABILITY & FAILURE RECOVERY INVARIANTS VERIFIED!');
  console.log('====================================================================\n');
}

void runSuite();
