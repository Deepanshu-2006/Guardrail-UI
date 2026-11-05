import assert from 'node:assert/strict';
import { ApprovalApiClient, ApiClientErrorCodes, resolveApiBaseUrl } from './client.js';

await assert.rejects(() => resolveApiBaseUrl({ environment: 'pilot' }), /GUARDRAIL_API_BASE_URL is required/);
await assert.rejects(() => resolveApiBaseUrl({ customBaseUrl: 'http://api.example.test', environment: 'pilot' }), /HTTPS/);
assert.equal(await resolveApiBaseUrl({ customBaseUrl: 'http://localhost:3000', environment: 'pilot' }), 'http://localhost:3000');
await assert.rejects(() => resolveApiBaseUrl({ customBaseUrl: 'https://user:pass@api.example.test', environment: 'production' }), /origin/);

let requestCount = 0;
const missingEndpointClient = new ApprovalApiClient({
  environment: 'pilot',
  tokenProvider: () => 'synthetic-token',
  fetchFn: async () => { requestCount++; throw new Error('unexpected request'); },
});
const unconfigured = await missingEndpointClient.listPendingApprovals();
assert.equal(unconfigured.success, false);
if (!unconfigured.success) assert.equal(unconfigured.error.code, ApiClientErrorCodes.VALIDATION_ERROR);
assert.equal(requestCount, 0, 'remote configuration failure makes no request and does not fall back to localhost');

const unauthenticatedClient = new ApprovalApiClient({
  baseUrl: 'https://api.example.test', environment: 'pilot',
  fetchFn: async () => { requestCount++; throw new Error('unauthenticated request must not be sent'); },
});
const unauthorized = await unauthenticatedClient.listPendingApprovals();
assert.equal(unauthorized.success, false);
if (!unauthorized.success) assert.equal(unauthorized.error.code, ApiClientErrorCodes.UNAUTHENTICATED);
assert.equal(requestCount, 0, 'missing identity token prevents network request');

const unavailableClient = new ApprovalApiClient({
  baseUrl: 'https://api.example.test', environment: 'pilot', tokenProvider: () => 'synthetic-token',
  fetchFn: async () => { throw new TypeError('connection unavailable'); }, timeoutMs: 100,
});
const unavailable = await unavailableClient.listPendingApprovals();
assert.equal(unavailable.success, false);
if (!unavailable.success) assert.equal(unavailable.error.code, ApiClientErrorCodes.NETWORK_FAILURE);

console.log('PASS: backend URL configuration, HTTPS validation, authentication, and unavailable-service behavior');
