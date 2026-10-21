/**
 * Guardrail Approval Status Synchronization Client
 *
 * Strongly typed, reusable client for querying and synchronizing the authoritative
 * lifecycle status of an ApprovalRequest from the Guardrail backend.
 *
 * ARCHITECTURAL PRINCIPLES & INVARIANTS:
 * 1. TRANSPORT BOUNDARY SEPARATION:
 *    - Encapsulates network transport, adaptive polling schedules, tab visibility handling,
 *      status code mapping, and schema validation.
 *    - Strictly separated from UI rendering (StagingModal, DashboardShell).
 * 2. REUSE OF EXISTING ARCHITECTURE:
 *    - Reuses ApprovalApiClient configuration, base URL resolution, authenticated request
 *      dispatch, and error code normalization rather than maintaining a parallel transport stack.
 * 3. NO FALSE APPROVAL INVARIANT:
 *    - Neither failed requests, malformed server responses, unknown status strings, nor network
 *      drops are EVER treated as APPROVED. `isApproved` is true strictly when the server confirms
 *      200 OK with valid APPROVED status and verified reviewer decision metadata.
 * 4. DECOUPLED ACTION EXECUTION:
 *    - Retrieving status (even status === "APPROVED") NEVER executes or releases the held action.
 *    - The action remains safely HELD in browser memory until the protected user explicitly confirms.
 * 5. ZERO LEAKAGE OF CREDENTIALS OR SENSITIVE DATA:
 *    - Request headers, bearer tokens, passwords, and secrets are excluded from logs.
 */

declare const chrome: any;

import {
  ApprovalRequest,
  ApprovalStatus,
} from '../types/approval.js';
import {
  ApiClientError,
  ApiClientErrorCodes,
  ApprovalApiClient,
  ApprovalApiClientConfig,
  RequestOptions,
} from './client.js';
import {
  isTerminalApprovalStatus,
  validateApprovalRequestId,
} from './model.js';

// =============================================================================
// Synchronization Configuration & Result Models
// =============================================================================

/**
 * Standard interval progression for adaptive polling (Section 6.2 of specification):
 * - Phase 1 (0s – 6s): Every 2 seconds (quick reviews)
 * - Phase 2 (6s – 30s): Every 3 seconds (active reviews)
 * - Phase 3 (30s – 2m): Every 5 seconds (relaxed load)
 * - Phase 4 (2m – 15m): Every 10 seconds (standby cadence)
 */
export const ADAPTIVE_POLL_INTERVALS = Object.freeze([
  { maxElapsedMs: 6000, intervalMs: 2000 },
  { maxElapsedMs: 30000, intervalMs: 3000 },
  { maxElapsedMs: 120000, intervalMs: 5000 },
  { maxElapsedMs: 900000, intervalMs: 10000 }, // Capped standby up to 15m TTL
] as const);

export const DEFAULT_INITIAL_POLL_INTERVAL_MS = 2000;
export const DEFAULT_MAX_POLL_INTERVAL_MS = 10000;
export const DEFAULT_HIDDEN_TAB_POLL_INTERVAL_MS = 30000;
export const DEFAULT_MAX_SYNC_DURATION_MS = 15 * 60 * 1000; // 15 minutes TTL

/**
 * Strongly typed outcome of an approval status query.
 */
export interface ApprovalStatusResult {
  /** True if the backend successfully returned a validated ApprovalRequest */
  readonly success: boolean;

  /** Canonical approval request identifier ('apr_...') */
  readonly requestId: string;

  /** Authoritative ApprovalStatus enum if retrieval succeeded */
  readonly status?: ApprovalStatus;

  /**
   * Convenience flag: True if request has reached any terminal state:
   * (APPROVED, REJECTED, EXPIRED, CANCELLED). Polling stops when terminal.
   */
  readonly isTerminal: boolean;

  /**
   * CRITICAL INVARIANT: True strictly if status is APPROVED with valid decision metadata.
   * False for PENDING, REJECTED, EXPIRED, CANCELLED, failed requests, or unknown statuses.
   */
  readonly isApproved: boolean;

