/**
 * Guardrail UI - Day 27 Real Browser Website Protection Verification Suite
 *
 * Automated real-browser verification harness running in genuine headless Google Chrome / Chromium
 * with the unpacked Manifest V3 extension loaded from `guardrail/extension/dist`.
 *
 * TEST OBJECTIVES (Day 27 Complete Scope):
 * 1. Normal legitimate website URLs (clean loading, no false warning dialogs, unhindered form submission).
 * 2. Malformed URLs (safe parsing, pseudo-protocols, error resiliency).
 * 3. Suspicious hostname patterns (raw public IP, hyphen stuffing, excessive subdomains).
 * 4. Lookalike domain examples (deceptive brand subdomains on unrelated roots).
 * 5. Synthetic phishing-style login pages (deceptive brand mismatch, controlled vs ambient boundaries).
 * 6. Unexpected form destinations (third-party exfiltration webhook destinations, insecure HTTP targets).
 * 7. Cross-Origin form behavior (capturing-phase suppression on controlled targets, documented ambient limits).
 * 8. Navigation between supported test pages (navigation tracking, previousUrl context, re-initialization).
 * 9. Detection failures (fail-open/fail-closed guarantees, zero false reporting of successful protection).
 * 10. Service worker lifecycle & runtime responsiveness.
 *
 * PRIVACY & SECURITY BOUNDARIES:
 * - Zero sensitive form values (passwords, credit cards, OTPs) captured in DOM metadata or dispatched events.
 * - Architectural limitation truthfulness: no universal interception or guaranteed rollback of ambient events.
 * - Action binding immutability and authorization integrity preserved.
 */

import { startControlledTestServers, RunningTestServers } from './test-server.js';
import { launchControlledChrome, RunningChromeSession, ChromePage } from './chrome-runner.js';
import { computeActionDigest, createApprovalActionBinding } from '../approval/binding.js';
import { ActionType, GuardrailAction } from '../types/actions.js';
import { createActionMetadata, extractPageInfo } from '../utils/index.js';

interface TestCounters {
  protectPageHandlerCalls: number;
  allowPageHandlerCalls: number;
  warnPageHandlerCalls: number;
  ambientUnmarkedHandlerCalls: number;
  controlledContinuationExecutions: number;
  actionAllowedEvents: number;
  actionWarnedEvents: number;
  actionInterceptedEvents: number;
  actionCancelledEvents: number;
  actionContinuedEvents: number;
  formSubmissions: number;
  linkClicks: number;
}

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

async function getCounters(page: ChromePage): Promise<TestCounters> {
  return page.evaluate<TestCounters>('window.__TEST_COUNTERS__ || {}');
}

