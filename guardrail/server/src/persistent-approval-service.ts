import {
  ActionOwnershipRegistry,
  TrustedContactRegistry,
} from '../../extension/src/approval/authorization.js';
import {
  ApprovalService,
  ApprovalServiceDependencies,
} from '../../extension/src/approval/service.js';
import { PolicyService } from '../../extension/src/approval/policy-service.js';
import { SqliteApprovalRequestRepository } from './sqlite-approval-request-repository.js';
import { SqliteTrustedContactRegistry } from './sqlite-trusted-contact-registry.js';
import { SqlitePolicyRepository } from './sqlite-policy-repository.js';
import { defaultApprovalEventHub } from './event-hub.js';

export interface PersistentApprovalServiceOptions
  extends Omit<ApprovalServiceDependencies, 'repository' | 'enforceActiveContact'> {
  readonly databasePath?: string;
  readonly contactRegistry?: TrustedContactRegistry;
  readonly actionOwnershipRegistry?: ActionOwnershipRegistry;
}

/** Opens the persistent request store and composes it with the existing service. */
export function createPersistentApprovalService(options: PersistentApprovalServiceOptions = {}) {
  const databasePath = options.databasePath ?? process.env.GUARDRAIL_DB_PATH ?? 'data/guardrail.sqlite';
  const repository = SqliteApprovalRequestRepository.open(databasePath);
  const sharedDb = repository.getDatabase();
  const contactRegistry = options.contactRegistry ?? SqliteTrustedContactRegistry.open(sharedDb);
  const policyRepository = SqlitePolicyRepository.open(sharedDb);
  const policyService = new PolicyService({
    policyRepository,
    contactRegistry,
    timeProvider: options.timeProvider ? () => new Date(options.timeProvider!()) : undefined,
  });
  const service = new ApprovalService({
    repository,
    contactRegistry,
    actionOwnershipRegistry: options.actionOwnershipRegistry,
    timeProvider: options.timeProvider,
    logger: options.logger,
    // A persistence-backed runtime must not accept requests without a reviewer relationship.
    enforceActiveContact: true,
  });

  return Object.freeze({
    repository,
    contactRegistry,
    policyRepository,
    policyService,
    healthCheck: () => {
      try {
        if (!repository.healthCheck()) return false;
        if (!policyRepository.healthCheck()) return false;
        return !(contactRegistry instanceof SqliteTrustedContactRegistry) || contactRegistry.healthCheck();
      } catch {
        return false;
      }
    },
    service: wrapServiceWithEventHub(service),
    close: () => {
      repository.close();
      policyRepository.close();
      if (contactRegistry instanceof SqliteTrustedContactRegistry) contactRegistry.close();
    },
  });
}

/**
 * Proxies ApprovalService mutating methods to broadcast real-time events to the Event Hub.
 */
function wrapServiceWithEventHub(service: ApprovalService): ApprovalService {
  const origCreate = service.createRequest.bind(service);
  const origApprove = service.approveRequest.bind(service);
  const origReject = service.rejectRequest.bind(service);
  const origCancel = service.cancelRequest.bind(service);
  const origSubmitDecision = service.submitDecision.bind(service);

  service.createRequest = (payload, authContext, options) => {
    const created = origCreate(payload, authContext, options);
    try {
      defaultApprovalEventHub.emit({
        type: 'created',
        requestId: created.id,
        requesterId: created.requesterId,
        actionId: created.actionId,
        status: created.status,
        timestamp: created.createdAt,
        request: created,
      });
    } catch (e) {
      console.warn('[EventEmittingApprovalService] Failed to emit created event:', e);
    }
    return created;
  };

  service.submitDecision = (requestId, decision, inputOrAuthContext, maybeAuthContext) => {
    const resolved = origSubmitDecision(requestId, decision, inputOrAuthContext as any, maybeAuthContext as any);
    try {
      defaultApprovalEventHub.emit({
        type: 'decided',
        requestId: resolved.id,
        requesterId: resolved.requesterId,
        actionId: resolved.actionId,
        status: resolved.status,
        decidedBy: resolved.decision?.decidedBy,
        decidedAt: resolved.decision?.decidedAt,
        decisionReason: resolved.decision?.reason,
        timestamp: resolved.decision?.decidedAt || new Date().toISOString(),
        request: resolved,
      });
    } catch (e) {
      console.warn('[EventEmittingApprovalService] Failed to emit decided event:', e);
    }
    return resolved;
  };

  service.approveRequest = (requestId, input, authContext) => {
    return service.submitDecision(requestId, 'APPROVED', input, authContext);
  };

  service.rejectRequest = (requestId, input, authContext) => {
    return service.submitDecision(requestId, 'REJECTED', input, authContext);
  };

  service.cancelRequest = (requestId, reason, authContext, options) => {
    const cancelled = origCancel(requestId, reason, authContext, options);
    try {
      defaultApprovalEventHub.emit({
        type: 'cancelled',
        requestId: cancelled.id,
        requesterId: cancelled.requesterId,
        actionId: cancelled.actionId,
        status: cancelled.status,
        decisionReason: reason,
        timestamp: new Date().toISOString(),
        request: cancelled,
      });
    } catch (e) {
      console.warn('[EventEmittingApprovalService] Failed to emit cancelled event:', e);
    }
    return cancelled;
  };

  return service;
}
