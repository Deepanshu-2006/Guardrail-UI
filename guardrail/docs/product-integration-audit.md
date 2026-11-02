# Product Integration Audit

**Guardrail UI: End-to-End Product Integration & System Hardening**  
**Audit Purpose:** Comprehensive Product Workflow Verification  
**Audit Date:** November 3, 2026  
**Auditor:** Antigravity AI (Pair Programming with User)  
**Repository State:** Clean working tree  
**Execution Environment:** macOS Darwin 24.3.0, Node.js v24.14.0, Google Chrome 156

---

## 1. Executive Summary

Following the establishment of a real-browser CDP harness and local HTTP fixtures, this audit focuses on **product integration and system hardening**. Repository inspection shows that `test:browser:env` and `test:browser:interception` launch Chrome through `ChromeRunner`; `test:browser:approval`, `test:browser:security`, and `test:browser:privacy` run as Node integration tests using local HTTP/TCP fixtures and mock DOMs. Their passing results are not five real-browser suites.

This audit provides a comprehensive, evidence-based evaluation of the entire Guardrail product surface: the Manifest V3 browser extension, content script event interception, background service worker coordinator, centralized policy and risk pipelines, Shadow DOM staging mode, live HTTP approval workflow, continuation validation engine, and the trusted-contact dashboard shell.

### Key Audit Findings:
1.  **Core Safety Invariants Have Layered Evidence:** Controlled action interception, synchronous event suppression, and Staging UI mounting have real Chrome evidence. Approval lifecycle, dashboard synchronization, policy boundary, and privacy scenarios have Node unit/integration evidence, including local HTTP/TCP fixtures; they are not all verified in Chrome.
2.  **Privacy and Redaction are Strictly Enforced:** All 9 synthetic test sentinel categories (passwords, OTPs, cards, CVVs, tokens, cookies, SSNs, form text, and query parameters) are scrubbed before reaching diagnostics, wire APIs, error messages, or dashboard DOMs.
3.  **Identified Integration Gaps:**
    *   *Dashboard Standalone Bootstrapping:* `guardrail/dashboard/index.html` loads `dist/dashboard.js`, which auto-instantiates `DashboardShell` without an `ApprovalApiClient` or token provider, leaving standalone browser usage unconnected.
    *   *Extension Popup Observability:* `guardrail/extension/src/popup/index.ts` remains a minimal foundation placeholder displaying only static text ("Active", "0.1.0") without reflecting live policy health, held action state, or backend status.
    *   *Standalone Server Execution:* While `test-server.ts` provides a live HTTP server during automated tests, there is no standing daemon script (e.g. `npm run server:dev`) to run the backend persistently for manual cross-browser testing.
    *   *TypeScript Configuration Overlap:* `guardrail/extension/tsconfig.json` lacks `@types/node` while including Node-based test files in `src/`, causing static `type-check` script failures despite clean `esbuild` compilation and test execution.

---

## 2. Actual Architecture & Component Inventory

