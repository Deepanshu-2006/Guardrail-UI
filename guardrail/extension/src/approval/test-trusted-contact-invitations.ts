/**
 * Guardrail Trusted Contact Setup, Invitations & Relationship Lifecycle Test Suite
 *
 * Comprehensive verification of:
 * 1. Invitation code generation & validation (out-of-band Crockford base32 codes).
 * 2. Ward creating invitations with configurable TTL and relationship labels.
 * 3. Contact accepting invitations to establish active trusted-contact relationships.
 * 4. Error states: invalid format, non-existent code, expired code, revoked code, duplicate accepted.
 * 5. Separation of Duties: Prohibiting self-invitation / self-governance (403).
 * 6. Multi-tenant isolation & anti-enumeration: unowned invitations return opaque 404s.
 * 7. Unconfigured ward orphan prevention: preventing approval requests without active contacts (422).
 * 8. Contact revocation and immediate termination of approval authority.
 * 9. HTTP API dispatch integration (all 7 REST endpoints with Bearer auth).
 * 10. ApprovalApiClient SDK integration.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import { ActionCategory, ActionType } from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import {
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import {
  ActorRole,
  AuthContext,
  ApprovalAccessDeniedError,
  ApprovalAuthorizationService,
  CreateInvitationOptions,
  DuplicateContactRelationshipError,
  generateInvitationCode,
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRevokedError,
  InvitationStatus,
  NoActiveTrustedContactError,
  SelfApprovalProhibitedError,
  SelfInvitationProhibitedError,
  TrustedContactStatus,
  UnauthenticatedError,
  validateInvitationCode,
  validateRelationshipLabel,
} from './authorization.js';
import {
  ApprovalService,
  ApprovalServiceDependencies,
} from './service.js';
import {
  ApprovalApiRouter,
  HttpHeaderMap,
  HttpRequest,
  HttpResponse,
} from './api.js';
import {
  ApprovalApiClient,
  ApiClientErrorCodes,
} from './client.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  ✓ ${message}`);
}

async function assertRejects(
  fn: () => Promise<unknown>,
  expectedErrorClass: unknown,
  message: string
): Promise<void> {
  totalTests++;
  try {
    await fn();
    console.error(`  ❌ FAILED: ${message} (expected error was not thrown)`);
    throw new Error(`Expected error not thrown: ${message}`);
  } catch (err: unknown) {
    if (typeof expectedErrorClass === 'function' && !(err instanceof (expectedErrorClass as any))) {
      console.error(
        `  ❌ FAILED: ${message} (expected ${(expectedErrorClass as any).name}, received ${
          (err as any)?.constructor?.name || typeof err
        }: ${(err as any)?.message})`
      );
      throw err;
    }
    passedTests++;
    console.log(`  ✓ ${message}`);
  }
}

console.log('====================================================================');
console.log('🧪 GUARDRAIL TRUSTED CONTACT SETUP & INVITATIONS TEST SUITE');
console.log('====================================================================\n');

// =============================================================================
// Scenario 1: Invitation Code Generation & Format Validation
// =============================================================================
console.log('▶ Scenario 1: Invitation Code Generation & Format Validation');

const code1 = generateInvitationCode();
const code2 = generateInvitationCode();
assert(typeof code1 === 'string' && code1.startsWith('GR-INV-'), 'Code begins with GR-INV- prefix');
assert(code1 !== code2, 'Subsequent generated codes are distinct');
assert(validateInvitationCode(code1).valid, 'Generated code passes validateInvitationCode');
assert(validateInvitationCode('GR-INV-A1B2-C3D4').valid, 'Valid GR-INV-A1B2-C3D4 is accepted');
assert(validateInvitationCode('INV-TESTCODE').valid, 'Valid INV-TESTCODE is accepted');

// Invalid codes
assert(!validateInvitationCode('').valid, 'Empty string is rejected');
assert(!validateInvitationCode('12345').valid, 'Code without prefix is rejected');
assert(!validateInvitationCode('GR-INV-SHORT').valid, 'Malformed GR-INV code is rejected');
assert(!validateInvitationCode('GR-INV-1234-567$').valid, 'Code with invalid symbols is rejected');

// Relationship labels
assert(validateRelationshipLabel(undefined).valid, 'Undefined relationship label is allowed');
assert(validateRelationshipLabel('Family Member').valid, 'Normal label "Family Member" is valid');
assert(validateRelationshipLabel('Primary Guardian').valid, 'Normal label "Primary Guardian" is valid');
assert(!validateRelationshipLabel('A'.repeat(65)).valid, 'Label exceeding 64 chars is rejected');
assert(!validateRelationshipLabel('Family\x00Member').valid, 'Label with control characters is rejected');

// =============================================================================
// Scenario 2: Ward Creates Out-of-Band Invitation
// =============================================================================
console.log('\n▶ Scenario 2: Ward Creates Out-of-Band Invitation');

const registry = new InMemoryTrustedContactRegistry();
const authService = new ApprovalAuthorizationService({ trustedContactRegistry: registry });

const inv1 = registry.createInvitation('usr_alice', {
  relationshipLabel: 'Caregiver',
  ttlMs: 3600000, // 1 hour
});

assert(inv1.id.startsWith('inv_'), 'Invitation ID starts with inv_');
assert(inv1.wardId === 'usr_alice', 'Invitation wardId is usr_alice');
assert(inv1.userId === 'usr_alice', 'Invitation userId is usr_alice');
assert(inv1.status === InvitationStatus.PENDING, 'Invitation status is initially PENDING');
assert(inv1.relationshipLabel === 'Caregiver', 'Relationship label persisted');
assert(Date.parse(inv1.expiresAt) > Date.now(), 'Expiration is in the future');

const fetchedByCode = registry.getInvitationByCode(inv1.code);
assert(fetchedByCode !== null && fetchedByCode.id === inv1.id, 'Can lookup invitation by pairing code');

const fetchedById = registry.getInvitationById(inv1.id);
assert(fetchedById !== null && fetchedById.code === inv1.code, 'Can lookup invitation by ID');

const wardInvs = registry.listInvitationsForUser('usr_alice');
assert(wardInvs.length === 1 && wardInvs[0].id === inv1.id, 'Ward can list their issued invitations');

// =============================================================================
// Scenario 3: Contact Accepts Invitation & Establishes Relationship
// =============================================================================
console.log('\n▶ Scenario 3: Contact Accepts Invitation & Establishes Relationship');

assert(!registry.hasActiveTrustedContact('usr_alice'), 'Alice has no active contacts before acceptance');
assert(!registry.isTrustedContactForUser('usr_bob', 'usr_alice'), 'Bob is not a trusted contact for Alice yet');

const accepted = registry.acceptInvitation(inv1.code, 'usr_bob');
assert(accepted.invitation.status === InvitationStatus.ACCEPTED, 'Invitation status transitions to ACCEPTED');
assert(accepted.invitation.acceptedByContactId === 'usr_bob', 'Accepted by contact recorded as Bob');
assert(accepted.contact.wardId === 'usr_alice', 'Contact wardId is Alice');
assert(accepted.contact.contactId === 'usr_bob', 'Contact contactId is Bob');
assert(accepted.contact.status === TrustedContactStatus.ACTIVE, 'Contact status is ACTIVE');

assert(registry.hasActiveTrustedContact('usr_alice'), 'Alice now has an active trusted contact');
assert(registry.isTrustedContactForUser('usr_bob', 'usr_alice'), 'Bob is now recognized as active trusted contact for Alice');

const aliceContacts = registry.getTrustedContactsForUser('usr_alice');
assert(aliceContacts.length === 1 && (aliceContacts[0].contactId === 'usr_bob' || aliceContacts[0].id === 'usr_bob'), 'Alice contacts list contains Bob');

// =============================================================================
// Scenario 4: Error Handling on Acceptance (Invalid, Expired, Revoked, Duplicate)
// =============================================================================
console.log('\n▶ Scenario 4: Error Handling on Acceptance');

// 1. Non-existent code
assertRejects(
  async () => registry.acceptInvitation('GR-INV-0000-0000', 'usr_carol'),
  InvitationNotFoundError,
  'Non-existent code throws InvitationNotFoundError (404)'
);

// 2. Already accepted code
assertRejects(
  async () => registry.acceptInvitation(inv1.code, 'usr_carol'),
  InvitationAlreadyAcceptedError,
  'Already accepted invitation throws InvitationAlreadyAcceptedError (409)'
);

// 3. Expired code
const expiredInv = registry.createInvitation('usr_alice', { ttlMs: -1000 });
assertRejects(
  async () => registry.acceptInvitation(expiredInv.code, 'usr_carol'),
  InvitationExpiredError,
  'Expired invitation throws InvitationExpiredError (410)'
);

// 4. Revoked code
const revokedInv = registry.createInvitation('usr_alice', { ttlMs: 3600000 });
registry.revokeInvitation(revokedInv.id, 'usr_alice');
assertRejects(
  async () => registry.acceptInvitation(revokedInv.code, 'usr_carol'),
  InvitationRevokedError,
  'Revoked invitation throws InvitationRevokedError (410)'
);

// 5. Duplicate active relationship
const dupInv = registry.createInvitation('usr_alice', { ttlMs: 3600000 });
assertRejects(
  async () => registry.acceptInvitation(dupInv.code, 'usr_bob'),
  DuplicateContactRelationshipError,
  'Duplicate active contact relationship throws DuplicateContactRelationshipError (409)'
);

// =============================================================================
// Scenario 5: Separation of Duties & Self-Invitation Prohibited
// =============================================================================
console.log('\n▶ Scenario 5: Separation of Duties & Self-Invitation Prohibited');

const selfInv = registry.createInvitation('usr_david', { ttlMs: 3600000 });
assertRejects(
  async () => registry.acceptInvitation(selfInv.code, 'usr_david'),
  SelfInvitationProhibitedError,
  'Accepting self invitation throws SelfInvitationProhibitedError (403)'
);

// =============================================================================
// Scenario 6: Multi-Tenant Isolation & Anti-Enumeration
// =============================================================================
console.log('\n▶ Scenario 6: Multi-Tenant Isolation & Anti-Enumeration');

const service = new ApprovalService({
  contactRegistry: registry,
  enforceActiveContact: true,
});

const eveAuth: AuthContext = {
  actorId: 'usr_eve',
  role: ActorRole.USER,
  isAuthenticated: true,
};

const aliceAuth: AuthContext = {
  actorId: 'usr_alice',
  role: ActorRole.USER,
  isAuthenticated: true,
};

// Eve attempts to revoke Alice's invitation -> 404 (anti-enumeration)
assertRejects(
  async () => service.revokeInvitation(inv1.id, eveAuth),
  InvitationNotFoundError,
  'Unauthorized actor attempting to revoke invitation receives 404 (anti-enumeration)'
);

// Eve listing invitations only sees their own (0 invitations)
const eveInvs = service.listInvitationsForUser(eveAuth);
assert(eveInvs.length === 0, 'Eve sees 0 invitations created by Alice (multi-tenant isolation)');

// =============================================================================
// Scenario 7: Unconfigured Ward Orphan Prevention
// =============================================================================
console.log('\n▶ Scenario 7: Unconfigured Ward Orphan Prevention');

const newWardAuth: AuthContext = {
  actorId: 'usr_unconfigured',
  role: ActorRole.USER,
  isAuthenticated: true,
};

const actionPayload: ClientApprovalRequestPayload = {
  actionId: 'act_wire_transfer_001',
  actionType: ActionType.SUBMIT,
  category: ActionCategory.FINANCIAL,
  actionDescription: 'Send $500 via bank wire',
  riskLevel: RiskLevel.HIGH,
  targetUrl: 'https://bank.example.com/transfer',
  targetOrigin: 'https://bank.example.com',
};

// Creating request for unconfigured ward without active contact must be rejected (422)
assertRejects(
  async () =>
    service.createRequest(actionPayload, newWardAuth, {
      requireActiveContact: true,
    }),
  NoActiveTrustedContactError,
  'Approval request creation rejected with NoActiveTrustedContactError (422) when ward has 0 contacts'
);

// Now pair a trusted contact for usr_unconfigured
const pairInv = service.createInvitation(newWardAuth, {
  relationshipLabel: 'Sibling',
});
const contactAuth: AuthContext = {
  actorId: 'usr_sibling',
  role: ActorRole.TRUSTED_CONTACT,
  isAuthenticated: true,
};
service.acceptInvitation(pairInv.code, contactAuth);

// Now creating request succeeds!
const createdReq = await service.createRequest(actionPayload, newWardAuth, {
  requireActiveContact: true,
});
assert(createdReq.id.startsWith('apr_'), 'Request created successfully once trusted contact is paired');
assert(createdReq.status === ApprovalStatus.PENDING, 'Request status is PENDING');

// =============================================================================
// Scenario 8: Contact Revocation & Immediate Authority Termination
// =============================================================================
console.log('\n▶ Scenario 8: Contact Revocation & Immediate Authority Termination');

assert(registry.isTrustedContactForUser('usr_sibling', 'usr_unconfigured'), 'Sibling is currently trusted contact');

// Revoke contact
const successRevoke = service.revokeTrustedContact('usr_sibling', newWardAuth);
assert(successRevoke === true, 'revokeTrustedContact returns true');
assert(!registry.isTrustedContactForUser('usr_sibling', 'usr_unconfigured'), 'Sibling immediately loses contact authority');

// Sibling attempting to decide createdReq is rejected (403)
assertRejects(
  async () =>
    service.approveRequest(createdReq.id, undefined, contactAuth),
  ApprovalAccessDeniedError,
  'Revoked contact is forbidden from approving requests (403)'
);

// Subsequent request creation without active contacts is blocked again
assertRejects(
  async () =>
    service.createRequest(
      { ...actionPayload, actionId: 'act_wire_transfer_002' },
      newWardAuth,
      { requireActiveContact: true }
    ),
  NoActiveTrustedContactError,
  'Subsequent request blocked after contact revocation leaves ward with 0 contacts'
);

// =============================================================================
// Scenario 9: HTTP API Dispatch Integration
// =============================================================================
console.log('\n▶ Scenario 9: HTTP API Dispatch Integration');

const apiRouter = new ApprovalApiRouter(service, {
  verifyToken: async (token: string): Promise<AuthContext | null> => {
    if (token === 'alice_token') return { actorId: 'usr_alice', role: ActorRole.USER, isAuthenticated: true };
    if (token === 'bob_token') return { actorId: 'usr_bob', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };
    if (token === 'charlie_token') return { actorId: 'usr_charlie', role: ActorRole.TRUSTED_CONTACT, isAuthenticated: true };
    if (token === 'eve_token') return { actorId: 'usr_eve', role: ActorRole.USER, isAuthenticated: true };
    return null;
  },
});

// 1. POST /api/v1/invitations (Alice creates invitation)
const postInvRes = await apiRouter.dispatch({
  method: 'POST',
  url: '/api/v1/invitations',
  headers: { authorization: 'Bearer alice_token', 'content-type': 'application/json' },
  body: { relationshipLabel: 'Accountant', ttlMs: 86400000 },
});
assert(postInvRes.statusCode === 201, 'POST /api/v1/invitations returns 201');
assert(postInvRes.body.success === true, 'Response body success is true');
const createdApiInv = postInvRes.body.data;
assert(createdApiInv.wardId === 'usr_alice', 'API created invitation has wardId usr_alice');
assert(createdApiInv.code.startsWith('GR-INV-'), 'API created invitation has valid code format');

// 2. GET /api/v1/invitations (Alice lists invitations)
const listInvsRes = await apiRouter.dispatch({
  method: 'GET',
  url: '/api/v1/invitations',
  headers: { authorization: 'Bearer alice_token' },
});
assert(listInvsRes.statusCode === 200, 'GET /api/v1/invitations returns 200');
assert(Array.isArray(listInvsRes.body.data), 'GET /api/v1/invitations returns array');
assert(listInvsRes.body.data.some((inv: any) => inv.id === createdApiInv.id), 'Created invitation is in list');

// 3. GET /api/v1/invitations/:identifier (Charlie inspects invitation)
const inspectRes = await apiRouter.dispatch({
  method: 'GET',
  url: `/api/v1/invitations/${createdApiInv.code}`,
  headers: { authorization: 'Bearer charlie_token' },
});
assert(inspectRes.statusCode === 200, 'GET /api/v1/invitations/:code returns 200');
assert(inspectRes.body.data.code === createdApiInv.code, 'Inspect returns correct invitation');

// 4. POST /api/v1/invitations/:code/accept (Charlie accepts)
const acceptRes = await apiRouter.dispatch({
  method: 'POST',
  url: `/api/v1/invitations/${createdApiInv.code}/accept`,
  headers: { authorization: 'Bearer charlie_token', 'content-type': 'application/json' },
  body: {},
});
assert(acceptRes.statusCode === 200, 'POST /api/v1/invitations/:code/accept returns 200');
assert(acceptRes.body.data.invitation.status === 'ACCEPTED', 'Accepted invitation status is ACCEPTED');
assert(acceptRes.body.data.contact.contactId === 'usr_charlie' || acceptRes.body.data.contact.id === 'usr_charlie', 'Contact ID is charlie');

// 5. GET /api/v1/trusted-contacts (Alice lists contacts)
const listContactsRes = await apiRouter.dispatch({
  method: 'GET',
  url: '/api/v1/trusted-contacts',
  headers: { authorization: 'Bearer alice_token' },
});
assert(listContactsRes.statusCode === 200, 'GET /api/v1/trusted-contacts returns 200');
assert(listContactsRes.body.data.some((c: any) => c.contactId === 'usr_charlie' || c.id === 'usr_charlie'), 'Charlie is in Alice active contacts');

// 6. POST /api/v1/trusted-contacts/:id/revoke (Alice revokes Charlie)
const revokeContactRes = await apiRouter.dispatch({
  method: 'POST',
  url: '/api/v1/trusted-contacts/usr_charlie/revoke',
  headers: { authorization: 'Bearer alice_token', 'content-type': 'application/json' },
  body: {},
});
assert(revokeContactRes.statusCode === 200, 'POST /api/v1/trusted-contacts/:id/revoke returns 200');
assert(revokeContactRes.body.data.revoked === true, 'Charlie was revoked');

// =============================================================================
// Scenario 10: ApprovalApiClient SDK Integration
// =============================================================================
console.log('\n▶ Scenario 10: ApprovalApiClient SDK Integration');

// Custom transport calling apiRouter.dispatch in-memory
const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : input.toString();
  const parsed = new URL(urlStr, 'https://guardrail.local');
  const path = parsed.pathname;
  const method = (init?.method || 'GET') as 'GET' | 'POST';
  const rawHeaders: Record<string, string> = {};
  if (init?.headers) {
    const h = init.headers as Record<string, string>;
    for (const [k, v] of Object.entries(h)) {
      rawHeaders[k.toLowerCase()] = v;
    }
  }
  let bodyObj: unknown = undefined;
  if (init?.body && typeof init.body === 'string') {
    try {
      bodyObj = JSON.parse(init.body);
    } catch {
      bodyObj = {};
    }
  }

  const apiRes = await apiRouter.dispatch({
    method,
    url: path,
    headers: rawHeaders,
    body: bodyObj,
  });

  return new Response(JSON.stringify(apiRes.body), {
    status: apiRes.statusCode,
    headers: { 'content-type': 'application/json' },
  });
};

const apiClient = new ApprovalApiClient({
  baseUrl: 'https://guardrail.local',
  tokenProvider: () => 'alice_token',
  fetchFn: customFetch,
});

// Create invitation via client
const clientInvRes = await apiClient.createInvitation({ relationshipLabel: 'Advisor' });
assert(clientInvRes.success === true, 'apiClient.createInvitation succeeded');
assert(clientInvRes.data.code.startsWith('GR-INV-'), 'Client created invitation code valid');

// List invitations via client
const clientListRes = await apiClient.listInvitations();
assert(clientListRes.success === true, 'apiClient.listInvitations succeeded');
assert(clientListRes.data.length > 0, 'apiClient.listInvitations returned records');

// Inspect invitation via client
const clientGetRes = await apiClient.getInvitation(clientInvRes.data.code);
assert(clientGetRes.success === true, 'apiClient.getInvitation succeeded');
assert(clientGetRes.data.id === clientInvRes.data.id, 'apiClient.getInvitation matched ID');

// Charlie accepts via client
const charlieClient = new ApprovalApiClient({
  baseUrl: 'https://guardrail.local',
  tokenProvider: () => 'charlie_token',
  fetchFn: customFetch,
});

const clientAcceptRes = await charlieClient.acceptInvitation(clientInvRes.data.code);
assert(clientAcceptRes.success === true, 'apiClient.acceptInvitation succeeded');
assert(clientAcceptRes.data.invitation.status === 'ACCEPTED', 'apiClient.acceptInvitation returned ACCEPTED');

// Alice lists contacts via client
const clientContactsRes = await apiClient.listTrustedContacts();
assert(clientContactsRes.success === true, 'apiClient.listTrustedContacts succeeded');
assert(clientContactsRes.data.some((c) => c.contactId === 'usr_charlie' || c.id === 'usr_charlie'), 'Charlie in clientContactsRes');

// Alice revokes Charlie via client
const clientRevokeRes = await apiClient.revokeTrustedContact('usr_charlie');
assert(clientRevokeRes.success === true, 'apiClient.revokeTrustedContact succeeded');
assert(clientRevokeRes.data.revoked === true, 'Charlie was revoked in client response');

console.log('\n====================================================================');
console.log(`📊 TRUSTED CONTACT INVITATIONS TEST SUITE: ${passedTests}/${totalTests} PASSED`);
console.log('🎉 ALL INVITATION & RELATIONSHIP LIFECYCLE REQUIREMENTS SATISFIED!');
console.log('====================================================================\n');
