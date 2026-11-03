import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
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
  generateInvitationCode,
  validateInvitationCode,
  validateRelationshipLabel,
} from '../../extension/src/approval/authorization.js';
import { generateActionId, generateTimestamp } from '../../extension/src/utils/metadata.js';

type JsonRow = { payload_json: string };

function parseInvitation(json: string): TrustedContactInvitation {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('Stored invitation record is invalid.'); }
  if (!value || typeof value !== 'object') throw new Error('Stored invitation record is invalid.');
  const invitation = value as TrustedContactInvitation;
  if (
    typeof invitation.id !== 'string' || !invitation.id.startsWith('inv_') ||
    typeof invitation.userId !== 'string' || !invitation.userId.trim() ||
    !validateInvitationCode(invitation.code).valid ||
    !Object.values(InvitationStatus).includes(invitation.status) ||
    !Number.isFinite(Date.parse(invitation.createdAt)) ||
    !Number.isFinite(Date.parse(invitation.expiresAt)) ||
    Date.parse(invitation.expiresAt) <= Date.parse(invitation.createdAt) ||
    (invitation.relationshipLabel !== undefined && !validateRelationshipLabel(invitation.relationshipLabel).valid)
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

  public static open(databasePath = process.env.GUARDRAIL_DB_PATH ?? 'data/guardrail.sqlite'):
    SqliteTrustedContactRegistry {
    const resolved = databasePath === ':memory:' ? databasePath : resolve(databasePath);
    let database: Database.Database | undefined;
    try {
      if (resolved !== ':memory:') mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
      database = new Database(resolved, { timeout: 5000 });
      database.pragma('foreign_keys = ON');
      database.pragma('journal_mode = WAL');
      database.pragma('synchronous = FULL');
      database.exec(`
        CREATE TABLE IF NOT EXISTS trusted_contact_invitations (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          code TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED')),
          expires_at TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
        );
        CREATE INDEX IF NOT EXISTS idx_invitations_user_created
          ON trusted_contact_invitations(user_id, id);
        CREATE TABLE IF NOT EXISTS trusted_contacts (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('ACTIVE','PENDING_INVITE','REVOKED')),
          payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
          PRIMARY KEY(user_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_user_status
          ON trusted_contacts(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_contacts_actor_status
          ON trusted_contacts(id, status);
      `);
      if (resolved !== ':memory:') chmodSync(resolved, 0o600);
      return new SqliteTrustedContactRegistry(database);
    } catch (error) {
      try { database?.close(); } catch { /* retain sanitized failure */ }
      throw new Error('Trusted-contact database is unavailable.', { cause: error });
    }
  }

  public close(): void { this.database.close(); }

  public healthCheck(): boolean {
    const result = this.database.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    return Number(result?.ok) === 1;
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

  public createInvitation(userId: string, options?: CreateInvitationOptions): TrustedContactInvitation {
    if (!userId?.trim()) throw new Error('userId is required to create a trusted contact invitation.');
    const label = validateRelationshipLabel(options?.relationshipLabel);
    if (!label.valid) throw new Error(label.errors[0]);
    const ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 30 * 24 * 60 * 60 * 1000) {
      throw new Error('Invitation lifetime must be between 1 millisecond and 30 days.');
    }
    let code = options?.customCode;
    if (code !== undefined) {
      const validated = validateInvitationCode(code);
      if (!validated.valid) throw new Error(validated.errors[0]);
      code = validated.normalized;
    } else {
      do { code = generateInvitationCode(); }
      while (this.database.prepare('SELECT 1 FROM trusted_contact_invitations WHERE code = ?').get(code));
    }
    const createdAt = generateTimestamp();
    const invitation: TrustedContactInvitation = Object.freeze({
      id: options?.id ?? generateActionId('inv'), code, userId: userId.trim(), wardId: userId.trim(),
      relationshipLabel: label.normalized, status: InvitationStatus.PENDING, createdAt,
      expiresAt: new Date(Date.parse(createdAt) + ttlMs).toISOString(),
    });
    try {
      this.database.prepare(`INSERT INTO trusted_contact_invitations
        (id,user_id,code,status,expires_at,payload_json) VALUES (?,?,?,?,?,?)`)
        .run(invitation.id, invitation.userId, code, invitation.status, invitation.expiresAt, JSON.stringify(invitation));
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new DuplicateContactRelationshipError(code, userId);
      throw error;
    }
    return invitation;
  }

  public getInvitationByCode(code: string): TrustedContactInvitation | undefined {
    const normalized = validateInvitationCode(code);
    if (!normalized.valid) return undefined;
    const row = this.database.prepare('SELECT id FROM trusted_contact_invitations WHERE code = ?')
      .get(normalized.normalized) as { id: string } | undefined;
    return row ? this.getInvitationById(row.id) : undefined;
  }

  public getInvitationById(id: string): TrustedContactInvitation | undefined {
    let row = this.database.prepare('SELECT payload_json FROM trusted_contact_invitations WHERE id = ?')
      .get(id) as JsonRow | undefined;
    if (!row) return undefined;
    const invitation = parseInvitation(row.payload_json);
    if (invitation.status === InvitationStatus.PENDING && Date.now() >= Date.parse(invitation.expiresAt)) {
      const expired = Object.freeze({ ...invitation, status: InvitationStatus.EXPIRED });
      const changed = this.database.prepare("UPDATE trusted_contact_invitations SET status='EXPIRED',payload_json=? WHERE id=? AND status='PENDING' AND expires_at <= ?")
        .run(JSON.stringify(expired), id, new Date().toISOString());
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
      if (this.isTrustedContactForUser(contactId, invitation.userId)) throw new DuplicateContactRelationshipError(contactId, invitation.userId);
      const acceptedAt = generateTimestamp();
      const updated: TrustedContactInvitation = Object.freeze({ ...invitation, status: InvitationStatus.ACCEPTED, acceptedByContactId: contactId, acceptedAt });
      const contact: TrustedContact = Object.freeze({ id: contactId, contactId, userId: invitation.userId, wardId: invitation.userId,
        relationshipLabel: invitation.relationshipLabel, status: TrustedContactStatus.ACTIVE, createdAt: acceptedAt });
      const result = this.database.prepare("UPDATE trusted_contact_invitations SET status='ACCEPTED',payload_json=? WHERE id=? AND status='PENDING'")
        .run(JSON.stringify(updated), invitation.id);
      if (Number(result.changes) !== 1) throw new InvitationAlreadyAcceptedError(invitation.id);
      this.database.prepare('INSERT INTO trusted_contacts(id,user_id,status,payload_json) VALUES (?,?,?,?)')
        .run(contact.id, contact.userId, contact.status, JSON.stringify(contact));
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
    const result = this.database.prepare("UPDATE trusted_contact_invitations SET status='REVOKED',payload_json=? WHERE id=? AND user_id=? AND status='PENDING'")
      .run(JSON.stringify(revoked), invitationId, userId);
    if (Number(result.changes) !== 1) throw new InvitationNotFoundError(invitationId);
    return revoked;
  }

  public revokeTrustedContact(contactId: string, userId: string): boolean {
    const raw = this.database.prepare("SELECT payload_json FROM trusted_contacts WHERE id=? AND user_id=? AND status='ACTIVE'")
      .get(contactId, userId) as JsonRow | undefined;
    if (!raw) return false;
    const contact = JSON.parse(raw.payload_json) as TrustedContact;
    const revoked = Object.freeze({ ...contact, status: TrustedContactStatus.REVOKED });
    return Number(this.database.prepare("UPDATE trusted_contacts SET status='REVOKED',payload_json=? WHERE id=? AND user_id=? AND status='ACTIVE'")
      .run(JSON.stringify(revoked), contactId, userId).changes) === 1;
  }
}
