# Guardrail UI — Security, Reliability & Performance Hardening Audit
**Day 29 Baseline Security, Concurrency, and Architectural Resilience Review**
**Date:** November 9, 2026 | **Harness:** Antigravity / T3 Code | **Target:** Guardrail UI Architecture

---

## Executive Summary

As part of Day 29 (*Security, Reliability & Performance Hardening*), a comprehensive, non-destructive audit of Guardrail UI was performed across the Browser Extension, Backend Approval Server, and Trusted-Contact Dashboard.

The audit verified that the core privacy invariants and anti-malware protections established in earlier phases are robust: raw passwords, cards, and OTPs are strictly excluded from DOM extractions; `chrome.downloads.open` is completely absent; and requests are bound 1:1 to cryptographic action digests. However, the audit revealed several critical architecture and performance concerns—most notably **unbounded SQLite table scans during polling**, **in-memory-only continuation consumption**, **multiple concurrent SQLite connection handles to a single file**, and **missing rate limiting on live server routes**.

---

## 1. Confirmed Vulnerabilities & Security Weaknesses

| ID | Severity | Category | Affected Module | Summary |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **Medium** | Persistence / State Integrity | `extension/src/approval/service.ts`, `server/src/sqlite-approval-request-repository.ts` | **Continuation Consumption State is Ephemeral (Not Persisted):** `consumedContinuations` is stored only in an in-memory `Map`. A server restart prior to binding expiration allows already-consumed continuations to be re-authorized. |
| **SEC-02** | **Low-Medium** | API Security / DoS | `server/src/http-server.ts`, `server/src/serve.ts` | **Missing Rate Limiter Wiring on Default Server:** `ApprovalApiRouter` implements a rate-limiting interface, but `startGuardrailHttpServer()` does not instantiate or wire a rate limiter by default. Public validation and auth routes lack rate limiting. |
| **SEC-03** | **Low** | Sensor Boundary | `extension/src/detector/action-detector.ts`, `extension/src/content/index.ts` | **Ambient Form Interception Boundary:** On uninstrumented web pages (lacking `data-guardrail-test-action`), forms triggering `PROTECT` are logged as an architectural limitation and emit custom events, but are not canceled synchronously in `handleSubmit`. |

---

## 2. Reliability & Database Consistency Issues

| ID | Severity | Category | Affected Module | Summary |
| :--- | :--- | :--- | :--- | :--- |
| **REL-01** | **High** | Database Concurrency | `server/src/persistent-approval-service.ts` | **Multiple Independent SQLite Handles on Same Database File:** `createPersistentApprovalService` opens separate `Database` handles for requests, contacts, and policies to `data/guardrail.sqlite`. Under concurrent write transactions, handles can compete and trigger `SQLITE_BUSY` errors. |
| **REL-02** | **Medium** | Database Integrity | `server/src/identity-store.ts` | **Inconsistent Foreign Key Pragma:** `SqliteIdentityStore` fails to execute `PRAGMA foreign_keys = ON;`, unlike `SqliteApprovalRequestRepository` and `SqliteTrustedContactRegistry`. |
| **REL-03** | **Medium** | Resource Hygiene | `dashboard/src/shell.ts`, `extension/src/background/index.ts` | **Unbounded Cache Growth:** `detailedRequestsCache` and `backgroundInterceptionController` maintain unbounded Maps without LRU or TTL eviction, risking memory growth in long-running sessions. |

---

## 3. Performance Bottlenecks

| ID | Severity | Category | Affected Module | Summary |
| :--- | :--- | :--- | :--- | :--- |
| **PERF-01** | **High** | CPU / I/O Bottleneck | `server/src/sqlite-approval-request-repository.ts`, `extension/src/approval/service.ts` | **Unbounded `findAll()` Table Scans During Polling:** `listPendingRequestsForContact` and `listHistory` invoke `findAll()`, executing `SELECT payload_json FROM approval_requests` with zero SQL filtering, deserializing every JSON record in Node.js memory. Polling every 2s scales $O(N)$ with total database size. |
| **PERF-02** | **Medium** | Query Amplification | `extension/src/approval/service.ts` | **N+1 Queries in Pending Contact Filtering:** `listPendingRequestsForContact` loops over all retrieved requests and executes `isTrustedContactForUser` for each row, generating $N$ separate SQLite queries instead of an indexed SQL `JOIN`. |
| **PERF-03** | **Low-Medium** | Storage Latency | Working Directory / Cloud Storage | **Cloud Storage Filesystem Lock Contention:** Local Google Drive sync creates latency on `.git/index.lock` and large directory scans when tools do not use targeted paths. |

---

## 4. Existing Protections (Verified Strong Foundations)