  /** True if request is actively awaiting caretaker review (PENDING) */
  readonly isPending: boolean;

  /** True if request was denied by a reviewer (REJECTED) */
  readonly isRejected: boolean;

  /** True if request expired without a decision (EXPIRED) */
  readonly isExpired: boolean;

  /** True if request was cancelled by the user (CANCELLED) */
  readonly isCancelled: boolean;

  /** Full authoritative ApprovalRequest domain entity if successful */
  readonly request?: ApprovalRequest;

  /** Normalized client or server error details if unsuccessful */
  readonly error?: ApiClientError;

  /** HTTP response status code if available (e.g. 200, 401, 404, 429, 500) */
  readonly statusCode?: number;

  /** True if failure was caused by a low-level network drop or connection refusal */
  readonly isNetworkError: boolean;

  /** True if request timed out or was aborted */
  readonly isTimeout: boolean;

  /** True if the response is authoritatively confirmed by the backend */
  readonly isAuthoritative: boolean;
}

/**
 * Options supported when synchronizing an approval status over time.
 */
export interface StatusSyncOptions extends RequestOptions {
  /** Initial polling interval in milliseconds (default: 2000) */
  readonly initialIntervalMs?: number;

  /** Maximum polling interval in milliseconds (default: 10000) */
  readonly maxIntervalMs?: number;

  /** If true, uses adaptive interval schedule (2s -> 3s -> 5s -> 10s). Default: true */
  readonly adaptiveSchedule?: boolean;

  /** Maximum overall sync duration before automatically stopping in ms (default: 15m) */
  readonly maxDurationMs?: number;

  /** If true, relaxes polling to 30s when document tab is hidden. Default: true */
  readonly pauseWhenHidden?: boolean;

  /** Polling interval when tab is hidden in milliseconds (default: 30000) */
  readonly hiddenIntervalMs?: number;
}

/**
 * Event callbacks invoked by the status synchronization loop.
 */
export interface StatusSyncListener {
  /** Called on every completed poll with the latest result */
  readonly onPoll?: (result: ApprovalStatusResult) => void;

  /** Called when the request transitions to a new status (e.g. PENDING -> APPROVED) */
  readonly onStatusChange?: (
    newStatus: ApprovalStatus,
    result: ApprovalStatusResult,
    previousStatus?: ApprovalStatus
  ) => void;

  /** Called when the request reaches a terminal state (APPROVED, REJECTED, EXPIRED, CANCELLED) */
  readonly onTerminal?: (terminalStatus: ApprovalStatus, result: ApprovalStatusResult) => void;

  /** Called when a network error, timeout, or server rejection occurs */
  readonly onError?: (error: ApiClientError, result: ApprovalStatusResult) => void;
}

/**
 * Active subscription handle returned by startSync().
 */
export interface StatusSyncSubscription {
  /** Unique subscription ID */
  readonly id: string;

  /** Target canonical request ID */
  readonly requestId: string;

  /** Returns true if the synchronization loop is currently running */
  isActive(): boolean;

  /** Stops and cancels the polling loop, releasing all timers and event listeners */
  stop(): void;

  /** Forces an immediate, out-of-band status query */
  pollNow(): Promise<ApprovalStatusResult>;
}

/**
 * Configuration for constructing an ApprovalStatusSyncClient.
 */
export interface ApprovalStatusSyncClientConfig extends ApprovalApiClientConfig {
  /** Reused ApprovalApiClient instance (if omitted, instantiated from config) */
  readonly apiClient?: ApprovalApiClient;

  /** Default polling interval in milliseconds */
  readonly defaultIntervalMs?: number;

  /** Default maximum sync duration in milliseconds */
  readonly defaultMaxDurationMs?: number;
}

// =============================================================================
// Helper Functions: Status Classification
// =============================================================================

/**
 * Checks whether an unknown status value is specifically APPROVED.
 */
export function isApprovedApprovalStatus(status: unknown): boolean {
  return status === ApprovalStatus.APPROVED;
}

