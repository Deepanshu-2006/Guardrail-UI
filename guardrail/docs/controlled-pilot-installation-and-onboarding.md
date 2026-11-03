# Controlled Pilot Installation & Onboarding Guide

**Date:** November 3, 2026  
**Status:** Approved for Controlled Pilot  
**Component:** Guardrail UI — Manifest V3 Browser Extension Foundation & Onboarding Experience  
**Target Environment:** Google Chrome / Chromium (Developer Mode Unpacked Pilot Build)  

---

## 1. Executive Summary

This document specifies the installation procedure, onboarding workflow, permission disclosures, boundary definitions, and troubleshooting protocols for the Guardrail UI controlled pilot.

Guardrail UI provides client-side safety observability, high-risk action detection, synchronous interception into Staging Mode, and out-of-band approval routing for designated high-risk actions. During the controlled pilot, Guardrail operates under strictly defined security, privacy, and scope boundaries.

```
+-----------------------------------------------------------------------------------+
|                           GUARDRAIL PILOT BOUNDARY                                |
|                                                                                   |
|  [ SUPPORTED PILOT SCOPE ]                    [ EXCLUDED / UNMONITORED ]          |
|  - Elements marked with:                      - Arbitrary 3rd-party websites      |
|    data-guardrail-test-action                 - Ambient page JavaScript/fetch/XHR |
|  - Synchronous click/submit holding           - Direct browser navigation / URLs  |
|  - Staging Mode memory buffer                 - Password managers / autofill      |
|  - Out-of-band trusted approval               - OS malware / keyloggers / viruses |
|  - Zero automatic continuation                - Inactive / disabled extension     |
+-----------------------------------------------------------------------------------+
```

---

## 2. Step-by-Step Installation Instructions

The controlled pilot uses an unpacked Google Chrome extension package compiled from TypeScript source.

### 2.1 Prerequisites
- **Browser:** Google Chrome (Version 116+ recommended for full Manifest V3 module service worker support).
- **Runtime:** Node.js (v18.0.0+) and npm.
- **Repository Worktree:** Clean checkout of the `guardrail` repository.

### 2.2 Compilation and Build
From your terminal, navigate to the extension workspace and run the pilot build script:

```bash
cd guardrail/extension
npm install
npm run build:pilot
```

The build script bundles the extension components with pilot environment constants (`GUARDRAIL_ENV="pilot"`), minifies assets, strips development source maps, generates pilot-annotated manifest metadata, and outputs the complete installable package to `guardrail/extension/dist/`.

### 2.3 Loading the Extension in Google Chrome
1. Launch Google Chrome.
2. In the address bar, navigate to `chrome://extensions`.
3. Locate the **Developer mode** toggle in the top-right corner of the Extensions page and toggle it **ON**.
4. Click the **Load unpacked** button in the top-left toolbar.
5. In the file picker, select the `guardrail/extension/dist` folder (do NOT select the parent `extension/` folder).
6. Verify that the **Guardrail** card appears with:
   - Name: `Guardrail [PILOT DEPLOYMENT]`
   - Version: `0.1.0-pilot`
   - Inspect views: `service worker (active)`

### 2.4 Toolbar Pinning
1. Click the Extensions (puzzle piece) icon on the Chrome toolbar.
2. Find **Guardrail** and click the pin icon to keep the extension icon permanently visible.
3. Clicking the extension icon opens the Guardrail Extension Popup, displaying the live operational status, environment badge, active policy health, and quick navigation links.

### 2.5 Automated Onboarding Launch
Upon first-time installation, the background service worker detects the `chrome.runtime.onInstalled` reason `'install'` and automatically launches the dedicated onboarding tab at:
`chrome-extension://<EXTENSION_ID>/onboarding/onboarding.html`

Users can also re-open the onboarding guide at any time by clicking **"Complete Setup"** or **"Review Guide"** directly in the extension popup.

---

## 3. Protection Scope Boundaries: What Guardrail Does and Does NOT Protect

To maintain user trust and avoid providing a false sense of security, Guardrail UI strictly adheres to explicit protection boundaries.

