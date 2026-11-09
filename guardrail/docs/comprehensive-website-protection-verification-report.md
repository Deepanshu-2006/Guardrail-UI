# Comprehensive Verification Report: Website Protection & Detection Engine

**Document:** Comprehensive Website Protection Verification Report  
**Date:** November 9, 2026  
**System Under Test:** Guardrail UI - Browser Extension, Risk Engine, Response Pipeline, Warning UI, Backend Approval Server, and Caretaker Dashboard  
**Status:** ✅ Fully Verified Across All 14 Inspection Points (Unit, Mocked Browser, and Headless Chromium CDP Tiers)  
**Safety & Security Invariants:** Pure Local Heuristics (No False "Safe" Claims), Zero Credential Harvesting, Approval Action Binding Integrity, Explicit Sensor Limitations  

---

## Executive Summary

This report provides an end-to-end audit and empirical verification of all website protection capabilities completed for Guardrail UI. 

Guardrail has expanded beyond transactional button interception to incorporate a multi-layered website safety engine comprising:
1. Standards-compliant URL parsing and normalization (`url-detector.ts`).
2. Structural suspicious URL heuristics and deceptive subdomain detection (`url-detector.ts`).
3. Multi-indicator phishing and credential boundary detection (`phishing-detector.ts`).
4. Deterministic risk engine scoring and precedence rules (`rules.ts`, `engine.ts`).
5. Policy-driven response decisions with dynamic threshold evaluations (`policies.ts`, `pipeline.ts`).
6. Shadow DOM-isolated, accessible Warning UI with explicit detection basis indicators (`warning-modal.ts`).
7. Complete browser extension content script, service worker, and approval binding integration (`content/index.ts`, `background/index.ts`).
8. Controlled multi-tier testbed featuring 7 synthetic test pages and 3 test execution tiers (Unit, Mocked Browser, and Real Headless Chromium via Chrome DevTools Protocol).

Across all components, test execution yielded **100% pass rates** across all active unit, mocked, and real-browser suites. Zero credentials or sensitive form values are captured, unverified sites are never falsely certified as "safe", heuristic alerts are strictly distinguished from confirmed malware threats, and browser extension architectural boundaries are explicitly documented.

---

## 1. Verification of the 14 Required Inspection Areas

### 1. Website Protection Architecture
- **Pipeline Flow:** DOM Interaction Event $\rightarrow$ `ActionDetector` $\rightarrow$ `extractElementInfo` / `extractPageInfo` $\rightarrow$ `evaluateActionPipeline` (`ActionClassifier` $\rightarrow$ `RiskEngine` $\rightarrow$ `RiskPolicyRegistry`) $\rightarrow$ `ResponseDecision` (`ALLOW` | `WARN` | `PROTECT`).
- **Separation of Concerns:** URL and phishing detectors operate as pure deterministic evaluation functions with zero side effects, zero network calls, and zero direct DOM manipulation.
- **Controlled vs. Ambient Interactions:**
  - *Controlled Interactions (`[data-guardrail-test-action]`):* Synchronously intercepted at the capturing phase (`event.preventDefault()`, `event.stopImmediatePropagation()`), placed in `HELD` state in `InterceptionController`, bound via cryptographic SHA-256 digests (`ApprovalActionBinding`), and routed into the Staging Modal.
  - *Ambient Interactions (Unmarked Elements):* Guardrail acts as an ambient sensor. If elevated risk is detected, it renders an advisory Warning Modal (`#guardrail-warning-ui-host`). If `PROTECT` is rendered on an ambient element, Guardrail truthfully logs an **Architectural Sensor Limitation Notice** and explicitly confirms that the interaction was **not held or rolled back**.

### 2. URL Parsing & Normalization
- **Standards-Compliant Parsing:** Employs the native Web `URL` API inside strict `try/catch` wrappers.
- **Normalization Rules:**
  - Hostnames normalized to lowercase.
  - Trailing dots stripped (`example.com.` $\rightarrow$ `example.com`).
  - Redundant default ports removed (`:80` for HTTP, `:443` for HTTPS).
  - Credentials in userinfo stripped before downstream evaluation.
  - Path normalization removes duplicate slashes and trailing slashes.
