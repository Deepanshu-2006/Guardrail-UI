import assert from 'node:assert/strict';
import { hostPermissionForBackend, resolveBackendUrl } from './backend-url.mjs';

assert.equal(resolveBackendUrl({}, 'development'), 'http://localhost:3000');
assert.throws(() => resolveBackendUrl({}, 'pilot'), /required/);
assert.throws(() => resolveBackendUrl({}, 'production'), /required/);
assert.equal(resolveBackendUrl({ GUARDRAIL_API_BASE_URL: 'https://api.example.test/' }, 'pilot'), 'https://api.example.test');
assert.equal(resolveBackendUrl({ GUARDRAIL_API_BASE_URL: 'http://localhost:3000' }, 'pilot'), 'http://localhost:3000');
assert.throws(() => resolveBackendUrl({ GUARDRAIL_API_BASE_URL: 'http://api.example.test' }, 'pilot'), /HTTPS/);
assert.throws(() => resolveBackendUrl({ GUARDRAIL_API_BASE_URL: 'http://localhost:3000' }, 'production'), /HTTPS/);
assert.throws(() => resolveBackendUrl({ GUARDRAIL_API_BASE_URL: 'https://user:pass@api.example.test' }, 'pilot'), /origin/);
assert.throws(() => resolveBackendUrl({ GUARDRAIL_API_BASE_URL: 'https://api.example.test/path' }, 'pilot'), /origin/);
assert.equal(hostPermissionForBackend('https://api.example.test'), 'https://api.example.test/*');
assert.equal(hostPermissionForBackend('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/*');
assert.throws(() => resolveBackendUrl({ NODE_ENV: 'production', GUARDRAIL_ENV: 'development' }), /non-deployment/);

console.log('PASS: shared build URL validation and exact host-permission generation');
