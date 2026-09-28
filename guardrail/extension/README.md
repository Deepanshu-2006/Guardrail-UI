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

### 3. Load Extension in Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the `guardrail/extension/dist` directory.
5. The **Guardrail UI** extension will appear in your extension toolbar. Click its icon to view the popup.