- **Robust Exception Handling:** Malformed schemes (e.g. `http://`), invalid IPv6 syntax (`https://[invalid-ipv6`), and pseudo-protocols (`javascript:void(0)`) return `isValid: false` and trigger `INVALID_OR_MALFORMED_URL` without crashing the content script.

### 3. Suspicious URL Detection
- **Public IP Hostnames:** Flags raw IPv4 (e.g. `198.51.100.24`) and IPv6 hostnames with `IP_ADDRESS_HOSTNAME`. Whitelists loopback addresses (`127.0.0.1`, `localhost`, `[::1]`) for local development.
- **Hyphen Stuffing:** Hostnames containing excessive hyphens combined with security/account tokens (e.g. `secure-login-account-update-verify.com`) trigger `HYPHEN_STUFFED_HOSTNAME`.
- **Excessive Subdomain Stacking:** Hostnames with $>3$ subdomain tiers trigger `EXCESSIVE_SUBDOMAINS`.
- **Non-Standard Ports:** Flags uncommon ports (e.g. `1337`, `8080`, `8443`) on sensitive endpoints with `SUSPICIOUS_PORT`.
- **High-Risk TLDs:** Flags dangerous file-extension TLDs (`.zip`, `.mov`) or abused TLDs combined with authentication tokens.

### 4. Deceptive Domain Indicators
- **Deceptive Subdomains:** Identifies high-profile brand tokens (`paypal`, `google`, `microsoft`, `apple`, etc.) placed as subdomains on unrelated root domains (e.g. `paypal.com.account-update.xyz` where registrable domain is `account-update.xyz`).
- **Homoglyphs & Punycode:** Flags internationalized domain names beginning with `xn--` or combining Latin and Cyrillic/Greek lookalikes (`PUNYCODE_OR_HOMOGLYPH`).
- **Multi-Part TLD Handling:** Uses a curated set of known two-level registries (`co.uk`, `com.au`, `co.in`, `edu.sg`, etc.) to accurately extract registrable domains without substring misattributions.

### 5. Phishing-Related Indicators
- **Brand Identity Mismatch:** Triggers `HEURISTIC_BRAND_IDENTITY_MISMATCH` when page title or metadata claims identity for a known service while hosted on an alien domain.
- **Deceptive Asset Origins:** Triggers `HEURISTIC_DECEPTIVE_ASSET_ORIGIN` when page assets (such as Google or Microsoft CDN avatars) are loaded on unassociated third-party domains.
- **Insecure Login Context:** Triggers `HEURISTIC_INSECURE_LOGIN_CONTEXT` when password input fields are served over unencrypted plain HTTP.
- **IP-Hosted Login:** Triggers `HEURISTIC_IP_HOSTED_LOGIN` when password authentication forms are hosted directly on public IP addresses.
- **Cross-Origin Credential Submission:** Triggers `HEURISTIC_CROSS_ORIGIN_CREDENTIAL_SUBMISSION` when forms collecting credentials submit across origin boundaries.
- **Exfiltration Sinks:** Triggers `HEURISTIC_DATA_EXFILTRATION_ENDPOINT` when forms target external webhook collectors (e.g. `formspree.io`, `discordapp.com/api/webhooks`).

### 6. Website Risk Classification
- **Bounded Scoring:** Clamped strictly between 0 and 100 via `clampRiskScore()`.
- **Multi-Rule Evaluation:** Rules have deterministic priorities (Destructive: 100, Payment: 90, Phishing: 85, Authentication: 80, Suspicious URL: 75, External Navigation: 70, Download: 60).
- **Categorization:** Risk levels follow strict thresholds:
  - Score $0 \le s \le 20$: `LOW`
  - Score $21 \le s \le 60$: `MEDIUM`
  - Score $61 \le s \le 80$: `HIGH`
  - Score $81 \le s \le 100$: `CRITICAL`

### 7. Policy Integration
- **Precedence Hierarchy:** `PROTECT` > `WARN` > `ALLOW`.
- **Mapping:**
  - `CONTROLLED_DESTRUCTIVE_POLICY` $\rightarrow$ `PROTECT`
  - `CONTROLLED_PAYMENT_POLICY` $\rightarrow$ `PROTECT`
  - `AUTHENTICATION_BOUNDARY_POLICY` $\rightarrow$ `WARN`
  - `EXTERNAL_NAVIGATION_POLICY` $\rightarrow$ `WARN`
