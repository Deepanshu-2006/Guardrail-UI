/**
 * Guardrail Protection Policy History & Transparency Verification Suite
 *
 * Verifies all 10 requirements and security guarantees for Day 26:
 * 1. Monotonic audit recording with authoritative ISO 8601 timestamps.
 * 2. Actor identification and role tracking (Ward vs System).
 * 3. Before-and-after policy version progression tracking.
 * 4. Explicit distinction between user customizations and system defaults/resets.
 * 5. Authorized display of policy history in the dashboard UI.
 * 6. Non-sensitive practical security impact explanations for all policy settings.
 * 7. Pending synchronization tracking and dashboard indicator.
 * 8. Transparent failure handling with recovery guidance for conflicts, invariant violations, and offline states.
 * 9. Multi-tenant authorization boundaries (401 unauth, 403 contact, 404 anti-enumeration).
 * 10. Privacy-preserving audit logs: Zero passwords, OTPs, card numbers, raw form values, or URLs with query tokens.
 */

// Minimal DOM simulation for Node.js test environment
class MockDOMTokenList {
  private classes: Set<string> = new Set();
  constructor(initial: string = '') {
    if (initial) {
      initial.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    }
  }
  add(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.add(t));
  }
  remove(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.delete(t));
  }
  contains(token: string): boolean {
    return this.classes.has(token);
  }
  toString(): string {
    return Array.from(this.classes).join(' ');
  }
}

class MockDOMElement {
  public tagName: string;
  public id: string = '';
  public attributes: Record<string, string> = {};
  public style: Record<string, string> = {};
  public children: MockDOMElement[] = [];
  public parentNode: MockDOMElement | null = null;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  private _textContent: string = '';
  public classList: MockDOMTokenList;
  public tabIndex: number = 0;
  public href: string = '';
  public type: string = '';
  public disabled: boolean = false;
  public value: string = '';
  public rows: number = 0;
  public placeholder: string = '';
  public htmlFor: string = '';

