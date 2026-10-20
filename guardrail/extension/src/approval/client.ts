/**
 * Guardrail Approval API Client
 *
 * Centralized, strongly typed HTTP client for communicating with the remote Guardrail
 * Approval Backend. Adheres strictly to the integration contract defined in:
 * `guardrail/docs/extension-to-backend-integration-contract.md`.
 *
 * ARCHITECTURAL PRINCIPLES & BOUNDARIES:
 * 1. TRANSPORT DECOUPLED FROM BUSINESS LOGIC:
 *    - This client handles network transport, serialization, deserialization,
 *      authentication headers, status code validation, and error envelope parsing.
 *    - It strictly DOES NOT trigger continuation, release held actions, or
 *      modify browser interception states. Continuation is governed exclusively by
 *      `ContinuationManager` upon explicit user confirmation in Staging Mode.
 * 2. HTTP SUCCESS != ACTION APPROVAL:
 *    - A 201 Created response from `createApprovalRequest()` confirms ONLY that
 *      the request was registered on the server in PENDING state. It does NOT
 *      approve the action. The browser action remains HELD in browser memory.
 * 3. ZERO EMBEDDED CREDENTIALS:
 *    - No hardcoded tokens, passwords, or mock identities. Tokens are supplied
 *      via `TokenProvider` or retrieved from `chrome.storage.local`.
 *    - If no token is available, returns a typed UNAUTHENTICATED error without
 *      inventing fake credentials or making an unauthenticated network call.
 * 4. STRICT PRIVACY & LEAST PRIVILEGE:
 *    - Request bodies strictly exclude sensitive fields (passwords, OTPs,
 *      cards, tokens, cookies, raw form values).
 *    - Headers and payloads are never logged to console or storage.
 * 5. RESILIENT ERROR HANDLING:
 *    - Safely handles network failures, timeouts, HTML server errors, and malformed JSON
 *      without throwing unhandled exceptions or crashing the extension runtime.
 */

declare const chrome: any;

