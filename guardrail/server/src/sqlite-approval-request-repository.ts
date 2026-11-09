import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ApprovalActionBinding,
  ApprovalActionBindingState,
  ApprovalRequest,
  ApprovalStatus,
} from '../../extension/src/types/approval.js';
import {
  ApprovalBindingConflictError,
  ApprovalBindingReassignmentError,
  assertValidApprovalActionBinding,
  isValidBindingTransition,
} from '../../extension/src/approval/binding.js';
import {
  ApprovalRequestRepository,
} from '../../extension/src/approval/repository.js';
import {
  assertValidApprovalRequest,
  isValidApprovalTransition,
} from '../../extension/src/approval/model.js';

const SCHEMA_VERSION = 2;

export class ApprovalDatabaseUnavailableError extends Error {
  public readonly code = 'APPROVAL_DATABASE_UNAVAILABLE';

  constructor(cause?: unknown) {
    super('The approval database is unavailable.', { cause });
    this.name = 'ApprovalDatabaseUnavailableError';
  }
}

export class ApprovalDatabaseRecordError extends Error {
  public readonly code = 'APPROVAL_DATABASE_RECORD_INVALID';

  constructor(table: 'approval_requests' | 'approval_bindings') {
    super(`Stored data failed ${table} validation.`);
    this.name = 'ApprovalDatabaseRecordError';
  }
}

type JsonRow = { payload_json: string };

/**
 * Durable SQLite implementation of the existing ApprovalRequestRepository contract.
 * The database stores only validated, sanitized domain records and their indexed keys.
 */
export class SqliteApprovalRequestRepository implements ApprovalRequestRepository {
  public static readonly IS_PRODUCTION_PERSISTENCE = false;
  public static readonly IS_DURABLE_PERSISTENCE = true;
  public static readonly PERSISTENCE_TYPE = 'SQLITE_FILE';

  private readonly database: Database.Database;
  private closed = false;

  private constructor(database: Database.Database, databasePath: string) {
    this.database = database;
    this.databasePath = databasePath;
  }

  public readonly databasePath: string;

  public getDatabase(): Database.Database {
    return this.database;
  }

  public static open(
    databaseOrPath: string | Database.Database = process.env.GUARDRAIL_DB_PATH ?? 'data/guardrail.sqlite'
  ): SqliteApprovalRequestRepository {
    if (typeof databaseOrPath !== 'string') {
      const database = databaseOrPath;
      try {
        database.pragma('foreign_keys = ON');
        database.pragma('journal_mode = WAL');
        database.pragma('synchronous = FULL');
        database.pragma('secure_delete = ON');
        database.pragma('busy_timeout = 5000');
        SqliteApprovalRequestRepository.migrate(database);
        return new SqliteApprovalRequestRepository(database, database.name);
      } catch (error) {
        throw new ApprovalDatabaseUnavailableError(error);
      }
    }

    const resolvedPath = databaseOrPath === ':memory:' ? databaseOrPath : resolve(databaseOrPath);
    let database: Database.Database | undefined;
    try {
      if (resolvedPath !== ':memory:') {
        mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
      }
      database = new Database(resolvedPath, { timeout: 5000 });
      database.pragma('foreign_keys = ON');
      database.pragma('journal_mode = WAL');
      database.pragma('synchronous = FULL');
      database.pragma('secure_delete = ON');
      database.pragma('busy_timeout = 5000');
      SqliteApprovalRequestRepository.migrate(database);
      if (resolvedPath !== ':memory:') chmodSync(resolvedPath, 0o600);
      return new SqliteApprovalRequestRepository(database, resolvedPath);
    } catch (error) {
      try {
        database?.close();
      } catch {
        // Preserve the sanitized connection error.
      }
      throw new ApprovalDatabaseUnavailableError(error);
    }
  }

  public static getPersistenceMetadata(): {
    readonly TYPE: 'SQLITE_FILE';
    readonly IS_PRODUCTION: false;
    readonly IS_DURABLE: true;
    readonly TARGET_DATABASE: 'SQLite';
    readonly SCHEMA_VERSION: number;
  } {
    return Object.freeze({
      TYPE: 'SQLITE_FILE',
      IS_PRODUCTION: false,
      IS_DURABLE: true,
      TARGET_DATABASE: 'SQLite',
      SCHEMA_VERSION,
    });
  }

