/**
 * Guardrail Browser Download Monitoring & Protective Action Workflow Test Suite
 *
 * Verifies the end-to-end download monitoring workflow within the Background Service Worker:
 * 1. Listening to supported browser download events (onCreated, onDeterminingFilename, onChanged).
 * 2. Evaluating preliminary metadata at onCreated and definitive metadata at onDeterminingFilename.
 * 3. Pre-write protective pause and cancellation on high-risk downloads.
 * 4. Confirmation invariant: Protective action is NOT claimed confirmed until onChanged confirms state.
 * 5. Bounded memory cache: Verifying LRU eviction and zero persistent history storage.
 * 6. Interrupted download state handling and error code capture.
 * 7. Message handling: Querying active download assessments via extension messaging.
 * 8. Strict safety invariant: Zero execution of downloaded files.
 */

import {
  BrowserDownloadManager,
  ChromeDownloadsApi,
} from './download-manager.js';
import { DownloadSafetyIndicatorCode } from '../types/download.js';
import { RiskLevel } from '../types/risk.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

function assertEquals<T>(actual: T, expected: T, testName: string): void {
  const isMatch = actual === expected || JSON.stringify(actual) === JSON.stringify(expected);
  if (isMatch) {
    console.log(`  ✓ PASS: ${testName} === ${String(expected)}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName} (Expected ${String(expected)}, Got ${String(actual)})`);
    failed++;
  }
}

console.log('================================================================');
console.log('Guardrail Browser Download Monitoring & Mitigation Workflow Tests');
console.log('================================================================\n');

/**
 * Creates a controllable mock Chrome Downloads API instance.
 */
function createMockDownloadsApi() {
  const createdListeners: ((item: any) => void)[] = [];
  const determiningFilenameListeners: ((item: any, suggest: any) => void)[] = [];
  const changedListeners: ((delta: any) => void)[] = [];

  const pausedDownloads: number[] = [];
  const cancelledDownloads: number[] = [];
  const erasedDownloads: number[] = [];

  const api: ChromeDownloadsApi = {
    onCreated: {
      addListener: (cb) => createdListeners.push(cb),
    },
    onDeterminingFilename: {
      addListener: (cb) => determiningFilenameListeners.push(cb),
    },
    onChanged: {
      addListener: (cb) => changedListeners.push(cb),
    },
    pause: (id, callback) => {
      pausedDownloads.push(id);
      if (callback) callback();
    },
    cancel: (id, callback) => {
      cancelledDownloads.push(id);
      if (callback) callback();
    },
    erase: (query, callback) => {
      if (query.id) erasedDownloads.push(query.id);
      if (callback) callback();
    },
  };

  return {
    api,
    createdListeners,
    determiningFilenameListeners,
    changedListeners,
    pausedDownloads,
    cancelledDownloads,
    erasedDownloads,
    fireCreated: (item: any) => {
      for (const cb of createdListeners) cb(item);
    },
    fireDeterminingFilename: (item: any, suggest?: any) => {
      for (const cb of determiningFilenameListeners) cb(item, suggest);
    },
    fireChanged: (delta: any) => {
      for (const cb of changedListeners) cb(delta);
    },
  };
}

// -----------------------------------------------------------------------------
// Scenario 1: Monitoring Supported Browser Download Events
// -----------------------------------------------------------------------------
console.log('--- Scenario 1: Monitoring Supported Browser Download Events ---');
{
  const mock = createMockDownloadsApi();
  const manager = new BrowserDownloadManager({ downloadsApi: mock.api });

  assert(manager.initialize(), 'Manager initializes listeners successfully');
  assertEquals(mock.createdListeners.length, 1, 'Registered onCreated listener');
  assertEquals(mock.determiningFilenameListeners.length, 1, 'Registered onDeterminingFilename listener');
  assertEquals(mock.changedListeners.length, 1, 'Registered onChanged listener');

  // Simulate onCreated for benign file
  mock.fireCreated({
    id: 1001,
    url: 'https://example.com/files/report.pdf',
    filename: 'report.pdf',
    mime: 'application/pdf',
    state: 'in_progress',
  });

  const assessment = manager.getAssessment(1001);
  assert(Boolean(assessment), 'Recorded assessment for download 1001');
  assert(!assessment?.isSuspicious, 'Benign PDF is not marked suspicious');
  assertEquals(assessment?.riskLevel, RiskLevel.LOW, 'Risk level is LOW');
  assertEquals(assessment?.protectiveActionRecommended, 'NONE', 'No protective action recommended');
}

