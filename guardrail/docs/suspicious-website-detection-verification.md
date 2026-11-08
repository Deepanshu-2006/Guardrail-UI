# Guardrail Suspicious Website & URL Detection Verification Report

**Status:** Completed & Verified  
**Milestone:** Advanced Website Protection & Suspicious Website Detection  
**Component:** Browser Extension URL Analyzer, Classifier Rules, Risk Engine, and Response Policies  

---

## 1. Overview & Objectives

We enhanced the existing extension architecture with safe, standards-compliant, local, and privacy-preserving suspicious URL and hostname detection.

The objectives achieved:
1. **Standards-Compliant Parsing & Safe Normalization:** RFC-compliant URL component extraction with automatic stripping of sensitive credentials (`username:password`) and tokenized query parameters.
2. **Deceptive & Lookalike Hostname Identification:** Heuristics to detect homoglyphs, Punycode (`xn--`), mixed Cyrillic/Greek character sets, and hyphen-stuffed domains.
3. **Raw IP Address Hostname Detection:** Identifies IPv4 and IPv6 public hostnames while exempting local loopback development (`localhost`, `127.0.0.1`, `::1`).
4. **URL Credential & Authority Deception:** Detects user-info deception (`https://google.com@evil.com`) and basic auth credentials in the URL authority section.
5. **Subdomain Stacking & Brand Impersonation:** Recognizes multi-level public suffixes (`.co.uk`) and distinguishes genuine brand domains (`www.paypal.com`) from deceptive brand subdomains on untrusted registrable domains (`paypal.com.account-update.xyz`).
6. **Double URL Encoding & Path Traversal:** Identifies double percent-encoded characters (`%252e%252e`) and traversal attempts.
7. **End-to-End Pipeline Integration:** Plugs directly into the existing `ActionClassifier` $\rightarrow$ `RiskEngine` $\rightarrow$ `ResponseEngine` pipeline via `RiskSignalId.SUSPICIOUS_URL` without introducing duplicate engines or external APIs.

---

## 2. Architecture & File Changes

```mermaid
flowchart TD
    A["DOM Link Click / Navigation\n(ActionDetector & extractElementInfo)"] --> B["ActionClassifier\n(RULE_EXTERNAL_NAVIGATION)"]
    B --> C["RiskEngine\n(RISK_RULE_SUSPICIOUS_URL)"]
    C --> D["ResponseEngine\n(EXTERNAL_NAVIGATION_POLICY)"]
    D --> E["Warning Modal\n(Advisory Context: POLICY_WARN_SUSPICIOUS_URL)"]

    subgraph URL Detector ["url-detector.ts"]
        U1["normalizeUrlComponents()"]
        U2["isIpv4Address() / isIpv6Address()"]
        U3["extractDomainParts() (ccTLD aware)"]
        U4["evaluateSuspiciousUrl()"]
    end

    B -.-> URL Detector
    C -.-> URL Detector
```

### Key Files Modified & Created:
1. [`guardrail/extension/src/utils/url-detector.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/url-detector.ts):
   - Pure, standalone detection engine evaluating 11 discrete indicator codes (`SuspiciousUrlIndicatorCode`).
   - Normalizes components and calculates bounded score (0 to 100).
2. [`guardrail/extension/src/types/actions.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/types/actions.ts):
   - Extended `ActionElementInfo` with optional `targetUrl?: string` for actionable links.
3. [`guardrail/extension/src/utils/dom.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/dom.ts):
   - Safely extracts sanitized `targetUrl` on anchor elements (`<a>` tags) without live DOM bindings or form values.
4. [`guardrail/extension/src/types/risk.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/types/risk.ts):
   - Added canonical `RiskSignalId.SUSPICIOUS_URL` to enum and string union.
5. [`guardrail/extension/src/config/schema.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/schema.ts):
   - Registered `DEFAULT_SIGNAL_SETTINGS[RiskSignalId.SUSPICIOUS_URL]` (score contribution: +25, enabled: true).
6. [`guardrail/extension/src/risk/signals.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/risk/signals.ts):
   - Defined baseline description and explanation for `INITIAL_RISK_SIGNALS[RiskSignalId.SUSPICIOUS_URL]`.
