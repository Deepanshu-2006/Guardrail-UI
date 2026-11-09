import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ApprovalAccessDeniedError,
  CreateInvitationOptions,
  DuplicateContactRelationshipError,
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRevokedError,
  InvitationStatus,
  SelfInvitationProhibitedError,
  TrustedContact,
  TrustedContactInvitation,
  TrustedContactRegistry,
  TrustedContactStatus,
  validateInvitationCode,
  validateRelationshipLabel,
} from '../../extension/src/approval/authorization.js';
import { generateActionId, generateTimestamp } from '../../extension/src/utils/metadata.js';

type JsonRow = { payload_json: string };

function hashInvitationToken(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function retiredInvitationTokenHash(): string {
  return hashInvitationToken(`retired:${randomBytes(32).toString('base64url')}`);
}

function parseInvitation(json: string): TrustedContactInvitation {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('Stored invitation record is invalid.'); }
  if (!value || typeof value !== 'object') throw new Error('Stored invitation record is invalid.');
  const invitation = value as TrustedContactInvitation;
  if (
    typeof invitation.id !== 'string' || !invitation.id.startsWith('inv_') ||
    typeof invitation.userId !== 'string' || !invitation.userId.trim() ||
    typeof invitation.recipientActorId !== 'string' || !invitation.recipientActorId.trim() ||
    (invitation.code !== undefined && !validateInvitationCode(invitation.code).valid) ||
    !Object.values(InvitationStatus).includes(invitation.status) ||
    !Number.isFinite(Date.parse(invitation.createdAt)) ||
    !Number.isFinite(Date.parse(invitation.expiresAt)) ||
    Date.parse(invitation.expiresAt) <= Date.parse(invitation.createdAt) ||
    (invitation.relationshipLabel !== undefined && !validateRelationshipLabel(invitation.relationshipLabel).valid) ||
    (invitation.acceptedAt !== undefined && !Number.isFinite(Date.parse(invitation.acceptedAt))) ||
    (invitation.revokedAt !== undefined && !Number.isFinite(Date.parse(invitation.revokedAt))) ||
    (invitation.expiredAt !== undefined && !Number.isFinite(Date.parse(invitation.expiredAt))) ||
    (invitation.deliveryStatus !== undefined && !['NOT_CONFIGURED', 'SUBMITTING', 'SUBMITTED', 'FAILED'].includes(invitation.deliveryStatus)) ||
    (invitation.deliveryAttemptedAt !== undefined && !Number.isFinite(Date.parse(invitation.deliveryAttemptedAt))) ||
    (invitation.deliverySubmittedAt !== undefined && !Number.isFinite(Date.parse(invitation.deliverySubmittedAt))) ||
    (invitation.deliveryFailureCode !== undefined && !['RECIPIENT_EMAIL_UNAVAILABLE', 'PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE'].includes(invitation.deliveryFailureCode))
  ) throw new Error('Stored invitation record is invalid.');
  return Object.freeze(invitation);
}

function parseContact(json: string): TrustedContact {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('Stored trusted-contact record is invalid.'); }
  if (!value || typeof value !== 'object') throw new Error('Stored trusted-contact record is invalid.');
  const contact = value as TrustedContact;
  if (
    typeof contact.id !== 'string' || !contact.id.trim() ||
    typeof contact.userId !== 'string' || !contact.userId.trim() ||
    !Object.values(TrustedContactStatus).includes(contact.status) ||
    !Number.isFinite(Date.parse(contact.createdAt)) ||
    (contact.relationshipLabel !== undefined && !validateRelationshipLabel(contact.relationshipLabel).valid)
  ) throw new Error('Stored trusted-contact record is invalid.');
  return Object.freeze(contact);
}

/** SQLite-backed relationships and invitations, sharing the backend database file. */
export class SqliteTrustedContactRegistry implements TrustedContactRegistry {
  private constructor(private readonly database: Database.Database) {}

