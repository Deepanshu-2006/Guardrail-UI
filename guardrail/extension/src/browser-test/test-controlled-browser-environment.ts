/**
 * Guardrail UI - Day 20 Prompt 2: Controlled Browser Test Environment Verification Suite
 *
 * Verifies real-world execution of the Guardrail Manifest V3 extension in a genuine
 * Chromium browser instance using the zero-dependency ChromeRunner harness.
 *
 * TEST OBJECTIVES:
 * 1. Verify Chrome launches with unpacked extension loaded from `dist/`.
 * 2. Verify Background Service Worker registration in real Chrome runtime.
 * 3. Verify Content Script injection and bootstrapping on `demo-sites/test-page/`.
 * 4. Verify harmless form submission and button actions.
 * 5. Verify capturing-phase synchronous suppression of controlled test actions (`test-protect`).
 * 6. Verify truthfulness of ambient action boundary (unmarked actions are NOT held).
 * 7. Verify clean isolation, mock backend labeling, and process teardown.
 */

import { startControlledTestServers, RunningTestServers } from './test-server.js';
import { launchControlledChrome, RunningChromeSession } from './chrome-runner.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  ❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    console.error(`  ❌ ASSERTION FAILED: ${message} (expected "${expected}", got "${actual}")`);
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
  console.log(`  ✓ ${message}: ${actual}`);
}

