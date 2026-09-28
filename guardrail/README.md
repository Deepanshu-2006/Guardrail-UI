# Guardrail UI

Guardrail UI is a real-time safety, observability, and policy enforcement system designed to monitor, inspect, and guard automated browser interactions and user workflows.

## Monorepo Architecture Overview

The repository is structured into distinct, decoupled components to maintain clean separation of concerns:

```text
guardrail/
├── extension/    # Manifest V3 browser extension (inspection & monitoring foundation)
├── server/       # Backend API, WebSocket gateway, policy engine (future phase)
├── dashboard/    # Observability & management UI (future phase)
├── demo-sites/   # Mock target applications for testing security scenarios (future phase)
├── docs/         # Architectural blueprints and engineering specifications
└── README.md     # Project root documentation
```

## Component Roles & Boundaries

| Component | Responsibility | Future Technologies |
| :--- | :--- | :--- |
| **`extension/`** | Browser client capturing interaction events and enforcing client policies | TypeScript, Manifest V3, Web Extensions API |
| **`server/`** | Central security brain, validation rules, session coordination | Node.js / Python, REST, WebSockets |
| **`dashboard/`** | Real-time monitoring, event inspection, and policy management | React / Modern Frontend |
| **`demo-sites/`** | Controlled target web apps (e.g., e-commerce, banking) to simulate workflows | Static / Mock Web Apps |
| **`docs/`** | Architecture designs, threat models, API contracts | Markdown |

---

## Current Status: Day 1 Foundation

- **Project Scaffolding:** Initial directory layout initialized.
- **Extension Skeleton:** Clean TypeScript + Manifest V3 baseline established without active interceptors or business logic.
- **Build System:** Lightweight build pipeline with type checking.

For details on running and testing the extension foundation, see [`guardrail/extension/README.md`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/extension/README.md).
