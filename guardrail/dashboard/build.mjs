import { createRequire } from 'node:module';
import { resolveBackendUrl } from '../build/backend-url.mjs';

const require = createRequire(new URL('../extension/package.json', import.meta.url));
const esbuild = require('esbuild');

const environment = process.env.GUARDRAIL_ENV ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
const backendUrl = resolveBackendUrl(process.env, environment);
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
