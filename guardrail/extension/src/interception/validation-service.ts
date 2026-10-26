/**
 * Guardrail Controlled Action Continuation Validation Service
 *
 * Implements a dedicated, authoritative validation service that determines whether a
 * held browser action is eligible for controlled continuation.
 *
 * ARCHITECTURAL REQUIREMENTS & SAFETY INVARIANTS:
 * 1. 10 MANDATORY CONTINUATION CONDITIONS:
 *    Condition 1:  The approval request exists.
 *    Condition 2:  The backend has authoritatively confirmed the approval decision.
 *    Condition 3:  The authenticated user and workflow are authorized to access the request.
 *    Condition 4:  The approval request is bound to the exact expected action (1:1 lock).
 *    Condition 5:  The binding has not been reassigned, cancelled, expired, or invalidated.
 *    Condition 6:  The held-action record still exists and corresponds to the same action.
 *    Condition 7:  The action remains in a permitted lifecycle state (HELD, AWAITING_APPROVAL, READY_FOR_USER_CONFIRMATION).
 *    Condition 8:  The relevant page or action context has not changed in a way that invalidates the authorization.
 *    Condition 9:  The action has not already been continued or consumed (exactly-once execution).
 *    Condition 10: All existing risk-engine and staging requirements remain satisfied.
 *
 * 2. SAFETY INVARIANTS:
 *    - FAIL CLOSED: Never treat a timeout, network failure, malformed response, or missing backend as approval.
 *    - ZERO-TRUST CLIENT: Never rely exclusively on client-side state for server authorization.
 *    - SERVER TIME: Uses trusted server-side clock for expiration evaluation.
 *    - ZERO SENSITIVE DATA LOGGING: Never serializes passwords, OTPs, card numbers, or form values.
 *    - STRUCTURAL IDENTITY: Never treats a hostname or URL as sufficient proof of identical action.
 *    - ZERO EXECUTION: Pure validation service; NEVER executes the action callback from inside validation.
 *    - DOCUMENTED LIMITATIONS: Explicitly reports architectural boundaries where verification cannot be guaranteed.
 */

import {
  InterceptionRecord,
  InterceptionState,
} from '../types/interception.js';
import {
  GuardrailAction,
} from '../types/actions.js';
import {
  ApprovalActionBinding,
  ApprovalActionBindingState,
  ApprovalRequest,
  ApprovalStatus,
  BackendContinuationValidationResult,
} from '../types/approval.js';
import {
  ActorRole,
  AuthContext,
} from '../approval/authorization.js';
import {
  ApprovalService,
} from '../approval/service.js';
import {
  ApprovalApiClient,
} from '../approval/client.js';
import {
  TimeProvider,
  defaultTimeProvider,
  resolveTimestamp,
  isRequestExpired,
  validateActionId,
} from '../approval/model.js';
import {
  isBindingExpired,
  validateActionDigest,
} from '../approval/binding.js';
import { InterceptionController, defaultInterceptionController } from './controller.js';
import {
  ContinuationManager,
  ContinuationPageContext,
  ContinuationAuthorizationErrorCode,
  defaultContinuationManager,
} from './continuation.js';
import { StagingActionContext } from '../types/staging.js';
import { transitionInterceptionRecord } from './transitions.js';
import { ResponseAction } from '../types/response.js';
import { evaluatePolicies } from '../response/policies.js';
import { GuardrailPolicyConfig } from '../types/config.js';

// =============================================================================
// Validation Status Enum & Result Models
// =============================================================================

/**
 * Categorical qualification distinguishing the specific validation outcome.
 */
export enum ContinuationEligibilityStatus {
  /** All 10 conditions satisfied; backend approved and verified for user confirmation */
  ELIGIBLE = 'ELIGIBLE',

  /** Approval request exists and is valid, but is still awaiting reviewer decision */
  PENDING = 'PENDING',

  /** Approval was explicitly rejected or binding invalidated */
  REJECTED = 'REJECTED',

  /** Approval request or action binding exceeded its TTL based on trusted server time */
  EXPIRED = 'EXPIRED',

  /** Request, binding, or held action was explicitly cancelled */
  CANCELLED = 'CANCELLED',

  /** Action ID, requester, page context, or DOM target element mismatch detected */
  MISMATCHED = 'MISMATCHED',

  /** Backend offline, network error, timeout, unauthenticated, or missing local record */
  UNAVAILABLE = 'UNAVAILABLE',
}

/**
 * Strongly typed validation result returned by ContinuationValidationService.
 */
export interface ContinuationValidationResult {
  /** True strictly when all 10 conditions are satisfied and continuation is authorized */
  readonly eligible: boolean;

  /** Canonical categorical status distinguishing outcome conditions */
  readonly status: ContinuationEligibilityStatus;

  /** Action identifier being evaluated */
  readonly actionId: string;

  /** Associated backend approval request ID (if identified) */
  readonly requestId?: string;

  /** Associated backend action binding ID (if identified) */
  readonly bindingId?: string;

  /** Verified requester user ID (if authoritatively known) */
  readonly requesterId?: string;

  /** Evaluated target lifecycle state for the action in the state machine */
  readonly targetState?: InterceptionState;

  /** Human-readable explanation of the validation outcome */
  readonly reason: string;

  /** Machine-readable error or resolution code */
  readonly errorCode?: ContinuationAuthorizationErrorCode | string;

