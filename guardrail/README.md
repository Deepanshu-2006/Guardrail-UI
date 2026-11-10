# Guardrail UI

Guardrail UI is a real-time safety, observability, and policy enforcement system designed to protect individuals (such as older adults, novice web users, or vulnerable individuals) from high-risk browser interactions, financial deception, and accidental destructive actions through collaborative, human-in-the-loop oversight with designated **trusted contacts** (caregivers, family members, or security delegates).

---

## 1. What Guardrail UI Does & Who It Is Designed For

Guardrail UI operates at the intersection of client-side browser extension capabilities and server-side policy enforcement:

* **For Wards / Primary Users**: The Guardrail browser extension passively evaluates page interactions against configurable safety heuristics. Routine actions (`ALLOW`) execute unimpeded. Ambiguous or advisory interactions (`WARN`) surface clear, contextual warning friction without blocking. Elevated destructive or high-value actions (`PROTECT`) are intercepted in the browser DOM capturing phase, halted via `preventDefault()` and `stopImmediatePropagation()`, and safely held in an isolated **Staging Mode** Shadow DOM interface.
* **For Trusted Contacts / Reviewers**: When a ward initiates an approval request for a held action, designated trusted contacts access the **Trusted Contact Dashboard** to review structured metadata (action type, origin, risk score, specific policy reasons, and human-readable context). Reviewers evaluate the interaction and record an authoritative `APPROVED` or `REJECTED` decision on the backend service.
* **Decoupled Execution Guarantee**: An approval decision recorded by a trusted contact **NEVER** automatically resumes, re-executes, or injects synthetic clicks into the ward's browser tab. Resumption strictly requires the ward to physically click a **Continue Action** confirmation button in the browser staging modal after authoritative eligibility validation passes.

---

## 2. Monorepo Architecture Overview

The repository is organized into three decoupled subsystems with strict boundaries:

```text
guardrail/
├── extension/    # Manifest V3 browser extension (DOM interception, risk evaluation, staging UI)
├── dashboard/    # Trusted Contact Portal (accessible web application for reviewing requests)
├── server/       # Authoritative approval service (SQLite persistence, OIDC JWT auth, REST API)
├── demo-sites/   # Controlled synthetic test fixtures and demonstration pages
├── docs/         # Specifications, audit reports, and deployment guides
└── README.md     # Project root documentation (this file)
```

### Component Roles & Boundaries

| Subsystem | Responsibility | Runtime & Tech Stack |
| :--- | :--- | :--- |
| **`guardrail/extension`** | DOM event capturing, risk assessment, Staging Mode quarantine, status polling, and single-use continuation validation. | TypeScript, Manifest V3 (ESM Service Worker + IIFE Content Script), `esbuild`, closed Shadow DOM. |
| **`guardrail/dashboard`** | Reviewer interface displaying pending queues, structured risk inspectors, decision history, and ward relationship management. | TypeScript, Vanilla DOM Shell, `esbuild` development server, accessible responsive CSS. |
| **`guardrail/server`** | Multi-tenant REST API, 1:1 action-to-request bindings, OIDC RS256 token verification, and SQLite persistent state machine. | Node.js 20+, `better-sqlite3` (`secure_delete = 1`), `jose` cryptography, native HTTP. |
| **`guardrail/demo-sites`** | Synthetic, controlled web pages for deterministic testing and demonstrations. | Static HTML5, vanilla JavaScript event harnesses, zero external dependencies. |

---

## 3. Supported Protection & Approval Workflow

The complete protection and approval workflow spans 9 discrete architectural stages:

