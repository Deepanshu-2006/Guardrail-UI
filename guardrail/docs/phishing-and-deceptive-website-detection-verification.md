# Guardrail Phishing & Deceptive Website Detection Verification Report

**Status:** Completed & Verified  
**Milestone:** Phishing & Deceptive Website Detection  
**Component:** Browser Extension Heuristic Phishing Detector, Structural DOM Sensors, Risk Engine, and Response Policies  

---

## 1. Overview & Objectives

Building on the suspicious URL and hostname detection engine, we have implemented comprehensive heuristic detection for phishing, deceptive websites, and unauthorized credential harvesting in Guardrail UI.

The system evaluates multi-indicator DOM and transport characteristics without accessing, logging, or transmitting user-entered values or credentials.

### Key Objectives Achieved:
1. **Website Identity Inconsistency Detection:** Detects deceptive brand claims in visible document titles or meta tags (`og:site_name`, `application-name`) that conflict with the actual hosting registrable domain (e.g. PayPal, Microsoft, Apple, Google, Chase Bank, Bank of America).
2. **Deceptive Asset & Favicon Origin Tracking:** Identifies websites loading official brand icons or CDN assets while hosted on unrelated domains.
3. **Insecure Login Context & Transport Downgrade:** Flags credential entry forms (`input[type="password"]`) presented on unencrypted `http:` page contexts or non-secure contexts.
4. **IP-Hosted Login Portals:** Detects credential entry forms hosted on raw public IPv4/IPv6 addresses while preserving exemptions for local loopback development (`localhost`, `127.0.0.1`, `::1`).
5. **Suspicious Form Submission Destinations:** Detects forms targeting pseudo-protocols (`javascript:`, `data:`, `about:blank`) or third-party data collection / webhook exfiltration endpoints (`formspree.io`, `formsubmit.co`, `discord.com/api/webhooks`, `telegram.org`, `webhook.site`, `pipedream.net`).
6. **Unexpected Cross-Origin Credential Submission:** Flags credential forms submitting across domain boundaries to unrelated registrable domains while exempting recognized federated SSO providers (`accounts.google.com`, `login.microsoftonline.com`, `appleid.apple.com`, `auth0.com`, `okta.com`, etc.) and enterprise trusted domains.
7. **Strict Privacy Invariant:** Zero access to `input.value`, passwords, or credit card numbers. Sensors inspect only structural metadata (input types, form action URLs, document title).
8. **Multi-Indicator Corroboration:** Routine login forms on legitimate HTTPS sites trigger 0 indicators and produce score 0. Single weak signals do not trigger a phishing verdict.
9. **Heuristic Transparency:** Explicitly labels findings with `HEURISTIC_` codes and attaches an architectural disclaimer clarifying that findings are local heuristic signals, not verified external threat intelligence.

---

## 2. Architecture & File Changes

```
guardrail/extension/src/
├── types/
│   ├── actions.ts              <- Enhanced ActionElementInfo and ActionPageInfo with structural metadata
│   └── risk.ts                 <- Added RiskSignalId.PHISHING_INDICATOR and string union
├── utils/
│   ├── dom.ts                  <- Value-free extraction of formAction, formMethod, hasPasswordField, isSecureContext, faviconUrl
│   ├── phishing-detector.ts    <- Multi-indicator Phishing & Deceptive Website Detection Engine
│   ├── test-phishing-detector.ts <- 10 test suites covering 60 automated assertions
│   └── index.ts                <- Barrel export for phishing-detector
├── config/
│   └── schema.ts               <- Registered DEFAULT_SIGNAL_SETTINGS for PHISHING_INDICATOR (+35 score weight)
├── risk/
│   ├── signals.ts              <- Registered INITIAL_RISK_SIGNALS[PHISHING_INDICATOR]
│   ├── engine.ts               <- Mapped PHISHING_INDICATOR severity to RiskLevel.HIGH
│   └── rules.ts                <- Added RISK_RULE_PHISHING_INDICATOR (priority 85)
├── classifier/
│   └── rules.ts                <- Enhanced AuthenticationRule and PaymentRule with structural credential checks
└── response/
    └── policies.ts             <- Integrated RISK_RULE_PHISHING_INDICATOR into advisory policies
```

