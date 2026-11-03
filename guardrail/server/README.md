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

## Controlled testing configuration

The server reads environment variables directly; it does not load a `.env` file. Provide settings through the host environment or a secret/configuration manager. Do not put database credentials or identity-provider secrets in the extension or dashboard bundles. SQLite uses a filesystem path, so it has no database password.

| Variable | Development/test behavior | Pilot/production behavior |
| --- | --- | --- |
| `GUARDRAIL_ENV` (or `NODE_ENV`) | Defaults to `development`; accepted values are `development`, `test`, `pilot`, `production`. | Set explicitly to `pilot` or `production` to enable strict checks. |
| `GUARDRAIL_DB_PATH` | Defaults to `data/guardrail.sqlite`. | Required, absolute, file-backed path. `:memory:` and relative paths are rejected. Ensure the service account can write the parent directory and protect backups/WAL files. |
| `GUARDRAIL_ALLOWED_ORIGINS` | If omitted, the existing exact local development allowlist is used. | Required comma-separated exact origins. Wildcards, paths, credentials, duplicate entries, and non-HTTPS remote web origins are rejected. Include the actual installed extension origin and dashboard origin only. |
| `GUARDRAIL_HOST` | Defaults to `127.0.0.1`. | Defaults to `127.0.0.1`; set an explicit bind address only when the test environment's network topology requires it. Terminate TLS at a configured trusted proxy before remote browser use. |
| `GUARDRAIL_PORT` | Defaults to `3000`; `0` is allowed for tests. | Defaults to `3000`; must be a valid nonzero TCP port. |
| `GUARDRAIL_AUTH_MODULE` | Not needed when embedding `startGuardrailHttpServer()` with a test verifier. | Required by the standalone `npm start` entrypoint. It must be an absolute path to a host-owned module exporting a real `tokenVerifier` that implements `TokenVerifier`. There is no bundled or default verifier. |

Example pilot environment (replace the sample origins and filesystem path with values for the controlled test environment):

```sh
export GUARDRAIL_ENV=pilot
export GUARDRAIL_DB_PATH=/var/lib/guardrail/pilot.sqlite
export GUARDRAIL_ALLOWED_ORIGINS='chrome-extension://<installed-extension-id>,https://dashboard.example.test'
export GUARDRAIL_HOST=127.0.0.1
export GUARDRAIL_PORT=3000
export GUARDRAIL_AUTH_MODULE=/opt/guardrail/auth-adapter.mjs
npm ci
npm run build
npm start
```

`npm start` runs `dist/serve.mjs`. It dynamically loads the host authentication adapter, validates configuration before opening the API listener, and exits with a startup error if required configuration or the verifier is missing. This prepares a runnable server package but does not configure a real identity provider, TLS proxy, host, or deployment.

### Health and readiness

- `GET /health` is a liveness response. It returns only `{ "status": "ok" }` while the HTTP process is serving requests; it does not claim the database is ready.
- `GET /ready` executes `SELECT 1` against the actual SQLite approval repository and returns `{ "status": "ready" }` with HTTP 200, or a sanitized `{ "status": "not_ready" }` with HTTP 503 if the query fails. It does not return paths, connection details, exception text, or credentials.
- Health routes allow CORS only for the configured exact origins (or existing local development origins). CORS is a browser access rule and does not replace API authentication.

### Schema initialization and upgrades

Opening the approval repository applies its versioned schema migration transactionally before the server begins listening. That schema uses SQLite `user_version`; startup fails closed if the database cannot be opened or its version is newer than the application supports. The trusted-contact registry creates its tables idempotently with `CREATE TABLE IF NOT EXISTS`; it currently has no separate versioned migration. There is no standalone migration CLI. For a controlled test upgrade, stop the single server instance, make a protected backup of the database (including any needed WAL state using SQLite's backup facility or after a clean shutdown), deploy the tested build, then start it so initialization runs. Confirm `/ready` before directing test clients to it. Do not copy a live database into source control or frontend assets.

## Current boundaries

- SQLite persists approval requests, action bindings, invitations, and trusted-contact relationships. User identity records, token/session records, and distributed rate limits are not implemented here.
- No production token verifier or configured deployment is included. The HTTP server requires dependency injection and does not create identities. Do not expose it to pilot users until a real verifier is connected and deployment protections are configured.
- The extension API client already supports the API contract when given a server URL and authenticated token provider. The dashboard `DashboardShell` also accepts that client, but its standalone mount does not provide authentication/session setup; a host application must inject the authenticated client. Invitation acceptance creates a relationship, not a login session.
- Action ownership data remains runtime-specific unless the host supplies its own `ActionOwnershipRegistry`; it is not part of this persistence adapter.
- SQLite is intended for a single backend instance. Multi-instance deployment requires a shared transactional database adapter and database-level concurrency guarantees.
- Invitations are manually shared out-of-band. No notification provider is configured and the system does not claim delivery.
- Database files, WAL files, build output, and `.env` files are ignored by Git. No database credentials are compiled into frontend bundles; SQLite itself uses a filesystem path, not a database credential.
