# Backend Authentication and Authorization Rules

## Current implementation status

The API uses an injected `TokenVerifier`. `ApprovalApiRouter` accepts a Bearer token, asks that verifier for an authoritative `AuthContext`, and rejects missing, invalid, expired, unauthenticated, malformed, or unsupported-role contexts with `401`. It validates `actorId`, `role`, `isAuthenticated`, and an optional `sessionId` before passing identity to the service.

The only concrete verifier currently in this repository is `InMemoryTokenVerifier`, which is intended for tests and local development. The repository does not configure an identity provider, token issuer, cryptographic JWT verifier, session store, or live server deployment. Test tokens registered in memory are not live authentication. A deployment must supply a verifier that validates issuer, audience, signature/session, expiry, revocation, and maps the verified subject and role to `AuthContext`. It must fail closed when those checks cannot complete.

Approval requests and action bindings can use the SQLite adapter. Trusted-contact relationships, invitations, action ownership, and token registrations remain in-memory in the current implementation. They are lost on process restart and are not yet a durable live authorization source.

## Authorization rules enforced by the current service

| Operation | Required identity and relationship |
| --- | --- |
| Create approval request | Authenticated actor becomes `requesterId`; action ownership is checked server-side; persistent service creation requires an active trusted contact. Client-supplied requester, status, decision, or binding identity is rejected. |
| Read request or binding | Request owner, active designated trusted contact, or administrator. Unauthorized and missing records use opaque access-denied behavior where the route supports it. |
| List pending approvals | Only requests whose requester has an active relationship with the authenticated contact are returned. Expired requests are excluded. |
| Approve or reject | Active designated contact or administrator; self-approval is rejected; request must still be pending and unexpired; the decision is committed atomically with its action binding when present. An approval does not continue the browser action. |
| Cancel request | Request owner only; only a pending request can be cancelled. |
| Create/list/revoke invitation | Authenticated ward creates and manages their own invitations. Invitation acceptance requires an authenticated actor, a pending unexpired invitation code, and rejects self-acceptance and duplicate active relationships. |
| List/revoke trusted contacts | Ward identity from the verified context scopes the list and revoke operation. Revoked relationships no longer pass `isTrustedContactForUser`. |
| Invalidate action binding | Request owner or administrator. |

The relationship registry checks both the contact identifier and ward identifier and requires `TrustedContactStatus.ACTIVE`. Pending, revoked, missing, and cross-ward relationships do not authorize review. Invitation acceptance checks expiration, revocation, prior acceptance, self-invitation, and duplicate active relationships.

## Dashboard boundary

The dashboard does not authenticate users itself. Its `apiClient`, token provider, and initial profile are injected by a host application. Standalone auto-mount does not create a session or a live API client. A successful invitation acceptance establishes a relationship; it does not establish authentication. The dashboard therefore preserves an existing authenticated profile if supplied and does not invent a local actor or authenticated state.

Dashboard labels and profile data are presentation state only. Backend authorization is enforced by the verifier and approval service on every protected request; a dashboard role or local approval status does not grant access.

## Privacy and operational requirements for a live deployment

- Never accept `actorId`, roles, or authentication status from request JSON. Derive them from a successfully verified server session/token.
- Treat a missing, expired, revoked, malformed, or unverifiable credential as unauthenticated. Do not fall back to an in-memory identity or permissive mode.
- Do not log bearer tokens, session identifiers, invitation pairing codes, or request bodies. Invitation logging records identifiers and lifecycle metadata only.
- Keep issuer secrets and signing keys on the server. Do not bundle them into the extension or dashboard.
- Persist contact relationships and invitation lifecycle in an authoritative store before treating this persistence adapter as a live multi-user authorization service.
- Exercise route authorization against the real provider and durable relationship store before pilot use. Current tests use synthetic identities, in-memory verifier/relationship fixtures, and local SQLite; they do not verify a live provider or deployment.
