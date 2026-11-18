import assert from 'node:assert';
import { extractOAuthRedirectToken } from '../index.js';
import { renderAuthModal } from '../components/auth-modal.js';
import { TrustedContactProfile } from '../types.js';

console.log('======================================================');
console.log('🛡️ TASK 2.1: CONSUMER SOCIAL LOGIN & OAUTH VERIFICATION');
console.log('======================================================\n');

// -----------------------------------------------------------------------------
// 1. Minimal DOM Simulation for Node Environment
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
  public placeholder: string = '';
  public autocomplete: string = '';
  public spellcheck: boolean = false;
  private _innerHTML: string = '';
  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(val: string) {
    this._innerHTML = val;
    if (val === '') {
      this.children = [];
    }
  }
  get firstChild(): MockElement | null {
    return this.children.length > 0 ? this.children[0] : null;
  }
  public classList: MockClassList;
  private listeners: Record<string, Function[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList();
  }

  get textContent(): string {
    if (this._textContent !== undefined) return this._textContent;
    if (this.children.length > 0) {
      return this.children.map((c) => c.textContent).join('');
    }
    return '';
  }

  set textContent(val: string) {
    this._textContent = val;
    this.children = [];
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
    if (name === 'class') {
      this.className = value;
      this.classList = new MockClassList(value);
    }
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string) {
    delete this.attributes[name];
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: MockElement) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  addEventListener(event: string, fn: Function) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(fn);
  }

  removeEventListener(event: string, fn: Function) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
    }
  }

  dispatchEvent(event: { type: string; preventDefault?: () => void }): boolean {
    if (typeof event.preventDefault !== 'function') {
      event.preventDefault = () => {};
    }
    const handlers = this.listeners[event.type] || [];
    handlers.forEach((h) => h(event));
    return true;
  }

  querySelector(selector: string): MockElement | null {
    const matches = this.querySelectorAll(selector);
    return matches.length > 0 ? matches[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const traverse = (el: MockElement) => {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (el.className.split(/\s+/).includes(cls) || el.classList.contains(cls)) {
          results.push(el);
        }
      } else if (selector.startsWith('#')) {
        const id = selector.slice(1);
        if (el.id === id) results.push(el);
      } else if (el.tagName.toLowerCase() === selector.toLowerCase()) {
        results.push(el);
      }
      el.children.forEach(traverse);
    };
    traverse(this);
    return results;
  }
}

// Global window/document setup
(globalThis as any).document = {
  createElement: (tag: string) => new MockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
};

let replacedHistoryUrls: string[] = [];
(globalThis as any).window = {
  location: {
    hash: '',
    search: '',
    pathname: '/dashboard',
    origin: 'http://localhost:5173',
    port: '5173',
  },
  history: {
    replaceState: (_state: any, _title: string, url: string) => {
      replacedHistoryUrls.push(url);
    },
  },
};

// -----------------------------------------------------------------------------
// Test Suite 1: OAuth Redirect Token Extraction & Address Bar Sanitization
// -----------------------------------------------------------------------------
console.log('▶ Test Suite 1: OAuth Redirect Token Extraction & History Sanitization');

// Case A: Hash access_token (standard OAuth2 / OIDC implicit / PKCE return)
(globalThis as any).window.location.hash = '#access_token=jwt_google_oauth_token_alpha&token_type=Bearer&expires_in=3600';
(globalThis as any).window.location.search = '';
replacedHistoryUrls = [];

const tokenFromHash = extractOAuthRedirectToken();
assert.strictEqual(tokenFromHash, 'jwt_google_oauth_token_alpha', 'Extracts access_token from hash fragment');
assert.strictEqual(replacedHistoryUrls.length, 1, 'History replaceState called to scrub address bar');
assert.strictEqual(replacedHistoryUrls[0], '/dashboard', 'Sanitized address bar to plain pathname without tokens');
console.log('  ✓ Successfully extracted access_token from hash and sanitized URL bar');

// Case B: Hash id_token (Clerk / OIDC return)
(globalThis as any).window.location.hash = '#id_token=jwt_clerk_id_token_beta';
(globalThis as any).window.location.search = '';
replacedHistoryUrls = [];

