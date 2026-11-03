/**
 * Guardrail Environment & Configuration Management
 *
 * Provides strongly typed, validated environment configuration across
 * Guardrail components (browser extension, background coordinator, and dashboard).
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. ENVIRONMENT SEPARATION:
 *    - Explicitly separates 'development', 'pilot', 'test', and 'production' profiles.
 *    - Pilot and production strictly mandate HTTPS for remote endpoints.
 * 2. ZERO EXPOSED SECRETS:
 *    - Static environment configurations must NEVER contain authentication tokens,
 *      passwords, private keys, API keys, or raw secrets.
 *    - Secrets are rejected at validation time; values are dynamically resolved
 *      at runtime via authenticated user sessions.
 * 3. STARTUP VALIDATION & SAFE FALLBACKS:
 *    - Validates configuration values at startup.
 *    - Missing optional values safely fallback to environment-specific bounded presets.
 * 4. MOCK SERVICE DISTINCTION:
 *    - In-memory and mock services are explicitly flagged and cannot be accidentally
 *      mistaken for live services in pilot or production environments.
 * 5. LEAST PRIVILEGE:
 *    - Enforces strict URL sanitization (disallowing embedded user:pass credentials).
 */

export type AppEnvironment = 'development' | 'pilot' | 'test' | 'production';

export type ServiceType = 'live' | 'mock' | 'in_memory';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Standard public endpoints and configuration defaults.
 */
export const DEFAULT_DEV_API_BASE_URL = 'http://localhost:3000';
export const DEFAULT_PILOT_API_BASE_URL = 'https://pilot-api.guardrail-safety.org';
export const DEFAULT_PROD_API_BASE_URL = 'https://api.guardrail-safety.org';

export const DEFAULT_DEV_TIMEOUT_MS = 10000;
export const DEFAULT_PILOT_TIMEOUT_MS = 15000;
export const DEFAULT_TEST_TIMEOUT_MS = 2000;
export const DEFAULT_PROD_TIMEOUT_MS = 10000;

export const DEFAULT_DEV_POLL_INTERVAL_MS = 10000;
export const DEFAULT_PILOT_POLL_INTERVAL_MS = 15000;
export const DEFAULT_TEST_POLL_INTERVAL_MS = 50;
export const DEFAULT_PROD_POLL_INTERVAL_MS = 10000;

/**
 * Forbidden property names that must never be present in static configuration objects.
 * Guardrail enforces zero secrets in configuration bundles.
 */
export const FORBIDDEN_SECRET_KEYS: readonly string[] = Object.freeze([
  'token',
  'authtoken',
  'bearertoken',
  'secret',
  'apikey',
  'api_key',
  'clientsecret',
  'client_secret',
  'password',
  'privatekey',
  'private_key',
  'jwt',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'credentials',
]);

/**
 * Complete, immutable environment configuration profile.
 */
export interface EnvironmentConfig {
  /** Target execution environment */
  readonly environment: AppEnvironment;

  /** Resolved base URL for the Guardrail approval backend */
  readonly apiBaseUrl: string;

  /** Whether remote transport strictly requires HTTPS */
  readonly requireHttps: boolean;

  /**
   * Whether unencrypted HTTP is permitted.
   * Strictly false in production; false by default in pilot unless explicitly localhost.
   */
  readonly allowInsecureHttp: boolean;

  /** Whether the active service is a mock or simulated fixture */
  readonly isMockService: boolean;

  /** Concrete service classification */
  readonly serviceType: ServiceType;

  /** Network request timeout in milliseconds */
  readonly timeoutMs: number;

  /** Background polling interval in milliseconds */
  readonly pollIntervalMs: number;

  /** Logging verbosity */
  readonly logLevel: LogLevel;

  /** Isolated storage namespace to prevent cross-environment pollution */
  readonly storageNamespace: string;

  /** If true, permits mock service usage in pilot environment (with explicit warning) */
  readonly allowMockInPilot?: boolean;
}

/**
 * Default preset for Local Development.
 */
