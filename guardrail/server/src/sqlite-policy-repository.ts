import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  PolicyAuditRecord,
  PolicyVersionConflictError,
  UserPolicyRecord,
} from '../../extension/src/approval/policy-permissions.js';
import { PolicyRepository } from '../../extension/src/approval/policy-repository.js';
import { GuardrailPolicyConfig } from '../../extension/src/types/config.js';

interface PolicyRow {
  readonly user_id: string;
  readonly policy_version: string;
  readonly schema_version: string;
  readonly updated_at: string;
  readonly updated_by: string;
  readonly payload_json: string;
}

interface AuditRow {
  readonly id: string;
  readonly user_id: string;
  readonly updated_by: string;
  readonly actor_role?: string | null;
  readonly timestamp: string;
  readonly previous_version: string;
  readonly new_version: string;
  readonly changed_fields_json: string;
  readonly summary: string;
  readonly change_source?: string | null;
  readonly is_system_default?: number | null;
  readonly impact_summary?: string | null;
}

function parsePolicyRecord(row: PolicyRow): UserPolicyRecord {
  let config: GuardrailPolicyConfig;
  try {
    config = JSON.parse(row.payload_json) as GuardrailPolicyConfig;
  } catch {
    throw new Error(`Corrupt policy payload stored for user "${row.user_id}".`);
  }
  return Object.freeze({
    userId: row.user_id,
    policyVersion: row.policy_version,
    schemaVersion: row.schema_version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    config: Object.freeze(config),
  });
}

function parseAuditRecord(row: AuditRow): PolicyAuditRecord {
  let changedFields: string[] = [];
  try {
    changedFields = JSON.parse(row.changed_fields_json) as string[];
  } catch {
    changedFields = [];
  }
  return Object.freeze({
    id: row.id,
    userId: row.user_id,
    updatedBy: row.updated_by,
    actorRole: (row.actor_role as any) ?? 'USER',
    timestamp: row.timestamp,
    previousPolicyVersion: row.previous_version,
    newPolicyVersion: row.new_version,
    changedFields: Object.freeze(changedFields),
    changeSummary: row.summary,
    changeSource: (row.change_source as any) ?? (row.new_version === '1.0.0' ? 'SYSTEM_DEFAULT' : 'USER_CHANGE'),
    isSystemDefault: Boolean(row.is_system_default),
    impactSummary: row.impact_summary ?? '',
  });
}

/**
 * SQLite-backed persistent policy repository providing durable ACID storage,
 * foreign key integrity, optimistic concurrency control, and audit logging.
 */
export class SqlitePolicyRepository implements PolicyRepository {
  private constructor(
    private readonly database: Database.Database,
    public readonly databasePath: string
  ) {}