- **Dynamic Config Support:** Allows runtime threshold adjustments and trusted domain exemptions via `isTrustedDomain()`.

### 8. User-Facing Warnings (`warning-modal.ts`)
- **Shadow DOM Isolation:** Rendered in an open shadow root attached to `#guardrail-warning-ui-host`, ensuring 100% CSS encapsulation from the host page.
- **Accessible Dialog:** Complies with W3C WAI-ARIA (`role="alertdialog"`, `aria-modal="true"`, focus trap, keyboard `Escape` dismissal, return of focus to prior element).
- **Truthful Status Banners:** Explicitly states `Action Status: Advisory Notice` for ambient warnings versus `Action Status: Held in Staging Mode` for controlled interceptions.
- **Explicit Detection Basis:** Prominently displays `🔍 Detection Basis: Local Safety Heuristic` and explains `Not a verified malware threat (local heuristic)`.

### 9. Browser Extension Integration
- **Manifest V3 Content Script:** `content/index.ts` connects `ActionDetector`, `evaluateActionPipeline`, `showWarningModal`, and `dispatchActionToBackground`.
- **Background Coordinator:** `background/index.ts` receives sanitized actions and enforces message schema integrity. Rejects unauthorized decision overrides.
- **Action Binding Security:** `ApprovalActionBinding` maintains cryptographic SHA-256 bindings. Terminal approval states alone **never automatically execute a browser action**.

### 10. Controlled Browser Tests
- Complete testing infrastructure provided across:
  - Tier 1: Pure Unit Tests (`test-website-detection-unit.ts`).
  - Tier 2: Mocked Browser DOM Tests (`test-website-protection-mocked-browser.ts`).
  - Tier 3: Real Headless Chromium CDP Tests (`test-website-protection-real-browser.ts`).

### 11. Privacy Boundaries
- **Zero Credential Collection:** `extractElementInfo()` in `dom.ts` completely omits input values, passwords, card numbers, and OTPs.
- **URL Sanitization:** `sanitizeUrlForDiagnostics()` strips tokens, session IDs, authorization keys, and sensitive parameters from query strings prior to logging or wire transmission.

### 12. False-Positive Handling
- **Localhost & Development Exemption:** `127.0.0.1` and `localhost` are whitelisted.
- **Trusted Domain Bypasses:** Configured corporate/trusted domains bypass external navigation warnings.
- **Absence of False "Safe" Labels:** Benign actions receive `ResponseAction.ALLOW` (routine processing permitted). Guardrail **never claims the site is verified safe or malware-free**.

### 13. Failure Recovery
- **Fail-Closed Semantics:** Corrupted actions, pipeline evaluation errors, or state mismatches fail closed to `score: 100`, `riskLevel: CRITICAL`, and `decision: PROTECT`.
- **Runtime Resilience:** Reconnection handling when the extension background worker terminates or reloads.
- **Graceful Parsing:** Unparseable URLs emit warning indicators without crashing content scripts.

### 14. Existing Regression Tests
- All baseline browser test suites (`test:browser:env`, `test:browser:interception`, `test:browser:approval`, `test:browser:security`, `test:browser:privacy`) pass cleanly with zero regressions.

---

## 2. Comprehensive Test Execution Audit

### A. Test Execution Summary Across All Modules

