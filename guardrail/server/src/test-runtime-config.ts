import assert from 'node:assert/strict';
import { loadGuardrailServerConfig, ServerConfigurationError } from './runtime-config.js';

function rejected(action: () => unknown): void {
  assert.throws(action, ServerConfigurationError);
}

const development = loadGuardrailServerConfig({});
assert.equal(development.environment, 'development');
assert.equal(development.databasePath, 'data/guardrail.sqlite');
assert.equal(development.host, '127.0.0.1');

const pilot = loadGuardrailServerConfig({
  GUARDRAIL_ENV: 'pilot',
  GUARDRAIL_DB_PATH: '/srv/guardrail/pilot.sqlite',
  GUARDRAIL_ALLOWED_ORIGINS: 'https://pilot.example.test,chrome-extension://abcdefghijklmnopabcdefghijklmnop',
  GUARDRAIL_PORT: '8443',
});
assert.equal(pilot.port, 8443);
assert.equal(pilot.allowedOrigins.length, 2);

rejected(() => loadGuardrailServerConfig({ GUARDRAIL_ENV: 'pilot' }));
rejected(() => loadGuardrailServerConfig({ GUARDRAIL_ENV: 'production', GUARDRAIL_DB_PATH: ':memory:', GUARDRAIL_ALLOWED_ORIGINS: 'https://app.example.test' }));
rejected(() => loadGuardrailServerConfig({ GUARDRAIL_ENV: 'pilot', GUARDRAIL_DB_PATH: 'relative.sqlite', GUARDRAIL_ALLOWED_ORIGINS: 'https://app.example.test' }));
rejected(() => loadGuardrailServerConfig({ GUARDRAIL_ENV: 'pilot', GUARDRAIL_DB_PATH: '/tmp/app.sqlite', GUARDRAIL_ALLOWED_ORIGINS: '*' }));
rejected(() => loadGuardrailServerConfig({ GUARDRAIL_ENV: 'pilot', GUARDRAIL_DB_PATH: '/tmp/app.sqlite', GUARDRAIL_ALLOWED_ORIGINS: 'http://app.example.test' }));
rejected(() => loadGuardrailServerConfig({ GUARDRAIL_ENV: 'pilot', GUARDRAIL_DB_PATH: '/tmp/app.sqlite', GUARDRAIL_ALLOWED_ORIGINS: 'https://app.example.test/path' }));
rejected(() => loadGuardrailServerConfig({ GUARDRAIL_ENV: 'pilot', GUARDRAIL_DB_PATH: '/tmp/app.sqlite', GUARDRAIL_ALLOWED_ORIGINS: 'https://app.example.test' }, { allowedOrigins: ['*'] }));
rejected(() => loadGuardrailServerConfig({ GUARDRAIL_PORT: '70000' }));
rejected(() => loadGuardrailServerConfig({ GUARDRAIL_PORT: '' }));
rejected(() => loadGuardrailServerConfig({ GUARDRAIL_HOST: 'https://0.0.0.0' }));
rejected(() => loadGuardrailServerConfig({ NODE_ENV: 'production', GUARDRAIL_ENV: 'development' }));

console.log('PASS: development defaults, pilot requirements, origin validation, and safe database configuration');
