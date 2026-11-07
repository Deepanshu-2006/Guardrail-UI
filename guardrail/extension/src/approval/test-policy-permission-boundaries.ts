/**
 * Guardrail Protection Policy Permission Boundaries Verification Suite
 *
 * Comprehensive tests verifying:
 * 1. Unauthorized updates (trusted contacts and admins cannot modify policy)
 * 2. Cross-user isolation (anti-enumeration 404 on unowned resources)
 * 3. Active trusted contact read-only visibility (sanitized summary, private data stripped)
 * 4. Revoked relationship handling (immediate 404 cut-off)
 * 5. Pending invitation relationship handling
 * 6. Ward sovereign administration (owner can configure allowed settings)
 * 7. Mandatory security invariant enforcement (destructive & boundary guards locked to PROTECT)
 * 8. Optimistic concurrency control & stale request rejection (409 Conflict)
 * 9. Non-sensitive audit trail recording & contact exclusion from audit logs
 * 10. Canonical policy reset
 */

import {
  ApprovalApiRouter,
} from './index.js';
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
} from '../config/schema.js';
import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import {
  CURRENT_ARCHITECTURE_POLICY_VERSION,
  CURRENT_ARCHITECTURE_SCHEMA_VERSION,
  GuardrailPolicyConfig,
} from '../types/config.js';
import {
  ActorRole,
  AuthContext,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from './authorization.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
} from './repository.js';
import { ApprovalService } from './service.js';
import {
  InMemoryPolicyRepository,
} from './policy-repository.js';
import { PolicyService } from './policy-service.js';
import {
  PolicySettingAuthority,
  POLICY_SETTING_AUTHORITY_MATRIX,
  determineSensitivityPreset,
} from './policy-permissions.js';

// =============================================================================
// Synthetic Test Harness
// =============================================================================

class MockTokenVerifier {
  private readonly tokens: Map<string, AuthContext> = new Map();

  public registerToken(token: string, context: AuthContext): void {
    this.tokens.set(token, context);
  }

