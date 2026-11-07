# Guardrail Protection Policy Specification & Settings Model

**Version:** 1.0.0  
**Effective Date:** November 7, 2026  
**Status:** Authoritative Architectural Standard  
**Components:** `guardrail/extension`, `guardrail/server`, `guardrail/dashboard`  

---

## 1. Architectural Principles & Overview

The Guardrail Protection Policy Model establishes a **single, consistent, fail-closed source of truth** across the client extension, backend service, and dashboard.

### Core Architectural Principles:
1. **Single Source of Truth:** Policy definitions, numeric boundaries, defaults, and invariants originate from a canonical schema (`guardrail/extension/src/config/schema.ts` and `guardrail/extension/src/types/config.ts`), imported directly by both the browser extension and backend server runtime.
2. **Zero Client Trust:** The backend validates policy versioning and enforces critical risk classifications server-side. A compromised or buggy client cannot silently suppress review or report a destructive action as `LOW` risk.
3. **Fail-Closed by Design:** Any missing, corrupted, malformed, or out-of-bounds configuration automatically resolves to immutable, conservative defaults (`DEFAULT_GUARDRAIL_POLICY_CONFIG`). It never disables protection or silently permits sensitive actions.
4. **Non-Permissive Defaults:** Defaults are intentionally tuned for high safety and least privilege. Destructive actions and unverified boundary actions unconditionally trigger `PROTECT` mode (holding execution in Staging Mode).
5. **No Evaluation Logic Duplication:** The risk assessment rules and schema validation routines are shared canonical modules. The backend exposes canonical policy configurations and validation via `/api/v1/policy-config`.
6. **Strict Privacy Boundary:** Property keys and values matching sensitive credential patterns (passwords, OTPs, PINs, cards, CVVs, tokens, cookies, form data) trigger immediate schema validation rejection.

---

## 2. Policy Versioning & Compatibility Matrix

| Version Identifier | Specification / Range | Enforcement Rule | Architectural Meaning |
| :--- | :--- | :--- | :--- |
| `schemaVersion` | Semver `^1.0.0` (Major == 1) | Strict Semver Validation | Defines the structural format of the configuration document. Major version `< 1` is rejected as **STALE**; major version `> 1` is rejected as **UNSUPPORTED**. |
| `policyVersion` | Semver `^1.0.0` (Major == 1) | Cross-Component Verification | Identifies the active protection policy set. Carried on `ApprovalRequest` records and verified during action continuation to eliminate version skew. |
| `updatedAt` | ISO 8601 UTC String | Parsing & Sanity Check | Non-repudiation audit timestamp recording when the configuration document was generated or committed. |

### Version Skew Handling:
- **Major Version 1 (`1.x.y`):** Fully supported with forward and backward compatibility for minor and patch revisions.
- **Stale Versions (`< 1.0.0`):** Rejected with `STALE_CONFIG_VERSION`. System transitions to `FAILED` health status and falls back to safe immutable defaults.
- **Unsupported Future Versions (`> 1.x`):** Rejected with `UNSUPPORTED_CONFIG_VERSION`. System transitions to `FAILED` health status and falls back to safe immutable defaults.

---

## 3. Supported Settings Specification & Security Implications

### 3.1 Risk Thresholds (`thresholds`)

The Risk Engine maps quantitative cumulative scores `[0, 100]` into four categorical risk tiers:

```
[0 ------------ lowMax]   [(lowMax+1) ----- mediumMax]   [(mediumMax+1) ----- highMax]   [(highMax+1) ------------ 100]
         LOW                          MEDIUM                           HIGH                             CRITICAL
(Routine Interactions)        (Advisory Warnings)            (Staging Mode Review)            (Mandatory Staging Review)
```

| Setting Key | Type | Default | Permitted Bounds | Invariant? | Operational Meaning & Security Implication |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `thresholds.lowMax` | Integer | `24` | `[5, 35]` | No | **Low Risk Tier Ceiling:** Actions with cumulative score $\le lowMax$ proceed without warning or staging interruption. **Security Implication:** Raising `lowMax` widens the envelope of silent browsing. Capped strictly at `35` so actions with multiple risk signals cannot masquerade as routine. |
| `thresholds.mediumMax` | Integer | `49` | `(lowMax, 65]` | No | **Medium Risk Tier Ceiling:** Actions in $(lowMax, mediumMax]$ trigger non-blocking user advisories (`WARN`). **Security Implication:** Must strictly exceed `lowMax`. Capped at `65` to prevent sensitive actions from being treated as mere advisories. |
| `thresholds.highMax` | Integer | `74` | `(mediumMax, 85]` | No | **High Risk Tier Ceiling:** Actions in $(mediumMax, highMax]$ trigger blocking Staging Mode (`PROTECT`). **Security Implication:** Must strictly exceed `mediumMax`. Capped at `85` to ensure `CRITICAL` tier starts no later than `86`, guaranteeing severe irreversible actions always trigger fail-closed protective review. |

