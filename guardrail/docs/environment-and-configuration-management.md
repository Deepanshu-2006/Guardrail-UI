# Guardrail UI — Environment and Configuration Management Guide

> **Document Type**: Architecture, Operations & Pilot Deployment Guide  
> **Status**: Authoritative Reference  
> **Applicable Version**: Guardrail Extension & Trusted-Contact Dashboard 0.1.0+

---

## 1. Executive Summary & Core Invariants

Guardrail UI enforces a zero-trust, privacy-first configuration management model across all components (Manifest V3 browser extension service worker, content scripts, popup, and trusted-contact dashboard). 

To ensure controlled pilot readiness and prevent unintended security exposures or operational confusion, the architecture adheres to eight inviolable invariants:

1. **Environment Separation**: Distinct profiles for `development`, `pilot`, `test`, and `production`. Pilot builds are stamped with explicit version annotations and separate configuration presets.
2. **Zero Exposed Secrets**: Configuration files, bundle definitions, and build scripts strictly **forbid embedded credentials** (passwords, tokens, API keys, private keys, JWTs). All authentication tokens are supplied exclusively at runtime via authenticated user sessions.
3. **Transport Security (HTTPS Enforcement)**: Remote pilot and production endpoints **must strictly use HTTPS**. Plaintext HTTP is rejected at startup and network dispatch unless targeting a verified local loopback address (`localhost`, `127.0.0.1`, `::1`).
4. **Startup Configuration Validation**: Environment settings are validated on startup before network operations commence. Malformed URLs, forbidden credentials, or invalid parameter bounds fail fast.
5. **Safe Fallbacks for Optional Settings**: Optional timeout and polling settings default to bounded presets. Pilot/production API origins are required build configuration and fail closed if absent; development/test may use localhost.
6. **Explicit Mock vs. Live Service Distinction**: In-memory and mock services broadcast their ephemeral nature via HTTP response headers (`x-guardrail-service-type: ephemeral_in_memory_mock`). The dashboard UI displays a prominent `[MOCK BACKEND]` badge to ensure reviewers never mistake a test stub for a live pilot system.
7. **No Credential Embedding in URLs**: URLs containing inline user credentials (`https://user:pass@host`) are prohibited and rejected by startup validation.
8. **Isolated Storage Namespaces**: Client storage keys are segregated by environment (`guardrail_dev`, `guardrail_pilot`, `guardrail_prod`, `guardrail_test`) to prevent cross-environment cache contamination.

---

## 2. Supported Environments & Configuration Matrix

| Setting | `development` | `pilot` | `production` | `test` |
| :--- | :--- | :--- | :--- | :--- |
| **Target Audience** | Local core engineers | Controlled pilot testers | Public deployment | Automated CI suites |
| **Backend URL** | `http://localhost:3000` | Required build-time `GUARDRAIL_API_BASE_URL` | Required build-time `GUARDRAIL_API_BASE_URL` | `http://localhost:3000` |
| **Protocol Requirement** | HTTP permitted on localhost | **HTTPS strictly enforced** (HTTP only on localhost) | **HTTPS strictly enforced** (No exceptions) | HTTP permitted on localhost |
| **Default Service Type** | `in_memory` | `live` (remote) | `live` (remote) | `mock` / `in_memory` |
| **Mock Permitted?** | Yes | Only with explicit `allowMockInPilot: true` | **Strictly Forbidden** | Yes |
| **Storage Namespace** | `guardrail_dev` | `guardrail_pilot` | `guardrail_prod` | `guardrail_test` |
| **Default Timeout** | 10,000 ms (10 s) | 15,000 ms (15 s) | 10,000 ms (10 s) | 2,000 ms (2 s) |
| **Polling Interval** | 10,000 ms (10 s) | 15,000 ms (15 s) | 10,000 ms (10 s) | 50 ms |
| **Log Level** | `debug` | `info` | `warn` | `warn` |
| **Manifest Version Name** | `0.1.0-dev` | `0.1.0-pilot` | `0.1.0` | `0.1.0-test` |

---

## 3. Secret Hygiene & Zero-Credential Policy

### 3.1 Prohibited Configuration Keys
Static configuration files, environment files, and bundle build flags must **never** contain any of the following property names or patterns:

- `token`, `authToken`, `bearerToken`, `accessToken`, `refreshToken`
- `secret`, `clientSecret`, `apiKey`, `api_key`
- `password`, `privateKey`, `private_key`
- `jwt`, `credentials`

Any configuration object scanned by `detectForbiddenSecrets()` containing these keys or value patterns matching `Bearer <token>` or `eyJ...` triggers immediate startup rejection with `SECRET_EXPOSURE_DETECTED` or `SECRET_TOKEN_DETECTED`.

### 3.2 Dynamic Runtime Authentication Flow
- **Requester / Ward Session**: When submitting an approval request from the browser extension, the session token is retrieved dynamically from `chrome.storage.local` under key `guardrailAuthToken` or provided via runtime `TokenProvider`.
- **Reviewer / Contact Session**: When reviewing requests on the dashboard, tokens are managed in memory during an active user session.
- **Zero Token Logging**: The `ApprovalApiClient` and `NoopApiClientLogger` redact authentication headers and tokens from diagnostic logs, error reports, and console outputs.

---

## 4. Startup Configuration Validation

Configuration objects are validated by `validateEnvironmentConfig(input, targetEnv)` in `guardrail/extension/src/config/environment.ts`.

