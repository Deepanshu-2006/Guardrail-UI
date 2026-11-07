# Guardrail UI Day 26: Protection Policy Management & User Controls Audit Report

**Date:** November 7, 2026  
**Auditor:** Antigravity (Google DeepMind)  
**Subject:** Protection Policy Schema, Evaluation Engine, Storage, User Controls, and Backend Synchronization  

---

## Executive Summary

As part of **Day 26: Protection Policy Management & User Controls**, an audit of the Guardrail codebase was performed across `guardrail/extension`, `guardrail/dashboard`, and `guardrail/server`.

The inspection evaluated:
1. Protection policy schema, invariants, and defaults.
2. Risk engine evaluation and rule precedence.
3. Extension popup UI, onboarding controls, and settings.
4. Backend API endpoints and persistence boundaries.
5. Dashboard settings and trusted-contact authority limits.
6. Synchronization mechanisms and security boundaries.

### Core Architectural Findings:
1. **Strong Local Policy Engine with Inviolable Invariants:** The client extension has a typed, deeply frozen, fail-closed policy configuration engine (`GuardrailPolicyConfig`) with enforced security invariants (`CONTROLLED_DESTRUCTIVE` and `UNSUPPORTED_BOUNDARY_GUARD` cannot be disabled or downgraded below `PROTECT`).
2. **Settings Persistence Gap:** While the schema and `PolicyConfigLoader` support `chrome.storage.local` persistence, there is **no user-facing settings UI** in either the extension popup or the dashboard to view, toggle, or tune these policies. The extension popup is purely read-only (displaying environment, health status, and active rule count).
3. **Backend Policy Storage is Absent:** The backend server (`guardrail/server`) currently manages **identity, relationships, approval requests, and decision audit logs**. There is **no backend policy repository, no policy synchronization API endpoint, and no server-side policy evaluation**. All policy evaluation happens exclusively client-side in the extension.
4. **Trusted Contacts Cannot Alter Policies:** By design and current architecture, trusted contacts have **zero authority** over policy configuration. Trusted contacts can only approve or reject held action requests within their assigned ward scope and manage relationship invitations. They cannot modify risk thresholds, enable/disable rules, or alter timeout values.

---

## 1. Existing Protection Policy Schema

Located in [`guardrail/extension/src/types/config.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/types/config.ts) and [`guardrail/extension/src/config/schema.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/schema.ts):

### Top-Level Fields (`GuardrailPolicyConfig`):
- `schemaVersion`: string (Semver, e.g. `'1.0.0'`)
- `policyVersion`: string (Semver, e.g. `'1.0.0'`)
- `updatedAt`: string (ISO 8601 timestamp)
- `thresholds`: `RiskThresholdSettings`
- `signals`: Record mapping `RiskSignalId` to `ConfigurableSignalSetting`
- `policies`: Array of `ConfigurablePolicyRule`
- `trustedDomains`: Array of trusted domain hostnames (`string[]`)
- `timeouts`: `OperationalTimeouts`

### Sub-Schemas & Constraints:
1. **`RiskThresholdSettings`:**
   - `lowMax`: integer `[5, 35]` (default: `24`)
   - `mediumMax`: integer `(lowMax, 65]` (default: `49`)
   - `highMax`: integer `(mediumMax, 85]` (default: `74`)
   - CRITICAL threshold is implicitly `highMax + 1` (cannot exceed 86).
2. **`ConfigurableSignalSetting`:**
   - `id`: `RiskSignalId` (`DESTRUCTIVE_ACTION`, `PAYMENT_ACTION`, `AUTHENTICATION_ACTION`, `EXTERNAL_NAVIGATION`, `DOWNLOAD_ACTION`)
   - `enabled`: boolean
   - `scoreContribution`: integer `[0, 100]`
