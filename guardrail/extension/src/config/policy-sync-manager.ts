/**
 * Guardrail Protection Policy Synchronization Manager
 *
 * Coordinates authoritative bi-directional synchronization between local browser
 * storage (`PolicyConfigRegistry`) and the remote Guardrail Backend (`ApprovalApiClient`).
 *
 * ARCHITECTURAL PRINCIPLES & INVARIANTS:
 * 1. PERSISTENCE & AUTHORIZATION INTEGRITY:
 *    - Persists supported policy changes through the authoritative backend architecture.
 *    - Never trusts policy updates from unauthorized clients.
 *    - Never treats local cached configuration as server authorization.
 * 2. SOVEREIGN OWNERSHIP & STRICT SCOPING:
 *    - Wards receive and administer their sovereign full policy document.
 *    - Trusted contacts receive a sanitized, read-only summary (private allowlists,
 *      weights, and credentials strictly redacted).
 * 3. OPTIMISTIC CONCURRENCY CONTROL (OCC):
 *    - Enforces expected policy versions to prevent stale configurations from silently
 *      overwriting newer settings during concurrent updates.
 * 4. FAIL-CLOSED OFFLINE FALLBACK:
 *    - When the backend or network is unavailable, preserves safe local configuration
 *      without silently falling back to weaker security policies.
 *    - Mandatory security invariants (CONTROLLED_DESTRUCTIVE, UNSUPPORTED_BOUNDARY_GUARD)
 *      remain permanently locked to PROTECT under all circumstances.
 * 5. TRUTHFUL SYNCHRONIZATION STATUS:
 *    - Never claims synchronization succeeded unless authoritatively confirmed by the backend.
 *    - Clearly distinguishes live backend integration from development/mock fixtures.
 * 6. ZERO EXPOSURE OF SENSITIVE DATA:
 *    - Tokens, credentials, and passwords are never included in sync state or logs.
 */

import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import {
  ConfigHealthStatus,
  GuardrailPolicyConfig,
} from '../types/config.js';
import {
  DEFAULT_GUARDRAIL_POLICY_CONFIG,
  validatePolicyConfig,
} from './schema.js';
import {
  defaultPolicyConfigRegistry,
  PolicyConfigRegistry,
} from './registry.js';
import {
  ApiClientErrorCodes,
  ApprovalApiClient,
  PolicyAuditRecord,
  UpdateUserPolicyInput,
  UserPolicyRecord,
  UserPolicyView,
} from '../approval/client.js';
import {
  computePolicyDiff,
  TrustedContactPolicySummary,
} from '../approval/policy-permissions.js';

// =============================================================================
// Status & State Definitions
// =============================================================================

/**
 * Operational synchronization statuses.
 */
export enum PolicySyncStatus {
  /** Idle, no sync in progress */
  IDLE = 'IDLE',
  /** Synchronization actively in flight with backend */
  SYNCING = 'SYNCING',
  /** Authoritatively synchronized and verified with backend */
  SYNCED = 'SYNCED',
  /** Local policy changes staged, pending remote synchronization */
  PENDING_SYNC = 'PENDING_SYNC',
  /** Backend offline or network failed; safe local configuration preserved fail-closed */
  OFFLINE_FALLBACK = 'OFFLINE_FALLBACK',
  /** Optimistic concurrency version mismatch detected (stale update rejected) */
  CONFLICT = 'CONFLICT',
  /** Unrecoverable error (unauthenticated, forbidden, or invariant violation) */
  ERROR = 'ERROR',
}

/**
 * Service deployment / fixture type indicator.
 */
export type PolicyServiceType = 'live' | 'mock' | 'in_memory' | 'local_only';

/**
 * Active policy synchronization state.
 */
