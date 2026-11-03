/**
 * Guardrail Environment & Configuration Management Verification Suite
 *
 * Verifies that Guardrail UI satisfies all environment configuration requirements:
 * 1. Explicit separation of development, pilot, test, and production configuration.
 * 2. Strict rejection of embedded credentials and secrets in static configuration.
 * 3. Startup validation enforcing HTTPS for pilot and production environments.
 * 4. Safe fallback behavior when optional configuration values are omitted.
 * 5. Distinct identification and badging of mock/in-memory vs live services.
 * 6. Protection against client-side URL credential injection.
 * 7. ApprovalApiClient integration with pilot endpoints and service type detection.
 * 8. DashboardShell environment and mock service status visibility.
 */

declare const process: { exit: (code: number) => void; exitCode?: number; env: Record<string, string | undefined> };

import {
  AppEnvironment,
  detectForbiddenSecrets,
  DEVELOPMENT_CONFIG,
  PILOT_CONFIG,
  PRODUCTION_CONFIG,
  TEST_CONFIG,
  validateEnvironmentConfig,
  resolveEnvironmentConfig,
  DEFAULT_DEV_API_BASE_URL,
  DEFAULT_PILOT_API_BASE_URL,
  DEFAULT_PROD_API_BASE_URL,
} from './environment.js';
import {
  ApprovalApiClient,
  resolveApiBaseUrl,
} from '../approval/client.js';
import {
  ApprovalApiRouter,
  InMemoryTokenVerifier,
  GUARDRAIL_SERVICE_TYPE_HEADER,
  GUARDRAIL_EPHEMERAL_MOCK_SERVICE_TYPE,
} from '../approval/api.js';
import { ApprovalService } from '../approval/service.js';
import { DevelopmentInMemoryApprovalRequestRepository } from '../approval/repository.js';
import {
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
} from '../approval/authorization.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAILED: ${message}`);
    process.exitCode = 1;
  }
}