  private static migrate(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS user_policies (
        user_id TEXT PRIMARY KEY NOT NULL,
        policy_version TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
      );
      CREATE INDEX IF NOT EXISTS idx_user_policies_version
        ON user_policies(user_id, policy_version);

      CREATE TABLE IF NOT EXISTS user_policy_audit_log (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        actor_role TEXT,
        timestamp TEXT NOT NULL,
        previous_version TEXT NOT NULL,
        new_version TEXT NOT NULL,
        changed_fields_json TEXT NOT NULL CHECK(json_valid(changed_fields_json)),
        summary TEXT NOT NULL,
        change_source TEXT,
        is_system_default INTEGER DEFAULT 0,
        impact_summary TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_policy_audit_user_time
        ON user_policy_audit_log(user_id, timestamp);
    `);

    // Safe schema migrations for existing databases
    const auditCols = database.prepare('PRAGMA table_info(user_policy_audit_log)').all() as Array<{ name: string }>;
    const auditColNames = new Set(auditCols.map((c) => c.name));
    if (!auditColNames.has('actor_role')) {
      database.exec('ALTER TABLE user_policy_audit_log ADD COLUMN actor_role TEXT;');
    }
    if (!auditColNames.has('change_source')) {
      database.exec('ALTER TABLE user_policy_audit_log ADD COLUMN change_source TEXT;');
    }
    if (!auditColNames.has('is_system_default')) {
      database.exec('ALTER TABLE user_policy_audit_log ADD COLUMN is_system_default INTEGER DEFAULT 0;');
    }
    if (!auditColNames.has('impact_summary')) {
      database.exec('ALTER TABLE user_policy_audit_log ADD COLUMN impact_summary TEXT;');
    }
  }

  public static open(
    databaseOrPath: string | Database.Database = process.env.GUARDRAIL_DB_PATH ?? 'data/guardrail.sqlite'
  ): SqlitePolicyRepository {
    if (typeof databaseOrPath !== 'string') {
      const database = databaseOrPath;
      try {
        database.pragma('foreign_keys = ON');
        database.pragma('journal_mode = WAL');
        database.pragma('synchronous = FULL');
        database.pragma('secure_delete = ON');
        database.pragma('busy_timeout = 5000');
        SqlitePolicyRepository.migrate(database);
        return new SqlitePolicyRepository(database, database.name);
      } catch (error) {
        throw new Error('Policy database is unavailable.', { cause: error });
      }
    }

    const resolved = databaseOrPath === ':memory:' ? databaseOrPath : resolve(databaseOrPath);
    let database: Database.Database | undefined;
    try {
      if (resolved !== ':memory:') {
        mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
      }
      database = new Database(resolved, { timeout: 5000 });
      database.pragma('foreign_keys = ON');
      database.pragma('journal_mode = WAL');
      database.pragma('synchronous = FULL');
      database.pragma('secure_delete = ON');
      database.pragma('busy_timeout = 5000');
      SqlitePolicyRepository.migrate(database);

      if (resolved !== ':memory:') {
        try {
          chmodSync(resolved, 0o600);
        } catch {
          // Ignore permissions on filesystems not supporting chmod
        }
      }
      return new SqlitePolicyRepository(database, resolved);
    } catch (error) {
      try {
        database?.close();
      } catch {
        // retain initialization failure
      }
      throw new Error('Policy database is unavailable.', { cause: error });
    }
  }

  public healthCheck(): boolean {
    try {
      const result = this.database.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      return Number(result?.ok) === 1;
    } catch {
      return false;
    }
  }

  public async getPolicy(userId: string): Promise<UserPolicyRecord | undefined> {
    const row = this.database
      .prepare('SELECT * FROM user_policies WHERE user_id = ?')
      .get(userId) as PolicyRow | undefined;
    if (!row) return undefined;
    return parsePolicyRecord(row);
  }

  public async savePolicy(
    record: UserPolicyRecord,
    expectedVersion?: string
  ): Promise<UserPolicyRecord> {
    const saveTx = this.database.transaction((): UserPolicyRecord => {
      const existing = this.database
        .prepare('SELECT policy_version FROM user_policies WHERE user_id = ?')
        .get(record.userId) as { policy_version: string } | undefined;
      const activeVersion = existing ? existing.policy_version : '1.0.0';

      if (expectedVersion !== undefined) {
        if (expectedVersion !== activeVersion && expectedVersion !== '0.0.0') {
          throw new PolicyVersionConflictError(
            expectedVersion,
            existing ? existing.policy_version : '1.0.0'
          );
        }
      }

      const payloadJson = JSON.stringify(record.config);

      if (existing) {
        this.database
          .prepare(
            `UPDATE user_policies
             SET policy_version = ?, schema_version = ?, updated_at = ?, updated_by = ?, payload_json = ?
             WHERE user_id = ?`
          )
          .run(
            record.policyVersion,
            record.schemaVersion,
            record.updatedAt,
            record.updatedBy,
            payloadJson,
            record.userId
          );
      } else {
        this.database
          .prepare(
            `INSERT INTO user_policies (user_id, policy_version, schema_version, updated_at, updated_by, payload_json)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            record.userId,
            record.policyVersion,
            record.schemaVersion,
            record.updatedAt,
            record.updatedBy,
            payloadJson
          );
      }

      return record;
    });

    return saveTx.immediate();
  }

  public async getAuditHistory(
    userId: string,
    limit: number = 50
  ): Promise<readonly PolicyAuditRecord[]> {
    const rows = this.database
      .prepare(
        `SELECT * FROM user_policy_audit_log
         WHERE user_id = ?
         ORDER BY timestamp DESC, rowid DESC
         LIMIT ?`
      )
      .all(userId, Math.max(1, limit)) as AuditRow[];
    return Object.freeze(rows.map(parseAuditRecord));
  }

  public async recordAudit(audit: PolicyAuditRecord): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO user_policy_audit_log
         (id, user_id, updated_by, actor_role, timestamp, previous_version, new_version, changed_fields_json, summary, change_source, is_system_default, impact_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        audit.id,
        audit.userId,
        audit.updatedBy,
        audit.actorRole ?? 'USER',
        audit.timestamp,
        audit.previousPolicyVersion,
        audit.newPolicyVersion,
        JSON.stringify(audit.changedFields),
        audit.changeSummary,
        audit.changeSource ?? 'USER_CHANGE',
        audit.isSystemDefault ? 1 : 0,
        audit.impactSummary ?? null
      );
  }

  public close(): void {
    try {
      this.database.close();
    } catch {
      // already closed
    }
  }
}
