/**
 * Guardrail Trusted-Contact Dashboard - Type Definitions
 *
 * Defines the UI state, navigation views, and component interfaces for the
 * trusted-contact dashboard shell.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Reuses authoritative domain models from `guardrail/extension/src/types/`.
 * 2. Does NOT invent fake metrics, approval counts, or simulated user data.
 * 3. Enforces strict separation of concerns: decisions are decoupled from browser action execution.
 */

import {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalDecisionMetadata,
} from '../../extension/src/types/approval.js';
import { ActionCategory, ActionType } from '../../extension/src/types/actions.js';
import { RiskLevel } from '../../extension/src/types/risk.js';
import { ActorRole, AuthContext } from '../../extension/src/approval/authorization.js';
import {
  ApprovalApiClient,
  ApiClientResult,
  ApiClientError,
  ApiClientErrorCodes,
} from '../../extension/src/approval/client.js';

export type {
  ApprovalRequest,
  ApprovalDecisionMetadata,
  AuthContext,
  ApiClientResult,
  ApiClientError,
};
export {
  ApprovalStatus,
  ActionCategory,
  ActionType,
  RiskLevel,
  ActorRole,
  ApprovalApiClient,
  ApiClientErrorCodes,
};

/**
 * Top-level navigation views available in the dashboard shell.
 */
export type DashboardView = 'overview' | 'pending' | 'history';

/**
 * Loading and error states for dashboard data panels.
 */
export type ViewStatus = 'idle' | 'loading' | 'empty' | 'error';

/**
 * Profile representation of the authenticated trusted contact.
 */
export interface TrustedContactProfile {
  /** Canonical actor identifier (e.g., 'tc_carol') */
  readonly actorId: string;
  /** Role in the Guardrail authorization hierarchy */
  readonly role: ActorRole | string;
  /** Primary assigned ward identifier, if established */
  readonly assignedWardId?: string;
  /** Human-readable relationship label, if configured */
  readonly relationshipLabel?: string;
  /** True if session is authenticated by the server */
  readonly isAuthenticated: boolean;
}

/**
 * Overall programmatic state of the dashboard shell.
 */
export interface DashboardShellState {
  /** Currently active view */
  activeView: DashboardView;
  /** Profile of the reviewing contact */
  contactProfile: TrustedContactProfile | null;
  /** List of pending requests available for review */
  pendingRequests: readonly ApprovalRequest[];
  /** Identifier of the currently selected request in the detail pane */
  selectedRequestId: string | null;
  /** Status of the pending approvals view (idle, loading, empty, error) */
  pendingStatus: ViewStatus;
  /** Optional error message displayed in the error banner */
  errorMessage: string | null;
}

/**
 * Configuration options for initializing the dashboard shell.
 */
export interface DashboardShellOptions {
  /** Target container element or selector where dashboard mounts */
  container: HTMLElement | string;
  /** Initial view to display (defaults to 'overview') */
  initialView?: DashboardView;
  /** Initial trusted contact profile (from AuthContext or null) */
  initialProfile?: TrustedContactProfile | null;
  /** Initial pending requests list (if preloaded) */
  initialRequests?: readonly ApprovalRequest[];
  /** API client instance for remote backend requests */
  apiClient?: ApprovalApiClient;
  /** Automatically fetch pending requests upon mounting or view switch (defaults to false) */
  autoFetch?: boolean;
  /** Optional background polling interval in milliseconds (0 or undefined disables polling) */
  pollIntervalMs?: number;
}