  private static migrate(database: Database.Database): void {
    const currentVersion = Number(database.pragma('user_version', { simple: true }));
    if (currentVersion > SCHEMA_VERSION) {
      throw new Error('Database schema version is newer than this application supports.');
    }
    if (currentVersion === SCHEMA_VERSION) return;

    const migration = database.transaction(() => {
      if (currentVersion === 0) {
        database.exec(`
          CREATE TABLE IF NOT EXISTS approval_requests (
            id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'apr_*'),
            requester_id TEXT NOT NULL CHECK (length(trim(requester_id)) > 0),
            action_id TEXT NOT NULL CHECK (action_id GLOB 'act_*' OR action_id GLOB 'act-*'),
            status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED')),
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
            CHECK (expires_at > created_at),
            UNIQUE (id, requester_id, action_id)
          );

          CREATE INDEX IF NOT EXISTS idx_approval_requests_requester_created
            ON approval_requests(requester_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_approval_requests_pending_owner
            ON approval_requests(status, requester_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_approval_requests_action
            ON approval_requests(action_id, created_at DESC);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_requests_active_user_action
            ON approval_requests(requester_id, action_id) WHERE status = 'PENDING';

          CREATE TABLE IF NOT EXISTS approval_bindings (
            id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'bnd_*' OR id GLOB 'bnd-*'),
            request_id TEXT NOT NULL CHECK (request_id GLOB 'apr_*'),
            requester_id TEXT NOT NULL CHECK (length(trim(requester_id)) > 0),
            action_id TEXT NOT NULL CHECK (action_id GLOB 'act_*' OR action_id GLOB 'act-*'),
            state TEXT NOT NULL CHECK (state IN ('BOUND','APPROVED','REJECTED','EXPIRED','CANCELLED','INVALIDATED','CONSUMED')),
            created_at TEXT NOT NULL,
            payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
            FOREIGN KEY (request_id, requester_id, action_id)
              REFERENCES approval_requests(id, requester_id, action_id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_approval_bindings_request
            ON approval_bindings(request_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_approval_bindings_action
            ON approval_bindings(action_id, created_at DESC);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_bindings_active_action
            ON approval_bindings(action_id) WHERE state = 'BOUND';
        `);
      } else if (currentVersion === 1) {
        database.exec(`
          CREATE TABLE approval_bindings_v2 (
            id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'bnd_*' OR id GLOB 'bnd-*'),
            request_id TEXT NOT NULL CHECK (request_id GLOB 'apr_*'),
            requester_id TEXT NOT NULL CHECK (length(trim(requester_id)) > 0),
            action_id TEXT NOT NULL CHECK (action_id GLOB 'act_*' OR action_id GLOB 'act-*'),
            state TEXT NOT NULL CHECK (state IN ('BOUND','APPROVED','REJECTED','EXPIRED','CANCELLED','INVALIDATED','CONSUMED')),
            created_at TEXT NOT NULL,
            payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
            FOREIGN KEY (request_id, requester_id, action_id)
              REFERENCES approval_requests(id, requester_id, action_id) ON DELETE CASCADE
          );

          INSERT INTO approval_bindings_v2 SELECT * FROM approval_bindings;
          DROP TABLE approval_bindings;
          ALTER TABLE approval_bindings_v2 RENAME TO approval_bindings;

          CREATE INDEX IF NOT EXISTS idx_approval_bindings_request
            ON approval_bindings(request_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_approval_bindings_action
            ON approval_bindings(action_id, created_at DESC);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_bindings_active_action
            ON approval_bindings(action_id) WHERE state = 'BOUND';
        `);
      }
      database.pragma(`user_version = ${SCHEMA_VERSION}`);
    });
    migration.immediate();
  }

  public healthCheck(): boolean {
    this.assertOpen();
    const result = this.database.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    return Number(result?.ok) === 1;
  }

  public findById(id: string): ApprovalRequest | undefined {
    const row = this.database.prepare(
      'SELECT payload_json FROM approval_requests WHERE id = ?'
    ).get(id) as JsonRow | undefined;
    return row ? this.readRequest(row.payload_json) : undefined;
  }

  public findByUserAndAction(requesterId: string, actionId: string): ApprovalRequest | undefined {
    const row = this.database.prepare(
      'SELECT payload_json FROM approval_requests WHERE requester_id = ? AND action_id = ? ORDER BY rowid DESC LIMIT 1'
    ).get(requesterId, actionId) as JsonRow | undefined;
    return row ? this.readRequest(row.payload_json) : undefined;
  }

