# Guardrail Comprehensive Form Protection & Download Safety Audit

**Document Status:** Complete & Authoritative  
**Target Milestone:** Day 28 Architectural Audit  
**Date:** November 9, 2026  
**Scope:** Browser Extension Content Scripts, DOM Sensors, Action Classifier, Risk Engine, Response Policies, Background Service Worker, Manifest Permissions, and Privacy Boundaries  
**System Invariants:** Zero Credential Harvesting, No Universal Rollback Claims, Least-Privilege Manifest Permissions, Pure Local Heuristics  

---

## Executive Summary

As part of the **Day 28 milestone (*Form Protection & Download Safety*)**, this audit establishes a rigorous, ground-truth inspection of Guardrail's existing architecture regarding **form interaction detection, form submission handling, password/credential privacy, file download observation, and download safety controls**.

Today, Guardrail provides a solid baseline for structural DOM element extraction (`ActionDetector`, `extractElementInfo`), form destination evaluation (`formAction`, `formMethod`), and heuristic phishing/exfiltration detection (`phishing-detector.ts`). It strictly enforces an absolute privacy guarantee: user-entered form values, passwords, card numbers, and OTPs are **never collected, read, stored, or transmitted**.

However, the audit reveals critical architectural gaps regarding **form submission interception** and **download protection**:
1. **Form Submission Interception:** While capturing-phase DOM listeners intercept controlled submit buttons and standard `<form>` submit events, ambient form submissions driven programmatically by scripts (`form.submit()`) or asynchronous JavaScript calls (`fetch`/`XMLHttpRequest`) bypass DOM `submit` listeners entirely.
2. **Download Monitoring is Missing at the Platform Level:** The extension has **no integration with the Chrome Downloads API** (`chrome.downloads`). The manifest lacks the `downloads` permission, the service worker has zero download listeners, and "download detection" is currently limited to DOM keyword matching on link/button visible text (`download`, `export`, `save file`).
3. **No File Extension or MIME-Type Inspection:** Target file extensions (e.g., `.exe`, `.msi`, `.dmg`, `.bat`, `.iso`, `.zip`, `.scr`) and HTTP MIME types (`application/octet-stream`, `application/x-msdownload`) are completely unexamined.
4. **Disconnected Download Policies:** The risk signal `DOWNLOAD_ACTION` carries an inert +10 score contribution (classified as `LOW` risk $\le 24$), and no response policy maps download actions to `WARN` or `PROTECT`. Consequently, file downloads currently trigger zero friction or warnings.

This audit details the factual baseline across the 12 required inspection areas, answers key architectural determinations, defines browser extension limitations, and outlines implementation priorities for Day 28 without introducing unnecessary permissions or duplicating existing code.

---

## 1. Inspection of Core Subsystems (12 Inspection Areas)

### 1.1 Form Detection and DOM Inspection Functionality
- **Location:** [`guardrail/extension/src/detector/action-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/detector/action-detector.ts), [`guardrail/extension/src/utils/dom.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/dom.ts).
- **Inspection Findings:**
  - `ActionDetector` registers document-level capturing event listeners (`document.addEventListener(..., true)`) for `click`, `change`, and `submit`.
  - `isFormSubmitTrigger`: Identifies `<button type="submit">` or `<input type="submit">` inside forms and de-duplicates them on `click` to prevent redundant action dispatch before `submit`.
  - `findFormInputElement`: Uses `FORM_INPUT_SELECTOR` (`input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"])`, `textarea`, `select`) to identify data controls.
  - `extractElementInfo(element)` safely extracts:
    - `tagName`: normalized uppercase string.
    - `formAction`: resolves `element.getAttribute('formaction')` or `enclosingForm.action` relative to `window.location.href`.
    - `formMethod`: defaults to `'GET'` or extracts uppercase method (`POST`, `GET`).
    - `hasPasswordField`: boolean check via `enclosingForm.querySelector('input[type="password"]')`.
    - `hasUsernameField`: boolean check via `enclosingForm.querySelector(...)` targeting text/email/login fields.

