# Guardrail Approval Backend

## Backend and storage

The backend uses SQLite through `better-sqlite3`, isolated from extension and dashboard bundles. Approval requests, action bindings, invitations, and trusted-contact relationships persist in the configured SQLite file. Approval transitions and invitation acceptance use SQLite transactions/conditional updates. This is durable storage for a single backend instance, not a horizontally scaled production database.

The database stores validated approval, binding, invitation, and relationship records. It does not store passwords, OTPs, payment-card values, cookies, bearer tokens, raw form values, or plaintext invitation tokens. The SQLite file is created with owner-only permissions where supported. High-entropy invitation tokens are returned only in the creation response and stored as SHA-256 hashes; the hash is retired on acceptance, expiry, or revocation. Each invitation is bound to the intended active trusted-contact identity. Where the identity provider supplies issuer-signed `email` with `email_verified: true`, that verified address is retained for invitation delivery. Invitation lifecycle timestamps are retained for auditing.

## Run the persistence tests

Requires Node.js 20 or newer and native build tooling for the `better-sqlite3` package.

```sh
cd guardrail/server
npm install
npm test
npm run type-check
npm run build
```

`npm test` runs the following checks:

- `test:sqlite` uses temporary, file-backed SQLite databases to verify persistence and transactional behavior. This is a real SQLite integration test.
- `test:api` starts the Node HTTP API on a local TCP port and exercises it through the existing `ApprovalApiClient` using a temporary SQLite database. It verifies invitation ownership, acceptance, expiration, revocation, restart durability, pending review retrieval, approve/reject, and persisted status. The token verifier in this test is synthetic and in-memory; it does not verify a live identity provider.
- `test:oidc` verifies JWT signatures and claims with locally generated RSA keys, a local JWKS resolver, and in-memory SQLite. It does not connect to a live identity provider.
- `test:delivery` uses a temporary SQLite file and mocked Resend HTTP responses to test verified-recipient addressing, provider submission and failure, token hashing, expiry, and duplicate suppression. It does not send email.

## Use the adapter

`startGuardrailHttpServer()` composes `ApprovalApiRouter`, the existing API routes, and SQLite persistence. It requires an injected `TokenVerifier`; tests may inject a synthetic verifier, while the standalone server uses the backend OIDC verifier. The database location is selected with `GUARDRAIL_DB_PATH`; the default is `data/guardrail.sqlite` relative to the server process working directory. Call the returned `close()` during shutdown. Initialization fails closed if the database cannot be opened. The default bind address is loopback (`127.0.0.1`); configure an HTTPS reverse proxy before remote use.

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
| `GUARDRAIL_OIDC_ISSUER` | Required by standalone server; exact HTTPS token issuer. | Required; exact issuer configured for the provider's access tokens. |
| `GUARDRAIL_OIDC_AUDIENCE` | Required API audience identifier. | Required; exact audience expected in API access tokens. |
| `GUARDRAIL_OIDC_JWKS_URL` | Required HTTPS public-key endpoint on issuer origin. | Required; provider's public signing keys endpoint. Private signing keys remain with the provider. |
| `GUARDRAIL_OIDC_ROLE_CLAIM` | Required name of the issuer-signed role claim. | Required; provider must issue exactly one of `USER`, `TRUSTED_CONTACT`, or `ADMIN`. Configure role assignment at the identity provider. |
| `RESEND_API_KEY` | Optional; if omitted, invitation delivery is disabled. | Resend API key, backend only. |
| `GUARDRAIL_EMAIL_FROM` | Required with Resend key and dashboard URL; verified sender address. | Sender address verified with Resend. |
| `GUARDRAIL_DASHBOARD_URL` | Required with Resend key and sender; credential-free HTTPS dashboard URL. | Trusted-contact dashboard URL; invitation code is sent separately in the email body and is never embedded in a URL. |

Example pilot environment (replace the sample origins and filesystem path with values for the controlled test environment):

```sh
export GUARDRAIL_ENV=pilot
export GUARDRAIL_DB_PATH=/var/lib/guardrail/pilot.sqlite
export GUARDRAIL_ALLOWED_ORIGINS='chrome-extension://<installed-extension-id>,https://dashboard.example.test'
export GUARDRAIL_HOST=127.0.0.1
export GUARDRAIL_PORT=3000
export GUARDRAIL_OIDC_ISSUER='https://<tenant>.auth0.com/'
export GUARDRAIL_OIDC_AUDIENCE='https://api.example.test/guardrail'
export GUARDRAIL_OIDC_JWKS_URL='https://<tenant>.auth0.com/.well-known/jwks.json'
export GUARDRAIL_OIDC_ROLE_CLAIM='https://guardrail.example/role'
# Optional email delivery; configure all three together after verifying the sender and dashboard.
export RESEND_API_KEY='re_...'
export GUARDRAIL_EMAIL_FROM='invites@example.test'
export GUARDRAIL_DASHBOARD_URL='https://dashboard.example.test/'
npm ci
npm run build
npm start
```