  public save(request: ApprovalRequest): void {
    this.validateRequest(request);
    const transaction = this.database.transaction(() => {
      const existing = this.findById(request.id);
      if (existing) {
        this.assertRequestIdentity(existing, request);
        if (JSON.stringify(existing) !== JSON.stringify(request)) {
          throw new Error('Persisted approval records are immutable outside an atomic transition.');
        }
      } else if (request.status !== ApprovalStatus.PENDING) {
        throw new Error('New approval requests must start in PENDING state.');
      }
      const binding = this.findBindingByRequestId(request.id);
      if (binding && (binding.actionId !== request.actionId || binding.requesterId !== request.requesterId)) {
        throw new ApprovalBindingReassignmentError(request.id, binding.actionId, request.actionId);
      }
      this.writeRequest(request);
    });
    transaction.immediate();
  }

  public saveRequestWithBinding(request: ApprovalRequest, binding: ApprovalActionBinding): void {
    this.validateRequest(request);
    this.validateBinding(binding);
    if (
      request.id !== binding.requestId ||
      request.actionId !== binding.actionId ||
      request.requesterId !== binding.requesterId ||
      (request.bindingId !== undefined && request.bindingId !== binding.id)
    ) {
      throw new ApprovalBindingReassignmentError(request.id, binding.actionId, request.actionId);
    }

    const existingRequest = this.findById(request.id);
    if (existingRequest) {
      this.assertRequestIdentity(existingRequest, request);
      if (JSON.stringify(existingRequest) !== JSON.stringify(request)) {
        throw new Error('Persisted approval records are immutable outside an atomic transition.');
      }
    } else if (request.status !== ApprovalStatus.PENDING) {
      throw new Error('New approval requests must start in PENDING state.');
    }
    const existingBinding = this.findBindingByRequestId(request.id);
    if (existingBinding && JSON.stringify(existingBinding) !== JSON.stringify(binding)) {
      throw new Error('Persisted binding records are immutable outside an atomic transition.');
    }
    if (!existingBinding && binding.state !== ApprovalActionBindingState.BOUND) {
      throw new Error('New approval bindings must start in BOUND state.');
    }
    if (existingBinding && existingBinding.actionId !== binding.actionId) {
      throw new ApprovalBindingReassignmentError(request.id, existingBinding.actionId, binding.actionId);
    }
    const activeBinding = this.findBindingByActionId(binding.actionId);
    if (
      activeBinding?.state === ApprovalActionBindingState.BOUND &&
      activeBinding.requestId !== request.id
    ) {
      throw new ApprovalBindingConflictError(binding.actionId, activeBinding.requestId, request.id);
    }
    const activeRequest = this.findByUserAndAction(request.requesterId, request.actionId);
    if (
      activeRequest?.status === ApprovalStatus.PENDING &&
      activeRequest.id !== request.id
    ) {
      throw new ApprovalBindingConflictError(request.actionId, activeRequest.id, request.id);
    }

    const transaction = this.database.transaction(() => {
      this.writeRequest(request);
      this.writeBinding(binding);
    });
    transaction.immediate();
  }

  public atomicTransition(
    requestId: string,
    expectedCurrentStatus: ApprovalStatus,
    updatedRequest: ApprovalRequest
  ): boolean {
    this.validateRequest(updatedRequest);
    const transaction = this.database.transaction(() => {
      const existing = this.findById(requestId);
      if (!existing || existing.status !== expectedCurrentStatus) return false;
      this.assertRequestIdentity(existing, updatedRequest);
      if (!isValidApprovalTransition(existing.status, updatedRequest.status)) {
        throw new Error(`Invalid approval state transition: ${existing.status} -> ${updatedRequest.status}.`);
      }
      const result = this.database.prepare(`
        UPDATE approval_requests SET status = ?, created_at = ?, expires_at = ?, payload_json = ?
        WHERE id = ? AND status = ? AND requester_id = ? AND action_id = ?
      `).run(
        updatedRequest.status,
        updatedRequest.createdAt,
        updatedRequest.expiresAt,
        JSON.stringify(updatedRequest),
        requestId,
        expectedCurrentStatus,
        existing.requesterId,
        existing.actionId
      );
      return Number(result.changes) === 1;
    });
    return transaction.immediate();
  }