---

## 3. Heuristic Indicator Codes

| Code | Category | Score Weight | Description |
| :--- | :--- | :---: | :--- |
| `HEURISTIC_BRAND_IDENTITY_MISMATCH` | `IDENTITY` | +35 | Page branding claims identity of a recognized brand on an unrelated domain. |
| `HEURISTIC_DECEPTIVE_ASSET_ORIGIN` | `IDENTITY` | +20 | Website loads brand icon from official brand CDN on unrelated host. |
| `HEURISTIC_DECEPTIVE_HOSTNAME_PATTERN` | `DOMAIN_NAMING` | +35 | Domain displays deceptive brand subdomains, lookalikes, or Punycode. |
| `HEURISTIC_INSECURE_LOGIN_CONTEXT` | `INSECURE_TRANSPORT` | +40 | Password input field on unencrypted cleartext HTTP context. |
| `HEURISTIC_IP_HOSTED_LOGIN` | `LOGIN_CONTEXT` | +40 | Credential form hosted directly on raw public IP address. |
| `HEURISTIC_UNEXPECTED_CREDENTIAL_FIELD` | `IDENTITY` | +30 | Password field present on domain displaying conflicting brand identity. |
| `HEURISTIC_CROSS_ORIGIN_CREDENTIAL_SUBMISSION` | `FORM_DESTINATION` | +40 | Password form submits cross-domain to an unrelated third party. |
| `HEURISTIC_DATA_EXFILTRATION_ENDPOINT` | `FORM_DESTINATION` | +45 | Form targets webhook or form collector (Formspree, Discord, Telegram). |
| `HEURISTIC_INSECURE_CREDENTIAL_TRANSMISSION` | `INSECURE_TRANSPORT` | +35 | Password form on HTTPS submits to unencrypted HTTP endpoint. |
| `HEURISTIC_SUSPICIOUS_FORM_ACTION` | `FORM_DESTINATION` | +35 | Form action targets `javascript:` or `data:` pseudo-protocols. |

---

## 4. Verification Test Results

### Phishing Detection Test Suite (`test-phishing-detector.ts`)
- **Group 1: Benign Legitimate Portals (Zero False Positives):** 11/11 passed (PayPal, Microsoft, Google, GitHub, routine enterprise portals score 0).
- **Group 2: Website Identity Inconsistencies & Misleading Branding:** 7/7 passed (spoofed PayPal, Apple ID, brand CDN assets).
- **Group 3: Insecure Login Context & Transport Downgrade:** 4/4 passed (HTTP password input, mixed-content submission).
- **Group 4: IP-Hosted Login Portals & Localhost Exemption:** 6/6 passed (public IP flagged; `localhost`, `127.0.0.1` preserved).
- **Group 5: Deceptive Domain Naming & Lookalike Targets:** 5/5 passed (brand subdomain stacking, Punycode homoglyphs).
- **Group 6: Suspicious Form Destinations & Data Exfiltration:** 5/5 passed (`javascript:`, Formspree, Discord webhooks).
- **Group 7: Cross-Origin Credential Submission vs Legitimate SSO:** 4/4 passed (unrelated cross-origin flagged; Google SSO & trusted domains exempted).
- **Group 8: Privacy Invariant & Heuristic Transparency:** 4/4 passed (zero credential leakage; structured explanations and disclaimers).
- **Group 9: End-to-End Pipeline & Risk Engine Integration:** 8/8 passed (classifier, risk engine `HIGH` risk level, policy `WARN` advisory).
- **Group 10: Synthetic HTML & Controlled Local Test Domains:** 6/6 passed (compound indicators vs single weak signal resilience).

**Summary:** 60/60 tests passing cleanly in 8ms.

### Regressions Check
- `test:suspicious-url`: 89/89 passed.
- `test:risk`: 71/71 passed.
- `test:policies`: 45/45 passed.
- `test:policy-config`: 117/117 passed.
- `build`: Extension bundle generated successfully.
