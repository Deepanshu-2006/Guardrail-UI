/**
 * PHASE 3: GUARDRAIL RISK ASSESSMENT & RESPONSE POLICY REDESIGN - TEST SUITE
 *
 * Comprehensive verification of the redesigned risk assessment, 4-tier centralized
 * response levels (ALLOW, ADVISE, WARN, PROTECT), the complete Response Decision Table,
 * strict decoupling of warnings from caretaker approval requests, monotonic precedence,
 * non-blocking advisory notifications, and dashboard immunity.
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import {
  ResponseAction,
  ResponseDecision,
} from '../types/response.js';
import {
  RiskAssessment,
  RiskLevel,
  RiskSignalId,
} from '../types/risk.js';
import {
  RESPONSE_ACTION_PRECEDENCE,
  DEFAULT_RESPONSE_POLICY,
  resolveResponsePrecedence,
} from './rules.js';
import {
  evaluateActionPipeline,
  decideResponse,
} from './engine.js';
import {
  ALL_GUARDRAIL_POLICIES,
  EXTERNAL_NAVIGATION_POLICY,
  CONTROLLED_DESTRUCTIVE_POLICY,
  CONTROLLED_PAYMENT_POLICY,
  SUSPICIOUS_DOWNLOAD_POLICY,
  PHISHING_PROTECTION_POLICY,
  ROUTINE_INTERACTION_POLICY,
} from './policies.js';
import {
  explainRiskDecision,
  extractWebsiteSecurityContext,
} from './explanation.js';
import {
  isDashboardOrInternalPage,
  isUntrustedWebDestination,
} from '../content/index.js';
import {
  showAdvisoryNotice,
  dismissAdvisoryNotice,
  isAdvisoryNoticeActive,
} from '../ui/advisory-notice.js';
import {
  showWarningModal,
  dismissWarningModal,
  isWarningModalActive,
} from '../ui/warning-modal.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message} (expected: ${String(expected)}, got: ${String(actual)})`);
  }
}

console.log('======================================================================');
console.log('🧪 PHASE 3: GUARDRAIL RISK ASSESSMENT & RESPONSE POLICY REDESIGN SUITE');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// DOM Mock Environment for UI tests in Node runtime
// -----------------------------------------------------------------------------
class MockNode {
  public id: string = '';
  public className: string = '';
  public tagName: string = 'DIV';
  public parentNode: MockNode | null = null;
  public children: MockNode[] = [];
  public style: Record<string, string> = {};
  public attributes: Record<string, string> = {};
  public textContent: string = '';
  public innerHTML: string = '';
  public shadowRoot: MockShadowRoot | null = null;

  constructor(tagName: string = 'DIV') {
    this.tagName = tagName.toUpperCase();
  }

  public appendChild(child: MockNode): MockNode {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  public remove(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  public getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  public hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  public removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  public attachShadow(_options: { mode: string }): MockShadowRoot {
    this.shadowRoot = new MockShadowRoot(this);
    return this.shadowRoot;
  }

  public querySelector(selector: string): MockNode | null {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      function search(node: MockNode): MockNode | null {
        if (node.className && node.className.split(' ').includes(cls)) return node;
        for (const child of node.children) {
          const found = search(child);
          if (found) return found;
        }
        return null;
      }
      return search(this);
    }
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      function search(node: MockNode): MockNode | null {
        if (node.id === id) return node;
        for (const child of node.children) {
          const found = search(child);
          if (found) return found;
        }
        return null;
      }
      return search(this);
    }
    return null;
  }

  public addEventListener(_type: string, _fn: any): void {}
  public removeEventListener(_type: string, _fn: any): void {}
}

class MockShadowRoot extends MockNode {
  public host: MockNode;
  constructor(host: MockNode) {
    super('#SHADOW-ROOT');
    this.host = host;
  }
}

class MockDocument extends MockNode {
  public body: MockNode;
  public readyState: string = 'complete';

  constructor() {
    super('#DOCUMENT');
    this.body = new MockNode('BODY');
    this.appendChild(this.body);
  }

  public createElement(tagName: string): MockNode {
    return new MockNode(tagName);
  }

  public getElementById(id: string): MockNode | null {
    function search(node: MockNode): MockNode | null {
      if (node.id === id) return node;
      for (const child of node.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    }
    return search(this);
  }
}

const mockDoc = new MockDocument();
(globalThis as any).document = mockDoc;
(globalThis as any).window = {
  location: { href: 'https://app.example.com/dashboard', hostname: 'app.example.com', origin: 'https://app.example.com' },
  addEventListener: () => {},
  removeEventListener: () => {},
};

// =============================================================================
// SUITE 1: 4 Centralized Response Levels Specification
// =============================================================================
console.log('▶ Suite 1: 4 Centralized Response Levels Specification');
{
  assertEquals(ResponseAction.ALLOW, 'ALLOW', 'ResponseAction.ALLOW is explicitly defined');
  assertEquals(ResponseAction.ADVISE, 'ADVISE', 'ResponseAction.ADVISE is explicitly defined');
  assertEquals(ResponseAction.WARN, 'WARN', 'ResponseAction.WARN is explicitly defined');
  assertEquals(ResponseAction.PROTECT, 'PROTECT', 'ResponseAction.PROTECT is explicitly defined');

  // Verify default risk tier mapping
  assertEquals(DEFAULT_RESPONSE_POLICY[RiskLevel.LOW], ResponseAction.ALLOW, 'LOW risk maps to ALLOW');
  assertEquals(DEFAULT_RESPONSE_POLICY[RiskLevel.MEDIUM], ResponseAction.ADVISE, 'MEDIUM risk maps to ADVISE');
  assertEquals(DEFAULT_RESPONSE_POLICY[RiskLevel.HIGH], ResponseAction.WARN, 'HIGH risk maps to WARN');
  assertEquals(DEFAULT_RESPONSE_POLICY[RiskLevel.CRITICAL], ResponseAction.PROTECT, 'CRITICAL risk maps to PROTECT');
}

// =============================================================================
// SUITE 2: Response Decision Table (11 Core Situations)
// =============================================================================
console.log('\n▶ Suite 2: Centralized Response Decision Table Verification');
{
  // 1. Normal browsing -> ALLOW
  const normalBrowsingAction: GuardrailAction = {
    id: 'act-tbl-1-browsing',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Documentation & Guides' },
    page: { url: 'https://app.example.com/docs', title: 'Docs' },
    timestamp: new Date().toISOString(),
  };
  const res1 = evaluateActionPipeline(normalBrowsingAction);
  assertEquals(res1.decision.response, ResponseAction.ALLOW, 'Row 1: Normal browsing -> ALLOW');
  assertEquals(res1.risk.riskLevel, RiskLevel.LOW, 'Row 1: Normal browsing risk is LOW');

  // 2. Normal account navigation -> ALLOW
  const accountNavAction: GuardrailAction = {
    id: 'act-tbl-2-account',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Account Settings' },
    page: { url: 'https://bank.example.com/dashboard', title: 'Dashboard' },
    timestamp: new Date().toISOString(),
  };
  const res2 = evaluateActionPipeline(accountNavAction);
  assertEquals(res2.decision.response, ResponseAction.ALLOW, 'Row 2: Normal account navigation -> ALLOW');

  // 3. Viewing bank balance -> ALLOW
  const viewBalanceAction: GuardrailAction = {
    id: 'act-tbl-3-balance',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Show Account Balance' },
    page: { url: 'https://bank.example.com/overview', title: 'Accounts' },
    timestamp: new Date().toISOString(),
  };
  const res3 = evaluateActionPipeline(viewBalanceAction);
  assertEquals(res3.decision.response, ResponseAction.ALLOW, 'Row 3: Viewing bank balance -> ALLOW');
  assertEquals(res3.classification.category, ActionCategory.FINANCIAL_READ_ONLY, 'Row 3: Classified as FINANCIAL_READ_ONLY');

  // 4. Viewing transaction history -> ALLOW
  const viewHistoryAction: GuardrailAction = {
    id: 'act-tbl-4-history',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'View Transaction History' },
    page: { url: 'https://bank.example.com/transactions', title: 'Statements' },
    timestamp: new Date().toISOString(),
  };
  const res4 = evaluateActionPipeline(viewHistoryAction);
  assertEquals(res4.decision.response, ResponseAction.ALLOW, 'Row 4: Viewing transaction history -> ALLOW');
  assertEquals(res4.classification.category, ActionCategory.FINANCIAL_READ_ONLY, 'Row 4: Classified as FINANCIAL_READ_ONLY');

  // 5. Unknown but ordinary website -> ALLOW or ADVISE
  const unknownSiteAction: GuardrailAction = {
    id: 'act-tbl-5-unknown-site',
    type: ActionType.NAVIGATION,
    page: { url: 'https://independent-blog.org/article', previousUrl: 'https://app.example.com/home', title: 'Blog' },
    category: ActionCategory.EXTERNAL_NAVIGATION,
    timestamp: new Date().toISOString(),
  };
  const res5 = evaluateActionPipeline(unknownSiteAction);
  assert(
    res5.decision.response === ResponseAction.ALLOW || res5.decision.response === ResponseAction.ADVISE,
    `Row 5: Unknown but ordinary website -> ALLOW or ADVISE (got: ${res5.decision.response})`
  );
  assert(res5.decision.response !== ResponseAction.WARN, 'Row 5: Unknown ordinary site does NOT trigger full modal WARN');
  assert(res5.decision.response !== ResponseAction.PROTECT, 'Row 5: Unknown ordinary site does NOT trigger PROTECT');

  // 6. Mildly suspicious destination -> ADVISE
  const mildSuspiciousAction: GuardrailAction = {
    id: 'act-tbl-6-mild-suspicious',
    type: ActionType.NAVIGATION,
    page: {
      url: 'https://sub1.sub2.sub3.legit-store.net/items',
      previousUrl: 'https://app.example.com/store',
      title: 'Store',
    },
    category: ActionCategory.EXTERNAL_NAVIGATION,
    timestamp: new Date().toISOString(),
  };
  const res6 = evaluateActionPipeline(mildSuspiciousAction);
  assertEquals(res6.decision.response, ResponseAction.ADVISE, 'Row 6: Mildly suspicious destination -> ADVISE');

  // 7. Meaningful risky action (e.g. crossing origin boundary to login or checkout) -> WARN
  const riskyAction: GuardrailAction = {
    id: 'act-tbl-7-risky',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Continue to External Checkout' },
    page: { url: 'https://trusted-shop.com/cart', title: 'Shopping Cart' },
    category: ActionCategory.PAYMENT,
    timestamp: new Date().toISOString(),
  };
  const res7 = evaluateActionPipeline(riskyAction);
  assertEquals(res7.decision.response, ResponseAction.WARN, 'Row 7: Meaningful risky action -> WARN');

  // 8. Strong phishing indicators -> PROTECT
  const phishingAction: GuardrailAction = {
    id: 'act-tbl-8-phishing',
    type: ActionType.NAVIGATION,
    element: {
      tagName: 'INPUT',
      hasPasswordField: true,
      hasSensitiveField: true,
    },
    page: {
      url: 'http://198.51.100.1/signin',
      previousUrl: 'https://app.example.com/portal',
      title: 'PayPal Login - Verify Account',
      metaBranding: 'PayPal',
      isSecureContext: false,
    },
    category: ActionCategory.AUTHENTICATION,
    timestamp: new Date().toISOString(),
  };
  const res8 = evaluateActionPipeline(phishingAction);
  assertEquals(res8.decision.response, ResponseAction.PROTECT, 'Row 8: Strong phishing indicators -> PROTECT');
  assertEquals(res8.risk.riskLevel, RiskLevel.CRITICAL, 'Row 8: Phishing evaluated as CRITICAL risk');

  // 9. Dangerous destructive action -> PROTECT
  const dangerousDestructiveAction: GuardrailAction = {
    id: 'act-tbl-9-destructive',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Permanently Delete Account and Wipe All Data' },
    page: { url: 'https://app.example.com/settings/danger-zone', title: 'Settings' },
    category: ActionCategory.DESTRUCTIVE,
    timestamp: new Date().toISOString(),
  };
  const res9 = evaluateActionPipeline(dangerousDestructiveAction);
  assertEquals(res9.decision.response, ResponseAction.PROTECT, 'Row 9: Dangerous destructive action -> PROTECT');

  // 10. High-risk financial authorization -> PROTECT
  const highRiskFinancialAction: GuardrailAction = {
    id: 'act-tbl-10-financial-protect',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Authorize Transfer to New Wire Beneficiary' },
    page: { url: 'https://bank.example.com/transfer/confirm', title: 'Wire Transfer' },
    category: ActionCategory.BENEFICIARY_MANAGEMENT,
    timestamp: new Date().toISOString(),
  };
  const res10 = evaluateActionPipeline(highRiskFinancialAction);
  assertEquals(res10.decision.response, ResponseAction.PROTECT, 'Row 10: High-risk financial authorization -> PROTECT');

  // 11. Suspicious executable download -> PROTECT
  const suspiciousDownloadAction: GuardrailAction = {
    id: 'act-tbl-11-download',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Download System Updater', downloadAttribute: 'installer.exe' },
    download: { filename: 'installer.exe', mimeType: 'application/x-msdownload' },
    page: { url: 'https://unknown-distributor.net/files', title: 'Downloads' },
    category: ActionCategory.FILE_DOWNLOAD,
    timestamp: new Date().toISOString(),
  };
  const res11 = evaluateActionPipeline(suspiciousDownloadAction);
  assertEquals(res11.decision.response, ResponseAction.PROTECT, 'Row 11: Suspicious executable download -> PROTECT');
}

// =============================================================================
// SUITE 3: Decoupling of Warnings from Caretaker Approval Requests
// =============================================================================
console.log('\n▶ Suite 3: Decoupling of Warnings from Caretaker Approval Requests');
{
  // INVARIANT: When a WARN response is rendered, NO approval request is created automatically.
  const warnAction: GuardrailAction = {
    id: 'act-warn-decoupled',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Pay Now $49.99' },
    page: { url: 'https://store.example.com/checkout', title: 'Checkout' },
    category: ActionCategory.PAYMENT,
    timestamp: new Date().toISOString(),
  };

  const { risk, decision } = evaluateActionPipeline(warnAction);
  assertEquals(decision.response, ResponseAction.WARN, 'Action evaluated to WARN');

  let approvalRequested = false;
  let continueClicked = false;
  let cancelClicked = false;

  dismissWarningModal();

  // Rendering the warning modal
  showWarningModal({
    action: warnAction,
    risk,
    decision,
    onRequestApproval: () => {
      approvalRequested = true;
    },
    onContinue: () => {
      continueClicked = true;
    },
    onCancel: () => {
      cancelClicked = true;
    },
  });

  assert(isWarningModalActive(), 'Warning modal is active in DOM');
  assert(approvalRequested === false, 'STRICT INVARIANT: Merely displaying warning does NOT trigger caretaker approval request');
  assert(continueClicked === false, 'User has not clicked continue');
  assert(cancelClicked === false, 'User has not clicked cancel');

  dismissWarningModal();
  assert(!isWarningModalActive(), 'Warning modal successfully dismissed');
}

// =============================================================================
// SUITE 4: Redesigned Warning Interface 4 Required Sections
// =============================================================================
console.log('\n▶ Suite 4: Redesigned Warning Interface 4 Required Sections');
{
  const testAction: GuardrailAction = {
    id: 'act-explanation-sections',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Delete Account Profile' },
    page: { url: 'https://app.example.com/settings', title: 'Settings' },
    timestamp: new Date().toISOString(),
  };

  const { risk, decision } = evaluateActionPipeline(testAction);
  const explanation = explainRiskDecision(decision, risk, testAction);

  // 1. What action is about to happen
  assert(Boolean(explanation.actionDescription), 'Section 1: actionDescription is populated');
  assert(
    explanation.actionDescription!.toLowerCase().includes('delete') ||
    explanation.actionDescription!.toLowerCase().includes('account'),
    `Section 1: Explains what action is happening ("${explanation.actionDescription}")`
  );

  // 2. Why Guardrail considers it risky
  assert(Boolean(explanation.whyRisky), 'Section 2: whyRisky is populated');
  assert(
    explanation.whyRisky!.length > 0,
    `Section 2: Explains why risky ("${explanation.whyRisky}")`
  );

  // 3. What could happen if user continues (consequences)
  assert(Boolean(explanation.consequences), 'Section 3: consequences is populated');
  assert(
    explanation.consequences!.length > 0,
    `Section 3: Explains consequences ("${explanation.consequences}")`
  );

  // 4. What safer choice is available
  assert(Boolean(explanation.saferChoice), 'Section 4: saferChoice is populated');
  assert(
    explanation.saferChoice!.toLowerCase().includes('cancel') ||
    explanation.saferChoice!.toLowerCase().includes('verify') ||
    explanation.saferChoice!.toLowerCase().includes('staging'),
    `Section 4: Explains safer choice ("${explanation.saferChoice}")`
  );
}

// =============================================================================
// SUITE 5: Non-Blocking Advisory Component (ADVISE Level)
// =============================================================================
console.log('\n▶ Suite 5: Non-Blocking Advisory Component (ADVISE Level)');
{
  const adviseAction: GuardrailAction = {
    id: 'act-advise-component',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'External Partner Blog' },
    page: { url: 'https://partner.org/blog', previousUrl: 'https://app.example.com/news', title: 'Partner' },
    timestamp: new Date().toISOString(),
  };

  dismissAdvisoryNotice();
  assert(!isAdvisoryNoticeActive(), 'Advisory notice initially inactive');

  const closeFn = showAdvisoryNotice({
    action: adviseAction,
    message: 'Visiting unverified external blog. Normal browsing is not blocked.',
    durationMs: 0, // Disable auto-timer for test determinism
  });

  assert(isAdvisoryNoticeActive(), 'Advisory notice is active in DOM');
  assert(!isWarningModalActive(), 'Advisory notice does NOT open full-screen warning modal');

  // Verify host pointer-events: none (non-blocking)
  const host = mockDoc.getElementById('guardrail-advisory-notice-host');
  assert(Boolean(host), 'Found advisory notice host element');
  assertEquals(host?.style.pointerEvents, 'none', 'INVARIANT: Advisory host has pointer-events: none (does not block clicks)');

  closeFn();
  assert(!isAdvisoryNoticeActive(), 'Advisory notice cleanly dismissed via return function');
}

// =============================================================================
// SUITE 6: Response Precedence Hierarchy Monotonicity
// =============================================================================
console.log('\n▶ Suite 6: Response Precedence Hierarchy Monotonicity');
{
  // Strict hierarchy: PROTECT (400) > WARN (300) > ADVISE (200) > ALLOW (100)
  assertEquals(RESPONSE_ACTION_PRECEDENCE[ResponseAction.PROTECT], 400, 'PROTECT is 400');
  assertEquals(RESPONSE_ACTION_PRECEDENCE[ResponseAction.WARN], 300, 'WARN is 300');
  assertEquals(RESPONSE_ACTION_PRECEDENCE[ResponseAction.ADVISE], 200, 'ADVISE is 200');
  assertEquals(RESPONSE_ACTION_PRECEDENCE[ResponseAction.ALLOW], 100, 'ALLOW is 100');

  assert(
    RESPONSE_ACTION_PRECEDENCE[ResponseAction.PROTECT] > RESPONSE_ACTION_PRECEDENCE[ResponseAction.WARN] &&
    RESPONSE_ACTION_PRECEDENCE[ResponseAction.WARN] > RESPONSE_ACTION_PRECEDENCE[ResponseAction.ADVISE] &&
    RESPONSE_ACTION_PRECEDENCE[ResponseAction.ADVISE] > RESPONSE_ACTION_PRECEDENCE[ResponseAction.ALLOW],
    'Precedence strictly satisfies: PROTECT > WARN > ADVISE > ALLOW'
  );

  // Monotonicity Check 1: Critical protection CANNOT be downgraded by WARN, ADVISE, or ALLOW
  const conflictingOutcomes1 = [
    { action: ResponseAction.ALLOW, reason: 'Allowed by general rule', rulePriority: 300 },
    { action: ResponseAction.ADVISE, reason: 'Advise caution', rulePriority: 250 },
    { action: ResponseAction.WARN, reason: 'Warn sensitive field', rulePriority: 200 },
    { action: ResponseAction.PROTECT, reason: 'Protect against credential theft', rulePriority: 50 },
  ];
  const resolved1 = resolveResponsePrecedence(conflictingOutcomes1);
  assertEquals(resolved1.action, ResponseAction.PROTECT, 'PROTECT dominates despite lowest rulePriority');

  // Monotonicity Check 2: WARN cannot be downgraded to ADVISE or ALLOW
  const conflictingOutcomes2 = [
    { action: ResponseAction.ALLOW, reason: 'Allowed by routine rule', rulePriority: 300 },
    { action: ResponseAction.ADVISE, reason: 'Advise notice', rulePriority: 250 },
    { action: ResponseAction.WARN, reason: 'Warning required', rulePriority: 100 },
  ];
  const resolved2 = resolveResponsePrecedence(conflictingOutcomes2);
  assertEquals(resolved2.action, ResponseAction.WARN, 'WARN dominates over ADVISE and ALLOW');

  // Monotonicity Check 3: ADVISE cannot be downgraded to ALLOW
  const conflictingOutcomes3 = [
    { action: ResponseAction.ALLOW, reason: 'Allowed by routine rule', rulePriority: 300 },
    { action: ResponseAction.ADVISE, reason: 'Advise notice', rulePriority: 100 },
  ];
  const resolved3 = resolveResponsePrecedence(conflictingOutcomes3);
  assertEquals(resolved3.action, ResponseAction.ADVISE, 'ADVISE dominates over ALLOW');
}

// =============================================================================
// SUITE 7: Dashboard & Internal Page Immunity
// =============================================================================
console.log('\n▶ Suite 7: Dashboard & Internal Page Immunity');
{
  // Dashboard mock element
  const dashApp = mockDoc.createElement('div');
  dashApp.id = 'dashboard-app';
  mockDoc.body.appendChild(dashApp);

  assert(isDashboardOrInternalPage(), 'Dashboard detected via #dashboard-app');

  // When on dashboard, untrusted web destination checks or modals must not run
  dashApp.remove();

  // Test dev server port 5173 immunity
  (globalThis as any).window.location = { port: '5173', hostname: 'localhost', origin: 'http://localhost:5173' };
  assert(isDashboardOrInternalPage(), 'Dev port 5173 is recognized as immune internal page');

  // Restore regular page
  (globalThis as any).window.location = { port: '443', hostname: 'app.example.com', origin: 'https://app.example.com' };
  assert(!isDashboardOrInternalPage(), 'External website is correctly recognized as subject to policy');
}

// =============================================================================
// SUITE 8: Zero Keyword-Only Critical Decisions & Multi-Dimensional Risk
// =============================================================================
console.log('\n▶ Suite 8: Zero Keyword-Only Critical Decisions & Multi-Dimensional Risk');
{
  // An element that merely has "pay" or "delete" in benign context without destructive/transactional consequences
  const benignKeywordAction: GuardrailAction = {
    id: 'act-benign-kw',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'View Payment FAQ' },
    page: { url: 'https://app.example.com/help', title: 'Help & FAQ' },
    timestamp: new Date().toISOString(),
  };

  const res = evaluateActionPipeline(benignKeywordAction);
  assert(res.decision.response !== ResponseAction.PROTECT, 'Keyword "Payment" in "View Payment FAQ" does NOT trigger PROTECT');
  assertEquals(res.decision.response, ResponseAction.ALLOW, 'Benign help click evaluates to ALLOW');
  assertEquals(res.risk.riskLevel, RiskLevel.LOW, 'Benign help click risk level is LOW');
}

// =============================================================================
// Summary
// =============================================================================
console.log('\n======================================================================');
console.log(`TOTAL PHASE 3 TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL PHASE 3 RISK ASSESSMENT & RESPONSE POLICY TESTS PASSED!\n');
}