  get innerHTML(): string {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`).join('');
  }
  set innerHTML(val: string) {
    this.children = [];
    this._textContent = val;
  }

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockDOMTokenList();
  }

  get className(): string {
    return this.classList.toString();
  }
  set className(val: string) {
    this.classList = new MockDOMTokenList(val);
  }

  get textContent(): string {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
  }

  get firstChild(): MockDOMElement | null {
    return this.children[0] || null;
  }

  appendChild<T extends MockDOMElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends MockDOMElement>(child: T): T {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name.toLowerCase()] = String(value);
    if (name.toLowerCase() === 'id') {
      this.id = String(value);
    }
    if (name.toLowerCase() === 'class') {
      this.className = String(value);
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes[name.toLowerCase()] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name.toLowerCase()];
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  }

  dispatchEvent(event: { type: string; defaultPrevented?: boolean; preventDefault?: () => void; [key: string]: any }): boolean {
    if (typeof event.preventDefault !== 'function') {
      event.preventDefault = () => {
        event.defaultPrevented = true;
      };
    }
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) {
      h(event);
    }
    return true;
  }

  click(): void {
    this.dispatchEvent({ type: 'click', defaultPrevented: false });
  }

  focus(): void {
    (globalThis as any).document.activeElement = this;
  }

  private findSimpleMatches(part: string): MockDOMElement[] {
    const matches: MockDOMElement[] = [];
    const search = (node: MockDOMElement) => {
      let isMatch = false;
      if (part.startsWith('#')) {
        isMatch = node.id === part.slice(1);
      } else if (part.startsWith('.')) {
        const classes = part.split('.').filter(Boolean);
        isMatch = classes.every((c) => node.classList.contains(c));
      } else if (part.includes('[') && part.endsWith(']')) {
        const bracketIdx = part.indexOf('[');
        const tag = part.slice(0, bracketIdx);
        const attrContent = part.slice(bracketIdx + 1, -1);
        const tagMatch = !tag || node.tagName.toLowerCase() === tag.toLowerCase();
        let attrMatch = false;
        if (attrContent.includes('=')) {
          const [attrName, rawVal] = attrContent.split('=');
          const expectedVal = rawVal.replace(/^["']|["']$/g, '');
          attrMatch = node.getAttribute(attrName) === expectedVal;
        } else {
          attrMatch = node.getAttribute(attrContent) !== null;
        }
        isMatch = tagMatch && attrMatch;
      } else if (part.includes('.')) {
        const [tag, ...classes] = part.split('.');
        isMatch =
          node.tagName.toLowerCase() === tag.toLowerCase() &&
          classes.every((c) => node.classList.contains(c));
      } else {
        isMatch = node.tagName.toLowerCase() === part.toLowerCase();
      }
      if (isMatch) {
        matches.push(node);
      }
      for (const child of node.children) {
        search(child);
      }
    };
    for (const child of this.children) {
      search(child);
    }
    return matches;
  }

  querySelector(selector: string): MockDOMElement | null {
    const parts = selector.trim().split(/\s+/);
    let currentSet: MockDOMElement[] = [this];
    for (const part of parts) {
      const nextSet: MockDOMElement[] = [];
      for (const node of currentSet) {
        nextSet.push(...node.findSimpleMatches(part));
      }
      currentSet = nextSet;
      if (currentSet.length === 0) return null;
    }
    return currentSet[0] || null;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const parts = selector.trim().split(/\s+/);
    let currentSet: MockDOMElement[] = [this];
    for (const part of parts) {
      const nextSet: MockDOMElement[] = [];
      for (const node of currentSet) {
        nextSet.push(...node.findSimpleMatches(part));
      }
      currentSet = nextSet;
    }
    return currentSet;
  }
}

const mockDocument = {
  activeElement: null as MockDOMElement | null,
  createElement(tag: string): MockDOMElement {
    return new MockDOMElement(tag);
  },
  getElementById(id: string): MockDOMElement | null {
    return null;
  },
  querySelector(sel: string): MockDOMElement | null {
    return null;
  },
  querySelectorAll(sel: string): MockDOMElement[] {
    return [];
  },
};

const mockWindow = {
  location: { hash: '' },
  listeners: {} as Record<string, ((e: any) => void)[]>,
  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  },
  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  },
};

(globalThis as any).document = mockDocument;
(globalThis as any).window = mockWindow;
(globalThis as any).HTMLElement = MockDOMElement;

import {
  CURRENT_ARCHITECTURE_POLICY_VERSION,
  CURRENT_ARCHITECTURE_SCHEMA_VERSION,
  GuardrailPolicyConfig,
} from '../types/config.js';
import { RiskPolicyId } from '../types/policy.js';
import { ResponseAction } from '../types/response.js';
import { DEFAULT_GUARDRAIL_POLICY_CONFIG } from '../config/schema.js';
import {
  ActorRole,
  AuthContext,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from './authorization.js';
import {
  computePolicyDiff,
  explainAllPolicyImpacts,
  explainPolicySettingImpact,
  PolicyAccessDeniedError,
  PolicyAdministrationDeniedError,
  PolicyAuditRecord,
  PolicyVersionConflictError,
  PolicyInvariantViolationError,
  UserPolicyRecord,
} from './policy-permissions.js';
import { PolicyService } from './policy-service.js';
import { InMemoryPolicyRepository } from './policy-repository.js';
import {
  PolicySyncManager,
  PolicySyncStatus,
} from '../config/policy-sync-manager.js';
import {
  ApprovalApiClient,
  ApiClientResult,
} from './client.js';
import { renderSettings } from '../../../dashboard/src/components/settings.js';
import { DashboardShell } from '../../../dashboard/src/shell.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}: ${String(actual)}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message} (Expected ${String(expected)}, got ${String(actual)})`);
    throw new Error(`Assertion failed: ${message}`);
  }
}