The table below maps the actual components, exported symbols, file locations, and architectural responsibilities across the product:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER EXTENSION DOMAIN                                  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Content Script Entry: guardrail/extension/src/content/index.ts                      │
│    - ActionDetector (src/detector/action-detector.ts)                                  │
│    - evaluateActionPipeline (src/response/engine.ts)                                   │
│    - defaultInterceptionController (src/interception/controller.ts)                    │
│    - defaultContinuationManager (src/interception/continuation.ts)                     │
│    - showStagingModal & startModalStatusSync (src/staging/modal.ts)                    │
│                                                                                        │
│ 2. Background Service Worker: guardrail/extension/src/background/index.ts              │
│    - isTrustedContentScriptSender                                                      │
│    - validateApprovalSubmissionMessage                                                 │
│    - handleBackgroundApprovalSubmission                                                │
│    - handleBackgroundApprovalStatusLookup                                              │
│    - backgroundInterceptionController                                                  │
│                                                                                        │
│ 3. Extension Popup: guardrail/extension/src/popup/index.ts                             │
│    - public/popup/popup.html & popup.css                                               │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │ Chrome Runtime Messaging
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                            POLICY & RISK PIPELINE DOMAIN                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Policy Configuration: guardrail/extension/src/config/loader.ts                      │
│    - PolicyConfigLoader, loadPolicyConfigFromStorage, reloadPolicyConfig               │
│    - ConfigHealthStatus: UNINITIALIZED, HEALTHY, DEGRADED, FAILED                      │
│    - Schema Validation: src/config/schema.ts (CURRENT_CONFIG_VERSION = '1.0.0')        │
│                                                                                        │
│ 2. Classification & Risk Scoring:                                                      │
│    - ActionClassifier (src/classifier/classifier.ts)                                   │
│    - RiskEngine (src/risk/engine.ts)                                                   │
│    - ResponseEngine (src/response/engine.ts) -> Precedence: PROTECT > WARN > ALLOW     │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │ Wire Boundary (REST API / Bearer Auth)
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                            APPROVAL & BACKEND SERVICE DOMAIN                           │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. REST API Router: guardrail/extension/src/approval/api.ts                            │
│    - ApprovalApiRouter: POST /create, GET /:id, POST /cancel, GET /pending, POST /decide│
│    - InMemoryTokenVerifier, AuthContext, ActorRole (WARD / CONTACT)                    │
│                                                                                        │
│ 2. Coordination Service: guardrail/extension/src/approval/service.ts                   │
│    - ApprovalService: Idempotency, Compound Keys, Anti-Enumeration 404, Authorization   │
│    - ActionOwnershipRegistry, TrustedContactRegistry (src/approval/authorization.ts)   │
│                                                                                        │
│ 3. Repository & Model:                                                                 │
│    - DevelopmentInMemoryApprovalRequestRepository (src/approval/repository.ts)         │
│    - ApprovalRequest Model & Lifecycle (src/approval/model.ts)                         │
│    - Action-to-Approval Binding: ApprovalActionBinding (src/approval/binding.ts)       │
│                                                                                        │
│ 4. Client Transport:                                                                   │
│    - ApprovalApiClient (src/approval/client.ts)                                        │
│    - submitApprovalRequest (src/approval/submit-operation.ts)                          │
│    - ApprovalStatusSyncClient (src/approval/sync-client.ts)                            │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │ REST Sync & Polling (GET /approvals/pending)
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         TRUSTED CONTACT DASHBOARD DOMAIN                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Dashboard Shell: guardrail/dashboard/src/shell.ts                                   │
│    - Views: Overview, Pending Approvals, Decision History                              │
│    - Decoupled Action Execution Notice: Confirms actions are reviewed, never executed  │
│                                                                                        │
│ 2. UI Components:                                                                      │
│    - renderNavigation (src/components/navigation.ts)                                   │
│    - renderPendingApprovals & Request Detail (src/components/pending.ts & detail.ts)   │
│    - renderDecisionHistory (src/components/history.ts)                                 │
│    - renderAccountArea (src/components/account.ts)                                     │
│                                                                                        │
│ 3. Standalone HTML Shell: guardrail/dashboard/index.html & dist/dashboard.js           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Supported User Journey Tracing

The diagram and trace matrix below outline the 6 discrete stages of the supported user workflow:

```
[User Action in DOM]
         │
         ▼
[Stage 1: Detection] ──► ActionDetector captures event (click/submit)
         │
         ▼
[Stage 2: Policy & Risk] ──► Classifier -> RiskEngine -> ResponseEngine (PROTECT)
         │
         ▼
[Stage 3: Staging Mode] ──► Capturing-phase event.preventDefault() + stopImmediatePropagation()
         │                  Action held in InterceptionController; Shadow DOM Modal mounted
         ▼
[Stage 4: Approval Creation] ──► Content Script dispatches to Background -> POST /api/v1/approval-requests
         │                       Server issues canonical requestId; status: PENDING
         ▼
[Stage 5: Caretaker Review] ──► Dashboard queries GET /api/v1/approvals/pending
         │                      Caretaker submits decision: POST /api/v1/approvals/:id/decide (APPROVED)
         ▼
[Stage 6: Status Sync & Continuation] ──► StatusSyncClient discovers APPROVED
                                         ContinuationValidationService validates eligibility (ELIGIBLE)
                                         Action remains HELD until User clicks "Continue Action"
                                         ContinuationManager executes controlled handler exactly once
```

