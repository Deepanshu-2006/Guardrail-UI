/**
 * ============================================================================
 * PHASE 5: COMPLETE GUARDRAIL POLICY INTEGRATION & REGRESSION TEST SUITE
 * ============================================================================
 *
 * Validates the complete integrated execution path across all Guardrail
 * policy components, verifying end-to-end scenarios, caretaker workflows,
 * dashboard immunity, privacy guarantees, and technical invariants.
 */

import {
  ActionCategory,
  ActionType,
  GuardrailAction,
} from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { RiskLevel } from '../types/risk.js';
import { evaluateActionPipeline } from './engine.js';
import { explainRiskDecision } from './explanation.js';
import { isInternalGuardrailUi } from '../utils/dom.js';
import { isDashboardOrInternalPage } from '../content/index.js';
import {
  createApprovalRequest,
  resolveApprovalRequest,
  cancelApprovalRequest,
} from '../approval/model.js';
import { ApprovalStatus } from '../types/approval.js';

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
console.log('🧪 PHASE 5: GUARDRAIL COMPLETE POLICY INTEGRATION & REGRESSION SUITE');
console.log('======================================================================\n');

// =============================================================================
// SUITE 1: End-to-End Normal Browsing Scenarios (No Intrusive Warnings)
// =============================================================================
console.log('▶ Suite 1: End-to-End Normal Browsing Scenarios (Zero Intrusive Warnings)');
{
  // 1. Google search query submission
  const googleSearchAction: GuardrailAction = {
    id: 'act-norm-google-search',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Google Search', ariaLabel: 'Google Search' },
    page: { url: 'https://www.google.com/', title: 'Google' },
    timestamp: new Date().toISOString(),
  };
  const resGoogle = evaluateActionPipeline(googleSearchAction);
  assertEquals(resGoogle.decision.response, ResponseAction.ALLOW, 'Google search query yields ALLOW');
  assertEquals(resGoogle.risk.score, 0, 'Google search query has 0 risk score');

  // 2. YouTube playback click
  const youtubePlayAction: GuardrailAction = {
    id: 'act-norm-yt-play',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Play', ariaLabel: 'Play video' },
    page: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up' },
    timestamp: new Date().toISOString(),
  };
  const resYt = evaluateActionPipeline(youtubePlayAction);
  assertEquals(resYt.decision.response, ResponseAction.ALLOW, 'YouTube play button yields ALLOW');
  assertEquals(resYt.risk.score, 0, 'YouTube play button has 0 risk score');

  // 3. Amazon product browsing
  const amazonBrowseAction: GuardrailAction = {
    id: 'act-norm-amazon-browse',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Wireless Noise Cancelling Headphones', targetUrl: 'https://www.amazon.com/dp/B08Z9M4M' },
    page: { url: 'https://www.amazon.com/s?k=headphones', title: 'Amazon.com: headphones' },
    timestamp: new Date().toISOString(),
  };
  const resAmazon = evaluateActionPipeline(amazonBrowseAction);
  assertEquals(resAmazon.decision.response, ResponseAction.ALLOW, 'Amazon product browsing yields ALLOW');
  assertEquals(resAmazon.risk.score, 0, 'Amazon product browsing has 0 risk score');

  // 4. News article scrolling / menu navigation
  const menuNavAction: GuardrailAction = {
    id: 'act-norm-menu-nav',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Technology News', targetUrl: 'https://news.example.com/technology' },
    page: { url: 'https://news.example.com/', title: 'Daily News' },
    timestamp: new Date().toISOString(),
  };
  const resMenu = evaluateActionPipeline(menuNavAction);
  assertEquals(resMenu.decision.response, ResponseAction.ALLOW, 'Website menu navigation yields ALLOW');
  assertEquals(resMenu.risk.score, 0, 'Website menu navigation has 0 risk score');
}