---

### 3.2 Observable Risk Signals (`signals`)

Risk signals detect observable DOM patterns and heuristics, contributing quantitative scores to the overall risk calculation:

| Signal ID | Type | Default Enabled | Default Weight | Bounds | Invariant? | Operational Meaning & Security Implication |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `DESTRUCTIVE_ACTION` | Boolean + Integer | `true` | `50` | `[25, 100]` | **YES** | **Mandatory Destructive Signal:** Fires on deletion, purge, account termination, or irreversible reset controls. **Security Implication:** **Immutable security invariant.** Cannot be disabled (`enabled: true`), and `scoreContribution` cannot be set below `25`. Silencing this signal would permit unreviewed permanent data loss. |
| `PAYMENT_ACTION` | Boolean + Integer | `true` | `40` | `[0, 100]` | No | **Financial Checkout Signal:** Fires on payment triggers, credit card inputs, checkout submissions, or wire transfers. **Security Implication:** Disabling or setting weight to 0 risks unprompted financial transactions or accidental subscription charges. |
| `AUTHENTICATION_ACTION` | Boolean + Integer | `true` | `20` | `[0, 100]` | No | **Authentication Boundary Signal:** Fires on login prompts, credential submissions, or session escalation buttons. **Security Implication:** Disabling reduces protection against credential harvesting and unauthorized session transitions. |
| `EXTERNAL_NAVIGATION` | Boolean + Integer | `true` | `20` | `[0, 100]` | No | **Cross-Origin Navigation Signal:** Fires when links or form actions redirect outside the current origin hostname. **Security Implication:** Disabling exposes users to silent cross-site redirects and phishing vectors. |
| `DOWNLOAD_ACTION` | Boolean + Integer | `true` | `10` | `[0, 100]` | No | **Binary Download Signal:** Fires when interactions initiate file downloads (.exe, .dmg, .zip, etc.). **Security Implication:** Contributes to compound risk scoring when downloading files from external origins. |

---

### 3.3 Protection Policy Rules (`policies`)

Policies map intercepted action types and matched signals to operational response decisions (`ALLOW`, `WARN`, `PROTECT`):

| Policy ID | Decision | Priority | Action Types | Invariant? | Security Implication & Downgrade Restriction |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `CONTROLLED_DESTRUCTIVE` | `PROTECT` | `300` | `CLICK` | **YES** | **Irreversible Destructive Action Guard:** Intercepts clicks on destructive elements and holds execution in Staging Mode. **Security Implication:** Core safety invariant. Cannot be disabled or downgraded below `PROTECT`. Client and server strictly reject any downgrade attempt. |
| `CONTROLLED_PAYMENT` | `WARN` | `250` | `CLICK`, `SUBMIT` | Partial | **Financial Checkout Policy:** Emits advisory warning or protective staging on checkout interactions. **Security Implication:** **Cannot be downgraded to `ALLOW`.** Permitted decisions: `WARN` or `PROTECT`. |
| `EXTERNAL_NAVIGATION` | `WARN` | `200` | `NAVIGATION`, `CLICK` | Partial | **Origin Boundary Guard:** Advises user when navigating away from current site to an external origin. **Security Implication:** **Cannot be downgraded to `ALLOW`.** Permitted decisions: `WARN` or `PROTECT`. Exempts domains explicitly listed in `trustedDomains`. |
| `AUTHENTICATION_BOUNDARY` | `WARN` | `150` | `CLICK`, `INPUT`, `SUBMIT` | Partial | **Credential Boundary Guard:** Advises user before submitting credentials or session switches. **Security Implication:** **Cannot be downgraded to `ALLOW`.** Permitted decisions: `WARN` or `PROTECT`. |
| `ROUTINE_INTERACTION` | `ALLOW` | `100` | `CLICK`, `NAVIGATION` | No | **Benign Routine Interaction Policy:** Allows routine, low-risk interactions without user friction. **Security Implication:** Must remain `ALLOW`. Does not apply to actions matching destructive, payment, or auth criteria. |
| `UNSUPPORTED_BOUNDARY_GUARD` | `PROTECT` | `350` | `INPUT`, `SUBMIT`, `NAVIGATION` | **YES** | **Fail-Closed Corruption & Tamper Guard:** Evaluates highest during tie-breaking. Triggers fail-closed Staging Mode if payload is malformed or unverified. **Security Implication:** Core safety invariant. Cannot be disabled or downgraded below `PROTECT`. Guarantees system fails safely if classifiers fail. |