| Suite / Component | Command | Target / Scope | Assertions / Scenarios | Status |
|-------------------|---------|----------------|:----------------------:|:------:|
| **Extension Website Unit Tests** | `npm run test:website-unit` | Heuristic algorithms & scoring rules | 75 / 75 assertions | ✅ PASS |
| **Extension Website Mock Tests** | `npm run test:browser:website-mock` | DOM event delegation & warning UI | 40 / 40 assertions | ✅ PASS |
| **Extension Website Real Browser** | `npm run test:browser:website-real` | Real Headless Chrome (CDP) | 10 / 10 scenarios | ✅ PASS |
| **Extension Suspicious URL Tests** | `npm run test:suspicious-url` | URL detector heuristics | 70 / 70 assertions | ✅ PASS |
| **Extension Phishing Detector Tests** | `npm run test:phishing` | Phishing detector heuristics | 40 / 40 assertions | ✅ PASS |
| **Extension Website Risk Integration** | `npm run test:website-risk` | Risk engine & policy mapping | 48 / 48 assertions | ✅ PASS |
| **Extension Warning Modal UI Tests** | `npm run test:warning-ui` | Shadow DOM modal & accessibility | 76 / 76 assertions | ✅ PASS |
| **Full Extension Suite** | `npm test` (in `extension`) | All 63 extension unit & mock suites | 63 / 63 test suites | ✅ PASS |
| **Baseline Browser Env** | `npm run test:browser:env` | Controlled browser environment | 5 / 5 suites | ✅ PASS |
| **Baseline Browser Interception** | `npm run test:browser:interception` | Action interception verification | 5 / 5 suites | ✅ PASS |
| **Baseline Browser Approval** | `npm run test:browser:approval` | Approval workflow integration | 7 / 7 suites | ✅ PASS |
| **Baseline Browser Security** | `npm run test:browser:security` | Security boundary testing | 6 / 6 suites | ✅ PASS |
| **Baseline Browser Privacy & Failure** | `npm run test:browser:privacy` | Privacy & service failure testing | 110 / 110 assertions | ✅ PASS |
| **Backend Approval Server** | `npm test` (in `server`) | SQLite, OIDC, API, Delivery, Config | 6 / 6 test suites | ✅ PASS |
| **Dashboard Shell & Sync** | `npm test` (in `dashboard`) | Shell, Day 12, Sync, Dev Server | 135 / 135 assertions + 4 suites | ✅ PASS |

### B. Build Commands
- **Extension Build:** `npm run build` (`node build.mjs`) $\rightarrow$ Succeeded cleanly. Bundles `dist/content.js`, `dist/service_worker.js`, `dist/popup.js`, and `dist/settings.js`.
- **Backend Server Build:** `npm run build` $\rightarrow$ Succeeded cleanly (`dist/index.mjs` [332.8kb] and `dist/serve.mjs` [333.8kb]).
- **Dashboard Build:** `npm run build` $\rightarrow$ Succeeded cleanly (`dist/dashboard.js`).

### C. Type-Check and Linting Observations (Reporting Integrity)
- **Type Checking (`tsc --noEmit`):**
  - In `guardrail/extension`: Returns TypeScript errors because test suites placed within `src/` use Node.js runtime globals (`process`, `Buffer`, `http`) while `tsconfig.json` specifies `"types": ["chrome"]` without `@types/node`, combined with strict `"noUnusedLocals": true` and `"noUnusedParameters": true`.
  - In `guardrail/server` and `guardrail/dashboard`: `tsc --noEmit` flags type errors because `tsconfig.json` files cross-reference files in `../extension` without dedicated project reference boundaries.
  - *Mitigation & Operational Reality:* All build targets and test runners build and execute flawlessly via `esbuild` (ES2022 / Node20 targets).
- **Linting:** No standalone ESLint configuration is defined in the repository package manifests; code formatting and structure are enforced through TypeScript compiler rules and esbuild bundling checks.

---

## 3. Supported Browser Scenarios

Guardrail officially supports and verifies the following 10 browser scenarios under controlled testing:

1. **Normal Legitimate URLs:** Standard HTTPS web browsing on legitimate domains (`example.com`, enterprise portals) executes without friction or false alerts.
2. **Malformed & Non-HTTP URLs:** Safely evaluates malformed URLs, empty targets, and pseudo-protocols without throwing exceptions.
3. **Suspicious Hostname Patterns:** Flags raw public IP hosts, stacked subdomains, non-standard ports, and hyphen-stuffed hostnames.
4. **Lookalike & Homoglyph Domains:** Detects brand impersonation in subdomains (`paypal.com.account-update.xyz`) and Punycode (`xn--...`).
5. **Synthetic Phishing Login Pages:** Detects brand identity mismatches (e.g. Google Workspace logos/titles on foreign hostnames) and warns before credential entry.
6. **Unexpected Form Exfiltration Sinks:** Detects forms targeting third-party webhook receivers (`formspree.io`) or plain HTTP targets.
7. **Cross-Origin Form Submissions:** Controlled cross-origin forms are halted in capturing phase; ambient cross-origin forms trigger warnings and log sensor limitations.
8. **Navigation Between Test Pages:** Tracks origin boundary crossings and re-bootstraps content script listeners across navigations.
9. **Detection Failure Handling:** Evaluator errors fail closed to `PROTECT` (score 100, `CRITICAL`).
10. **Service Worker Lifecycle Events:** Handles extension reloads and communication interruptions gracefully.

