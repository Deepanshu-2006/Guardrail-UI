# Guardrail Controlled-Pilot Build, Packaging & Deployment Guide

## 1. Executive Summary & Verification Notice

This document establishes the authoritative build, packaging, installation, and rollback procedures for the **Guardrail Controlled Pilot**.

> [!IMPORTANT]
> **Controlled Pilot Deployment Boundary**
> * The extension is packaged specifically for the internal, controlled pilot deployment (`0.1.0-pilot`).
> * **NO PUBLIC PUBLISHING**: The extension is NOT published to the public Chrome Web Store, Edge Add-ons catalog, or public CDN.
> * **NO PRODUCTION BACKEND DEPLOYMENT**: This repository does not provide a deployed pilot endpoint. Configure the actual controlled-test API origin with `GUARDRAIL_API_BASE_URL`; no remote URL is assumed by the build.

---

## 2. Repeatable Build & Packaging Workflow

The pilot build pipeline uses `build.mjs` with explicit environment targeting, strict asset compilation, and clean distribution isolation.

### 2.1 Build Commands

From `guardrail/extension`:

```bash
# 1. Build using the actual controlled-test HTTPS backend origin
GUARDRAIL_ENV=pilot GUARDRAIL_API_BASE_URL=https://<actual-api-origin> npm run build:pilot

# 2. Package clean distribution zip (generates dist/guardrail-extension-pilot.zip)
npm run package:pilot

# 3. Run automated build, packaging, and resilience verification suite
npm run test:pilot-build
```

### 2.2 Compilation Pipeline Behavior

| Pipeline Step | Pilot Behavior (`--pilot`) | Standard Development (`default`) |
| :--- | :--- | :--- |
| **`process.env.GUARDRAIL_ENV`** | `"pilot"` (injected via `esbuild.define`) | `"development"` |
| **Minification** | Enabled (`minify: true`) | Disabled for readable debugging |
| **Source Maps** | **Strictly excluded** (`sourcemap: false`, `.map` purged) | Enabled (`inline` or external `.map`) |
| **Manifest Annotation** | `version_name: "0.1.0-pilot"`<br>`description: "... [PILOT DEPLOYMENT]"` | `version_name: "0.1.0-dev"` |
| **Clean Isolation** | Assembled into `dist-pilot/` and `guardrail-extension-pilot.zip` | Retained in `dist/` |

---

## 3. Package Inventory & Exclusion of Development Artifacts

A critical safety requirement is that **no development-only settings, mock data fixtures, test runners, or source maps** leak into the pilot distribution.

### 3.1 Clean Distribution Directory (`dist-pilot/`)

`dist-pilot/` contains strictly the files required by Chromium runtime:

```
dist-pilot/
├── manifest.json              # Manifest V3 (least privilege, storage only)
├── background.js              # Service worker coordinator (minified, ~96KB)
├── content.js                 # Content script interceptor (minified, ~294KB)
├── popup/
│   ├── popup.html             # Status popup DOM structure
│   ├── popup.css              # Popup styling
│   └── popup.js               # Dynamic popup coordinator
├── onboarding/
│   ├── onboarding.html        # Onboarding & pairing guide
│   ├── onboarding.css         # Onboarding styling
│   └── onboarding.js          # Onboarding pairing logic
└── icons/
    ├── icon-16.png            # 16x16 extension toolbar icon
    ├── icon-48.png            # 48x48 management icon
    └── icon-128.png           # 128x128 high-res icon
```

### 3.2 Verification Checkpoints

The automated test suite (`npm run test:pilot-build`) verifies:
1. **Zero Test Bundles**: No `test-*.js` or `verify-*.js` files exist in `dist-pilot/` or `guardrail-extension-pilot.zip`.
2. **Zero Sourcemaps**: No `.map` files exist in `dist-pilot/` or subdirectories.
3. **Zero Embedded Secrets**: `FORBIDDEN_SECRET_KEYS` (passwords, tokens, private keys) are rejected at configuration time.
4. **Clean Archive**: `dist/guardrail-extension-pilot.zip` contains exactly 15 verified files and zero temporary `.DS_Store` files.

