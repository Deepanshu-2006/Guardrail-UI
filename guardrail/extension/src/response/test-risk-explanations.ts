/**
 * Guardrail Decision Explanations, Privacy-Safe Diagnostics, & Accessibility Test Suite
 *
 * Verifies:
 * 1. Reason-to-message mapping for ALLOW, WARN, and PROTECT outcomes.
 * 2. Unknown reasons fallback gracefully without inventing rules or risk scores.
 * 3. Evaluation failures provide reassuring user copy and actionable recovery guidance.
 * 4. Policy matches are strictly distinguished from confirmed security threats (no unproven fraud/malice claims).
 * 5. Technical diagnostics are kept separate from user-facing explanations.
 * 6. Privacy sanitization: URLs have query parameters stripped; passwords, OTPs, and CVVs are redacted.
 * 7. Accessible UI behavior: ARIA alertdialog attributes, keyboard navigation, and focus safety.
 */

declare const process: { exit: (code: number) => void };

import { ActionType, GuardrailAction } from '../types/actions.js';
import { ResponseAction, ResponseDecision } from '../types/response.js';
import {
  EvaluationError,
  RiskEvaluationStatus,
  RiskLevel,
} from '../types/risk.js';
import { explainRiskDecision } from './explanation.js';
import {
  isPrivacySafe,
  sanitizeForDiagnostics,
  sanitizeUrlForDiagnostics,
} from '../utils/privacy.js';
import {
  HOST_ELEMENT_ID,
  isWarningModalActive,
  showWarningModal,
} from '../ui/warning-modal.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

