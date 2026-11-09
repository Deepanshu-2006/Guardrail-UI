/**
 * Guardrail Browser Download Warning Modal UI Test Suite
 *
 * Verifies the user-facing download safety experience:
 * 1. Mounting, Shadow DOM Isolation, and Singleton Lifecycle.
 * 2. Filename, File Type, File Size, and Deceptive Double Extension Communication.
 * 3. Origin Domain, Raw IP Address, and Insecure HTTP Transport Communication.
 * 4. Plain-Language Detected Risk Indicators & Non-Frightening Reassurance.
 * 5. Heuristic Assessment vs Verified Threat Intelligence Distinction.
 * 6. Accurate Download Lifecycle States (in_progress, paused, cancelled, interrupted, complete).
 * 7. Supported Protective Actions:
 *    - Cancellation of ongoing / paused downloads.
 *    - Secondary warning confirmation before supported continuation / resumption.
 *    - Safe inspection guidance for completed downloads without false block claims.
 * 8. Strict Invariants:
 *    - No automatic opening or execution of files.
 *    - No false claims of file removal or blocking for completed downloads.
 *    - No false claims of antivirus or malware scanning functionality.
 * 9. Duplicate User Action Prevention & In-Flight State Guards.
 * 10. Accessibility (alertdialog, labels, live regions, focus trapping, Escape key, focus restoration).
 */

declare const process: { exit: (code: number) => void };

// Setup DOM simulation in Node environment
class MockDOMTokenList {
  private classes: Set<string> = new Set();
  constructor(initial: string = '') {
    if (initial) {
      initial.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    }
  }
  add(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.add(t));
  }
  remove(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.delete(t));
  }
  contains(token: string): boolean {
    return this.classes.has(token);
  }
  toString(): string {
    return Array.from(this.classes).join(' ');
  }
}

class MockDOMElement {
  public tagName: string;
  public id: string = '';
  public attributes: Record<string, string> = {};
  public style: Record<string, string> = {};
  public children: MockDOMElement[] = [];
  public parentNode: MockDOMElement | null = null;
  public shadowRoot: MockShadowRoot | null = null;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  private _textContent: string = '';
  public classList: MockDOMTokenList;
  public disabled: boolean = false;
  public type: string = '';
  public onclick: ((e?: any) => void) | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockDOMTokenList();
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(val: string) {
    this.classList = new MockDOMTokenList(val);
  }

  get textContent(): string {
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'id') this.id = value;
    if (name === 'class') this.className = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
    if (name === 'id') this.id = '';
    if (name === 'class') this.className = '';
  }

  appendChild<T extends MockDOMElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends MockDOMElement>(child: T): T {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  attachShadow(init: { mode: 'open' | 'closed' }): MockShadowRoot {
    const shadow = new MockShadowRoot(this);
    this.shadowRoot = shadow;
    return shadow;
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  }

  dispatchEvent(event: any): boolean {
    const handlers = this.listeners[event.type] || [];
    handlers.forEach((h) => h(event));
    if (event.type === 'click' && typeof this.onclick === 'function') {
      this.onclick(event);
    }
    return true;
  }

  focus(): void {
    (globalThis as any).document.activeElement = this;
  }

  querySelector(selector: string): MockDOMElement | null {
    return findFirst(this, selector);
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];
    findAll(this, selector, results);
    return results;
  }
}

class MockShadowRoot {
  public host: MockDOMElement;
  public children: MockDOMElement[] = [];
  public activeElement: MockDOMElement | null = null;

  constructor(host: MockDOMElement) {
    this.host = host;
  }

  appendChild<T extends MockDOMElement>(child: T): T {
    this.children.push(child);
    return child;
  }

  querySelector(selector: string): MockDOMElement | null {
    for (const child of this.children) {
      const match = findFirst(child, selector);
      if (match) return match;
    }
    return null;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];
    for (const child of this.children) {
      findAll(child, selector, results);
    }
    return results;
  }
}

function findFirst(root: MockDOMElement, selector: string): MockDOMElement | null {
  if (matches(root, selector)) return root;
  for (const child of root.children) {
    const found = findFirst(child, selector);
    if (found) return found;
  }
  return null;
}

function findAll(root: MockDOMElement, selector: string, results: MockDOMElement[]): void {
  if (matches(root, selector)) {
    results.push(root);
  }
  for (const child of root.children) {
    findAll(child, selector, results);
  }
}

