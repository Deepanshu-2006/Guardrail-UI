/**
 * Guardrail UI - Day 20 Prompt 6: Privacy and Failure Testing Suite
 *
 * Verifies privacy guarantees, sensitive data redaction, and safe failure behavior across:
 * - Suite 1: DOM Inspection & Action Extraction Privacy (Tasks 1 & 2)
 * - Suite 2: Cross-Context Messaging & Diagnostic Payload Redaction (Tasks 1, 2, 4)
 * - Suite 3: Wire Layer Sanitization & Pre-Dispatch Scanning (Tasks 1, 2, 4)
 * - Suite 4: Service Failure Simulation & Safe Non-Execution (Tasks 3 & 4)
 * - Suite 5: Storage Failures, Cooldown & Configuration Health Transitions (Tasks 3 & 5)
 * - Suite 6: Caretaker Dashboard Privacy & Truthful Failure States (Tasks 3, 4, 5)
 */

import http from 'http';
import { startControlledTestServers, RunningTestServers } from './test-server.js';
import {
  ApprovalApiClient,
  ApiClientErrorCodes,
  checkPayloadForSensitiveFields,
} from '../approval/client.js';
import {
  ApprovalRequest,
  ApprovalStatus,
} from '../types/approval.js';
import {
  ActionCategory,
  ActionType,
  GuardrailAction,
} from '../types/actions.js';
import { RiskLevel } from '../types/risk.js';
import { ResponseAction } from '../types/response.js';
import { InterceptionState } from '../types/interception.js';
import { StagingActionContext } from '../types/staging.js';
import { InterceptionController } from '../interception/controller.js';
import { ContinuationManager } from '../interception/continuation.js';
import {
  ContinuationValidationService,
  ContinuationEligibilityStatus,
} from '../interception/validation-service.js';
import {
  createApprovalActionBinding,
  computeActionDigest,
  ApprovalActionBindingState,
} from '../approval/binding.js';
import {
  submitApprovalRequest,
  SubmissionOutcome,
  validateBackendApprovalResponse,
} from '../approval/submit-operation.js';
import {
  dispatchActionToBackground,
  dispatchSubmitApprovalRequestToBackground,
} from '../utils/messaging.js';
import {
  extractElementInfo,
  extractPageInfo,
} from '../utils/dom.js';
import {
  sanitizeUrlForDiagnostics,
  sanitizeForDiagnostics,
  isPrivacySafe,
  createDiagnosticLogger,
} from '../utils/privacy.js';
import {
  sanitizeApprovalErrorMessage,
  UIApprovalStatus,
  determineApprovalState,
} from '../staging/status.js';
import {
  mergeConfigWithDefaults,
  PolicyConfigLoader,
  ConfigStorageProvider,
  sanitizeLogString,
  scanForSensitiveContent,
} from '../config/loader.js';
import {
  ConfigHealthStatus,
} from '../types/config.js';
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
} from '../config/schema.js';
import {
  RiskPolicyId,
} from '../types/policy.js';
import {
  cancelControlledActionUntilPolicyInitialized,
  isPolicyConfigurationInitialized,
} from '../config/readiness.js';
import {
  evaluateActionPipeline,
} from '../response/engine.js';
import { DashboardShell } from '../../../dashboard/src/shell.js';

// =============================================================================
// Synthetic Privacy Test Sentinels (Zero Real Credentials)
// =============================================================================

const SYNTH_SENTINELS = {
  PASSWORD: 'syn_pwd_SuperSecretPassword!#99',
  OTP: 'syn_otp_847291',
  CARD_NUMBER: 'syn_card_4532015099881122',
  CVV: 'syn_cvv_921',
  AUTH_TOKEN: 'syn_tok_bearer_secret_token_aabbcc',
  SESSION_ID: 'syn_sess_secret_session_identifier_8888',
  SSN: 'syn_ssn_000-12-3456',
  RAW_FORM_VALUE: 'syn_form_secret_user_input_data',
  QUERY_PARAM_TOKEN: 'syn_query_token_12345',
} as const;

// Helper to audit that NO sentinels leaked into a given string or object
function assertNoSentinelLeakage(target: unknown, contextDescription: string): void {
  const serialized = typeof target === 'string' ? target : JSON.stringify(target);
  for (const [name, sentinel] of Object.entries(SYNTH_SENTINELS)) {
    if (serialized.includes(sentinel)) {
      throw new Error(
        `[PRIVACY LEAK DETECTED] Sensitive sentinel "${name}" leaked into ${contextDescription}!`
      );
    }
  }
}

