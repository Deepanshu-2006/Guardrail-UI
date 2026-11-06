import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveBackendUrl } from '../build/backend-url.mjs';

const require = createRequire(new URL('../extension/package.json', import.meta.url));
const esbuild = require('esbuild');

const environment = process.env.GUARDRAIL_ENV ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
const backendUrl = resolveBackendUrl(process.env, environment);
const port = Number(process.env.PORT) || 5173;
const host = process.env.HOST || '127.0.0.1';

/**
 * Creates and starts the Guardrail Dashboard development server.
 * Watches source files in src/ for incremental rebuilds and serves index.html,
 * styles, and generated bundles over local HTTP.
 */
export async function startDevServer(options = {}) {
  const serverPort = options.port ?? port;
  const serverHost = options.host ?? host;

  const ctx = await esbuild.context({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: 'dist/dashboard.js',
    sourcemap: true,
    define: {
      'process.env.GUARDRAIL_ENV': JSON.stringify(environment),
      'process.env.NODE_ENV': JSON.stringify(environment === 'production' ? 'production' : 'development'),
      '__GUARDRAIL_API_BASE_URL__': JSON.stringify(backendUrl),
    },
  });

  // Watch for source changes and rebuild automatically
  await ctx.watch();

  // Serve static assets and bundled JavaScript
  const server = await ctx.serve({
    servedir: '.',
    host: serverHost,
    port: serverPort,
  });

  return { ctx, server, port: server.port, host: serverHost, backendUrl, environment };
}

// Auto-run if executed directly via node dev.mjs
const isDirectExecution = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  try {
    const { ctx, port: activePort } = await startDevServer();

    console.log('\n======================================================');
    console.log('  🛡️  Guardrail Trusted Contact Dashboard Dev Server');
    console.log('======================================================');
    console.log(`  Local URL:        http://localhost:${activePort}/`);
    console.log(`  Loopback URL:     http://${host}:${activePort}/`);
    console.log(`  Backend Origin:   ${backendUrl}`);
    console.log(`  Environment:      ${environment}`);
    console.log('  Serving:          index.html, styles/, dist/');
    console.log('  Watching:         src/**/*.ts (auto-rebuilding dist/dashboard.js)');
    console.log('======================================================');
    console.log('  Press Ctrl+C to stop.\n');

    const shutdown = async () => {
      console.log('\nStopping Guardrail Dashboard dev server...');
      await ctx.dispose();
      process.exit(0);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start Guardrail Dashboard dev server:', error);
    process.exit(1);
  }
}