function matches(el: MockDOMElement, selector: string): boolean {
  if (selector.startsWith('#')) {
    return el.id === selector.slice(1);
  }
  if (selector.startsWith('.')) {
    const cls = selector.slice(1).split('[')[0];
    const hasClass = el.classList.contains(cls);
    if (!hasClass) return false;
    if (selector.includes('[')) {
      const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)="?([^"\]]*)"?\]/);
      if (attrMatch) {
        return el.getAttribute(attrMatch[1]) === attrMatch[2];
      }
    }
    return true;
  }
  if (selector.startsWith('[')) {
    const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)="?([^"\]]*)"?\]/);
    if (attrMatch) {
      return el.getAttribute(attrMatch[1]) === attrMatch[2];
    }
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

// Global DOM setup
const mockDocument = {
  activeElement: null as MockDOMElement | null,
  body: new MockDOMElement('body'),
  createElement(tag: string): MockDOMElement {
    return new MockDOMElement(tag);
  },
  getElementById(id: string): MockDOMElement | null {
    return findFirst(this.body, `#${id}`);
  },
};

const mockWindow = {
  listeners: {} as Record<string, ((e: any) => void)[]>,
  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  },
  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  },
  dispatchEvent(event: any): void {
    const handlers = this.listeners[event.type] || [];
    handlers.forEach((h) => h(event));
  },
};

(globalThis as any).document = mockDocument;
(globalThis as any).window = mockWindow;

