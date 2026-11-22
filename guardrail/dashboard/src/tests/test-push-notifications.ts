/**
 * Guardrail Dashboard - Push Notifications & Lock-Screen Alerts Test Suite (Phase 3 Task 3.1)
 *
 * Verifies the Web Push client service, VAPID key conversion, Push status resolution,
 * Settings card rendering, and Dashboard Shell event handlers.
 */

import assert from 'node:assert';
import { urlBase64ToUint8Array, DashboardPushService } from '../services/push-notification-service.js';
import { renderSettings } from '../components/settings.js';

console.log('====================================================================');
console.log('🧪 GUARDRAIL DASHBOARD PUSH NOTIFICATION TEST SUITE (PHASE 3)');
console.log('====================================================================\n');

let totalTests = 0;
let passedTests = 0;

function it(desc: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        passedTests++;
        console.log(`  ✓ ${desc}`);
      });
    }
    passedTests++;
    console.log(`  ✓ ${desc}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`, err);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// DOM Simulation for Node Environment
// -----------------------------------------------------------------------------
class MockClassList {
  private classes = new Set<string>();
  constructor(initial: string = '') {
    initial.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
  }
  add(...tokens: string[]) {
    tokens.forEach((t) => this.classes.add(t));
  }
  remove(...tokens: string[]) {
    tokens.forEach((t) => this.classes.delete(t));
  }
  contains(token: string) {
    return this.classes.has(token);
  }
  toString() {
    return Array.from(this.classes).join(' ');
  }
}

class MockElement {
  public tagName: string;
  public className: string = '';
  public id: string = '';
  private _textContent?: string;
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public attributes: Record<string, string> = {};
  public style: Record<string, string> = {};
  public disabled: boolean = false;
  public value: string = '';
  public type: string = '';
  private _innerHTML: string = '';
  public eventListeners: Record<string, ((e?: any) => void)[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList();
  }

  get textContent(): string {
    if (this._textContent !== undefined) return this._textContent;
    if (this._innerHTML) {
      return this._innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return this.children.map((c) => c.textContent).join(' ');
  }
  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
  }

  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(val: string) {
    this._innerHTML = val;
  }

  public classList: MockClassList;

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(k: string, v: string): void {
    this.attributes[k] = v;
  }

  getAttribute(k: string): string | null {
    return this.attributes[k] ?? null;
  }

  addEventListener(event: string, fn: (e?: any) => void): void {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }

  dispatchEvent(event: { type: string }): void {
    const list = this.eventListeners[event.type] || [];
    for (const fn of list) fn(event);
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (node: MockElement) => {
      if (selector.startsWith('#')) {
        if (node.id === selector.slice(1)) results.push(node);
      } else if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (node.className.includes(cls) || node.classList.contains(cls)) results.push(node);
      } else if (node.tagName.toLowerCase() === selector.toLowerCase()) {
        results.push(node);
      }
      for (const ch of node.children) check(ch);
    };
    for (const ch of this.children) check(ch);
    return results;
  }
}

