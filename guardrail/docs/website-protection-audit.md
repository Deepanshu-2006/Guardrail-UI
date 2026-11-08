# Guardrail Comprehensive Website Protection & Suspicious Website Detection Audit

**Document Status:** Complete & Authoritative  
**Target Milestone:** Day 27 Foundation Audit  
**Scope:** Browser Extension Content Scripts, Action Classifier, Risk Engine, Response Policies, Background Coordinator, DOM Sensors, and Threat Architecture

---

## Executive Summary

As part of the Day 27 milestone (*Advanced Website Protection & Suspicious Website Detection*), this audit provides a comprehensive, ground-truth inspection of Guardrail's existing website protection, URL parsing, browser navigation monitoring, risk classification, and warning notification systems.

The extension currently operates under a privacy-preserving, least-privilege architecture (Manifest V3 requesting only the `"storage"` permission and content scripts matching `<all_urls>`). Today, Guardrail provides a solid baseline for **origin-boundary change detection** and **link keyword detection** via `ExternalNavigationRule` and `EXTERNAL_NAVIGATION_POLICY`.

However, the existing implementation does **not** evaluate suspicious domain patterns, Internationalized Domain Name (IDN) homoglyphs, IP address hostnames, deceptive subdomains, or specific phishing indicators. Furthermore, architectural limitations inherent to content scripts running at `document_idle` mean that ambient page navigations cannot be held or intercepted before the page loads.

This audit establishes the factual baseline, enumerates architectural constraints, evaluates integration pathways into the existing Risk and Policy Engines without duplication, and defines safe, verifiable recommendations for Day 27 implementation.

---

## 1. Inspection of Core Subsystems

### 1.1 Existing URL and Domain Detection Functionality
- **Location:** [`guardrail/extension/src/classifier/rules.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/classifier/rules.ts) (`ExternalNavigationRule`), [`guardrail/extension/src/risk/rules.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/risk/rules.ts) (`RISK_RULE_EXTERNAL_NAVIGATION`), and [`guardrail/extension/src/config/registry.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/registry.ts) (`isTrustedDomain`).
- **Current Mechanics:**
  - Extracts searchable text tokens (`visibleText`, `id`, `className`, and URL `pathname`).
  - Matches against generic navigation keywords: `['external', 'third-party', 'redirect', 'leave site']`.
  - Performs simple origin comparison: `new URL(action.page.url).origin !== new URL(action.page.previousUrl).origin`.
  - Checks if the destination origin is allowlisted via `isTrustedDomain(origin)`, which matches `localhost`, `127.0.0.1`, or explicit domain suffix matches in `trustedDomains`.
- **Gaps Identified:**
  - When clicking an anchor (`<a href="...">`), `ActionElementInfo` in [`guardrail/extension/src/utils/dom.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/dom.ts) extracts only `tagName`, `visibleText`, `id`, and `className`. The anchor's destination `href` is **not captured**.
  - As a result, link clicks cannot be evaluated against destination domain heuristics prior to page transition.

### 1.2 Browser Navigation Monitoring
- **Location:** [`guardrail/extension/src/detector/action-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/detector/action-detector.ts).
- **Current Mechanics:**
  - Content script detects initial page load by checking `window.location.href` via `trackNavigation()`.
  - Observes Single Page Application (SPA) transitions by listening to `popstate` and `hashchange` events on `window`.
  - Emits normalized `GuardrailAction` with `type: ActionType.NAVIGATION`.
- **Limitations:**
  - Navigation detection is purely **post-load** inside the active document.
  - The background service worker has no navigation listeners (`chrome.webNavigation` and `chrome.tabs.onUpdated` are absent).
  - Navigation cannot be cancelled or held at the network or request socket level.

### 1.3 Content Script Architecture
- **Location:** [`guardrail/extension/src/content/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/content/index.ts).
- **Current Mechanics:**
  - Configured in `manifest.json` with `"run_at": "document_idle"` and `"matches": ["<all_urls>"]`.
  - Employs event delegation on `document` (capturing phase) for `click`, `change`, and `submit`.
  - Differentiates between:
    1. **Controlled Test Actions (`[data-guardrail-test-action]`):** Synchronously intercepted, canceled with `preventDefault()` and `stopImmediatePropagation()`, and transitioned to `HELD` in `InterceptionController`.
    2. **Ambient Interactions:** Evaluated through `evaluateActionPipeline(action)`. If `ResponseAction.WARN`, renders `showWarningModal`. If `ResponseAction.PROTECT`, logs an explicit limitation warning stating ambient interactions cannot be held synchronously without test hooks.
