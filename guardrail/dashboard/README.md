# Guardrail Trusted-Contact Dashboard Shell

A responsive, high-trust web application shell designed for designated trusted contacts (caregivers, family members, or security delegates) to review pending browser actions intercepted by the Guardrail extension.

---

## Architecture & Design Decisions

### 1. Visual & Interaction Philosophy
* **Palette**: Clean white (`#ffffff`) and neutral subtle surfaces (`#f8fafc`, `#f1f5f9`) accented by restrained brand emerald green (`#059669`, `#ecfdf5`).
* **Meaningful Risk Coloring**: Saturated colors (amber `#f59e0b`, crimson `#ef4444`) are strictly reserved for communicating risk levels (Critical, High, Medium, Low) and security error states.
* **Restrained Chrome**: Clean hairline borders (`1px solid #e2e8f0`) and subtle shadows (`0 1px 2px rgba(0,0,0,0.05)`) without decorative gradients, oversized cards, or gratuitous animations.
* **Typography & Hierarchy**: Inter system font stack with strict typographic scale (`12px` to `20px`) and generous 8px-baseline spacing.

### 2. Component Structure
* **[`src/shell.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/shell.ts)**: Master `DashboardShell` coordinator managing state, URL hash routing (`#overview`, `#pending`, `#history`), responsive drawer state, and accessible focus management.
* **[`src/components/navigation.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/navigation.ts)**: Brand area ("Guardrail" + "Trusted Contact Portal" tag) and semantic navigation links with `aria-current="page"`.
* **[`src/components/account.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/account.ts)**: Bottom sidebar profile area representing authoritative server identity or unauthenticated fallback.
* **[`src/components/overview.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/overview.ts)**: Status cards (real metric counts, no fabricated data), decoupled execution architecture callout, and recent activity empty placeholder.
* **[`src/components/pending.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/pending.ts)**: Two-pane layout with request list and detail inspector displaying heuristic risk reasons, origin, ward, and timestamps. Includes intentional loading skeleton, empty, and error placeholders.
* **[`src/components/history.ts`](file:///Users/deepanshukhatri/Library/CloudStorage/GoogleDrive-deepanshukhatri20061972@gmail.com/My%20Drive/Cloud%20Desktop/Guardrail%20UI/guardrail/dashboard/src/components/history.ts)**: Audit trail view with intentional empty state placeholder.

### 3. Safety Invariant: Decoupled Action Execution
The dashboard explicitly emphasizes the **Decoupled Action Execution Guarantee**:
> Approval decisions recorded on the backend update the request status, but **never execute, continue, or replay browser actions** directly from the dashboard or backend. The ward's local browser extension alone decides whether to proceed based on verified policy.

---

## Development & Testing

```bash
# Type check TypeScript files
npm run type-check

# Run automated component test suite (47 assertions)
npm run test

# Build production bundle
npm run build
```