/**
 * Checks whether an unknown status value is specifically PENDING.
 */
export function isPendingApprovalStatus(status: unknown): boolean {
  return status === ApprovalStatus.PENDING;
}

// =============================================================================
// Reusable Approval Status Synchronization Client Implementation
// =============================================================================

/**
 * Reusable, typed client for retrieving and synchronizing approval request status.
 *
 * Provides both single-shot status retrieval (`getStatus`) and automated adaptive
 * synchronization (`startSync`) with visibility change detection, terminal state
 * cutoff, and strict validation.
 */
export class ApprovalStatusSyncClient {
  private readonly apiClient: ApprovalApiClient;
  private readonly defaultIntervalMs: number;
  private readonly defaultMaxDurationMs: number;
  private readonly activeSubscriptions = new Map<string, InternalSyncSubscription>();
  private subscriptionCounter = 0;

  constructor(config?: ApprovalStatusSyncClientConfig) {
    if (config?.apiClient) {
      this.apiClient = config.apiClient;
    } else {
      this.apiClient = new ApprovalApiClient(config);
    }
    this.defaultIntervalMs = config?.defaultIntervalMs ?? DEFAULT_INITIAL_POLL_INTERVAL_MS;
    this.defaultMaxDurationMs = config?.defaultMaxDurationMs ?? DEFAULT_MAX_SYNC_DURATION_MS;
  }

  /**
   * Returns the underlying ApprovalApiClient.
   */
  public getApiClient(): ApprovalApiClient {
    return this.apiClient;
  }

  /**
   * Returns configured default poll interval in milliseconds.
   */
  public getDefaultIntervalMs(): number {
    return this.defaultIntervalMs;
  }

  /**
   * Returns configured default max sync duration in milliseconds.
   */
  public getDefaultMaxDurationMs(): number {
    return this.defaultMaxDurationMs;
  }