export interface PolicySyncState {
  /** Current synchronization lifecycle status */
  readonly status: PolicySyncStatus;
  /** Timestamp when policy was last successfully synchronized */
  readonly lastSyncedAt: Date | null;
  /** Non-sensitive human-readable error or warning message */
  readonly lastError: string | null;
  /** Detected service type */
  readonly serviceType: PolicyServiceType;
  /** True if backed by an in-memory or mock development fixture */
  readonly isMockService: boolean;
  /** Active local policy version */
  readonly activePolicyVersion: string;
  /** Last confirmed remote policy version from backend */
  readonly remotePolicyVersion: string | null;
  /** True if local configuration modifications are staged and pending synchronization */
  readonly hasPendingSync: boolean;
  /** Human-readable list of staged changes pending upload */
  readonly pendingChanges?: readonly string[];
  /** Conflict metadata if status is CONFLICT */
  readonly conflictDetails?: {
    readonly expectedVersion: string;
    readonly remoteVersion?: string;
  };
  /** Transparent, actionable guidance for recovering from errors */
  readonly recoveryGuidance?: string | null;
}

/**
 * Result of a synchronization operation.
 */
export interface PolicySyncResult {
  readonly success: boolean;
  readonly status: PolicySyncStatus;
  readonly config?: GuardrailPolicyConfig;
  readonly summary?: TrustedContactPolicySummary;
  readonly record?: UserPolicyRecord;
  readonly offlineFallback?: boolean;
  readonly conflict?: boolean;
  readonly error?: string;
  readonly errorType?: 'CONFLICT' | 'INVARIANT_VIOLATION' | 'OFFLINE_FALLBACK' | 'UNAUTHORIZED' | 'VALIDATION' | 'INTERNAL';
  readonly recoveryGuidance?: string;
  readonly isMockService: boolean;
}

/**
 * Construction options for PolicySyncManager.
 */
export interface PolicySyncManagerOptions {
  /** Approval API client for backend transport */
  readonly apiClient: ApprovalApiClient;
  /** Authoritative local policy registry (defaults to defaultPolicyConfigRegistry) */
  readonly registry?: PolicyConfigRegistry;
  /** Target user ID or dynamic getter */
  readonly userId?: string | (() => string | undefined);
  /** Optional logger for audit events */
  readonly logger?: {
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
  };
}

// =============================================================================
// Implementation: PolicySyncManager
// =============================================================================

export class PolicySyncManager {
  private readonly apiClient: ApprovalApiClient;
  private readonly registry: PolicyConfigRegistry;
  private readonly userIdProvider: string | (() => string | undefined);
  private readonly logger: PolicySyncManagerOptions['logger'];
  private readonly listeners: Set<(state: PolicySyncState) => void> = new Set();
  private stagedConfig: GuardrailPolicyConfig | null = null;
  private state: PolicySyncState;

  constructor(options: PolicySyncManagerOptions) {
    this.apiClient = options.apiClient;
    this.registry = options.registry ?? defaultPolicyConfigRegistry;
    this.userIdProvider = options.userId ?? '';
    this.logger = options.logger;

    const initialConfig = this.registry.getConfig();
    const serviceType = this.mapServiceType(this.apiClient.getServiceType());

    this.state = Object.freeze({
      status: PolicySyncStatus.IDLE,
      lastSyncedAt: null,
      lastError: null,
      serviceType,
      isMockService: this.apiClient.isMockService(),
      activePolicyVersion: initialConfig.policyVersion ?? '1.0.0',
      remotePolicyVersion: null,
      hasPendingSync: false,
      recoveryGuidance: null,
    });
  }

  /**
   * Retrieves the current immutable synchronization state snapshot.
   */
  public getState(): PolicySyncState {
    return this.state;
  }