### 4.1 Validation Invariants
1. **URL Validity**: The `apiBaseUrl` must parse as a valid `URL`. Malformed URLs fail with `MALFORMED_URL`.
2. **Embedded Credential Check**: The URL must not contain inline credentials (`username` or `password`). Any occurrence fails with `INVALID_URL_CREDENTIALS`.
3. **HTTPS Verification**: Remote endpoints in `pilot` or `production` that do not start with `https://` are rejected with `INSECURE_HTTP_REJECTED`.
4. **Mock Protection**: In `pilot`, any configuration with `serviceType !== 'live'` or `isMockService === true` is rejected with `MOCK_SERVICE_IN_PILOT_PROHIBITED` unless explicitly flagged with `allowMockInPilot: true`. In `production`, mock configurations fail unconditionally with `MOCK_SERVICE_IN_PROD_PROHIBITED`.
5. **Numeric Clamping**: Extreme timeout values (< 500 ms or > 60,000 ms) and polling intervals (< 10 ms or > 300,000 ms) generate warnings and are clamped to safe operating bounds.

### 4.2 Safe Fallback Behavior
When optional configuration properties are omitted:
- Development/test `apiBaseUrl` defaults to `http://localhost:3000`. Pilot/production startup and builds fail if `GUARDRAIL_API_BASE_URL` is missing; no sample remote endpoint is used.
- `timeoutMs` defaults to the environment preset.
- `pollIntervalMs` defaults to the environment preset.
- `logLevel` defaults to `info` in pilot, `debug` in development, and `warn` in production.
- `storageNamespace` defaults to `guardrail_<env>`.

---

## 5. Mock vs. Live Service Distinction

To prevent reviewers or pilot participants from assuming that approvals are being tracked by an authoritative persistent database when running against ephemeral memory stores:

### 5.1 Protocol-Level Marker
The in-memory router (`ApprovalApiRouter`) automatically injects the following response header into all HTTP responses:
```http
x-guardrail-service-type: ephemeral_in_memory_mock
```

### 5.2 Client-Side Detection
The `ApprovalApiClient` inspects the `x-guardrail-service-type` header on incoming responses. When detected:
- `client.isMockService()` returns `true`.
- `client.getServiceType()` transitions to `'in_memory'`.

### 5.3 User-Facing Dashboard Badge
When `DashboardShell` connects to a mock or in-memory backend:
- A prominent yellow badge `.gd-mock-service-badge` is rendered in the top header:
  ```html
  <span class="gd-mock-service-badge" role="status" title="Connected to simulated or in-memory mock service. Not connected to a live pilot backend.">
    MOCK BACKEND
  </span>
  ```
- In pilot builds, a blue environment pill `.gd-env-badge.gd-env-pilot` displaying `PILOT` is rendered alongside the reviewer status.

---

## 6. How to Configure and Run in Each Environment

### 6.1 Local Development Environment

```bash
# 1. Build extension in development mode (with source maps, unminified)
cd guardrail/extension
npm run build

# 2. Watch for changes during active extension development
npm run watch

# 3. Run all unit and integration test suites
npm test

# 4. Run extension against local test pages in Chrome
# Open chrome://extensions -> Enable Developer Mode -> Load Unpacked -> select 'guardrail/extension/dist'
```

### 6.2 Controlled Pilot Deployment

```bash
# 1. Build extension for controlled pilot with the actual API origin
cd guardrail/extension
GUARDRAIL_ENV=pilot GUARDRAIL_API_BASE_URL=https://<actual-api-origin> npm run build:pilot

# Output:
# - Generates dist/ with version_name: "0.1.0-pilot" in manifest.json
# - Injects process.env.GUARDRAIL_ENV = 'pilot'
# - Minifies bundles and removes stale sourcemaps
# - Requires the configured HTTPS endpoint; generates one exact host permission for it

# 2. Verify all pilot environment and configuration tests pass
npm run test:env-config

# 3. Build the dashboard with the same endpoint
cd ../dashboard
GUARDRAIL_ENV=pilot GUARDRAIL_API_BASE_URL=https://<actual-api-origin> npm run build
```

> [!IMPORTANT]
> **Pilot Chrome Manifest Permission Requirement**: The build generates a Manifest V3 `host_permissions` entry scoped to the configured API origin. The backend separately requires exact `GUARDRAIL_ALLOWED_ORIGINS` entries for the real extension ID origin and dashboard origin; do not use wildcards. CORS does not replace extension host permission.

### 6.3 Automated Test Environment

```bash
# Run standalone environment configuration test suite
npm run test:env-config

# Run full extension test battery (44+ test suites)
npm test

# Run dashboard test battery (shell, sync, verification)
cd ../dashboard
npm test
```

### 6.4 Production Build (Roadmap Target)

```bash
cd guardrail/extension
npm run build:prod
```

---

## 7. Configuration Reference Summary

```typescript
import {
  resolveEnvironmentConfig,
  validateEnvironmentConfig,
  PILOT_CONFIG,
  DEVELOPMENT_CONFIG,
} from './config/environment.js';

// Resolve development configuration; pilot/production use the build-injected URL.
const config = resolveEnvironmentConfig();

// Explicit pilot validation check
const validation = validateEnvironmentConfig({
  environment: 'pilot',
  apiBaseUrl: 'https://pilot.example.test',
  timeoutMs: 15000,
});

if (!validation.valid) {
  console.error('Startup validation failed:', validation.errors);
}
```
