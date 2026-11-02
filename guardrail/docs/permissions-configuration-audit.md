# Day 19 Prompt 5 — Permissions and Configuration Audit & Hardening

**Date:** 2026-11-02  
**Scope:** Extension manifest (`manifest.json`), environment & runtime endpoint configuration (`ApprovalApiClient`, `resolveApiBaseUrl`), mock service identification (`PERSISTENCE_METADATA`), build configuration (`build.mjs`), package scripts & dependency audit (`package.json`), and regression verification.

---

## 1. Executive Summary

This audit reviewed the extension permissions, environment handling, build settings, and release configuration of Guardrail UI.

Key outcomes:
1. **Manifest Permissions Verified & Justified:** The extension requests strictly one permission (`"storage"`), which is indispensable for policy configuration and token/endpoint caching. It injects content scripts on `<all_urls>` for universal safety monitoring. Broad network permissions (`*://*/*`) remain excluded from `host_permissions` to adhere to the principle of least privilege until a live production approval backend is deployed.
2. **Production Endpoint & HTTPS Hardening:** `ApprovalApiClient` and `resolveApiBaseUrl()` have been hardened to distinguish between development and production environments. In production mode, the client defaults to `DEFAULT_PROD_API_BASE_URL` (`https://api.guardrail-safety.org`) rather than `http://localhost:3000`, and strictly rejects cleartext `http://` URLs with an explicit error.
3. **Mock Service Identification:** Ephemeral in-memory persistence (`PERSISTENCE_METADATA.IS_PRODUCTION === false`) is explicitly marked to prevent development mocks from masquerading as production databases.
4. **Build & Release Packaging Hardening:** `build.mjs` was updated to support `--prod` (and `NODE_ENV=production`), disabling source map generation, removing stale map artifacts, and enabling minification.
5. **Dependency & Verification Tooling:** Added `build:prod`, `audit`, and `test:permissions-config` scripts. All 41 assertions in the new permissions and configuration hardening suite passed, alongside all 48 extension test suites and 4 dashboard test suites. Zero high or critical vulnerabilities were found in `npm audit`.

---

## 2. Permission Audit

| Manifest Entry | Declared Scope | Actual Feature Usage | Code Path | Assessment & Decision |
|---|---|---|---|---|
| `permissions: ["storage"]` | Extension storage | Persisting and retrieving user risk policies; caching reviewer API base URL and auth tokens; listening to cross-context storage changes. | `guardrail/extension/src/config/loader.ts`<br>`guardrail/extension/src/content/index.ts`<br>`guardrail/extension/src/background/index.ts`<br>`guardrail/extension/src/approval/client.ts` | **Retained (Necessary):** Indispensable for configuration persistence and reactive cross-context synchronization. No narrower standard permission exists for these storage operations. Removing it breaks core functionality. |
| `content_scripts.matches` | `["<all_urls>"]` | Injecting user action detection, evaluation, and Staging Mode containment UI across websites. | `guardrail/extension/src/content/index.ts` | **Retained (Inherent to Scope):** Required for all-site safety monitoring. Narrowing without a specific enterprise/allowlist domain model would break safety coverage on unlisted sites. |
| `host_permissions` | *Omitted* | Cross-origin network calls to the approval backend. | `guardrail/extension/src/approval/client.ts` | **Deferred / Not Added Prematurely:** No production backend is deployed in `guardrail/server/`. Adding wildcards (`*://*/*` or `<all_urls>`) would introduce unnecessary attack surface. Host permissions must be restricted to the exact production backend domain once deployed. |
| Sensitive Permissions (`webRequest`, `cookies`, `debugger`, `management`, etc.) | *None declared* | None. | N/A | **Verified Absent:** No high-risk or superfluous browser APIs are declared. |

---

## 3. Environment & Endpoint Configuration Hardening

### 3.1 Production HTTPS Enforcement & URL Resolution
Previously, `ApprovalApiClient` defaulted to `DEFAULT_DEV_API_BASE_URL` (`http://localhost:3000`) regardless of execution environment, and insecure `http://` URLs were not blocked in production configurations.

**Corrections Implemented in `guardrail/extension/src/approval/client.ts`:**
1. **Environment Flag:** Added optional `environment?: 'development' | 'production' | 'test'` to `ApprovalApiClientConfig` and `ResolveApiBaseUrlOptions`.
2. **Production Endpoint Default:** When `environment === 'production'` (or `process.env.NODE_ENV === 'production'`), the client constructor and `resolveApiBaseUrl()` default to `DEFAULT_PROD_API_BASE_URL` (`https://api.guardrail-safety.org`) rather than `http://localhost:3000`.
3. **HTTPS Protocol Validation:** In production mode, any supplied base URL (from configuration, `sessionStorage`, or `chrome.storage.local`) is strictly parsed and verified. If the protocol is not `https:`, a clear error is thrown:
   `[Guardrail ApiClient] Insecure base URL "..." rejected in production mode. Production endpoints must use HTTPS.`

