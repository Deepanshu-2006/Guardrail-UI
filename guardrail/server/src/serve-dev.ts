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
    host: '127.0.0.1',
  });

  // Setup SQLite Identity Store
  const identities = SqliteIdentityStore.open(serverConfig.databasePath);

  // Optional OIDC configuration if environment variables are provided
  const oidcConfig = tryLoadOidcTokenVerifierConfig(process.env);
  const oidcVerifier = oidcConfig ? new OidcTokenVerifier(oidcConfig, identities) : undefined;

  // Hybrid Token Verifier supporting real verified JWTs and development test tokens
  const tokenVerifier = new HybridTokenVerifier(oidcVerifier, true, {
    'test-ward-token': {
      actorId: 'usr_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    },
    'test-contact-token': {
      actorId: 'tc_carol',
      role: ActorRole.TRUSTED_CONTACT,
      isAuthenticated: true,
    },
  });

  // Shared SQLite contact registry persisting pairings and invitations
  const contactRegistry = SqliteTrustedContactRegistry.open(serverConfig.databasePath);

  // Ensure default identities and active pairing in SQLite
  const now = new Date().toISOString();
  const defaultCaretakerId = 'usr_dee1b4c0-542f-4b0f-ae3c-126115be972b';
  const defaultWardId = 'usr_deepanshukhatri20061972';

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
        VALUES (?, 'https://guardrail.local/dev', 'deepanshukhatri20061972@gmail.com', 'USER', 'ACTIVE', 'deepanshukhatri20061972@gmail.com', ?, ?)
      `).run(defaultWardId, now, now);

      db.prepare(`
        INSERT OR IGNORE INTO guardrail_users (id, issuer, subject, role, status, verified_email, created_at, updated_at)
        VALUES ('tc_carol', 'https://guardrail.local/dev', 'tc_carol', 'TRUSTED_CONTACT', 'ACTIVE', 'carol@guardrail.local', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT OR IGNORE INTO guardrail_users (id, issuer, subject, role, status, verified_email, created_at, updated_at)
        VALUES ('usr_alice', 'https://guardrail.local/dev', 'usr_alice', 'USER', 'ACTIVE', 'alice@guardrail.local', ?, ?)
      `).run(now, now);

      const contactPayload = {
        id: defaultCaretakerId,
        contactId: defaultCaretakerId,
        userId: defaultWardId,
        wardId: defaultWardId,
        wardName: 'Deepanshu Khatri',
        wardEmail: 'deepanshukhatri20061972@gmail.com',
        contactName: 'Deepanshu Khatri',
        contactEmail: 'deepanshukhatri20061972@gmail.com',
        contactAvatarUrl: 'https://img.clerk.com/eyJ0eXBlIjoicHJveHkiLCJzcmMiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NLZDNQRGk4NWtqbU42TERzYWhtZVljckxaQkUtdGFFUFNnXzdYd0FYSU1mRUd6clVFcz1zMTAwMC1jIiwicyI6InViRllhQ2hLbGtQS2FXR0hCTVRBODNqVmozVW5RV00zQ0FScVVnSTlxSWcifQ',
        relationshipLabel: 'Designated Caretaker',
        status: 'ACTIVE',
        createdAt: now,
      };

      db.prepare(`
        INSERT OR REPLACE INTO trusted_contacts (id, user_id, status, created_at, payload_json)
        VALUES (?, ?, 'ACTIVE', ?, ?)
      `).run(defaultCaretakerId, defaultWardId, now, JSON.stringify(contactPayload));

      const alicePayload = {
        ...contactPayload,
        userId: 'usr_alice',
        wardId: 'usr_alice',
        wardName: 'Alice Ward',
        wardEmail: 'alice@guardrail.local',
      };
      db.prepare(`
        INSERT OR REPLACE INTO trusted_contacts (id, user_id, status, created_at, payload_json)
        VALUES (?, 'usr_alice', 'ACTIVE', ?, ?)
      `).run(defaultCaretakerId, now, JSON.stringify(alicePayload));
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

  process.stdout.write(`\n======================================================\n`);
  process.stdout.write(`  🛡️  Guardrail Approval Backend Server Running\n`);
  process.stdout.write(`======================================================\n`);
  process.stdout.write(`  API URL:          http://${runtime.address.host}:${runtime.address.port}/\n`);
  process.stdout.write(`  Database:         ${serverConfig.databasePath}\n`);
  process.stdout.write(`  OIDC Issuer:      ${oidcConfig ? oidcConfig.issuer : 'None (Dev tokens active)'}\n`);
  process.stdout.write(`  Caretaker Token:  test-contact-token (Actor: tc_carol)\n`);
  process.stdout.write(`  Ward Token:       test-ward-token (Actor: usr_alice)\n\n`);

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
