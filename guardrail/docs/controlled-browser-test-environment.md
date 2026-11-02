# Day 20 Prompt 2: Controlled Browser Test Environment

**Date:** 2026-11-02  
**Scope:** Real-browser testing environment infrastructure, zero-dependency Chrome runner, synthetic test page controls, and reproduction guide.  
**Baseline References:**
* [browser-integration-audit.md](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/docs/browser-integration-audit.md)
* [release-readiness-report.md](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/docs/release-readiness-report.md)

---

## 1. Overview & Architecture

To verify Guardrail UI in a real browser environment without introducing heavy, brittle third-party framework dependencies, Day 20 Prompt 2 implements a minimal, zero-dependency browser testing harness powered directly by Node.js (v22+) and the installed Google Chrome binary via the **Chrome DevTools Protocol (CDP)**.

```
Controlled Browser Testing Architecture
┌────────────────────────────────────────────────────────────────────────┐
│                        Node.js Test Runner (v24+)                      │
│       guardrail/extension/src/browser-test/                            │
│                                                                        │
│  ┌─────────────────────────┐          ┌─────────────────────────────┐  │
│  │   Test Server Harness   │          │     Chrome CDP Runner       │  │
│  │   test-server.ts        │          │     chrome-runner.ts        │  │
│  │   • Port 8899: Static   │          │     • Spawns Chrome 156     │  │
│  │   • Port 3000: Mock API │          │     • WebSocket CDP (Native)│  │
│  └────────────┬────────────┘          └──────────────┬──────────────┘  │
└───────────────┼──────────────────────────────────────┼─────────────────┘
                │ HTTP Static / JSON API               │ WebSocket RPC
                ▼                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Google Chrome (Headless / Real)                    │
│                                                                        │
│  • Flags: --headless=new, --load-extension=guardrail/extension/dist    │
│  • User Data Dir: Isolated temporary profile in /tmp/                  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Tab: http://127.0.0.1:8899/index.html                            │  │
│  │ • Guardrail Content Script (content.js)                          │  │
│  │ • Controlled Test Elements ([data-guardrail-test-action])        │  │
│  │ • Ambient Limitation Test Elements                               │  │
│  │ • Encapsulated Shadow DOM Modal (#guardrail-staging-ui-host)     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Controlled Test Page Controls (`demo-sites/test-page/`)

The controlled test page has been enhanced with synthetic controls covering all 6 mandatory action classes:

| Action Category | Target Element ID & Attributes | Expected Behavior in Real Browser |
|---|---|---|
| **Harmless Form Submission** | `<form id="test-form">`<br>`<input id="test-input">`<br>`<button id="submit-btn">` | Event listener calls `e.preventDefault()`, logs local synthetic form text to `#event-log`. No external HTTP dispatch. |
| **Harmless Button Action** | `<button id="test-action-btn">`<br>`<button id="btn-intercept-allow" data-guardrail-test-action="test-allow">` | Evaluated as `ALLOW` (Score 0). Permitted to proceed normally. Status badge reflects `ALLOWED (Normal Execution Permitted)`. Held indicator confirms `No action held`. |
| **Harmless Test Link** | `<a id="test-harmless-link" href="#harmless-anchor">` | Event listener suppresses navigation and logs harmless click. Browser remains on local page. |
| **Controlled Test Action (PROTECT)** | `<button id="btn-intercept-protect" data-guardrail-test-action="test-protect">` | Evaluated as `PROTECT` (Score 80). Capturing-phase `stopImmediatePropagation()` halts downstream page listeners (normal handler never runs). Status badge updates to `PROTECTED (HELD)`. Shadow DOM host `#guardrail-staging-ui-host` is mounted. Indicator reflects canonical `act_...` ID. |
| **Unsupported Ambient Action (Boundary Test)** | `<button id="btn-unsupported-unmarked-critical">` *(Unmarked)* | Evaluated as `PROTECT` by ambient sensor, but because it lacks `data-guardrail-test-action`, Guardrail logs the architectural sensor limitation. The normal click listener runs and appends `⚠️ AMBIENT UNMARKED HANDLER EXECUTED`. Action is truthfully **not held**. |
| **Invalid / Detached Test Actions** | `<button id="btn-invalid-empty-marker" data-guardrail-test-action="">`<br>`<button id="btn-detached-trigger">` | Empty marker is ignored. Detached elements dispatched via synthetic clicks are safely suppressed and never staged into resumable state. |

---

## 3. Test Environment Isolation & Mock Services

