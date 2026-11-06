import { createRequire } from 'node:module';
import { resolveBackendUrl } from '../build/backend-url.mjs';

const require = createRequire(new URL('../extension/package.json', import.meta.url));
const esbuild = require('esbuild');

const environment = process.env.GUARDRAIL_ENV ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
const backendUrl = resolveBackendUrl(process.env, environment);

if (process.argv.includes('--serve')) {
  const { startDevServer } = await import('./dev.mjs');
  const host = process.env.HOST || '127.0.0.1';
  const { port } = await startDevServer();
  console.log('\n======================================================');
  console.log('  🛡️  Guardrail Trusted Contact Dashboard Dev Server');
  console.log('======================================================');
  console.log(`  Local URL:        http://localhost:${port}/`);
  console.log(`  Network/Loopback: http://${host}:${port}/`);
  console.log(`  Backend Origin:   ${backendUrl}`);
  console.log(`  Environment:      ${environment}`);
  console.log('  Serving:          index.html, styles/, dist/');
  console.log('  Watching:         src/**/*.ts (auto-rebuilding dist/dashboard.js)');
  console.log('======================================================\n');
} else if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: 'dist/dashboard.js',
    define: {
      'process.env.GUARDRAIL_ENV': JSON.stringify(environment),
      'process.env.NODE_ENV': JSON.stringify(environment === 'production' ? 'production' : 'development'),
      '__GUARDRAIL_API_BASE_URL__': JSON.stringify(backendUrl),
    },
  });
  await ctx.watch();
  console.log(`Dashboard watch mode active (${environment}); watching for changes...`);
} else {
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: 'dist/dashboard.js',
    define: {
      'process.env.GUARDRAIL_ENV': JSON.stringify(environment),
      'process.env.NODE_ENV': JSON.stringify(environment === 'production' ? 'production' : 'development'),
      '__GUARDRAIL_API_BASE_URL__': JSON.stringify(backendUrl),
    },
  });
  console.log(`Dashboard build completed (${environment}); backend origin configured.`);
}
