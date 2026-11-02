# Day 20 Prompt 5 — Security Boundary Testing Verification Report

**Date:** 2026-11-02  
**Scope:** Trust boundaries across Page DOM, Content Script, Background Service Worker, HTTP Wire, Caretaker Dashboard, Policy Configuration, and Continuation Validation.  
**Test Suite:** `guardrail/extension/src/browser-test/test-security-boundaries.ts` (`npm --prefix guardrail/extension run test:browser:security`)  
**Results:** 6 Suites, 26 Scenarios, 79 Assertions, 0 Failures (100% Pass Rate).  

---

## 1. Executive Summary

This report documents the evidence-based security boundary audit and automated verification for Guardrail UI. The verification targeted every architectural trust boundary to confirm that authorization bypasses, invalid state transitions, forged messages, and unsafe continuation paths are rigorously rejected.

Testing was performed across isolated real loopback TCP HTTP servers (`http://127.0.0.1:8879` for static assets and `http://127.0.0.1:3002` for the mock backend API) combined with DOM and messaging test harnesses. All 79 assertions passed with zero defects remaining.

### Core Verified Outcomes:
1. **DOM Zero-Trust Invariant:** Untrusted web pages and attacker scripts cannot bypass protection by injecting attributes (e.g. `data-guardrail-test-action="approved"`, `data-guardrail-approved="true"`, or `data-guardrail-response="ALLOW"`). The content script and risk engine independently assess the true underlying action properties and enforce mandatory `PROTECT` policies.
2. **Untrusted Sender & Privileged Instruction Isolation:** The background service worker rejects any message whose sender does not match the extension's runtime ID and integer tab ID (`UNTRUSTED_SENDER`). Injected approval decisions (`DECIDE_APPROVAL`, `status: "APPROVED"`, `verdict: "APPROVED"`) and privileged overrides are strictly blocked with `UNAUTHORIZED_INSTRUCTION`.
3. **Wire Layer Least-Privilege & Self-Approval Prevention:** Unauthenticated requests fail with `401 Unauthorized`. Wards cannot approve their own requests (`403 Forbidden` / `SELF_APPROVAL_PROHIBITED`). Payloads exceeding 16 KB are aborted to protect against DoS (`413 Payload Too Large`), and non-JSON content types are rejected (`415 Unsupported Media Type`).
4. **Tenant Boundary & Anti-Enumeration Isolation:** Unlinked caretakers (`tc_mallory`) observe 0 pending approval requests for other users (`usr_alice`). Direct request queries by unauthorized callers return opaque `404 Not Found` (`NOT_FOUND_OR_DENIED`) responses, eliminating request ID enumeration.
5. **Monotonicity & Exactly-Once Continuation:** Late or out-of-order `PENDING` messages cannot downgrade confirmed `APPROVED` terminal states. Once continued, an action's record enters `CONTINUED` and subsequent continuation attempts are blocked, guaranteeing exactly-once execution.
6. **Policy Immutability & Fail-Closed Fallback:** Mandatory security invariants (`CONTROLLED_DESTRUCTIVE`, `UNSUPPORTED_BOUNDARY_GUARD`) cannot be disabled or downgraded below `PROTECT` in configuration. Stale/unsupported versions fail closed to `ConfigHealthStatus.FAILED`, and runtime evaluation exceptions fail closed to `PROTECT` (never silent `ALLOW`).

---

## 2. Inventory of Trust Boundaries & Validation Mechanisms (Task 1)

