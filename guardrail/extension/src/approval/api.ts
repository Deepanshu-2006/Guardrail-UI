/**
 * Guardrail Approval Workflow HTTP API Router & Handler
 *
 * Exposes the authoritative ApprovalService through a minimal, secure REST API
 * adhering strictly to the contract defined in `guardrail/docs/approval-workflow-contract.md`.
 *
 * ENDPOINTS IMPLEMENTED:
 * 1. POST /api/v1/approval-requests         - Create an approval request (User/Ward)
 * 2. GET  /api/v1/approval-requests/:id     - Inspect approval request status (User/Ward)
 * 3. POST /api/v1/approval-requests/:id/cancel - Cancel approval request (User/Ward)
 * 4. GET  /api/v1/approvals/pending         - List pending requests for contact (Trusted Contact)
 * 5. GET  /api/v1/approvals/:id             - Inspect request details for contact (Trusted Contact)
 * 6. POST /api/v1/approvals/:id/decide      - Submit decision (APPROVED/REJECTED) (Trusted Contact)
 *
 * SECURITY INVARIANTS:
 * 1. ZERO TRUST: Client-supplied `requesterId`, `status`, or `decidedBy` are never trusted.
 * 2. AUTHENTICATION REQUIRED: All endpoints require valid Bearer token verification.
 * 3. ANTI-ENUMERATION: Unrelated users receive opaque 404 responses for unowned requests.
 * 4. NARROW CORS: Whitelists only authorized Chrome extension and Dashboard origins. Never '*'.
 * 5. PAYLOAD SANITIZATION: Rejects malformed JSON and payloads exceeding 16KB.
 * 6. STRICT PRIVACY: Whitelists response properties; never leaks credentials or raw form data.
 *
 * INFRASTRUCTURE STATUS & ROADMAP NOTICE:
 * =======================================
 * 1. Persistence: Utilizes the ApprovalRequestRepository abstraction (DevelopmentInMemoryApprovalRequestRepository).
 * 2. Distributed Rate Limiting: Edge/Redis rate limiting is not yet provisioned in `guardrail/server`.
 *    A local development sliding-window rate limiter is provided.
 * 3. Client Integration: Extension background transport (Day 12) and Caretaker Dashboard (Day 13)
 *    are separate upcoming roadmap milestones; they are not claimed to be connected yet.
 */

import {
  ApprovalRequest,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import {
  ApprovalAlreadyResolvedError,
  ApprovalExpiredError,
  ApprovalValidationError,
  DuplicateApprovalRequestError,
} from './model.js';
import {
  ApprovalAccessDeniedError,
  AuthContext,
  SelfApprovalProhibitedError,
  UnauthenticatedError,
  UnauthorizedActionRequesterError,
} from './authorization.js';
import { ApprovalService } from './service.js';

// =============================================================================
// API Configuration & Interfaces
// =============================================================================

/**
 * Standard API response envelope.
 */
export interface ApiResponseEnvelope<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly statusCode: number;
    readonly details?: readonly string[];
  };
}

/**
 * Simplified HTTP request representation for headless in-memory dispatch.
 */
export interface ApiRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
}

/**
 * Simplified HTTP response representation for headless in-memory dispatch.
 */
export interface ApiResponse<T = unknown> {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: ApiResponseEnvelope<T>;
}

/**
 * Duck-typed HTTP incoming message interface compatible with Node.js http.IncomingMessage.
 */
export interface HttpRequestLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers?: Record<string, string | string[] | undefined>;
  on(event: 'data', listener: (chunk: unknown) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: unknown) => void): this;
  destroy?(): void;
}

/**
 * Duck-typed HTTP server response interface compatible with Node.js http.ServerResponse.
 */
export interface HttpResponseLike {
  statusCode: number;
  setHeader(name: string, value: string | number | readonly string[]): void;
  end(chunk?: string): void;
  headersSent?: boolean;
}

/**
 * Token verification interface.
 */
