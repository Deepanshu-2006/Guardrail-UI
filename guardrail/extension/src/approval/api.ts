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
  ApprovalActionBinding,
  ApprovalRequest,
  ApprovalStatus,
  BackendContinuationValidationResult,
  ClientApprovalRequestPayload,
} from '../types/approval.js';
import {
  ApprovalAlreadyResolvedError,
  ApprovalExpiredError,
  ApprovalValidationError,
  DuplicateApprovalRequestError,
  validateActionId,
  validateApprovalRequestId,
} from './model.js';
import {
  ApprovalBindingConflictError,
  ApprovalBindingNotFoundError,
  ApprovalBindingReassignmentError,
  ApprovalBindingStateTransitionError,
  ApprovalBindingValidationError,
} from './binding.js';
import {
  ActorRole,
  ApprovalAccessDeniedError,
  AuthContext,
  CreateInvitationOptions,
  DuplicateContactRelationshipError,
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRevokedError,
  NoActiveTrustedContactError,
  SelfApprovalProhibitedError,
  SelfInvitationProhibitedError,
  TrustedContact,
  TrustedContactInvitation,
  UnauthenticatedError,
  UnauthorizedActionRequesterError,
  validateInvitationCode,
  validateRelationshipLabel,
} from './authorization.js';
import { ApprovalService } from './service.js';

// =============================================================================
// API Configuration & Interfaces
// =============================================================================