### 1.2 Form Submission Event Handling
- **Location:** [`guardrail/extension/src/detector/action-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/detector/action-detector.ts) (`handleSubmit`), [`guardrail/extension/src/content/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/content/index.ts).
- **Inspection Findings:**
  - `handleSubmit` triggers when a native DOM `submit` event fires on a form.
  - **Controlled Elements (`[data-guardrail-test-action]`):**
    - Handled via `onIntercept`: synchronously invokes `event.preventDefault()` and `event.stopImmediatePropagation()`.
    - Registers action in `InterceptionController` with state `HELD`, binds an immutable SHA-256 digest (`ApprovalActionBinding`), and opens the Staging Modal.
  - **Ambient Elements (Generic Web Forms):**
    - Handled via `onAction`: evaluated through `evaluateActionPipeline(action)`.
    - If `ResponseAction.WARN`, renders the advisory Shadow DOM Warning Modal.
    - If `ResponseAction.PROTECT`, logs an **Architectural Sensor Limitation Notice** confirming that the action was **not held or rolled back**.

### 1.3 Form Action and Destination Validation
- **Location:** [`guardrail/extension/src/utils/phishing-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/phishing-detector.ts), [`guardrail/extension/src/utils/url-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/url-detector.ts).
- **Inspection Findings:**
  - `formAction` is validated against:
    1. **Pseudo-Protocols:** `javascript:` and `data:` schemes trigger `PhishingIndicatorCode.SUSPICIOUS_FORM_ACTION` (score weight: 35).
    2. **Exfiltration Sinks:** Sinks matching known third-party form collectors (`formspree.io`, `airform.io`, `getform.io`, `formkeep.com`, `formsubmit.co`, `discordapp.com/api/webhooks`, `telegram.org/bot`) trigger `PhishingIndicatorCode.EXFILTRATION_ENDPOINT` (score weight: 50).
    3. **Insecure Transport:** Forms with `hasPasswordField === true` submitting to plain `http:` destinations trigger `PhishingIndicatorCode.INSECURE_CREDENTIAL_TRANSMISSION` (score weight: 45).
    4. **Malformed Targets:** Unparseable URLs trigger `SuspiciousUrlIndicatorCode.INVALID_OR_MALFORMED_URL`.

### 1.4 Cross-Origin Form Submission Handling
- **Location:** [`guardrail/extension/src/utils/phishing-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/phishing-detector.ts) (lines 351–373).
- **Inspection Findings:**
  - Checks if `hasPasswordField === true` and compares `formAction` hostname against `pageUrl` hostname using `normalizeUrlComponents`.
  - If hostnames differ (excluding `127.0.0.1` and `localhost`), triggers `PhishingIndicatorCode.CROSS_ORIGIN_CREDENTIAL_SUBMISSION` (score weight: 30).
  - Also integrates with `EXTERNAL_NAVIGATION_POLICY`, which evaluates cross-origin transitions.

### 1.5 Password and Sensitive-Input Privacy Protections
- **Location:** [`guardrail/extension/src/utils/dom.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/dom.ts), [`guardrail/extension/src/utils/privacy.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/privacy.ts), [`guardrail/extension/src/background/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/background/index.ts).
- **Inspection Findings:**
  - **Zero Input Value Access:** `extractVisibleText` in `dom.ts` completely avoids reading `.value` for password inputs, text inputs, textareas, and select elements. For text inputs, it only reads `.placeholder`. For `<form>` elements, `visibleText` is strictly `undefined`.
  - **Structural-Only Metadata:** The existence of password fields is represented strictly as a boolean flag (`hasPasswordField: boolean`).
  - **Pre-Dispatch Sanitization:** `sanitizeUrlForDiagnostics()` strips credentials, query parameters (`token`, `auth`, `key`, `password`, `code`, `session`), and bearer headers.
  - **Service Worker Enforcement:** `validateApprovalSubmissionMessage()` in `background/index.ts` automatically rejects incoming messages containing sensitive keys (`password`, `otp`, `token`, `secret`, `jwt`).
  - **Wire-Level Scanning:** `checkPayloadForSensitiveFields()` in `client.ts` scans outbound API payloads, throwing client-side validation errors if sensitive keys appear.

### 1.6 Browser Download Event Handling
- **Location:** None (Currently Absent).
- **Inspection Findings:**
  - **No `chrome.downloads` API integration exists anywhere in the codebase.**
  - `guardrail/extension/src/background/index.ts` attaches listeners only to `chrome.runtime.onStartup`, `chrome.runtime.onInstalled`, and `chrome.runtime.onMessage`.
  - There are NO listeners for `chrome.downloads.onCreated`, `chrome.downloads.onDeterminingFilename`, or `chrome.downloads.onChanged`.
  - Downloads initiated via direct URL navigation, HTTP `Content-Disposition: attachment` responses, dynamically injected anchor tags with `download` attributes, or JavaScript `window.open()` are completely invisible to Guardrail.