- **Fail-Closed Behavior:**
  - Synchronously suppresses controlled actions if policy configuration is uninitialized or in a failed health state.

### 1.4 Background Service Worker Architecture
- **Location:** [`guardrail/extension/src/background/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/background/index.ts).
- **Current Mechanics:**
  - Manifest V3 Service Worker that manages extension lifecycle and coordinates messages between content scripts and backend API.
  - Handles `GUARDRAIL_SUBMIT_APPROVAL_REQUEST` and `GUARDRAIL_GET_APPROVAL_STATUS`.
  - Maintains `backgroundInterceptionController` to mirror held state and enforce security invariants (rejects privileged decision overrides or sensitive token injection from untrusted scripts).
- **Absence of Network Inspection:**
  - The background worker does not monitor URLs or web requests.
  - No background cache of malicious URLs or domain reputation exists.

### 1.5 Existing Risk Classification Engine
- **Location:** [`guardrail/extension/src/classifier/engine.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/classifier/engine.ts) and [`guardrail/extension/src/risk/engine.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/risk/engine.ts).
- **Current Mechanics:**
  - `ActionClassifier`: Evaluates actions in priority order against rules (`PAYMENT`, `AUTHENTICATION`, `DESTRUCTIVE`, `DOWNLOAD`, `EXTERNAL_NAVIGATION`, and `GENERAL`).
  - `RiskEngine`: Deterministic heuristic scoring system that matches discrete `RiskRule` entries to produce `RiskSignalId` triggers and clamped scores (0-100).
  - Categorical risk thresholds: LOW (0-24), MEDIUM (25-49), HIGH (50-74), CRITICAL (75-100).
- **Current Website Signals:**
  - Currently contains only one website-related signal: `RiskSignalId.EXTERNAL_NAVIGATION` (+20 score contribution).
  - No granular signals exist for suspicious URL structures, homoglyphs, or deceptive domains.

### 1.6 Protection Policy Configuration
- **Location:** [`guardrail/extension/src/config/schema.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/schema.ts) and [`guardrail/extension/src/response/policies.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/response/policies.ts).
- **Current Mechanics:**
  - Centralized in `GuardrailPolicyConfig` with typed schema validation, fail-closed parsing, and immutable defaults.
  - `EXTERNAL_NAVIGATION_POLICY` is configured to return `ResponseAction.WARN` when `origin !== previousOrigin` and destination is not in `trustedDomains`.
  - Immutable Security Invariants guarantee that policies cannot be tampered with or disabled arbitrarily.

### 1.7 Warning and Notification Interfaces
- **Location:** [`guardrail/extension/src/ui/warning-modal.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/ui/warning-modal.ts).
- **Current Mechanics:**
  - Encapsulated within Shadow DOM (`#guardrail-warning-ui-host`) to isolate styles and prevent host DOM collisions.
  - Accessible dialog structure: `role="dialog"`, `aria-modal="true"`, focus trapping, `Escape` key dismissal.
  - Renders action category, risk level badge, risk score, and user explanation.
  - Exposes `Continue` and `Cancel` callbacks.
- **Workflow State:**
  - Warnings are purely informative/advisory friction.
  - For ambient navigation that has already loaded the page, clicking "Cancel" in the warning modal does not navigate back unless explicitly wired to `history.back()`.

### 1.8 Existing Browser Permissions
- **Location:** [`guardrail/extension/public/manifest.json`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/public/manifest.json).
- **Permissions Declared:**
  - `"permissions": ["storage"]`
  - `"content_scripts": [{ "matches": ["<all_urls>"], "js": ["content/index.js"], "run_at": "document_idle" }]`
