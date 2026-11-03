# Backend Persistence Audit

## Executive summary

The repository contains a substantial approval domain implementation: approval and binding models, lifecycle validation, authorization and trusted-contact logic, an HTTP-compatible API router, typed clients, and local HTTP test infrastructure. It does **not** contain a production backend process or persistent database adapter. The approval repository, trusted-contact and invitation registry, action ownership registry, token verifier, and rate limiter are in-memory implementations. State is lost when their process exits.

The API contract and much of its application-level authorization logic can be reused. A live approval workflow still requires a backend bootstrap/deployment, real identity/token verification, durable storage for requests and relationships, and transaction-level enforcement for concurrency and tenant isolation. This audit did not modify implementation code or run tests.

## Repository state and scope

- Audited on `main` at `bf649ba` (`Add pilot verification report`); initial `git status --short --branch` showed a clean `main...origin/main`.
- Read [pilot verification report](pilot-verification-report.md), backend source, package scripts/dependencies, approval and integration contracts, dashboard source, and the related test fixtures.
- No database, migration, or live-service test was run; this is an inspection report.

## Architecture and data flow

| Boundary | Existing implementation | Current status |
| --- | --- | --- |
| Domain and lifecycle | `extension/src/types/approval.ts`, `extension/src/approval/model.ts`, `binding.ts`, `lifecycle.ts` | Implemented domain types, status transitions, binding validation, privacy field validation. These are TypeScript domain modules, not database models. |
| Approval persistence | `extension/src/approval/repository.ts` | `ApprovalRequestRepository` interface plus `DevelopmentInMemoryApprovalRequestRepository`, backed by `Map`s and indexes. It supports in-process CAS-style transitions and request/binding atomic operations, not durable or cross-process transactions. |
| User/contact relationships | `extension/src/approval/authorization.ts` | `TrustedContactRegistry` and `ActionOwnershipRegistry` interfaces; only the supplied registries are in-memory. Invitations, contact associations, and action ownership disappear on process restart. |
| Application service | `extension/src/approval/service.ts` | `ApprovalService` coordinates request, binding, decision, expiry, cancellation, and invitation operations. Its defaults instantiate in-memory repositories/registries; `enforceActiveContact` defaults to `false`, so a live bootstrap must explicitly configure and test the intended enforcement. |
| HTTP API | `extension/src/approval/api.ts` | `ApprovalApiRouter` implements request dispatch and Node-compatible stream handling. It is not mounted by a production server entry point in `server/`. |
| Authentication and rate limiting | `extension/src/approval/api.ts` | `TokenVerifier` and `RateLimiter` abstractions exist. The concrete implementations found are `InMemoryTokenVerifier` and `InMemoryRateLimiter`; no production verifier or distributed limiter was found. |
| Extension client | `extension/src/approval/client.ts`, `submit-operation.ts`, `sync-client.ts` | Typed HTTP client, timeout/error/schema handling, and submission/status-sync paths exist. It resolves a token through an injected provider or browser storage. A client and configured URL do not establish a reachable or authenticating service. |
| Dashboard | `dashboard/src/shell.ts`, `dashboard/src/index.ts`, `dashboard/src/types.ts` | Shell can use an injected `ApprovalApiClient`; polling and actions are conditional on that client. Standalone auto-mount resolves environment metadata but does not construct a client or authenticate a session. |
| Server/runtime | `server/README.md`, `extension/src/browser-test/test-server.ts` | `server/README.md` says the backend is future scope and no framework/database is installed there. The test server mounts the router over local HTTP with in-memory stores and identities; it is test infrastructure, not a deployed service. |

Current tested/local flow: extension or dashboard client → configured HTTP URL → router → `ApprovalService` → in-memory request/binding and relationship registries. A test fixture starts this router on localhost. The repository does not show a running production HTTP service, a production auth provider, or a database connection path.

## API and model inventory

`ApprovalApiRouter` contains versioned routes for:

- Approval requests: create, inspect, cancel, binding lookup, request invalidation.
- Action bindings: lookup, invalidation, and continuation validation.
- Trusted-contact review: pending list, details, and decision submission.
- Invitations and relationships: create/list/inspect/accept/revoke invitations; list/revoke trusted contacts.

No server-side approval history/list endpoint was found; dashboard history has been documented as a local session archive. Pairing is implemented through out-of-band invitation codes; no email/SMS/push delivery service was found.

`ApprovalRequest` and `ApprovalActionBinding` are typed domain records with identifiers, requester/action association, status/lifecycle timestamps, sanitized action metadata, risk fields, and decision metadata. The models and validators reject unexpected or sensitive fields. Trusted-contact and invitation records carry user/contact identifiers and lifecycle state. These are currently held by in-memory stores.

## Persistence, restart behavior, and isolation

- **Database integration:** None found. Extension dependencies shown in `extension/package.json` are development tooling (`typescript`, `esbuild`, Chrome types); no database driver/ORM, migration tool, `DATABASE_URL` handling, schema, or migration directory was found. PostgreSQL/SQLite appear in documentation as proposed future targets, not as installed integrations.
- **Restart durability:** Approval requests, bindings, contacts, invitations, action ownership, token registrations, configured in-memory rate-limit counters, and the service's consumed-continuation map are in process memory. They do not survive server/process restart. A browser-held action is separately ephemeral and also cannot be restored safely from server state alone.
- **User isolation:** The service derives requester identity from `AuthContext`, checks action ownership, scopes request listing and decisions through trusted-contact relationships, and includes anti-enumeration behavior. Relevant tests use multiple synthetic identities and in-memory registries. This verifies application logic under fixtures; it does not establish durable tenant isolation because no production identity verifier, persistent relationship source, database constraints, or live multi-tenant deployment exists.
- **Concurrency:** The in-memory repository documents atomic transitions within a single JavaScript process. It cannot coordinate separate processes/instances. The database-level unique constraints, row locks/conditional updates, and transactional request-plus-binding persistence described by `approval-workflow-contract.md` are not implemented.

