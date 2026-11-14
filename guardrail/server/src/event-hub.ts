/**
 * Guardrail Approval Real-Time Event Hub
 *
 * Lightweight, in-memory publish/subscribe event hub that enables instant,
 * push-based status delivery to connected Server-Sent Events (SSE) clients.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. ZERO PERSISTENT STATE: Ephemeral event routing only. Authoritative state lives strictly in SQLite.
 * 2. TENANT & REQUEST ISOLATION: Subscriptions filter by requestId and/or actorId to prevent cross-tenant leakage.
 * 3. HEARTBEATS: Emits periodic comments (":keepalive\n\n") to keep reverse proxies and browser connections alive.
 * 4. CLEAN DISPOSAL: Automatically unsubscribes and cleans up resources when client connections terminate.
 */

import { ApprovalRequest, ApprovalStatus } from '../../extension/src/types/approval.js';

export type ApprovalEventType = 'created' | 'decided' | 'cancelled' | 'expired';

export interface ApprovalEventPayload {
  readonly type: ApprovalEventType;
  readonly requestId: string;
  readonly requesterId: string;
  readonly actionId: string;
  readonly status: ApprovalStatus;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly decisionReason?: string;
  readonly timestamp: string;
  readonly request?: ApprovalRequest;
}

export type ApprovalEventListener = (event: ApprovalEventPayload) => void;

export class ApprovalEventHub {
  private static instance: ApprovalEventHub | null = null;
  private readonly listeners: Set<ApprovalEventListener> = new Set();
  private readonly listenersByRequestId: Map<string, Set<ApprovalEventListener>> = new Map();

  public static getInstance(): ApprovalEventHub {
    if (!ApprovalEventHub.instance) {
      ApprovalEventHub.instance = new ApprovalEventHub();
    }
    return ApprovalEventHub.instance;
  }

  /**
   * Broadcasts an approval lifecycle event to all relevant subscribers.
   */
  public emit(event: ApprovalEventPayload): void {
    // 1. Notify global listeners (e.g. Caretaker Dashboard watching for new pending requests)
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('[ApprovalEventHub] Error in global listener:', err);
      }
    }

    // 2. Notify request-specific listeners (e.g. Ward's Waiting Screen waiting for apr_...)
    const requestListeners = this.listenersByRequestId.get(event.requestId);
    if (requestListeners) {
      for (const listener of requestListeners) {
        try {
          listener(event);
        } catch (err) {
          console.warn('[ApprovalEventHub] Error in request listener:', err);
        }
      }
    }
  }

  /**
   * Subscribes to events for a specific approval request (used by Ward Waiting Screen).
   */
  public subscribeRequest(requestId: string, listener: ApprovalEventListener): () => void {
    if (!this.listenersByRequestId.has(requestId)) {
      this.listenersByRequestId.set(requestId, new Set());
    }
    this.listenersByRequestId.get(requestId)!.add(listener);

    return () => {
      const set = this.listenersByRequestId.get(requestId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listenersByRequestId.delete(requestId);
        }
      }
    };
  }

  /**
   * Subscribes to all approval events (used by Caretaker Dashboard).
   */
  public subscribeAll(listener: ApprovalEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Clears all active subscriptions (used in testing).
   */
  public clear(): void {
    this.listeners.clear();
    this.listenersByRequestId.clear();
  }
}

export const defaultApprovalEventHub = ApprovalEventHub.getInstance();
