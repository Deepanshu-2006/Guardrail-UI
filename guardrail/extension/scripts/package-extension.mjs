/**
 * Guardrail Browser Extension - Chrome Web Store Production Packaging Script
 *
 * Executes a clean production build, verifies strict manifest and asset requirements,
 * purges development artifacts (test files, sourcemaps, OS metadata), and bundles
 * a release-ready .zip archive suitable for immediate Chrome Web Store upload.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');
const distDir = path.join(extensionRoot, 'dist');
const storeStagingDir = path.join(extensionRoot, 'dist-store');

console.log('======================================================');
console.log('📦 Guardrail Chrome Web Store Packaging Pipeline');
console.log('======================================================\n');

// 1. Run Production Build
console.log('⚙️  Step 1: Running optimized production build...');
const prodApiUrl = process.env.GUARDRAIL_API_BASE_URL?.trim() || 'https://api.guardrail.app';
try {
  execSync(`node build.mjs --prod`, {
    cwd: extensionRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      GUARDRAIL_API_BASE_URL: prodApiUrl,
      NODE_ENV: 'production',
      GUARDRAIL_ENV: 'production',
    },
  });
} catch (err) {
  console.error('❌ Production build failed:', err.message);
  process.exit(1);
}

// 2. Assemble Pristine Store Staging Directory
console.log('\n🧹 Step 2: Preparing clean Store Staging Directory...');
if (fs.existsSync(storeStagingDir)) {
  fs.rmSync(storeStagingDir, { recursive: true, force: true });
}
fs.mkdirSync(storeStagingDir, { recursive: true });

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Omit forbidden development and system files
    if (
      entry.name.startsWith('test-') ||
      entry.name.startsWith('verify-') ||
      entry.name.endsWith('.map') ||
      entry.name === '.DS_Store' ||
      entry.name.endsWith('.zip') ||
      entry.name === 'Thumbs.db'
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist-pilot' && entry.name !== 'dist-store') {
        copyDirRecursive(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDirRecursive(distDir, storeStagingDir);

// 3. Validate Manifest & Production Assets
console.log('🔍 Step 3: Verifying Chrome Web Store compliance invariants...');
const manifestPath = path.join(storeStagingDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ Missing manifest.json in staging bundle!');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

// Verify required Manifest V3 fields
if (manifest.manifest_version !== 3) {
  console.error(`❌ Invalid manifest_version: ${manifest.manifest_version} (must be 3)`);
  process.exit(1);
}
if (!manifest.name || !manifest.version) {
  console.error('❌ Manifest missing required name or version');
  process.exit(1);
}

// Ensure version is production ready
manifest.version = '1.0.0';
delete manifest.version_name; // Store prefers clean SemVer without -dev or -pilot

// Verify required icons exist
const requiredIcons = ['16', '48', '128'];
for (const size of requiredIcons) {
  const iconRelPath = manifest.icons?.[size];
  if (!iconRelPath || !fs.existsSync(path.join(storeStagingDir, iconRelPath))) {
    console.error(`❌ Missing required icon-${size}.png in staging bundle!`);
    process.exit(1);
  }
}

// Verify background service worker and content script
if (!manifest.background?.service_worker || !fs.existsSync(path.join(storeStagingDir, manifest.background.service_worker))) {
  console.error('❌ Missing background service worker in staging bundle!');
  process.exit(1);
}
if (!manifest.content_scripts?.[0]?.js?.[0] || !fs.existsSync(path.join(storeStagingDir, manifest.content_scripts[0].js[0]))) {
  console.error('❌ Missing content script in staging bundle!');
  process.exit(1);
}

// Write sanitized production manifest
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// 4. Create Store Zip Package
console.log('🗜️  Step 4: Compressing production package...');
const zipFilename = `guardrail-extension-v${manifest.version}.zip`;
const zipFilePath = path.join(distDir, zipFilename);

if (fs.existsSync(zipFilePath)) {
  fs.unlinkSync(zipFilePath);
}

try {
  execSync(`cd "${storeStagingDir}" && zip -r -9 "${zipFilePath}" . -x "*.DS_Store"`, { stdio: 'pipe' });
} catch (zipErr) {
  console.error('❌ Zip compression failed:', zipErr.message);
  process.exit(1);
}

// 5. Verification & Checksum
const zipStats = fs.statSync(zipFilePath);
const zipBuffer = fs.readFileSync(zipFilePath);
const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');

console.log('\n======================================================');
console.log('✅ CHROME WEB STORE RELEASE PACKAGE READY');
console.log('======================================================');
console.log(`  Package File:     ${zipFilename}`);
console.log(`  Full Path:        ${zipFilePath}`);
console.log(`  Package Size:     ${(zipStats.size / 1024).toFixed(1)} KB`);
console.log(`  Version:          ${manifest.version}`);
console.log(`  Manifest Version: 3`);
console.log(`  SHA-256 Checksum: ${sha256}`);
console.log('======================================================\n');
