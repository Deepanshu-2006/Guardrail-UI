/**
 * Guardrail Protection Policy Persistence & Client Synchronization Test Suite
 *
 * Comprehensive end-to-end verification covering:
 * 1. Authoritative persistence through backend architecture (`PolicyRepository`, OCC, audit logging).
 * 2. Role-based policy retrieval (Ward sovereign full view vs. Trusted Contact sanitized summary).
 * 3. Bi-directional synchronization with browser extension storage (`PolicySyncManager`).
 * 4. Consistent policy values between dashboard and browser extension.
 * 5. Network failure and offline backend resilience with fail-closed safe defaults.
 * 6. Optimistic Concurrency Control (OCC): Stale configuration update prevention (409 Conflict).
 * 7. Safe concurrent updates handling, conflict detection, and resolution.
 * 8. Policy semver version validation and forward progression.
 * 9. Clear synchronization status transitions (IDLE, SYNCING, SYNCED, OFFLINE_FALLBACK, CONFLICT, ERROR).
 * 10. Immutable security invariant enforcement (CONTROLLED_DESTRUCTIVE and UNSUPPORTED_BOUNDARY_GUARD).
 * 11. Security boundary protection: Zero client trust, no local authorization, zero leaked secrets.
 * 12. Clear distinction between live backend integration and mock/in-memory fixtures.
 */

declare const process: { exit: (code: number) => void; exitCode?: number };

import http from 'node:http';
import { AddressInfo } from 'node:net';

// Types
import { ActionCategory, ActionType } from '../types/actions.js';
import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import { RiskLevel } from '../types/risk.js';
import { GuardrailPolicyConfig } from '../types/config.js';

// Authorization & Model
import {
  ActorRole,
  AuthContext,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from '../approval/authorization.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
} from '../approval/repository.js';
import { ApprovalService } from '../approval/service.js';
import {
  ApprovalApiRouter,
  InMemoryTokenVerifier,
} from '../approval/api.js';
import {
  ApiClientErrorCodes,
  ApprovalApiClient,
  UserPolicyRecord,
  UserPolicyView,
} from '../approval/client.js';
import {
  PolicyAuditRecord,
  PolicyService,
} from '../approval/policy-service.js';
import { InMemoryPolicyRepository } from '../approval/policy-repository.js';

// Configuration Registry & Sync
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  validatePolicyConfig,
} from './schema.js';
import {
  ConfigStorageProvider,
  PolicyConfigLoader,
} from './loader.js';
import {
  PolicyConfigRegistry,
} from './registry.js';
import {
  PolicySyncManager,
  PolicySyncStatus,
} from './policy-sync-manager.js';

// Dashboard Shell
import { DashboardShell } from '../../../dashboard/src/shell.js';

// =============================================================================
// Test Harness & Assertion Helpers
// =============================================================================

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    totalPassed++;
    console.log(`  ✓ ${message}`);
  } else {
    totalFailed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    totalPassed++;
    console.log(`  ✓ ${message}`);
  } else {
    totalFailed++;
    console.error(`  ✗ FAIL: ${message} - Expected: ${String(expected)}, Got: ${String(actual)}`);
  }
}

/**
 * In-memory storage provider for isolated extension tests.
 */
class MemoryConfigStorageProvider implements ConfigStorageProvider {
  private readonly store: Map<string, unknown> = new Map();

  public async get(key: string): Promise<unknown> {
    return this.store.get(key);
  }

  public async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }

  public async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * Helper to deep clone configuration documents.
 */
function cloneConfig(config: GuardrailPolicyConfig): GuardrailPolicyConfig {
  return JSON.parse(JSON.stringify(config));
}