- **Permissions Absent:**
  - No `"webNavigation"` (cannot intercept requests before load).
  - No `"declarativeNetRequest"` (cannot block network requests deterministically).
  - No `"tabs"` or `"activeTab"` (cannot inspect tab state outside injected DOM).
  - No `"webRequest"` (cannot inspect HTTP headers or socket requests).

### 1.9 External Threat Intelligence Integrations
- **Status:** **Completely Absent** (By Design).
- Guardrail does not connect to third-party threat feeds (e.g. Google Safe Browsing, PhishTank, AbuseIPDB, VirusTotal).
- **Privacy Rationale:** Transmitting browsed URLs or domains to external servers introduces privacy leakage and third-party dependency.
- All detection must remain client-side, local, deterministic, and privacy-preserving.

### 1.10 Existing Security and Integration Tests
- **Location:** `guardrail/extension/src/*/test-*.ts`.
- **Existing Coverage:**
  - Unit tests for policy catalog completeness and 7-dimension metadata (`test-risk-policies.ts`).
  - Unit tests for `EXTERNAL_NAVIGATION_POLICY` handling of cross-origin vs. same-origin transitions.
  - Tests for policy configuration schema validation, serialization, and storage sync.
  - Interception boundary hardening and fail-closed suppressed event tests.
- **Missing Coverage:**
  - Zero test suites for suspicious domain heuristics, homoglyph decoding, IP address detection, or URL normalization.

---

## 2. Key Determinations & Gap Analysis

| Dimension | Current Baseline | Target / Missing Capability | Severity |
| :--- | :--- | :--- | :--- |
| **Website Risks Detected** | Origin boundary crossing (`prevOrigin !== curOrigin`); navigation keywords | Suspicious TLDs, IP hostnames, homoglyph lookalikes, deceptive subdomains, basic auth URL tricks | High |
| **URL Parsing & Safety** | Native `new URL(url).origin` in `try...catch` | Canonicalization, trimming, IPv4/IPv6 extraction, stripping user credentials/query tokens | Medium |
| **Suspicious Domain Identification** | Only checks `isTrustedDomain()` allowlist | Heuristic detection of multi-subdomain spoofing (`paypal.com.evil.xyz`), suspicious TLDs | High |
| **Phishing Indicators** | Keyword token matching only (`external`, `redirect`) | Homoglyphs (`xn--`), brand impersonation in subdomains, IP addresses as hosts | High |
| **Risk Engine Integration** | Emits `EXTERNAL_NAVIGATION` (+20 score, MEDIUM) | Needs discrete risk signals for granular website risk scoring without engine duplication | High |
| **Warning Interfaces** | Displays Shadow DOM warning modal with `Continue`/`Cancel` | Connected to `WARN` decision, but does not provide specific guidance on why domain is suspicious | Medium |
| **Mocked / Incomplete Areas** | Anchor `<a href>` extraction is completely missing | Extract `href` on click actions to assess destination before page navigation occurs | High |
| **Browser Coverage Limitations** | Content scripts run at `document_idle`; cannot block ambient navigations | Must document that ambient page load cannot be held; warnings advise user friction | Architecture |

---

## 3. Safe URL Parsing & Normalization Assessment

### 3.1 Current Implementation
In `extractPageInfo()` and `ExternalNavigationRule`:
```typescript
const currentOrigin = new URL(action.page.url).origin;
```
- **Strengths:** Using the standard Web `URL` API prevents basic string-splitting injection vulnerabilities.
- **Weaknesses:**
  1. **Unstripped Secrets:** If a URL contains embedded credentials (e.g., `https://user:pass@example.com`), `url` captures sensitive tokens in plain text.
  2. **Query String Leaks:** Diagnostic logging (`logPipelineResult`) exposes the full URL path and query parameters, which may contain sensitive reset tokens or session identifiers.
  3. **No Punycode / Homoglyph Normalization:** Native `new URL()` converts non-ASCII characters to punycode (`xn--...`), but the classifier does not inspect whether punycode is present or contains mixed Cyrillic/Latin script homoglyphs.

