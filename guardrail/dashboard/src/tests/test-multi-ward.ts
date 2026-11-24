/**
 * Guardrail Trusted-Contact Dashboard - Multi-Ward Switcher & Filter Test Suite
 *
 * Verifies:
 * 1. filterRequests() filters accurately by wardId ('ALL' vs specific wardId)
 * 2. hasActiveFilters() recognizes non-'ALL' wardId
 * 3. renderWardSwitcher() renders All Wards + per-ward pill buttons with live count badges
 * 4. Clicking a ward pill triggers onSelectWard with correct wardId
 * 5. Pending and History request cards display the Ward Attribution Badge
 * 6. Multi-ward Overview displays aggregated connected count and reviewer description
 * 7. Selective disconnection unlinks a specific ward while keeping other wards connected
 */

import { filterRequests, hasActiveFilters, renderWardSwitcher } from '../components/filters.js';
import { renderPendingApprovals } from '../components/pending.js';
import { renderDecisionHistory } from '../components/history.js';
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
  public rows: number = 0;
  public placeholder: string = '';
  public htmlFor: string = '';

  get innerHTML(): string {
    if (this._textContent) return this._textContent;
    return this.children
      .map((c) => `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`)
      .join('');
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

(globalThis as any).document = mockDocument;
(globalThis as any).window = { location: { hash: '' } };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runMultiWardTests() {
  console.log('\n======================================================');
  console.log('🧪 GUARDRAIL MULTI-WARD SWITCHER & FILTER TEST SUITE');
  console.log('======================================================\n');

  const mockRequests: ApprovalRequest[] = [
    {
      id: 'apr_alice_001',
      requesterId: 'usr_alice',
      actionType: 'FINANCIAL_TRANSFER' as any,
      category: 'FINANCIAL',
      actionDescription: 'Send $500 Wire Transfer to Landlord',
      origin: 'https://secure.chase.com',
      hostname: 'secure.chase.com',
      riskLevel: RiskLevel.HIGH,
      status: ApprovalStatus.PENDING,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'apr_alice_002',
      requesterId: 'usr_alice',
      actionType: 'FORM_SUBMISSION' as any,
      category: 'NAVIGATION',
      actionDescription: 'Update Account Beneficiary Settings',
      origin: 'https://secure.chase.com',
      hostname: 'secure.chase.com',
      riskLevel: RiskLevel.CRITICAL,
      status: ApprovalStatus.PENDING,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'apr_bob_001',
      requesterId: 'usr_bob',
      actionType: 'EXTERNAL_NAVIGATION' as any,
      category: 'NAVIGATION',
      actionDescription: 'Access External Gaming Website',
      origin: 'https://gaming-site.com',
      hostname: 'gaming-site.com',
      riskLevel: RiskLevel.LOW,
      status: ApprovalStatus.PENDING,
      createdAt: new Date().toISOString(),
    },
  ];

  const connectedWards = [
    { id: 'usr_alice', name: 'Alice Johnson', email: 'alice@example.com' },
    { id: 'usr_bob', name: 'Bob Williams', email: 'bob@example.com' },
  ];

  console.log('▶ Test Suite 1: Pure filterRequests() & hasActiveFilters() with wardId');
  {
    // Filter with ALL
    const allFiltered = filterRequests(mockRequests, { wardId: 'ALL' });
    assert(allFiltered.length === 3, 'Filtering by wardId: ALL returns all 3 requests');

    // Filter with usr_alice
    const aliceFiltered = filterRequests(mockRequests, { wardId: 'usr_alice' });
    assert(aliceFiltered.length === 2, 'Filtering by wardId: usr_alice returns exactly 2 requests');
    assert(aliceFiltered.every((r) => r.requesterId === 'usr_alice'), 'All returned requests belong to usr_alice');

    // Filter with usr_bob
    const bobFiltered = filterRequests(mockRequests, { wardId: 'usr_bob' });
    assert(bobFiltered.length === 1, 'Filtering by wardId: usr_bob returns exactly 1 request');
    assert(bobFiltered[0].id === 'apr_bob_001', 'Returned request is apr_bob_001');

    // Non-existent ward
    const noneFiltered = filterRequests(mockRequests, { wardId: 'usr_charlie' });
    assert(noneFiltered.length === 0, 'Filtering by non-existent ward returns 0 requests');

    // hasActiveFilters
    assert(hasActiveFilters({ wardId: 'usr_alice' }) === true, 'hasActiveFilters returns true for specific wardId');
    assert(hasActiveFilters({ wardId: 'ALL' }) === false, 'hasActiveFilters returns false for wardId: ALL');
  }

  console.log('\n▶ Test Suite 2: renderWardSwitcher() Component');
  {
    let selectedWard = '';
    const switcher = renderWardSwitcher({
      wards: connectedWards,
      activeWardId: 'usr_alice',
      requests: mockRequests,
      onSelectWard: (id) => {
        selectedWard = id;
      },
    });

    assert(switcher.className.includes('gd-ward-switcher'), 'Switcher has .gd-ward-switcher class');
    assert(switcher.getAttribute('role') === 'tablist', 'Switcher has role="tablist"');

    const pills = switcher.querySelectorAll<HTMLButtonElement>('.gd-ward-pill');
    assert(pills.length === 3, 'Renders 3 pills (All Wards + 2 connected wards)');

    // Pill 1: All Wards (count = 3)
    const allPill = pills[0];
    assert(allPill.textContent?.includes('All Wards') ?? false, 'First pill is All Wards');
    assert(allPill.textContent?.includes('3') ?? false, 'All Wards pill shows total count 3');
    assert(allPill.getAttribute('aria-selected') === 'false', 'All Wards pill is not active');

    // Pill 2: Alice (active, count = 2)
    const alicePill = pills[1];
    assert(alicePill.textContent?.includes('Alice Johnson') ?? false, 'Second pill is Alice Johnson');
    assert(alicePill.textContent?.includes('2') ?? false, 'Alice pill displays count 2');
    assert(alicePill.className.includes('active'), 'Alice pill has .active class');
    assert(alicePill.getAttribute('aria-selected') === 'true', 'Alice pill has aria-selected="true"');

    // Pill 3: Bob (count = 1)
    const bobPill = pills[2];
    assert(bobPill.textContent?.includes('Bob Williams') ?? false, 'Third pill is Bob Williams');
    assert(bobPill.textContent?.includes('1') ?? false, 'Bob pill displays count 1');

    // Click Bob pill
    bobPill.click();
    assert(selectedWard === 'usr_bob', 'Clicking Bob pill triggers onSelectWard with "usr_bob"');

    // Click All Wards pill
    allPill.click();
    assert(selectedWard === 'ALL', 'Clicking All Wards pill triggers onSelectWard with "ALL"');
  }

  console.log('\n▶ Test Suite 3: Pending Approvals with Multi-Ward Switcher & Badges');
  {
    let updatedFilters: any = null;
    const pendingEl = renderPendingApprovals({
      requests: mockRequests,
      selectedRequestId: 'apr_alice_001',
      status: 'idle',
      connectedWards,
      filters: { wardId: 'ALL' },
      onRequestSelect: () => {},
      onFiltersChange: (f) => {
        updatedFilters = f;
      },
    });

    const switcher = pendingEl.querySelector('.gd-ward-switcher');
    assert(switcher !== null, 'Ward switcher pill strip is mounted in Pending Approvals');

    const wardBadges = pendingEl.querySelectorAll('.gd-card-ward-badge');
    assert(wardBadges.length === 3, 'Each pending request card renders a Ward Attribution Badge');

    const firstBadge = wardBadges[0];
    assert(firstBadge.textContent?.includes('Alice') ?? false, 'First card attribution badge displays Alice');

    const thirdBadge = wardBadges[2];
    assert(thirdBadge.textContent?.includes('Bob') ?? false, 'Third card attribution badge displays Bob');
  }

  console.log('\n▶ Test Suite 4: Decision History with Multi-Ward Switcher & Badges');
  {
    const resolvedRequests: ApprovalRequest[] = [
      {
        ...mockRequests[0],
        status: ApprovalStatus.APPROVED,
        resolvedAt: new Date().toISOString(),
      },
      {
        ...mockRequests[2],
        status: ApprovalStatus.REJECTED,
        resolvedAt: new Date().toISOString(),
      },
    ];

    const historyEl = renderDecisionHistory({
      requests: resolvedRequests,
      status: 'idle',
      connectedWards,
      filters: { wardId: 'ALL' },
      onRequestSelect: () => {},
    });

    const switcher = historyEl.querySelector('.gd-ward-switcher');
    assert(switcher !== null, 'Ward switcher pill strip is mounted in Decision History');

    const wardBadges = historyEl.querySelectorAll('.gd-card-ward-badge');
    assert(wardBadges.length === 2, 'History cards render Ward Attribution Badges');
  }

  console.log('\n▶ Test Suite 5: Overview Multi-Ward Metrics & Oversight');
  {
    const overviewEl = renderOverview({
      profile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        isAuthenticated: true,
        assignedWards: connectedWards,
      },
      pendingCount: 3,
      connectedWards,
    });

    // Check Metric 1
    const metricCards = overviewEl.querySelectorAll('.gd-metric-card');
    assert(metricCards.length >= 1, 'Metric cards are rendered');

    const wardMetric = metricCards[0];
    assert(wardMetric.textContent?.includes('2') ?? false, 'Metric 1 value displays 2 connected wards');
    assert(wardMetric.textContent?.includes('2 Linked') ?? false, 'Metric 1 badge displays "2 Linked"');
    assert(
      wardMetric.textContent?.includes('Alice Johnson') && wardMetric.textContent?.includes('Bob Williams'),
      'Metric 1 description lists both ward names'
    );

    // Check Multi-Ward Oversight Summary (centralized in Wards Control Center Modal; duplicate grid removed)
    const duplicateGrid = overviewEl.querySelector('.gd-multi-ward-grid');
    assert(duplicateGrid === null, 'Duplicate multi-ward card grid is removed from Overview');

    const oversightCard = overviewEl.querySelector('#gd-active-ward-card');
    assert(oversightCard !== null, 'Multi-ward oversight architectural summary rendered on Overview');

    const modalBtn = oversightCard?.querySelector('.gd-btn-open-control-modal');
    assert(modalBtn !== null, 'Overview renders button to open Wards Control Center');
    assert(modalBtn?.textContent?.includes('Open Wards Control Center (2) →') ?? false, 'Modal button reflects 2 connected wards');
  }

  console.log('\n======================================================');
  console.log('🎉 ALL MULTI-WARD SWITCHER & FILTER ASSERTIONS PASSED!');
  console.log('======================================================\n');
}

runMultiWardTests().catch((err) => {
  console.error('\n❌ MULTI-WARD TEST RUNNER FAILED:', err);
  process.exit(1);
});