  /**
   * Performs a single-shot, strongly typed query for an approval request's status.
   *
   * ARCHITECTURAL GUARANTEES:
   * 1. Validates canonical requestId before network dispatch.
   * 2. Authoritatively validates response schema against ApprovalRequest contract.
   * 3. NEVER treats unknown statuses or failed requests as APPROVED.
   * 4. Does NOT execute or release any held browser action.
   *
   * @param requestId Canonical approval request identifier ('apr_...')
   * @param options Optional request overrides (token, timeout, signal)
   * @returns Strongly typed ApprovalStatusResult
   */
  public async getStatus(
    requestId: string,
    options?: RequestOptions
  ): Promise<ApprovalStatusResult> {
    const rawId = typeof requestId === 'string' ? requestId.trim() : '';

    // 1. Client-side ID pre-validation
    const idValidation = validateApprovalRequestId(rawId);
    if (!idValidation.valid) {
      return this.buildFailureResult(
        rawId,
        {
          code: ApiClientErrorCodes.VALIDATION_ERROR,
          message: idValidation.errors[0] || 'Invalid requestId format.',
          statusCode: 400,
          details: idValidation.errors,
        },
        400,
        /* isNetworkError */ false,
        /* isTimeout */ false,
        /* isAuthoritative */ true
      );
    }

    // 2. Dispatch query through underlying client
    const clientResult = await this.apiClient.getApprovalStatus(rawId, options);

    if (clientResult.success) {
      const data = clientResult.data;
      const request = data.request;

      // 3. Double-check authoritative request presence and requestId matching (Requirements 1 & 2)
      if (!request) {
        return this.buildFailureResult(
          rawId,
          {
            code: ApiClientErrorCodes.MALFORMED_JSON_RESPONSE,
            message: 'Server response did not include a valid request object.',
            statusCode: clientResult.statusCode,
          },
          clientResult.statusCode,
          /* isNetworkError */ false,
          /* isTimeout */ false,
          /* isAuthoritative */ true
        );
      }

      if (request.id !== rawId) {
        return this.buildFailureResult(
          rawId,
          {
            code: ApiClientErrorCodes.MALFORMED_JSON_RESPONSE,
            message: `Mismatched approval request identifier: expected "${rawId}", received "${request.id}".`,
            statusCode: clientResult.statusCode,
          },
          clientResult.statusCode,
          /* isNetworkError */ false,
          /* isTimeout */ false,
          /* isAuthoritative */ true
        );
      }

      if (!Object.values(ApprovalStatus).includes(data.status)) {
        return this.buildFailureResult(
          rawId,
          {
            code: ApiClientErrorCodes.MALFORMED_JSON_RESPONSE,
            message: `Server returned unknown approval status: "${String(data.status)}".`,
            statusCode: clientResult.statusCode,
          },
          clientResult.statusCode,
          /* isNetworkError */ false,
          /* isTimeout */ false,
          /* isAuthoritative */ true
        );
      }

      // 4. Decision metadata consistency enforcement (Requirement 5)
      // APPROVED and REJECTED must have valid decision metadata with decidedBy and decidedAt.
      // PENDING must never have decision metadata.
      if (data.status === ApprovalStatus.APPROVED || data.status === ApprovalStatus.REJECTED) {
        if (!request.decision || typeof request.decision !== 'object') {
          return this.buildFailureResult(
            rawId,
            {
              code: ApiClientErrorCodes.MALFORMED_JSON_RESPONSE,
              message: `Approval request in ${data.status} status is missing required decision metadata.`,
              statusCode: clientResult.statusCode,
            },
            clientResult.statusCode,
            /* isNetworkError */ false,
            /* isTimeout */ false,
            /* isAuthoritative */ true
          );
        }
        if (!request.decision.decidedBy || !request.decision.decidedAt) {
          return this.buildFailureResult(
            rawId,
            {
              code: ApiClientErrorCodes.MALFORMED_JSON_RESPONSE,
              message: `Decision metadata for ${data.status} request is incomplete (missing decidedBy or decidedAt).`,
              statusCode: clientResult.statusCode,
            },
            clientResult.statusCode,
            /* isNetworkError */ false,
            /* isTimeout */ false,
            /* isAuthoritative */ true
          );
        }
      } else if (data.status === ApprovalStatus.PENDING) {
        if (request.decision !== undefined && request.decision !== null) {
          return this.buildFailureResult(
            rawId,
            {
              code: ApiClientErrorCodes.MALFORMED_JSON_RESPONSE,
              message: 'Inconsistent response: request in PENDING status contains premature decision metadata.',
              statusCode: clientResult.statusCode,
            },
            clientResult.statusCode,
            /* isNetworkError */ false,
            /* isTimeout */ false,
            /* isAuthoritative */ true
          );
        }
      }

      const status = data.status;
      const isApproved = status === ApprovalStatus.APPROVED && Boolean(request.decision?.decidedBy);
      const isPending = status === ApprovalStatus.PENDING;
      const isRejected = status === ApprovalStatus.REJECTED;
      const isExpired = status === ApprovalStatus.EXPIRED;
      const isCancelled = status === ApprovalStatus.CANCELLED;
      const isTerminal = isApproved || isRejected || isExpired || isCancelled;

      return {
        success: true,
        requestId: rawId,
        status,
        isTerminal,
        isApproved,
        isPending,
        isRejected,
        isExpired,
        isCancelled,
        request,
        statusCode: clientResult.statusCode,
        isNetworkError: false,
        isTimeout: false,
        isAuthoritative: true,
      };
    } else {
      // 4. Handle non-success responses (401, 404, network failure, timeout, 500)
      const isNetworkError = Boolean(clientResult.isNetworkError);
      const isTimeout = Boolean(clientResult.isTimeout);
      const statusCode = clientResult.statusCode;
      const isAuthoritative =
        statusCode !== undefined && statusCode >= 400 && statusCode < 500 && !isTimeout;

      return this.buildFailureResult(
        rawId,
        clientResult.error,
        statusCode,
        isNetworkError,
        isTimeout,
        isAuthoritative
      );
    }
  }

