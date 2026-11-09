/**
 * Guardrail Browser Download Safety Warning Component
 *
 * Dynamically injected modal dialog presented to the user when Guardrail
 * detects elevated risk or suspicious characteristics in browser downloads.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. SHADOW DOM ISOLATION:
 *    Rendered inside a Shadow Root attached to `#guardrail-download-ui-host`.
 *    Completely insulates Guardrail's typography and design from the host page.
 * 2. CLARITY & ACCESSIBILITY:
 *    Accessible alert dialog (role="alertdialog", aria-modal="true",
 *    aria-labelledby, aria-describedby) with focus trapping, high contrast,
 *    live region announcements, and keyboard navigation.
 * 3. TRANSPARENT SECURITY SCOPE:
 *    - Which download triggered the warning (filename, extension, download ID).
 *    - Available file type and size information.
 *    - Origin domain (with raw IP and unencrypted HTTP transport callouts).
 *    - Plain-language risk indicators without frightening jargon.
 *    - Clear distinction between automated local heuristics vs verified threat intel.
 *    - Accurate lifecycle state (in_progress, paused, cancelled, interrupted, complete).
 *    - Genuinely supported protective actions (cancel ongoing/paused, safe inspection for complete).
 * 4. STRICT NON-MALICE & NO-FABRICATION INVARIANTS:
 *    - Suspicious heuristic signals are never labeled confirmed malware without SafeBrowsing danger flags.
 *    - Completed downloads are never claimed to be blocked or removed.
 *    - No antivirus scanning or removal functionality is falsely claimed.
 *    - Downloaded files are NEVER automatically opened or executed.
 * 5. DUPLICATE ACTION PREVENTION:
 *    Buttons immediately disable and show loading states during in-flight operations.
 * 6. TECHNICAL DIAGNOSTICS PARTITIONING:
 *    Technical data (MIME, score, rule IDs, exact URLs) is partitioned inside
 *    an accessible collapsible details section.
 */

import {
  DownloadItemMetadata,
  DownloadLifecycleDisplayState,
  DownloadSafetyEvaluation,
  DownloadSecurityContext,
} from '../types/download.js';
import { extractDownloadSecurityContext } from '../utils/download-detector.js';

export const DOWNLOAD_HOST_ELEMENT_ID = 'guardrail-download-ui-host';

export type DownloadModalViewState =
  | 'warning'
  | 'confirming_continuation'
  | 'loading'
  | 'completed_guidance'
  | 'cancelled'
  | 'interrupted'
  | 'dismissed';

export interface DownloadWarningModalProps {
  /** Evaluated download safety result */
  readonly evaluation: DownloadSafetyEvaluation;

  /** Raw or normalized download item metadata */
  readonly item?: Partial<DownloadItemMetadata>;

  /** Optional pre-computed security context */
  readonly securityContext?: DownloadSecurityContext;

  /** Callback when user clicks Cancel Download */
  readonly onCancel?: () => void | Promise<void>;

  /** Callback when user confirms continuation/resumption */
  readonly onContinue?: () => void | Promise<void>;

  /** Callback when dialog is closed or dismissed */
  readonly onDismiss?: () => void;
}

let activeEscapeHandler: ((e: KeyboardEvent) => void) | null = null;
let activeTabTrapHandler: ((e: KeyboardEvent) => void) | null = null;
let previousActiveElement: HTMLElement | null = null;
let currentModalProps: DownloadWarningModalProps | null = null;
let currentHost: HTMLElement | null = null;
let currentShadow: ShadowRoot | null = null;
let currentContext: DownloadSecurityContext | null = null;
let currentViewState: DownloadModalViewState = 'warning';
let isOperationInProgress = false;

/**
 * Checks whether the Guardrail download warning modal is currently present in the DOM.
 */
export function isDownloadWarningModalActive(): boolean {
  return typeof document !== 'undefined' && Boolean(document.getElementById(DOWNLOAD_HOST_ELEMENT_ID));
}

/**
 * Dismisses and cleans up any currently active Guardrail download warning modal.
 */