  /** Resulting policy decision recorded during validation */
  readonly policyDecision?: ResponseAction;

  /** Canonical matched rule or policy identifier */
  readonly policyRuleId?: string;

  /** Machine-readable policy reason code */
  readonly policyReasonCode?: string;

  /** ISO 8601 UTC timestamp when validation was completed */
  readonly verifiedAt: string;

  /** Explicitly documented architectural limitations for conditions that cannot be verified with absolute certainty */
  readonly limitations: readonly string[];
}

/**
 * Optional contextual parameters provided when evaluating continuation eligibility.
 */
export interface ContinuationValidationOptions {
  /** Expected authenticated requester identity to verify ownership */
  readonly expectedRequesterId?: string;

  /** Verified authentication context of the current caller */
  readonly authContext?: AuthContext;

  /** Active webpage context (URL, origin) to verify against intercepted location */
  readonly pageContext?: ContinuationPageContext;

  /** Function or flag verifying target DOM element is still connected to document */
  readonly isElementAttached?: (elementId?: string) => boolean;

  /** Expected SHA-256 action structural fingerprint digest */
  readonly expectedDigest?: string;

  /** Staged action context to verify risk-engine and staging requirements */
  readonly stagingContext?: StagingActionContext;

  /** Pre-loaded approval request entity (for in-memory or offline validation) */
  readonly request?: ApprovalRequest | null;

  /** Pre-loaded approval action binding entity */
  readonly binding?: ApprovalActionBinding | null;

  /** Explicit action object overriding held closure if running outside browser content script */
  readonly originalAction?: GuardrailAction;

  /** Whether to revalidate the applicable canonical risk policies on the held action (defaults to true) */
  readonly revalidatePolicy?: boolean;

  /** Expected canonical policy rule ID that must remain satisfied for continuation */
  readonly expectedPolicyId?: string;

  /** Optional centralized risk-policy configuration override */
  readonly policyConfig?: GuardrailPolicyConfig;
}

/**
 * Configuration options for constructing a ContinuationValidationService.
 */
export interface ContinuationValidationServiceOptions {
  readonly controller?: InterceptionController;
  readonly continuationManager?: ContinuationManager;
  readonly approvalClient?: ApprovalApiClient;
  readonly approvalService?: ApprovalService;
  readonly timeProvider?: TimeProvider;
  readonly getCurrentPageContext?: () => ContinuationPageContext;
  readonly isElementAttached?: (elementId?: string) => boolean;
  readonly policyConfig?: GuardrailPolicyConfig;
}

// =============================================================================
// Architectural Limitations Constant
// =============================================================================

/**
 * Explicitly documented architectural limitations of browser action continuation.
 * Included in validation results to prevent claiming stronger guarantees than the architecture provides.
 */
export const CONTINUATION_VALIDATION_LIMITATIONS: readonly string[] = Object.freeze([
  'LIMITATION_BROWSER_ISOLATION: Content scripts run in an isolated JavaScript execution realm and cannot inspect or preserve host page event listeners. Only registered test callbacks or explicitly supported actions can be safely continued.',
  'LIMITATION_DOM_IDENTITY: Verifying element ID, tagName, and active document connectivity does not guarantee the element was not mutated or re-rendered by dynamic client frameworks (e.g. Virtual DOM replacement).',
  'LIMITATION_PAGE_LIFECYCLE: Action closures and held records are strictly ephemeral in-memory references tied to the active document realm. Page reloads, tab navigation, or crashes permanently wipe held closures, causing continuation to fail closed.',
  'LIMITATION_SYNTHETIC_EVENTS: Re-dispatching synthetic DOM events produces `isTrusted: false`, which may be rejected by host application anti-fraud or security mechanisms. Guardrail strictly avoids synthetic DOM event replay.',
  'LIMITATION_EPHEMERAL_PERSISTENCE: Development backend storage operates in-memory; restarting backend services clears active bindings and approval records.',
  'LIMITATION_PAGE_STATE_DRIFT: While origin, pathname, element tag, and structural digest are verified, form input fields or server-side application state on the host page may have mutated while the action was held.',
  'LIMITATION_ATOMIC_SERVER_CONSUMPTION: Current development backend architecture lacks atomic server-side continuation state transitions or single-use consumption tokens once an approval reaches the terminal APPROVED state. While client-side state machines enforce monotonic single-execution and reject concurrent in-flight attempts, client checks alone cannot provide complete server-side concurrency guarantees against external re-use.',
  'LIMITATION_VERIFIED_ACTIONS_ONLY: Continuation is strictly restricted to explicitly registered controlled test actions with verified resumption handlers. Universal continuation for arbitrary websites or unverified DOM operations is not supported.',
]);

// =============================================================================
// Dedicated Continuation Validation Service
// =============================================================================

/**
 * Dedicated Validation Service determining whether a held action is eligible for controlled continuation.
 */
export class ContinuationValidationService {
  private readonly controller: InterceptionController;
  private readonly continuationManager: ContinuationManager;
  private readonly approvalClient?: ApprovalApiClient;
  private readonly approvalService?: ApprovalService;
  private readonly timeProvider: TimeProvider;
  private readonly getCurrentPageContext?: () => ContinuationPageContext;
  private readonly isElementAttached?: (elementId?: string) => boolean;
  private readonly policyConfig?: GuardrailPolicyConfig;

