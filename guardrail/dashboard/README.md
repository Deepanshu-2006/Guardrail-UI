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

### Running the Local Development Server
The dashboard uses modern ES module `<script type="module">` tags, which requires a local HTTP development server to load scripts without browser `file://` CORS restrictions:

```bash
# Start local development server with live watching & auto-rebuild
npm run dev

# Open in browser:
# http://localhost:5173/
```

The dev server defaults to `http://localhost:5173` (an origin pre-whitelisted in the Guardrail backend CORS configuration). You can optionally override host or port:
```bash
PORT=8080 npm run dev
```

### Building & Testing
```bash
# Build standalone bundle (dist/dashboard.js)
npm run build

# Watch mode without HTTP server
node build.mjs --watch

# Run dev server test suite
npm run test:dev

# Run full automated test suite
npm run test
```

## Connecting to the backend

The dashboard uses the shared `ApprovalApiClient`. Both browser clients receive the same public backend origin through the build-time `GUARDRAIL_API_BASE_URL`; pilot/production builds fail if it is missing and require HTTPS. This URL is public configuration, not a secret. The identity host must supply a verified access-token provider; the dashboard never invents a login session or actor identity. Without that provider, standalone auto-mount remains disconnected and makes no API request.

```ts
import { ApprovalApiClient } from '../extension/src/approval/client.js';
import { mountAuthenticatedDashboardShell } from './src/index.js';

mountAuthenticatedDashboardShell({
  container: document.getElementById('dashboard-app')!,
  tokenProvider: () => authenticatedSession.getAccessToken(),
});
```

Build the dashboard with `npm run build` in development. For pilot/production, set `GUARDRAIL_ENV=pilot` (or `production`) and `GUARDRAIL_API_BASE_URL=https://<your-api-origin>` before building; the same variable is used for the extension package. The API client sends a bearer token returned by the host's authenticated `tokenProvider` and does not retry non-idempotent POST requests automatically. Do not embed provider secrets or tokens into the bundle. The repository does not configure a live identity provider or remote dashboard host. Backend API integration tests use local HTTP plus SQLite and synthetic verifiers, not a live login service.