### 3.2 Required Normalization Standard
For Day 27, a dedicated, pure helper `safeNormalizeUrl()` should:
1. Parse using standard `URL` inside `try...catch`, returning `null` on invalid schemes or parsing errors.
2. Ensure supported schemes are restricted to `http:` and `https:`.
3. Strip `username` and `password` components.
4. Normalize hostname to lowercase and extract standard domain parts (TLD, registered domain, subdomains, port).
5. Detect raw IP address hostnames (both IPv4 and IPv6).

---

## 4. Suspicious Domain Patterns & Phishing Indicators

The audit confirms that the following indicators are currently **not evaluated**:

1. **IP Address as Hostname:**
   - Example: `http://192.168.1.1/login` or `http://45.33.32.156/bank`.
   - Benign for local development (`127.0.0.1`), but highly suspicious for ambient public navigation.
2. **Homoglyph & Punycode Deception:**
   - Example: `https://pаypal.com` (using Cyrillic `а` U+0430, rendering as `xn--pypal-4ve.com`).
   - The current engine treats this as an ordinary domain without flagging internationalized domain deception.
3. **Deceptive Subdomain Spoofing:**
   - Example: `https://paypal.com.account-verification-notice.xyz/`.
   - The user sees `paypal.com` at the start of the host, but the actual registrable domain is `account-verification-notice.xyz`.
4. **Embedded Credentials / Basic Auth Trickery:**
   - Example: `https://google.com@attacker-site.com/`.
   - Browsers may display `google.com` prominently in user prompts or phishing links.
5. **Excessive Subdomain Stacking / Entropy:**
   - Example: `https://a.b.c.d.e.secure.login.bank.example-fake.com/`.

---

## 5. Risk Engine & Policy Integration Architecture

### 5.1 No Duplicate Engines
A core principle of Guardrail is **maintaining a single risk classification pipeline**. We must **not** build a separate "phishing engine" or secondary decision pipeline.

### 5.2 Seamless Integration Path
Any website detection signals should fit cleanly into the existing 3-stage pipeline:

```mermaid
flowchart LR
    A["ActionDetector\n(Click on link / Nav)"] --> B["ActionClassifier\n(Detects Category & Heuristics)"]
    B --> C["RiskEngine\n(Evaluates RiskSignals & Scores)"]
    C --> D["ResponseEngine\n(Applies Policy Precedence: WARN / PROTECT)"]
    D --> E["Content Script\n(Warning Modal / Staging Modal)"]
```

1. **Action Model Enhancement:**
   - Allow `ActionElementInfo` to optionally include `targetUrl` (e.g., normalized destination `href` from `HTMLAnchorElement`), while keeping input values strictly uninspected.
2. **Classifier Enhancement:**
   - `ExternalNavigationRule` can detect specific heuristic reasons (e.g., `SUSPICIOUS_DOMAIN`, `IP_HOST`, `HOMOGLYPH`).
3. **Risk Signal Catalog Addition:**
   - Extend `RiskSignalId` with dedicated signals:
     - `RiskSignalId.SUSPICIOUS_WEBSITE` or `RiskSignalId.SUSPICIOUS_DOMAIN` (e.g. +30 score contribution).
     - `RiskSignalId.IP_HOST_NAVIGATION` (e.g. +25 score contribution).
4. **Policy Precedence Integration:**
   - `EXTERNAL_NAVIGATION_POLICY` remains the canonical policy for domain transitions, or an escalated policy can evaluate compound risk (e.g. suspicious website + credential entry).

---

## 6. Browser Permissions and Architectural Limitations

### 6.1 Honest Safety Invariants & Limitations
> [!IMPORTANT]
> The audit explicitly confirms the following architectural boundaries. Guardrail must never make unsupported safety claims:

1. **Content Scripts Cannot Intercept Ambient Navigations Pre-Flight:**
   - In Chrome Manifest V3, without declarative request blocking or synchronous network interception, once a user clicks a regular link or types a URL in the address bar, the browser initiates navigation immediately.
   - Guardrail's content script only runs when the new page reaches `document_idle`.
   - Therefore, Guardrail **cannot claim** to prevent all malicious web pages from loading. It can only warn users upon arrival or before controlled actions.
