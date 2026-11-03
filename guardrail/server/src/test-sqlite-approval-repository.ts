import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  ActorRole,
  AuthContext,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from '../../extension/src/approval/authorization.js';
import { ApprovalAccessDeniedError } from '../../extension/src/approval/authorization.js';
import { ApprovalApiRouter, InMemoryTokenVerifier } from '../../extension/src/approval/api.js';
import { resolveApprovalRequest } from '../../extension/src/approval/model.js';
import { transitionBindingState } from '../../extension/src/approval/binding.js';
import { ActionType } from '../../extension/src/types/actions.js';
import { ApprovalActionBindingState, ApprovalStatus } from '../../extension/src/types/approval.js';
import { RiskLevel } from '../../extension/src/types/risk.js';
import {
  ApprovalDatabaseRecordError,
  ApprovalDatabaseUnavailableError,
  SqliteApprovalRequestRepository,
} from './sqlite-approval-request-repository.js';
import { createPersistentApprovalService } from './persistent-approval-service.js';

const now = new Date();
const createdAt = now.toISOString();
const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
const auth: AuthContext = {
  actorId: 'usr_pilot_user',
  role: ActorRole.USER,
  isAuthenticated: true,
};
const payload = {
  actionId: 'act_sqlite_persist_01',
  actionDescription: 'Submit a controlled test action',
  actionType: ActionType.CLICK,
  riskLevel: RiskLevel.HIGH,
  riskReasons: ['Synthetic test scenario'],
  origin: 'https://example.test',
  hostname: 'example.test',
};

function openRuntime(databasePath: string, timeProvider: () => string = () => new Date().toISOString()) {
  const contactRegistry = new InMemoryTrustedContactRegistry();
  for (const id of ['tc_synthetic_reviewer', 'tc_synthetic_reviewer_2']) {
    contactRegistry.addContact({
      id,
      userId: auth.actorId,
      status: TrustedContactStatus.ACTIVE,
      createdAt,
    });
  }
  return createPersistentApprovalService({
    databasePath,
    timeProvider,
    contactRegistry,
    actionOwnershipRegistry: new InMemoryActionOwnershipRegistry(),
  });
}