```mermaid
sequenceDiagram
    autonumber
    actor User as Ward (Browser)
    participant Ext as Extension (DOM / Shadow DOM)
    participant Srv as Guardrail Server (API + SQLite)
    actor Contact as Trusted Contact (Dashboard)

    User->>Ext: Interacts with controlled element ([data-guardrail-test-action])
    Note over Ext: Capturing Phase: preventDefault() & stopImmediatePropagation()
    Ext->>Ext: Risk Engine evaluates action (Score >= 50 -> PROTECT)
    Ext->>User: Displays Staging Modal in isolated Shadow DOM (Action HELD)
    User->>Ext: Clicks "Request Approval" in Staging Modal
    Ext->>Srv: POST /api/v1/approval-requests (Action digest + metadata; zero passwords/PII)
    Note over Srv: Creates request (apr_) + immutable 1:1 binding (bnd_) in PENDING state
    Contact->>Srv: GET /api/v1/approval-requests/pending (OIDC Bearer Auth)
    Srv-->>Contact: Returns sanitized pending requests
    Contact->>Srv: POST /api/v1/approval-requests/:id/decide (APPROVED or REJECTED)
    Note over Srv: Atomic CAS state transition to APPROVED
    Ext->>Srv: Adaptive polling: GET /api/v1/approval-requests/:id
    Srv-->>Ext: Returns confirmed APPROVED status
    Note over Ext: Zero auto-execution! Action remains safely HELD in memory
    Ext->>User: Updates Staging Modal to "Approval Confirmed" & enables "Continue Action"
    User->>Ext: Physical user click on "Continue Action"
    Note over Ext: ContinuationValidationService validates 10 eligibility conditions
    Ext->>Ext: Atomic single-use execution of registered handler (Exactly Once, No DOM Replay)
    Ext->>User: Action completed; Staging Modal unmounted
```

1. **Detection**: Capturing-phase listener intercepts user interaction on supported interactive elements.
2. **Evaluation**: Risk engine calculates heuristic score (e.g., destructive + external destination $\to$ Critical risk).
3. **Response**: Policy resolves to `PROTECT` (staged) rather than `ALLOW` (immediate) or `WARN` (advisory).
4. **Quarantine**: Event default action and propagation are stopped synchronously; action is held in `InterceptionController`.
5. **Request Submission**: Client creates `apr_` request over HTTPS wire with SHA-256 action digest; zero form inputs, passwords, or PII transmitted.
6. **Caretaker Decision**: Trusted contact inspects metadata in dashboard and records `APPROVED` or `REJECTED`. Anti-self-approval and multi-tenant isolation enforced server-side.
7. **Status Synchronization**: Extension polls backend, discovers confirmed status, halts polling, and updates UI state to `approval_confirmed_approved`. Action remains strictly `HELD`.
8. **Eligibility Validation**: Client validates 10 mandatory safety conditions (15-min TTL expiry, origin/path consistency, DOM element attachment, and non-consumed token).
9. **Controlled Continuation**: User physically clicks "Continue Action". Registered handler executes **exactly once**. Zero synthetic DOM event replay (`isTrusted: false` avoided). Atomic transition to `CONTINUED`.

---

## 4. Supported Browser Actions & Known Interception Limitations

### Supported Browser Actions
- **Interactive Element Clicks**: `<button>`, `<a>`, and `<input type="button|submit">` elements.
- **Controlled Test Actions**: Explicitly marked elements (`[data-guardrail-test-action]`) supporting full quarantine, approval binding, and resumed execution.
- **Form Submissions via Interactive Triggers**: Form submissions triggered by clicking submit buttons, `<button type="submit">`, or pressing Enter.
- **File Downloads**: Initiated file downloads monitored via `chrome.downloads.onCreated`, detecting executable extensions, double extensions (`.pdf.exe`), and unencrypted HTTP downloads.
- **Deceptive Web Navigation**: Real-time evaluation of destination hostnames against brand spoofing, typosquatting heuristics, and suspicious TLDs.

### Known Interception Limitations (Boundary Truthfulness)
1. **Programmatic `form.submit()` Bypass**:
   Under the W3C HTML DOM specification, calling `HTMLFormElement.prototype.submit()` programmatically bypasses DOM event listeners entirely. Extensions cannot intercept programmatic `form.submit()` without monkey-patching in the main page world (which violates origin isolation). Guardrail intercepts interactive submissions (`requestSubmit()`, submit buttons, Enter key), but cannot halt ambient programmatic `.submit()` calls.