### 1.7 Download Metadata Inspection
- **Location:** [`guardrail/extension/src/classifier/rules.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/classifier/rules.ts), [`guardrail/extension/src/risk/rules.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/risk/rules.ts).
- **Inspection Findings:**
  - Current metadata is strictly limited to DOM element tokens on click:
    - `element.visibleText` (e.g. "Download Application")
    - `element.id`, `element.className`
    - `element.targetUrl` (anchor `href`)
  - **Unavailable Metadata:** File size, server MIME-type, final destination path, download origin referrer, and native browser danger status (`danger: 'safe' | 'file_suspicious' | 'file_dangerous'`) are not accessed or inspected.

### 1.8 File Extension and MIME-Type Handling
- **Location:** [`guardrail/extension/src/classifier/rules.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/classifier/rules.ts).
- **Inspection Findings:**
  - `DOWNLOAD_KEYWORDS` currently checks only the literal phrases: `['download', 'export', 'save file']`.
  - **Zero file extension matching:** High-risk executable and script extensions (`.exe`, `.msi`, `.dmg`, `.pkg`, `.iso`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, `.scr`, `.hta`) are neither recognized nor parsed from link URLs.
  - **Zero MIME-type matching:** MIME headers like `application/x-msdownload`, `application/octet-stream`, or `application/x-sh` are not evaluated.

### 1.9 Existing Warning and Notification Interfaces
- **Location:** [`guardrail/extension/src/ui/warning-modal.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/ui/warning-modal.ts).
- **Inspection Findings:**
  - Implements an accessible, Shadow DOM-isolated modal (`#guardrail-warning-ui-host`).
  - Supports `warning`, `loading`, and `dismissed` states with WAI-ARIA compliance (`role="alertdialog"`, focus trap, keyboard `Escape`).
  - Displays: domain callout, detection basis tag (`🔍 Detection Basis: Local Safety Heuristic`), action status banner (`Advisory Notice` vs `Held in Staging Mode`), risk score, and plain-language guidance.
  - **Gap:** The warning modal is currently wired only for navigation, general click, and phishing warnings. It does not provide specialized copy, file metadata details, or risk explanations for executable file downloads.