const root = mkdtempSync(join(tmpdir(), 'guardrail-sqlite-'));
const databasePath = join(root, 'approvals.sqlite');
try {
  console.log('SQLite approval persistence tests (real temporary SQLite database)');

  const firstRuntime = openRuntime(databasePath);
  const firstRepository = firstRuntime.repository;
  const firstService = firstRuntime.service;
  const created = firstService.createRequest(payload, auth, {
    id: 'apr_sqlite_persist_01',
    createdAt,
    expiresAt,
  });
  assert.equal(created.status, ApprovalStatus.PENDING);
  assert.equal(firstRepository.count(), 1);
  assert.equal(firstRepository.countBindings(), 1);
  if (process.platform !== 'win32') {
    assert.equal(statSync(databasePath).mode & 0o777, 0o600, 'database file is owner-readable/writable only');
  }
  const originalBinding = firstRepository.findBindingByRequestId(created.id);
  assert.ok(originalBinding);
  assert.equal(originalBinding.actionId, created.actionId);

  const tokenVerifier = new InMemoryTokenVerifier();
  tokenVerifier.registerToken('synthetic-test-token', auth);
  const firstRouter = new ApprovalApiRouter(firstService, tokenVerifier);
  const duplicateCreateResponse = await firstRouter.dispatch({
    method: 'POST',
    url: '/api/v1/approval-requests',
    headers: {
      authorization: 'Bearer synthetic-test-token',
      'content-type': 'application/json',
    },
    body: payload,
  });
  assert.equal(duplicateCreateResponse.statusCode, 200);
  assert.equal(
    (duplicateCreateResponse.body.data as { id: string }).id,
    created.id,
    'existing API router uses the persistent repository and duplicate contract'
  );
  assert.equal(firstRepository.healthCheck(), true);
  firstRuntime.close();
  assert.throws(
    () => firstRepository.healthCheck(),
    ApprovalDatabaseUnavailableError,
    'closed database connections fail explicitly'
  );

  // Simulate a backend process restart: open a new connection and service instance.
  const restartedRuntime = openRuntime(databasePath);
  const reopenedRepository = restartedRuntime.repository;
  const restartedService = restartedRuntime.service;
  const restartedRouter = new ApprovalApiRouter(restartedService, tokenVerifier);
  const getResponse = await restartedRouter.dispatch({
    method: 'GET',
    url: `/api/v1/approval-requests/${created.id}`,
    headers: { authorization: 'Bearer synthetic-test-token' },
  });
  assert.equal(getResponse.statusCode, 200);
  const restored = restartedService.getRequest(created.id, auth);
  assert.deepEqual(
    restored,
    JSON.parse(JSON.stringify(created)),
    'approval is readable after database/service restart'
  );
  assert.equal(reopenedRepository.findByRequesterId(auth.actorId).length, 1);
  assert.equal(reopenedRepository.findByUserAndAction(auth.actorId, payload.actionId)?.id, created.id);

  const otherUser: AuthContext = {
    actorId: 'usr_other_user',
    role: ActorRole.USER,
    isAuthenticated: true,
  };
  assert.throws(
    () => restartedService.getRequest(created.id, otherUser),
    ApprovalAccessDeniedError,
    'persisted requests remain scoped to their requester'
  );

  // Reviewer revocation takes effect immediately for decisions on existing requests.
  const reviewerRevocationTarget = restartedService.createRequest(
    { ...payload, actionId: 'act_sqlite_reviewer_revocation' },
    auth,
    {
      id: 'apr_sqlite_reviewer_revocation',
      createdAt,
      expiresAt,
    },
  );
  restartedService.revokeTrustedContact('tc_synthetic_reviewer_2', auth);
  assert.throws(
    () => restartedService.approveRequest(reviewerRevocationTarget.id, undefined, {
      actorId: 'tc_synthetic_reviewer_2', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true,
    }),
    ApprovalAccessDeniedError,
    'a revoked reviewer cannot decide a previously-created request'
  );
  assert.equal(reopenedRepository.findById(reviewerRevocationTarget.id)?.status, ApprovalStatus.PENDING);

  // Two independent SQLite connections race to decide one request. The database CAS permits one winner.
  const concurrentTarget = restartedService.createRequest(
    { ...payload, actionId: 'act_sqlite_concurrent_decisions' },
    auth,
    { id: 'apr_sqlite_concurrent_decisions', createdAt, expiresAt },
  );
  const competingRuntime = openRuntime(databasePath);
  const reviewerOne: AuthContext = {
    actorId: 'tc_synthetic_reviewer', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true,
  };
  const reviewerTwo: AuthContext = {
    actorId: 'tc_synthetic_reviewer_2', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true,
  };
  const competingResults = await Promise.allSettled([
    Promise.resolve().then(() => restartedService.approveRequest(concurrentTarget.id, undefined, reviewerOne)),
    Promise.resolve().then(() => competingRuntime.service.rejectRequest(concurrentTarget.id, undefined, reviewerTwo)),
  ]);
  assert.equal(competingResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(competingResults.filter((result) => result.status === 'rejected').length, 1);
  const concurrentResult = reopenedRepository.findById(concurrentTarget.id);
  assert.ok(concurrentResult);
  assert.ok([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED].includes(concurrentResult.status));
  assert.equal(
    reopenedRepository.findBindingByRequestId(concurrentTarget.id)?.state,
    concurrentResult.status,
    'request and action binding commit the same winning terminal state'
  );
  competingRuntime.close();

  // Lazy expiry is atomic with its binding, including after the deadline passes.
  let expiryClock = new Date('2026-11-03T00:00:00.000Z');
  const expiryRuntime = openRuntime(join(root, 'expiry.sqlite'), () => expiryClock.toISOString());
  const expiring = expiryRuntime.service.createRequest(
    { ...payload, actionId: 'act_sqlite_expiration' },
    auth,
    {
      id: 'apr_sqlite_expiration',
      createdAt: expiryClock.toISOString(),
      expiresAt: new Date(expiryClock.getTime() + 60_000).toISOString(),
    },
  );
  expiryClock = new Date(expiryClock.getTime() + 60_000);
  assert.equal(expiryRuntime.service.getRequest(expiring.id, auth).status, ApprovalStatus.EXPIRED);
  assert.equal(
    expiryRuntime.repository.findBindingByRequestId(expiring.id)?.state,
    ApprovalActionBindingState.EXPIRED,
    'expiration cannot leave an active action binding behind'
  );
  assert.throws(
    () => expiryRuntime.service.approveRequest(expiring.id, undefined, reviewerOne),
    /already resolved|expired/i,
    'an expired request cannot be revived by a later review attempt'
  );
  expiryRuntime.close();

  const approvedAt = new Date().toISOString();
  const approved = resolveApprovalRequest(
    restored,
    { decision: 'APPROVED', decidedBy: 'tc_synthetic_reviewer', decidedAt: approvedAt },
    () => approvedAt
  );
  const approvedBinding = transitionBindingState(
    originalBinding,
    ApprovalActionBindingState.APPROVED,
    { resolvedAt: approvedAt, timeProvider: () => approvedAt }
  );
  assert.equal(
    reopenedRepository.atomicTransitionRequestAndBinding(
      created.id,
      ApprovalStatus.PENDING,
      approved,
      originalBinding.id,
      ApprovalActionBindingState.BOUND,
      approvedBinding
    ),
    true
  );
  assert.equal(reopenedRepository.atomicTransitionRequestAndBinding(
    created.id,
    ApprovalStatus.PENDING,
    approved,
    originalBinding.id,
    ApprovalActionBindingState.BOUND,
    approvedBinding
  ), false, 'a duplicate status transition is rejected');
  restartedRuntime.close();

  const finalRepository = SqliteApprovalRequestRepository.open(databasePath);
  assert.equal(finalRepository.findById(created.id)?.status, ApprovalStatus.APPROVED);
  const {
    resolvedAt: _resolvedAt,
    decision: _decision,
    cancellationReason: _cancellationReason,
    ...approvedWithoutResolution
  } = approved;
  const attemptedReopen = {
    ...approvedWithoutResolution,
    status: ApprovalStatus.PENDING,
  };
  assert.throws(
    () => finalRepository.atomicTransition(created.id, ApprovalStatus.APPROVED, attemptedReopen),
    /Invalid approval state transition/,
    'terminal approval states cannot transition back to PENDING'
  );
  assert.throws(
    () => finalRepository.save(attemptedReopen),
    /immutable outside an atomic transition/,
    'ordinary persistence writes cannot overwrite an approval decision'
  );
  const approvedBindingRecord = finalRepository.findBindingByRequestId(created.id);
  assert.equal(approvedBindingRecord?.state, ApprovalActionBindingState.APPROVED);
  assert.ok(approvedBindingRecord);
  const { resolvedAt: _bindingResolvedAt, reason: _bindingReason, ...bindingWithoutResolution } = approvedBindingRecord;
  assert.throws(
    () => finalRepository.atomicTransitionBinding(
      approvedBindingRecord.id,
      ApprovalActionBindingState.APPROVED,
      { ...bindingWithoutResolution, state: ApprovalActionBindingState.BOUND },
    ),
    /Invalid binding state transition/,
    'terminal action bindings cannot transition back to BOUND'
  );

  const invalidWrite = { ...approved, password: 'SYNTHETIC_SECRET_SENTINEL' };
  assert.throws(
    () => finalRepository.save(invalidWrite as typeof approved),
    /validation failed/i,
    'schema validator rejects disallowed fields before database write'
  );
  assert.equal(finalRepository.findById(created.id)?.status, ApprovalStatus.APPROVED);
  finalRepository.close();

  // Simulate a corrupt record written outside the repository, then verify it is rejected on read.
  const rawDatabase = new Database(databasePath);
  rawDatabase.prepare('UPDATE approval_requests SET payload_json = ? WHERE id = ?').run(
    JSON.stringify({ ...approved, raw_form_value: 'SYNTHETIC_FORM_SENTINEL' }),
    created.id
  );
  rawDatabase.close();
  const corruptRepository = SqliteApprovalRequestRepository.open(databasePath);
  assert.throws(
    () => corruptRepository.findById(created.id),
    ApprovalDatabaseRecordError,
    'invalid stored rows fail closed instead of being returned'
  );
  corruptRepository.close();

  const blockingFile = join(root, 'not-a-directory');
  writeFileSync(blockingFile, 'synthetic');
  assert.throws(
    () => SqliteApprovalRequestRepository.open(join(blockingFile, 'approvals.sqlite')),
    (error: unknown) => error instanceof ApprovalDatabaseUnavailableError && !error.message.includes(blockingFile),
    'connection failure is reported with a sanitized error'
  );

  console.log('PASS: persistence, ownership, transition validation, reviewer revocation, cross-connection decision race, atomic expiry, invalid records, and database failure');
} finally {
  rmSync(root, { recursive: true, force: true });
}
