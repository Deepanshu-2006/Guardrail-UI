# Guardrail UI — Form and Download Protection Verification Report
**Form and Download Protection Architecture & Multi-Tier Verification**
**Date:** November 9, 2026 | **Harness:** Antigravity / T3 Code | **Target:** Form & Download Protection Verification

---

## Executive Summary

Guardrail UI has expanded its zero-trust client-side interception envelope to encompass **controlled form submission protection** and **browser download monitoring**. This verification report documents an exhaustive audit across sixteen evaluation areas, nine strict security and privacy invariants, and three verification tiers (isolated unit tests, mocked browser DOM, and real headless Google Chrome driven via Chrome DevTools Protocol).

All test suites passed cleanly with **100% pass rates** across extension unit, workflow, and browser suites, backend SQLite and API integration suites, and dashboard approval shell suites. No commits were made automatically, no public deployments occurred, and zero unverified claims of production readiness are made.

---

## 1. Implemented Form Protection Capabilities

### 1.1 Architecture & Interception Flow
- **Early-Capture Event Delegation:** Form submission capture is registered at the top-level document capturing phase (`document.addEventListener('submit', ..., true)`). This guarantees capture of both statically defined forms and dynamically injected DOM forms prior to inline or bubbly listener execution.
- **Submit Event Support:** Intercepts modern DOM `SubmitEvent` instances, capturing both `HTMLFormElement.requestSubmit(submitter)` and standard user-initiated form submission triggers.
- **Button Click Deduplication:** When a submit button (`<button type="submit">` or `<input type="submit">`) is clicked, the detector tracks the click to resolve submitter button text and any `formaction` / `formmethod` overrides, but synchronously suppresses the generation of an extraneous `ActionType.CLICK` event. Exactly one normalized `ActionType.SUBMIT` action is created.
- **Non-Replay Architectural Boundary:** Approved or continued forms are **NEVER** replayed automatically via synthetic script invocation or stored credential resubmission. The user is provided transparent visual guidance and unblocked controls to submit manually when desired.

### 1.2 Form Destination Validation & Safety Indicators
The form evaluation engine analyzes both the document's hosting origin (`window.location.href`) and the form's destination (`HTMLFormElement.action`, submitter `formaction`, and HTML `action` attribute):
1. **Missing or Incomplete Destinations (`FORM_MISSING_DESTINATION`):** Flags credential-collecting forms that omit `action` or point to empty strings, `#`, or self-referential targets without clear POST routes.
2. **Unusual Schemes (`FORM_UNUSUAL_SCHEME`):** Flags form actions using pseudo-protocols or non-standard schemes (`javascript:`, `data:`, `vbscript:`, `about:blank`).
3. **Cross-Origin Submissions (`FORM_UNEXPECTED_CROSS_ORIGIN`):** Compares registrable base domains (eTLD+1). Flags sensitive forms submitting across domain boundaries to unverified destinations while exempting established SSO gateways (Google, Microsoft, GitHub, Apple), verified payment gateways (Stripe, PayPal, Braintree), and benign search forms (`GET` without credentials).
4. **Cleartext Insecure Transport (`FORM_INSECURE_HTTP_DESTINATION`):** Flags forms on HTTPS pages transmitting credentials or sensitive data over plain `http://` (exempting RFC 6761 `localhost` and `127.0.0.1`).
5. **Known Exfiltration Endpoints (`FORM_EXFILTRATION_ENDPOINT`):** Detects submissions targeting webhook collectors and form aggregation sinks (e.g., Formspree, Formkeep, Formstack, Webhook.site, RequestBin, Discord webhooks).
6. **Deceptive & Suspicious Domains (`FORM_DECEPTIVE_DESTINATION`):** Detects raw public IPv4/IPv6 destination addresses, known lookalike homoglyphs, and high-risk domain patterns.
7. **Runtime Destination Modification (`FORM_DESTINATION_MODIFIED`):** Injects an immutable baseline attribute (`data-guardrail-initial-action`) upon initial DOM extraction; flags instances where malicious scripts dynamically mutate `form.action` or when a submitter uses `formaction` to route data to a different external origin.
8. **Misleading Submissions (`FORM_MISLEADING_SUBMISSION`):** Flags submit controls styled or labeled with deceptive text (e.g. "Cancel", "Back", "Close", "Download Invoice") on forms submitting data to remote servers.
9. **Undetermined Destinations (`FORM_UNDETERMINED_DESTINATION`):** Handles malformed URLs gracefully by flagging undetermined destinations rather than failing silently.

---

## 2. Implemented Download Protection Capabilities