### 1.10 Risk Engine and Policy Integration
- **Location:** [`guardrail/extension/src/risk/engine.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/risk/engine.ts), [`guardrail/extension/src/risk/rules.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/risk/rules.ts), [`guardrail/extension/src/response/policies.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/response/policies.ts).
- **Inspection Findings:**
  - `RiskSignalId.DOWNLOAD_ACTION` is defined with priority 60 and default score contribution +10.
  - Default risk thresholds: `lowMax: 24`, `mediumMax: 49`, `highMax: 74`.
  - A routine download action produces an aggregate score of 10, categorizing it as `LOW` risk.
  - In `response/policies.ts`, `RiskPolicyId` does not define a download policy. All download actions fall through to `ROUTINE_INTERACTION` (`ALLOW`).
  - **Result:** Under current policies, downloads never generate a warning or protection response.

### 1.11 Browser Permissions in Extension Manifest
- **Location:** [`guardrail/extension/public/manifest.json`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/public/manifest.json).
- **Inspection Findings:**
  ```json
  {
    "manifest_version": 3,
    "permissions": ["storage"],
    "content_scripts": [
      {
        "matches": ["<all_urls>"],
        "js": ["content.js"],
        "run_at": "document_idle"
      }
    ]
  }
  ```
  - `permissions` currently declares only `"storage"`.
  - Host permissions are dynamically injected during build for the configured backend URL only.
  - The `"downloads"` permission is completely absent.

### 1.12 Existing Unit and Browser Integration Tests
- **Location:** `guardrail/extension/src/*/test-*.ts`.
- **Inspection Findings:**
  - **Form Protection Tests:**
    - `test-phishing-detector.ts`: tests detection of exfiltration sinks, insecure HTTP logins, and cross-origin credential submissions.
    - `test-website-protection-mocked-browser.ts`: tests mock form submission, capturing-phase suppression of controlled forms, and privacy redaction.
    - `test-privacy-and-failure.ts`: 110 assertions verifying zero leakage of passwords, card numbers, OTPs, or raw form values across DOM, message wire, and logs.
  - **Download Tests:**
    - `test-risk-engine.ts`: asserts that clicking a button with text "Download Export" fires `DOWNLOAD_ACTION` (+10).
    - `test-rule-precedence.ts`: verifies rule priority 60 and signal contribution 10.
    - `test-staging-context.ts`: verifies staging context string formatting for `DOWNLOAD` category.
    - **Missing Tests:** Zero tests exist for actual file downloads, extension inspection (`.exe`, `.pkg`), MIME-type inspection, or download cancellation/pausing.

---

## 2. Key Determinations

| Question | Architectural Determination | Factual Evidence in Codebase |
|:---|:---|:---|
| **Which form-related risks are currently detected?** | 1. Insecure credential transmission over plain HTTP.<br>2. Form exfiltration to third-party webhook sinks (`formspree.io`, etc.).<br>3. Cross-origin credential submissions.<br>4. Pseudo-protocol form actions (`javascript:`, `data:`).<br>5. Deceptive brand identity mismatches on login forms. | [`phishing-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/phishing-detector.ts) (lines 40–60, 310–380). |
| **Is form submission monitoring implemented?** | **Partially (DOM level only).** Content script listens on capturing `submit` and `click` on submit triggers. Does not intercept programmatic script submissions (`form.submit()`) or AJAX/fetch requests. | [`action-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/detector/action-detector.ts) (lines 48, 160–215). |
| **Which browser form actions can actually be prevented?** | **Only user-initiated DOM submit events on explicit controlled controls** (`[data-guardrail-test-action]`) where capturing-phase `preventDefault()` halts the browser default action before submission. Ambient forms log an architectural limitation notice and are not held. | [`content/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/content/index.ts) (lines 350–380), [`controlled-website-protection-verification.md`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/docs/controlled-website-protection-verification.md). |
| **Which sensitive fields are excluded from collection?** | Passwords (`input[type="password"]`), credit card numbers, OTPs, PINs, auth tokens, session IDs, and all typed form values. For text inputs, only `.placeholder` is captured. Form elements have `visibleText: undefined`. | [`dom.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/dom.ts) (lines 160–205), [`privacy.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/privacy.ts). |
| **Is download monitoring implemented?** | **No.** There is zero integration with `chrome.downloads`. The extension only matches the word "download" in element text on user click. Background service worker has no download event listeners. | [`background/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/background/index.ts), [`public/manifest.json`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/public/manifest.json). |
| **Which download metadata is available?** | Only DOM metadata from the clicked element: `visibleText`, `targetUrl` (`href`), and `tagName`. Filenames, file sizes, MIME types, redirect chains, and browser danger flags are completely unavailable. | [`dom.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/dom.ts) (lines 250–290). |
| **Are download warnings connected to actual risk decisions?** | **No.** `DOWNLOAD_ACTION` score contribution is +10 (below low threshold of 24). There is no policy for downloads in `response/policies.ts`. Downloads are evaluated as routine `ALLOW` actions. | [`schema.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/schema.ts) (line 267), [`policies.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/response/policies.ts). |
| **Which capabilities are mocked or incomplete?** | 1. Download detection is an in-memory keyword mock without browser API hooks.<br>2. Form submission prevention is complete only for controlled test elements; ambient prevention is intentionally disabled with documented sensor limitations.<br>3. File extension and MIME-type validation are completely unbuilt. | [`action-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/detector/action-detector.ts), [`rules.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/risk/rules.ts). |
| **Which additional browser permissions are genuinely required?** | **`"downloads"` permission only** in `manifest.json` if Guardrail is to inspect real file downloads, observe filenames, or pause/cancel dangerous file downloads. No other permissions (e.g. `webRequest`, `nativeMessaging`) are needed. | [`public/manifest.json`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/public/manifest.json). |

---

## 3. Browser Extension Limitations & Architectural Truthfulness

To prevent misleading claims or security false senses, the following fundamental constraints must be respected:

1. **No Universal Form Interception:**
   - Standard browser content scripts run in isolated worlds and can intercept DOM `submit` events via capturing listeners.
   - However, modern web applications frequently bypass standard form submission:
     - Direct programmatic submission via `HTMLFormElement.prototype.submit()` does **not** trigger DOM `submit` events.
     - Asynchronous submission via `fetch()` or `XMLHttpRequest` in custom button click handlers executes network sockets directly.
   - **Guiding Invariant:** Guardrail must never claim universal form halting. It reliably intercepts standard capturing `submit` events on controlled test controls and warns on ambient forms, but acknowledges that uninstrumented script submissions cannot be universally rolled back once the network socket opens.

2. **Content Scripts Cannot Monitor Direct Downloads:**
   - Content scripts only see DOM nodes in the active webpage.
   - If a download is initiated via direct navigation, server HTTP 302 redirects, or `Content-Disposition: attachment` headers, the content script receives no notification.
   - Only the Background Service Worker equipped with the `chrome.downloads` API can observe native browser download creation, inspect final filenames, and pause or cancel downloads.

3. **No Rollback of Completed Actions:**
   - A client-side JavaScript event listener cannot undo an HTTP POST request or file download that has already completed over the wire. Protection must occur either synchronously *before* dispatch (capturing phase) or through explicit browser API pause mechanisms (`chrome.downloads.pause`).

---

## 4. Privacy Boundaries

The existing privacy safeguards are rock-solid and must remain inviolable during Day 28:
- **No Form Field Value Collection:** `input.value` is strictly ignored for all data-bearing inputs (`password`, `text`, `email`, `number`, `tel`, `date`, `textarea`, `select`).
- **Placeholder Only:** For non-password text inputs, only the static `.placeholder` attribute is read to understand element context (e.g., "Search", "Enter username").
- **Structural Integrity:** Password detection is stored strictly as `hasPasswordField: true|false`.
- **Pre-Dispatch Sanitization:** Outbound messages are scanned for sensitive keys before background dispatch and before backend API calls.
- **Diagnostics Sanitization:** URLs are stripped of authentication tokens, query parameters, and session identifiers before logging.

---

## 5. Day 28 Implementation Priorities & Recommended Architecture

Based on the audit findings, the recommended work plan for Day 28 is divided into four focused stages:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       DAY 28 IMPLEMENTATION ROADMAP                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STAGE 1: Form Protection Enhancement                                       │
│  ├── Expand form submission heuristics (insecure, exfil, cross-origin)     │
│  ├── Implement Form Submission Policy in response/policies.ts               │
│  └── Add explicit warning UI state for deceptive form actions               │
│                                                                             │
│  STAGE 2: Download Safety Engine & Extension Parser                         │
│  ├── Create File Extension & MIME-type detector (high-risk executables)     │
│  ├── Define RISK_RULE_EXECUTABLE_DOWNLOAD & high-risk download signals      │
│  └── Create File Download Risk Policy (WARN on executables/archives)        │
│                                                                             │
│  STAGE 3: Background Download Monitoring Architecture                       │
│  ├── Add least-privilege "downloads" permission to manifest.json            │
│  ├── Implement chrome.downloads listener in background service worker       │
│  └── Connect download metadata inspection to Risk Engine                    │
│                                                                             │
│  STAGE 4: Verification & Multi-Tier Test Suite                              │
│  ├── Synthetic test pages for forms and downloads (safe benign test files)  │
│  ├── Tier 1 Unit Tests: Form & Download heuristic evaluation                │
│  ├── Tier 2 Mocked Browser Tests: Event delegation & warning UI             │
│  └── Tier 3 Controlled Headless Chrome Tests: Real download observation     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Stage 1: Form Protection Enhancements
1. **Response Policy for Forms:** Define `FORM_SUBMISSION_POLICY` in `response/policies.ts` that maps cross-origin credential submissions, insecure logins, and exfiltration sinks to `WARN` or `PROTECT`.
2. **Warning UI Specialization:** Add specialized explanation text for deceptive form actions in `warning-modal.ts` (e.g. highlighting data destination and insecure transport).

### Stage 2: Download Safety Engine & File Extension Parsing
1. **Executable & Archive Classifier:** Create a dedicated file extension safety parser detecting:
   - High-Risk Executables: `.exe`, `.msi`, `.dmg`, `.pkg`, `.iso`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.scr`, `.hta`.
   - Script & Macro Assets: `.js`, `.vbs`, `.wsf`, `.jar`.
   - Compressed Archives: `.zip`, `.rar`, `.7z`, `.tar.gz`, `.tar`.
2. **Download Risk Policy:** Create `DOWNLOAD_SAFETY_POLICY` in `response/policies.ts`. When a user clicks a link targeting a high-risk executable, elevate the risk score to trigger an advisory `WARN` response before the download proceeds.

### Stage 3: Background Download Monitoring
1. **Manifest Permission:** Add `"downloads"` permission to `guardrail/extension/public/manifest.json`.
2. **Background Listener:** Add `chrome.downloads.onCreated` in `background/index.ts` to inspect download items (URL, filename, MIME type) and evaluate them against the Risk Engine.

### Stage 4: Comprehensive Testbed & Verification
1. **Synthetic Pages:** Expand `guardrail/demo-sites/test-page/` with dedicated form submission and safe download test cases (e.g. synthetic `.txt` or `.json` sample downloads; zero real malware).
2. **Multi-Tier Testing:** Implement Unit, Mocked Browser, and Real Headless Chrome integration tests verifying form and download safety without regressions.