  private static migrate(database: Database.Database): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS trusted_contact_invitations (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          code TEXT NOT NULL UNIQUE,
          recipient_actor_id TEXT,
          status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED')),
          created_at TEXT,
          accepted_at TEXT,
          revoked_at TEXT,
          expired_at TEXT,
          expires_at TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
        );
        CREATE INDEX IF NOT EXISTS idx_invitations_user_created
          ON trusted_contact_invitations(user_id, id);
        CREATE TABLE IF NOT EXISTS trusted_contacts (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('ACTIVE','PENDING_INVITE','REVOKED')),
          created_at TEXT,
          revoked_at TEXT,
          payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
          PRIMARY KEY(user_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_user_status
          ON trusted_contacts(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_contacts_actor_status
          ON trusted_contacts(id, status);
      `);
      const migrateTrustedContactSchema = database.transaction(() => {
      const ensureColumn = (table: string, name: string, definition: string) => {
        const columns = database.pragma(`table_info(${table})`) as { name: string }[];
        if (!columns.some((column) => column.name === name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      };
      ensureColumn('trusted_contact_invitations', 'recipient_actor_id', 'TEXT');
      ensureColumn('trusted_contact_invitations', 'created_at', 'TEXT');
      ensureColumn('trusted_contact_invitations', 'accepted_at', 'TEXT');
      ensureColumn('trusted_contact_invitations', 'revoked_at', 'TEXT');
      ensureColumn('trusted_contact_invitations', 'expired_at', 'TEXT');
      ensureColumn('trusted_contacts', 'created_at', 'TEXT');
      ensureColumn('trusted_contacts', 'revoked_at', 'TEXT');
      const legacyInvitations = database.prepare('SELECT id,code,recipient_actor_id,payload_json FROM trusted_contact_invitations').all() as { id: string; code: string; recipient_actor_id: string | null; payload_json: string }[];
      const migrateLegacy = database.prepare(`UPDATE trusted_contact_invitations
        SET code=?,recipient_actor_id=?,status=?,revoked_at=?,expired_at=?,payload_json=? WHERE id=?`);
      const migrationNow = generateTimestamp();
      for (const row of legacyInvitations) {
        let legacy: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(row.payload_json);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
          legacy = parsed as Record<string, unknown>;
        } catch {
          throw new Error('Legacy invitation record is invalid.');
        }
        const accepted = legacy.status === InvitationStatus.ACCEPTED && typeof legacy.acceptedByContactId === 'string';
        const needsRecipientMigration = row.recipient_actor_id === null;
        const recipientActorId = needsRecipientMigration
          ? (accepted ? legacy.acceptedByContactId as string : 'unassigned')
          : row.recipient_actor_id!;
        const legacyExpired = legacy.status === InvitationStatus.EXPIRED;
        const legacyRevoked = legacy.status === InvitationStatus.REVOKED;
        const status = needsRecipientMigration
          ? (accepted ? InvitationStatus.ACCEPTED : legacyExpired ? InvitationStatus.EXPIRED : InvitationStatus.REVOKED)
          : legacy.status as InvitationStatus;
        const revokedAt = accepted || legacyExpired ? undefined : typeof legacy.revokedAt === 'string' ? legacy.revokedAt : needsRecipientMigration ? migrationNow : undefined;
        const expiredAt = legacyExpired ? (typeof legacy.expiredAt === 'string' ? legacy.expiredAt : legacy.expiresAt as string) : undefined;
        const hashedCode = status === InvitationStatus.PENDING
          ? (/^sha256:[a-f0-9]{64}$/.test(row.code) ? row.code : hashInvitationToken(row.code))
          : retiredInvitationTokenHash();
        const migrated = { ...legacy, recipientActorId, status,
          deliveryStatus: (legacy.deliveryStatus as TrustedContactInvitation['deliveryStatus']) ?? 'NOT_CONFIGURED',
          ...(revokedAt ? { revokedAt } : {}), ...(expiredAt ? { expiredAt } : {}),
          ...(legacyRevoked && !revokedAt ? { revokedAt: migrationNow } : {}) } as Record<string, unknown>;
        delete migrated.code;
        migrateLegacy.run(hashedCode, recipientActorId, status, revokedAt ?? null, expiredAt ?? null, JSON.stringify(migrated), row.id);
      }
      const pendingRows = database.prepare("SELECT id,user_id,recipient_actor_id,payload_json FROM trusted_contact_invitations WHERE status='PENDING' ORDER BY rowid")
        .all() as { id: string; user_id: string; recipient_actor_id: string; payload_json: string }[];
      const firstPendingByRecipient = new Set<string>();
      const revokeDuplicate = database.prepare("UPDATE trusted_contact_invitations SET status='REVOKED',revoked_at=?,payload_json=? WHERE id=? AND status='PENDING'");
      for (const row of pendingRows) {
        const pair = `${row.user_id}\u0000${row.recipient_actor_id}`;
        if (!row.recipient_actor_id || !firstPendingByRecipient.has(pair)) {
          firstPendingByRecipient.add(pair);
          continue;
        }
        const invitation = JSON.parse(row.payload_json) as TrustedContactInvitation;
        revokeDuplicate.run(migrationNow, JSON.stringify({ ...invitation, status: InvitationStatus.REVOKED, revokedAt: migrationNow }), row.id);
      }
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_invitation_recipient_status
          ON trusted_contact_invitations(recipient_actor_id, status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_contacts_active
          ON trusted_contacts(user_id, id) WHERE status = 'ACTIVE';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_invitation_recipient
          ON trusted_contact_invitations(user_id, recipient_actor_id) WHERE status = 'PENDING';
      `);
      });
      migrateTrustedContactSchema.immediate();
  }

  public static open(
    databaseOrPath: string | Database.Database = process.env.GUARDRAIL_DB_PATH ?? 'data/guardrail.sqlite'
  ): SqliteTrustedContactRegistry {
    if (typeof databaseOrPath !== 'string') {
      const database = databaseOrPath;
      try {
        database.pragma('foreign_keys = ON');
        database.pragma('journal_mode = WAL');
        database.pragma('synchronous = FULL');
        database.pragma('secure_delete = ON');
        database.pragma('busy_timeout = 5000');
        SqliteTrustedContactRegistry.migrate(database);
        return new SqliteTrustedContactRegistry(database);
      } catch (error) {
        throw new Error('Trusted-contact database is unavailable.', { cause: error });
      }
    }

    const resolved = databaseOrPath === ':memory:' ? databaseOrPath : resolve(databaseOrPath);
    let database: Database.Database | undefined;
    try {
      if (resolved !== ':memory:') mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
      database = new Database(resolved, { timeout: 5000 });
      database.pragma('foreign_keys = ON');
      database.pragma('journal_mode = WAL');
      database.pragma('synchronous = FULL');
      database.pragma('secure_delete = ON');
      database.pragma('busy_timeout = 5000');
      SqliteTrustedContactRegistry.migrate(database);
      if (resolved !== ':memory:') chmodSync(resolved, 0o600);
      return new SqliteTrustedContactRegistry(database);
    } catch (error) {
      try { database?.close(); } catch { /* retain sanitized failure */ }
      throw new Error('Trusted-contact database is unavailable.', { cause: error });
    }
  }

  public close(): void {
    try {
      if (this.database.open) this.database.close();
    } catch {
      // already closed
    }
  }

  public healthCheck(): boolean {
    try {
      if (!this.database.open) return false;
      const result = this.database.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      return Number(result?.ok) === 1;
    } catch {
      return false;
    }
  }

  public isTrustedContactForUser(contactId: string, userId: string): boolean {
    return Boolean(this.database.prepare(
      "SELECT 1 FROM trusted_contacts WHERE id = ? AND user_id = ? AND status = 'ACTIVE'"
    ).get(contactId, userId));
  }

  public getTrustedContactsForUser(userId: string): readonly TrustedContact[] {
    const rows = this.database.prepare(
      "SELECT payload_json FROM trusted_contacts WHERE user_id = ? AND status = 'ACTIVE' ORDER BY rowid"
    ).all(userId) as JsonRow[];
    return Object.freeze(rows.map((row) => parseContact(row.payload_json)));
  }

  public hasActiveTrustedContact(userId: string): boolean {
    return Boolean(this.database.prepare(
      "SELECT 1 FROM trusted_contacts WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1"
    ).get(userId));
  }

  public getWardIdsForContact(contactId: string): readonly string[] {
    const rows = this.database.prepare(
      "SELECT DISTINCT user_id FROM trusted_contacts WHERE id = ? AND status = 'ACTIVE'"
    ).all(contactId) as { user_id: string }[];
    return Object.freeze(rows.map((r) => r.user_id));
  }

  public createInvitation(userId: string, options?: CreateInvitationOptions): TrustedContactInvitation {
    if (!userId?.trim()) throw new Error('userId is required to create a trusted contact invitation.');
    const recipientActorId = options?.recipientActorId?.trim();
    if (!recipientActorId || recipientActorId === userId.trim()) throw new Error('A distinct verified recipient is required.');
    const identitiesTable = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='guardrail_users'").get();
    if (!identitiesTable) throw new Error('Verified identity storage is unavailable.');
    const issuer = this.database.prepare("SELECT role,status FROM guardrail_users WHERE id=?").get(userId) as { role: string; status: string } | undefined;
    const recipient = this.database.prepare("SELECT role,status FROM guardrail_users WHERE id=?").get(recipientActorId) as { role: string; status: string } | undefined;
    if (!issuer || issuer.role !== 'USER' || issuer.status !== 'ACTIVE') throw new ApprovalAccessDeniedError();
    if (!recipient || recipient.role !== 'TRUSTED_CONTACT' || recipient.status !== 'ACTIVE') throw new ApprovalAccessDeniedError();
    const label = validateRelationshipLabel(options?.relationshipLabel);
    if (!label.valid) throw new Error(label.errors[0]);
    const ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 30 * 24 * 60 * 60 * 1000) {
      throw new Error('Invitation lifetime must be between 1 millisecond and 30 days.');
    }
    if (options?.customCode !== undefined) throw new Error('Invitation tokens are generated by the backend.');
    const existing = this.database.prepare("SELECT id FROM trusted_contact_invitations WHERE user_id=? AND recipient_actor_id=? AND status='PENDING'")
      .all(userId.trim(), recipientActorId) as { id: string }[];
    for (const row of existing) {
      const prior = this.getInvitationById(row.id);
      if (prior?.status === InvitationStatus.PENDING) return prior;
    }
    const code = `GRI_${randomBytes(32).toString('base64url')}`;
    const createdAt = generateTimestamp();
    const invitation: TrustedContactInvitation = Object.freeze({
      id: options?.id ?? generateActionId('inv'), code, userId: userId.trim(), wardId: userId.trim(), recipientActorId,
      relationshipLabel: label.normalized, status: InvitationStatus.PENDING, createdAt,
      expiresAt: new Date(Date.parse(createdAt) + ttlMs).toISOString(),
      deliveryStatus: 'NOT_CONFIGURED',
    });
    try {
      this.database.prepare(`INSERT INTO trusted_contact_invitations
        (id,user_id,code,recipient_actor_id,status,created_at,expires_at,payload_json) VALUES (?,?,?,?,?,?,?,?)`)
        .run(invitation.id, invitation.userId, hashInvitationToken(code), recipientActorId, invitation.status, invitation.createdAt, invitation.expiresAt,
          JSON.stringify({ ...invitation, code: undefined }));
    } catch (error) {
      if (String(error).includes('UNIQUE')) {
        const duplicate = this.database.prepare("SELECT id FROM trusted_contact_invitations WHERE user_id=? AND recipient_actor_id=? AND status='PENDING'")
          .get(invitation.userId, recipientActorId) as { id: string } | undefined;
        if (duplicate) return this.getInvitationById(duplicate.id)!;
        throw new DuplicateContactRelationshipError(invitation.userId, recipientActorId);
      }
      throw error;
    }
    return invitation;
  }

  public getInvitationByCode(code: string): TrustedContactInvitation | undefined {
    const normalized = validateInvitationCode(code);
    if (!normalized.valid) return undefined;
    const row = this.database.prepare('SELECT id FROM trusted_contact_invitations WHERE code = ?')
      .get(hashInvitationToken(normalized.normalized)) as { id: string } | undefined;
    return row ? this.getInvitationById(row.id) : undefined;
  }

  public getInvitationById(id: string): TrustedContactInvitation | undefined {
    let row = this.database.prepare('SELECT payload_json FROM trusted_contact_invitations WHERE id = ?')
      .get(id) as JsonRow | undefined;
    if (!row) return undefined;
    const invitation = parseInvitation(row.payload_json);
    if (invitation.status === InvitationStatus.PENDING && Date.now() >= Date.parse(invitation.expiresAt)) {
      const expired = Object.freeze({ ...invitation, status: InvitationStatus.EXPIRED, expiredAt: invitation.expiresAt });
      const changed = this.database.prepare("UPDATE trusted_contact_invitations SET code=?,status='EXPIRED',expired_at=?,payload_json=? WHERE id=? AND status='PENDING' AND expires_at <= ?")
        .run(retiredInvitationTokenHash(), expired.expiredAt, JSON.stringify(expired), id, new Date().toISOString());
      // Another connection may have accepted or revoked it while the expiry check ran.
      if (Number(changed.changes) !== 1) {
        row = this.database.prepare('SELECT payload_json FROM trusted_contact_invitations WHERE id = ?')
          .get(id) as JsonRow | undefined;
        return row ? parseInvitation(row.payload_json) : undefined;
      }
      return expired;
    }
    return invitation;
  }

  public listInvitationsForUser(userId: string): readonly TrustedContactInvitation[] {
    const rows = this.database.prepare('SELECT id FROM trusted_contact_invitations WHERE user_id = ? ORDER BY rowid DESC')
      .all(userId) as { id: string }[];
    return Object.freeze(rows.map(({ id }) => this.getInvitationById(id)).filter((v): v is TrustedContactInvitation => Boolean(v)));
  }

  public acceptInvitation(code: string, contactId: string): { invitation: TrustedContactInvitation; contact: TrustedContact } {
    const tx = this.database.transaction(() => {
      const invitation = this.getInvitationByCode(code);
      if (!invitation) throw new InvitationNotFoundError(code);
      if (invitation.status === InvitationStatus.EXPIRED) throw new InvitationExpiredError(invitation.id, invitation.expiresAt);
      if (invitation.status === InvitationStatus.REVOKED) throw new InvitationRevokedError(invitation.id);
      if (invitation.status === InvitationStatus.ACCEPTED) throw new InvitationAlreadyAcceptedError(invitation.id);
      if (contactId === invitation.userId) throw new SelfInvitationProhibitedError(contactId, invitation.id);
      if (invitation.recipientActorId !== contactId) throw new ApprovalAccessDeniedError();
      const recipient = this.database.prepare("SELECT role,status FROM guardrail_users WHERE id=?").get(contactId) as { role: string; status: string } | undefined;
      if (!recipient || recipient.role !== 'TRUSTED_CONTACT' || recipient.status !== 'ACTIVE') throw new ApprovalAccessDeniedError();
      if (this.isTrustedContactForUser(contactId, invitation.userId)) throw new DuplicateContactRelationshipError(contactId, invitation.userId);
      const acceptedAt = generateTimestamp();
      const updated: TrustedContactInvitation = Object.freeze({ ...invitation, status: InvitationStatus.ACCEPTED, acceptedByContactId: contactId, acceptedAt });
      const contact: TrustedContact = Object.freeze({ id: contactId, contactId, userId: invitation.userId, wardId: invitation.userId,
        relationshipLabel: invitation.relationshipLabel, status: TrustedContactStatus.ACTIVE, createdAt: acceptedAt });
      const result = this.database.prepare("UPDATE trusted_contact_invitations SET code=?,status='ACCEPTED',accepted_at=?,payload_json=? WHERE id=? AND status='PENDING' AND recipient_actor_id=?")
        .run(retiredInvitationTokenHash(), acceptedAt, JSON.stringify(updated), invitation.id, contactId);
      if (Number(result.changes) !== 1) throw new InvitationAlreadyAcceptedError(invitation.id);
      this.database.prepare('INSERT INTO trusted_contacts(id,user_id,status,created_at,payload_json) VALUES (?,?,?,?,?)')
        .run(contact.id, contact.userId, contact.status, contact.createdAt, JSON.stringify(contact));
      return { invitation: updated, contact };
    });
    return tx.immediate();
  }

  public revokeInvitation(invitationId: string, userId: string): TrustedContactInvitation {
    const invitation = this.getInvitationById(invitationId);
    if (!invitation || invitation.userId !== userId) throw new InvitationNotFoundError(invitationId);
    if (invitation.status === InvitationStatus.ACCEPTED) throw new Error('Cannot revoke an invitation that has already been accepted.');
    if (invitation.status === InvitationStatus.REVOKED || invitation.status === InvitationStatus.EXPIRED) return invitation;
    const revoked = Object.freeze({ ...invitation, status: InvitationStatus.REVOKED, revokedAt: generateTimestamp() });
    const result = this.database.prepare("UPDATE trusted_contact_invitations SET code=?,status='REVOKED',revoked_at=?,payload_json=? WHERE id=? AND user_id=? AND status='PENDING'")
      .run(retiredInvitationTokenHash(), revoked.revokedAt, JSON.stringify(revoked), invitationId, userId);
    if (Number(result.changes) !== 1) throw new InvitationNotFoundError(invitationId);
    return revoked;
  }

  public revokeTrustedContact(contactId: string, userId: string): boolean {
    const raw = this.database.prepare("SELECT payload_json FROM trusted_contacts WHERE id=? AND user_id=? AND status='ACTIVE'")
      .get(contactId, userId) as JsonRow | undefined;
    if (!raw) return false;
    const contact = JSON.parse(raw.payload_json) as TrustedContact;
    const revoked = Object.freeze({ ...contact, status: TrustedContactStatus.REVOKED, revokedAt: generateTimestamp() });
    return Number(this.database.prepare("UPDATE trusted_contacts SET status='REVOKED',revoked_at=?,payload_json=? WHERE id=? AND user_id=? AND status='ACTIVE'")
      .run(revoked.revokedAt, JSON.stringify(revoked), contactId, userId).changes) === 1;
  }

  /**
   * Data Retention Pruning: Safely purges terminal invitations (EXPIRED, REVOKED, ACCEPTED)
   * that concluded prior to the specified ISO timestamp cutoff.
   *
   * @param olderThanIsoDate ISO-8601 timestamp cutoff
   * @returns Number of purged invitations
   */
  public pruneTerminalInvitations(olderThanIsoDate: string): number {
    if (!olderThanIsoDate || typeof olderThanIsoDate !== 'string') {
      throw new Error('A valid ISO cutoff timestamp is required for invitation retention pruning.');
    }
    const result = this.database.prepare(`
      DELETE FROM trusted_contact_invitations
      WHERE status IN ('EXPIRED', 'REVOKED', 'ACCEPTED')
        AND (expired_at < ? OR revoked_at < ? OR accepted_at < ?)
    `).run(olderThanIsoDate, olderThanIsoDate, olderThanIsoDate);
    return Number(result.changes);
  }
}