export const GUARDRAIL_SERVICE_TYPE_HEADER = 'x-guardrail-service-type';
export const GUARDRAIL_EPHEMERAL_MOCK_SERVICE_TYPE = 'ephemeral_in_memory_mock';

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
  /** Identifies the mounted service accurately to existing clients. */
  readonly serviceType?: 'live' | 'mock' | 'in_memory';
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
  private readonly serviceType: 'live' | 'mock' | 'in_memory';

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
    this.serviceType = config?.serviceType ?? 'in_memory';
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
      'x-guardrail-service-type': this.serviceType === 'in_memory'
        ? GUARDRAIL_EPHEMERAL_MOCK_SERVICE_TYPE
        : this.serviceType,
    };

    // 1. CORS Validation
    const origin = this.extractHeader(request.headers, 'origin');
    if (origin && this.allowedOrigins.has(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
      headers['access-control-allow-headers'] = 'Authorization, Content-Type, ' + GUARDRAIL_SERVICE_TYPE_HEADER;
      headers['access-control-expose-headers'] = GUARDRAIL_SERVICE_TYPE_HEADER + ', Retry-After';
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

      // Route 2: GET /api/v1/approval-requests/:id/binding
      const getBindingMatch = path.match(/^\/api\/v1\/approval-requests\/([^/]+)\/binding$/);
      if (method === 'GET' && getBindingMatch) {
        const requestId = decodeURIComponent(getBindingMatch[1]);
        return await this.handleGetRequestBinding(request, requestId, headers);
      }

      // Route 2b: POST /api/v1/approval-requests/:id/invalidate
      const invalidateRequestMatch = path.match(/^\/api\/v1\/approval-requests\/([^/]+)\/invalidate$/);
      if (method === 'POST' && invalidateRequestMatch) {
        const requestId = decodeURIComponent(invalidateRequestMatch[1]);
        return await this.handleInvalidateRequestBinding(request, requestId, headers);
      }

      // Route 3: POST /api/v1/approval-requests/:id/cancel
      const cancelMatch = path.match(/^\/api\/v1\/approval-requests\/([^/]+)\/cancel$/);
      if (method === 'POST' && cancelMatch) {
        const requestId = decodeURIComponent(cancelMatch[1]);
        return await this.handleCancelRequest(request, requestId, headers);
      }

      // Route 4: GET /api/v1/approval-requests/:id
      const getRequesterMatch = path.match(/^\/api\/v1\/approval-requests\/([^/]+)$/);
      if (method === 'GET' && getRequesterMatch) {
        const requestId = decodeURIComponent(getRequesterMatch[1]);
        return await this.handleGetRequest(request, requestId, headers);
      }

      // Route 5: GET /api/v1/actions/:actionId/binding
      const getActionBindingMatch = path.match(/^\/api\/v1\/actions\/([^/]+)\/binding$/);
      if (method === 'GET' && getActionBindingMatch) {
        const actionId = decodeURIComponent(getActionBindingMatch[1]);
        return await this.handleGetActionBinding(request, actionId, headers);
      }

      // Route 5b: POST /api/v1/actions/:actionId/invalidate
      const invalidateActionMatch = path.match(/^\/api\/v1\/actions\/([^/]+)\/invalidate$/);
      if (method === 'POST' && invalidateActionMatch) {
        const actionId = decodeURIComponent(invalidateActionMatch[1]);
        return await this.handleInvalidateActionBinding(request, actionId, headers);
      }

      // Route 5c: POST /api/v1/actions/:actionId/validate-continuation
      const validateContinuationMatch = path.match(/^\/api\/v1\/actions\/([^/]+)\/validate-continuation$/);
      if (method === 'POST' && validateContinuationMatch) {
        const actionId = decodeURIComponent(validateContinuationMatch[1]);
        return await this.handleValidateContinuation(request, actionId, headers);
      }

      // Route 6: GET /api/v1/approvals/pending
      if (method === 'GET' && path === '/api/v1/approvals/pending') {
        return await this.handleListPending(request, headers);
      }

      // Route 7: POST /api/v1/approvals/:id/decide
      const decideMatch = path.match(/^\/api\/v1\/approvals\/([^/]+)\/decide$/);
      if (method === 'POST' && decideMatch) {
        const requestId = decodeURIComponent(decideMatch[1]);
        return await this.handleDecideRequest(request, requestId, headers);
      }

      // Route 8: GET /api/v1/approvals/:id
      const getContactMatch = path.match(/^\/api\/v1\/approvals\/([^/]+)$/);
      if (method === 'GET' && getContactMatch && path !== '/api/v1/approvals/pending') {
        const requestId = decodeURIComponent(getContactMatch[1]);
        return await this.handleGetRequest(request, requestId, headers);
      }

      // Route 9: POST /api/v1/invitations (Ward creates invitation)
      if (method === 'POST' && path === '/api/v1/invitations') {
        return await this.handleCreateInvitation(request, headers);
      }

      // Route 10: GET /api/v1/invitations (Ward lists invitations)
      if (method === 'GET' && path === '/api/v1/invitations') {
        return await this.handleListInvitations(request, headers);
      }

      // Route 11: POST /api/v1/invitations/:code/accept (Contact accepts invitation)
      const acceptInviteMatch = path.match(/^\/api\/v1\/invitations\/([^/]+)\/accept$/);
      if (method === 'POST' && acceptInviteMatch) {
        const code = decodeURIComponent(acceptInviteMatch[1]);
        return await this.handleAcceptInvitation(request, code, headers);
      }

      // Route 12: POST /api/v1/invitations/:id/revoke (Ward revokes invitation)
      const revokeInviteMatch = path.match(/^\/api\/v1\/invitations\/([^/]+)\/revoke$/);
      if (method === 'POST' && revokeInviteMatch) {
        const id = decodeURIComponent(revokeInviteMatch[1]);
        return await this.handleRevokeInvitation(request, id, headers);
      }

      // Route 13: GET /api/v1/invitations/:id (Inspect invitation by code or ID)
      const getInviteMatch = path.match(/^\/api\/v1\/invitations\/([^/]+)$/);
      if (method === 'GET' && getInviteMatch) {
        const identifier = decodeURIComponent(getInviteMatch[1]);
        return await this.handleGetInvitation(request, identifier, headers);
      }

      // Route 14: GET /api/v1/trusted-contacts (Ward lists active contacts)
      if (method === 'GET' && path === '/api/v1/trusted-contacts') {
        return await this.handleListTrustedContacts(request, headers);
      }

      // Route 15: POST /api/v1/trusted-contacts/:id/revoke (Ward revokes active contact)
      const revokeContactMatch = path.match(/^\/api\/v1\/trusted-contacts\/([^/]+)\/revoke$/);
      if (method === 'POST' && revokeContactMatch) {
        const contactId = decodeURIComponent(revokeContactMatch[1]);
        return await this.handleRevokeTrustedContact(request, contactId, headers);
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

    const raw = body as unknown as Record<string, unknown>;
    if (raw.bindingId !== undefined) {
      throw new ApprovalValidationError([
        'Client payload cannot specify "bindingId". Binding identifiers are assigned authoritatively by the server.',
      ]);
    }

    const actionIdValidation = validateActionId(body.actionId);
    if (!actionIdValidation.valid) {
      throw new ApprovalValidationError(actionIdValidation.errors);
    }

    const existing = body.actionId
      ? this.service.getRepository().findByUserAndAction(authContext.actorId, body.actionId)
      : undefined;
    const isIdempotentReturn = Boolean(
      existing && existing.status === ApprovalStatus.PENDING
    );

    const created = this.service.createRequest(body, authContext);
    return {
      statusCode: isIdempotentReturn ? 200 : 201,
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
    // 1. Safe identifier validation (Requirement 7)
    const idValidation = validateApprovalRequestId(requestId);
    if (!idValidation.valid) {
      throw new ApprovalValidationError(idValidation.errors);
    }

    // 2. Authentication check
    const authContext = await this.authenticate(request.headers);

    // 3. Authoritative retrieval with multi-tenant authorization & lazy expiration
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
    let idempotent: boolean | undefined;
    if (request.body && typeof request.body === 'object') {
      const rawBody = request.body as Record<string, unknown>;
      if (rawBody.reason !== undefined) {
        if (typeof rawBody.reason !== 'string') {
          throw new ApprovalValidationError(['Optional cancellation "reason" must be a string.']);
        }
        reason = rawBody.reason;
      }
      if (typeof rawBody.idempotent === 'boolean') {
        idempotent = rawBody.idempotent;
      }
    }

    if (request.url && request.url.includes('idempotent=true')) {
      idempotent = true;
    }

    const cancelled = this.service.cancelRequest(requestId, reason, authContext, { idempotent });
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

  /**
   * GET /api/v1/approval-requests/:id/binding
   */
  private async handleGetRequestBinding(
    request: ApiRequest,
    requestId: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<ApprovalActionBinding>> {
    const authContext = await this.authenticate(request.headers);
    const binding = this.service.getBindingByRequestId(requestId, authContext);

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: binding,
      },
    };
  }

  /**
   * GET /api/v1/actions/:actionId/binding
   */
  private async handleGetActionBinding(
    request: ApiRequest,
    actionId: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<ApprovalActionBinding>> {
    const authContext = await this.authenticate(request.headers);
    const binding = this.service.getBindingByActionId(actionId, authContext);
    if (!binding) {
      throw new ApprovalAccessDeniedError();
    }

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: binding,
      },
    };
  }

  /**
   * POST /api/v1/actions/:actionId/invalidate
   */
  private async handleInvalidateActionBinding(
    request: ApiRequest,
    actionId: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<ApprovalActionBinding>> {
    const authContext = await this.authenticate(request.headers);
    const body = (request.body as { reason?: string } | undefined) ?? {};
    const reason =
      typeof body.reason === 'string'
        ? body.reason
        : 'Action binding invalidated by client';

    const binding = this.service.invalidateBinding(actionId, reason, authContext);

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: binding,
      },
    };
  }

  /**
   * POST /api/v1/actions/:actionId/validate-continuation
   */
  private async handleValidateContinuation(
    request: ApiRequest,
    actionId: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<BackendContinuationValidationResult>> {
    const authContext = await this.authenticate(request.headers);
    const body = (request.body as {
      requestId?: string;
      pageContext?: { url?: string; origin?: string };
    } | undefined) ?? {};

    const result = this.service.validateContinuationAuthorization(
      {
        actionId,
        requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
        pageContext: body.pageContext && typeof body.pageContext === 'object' ? body.pageContext : undefined,
      },
      authContext
    );

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
   * POST /api/v1/approval-requests/:id/invalidate
   */
  private async handleInvalidateRequestBinding(
    request: ApiRequest,
    requestId: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<ApprovalActionBinding>> {
    const authContext = await this.authenticate(request.headers);
    const body = (request.body as { reason?: string } | undefined) ?? {};
    const reason =
      typeof body.reason === 'string'
        ? body.reason
        : 'Action binding invalidated by client';

    const binding = this.service.invalidateBindingByRequestId(requestId, reason, authContext);

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: binding,
      },
    };
  }

  /**
   * POST /api/v1/invitations
   */
  private async handleCreateInvitation(
    request: ApiRequest,
    headers: Record<string, string>
  ): Promise<ApiResponse<TrustedContactInvitation>> {
    this.validateContentType(request.headers);
    const authContext = await this.authenticate(request.headers);

    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    let relationshipLabel: string | undefined;
    let customCode: string | undefined;
    let ttlMs: number | undefined;

    if (body.relationshipLabel !== undefined) {
      const labelVal = validateRelationshipLabel(body.relationshipLabel);
      if (!labelVal.valid) {
        throw new ApprovalValidationError(labelVal.errors);
      }
      relationshipLabel = labelVal.normalized;
    }

    if (body.code !== undefined || body.customCode !== undefined) {
      const candidateCode = (body.code ?? body.customCode) as string;
      const codeVal = validateInvitationCode(candidateCode);
      if (!codeVal.valid) {
        throw new ApprovalValidationError(codeVal.errors);
      }
      customCode = codeVal.normalized;
    }

    if (body.ttlMs !== undefined) {
      if (typeof body.ttlMs !== 'number' || body.ttlMs <= 0) {
        throw new ApprovalValidationError(['Field "ttlMs" must be a positive number if provided.']);
      }
      ttlMs = body.ttlMs;
    }

    const invitation = this.service.createInvitation(authContext, {
      relationshipLabel,
      customCode,
      ttlMs,
    });

    return {
      statusCode: 201,
      headers,
      body: {
        success: true,
        data: invitation,
      },
    };
  }

  /**
   * GET /api/v1/invitations
   */
  private async handleListInvitations(
    request: ApiRequest,
    headers: Record<string, string>
  ): Promise<ApiResponse<readonly TrustedContactInvitation[]>> {
    const authContext = await this.authenticate(request.headers);
    const invitations = this.service.listInvitationsForUser(authContext);

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: invitations,
      },
    };
  }

  /**
   * GET /api/v1/invitations/:identifier
   */
  private async handleGetInvitation(
    request: ApiRequest,
    identifier: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<TrustedContactInvitation>> {
    const authContext = await this.authenticate(request.headers);
    const invitation = this.service.getInvitation(identifier, authContext);

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: invitation,
      },
    };
  }

  /**
   * POST /api/v1/invitations/:code/accept
   */
  private async handleAcceptInvitation(
    request: ApiRequest,
    code: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<{ invitation: TrustedContactInvitation; contact: TrustedContact }>> {
    const authContext = await this.authenticate(request.headers);
    const result = this.service.acceptInvitation(code, authContext);

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
   * POST /api/v1/invitations/:id/revoke
   */
  private async handleRevokeInvitation(
    request: ApiRequest,
    invitationId: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<TrustedContactInvitation>> {
    const authContext = await this.authenticate(request.headers);
    const revoked = this.service.revokeInvitation(invitationId, authContext);

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: revoked,
      },
    };
  }

  /**
   * GET /api/v1/trusted-contacts
   */
  private async handleListTrustedContacts(
    request: ApiRequest,
    headers: Record<string, string>
  ): Promise<ApiResponse<readonly TrustedContact[]>> {
    const authContext = await this.authenticate(request.headers);
    const contacts = this.service.getTrustedContactsForUser(authContext);

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: contacts,
      },
    };
  }

  /**
   * POST /api/v1/trusted-contacts/:id/revoke
   */
  private async handleRevokeTrustedContact(
    request: ApiRequest,
    contactId: string,
    headers: Record<string, string>
  ): Promise<ApiResponse<{ revoked: boolean; contactId: string }>> {
    const authContext = await this.authenticate(request.headers);
    const revoked = this.service.revokeTrustedContact(contactId, authContext);

    if (!revoked) {
      throw new ApprovalAccessDeniedError();
    }

    return {
      statusCode: 200,
      headers,
      body: {
        success: true,
        data: { revoked: true, contactId },
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
    const authContext: unknown = await this.tokenVerifier.verifyToken(token);
    if (!this.isValidAuthContext(authContext)) {
      throw new UnauthenticatedError('Invalid or expired authentication token.');
    }

    return authContext;
  }

  /** Accepts only a complete identity produced by the configured server verifier. */
  private isValidAuthContext(value: unknown): value is AuthContext {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const context = value as Record<string, unknown>;
    return typeof context.actorId === 'string' &&
      context.actorId.trim().length > 0 &&
      context.isAuthenticated === true &&
      typeof context.role === 'string' &&
      Object.values(ActorRole).includes(context.role as ActorRole) &&
      (context.sessionId === undefined ||
        (typeof context.sessionId === 'string' && context.sessionId.trim().length > 0));
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

    if (err instanceof ApprovalBindingReassignmentError) {
      return {
        statusCode: 409,
        headers,
        body: {
          success: false,
          error: {
            code: 'BINDING_REASSIGNMENT_PROHIBITED',
            message: err.message,
            statusCode: 409,
          },
        },
      };
    }

    if (err instanceof ApprovalBindingConflictError) {
      return {
        statusCode: 409,
        headers,
        body: {
          success: false,
          error: {
            code: 'BINDING_CONFLICT',
            message: err.message,
            statusCode: 409,
          },
        },
      };
    }

    if (err instanceof ApprovalBindingStateTransitionError) {
      return {
        statusCode: 409,
        headers,
        body: {
          success: false,
          error: {
            code: 'INVALID_BINDING_TRANSITION',
            message: err.message,
            statusCode: 409,
          },
        },
      };
    }

    if (err instanceof ApprovalBindingNotFoundError) {
      return {
        statusCode: 404,
        headers,
        body: {
          success: false,
          error: {
            code: 'NOT_FOUND_OR_DENIED',
            message: err.message,
            statusCode: 404,
          },
        },
      };
    }

    if (err instanceof ApprovalBindingValidationError) {
      return {
        statusCode: 400,
        headers,
        body: {
          success: false,
          error: {
            code: 'BINDING_VALIDATION_ERROR',
            message: err.message,
            statusCode: 400,
            details: err.errors,
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

    if (err instanceof NoActiveTrustedContactError) {
      return {
        statusCode: 422,
        headers,
        body: {
          success: false,
          error: {
            code: 'NO_ACTIVE_TRUSTED_CONTACT',
            message: err.message,
            statusCode: 422,
          },
        },
      };
    }

    if (err instanceof InvitationNotFoundError) {
      return {
        statusCode: 404,
        headers,
        body: {
          success: false,
          error: {
            code: 'INVITATION_NOT_FOUND',
            message: err.message,
            statusCode: 404,
          },
        },
      };
    }

    if (err instanceof InvitationExpiredError) {
      return {
        statusCode: 410,
        headers,
        body: {
          success: false,
          error: {
            code: 'INVITATION_EXPIRED',
            message: err.message,
            statusCode: 410,
          },
        },
      };
    }

    if (err instanceof InvitationRevokedError) {
      return {
        statusCode: 410,
        headers,
        body: {
          success: false,
          error: {
            code: 'INVITATION_REVOKED',
            message: err.message,
            statusCode: 410,
          },
        },
      };
    }

    if (err instanceof InvitationAlreadyAcceptedError) {
      return {
        statusCode: 409,
        headers,
        body: {
          success: false,
          error: {
            code: 'INVITATION_ALREADY_ACCEPTED',
            message: err.message,
            statusCode: 409,
          },
        },
      };
    }

    if (err instanceof SelfInvitationProhibitedError) {
      return {
        statusCode: 403,
        headers,
        body: {
          success: false,
          error: {
            code: 'SELF_INVITATION_PROHIBITED',
            message: err.message,
            statusCode: 403,
          },
        },
      };
    }

    if (err instanceof DuplicateContactRelationshipError) {
      return {
        statusCode: 409,
        headers,
        body: {
          success: false,
          error: {
            code: 'DUPLICATE_CONTACT_RELATIONSHIP',
            message: err.message,
            statusCode: 409,
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
      console.error(`[ApprovalApiRouter] Unhandled request failure (${err instanceof Error ? 'Error' : 'UnknownError'}).`);
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
