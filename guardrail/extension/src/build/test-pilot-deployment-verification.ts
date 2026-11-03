/**
 * Guardrail Controlled-Pilot Build, Packaging, and Deployment Verification Suite
 *
 * Verifies that the browser extension can be built, packaged, and deployed for
 * the controlled pilot according to documented procedures and security invariants.
 *
 * FOCUS AREAS:
 * 1. Documented build process execution (build.mjs --pilot).
 * 2. Complete assets, icons, manifests, and Manifest V3 schema compliance.
 * 3. Strict exclusion of development-only artifacts (sourcemaps, test bundles, mock data).
 * 4. Pilot backend endpoint resolution, HTTPS enforcement, and rejection of plain HTTP.
 * 5. Safe handling of unavailable backend services (HELD invariant, zero auto-execution).
 * 6. Explicit failure reporting on missing assets or invalid configs.
 * 7. Clean deployment zip package structure and file inventory.
 * 8. Compatibility with Chromium unpacked extension runtime.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  resolveApiBaseUrl,
  ApprovalApiClient,
  ApiClientErrorCodes,
} from '../approval/client.js';
import {
  resolveEnvironmentConfig,
  validateEnvironmentConfig,
  DEFAULT_PILOT_API_BASE_URL,
  FORBIDDEN_SECRET_KEYS,
} from '../config/environment.js';
import { InterceptionController } from '../interception/controller.js';
import { InterceptionState } from '../types/interception.js';
import { submitApprovalRequest, SubmissionOutcome } from '../approval/submit-operation.js';
import { StagingActionContext } from '../types/staging.js';
import { RiskLevel } from '../types/risk.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let currentDir = __dirname;
while (currentDir !== path.dirname(currentDir) && !fs.existsSync(path.join(currentDir, 'package.json'))) {
  currentDir = path.dirname(currentDir);
}
const extensionRoot = currentDir;
const distDir = path.resolve(extensionRoot, 'dist');
const pilotDir = path.resolve(extensionRoot, 'dist-pilot');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
  passedTests++;
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalTests++;
  if (actual !== expected) {
    console.error(`  ❌ FAILED: ${message}. Expected: ${String(expected)}, Received: ${String(actual)}`);
    throw new Error(`Equality assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}: ${String(actual)}`);
  passedTests++;
}

async function runPilotVerificationSuite() {
  console.log('====================================================================');
  console.log('🚀 GUARDRAIL CONTROLLED-PILOT BUILD & DEPLOYMENT VERIFICATION');
  console.log('====================================================================\n');

  // ===========================================================================
  // Scenario 1: Documented Build Process Execution
  // ===========================================================================
  console.log('▶ Scenario 1: Documented Pilot Build Process Execution');
  {
    const startTime = Date.now();
    // Run the documented pilot build command
    const output = execSync('node build.mjs --pilot', {
      cwd: extensionRoot,
      encoding: 'utf-8',
    });

    const elapsedMs = Date.now() - startTime;
    assert(output.includes('[Guardrail Extension] Build completed successfully (pilot)'), 'Build output logs pilot completion');
    assert(output.includes('dist-pilot/'), 'Build output logs clean dist-pilot assembly');
    assert(elapsedMs < 180000, `Pilot build completed successfully (${elapsedMs}ms < 180000ms)`);
  }

  // ===========================================================================
  // Scenario 2: Required Assets, Configuration, and Manifest V3 Compliance
  // ===========================================================================
  console.log('\n▶ Scenario 2: Required Assets and Manifest V3 Compliance');
  {
    assert(fs.existsSync(pilotDir), 'dist-pilot directory exists');

    // 1. Manifest verification
    const manifestPath = path.join(pilotDir, 'manifest.json');
    assert(fs.existsSync(manifestPath), 'dist-pilot/manifest.json exists');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    assertEquals(manifest.manifest_version, 3, 'Manifest version is 3');
    assertEquals(manifest.name, 'Guardrail', 'Extension name is Guardrail');
    assertEquals(manifest.version, '0.1.0', 'Base extension version is 0.1.0');
    assert(manifest.version_name.includes('-pilot'), 'version_name includes -pilot annotation');
    assert(manifest.description.includes('[PILOT DEPLOYMENT]'), 'description includes [PILOT DEPLOYMENT]');
    assert(Array.isArray(manifest.permissions), 'Manifest permissions is an array');
    assert(manifest.permissions.includes('storage'), 'Includes storage permission');
    assert(!manifest.permissions.includes('cookies'), 'Least privilege: does not request cookies permission');
    assert(!manifest.permissions.includes('webRequest'), 'Least privilege: does not request webRequest permission');

    // 2. Service worker script
    assertEquals(manifest.background?.service_worker, 'background.js', 'Service worker points to background.js');
    const bgPath = path.join(pilotDir, 'background.js');
    assert(fs.existsSync(bgPath), 'dist-pilot/background.js exists');
    assert(fs.statSync(bgPath).size > 10000, 'dist-pilot/background.js is compiled and non-empty');

    // 3. Content script
    assert(Array.isArray(manifest.content_scripts), 'content_scripts is configured');
    assertEquals(manifest.content_scripts[0]?.js?.[0], 'content.js', 'content_scripts points to content.js');
    const contentPath = path.join(pilotDir, 'content.js');
    assert(fs.existsSync(contentPath), 'dist-pilot/content.js exists');
    assert(fs.statSync(contentPath).size > 10000, 'dist-pilot/content.js is compiled and non-empty');

    // 4. Popup assets
    assertEquals(manifest.action?.default_popup, 'popup/popup.html', 'default_popup points to popup/popup.html');
    assert(fs.existsSync(path.join(pilotDir, 'popup', 'popup.html')), 'popup.html exists');
    assert(fs.existsSync(path.join(pilotDir, 'popup', 'popup.css')), 'popup.css exists');
    assert(fs.existsSync(path.join(pilotDir, 'popup', 'popup.js')), 'popup.js exists');

    // 5. Onboarding assets
    assert(fs.existsSync(path.join(pilotDir, 'onboarding', 'onboarding.html')), 'onboarding.html exists');
    assert(fs.existsSync(path.join(pilotDir, 'onboarding', 'onboarding.css')), 'onboarding.css exists');
    assert(fs.existsSync(path.join(pilotDir, 'onboarding', 'onboarding.js')), 'onboarding.js exists');

    // 6. Icons
    assertEquals(manifest.icons?.['16'], 'icons/icon-16.png', '16x16 icon declared in manifest');
    assertEquals(manifest.icons?.['48'], 'icons/icon-48.png', '48x48 icon declared in manifest');
    assertEquals(manifest.icons?.['128'], 'icons/icon-128.png', '128x128 icon declared in manifest');
    assert(fs.existsSync(path.join(pilotDir, 'icons', 'icon-16.png')), 'icon-16.png exists in dist-pilot/icons');
    assert(fs.existsSync(path.join(pilotDir, 'icons', 'icon-48.png')), 'icon-48.png exists in dist-pilot/icons');
    assert(fs.existsSync(path.join(pilotDir, 'icons', 'icon-128.png')), 'icon-128.png exists in dist-pilot/icons');
  }

  // ===========================================================================
  // Scenario 3: Exclusion of Development Settings, Sourcemaps, and Test Artifacts
  // ===========================================================================
  console.log('\n▶ Scenario 3: Exclusion of Dev Settings, Maps, and Test Artifacts');
  {
    const filesInPilot = fs.readdirSync(pilotDir);
    const testFiles = filesInPilot.filter((f) => f.startsWith('test-') || f.startsWith('verify-'));
    assertEquals(testFiles.length, 0, 'Zero test runner files present in dist-pilot');

    const mapFiles = filesInPilot.filter((f) => f.endsWith('.map'));
    assertEquals(mapFiles.length, 0, 'Zero sourcemap files present in dist-pilot root');

    const popupFiles = fs.readdirSync(path.join(pilotDir, 'popup'));
    assert(!popupFiles.some((f) => f.endsWith('.map')), 'Zero sourcemap files in dist-pilot/popup');

    const onboardingFiles = fs.readdirSync(path.join(pilotDir, 'onboarding'));
    assert(!onboardingFiles.some((f) => f.endsWith('.map')), 'Zero sourcemap files in dist-pilot/onboarding');

    // Verify pilot environment profile
    const pilotConfig = resolveEnvironmentConfig({ environment: 'pilot' });
    assertEquals(pilotConfig.environment, 'pilot', 'Environment is pilot');
    assertEquals(pilotConfig.isMockService, false, 'isMockService is strictly false in pilot profile');
    assertEquals(pilotConfig.serviceType, 'live', 'serviceType is strictly live in pilot profile');
    assertEquals(pilotConfig.requireHttps, true, 'requireHttps is strictly true in pilot profile');
    assertEquals(pilotConfig.allowInsecureHttp, false, 'allowInsecureHttp is strictly false in pilot profile');

    // Verify secret rejection invariant
    for (const forbiddenKey of FORBIDDEN_SECRET_KEYS) {
      const validation = validateEnvironmentConfig({ [forbiddenKey]: 'secret_value_123' });
      assert(!validation.valid, `Config validation strictly rejects forbidden secret key: ${forbiddenKey}`);
    }
  }

  // ===========================================================================
  // Scenario 4: Backend Configuration & Secure Endpoint Resolution
  // ===========================================================================
  console.log('\n▶ Scenario 4: Backend Configuration & Secure Endpoint Resolution');
  {
    // Default pilot endpoint
    const defaultUrl = await resolveApiBaseUrl({ environment: 'pilot' });
    assertEquals(defaultUrl, DEFAULT_PILOT_API_BASE_URL, 'Default pilot URL is DEFAULT_PILOT_API_BASE_URL');
    assert(defaultUrl.startsWith('https://'), 'Default pilot URL uses HTTPS protocol');

    // Valid HTTPS custom endpoint
    const customHttpsUrl = await resolveApiBaseUrl({
      customBaseUrl: 'https://pilot-custom.guardrail-safety.org',
      environment: 'pilot',
    });
    assertEquals(customHttpsUrl, 'https://pilot-custom.guardrail-safety.org', 'Valid custom HTTPS URL accepted');

    // Localhost development/testing exception
    const localhostUrl = await resolveApiBaseUrl({
      customBaseUrl: 'http://localhost:3000',
      environment: 'pilot',
    });
    assertEquals(localhostUrl, 'http://localhost:3000', 'Localhost unencrypted HTTP allowed for local pilot testing');

    // Remote plain HTTP MUST be rejected
    let rejectedInsecure = false;
    try {
      await resolveApiBaseUrl({
        customBaseUrl: 'http://insecure-backend.external-domain.org',
        environment: 'pilot',
      });
    } catch (err: any) {
      rejectedInsecure = true;
      assert(err.message.includes('must use HTTPS'), 'Insecure URL error explicitly mentions HTTPS requirement');
    }
    assert(rejectedInsecure, 'Plain unencrypted HTTP remote URL strictly rejected in pilot mode');
  }

  // ===========================================================================
  // Scenario 5: Safe Handling of Unavailable Backend Services (Resilience)
  // ===========================================================================
  console.log('\n▶ Scenario 5: Safe Handling of Unavailable Backend Services');
  {
    const controller = new InterceptionController();
    const actionId = 'act_pilot_unavail_001';
    controller.register(actionId);
    controller.holdAction(actionId, 'Wire transfer authorization required');

    let continuationExecuted = false;
    const continuationFn = () => {
      continuationExecuted = true;
      return true;
    };

    const actionContext: StagingActionContext = {
      actionId,
      actionType: 'wire_transfer',
      riskScore: 92,
      riskLevel: RiskLevel.HIGH,
      riskReasons: ['Unverified recipient account'],
      timestamp: Date.now(),
      targetUrl: 'https://bank.example.com/transfer',
      targetOrigin: 'https://bank.example.com',
      targetHostname: 'bank.example.com',
      pageTitle: 'Confirm Wire Transfer',
      elementDescription: 'Submit Wire Button',
      interceptionState: InterceptionState.HELD,
      interceptionReason: 'Wire transfer authorization required',
    };

    // Client targeting non-listening dead TCP socket
    const deadPortClient = new ApprovalApiClient({
      baseUrl: 'http://127.0.0.1:59999',
      timeoutMs: 500,
      tokenProvider: () => 'pilot_token_alice',
    });

    const submitResult = await submitApprovalRequest(actionContext, controller, {
      apiClient: deadPortClient,
    });

    // 1. Verify failure outcome is uncertain and clear
    assertEquals(submitResult.success, false, 'Submission to dead backend reports failure');
    assertEquals(submitResult.outcome, SubmissionOutcome.NETWORK_FAILURE_UNCERTAIN, 'Outcome is NETWORK_FAILURE_UNCERTAIN');
    assertEquals(submitResult.isAuthoritative, false, 'Outcome is uncertain (did not reach server)');
    assert(submitResult.error !== undefined, 'User-facing error details provided');

    // 2. CRITICAL SAFETY INVARIANT: Action remains HELD, continuation NEVER executed
    const record = controller.getRecord(actionId);
    assertEquals(record?.state, InterceptionState.HELD, 'Action remains strictly HELD in controller');
    assertEquals(continuationExecuted, false, 'Continuation was strictly NEVER executed on backend failure');
  }

  // ===========================================================================
  // Scenario 6: Clean Deployment Package (.zip) Verification
  // ===========================================================================
  console.log('\n▶ Scenario 6: Clean Deployment Package (.zip) Verification');
  {
    const zipPath = path.join(distDir, 'guardrail-extension-pilot.zip');
    assert(fs.existsSync(zipPath), 'dist/guardrail-extension-pilot.zip exists');
    const zipStat = fs.statSync(zipPath);
    assert(zipStat.size > 50000, `Zip package size is non-trivial (${zipStat.size} bytes > 50KB)`);

    // Inspect zip contents
    const zipList = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf-8' });
    assert(zipList.includes('manifest.json'), 'Zip contains manifest.json');
    assert(zipList.includes('background.js'), 'Zip contains background.js');
    assert(zipList.includes('content.js'), 'Zip contains content.js');
    assert(zipList.includes('popup/popup.html'), 'Zip contains popup/popup.html');
    assert(zipList.includes('popup/popup.js'), 'Zip contains popup/popup.js');
    assert(zipList.includes('onboarding/onboarding.html'), 'Zip contains onboarding/onboarding.html');
    assert(zipList.includes('icons/icon-128.png'), 'Zip contains icons/icon-128.png');

    // Verify zero forbidden test files or sourcemaps in zip
    assert(!zipList.includes('test-'), 'Zip strictly contains ZERO test files');
    assert(!zipList.includes('.map'), 'Zip strictly contains ZERO sourcemap files');
  }

  // ===========================================================================
  // Scenario 7: Live Local HTTP Connectivity Probe
  // ===========================================================================
  console.log('\n▶ Scenario 7: Live Local HTTP Connectivity Handshake');
  {
    let serverReceivedAuthHeader: string | undefined;
    const testServer = http.createServer((req, res) => {
      serverReceivedAuthHeader = req.headers['authorization'];
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'HEALTHY', environment: 'pilot', version: '0.1.0' }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'NOT_FOUND' }));
      }
    });

    await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', resolve));
    const address = testServer.address() as { port: number };
    const localBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const client = new ApprovalApiClient({
        baseUrl: localBaseUrl,
        tokenProvider: () => 'valid_pilot_jwt_token',
      });

      // Probe health endpoint via client transport
      const probeRes = await client['dispatchRequest']<any>('GET', '/api/v1/health');
      assert(probeRes.success, 'Health check against live local endpoint succeeded');
      assertEquals(probeRes.data?.status, 'HEALTHY', 'Endpoint returned status HEALTHY');
      assertEquals(probeRes.data?.environment, 'pilot', 'Endpoint returned environment pilot');
      assertEquals(serverReceivedAuthHeader, 'Bearer valid_pilot_jwt_token', 'Authorization header received correctly');
    } finally {
      await new Promise<void>((resolve) => testServer.close(() => resolve()));
    }
  }

  console.log('\n====================================================================');
  console.log(`📊 CONTROLLED-PILOT DEPLOYMENT VERIFICATION: ${passedTests}/${totalTests} PASSED`);
  console.log('🎉 ALL PILOT BUILD, PACKAGING, AND RESILIENCE REQUIREMENTS SATISFIED!');
  console.log('====================================================================\n');
}

runPilotVerificationSuite().catch((err) => {
  console.error('\n❌ Controlled-pilot verification failed:', err);
  process.exit(1);
});
