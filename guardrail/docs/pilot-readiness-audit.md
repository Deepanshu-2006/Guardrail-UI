# Guardrail UI — Controlled Pilot Readiness Audit

**Audit date:** November 3, 2026

**Scope:** Repository evidence, current implementation, documentation, test coverage, and Day 18–21 work

**Conclusion:** Suitable for a controlled Chrome development demo using the marked test page. Not ready for a pilot that depends on real trusted-contact approvals, remote persistence, or broad protection on ordinary websites.

## 1. Executive summary

Guardrail currently contains a buildable Chrome Manifest V3 extension, a policy/risk pipeline, a Staging Mode UI, a typed approval domain and API router, an injectable dashboard shell, and tests for controlled workflows. Recent Day 18–21 work added configuration and continuation safeguards, clearer status language, dashboard availability states, accessibility improvements, failure recovery checks, and browser tests for the explicitly controlled demo page.

The repository does not contain a deployable approval server, durable approval storage, production identity service, configured production extension endpoint, or authenticated standalone dashboard bootstrap. The approval-related test server and identities are in-memory test fixtures. The extension manifest has no `host_permissions`, and the default approval client is instantiated without production configuration from the service worker. Therefore the repository does not demonstrate that a packaged extension can reach a remote approval service or that a trusted contact can use the standalone dashboard to make a real decision.

Interception is limited to explicitly marked controlled test actions. Ordinary page interactions can be detected and evaluated, and a warning can be shown, but the implementation does not reliably hold arbitrary ambient website actions. Current evidence does not support a claim that Guardrail blocks risky actions across websites.

The most important pilot blockers are the missing live service and dashboard authentication wiring, the unconfigured extension-to-service network boundary, incomplete pilot setup and operation instructions, and failing TypeScript checks. No critical vulnerability was established by this repository review. The audit records implementation limits and potential risks separately from confirmed defects.

## 2. Repository state and audit method

- `git status --short --branch` showed a clean `main...origin/main` worktree before this document was created.
- Current `HEAD` was `3366fef` (`docs: add product integration verification report`), equal to `origin/main`.
- Recent history includes Day 21 dashboard sync/status/accessibility work, the Day 20 browser verification work, and Day 18 security and workflow changes. The most recent Day 18–21 evidence documents reviewed were `docs/policy-security-audit.md`, `docs/release-readiness-audit.md`, `docs/product-integration-audit.md`, `docs/product-integration-verification.md`, `docs/trusted-contact-dashboard-consistency.md`, `docs/protection-status-user-trust.md`, `docs/accessibility-usability-audit.md`, and `docs/recovery-workflow-regression-report.md`.
- I inspected package scripts, source entry points, the manifest, approval service/repository/client, dashboard bootstrap, browser test harness, and relevant documentation. I did not rerun tests for this documentation audit. The test results below are the latest recorded results in `docs/product-integration-verification.md` (November 3, 2026), not new executions in this audit.
- No application code or permissions were changed. No commit was created.

### Evidence terminology

- **Implemented:** Source exists in the repository.
- **Tested:** A test exercises the behavior; the verification level is stated.
- **Mock/local fixture:** A local router, in-memory repository, mock DOM, or test identity stands in for a deployed service or browser component.
- **Unverified:** The relevant real deployment, browser flow, or operational environment was not exercised.

## 3. Actual architecture and supported boundaries