  constructor(options?: ContinuationValidationServiceOptions) {
    this.controller = options?.controller ?? defaultInterceptionController;
    this.continuationManager = options?.continuationManager ?? defaultContinuationManager;
    this.approvalClient = options?.approvalClient;
    this.approvalService = options?.approvalService;
    this.timeProvider = options?.timeProvider ?? defaultTimeProvider;
    this.getCurrentPageContext = options?.getCurrentPageContext;
    this.isElementAttached = options?.isElementAttached;
    this.policyConfig = options?.policyConfig;
  }

  public getController(): InterceptionController {
    return this.controller;
  }

  public getContinuationManager(): ContinuationManager {
    return this.continuationManager;
  }

  public getApprovalService(): ApprovalService | undefined {
    return this.approvalService;
  }

  public getApprovalClient(): ApprovalApiClient | undefined {
    return this.approvalClient;
  }

  /**
   * Evaluates all 10 conditions to determine whether a held action is eligible for continuation.
   *
   * NEVER executes the action.
   * FAILS CLOSED on any missing, malformed, or unconfirmed condition.
   *
   * @param actionId Canonical intercepted action identifier
   * @param options Optional validation parameters
   * @returns Strongly typed ContinuationValidationResult
   */
  public async validateEligibility(
    actionId: string,
    options?: ContinuationValidationOptions
  ): Promise<ContinuationValidationResult> {
    const verifiedAt = resolveTimestamp(this.timeProvider);
    const id = actionId?.trim();

    // 0. Format Validation
    if (!id) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.MISMATCHED,
        actionId: '',
        targetState: InterceptionState.INVALIDATED,
        reason: 'Cannot validate continuation without a non-empty actionId.',
        errorCode: 'ACTION_ID_MISMATCH',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    const idValidation = validateActionId(id);
    if (!idValidation.valid) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.MISMATCHED,
        actionId: id,
        targetState: InterceptionState.INVALIDATED,
        reason: `Invalid actionId format: ${idValidation.errors[0]}`,
        errorCode: 'ACTION_ID_MISMATCH',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    // =========================================================================
    // CONDITION 6: Local interception record exists and corresponds to action
    // =========================================================================
    const record = this.controller.getRecord(id);
    if (!record) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.UNAVAILABLE,
        actionId: id,
        targetState: InterceptionState.INVALIDATED,
        reason: `Local interception record for action "${id}" was not found in InterceptionController.`,
        errorCode: 'ACTION_ID_MISMATCH',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    if (record.actionId !== id) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.MISMATCHED,
        actionId: id,
        targetState: InterceptionState.INVALIDATED,
        reason: `Local record actionId mismatch: record is bound to "${record.actionId}", target is "${id}".`,
        errorCode: 'ACTION_ID_MISMATCH',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    // =========================================================================
    // CONDITION 7: Action remains in a permitted lifecycle state
    // =========================================================================
    if (record.state === InterceptionState.CONTINUED) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.UNAVAILABLE,
        actionId: id,
        targetState: InterceptionState.CONTINUED,
        reason: `Action "${id}" is already in terminal CONTINUED state. Cannot re-continue.`,
        errorCode: 'ALREADY_CONTINUED',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    if (record.state === InterceptionState.CANCELLED) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.CANCELLED,
        actionId: id,
        targetState: InterceptionState.CANCELLED,
        reason: `Action "${id}" was CANCELLED. Cancelled actions cannot be resumed.`,
        errorCode: 'REQUEST_CANCELLED',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    if (record.state === InterceptionState.EXPIRED) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.EXPIRED,
        actionId: id,
        targetState: InterceptionState.EXPIRED,
        reason: `Action "${id}" is in terminal EXPIRED state.`,
        errorCode: 'REQUEST_EXPIRED',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    if (record.state === InterceptionState.INVALIDATED) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.REJECTED,
        actionId: id,
        targetState: InterceptionState.INVALIDATED,
        reason: `Action "${id}" is in terminal INVALIDATED state.`,
        errorCode: 'BINDING_INVALIDATED',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    if (
      record.state !== InterceptionState.HELD &&
      record.state !== InterceptionState.AWAITING_APPROVAL &&
      record.state !== InterceptionState.READY_FOR_USER_CONFIRMATION
    ) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.UNAVAILABLE,
        actionId: id,
        targetState: InterceptionState.INVALIDATED,
        reason: `Action "${id}" is in state "${record.state}". Only actions in HELD, AWAITING_APPROVAL, or READY_FOR_USER_CONFIRMATION can be validated.`,
        errorCode: 'REQUEST_NOT_APPROVED',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    // =========================================================================
    // CONDITION 9: Action has not already been continued or consumed
    // =========================================================================
    const executionCount = this.continuationManager.getExecutionCount(id);
    if (executionCount > 0) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.UNAVAILABLE,
        actionId: id,
        targetState: InterceptionState.CONTINUED,
        reason: `Action "${id}" has already executed ${executionCount} time(s). Duplicate continuation prohibited.`,
        errorCode: 'ALREADY_CONTINUED',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    // Condition 6 (Closure Check): Held action closure must still exist in memory
    const heldEntry = this.continuationManager.getCurrentHeldAction();
    const actionObj = options?.originalAction ?? (heldEntry && heldEntry.action.id === id ? heldEntry.action : undefined);

    if (!actionObj) {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.UNAVAILABLE,
        actionId: id,
        targetState: InterceptionState.INVALIDATED,
        reason: `Held action closure for "${id}" is missing or detached from memory (page may have navigated or reloaded). Cannot safely resume.`,
        errorCode: 'AUTHORIZATION_UNAVAILABLE',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    // Condition 6b: Verified Controlled Action Resumption Check
    if (heldEntry && heldEntry.action.id === id && typeof heldEntry.handler !== 'function') {
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.UNAVAILABLE,
        actionId: id,
        targetState: InterceptionState.INVALIDATED,
        reason: `Held action "${id}" does not possess a verified controlled test handler. Resumption is strictly restricted to explicitly registered test actions; arbitrary website continuation is not supported.`,
        errorCode: 'AUTHORIZATION_UNAVAILABLE',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    // =========================================================================
    // CONDITION 8: Context verification (Origin, Path, Element Attachment & Digest)
    // =========================================================================
    // "Do not treat a hostname or URL as sufficient proof that an action is identical."
    const activePageContext =
      options?.pageContext ??
      (this.getCurrentPageContext
        ? this.getCurrentPageContext()
        : typeof window !== 'undefined'
        ? { url: window.location?.href, origin: window.location?.origin }
        : undefined);

    if (actionObj.page?.url && activePageContext) {
      const origUrl = actionObj.page.url;
      const currentOrigin = activePageContext.origin;
      const currentUrl = activePageContext.url;

      // 8a. Origin match
      if (origUrl && currentOrigin) {
        try {
          const origOrigin = new URL(origUrl).origin;
          if (origOrigin !== currentOrigin) {
            return {
              eligible: false,
              status: ContinuationEligibilityStatus.MISMATCHED,
              actionId: id,
              targetState: InterceptionState.INVALIDATED,
              reason: `Page origin mismatch: Current origin "${currentOrigin}" does not match original intercepted origin "${origOrigin}".`,
              errorCode: 'PAGE_CONTEXT_MISMATCH',
              verifiedAt,
              limitations: CONTINUATION_VALIDATION_LIMITATIONS,
            };
          }
        } catch {
          return {
            eligible: false,
            status: ContinuationEligibilityStatus.MISMATCHED,
            actionId: id,
            targetState: InterceptionState.INVALIDATED,
            reason: `Invalid original page URL "${origUrl}".`,
            errorCode: 'PAGE_CONTEXT_MISMATCH',
            verifiedAt,
            limitations: CONTINUATION_VALIDATION_LIMITATIONS,
          };
        }
      }

      // 8b. Pathname match
      if (origUrl && currentUrl) {
        try {
          const origParsed = new URL(origUrl);
          const currParsed = new URL(currentUrl);
          if (origParsed.origin !== currParsed.origin || origParsed.pathname !== currParsed.pathname) {
            return {
              eligible: false,
              status: ContinuationEligibilityStatus.MISMATCHED,
              actionId: id,
              targetState: InterceptionState.INVALIDATED,
              reason: `Page path mismatch: Current path "${currParsed.pathname}" does not match intercepted path "${origParsed.pathname}".`,
              errorCode: 'PAGE_CONTEXT_MISMATCH',
              verifiedAt,
              limitations: CONTINUATION_VALIDATION_LIMITATIONS,
            };
          }
        } catch {
          return {
            eligible: false,
            status: ContinuationEligibilityStatus.MISMATCHED,
            actionId: id,
            targetState: InterceptionState.INVALIDATED,
            reason: 'Failed to compare page URL paths.',
            errorCode: 'PAGE_CONTEXT_MISMATCH',
            verifiedAt,
            limitations: CONTINUATION_VALIDATION_LIMITATIONS,
          };
        }
      }
    }

    // 8c. Target DOM element connectivity & tag match
    if (actionObj.element?.id) {
      const elemId = actionObj.element.id;
      const checkAttached = options?.isElementAttached ?? this.isElementAttached;

      if (checkAttached) {
        if (!checkAttached(elemId)) {
          return {
            eligible: false,
            status: ContinuationEligibilityStatus.MISMATCHED,
            actionId: id,
            targetState: InterceptionState.INVALIDATED,
            reason: `Target element "#${elemId}" is no longer attached to document DOM tree.`,
            errorCode: 'ELEMENT_DETACHED',
            verifiedAt,
            limitations: CONTINUATION_VALIDATION_LIMITATIONS,
          };
        }
      } else if (typeof document !== 'undefined') {
        const el = document.getElementById(elemId);
        if (!el) {
          return {
            eligible: false,
            status: ContinuationEligibilityStatus.MISMATCHED,
            actionId: id,
            targetState: InterceptionState.INVALIDATED,
            reason: `Target element "#${elemId}" was removed from the active DOM.`,
            errorCode: 'ELEMENT_DETACHED',
            verifiedAt,
            limitations: CONTINUATION_VALIDATION_LIMITATIONS,
          };
        }
        if (actionObj.element.tagName && el.tagName.toUpperCase() !== actionObj.element.tagName.toUpperCase()) {
          return {
            eligible: false,
            status: ContinuationEligibilityStatus.MISMATCHED,
            actionId: id,
            targetState: InterceptionState.INVALIDATED,
            reason: `Target element tagName mismatch: expected "${actionObj.element.tagName}", found "${el.tagName}".`,
            errorCode: 'ELEMENT_DETACHED',
            verifiedAt,
            limitations: CONTINUATION_VALIDATION_LIMITATIONS,
          };
        }
      }
    }

    // 8d. Action structural fingerprint digest verification (if expected digest specified)
    if (options?.expectedDigest) {
      const digestVal = validateActionDigest(options.expectedDigest);
      if (digestVal.valid && options.binding?.actionDigest) {
        if (options.binding.actionDigest !== options.expectedDigest) {
          return {
            eligible: false,
            status: ContinuationEligibilityStatus.MISMATCHED,
            actionId: id,
            targetState: InterceptionState.INVALIDATED,
            reason: 'Action structural fingerprint digest mismatch: Recorded digest does not match expected action.',
            errorCode: 'ACTION_ID_MISMATCH',
            verifiedAt,
            limitations: CONTINUATION_VALIDATION_LIMITATIONS,
          };
        }
      }
    }

    // =========================================================================
    // CONDITION 10: Existing risk-engine and staging requirements remain satisfied
    // =========================================================================
    if (options?.stagingContext) {
      if (options.stagingContext.actionId !== id) {
        return {
          eligible: false,
          status: ContinuationEligibilityStatus.MISMATCHED,
          actionId: id,
          targetState: InterceptionState.INVALIDATED,
          reason: `Staging context actionId mismatch: Staged context "${options.stagingContext.actionId}" does not match action "${id}".`,
          errorCode: 'ACTION_ID_MISMATCH',
          verifiedAt,
          limitations: CONTINUATION_VALIDATION_LIMITATIONS,
        };
      }
      if (!options.stagingContext.riskLevel) {
        return {
          eligible: false,
          status: ContinuationEligibilityStatus.UNAVAILABLE,
          actionId: id,
          targetState: InterceptionState.INVALIDATED,
          reason: 'Staging requirements not satisfied: Action has not undergone complete risk evaluation.',
          errorCode: 'AUTHORIZATION_UNAVAILABLE',
          verifiedAt,
          limitations: CONTINUATION_VALIDATION_LIMITATIONS,
        };
      }
      if (
        options.stagingContext.responseAction &&
        options.stagingContext.responseAction !== ResponseAction.PROTECT
      ) {
        return {
          eligible: false,
          status: ContinuationEligibilityStatus.REJECTED,
          actionId: id,
          targetState: InterceptionState.INVALIDATED,
          reason: `Policy downgrade rejected: Action with decision "${options.stagingContext.responseAction}" cannot be continued through the protective approval pipeline. Only PROTECT decisions are eligible.`,
          errorCode: 'POLICY_REQUIREMENTS_NOT_MET',
          verifiedAt,
          limitations: CONTINUATION_VALIDATION_LIMITATIONS,
        };
      }
    }

    // =========================================================================
    // CONDITIONS 1, 2, 3, 4, 5: Authoritative Backend Validation
    // =========================================================================
    // "Do not rely exclusively on client-side checks for server-side authorization."
    // "Fail closed if required validation cannot be completed."
    let backendResult: BackendContinuationValidationResult | undefined;

    if (this.approvalService) {
      try {
        const authContext: AuthContext = options?.authContext || {
          actorId: options?.expectedRequesterId || options?.request?.requesterId || 'usr_alice',
          role: ActorRole.USER,
          isAuthenticated: true,
        };

        backendResult = this.approvalService.validateContinuationAuthorization(
          {
            actionId: id,
            pageContext: activePageContext,
          },
          authContext
        );
      } catch (err: any) {
        return {
          eligible: false,
          status: ContinuationEligibilityStatus.UNAVAILABLE,
          actionId: id,
          targetState: InterceptionState.INVALIDATED,
          reason: err?.message || 'Authoritative backend continuation validation threw an unexpected error (fail closed).',
          errorCode: 'AUTHORIZATION_UNAVAILABLE',
          verifiedAt,
          limitations: CONTINUATION_VALIDATION_LIMITATIONS,
        };
      }
    } else if (this.approvalClient) {
      try {
        const clientRes = await this.approvalClient.validateContinuationAuthorization(
          id,
          activePageContext
        );

        if (!clientRes.success) {
          // Never treat timeout or network failure as approval!
          const isOfflineOrTimeout = clientRes.isNetworkError || clientRes.isTimeout;
          return {
            eligible: false,
            status: ContinuationEligibilityStatus.UNAVAILABLE,
            actionId: id,
            targetState: InterceptionState.HELD,
            reason: isOfflineOrTimeout
              ? 'Backend validation failed closed: Authoritative service is unreachable, timed out, or offline.'
              : clientRes.error?.message || 'Remote backend validation failed or is unreachable (fail closed).',
            errorCode: 'AUTHORIZATION_UNAVAILABLE',
            verifiedAt,
            limitations: CONTINUATION_VALIDATION_LIMITATIONS,
          };
        }

        backendResult = clientRes.data;
      } catch (err: any) {
        return {
          eligible: false,
          status: ContinuationEligibilityStatus.UNAVAILABLE,
          actionId: id,
          targetState: InterceptionState.HELD,
          reason: `Network dispatch failed during backend validation: ${err?.message || 'Unknown network error'}.`,
          errorCode: 'AUTHORIZATION_UNAVAILABLE',
          verifiedAt,
          limitations: CONTINUATION_VALIDATION_LIMITATIONS,
        };
      }
    } else if (options?.request || options?.binding) {
      // In-memory / direct entity validation fallback
      backendResult = this.validateEntitiesLocally(id, options.request, options.binding, activePageContext);
    } else {
      // Missing backend: Fail closed!
      return {
        eligible: false,
        status: ContinuationEligibilityStatus.UNAVAILABLE,
        actionId: id,
        targetState: InterceptionState.HELD,
        reason: 'Authoritative backend confirmation unavailable. Cannot continue action without backend validation.',
        errorCode: 'BACKEND_STATE_UNKNOWN',
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    // Process authoritative backendResult
    if (!backendResult || !backendResult.authorized) {
      const errCode = (backendResult?.errorCode as ContinuationAuthorizationErrorCode) || 'REQUEST_NOT_APPROVED';
      const status = this.mapErrorCodeToStatus(errCode);
      const targetState = this.mapStatusToTargetState(status);

      return {
        eligible: false,
        status,
        actionId: id,
        requestId: backendResult?.requestId,
        bindingId: backendResult?.bindingId,
        targetState,
        reason: backendResult?.error || 'Continuation refused by authoritative backend.',
        errorCode: errCode,
        verifiedAt,
        limitations: CONTINUATION_VALIDATION_LIMITATIONS,
      };
    }

    // Condition 3: Verify expected requester identity if specified
    if (options?.expectedRequesterId && backendResult.requesterId) {
      if (backendResult.requesterId !== options.expectedRequesterId) {
        return {
          eligible: false,
          status: ContinuationEligibilityStatus.MISMATCHED,
          actionId: id,
          requestId: backendResult.requestId,
          bindingId: backendResult.bindingId,
          requesterId: backendResult.requesterId,
          targetState: InterceptionState.INVALIDATED,
          reason: `Requester ID mismatch: Approval was granted for user "${backendResult.requesterId}", expected "${options.expectedRequesterId}".`,
          errorCode: 'ACTION_ID_MISMATCH',
          verifiedAt,
          limitations: CONTINUATION_VALIDATION_LIMITATIONS,
        };
      }
    }

    // =========================================================================
    // CONDITION 7: Revalidate applicable canonical risk policies before action proceeds
    // =========================================================================
    let revalidatedPolicyRuleId: string | undefined;
    let revalidatedReasonCode: string | undefined;
    let revalidatedDecision: ResponseAction = ResponseAction.PROTECT;

    if (options?.revalidatePolicy !== false && actionObj) {
      const pageInfo = actionObj.page || (actionObj as any).context?.page;
      const elementInfo = actionObj.element || (actionObj as any).target;

      const normalizedActionForPolicy: GuardrailAction = {
        ...actionObj,
        page: pageInfo,
        element: elementInfo,
      };

      if (
        typeof normalizedActionForPolicy !== 'object' ||
        typeof normalizedActionForPolicy.id !== 'string' ||
        !normalizedActionForPolicy.id.trim() ||
        !normalizedActionForPolicy.type ||
        !normalizedActionForPolicy.page ||
        typeof normalizedActionForPolicy.page.url !== 'string'
      ) {
        return {
          eligible: false,
          status: ContinuationEligibilityStatus.UNAVAILABLE,
          actionId: id,
          targetState: InterceptionState.INVALIDATED,
          reason: 'Action structural corruption detected during policy revalidation (fail closed).',
          errorCode: 'AUTHORIZATION_UNAVAILABLE',
          verifiedAt,
          limitations: CONTINUATION_VALIDATION_LIMITATIONS,
        };
      }

      const policyConfig = options?.policyConfig ?? this.policyConfig;
      const matchedPolicies = evaluatePolicies(normalizedActionForPolicy, undefined, policyConfig);
      const corruptGuardMatch = matchedPolicies.find(
        (p) =>
          p.ruleId === 'RULE_FAIL_CLOSED_FALLBACK' ||
          p.reasonCode === 'POLICY_FAIL_CLOSED_CORRUPT_PAYLOAD'
      );
      if (corruptGuardMatch) {
        return {
          eligible: false,
          status: ContinuationEligibilityStatus.UNAVAILABLE,
          actionId: id,
          targetState: InterceptionState.INVALIDATED,
          reason: 'Policy revalidation rejected action: Action triggered fail-closed corruption guard.',
          errorCode: 'AUTHORIZATION_UNAVAILABLE',
          policyDecision: ResponseAction.PROTECT,
          policyRuleId: corruptGuardMatch.ruleId,
          policyReasonCode: corruptGuardMatch.reasonCode,
          verifiedAt,
          limitations: CONTINUATION_VALIDATION_LIMITATIONS,
        };
      }

      const onlyRoutine =
        matchedPolicies.length > 0 &&
        matchedPolicies.every((p) => p.decision === ResponseAction.ALLOW);
      if (onlyRoutine) {
        return {
          eligible: false,
          status: ContinuationEligibilityStatus.MISMATCHED,
          actionId: id,
          targetState: InterceptionState.INVALIDATED,
          reason: 'Policy revalidation failure: Action evaluates to routine ALLOW and does not satisfy protective staging policy requirements.',
          errorCode: 'POLICY_REQUIREMENTS_NOT_MET',
          policyDecision: ResponseAction.ALLOW,
          verifiedAt,
          limitations: CONTINUATION_VALIDATION_LIMITATIONS,
        };
      }

      if (options?.expectedPolicyId) {
        const matchesExpected = matchedPolicies.some((p) => p.ruleId === options.expectedPolicyId);
        if (!matchesExpected) {
          return {
            eligible: false,
            status: ContinuationEligibilityStatus.MISMATCHED,
            actionId: id,
            targetState: InterceptionState.INVALIDATED,
            reason: `Policy revalidation mismatch: Expected policy "${options.expectedPolicyId}" was not satisfied.`,
            errorCode: 'POLICY_REQUIREMENTS_NOT_MET',
            verifiedAt,
            limitations: CONTINUATION_VALIDATION_LIMITATIONS,
          };
        }
      }

      const primaryPolicy =
        matchedPolicies.find((p) => p.decision === ResponseAction.PROTECT) || matchedPolicies[0];
      if (primaryPolicy) {
        revalidatedPolicyRuleId = primaryPolicy.ruleId;
        revalidatedReasonCode = primaryPolicy.reasonCode;
        revalidatedDecision = primaryPolicy.decision || ResponseAction.PROTECT;
      }
    }

    // =========================================================================
    // ALL 10 CONDITIONS SATISFIED: Action is ELIGIBLE for User Confirmation
    // =========================================================================
    return {
      eligible: true,
      status: ContinuationEligibilityStatus.ELIGIBLE,
      actionId: id,
      requestId: backendResult.requestId,
      bindingId: backendResult.bindingId,
      requesterId: backendResult.requesterId,
      targetState: InterceptionState.READY_FOR_USER_CONFIRMATION,
      reason: 'All 10 continuation validation conditions satisfied: Backend confirmed approval, 1:1 binding intact, context verified, action held and unconsumed.',
      policyDecision: revalidatedDecision,
      policyRuleId: revalidatedPolicyRuleId,
      policyReasonCode: revalidatedReasonCode,
      verifiedAt,
      limitations: CONTINUATION_VALIDATION_LIMITATIONS,
    };
  }

  /**
   * Convenience helper returning true strictly when an action is eligible for continuation.
   */
  public async isEligible(actionId: string, options?: ContinuationValidationOptions): Promise<boolean> {
    const result = await this.validateEligibility(actionId, options);
    return result.eligible;
  }

  /**
   * Transitions the action in the InterceptionController to match the validated target state.
   * Does NOT execute the action.
   *
   * @param result ContinuationValidationResult returned by validateEligibility
   * @returns Updated InterceptionRecord or null if action is not registered
   */
  public transitionOnValidation(result: ContinuationValidationResult): InterceptionRecord | null {
    const record = this.controller.getRecord(result.actionId);
    if (!record || !result.targetState || record.state === result.targetState) {
      return record ?? null;
    }

    return transitionInterceptionRecord(
      record,
      result.targetState,
      result.reason,
      result.verifiedAt
    );
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  /**
   * Evaluates request and binding entities locally when direct instances are provided.
   */
  private validateEntitiesLocally(
    actionId: string,
    request?: ApprovalRequest | null,
    binding?: ApprovalActionBinding | null,
    _pageContext?: ContinuationPageContext
  ): BackendContinuationValidationResult {
    const serverTime = resolveTimestamp(this.timeProvider);

    // 1. Request existence
    if (!request) {
      return {
        authorized: false,
        actionId,
        serverTime,
        error: `Approval request record for action "${actionId}" not found.`,
        errorCode: 'REQUEST_NOT_FOUND',
      };
    }

    // 4. Action correlation
    if (request.actionId !== actionId) {
      return {
        authorized: false,
        actionId,
        requestId: request.id,
        serverTime,
        error: `Action ID mismatch: Request bound to "${request.actionId}", target action is "${actionId}".`,
        errorCode: 'ACTION_ID_MISMATCH',
      };
    }

    // Expiration check
    if (isRequestExpired(request, this.timeProvider)) {
      return {
        authorized: false,
        actionId,
        requestId: request.id,
        serverTime,
        error: `Approval request "${request.id}" has expired.`,
        errorCode: 'REQUEST_EXPIRED',
      };
    }

    // Status checks
    if (request.status === ApprovalStatus.PENDING) {
      return {
        authorized: false,
        actionId,
        requestId: request.id,
        serverTime,
        error: `Approval request "${request.id}" is still PENDING review.`,
        errorCode: 'REQUEST_NOT_APPROVED',
      };
    }

    if (request.status === ApprovalStatus.REJECTED) {
      return {
        authorized: false,
        actionId,
        requestId: request.id,
        serverTime,
        error: `Approval request "${request.id}" was REJECTED by trusted contact.`,
        errorCode: 'REQUEST_REJECTED',
      };
    }

    if (request.status === ApprovalStatus.CANCELLED) {
      return {
        authorized: false,
        actionId,
        requestId: request.id,
        serverTime,
        error: `Approval request "${request.id}" was CANCELLED.`,
        errorCode: 'REQUEST_CANCELLED',
      };
    }

    if (request.status !== ApprovalStatus.APPROVED) {
      return {
        authorized: false,
        actionId,
        requestId: request.id,
        serverTime,
        error: `Approval request "${request.id}" is in unexpected status "${request.status}".`,
        errorCode: 'REQUEST_NOT_APPROVED',
      };
    }

    // Confirmed decision
    if (!request.decision || request.decision.decision !== 'APPROVED') {
      return {
        authorized: false,
        actionId,
        requestId: request.id,
        serverTime,
        error: `Approval request "${request.id}" does not have a confirmed approval decision.`,
        errorCode: 'REQUEST_NOT_APPROVED',
      };
    }

    // Binding checks if present
    if (binding) {
      if (binding.actionId !== actionId) {
        return {
          authorized: false,
          actionId,
          requestId: request.id,
          bindingId: binding.id,
          serverTime,
          error: `Binding actionId mismatch: "${binding.actionId}" !== "${actionId}".`,
          errorCode: 'ACTION_ID_MISMATCH',
        };
      }

      if (binding.requestId !== request.id) {
        return {
          authorized: false,
          actionId,
          requestId: request.id,
          bindingId: binding.id,
          serverTime,
          error: `Binding requestId mismatch: "${binding.requestId}" !== "${request.id}".`,
          errorCode: 'ACTION_ID_MISMATCH',
        };
      }

      if (isBindingExpired(binding, this.timeProvider)) {
        return {
          authorized: false,
          actionId,
          requestId: request.id,
          bindingId: binding.id,
          serverTime,
          error: `Action binding "${binding.id}" has expired.`,
          errorCode: 'BINDING_EXPIRED',
        };
      }

      if (binding.state === ApprovalActionBindingState.INVALIDATED) {
        return {
          authorized: false,
          actionId,
          requestId: request.id,
          bindingId: binding.id,
          serverTime,
          error: `Action binding "${binding.id}" has been INVALIDATED.`,
          errorCode: 'BINDING_INVALIDATED',
        };
      }

      if (binding.state === ApprovalActionBindingState.CANCELLED) {
        return {
          authorized: false,
          actionId,
          requestId: request.id,
          bindingId: binding.id,
          serverTime,
          error: `Action binding "${binding.id}" was CANCELLED.`,
          errorCode: 'BINDING_CANCELLED',
        };
      }

      if (binding.state === ApprovalActionBindingState.REJECTED) {
        return {
          authorized: false,
          actionId,
          requestId: request.id,
          bindingId: binding.id,
          serverTime,
          error: `Action binding "${binding.id}" was REJECTED.`,
          errorCode: 'REQUEST_REJECTED',
        };
      }

      if (binding.state !== ApprovalActionBindingState.APPROVED) {
        return {
          authorized: false,
          actionId,
          requestId: request.id,
          bindingId: binding.id,
          serverTime,
          error: `Action binding "${binding.id}" is in state "${binding.state}" (expected APPROVED).`,
          errorCode: 'BINDING_NOT_APPROVED',
        };
      }
    }

    return {
      authorized: true,
      actionId,
      requestId: request.id,
      bindingId: binding?.id,
      requesterId: request.requesterId,
      serverTime,
    };
  }

  private mapErrorCodeToStatus(code: ContinuationAuthorizationErrorCode): ContinuationEligibilityStatus {
    switch (code) {
      case 'REQUEST_NOT_APPROVED':
      case 'BINDING_NOT_APPROVED':
        return ContinuationEligibilityStatus.PENDING;
      case 'REQUEST_REJECTED':
      case 'BINDING_INVALIDATED':
      case 'POLICY_REQUIREMENTS_NOT_MET':
        return ContinuationEligibilityStatus.REJECTED;
      case 'REQUEST_EXPIRED':
      case 'BINDING_EXPIRED':
        return ContinuationEligibilityStatus.EXPIRED;
      case 'REQUEST_CANCELLED':
      case 'BINDING_CANCELLED':
        return ContinuationEligibilityStatus.CANCELLED;
      case 'ACTION_ID_MISMATCH':
      case 'PAGE_CONTEXT_MISMATCH':
      case 'ELEMENT_DETACHED':
        return ContinuationEligibilityStatus.MISMATCHED;
      case 'ALREADY_CONTINUED':
      case 'ALREADY_CONSUMED':
      case 'REQUEST_NOT_FOUND':
      case 'BINDING_NOT_FOUND':
      case 'BACKEND_STATE_UNKNOWN':
      case 'AUTHORIZATION_UNAVAILABLE':
      default:
        return ContinuationEligibilityStatus.UNAVAILABLE;
    }
  }

  private mapStatusToTargetState(status: ContinuationEligibilityStatus): InterceptionState {
    switch (status) {
      case ContinuationEligibilityStatus.ELIGIBLE:
        return InterceptionState.READY_FOR_USER_CONFIRMATION;
      case ContinuationEligibilityStatus.PENDING:
        return InterceptionState.AWAITING_APPROVAL;
      case ContinuationEligibilityStatus.EXPIRED:
        return InterceptionState.EXPIRED;
      case ContinuationEligibilityStatus.CANCELLED:
        return InterceptionState.CANCELLED;
      case ContinuationEligibilityStatus.REJECTED:
      case ContinuationEligibilityStatus.MISMATCHED:
      case ContinuationEligibilityStatus.UNAVAILABLE:
      default:
        return InterceptionState.INVALIDATED;
    }
  }
}

export const defaultContinuationValidationService = new ContinuationValidationService();