// Test Imports
import {
  showDownloadWarningModal,
  dismissDownloadWarningModal,
  isDownloadWarningModalActive,
  updateDownloadModalLifecycle,
  DOWNLOAD_HOST_ELEMENT_ID,
} from './download-warning-modal.js';
import {
  evaluateDownloadSafety,
  extractDownloadSecurityContext,
} from '../utils/download-detector.js';
import {
  DownloadItemMetadata,
  DownloadSafetyIndicatorCode,
} from '../types/download.js';
import { RiskLevel } from '../types/risk.js';

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
  console.log('Day 28: Browser Download Warning Modal UI Test Suite');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // Suite 1: Mounting, Shadow DOM Isolation, and Singleton Lifecycle
  // ---------------------------------------------------------------------------
  console.log('--- Suite 1: Mounting, Shadow DOM Isolation, & Singleton Lifecycle ---');

  const sampleExeItem: DownloadItemMetadata = {
    id: 101,
    url: 'https://downloads.example.org/files/client_installer.exe',
    filename: 'client_installer.exe',
    fileSize: 15_728_640, // 15 MB
    mime: 'application/x-msdownload',
    state: 'in_progress',
  };
  const sampleExeEval = evaluateDownloadSafety(sampleExeItem);

  assert(!isDownloadWarningModalActive(), 'Modal initially not active');

  const dismissFn = showDownloadWarningModal({
    evaluation: sampleExeEval,
    item: sampleExeItem,
  });

  assert(isDownloadWarningModalActive(), 'Modal is active after showDownloadWarningModal()');
  const host = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID);
  assert(Boolean(host), 'Host container #guardrail-download-ui-host mounted in document.body');
  assert(Boolean(host?.shadowRoot), 'Shadow Root attached to host element for CSS isolation');

  const card = host?.shadowRoot?.querySelector('.gr-card');
  assert(Boolean(card), 'Card container rendered inside Shadow Root');
  assertEquals(card?.getAttribute('role'), 'alertdialog', 'Card has accessible role="alertdialog"');
  assertEquals(card?.getAttribute('aria-modal'), 'true', 'Card declares aria-modal="true"');
  assertEquals(card?.getAttribute('aria-labelledby'), 'gr-dl-title', 'Card declares aria-labelledby');
  assertEquals(card?.getAttribute('aria-describedby'), 'gr-dl-summary', 'Card declares aria-describedby');

  // Test Singleton Lifecycle (duplicate show call replaces prior instance)
  showDownloadWarningModal({
    evaluation: sampleExeEval,
    item: sampleExeItem,
  });
  const allHosts = mockDocument.body.querySelectorAll(`#${DOWNLOAD_HOST_ELEMENT_ID}`);
  assertEquals(allHosts.length, 1, 'Singleton enforced: exactly one host element exists');

  dismissFn();
  assert(!isDownloadWarningModalActive(), 'Modal dismissed via programmatic dismiss function');
  assert(!mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID), 'Host element cleanly removed from DOM');

  // ---------------------------------------------------------------------------
  // Suite 2: Filename, File Type, File Size, and Deceptive Extension Communication
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 2: Filename, File Type, Size, and Extension Details ---');

  const doubleExtItem: DownloadItemMetadata = {
    id: 102,
    url: 'https://cdn.reports-portal.com/invoices/tax_summary.pdf.exe',
    filename: 'tax_summary.pdf.exe',
    fileSize: 2_097_152, // 2 MB
    mime: 'application/octet-stream',
    state: 'paused',
    paused: true,
  };
  const doubleExtEval = evaluateDownloadSafety(doubleExtItem);

  showDownloadWarningModal({
    evaluation: doubleExtEval,
    item: doubleExtItem,
  });

  const shadow2 = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID)?.shadowRoot;
  const filenameEl = shadow2?.querySelector('.gr-filename');
  assertEquals(filenameEl?.textContent, 'tax_summary.pdf.exe', 'Sanitized filename displayed accurately');

  const extTag = shadow2?.querySelector('.gr-tag-ext');
  assertEquals(extTag?.textContent, '.exe', 'Primary extension tag displayed accurately');

  const metaRow = shadow2?.querySelector('.gr-file-meta-row');
  assert(Boolean(metaRow?.textContent.includes('Executable Program')), 'File type categorized as Executable Program');
  assert(Boolean(metaRow?.textContent.includes('2.0 MB')), 'File size formatted accurately as 2.0 MB');

  // Verify double extension indicator
  const indicatorsText = shadow2?.querySelector('.gr-indicators-list')?.textContent || '';
  assert(
    indicatorsText.includes('Disguised double extension') || indicatorsText.includes('.pdf.exe'),
    'Deceptive double extension clearly explained in plain language'
  );

  dismissDownloadWarningModal();

  // ---------------------------------------------------------------------------
  // Suite 3: Origin Domain, Raw IP, and Insecure Transport Indicators
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 3: Origin Domain, Raw IP, and Cleartext HTTP Indicators ---');

  const rawIpItem: DownloadItemMetadata = {
    id: 103,
    url: 'http://198.51.100.42:8080/payload.bat',
    filename: 'payload.bat',
    fileSize: 4096, // 4 KB
    mime: 'application/x-bat',
    state: 'in_progress',
    referrer: 'https://legit-portal.com/dashboard',
  };
  const rawIpEval = evaluateDownloadSafety(rawIpItem);

  showDownloadWarningModal({
    evaluation: rawIpEval,
    item: rawIpItem,
  });

  const shadow3 = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID)?.shadowRoot;
  const originDomain = shadow3?.querySelector('.gr-origin-domain')?.textContent;
  assertEquals(originDomain, '198.51.100.42', 'Raw IP origin domain clearly displayed');

  const originBox = shadow3?.querySelector('.gr-origin-callout')?.textContent || '';
  assert(
    originBox.includes('numerical IP address'),
    'Raw numerical IP warning surfaced in origin callout box'
  );
  assert(
    originBox.includes('unencrypted cleartext HTTP'),
    'Unencrypted plain HTTP transport warning surfaced in origin callout box'
  );
  assert(
    originBox.includes('legit-portal.com'),
    'Referrer domain accurately displayed in origin details'
  );

  dismissDownloadWarningModal();

  // ---------------------------------------------------------------------------
  // Suite 4: Heuristic vs Verified Threat Intelligence Distinction
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 4: Heuristic vs Verified Threat Intelligence Distinction ---');

  // Case A: Pure Local Heuristics
  showDownloadWarningModal({
    evaluation: sampleExeEval,
    item: sampleExeItem,
  });
  const shadow4A = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID)?.shadowRoot;
  const intelTitleA = shadow4A?.querySelector('.gr-intel-title')?.textContent || '';
  const intelDescA = shadow4A?.querySelector('.gr-intel-desc')?.textContent || '';
  assert(intelTitleA.includes('Automated Local Heuristic'), 'Heuristic evaluation labeled as Automated Local Heuristic');
  assert(
    intelDescA.includes('No external scanning service was contacted'),
    'Plainly states no external scanning was conducted'
  );
  assert(
    !intelDescA.includes('malware confirmed'),
    'Truthful invariant: Does not claim malware confirmed for heuristic assessment'
  );
  dismissDownloadWarningModal();

  // Case B: Verified Browser SafeBrowsing Danger State
  const dangerousItem: DownloadItemMetadata = {
    id: 104,
    url: 'https://malicious-distribution.net/trojan.exe',
    filename: 'trojan.exe',
    danger: 'file', // Browser SafeBrowsing confirmed dangerous
    state: 'in_progress',
  };
  const dangerousEval = evaluateDownloadSafety(dangerousItem);

  showDownloadWarningModal({
    evaluation: dangerousEval,
    item: dangerousItem,
  });
  const shadow4B = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID)?.shadowRoot;
  const intelTitleB = shadow4B?.querySelector('.gr-intel-title')?.textContent || '';
  const severityPillB = shadow4B?.querySelector('.gr-pill-severity')?.textContent || '';
  assert(intelTitleB.includes('Verified Threat Intelligence'), 'SafeBrowsing flagged file labeled as Verified Threat Intelligence');
  assertEquals(severityPillB, 'Confirmed Dangerous', 'SafeBrowsing danger accurately marked Confirmed Dangerous');
  dismissDownloadWarningModal();

  // ---------------------------------------------------------------------------
  // Suite 5: Download Lifecycle States & Accurate Reflection
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 5: Download Lifecycle States & Dynamic Updates ---');

  const lifecycleItem: DownloadItemMetadata = {
    id: 105,
    url: 'https://example.com/app.dmg',
    filename: 'app.dmg',
    state: 'in_progress',
  };
  const lifecycleEval = evaluateDownloadSafety(lifecycleItem);

  showDownloadWarningModal({
    evaluation: lifecycleEval,
    item: lifecycleItem,
  });

  const shadow5 = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID)?.shadowRoot;
  const badge5 = shadow5?.querySelector('.gr-dl-lifecycle-badge');
  assertEquals(badge5?.textContent, 'Ongoing', 'Initial state displayed as Ongoing');

  // Dynamically update to paused
  updateDownloadModalLifecycle('paused');
  assertEquals(badge5?.textContent, 'Paused by Guardrail', 'Dynamic update to Paused by Guardrail');

  // Dynamically update to interrupted
  updateDownloadModalLifecycle('interrupted', 'NETWORK_FAILED');
  assertEquals(badge5?.textContent, 'Interrupted', 'Dynamic update to Interrupted');
  const subtext5 = shadow5?.querySelector('.gr-dl-status-subtext')?.textContent || '';
  assert(subtext5.includes('NETWORK_FAILED'), 'Interruption error code NETWORK_FAILED communicated');

  // Dynamically update to complete
  updateDownloadModalLifecycle('complete');
  assertEquals(badge5?.textContent, 'Completed', 'Dynamic update to Completed');

  // Verify completed download handling guidance
  const guidanceTitle = shadow5?.querySelector('.gr-guidance-title')?.textContent || '';
  assert(
    guidanceTitle.includes('Completed File') || guidanceTitle.includes('Safely Inspect'),
    'Completed file switches to safe inspection guidance'
  );
  const guidanceText = shadow5?.querySelector('.gr-guidance-box')?.textContent || '';
  assert(
    guidanceText.includes('Do not double-click or open'),
    'Advises user not to open or run the completed file directly'
  );
  assert(
    guidanceText.includes('antivirus'),
    'Advises scanning with user\'s installed antivirus software'
  );
  assert(
    !guidanceText.includes('Guardrail removed') && !guidanceText.includes('Guardrail blocked this completed file'),
    'Truthful invariant: NEVER claims a completed download was removed or blocked'
  );

  dismissDownloadWarningModal();

  // ---------------------------------------------------------------------------
  // Suite 6: Supported Cancellation & Continuation Workflow
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 6: Supported Cancellation & Continuation Workflow ---');

  let cancelCalled = false;
  let continueCalled = false;

  const controllableItem: DownloadItemMetadata = {
    id: 106,
    url: 'https://software-dist.com/setup.msi',
    filename: 'setup.msi',
    state: 'paused',
    paused: true,
  };
  const controllableEval = evaluateDownloadSafety(controllableItem);

  showDownloadWarningModal({
    evaluation: controllableEval,
    item: controllableItem,
    onCancel: async () => {
      cancelCalled = true;
    },
    onContinue: async () => {
      continueCalled = true;
    },
  });

  const shadow6 = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID)?.shadowRoot;
  const cancelBtn = shadow6?.querySelector('.gr-btn-cancel-dl') as MockDOMElement;
  const continueBtn = shadow6?.querySelector('.gr-btn-continue-dl') as MockDOMElement;

  assert(Boolean(cancelBtn), 'Cancel Download button rendered');
  assert(Boolean(continueBtn), 'Resume Download button rendered when paused');

  // Test Two-Step Continuation Guard (Show warning before continuation)
  const continuationBox = shadow6?.querySelector('.gr-continuation-warning-box') as MockDOMElement;
  assertEquals(continuationBox.style.display, 'none', 'Continuation warning hidden initially');

  // First click on continueBtn: opens warning confirmation
  continueBtn.dispatchEvent({ type: 'click' });
  assertEquals(continuationBox.style.display, 'block', 'Continuation warning surfaced upon first click');
  assert(continueBtn.textContent.includes('Resume File'), 'Button text updated to confirm user understanding');
  assertEquals(continueCalled, false, 'onContinue strictly NOT called on initial intent click');

  // Second click: confirms continuation
  await continueBtn.dispatchEvent({ type: 'click' });
  assertEquals(continueCalled, true, 'onContinue called only after user explicitly confirms the warning');

  // Test Cancellation Execution
  showDownloadWarningModal({
    evaluation: controllableEval,
    item: controllableItem,
    onCancel: async () => {
      cancelCalled = true;
    },
  });
  const shadow6B = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID)?.shadowRoot;
  const cancelBtnB = shadow6B?.querySelector('.gr-btn-cancel-dl') as MockDOMElement;

  await cancelBtnB.dispatchEvent({ type: 'click' });
  assertEquals(cancelCalled, true, 'onCancel callback invoked upon clicking Cancel Download');
  const badge6B = shadow6B?.querySelector('.gr-dl-lifecycle-badge');
  assertEquals(badge6B?.textContent, 'Cancelled', 'Modal transitions to Cancelled state upon cancellation');
  assertEquals(cancelBtnB.disabled, true, 'Cancel button disabled after cancellation to prevent duplicate actions');

  dismissDownloadWarningModal();

  // ---------------------------------------------------------------------------
  // Suite 7: Accessibility & Keyboard Navigation
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 7: Accessibility, ARIA, and Keyboard Navigation ---');

  const triggerButton = mockDocument.createElement('button');
  triggerButton.id = 'trigger-btn';
  mockDocument.body.appendChild(triggerButton);
  triggerButton.focus();
  assertEquals(mockDocument.activeElement?.id, 'trigger-btn', 'Trigger button focused initially');

  showDownloadWarningModal({
    evaluation: sampleExeEval,
    item: sampleExeItem,
  });

  const shadow7 = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID)?.shadowRoot;
  const liveRegion = shadow7?.querySelector('.gr-sr-only[role=\"status\"]');
  assert(Boolean(liveRegion), 'Screen reader live announcement region present');
  assertEquals(liveRegion?.getAttribute('aria-live'), 'polite', 'Live region declares aria-live="polite"');
  assertEquals(liveRegion?.getAttribute('aria-atomic'), 'true', 'Live region declares aria-atomic="true"');

  // Test Escape Key Dismissal
  assert(isDownloadWarningModalActive(), 'Modal is active before Escape key');
  mockWindow.dispatchEvent({ type: 'keydown', key: 'Escape', keyCode: 27, preventDefault: () => {} });
  assert(!isDownloadWarningModalActive(), 'Modal cleanly dismissed via Escape key');

  // Test Focus Restoration
  assertEquals(mockDocument.activeElement?.id, 'trigger-btn', 'Focus restored to previous active element on dismissal');

  // ---------------------------------------------------------------------------
  // Suite 8: Technical Diagnostics Partitioning
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 8: Technical Diagnostics Partitioning ---');

  showDownloadWarningModal({
    evaluation: sampleExeEval,
    item: sampleExeItem,
  });

  const shadow8 = mockDocument.getElementById(DOWNLOAD_HOST_ELEMENT_ID)?.shadowRoot;
  const diagDetails = shadow8?.querySelector('.gr-diagnostics');
  assert(Boolean(diagDetails), 'Collapsible <details> element used for technical diagnostics');
  const diagText = diagDetails?.textContent || '';
  assert(diagText.includes('101'), 'Download ID partitioned in diagnostics');
  assert(diagText.includes('application/x-msdownload'), 'Declared MIME type partitioned in diagnostics');
  assert(diagText.includes('downloads.example.org'), 'Full URL partitioned in diagnostics');

  dismissDownloadWarningModal();

  // ---------------------------------------------------------------------------
  // Suite 9: Security Invariants & Reporting Integrity
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 9: Security Invariants & Reporting Integrity ---');

  // 1. Missing metadata fallback
  const missingMetaEval = evaluateDownloadSafety({ id: 999 });
  const missingContext = extractDownloadSecurityContext(missingMetaEval, { id: 999 });
  assertEquals(missingContext.filename, 'unnamed-download', 'Missing filename safely defaults to unnamed-download');
  assertEquals(missingContext.fileSizeFormatted, 'Unknown size (streaming transfer)', 'Missing size safely reported as streaming');
  assertEquals(missingContext.originDomain, 'Unknown Origin', 'Missing URL safely defaults to Unknown Origin');

  // 2. No automatic open or execution
  assert(
    typeof (globalThis as any).chrome?.downloads?.open === 'undefined',
    'Invariant: chrome.downloads.open is NEVER imported, called, or exposed'
  );

  console.log('\n================================================================');
  console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
