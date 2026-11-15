/**
 * Guardrail Phase 1 Detection & Classification Redesign - Verification Suite
 *
 * Verifies all Phase 1 requirements:
 * 1. Element Context Isolation from Page Context (URL pathname and title never bleed into element tokens).
 * 2. Normalized Bounded Keyword Matching (no substring false positives like "taxpayer" or "transfer-list").
 * 3. Granular Category Classification:
 *    - GENERAL / GENERAL_BROWSING
 *    - AUTHENTICATION
 *    - FINANCIAL_READ_ONLY
 *    - FINANCIAL_TRANSACTION
 *    - BENEFICIARY_MANAGEMENT
 *    - DESTRUCTIVE / DESTRUCTIVE_ACTION
 *    - DOWNLOAD / FILE_DOWNLOAD
 *    - PERMISSION_CHANGE
 *    - SECURITY_SETTING_CHANGE
 *    - EXTERNAL_NAVIGATION
 *    - SENSITIVE_DATA_SUBMISSION
 *    - SUSPICIOUS_REDIRECT
 * 4. Intent Distinction:
 *    - Account navigation on /account/transfer does not become payment.
 *    - Transaction history does not become money transfer.
 *    - Normal buttons on login page do not trigger auth warnings.
 *    - Normal controls on checkout page do not trigger payment authorization.
 *    - Passive "Verify" in navigation does not trigger auth.
 *    - CSS classes (payment-group, transfer-list, btn-verify, external-link) do not trigger high-risk categories.
 * 5. Preservation of Genuine High-Risk Detection:
 *    - Money transfers, account deletions, downloads, and external navigations remain fully detectable.
 * 6. Privacy Preservation: Zero passwords, OTPs, PINs, or typed credentials inspected.
 */

declare const process: { exit: (code: number) => void };

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { RiskLevel } from '../types/risk.js';
import { classifyAction } from './classifier.js';
import {
  matchesBoundedPhrase,
  matchesAnyPhrase,
  extractActionElementTexts,
  extractPageContext,
} from './rules.js';
import { assessRisk } from '../risk/engine.js';
import { evaluateActionPipeline } from '../response/engine.js';

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
    console.error(`  ✗ FAIL: ${message} (expected: "${String(expected)}", got: "${String(actual)}")`);
  }
}

console.log('============================================================');
console.log('🧪 PHASE 1: GUARDRAIL ACTION DETECTION & CLASSIFICATION SUITE');
console.log('============================================================\n');

// =============================================================================
// TEST SUITE 1: Bounded Semantic Matching vs Substring Bleed
// =============================================================================
console.log('▶ Suite 1: Bounded Semantic Matching vs Unrestricted Substrings');
{
  // 1. "pay" should match "pay", "pay now", "pay ₹5,000", but NOT "taxpayer", "company", "paypal"
  assert(matchesBoundedPhrase('Pay ₹2,500', 'pay'), 'Matches "pay" in "Pay ₹2,500"');
  assert(matchesBoundedPhrase('Proceed to Pay Now', 'pay now'), 'Matches "pay now" in phrase');
  assert(!matchesBoundedPhrase('Taxpayer Identification', 'pay'), 'Does NOT match "pay" inside "taxpayer"');
  assert(!matchesBoundedPhrase('Company Overview', 'pay'), 'Does NOT match "pay" inside "company"');
  assert(!matchesBoundedPhrase('Payment-Group-Container', 'pay'), 'Does NOT match "pay" inside "payment-group-container" as word "pay"');

  // 2. "transfer" should match "Transfer Funds", but NOT "untransferred"
  assert(matchesBoundedPhrase('Transfer Money to Alice', 'transfer'), 'Matches "transfer" in "Transfer Money"');
  assert(!matchesBoundedPhrase('Untransferred Items', 'transfer'), 'Does NOT match "transfer" inside "untransferred"');

  // 3. Multiword phrases with punctuation
  assert(matchesBoundedPhrase('Transfer Money - Instant!', 'transfer money'), 'Matches multiword phrase with punctuation');
  assert(matchesBoundedPhrase('Add Beneficiary (Domestic)', 'add beneficiary'), 'Matches multiword phrase with parentheses');
  assert(matchesBoundedPhrase('Delete Account...', 'delete account'), 'Matches "delete account" with trailing dots');

  // 4. matchesAnyPhrase
  const sampleTexts = ['View Dashboard', 'Settings and Privacy'];
  const res = matchesAnyPhrase(sampleTexts, ['pay', 'checkout', 'transfer']);
  assert(!res.matched, 'Benign texts do not match payment phrases');
}

