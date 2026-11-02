# Guardrail UI - Day 18 Policy Security Audit & End-to-End Verification

## 1. Executive Summary

This document provides a comprehensive, repository-wide, evidence-based security and architecture audit of the **policy configuration and enforcement architecture** across the Guardrail UI platform (Browser Extension, Backend Mock/Contract, and Caretaker Dashboard).

Guardrail mediates browser interactions to protect assisted users from irreversible, high-risk actions (e.g. account deletion, financial transfers, external credential shifts). Over Days 8–17, the repository established:
* Synchronous DOM capturing-phase event suppression and interception (`InterceptionController`, `ContinuationManager`).
* Isolated Shadow DOM Staging Mode and user confirmation (`StagingModal`, `StagingActionContext`).
* Authoritative backend approval domain models, 1:1 action-to-approval bindings with SHA-256 `actionDigest`, and atomic CAS state transitions (`ApprovalService`, `ApprovalActionBinding`).
* Trusted-Contact Dashboard (`guardrail/dashboard/`) and adaptive polling status synchronization (`ApprovalStatusSyncClient`).
* Controlled action continuation validation enforcing 10 mandatory conditions (`ContinuationValidationService`).
* Day 17 centralized risk-policy configuration schema, safe loader with debouncing and cooldown, defaults merging, and fail-closed health tracking (`PolicyConfigRegistry`, `PolicyConfigLoader`, `schema.ts`).

### Audit Objectives
Before executing Day 18 hardening and verification prompts (Prompts 2–7), this audit rigorously inspects the actual code paths to determine:
1. Are policy schema validation, defaults merging, and mandatory invariants securely enforced?
2. Can malformed, missing, or corrupt configuration accidentally result in an `ALLOW` decision?
3. Are policy decisions enforced consistently across the action detection $\rightarrow$ evaluation $\rightarrow$ staging $\rightarrow$ approval $\rightarrow$ continuation lifecycle?
4. Are approval requests strictly bound 1-to-1 to intercepted actions and validated prior to continuation?
5. Does the codebase truthfully differentiate between browser default event suppression and blocking arbitrary website JavaScript / network execution?
6. What concrete gaps, unverified assumptions, or runtime limitations exist today?

---

## 2. Components Inspected & Repository File Paths

All findings and architectural verifications in this report are grounded directly in the inspected files:

| Architectural Component | Key Files Inspected | Real Operational Status |
| :--- | :--- | :--- |
| **Policy Config Schema & Invariants** | `guardrail/extension/src/types/config.ts`<br/>`guardrail/extension/src/config/schema.ts` | **Active & Verified**: Strict schema validator (`validatePolicyConfig`), bounded numeric thresholds, whitelisted fields, mandatory invariants (`CONTROLLED_DESTRUCTIVE`, `UNSUPPORTED_BOUNDARY_GUARD`), zero-credential regex scanning. |
| **Central Policy Config Registry** | `guardrail/extension/src/config/registry.ts`<br/>`guardrail/extension/src/config/index.ts` | **Active & Verified**: Singleton `PolicyConfigRegistry` serving as single source of truth for dynamic thresholds (`getCriticalThresholdScore()`, `getRoutineThresholdMax()`), signal contributions, policies, and health states. |
| **Config Loader & Storage Provider** | `guardrail/extension/src/config/loader.ts` | **Active & Verified**: `PolicyConfigLoader` with safe merging (`mergeConfigWithDefaults`), version compatibility checking, storage abstraction (`ChromeLocalStorageProvider`, `InMemoryConfigStorageProvider`), debouncing, failure cooldown (5s), and fail-closed defaults. |
| **Risk Evaluation Engine** | `guardrail/extension/src/risk/engine.ts`<br/>`guardrail/extension/src/risk/rules.ts`<br/>`guardrail/extension/src/risk/signals.ts`<br/>`guardrail/extension/src/types/risk.ts` | **Active & Verified**: Evaluates `GuardrailAction` against deterministic prioritized rules, calculates clamped scores (0–100), maps to categorical `RiskLevel` via centralized thresholds. |
| **Response Policy Governance** | `guardrail/extension/src/response/engine.ts`<br/>`guardrail/extension/src/response/policies.ts`<br/>`guardrail/extension/src/response/rules.ts`<br/>`guardrail/extension/src/types/response.ts` | **Active & Verified**: Deterministic mapping to `ALLOW`, `WARN`, `PROTECT`. Monotonic precedence resolution (`PROTECT` > `WARN` > `ALLOW`). Pipeline consolidator (`evaluateActionPipeline`) enforces fail-closed `PROTECT` on config failure. |
| **Action Detector & Ambient Sensor** | `guardrail/extension/src/detector/action-detector.ts`<br/>`guardrail/extension/src/detector/action-factory.ts`<br/>`guardrail/extension/src/utils/dom.ts` | **Active & Verified**: Document-level capturing-phase event delegation (`click`, `change`, `submit`, `popstate`, `hashchange`). Differentiates ambient interactions from controlled test elements (`[data-guardrail-test-action]`). |
| **Interception State Controller** | `guardrail/extension/src/interception/controller.ts`<br/>`guardrail/extension/src/interception/transitions.ts`<br/>`guardrail/extension/src/types/interception.ts` | **Active & Verified**: In-memory state machine (`DETECTED` $\rightarrow$ `HELD` $\rightarrow$ `CONTINUED` \| `CANCELLED` \| `INVALIDATED`). `isActionHeld()` checks genuine holding before permitting approval or continuation. |
| **Staging Mode Quarantine & UI** | `guardrail/extension/src/staging/modal.ts`<br/>`guardrail/extension/src/staging/context.ts`<br/>`guardrail/extension/src/staging/status.ts`<br/>`guardrail/extension/src/types/staging.ts` | **Active & Verified**: Isolated Shadow DOM modal (`#guardrail-staging-modal-host`). Truthful status display (`UIApprovalStatus`). Disables automatic execution. Requires explicit user continuation button. |
| **Approval Domain Model & 1:1 Binding** | `guardrail/extension/src/approval/model.ts`<br/>`guardrail/extension/src/approval/binding.ts`<br/>`guardrail/extension/src/approval/lifecycle.ts`<br/>`guardrail/extension/src/approval/service.ts`<br/>`guardrail/extension/src/approval/client.ts`<br/>`guardrail/extension/src/types/approval.ts` | **Active & Verified**: Authoritative domain model (`apr_...`). 1:1 binding (`bnd_...`) locking `actionId` to `requestId` via SHA-256 `actionDigest`. Separation of duties (rejection of self-approval). |
| **Continuation & Validation Engine** | `guardrail/extension/src/interception/continuation.ts`<br/>`guardrail/extension/src/interception/validation-service.ts` | **Active & Verified**: `ContinuationValidationService` enforcing 10 conditions. `ContinuationManager` guarantees exactly-once execution of registered controlled test closures. Rejects synthetic DOM replay (`element.click()`). |
| **Extension Entrypoints** | `guardrail/extension/src/content/index.ts`<br/>`guardrail/extension/src/background/index.ts` | **Active & Partial**: Content script and Service Worker message hub (`validateApprovalSubmissionMessage`, `validateApprovalStatusLookupMessage`). *Audit Gap: Never invokes `loadPolicyConfigFromStorage` on startup.* |
| **Dashboard Shell & Sync** | `guardrail/dashboard/src/index.ts`<br/>`guardrail/dashboard/src/sync.ts` | **Active & Verified**: Trusted contact review portal, adaptive polling, monotonic sequence guard (`apr_newer_seq2`), multi-tenant isolation. |

---

## 3. Confirmed Findings Supported by Code & Test Evidence