### 3.1 What Guardrail UI DOES Protect
- **Designated Pilot Test Actions:** User interactions with buttons, links, or form submissions that are explicitly marked with the `data-guardrail-test-action` attribute (e.g. `financial_transfer`, `credential_modification`, `destructive_action`).
- **Synchronous Event Cancellation:** Synchronously invokes `event.preventDefault()` and `event.stopImmediatePropagation()` before browser DOM dispatch, preventing the designated event from executing on the page.
- **Staging Mode Holding:** Intercepted actions are registered with the local `InterceptionController` and held in an in-memory staging state (`HELD`), pausing the operation pending review.
- **Out-of-Band Secondary Approvals:** Dispatches high-level action metadata to the configured Guardrail backend API for review by trusted contacts.
- **Fail-Closed Safety Enforcement:** If local policy configuration fails validation or becomes corrupted, supported actions are held fail-closed rather than allowed to execute uninspected.

### 3.2 What Guardrail UI DOES NOT Protect
- **Arbitrary Third-Party Websites:** Guardrail does NOT protect general web browsing on unmarked web pages or arbitrary websites.
- **Ambient Page JavaScript & Network Traffic:** Guardrail does NOT block asynchronous `fetch()`, `XMLHttpRequest`, `WebSocket`, or `Worker` requests initiated by web page scripts.
- **Inactive / Suspended Extension State:** If the extension is disabled, uninstalled, or its background service worker is terminated without an active content script, actions are NOT evaluated or held.
- **Operating System or Browser Exploits:** Guardrail does NOT protect against unpatched browser exploits, keyloggers, phishing domains, malware, or malicious browser extensions.
- **Direct Browser Chrome Interactions:** Guardrail does NOT monitor address bar navigation, browser downloads, bookmark management, or settings changes.

> [!IMPORTANT]
> **Pilot Trust Invariant:** Guardrail UI is a deliberate, targeted safety layer for monitored high-risk workflows. It is never presented as an all-inclusive web firewall or antivirus tool.

---

## 4. Browser Permissions & Privacy Guarantees

Guardrail UI operates under a strict principle of least privilege. The extension manifest declares only the minimal permissions required for operation.

### 4.1 Permission Disclosures

| Permission | Justification & Access | Strict Non-Access Guarantee |
|---|---|---|
| `storage` | Required to persist local safety policy rules, risk threshold settings, and onboarding progress across browser sessions. | **Never accesses:** Browsing history, website cookies, cached web assets, or user credentials. |
| `activeTab` / `content_scripts` | Injects the action detector into the webpage DOM to identify supported pilot test elements and synchronously hold them if high risk. | **Never accesses:** Password input fields, payment cards, CVVs, OTP inputs, or arbitrary sensitive user data. |

### 4.2 Strict Zero-Sensitive-Data Guarantees
Guardrail UI enforces architectural and runtime barriers preventing the ingestion of sensitive personal information:

1. **NO Passwords:** Text typed into `<input type="password">` or fields containing password identifiers is never inspected, stored, or transmitted.
2. **NO Financial Credentials:** Credit card numbers, CVVs, debit PINs, and bank account credentials are never collected.
3. **NO One-Time Passcodes (OTPs):** Two-factor authentication codes, SMS verification tokens, and authenticator secrets are never intercepted or recorded.
4. **NO Raw Form Values:** The action detector and staging context model capture high-level semantic metadata (e.g. `actionType: 'form_submit'`, `category: 'FINANCIAL'`, `target: 'Confirm Transfer'`), strictly excluding raw typed user inputs.
5. **URL Sanitization:** Diagnostic logging and approval requests strip sensitive query parameters and URL user credentials (`user:password@host`) before transmission.

---

## 5. Understanding Staging Mode

Staging Mode is the core safety intervention mechanism in Guardrail UI. When a supported high-risk action is detected on a pilot page, Staging Mode pauses the action in browser memory.

### 5.1 The Staging Mode Lifecycle

