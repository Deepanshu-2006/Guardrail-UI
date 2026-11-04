import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { ActorRole } from '../../extension/src/approval/authorization.js';

export interface InternalIdentity {
  readonly actorId: string;
  readonly role: ActorRole;
}

interface IdentityRow {
  readonly id: string;
  readonly role: ActorRole;
  readonly status: 'ACTIVE' | 'DISABLED';
}

/** Minimal identity mapping store; it retains provider subject identifiers, not profile data. */
export class SqliteIdentityStore {
  private constructor(private readonly database: Database.Database, public readonly databasePath: string) {}

  public static open(databasePath = process.env.GUARDRAIL_DB_PATH ?? 'data/guardrail.sqlite'): SqliteIdentityStore {
    const resolved = databasePath === ':memory:' ? databasePath : resolve(databasePath);
    let database: Database.Database | undefined;
    try {
      if (resolved !== ':memory:') mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
      database = new Database(resolved, { timeout: 5000 });
      database.pragma('journal_mode = WAL');
      database.pragma('synchronous = FULL');
      database.pragma('busy_timeout = 5000');
      database.exec(`
        CREATE TABLE IF NOT EXISTS guardrail_identity_schema (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          version INTEGER NOT NULL
        );
        INSERT INTO guardrail_identity_schema(singleton, version) VALUES (1, 1)
          ON CONFLICT(singleton) DO NOTHING;
        CREATE TABLE IF NOT EXISTS guardrail_users (
          id TEXT PRIMARY KEY NOT NULL CHECK(id GLOB 'usr_*'),
          issuer TEXT NOT NULL,
          subject TEXT NOT NULL CHECK(length(trim(subject)) > 0),
          role TEXT NOT NULL CHECK(role IN ('USER','TRUSTED_CONTACT','ADMIN')),
          status TEXT NOT NULL CHECK(status IN ('ACTIVE','DISABLED')),
          verified_email TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(issuer, subject)
        );
        CREATE INDEX IF NOT EXISTS idx_guardrail_users_status ON guardrail_users(status, role);
        CREATE TABLE IF NOT EXISTS guardrail_revoked_tokens (
          jti TEXT PRIMARY KEY NOT NULL CHECK(length(trim(jti)) > 0),
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_guardrail_revoked_tokens_expiry ON guardrail_revoked_tokens(expires_at);
      `);
      const userColumns = database.pragma('table_info(guardrail_users)') as { name: string }[];
      if (!userColumns.some((column) => column.name === 'verified_email')) {
        database.exec('ALTER TABLE guardrail_users ADD COLUMN verified_email TEXT');
      }
      if (resolved !== ':memory:') chmodSync(resolved, 0o600);
      return new SqliteIdentityStore(database, resolved);
    } catch (error) {
      try { database?.close(); } catch { /* retain sanitized initialization failure */ }
      throw new Error('Identity database is unavailable.', { cause: error });
    }
  }

  /** Resolve a verified provider subject to one stable internal actor record. */
  public resolveVerifiedIdentity(issuer: string, subject: string, role: ActorRole, verifiedEmail?: string): InternalIdentity | undefined {
    if (!issuer.trim() || !subject.trim() || !Object.values(ActorRole).includes(role)) return undefined;
    const normalizedEmail = verifiedEmail?.trim().toLowerCase();
    if (normalizedEmail && (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) return undefined;
    const now = new Date().toISOString();
    const resolve = this.database.transaction((): InternalIdentity | undefined => {
      let row = this.database.prepare(
        'SELECT id, role, status FROM guardrail_users WHERE issuer = ? AND subject = ?'
      ).get(issuer, subject) as IdentityRow | undefined;
      if (row?.status === 'DISABLED') return undefined;
      if (!row) {
        this.database.prepare(`INSERT INTO guardrail_users
          (id,issuer,subject,role,status,verified_email,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(`usr_${randomUUID()}`, issuer, subject, role, 'ACTIVE', normalizedEmail ?? null, now, now);
        row = this.database.prepare(
          'SELECT id, role, status FROM guardrail_users WHERE issuer = ? AND subject = ?'
        ).get(issuer, subject) as IdentityRow | undefined;
      } else if (row.role !== role) {
        // Role changes are accepted only from a newly verified issuer-signed claim.
        this.database.prepare('UPDATE guardrail_users SET role = ?, updated_at = ? WHERE id = ? AND status = \'ACTIVE\'')
          .run(role, now, row.id);
        row = { ...row, role };
      }
      if (row && normalizedEmail) {
        this.database.prepare('UPDATE guardrail_users SET verified_email=?,updated_at=? WHERE id=? AND status=\'ACTIVE\'')
          .run(normalizedEmail, now, row.id);
      }
      return row?.status === 'ACTIVE' ? Object.freeze({ actorId: row.id, role: row.role }) : undefined;
    });
    return resolve.immediate();
  }

  /** Email is available only when it came from an issuer-signed email_verified=true claim. */
  public getVerifiedEmail(actorId: string): string | undefined {
    const row = this.database.prepare("SELECT verified_email FROM guardrail_users WHERE id=? AND status='ACTIVE'")
      .get(actorId) as { verified_email?: string | null } | undefined;
    return row?.verified_email ?? undefined;
  }

  public isTokenRevoked(jti: string, now = new Date().toISOString()): boolean {
    this.database.prepare('DELETE FROM guardrail_revoked_tokens WHERE expires_at <= ?').run(now);
    return Boolean(this.database.prepare(
      'SELECT 1 FROM guardrail_revoked_tokens WHERE jti = ? AND expires_at > ?'
    ).get(jti, now));
  }

  /** Called by trusted host administration when an issuer reports a token revoked. */
  public revokeToken(jti: string, expiresAt: string): void {
    if (!jti.trim() || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
      throw new Error('A token identifier and future expiry are required for revocation.');
    }
    this.database.prepare('INSERT INTO guardrail_revoked_tokens(jti, expires_at) VALUES (?, ?) ON CONFLICT(jti) DO UPDATE SET expires_at=excluded.expires_at')
      .run(jti, new Date(Date.parse(expiresAt)).toISOString());
  }

  /** Disable an identity after an authoritative provider/admin revocation. */
  public setIdentityActive(issuer: string, subject: string, active: boolean): boolean {
    const result = this.database.prepare(
      'UPDATE guardrail_users SET status = ?, updated_at = ? WHERE issuer = ? AND subject = ?'
    ).run(active ? 'ACTIVE' : 'DISABLED', new Date().toISOString(), issuer, subject);
    return Number(result.changes) === 1;
  }

  public healthCheck(): boolean {
    const result = this.database.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    return Number(result?.ok) === 1;
  }

  public close(): void { this.database.close(); }
}
