# Privacy and Failure Testing Report: Real-World Resilience & Data Protection Audit

**Guardrail UI — Day 20: Browser Integration & Real-World Security Validation**  
**Prompt 6: Privacy and Failure Testing**  
**Audit Date:** November 2, 2026  
**Test Suite:** `guardrail/extension/src/browser-test/test-privacy-and-failure.ts`  
**Execution Command:** `npm --prefix guardrail/extension run test:browser:privacy`  
**Verification Status:** **110 / 110 Assertions Passed (Zero Sensitive Leaks Detected)**

---

## 1. Executive Summary

This audit validates the privacy guarantees, credential redaction mechanisms, and safe failure behaviors of the **Guardrail UI** browser extension, background coordination service worker, approval pipeline, and caretaker dashboard shell.

Using isolated synthetic sentinels (representing passwords, one-time passcodes, payment cards, CVVs, Bearer tokens, session cookies, SSNs, and form text), tests verified that sensitive inputs are scrubbed at the point of DOM inspection, stripped before cross-context messaging, prohibited from wire serialization, and excised from diagnostic logs, error displays, and UI renders.

Concurrently, system failure resilience was proven across network loss (`ECONNREFUSED`), server timeouts, malformed schema payloads, storage I/O errors, invalid configuration versions, and uninitialized startup states. In every failure scenario, Guardrail upheld its fail-closed security invariants: **no failures were masked or converted into false successes**, protected DOM actions remained strictly **HELD**, and zero unapproved browser executions occurred.

```
========================================================================================
                          PRIVACY & FAILURE TEST VERIFICATION SUMMARY
========================================================================================
  Suite 1: DOM Inspection & Action Extraction Privacy       [PASS] (10/10 assertions)
  Suite 2: Cross-Context Messaging & Diagnostic Redaction   [PASS] (21/21 assertions)
  Suite 3: Wire Layer Sanitization & Pre-Dispatch Scans     [PASS] (13/13 assertions)
  Suite 4: Service Failure Simulation & Safe Non-Execution  [PASS] (16/16 assertions)
  Suite 5: Storage Failures, Cooldown & Health Transitions  [PASS] (36/36 assertions)
  Suite 6: Caretaker Dashboard Privacy & Truthful States    [PASS] (14/14 assertions)
----------------------------------------------------------------------------------------
  TOTAL REGRESSION INTEGRITY:                               [PASS] (110/110 assertions)
  SENSITIVE DATA SENTINEL LEAKAGES DETECTED:                NONE (0 LEAKS)
========================================================================================
```

---

## 2. Task 1: Complete Data Flow & Privacy Inventory

The table below traces every data stage across the extension and dashboard lifecycle, identifying the exact boundary controls that remove, reject, or sanitize sensitive information:

| Data Flow Stage | Data Elements Handled | Sensitive Information Removed / Excluded | Enforcement Mechanism & Source Location |
| :--- | :--- | :--- | :--- |
| **1. DOM Inspection** | Tag name, element ID, public attributes, visible text | Form values (`element.value`), passwords, credit card inputs, typed textarea contents, surrounding child inputs | `extractVisibleText` in [`dom.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/dom.ts). Returns strictly `placeholder` for text/password/email inputs; returns `undefined` for `HTMLFormElement`. |
| **2. Action Metadata** | Action ID, category, element descriptors, sanitized page URL | URL query strings (`?token=...`, `?key=...`), hash fragments (`#...`), page `title` | `dispatchActionToBackground` in [`messaging.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/messaging.ts). Strips `page.title` to `''`, element `visibleText` to `undefined`, and URL to origin + pathname. |
| **3. Risk Evaluation** | Action category, heuristic score, high-level triggers | Raw keystrokes, form input buffers, clipboard data | Risk pipeline consumes only normalized [`GuardrailAction`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/types/action.ts) metadata. |
| **4. Approval Requests** | Action ID, category, high-level description, element summary, canonical URL | User passwords, payment cards, CVVs, session tokens, personal form data | `checkPayloadForSensitiveFields` & `validateClientPayloadIntegrity` in [`client.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/client.ts). Fails pre-dispatch if sensitive keys are detected. |
| **5. Storage Records** | Policy configuration, active rules, health metrics, cooldown timers | User credentials, session tokens, browser history, site credentials | `ConfigStorageProvider` strictly scopes storage to `guardrail_policy_config` root; ignores extraneous keys. |
| **6. Diagnostic Logs** | Event names, status codes, timing metrics, redacted summaries | Passwords, PINs, OTPs, CVVs, tokens, secrets, session IDs, raw form data | `createDiagnosticLogger` and `sanitizeForDiagnostics` in [`privacy.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/privacy.ts). Replaces forbidden key patterns with `[REDACTED]`. |
| **7. Error Messages** | Error codes, high-level descriptions, sanitized HTTP statuses | Multiline stack traces, internal paths (`/var/app/...`), DB queries (`SELECT * FROM...`), Bearer tokens | `sanitizeApprovalErrorMessage` in [`status.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/staging/status.ts). Sanitizes messages before presentation. |
| **8. Dashboard Rendering** | Request IDs, timestamps, risk badges, action descriptions | Unredacted auth tokens, user credentials, ward passwords, sensitive form inputs | DOM rendering in [`pending.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/pending.ts) renders text safely via `textContent` and sanitizes IDs. |
| **9. Runtime Messages** | Canonical message type, request ID, status | Injected script overrides, DOM object references, unverified payload properties | `validateContentScriptMessage` in [`background/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/background/index.ts). Disallows unwhitelisted properties. |

---

## 3. Task 2: Sensitive-Data Redaction & Sanitization Audit

### 3.1 Synthetic Sentinel Test Categories
To ensure exhaustive verification without compromising production security or real user data, 9 distinct synthetic sentinel categories were defined:

*   **Password Sentinel (`synth_pwd_...`):** Simulated plaintext user credentials.
*   **OTP Sentinel (`synth_otp_...`):** Simulated 6-digit one-time authorization passcodes.
*   **Card Sentinel (`synth_card_...`):** Synthetic test payment card numbers.
*   **CVV Sentinel (`synth_cvv_...`):** Synthetic 3-digit card security verification codes.
*   **Auth Token Sentinel (`synth_token_...`):** Synthetic Bearer JWT strings.
*   **Session ID Sentinel (`synth_sess_...`):** Synthetic HTTP cookie session identifiers.
*   **SSN Sentinel (`synth_ssn_...`):** Synthetic national identification numbers.
*   **Raw Form Data Sentinel (`synth_form_...`):** Synthetic free-text multi-line notes.
*   **URL Query Token Sentinel (`synth_url_...`):** Synthetic session query parameters.

### 3.2 Redaction Verification Results

```
+--------------------------------------------------------------------------------------------------+
| Output Channel Checked            | Sentinels Tested         | Leakage Detected | Enforcement    |
+-----------------------------------+--------------------------+------------------+----------------+
| DOM Action Extraction             | Password, Card, Form     | NONE (0 Leaks)   | Placeholder    |
| Diagnostic Serializer             | All 9 Sentinel Types     | NONE (0 Leaks)   | [REDACTED]     |
| Diagnostic Logger Output          | Password, OTP, Token     | NONE (0 Leaks)   | [REDACTED]     |
| Cross-Context Runtime Message     | URL Tokens, Form Inputs  | NONE (0 Leaks)   | Query Stripped |
| Background Dispatch Pipeline      | Password, OTP, Card      | NONE (0 Leaks)   | 400 Bad Req    |
| Action Digest Hasher              | Secret, Token, Key       | NONE (0 Leaks)   | Throws Error   |
| Wire API Request Body             | Password, Form Fields    | NONE (0 Leaks)   | Pre-Scan Reject|
| User-Facing Error Messages        | Stack Trace, SQL, Token  | NONE (0 Leaks)   | Sanitizer      |
| Caretaker Dashboard DOM           | Token, Password, Key     | NONE (0 Leaks)   | textContent    |
+--------------------------------------------------------------------------------------------------+
```

### 3.3 Key Redaction Findings
1.  **Strict Placeholder Extraction:** [`extractVisibleText`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/dom.ts#L45-L75) checks the input `type` attribute. For `password`, `text`, and `email` inputs, `element.value` is never read; only `element.placeholder` is exposed to diagnostic context.
2.  **Form Element Content Insulation:** For `<form>` containers, `extractVisibleText` returns `undefined` rather than concatenating child element texts, preventing nested password or payment fields from leaking into parent form descriptors.
3.  **Recursive Nested Redaction:** [`sanitizeForDiagnostics`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/privacy.ts#L60-L110) traverses nested objects and arrays of arbitrary depth, replacing sensitive keys matching `FORBIDDEN_SENSITIVE_KEY_PATTERNS` with `"[REDACTED]"`.
4.  **Action Digest Whitelist:** [`computeActionDigest`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/binding.ts#L100-L145) operates on an explicit whitelist of canonical properties (`actionId`, `actionType`, `category`, `pageUrl`, `selector`, `tag`). Injecting unpermitted keys (such as `password` or `token`) causes immediate exception throwing before digest computation.

---

## 4. Task 3: Simulated Service Failures & Safe Non-Execution

The test suite systematically simulated 7 classes of real-world operational failure to verify that Guardrail preserves action suppression and truthful status reporting:

```
[Simulated Service Failure Matrix]

   Failure Scenario              System Behavior                   Action State   Outcome Truthfulness
  ----------------------------- --------------------------------- -------------- -----------------------
   1. Unbound Port (Closed TCP)  Maps to NETWORK_FAILURE            HELD           Reported as UNCERTAIN
   2. HTTP Network Timeout       Aborts request; no retry loops     HELD           Reported as UNCERTAIN
   3. Malformed Schema (Corrupt) Fails schema validator (400)      HELD           Reported as MALFORMED
   4. Disconnected Worker        Catches Invalidated Context        HELD           Reported as UNCERTAIN
   5. Storage Read Exception     Sets healthStatus to FAILED        HELD           Reported as FAILED
   6. Stale/Unsupported Config   Rejects schema; default fallback   HELD           Reported as FAILED
   7. Missing Policy Init        cancelControlledAction executes    HELD           Suppressed Synchronously
```

### 4.1 Detailed Failure Behavior Analysis

#### Scenario A: Network Unavailability (`ECONNREFUSED`)
*   **Simulation:** Target HTTP server was pointed to an unassigned port (`127.0.0.1:9998`).
*   **Observed Behavior:** [`ApprovalApiClient`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/client.ts) caught the connection refusal, mapped the error code cleanly to `ApiClientErrorCodes.NETWORK_FAILURE` (`statusCode: 0`), and produced the sanitized message `"Network request failed. Check connectivity and retry."`.
*   **Safety Outcome:** [`determineApprovalState`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/staging/status.ts) mapped the result to `UIApprovalStatus.SUBMISSION_OUTCOME_UNKNOWN`. The protected action remained strictly **HELD** (`isActionHeld: true`, `isBackendConfirmed: false`).

#### Scenario B: Timeout Uncertainty & Concurrency Throttling
*   **Simulation:** Simulated request timeout without server response.
*   **Observed Behavior:** Handled as `SubmissionOutcome.TIMEOUT_UNCERTAIN`. Guardrail avoided infinite retry loops or background polling spam that could trigger duplicate financial or destructive transactions.
*   **Safety Outcome:** Action remained safely paused; UI informed the user that backend state is unconfirmed.

#### Scenario C: Malformed Backend Responses
*   **Simulation:** Mock backend returned corrupted payloads (non-objects, missing required keys like `userId` or `bindingId`, invalid enum values like `"UNKNOWN_STATUS_VALUE"`, and PENDING states illegally carrying `decision` blocks).
*   **Observed Behavior:** [`validateBackendApprovalResponse`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/client.ts) caught 100% of invalid payloads, rejecting them with `valid: false`.
*   **Safety Outcome:** Modal displayed `UIApprovalStatus.MALFORMED_RESPONSE` ("Invalid Server Response") while maintaining `isActionHeld: true`.

#### Scenario D: Disconnected Extension Runtime (Context Invalidated)
*   **Simulation:** Simulated extension update or worker termination where `chrome.runtime.id` is absent during user interaction.
*   **Observed Behavior:** Content script detected runtime disconnection, logged `"Extension runtime is unavailable"`, and safely aborted dispatch.
*   **Safety Outcome:** The protected browser action was **not** released or replayed. The error message confirmed: `"Extension context was invalidated or background service worker is inactive. Action remains safely HELD."`.

---

## 5. Task 4: Privacy During Failure Handling

When services fail, error reporting often introduces side-channel credential leakage through stack traces, query parameters, or raw database messages. Guardrail’s failure sanitizer was tested against adversarial inputs:

### 5.1 Error Sanitization Benchmark
An adversarial error payload containing a multiline stack trace, internal server paths, SQL query with sensitive tokens, and plaintext passwords was passed to [`sanitizeApprovalErrorMessage`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/staging/status.ts#L184-L245):

```typescript
// Input Error:
Error: Database query failed: SELECT * FROM users WHERE token='synth_token_...' and password='synth_pwd_...';
  at Query.execute (/var/app/internal/db/conn.ts:45:12)
  at async handleRequest (/var/app/server.ts:120:5)

// Sanitized Output:
Error: Database query failed: [Database details omitted] [Internal file] [Internal file]
```

### 5.2 Verification Checklist:
*   [x] **Stack Traces Stripped:** Lines matching `/at\s+.*(\n|$)/g` are completely eliminated.
*   [x] **Internal File Paths Removed:** Filesystem paths matching `/(?:\/[a-zA-Z0-9_.\-]+)+\.[a-zA-Z0-9]+/g` are replaced with `"[Internal file]"`.
*   [x] **Database Syntax Stripped:** Queries matching `/\b(SELECT|INSERT|UPDATE|DELETE|...)\b/gi` are replaced with `"[Database details omitted]"`.
*   [x] **Bearer Credentials Redacted:** Tokens matching `/bearer\s+[a-zA-Z0-9_\-\.]+/gi` are replaced with `"Bearer [REDACTED]"`.
*   [x] **URL Context Preserved Safely:** The origin and pathname are retained for debugging while all query strings (`?token=...`) and hash fragments are stripped.

---

## 6. Task 5: Status Accuracy, Health Transitions & Truthful Messaging

### 6.1 Policy Configuration Health State Model
[`PolicyConfigLoader`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/loader.ts) maintains a strict four-state health machine (`ConfigHealthStatus`):

```
       [UNINITIALIZED]
              │
       load() │
              ▼
       ┌──────────────┐
       │ Storage Read │
       └──────┬───────┘
              │
       ┌──────┴──────────────────────────┐
       │                                 │
 [Valid & Complete]              [Read / Schema Error]
       │                                 │
       ▼                                 ▼
   [HEALTHY]                         [FAILED]
       ▲                                 │
       │ [Missing Optional Fields]       │ (Activates Cooldown)
       └──────────────┬──────────────────┘
                      │
                      ▼
                 [DEGRADED]
```

*   **UNINITIALIZED:** Default state at boot. Synchronously halts any monitored DOM actions via `cancelControlledActionUntilPolicyInitialized`.
*   **HEALTHY:** Config root is valid, schema version matches `CURRENT_CONFIG_VERSION` (`1.0.0`), all mandatory policies are present, and storage read completed without error.
*   **DEGRADED:** Config root is valid and mandatory policies exist, but optional properties are missing. Loader logs warnings, applies safe defaults, and marks status as `DEGRADED`.
*   **FAILED:** Triggered by storage read exceptions, corrupted config roots, or stale/unsupported schema versions (`v0.9.0` or `v2.0.0`). Activates `failureCooldownMs` (30 seconds) where subsequent loads are served safely from cached default fallbacks. **Never reports `HEALTHY` when dependencies fail.**

### 6.2 Truthful User Messaging Invariants
In accordance with ethical human-agent interaction principles:
1.  **Zero Notification Fabrication:** The extension UI and dashboard strictly avoid claiming that a caretaker has received an SMS, email, or push notification. The confirmation text states truthfully:  
    > *"Your approval request (apr_...) has been registered on the server in PENDING status. This action remains safely paused and will not execute until approved."*
2.  **No False Pre-Approvals:** Staging mode explicitly displays *"Action Paused for Your Review"* and *"Nothing has been sent or changed yet."*
3.  **No Automatic Replay on Approval:** When a caretaker marks a request as `APPROVED`, the action remains **HELD**. It does not execute until the user explicitly reviews the approval verdict and confirms execution.

---

## 7. Task 6: Automated Test Suite & Coverage

The automated test suite is implemented in [`test-privacy-and-failure.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/browser-test/test-privacy-and-failure.ts) and wired to `npm --prefix guardrail/extension run test:browser:privacy`.

### Test Architecture Highlights:
*   **Dual-Port Test Server:** Spins up an ephemeral static server (`127.0.0.1:8880`) and real HTTP mock approval backend (`127.0.0.1:3003`).
*   **Zero Production Leaks:** Uses exclusively synthetic sentinels defined in `SYNTH_SENTINELS`.
*   **Deterministic Assertion Counters:** Tracks exact assertion counts (`passedAssertions`) and cleans up server processes in a `finally` block to prevent orphaned listening ports.

### Assertion Summary:
```
========================================================================================
Suite 1: DOM Inspection & Action Extraction Privacy
  - Scenario 1.1: Password input values never extracted (placeholder only)       [PASS]
  - Scenario 1.2: Payment card values never extracted (placeholder only)          [PASS]
  - Scenario 1.3: Textarea content never extracted (placeholder only)              [PASS]
  - Scenario 1.4: Form child inputs never concatenated into visibleText          [PASS]
  - Scenario 1.5: Submit button value treated strictly as label text              [PASS]
  - Scenario 1.6: Diagnostic URL query parameters and hashes scrubbed             [PASS]

Suite 2: Cross-Context Messaging & Diagnostic Redaction
  - Scenario 2.1: sanitizeForDiagnostics scrubs all 9 sensitive key patterns     [PASS]
  - Scenario 2.2: Deeply nested objects and arrays recursively scrubbed           [PASS]
  - Scenario 2.3: isPrivacySafe deterministically verifies payload safety         [PASS]
  - Scenario 2.4: DiagnosticLogger redacts credentials before log emission        [PASS]
  - Scenario 2.5: dispatchActionToBackground scrubs DOM text and URL query data   [PASS]

Suite 3: Wire Layer Sanitization & Rejection of Sensitive Payloads
  - Scenario 3.1: Pre-dispatch scan rejects credentials with 400 Bad Request      [PASS]
  - Scenario 3.2: computeActionDigest rejects unpermitted/sensitive properties    [PASS]
  - Scenario 3.3: sanitizeApprovalErrorMessage scrubs stack traces, tokens, SQL   [PASS]

Suite 4: Service Failure Simulation & Safe Non-Execution
  - Scenario 4.1: Closed port connection drops map to NETWORK_FAILURE (HELD)      [PASS]
  - Scenario 4.2: Timeout fails safely as TIMEOUT_UNCERTAIN without auto-retries  [PASS]
  - Scenario 4.3: Malformed backend payloads rejected by schema validator (HELD)  [PASS]
  - Scenario 4.4: Disconnected extension runtime aborts safely (HELD)             [PASS]

Suite 5: Storage Failures, Cooldown & Configuration Health Transitions
  - Scenario 5.1: Storage I/O failure sets FAILED status and activates cooldown   [PASS]
  - Scenario 5.2: Corrupted configuration root fails safely to FAILED status      [PASS]
  - Scenario 5.3: Stale (v0.9.0) and unsupported (v2.0.0) versions fail to FAILED[PASS]
  - Scenario 5.4: Missing optional properties transition health to DEGRADED       [PASS]
  - Scenario 5.5: Clean configuration transitions health to HEALTHY               [PASS]
  - Scenario 5.6: UNINITIALIZED health state synchronously halts DOM actions      [PASS]

Suite 6: Caretaker Dashboard Privacy & Truthful Failure States
  - Scenario 6.1: Dashboard fetch failure transitions status to error             [PASS]
  - Scenario 6.2: Caretaker dashboard DOM contains zero credentials or tokens     [PASS]
  - Scenario 6.3: Modal messaging never fabricates SMS or email delivery claims   [PASS]
========================================================================================
```

---

## 8. Documented Boundaries & Limitations

1.  **In-Memory Development Backend:** The test environment runs against the in-memory mock approval backend (`isProduction: false`). While HTTP semantics, status codes (201, 400, 401, 403, 404, 413, 415), and schema validations mirror production, long-term disk persistence and database race conditions require a production PostgreSQL database.
2.  **DOM Node.js Duck-Typing:** Headless testing utilizes lightweight duck-typed DOM mocks (`MockDOMElement`, `MockDOMTokenList`) for fast, hermetic execution in Node.js. Action interception in real Chrome is verified via `test-action-interception-verification.ts`.
3.  **Third-Party Messaging Channels:** Guardrail purposefully does not bundle SMS gateways (Twilio) or email dispatchers (SendGrid) inside the client browser extension. The client reports only authoritative backend approval state.

---

## 9. Conclusion

Guardrail UI successfully enforces comprehensive privacy boundaries and safe fail-closed resilience. Sensitive user data is systematically prevented from leaking through DOM inspection, background messaging, wire payloads, diagnostic logs, and error traces. In the face of network outages, timeouts, malformed responses, and storage failures, the system truthfully informs the user, never fabricates operational status, and preserves the unviolated invariant: **protected actions remain strictly HELD until explicit human confirmation**.