7. [`guardrail/extension/src/risk/rules.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/risk/rules.ts):
   - Added deterministic `RISK_RULE_SUSPICIOUS_URL` with priority 75 and score contribution +25.
8. [`guardrail/extension/src/classifier/rules.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/classifier/rules.ts):
   - Enhanced `ExternalNavigationRule` to evaluate `action.element.targetUrl` and suspicious URL indicators.
9. [`guardrail/extension/src/response/policies.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/response/policies.ts):
   - Enhanced `EXTERNAL_NAVIGATION_POLICY` to handle `RISK_RULE_SUSPICIOUS_URL` and emit `POLICY_WARN_SUSPICIOUS_URL` with contextual advisory explanations.
10. [`guardrail/extension/src/utils/test-suspicious-url-detection.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/utils/test-suspicious-url-detection.ts):
    - Comprehensive 10-group verification suite covering 89 automated test assertions.

---

## 3. Test Verification Results

The automated test suite was executed via `npm run test:suspicious-url`:

```
======================================================================
🧪 GUARDRAIL SUSPICIOUS URL & HOSTNAME DETECTION TEST SUITE
======================================================================

▶ Group 1: Safe Standards-Compliant Parsing & Normalization (12/12 passed)
  ✓ Parses standard HTTPS URL successfully
  ✓ Extracts lowercase protocol
  ✓ Normalizes hostname to lowercase
  ✓ Preserves pathname
  ✓ Strips query string and hash from normalized URL
  ✓ Strips trailing FQDN dot from hostname
  ✓ Parses URL containing credentials
  ✓ Normalized URL completely strips embedded username and password
  ✓ Extracts registrable domain for 1-level TLD
  ✓ Extracts subdomains in order
  ✓ Extracts registrable domain for 2-level ccTLD .co.uk
  ✓ Extracts subdomains for multi-level TLD

▶ Group 2: Invalid, Malformed, and Unsupported Scheme URLs (7/7 passed)
  ✓ Flags javascript: scheme as suspicious
  ✓ Emits INVALID_OR_MALFORMED_URL indicator for javascript: scheme
  ✓ Flags data: scheme as suspicious
  ✓ Emits INVALID_OR_MALFORMED_URL indicator for data: scheme
  ✓ Flags unparseable string as suspicious
  ✓ Emits INVALID_OR_MALFORMED_URL for garbage input
  ✓ Flags empty URL string

▶ Group 3: IP Address Hostnames & Localhost Exemption (14/14 passed)
  ✓ Identifies standard IPv4 address
  ✓ Identifies public IPv4 address
  ✓ Rejects standard domain name as IPv4
  ✓ Identifies bracketed IPv6 address
  ✓ Identifies raw IPv6 address
  ✓ Identifies localhost as local
  ✓ Identifies 127.0.0.1 as local
  ✓ Identifies ::1 as local
  ✓ Recognizes public IP as non-local
  ✓ Flags public IPv4 hostname as suspicious
  ✓ Emits IP_ADDRESS_HOSTNAME indicator
  ✓ Localhost is NOT flagged as suspicious
  ✓ Localhost score is 0
  ✓ 127.0.0.1 loopback is NOT flagged as suspicious

▶ Group 4: URL Credentials & Deceptive User-Info Authority Tricks (4/4 passed)
  ✓ Flags authority deception (@ trick) as suspicious
  ✓ Emits DECEPTIVE_USERINFO_AUTH indicator
  ✓ Flags embedded basic auth credentials
  ✓ Emits EMBEDDED_CREDENTIALS indicator

▶ Group 5: Deceptive Subdomain & Brand Spoofing (6/6 passed)
  ✓ Flags brand name in subdomain on unrelated domain
  ✓ Emits DECEPTIVE_SUBDOMAIN indicator for paypal.com spoof
  ✓ Flags apple-login subdomain on unrelated domain
  ✓ Emits DECEPTIVE_SUBDOMAIN indicator for apple-login prefix
  ✓ Legitimate www.paypal.com is NOT flagged as deceptive subdomain
  ✓ Legitimate login.microsoft.com is NOT flagged as deceptive subdomain

▶ Group 6: Subdomain Stacking & Hyphen Stuffing (5/5 passed)
  ✓ Flags 4+ subdomain stacking
  ✓ Emits EXCESSIVE_SUBDOMAINS indicator
  ✓ Legitimate Azure CDN deep subdomain is exempted from excessive stacking
  ✓ Flags hostname with 3+ hyphens and auth keywords
  ✓ Emits HYPHEN_STUFFED_HOSTNAME indicator

▶ Group 7: Unicode, Punycode & Homoglyph Attacks (5/5 passed)
  ✓ Flags punycode domain (xn--) as suspicious
  ✓ Emits PUNYCODE_OR_HOMOGLYPH for xn-- domain
  ✓ Flags mixed-script Cyrillic homoglyph
  ✓ Emits PUNYCODE_OR_HOMOGLYPH for raw Unicode Cyrillic character
  ✓ Standard Latin domain is not flagged as homoglyph

▶ Group 8: Suspicious URL Encoding, High-Risk TLDs & Ports (5/5 passed)
  ✓ Flags double percent-encoding
  ✓ Emits DOUBLE_URL_ENCODING indicator
  ✓ Flags high-risk TLD (.top) combined with sensitive terms
  ✓ Emits HIGH_RISK_TLD_KEYWORD indicator
  ✓ Emits SUSPICIOUS_PORT for port 1337

▶ Group 9: False-Positive Resilience across Legitimate Websites (21/21 passed)
  ✓ Google Search (https://www.google.com/search?q=guardrail+ui) -> clean, score: 0
  ✓ Microsoft Online OAuth (https://login.microsoftonline.com/common/oauth2/v2.0/authorize) -> clean, score: 0
  ✓ BBC UK news article (https://news.bbc.co.uk/world/article) -> clean, score: 0
  ✓ CDN with @ in pathname (https://cdn.jsdelivr.net/npm/package@1.2.3/dist/index.js) -> clean, score: 0
  ✓ Vite dev server on localhost (http://localhost:5173/dashboard) -> clean, score: 0
  ✓ Local node app on 127.0.0.1 (http://127.0.0.1:3000/app) -> clean, score: 0
  ✓ GitHub repository path (https://github.com/facebook/react/issues/1234) -> clean, score: 0

▶ Group 10: End-to-End Pipeline Integration (10/10 passed)
  ✓ Classifier assigns EXTERNAL_NAVIGATION for suspicious destination targetUrl
  ✓ Risk engine matches RISK_RULE_SUSPICIOUS_URL
  ✓ Computed risk score is elevated: 45 (>= 25)
  ✓ RiskLevel evaluates to MEDIUM
  ✓ Policy evaluation yields advisory WARN decision
  ✓ Emits POLICY_WARN_SUSPICIOUS_URL reason code
  ✓ Policy explanation provides clear user advisory context
  ✓ Yields WARN for deceptive subdomain click
  ✓ Triggers SUSPICIOUS_URL risk signal on deceptive brand subdomain
  ✓ Privacy Invariant: Pipeline output contains no unredacted secret credentials

======================================================================
Results: 89 passed, 0 failed across all 10 test groups
======================================================================
```

---

## 4. Security & Privacy Invariants Upheld

1. **Zero URL Execution / Passive Evaluation:** URLs are evaluated as static strings using standards-based parsing. No network sockets or fetches are initiated.
2. **Zero History / Query String Leakage:** Passwords, authentication tokens, and query strings are stripped from `normalizedUrl` during normalization.
3. **No Unwarranted Malice Claims:** Detections are labeled as heuristic risk signals (`RiskSignalId.SUSPICIOUS_URL`) and advisory warnings (`ResponseAction.WARN`), never claiming confirmed malware or fraudulent attribution.
4. **Localhost & Development Exemption:** Local development servers (`localhost`, `127.0.0.1`, `::1`) are preserved and cleanly exempted from IP hostname flags.
5. **No Duplicate Engines or Heavy Permissions:** Built entirely into the existing pipeline without requiring additional Chrome permissions beyond `"storage"`.
