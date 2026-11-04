# Identity and Remote Connectivity Audit

## Executive summary

Guardrail contains server-side authorization abstractions, invitation APIs, SQLite persistence, extension/dashboard API clients, and local HTTP test infrastructure. It does not configure a real identity provider, issue or refresh sessions, provide a host authentication adapter, or deploy a reachable backend.

Trusted-contact relationships persist by actor identifier. Whether an identifier belongs to a real, independently verified person depends on the missing host identity provider. Invitation codes are returned by the API for manual out-of-band sharing; no email, SMS, push, or other delivery provider exists.

Remote client use is not ready. The extension background service worker calls the approval client, but extension/public/manifest.json contains no host_permissions or optional_host_permissions for its API hosts. The standalone dashboard mounts without an API client, login/session setup, or token provider. The Day 23 verification also recorded that pilot-api.guardrail-safety.org did not resolve from the verification environment.

**Conclusion:** local persistent API flows work with synthetic identities; genuine authenticated remote connectivity is not implemented or verified.

## Repository state and evidence

- Current branch: main; current commit: 65501a8, following b9c8cc7 (SQLite server) and 7574da8 (authentication/authorization hardening).
- git status showed main...origin/main with one untracked existing file, guardrail/docs/backend-persistence-verification.md. It has been preserved.
- Inspected the Day 23 verification report, backend README/runtime/configuration, extension manifest and auth/client/API code, dashboard bootstrap and API-client boundary, invitation/authorization code, and relevant integration docs/tests.
- This is a source and documentation audit; no tests, remote requests, or implementation changes were made.

## Architecture and identity data flow

Extension background service worker → ApprovalApiClient (base URL and injected/read token) → HTTP Bearer request → ApprovalApiRouter → injected TokenVerifier → authoritative AuthContext → ApprovalService and relationship checks → SQLite approval, binding, invitation, and contact records.

The dashboard host is not supplied by this repository. It must inject an ApprovalApiClient, token provider, and authenticated profile to use the same protected HTTP API.

| Concern | Actual component | Finding |
| --- | --- | --- |
| Server startup | server/src/serve.ts, server/src/http-server.ts | Standalone startup requires absolute GUARDRAIL_AUTH_MODULE exporting tokenVerifier. No provider module or provider config exists in the repo. |
| Token verification | extension/src/approval/api.ts | TokenVerifier.verifyToken returns authoritative AuthContext or undefined. The only concrete verifier is InMemoryTokenVerifier, a process-local map with manual revokeToken deletion. |
| Identity/session model | extension/src/approval/authorization.ts | AuthContext contains actorId, role, isAuthenticated, and optional sessionId. There is no expiry claim, user table, issuer, login, token issuance, refresh, or session store. |
| Persistent relationships | server/src/sqlite-trusted-contact-registry.ts | Invitations and trusted contacts persist by actor IDs. This adapter does not create or independently verify identities. |
| API authorization | extension/src/approval/api.ts, service.ts, authorization.ts | Protected routes authenticate through the injected verifier. Service code scopes records to authenticated actors and active trusted-contact relationships. Invitation creation requires USER/ADMIN; acceptance requires TRUSTED_CONTACT/ADMIN. Client identities are not authoritative. |
| Extension caller | extension/src/background/index.ts, approval/submit-operation.ts | Background handlers call the shared client. It resolves a URL and reads a token from an injected provider, sessionStorage, or chrome.storage.local. It does not acquire a token from an identity provider. |
| Extension network permission | extension/public/manifest.json | Manifest requests only storage and declares neither host_permissions nor optional_host_permissions. The background service worker's cross-origin fetch has no declared permission for local or remote API hosts. |
| Dashboard | dashboard/src/index.ts, shell.ts, types.ts | DashboardShell accepts injected client/profile/session data. Standalone auto-mount supplies only container, environment, and mock flag; it creates no API client or authenticated session. |

## Findings and priorities

### High — No real identity provider or usable server verifier

TokenVerifier is an interface; InMemoryTokenVerifier is the only implementation. server/src/serve.ts exits unless a host adapter is configured. No issuer/audience/signature validation, identity mapping, login, session issuance, refresh, or provider credentials/configuration are present. Synthetic test tokens do not establish real-user authentication.

### High — Extension manifest does not authorize API hosts

The manifest has storage permission only. The service worker sends API requests through ApprovalApiClient, whose configured hosts are localhost:3000, pilot-api.guardrail-safety.org, or api.guardrail-safety.org. Remote requests cannot be assumed to work until narrowly scoped host permission is added to the packaged manifest and verified in the supported browser. CORS does not grant extension host permission.