| Component | Repository implementation | Pilot boundary |
| --- | --- | --- |
| Browser extension | `extension/public/manifest.json`, `extension/build.mjs`, `extension/src/content/index.ts`, `extension/src/background/index.ts`, `extension/src/popup/index.ts` | Manifest V3 extension built for Chrome APIs. The real-browser harness launches Google Chrome/Chromium. Firefox and Safari manifests/builds are absent; Edge compatibility is not verified. |
| Action detection | `extension/src/detector/action-detector.ts`, `extension/src/detector/action-factory.ts`, `extension/src/utils/dom.ts` | Observes click, change, submit, and navigation-related signals. Detection of an event does not mean the event was held. |
| Controlled interception and staging | `extension/src/interception/`, `extension/src/staging/`, `extension/src/content/index.ts` | Synchronous cancellation and staging apply to explicitly marked controlled test click targets. Arbitrary page handlers and network behavior remain outside the guarantee. |
| Policy and risk | `extension/src/config/{schema,registry,loader,readiness}.ts`, `extension/src/risk/`, `extension/src/response/`, `extension/src/classifier/` | Central validation and fail-closed engine behavior are implemented and tested. Configuration is stored through extension storage; no packaged policy editor or pilot enrollment UI was found. |
| Approval domain and API router | `extension/src/approval/{service,api,repository,authorization,binding}.ts` | Domain validation, route handling, lifecycle transitions, and binding checks exist. Defaults use in-memory development repositories, registries, and token verification. The router is not a deployed server. |
| Extension approval transport | `extension/src/approval/{client,submit-operation,sync-client}.ts`, `extension/src/background/index.ts` | HTTP client, timeout handling, status validation, and polling exist. Real remote service access is not configured or verified in the shipped extension. |
| Trusted-contact dashboard | `dashboard/src/index.ts`, `dashboard/src/shell.ts`, `dashboard/src/components/` | Shell supports an injected `ApprovalApiClient`; the standalone auto-mount creates `DashboardShell` without a client, authenticated profile, or token provider. Dashboard tests use mock/local clients and mock DOMs. |
| Server | `server/README.md` | Contains only a future-scope README. No server entry point, database, migration, deployment manifest, or operational configuration exists. |
| Controlled target page | `demo-sites/test-page/` | Static controlled fixture used by the browser interception tests; it is not a representative integration with arbitrary sites. |

The conceptual diagrams in `docs/architecture.md` describe a backend and realtime connections as intended architecture. The repository does not implement those production services or WebSocket/SSE integration.

## 4. Findings by pilot area

### 4.1 Extension installation, initialization, and browser support

**Implemented:** The manifest declares an MV3 module service worker, popup, `storage` permission, and a content script at `document_idle` matching `<all_urls>` (`extension/public/manifest.json`). `extension/build.mjs` bundles background, content, popup, and static assets into `dist/`. `extension/README.md` describes installing extension dependencies, building, and loading `dist/` unpacked through `chrome://extensions`.

**Limits and pilot implications:** The only concrete installation path is developer-mode Chrome unpacked loading. The repository has no store-ready package/signing/update channel or tested Firefox/Safari/Edge flow. The manifest requests content-script access on all URLs, which is broad for a pilot and should be deliberately disclosed and reduced to the pilot's actual scope if possible. Only `storage` is declared; no service API host permission is present.

`content/index.ts` starts policy loading asynchronously and installs the detector in the same bootstrap. The current readiness guard suppresses supported controlled events while policy health is `UNINITIALIZED` and skips ambient evaluation until configuration reaches a known health state. Configuration is reloaded in content and background contexts on storage changes. The content script has a per-window bootstrap guard. These safeguards have unit coverage; actual browser storage propagation and service-worker restart recovery have not been exercised as a pilot lifecycle.

### 4.2 Action detection, Staging Mode, and policy behavior

`ActionDetector` listens for `click`, `change`, and `submit`, and tracks `popstate`/`hashchange` navigation (`extension/src/detector/action-detector.ts`). The active interception branch is selected for elements carrying `data-guardrail-test-action`. For supported controlled click actions, policy evaluation occurs synchronously and a `PROTECT` decision calls `preventDefault()` and `stopImmediatePropagation()` before the click continues. The held record and Staging Mode context are then created.

For unmarked ambient actions, the content script evaluates policy and may show an advisory warning, but it explicitly reports that an ambient `PROTECT` decision did not hold the action (`content/index.ts`). Browser tests verify that a controlled protected test handler is suppressed and an unmarked ambient test handler runs. These tests do not establish that independent page JavaScript, listeners that ran earlier, script-triggered work, or network requests are blocked.

The policy schema, registry, loader, risk evaluation, response precedence, and mandatory invariant rules are implemented. The config test scripts cover missing/default, malformed, failed-load, and recovery cases. No user-facing configuration management screen or documented pilot configuration procedure is present. The popup's “Active” label is static (`extension/src/popup/index.ts`); it does not report policy health or backend availability.

### 4.3 Trusted-contact approvals, backend communication, and dashboard