export const DEVELOPMENT_CONFIG: Readonly<EnvironmentConfig> = Object.freeze({
  environment: 'development',
  apiBaseUrl: DEFAULT_DEV_API_BASE_URL,
  requireHttps: false,
  allowInsecureHttp: true,
  isMockService: true,
  serviceType: 'in_memory',
  timeoutMs: DEFAULT_DEV_TIMEOUT_MS,
  pollIntervalMs: DEFAULT_DEV_POLL_INTERVAL_MS,
  logLevel: 'debug',
  storageNamespace: 'guardrail_dev',
});

/**
 * Default preset for Controlled Pilot.
 */
export const PILOT_CONFIG: Readonly<EnvironmentConfig> = Object.freeze({
  environment: 'pilot',
  apiBaseUrl: DEFAULT_PILOT_API_BASE_URL,
  requireHttps: true,
  allowInsecureHttp: false,
  isMockService: false,
  serviceType: 'live',
  timeoutMs: DEFAULT_PILOT_TIMEOUT_MS,
  pollIntervalMs: DEFAULT_PILOT_POLL_INTERVAL_MS,
  logLevel: 'info',
  storageNamespace: 'guardrail_pilot',
});

/**
 * Default preset for Automated Testing.
 */
export const TEST_CONFIG: Readonly<EnvironmentConfig> = Object.freeze({
  environment: 'test',
  apiBaseUrl: DEFAULT_DEV_API_BASE_URL,
  requireHttps: false,
  allowInsecureHttp: true,
  isMockService: true,
  serviceType: 'mock',
  timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
  pollIntervalMs: DEFAULT_TEST_POLL_INTERVAL_MS,
  logLevel: 'warn',
  storageNamespace: 'guardrail_test',
});

/**
 * Default preset for Production.
 */
export const PRODUCTION_CONFIG: Readonly<EnvironmentConfig> = Object.freeze({
  environment: 'production',
  apiBaseUrl: DEFAULT_PROD_API_BASE_URL,
  requireHttps: true,
  allowInsecureHttp: false,
  isMockService: false,
  serviceType: 'live',
  timeoutMs: DEFAULT_PROD_TIMEOUT_MS,
  pollIntervalMs: DEFAULT_PROD_POLL_INTERVAL_MS,
  logLevel: 'warn',
  storageNamespace: 'guardrail_prod',
});

/**
 * Detailed error record for an environment configuration validation failure.
 */
export interface EnvironmentValidationErrorDetail {
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly actualValue?: unknown;
}

/**
 * Result of validating an environment configuration.
 */
export interface EnvironmentValidationResult {
  readonly valid: boolean;
  readonly errors: readonly EnvironmentValidationErrorDetail[];
  readonly config?: EnvironmentConfig;
  readonly warnings: readonly string[];
}

/**
 * Detects whether a hostname represents a loopback/local address.
 */
export function isLocalhost(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase();
  return (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean.endsWith('.localhost')
  );
}

/**
 * Recursively scans an object for forbidden secret keys or credential patterns.
 */
export function detectForbiddenSecrets(
  target: unknown,
  path = ''
): EnvironmentValidationErrorDetail[] {
  const errors: EnvironmentValidationErrorDetail[] = [];
  if (!target || typeof target !== 'object') {
    return errors;
  }

  for (const [key, value] of Object.entries(target as Record<string, unknown>)) {
    const fieldPath = path ? `${path}.${key}` : key;
    const lowerKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');

    // Check key against forbidden secret keywords
    if (FORBIDDEN_SECRET_KEYS.some((fk) => lowerKey === fk || lowerKey.endsWith(`_${fk}`) || lowerKey.endsWith(fk))) {
      errors.push({
        field: fieldPath,
        code: 'SECRET_EXPOSURE_DETECTED',
        message: `Security violation: Forbidden secret property \"${fieldPath}\" detected in environment configuration. Static configs must NEVER contain secrets.`,
      });
      continue;
    }

    // Check string values for sensitive token signatures (e.g. Bearer JWT)
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^Bearer\s+[A-Za-z0-9_.-]{10,}/i.test(trimmed) || /^eyJ[A-Za-z0-9_.-]{10,}/.test(trimmed)) {
        errors.push({
          field: fieldPath,
          code: 'SECRET_TOKEN_DETECTED',
          message: `Security violation: Value for \"${fieldPath}\" appears to contain an active JWT or Bearer credential. Secrets must not be bundled.`,
        });
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      errors.push(...detectForbiddenSecrets(value, fieldPath));
    }
  }

  return errors;
}