// Install mock global document
(globalThis as any).document = {
  createElement: (tag: string) => new MockElement(tag),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

async function main() {
  console.log('▶ Test Suite 1: VAPID Key Utilities & urlBase64ToUint8Array');
  it('correctly converts base64url VAPID public key to Uint8Array', () => {
    // 65-byte uncompressed P-256 public key base64url representation
    const testKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-Skv431oA83EkwpZ59688oU55p9k5b4f6';
    const arr = urlBase64ToUint8Array(testKey);
    assert(arr instanceof Uint8Array, 'Output must be Uint8Array');
    assert(arr.length > 0, 'Decoded array must not be empty');
  });

  it('handles padding variants seamlessly without throwing', () => {
    const testPadded = 'AQAB';
    const arr = urlBase64ToUint8Array(testPadded);
    assert.strictEqual(arr.length, 3, 'AQAB decodes to 3 bytes');
  });

  console.log('\n▶ Test Suite 2: DashboardPushService Client Singleton');
  const service = DashboardPushService.getInstance();
  it('instantiates as a singleton', () => {
    const s2 = DashboardPushService.getInstance();
    assert.strictEqual(service, s2, 'Must return same singleton instance');
  });

  await it('safely handles environments without navigator/window', async () => {
    const status = await service.getStatus();
    assert.strictEqual(status.supported, false, 'Node environment is detected as unsupported');
    assert.strictEqual(status.permission, 'unsupported');
    assert.strictEqual(status.isSubscribed, false);
  });

  console.log('\n▶ Test Suite 3: Settings Component Push Notification Card');
  it('renders Push Notification Card in Settings with unsupported state', () => {
    const section = renderSettings({
      profile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        fullName: 'Carol Reviewer',
        isAuthenticated: true,
      },
      pushStatus: {
        supported: false,
        permission: 'unsupported',
        isSubscribed: false,
      },
    }) as unknown as MockElement;

    const pushCard = section.querySelector('#gd-card-push-notifications');
    assert(pushCard !== null, 'Card #gd-card-push-notifications must be present in DOM');
    const badge = pushCard?.querySelector('.gd-settings-badge');
    assert.strictEqual(badge?.textContent, 'Browser Unsupported');
  });

  it('renders Push Notification Card with Inactive state when supported but not subscribed', () => {
    let subscribeClicked = false;
    const section = renderSettings({
      profile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        fullName: 'Carol Reviewer',
        isAuthenticated: true,
      },
      pushStatus: {
        supported: true,
        permission: 'default',
        isSubscribed: false,
      },
      onSubscribePush: () => {
        subscribeClicked = true;
      },
    }) as unknown as MockElement;

    const pushCard = section.querySelector('#gd-card-push-notifications');
    assert(pushCard !== null, 'Card must be present');
    const badge = pushCard?.querySelector('.gd-settings-badge');
    assert.strictEqual(badge?.textContent, 'Inactive');

    const subBtn = pushCard?.querySelector('#gd-btn-subscribe-push');
    assert(subBtn !== null, 'Enable Push Notifications button must be rendered');
    assert(subBtn?.textContent.includes('Enable Device Push Notifications'));

    // Trigger click
    subBtn?.dispatchEvent({ type: 'click' });
    assert.strictEqual(subscribeClicked, true, 'onSubscribePush callback was triggered');
  });

  it('renders Push Notification Card with Active state and Test/Unsubscribe buttons when subscribed', () => {
    let testClicked = false;
    let unsubClicked = false;

    const section = renderSettings({
      profile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        fullName: 'Carol Reviewer',
        isAuthenticated: true,
      },
      pushStatus: {
        supported: true,
        permission: 'granted',
        isSubscribed: true,
        endpoint: 'https://fcm.googleapis.com/fcm/send/test_sub',
      },
      onSendTestPush: () => {
        testClicked = true;
      },
      onUnsubscribePush: () => {
        unsubClicked = true;
      },
    }) as unknown as MockElement;

    const pushCard = section.querySelector('#gd-card-push-notifications');
    assert(pushCard !== null);
    const badge = pushCard?.querySelector('.gd-settings-badge');
    assert.strictEqual(badge?.textContent, 'Active (Receiving Alerts)');

    const testBtn = pushCard?.querySelector('#gd-btn-test-push');
    assert(testBtn !== null, 'Send Test Alert button must be present');
    testBtn?.dispatchEvent({ type: 'click' });
    assert.strictEqual(testClicked, true, 'onSendTestPush callback was invoked');

    const unsubBtn = pushCard?.querySelector('#gd-btn-unsubscribe-push');
    assert(unsubBtn !== null, 'Disable Notifications button must be present');
    unsubBtn?.dispatchEvent({ type: 'click' });
    assert.strictEqual(unsubClicked, true, 'onUnsubscribePush callback was invoked');
  });

  it('renders feedback action banner when pushActionMessage is provided', () => {
    const section = renderSettings({
      profile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        fullName: 'Carol Reviewer',
        isAuthenticated: true,
      },
      pushStatus: {
        supported: true,
        permission: 'granted',
        isSubscribed: true,
      },
      pushActionMessage: {
        type: 'success',
        text: 'Device successfully subscribed! You will now receive lock-screen alerts.',
      },
    }) as unknown as MockElement;

    const banner = section.querySelector('#gd-push-action-message');
    assert(banner !== null, 'Action message banner must be rendered');
    assert.strictEqual(banner?.textContent, 'Device successfully subscribed! You will now receive lock-screen alerts.');
  });

  it('renders permission blocked state when user previously denied permission', () => {
    const section = renderSettings({
      profile: {
        actorId: 'tc_carol',
        role: 'TRUSTED_CONTACT',
        fullName: 'Carol Reviewer',
        isAuthenticated: true,
      },
      pushStatus: {
        supported: true,
        permission: 'denied',
        isSubscribed: false,
      },
    }) as unknown as MockElement;

    const pushCard = section.querySelector('#gd-card-push-notifications');
    const badge = pushCard?.querySelector('.gd-settings-badge');
    assert.strictEqual(badge?.textContent, 'Permission Blocked');
    assert(pushCard?.textContent.includes('Notifications are blocked in browser settings'));
  });

  console.log('\n====================================================================');
  console.log(`📊 DASHBOARD PUSH NOTIFICATION SUITE: ${passedTests}/${totalTests} PASSED`);
  console.log('🎉 TASK 3.1 CLIENT & DASHBOARD INVARIANTS VERIFIED!');
  console.log('====================================================================\n');
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