---

## 4. Backend Configuration & Offline Resilience

### 4.1 Shared endpoint configuration

The extension and dashboard use the same build-time `GUARDRAIL_API_BASE_URL` origin. Pilot/production builds fail when it is missing or invalid. The extension build generates a Manifest V3 host permission for only that origin. Runtime URL storage overrides are not supported because they could exceed the permission granted by the packaged manifest. Set server-side `GUARDRAIL_ALLOWED_ORIGINS` to the exact installed extension origin and dashboard origin.

### 4.2 Security & Protocol Invariants

* **HTTPS Enforcement**: In pilot mode, all remote endpoints **must use HTTPS**. Attempting to configure an unencrypted remote URL (`http://insecure-backend.org`) is strictly rejected with:
  > `[Guardrail ApiClient] Insecure base URL "http://..." rejected in pilot mode. Pilot endpoints must use HTTPS.`
* **Localhost Exception**: Local testing addresses (`http://localhost:*`, `http://127.0.0.1:*`) are permitted to allow isolated end-to-end testing without public internet connectivity.

### 4.3 Safe Handling of Unavailable Backend Services

When the backend service is offline, unreachable, or returns a 5xx/gateway error:
* **The HELD Invariant**: The intercepted browser action **remains strictly in the `HELD` state** in `InterceptionController`.
* **Zero Automatic Continuation**: The continuation closure is NEVER executed upon connection failure (execution count remains strictly 0).
* **Controlled Polling**: Status polling halts after a bounded retry limit or client error without infinite tight-loop network spam.
* **User-Facing Notice**: The Staging UI displays a clear, non-technical notice:
  > *"Cannot reach Guardrail safety service. Your action remains safely paused. Please check your network connection."*

---

## 5. Pilot Installation Procedures

### 5.1 Manual Installation in Chromium (Developer Mode)

For pilot testers and QA engineers using Chrome, Brave, or Edge:

1. Build the pilot bundle:
   ```bash
   cd guardrail/extension
   npm run build:pilot
   ```
2. Open the browser and navigate to `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** in the top-left toolbar.
5. In the file dialog, select the directory:
   `<repo-root>/guardrail/extension/dist-pilot`
6. Verify that the extension appears with:
   - Name: `Guardrail`
   - Version: `0.1.0-pilot`
   - Description: `Safety, observability, and policy enforcement extension foundation. [PILOT DEPLOYMENT]`

### 5.2 Managed Enterprise Deployment (Chromium Policy)

For controlled enterprise pilot rollouts across test workstations, administrators can deploy via Chromium policy JSON without developer mode:

```json
{
  "ExtensionSettings": {
    "<extension-id>": {
      "installation_mode": "normal_installed",
      "update_url": "https://pilot-updates.guardrail-safety.org/updates.xml"
    }
  }
}
```

---

## 6. Rollback Procedures

If an unexpected behavior or regression is observed during pilot testing:

### 6.1 Immediate Ward Rollback (Client-Side)

1. Open `chrome://extensions`.
2. Locate **Guardrail** (`0.1.0-pilot`).
3. Toggle the switch to **Disabled** (or click **Remove**).
4. *Effect*: All intercepted DOM listeners and service worker routing are immediately released. Native browser navigation resumes without interception.

### 6.2 Version Rollback to Previous Stable Build

1. Checkout the previous verified commit or build tag:
   ```bash
   git checkout <previous-pilot-tag>
   ```
2. Rebuild the previous pilot bundle:
   ```bash
   npm run build:pilot
   ```
3. In `chrome://extensions`, click the **Reload** (circular arrow) icon on the Guardrail extension card.
4. Clear stored session state by executing in the background worker console:
   ```javascript
   chrome.storage.local.clear();
   ```

---

## 7. Testing in Supported Browser Environments

The built extension can be validated across the test matrix:

```bash
# Run pilot build, packaging, and resilience verification
npm run test:pilot-build

# Run browser environment integration tests
npm run test:browser:env
npm run test:browser:interception
npm run test:browser:approval
npm run test:browser:security
npm run test:browser:privacy

# Run complete extension verification
npm test
```