/**
 * Validates an environment configuration object at startup.
 *
 * @param input The configuration to validate
 * @param targetEnv Optional explicit target environment
 */
export function validateEnvironmentConfig(
  input: unknown,
  targetEnv?: AppEnvironment
): EnvironmentValidationResult {
  const errors: EnvironmentValidationErrorDetail[] = [];
  const warnings: string[] = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: [
        {
          field: 'config',
          code: 'INVALID_CONFIG_TYPE',
          message: 'Environment configuration must be a non-null object.',
          actualValue: input,
        },
      ],
      warnings: [],
    };
  }

  // 1. Secret Exposure Scan (Requirement 3 & 8)
  const secretErrors = detectForbiddenSecrets(input);
  errors.push(...secretErrors);

  const raw = input as Record<string, unknown>;

  // 2. Environment Validation (Requirement 1)
  const validEnvironments: AppEnvironment[] = ['development', 'pilot', 'test', 'production'];
  const env: AppEnvironment =
    targetEnv ??
    (typeof raw.environment === 'string' && validEnvironments.includes(raw.environment as AppEnvironment)
      ? (raw.environment as AppEnvironment)
      : 'development');

  if (raw.environment !== undefined && !validEnvironments.includes(raw.environment as AppEnvironment)) {
    errors.push({
      field: 'environment',
      code: 'INVALID_ENVIRONMENT',
      message: `Invalid environment: \"${String(raw.environment)}\". Must be one of: ${validEnvironments.join(', ')}.`,
      actualValue: raw.environment,
    });
  }

  // 3. API Base URL Validation (with Requirement 5 safe fallback when omitted)
  const preset = getPresetForEnvironment(env);
  let parsedUrl: URL | null = null;
  const isOmitted = raw.apiBaseUrl === undefined;
  const rawUrl =
    typeof raw.apiBaseUrl === 'string' && raw.apiBaseUrl.trim()
      ? raw.apiBaseUrl.trim()
      : isOmitted
      ? preset.apiBaseUrl
      : '';

  if (isOmitted) {
    warnings.push(`apiBaseUrl omitted; falling back safely to preset default (${preset.apiBaseUrl}).`);
  }

  if (!rawUrl) {
    errors.push({
      field: 'apiBaseUrl',
      code: 'MISSING_API_BASE_URL',
      message: 'apiBaseUrl is required and must be a non-empty string.',
    });
  } else {
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      errors.push({
        field: 'apiBaseUrl',
        code: 'MALFORMED_URL',
        message: `apiBaseUrl \"${rawUrl}\" is not a syntactically valid URL.`,
        actualValue: rawUrl,
      });
    }
  }

  if (parsedUrl) {
    // 3a. Credentials in URL check (Requirement 8)
    if (parsedUrl.username || parsedUrl.password) {
      errors.push({
        field: 'apiBaseUrl',
        code: 'INVALID_URL_CREDENTIALS',
        message: 'Security violation: apiBaseUrl must not contain embedded username or password credentials.',
      });
    }

    // 3b. Protocol checks per environment
    const isHttps = parsedUrl.protocol === 'https:';
    const isHttp = parsedUrl.protocol === 'http:';

    if (!isHttps && !isHttp) {
      errors.push({
        field: 'apiBaseUrl',
        code: 'UNSUPPORTED_PROTOCOL',
        message: `apiBaseUrl protocol \"${parsedUrl.protocol}\" is unsupported. Only HTTPS and HTTP (localhost only) are allowed.`,
        actualValue: parsedUrl.protocol,
      });
    }

    const isLocal = isLocalhost(parsedUrl.hostname);
    const allowInsecure = Boolean(raw.allowInsecureHttp);

    if (env === 'production') {
      if (!isHttps) {
        errors.push({
          field: 'apiBaseUrl',
          code: 'INSECURE_HTTP_REJECTED',
          message: `Insecure HTTP base URL \"${rawUrl}\" is strictly forbidden in production. Endpoints must use HTTPS.`,
          actualValue: rawUrl,
        });
      }
    } else if (env === 'pilot') {
      if (!isHttps) {
        if (!isLocal || !allowInsecure) {
          errors.push({
            field: 'apiBaseUrl',
            code: 'INSECURE_HTTP_REJECTED',
            message: `Insecure HTTP URL \"${rawUrl}\" is rejected in pilot environment. Remote endpoints must use HTTPS.`,
            actualValue: rawUrl,
          });
        } else {
          warnings.push(
            `[Pilot Warning] Plaintext HTTP permitted only for local pilot testing on localhost (${rawUrl}). Remote pilot endpoints MUST use HTTPS.`
          );
        }
      }
    }
  }

  // 4. Mock Service vs. Live Service Distinction (Requirement 6)
  const isMock = Boolean(raw.isMockService);
  const serviceType: ServiceType =
    raw.serviceType === 'live' || raw.serviceType === 'mock' || raw.serviceType === 'in_memory'
      ? (raw.serviceType as ServiceType)
      : isMock
      ? 'in_memory'
      : 'live';

  if (env === 'production' && (isMock || serviceType !== 'live')) {
    errors.push({
      field: 'isMockService',
      code: 'MOCK_SERVICE_IN_PROD_PROHIBITED',
      message: 'Mock or in-memory services are strictly forbidden in production mode.',
      actualValue: { isMock, serviceType },
    });
  } else if (env === 'pilot' && (isMock || serviceType !== 'live')) {
    if (!raw.allowMockInPilot) {
      errors.push({
        field: 'isMockService',
        code: 'MOCK_SERVICE_IN_PILOT_PROHIBITED',
        message: 'Mock or in-memory service detected in pilot mode without explicit \"allowMockInPilot\" flag. Mock services cannot accidentally be mistaken for live pilot services.',
        actualValue: { isMock, serviceType },
      });
    } else {
      warnings.push(
        '[Pilot Notice] An in-memory/mock service is explicitly configured for pilot testing. Decisions and approval records are ephemeral and will NOT survive process restarts.'
      );
    }
  }

  // 5. Numeric Bounds Validation (Requirement 5: safe fallbacks)
  let timeoutMs = typeof raw.timeoutMs === 'number' && !isNaN(raw.timeoutMs) ? raw.timeoutMs : undefined;
  if (timeoutMs !== undefined && (timeoutMs < 500 || timeoutMs > 60000)) {
    warnings.push(`timeoutMs ${timeoutMs}ms out of recommended bounds [500ms, 60000ms]; clamping to safe range.`);
    timeoutMs = Math.max(500, Math.min(60000, timeoutMs));
  }

  let pollIntervalMs =
    typeof raw.pollIntervalMs === 'number' && !isNaN(raw.pollIntervalMs) ? raw.pollIntervalMs : undefined;
  if (pollIntervalMs !== undefined && (pollIntervalMs < 10 || pollIntervalMs > 300000)) {
    warnings.push(`pollIntervalMs ${pollIntervalMs}ms out of recommended bounds [10ms, 300000ms]; clamping.`);
    pollIntervalMs = Math.max(10, Math.min(300000, pollIntervalMs));
  }

  // 6. Log Level Validation
  const validLogLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const logLevel: LogLevel =
    typeof raw.logLevel === 'string' && validLogLevels.includes(raw.logLevel as LogLevel)
      ? (raw.logLevel as LogLevel)
      : env === 'development'
      ? 'debug'
      : env === 'pilot'
      ? 'info'
      : 'warn';

  if (raw.logLevel !== undefined && !validLogLevels.includes(raw.logLevel as LogLevel)) {
    warnings.push(`Unrecognized logLevel \"${String(raw.logLevel)}\"; defaulted to \"${logLevel}\".`);
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
    };
  }

  // Construct validated, immutable configuration object
  const validatedConfig: EnvironmentConfig = Object.freeze({
    environment: env,
    apiBaseUrl: parsedUrl ? parsedUrl.toString().replace(/\/+$/, '') : preset.apiBaseUrl,
    requireHttps: env === 'production' || env === 'pilot',
    allowInsecureHttp: env === 'development' || env === 'test' || Boolean(raw.allowInsecureHttp && isLocalhost(parsedUrl?.hostname || '')),
    isMockService: isMock,
    serviceType,
    timeoutMs: timeoutMs ?? preset.timeoutMs,
    pollIntervalMs: pollIntervalMs ?? preset.pollIntervalMs,
    logLevel,
    storageNamespace:
      typeof raw.storageNamespace === 'string' && raw.storageNamespace.trim()
        ? raw.storageNamespace.trim()
        : preset.storageNamespace,
    allowMockInPilot: Boolean(raw.allowMockInPilot),
  });

  return {
    valid: true,
    errors: Object.freeze([]),
    warnings: Object.freeze(warnings),
    config: validatedConfig,
  };
}