  public async verifyToken(token: string): Promise<AuthContext> {
    const ctx = this.tokens.get(token);
    if (!ctx) {
      return {
        actorId: 'anonymous',
        role: ActorRole.USER,
        isAuthenticated: false,
      };
    }
    return ctx;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTestSuite(): Promise<void> {
  console.log('\n=== Guardrail Protection Policy Permission Boundaries Test Suite ===\n');

  // Setup Shared Components
  const tokenVerifier = new MockTokenVerifier();
  const contactRegistry = new InMemoryTrustedContactRegistry();
  const requestRepo = new DevelopmentInMemoryApprovalRequestRepository();
  const approvalService = new ApprovalService({
    repository: requestRepo,
    contactRegistry,
  });

  const policyRepo = new InMemoryPolicyRepository();
  const policyService = new PolicyService({
    policyRepository: policyRepo,
    contactRegistry,
  });

  const router = new ApprovalApiRouter(approvalService, tokenVerifier, {
    policyService,
    allowedOrigins: ['chrome-extension://guardrail-extension-id', 'http://localhost:3000'],
  });

  // Identities & Tokens
  const ALICE_TOKEN = 'token_alice_ward';
  const BOB_TOKEN = 'token_bob_other_ward';
  const CAROL_TOKEN = 'token_carol_trusted_contact';
  const DAVE_TOKEN = 'token_dave_revoked_contact';
  const EVE_TOKEN = 'token_eve_pending_contact';
  const ADMIN_TOKEN = 'token_admin';

  tokenVerifier.registerToken(ALICE_TOKEN, {
    actorId: 'usr_alice',
    role: ActorRole.USER,
    isAuthenticated: true,
  });

  tokenVerifier.registerToken(BOB_TOKEN, {
    actorId: 'usr_bob',
    role: ActorRole.USER,
    isAuthenticated: true,
  });

  tokenVerifier.registerToken(CAROL_TOKEN, {
    actorId: 'tc_carol',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });

  tokenVerifier.registerToken(DAVE_TOKEN, {
    actorId: 'tc_dave',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });

  tokenVerifier.registerToken(EVE_TOKEN, {
    actorId: 'tc_eve',
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  });

  tokenVerifier.registerToken(ADMIN_TOKEN, {
    actorId: 'admin_sys',
    role: ActorRole.ADMIN,
    isAuthenticated: true,
  });

  // Seed Relationships:
  // 1. Carol is an ACTIVE trusted contact for Alice
  contactRegistry.addContact({
    id: 'tc_carol',
    contactId: 'tc_carol',
    userId: 'usr_alice',
    wardId: 'usr_alice',
    relationshipLabel: 'Guardian',
    status: TrustedContactStatus.ACTIVE,
    createdAt: new Date().toISOString(),
  });

  // 2. Dave was added and then REVOKED
  contactRegistry.addContact({
    id: 'tc_dave',
    contactId: 'tc_dave',
    userId: 'usr_alice',
    wardId: 'usr_alice',
    relationshipLabel: 'Former Guardian',
    status: TrustedContactStatus.ACTIVE,
    createdAt: new Date().toISOString(),
  });
  contactRegistry.revokeTrustedContact('tc_dave', 'usr_alice');

  // 3. Eve has a PENDING invitation, not active
  contactRegistry.addContact({
    id: 'tc_eve',
    contactId: 'tc_eve',
    userId: 'usr_alice',
    wardId: 'usr_alice',
    relationshipLabel: 'Pending Contact',
    status: TrustedContactStatus.PENDING_INVITE,
    createdAt: new Date().toISOString(),
  });

  const jsonHeaders = (token?: string) => ({
    'origin': 'http://localhost:3000',
    'content-type': 'application/json',
    ...(token ? { 'authorization': `Bearer ${token}` } : {}),
  });

  // ===========================================================================
  // 1. Authority Matrix Specifications
  // ===========================================================================
  console.log('▶ Group 1: Policy Setting Authority Matrix Specifications');
  assert(
    POLICY_SETTING_AUTHORITY_MATRIX.thresholds.authority === PolicySettingAuthority.WARD_EXCLUSIVE,
    'Numeric thresholds are categorized as WARD_EXCLUSIVE'
  );
  assert(
    POLICY_SETTING_AUTHORITY_MATRIX.thresholds.wardEditable === true,
    'Numeric thresholds are ward editable'
  );
  assert(
    POLICY_SETTING_AUTHORITY_MATRIX.thresholds.contactViewable === false,
    'Numeric internal thresholds are strictly redacted from trusted contacts'
  );
  assert(
    POLICY_SETTING_AUTHORITY_MATRIX.trustedDomains.authority === PolicySettingAuthority.WARD_EXCLUSIVE,
    'Trusted domain allowlist is categorized as WARD_EXCLUSIVE'
  );
  assert(
    POLICY_SETTING_AUTHORITY_MATRIX.trustedDomains.contactViewable === false,
    'Trusted domain allowlist is strictly redacted from trusted contacts'
  );
  assert(
    POLICY_SETTING_AUTHORITY_MATRIX.destructiveActionProtection.authority === PolicySettingAuthority.IMMUTABLE_SYSTEM_INVARIANT,
    'Destructive action protection is categorized as IMMUTABLE_SYSTEM_INVARIANT'
  );
  assert(
    POLICY_SETTING_AUTHORITY_MATRIX.destructiveActionProtection.wardEditable === false,
    'Destructive action protection cannot be disabled or altered by ward'
  );
  assert(
    determineSensitivityPreset(DEFAULT_GUARDRAIL_POLICY_CONFIG) === 'balanced',
    'Default configuration maps to "balanced" preset'
  );

  // ===========================================================================
  // 2. Unauthorized Updates & Separation of Duties
  // ===========================================================================
  console.log('\n▶ Group 2: Unauthorized Policy Modification Prevention');

  // 2.1 Active Trusted Contact cannot administer policy
  const updateCandidate: GuardrailPolicyConfig = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    policyVersion: '1.1.0',
    thresholds: { lowMax: 20, mediumMax: 45, highMax: 70 },
  };

  const contactUpdateRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(CAROL_TOKEN),
    body: { config: updateCandidate },
  });
  assert(contactUpdateRes.statusCode === 403, 'Active trusted contact is rejected with 403 Forbidden on policy update');
  assert(
    (contactUpdateRes.body as any).error?.code === 'POLICY_ADMINISTRATION_DENIED',
    'Error code is POLICY_ADMINISTRATION_DENIED'
  );
  assert(
    String((contactUpdateRes.body as any).error?.message).includes('zero policy administration authority'),
    'Error message states trusted contacts hold zero policy administration authority'
  );

  // 2.2 System Admin cannot override ward policy sovereignty
  const adminUpdateRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(ADMIN_TOKEN),
    body: { config: updateCandidate },
  });
  assert(adminUpdateRes.statusCode === 403, 'Administrator is rejected with 403 Forbidden on policy update');
  assert(
    (adminUpdateRes.body as any).error?.code === 'POLICY_ADMINISTRATION_DENIED',
    'Admin override emits POLICY_ADMINISTRATION_DENIED'
  );

  // 2.3 Unauthenticated request is rejected
  const unauthRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(),
    body: { config: updateCandidate },
  });
  assert(unauthRes.statusCode === 401, 'Unauthenticated request is rejected with 401 Unauthorized');

  // ===========================================================================
  // 3. Cross-User Isolation & Anti-Enumeration
  // ===========================================================================
  console.log('\n▶ Group 3: Cross-User Isolation & Anti-Enumeration');

  // 3.1 Bob attempts to update Alice's policy
  const crossUpdateRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(BOB_TOKEN),
    body: { config: updateCandidate },
  });
  assert(crossUpdateRes.statusCode === 404, 'Cross-user policy update attempt returns opaque 404 Not Found');
  assert(
    (crossUpdateRes.body as any).error?.code === 'NOT_FOUND_OR_DENIED',
    'Cross-user update emits NOT_FOUND_OR_DENIED (no user existence leak)'
  );

  // 3.2 Bob attempts to view Alice's policy
  const crossGetRes = await router.dispatch({
    method: 'GET',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(BOB_TOKEN),
  });
  assert(crossGetRes.statusCode === 404, 'Cross-user policy view attempt returns opaque 404 Not Found');
  assert(
    (crossGetRes.body as any).error?.code === 'NOT_FOUND_OR_DENIED',
    'Cross-user view emits NOT_FOUND_OR_DENIED'
  );

  // 3.3 Bob attempts to view Alice's policy audit history
  const crossAuditRes = await router.dispatch({
    method: 'GET',
    url: '/api/v1/users/usr_alice/policy/audit',
    headers: jsonHeaders(BOB_TOKEN),
  });
  assert(crossAuditRes.statusCode === 404, 'Cross-user policy audit view returns opaque 404 Not Found');

  // ===========================================================================
  // 4. Active Trusted Contact Read Visibility & Data Scrubbing
  // ===========================================================================
  console.log('\n▶ Group 4: Active Trusted Contact Read-Only Visibility & Data Scrubbing');

  const contactViewRes = await router.dispatch({
    method: 'GET',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(CAROL_TOKEN),
  });
  assert(contactViewRes.statusCode === 200, 'Active trusted contact successfully views policy summary with 200 OK');
  const viewData = (contactViewRes.body as any).data;
  assert(viewData.viewType === 'TRUSTED_CONTACT_SUMMARY', 'View type is TRUSTED_CONTACT_SUMMARY');
  assert(viewData.isOwner === false, 'isOwner is false for trusted contact');
  assert(viewData.canAdminister === false, 'canAdminister is false for trusted contact');
  assert(viewData.summary.overallStatus === 'ACTIVE', 'Overall status is ACTIVE');
  assert(viewData.summary.sensitivityPreset === 'balanced', 'Sensitivity preset is balanced');
  assert(viewData.summary.stagingModeEnabled === true, 'Staging mode is enabled');
  assert(viewData.summary.categoryProtections.destructiveActions === 'PROTECT', 'Destructive actions is PROTECT');
  assert(viewData.summary.relationship.status === 'ACTIVE', 'Relationship is verified ACTIVE');
  assert(viewData.summary.relationship.contactId === 'tc_carol', 'Contact ID matches actor');

  // Verify privacy scrubbing: private allowlist and detection signal weights must NOT exist
  assert(viewData.summary.trustedDomains === undefined, 'Private trustedDomains allowlist is strictly omitted');
  assert(viewData.summary.signals === undefined, 'Internal risk signals are strictly omitted');
  assert(viewData.summary.thresholds === undefined, 'Raw numeric thresholds are strictly omitted');

  // ===========================================================================
  // 5. Revoked & Pending Trusted Contact Relationships
  // ===========================================================================
  console.log('\n▶ Group 5: Revoked & Pending Trusted Contact Access Handling');

  // 5.1 Revoked contact Dave attempts to view Alice's policy
  const revokedViewRes = await router.dispatch({
    method: 'GET',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(DAVE_TOKEN),
  });
  assert(revokedViewRes.statusCode === 404, 'Revoked contact is immediately denied with opaque 404');
  assert(
    (revokedViewRes.body as any).error?.code === 'NOT_FOUND_OR_DENIED',
    'Revoked contact receives NOT_FOUND_OR_DENIED'
  );

  // 5.2 Pending contact Eve attempts to view Alice's policy
  const pendingViewRes = await router.dispatch({
    method: 'GET',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(EVE_TOKEN),
  });
  assert(pendingViewRes.statusCode === 404, 'Pending contact is denied with opaque 404');
  assert(
    (pendingViewRes.body as any).error?.code === 'NOT_FOUND_OR_DENIED',
    'Pending contact receives NOT_FOUND_OR_DENIED'
  );

  // ===========================================================================
  // 6. Ward Sovereign Administration & Valid Updates
  // ===========================================================================
  console.log('\n▶ Group 6: Ward Sovereign Policy Administration');

  // 6.1 Alice views her full policy configuration
  const aliceInitialView = await router.dispatch({
    method: 'GET',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(ALICE_TOKEN),
  });
  assert(aliceInitialView.statusCode === 200, 'Ward retrieves own policy configuration with 200 OK');
  const aliceData = (aliceInitialView.body as any).data;
  assert(aliceData.viewType === 'WARD_FULL_POLICY', 'View type is WARD_FULL_POLICY');
  assert(aliceData.isOwner === true, 'isOwner is true');
  assert(aliceData.canAdminister === true, 'canAdminister is true');
  assert(Array.isArray(aliceData.config.trustedDomains), 'Ward configuration contains full trustedDomains array');
  assert(typeof aliceData.config.thresholds === 'object', 'Ward configuration contains thresholds');

  // 6.2 Alice updates her policy with valid changes
  const validCandidate: GuardrailPolicyConfig = {
    ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
    policyVersion: '1.1.0',
    thresholds: { lowMax: 20, mediumMax: 45, highMax: 70 },
    trustedDomains: ['my-bank.example.com', 'internal.work.com'],
  };

  const aliceUpdateRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(ALICE_TOKEN),
    body: {
      config: validCandidate,
      expectedPolicyVersion: '1.0.0',
      changeReason: 'Adjusted low/medium thresholds for tighter sensitivity.',
    },
  });
  if (aliceUpdateRes.statusCode !== 200) {
    console.error('aliceUpdateRes failed:', aliceUpdateRes.statusCode, JSON.stringify(aliceUpdateRes.body));
  }
  assert(aliceUpdateRes.statusCode === 200, 'Ward successfully updates policy with 200 OK');
  const updatedPolicy = (aliceUpdateRes.body as any).data;
  assert(updatedPolicy.policyVersion === '1.1.0', 'Updated policy version is 1.1.0');
  assert(updatedPolicy.updatedBy === 'usr_alice', 'updatedBy is authoritative actor usr_alice');
  assert(updatedPolicy.config.thresholds.lowMax === 20, 'lowMax threshold updated to 20');
  assert(updatedPolicy.config.trustedDomains.length === 2, 'trustedDomains updated to 2 entries');

  // ===========================================================================
  // 7. Mandatory Security Invariant Enforcement on Update
  // ===========================================================================
  console.log('\n▶ Group 7: Mandatory Security Invariant Enforcement on Update');

  // 7.1 Attempting to disable CONTROLLED_DESTRUCTIVE
  const disabledDestructiveCandidate: GuardrailPolicyConfig = {
    ...validCandidate,
    policyVersion: '1.2.0',
    policies: validCandidate.policies.map((p) =>
      p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE ? { ...p, enabled: false } : p
    ),
  };
  const disableDestructiveRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(ALICE_TOKEN),
    body: { config: disabledDestructiveCandidate },
  });
  assert(disableDestructiveRes.statusCode === 400, 'Attempt to disable CONTROLLED_DESTRUCTIVE rejected with 400');
  assert(
    (disableDestructiveRes.body as any).error?.code === 'MANDATORY_INVARIANT_VIOLATION' ||
    (disableDestructiveRes.body as any).error?.code === 'INVALID_POLICY_CONFIG',
    'Emits invariant violation error code'
  );

  // 7.2 Attempting to downgrade CONTROLLED_DESTRUCTIVE to ALLOW
  const allowDestructiveCandidate: GuardrailPolicyConfig = {
    ...validCandidate,
    policyVersion: '1.2.0',
    policies: validCandidate.policies.map((p) =>
      p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE ? { ...p, decision: ResponseAction.ALLOW } : p
    ),
  };
  const allowDestructiveRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(ALICE_TOKEN),
    body: { config: allowDestructiveCandidate },
  });
  assert(allowDestructiveRes.statusCode === 400, 'Attempt to downgrade CONTROLLED_DESTRUCTIVE to ALLOW rejected with 400');

  // 7.3 Attempting to downgrade UNSUPPORTED_BOUNDARY_GUARD
  const allowBoundaryCandidate: GuardrailPolicyConfig = {
    ...validCandidate,
    policyVersion: '1.2.0',
    policies: validCandidate.policies.map((p) =>
      p.id === RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD ? { ...p, decision: ResponseAction.ALLOW } : p
    ),
  };
  const allowBoundaryRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(ALICE_TOKEN),
    body: { config: allowBoundaryCandidate },
  });
  assert(allowBoundaryRes.statusCode === 400, 'Attempt to downgrade UNSUPPORTED_BOUNDARY_GUARD rejected with 400');

  // ===========================================================================
  // 8. Optimistic Concurrency Control (OCC) & Stale Request Prevention
  // ===========================================================================
  console.log('\n▶ Group 8: Optimistic Concurrency Control & Stale Update Rejection');

  // Active version is currently 1.1.0
  // 8.1 Attempting to submit an update with stale expectedPolicyVersion: '1.0.0'
  const staleExpectedRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(ALICE_TOKEN),
    body: {
      config: { ...validCandidate, policyVersion: '1.2.0' },
      expectedPolicyVersion: '1.0.0', // Stale!
    },
  });
  assert(staleExpectedRes.statusCode === 409, 'Stale expectedPolicyVersion rejected with 409 Conflict');
  assert(
    (staleExpectedRes.body as any).error?.code === 'POLICY_VERSION_CONFLICT',
    'Error code is POLICY_VERSION_CONFLICT'
  );
  assert(
    String((staleExpectedRes.body as any).error?.message).includes('Expected version "1.0.0" does not match'),
    'Error message describes version mismatch'
  );

  // 8.2 Attempting update without expectedPolicyVersion and without bumping version (stale version 1.1.0)
  const duplicateVersionRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(ALICE_TOKEN),
    body: {
      config: { ...validCandidate, policyVersion: '1.1.0' }, // Same version!
    },
  });
  assert(duplicateVersionRes.statusCode === 409, 'Unbumped policy version rejected with 409 Conflict');

  // 8.3 Valid update with correct expected version
  const freshUpdateRes = await router.dispatch({
    method: 'PUT',
    url: '/api/v1/users/usr_alice/policy',
    headers: jsonHeaders(ALICE_TOKEN),
    body: {
      config: { ...validCandidate, policyVersion: '1.2.0' },
      expectedPolicyVersion: '1.1.0',
      changeReason: 'Second authorized iteration.',
    },
  });
  assert(freshUpdateRes.statusCode === 200, 'Update with matched expectedPolicyVersion succeeds with 200 OK');
  assert((freshUpdateRes.body as any).data.policyVersion === '1.2.0', 'Policy version is now 1.2.0');

  // ===========================================================================
  // 9. Non-Sensitive Audit Trail Logging
  // ===========================================================================
  console.log('\n▶ Group 9: Non-Sensitive Policy Audit Trail Logging');

  // 9.1 Alice views her audit log
  const auditRes = await router.dispatch({
    method: 'GET',
    url: '/api/v1/users/usr_alice/policy/audit',
    headers: jsonHeaders(ALICE_TOKEN),
  });
  assert(auditRes.statusCode === 200, 'Ward retrieves audit history with 200 OK');
  const auditLogs = (auditRes.body as any).data as any[];
  assert(Array.isArray(auditLogs) && auditLogs.length >= 2, 'Audit log has recorded both updates');

  const latestAudit = auditLogs[0];
  assert(latestAudit.newPolicyVersion === '1.2.0', 'Latest audit newPolicyVersion is 1.2.0');
  assert(latestAudit.previousPolicyVersion === '1.1.0', 'Latest audit previousPolicyVersion is 1.1.0');
  assert(latestAudit.updatedBy === 'usr_alice', 'Audit tracks updatedBy actor');
  assert(typeof latestAudit.timestamp === 'string', 'Audit has ISO timestamp');
  assert(Array.isArray(latestAudit.changedFields), 'Audit tracks changedFields array');

  // Verify audit records contain zero credentials
  const auditJson = JSON.stringify(latestAudit);
  assert(!auditJson.includes('password'), 'Audit record has no password');
  assert(!auditJson.includes('token'), 'Audit record has no token');
  assert(!auditJson.includes('secret'), 'Audit record has no secret');

  // 9.2 Trusted contact Carol cannot view audit log
  const contactAuditRes = await router.dispatch({
    method: 'GET',
    url: '/api/v1/users/usr_alice/policy/audit',
    headers: jsonHeaders(CAROL_TOKEN),
  });
  assert(contactAuditRes.statusCode === 403, 'Trusted contact cannot inspect policy audit history (403)');
  assert(
    (contactAuditRes.body as any).error?.code === 'POLICY_ADMINISTRATION_DENIED',
    'Audit inspection denied with POLICY_ADMINISTRATION_DENIED'
  );

  // ===========================================================================
  // 10. Canonical Policy Reset
  // ===========================================================================
  console.log('\n▶ Group 10: Canonical Policy Reset');

  const resetRes = await router.dispatch({
    method: 'POST',
    url: '/api/v1/users/usr_alice/policy/reset',
    headers: jsonHeaders(ALICE_TOKEN),
  });
  assert(resetRes.statusCode === 200, 'Ward resets policy to canonical defaults with 200 OK');
  const resetConfig = (resetRes.body as any).data.config as GuardrailPolicyConfig;
  assert(resetConfig.thresholds.lowMax === 24, 'lowMax restored to default 24');
  assert(resetConfig.thresholds.mediumMax === 49, 'mediumMax restored to default 49');
  assert(resetConfig.thresholds.highMax === 74, 'highMax restored to default 74');

  // Verify that reset created a new audit log
  const afterResetAuditRes = await router.dispatch({
    method: 'GET',
    url: '/api/v1/users/usr_alice/policy/audit',
    headers: jsonHeaders(ALICE_TOKEN),
  });
  const afterResetLogs = (afterResetAuditRes.body as any).data as any[];
  assert(afterResetLogs[0].changeSummary.includes('Reset to canonical default'), 'Reset logged in audit history');

  console.log('\n======================================================================');
  console.log('Results: All 40 permission boundary assertions PASSED cleanly!');
  console.log('======================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n❌ Test suite failed with error:\n', err);
  process.exit(1);
});