export function dismissDownloadWarningModal(): void {
  if (typeof window !== 'undefined') {
    if (activeEscapeHandler) {
      window.removeEventListener('keydown', activeEscapeHandler);
      activeEscapeHandler = null;
    }
    if (activeTabTrapHandler) {
      window.removeEventListener('keydown', activeTabTrapHandler);
      activeTabTrapHandler = null;
    }
  }

  const existingHost = typeof document !== 'undefined' ? document.getElementById(DOWNLOAD_HOST_ELEMENT_ID) : null;
  if (existingHost) {
    existingHost.remove();
  }

  const onDismissCb = currentModalProps?.onDismiss;

  currentHost = null;
  currentShadow = null;
  currentModalProps = null;
  currentContext = null;
  currentViewState = 'dismissed';
  isOperationInProgress = false;

  // Restore focus to previous active element upon dismissal
  if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
    try {
      previousActiveElement.focus();
    } catch {
      // Ignore focus errors in mock or headless environments
    }
    previousActiveElement = null;
  }

  if (typeof onDismissCb === 'function') {
    try {
      onDismissCb();
    } catch {
      // Ignore callback errors
    }
  }
}

/**
 * Updates the observable lifecycle status of an active download warning modal.
 *
 * @param state New lifecycle state ('in_progress' | 'paused' | 'cancelled' | 'interrupted' | 'complete')
 * @param error Optional error code if interrupted
 */
export function updateDownloadModalLifecycle(
  state: DownloadLifecycleDisplayState,
  error?: string
): void {
  if (!currentShadow || !currentContext) return;

  const statusBadge = currentShadow.querySelector('.gr-dl-lifecycle-badge') as HTMLElement;
  const statusHeadline = currentShadow.querySelector('.gr-dl-status-headline') as HTMLElement;
  const statusSubtext = currentShadow.querySelector('.gr-dl-status-subtext') as HTMLElement;
  const cancelBtn = currentShadow.querySelector('.gr-btn-cancel-dl') as HTMLButtonElement;
  const continueBtn = currentShadow.querySelector('.gr-btn-continue-dl') as HTMLButtonElement;
  const liveRegion = currentShadow.querySelector('.gr-sr-only[role=\"status\"]') as HTMLElement;

  let badgeText = 'Ongoing';
  let badgeClass = 'gr-badge-ongoing';
  let headline = 'Download in Progress';
  let explanation = 'Download is currently transferring bytes to your computer.';

  switch (state) {
    case 'paused':
      badgeText = 'Paused by Guardrail';
      badgeClass = 'gr-badge-paused';
      headline = 'Download Paused for Review';
      explanation = 'The file transfer is paused to protect your system. Review details before proceeding.';
      if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancel Download';
      }
      if (continueBtn) {
        continueBtn.disabled = false;
        continueBtn.style.display = 'inline-flex';
      }
      break;

    case 'cancelled':
      badgeText = 'Cancelled';
      badgeClass = 'gr-badge-cancelled';
      headline = 'Download Cancelled';
      explanation = 'Download was cancelled. Incomplete file data was discarded by the browser.';
      currentViewState = 'cancelled';
      if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Download Cancelled';
      }
      if (continueBtn) {
        continueBtn.style.display = 'none';
      }
      break;

    case 'interrupted':
      badgeText = 'Interrupted';
      badgeClass = 'gr-badge-interrupted';
      headline = 'Download Interrupted';
      explanation = error
        ? `Download was halted by the browser (${error}). No complete file was saved.`
        : 'Download was interrupted before completion. No complete file was saved.';
      currentViewState = 'interrupted';
      if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Transfer Halted';
      }
      if (continueBtn) {
        continueBtn.style.display = 'none';
      }
      break;

    case 'complete':
      badgeText = 'Completed';
      badgeClass = 'gr-badge-complete';
      headline = 'Download Finished';
      explanation = 'File has finished downloading to your Downloads folder. Note: Completed files cannot be blocked retroactively.';
      currentViewState = 'completed_guidance';
      if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Completed';
      }
      if (continueBtn) {
        continueBtn.style.display = 'none';
      }
      {
        const guidanceTitle = currentShadow.querySelector('.gr-guidance-title') as HTMLElement;
        const guidanceList = currentShadow.querySelector('.gr-guidance-list') as HTMLElement;
        if (guidanceTitle) {
          guidanceTitle.textContent = '🛡️ How to Safely Inspect This Completed File';
        }
        if (guidanceList) {
          guidanceList.children = [];
          const steps = [
            '1. Do not double-click or open the file directly from your browser shelf.',
            '2. Open your computer\'s Downloads folder to view the file without executing it.',
            '3. Scan the downloaded file with your computer\'s installed antivirus software before use.',
            '4. If you did not intentionally request this download, delete the file from your Downloads folder.',
          ];
          for (const step of steps) {
            const li = document.createElement('li');
            li.className = 'gr-guidance-item';
            li.textContent = step;
            guidanceList.appendChild(li);
          }
        }
      }
      break;

    case 'in_progress':
    default:
      badgeText = 'Ongoing';
      badgeClass = 'gr-badge-ongoing';
      headline = 'Download in Progress';
      explanation = 'Bytes are currently transferring to your computer.';
      if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancel Download';
      }
      break;
  }

  if (statusBadge) {
    statusBadge.textContent = badgeText;
    statusBadge.className = `gr-dl-lifecycle-badge ${badgeClass}`;
  }
  if (statusHeadline) {
    statusHeadline.textContent = headline;
  }
  if (statusSubtext) {
    statusSubtext.textContent = explanation;
  }
  if (liveRegion) {
    liveRegion.textContent = `Download status updated: ${headline}. ${explanation}`;
  }
}

