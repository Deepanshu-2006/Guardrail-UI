# Recovery and Workflow Regression Report

## Summary

Focused recovery verification found no confirmed runtime defect in the paths exercised. The first test runs exposed stale assertions left behind after protection copy was clarified: one expected a denied request to use “denied” in the detail, another described an invalid local action as still held, and other tests matched obsolete approval wording. The UI state model accurately reports a rejected request, reports `local_invalid` as not held, and says approval does not run an action. I corrected the assertions and added a direct check that an approved status still leaves the action held.

No production/runtime implementation was changed. Verification uses unit tests, simulated failure cases, and repository-local HTTP/TCP fixtures; it does not verify a deployed backend or a real browser extension runtime.

## Recovery mechanisms inspected

| Mechanism | Implementation and observed behavior |
| --- | --- |
| Configuration load and recovery | `extension/src/config/loader.ts` and `extension/src/config/test-policy-config-loader.ts`: concurrent loads share work; failures are explicit `FAILED`; retry attempts are cooled down unless forced; a successful validated reload restores health; recovery leaves held actions held. |
| Approval submission | `extension/src/approval/submit-operation.ts` and `extension/src/approval/test-submit-operation.ts`: no blind retry after timeout, network drop, or server error because server outcome may be uncertain. The action remains held; reconciliation is a controlled status probe. Active submissions are deduplicated in-process. |
| Approval status polling | `extension/src/approval/sync-client.ts` and `extension/src/approval/test-approval-status-sync-client.ts`: polling has bounded duration, backoff, maximum consecutive errors, stop conditions, and teardown. Transport errors and malformed responses are not approval. Status retrieval never executes the action. |
| Cancellation, expiry, and invalidation | `extension/src/approval/test-approval-binding-invalidation.ts`, `extension/src/interception/test-continuation-authorization.ts`, and `extension/src/interception/test-workflow-consistency.ts`: terminal or expired bindings fail continuation checks; delayed approval cannot revive them; held closures are detached on invalidation/navigation. |
| Dashboard refresh | `dashboard/src/shell.ts` and `dashboard/src/tests/test-dashboard-sync.ts`: a manual retry triggers a new backend fetch; successful empty results become `empty`, failures remain `error`; concurrent fetches are collapsed and sequence numbers discard stale responses. |
| User-facing recovery state | `extension/src/staging/status.ts` and `extension/src/staging/test-user-facing-failure-recovery.ts`: unknown and malformed server state remain non-approved; local invalidation is explicitly not represented as held; approval copy requires local revalidation and explicit user confirmation. |

## Test scenarios and results

| Scenario | Expected result | Actual result |
| --- | --- | --- |
| Missing, malformed, and unavailable policy storage; retry and recovery | Health reports failure, decisions fail closed, successful validation is required to recover | **PASS** — `npm run test:config-loader`, 126/126 |
| Approval submission timeout, network failure, server error, and duplicate request | Unknown result is not approval; action remains held; no blind retry or continuation | **PASS** — `npm run test:approval-submit`, 103/103 |
| Approval lookup failure, malformed data, polling cutoff, teardown, and connection loss | `isApproved` stays false without valid authoritative approval; polling stops safely | **PASS** — `npm run test:approval-sync-client`, 173/173, including a local HTTP server and local connection-refusal scenario |
| Expired, cancelled, invalidated, and delayed approval states | Invalid bindings remain unusable and cannot continue | **PASS** — `npm run test:approval-invalidation`, 57/57 |
| Continuation with unknown backend state, mismatched identity, expiry, or duplicate attempts | Continuation is denied; no handler execution without explicit supported continuation | **PASS** — `npm run test:continuation-auth`, 58/58 |
| Warning, pending, rejected, expired, malformed, and invalid local UI recovery states | Messages match state; unknown authorization is not approval; dismissal does not continue | **PASS** — `npm run test:failure-recovery`, 76/76 |
| Lifecycle, cancellation, delayed messages, and approval status | Approval leaves the action held until explicit confirmation; stale state cannot revive terminal actions | **PASS** — `npm run test:workflow-consistency`, 22/22 |
| Dashboard refresh failure and retry | Failure remains visible; retry uses a fresh response; an authoritative empty response clears the error | **PASS** — `npm test` in `dashboard`, all four configured suites passed, including `test:sync` (52/52) and complete synchronization (135/135) |
| Dashboard local-service decisions, unavailable service, malformed data, and no automatic action execution | Errors do not show false success; server decision/status remains distinct from browser continuation | **PASS** — included in dashboard `npm test`; `verify-day12-workflow` runs against a repository-local HTTP server and local TCP refusal fixture |

### Initial failures corrected

The initial run of `npm run test:failure-recovery` failed 2 of 73 assertions because tests expected wording and state claims that no longer matched the implementation. After correction, it passed 76/76, including new assertions for truthful local invalidation and no execution after approval recovery.

The first `npm run test:workflow-consistency` run failed one string assertion expecting obsolete copy. The first dashboard `npm test` run stopped on one assertion expecting the phrase “remotely execute” in a note whose current text says decisions “do not execute or trigger” an action and require explicit confirmation. Those tests were aligned to the current, stronger wording. Reruns passed: workflow consistency 22/22; dashboard `npm test` exit 0.

## Files changed

- `extension/src/staging/test-user-facing-failure-recovery.ts` — corrected two stale expectations and added approval-recovery held-state checks.
- `extension/src/interception/test-workflow-consistency.ts` — aligned its approval message assertion to current wording and explicit confirmation requirement.
- `dashboard/src/tests/verify-day12-workflow.ts` — verifies the current decision notice says it does not execute or trigger an action and requires explicit user confirmation.
- `docs/recovery-workflow-regression-report.md` — this inventory and test record.

## Remaining limitations

- No live remote approval backend, credentialed service, or production storage was exercised. Repository HTTP/TCP fixtures are controlled local services.
- No browser-level extension lifecycle or user-assisted continuation was run as part of this verification.
- Cross-process or distributed exactly-once behavior is not established by the in-memory submission and continuation guards.
- Retry of approval creation is intentionally not automatic after an ambiguous outcome; a user or caller must use the existing reconciliation/status path.
- Ambient websites are outside the reliable interception boundary. These tests cover controlled workflows and do not establish universal interception.
