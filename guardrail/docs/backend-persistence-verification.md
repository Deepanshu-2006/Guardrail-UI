# Day 23 — Backend Persistence and Approval Infrastructure Verification

## Summary

The repository now contains a SQLite-backed Node HTTP service, persistent approval requests and action bindings, persistent trusted-contact invitations and relationships, strict runtime configuration for pilot/production modes, and liveness/readiness endpoints. Local database and HTTP integration tests pass. The extension and dashboard contain clients for the existing approval API contract.

This does **not** establish a remotely usable live approval service. No real identity provider, authentication adapter, host deployment, TLS endpoint, or reachable pilot backend is configured. The extension API client was exercised against the local SQLite server with synthetic test tokens. The dashboard integration suites use a local in-memory backend. A GET to the configured pilot API health URL could not resolve its hostname.

**Readiness: not ready for a remote trusted-contact pilot.** The implementation is suitable for continued controlled local testing. Remote pilot use still depends on real authentication, deployment and TLS, the actual extension/dashboard origins, durable action ownership, and the dashboard's authenticated host bootstrap.

## Repository state and scope

- Initial state: clean `main` at `65501a8` (`Add controlled server runtime configuration and readiness checks`), following `b9c8cc7` (`Add SQLite-backed HTTP approval API`).
- No implementation files from Day 23 were edited for this verification. This report is the only intended tracked change.
- The earlier [backend persistence audit](backend-persistence-audit.md) describes the pre-SQLite architecture and is historical; its “no database” findings are superseded by the implementation and tests summarized here.

## Implemented components and data flow

| Area | Actual implementation | Verified boundary |
| --- | --- | --- |
| Server configuration and executable | `server/src/runtime-config.ts`, `server/src/serve.ts`, `server/src/http-server.ts` | Reads environment variables, rejects unsafe pilot/production fallback, requires a host-provided `TokenVerifier` module for standalone startup, mounts the existing router. |
| Approval and binding persistence | `server/src/sqlite-approval-request-repository.ts` | `better-sqlite3` file-backed SQLite, schema versioning, constraints/indexes, transactional request/binding writes and conditional state changes. The adapter declares `IS_PRODUCTION = false`. |
| Trusted-contact/invitation persistence | `server/src/sqlite-trusted-contact-registry.ts` | Same SQLite file; contacts and invitations persist. Invitation acceptance and state changes use transactions/conditional updates. |
| Application composition | `server/src/persistent-approval-service.ts` | Reuses existing `ApprovalService`; requires an active contact for new requests; exposes database readiness checks. |
| HTTP API | `extension/src/approval/api.ts` mounted by `server/src/http-server.ts` | Existing `/api/v1` routes retain the API envelope and route contract. API authentication is injected through `TokenVerifier`; client requester IDs/statuses are not authoritative. |
| Extension client and submission/status synchronization | `extension/src/approval/client.ts`, `submit-operation.ts`, `sync-client.ts` | HTTP client supports injected base URL and token provider, validates responses and reports transport failures. The client does not itself provide an identity provider. |
| Dashboard | `dashboard/src/index.ts`, `dashboard/src/shell.ts`, `dashboard/src/types.ts` | `DashboardShell` accepts an injected `ApprovalApiClient`; standalone mount does not create an authenticated session or client. |

Local persistent test path: `ApprovalApiClient` → Node HTTP listener → existing API router → `ApprovalService` → SQLite request, binding, invitation, and contact records. The integration test's token verifier is synthetic and process-local. The dashboard's local integration path uses a separate in-memory test server and is not connected to the SQLite server.

## Verification results

### Backend

- `cd guardrail/server && npm test` — **passed**. `test:config` checks environment and origin validation; `test:sqlite` uses real temporary file-backed SQLite databases; `test:api` starts a real local Node TCP server with temporary SQLite and calls it through the extension's `ApprovalApiClient`.
- SQLite tests verified persisted request retrieval after reopening the database, persisted approval state after repository restart, rejected invalid transitions and invalid records, expiry, revoked reviewer denial, cross-user isolation, database-open/closed-connection failures, and competing decisions across independent SQLite connections.
- HTTP/SQLite tests verified invitation creation, acceptance and durability across a server restart; invitation expiry/revocation; approval and rejection; approval persistence; cross-user denial; invalid token rejection; `/health`; `/ready` against a live SQLite query; exact configured development CORS behavior; and malformed JSON error handling without stack or token disclosure.
- **Authentication level:** HTTP tests authenticate with `InMemoryTokenVerifier` and synthetic tokens. They are not real-authentication-provider tests.
- `/ready`'s successful response was tested over HTTP against SQLite. Repository health failure was tested after connection closure, but the HTTP `/ready` 503 branch was not directly exercised by the current integration suite.
- `cd guardrail/server && npm run build` — **passed**, building `dist/index.mjs` and `dist/serve.mjs`.

### Extension

- `cd guardrail/extension && npm test` — **completed successfully**. The aggregate test command reached its final Day 11 verification (102/102 assertions passed). Its HTTP fixtures use local routers and synthetic identities; they do not establish a remote service or real authentication.
- `cd guardrail/extension && npm run build` — **passed** for the development bundle.
- `npm run test:browser:env && npm run test:browser:interception && npm run test:browser:approval && npm run test:browser:security && npm run test:browser:privacy` — **completed successfully**. These scripts launched headless Chromium and loaded the extension for controlled local scenarios. Their approval server is explicitly an in-memory mock; this is browser-level verification against test infrastructure, not a browser test against the SQLite server or a deployed backend.

### Dashboard