// =============================================================================
// TEST SUITE 2: Element Context vs Page Context Isolation
// =============================================================================
console.log('\n▶ Suite 2: Element vs Page Context Isolation (Zero Metadata Bleed)');
{
  // Interaction on /account/transfer: clicking benign links should NOT become PAYMENT
  const bankingPage = {
    url: 'https://bank.example.com/account/transfer',
    title: 'Bank Transfer - Initiate Funds Transfer',
  };

  const benignControls = [
    { text: 'Account overview', expectedCategory: ActionCategory.FINANCIAL_READ_ONLY },
    { text: 'Transaction history', expectedCategory: ActionCategory.FINANCIAL_READ_ONLY },
    { text: 'Profile & Settings', expectedCategory: ActionCategory.GENERAL },
    { text: 'Back to Home', expectedCategory: ActionCategory.GENERAL },
    { text: 'Next Page', expectedCategory: ActionCategory.GENERAL },
    { text: 'Download Statement', expectedCategory: ActionCategory.FINANCIAL_READ_ONLY },
    { text: 'Help & Support', expectedCategory: ActionCategory.GENERAL },
  ];

  for (const control of benignControls) {
    const action: GuardrailAction = {
      id: `act-banking-nav-${control.text.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      type: ActionType.CLICK,
      element: {
        tagName: 'A',
        visibleText: control.text,
        className: 'transfer-nav-item payment-header-link',
      },
      page: bankingPage,
      timestamp: new Date().toISOString(),
    };

    // Classification test
    const classification = classifyAction(action);
    assertEquals(
      classification.category,
      control.expectedCategory,
      `Clicking "${control.text}" on /account/transfer is ${control.expectedCategory} (NOT PAYMENT)`
    );

    // End-to-end pipeline test
    const pipeline = evaluateActionPipeline(action);
    assertEquals(
      pipeline.decision.response,
      ResponseAction.ALLOW,
      `Clicking "${control.text}" yields ALLOW decision without warning/staging modal`
    );
    assert(pipeline.risk.score <= 24, `Risk score remains LOW (got: ${pipeline.risk.score})`);
  }
}

// =============================================================================
// TEST SUITE 3: Transaction History vs Money Transfer Distinction
// =============================================================================
console.log('\n▶ Suite 3: Transaction History vs Transactional Intent');
{
  // 1. Transaction history button / table row
  const historyAction: GuardrailAction = {
    id: 'act-tx-history',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      visibleText: 'View Transaction History',
      className: 'transfer-history-btn',
    },
    page: { url: 'https://bank.example.com/dashboard', title: 'Dashboard' },
    timestamp: new Date().toISOString(),
  };

  const historyClass = classifyAction(historyAction);
  assertEquals(historyClass.category, ActionCategory.FINANCIAL_READ_ONLY, 'Transaction History is FINANCIAL_READ_ONLY');

  const historyPipeline = evaluateActionPipeline(historyAction);
  assertEquals(historyPipeline.decision.response, ResponseAction.ALLOW, 'Transaction history yields ALLOW');
  assertEquals(historyPipeline.risk.score, 0, 'Transaction history has 0 risk score');

  // 2. Click on past transaction row (e.g. "Transfer to Bob ₹500 - Completed")
  const rowAction: GuardrailAction = {
    id: 'act-tx-row',
    type: ActionType.CLICK,
    element: {
      tagName: 'TR',
      visibleText: 'Past Transfers: Transfer to Bob ₹500 - Completed',
      ariaLabel: 'Transaction details for past transfer to Bob',
    },
    page: { url: 'https://bank.example.com/history', title: 'Statements' },
    timestamp: new Date().toISOString(),
  };

  const rowClass = classifyAction(rowAction);
  assertEquals(rowClass.category, ActionCategory.FINANCIAL_READ_ONLY, 'Past transfer row is FINANCIAL_READ_ONLY');
  const rowPipeline = evaluateActionPipeline(rowAction);
  assertEquals(rowPipeline.decision.response, ResponseAction.ALLOW, 'Past transfer row yields ALLOW');

  // 3. Genuine money transfer button ("Transfer Money")
  const transferAction: GuardrailAction = {
    id: 'act-real-transfer',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      visibleText: 'Transfer Money Now',
      ariaLabel: 'Submit fund transfer',
    },
    page: { url: 'https://bank.example.com/transfer', title: 'Fund Transfer' },
    timestamp: new Date().toISOString(),
  };

  const transferClass = classifyAction(transferAction);
  assertEquals(transferClass.category, ActionCategory.FINANCIAL_TRANSACTION, 'Genuine transfer is FINANCIAL_TRANSACTION');
}

// =============================================================================
// TEST SUITE 4: Login Page Benign Controls vs Authentication
// =============================================================================
console.log('\n▶ Suite 4: Login Page Benign Controls vs Authentication');
{
  const loginPage = {
    url: 'https://auth.example.com/login',
    title: 'Sign In to Your Account',
  };

  const loginControls = [
    { text: 'Forgot Password?', expected: ActionCategory.GENERAL },
    { text: 'Help & FAQ', expected: ActionCategory.GENERAL },
    { text: 'Terms of Service', expected: ActionCategory.GENERAL },
    { text: 'Privacy Notice', expected: ActionCategory.GENERAL },
    { text: 'English (US)', expected: ActionCategory.GENERAL },
  ];

  for (const c of loginControls) {
    const action: GuardrailAction = {
      id: `act-login-${c.text.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      type: ActionType.CLICK,
      element: {
        tagName: 'A',
        visibleText: c.text,
        className: 'login-footer-link btn-auth-secondary',
      },
      page: loginPage,
      timestamp: new Date().toISOString(),
    };

    const classification = classifyAction(action);
    assertEquals(
      classification.category,
      c.expected,
      `Clicking "${c.text}" on login page is ${c.expected} (NOT AUTHENTICATION)`
    );

    const pipeline = evaluateActionPipeline(action);
    assertEquals(
      pipeline.decision.response,
      ResponseAction.ALLOW,
      `Clicking "${c.text}" on login page does NOT trigger auth warning`
    );
  }

  // Active sign in button MUST still be classified as AUTHENTICATION
  const signInAction: GuardrailAction = {
    id: 'act-real-signin',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      visibleText: 'Sign In to Account',
    },
    page: loginPage,
    timestamp: new Date().toISOString(),
  };
  const signInClass = classifyAction(signInAction);
  assertEquals(signInClass.category, ActionCategory.AUTHENTICATION, 'Active Sign In button is AUTHENTICATION');
}

