# Guardrail Trusted Contact Dashboard: Architecture & Runtime Audit Report

**Date:** November 7, 2026  
**Scope:** Trusted Contact Dashboard Architecture, Runtime & Reviewer UX Audit  
**Status:** Operational (Verified Local Preview & Build Architecture)  

---

## 1. Executive Summary

This audit assesses the runtime architecture, build infrastructure, local preview capability, and authentication integration of the **Guardrail Trusted Contact Reviewer Portal & Dashboard** (`guardrail/dashboard`).

### Key Findings
* **No Heavy Framework Needed:** The dashboard is built as an ultra-lightweight, zero-runtime-dependency TypeScript application compiling to native ES modules (`dist/dashboard.js`) and vanilla CSS (`styles/dashboard.css`). It requires no heavy frameworks (e.g. Next.js, Vite, or React), preserving fast builds and minimal attack surfaces.
* **Intended Runtime Model:** The dashboard requires a lightweight local HTTP development server (rather than `file:///` URLs) due to browser CORS and ES module (`<script type="module">`) security policies.
* **Resolution of the "npm run dev" Issue:** The issue was resolved in commit `1b726eb`. `guardrail/dashboard/package.json` now includes `"dev": "node dev.mjs"`, which launches an `esbuild.context` server watching `src/**/*.ts` and serving on `http://localhost:5173`.
* **Live Local Preview Verified:** Both `guardrail/server` (port `3000`) and `guardrail/dashboard` (port `5173`) are currently active and responding with `200 OK`.
* **Separation of Duties & Decoupled Execution:** The dashboard adheres strictly to the core safety invariant: reviewer decisions (`APPROVED` / `REJECTED`) update backend status, but **never trigger remote action execution in the ward's browser**.

---

## 2. Investigation: "npm run dev" Script Status

### Historical Issue
Earlier iterations of `guardrail/dashboard/package.json` only exposed `"build"` and test scripts. Attempting `npm run dev` failed with `missing script: "dev"`.

### Current State (Verified)
In commit `1b726eb`, a zero-dependency development server script [`guardrail/dashboard/dev.mjs`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/dev.mjs) was introduced, and `guardrail/dashboard/package.json` was updated:

```json
{
  "scripts": {
    "dev": "node dev.mjs",
    "start": "node dev.mjs",
    "build": "node build.mjs",
    "type-check": "../extension/node_modules/.bin/tsc --noEmit",
    "test:shell": "../extension/node_modules/.bin/esbuild src/tests/test-dashboard-shell.ts --bundle --format=esm --target=es2022 --outfile=dist/test-dashboard-shell.js && node dist/test-dashboard-shell.js",
    "test:verify-day12": "../extension/node_modules/.bin/esbuild src/tests/verify-day12-workflow.ts --bundle --platform=node --format=esm --target=es2022 --outfile=dist/verify-day12-workflow.js && node dist/verify-day12-workflow.js",
    "test:sync": "../extension/node_modules/.bin/esbuild src/tests/test-dashboard-sync.ts --bundle --format=esm --target=es2022 --outfile=dist/test-dashboard-sync.js && node dist/test-dashboard-sync.js",
    "test:verify-complete-sync": "../extension/node_modules/.bin/esbuild src/tests/verify-complete-sync-flow.ts --bundle --platform=node --format=esm --target=es2022 --outfile=dist/verify-complete-sync-flow.js && node dist/verify-complete-sync-flow.js",
    "test:dev": "node src/tests/test-dev-server.mjs",
    "test": "npm run test:shell && npm run test:verify-day12 && npm run test:sync && npm run test:verify-complete-sync && npm run test:dev"
  }
}
```

The script `dev.mjs` configures:
1. `esbuild.context` compilation targeting `es2022` with source maps.
2. Background file watching on `src/**/*.ts`.
3. An internal HTTP server via `ctx.serve({ servedir: '.', host: '127.0.0.1', port: 5173 })`.
4. Serving of [`index.html`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/index.html), [`styles/dashboard.css`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/styles/dashboard.css), and [`dist/dashboard.js`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/dist/dashboard.js) with exact MIME types (`text/html`, `text/css`, `text/javascript`).

---

## 3. Comprehensive Inspection of Dashboard Codebase

### 1. `dashboard/package.json`
* **Dependency Strategy:** Uses devDependencies from `guardrail/extension` (sharing `esbuild ^0.25.0` and `typescript ^5.8.2`), avoiding redundant `node_modules` duplication.
* **Test Orchestration:** 5 dedicated test suites covering components, HTTP workflows, background synchronization, and dev server lifecycle.

### 2. `dashboard/README.md`
* Documents visual design tokens (neutral surfaces `#f8fafc`/`#f1f5f9`, emerald accents `#059669`, semantic risk badges).
* Highlights the inviolable decoupled action execution invariant.
* Documents run commands, configuration environment variables (`GUARDRAIL_API_BASE_URL`), and authentication contracts.

### 3. `dashboard/build.mjs` & `dev.mjs`
* Uses `resolveBackendUrl` from [`guardrail/build/backend-url.mjs`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/build/backend-url.mjs).
* Injects compile-time constants:
  * `process.env.GUARDRAIL_ENV`
  * `__GUARDRAIL_API_BASE_URL__` (defaults to `http://localhost:3000` in dev).
* Flags:
  * `--serve`: Delegates to `dev.mjs`.
  * `--watch`: Watches without starting an HTTP listener.
  * Standard run: Generates minified production/pilot bundle.

### 4. `dashboard/index.html`
* Semantic HTML5 shell with `<div id="dashboard-app" role="application">`.
* Typography imports: Inter and JetBrains Mono from Google Fonts.
* Stylesheet: `<link rel="stylesheet" href="styles/dashboard.css">`.
* Script: `<script type="module" src="dist/dashboard.js"></script>`.