  /**
   * Starts an automated status synchronization loop for a pending approval request.
   *
   * FEATURES:
   * - Adaptive backoff schedule (2s -> 3s -> 5s -> 10s).
   * - Terminal state cutoff: automatically stops polling when reaching APPROVED, REJECTED, EXPIRED, CANCELLED.
   * - Tab visibility awareness: reduces frequency when tab is hidden, immediate probe when visible.
   * - Safe concurrency: ensures overlapping poll requests never run concurrently.
   * - Clean resource disposal: provides stop() to cancel active timers and unregister listeners.
   *
   * CRITICAL SAFETY INVARIANT:
   * Reaching APPROVED stops synchronization and notifies listeners, but NEVER executes or
   * releases the held browser action.
   *
   * @param requestId Canonical approval request identifier ('apr_...')
   * @param listener Event callbacks for poll, status change, terminal state, or error
   * @param options Optional sync and polling schedule configuration
   * @returns Active StatusSyncSubscription
   */
  public startSync(
    requestId: string,
    listener: StatusSyncListener,
    options?: StatusSyncOptions
  ): StatusSyncSubscription {
    const rawId = typeof requestId === 'string' ? requestId.trim() : '';
    const subscriptionId = `sync_${++this.subscriptionCounter}_${Date.now()}`;

    const subscription = new InternalSyncSubscription(
      subscriptionId,
      rawId,
      this,
      listener,
      options,
      () => {
        this.activeSubscriptions.delete(subscriptionId);
      }
    );

    this.activeSubscriptions.set(subscriptionId, subscription);
    subscription.start();

    return subscription;
  }

  /**
   * Stops all active synchronization loops (useful for teardown or test cleanup).
   */
  public stopAll(): void {
    for (const sub of this.activeSubscriptions.values()) {
      sub.stop();
    }
    this.activeSubscriptions.clear();
  }

  /**
   * Helper constructing an immutable failure result conforming strictly to ApprovalStatusResult.
   */
  private buildFailureResult(
    requestId: string,
    error: ApiClientError,
    statusCode: number | undefined,
    isNetworkError: boolean,
    isTimeout: boolean,
    isAuthoritative: boolean
  ): ApprovalStatusResult {
    return {
      success: false,
      requestId,
      status: undefined,
      isTerminal: false,
      isApproved: false, // Invariant: failed requests are NEVER approved
      isPending: false,
      isRejected: false,
      isExpired: false,
      isCancelled: false,
      request: undefined,
      error,
      statusCode,
      isNetworkError,
      isTimeout,
      isAuthoritative,
    };
  }
}

// =============================================================================
// Internal Synchronization Subscription Coordinator
// =============================================================================

class InternalSyncSubscription implements StatusSyncSubscription {
  public readonly id: string;
  public readonly requestId: string;

  private readonly client: ApprovalStatusSyncClient;
  private readonly listener: StatusSyncListener;
  private readonly options?: StatusSyncOptions;
  private readonly onDispose: () => void;

  private active: boolean = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private pollInProgress: boolean = false;
  private lastKnownStatus?: ApprovalStatus;
  private startTimeMs: number = 0;
  private visibilityHandler: (() => void) | null = null;

  constructor(
    id: string,
    requestId: string,
    client: ApprovalStatusSyncClient,
    listener: StatusSyncListener,
    options: StatusSyncOptions | undefined,
    onDispose: () => void
  ) {
    this.id = id;
    this.requestId = requestId;
    this.client = client;
    this.listener = listener;
    this.options = options;
    this.onDispose = onDispose;
  }

