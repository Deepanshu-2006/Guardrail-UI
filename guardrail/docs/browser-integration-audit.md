# Day 20 Prompt 1: Browser Integration & Real-World Security Audit

**Date:** 2026-11-02  
**Scope:** Repository-wide audit and architecture mapping to establish real-browser testing prerequisites, evaluate existing test infrastructure, document technical boundaries, and plan Day 20 browser verification.  
**Baseline References:**
* [release-readiness-report.md](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/docs/release-readiness-report.md)
* [policy-security-audit.md](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/docs/policy-security-audit.md)
* [permissions-configuration-audit.md](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/docs/permissions-configuration-audit.md)

---

## 1. Executive Summary

Over Days 1 through 19, Guardrail UI established extensive unit and in-process integration test suites covering policy loading, risk evaluation, capturing-phase event suppression, Staging Mode UI components, 1:1 action-to-approval bindings, and adaptive status synchronization. In Day 19, operational hardening addressed startup race conditions, cross-context storage reload coalescence, least-privilege permissions, and truthful user-facing failure recovery.

**The Core Audit Finding:**
* **Real-Browser Test Coverage is Currently 0%:** Every single one of the 49 extension test suites and 4 dashboard test suites runs in an in-process Node.js runtime via `esbuild`. The Document Object Model (DOM), browser events, and `chrome.*` extension APIs are currently evaluated using synthetic in-memory mocks (`MockDOMElement`, `MockMouseEvent`, mock document).
* **Synthetic Mocks != Real Browser Behavior:** While Node-based integration tests prove algorithmic and state-machine correctness, they cannot verify:
  1. Manifest V3 Service Worker termination and reactivation cycles.
  2. Content-script injection timing relative to ambient webpage JavaScript execution.
  3. Chromium Shadow DOM boundary piercing, CSS styling encapsulation, and keyboard focus trapping.
  4. Real browser network isolation, CORS rules, and extension host permission checks.
* **Controlled Interception Boundary:** The actual implementation strictly scopes reliable synchronous event suppression and action holding to elements explicitly marked with `data-guardrail-test-action`. Ambient webpage interactions receive advisory friction (warnings), but cannot be universally or reliably intercepted.

**Objective of Day 20:** Establish a disciplined, evidence-based real-browser integration testing harness to validate the built extension (`guardrail/extension/dist/`) and dashboard in an actual Chromium browser, exercising real web pages and real event propagation.

---

## 2. Actual Architecture Map & Repository Entry Points

The Guardrail UI application comprises two buildable front-end packages and an approval domain library:

```
Guardrail UI System Architecture
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             BROWSER EXTENSION (MV3)                             │
│                                                                                  │
│  ┌─────────────────────────────┐        ┌──────────────────────────────────────┐ │
│  │   Content Script (IIFE)     │        │    Background Service Worker (ESM)   │ │
│  │   src/content/index.ts      │◄──────►│    src/background/index.ts           │ │
│  │   • ActionDetector          │  Port  │    • InterceptionController          │ │
│  │   • Risk/Response Engine    │  Msg   │    • Message Validation              │ │
│  │   • StagingModal (Shadow)   │        │    • ApprovalApiClient               │ │
│  └──────────────┬──────────────┘        └──────────────────┬───────────────────┘ │
└─────────────────┼──────────────────────────────────────────┼─────────────────────┘
                  │ DOM Events (Capturing)                   │ HTTP Fetch
                  ▼                                          ▼
┌───────────────────────────────────┐      ┌───────────────────────────────────────┐
│     TARGET WEB APPLICATION        │      │    APPROVAL BACKEND SERVICE (MOCK)    │
│  demo-sites/test-page/index.html  │      │    src/approval/api.ts                │
│  • [data-guardrail-test-action]   │      │    • ApprovalApiRouter (Local TCP)    │
│  • Ambient Form / DOM Controls    │      │    • Ephemeral In-Memory Storage      │
└───────────────────────────────────┘      └──────────────────▲────────────────────┘
                                                              │ HTTP Poll / Decide
                                           ┌──────────────────┴────────────────────┐
                                           │       TRUSTED-CONTACT DASHBOARD       │
                                           │       dashboard/src/index.ts          │
                                           │       • DashboardShell / Components   │
                                           │       • ApprovalApiClient             │
                                           └───────────────────────────────────────┘
```