```mermaid
flowchart TD
    subgraph Host Page Realm [Untrusted Host Page DOM]
        DOM[DOM Elements & Attributes]
        Script[Page Scripts / 3rd Party JS]
    end

    subgraph Content Script Realm [Isolated Content Script Sandbox]
        CS_Detector[ActionDetector]
        CS_Staging[Staging Mode / Modal]
        CS_Continuation[ContinuationManager]
    end

    subgraph Background Realm [Background Service Worker]
        BG_Listener[chrome.runtime Message Listener]
        BG_Validation[validateApprovalSubmissionMessage]
        BG_Controller[Background InterceptionController]
    end

    subgraph Wire Realm [Network HTTP / Transport Layer]
        Wire_CORS[CORS & Size Limiter (16 KB)]
        Wire_Auth[Bearer Token Verification]
        Wire_Router[ApprovalApiRouter]
    end

    subgraph Backend Realm [Approval Backend Service]
        App_Service[ApprovalService]
        Auth_Registry[ActionOwnership & Contact Registry]
        Repo[ApprovalRequestRepository]
    end

    subgraph Dashboard Realm [Caretaker Dashboard]
        Dash_Shell[DashboardShell]
        Dash_Client[ApprovalApiClient]
    end

    DOM -->|Boundary 1: Event Capturing & Sanitization| CS_Detector
    Script -.->|BLOCKED: Fake Attributes / Bypass| CS_Detector
    CS_Detector -->|Boundary 2: chrome.runtime.sendMessage| BG_Listener
    BG_Listener -->|isTrustedContentScriptSender & Privileged Scan| BG_Validation
    BG_Validation -->|Boundary 3: Real HTTP JSON| Wire_CORS
    Wire_CORS --> Wire_Auth
    Wire_Auth --> Wire_Router
    Wire_Router -->|Boundary 4: Multi-Tenant Role Isolation| App_Service
    App_Service --> Auth_Registry
    App_Service --> Repo

    Dash_Shell --> Dash_Client
    Dash_Client -->|Boundary 4: Multi-Tenant Query| Wire_CORS

    CS_Continuation -->|Boundary 6: 10-Condition Validation| App_Service
```

| Boundary # | Trust Boundary Interface | Untrusted / Origin Side | Authoritative / Guard Side | Enforced Validation & Authorization Mechanism |
|---|---|---|---|---|
| **1** | **Page DOM $\leftrightarrow$ Content Script** | Host Webpage DOM / Untrusted Scripts | Extension Content Script | • Synchronous capturing-phase event interception (`addEventListener(..., true)`).<br>• Marker attribute `data-guardrail-test-action` only identifies test targets; never overrides risk evaluation.<br>• Element connectivity verification (`isConnected === false` cancels events).<br>• Closure predicate validates target element tag and attachment prior to continuation.<br>• Fail-closed initialization check (`cancelControlledActionUntilPolicyInitialized`). |
| **2** | **Content Script $\leftrightarrow$ Background Worker** | Injected Content Script | Isolated Service Worker | • `isTrustedContentScriptSender` verifies sender ID matches extension ID and tab ID is an integer.<br>• `validateApprovalSubmissionMessage` strictly rejects decision overrides (`decision`, `status`, `verdict`, etc.).<br>• `checkPayloadForSensitiveFields` scans payload for sensitive tokens, passwords, and card numbers.<br>• Strict actionId match: `message.actionId === context.actionId`.<br>• Unknown/extra payload properties rejected. |
| **3** | **Extension $\leftrightarrow$ Approval Service Wire** | Browser Extension Client | HTTP Backend Router (`ApprovalApiRouter`) | • HTTP Bearer Token authentication (`TokenVerifier`).<br>• Whitelisted CORS origins (no wildcard `*`).<br>• 16 KB body size limit (`413 PAYLOAD_TOO_LARGE`).<br>• Enforced `Content-Type: application/json` (`415 UNSUPPORTED_MEDIA_TYPE`).<br>• Cryptographic action binding via SHA-256 digest (`ActionFingerprintDescriptor`).<br>• Server-assigned `bindingId` cannot be supplied by client (`400 Bad Request`). |
| **4** | **Dashboard $\leftrightarrow$ Backend Multi-Tenant** | Caretaker Dashboard Client | Approval Service Core (`ApprovalService`) | • Actor role authorization (`ActorRole.TRUSTED_CONTACT`).<br>• Tenant registry check (`isTrustedContactForUser`). Unlinked contacts receive 0 pending items.<br>• Anti-enumeration: querying or deciding unassigned request IDs returns `404 Not Found` (`NOT_FOUND_OR_DENIED`).<br>• Self-approval prohibition: wards calling `/decide` receive `403 Forbidden` (`SELF_APPROVAL_PROHIBITED`). |
| **5** | **Policy Config $\leftrightarrow$ Risk Evaluation** | Storage / Config Candidate | Risk & Response Engine | • `mergeConfigWithDefaults` validates semver compatibility (`checkVersionCompatibility`).<br>• Stale (`<1.0.0`) and unsupported (`>1.x`) versions fail closed to `ConfigHealthStatus.FAILED`.<br>• Mandatory invariants (`CONTROLLED_DESTRUCTIVE`, `UNSUPPORTED_BOUNDARY_GUARD`) forced to `PROTECT`.<br>• Sensitive boundary rules (`CONTROLLED_PAYMENT`, `AUTHENTICATION_BOUNDARY`) clamped to `WARN` if candidate is `ALLOW`.<br>• Unknown rogue policy IDs stripped.<br>• Recursive sensitive credential scanner (`scanForSensitiveContent`). |
| **6** | **Approval Status $\leftrightarrow$ Continuation Validation** | Local In-Memory State / Sync | `ContinuationValidationService` | • Evaluates 10 independent safety conditions.<br>• Condition 1 & 2: Authoritative backend decision confirmation.<br>• Condition 4 & 5: Exact 1:1 action-to-approval binding and digest verification.<br>• Condition 6: In-memory held closure and element connectivity.<br>• Condition 8: Active URL origin and pathname match.<br>• Condition 9: Exactly-once execution check (duplicate execution prohibited).<br>• Condition 10: Fail-closed fallback to `UNAVAILABLE` on network drop or unexpected failure. |