  /**
   * Subscribes to synchronization state changes.
   * Returns an unsubscribe function.
   */
  public subscribe(listener: (state: PolicySyncState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Stages candidate configuration changes locally without immediately committing to backend.
   * Validates schema and mandatory security invariants before marking PENDING_SYNC.
   */
  public stagePolicyChange(candidate: GuardrailPolicyConfig): {
    readonly success: boolean;
    readonly pendingChanges: readonly string[];
    readonly errors?: readonly string[];
  } {
    const validation = validatePolicyConfig(candidate);
    if (!validation.valid || !validation.config) {
      const errors = validation.errors.map((e) => e.message);
      return { success: false, pendingChanges: [], errors };
    }

    const invariantError = this.checkMandatoryInvariants(validation.config);
    if (invariantError) {
      return { success: false, pendingChanges: [], errors: [invariantError] };
    }

    const currentConfig = this.registry.getConfig();
    const diff = computePolicyDiff(currentConfig, validation.config);

    this.stagedConfig = validation.config;
    this.updateState({
      status: PolicySyncStatus.PENDING_SYNC,
      hasPendingSync: true,
      pendingChanges: diff.changedFields,
      lastError: null,
      recoveryGuidance: null,
    });

    return {
      success: true,
      pendingChanges: diff.changedFields,
    };
  }

  /**
   * Discards staged local policy changes and restores synced or idle status.
   */
  public discardPendingChanges(): void {
    this.stagedConfig = null;
    this.updateState({
      status: this.state.lastSyncedAt ? PolicySyncStatus.SYNCED : PolicySyncStatus.IDLE,
      hasPendingSync: false,
      pendingChanges: undefined,
      lastError: null,
      recoveryGuidance: null,
    });
  }

  /**
   * Returns true if there are staged policy changes pending synchronization with the backend.
   */
  public hasPendingChanges(): boolean {
    return Boolean(this.stagedConfig && this.state.hasPendingSync);
  }

  /**
   * Returns staged candidate configuration if present.
   */
  public getStagedConfig(): GuardrailPolicyConfig | null {
    return this.stagedConfig ? { ...this.stagedConfig } : null;
  }

  /**
   * Resolves the current target user ID safely.
   */
  public resolveUserId(): string | undefined {
    if (typeof this.userIdProvider === 'function') {
      const id = this.userIdProvider();
      return id && typeof id === 'string' && id.trim() ? id.trim() : undefined;
    }
    return this.userIdProvider && typeof this.userIdProvider === 'string' && this.userIdProvider.trim()
      ? this.userIdProvider.trim()
      : undefined;
  }

  /**
   * Synchronizes remote policy down to the client.
   * If caller is the ward, validates and persists the full policy to local storage.
   * If caller is a trusted contact, validates and returns the sanitized summary.
   * If the backend is unavailable, safely preserves local fail-closed defaults.
   */
  public async syncDown(): Promise<PolicySyncResult> {
    const userId = this.resolveUserId();
    if (!userId) {
      const err = 'User identifier is required for policy synchronization. Not authenticated.';
      this.updateState({
        status: PolicySyncStatus.ERROR,
        lastError: err,
      });
      return {
        success: false,
        status: PolicySyncStatus.ERROR,
        error: err,
        isMockService: this.apiClient.isMockService(),
      };
    }

    this.updateState({
      status: PolicySyncStatus.SYNCING,
      lastError: null,
    });

    const isMock = this.apiClient.isMockService();
    const serviceType = this.mapServiceType(this.apiClient.getServiceType());

    const result = await this.apiClient.getUserPolicy(userId);

    // 1. Handle network failures and unavailable backend services
    if (!result.success) {
      if (result.isNetworkError || result.isTimeout || result.statusCode === 0 || (result.statusCode && result.statusCode >= 500)) {
        const offlineMsg = `Backend policy service unavailable (HTTP ${result.statusCode ?? 'NETWORK'}). Safe local configuration preserved fail-closed.`;
        this.logger?.warn?.(offlineMsg, { userId, statusCode: result.statusCode });

        // Ensure safe fail-closed local configuration: never permit weaker policies
        const safeLocalConfig = this.ensureSafeLocalConfiguration();

        this.updateState({
          status: PolicySyncStatus.OFFLINE_FALLBACK,
          lastError: offlineMsg,
          serviceType: 'local_only',
          activePolicyVersion: safeLocalConfig.policyVersion,
        });

        return {
          success: false,
          status: PolicySyncStatus.OFFLINE_FALLBACK,
          offlineFallback: true,
          config: safeLocalConfig,
          error: offlineMsg,
          isMockService: isMock,
        };
      }

      // 2. Client authorization or permission failure (401, 403, 404)
      const authError = result.error?.message || `Policy retrieval denied (HTTP ${result.statusCode}).`;
      this.logger?.warn?.('Policy synchronization denied by backend', { userId, code: result.error?.code });

      this.updateState({
        status: PolicySyncStatus.ERROR,
        lastError: authError,
        serviceType,
      });

      return {
        success: false,
        status: PolicySyncStatus.ERROR,
        error: authError,
        isMockService: isMock,
      };
    }

    const payload = result.data;
    if (!payload || typeof payload !== 'object') {
      const malformedErr = 'Backend returned malformed policy payload.';
      this.updateState({
        status: PolicySyncStatus.ERROR,
        lastError: malformedErr,
      });
      return {
        success: false,
        status: PolicySyncStatus.ERROR,
        error: malformedErr,
        isMockService: isMock,
      };
    }

    // 3. Handle Ward Full Policy View
    if (payload.viewType === 'WARD_FULL_POLICY') {
      const validation = validatePolicyConfig(payload.config);
      if (!validation.valid || !validation.config) {
        const invalidErr = 'Remote policy configuration failed schema validation. Preserving safe local configuration.';
        this.logger?.error?.(invalidErr, { errors: validation.errors });

        this.updateState({
          status: PolicySyncStatus.ERROR,
          lastError: invalidErr,
        });

        return {
          success: false,
          status: PolicySyncStatus.ERROR,
          error: invalidErr,
          isMockService: isMock,
        };
      }

      // Verify mandatory security invariants: never accept remote policy that weakens locked rules
      const invariantError = this.checkMandatoryInvariants(validation.config);
      if (invariantError) {
        this.logger?.error?.('Remote policy violates mandatory invariants: ' + invariantError);
        this.updateState({
          status: PolicySyncStatus.ERROR,
          lastError: invariantError,
        });
        return {
          success: false,
          status: PolicySyncStatus.ERROR,
          error: invariantError,
          isMockService: isMock,
        };
      }

      // Persist authoritatively to local registry and storage
      await this.registry.saveToStorage(validation.config);
      this.stagedConfig = null;

      this.updateState({
        status: PolicySyncStatus.SYNCED,
        lastSyncedAt: new Date(),
        lastError: null,
        serviceType,
        isMockService: isMock,
        activePolicyVersion: validation.config.policyVersion,
        remotePolicyVersion: validation.config.policyVersion,
        hasPendingSync: false,
        pendingChanges: undefined,
        recoveryGuidance: null,
      });

      return {
        success: true,
        status: PolicySyncStatus.SYNCED,
        config: validation.config,
        isMockService: isMock,
      };
    }

    // 4. Handle Trusted Contact Summary View
    if (payload.viewType === 'TRUSTED_CONTACT_SUMMARY') {
      this.updateState({
        status: PolicySyncStatus.SYNCED,
        lastSyncedAt: new Date(),
        lastError: null,
        serviceType,
        isMockService: isMock,
        remotePolicyVersion: payload.summary.policyVersion,
        hasPendingSync: false,
        pendingChanges: undefined,
        recoveryGuidance: null,
      });

      return {
        success: true,
        status: PolicySyncStatus.SYNCED,
        summary: payload.summary,
        isMockService: isMock,
      };
    }

    const unknownViewErr = 'Unrecognized policy view format from backend.';
    this.updateState({
      status: PolicySyncStatus.ERROR,
      lastError: unknownViewErr,
      recoveryGuidance: 'Contact support if policy document format is unrecognized.',
    });
    return {
      success: false,
      status: PolicySyncStatus.ERROR,
      error: unknownViewErr,
      errorType: 'INTERNAL',
      recoveryGuidance: 'Contact support if policy document format is unrecognized.',
      isMockService: isMock,
    };
  }

  /**
   * Pushes a local policy update up to the authoritative backend with Optimistic
   * Concurrency Control (OCC) to prevent stale overwrites.
   *
   * @param candidate Candidate policy configuration (defaults to staged config or active config)
   */
  public async syncUp(candidate?: GuardrailPolicyConfig): Promise<PolicySyncResult> {
    const userId = this.resolveUserId();
    if (!userId) {
      const err = 'User identifier is required to persist protection policy changes.';
      const recovery = 'Ensure user is authenticated before attempting to synchronize policy changes.';
      this.updateState({
        status: PolicySyncStatus.ERROR,
        lastError: err,
        recoveryGuidance: recovery,
      });
      return {
        success: false,
        status: PolicySyncStatus.ERROR,
        error: err,
        errorType: 'UNAUTHORIZED',
        recoveryGuidance: recovery,
        isMockService: this.apiClient.isMockService(),
      };
    }

    const configToSave = candidate ?? this.stagedConfig ?? this.registry.getConfig();

    // 1. Client-side schema validation
    const validation = validatePolicyConfig(configToSave);
    if (!validation.valid || !validation.config) {
      const err = `Policy validation failed: ${validation.errors.map((e) => e.message).join('; ')}`;
      const recovery = 'Verify all threshold numbers and policy rule structures match schema constraints.';
      this.updateState({
        status: PolicySyncStatus.ERROR,
        lastError: err,
        recoveryGuidance: recovery,
      });
      return {
        success: false,
        status: PolicySyncStatus.ERROR,
        error: err,
        errorType: 'VALIDATION',
        recoveryGuidance: recovery,
        isMockService: this.apiClient.isMockService(),
      };
    }

    // 2. Pre-flight enforcement of mandatory invariants
    const invariantError = this.checkMandatoryInvariants(validation.config);
    if (invariantError) {
      const recovery = 'Non-configurable protections (CONTROLLED_DESTRUCTIVE, UNSUPPORTED_BOUNDARY_GUARD) must remain enabled and set to PROTECT.';
      this.updateState({
        status: PolicySyncStatus.ERROR,
        lastError: invariantError,
        recoveryGuidance: recovery,
      });
      return {
        success: false,
        status: PolicySyncStatus.ERROR,
        error: invariantError,
        errorType: 'INVARIANT_VIOLATION',
        recoveryGuidance: recovery,
        isMockService: this.apiClient.isMockService(),
      };
    }

    this.updateState({
      status: PolicySyncStatus.SYNCING,
      lastError: null,
      recoveryGuidance: null,
    });

    const isMock = this.apiClient.isMockService();
    const serviceType = this.mapServiceType(this.apiClient.getServiceType());

    // 3. Concurrency expectation: use remote version if known, otherwise current local version
    const expectedPolicyVersion = this.state.remotePolicyVersion ?? this.state.activePolicyVersion;

    const payload: UpdateUserPolicyInput = {
      config: validation.config,
      expectedPolicyVersion,
    };

    const result = await this.apiClient.updateUserPolicy(userId, payload);

    // 4. Handle stale update conflict (HTTP 409)
    if (!result.success) {
      if (
        result.statusCode === 409 ||
        result.error?.code === ApiClientErrorCodes.POLICY_VERSION_CONFLICT ||
        result.error?.code === ApiClientErrorCodes.ALREADY_RESOLVED
      ) {
        const conflictMsg =
          `Policy version conflict: Remote configuration was updated concurrently (expected v${expectedPolicyVersion}). ` +
          (result.error?.message ? `Details: ${result.error.message}` : '');
        const recovery = 'Reload remote policy via syncDown() to merge or re-apply modifications against the active version.';
        this.logger?.warn?.(conflictMsg, { userId, expectedPolicyVersion });

        this.updateState({
          status: PolicySyncStatus.CONFLICT,
          lastError: conflictMsg,
          conflictDetails: {
            expectedVersion: expectedPolicyVersion,
          },
          recoveryGuidance: recovery,
        });

        return {
          success: false,
          status: PolicySyncStatus.CONFLICT,
          conflict: true,
          error: conflictMsg,
          errorType: 'CONFLICT',
          recoveryGuidance: recovery,
          isMockService: isMock,
        };
      }

      // 5. Handle network failure / offline backend
      if (result.isNetworkError || result.isTimeout || result.statusCode === 0 || (result.statusCode && result.statusCode >= 500)) {
        const offlineMsg = `Backend unavailable; policy update could not be committed (HTTP ${result.statusCode ?? 'OFFLINE'}).`;
        const recovery = 'Safe local configuration preserved fail-closed. Your changes remain staged locally until network connectivity is restored.';
        this.logger?.warn?.(offlineMsg, { userId });

        this.updateState({
          status: PolicySyncStatus.OFFLINE_FALLBACK,
          lastError: offlineMsg,
          serviceType: 'local_only',
          recoveryGuidance: recovery,
        });

        return {
          success: false,
          status: PolicySyncStatus.OFFLINE_FALLBACK,
          offlineFallback: true,
          error: offlineMsg,
          errorType: 'OFFLINE_FALLBACK',
          recoveryGuidance: recovery,
          isMockService: isMock,
        };
      }

      // 6. Generic or authorization failure
      const errorMsg = result.error?.message || `Policy update failed (HTTP ${result.statusCode}).`;
      const recovery = result.statusCode === 403
        ? 'Trusted contacts hold zero policy administration authority. Policy settings belong exclusively to the ward.'
        : 'Ensure your user session is valid and candidate settings adhere to security requirements.';
      this.updateState({
        status: PolicySyncStatus.ERROR,
        lastError: errorMsg,
        recoveryGuidance: recovery,
      });

      return {
        success: false,
        status: PolicySyncStatus.ERROR,
        error: errorMsg,
        errorType: result.statusCode === 403 ? 'UNAUTHORIZED' : 'INTERNAL',
        recoveryGuidance: recovery,
        isMockService: isMock,
      };
    }

    // 7. Success confirmation from authoritative backend
    const record = result.data;
    if (!record || typeof record !== 'object' || !record.config) {
      const err = 'Backend update succeeded but returned invalid record.';
      this.updateState({
        status: PolicySyncStatus.ERROR,
        lastError: err,
        recoveryGuidance: 'Please retry synchronization or inspect server logs.',
      });
      return {
        success: false,
        status: PolicySyncStatus.ERROR,
        error: err,
        errorType: 'INTERNAL',
        recoveryGuidance: 'Please retry synchronization or inspect server logs.',
        isMockService: isMock,
      };
    }

    // Persist confirmed update locally
    await this.registry.saveToStorage(record.config);
    this.stagedConfig = null;

    this.updateState({
      status: PolicySyncStatus.SYNCED,
      lastSyncedAt: new Date(record.updatedAt || Date.now()),
      lastError: null,
      serviceType,
      isMockService: isMock,
      activePolicyVersion: record.policyVersion,
      remotePolicyVersion: record.policyVersion,
      hasPendingSync: false,
      pendingChanges: undefined,
      conflictDetails: undefined,
      recoveryGuidance: null,
    });

    return {
      success: true,
      status: PolicySyncStatus.SYNCED,
      record,
      config: record.config,
      isMockService: isMock,
    };
  }

  /**
   * Resets the user's remote protection policy to documented defaults.
   */
  public async resetRemotePolicy(): Promise<PolicySyncResult> {
    const userId = this.resolveUserId();
    if (!userId) {
      const err = 'User identifier is required to reset protection policy.';
      const recovery = 'Authenticate as the target ward before resetting policy.';
      return {
        success: false,
        status: PolicySyncStatus.ERROR,
        error: err,
        errorType: 'UNAUTHORIZED',
        recoveryGuidance: recovery,
        isMockService: this.apiClient.isMockService(),
      };
    }

    this.updateState({
      status: PolicySyncStatus.SYNCING,
      lastError: null,
      recoveryGuidance: null,
    });

    const isMock = this.apiClient.isMockService();
    const serviceType = this.mapServiceType(this.apiClient.getServiceType());

    const result = await this.apiClient.resetUserPolicy(userId);
    if (!result.success) {
      const err = result.error?.message || `Failed to reset policy (HTTP ${result.statusCode}).`;
      const recovery = 'Check backend connectivity and authentication session.';
      this.updateState({
        status: PolicySyncStatus.ERROR,
        lastError: err,
        recoveryGuidance: recovery,
      });
      return {
        success: false,
        status: PolicySyncStatus.ERROR,
        error: err,
        errorType: result.statusCode === 403 ? 'UNAUTHORIZED' : 'INTERNAL',
        recoveryGuidance: recovery,
        isMockService: isMock,
      };
    }

    const record = result.data;
    await this.registry.saveToStorage(record.config);
    this.stagedConfig = null;

    this.updateState({
      status: PolicySyncStatus.SYNCED,
      lastSyncedAt: new Date(record.updatedAt || Date.now()),
      lastError: null,
      serviceType,
      isMockService: isMock,
      activePolicyVersion: record.policyVersion,
      remotePolicyVersion: record.policyVersion,
      hasPendingSync: false,
      pendingChanges: undefined,
      conflictDetails: undefined,
      recoveryGuidance: null,
    });

    return {
      success: true,
      status: PolicySyncStatus.SYNCED,
      record,
      config: record.config,
      isMockService: isMock,
    };
  }

  /**
   * Verifies that the local configuration is valid and fail-closed.
   * If local configuration is corrupted, resets to DEFAULT_GUARDRAIL_POLICY_CONFIG.
   */
  private ensureSafeLocalConfiguration(): GuardrailPolicyConfig {
    const current = this.registry.getConfig();
    const validation = validatePolicyConfig(current);
    if (!validation.valid || !validation.config || this.checkMandatoryInvariants(validation.config)) {
      this.registry.resetToDefault();
      return DEFAULT_GUARDRAIL_POLICY_CONFIG;
    }
    return current;
  }

  /**
   * Verifies that mandatory security invariants are preserved.
   * Returns an error description string if any invariant is violated; otherwise null.
   */
  private checkMandatoryInvariants(config: GuardrailPolicyConfig): string | null {
    const destructive = config.policies.find((p) => p.id === RiskPolicyId.CONTROLLED_DESTRUCTIVE);
    if (!destructive || !destructive.enabled || destructive.decision !== ResponseAction.PROTECT) {
      return 'Security invariant violation: CONTROLLED_DESTRUCTIVE must remain enabled and set to PROTECT.';
    }

    const boundary = config.policies.find((p) => p.id === RiskPolicyId.UNSUPPORTED_BOUNDARY_GUARD);
    if (!boundary || !boundary.enabled || boundary.decision !== ResponseAction.PROTECT) {
      return 'Security invariant violation: UNSUPPORTED_BOUNDARY_GUARD must remain enabled and set to PROTECT.';
    }

    return null;
  }

  private mapServiceType(detected: 'live' | 'mock' | 'in_memory'): PolicyServiceType {
    if (detected === 'in_memory') return 'in_memory';
    if (detected === 'mock') return 'mock';
    return 'live';
  }

  private updateState(partial: Partial<PolicySyncState>): void {
    this.state = Object.freeze({
      ...this.state,
      ...partial,
    });
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('[PolicySyncManager] Listener notification failed:', err);
      }
    }
  }
}
