# Day 19 Prompt 4 — Backend and Service Resilience

**Date:** 2026-11-02  
**Scope:** Approval client, submission operation, status synchronization, approval service/router, and existing failure-path tests. No application code was changed because inspection and the targeted checks did not establish a defect requiring a safe, minimal fix.

## Executive summary

The current code distinguishes transport and service failures from success. The client returns typed failures for timeouts, network errors, malformed JSON, HTTP errors, and error envelopes. Submission treats timeout, network loss, and 5xx responses as uncertain, leaves the held action held, and does not automatically retry the non-idempotent create request. Status polling retries transient failures with a bounded count and backoff, and stops for definitive errors or terminal approval states. Status synchronization does not continue actions.

No confirmed Prompt 4 vulnerability or reliability defect was found in the reviewed paths. Existing resilience coverage is substantial at unit and local/in-process integration level. The major operational limitation remains unchanged: there is no deployable backend in this repository. The router and service use development in-memory repositories, registries, token verification, and rate limiting by default. Local HTTP tests are not evidence of production-service availability or durability.

## Components inspected

- `guardrail/extension/src/approval/client.ts` — token and URL resolution, fetch dispatch, timeout/abort handling, JSON/envelope parsing, status mapping, and model validation at API method boundaries.
- `guardrail/extension/src/approval/submit-operation.ts` — local HELD-state precondition, per-action active submission guard, uncertain outcomes, controlled reconciliation, and no continuation on response.
- `guardrail/extension/src/approval/sync-client.ts` — status response validation, polling limits/backoff, terminal status handling, and subscription cleanup.
- `guardrail/extension/src/approval/api.ts` — headless router, route error mapping, stream body parsing/size limit, and safe generic 500 response for unhandled errors.
- `guardrail/extension/src/approval/service.ts` — approval lifecycle and repository abstraction; default development repository and authorization registries are in memory.
- Existing suites: `test-approval-client.ts`, `test-submit-operation.ts`, `test-approval-status-sync-client.ts`, `test-approval-service.ts`, and `test-approval-api.ts`.

## Confirmed protections

- Missing authentication prevents dispatch; request and response credentials and raw bodies are not included in client logs.
- Timeout, connection failure, HTTP 5xx, rate limiting, malformed JSON, invalid response models, and invalid approval records remain failures. The sync client reports `isApproved: true` only for a successfully validated authoritative APPROVED record with decision metadata.
- An approval create timeout/network drop/5xx is treated as uncertain because the server may have processed it. The action remains HELD. There is no automatic resubmission loop for this non-idempotent operation.
- A single controlled reconciliation probe is available for uncertain submission outcomes. Submission is guarded against duplicate concurrent requests for an action in the current process; this is not a distributed exactly-once guarantee.
- Polling retries transient failures only, with a maximum consecutive-error count and capped backoff. It stops on definitive errors and terminal states and has a maximum overall synchronization duration.
- Status updates do not invoke continuation. Existing tests explicitly check that an APPROVED status result leaves the action held and execution count at zero.
- The router maps unexpected internal exceptions to a generic HTTP 500 message; it does not serialize arbitrary exception text into that response. Known validation/authorization/lifecycle errors retain specific safe codes.
- In-memory service operations and the API test suite cover expiry and conflicting concurrent decisions within that test process.

## Limitations and unverified behavior

- `ApprovalService` defaults to `DevelopmentInMemoryApprovalRequestRepository`, `InMemoryTrustedContactRegistry`, and `InMemoryActionOwnershipRegistry`; `InMemoryTokenVerifier` and the sliding-window limiter are also development/test implementations. State and rate limits do not survive process restarts and do not coordinate across replicas.
- `guardrail/server/` has no executable service or durable storage configuration. Test fixtures and a local test HTTP server do not establish live backend behavior, TLS, deployed identity verification, or operational uptime.
- Client-side duplicate submission guards are in-memory only. The code comments correctly qualify server idempotency and concurrent behavior on durable storage as requiring real transactional uniqueness/atomic semantics.
- The existing API client's body-read error result includes an exception message. The inspected message is returned to the client caller, not emitted in logs; no evidence showed sensitive approval/action values in that error. A future production transport should keep error details generic if the underlying platform or fetch implementation can include response content in exception messages.
- No live deployed backend, service restart, persistent storage failure, or browser extension network-permission scenario was available to verify.

## Issues and priority

No confirmed defect was found that meets the prompt's requirement for a minimal fix. The missing production backend and durable infrastructure are already documented as a **release blocker for remote approval**, rather than a newly introduced failure-handling defect. In-memory coordination's inability to provide distributed exactly-once execution is an **operational limitation**.

No code changes or new tests were needed. Existing tests already cover the requested timeout, connection failure, server error, malformed/invalid approval response, duplicate submission, bounded polling, and no-continuation-after-unknown-authorization cases.

## Verification run

Executed from `guardrail/extension`:

```text
npm run test:approval-client && npm run test:approval-submit && npm run test:approval-sync-client && npm run test:approval-service && npm run test:approval-api
```

**Result: PASS, exit 0.** All five scripts in the chain completed. The sync suite reported **173/173 passed**, including its local TCP HTTP fixture and connection-refused scenario. The API suite reported **89/89 passed**. Client, submission, and service suites completed successfully. These are Node/esbuild unit and in-process integration checks. The test suite's local HTTP server is a test fixture, not a production backend. No browser or deployed-service test was run.

## Next steps

1. Keep remote approval marked as not production-ready until a real service, durable repository, production identity verifier, and extension/dashboard wiring exist.
2. When a service implementation is available, add contract and failure-injection tests against that service, including restart and persistence behavior.
3. Preserve bounded polling and the no-automatic-retry rule for approval creation unless a server-backed idempotency mechanism is demonstrated.
4. Verify network permissions and endpoint configuration in a browser-installed extension after those integration pieces exist.
