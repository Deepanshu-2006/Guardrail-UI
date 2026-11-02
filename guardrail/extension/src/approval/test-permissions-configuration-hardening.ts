/**
 * Guardrail Permissions & Configuration Hardening Test Suite (Day 19 Prompt 5)
 *
 * Verifies that:
 * 1. Extension permissions in manifest.json are minimal and justified by actual feature usage.
 * 2. No premature or overly broad host permissions (e.g. wildcards) are declared.
 * 3. Insecure HTTP endpoints are rejected in production mode.
 * 4. Production builds default to HTTPS and fail safely on invalid or insecure configuration.
 * 5. Ephemeral development in-memory mocks are explicitly identified and never masquerade as production.
 * 6. Sensitive credentials, passwords, card numbers, OTPs, and tokens are detected and rejected.
 * 7. Release build configuration strips source maps and enables minification for production bundles.
 */

declare const process: { exit: (code: number) => void; exitCode?: number; env: Record<string, string | undefined> };

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ApprovalApiClient,
  DEFAULT_DEV_API_BASE_URL,
  DEFAULT_PROD_API_BASE_URL,
  resolveApiBaseUrl,
  checkPayloadForSensitiveFields,
  validateClientPayloadIntegrity,
} from './client.js';
import { PERSISTENCE_METADATA } from './repository.js';
import { ActionCategory, ActionType } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAILED: ${message}`);
    process.exitCode = 1;
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalTests++;
  if (actual === expected) {
    passedTests++;
    console.log(`  ✓ ${message}: ${String(actual)}`);
  } else {
    console.error(`  ✗ FAILED: ${message}. Expected "${String(expected)}", received "${String(actual)}"`);
    process.exitCode = 1;
  }
}

async function runTests(): Promise<void> {
  console.log('================================================================');
  console.log('Day 19 Prompt 5: Permissions and Configuration Hardening Suite');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // SECTION 1: Extension Permissions & Manifest Audit
  // ---------------------------------------------------------------------------
  console.log('--- 1. Manifest Permissions & Scope Verification ---');

  const extensionRoot = fs.existsSync(path.resolve(process.cwd(), 'public', 'manifest.json'))
    ? process.cwd()
    : path.resolve(__dirname, '..');

  const manifestPath = path.resolve(extensionRoot, 'public', 'manifest.json');
  assert(fs.existsSync(manifestPath), 'manifest.json exists at public/manifest.json');

  const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assertEquals(manifestContent.manifest_version, 3, 'Manifest is V3');

  // Check declared permissions
  assert(Array.isArray(manifestContent.permissions), 'Manifest declares permissions array');
  assert(
    manifestContent.permissions.includes('storage'),
    'Manifest declares required "storage" permission for policy/token persistence'
  );
  assertEquals(
    manifestContent.permissions.length,
    1,
    'Manifest permissions are strictly minimal (only ["storage"] declared)'
  );

  // Prohibited broad or sensitive permissions
  const unvettedPermissions = ['webRequest', 'cookies', 'debugger', 'management', 'proxy', 'declarativeNetRequest'];
  for (const perm of unvettedPermissions) {
    assert(
      !manifestContent.permissions.includes(perm),
      `Manifest does not request unvetted sensitive permission: "${perm}"`
    );
  }

  // Host permissions audit
  assert(
    manifestContent.host_permissions === undefined || manifestContent.host_permissions.length === 0,
    'Manifest does not declare broad or premature host_permissions without a verified backend'
  );

  // Content scripts matches scope
  assert(Array.isArray(manifestContent.content_scripts), 'Manifest declares content_scripts');
  assert(
    manifestContent.content_scripts.length > 0 &&
      manifestContent.content_scripts[0].matches.includes('<all_urls>'),
    'Content script scope matches <all_urls> to support all-page safety monitoring'
  );

  // ---------------------------------------------------------------------------
  // SECTION 2: Environment Endpoint Configuration & Production HTTPS Enforcement
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Environment Endpoint Configuration & HTTPS Enforcement ---');

  // Test 2.1: Dev mode defaults to http://localhost:3000
  const devClient = new ApprovalApiClient({ environment: 'development' });
  assertEquals(
    (devClient as any).baseUrl,
    DEFAULT_DEV_API_BASE_URL,
    'Development client defaults to localhost:3000'
  );

  // Test 2.2: Prod mode defaults to https://api.guardrail-safety.org
  const prodClient = new ApprovalApiClient({ environment: 'production' });
  assertEquals(
    (prodClient as any).baseUrl,
    DEFAULT_PROD_API_BASE_URL,
    'Production client defaults to production HTTPS endpoint'
  );

  // Test 2.3: Prod mode allows valid HTTPS custom base URL
  const customProdClient = new ApprovalApiClient({
    baseUrl: 'https://custom-api.guardrail.enterprise.internal',
    environment: 'production',
  });
  assertEquals(
    (customProdClient as any).baseUrl,
    'https://custom-api.guardrail.enterprise.internal',
    'Production client allows custom HTTPS base URL'
  );

  // Test 2.4: Prod mode strictly rejects cleartext HTTP base URL
  let insecureRejected = false;
  try {
    new ApprovalApiClient({
      baseUrl: 'http://insecure-api.guardrail.internal',
      environment: 'production',
    });
  } catch (err: any) {
    insecureRejected = true;
    assert(
      err?.message?.includes('Production endpoints must use HTTPS'),
      'Insecure URL error explicitly requires HTTPS in production'
    );
  }
  assert(insecureRejected, 'Production client constructor rejected cleartext http:// endpoint');

  // Test 2.5: Prod mode rejects invalid malformed URLs
  let invalidUrlRejected = false;
  try {
    new ApprovalApiClient({
      baseUrl: 'not-a-valid-url',
      environment: 'production',
    });
  } catch (err: any) {
    invalidUrlRejected = true;
  }
  assert(invalidUrlRejected, 'Production client constructor rejected malformed URL');

  // ---------------------------------------------------------------------------
  // SECTION 3: Base URL Resolver Multi-Environment Behavior
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Base URL Resolver Multi-Environment Behavior ---');

  // Test 3.1: resolveApiBaseUrl in development returns dev default
  const resolvedDev = await resolveApiBaseUrl({ environment: 'development' });
  assertEquals(resolvedDev, DEFAULT_DEV_API_BASE_URL, 'resolveApiBaseUrl returns dev default');

  // Test 3.2: resolveApiBaseUrl in production returns prod default
  const resolvedProd = await resolveApiBaseUrl({ environment: 'production' });
  assertEquals(resolvedProd, DEFAULT_PROD_API_BASE_URL, 'resolveApiBaseUrl returns prod default');

  // Test 3.3: resolveApiBaseUrl in production rejects insecure override
  let resolvedInsecureRejected = false;
  try {
    await resolveApiBaseUrl({
      customBaseUrl: 'http://insecure-override.example.com',
      environment: 'production',
    });
  } catch (err: any) {
    resolvedInsecureRejected = true;
    assert(
      err?.message?.includes('Production endpoints must use HTTPS'),
      'resolveApiBaseUrl rejects insecure HTTP in production'
    );
  }
  assert(resolvedInsecureRejected, 'resolveApiBaseUrl strictly prevented insecure HTTP override in production');

  // Test 3.4: resolveApiBaseUrl accepts valid HTTPS override in production
  const resolvedHttpsOverride = await resolveApiBaseUrl({
    customBaseUrl: 'https://secure-override.example.com',
    environment: 'production',
  });
  assertEquals(
    resolvedHttpsOverride,
    'https://secure-override.example.com',
    'resolveApiBaseUrl accepted secure HTTPS override in production'
  );

  // ---------------------------------------------------------------------------
  // SECTION 4: Development Mock Identification & Safeguards
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Mock Service & In-Memory Storage Identification ---');

  assertEquals(
    PERSISTENCE_METADATA.IS_PRODUCTION,
    false,
    'Development repository metadata explicitly indicates IS_PRODUCTION = false'
  );
  assertEquals(
    PERSISTENCE_METADATA.TYPE,
    'EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY',
    'Repository persistence is explicitly classified as EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY'
  );
  assert(
    PERSISTENCE_METADATA.LIMITATIONS.length > 0,
    'Repository explicitly lists in-memory concurrency and crash recovery limitations'
  );

  // ---------------------------------------------------------------------------
  // SECTION 5: Secret Redaction & Sensitive Data Protection
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Secret Redaction & Sensitive Field Detection ---');

  // Test 5.1: checkPayloadForSensitiveFields catches various forbidden keys
  const sensitivePayload = {
    actionType: 'form_submission',
    userCredentials: {
      password: 'superSecretPassword123',
    },
    payment: {
      cardNumber: '4111222233334444',
      cvv: '123',
    },
    verification: {
      otp: '987654',
      token: 'jwt.token.here',
    },
  };

  const detectedSensitive = checkPayloadForSensitiveFields(sensitivePayload);
  assert(detectedSensitive.includes('userCredentials.password'), 'Detected nested password field');
  assert(detectedSensitive.includes('payment.cardNumber'), 'Detected nested cardNumber field');
  assert(detectedSensitive.includes('payment.cvv'), 'Detected nested cvv field');
  assert(detectedSensitive.includes('verification.otp'), 'Detected nested otp field');
  assert(detectedSensitive.includes('verification.token'), 'Detected nested token field');

  // Test 5.2: validateClientPayloadIntegrity rejects payload with sensitive data
  const clientPayloadWithSensitive = {
    actionId: 'act-test-sec-01',
    actionType: ActionType.CLICK,
    actionCategory: ActionCategory.DOM_MUTATION,
    riskLevel: RiskLevel.HIGH,
    riskReasons: ['Sensitive action test'],
    pageUrl: 'https://example.com/checkout',
    targetDomain: 'example.com',
    metadata: {
      password: 'forbidden-password',
    },
  };

  const violations = validateClientPayloadIntegrity(clientPayloadWithSensitive);
  assert(
    violations.some((v) => v.includes('Forbidden sensitive property "metadata.password"')),
    'validateClientPayloadIntegrity rejects payload containing forbidden password property'
  );

  // ---------------------------------------------------------------------------
  // SECTION 6: Package Scripts and Build Configuration Hardening
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Package Scripts & Build Configuration ---');

  const pkgPath = path.resolve(extensionRoot, 'package.json');
  const pkgContent = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert(pkgContent.scripts['build:prod'] !== undefined, 'package.json defines "build:prod" script');
  assert(pkgContent.scripts['audit'] !== undefined, 'package.json defines "audit" script');
  assert(pkgContent.scripts['test:permissions-config'] !== undefined, 'package.json defines "test:permissions-config" script');
  assert(
    pkgContent.scripts['test'].includes('test:permissions-config'),
    'Root test suite includes permissions and configuration hardening tests'
  );

  // Test build script configuration
  const buildScriptPath = path.resolve(extensionRoot, 'build.mjs');
  const buildScriptContent = fs.readFileSync(buildScriptPath, 'utf8');
  assert(
    buildScriptContent.includes('isProd') && buildScriptContent.includes('--prod'),
    'build.mjs handles --prod flag'
  );
  assert(
    buildScriptContent.includes('sourcemap: !isProd'),
    'build.mjs strips sourcemaps in production mode'
  );
  assert(
    buildScriptContent.includes('minify: isProd'),
    'build.mjs enables minification in production mode'
  );

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
  console.log('================================================================');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in permissions/config test suite:', err);
  process.exit(1);
});