```
[ User Interaction ] ──▶ [ Action Detector ] ──▶ [ Risk & Policy Engine ]
                                                          │
                                                    Decision = PROTECT
                                                          │
                                                          ▼
                                             [ Synchronous Event Interception ]
                                               - preventDefault()
                                               - stopImmediatePropagation()
                                                          │
                                                          ▼
                                            ┌───────────────────────────┐
                                            │     STAGING MODE (HELD)   │
                                            │   Action held in memory   │
                                            │   Zero automatic actions  │
                                            └───────────────────────────┘
                                                          │
                                      ┌───────────────────┴───────────────────┐
                                      ▼                                       ▼
                             [ Cancel Action ]                      [ Out-of-Band Approval ]
                             - User clicks Cancel                   - Sent to Backend API
                             - Action discarded                     - Trusted Contact reviews
                             - Page unaffected                      - Status updated to APPROVED
                                                                              │
                                                                              ▼
                                                                  [ Explicit Confirmation ]
                                                                  - User clicks "Continue"
                                                                  - Controlled handler runs
                                                                  - Action completed
```

### 5.2 Key Staging Mode Invariants
1. **Zero Automatic Execution:** Even if an approval request is marked `APPROVED` by a trusted contact, Guardrail **NEVER** executes or continues the action automatically.
2. **Deliberate Local User Confirmation:** Resuming an authorized action strictly requires the physical user to review the approval and click **"Continue Action"** in the Staging Mode dialog.
3. **Cancellation Control at Any Time:** Users can cancel a held action at any point by clicking **"Cancel Action"**, safely discarding the held operation and returning to the page.
4. **Session-Bound Ephemeral State:** Held action closures are stored in tab memory. Reloading the page or closing the tab safely discards the held action without execution.

---

## 6. Trusted Contact Approvals & Decision Decoupling

For actions classified as requiring secondary review, Guardrail routes approval requests out-of-band to trusted contacts.

### 6.1 Review Architecture
- **Out-of-Band Dispatch:** The extension background service worker submits the approval request to the Guardrail backend over HTTPS (`https://pilot-api.guardrail-safety.org` or local development server).
- **Metadata-Only Payloads:** Only high-level action category, target label, and timestamp are transmitted. Zero typed form fields or credentials are sent.
- **Standalone Dashboard Review:** Trusted contacts review pending requests on the Guardrail Trusted-Contact Dashboard (`guardrail/dashboard`).

### 6.2 Decision Decoupling
- **Decoupled Roles:** Trusted contacts have independent authority to approve or reject a requested action based on external coordination or context.
- **Authorization vs Execution:** An approval decision grants *authorization* to proceed; it does NOT trigger execution on the ward's device.
- **Local Agency Preserved:** The user on the extension side always retains final local agency to confirm or cancel the action.

---

## 7. Protection Configuration & Current Status Display

Both the Onboarding Wizard (`onboarding.html`) and the Extension Popup (`popup.html`) provide real-time visibility into the extension's configuration and operational health.

### 7.1 Operational States

| Operational Status | Badge Style | User-Facing Description | Protection Active? |
|---|---|---|---|
| `ACTIVE` | Emerald | Evaluating supported pilot test actions against active safety policies. Arbitrary websites are not protected. | **YES** (Supported test actions only) |
| `DEGRADED` | Amber | Evaluating supported pilot test actions using default safety fallbacks. Arbitrary websites are not protected. | **YES** (With fallbacks) |
| `INITIALIZING` | Blue | Policy configuration is initializing. Protection for supported actions will activate momentarily. | **NO** (Fail-closed hold) |
| `POLICY_ERROR` | Red | Safety policy failed to load or validate. Supported actions are blocked fail-closed; arbitrary websites remain unprotected. | **NO** (Fail-closed hold) |
| `INACTIVE` | Gray | The extension background service worker is inactive. Actions on web pages are not evaluated or protected. | **NO** (Extension offline) |

### 7.2 Configuration Attributes
- **Environment:** Reports the active environment profile (`pilot`, `development`, `production`).
- **Backend Service Type:** Explicitly labels the backend as **"Live Backend"** or **"Mock (In-Memory)"**.
  > [!NOTE]
  > When testing with local fixtures, an amber advisory badge warns users: *"Active backend is in-memory/mock. Approvals will be simulated locally and will not reach real remote contacts."*
- **Policy Health & Version:** Displays the current policy configuration schema version (e.g. `HEALTHY (v1.0.0)`) and the count of active enforcement rules.

---

## 8. Setup Completion & Readiness Checklist

Before beginning controlled pilot testing, verify each item on the readiness checklist:

- [x] **Extension Installed:** Extension is loaded in Chrome Developer Mode and visible in `chrome://extensions`.
- [x] **Service Worker Active:** Background service worker reports active status without errors.
- [x] **Toolbar Icon Pinned:** Guardrail shield icon is pinned to the Chrome toolbar for direct status access.
- [x] **Storage Permission Verified:** Local storage diagnostics report green checkmark in the Onboarding Wizard.
- [x] **Protection Scope Acknowledged:** User has reviewed and acknowledged that arbitrary websites are not protected.
- [x] **Permissions & Privacy Acknowledged:** User has acknowledged the zero-sensitive-data guarantees.
- [x] **Staging Mode Understood:** User has acknowledged that actions are held without automatic execution.
- [x] **Trusted Approvals Understood:** User has acknowledged how trusted contacts review actions remotely.
- [x] **Safety Policy Healthy:** Policy health displays `HEALTHY (v1.0.0)` with active rules.
- [x] **Controlled Demo Verified:** Tested interaction on `demo-sites/test-page/index.html` successfully triggers Staging Mode.

---

## 9. Troubleshooting Incomplete Setup & Error Handling

### 9.1 Issue: Policy Configuration Error (`POLICY_ERROR`)
- **Symptom:** Extension popup or onboarding banner displays a red alert: *"Policy configuration failed validation or is corrupted."*
- **Cause:** Malformed JSON in `chrome.storage.local` under key `guardrailPolicyConfig` or incompatible schema version.
- **Resolution:**
  1. In the Onboarding Wizard (Step 6), click **"Reset Default Policy"**.
  2. Alternatively, open Chrome DevTools on the extension popup, run `chrome.storage.local.remove('guardrailPolicyConfig')`, and reload the extension.
  3. Guardrail will automatically reinitialize the default safe policy (`DEFAULT_GUARDRAIL_POLICY_CONFIG`).

### 9.2 Issue: Extension Inactive or Service Worker Offline
- **Symptom:** Popup displays gray status: *"Inactive (Service Worker Offline)"*.
- **Cause:** Chrome has suspended the background service worker or extension was disabled.
- **Resolution:**
  1. Open `chrome://extensions`.
  2. Locate **Guardrail** and click the reload (circular arrow) icon.
  3. Verify that *"Inspect views: service worker"* re-appears and turns active.

### 9.3 Issue: Insecure HTTP Rejected in Pilot Mode
- **Symptom:** Onboarding diagnostics report: *"Insecure HTTP endpoint rejected in pilot mode: Remote services require HTTPS."*
- **Cause:** Extension is compiled with `GUARDRAIL_ENV="pilot"`, but `apiBaseUrl` was set to an unencrypted `http://` URL (other than `http://localhost`).
- **Resolution:**
  1. Ensure the remote pilot API endpoint uses TLS: `https://pilot-api.guardrail-safety.org`.
  2. For local offline testing, use `http://localhost:3000`, which is explicitly permitted for development.

### 9.4 Issue: Staging Mode Does Not Trigger on Web Page
- **Symptom:** Clicking a button does not open the Staging Mode dialog.
- **Cause:** The button or link does not carry the pilot test attribute.
- **Resolution:**
  1. Verify the target element has the attribute: `data-guardrail-test-action="financial_transfer"` or `"destructive_action"`.
  2. Test using the official controlled pilot test page: `demo-sites/test-page/index.html`.

---

## 10. Automated Test Verification

The onboarding workflow, protection status engine, scope disclosures, and error diagnostics are verified by the automated test suite:

```bash
cd guardrail/extension
npm run test:onboarding
```

All 79 unit and integration assertions pass:
- **Test Suite 1:** Onboarding State Machine & Step Transitions (25 assertions)
- **Test Suite 2:** Truthful Protection Scope Disclosures (10 assertions)
- **Test Suite 3:** Browser Permissions & Zero-Sensitive-Data Invariants (11 assertions)
- **Test Suite 4:** Staging Mode Understanding & Safety Invariants (2 assertions)
- **Test Suite 5:** Trusted Contact Participation & Decoupled Review (2 assertions)
- **Test Suite 6:** Live Protection Configuration & Status Inspection (14 assertions)
- **Test Suite 7:** Incomplete Setup & Error Diagnostics Handling (11 assertions)
- **Test Suite 8:** Setup Completion State & Checklist (4 assertions)

**Total Verification: 79 / 79 assertions passed.**