3. **`ConfigurablePolicyRule`:**
   - `id`: `RiskPolicyId`
   - `name`: string
   - `enabled`: boolean
   - `actionTypes`: non-empty subset of `ActionType` (`CLICK`, `NAVIGATION`, `INPUT`, `SUBMIT`)
   - `decision`: `ResponseAction` (`ALLOW`, `WARN`, `PROTECT`)
   - `priority`: integer `[1, 1000]`
   - `reasonCode`: string
   - `userExplanation`: string
   - `isImmutableSecurityInvariant`: boolean (optional)
4. **`OperationalTimeouts`:**
   - `approvalTtlSeconds`: integer `[60, 86400]` (default: `3600` / 1 hour)
   - `dashboardPollIntervalMs`: integer `[1000, 60000]` (default: `10000` / 10 sec)

### Privacy Invariants (`FORBIDDEN_CONFIG_PATTERNS`):
Any config property name or string value containing patterns such as `password`, `secret`, `otp`, `pin`, `cvv`, `credit_card`, `token`, `cookie`, or `form_value` causes immediate schema validation rejection.

---

## 2. Policy Configuration Defaults

The system exposes `DEFAULT_GUARDRAIL_POLICY_CONFIG` in `schema.ts`, deeply frozen via `Object.freeze`:

| Policy ID | Decision | Priority | Action Types | Immutable Invariant | Default Explanation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `UNSUPPORTED_BOUNDARY_GUARD` | `PROTECT` | 350 | INPUT, SUBMIT, NAVIGATION | **Yes** | Protective mechanism required: Malformed or unverified action payload resolved fail-closed. |
| `CONTROLLED_DESTRUCTIVE` | `PROTECT` | 300 | CLICK | **Yes** | Protective mechanism required: Irreversible destructive action detected on target element. Staging Mode initiated. |
| `CONTROLLED_PAYMENT` | `WARN` | 250 | CLICK, SUBMIT | No | User advisory recommended: Action interacts with checkout or payment transaction flow. |
| `EXTERNAL_NAVIGATION` | `WARN` | 200 | NAVIGATION, CLICK | No | User advisory recommended: Navigation redirects to an external origin across domain boundaries. |
| `AUTHENTICATION_BOUNDARY` | `WARN` | 150 | CLICK, INPUT, SUBMIT | No | User advisory recommended: Action interacts with authentication, credential, or session boundaries. |
| `ROUTINE_INTERACTION` | `ALLOW` | 100 | CLICK, NAVIGATION | No | Action permitted without intervention: No elevated risk signals detected. Routine interaction. |

---

## 3. Risk Engine and Policy Evaluation

Located in [`guardrail/extension/src/risk/engine.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/risk/engine.ts):

1. **Deterministic Evaluation:**
   - Evaluates incoming `GuardrailAction` against active signals and rules.
   - Sums score contributions from active signals.
   - Clamps risk score to `[0, 100]`.
   - Categorizes score against active thresholds (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
2. **Fail-Closed Guarantees:**
   - Any evaluation error (e.g. malformed inputs, classifier failure) triggers `createFailedRiskAssessment`, which assigns score `100`, risk level `CRITICAL`, status `FAILED`, and triggers fail-closed protection.
   - If the configuration is degraded or corrupt, `PolicyConfigRegistry` safely falls back to `DEFAULT_GUARDRAIL_POLICY_CONFIG`.
3. **No Malice Proof:**
   - Scores represent operational impact and user sensitivity, never statistical probability or malice proof.

---

## 4. Extension Settings & Configuration UI

Located in [`guardrail/extension/src/popup/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/popup/index.ts) and [`guardrail/extension/public/popup/popup.html`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/public/popup/popup.html):