2. **Prior Side Effects & Page State Drift**:
   Synchronous `preventDefault()` and `stopImmediatePropagation()` halt downstream browser actions, but **cannot undo network requests or DOM state mutations** initiated by external page scripts prior to event interception. If the page context changes or the target DOM element detaches while held in staging mode, continuation fails closed (`ELEMENT_DETACHED` / `PAGE_CONTEXT_MISMATCH`).
3. **Download Protection Scope**:
   Guardrail monitors download events via `chrome.downloads` and flags elevated risk signals. It does **not** provide host-level antivirus file scanning, kernel sandbox enforcement, or content inspection of encrypted archives.
4. **Universal Website Action Resumption**:
   Arbitrary unmarked website interactions cannot be safely paused and reconstructed across asynchronous boundaries. Resumption is strictly restricted to verified actions with registered continuation handlers; unverified website actions fail closed.

---

## 5. Trusted Contact Setup & Invitations

The relationship between a ward and a trusted contact is governed by strict authorization boundaries:

* **Separation of Duties (Anti-Self-Approval)**: A user cannot act as a trusted contact for their own approval requests. The backend throws `SelfApprovalProhibitedError` (HTTP 403) if a user attempts to approve their own request.
* **Invitation Lifecycle**:
  1. A ward generates a secure invitation targeting an existing trusted contact actor ID (`POST /api/v1/invitations`).
  2. High-entropy invitation tokens are stored strictly as SHA-256 hashes in the SQLite database and retired upon acceptance, expiration, or revocation.
  3. The contact accepts the invitation (`POST /api/v1/invitations/:code/accept`), establishing an authoritative `SqliteTrustedContactRegistry` link.
* **Access Boundary**:
  - Contacts can view and decide *only* pending requests originating from wards who have actively authorized them.
  - Revoking a contact immediately invalidates their ability to query pending requests or submit decisions.
  - Unauthorized third parties (e.g. user Mallory) querying Alice's requests receive opaque HTTP 404 (`NOT_FOUND_OR_DENIED`) to prevent identity enumeration.

---

## 6. Environment Variables & Configuration

Guardrail configuration is declarative and privacy-safe. Environment variables are referenced **by name and purpose only**; secrets must never be committed to source code or bundled into frontend assets.

| Variable | Target Subsystem | Purpose & Usage |
| :--- | :--- | :--- |
| `GUARDRAIL_ENV` | Extension, Dashboard, Server | Operating environment profile (`development`, `test`, `pilot`, `production`). In `pilot` and `production`, strict HTTPS and validation rules are enforced. |
| `GUARDRAIL_API_BASE_URL` | Extension, Dashboard (Build-time) | The single authoritative public HTTPS backend origin (e.g. `https://api.guardrail-safety.org`). Injected at build time into bundles and manifest host permissions. |
| `GUARDRAIL_ALLOWED_ORIGINS` | Server (Runtime) | Comma-separated list of exact allowed CORS origins (e.g. `chrome-extension://<id>,https://dashboard.example.com`). Wildcards (`*`) and unencrypted HTTP are rejected in production. |
| `GUARDRAIL_DB_PATH` | Server (Runtime) | Filesystem path for the durable SQLite database (e.g. `/var/lib/guardrail/data.sqlite`). In production, must be an absolute path. |
| `GUARDRAIL_HOST` | Server (Runtime) | Bind interface for the API server (defaults to loopback `127.0.0.1`). |
| `GUARDRAIL_PORT` | Server (Runtime) | TCP port for API listener (defaults to `3000`). |
| `GUARDRAIL_OIDC_ISSUER` | Server (Runtime) | Authoritative HTTPS issuer URL of the external Identity Provider (e.g. `https://auth.example.com/`). |
| `GUARDRAIL_OIDC_AUDIENCE` | Server (Runtime) | Expected API audience identifier in JWT access tokens. |
| `GUARDRAIL_OIDC_JWKS_URL` | Server (Runtime) | HTTPS URL to fetch public signing keys (JWKS) for RS256 token verification. |
| `GUARDRAIL_OIDC_ROLE_CLAIM` | Server (Runtime) | Claim name in JWT containing the user's role (`USER`, `TRUSTED_CONTACT`, or `ADMIN`). |
| `RESEND_API_KEY` | Server (Runtime, Optional) | Backend API key for invitation notification delivery via Resend. |
| `GUARDRAIL_EMAIL_FROM` | Server (Runtime, Optional) | Verified sender email address for outgoing invitation notices. |
| `GUARDRAIL_DASHBOARD_URL` | Server (Runtime, Optional) | Public URL of the Trusted Contact Dashboard included in notification emails. |