### Trace Matrix

| Stage | Source Component | Inputs | Outputs | State Transition | Error Handling | Existing Tests |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Action Detection** | `ActionDetector` ([`action-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/detector/action-detector.ts)) | DOM Event, element | `GuardrailAction` | Unmonitored -> `DETECTED` | Filters detached or unmonitored ambient elements safely | `test-action-interception-verification.ts` |
| **2. Policy & Risk Evaluation** | `evaluateActionPipeline` ([`engine.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/response/engine.ts)) | `GuardrailAction` | Classification, Risk, Response | `DETECTED` -> `EVALUATED` | Fail-closed: uninitialized config or pipeline failure clamps to `PROTECT` | `test-risk-engine.ts`, `test-comprehensive-risk-enforcement.ts` |
| **3. Event Suppression & Staging** | Content script handler + `InterceptionController` ([`controller.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/interception/controller.ts)) | Evaluated Action, DOM event | `InterceptionRecord`, `StagingActionContext` | `EVALUATED` -> `HELD` | Synchronous cancellation prevents downstream event leakage | `test-action-interception.ts`, `test-controlled-browser-environment.ts` |
| **4. Approval Request Creation** | `submitApprovalRequest` ([`submit-operation.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/submit-operation.ts)) | `StagingActionContext`, Bearer Auth | `ApprovalRequest` (HTTP 201) | `HELD` -> `AWAITING_APPROVAL` | Pre-scan rejects sensitive fields; network failures map to `SUBMISSION_OUTCOME_UNKNOWN` | `test-submit-operation.ts`, `test-approval-workflow-integration.ts` |
| **5. Caretaker Review & Decision** | `DashboardShell` ([`shell.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/shell.ts)) + `ApprovalService` ([`service.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/service.ts)) | `requestId`, `SubmitDecisionPayload` | Decision metadata (verdict: `APPROVED` / `REJECTED`) | `PENDING` -> `APPROVED` / `REJECTED` | Self-approval rejected with 403; anti-enumeration returns 404 for unlinked caretakers | `test-dashboard-shell.ts`, `test-dashboard-sync.ts` |
| **6. Status Sync & Continuation** | `ApprovalStatusSyncClient` ([`sync-client.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/sync-client.ts)) + `ContinuationValidationService` | Validated approval verdict, action digest | `ContinuationEligibilityResult`, handler execution | `READY_FOR_USER_CONFIRMATION` -> `CONTINUED` | Monotonic ordering drops late responses; invalid digests prevent execution | `test-continuation-validation-service.ts`, `test-privacy-and-failure.ts` |

---

## 4. Audit of Integration Contracts & Boundaries

| Contract Dimension | Contract Rule / Invariant | Status | Implementation Evidence |
| :--- | :--- | :--- | :--- |
| **Identifier Agreement** | Action IDs (`act_...`), Request IDs (`apr_...`), Binding IDs (`bnd_...`) | **VERIFIED** | Enforced by [`model.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/model.ts) and [`binding.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/binding.ts). |
| **Status Value Uniformity** | `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED` | **VERIFIED** | Enum `ApprovalStatus` shared across extension and dashboard. |
| **API Payload Validation** | Rejection of unexpected fields, oversized payloads (>16 KB), malformed JSON | **VERIFIED** | Enforced by `ApprovalApiRouter.handleRoute` ([`api.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/api.ts)). |
| **Authoritative Dashboard State** | Dashboard renders authoritative backend state without local fabrication | **VERIFIED** | Verified in `test-dashboard-shell.ts` and `verify-complete-sync-flow.ts`. |
| **Terminal Monotonicity** | Terminal statuses (`APPROVED`, `REJECTED`, `CANCELLED`, `EXPIRED`) cannot be reverted | **VERIFIED** | Enforced by `isTerminalApprovalStatus` and modal monotonic guards. |
| **Zero Execution on Approval** | Approval verdict does NOT auto-execute the held action | **VERIFIED IN TESTED PATHS** | Covered by unit and Node integration checks plus controlled Chrome continuation checks; not every approval/dashboard behavior ran in Chrome. |
| **Explicit Mock Distinction** | In-memory persistence flagged explicitly | **VERIFIED** | `PERSISTENCE_METADATA.isProduction === false` and `EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY`. |