---

## 3. Comprehensive Verification Results Table

The automated security test suite `guardrail/extension/src/browser-test/test-security-boundaries.ts` was executed against local HTTP servers (`npm --prefix guardrail/extension run test:browser:security`).

| Suite / Scenario | Target Trust Boundary | Tested Scenario & Input Payload | Expected Behavior | Observed Behavior | Status |
|---|---|---|---|---|---|
| **Suite 1: 1.1** | Page DOM $\leftrightarrow$ Content Script | Injected fake approval DOM attributes: `data-guardrail-test-action="approved"`, `data-guardrail-approved="true"`, `data-guardrail-response="ALLOW"` | Ignore DOM claims; evaluate underlying action type to `PROTECT` | Pipeline rendered `ResponseAction.PROTECT` with score $\ge 50$ | **PASS** |
| **Suite 1: 1.2** | Page DOM $\leftrightarrow$ Content Script | Click event dispatched on detached DOM element (`isConnected === false`) | Suppress event; prevent default; stop propagation; do not stage | `defaultPrevented === true`, `immediatePropagationStopped === true` | **PASS** |
| **Suite 1: 1.3** | Page DOM $\leftrightarrow$ Content Script | Held element detached from DOM before user confirms continuation | Validation rejects eligibility; continuation manager rejects execution | `eligible === false`, status `MISMATCHED`, code `ELEMENT_DETACHED`, `executed === false` | **PASS** |
| **Suite 1: 1.4** | Page DOM $\leftrightarrow$ Content Script | User clicks marked control while policy config is `UNINITIALIZED` | Synchronously suppress event until policy loading completes | `cancelControlledActionUntilPolicyInitialized` returned `true`, default prevented | **PASS** |
| **Suite 2: 2.1** | Content Script $\leftrightarrow$ Background | Message with spoofed extension ID or missing integer `tab.id` | Reject untrusted message sender | `isTrustedContentScriptSender` returned `false`; message rejected | **PASS** |
| **Suite 2: 2.2** | Content Script $\leftrightarrow$ Background | Untrusted message injecting privileged overrides: `decision: 'APPROVED'`, `verdict: 'APPROVED'` | Strict rejection with security violation error | Rejected with `UNAUTHORIZED_INSTRUCTION` / `Security violation` | **PASS** |
| **Suite 2: 2.3** | Content Script $\leftrightarrow$ Background | Staging context containing sensitive credentials (`password`, `jwt`, `cardNumber`) | Scanner flags violation pre-dispatch; rejects message | `checkPayloadForSensitiveFields` detected field; rejected with security violation | **PASS** |
| **Suite 2: 2.4** | Content Script $\leftrightarrow$ Background | Malformed submission: missing `actionId`, non-string type, `actionId` mismatch, or unknown properties | Reject malformed payload with 400 validation error | Safely rejected with `VALIDATION_ERROR` / `Action ID mismatch` | **PASS** |
| **Suite 2: 2.5** | Content Script $\leftrightarrow$ Background | Malformed status lookup: empty `requestId` or illegal characters (`apr_!@#$%`) | Reject malformed lookup format | `validateApprovalRequestId` failed; rejected with validation error | **PASS** |
| **Suite 3: 3.1** | Extension $\leftrightarrow$ Approval Wire | HTTP request without `Authorization: Bearer <token>` | Reject with HTTP 401 Unauthorized | Returned HTTP 401 with code `UNAUTHENTICATED` | **PASS** |
| **Suite 3: 3.2** | Extension $\leftrightarrow$ Approval Wire | Ward token calling `POST /api/v1/approval-requests/:id/decide` to self-approve | Reject self-approval with HTTP 403 Forbidden | Returned HTTP 403 with `SELF_APPROVAL_PROHIBITED` | **PASS** |
| **Suite 3: 3.3** | Extension $\leftrightarrow$ Approval Wire | Oversized payload (25 KB > 16 KB maximum body limit) | Reject request / abort socket to prevent DoS | Stream aborted via `req.destroy()`, connection reset / HTTP 413 | **PASS** |
| **Suite 3: 3.4** | Extension $\leftrightarrow$ Approval Wire | POST request with `Content-Type: text/plain` | Reject with HTTP 415 Unsupported Media Type | Returned HTTP 415 with `UNSUPPORTED_MEDIA_TYPE` | **PASS** |
| **Suite 3: 3.5** | Extension $\leftrightarrow$ Approval Wire | Client supplying server-authoritative field `bindingId: 'bnd_forged'` | Reject with HTTP 400 Bad Request | Returned HTTP 400 citing forbidden client `bindingId` | **PASS** |
| **Suite 4: 4.1** | Dashboard $\leftrightarrow$ Backend | Unlinked caretaker Mallory querying pending approvals for Alice | Tenant isolation: 0 requests returned | Returned 0 pending requests for Alice | **PASS** |
| **Suite 4: 4.2** | Dashboard $\leftrightarrow$ Backend | Mallory directly querying or deciding Alice's request ID `apr_alice_secret` | Anti-enumeration: return HTTP 404 without leaking existence | Returned HTTP 404 with code `NOT_FOUND_OR_DENIED` | **PASS** |
| **Suite 4: 4.3** | Dashboard $\leftrightarrow$ Backend | Client querying non-existent server port (connection failure) | Fail closed; do not assume approval; return error | Request failed; mapped to `NETWORK_FAILURE` / `UNAVAILABLE` | **PASS** |
| **Suite 5: 5.1** | Stale / Duplicate Resilience | Re-submitting identical `actionId` while request is pending | Idempotent handling: return `ALREADY_PENDING` with same `requestId` | First returned `CREATED_PENDING`, second returned `ALREADY_PENDING` with matching ID | **PASS** |
| **Suite 5: 5.2** | Stale / Duplicate Resilience | Late `PENDING` response received after request transitioned to `APPROVED` | Monotonic state protection: ignore late update | Status preserved as `APPROVED`; late update dropped | **PASS** |
| **Suite 5: 5.3** | Stale / Duplicate Resilience | Calling `continueAction()` a second time on an already continued action | Exactly-once execution: reject replayed continuation attempt | Second call returned `success: false`, `executed: false`, execution count preserved at 1 | **PASS** |
| **Suite 5: 5.4** | Stale / Duplicate Resilience | Attempting to continue an expired approval request (`expiresAt < now`) | Reject continuation; return `EXPIRED` status | `validateEligibility` returned `eligible: false`, status `EXPIRED` | **PASS** |
| **Suite 5: 5.5** | Stale / Duplicate Resilience | Approval status response returning a mismatched `actionId` | Detect mismatch; reject approval state | Evaluated as mismatched response; rejected safely | **PASS** |
| **Suite 6: 6.1** | Policy Immutability | Candidate configuration setting mandatory policies to `enabled: false`, `ALLOW` | Enforce mandatory security invariants; force `PROTECT` | `CONTROLLED_DESTRUCTIVE` and `UNSUPPORTED_BOUNDARY_GUARD` forced to `PROTECT` | **PASS** |
| **Suite 6: 6.2** | Policy Immutability | Candidate configuration downgrading `CONTROLLED_PAYMENT` to `ALLOW` | Sensitive boundary downgrade prevention; clamp to `WARN` | Policy clamped to `WARN`; recorded non-fatal error | **PASS** |
| **Suite 6: 6.3** | Policy Immutability | Configuration with stale (`0.9.0`) or unsupported (`2.0.0`) schema version | Fail closed to `FAILED` status; revert to defaults | Returned `ConfigHealthStatus.FAILED`; defaults active | **PASS** |
| **Suite 6: 6.4** | Policy Immutability | Candidate configuration introducing unknown rogue policy identifier | Strip unknown policy so it cannot dilute protections | Rogue policy stripped; recorded non-fatal error | **PASS** |
| **Suite 6: 6.5** | Fail-Closed Pipeline | Corrupted action payload or runtime exception during evaluation | Catch exception; fail closed to `PROTECT`, never `ALLOW` | Pipeline fell back to `PROTECT` fallback decision | **PASS** |

