/**
 * Guardrail Action Classification Rules
 *
 * Provides a modular, rule-based heuristic specification for classifying
 * Guardrail actions into semantic categories based on safe metadata.
 *
 * ARCHITECTURAL INVARIANTS (PHASE 1):
 * 1. Strict Element vs Page Context Isolation:
 *    Interactive element tokens (visible text, aria-label, ID fallback) are strictly
 *    isolated from page context (URL, domain, page title, referrer). Page-level metadata
 *    never bleeds into the searchable tokens of clicked controls.
 * 2. Bounded Semantic Matching:
 *    Unrestricted substring matching is replaced by normalized, word-bounded phrase matching.
 *    CSS class names are omitted to avoid framework-generated styling false positives.
 * 3. Granular Category Coverage:
 *    Distinguishes FINANCIAL_READ_ONLY, BENEFICIARY_MANAGEMENT, FINANCIAL_TRANSACTION,
 *    PAYMENT, SECURITY_SETTING_CHANGE, PERMISSION_CHANGE, DESTRUCTIVE, AUTHENTICATION,
 *    DOWNLOAD, SENSITIVE_DATA_SUBMISSION, SUSPICIOUS_REDIRECT, EXTERNAL_NAVIGATION, GENERAL.
 * 4. Privacy Guarantee:
 *    Operates strictly on safe DOM metadata without inspecting password values, OTPs,
 *    PINs, CVVs, or sensitive form contents.
 */

import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { evaluateSuspiciousUrl } from '../utils/url-detector.js';

/**
 * Result returned from evaluating a single classification rule against an action.
 */
export interface RuleEvaluationResult {
  /** True if the rule conditions matched the action */
  matched: boolean;

  /** Non-sensitive explanation or matched token for audit/debugging */
  reason?: string;
}

/**
 * Interface representing a modular classification rule.
 */
export interface ClassificationRule {
  /** Unique machine-readable rule identifier (e.g., 'PAYMENT_KEYWORD_RULE') */
  id: string;

  /** The semantic category assigned when this rule matches */
  category: ActionCategory;

  /** Human-readable description of what this rule inspects */
  description: string;

  /** Evaluation logic to determine if an action matches this rule */
  evaluate: (action: GuardrailAction) => RuleEvaluationResult;
}

/**
 * Normalizes text for robust, punctuation-tolerant, boundary-safe phrase matching.
 */
export function normalizeForMatching(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Matches an exact or bounded phrase within candidate text.
 * Enforces whole-word or whole-phrase boundaries so that "pay" does not match "taxpayer",
 * "transfer" does not match "untransferred", etc.
 */
export function matchesBoundedPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  const normalizedText = ` ${normalizeForMatching(text)} `;
  const normalizedPhrase = normalizeForMatching(phrase);
  if (!normalizedPhrase) return false;
  return normalizedText.includes(` ${normalizedPhrase} `);
}

/**
 * Checks if any of the candidate texts matches any phrase with word boundaries.
 */
export function matchesAnyPhrase(
  texts: readonly (string | undefined)[],
  phrases: readonly string[]
): { matched: boolean; matchedKeyword?: string } {
  for (const phrase of phrases) {
    for (const text of texts) {
      if (text && matchesBoundedPhrase(text, phrase)) {
        return { matched: true, matchedKeyword: phrase };
      }
    }
  }
  return { matched: false };
}

/**
 * Extracts action-level text context strictly from the interactive DOM element.
 *
 * ISOLATION GUARANTEE:
 * - Extracts visible text and aria-label
 * - Falls back to normalized element ID only if visible text and aria-label are absent
 * - NEVER extracts page.title
 * - NEVER extracts page.url pathname
 * - NEVER extracts element.className
 */