const idTokenFromHash = extractOAuthRedirectToken();
assert.strictEqual(idTokenFromHash, 'jwt_clerk_id_token_beta', 'Extracts id_token from hash fragment');
assert.strictEqual(replacedHistoryUrls.length, 1, 'History replaceState called to scrub id_token');
console.log('  ✓ Successfully extracted id_token from hash and sanitized URL bar');

// Case C: Search query parameter (?token=...)
(globalThis as any).window.location.hash = '';
(globalThis as any).window.location.search = '?token=jwt_query_token_gamma&state=xyz';
replacedHistoryUrls = [];

const tokenFromSearch = extractOAuthRedirectToken();
assert.strictEqual(tokenFromSearch, 'jwt_query_token_gamma', 'Extracts token from query search params');
assert.strictEqual(replacedHistoryUrls.length, 1, 'History replaceState called to scrub query token');
console.log('  ✓ Successfully extracted query token and sanitized URL bar');

// Case D: Search session_token (Clerk session parameter)
(globalThis as any).window.location.hash = '';
(globalThis as any).window.location.search = '?session_token=jwt_clerk_session_delta';
replacedHistoryUrls = [];

const sessionTokenFromSearch = extractOAuthRedirectToken();
assert.strictEqual(sessionTokenFromSearch, 'jwt_clerk_session_delta', 'Extracts session_token from query search params');
assert.strictEqual(replacedHistoryUrls.length, 1, 'History replaceState called to scrub session_token');
console.log('  ✓ Successfully extracted session_token and sanitized URL bar');

// Case E: Clean URL returns null
(globalThis as any).window.location.hash = '';
(globalThis as any).window.location.search = '';
replacedHistoryUrls = [];
assert.strictEqual(extractOAuthRedirectToken(), null, 'Returns null on clean URL');
assert.strictEqual(replacedHistoryUrls.length, 0, 'Does not alter history on clean URL');
console.log('  ✓ Clean URL cleanly returns null with zero history mutations');

// -----------------------------------------------------------------------------
// Test Suite 2: 1-Click Consumer Social Login Buttons Rendering
// -----------------------------------------------------------------------------
console.log('\n▶ Test Suite 2: 1-Click Consumer Social Login Buttons UI Inspection');

const mockProfile: TrustedContactProfile = {
  actorId: 'tc_carol',
  role: 'TRUSTED_CONTACT',
  email: 'carol.guardian@gmail.com',
  isAuthenticated: true,
  relationshipLabel: 'Designated Caretaker',
};

let capturedToken: string | null = null;
let capturedProfile: TrustedContactProfile | null = null;
let signedOutCalled = false;
let closedCalled = false;

const modalEl = renderAuthModal({
  profile: mockProfile,
  apiBaseUrl: 'http://127.0.0.1:3000',
  onAuthSuccess: (token, profile) => {
    capturedToken = token;
    capturedProfile = profile;
  },
  onSignOut: () => {
    signedOutCalled = true;
  },
  onClose: () => {
    closedCalled = true;
  },
}) as unknown as MockElement;

// 1. Social buttons container
const socialButtons = modalEl.querySelector('.gd-auth-social-buttons');
assert(socialButtons, 'Renders .gd-auth-social-buttons container');

// 2. Google button
const googleBtn = modalEl.querySelector('.gd-auth-google-btn');
assert(googleBtn, 'Renders .gd-auth-google-btn button');
assert(googleBtn.textContent.includes('Continue with Google'), 'Google button has "Continue with Google" label');
const googleIcon = googleBtn.querySelector('.gd-auth-social-icon');
assert(googleIcon, 'Google button contains social icon container');
assert(googleIcon.innerHTML.includes('#4285F4'), 'Google icon contains official multi-color SVG');
console.log('  ✓ "Continue with Google" button rendered with official multi-color SVG icon');