---

### 3.4 Whitelist & Operational Timeouts

| Setting Key | Type | Default | Permitted Bounds | Invariant? | Operational Meaning & Security Implication |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `trustedDomains` | `string[]` | `[]` | Valid Hostnames | No | **Trusted Domains Allowlist:** Array of pure hostnames (e.g. `['internal.company.com']`) exempt from `EXTERNAL_NAVIGATION` warnings. **Security Implication:** Adding an untrusted domain permits silent cross-site navigation without user advisory. Hostnames must strictly match syntax: no protocols (`https://`), paths (`/`), ports (`:8080`), or credentials (`user:pass@`). |
| `timeouts.approvalTtlSeconds` | Integer | `3600` (1 hr) | `[60, 86400]` (1m - 24h) | No | **Approval Request Expiration Deadline:** Time window before an in-memory/backend approval request expires. **Security Implication:** Setting too low causes unnecessary request churn; setting too high increases the vulnerability window for stale reviewer decisions. |
| `timeouts.dashboardPollIntervalMs` | Integer | `10000` (10s) | `[1000, 60000]` (1s - 60s) | No | **Dashboard Refresh Cadence:** Polling interval for background status checks. **Security Implication:** Polling faster than 1s creates denial-of-service pressure on the backend; slower than 60s delays critical notification delivery to caretakers. |

---

## 4. Privacy & Credential Exclusion Guarantees

The schema validation engine (`checkForbiddenKeysOrStrings`) recursively scans all keys and string values in any policy configuration document.

The following sensitive keywords are strictly forbidden and trigger immediate validation rejection (`FORBIDDEN_SENSITIVE_DATA` / `FORBIDDEN_SENSITIVE_KEY`):
- Passwords & passphrases (`password`, `passphrase`, `passwd`)
- Secrets & private keys (`secret`, `private_key`)
- One-time codes & PINs (`otp`, `pin`, `cvv`, `cvc`)
- Financial identifiers (`credit_card`, `debit_card`, `card_number`, `pan`)
- Authentication tokens & session cookies (`token`, `authtoken`, `bearer`, `cookie`)
- Raw user input values (`form_value`, `input_value`, `form_data`, `raw_html`, `raw_content`)

---

## 5. Server-Side Policy Validation & Contract Consistency

In accordance with the **Zero Client Trust** principle:

1. **Policy Configuration Endpoints:**
   - `GET /api/v1/policy-config`: Exposes active canonical defaults, specifications dictionary, and supported schema/policy versions.
   - `POST /api/v1/policy-config/validate`: Validates candidate configurations server-side using the identical validation engine (`validatePolicyConfig`).
2. **Server-Side Request Validation:**
   - In `ApprovalService.createRequest`:
     - If client submits `policyVersion`, server verifies compatibility with `checkVersionCompatibility` (must be `1.x`).
     - Server independently cross-checks action metadata:
       - Actions with `category: ActionCategory.DESTRUCTIVE` cannot be submitted with `riskLevel: RiskLevel.LOW`.
       - Actions with `category: ActionCategory.PAYMENT` cannot be submitted with `riskLevel: RiskLevel.LOW`.
       - Actions with `category: ActionCategory.AUTHENTICATION` cannot be submitted with `riskLevel: RiskLevel.LOW`.
     - Attempting to submit a high-risk category with `LOW` risk level throws `ApprovalValidationError` with code `VALIDATION_ERROR` (HTTP 400).

---

## 6. Safe Configuration Resolution & Health Tracking

Configuration loading and merging follow deterministic health state transitions:

```
[ UNINITIALIZED ]
        │
        ▼ (Storage Read)
┌──────────────────────────────────────────┐
│ - Corrupt root / sensitive credentials?  │──► [ FAILED ] (Fail-closed to immutable defaults)
│ - Incompatible semver major (<1 or >1)?  │
└──────────────────────────────────────────┘
        │
        ▼ (Merge Partial / Non-Fatal Deviations)
┌──────────────────────────────────────────┐
│ - Optional fields missing?               │──► [ DEGRADED ] (Safe defaults applied for missing fields)
│ - Permissible bounds clamped?            │
└──────────────────────────────────────────┘
        │
        ▼ (Strict Schema Pass)
   [ HEALTHY ] (Fully validated custom configuration active)
```

- In all failure modes, `resolveSafePolicyConfig` logs a diagnostic warning and guarantees active configuration is `DEFAULT_GUARDRAIL_POLICY_CONFIG`.
- Protection is **never silently disabled**.