### Finding 1: Runtime Configuration Bootstrap Gap in Extension Entrypoints
* **Severity**: **HIGH**
* **Affected Files**: `guardrail/extension/src/content/index.ts`, `guardrail/extension/src/background/index.ts`
* **Evidence**:
  - In `guardrail/extension/src/config/registry.ts`, the registry starts in `ConfigHealthStatus.UNINITIALIZED` with `DEFAULT_GUARDRAIL_POLICY_CONFIG`.
  - Searching the entire codebase reveals `loadPolicyConfigFromStorage()` and `loadFromStorage()` are only called inside test suites (`test-policy-config-loader.ts`).
  - Neither `content/index.ts` nor `background/index.ts` ever calls `loadPolicyConfigFromStorage()` during initialization or storage change events (`chrome.storage.onChanged`).
* **Impact**:
  - In actual browser execution, user or administrator configuration stored in `chrome.storage.local` is never loaded into memory. The extension runs strictly off the in-memory static default configuration.

### Finding 2: Direct Engine Callers Bypass the `isConfigFailed()` Fail-Closed Guard
* **Severity**: **MEDIUM**
* **Affected Files**: `guardrail/extension/src/risk/engine.ts`, `guardrail/extension/src/response/engine.ts`
* **Evidence**:
  - In `guardrail/extension/src/response/engine.ts` (lines 280–315), the check for `isConfigFailed()` is implemented inside `evaluateActionPipeline()`.
  - However, `RiskEngine.assess()` (`guardrail/extension/src/risk/engine.ts`, lines 200–260) and `ResponseEngine.decide()` (`guardrail/extension/src/response/engine.ts`, lines 90–120) do not check `isConfigFailed()`.
  - If any caller or future module calls `RiskEngine.assess()` or `ResponseEngine.decide()` directly rather than through `evaluateActionPipeline()`, a failed configuration will not cause the direct assessment to fail-closed to `PROTECT` (it continues evaluating with fallback defaults).
* **Impact**:
  - Risk and response engines should defensively enforce the `isConfigFailed()` fail-closed guard directly to prevent accidental bypass by modular callers.

### Finding 3: Interception is Structurally Restricted to Controlled Test Actions
* **Severity**: **INFORMATIONAL / ARCHITECTURAL BOUNDARY**
* **Affected Files**: `guardrail/extension/src/detector/action-detector.ts` (lines 110–125), `guardrail/extension/src/content/index.ts` (lines 358–365)
* **Evidence**:
  - `ActionDetector` inspects `event.target` using `findControlledTestAction()`, which searches for `[data-guardrail-test-action]`.
  - For standard webpage elements lacking this attribute, `ActionDetector` invokes `onAction(action)`.
  - In `content/index.ts`, if `decision.response === ResponseAction.PROTECT` for an ambient action, the content script explicitly logs:
    ```
    [Guardrail Sensor Limitation] 🛡️ PROTECT decision rendered for ambient action [act_...], but ambient page interactions cannot be synchronously intercepted or held without controlled test hooks ([data-guardrail-test-action]). Reporting architectural limitation: action was NOT held.
    ```
  - The DOM event is not cancelled (`preventDefault()` is not called) and no `InterceptionRecord` is created.
* **Impact**:
  - This is an intentional design boundary established in Day 8 to prevent breaking arbitrary websites with untested resumption. Documentation and test suites must continue to explicitly reflect this constraint and never claim universal browser interception.

### Finding 4: DOM Event Suppression vs Host Application JavaScript & Network Requests
* **Severity**: **INFORMATIONAL / ARCHITECTURAL BOUNDARY**
* **Affected Files**: `guardrail/extension/src/content/index.ts` (lines 478–485), `guardrail/docs/action-interception.md`
* **Evidence**:
  - When a controlled test action is intercepted, Guardrail executes:
    ```typescript
    event.preventDefault();
    event.stopImmediatePropagation();
    ```
  - This reliably prevents default browser actions (such as submitting an HTML form or navigating via anchor tag `<a href>`) and halts child event listeners in the DOM tree.
  - However, Guardrail operates purely as a content script DOM listener. It does not install `chrome.declarativeNetRequest` rules, does not hook `window.fetch` or `XMLHttpRequest`, and cannot prevent asynchronous network requests triggered by background timers or WebSockets.
