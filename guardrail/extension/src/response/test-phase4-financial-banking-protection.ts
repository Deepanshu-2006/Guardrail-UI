/**
 * ============================================================================
 * PHASE 4: GUARDRAIL FINANCIAL, BANKING & SENSITIVE ACTION PROTECTION SUITE
 * ============================================================================
 *
 * Verifies that Guardrail provides robust, contextual protection for high-impact
 * financial operations while guaranteeing uninterrupted routine and read-only
 * banking workflows.
 *
 * Scenarios Tested:
 * 1. Bank homepage navigation (ALLOW)
 * 2. Legitimate bank login (ALLOW)
 * 3. Account dashboard & navigation (ALLOW)
 * 4. Account balance & balance card (ALLOW)
 * 5. Transaction history (ALLOW)
 * 6. Payment history filter (ALLOW - never classified as transactional authorization)
 * 7. Transfer initiation (WARN - elevated evaluation)
 * 8. Transfer confirmation (PROTECT - strong protection / Staging Mode)
 * 9. UPI payment flow initiation & confirmation where observable
 * 10. Beneficiary addition (PROTECT - strong protection)
 * 11. Beneficiary modification (PROTECT) vs viewing (ALLOW)
 * 12. Sensitive credential submission on suspicious domain (PROTECT)
 * 13. Suspicious payment redirection to unverified external provider (PROTECT)
 * 14. Financial security setting changes (disabling alerts/2FA -> PROTECT; limits -> WARN)
 * 15. Legitimate statement download (ALLOW) vs executable download (PROTECT)
 * 16. Technical limitations & privacy preservation invariants
 */

import {
  ActionCategory,
  ActionType,
  GuardrailAction,
} from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { RiskLevel } from '../types/risk.js';
import { classifyAction } from '../classifier/classifier.js';
import {
  FINANCIAL_READ_ONLY_PHRASES,
  BENEFICIARY_MANAGEMENT_PHRASES,
  FINANCIAL_TRANSACTION_PHRASES,
  FINANCIAL_SECURITY_CHANGE_PHRASES,
  isUpiInteraction,
  isTransactionConfirmation,
  isBeneficiaryAdditionOrChange,
  isDisablingFinancialSecurity,
} from '../classifier/rules.js';
import { assessRisk } from '../risk/engine.js';
import { evaluateActionPipeline } from './engine.js';
import {
  CONTROLLED_PAYMENT_POLICY,
  SUSPICIOUS_DOWNLOAD_POLICY,
  PHISHING_PROTECTION_POLICY,
} from './policies.js';
import { explainRiskDecision } from './explanation.js';

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
console.log('🧪 PHASE 4: GUARDRAIL FINANCIAL, BANKING & SENSITIVE ACTION SUITE');
console.log('======================================================================\n');

const LEGIT_BANK_PAGE = {
  url: 'https://bank.example.com/netbanking',
  title: 'Secure Online Banking - Trusted National Bank',
  isSecureContext: true,
};

