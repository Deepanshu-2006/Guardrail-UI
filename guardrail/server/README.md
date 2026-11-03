# Guardrail Approval Persistence

## Storage choice

The repository had no configured database. This backend package uses SQLite through `better-sqlite3`, isolated from the extension and dashboard packages. SQLite provides durable local storage and transactional compare-and-swap for a single backend instance without introducing a separate database server.

The database stores validated approval request and action-binding records. It does not store passwords, OTPs, payment-card values, cookies, bearer tokens, or raw form values. Records pass the existing approval and binding validators before writes and after reads. The database file is created with owner-only permissions where supported.

## Run the persistence tests

Requires Node.js 20 or newer and native build tooling for the `better-sqlite3` package.

```sh
cd guardrail/server
npm install
npm test
npm run type-check
npm run build
```

`npm test` uses temporary, file-backed SQLite databases. It verifies create/read, close-and-reopen durability, service reconstruction, user-scoped reads, status/binding transactions, invalid record rejection, and safe connection failure handling. It is a real SQLite integration test, not a database mock.

## Use the adapter

`createPersistentApprovalService()` composes the existing `ApprovalService` with `SqliteApprovalRequestRepository`. The database location is selected with `GUARDRAIL_DB_PATH`; the default is `data/guardrail.sqlite` relative to the server process working directory. Call the returned `close()` during shutdown. Initialization fails with `APPROVAL_DATABASE_UNAVAILABLE` if the database cannot be opened or migrated; request handling must not fall back to the in-memory repository.

```ts
import { createPersistentApprovalService } from './dist/index.mjs';

const runtime = createPersistentApprovalService({
  contactRegistry: configuredContactRegistry,
  actionOwnershipRegistry: configuredActionOwnershipRegistry,
});
// Mount runtime.service in ApprovalApiRouter with the application's TokenVerifier.
// Close runtime.close() during graceful shutdown.
```

The service factory requires an active trusted contact for new requests. Supply the application's real contact and action-ownership registries; defaults are memory-backed and are not suitable for a live deployment.

## Current boundaries

- `SqliteApprovalRequestRepository` persists approval requests and action bindings. It does not yet persist user identities, trusted-contact relationships, invitations, token/session records, or rate limits.
- No production token verifier or server deployment entry point is included. The factory accepts dependency injection but does not create or validate identities itself. Do not expose the router as a live service until a real verifier and durable relationship registries are supplied.
- SQLite is intended for a single backend instance. Multi-instance deployment requires a shared transactional database adapter and database-level concurrency guarantees.
- Database files, WAL files, build output, and `.env` files are ignored by Git. No database credentials are compiled into frontend bundles; SQLite itself uses a filesystem path, not a database credential.