  public atomicTransitionRequestAndBinding(
    requestId: string,
    expectedRequestStatus: ApprovalStatus,
    updatedRequest: ApprovalRequest,
    bindingId: string,
    expectedBindingState: ApprovalActionBindingState,
    updatedBinding: ApprovalActionBinding
  ): boolean {
    this.validateRequest(updatedRequest);
    this.validateBinding(updatedBinding);
    const transaction = this.database.transaction(() => {
      const currentRequest = this.findById(requestId);
      const currentBinding = this.findBindingById(bindingId);
      if (
        !currentRequest || !currentBinding ||
        currentRequest.status !== expectedRequestStatus ||
        currentBinding.state !== expectedBindingState
      ) return false;

      this.assertRequestIdentity(currentRequest, updatedRequest);
      this.assertBindingIdentity(currentBinding, updatedBinding);
      if (!isValidApprovalTransition(currentRequest.status, updatedRequest.status)) {
        throw new Error(`Invalid approval state transition: ${currentRequest.status} -> ${updatedRequest.status}.`);
      }
      if (!isValidBindingTransition(currentBinding.state, updatedBinding.state)) {
        throw new Error(`Invalid binding state transition: ${currentBinding.state} -> ${updatedBinding.state}.`);
      }
      if (
        currentBinding.requestId !== requestId ||
        updatedBinding.requestId !== requestId ||
        updatedBinding.actionId !== updatedRequest.actionId ||
        updatedBinding.requesterId !== updatedRequest.requesterId
      ) {
        throw new ApprovalBindingReassignmentError(requestId, currentBinding.actionId, updatedBinding.actionId);
      }

      const requestResult = this.database.prepare(`
        UPDATE approval_requests SET status = ?, created_at = ?, expires_at = ?, payload_json = ?
        WHERE id = ? AND status = ?
      `).run(
        updatedRequest.status,
        updatedRequest.createdAt,
        updatedRequest.expiresAt,
        JSON.stringify(updatedRequest),
        requestId,
        expectedRequestStatus
      );
      const bindingResult = this.database.prepare(`
        UPDATE approval_bindings SET state = ?, created_at = ?, payload_json = ?
        WHERE id = ? AND state = ? AND request_id = ? AND action_id = ?
      `).run(
        updatedBinding.state,
        updatedBinding.createdAt,
        JSON.stringify(updatedBinding),
        bindingId,
        expectedBindingState,
        requestId,
        updatedBinding.actionId
      );
      if (Number(requestResult.changes) !== 1 || Number(bindingResult.changes) !== 1) {
        return false;
      }
      return true;
    });
    return transaction.immediate();
  }

  public findByRequesterId(requesterId: string, status?: ApprovalStatus): readonly ApprovalRequest[] {
    const rows = status
      ? this.database.prepare(
          'SELECT payload_json FROM approval_requests WHERE requester_id = ? AND status = ? ORDER BY created_at DESC, rowid DESC'
        ).all(requesterId, status) as JsonRow[]
      : this.database.prepare(
          'SELECT payload_json FROM approval_requests WHERE requester_id = ? ORDER BY created_at DESC, rowid DESC'
        ).all(requesterId) as JsonRow[];
    return Object.freeze(rows.map((row) => this.readRequest(row.payload_json)));
  }

  public findPendingByRequesterIds(requesterIds: readonly string[]): readonly ApprovalRequest[] {
    if (requesterIds.length === 0) return Object.freeze([]);
    const placeholders = requesterIds.map(() => '?').join(',');
    const rows = this.database.prepare(
      `SELECT payload_json FROM approval_requests WHERE status = 'PENDING' AND requester_id IN (${placeholders}) ORDER BY created_at DESC, rowid DESC`
    ).all(...requesterIds) as JsonRow[];
    return Object.freeze(rows.map((row) => this.readRequest(row.payload_json)));
  }

  public findPendingRequests(): readonly ApprovalRequest[] {
    const rows = this.database.prepare(
      "SELECT payload_json FROM approval_requests WHERE status = 'PENDING' ORDER BY created_at DESC, rowid DESC"
    ).all() as JsonRow[];
    return Object.freeze(rows.map((row) => this.readRequest(row.payload_json)));
  }

  public findHistoryByRequesterIds(
    requesterIds: readonly string[],
    options?: { status?: ApprovalStatus; riskLevel?: RiskLevel; limit?: number; offset?: number }
  ): readonly ApprovalRequest[] {
    if (requesterIds.length === 0) return Object.freeze([]);
    const placeholders = requesterIds.map(() => '?').join(',');
    const params: any[] = [...requesterIds];

    let sql = `SELECT payload_json FROM approval_requests WHERE status != 'PENDING' AND requester_id IN (${placeholders})`;

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    sql += ' ORDER BY created_at DESC, rowid DESC';

    if (options?.limit && options.limit > 0) {
      const offset = Math.max(0, options.offset ?? 0);
      sql += ' LIMIT ? OFFSET ?';
      params.push(options.limit, offset);
    }

    const rows = this.database.prepare(sql).all(...params) as JsonRow[];
    return Object.freeze(rows.map((row) => this.readRequest(row.payload_json)));
  }

