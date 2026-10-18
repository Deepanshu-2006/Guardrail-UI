# Guardrail Server (Future Scope)

## Overview
This directory will host the backend service responsible for:
- Evaluating security policies and anomaly detection rules.
- Providing WebSocket channels for live event streaming.
- Storing audit trails and session logs.
- Serving REST/GraphQL endpoints for the admin dashboard.

## Status & Persistence Notice
*Out of scope for Day 1.* No server components, backend frameworks, or database layers are installed yet in `guardrail/server`.

### Approval Request Persistence Status
- **Current State**: The strongly typed `ApprovalRequest` domain model, deterministic lifecycle state machine, and validation engine are implemented in `guardrail/extension/src/approval/model.ts`.
- **Persistence**: Approval requests are **NOT yet persisted** to a database. They exist as in-memory domain models and serialized message payloads across the extension runtime.
- **Future Backend (Day 10+)**: When persistent storage is introduced in this directory, the database schema (e.g. PostgreSQL/SQLite `approval_requests` table) will strictly adhere to the contract established in [`guardrail/docs/approval-workflow-contract.md`](../docs/approval-workflow-contract.md).