async function runTestSuite() {
  console.log('======================================================================');
  console.log('🛡️ GUARDRAIL PROTECTION POLICY HISTORY & TRANSPARENCY TEST SUITE');
  console.log('======================================================================\n');

  const wardId = 'usr_alice_ward';
  const otherWardId = 'usr_bob_ward';
  const contactId = 'usr_carol_contact';
  const attackerId = 'usr_mallory_attacker';
  const adminId = 'usr_admin_dave';

  const wardAuth: AuthContext = {
    actorId: wardId,
    role: ActorRole.USER,
    isAuthenticated: true,
  };

  const contactAuth: AuthContext = {
    actorId: contactId,
    role: ActorRole.TRUSTED_CONTACT,
    isAuthenticated: true,
  };

  const attackerAuth: AuthContext = {
    actorId: attackerId,
    role: ActorRole.USER,
    isAuthenticated: true,
  };

  const adminAuth: AuthContext = {
    actorId: adminId,
    role: ActorRole.ADMIN,
    isAuthenticated: true,
  };

  const contactRegistry = new InMemoryTrustedContactRegistry();
  contactRegistry.addContact({
    id: contactId,
    userId: wardId,
    status: TrustedContactStatus.ACTIVE,
    relationshipLabel: 'Primary Safety Guardian',
    createdAt: new Date().toISOString(),
  });

  const repository = new InMemoryPolicyRepository();
  let fakeNow = new Date('2026-11-08T10:00:00.000Z');
  const service = new PolicyService({
    policyRepository: repository,
    contactRegistry,
    timeProvider: () => fakeNow,
  });

  // ===========================================================================
  // Requirement 1, 2, 3: Timestamps, Actor Identification & Version Progression
  // ===========================================================================
  console.log('▶ Test 1: Monotonic Timestamps, Actor Identification & Version Tracking');
  {
    // Update 1: Ward customizes thresholds
    fakeNow = new Date('2026-11-08T10:15:00.000Z');
    const update1 = await service.updateUserPolicy(wardAuth, wardId, {
      config: {
        ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
        policyVersion: '1.1.0',
        thresholds: { lowMax: 20, mediumMax: 45, highMax: 70 },
      },
      changeReason: 'Adjusted sensitivity thresholds for earlier warnings',
    });

    assertEquals(update1.policyVersion, '1.1.0', 'Update 1 policy version is 1.1.0');
    assertEquals(update1.updatedBy, wardId, 'Update 1 updatedBy matches ward ID');

    // Retrieve audit history
    const history1 = await service.getPolicyAuditHistory(wardAuth, wardId);
    assertEquals(history1.length, 1, 'Exactly one audit entry recorded');
    assertEquals(history1[0].previousPolicyVersion, '0.0.0', 'Initial previous version before first save was 0.0.0');
    assertEquals(history1[0].newPolicyVersion, '1.1.0', 'New version is 1.1.0');
    assertEquals(history1[0].updatedBy, wardId, 'Actor identified as Alice');
    assertEquals(history1[0].actorRole, ActorRole.USER, 'Actor role recorded as USER');
    assertEquals(history1[0].timestamp, '2026-11-08T10:15:00.000Z', 'Authoritative ISO timestamp recorded');
    assert(history1[0].changedFields.includes('thresholds.lowMax'), 'Tracks thresholds.lowMax in changedFields');
    assert(history1[0].changedFields.includes('thresholds.mediumMax'), 'Tracks thresholds.mediumMax in changedFields');
    assert(history1[0].changedFields.includes('thresholds.highMax'), 'Tracks thresholds.highMax in changedFields');

    // Update 2: Forward progression
    fakeNow = new Date('2026-11-08T10:30:00.000Z');
    const update2 = await service.updateUserPolicy(wardAuth, wardId, {
      config: {
        ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
        policyVersion: '1.2.0',
        trustedDomains: ['trusted-bank.example'],
      },
      expectedPolicyVersion: '1.1.0',
      changeReason: 'Added trusted financial domain',
    });

    assertEquals(update2.policyVersion, '1.2.0', 'Update 2 forward progression to 1.2.0');
    const history2 = await service.getPolicyAuditHistory(wardAuth, wardId);
    assertEquals(history2.length, 2, 'Two audit entries recorded in order');
    assertEquals(history2[0].newPolicyVersion, '1.2.0', 'Most recent audit entry is version 1.2.0');
    assertEquals(history2[0].previousPolicyVersion, '1.1.0', 'Previous version recorded as 1.1.0');
    assertEquals(history2[0].timestamp, '2026-11-08T10:30:00.000Z', 'Timestamp reflects 10:30 UTC');
  }

  // ===========================================================================
  // Requirement 4: Distinguish User Changes from System Defaults / Resets
  // ===========================================================================
  console.log('\n▶ Test 2: Distinguish User Agency from System Defaults and Automated Resets');
  {
    // Retrieve history after user updates
    const historyBeforeReset = await service.getPolicyAuditHistory(wardAuth, wardId);
    assertEquals(historyBeforeReset[0].changeSource, 'USER_CHANGE', 'User update marked as USER_CHANGE');
    assertEquals(historyBeforeReset[0].isSystemDefault, false, 'User update isSystemDefault is false');

    // Perform canonical reset
    fakeNow = new Date('2026-11-08T11:00:00.000Z');
    const resetRecord = await service.resetPolicyToDefaults(wardAuth, wardId);
    assertEquals(resetRecord.isSystemDefault, true, 'Reset record marked isSystemDefault: true');

    const historyAfterReset = await service.getPolicyAuditHistory(wardAuth, wardId);
    assertEquals(historyAfterReset.length, 3, 'Audit history includes reset event');
    const resetAudit = historyAfterReset[0];

    assertEquals(resetAudit.changeSource, 'SYSTEM_RESET', 'Audit changeSource is SYSTEM_RESET');
    assertEquals(resetAudit.isSystemDefault, true, 'Audit isSystemDefault is true');
    assertEquals(resetAudit.actorRole, ActorRole.USER, 'Actor role was ward requesting reset');
    assert(resetAudit.changeSummary.includes('Reset to canonical default'), 'Change summary explains canonical reset');
  }

  // ===========================================================================
  // Requirement 6: Practical Security Impact Explanations
  // ===========================================================================
  console.log('\n▶ Test 3: Practical Security and Interaction Impact Explanations');
  {
    const oldConfig = DEFAULT_GUARDRAIL_POLICY_CONFIG;
    const customConfig: GuardrailPolicyConfig = {
      ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
      thresholds: { lowMax: 15, mediumMax: 40, highMax: 65 },
      policies: DEFAULT_GUARDRAIL_POLICY_CONFIG.policies.map((p) =>
        p.id === RiskPolicyId.CONTROLLED_PAYMENT
          ? { ...p, decision: ResponseAction.PROTECT }
          : p
      ),
      trustedDomains: ['safe-portal.org'],
      timeouts: { approvalTtlSeconds: 180, dashboardPollIntervalMs: 5000 },
    };

    const diff = computePolicyDiff(oldConfig, customConfig);
    assert(Boolean(diff.impactSummary), 'computePolicyDiff generates non-empty impactSummary');
    assert(diff.impactSummary.includes('Low-risk threshold lowered'), 'Explains low-risk threshold lowering impact');
    assert(diff.impactSummary.includes('Payment checkout protection'), 'Explains payment checkout protection impact');
    assert(diff.impactSummary.includes('Exempt domains allowlist updated'), 'Explains trusted domain allowlist impact');
    assert(diff.impactSummary.includes('Review TTL updated'), 'Explains review expiration window impact');

    // Invariant impact explanation
    const invariantExplanation = explainPolicySettingImpact('policies[POLICY_CONTROLLED_DESTRUCTIVE]');
    assert(invariantExplanation.includes('permanently locked to PROTECT'), 'Explains destructive action permanent invariant');

    const boundaryExplanation = explainPolicySettingImpact('policies[POLICY_UNSUPPORTED_BOUNDARY_GUARD]');
    assert(boundaryExplanation.includes('Untrusted execution contexts'), 'Explains boundary guard permanent invariant');
  }

  // ===========================================================================
  // Requirement 7: Pending Synchronization Tracking & Staged Changes
  // ===========================================================================
  console.log('\n▶ Test 4: Pending Synchronization Tracking & Staging Mode');
  {
    const mockApiClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      serviceType: 'mock',
    });

    const syncManager = new PolicySyncManager({
      apiClient: mockApiClient,
      userId: wardId,
    });

    assertEquals(syncManager.getState().status, PolicySyncStatus.IDLE, 'Initial sync status is IDLE');
    assertEquals(syncManager.hasPendingChanges(), false, 'hasPendingChanges() is false initially');

    // Stage a candidate change
    const stagedResult = syncManager.stagePolicyChange({
      ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
      thresholds: { lowMax: 18, mediumMax: 42, highMax: 68 },
    });

    assert(stagedResult.success, 'stagePolicyChange succeeded');
    assertEquals(syncManager.getState().status, PolicySyncStatus.PENDING_SYNC, 'Status transitioned to PENDING_SYNC');
    assertEquals(syncManager.hasPendingChanges(), true, 'hasPendingChanges() is true while staged');
    assert(syncManager.getState().hasPendingSync, 'getState().hasPendingSync is true');
    assert(Boolean(syncManager.getState().pendingChanges?.length), 'pendingChanges is populated with modified paths');

    // Attempting to stage an invariant violation is rejected immediately
    const invalidCandidate = {
      ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
      policies: DEFAULT_GUARDRAIL_POLICY_CONFIG.policies.map((p) =>
        p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE
          ? { ...p, enabled: false }
          : p
      ),
    };
    const invalidStageResult = syncManager.stagePolicyChange(invalidCandidate);
    assertEquals(invalidStageResult.success, false, 'Staging invariant violation is rejected');
    assert(Boolean(invalidStageResult.errors?.length), 'Returns invariant error details');

    // Discarding pending changes restores safe idle/synced state
    syncManager.discardPendingChanges();
    assertEquals(syncManager.hasPendingChanges(), false, 'hasPendingChanges() is false after discard');
    assertEquals(syncManager.getState().hasPendingSync, false, 'hasPendingSync is false after discard');
  }

  // ===========================================================================
  // Requirement 8: Transparent Failure Handling with Actionable Recovery
  // ===========================================================================
  console.log('\n▶ Test 5: Transparent Failure Handling & Actionable Recovery Guidance');
  {
    // 1. Version conflict (OCC 409)
    const conflictApiClient = {
      isMockService: () => false,
      getServiceType: () => 'live' as const,
      updateUserPolicy: async (): Promise<ApiClientResult<UserPolicyRecord>> => ({
        success: false,
        statusCode: 409,
        error: {
          code: 'POLICY_VERSION_CONFLICT',
          message: 'Expected version 1.0.0 does not match active version 1.2.0',
          statusCode: 409,
        },
      }),
      getUserPolicy: async () => ({ success: false, statusCode: 500, error: { code: 'ERR', message: '', statusCode: 500 } }),
    } as unknown as ApprovalApiClient;

    const conflictSyncManager = new PolicySyncManager({
      apiClient: conflictApiClient,
      userId: wardId,
    });

    const conflictResult = await conflictSyncManager.syncUp({
      ...DEFAULT_GUARDRAIL_POLICY_CONFIG,
      policyVersion: '1.1.0',
    });

    assertEquals(conflictResult.success, false, 'syncUp failed on conflict');
    assertEquals(conflictResult.status, PolicySyncStatus.CONFLICT, 'Status is CONFLICT');
    assertEquals(conflictResult.errorType, 'CONFLICT', 'errorType is CONFLICT');
    assert(Boolean(conflictResult.recoveryGuidance), 'Provides recovery guidance for conflict');
    assert(conflictResult.recoveryGuidance!.includes('syncDown()'), 'Guidance advises reloading latest policy via syncDown()');
    assertEquals(conflictSyncManager.getState().conflictDetails?.expectedVersion, '1.0.0', 'Records expected version');

    // 2. Offline / Network failure
    const offlineApiClient = {
      isMockService: () => false,
      getServiceType: () => 'live' as const,
      updateUserPolicy: async (): Promise<ApiClientResult<UserPolicyRecord>> => ({
        success: false,
        statusCode: 0,
        isNetworkError: true,
        error: { code: 'NETWORK_FAILURE', message: 'Failed to connect to backend', statusCode: 0 },
      }),
      getUserPolicy: async () => ({ success: false, statusCode: 0, isNetworkError: true, error: { code: 'NET', message: '', statusCode: 0 } }),
    } as unknown as ApprovalApiClient;

    const offlineSyncManager = new PolicySyncManager({
      apiClient: offlineApiClient,
      userId: wardId,
    });

    const offlineResult = await offlineSyncManager.syncUp();
    assertEquals(offlineResult.success, false, 'syncUp failed when offline');
    assertEquals(offlineResult.status, PolicySyncStatus.OFFLINE_FALLBACK, 'Status is OFFLINE_FALLBACK');
    assertEquals(offlineResult.errorType, 'OFFLINE_FALLBACK', 'errorType is OFFLINE_FALLBACK');
    assert(offlineResult.recoveryGuidance!.includes('fail-closed'), 'Guidance confirms fail-closed local protection');
  }

  // ===========================================================================
  // Requirement 9: Prevent Unauthorized Access to Policy History
  // ===========================================================================
  console.log('\n▶ Test 6: Strict Role-Based Authorization & Anti-Enumeration');
  {
    // 1. Unauthenticated access rejected with 401
    let unauthThrown = false;
    try {
      await service.getPolicyAuditHistory({ actorId: '', isAuthenticated: false, role: ActorRole.USER }, wardId);
    } catch (err: any) {
      unauthThrown = true;
      assertEquals(err.statusCode, 401, 'Unauthenticated access rejected with 401');
    }
    assert(unauthThrown, 'Unauthenticated request threw error');

    // 2. Trusted contact access to raw audit history rejected with 403
    let contactDenied = false;
    try {
      await service.getPolicyAuditHistory(contactAuth, wardId);
    } catch (err: any) {
      contactDenied = true;
      assertEquals(err.statusCode, 403, 'Trusted contact denied with 403');
      assertEquals(err.code, 'POLICY_ADMINISTRATION_DENIED', 'Error code is POLICY_ADMINISTRATION_DENIED');
      assert(err.message.includes('Trusted contacts hold zero policy administration authority'), 'Explicit sovereignty reason');
    }
    assert(contactDenied, 'Contact audit inspection threw PolicyAdministrationDeniedError');

    // 3. Unrelated user (Mallory) denied with opaque 404 anti-enumeration
    let attackerDenied = false;
    try {
      await service.getPolicyAuditHistory(attackerAuth, wardId);
    } catch (err: any) {
      attackerDenied = true;
      assertEquals(err.statusCode, 404, 'Mallory denied with opaque 404 anti-enumeration');
      assertEquals(err.code, 'NOT_FOUND_OR_DENIED', 'Error code is NOT_FOUND_OR_DENIED');
    }
    assert(attackerDenied, 'Attacker audit inspection threw PolicyAccessDeniedError');

    // 4. Admin denied with 404 cross-user policy sovereignty
    let adminDenied = false;
    try {
      await service.getPolicyAuditHistory(adminAuth, wardId);
    } catch (err: any) {
      adminDenied = true;
      assertEquals(err.statusCode, 404, 'Admin denied cross-tenant policy inspection with 404');
    }
    assert(adminDenied, 'Admin audit inspection threw PolicyAccessDeniedError');

    // 5. Authorized ward receives full audit history
    const wardHistory = await service.getPolicyAuditHistory(wardAuth, wardId);
    assert(Array.isArray(wardHistory), 'Ward receives array of audit records');
    assert(wardHistory.length > 0, 'Audit records returned to authorized ward');
  }

  // ===========================================================================
  // Requirement 5: Authorized UI Display of Policy History & Pending Sync
  // ===========================================================================
  console.log('\n▶ Test 7: Authorized Dashboard History Display & Pending Sync Indicators');
  {
    const historyEntries: PolicyAuditRecord[] = [
      {
        id: 'pol_aud_test1',
        userId: wardId,
        updatedBy: wardId,
        actorRole: ActorRole.USER,
        timestamp: '2026-11-08T10:15:00.000Z',
        previousPolicyVersion: '1.0.0',
        newPolicyVersion: '1.1.0',
        changedFields: ['thresholds.lowMax', 'thresholds.mediumMax'],
        changeSummary: 'Adjusted low and medium sensitivity boundaries',
        changeSource: 'USER_CHANGE',
        isSystemDefault: false,
        impactSummary: 'Low-risk threshold lowered: Routine interactions will trigger warnings earlier.',
      },
      {
        id: 'pol_aud_test2',
        userId: wardId,
        updatedBy: 'SYSTEM',
        actorRole: 'SYSTEM',
        timestamp: '2026-11-08T09:00:00.000Z',
        previousPolicyVersion: '0.0.0',
        newPolicyVersion: '1.0.0',
        changedFields: ['policies'],
        changeSummary: 'Initialized canonical system safety defaults',
        changeSource: 'SYSTEM_DEFAULT',
        isSystemDefault: true,
        impactSummary: 'Default security policies activated.',
      },
    ];

    const container = document.createElement('div');
    const settingsEl = renderSettings({
      profile: {
        actorId: wardId,
        role: ActorRole.USER,
        assignedWardId: wardId,
        isAuthenticated: true,
      },
      wardPolicySummary: {
        wardId,
        policyVersion: '1.1.0',
        schemaVersion: CURRENT_ARCHITECTURE_SCHEMA_VERSION,
        updatedAt: '2026-11-08T10:15:00.000Z',
        overallStatus: 'ACTIVE',
        sensitivityPreset: 'custom',
        stagingModeEnabled: true,
        categoryProtections: {
          destructiveActions: ResponseAction.PROTECT,
          paymentActions: ResponseAction.PROTECT,
          boundaryGuards: ResponseAction.PROTECT,
          sensitiveData: ResponseAction.WARN,
          externalNavigation: ResponseAction.WARN,
        },
        relationship: {
          contactId: 'guardian',
          status: 'ACTIVE',
        },
      },
      hasPendingSync: true,
      pendingSyncChanges: ['thresholds.lowMax (20 -> 15)', 'trustedDomains (1 -> 2 domains)'],
      wardPolicyAuditHistory: historyEntries,
      wardPolicyAuditStatus: 'idle',
    });
    container.appendChild(settingsEl);

    // Verify Pending Sync badge in Ward Policy Card
    const wardPolicyCard = container.querySelector('#gd-card-ward-policy');
    assert(Boolean(wardPolicyCard), '#gd-card-ward-policy rendered');
    const pendingBadge = wardPolicyCard?.querySelector('.gd-badge-warning');
    assert(Boolean(pendingBadge), 'Pending sync badge rendered in policy card');
    assertEquals(pendingBadge?.textContent?.trim(), 'Pending Sync', 'Badge text is Pending Sync');

    // Verify Pending Sync Banner with changes list
    const pendingBanner = container.querySelector('#gd-ward-pending-sync-banner');
    assert(Boolean(pendingBanner), '#gd-ward-pending-sync-banner rendered');
    assert(pendingBanner?.textContent?.includes('thresholds.lowMax (20 -> 15)'), 'Banner lists pending lowMax change');
    assert(pendingBanner?.textContent?.includes('trustedDomains (1 -> 2 domains)'), 'Banner lists pending trustedDomains change');

    // Verify Policy History Card
    const historyCard = container.querySelector('#gd-card-policy-history');
    assert(Boolean(historyCard), '#gd-card-policy-history card rendered');
    const trailBadge = historyCard?.querySelector('.gd-settings-badge');
    assertEquals(trailBadge?.textContent?.trim(), 'Durable Audit Trail', 'Honest badge: Durable Audit Trail');

    const timelineItems = historyCard?.querySelectorAll('.gd-policy-audit-item');
    assertEquals(timelineItems?.length, 2, 'Renders both historical audit entries');

    const firstItemText = timelineItems?.[0].textContent || '';
    assert(firstItemText.includes('v1.0.0 → v1.1.0'), 'Renders version transition pill');
    assert(firstItemText.includes('User Customization'), 'Renders User Customization source badge');
    assert(firstItemText.includes('usr_alice_ward (USER)'), 'Renders responsible actor and role');
    assert(firstItemText.includes('Practical Security Impact:'), 'Renders practical security impact label');
    assert(firstItemText.includes('Routine interactions will trigger warnings earlier'), 'Renders impact explanation');

    const secondItemText = timelineItems?.[1].textContent || '';
    assert(secondItemText.includes('System Default'), 'Second entry rendered as System Default');
    assert(secondItemText.includes('SYSTEM (SYSTEM)'), 'Second entry actor identified as SYSTEM');
  }

  // ===========================================================================
  // Requirement 10 & Security Invariants: Privacy-Preserving Audit Guarantee
  // ===========================================================================
  console.log('\n▶ Test 8: Privacy-Safe Audit Invariants: Zero Credentials, OTPs, or Raw Data');
  {
    const history = await service.getPolicyAuditHistory(wardAuth, wardId);

    for (const record of history) {
      const recordJson = JSON.stringify(record);

      // 1. Zero passwords, credentials, tokens
      assert(!/password/i.test(recordJson), 'Audit record strictly contains no password');
      assert(!/passwd/i.test(recordJson), 'Audit record strictly contains no passwd');
      assert(!/bearer/i.test(recordJson), 'Audit record strictly contains no bearer tokens');
      assert(!/secret/i.test(recordJson), 'Audit record strictly contains no secrets');
      assert(!/api_?key/i.test(recordJson), 'Audit record strictly contains no api keys');

      // 2. Zero OTPs or verification codes
      assert(!/\botp\b/i.test(recordJson), 'Audit record strictly contains no OTP');
      assert(!/totp/i.test(recordJson), 'Audit record strictly contains no TOTP');
      assert(!/one-?time/i.test(recordJson), 'Audit record strictly contains no one-time codes');

      // 3. Zero credit card numbers or raw form values
      assert(!/\b(?:\d[ -]*?){13,16}\b/.test(recordJson), 'Audit record strictly contains no credit card numbers');
      assert(!/cvv|cvc/i.test(recordJson), 'Audit record strictly contains no card verification values');

      // 4. No private query parameters or tokenized URLs
      assert(!/[?&](?:token|auth|session|key)=/i.test(recordJson), 'Audit record strictly contains no URL query parameters');

      // 5. Truthful claims check: verify record does not falsely claim cryptographic immutability
      assert(!/cryptographically immutable/i.test(recordJson), 'Does not falsely claim cryptographic immutability');
    }
  }

  console.log('\n======================================================================');
  console.log(`Results: All ${passed} Policy Transparency assertions PASSED cleanly!`);
  console.log('======================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n❌ Unhandled error in policy transparency test suite:', err);
  process.exit(1);
});