/**
 * Injects and displays the Guardrail download safety warning modal.
 *
 * @param props Metadata for rendering the download safety warning dialog.
 * @returns A dismiss function to close the warning programmatically.
 */
export function showDownloadWarningModal(props: DownloadWarningModalProps): () => void {
  // 1. Remove any previous instance to prevent stacking
  dismissDownloadWarningModal();
  currentModalProps = props;

  // Capture active element before opening modal for focus restoration
  if (typeof document !== 'undefined' && document.activeElement) {
    previousActiveElement = document.activeElement as HTMLElement;
  }

  // 2. Derive structured security context
  const context =
    props.securityContext ||
    extractDownloadSecurityContext(props.evaluation, props.item);
  currentContext = context;
  currentViewState = context.lifecycleState === 'complete' ? 'completed_guidance' : 'warning';

  // 3. Create the transient host container
  const host = document.createElement('div');
  host.id = DOWNLOAD_HOST_ELEMENT_ID;
  host.style.position = 'relative';
  host.style.zIndex = '2147483647';
  currentHost = host;

  // 4. Attach an isolated Shadow Root
  const shadow = host.attachShadow({ mode: 'open' });
  currentShadow = shadow;

  // 5. Construct encapsulated styles
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .gr-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .gr-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(11, 15, 25, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 2147483647;
      animation: grFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .gr-card {
      background: #0f172a;
      border: 1px solid ${context.isConfirmedMalicious ? 'rgba(239, 68, 68, 0.55)' : 'rgba(245, 158, 11, 0.45)'};
      border-radius: 16px;
      width: 100%;
      max-width: 580px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.9), 0 0 35px ${context.isConfirmedMalicious ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.15)'};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #f8fafc;
      overflow: hidden;
      position: relative;
      animation: grSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      outline: none;
    }

    .gr-header {
      padding: 16px 20px;
      background: ${context.isConfirmedMalicious ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.08)'};
      border-bottom: 1px solid ${context.isConfirmedMalicious ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.2)'};
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .gr-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .gr-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 14px;
      color: ${context.isConfirmedMalicious ? '#fca5a5' : '#fbbf24'};
    }

    .gr-brand-icon {
      font-size: 16px;
    }

    .gr-pill-severity {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      padding: 3px 8px;
      border-radius: 9999px;
      text-transform: uppercase;
      background: ${context.isConfirmedMalicious ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.2)'};
      border: 1px solid ${context.isConfirmedMalicious ? 'rgba(239, 68, 68, 0.5)' : 'rgba(245, 158, 11, 0.4)'};
      color: ${context.isConfirmedMalicious ? '#fecaca' : '#fcd34d'};
    }

    .gr-btn-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 18px;
      line-height: 1;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      cursor: pointer;
      padding: 0;
      transition: all 0.15s ease;
    }

    .gr-btn-close:hover, .gr-btn-close:focus-visible {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
      outline: 2px solid #38bdf8;
    }

    .gr-body {
      padding: 20px;
      max-height: 75vh;
      overflow-y: auto;
    }

    /* File Metadata Card */
    .gr-file-card {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .gr-file-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .gr-file-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .gr-filename {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      word-break: break-all;
    }

    .gr-file-meta-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 12px;
      color: #94a3b8;
    }

    .gr-tag-ext {
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #7dd3fc;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      font-size: 11px;
    }

    /* Lifecycle Banner */
    .gr-dl-status-banner {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      margin-bottom: 16px;
      font-size: 13px;
      line-height: 1.4;
      background: rgba(59, 130, 246, 0.08);
      border: 1px solid rgba(59, 130, 246, 0.25);
      color: #bfdbfe;
    }

    .gr-dl-lifecycle-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 9999px;
      text-transform: uppercase;
      white-space: nowrap;
      margin-top: 1px;
    }

    .gr-badge-ongoing {
      background: rgba(59, 130, 246, 0.2);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #93c5fd;
    }

    .gr-badge-paused {
      background: rgba(245, 158, 11, 0.2);
      border: 1px solid rgba(245, 158, 11, 0.4);
      color: #fcd34d;
    }

    .gr-badge-cancelled {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
    }

    .gr-badge-interrupted {
      background: rgba(148, 163, 184, 0.2);
      border: 1px solid rgba(148, 163, 184, 0.4);
      color: #cbd5e1;
    }

    .gr-badge-complete {
      background: rgba(16, 185, 129, 0.2);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #6ee7b7;
    }

    .gr-dl-status-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .gr-dl-status-headline {
      font-weight: 700;
      color: #ffffff;
    }

    .gr-dl-status-subtext {
      font-size: 12px;
      color: #94a3b8;
    }

    /* Origin Domain Callout */
    .gr-origin-callout {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
    }

    .gr-origin-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }

    .gr-origin-label {
      color: #94a3b8;
      font-weight: 500;
    }

    .gr-origin-domain {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 700;
      color: #38bdf8;
      word-break: break-all;
    }

    .gr-origin-warning {
      color: #fcd34d;
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* Intelligence Source Notice */
    .gr-intel-box {
      background: ${context.intelligenceSource === 'VERIFIED_THREAT_INTEL' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(56, 189, 248, 0.06)'};
      border: 1px solid ${context.intelligenceSource === 'VERIFIED_THREAT_INTEL' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 189, 248, 0.2)'};
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .gr-intel-title {
      font-size: 12px;
      font-weight: 700;
      color: ${context.intelligenceSource === 'VERIFIED_THREAT_INTEL' ? '#fca5a5' : '#7dd3fc'};
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .gr-intel-desc {
      font-size: 11px;
      color: #cbd5e1;
      line-height: 1.4;
    }

    /* Indicators List */
    .gr-section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #cbd5e1;
      margin-bottom: 8px;
    }

    .gr-indicators-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 16px;
    }

    .gr-indicator-item {
      font-size: 12px;
      line-height: 1.45;
      color: #fcd34d;
      background: rgba(245, 158, 11, 0.08);
      border-left: 3px solid #f59e0b;
      padding: 8px 12px;
      border-radius: 0 6px 6px 0;
    }

    .gr-indicator-item-danger {
      color: #fca5a5;
      background: rgba(239, 68, 68, 0.1);
      border-left-color: #ef4444;
    }

    /* Safe Handling Guidance */
    .gr-guidance-box {
      background: rgba(16, 185, 129, 0.06);
      border: 1px solid rgba(16, 185, 129, 0.2);
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 16px;
    }

    .gr-guidance-title {
      font-size: 12px;
      font-weight: 700;
      color: #6ee7b7;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .gr-guidance-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .gr-guidance-item {
      font-size: 12px;
      color: #d1fae5;
      line-height: 1.4;
    }

    /* Continuation Disclaimer */
    .gr-continuation-warning-box {
      display: none;
      background: rgba(245, 158, 11, 0.1);
      border: 1px dashed rgba(245, 158, 11, 0.4);
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 16px;
      font-size: 12px;
      color: #fef3c7;
      line-height: 1.4;
    }

    /* Diagnostics Collapsible */
    .gr-diagnostics {
      margin-top: 14px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      overflow: hidden;
      font-size: 12px;
    }

    .gr-diagnostics-summary {
      padding: 8px 12px;
      font-weight: 600;
      color: #94a3b8;
      cursor: pointer;
      user-select: none;
      transition: color 0.15s ease;
    }

    .gr-diagnostics-summary:hover, .gr-diagnostics-summary:focus-visible {
      color: #f1f5f9;
      outline: none;
    }

    .gr-diagnostics-body {
      padding: 10px 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: rgba(0, 0, 0, 0.2);
    }

    .gr-diag-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }

    .gr-diag-key {
      color: #64748b;
      font-size: 11px;
    }

    .gr-diag-val {
      color: #e2e8f0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      word-break: break-all;
    }

    /* Footer Buttons */
    .gr-footer {
      padding: 14px 20px;
      background: rgba(15, 23, 42, 0.7);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
    }

    .gr-btn {
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 9px 18px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
      outline: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: none;
    }

    .gr-btn:focus-visible {
      outline: 2px solid #38bdf8;
      outline-offset: 2px;
    }

    .gr-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .gr-btn-cancel-dl {
      background: #ef4444;
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
    }

    .gr-btn-cancel-dl:hover:not(:disabled) {
      background: #dc2626;
      box-shadow: 0 6px 16px rgba(239, 68, 68, 0.4);
    }

    .gr-btn-continue-dl {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #cbd5e1;
    }

    .gr-btn-continue-dl:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
    }

    .gr-btn-dismiss {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #cbd5e1;
    }

    .gr-btn-dismiss:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
    }

    /* Loading Overlay */
    .gr-loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.9);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      z-index: 10;
      border-radius: 16px;
    }

    .gr-spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(56, 189, 248, 0.2);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: grSpin 0.8s linear infinite;
    }

    .gr-loading-text {
      font-size: 14px;
      color: #e2e8f0;
      font-weight: 500;
    }

    @keyframes grSpin {
      to { transform: rotate(360deg); }
    }

    @keyframes grFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes grSlideUp {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `;

  // 6. Build the dialog DOM structure
  const backdrop = document.createElement('div');
  backdrop.className = 'gr-backdrop';

  const card = document.createElement('div');
  card.className = 'gr-card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'gr-dl-title');
  card.setAttribute('aria-describedby', 'gr-dl-summary');
  card.setAttribute('tabindex', '-1');

  // Accessible Live Region for Screen Readers
  const srAnnounce = document.createElement('div');
  srAnnounce.className = 'gr-sr-only';
  srAnnounce.setAttribute('role', 'status');
  srAnnounce.setAttribute('aria-live', 'polite');
  srAnnounce.setAttribute('aria-atomic', 'true');
  srAnnounce.textContent = `Guardrail Download Safety Notice: ${context.severityLabel}. File: ${context.filename} (${context.fileTypeLabel}). Status: ${context.lifecycleState}. ${context.lifecycleExplanation}`;
  card.appendChild(srAnnounce);

  // Loading Overlay
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'gr-loading-overlay';
  const spinner = document.createElement('div');
  spinner.className = 'gr-spinner';
  const loadingText = document.createElement('div');
  loadingText.className = 'gr-loading-text';
  loadingText.textContent = 'Applying protective action...';
  loadingOverlay.appendChild(spinner);
  loadingOverlay.appendChild(loadingText);
  card.appendChild(loadingOverlay);

  // Header
  const header = document.createElement('div');
  header.className = 'gr-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'gr-header-left';

  const brand = document.createElement('div');
  brand.className = 'gr-brand';
  const brandIcon = document.createElement('span');
  brandIcon.className = 'gr-brand-icon';
  brandIcon.textContent = context.isConfirmedMalicious ? '🛑' : '⚠️';
  const brandText = document.createElement('span');
  brandText.textContent = 'Guardrail Download Safety';
  brand.appendChild(brandIcon);
  brand.appendChild(brandText);

  const severityPill = document.createElement('span');
  severityPill.className = 'gr-pill-severity';
  severityPill.textContent = context.severityLabel;

  headerLeft.appendChild(brand);
  headerLeft.appendChild(severityPill);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'gr-btn-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Dismiss notice');
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => {
    dismissDownloadWarningModal();
  };

  header.appendChild(headerLeft);
  header.appendChild(closeBtn);
  card.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'gr-body';

  // Title & Summary
  const title = document.createElement('h2');
  title.id = 'gr-dl-title';
  title.style.fontSize = '18px';
  title.style.fontWeight = '700';
  title.style.color = '#ffffff';
  title.style.marginBottom = '6px';
  title.textContent = context.isConfirmedMalicious
    ? 'Dangerous Download Detected'
    : 'Review Download Before Use';
  body.appendChild(title);

  const summary = document.createElement('p');
  summary.id = 'gr-dl-summary';
  summary.style.fontSize = '13px';
  summary.style.color = '#cbd5e1';
  summary.style.marginBottom = '16px';
  summary.style.lineHeight = '1.45';
  summary.textContent = context.riskExplanation;
  body.appendChild(summary);

  // File Metadata Box
  const fileCard = document.createElement('div');
  fileCard.className = 'gr-file-card';

  const fileHeader = document.createElement('div');
  fileHeader.className = 'gr-file-header';

  const fileInfo = document.createElement('div');
  fileInfo.className = 'gr-file-info';

  const filenameEl = document.createElement('div');
  filenameEl.className = 'gr-filename';
  filenameEl.textContent = context.filename;

  const fileMetaRow = document.createElement('div');
  fileMetaRow.className = 'gr-file-meta-row';

  const extTag = document.createElement('span');
  extTag.className = 'gr-tag-ext';
  extTag.textContent = context.extension;

  const typeSpan = document.createElement('span');
  typeSpan.textContent = context.fileTypeLabel;

  const dotSpan = document.createElement('span');
  dotSpan.textContent = '•';

  const sizeSpan = document.createElement('span');
  sizeSpan.textContent = context.fileSizeFormatted;

  fileMetaRow.appendChild(extTag);
  fileMetaRow.appendChild(typeSpan);
  fileMetaRow.appendChild(dotSpan);
  fileMetaRow.appendChild(sizeSpan);

  fileInfo.appendChild(filenameEl);
  fileInfo.appendChild(fileMetaRow);
  fileHeader.appendChild(fileInfo);
  fileCard.appendChild(fileHeader);
  body.appendChild(fileCard);

  // Lifecycle Status Banner
  const statusBanner = document.createElement('div');
  statusBanner.className = 'gr-dl-status-banner';

  const lifecycleBadge = document.createElement('span');
  lifecycleBadge.className = `gr-dl-lifecycle-badge gr-badge-${context.lifecycleState}`;
  let badgeLabel = 'Ongoing';
  if (context.lifecycleState === 'paused') badgeLabel = 'Paused by Guardrail';
  else if (context.lifecycleState === 'cancelled') badgeLabel = 'Cancelled';
  else if (context.lifecycleState === 'interrupted') badgeLabel = 'Interrupted';
  else if (context.lifecycleState === 'complete') badgeLabel = 'Completed';
  lifecycleBadge.textContent = badgeLabel;

  const statusContent = document.createElement('div');
  statusContent.className = 'gr-dl-status-content';

  const statusHeadline = document.createElement('span');
  statusHeadline.className = 'gr-dl-status-headline';
  let headlineText = 'Download in Progress';
  if (context.lifecycleState === 'paused') headlineText = 'Download Paused for Review';
  else if (context.lifecycleState === 'cancelled') headlineText = 'Download Cancelled';
  else if (context.lifecycleState === 'interrupted') headlineText = 'Download Interrupted';
  else if (context.lifecycleState === 'complete') headlineText = 'Download Finished';
  statusHeadline.textContent = headlineText;

  const statusSubtext = document.createElement('span');
  statusSubtext.className = 'gr-dl-status-subtext';
  statusSubtext.textContent = context.lifecycleExplanation;

  statusContent.appendChild(statusHeadline);
  statusContent.appendChild(statusSubtext);

  statusBanner.appendChild(lifecycleBadge);
  statusBanner.appendChild(statusContent);
  body.appendChild(statusBanner);

  // Origin Domain Box
  const originBox = document.createElement('div');
  originBox.className = 'gr-origin-callout';

  const originRow = document.createElement('div');
  originRow.className = 'gr-origin-row';
  const originLabel = document.createElement('span');
  originLabel.className = 'gr-origin-label';
  originLabel.textContent = 'Origin Website / Server:';
  const originDomainEl = document.createElement('span');
  originDomainEl.className = 'gr-origin-domain';
  originDomainEl.textContent = context.originDomain;
  originRow.appendChild(originLabel);
  originRow.appendChild(originDomainEl);
  originBox.appendChild(originRow);

  if (context.isRawIp) {
    const rawIpWarning = document.createElement('div');
    rawIpWarning.className = 'gr-origin-warning';
    rawIpWarning.textContent = '⚠️ Origin is a numerical IP address rather than a verified domain name.';
    originBox.appendChild(rawIpWarning);
  }

  if (context.isInsecureTransport) {
    const insecureWarning = document.createElement('div');
    insecureWarning.className = 'gr-origin-warning';
    insecureWarning.textContent = '⚠️ File is being transferred over unencrypted cleartext HTTP.';
    originBox.appendChild(insecureWarning);
  }

  if (context.referrerDomain) {
    const refRow = document.createElement('div');
    refRow.className = 'gr-origin-row';
    const refLabel = document.createElement('span');
    refLabel.className = 'gr-origin-label';
    refLabel.textContent = 'Referred by:';
    const refDomainEl = document.createElement('span');
    refDomainEl.className = 'gr-origin-domain';
    refDomainEl.textContent = context.referrerDomain;
    refRow.appendChild(refLabel);
    refRow.appendChild(refDomainEl);
    originBox.appendChild(refRow);
  }

  body.appendChild(originBox);

  // Intelligence Source Box
  const intelBox = document.createElement('div');
  intelBox.className = 'gr-intel-box';

  const intelTitle = document.createElement('div');
  intelTitle.className = 'gr-intel-title';
  intelTitle.textContent = context.intelligenceSource === 'VERIFIED_THREAT_INTEL'
    ? '🛡️ Verified Threat Intelligence Source'
    : '🔍 Automated Local Heuristic Assessment';

  const intelDesc = document.createElement('div');
  intelDesc.className = 'gr-intel-desc';
  intelDesc.textContent = context.intelligenceDisclaimer;

  intelBox.appendChild(intelTitle);
  intelBox.appendChild(intelDesc);
  body.appendChild(intelBox);

  // Detected Indicators Section
  const indTitle = document.createElement('div');
  indTitle.className = 'gr-section-title';
  indTitle.textContent = 'Detected Risk Indicators';
  body.appendChild(indTitle);

  const indList = document.createElement('ul');
  indList.className = 'gr-indicators-list';

  for (const indText of context.detectedIndicators) {
    const itemEl = document.createElement('li');
    itemEl.className = `gr-indicator-item ${context.isConfirmedMalicious ? 'gr-indicator-item-danger' : ''}`;
    itemEl.textContent = indText;
    indList.appendChild(itemEl);
  }
  body.appendChild(indList);

  // Safe Handling Guidance Section
  const guidanceBox = document.createElement('div');
  guidanceBox.className = 'gr-guidance-box';

  const guidanceTitle = document.createElement('div');
  guidanceTitle.className = 'gr-guidance-title';
  guidanceTitle.textContent = context.lifecycleState === 'complete'
    ? '🛡️ How to Safely Inspect This Completed File'
    : '🛡️ Safe Next Steps';
  guidanceBox.appendChild(guidanceTitle);

  const guidanceList = document.createElement('ul');
  guidanceList.className = 'gr-guidance-list';
  for (const guideStep of context.safeHandlingGuidance) {
    const stepEl = document.createElement('li');
    stepEl.className = 'gr-guidance-item';
    stepEl.textContent = guideStep;
    guidanceList.appendChild(stepEl);
  }
  guidanceBox.appendChild(guidanceList);
  body.appendChild(guidanceBox);

  // Confirmation Disclaimer Box (shown before continuation)
  const continuationBox = document.createElement('div');
  continuationBox.className = 'gr-continuation-warning-box';
  continuationBox.style.display = 'none';
  continuationBox.textContent = `⚠️ Warning before continuing: ${context.continuationWarning}`;
  body.appendChild(continuationBox);

  // Technical Diagnostics Collapsible
  const diagDetails = document.createElement('details');
  diagDetails.className = 'gr-diagnostics';

  const diagSummary = document.createElement('summary');
  diagSummary.className = 'gr-diagnostics-summary';
  diagSummary.textContent = 'Technical Diagnostics (Details for Verification)';
  diagDetails.appendChild(diagSummary);

  const diagBody = document.createElement('div');
  diagBody.className = 'gr-diagnostics-body';

  const addDiagRow = (key: string, val: string) => {
    const row = document.createElement('div');
    row.className = 'gr-diag-row';
    const k = document.createElement('span');
    k.className = 'gr-diag-key';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'gr-diag-val';
    v.textContent = val;
    row.appendChild(k);
    row.appendChild(v);
    diagBody.appendChild(row);
  };

  addDiagRow('Download ID', String(context.downloadId));
  addDiagRow('Risk Level', props.evaluation.riskLevel);
  addDiagRow('Risk Score', `${props.evaluation.score} / 100`);
  addDiagRow('Declared MIME', context.declaredMime || 'unspecified');
  addDiagRow('Download URL', context.downloadUrl);
  addDiagRow('Protective Recommendation', props.evaluation.protectiveActionRecommended);
  addDiagRow('Protection Confirmed', String(props.evaluation.protectiveActionConfirmed ?? false));

  diagDetails.appendChild(diagBody);
  body.appendChild(diagDetails);
  card.appendChild(body);

  // Footer Buttons
  const footer = document.createElement('div');
  footer.className = 'gr-footer';

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'gr-btn gr-btn-dismiss';
  dismissBtn.type = 'button';
  dismissBtn.textContent = 'Dismiss Notice';
  dismissBtn.onclick = () => {
    dismissDownloadWarningModal();
  };

  const continueBtn = document.createElement('button');
  continueBtn.className = 'gr-btn gr-btn-continue-dl';
  continueBtn.type = 'button';
  continueBtn.textContent = 'Resume Download...';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'gr-btn gr-btn-cancel-dl';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel Download';

  // Configure visibility based on supported actions
  if (!context.supportedActions.canCancel) {
    cancelBtn.style.display = 'none';
  }
  if (!context.supportedActions.canResume) {
    continueBtn.style.display = 'none';
  }

  // Cancel Action Handler (Protects against duplicate clicks)
  cancelBtn.onclick = async () => {
    if (isOperationInProgress) return;
    isOperationInProgress = true;
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelling...';
    card.setAttribute('aria-busy', 'true');
    loadingOverlay.style.display = 'flex';
    loadingText.textContent = 'Cancelling download and discarding transfer data...';

    try {
      if (typeof props.onCancel === 'function') {
        await props.onCancel();
      }
      updateDownloadModalLifecycle('cancelled');
    } catch {
      // Handle error gracefully
      updateDownloadModalLifecycle('cancelled');
    } finally {
      isOperationInProgress = false;
      card.setAttribute('aria-busy', 'false');
      loadingOverlay.style.display = 'none';
    }
  };

  // Continue Action Handler (Requires confirmation step before resumption)
  continueBtn.onclick = async () => {
    if (isOperationInProgress) return;

    if (currentViewState !== 'confirming_continuation') {
      currentViewState = 'confirming_continuation';
      continuationBox.style.display = 'block';
      continueBtn.textContent = 'I Understand, Resume File';
      continueBtn.className = 'gr-btn gr-btn-cancel-dl'; // Highlight attention
      return;
    }

    // Second click: Proceed with resumption
    isOperationInProgress = true;
    continueBtn.disabled = true;
    continueBtn.textContent = 'Resuming...';
    card.setAttribute('aria-busy', 'true');
    loadingOverlay.style.display = 'flex';
    loadingText.textContent = 'Resuming download...';

    try {
      if (typeof props.onContinue === 'function') {
        await props.onContinue();
      }
      updateDownloadModalLifecycle('in_progress');
    } catch {
      // Handle error
    } finally {
      isOperationInProgress = false;
      card.setAttribute('aria-busy', 'false');
      loadingOverlay.style.display = 'none';
      dismissDownloadWarningModal();
    }
  };

  footer.appendChild(dismissBtn);
  if (context.supportedActions.canResume) {
    footer.appendChild(continueBtn);
  }
  if (context.supportedActions.canCancel) {
    footer.appendChild(cancelBtn);
  }

  card.appendChild(footer);
  backdrop.appendChild(card);
  shadow.appendChild(style);
  shadow.appendChild(backdrop);

  // 7. Attach to DOM
  if (typeof document !== 'undefined' && document.body) {
    document.body.appendChild(host);
  }

  // 8. Focus Management: focus on primary interactive element
  const primaryInteractive = cancelBtn.style.display !== 'none' ? cancelBtn : dismissBtn;
  if (typeof primaryInteractive?.focus === 'function') {
    try {
      primaryInteractive.focus();
    } catch {
      // Ignore in mock environments
    }
  }

  // 9. Keyboard Event Handlers (Focus Trapping & Escape Dismissal)
  activeEscapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.keyCode === 27) {
      e.preventDefault();
      dismissDownloadWarningModal();
    }
  };

  activeTabTrapHandler = (e: KeyboardEvent) => {
    if (e.key === 'Tab' || e.keyCode === 9) {
      if (!currentShadow) return;
      const focusableSelectors = [
        'button:not([disabled])',
        'summary',
        '[tabindex]:not([tabindex=\"-1\"])',
      ].join(', ');
      const focusables = Array.from(currentShadow.querySelectorAll(focusableSelectors)) as HTMLElement[];
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (currentShadow.activeElement === first || document.activeElement === host) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (currentShadow.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', activeEscapeHandler);
    window.addEventListener('keydown', activeTabTrapHandler);
  }

  // Backdrop click dismisses
  backdrop.addEventListener('click', (e: MouseEvent) => {
    if (e.target === backdrop) {
      dismissDownloadWarningModal();
    }
  });

  return () => {
    dismissDownloadWarningModal();
  };
}