---

## 7. Backend & Authentication Prerequisites

1. **Node.js Runtime**: Requires Node.js version 20 or newer (`engines: { node: ">=20" }`).
2. **Database Storage**: Local persistent storage powered by `better-sqlite3`. Database files are initialized with `PRAGMA secure_delete = 1` for DoD 5220.22-M zero-overwrite sanitization on record deletion.
3. **Authentication Provider**:
   - The standalone server enforces RS256 signature verification using public JWKS endpoints and maps `(issuer, subject)` pairs to canonical internal actor identifiers (`usr_...`).
   - For local development and automated testing, in-memory synthetic verifiers and ephemeral RSA keypairs are provided.
   - For pilot and production deployments, an operational OIDC Identity Provider (e.g., Auth0, Okta, Keycloak) must be configured with client registrations and role claim mappings.
4. **Transport Security**:
   - In pilot and production environments, all endpoints **must use HTTPS**.
   - Plain HTTP is permitted strictly on local loopback (`localhost`, `127.0.0.1`, `::1`) for development and automated integration testing.

---

## 8. Build, Package & Run Commands

### 8.1 Extension Subsystem (`guardrail/extension`)
```bash
cd guardrail/extension
npm install

# Type check TypeScript sources
npm run type-check

# Compile development bundle to dist/
npm run build

# Watch mode for active development
npm run watch

# Compile pilot distribution bundle to dist-pilot/
GUARDRAIL_API_BASE_URL="http://localhost:3000" npm run build:pilot

# Assemble and package clean pilot distribution zip (dist/guardrail-extension-pilot.zip)
GUARDRAIL_API_BASE_URL="http://localhost:3000" npm run package:pilot

# Compile minified production bundle without sourcemaps
GUARDRAIL_API_BASE_URL="https://api.guardrail-safety.org" npm run build:prod
```

### 8.2 Dashboard Subsystem (`guardrail/dashboard`)
```bash
cd guardrail/dashboard

# Type check dashboard sources
npm run type-check

# Start local development server with auto-rebuilding (serves on http://localhost:5173/)
npm run dev

# Compile standalone dashboard bundle (dist/dashboard.js)
npm run build

# Compile pilot dashboard bundle with remote API origin
GUARDRAIL_ENV=pilot GUARDRAIL_API_BASE_URL="https://pilot.guardrail-safety.org" npm run build

# Compile production dashboard bundle
GUARDRAIL_ENV=production GUARDRAIL_API_BASE_URL="https://api.guardrail-safety.org" npm run build
```

### 8.3 Server Subsystem (`guardrail/server`)
```bash
cd guardrail/server
npm install

# Type check server sources
npm run type-check

# Compile dual server bundles (dist/index.mjs library + dist/serve.mjs standalone)
npm run build

# Start standalone server
npm start
```

---

## 9. Running Automated Tests

All tests run locally using Node.js test runners and `esbuild` bundling without requiring external network access or live cloud services.