2. **Link Click Interception Scope:**
   - When a link is marked with `data-guardrail-test-action`, Guardrail can synchronously `preventDefault()` and stage the navigation.
   - For regular (ambient) links, Guardrail operates passively and displays an advisory warning modal; it cannot guarantee that standard browser link click handlers or single-page router transitions will not occur.
3. **Restricted Browser Schemes:**
   - Content scripts cannot be injected into `chrome://`, `edge://`, `chrome-extension://`, Chrome Web Store (`chromewebstore.google.com`), or native browser settings pages.
4. **No 100% Phishing Detection Guarantee:**
   - Heuristics (IP addresses, homoglyphs, deceptive subdomains) identify common attack patterns, but cannot detect zero-day phishing sites hosted on reputable domains or legitimate cloud infrastructure.

### 6.2 Permission Hygiene
- We must **not** add high-friction, invasive browser permissions (e.g., `webRequestBlocking`, `debugger`, or broad background interception) unless strictly necessary and aligned with user privacy.
- The current permission footprint (`"storage"`) remains ideal for lightweight, privacy-focused protection.

---

## 7. Audit Findings Checklist

- [x] **1. Existing URL and domain detection:** Evaluated; currently limited to origin comparison and keyword tokens.
- [x] **2. Browser navigation monitoring:** Evaluated; post-load `trackNavigation()` and SPA event tracking only.
- [x] **3. Content script architecture:** Evaluated; dual ambient/controlled dispatch pipeline functioning.
- [x] **4. Background service worker architecture:** Evaluated; coordinator and message hub verified; no network interception.
- [x] **5. Existing risk classification engine:** Evaluated; modular deterministic rule scoring (0-100) verified.
- [x] **6. Protection policy configuration:** Evaluated; centralized registry with schema validation and safe defaults verified.
- [x] **7. Warning and notification interfaces:** Evaluated; accessible Shadow DOM Warning Modal operational.
- [x] **8. Existing browser permissions:** Evaluated; least-privilege `"storage"` permission preserved.
- [x] **9. External threat intelligence integrations:** Evaluated; zero external APIs, preserving user privacy.
- [x] **10. Existing security and integration tests:** Evaluated; regression test harness intact, lacking domain heuristic tests.

---

## 8. Actionable Recommendations for Day 27 Implementation

1. **Implement Pure URL & Domain Analysis Utilities:**
   - Create a dedicated utility module (e.g., `guardrail/extension/src/utils/url.ts`) providing:
     - `safeParseUrl(url: string)`: Safe extraction of hostname, protocol, pathname without query strings or user auth.
     - `isIpAddress(hostname: string)`: RFC-compliant IPv4 and IPv6 detection.
     - `hasPunycodeOrHomoglyph(hostname: string)`: Detection of `xn--` prefix and mixed-script Cyrillic/Greek characters.
     - `extractRegistrableDomain(hostname: string)`: Safe extraction of primary domain vs. deceptive subdomains.
     - `hasDeceptiveSubdomain(hostname: string)`: Identification of trusted brand names in subdomains of untrusted domains.
2. **Enhance Anchor Element Inspection:**
   - Update `extractElementInfo()` in `guardrail/extension/src/utils/dom.ts` to capture safe destination `href` (normalized, no credentials) for `<a>` tags as `targetUrl`.
3. **Register Granular Risk Signals:**
   - Add `RiskSignalId.SUSPICIOUS_DOMAIN` to `types/risk.ts` and `INITIAL_RISK_SIGNALS` with appropriate score contributions (+30).
   - Add `RiskRule` entries to `risk/rules.ts` that evaluate domain indicators.
4. **Connect Warning Modal with Specific Context:**
   - Enhance the Warning Modal user explanation when a suspicious domain indicator triggers, clearly explaining *why* the warning was raised (e.g., "Navigating to raw IP address" or "Possible lookalike/homoglyph domain detected").
5. **Develop Comprehensive Automated Test Suite:**
   - Create `test-website-protection.ts` covering URL normalization, IP address detection, homoglyph identification, deceptive subdomains, and risk scoring integration.