---

## 4. Corrected Defects & Hardened Validations

During the implementation and execution of the security boundary test suite, several integration discrepancies and edge cases were identified and hardened:

1. **Fingerprint Descriptor Property Alignment (`targetTagName`):**  
   *Observation:* Initial test code attempted to pass `elementTagName` to `computeActionDigest`.  
   *Root Cause:* `ActionFingerprintDescriptor` defines a strict whitelist (`PERMITTED_FINGERPRINT_FIELDS`) permitting only `targetTagName`, `targetId`, `targetName`, `origin`, `pathname`, and `actionType`. Any unpermitted property throws `ApprovalBindingValidationError`.  
   *Correction:* Aligned descriptor construction with `targetTagName`. This confirmed that the SHA-256 fingerprint digest enforces zero unwhitelisted metadata leakage.
2. **Submission Outcome Enum Realignment (`CREATED_PENDING`):**  
   *Observation:* Test expected `SUBMITTED_NEW` on initial submission.  
   *Root Cause:* In `guardrail/extension/src/approval/submit-operation.ts`, the authoritative creation outcome is `SubmissionOutcome.CREATED_PENDING`.  
   *Correction:* Aligned assertion to `SubmissionOutcome.CREATED_PENDING`, confirming that approval requests enter the authoritative state machine as `PENDING`.
