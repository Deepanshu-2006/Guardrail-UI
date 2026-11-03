import { isAbsolute } from 'node:path';

export type ServerEnvironment = 'development' | 'test' | 'pilot' | 'production';

export interface GuardrailServerConfig {
  readonly environment: ServerEnvironment;
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly allowedOrigins: readonly string[];
}

export class ServerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerConfigurationError';
  }
}

function exactOriginList(raw: string | undefined): readonly string[] {
  if (!raw?.trim()) return Object.freeze([]);
  const origins = raw.split(',').map((part) => part.trim());
  if (origins.some((origin) => !origin || origin === '*')) {
    throw new ServerConfigurationError('GUARDRAIL_ALLOWED_ORIGINS must contain exact origins and cannot contain wildcards.');
  }
  for (const origin of origins) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch {
      throw new ServerConfigurationError('GUARDRAIL_ALLOWED_ORIGINS contains an invalid origin.');
    }
    const extensionOrigin = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
    const validExtension = extensionOrigin && /^(chrome|moz)-extension:\/\/[a-zA-Z0-9-]+$/.test(origin) &&
      !parsed.username && !parsed.password && parsed.search === '' && parsed.hash === '';
    const validWebOrigin = !extensionOrigin && parsed.origin === origin && !parsed.username && !parsed.password &&
      parsed.pathname === '/' && !parsed.search && !parsed.hash;
    if (!validExtension && !validWebOrigin) {
      throw new ServerConfigurationError('GUARDRAIL_ALLOWED_ORIGINS entries must be exact origins without paths or credentials.');
    }
    if (!extensionOrigin && parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new ServerConfigurationError('Non-local dashboard origins must use HTTPS.');
    }
  }
  if (new Set(origins).size !== origins.length) {
    throw new ServerConfigurationError('GUARDRAIL_ALLOWED_ORIGINS cannot contain duplicates.');
  }
  return Object.freeze(origins);
}

/** Parse deployment settings without silently applying development storage in pilot/production. */
export function loadGuardrailServerConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<Pick<GuardrailServerConfig, 'host' | 'port' | 'databasePath' | 'allowedOrigins'>> = {},
): GuardrailServerConfig {
  const requestedEnvironment = env.GUARDRAIL_ENV ?? env.NODE_ENV ?? 'development';
  if (env.NODE_ENV === 'production' && requestedEnvironment !== 'pilot' && requestedEnvironment !== 'production') {
    throw new ServerConfigurationError('A production NODE_ENV cannot be paired with a non-deployment GUARDRAIL_ENV.');
  }
  if (!['development', 'test', 'pilot', 'production'].includes(requestedEnvironment)) {
    throw new ServerConfigurationError('GUARDRAIL_ENV must be development, test, pilot, or production.');
  }
  const environment = requestedEnvironment as ServerEnvironment;
  const deploymentMode = environment === 'pilot' || environment === 'production';
  const rawPort = env.GUARDRAIL_PORT;
  if (rawPort !== undefined && !rawPort.trim()) {
    throw new ServerConfigurationError('GUARDRAIL_PORT cannot be empty.');
  }
  const port = overrides.port ?? (rawPort === undefined ? 3000 : Number(rawPort));
  if (!Number.isInteger(port) || port < 0 || port > 65535 || (deploymentMode && port === 0)) {
    throw new ServerConfigurationError('GUARDRAIL_PORT must be a valid TCP port.');
  }
  const databasePath = overrides.databasePath ?? env.GUARDRAIL_DB_PATH ?? (deploymentMode ? '' : 'data/guardrail.sqlite');
  if (!databasePath.trim() || databasePath === ':memory:' || (deploymentMode && !isAbsolute(databasePath))) {
    throw new ServerConfigurationError('GUARDRAIL_DB_PATH must be an absolute file path outside development and test environments.');
  }
  const allowedOrigins = overrides.allowedOrigins !== undefined
    ? exactOriginList(overrides.allowedOrigins.join(','))
    : exactOriginList(env.GUARDRAIL_ALLOWED_ORIGINS);
  if (deploymentMode && allowedOrigins.length === 0) {
    throw new ServerConfigurationError('GUARDRAIL_ALLOWED_ORIGINS is required for pilot and production environments.');
  }
  const host = overrides.host ?? env.GUARDRAIL_HOST ?? '127.0.0.1';
  if (!host.trim() || /[\s/]/.test(host)) {
    throw new ServerConfigurationError('GUARDRAIL_HOST must be a hostname or IP address.');
  }
  return Object.freeze({
    environment,
    host,
    port,
    databasePath,
    allowedOrigins: Object.freeze([...allowedOrigins]),
  });
}