* **Local Loopback Network Isolation:** Real browser tests run strictly against `127.0.0.1`. No external domains or remote banking/payment/auth APIs are ever accessed.
* **Mock Approval Service:** Runs on `http://127.0.0.1:3000` via `ApprovalApiRouter` and `DevelopmentInMemoryApprovalRequestRepository`. Explicitly labeled with `PERSISTENCE_METADATA.IS_PRODUCTION === false` and `StorageType.EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY`.
* **Zero Real Credentials:** Uses synthetic tokens (`test-ward-token`, `test-contact-token`) registered exclusively in memory.
* **Temporary Profile Isolation:** Chrome is launched with a unique temporary user-data-dir in `/tmp/guardrail-chrome-profile-*`. This directory is deleted upon test completion, preventing state leaks between test runs.

---

## 4. Reproducible Commands

### 4.1 Build Extension
```bash
# Build the extension for development testing
npm --prefix guardrail/extension run build

# Or build for production (minified, stripped sourcemaps)
npm --prefix guardrail/extension run build:prod
```

### 4.2 Run Controlled Real-Browser Test Suite
```bash
# Executes the real-browser verification suite in headless Chromium
npm --prefix guardrail/extension run test:browser:env
```

### 4.3 Manual Browser Inspection (Headful Mode)
To inspect the extension and test page in a visible Chrome window:
```bash
# 1. Build extension
npm --prefix guardrail/extension run build

# 2. Launch Chrome with unpacked extension loaded
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --disable-extensions-except="$(pwd)/guardrail/extension/dist" \
  --load-extension="$(pwd)/guardrail/extension/dist" \
  --user-data-dir="/tmp/guardrail-dev-profile" \
  "http://127.0.0.1:8899/index.html"
```

---

## 5. Execution Results in Real Chromium (Google Chrome 156)

When executed via `npm --prefix guardrail/extension run test:browser:env`, all checks passed cleanly:

```
================================================================
Day 20 Prompt 2: Controlled Browser Test Environment Suite
================================================================

--- Step 1: Launching Isolated Local Test & Mock Backend Servers ---
[Controlled Test Server] Static server listening at: http://127.0.0.1:8899
[Controlled Test Server] Mock approval backend listening at: http://127.0.0.1:3000
[Controlled Test Server] Persistence type: EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY (isProduction: false)
  ✓ Static test server running at http://127.0.0.1:8899
  ✓ Mock approval backend running at http://127.0.0.1:3000

--- Step 2: Launching Headless Chromium with Extension Loaded ---
[ChromeRunner] Using extension dist directory: .../guardrail/extension/dist
[ChromeRunner] manifest.json exists: true
  ✓ Chromium process spawned with PID: 15488

--- Step 3: Navigating to Test Page & Verifying Content Script ---
[ChromeRunner] Navigating to: http://127.0.0.1:8899/index.html
  ✓ Test page title matches: Guardrail Test Page
  ✓ Guardrail Content Script successfully injected and bootstrapped in real browser
  ✓ Chrome registered extension runtime target in active session

--- Step 4: Harmless Synthetic Form Submission ---
  ✓ Harmless form submission logged locally without external dispatch

--- Step 5: Harmless Button Action (ALLOW Decision) ---
  ✓ ALLOW action permitted without interception
  ✓ Normal page handler permitted to execute for ALLOW decision
  ✓ Held action indicator confirms no action held on ALLOW: No action held

--- Step 6: Controlled Test Action Synchronous Interception (PROTECT) ---
  ✓ Interception status reflects PROTECTED (HELD)
  ✓ Capturing-phase cancellation successfully prevented normal page handler from executing
  ✓ Shadow DOM Staging Modal Host (#guardrail-staging-ui-host) mounted in document
  ✓ Staging Modal Shadow Root encapsulated securely
  ✓ Held indicator updated with canonical action ID (Action HELD: act_...)

--- Step 7: Ambient Unmarked Action Boundary (Limitation Verification) ---
  ✓ Ambient unmarked action was NOT held; page handler executed normally per documented boundary

--- Step 8: Harmless Synthetic Anchor Link ---
  ✓ Harmless link interaction handled deterministically on local page

================================================================
🎉 ALL 8 BROWSER TEST ENVIRONMENT VERIFICATIONS PASSED IN REAL CHROME!
================================================================

--- Step 9: Safe Resource & Process Cleanup ---
  ✓ Headless Chrome process terminated and temporary profile deleted
  ✓ Local test static server and mock approval server stopped
```

---

## 6. Readiness for Day 20 Prompts 3–7

With a working, reproducible, zero-dependency browser testing harness in place, the repository is ready to execute:
* **Prompt 3:** Real-browser capturing-phase boundary hardening and multi-button interaction sequences.
* **Prompt 4:** Real-browser Staging Mode Shadow DOM styling encapsulation, keyboard focus trapping, and `#gs-live-announcer` accessibility verifications.
* **Prompt 5:** Real-browser Background Service Worker messaging and mock HTTP approval submission.
* **Prompt 6:** Real-browser Caretaker Dashboard integration and cross-tab status synchronization.
* **Prompt 7:** Real-world security validation and final Day 20 readiness report.