```bash
# Run all server suites (Config, SQLite, Policy, API, OIDC, Delivery, Reliability, Privacy)
npm test --prefix guardrail/server

# Run server privacy and data protection suite (68 assertions)
npm run test:privacy --prefix guardrail/server

# Run server reliability and failure recovery suite (75 assertions)
npm run test:reliability --prefix guardrail/server

# Run all dashboard suites (Shell DOM, Workflow, Sync, HTTP Sync, Dev Server)
npm test --prefix guardrail/dashboard

# Run dashboard end-to-end sync suite over live local TCP socket (135 assertions)
npm run test:verify-complete-sync --prefix guardrail/dashboard

# Run extension pilot packaging verification suite (89 assertions)
npm run test:pilot-build --prefix guardrail/extension

# Run complete 9-stage protection and approval workflow suite (59 assertions)
npm run test:complete-workflow --prefix guardrail/extension

# Run extension browser security and Shadow DOM boundary suite (79 assertions)
npm run test:browser:security --prefix guardrail/extension

# Run extension privacy and credential stripping suite (110 assertions)
npm run test:browser:privacy --prefix guardrail/extension

# Run extension controlled continuation hardening suite (75 assertions)
npm run test:continuation-hardening --prefix guardrail/extension

# Run extension website warning and phishing detection suite (40 assertions)
npm run test:browser:website-mock --prefix guardrail/extension

# Run extension form protection and download quarantine suite (87 assertions)
npm run test:browser:form-download-mock --prefix guardrail/extension
```

---

## 10. Controlled End-to-End Demonstration Procedure

To execute a realistic demonstration using only supported workflows and test harnesses:

### Step 1: Start the Local API Server & Dashboard
In Terminal 1 (Start Server):
```bash
cd guardrail/server
GUARDRAIL_PORT=3000 npm run build && npm start
```
In Terminal 2 (Start Dashboard Dev Server):
```bash
cd guardrail/dashboard
npm run dev
# Dashboard available at http://localhost:5173/
```

### Step 2: Build & Load Extension in Google Chrome
In Terminal 3:
```bash
cd guardrail/extension
npm run build
```
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked** and select `guardrail/extension/dist/`.
4. The Guardrail icon will appear in the browser toolbar.

### Step 3: Open Controlled Demonstration Page
1. Open Google Chrome to the test page:
   ```text
   file:///path/to/guardrail/demo-sites/test-page/index.html
   ```
2. Observe the **Interactive Elements** and **Controlled Interception** test section.

### Step 4: Scenario A — Normal Supported Action (`ALLOW`)
1. Click **`🟢 Test ALLOW (View Dashboard)`**.
2. **Observed Behavior**: The routine interaction is evaluated by the pipeline as low-risk (Score 0). Guardrail does **not** halt the event.
3. **Evidence**: The page event log displays:
   `[guardrail:action-allowed] Action allowed without interception`.
   The normal page click handler executes immediately.

### Step 5: Scenario B — Action Requiring Approval (`PROTECT`)
1. Click **`🛑 Test PROTECT (Delete All Data, Cancel Billing, and Export)`**.
2. **Observed Behavior**: The high-impact compound action evaluates to Critical risk (Score 90). The capturing phase intercepts the click:
   - `event.preventDefault()` suppresses native execution.
   - `event.stopImmediatePropagation()` stops downstream page handlers.
   - The normal page handler is **strictly prevented from running**.
3. **Staging Mode Quarantine**: The extension mounts the **Staging Modal** in an isolated Shadow DOM container. The action is held in state `HELD`.
4. Click **`Request Approval`** inside the staging modal.
5. The extension submits the request to `POST http://localhost:3000/api/v1/approval-requests` and transitions to `Approval Pending`.

### Step 6: Scenario C — Trusted Contact Review in Dashboard
1. Switch to the dashboard browser tab (`http://localhost:5173/#pending`).
2. The new request (`apr_...`) appears in the left pending pane with a **CRITICAL** risk badge.
3. Select the request to inspect structured details:
   - Target Origin: `https://bank.example.com`
   - Category: `DESTRUCTIVE`
   - Heuristic Reasons: High-impact destructive operation.
4. Click **`Approve Action`** and confirm with reviewer note: *"Verified with ward via callback"*.
5. **Observed Backend State**: The backend updates the record to `APPROVED`.
6. **Critical Safety Invariant**: In the ward's tab, the action **remains safely held**; zero automatic executions or simulated clicks occur.