// =============================================================================
// Assertion Utilities
// =============================================================================

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition: boolean, message: string): void {
  totalAssertions++;
  if (!condition) {
    console.error(`  ❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  passedAssertions++;
  console.log(`  ✓ ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  totalAssertions++;
  if (actual !== expected) {
    console.error(`  ❌ ASSERTION FAILED: ${message} (expected "${expected}", got "${actual}")`);
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
  passedAssertions++;
  console.log(`  ✓ ${message}: ${actual}`);
}

// =============================================================================
// Headless DOM Mocks for DOM & Dashboard Testing
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
  public classList: MockDOMTokenList;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  public value?: string;
  public placeholder?: string;
  public type?: string;
  public innerText?: string;
  public textContent: string = '';
  public attributes: Record<string, string> = {};
  public children: MockDOMElement[] = [];
  public parentNode: MockDOMElement | null = null;
  public form: MockDOMElement | null = null;
  public isConnected: boolean = true;
  public style: Record<string, string> = {};

  constructor(tagName: string, id: string = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.classList = new MockDOMTokenList();
  }

  get className(): string {
    return this.classList.toString();
  }
  set className(val: string) {
    this.classList = new MockDOMTokenList(val);
  }

  get innerHTML(): string {
    return this.textContent;
  }
  set innerHTML(val: string) {
    this.textContent = val;
  }

  addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
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

  hasAttribute(name: string): boolean {
    return name.toLowerCase() in this.attributes;
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

  closest<T extends MockDOMElement>(selector: string): T | null {
    const sel = selector.toLowerCase();
    if (sel.includes(this.tagName.toLowerCase())) return this as unknown as T;
    if (this.id && sel.includes(`#${this.id.toLowerCase()}`)) return this as unknown as T;
    return this.parentNode ? this.parentNode.closest<T>(selector) : null;
  }

  querySelector<T extends MockDOMElement>(selector: string): T | null {
    const sel = selector.toLowerCase();
    for (const child of this.children) {
      if (sel.includes(child.tagName.toLowerCase())) return child as unknown as T;
      if (child.id && sel.includes(`#${child.id.toLowerCase()}`)) return child as unknown as T;
      const found = child.querySelector<T>(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll<T extends MockDOMElement>(selector: string): T[] {
    const results: T[] = [];
    const sel = selector.toLowerCase();
    for (const child of this.children) {
      if (sel.includes(child.tagName.toLowerCase()) || (child.id && sel.includes(`#${child.id.toLowerCase()}`))) {
        results.push(child as unknown as T);
      }
      results.push(...child.querySelectorAll<T>(selector));
    }
    return results;
  }
}

class MockHTMLFormElement extends MockDOMElement {}
class MockHTMLInputElement extends MockDOMElement {}
class MockHTMLTextAreaElement extends MockDOMElement {}
class MockHTMLSelectElement extends MockDOMElement {}
class MockHTMLButtonElement extends MockDOMElement {}

if (typeof (globalThis as any).HTMLFormElement === 'undefined') {
  (globalThis as any).HTMLFormElement = MockHTMLFormElement;
  (globalThis as any).HTMLInputElement = MockHTMLInputElement;
  (globalThis as any).HTMLTextAreaElement = MockHTMLTextAreaElement;
  (globalThis as any).HTMLSelectElement = MockHTMLSelectElement;
  (globalThis as any).HTMLButtonElement = MockHTMLButtonElement;
  (globalThis as any).HTMLElement = MockDOMElement;
  (globalThis as any).Element = MockDOMElement;
}

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => new MockDOMElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: 'visible',
  };
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { hash: '#pending', href: 'http://127.0.0.1:3000' },
  };
}

// =============================================================================
// Helper Factories
// =============================================================================

function createSyntheticTestAction(actionId: string, overrides?: Partial<GuardrailAction>): GuardrailAction {
  return {
    id: actionId,
    type: ActionType.CLICK,
    category: ActionCategory.DESTRUCTIVE,
    element: {
      tagName: 'BUTTON',
      id: 'btn-delete-account',
      visibleText: 'Delete Account and Data',
    },
    page: {
      url: `http://127.0.0.1:8880/settings?token=${SYNTH_SENTINELS.QUERY_PARAM_TOKEN}#section`,
      title: 'Account Settings',
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createSyntheticStagingContext(action: GuardrailAction, overrides?: Partial<StagingActionContext>): StagingActionContext {
  return {
    actionId: action.id,
    actionType: action.type,
    category: action.category || ActionCategory.DESTRUCTIVE,
    riskLevel: RiskLevel.CRITICAL,
    riskScore: 100,
    description: 'Delete Account and Data',
    reasons: ['Critical irreversible operation'],
    suggestedDecision: ResponseAction.PROTECT,
    interceptionState: InterceptionState.HELD,
    url: action.page.url,
    timestamp: action.timestamp,
    ...overrides,
  };
}

// =============================================================================
// Main Test Runner
// =============================================================================

async function runPrivacyAndFailureTests(): Promise<void> {
  console.log('================================================================');
  console.log('Day 20 Prompt 6: Privacy and Failure Testing Suite');
  console.log('================================================================\n');

  let servers: RunningTestServers | null = null;
  const backendPort = 3003;
  const staticPort = 8880;

  try {
    console.log('--- Step 0: Starting Isolated Test Infrastructure ---');
    servers = await startControlledTestServers({
      staticPort,
      mockBackendPort: backendPort,
    });

    servers.tokenVerifier.registerToken('test-ward-token', {
      actorId: 'usr_alice',
      role: 'USER',
      isAuthenticated: true,
    });
    servers.tokenVerifier.registerToken('test-contact-token', {
      actorId: 'tc_carol',
      role: 'TRUSTED_CONTACT',
      isAuthenticated: true,
    });

    const backendUrl = servers.mockBackendUrl;
    console.log(`  ✓ Servers online: backend=${backendUrl}, static=${servers.staticUrl}\n`);

    // =========================================================================
    // SUITE 1: DOM Inspection & Action Extraction Privacy (Tasks 1 & 2)
    // =========================================================================
    console.log('--- SUITE 1: DOM Inspection & Action Extraction Privacy ---');

    // 1.1 Password inputs: extractElementInfo NEVER captures typed passwords
    {
      console.log('  [Scenario 1.1] Password inputs: value is never extracted; only placeholder is captured');
      const pwdInput = new MockHTMLInputElement('INPUT', 'txt-password');
      pwdInput.type = 'password';
      pwdInput.value = SYNTH_SENTINELS.PASSWORD;
      pwdInput.placeholder = 'Enter your password';

      const extracted = extractElementInfo(pwdInput as unknown as HTMLElement);
      assertEquals(extracted.tagName, 'INPUT', 'Extracted tag name is INPUT');
      assertEquals(extracted.visibleText, 'Enter your password', 'Captured only the public placeholder');
      assertNoSentinelLeakage(extracted, 'Password element extraction');
      assert(!('value' in extracted), 'Extracted element info strictly lacks "value" property');
    }

    // 1.2 Text / Payment inputs: value is never extracted
    {
      console.log('  [Scenario 1.2] Card/PII inputs: value is never extracted; only placeholder is captured');
      const cardInput = new MockHTMLInputElement('INPUT', 'txt-card-number');
      cardInput.type = 'text';
      cardInput.value = SYNTH_SENTINELS.CARD_NUMBER;
      cardInput.placeholder = 'Card number';

      const extracted = extractElementInfo(cardInput as unknown as HTMLElement);
      assertEquals(extracted.visibleText, 'Card number', 'Captured only placeholder');
      assertNoSentinelLeakage(extracted, 'Payment card extraction');
    }

    // 1.3 Textarea: typed content is never extracted
    {
      console.log('  [Scenario 1.3] Textareas: typed content is never extracted; only placeholder is captured');
      const textarea = new MockHTMLTextAreaElement('TEXTAREA', 'txt-notes');
      (textarea as any).value = `Confidential user notes with OTP ${SYNTH_SENTINELS.OTP}`;
      textarea.placeholder = 'Add notes here...';

      const extracted = extractElementInfo(textarea as unknown as HTMLElement);
      assertEquals(extracted.visibleText, 'Add notes here...', 'Captured only placeholder');
      assertNoSentinelLeakage(extracted, 'Textarea extraction');
    }

    // 1.4 Forms: inner text / child inputs are never concatenated
    {
      console.log('  [Scenario 1.4] Form elements: child inputs or inner text are never concatenated');
      const form = new MockHTMLFormElement('FORM', 'frm-payment');
      form.innerText = `Form with sensitive token: ${SYNTH_SENTINELS.AUTH_TOKEN}`;

      const extracted = extractElementInfo(form as unknown as HTMLElement);
      assertEquals(extracted.visibleText, undefined, 'Form element visibleText is strictly undefined');
      assertNoSentinelLeakage(extracted, 'Form element extraction');
    }

    // 1.5 Submit Buttons: extracts visible button label cleanly
    {
      console.log('  [Scenario 1.5] Submit buttons: label is extracted cleanly without leaking surrounding inputs');
      const submitBtn = new MockHTMLInputElement('INPUT', 'btn-submit');
      submitBtn.type = 'submit';
      submitBtn.value = 'Pay $50.00 Now';

      const extracted = extractElementInfo(submitBtn as unknown as HTMLElement);
      assertEquals(extracted.visibleText, 'Pay $50.00 Now', 'Button value is captured as button label');
    }

    // 1.6 URL Sanitization: query parameters and fragments stripped
    {
      console.log('  [Scenario 1.6] URL diagnostics: query parameters and hash fragments are stripped');
      const rawUrl = `https://bank.example.test/transfer?token=${SYNTH_SENTINELS.QUERY_PARAM_TOKEN}&account=123#step2`;
      const sanitized = sanitizeUrlForDiagnostics(rawUrl);
      assertEquals(sanitized, 'https://bank.example.test/transfer', 'Sanitized URL retains only origin and pathname');
      assertNoSentinelLeakage(sanitized, 'Sanitized URL string');
    }

    console.log('  ✓ SUITE 1 PASSED: DOM inspection privacy strictly enforced.\n');

    // =========================================================================
    // SUITE 2: Cross-Context Messaging & Diagnostic Payload Redaction (Tasks 1, 2, 4)
    // =========================================================================
    console.log('--- SUITE 2: Cross-Context Messaging & Diagnostic Payload Redaction ---');

    // 2.1 sanitizeForDiagnostics redacts forbidden sensitive keys
    {
      console.log('  [Scenario 2.1] sanitizeForDiagnostics redacts all sensitive key patterns');
      const rawPayload = {
        actionId: 'act_101',
        password: SYNTH_SENTINELS.PASSWORD,
        otp: SYNTH_SENTINELS.OTP,
        cardNumber: SYNTH_SENTINELS.CARD_NUMBER,
        cvv: SYNTH_SENTINELS.CVV,
        bearer: SYNTH_SENTINELS.AUTH_TOKEN,
        sessionId: SYNTH_SENTINELS.SESSION_ID,
        ssn: SYNTH_SENTINELS.SSN,
        raw_form_data: SYNTH_SENTINELS.RAW_FORM_VALUE,
        pageUrl: `https://app.example.test/dashboard?secret=${SYNTH_SENTINELS.QUERY_PARAM_TOKEN}`,
      };

      const sanitized = sanitizeForDiagnostics(rawPayload);
      assertNoSentinelLeakage(sanitized, 'sanitized diagnostic payload');
      assertEquals(sanitized.password, '[REDACTED]', 'password is [REDACTED]');
      assertEquals(sanitized.otp, '[REDACTED]', 'otp is [REDACTED]');
      assertEquals(sanitized.cardNumber, '[REDACTED]', 'cardNumber is [REDACTED]');
      assertEquals(sanitized.cvv, '[REDACTED]', 'cvv is [REDACTED]');
      assertEquals(sanitized.bearer, '[REDACTED]', 'bearer is [REDACTED]');
      assertEquals(sanitized.sessionId, '[REDACTED]', 'sessionId is [REDACTED]');
      assertEquals(sanitized.ssn, '[REDACTED]', 'ssn is [REDACTED]');
      assertEquals(sanitized.raw_form_data, '[REDACTED]', 'raw_form_data is [REDACTED]');
      assertEquals(sanitized.pageUrl, 'https://app.example.test/dashboard', 'pageUrl query params stripped');
    }

    // 2.2 Deeply nested object and array redaction
    {
      console.log('  [Scenario 2.2] Nested objects and arrays: sensitive properties are recursively scrubbed');
      const nestedPayload = {
        system: 'guardrail',
        user: {
          profile: {
            auth: {
              token: SYNTH_SENTINELS.AUTH_TOKEN,
            },
          },
        },
        transactions: [
          { id: 'tx_1', card: SYNTH_SENTINELS.CARD_NUMBER },
          { id: 'tx_2', pin: '1234' },
        ],
      };

      const sanitized = sanitizeForDiagnostics(nestedPayload);
      assertNoSentinelLeakage(sanitized, 'nested sanitized payload');
      assertEquals(sanitized.user.profile.auth.token, '[REDACTED]', 'Nested token is [REDACTED]');
      assertEquals(sanitized.transactions[0].card, '[REDACTED]', 'Array item card is [REDACTED]');
      assertEquals(sanitized.transactions[1].pin, '[REDACTED]', 'Array item pin is [REDACTED]');
    }

    // 2.3 isPrivacySafe validation utility
    {
      console.log('  [Scenario 2.3] isPrivacySafe deterministically verifies payload safety');
      const dirtyPayload = {
        actionId: 'act_dirty',
        password: SYNTH_SENTINELS.PASSWORD,
      };
      const dirtyCheck = isPrivacySafe(dirtyPayload);
      assertEquals(dirtyCheck.safe, false, 'Dirty payload correctly flagged as NOT safe');
      assert(dirtyCheck.violations.length > 0, 'Violations list is non-empty');

      const cleanPayload = sanitizeForDiagnostics(dirtyPayload);
      const cleanCheck = isPrivacySafe(cleanPayload);
      assertEquals(cleanCheck.safe, true, 'Clean payload correctly verified as safe');
      assertEquals(cleanCheck.violations.length, 0, 'Clean payload has 0 violations');
    }

    // 2.4 createDiagnosticLogger scrubs credentials from log outputs
    {
      console.log('  [Scenario 2.4] DiagnosticLogger scrubs metadata before logging');
      let loggedMetadata: any = null;
      const originalConsoleWarn = console.warn;

      try {
        console.warn = (...args: any[]) => {
          loggedMetadata = args[1];
        };

        const logger = createDiagnosticLogger('TestPrivacyLogger');
        logger.warn('Diagnostic warning event', {
          actionId: 'act_log_test',
          password: SYNTH_SENTINELS.PASSWORD,
          otp: SYNTH_SENTINELS.OTP,
        });

        assert(Boolean(loggedMetadata), 'Logger emitted metadata');
        assertNoSentinelLeakage(loggedMetadata, 'Diagnostic logger output');
        assertEquals(loggedMetadata.password, '[REDACTED]', 'Logged password was redacted');
        assertEquals(loggedMetadata.otp, '[REDACTED]', 'Logged OTP was redacted');
      } finally {
        console.warn = originalConsoleWarn;
      }
    }

    // 2.5 dispatchActionToBackground strips page title and DOM text before transmission
    {
      console.log('  [Scenario 2.5] dispatchActionToBackground scrubs DOM text and URL query data');
      let dispatchedMessage: any = null;
      (globalThis as any).chrome = {
        runtime: {
          id: 'test-ext-id',
          sendMessage: async (msg: any) => {
            dispatchedMessage = msg;
            return { success: true };
          },
        },
      };

      const rawAction = createSyntheticTestAction('act_dispatch_privacy', {
        page: {
          url: `https://secure.example.test/checkout?token=${SYNTH_SENTINELS.QUERY_PARAM_TOKEN}#pay`,
          title: 'Secret Page Title with Passwords',
        },
        element: {
          tagName: 'BUTTON',
          id: 'btn-pay',
          visibleText: `Pay with card ${SYNTH_SENTINELS.CARD_NUMBER}`,
        },
      });

      await dispatchActionToBackground(rawAction);
      assert(Boolean(dispatchedMessage), 'Action message was dispatched');
      assertNoSentinelLeakage(dispatchedMessage, 'dispatched background action message');
      assertEquals(dispatchedMessage.action.page.url, 'https://secure.example.test/checkout', 'Dispatched URL query stripped');
      assertEquals(dispatchedMessage.action.page.title, '', 'Dispatched page title stripped to empty string');
      assertEquals(dispatchedMessage.action.element.visibleText, undefined, 'Dispatched element visibleText stripped to undefined');
    }

    console.log('  ✓ SUITE 2 PASSED: Cross-context messaging and diagnostics privacy verified.\n');

    // =========================================================================
    // SUITE 3: Wire Layer Sanitization & Rejection of Sensitive Payloads (Tasks 1, 2, 4)
    // =========================================================================
    console.log('--- SUITE 3: Wire Layer Sanitization & Rejection of Sensitive Payloads ---');

    // 3.1 checkPayloadForSensitiveFields & validateClientPayloadIntegrity reject credentials pre-dispatch
    {
      console.log('  [Scenario 3.1] checkPayloadForSensitiveFields & validateClientPayloadIntegrity reject credentials pre-dispatch');
      const action = createSyntheticTestAction('act_wire_privacy');
      const stagingContext = createSyntheticStagingContext(action);
      (stagingContext as any).password = SYNTH_SENTINELS.PASSWORD;
      (stagingContext as any).otp = SYNTH_SENTINELS.OTP;

      const sensitiveKeys = checkPayloadForSensitiveFields(stagingContext);
      assert(sensitiveKeys.includes('password'), 'checkPayloadForSensitiveFields detected password');
      assert(sensitiveKeys.includes('otp'), 'checkPayloadForSensitiveFields detected otp');

      // 1. Background message coordinator rejects pre-dispatch
      const controller = new InterceptionController();
      controller.register(action, 'Held');
      controller.holdAction(action.id, 'Held');

      const submitMsg = {
        type: 'GUARDRAIL_SUBMIT_APPROVAL_REQUEST',
        actionId: action.id,
        context: stagingContext,
      };

      const bgRes = await (await import('../background/index.js')).handleBackgroundApprovalSubmission(submitMsg, controller);
      assertEquals(bgRes.success, false, 'Background coordinator rejects message carrying sensitive keys');
      assertEquals(bgRes.outcome, SubmissionOutcome.INVALID_LOCAL_STATE, 'Outcome is INVALID_LOCAL_STATE');
      assert(bgRes.error?.message.includes('sensitive fields'), 'Error cites sensitive fields rejection');
      assertNoSentinelLeakage(bgRes, 'handleBackgroundApprovalSubmission rejection response');

      // 2. ApprovalApiClient rejects payload violating client payload integrity
      const client = new ApprovalApiClient({
        baseUrl: backendUrl,
        tokenProvider: () => 'test-ward-token',
      });
      const clientRes = await client.createApprovalRequest({
        actionId: action.id,
        actionType: action.type,
        actionCategory: action.category || ActionCategory.DESTRUCTIVE,
        element: action.element,
        page: action.page,
        risk: { riskLevel: RiskLevel.CRITICAL, score: 100 },
        password: SYNTH_SENTINELS.PASSWORD,
      } as any);

      assertEquals(clientRes.success, false, 'ApprovalApiClient rejects payload carrying password');
      assertEquals(clientRes.statusCode, 400, 'Returns status code 400');
      assert(clientRes.error?.message.includes('sensitive field') || clientRes.error?.message.includes('password'), 'Client validation error cites sensitive field');
      assertNoSentinelLeakage(clientRes, 'createApprovalRequest validation rejection');
    }

    // 3.2 Action Fingerprint Digest Whitelist Excludes Sensitive Attributes
    {
      console.log('  [Scenario 3.2] computeActionDigest strictly rejects unpermitted/sensitive properties');
      const dirtyDescriptor = {
        origin: 'https://example.test',
        pathname: '/transfer',
        actionType: ActionType.CLICK,
        targetTagName: 'BUTTON',
        password: SYNTH_SENTINELS.PASSWORD, // Forbidden!
      };

      let threwError = false;
      try {
        computeActionDigest(dirtyDescriptor as any);
      } catch (err: any) {
        threwError = true;
        assert(err.message.includes('Unpermitted property'), 'Digest computation rejected unpermitted property');
      }
      assert(threwError, 'computeActionDigest strictly threw error on sensitive property');
    }

    // 3.3 sanitizeApprovalErrorMessage strips stack traces, tokens, SQL, and paths
    {
      console.log('  [Scenario 3.3] sanitizeApprovalErrorMessage scrubs stack traces, tokens, and SQL');
      const dirtyError =
        `Error: Database query failed: SELECT * FROM users WHERE token='${SYNTH_SENTINELS.AUTH_TOKEN}' and password='${SYNTH_SENTINELS.PASSWORD}';\n` +
        `  at Query.execute (/var/app/internal/db/conn.ts:45:12)\n` +
        `  at async handleRequest (/var/app/server.ts:120:5)`;

      const sanitizedError = sanitizeApprovalErrorMessage(dirtyError);
      assertNoSentinelLeakage(sanitizedError, 'Sanitized approval error message');
      assert(!sanitizedError.includes('at Query.execute'), 'Stack trace lines stripped');
      assert(!sanitizedError.includes('/var/app/'), 'Internal filesystem paths stripped');
      assert(!sanitizedError.includes('SELECT * FROM'), 'SQL statement stripped');
      assert(sanitizedError.includes('[REDACTED]') || sanitizedError.includes('[Database details omitted]'), 'Sensitive content replaced with safe placeholders');
    }

    console.log('  ✓ SUITE 3 PASSED: Wire layer sanitization and pre-dispatch scanning verified.\n');

    // =========================================================================
    // SUITE 4: Service Failure Simulation & Safe Non-Execution (Tasks 3 & 4)
    // =========================================================================
    console.log('--- SUITE 4: Service Failure Simulation & Safe Non-Execution ---');

    // 4.1 Network Unavailability (Closed Port / ECONNREFUSED)
    {
      console.log('  [Scenario 4.1] Closed port network failure maps to NETWORK_FAILURE and keeps action HELD');
      const deadPortClient = new ApprovalApiClient({
        baseUrl: 'http://127.0.0.1:9998', // Dead/unbound port
        tokenProvider: () => 'test-ward-token',
        timeoutMs: 1000,
      });

      const res = await deadPortClient.getApprovalRequest('apr_dead_port_test');
      assertEquals(res.success, false, 'Network request fails cleanly');
      assertEquals(res.error?.code, ApiClientErrorCodes.NETWORK_FAILURE, 'Error code is NETWORK_FAILURE');
      assert(res.error?.message.includes('Network request failed'), 'Sanitized user-facing network error message');
      assertNoSentinelLeakage(res, 'dead port response');

      // State determination maps to SUBMISSION_OUTCOME_UNKNOWN while preserving HELD
      const uiState = determineApprovalState({
        state: 'unknown',
        rawError: 'Network request failed. Check connectivity and retry.',
        statusCode: 0,
      });
      assertEquals(uiState.uiStatus, UIApprovalStatus.SUBMISSION_OUTCOME_UNKNOWN, 'UI status is SUBMISSION_OUTCOME_UNKNOWN');
      assertEquals(uiState.isActionHeld, true, 'Protected action remains strictly HELD');
      assertEquals(uiState.isBackendConfirmed, false, 'Failure is NOT treated as backend confirmed');
    }

    // 4.2 Timeout Handling
    {
      console.log('  [Scenario 4.2] Timeout fails safely with NETWORK_FAILURE_UNCERTAIN without auto-retry loops');
      const uiState = determineApprovalState({
        state: 'unknown',
        rawError: 'Request timed out waiting for backend response.',
      });
      assertEquals(uiState.uiStatus, UIApprovalStatus.SUBMISSION_OUTCOME_UNKNOWN, 'Timeout maps to SUBMISSION_OUTCOME_UNKNOWN');
      assertEquals(uiState.isActionHeld, true, 'Protected action remains strictly HELD');
      assert(uiState.detail.includes('timed out') || uiState.detail.includes('uncertain'), 'Truthful explanation of timeout uncertainty');
    }

    // 4.3 Malformed Service Responses (Corrupted JSON / Schema Violations)
    {
      console.log('  [Scenario 4.3] Malformed backend response is rejected by schema validator');
      const malformedResponses = [
        null,
        'not-an-object',
        { id: 'apr_bad_1' }, // Missing required fields (userId, actionId, status, bindingId)
        {
          id: 'apr_bad_2',
          userId: 'usr_alice',
          actionId: 'act_test',
          actionType: ActionType.CLICK,
          actionCategory: ActionCategory.DESTRUCTIVE,
          description: 'Test action',
          status: 'PENDING',
          bindingId: 'bnd_1',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          decision: { decision: 'APPROVED' }, // Invalid: PENDING cannot carry decision block!
        },
      ];

      for (const malformed of malformedResponses) {
        const valResult = validateBackendApprovalResponse(malformed);
        assertEquals(valResult.valid, false, 'Malformed response strictly failed schema validation');
      }

      // State determination maps to MALFORMED_RESPONSE while preserving HELD
      const uiState = determineApprovalState({
        state: 'malformed',
      });
      assertEquals(uiState.uiStatus, UIApprovalStatus.MALFORMED_RESPONSE, 'UI status is MALFORMED_RESPONSE');
      assertEquals(uiState.isActionHeld, true, 'Protected action remains strictly HELD');
    }

    // 4.4 Disconnected Extension Runtime (Context Invalidated)
    {
      console.log('  [Scenario 4.4] Disconnected extension runtime fails safely and keeps action HELD');
      // Mock invalidated runtime where chrome.runtime.id is undefined
      (globalThis as any).chrome = { runtime: {} };

      const action = createSyntheticTestAction('act_runtime_invalid');
      const stagingCtx = createSyntheticStagingContext(action);

      const res = await dispatchSubmitApprovalRequestToBackground(action.id, stagingCtx);
      assertEquals(res.success, false, 'Dispatch on invalidated runtime fails safely');
      assertEquals(res.isAuthoritative, false, 'Failure is NOT authoritative');
      assertEquals(res.outcome, 'NETWORK_FAILURE_UNCERTAIN', 'Outcome is NETWORK_FAILURE_UNCERTAIN');
      assert(res.error?.message.includes('safely HELD'), 'Error message confirms action remains safely HELD');
    }

    console.log('  ✓ SUITE 4 PASSED: Service failure simulation and safe non-execution verified.\n');

    // =========================================================================
    // SUITE 5: Storage Failures, Cooldown & Configuration Health Transitions (Tasks 3 & 5)
    // =========================================================================
    console.log('--- SUITE 5: Storage Failures, Cooldown & Configuration Health Transitions ---');

    // 5.1 Storage Read Failure (STORAGE_READ_ERROR & Cooldown)
    {
      console.log('  [Scenario 5.1] Storage read failure sets health to FAILED and activates cooldown');
      const failingStorage: ConfigStorageProvider = {
        get: async () => {
          throw new Error('Disk quota exceeded / chrome.storage I/O failure');
        },
        set: async () => {},
      };

      const loader = new PolicyConfigLoader({
        storageProvider: failingStorage,
        cooldownMs: 3000,
      });

      assertEquals(loader.getHealthStatus(), ConfigHealthStatus.UNINITIALIZED, 'Initial status is UNINITIALIZED');

      const result = await loader.load();
      assertEquals(result.healthStatus, ConfigHealthStatus.FAILED, 'Storage failure sets healthStatus to FAILED');
      assertEquals(loader.getHealthStatus(), ConfigHealthStatus.FAILED, 'Loader reports FAILED');
      assertEquals(result.error?.code, 'STORAGE_READ_ERROR', 'Error code is STORAGE_READ_ERROR');
      assert(loader.getCooldownRemainingMs() > 0, 'Cooldown is active following failure');
      assertEquals(loader.getConfig(), DEFAULT_GUARDRAIL_POLICY_CONFIG, 'Fell back to default policy configuration');

      // Subsequent load during cooldown returns cached FAILED state from cache
      const cachedResult = await loader.load();
      assertEquals(cachedResult.fromCache, true, 'Subsequent load served from cache during cooldown');
      assertEquals(cachedResult.healthStatus, ConfigHealthStatus.FAILED, 'Cached healthStatus remains FAILED');
    }

    // 5.2 Corrupted Configuration Root (Non-object)
    {
      console.log('  [Scenario 5.2] Corrupted configuration root fails safely to FAILED status');
      const corruptedRoots = ['corrupted-string', 12345, true, ['array-not-object']];
      for (const root of corruptedRoots) {
        const merged = mergeConfigWithDefaults(root);
        assertEquals(merged.healthStatus, ConfigHealthStatus.FAILED, 'Corrupted root yields FAILED');
        assertEquals(merged.fatalError?.code, 'INVALID_CONFIG_ROOT', 'Reports INVALID_CONFIG_ROOT');
        assertEquals(merged.config, DEFAULT_GUARDRAIL_POLICY_CONFIG, 'Reverted to defaults');
      }
    }

    // 5.3 Stale and Unsupported Configuration Versions
    {
      console.log('  [Scenario 5.3] Stale (v0.9.0) and unsupported (v2.0.0) versions fail closed to FAILED');
      const staleMerged = mergeConfigWithDefaults({ schemaVersion: '0.9.0' });
      assertEquals(staleMerged.healthStatus, ConfigHealthStatus.FAILED, 'Stale version sets FAILED');
      assertEquals(staleMerged.fatalError?.code, 'STALE_CONFIG_VERSION', 'Reports STALE_CONFIG_VERSION');

      const unsupportedMerged = mergeConfigWithDefaults({ schemaVersion: '2.0.0' });
      assertEquals(unsupportedMerged.healthStatus, ConfigHealthStatus.FAILED, 'Unsupported version sets FAILED');
      assertEquals(unsupportedMerged.fatalError?.code, 'UNSUPPORTED_CONFIG_VERSION', 'Reports UNSUPPORTED_CONFIG_VERSION');
    }

    // 5.4 Missing Optional Fields transitions to DEGRADED (never HEALTHY)
    {
      console.log('  [Scenario 5.4] Configuration with missing optional fields transitions to DEGRADED');
      const partialConfig = {
        schemaVersion: '1.0.0',
        policyVersion: '1.0.0',
        // Omitted thresholds, signals, trustedDomains, timeouts
      };

      const merged = mergeConfigWithDefaults(partialConfig);
      assertEquals(merged.healthStatus, ConfigHealthStatus.DEGRADED, 'Partial configuration reports DEGRADED');
      assert(merged.nonFatalErrors.length > 0, 'Non-fatal errors recorded for missing optional fields');
      assert(merged.config.policies.length > 0, 'Defaults applied for missing fields');
    }

    // 5.5 Clean Valid Configuration transitions to HEALTHY
    {
      console.log('  [Scenario 5.5] Clean valid configuration transitions to HEALTHY');
      const validConfigStorage: ConfigStorageProvider = {
        get: async () => DEFAULT_GUARDRAIL_POLICY_CONFIG,
        set: async () => {},
      };

      const loader = new PolicyConfigLoader({ storageProvider: validConfigStorage });
      const result = await loader.load();
      assertEquals(result.healthStatus, ConfigHealthStatus.HEALTHY, 'Clean configuration reports HEALTHY');
      assertEquals(loader.getHealthStatus(), ConfigHealthStatus.HEALTHY, 'Loader reports HEALTHY');
      assertEquals(result.error, undefined, 'No errors on healthy load');
    }

    // 5.6 Uninitialized Configuration Blocks DOM Actions Synchronously
    {
      console.log('  [Scenario 5.6] Uninitialized configuration blocks DOM actions from executing');
      assertEquals(
        isPolicyConfigurationInitialized(ConfigHealthStatus.UNINITIALIZED),
        false,
        'UNINITIALIZED returns false for isPolicyConfigurationInitialized'
      );

      const mockEvent = {
        defaultPrevented: false,
        immediatePropagationStopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopImmediatePropagation() {
          this.immediatePropagationStopped = true;
        },
      };

      const suppressed = cancelControlledActionUntilPolicyInitialized(
        ConfigHealthStatus.UNINITIALIZED,
        mockEvent as unknown as Event
      );
      assertEquals(suppressed, true, 'Synchronously suppressed when UNINITIALIZED');
      assertEquals(mockEvent.defaultPrevented, true, 'Event default prevented');
      assertEquals(mockEvent.immediatePropagationStopped, true, 'Event propagation stopped');
    }

    console.log('  ✓ SUITE 5 PASSED: Storage failures, cooldown, and health transitions verified.\n');

    // =========================================================================
    // SUITE 6: Caretaker Dashboard Privacy & Truthful Failure States (Tasks 3, 4, 5)
    // =========================================================================
    console.log('--- SUITE 6: Caretaker Dashboard Privacy & Truthful Failure States ---');

    // 6.1 Dashboard API Fetch Error Transitions to 'error' (Not 'idle' or empty success)
    {
      console.log('  [Scenario 6.1] Dashboard fetch failure transitions to error state');
      const rootContainer = new MockDOMElement('DIV', 'dashboard-root');

      // Create an API client that fails with NETWORK_FAILURE
      const failingClient = new ApprovalApiClient({
        baseUrl: 'http://127.0.0.1:9997', // Dead port
        tokenProvider: () => 'test-contact-token',
        timeoutMs: 500,
      });

      const shell = new DashboardShell({
        container: rootContainer as unknown as HTMLElement,
        apiClient: failingClient,
        autoFetch: false,
        initialView: 'pending',
      });

      assertEquals(shell.getState().pendingStatus, 'empty', 'Initial pendingStatus before fetch is empty');

      // Execute fetch
      await shell.fetchPendingRequests();

      assertEquals(shell.getState().pendingStatus, 'error', 'Status accurately transitioned to error on fetch failure');
      assert(Boolean(shell.getState().errorMessage), 'Dashboard shell has non-null errorMessage');
      assert(shell.getState().errorMessage!.includes('network') || shell.getState().errorMessage!.includes('Unable to reach'), 'Sanitized network error message');
      assertNoSentinelLeakage(shell.getState().errorMessage, 'Dashboard error message');

      shell.destroy();
    }

    // 6.2 Rendered Dashboard DOM does not leak credentials or unredacted tokens
    {
      console.log('  [Scenario 6.2] Rendered dashboard DOM does not contain credentials or raw tokens');
      const rootContainer = new MockDOMElement('DIV', 'dashboard-root');

      const mockRequest: ApprovalRequest = {
        id: 'apr_dashboard_privacy_1',
        userId: 'usr_alice',
        actionId: 'act_dash_1',
        actionType: ActionType.CLICK,
        actionCategory: ActionCategory.DESTRUCTIVE,
        description: 'Delete Account and Database Records',
        element: { tagName: 'BUTTON', id: 'btn-delete' },
        page: { url: 'https://app.example.test/settings' },
        risk: { riskLevel: RiskLevel.CRITICAL, score: 95 },
        status: ApprovalStatus.PENDING,
        bindingId: 'bnd_dash_1',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        statusHistory: [],
      };

      const shell = new DashboardShell({
        container: rootContainer as unknown as HTMLElement,
        initialProfile: { id: 'tc_carol', name: 'Carol Caregiver', email: 'carol@example.test', assignedWards: ['usr_alice'] },
        initialRequests: [mockRequest],
        initialView: 'pending',
        autoFetch: false,
      });

      const renderedHtml = (rootContainer as any).innerHTML || '';
      assertNoSentinelLeakage(renderedHtml, 'Rendered dashboard DOM tree');
      assert(!renderedHtml.includes('token='), 'No token queries rendered in dashboard');
      assert(!renderedHtml.includes('password='), 'No password fields rendered in dashboard');

      shell.destroy();
    }

    // 6.3 Truthful User Messaging: Never claims caretaker received SMS or email
    {
      console.log('  [Scenario 6.3] Truthful messaging: Staging modal never fabricates SMS or email notifications');
      const action = createSyntheticTestAction('act_truth_test');
      const stagingCtx = createSyntheticStagingContext(action);

      const uiState = determineApprovalState({
        state: 'creation_confirmed',
        request: {
          id: 'apr_truth_1',
          userId: 'usr_alice',
          actionId: action.id,
          actionType: action.type,
          actionCategory: action.category || ActionCategory.DESTRUCTIVE,
          description: 'Delete Account',
          element: action.element,
          page: action.page,
          risk: { riskLevel: RiskLevel.CRITICAL, score: 100 },
          bindingId: 'bnd_truth_1',
          status: ApprovalStatus.PENDING,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          statusHistory: [],
        },
      });

      assertEquals(uiState.uiStatus, UIApprovalStatus.REQUEST_CREATION_CONFIRMED, 'UI status is REQUEST_CREATION_CONFIRMED');
      assertEquals(uiState.headline, 'Approval Request Submitted', 'Headline accurately indicates submission');
      assert(!uiState.detail.includes('sent an SMS'), 'Does NOT claim SMS was sent');
      assert(!uiState.detail.includes('sent an email'), 'Does NOT claim email was sent');
      assert(!uiState.detail.includes('notified via push'), 'Does NOT claim push notification delivery');
      assert(uiState.detail.includes('PENDING'), 'Truthfully indicates review is pending in dashboard');
    }

    console.log('  ✓ SUITE 6 PASSED: Caretaker dashboard privacy and truthful failure states verified.\n');

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('================================================================');
    console.log(`ALL 6 PRIVACY & FAILURE SUITES PASSED! (${passedAssertions}/${totalAssertions} assertions verified)`);
    console.log('Zero sensitive sentinel leaks detected across all output channels.');
    console.log('================================================================\n');

  } finally {
    if (servers) {
      console.log('--- Cleaning up test servers ---');
      await servers.close();
      console.log('  ✓ Test servers closed cleanly.');
    }
  }
}

runPrivacyAndFailureTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Fatal error in Privacy & Failure Testing Suite:', err);
    process.exit(1);
  });