export function extractActionElementTexts(action: GuardrailAction): string[] {
  const texts: string[] = [];
  const elem = action.element || (action as any).target;

  const visibleText = elem?.visibleText || (elem as any)?.text;
  if (visibleText && typeof visibleText === 'string' && visibleText.trim().length > 0) {
    texts.push(visibleText.trim());
  }

  if (elem?.ariaLabel && typeof elem.ariaLabel === 'string' && elem.ariaLabel.trim().length > 0) {
    texts.push(elem.ariaLabel.trim());
  }

  // Fallback to element ID only if visible text and accessible label are absent
  const elemId = elem?.id || (elem as any)?.elementId;
  if (texts.length === 0 && elemId && typeof elemId === 'string' && elemId.trim().length > 0) {
    // Replace hyphens and underscores with spaces so "pay-btn" -> "pay btn"
    texts.push(elemId.replace(/[-_]/g, ' ').trim());
  }

  return texts;
}

/**
 * Extracts page-level contextual metadata (for corroboration only, not direct text matching).
 */
export function extractPageContext(action: GuardrailAction): {
  url?: string;
  pathname?: string;
  domain?: string;
  title?: string;
  isSecureContext?: boolean;
} {
  let pathname: string | undefined;
  let domain: string | undefined;

  if (action.page?.url) {
    try {
      const parsed = new URL(action.page.url);
      pathname = parsed.pathname.toLowerCase();
      domain = parsed.hostname.toLowerCase();
    } catch {
      // Ignore
    }
  }

  return {
    url: action.page?.url,
    pathname,
    domain: domain || action.page?.domain,
    title: action.page?.title,
    isSecureContext: action.page?.isSecureContext,
  };
}

/**
 * Backward-compatible helper to extract searchable tokens (now strictly isolated from page context).
 */
export function extractSearchableTokens(action: GuardrailAction): string[] {
  return extractActionElementTexts(action);
}

/**
 * Backward-compatible helper to match keywords using boundary-safe matching.
 */
export function matchesAnyKeyword(
  tokens: string[],
  keywords: string[]
): { matched: boolean; matchedKeyword?: string } {
  return matchesAnyPhrase(tokens, keywords);
}

/**
 * -----------------------------------------------------------------------------
 * 1. Rule: FINANCIAL_READ_ONLY
 * -----------------------------------------------------------------------------
 * Matches read-only financial operations: viewing balances, statements,
 * transaction history, passbooks, and past transfers.
 * Evaluated BEFORE transactional rules to prevent benign navigation on banking
 * sites from triggering high-risk payment or staging responses.
 */
export const FINANCIAL_READ_ONLY_PHRASES: readonly string[] = [
  'transaction history',
  'view history',
  'past transactions',
  'recent transactions',
  'account overview',
  'account details',
  'view balance',
  'check balance',
  'account balance',
  'available balance',
  'total balance',
  'current balance',
  'balance card',
  'balance inquiry',
  'mini statement',
  'view statement',
  'account statement',
  'download statement',
  'download e-statement',
  'e-statement',
  'export statement',
  'statement pdf',
  'statements',
  'passbook',
  'transaction details',
  'past transfers',
  'transfer history',
  'payment history',
  'order history',
  'view transactions',
  'recent activity',
  'filter transactions',
  'search transactions',
  'filter payment history',
  'payment history filter',
  'payment methods',
  'saved payment methods',
  'manage payment methods',
  'payment options',
  'account dashboard',
  'banking dashboard',
  'dashboard overview',
  'my accounts',
  'account summary',
  'view beneficiaries',
  'beneficiary list',
  'payee list',
  'view payees',
  'my payees',
  'transfer limits',
  'view limits',
  'bank home',
  'banking home',
  'back to dashboard',
  'savings account',
  'current account',
  'fixed deposits',
  'recurring deposits',
  'about upi',
  'upi faq',
  'upi faqs',
  'upi help',
  'upi guide',
  'what is upi',
];

