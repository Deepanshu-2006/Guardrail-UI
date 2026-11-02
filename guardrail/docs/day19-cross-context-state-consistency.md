# Day 19 Prompt 3 — Cross-Context State Consistency

**Date:** 2026-11-02  
**Scope:** State ownership and synchronization review of the current extension, approval modules, and dashboard. This is not a multi-context browser verification.

## State ownership map

| State | Authoritative owner | Synchronization | Lifetime and limits |
|---|---|---|---|
| Policy configuration | Validated `PolicyConfigRegistry` instance in each JavaScript context; persisted candidate in `chrome.storage.local` under `GUARDRAIL_POLICY_CONFIG_STORAGE_KEY` (`config/loader.ts`) | Content scripts and service worker load on activation and listen to `chrome.storage.onChanged`; reload reads validate/merge before registry replacement. A trailing reload now handles changes received during an active read. | Storage value can persist; each tab and worker has its own in-memory registry and health. Health is not a globally shared authority. Browser propagation was not exercised in this test run. |
| Configuration health | Each context's registry (`config/registry.ts`) | Set from load/reload result; listeners are context-local. | In memory; resets to `UNINITIALIZED` on new context. A failed load is explicit `FAILED`; no context can infer another context's health. |
| Detected actions | Content script running in a specific tab (`detector/`, `content/index.ts`) | Sanitized `GUARDRAIL_ACTION` message to the service worker (`utils/messaging.ts`). | In-memory per tab while page/content context exists. Action IDs are generated with `crypto.randomUUID()` where available. Ambient observations are not held actions. |
| Staged/interception state | Content-script `defaultInterceptionController` and `defaultContinuationManager` | A sanitized interception record is mirrored to the background controller; staging UI stays in content context. | Content-side action continuation closure and DOM reference are transient and never restored from storage. Background mirror is worker memory and can disappear on worker termination. |
| Approval status | `ApprovalService`/repository in `approval/service.ts` and `approval/repository.ts` when the in-process API is used | API client retrieval and `ApprovalStatusSyncClient` polling; response schemas and IDs are checked. | The repository is explicitly in-memory development storage. There is no deployed backend in `guardrail/server/`, so there is no durable production authority in this repository. Client status is a display/synchronization result, never action authorization by itself. |
| Action-to-approval binding | Approval service binding repository (`approval/binding.ts`, `approval/repository.ts`) | Validated through approval request/action IDs and digest checks in the domain/API path. | In-memory with the current repository implementation. A new process loses the binding; client messages cannot make an unverified status authoritative. |
| Continuation lifecycle | Content-side `ContinuationManager` plus `InterceptionController` state machine | Explicit user confirmation after status synchronization and local validation. | Tab/page memory only. Approval updates do not execute the action. Context loss drops the closure; the action is not replayed or reconstructed. |
| Dashboard view state | `DashboardShell` in `dashboard/src/shell.ts` | API client fetches, polling, authoritative decision responses, in-memory per-request sequence guards. | In-memory for the dashboard page. The standalone auto-mount has no API client by default; test-provided initial data/mock clients are not production authority. |

## Synchronization review

- Policy config payloads pass schema validation/default merging in the loader before registry replacement. `HEALTHY`, `DEGRADED`, and `FAILED` are local health states, not a synchronized cross-tab health service.
- `ApprovalStatusSyncClient` validates request IDs, request models, statuses, and decision metadata. Per-subscription polling rejects concurrent polls, tracks response sequence, preserves terminal status, and does not invoke continuation. The background status handler additionally checks requested approval ID, action ID, and response status consistency.
- Dashboard pending/detail requests use monotonically increasing local request sequence numbers to discard late responses. Decisions are not optimistically treated as authoritative; successful server responses update the UI.
- Approval binding is checked by action and approval identifiers in the domain/API. The tests exercise mismatched action/request results and status updates that leave actions held.
- Action records and the background's mirror are keyed by generated action ID. Each content script owns its own continuation objects. No browser multi-tab test was available, so tab isolation at actual runtime messaging boundaries is not claimed here.
- Restart recovery is intentionally limited: configuration reloads from storage, but action closures, controller records, approval repositories, and bindings are not durable. A stale approval response cannot restore a content-script closure that no longer exists.

## Confirmed correction

The previous registry `reload()` delegated directly to a loader that coalesces concurrent reads. If a second storage-change notification arrived while the first read was in flight, it could join that read; if the second change occurred after the read's storage snapshot, the registry could remain on the older candidate. `PolicyConfigRegistry.reload()` now records a queued reload and performs one trailing read after the current read settles. It continues to use the existing loader, validation, and health model.

## Verification

Commands were executed from `guardrail/extension` or `guardrail/dashboard` on 2026-11-02:

| Command | Outcome | Level |
|---|---|---|
| `npm run test:config-loader` | **PASS, 126/126 assertions.** Includes delayed storage mutation during a reload, queued trailing read, latest config applied, loader failure health, and startup-barrier helper behavior. | Unit/in-process |
| `npm run test:boundary-hardening` | **PASS, 86 assertions, 0 failures.** Includes synchronous startup suppression and duplicate detector start/stop listener checks. | Unit/mock DOM |
| `npm run test:approval-sync-client` | **PASS, 173/173 assertions.** Includes in-memory cases and a local HTTP test server; no production service. | Unit/in-process HTTP |
| `npm run test:staging-sync` | **PASS, 82 assertions.** Includes stale/out-of-order status handling, duplicate updates, and no continuation on status alone. | Unit/mock DOM and local HTTP |
| `npm run test:approval-status` | **PASS, 92/92 assertions.** Includes wrong action binding rejection and no automatic execution. | Unit/in-process |
| `npm test` (`guardrail/dashboard`) | **PASS, exit 0.** Dashboard sync reports 135/135 and workflow reports 104/104; shell and remaining configured suites also completed. | Unit/mock DOM and local HTTP |
| `npm run build` (`guardrail/extension`) | **PASS, exit 0.** | Build |

No live browser, true multi-tab extension runtime, or deployed API was exercised. Local HTTP test servers are in-process test fixtures, not production integration.

## Remaining limits

- Configuration update propagation is tested at registry/loader level, not through actual `chrome.storage.onChanged` across live tabs and a service worker.
- Background action mirrors, approvals, and bindings are not durable and do not provide distributed ordering or exactly-once guarantees.
- A dashboard's local cache and displayed status are not independent authorization. Only the server's authenticated decision is authoritative when a real server exists; that server is not included here.
- No synchronization event triggers continuation. Explicit in-tab user confirmation and existing continuation checks remain required.