### 5. `dashboard/src/index.ts`
* Library entry point and automatic DOM bootstrap.
* Exposes `mountDashboardShell` and `mountAuthenticatedDashboardShell`.
* Auto-mount logic detects `#dashboard-app` container.
* In commit `2714b4b`, added `localStorage.getItem('guardrail_auth_token')` reading and client-side JWT payload extraction (`parseJwtProfile`) to automatically initialize authenticated reviewer sessions in standalone browser testing.

### 6. `dashboard/src/components/`
Modular, accessible DOM renderers:
* **[`navigation.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/navigation.ts):** Sidebar brand, responsive hamburger toggle, and view links (`#overview`, `#pending`, `#history`).
* **[`account.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/account.ts):** Profile card showing canonical actor ID, ward binding, and authenticated state (`🔒 Standalone Shell` when unauthenticated).
* **[`overview.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/overview.ts):** Oversight metrics, architecture callout note, and invitation connection modal trigger.
* **[`pending.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/pending.ts):** Master pending view coordinating two-pane master-detail layout, empty states, and refresh actions.
* **[`detail.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/detail.ts):** Request inspector displaying risk score badges, heuristic explanations, origin hostname, ward identifier, and Approve / Reject decision actions.
* **[`filters.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/filters.ts):** Client-side filter bar for risk level, status, date ranges, and text search queries.
* **[`history.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/history.ts):** Audit trail of terminal requests (`APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`).

### 7. Styles Hierarchy
* Located at [`guardrail/dashboard/styles/dashboard.css`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/styles/dashboard.css).
* Contains 38 KB of structured design system rules: CSS custom properties (`--gd-green-primary`, `--gd-slate-*`), flexbox layout, two-pane grids, risk level badges (`.gd-badge-critical`, `.gd-badge-high`), and focus-visible outlines.

### 8. `dashboard/dist/`
* [`dist/dashboard.js`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/dist/dashboard.js) (~242 KB): The compiled bundle containing the entire dashboard runtime and embedded `ApprovalApiClient`.
* [`dist/dashboard.js.map`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/dist/dashboard.js.map) (~558 KB): Development sourcemap.

### 9. API Client & Authentication Integration
* **Shared Client:** Utilizes `ApprovalApiClient` from [`guardrail/extension/src/approval/client.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/client.ts).
* **Token Resolution:**
  1. Checks `globalThis.__GUARDRAIL_AUTH_TOKEN_PROVIDER__`.
  2. Falls back to `localStorage.getItem('guardrail_auth_token')`.
  3. If missing, runs in disconnected mock/standalone mode without attempting failed unauthorized network calls.
* **Backend Origin:** Bound to `http://localhost:3000` via build-time injection.
* **CORS Compatibility:** The backend allowlist includes `http://localhost:5173` and `http://127.0.0.1:5173`.

### 10. Existing Automated Test Coverage
All 5 dashboard test suites currently pass with 100% success rate:
* `npm run test:shell` (327/327 tests passed)
* `npm run test:verify-day12` (104/104 tests passed)
* `npm run test:sync` (54/54 tests passed)
* `npm run test:verify-complete-sync` (135/135 tests passed)
* `npm run test:dev` (All HTTP endpoint and MIME assertions passed)

---

## 4. Working Functionality vs. Mock / In-Memory Data

| Feature | Current Functional Implementation | Backing Mechanism |
| :--- | :--- | :--- |
| **Pending Approvals Listing** | **Live** when authenticated token is present; **Empty state** when unauthenticated. | `GET /api/v1/approvals/pending` via `ApprovalApiClient` |
| **Request Detail Inspector** | **Live** data display with risk reasons, origin hostname, timestamp, and metadata. | `GET /api/v1/approvals/:id` or local cache |
| **Reviewer Decision Submission** | **Live** submission (`APPROVED` / `REJECTED`) with decision notes. | `POST /api/v1/approvals/:id/decide` |
| **Background Polling & Sync** | **Live** 10-second interval; pauses when tab hidden, auto-refreshes on tab visible. | Polling loop in `DashboardShell` |
| **Decision History Pane** | **Session-accumulated** audit trail; persists decisions made during active session. | In-memory `historyRequests` state in `DashboardShell` |
| **Metrics Overview Cards** | **Live** active pending counts; placeholder for long-term historical aggregates. | Derived from active request lists |
| **Ward Relationship Binding** | **Live** SQLite relation mapping reviewer canonical ID to ward ID. | Server SQLite table `trusted_contact_relationships` |

---

## 5. Local Runtime Verification

Both services have been verified running locally:

```text
Backend Server:    http://127.0.0.1:3000   (Status: {"status":"ready"})
Dashboard Portal:  http://localhost:5173/  (Status: 200 OK, MIME: text/html)
```

The browser dashboard can be accessed directly at **`http://localhost:5173/#pending`**.

---

## 6. Recommendations & Next Milestones

1. **Keep Zero-Framework Architecture:** Retain esbuild and native ES modules. No React, Vite, or Next.js migration is needed or desirable.
2. **Persistent Decision History:** Currently, historical requests are accumulated during the browser session. Consider wiring an authenticated backend history endpoint (`GET /api/v1/approvals/history`) if historical review auditing across browser restarts is required.
3. **Session Management UI:** Add a clean UI mechanism for reviewers to inspect session expiry and refresh credentials without requiring manual `localStorage` operations.
4. **Enhanced Detail Visualizations:** Expand the detail view with clearer heuristic explanations, risk level breakdowns, and sanitization assurances.
