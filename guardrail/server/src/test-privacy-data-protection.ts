/**
 * Guardrail UI - Privacy and Data Protection Verification Suite
 *
 * Systematic verification of data minimization, credential exclusion,
 * URL sanitization, download metadata hygiene, diagnostic log redaction,
 * error masking, and durable database retention pruning.
 *
 * Clearly distinguishes REAL SQLite integration operations from
 * MOCKED DOM / network unit validations.
 */

import { rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Domain and extraction utilities
import {
  redactSensitiveText,
  sanitizeUrlForDiagnostics,
  isPrivacySafe,
  createDiagnosticLogger,
} from '../../extension/src/utils/privacy.js';
import {
  extractElementInfo,
} from '../../extension/src/utils/dom.js';
import {
  generateSafeActionDescription,
} from '../../extension/src/staging/context.js';
import {
  evaluateFormSafety,
} from '../../extension/src/utils/form-detector.js';
import {
  BrowserDownloadManager,
} from '../../extension/src/background/download-manager.js';
import {
  PERMITTED_APPROVAL_REQUEST_FIELDS,
  FORBIDDEN_PROPERTY_PATTERNS,
  createApprovalRequest,
} from '../../extension/src/approval/model.js';
import {
  ActionCategory,
  ActionType,
  GuardrailAction,
} from '../../extension/src/types/actions.js';
import { RiskLevel } from '../../extension/src/types/risk.js';
import { ApprovalStatus } from '../../extension/src/types/approval.js';

// Durable SQLite Repositories
import { SqliteApprovalRequestRepository } from './sqlite-approval-request-repository.js';
import { SqliteTrustedContactRegistry } from './sqlite-trusted-contact-registry.js';
import { SqlitePolicyRepository } from './sqlite-policy-repository.js';
import { SqliteIdentityStore } from './identity-store.js';

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition: boolean, message: string): void {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  PASS: ${message}`);
  } else {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalAssertions++;
  if (actual === expected) {
    passedAssertions++;
    console.log(`  PASS: ${message} (${String(actual)})`);
  } else {
    console.error(`  FAIL: ${message}. Expected ${String(expected)}, received ${String(actual)}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('\n====================================================================');
console.log('🔒 GUARDRAIL: PRIVACY & DATA PROTECTION TEST SUITE');
console.log('====================================================================\n');

async function runPrivacyVerificationSuite(): Promise<void> {
  // ===========================================================================
  // SECTION 1: Sensitive Text Redaction & Form-Data Sanitization
  // ===========================================================================
  console.log('--- SECTION 1: Sensitive Text Redaction & Credential Exclusion ---');

  // Test 1.1: redactSensitiveText scrubs credit cards, passwords, OTPs, tokens, SSNs
  {
    const rawWithCard = 'Transaction for Card 4532 0150 9988 1122 approved';
    const redactedCard = redactSensitiveText(rawWithCard);
    assert(!redactedCard.includes('4532 0150 9988 1122'), '1.1 Credit card number is scrubbed');
    assert(redactedCard.includes('[REDACTED_CARD]'), '1.1 Replaced with [REDACTED_CARD]');

    const rawWithOtp = 'Authentication code: 849201 for login';
    const redactedOtp = redactSensitiveText(rawWithOtp);
    assert(!redactedOtp.includes('849201'), '1.1 OTP code digits are scrubbed');
    assert(redactedOtp.includes('[REDACTED]'), '1.1 Replaced with [REDACTED]');

    const rawWithPwd = 'Account created with password: MySecretPass!99';
    const redactedPwd = redactSensitiveText(rawWithPwd);
    assert(!redactedPwd.includes('MySecretPass!99'), '1.1 Password value is scrubbed');
    assert(redactedPwd.includes('[REDACTED]'), '1.1 Replaced with [REDACTED]');

    const rawWithToken = 'Session token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature';
    const redactedToken = redactSensitiveText(rawWithToken);
    assert(!redactedToken.includes('eyJhbGciOi'), '1.1 JWT bearer token is scrubbed');
    assert(redactedToken.includes('[REDACTED_TOKEN]'), '1.1 Replaced with [REDACTED_TOKEN]');

    const rawWithSsn = 'Applicant SSN 123-45-6789 verified';
    const redactedSsn = redactSensitiveText(rawWithSsn);
    assert(!redactedSsn.includes('123-45-6789'), '1.1 SSN number is scrubbed');
    assert(redactedSsn.includes('[REDACTED_SSN]'), '1.1 Replaced with [REDACTED_SSN]');

    // Safe benign texts remain unchanged
    const benignText = 'Submit order for ₹5,000 to external provider';
    assertEquals(redactSensitiveText(benignText), benignText, '1.1 Benign financial amount text preserved');
  }

  // Test 1.2: DOM element extraction strictly excludes input values and detects sensitive types
  {
    const mockForm: any = {
      tagName: 'FORM',
      getAttribute: (name: string) => (name === 'action' ? 'https://example.com/checkout' : null),
      hasAttribute: (_name: string) => false,
      setAttribute: (_name: string, _value: string) => {},
      action: 'https://example.com/checkout',
      method: 'POST',
      querySelector: (selector: string) => {
        if (selector.includes('password')) return { type: 'password' };
        if (selector.includes('card')) return { name: 'card_number' };
        if (selector.includes('otp')) return { name: 'otp_code' };
        if (selector.includes('iban') || selector.includes('account')) return { name: 'bank_account' };
        if (selector.includes('passport')) return { name: 'passport_no' };
        return null;
      },
    };

    const elementInfo = extractElementInfo(mockForm);
    assert(Boolean(elementInfo.hasPasswordField), '1.2 Password field detected structurally');
    assert(Boolean(elementInfo.hasSensitiveField), '1.2 Sensitive fields detected structurally');
    assert(Boolean(elementInfo.sensitiveFieldTypes?.includes('password')), '1.2 Lists password in sensitiveFieldTypes');
    assert(Boolean(elementInfo.sensitiveFieldTypes?.includes('payment_card')), '1.2 Lists payment_card in sensitiveFieldTypes');
    assert(Boolean(elementInfo.sensitiveFieldTypes?.includes('otp')), '1.2 Lists otp in sensitiveFieldTypes');
    assert(Boolean(elementInfo.sensitiveFieldTypes?.includes('bank_account')), '1.2 Lists bank_account in sensitiveFieldTypes');
    assert(Boolean(elementInfo.sensitiveFieldTypes?.includes('identity_document')), '1.2 Lists identity_document in sensitiveFieldTypes');

    // Verify zero input value leakage in extracted object
    const serialized = JSON.stringify(elementInfo);
    assert(!serialized.includes('value'), '1.2 No input values exist in element info JSON');
  }

  // Test 1.3: Safe action descriptions redact sensitive strings from element labels
  {
    const sensitiveAction: GuardrailAction = {
      id: 'act_safe_desc_test',
      type: ActionType.CLICK,
      category: ActionCategory.PAYMENT,
      element: {
        tagName: 'BUTTON',
        visibleText: 'Pay with Card 4111 2222 3333 4444',
      },
      page: {
        url: 'https://example.com/pay',
        title: 'Checkout',
      },
      timestamp: new Date().toISOString(),
    };

    const description = generateSafeActionDescription(sensitiveAction);
    assert(!description.includes('4111 2222 3333 4444'), '1.3 Description does NOT include raw credit card number');
    assert(description.includes('[REDACTED_CARD]'), '1.3 Description contains [REDACTED_CARD] placeholder');
  }

  // ===========================================================================
  // SECTION 2: URL Sanitization & Query Parameter Stripping
  // ===========================================================================
  console.log('\n--- SECTION 2: URL Sanitization & Query Parameter Stripping ---');

  // Test 2.1: sanitizeUrlForDiagnostics strips query parameters and hashes
  {
    const fullUrlWithTokens = 'https://portal.example.com/reset?token=secret_abc123&user=victim%40test.org#step2';
    const sanitized = sanitizeUrlForDiagnostics(fullUrlWithTokens);
    assertEquals(sanitized, 'https://portal.example.com/reset', '2.1 Query parameters and hash stripped from absolute URL');

    const relativeUrl = '/api/v1/auth?sig=888999#token';
    const sanitizedRel = sanitizeUrlForDiagnostics(relativeUrl);
    assertEquals(sanitizedRel, '/api/v1/auth', '2.1 Query and hash stripped from relative path');
  }

  // Test 2.2: Form safety evidence sanitization
  {
    const formResult = evaluateFormSafety({
      pageUrl: 'https://example.com/login?session=active_token_123',
      formAction: 'https://other.com/harvest?dest=external&key=secret99',
      hasPasswordField: true,
      hasSensitiveField: true,
      sensitiveFieldTypes: ['password'],
    });

    for (const indicator of formResult.indicators) {
      if (indicator.evidence) {
        assert(!indicator.evidence.includes('session=active_token_123'), '2.2 No page URL query params in evidence');
        assert(!indicator.evidence.includes('key=secret99'), '2.2 No formAction query params in evidence');
      }
    }
  }

  // ===========================================================================
  // SECTION 3: Download Metadata Retention Hygiene
  // ===========================================================================
  console.log('\n--- SECTION 3: Download Metadata Retention & Memory Hygiene ---');

  // Test 3.1: BrowserDownloadManager strips URL query parameters and expires old entries
  {
    const downloadManager = new BrowserDownloadManager({
      maxCacheSize: 5,
      ttlMs: 30000,
    });

    const rawDownload = {
      id: 101,
      url: 'https://cdn.example.com/installer.dmg?signature=expiring_s3_token_xyz&user=alice@example.com#download',
      finalUrl: 'https://download.mirror.com/installer.dmg?auth=bearer_jwt_here',
      filename: 'installer.dmg',
      mime: 'application/x-apple-diskimage',
      state: 'in_progress',
      referrer: 'https://example.com/landing?campaign=track_123',
    };

    downloadManager.handleDownloadCreated(rawDownload);
    const cached = downloadManager.getActiveAssessments()[0];

    assert(Boolean(cached), '3.1 Download assessment cached');
    assertEquals(cached.item.url, 'https://cdn.example.com/installer.dmg', '3.1 Download URL stripped of tokens and query parameters');
    assertEquals(cached.item.finalUrl, 'https://download.mirror.com/installer.dmg', '3.1 Final URL stripped of tokens and query parameters');
    assertEquals(cached.item.referrer, 'https://example.com/landing', '3.1 Referrer stripped of tracking parameters');

    // Add multiple downloads up to cache limit
    for (let i = 1; i <= 6; i++) {
      downloadManager.handleDownloadCreated({
        id: 200 + i,
        url: `https://example.com/file${i}.pdf?token=secret_${i}`,
        filename: `file${i}.pdf`,
        state: 'complete',
      });
    }

    const activeList = downloadManager.getActiveAssessments();
    assert(activeList.length <= 5, '3.1 In-memory cache is strictly bounded by maxCacheSize');
    assert(!activeList.some((a) => a.id === 101), '3.1 Oldest download record was safely evicted');
  }

  // ===========================================================================
  // SECTION 4: Approval Model Data Scope Whitelist
  // ===========================================================================
  console.log('\n--- SECTION 4: Approval Model Data Minimization & Whitelists ---');

  // Test 4.1: ApprovalRequest strictly enforces field whitelist
  {
    assert(PERMITTED_APPROVAL_REQUEST_FIELDS.has('id'), '4.1 id is whitelisted');
    assert(PERMITTED_APPROVAL_REQUEST_FIELDS.has('actionId'), '4.1 actionId is whitelisted');
    assert(PERMITTED_APPROVAL_REQUEST_FIELDS.has('origin'), '4.1 origin is whitelisted');
    assert(PERMITTED_APPROVAL_REQUEST_FIELDS.has('hostname'), '4.1 hostname is whitelisted');
    assert(!PERMITTED_APPROVAL_REQUEST_FIELDS.has('password'), '4.1 password is NOT whitelisted');
    assert(!PERMITTED_APPROVAL_REQUEST_FIELDS.has('token'), '4.1 token is NOT whitelisted');
    assert(!PERMITTED_APPROVAL_REQUEST_FIELDS.has('formData'), '4.1 formData is NOT whitelisted');
    assert(!PERMITTED_APPROVAL_REQUEST_FIELDS.has('cookie'), '4.1 cookie is NOT whitelisted');
  }

  // Test 4.2: FORBIDDEN_PROPERTY_PATTERNS detects prohibited sensitive keys
  {
    const sensitiveKeys = ['password', 'card_number', 'cvv', 'otp', 'authtoken', 'form_data', 'session_id'];
    for (const key of sensitiveKeys) {
      const isForbidden = FORBIDDEN_PROPERTY_PATTERNS.some((p) => p.test(key));
      assert(isForbidden, `4.2 Sensitive key \"${key}\" matches forbidden pattern`);
    }
  }

  // ===========================================================================
  // SECTION 5: REAL SQLite Database Retention & Secure Deletion
  // ===========================================================================
  console.log('\n--- SECTION 5: REAL SQLite Database Retention & Secure Deletion ---');

  // Test 5.1: Database initializes with secure_delete = ON
  const dbDir = resolve(tmpdir(), `guardrail_privacy_test_${Date.now()}`);
  mkdirSync(dbDir, { recursive: true });
  const dbPath = resolve(dbDir, 'privacy.sqlite');

  try {
    const approvalRepo = SqliteApprovalRequestRepository.open(dbPath);
    const sharedDb = approvalRepo.getDatabase();
    const contactRegistry = SqliteTrustedContactRegistry.open(sharedDb);
    const policyRepo = SqlitePolicyRepository.open(sharedDb);
    const identityStore = SqliteIdentityStore.open(sharedDb);

    // Verify secure_delete is active
    const secureDelete = sharedDb.pragma('secure_delete', { simple: true });
    assertEquals(Number(secureDelete), 1, '5.1 SQLite secure_delete PRAGMA is enabled (1)');

    // Seed approval requests: 1 PENDING, 1 EXPIRED (old), 1 APPROVED (old)
    const now = Date.now();
    const pastCutoff = new Date(now - 7 * 86400000).toISOString();
    const oldTimestamp = new Date(now - 14 * 86400000).toISOString();
    const oldExpires = new Date(now - 13 * 86400000).toISOString();

    const makeReq = (id: string, expiresAt: string) => {
      return createApprovalRequest(
        {
          actionId: `act_${id}`,
          actionDescription: 'Test action',
          actionType: ActionType.CLICK,
          category: ActionCategory.GENERAL,
          riskLevel: RiskLevel.LOW,
          riskScore: 10,
          origin: 'https://example.test',
          hostname: 'example.test',
        },
        'usr_test_retention',
        {
          id,
          createdAt: oldTimestamp,
          expiresAt,
        }
      );
    };

    const reqPending = makeReq('apr_retention_pending', new Date(now + 3600000).toISOString());
    const reqExpired = makeReq('apr_retention_expired', oldExpires);
    const reqApproved = makeReq('apr_retention_approved', oldExpires);

    approvalRepo.save(reqPending);
    approvalRepo.save(reqExpired);
    approvalRepo.save(reqApproved);

    // Transition reqExpired to EXPIRED and reqApproved to APPROVED
    approvalRepo.atomicTransition(reqExpired.id, ApprovalStatus.PENDING, {
      ...reqExpired,
      status: ApprovalStatus.EXPIRED,
      resolvedAt: oldExpires,
    });
    approvalRepo.atomicTransition(reqApproved.id, ApprovalStatus.PENDING, {
      ...reqApproved,
      status: ApprovalStatus.APPROVED,
      resolvedAt: oldExpires,
      decision: {
        decision: ApprovalStatus.APPROVED,
        decidedBy: 'usr_approver_diff',
        decidedAt: oldExpires,
      },
    });

    assertEquals(approvalRepo.count(), 3, '5.2 Exactly 3 requests initially stored');

    // Run retention pruning with pastCutoff
    const prunedCount = approvalRepo.pruneTerminalRequests(pastCutoff);
    assertEquals(prunedCount, 2, '5.2 Pruned exactly 2 terminal records older than cutoff');
    assertEquals(approvalRepo.count(), 1, '5.2 Exactly 1 record remains in database');

    const remaining = approvalRepo.findById(reqPending.id);
    assert(Boolean(remaining), '5.2 Active PENDING record was preserved');
    assertEquals(remaining?.id, reqPending.id, '5.2 Preserved record is the active request');

    // Verify SqlitePolicyRepository audit log retention pruning
    await policyRepo.recordAudit({
      id: 'aud_old_1',
      userId: 'usr_test_retention',
      updatedBy: 'usr_test_retention',
      actorRole: 'USER',
      timestamp: oldTimestamp,
      previousPolicyVersion: '1.0.0',
      newPolicyVersion: '1.1.0',
      changedFields: ['lowMax'],
      changeSummary: 'Old audit record',
    });

    await policyRepo.recordAudit({
      id: 'aud_recent_2',
      userId: 'usr_test_retention',
      updatedBy: 'usr_test_retention',
      actorRole: 'USER',
      timestamp: new Date().toISOString(),
      previousPolicyVersion: '1.1.0',
      newPolicyVersion: '1.2.0',
      changedFields: ['mediumMax'],
      changeSummary: 'Recent audit record',
    });

    const auditsBefore = await policyRepo.getAuditHistory('usr_test_retention');
    assertEquals(auditsBefore.length, 2, '5.3 Exactly 2 policy audit records stored');

    const prunedAudits = policyRepo.pruneAuditHistory(pastCutoff);
    assertEquals(prunedAudits, 1, '5.3 Pruned exactly 1 audit record older than cutoff');

    const auditsAfter = await policyRepo.getAuditHistory('usr_test_retention');
    assertEquals(auditsAfter.length, 1, '5.3 Exactly 1 recent audit record remains');
    assertEquals(auditsAfter[0].id, 'aud_recent_2', '5.3 Retained record is the recent audit record');

    // Clean up
    approvalRepo.close();
    contactRegistry.close();
    policyRepo.close();
    identityStore.close();
  } finally {
    try {
      rmSync(dbDir, { recursive: true, force: true });
    } catch {
      // safe cleanup
    }
  }

  // ===========================================================================
  // SECTION 6: Diagnostic Logging & Error Reporting Sanitization
  // ===========================================================================
  console.log('\n--- SECTION 6: Diagnostic Logging & Error Sanitization ---');

  // Test 6.1: DiagnosticLogger scrubs sensitive keys before emission
  {
    let emittedLog: any = null;
    const originalConsole = console.log;

    try {
      console.log = (_msg: string, meta: any) => {
        emittedLog = meta;
      };
      const logger = createDiagnosticLogger('TestPrivacyScope');
      logger.info('Processing transaction', {
        actionId: 'act_log_test',
        password: 'UserSecretPassword',
        cardNumber: '4111222233334444',
        otp: '998877',
        url: 'https://example.com/checkout?token=leak_token_123',
      });
    } finally {
      console.log = originalConsole;
    }

    assert(Boolean(emittedLog), '6.1 Logger emitted payload');
    assertEquals(emittedLog?.password, '[REDACTED]', '6.1 password redacted in logs');
    assertEquals(emittedLog?.cardNumber, '[REDACTED]', '6.1 cardNumber redacted in logs');
    assertEquals(emittedLog?.otp, '[REDACTED]', '6.1 otp redacted in logs');
    assertEquals(emittedLog?.url, 'https://example.com/checkout', '6.1 URL query stripped in logs');
    assertEquals(emittedLog?.actionId, 'act_log_test', '6.1 Non-sensitive audit metadata preserved');
  }

  // Test 6.2: isPrivacySafe verifies clean vs dirty payloads deterministically
  {
    const cleanPayload = {
      requestId: 'apr_12345678',
      actionId: 'act_12345678',
      hostname: 'example.test',
      status: 'PENDING',
      riskScore: 25,
    };
    const cleanCheck = isPrivacySafe(cleanPayload);
    assert(cleanCheck.safe, '6.2 Clean payload verified as privacy-safe');
    assertEquals(cleanCheck.violations.length, 0, '6.2 Zero violations in clean payload');

    const dirtyPayload = {
      requestId: 'apr_12345678',
      password: 'PlaintextPassword123',
    };
    const dirtyCheck = isPrivacySafe(dirtyPayload);
    assert(!dirtyCheck.safe, '6.2 Dirty payload with password identified as unsafe');
    assert(dirtyCheck.violations.length > 0, '6.2 Violations recorded for dirty payload');
  }

  console.log('\n====================================================================');
  console.log(`📊 PRIVACY SUITE RESULTS: ${passedAssertions} / ${totalAssertions} PASSED`);
  console.log('🎉 ALL DATA MINIMIZATION & PRIVACY INVARIANTS VERIFIED!');
  console.log('====================================================================\n');
}

runPrivacyVerificationSuite().catch((err) => {
  console.error('Fatal error in privacy verification suite:', err);
  process.exit(1);
});