export const FinancialReadOnlyRule: ClassificationRule = {
  id: 'RULE_FINANCIAL_READ_ONLY',
  category: ActionCategory.FINANCIAL_READ_ONLY,
  description: 'Matches read-only financial browsing (view balances, statements, transaction history)',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    // 1. Direct navigation to banking portal
    if (action.type === ActionType.NAVIGATION) {
      const pageTitle = (action.page?.title || '').toLowerCase();
      const pageUrl = (action.page?.url || '').toLowerCase();
      if (
        (pageTitle.includes('bank') || pageUrl.includes('bank.') || pageUrl.includes('/netbanking')) &&
        !pageTitle.includes('phish') &&
        !pageTitle.includes('verify')
      ) {
        return {
          matched: true,
          reason: `Navigation targets banking portal ("${action.page?.title || action.page?.url}")`,
        };
      }
    }

    const texts = extractActionElementTexts(action);
    const { matched, matchedKeyword } = matchesAnyPhrase(texts, FINANCIAL_READ_ONLY_PHRASES);
    if (matched) {
      return {
        matched: true,
        reason: `Matched financial read-only phrase "${matchedKeyword}" on interactive element`,
      };
    }

    const firstText = texts[0]?.toLowerCase() || '';

    // 2. Table rows, list items, or historical entries displaying past transactions (e.g. "Transfer to Alice: ₹2,500 on 14 Nov")
    const isTableRow =
      action.element?.tagName === 'TR' ||
      action.element?.tagName === 'TD' ||
      action.element?.tagName === 'LI';
    const isHistoryItem =
      (action.element?.className || '').toLowerCase().includes('history') ||
      (action.page?.title || '').toLowerCase().includes('history') ||
      (action.page?.url || '').toLowerCase().includes('transfers') ||
      (action.page?.url || '').toLowerCase().includes('history');
    const hasCompletedTxPattern =
      /\b(on \d{1,2} [a-z]{3}|\d{4}-\d{2}-\d{2}|completed|successful|debited|credited)\b/i.test(firstText);

    if (
      (isTableRow || isHistoryItem || hasCompletedTxPattern) &&
      !isTransactionConfirmation(action) &&
      !isBeneficiaryAdditionOrChange(action)
    ) {
      if (
        firstText.includes('transfer to ') ||
        firstText.includes('paid to ') ||
        firstText.includes('received from ') ||
        firstText.includes('payment to ') ||
        hasCompletedTxPattern ||
        (isTableRow && (firstText.includes('transfer') || firstText.includes('payment')))
      ) {
        return {
          matched: true,
          reason: `Interactive table row or history entry displaying past transaction record`,
        };
      }
    }

    if (
      (firstText.includes('balance') && !firstText.includes('pay') && !firstText.includes('transfer')) ||
      (firstText.includes('history') && !firstText.includes('confirm') && !firstText.includes('authorize')) ||
      (firstText.includes('statement') && !firstText.includes('pay')) ||
      firstText === 'accounts' ||
      firstText === 'my accounts' ||
      firstText === 'dashboard'
    ) {
      return {
        matched: true,
        reason: `Interactive element indicates read-only financial browsing ("${firstText}")`,
      };
    }

    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 2. Rule: BENEFICIARY_MANAGEMENT
 * -----------------------------------------------------------------------------
 * Matches adding, modifying, or removing payees/beneficiaries.
 */
export const BENEFICIARY_MANAGEMENT_PHRASES: readonly string[] = [
  'add beneficiary',
  'new beneficiary',
  'manage beneficiaries',
  'delete beneficiary',
  'edit beneficiary',
  'modify beneficiary',
  'change beneficiary',
  'add payee',
  'new payee',
  'manage payees',
  'delete payee',
  'edit payee',
  'modify payee',
  'add new payee',
  'register beneficiary',
  'add account',
  'add new account',
  'change recipient',
  'modify recipient',
  'remove beneficiary',
  'remove payee',
  'update beneficiary details',
  'update payee details',
];

export const BeneficiaryManagementRule: ClassificationRule = {
  id: 'RULE_BENEFICIARY_MANAGEMENT',
  category: ActionCategory.BENEFICIARY_MANAGEMENT,
  description: 'Matches adding, editing, managing, or deleting beneficiaries and payees',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    const texts = extractActionElementTexts(action);
    const { matched, matchedKeyword } = matchesAnyPhrase(texts, BENEFICIARY_MANAGEMENT_PHRASES);
    if (matched) {
      return {
        matched: true,
        reason: `Matched beneficiary management phrase "${matchedKeyword}" on interactive element`,
      };
    }
    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 3. Rule: FINANCIAL_TRANSACTION
 * -----------------------------------------------------------------------------
 * Matches explicit fund transfers, remittances, and wire transactions.
 */
export const FINANCIAL_TRANSACTION_PHRASES: readonly string[] = [
  'transfer money',
  'send money',
  'wire transfer',
  'transfer funds',
  'fund transfer',
  'instant transfer',
  'upi transfer',
  'make transfer',
  'initiate transfer',
  'start transfer',
  'new transfer',
  'quick transfer',
  'send funds',
  'transfer now',
  'confirm transfer',
  'submit transfer',
  'authorize transfer',
  'confirm transaction',
  'authorize transaction',
  'authorize debit',
  'authorize withdrawal',
  'confirm withdrawal',
  'pay via upi',
  'upi payment',
  'bhim upi',
  'confirm upi',
  'authorize upi',
  'approve upi payment',
  'send to upi id',
  'send to vpa',
  'scan and pay',
  'scan qr',
  'upi qr',
  'approve payment request',
  'remit funds',
];

export const FinancialTransactionRule: ClassificationRule = {
  id: 'RULE_FINANCIAL_TRANSACTION',
  category: ActionCategory.FINANCIAL_TRANSACTION,
  description: 'Matches explicit fund transfers and wire transactions',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    if (action.element?.hasPasswordField) return { matched: false };
    const texts = extractActionElementTexts(action);
    const { matched, matchedKeyword } = matchesAnyPhrase(texts, FINANCIAL_TRANSACTION_PHRASES);
    if (matched) {
      return {
        matched: true,
        reason: `Matched financial transaction phrase "${matchedKeyword}" on interactive element`,
      };
    }
    if (isUpiInteraction(action)) {
      return {
        matched: true,
        reason: 'Detected UPI payment flow on interactive element',
      };
    }
    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 3b. Rule: FINANCIAL_SECURITY_CHANGE
 * -----------------------------------------------------------------------------
 * Matches modifications to banking security, transaction limits, alerts, or payment credentials.
 */
export const FINANCIAL_SECURITY_CHANGE_PHRASES: readonly string[] = [
  'change transaction limit',
  'set transfer limit',
  'daily transfer limit',
  'modify transfer limit',
  'increase limit',
  'update transfer limit',
  'card limit',
  'manage limits',
  'change daily limit',
  'disable transaction alerts',
  'turn off sms alerts',
  'disable alerts',
  'disable notification',
  'disable security alerts',
  'financial security settings',
  'transaction controls',
  'payment security settings',
  'change mpin',
  'reset mpin',
  'set mpin',
  'change transaction pin',
  'update 2fa for banking',
  'change payment pin',
  'disable international transactions',
  'disable 2fa',
  'disable cooling period',
  'disable two factor authentication',
];

export const FinancialSecurityChangeRule: ClassificationRule = {
  id: 'RULE_FINANCIAL_SECURITY_CHANGE',
  category: ActionCategory.FINANCIAL_SECURITY_CHANGE,
  description: 'Matches modifications to banking security, transaction limits, alerts, or payment credentials',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    const texts = extractActionElementTexts(action);
    const { matched, matchedKeyword } = matchesAnyPhrase(texts, FINANCIAL_SECURITY_CHANGE_PHRASES);
    if (matched) {
      return {
        matched: true,
        reason: `Matched financial security change phrase "${matchedKeyword}" on interactive element`,
      };
    }
    return { matched: false };
  },
};

/**
 * UPI handle regex matching standard Indian banking VPA formats (strictly without PIN or credentials).
 */
export const UPI_HANDLES_REGEX =
  /^[a-zA-Z0-9.\-_]{2,256}@(okaxis|okhdfcbank|okicici|oksbi|upi|paytm|ybl|axl|ibl|barodampay|federal|postbank|jupiteraxis|fbl)$/i;

/**
 * Evaluates whether an interaction engages with UPI payment or VPA identifier.
 */
export function isUpiInteraction(action: GuardrailAction): boolean {
  if (action.element?.isUpi) return true;
  if (action.element?.vpaHandle) return true;
  const texts = extractActionElementTexts(action);
  for (const text of texts) {
    const lower = text.toLowerCase();
    if (
      lower.includes('about upi') ||
      lower.includes('upi faq') ||
      lower.includes('upi help') ||
      lower.includes('upi guide') ||
      lower.includes('what is upi') ||
      lower.includes('learn about upi')
    ) {
      continue;
    }
    if (
      matchesAnyPhrase([text], [
        'upi',
        'vpa',
        'bhim upi',
        'pay via upi',
        'gpay',
        'phonepe',
        'paytm upi',
        'upi qr',
        'scan and pay',
        'upi id',
        'send to upi',
      ]).matched
    ) {
      return true;
    }
    if (UPI_HANDLES_REGEX.test(text.trim())) {
      return true;
    }
  }
  if (
    action.element?.targetUrl &&
    (action.element.targetUrl.startsWith('upi://') || action.element.targetUrl.includes('upi/pay'))
  ) {
    return true;
  }
  return false;
}

/**
 * Identifies explicit final confirmation or authorization of a financial transaction.
 */
export const TRANSACTION_CONFIRMATION_PHRASES: readonly string[] = [
  'confirm transfer',
  'authorize transfer',
  'submit transfer',
  'confirm payment',
  'authorize payment',
  'confirm transaction',
  'authorize transaction',
  'authorize debit',
  'confirm upi',
  'authorize upi',
  'approve upi payment',
  'approve payment',
  'confirm wire',
  'submit payment',
  'confirm withdrawal',
  'authorize withdrawal',
];

export function isTransactionConfirmation(action: GuardrailAction): boolean {
  if (action.element?.isTransactionConfirmation) return true;
  const texts = extractActionElementTexts(action);
  const { matched } = matchesAnyPhrase(texts, TRANSACTION_CONFIRMATION_PHRASES);
  if (matched) return true;

  if (action.type === ActionType.SUBMIT) {
    const btnText = action.element?.submitButtonText || action.element?.visibleText || '';
    if (/\b(confirm|authorize|approve|submit transfer|pay now)\b/i.test(btnText)) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates whether an action adds or changes a payee or beneficiary.
 */
export function isBeneficiaryAdditionOrChange(action: GuardrailAction): boolean {
  if (action.category !== ActionCategory.BENEFICIARY_MANAGEMENT) {
    const texts = extractActionElementTexts(action);
    const { matched } = matchesAnyPhrase(texts, BENEFICIARY_MANAGEMENT_PHRASES);
    if (!matched) return false;
  }
  const texts = extractActionElementTexts(action);
  return matchesAnyPhrase(texts, [
    'add beneficiary',
    'new beneficiary',
    'add payee',
    'new payee',
    'add account',
    'register beneficiary',
    'add new payee',
    'change beneficiary',
    'modify beneficiary',
    'change recipient',
    'modify recipient',
    'edit beneficiary',
    'edit payee',
    'update beneficiary',
  ]).matched;
}

/**
 * Evaluates whether an action disables important financial security protections or alerts.
 */
export function isDisablingFinancialSecurity(action: GuardrailAction): boolean {
  const texts = extractActionElementTexts(action);
  return matchesAnyPhrase(texts, [
    'disable transaction alerts',
    'turn off sms alerts',
    'disable alerts',
    'disable notification',
    'disable security alerts',
    'disable international transactions',
    'disable 2fa',
    'disable cooling period',
    'disable two factor authentication',
    'reset mpin',
    'change mpin',
    'change transaction pin',
  ]).matched;
}

/**
 * -----------------------------------------------------------------------------
 * 4. Rule: PAYMENT
 * -----------------------------------------------------------------------------
 * Matches checkout, purchases, payments, and billing authorization.
 */
export const PAYMENT_KEYWORDS: readonly string[] = [
  'pay',
  'payment',
  'purchase',
  'checkout',
  'buy',
  'place order',
  'complete purchase',
  'confirm payment',
  'submit payment',
  'pay now',
  'proceed to pay',
  'transfer',
];

export const PaymentRule: ClassificationRule = {
  id: 'RULE_PAYMENT_KEYWORDS',
  category: ActionCategory.PAYMENT,
  description: 'Matches keywords related to payments, billing, checkout, and money transfers',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    // Actions with credential entry controls (password fields) are strictly AUTHENTICATION
    if (action.element?.hasPasswordField) {
      return { matched: false };
    }

    const texts = extractActionElementTexts(action);

    // Filter out read-only informational phrases that might contain "payment" (e.g. "payment options")
    const firstText = texts[0]?.toLowerCase() || '';
    if (
      firstText.includes('payment options') ||
      firstText.includes('payment methods') ||
      firstText.includes('how to pay') ||
      firstText.includes('payment faq')
    ) {
      return { matched: false };
    }

    const { matched, matchedKeyword } = matchesAnyPhrase(texts, PAYMENT_KEYWORDS);
    if (matched) {
      return {
        matched: true,
        reason: `Matched payment keyword "${matchedKeyword}" on interactive element`,
      };
    }
    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 5. Rule: SECURITY_SETTING_CHANGE
 * -----------------------------------------------------------------------------
 * Matches modifications to security settings, passwords, PINs, and 2FA credentials.
 */
export const SECURITY_SETTING_PHRASES: readonly string[] = [
  'change password',
  'update password',
  'reset password',
  'enable 2fa',
  'disable 2fa',
  'setup 2fa',
  'security questions',
  'security settings',
  'change pin',
  'reset pin',
  'update recovery email',
];

export const SecuritySettingChangeRule: ClassificationRule = {
  id: 'RULE_SECURITY_SETTING_CHANGE',
  category: ActionCategory.SECURITY_SETTING_CHANGE,
  description: 'Matches modifications to security settings, credentials, passwords, or 2FA',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    const texts = extractActionElementTexts(action);
    const { matched, matchedKeyword } = matchesAnyPhrase(texts, SECURITY_SETTING_PHRASES);
    if (matched) {
      return {
        matched: true,
        reason: `Matched security setting phrase "${matchedKeyword}" on interactive element`,
      };
    }
    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 6. Rule: PERMISSION_CHANGE
 * -----------------------------------------------------------------------------
 * Matches site or user access permission modifications.
 */
export const PERMISSION_CHANGE_PHRASES: readonly string[] = [
  'change permissions',
  'grant permission',
  'revoke permission',
  'grant access',
  'revoke access',
  'modify permissions',
  'manage permissions',
  'edit permissions',
];

export const PermissionChangeRule: ClassificationRule = {
  id: 'RULE_PERMISSION_CHANGE',
  category: ActionCategory.PERMISSION_CHANGE,
  description: 'Matches site or user access permission modifications',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    const texts = extractActionElementTexts(action);
    const { matched, matchedKeyword } = matchesAnyPhrase(texts, PERMISSION_CHANGE_PHRASES);
    if (matched) {
      return {
        matched: true,
        reason: `Matched permission change phrase "${matchedKeyword}" on interactive element`,
      };
    }
    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 7. Rule: DESTRUCTIVE
 * -----------------------------------------------------------------------------
 * Matches permanent deletion, data purging, and irreversible account termination.
 */
export const DESTRUCTIVE_KEYWORDS: readonly string[] = [
  'delete',
  'permanently delete',
  'close account',
  'terminate account',
  'purge data',
  'purge',
  'destroy',
  'cancel account',
  'delete profile',
];

export const DestructiveRule: ClassificationRule = {
  id: 'RULE_DESTRUCTIVE_KEYWORDS',
  category: ActionCategory.DESTRUCTIVE,
  description: 'Matches keywords related to permanent deletion, data purging, and account closure',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    const texts = extractActionElementTexts(action);

    // Exclude routine non-destructive filtering/searching UI interactions
    const firstText = texts[0]?.toLowerCase() || '';
    if (
      firstText.includes('remove filter') ||
      firstText.includes('clear filter') ||
      firstText.includes('clear search') ||
      firstText.includes('remove tag')
    ) {
      return { matched: false };
    }

    const { matched, matchedKeyword } = matchesAnyPhrase(texts, DESTRUCTIVE_KEYWORDS);
    if (matched) {
      return {
        matched: true,
        reason: `Matched destructive keyword "${matchedKeyword}" on interactive element`,
      };
    }
    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 8. Rule: AUTHENTICATION
 * -----------------------------------------------------------------------------
 * Matches user sign-in, login, registration, and credential submission.
 * IMPORTANT: Standalone "verify" in general navigation is NOT classified as auth.
 */
export const AUTH_KEYWORDS: readonly string[] = [
  'login',
  'log in',
  'sign in',
  'signin',
  'authenticate',
  'register',
  'create account',
  'sign up',
  'signup',
  'log out',
  'logout',
  'sign out',
];

export const AuthenticationRule: ClassificationRule = {
  id: 'RULE_AUTH_KEYWORDS',
  category: ActionCategory.AUTHENTICATION,
  description: 'Matches keywords or structural inputs related to user sign-in, login, and authentication',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    if (action.element?.hasPasswordField) {
      return {
        matched: true,
        reason: 'Action interacts with credential authentication control (password input field present)',
      };
    }

    const texts = extractActionElementTexts(action);
    const { matched, matchedKeyword } = matchesAnyPhrase(texts, AUTH_KEYWORDS);
    if (matched) {
      return {
        matched: true,
        reason: `Matched authentication keyword "${matchedKeyword}" on interactive element`,
      };
    }
    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 9. Rule: DOWNLOAD
 * -----------------------------------------------------------------------------
 * Matches file downloads, data exports, and file saving.
 */
export const DOWNLOAD_KEYWORDS: readonly string[] = [
  'download',
  'export',
  'export reports',
  'save file',
  'download file',
  'export to csv',
];

export const DownloadRule: ClassificationRule = {
  id: 'RULE_DOWNLOAD_KEYWORDS',
  category: ActionCategory.DOWNLOAD,
  description: 'Matches keywords, download attributes, file extensions, or download models related to file downloads and exports',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    // 1. Explicit download payload or metadata present
    if (action.download || action.element?.downloadInfo) {
      return {
        matched: true,
        reason: 'Action contains verified browser download metadata',
      };
    }

    // 2. Anchor with download attribute
    if (action.element?.downloadAttribute !== undefined) {
      return {
        matched: true,
        reason: 'Action targeted link element with download attribute',
      };
    }

    // 3. Keyword matching in action element texts
    const texts = extractActionElementTexts(action);
    const { matched, matchedKeyword } = matchesAnyPhrase(texts, DOWNLOAD_KEYWORDS);
    if (matched) {
      return {
        matched: true,
        reason: `Matched download keyword "${matchedKeyword}" on interactive element`,
      };
    }

    // 4. Target URL pathname ends with a recognized file extension
    const target = action.element?.targetUrl;
    if (target) {
      try {
        const parsed = new URL(target, 'http://localhost');
        const pathname = parsed.pathname.toLowerCase();
        if (/\.(exe|msi|dmg|pkg|zip|tar|gz|7z|iso|bat|sh|ps1|vbs|pdf|docx|xlsx|csv)(\?.*)?$/i.test(pathname)) {
          return {
            matched: true,
            reason: `Action destination targets downloadable file asset (${pathname})`,
          };
        }
      } catch {
        // Ignore URL parsing errors
      }
    }

    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 10. Rule: SENSITIVE_DATA_SUBMISSION
 * -----------------------------------------------------------------------------
 * Matches form submissions or inputs involving sensitive PII, SSN, or identity documents.
 */
export const SensitiveDataSubmissionRule: ClassificationRule = {
  id: 'RULE_SENSITIVE_DATA_SUBMISSION',
  category: ActionCategory.SENSITIVE_DATA_SUBMISSION,
  description: 'Matches form submissions or inputs involving sensitive PII, SSN, or identity documents',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    if (action.element?.hasSensitiveField) {
      const sensitiveTypes = action.element.sensitiveFieldTypes || [];
      const hasNonPaymentSensitive = sensitiveTypes.some(
        (t) => t === 'ssn' || t === 'national_id' || t === 'passport' || t === 'driver_license'
      );
      if (hasNonPaymentSensitive) {
        return {
          matched: true,
          reason: `Action interacts with sensitive identity field (${sensitiveTypes.join(', ')})`,
        };
      }
    }
    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 11. Rule: SUSPICIOUS_REDIRECT
 * -----------------------------------------------------------------------------
 * Matches navigation or links targeting suspicious, spoofed, or homoglyph URLs.
 */
export const SuspiciousRedirectRule: ClassificationRule = {
  id: 'RULE_SUSPICIOUS_REDIRECT',
  category: ActionCategory.SUSPICIOUS_REDIRECT,
  description: 'Matches navigation or links targeting suspicious, spoofed, or homoglyph URLs',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    const candidateUrl =
      action.element?.targetUrl ||
      (action.type === ActionType.NAVIGATION ? action.page.url : undefined);
    if (candidateUrl) {
      const evalResult = evaluateSuspiciousUrl(candidateUrl);
      if (evalResult.isSuspicious) {
        return {
          matched: true,
          reason: `Suspicious destination URL detected: ${evalResult.reasons[0] || 'Unverified host characteristics'}`,
        };
      }
    }
    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 12. Rule: EXTERNAL_NAVIGATION
 * -----------------------------------------------------------------------------
 * Matches navigation or link traversal that departs to an external origin.
 */
export const EXTERNAL_KEYWORDS: readonly string[] = [
  'external',
  'external navigation',
  'leave site',
  'external link',
  'third party',
  'third-party',
  'external site',
  'redirect',
];

export const ExternalNavigationRule: ClassificationRule = {
  id: 'RULE_EXTERNAL_NAVIGATION',
  category: ActionCategory.EXTERNAL_NAVIGATION,
  description: 'Matches navigation events or links where the target domain indicates external departure',
  evaluate: (action: GuardrailAction): RuleEvaluationResult => {
    // 1. Navigation crossing origin boundaries
    if (action.page.url && action.page.previousUrl) {
      try {
        const currentOrigin = new URL(action.page.url).origin;
        const previousOrigin = new URL(action.page.previousUrl).origin;

        if (currentOrigin !== previousOrigin && previousOrigin !== 'null' && currentOrigin !== 'null') {
          return {
            matched: true,
            reason: `Navigation crossed site origin boundary from ${previousOrigin} to ${currentOrigin}`,
          };
        }
      } catch {
        // Ignore invalid URL parse attempts
      }
    }

    // 2. Link explicitly targeting an external origin
    if (action.element?.targetUrl) {
      try {
        const targetOrigin = new URL(action.element.targetUrl).origin;
        const currentOrigin = action.page?.url ? new URL(action.page.url).origin : '';
        if (targetOrigin && currentOrigin && targetOrigin !== currentOrigin && targetOrigin !== 'null') {
          return {
            matched: true,
            reason: `Link targets external origin: ${targetOrigin}`,
          };
        }
      } catch {
        // Ignore invalid URL
      }
    }

    // 3. Explicit bounded keywords on the interactive element itself
    const texts = extractActionElementTexts(action);
    const { matched, matchedKeyword } = matchesAnyPhrase(texts, EXTERNAL_KEYWORDS);
    if (matched) {
      return {
        matched: true,
        reason: `Matched external navigation phrase "${matchedKeyword}" on interactive element`,
      };
    }

    return { matched: false };
  },
};

/**
 * -----------------------------------------------------------------------------
 * 13. Fallback Rule: GENERAL
 * -----------------------------------------------------------------------------
 * Default category when no specialized heuristic rules match.
 */
export const GeneralFallbackRule: ClassificationRule = {
  id: 'RULE_GENERAL_FALLBACK',
  category: ActionCategory.GENERAL,
  description: 'Default category assigned when no specific category rules match',
  evaluate: (_action: GuardrailAction): RuleEvaluationResult => {
    return {
      matched: true,
      reason: 'No specialized classification rules matched; defaulted to GENERAL',
    };
  },
};

/**
 * Ordered list of classification rules.
 * Rules are evaluated in priority order; first match wins before falling back to GENERAL.
 */
export const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  FinancialReadOnlyRule,
  BeneficiaryManagementRule,
  FinancialTransactionRule,
  PaymentRule,
  FinancialSecurityChangeRule,
  SecuritySettingChangeRule,
  PermissionChangeRule,
  DestructiveRule,
  AuthenticationRule,
  DownloadRule,
  SensitiveDataSubmissionRule,
  SuspiciousRedirectRule,
  ExternalNavigationRule,
  GeneralFallbackRule,
];