The repository includes an `ApprovalService`, route router, typed request/response models, an API client, and approval-status polling. Approval and action identity checks, expiry, status validation, and 1:1 binding logic are represented in source and covered by unit and local integration tests. Approval status synchronization is not itself a continuation command.

These modules are not a live production approval service:

- `server/` contains only `README.md` and explicitly says backend and persistence are future scope.
- `DevelopmentInMemoryApprovalRequestRepository`, `InMemoryTokenVerifier`, trusted-contact registry, and action-owner registry are used by the service/test setup. Data and identity mappings do not survive process restart or span independent server instances.
- `browser-test/test-server.ts` creates an in-process/local test HTTP service using those memory-backed dependencies. Passing local HTTP tests do not verify production authentication, persistence, TLS termination, availability, or authorization operations.
- `ApprovalApiClient` has a localhost development default and a nominal production URL constant. `submit-operation.ts` constructs `new ApprovalApiClient()` when no client is injected. The production build changes bundling/minification but does not inject deployment configuration. No live service was configured in the recorded verification.
- The extension manifest does not grant host permissions for either endpoint. A Chrome extension request to a remote service from the extension context therefore remains unverified and needs an intentional least-privilege host configuration when a real service exists.
- `dashboard/src/index.ts` auto-mounts a shell without an API client. Decision controls cannot record a real decision in this standalone configuration; the shell correctly exposes an unavailable prerequisite when asked to submit. There is no dashboard host, sign-in/session flow, or trusted-contact enrollment setup in the repository.

These are confirmed integration gaps and pilot blockers for any workflow that depends on actual remote trusted-contact review. They do not invalidate the tested approval domain logic.

### 4.4 Approval binding and controlled continuation

The code has action/approval binding models, validation service, digest/fingerprint checks, lifecycle checks, context and DOM attachment checks, explicit user confirmation, and controlled handlers registered by the content script. Continuation is not generic DOM event replay. Approval status alone does not execute the action. Tests cover mismatch, expiry, invalidation, cancellation, stale responses, duplicate attempts, and supported test continuation.

Held closures, DOM references, controller state, and the development approval repository are memory-bound. Navigation, page reload, crash, or worker termination may invalidate or lose that state; the repository documents that the action cannot be safely resumed after reload. In-memory locks do not establish distributed exactly-once execution. The full approval-to-dashboard-to-extension continuation path has not been run in a real multi-tab browser against a production service.

### 4.5 Privacy and security boundaries

The detector does not read typed values from text inputs, textareas, or selected options. Diagnostic messaging sanitizes page URLs, and the privacy suite uses synthetic values to exercise selected messaging, request, error, and rendering paths. This supports those tested paths only; there is no deployed telemetry or retention system to audit.

One data-minimization concern remains for pilot review: `extractPageInfo()` captures `document.title`, and the staging context carries a trimmed `pageTitle` into `buildClientPayloadFromStagingContext()`. The approval payload also includes `actionDescription`, which can be derived from visible element text/placeholders. These are not raw typed form values, but page titles and labels are website-controlled and can contain dynamic or sensitive text. Current tests do not establish that all such content is safe for external transmission. Treat this as a potential privacy risk, not evidence of a confirmed credential leak; minimize or explicitly review these fields before sending pilot data to a real service.

The extension has structured message validation, sender checks for approval messages, safe response validation, and redaction helpers. A deployed service, real auth-token issuance/revocation, production logs, access controls, and data retention policy are absent, so those boundaries remain unverified operationally.

### 4.6 Failures, recovery, and accessibility

**Strengths tested in code:** Configuration failures are surfaced through health states and tested fail-closed policy paths. Approval transport distinguishes timeout/network/server/malformed results; unknown approval does not become `APPROVED`. Approval submission is not blindly retried after ambiguous outcomes. Status polling is bounded and stoppable. Dashboard state includes loading, empty, error, unavailable, stale, refresh, and confirmed-decision handling. Dashboard tests cover stale-response ordering, duplicate refresh/decision guards, unavailable state, and no action execution after a decision.

**Unverified/limited:** There is no real backend restart, durable storage outage, production service-worker lifecycle, or cross-tab state recovery test. On restart/reload, configuration can be read again but held action closures are not durable. The dashboard's popup-like “Active” status is not a measured health signal.

