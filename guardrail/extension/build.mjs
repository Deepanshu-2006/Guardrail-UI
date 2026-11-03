import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isPilot = process.argv.includes('--pilot') || process.env.GUARDRAIL_ENV === 'pilot';
const isProd = (process.argv.includes('--prod') || process.env.NODE_ENV === 'production') && !isPilot;
const targetEnv = isPilot ? 'pilot' : isProd ? 'production' : 'development';
const distDir = path.resolve(__dirname, 'dist');

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
  const manifestRaw = fs.readFileSync(path.join(__dirname, 'public', 'manifest.json'), 'utf-8');
  const manifest = JSON.parse(manifestRaw);
  if (isPilot) {
    manifest.version_name = `${manifest.version}-pilot`;
    manifest.description = `${manifest.description} [PILOT DEPLOYMENT]`;
  }
  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Copy popup assets
  fs.copyFileSync(
    path.join(__dirname, 'public', 'popup', 'popup.html'),
    path.join(distDir, 'popup', 'popup.html')
  );
  fs.copyFileSync(
    path.join(__dirname, 'public', 'popup', 'popup.css'),
    path.join(distDir, 'popup', 'popup.css')
  );

  // Copy onboarding assets
  fs.copyFileSync(
    path.join(__dirname, 'public', 'onboarding', 'onboarding.html'),
    path.join(distDir, 'onboarding', 'onboarding.html')
  );
  fs.copyFileSync(
    path.join(__dirname, 'public', 'onboarding', 'onboarding.css'),
    path.join(distDir, 'onboarding', 'onboarding.css')
  );

  // Copy icons
  const iconFiles = ['icon-16.png', 'icon-48.png', 'icon-128.png'];
  for (const file of iconFiles) {
    const src = path.join(__dirname, 'public', 'icons', file);
    if (fs.existsSync(src)) {
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
    },
  },
];

async function run() {
  copyStaticAssets();

  if (isWatch) {
    const contexts = await Promise.all(buildOptions.map((opt) => esbuild.context(opt)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log(`[Guardrail Extension] Watching for changes (${targetEnv})...`);
  } else {
    await Promise.all(buildOptions.map((opt) => esbuild.build(opt)));
    console.log(`[Guardrail Extension] Build completed successfully (${targetEnv}) -> dist/`);
  }
}

run().catch((err) => {
  console.error('[Guardrail Extension] Build error:', err);
  process.exit(1);
});