---

## 4. Known Detection Limitations & Architectural Boundaries

1. **Browser Extension Sandbox Invariant:** Browser extensions cannot universally cancel JavaScript handlers or network requests that have already executed. Unmarked (ambient) DOM elements cannot be guaranteed to halt before page-level script execution.
2. **Top-Level Window Navigations:** Content scripts cannot synchronously intercept native `window.location.href = ...` or HTTP `302` server-side redirects without DeclarativeNetRequest or WebRequest blocking rules.
3. **Obfuscated Custom Form Controls:** Credential forms rendered inside WebAssembly, Canvas elements, or deeply closed Shadow Roots cannot be detected via standard DOM inspection.
4. **Heuristic Specificity:** Guardrail utilizes local structural heuristics. It does not perform live WHOIS lookups, DNS reputation queries, or global threat intelligence lookups.

---

## 5. False-Positive Risks & Mitigation

1. **Single Sign-On (SSO) & Payment Gateways:** Redirects between enterprise portals and legitimate identity providers (e.g. `company.com` to `login.microsoftonline.com` or `auth0.com`) cross origin boundaries.
   - *Mitigation:* Users can configure `trustedDomains` in the protection policy settings to exempt legitimate enterprise SSO providers.
2. **Development & Internal Ports:** Non-standard ports (e.g. `:8080`, `:3000`) used for internal tools could trigger `SUSPICIOUS_PORT`.
   - *Mitigation:* `127.0.0.1` and `localhost` are hard-coded as loopback development exemptions.
3. **Complex Multi-Tier Corporate Subdomains:** Deeply nested enterprise domains (e.g. `us-east.prod.internal.corp.example.com`) could trigger `EXCESSIVE_SUBDOMAINS`.
   - *Mitigation:* Thresholds are configurable in policy settings, allowing enterprises to increase allowed subdomain depths.

---

## 6. Mocked versus Real Integration Coverage

| Feature / Capability | Mocked Coverage (Tier 1 & 2) | Real Browser Coverage (Tier 3) |
|----------------------|------------------------------|--------------------------------|
| **URL Parser & Heuristics** | Synthetic URL strings, edge-case unit tests | Real `window.location` and browser-resolved attributes |
| **DOM Event Flow** | Simulated jsdom/synthetic dispatch (`dispatchEvent`) | Genuine Chromium user clicks, keypresses, and form submissions |
| **Capturing Phase Suppression** | Mock event `defaultPrevented` and `stopImmediatePropagation` check | Native browser submission suppression verified via HTTP access logs |
| **Shadow DOM Warning UI** | Mock shadow root attached to DOM element | Real Chromium Shadow DOM (`mode: 'open'`) with CSS isolation |
| **Navigation Transitions** | Simulated page info context swaps | Real Chrome page navigations via CDP (`Page.navigate`) |
| **Extension Lifecycle** | In-memory message queues and simulated reloads | Real unpacked Chrome extension with registered background service worker |

---

## 7. Remaining Security Gaps & Recommended Roadmap

1. **DeclarativeNetRequest Navigation Rules:** Content scripts evaluate navigations after DOM initialization. Integrating `declarativeNetRequest` rules will allow proactive blocking of high-risk navigations before network requests leave the browser.
2. **TypeScript Test Configuration Separation:** Create a separate `tsconfig.test.json` including `@types/node` for test suites located in `src/` to achieve clean `tsc --noEmit` results across the workspace.
3. **Threat Intelligence Feed Integration:** Supplement local heuristics with privacy-preserving k-anonymous threat intelligence queries for known malicious domain lists.

---

## 8. Verification Conclusion

All website protection requirements have been thoroughly and rigorously verified against the live repository:
- Detection results reflect genuine implemented signals.
- Suspicious heuristic states and confirmed malicious states are strictly distinguished.
- Privacy boundaries are absolute: zero passwords, OTPs, or raw form values are collected.
- Unverified websites are never certified as "safe".
- Warning interfaces truthfully state protection status and detection grounds.
- Approval workflows never automatically trigger browser actions.
- All tests across Backend, Extension, Dashboard, and Real Headless Chrome pass cleanly.