Day 21 added semantic labels, keyboard/focus behavior, status announcements, and improved messages in the dashboard and extension UI. These were verified with component/mock-DOM assertions. No screen reader session, full browser keyboard audit, contrast measurement, or mobile-device test is recorded; no accessibility conformance claim is supported.

## 5. Verification coverage and latest recorded results

The package scripts are defined in `extension/package.json` and `dashboard/package.json`. There is no root package script or configured lint command. The extension `npm test` runs many esbuild/Node component and workflow suites. The dashboard `npm test` runs four configured component/synchronization suites. Although several scripts are named `test:browser:*`, only `test:browser:env` and `test:browser:interception` call `launchControlledChrome`; approval/security/privacy scripts run under Node using local fixtures/mocks. The corrected scope is documented in `docs/end-to-end-browser-verification.md`.

Latest recorded outcomes in `docs/product-integration-verification.md`:

| Check | Recorded result | Evidence level / limit |
| --- | --- | --- |
| `cd extension && npm test` | Pass, exit 0 | Unit and local integration suites; not a live approval backend. |
| `cd dashboard && npm test` | Pass, exit 0 | Component/mock-DOM and local synchronization coverage. |
| `cd extension && npm run build` and `npm run build:prod` | Pass, exit 0 | Bundles only; not store packaging or remote configuration. |
| `cd dashboard && npm run build` | Pass, exit 0 | Bundle only. |
| `cd extension && npm run test:browser:env` | Pass, exit 0 | Headless Chrome environment test. |
| `cd extension && npm run test:browser:interception` | Pass, exit 0 | Real Chrome controlled-page interception tests. |
| `cd extension && npm run test:browser:approval` | Pass, exit 0 | Node integration against local HTTP service/mock DOM; not Chrome. |
| `cd extension && npm run test:browser:security` | Pass, 79/79 assertions | Node/local fixtures; not Chrome or production service. |
| `cd extension && npm run test:browser:privacy` | Pass, 110/110 assertions | Node/local fixtures and synthetic sentinels; selected paths only. |
| `cd extension && npm run type-check` | Fail, exit 2; 371 diagnostics | Static check currently not a release gate. |
| `cd dashboard && npm run type-check` | Fail, exit 2; 188 diagnostics | Includes imported extension/test source diagnostics. |
| `cd extension && npm run audit` | Pass, exit 0; zero reported vulnerabilities | Result recorded by Day 21 run; not a security certification. |

These checks were recorded for Day 21; they were not rerun as part of this documentation audit. No browser-based approval/dashboard journey, deployed-service integration, production identity test, worker restart test, or manual accessibility audit is evidenced.

## 6. Prioritized pilot findings

| Priority | Finding | Status and pilot effect |
| --- | --- | --- |
| **High — pilot blocker** | No production approval backend, durable repository, or production identity verifier exists in the repository. | Confirmed. A trusted-contact pilot cannot rely on persistent or authoritative remote decisions using this repository alone. |
| **High — pilot blocker** | Extension-to-service endpoint and browser permission wiring are not release-configured. | Confirmed. The default client is constructed without deployed configuration, and the manifest has no service host permissions. No real Chrome service-worker request was verified. |
| **High — pilot blocker** | Standalone dashboard is not connected to an authenticated API client/session. | Confirmed. Its auto-mount omits the client/profile/token provider; no backend or dashboard deployment bootstrap is included. |
| **High — scope blocker** | Ordinary website actions are not reliably intercepted. | Confirmed boundary. Only marked controlled test actions have synchronous hold/continuation evidence. Any pilot promise of broad website protection would be unsupported. |
| **Medium** | Extension requests broad `<all_urls>` content-script access while its reliable interception scope is narrow. | Confirmed permission/scope mismatch. Requires explicit pilot consent and a least-privilege scope decision; not a proven exploit. |
| **Medium** | The TypeScript checks fail with hundreds of diagnostics. | Confirmed by latest recorded checks. This weakens static verification and release confidence even though builds/tests passed. |
| **Medium — privacy review** | Approval metadata may transmit website-controlled page titles and element labels. | Potential risk supported by source; no leak demonstrated. Review/minimize before a real external service receives pilot data. |
| **Medium** | No full browser E2E journey or service-worker restart/state-recovery evidence. | Confirmed test gap. Existing Chrome tests cover a controlled page; other workflows use local fixtures or mock DOMs. |
| **Medium** | Pilot installation, endpoint configuration, trusted-contact onboarding, recovery, support, and rollback instructions are missing. | Confirmed documentation gap. Existing extension README is a developer unpacked-load guide; root README still describes a Day 1 foundation and server/dashboard as future roles. |
| **Low / operational** | Popup says “Active” without checking configuration or service health; no release packaging/update process is present. | Confirmed. UI can imply runtime health that it does not measure; packaging, update, rollback, and support are not established. |
| **Low / unverified** | Accessibility checks are component-level rather than real assistive-technology/browser verification. | Confirmed test limitation; no conformance claim is made. |