---

## 5. User Experience (UX) & Accessibility Audit

### 5.1 Confirmed UX Strengths
1.  **Truthful Messaging:** Staging modal and dashboard state strings never fabricate SMS, email, or push notifications. They state accurately: *"Your approval request (apr_...) has been registered on the server in PENDING status."*
2.  **Clear Non-Execution Notices:** The dashboard header and detail panes feature prominent callouts: *"Decoupled Action Execution: Approving a request authorizes the ward to proceed; it does not remotely trigger website actions."*
3.  **Encapsulated Shadow DOM:** Staging UI styles and DOM elements are mounted inside `#guardrail-staging-ui-host`, preventing target webpage CSS leakage.

### 5.2 Confirmed UX Deficiencies & Friction
1.  **Dashboard Standalone Disconnect:**
    Opening `guardrail/dashboard/index.html` directly in a browser results in an unconfigured shell. The UI renders "No Pending Approval Requests" without informing the user that the backend client is unconfigured.
2.  **Extension Popup Static Placeholder:**
    The extension popup (`popup.html` / `popup.ts`) displays only static text ("Active", "0.1.0"). It lacks operational visibility into policy health, active HELD actions, or backend connectivity.
3.  **Missing Staging Error Manual Retry:**
    When network uncertainty occurs (`NETWORK_FAILURE_UNCERTAIN`), the modal displays an uncertain notice. While polling continues in the background, there is no manual "Retry Check Now" button for user agency.
4.  **Caretaker Authentication Entry Point:**
    There is no visual login modal or token input in `guardrail/dashboard/index.html` to configure the caretaker identity (`tc_carol`, `tc_dave`) in standalone browser testing.

---

## 6. Test Suite Review & Empirical Execution Results

All available verification scripts across the extension and dashboard packages were executed to establish concrete empirical baselines:

```
+------------------------------------+---------------------------------------------------+----------+-------------+
| Command / Test Suite               | Execution Command                                 | Exit Code| Result      |
+------------------------------------+---------------------------------------------------+----------+-------------+
| Extension Development Build        | npm --prefix guardrail/extension run build        | 0        | 3 Bundles   |
| Dashboard Component Build          | npm --prefix guardrail/dashboard run build        | 0        | 192 KB      |
| Browser Environment Harness        | npm --prefix guardrail/extension run test:browser:env | 0    | 8/8 PASS    |
| Action Interception in Chrome      | npm --prefix guardrail/extension run test:browser:interception | 0 | 5/5 SUITES  |
| Approval Workflow / Local HTTP Integration (Node) | npm --prefix guardrail/extension run test:browser:approval | 0 | 5/5 SUITES  |
| Security Boundary Integration (Node/local fixtures) | npm --prefix guardrail/extension run test:browser:security | 0 | 79/79 PASS  |
| Privacy & Failure Integration (Node/local fixtures) | npm --prefix guardrail/extension run test:browser:privacy  | 0 | 110/110 PASS|
| Full Dashboard Test Suite          | npm --prefix guardrail/dashboard test             | 0        | 583/583 PASS|
| Full Extension Unit Test Suite     | npm --prefix guardrail/extension test             | 0        | 48/48 SUITES|
+------------------------------------+---------------------------------------------------+----------+-------------+
| Extension Static Type Checking     | npm --prefix guardrail/extension run type-check   | 2        | 346 ERRORS* |
+------------------------------------+---------------------------------------------------+----------+-------------+
```
*\*Note: As documented in Section 7, the `type-check` script fails due to a project configuration gap where Node-based test runners live in `src/` under a browser-only `tsconfig.json` lacking `@types/node`.*

---

## 7. Confirmed Integration Gaps & Technical Debt

### Confirmed Defects & Architecture Gaps:
1.  **Dashboard Standalone Bootstrapping (`guardrail/dashboard/src/index.ts`):**
    *   *Symptom:* `index.html` loads `dist/dashboard.js`, which runs `new DashboardShell({ container: defaultMountPoint })` without `apiClient`, `baseUrl`, or `tokenProvider`.
    *   *Impact:* The standalone dashboard is dead on arrival unless driven by automated test scripts.
