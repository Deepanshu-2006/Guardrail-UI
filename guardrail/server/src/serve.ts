import { startGuardrailHttpServer } from './http-server.js';
import { loadGuardrailServerConfig } from './runtime-config.js';
import { loadOidcTokenVerifierConfig, OidcTokenVerifier } from './oidc-token-verifier.js';
import { SqliteIdentityStore } from './identity-store.js';

async function main(): Promise<void> {
  const serverConfig = loadGuardrailServerConfig();
  const oidcConfig = loadOidcTokenVerifierConfig();
  const identities = SqliteIdentityStore.open(serverConfig.databasePath);
  let runtime: Awaited<ReturnType<typeof startGuardrailHttpServer>>;
  try {
    runtime = await startGuardrailHttpServer({
      tokenVerifier: new OidcTokenVerifier(oidcConfig, identities),
      databasePath: serverConfig.databasePath,
      host: serverConfig.host,
      port: serverConfig.port,
      routerConfig: serverConfig.allowedOrigins.length ? { allowedOrigins: serverConfig.allowedOrigins } : undefined,
    });
  } catch (error) {
    identities.close();
    throw error;
  }
  process.stdout.write(`Guardrail API listening on ${runtime.address.host}:${runtime.address.port}\n`);
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