### 3.2 Ephemeral Mock Service Isolation
In `guardrail/extension/src/approval/repository.ts`, `PERSISTENCE_METADATA` provides explicit identification:
- `IS_PRODUCTION: false`
- `TYPE: 'EPHEMERAL_DEVELOPMENT_ONLY_IN_MEMORY'`
- Concurrency limitations and lack of WAL/ACID disk durability are documented to prevent development in-memory repositories from being treated as production infrastructure.

### 3.3 Sensitive Value Protection
- Request payloads are checked by `checkPayloadForSensitiveFields()`, recursively identifying and rejecting `password`, `cardNumber`, `cvv`, `otp`, `secret`, `token`, and `authHeader`.
- `validateClientPayloadIntegrity()` rejects client payloads attempting to smuggle credentials into remote approval requests.
- `resolveAuthToken()` falls back safely to `undefined` without fabricating credentials.

---

## 4. Build Settings & Release Configuration

**Corrections Implemented in `guardrail/extension/build.mjs`:**
1. **Production Mode Detection:** Detects `--prod` CLI argument or `process.env.NODE_ENV === 'production'`.
2. **Source Map Stripping:** `sourcemap: !isProd` disables source map emission for production bundles.
3. **Stale Map Artifact Cleanup:** `copyStaticAssets()` unlinks any existing `.map` files in `dist/` and `dist/popup/` when running in production mode.
4. **Minification:** `minify: isProd` enables bundle minification for smaller package sizes and obfuscation of release artifacts.

**Package Scripts Added to `guardrail/extension/package.json`:**
- `"build:prod"`: `node build.mjs --prod`
- `"audit"`: `npm audit --audit-level=high`
- `"test:permissions-config"`: Executes the dedicated permissions and configuration hardening test suite.

---

## 5. Verification & Test Outcomes

### 5.1 Dedicated Permissions and Configuration Suite (`test:permissions-config`)
A dedicated suite (`guardrail/extension/src/approval/test-permissions-configuration-hardening.ts`) was executed, verifying 41 assertions across 6 categories:

| Category | Assertions | Result | Notes |
|---|---|---|---|
| Manifest Permissions & Scope | 14 | **PASS** | `manifest.json` verified: `storage` declared, sensitive permissions absent, no premature `host_permissions`, `<all_urls>` content script match. |
| Environment Endpoint & HTTPS Enforcement | 6 | **PASS** | Dev mode defaults to localhost; Prod mode defaults to prod HTTPS; cleartext `http://` rejected with typed error in prod; valid HTTPS accepted. |
| Base URL Resolver Multi-Environment | 5 | **PASS** | `resolveApiBaseUrl` defaults correctly per environment and rejects insecure overrides in prod. |
| Mock Service Identification | 3 | **PASS** | `PERSISTENCE_METADATA.IS_PRODUCTION === false` verified; storage limitations documented. |
| Secret Redaction & Privacy | 6 | **PASS** | Passwords, cards, CVVs, OTPs, tokens detected and client payload integrity rejects them. |
| Package Scripts & Build Configuration | 7 | **PASS** | `build:prod`, `audit`, and `test:permissions-config` scripts verified; `--prod`, minification, and source map stripping confirmed. |
| **Total** | **41 / 41** | **PASS** | Exit code 0 |

### 5.2 Build & Audit Verification
| Command | Directory | Result | Notes |
|---|---|---|---|
| `npm run build` | `guardrail/extension` | **PASS (exit 0)** | Emits development bundles with source maps. |
| `npm run build:prod` | `guardrail/extension` | **PASS (exit 0)** | Emits minified production bundles; removes all `.map` files. |
| `npm run audit` | `guardrail/extension` | **PASS (exit 0)** | 0 vulnerabilities found (`--audit-level=high`). |
| `npm test` | `guardrail/extension` | **PASS (exit 0)** | All 48 test suites passed (including Day 11 approval workflow 102/102 and boundary hardening). |
| `npm test` | `guardrail/dashboard` | **PASS (exit 0)** | All 4 test suites passed (including complete sync flow 135/135 and component shell). |

---

## 6. Remaining Release Blockers & Operational Next Steps

1. **Production Approval Backend:** `guardrail/server/` remains a development prototype without an active server process or database. A production PostgreSQL/SQLite deployment with authentication endpoints must be deployed before remote approval can be used live.
2. **Exact Manifest Host Permission:** Once the production domain is finalized (e.g. `https://api.guardrail-safety.org`), add only that specific origin to `host_permissions` in `manifest.json`. Do not use `<all_urls>` for network permissions.
3. **Store Listing Disclosure:** Since `<all_urls>` is declared in `content_scripts` to monitor actions across web applications, ensure privacy policy and Chrome Web Store permission disclosures clearly communicate this scope.
