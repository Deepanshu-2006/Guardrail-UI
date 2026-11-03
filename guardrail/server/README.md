# Guardrail Approval Backend

## Backend and storage

The backend uses SQLite through `better-sqlite3`, isolated from extension and dashboard bundles. Approval requests, action bindings, invitations, and trusted-contact relationships persist in the configured SQLite file. Approval transitions and invitation acceptance use SQLite transactions/conditional updates. This is durable storage for a single backend instance, not a horizontally scaled production database.

The database stores validated approval, binding, invitation, and relationship records. It does not store passwords, OTPs, payment-card values, cookies, bearer tokens, or raw form values. The database file is created with owner-only permissions where supported. Invitation codes are secret pairing material: creation returns the code only to the authenticated issuer so it can be shared manually. Invitation lookup by code is restricted to the issuer/admin; the invitee accepts by submitting the code to the accept endpoint. No email or SMS delivery provider is configured.

## Run the persistence tests

Requires Node.js 20 or newer and native build tooling for the `better-sqlite3` package.

```sh
cd guardrail/server
npm install
npm test
npm run type-check
npm run build
```

`npm test` runs two different checks:

- `test:sqlite` uses temporary, file-backed SQLite databases to verify persistence and transactional behavior. This is a real SQLite integration test.
- `test:api` starts the Node HTTP API on a local TCP port and exercises it through the existing `ApprovalApiClient` using a temporary SQLite database. It verifies invitation ownership, acceptance, expiration, revocation, restart durability, pending review retrieval, approve/reject, and persisted status. The token verifier in this test is synthetic and in-memory; it does not verify a live identity provider.

## Use the adapter

`startGuardrailHttpServer()` composes `ApprovalApiRouter`, the existing API routes, and SQLite persistence. It requires an injected `TokenVerifier`; it has no default or fake identity implementation. The database location is selected with `GUARDRAIL_DB_PATH`; the default is `data/guardrail.sqlite` relative to the server process working directory. Call the returned `close()` during shutdown. Initialization fails closed if the database cannot be opened. The default bind address is loopback (`127.0.0.1`); configure an HTTPS reverse proxy before remote use.

```ts
import { startGuardrailHttpServer } from './dist/index.mjs';

// `applicationTokenVerifier` must validate credentials using the host's real identity provider.
const runtime = await startGuardrailHttpServer({ tokenVerifier: applicationTokenVerifier });
// Close runtime.close() during graceful shutdown.
```

The service factory requires an active trusted contact for new requests. Supply the application's real contact and action-ownership registries; defaults are memory-backed and are not suitable for a live deployment.

## Current boundaries

- SQLite persists approval requests, action bindings, invitations, and trusted-contact relationships. User identity records, token/session records, and distributed rate limits are not implemented here.
- No production token verifier or configured deployment is included. The HTTP server requires dependency injection and does not create identities. Do not expose it to pilot users until a real verifier is connected and deployment protections are configured.
- The extension API client already supports the API contract when given a server URL and authenticated token provider. The dashboard `DashboardShell` also accepts that client, but its standalone mount does not provide authentication/session setup; a host application must inject the authenticated client. Invitation acceptance creates a relationship, not a login session.
- Action ownership data remains runtime-specific unless the host supplies its own `ActionOwnershipRegistry`; it is not part of this persistence adapter.
- SQLite is intended for a single backend instance. Multi-instance deployment requires a shared transactional database adapter and database-level concurrency guarantees.
- Invitations are manually shared out-of-band. No notification provider is configured and the system does not claim delivery.
- Database files, WAL files, build output, and `.env` files are ignored by Git. No database credentials are compiled into frontend bundles; SQLite itself uses a filesystem path, not a database credential.