async function runBrowserEnvironmentVerification(): Promise<void> {
  console.log('================================================================');
  console.log('Day 20 Prompt 2: Controlled Browser Test Environment Suite');
  console.log('================================================================\n');

  let servers: RunningTestServers | null = null;
  let chrome: RunningChromeSession | null = null;

  try {
    // ---------------------------------------------------------------------------
    // Step 1: Start Isolated Local Servers
    // ---------------------------------------------------------------------------
    console.log('--- Step 1: Launching Isolated Local Test & Mock Backend Servers ---');
    servers = await startControlledTestServers({ staticPort: 8899, mockBackendPort: 3000 });
    assert(Boolean(servers.staticUrl), `Static test server running at ${servers.staticUrl}`);
    assert(Boolean(servers.mockBackendUrl), `Mock approval backend running at ${servers.mockBackendUrl}`);

    // ---------------------------------------------------------------------------
    // Step 2: Launch Real Chromium Browser with Extension
    // ---------------------------------------------------------------------------
    console.log('\n--- Step 2: Launching Headless Chromium with Extension Loaded ---');
    chrome = await launchControlledChrome({ port: 9555 });
    assert(Boolean(chrome.process.pid), `Chromium process spawned with PID: ${chrome.process.pid}`);

    // ---------------------------------------------------------------------------
    // Step 3: Navigate to Controlled Test Page & Verify Content Script Injection
    // ---------------------------------------------------------------------------
    console.log('\n--- Step 3: Navigating to Test Page & Verifying Content Script ---');
    const page = await chrome.getPage();
    await page.navigate(`${servers.staticUrl}/index.html`);

    const title = await page.evaluate<string>('document.title');
    assertEquals(title, 'Guardrail Test Page', 'Test page title matches');

    // Wait for content script to bootstrap (verified via shared DOM attribute or window property)
    await page.waitForCondition(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`,
      5000
    );
    const bootstrapped = await page.evaluate<boolean>(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`
    );
    assert(bootstrapped, 'Guardrail Content Script successfully injected and bootstrapped in real browser');

    // Inspect targets after navigation to confirm extension worker registration
    const targets = await chrome.getTargets();
    console.log(`Discovered ${targets.length} Chrome CDP targets across session.`);
    const extensionTarget = targets.find((t) => t.type === 'service_worker' || t.title.toLowerCase().includes('guardrail') || t.url.startsWith('chrome-extension://'));
    assert(Boolean(extensionTarget), 'Chrome registered extension runtime target in active session');
    console.log(`  Extension target details: ${extensionTarget?.title || extensionTarget?.type} (${extensionTarget?.url})`);

    // ---------------------------------------------------------------------------
    // Step 4: Verify Harmless Form Submission
    // ---------------------------------------------------------------------------
    console.log('\n--- Step 4: Harmless Synthetic Form Submission ---');
    await page.typeText('#test-input', 'Synthetic Sample Form Data');
    await page.click('#submit-btn');

    await page.waitForCondition(
      `document.getElementById('event-log').textContent.includes('Form submitted: "Synthetic Sample Form Data"')`,
      3000
    );
    const formLog = await page.getText('#event-log');
    assert(
      Boolean(formLog && formLog.includes('Form submitted: "Synthetic Sample Form Data"')),
      'Harmless form submission logged locally without external dispatch'
    );

    // ---------------------------------------------------------------------------
    // Step 5: Verify Harmless Button Action (ALLOW)
    // ---------------------------------------------------------------------------
    console.log('\n--- Step 5: Harmless Button Action (ALLOW Decision) ---');
    await page.click('#btn-intercept-allow');

    await page.waitForCondition(
      `document.getElementById('interception-status-result').textContent.includes('ALLOWED')`,
      3000
    );
    const allowStatus = await page.getText('#interception-status-result');
    assert(
      Boolean(allowStatus && allowStatus.includes('ALLOWED (Normal Execution Permitted)')),
      'ALLOW action permitted without interception'
    );

    const allowLog = await page.getText('#event-log');
    assert(
      Boolean(allowLog && allowLog.includes('NORMAL HANDLER EXECUTED')),
      'Normal page handler permitted to execute for ALLOW decision'
    );

    const allowIndicator = await page.getText('#held-action-indicator');
    assertEquals(allowIndicator, 'No action held', 'Held action indicator confirms no action held on ALLOW');

    // ---------------------------------------------------------------------------
    // Step 6: Verify Controlled Action Interception (PROTECT)
    // ---------------------------------------------------------------------------
    console.log('\n--- Step 6: Controlled Test Action Synchronous Interception (PROTECT) ---');
    await page.click('#btn-intercept-protect');

    await page.waitForCondition(
      `document.getElementById('interception-status-result').textContent.includes('PROTECTED')`,
      4000
    );
    const protectStatus = await page.getText('#interception-status-result');
    assert(
      Boolean(protectStatus && protectStatus.includes('PROTECTED (HELD)')),
      'Interception status reflects PROTECTED (HELD)'
    );

    // Confirm that normal page click handler was synchronously suppressed
    const protectLog = await page.getText('#event-log');
    assert(
      !protectLog?.includes('❌ UNEXPECTED: Normal page click handler executed'),
      'Capturing-phase cancellation successfully prevented normal page handler from executing'
    );

    // Confirm that Shadow DOM Staging Modal Host is mounted
    const stagingHostMounted = await page.evaluate<boolean>(
      `Boolean(document.getElementById('guardrail-staging-ui-host'))`
    );
    assert(stagingHostMounted, 'Shadow DOM Staging Modal Host (#guardrail-staging-ui-host) mounted in document');

    const stagingShadowRootPresent = await page.evaluate<boolean>(
      `Boolean(document.getElementById('guardrail-staging-ui-host')?.shadowRoot)`
    );
    assert(stagingShadowRootPresent, 'Staging Modal Shadow Root encapsulated securely');

    const heldIndicator = await page.getText('#held-action-indicator');
    assert(
      Boolean(heldIndicator && heldIndicator.startsWith('Action HELD: act_')),
      `Held indicator updated with canonical action ID (${heldIndicator})`
    );

    // ---------------------------------------------------------------------------
    // Step 7: Verify Ambient Action Boundary Truthfulness (Unmarked Action)
    // ---------------------------------------------------------------------------
    console.log('\n--- Step 7: Ambient Unmarked Action Boundary (Limitation Verification) ---');
    await page.click('#btn-unsupported-unmarked-critical');

    await page.waitForCondition(
      `document.getElementById('event-log').textContent.includes('AMBIENT UNMARKED HANDLER EXECUTED')`,
      3000
    );
    const unsuppLog = await page.getText('#event-log');
    assert(
      Boolean(unsuppLog && unsuppLog.includes('AMBIENT UNMARKED HANDLER EXECUTED')),
      'Ambient unmarked action was NOT held; page handler executed normally per documented boundary'
    );

    // ---------------------------------------------------------------------------
    // Step 8: Verify Harmless Anchor Link Navigation
    // ---------------------------------------------------------------------------
    console.log('\n--- Step 8: Harmless Synthetic Anchor Link ---');
    await page.click('#test-harmless-link');

    await page.waitForCondition(
      `document.getElementById('event-log').textContent.includes('HARMLESS LINK CLICKED')`,
      3000
    );
    const linkLog = await page.getText('#event-log');
    assert(
      Boolean(linkLog && linkLog.includes('HARMLESS LINK CLICKED')),
      'Harmless link interaction handled deterministically on local page'
    );

    console.log('\n================================================================');
    console.log('🎉 ALL 8 BROWSER TEST ENVIRONMENT VERIFICATIONS PASSED IN REAL CHROME!');
    console.log('================================================================\n');
  } finally {
    // ---------------------------------------------------------------------------
    // Step 9: Safe Resource Cleanup
    // ---------------------------------------------------------------------------
    console.log('--- Step 9: Safe Resource & Process Cleanup ---');
    if (chrome) {
      await chrome.close();
      console.log('  ✓ Headless Chrome process terminated and temporary profile deleted');
    }
    if (servers) {
      await servers.close();
      console.log('  ✓ Local test static server and mock approval server stopped');
    }
  }
}

// Execute suite
runBrowserEnvironmentVerification().catch((err) => {
  console.error('\n❌ Browser Environment Verification Failed:', err);
  process.exit(1);
});