* **Impact**:
  - Security documentation must clearly differentiate between halting DOM event propagation and blocking arbitrary outbound network requests.

### Finding 5: In-Memory Ephemeral Storage for Backend Approvals & Bindings
* **Severity**: **LOW**
* **Affected Files**: `guardrail/extension/src/approval/repository.ts`, `guardrail/server/README.md`
* **Evidence**:
  - `ApprovalRepository` and `ApprovalActionBindingRepository` operate strictly in-memory (`PERSISTENCE_METADATA.storageType = 'EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY'`).
  - Approval requests and bindings are lost if the mock API process or service worker shuts down.
* **Impact**:
  - Fully expected for Day 10–18 milestone foundation; documented in `PERSISTENCE_METADATA` and verified by tests (`Scenario 15: Architectural audit & production boundary verification`).

---

## 4. Missing Functionality & Unverified Assumptions

1. **Storage Change Synchronization (`chrome.storage.onChanged`)**:
   - When policy settings are saved via `PolicyConfigLoader.save()`, other extension contexts (e.g. content scripts running in active browser tabs) do not receive live updates unless `chrome.storage.onChanged` is hooked to reload the registry.
2. **Health Indicator Visibility in UI**:
   - `PolicyConfigRegistry` tracks `ConfigHealthStatus` (`HEALTHY`, `DEGRADED`, `FAILED`), but neither the warning modal nor the staging modal surfaces this health status directly to the user or caretaker.
3. **End-to-End Browser Testing in Headless Puppeteer/Playwright**:
   - The test suites use mock DOM environments (`window`, `document`, custom event dispatchers) and local HTTP servers (`http://127.0.0.1:57883`). A live Chrome extension package test in real Chrome has not been automated in package scripts.

---

## 5. Prioritized Security Issues

| Priority | Issue Description | Rationale |
| :--- | :--- | :--- |
| **High** | **Storage Bootstrap Gap in Extension Lifecycle** | Saved custom policy configurations in `chrome.storage.local` are never loaded upon browser extension startup, leaving the runtime in `UNINITIALIZED` default configuration. |
| **Medium** | **Direct Caller Fail-Closed Coverage** | Direct invocations of `RiskEngine.assess()` and `ResponseEngine.decide()` should directly verify `isConfigFailed()` rather than relying solely on the wrapper `evaluateActionPipeline()`. |
| **Medium** | **Storage Change Listener Synchronization** | Content scripts in existing tabs do not dynamically receive updated policy configurations when modified in storage. |
| **Low** | **Ephemeral In-Memory Persistence** | Approvals and bindings do not survive service worker restarts. Fully documented as development-only mock, but requires persistent SQLite/PostgreSQL in future backend milestones. |
| **Low** | **Network-Level Action Mediation** | Synchronous DOM interception does not block asynchronous network traffic (`fetch`/`XHR`) initiated outside DOM click handlers. |

---

## 6. Existing Protections That Must NOT Be Duplicated

To preserve architectural integrity and avoid regression, the following working implementations must be reused without creating duplicates:
1. **`PolicyConfigRegistry` and `PolicyConfigLoader`**: Do not create parallel registries or alternative config loaders.
2. **Schema Validator (`validatePolicyConfig`)**: Do not implement ad-hoc schema validators; extend or consume `schema.ts`.
3. **Mandatory Invariant Locks**: `CONTROLLED_DESTRUCTIVE` and `UNSUPPORTED_BOUNDARY_GUARD` locks are already implemented and tested across `schema.ts`, `loader.ts`, and `policies.ts`.
4. **Continuation Validation Service (`ContinuationValidationService`)**: All 10 continuation conditions, element detachment verification, and SHA-256 digest validation are centralized in `validation-service.ts`.
5. **Approval State Machine & 1:1 Binding**: Domain transitions, idempotency guards, and anti-tampering checks are completely implemented in `binding.ts`, `model.ts`, and `service.ts`.
6. **Privacy Redaction Whitelists**: Redaction regexes and forbidden keyword checkers are already standard across `schema.ts`, `loader.ts`, `client.ts`, and `model.ts`.

