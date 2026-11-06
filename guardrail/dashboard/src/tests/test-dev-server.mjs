import assert from 'node:assert';
import { startDevServer } from '../../dev.mjs';

console.log('▶ Test Suite: Dashboard Development Server Verification');

const testPort = 5189;
const { ctx, port, backendUrl } = await startDevServer({ port: testPort });

try {
  assert.strictEqual(port, testPort, 'Server should listen on the requested test port');
  assert.strictEqual(backendUrl, 'http://localhost:3000', 'Backend URL should resolve to default dev origin');
  console.log('  ✓ Dev server started on test port', port);

  // Test index.html
  const resIndex = await fetch(`http://127.0.0.1:${port}/`);
  assert.strictEqual(resIndex.status, 200, 'index.html should return 200 OK');
  assert.match(resIndex.headers.get('content-type') || '', /text\/html/, 'index.html content-type should be text/html');
  const htmlText = await resIndex.text();
  assert(htmlText.includes('id="dashboard-app"'), 'HTML must contain #dashboard-app container');
  assert(htmlText.includes('src="dist/dashboard.js"'), 'HTML must reference dist/dashboard.js');
  assert(htmlText.includes('href="styles/dashboard.css"'), 'HTML must reference styles/dashboard.css');
  console.log('  ✓ Serves index.html with valid mount container and module scripts');

  // Test styles/dashboard.css
  const resCss = await fetch(`http://127.0.0.1:${port}/styles/dashboard.css`);
  assert.strictEqual(resCss.status, 200, 'styles/dashboard.css should return 200 OK');
  assert.match(resCss.headers.get('content-type') || '', /text\/css/, 'styles content-type should be text/css');
  const cssText = await resCss.text();
  assert(cssText.includes('--gd-green-primary'), 'CSS must define dashboard design tokens');
  console.log('  ✓ Serves styles/dashboard.css with correct CSS mime-type');

  // Test dist/dashboard.js
  const resJs = await fetch(`http://127.0.0.1:${port}/dist/dashboard.js`);
  assert.strictEqual(resJs.status, 200, 'dist/dashboard.js should return 200 OK');
  assert.match(resJs.headers.get('content-type') || '', /javascript/, 'JS content-type should be javascript');
  const jsText = await resJs.text();
  assert(jsText.includes('DashboardShell'), 'Bundle must contain DashboardShell class');
  assert(jsText.includes('http://localhost:3000'), 'Bundle must include default backend origin');
  console.log('  ✓ Serves bundled dist/dashboard.js with injected backend configuration');

  console.log('\n======================================================');
  console.log('Dev Server Tests Complete: All assertions passed.');
  console.log('======================================================\n');
} finally {
  await ctx.dispose();
}