2.  **Extension Popup Observability Placeholder (`guardrail/extension/src/popup/`):**
    *   *Symptom:* Only displays hardcoded HTML and version strings.
    *   *Impact:* Users and developers cannot see policy configuration health (`HEALTHY`/`DEGRADED`/`FAILED`), active HELD action IDs, or backend connection status.
3.  **Lack of Standing Server Daemon (`guardrail/server`):**
    *   *Symptom:* `guardrail/server` contains only a roadmap `README.md`.
    *   *Impact:* Manual end-to-end testing requires running transient test harnesses rather than having a standing server process (e.g. `npm run server:dev`).
4.  **TypeScript Build vs Test Config Separation:**
    *   *Symptom:* `tsconfig.json` specifies `"types": ["chrome"]` and `"noUnusedLocals": true`. Integration test files importing Node built-ins (`http`, `net`, `child_process`) live in `src/`.
    *   *Impact:* Running `npm run type-check` produces 346 errors, masking genuine compilation issues.

### Potential Risks & Unverified Behaviors:
1.  **In-Memory Development Persistence:** `DevelopmentInMemoryApprovalRequestRepository` does not survive server restarts. Production PostgreSQL persistence remains a roadmap goal.
2.  **Arbitrary Third-Party DOMs:** Real-browser tests verify behavior on controlled synthetic pages (`guardrail/demo-sites/test-page/index.html`). Dynamic single-page applications (SPAs) with complex shadow DOMs or canvas-rendered controls are not universally intercepted.
3.  **Out-of-Band Notification Delivery:** No real SMS or email gateways (Twilio, SendGrid) are wired to the development server.

---

## 8. Prioritized Implementation Plan (Prompts 2–7)

Based on the confirmed gaps, the following sequence of non-destructive improvements is established:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        PRIORITIZED IMPLEMENTATION ROADMAP                              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Prompt 2: Dashboard Standalone Bootstrapping & Client Wiring                           │
│   - Update dashboard/src/index.ts to support default/configurable API client options    │
│   - Add backend connection health banner and caretaker token management in dashboard UI│
│   - Verify standalone dashboard connects to local backend over HTTP                    │
│                                                                                        │
│ Prompt 3: Extension Popup Observability & Configuration                                │
│   - Update popup.html & popup.ts to query background coordinator for live status       │
│   - Display Policy Health (HEALTHY/DEGRADED/FAILED), active HELD actions, backend status│
│   - Preserve privacy: do not display sensitive action descriptors or form values       │
│                                                                                        │
│ Prompt 4: Standing Development Server Runner & Health Endpoints                        │
│   - Create persistent server runner (e.g. guardrail/extension/src/approval/server.ts)  │
│   - Add `npm run server:dev` script in extension or root                               │
│   - Add GET /health and GET /ready endpoints adhering to contract                      │
│                                                                                        │
│ Prompt 5: TypeScript Configuration Decoupling                                          │
│   - Split extension tsconfig into tsconfig.build.json (browser) and tsconfig.test.json │
│   - Add @types/node to devDependencies to support test scripts cleanly                 │
│   - Restore clean `npm run type-check` passing with zero errors                        │
│                                                                                        │
│ Prompt 6: User-Facing Error Recovery & Staging Polish                                  │
│   - Add manual "Retry Check" control in staging modal during network uncertainty       │
│   - Enhance keyboard navigation and ARIA landmarks across popup and dashboard          │
│   - Verify all non-destructive regression tests pass                                   │
│                                                                                        │
│ Prompt 7: End-to-End System Integration Verification & Final Sign-Off                  │
│   - Execute full browser + standing server + dashboard verification                    │
│   - Produce final release readiness report                                             │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Conclusion

Current evidence verifies synchronous interception for explicitly marked controlled test actions in Chrome, and exercises approval, privacy, and continuation invariants through unit and local-service integration tests. It does not establish universal action interception, production-service behavior, or a complete browser-based dashboard-to-extension approval journey.

By addressing the remaining integration gaps—standalone dashboard bootstrapping, popup status observability, standing server daemon availability, and TypeScript configuration decoupling—these focused enhancements will elevate Guardrail from a well-tested collection of components into a unified, seamlessly integrated product.