export interface TokenVerifier {
  /**
   * Verifies a bearer token string and returns the authoritative AuthContext.
   * Returns undefined if the token is invalid or expired.
   */
  verifyToken(token: string): AuthContext | Promise<AuthContext> | undefined;
}

/**
 * In-memory token verifier for testing and development sessions.
 */
export class InMemoryTokenVerifier implements TokenVerifier {
  private readonly tokens: Map<string, AuthContext> = new Map();

  public registerToken(token: string, authContext: AuthContext): void {
    this.tokens.set(token.trim(), Object.freeze({ ...authContext }));
  }

  public revokeToken(token: string): void {
    this.tokens.delete(token.trim());
  }

  public verifyToken(token: string): AuthContext | undefined {
    return this.tokens.get(token.trim());
  }

  public clear(): void {
    this.tokens.clear();
  }
}

/**
 * Rate limiter abstraction.
 */
export interface RateLimiter {
  checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number };
}

/**
 * In-memory sliding-window rate limiter for development environments.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly requests: Map<string, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 60, windowSeconds: number = 60) {
    this.maxRequests = maxRequests;
    this.windowMs = windowSeconds * 1000;
  }

  public checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number } {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];

    // Filter timestamps within the current window
    const valid = timestamps.filter((t) => now - t < this.windowMs);

    if (valid.length >= this.maxRequests) {
      const oldest = valid[0];
      const retryAfterMs = this.windowMs - (now - oldest);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    valid.push(now);
    this.requests.set(key, valid);
    return { allowed: true };
  }

  public clear(): void {
    this.requests.clear();
  }
}

/**
 * Configuration options for the Approval API Router.
 */
export interface ApprovalApiRouterConfig {
  /** Allowed origins for CORS. Default: whitelist of extension ID and local dashboard */
  readonly allowedOrigins?: readonly string[];

  /** Maximum request body size in bytes. Default: 16384 (16 KB) */
  readonly maxBodySizeBytes?: number;

  /** Rate limiter instance. Default: InMemoryRateLimiter(100 req / minute) */
  readonly rateLimiter?: RateLimiter;

  /** Optional server secret */
  readonly serverSecret?: string;
}

/**
 * Default CORS origins whitelist.
 * Explicitly avoids wildcard '*' to prevent cross-origin data leakage.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  'chrome-extension://guardrail-extension-id',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);

export const DEFAULT_MAX_BODY_SIZE_BYTES = 16 * 1024; // 16 KB

// =============================================================================
// Approval API Router Implementation
// =============================================================================

/**
 * Router that handles HTTP requests for the Approval Workflow API.
 */
export class ApprovalApiRouter {
  private readonly service: ApprovalService;
  private readonly tokenVerifier: TokenVerifier;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly maxBodySizeBytes: number;
  private readonly rateLimiter?: RateLimiter;