// 3. Apple button
const appleBtn = modalEl.querySelector('.gd-auth-apple-btn');
assert(appleBtn, 'Renders .gd-auth-apple-btn button');
assert(appleBtn.textContent.includes('Continue with Apple'), 'Apple button has "Continue with Apple" label');
const appleIcon = appleBtn.querySelector('.gd-auth-social-icon');
assert(appleIcon, 'Apple button contains social icon container');
assert(appleIcon.innerHTML.includes('M18.71'), 'Apple icon contains official Apple SVG path');
console.log('  ✓ "Continue with Apple" button rendered with official Apple SVG icon');

// 4. Phone Number button (Clerk-powered Phone SMS Auth)
const phoneBtn = modalEl.querySelector('.gd-auth-phone-btn');
assert(phoneBtn, 'Renders .gd-auth-phone-btn button');
assert(phoneBtn.textContent.includes('Continue with Phone Number'), 'Phone button has "Continue with Phone Number" label');
const phoneIcon = phoneBtn.querySelector('.gd-auth-social-icon');
assert(phoneIcon, 'Phone button contains social icon container');
assert(phoneIcon.innerHTML.includes('M22 16.92v3a2'), 'Phone icon contains official phone SVG path');
console.log('  ✓ "Continue with Phone Number" button rendered with official phone SVG icon');

// 5. Verification that "Sign in with Clerk" is NOT present (Clerk is the underlying engine, not consumer brand)
const clerkBtn = modalEl.querySelector('.gd-auth-clerk-btn');
assert.strictEqual(clerkBtn, null, 'Zero "Sign in with Clerk" buttons rendered (Clerk powers Google/Apple/Phone under the hood)');
console.log('  ✓ Consumer branding verification: "Sign in with Clerk" is excluded; Clerk seamlessly powers Google, Apple, and Phone');

// 6. Verification that developer shortcuts are removed in production
const devWrapper = modalEl.querySelector('.gd-auth-dev-wrapper');
assert.strictEqual(devWrapper, null, 'Developer shortcuts are cleanly removed for production');
console.log('  ✓ Production verification: developer shortcuts and test switchers are completely excluded');

// -----------------------------------------------------------------------------
// Test Suite 3: Interactive Click Simulation & Zero-Friction Dev Fallback
// -----------------------------------------------------------------------------
console.log('\n▶ Test Suite 3: Interactive Social Login Handler & Development Simulation');

// Mock fetch for auth/me verification
(globalThis as any).fetch = async (url: string, options?: any) => {
  if (url.includes('/api/v1/auth/config')) {
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          environment: 'development',
          oidcConfigured: false,
          issuer: null,
          audience: null,
          clientId: null,
          authUrl: null,
          tokenUrl: null,
          devTokensAvailable: true,
        },
      }),
    };
  }
  if (url.includes('/api/v1/auth/me')) {
    const authHeader = options?.headers?.Authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (token === 'test-contact-token') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            actorId: 'tc_carol',
            role: 'TRUSTED_CONTACT',
            email: null,
            environment: 'development',
          },
        }),
      };
    }
  }
  return {
    ok: false,
    status: 404,
    json: async () => ({ success: false, error: { message: 'Not found' } }),
  };
};

// Simulate clicking "Continue with Google"
googleBtn.dispatchEvent({ type: 'click' });

// Allow microtasks to complete
await new Promise((resolve) => setTimeout(resolve, 50));

assert.strictEqual(capturedToken, 'test-contact-token', 'Applied test contact token for development Google simulation');
assert(capturedProfile, 'Captured verified profile');
assert.strictEqual(capturedProfile?.actorId, 'tc_carol', 'Mapped to tc_carol actor');
assert.strictEqual(capturedProfile?.email, 'carol.guardian@gmail.com', 'Hydrated simulated Google email');
assert.strictEqual(capturedProfile?.role, 'TRUSTED_CONTACT', 'Role is TRUSTED_CONTACT');
assert.strictEqual(closedCalled, true, 'Dialog closed upon successful sign in');
console.log('  ✓ Clicking "Continue with Google" seamlessly authenticated as carol.guardian@gmail.com');

// -----------------------------------------------------------------------------
// Test Suite 4: In-Modal Phone Number & OTP Verification Flow
// -----------------------------------------------------------------------------
console.log('\n▶ Test Suite 4: In-Modal Phone Number & OTP Verification Flow');

