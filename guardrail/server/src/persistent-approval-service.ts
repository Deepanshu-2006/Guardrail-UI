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
    service,
    close: () => {
      repository.close();
      policyRepository.close();
      if (contactRegistry instanceof SqliteTrustedContactRegistry) contactRegistry.close();
    },
  });
}