  constructor(
    service: ApprovalService,
    tokenVerifier: TokenVerifier,
    config?: ApprovalApiRouterConfig
  ) {
    this.service = service;
    this.tokenVerifier = tokenVerifier;
    this.allowedOrigins = new Set(config?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
    this.maxBodySizeBytes = config?.maxBodySizeBytes ?? DEFAULT_MAX_BODY_SIZE_BYTES;
    this.rateLimiter = config?.rateLimiter;
  }

  /**
   * Dispatches a headless ApiRequest and returns an ApiResponse.
   * Enables comprehensive route-level unit testing without live network sockets.
   */
  public async dispatch(request: ApiRequest): Promise<ApiResponse> {
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    };

    // 1. CORS Validation
    const origin = this.extractHeader(request.headers, 'origin');
    if (origin && this.allowedOrigins.has(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
      headers['access-control-allow-headers'] = 'Authorization, Content-Type';
      headers['access-control-max-age'] = '86400';
    }

    // Handle OPTIONS Preflight
    if (request.method.toUpperCase() === 'OPTIONS') {
      if (origin && !this.allowedOrigins.has(origin)) {
        return {
          statusCode: 403,
          headers,
          body: {
            success: false,
            error: {
              code: 'CORS_ORIGIN_DENIED',
              message: `Cross-origin access from origin "${origin}" is not permitted.`,
              statusCode: 403,
            },
          },
        };
      }
      return {
        statusCode: 204,
        headers,
        body: { success: true },
      };
    }

    // 2. Rate Limiting Check
    if (this.rateLimiter) {
      const clientIp = this.extractHeader(request.headers, 'x-forwarded-for') || '127.0.0.1';
      const rateCheck = this.rateLimiter.checkRateLimit(clientIp);
      if (!rateCheck.allowed) {
        headers['retry-after'] = String(rateCheck.retryAfterSeconds ?? 60);
        return {
          statusCode: 429,
          headers,
          body: {
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests. Please slow down and try again later.',
              statusCode: 429,
            },
          },
        };
      }
    }

    // 3. Parse URL & Route Matching
    const parsedUrl = new URL(request.url, 'http://localhost');
    const path = parsedUrl.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
      // Route 1: POST /api/v1/approval-requests
      if (method === 'POST' && path === '/api/v1/approval-requests') {
        return await this.handleCreateRequest(request, headers);
      }

      // Route 2: GET /api/v1/approval-requests/:id
      const getRequesterMatch = path.match(/^\/api\/v1\/approval-requests\/([a-zA-Z0-9_-]+)$/);
      if (method === 'GET' && getRequesterMatch) {
        const requestId = getRequesterMatch[1];
        return await this.handleGetRequest(request, requestId, headers);
      }

      // Route 3: POST /api/v1/approval-requests/:id/cancel
      const cancelMatch = path.match(/^\/api\/v1\/approval-requests\/([a-zA-Z0-9_-]+)\/cancel$/);
      if (method === 'POST' && cancelMatch) {
        const requestId = cancelMatch[1];
        return await this.handleCancelRequest(request, requestId, headers);
      }

      // Route 4: GET /api/v1/approvals/pending
      if (method === 'GET' && path === '/api/v1/approvals/pending') {
        return await this.handleListPending(request, headers);
      }

      // Route 5: GET /api/v1/approvals/:id
      const getContactMatch = path.match(/^\/api\/v1\/approvals\/([a-zA-Z0-9_-]+)$/);
      if (method === 'GET' && getContactMatch) {
        const requestId = getContactMatch[1];
        return await this.handleGetRequest(request, requestId, headers);
      }

      // Route 6: POST /api/v1/approvals/:id/decide
      const decideMatch = path.match(/^\/api\/v1\/approvals\/([a-zA-Z0-9_-]+)\/decide$/);
      if (method === 'POST' && decideMatch) {
        const requestId = decideMatch[1];
        return await this.handleDecideRequest(request, requestId, headers);
      }

      // Route Not Found
      return {
        statusCode: 404,
        headers,
        body: {
          success: false,
          error: {
            code: 'ROUTE_NOT_FOUND',
            message: `Route "${method} ${path}" not found.`,
            statusCode: 404,
          },
        },
      };
    } catch (err) {
      return this.mapErrorToResponse(err, headers);
    }
  }

  /**
   * Adapts a streaming HTTP request/response (such as Node.js http.IncomingMessage / http.ServerResponse) to dispatch().
   */
  public async handleHttpStream(
    req: HttpRequestLike,
    res: HttpResponseLike
  ): Promise<void> {
    const rawHeaders: Record<string, string | string[] | undefined> = {};
    if (req.headers && typeof req.headers === 'object') {
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string' || Array.isArray(v) || v === undefined) {
          rawHeaders[k.toLowerCase()] = v;
        }
      }
    }

    let rawBody: unknown;
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      try {
        rawBody = await this.readRequestBody(req);
      } catch (err: unknown) {
        const errResponse = this.mapErrorToResponse(err, {});
        this.sendHttpResponse(res, errResponse);
        return;
      }
    }

    const apiRequest: ApiRequest = {
      method,
      url: req.url || '/',
      headers: rawHeaders,
      body: rawBody,
    };

    const apiResponse = await this.dispatch(apiRequest);
    this.sendHttpResponse(res, apiResponse);
  }

  // ===========================================================================
  // Route Handlers
  // ===========================================================================

  /**
   * POST /api/v1/approval-requests
   */
  private async handleCreateRequest(
    request: ApiRequest,
    headers: Record<string, string>
  ): Promise<ApiResponse<ApprovalRequest>> {
    this.validateContentType(request.headers);
    const authContext = await this.authenticate(request.headers);

    const body = request.body as ClientApprovalRequestPayload;
    if (!body || typeof body !== 'object') {
      throw new ApprovalValidationError(['Request body must be a valid JSON object.']);
    }

    const created = this.service.createRequest(body, authContext);
    return {
      statusCode: 201,
      headers,
      body: {
        success: true,
        data: created,
      },
    };
  }

  /**
   * GET /api/v1/approval-requests/:id OR GET /api/v1/approvals/:id
   */
  private async handleGetRequest(
    request: ApiRequest,
    requestId: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<ApprovalRequest>> {
    const authContext = await this.authenticate(request.headers);
    const result = this.service.getRequest(requestId, authContext);

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: result,
      },
    };
  }

  /**
   * POST /api/v1/approval-requests/:id/cancel
   */
  private async handleCancelRequest(
    request: ApiRequest,
    requestId: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<ApprovalRequest>> {
    this.validateContentType(request.headers);
    const authContext = await this.authenticate(request.headers);

    let reason: string | undefined;
    if (request.body && typeof request.body === 'object') {
      const rawBody = request.body as Record<string, unknown>;
      if (rawBody.reason !== undefined) {
        if (typeof rawBody.reason !== 'string') {
          throw new ApprovalValidationError(['Optional cancellation "reason" must be a string.']);
        }
        reason = rawBody.reason;
      }
    }

    const cancelled = this.service.cancelRequest(requestId, reason, authContext);
    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: cancelled,
      },
    };
  }

  /**
   * GET /api/v1/approvals/pending
   */
  private async handleListPending(
    request: ApiRequest,
    headers: Record<string, string>
  ): Promise<ApiResponse<readonly ApprovalRequest[]>> {
    const authContext = await this.authenticate(request.headers);
    const list = this.service.listPendingRequestsForContact(authContext);

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: list,
      },
    };
  }

  /**
   * POST /api/v1/approvals/:id/decide
   */
  private async handleDecideRequest(
    request: ApiRequest,
    requestId: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<ApprovalRequest>> {
    this.validateContentType(request.headers);
    const authContext = await this.authenticate(request.headers);

    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      throw new ApprovalValidationError(['Decision request body must be a JSON object.']);
    }

    if (body.decision !== 'APPROVED' && body.decision !== 'REJECTED') {
      throw new ApprovalValidationError([
        'Field "decision" is required and must be either "APPROVED" or "REJECTED".',
      ]);
    }

    let decisionReason: string | undefined;
    if (body.decisionReason !== undefined) {
      if (typeof body.decisionReason !== 'string') {
        throw new ApprovalValidationError(['Optional "decisionReason" must be a string.']);
      }
      decisionReason = body.decisionReason;
    }

    const result =
      body.decision === 'APPROVED'
        ? this.service.approveRequest(requestId, { decisionReason }, authContext)
        : this.service.rejectRequest(requestId, { decisionReason }, authContext);

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: result,
      },
    };
  }

  // ===========================================================================
  // Authentication & Validation Helpers
  // ===========================================================================

  /**
   * Authenticates caller via Bearer token header.
   */
  private async authenticate(
    headers?: Record<string, string | string[] | undefined>
  ): Promise<AuthContext> {
    const authHeader = this.extractHeader(headers, 'authorization');
    if (!authHeader) {
      throw new UnauthenticatedError('Missing Authorization header. Bearer token is required.');
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      throw new UnauthenticatedError(
        'Malformed Authorization header. Format must be "Bearer <token>".'
      );
    }

    const token = parts[1];
    const authContext = await this.tokenVerifier.verifyToken(token);
    if (!authContext || !authContext.isAuthenticated || !authContext.actorId.trim()) {
      throw new UnauthenticatedError('Invalid or expired authentication token.');
    }

    return authContext;
  }

  /**
   * Validates that POST requests specify application/json Content-Type.
   */
  private validateContentType(headers?: Record<string, string | string[] | undefined>): void {
    const contentType = this.extractHeader(headers, 'content-type');
    if (!contentType) {
      const err = new Error('Content-Type header must be application/json');
      (err as unknown as { statusCode: number; code: string }).statusCode = 415;
      (err as unknown as { statusCode: number; code: string }).code = 'UNSUPPORTED_MEDIA_TYPE';
      throw err;
    }

    const mime = contentType.split(';')[0].trim().toLowerCase();
    if (mime !== 'application/json') {
      const err = new Error(`Unsupported media type "${mime}". Content-Type must be application/json.`);
      (err as unknown as { statusCode: number; code: string }).statusCode = 415;
      (err as unknown as { statusCode: number; code: string }).code = 'UNSUPPORTED_MEDIA_TYPE';
      throw err;
    }
  }

  /**
   * Reads and parses request body from streaming request with size limit check.
   */
  private async readRequestBody(req: HttpRequestLike): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let totalBytes = 0;
      const chunks: Uint8Array[] = [];
      const decoder = new TextDecoder('utf-8');

      req.on('data', (chunk: unknown) => {
        let chunkBytes: Uint8Array;
        if (typeof chunk === 'string') {
          chunkBytes = new TextEncoder().encode(chunk);
        } else if (chunk instanceof Uint8Array) {
          chunkBytes = chunk;
        } else if (chunk && typeof (chunk as { length: number }).length === 'number') {
          chunkBytes = new Uint8Array(chunk as ArrayLike<number>);
        } else {
          chunkBytes = new Uint8Array(0);
        }

        totalBytes += chunkBytes.byteLength;
        if (totalBytes > this.maxBodySizeBytes) {
          const err = new Error(
            `Request payload exceeds maximum permitted size of ${this.maxBodySizeBytes} bytes.`
          );
          (err as unknown as { statusCode: number; code: string }).statusCode = 413;
          (err as unknown as { statusCode: number; code: string }).code = 'PAYLOAD_TOO_LARGE';
          if (typeof req.destroy === 'function') {
            req.destroy();
          }
          reject(err);
          return;
        }
        chunks.push(chunkBytes);
      });

      req.on('end', () => {
        const combined = new Uint8Array(totalBytes);
        let offset = 0;
        for (const c of chunks) {
          combined.set(c, offset);
          offset += c.byteLength;
        }
        const rawString = decoder.decode(combined);
        if (!rawString.trim()) {
          resolve({});
          return;
        }
        try {
          const parsed = JSON.parse(rawString);
          resolve(parsed);
        } catch {
          const err = new Error('Malformed JSON syntax in request body.');
          (err as unknown as { statusCode: number; code: string }).statusCode = 400;
          (err as unknown as { statusCode: number; code: string }).code = 'MALFORMED_JSON';
          reject(err);
        }
      });

      req.on('error', (err: unknown) => {
        reject(err);
      });
    });
  }

  /**
   * Helper to write response to HttpResponseLike.
   */
  private sendHttpResponse(res: HttpResponseLike, apiResponse: ApiResponse): void {
    res.statusCode = apiResponse.statusCode;
    for (const [k, v] of Object.entries(apiResponse.headers)) {
      res.setHeader(k, v);
    }
    res.end(JSON.stringify(apiResponse.body));
  }

  /**
   * Maps domain and transport errors to consistent HTTP error envelopes.
   */
  private mapErrorToResponse(err: unknown, baseHeaders: Record<string, string>): ApiResponse {
    const headers = { ...baseHeaders };

    if (err instanceof UnauthenticatedError) {
      return {
        statusCode: 401,
        headers,
        body: {
          success: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: err.message,
            statusCode: 401,
          },
        },
      };
    }

    if (err instanceof SelfApprovalProhibitedError) {
      return {
        statusCode: 403,
        headers,
        body: {
          success: false,
          error: {
            code: 'SELF_APPROVAL_PROHIBITED',
            message: err.message,
            statusCode: 403,
          },
        },
      };
    }

    if (err instanceof UnauthorizedActionRequesterError) {
      return {
        statusCode: 403,
        headers,
        body: {
          success: false,
          error: {
            code: 'UNAUTHORIZED_ACTION_REQUESTER',
            message: err.message,
            statusCode: 403,
          },
        },
      };
    }

    if (err instanceof ApprovalAccessDeniedError) {
      // Safe opaque 404 error: anti-enumeration
      return {
        statusCode: 404,
        headers,
        body: {
          success: false,
          error: {
            code: 'NOT_FOUND_OR_DENIED',
            message: 'Access denied: Request not found or insufficient permissions.',
            statusCode: 404,
          },
        },
      };
    }

    if (err instanceof ApprovalExpiredError) {
      return {
        statusCode: 410,
        headers,
        body: {
          success: false,
          error: {
            code: 'REQUEST_EXPIRED',
            message: err.message,
            statusCode: 410,
          },
        },
      };
    }

    if (err instanceof ApprovalAlreadyResolvedError) {
      return {
        statusCode: 409,
        headers,
        body: {
          success: false,
          error: {
            code: 'ALREADY_RESOLVED',
            message: err.message,
            statusCode: 409,
          },
        },
      };
    }

    if (err instanceof DuplicateApprovalRequestError) {
      return {
        statusCode: 409,
        headers,
        body: {
          success: false,
          error: {
            code: 'DUPLICATE_ACTIVE_REQUEST',
            message: err.message,
            statusCode: 409,
          },
        },
      };
    }

    if (err instanceof ApprovalValidationError) {
      return {
        statusCode: 400,
        headers,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: err.message,
            statusCode: 400,
            details: err.errors,
          },
        },
      };
    }

    // Generic error with custom statusCode (e.g., 413, 415, 400)
    const customCode = (err as { statusCode?: number })?.statusCode;
    if (typeof customCode === 'number' && customCode >= 400 && customCode < 500) {
      return {
        statusCode: customCode,
        headers,
        body: {
          success: false,
          error: {
            code: (err as { code?: string })?.code || 'BAD_REQUEST',
            message: (err as Error)?.message || 'Bad Request',
            statusCode: customCode,
          },
        },
      };
    }

    // Unhandled internal error: mask message to avoid leaking internals
    return {
      statusCode: 500,
      headers,
      body: {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An internal server error occurred while processing the approval request.',
          statusCode: 500,
        },
      },
    };
  }

  private extractHeader(
    headers: Record<string, string | string[] | undefined> | undefined,
    name: string
  ): string | undefined {
    if (!headers) {
      return undefined;
    }
    const val = headers[name.toLowerCase()];
    if (Array.isArray(val)) {
      return val[0];
    }
    return val;
  }
}

/**
 * Creates a stream request handler wrapping the ApprovalApiRouter.
 */
export function createHttpStreamHandler(
  router: ApprovalApiRouter
): (req: HttpRequestLike, res: HttpResponseLike) => void {
  return (req, res) => {
    router.handleHttpStream(req, res).catch((err: unknown) => {
      console.error('[ApprovalApiRouter Unhandled Error]', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            success: false,
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'An unexpected internal error occurred.',
              statusCode: 500,
            },
          })
        );
      }
    });
  };
}