// =============================================================================
// SUITE 1: Explicit Financial Action Categories Classification
// =============================================================================
console.log('▶ Suite 1: Explicit Financial Action Categories Classification');
{
  // 1. FINANCIAL_READ_ONLY
  const balanceAction: GuardrailAction = {
    id: 'act-cat-balance',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Account Balance' },
    page: LEGIT_BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const catBalance = classifyAction(balanceAction);
  assertEquals(catBalance.category, ActionCategory.FINANCIAL_READ_ONLY, 'Classifies "Account Balance" as FINANCIAL_READ_ONLY');

  // 2. FINANCIAL_TRANSACTION
  const transferAction: GuardrailAction = {
    id: 'act-cat-transfer',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Transfer Money' },
    page: LEGIT_BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const catTransfer = classifyAction(transferAction);
  assertEquals(catTransfer.category, ActionCategory.FINANCIAL_TRANSACTION, 'Classifies "Transfer Money" as FINANCIAL_TRANSACTION');

  // 3. BENEFICIARY_MANAGEMENT
  const addBenAction: GuardrailAction = {
    id: 'act-cat-add-ben',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Add Beneficiary' },
    page: LEGIT_BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const catAddBen = classifyAction(addBenAction);
  assertEquals(catAddBen.category, ActionCategory.BENEFICIARY_MANAGEMENT, 'Classifies "Add Beneficiary" as BENEFICIARY_MANAGEMENT');

  // 4. FINANCIAL_SECURITY_CHANGE
  const secChangeAction: GuardrailAction = {
    id: 'act-cat-sec-change',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Change Transaction Limit' },
    page: LEGIT_BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const catSecChange = classifyAction(secChangeAction);
  assertEquals(catSecChange.category, ActionCategory.FINANCIAL_SECURITY_CHANGE, 'Classifies "Change Transaction Limit" as FINANCIAL_SECURITY_CHANGE');
}

// =============================================================================
// SUITE 2: Real Transaction Intent vs Benign Financial Elements (Zero False Positives)
// =============================================================================
console.log('\n▶ Suite 2: Real Transaction Intent vs Benign Financial Elements (Zero False Positives)');
{
  // A transfer-history entry is NOT a transfer authorization
  const historyRowAction: GuardrailAction = {
    id: 'act-tx-history-row',
    type: ActionType.CLICK,
    element: {
      tagName: 'TR',
      visibleText: 'Transfer to Alice: ₹2,500 on 14 Nov',
      className: 'transfer-row history-item',
    },
    page: { url: 'https://bank.example.com/account/transfers', title: 'Transfer History' },
    timestamp: new Date().toISOString(),
  };
  const resHistoryRow = evaluateActionPipeline(historyRowAction);
  assertEquals(resHistoryRow.classification.category, ActionCategory.FINANCIAL_READ_ONLY, 'Transfer history row is FINANCIAL_READ_ONLY');
  assertEquals(resHistoryRow.decision.response, ResponseAction.ALLOW, 'Transfer history row yields ALLOW (not transfer authorization)');
  assert(resHistoryRow.risk.score <= 24, 'Transfer history row risk score is LOW (0)');

  // A balance card is NOT a payment action
  const balanceCardAction: GuardrailAction = {
    id: 'act-balance-card',
    type: ActionType.CLICK,
    element: {
      tagName: 'DIV',
      visibleText: 'Balance Card - Available Balance: $14,250.00',
      className: 'account-balance-card balance-summary-widget',
    },
    page: LEGIT_BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const resBalanceCard = evaluateActionPipeline(balanceCardAction);
  assertEquals(resBalanceCard.classification.category, ActionCategory.FINANCIAL_READ_ONLY, 'Balance card is FINANCIAL_READ_ONLY');
  assertEquals(resBalanceCard.decision.response, ResponseAction.ALLOW, 'Balance card yields ALLOW (not payment action)');
  assertEquals(resBalanceCard.risk.score, 0, 'Balance card has strictly 0 risk score');

  // A payment history filter is NOT a payment authorization
  const filterAction: GuardrailAction = {
    id: 'act-payment-history-filter',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      visibleText: 'Filter Payment History',
      className: 'btn-filter payment-history-filter-btn',
    },
    page: { url: 'https://bank.example.com/payments/history', title: 'Payment History' },
    timestamp: new Date().toISOString(),
  };
  const resFilter = evaluateActionPipeline(filterAction);
  assertEquals(resFilter.classification.category, ActionCategory.FINANCIAL_READ_ONLY, 'Payment history filter is FINANCIAL_READ_ONLY');
  assertEquals(resFilter.decision.response, ResponseAction.ALLOW, 'Payment history filter yields ALLOW (not authorization)');
  assertEquals(resFilter.risk.score, 0, 'Payment history filter has 0 risk score');

  // View beneficiaries vs adding
  const viewBenAction: GuardrailAction = {
    id: 'act-view-ben',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'View Beneficiaries' },
    page: LEGIT_BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const resViewBen = evaluateActionPipeline(viewBenAction);
  assertEquals(resViewBen.classification.category, ActionCategory.FINANCIAL_READ_ONLY, 'View Beneficiaries is FINANCIAL_READ_ONLY');
  assertEquals(resViewBen.decision.response, ResponseAction.ALLOW, 'View Beneficiaries yields ALLOW');
}

// =============================================================================
// SUITE 3: UPI and Payment Protection
// =============================================================================
console.log('\n▶ Suite 3: UPI and Payment Protection');
{
  // 1. UPI Payment Intent / Initiation
  const upiInitiateAction: GuardrailAction = {
    id: 'act-upi-init',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      visibleText: 'Pay via UPI',
      ariaLabel: 'Pay using UPI or VPA',
      isUpi: true,
      vpaHandle: 'merchant@okhdfcbank',
    },
    page: { url: 'https://store.example.com/checkout', title: 'Store Checkout' },
    timestamp: new Date().toISOString(),
  };
  assert(isUpiInteraction(upiInitiateAction), 'Detected UPI interaction on initiate action');
  const resUpiInit = evaluateActionPipeline(upiInitiateAction);
  assertEquals(resUpiInit.decision.response, ResponseAction.WARN, 'UPI payment initiation evaluates to WARN');
  assertEquals(resUpiInit.risk.riskLevel, RiskLevel.HIGH, 'UPI payment initiation is HIGH risk level');

  // 2. UPI Payment Confirmation / Authorization
  const upiConfirmAction: GuardrailAction = {
    id: 'act-upi-confirm',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      visibleText: 'Confirm UPI Payment',
      isUpi: true,
      isTransactionConfirmation: true,
    },
    page: { url: 'https://store.example.com/upi/verify', title: 'Authorize UPI Payment' },
    timestamp: new Date().toISOString(),
  };
  assert(isTransactionConfirmation(upiConfirmAction), 'Recognized transaction confirmation control');
  const resUpiConfirm = evaluateActionPipeline(upiConfirmAction);
  assertEquals(resUpiConfirm.decision.response, ResponseAction.PROTECT, 'UPI payment confirmation evaluates to PROTECT');
  assertEquals(resUpiConfirm.decision.policyRuleId, 'RULE_PAYMENT_CONFIRMATION_PROTECT', 'Emits RULE_PAYMENT_CONFIRMATION_PROTECT');
  assertEquals(resUpiConfirm.decision.reasonCode, 'POLICY_PROTECT_TRANSACTION_CONFIRMATION', 'Emits POLICY_PROTECT_TRANSACTION_CONFIRMATION');

  // 3. Privacy Preservation: Zero inspection of UPI PIN, OTP, or CVV
  const upiActionSerialized = JSON.stringify(resUpiConfirm);
  assert(!upiActionSerialized.toLowerCase().includes('pin'), 'Never serializes or contains typed PIN');
  assert(!upiActionSerialized.toLowerCase().includes('otp'), 'Never serializes or contains typed OTP');
  assert(!upiActionSerialized.toLowerCase().includes('cvv'), 'Never serializes or contains CVV');
}

// =============================================================================
// SUITE 4: Transfer Initiation vs Transfer Confirmation
// =============================================================================
console.log('\n▶ Suite 4: Transfer Initiation vs Transfer Confirmation');
{
  // 1. Transfer Initiation
  const initTransferAction: GuardrailAction = {
    id: 'act-transfer-init',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Transfer Money' },
    page: { url: 'https://bank.example.com/transfers', title: 'Fund Transfers' },
    timestamp: new Date().toISOString(),
  };
  const resInit = evaluateActionPipeline(initTransferAction);
  assertEquals(resInit.classification.category, ActionCategory.FINANCIAL_TRANSACTION, 'Initiation is FINANCIAL_TRANSACTION');
  assertEquals(resInit.decision.response, ResponseAction.WARN, 'Initiate money transfer -> WARN');
  assertEquals(resInit.risk.score, 50, 'Initiate transfer risk score is 50');

  // 2. Transfer Confirmation
  const confirmTransferAction: GuardrailAction = {
    id: 'act-transfer-confirm',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      visibleText: 'Confirm Transfer',
      isTransactionConfirmation: true,
    },
    page: { url: 'https://bank.example.com/transfers/review', title: 'Review and Confirm Transfer' },
    timestamp: new Date().toISOString(),
  };
  const resConfirm = evaluateActionPipeline(confirmTransferAction);
  assertEquals(resConfirm.decision.response, ResponseAction.PROTECT, 'Confirm money transfer -> PROTECT');
  assertEquals(resConfirm.risk.riskLevel, RiskLevel.CRITICAL, 'Confirm transfer is CRITICAL risk');
  assertEquals(resConfirm.risk.score, 80, 'Confirm transfer score is 80');
}

// =============================================================================
// SUITE 5: Beneficiary Protection (Additions & Modifications)
// =============================================================================
console.log('\n▶ Suite 5: Beneficiary Protection (Additions & Modifications)');
{
  // 1. Adding a new beneficiary
  const addBeneficiaryAction: GuardrailAction = {
    id: 'act-add-ben-01',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Add Beneficiary' },
    page: { url: 'https://bank.example.com/beneficiaries/new', title: 'Register New Payee' },
    timestamp: new Date().toISOString(),
  };
  assert(isBeneficiaryAdditionOrChange(addBeneficiaryAction), 'Identifies beneficiary addition');
  const resAdd = evaluateActionPipeline(addBeneficiaryAction);
  assertEquals(resAdd.classification.category, ActionCategory.BENEFICIARY_MANAGEMENT, 'Classified as BENEFICIARY_MANAGEMENT');
  assertEquals(resAdd.decision.response, ResponseAction.PROTECT, 'Add beneficiary -> PROTECT');
  assertEquals(resAdd.decision.reasonCode, 'POLICY_PROTECT_BENEFICIARY_MANAGEMENT', 'Emits POLICY_PROTECT_BENEFICIARY_MANAGEMENT');

  // 2. Modifying beneficiary / changing recipient
  const modifyBeneficiaryAction: GuardrailAction = {
    id: 'act-mod-ben-01',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Modify Beneficiary Details' },
    page: { url: 'https://bank.example.com/beneficiaries/edit', title: 'Edit Payee' },
    timestamp: new Date().toISOString(),
  };
  assert(isBeneficiaryAdditionOrChange(modifyBeneficiaryAction), 'Identifies beneficiary modification');
  const resMod = evaluateActionPipeline(modifyBeneficiaryAction);
  assertEquals(resMod.decision.response, ResponseAction.PROTECT, 'Change recipient details -> PROTECT');
}

// =============================================================================
// SUITE 6: Financial Security Setting Changes
// =============================================================================
console.log('\n▶ Suite 6: Financial Security Setting Changes');
{
  // 1. Disabling transaction alerts (High consequence -> PROTECT)
  const disableAlertsAction: GuardrailAction = {
    id: 'act-sec-disable-alerts',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Disable Transaction Alerts' },
    page: { url: 'https://bank.example.com/settings/alerts', title: 'Alert Preferences' },
    timestamp: new Date().toISOString(),
  };
  assert(isDisablingFinancialSecurity(disableAlertsAction), 'Identifies disabling financial security');
  const resDisableAlerts = evaluateActionPipeline(disableAlertsAction);
  assertEquals(resDisableAlerts.classification.category, ActionCategory.FINANCIAL_SECURITY_CHANGE, 'Classified as FINANCIAL_SECURITY_CHANGE');
  assertEquals(resDisableAlerts.decision.response, ResponseAction.PROTECT, 'Disable important financial security -> PROTECT');
  assertEquals(resDisableAlerts.decision.reasonCode, 'POLICY_PROTECT_FINANCIAL_SECURITY', 'Emits POLICY_PROTECT_FINANCIAL_SECURITY');

  // 2. Changing transaction limit (Adjusting limits -> WARN)
  const changeLimitAction: GuardrailAction = {
    id: 'act-sec-change-limit',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Change Transaction Limit' },
    page: { url: 'https://bank.example.com/settings/limits', title: 'Manage Limits' },
    timestamp: new Date().toISOString(),
  };
  const resChangeLimit = evaluateActionPipeline(changeLimitAction);
  assertEquals(resChangeLimit.classification.category, ActionCategory.FINANCIAL_SECURITY_CHANGE, 'Classified as FINANCIAL_SECURITY_CHANGE');
  assertEquals(resChangeLimit.decision.response, ResponseAction.WARN, 'Changing limit -> WARN');
  assertEquals(resChangeLimit.decision.reasonCode, 'POLICY_WARN_FINANCIAL_SECURITY', 'Emits POLICY_WARN_FINANCIAL_SECURITY');
}

// =============================================================================
// SUITE 7: Sensitive Credential Submission & Suspicious Payment Redirection
// =============================================================================
console.log('\n▶ Suite 7: Sensitive Credential Submission & Suspicious Payment Redirection');
{
  // 1. Submitting credentials to a suspicious lookalike domain
  const submitCredentialsOnPhishing: GuardrailAction = {
    id: 'act-cred-phish',
    type: ActionType.SUBMIT,
    element: {
      tagName: 'FORM',
      hasPasswordField: true,
      hasSensitiveField: true,
      sensitiveFieldTypes: ['password', 'username'],
      formAction: 'https://hfdc-bank.login-verify.com/submit',
      submitButtonText: 'Log In to NetBanking',
    },
    page: {
      url: 'https://hfdc-bank.login-verify.com/login',
      title: 'HDFC NetBanking Verification Portal',
    },
    category: ActionCategory.SENSITIVE_DATA_SUBMISSION,
    timestamp: new Date().toISOString(),
  };
  const resCredPhish = evaluateActionPipeline(submitCredentialsOnPhishing);
  assertEquals(resCredPhish.decision.response, ResponseAction.PROTECT, 'Submit credentials to suspicious website -> PROTECT');
  assert(resCredPhish.risk.score >= 75, 'Risk score is CRITICAL (>= 75)');
  assert(!JSON.stringify(resCredPhish).includes('passwordValue'), 'Privacy invariant: Field values never captured');

  // 2. Suspicious payment redirection to unverified external gateway
  const redirectPaymentAction: GuardrailAction = {
    id: 'act-pay-redirect',
    type: ActionType.CLICK,
    element: {
      tagName: 'A',
      visibleText: 'Pay via QuickGateway',
      targetUrl: 'https://unknown-pay-hub.xyz/checkout?id=992',
    },
    page: { url: 'https://legit-store.com/checkout', title: 'Store Checkout' },
    category: ActionCategory.PAYMENT,
    timestamp: new Date().toISOString(),
  };
  const resRedirect = evaluateActionPipeline(redirectPaymentAction);
  assertEquals(resRedirect.decision.response, ResponseAction.PROTECT, 'Suspicious payment redirection -> PROTECT');
  assertEquals(resRedirect.decision.reasonCode, 'POLICY_PROTECT_UNTRUSTED_PAYMENT_REDIRECT', 'Emits POLICY_PROTECT_UNTRUSTED_PAYMENT_REDIRECT');
}

// =============================================================================
// SUITE 8: Legitimate Banking Read-Only & File Safety
// =============================================================================
console.log('\n▶ Suite 8: Legitimate Banking Read-Only & File Safety');
{
  // 1. Open bank website
  const openBankAction: GuardrailAction = {
    id: 'act-open-bank',
    type: ActionType.NAVIGATION,
    page: { url: 'https://bank.example.com/', title: 'Welcome to Trusted Bank' },
    timestamp: new Date().toISOString(),
  };
  const resOpen = evaluateActionPipeline(openBankAction);
  assertEquals(resOpen.decision.response, ResponseAction.ALLOW, 'Open bank website -> ALLOW');

  // 2. View bank balance
  const viewBalanceAction: GuardrailAction = {
    id: 'act-view-bal',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'View Balance' },
    page: LEGIT_BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const resBal = evaluateActionPipeline(viewBalanceAction);
  assertEquals(resBal.decision.response, ResponseAction.ALLOW, 'View bank balance -> ALLOW');

  // 3. View transaction history
  const viewTxHistoryAction: GuardrailAction = {
    id: 'act-view-tx',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Transaction History' },
    page: LEGIT_BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const resTx = evaluateActionPipeline(viewTxHistoryAction);
  assertEquals(resTx.decision.response, ResponseAction.ALLOW, 'View transaction history -> ALLOW');

  // 4. Navigate banking dashboard
  const navDashboardAction: GuardrailAction = {
    id: 'act-nav-dash',
    type: ActionType.CLICK,
    element: { tagName: 'A', visibleText: 'Account Dashboard' },
    page: LEGIT_BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const resDash = evaluateActionPipeline(navDashboardAction);
  assertEquals(resDash.decision.response, ResponseAction.ALLOW, 'Navigate banking dashboard -> ALLOW');

  // 5. Download legitimate statement (PDF file)
  const downloadPdfAction: GuardrailAction = {
    id: 'act-dl-statement-pdf',
    type: ActionType.CLICK,
    element: {
      tagName: 'A',
      visibleText: 'Download Statement',
      downloadAttribute: 'statement_october_2026.pdf',
    },
    download: {
      filename: 'statement_october_2026.pdf',
      mimeType: 'application/pdf',
    },
    page: { url: 'https://bank.example.com/statements', title: 'Statements' },
    timestamp: new Date().toISOString(),
  };
  const resPdf = evaluateActionPipeline(downloadPdfAction);
  assertEquals(resPdf.decision.response, ResponseAction.ALLOW, 'Download legitimate statement (PDF) -> ALLOW');

  // 6. Download malicious executable disguised as statement
  const downloadExeAction: GuardrailAction = {
    id: 'act-dl-statement-exe',
    type: ActionType.CLICK,
    element: {
      tagName: 'A',
      visibleText: 'Download Statement',
      downloadAttribute: 'statement.pdf.exe',
    },
    download: {
      filename: 'statement.pdf.exe',
      mimeType: 'application/x-msdownload',
    },
    page: { url: 'https://unverified-banking-files.net/export', title: 'Download' },
    timestamp: new Date().toISOString(),
  };
  const resExe = evaluateActionPipeline(downloadExeAction);
  assertEquals(resExe.decision.response, ResponseAction.PROTECT, 'Executable disguised as statement -> PROTECT');
}

// =============================================================================
// SUITE 9: Structured Explanations with 4 Required Sections
// =============================================================================
console.log('\n▶ Suite 9: Structured Explanations with 4 Required Sections');
{
  const testConfirmationAction: GuardrailAction = {
    id: 'act-exp-confirm',
    type: ActionType.CLICK,
    element: { tagName: 'BUTTON', visibleText: 'Authorize Transfer ₹50,000', isTransactionConfirmation: true },
    page: LEGIT_BANK_PAGE,
    timestamp: new Date().toISOString(),
  };
  const pipeline = evaluateActionPipeline(testConfirmationAction);
  const explanation = explainRiskDecision(pipeline.decision, pipeline.risk, testConfirmationAction);

  assert(explanation.actionDescription.length > 5, 'actionDescription is populated for financial confirmation');
  assert(explanation.whyRisky.length > 5, 'whyRisky explains financial consequence');
  assert(explanation.consequences.length > 5, 'consequences explains debiting of funds');
  assert(explanation.saferChoice.length > 5, 'saferChoice provides actionable verification guidance');
}

// =============================================================================
// FINAL SUMMARY
// =============================================================================
console.log('\n======================================================================');
console.log(`TOTAL PHASE 4 TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================\n');

if (failed > 0) {
  console.error(`💥 PHASE 4 TESTS FAILED: ${failed} failure(s) detected.`);
  process.exit(1);
} else {
  console.log('🎉 ALL PHASE 4 FINANCIAL, BANKING & SENSITIVE ACTION TESTS PASSED CLEANLY!\n');
}
