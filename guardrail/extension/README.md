# Guardrail Extension Foundation

Manifest V3 browser extension client built with TypeScript and esbuild.

## Folder Structure

```text
guardrail/extension/
├── public/                 # Static extension assets
│   ├── icons/              # Extension icons (16, 48, 128px)
│   ├── popup/              # Popup UI markup and styles
│   │   ├── popup.html
│   │   └── popup.css
│   └── manifest.json       # Chrome Manifest V3 descriptor
├── src/                    # TypeScript source code
│   ├── background/         # Service worker entrypoint
│   │   └── index.ts
│   ├── content/            # Content script entrypoint
│   │   └── index.ts
│   ├── popup/              # Popup controller logic
│   │   └── index.ts
│   └── types/              # Foundation TypeScript interfaces
│       └── index.ts
├── build.mjs               # Lightweight esbuild bundling script
├── package.json            # Extension scripts and devDependencies
├── tsconfig.json           # Strict TypeScript configuration
└── README.md
```

## Setup & Build Instructions

### 1. Install Dependencies
```bash
cd guardrail/extension
npm install
```

### 2. Type Check & Build
```bash
# Type check TypeScript
npm run type-check

# Build extension artifacts to dist/
npm run build

# Or run in watch mode during development
npm run watch
```

### Backend connectivity configuration

`GUARDRAIL_API_BASE_URL` is the single backend-origin setting used by the extension and dashboard build scripts. It is public routing configuration, never a credential. Development defaults to `http://localhost:3000`; pilot and production builds require the variable and reject missing, malformed, credentialed, or non-HTTPS remote origins. HTTP is permitted only for localhost in pilot mode.

```sh
# Local development
npm run build

# Controlled pilot package (replace with the actual HTTPS backend origin)
GUARDRAIL_ENV=pilot GUARDRAIL_API_BASE_URL=https://api.pilot.example.test npm run build:pilot
```

The build writes a Manifest V3 `host_permissions` entry scoped to that exact origin (`https://api.pilot.example.test/*`). The checked-in source manifest stays free of deployment hosts. The backend must separately allow the actual extension origin and dashboard origin using exact `GUARDRAIL_ALLOWED_ORIGINS`; browser host permission and server CORS are separate checks. Do not add wildcard origins. The extension API client requires an authenticated token provider, applies request timeouts, and does not automatically retry approval or invitation POSTs.

Build from the extension directory. The dashboard uses the same `GUARDRAIL_API_BASE_URL` variable:

```sh
cd ../dashboard
GUARDRAIL_ENV=pilot GUARDRAIL_API_BASE_URL=https://api.pilot.example.test npm run build
```

The embedding identity host must provide a verified access-token provider through `mountAuthenticatedDashboardShell()` or `window.__GUARDRAIL_AUTH_TOKEN_PROVIDER__`. The bundle contains no identity-provider secrets or tokens. Without a provider, the standalone dashboard remains disconnected instead of making unauthenticated API calls.

### 3. Load Extension in Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the `guardrail/extension/dist` directory.
5. The **Guardrail UI** extension will appear in your extension toolbar. Click its icon to view the popup.