let phoneToken: string | null = null;
let phoneProfile: TrustedContactProfile | null = null;
let phoneModalClosed = false;

const phoneModalEl = renderAuthModal({
  profile: null,
  apiBaseUrl: 'http://127.0.0.1:3000',
  onAuthSuccess: (token, profile) => {
    phoneToken = token;
    phoneProfile = profile;
  },
  onSignOut: () => {},
  onClose: () => {
    phoneModalClosed = true;
  },
}) as unknown as MockElement;

// 1. Initial State: Options View contains Phone Button
const phoneOptionBtn = phoneModalEl.querySelector('.gd-auth-phone-btn');
assert(phoneOptionBtn, 'Phone button exists in options view');

// 2. Click "Continue with Phone Number" -> Transitions to Phone Input View
phoneOptionBtn.dispatchEvent({ type: 'click' });
const phoneForm = phoneModalEl.querySelector('.gd-auth-phone-form');
assert(phoneForm, 'Transitions to .gd-auth-phone-form without leaving modal');
const phoneInput = phoneModalEl.querySelector('.gd-auth-phone-input') as unknown as { value: string };
assert(phoneInput, 'Renders .gd-auth-phone-input for mobile number');
console.log('  ✓ Clicking "Continue with Phone Number" transitions in-modal to phone input form');

// 3. Test Back Navigation
const backToOptionsBtn = phoneModalEl.querySelector('.gd-auth-btn-back');
assert(backToOptionsBtn, 'Renders back to options button');
backToOptionsBtn.dispatchEvent({ type: 'click' });
assert.strictEqual(phoneModalEl.querySelector('.gd-auth-phone-form'), null, 'Phone form dismissed');
assert(phoneModalEl.querySelector('.gd-auth-phone-btn'), 'Returned to social options view');
console.log('  ✓ "← Back to all options" seamlessly returns to initial button list');

// 4. Return to Phone View and Submit Number
phoneModalEl.querySelector('.gd-auth-phone-btn')?.dispatchEvent({ type: 'click' });
const activePhoneForm = phoneModalEl.querySelector('.gd-auth-phone-form')!;
const activePhoneInput = phoneModalEl.querySelector('.gd-auth-phone-input') as unknown as { value: string };
activePhoneInput.value = '+1 (555) 555-0100';

activePhoneForm.dispatchEvent({ type: 'submit' });
await new Promise((resolve) => setTimeout(resolve, 50));

// 5. Transitions to OTP Verification View
const otpForm = phoneModalEl.querySelector('.gd-auth-otp-form');
assert(otpForm, 'Transitions to .gd-auth-otp-form after submitting phone number');
const otpInput = phoneModalEl.querySelector('.gd-auth-otp-input') as unknown as { value: string };
assert(otpInput, 'Renders 6-digit .gd-auth-otp-input');
const resendBtn = phoneModalEl.querySelector('.gd-auth-resend-btn');
assert(resendBtn, 'Renders "Resend code" button');
const changePhoneBtn = phoneModalEl.querySelector('.gd-auth-change-phone-btn');
assert(changePhoneBtn, 'Renders "← Use different number" button');
console.log('  ✓ Submitting phone number transitions to 6-digit OTP verification view');

// 6. Submit OTP Code (e.g. 424242)
otpInput.value = '424242';
otpForm.dispatchEvent({ type: 'submit' });
await new Promise((resolve) => setTimeout(resolve, 50));

assert.strictEqual(phoneToken, 'test-contact-token', 'Successfully authenticated with token');
assert(phoneProfile, 'Hydrated authenticated profile');
assert.strictEqual(phoneProfile?.actorId, 'tc_carol', 'Authenticated actor');
assert.strictEqual(phoneProfile?.email, '+15555550100', 'Hydrated verified phone number');
assert.strictEqual(phoneModalClosed, true, 'Modal automatically closed on successful OTP verification');
console.log('  ✓ Verifying 6-digit code completes authentication and dismisses modal');

console.log('\n======================================================');
console.log('🎉 TASK 2.1 VERIFICATION COMPLETE: ALL ASSERTIONS PASSED!');
console.log('======================================================\n');