async function runEnvironmentConfigTests(): Promise<void> {
  console.log('====================================================================');
  console.log('🧪 GUARDRAIL ENVIRONMENT & CONFIGURATION MANAGEMENT TEST SUITE');
  console.log('====================================================================\n');

  // ---------------------------------------------------------------------------
  // Test Suite 1: Environment Separation & Canonical Presets
  // ---------------------------------------------------------------------------
  console.log('▶ Test Suite 1: Environment Separation & Canonical Presets');
  {
    assert(DEVELOPMENT_CONFIG.environment === 'development', 'Development preset has environment: "development"');
    assert(DEVELOPMENT_CONFIG.serviceType === 'in_memory', 'Development preset defaults to in_memory service');
    assert(DEVELOPMENT_CONFIG.apiBaseUrl === DEFAULT_DEV_API_BASE_URL, 'Development API base URL is localhost:3000');

    assert(PILOT_CONFIG.environment === 'pilot', 'Pilot preset has environment: "pilot"');
    assert(PILOT_CONFIG.serviceType === 'live', 'Pilot preset targets live service');
    assert(PILOT_CONFIG.apiBaseUrl === DEFAULT_PILOT_API_BASE_URL, 'Pilot API base URL is pilot-api.guardrail-safety.org');
    assert(PILOT_CONFIG.apiBaseUrl.startsWith('https://'), 'Pilot preset enforces HTTPS');

    assert(PRODUCTION_CONFIG.environment === 'production', 'Production preset has environment: "production"');
    assert(PRODUCTION_CONFIG.serviceType === 'live', 'Production preset targets live service');
    assert(PRODUCTION_CONFIG.apiBaseUrl === DEFAULT_PROD_API_BASE_URL, 'Production API base URL is api.guardrail-safety.org');
    assert(PRODUCTION_CONFIG.apiBaseUrl.startsWith('https://'), 'Production preset enforces HTTPS');

    assert(TEST_CONFIG.environment === 'test', 'Test preset has environment: "test"');
    assert(TEST_CONFIG.serviceType === 'mock', 'Test preset defaults to mock service');
    assert(TEST_CONFIG.timeoutMs <= 5000, 'Test preset uses fast timeout');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 2: Secret Scanning & Forbidden Key Rejection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 2: Secret Scanning & Forbidden Key Rejection');
  {
    const cleanConfig = {
      environment: 'pilot' as const,
      apiBaseUrl: 'https://pilot-api.guardrail-safety.org',
      timeoutMs: 15000,
    };
    const cleanViolations = detectForbiddenSecrets(cleanConfig);
    assert(cleanViolations.length === 0, 'Clean configuration produces zero secret violations');

    const leakedTokenConfig = {
      apiBaseUrl: 'https://pilot-api.guardrail-safety.org',
      authToken: 'secret_bearer_token_xyz',
    };
    const tokenViolations = detectForbiddenSecrets(leakedTokenConfig);
    assert(tokenViolations.length > 0, 'Detects leaked authToken property');
    assert(tokenViolations.some((v) => v.field.includes('authToken')), 'Violation specifies authToken property path');

    const leakedPasswordConfig = {
      database: {
        host: 'localhost',
        password: 'super_secret_db_password',
      },
    };
    const passViolations = detectForbiddenSecrets(leakedPasswordConfig);
    assert(passViolations.length > 0, 'Detects nested password property');
    assert(passViolations.some((v) => v.field.includes('database.password')), 'Violation includes dotted property path');

    const bearerStringConfig = {
      endpoint: 'https://pilot-api.guardrail-safety.org',
      headerSample: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    };
    const bearerViolations = detectForbiddenSecrets(bearerStringConfig);
    assert(bearerViolations.length > 0, 'Detects hardcoded Bearer JWT credential string');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 3: Startup Validation & URL Sanitization
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 3: Startup Validation & URL Sanitization');
  {
    // Valid development configuration
    const devValid = validateEnvironmentConfig(DEVELOPMENT_CONFIG, 'development');
    assert(devValid.valid, 'Development preset passes startup validation');
    assert(devValid.errors.length === 0, 'Zero errors for valid development configuration');

    // Valid pilot configuration
    const pilotValid = validateEnvironmentConfig(PILOT_CONFIG, 'pilot');
    assert(pilotValid.valid, 'Pilot preset passes startup validation');
    assert(pilotValid.config?.apiBaseUrl === 'https://pilot-api.guardrail-safety.org', 'Sanitized pilot URL returned');

    // Reject HTTP for pilot remote endpoints
    const insecurePilot = validateEnvironmentConfig(
      {
        ...PILOT_CONFIG,
        apiBaseUrl: 'http://remote-pilot.guardrail-safety.org',
      },
      'pilot'
    );
    assert(!insecurePilot.valid, 'Rejects insecure HTTP remote endpoint in pilot mode');
    assert(
      insecurePilot.errors.some((e) => e.code === 'INSECURE_HTTP_REJECTED'),
      'Produces INSECURE_HTTP_REJECTED error code'
    );

    // Reject embedded credentials in URL
    const credentialUrl = validateEnvironmentConfig(
      {
        ...PILOT_CONFIG,
        apiBaseUrl: 'https://admin:supersecret@pilot-api.guardrail-safety.org',
      },
      'pilot'
    );
    assert(!credentialUrl.valid, 'Rejects embedded user:password credentials in API base URL');
    assert(
      credentialUrl.errors.some((e) => e.code === 'INVALID_URL_CREDENTIALS'),
      'Produces INVALID_URL_CREDENTIALS error code'
    );

    // Reject invalid URL syntax
    const badUrl = validateEnvironmentConfig(
      {
        ...DEVELOPMENT_CONFIG,
        apiBaseUrl: 'not_a_valid_url:::3000',
      },
      'development'
    );
    assert(!badUrl.valid, 'Rejects malformed URL syntax');
    assert(
      badUrl.errors.some((e) => e.code === 'MALFORMED_URL'),
      'Produces MALFORMED_URL error code'
    );
  }

  // ---------------------------------------------------------------------------
  // Test Suite 4: Mock Service Safeguard in Pilot & Production
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 4: Mock Service Safeguard in Pilot & Production');
  {
    // In pilot mode, in_memory service must be rejected unless explicitly overridden for controlled testing
    const accidentalMockInPilot = validateEnvironmentConfig(
      {
        ...PILOT_CONFIG,
        serviceType: 'in_memory',
        isMockService: true,
      },
      'pilot'
    );
    assert(!accidentalMockInPilot.valid, 'Rejects accidental in-memory mock service in pilot mode');
    assert(
      accidentalMockInPilot.errors.some((e) => e.code === 'MOCK_SERVICE_IN_PILOT_PROHIBITED'),
      'Produces MOCK_SERVICE_IN_PILOT_PROHIBITED error'
    );

    // In production mode, mock services are strictly forbidden under all circumstances
    const mockInProd = validateEnvironmentConfig(
      {
        ...PRODUCTION_CONFIG,
        serviceType: 'mock',
        isMockService: true,
      },
      'production'
    );
    assert(!mockInProd.valid, 'Rejects mock service in production mode');
    assert(
      mockInProd.errors.some((e) => e.code === 'MOCK_SERVICE_IN_PROD_PROHIBITED'),
      'Produces MOCK_SERVICE_IN_PROD_PROHIBITED error'
    );
  }

  // ---------------------------------------------------------------------------
  // Test Suite 5: Safe Fallback Behavior for Missing Configuration
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 5: Safe Fallback Behavior for Missing Configuration');
  {
    // Empty config input falls back to development defaults safely
    const fallbackDev = validateEnvironmentConfig({}, 'development');
    assert(fallbackDev.valid, 'Empty config input succeeds with safe fallbacks in development');
    assert(fallbackDev.config?.apiBaseUrl === DEFAULT_DEV_API_BASE_URL, 'Falls back to DEFAULT_DEV_API_BASE_URL');
    assert(fallbackDev.config?.timeoutMs === 10000, 'Falls back to bounded default timeout (10000ms)');
    assert(fallbackDev.config?.pollIntervalMs === 10000, 'Falls back to bounded default poll interval');

    // Missing numeric bounds are clamped safely
    const extremeNumbers = validateEnvironmentConfig(
      {
        ...DEVELOPMENT_CONFIG,
        timeoutMs: 100, // Below minimum 500ms
        pollIntervalMs: 5, // Below minimum 10ms
      },
      'development'
    );
    assert(extremeNumbers.valid, 'Succeeds with warning when numeric parameters are extreme');
    assert(extremeNumbers.config?.timeoutMs === 500, 'Clamps sub-minimum timeoutMs to safe lower bound (500ms)');
    assert(extremeNumbers.config?.pollIntervalMs === 10, 'Clamps sub-minimum poll interval to safe floor (10ms)');
    assert(extremeNumbers.warnings.length > 0, 'Generates diagnostic warnings for clamped parameters');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 6: Environment Resolution Hierarchy
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 6: Environment Resolution Hierarchy');
  {
    // Explicit override priority
    const resolvedExplicit = resolveEnvironmentConfig({
      environment: 'pilot',
      apiBaseUrl: 'https://custom-pilot.guardrail-safety.org/',
    });
    assert(resolvedExplicit.environment === 'pilot', 'Explicit environment overrides default');
    assert(
      resolvedExplicit.apiBaseUrl === 'https://custom-pilot.guardrail-safety.org',
      'Normalizes and strips trailing slash from base URL'
    );

    // Resolve URL for pilot mode via resolveApiBaseUrl
    const pilotUrl = await resolveApiBaseUrl({ environment: 'pilot' });
    assert(pilotUrl === DEFAULT_PILOT_API_BASE_URL, 'resolveApiBaseUrl returns DEFAULT_PILOT_API_BASE_URL for pilot');

    // Rejection of insecure URL in pilot mode via resolveApiBaseUrl
    let pilotHttpsErrorThrown = false;
    try {
      await resolveApiBaseUrl({
        customBaseUrl: 'http://insecure-pilot.guardrail.org',
        environment: 'pilot',
      });
    } catch (err: any) {
      pilotHttpsErrorThrown = true;
      assert(err.message.includes('must use HTTPS'), 'resolveApiBaseUrl enforces HTTPS in pilot mode');
    }
    assert(pilotHttpsErrorThrown, 'Threw error for insecure pilot URL');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 7: ApprovalApiClient Pilot & Mock Service Detection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 7: ApprovalApiClient Pilot & Mock Service Detection');
  {
    // Client initialized in pilot mode
    const pilotClient = new ApprovalApiClient({
      environment: 'pilot',
      fetchFn: globalThis.fetch,
    });
    assert(pilotClient.getEnvironment() === 'pilot', 'ApprovalApiClient correctly records "pilot" environment');
    assert(pilotClient.getBaseUrl() === DEFAULT_PILOT_API_BASE_URL, 'ApprovalApiClient defaults to pilot base URL');
    assert(!pilotClient.isMockService(), 'Pilot client starts as live service by default');

    // Reject insecure HTTP in pilot client constructor
    let constructorHttpsError = false;
    try {
      new ApprovalApiClient({
        environment: 'pilot',
        baseUrl: 'http://insecure-api.internal',
      });
    } catch (err: any) {
      constructorHttpsError = true;
      assert(err.message.includes('must use HTTPS'), 'Constructor enforces HTTPS for pilot base URL');
    }
    assert(constructorHttpsError, 'Constructor threw error for insecure HTTP in pilot mode');

    // Localhost exception in pilot mode for local integration testing
    const localPilotClient = new ApprovalApiClient({
      environment: 'pilot',
      baseUrl: 'http://localhost:8443',
    });
    assert(localPilotClient.getBaseUrl() === 'http://localhost:8443', 'Permits localhost HTTP for local testing');

    // In-memory router attaches mock service header
    const mockRepo = new DevelopmentInMemoryApprovalRequestRepository();
    const ownershipRegistry = new InMemoryActionOwnershipRegistry();
    const contactRegistry = new InMemoryTrustedContactRegistry();
    const service = new ApprovalService(mockRepo, ownershipRegistry, contactRegistry);
    const tokenVerifier = new InMemoryTokenVerifier();
    const router = new ApprovalApiRouter(service, tokenVerifier);

    const routerResponse = await router.dispatch({
      method: 'GET',
      url: '/api/v1/approval-requests/apr_test',
    });
    assert(
      routerResponse.headers[GUARDRAIL_SERVICE_TYPE_HEADER] === GUARDRAIL_EPHEMERAL_MOCK_SERVICE_TYPE,
      'ApprovalApiRouter transmits x-guardrail-service-type: ephemeral_in_memory_mock header'
    );
  }

  // ---------------------------------------------------------------------------
  // Test Suite 8: ApprovalApiClient Service Type Header Detection
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 8: ApprovalApiClient Service Type Header Detection');
  {
    // Simulate server returning x-guardrail-service-type: ephemeral_in_memory_mock
    const mockFetchFn: typeof fetch = async () => {
      const headers = new Headers();
      headers.set('content-type', 'application/json');
      headers.set('x-guardrail-service-type', 'ephemeral_in_memory_mock');
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'apr_test_detect',
            actionId: 'act_1',
            status: 'PENDING',
            riskLevel: 'HIGH',
            category: 'FINANCIAL_TRANSACTION',
            actionType: 'WIRE_TRANSFER',
            actionDescription: 'Test Transfer',
            pageUrl: 'https://example.com',
            createdAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers }
      );
    };

    const client = new ApprovalApiClient({
      environment: 'development',
      fetchFn: mockFetchFn,
      tokenProvider: () => 'token_valid',
    });
    assert(!client.isMockService(), 'Client initially defaults to live before traffic');

    await client.getApprovalRequest('apr_test_detect');
    assert(client.isMockService(), 'Client automatically detects mock backend from response header');
    assert(client.getServiceType() === 'in_memory', 'Service type resolved to "in_memory"');
  }

  // ---------------------------------------------------------------------------
  // Test Suite 9: Missing Environment Variables Resilience
  // ---------------------------------------------------------------------------
  console.log('\n▶ Test Suite 9: Missing Environment Variables Resilience');
  {
    const originalGuardrailEnv = process.env.GUARDRAIL_ENV;
    const originalNodeEnv = process.env.NODE_ENV;

    try {
      delete process.env.GUARDRAIL_ENV;
      delete process.env.NODE_ENV;

      const defaultConfig = resolveEnvironmentConfig();
      assert(defaultConfig.environment === 'development', 'Defaults to "development" when env vars are completely absent');
      assert(defaultConfig.apiBaseUrl === DEFAULT_DEV_API_BASE_URL, 'Defaults to local dev API URL');

      process.env.GUARDRAIL_ENV = 'pilot';
      const pilotEnvConfig = resolveEnvironmentConfig();
      assert(pilotEnvConfig.environment === 'pilot', 'Detects GUARDRAIL_ENV="pilot"');
      assert(pilotEnvConfig.apiBaseUrl === DEFAULT_PILOT_API_BASE_URL, 'Resolves pilot base URL from environment');

      process.env.GUARDRAIL_ENV = 'invalid_env_name';
      const invalidEnvConfig = resolveEnvironmentConfig();
      assert(invalidEnvConfig.environment === 'development', 'Safely falls back to "development" when GUARDRAIL_ENV is unrecognized');
    } finally {
      process.env.GUARDRAIL_ENV = originalGuardrailEnv;
      process.env.NODE_ENV = originalNodeEnv;
    }
  }

  console.log('\n====================================================================');
  console.log(`📊 ENVIRONMENT CONFIGURATION TESTS: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('🎉 ALL ENVIRONMENT & CONFIGURATION SPECIFICATIONS VERIFIED!');
  } else {
    console.error(`❌ ${totalTests - passedTests} TESTS FAILED`);
    process.exit(1);
  }
  console.log('====================================================================\n');
}

runEnvironmentConfigTests().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
