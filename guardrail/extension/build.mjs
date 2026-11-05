import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { hostPermissionForBackend, resolveBackendUrl } from '../build/backend-url.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isPilot = process.argv.includes('--pilot') || process.env.GUARDRAIL_ENV === 'pilot';
const isProd = (process.argv.includes('--prod') || process.env.GUARDRAIL_ENV === 'production' || process.env.NODE_ENV === 'production') && !isPilot;
const targetEnv = isPilot ? 'pilot' : isProd ? 'production' : 'development';
const backendUrl = resolveBackendUrl(process.env, targetEnv);
const distDir = path.resolve(__dirname, 'dist');
const pilotDir = path.resolve(__dirname, 'dist-pilot');

function copyStaticAssets() {
  fs.mkdirSync(path.join(distDir, 'popup'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'onboarding'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'icons'), { recursive: true });

  // Clean stale source maps in production or pilot mode
  if (isProd || isPilot) {
    for (const f of ['background.js.map', 'content.js.map']) {
      const p = path.join(distDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const popupMap = path.join(distDir, 'popup', 'popup.js.map');
    if (fs.existsSync(popupMap)) fs.unlinkSync(popupMap);
    const onboardingMap = path.join(distDir, 'onboarding', 'onboarding.js.map');
    if (fs.existsSync(onboardingMap)) fs.unlinkSync(onboardingMap);
  }

  // Copy manifest with environment annotations
  const manifestPath = path.join(__dirname, 'public', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[Guardrail Extension Build] Missing required manifest at ${manifestPath}`);
  }
  const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestRaw);
  // MV3 requires an exact backend origin host permission for cross-origin fetches.
  manifest.host_permissions = [hostPermissionForBackend(backendUrl)];
  if (isPilot) {
    manifest.version_name = `${manifest.version}-pilot`;
    manifest.description = `${manifest.description} [PILOT DEPLOYMENT]`;
  }
  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Copy popup assets
  const popupHtml = path.join(__dirname, 'public', 'popup', 'popup.html');
  const popupCss = path.join(__dirname, 'public', 'popup', 'popup.css');
  if (!fs.existsSync(popupHtml) || !fs.existsSync(popupCss)) {
    throw new Error('[Guardrail Extension Build] Missing required popup assets');
  }
  fs.copyFileSync(popupHtml, path.join(distDir, 'popup', 'popup.html'));
  fs.copyFileSync(popupCss, path.join(distDir, 'popup', 'popup.css'));

  // Copy onboarding assets
  const onboardingHtml = path.join(__dirname, 'public', 'onboarding', 'onboarding.html');
  const onboardingCss = path.join(__dirname, 'public', 'onboarding', 'onboarding.css');
  if (!fs.existsSync(onboardingHtml) || !fs.existsSync(onboardingCss)) {
    throw new Error('[Guardrail Extension Build] Missing required onboarding assets');
  }
  fs.copyFileSync(onboardingHtml, path.join(distDir, 'onboarding', 'onboarding.html'));
  fs.copyFileSync(onboardingCss, path.join(distDir, 'onboarding', 'onboarding.css'));

  // Copy icons
  const iconFiles = ['icon-16.png', 'icon-48.png', 'icon-128.png'];
  for (const file of iconFiles) {
    const src = path.join(__dirname, 'public', 'icons', file);
    if (!fs.existsSync(src)) {
      if (isPilot || isProd) {
        throw new Error(`[Guardrail Extension Build] Missing required icon asset for ${targetEnv}: public/icons/${file}`);
      }
    } else {
      fs.copyFileSync(src, path.join(distDir, 'icons', file));
    }
  }
}

const buildOptions = [
  {
    entryPoints: [path.join(__dirname, 'src', 'background', 'index.ts')],
    bundle: true,
    outfile: path.join(distDir, 'background.js'),
    format: 'esm',
    target: 'es2022',
    sourcemap: !isProd && !isPilot,
    minify: isProd || isPilot,
    define: {
      'process.env.GUARDRAIL_ENV': JSON.stringify(targetEnv),
      'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
      '__GUARDRAIL_API_BASE_URL__': JSON.stringify(backendUrl),
    },
  },
  {
    entryPoints: [path.join(__dirname, 'src', 'content', 'index.ts')],
    bundle: true,
    outfile: path.join(distDir, 'content.js'),
    format: 'iife',
    target: 'es2022',
    sourcemap: !isProd && !isPilot,
    minify: isProd || isPilot,
    define: {
      'process.env.GUARDRAIL_ENV': JSON.stringify(targetEnv),
      'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
      '__GUARDRAIL_API_BASE_URL__': JSON.stringify(backendUrl),
    },
  },
  {
    entryPoints: [path.join(__dirname, 'src', 'popup', 'index.ts')],
    bundle: true,
    outfile: path.join(distDir, 'popup', 'popup.js'),
    format: 'iife',
    target: 'es2022',
    sourcemap: !isProd && !isPilot,
    minify: isProd || isPilot,
    define: {
      'process.env.GUARDRAIL_ENV': JSON.stringify(targetEnv),
      'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
      '__GUARDRAIL_API_BASE_URL__': JSON.stringify(backendUrl),
    },
  },
  {
    entryPoints: [path.join(__dirname, 'src', 'onboarding', 'index.ts')],
    bundle: true,
    outfile: path.join(distDir, 'onboarding', 'onboarding.js'),
    format: 'iife',
    target: 'es2022',
    sourcemap: !isProd && !isPilot,
    minify: isProd || isPilot,
    define: {
      'process.env.GUARDRAIL_ENV': JSON.stringify(targetEnv),
      'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
      '__GUARDRAIL_API_BASE_URL__': JSON.stringify(backendUrl),
    },
  },
];

function assemblePilotDistribution() {
  if (fs.existsSync(pilotDir)) {
    fs.rmSync(pilotDir, { recursive: true, force: true });
  }
  fs.mkdirSync(pilotDir, { recursive: true });
  fs.mkdirSync(path.join(pilotDir, 'popup'), { recursive: true });
  fs.mkdirSync(path.join(pilotDir, 'onboarding'), { recursive: true });
  fs.mkdirSync(path.join(pilotDir, 'icons'), { recursive: true });

  // Copy manifest
  fs.copyFileSync(path.join(distDir, 'manifest.json'), path.join(pilotDir, 'manifest.json'));
  // Copy core scripts
  fs.copyFileSync(path.join(distDir, 'background.js'), path.join(pilotDir, 'background.js'));
  fs.copyFileSync(path.join(distDir, 'content.js'), path.join(pilotDir, 'content.js'));
  // Copy popup
  for (const f of ['popup.html', 'popup.css', 'popup.js']) {
    fs.copyFileSync(path.join(distDir, 'popup', f), path.join(pilotDir, 'popup', f));
  }
  // Copy onboarding
  for (const f of ['onboarding.html', 'onboarding.css', 'onboarding.js']) {
    fs.copyFileSync(path.join(distDir, 'onboarding', f), path.join(pilotDir, 'onboarding', f));
  }
  // Copy icons
  for (const f of ['icon-16.png', 'icon-48.png', 'icon-128.png']) {
    const p = path.join(distDir, 'icons', f);
    if (fs.existsSync(p)) {
      fs.copyFileSync(p, path.join(pilotDir, 'icons', f));
    }
  }

  // Verify no test bundles or maps leaked into pilot bundle
  const pilotFiles = fs.readdirSync(pilotDir);
  const forbiddenFiles = pilotFiles.filter((f) => f.startsWith('test-') || f.endsWith('.map'));
  if (forbiddenFiles.length > 0) {
    throw new Error(`[Guardrail Extension Build] Pilot distribution contains forbidden development files: ${forbiddenFiles.join(', ')}`);
  }

  // Create clean deployment zip
  if (process.argv.includes('--package') || isPilot) {
    try {
      const zipPath = path.join(distDir, `guardrail-extension-${targetEnv}.zip`);
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      execSync(`cd "${pilotDir}" && zip -r "${zipPath}" . -x "*.DS_Store"`, { stdio: 'pipe' });
      console.log(`[Guardrail Extension] Packaged clean ${targetEnv} bundle -> ${zipPath}`);
    } catch (e) {
      console.warn(`[Guardrail Extension] Zip packaging note: ${e.message}`);
    }
  }
  console.log(`[Guardrail Extension] Clean pilot distribution assembled -> dist-pilot/`);
}

async function run() {
  copyStaticAssets();

  if (isWatch) {
    const contexts = await Promise.all(buildOptions.map((opt) => esbuild.context(opt)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log(`[Guardrail Extension] Watching for changes (${targetEnv})...`);
  } else {
    await Promise.all(buildOptions.map((opt) => esbuild.build(opt)));
    console.log(`[Guardrail Extension] Build completed successfully (${targetEnv}) -> dist/`);
    if (isPilot || isProd || process.argv.includes('--package')) {
      assemblePilotDistribution();
    }
  }
}

run().catch((err) => {
  console.error('[Guardrail Extension] Build error:', err);
  process.exit(1);
});