import {
  ApprovalRequest,
  ApprovalStatus,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import { ApiResponseEnvelope } from './api.js';
import { FORBIDDEN_PROPERTY_PATTERNS } from './model.js';

// =============================================================================
// Configuration Constants
// =============================================================================

export const DEFAULT_DEV_API_BASE_URL = 'http://localhost:3000';
export const DEFAULT_PROD_API_BASE_URL = 'https://api.guardrail-safety.org';
export const DEFAULT_REQUEST_TIMEOUT_MS = 10000; // 10 seconds

// =============================================================================
// Error Codes & Typed Envelopes
// =============================================================================

/**
 * Standardized API client error codes.
 */
export const ApiClientErrorCodes = Object.freeze({
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  TIMEOUT: 'TIMEOUT',
  MALFORMED_JSON_RESPONSE: 'MALFORMED_JSON_RESPONSE',
  SERVER_ERROR: 'SERVER_ERROR',
  NOT_FOUND_OR_DENIED: 'NOT_FOUND_OR_DENIED',
  ALREADY_RESOLVED: 'ALREADY_RESOLVED',
  REQUEST_EXPIRED: 'REQUEST_EXPIRED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const);

export type ApiClientErrorCode =
  (typeof ApiClientErrorCodes)[keyof typeof ApiClientErrorCodes];

/**
 * Structured client error details.
 */
export interface ApiClientError {
  readonly code: string;
  readonly message: string;
  readonly statusCode?: number;
  readonly details?: readonly string[];
}

/**
 * Standard typed success result.
 */
export interface ApiClientSuccess<T> {
  readonly success: true;
  readonly data: T;
  readonly statusCode: number;
}

/**
 * Standard typed failure result.
 */
export interface ApiClientFailure {
  readonly success: false;
  readonly error: ApiClientError;
  readonly statusCode?: number;
}

/**
 * Unified result type returned by all ApprovalApiClient operations.
 */
export type ApiClientResult<T> = ApiClientSuccess<T> | ApiClientFailure;

// =============================================================================
// Client Configuration & Options
// =============================================================================

/**
 * Function providing the current user's Bearer authentication token.
 */
export type TokenProvider = () => Promise<string | undefined> | string | undefined;

/**
 * Safe logging interface for ApprovalApiClient.
 * Implementations must never receive tokens, auth headers, or sensitive payloads.
 */
export interface ApiClientLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Silent no-op logger default.
 */
export class NoopApiClientLogger implements ApiClientLogger {
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

/**
 * Configuration options for constructing an ApprovalApiClient.
 */
export interface ApprovalApiClientConfig {
  /**
   * Base URL of the Guardrail Approval Backend.
   * Defaults to DEFAULT_DEV_API_BASE_URL (http://localhost:3000).
   */
  readonly baseUrl?: string;

  /**
   * Token provider function returning the active user Bearer token.
   * If omitted, attempts to read 'guardrailAuthToken' from chrome.storage.local.
   */
  readonly tokenProvider?: TokenProvider;

  /**
   * Request timeout in milliseconds. Default: 10,000 ms.
   */
  readonly timeoutMs?: number;

  /**
   * Custom fetch implementation (enables unit testing without network sockets).
   * Defaults to globalThis.fetch.
   */
  readonly fetchFn?: typeof fetch;

  /**
   * Safe logger instance.
   */
  readonly logger?: ApiClientLogger;
}

/**
 * Options supported on individual client requests.
 */
export interface RequestOptions {
  /** Optional Bearer token overriding the client-wide provider for this request */
  readonly token?: string;
  /** Optional timeout override in milliseconds for this request */
  readonly timeoutMs?: number;
  /** Optional external AbortSignal */
  readonly signal?: AbortSignal;
}

// =============================================================================
// Helper Functions: URL & Token Resolution
// =============================================================================

/**
 * Resolves the backend base URL using the established hierarchy:
 * 1. Explicit override passed to function.
 * 2. 'guardrailApiBaseUrl' stored in chrome.storage.local (if available).
 * 3. Default development base URL (http://localhost:3000).
 */
export async function resolveApiBaseUrl(customBaseUrl?: string): Promise<string> {
  if (customBaseUrl && typeof customBaseUrl === 'string' && customBaseUrl.trim()) {
    return customBaseUrl.trim().replace(/\/+$/, '');
  }
  if (typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem('guardrailApiBaseUrl');
      if (stored && typeof stored === 'string' && stored.trim()) {
        return stored.trim().replace(/\/+$/, '');
      }
    } catch {
      // Storage unavailable or permission issue
    }
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
    try {
      const res = await chrome.storage.local.get('guardrailApiBaseUrl');
      if (res && typeof res.guardrailApiBaseUrl === 'string' && res.guardrailApiBaseUrl.trim()) {
        return res.guardrailApiBaseUrl.trim().replace(/\/+$/, '');
      }
    } catch {
      // Storage unavailable or permission issue, fallback to default
    }
  }
  return DEFAULT_DEV_API_BASE_URL;
}

/**
 * Resolves the active user authentication token using the established hierarchy:
 * 1. Provided TokenProvider callback.
 * 2. 'guardrailAuthToken' stored in sessionStorage (if available).
 * 3. 'guardrailAuthToken' stored in chrome.storage.local (if available).
 * 4. Undefined (caller must be prompted to authenticate).
 */
export async function resolveAuthToken(tokenProvider?: TokenProvider): Promise<string | undefined> {
  if (tokenProvider) {
    const token = await tokenProvider();
    if (token && typeof token === 'string' && token.trim()) {
      return token.trim();
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    try {
      const token = sessionStorage.getItem('guardrailAuthToken');
      if (token && token.trim()) return token.trim();
    } catch {
      // Storage unavailable or permission issue
    }
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
    try {
      const res = await chrome.storage.local.get('guardrailAuthToken');
      if (res && typeof res.guardrailAuthToken === 'string' && res.guardrailAuthToken.trim()) {
        return res.guardrailAuthToken.trim();
      }
    } catch {
      // Storage unavailable or permission issue
    }
  }
  return undefined;
}

/**
 * Recursively scans an object for keys that match forbidden sensitive patterns.
 */
export function checkPayloadForSensitiveFields(obj: unknown, path: string = ''): string[] {
  if (!obj || typeof obj !== 'object') {
    return [];
  }
  const violations: string[] = [];
  const rec = obj as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    const fullPath = path ? `${path}.${key}` : key;
    const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    for (const pattern of FORBIDDEN_PROPERTY_PATTERNS) {
      if (pattern.test(key) || pattern.test(normalizedKey)) {
        violations.push(fullPath);
        break;
      }
    }
    const val = rec[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      violations.push(...checkPayloadForSensitiveFields(val, fullPath));
    }
  }
  return violations;
}

/**
 * Validates that a client payload satisfies zero-trust client invariants before network dispatch:
 * 1. Does not attempt to supply server-controlled fields (requesterId, userId, status, decision, resolvedAt, id).
 * 2. Does not contain any sensitive fields (passwords, OTPs, PINs, cards, cookies, tokens).
 */
export function validateClientPayloadIntegrity(payload: ClientApprovalRequestPayload): string[] {
  const violations: string[] = [];
  const raw = payload as unknown as Record<string, unknown>;

  if (raw.requesterId !== undefined) {
    violations.push('Client payload cannot specify "requesterId" (derived authoritatively by server).');
  }
  if (raw.userId !== undefined) {
    violations.push('Client payload cannot specify "userId" (derived authoritatively by server).');
  }
  if (raw.status !== undefined) {
    violations.push('Client payload cannot specify "status" (server initializes requests to PENDING).');
  }
  if (raw.decision !== undefined) {
    violations.push('Client payload cannot specify "decision" (reserved for authorized reviewer decisions).');
  }
  if (raw.resolvedAt !== undefined) {
    violations.push('Client payload cannot specify "resolvedAt" (assigned when request is resolved).');
  }
  if (raw.id !== undefined) {
    violations.push('Client payload cannot specify "id" (canonical requestId is assigned by server).');
  }

  const sensitive = checkPayloadForSensitiveFields(payload);
  for (const s of sensitive) {
    violations.push(
      `Forbidden sensitive property "${s}" violates privacy policy (passwords, OTPs, cards, cookies, and tokens are prohibited).`
    );
  }

  return violations;
}

// =============================================================================
// Approval API Client Implementation
// =============================================================================

/**
 * Reusable, typed HTTP client for the Guardrail Approval Backend.
 */
export class ApprovalApiClient {
  private readonly baseUrl: string;
  private readonly tokenProvider?: TokenProvider;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly logger: ApiClientLogger;

  constructor(config?: ApprovalApiClientConfig) {
    this.baseUrl = (config?.baseUrl ?? DEFAULT_DEV_API_BASE_URL).trim().replace(/\/+$/, '');
    this.tokenProvider = config?.tokenProvider;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchFn = config?.fetchFn ?? globalThis.fetch;
    this.logger = config?.logger ?? new NoopApiClientLogger();
  }

  /**
   * Returns the configured backend base URL.
   */
  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Submits an approval request for an intercepted action held in browser runtime.
   *
   * ARCHITECTURAL INVARIANT:
   * A successful response (201 Created) confirms ONLY that an approval request was
   * registered on the backend in PENDING state. It does NOT approve or execute the action.
   * The intercepted interaction remains safely HELD in browser memory.
   *
   * @param payload Sanitized client action metadata matching ClientApprovalRequestPayload
   * @param options Optional request overrides (token, timeout, signal)
   * @returns Typed ApiClientResult with newly created ApprovalRequest or error
   */
  public async createApprovalRequest(
    payload: ClientApprovalRequestPayload,
    options?: RequestOptions
  ): Promise<ApiClientResult<ApprovalRequest>> {
    // 1. Client-side pre-flight payload validation
    if (!payload || typeof payload !== 'object') {
      return {
        success: false,
        error: {
          code: ApiClientErrorCodes.VALIDATION_ERROR,
          message: 'ClientApprovalRequestPayload must be a non-null object.',
          statusCode: 400,
        },
        statusCode: 400,
      };
    }

    const integrityViolations = validateClientPayloadIntegrity(payload);
    if (integrityViolations.length > 0) {
      return {
        success: false,
        error: {
          code: ApiClientErrorCodes.VALIDATION_ERROR,
          message: `Payload validation failed:\n${integrityViolations.map((v) => `  - ${v}`).join('\n')}`,
          statusCode: 400,
          details: Object.freeze(integrityViolations),
        },
        statusCode: 400,
      };
    }

    // 2. Dispatch POST /api/v1/approval-requests
    return this.dispatchRequest<ApprovalRequest>(
      'POST',
      '/api/v1/approval-requests',
      payload,
      options
    );
  }

  /**
   * Retrieves an ApprovalRequest by its canonical requestId.
   * Used by the service worker to poll the authoritative lifecycle status.
   *
   * ARCHITECTURAL INVARIANT:
   * Even if this call returns `status: "APPROVED"`, the client must NOT automatically
   * execute the browser action. The action remains HELD until the user reviews and confirms.
   *
   * @param requestId Canonical approval request identifier ('apr_...')
   * @param options Optional request overrides (token, timeout, signal)
   * @returns Typed ApiClientResult with current ApprovalRequest or error
   */
  public async getApprovalRequest(
    requestId: string,
    options?: RequestOptions
  ): Promise<ApiClientResult<ApprovalRequest>> {
    if (!requestId || typeof requestId !== 'string' || !requestId.trim()) {
      return {
        success: false,
        error: {
          code: ApiClientErrorCodes.VALIDATION_ERROR,
          message: 'requestId is required and must be a non-empty string.',
          statusCode: 400,
        },
        statusCode: 400,
      };
    }

    const sanitizedId = encodeURIComponent(requestId.trim());
    return this.dispatchRequest<ApprovalRequest>(
      'GET',
      `/api/v1/approval-requests/${sanitizedId}`,
      undefined,
      options
    );
  }

  /**
   * Cancels a PENDING approval request on the server when the user aborts in Staging Mode.
   *
   * @param requestId Canonical approval request identifier ('apr_...')
   * @param reason Optional human-readable cancellation explanation
   * @param options Optional request overrides (token, timeout, signal)
   * @returns Typed ApiClientResult with cancelled ApprovalRequest or error
   */
  public async cancelApprovalRequest(
    requestId: string,
    reason?: string,
    options?: RequestOptions
  ): Promise<ApiClientResult<ApprovalRequest>> {
    if (!requestId || typeof requestId !== 'string' || !requestId.trim()) {
      return {
        success: false,
        error: {
          code: ApiClientErrorCodes.VALIDATION_ERROR,
          message: 'requestId is required and must be a non-empty string.',
          statusCode: 400,
        },
        statusCode: 400,
      };
    }

    const sanitizedId = encodeURIComponent(requestId.trim());
    const body = reason !== undefined ? { reason: String(reason) } : {};

    return this.dispatchRequest<ApprovalRequest>(
      'POST',
      `/api/v1/approval-requests/${sanitizedId}/cancel`,
      body,
      options
    );
  }

  /**
   * Retrieves all active PENDING approval requests that the authenticated trusted contact
   * is authorized to review.
   *
   * Adheres strictly to Section 5.1 of guardrail/docs/trusted-contact-dashboard-contract.md:
   * GET /api/v1/approvals/pending
   *
   * @param options Optional request overrides (token, timeout, signal)
   * @returns Typed ApiClientResult with readonly array of ApprovalRequest or error
   */
  public async listPendingApprovals(
    options?: RequestOptions
  ): Promise<ApiClientResult<readonly ApprovalRequest[]>> {
    return this.dispatchRequest<readonly ApprovalRequest[]>(
      'GET',
      '/api/v1/approvals/pending',
      undefined,
      options
    );
  }

  /**
   * Retrieves full details for a specific approval request for a trusted contact.
   *
   * Adheres strictly to Section 5.2 of guardrail/docs/trusted-contact-dashboard-contract.md:
   * GET /api/v1/approvals/:id
   *
   * @param requestId Canonical approval request identifier ('apr_...')
   * @param options Optional request overrides (token, timeout, signal)
   * @returns Typed ApiClientResult with ApprovalRequest or error
   */
  public async getApprovalDetails(
    requestId: string,
    options?: RequestOptions
  ): Promise<ApiClientResult<ApprovalRequest>> {
    if (!requestId || typeof requestId !== 'string' || !requestId.trim()) {
      return {
        success: false,
        error: {
          code: ApiClientErrorCodes.VALIDATION_ERROR,
          message: 'requestId is required and must be a non-empty string.',
          statusCode: 400,
        },
        statusCode: 400,
      };
    }

    const sanitizedId = encodeURIComponent(requestId.trim());
    return this.dispatchRequest<ApprovalRequest>(
      'GET',
      `/api/v1/approvals/${sanitizedId}`,
      undefined,
      options
    );
  }

  /**
   * Helper verifying whether an ApprovalRequest has been approved by a trusted contact.
   *
   * @note Even when true, the browser action remains HELD until explicitly released by the user.
   */
  public isApprovalApproved(request: ApprovalRequest): boolean {
    return request && request.status === ApprovalStatus.APPROVED;
  }

  /**
   * Helper verifying whether an ApprovalRequest is currently in PENDING state.
   */
  public isApprovalPending(request: ApprovalRequest): boolean {
    return request && request.status === ApprovalStatus.PENDING;
  }

  /**
   * Helper verifying whether an ApprovalRequest has reached a terminal state.
   */
  public isApprovalTerminal(request: ApprovalRequest): boolean {
    if (!request) return false;
    return (
      request.status === ApprovalStatus.APPROVED ||
      request.status === ApprovalStatus.REJECTED ||
      request.status === ApprovalStatus.EXPIRED ||
      request.status === ApprovalStatus.CANCELLED
    );
  }

  // ===========================================================================
  // Internal Transport & Dispatch Implementation
  // ===========================================================================

  /**
   * Core request dispatcher handling HTTP transport, authentication, timeouts,
   * safe parsing, and error mapping without crashing the extension runtime.
   */
  private async dispatchRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<ApiClientResult<T>> {
    const startTime = Date.now();
    const url = `${this.baseUrl}${path}`;

    // 1. Resolve authentication token
    let token = options?.token?.trim();
    if (!token) {
      token = await resolveAuthToken(this.tokenProvider);
    }

    if (!token) {
      this.logger.warn('Request aborted: No authentication token available', {
        method,
        path,
        reason: 'UNAUTHENTICATED',
      });
      return {
        success: false,
        error: {
          code: ApiClientErrorCodes.UNAUTHENTICATED,
          message: 'Authentication required. No valid session token is available for this request.',
          statusCode: 401,
        },
        statusCode: 401,
      };
    }

    // 2. Prepare headers (never log or leak token)
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };

    let serializedBody: string | undefined;
    if (body !== undefined && method === 'POST') {
      headers['Content-Type'] = 'application/json';
      try {
        serializedBody = JSON.stringify(body);
      } catch (serErr) {
        return {
          success: false,
          error: {
            code: ApiClientErrorCodes.VALIDATION_ERROR,
            message: `Failed to serialize request body: ${serErr instanceof Error ? serErr.message : String(serErr)}`,
            statusCode: 400,
          },
          statusCode: 400,
        };
      }
    }

    // 3. Configure AbortController timeout
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }

    // Chain caller's external AbortSignal if provided
    let externalAbortHandler: (() => void) | undefined;
    if (options?.signal) {
      if (options.signal.aborted) {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        return {
          success: false,
          error: {
            code: ApiClientErrorCodes.TIMEOUT,
            message: 'Request aborted by caller signal before execution.',
            statusCode: 408,
          },
          statusCode: 408,
        };
      }
      externalAbortHandler = () => {
        controller.abort(options.signal?.reason);
      };
      options.signal.addEventListener('abort', externalAbortHandler);
    }

    try {
      // 4. Execute fetch call
      const response = await this.fetchFn(url, {
        method,
        headers,
        body: serializedBody,
        signal: controller.signal,
      });

      // 5. Read raw response body safely
      let rawText = '';
      try {
        rawText = await response.text();
      } catch (readErr) {
        return {
          success: false,
          error: {
            code: ApiClientErrorCodes.NETWORK_FAILURE,
            message: `Failed to read response body: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
            statusCode: response.status,
          },
          statusCode: response.status,
        };
      }

      // 6. Safe JSON parsing (handles HTML errors or malformed syntax)
      let parsed: unknown = undefined;
      if (rawText.trim()) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          this.logger.warn('Server returned non-JSON response body', {
            method,
            path,
            statusCode: response.status,
          });
          return {
            success: false,
            error: {
              code: response.ok
                ? ApiClientErrorCodes.MALFORMED_JSON_RESPONSE
                : ApiClientErrorCodes.SERVER_ERROR,
              message: response.ok
                ? 'Server returned invalid JSON response syntax.'
                : `Server returned HTTP ${response.status} with non-JSON body.`,
              statusCode: response.status,
            },
            statusCode: response.status,
          };
        }
      }

      // 7. Parse standard ApiResponseEnvelope
      const envelope = parsed as ApiResponseEnvelope<T> | undefined;

      if (envelope && typeof envelope === 'object') {
        if (envelope.success === true && response.ok) {
          this.logger.info('API request completed successfully', {
            method,
            path,
            statusCode: response.status,
            durationMs: Date.now() - startTime,
          });
          return {
            success: true,
            data: envelope.data as T,
            statusCode: response.status,
          };
        }

        if (envelope.success === false && envelope.error) {
          const mappedCode = this.mapServerErrorCode(
            envelope.error.code,
            envelope.error.statusCode || response.status
          );
          this.logger.warn('Server returned error envelope', {
            method,
            path,
            statusCode: response.status,
            errorCode: mappedCode,
          });
          return {
            success: false,
            error: {
              code: mappedCode,
              message: envelope.error.message || `HTTP error ${response.status}`,
              statusCode: envelope.error.statusCode || response.status,
              details: envelope.error.details,
            },
            statusCode: response.status,
          };
        }
      }

      // 8. Fallback for non-enveloped HTTP responses
      if (response.ok) {
        return {
          success: true,
          data: (parsed ?? {}) as T,
          statusCode: response.status,
        };
      }

      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: `Request failed with HTTP status ${response.status}.`,
          statusCode: response.status,
        },
        statusCode: response.status,
      };
    } catch (networkErr: unknown) {
      // 9. Handle timeout vs network failure
      const isAbort =
        (networkErr instanceof Error && networkErr.name === 'AbortError') ||
        controller.signal.aborted;

      if (isAbort) {
        this.logger.warn('API request timed out or was aborted', {
          method,
          path,
          timeoutMs,
        });
        return {
          success: false,
          error: {
            code: ApiClientErrorCodes.TIMEOUT,
            message: `Request to "${path}" timed out after ${timeoutMs}ms.`,
            statusCode: 408,
          },
          statusCode: 408,
        };
      }

      const errMsg = networkErr instanceof Error ? networkErr.message : String(networkErr);
      this.logger.error('API network request failed', {
        method,
        path,
        error: errMsg,
      });

      return {
        success: false,
        error: {
          code: ApiClientErrorCodes.NETWORK_FAILURE,
          message: `Network request to "${url}" failed: ${errMsg}`,
          statusCode: 0,
        },
        statusCode: 0,
      };
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (options?.signal && externalAbortHandler) {
        options.signal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  /**
   * Normalizes server error codes to standard client error codes.
   */
  private mapServerErrorCode(code: string | undefined, statusCode: number): string {
    if (code && typeof code === 'string' && code.trim()) {
      return code.trim();
    }
    switch (statusCode) {
      case 400:
        return ApiClientErrorCodes.VALIDATION_ERROR;
      case 401:
        return ApiClientErrorCodes.UNAUTHENTICATED;
      case 404:
        return ApiClientErrorCodes.NOT_FOUND_OR_DENIED;
      case 409:
        return ApiClientErrorCodes.ALREADY_RESOLVED;
      case 410:
        return ApiClientErrorCodes.REQUEST_EXPIRED;
      case 413:
        return ApiClientErrorCodes.PAYLOAD_TOO_LARGE;
      case 415:
        return ApiClientErrorCodes.UNSUPPORTED_MEDIA_TYPE;
      case 429:
        return ApiClientErrorCodes.RATE_LIMIT_EXCEEDED;
      default:
        return statusCode >= 500
          ? ApiClientErrorCodes.SERVER_ERROR
          : ApiClientErrorCodes.UNKNOWN_ERROR;
    }
  }
}