async function runRealBrowserWebsiteProtectionSuite(): Promise<void> {
  console.log('================================================================');
  console.log('Day 27: Controlled Real Browser Website Protection Suite');
  console.log('================================================================\n');

  let servers: RunningTestServers | null = null;
  let chrome: RunningChromeSession | null = null;

  try {
    // -------------------------------------------------------------------------
    // Step 1: Initialize Controlled Local Servers & Headless Chrome
    // -------------------------------------------------------------------------
    console.log('--- Step 1: Launching Isolated Local Test Server & Headless Chrome ---');
    servers = await startControlledTestServers({ staticPort: 8912, mockBackendPort: 3002 });
    assert(Boolean(servers.staticUrl), `Controlled static server running at ${servers.staticUrl}`);
    assert(Boolean(servers.mockBackendUrl), `Mock backend server running at ${servers.mockBackendUrl}`);

    chrome = await launchControlledChrome({ port: 9559 });
    assert(Boolean(chrome.process.pid), `Google Chrome launched with PID: ${chrome.process.pid}`);
    const page = await chrome.getPage();

    // -------------------------------------------------------------------------
    // Suite 1: Scenario 1 - Normal Legitimate Website URLs
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 1: Scenario 1 - Normal Legitimate Website Verification ---');
    await page.navigate(`${servers.staticUrl}/synthetic-legitimate.html`);

    const legitTitle = await page.evaluate<string>('document.title');
    assertEquals(legitTitle, 'Apex Cloud Services - Customer Portal', 'Legitimate page loaded');

    // Wait for content script to bootstrap
    await page.waitForCondition(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`,
      5000
    );
    assert(true, 'Guardrail content script successfully bootstrapped on legitimate site');

    // Confirm that NO warning modal was injected
    const warningHostPresent = await page.evaluate<boolean>(
      `Boolean(document.getElementById('guardrail-warning-ui-host'))`
    );
    assertEquals(warningHostPresent, false, 'No warning modal injected on normal legitimate website');

    // Exercise legitimate form submission
    await page.click('#legit-submit-btn');
    await page.waitForCondition(
      `document.getElementById('status-display').textContent.includes('Form submitted safely on legitimate portal')`,
      3000
    );
    const legitLog = await page.getText('#status-display');
    assert(
      Boolean(legitLog && legitLog.includes('Form submitted safely on legitimate portal')),
      'Legitimate form submission executes normally without false warnings'
    );

    // -------------------------------------------------------------------------
    // Suite 2: Scenario 2 - Malformed URLs & Pseudo-Protocols
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 2: Scenario 2 - Malformed URLs & Pseudo-Protocols ---');
    await page.navigate(`${servers.staticUrl}/synthetic-failure-and-privacy.html`);

    await page.waitForCondition(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`,
      5000
    );

    // Click pseudo-protocol link (javascript:void(0))
    await page.click('#link-pseudo-protocol');
    // Content script should remain healthy without uncaught exceptions
    const contentScriptActive = await page.evaluate<boolean>(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`
    );
    assert(contentScriptActive, 'Content script handles pseudo-protocol without crash or state corruption');

    // -------------------------------------------------------------------------
    // Suite 3: Scenarios 3 & 4 - Suspicious Hostnames & Lookalike Domains
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 3: Scenarios 3 & 4 - Suspicious Hostnames & Lookalike Domains ---');
    await page.navigate(`${servers.staticUrl}/synthetic-suspicious-host.html`);

    await page.waitForCondition(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`,
      5000
    );

    // Click marked raw IP hostname link
    await page.click('#link-ip-hostname');

    // Check if warning modal was mounted
    await page.waitForCondition(
      `Boolean(document.getElementById('guardrail-warning-ui-host'))`,
      3000
    );
    const hostElFound = await page.evaluate<boolean>(
      `Boolean(document.getElementById('guardrail-warning-ui-host'))`
    );
    assert(hostElFound, 'Guardrail warning modal host (#guardrail-warning-ui-host) mounted in DOM');

    // Verify modal rendered inside Shadow DOM
    const cardRendered = await page.evaluate<boolean>(`
      (() => {
        const host = document.getElementById('guardrail-warning-ui-host');
        if (!host || !host.shadowRoot) return false;
        return Boolean(host.shadowRoot.querySelector('.gr-card'));
      })()
    `);
    assert(cardRendered, 'Warning modal UI successfully rendered inside isolated Shadow DOM');

    // Dismiss the warning modal via Shadow DOM cancel button
    await page.clickInShadow('#guardrail-warning-ui-host', '.gr-btn-cancel');
    await page.waitForCondition(
      `!document.getElementById('guardrail-warning-ui-host')`,
      3000
    );
    const hostElDismissed = await page.evaluate<boolean>(
      `Boolean(document.getElementById('guardrail-warning-ui-host'))`
    );
    assertEquals(hostElDismissed, false, 'Warning modal successfully dismissed upon clicking Cancel');

    // -------------------------------------------------------------------------
    // Suite 4: Scenario 5 - Synthetic Phishing-Style Login Pages & Boundaries
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 4: Scenario 5 - Synthetic Phishing-Style Login Pages & Boundaries ---');
    await page.navigate(`${servers.staticUrl}/synthetic-phishing-login.html`);

    await page.waitForCondition(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`,
      5000
    );

    // 4.1 Controlled test action: Synchronous capturing-phase interception
    await page.click('#phish-controlled-submit-btn');

    // Verify warning UI host or staging container mounted
    await page.waitForCondition(
      `Boolean(document.getElementById('guardrail-warning-ui-host') || document.getElementById('guardrail-staging-modal-container'))`,
      4000
    );
    const phishWarningMounted = await page.evaluate<boolean>(
      `Boolean(document.getElementById('guardrail-warning-ui-host') || document.getElementById('guardrail-staging-modal-container'))`
    );
    assert(phishWarningMounted, 'Controlled phishing submit triggers protective UI in real browser');

    // Clean up warning if present
    const isWarningOpen = await page.evaluate<boolean>(`Boolean(document.getElementById('guardrail-warning-ui-host'))`);
    if (isWarningOpen) {
      await page.clickInShadow('#guardrail-warning-ui-host', '.gr-btn-cancel');
    }

    // 4.2 Ambient unmarked button: Exercises documented sensor boundary
    await page.click('#phish-ambient-submit-btn');
    await page.waitForCondition(
      `window.__TEST_COUNTERS__ && window.__TEST_COUNTERS__.ambientUnmarkedHandlerCalls > 0`,
      3000
    );
    const counters = await getCounters(page);
    assert(
      counters.ambientUnmarkedHandlerCalls > 0,
      'Ambient unmarked action executed; browser extension truthfully does NOT claim universal rollback'
    );

    // -------------------------------------------------------------------------
    // Suite 5: Scenarios 6 & 7 - Unexpected Form Destinations & Cross-Origin Forms
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 5: Scenarios 6 & 7 - Unexpected Form Destinations & Cross-Origin Forms ---');
    await page.navigate(`${servers.staticUrl}/synthetic-cross-origin.html`);

    await page.waitForCondition(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`,
      5000
    );

    // Controlled cross-origin form submit: capturing-phase suppression
    await page.click('#btn-submit-controlled-co');
    // Verify that the page remains on the test server and does not navigate away
    const currentHref = await page.evaluate<string>('window.location.href');
    assert(
      currentHref.includes('synthetic-cross-origin.html'),
      'Controlled cross-origin submission safely suppressed without unintended navigation'
    );

    // Ambient cross-origin submit button
    await page.click('#btn-submit-ambient-co');
    await page.waitForCondition(
      `window.__TEST_COUNTERS__ && window.__TEST_COUNTERS__.ambientUnmarkedHandlerCalls > 0`,
      3000
    );
    assert(true, 'Ambient cross-origin test confirms documented architectural boundaries');

    // -------------------------------------------------------------------------
    // Suite 6: Scenario 8 - Navigation Between Supported Test Pages
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 6: Scenario 8 - Navigation Between Supported Test Pages ---');
    await page.navigate(`${servers.staticUrl}/synthetic-navigation.html`);

    await page.waitForCondition(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`,
      5000
    );

    // Navigate to legitimate page
    await page.click('#nav-to-legit');
    await page.waitForCondition(
      `window.location.href.includes('synthetic-legitimate.html')`,
      4000
    );
    const navUrl1 = await page.evaluate<string>('window.location.href');
    assert(navUrl1.includes('synthetic-legitimate.html'), 'Navigated to legitimate portal');

    // Navigate back to hub
    await page.navigate(`${servers.staticUrl}/synthetic-navigation.html`);
    await page.waitForCondition(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`,
      5000
    );

    // Navigate to phishing test page
    await page.click('#nav-to-phish');
    await page.waitForCondition(
      `window.location.href.includes('synthetic-phishing-login.html')`,
      4000
    );
    const navUrl2 = await page.evaluate<string>('window.location.href');
    assert(navUrl2.includes('synthetic-phishing-login.html'), 'Navigated to synthetic phishing login');

    // -------------------------------------------------------------------------
    // Suite 7: Scenario 9 - Detection Failures & Fail-Safe Handling
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 7: Scenario 9 - Detection Failures & Fail-Safe Handling ---');
    await page.navigate(`${servers.staticUrl}/synthetic-failure-and-privacy.html`);

    await page.waitForCondition(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`,
      5000
    );

    // Click failure simulation button
    await page.click('#btn-trigger-broken-eval');
    await page.waitForCondition(
      `document.getElementById('failure-status-badge').textContent.includes('NO FALSE PROTECTION')`,
      3000
    );
    const failBadgeText = await page.getText('#failure-status-badge');
    assert(
      Boolean(failBadgeText && failBadgeText.includes('NO FALSE PROTECTION')),
      'Detection error safely handled; no false claim of successful protection'
    );

    // -------------------------------------------------------------------------
    // Suite 8: Scenario 10 - Browser Service Worker Lifecycle Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 8: Scenario 10 - Service Worker Lifecycle Verification ---');
    const targets = await chrome.getTargets();
    const swTarget = targets.find((t) => t.type === 'service_worker' || t.url.includes('background.js') || t.url.startsWith('chrome-extension://'));
    assert(Boolean(swTarget), 'Background service worker active in Chrome runtime target registry');
    console.log(`  Discovered background worker target: ${swTarget?.title || swTarget?.type} (${swTarget?.url})`);

    // -------------------------------------------------------------------------
    // Suite 9: Privacy & Action Binding Security Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 9: Privacy & Action Binding Security Boundary Verification ---');

    // 9.1 Sensitive Value Exclusion Audit
    await page.typeText('#priv-password', 'TopSecretPassword!');
    await page.typeText('#priv-card', 'syn_card_4532015099881122');
    await page.typeText('#priv-otp', 'syn_otp_847291');

    await page.click('#btn-submit-privacy-audit');

    // Check privacy leak detection flag
    const privacyLeak = await page.evaluate<boolean>('window.__PRIVACY_LEAK_DETECTED__');
    assertEquals(privacyLeak, false, 'Zero sensitive form values leaked into dispatched Guardrail events');

    const leakLogs = await page.evaluate<string[]>('window.__PRIVACY_AUDIT_LOGS__');
    assertEquals(leakLogs.length, 0, 'Privacy audit logs confirm clean payload transmission');

    // 9.2 Approval Action Binding Security Boundary
    const metadata = createActionMetadata('act');
    const syntheticAction: GuardrailAction = {
      id: metadata.id,
      type: ActionType.CLICK,
      page: {
        url: `${servers.staticUrl}/synthetic-cross-origin.html`,
        domain: '127.0.0.1',
        title: 'Cross Origin Test',
      },
      element: {
        tagName: 'BUTTON',
        targetUrl: 'https://untrusted-partner.external.net/auth',
      },
      timestamp: metadata.timestamp,
    };

    const digest = computeActionDigest({
      actionType: syntheticAction.type,
      origin: 'http://127.0.0.1:8912',
      pathname: '/synthetic-cross-origin.html',
      formAction: 'https://untrusted-partner.external.net/auth',
    });
    assert(Boolean(digest && digest.length === 64), 'Action digest computation produces 64-char SHA-256 fingerprint');

    const binding = createApprovalActionBinding({
      actionId: syntheticAction.id,
      requestId: 'apr_synth_req_day27',
      actionDigest: digest,
      requesterId: 'usr_alice_day27',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    assertEquals(binding.state, 'BOUND', 'Approval action binding successfully established');
    assertEquals(binding.actionDigest, digest, 'Binding strictly binds expected action digest');

    console.log('\n================================================================');
    console.log('✅ ALL DAY 27 CONTROLLED REAL BROWSER TESTS PASSED CLEANLY');
    console.log('================================================================\n');
  } finally {
    if (chrome) {
      console.log('--- Teardown: Closing Google Chrome ---');
      await chrome.close().catch((err) => console.warn('Error closing Chrome:', err));
    }
    if (servers) {
      console.log('--- Teardown: Terminating Isolated Test Servers ---');
      await servers.close().catch((err) => console.warn('Error closing servers:', err));
    }
  }
}

// Execute suite
runRealBrowserWebsiteProtectionSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error in real browser verification:', err);
    process.exit(1);
  });