- **Current State:** **Read-Only Status Display**.
- **Elements Present:**
  - Active extension version (`0.1.0-dev`).
  - Active environment (`development`, `staging`, `pilot`, `production`).
  - Service backend type (`Mock (In-Memory)` vs `Live Backend`).
  - Protection status pill (`Active`, `Degraded`, `Inactive`).
  - Policy health badge (`HEALTHY`, `DEGRADED`, `FAILED`) + policy version (`v1.0.0`).
  - Active rules count (e.g. `6 rules active`).
  - Onboarding checklist banner and button leading to onboarding guide.
- **Settings Capabilities Missing:**
  - **No settings toggle UI:** Users cannot toggle individual policies (e.g. `CONTROLLED_PAYMENT`).
  - **No threshold configuration UI:** Users cannot adjust threshold sliders or scores.
  - **No trusted domain editor:** Users cannot add or remove trusted domains through the popup UI.

---

## 5. Backend Policy Storage & API Integration

Located in [`guardrail/server/src/`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/server/src/) and [`guardrail/extension/src/approval/api.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/approval/api.ts):

- **Backend Endpoints Implemented:**
  - `/api/v1/approval-requests` (POST, GET, invalidate, cancel, binding)
  - `/api/v1/approvals/pending` (GET)
  - `/api/v1/approvals/history` (GET)
  - `/api/v1/approvals/:id/decide` (POST)
  - `/api/v1/invitations` (POST, GET, revoke, accept)
  - `/api/v1/trusted-contacts` (GET, revoke)
  - `/api/v1/identity` (GET)
- **Backend Policy Handling:** **None**.
  - There are **no routes** for `/api/v1/policies` or `/api/v1/config`.
  - SQLite database schemas (`sqlite-approval-request-repository.ts` and `sqlite-trusted-contact-registry.ts`) store approval requests, decisions, and relationships. They do **not** have tables for policy storage.
  - Policy enforcement is strictly decoupled: the backend receives evaluated requests containing `riskLevel` and `actionDescription`, but the risk evaluation rules execute entirely inside the client extension.

---

## 6. Dashboard Settings & User Management

Located in [`guardrail/dashboard/src/components/settings.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/settings.ts) and [`guardrail/dashboard/src/components/relationships.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/relationships.ts):

- **Reviewer Identity & Authorization Card:** Displays Actor ID, Role (`TRUSTED_CONTACT`), Assigned Ward ID, Relationship Label, and multi-tenant scoping boundary.
- **Relationships Lifecycle Card:** Displays authorized wards and pending invitations. Supports creating invitations, revoking invitations, and disconnecting relationships.
- **Backend Connection Card:** Displays API origin, environment badge, mock/live service badge, polling cadence, and manual sync trigger.
- **Safety Invariants Card:** Read-only educational display of zero-trust guarantees (Decoupled execution, no automated continuation, multi-tenant isolation, privacy redaction).
- **Policy Management:** The dashboard provides **no policy editing controls**. Trusted contacts cannot modify the ward's protection policies.

---

## 7. Trusted-Contact Permissions Matrix

| Capability | Ward (Browser User) | Trusted Contact (Reviewer) | Backend Enforced? |
| :--- | :--- | :--- | :--- |
| Trigger Held Action Review | **Yes** (in Staging modal) | No | Yes |
| Cancel Held Action | **Yes** (Staging modal dismissal) | No | Yes |
| Approve / Reject Decision | No (Self-approval prohibited) | **Yes** (Authorized Contact only) | Yes (403 if self-approval or unlinked) |
| Create Trusted Contact Invitation | **Yes** | No | Yes |
| Revoke Active Relationship | **Yes** | No | Yes |
| View Ward's Browsing / Tab State | No | **No** (Decoupled) | Inviolable architectural invariant |
| Modify Protection Policies | Local storage only (code level) | **No** | Inaccessible |

---

## 8. Specific Audit Determinations

| Audit Question | Verified Determination | Evidence in Codebase |
| :--- | :--- | :--- |
| **Which settings genuinely exist?** | `thresholds` (`lowMax`, `mediumMax`, `highMax`), `signals` (`scoreContribution`, `enabled`), `policies` (`enabled`, `actionTypes`, `decision`, `priority`), `trustedDomains`, and `timeouts` (`approvalTtlSeconds`, `dashboardPollIntervalMs`). | [`config/schema.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/schema.ts#L30-L100) |
| **Which settings are currently configurable?** | Configurable via TypeScript API / `PolicyConfigRegistry.load()` / `ChromeLocalStorageProvider`, but **not** via any UI form. | [`config/registry.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/registry.ts#L100-L150) |
| **Do settings persist after restarts?** | If saved to `chrome.storage.local` via `PolicyConfigLoader.saveToStorage()`, they persist. If unset or corrupted, they fail-closed to `DEFAULT_GUARDRAIL_POLICY_CONFIG`. | [`config/loader.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/loader.ts#L120-L160) |
| **Are extension and backend using consistent policy values?** | **No**. The backend has no policy evaluation engine. The backend receives `riskLevel` as an evaluated metadata field from the extension and persists it as an audit string. | [`server/src/sqlite-approval-request-repository.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/server/src/sqlite-approval-request-repository.ts) |
| **Can trusted contacts modify policies?** | **No**. Trusted contacts have no endpoints, UI controls, or authorization rights to modify protection policies. | [`dashboard/src/components/settings.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/settings.ts#L80-L120) |
| **Are policy changes validated server-side?** | **Not applicable** currently because policy configuration is not transmitted to or stored on the backend. Client-side schema validation is rigorous (`validatePolicyConfig`). | [`config/schema.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/config/schema.ts#L320-L450) |
| **Which settings are UI placeholders/mocks?** | In the extension popup, active rules count and health are live, but there are no interactive form controls. In the dashboard, settings cards display live connection info and invariants, but no policy toggles exist. | [`extension/src/popup/index.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/src/popup/index.ts#L60-L110) |
| **What security limitations remain?** | 1. Policy configuration lives exclusively in client local storage; no cross-device policy sync.<br>2. Users cannot customize trusted domains or relax non-destructive warnings through an extension options page.<br>3. Backend cannot authoritatively audit or enforce policy versions across disparate extension instances. | Architectural Invariant |

---

## 9. Existing Policy Tests Coverage

All policy-related test suites were executed and verified passing:
1. `guardrail/extension/src/config/test-policy-config-schema.ts`:
   - Validates schema bounds, immutable invariants, forbidden sensitive patterns, and fail-closed defaults.
2. `guardrail/extension/src/config/test-policy-config-loader.ts`:
   - Tests Chrome storage loading, corruption recovery, debouncing, and health status transitions.
3. `guardrail/extension/src/config/test-policy-centralization.ts`:
   - Confirms that RiskEngine and response pipelines dynamically query `PolicyConfigRegistry` rather than using hardcoded values.
4. `guardrail/extension/src/risk/test-risk-engine.ts` & `test-rule-precedence.ts`:
   - Verifies priority tie-breaking, score clamping, and fail-closed critical scoring on evaluation errors.

---

## 10. Recommendations for Day 26 Implementation

1. **Build User-Facing Extension Policy Controls:**
   - Introduce an accessible Options/Settings page or popup panel allowing the ward to view active policies, manage trusted domains, and adjust permissible non-invariant settings (e.g., enable/disable `EXTERNAL_NAVIGATION` warning, modify `approvalTtlSeconds`).
2. **Prevent Tampering with Invariants:**
   - Ensure the UI disables or hides toggle controls for `CONTROLLED_DESTRUCTIVE` and `UNSUPPORTED_BOUNDARY_GUARD`, clearly explaining why these invariants are locked.
3. **Keep Trusted Contact Scoping Intact:**
   - Maintain the architectural barrier prohibiting trusted contacts from altering ward protection policies.
4. **Preserve Decoupled Execution:**
   - Ensure changing policy settings never affects held actions in memory or causes automatic continuation.
