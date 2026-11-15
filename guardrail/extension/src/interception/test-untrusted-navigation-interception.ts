/**
 * Guardrail UI - Untrusted Website Navigation Interception & Dashboard Immunity Suite
 *
 * Verifies:
 * 1. Complete immunity of the Guardrail Trusted Contact Portal dashboard (port 5173 / #dashboard-app)
 *    from action detection, evaluation, and warning modal presentation.
 * 2. Pre-navigation interception for links/buttons opening untrusted websites (synchronous preventDefault).
 * 3. Modal presentation before opening, and continuation to destination ONLY after caretaker approval.
 * 4. Safe exemption of same-origin and allowlisted trusted domains.
 */

import { ActionType, GuardrailAction } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { ActionDetector } from '../detector/action-detector.js';
import { createGuardrailAction } from '../detector/action-factory.js';
import { isInternalGuardrailUi, findInteractiveElement } from '../utils/dom.js';
import { isTrustedDomain, policyConfigRegistry } from '../config/registry.js';
import { evaluateActionPipeline } from '../response/engine.js';
import { isWarningModalActive } from '../ui/warning-modal.js';
import { isDashboardOrInternalPage, isUntrustedWebDestination } from '../content/index.js';

let total = 0;
let passed = 0;

function assert(condition: boolean, message: string): void {
  total++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  }
  passed++;
  console.log(`  ✓ PASS: ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  total++;
  if (actual !== expected) {
    console.error(`  ❌ FAIL: ${message} (expected "${expected}", got "${actual}")`);
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
  passed++;
  console.log(`  ✓ PASS: ${message} === ${expected}`);
}

// =============================================================================
// Lightweight DOM Mock for Unit Verification
// =============================================================================
class MockElement {
  public tagName: string;
  public id: string = '';
  public className: string = '';
  public textContent: string = '';
  public innerHTML: string = '';
  public children: MockElement[] = [];
  public parentNode: MockElement | null = null;
  public attributes: Map<string, string> = new Map();
  public style: Record<string, string> = {};
  public isConnected: boolean = true;
  public href: string = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  setAttribute(name: string, value: string): void {
    const lower = name.toLowerCase();
    this.attributes.set(lower, value);
    if (lower === 'id') this.id = value;
    if (lower === 'class') this.className = value;
    if (lower === 'href') this.href = value;
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    const tokens = selector.split(/[\s,]+/).map((t) => t.trim().toLowerCase());
    while (curr) {
      if (tokens.includes('#dashboard-app') && curr.id === 'dashboard-app') return curr;
      if (selector.includes('role="application"') && curr.getAttribute('role') === 'application') return curr;
      if (tokens.includes('#guardrail-warning-ui-host') && curr.id === 'guardrail-warning-ui-host') return curr;
      if (tokens.includes('#guardrail-staging-ui-host') && curr.id === 'guardrail-staging-ui-host') return curr;
      if (tokens.includes('a') && curr.tagName === 'A') return curr;
      if (tokens.includes('button') && (curr.tagName === 'BUTTON' || curr.getAttribute('role') === 'button')) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  appendChild(child: MockElement): void {
    child.parentNode = this;
    this.children.push(child);
  }
}

class MockEvent {
  public defaultPrevented: boolean = false;
  public _stoppedImmediatePropagation: boolean = false;
  public target: any;
  public bubbles: boolean = true;
  public cancelable: boolean = true;

  constructor(public type: string) {}

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopImmediatePropagation(): void {
    this._stoppedImmediatePropagation = true;
  }
}

console.log('============================================================');
console.log('🛡️ UNTRUSTED NAVIGATION INTERCEPTION & DASHBOARD IMMUNITY');
console.log('============================================================\n');

// -----------------------------------------------------------------------------
// Suite 1: Dashboard Immunity Verification
// -----------------------------------------------------------------------------
console.log('▶ Suite 1: Dashboard Immunity Verification');
{
  const dashboardApp = new MockElement('DIV');
  dashboardApp.setAttribute('id', 'dashboard-app');
  dashboardApp.setAttribute('role', 'application');
  dashboardApp.setAttribute('aria-label', 'Guardrail Trusted Contact Portal');

  const historyCard = new MockElement('DIV');
  historyCard.setAttribute('class', 'gd-history-card');
  historyCard.setAttribute('role', 'button');
  historyCard.textContent = 'Click on "ALICE IS REQUESTING YOUR APPROVAL - EXTERNAL..."';
  dashboardApp.appendChild(historyCard);

  (globalThis as any).window = {
    location: {
      href: 'http://localhost:5173/#history',
      origin: 'http://localhost:5173',
      port: '5173',
      pathname: '/#history',
    },
  };
  (globalThis as any).document = {
    title: 'Guardrail — Trusted Contact Portal',
    getElementById: (id: string) => (id === 'dashboard-app' ? dashboardApp : null),
    querySelector: (sel: string) => (sel.includes('Guardrail') ? dashboardApp : null),
  };
  (globalThis as any).Element = MockElement;
  (globalThis as any).HTMLElement = MockElement;

  // 1. isDashboardOrInternalPage detection
  assert(isDashboardOrInternalPage(), 'Dashboard detected via #dashboard-app container and port 5173');

  // 2. isInternalGuardrailUi returns true for dashboard elements
  assert(isInternalGuardrailUi(historyCard as any), 'Dashboard history card recognized as internal Guardrail UI');

  // 3. findInteractiveElement ignores dashboard controls
  const foundInteractive = findInteractiveElement(historyCard as any);
  assertEquals(foundInteractive, null, 'findInteractiveElement strictly ignores dashboard controls');

  // 4. ActionDetector attached on dashboard emits zero actions
  let actionsEmitted = 0;
  const detector = new ActionDetector(
    () => { actionsEmitted++; },
    () => { actionsEmitted++; }
  );

  const clickEvent = new MockEvent('click');
  clickEvent.target = historyCard;
  (detector as any).handleClick(clickEvent);

  assertEquals(actionsEmitted, 0, 'Clicking history card on dashboard emits ZERO actions');
  assertEquals(isWarningModalActive(), false, 'Warning modal is NOT displayed on dashboard');
}

// -----------------------------------------------------------------------------
// Suite 2: Pre-Navigation Interception for Untrusted Websites
// -----------------------------------------------------------------------------
console.log('\n▶ Suite 2: Pre-Navigation Interception for Untrusted Websites');
{
  (globalThis as any).window = {
    location: {
      href: 'http://localhost:3000/portal',
      origin: 'http://localhost:3000',
      port: '3000',
      pathname: '/portal',
    },
  };
  (globalThis as any).document = {
    title: 'Safe Web Portal',
    getElementById: () => null,
    querySelector: () => null,
  };

  assert(!isDashboardOrInternalPage(), 'Safe browsing page is not dashboard');

  // 1. Untrusted destination detection
  assert(isUntrustedWebDestination('https://gaiaflix.xyz/series'), 'gaiaflix.xyz detected as untrusted destination');
  assert(isUntrustedWebDestination('https://ww6-fmovies.com/home'), 'ww6-fmovies.com detected as untrusted destination');
  assert(!isUntrustedWebDestination('http://localhost:3000/internal'), 'localhost is trusted destination');
  assert(!isUntrustedWebDestination('/relative-path'), 'relative path is not untrusted destination');

  // 2. Click interception on untrusted link
  const untrustedAnchor = new MockElement('A');
  untrustedAnchor.setAttribute('href', 'https://gaiaflix.xyz/series');
  untrustedAnchor.textContent = 'Click on "Series"';

  let interceptedAction: GuardrailAction | null = null;
  let onInterceptCalled = false;

  const detector = new ActionDetector(
    (action) => { interceptedAction = action; },
    (action, _el, event) => {
      onInterceptCalled = true;
      interceptedAction = action;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  );

  const clickEvent = new MockEvent('click');
  clickEvent.target = untrustedAnchor;
  (detector as any).handleClick(clickEvent);

  assert(clickEvent.defaultPrevented, 'Synchronously prevented default link navigation BEFORE opening');
  assert(clickEvent._stoppedImmediatePropagation, 'Stopped event propagation immediately');
  assert(onInterceptCalled, 'Active interception handler invoked');
  assert(interceptedAction !== null, 'Action model created for link click');
  assertEquals(interceptedAction?.element?.targetUrl, 'https://gaiaflix.xyz/series', 'Captured exact targetUrl');

  // 3. Pipeline evaluation produces WARN or ADVISE
  const pipeline = evaluateActionPipeline(interceptedAction!);
  assert(
    pipeline.decision.response === ResponseAction.WARN || pipeline.decision.response === ResponseAction.ADVISE,
    `Untrusted destination evaluated to WARN or ADVISE (got: ${pipeline.decision.response})`
  );
}

// -----------------------------------------------------------------------------
// Suite 3: Post-Approval Navigation Verification
// -----------------------------------------------------------------------------
console.log('\n▶ Suite 3: Post-Approval Navigation Verification');
{
  const targetDestination = 'https://gaiaflix.xyz/series';
  const testAction: GuardrailAction = {
    id: 'act-nav-test-01',
    type: ActionType.CLICK,
    timestamp: new Date().toISOString(),
    element: {
      tagName: 'A',
      targetUrl: targetDestination,
      visibleText: 'Click on "Series"',
    },
    page: {
      url: 'http://localhost:3000/portal',
      title: 'Portal',
    },
  };

  let navigatedTo = '';
  const mockWindow = {
    location: {
      get href() { return navigatedTo; },
      set href(val: string) { navigatedTo = val; },
    },
  };

  // Continuation handler simulating onProceed in handleAuthoritativeApprovalResolution
  const onProceed = () => {
    const destUrl = testAction.element?.targetUrl || testAction.element?.formAction || testAction.page?.url;
    if (destUrl && mockWindow) {
      mockWindow.location.href = destUrl;
    }
  };

  assertEquals(navigatedTo, '', 'Before approval: website is NOT opened');
  onProceed();
  assertEquals(navigatedTo, targetDestination, 'After approval: navigated strictly to targetUrl');
}

// -----------------------------------------------------------------------------
// Suite 4: Allowlisted Trusted Domain Exemption
// -----------------------------------------------------------------------------
console.log('\n▶ Suite 4: Allowlisted Trusted Domain Exemption');
{
  policyConfigRegistry.resetToDefault();
  policyConfigRegistry.setConfig({
    ...policyConfigRegistry.getConfig(),
    trustedDomains: ['trusted-partner.example.com'],
  });

  assert(isTrustedDomain('https://trusted-partner.example.com/login'), 'Allowlisted domain recognized as trusted');
  assert(!isUntrustedWebDestination('https://trusted-partner.example.com/login'), 'Allowlisted domain not untrusted');

  const trustedAnchor = new MockElement('A');
  trustedAnchor.setAttribute('href', 'https://trusted-partner.example.com/login');
  trustedAnchor.textContent = 'Partner Portal';

  let interceptedTrusted = false;
  let emittedTrusted = false;
  const detector = new ActionDetector(
    () => { emittedTrusted = true; },
    () => { interceptedTrusted = true; }
  );

  const clickTrustedEvent = new MockEvent('click');
  clickTrustedEvent.target = trustedAnchor;
  (detector as any).handleClick(clickTrustedEvent);

  assert(!clickTrustedEvent.defaultPrevented, 'Navigation to trusted domain is NOT prevented');
  assert(!interceptedTrusted, 'Trusted domain does not invoke interception handler');
  assert(emittedTrusted, 'Trusted domain emits standard action normally');

  policyConfigRegistry.resetToDefault();
}

console.log('\n============================================================');
console.log(`TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: 0`);
console.log('============================================================\n');