  public isActive(): boolean {
    return this.active;
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.startTimeMs = Date.now();

    // Hook tab visibility listener if available in browser DOM environment
    if (
      this.options?.pauseWhenHidden !== false &&
      typeof document !== 'undefined' &&
      typeof document.addEventListener === 'function'
    ) {
      this.visibilityHandler = () => {
        if (!this.active) return;
        if (document.visibilityState === 'visible') {
          // Tab became visible: probe immediately to catch decisions made while user was away
          this.pollNow().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    // Trigger initial poll immediately
    this.scheduleNextPoll(0);
  }

  public stop(): void {
    if (!this.active) return;
    this.active = false;

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.visibilityHandler && typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }

    this.onDispose();
  }

  public async pollNow(): Promise<ApprovalStatusResult> {
    if (!this.active) {
      return this.client.getStatus(this.requestId, this.options);
    }

    // Guard against concurrent overlapping poll executions
    if (this.pollInProgress) {
      return {
        success: false,
        requestId: this.requestId,
        status: this.lastKnownStatus,
        isTerminal: Boolean(this.lastKnownStatus && isTerminalApprovalStatus(this.lastKnownStatus)),
        isApproved: Boolean(this.lastKnownStatus && isApprovedApprovalStatus(this.lastKnownStatus)),
        isPending: Boolean(this.lastKnownStatus && isPendingApprovalStatus(this.lastKnownStatus)),
        isRejected: this.lastKnownStatus === ApprovalStatus.REJECTED,
        isExpired: this.lastKnownStatus === ApprovalStatus.EXPIRED,
        isCancelled: this.lastKnownStatus === ApprovalStatus.CANCELLED,
        isNetworkError: false,
        isTimeout: false,
        isAuthoritative: false,
        error: {
          code: 'POLL_IN_PROGRESS',
          message: 'A status poll is already actively in progress for this request.',
        },
      };
    }

    this.pollInProgress = true;
    try {
      const result = await this.client.getStatus(this.requestId, this.options);

      if (!this.active) {
        return result;
      }

      // Notify onPoll
      try {
        this.listener.onPoll?.(result);
      } catch (pollErr) {
        // Listener exception must not break sync coordinator
      }

      if (result.success && result.status) {
        // Detect status transition
        if (result.status !== this.lastKnownStatus) {
          const previousStatus = this.lastKnownStatus;
          this.lastKnownStatus = result.status;

          try {
            this.listener.onStatusChange?.(result.status, result, previousStatus);
          } catch {
            // Listener exception handled safely
          }
        }

        // Terminal state cutoff: automatically terminate polling
        if (result.isTerminal) {
          try {
            this.listener.onTerminal?.(result.status, result);
          } catch {
            // Listener exception handled safely
          }
          this.stop();
          return result;
        }
      } else if (!result.success && result.error) {
        // Notify onError
        try {
          this.listener.onError?.(result.error, result);
        } catch {
          // Listener exception handled safely
        }
      }

      // Check overall duration deadline
      const maxDurationMs = this.options?.maxDurationMs ?? this.client.getDefaultMaxDurationMs();
      if (Date.now() - this.startTimeMs >= maxDurationMs) {
        this.stop();
        return result;
      }

      // Schedule next poll interval
      if (this.active) {
        const nextDelayMs = this.calculateNextInterval();
        this.scheduleNextPoll(nextDelayMs);
      }

      return result;
    } finally {
      this.pollInProgress = false;
    }
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.active) return;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    this.timerId = setTimeout(() => {
      this.timerId = null;
      if (this.active) {
        this.pollNow().catch(() => {});
      }
    }, delayMs);
  }

  /**
   * Calculates next interval based on elapsed duration and tab visibility state.
   */
  private calculateNextInterval(): number {
    // If tab is hidden in browser DOM, use relaxed hidden interval
    if (
      this.options?.pauseWhenHidden !== false &&
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      return this.options?.hiddenIntervalMs ?? DEFAULT_HIDDEN_TAB_POLL_INTERVAL_MS;
    }

    // Adaptive backoff schedule (2s -> 3s -> 5s -> 10s)
    if (this.options?.adaptiveSchedule !== false) {
      const elapsedMs = Date.now() - this.startTimeMs;
      for (const tier of ADAPTIVE_POLL_INTERVALS) {
        if (elapsedMs <= tier.maxElapsedMs) {
          return tier.intervalMs;
        }
      }
      return DEFAULT_MAX_POLL_INTERVAL_MS;
    }

    // Fixed interval
    return this.options?.initialIntervalMs ?? this.client.getDefaultIntervalMs();
  }
}
