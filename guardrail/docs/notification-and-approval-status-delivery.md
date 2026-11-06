# Notification and approval status delivery

## Supported channels today

- **Trusted-contact invitation email:** The server can submit invitation email through the configured Resend adapter. A `SUBMITTED` result means Resend accepted the request; it does not confirm inbox delivery. Delivery is idempotency-keyed and invitation tokens are not written to logs or included in the email URL.
- **Approval request availability:** There is no approval-request email, browser push, WebSocket, or server-sent-event channel. The authenticated trusted-contact dashboard reads `GET /api/v1/approvals/pending` on a 10-second polling interval. It pauses while the page is hidden and refreshes when the page becomes visible. Manual refresh remains available.
- **Decision status for the requester:** The extension's existing `ApprovalStatusSyncClient` polls the authenticated approval lookup while a supported action is held. The authoritative status response updates the UI; errors remain errors and do not become approval. A status update never executes the action.
- **Invitation lifecycle:** Acceptance and revocation are persisted by the backend and can be read through authenticated invitation APIs. There is no separate email or real-time notification to the inviter when an invitation is accepted. Invitation rejection is not a supported lifecycle state or API operation in the current model.

## Authorization and payload limits

Notifications are informational only. Every dashboard list, invitation lookup, approval lookup, and decision remains protected by backend authentication and relationship authorization. The dashboard must refresh from those APIs rather than treating a notification or cached client status as authority. Approval records sent to an authorized reviewer contain the existing sanitized approval summary; no raw form values, credentials, OTPs, payment data, or action execution command are added to notification payloads.

## Operational limitations

Polling is eventual and can be delayed by the interval, a hidden page, network failure, or an expired session. The interface must preserve its unavailable/unknown state when refresh fails. Resend is currently used only for invitation creation; its delivery provider is not used for approval decisions or invitation acceptance events. No real push or WebSocket capability is configured.