## Security findings and implementation gaps

### High — Live authorization authority is not present

`TokenVerifier` is an interface with an in-memory implementation; no production token issuer/verifier or server identity middleware was found. The API client can send a bearer token, but the repository does not establish who issues or validates live tokens. Do not treat synthetic test tokens or browser-stored tokens as production authentication.

### High — Approval and relationship state is ephemeral

The default service uses in-memory storage. A process restart clears approval decisions and trusted-contact relationships, and multiple server instances would see separate state. This prevents reliable live approvals and durable authorization.

### High — No deployable backend entry point or durable adapter

The router can be mounted and the local fixture does mount it, but `server/` has no application entry point, runtime configuration, database adapter, migrations, production health/recovery behavior, or deployment wiring. The pilot API hostname in configuration is not evidence that a service exists there.

### Medium — Production-safe relationship enforcement is opt-in

`ApprovalService` defaults `enforceActiveContact` to `false`. No production constructor/bootstrap currently establishes the required live value. A future server bootstrap should make this policy explicit and fail startup if its auth/relationship dependencies are not configured.

### Medium — Dashboard live client/session wiring is an integration responsibility

The dashboard accepts an `apiClient`, but standalone auto-mount does not supply one and there is no dashboard auth/session bootstrap in the inspected entry point. The injectable shell supports integration; it does not itself provide a connected trusted-contact deployment.

### Medium — Documentation has implementation drift

Some early contract text describes the whole router/client/UI as future work, while those code modules now exist. Conversely, current route and in-memory implementations do not satisfy the contracts' future database, server bootstrap, distributed concurrency, or notification requirements. Update status tables/checklists as each real deployment layer is added; retain the endpoint/privacy contract as the compatibility baseline.

These are release and reliability gaps, not evidence of a confirmed production exploit. No production backend was available to test.

## Existing protections to retain

- Requester identity is assigned from authenticated service context, not trusted from the request payload.
- Request and decision transitions are validated; duplicate and competing transitions are covered by repository/service test fixtures.
- Action-to-approval bindings are explicitly modeled and associated with atomic in-process repository operations.
- Contact relationship checks, self-approval restrictions, invitation lifecycle checks, and response whitelisting exist in service/API code.
- API client validates response shapes and typed failures; status synchronization does not execute held actions.
- Approval models whitelist metadata and disallow raw form values and secret-like fields.

These protections are implemented in the local service/domain paths; production enforcement still depends on a real verifier, durable adapter, and server deployment.

## Contracts to preserve

Keep `/api/v1` route paths, JSON success/error envelope, status values (`PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`), binding states and identifiers, sanitized request fields, authorization semantics, and the `x-guardrail-service-type` mock/live disclosure compatible unless introducing a separately versioned contract. Preserve error codes/status mappings used by the extension client and dashboard. Database-specific representation should remain behind repository/service abstractions; do not expose persistence internals or secrets to clients.

## Recommended implementation sequence for Prompts 2–7

1. **Choose persistence/runtime requirements:** decide the target database only after documenting deployment, backup, retention, availability, and transaction requirements. The repository has no existing database preference wired in; PostgreSQL/SQLite are documentation proposals, not a selection.
2. **Define schema and migrations:** map users/identities, trusted-contact relationships, invitations, approval requests, bindings, and decisions. Add foreign keys, unique constraints, expiry/state indexes, and safe migration/rollback rules consistent with current model and API contracts.
3. **Implement repository adapters:** satisfy existing interfaces, including atomic request-plus-binding creation, compare-and-swap state transitions, per-user/action uniqueness, and transaction semantics across server instances. Keep the current in-memory implementation for tests/development.
4. **Add server bootstrap and authentication:** mount the existing router in a real server process; provide a real token verifier/identity source, explicit active-contact enforcement, secure configuration/secrets, bounded rate limiting, and fail-closed startup checks. Do not bundle server credentials into the extension/dashboard.
5. **Integrate clients and health/recovery:** make the extension and dashboard use the deployed endpoint with real sessions, clear mock/live classification, timeouts, and truthful unavailable/unauthenticated states. Do not equate configured pilot URLs with service availability.
6. **Verify persistence and isolation end to end:** add database integration tests for restart durability, migration, concurrent decisions, duplicate creation, wrong-tenant reads/writes, invitation revocation/expiry, and request-binding atomicity; then exercise extension and dashboard against a controlled staging service and document operational recovery/backup procedures.

## Existing test coverage and audit limits

Relevant existing scripts include `cd extension && npm run test:approval-service`, `test:approval-api`, `test:approval-client`, `test:invitations`, `test:approval-binding-security`, and the extension's aggregate `npm test`; dashboard scripts include `cd dashboard && npm test` and dashboard sync/verification tests. The repository also has `extension/src/browser-test/test-server.ts`, which runs a local in-memory router and must not be described as a live backend.

The tests are predominantly deterministic domain/API/client tests and mocked/local HTTP integration using in-memory repositories, token verifiers, contacts, and DOM fixtures. No database integration, migration, durable restart, deployed-service, or live authentication test infrastructure was found. Tests were not rerun for this audit.
