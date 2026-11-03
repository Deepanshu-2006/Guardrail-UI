import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TokenVerifier } from '../../extension/src/approval/api.js';
import { startGuardrailHttpServer } from './http-server.js';

async function main(): Promise<void> {
  const verifierModulePath = process.env.GUARDRAIL_AUTH_MODULE;
  if (!verifierModulePath || !isAbsolute(verifierModulePath)) {
    throw new Error('GUARDRAIL_AUTH_MODULE must point to an absolute host authentication adapter module.');
  }
  const adapter = await import(pathToFileURL(verifierModulePath).href) as { tokenVerifier?: TokenVerifier };
  if (!adapter.tokenVerifier || typeof adapter.tokenVerifier.verifyToken !== 'function') {
    throw new Error('The configured authentication adapter must export a TokenVerifier as tokenVerifier.');
  }
  const runtime = await startGuardrailHttpServer({ tokenVerifier: adapter.tokenVerifier });
  process.stdout.write(`Guardrail API listening on ${runtime.address.host}:${runtime.address.port}\n`);
  const shutdown = () => { void runtime.close().then(() => process.exit(0), () => process.exit(1)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Startup failed.';
  process.stderr.write(`Guardrail API startup failed: ${message}\n`);
  process.exitCode = 1;
});