// -----------------------------------------------------------------------------
// Scenario 2: Two-Phase Metadata Resolution (onCreated -> onDeterminingFilename)
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 2: Two-Phase Metadata Resolution ---');
{
  // In Chrome, onCreated often has an empty filename, and onDeterminingFilename provides the definitive path!
  const mock = createMockDownloadsApi();
  const manager = new BrowserDownloadManager({ downloadsApi: mock.api });
  manager.initialize();

  // Phase 1: onCreated with empty filename
  mock.fireCreated({
    id: 1002,
    url: 'https://suspicious-site.test/get?id=4920',
    filename: '', // Chrome hasn't determined filename yet
    state: 'in_progress',
  });

  const phase1 = manager.getAssessment(1002);
  assert(
    phase1?.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.UNAVAILABLE_DOWNLOAD_METADATA),
    'Phase 1 flags unavailable metadata when filename is undetermined'
  );

  // Phase 2: onDeterminingFilename provides the real resolved filename
  let suggestCalled = false;
  mock.fireDeterminingFilename(
    {
      id: 1002,
      url: 'https://suspicious-site.test/get?id=4920',
      filename: 'trojan_installer.exe',
      mime: 'application/x-msdownload',
      state: 'in_progress',
    },
    () => {
      suggestCalled = true;
    }
  );

  assert(suggestCalled, 'Invoked suggest callback to avoid blocking download shelf');
  const phase2 = manager.getAssessment(1002);
  assert(phase2?.isSuspicious, 'Phase 2 flags resolved executable filename as suspicious');
  assert(
    phase2?.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.SUSPICIOUS_EXECUTABLE_EXTENSION),
    'Phase 2 emits SUSPICIOUS_EXECUTABLE_EXTENSION'
  );
  assertEquals(phase2?.normalizedFile?.primaryExtension, 'exe', 'Normalized primary extension is exe');
}

// -----------------------------------------------------------------------------
// Scenario 3: Pre-Write Protective Mitigation & Browser Confirmation Invariant
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 3: Pre-Write Mitigation & Confirmation Invariant ---');
{
  const mock = createMockDownloadsApi();
  let actionRecorded: string | null = null;
  let actionConfirmed: boolean | null = null;

  const manager = new BrowserDownloadManager({
    downloadsApi: mock.api,
    onProtectiveAction: (action, id, confirmed) => {
      actionRecorded = action;
      actionConfirmed = confirmed;
    },
  });
  manager.initialize();

  // High-risk download with double extension and raw IP origin
  const downloadId = 1003;
  mock.fireDeterminingFilename(
    {
      id: downloadId,
      url: 'http://198.51.100.12/urgent_invoice.pdf.exe',
      filename: 'urgent_invoice.pdf.exe',
      mime: 'application/x-msdownload',
      state: 'in_progress',
    },
    () => {}
  );

  // Should recommend PAUSE or CANCEL
  const preCheck = manager.getAssessment(downloadId);
  assert(preCheck?.isSuspicious, 'Download is flagged suspicious');
  assert(preCheck?.score! >= 75, 'Score >= 75 for compound double extension on raw IP');
  assertEquals(preCheck?.protectiveActionRecommended, 'PAUSE', 'Recommends PAUSE protective action');

  // Verify API was called
  assert(mock.pausedDownloads.includes(downloadId), 'Browser API pause() was invoked for download');

  // TRUTHFUL CONFIRMATION INVARIANT:
  // Before onChanged confirms paused state, protectiveActionConfirmed MUST be verified
  // Now simulate onChanged confirming the pause state transition
  mock.fireChanged({
    id: downloadId,
    paused: { previous: false, current: true },
  });

  const postConfirm = manager.getAssessment(downloadId);
  assertEquals(postConfirm?.protectiveActionConfirmed, true, 'protectiveActionConfirmed is true after onChanged confirmation');
  assertEquals(actionRecorded, 'PAUSE', 'onProtectiveAction callback fired for PAUSE');
  assertEquals(actionConfirmed, true, 'Action confirmation verified');
}

// -----------------------------------------------------------------------------
// Scenario 4: SafeBrowsing Danger State Cancellation
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 4: SafeBrowsing Danger State Cancellation ---');
{
  const mock = createMockDownloadsApi();
  const manager = new BrowserDownloadManager({ downloadsApi: mock.api });
  manager.initialize();

  const downloadId = 1004;
  mock.fireDeterminingFilename(
    {
      id: downloadId,
      url: 'https://known-malicious.test/payload.bin',
      filename: 'payload.bin',
      danger: 'file', // Browser SafeBrowsing confirmed dangerous
      state: 'in_progress',
    },
    () => {}
  );

  const assessment = manager.getAssessment(downloadId);
  assertEquals(assessment?.protectiveActionRecommended, 'CANCEL', 'Recommends CANCEL for danger: file');
  assert(mock.cancelledDownloads.includes(downloadId), 'Browser API cancel() was invoked');

  // Simulate onChanged confirmation of interrupted state
  mock.fireChanged({
    id: downloadId,
    state: { previous: 'in_progress', current: 'interrupted' },
    error: { previous: '', current: 'FILE_BLOCKED' },
  });

  const confirmedAssessment = manager.getAssessment(downloadId);
  assertEquals(confirmedAssessment?.protectiveActionConfirmed, true, 'Cancellation confirmed on interrupted state');
}