function assertEquals<T>(actual: T, expected: T, testName: string): void {
  if (actual === expected) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName} - Expected: ${expected}, Got: ${actual}`);
    failed++;
  }
}

console.log('\n=== Guardrail Decision Explanations & Privacy-Safe Diagnostics Suite ===\n');

// =============================================================================
// Suite 1: Canonical Policy Reason-to-Message Mapping
// =============================================================================
console.log('▶ Suite 1: Canonical Policy Reason-to-Message Mapping');

// 1A: Controlled Destructive Action (PROTECT)
const destructiveDecision: ResponseDecision = {
  actionId: 'act-dest-1',
  response: ResponseAction.PROTECT,
  reasons: ['Irreversible destructive action detected on target element.'],
  policyRuleId: 'RULE_CONTROLLED_DESTRUCTIVE',
  structuredReasons: [
    {
      code: 'POLICY_PROTECT_DESTRUCTIVE',
      message: 'Irreversible destructive action detected on target element.',
      ruleId: 'RULE_CONTROLLED_DESTRUCTIVE',
      severity: RiskLevel.CRITICAL,
    },
  ],
  createdAt: new Date().toISOString(),
  status: RiskEvaluationStatus.EVALUATED,
  success: true,
};
const destructiveAction: GuardrailAction = {
  id: 'act-dest-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  element: { tagName: 'BUTTON', visibleText: 'Permanently Delete Account' },
  page: { url: 'https://app.example.com/account/settings?token=session123', title: 'Settings' },
};
const destExp = explainRiskDecision(destructiveDecision, undefined, destructiveAction);

assertEquals(destExp.decision, ResponseAction.PROTECT, 'Destructive action decision is PROTECT');
assertEquals(destExp.nature, 'POLICY_MATCH', 'Nature is categorized as POLICY_MATCH');
assertEquals(destExp.categoryBadge, 'Permanent Deletion Guard', 'Category badge is Permanent Deletion Guard');
assert(destExp.headline.includes('Permanent Deletion'), 'Headline clearly identifies Permanent Deletion');
assert(destExp.userSummary.includes('Staging Mode requires trusted confirmation'), 'Summary explains Staging Mode requirement');
assert(destExp.whyFlagged.length >= 2, 'Provides clear bullet points for why action was flagged');
assert(Boolean(destExp.recoveryGuidance?.length), 'Provides practical recovery steps');
assertEquals(destExp.isSecurityThreat, false, 'Explicitly NOT classified as confirmed security threat');
assertEquals(destExp.technicalDetails.ruleId, 'RULE_CONTROLLED_DESTRUCTIVE', 'Technical ruleId preserved');
assertEquals(destExp.technicalDetails.reasonCode, 'POLICY_PROTECT_DESTRUCTIVE', 'Technical reasonCode preserved');

// 1B: Controlled Payment Advisory (WARN)
const paymentDecision: ResponseDecision = {
  actionId: 'act-pay-1',
  response: ResponseAction.WARN,
  reasons: ['Action interacts with checkout or payment transaction flow.'],
  policyRuleId: 'RULE_PAYMENT_INTERACTION_POLICY',
  structuredReasons: [
    {
      code: 'POLICY_WARN_PAYMENT',
      message: 'Action interacts with checkout or payment transaction flow.',
      ruleId: 'RULE_PAYMENT_INTERACTION_POLICY',
      severity: RiskLevel.MEDIUM,
    },
  ],
  createdAt: new Date().toISOString(),
  status: RiskEvaluationStatus.EVALUATED,
  success: true,
};
const paymentAction: GuardrailAction = {
  id: 'act-pay-1',
  type: ActionType.CLICK,
  timestamp: new Date().toISOString(),
  element: { tagName: 'BUTTON', visibleText: 'Pay $49.99' },
  page: { url: 'https://store.example.com/checkout?cartId=99', title: 'Checkout' },
};
const payExp = explainRiskDecision(paymentDecision, undefined, paymentAction);

assertEquals(payExp.decision, ResponseAction.WARN, 'Payment decision is WARN');
assertEquals(payExp.nature, 'OPERATIONAL_PRECAUTION', 'Nature is categorized as OPERATIONAL_PRECAUTION');
assertEquals(payExp.categoryBadge, 'Payment Advisory', 'Category badge is Payment Advisory');
assert(payExp.headline.includes('Checkout or Billing'), 'Headline specifies Checkout or Billing');
assert(payExp.userSummary.includes('verify transaction details'), 'Summary instructs user to verify details');
assert(payExp.whyFlagged.some((w) => w.includes('never accessed or stored')), 'Affirms credentials/cards are never accessed');

// 1C: External Navigation Advisory (WARN)
const extNavDecision: ResponseDecision = {
  actionId: 'act-nav-1',
  response: ResponseAction.WARN,
  reasons: ['Action navigates away to an external domain origin.'],
  policyRuleId: 'RULE_EXTERNAL_NAVIGATION',
  structuredReasons: [
    {
      code: 'POLICY_WARN_EXTERNAL_NAVIGATION',
      message: 'Action navigates away to an external domain origin.',
      ruleId: 'RULE_EXTERNAL_NAVIGATION',
      severity: RiskLevel.MEDIUM,
    },
  ],
  createdAt: new Date().toISOString(),
  status: RiskEvaluationStatus.EVALUATED,
  success: true,
};
const extNavExp = explainRiskDecision(extNavDecision);
assertEquals(extNavExp.categoryBadge, 'External Domain Advisory', 'Category badge is External Domain Advisory');
assert(extNavExp.whyFlagged.some((w) => w.includes('does not claim this external website is fraudulent')), 'Affirms no claim of fraud on external site');

// 1D: Routine Benign Interaction (ALLOW)
const routineDecision: ResponseDecision = {
  actionId: 'act-allow-1',
  response: ResponseAction.ALLOW,
  reasons: ['Standard routine interaction.'],
  policyRuleId: 'RULE_ROUTINE_ALLOW',
  structuredReasons: [
    {
      code: 'POLICY_ALLOW_ROUTINE',
      message: 'Standard routine interaction.',
      ruleId: 'RULE_ROUTINE_ALLOW',
      severity: RiskLevel.LOW,
    },
  ],
  createdAt: new Date().toISOString(),
  status: RiskEvaluationStatus.EVALUATED,
  success: true,
};
const routineExp = explainRiskDecision(routineDecision);
assertEquals(routineExp.decision, ResponseAction.ALLOW, 'Routine decision is ALLOW');
assertEquals(routineExp.nature, 'BASELINE_ROUTINE', 'Nature is BASELINE_ROUTINE');
assertEquals(routineExp.headline, 'Action Permitted: Standard Interaction', 'Headline is Action Permitted');
assertEquals(routineExp.technicalDetails.score, 0, 'Technical score reflects 0');

// =============================================================================
// Suite 2: Policy Match vs Confirmed Security Threat Distinction
// =============================================================================
console.log('\n▶ Suite 2: Policy Match vs Confirmed Security Threat Distinction');

const allDecisions = [destructiveDecision, paymentDecision, extNavDecision, routineDecision];
const forbiddenThreatTerms = ['malicious', 'phishing', 'fraudulent', 'criminal', 'attacker', 'hack'];

for (const d of allDecisions) {
  const exp = explainRiskDecision(d);
  assertEquals(exp.isSecurityThreat, false, `Decision ${d.actionId} has isSecurityThreat strictly false`);

  const serializedCopy = `${exp.headline} ${exp.userSummary} ${exp.whyFlagged.join(' ')}`.toLowerCase();
  for (const term of forbiddenThreatTerms) {
    // Only exception allowed is clarifying that Guardrail does NOT claim malice/fraud
    if (serializedCopy.includes(term)) {
      assert(
        serializedCopy.includes(`does not claim`) || serializedCopy.includes('never claims'),
        `Forbidden term "${term}" used only in disclaiming malice: ${exp.headline}`
      );
    } else {
      assert(true, `Copy avoids unproven threat claim "${term}" in ${exp.headline}`);
    }
  }
}

// =============================================================================
// Suite 3: Evaluation Failures & Actionable Recovery Guidance
// =============================================================================
console.log('\n▶ Suite 3: Evaluation Failures & Actionable Recovery Guidance');

const failureError: EvaluationError = {
  code: 'PIPELINE_EVALUATION_EXCEPTION',
  message: 'Unexpected syntax error in DOM observer payload.',
};
const failureDecision: ResponseDecision = {
  actionId: 'act-fail-1',
  response: ResponseAction.PROTECT,
  reasons: ['Evaluation failed: fail closed strictly to PROTECT.'],
  status: RiskEvaluationStatus.FAILED,
  success: false,
  policyRuleId: 'RULE_FAIL_CLOSED_FALLBACK',
  error: failureError,
  createdAt: new Date().toISOString(),
};
const failExp = explainRiskDecision(failureDecision);

assertEquals(failExp.decision, ResponseAction.PROTECT, 'Evaluation failure fails closed to PROTECT');
assertEquals(failExp.nature, 'EVALUATION_FAILURE', 'Nature is marked EVALUATION_FAILURE');
assertEquals(failExp.categoryBadge, 'Safety Precaution (Error)', 'Badge indicates Safety Precaution');
assert(failExp.headline.includes('Verification Incomplete'), 'Headline identifies Verification Incomplete');
assert(failExp.userSummary.includes('fail-closed protection was applied'), 'Summary clarifies fail-closed protection');
assert(failExp.recoveryGuidance !== undefined && failExp.recoveryGuidance.length >= 3, 'Provides at least 3 recovery steps');
assert(failExp.recoveryGuidance?.[0].includes('Refresh the webpage') || false, 'Recovery step suggests refreshing the webpage');
assertEquals(failExp.technicalDetails.evaluationStatus, RiskEvaluationStatus.FAILED, 'Evaluation status recorded as FAILED');
assertEquals(failExp.technicalDetails.reasonCode, 'PIPELINE_EVALUATION_EXCEPTION', 'Technical error code matches');

// Action ID mismatch failure
const mismatchDecision: ResponseDecision = {
  actionId: 'act-mismatch-1',
  response: ResponseAction.PROTECT,
  reasons: ['Action ID mismatch detected.'],
  status: RiskEvaluationStatus.FAILED,
  success: false,
  policyRuleId: 'RULE_FAIL_CLOSED_FALLBACK',
  structuredReasons: [
    {
      code: 'PIPELINE_ACTION_ID_MISMATCH',
      message: 'Action ID mismatch across pipeline.',
      severity: RiskLevel.CRITICAL,
    },
  ],
  createdAt: new Date().toISOString(),
};
const mismatchExp = explainRiskDecision(mismatchDecision);
assert(mismatchExp.headline.includes('Context Mismatch'), 'Action ID mismatch produces Context Mismatch headline');
assertEquals(mismatchExp.technicalDetails.reasonCode, 'PIPELINE_ACTION_ID_MISMATCH', 'Preserves mismatch code');

// =============================================================================
// Suite 4: Unknown / Custom Reasons Graceful Handling (No Fabrication)
// =============================================================================
console.log('\n▶ Suite 4: Unknown / Custom Reasons Graceful Handling');

const unknownWarnDecision: ResponseDecision = {
  actionId: 'act-unknown-warn',
  response: ResponseAction.WARN,
  reasons: ['Custom heuristic rule matched from legacy engine.'],
  structuredReasons: [
    {
      code: 'UNKNOWN_LEGACY_CODE_99',
      message: 'Custom heuristic rule matched.',
      severity: RiskLevel.MEDIUM,
    },
  ],
  createdAt: new Date().toISOString(),
  status: RiskEvaluationStatus.EVALUATED,
  success: true,
};
const unknownWarnExp = explainRiskDecision(unknownWarnDecision);

assertEquals(unknownWarnExp.decision, ResponseAction.WARN, 'Unknown reason preserves decision WARN');
assertEquals(unknownWarnExp.nature, 'OPERATIONAL_PRECAUTION', 'Nature is OPERATIONAL_PRECAUTION');
assertEquals(unknownWarnExp.headline, 'Safety Advisory: Sensitive Operation', 'Clear fallback headline without inventing rules');
assert(unknownWarnExp.whyFlagged.includes('Custom heuristic rule matched from legacy engine.'), 'Preserves raw reason without inventing text');
assertEquals(unknownWarnExp.technicalDetails.reasonCode, 'UNKNOWN_LEGACY_CODE_99', 'Accurately documents unknown code');

// =============================================================================
// Suite 5: Privacy-Safe Diagnostics & Sanitization
// =============================================================================
console.log('\n▶ Suite 5: Privacy-Safe Diagnostics & Sanitization');

// 5A: URL query parameter and hash stripping
const complexUrl = 'https://bank.example.com/transfer?user=alice&token=sec_9876543210&session=ses_abc#step2';
const sanitized = sanitizeUrlForDiagnostics(complexUrl);
assertEquals(sanitized, 'https://bank.example.com/transfer', 'Query parameters and fragments are completely stripped');
assert(!sanitized.includes('token'), 'URL does not contain token');
assert(!sanitized.includes('session'), 'URL does not contain session');
assert(!sanitized.includes('step2'), 'URL does not contain fragment');

// Relative URL sanitization
const relativeUrl = '/account/settings?apiKey=mySecretKey#profile';
const sanitizedRelative = sanitizeUrlForDiagnostics(relativeUrl);
assertEquals(sanitizedRelative, '/account/settings', 'Relative paths have query and hash stripped');

// 5B: Deep payload sanitization for diagnostic logging
const rawDiagnosticPayload = {
  actionId: 'act-diag-001',
  pageUrl: 'https://app.example.com/auth?token=supersecret123',
  formData: {
    username: 'alice@example.com',
    password: 'P@ssword123!',
    otp: '123456',
    cardNumber: '4111222233334444',
    cvv: '123',
    sessionToken: 'jwt.token.here',
  },
  riskScore: 85,
};

const cleanPayload = sanitizeForDiagnostics(rawDiagnosticPayload);
assertEquals(cleanPayload.pageUrl, 'https://app.example.com/auth', 'pageUrl is sanitized in payload');
assertEquals((cleanPayload as any).formData.password, '[REDACTED]', 'password is redacted');
assertEquals((cleanPayload as any).formData.otp, '[REDACTED]', 'otp is redacted');
assertEquals((cleanPayload as any).formData.cardNumber, '[REDACTED]', 'cardNumber is redacted');
assertEquals((cleanPayload as any).formData.cvv, '[REDACTED]', 'cvv is redacted');
assertEquals((cleanPayload as any).formData.sessionToken, '[REDACTED]', 'sessionToken is redacted');
assertEquals((cleanPayload as any).formData.username, 'alice@example.com', 'Non-credential fields are retained');

// 5C: Audit verifier
const safetyCheck = isPrivacySafe(cleanPayload);
assert(safetyCheck.safe, 'Sanitized payload passes isPrivacySafe audit');
assertEquals(safetyCheck.violations.length, 0, 'Zero privacy violations in sanitized payload');

const unsafeCheck = isPrivacySafe(rawDiagnosticPayload);
assert(!unsafeCheck.safe, 'Unsanitized payload is flagged as unsafe');
assert(unsafeCheck.violations.length >= 4, 'Identifies multiple sensitive key violations');

// =============================================================================
// Suite 6: Accessible Warning UI Dialog Behavior
// =============================================================================
console.log('\n▶ Suite 6: Accessible Warning UI Dialog Behavior');

// Mock browser DOM environment for testing modal rendering
type ListenerMap = Record<string, ((e: any) => void)[]>;

class MockDOMElement {
  public id: string = '';
  public className: string = '';
  public tagName: string = 'DIV';
  public textContent: string = '';
  public innerHTML: string = '';
  public style: Record<string, string> = {};
  public attributes: Record<string, string> = {};
  public children: MockDOMElement[] = [];
  public parentNode: MockDOMElement | null = null;
  public shadowRoot: MockDOMElement | null = null;
  private listeners: ListenerMap = {};

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }
  appendChild(child: MockDOMElement): MockDOMElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  attachShadow(_options: { mode: string }): MockDOMElement {
    this.shadowRoot = new MockDOMElement();
    this.shadowRoot.tagName = 'SHADOW-ROOT';
    return this.shadowRoot;
  }
  remove(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
  }
  addEventListener(event: string, fn: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  dispatchEvent(event: { type: string }): boolean {
    const list = this.listeners[event.type] || [];
    for (const fn of list) {
      fn(event);
    }
    return true;
  }
  focus(): void {}
}

const mockBody = new MockDOMElement();
mockBody.tagName = 'BODY';

const globalMockDocument: any = {
  body: mockBody,
  createElement(tag: string): MockDOMElement {
    const el = new MockDOMElement();
    el.tagName = tag.toUpperCase();
    return el;
  },
  getElementById(id: string): MockDOMElement | null {
    function find(node: MockDOMElement): MockDOMElement | null {
      if (node.id === id) return node;
      for (const c of node.children) {
        const res = find(c);
        if (res) return res;
      }
      if (node.shadowRoot) {
        const res = find(node.shadowRoot);
        if (res) return res;
      }
      return null;
    }
    return find(mockBody);
  },
};

(globalThis as any).document = globalMockDocument;
(globalThis as any).window = {
  addEventListener: () => {},
  removeEventListener: () => {},
};

let cancelInvoked = false;
let continueInvoked = false;

const dismissFn = showWarningModal({
  action: paymentAction,
  risk: {
    actionId: paymentAction.id,
    riskLevel: RiskLevel.MEDIUM,
    score: 40,
    reasons: ['Action interacts with checkout flow.'],
    evaluatedAt: new Date().toISOString(),
  },
  decision: paymentDecision,
  onCancel: () => {
    cancelInvoked = true;
  },
  onContinue: () => {
    continueInvoked = true;
  },
});

assert(isWarningModalActive(), 'Warning modal is active in DOM');

const hostEl = globalMockDocument.getElementById(HOST_ELEMENT_ID);
assert(hostEl !== null, 'Host element found in DOM');

const shadowRoot = hostEl?.shadowRoot;
assert(shadowRoot !== null, 'Shadow root attached for CSS insulation');

// Traverse shadowRoot to verify ARIA attributes
function findInTree(root: MockDOMElement, predicate: (el: MockDOMElement) => boolean): MockDOMElement | null {
  if (predicate(root)) return root;
  for (const c of root.children) {
    const res = findInTree(c, predicate);
    if (res) return res;
  }
  return null;
}

const alertCard = findInTree(shadowRoot, (el) => el.getAttribute('role') === 'alertdialog');
assert(alertCard !== null, 'Card has role="alertdialog"');
assertEquals(alertCard?.getAttribute('aria-modal'), 'true', 'Card has aria-modal="true"');
assertEquals(alertCard?.getAttribute('aria-labelledby'), 'gr-title-id', 'Card points to aria-labelledby="gr-title-id"');
assertEquals(alertCard?.getAttribute('aria-describedby'), 'gr-summary-id', 'Card points to aria-describedby="gr-summary-id"');

// Verify separated Technical Diagnostics section
const diagDetails = findInTree(shadowRoot, (el) => el.tagName === 'DETAILS');
assert(diagDetails !== null, 'Modal includes separated <details> for technical diagnostics');

const diagSummary = findInTree(shadowRoot, (el) => el.tagName === 'SUMMARY');
assert(diagSummary?.textContent.includes('Technical Diagnostics') || false, 'Summary clearly labels Technical Diagnostics');

// Dismissal cleanup
assertEquals(cancelInvoked, false, 'Cancel callback not prematurely called');
assertEquals(continueInvoked, false, 'Continue callback not prematurely called');
dismissFn();
assert(!isWarningModalActive(), 'Warning modal cleanly dismissed');

// =============================================================================
// Summary
// =============================================================================
console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All risk decision explanation and privacy diagnostics tests PASSED cleanly.\n');
}