---

## 7. Actionable Implementation & Verification Plan (Day 18 Prompts 2–7)

* **Prompt 2: Policy Configuration Security Hardening & Runtime Bootstrap**
  - Wire `loadPolicyConfigFromStorage()` into extension bootstrap (`content/index.ts` and `background/index.ts`).
  - Add `chrome.storage.onChanged` listener to trigger `reloadPolicyConfig()` when policy changes occur in storage.
  - Guard `RiskEngine.assess()` and `ResponseEngine.decide()` directly against `isConfigFailed()`.
  - Add tests verifying startup bootstrap and storage change propagation.

* **Prompt 3: Action Interception Boundary & Staging Mode Hardening**
  - Verify that ambient (unmarked) actions continue to be evaluated without falsely claiming to be HELD.
  - Verify capturing-phase `preventDefault()` and `stopImmediatePropagation()` behavior on controlled elements.
  - Test Staging Modal cancel operations, ensuring cleanup of temporary holding state.

* **Prompt 4: Approval Status Synchronization & Anti-Tampering Verification**
  - Audit and test message verification boundaries between content script and background service worker (`validateApprovalSubmissionMessage`, `validateApprovalStatusLookupMessage`).
  - Verify that malicious or forged approval statuses injected via DOM/messages are rejected.
  - Verify terminal polling cleanup when status transitions to `APPROVED`, `REJECTED`, `EXPIRED`, or `CANCELLED`.

* **Prompt 5: Controlled Action Continuation & 1:1 Binding Enforcement**
  - Test all 10 continuation validation conditions end-to-end.
  - Verify that actions with altered URLs, origin shifts, or detached DOM targets fail closed (`ELEMENT_DETACHED`, `PAGE_CONTEXT_MISMATCH`).
  - Verify that continuation authorization can only be consumed once (`consumeContinuationAuthorization`).

* **Prompt 6: Health Reporting, Diagnostic Logging & Privacy Guarantees**
  - Verify that `ConfigHealthStatus` reflects `HEALTHY`, `DEGRADED`, and `FAILED` states accurately.
  - Audit diagnostic logging to ensure zero passwords, payment cards, OTPs, or session tokens leak into logs, storage, or error records.

* **Prompt 7: End-to-End System Verification & Regression Suite**
  - Execute full regression test suite across extension and dashboard.
  - Verify zero regressions against Day 8–17 invariants.
  - Produce final Day 18 verification sign-off.

---

## 8. Test Execution Commands & Verified Outcomes

The following real test commands were executed against the codebase during this audit:

| Test Command | Working Directory | Suites / Tests Run | Result | Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `npm test` | `guardrail/extension` | 44 test scripts across config, risk, response, staging, approval, continuation | **PASSED** (Exit 0) | All Day 8–17 regression suites passed cleanly without errors. |
| `npm test` | `guardrail/dashboard` | 4 test suites (`test:shell`, `test:verify-day12`, `test:sync`, `test:verify-complete-sync`) | **PASSED** (Exit 0) | 135 / 135 assertions passed cleanly over live local HTTP server. |
| `npm run test:config-loader` | `guardrail/extension` | 11 suites, 103 assertions | **PASSED** (Exit 0) | Verified defaults merging, version checking, storage failure fail-closed, cooldown throttling, and zero auto-execution. |
| `npm run test:policy-config` | `guardrail/extension` | 10 test groups, 117 assertions | **PASSED** (Exit 0) | Verified schema boundaries, invariant protection, sensitive keyword rejection. |
| `npm run test:centralization` | `guardrail/extension` | 9 test groups, 79 assertions | **PASSED** (Exit 0) | Verified central registry dynamic consumption, no magic numbers, monotonic precedence. |
| `npm run test:workflow` | `guardrail/extension` | 8 test groups, 51 assertions | **PASSED** (Exit 0) | Verified full workflow boundary enforcement, UI downgrade prevention, and fail-closed evaluation. |

---

*Report prepared as part of Day 18 Prompt 1: Audit The Existing Implementation.*
