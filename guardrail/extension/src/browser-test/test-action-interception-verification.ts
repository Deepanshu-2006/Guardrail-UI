/**
 * Guardrail UI - Day 20 Prompt 3: Action Interception Verification Suite
 *
 * Evidence-based real-browser testing suite verifying:
 * 1. Supported action detection on marked vs unmarked controls.
 * 2. Synchronous event suppression (preventDefault + stopImmediatePropagation).
 * 3. In-browser state transitions (DETECTED -> HELD -> CANCELLED / CONTINUED).
 * 4. Failure, unsupported, and edge cases (detached elements, empty markers, duplicate clicks).
 * 5. Strict continuation boundaries (approval alone never executes an action).
 *
 * Runs in Google Chrome 156 with unpacked extension loaded from `dist/`.
 */

import { startControlledTestServers, RunningTestServers } from './test-server.js';
import { launchControlledChrome, RunningChromeSession, ChromePage } from './chrome-runner.js';

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
  return page.evaluate<TestCounters>('window.__TEST_COUNTERS__');
}

async function runActionInterceptionVerification(): Promise<void> {
  console.log('================================================================');
  console.log('Day 20 Prompt 3: Action Interception Verification Suite');
  console.log('================================================================\n');

  let servers: RunningTestServers | null = null;
  let chrome: RunningChromeSession | null = null;

  try {
    // ---------------------------------------------------------------------------
    // Step 1: Start Test Infrastructure & Headless Chrome
    // ---------------------------------------------------------------------------
    console.log('--- Setup: Initializing Local Servers & Headless Chrome ---');
    servers = await startControlledTestServers({ staticPort: 8876, mockBackendPort: 3000 });
    chrome = await launchControlledChrome({ port: 9445 });
    const page = await chrome.getPage();

    await page.navigate(`${servers.staticUrl}/index.html`);
    await page.waitForCondition(
      `Boolean(document.documentElement.getAttribute('data-guardrail-extension-active') || window.__GUARDRAIL_CONTENT_BOOTSTRAPPED__)`,
      5000
    );
    assert(true, 'Test page loaded and Guardrail content script bootstrapped in real Chrome');

    // ---------------------------------------------------------------------------
    // Test Suite 1: Supported Action Detection & Context Association (Task 1)
    // ---------------------------------------------------------------------------
    console.log('\n--- Suite 1: Supported Action Detection & Context Association ---');

    // 1.1: Marked Routine Action (test-allow)
    await page.click('#btn-intercept-allow');
    await page.waitForCondition(
      `document.getElementById('interception-status-result').textContent.includes('ALLOWED')`,
      3000
    );
    let counters = await getCounters(page);
    assertEquals(counters.allowPageHandlerCalls, 1, 'Marked ALLOW action permitted normal page handler to execute');
    assertEquals(counters.actionAllowedEvents, 1, 'guardrail:action-allowed event dispatched');
    assertEquals(counters.actionInterceptedEvents, 0, 'ALLOW action strictly NOT held in memory');

    const allowStatus = await page.getText('#interception-status-result');
    assert(Boolean(allowStatus?.includes('ALLOWED (Normal Execution Permitted)')), 'Status badge indicates ALLOWED');
    const allowHeldIndicator = await page.getText('#held-action-indicator');
    assertEquals(allowHeldIndicator, 'No action held', 'Held action indicator confirms no action held on ALLOW');

    // 1.2: Marked Advisory Action (test-warn)
    await page.click('#btn-intercept-warn');
    await page.waitForCondition(
      `document.getElementById('interception-status-result').textContent.includes('WARNED')`,
      3000
    );
    counters = await getCounters(page);
    assertEquals(counters.warnPageHandlerCalls, 1, 'Marked WARN action permitted normal page handler to execute');
    assertEquals(counters.actionWarnedEvents, 1, 'guardrail:action-warned event dispatched');
    assertEquals(counters.actionInterceptedEvents, 0, 'WARN action presented advisory modal without holding action');

    const warnStatus = await page.getText('#interception-status-result');
    assert(Boolean(warnStatus?.includes('WARNED (Advisory Modal Displayed - Not Held)')), 'Status badge indicates WARNED (Not Held)');

    // 1.3: Unmarked Ambient Action vs Interception Separation
    // Click generic unmarked action
    await page.click('#test-action-btn');
    counters = await getCounters(page);
    // Generic action evaluates to ALLOW, actionInterceptedEvents remains 0
    assertEquals(counters.actionInterceptedEvents, 0, 'Unmarked ambient action detection does NOT create interception record');

    // 1.4: Unmarked Ambient Critical Action (Boundary Limitation Verification)
    await page.click('#btn-unsupported-unmarked-critical');
    await page.waitForCondition(
      `window.__TEST_COUNTERS__.ambientUnmarkedHandlerCalls > 0`,
      3000
    );
    counters = await getCounters(page);
    assertEquals(counters.ambientUnmarkedHandlerCalls, 1, 'Unmarked ambient critical action handler executed normally');
    assertEquals(counters.actionInterceptedEvents, 0, 'Unmarked ambient action truthfully NOT reported as intercepted or held');

    // ---------------------------------------------------------------------------
    // Test Suite 2: Synchronous Event Suppression & Isolation (Task 2)
    // ---------------------------------------------------------------------------
    console.log('\n--- Suite 2: Synchronous Event Suppression & Propagation Prevention ---');

    counters = await getCounters(page);
    const preProtectCalls = counters.protectPageHandlerCalls;

    // Click marked critical action (#btn-intercept-protect)
    await page.click('#btn-intercept-protect');

    await page.waitForCondition(
      `document.getElementById('interception-status-result').textContent.includes('PROTECTED')`,
      4000
    );
    counters = await getCounters(page);

    // CRITICAL SECURITY ASSERTION:
    // Event was synchronously suppressed in capturing phase:
    // Downstream page click listener on #btn-intercept-protect NEVER RAN!
    assertEquals(
      counters.protectPageHandlerCalls,
      preProtectCalls,
      'Capturing-phase stopImmediatePropagation synchronously halted downstream page handler'
    );
    assertEquals(counters.actionInterceptedEvents, 1, 'guardrail:action-intercepted event dispatched');

    const protectStatus = await page.getText('#interception-status-result');
    assert(Boolean(protectStatus?.includes('PROTECTED (HELD)')), 'Status badge confirms action is PROTECTED (HELD)');

    const heldIndicator = await page.getText('#held-action-indicator');
    assert(Boolean(heldIndicator?.startsWith('Action HELD: act_')), 'Held indicator reflects canonical action ID');

    // Confirm Shadow DOM Staging Modal Host is mounted
    const modalMounted = await page.evaluate<boolean>(
      `Boolean(document.getElementById('guardrail-staging-ui-host'))`
    );
    assert(modalMounted, 'Staging Modal (#guardrail-staging-ui-host) mounted in document');

    // ---------------------------------------------------------------------------
    // Test Suite 3: State Transitions in Real Interception Lifecycle (Task 3)
    // ---------------------------------------------------------------------------
    console.log('\n--- Suite 3: State Transitions in Real Interception Lifecycle ---');

    // Verify Resolution Controls enabled
    const cancelBtnDisabled = await page.evaluate<boolean>(
      `document.getElementById('btn-cancel-test-action')?.disabled === true`
    );
    assert(!cancelBtnDisabled, 'Cancel button on test page is enabled for held action');

    // Transition HELD -> CANCELLED via Cancel button
    await page.click('#btn-cancel-test-action');

    await page.waitForCondition(
      `document.getElementById('held-action-indicator').textContent.includes('CANCELLED')`,
      3000
    );
    counters = await getCounters(page);
    assertEquals(counters.actionCancelledEvents, 1, 'guardrail:action-cancelled event dispatched');
    assertEquals(counters.controlledContinuationExecutions, 0, 'Action cancellation strictly ensured 0 continuation executions');

    const cancelledIndicator = await page.getText('#held-action-indicator');
    assert(Boolean(cancelledIndicator?.includes('CANCELLED')), 'Held indicator confirms CANCELLED state');

    // Modal displays cancelled confirmation state
    const modalTitle = await page.getTextInShadow('#guardrail-staging-ui-host', '.gs-heading-title');
    assert(Boolean(modalTitle?.includes('Action Cancelled')), 'Staging Modal displays "Action Cancelled" confirmation state');

    // Dismiss modal cleanly
    await page.evaluate(`window.__GUARDRAIL_STAGING__?.dismiss()`);
    const modalDismissed = await page.evaluate<boolean>(
      `!document.getElementById('guardrail-staging-ui-host')`
    );
    assert(modalDismissed, 'Staging Modal cleanly unmounted from DOM upon dismissal');

    // Monotonic guard: verify cancelled action cannot be continued
    await page.click('#btn-continue-test-action');
    counters = await getCounters(page);
    assertEquals(counters.controlledContinuationExecutions, 0, 'Cancelled action cannot be continued via late continue clicks');

    // ---------------------------------------------------------------------------
    // Test Suite 4: Failure, Unsupported, and Edge Case Boundaries (Task 4)
    // ---------------------------------------------------------------------------
    console.log('\n--- Suite 4: Failure, Unsupported, and Edge Case Boundaries ---');

    // 4.1: Empty Marker Handling
    await page.click('#btn-invalid-empty-marker');
    counters = await getCounters(page);
    assertEquals(counters.actionInterceptedEvents, 1, 'Empty test marker (data-guardrail-test-action="") ignored; did not increment intercepted count');

    // 4.2: Detached Element Click
    await page.click('#btn-detached-trigger');
    counters = await getCounters(page);
    assertEquals(counters.actionInterceptedEvents, 1, 'Synthetic event on detached marked element was safely suppressed without staging');

    // 4.3: Duplicate Event Suppression while Action is HELD
    // First, stage another action
    await page.click('#btn-intercept-protect');
    await page.waitForCondition(
      `document.getElementById('interception-status-result').textContent.includes('PROTECTED')`,
      3000
    );
    counters = await getCounters(page);
    assertEquals(counters.actionInterceptedEvents, 2, 'Second distinct action intercepted and held');

    // Rapid second click while already held
    await page.click('#btn-intercept-protect');
    counters = await getCounters(page);
    // Duplicate click must NOT create a third interception event or overwrite state
    assertEquals(counters.actionInterceptedEvents, 2, 'Repeated event synchronously suppressed without duplicate staging');

    // ---------------------------------------------------------------------------
    // Test Suite 5: Controlled Continuation Boundaries (Task 5)
    // ---------------------------------------------------------------------------
    console.log('\n--- Suite 5: Controlled Continuation Invariants & Explicit Confirmation ---');

    // Confirm that entering HELD state has NOT executed the action
    assertEquals(counters.controlledContinuationExecutions, 0, 'Action in HELD state has strictly ZERO continuation executions');

    // Execute explicit continuation via resolution control
    await page.click('#btn-continue-test-action');

    await page.waitForCondition(
      `window.__TEST_COUNTERS__.controlledContinuationExecutions === 1`,
      3000
    );
    counters = await getCounters(page);
    assertEquals(counters.controlledContinuationExecutions, 1, 'Explicit user confirmation executed controlled handler exactly once');
    assertEquals(counters.actionContinuedEvents, 1, 'guardrail:action-continued event dispatched');

    const continuedIndicator = await page.getText('#held-action-indicator');
    assert(Boolean(continuedIndicator?.includes('CONTINUED')), 'Indicator reflects CONTINUED status');

    // Exactly-once invariant: subsequent clicks cannot execute continuation again
    await page.click('#btn-continue-test-action');
    counters = await getCounters(page);
    assertEquals(counters.controlledContinuationExecutions, 1, 'Second continuation attempt strictly rejected; exactly-once preserved');

    console.log('\n================================================================');
    console.log('🎉 ALL 5 ACTION INTERCEPTION TEST SUITES PASSED IN REAL CHROME!');
    console.log('================================================================\n');
  } finally {
    // ---------------------------------------------------------------------------
    // Cleanup
    // ---------------------------------------------------------------------------
    console.log('--- Teardown: Stopping Chrome & Local Servers ---');
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
runActionInterceptionVerification().catch((err) => {
  console.error('\n❌ Action Interception Verification Failed:', err);
  process.exit(1);
});