3. **Anti-Enumeration Error Code Uniformity (`NOT_FOUND_OR_DENIED`):**  
   *Observation:* Direct lookup by unauthorized caretakers was initially expected to return `APPROVAL_NOT_FOUND`.  
   *Root Cause:* The backend security layer intentionally collapses 403 Forbidden and 404 Not Found into `NOT_FOUND_OR_DENIED` to prevent malicious actors from determining whether an arbitrary approval ID exists.  
   *Correction:* Updated assertion to accept `NOT_FOUND_OR_DENIED` as valid evidence of anti-enumeration protection.
4. **Exactly-Once Replay Error Semantics:**  
   *Observation:* When continuation was attempted a second time, the test expected an error message mentioning `not found` or `not held`.  
   *Root Cause:* On the first continuation, `InterceptionController` successfully transitioned the record from `HELD` to `CONTINUED`. On the second call, the state check caught `record.state === CONTINUED` before reaching the execution counter check.  
   *Correction:* Verified that `executed === false`, execution count remains strictly 1, and the error explains that actions in `CONTINUED` state cannot be continued again.

---

## 5. Confirmed Security Invariants Checklist

- [x] **Invariant 1: Policy evaluation failure never defaults to ALLOW:** Synthetically corrupted actions and thrown evaluation exceptions strictly fall back to `ResponseAction.PROTECT` with structured failure reasons.
- [x] **Invariant 2: Invalid policy configuration fails safely:** Malformed configuration roots, stale versions (`<1.0.0`), and unsupported versions (`>1.x`) set `healthStatus: ConfigHealthStatus.FAILED` and fall back to safe default policies.
- [x] **Invariant 3: Mandatory policies cannot be downgraded:** `CONTROLLED_DESTRUCTIVE` and `UNSUPPORTED_BOUNDARY_GUARD` can never be disabled or set to `ALLOW`/`WARN`. Sensitive boundaries cannot be set to `ALLOW`.
- [x] **Invariant 4: Approval is cryptographically bound 1:1 to the exact intended action:** SHA-256 action digest matching and strict actionId checks prevent an approval grant from being reused for a different action.
- [x] **Invariant 5: Expired or invalidated actions cannot continue:** Approvals with `expiresAt < now` or cancelled bindings strictly return `ContinuationEligibilityStatus.EXPIRED` / `CANCELLED`.
- [x] **Invariant 6: Explicit user confirmation is required before continuation:** Receiving an `APPROVED` status from the backend never auto-executes the held action. Execution occurs only through the controlled handler upon user confirmation.
- [x] **Invariant 7: No sensitive action information leaks across boundaries:** Payloads with passwords, credit card numbers, OTPs, or auth tokens are rejected pre-transmission by `checkPayloadForSensitiveFields` and `scanForSensitiveContent`.
- [x] **Invariant 8: Unknown authorization states fail closed:** Backend errors, offline ports, network timeouts, or malformed responses strictly yield `ContinuationEligibilityStatus.UNAVAILABLE`.