### Detailed Component Inventory

| Subsystem | Source Path | Exported Symbols & Entry Points | Operational Role & Safeguards |
|---|---|---|---|
| **Extension Content Script** | [`guardrail/extension/src/content/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/content/index.ts) | `bootstrap()`, `handleAction()`, `updateControlledTestPageDisplay()` | Injected at `document_idle` on `<all_urls>`. Initializes `ActionDetector`, evaluates risk pipeline, manages Staging Modal, registers continuation callbacks. |
| **Extension Background Worker** | [`guardrail/extension/src/background/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/background/index.ts) | `backgroundInterceptionController`, `validateApprovalSubmissionMessage()`, `isTrustedContentScriptSender()` | Central coordinator. Validates message senders, enforces multi-tenant boundaries, and handles `GUARDRAIL_SUBMIT_APPROVAL_REQUEST` and `GUARDRAIL_GET_APPROVAL_STATUS`. |
| **Action Detector & Sensor** | [`guardrail/extension/src/detector/action-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/detector/action-detector.ts)<br>[`guardrail/extension/src/detector/action-factory.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/detector/action-factory.ts) | `ActionDetector`, `createGuardrailAction()` | Attaches capturing-phase event listeners to `document` (`click`, `change`, `submit`). Routes marked controls to `onIntercept`. |
| **DOM Utilities & Markers** | [`guardrail/extension/src/utils/dom.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/dom.ts) | `findControlledTestAction()`, `GUARDRAIL_TEST_ACTION_ATTR` (`data-guardrail-test-action`) | Scans element ancestry using `closest('[data-guardrail-test-action]')`. Disregards Guardrail internal UI components. |
| **Policy Configuration Engine** | [`guardrail/extension/src/config/loader.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/loader.ts)<br>[`guardrail/extension/src/config/registry.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/registry.ts)<br>[`guardrail/extension/src/config/readiness.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/readiness.ts) | `PolicyConfigRegistry`, `PolicyConfigLoader`, `cancelControlledActionUntilPolicyInitialized()` | Loads policies from `chrome.storage.local`. Coalesces concurrent reloads. Gates action evaluation while `UNINITIALIZED`; fails closed on `FAILED`. |
| **Risk & Response Pipeline** | [`guardrail/extension/src/risk/engine.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/risk/engine.ts)<br>[`guardrail/extension/src/response/engine.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/response/engine.ts) | `evaluateActionRisk()`, `evaluateActionPipeline()`, `ResponseAction` | Deterministic prioritized rule matching. Calculates risk score (0–100) and outputs `ALLOW`, `WARN`, or `PROTECT` with strict precedence (`PROTECT` > `WARN` > `ALLOW`). |
| **Interception State Controller** | [`guardrail/extension/src/interception/controller.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/interception/controller.ts)<br>[`guardrail/extension/src/interception/transitions.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/interception/transitions.ts) | `InterceptionController`, `InterceptionState` | In-memory finite state machine tracking held actions: `DETECTED` $\rightarrow$ `HELD` $\rightarrow$ `AWAITING_APPROVAL` $\rightarrow$ `READY_FOR_USER_CONFIRMATION` $\rightarrow$ `CONTINUED` / `CANCELLED`. |
| **Staging Mode Quarantine UI** | [`guardrail/extension/src/staging/modal.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/staging/modal.ts)<br>[`guardrail/extension/src/staging/status.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/staging/status.ts)<br>[`guardrail/extension/src/ui/warning-modal.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/ui/warning-modal.ts) | `showStagingModal()`, `dismissStagingModal()`, `showWarningModal()` | Renders isolated Shadow DOM interface (`#guardrail-staging-modal-host`). Implements `#gs-live-announcer`, non-color badges, and focus restoration to `previousActiveElement`. |
| **Continuation Engine** | [`guardrail/extension/src/interception/continuation.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/interception/continuation.ts)<br>[`guardrail/extension/src/interception/validation-service.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/interception/validation-service.ts) | `ContinuationManager`, `ContinuationValidationService` | Validates 10 mandatory conditions before continuation. Executes registered controlled handler exactly once. Never automatically continues actions upon approval. |
| **Approval Domain & Transport** | [`guardrail/extension/src/approval/client.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/client.ts)<br>[`guardrail/extension/src/approval/sync-client.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/sync-client.ts)<br>[`guardrail/extension/src/approval/binding.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/binding.ts) | `ApprovalApiClient`, `ApprovalStatusSyncClient`, `createApprovalActionBinding()` | Centralized HTTP transport with HTTPS enforcement in production. 1:1 binding with SHA-256 `actionDigest`. Strips sensitive fields (passwords, OTPs, cards). |
| **Caretaker Dashboard** | [`guardrail/dashboard/src/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/index.ts)<br>[`guardrail/dashboard/src/shell.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/shell.ts) | `DashboardShell`, `renderOverview()`, `renderPendingApprovals()` | Standalone web app for caretakers. Polls `/api/v1/approvals/pending`, displays non-sensitive details, and submits `APPROVED` / `REJECTED` decisions. |
| **Backend Mock Service** | [`guardrail/extension/src/approval/api.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/api.ts)<br>[`guardrail/extension/src/approval/repository.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/repository.ts) | `ApprovalApiRouter`, `InMemoryApprovalRequestRepository` | Standard HTTP router implementing the approval API contract over local Node HTTP servers. Stores state in ephemeral in-memory maps. Production server absent. |

---

## 3. Existing Test Coverage Audit & Classification

The repository includes extensive automated test suites executed via npm scripts. Every check was audited and classified according to actual execution environment:

| Functional Area | Test Suites Exercising the Area | Current Verification Classification | Description & Gap |
|---|---|:---:|---|
| **Configuration Initialization** | `test-policy-config-loader.ts`<br>`test-policy-centralization.ts`<br>`test-policy-config-schema.ts` | **Covered by Integration Tests** | Evaluated via `InMemoryConfigStorageProvider` in Node.js. Real `chrome.storage.local` persistence in an active browser is unverified. |
| **Configuration Failure Handling** | `test-policy-config-loader.ts` | **Covered by Integration Tests** | Verifies fail-closed status (`FAILED`), default fallbacks, and 5s retry cooldown in Node.js. |
| **Action Detection** | `test-action-interception.ts`<br>`test-workflow-enforcement.ts`<br>`test-comprehensive-risk-enforcement.ts` | **Covered by Integration Tests** | Tested using synthetic `MockDOMElement` and synthetic `MockMouseEvent`. Real browser event dispatching is unverified. |
| **Supported Action Interception** | `test-interception-model.ts`<br>`test-interception-controller.ts`<br>`test-interception-boundary-hardening.ts` | **Covered by Integration Tests** | Validates capturing-phase `preventDefault()` and `stopImmediatePropagation()` on `MockMouseEvent`. Real DOM event bubbling is unverified. |
| **Approval State Transitions** | `test-approval-lifecycle.ts`<br>`test-approval-service.ts`<br>`test-approval-hardening.ts`<br>`verify-day11-workflow.ts` | **Covered by Integration Tests** | Tested via in-process CAS state transitions and local Node loopback TCP HTTP servers. |
| **Action-Binding Validation** | `test-approval-action-binding.ts`<br>`test-approval-binding-enforcement.ts`<br>`test-approval-binding-invalidation.ts` | **Covered by Integration Tests** | Validates SHA-256 digest creation and 1:1 binding constraints in Node.js runtime. |
| **Explicit Continuation Confirmation** | `test-staging-approval-confirmation.ts`<br>`test-controlled-action-continuation-integration.ts` | **Covered by Integration Tests** | Evaluates 10 mandatory conditions in `ContinuationValidationService` and verifies modal click triggers continuation closure. |
| **Duplicate / Stale Messages** | `test-approval-concurrency.ts`<br>`test-dashboard-sync.ts`<br>`test-user-facing-failure-recovery.ts` | **Covered by Integration Tests** | Monotonic guards and out-of-order response dropping verified using simulated delayed promises in Node.js. |
| **Service-Worker Restart Behavior** | `test-permissions-configuration-hardening.ts` | **Not Currently Verified** | Tested only static registration in Node. Real MV3 service worker eviction, termination, and wake-up memory loss is unverified. |
| **Dashboard Updates** | `test-dashboard-shell.ts`<br>`test-dashboard-sync.ts`<br>`verify-complete-sync-flow.ts` | **Covered by Integration Tests** | Dashboard shell DOM rendering, adaptive polling, and error banner verified using mock DOM and loopback HTTP in Node.js. |
| **Privacy Redaction** | `test-messaging-privacy.ts`<br>`verify-day11-workflow.ts` (Scenario 15)<br>`test-approval-client.ts` | **Covered by Unit & Integration Tests** | Verifies redaction of passwords, OTPs, CVVs, and tokens from payloads, logs, and mock DOM elements. |
| **Browser Permissions & Content-Script Injection** | `test-permissions-configuration-hardening.ts` | **Not Currently Verified** | Verifies manifest JSON schema only. Real browser injection across cross-origin iframes, CSP enforcement, and permissions are unverified. |

### Test Execution Summary
* **Extension Test Chain (`npm --prefix guardrail/extension test`):** 49 test suites, **100% passed (Exit code 0)**.
* **Dashboard Test Chain (`npm --prefix guardrail/dashboard test`):** 4 test suites, **100% passed (Exit code 0)**.
* **Security Audit (`npm --prefix guardrail/extension run audit`):** 0 vulnerabilities found.
* **Real-Browser Tests:** **0 suites exist.**

---

## 4. Browser Automation Options Already Present

### Tooling Audit in Repository
Inspection of package manifests and lockfiles reveals:
1. `guardrail/extension/package.json`: Contains `@types/chrome`, `esbuild`, `typescript`.
2. `guardrail/dashboard/package.json`: Reuses extension tooling; contains no dependencies.
3. `guardrail/extension/package-lock.json`: Contains 33 total packages; **zero browser automation packages** (no Playwright, Puppeteer, Selenium, WebDriver, or Cypress).
4. No browser configuration files (`playwright.config.ts`, `puppeteer.config.js`) exist.

### Evaluation of Browser Automation Frameworks for Guardrail UI
Because no framework is currently installed, we evaluate the smallest practical approach for testing a Manifest V3 Chrome Extension:

| Framework | MV3 Extension Support | Service Worker & Background Inspection | Shadow DOM Piercing | Overhead & Fit for Repository |
|---|---|---|---|---|
| **Playwright** | **Native** via `chromium.launchPersistentContext()` with `--load-extension` / `--disable-extensions-except`. | **Native** via `context.serviceWorkers()`. Allows direct inspection of extension background logs and events. | **Built-in**. Standard CSS locators pierce open Shadow DOM roots automatically. | Moderate install size, highly reliable across platforms, matches modern web standards. |
| **Puppeteer** | **Native** via `puppeteer.launch({ args: ['--load-extension=...'] })`. | Supported via `target.worker()`. | Requires `>>>` or deep combinators. | Smaller footprint, but more manual boilerplate for service worker lifecycle and shadow roots. |
| **Raw CDP (Chrome DevTools Protocol)** | Manual via Chrome CLI `--remote-debugging-port`. | Manual protocol messaging. | Very complex manual tree traversal. | Zero external dependencies, but fragile and adds hundreds of lines of brittle harness code. |

**Recommendation:**  
When browser automation is introduced in Day 20 Prompt 2, **Playwright (`@playwright/test` or `playwright`)** is the recommended framework. It natively supports:
- Loading unpacked MV3 extensions using Chromium persistent contexts.
- Automating interactions with the Shadow DOM Staging Modal without custom piercing shims.
- Inspecting MV3 background service workers and intercepting network traffic.
- Running headless in modern Chromium with `--headless=new`.

*(Per Important Rules, no package is installed during this Prompt 1 audit.)*

---

## 5. Test Environment Requirements & Prerequisites

To execute real browser tests against Guardrail UI, the following operational requirements must be satisfied:

### 5.1 Build Requirements
* **Extension Build:** `npm --prefix guardrail/extension run build` compiles `src/` to `guardrail/extension/dist/`.
* **Dashboard Build:** `npm --prefix guardrail/dashboard run build` compiles `dashboard/src/` to `guardrail/dashboard/dist/dashboard.js`.
* **Output Artifacts:** `guardrail/extension/dist/` contains `manifest.json`, `background.js`, `content.js`, `popup/`, and `icons/`. This directory is ready for unpacked loading in Chromium.

### 5.2 Browser Runtime Requirements
* **Chromium Browser:** Version 109+ (Chrome 109+ supports Manifest V3 extensions in headless mode via `--headless=new`).
* **CLI Launch Flags:**
  ```bash
  --disable-extensions-except=/absolute/path/to/guardrail/extension/dist
  --load-extension=/absolute/path/to/guardrail/extension/dist
  --headless=new
  ```

### 5.3 Test Page Environment
* **Controlled Test Application:** `guardrail/demo-sites/test-page/index.html` already exists and contains buttons explicitly annotated with `data-guardrail-test-action`:
  - `data-guardrail-test-action="test-allow"` (`#btn-intercept-allow` - Score 0)
  - `data-guardrail-test-action="test-warn"` (`#btn-intercept-warn` - Score 50)
  - `data-guardrail-test-action="test-protect"` (`#btn-intercept-protect` - Score 80)
* **Hosting Requirement:** The test page must be served over HTTP (e.g. `http://localhost:8080/test-page/`) via a lightweight local server rather than `file://` because Chrome extensions default to injecting content scripts on web URLs and require special manual permission for `file://`.

### 5.4 Backend Service Mock
* **Port 3000 Loopback Server:** The extension background service worker defaults to `http://localhost:3000` in development mode. Real browser tests verifying approval flows must run an in-process local HTTP server using `ApprovalApiRouter` on port 3000.
* **Manifest Host Permissions:** For the background service worker to fetch from `http://localhost:3000` in an automated test environment, the extension manifest requires host permissions for `http://localhost:3000/*` during test execution (or a dedicated test build manifest).

---

## 6. Safe Test Boundaries & Interception Truthfulness

The audit rigorously evaluated the technical mechanics of action interception in `guardrail/extension/src/content/index.ts` and `guardrail/extension/src/detector/action-detector.ts`:

### 6.1 The Controlled Test Action Boundary
1. **Explicit Marker Required:** In `ActionDetector.handleClick`, the detector inspects `findControlledTestAction(event.target)`. This function executes `target.closest('[data-guardrail-test-action]')`.
2. **Synchronous Capturing-Phase Cancellation:**
   - The detector attaches capturing listeners to `document`: `document.addEventListener('click', this.handleClick, true)`.
   - When a marked element is detected and evaluated as `PROTECT`:
     ```typescript
     event.preventDefault();
     event.stopImmediatePropagation();
     ```
   - Because Guardrail listens in the capturing phase, calling `stopImmediatePropagation()` halts event descent before downstream target bubbling listeners execute.
3. **Registered Continuation Callback:** The original target action is registered in `ContinuationManager` as a closure. When explicit user continuation is approved, this closure executes once.

### 6.2 Ambient Website Action Reality (The Technical Boundary)
On ambient web pages lacking `data-guardrail-test-action`:
1. **Advisory Warning Only:** Guardrail triggers `showWarningModal()` on `WARN` or logs the sensor limitation on `PROTECT`.
2. **Why Universal Interception is Impossible via `preventDefault()`:**
   - `event.preventDefault()` only instructs the browser not to perform its default native action (such as following an `<a>` link or submitting a `<form>`).
   - `preventDefault()` **does not** cancel JavaScript event handlers that already attached to `window` or `document` before Guardrail, does not cancel handlers on other event types (e.g., `pointerdown`, `mousedown`), and does not cancel asynchronous timers (`setTimeout`, `requestAnimationFrame`) or WebSocket messages.
   - Guardrail has no safe, universal mechanism to "pause" arbitrary website JavaScript execution and "replay" it later without side effects.
3. **Truthfulness Invariant:** The extension truthfully acknowledges this boundary: ambient actions are **detected and evaluated**, but **never claimed to be blocked or held**.

---

## 7. Confirmed Testing Gaps

1. **Gap 1: Real Chrome Extension Lifecycle & Service Worker Eviction**
   - In MV3, background service workers terminate after ~30 seconds of inactivity. In-memory state in `backgroundInterceptionController` will be lost unless synchronized to `chrome.storage.local`. Real-browser tests must verify whether service-worker eviction impacts approval polling.
2. **Gap 2: Shadow DOM Isolation & Visual Occlusion in Real Chromium**
   - Staging Modal renders in a Shadow Root (`#guardrail-staging-modal-host`). Real browser testing must verify that host page CSS does not bleed into the modal, that the modal correctly traps keyboard focus (`Tab` / `Shift+Tab`), and that `#gs-live-announcer` triggers screen reader updates.
3. **Gap 3: Content Script Injection Timing**
   - The manifest declares `run_at: "document_idle"`. Real browser tests must measure whether fast-clicking users or early inline page scripts can execute before `content.js` completes initialization.
4. **Gap 4: Multi-Context Flow from Content Script to Dashboard**
   - Currently, content script $\rightarrow$ background worker $\rightarrow$ mock HTTP server $\rightarrow$ dashboard shell is tested as separated unit/integration fragments. Real browser testing should observe the end-to-end flow: clicking a button on the test page, opening the dashboard in a separate tab, approving the request, and returning to the test page to see the modal update.

---

## 8. Recommended Implementation Plan for Day 20 (Prompts 2–7)

| Prompt | Focus | Objective & Planned Implementation |
|---|---|---|
| **Prompt 2** | **Test Harness & Infrastructure** | Set up minimal, robust Chromium browser test runner (Playwright) with support for loading the unpacked extension (`guardrail/extension/dist/`), serving `demo-sites/test-page/`, and spinning up the mock approval backend. |
| **Prompt 3** | **Real-Browser Content Script & Interception** | Test extension injection into `test-page/index.html`. Verify capturing-phase suppression of `test-protect`, normal execution of `test-allow`, and advisory display for `test-warn`. |
| **Prompt 4** | **Real-Browser Staging Mode & Focus Trapping** | Verify Staging Modal Shadow DOM rendering, keyboard focus trapping, `Escape` key cancellation, and focus restoration to `previousActiveElement` in a real browser. |
| **Prompt 5** | **Real-Browser Background Communication & Approval Flow** | Test message exchange between content script and background service worker. Verify submission to local mock backend and status polling reflection. |
| **Prompt 6** | **Real-Browser Caretaker Dashboard Integration** | Open dashboard in a real browser page. Verify pending approval card display, caretaker `APPROVED` decision dispatch, and extension modal status update. |
| **Prompt 7** | **Security Validation & Final Report** | Verify ambient action boundary truthfulness on realistic test pages. Audit network traffic for privacy leaks (no passwords/cards). Produce Day 20 final readiness report. |

---

## 9. Conclusion & Readiness to Proceed

* **Repository Integrity:** All existing test suites pass; build pipelines are functioning properly; working tree is clean.
* **Audit Completed:** Architecture mapped, test coverage classified, boundaries confirmed, and testing gaps documented.
* **Ready for Day 20 Prompt 2:** The project can now proceed to set up real-browser test infrastructure without guesswork.