### Step 7: Scenario D — User-Controlled Continuation Decision
1. Switch back to the ward's browser tab.
2. The extension's status synchronization loop discovers `APPROVED` status.
3. The modal status pill updates to green: **`Approval Confirmed`**.
4. The **`Continue Action`** button is now enabled.
5. The user reviews the confirmation banner and physically clicks **`Continue Action`**.
6. **Observed Behavior**:
   - `ContinuationValidationService` checks all 10 eligibility conditions.
   - The registered action handler executes **exactly once**.
   - The page event log displays: `[guardrail:controlled-handler-executed] Action executed exactly once via explicit continuation mechanism!`.
   - The modal unmounts. Clicking again is safely rejected (`ALREADY_CONSUMED`).

### Step 8: Scenario E — Failure & Unavailable Service Scenario
1. Stop the backend server in Terminal 1 (Ctrl+C).
2. On the test page, click **`🛑 Test PROTECT`**, then click **`Request Approval`**.
3. **Observed Behavior**:
   - The client detects dead loopback port (`ECONNREFUSED`).
   - The staging modal safely handles the error and displays:
     *"Cannot reach Guardrail safety service. Your action remains safely paused. Please check your network connection."*
   - The action remains strictly **`HELD`**; continuation is **never** permitted or assumed on failure.

---

## 11. Troubleshooting Common Setup & Runtime Failures

| Symptom / Error | Root Cause | Resolution |
| :--- | :--- | :--- |
| `GUARDRAIL_API_BASE_URL is required for pilot and production builds` | `build:pilot` or `build:prod` was invoked without specifying the backend origin. | Provide the origin via environment variable: `GUARDRAIL_API_BASE_URL="http://localhost:3000" npm run build:pilot`. |
| `Pilot endpoints must use HTTPS` | An unencrypted `http://remote-server.com` URL was passed to a pilot or production build. | Remote pilot endpoints require TLS. Use an `https://` origin. Plain `http://` is allowed only on `localhost`. |
| `401 Unauthorized` / `UNAUTHENTICATED` | Request submitted without a valid Bearer token or token expired. | Supply a valid JWT from the configured identity provider, or verify `TokenProvider` configuration. |
| `403 Forbidden` / `SelfApprovalProhibitedError` | The user attempting to approve a request is the same user who initiated it. | Use a separate trusted contact identity (`ActorRole.TRUSTED_CONTACT`) to approve ward requests. |
| `404 Not Found` when fetching approval details | Anti-enumeration defense triggered; the caller is not an authorized trusted contact for the requesting ward. | Accept the ward's invitation using the contact account before inspecting pending requests. |
| `409 Conflict` on decision submission | The approval request is already in a terminal state (`APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`). | Requests can be decided only once. Check decision history in the dashboard. |
| Dashboard shows `Service Offline` banner | Dashboard dev server cannot connect to backend on `GUARDRAIL_API_BASE_URL`. | Verify backend process is running and CORS origin (`http://localhost:5173`) is listed in `GUARDRAIL_ALLOWED_ORIGINS`. |
| Action shows `Context Changed` / continuation disabled | Ward navigated to a different page, changed path, or the underlying DOM button detached. | Interception binds strictly to target context. Re-initiate the action from the current page. |

---

## 12. Security & Privacy Considerations

1. **Zero Secret Storage**: The repository tracks zero secrets, `.env` files, or private keys. All sensitive credentials must be supplied via secure environment variables or runtime identity providers.
2. **Data Minimization on the Wire**: Approval payloads omit sensitive form values, raw text inputs, passwords, OTPs, CVVs, and credit card numbers. Only high-level metadata (origin, category, interaction type, risk score) is transmitted.
3. **Authoritative Server Clock**: Approval TTLs (15 minutes) are computed and validated using server timestamps to prevent client-side clock tampering.
4. **DOM Boundary Hardening**: Extension staging modals and advisory dialogs use closed Shadow DOM trees, isolating styles and event listeners from malicious page scripts.
5. **Audit Trails & Secure Deletion**: All policy updates, relationship modifications, and approval decisions produce immutable audit records. Purged records are deleted using SQLite `PRAGMA secure_delete = 1`.
6. **No Penetration Test Claim**: Automated test suites verify unit, integration, and contract invariants. These tests establish architectural consistency, but do not constitute a formal third-party penetration test or external compliance certification.