1. **Zero Credential / Form Value Leakage:**
   `extractElementInfo` sanitizes DOM inputs. Passwords, OTPs, CVVs, card numbers, and autocomplete fields are strictly stripped at the DOM boundary.
2. **Zero Automatic File Execution:**
   `chrome.downloads.open` is completely absent from the extension codebase. Downloaded files are never automatically opened or executed.
3. **No Automated Script Replay:**
   Continued actions execute registered controlled test handlers exactly once; approved forms are never auto-replayed via synthetic DOM submission.
4. **Authoritative Server Authorization (Zero Client Trust):**
   Client-supplied requester IDs and decisions in request payloads are ignored; identity is derived exclusively from verified server `AuthContext`.
5. **Separation of Duties:**
   Protected users (wards) are cryptographically and authoritatively barred from approving their own requests (`SelfApprovalProhibitedError`).
6. **Multi-Tenant Anti-Enumeration:**
   Accessing unowned requests returns opaque `404 / ApprovalAccessDeniedError` to prevent ID guessing and user enumeration.
7. **Monotonic Sequence Tracking:**
   Polling clients (`DashboardShell`, `ApprovalStatusSyncClient`) use monotonic sequence IDs to reject delayed out-of-order network responses.
8. **Shadow DOM Isolation:**
   All extension overlays and warning modals use isolated Shadow Roots with reset stylesheets to prevent page CSS hijacking.

---

## 5. Missing Security & Regression Tests

1. **Persistent Continuation Consumption Across Server Restarts:**
   Verify that after `consumeContinuationAuthorization()` is executed, restarting the backend server rejects any subsequent continuation attempts for the same `actionId`.
2. **SQLite Multi-Connection Write Contention & Busy Handling:**
   Verify that concurrent writes across multiple repository handles to the same database file either serialize cleanly or retry safely under contention without corrupting data.
3. **Large-Dataset Query & Pagination Benchmarks:**
   Verify that `listPendingRequestsForContact` and `listHistory` execute in $< 50\text{ ms}$ with 1,000+ historical requests in the database.
4. **Rate Limiting Enforcement on Live HTTP Routes:**
   Verify that rapid unauthenticated requests to `/api/v1/policy-config/validate` return `429 Too Many Requests` with a valid `Retry-After` header.
5. **Ambient Form Interception Boundary Regression:**
   Verify behavioral guarantees and visual notifications when uninstrumented ambient forms trigger `ResponseAction.PROTECT`.

---

## 6. Recommended Fix Roadmap (Prompts 2–7)

### Prompt 2: Database Architecture, Connection Unification & Query Optimization
- Unify database handles: Pass a single shared `Database` connection instance across `SqliteApprovalRequestRepository`, `SqliteTrustedContactRegistry`, and `SqlitePolicyRepository`.
- Add SQL-level filtering (`WHERE status = 'PENDING' AND requester_id IN (...)`), `LIMIT`, and `OFFSET` to eliminate unbounded `findAll()` in `listPendingRequestsForContact` and `listHistory`.
- Eliminate the N+1 query loop by joining `approval_requests` with `trusted_contacts`.

### Prompt 3: Continuation Consumption Persistence & State Machine Hardening
- Extend `approval_bindings` schema to add `CONSUMED` state (`state IN ('BOUND','APPROVED','REJECTED','EXPIRED','CANCELLED','INVALIDATED','CONSUMED')`).
- Persist continuation consumption to SQLite within an immediate transaction in `consumeContinuationAuthorization`.

### Prompt 4: API Rate Limiting & Unsafe Endpoint Hardening
- Wire a standard sliding-window rate limiter by default in `startGuardrailHttpServer` (`server/src/http-server.ts`).
- Ensure `POST /api/v1/policy-config/validate` and unauthenticated endpoints are rate-limited per IP.
- Ensure `PRAGMA foreign_keys = ON;` is consistently set across all SQLite stores, including `SqliteIdentityStore`.

### Prompt 5: In-Memory Cache Hygiene & Bounded Retention
- Implement bounded LRU/TTL eviction in `dashboard/src/shell.ts` (`detailedRequestsCache`, capping at 100 items).
- Implement bounded LRU eviction in `extension/src/background/index.ts` (`backgroundInterceptionController`).

### Prompt 6: Ambient Form Interception & User Safety Communication
- Refine `ActionDetector.handleSubmit` to support graceful ambient form handling, ensuring clear visual disclaimers when ambient submissions are detected.

### Prompt 7: Comprehensive Security Regression & Performance Verification
- Implement the 5 missing test suites.
- Run full regression testing across all tiers (Extension, Backend, Dashboard, Mocked Browser, Real Headless Chrome).