### 2.1 Multi-Phase Browser Download Monitoring
The `BrowserDownloadManager` registers with the MV3 `chrome.downloads` API across three lifecycle listeners:
1. **Phase 1: `onCreated` (Immediate Capture):** Fires as soon as the browser initiates a download. If the final filename is still pending browser sanitization or network content disposition, the item is tagged with `UNAVAILABLE_DOWNLOAD_METADATA`, safely registered in an ephemeral in-memory cache, and non-blocking streaming evaluation is performed.
2. **Phase 2: `onDeterminingFilename` (Pre-Write Determination):** Captures the resolved disk target filename before file chunks are written to disk. Always invokes `suggest()` callback to avoid stalling browser download shelves.
3. **Phase 3: `onChanged` (Dynamic Lifecycle Updates):** Tracks state transitions (`in_progress` -> `interrupted` or `complete`), danger status changes, and verifies that requested mitigation commands (pause, cancel) are confirmed by browser status.

### 2.2 Download Risk Assessment & Threat Indicators
The download evaluator scores incoming items deterministically across structural attributes:
1. **Direct Executable Programs (`SUSPICIOUS_EXECUTABLE_EXTENSION`):** Score contribution +45. Flags Windows, macOS, and Linux executable binaries (`.exe`, `.msi`, `.dll`, `.bat`, `.cmd`, `.ps1`, `.scr`, `.pif`, `.cpl`, `.com`, `.vbs`, `.js`, `.hta`, `.reg`, `.jar`, `.pkg`, `.app`).
2. **Deceptive Double Extensions (`MISLEADING_DOUBLE_EXTENSION`):** Score contribution +50 (yields cumulative score >= 75 / CRITICAL). Flags files hiding executable extensions behind deceptive document suffixes (e.g., `invoice.pdf.exe`, `statement.docx.vbs`, `spreadsheet.xlsx.scr`). Legitimate compound archives (`.tar.gz`, `.tar.bz2`) are explicitly recognized and exempted.
3. **MIME-Type Mismatch / Disguise (`MIME_TYPE_MISMATCH`):** Flags downloads where the declared `mime` type contradicts the file extension (e.g., `.exe` file declared as `image/png` or `.pdf` declared as `application/x-msdownload`). Benign fallback `application/octet-stream` is safely handled without artificial inflation.
4. **Suspicious Download Origins (`SUSPICIOUS_DOWNLOAD_ORIGIN`):** Flags downloads initiated from raw public IP addresses or known deceptive domains.
5. **Insecure Cleartext Transport (`INSECURE_DOWNLOAD_TRANSPORT`):** Flags binary/executable downloads fetched over plain HTTP.
6. **Native Browser SafeBrowsing Danger Flags (`BROWSER_DANGER_FLAGGED`):** Ingests native `downloadItem.danger` values (`file`, `url`, `content`, `uncommon`). When flagged dangerous by Chrome, escalates score to 100 (CRITICAL) and recommends `CANCEL`.
7. **Interrupted Downloads (`INTERRUPTED_DOWNLOAD`):** When a download enters `interrupted` state, records the specific browser error code (e.g. `NETWORK_FAILED`, `SERVER_BAD_CONTENT`, `USER_CANCELED`), stops recommending active pauses, and preserves diagnostic context.

### 2.3 User-Facing Download Warning Modal UI
- **Shadow DOM Isolation:** Rendered inside a host `#guardrail-download-ui-host` with an isolated Shadow Root, guaranteeing immunity from parent page CSS leakage.
- **Accessibility & ARIA:** Configured as an accessible modal (`role="alertdialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`, focus trapping, `Escape` key dismissal, and `aria-live="polite"` live announcements).
- **Truthful Heuristic vs. Intelligence Labeling:** Heuristic indicators are clearly labeled *"Automated Local Heuristic (No external scanning conducted)"*. Verified SafeBrowsing flags are labeled *"Verified Threat Intelligence"*. No fake antivirus scan results or simulated cloud detections are ever presented.
- **Two-Step Continuation Confirmation:** Resuming a paused download requires the user to click *"I understand the risks, resume download"*, opening an explicit confirmation step before the `onContinue` callback can fire.
- **Post-Completion Guidance:** If a download completes before dismissal, the UI updates dynamically to guide the user to inspect the file using local operating system antivirus rather than claiming the file was blocked or cleaned.

---

## 3. Actual Test Results

All test suites were executed cleanly in the real local project environment. The table below reports the verified test suite results:

| Test Suite | File / Entry Point | Assertions / Scenarios | Result | Execution Speed |
| :--- | :--- | :--- | :--- | :--- |
| **Form Safety Unit Tests** | `src/risk/test-form-detection-unit.ts` | 65 / 65 assertions | **PASS** | 24ms |
| **Form Protection Workflow** | `src/interception/test-form-protection-workflow.ts` | 49 / 49 assertions | **PASS** | 25ms |
| **Download Safety Unit Tests** | `src/risk/test-download-safety-unit.ts` | 186 / 186 assertions | **PASS** | 22ms |
| **Download Workflow Tests** | `src/background/test-download-monitoring-workflow.ts` | 35 / 35 assertions | **PASS** | 26ms |
| **Download Warning Modal UI** | `src/ui/test-download-warning-modal.ts` | 60 / 60 assertions | **PASS** | 28ms |
| **Mocked Browser Integration (Tier 2)** | `src/browser-test/test-form-download-protection-mocked-browser.ts` | 87 / 87 assertions (18 scenarios) | **PASS** | 35ms |
| **Real Headless Chrome CDP (Tier 3)** | `src/browser-test/test-form-download-protection-real-browser.ts` | 25 / 25 assertions (18 scenarios) | **PASS** | 7.8s (live Chrome) |
| **Permissions Configuration** | `src/approval/test-permissions-configuration-hardening.ts` | 42 / 42 assertions | **PASS** | 26ms |
| **Approval Binding Security** | `src/approval/test-approval-binding-security.ts` | 74 / 74 assertions | **PASS** | 32ms |
| **Backend SQLite & API Suites** | `guardrail/server` (`npm test`) | 6 test suites (SQLite, OIDC, API, Config, Invites) | **PASS** | 1.1m (real SQLite/crypto) |
| **Dashboard Shell Component Suites** | `guardrail/dashboard` (`npm test`) | 5 test suites (606 shell + 135 sync + dev) | **PASS** | 42s (real HTTP wire) |
| **Extension Manifest & Production Build** | `node build.mjs` (`guardrail/extension`) | Multi-bundle compilation + manifest validation | **PASS** | 1.2s |

---

## 4. Browser API Limitations & Specification Boundaries

1. **`HTMLFormElement.prototype.submit()` Limitation:**
   - **W3C HTML Specification Behavior:** Calling `form.submit()` directly via JavaScript runs the form submission algorithm directly and **bypasses DOM dispatch of the `SubmitEvent`**.
   - **Architectural Boundary:** The extension cannot intercept programmatic `form.submit()` via standard event listeners without patching native DOM prototypes in the main page world.
   - **Protection Strategy:** Guardrail protects all user interactions (`click`, `requestSubmit()`, `Enter` keypress, submit buttons), dynamic form insertions, and formaction overrides.
2. **`chrome.downloads.download()` Programmatic Invocations:**
   - Client scripts can initiate downloads via hidden anchor tags (`<a download href="...">`) or JavaScript calls.
   - Guardrail monitors these via `chrome.downloads.onCreated` and `chrome.downloads.onDeterminingFilename` at the browser subsystem level, ensuring coverage regardless of DOM origin.
3. **Chrome Downloads Pre-Determination Timing:**
   - In MV3, `onDeterminingFilename` requires calling `suggest()` or returning promptly; failing to respond causes Chrome to stall all file downloads. Guardrail resolves metadata synchronously or emits `UNAVAILABLE_DOWNLOAD_METADATA` safely while immediately invoking `suggest()`.
4. **Service Worker Invalidation & Lifecycle:**
   - Background service workers can become idle or terminate. All stateful records are persisted in bounded caches and validated with defensive error-handling when `chrome.runtime.lastError` is present.

---

## 5. Privacy and Security Verification

The nine strict invariants mandated by Guardrail UI were systematically verified:

| Invariant | Verification Mechanism | Status |
| :--- | :--- | :--- |
| **1. No raw form values or credentials collected** | `extractElementInfo` sanitizes DOM inputs. `value`, `autocomplete`, and inner content are strictly omitted. Only structural flags (`hasPasswordField`, `sensitiveFieldTypes`) are retained. Verified by synthetic DOM privacy audits. | **VERIFIED** |
| **2. Zero passwords, OTPs, or cards logged** | Test suites in Unit, Mocked Browser, and Real Browser inject known sentinel strings (`SecretP@ssword!`, `OTP-987654`, `4111-2222-3333-4444`). All resulting actions, diagnostics, logs, and network wire payloads were asserted to contain 0 sentinels. | **VERIFIED** |
| **3. Accurate representation in form warnings** | Warnings describe the exact structural cause (`FORM_UNEXPECTED_CROSS_ORIGIN`, `FORM_INSECURE_HTTP_DESTINATION`, `FORM_DESTINATION_MODIFIED`). Warnings never claim credentials were stolen when only an advisory is warranted. | **VERIFIED** |
| **4. Implemented risk indicators for downloads** | Download warnings reflect actual evaluated file properties (`SUSPICIOUS_EXECUTABLE_EXTENSION`, `MISLEADING_DOUBLE_EXTENSION`, `MIME_TYPE_MISMATCH`). | **VERIFIED** |
| **5. Zero automatic execution of files** | `chrome.downloads.open` is **strictly prohibited and completely absent** from all extension source code. Search over codebase confirms zero references. | **VERIFIED** |
| **6. Truthful documentation of unsupported scenarios** | Programmatic `form.submit()` and native sandboxed iframe limitations are documented plainly in tests and architectural specs. | **VERIFIED** |
| **7. No automatic action execution upon approval** | When an approval status updates to `APPROVED`, execution count remains strictly 0. An approval merely establishes an authorized continuation binding; user confirmation is required. | **VERIFIED** |
| **8. No simulated / fake threat intelligence** | Local heuristic detections are explicitly labeled *"Automated Local Heuristic"*. SafeBrowsing is labeled *"Verified Threat Intelligence"*. No fictitious cloud lookups are shown. | **VERIFIED** |
| **9. Minimal browser permissions** | Manifest declares only: `storage`, `downloads`, `activeTab`. Zero broad host permissions (`<all_urls>` is omitted). Specific backend host permissions are bounded. | **VERIFIED** |

