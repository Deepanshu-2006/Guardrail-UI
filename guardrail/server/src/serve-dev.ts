import { startGuardrailHttpServer } from './http-server.js';
import { loadGuardrailServerConfig } from './runtime-config.js';
import { InMemoryTrustedContactRegistry, TrustedContactStatus, ActorRole } from '../../extension/src/approval/authorization.js';
import { SqliteTrustedContactRegistry } from './sqlite-trusted-contact-registry.js';
import { SqliteIdentityStore } from './identity-store.js';
import { tryLoadOidcTokenVerifierConfig, OidcTokenVerifier, HybridTokenVerifier } from './oidc-token-verifier.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

async function main(): Promise<void> {
  // Load dashboard .env.local if present into process.env for local dev
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), '../dashboard/.env.local'),
      path.resolve(process.cwd(), 'guardrail/dashboard/.env.local'),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dashboard/.env.local'),
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), 'guardrail/server/.env'),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const envFile = fs.readFileSync(p, 'utf-8');
        for (const line of envFile.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [key, ...rest] = trimmed.split('=');
            const val = rest.join('=').trim();
            if (key && !process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      }
    }
  } catch {
    // optional .env.local
  }

  const serverConfig = loadGuardrailServerConfig(process.env, {
    port: 3000,
    host: 'localhost',
  });

  // Setup SQLite Identity Store
  const identities = SqliteIdentityStore.open(serverConfig.databasePath);

  // Optional OIDC configuration if environment variables are provided
  const oidcConfig = tryLoadOidcTokenVerifierConfig(process.env);
  const oidcVerifier = oidcConfig ? new OidcTokenVerifier(oidcConfig, identities) : undefined;

  const defaultCaretakerId = 'usr_dee1b4c0-542f-4b0f-ae3c-126115be972b';
  const defaultWardId = 'usr_deepanshukhatri20061972';

  // Hybrid Token Verifier supporting real verified JWTs and development test tokens
  const tokenVerifier = new HybridTokenVerifier(oidcVerifier, true, {
    'test-ward-token': {
      actorId: defaultWardId,
      role: ActorRole.USER,
      isAuthenticated: true,
    },
    'test-contact-token': {
      actorId: defaultCaretakerId,
      role: ActorRole.TRUSTED_CONTACT,
      isAuthenticated: true,
    },
  });

  // Shared SQLite contact registry persisting pairings and invitations
  const contactRegistry = SqliteTrustedContactRegistry.open(serverConfig.databasePath);

  // Ensure default identities and active pairing in SQLite
  const now = new Date().toISOString();

  try {
    const db = (contactRegistry as any).database;
    if (db) {
      db.prepare(`
        INSERT OR REPLACE INTO guardrail_users (id, issuer, subject, role, status, verified_email, created_at, updated_at)
        VALUES (?, 'https://harmless-snipe-9044.clerk.accounts.dev', 'user_3MTvOw2echwPHpvKnstk2aCqa8Y', 'TRUSTED_CONTACT', 'ACTIVE', 'deepanshukhatri20061972@gmail.com', ?, ?)
      `).run(defaultCaretakerId, now, now);

      db.prepare(`
        INSERT OR REPLACE INTO guardrail_users (id, issuer, subject, role, status, verified_email, created_at, updated_at)
        VALUES ('usr_7f7f1ef5-ef7b-4a77-84cc-d36a38b26e76', 'https://harmless-snipe-9044.clerk.accounts.dev', 'user_3MGvG7TeQ9MFvJfMQwrlxmuvqCK', 'TRUSTED_CONTACT', 'ACTIVE', 'deepanshukhatri20061972@gmail.com', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT OR IGNORE INTO guardrail_users (id, issuer, subject, role, status, verified_email, created_at, updated_at)
        VALUES ('usr_alice', 'https://guardrail.local/dev', 'alice.johnson@example.com', 'USER', 'ACTIVE', 'alice.johnson@example.com', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT OR IGNORE INTO guardrail_users (id, issuer, subject, role, status, verified_email, created_at, updated_at)
        VALUES ('usr_bob', 'https://guardrail.local/dev', 'bob.williams@example.com', 'USER', 'ACTIVE', 'bob.williams@example.com', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT OR IGNORE INTO guardrail_users (id, issuer, subject, role, status, verified_email, created_at, updated_at)
        VALUES (?, 'https://guardrail.local/dev', 'deepanshukhatri20061972@gmail.com', 'USER', 'ACTIVE', 'deepanshukhatri20061972@gmail.com', ?, ?)
      `).run(defaultWardId, now, now);

      db.prepare(`
        INSERT OR IGNORE INTO guardrail_users (id, issuer, subject, role, status, verified_email, created_at, updated_at)
        VALUES ('tc_carol', 'https://guardrail.local/dev', 'tc_carol', 'TRUSTED_CONTACT', 'ACTIVE', 'carol@guardrail.local', ?, ?)
      `).run(now, now);

      db.exec(`
        CREATE TABLE IF NOT EXISTS server_seed_meta (key TEXT PRIMARY KEY, value TEXT);
      `);
      const contactCount = (db.prepare("SELECT COUNT(DISTINCT user_id) as count FROM trusted_contacts WHERE status = 'ACTIVE'").get() as { count: number })?.count ?? 0;
      const caretakerRows = db.prepare("SELECT id FROM guardrail_users WHERE role = 'TRUSTED_CONTACT' AND status = 'ACTIVE'").all() as { id: string }[];
      const caretakerIds = Array.from(new Set([
        defaultCaretakerId,
        'usr_7f7f1ef5-ef7b-4a77-84cc-d36a38b26e76',
        'tc_carol',
        ...caretakerRows.map((r) => r.id),
      ]));

      const devWards = [
        {
          wardId: 'usr_alice',
          wardName: 'Alice Johnson',
          wardEmail: 'alice.johnson@example.com',
          relationshipLabel: 'Family Guardian',
        },
        {
          wardId: 'usr_bob',
          wardName: 'Bob Williams',
          wardEmail: 'bob.williams@example.com',
          relationshipLabel: 'Designated Caretaker',
        },
        {
          wardId: defaultWardId,
          wardName: 'Deepanshu Khatri',
          wardEmail: 'deepanshukhatri20061972@gmail.com',
          relationshipLabel: 'Designated Caretaker',
        },
      ];

      const insertContactStmt = db.prepare(`
        INSERT OR IGNORE INTO trusted_contacts (id, user_id, status, created_at, payload_json)
        VALUES (?, ?, 'ACTIVE', ?, ?)
      `);

      for (const caretakerId of caretakerIds) {
        const existingForCaretaker = (db.prepare("SELECT COUNT(*) as count FROM trusted_contacts WHERE id = ? AND status = 'ACTIVE'").get(caretakerId) as { count: number })?.count ?? 0;
        if (contactCount < 2 || existingForCaretaker === 0) {
          for (const w of devWards) {
            const payload = {
              id: caretakerId,
              contactId: caretakerId,
              userId: w.wardId,
              wardId: w.wardId,
              wardName: w.wardName,
              wardEmail: w.wardEmail,
              contactName: 'Deepanshu Khatri',
              contactEmail: 'deepanshukhatri20061972@gmail.com',
              contactAvatarUrl: 'https://img.clerk.com/eyJ0eXBlIjoicHJveHkiLCJzcmMiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NLZDNQRGk4NWtqbU42TERzYWhtZVljckxaQkUtdGFFUFNnXzdYd0FYSU1mRUd6clVFcz1zMTAwMC1jIiwicyI6InViRllhQ2hLbGtQS2FXR0hCTVRBODNqVmozVW5RV00zQ0FScVVnSTlxSWcifQ',
              relationshipLabel: w.relationshipLabel,
              status: 'ACTIVE',
              createdAt: now,
            };
            insertContactStmt.run(caretakerId, w.wardId, now, JSON.stringify(payload));
          }
        }
      }
      db.prepare("INSERT OR REPLACE INTO server_seed_meta (key, value) VALUES ('initial_contact_seeded', 'true')").run();
    }
  } catch (err) {
    console.warn('[serve-dev] Contact seed error:', err);
  }

  const runtime = await startGuardrailHttpServer({
    tokenVerifier,
    databasePath: serverConfig.databasePath,
    host: serverConfig.host,
    port: serverConfig.port,
    contactRegistry,
    identities,
    oidcConfig,
    routerConfig: {
      allowedOrigins: ['*'],
    },
  });

  // Seed multi-ward pending approval requests & decision history after tables are initialized
  try {
    const db = (contactRegistry as any).database;
    if (db) {
      const reqCount = (db.prepare("SELECT COUNT(*) as count FROM approval_requests").get() as { count: number })?.count ?? 0;
      const historyCount = (db.prepare("SELECT COUNT(*) as count FROM approval_requests WHERE status != 'PENDING'").get() as { count: number })?.count ?? 0;
      if (reqCount < 4 || historyCount < 2) {
        const createdMs = Date.now();
        const futureIso = new Date(createdMs + 48 * 60 * 60 * 1000).toISOString();
        const seedRequests = [
          {
            id: 'apr_alice_001',
            actionId: 'act_alice_001',
            requesterId: 'usr_alice',
            actionType: 'SUBMIT',
            category: 'PAYMENT',
            actionDescription: 'Send Wire Transfer to Landlord ($1,200.00)',
            origin: 'https://secure.chase.com',
            hostname: 'secure.chase.com',
            pageTitle: 'Wire Transfers — Chase Online',
            riskLevel: 'HIGH',
            status: 'PENDING',
            createdAt: new Date(createdMs - 18 * 60 * 1000).toISOString(),
            expiresAt: futureIso,
            riskReasons: [
              'Wire transfer exceeds safety threshold.',
              'Destination account is an unverified external entity.',
            ],
          },
          {
            id: 'apr_bob_001',
            actionId: 'act_bob_001',
            requesterId: 'usr_bob',
            actionType: 'SUBMIT',
            category: 'PAYMENT',
            actionDescription: 'Purchase Gaming Console Bundle ($499.99)',
            origin: 'https://www.amazon.com',
            hostname: 'www.amazon.com',
            pageTitle: 'Checkout — Amazon.com',
            riskLevel: 'MEDIUM',
            status: 'PENDING',
            createdAt: new Date(createdMs - 12 * 60 * 1000).toISOString(),
            expiresAt: futureIso,
            riskReasons: [
              'High-value e-commerce checkout transaction on amazon.com.',
            ],
          },
          {
            id: 'apr_deepanshu_001',
            actionId: 'act_deepanshu_001',
            requesterId: defaultWardId,
            actionType: 'CLICK',
            category: 'AUTHENTICATION',
            actionDescription: 'Authorize Third-Party OAuth API Token Access',
            origin: 'https://console.cloud.google.com',
            hostname: 'console.cloud.google.com',
            pageTitle: 'OAuth Consent — Google Cloud Console',
            riskLevel: 'CRITICAL',
            status: 'PENDING',
            createdAt: new Date(createdMs - 5 * 60 * 1000).toISOString(),
            expiresAt: futureIso,
            riskReasons: [
              'Grants persistent read/write API access to an external application.',
            ],
          },
          {
            id: 'apr_alice_002',
            actionId: 'act_alice_002',
            requesterId: 'usr_alice',
            actionType: 'CLICK',
            category: 'AUTHENTICATION',
            actionDescription: 'Sign in to Student Loan Account',
            origin: 'https://studentaid.gov',
            hostname: 'studentaid.gov',
            pageTitle: 'Federal Student Aid Sign In',
            riskLevel: 'LOW',
            status: 'APPROVED',
            createdAt: new Date(createdMs - 5 * 60 * 60 * 1000).toISOString(),
            expiresAt: futureIso,
            resolvedAt: new Date(createdMs - 4.5 * 60 * 60 * 1000).toISOString(),
            decision: {
              decision: 'APPROVED',
              decidedBy: 'usr_7f7f1ef5-ef7b-4a77-84cc-d36a38b26e76',
              decidedAt: new Date(createdMs - 4.5 * 60 * 60 * 1000).toISOString(),
              decisionReason: 'Verified educational service sign-in',
            },
            riskReasons: ['Standard educational service authentication.'],
          },
          {
            id: 'apr_bob_002',
            actionId: 'act_bob_002',
            requesterId: 'usr_bob',
            actionType: 'CLICK',
            category: 'DOWNLOAD',
            actionDescription: 'Download Unverified System Utility Installer',
            origin: 'https://soft-mirror-cdn.example.net',
            hostname: 'soft-mirror-cdn.example.net',
            pageTitle: 'Download Mirror — System Utility',
            riskLevel: 'HIGH',
            status: 'REJECTED',
            createdAt: new Date(createdMs - 3 * 60 * 60 * 1000).toISOString(),
            expiresAt: futureIso,
            resolvedAt: new Date(createdMs - 2.8 * 60 * 60 * 1000).toISOString(),
            decision: {
              decision: 'REJECTED',
              decidedBy: 'usr_7f7f1ef5-ef7b-4a77-84cc-d36a38b26e76',
              decidedAt: new Date(createdMs - 2.8 * 60 * 60 * 1000).toISOString(),
              decisionReason: 'Unverified executable mirror flagged by safety review.',
            },
            riskReasons: [
              'Executable installer hosted on an unverified third-party mirror.',
            ],
          },
          {
            id: 'apr_deepanshu_002',
            actionId: 'act_deepanshu_002',
            requesterId: defaultWardId,
            actionType: 'SUBMIT',
            category: 'PAYMENT',
            actionDescription: 'Confirm Cloud Workspace Plan Renewal ($49.00)',
            origin: 'https://billing.stripe.com',
            hostname: 'billing.stripe.com',
            pageTitle: 'Stripe Billing Portal',
            riskLevel: 'MEDIUM',
            status: 'APPROVED',
            createdAt: new Date(createdMs - 90 * 60 * 1000).toISOString(),
            expiresAt: futureIso,
            resolvedAt: new Date(createdMs - 85 * 60 * 1000).toISOString(),
            decision: {
              decision: 'APPROVED',
              decidedBy: 'usr_7f7f1ef5-ef7b-4a77-84cc-d36a38b26e76',
              decidedAt: new Date(createdMs - 85 * 60 * 1000).toISOString(),
              decisionReason: 'Expected recurring billing renewal.',
            },
            riskReasons: ['Recurring subscription charge authorization.'],
          },
        ];
        const insertReqStmt = db.prepare(`
          INSERT OR IGNORE INTO approval_requests (id, requester_id, action_id, status, created_at, expires_at, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of seedRequests) {
          insertReqStmt.run(r.id, r.requesterId, r.actionId, r.status, r.createdAt, r.expiresAt, JSON.stringify(r));
        }
      }
    }
  } catch (err) {
    console.warn('[serve-dev] Approval request seed error:', err);
  }

  process.stdout.write(`\n======================================================\n`);
  process.stdout.write(`  🛡️  Guardrail Approval Backend Server Running\n`);
  process.stdout.write(`======================================================\n`);
  process.stdout.write(`  API URL:          http://${runtime.address.host}:${runtime.address.port}/\n`);
  process.stdout.write(`  Database:         ${serverConfig.databasePath}\n`);
  process.stdout.write(`  OIDC Issuer:      ${oidcConfig ? oidcConfig.issuer : 'None (Dev tokens active)'}\n`);
  process.stdout.write(`  Caretaker Token:  test-contact-token (Actor: tc_carol)\n`);
  process.stdout.write(`  Ward Token:       test-ward-token (Actor: ${defaultWardId})\n\n`);

  const shutdown = () => {
    void runtime.close().then(() => {
      identities.close();
      process.exit(0);
    }, () => process.exit(1));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Startup failed.';
  process.stderr.write(`Guardrail API startup failed: ${message}\n`);
  process.exitCode = 1;
});