/**
 * Returns the default preset configuration for a given environment.
 */
export function getPresetForEnvironment(env: AppEnvironment): EnvironmentConfig {
  switch (env) {
    case 'pilot':
      return PILOT_CONFIG;
    case 'test':
      return TEST_CONFIG;
    case 'production':
      return PRODUCTION_CONFIG;
    case 'development':
    default:
      return DEVELOPMENT_CONFIG;
  }
}

/**
 * Detects the active execution environment using standard environment variables and runtime globals.
 */
export function detectCurrentEnvironment(): AppEnvironment {
  // 1. Process environment (Node.js / esbuild define)
  if (typeof process !== 'undefined' && process.env) {
    const custom = process.env.GUARDRAIL_ENV?.toLowerCase()?.trim();
    if (custom === 'pilot') return 'pilot';
    if (custom === 'production') return 'production';
    if (custom === 'test') return 'test';
    if (custom === 'development') return 'development';

    const nodeEnv = process.env.NODE_ENV?.toLowerCase()?.trim();
    if (nodeEnv === 'production') return 'production';
    if (nodeEnv === 'test') return 'test';
    if (nodeEnv === 'pilot') return 'pilot';
  }

  // 2. Global window / extension context flag
  if (typeof (globalThis as any).__GUARDRAIL_ENV__ === 'string') {
    const val = (globalThis as any).__GUARDRAIL_ENV__.toLowerCase().trim();
    if (val === 'pilot') return 'pilot';
    if (val === 'production') return 'production';
    if (val === 'test') return 'test';
  }

  // 3. Fallback to development
  return 'development';
}

/**
 * Resolves a complete, validated EnvironmentConfig by applying overrides on top
 * of environment presets with safe fallback defaults.
 *
 * @param overrides Partial configuration overrides
 * @param requestedEnv Explicit environment override
 * @returns Fully validated and defaulted EnvironmentConfig
 */
export function resolveEnvironmentConfig(
  overrides?: Partial<EnvironmentConfig>,
  requestedEnv?: string
): EnvironmentConfig {
  const env: AppEnvironment = (
    requestedEnv && ['development', 'pilot', 'test', 'production'].includes(requestedEnv)
      ? requestedEnv
      : overrides?.environment ?? detectCurrentEnvironment()
  ) as AppEnvironment;

  const preset = getPresetForEnvironment(env);

  const merged: Record<string, unknown> = {
    ...preset,
    ...(overrides || {}),
    environment: env,
  };

  const validation = validateEnvironmentConfig(merged, env);
  if (!validation.valid || !validation.config) {
    const errorDetails = validation.errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
    throw new Error(`[Guardrail Environment] Startup configuration validation failed: ${errorDetails}`);
  }

  return validation.config;
}
