import { startGuardrailHttpServer } from './http-server.js';
import { loadGuardrailServerConfig } from './runtime-config.js';
import { InMemoryTrustedContactRegistry, TrustedContactStatus, ActorRole } from '../../extension/src/approval/authorization.js';
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
        break;
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

  // Contact registry with designated development caretaker relationship
  const contactRegistry = new InMemoryTrustedContactRegistry();
  contactRegistry.addContact({
    id: 'tc_carol',
    userId: 'usr_alice',
    relationshipLabel: 'Designated Caretaker',
    status: TrustedContactStatus.ACTIVE,
    createdAt: new Date().toISOString(),
  });

  // Pre-seed the pairing invitation code from the extension popup as open wildcard
  try {
    contactRegistry.createInvitation('usr_alice', {
      customCode: 'GR-INV-U6GA-4WZY',
      recipientActorId: '*',
      relationshipLabel: 'Family Guardian',
    });
  } catch {
    // Ignore if already present
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