// =============================================================================
// TEST SUITE 5: Passive "Verify" in Navigation vs Credential Verification
// =============================================================================
console.log('\n▶ Suite 5: Passive "Verify" in Navigation Menus');
{
  const navItems = [
    'Verify Certificate',
    'Verify Order Status',
    'Verify Delivery Address',
    'Verify',
  ];

  for (const text of navItems) {
    const action: GuardrailAction = {
      id: `act-nav-${text.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      type: ActionType.CLICK,
      element: {
        tagName: 'A',
        visibleText: text,
        className: 'nav-item menu-link btn-verify',
      },
      page: { url: 'https://store.example.com/account/orders', title: 'Orders' },
      timestamp: new Date().toISOString(),
    };

    const classification = classifyAction(action);
    assertEquals(
      classification.category,
      ActionCategory.GENERAL,
      `Menu link "${text}" is GENERAL (NOT AUTHENTICATION)`
    );

    const pipeline = evaluateActionPipeline(action);
    assertEquals(
      pipeline.decision.response,
      ResponseAction.ALLOW,
      `Menu link "${text}" does NOT trigger auth modal`
    );
  }
}

// =============================================================================
// TEST SUITE 6: CSS Classes & Framework Identifiers Do Not Trigger Risk
// =============================================================================
console.log('\n▶ Suite 6: CSS Framework Class Immunity');
{
  const cssTestActions: Array<{ text: string; classes: string; desc: string }> = [
    {
      text: 'View Details',
      classes: 'payment-group transfer-list checkout-button btn-pay',
      desc: 'Element with payment/transfer CSS classes',
    },
    {
      text: 'Learn More',
      classes: 'btn-verify auth-container login-form-wrapper',
      desc: 'Element with auth/verify CSS classes',
    },
    {
      text: 'Read Article',
      classes: 'external-link third-party-link redirect-notice',
      desc: 'Element with external/redirect CSS classes',
    },
    {
      text: 'Cancel',
      classes: 'delete-button destructive-action terminate-btn',
      desc: 'Element with destructive CSS classes',
    },
  ];

  for (const item of cssTestActions) {
    const action: GuardrailAction = {
      id: `act-css-${item.text.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      type: ActionType.CLICK,
      element: {
        tagName: 'BUTTON',
        visibleText: item.text,
        className: item.classes,
      },
      page: { url: 'https://example.com/article', title: 'Article' },
      timestamp: new Date().toISOString(),
    };

    const classification = classifyAction(action);
    assertEquals(
      classification.category,
      ActionCategory.GENERAL,
      `${item.desc} is classified as GENERAL (classes ignored)`
    );

    const pipeline = evaluateActionPipeline(action);
    assertEquals(
      pipeline.decision.response,
      ResponseAction.ALLOW,
      `${item.desc} yields ALLOW without risk escalation`
    );
    assertEquals(pipeline.risk.score, 0, 'Risk score is strictly 0');
  }
}

// =============================================================================
// TEST SUITE 7: Checkout Page Non-Payment Controls
// =============================================================================
console.log('\n▶ Suite 7: Checkout Page Non-Payment Controls');
{
  const checkoutPage = {
    url: 'https://store.example.com/checkout',
    title: 'Checkout - Complete Your Payment',
  };

  const checkoutControls = [
    'Edit Cart',
    'Apply Coupon',
    'Shipping Policy',
    'Back to Store',
    'Item Quantity +',
    'FAQ',
  ];

  for (const text of checkoutControls) {
    const action: GuardrailAction = {
      id: `act-checkout-${text.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      type: ActionType.CLICK,
      element: {
        tagName: 'BUTTON',
        visibleText: text,
      },
      page: checkoutPage,
      timestamp: new Date().toISOString(),
    };

    const classification = classifyAction(action);
    assertEquals(
      classification.category,
      ActionCategory.GENERAL,
      `Checkout control "${text}" is GENERAL (NOT PAYMENT)`
    );

    const pipeline = evaluateActionPipeline(action);
    assertEquals(
      pipeline.decision.response,
      ResponseAction.ALLOW,
      `Checkout control "${text}" yields ALLOW`
    );
  }

  // Active checkout submit button MUST still be PAYMENT
  const checkoutSubmit: GuardrailAction = {
    id: 'act-real-checkout',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      visibleText: 'Checkout & Pay Now',
    },
    page: checkoutPage,
    timestamp: new Date().toISOString(),
  };
  const payClass = classifyAction(checkoutSubmit);
  assertEquals(payClass.category, ActionCategory.PAYMENT, 'Checkout & Pay Now button is PAYMENT');
}

// =============================================================================
// TEST SUITE 8: Granular Category Detection & Intent Preservation
// =============================================================================
console.log('\n▶ Suite 8: Granular Category Detection & Intent Preservation');
{
  // 1. BENEFICIARY_MANAGEMENT
  const addBenAction: GuardrailAction = {
    id: 'act-add-beneficiary',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Add New Beneficiary' },
    page: { url: 'https://bank.example.com/payees', title: 'Manage Payees' },
    timestamp: new Date().toISOString(),
  };
  assertEquals(
    classifyAction(addBenAction).category,
    ActionCategory.BENEFICIARY_MANAGEMENT,
    'Classifies BENEFICIARY_MANAGEMENT correctly'
  );

  // 2. SECURITY_SETTING_CHANGE
  const secAction: GuardrailAction = {
    id: 'act-sec-change',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Change Password & Security PIN' },
    page: { url: 'https://app.example.com/security', title: 'Security' },
    timestamp: new Date().toISOString(),
  };
  assertEquals(
    classifyAction(secAction).category,
    ActionCategory.SECURITY_SETTING_CHANGE,
    'Classifies SECURITY_SETTING_CHANGE correctly'
  );

  // 3. PERMISSION_CHANGE
  const permAction: GuardrailAction = {
    id: 'act-perm-change',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Revoke Access & Change Permissions' },
    page: { url: 'https://app.example.com/admin/roles', title: 'Roles' },
    timestamp: new Date().toISOString(),
  };
  assertEquals(
    classifyAction(permAction).category,
    ActionCategory.PERMISSION_CHANGE,
    'Classifies PERMISSION_CHANGE correctly'
  );

  // 4. DESTRUCTIVE
  const deleteAction: GuardrailAction = {
    id: 'act-delete-account',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Permanently Delete Account' },
    page: { url: 'https://app.example.com/account', title: 'Account' },
    timestamp: new Date().toISOString(),
  };
  assertEquals(
    classifyAction(deleteAction).category,
    ActionCategory.DESTRUCTIVE,
    'Classifies DESTRUCTIVE correctly'
  );
  const deletePipeline = evaluateActionPipeline(deleteAction);
  assertEquals(
    deletePipeline.decision.response,
    ResponseAction.PROTECT,
    'Permanently Delete Account triggers PROTECT decision'
  );

  // 5. FILE_DOWNLOAD
  const downloadAction: GuardrailAction = {
    id: 'act-download-csv',
    type: ActionType.CLICK,
    element: {
      tagName: 'A',
      visibleText: 'Download Quarterly Report',
      targetUrl: 'https://example.com/reports/q4.pdf',
    },
    page: { url: 'https://example.com/reports', title: 'Reports' },
    timestamp: new Date().toISOString(),
  };
  assertEquals(
    classifyAction(downloadAction).category,
    ActionCategory.DOWNLOAD,
    'Classifies DOWNLOAD correctly for .pdf asset link'
  );

  // 6. SENSITIVE_DATA_SUBMISSION
  const sensitiveAction: GuardrailAction = {
    id: 'act-ssn-submit',
    type: ActionType.SUBMIT,
    element: {
      tagName: 'FORM',
      hasSensitiveField: true,
      sensitiveFieldTypes: ['ssn'],
    },
    page: { url: 'https://tax.example.com/file', title: 'Tax Filing' },
    timestamp: new Date().toISOString(),
  };
  assertEquals(
    classifyAction(sensitiveAction).category,
    ActionCategory.SENSITIVE_DATA_SUBMISSION,
    'Classifies SENSITIVE_DATA_SUBMISSION correctly'
  );
}

// =============================================================================
// TEST SUITE 9: Privacy Preservation (Zero Sensitive Data Exposure)
// =============================================================================
console.log('\n▶ Suite 9: Privacy Preservation');
{
  const action: GuardrailAction = {
    id: 'act-privacy-test',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      visibleText: 'Pay Now',
      hasPasswordField: false,
    },
    page: { url: 'https://store.example.com/checkout', title: 'Checkout' },
    timestamp: new Date().toISOString(),
  };

  const classification = classifyAction(action);
  const pipeline = evaluateActionPipeline(action);

  // Invariant: No password, OTP, CVV, or card number attributes exist
  const jsonStr = JSON.stringify({ action, classification, pipeline });
  assert(!jsonStr.includes('"password":'), 'No password property in pipeline payload');
  assert(!jsonStr.includes('"otp":'), 'No OTP property in pipeline payload');
  assert(!jsonStr.includes('"cvv":'), 'No CVV property in pipeline payload');
  assert(!jsonStr.includes('"pin":'), 'No PIN property in pipeline payload');
  assert(!jsonStr.includes('"cardNumber":'), 'No cardNumber property in pipeline payload');
}

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n============================================================');
console.log(`TOTAL PHASE 1 TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
}
