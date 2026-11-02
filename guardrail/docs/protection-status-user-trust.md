# Protection Status and User Trust

**Date:** 2026-11-03  
**Scope:** Status wording and evidence boundaries across Staging Mode, controlled interception, and trusted-contact dashboard. The existing state machines and components were retained.

## Summary

Reviewed the extension status model and modal, content-script interception messages, continuation outcomes, dashboard pending/empty states, and dashboard request detail banners. Found user-facing copy that overstated what Guardrail's state records prove: Staging Mode said no page state or network activity had changed; dashboard approval records were described as proof that an action remained held in a user's tab; and an invalid local action was represented by a status object that asserted `isActionHeld: true`.

Updated those messages and corrected the local-invalid status model. Approval remains a server-recorded decision only. Dashboard copy now explains that it cannot inspect local browser state. Staging copy is limited to the supported test interaction, reports cancellation only when its configured cancellation handler reports success, and explicitly allows for independent page-script activity. The continuation success state reports that the controlled handler completed after checks and confirmation; it does not claim to validate effects outside that handler.

## Status and evidence map

| State | Evidence/source | User-facing boundary |
|---|---|---|
| Detected / evaluated | Content-script detector, classifier, risk and response pipeline | Detection and evaluation alone are not reported as interception. Ambient PROTECT decisions explicitly disclose that the action was not held. |
| Warning | Advisory warning UI for WARN response | Warning is advisory; the action is not held and no interception record is created. |
| Held / staged | Supported test-action event synchronously cancelled and interception controller record transitioned to HELD | Staging copy names the supported test interaction, not arbitrary websites. It notes independent page scripts may still act. |
| Approval pending | Validated server response reports PENDING | Extension reports pending review. Dashboard reports only server request status and says it cannot verify the current browser tab. |
| Approval approved/rejected/expired/cancelled | Validated server lifecycle status and decision metadata where required | Approval does not run an action. Rejection/expiry/cancellation status does not claim to prove current local browser state. |
| Continuation authorized | Continuation validation service checks action, request/binding, expiry, context and policy, before explicit user confirmation | Authorization is an eligibility result; it is not described as execution. |
| Controlled continuation completed | Continuation handler returns success and lifecycle record transitions to CONTINUED | UI reports handler completion after checks and confirmation, without guaranteeing effects outside that controlled handler. |
| Service unavailable / outcome unknown | Failed status lookup, transport error, or unavailable continuation validation | The dashboard and extension show unavailable/unknown states. They do not infer approval or successful protection from a sent request. |

## Changes made

- `extension/src/staging/status.ts`: softened held-action explanation, made approval wording explicit about no automatic execution and local revalidation, removed browser-state claims from rejection, and added an explicit unavailable fallback state. `isActionHeld` is now boolean; `local_invalid` and unknown fallback do not claim the action is held.
- `extension/src/staging/modal.ts`: aligned both initial/rendered held messages, cancellation confirmation, and continuation success copy. Unexpected validation/continuation/cancellation/approval-handler exceptions now produce generic user-facing text instead of exposing exception messages.
- `extension/src/staging/test-staging-ui.ts` and `extension/src/staging/verify-staging-workflow.ts`: cover truthful held/cancelled/approved/unknown/local-invalid copy and synthetic sensitive-looking values.
- `dashboard/src/components/detail.ts`: approval lifecycle banners distinguish server approval status from current browser action state and explain local revalidation and explicit confirmation.
- `dashboard/src/components/pending.ts`: request-list intro and empty state no longer imply all actions were evaluated or resolved.
- `dashboard/src/tests/test-dashboard-shell.ts`: verifies that dashboard status copy does not claim local interception and that approval does not imply execution.

## Controls and authorization

The text changes do not alter controls or authorization. Existing continuation code still validates eligibility, requires explicit confirmation, uses the registered supported handler, and only transitions to `continued` when that handler reports success. Approval synchronization remains status-only. Dashboard approve/reject controls submit server decisions and do not trigger browser continuation.

## Verification

Commands run:

```text
cd guardrail/extension && npm run test:staging-ui && npm run test:verify-staging
cd guardrail/dashboard && npm run test:shell
```

- Extension Staging UI: **PASS, 343/343**.
- Extension staging workflow verification: **PASS, 102/102**.
- Dashboard shell: **PASS, 315/315**.

The dashboard test first failed one assertion that expected the prior wording, then passed after the assertion was updated to the new copy. These are Node/esbuild UI and workflow tests with mock DOM/test handlers. No browser-level run or arbitrary ambient-page protection was verified.

## Remaining limitations

- The held guarantee remains limited to controlled test actions where synchronous event cancellation and the controller's HELD state are verified. Arbitrary website JavaScript and network requests cannot be universally blocked by the extension.
- Dashboard approval records do not provide live visibility into whether the ward's local action is still held. The extension performs its own local checks before continuation.
- A successful controlled handler result verifies only that handler's reported completion; it does not establish downstream website effects or universal safety.