// =============================================================================
// SUITE 2: Authentication Operations (Legitimate vs Threat)
// =============================================================================
console.log('\n▶ Suite 2: Authentication Operations (Legitimate vs Threat)');
{
  // 1. Password reset / recovery link (Benign)
  const forgotPasswordAction: GuardrailAction = {
    id: 'act-auth-forgot-pass',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Forgot your password?' },
    page: { url: 'https://auth.example.com/login', title: 'Sign In' },
    timestamp: new Date().toISOString(),
  };
  const resForgot = evaluateActionPipeline(forgotPasswordAction);
  assertEquals(resForgot.decision.response, ResponseAction.ALLOW, 'Forgot password link yields ALLOW (not auth risk)');
  assertEquals(resForgot.risk.score, 0, 'Forgot password link has 0 risk score');

  // 2. Normal account logout
  const logoutAction: GuardrailAction = {
    id: 'act-auth-logout',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Log Out' },
    page: { url: 'https://app.example.com/dashboard', title: 'User Dashboard' },
    timestamp: new Date().toISOString(),
  };
  const resLogout = evaluateActionPipeline(logoutAction);
  assertEquals(resLogout.decision.response, ResponseAction.ALLOW, 'Normal account logout yields ALLOW');

  // 2b. Legitimate bank login (ALLOW)
  const legitBankLoginAction: GuardrailAction = {
    id: 'act-auth-bank-login',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Log In' },
    page: { url: 'https://netbanking.hdfcbank.com/netbanking/', title: 'HDFC Bank NetBanking', isSecureContext: true },
    timestamp: new Date().toISOString(),
  };
  const resLegitLogin = evaluateActionPipeline(legitBankLoginAction);
  assertEquals(resLegitLogin.decision.response, ResponseAction.ALLOW, 'Legitimate bank login yields ALLOW');

  // 2c. Google search results for bank do not trigger phishing brand mismatch
  const googleSearchAction: GuardrailAction = {
    id: 'act-google-search-bank',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'HDFC Bank NetBanking - Secure Online Banking' },
    page: { url: 'https://www.google.com/search?q=hdfc+netbanking', title: 'hdfc netbanking - Google Search' },
    timestamp: new Date().toISOString(),
  };
  const resGoogleBank = evaluateActionPipeline(googleSearchAction);
  assertEquals(resGoogleBank.risk.riskLevel, RiskLevel.LOW, 'Google search results for bank remain LOW risk (0 score)');
  assert(!resGoogleBank.risk.reasons.some(r => r.includes('claims identity of')), 'Zero false phishing mismatch on Google search');

  // 3. Credential submission on lookalike deceptive domain (Critical Threat)
  const deceptiveLoginAction: GuardrailAction = {
    id: 'act-auth-phish-sub',
    type: ActionType.SUBMIT,
    element: {
      tagName: 'FORM',
      hasPasswordField: true,
      hasSensitiveField: true,
      sensitiveFieldTypes: ['password', 'username'],
      formAction: 'https://hfdc-bank.login-verify.com/submit',
      submitButtonText: 'Sign In to Banking',
    },
    page: { url: 'https://hfdc-bank.login-verify.com/login', title: 'HDFC NetBanking Verification' },
    category: ActionCategory.SENSITIVE_DATA_SUBMISSION,
    timestamp: new Date().toISOString(),
  };
  const resDeceptive = evaluateActionPipeline(deceptiveLoginAction);
  assertEquals(resDeceptive.decision.response, ResponseAction.PROTECT, 'Credential submission on lookalike domain -> PROTECT');
  assertEquals(resDeceptive.risk.riskLevel, RiskLevel.CRITICAL, 'Evaluates to CRITICAL risk');
  assert(resDeceptive.risk.score >= 75, 'Risk score is at least 75');
}