No Critical finding or confirmed credential leak was established in this audit. High priorities above are pilot blockers due to absent real integration and unsupported product scope, not claims of a tested exploit.

## 7. Setup gaps for a controlled pilot

The current extension README provides a developer path to build and load the extension in Chrome. A pilot guide still needs to define:

1. Supported Chrome/Chromium version and explicitly unsupported/unverified browsers.
2. Whether participants must use the controlled demo page only or which reviewed sites are in scope.
3. What `<all_urls>` access means, why it is needed, and how to narrow it for the pilot.
4. Whether remote approvals are disabled or connected to a real backend. There is no production server to configure today.
5. How policy configuration is initialized, validated, reset, and recovered; there is no UI walkthrough for policy settings.
6. How a real trusted contact authenticates, gets enrolled, and reviews requests. Those services and flows are not wired in this repository.
7. What users should do when the popup, extension, storage, or service is unavailable; “Active” is not health telemetry.
8. What data may leave the browser, what is retained, how a participant withdraws, and who handles a support or security report.
9. How builds are packaged, installed, updated, rolled back, and removed. No store or managed-deployment process is present.

Until the live service exists, document the approval/dashboard journey as unavailable or fixture-only; do not ask participants to rely on local in-memory approvals as a real safety workflow.

## 8. Recommended pilot gate

Before inviting external participants to a pilot that includes trusted-contact approvals:

1. Decide and document a narrow pilot scope. If the product promise is website-wide protection, the current implementation does not meet it. A development-only pilot should be limited to the controlled marked test page.
2. Provide a deployable approval service with durable storage, real identity/token verification, authorization, expiry, audit/retention policy, operational ownership, and a documented recovery path.
3. Configure the extension with an explicit HTTPS endpoint and minimum required host permissions; verify the request from the built extension in real Chrome.
4. Package and deploy the dashboard with authenticated bootstrap and authoritative API client; verify the full extension-service-dashboard flow in separate real browser contexts.
5. Review approval payload minimization, particularly `pageTitle` and dynamic element labels; run privacy tests against the final wire payload using synthetic sensitive-looking metadata.
6. Replace static popup “Active” with truthful supported runtime status or remove the implication of health.
7. Resolve or isolate the TypeScript diagnostics, then make production type-check and build commands reproducible release gates.
8. Add real-browser checks for clean install, configuration initialization/failure, storage change, worker restart, service failure, approval status, and explicit continuation. Keep ambient website behavior documented as unsupported.
9. Complete pilot onboarding, user-facing limitations, data handling/retention, support, incident response, rollback, and uninstall instructions.
10. Run manual keyboard and screen-reader checks for the actual pilot UI and verify status and failure copy in the target browser.

## 9. Readiness decision

**Controlled internal development demo:** Reasonable on Chrome/Chromium with the supplied controlled test page and the limitations above; the latest recorded Chrome interception runs cover that boundary.

**External pilot involving remote trusted contacts or protection on ordinary websites:** Not ready. The required backend, durable authority, deployed identity/authentication, dashboard bootstrap, endpoint/permission configuration, and full browser integration are missing or unverified. Do not describe the current build as production-ready or as universally blocking risky actions.

The next engineering step should be to define the pilot scope and then implement the real service/deployment boundary before onboarding trusted contacts. If the intended scope is only a controlled demo, create the participant setup and limitation guide first and keep approval behavior explicitly fixture-only.