  public findAll(): readonly ApprovalRequest[] {
    const rows = this.database.prepare(
      'SELECT payload_json FROM approval_requests ORDER BY created_at DESC, rowid DESC'
    ).all() as JsonRow[];
    return Object.freeze(rows.map((row) => this.readRequest(row.payload_json)));
  }

  public count(): number {
    return Number((this.database.prepare('SELECT count(*) AS total FROM approval_requests').get() as { total: number }).total);
  }

  public saveBinding(binding: ApprovalActionBinding): void {
    this.validateBinding(binding);
    const existing = this.findBindingById(binding.id);
    if (existing) {
      this.assertBindingIdentity(existing, binding);
      if (JSON.stringify(existing) !== JSON.stringify(binding)) {
        throw new Error('Persisted binding records are immutable outside an atomic transition.');
      }
    } else if (binding.state !== ApprovalActionBindingState.BOUND) {
      throw new Error('New approval bindings must start in BOUND state.');
    }
    const request = this.findById(binding.requestId);
    if (request && (request.actionId !== binding.actionId || request.requesterId !== binding.requesterId)) {
      throw new ApprovalBindingReassignmentError(binding.requestId, request.actionId, binding.actionId);
    }
    const priorForAction = this.findBindingByActionId(binding.actionId);
    if (
      priorForAction?.state === ApprovalActionBindingState.BOUND &&
      priorForAction.requestId !== binding.requestId
    ) {
      throw new ApprovalBindingConflictError(binding.actionId, priorForAction.requestId, binding.requestId);
    }
    this.writeBinding(binding);
  }

  public findBindingById(id: string): ApprovalActionBinding | undefined {
    const row = this.database.prepare(
      'SELECT payload_json FROM approval_bindings WHERE id = ?'
    ).get(id) as JsonRow | undefined;
    return row ? this.readBinding(row.payload_json) : undefined;
  }

  public findBindingByRequestId(requestId: string): ApprovalActionBinding | undefined {
    const row = this.database.prepare(
      'SELECT payload_json FROM approval_bindings WHERE request_id = ? ORDER BY rowid DESC LIMIT 1'
    ).get(requestId) as JsonRow | undefined;
    return row ? this.readBinding(row.payload_json) : undefined;
  }

  public findBindingByActionId(actionId: string): ApprovalActionBinding | undefined {
    const row = this.database.prepare(
      'SELECT payload_json FROM approval_bindings WHERE action_id = ? ORDER BY rowid DESC LIMIT 1'
    ).get(actionId) as JsonRow | undefined;
    return row ? this.readBinding(row.payload_json) : undefined;
  }

  public atomicTransitionBinding(
    bindingId: string,
    expectedCurrentState: ApprovalActionBindingState,
    updatedBinding: ApprovalActionBinding
  ): boolean {
    this.validateBinding(updatedBinding);
    const transaction = this.database.transaction(() => {
      const current = this.findBindingById(bindingId);
      if (!current || current.state !== expectedCurrentState) return false;
      this.assertBindingIdentity(current, updatedBinding);
      if (!isValidBindingTransition(current.state, updatedBinding.state)) {
        throw new Error(`Invalid binding state transition: ${current.state} -> ${updatedBinding.state}.`);
      }
      const result = this.database.prepare(`
        UPDATE approval_bindings SET state = ?, created_at = ?, payload_json = ?
        WHERE id = ? AND state = ? AND request_id = ? AND action_id = ?
      `).run(
        updatedBinding.state,
        updatedBinding.createdAt,
        JSON.stringify(updatedBinding),
        bindingId,
        expectedCurrentState,
        current.requestId,
        current.actionId
      );
      return Number(result.changes) === 1;
    });
    return transaction.immediate();
  }

  public findAllBindings(): readonly ApprovalActionBinding[] {
    const rows = this.database.prepare(
      'SELECT payload_json FROM approval_bindings ORDER BY created_at DESC, rowid DESC'
    ).all() as JsonRow[];
    return Object.freeze(rows.map((row) => this.readBinding(row.payload_json)));
  }

  public countBindings(): number {
    return Number((this.database.prepare('SELECT count(*) AS total FROM approval_bindings').get() as { total: number }).total);
  }

