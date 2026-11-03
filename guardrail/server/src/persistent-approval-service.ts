import {
  ActionOwnershipRegistry,
  TrustedContactRegistry,
} from '../../extension/src/approval/authorization.js';
import {
  ApprovalService,
  ApprovalServiceDependencies,
} from '../../extension/src/approval/service.js';
import { SqliteApprovalRequestRepository } from './sqlite-approval-request-repository.js';

export interface PersistentApprovalServiceOptions
  extends Omit<ApprovalServiceDependencies, 'repository' | 'enforceActiveContact'> {
  readonly databasePath?: string;
  readonly contactRegistry?: TrustedContactRegistry;
  readonly actionOwnershipRegistry?: ActionOwnershipRegistry;
}

/** Opens the persistent request store and composes it with the existing service. */
export function createPersistentApprovalService(options: PersistentApprovalServiceOptions = {}) {
  const repository = SqliteApprovalRequestRepository.open(options.databasePath);
  const service = new ApprovalService({
    repository,
    contactRegistry: options.contactRegistry,
    actionOwnershipRegistry: options.actionOwnershipRegistry,
    timeProvider: options.timeProvider,
    logger: options.logger,
    // A persistence-backed runtime must not accept requests without a reviewer relationship.
    enforceActiveContact: true,
  });

  return Object.freeze({
    repository,
    service,
    close: () => repository.close(),
  });
}