- `cd guardrail/dashboard && npm run build` — **passed**.
- `npm run test:shell` — **passed**, 327/327.
- `npm run test:sync` — **passed**, 52/52.
- `npm run test:verify-day12` — **failed**, 102/104. Two assertions expect an unrelated authenticated `USER` to receive a successful empty reviewer queue and an empty-state UI. The current server rejects that role for reviewer-queue access, and the dashboard correctly shows an error state. The route's authorization behavior is consistent with the server tests; the fixture expectations are stale and should be updated to assert denial without data disclosure.
- `npm run test:verify-complete-sync` — **failed**, 133/134. The remaining failure is likewise the fixture expectation that Mallory's non-reviewer pending-queue request succeeds. The rest of this local HTTP workflow passed, including request creation, approval/rejection synchronization, expiry/cancellation handling, and the invariant that approval never executes the held action.
- Both dashboard integration suites use local Node HTTP with in-memory approval storage and synthetic tokens. Neither uses the SQLite server or live authentication.
- The aggregate `npm test` stops at the failing `test:verify-day12`; the remaining dashboard suites were run separately as listed above.

### Type checking, linting, and remote endpoint

- `npm run type-check` was attempted in `server`, `extension`, and `dashboard`. All three remained idle for about 1¾ minutes while reading dependency declaration files in the cloud-synced workspace; they were interrupted without a result. Type checking is therefore **inconclusive**, not passed.
- No package defines a `lint` script. Linting was unavailable from the repository's existing scripts.
- `curl --connect-timeout 5 --max-time 10 -sS -D - https://pilot-api.guardrail-safety.org/health` — **failed** with `Could not resolve host: pilot-api.guardrail-safety.org`. No deployed backend was reached or verified.

## Test level and integration classification

| Verification | Classification | Result and limitation |
| --- | --- | --- |
| Domain/service tests | Unit tests | Cover lifecycle, validation, authorization, duplicate handling, and client error mapping. |
| SQLite repository tests | Real database integration | Use temporary file-backed SQLite and multiple database connections; not a managed or remote database. |
| Server API test | Local HTTP + real SQLite integration | Uses actual TCP HTTP and SQLite persistence, but a synthetic in-memory token verifier. This is not a real authenticated-user test. |
| Extension API client against server | Local persistent API integration | The extension's `ApprovalApiClient` reaches the SQLite-backed server in `server/test-api-integration.ts`; identity remains synthetic. |
| Dashboard-to-server | Not verified against persistence | Dashboard tests use the in-memory test router; no DashboardShell test connects to the SQLite-backed server. |
| Controlled Chromium tests | Browser-level local tests | Real headless Chromium with local static page and mock in-memory approval backend; not remote service verification. |
| Deployed backend | Remote deployment check | Not verified: configured hostname did not resolve. |

## Security and reliability findings

### Verified locally

- Approval requests and action bindings persist in SQLite, and request plus binding transitions use database transactions/conditional updates.
- Stored records are validated; test cases reject injected password-like fields. Tests use synthetic data.
- SQLite files are opened with restrictive file permissions where supported. Database failures do not fall back to an in-memory approval store.
- Pilot/production configuration requires a file-backed absolute database path and exact allowed origins; wildcard CORS and insecure remote web origins are rejected.
- `/health` reports process liveness only. `/ready` runs actual database checks and returns sanitized readiness state; it does not include paths or exception details.
- API tests verify unauthenticated rejection, cross-user request isolation, reviewer authorization, invitation ownership/lifecycle, malformed request handling, and generic errors.
- Approval updates and dashboard synchronization are separate from browser action continuation. Local tests repeatedly observe zero continuation executions after approval/rejection synchronization.

### Not established / remaining gaps

- No real token issuer or verifier is configured. `server/src/serve.ts` requires a host adapter, and tests use only `InMemoryTokenVerifier`.
- The dashboard standalone entry point has no authentication/session bootstrap. A host must inject an authenticated client and profile.
- `ActionOwnershipRegistry` is runtime-provided and its default is not durable. A remote deployment must supply a persistent/authoritative action ownership source or approval actions may fail validation after restart and cannot rely on local in-memory ownership as durable authority.
- SQLite is single-instance persistence; no horizontal scaling, managed database, backup automation, migration CLI, or operational recovery procedure is implemented. Contact schema initialization is idempotent but is not separately versioned.
- No notification delivery provider exists; invitation codes are manually shared out-of-band.
- No distributed rate limiter is configured by the server bootstrap.
- The remote pilot endpoint was not reachable from this environment. No remote CORS, TLS, authentication, database durability, or client interoperability was verified.
- The HTTP readiness failure response path needs a direct endpoint-level failure test.
- Dashboard reviewer-queue tests need updating for the current role-denial behavior before dashboard aggregate tests can pass cleanly.

## Remaining blockers for a remote trusted-contact pilot

1. Connect a genuine host identity provider and implement its `TokenVerifier`; validate real session expiry and revocation.
2. Deploy the server behind HTTPS in a controlled environment; configure secrets outside frontend bundles and configure exact installed extension/dashboard origins.
3. Inject a durable action-ownership source and ensure the authenticated dashboard host supplies a valid client/session.
4. Add operational database backup, migration/versioning, restore, and monitoring procedures. Keep the deployment single-instance unless a shared transactional database adapter is introduced.
5. Update the two dashboard integration fixtures to expect denial for non-reviewer queue access; add a dashboard test against the SQLite HTTP server if that integration is intended to be supported.
6. Resolve the stalled TypeScript checks and add/enable linting if those checks are release requirements.
7. Re-run `/ready` and the authenticated extension/dashboard journeys against the reachable controlled deployment before inviting pilot users.

No deployment or commit was performed for this verification.