  public clear(): void {
    const transaction = this.database.transaction(() => {
      this.database.exec('DELETE FROM approval_bindings; DELETE FROM approval_requests;');
    });
    transaction.immediate();
  }

  /**
   * Data Retention Pruning: Safely purges terminal approval records (EXPIRED, CANCELLED, REJECTED, APPROVED)
   * that concluded prior to the specified ISO timestamp cutoff.
   *
   * Foreign keys with ON DELETE CASCADE cleanly delete corresponding approval_bindings rows.
   * Active PENDING records are never purged regardless of age.
   *
   * @param olderThanIsoDate ISO-8601 timestamp cutoff
   * @returns Number of purged approval requests
   */
  public pruneTerminalRequests(olderThanIsoDate: string): number {
    this.assertOpen();
    if (!olderThanIsoDate || typeof olderThanIsoDate !== 'string') {
      throw new Error('A valid ISO cutoff timestamp is required for retention pruning.');
    }
    const transaction = this.database.transaction(() => {
      const result = this.database.prepare(`
        DELETE FROM approval_requests
        WHERE status IN ('EXPIRED', 'CANCELLED', 'REJECTED', 'APPROVED')
          AND expires_at < ?
      `).run(olderThanIsoDate);
      return Number(result.changes);
    });
    return transaction.immediate();
  }

  public close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private writeRequest(request: ApprovalRequest): void {
    const result = this.database.prepare(`
      INSERT INTO approval_requests (id, requester_id, action_id, status, created_at, expires_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        payload_json = excluded.payload_json
      WHERE approval_requests.requester_id = excluded.requester_id
        AND approval_requests.action_id = excluded.action_id
    `).run(
      request.id,
      request.requesterId,
      request.actionId,
      request.status,
      request.createdAt,
      request.expiresAt,
      JSON.stringify(request)
    );
    if (Number(result.changes) !== 1) {
      throw new Error('Approval request identity cannot be reassigned.');
    }
  }

  private writeBinding(binding: ApprovalActionBinding): void {
    const result = this.database.prepare(`
      INSERT INTO approval_bindings (id, request_id, requester_id, action_id, state, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        created_at = excluded.created_at,
        payload_json = excluded.payload_json
      WHERE approval_bindings.request_id = excluded.request_id
        AND approval_bindings.requester_id = excluded.requester_id
        AND approval_bindings.action_id = excluded.action_id
    `).run(
      binding.id,
      binding.requestId,
      binding.requesterId,
      binding.actionId,
      binding.state,
      binding.createdAt,
      JSON.stringify(binding)
    );
    if (Number(result.changes) !== 1) {
      throw new Error('Approval binding identity cannot be reassigned.');
    }
  }

  private readRequest(payloadJson: string): ApprovalRequest {
    let value: unknown;
    try {
      value = JSON.parse(payloadJson);
      assertValidApprovalRequest(value);
      return deepFreeze(value);
    } catch (error) {
      if (error instanceof ApprovalDatabaseRecordError) throw error;
      throw new ApprovalDatabaseRecordError('approval_requests');
    }
  }

  private readBinding(payloadJson: string): ApprovalActionBinding {
    let value: unknown;
    try {
      value = JSON.parse(payloadJson);
      assertValidApprovalActionBinding(value);
      return deepFreeze(value);
    } catch {
      throw new ApprovalDatabaseRecordError('approval_bindings');
    }
  }

  private validateRequest(request: ApprovalRequest): void {
    assertValidApprovalRequest(request);
  }

  private validateBinding(binding: ApprovalActionBinding): void {
    assertValidApprovalActionBinding(binding);
  }

  private assertRequestIdentity(existing: ApprovalRequest, updated: ApprovalRequest): void {
    if (
      existing.id !== updated.id ||
      existing.actionId !== updated.actionId ||
      existing.requesterId !== updated.requesterId
    ) {
      throw new ApprovalBindingReassignmentError(existing.id, existing.actionId, updated.actionId);
    }
  }

  private assertBindingIdentity(existing: ApprovalActionBinding, updated: ApprovalActionBinding): void {
    if (
      existing.id !== updated.id ||
      existing.requestId !== updated.requestId ||
      existing.actionId !== updated.actionId ||
      existing.requesterId !== updated.requesterId
    ) {
      throw new ApprovalBindingReassignmentError(existing.requestId, existing.actionId, updated.actionId);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new ApprovalDatabaseUnavailableError();
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