class MockDOMTokenList {
  private classes: Set<string> = new Set();
  constructor(initial?: string) {
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

  get innerHTML(): string {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`).join('');
  }
  set innerHTML(val: string) {
    this.children = [];
    this._textContent = val;
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

  focus(): void {}

  private findSimpleMatches(part: string): MockDOMElement[] {
    const matches: MockDOMElement[] = [];
    const search = (node: MockDOMElement) => {
      let isMatch = false;
      if (part.startsWith('#')) {
        isMatch = node.id === part.slice(1);
      } else if (part.startsWith('.')) {
        const classes = part.split('.').filter(Boolean);
        isMatch = classes.every((c) => node.classList.contains(c));
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
    search(this);
    return matches;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const parts = selector.trim().split(/\s+/);
    if (parts.length === 1) {
      return this.findSimpleMatches(parts[0]!);
    }
    let currentPool: MockDOMElement[] = [this];
    for (const part of parts) {
      const nextPool: MockDOMElement[] = [];
      for (const parent of currentPool) {
        nextPool.push(...parent.findSimpleMatches(part));
      }
      currentPool = nextPool;
    }
    return currentPool;
  }

  querySelector(selector: string): MockDOMElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }
}

// Global DOM setup
const rootElement = new MockDOMElement('div');
rootElement.id = 'dashboard-app-root';

const mockDocument = {
  createElement(tag: string): MockDOMElement {
    return new MockDOMElement(tag);
  },
  getElementById(id: string): MockDOMElement | null {
    return rootElement.querySelector(`#${id}`);
  },
  querySelector(sel: string): MockDOMElement | null {
    return rootElement.querySelector(sel);
  },
  querySelectorAll(sel: string): MockDOMElement[] {
    return rootElement.querySelectorAll(sel);
  },
  addEventListener(event: string, handler: (e: any) => void): void {},
  removeEventListener(event: string, handler: (e: any) => void): void {},
  visibilityState: 'visible',
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

/**
 * Creates an assembled backend environment with an in-memory or custom repository.
 */
function createBackendEnvironment(options?: {
  policyRepo?: InMemoryPolicyRepository;
  contactRegistry?: InMemoryTrustedContactRegistry;
  tokenVerifier?: InMemoryTokenVerifier;
}) {
  const contactRegistry = options?.contactRegistry ?? new InMemoryTrustedContactRegistry();
  const tokenVerifier = options?.tokenVerifier ?? new InMemoryTokenVerifier();
  const policyRepo = options?.policyRepo ?? new InMemoryPolicyRepository();
  const requestRepo = new DevelopmentInMemoryApprovalRequestRepository();

  const approvalService = new ApprovalService({
    repository: requestRepo,
    contactRegistry,
  });

  const policyService = new PolicyService({
    policyRepository: policyRepo,
    contactRegistry,
  });

  const router = new ApprovalApiRouter(approvalService, tokenVerifier, {
    policyService,
  });

  const directFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : (input as any).url);
    const headersRecord: Record<string, string> = {};
    if (init?.headers) {
      if (typeof (init.headers as any).forEach === 'function') {
        (init.headers as any).forEach((v: string, k: string) => {
          headersRecord[k.toLowerCase()] = v;
        });
      } else {
        for (const [k, v] of Object.entries(init.headers)) {
          headersRecord[k.toLowerCase()] = String(v);
        }
      }
    }
    let bodyData = init?.body;
    if (typeof bodyData === 'string' && bodyData.trim()) {
      try {
        bodyData = JSON.parse(bodyData);
      } catch {}
    }
    const res = await router.dispatch({
      method: (init?.method || 'GET') as any,
      url: url.pathname + url.search,
      headers: headersRecord,
      body: bodyData,
    });
    return new Response(JSON.stringify(res.body), {
      status: res.statusCode,
      headers: res.headers,
    });
  };

  return {
    contactRegistry,
    tokenVerifier,
    policyRepo,
    approvalService,
    policyService,
    router,
    directFetch,
  };
}

// =============================================================================
// Test Execution
// =============================================================================