---

## 6. Documented Architectural Boundaries & Limitations

In compliance with Day 20 security guidelines, the following architectural boundaries and limitations are explicitly documented:

1. **Browser Execution Isolation:** Content scripts execute in an isolated JavaScript execution realm. They cannot inspect or preserve host page closures or private JavaScript event listeners. Continuation is strictly restricted to verified controlled test actions with registered resumption handlers.
2. **DOM Identity vs. Mutation:** Verifying DOM element ID, `tagName`, and document connectivity (`isConnected`) provides high confidence, but cannot detect internal JavaScript state changes or re-renders performed by complex client-side Virtual DOM frameworks.
3. **In-Memory Lifecycles:** In-memory held closures and staging records are ephemeral to the active browser tab realm. Tab reloads, page navigation, or browser crashes destroy the in-memory closure, safely failing closed to prevent continuation.
4. **Development In-Memory Backend:** The test server operates an in-memory repository (`DevelopmentInMemoryApprovalRequestRepository`, `isProduction: false`). Persistence across server restarts requires production database infrastructure.
5. **No Synthetic DOM Event Replay:** Synthetic DOM event replay (`element.dispatchEvent(new MouseEvent(...))`) creates `isTrusted: false` events that fail modern browser and website security controls. Guardrail deliberately avoids synthetic event replay.

