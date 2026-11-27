/**
 * Guardrail Trusted-Contact Dashboard - Wards Control Modal Test Suite
 *
 * Verifies:
 * 1. Overview "01 / Wards" metric card has interactive button attributes and manage tag
 * 2. Clicking or pressing Enter on the metric card calls onOpenWardsControl
 * 3. renderWardsControlModal() renders modal backdrop, card, header, and summary stats
 * 4. Renders each connected ward with avatar, formatted name, email, and queue status
 * 5. Clicking "Review Approvals" invokes onFilterWardPending with the target ward ID
 * 6. Clicking "Disconnect Ward" displays inline confirmation prompt
 * 7. Confirming disconnect invokes onDisconnectWard with target ward ID
 * 8. Pairing section allows submitting an invitation code via onConnectInvitation
 * 9. Empty state renders cleanly when no wards are connected
 * 10. Close button invokes onClose
 */

import { renderWardsControlModal } from '../components/wards-control-modal.js';
import { renderOverview } from '../components/overview.js';
import { ApprovalRequest, ApprovalStatus, RiskLevel } from '../types.js';

// =============================================================================
// DOM Simulation for Node.js
// =============================================================================
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
  public maxLength: number = 100;

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
    return this._textContent;
  }
  set innerHTML(val: string) {
    this._textContent = val.replace(/<[^>]*>/g, '');
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'id') this.id = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }
  removeAttribute(name: string): void {
    delete this.attributes[name];
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

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
    }
  }

  dispatchEvent(event: { type: string; [key: string]: any }): boolean {
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) {
      h({ target: this, preventDefault: () => {}, ...event });
    }
    return true;
  }

  click(): void {
    this.dispatchEvent({ type: 'click' });
  }

  querySelector(selector: string): MockDOMElement | null {
    const results = this.querySelectorAll(selector);
    return results.length > 0 ? results[0] : null;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];

    const matches = (el: MockDOMElement): boolean => {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1).split('.')[0];
        return el.classList.contains(cls);
      }
      if (selector.startsWith('#')) {
        return el.id === selector.slice(1);
      }
      if (selector.includes('[') && selector.includes('=')) {
        const match = selector.match(/\[([a-zA-Z0-9_-]+)="?([^"\]]+)"?\]/);
        if (match) {
          const [, attr, val] = match;
          return el.getAttribute(attr) === val;
        }
      }
      return el.tagName.toLowerCase() === selector.toLowerCase();
    };

    const traverse = (node: MockDOMElement) => {
      for (const child of node.children) {
        if (matches(child)) results.push(child);
        traverse(child);
      }
    };

    traverse(this);
    return results;
  }
}

// Global document simulation
const mockDocument = {
  createElement(tag: string) {
    return new MockDOMElement(tag);
  },
  createElementNS(_ns: string, tag: string) {
    return new MockDOMElement(tag);
  },
  getElementById(id: string) {
    return mockDocument.body.querySelector(`#${id}`);
  },
  querySelectorAll(sel: string) {
    return mockDocument.body.querySelectorAll(sel);
  },
  body: new MockDOMElement('BODY'),
  addEventListener() {},
  removeEventListener() {},
};