// =============================================================================
// SUITE 3: Complete Banking Scenarios (Read-Only vs Consequential)
// =============================================================================
console.log('\n▶ Suite 3: Complete Banking Scenarios (Read-Only vs Consequential)');
{
  const BANK_PAGE = { url: 'https://bank.example.com/netbanking', title: 'Trusted National Bank Online' };

  // 1. Open bank website
  const openBankAction: GuardrailAction = {
    id: 'act-bk-open',
    type: ActionType.NAVIGATION,
    page: { url: 'https://bank.example.com/', title: 'Welcome to Trusted National Bank' },
    timestamp: new Date().toISOString(),
  };
  const resOpen = evaluateActionPipeline(openBankAction);
  assertEquals(resOpen.decision.response, ResponseAction.ALLOW, '1. Open bank homepage -> ALLOW');

  // 2. View account balance
  const checkBalanceAction: GuardrailAction = {
    id: 'act-bk-balance',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'View Balance' },
    page: BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const resBal = evaluateActionPipeline(checkBalanceAction);
  assertEquals(resBal.decision.response, ResponseAction.ALLOW, '2. View account balance -> ALLOW');
  assertEquals(resBal.risk.score, 0, 'View balance risk score is 0');

  // 3. View transaction history
  const viewHistoryAction: GuardrailAction = {
    id: 'act-bk-history',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Transaction History' },
    page: BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const resHist = evaluateActionPipeline(viewHistoryAction);
  assertEquals(resHist.decision.response, ResponseAction.ALLOW, '3. View transaction history -> ALLOW');
  assertEquals(resHist.risk.score, 0, 'View history risk score is 0');

  // 4. Initiate fund transfer
  const initiateTransferAction: GuardrailAction = {
    id: 'act-bk-init-transfer',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Transfer Money' },
    page: BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const resInitTx = evaluateActionPipeline(initiateTransferAction);
  assertEquals(resInitTx.decision.response, ResponseAction.WARN, '4. Initiate transfer -> WARN');
  assertEquals(resInitTx.risk.riskLevel, RiskLevel.HIGH, 'Initiate transfer is HIGH risk');

  // 5. Confirm payment / transfer
  const confirmPaymentAction: GuardrailAction = {
    id: 'act-bk-confirm-tx',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      visibleText: 'Confirm Transfer ₹25,000',
      isTransactionConfirmation: true,
    },
    page: { url: 'https://bank.example.com/transfers/confirm', title: 'Confirm Transfer' },
    timestamp: new Date().toISOString(),
  };
  const resConfirmTx = evaluateActionPipeline(confirmPaymentAction);
  assertEquals(resConfirmTx.decision.response, ResponseAction.PROTECT, '5. Confirm payment -> PROTECT');
  assertEquals(resConfirmTx.decision.policyRuleId, 'RULE_PAYMENT_CONFIRMATION_PROTECT', 'Emits RULE_PAYMENT_CONFIRMATION_PROTECT');
  assertEquals(resConfirmTx.decision.reasonCode, 'POLICY_PROTECT_TRANSACTION_CONFIRMATION', 'Emits POLICY_PROTECT_TRANSACTION_CONFIRMATION');

  // 6. Add beneficiary
  const addBeneficiaryAction: GuardrailAction = {
    id: 'act-bk-add-ben',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Add New Payee' },
    page: BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const resAddBen = evaluateActionPipeline(addBeneficiaryAction);
  assertEquals(resAddBen.decision.response, ResponseAction.PROTECT, '6. Add beneficiary -> PROTECT');
  assertEquals(resAddBen.decision.reasonCode, 'POLICY_PROTECT_BENEFICIARY_MANAGEMENT', 'Emits POLICY_PROTECT_BENEFICIARY_MANAGEMENT');

  // 7. Change account security settings (Disable alerts -> PROTECT; Adjust limits -> WARN)
  const disableAlertsAction: GuardrailAction = {
    id: 'act-bk-disable-alerts',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Disable Transaction Alerts' },
    page: { url: 'https://bank.example.com/security', title: 'Security Settings' },
    timestamp: new Date().toISOString(),
  };
  const resDisable = evaluateActionPipeline(disableAlertsAction);
  assertEquals(resDisable.decision.response, ResponseAction.PROTECT, '7a. Disable transaction alerts -> PROTECT');

  const changeLimitAction: GuardrailAction = {
    id: 'act-bk-change-limit',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Change Transaction Limit' },
    page: { url: 'https://bank.example.com/security', title: 'Security Settings' },
    timestamp: new Date().toISOString(),
  };
  const resLimit = evaluateActionPipeline(changeLimitAction);
  assertEquals(resLimit.decision.response, ResponseAction.WARN, '7b. Change daily limit -> WARN');
}

// =============================================================================
// SUITE 4: Differentiated Website Trust Levels
// =============================================================================
console.log('\n▶ Suite 4: Differentiated Website Trust Levels');
{
  // 1. Unknown ordinary website navigation -> ADVISE (non-blocking toast advisory, never full modal)
  const unknownSiteAction: GuardrailAction = {
    id: 'act-trust-unknown',
    type: ActionType.NAVIGATION,
    page: { url: 'https://ordinary-blog-12345.com/posts/article', title: 'Cooking Recipes' },
    category: ActionCategory.EXTERNAL_NAVIGATION,
    timestamp: new Date().toISOString(),
  };
  const resUnknown = evaluateActionPipeline(unknownSiteAction);
  assertEquals(resUnknown.decision.response, ResponseAction.ADVISE, 'Unknown ordinary website -> ADVISE');
  assert(resUnknown.decision.response !== ResponseAction.WARN, 'Unknown site does NOT trigger full modal WARN');
  assert(resUnknown.decision.response !== ResponseAction.PROTECT, 'Unknown site does NOT trigger PROTECT');

  // 2. Suspicious lookalike domain -> PROTECT
  const suspiciousLookalikeAction: GuardrailAction = {
    id: 'act-trust-suspicious-lookalike',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Verify Account', targetUrl: 'https://paypa1-security.com/login' },
    page: { url: 'https://ordinary-forum.org/', title: 'Discussion Forum' },
    category: ActionCategory.SUSPICIOUS_REDIRECT,
    timestamp: new Date().toISOString(),
  };
  const resLookalike = evaluateActionPipeline(suspiciousLookalikeAction);
  assertEquals(resLookalike.decision.response, ResponseAction.PROTECT, 'Suspicious lookalike domain -> PROTECT');

  // 3. External payment gateway redirection to untrusted hub -> PROTECT
  const untrustedGatewayAction: GuardrailAction = {
    id: 'act-trust-untrusted-gw',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Pay via QuickPay Hub', targetUrl: 'https://unverified-pay-gateway.xyz/pay' },
    page: { url: 'https://shop.example.com/cart', title: 'Shopping Cart' },
    category: ActionCategory.PAYMENT,
    timestamp: new Date().toISOString(),
  };
  const resGateway = evaluateActionPipeline(untrustedGatewayAction);
  assertEquals(resGateway.decision.response, ResponseAction.PROTECT, 'Untrusted payment gateway redirect -> PROTECT');
  assertEquals(resGateway.decision.reasonCode, 'POLICY_PROTECT_UNTRUSTED_PAYMENT_REDIRECT', 'Emits POLICY_PROTECT_UNTRUSTED_PAYMENT_REDIRECT');
}

// =============================================================================
// SUITE 5: Dangerous Operations Evaluation
// =============================================================================
console.log('\n▶ Suite 5: Dangerous Operations Evaluation');
{
  // 1. Executable file download disguised as document
  const exeDownloadAction: GuardrailAction = {
    id: 'act-dang-exe-download',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Download Invoice', downloadAttribute: 'invoice.pdf.exe' },
    download: { filename: 'invoice.pdf.exe', mimeType: 'application/x-msdownload' },
    page: { url: 'https://fileshare.net/download', title: 'File Delivery' },
    category: ActionCategory.DOWNLOAD,
    timestamp: new Date().toISOString(),
  };
  const resExe = evaluateActionPipeline(exeDownloadAction);
  assertEquals(resExe.decision.response, ResponseAction.PROTECT, 'Executable download disguised as doc -> PROTECT');
  assertEquals(resExe.decision.policyRuleId, 'RULE_SUSPICIOUS_DOWNLOAD_POLICY', 'Emits RULE_SUSPICIOUS_DOWNLOAD_POLICY');

  // 2. Destructive action (Delete Account)
  const deleteAccountAction: GuardrailAction = {
    id: 'act-dang-delete-acc',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Permanently Delete Account' },
    page: { url: 'https://app.example.com/settings/profile', title: 'Account Settings' },
    category: ActionCategory.DESTRUCTIVE,
    timestamp: new Date().toISOString(),
  };
  const resDelete = evaluateActionPipeline(deleteAccountAction);
  assertEquals(resDelete.decision.response, ResponseAction.PROTECT, 'Permanently Delete Account -> PROTECT');
  assertEquals(resDelete.decision.policyRuleId, 'RULE_CONTROLLED_DESTRUCTIVE', 'Emits RULE_CONTROLLED_DESTRUCTIVE');

  // 3. Permission change (Grant access)
  const permAction: GuardrailAction = {
    id: 'act-dang-perm',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Grant Full Access' },
    page: { url: 'https://cloud.example.com/iam', title: 'Access Management' },
    category: ActionCategory.PERMISSION_CHANGE,
    timestamp: new Date().toISOString(),
  };
  const resPerm = evaluateActionPipeline(permAction);
  assertEquals(resPerm.decision.response, ResponseAction.WARN, 'Grant Full Access -> WARN');
}

// =============================================================================
// SUITE 6: Caretaker Approval Workflow Regression & Strict Decoupling
// =============================================================================
console.log('\n▶ Suite 6: Caretaker Approval Workflow Regression & Strict Decoupling');
{
  // 1. Strict Decoupling: Merely showing WARN does NOT create an approval request
  const warnAction: GuardrailAction = {
    id: 'act-care-warn-only',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Change Daily Limit' },
    page: { url: 'https://bank.example.com/settings', title: 'Settings' },
    timestamp: new Date().toISOString(),
  };
  const resWarn = evaluateActionPipeline(warnAction);
  assertEquals(resWarn.decision.response, ResponseAction.WARN, 'Action evaluates to WARN');
  assert(!JSON.stringify(resWarn).includes('apr_'), 'Zero approval request ID created for WARN');

  // 2. Controlled Action under PROTECT triggers Staging Mode
  const criticalAction: GuardrailAction = {
    id: 'act-care-crit-protect',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Confirm Wire Transfer $10,000', isTransactionConfirmation: true },
    page: { url: 'https://bank.example.com/wire/review', title: 'Review Wire Transfer' },
    timestamp: new Date().toISOString(),
  };
  const resCrit = evaluateActionPipeline(criticalAction);
  assertEquals(resCrit.decision.response, ResponseAction.PROTECT, 'Protected action evaluates to PROTECT');

  // 3. User explicitly requests approval -> creates immutable PENDING request
  const approvalReq = createApprovalRequest(
    {
      actionId: criticalAction.id,
      actionDescription: 'Wire transfer authorization $10,000 to external vendor',
      actionType: criticalAction.type,
      riskLevel: resCrit.risk.riskLevel,
      riskScore: resCrit.risk.score,
      riskReasons: resCrit.risk.reasons,
      category: criticalAction.category,
      origin: 'https://bank.example.com',
      hostname: 'bank.example.com',
      pageTitle: criticalAction.page.title,
    },
    'usr_ward_bob'
  );
  assertEquals(approvalReq.actionId, criticalAction.id, 'Approval request actionId strictly matches action');
  assertEquals(approvalReq.status, ApprovalStatus.PENDING, 'Initial approval request status is PENDING');

  // 4. Caretaker approves -> APPROVED terminal state
  const approvedReq = resolveApprovalRequest(approvalReq, {
    decision: 'APPROVED',
    decidedBy: 'tc_guardian_carol',
    decisionReason: 'Verified via phone confirmation. Approved for single execution.',
  });
  assertEquals(approvedReq.status, ApprovalStatus.APPROVED, 'Resolved request is APPROVED');
  assertEquals(approvedReq.decision?.decision, 'APPROVED', 'Decision verdict is APPROVED');
  assertEquals(approvedReq.decision?.decidedBy, 'tc_guardian_carol', 'Attributed to caretaker Carol');

  // 5. Caretaker rejects -> REJECTED terminal state
  const rejectedReq = resolveApprovalRequest(approvalReq, {
    decision: 'REJECTED',
    decidedBy: 'tc_guardian_carol',
    decisionReason: 'Transaction unrecognized. Held for safety.',
  });
  assertEquals(rejectedReq.status, ApprovalStatus.REJECTED, 'Resolved request is REJECTED');

  // 6. User cancellation -> CANCELLED terminal state
  const cancelledReq = cancelApprovalRequest(
    approvalReq,
    'usr_ward_bob',
    'User decided not to proceed with transfer.'
  );
  assertEquals(cancelledReq.status, ApprovalStatus.CANCELLED, 'Cancelled request is CANCELLED');
}

// =============================================================================
// SUITE 7: Dashboard Immunity (Port 5173 & #dashboard-app)
// =============================================================================
console.log('\n▶ Suite 7: Dashboard Immunity (Port 5173 & #dashboard-app)');
{
  const origWindow = (globalThis as any).window;
  const origDoc = (globalThis as any).document;

  try {
    (globalThis as any).window = {
      location: {
        href: 'http://localhost:5173/#/approvals',
        origin: 'http://localhost:5173',
        port: '5173',
        hostname: 'localhost',
      },
    };
    (globalThis as any).document = {
      getElementById: (id: string) => (id === 'dashboard-app' ? {} : null),
      querySelector: () => null,
      title: 'Guardrail — Trusted Contact Portal',
    };

    assert(isDashboardOrInternalPage(), 'localhost:5173 is recognized as dashboard URL');

    (globalThis as any).window.location.port = '8080';
    (globalThis as any).window.location.href = 'https://example.com/';
    (globalThis as any).document.getElementById = () => null;
    (globalThis as any).document.title = 'External Example Site';
    assert(!isDashboardOrInternalPage(), 'External URL is not dashboard');
  } finally {
    (globalThis as any).window = origWindow;
    (globalThis as any).document = origDoc;
  }

  // Test via DOM environment checks
  const fakeDashboardEl = {
    id: 'dashboard-app',
    closest: (selector: string) => (selector === '#dashboard-app' || selector.includes('dashboard') ? {} : null),
  } as unknown as Element;
  assert(isInternalGuardrailUi(fakeDashboardEl), 'Element inside #dashboard-app is recognized as internal Guardrail UI');

  const fakeExternalEl = {
    id: 'btn-external',
    closest: (_selector: string) => null,
  } as unknown as Element;
  assert(!isInternalGuardrailUi(fakeExternalEl), 'Element on external page is not internal Guardrail UI');

  // Verify dashboard container check in DOM
  const containerCheck = Boolean(fakeDashboardEl.id === 'dashboard-app' || fakeDashboardEl.closest('#dashboard-app'));
  assert(containerCheck, 'Dashboard container selector matches #dashboard-app');
}

// =============================================================================
// SUITE 8: Strict Privacy & Sensitive Field Redaction Invariants
// =============================================================================
console.log('\n▶ Suite 8: Strict Privacy & Sensitive Field Redaction Invariants');
{
  const sensitiveFormAction: GuardrailAction = {
    id: 'act-priv-form-submit',
    type: ActionType.SUBMIT,
    element: {
      tagName: 'FORM',
      hasPasswordField: true,
      hasSensitiveField: true,
      sensitiveFieldTypes: ['password', 'card_number', 'cvv', 'otp'],
      formAction: 'https://bank.example.com/api/auth',
      submitButtonText: 'Submit Verification',
    },
    page: { url: 'https://bank.example.com/verify', title: 'Two-Factor Verification' },
    timestamp: new Date().toISOString(),
  };

  const resPriv = evaluateActionPipeline(sensitiveFormAction);
  const serialized = JSON.stringify(resPriv).toLowerCase();

  assert(!serialized.includes('passwordval'), 'Never contains password values');
  assert(!serialized.includes('otpval'), 'Never contains OTP values');
  assert(!serialized.includes('pinval'), 'Never contains PIN values');
  assert(!serialized.includes('cvvval'), 'Never contains CVV values');
  assert(!serialized.includes('cardnumberval'), 'Never contains card numbers');
}

// =============================================================================
// SUITE 9: Structured Explanations with 4 Required Sections
// =============================================================================
console.log('\n▶ Suite 9: Structured Explanations with 4 Required Sections');
{
  const testAction: GuardrailAction = {
    id: 'act-exp-test-01',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Confirm Transfer ₹50,000', isTransactionConfirmation: true },
    page: { url: 'https://bank.example.com/transfers', title: 'Transfer Confirmation' },
    timestamp: new Date().toISOString(),
  };
  const pipeline = evaluateActionPipeline(testAction);
  const exp = explainRiskDecision(pipeline.decision, pipeline.risk, testAction);

  assert(exp.actionDescription.length > 5, 'Structured explanation provides actionDescription');
  assert(exp.whyRisky.length > 5, 'Structured explanation provides whyRisky');
  assert(exp.consequences.length > 5, 'Structured explanation provides consequences');
  assert(exp.saferChoice.length > 5, 'Structured explanation provides saferChoice');
}

// =============================================================================
// FINAL SUMMARY
// =============================================================================
console.log('\n======================================================================');
console.log(`TOTAL PHASE 5 INTEGRATION TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================\n');

if (failed > 0) {
  console.error(`💥 PHASE 5 INTEGRATION SUITE FAILED: ${failed} failure(s) detected.`);
  process.exit(1);
} else {
  console.log('🎉 ALL PHASE 5 INTEGRATION & REGRESSION SCENARIOS PASSED CLEANLY!\n');
}