async function runTestSuite(): Promise<void> {
  console.log('====================================================================');
  console.log('🛡️ GUARDRAIL POLICY PERSISTENCE & SYNCHRONIZATION TEST SUITE');
  console.log('====================================================================\n');

  // ---------------------------------------------------------------------------
  // Test Suite 1: Backend Persistence & Audit Durability (Ward Sovereignty)
  // ---------------------------------------------------------------------------
  console.log('▶ Test Suite 1: Backend Policy Persistence & Audit Durability');
  {
    const backend = createBackendEnvironment();
    backend.tokenVerifier.registerToken('token_alice', {
      actorId: 'usr_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    });

    const aliceClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_alice',
      fetchFn: backend.directFetch,
      serviceType: 'live',
    });

    // 1. Initial retrieval: returns default recommendation
    const initRes = await aliceClient.getUserPolicy('usr_alice');
    assert(initRes.success, 'Alice retrieves initial policy successfully');
    assertEquals(initRes.data?.viewType, 'WARD_FULL_POLICY', 'Alice receives WARD_FULL_POLICY view');
    assertEquals(initRes.data?.config.policyVersion, '1.0.0', 'Initial policy version is 1.0.0');

    // 2. Ward updates policy with strict preset thresholds and version 1.1.0
    const candidate = cloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
    candidate.policyVersion = '1.1.0';
    candidate.thresholds = { lowMax: 15, mediumMax: 35, highMax: 60 };
    candidate.trustedDomains = ['mybank.example.com', 'trusted-portal.org'];

    const updateRes = await aliceClient.updateUserPolicy('usr_alice', {
      config: candidate,
      expectedPolicyVersion: '1.0.0',
    });
    assert(updateRes.success, 'Alice successfully updates policy with OCC version check');
    assertEquals(updateRes.data?.policyVersion, '1.1.0', 'Backend confirmed version 1.1.0');
    assertEquals(updateRes.data?.config.thresholds.highMax, 60, 'Updated highMax threshold is 60');

    // 3. Verify backend repository durability directly
    const directFromDb = await backend.policyRepo.getPolicy('usr_alice');
    assert(Boolean(directFromDb), 'Policy record exists in backend repository');
    assertEquals(directFromDb?.policyVersion, '1.1.0', 'Backend persisted policyVersion 1.1.0');
    assertEquals(directFromDb?.config.trustedDomains.length, 2, 'Backend persisted trusted domains');

    // 4. Audit trail verification: changes logged without sensitive data
    const auditRes = await aliceClient.getPolicyAuditHistory('usr_alice');
    assert(auditRes.success, 'Alice retrieves policy audit log');
    assertEquals(auditRes.data?.length, 1, 'Exactly one audit log entry recorded');
    const audit = auditRes.data![0]!;
    assertEquals(audit.previousPolicyVersion, '0.0.0', 'Audit records initial previous version 0.0.0');
    assertEquals(audit.newPolicyVersion, '1.1.0', 'Audit records new version 1.1.0');
    assert(audit.changedFields.some(f => f.includes('thresholds')), 'Audit recorded thresholds change');
    assert(audit.changedFields.some(f => f.includes('trustedDomains')), 'Audit recorded trustedDomains change');
    assert(!JSON.stringify(audit).includes('password'), 'Audit log contains zero credentials or passwords');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 2: Role-Based Retrieval & Sanitized Trusted Contact Summary
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 2: Role-Based Policy Scoping & Contact Sanitization');
  {
    const backend = createBackendEnvironment();
    backend.contactRegistry.addContact({
      id: 'tc_carol',
      userId: 'usr_alice',
      relationshipLabel: 'Guardian',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
    });

    backend.tokenVerifier.registerToken('token_alice', {
      actorId: 'usr_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    });
    backend.tokenVerifier.registerToken('token_carol', {
      actorId: 'tc_carol',
      role: ActorRole.TRUSTED_CONTACT,
      isAuthenticated: true,
    });
    backend.tokenVerifier.registerToken('token_mallory', {
      actorId: 'usr_mallory',
      role: ActorRole.USER,
      isAuthenticated: true,
    });

    // Save initial custom policy for Alice with private domains
    const custom = cloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
    custom.policyVersion = '1.2.0';
    custom.trustedDomains = ['confidential-personal-site.example.org'];
    await backend.policyRepo.savePolicy({
      userId: 'usr_alice',
      policyVersion: '1.2.0',
      schemaVersion: '1.0.0',
      updatedAt: new Date().toISOString(),
      updatedBy: 'usr_alice',
      config: custom,
    });

    const carolClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_carol',
      fetchFn: backend.directFetch,
      serviceType: 'live',
    });

    // 1. Carol retrieves Alice's policy -> returns sanitized summary
    const carolView = await carolClient.getUserPolicy('usr_alice');
    assert(carolView.success, 'Carol successfully retrieves Alice policy view');
    assertEquals(carolView.data?.viewType, 'TRUSTED_CONTACT_SUMMARY', 'Carol receives TRUSTED_CONTACT_SUMMARY');

    const summary = (carolView.data as any).summary;
    assertEquals(summary.policyVersion, '1.2.0', 'Summary reports correct policy version 1.2.0');
    assertEquals(summary.overallStatus, 'ACTIVE', 'Summary reports ACTIVE status');
    assertEquals(summary.categoryProtections.destructiveActions, ResponseAction.PROTECT, 'Destructive actions protected');

    // 2. Privacy & Sovereignty: private browsing domains and weights are strictly redacted
    const serializedSummary = JSON.stringify(carolView.data);
    assert(!serializedSummary.includes('confidential-personal-site'), 'Private trusted domain allowlist is REDACTED');
    assert(!('signals' in summary), 'Internal signal weights are strictly REDACTED');
    assert(!('thresholds' in summary), 'Internal threshold numbers are strictly REDACTED');

    // 3. Carol attempts to update Alice's policy -> strictly forbidden (403)
    const carolUpdate = await carolClient.updateUserPolicy('usr_alice', {
      config: custom,
    });
    assert(!carolUpdate.success, 'Carol cannot modify Alice policy');
    assertEquals(carolUpdate.statusCode, 403, 'Returns 403 Forbidden for contact policy modification attempt');

    // 4. Mallory (unrelated user) attempts to view Alice's policy -> opaque 404
    const malloryClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_mallory',
      fetchFn: backend.directFetch,
      serviceType: 'live',
    });
    const malloryView = await malloryClient.getUserPolicy('usr_alice');
    assert(!malloryView.success, 'Mallory cannot view Alice policy');
    assertEquals(malloryView.statusCode, 404, 'Returns opaque 404 anti-enumeration for Mallory');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 3: PolicySyncManager Downward Sync & Storage Integration
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 3: PolicySyncManager Downward Sync & Storage Integration');
  {
    const backend = createBackendEnvironment();
    backend.tokenVerifier.registerToken('token_alice', {
      actorId: 'usr_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    });

    // Pre-populate backend with updated policy v1.5.0
    const serverConfig = cloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
    serverConfig.policyVersion = '1.5.0';
    serverConfig.trustedDomains = ['company-intranet.local'];
    await backend.policyRepo.savePolicy({
      userId: 'usr_alice',
      policyVersion: '1.5.0',
      schemaVersion: '1.0.0',
      updatedAt: new Date().toISOString(),
      updatedBy: 'usr_alice',
      config: serverConfig,
    });

    const memoryStorage = new MemoryConfigStorageProvider();
    const loader = new PolicyConfigLoader({ storageProvider: memoryStorage });
    const registry = new PolicyConfigRegistry({ loader });

    const aliceClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_alice',
      fetchFn: backend.directFetch,
      serviceType: 'live',
    });

    const syncManager = new PolicySyncManager({
      apiClient: aliceClient,
      registry,
      userId: 'usr_alice',
    });

    assertEquals(syncManager.getState().status, PolicySyncStatus.IDLE, 'Initial sync status is IDLE');

    // Perform syncDown
    const syncRes = await syncManager.syncDown();
    assert(syncRes.success, 'syncDown succeeded');
    assertEquals(syncManager.getState().status, PolicySyncStatus.SYNCED, 'Status transitioned to SYNCED');
    assertEquals(syncManager.getState().remotePolicyVersion, '1.5.0', 'Remote policy version recorded as 1.5.0');
    assert(syncManager.getState().lastSyncedAt !== null, 'lastSyncedAt is populated');

    // Verify local registry and storage received and persisted the configuration
    assertEquals(registry.getConfig().policyVersion, '1.5.0', 'Registry active config updated to 1.5.0');
    assert(registry.isTrustedDomain('company-intranet.local'), 'Registry recognizes synchronized trusted domain');

    // Reload from storage to verify persistent storage layer was written
    const reloaded = await loader.load();
    assertEquals(reloaded.config.policyVersion, '1.5.0', 'Storage persisted 1.5.0');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 4: Extension & Dashboard Display Consistency
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 4: Extension & Dashboard Display Consistency');
  {
    const backend = createBackendEnvironment();
    backend.contactRegistry.addContact({
      id: 'tc_carol',
      userId: 'usr_alice',
      relationshipLabel: 'Guardian',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
    });

    backend.tokenVerifier.registerToken('token_carol', {
      actorId: 'tc_carol',
      role: ActorRole.TRUSTED_CONTACT,
      isAuthenticated: true,
    });

    // Save policy v2.0.0 on backend
    const activeConfig = cloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
    activeConfig.policyVersion = '2.0.0';
    await backend.policyRepo.savePolicy({
      userId: 'usr_alice',
      policyVersion: '2.0.0',
      schemaVersion: '1.0.0',
      updatedAt: new Date().toISOString(),
      updatedBy: 'usr_alice',
      config: activeConfig,
    });

    const carolClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_carol',
      fetchFn: backend.directFetch,
      serviceType: 'live',
    });

    // Mount Dashboard Shell for Carol
    const rootEl = new MockDOMElement('div');
    const shell = new DashboardShell({
      container: rootEl as unknown as HTMLElement,
      initialProfile: {
        actorId: 'tc_carol',
        role: ActorRole.TRUSTED_CONTACT,
        assignedWardId: 'usr_alice',
        relationshipLabel: 'Guardian',
        isAuthenticated: true,
      },
      apiClient: carolClient,
      autoFetch: false,
    });

    // Trigger dashboard ward policy fetch
    await shell.fetchWardPolicy();

    // Verify dashboard state
    const state = shell.getState();
    assert(Boolean(state.wardPolicySummary), 'Dashboard holds wardPolicySummary');
    assertEquals(state.wardPolicySummary?.policyVersion, '2.0.0', 'Dashboard displays version 2.0.0');
    assertEquals(state.wardPolicySummary?.overallStatus, 'ACTIVE', 'Dashboard displays status ACTIVE');

    // Verify rendered DOM card in Settings view
    shell.setActiveView('settings');
    const policyCard = rootEl.querySelector('#gd-card-ward-policy');
    assert(Boolean(policyCard), 'Settings view renders #gd-card-ward-policy');
    const cardText = policyCard?.textContent ?? '';
    assert(cardText.includes('Ward Protection Policy & Invariants'), 'Card contains title');
    assert(cardText.includes('Synchronized (Active)'), 'Card displays Synchronized (Active) badge');
    assert(cardText.includes('2.0.0'), 'Card displays policy version 2.0.0');
    assert(cardText.includes('Destructive Actions'), 'Card displays Destructive Actions invariant');
    assert(cardText.includes('Permanently Locked Invariant'), 'Card confirms permanent security invariants');

    shell.destroy();
  }

  // ---------------------------------------------------------------------------
  // Test Suite 5: Optimistic Concurrency Control & Stale Update Prevention
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 5: Optimistic Concurrency Control (OCC 409 Conflict)');
  {
    const backend = createBackendEnvironment();
    backend.tokenVerifier.registerToken('token_alice', {
      actorId: 'usr_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    });

    // Initialize backend policy at version 1.0.0
    await backend.policyRepo.savePolicy({
      userId: 'usr_alice',
      policyVersion: '1.0.0',
      schemaVersion: '1.0.0',
      updatedAt: new Date().toISOString(),
      updatedBy: 'usr_alice',
      config: cloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG),
    });

    const aliceClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_alice',
      fetchFn: backend.directFetch,
      serviceType: 'live',
    });

    // Client A and Client B both load version 1.0.0
    const regA = new PolicyConfigRegistry({ loader: new PolicyConfigLoader({ storageProvider: new MemoryConfigStorageProvider() }) });
    const regB = new PolicyConfigRegistry({ loader: new PolicyConfigLoader({ storageProvider: new MemoryConfigStorageProvider() }) });

    const syncA = new PolicySyncManager({ apiClient: aliceClient, registry: regA, userId: 'usr_alice' });
    const syncB = new PolicySyncManager({ apiClient: aliceClient, registry: regB, userId: 'usr_alice' });

    await syncA.syncDown();
    await syncB.syncDown();

    assertEquals(syncA.getState().activePolicyVersion, '1.0.0', 'Client A has version 1.0.0');
    assertEquals(syncB.getState().activePolicyVersion, '1.0.0', 'Client B has version 1.0.0');

    // Client A updates policy to 1.1.0 (expecting 1.0.0) -> SUCCEEDS
    const cfgA = cloneConfig(regA.getConfig());
    cfgA.policyVersion = '1.1.0';
    cfgA.thresholds = { lowMax: 20, mediumMax: 40, highMax: 70 };
    const resA = await syncA.syncUp(cfgA);
    assert(resA.success, 'Client A update succeeds');
    assertEquals(syncA.getState().status, PolicySyncStatus.SYNCED, 'Client A status is SYNCED');
    assertEquals(syncA.getState().activePolicyVersion, '1.1.0', 'Client A active version is 1.1.0');

    // Client B attempts to update policy based on stale expected version 1.0.0 -> REJECTED WITH 409 CONFLICT
    const cfgB = cloneConfig(regB.getConfig());
    cfgB.policyVersion = '1.1.0-stale';
    cfgB.thresholds = { lowMax: 10, mediumMax: 30, highMax: 50 };
    const resB = await syncB.syncUp(cfgB);

    assert(!resB.success, 'Client B stale update is REJECTED');
    assertEquals(resB.status, PolicySyncStatus.CONFLICT, 'Result status is CONFLICT');
    assertEquals(resB.conflict, true, 'Result flags conflict: true');
    assertEquals(syncB.getState().status, PolicySyncStatus.CONFLICT, 'SyncManager state is CONFLICT');
    assert(syncB.getState().lastError?.includes('conflict'), 'Error details explain concurrency conflict');
    assert(!resB.success, 'CRITICAL: Synchronization is NOT claimed as succeeded on conflict');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 6: Concurrent Updates Recovery & Forward Progression
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 6: Concurrent Updates Recovery & Forward Progression');
  {
    const backend = createBackendEnvironment();
    backend.tokenVerifier.registerToken('token_alice', {
      actorId: 'usr_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    });

    const aliceClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_alice',
      fetchFn: backend.directFetch,
      serviceType: 'live',
    });

    const reg = new PolicyConfigRegistry({ loader: new PolicyConfigLoader({ storageProvider: new MemoryConfigStorageProvider() }) });
    const sync = new PolicySyncManager({ apiClient: aliceClient, registry: reg, userId: 'usr_alice' });

    // Client first syncs down
    await sync.syncDown();

    // Another client updates backend out-of-band to 1.2.0
    const outOfBand = cloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
    outOfBand.policyVersion = '1.2.0';
    await backend.policyRepo.savePolicy({
      userId: 'usr_alice',
      policyVersion: '1.2.0',
      schemaVersion: '1.0.0',
      updatedAt: new Date().toISOString(),
      updatedBy: 'usr_alice',
      config: outOfBand,
    });

    // Local client tries to push 1.1.0 expecting 1.0.0 -> CONFLICT
    const candidate = cloneConfig(reg.getConfig());
    candidate.policyVersion = '1.1.0';
    const conflictRes = await sync.syncUp(candidate);
    assertEquals(conflictRes.status, PolicySyncStatus.CONFLICT, 'Conflict detected');

    // Recovery workflow: Client pulls latest remote policy down
    const recoverySyncDown = await sync.syncDown();
    assert(recoverySyncDown.success, 'Recovery syncDown succeeded');
    assertEquals(sync.getState().activePolicyVersion, '1.2.0', 'Active version now aligned to remote 1.2.0');

    // Client applies changes forward on top of 1.2.0 -> version 1.3.0
    const forwardCandidate = cloneConfig(reg.getConfig());
    forwardCandidate.policyVersion = '1.3.0';
    forwardCandidate.trustedDomains = ['forward-domain.org'];
    const forwardRes = await sync.syncUp(forwardCandidate);

    assert(forwardRes.success, 'Forward update succeeds after recovery');
    assertEquals(sync.getState().status, PolicySyncStatus.SYNCED, 'Status restored to SYNCED');
    assertEquals(sync.getState().activePolicyVersion, '1.3.0', 'Active version updated to 1.3.0');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 7: Network Failures & Fail-Closed Offline Fallback
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 7: Network Failures & Fail-Closed Offline Fallback');
  {
    // Mock client simulating dead connection / ECONNREFUSED
    const deadClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_alice',
      fetchFn: async () => {
        throw new TypeError('Failed to fetch: net::ERR_CONNECTION_REFUSED');
      },
    });

    const reg = new PolicyConfigRegistry({ loader: new PolicyConfigLoader({ storageProvider: new MemoryConfigStorageProvider() }) });
    const sync = new PolicySyncManager({ apiClient: deadClient, registry: reg, userId: 'usr_alice' });

    // syncDown when network dead
    const downRes = await sync.syncDown();
    assert(!downRes.success, 'syncDown returns false on network drop');
    assertEquals(downRes.status, PolicySyncStatus.OFFLINE_FALLBACK, 'Transitions to OFFLINE_FALLBACK');
    assertEquals(downRes.offlineFallback, true, 'Flags offlineFallback: true');
    assertEquals(sync.getState().serviceType, 'local_only', 'Service type flags local_only');

    // CRITICAL SECURITY INVARIANT: Safe local configuration is preserved fail-closed
    const current = reg.getConfig();
    const destructive = current.policies.find((p) => p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE);
    assertEquals(destructive?.decision, ResponseAction.PROTECT, 'CONTROLLED_DESTRUCTIVE remains locked to PROTECT');
    const boundary = current.policies.find((p) => p.id === RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD);
    assertEquals(boundary?.decision, ResponseAction.PROTECT, 'UNSUPPORTED_BOUNDARY_GUARD remains locked to PROTECT');

    // syncUp when network dead
    const upCandidate = cloneConfig(reg.getConfig());
    upCandidate.policyVersion = '1.2.0';
    const upRes = await sync.syncUp(upCandidate);
    assert(!upRes.success, 'syncUp fails when network dead');
    assertEquals(upRes.status, PolicySyncStatus.OFFLINE_FALLBACK, 'syncUp transitions to OFFLINE_FALLBACK');
    assert(!upRes.success, 'CRITICAL: Does not claim sync succeeded when offline');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 8: Unauthorized Client & Zero Server Trust
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 8: Unauthorized Client & Zero Server Trust');
  {
    const backend = createBackendEnvironment();
    // Do not register any token for stranger

    const unauthClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => undefined, // No token
      fetchFn: backend.directFetch,
    });

    const reg = new PolicyConfigRegistry({ loader: new PolicyConfigLoader({ storageProvider: new MemoryConfigStorageProvider() }) });
    const sync = new PolicySyncManager({ apiClient: unauthClient, registry: reg, userId: 'usr_alice' });

    const res = await sync.syncDown();
    assert(!res.success, 'Unauthenticated syncDown rejected');
    assertEquals(res.status, PolicySyncStatus.ERROR, 'Transitions to ERROR');
    assertEquals(sync.getState().status, PolicySyncStatus.ERROR, 'Sync state is ERROR');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 9: Mandatory Security Invariants Tamper-Resistance
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 9: Mandatory Security Invariants Tamper-Resistance');
  {
    const backend = createBackendEnvironment();
    backend.tokenVerifier.registerToken('token_alice', {
      actorId: 'usr_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    });

    const aliceClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_alice',
      fetchFn: backend.directFetch,
      serviceType: 'live',
    });

    const reg = new PolicyConfigRegistry({ loader: new PolicyConfigLoader({ storageProvider: new MemoryConfigStorageProvider() }) });
    const sync = new PolicySyncManager({ apiClient: aliceClient, registry: reg, userId: 'usr_alice' });

    // Attempt 1: Tamper with CONTROLLED_DESTRUCTIVE by setting to ALLOW
    const tampered1 = cloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
    const pDestructive = tampered1.policies.find((p) => p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE);
    if (pDestructive) (pDestructive as any).decision = ResponseAction.ALLOW;

    const resTampered1 = await sync.syncUp(tampered1);
    assert(!resTampered1.success, 'Attempt to downgrade CONTROLLED_DESTRUCTIVE to ALLOW is rejected');
    assertEquals(resTampered1.status, PolicySyncStatus.ERROR, 'Status transitions to ERROR');

    // Attempt 2: Tamper with UNSUPPORTED_BOUNDARY_GUARD by disabling it
    const tampered2 = cloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
    const pBoundary = tampered2.policies.find((p) => p.id === RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD);
    if (pBoundary) (pBoundary as any).enabled = false;

    const resTampered2 = await sync.syncUp(tampered2);
    assert(!resTampered2.success, 'Attempt to disable UNSUPPORTED_BOUNDARY_GUARD is rejected');

    // Attempt 3: Tamper with payment actions by setting to ALLOW
    const tampered3 = cloneConfig(DEFAULT_GUARDRAIL_POLICY_CONFIG);
    const pPayment = tampered3.policies.find((p) => p.id === RiskPolicyId.CONTROLLED_PAYMENT);
    if (pPayment) (pPayment as any).decision = ResponseAction.ALLOW;

    const resTampered3 = await sync.syncUp(tampered3);
    assert(!resTampered3.success, 'Attempt to downgrade PAYMENT to ALLOW is rejected');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 10: Clear Distinction: Live vs Mock/Fixture Service
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 10: Clear Distinction: Live vs Mock/Fixture Service');
  {
    // Live service client
    const liveClient = new ApprovalApiClient({
      baseUrl: 'https://guardrail.internal',
      tokenProvider: () => 'token_test',
      serviceType: 'live',
      fetchFn: async () => new Response(JSON.stringify({ success: true, data: { viewType: 'WARD_FULL_POLICY', config: DEFAULT_GUARDRAIL_POLICY_CONFIG } }), { status: 200 }),
    });

    assertEquals(liveClient.isMockService(), false, 'liveClient reports isMockService: false');
    assertEquals(liveClient.getServiceType(), 'live', 'liveClient reports serviceType: live');

    const regLive = new PolicyConfigRegistry({ loader: new PolicyConfigLoader({ storageProvider: new MemoryConfigStorageProvider() }) });
    const syncLive = new PolicySyncManager({ apiClient: liveClient, registry: regLive, userId: 'usr_alice' });
    await syncLive.syncDown();

    assertEquals(syncLive.getState().isMockService, false, 'SyncManager reports isMockService: false for live');
    assertEquals(syncLive.getState().serviceType, 'live', 'SyncManager reports serviceType: live');

    // Mock fixture client
    const mockClient = new ApprovalApiClient({
      baseUrl: 'http://localhost:3000',
      tokenProvider: () => 'token_test',
      serviceType: 'mock',
      fetchFn: async () => new Response(JSON.stringify({ success: true, data: { viewType: 'WARD_FULL_POLICY', config: DEFAULT_GUARDRAIL_POLICY_CONFIG } }), { status: 200 }),
    });

    assertEquals(mockClient.isMockService(), true, 'mockClient reports isMockService: true');
    assertEquals(mockClient.getServiceType(), 'mock', 'mockClient reports serviceType: mock');

    const regMock = new PolicyConfigRegistry({ loader: new PolicyConfigLoader({ storageProvider: new MemoryConfigStorageProvider() }) });
    const syncMock = new PolicySyncManager({ apiClient: mockClient, registry: regMock, userId: 'usr_alice' });
    await syncMock.syncDown();

    assertEquals(syncMock.getState().isMockService, true, 'SyncManager reports isMockService: true for mock fixture');
    assertEquals(syncMock.getState().serviceType, 'mock', 'SyncManager reports serviceType: mock');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 11: Real TCP HTTP Wire Integration Verification
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 11: Real TCP HTTP Wire Integration & Policy Persistence');
  {
    const backend = createBackendEnvironment();
    backend.tokenVerifier.registerToken('token_wire_alice', {
      actorId: 'usr_wire_alice',
      role: ActorRole.USER,
      isAuthenticated: true,
    });

    // Launch a real Node.js HTTP server on ephemeral port
    const server = http.createServer(async (req, res) => {
      await backend.router.handleHttpStream(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as AddressInfo;
    const wireBaseUrl = `http://127.0.0.1:${addr.port}`;
    console.log(`  [REAL LOCAL HTTP SERVER] Active on: ${wireBaseUrl}`);

    try {
      const realWireClient = new ApprovalApiClient({
        baseUrl: wireBaseUrl,
        tokenProvider: () => 'token_wire_alice',
        serviceType: 'live',
      });

      const reg = new PolicyConfigRegistry({ loader: new PolicyConfigLoader({ storageProvider: new MemoryConfigStorageProvider() }) });
      const syncManager = new PolicySyncManager({
        apiClient: realWireClient,
        registry: reg,
        userId: 'usr_wire_alice',
      });

      // 1. Initial retrieval over real wire
      const down1 = await syncManager.syncDown();
      assert(down1.success, 'Initial syncDown succeeds over real TCP HTTP wire');
      assertEquals(syncManager.getState().status, PolicySyncStatus.SYNCED, 'Status is SYNCED');
      assertEquals(syncManager.getState().activePolicyVersion, '1.0.0', 'Active version is 1.0.0');

      // 2. Ward updates policy over real wire with PUT request
      const candidate = cloneConfig(reg.getConfig());
      candidate.policyVersion = '1.0.1';
      candidate.trustedDomains = ['wire-test-banking.org'];

      const upRes = await syncManager.syncUp(candidate);
      assert(upRes.success, 'syncUp succeeds over real TCP HTTP wire');
      assertEquals(syncManager.getState().activePolicyVersion, '1.0.1', 'Active version is 1.0.1');

      // 3. Verify backend repository durability directly
      const direct = await backend.policyRepo.getPolicy('usr_wire_alice');
      assertEquals(direct?.policyVersion, '1.0.1', 'Backend repository persisted version 1.0.1 from real HTTP call');
      assert(direct?.config.trustedDomains.includes('wire-test-banking.org'), 'Backend repository persisted trusted domain');

      // 4. Stale update over real wire returns 409
      const staleCandidate = cloneConfig(reg.getConfig());
      staleCandidate.policyVersion = '1.0.1-stale';
      const staleRes = await realWireClient.updateUserPolicy('usr_wire_alice', {
        config: staleCandidate,
        expectedPolicyVersion: '1.0.0', // Stale expected version!
      });
      assert(!staleRes.success, 'Stale update rejected over real wire');
      assertEquals(staleRes.statusCode, 409, 'Real server returns HTTP 409');
      assertEquals(staleRes.error?.code, 'POLICY_VERSION_CONFLICT', 'Error code is POLICY_VERSION_CONFLICT');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      console.log('  [REAL LOCAL HTTP SERVER] Cleanly closed and stopped listening.');
    }
  }

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n====================================================================');
  console.log(`📊 POLICY PERSISTENCE & SYNCHRONIZATION: ${totalPassed} / ${totalPassed + totalFailed} PASSED`);
  if (totalFailed > 0) {
    console.error(`💥 ${totalFailed} TEST(S) FAILED!`);
    process.exit(1);
  } else {
    console.log('🎉 ALL PERSISTENCE, CONCURRENCY, OFFLINE & INVARIANT REQUIREMENTS SATISFIED!');
    console.log('====================================================================\n');
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error during test suite:', err);
  process.exit(1);
});