(globalThis as any).document = mockDocument;

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    console.error(`❌ FAIL: ${message}\n  Expected: ${expectedStr}\n  Received: ${actualStr}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

function assertTrue(actual: unknown, message: string): void {
  if (!actual) {
    console.error(`❌ FAIL: ${message}\n  Expected truthy, got: ${actual}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

// =============================================================================
// Mock Fixtures
// =============================================================================
const mockWards = [
  {
    id: 'usr_alice',
    name: 'Alice Johnson',
    email: 'alice.johnson@example.com',
    relationshipLabel: 'Designated Caretaker',
  },
  {
    id: 'usr_bob',
    name: 'Bob Williams',
    email: 'bob.williams@example.com',
    relationshipLabel: 'Designated Caretaker',
  },
];

const mockPending: ApprovalRequest[] = [
  {
    id: 'apr_alice_001',
    actionId: 'act_alice_001',
    requesterId: 'usr_alice',
    actionType: 'SUBMIT' as any,
    category: 'PAYMENT' as any,
    actionDescription: 'Send Wire Transfer to Landlord',
    origin: 'https://secure.chase.com',
    hostname: 'secure.chase.com',
    riskLevel: RiskLevel.HIGH,
    status: ApprovalStatus.PENDING,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    riskReasons: ['Exceeds safety threshold'],
  },
  {
    id: 'apr_bob_001',
    actionId: 'act_bob_001',
    requesterId: 'usr_bob',
    actionType: 'SUBMIT' as any,
    category: 'PAYMENT' as any,
    actionDescription: 'Purchase Gaming Console Bundle',
    origin: 'https://www.amazon.com',
    hostname: 'www.amazon.com',
    riskLevel: RiskLevel.MEDIUM,
    status: ApprovalStatus.PENDING,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    riskReasons: ['High-value e-commerce checkout'],
  },
];

// =============================================================================
// Test Suites
// =============================================================================
async function runTests(): Promise<void> {
  console.log('======================================================');
  console.log('🧪 GUARDRAIL WARDS CONTROL MODAL TEST SUITE');
  console.log('======================================================\n');

  // ---------------------------------------------------------------------------
  // Suite 1: Interactive Metric Card on Overview
  // ---------------------------------------------------------------------------
  console.log('▶ Test Suite 1: Interactive Wards Metric Card on Overview');
  let openModalCalled = false;

  const overviewEl = renderOverview({
    profile: {
      actorId: 'tc_carol',
      role: 'TRUSTED_CONTACT' as any,
      isAuthenticated: true,
      assignedWardId: 'usr_alice',
      assignedWardName: 'Alice Johnson',
    },
    pendingCount: 2,
    connectedWards: mockWards,
    pendingRequests: mockPending,
    onOpenWardsControl: () => {
      openModalCalled = true;
    },
  });

  const wardMetricCard = overviewEl.querySelector('.gd-metric-card-ward');
  assertTrue(wardMetricCard !== null, 'Metric card has .gd-metric-card-ward class');
  assertTrue(wardMetricCard?.classList.contains('gd-metric-card-interactive'), 'Metric card has .gd-metric-card-interactive class');
  assertEquals(wardMetricCard?.getAttribute('role'), 'button', 'Metric card has role="button"');
  assertEquals(wardMetricCard?.getAttribute('tabindex'), '0', 'Metric card has tabindex="0"');
  assertEquals(wardMetricCard?.getAttribute('aria-haspopup'), 'dialog', 'Metric card has aria-haspopup="dialog"');

  const manageTag = wardMetricCard?.querySelector('.gd-metric-manage-tag');
  assertTrue(manageTag !== null, 'Metric card renders .gd-metric-manage-tag');
  assertTrue(manageTag?.textContent.includes('Manage'), 'Manage tag displays "Manage" label');

  // Trigger click
  wardMetricCard?.click();
  assertTrue(openModalCalled, 'Clicking metric card invokes onOpenWardsControl callback');

  // Trigger keydown Enter
  openModalCalled = false;
  wardMetricCard?.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assertTrue(openModalCalled, 'Pressing Enter on metric card invokes onOpenWardsControl callback');

  // ---------------------------------------------------------------------------
  // Suite 2: renderWardsControlModal() Structure & Summary
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 2: renderWardsControlModal() Structure & Summary');
  let closed = false;
  let filteredWardPending = '';
  let disconnectedWardId = '';
  let connectedCode = '';

  const modalEl = renderWardsControlModal({
    connectedWards: mockWards,
    pendingRequests: mockPending,
    onClose: () => {
      closed = true;
    },
    onFilterWardPending: (wId) => {
      filteredWardPending = wId;
    },
    onDisconnectWard: (wId) => {
      disconnectedWardId = wId;
    },
    onConnectInvitation: async (code) => {
      connectedCode = code;
      return { success: true, wardId: 'usr_new' };
    },
  });

  assertEquals(modalEl.getAttribute('role'), 'dialog', 'Modal backdrop has role="dialog"');
  assertEquals(modalEl.getAttribute('aria-modal'), 'true', 'Modal backdrop has aria-modal="true"');
  assertTrue(modalEl.classList.contains('gd-wards-modal-backdrop'), 'Has .gd-wards-modal-backdrop class');

  const card = modalEl.querySelector('.gd-wards-modal-card');
  assertTrue(card !== null, 'Modal card container exists');

  const title = card?.querySelector('#gd-wards-modal-title');
  assertEquals(title?.textContent, 'Managed Wards', 'Header renders "Managed Wards" title');

  const countBadge = card?.querySelector('.gd-wards-modal-badge');
  assertEquals(countBadge?.textContent, '2 Connected', 'Header badge displays "2 Connected"');

  const summaryStrip = card?.querySelector('.gd-wards-modal-summary-strip');
  assertTrue(summaryStrip !== null, 'Summary strip exists');

  // ---------------------------------------------------------------------------
  // Suite 3: Ward Items & Per-Ward Controls
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 3: Ward Items & Per-Ward Controls');
  const wardCards = card?.querySelectorAll('.gd-ward-control-card') || [];
  assertEquals(wardCards.length, 2, 'Renders exactly 2 ward control cards');

  // Inspect first card (Alice)
  const aliceCard = wardCards[0];
  assertEquals(aliceCard.getAttribute('data-ward-id'), 'usr_alice', 'First card has data-ward-id="usr_alice"');

  const aliceAvatar = aliceCard.querySelector('.gd-ward-control-avatar');
  const aliceAvatarIcon = aliceAvatar?.querySelector('.gd-ward-avatar-icon');
  assertTrue(aliceAvatarIcon !== null, 'Alice avatar renders warm profile icon fallback when no photo URL');

  const aliceName = aliceCard.querySelector('.gd-ward-control-name');
  assertEquals(aliceName?.textContent, 'Alice Johnson', 'Alice name renders correctly');

  const aliceEmail = aliceCard.querySelector('.gd-ward-control-email');
  assertEquals(aliceEmail?.textContent, 'alice.johnson@example.com', 'Alice email renders correctly');

  const aliceBadge = aliceCard.querySelector('.gd-ward-pending-badge');
  assertEquals(aliceBadge?.textContent.trim(), '1', 'Alice shows compact pending count "1"');
  assertTrue(aliceBadge?.getAttribute('aria-label')?.includes('1 Pending Approval') ?? false, 'Alice pending badge retains accessible label');

  // Test Review button on Alice's card
  const aliceReviewBtn = aliceCard.querySelector('.gd-ward-btn-primary');
  assertTrue(aliceReviewBtn !== null, 'Alice card renders primary review button');
  aliceReviewBtn?.click();
  assertTrue(closed, 'Clicking review closes the modal');
  assertEquals(filteredWardPending, 'usr_alice', 'Clicking review filters pending approvals to usr_alice');

  // Test Disconnect inline confirmation on Bob's card
  const bobCard = wardCards[1];
  const bobDisconnectBtn = bobCard.querySelector('.gd-ward-btn-disconnect');
  assertTrue(bobDisconnectBtn !== null, 'Bob card renders disconnect button');

  const confirmContainer = bobCard.querySelector('.gd-ward-disconnect-confirm');
  assertEquals(confirmContainer?.style.display, 'none', 'Confirmation is initially hidden');

  // Click disconnect button to show confirmation
  bobDisconnectBtn?.click();
  assertEquals(confirmContainer?.style.display, 'flex', 'Confirmation displays when Disconnect clicked');

  const confirmYesBtn = confirmContainer?.querySelector('.gd-ward-btn-confirm-yes');
  assertTrue(confirmYesBtn !== null, 'Confirm Yes button exists');
  confirmYesBtn?.click();
  assertEquals(disconnectedWardId, 'usr_bob', 'Confirming disconnect calls onDisconnectWard with usr_bob');

  // ---------------------------------------------------------------------------
  // Suite 4: Quick Pairing Section
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 4: Quick Pairing Section');
  const pairSection = card?.querySelector('.gd-wards-pair-section');
  assertTrue(pairSection !== null, 'Pairing section is rendered');

  const pairInput = pairSection?.querySelector('.gd-wards-pair-input');
  assertTrue(pairInput !== null, 'Pairing input field is present');
  pairInput!.value = 'test-code';

  const pairForm = pairSection?.querySelector('.gd-wards-pair-form');
  assertTrue(pairForm !== null, 'Pairing form exists');
  pairForm?.dispatchEvent({ type: 'submit' });
  assertEquals(connectedCode, 'TEST-CODE', 'Pairing form capitalizes and submits invitation code');

  // ---------------------------------------------------------------------------
  // Suite 5: Empty State & Close
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 5: Empty State & Close');
  let emptyClosed = false;
  const emptyModal = renderWardsControlModal({
    connectedWards: [],
    pendingRequests: [],
    onClose: () => {
      emptyClosed = true;
    },
  });

  const emptyEl = emptyModal.querySelector('.gd-wards-modal-empty');
  assertTrue(emptyEl !== null, 'Renders .gd-wards-modal-empty when connectedWards is empty');

  const closeBtn = emptyModal.querySelector('.gd-wards-modal-close-btn');
  assertTrue(closeBtn !== null, 'Close button exists');
  closeBtn?.click();
  assertTrue(emptyClosed, 'Clicking close button triggers onClose');

  // ---------------------------------------------------------------------------
  // Suite 6: Real Ward Account Image Support
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 6: Real Ward Account Image Support');
  const photoModal = renderWardsControlModal({
    connectedWards: [
      {
        id: 'usr_real',
        name: 'Real Ward',
        email: 'real@example.com',
        imageUrl: 'https://example.com/ward-photo.jpg',
      },
    ],
    pendingRequests: [],
    onClose: () => {},
  });
  const photoImg = photoModal.querySelector('.gd-ward-control-avatar-img') as any;
  assertTrue(photoImg !== null, 'Renders .gd-ward-control-avatar-img when ward imageUrl is provided');
  assertEquals(photoImg?.src, 'https://example.com/ward-photo.jpg', 'Ward avatar image src matches real account image');

  // ---------------------------------------------------------------------------
  // Suite 7: "+ Connect Another Ward" Prompts for Pairing Code Before Connecting
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 7: Overview "+ Connect Another Ward" Code Prompt');
  const submittedCodes: string[] = [];
  const multiOverview = renderOverview({
    profile: { actorId: 'tc_deepanshu', role: 'TRUSTED_CONTACT', isAuthenticated: true },
    pendingCount: 0,
    pendingRequests: [],
    connectedWards: mockWards,
    onConnectInvitation: async (code: string) => {
      submittedCodes.push(code);
      return { success: true, wardId: 'usr_new_ward', wardName: 'New Ward' };
    },
  });

  const addAnotherBtn = multiOverview.querySelector('.gd-link-add-ward');
  assertTrue(addAnotherBtn !== null, 'Overview renders "+ Connect Another Ward" button');
  addAnotherBtn?.click();

  const connectModalRoot = mockDocument.getElementById('gd-connect-modal-root');
  assertTrue(connectModalRoot !== null, 'Clicking "+ Connect Another Ward" opens connect modal');
  const modalTitle = connectModalRoot?.querySelector('#gd-connect-modal-title');
  assertEquals(modalTitle?.textContent, 'Connect Another Ward', 'Modal starts in code-entry step instead of connecting immediately');
  assertEquals(submittedCodes.length, 0, 'Does NOT call onConnectInvitation with undefined before user enters a code');

  const codeInput = connectModalRoot?.querySelector('#gd-connect-modal-code-input') as any;
  assertTrue(codeInput !== null, 'Code entry input is rendered inside modal');
  const modalForm = connectModalRoot?.querySelector('form');
  assertTrue(modalForm !== null, 'Code entry form is rendered inside modal');

  // Invalid format stays on code-entry step
  if (codeInput && modalForm) {
    codeInput.value = 'bad';
    modalForm.dispatchEvent({ type: 'submit' });
    assertEquals(submittedCodes.length, 0, 'Rejects invalid code format without calling backend');

    // Valid 8-digit code normalizes to XXXX-YYYY and starts connection
    codeInput.value = '48291735';
    modalForm.dispatchEvent({ type: 'submit' });
    assertEquals(submittedCodes, ['4829-1735'], 'Normalizes entered code and submits to onConnectInvitation');
    const connectingTitle = connectModalRoot?.querySelector('#gd-connect-modal-title');
    assertEquals(connectingTitle?.textContent, 'Connecting to Ward', 'Transitions cleanly to Connecting to Ward state after valid code');
    connectModalRoot?.querySelector('.gd-auth-modal-close-btn')?.click();
  }

  console.log('\n======================================================');
  console.log('🎉 ALL WARDS CONTROL MODAL TESTS PASSED (100%)!');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