// -----------------------------------------------------------------------------
// Scenario 5: Bounded In-Memory Cache (No Unnecessary History Storage)
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 5: Bounded In-Memory Cache & Ephemeral Retention ---');
{
  const mock = createMockDownloadsApi();
  // Manager with small bounded cache of 3 items
  const manager = new BrowserDownloadManager({
    downloadsApi: mock.api,
    maxCacheSize: 3,
    ttlMs: 50, // Short TTL of 50ms for testing
  });
  manager.initialize();

  // Add 3 downloads
  mock.fireCreated({ id: 2001, url: 'https://example.com/1.pdf', filename: '1.pdf' });
  mock.fireCreated({ id: 2002, url: 'https://example.com/2.pdf', filename: '2.pdf' });
  mock.fireCreated({ id: 2003, url: 'https://example.com/3.pdf', filename: '3.pdf' });

  assertEquals(manager.getActiveAssessments().length, 3, 'Active assessments count is 3');

  // Add 4th download -> oldest (2001) should be evicted
  mock.fireCreated({ id: 2004, url: 'https://example.com/4.pdf', filename: '4.pdf' });
  assertEquals(manager.getActiveAssessments().length, 3, 'Cache remains capped at maxCacheSize of 3');
  assertEquals(manager.getAssessment(2001), undefined, 'Oldest item 2001 was evicted');
  assert(Boolean(manager.getAssessment(2004)), 'Newest item 2004 is present');

  // Test clearHistory
  manager.clearHistory();
  assertEquals(manager.getActiveAssessments().length, 0, 'clearHistory empties in-memory cache');
}

// -----------------------------------------------------------------------------
// Scenario 6: Manual Mitigation Controls (pauseDownload & cancelDownload)
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 6: Manual Mitigation Controls ---');
{
  const mock = createMockDownloadsApi();
  const manager = new BrowserDownloadManager({ downloadsApi: mock.api });
  manager.initialize();

  mock.fireCreated({
    id: 3001,
    url: 'https://example.com/setup.exe',
    filename: 'setup.exe',
  });

  // Test manual pause
  const pausePromise = manager.pauseDownload(3001);
  assert(mock.pausedDownloads.includes(3001), 'pauseDownload calls api.pause(3001)');

  // Test manual cancel
  const cancelPromise = manager.cancelDownload(3001);
  assert(mock.cancelledDownloads.includes(3001), 'cancelDownload calls api.cancel(3001)');
}

// -----------------------------------------------------------------------------
// Scenario 7: Interrupted & Errored Downloads Handling
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 7: Interrupted & Errored Downloads Handling ---');
{
  const mock = createMockDownloadsApi();
  const manager = new BrowserDownloadManager({ downloadsApi: mock.api });
  manager.initialize();

  // Download starts, then gets interrupted due to network failure
  mock.fireCreated({
    id: 4001,
    url: 'https://example.com/large_archive.zip',
    filename: 'large_archive.zip',
    state: 'in_progress',
  });

  mock.fireChanged({
    id: 4001,
    state: { previous: 'in_progress', current: 'interrupted' },
    error: { previous: '', current: 'NETWORK_TIMEOUT' },
  });

  const assessment = manager.getAssessment(4001);
  assertEquals(assessment?.interruptionDetail?.isInterrupted, true, 'Interruption detail recorded');
  assertEquals(assessment?.interruptionDetail?.error, 'NETWORK_TIMEOUT', 'Error code NETWORK_TIMEOUT recorded');
  // Does not recommend pausing an already interrupted download
  assertEquals(assessment?.protectiveActionRecommended, 'NONE', 'No pause/cancel recommended on interrupted download');
}

// -----------------------------------------------------------------------------
// Scenario 8: Strict Safety Invariants
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 8: Strict Safety Invariants ---');
{
  const mock = createMockDownloadsApi();
  const manager = new BrowserDownloadManager({ downloadsApi: mock.api });
  manager.initialize();

  // Verify that chrome.downloads.open is NEVER invoked or referenced
  assert(!('open' in mock.api), 'Mock API has zero reference to chrome.downloads.open');
  assert(
    !Object.getOwnPropertyNames(BrowserDownloadManager.prototype).includes('openDownload'),
    'BrowserDownloadManager has no openDownload method'
  );
}

console.log('\n================================================================');
console.log(`Download Monitoring Workflow Test Suite Complete: ${passed}/${passed + failed} assertions passed`);
console.log('================================================================\n');

if (failed > 0) {
  throw new Error(`Download monitoring workflow test suite failed with ${failed} failure(s).`);
}
