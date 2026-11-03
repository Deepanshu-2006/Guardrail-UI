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

function openRuntime(databasePath: string) {
  const contactRegistry = new InMemoryTrustedContactRegistry();
  contactRegistry.addContact({
    id: 'tc_synthetic_reviewer',
    userId: auth.actorId,
    status: TrustedContactStatus.ACTIVE,
    createdAt,
  });
  return createPersistentApprovalService({
    databasePath,
    timeProvider: () => new Date().toISOString(),
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
  assert.equal(finalRepository.findBindingByRequestId(created.id)?.state, ApprovalActionBindingState.APPROVED);

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

  console.log('PASS: create, restart retrieval, scoped reads, atomic status update, invalid records, and connection failure');
} finally {
  rmSync(root, { recursive: true, force: true });
}