### High — Standalone dashboard is not authenticated or connected

dashboard/index.html loads the bundle, and dashboard/src/index.ts auto-mounts DashboardShell without apiClient, token provider, or authenticated profile. The shared client works when a host injects it, but no such login/session host is part of this repo. Standalone dashboard use does not make genuine authenticated approval requests.

### High — No remote backend is configured or reachable

server/README.md and the Day 23 report state that no host deployment or TLS endpoint is configured. The prior read-only health probe to https://pilot-api.guardrail-safety.org/health failed DNS resolution. A client URL preset is not evidence of a running service.

### High — Real token expiry and revocation are delegated and unverified

The router validates AuthContext shape and relies on the configured verifier to reject invalid or expired tokens. AuthContext has no expiry field. InMemoryTokenVerifier has no clock-based expiry; its revocation is process-local map deletion. No durable session store or production revocation mechanism is present. A host verifier must check issuer, audience, signature/session, expiry, revocation, and role mapping on every request and fail closed.

### Medium — Trusted contacts have no independently verified identity here

Invitation acceptance binds the relationship to authContext.actorId and SQLite stores that ID. This delegates identity to the verifier, but no verifier or user directory is configured. Possession of the invitation code proves only code possession, not who the invitee is.

### Medium — Extension token acquisition and lifecycle are absent

resolveAuthToken consumes a token from an injected provider or reads guardrailAuthToken from browser storage. Repository search found no sign-in flow or production code that sets this key. The client does not independently inspect token expiry; the server response is authoritative. Tests cover missing/invalid synthetic tokens, not real expiry, refresh, or logout.

### Medium — Action ownership is not durable by default

SQLite persists approval and contact data, but the Day 23 report identifies action ownership as runtime-provided/in-memory unless a host supplies an authoritative registry. Remote deployment must provide that source; in-memory ownership is not restart-safe.

### Medium — Invitation delivery is not implemented

POST /api/v1/invitations creates and returns a code to the authenticated issuer. The invitee accepts it by submitting the code. No email, SMS, push, or notification provider/client exists. API success means a code was created, not delivered.

### Informational — Invitation expiration documentation differs from implementation

extension/src/approval/authorization.ts and server/src/sqlite-trusted-contact-registry.ts default invitations to 24 hours. docs/trusted-contact-setup-and-invitations.md describes a 168-hour default. Explicit ttlMs is supported subject to validation. Align the documentation to avoid expiration surprises.

### Medium — CORS is constrained but real origins are not configured

server/src/runtime-config.ts requires exact origins in pilot/production and rejects wildcard origins. Development defaults include local dashboard origins and a placeholder extension ID. No actual installed extension ID or dashboard origin is configured in a deployed environment. CORS is not authentication and does not resolve missing host permissions.

## Invitation and notification lifecycle

The authenticated issuer creates an invitation code; the server persists its status and expiry; the issuer can list or revoke pending invitations; an authenticated TRUSTED_CONTACT accepts by code; and the server rejects expired, revoked, duplicate, or self-pairing attempts. Accepted relationships persist. The code is shared out-of-band. There is no delivery confirmation or notification event. Acceptance establishes a relationship, not a login session.

## Existing test evidence

The Day 23 verification report records passing temporary-SQLite and local HTTP tests for invitation lifecycle, cross-user isolation, invalid-token rejection, and approval persistence. Server API tests use InMemoryTokenVerifier and synthetic actors. Extension Chromium tests use a local in-memory mock server. Dashboard integration tests use a local in-memory router, not the SQLite server or a live identity provider. No real provider-authenticated test, live notification test, remote extension fetch, or remote dashboard session test exists.

## Requirements before remote connectivity is usable

1. Configure a genuine identity provider and host-side verifier; map provider subjects to stable actor IDs and roles. Test expiry, revocation, logout, refresh, issuer/audience, and provider failure.
2. Implement extension login/session acquisition without bundling provider secrets; decide secure token storage and clearing.
3. Add narrowly scoped API host permissions to the supported browser manifest and verify packaged cross-origin requests.
4. Deploy the server behind HTTPS; configure GUARDRAIL_AUTH_MODULE, persistent action ownership, exact CORS origins, backups, and operational rate limiting.
5. Provide a dashboard host that authenticates trusted contacts and injects the real client, token provider, and server-verified profile.
6. If notifications are required, integrate a real delivery provider and delivery status. Until then, document and test manual code sharing only.
7. Align invitation TTL docs and run extension/dashboard journeys against the real provider and deployed service before describing the system as live.

No implementation changes, external messages, or commits were made for this audit.
