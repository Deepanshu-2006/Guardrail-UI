import {
  ActionOwnershipRegistry,
  TrustedContactRegistry,
} from '../../extension/src/approval/authorization.js';
import {
  ApprovalService,
  ApprovalServiceDependencies,
} from '../../extension/src/approval/service.js';
import { SqliteApprovalRequestRepository } from './sqlite-approval-request-repository.js';
import { SqliteTrustedContactRegistry } from './sqlite-trusted-contact-registry.js';

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
  const contactRegistry = options.contactRegistry ?? SqliteTrustedContactRegistry.open(databasePath);
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
    service,
    close: () => {
      repository.close();
      if (contactRegistry instanceof SqliteTrustedContactRegistry) contactRegistry.close();
    },
  });
}