`npm start` runs `dist/serve.mjs`. It validates server, OIDC, and paired optional email settings, opens the SQLite identity mapping store, and constructs the OIDC verifier before opening the API listener. Startup fails closed if required configuration or storage is unavailable. This is an Auth0-compatible OIDC/JWKS verifier, not a configured Auth0 tenant: no tenant, client registration, frontend login flow, provider-side role mapping, or deployment is included. The extension/dashboard must obtain access tokens from a separately configured identity-provider client and send them as bearer tokens. Provider secrets must not be put in frontend bundles.

### Health and readiness

- `GET /health` is a liveness response. It returns only `{ "status": "ok" }` while the HTTP process is serving requests; it does not claim the database is ready.
- `GET /ready` executes `SELECT 1` against the actual SQLite approval repository and returns `{ "status": "ready" }` with HTTP 200, or a sanitized `{ "status": "not_ready" }` with HTTP 503 if the query fails. It does not return paths, connection details, exception text, or credentials.
- Health routes allow CORS only for the configured exact origins (or existing local development origins). CORS is a browser access rule and does not replace API authentication.

### Schema initialization and upgrades

Opening the approval repository applies its versioned schema migration transactionally before the server begins listening. That schema uses SQLite `user_version`; startup fails closed if the database cannot be opened or its version is newer than the application supports. The trusted-contact registry adds its recipient and lifecycle columns idempotently at startup. Legacy accepted invitations are bound to their recorded accepter; old pending invitations are revoked because their original schema did not identify an intended recipient. There is no standalone migration CLI. For a controlled test upgrade, stop the single server instance, make a protected backup of the database (including any needed WAL state using SQLite's backup facility or after a clean shutdown), deploy the tested build, then start it so initialization runs. Confirm `/ready` before directing test clients to it. Do not copy a live database into source control or frontend assets.

## Current boundaries

- SQLite persists approval requests, action bindings, invitations, and trusted-contact relationships. User identity records, token/session records, and distributed rate limits are not implemented here.
- The standalone server verifies issuer-signed RS256 tokens using remote JWKS and checks issuer, audience, expiry, subject, and a signed role claim. It maps `(issuer, subject)` to stable internal SQLite user records. A live provider is not configured: no tenant, client registration, login/session flow, role assignment, revocation feed, TLS proxy, or deployed backend exists. Locally recorded JTI revocations and disabled identity records are enforced; provider revocation is not automatically synchronized.
- The extension API client already supports the API contract when given a server URL and authenticated token provider. The dashboard `DashboardShell` also accepts that client, but its standalone mount does not provide authentication/session setup; a host application must inject the authenticated client. Invitation acceptance creates a relationship, not a login session.
- Action ownership data remains runtime-specific unless the host supplies its own `ActionOwnershipRegistry`; it is not part of this persistence adapter.
- SQLite is intended for a single backend instance. Multi-instance deployment requires a shared transactional database adapter and database-level concurrency guarantees.
- Resend is integrated through a backend-only HTTP adapter using Node's built-in `fetch`; no additional package is required. No Resend credentials or verified sender are configured in this repository, so the current standalone server reports `NOT_CONFIGURED` until the three email settings are supplied. Tests use mocked provider responses and do not send mail.
- Invitation creation requires the recipient's existing internal actor ID; the backend verifies that it maps to an active `TRUSTED_CONTACT` identity. The recipient identity must be communicated to the issuer out-of-band before creating an invitation. Verified email matching is not implemented and email addresses are not used as proof of identity.
- Delivery status `SUBMITTED` means Resend accepted the request; it does not prove inbox delivery. Provider/network failures remain `FAILED`; no invitation is described as delivered. The email contains only generic setup instructions, the invitation code, expiry, and the configured dashboard URL. The email URL contains no token, and the current client submits the code in the acceptance POST body rather than the request path.
- Authenticated `GET /api/v1/identity` returns only the caller's verified internal actor ID and role, so a trusted contact can share the correct ID without decoding client-side token claims. No profile or email attributes are returned.
- Database files, WAL files, build output, and `.env` files are ignored by Git. No database credentials are compiled into frontend bundles; SQLite itself uses a filesystem path, not a database credential.