---

## 6. Mocked versus Real Integration Coverage

To guarantee both high development velocity and genuine platform fidelity, tests are tiered:

- **Tier 1 (Isolated Unit Tests):** 
  - Pure algorithmic evaluations of `evaluateFormSafety()`, `evaluateDownloadSafety()`, risk engine scoring, and response policies.
  - Runs in pure Node.js in milliseconds without DOM or network dependencies.
- **Tier 2 (Mocked Browser Environment):**
  - Full DOM simulation (`MockDocument`, `MockFormElement`, `MockElement`, `MockDOMEvent`, synthetic `chrome.downloads` API, in-memory continuation manager).
  - Verifies event capture, bubble phase interception, cancelation, staging context, Shadow DOM modal mounting, and service worker restarts across 18 end-to-end scenarios (87 assertions).
- **Tier 3 (Real Browser Chrome DevTools Protocol):**
  - Real Google Chrome launched in headless mode (`--remote-debugging-port=9563`, `--headless=new`, `--disable-gpu`).
  - Real local HTTP server (`127.0.0.1:8916`) serving authentic HTML fixtures (`synthetic-form-download-protection.html`), CSS, and bundled extension content scripts.
  - Real downloads served over HTTP (sample text, PNG image, binary diagnostic file).
  - Exercises actual DOM event dispatching, genuine browser URL parsing, real Shadow DOM tree rendering, and actual SHA-256 action digest calculations.

---

## 7. Known False-Positive Risks & Mitigation Profiles

1. **Legitimate External Form Destinations (SSO & Payments):**
   - *Risk:* Forms submitting credentials across origins to identity providers (Google, Microsoft, Okta) or payment processors (Stripe, PayPal).
   - *Mitigation:* Centralized allowlists (`KNOWN_SSO_PROVIDERS`, `KNOWN_PAYMENT_GATEWAYS`) and site-specific exemptions allow legitimate authentication and checkout flows to evaluate to `ALLOW` (score 0).
2. **Third-Party Contact & Feedback Forms:**
   - *Risk:* Marketing sites using Formspree or Formkeep for benign contact forms.
   - *Mitigation:* Exfiltration sink rules evaluate the presence of credentials or payment fields. Benign non-sensitive contact forms submit with informational warning (`WARN`) rather than destructive blocking (`PROTECT`).
3. **Compound Archives & Dual Extensions:**
   - *Risk:* Legitimate developer archives (e.g. `.tar.gz`, `.tar.bz2`) misidentified as deceptive double extensions.
   - *Mitigation:* Explicit archive whitelist normalizes compound archive extensions as valid archive categories rather than executable disguises.
4. **Generic MIME Types:**
   - *Risk:* Web servers serving downloads with generic `application/octet-stream` or `binary/octet-stream`.
   - *Mitigation:* The MIME inspector treats `application/octet-stream` as unclassified rather than a hostile disguise mismatch, avoiding false alarms on standard downloads.

---

## 8. Remaining Blockers & Next Milestones

1. **Production Identity & Live OIDC Provider:**
   - Current test suites operate against synthetic local OIDC tokens and local SQLite storage. Connecting to live production Google / Microsoft OIDC identity providers requires customer-specific OAuth client registration and DNS configuration.
2. **Native Main-World Script Prototype Wrapping:**
   - To intercept `HTMLFormElement.prototype.submit()`, a future milestone can explore an optional main-world script injection (`world: "MAIN"`) while weighing isolation trade-offs and Content Security Policy compatibility.
3. **Enterprise Antivirus / EDR API Integration:**
   - Guardrail intentionally avoids pretending to scan file binaries. True binary analysis requires integration with enterprise endpoint security platforms (e.g., Windows Defender APIs or Cloud Sandbox submission APIs).
4. **Production Deployment Gate:**
   - Public deployment is strictly deferred until pilot user feedback and enterprise policy management are completed in subsequent milestones.
